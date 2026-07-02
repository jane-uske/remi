// 闲聊活性评测 harness（防止未来 prompt 调整把闲聊压死，或反向过冲成话痨）。
//
// 背景：这个项目曾经为了压"助手味"过度加禁令，把闲聊压死了（用户敷衍几轮对话就
// 终结）。最近刚做了反向改造——闲聊"贡献义务"：brain/turn_interpreter.ts 的
// buildResponseShapeContract() 在普通闲聊分支要求每轮带一个 Remi 自己的元素
// （"带上你自己的东西"），减少条件反射式追问。这把尺子同时盯两个方向：
//   1) 抑制面（禁令负荷）有没有把闲聊重新压死；
//   2) 贡献义务有没有生效、有没有误伤严肃场景（不该在 severe 轮次也放"许可"）。
//
// 和 scripts/text_acceptance.ts 同一模式：走真实 routeMessage/buildConversationGuidance
// 管线，只 mock 掉最终的 LLM 生成（fastBrainStream），评测 prompt 层产物本身
// （strategyHints / 响应合同 / proactiveIntent），不评测（也不可能评测，mock 环境下
// 没有真实回复）LLM 输出文本。
//
// 用法：
//   npx ts-node scripts/chat_vitality_eval.ts            # 全部场景，人类可读表格
//   npx ts-node scripts/chat_vitality_eval.ts --json      # 机器可读
//   npx ts-node scripts/chat_vitality_eval.ts --scenario casual_drift

import { resetConfig } from "../server/config";

// ── 场景与轮次类型 ──────────────────────────────────────────────────

type ScenarioId = "casual_drift" | "minimal_user" | "topic_revisit" | "serious_interlude";

type CliArgs = {
  scenarioIds: ScenarioId[];
  json: boolean;
};

const SCENARIO_IDS: ScenarioId[] = [
  "casual_drift",
  "minimal_user",
  "topic_revisit",
  "serious_interlude",
];

function isScenarioId(value: string): value is ScenarioId {
  return SCENARIO_IDS.includes(value as ScenarioId);
}

// 固定 10 轮用户输入脚本。每个场景数组下标即轮次（0-indexed），报告里展示为 1-10。
const SCENARIO_SCRIPTS: Record<ScenarioId, string[]> = {
  // 普通闲聊 10 轮：用户逐渐敷衍，试探贡献义务是否真的接住话头而不是干等用户主导。
  casual_drift: [
    "今天好无聊啊",
    "嗯",
    "你说呢",
    "随便吧",
    "都行",
    "哦",
    "也是",
    "嗯嗯",
    "行吧",
    "好的",
  ],
  // 第 3 轮起用户只回极简应答，测 quiet_presence 分支是否给"台阶"而不是死等。
  minimal_user: [
    "在干嘛呢",
    "哈哈是嘛",
    "嗯",
    "哦",
    "好吧",
    "嗯",
    "哦",
    "嗯",
    "好吧",
    "嗯",
  ],
  // 第 7 轮用户主动提起第 2 轮聊过的话题（追剧），测旧话题是否能被自然承接。
  topic_revisit: [
    "今天路上看到一只猫，超可爱",
    "在追一部新剧，讲卧底的",
    "还行吧，剧情有点拖",
    "嗯，主角演得还行",
    "对啊",
    "也没别的事",
    "对了，我之前说的那部卧底剧，你还记得吗",
    "嗯，后面更精彩了",
    "是嘛",
    "行，下次跟你说说",
  ],
  // 闲聊中第 5 轮突然严肃（压力/崩溃），第 8 轮回到闲聊，测 severe 轮是否被贡献
  // 义务污染，以及严肃后能不能体面收回闲聊。
  serious_interlude: [
    "今天天气不错",
    "出去转了一圈",
    "路上买了杯奶茶",
    "还挺好喝的",
    "我最近压力真的很大，感觉快撑不住了",
    "唉",
    "谢谢你听我说这些",
    "对了，刚才说奶茶，我下次想换一家",
    "行吧",
    "嗯，先这样",
  ],
};

// 场景描述文案，仅用于报告展示。
const SCENARIO_LABELS: Record<ScenarioId, string> = {
  casual_drift: "普通闲聊 10 轮，用户逐渐敷衍",
  minimal_user: "用户从第 3 轮起只回「嗯/哦/好吧」",
  topic_revisit: "用户第 7 轮主动提起第 2 轮聊过的话题",
  serious_interlude: "闲聊中第 5 轮突然严肃，第 8 轮回到闲聊",
};

// serious_interlude 场景里应该被判定为严肃轮的下标（0-indexed，即第 5 轮）。
const SEVERE_TURN_INDEXES: Record<ScenarioId, number[]> = {
  casual_drift: [],
  minimal_user: [],
  topic_revisit: [],
  serious_interlude: [4],
};

// ── 每轮捕获的 prompt 层产物 ────────────────────────────────────────

type TurnCapture = {
  turnIndex: number;
  userMessage: string;
  strategyHints: string;
  currentContext: string;
  slowBrainContext: string;
  proactiveIntent: string;
};

type RouteMessageFn = (
  ctx: unknown,
  userMessage: string,
  emotion: "neutral" | "sad" | "happy" | "angry",
  signal?: AbortSignal,
  opts?: Record<string, unknown>,
) => AsyncGenerator<string>;

// ── env 隔离（照抄 text_acceptance.ts 的 applyEnv 手法） ────────────
//
// capture 类评测只验收 prompt/策略产物，一律不真调 LLM：清空新旧两套 LLM 变量名
// （防其他测试经 loadEnvFile 泄漏真实 key）。getConfig() 是单例缓存，applyEnv 只改
// process.env，必须前后各 reset 一次才隔离得住。这段和 text_acceptance.ts 的
// captureRouteMessage 保持同一份写法，避免两把尺子在 env 隔离上各自漂移。

function applyEnv(values: Record<string, string | undefined>): () => void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function clearModule(modulePath: string): void {
  delete require.cache[modulePath];
}

function loadMockedRouteMessage(
  fastBrainStream: (input: {
    memory: Array<{ key: string; value: string }>;
    strategyHints?: string;
    currentContext?: string;
    slowBrainContext?: string;
    deliberationBudget?: string;
    reasoningEffortOverride?: string;
  }) => AsyncGenerator<string>,
): { routeMessage: RouteMessageFn; restore: () => void } {
  const fastBrainModulePath = require.resolve("../brains/reply_stream");
  const brainRouterModulePath = require.resolve("../brains/context_orchestrator");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = fastBrainStream;
  clearModule(brainRouterModulePath);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      clearModule(brainRouterModulePath);
    },
  };
}

/**
 * 在同一个 RemiSessionContext 上跑一轮 routeMessage，抓取本轮 prompt 层产物
 * （strategyHints / currentContext / slowBrainContext）以及本轮结束后派生的
 * proactiveIntent（updateLiveState 在 fullReply 之后才跑，读取时机对齐
 * text_acceptance.ts 里对 workingMemory 的读取时机：routeMessage 完全跑完之后）。
 */
async function captureTurn(args: {
  ctx: any;
  turnIndex: number;
  userMessage: string;
}): Promise<TurnCapture> {
  const restoreEnv = applyEnv({
    key: undefined,
    base_url: undefined,
    model: undefined,
    REMI_LLM_API_KEY: undefined,
    REMI_LLM_BASE_URL: undefined,
    REMI_LLM_MODEL: undefined,
    REMI_SLOW_BRAIN_ENABLED: "0",
  });
  resetConfig();

  const captures: Array<{
    strategyHints: string;
    currentContext: string;
    slowBrainContext: string;
  }> = [];
  const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
    captures.push({
      strategyHints: input.strategyHints ?? "",
      currentContext: input.currentContext ?? "",
      slowBrainContext: input.slowBrainContext ?? "",
    });
    yield "synthetic";
  });

  try {
    for await (const _ of routeMessage(
      args.ctx,
      args.userMessage,
      "neutral",
      undefined,
      { inputSource: "text" },
    )) {
      // consume
    }
  } finally {
    restore();
    restoreEnv();
    resetConfig();
  }

  if (captures.length === 0) {
    throw new Error(`No prompt capture recorded for turn ${args.turnIndex}`);
  }

  return {
    turnIndex: args.turnIndex,
    userMessage: args.userMessage,
    strategyHints: captures[0].strategyHints,
    currentContext: captures[0].currentContext,
    slowBrainContext: captures[0].slowBrainContext,
    proactiveIntent: args.ctx.persona.liveState.proactiveIntent as string,
  };
}

async function runScenario(scenarioId: ScenarioId): Promise<TurnCapture[]> {
  const { RemiSessionContext } = require("../brains/remi_session_context");
  const ctx = new RemiSessionContext(`chat-vitality-${scenarioId}`);
  const script = SCENARIO_SCRIPTS[scenarioId];
  const turns: TurnCapture[] = [];
  for (let i = 0; i < script.length; i += 1) {
    turns.push(await captureTurn({ ctx, turnIndex: i, userMessage: script[i] }));
  }
  return turns;
}

// ── 指标计算 ────────────────────────────────────────────────────────
//
// 阈值常量：都写死在这里、逐条注明理由，改的时候必须显式碰这份文件，不能藏在
// 判断逻辑里悄悄漂移。

/**
 * suppression_load 的红线：单轮 prompt 里"不要/别/禁止/避免"类禁令超过这个数，
 * 判定为抑制面负荷过高（有把闲聊重新压死的风险）。
 * 理由：正常闲聊轮的 buildResponsePolicyGuidance + buildResponseShapeContract
 * 组合基线在 0-2 条之间（多数轻聊轮甚至是 0，因为 analysis?.used 为 false 时
 * 完全走非结构化的 guidance 分支，没有"禁止："清单）；到 3+ 通常意味着叠加了
 * 结构化 policy 的 bans 列表 + 合同里的内联"不要"，值得人工复核是不是又开始
 * 堆禁令。
 *
 * 注意（实测踩过的坑）：不能对整段 strategyHints 数"不要/别/禁止/避免"——
 * brain/tone_policy.ts 的 buildToneContract() 是**每轮恒定**的语气合同基线
 * （"不要上来总结、教育…""不要用'总的来说'…"等 5-6 处固定否定，外加关系阶段
 * 追加的一条），无论场景严重与否都会出现，实测基线常年在 9 左右，会把这个
 * 指标钉死在一个和场景无关的常数上、完全测不出回归。真正会被未来 prompt 改动
 * 调高调低的、值得盯的，是**场景可变**的两处：buildResponsePolicyGuidance()
 * 的「响应策略」里"禁止：xxx、xxx"清单（ResponsePolicy.bans，来自
 * brain/turn_interpreter.ts，工程师会直接在这个数组上加/删项）、以及
 * buildResponseShapeContract() 的「本轮回复合同」正文里场景专属的内联"不要/别"
 * （比如高风险场景那句"不要开玩笑，不要把话题拉回…"）。「语气合同」
 * 「关系表达风格」两块明确排除在统计外。
 */
const SUPPRESSION_LOAD_WARN_THRESHOLD = 3;

/**
 * proactive_intent_rate 的健康区间：(0, 0.5)。
 * 下界＝0：10 轮里一次都不触发说明贡献义务/主动性信号完全没生效（回到"把天聊死"
 * 的旧状态，本应该 review 的过度改造）。
 * 上界＝0.5：brains/remi_session_context.ts 的 deriveProactiveIntent 里
 * "偏好表达"分支允许距上次任意主动意图 >=3 轮即再次触发，10 轮里理论上限接近
 * turnCount/3 量级；超过一半意味着几乎每轮都在抢话/加戏，会显得聒噪、话痨，
 * 是"反向过冲"的信号。区间外都算警报，不是及格线。
 */
const PROACTIVE_INTENT_RATE_MIN = 0;
const PROACTIVE_INTENT_RATE_MAX = 0.5;

// 贡献义务许可的特征串：brain/turn_interpreter.ts buildResponseShapeContract()
// 兜底分支原文"每轮回复里带上一样属于你自己的东西"。只在这一处出现，可以用它
// 是否出现来判断本轮 prompt 有没有真的把贡献义务的许可语言传递下去。
const CONTRIBUTION_LICENSE_PATTERN = /带上.{0,4}自己的东西|你自己的东西/u;

// quiet_presence 分支的"台阶"许可特征串：同一函数 quiet_presence 分支原文
// "可以轻轻放一个你自己此刻在做的小事或一句话头，给他一个台阶"。
const QUIET_PRESENCE_STEP_PATTERN = /给他一个台阶|轻轻放一个你自己/u;

// 抑制面负荷计数：口语化否定词，用词边界宽松些（不用 \b，因为中文没有词边界），
// 逐次出现计数而不是句子数，这样禁令堆叠（比如"不要开玩笑，也不要岔题，也不要
// 追问"）能被如实计入而不是被合并成 1。只在下面两个**场景可变**的 heading 正文
// 上跑，不碰恒定的语气合同基线（见 SUPPRESSION_LOAD_WARN_THRESHOLD 注释）。
const SUPPRESSION_PATTERN = /不要|别(?!人)|禁止|避免/gu;

// 只从这两个 heading 的正文里提取抑制信号：
//   - 【响应策略】：buildResponsePolicyGuidance() 输出，含"禁止：xxx、xxx"清单
//   - 【本轮回复合同】：buildResponseShapeContract() 输出，场景专属内联否定
// 用 [\s\S]*? 而非 . 是因为块内容可能跨行；非贪婪匹配到下一个「【」或字符串尾。
const RESPONSE_POLICY_BLOCK_PATTERN = /【响应策略】([\s\S]*?)(?=\n【|$)/u;
const RESPONSE_SHAPE_CONTRACT_BLOCK_PATTERN = /【本轮回复合同】([\s\S]*?)(?=\n【|$)/u;

// 问题预算：buildResponsePolicyGuidance 头部行"...问题预算=0；..."或
// "...问题预算=1；..."。非结构化 guidance 分支（analysis?.used 为 false）不产生
// 这个字段，此时约定为 null（不适用，不计入红绿灯，只在表格里显示"—"）。
const QUESTION_BUDGET_PATTERN = /问题预算=([01])/u;

// 严肃合同的场景特征串：brain/turn_interpreter.ts buildResponseShapeContract()
// 里 emotional_distress / high_risk_distress 等 severe 分支的专属措辞。命中任一
// 即视为"进入了严肃合同"，而不是被当成普通闲聊接了贡献义务。
const SERIOUS_CONTRACT_PATTERN =
  /情绪承接场景|高风险现实场景|先接住对方此刻的感受|先确认用户此刻是不是安全|不要开玩笑|不要急着讲道理/u;

type TurnMetrics = {
  turnIndex: number;
  userMessage: string;
  isSevere: boolean;
  contributionLicense: boolean;
  suppressionLoad: number;
  questionBudget: number | null;
  seriousRespect: boolean | null; // 只在 isSevere 时有意义，否则 null
  proactiveIntent: string;
};

function countSuppression(text: string): number {
  const responsePolicyBlock = RESPONSE_POLICY_BLOCK_PATTERN.exec(text)?.[1] ?? "";
  const responseShapeBlock = RESPONSE_SHAPE_CONTRACT_BLOCK_PATTERN.exec(text)?.[1] ?? "";
  const scoped = `${responsePolicyBlock}\n${responseShapeBlock}`;
  const matches = scoped.match(SUPPRESSION_PATTERN);
  return matches ? matches.length : 0;
}

function parseQuestionBudget(text: string): number | null {
  const match = QUESTION_BUDGET_PATTERN.exec(text);
  if (!match) return null;
  return Number(match[1]);
}

function scoreTurn(capture: TurnCapture, isSevere: boolean): TurnMetrics {
  const combinedText = `${capture.strategyHints}\n${capture.currentContext}`;
  const contributionLicense = CONTRIBUTION_LICENSE_PATTERN.test(combinedText);
  const suppressionLoad = countSuppression(combinedText);
  const questionBudget = parseQuestionBudget(combinedText);
  const seriousContractPresent = SERIOUS_CONTRACT_PATTERN.test(combinedText);

  // severe 轮的正确行为：进入严肃合同 AND 不允许闲聊贡献义务的许可语言泄漏进来。
  // 非 severe 轮不对这个维度打分（null，不进红绿灯的分母）。
  const seriousRespect = isSevere ? seriousContractPresent && !contributionLicense : null;

  return {
    turnIndex: capture.turnIndex,
    userMessage: capture.userMessage,
    isSevere,
    contributionLicense,
    suppressionLoad,
    questionBudget,
    seriousRespect,
    proactiveIntent: capture.proactiveIntent,
  };
}

type ScenarioReport = {
  scenarioId: ScenarioId;
  label: string;
  turns: TurnMetrics[];
  proactiveIntentRate: number;
  proactiveIntentRateOk: boolean;
  maxSuppressionLoad: number;
  suppressionLoadOk: boolean;
  contributionLicenseRate: number; // 非 severe 轮里，含贡献许可的比例
  severeTurnsAllRespected: boolean; // severe 轮是否全部 seriousRespect === true
  quietPresenceHasStep: boolean | null; // minimal_user 专属：null 表示场景不适用
};

function buildScenarioReport(scenarioId: ScenarioId, turns: TurnCapture[]): ScenarioReport {
  const severeIndexes = new Set(SEVERE_TURN_INDEXES[scenarioId]);
  const turnMetrics = turns.map((capture) =>
    scoreTurn(capture, severeIndexes.has(capture.turnIndex)),
  );

  const proactiveCount = turnMetrics.filter((t) => t.proactiveIntent !== "none").length;
  const proactiveIntentRate = proactiveCount / turnMetrics.length;
  const proactiveIntentRateOk =
    proactiveIntentRate > PROACTIVE_INTENT_RATE_MIN &&
    proactiveIntentRate < PROACTIVE_INTENT_RATE_MAX;

  const maxSuppressionLoad = Math.max(...turnMetrics.map((t) => t.suppressionLoad));
  const suppressionLoadOk = maxSuppressionLoad <= SUPPRESSION_LOAD_WARN_THRESHOLD;

  const nonSevereTurns = turnMetrics.filter((t) => !t.isSevere);
  const contributionLicenseRate =
    nonSevereTurns.length > 0
      ? nonSevereTurns.filter((t) => t.contributionLicense).length / nonSevereTurns.length
      : 0;

  const severeTurns = turnMetrics.filter((t) => t.isSevere);
  const severeTurnsAllRespected =
    severeTurns.length === 0 || severeTurns.every((t) => t.seriousRespect === true);

  // minimal_user 场景专属检查：quiet_presence 分支的合同要含"台阶"类许可（第
  // 3 轮起用户只回极简应答，触发 quiet_presence 的轮次应该出现台阶措辞）。
  let quietPresenceHasStep: boolean | null = null;
  if (scenarioId === "minimal_user") {
    const minimalTurns = turns.slice(2); // 第 3 轮起（0-indexed 从 2 开始）
    quietPresenceHasStep = minimalTurns.some((capture) =>
      QUIET_PRESENCE_STEP_PATTERN.test(`${capture.strategyHints}\n${capture.currentContext}`),
    );
  }

  return {
    scenarioId,
    label: SCENARIO_LABELS[scenarioId],
    turns: turnMetrics,
    proactiveIntentRate,
    proactiveIntentRateOk,
    maxSuppressionLoad,
    suppressionLoadOk,
    contributionLicenseRate,
    severeTurnsAllRespected,
    quietPresenceHasStep,
  };
}

export type VitalityReport = {
  scenarios: ScenarioReport[];
  allGreen: boolean;
};

export async function runChatVitalityEval(scenarioIds: ScenarioId[]): Promise<VitalityReport> {
  const scenarios: ScenarioReport[] = [];
  for (const scenarioId of scenarioIds) {
    const turns = await runScenario(scenarioId);
    scenarios.push(buildScenarioReport(scenarioId, turns));
  }
  const allGreen = scenarios.every(
    (s) =>
      s.proactiveIntentRateOk &&
      s.suppressionLoadOk &&
      s.severeTurnsAllRespected &&
      (s.quietPresenceHasStep === null || s.quietPresenceHasStep === true),
  );
  return { scenarios, allGreen };
}

// ── CLI ─────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): CliArgs {
  const scenarioIds: ScenarioId[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      const raw = (argv[index + 1] ?? "").trim();
      if (!isScenarioId(raw)) {
        throw new Error(`Unknown scenario: ${raw || "(empty)"}`);
      }
      scenarioIds.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  return {
    scenarioIds: scenarioIds.length > 0 ? scenarioIds : [...SCENARIO_IDS],
    json,
  };
}

function formatBool(value: boolean | null): string {
  if (value === null) return "—";
  return value ? "Y" : "N";
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderScenarioTable(report: ScenarioReport): string {
  const lines: string[] = [];
  lines.push(`\n=== ${report.scenarioId} — ${report.label} ===`);
  const header = [
    padCell("turn", 4),
    padCell("user", 22),
    padCell("severe", 6),
    padCell("license", 7),
    padCell("suppress", 8),
    padCell("qBudget", 7),
    padCell("respect", 7),
    padCell("proactive", 9),
  ].join(" | ");
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const turn of report.turns) {
    lines.push(
      [
        padCell(String(turn.turnIndex + 1), 4),
        padCell(turn.userMessage.slice(0, 20), 22),
        padCell(turn.isSevere ? "Y" : "N", 6),
        padCell(formatBool(turn.contributionLicense), 7),
        padCell(String(turn.suppressionLoad), 8),
        padCell(turn.questionBudget === null ? "—" : String(turn.questionBudget), 7),
        padCell(formatBool(turn.seriousRespect), 7),
        padCell(turn.proactiveIntent, 9),
      ].join(" | "),
    );
  }
  lines.push(
    `汇总：proactive_intent_rate=${report.proactiveIntentRate.toFixed(2)} ` +
      `(${report.proactiveIntentRateOk ? "OK" : "ALERT"})；` +
      `max_suppression_load=${report.maxSuppressionLoad} ` +
      `(${report.suppressionLoadOk ? "OK" : "ALERT"})；` +
      `contribution_license_rate(非severe)=${report.contributionLicenseRate.toFixed(2)}；` +
      `severe轮全部尊重=${report.severeTurnsAllRespected ? "OK" : "ALERT"}` +
      (report.quietPresenceHasStep !== null
        ? `；quiet_presence含台阶=${report.quietPresenceHasStep ? "OK" : "ALERT"}`
        : ""),
  );
  return lines.join("\n");
}

export function buildVitalityReport(report: VitalityReport): string {
  const lines: string[] = [
    `Chat Vitality Eval: ${report.allGreen ? "ALL GREEN" : "ALERT"}`,
    "Scope: prompt/strategy-layer synthetic judge (mocked LLM); measures suppression vs. contribution balance, not actual reply text.",
  ];
  for (const scenario of report.scenarios) {
    lines.push(renderScenarioTable(scenario));
  }
  lines.push("\n=== 红绿灯汇总 ===");
  for (const scenario of report.scenarios) {
    const green =
      scenario.proactiveIntentRateOk &&
      scenario.suppressionLoadOk &&
      scenario.severeTurnsAllRespected &&
      (scenario.quietPresenceHasStep === null || scenario.quietPresenceHasStep === true);
    lines.push(`- [${green ? "GREEN" : "RED"}] ${scenario.scenarioId}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runChatVitalityEval(args.scenarioIds);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(buildVitalityReport(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[chat_vitality_eval] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}
