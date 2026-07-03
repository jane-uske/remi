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
  // 首音看门狗（VOICE_BEST_PRACTICES 杠杆2）：首句流式 TTS 若在该毫秒数内仍未吐出
  // 第一个 PCM chunk（Edge MP3→PCM 首包 stall 等），放弃流式、回退 buffered 合成，
  // 给 llm_first→tts_first 的 p95 设上界。0 = 关闭（默认，happy path 完全不变）。
  REMI_TTS_FIRST_AUDIO_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(0),

  // ── STT ──────────────────────────────────────────────────────────────────
  REMI_STT_PROVIDER: z
    .enum(["openai", "whisper-cpp", "sherpa", "sense-voice"])
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
  REMI_STT_INCREMENTAL_PROVIDER: z.string().optional(),
  // ── Turn detector shadow (PR5) ────────────────────────────────────────────
  REMI_TURN_DETECTOR_SHADOW: booleanString("0"),
  REMI_TURN_DETECTOR_SHADOW_PROVIDER: z
    .enum(["pipecat_smartturn", "livekit_v1mini", "stub"])
    .default("stub"),
  // PR5b: real (async) turn-detector sidecar endpoint. When unset or the
  // sidecar is unreachable, the shadow gracefully falls back to legacy only.
  REMI_TURN_DETECTOR_ENDPOINT: z.string().optional(),
  REMI_TURN_DETECTOR_TIMEOUT_MS: z.coerce.number().int().positive().default(150),
  // End-of-turn probability threshold for mapping the real model output to a
  // CONFIRMED_END state in shadow comparison. Tuning knob for the eval harness;
  // does NOT affect any live behavior (shadow only).
  REMI_TURN_DETECTOR_EOU_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  // PR5d: turn-detector mode. off=legacy only; shadow=log-only comparison;
  // limited_on=real EOU may adjust turn-END ONLY (never barge-in), asymmetrically:
  //   low EOU → extend patience (never cut earlier); high EOU → LIKELY_END→CONFIRMED_END.
  // When unset, derived from REMI_TURN_DETECTOR_SHADOW (1→shadow, 0→off) for back-compat.
  // limited_on requires REMI_TURN_DETECTOR_ENDPOINT + a real partial; otherwise full legacy.
  REMI_TURN_DETECTOR_MODE: z.enum(["off", "shadow", "limited_on"]).optional(),
  // EOU below this → "extend patience" band (never used to cut early).
  REMI_TURN_DETECTOR_EOU_LOW: z.coerce.number().min(0).max(1).default(0.05),
  // EOU at/above this → allowed to upgrade legacy LIKELY_END → CONFIRMED_END.
  REMI_TURN_DETECTOR_EOU_HIGH: z.coerce.number().min(0).max(1).default(0.6),
  // Safety cap: max extra hold (ms past confirmedStableMs) a low-EOU downgrade
  // may add, so a persistently-low EOU can never hang the turn forever.
  REMI_TURN_DETECTOR_LOW_EOU_MAX_EXTRA_HOLD_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(700),
  // Cached EOU (computed on partial arrival) is only used if fresher than this.
  REMI_TURN_DETECTOR_EOU_CACHE_TTL_MS: z.coerce.number().int().positive().default(1500),
  whisper_model: z.string().optional(),
  whisper_prompt: z.string().optional(),
  whisper_lang: z.string().optional(),
  whisper_use_server: booleanString("0"),
  whisper_server_autostart: booleanString("0"),
  whisper_server_url: z.string().optional(),
  // ── SenseVoice (in-process offline STT + emotion/event via sherpa-onnx) ──
  STT_SENSEVOICE_MODEL_DIR: z.string().optional(),
  STT_SENSEVOICE_MODEL: z.string().optional(),
  STT_SENSEVOICE_TOKENS: z.string().optional(),
  STT_SENSEVOICE_LANGUAGE: z.string().optional(),
  STT_SENSEVOICE_USE_ITN: z.string().optional(),
  STT_SENSEVOICE_NUM_THREADS: z.string().optional(),
  STT_SENSEVOICE_DEBUG: z.string().optional(),
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
  REMI_SEED_INVITE_CODES: z.string().optional(),
  REMI_GUEST_MESSAGE_CAP: z.coerce.number().int().positive().default(15),
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

  // ── Persona Pack（角色卡 · flag 默认关，零回归）─────────────────────────
  // On 时人格从 personas/<id>/{IDENTITY,SOUL,EXAMPLES}.md + persona.json 编译，
  // 经 L0 平台护栏夹层组装；Off 或加载失败时回退内建 buildPersonaPrompt 路径。
  REMI_PERSONA_PACK_ENABLED: booleanString("0"),
  // 默认加载哪张角色卡（personas/<id>）。设为 nami 即切到娜美人格。
  REMI_DEFAULT_PERSONA_PACK: z.string().default("remi"),
  // 可选：覆盖 personas 根目录（默认 <cwd>/personas）。
  REMI_PERSONA_PACK_DIR: z.string().optional(),
  // 慢脑瘦身（角色卡 M5 减法续）：把慢脑从「指令生成器」降为「事实提供者」。
  // On 时快脑 prompt 只吃慢脑的【事实】（记忆 / 关系阶段 / 未完主线 topicPull /
  // 对话摘要…），砍掉「本轮该怎么回复」的指令块——语气合同 toneContract、回复合同
  // responseShape、响应策略 responsePolicy、主动提起 proactivePosture——人格与风格
  // 全交给 pack + few-shot，消除 guidance 与 pack 重复 / 打架。截断点在
  // brain/prompt_builder.ts 的注入边界。默认关、flag-off 逐字节零回归；保留慢脑的
  // 记忆 / 关系异步提取，只削 guidance 注入。设计上与 REMI_PERSONA_PACK_ENABLED 配套。
  REMI_LEAN_SLOW_GUIDANCE: booleanString("0"),

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
  // Project Memory Layer: long-term structured memory of what the user is
  // building (north star / current focus / decisions / next steps / working
  // style). Gated recall injection + off-hot-path slow-brain extraction.
  REMI_PROJECT_MEMORY_ENABLED: booleanString("1"),
  // DL-P1b RemiSelf 最小持久化 + 离线演进：让 Remi 成为跨会话/跨设备持续存在
  // 的同一个她。关掉隔几小时/隔天回来 → mood/energy 已合理漂移（非冻结非清
  // 零），开口体现"我还在、还记着上次"。默认 OFF —— flag off 时 load/save/
  // inject 全短路，行为与现状逐字节一致。设计见
  // docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。
  REMI_SELF_PERSISTENCE_ENABLED: booleanString("0"),
  // 离线居家人生 + 归来叙事：Remi 离线时在 RemiWorld 过自己的确定性居家日程
  // （看书/看海/打理花/听音乐/发呆），回来时用 [lastSeenAt, now] 窗口确定性复算
  // 这段经历，被动注入"事实锚"——用户先开口问起时她能自然带出真实经历，零编造
  // （beat 措辞全来自确定性查表，封闭白名单）。
  // 前置依赖 REMI_SELF_PERSISTENCE_ENABLED=1：lastSeenAt 是唯一来源，两 flag 都
  // on 才生效。默认 OFF —— flag off 时 anchor 恒 null，行为与现状逐字节一致。
  // 设计见 docs/design/DIGITAL_LIFE_NORTH_STAR.md。
  REMI_OFFLINE_LIFE_ENABLED: booleanString("0"),
  REMI_EPISODE_LIFECYCLE_ENABLED: booleanString("0"),
  REMI_RELATIONSHIP_STYLE_GUIDANCE_ENABLED: booleanString("1"),
  REMI_RELATIONSHIP_STATE_ENABLED: booleanString("1"),
  // 关系状态周期性保存：过去只在会话优雅销毁（WS 正常断连 / SSE pool 30min TTL
  // 回收）时写回 persistRelationshipContinuityState，docker restart / 进程被杀
  // 时会跳过，丢失最近一段对话积累的关系演进。开启后每 N 轮用户消息
  // （REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS）额外异步写回一次，不阻塞 fast
  // path。默认 ON——纯增量加固，off 时行为与现状逐字节一致。
  REMI_RELATIONSHIP_PERIODIC_SAVE_ENABLED: booleanString("1"),
  REMI_RELATIONSHIP_PERIODIC_SAVE_TURNS: z.coerce
    .number()
    .int()
    .positive()
    .default(8),
  // 开场主动语：会话 bootstrap（含 RemiSelf 恢复）完成后，若 RemiSelf.lastSeenAt
  // 距今 >30 分钟且本会话尚未发过开场语，主动生成一句"她先开口"的问候（走 silence
  // nudge 同款 systemTriggered 生成+推送路径）。每会话最多一次；触发前会检查最近
  // 5 分钟内用户没有已发消息，避免抢话；NSFW 模式跳过。默认 ON——前置依赖
  // REMI_SELF_PERSISTENCE_ENABLED=1（lastSeenAt 唯一来源），该 flag off 时无
  // lastSeenAt 可比对，本特性自然不触发。
  REMI_GREETING_OPENER_ENABLED: booleanString("1"),
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
  // 回复出口时间守卫（2026-07 生产实锤止血）：句子发出前用纯规则校验星期/时段
  // 断言是否与当下矛盾（utils/reply_time_guard.ts）。off=不校验；detect=只记
  // WARN 日志不拦截；drop=违规句丢弃不发送/不持久化（兜底：整条回复全被丢时
  // 放行原文，只记日志，不能让她哑巴）。默认 drop——这是刚破的生产案的构造性
  // 防御，不是可选项。
  REMI_REPLY_TIME_GUARD: z.enum(["off", "detect", "drop"]).default("drop"),
  // 用户时区取不到时（无 client_context、SSE 未传 timeZone）的兜底时区。
  REMI_TZ: z.string().default("Asia/Shanghai"),
  // 打断 carry-forward V2（VOICE_BEST_PRACTICES 杠杆3）：更丰富的承接行为
  // ——mid-reply 提问先答再问、切话题先挂起旧线、情绪打断留可续上下文。
  // 默认关闭，开启时只改 carry-forward 提示文本，不改打断判定与 fast path。
  REMI_CARRY_FORWARD_V2: booleanString("0"),
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
  // 历史时段断层标记：跨会话 bootstrap 加载的历史若最后一轮距今 >3h（同
  // describeGap 阈值），在动态尾部追加提示，避免模型把历史里的旧状态/旧时间词
  // 当成当下（2026-07 生产坏样本：历史里的"肚子疼/周一"被当日照读）。默认开；
  // 同样只进 prompt 动态尾部，绝不污染可缓存前缀。
  REMI_HISTORY_GAP_MARKER_ENABLED: booleanString("1"),

  // M3-P2: bi-temporal 长期事实层。默认开；无 DATABASE_URL 时自动降级为内存模式。
  REMI_TEMPORAL_FACTS_ENABLED: booleanString("1"),
  // M3-P2: Tier4 时序召回硬超时（ms）。超时退回 Tier0–3，不卡出话。
  REMI_TEMPORAL_RECALL_TIMEOUT_MS: z.coerce.number().int().positive().default(200),

  // CIO-P1: 上下文意图 shadow 分类器。默认开；只写 debug 日志，不改行为。
  REMI_CIO_SHADOW_ENABLED: booleanString("1"),
  // CIO-P3: 编排器 wired 模式——intent 驱动看图/生图消歧。默认关，灰度开。
  REMI_CIO_WIRED_ENABLED: booleanString("0"),

  // M3-P3a: 主动搭话仲裁门控
  REMI_PROACTIVE_QUIET_HOURS_START: z.coerce.number().int().min(0).max(23).default(23),
  REMI_PROACTIVE_QUIET_HOURS_END: z.coerce.number().int().min(0).max(23).default(7),
  REMI_PROACTIVE_POST_CONVERSATION_COOLDOWN_MS: z.coerce.number().int().min(0).default(300000),

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
  VAD_MIN_UTTERANCE_MS: z.coerce.number().nonnegative().default(150),
  VAD_UTTERANCE_GAP_ADAPTIVE: booleanString("1"),
  VAD_UTTERANCE_GAP_MIN_MS: z.coerce.number().nonnegative().default(120),
  VAD_UTTERANCE_GAP_MAX_MS: z.coerce.number().nonnegative().default(200),
  VAD_UTTERANCE_GAP_ADAPTIVE_LO_MS: z.coerce
    .number()
    .nonnegative()
    .default(400),
  VAD_UTTERANCE_GAP_ADAPTIVE_HI_MS: z.coerce
    .number()
    .nonnegative()
    .default(4400),
  VAD_UTTERANCE_GAP_HESITATION_MS: z.coerce.number().nonnegative().default(480),
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
  // 预热召回（VOICE_BEST_PRACTICES 杠杆1）：复用 partial 预测时已跑的记忆召回，
  // 即使回复预测未命中，也把召回从 stt_final→llm_first 关键路径上拿掉（压 pre_llm_overhead）。
  // 依赖 partial 预测先跑（STT_PARTIAL_PREDICTION_ENABLED）。默认关闭。
  REMI_WARM_RECALL_ENABLED: booleanString("0"),
  // 预热召回新鲜度上限（毫秒）：超过则真实轮回落到实时召回。
  REMI_WARM_RECALL_TTL_MS: z.coerce.number().int().nonnegative().default(8000),

  // ── Voice ───────────────────────────────────────────────────────────────
  // Swappable realtime voice shell (docs/voice/VOICE_NATIVE_MODE.md §6/§7).
  // Free-form string (NOT a strict enum) so an unknown value degrades to legacy
  // at resolve time instead of crashing startup. Today: legacy | realtime_shadow.
  REMI_VOICE_ENGINE: z.string().default("legacy"),
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
