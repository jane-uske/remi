"""MLX TTS server with streaming support for M5 Max."""
import io, struct, time
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import numpy as np

app = FastAPI()
_model = None

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"

def get_model():
    global _model
    if _model is None:
        from mlx_audio.tts.utils import load_model
        print(f"Loading model: {MODEL_ID} ...")
        _model = load_model(MODEL_ID)
        print("Model loaded.")
    return _model


class SpeechRequest(BaseModel):
    model: str = MODEL_ID
    input: str
    voice: str = "Vivian"
    language: str = "Chinese"
    instruct: str | None = None
    response_format: str = "wav"
    stream: bool = False
    temperature: float | None = None


def make_wav_header(sample_rate: int = 24000, bits: int = 16, channels: int = 1) -> bytes:
    """WAV header with size=0xFFFFFFFF (streaming-compatible)."""
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 0xFFFFFFFF))  # placeholder size
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits))
    buf.write(b"data")
    buf.write(struct.pack("<I", 0xFFFFFFFF))  # placeholder size
    return buf.getvalue()


def pcm_to_wav(pcm: np.ndarray, sample_rate: int = 24000) -> bytes:
    pcm_16 = (np.clip(pcm, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    data_size = len(pcm_16) * 2
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(pcm_16.tobytes())
    return buf.getvalue()


@app.post("/v1/audio/speech")
async def speech(req: SpeechRequest):
    model = get_model()
    kwargs = {"text": req.input, "voice": req.voice, "language": req.language}
    if req.instruct:
        kwargs["instruct"] = req.instruct
    if req.temperature is not None:
        kwargs["temperature"] = req.temperature

    if req.stream:
        return StreamingResponse(
            _stream_audio(model, kwargs),
            media_type="audio/wav",
            headers={"Content-Disposition": "attachment; filename=speech.wav"},
        )

    # Non-streaming: collect all then return
    t0 = time.time()
    all_audio = []
    sample_rate = 24000
    for chunk in model.generate(**kwargs):
        all_audio.append(np.array(chunk.audio))
        sample_rate = chunk.sample_rate

    pcm = np.concatenate(all_audio) if len(all_audio) > 1 else all_audio[0]
    wav_bytes = pcm_to_wav(pcm.flatten(), sample_rate)
    duration = time.time() - t0
    print(f"[TTS] non-stream: {len(req.input)}chars, {duration:.2f}s, {len(wav_bytes)} bytes")

    return StreamingResponse(
        io.BytesIO(wav_bytes),
        media_type="audio/wav",
        headers={"Content-Disposition": "attachment; filename=speech.wav"},
    )


async def _stream_audio(model, kwargs):
    """Yield WAV header + PCM chunks as they are generated."""
    t0 = time.time()
    first_chunk_time = None
    total_bytes = 0
    sample_rate = 24000

    header_sent = False
    for chunk in model.generate(**kwargs):
        sample_rate = chunk.sample_rate
        pcm = np.array(chunk.audio).flatten()
        pcm_16 = (np.clip(pcm, -1.0, 1.0) * 32767).astype(np.int16)

        if not header_sent:
            first_chunk_time = time.time() - t0
            yield make_wav_header(sample_rate)
            header_sent = True

        audio_bytes = pcm_16.tobytes()
        total_bytes += len(audio_bytes)
        yield audio_bytes

    duration = time.time() - t0
    print(f"[TTS] stream: first_chunk={first_chunk_time:.2f}s, total={duration:.2f}s, {total_bytes} bytes")


@app.get("/health")
async def health():
    return {"status": "ok", "model": MODEL_ID}


if __name__ == "__main__":
    import uvicorn
    get_model()
    print(f"MLX TTS server ready — model: {MODEL_ID}")
    uvicorn.run(app, host="0.0.0.0", port=8000)
