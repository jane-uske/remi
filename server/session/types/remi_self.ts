// ── DL-P0-2 RemiSelf 接口草稿（契约层，// TODO: implement）─────────
// Remi 的持续性自我主体：跨所有会话 / 设备保持同一规范状态，无客户端连接时
// 以确定性时间推断继续演进（零 LLM token）。设计见
// docs/design/DIGITAL_LIFE_NORTH_STAR.md §1。
//
// 本文件是【契约草稿】，当前不被运行时 import。落地见 DL-P1b（最小持久化）。
// 单一真相：同一用户只一份；写回时机 = disconnect fire-and-forget；
// 不阻塞 fast path（异步加载、PersonaLiveState 先走、加载完 soft-patch）。

/**
 * 心情向量（契约理想形态）。
 * ⚠️ 落地差异：当前 `persona/index.ts` 的 `PersonaLiveState.mood` 是 string
 * 标签（平静 / 开心 / 委屈 / 好奇 / 低落）。DL-P1b 实现时二选一：升级为向量，
 * 或把本类型降为 string 别名 —— `label` 字段预留以衔接现状。
 */
export interface MoodVector {
  valence: number;    // 效价 -1..1（消极 → 积极）
  arousal: number;    // 唤起 0..1（平静 → 激动）
  label?: string;     // 可选人类可读标签，衔接现有 string mood
}

/**
 * 她"在" RemiWorld 里的位置 / 活动。null = world 功能未激活。
 * ⚠️ 现状：世界状态在 `web/src/lib/world` 的 localStorage（WorldSave），服务端
 * 暂无此类型。DL-P2 把世界状态迁到服务端 `RemiSelf.worldPresence` 时落地，
 * 届时与 REMIWORLD 接口对齐（两张北极星的接缝点）。
 */
export interface WorldPresenceState {
  activity: string | null;   // 正在做的事（如 "在看书"）
  location: string | null;   // 所在位置（如 "书架前"）
  updatedAt: Date;
}

/**
 * 持续性自我主体。同一用户只存在一份，任何设备 / 客户端读同一份。
 * 离线时不冻结，按已离线时长向 neutral 确定性漂移（规则表见 NORTH_STAR §1），
 * 漂移在下次会话启动时 lazy 计算（无需 cron）。
 */
export interface RemiSelf {
  // ── 当下状态 ──
  mood: MoodVector;             // 当前情绪（从 PersonaLiveState 持久化来）
  energy: number;               // 0–1 精力水位（影响主动性 / 语调）
  currentFocus: string | null;  // 正在想什么 / 挂念什么
  topicPull: string[];          // 被哪些话题吸引（近期高频 / 高情感）
  //                               ⚠️ 现状 PersonaLiveState.topicPull 是单个 string

  // ── 时间轴 ──
  lastSeenAt: Date;             // 上次有客户端连接的时刻
  lastSavedAt: Date;            // 上次持久化到 DB 的时刻

  // ── 空间存在 ──
  worldPresence: WorldPresenceState | null;
}

// TODO(DL-P1b): implement —— mood / energy / currentFocus 在 disconnect 写入
// DB、session 启动读回并注入 PersonaLiveState；离线漂移在 bootstrap 计算。
// 前提：W-PRES-01 默认人格稳定已验收（NORTH_STAR 原则一）。
