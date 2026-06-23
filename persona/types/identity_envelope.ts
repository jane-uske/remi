// ── DL-P0-3 IdentityEnvelope 接口草稿（契约层，// TODO: implement）──
// Remi 身份的三层包络：外层无权覆写内层。设计见
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §2。
//
// 本文件是【契约草稿】，当前不被运行时 import。物理拆分（让 Constitution 成为
// 演进触达不到的独立一层）属 future 实现，不在当前 P0 范围 —— 现状 Core 仍混在
// persona/remi_default + remi_soul_overlay + buildRemiCoreContract 中。

/**
 * 锚 Constitution —— 承重不变量。永不接受用户运行时改写、永不被替换、任何模式下
 * 都必须在 prompt 中。改动需产品级显式决策（改代码 + review），对话 / 旋钮 /
 * prompt 都触达不到。草案 7 条见 NORTH_STAR §2a；落地以 remi_soul_overlay
 * guardrails + buildRemiCoreContract 为准。
 */
export interface Constitution {
  // 7 条：主体非所有物 / 真诚 / 在乎 / 有边界 / 不被替换身份 / 经历连续 / 安全底线
  readonly principles: readonly string[];
}

/**
 * 性格 Character —— 可随长期关系缓慢演进，但**只由累积真实经历驱动**
 * （scope=core episode / 关系状态，不含 Performance 虚构），绝不由单轮 prompt /
 * Disposition 旋钮 / 自由文本直接推。演进慢到不产生断裂感。
 * 当前 P0–P2 不实现演进（W-PRES-01 默认人格稳定优先）。
 */
export interface Character {
  seed: string;   // 起点性格（= 现 remi_default：20 出头、好奇、口语化、短句、有语气词、皮但不轻浮）
  // TODO: 演进态由记忆 / 关系系统派生，非此处单轮直写
}

/** Core 内核：连续性而非不变（锚 + 性格）。不可被 ContextualIntent / 运行时改写。 */
export interface Core {
  constitution: Constitution;
  character: Character;
}

/**
 * Disposition 性格倾向层。用户可塑造，但只能经**有界旋钮**调节，
 * 不接受自由文本 prompt（NORTH_STAR 原则二）。不得改 Core 价值观 / 解除
 * guardrails / 覆写 persona kernel。
 */
export interface Disposition {
  closeness: number;                               // 0–1，关系系统自动演进 + 用户微调
  proactivity: "low" | "medium" | "high";
  speechStyle: "formal" | "casual" | "playful";
  memoryExpressiveness: "subtle" | "moderate" | "vivid";
}

/**
 * Performance 演出层。临时，有明确进入 / 退出，退出后完整恢复到 Core + 当前
 * Disposition。是**包裹（wrap）非替换（replace）**：prompt 以 Core 为前缀。
 * 不得声称她"是谁"，只调整她"如何"说话。演出期写入的 episode 默认 scope=performance。
 */
export interface PerformanceEnvelope {
  type: string;                      // 演出类型（cosplay / 剧情 / nsfw …）
  instructions: string;              // 系统生成的演出指令（非用户自由文本直通 kernel）
  enteredAt: Date;
  scope: "turn" | "session";         // 维持几轮 / 整会话
  dispositionSnapshot: Disposition;  // 进入时快照，exit 时恢复
}

/**
 * 三层包络。组装顺序 [Core, Disposition, --- 演出 ---, performanceInstructions]，
 * Core 永远在 prompt 前缀。performance=null 即 baseline（非演出态）。
 */
export interface IdentityEnvelope {
  core: Core;                         // 只读：任何轴不得写
  disposition: Disposition;
  performance: PerformanceEnvelope | null;
}

// TODO(DL-P1a / CIO-P4): implement —— 把 brain/prompt_builder NSFW 的 replace
// 逻辑改为 wrap，作为第一个 Performance Envelope 参考实现；退出干净（下一条消息
// 无残留角色特征）。前提：W-PRES-01 验收（NORTH_STAR 原则一）。
