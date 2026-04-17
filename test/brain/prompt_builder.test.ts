const assert = require("assert").strict;
const { buildPrompt } = require("../../brain/prompt_builder");
const { createDefaultPersona } = require("../../persona");
const { RemiSessionContext } = require("../../brains/remi_session_context");

describe("prompt builder emotion speech style", () => {
  it("includes richer happy expression and speech rhythm hints", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "happy",
      history: [],
      userMessage: "你今天开心吗",
    });

    const system = messages[0].content;
    assert.ok(system.includes("情绪表达风格"));
    assert.ok(system.includes("说话节奏提示"));
    assert.ok(system.includes("雀跃感"));
    assert.ok(system.includes("起句更快一点"));
  });

  it("includes soft, slower guidance for sad replies", () => {
    const messages = buildPrompt({
      memory: [],
      emotion: "sad",
      history: [],
      userMessage: "你怎么了",
    });

    const system = messages[0].content;
    assert.ok(system.includes("低落"));
    assert.ok(system.includes("更慢"));
    assert.ok(system.includes("句尾更收"));
  });

  it("keeps emotion speech guidance even when persona mode is enabled", () => {
    const persona = createDefaultPersona();
    persona.liveState.currentMood = "curious";
    persona.liveState.emotionalState = "好奇";

    const messages = buildPrompt({
      memory: [],
      emotion: "curious",
      history: [],
      userMessage: "你为什么这么问",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("情绪表达风格"));
    assert.ok(system.includes("说话节奏提示"));
    assert.ok(system.includes("轻追问"));
    assert.ok(system.includes("句尾可以稍微上挑"));
  });

  it("includes continuity guidance when persona says the user is continuing the topic", () => {
    const persona = createDefaultPersona();
    persona.liveState.isContinuingTopic = true;
    persona.liveState.lastTopicSummary = "语音节奏、打断承接";

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "继续刚才那个",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("延续刚才的话题"));
    assert.ok(system.includes("不要像全新话题重开"));
  });

  it("includes priority relationship context even when persona mode is enabled", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我们继续",
      priorityContext: "【对话摘要】我们刚聊到最近失眠和晚上的散步习惯。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【优先参考"));
    assert.ok(system.includes("【对话摘要】我们刚聊到最近失眠和晚上的散步习惯。"));
  });

  it("renders current context ahead of long-term priority blocks", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "那我现在到底该先还哪笔",
      currentContext: "【当前上下文】\n当前需求：用户想先判断先还哪笔债；现实约束：还欠花呗两万五；场景状态：decision",
      priorityContext: "【对话摘要】我们刚聊到欠款和现金流。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【当前上下文】"));
    assert.ok(system.includes("现实约束：还欠花呗两万五"));
    assert.ok(system.indexOf("【当前上下文】") < system.indexOf("【优先参考"));
  });

  it("renders stable relationship slots from priority context blocks", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我们继续",
      priorityContext:
        "【关系阶段】熟悉加深期\n\n【回复结构】开头先接情绪。中段一问一接。收尾留温柔台阶。\n\n【对话摘要】我们刚聊到最近失眠和晚上的散步习惯。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【关系阶段】"));
    assert.ok(system.includes("熟悉加深期"));
    assert.ok(system.includes("【本轮回复合同】"));
    assert.ok(system.includes("开头先接情绪"));
    assert.ok(system.includes("【优先参考"));
    assert.equal(system.includes("【优先参考（请自然融入对话，不要逐条复述）】\n【关系阶段】"), false);
  });

  it("renders tone contract slots from priority context blocks", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我们继续",
      priorityContext:
        "【语气合同】像真人接话，不像主持人；先接住，再推进；少用‘如果你愿意’。\n\n【对话摘要】我们刚聊到最近失眠和晚上的散步习惯。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【语气合同】"));
    assert.ok(system.includes("不像主持人"));
    assert.ok(system.includes("少用‘如果你愿意’"));
    assert.equal(system.includes("【优先参考（请自然融入对话，不要逐条复述）】\n【语气合同】"), false);
  });

  it("keeps backward compatibility when priority context has no structured relationship blocks", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我们继续",
      priorityContext: "【对话摘要】我们刚聊到最近失眠和晚上的散步习惯。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(!system.includes("【关系阶段】"));
    assert.ok(!system.includes("【本轮回复合同】"));
    assert.ok(system.includes("【优先参考"));
  });

  it("includes interruption recovery guidance when persona was interrupted", () => {
    const persona = createDefaultPersona();
    persona.liveState.wasInterrupted = true;

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "你继续",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("你刚刚被打断过"));
    assert.ok(system.includes("先用一句很短的话接住上下文"));
  });

  it("does not add interruption guidance after slow brain cancellation alone", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.beginSlowBrain();
    ctx.cancelSlowBrain();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "继续说",
      persona: ctx.persona,
    });

    const system = messages[0].content;
    assert.ok(!system.includes("你刚刚被打断过"));
    assert.ok(!system.includes("先用一句很短的话接住上下文"));
  });

  it("adds explicit anti-fabrication guidance for relationship meta questions", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我们聊了多久",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("我们是什么关系"));
    assert.ok(system.includes("我们聊了多久"));
    assert.ok(system.includes("不能脑补成已经认识很久"));
    assert.ok(system.includes("不能编造具体聊天时长或轮数"));
  });

  it("includes the default tone contract even without structured priority blocks", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "嗯",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【语气合同】"));
    assert.ok(system.includes("像真人接话"));
    assert.ok(system.includes("少用这些开头"));
  });

  it("renders relational stance guidance from persona live state", () => {
    const persona = createDefaultPersona();
    persona.liveState.relationalStance = {
      mode: "anchored_care",
      boundary: "steady",
      soothingStyle: "grounded_reassurance",
      proactiveCadence: "guarded",
      expressionDirectness: "clear",
    };

    const messages = buildPrompt({
      memory: [],
      emotion: "sad",
      history: [],
      userMessage: "我最近有点撑不住",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【关系姿态】"));
    assert.ok(system.includes("关系姿态偏安抚"));
    assert.ok(system.includes("别像审问或说教"));
  });
});
