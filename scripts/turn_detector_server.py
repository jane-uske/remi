#!/usr/bin/env python3
"""
Turn-detector sidecar for Remi PR5b shadow comparison.

Serves the HTTP contract consumed by
server/session/voice/turn_detector/livekit_turn_detector_adapter.ts:

  GET  /health     → {"ok": true, "model": "<name>"}
  POST /turn-end   → {"eou_probability": 0.0-1.0}
       body: {"text": "<partial transcript>", "language": "zh"}
  POST /barge-in   → {"is_barge_in": bool, "confidence": 0.0-1.0}
       body: {"text", "speech_ms", "has_partial"}

Two backends, selected by REMI_TD_BACKEND (default: auto):
  - "livekit": the REAL LiveKit turn-detector v2 multilingual model
      (text end-of-utterance classifier). Requires:
        pip install onnxruntime transformers huggingface_hub numpy
      and network access to download `livekit/turn-detector`. This is the
      PRODUCTION provider — the goal of PR5b.
  - "reference": a transparent Chinese-aware heuristic. NOT a model. Only a
      dev fallback so the HTTP path + eval harness run without weights. /health
      reports model="reference-heuristic" and logs a loud warning. Numbers from
      this backend are illustrative, NOT a basis for the final on/off decision.

  "auto" tries livekit, falls back to reference if deps/weights are missing.

Run:
  python3 scripts/turn_detector_server.py --port 8111
  # then point Remi at it:
  REMI_TURN_DETECTOR_SHADOW=1 \
  REMI_TURN_DETECTOR_SHADOW_PROVIDER=livekit_v1mini \
  REMI_TURN_DETECTOR_ENDPOINT=http://127.0.0.1:8111 npm run dev
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


# ── reference backend (heuristic, dev fallback only) ────────────────────────

# Sentence-final particles / markers that suggest a completed Chinese utterance.
_ZH_FINAL_PARTICLES = ("吗", "呢", "吧", "啊", "了", "嘛", "啦", "呀")
_SENTENCE_END = re.compile(r"[。．.!！?？]$")
# Trailing connectives that signal the speaker is NOT done.
_ZH_TRAILING_CONJ = ("然后", "但是", "因为", "所以", "而且", "还有", "就是", "那个", "嗯", "呃")


class ReferenceBackend:
    name = "reference-heuristic"

    def eou_probability(self, text: str) -> float:
        t = (text or "").strip()
        if not t:
            return 0.15
        prob = 0.4
        if _SENTENCE_END.search(t):
            prob += 0.4
        if t[-1] in _ZH_FINAL_PARTICLES:
            prob += 0.25
        # Hesitation / trailing connective → likely continuing
        for conj in _ZH_TRAILING_CONJ:
            if t.endswith(conj):
                prob -= 0.35
                break
        # Very short fragments lean "not done"
        if len(t) <= 2:
            prob -= 0.15
        return max(0.0, min(1.0, prob))

    def barge_in(self, text: str, speech_ms: int, has_partial: bool):
        t = (text or "").strip()
        # Meaningful partial during assistant speech + enough duration → barge-in
        if has_partial and len(t) >= 2 and speech_ms >= 280:
            return True, 0.75
        if speech_ms >= 360:
            return True, 0.55
        return False, 0.2


# ── livekit backend (real model) ────────────────────────────────────────────

class LiveKitBackend:
    """Real LiveKit turn-detector (multilingual) end-of-utterance model.

    Faithful reproduction of upstream livekit-plugins-turn-detector inference:
      - model: livekit/turn-detector, file `onnx/model_q8.onnx`,
        revision `v0.4.1-intl` (multilingual). The ONNX has a custom EOU head
        whose output `prob` (shape [batch, seq]) gives the end-of-utterance
        probability directly — read `outputs[0].flatten()[-1]`.
      - text normalization: NFKC + lowercase + punctuation removal (keep ' and -)
        + whitespace collapse.
      - chat formatting: the repo tokenizer's chat template, with the trailing
        `<|im_end|>` of the current (unfinished) user turn stripped.
      - inputs: `input_ids` only (int64), truncated to 128 tokens.

    Loaded lazily. Raises on missing deps/weights so `auto` can fall back.
    """
    name = "livekit-turn-detector-multilingual"
    HF_REPO = os.environ.get("REMI_TD_HF_REPO", "livekit/turn-detector")
    ONNX_FILE = os.environ.get("REMI_TD_ONNX_FILE", "model_q8.onnx")
    ONNX_SUBFOLDER = os.environ.get("REMI_TD_ONNX_SUBFOLDER", "onnx")
    MODEL_REVISION = os.environ.get("REMI_TD_REVISION", "v0.4.1-intl")
    MAX_TOKENS = 128

    def __init__(self):
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer
        from huggingface_hub import hf_hub_download

        self._np = np
        self.tokenizer = AutoTokenizer.from_pretrained(
            self.HF_REPO, revision=self.MODEL_REVISION,
        )
        onnx_path = hf_hub_download(
            self.HF_REPO, self.ONNX_FILE,
            subfolder=self.ONNX_SUBFOLDER, revision=self.MODEL_REVISION,
        )
        self.session = ort.InferenceSession(
            onnx_path, providers=["CPUExecutionProvider"],
        )
        self.eou_probability("你好")  # warm up

    def _normalize_text(self, text: str) -> str:
        if not text:
            return ""
        t = unicodedata.normalize("NFKC", text.lower())
        t = "".join(
            ch for ch in t
            if not (unicodedata.category(ch).startswith("P") and ch not in ("'", "-"))
        )
        return re.sub(r"\s+", " ", t).strip()

    def _format(self, text: str) -> str:
        msgs = [{"role": "user", "content": self._normalize_text(text)}]
        full = self.tokenizer.apply_chat_template(
            msgs, add_generation_prompt=False, add_special_tokens=False, tokenize=False,
        )
        ix = full.rfind("<|im_end|>")
        return full[:ix] if ix != -1 else full

    def _infer(self, text: str) -> float:
        prompt = self._format(text)
        ids = self.tokenizer(
            prompt, add_special_tokens=False, truncation=True, max_length=self.MAX_TOKENS,
        )["input_ids"]
        outputs = self.session.run(
            None, {"input_ids": self._np.array([ids], dtype=self._np.int64)},
        )
        # Custom EOU head: output `prob` [batch, seq]; last position = EOU prob.
        return float(outputs[0].flatten()[-1])

    def eou_probability(self, text: str) -> float:
        t = (text or "").strip()
        if not t:
            return 0.15
        try:
            return max(0.0, min(1.0, self._infer(t)))
        except Exception as exc:  # pragma: no cover - real-model runtime guard
            print(f"[turn_detector_server] livekit infer failed: {exc}", file=sys.stderr)
            raise

    def barge_in(self, text: str, speech_ms: int, has_partial: bool):
        # The text EOU model does not directly classify barge-in. We expose a
        # conservative derived signal: a meaningful partial that the model reads
        # as NOT-yet-complete during assistant speech is a genuine user turn.
        t = (text or "").strip()
        if has_partial and len(t) >= 2:
            incomplete = 1.0 - self.eou_probability(t)
            if speech_ms >= 280 and incomplete >= 0.3:
                return True, min(1.0, 0.5 + incomplete * 0.5)
        if speech_ms >= 360:
            return True, 0.55
        return False, 0.2


def build_backend(mode: str):
    mode = (mode or "auto").lower()
    if mode == "reference":
        print("[turn_detector_server] WARNING: reference heuristic backend — "
              "NOT the production model. Numbers are illustrative only.",
              file=sys.stderr)
        return ReferenceBackend()
    if mode in ("livekit", "auto"):
        try:
            backend = LiveKitBackend()
            print(f"[turn_detector_server] loaded REAL model: {backend.name}", file=sys.stderr)
            return backend
        except Exception as exc:
            if mode == "livekit":
                print(f"[turn_detector_server] FATAL: real model load failed: {exc}", file=sys.stderr)
                raise
            print(f"[turn_detector_server] real model unavailable ({exc}); "
                  f"falling back to reference heuristic.", file=sys.stderr)
            return ReferenceBackend()
    raise SystemExit(f"unknown REMI_TD_BACKEND: {mode}")


# ── http server ──────────────────────────────────────────────────────────────

def make_handler(backend):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # quiet

        def _send(self, code, obj):
            payload = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def _read_body(self):
            length = int(self.headers.get("content-length", 0) or 0)
            if not length:
                return {}
            return json.loads(self.rfile.read(length) or b"{}")

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"ok": True, "model": backend.name})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            try:
                body = self._read_body()
            except Exception:
                self._send(400, {"error": "bad json"})
                return
            if self.path == "/turn-end":
                prob = backend.eou_probability(body.get("text", ""))
                self._send(200, {"eou_probability": prob})
            elif self.path == "/barge-in":
                is_bi, conf = backend.barge_in(
                    body.get("text", ""),
                    int(body.get("speech_ms", 0) or 0),
                    bool(body.get("has_partial", False)),
                )
                self._send(200, {"is_barge_in": is_bi, "confidence": conf})
            else:
                self._send(404, {"error": "not found"})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("REMI_TD_PORT", "8111")))
    ap.add_argument("--host", default=os.environ.get("REMI_TD_HOST", "127.0.0.1"))
    ap.add_argument("--backend", default=os.environ.get("REMI_TD_BACKEND", "auto"))
    args = ap.parse_args()

    backend = build_backend(args.backend)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(backend))
    print(f"[turn_detector_server] listening on http://{args.host}:{args.port} "
          f"(backend={backend.name})", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
