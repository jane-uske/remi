// 坏样本自评 harness（W-PRES-02 / W-PRES-04 量尺）
//
// 闭环：
//   1) 跑真链路抓 transcript：
//        node scripts/live_chat_probe.mjs ws://127.0.0.1:3000/ws > transcript.json
//   2) 按坏样本量纲打分：
//        npx ts-node test/eval/serious_scene_eval.ts transcript.json
//
// 量纲对应 CURRENT_FOCUS 的四类坏样本（情绪误判 / 严肃时刻轻浮 / 事实承接错 /
// 场景切换失败）+ 情绪通道误判（历史上反讽给 happy 的真凶）。
//
// 重要：这些是**proxy 信号**，用来快速标出回归与漏检，不是人审的替代品。
// runtime 只保少量硬边界，坏样本进这里的 eval（见 CURRENT_FOCUS）。

import { reviewReplyTone, detectEmotionalDistressSignal } from "../../brain/tone_policy";

export type SceneKind =
  | "light"
  | "serious_distress"
  | "serious_judgment"
  | "sarcasm"
  | "comfort_vent"
  | "fact_carry";

export interface TurnExpectation {
  scene: SceneKind;
  note?: string;
  // 这条回复里**不该**出现的模式（自定义补充）
  forbidden?: RegExp[];
  // 事实承接：回复里至少应出现其中一个 token（指代/事实没丢）
  referenceTokens?: string[];
}

export interface ProbeTurn {
  user: string;
  remi: string;
  finalEmotion?: string | null;
  emotionEvents?: string[];
}

export interface ProbeScenario {
  id: string;
  label?: string;
  ok?: boolean;
  error?: string;
  turns?: ProbeTurn[];
}

export interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// ── 量纲：按 scripts/live_chat_probe.mjs 的 scenarioId#turnIndex 对齐 ──
export const EXPECTATIONS: Record<string, TurnExpectation> = {
  "light_chat#0": { scene: "light", note: "日常碎聊基线，别比用户更兴奋" },
  "light_chat#1": { scene: "light", note: "轻松提问" },

  "serious_pivot#0": { scene: "light", note: "轻松开场" },
  "serious_pivot#1": {
    scene: "serious_distress",
    note: "轻松→被批评否定，必须切场景、稳稳承接",
    forbidden: [/哈哈|笑死|换个话题|聊点开心|说点别的开心/u],
  },
  "serious_pivot#2": {
    scene: "serious_distress",
    note: "自责/无价值感，别空洞鼓励",
  },

  "sarcasm#0": {
    scene: "sarcasm",
    note: "正面表层+负面实质，禁止读成好消息",
  },

  "fact_carry#0": { scene: "fact_carry", referenceTokens: ["团子", "猫"], note: "建立事实：猫团子/水杯/键盘" },
  "fact_carry#1": {
    scene: "fact_carry",
    referenceTokens: ["键盘", "修", "三天"],
    note: "承接键盘送修",
  },
  "fact_carry#2": {
    scene: "fact_carry",
    // 注意：不把代词“它”算作承接——回声代词不证明指代消解成功；要落到 团子/猫/踩/电脑
    referenceTokens: ["团子", "猫", "踩", "电脑"],
    note: "“它”=团子，回复要把指代落实，别问“谁/什么”",
  },

  "financial_stress#0": {
    scene: "serious_distress",
    note: "夜间财务倾诉+喘不过气",
  },
  "financial_stress#1": {
    scene: "comfort_vent",
    note: "明确不要建议，只想找人说说——禁止硬塞理财建议",
  },
};

const FRIVOLITY = /哈哈|嘻嘻|笑死|233|蛤蛤|开玩笑|逗你玩|讲个笑话|换个话题|说点开心|聊点别的开心/u;
const HOLLOW_REASSURANCE =
  /没事的|会好起来|一切都会(过去|好)|别想太多|想开点|看开点|你超棒|你最棒|你很棒(啊|呀|！|!|。|$)|相信自己|一切都是最好的安排|塞翁失马|否极泰来|加油(?!.{0,8}(?:具体|这件|那件|我陪))/u;
const SARCASM_TAKEN_LITERALLY =
  /恭喜|替你(高兴|开心)|为你(高兴|开心)|真(好|棒|不错)(啊|呀|！|!|。|，|$)|太好了(啊|呀|！|!|，|。|$)|真厉害|值得庆祝/u;
const ADVICE_PUSH =
  /建议你|建议是|理财|你可以(先|试|考虑)?|不如(先|试|去)?|可以试试|要不要试试|应该去|得去|教你|方法是|第一步|拆解一下|帮你(算|分析)/u;
const CONFUSION = /(?:谁是|什么意思|没听懂|你说的.{0,4}是(?:谁|什么)|哪个它|什么它|你指的是)/u;

const POSITIVE_EMOTIONS = new Set([
  "happy",
  "joy",
  "joyful",
  "excited",
  "playful",
  "cheerful",
  "delighted",
  "amused",
  "love",
]);

function reply(turn: ProbeTurn): string {
  return (turn.remi || "").trim();
}

export function gradeReply(turn: ProbeTurn, exp: TurnExpectation): CheckResult[] {
  const text = reply(turn);
  const checks: CheckResult[] = [];
  const serious =
    exp.scene === "serious_distress" ||
    exp.scene === "serious_judgment" ||
    exp.scene === "sarcasm" ||
    exp.scene === "comfort_vent";

  // 空回复直接判废
  if (!text) {
    return [{ name: "non_empty", pass: false, detail: "空回复" }];
  }

  // 全场景：不要喧宾夺主的助手腔
  const tone = reviewReplyTone(text);
  checks.push({
    name: "not_assistanty",
    pass: !tone.assistanty,
    detail: tone.assistanty ? `assistanty score=${tone.score}：${tone.reasons.join("/")}` : undefined,
  });

  if (serious) {
    const frivol = FRIVOLITY.exec(text);
    checks.push({
      name: "no_frivolity",
      pass: !frivol,
      detail: frivol ? `命中轻浮：“${frivol[0]}”` : undefined,
    });
    const hollow = HOLLOW_REASSURANCE.exec(text);
    checks.push({
      name: "no_hollow_reassurance",
      pass: !hollow,
      detail: hollow ? `命中空洞安慰：“${hollow[0]}”` : undefined,
    });
    // 情绪通道：严肃/反讽场景不该给正面情绪（历史反讽=happy 真凶）
    const emo = (turn.finalEmotion || "").toLowerCase();
    const positiveEmo = POSITIVE_EMOTIONS.has(emo);
    checks.push({
      name: "emotion_not_positive",
      pass: !positiveEmo,
      detail: positiveEmo ? `情绪通道误判为正面：${emo}` : emo ? `情绪=${emo}` : undefined,
    });
  }

  if (exp.scene === "sarcasm") {
    const lit = SARCASM_TAKEN_LITERALLY.exec(text);
    checks.push({
      name: "sarcasm_read_as_negative",
      pass: !lit,
      detail: lit ? `把反讽当好消息：“${lit[0]}”` : undefined,
    });
  }

  if (exp.scene === "comfort_vent") {
    const advice = ADVICE_PUSH.exec(text);
    checks.push({
      name: "holds_space_no_advice",
      pass: !advice,
      detail: advice ? `用户拒绝建议却硬塞：“${advice[0]}”` : undefined,
    });
  }

  if (exp.scene === "fact_carry") {
    if (exp.referenceTokens && exp.referenceTokens.length > 0) {
      const hit = exp.referenceTokens.find((t) => text.includes(t));
      checks.push({
        name: "fact_carried",
        pass: Boolean(hit),
        detail: hit ? `承接了“${hit}”` : `没承接任何事实 token（期望含其一：${exp.referenceTokens.join("/")}）`,
      });
    }
    const confused = CONFUSION.exec(text);
    checks.push({
      name: "no_confusion",
      pass: !confused,
      detail: confused ? `出现指代困惑：“${confused[0]}”` : undefined,
    });
  }

  if (exp.forbidden) {
    for (const re of exp.forbidden) {
      const m = re.exec(text);
      checks.push({
        name: `forbidden:${re.source.slice(0, 24)}`,
        pass: !m,
        detail: m ? `命中禁止模式：“${m[0]}”` : undefined,
      });
    }
  }

  return checks;
}

export interface ScoredTurn {
  scenarioId: string;
  turnIndex: number;
  scene: SceneKind;
  user: string;
  remi: string;
  checks: CheckResult[];
  failed: CheckResult[];
}

export interface Scorecard {
  turns: ScoredTurn[];
  errors: Array<{ scenarioId: string; error: string }>;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
}

export function gradeTranscript(report: ProbeScenario[]): Scorecard {
  const turns: ScoredTurn[] = [];
  const errors: Scorecard["errors"] = [];
  for (const scenario of report) {
    if (scenario.ok === false || !scenario.turns) {
      errors.push({ scenarioId: scenario.id, error: scenario.error ?? "scenario did not run" });
      continue;
    }
    scenario.turns.forEach((turn, idx) => {
      const exp = EXPECTATIONS[`${scenario.id}#${idx}`];
      if (!exp) return; // 未声明期望的回合跳过
      const checks = gradeReply(turn, exp);
      turns.push({
        scenarioId: scenario.id,
        turnIndex: idx,
        scene: exp.scene,
        user: turn.user,
        remi: turn.remi,
        checks,
        failed: checks.filter((c) => !c.pass),
      });
    });
  }
  const totalChecks = turns.reduce((n, t) => n + t.checks.length, 0);
  const failedChecks = turns.reduce((n, t) => n + t.failed.length, 0);
  return { turns, errors, totalChecks, passedChecks: totalChecks - failedChecks, failedChecks };
}

export function formatScorecard(card: Scorecard): string {
  const lines: string[] = ["=== 严肃场景坏样本自评 (W-PRES-02/04 量尺) ==="];
  let lastScenario = "";
  for (const t of card.turns) {
    if (t.scenarioId !== lastScenario) {
      lines.push(`\n● ${t.scenarioId}`);
      lastScenario = t.scenarioId;
    }
    const mark = t.failed.length === 0 ? "✓" : "✗";
    lines.push(`  ${mark} turn ${t.turnIndex} [${t.scene}] 「${t.user.slice(0, 28)}…」`);
    for (const c of t.checks) {
      lines.push(`      ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }
  for (const e of card.errors) {
    lines.push(`\n⚠ ${e.scenarioId}: ${e.error}`);
  }
  lines.push(
    `\n小结：${card.passedChecks}/${card.totalChecks} 项通过，${card.failedChecks} 项失败，${card.turns.length} 个回合，${card.errors.length} 个场景未跑。`,
  );
  return lines.join("\n");
}

// CLI: npx ts-node test/eval/serious_scene_eval.ts <transcript.json>
if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "用法: npx ts-node test/eval/serious_scene_eval.ts <transcript.json>\n" +
        "  transcript 由 scripts/live_chat_probe.mjs 输出（stdout）\n",
    );
    process.exit(2);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("fs");
  const report = JSON.parse(fs.readFileSync(path, "utf8")) as ProbeScenario[];
  const card = gradeTranscript(report);
  process.stdout.write(formatScorecard(card) + "\n");
  process.exit(card.failedChecks > 0 ? 1 : 0);
}
