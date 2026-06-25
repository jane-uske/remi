"use client";

import { useCallback, useEffect, useState } from "react";

/* ──────────────────────────────────────────────────────────────────────────
 * Service settings panel.
 *
 * Edits the server-side runtime overlay (data/remi-settings.json) through
 * GET/POST /api/settings, so the user can point Remi at their local ComfyUI /
 * mlx-audio servers and flip adult mode without hand-editing .env + restarting.
 * Live up/down pills come from GET /api/health/services.
 * ──────────────────────────────────────────────────────────────────────── */

type SettingsForm = Record<string, string>;

type ServiceHealth = {
  url: string;
  enabled: boolean;
  up: boolean;
  latencyMs: number;
  error?: string;
};

type HealthResponse = { comfyui: ServiceHealth; mlx: ServiceHealth };

const TTS_PROVIDERS = ["edge", "piper", "openai", "volc", "mlx"] as const;

function toFormValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value === null || value === undefined) return "";
  return String(value);
}

export function RemiSettingsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SettingsForm>({});
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const setField = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  }, []);

  // Load current settings when the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus("loading");
    setErrorMsg(null);
    fetch("/api/settings", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { settings: Record<string, unknown> }) => {
        if (cancelled) return;
        const next: SettingsForm = {};
        for (const [key, value] of Object.entries(data.settings ?? {})) {
          next[key] = toFormValue(value);
        }
        setForm(next);
        setStatus("idle");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMsg(`读取设置失败：${err.message}`);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Poll service health while open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const probe = () => {
      fetch("/api/health/services", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
        .then((data: HealthResponse) => {
          if (!cancelled) setHealth(data);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    };
    probe();
    const id = window.setInterval(probe, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const save = useCallback(async () => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setErrorMsg(`保存失败：${(err as Error).message}`);
      setStatus("error");
    }
  }, [form]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="服务设置"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-[min(94vw,40rem)] flex-col overflow-hidden rounded-3xl border border-[color:var(--remi-account-menu-border)] bg-[var(--remi-account-menu-bg)] shadow-2xl shadow-black/40 backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + status pills */}
        <div className="flex items-center justify-between border-b border-[color:var(--remi-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">服务设置</h2>
            <p className="mt-0.5 text-[11px] text-[var(--remi-dim)]">
              即时生效，无需重启；不会改动你的 .env
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--remi-surface)] text-[var(--remi-dim)] transition hover:text-[var(--foreground)]"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-[color:var(--remi-border)] px-5 py-3">
          <StatusPill label="ComfyUI" health={health?.comfyui} />
          <StatusPill label="MLX TTS" health={health?.mlx} />
        </div>

        {/* Form body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Section title="生图（ComfyUI · z-image-turbo）">
            <Toggle
              label="启用生图"
              checked={form.COMFYUI_ENABLED === "1"}
              onChange={(v) => setField("COMFYUI_ENABLED", v ? "1" : "0")}
            />
            <Text
              label="ComfyUI 地址"
              value={form.COMFYUI_BASE_URL ?? ""}
              placeholder="http://127.0.0.1:8188"
              onChange={(v) => setField("COMFYUI_BASE_URL", v)}
            />
            <Text
              label="默认模型 checkpoint（留空用工作流默认）"
              value={form.COMFYUI_CHECKPOINT ?? ""}
              placeholder="z-image-turbo.safetensors"
              onChange={(v) => setField("COMFYUI_CHECKPOINT", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Text
                label="宽"
                value={form.COMFYUI_DEFAULT_WIDTH ?? ""}
                placeholder="512"
                onChange={(v) => setField("COMFYUI_DEFAULT_WIDTH", v)}
              />
              <Text
                label="高"
                value={form.COMFYUI_DEFAULT_HEIGHT ?? ""}
                placeholder="512"
                onChange={(v) => setField("COMFYUI_DEFAULT_HEIGHT", v)}
              />
            </div>
          </Section>

          <Section title="语音（本地 MLX · Qwen3-TTS）">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--remi-dim)]">TTS 引擎</span>
              <select
                value={form.REMI_TTS_PROVIDER ?? "edge"}
                onChange={(e) => setField("REMI_TTS_PROVIDER", e.target.value)}
                className="rounded-xl border border-[color:var(--remi-border)] bg-[var(--remi-input)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition hover:border-[color:var(--remi-accent)]"
              >
                {TTS_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p === "mlx" ? "mlx（本地 Qwen3-TTS）" : p}
                  </option>
                ))}
              </select>
            </label>
            <Text
              label="MLX 服务地址"
              value={form.REMI_TTS_MLX_URL ?? ""}
              placeholder="http://127.0.0.1:8000"
              onChange={(v) => setField("REMI_TTS_MLX_URL", v)}
            />
            <Text
              label="模型"
              value={form.REMI_TTS_MLX_MODEL ?? ""}
              placeholder="mlx-community/Qwen3-TTS-…"
              onChange={(v) => setField("REMI_TTS_MLX_MODEL", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Text
                label="音色 speaker"
                value={form.REMI_TTS_MLX_SPEAKER ?? ""}
                placeholder="Vivian"
                onChange={(v) => setField("REMI_TTS_MLX_SPEAKER", v)}
              />
              <Text
                label="语言"
                value={form.REMI_TTS_MLX_LANGUAGE ?? ""}
                placeholder="Chinese"
                onChange={(v) => setField("REMI_TTS_MLX_LANGUAGE", v)}
              />
            </div>
          </Section>

          <Section title="实时语音外壳（实验 · Voice Native）">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--remi-dim)]">语音引擎</span>
              <select
                value={form.REMI_VOICE_ENGINE ?? "legacy"}
                onChange={(e) => setField("REMI_VOICE_ENGINE", e.target.value)}
                className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition hover:border-white/20"
              >
                <option value="legacy">legacy（级联，默认 · 与现状等价）</option>
                <option value="realtime_shadow">realtime_shadow（端到端影子 · 仅打日志）</option>
              </select>
            </label>
            <p className="text-[11px] leading-5 text-[var(--remi-dim)]">
              realtime_shadow 仅把统一事件协议打到服务端日志，不接任何厂商、不发客户端消息、不改变现有语音链路；
              legacy 始终是兜底。下次语音会话生效。
            </p>
          </Section>

          <Section title="成人模式（NSFW）">
            <Toggle
              label="允许成人模式"
              checked={form.REMI_NSFW_ENABLED === "1"}
              onChange={(v) => setField("REMI_NSFW_ENABLED", v ? "1" : "0")}
            />
            <p className="text-[11px] leading-5 text-[var(--remi-dim)]">
              打开后，在聊天里对 Remi 说「开启成人模式」即可进入；说「退出成人模式」退出。仅对当前会话生效。
            </p>
            <Text
              label="成人模式生图 checkpoint（留空沿用默认）"
              value={form.COMFYUI_NSFW_CHECKPOINT ?? ""}
              placeholder="（你的 NSFW 模型）.safetensors"
              onChange={(v) => setField("COMFYUI_NSFW_CHECKPOINT", v)}
            />
            <Text
              label="成人模式负面词（留空沿用默认）"
              value={form.COMFYUI_NSFW_NEGATIVE ?? ""}
              placeholder="lowres, bad anatomy, …"
              onChange={(v) => setField("COMFYUI_NSFW_NEGATIVE", v)}
            />
          </Section>

          <Section title="🎬 视频生成（Storyboard Runner · Z-Image + LTX）">
            <Toggle
              label="启用视频生成"
              checked={form.COMFYUI_VIDEO_ENABLED === "1"}
              onChange={(v) => setField("COMFYUI_VIDEO_ENABLED", v ? "1" : "0")}
            />
            <p className="text-[11px] leading-5 text-[var(--remi-dim)]">
              在对话中说「帮我生成一个xxx的视频」即可触发。生成约需 20-30 分钟，好了会告诉你。
            </p>
            <Text
              label="固定角色（锁定每个镜头的人物身份）"
              value={form.VIDEO_CHARACTER ?? ""}
              placeholder="如：银发紫眸动漫少女, same face, same outfit"
              onChange={(v) => setField("VIDEO_CHARACTER", v)}
            />
            <Text
              label="场景偏好（留空由模型自由发挥）"
              value={form.VIDEO_SCENE ?? ""}
              placeholder="如：neon city street at night"
              onChange={(v) => setField("VIDEO_SCENE", v)}
            />
            <Text
              label="画风标签（留空用默认 photorealistic cinematic）"
              value={form.VIDEO_STYLE ?? ""}
              placeholder="如：anime, vibrant colors, studio lighting"
              onChange={(v) => setField("VIDEO_STYLE", v)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Text
                label="宽"
                value={form.VIDEO_WIDTH ?? ""}
                placeholder="512"
                onChange={(v) => setField("VIDEO_WIDTH", v)}
              />
              <Text
                label="高"
                value={form.VIDEO_HEIGHT ?? ""}
                placeholder="768"
                onChange={(v) => setField("VIDEO_HEIGHT", v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Text
                label="镜头数"
                value={form.VIDEO_SHOTS ?? ""}
                placeholder="8"
                onChange={(v) => setField("VIDEO_SHOTS", v)}
              />
              <Text
                label="帧率"
                value={form.VIDEO_FPS ?? ""}
                placeholder="8"
                onChange={(v) => setField("VIDEO_FPS", v)}
              />
            </div>
            <Text
              label="复用参考图（已有 run 名称，用于角色一致性）"
              value={form.VIDEO_REFERENCE_RUN ?? ""}
              placeholder="如：full512_33s"
              onChange={(v) => setField("VIDEO_REFERENCE_RUN", v)}
            />
          </Section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--remi-border)] px-5 py-4">
          <span className="text-xs text-[var(--remi-dim)]">
            {status === "loading" && "读取中…"}
            {status === "saved" && "已保存 ✓"}
            {status === "error" && errorMsg}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={status === "saving" || status === "loading"}
            className="rounded-xl bg-[var(--remi-accent)] px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
          >
            {status === "saving" ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ label, health }: { label: string; health?: ServiceHealth }) {
  const up = health?.up ?? false;
  const known = health !== undefined;
  const color = !known ? "#9ca3af" : up ? "#34d399" : "#f87171";
  const text = !known ? "检测中" : up ? `在线 ${health?.latencyMs}ms` : "离线";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--remi-border)] bg-[var(--remi-surface)] px-2.5 py-1 text-[11px] text-[var(--foreground)]">
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}：{text}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-[color:var(--remi-border)] bg-[var(--remi-surface)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--remi-dim)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Text({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--remi-dim)]">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="rounded-xl border border-[color:var(--remi-border)] bg-[var(--remi-input)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--remi-input-placeholder)] hover:border-[color:var(--remi-accent)] focus:border-[color:var(--remi-accent)]"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span className="text-sm text-[var(--foreground)]">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${
          checked ? "bg-emerald-400/80" : "bg-[var(--remi-dot-off)]"
        }`}
      >
        {/* Track content box is 40px (44 − 2×2px padding); knob is 20px, so
            travel is exactly 20px (translate-x-5) → flush at both ends. */}
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
