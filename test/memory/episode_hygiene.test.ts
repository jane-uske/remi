const assert = require("assert").strict;

const {
  classifyEpisodeForHygiene,
  listEpisodeHygieneLanguages,
} = require("../../memory/episode_hygiene");

function makeEpisode(overrides = {}) {
  return {
    id: "episode-1",
    title: "工作",
    summary: "工作：上次你提到「其实最难受的是我明明很认真，却总像被看偏了。」，我们在继续聊工作。",
    topics: ["工作"],
    recurrence_count: 2,
    relationship_weight: 0.58,
    origin_moment_summaries: [
      "上次你提到「其实最难受的是我明明很认真，却总像被看偏了。」，我们在继续聊工作。",
    ],
    ...overrides,
  };
}

describe("episode_hygiene", () => {
  it("exposes a language-pack based interface even though only zh is populated today", () => {
    assert.deepEqual(listEpisodeHygieneLanguages(), ["zh"]);
  });

  it("archives zh meta-prompt control episodes", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      topics: ["工作", "感情"],
      recurrence_count: 8,
      relationship_weight: 0.84,
      summary: "感情：上次你提到「请只回复一句，不要解释，不要反问。刚才我们气氛有点暧昧，现在你收一点，语气自然地对我说一句。」",
      origin_moment_summaries: [
        "上次你提到「请只回复一句，不要解释，不要反问。就像你很自然地贴近我一样。」",
        "上次你提到「请只回复一句，不要解释，不要反问。我现在有点累，你用很轻、很近、很稳的语气哄我一句。」",
      ],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons[0].id, "zh_meta_prompt");
  });

  it("archives zh dev/test probe episodes", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      recurrence_count: 1,
      relationship_weight: 0.38,
      summary: "工作：上次你提到「你好，请简短回复一句用于火山TTS网页测试。」",
      origin_moment_summaries: [
        "上次你提到「iOS mobile dev key smoke」",
        "上次你提到「idle send test」",
      ],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons.some((reason) => reason.id === "zh_dev_probe"), true);
  });

  it("archives strong probe outputs even when they are not technical topics", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      recurrence_count: 1,
      relationship_weight: 0.38,
      summary: "工作：上次你提到「现在是上午10点41分。」",
      origin_moment_summaries: [
        "上次你提到「idle send test」，我们在继续聊工作。",
      ],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons.some((reason) => reason.id === "zh_dev_probe"), true);
  });

  it("archives low-value filler episodes", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "感情",
      recurrence_count: 1,
      relationship_weight: 0.38,
      summary: "感情：上次你提到「(*´∀`)~♥」，我们在继续聊感情。",
      origin_moment_summaries: [
        "上次你提到「(*´∀`)~♥」，我们在继续聊感情。",
      ],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons.some((reason) => reason.id === "zh_low_value_filler"), true);
  });

  it("keeps genuine work/financial strain episodes", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      topics: ["工作", "财务"],
      recurrence_count: 3,
      relationship_weight: 0.68,
      summary: "工作：上次你提到「我手里差不多有两年半积蓄，但还欠花呗两万五。」",
      origin_moment_summaries: [
        "上次你提到「攒了两年半，还欠花呗两万五」，我们在继续聊工作。",
        "上次你提到「我是不是该辞职」，我们在继续聊工作。",
      ],
    }));

    assert.equal(judgment.shouldArchive, false);
    assert.deepEqual(judgment.reasons, []);
  });

  // brains/background_analysis.ts 的 buildSharedMomentSummary（2026-07 起）改叙事化
  // 框架后不再产出「」裸引语（"用户提到X" 而不是 "用户提到「X」"）。下面几条锁定
  // extractQuotedFragments 对新格式的兜底提取——不还原出用户原始片段的话，低价值
  // filler / dev-probe 分类器会因为锚定 ^...$ 的模式再也匹配不到孤立片段而永久失效。
  it("still archives low-value filler episodes in the new narrative format (no quotes)", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "感情",
      recurrence_count: 1,
      relationship_weight: 0.38,
      summary: "感情：用户提到哈哈哈。",
      origin_moment_summaries: ["用户提到哈哈哈。"],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons.some((reason) => reason.id === "zh_low_value_filler"), true);
  });

  it("still archives strong dev-probe episodes in the new narrative format (no quotes)", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      recurrence_count: 1,
      relationship_weight: 0.38,
      summary: "工作：用户提到idle send test。",
      origin_moment_summaries: ["用户提到idle send test。"],
    }));

    assert.equal(judgment.shouldArchive, true);
    assert.equal(judgment.reasons.some((reason) => reason.id === "zh_dev_probe"), true);
  });

  it("does not misfire on genuine content in the new narrative format (no quotes)", () => {
    const judgment = classifyEpisodeForHygiene(makeEpisode({
      title: "工作",
      topics: ["工作"],
      recurrence_count: 3,
      relationship_weight: 0.68,
      summary: "工作：用户提到我最近压力很大，经常加班到很晚。",
      origin_moment_summaries: ["用户提到我最近压力很大，经常加班到很晚。"],
    }));

    assert.equal(judgment.shouldArchive, false);
    assert.deepEqual(judgment.reasons, []);
  });
});
