/**
 * Persona Pack —— 角色卡。一个 pack = 一张可插拔的人格卡：
 *   personas/<id>/
 *     persona.json   ← 结构化元数据（程序读：声音/形象/开关/记忆范围）
 *     IDENTITY.md    ← 她是谁、怎么说话
 *     SOUL.md        ← 内核怎么待你
 *     EXAMPLES.md    ← few-shot 对话范例（可选）
 *     CANON.md       ← 生活事实库（可选）：住处/日常/在读的书这类可被引用、
 *                        可被追问细节，但不会无中生有的具体人生事实。
 *
 * 设计取舍见 docs/design/PERSONA_PACK.md。M1 只落地文字层 + 元数据解析；
 * voice/avatar/allowNsfw/memoryScope 字段先解析存下，由后续里程碑接入。
 */

export type PersonaAvatarKind = "live2d" | "vrm" | "portrait";

/** persona.json 的结构化字段（非自由文本，给程序读）。 */
export interface PersonaPackManifest {
  /** 目录名 / 稳定 id（运行时切换、记忆隔离键都用它）。 */
  id: string;
  /** 角色名（进 prompt 的身份）。 */
  name: string;
  /** UI 展示名，缺省回退到 name。 */
  displayName?: string;
  version?: number;
  author?: string;
  /** TTS 声音（M3 接入 voice/tts 路由）。 */
  voice?: {
    provider?: string;
    voiceId?: string;
    /** MLX TTS：随 pack 走的音色 instruct，覆盖全局 REMI_TTS_MLX_INSTRUCT。 */
    mlxInstruct?: string;
    /** MLX TTS：随 pack 走的 speaker，覆盖全局 REMI_TTS_MLX_SPEAKER。 */
    mlxSpeaker?: string;
  };
  /** 形象（M3 接入前端 CharacterStage）。 */
  avatar?: {
    kind?: PersonaAvatarKind;
    modelId?: string;
    url?: string;
  };
  /**
   * 是否允许成人内容。平台年龄门控与此取交集（M5）；pack 单方声明放开无效。
   */
  allowNsfw?: boolean;
  /**
   * 记忆隔离范围（M4）：
   *  - per_pack：记忆/历史按 (user, pack) 隔离，角色之间不串台（默认）
   *  - shared：跨 pack 共享该用户记忆
   */
  memoryScope?: "per_pack" | "shared";
}

/** 加载并校验后的 persona pack（文字层 + 元数据）。 */
export interface PersonaPack {
  manifest: PersonaPackManifest;
  /** IDENTITY.md 正文（已 trim、已过长度预算）。 */
  identity: string;
  /** SOUL.md 正文。 */
  soul: string;
  /** EXAMPLES.md 正文，可能为空字符串（pack 未提供 few-shot）。 */
  examples: string;
  /**
   * CANON.md 正文，可能为空字符串（pack 未提供生活事实库——如 nami，行为不变）。
   * 放在 IDENTITY/SOUL/EXAMPLES 之后、compose 的系统重申层之前。
   */
  canon: string;
}

/** 加载器对每段 md 的字符预算，防止一个超大 pack 把 L0 挤出注意力窗口。 */
export interface PersonaPackBudget {
  identity: number;
  soul: number;
  examples: number;
  /** 可选：未提供时退回 DEFAULT_PERSONA_PACK_BUDGET.canon（兼容旧的自定义 budget 字面量）。 */
  canon?: number;
}

export const DEFAULT_PERSONA_PACK_BUDGET: PersonaPackBudget = {
  identity: 1800,
  soul: 1400,
  examples: 2000,
  canon: 1600,
};

/** 默认 pack id —— personas/remi。 */
export const DEFAULT_PERSONA_PACK_ID = "remi";
