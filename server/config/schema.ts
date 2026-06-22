import { z } from "zod";

import { applyOverlayToEnv } from "./overlay";
import { warnLlmModelChoice } from "./llm_model_guard";

const boolLiterals = z.union([
  z.literal("0"),
  z.literal("1"),
  z.literal("true"),
  z.literal("false"),
  z.literal(""),
]);
const toBool = (v: string | undefined) => v === "1" || v === "true";

function booleanString(defaultValue?: "0" | "1") {
  if (defaultValue !== undefined) {
    return boolLiterals.default(defaultValue).transform(toBool);
  }
  return boolLiterals.optional().transform(toBool);
}

const optionalUrl = z.string().url().optional().or(z.literal(""));

/**
 * Remi 环境变量 Schema — 启动时验证，失败则 exit(1)
 *
 * 命名规则：REMI_ 前缀 + 子系统 + 功能
 * 旧名通过 LEGACY_ALIASES 兼容
 */
export const envSchema = z.object({
  // ── LLM ──────────────────────────────────────────────────────────────────
  REMI_LLM_API_KEY: z.string().min(1, "LLM API key is required").default(""),
  REMI_LLM_BASE_URL: z.string().default("http://127.0.0.1:1234/v1"),
  REMI_LLM_MODEL: z.string().default("qwen2.5-14b-instruct"),
  REMI_LLM_PROXY_URL: z.string().optional(),
  REMI_FAST_BRAIN_MODEL: z.string().optional(),
  REMI_FAST_BRAIN_REASONING_EFFORT: z.string().optional(),
  REMI_FAST_BRAIN_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(2048),

  // ── TTS ──────────────────────────────────────────────────────────────────
  REMI_TTS_PROVIDER: z
    .enum(["edge", "piper", "openai", "volc", "mlx"])
    .default("edge"),
  REMI_TTS_VOICE: z.string().default("zh-CN-XiaoyiNeural"),
  REMI_TTS_STREAM: booleanString("0"),
  VOLC_TTS_API_KEY: z.string().optional(),
  VOLC_TTS_RESOURCE_ID: z.string().optional(),
  VOLC_TTS_VOICE_TYPE: z.string().optional(),
  // MLX TTS (local Qwen3-TTS via mlx-audio server)
  REMI_TTS_MLX_URL: z.string().default("http://127.0.0.1:8000"),
  REMI_TTS_MLX_MODEL: z
    .string()
    .default("mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"),
  REMI_TTS_MLX_SPEAKER: z.string().default("Vivian"),
  REMI_TTS_MLX_LANGUAGE: z.string().default("Chinese"),
  // Optional override for the instruct field sent to Qwen3-TTS.
  // When set, this replaces the per-emotion instruct from tts_emotion.ts.
  REMI_TTS_MLX_INSTRUCT: z.string().optional(),
  REMI_TTS_MLX_NSFW_INSTRUCT: z.string().optional(),
  // Sampling temperature for Qwen3-TTS (lower = more consistent voice across segments).
  REMI_TTS_MLX_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.35),
  tts_key: z.string().optional(),
  tts_base_url: z.string().optional(),
  tts_model: z.string().default("tts-1"),
  tts_lang: z.string().default("zh-CN"),
  tts_rate: z.string().default("default"),
  tts_pitch: z.string().default("default"),
  tts_max_chars: z.coerce.number().int().positive().default(120),
  tts_strip_parenthetical: booleanString("1"),
  tts_strip_emoji: booleanString("1"),
  // Ellipsis/tildes → speakable punctuation before TTS (word-safe; helps MLX moaning text).
  REMI_TTS_SPEAKABLE_PUNCT: booleanString("0"),
  tts_cache_max_chars: z.coerce.number().int().nonnegative().default(24),
  tts_cache_max_entries: z.coerce.number().int().positive().default(80),
  tts_fallback_provider: z.string().optional(),
  TTS_FALLBACK_PROVIDER: z.string().optional(),
  // Edge TTS
  edge_tts_timeout: z.coerce.number().int().positive().default(10000),
  edge_tts_pool: z.string().optional(),
  edge_tts_pool_idle_ms: z.coerce.number().int().nonnegative().default(45000),
  edge_tts_pool_max_size: z.coerce.number().int().positive().default(10),
  edge_tts_stream_ffmpeg_cmd: z.string().default("ffmpeg"),
  EDGE_TTS_STREAM_FFMPEG_CMD: z.string().optional(),
  edge_tts_stream_failure_cooldown_ms: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(120000),
  EDGE_TTS_STREAM_FAILURE_COOLDOWN_MS: z.coerce.number().optional(),
  // Piper TTS
  piper_cmd: z.string().default("piper"),
  piper_model: z.string().optional(),
  piper_speaker: z.string().optional(),
  piper_length_scale: z.coerce.number().optional(),
  piper_noise_scale: z.coerce.number().optional(),
  piper_noise_w_scale: z.coerce.number().optional(),
  piper_timeout: z.coerce.number().int().positive().default(10000),
  // TTS Chunker
  TTS_CHUNK_MIN_CHARS: z.coerce.number().int().positive().optional(),
  TTS_CHUNK_MAX_CHARS: z.coerce.number().int().positive().optional(),
  TTS_MIN_CHARS: z.coerce.number().int().nonnegative().optional(),
  TTS_EAGER_MIN_CHARS: z.coerce.number().int().nonnegative().optional(),
  TTS_EAGER_CHUNK_CHARS: z.coerce.number().int().positive().optional(),
  TTS_EAGER_THRESHOLD: z.coerce.number().int().positive().optional(),
  TTS_EAGER_LOOKAHEAD_CHARS: z.coerce.number().int().nonnegative().optional(),
  TTS_EAGER_SOFT_BREAK_MIN_CHARS: z.coerce.number().int().positive().optional(),

  // ── STT ──────────────────────────────────────────────────────────────────
  REMI_STT_PROVIDER: z
    .enum(["openai", "whisper-cpp", "sherpa"])
    .default("openai"),
  REMI_STT_API_KEY: z.string().optional(),
  REMI_STT_BASE_URL: z.string().optional(),
  stt_model: z.string().default("whisper-1"),
  stt_prompt: z.string().optional(),
  stt_language: z.string().optional(),
  stt_temperature: z.coerce.number().optional(),
  stt_min_pcm_ms: z.coerce.number().int().nonnegative().optional(),
  STT_MIN_PCM_MS: z.coerce.number().int().nonnegative().optional(),
  stt_incremental_provider: z.string().optional(),
  STT_INCREMENTAL_PROVIDER: z.string().optional(),
  whisper_model: z.string().optional(),
  whisper_prompt: z.string().optional(),
  whisper_lang: z.string().optional(),
  whisper_use_server: booleanString("0"),
  whisper_server_autostart: booleanString("0"),
  whisper_server_url: z.string().optional(),
  REMI_STT_FINAL_DISAMBIG_LOG_DIFF: booleanString("1"),
  REMI_STT_FINAL_DISAMBIG_DICT_PATH: z.string().optional(),

  // ── Auth ─────────────────────────────────────────────────────────────────
  REMI_AUTH_MODE: z
    .enum(["disabled", "legacy_jwt", "clerk"])
    .default("disabled"),
  REMI_AUTH_JWT_SECRET: z.string().optional(),
  REMI_AUTH_ALLOW_LOOPBACK_BYPASS: booleanString("1"),
  CLERK_JWT_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),

  // ── Server ───────────────────────────────────────────────────────────────
  REMI_PORT: z.coerce.number().int().positive().default(3001),
  REMI_LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  REMI_NEXT_HOSTNAME: z.string().optional(),
  REMI_ACCESS_PASSWORD: z.string().optional(),
  REMI_EXTERNAL_API_KEY: z.string().optional(),
  REMI_MOBILE_DEV_ENABLED: booleanString("0"),
  REMI_MOBILE_DEV_KEY: z.string().optional(),
  DEV_USER_ID: z.string().optional(),
  interrupt_reaction: z.string().optional(),

  // ── Features ─────────────────────────────────────────────────────────────
  REMI_SLOW_BRAIN_ENABLED: booleanString("1"),
  REMI_SLOW_BRAIN_REASONING_EFFORT: z.string().default("low"),
  REMI_LOCAL_LLM_ENABLED: booleanString("1"),
  REMI_PERSISTENT_MEMORY_OVERLAY_ENABLED: booleanString("1"),
  REMI_AVATAR_INTENT_ENABLED: booleanString("1"),
  REMI_SILENCE_NUDGE_MS: z.coerce.number().int().nonnegative().default(0),
  REMI_SILENCE_NUDGE_MIN_TURNS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(2),
  REMI_TIME_CAPABILITY_ENABLED: booleanString("1"),
  REMI_DATE_RECAP_CAPABILITY_ENABLED: booleanString("1"),

  // ── Family Memory ──────────────────────────────────────────────────────
  REMI_FAMILY_MEMORY_ENABLED: booleanString("0"),
  REMI_FAMILY_MEMORY_SERVICE_URL: z.string().default("http://localhost:3456"),
  REMI_FAMILY_MEMORY_AI_TOKEN: z.string().default(""),

  // ── ComfyUI image generation (local only) ─────────────────────────────────
  COMFYUI_ENABLED: booleanString("1"),
  COMFYUI_BASE_URL: z.string().default("http://127.0.0.1:8188"),
  // Where downloaded images are saved (relative paths resolve from cwd).
  COMFYUI_OUTPUT_DIR: z.string().default("artifacts/comfyui"),
  COMFYUI_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  // Optional path to a user-supplied "Save (API Format)" workflow JSON.
  COMFYUI_WORKFLOW_PATH: z.string().default(""),
  COMFYUI_CHECKPOINT: z.string().default(""),
  COMFYUI_DEFAULT_NEGATIVE: z
    .string()
    .default("text, watermark, lowres, bad anatomy, worst quality, low quality"),
  COMFYUI_DEFAULT_WIDTH: z.coerce.number().int().positive().default(512),
  COMFYUI_DEFAULT_HEIGHT: z.coerce.number().int().positive().default(512),
  // Hybrid image-intent gate: regex prefilter → fast-brain confirm (fallback: regex).
  REMI_IMAGE_INTENT_LLM_ENABLED: booleanString("1"),
  REMI_IMAGE_INTENT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  // Step 1.5: dedicated Qwen scene-prompt writer (separate from intent classify).
  REMI_IMAGE_PROMPT_LLM_ENABLED: booleanString("1"),
  REMI_IMAGE_PROMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(18000),
  REMI_IMAGE_PROMPT_MAX_TOKENS: z.coerce.number().int().positive().default(1024),
  REMI_IMAGE_PROMPT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.55),
  // Locked ComfyUI style tags for Remi/character images unless user restyles or 扮演换风.
  REMI_IMAGE_CHARACTER_STYLE: z
    .string()
    .default(
      "photorealistic, cinematic lighting, 8k raw photo, detailed skin texture",
    ),

  // ── Adult / NSFW mode (off by default; toggled per-session via chat) ───────
  // Master switch — when off, the "开启成人模式" chat command is a no-op.
  REMI_NSFW_ENABLED: booleanString("0"),
  // Opt-in: pass function-calling tools to the LLM. Off by default — the
  // current local uncensored model doesn't reliably call tools under the
  // Remi persona prompt. Enable when a tool-compliant model is configured.
  REMI_TOOL_USE_ENABLED: booleanString("0"),
  // Optional ComfyUI overrides used only while a session is in NSFW mode.
  // Empty → fall back to the regular COMFYUI_CHECKPOINT / COMFYUI_DEFAULT_NEGATIVE.
  COMFYUI_NSFW_CHECKPOINT: z.string().default(""),
  COMFYUI_NSFW_NEGATIVE: z.string().default(""),

  // ── ComfyUI video generation (storyboard runner) ──────────────────────────
  // Master switch — default off (beta). Drives the Python storyboard runner
  // (Z-Image + LTX 2.3) via shell-out from the video_generation capability.
  COMFYUI_VIDEO_ENABLED: booleanString("0"),
  COMFYUI_VIDEO_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
  // Shared output root where the runner writes per-run directories (manifest, frames, video).
  COMFYUI_SHARED_OUTPUT_DIR: z.string().default("/Users/rare/ComfyUI-Shared/output"),
  // Absolute path to the storyboard runner script. Empty = auto-discover from
  // well-known locations (/Users/rare/ComfyUI-Installs/ComfyUI/ComfyUI/tools/).
  STORYBOARD_RUNNER_PATH: z.string().default(""),
  // Python interpreter to invoke the runner with (inside its venv).
  STORYBOARD_RUNNER_PYTHON: z.string().default(""),

  // ── Vision sidecar (independent model for image understanding) ──────────
  // When enabled, Remi can "see" generated and user-sent images by calling a
  // separate vision model (e.g. MiniCPM-V, LLaVA, Qwen-VL in LM Studio).
  // The text description is injected into conversation history — the main LLM
  // stays pure-text.
  REMI_VISION_ENABLED: booleanString("0"),
  REMI_VISION_BASE_URL: z.string().default(""),
  REMI_VISION_API_KEY: z.string().default("lm-studio"),
  REMI_VISION_MODEL: z.string().default(""),
  // High detail tiles the image instead of downscaling to ~512px — required for
  // reading small / dense text (chat screenshots, documents). Slower but accurate.
  REMI_VISION_DETAIL: z.enum(["auto", "low", "high"]).default("high"),
  // Reading dense text at high detail is slower; give it room.
  REMI_VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  REMI_VISION_MAX_TOKENS: z.coerce.number().int().positive().default(1024),

  REMI_WORKING_MEMORY_ENABLED: booleanString("0"),
  REMI_EPISODE_MEMORY_ENABLED: booleanString("1"),
  REMI_EPISODE_LIFECYCLE_ENABLED: booleanString("0"),
  REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: booleanString("1"),
  REMI_RELATIONSHIP_STATE_ENABLED: booleanString("1"),
  REMI_REALTIME_CONTINUITY_HINT_ENABLED: booleanString("1"),
  REMI_PROACTIVE_PROMPT_ENABLED: booleanString("1"),
  REMI_PROACTIVE_LEDGER_ENABLED: booleanString("1"),
  REMI_PROACTIVE_COOLDOWN_TURNS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(3),
  REMI_SHARED_MOMENT_COOLDOWN_TURNS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(4),
  REMI_TOPIC_BOUNDARY_TTL_TURNS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(4),
  REMI_EPISODE_LONG_HORIZON_RANKING_ENABLED: booleanString("1"),

  // ── Embedding ───────────────────────────────────────────────────────────
  REMI_EMBEDDING_API_KEY: z.string().optional(),
  REMI_EMBEDDING_BASE_URL: z.string().optional(),
  REMI_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),

  // ── Brain ───────────────────────────────────────────────────────────────
  REMI_STRUCTURED_TURN_INTERPRETER: z
    .enum(["on", "off", "shadow"])
    .default("on"),
  REMI_TURN_INTERPRETER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(180),
  REMI_TURN_INTERPRETER_MODEL: z.string().optional(),
  REMI_THINKING_FILLER_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(520),
  REMI_THINKING_FILLER: booleanString("0"),
  REMI_TEXT_DELIBERATE_PROMPT_MEMORY_ENTRIES: z.coerce
    .number()
    .int()
    .positive()
    .default(6),
  REMI_TEXT_DELIBERATE_HISTORY_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(2200),
  REMI_TEXT_DELIBERATE_REASONING_EFFORT: z.string().default("low"),
  REMI_FAST_PATH_PROMPT_MEMORY_ENTRIES: z.coerce
    .number()
    .int()
    .positive()
    .default(4),
  // M3-P0: 默认从 1000 保守上调到 1600（"这一档"）。放大不假设 prompt cache
  // 生效；待本地栈探针确认缓存复用后再考虑继续放，不要直接拉到 8000。
  REMI_FAST_PATH_HISTORY_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(1600),
  REMI_ANALYSIS_PATH_PROMPT_MEMORY_ENTRIES: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  REMI_ANALYSIS_PATH_HISTORY_TOKENS: z.coerce
    .number()
    .int()
    .positive()
    .default(1200),
  MAX_HISTORY_TOKENS: z.coerce.number().int().positive().default(1200),
  // M3-P0: 逐字窗口上限（条数）。原为 context_orchestrator 写死的 MAX_HISTORY=10
  // （5 轮）。改成 env 可调，默认保守上调到 16（8 轮）；同样不假设缓存生效。
  REMI_MAX_HISTORY: z.coerce.number().int().positive().default(16),
  // M3-P0: 时间感开关（注入 now + 距上次间隔）。默认开；内容只进 prompt 动态
  // 尾部、缓存断点之后，绝不污染可缓存前缀。
  REMI_TIME_CONTEXT_ENABLED: booleanString("1"),

  // M3-P2: bi-temporal 长期事实层。默认开；无 DATABASE_URL 时自动降级为内存模式。
  REMI_TEMPORAL_FACTS_ENABLED: booleanString("1"),
  // M3-P2: Tier4 时序召回硬超时（ms）。超时退回 Tier0–3，不卡出话。
  REMI_TEMPORAL_RECALL_TIMEOUT_MS: z.coerce.number().int().positive().default(200),

  // ── Memory ──────────────────────────────────────────────────────────────
  MAX_PROMPT_MEMORY_ENTRIES: z.coerce.number().int().positive().default(5),
  MAX_PROMPT_MEMORY_VALUE_CHARS: z.coerce.number().int().positive().default(40),
  MAX_PRIORITY_CONTEXT_CHARS: z.coerce.number().int().positive().default(500),
  REMI_EPISODE_STORE_PROMPT_ENABLED: booleanString("1"),
  REMI_SEMANTIC_RECALL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(300),
  REMI_PERSISTENT_MEMORY_PRELOAD_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(12),

  // ── VAD / Turn-Taking ──────────────────────────────────────────────────
  VAD_PRE_ROLL_MS: z.coerce.number().nonnegative().default(480),
  VAD_UTTERANCE_GAP_MS: z.coerce.number().nonnegative().default(180),
  VAD_MIN_UTTERANCE_MS: z.coerce.number().nonnegative().default(220),
  VAD_UTTERANCE_GAP_ADAPTIVE: booleanString("1"),
  VAD_UTTERANCE_GAP_MIN_MS: z.coerce.number().nonnegative().default(120),
  VAD_UTTERANCE_GAP_MAX_MS: z.coerce.number().nonnegative().default(320),
  VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS: z.coerce
    .number()
    .nonnegative()
    .default(400),
  VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS: z.coerce
    .number()
    .nonnegative()
    .default(4400),
  VAD_UTTERANCE_GAP_HESITATION_MS: z.coerce.number().nonnegative().default(980),
  VAD_UTTERANCE_GAP_PREVIEW_HOLD_MS: z.coerce
    .number()
    .nonnegative()
    .default(140),
  VAD_UTTERANCE_GAP_PREVIEW_RELEASE_MS: z.coerce
    .number()
    .nonnegative()
    .default(60),
  VAD_UTTERANCE_GAP_PREVIEW_MIN_MS: z.coerce.number().nonnegative().default(80),
  VAD_UTTERANCE_GAP_PREVIEW_MAX_MS: z.coerce
    .number()
    .nonnegative()
    .default(520),
  TURN_TAKING_STAGE2_ENABLED: booleanString("1"),
  TURN_TAKING_GROWTH_HOLD_MS: z.coerce.number().nonnegative().default(720),
  TURN_TAKING_LIKELY_STABLE_MS: z.coerce.number().nonnegative().default(680),
  TURN_TAKING_CONFIRMED_STABLE_MS: z.coerce
    .number()
    .nonnegative()
    .default(1100),
  TURN_PROSODY_ENABLED: booleanString("1"),
  DUPLEX_INTERRUPT_MIN_SPEECH_MS: z.coerce.number().nonnegative().default(260),
  DUPLEX_FALLBACK_INTERRUPT_MIN_SPEECH_MS: z.coerce
    .number()
    .nonnegative()
    .default(320),
  DUPLEX_FALLBACK_INTERRUPT_MIN_RMS: z.coerce
    .number()
    .nonnegative()
    .default(0.045),
  DUPLEX_FALLBACK_INTERRUPT_MIN_STRONG_RATIO: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.22),
  DUPLEX_FALLBACK_INTERRUPT_MIN_PREVIEW_CHARS: z.coerce
    .number()
    .nonnegative()
    .default(3),
  DUPLEX_ASSISTANT_NO_PREVIEW_INTERRUPT_MIN_SPEECH_MS: z.coerce
    .number()
    .nonnegative()
    .default(900),
  DUPLEX_IDLE_GUARD_AFTER_MS: z.coerce.number().nonnegative().default(8000),
  DUPLEX_IDLE_GUARD_MEANINGFUL_PREVIEW_CHARS: z.coerce
    .number()
    .nonnegative()
    .default(3),
  DUPLEX_IDLE_GUARD_MIN_SPEECH_MS: z.coerce.number().nonnegative().default(480),
  DUPLEX_IDLE_GUARD_MIN_RMS: z.coerce.number().nonnegative().default(0.045),
  DUPLEX_IDLE_GUARD_MIN_STRONG_RATIO: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.22),
  DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_SPEECH_MS: z.coerce
    .number()
    .nonnegative()
    .default(900),
  DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_RMS: z.coerce
    .number()
    .nonnegative()
    .default(0.06),
  DUPLEX_IDLE_GUARD_NO_PREVIEW_MIN_STRONG_RATIO: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.38),

  // ── VAD Detector (optional — VadDetector constructor provides final defaults) ──
  VAD_THRESHOLD: z.coerce.number().nonnegative().optional(),
  VAD_MIN_SPEECH_FRAMES: z.coerce.number().nonnegative().optional(),
  VAD_SILENCE_FRAMES: z.coerce.number().nonnegative().optional(),
  VAD_SPEAKING_SILENCE_FRAMES: z.coerce.number().nonnegative().optional(),
  VAD_CONTINUE_ENERGY_RATIO: z.coerce.number().nonnegative().optional(),
  VAD_MAX_ZCR: z.coerce.number().nonnegative().optional(),
  VAD_CONTINUE_MAX_ZCR: z.coerce.number().nonnegative().optional(),
  VAD_MAX_CREST: z.coerce.number().nonnegative().optional(),
  VAD_CONTINUE_MAX_CREST: z.coerce.number().nonnegative().optional(),
  VAD_FALLBACK_ENERGY_THRESHOLD: z.coerce.number().nonnegative().optional(),
  VAD_FALLBACK_MIN_SPEECH_FRAMES: z.coerce.number().nonnegative().optional(),
  VAD_MIN_ACTIVE_RATIO: z.coerce.number().min(0).max(1).optional(),
  VAD_CONTINUE_MIN_ACTIVE_RATIO: z.coerce.number().min(0).max(1).optional(),
  VAD_FALLBACK_MIN_ACTIVE_RATIO: z.coerce.number().min(0).max(1).optional(),

  // ── VAD Fallback Noise Suppression ─────────────────────────────────────
  VAD_FALLBACK_NO_PREVIEW_SUPPRESS_MS: z.coerce
    .number()
    .nonnegative()
    .default(900),
  VAD_FALLBACK_NO_PREVIEW_MIN_RMS: z.coerce
    .number()
    .nonnegative()
    .default(0.035),
  VAD_FALLBACK_NO_PREVIEW_TINY_TEXT_MAX_CHARS: z.coerce
    .number()
    .nonnegative()
    .default(1),
  VAD_FALLBACK_NO_PREVIEW_SHORT_TEXT_MAX_CHARS: z.coerce
    .number()
    .nonnegative()
    .default(5),
  VAD_FALLBACK_STRONG_FRAME_RMS: z.coerce.number().nonnegative().default(35),
  VAD_FALLBACK_STRONG_FRAME_PEAK: z.coerce.number().nonnegative().default(120),
  VAD_FALLBACK_MIN_STRONG_FRAMES: z.coerce.number().nonnegative().default(2),
  VAD_FALLBACK_MIN_STRONG_RATIO: z.coerce.number().min(0).max(1).default(0.08),
  VAD_FALLBACK_WEAK_SPEECH_SUPPRESS_MS: z.coerce
    .number()
    .nonnegative()
    .default(1600),
  VAD_STRICT_CANDIDATE_MIN_SPEECH_MS: z.coerce
    .number()
    .nonnegative()
    .default(520),
  VAD_STRICT_CANDIDATE_MIN_STRONG_FRAMES: z.coerce
    .number()
    .nonnegative()
    .default(8),
  VAD_STRICT_CANDIDATE_MIN_STRONG_RATIO: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0.22),
  VAD_SUPPRESSED_NOISE_COOLDOWN_MS: z.coerce
    .number()
    .nonnegative()
    .default(420),
  VAD_SUPPRESSED_NOISE_BYPASS_RMS: z.coerce.number().nonnegative().default(40),
  VAD_SUPPRESSED_NOISE_BYPASS_PEAK: z.coerce.number().nonnegative().default(90),

  // ── STT Preview ────────────────────────────────────────────────────────
  STT_PREVIEW_INTERVAL_MS: z.coerce.number().nonnegative().default(650),
  STT_PREVIEW_DEBOUNCE_MS: z.coerce.number().nonnegative().default(180),
  STT_PREVIEW_MIN_SPEECH_MS: z.coerce.number().nonnegative().default(550),
  STT_PREVIEW_WINDOW_MS: z.coerce.number().nonnegative().default(4200),
  STT_PREVIEW_SETTLE_MS: z.coerce.number().nonnegative().default(260),

  // ── STT Prediction ─────────────────────────────────────────────────────
  REMI_STT_FINAL_DISAMBIG_ENABLED: booleanString("1"),
  STT_PARTIAL_PREDICTION_ENABLED: booleanString("0"),
  STT_PREDICTION_PUSH_ENABLED: booleanString("0"),
  STT_PREDICTION_DEBOUNCE_MS: z.coerce.number().nonnegative().default(300),

  // ── Voice ───────────────────────────────────────────────────────────────
  VOICE_BACKCHANNEL_ENABLED: booleanString("1"),
  VOICE_BACKCHANNEL_COOLDOWN_MS: z.coerce.number().nonnegative().default(6000),
  VOICE_BACKCHANNEL_STABLE_MS: z.coerce.number().nonnegative().default(1100),

  // ── iOS ─────────────────────────────────────────────────────────────────
  REMI_IOS_DUPLEX_INPUT_GAIN: z.coerce.number().min(1).max(12).default(6),

  // ── Dev ─────────────────────────────────────────────────────────────────
  REMI_DEV_PRESETS_ENABLED: booleanString("0"),
  REMI_PROACTIVE_PLANNER_MAIN_PATH_ENABLED: booleanString("1"),
});

export type RemiEnv = z.infer<typeof envSchema>;

/**
 * Legacy env var name → new name mapping.
 * Old names still work but log a deprecation warning.
 */
const LEGACY_ALIASES: Record<string, string> = {
  key: "REMI_LLM_API_KEY",
  base_url: "REMI_LLM_BASE_URL",
  model: "REMI_LLM_MODEL",
  tts_provider: "REMI_TTS_PROVIDER",
  tts_voice: "REMI_TTS_VOICE",
  stt_provider: "REMI_STT_PROVIDER",
  stt_key: "REMI_STT_API_KEY",
  stt_base_url: "REMI_STT_BASE_URL",
  JWT_SECRET: "REMI_AUTH_JWT_SECRET",
  PORT: "REMI_PORT",
  LOG_LEVEL: "REMI_LOG_LEVEL",
  whisper_model: "REMI_STT_WHISPER_MODEL",
  REM_LOCAL_LLM_ENABLED: "REMI_LOCAL_LLM_ENABLED",
  rem_thinking_filler: "REMI_THINKING_FILLER",
  rem_tts_stream: "REMI_TTS_STREAM",
  REM_FAST_BRAIN_REASONING_EFFORT: "REMI_FAST_BRAIN_REASONING_EFFORT",
  REM_FAST_BRAIN_MODEL: "REMI_FAST_BRAIN_MODEL",
  REM_EMBEDDING_API_KEY: "REMI_EMBEDDING_API_KEY",
  REM_EMBEDDING_BASE_URL: "REMI_EMBEDDING_BASE_URL",
  REM_EMBEDDING_MODEL: "REMI_EMBEDDING_MODEL",
  EMBEDDING_API_KEY: "REMI_EMBEDDING_API_KEY",
  EMBEDDING_BASE_URL: "REMI_EMBEDDING_BASE_URL",
  EMBEDDING_MODEL: "REMI_EMBEDDING_MODEL",
  volc_tts_voice_type: "VOLC_TTS_VOICE_TYPE",
  volc_tts_resource_id: "VOLC_TTS_RESOURCE_ID",
};

function applyLegacyAliases(env: NodeJS.ProcessEnv): void {
  const warnings: string[] = [];
  for (const [oldName, newName] of Object.entries(LEGACY_ALIASES)) {
    if (env[oldName] && !env[newName]) {
      env[newName] = env[oldName];
      warnings.push(`  ${oldName} → ${newName}`);
    }
  }
  if (warnings.length > 0) {
    console.warn(
      `[remi:config] Deprecated env vars detected (still work, will be removed in future):\n${warnings.join("\n")}`,
    );
  }
}

/**
 * Validate all environment variables at startup.
 * Throws with a clear message listing all invalid/missing vars.
 */
const MODEL_DEFAULTS_BY_HOST: Record<string, string> = {
  "api.openai.com": "gpt-4o-mini",
  "dashscope.aliyuncs.com": "qwen-plus",
  "api.deepseek.com": "deepseek-chat",
};

const SCHEMA_DEFAULT_MODEL = "qwen2.5-14b-instruct";

function inferModelFromBaseUrl(config: RemiEnv): RemiEnv {
  if (config.REMI_LLM_MODEL !== SCHEMA_DEFAULT_MODEL) return config;
  const userExplicitlySet = process.env.REMI_LLM_MODEL || process.env.model;
  if (userExplicitlySet) return config;
  const url = config.REMI_LLM_BASE_URL;
  for (const [host, model] of Object.entries(MODEL_DEFAULTS_BY_HOST)) {
    if (url.includes(host)) {
      console.log(`[remi:config] Auto-detected LLM model: ${model} (from ${host})`);
      return { ...config, REMI_LLM_MODEL: model };
    }
  }
  return config;
}

export function validateEnv(): RemiEnv {
  applyLegacyAliases(process.env);
  // Layer the in-app settings overlay on top of .env so the settings page wins
  // and hot-applies (POST /api/settings → saveOverlay → resetConfig).
  applyOverlayToEnv(process.env);

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  ${issue.path.join(".")}: ${issue.message}`,
    );
    const msg = `[remi:config] Environment validation failed:\n${issues.join("\n")}\n\nSee .env.localhost.example (dev) or .env.local-prod.example (prod).`;
    throw new Error(msg);
  }

  const config = inferModelFromBaseUrl(result.data);
  warnLlmModelChoice(config.REMI_LLM_MODEL, config.REMI_FAST_BRAIN_MODEL);
  return config;
}
