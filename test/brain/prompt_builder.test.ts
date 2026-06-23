const assert = require("assert").strict;
const { buildPrompt } = require("../../brain/prompt_builder");
const { createDefaultPersona } = require("../../persona");
const { RemiSessionContext } = require("../../brains/remi_session_context");

describe("prompt builder emotion speech style", () => {
  it("renders a compact expression block for the selected persona preset", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.applyPersonaPreset("relaxed_roast");

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "你继续",
      persona: ctx.persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【表达风格】"));
    assert.ok(system.includes("幽默高"));
    assert.ok(system.includes("轻吐槽"));
    assert.ok(system.includes("直率清晰"));
    assert.ok(system.includes("可接梗"));
    assert.ok(system.includes("松弛吐槽"));
  });

  it("injects a RemiCore runtime contract for the default persona", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "今天开会又开成工伤了",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【RemiCore合同】"));
    assert.ok(system.includes("默认的 Remi 只有一个"));
    assert.ok(system.includes("轻聊、小抱怨、比喻句、碎碎念"));
    assert.ok(system.includes("有趣不是段子表演"));
    assert.ok(system.includes("现实压力、委屈、冲突、事故、债务、死亡、关系受损时，立刻收住"));
  });

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

  it("guides callback turns as contextual continuation instead of fixed memory openers", () => {
    const persona = createDefaultPersona();
    persona.liveState.proactiveIntent = "callback";
    persona.liveState.topicPull = "工作那件事";

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "还没缓过来",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【本轮承接】"));
    assert.ok(system.includes("只有当对方当前这句话"));
    assert.ok(system.includes("不要用“对了”“说起来”“你之前”“上次你说”"));
    assert.equal(system.includes("像随口想起"), false);
    assert.equal(system.includes("轻轻提起之前没说完的话题"), false);
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

  it("keeps the tail of long explicit reply contracts so multi-beat guidance survives prompt assembly", () => {
    const persona = createDefaultPersona();
    const longContract =
      "【本轮回复合同】当前已进入 explicit scene。".concat(
        "动作承接、姿势距离、身体反应、强度递进、命令回应、少写抒情 filler，".repeat(10),
        "尾部关键要求：不要把整轮压成一句；至少写出动作承接、当下反应和下一拍推进。",
      );

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "继续",
      priorityContext: longContract,
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("尾部关键要求"));
    assert.ok(system.includes("下一拍推进"));
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

  it("adds layered soul, bond, and style guidance for persona mode", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.applyPersonaPreset("playful_attached");
    ctx.persona.liveState.closeness = "relaxed";
    ctx.persona.liveState.relationalStance = {
      mode: "close_warmth",
      boundary: "close",
      soothingStyle: "easy_banter",
      proactiveCadence: "balanced",
      expressionDirectness: "balanced",
    };

    const messages = buildPrompt({
      memory: [],
      emotion: "happy",
      history: [],
      userMessage: "我想被哄一下，但别太肉麻",
      persona: ctx.persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【灵魂底色】"));
    assert.ok(system.includes("【关系偏向】"));
    assert.ok(system.includes("【风格执行】"));
    assert.ok(system.includes("不是只会安抚的助手") || system.includes("会接话、会留气氛、会悄悄偏向对方的人"));
    assert.ok(system.includes("偏爱感"));
    assert.ok(system.includes("别直接掉回安抚+追问"));
  });

  it("makes remi_core soul guidance explicitly combine fun light-chat with same-person seriousness", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "你好呀",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("更像会聊的活人"));
    assert.ok(system.includes("轻聊时先给有意思的反应和一点网感"));
    assert.ok(system.includes("严肃时立刻收住"));
    assert.ok(system.includes("别像切换成另一个系统"));
  });

  it("keeps romantic guidance light when closeness is still early", () => {
    const ctx = new RemiSessionContext("test-conn");
    ctx.applyPersonaPreset("playful_attached");
    ctx.persona.liveState.closeness = "normal";
    ctx.persona.liveState.relationalStance = {
      mode: "steady_companion",
      boundary: "steady",
      soothingStyle: "gentle_checkin",
      proactiveCadence: "guarded",
      expressionDirectness: "balanced",
    };

    const messages = buildPrompt({
      memory: [],
      emotion: "curious",
      history: [],
      userMessage: "你如果在我旁边，会先说什么",
      persona: ctx.persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("轻一点的偏向"));
    assert.ok(system.includes("不要突然过分暧昧"));
  });

  it("specializes affection-bid execution guidance by preset", () => {
    const userMessage = "我想被你偏心一下，但别太明显。";
    const buildSystemForPreset = (presetId) => {
      const ctx = new RemiSessionContext(`test-${presetId}`);
      ctx.applyPersonaPreset(presetId);
      return buildPrompt({
        memory: [],
        emotion: "neutral",
        history: [],
        userMessage,
        persona: ctx.persona,
      })[0].content;
    };

    const wittyWarm = buildSystemForPreset("witty_warm");
    const relaxedRoast = buildSystemForPreset("relaxed_roast");
    const playfulAttached = buildSystemForPreset("playful_attached");
    const calmHealing = buildSystemForPreset("calm_healing");

    assert.ok(wittyWarm.includes("温柔地收着偏心"));
    assert.ok(relaxedRoast.includes("先轻轻逗一下"));
    assert.ok(playfulAttached.includes("像悄悄贴近一点"));
    assert.ok(calmHealing.includes("安静但明确地站在对方这边"));
  });

  it("adds dedicated execution guidance for metaphor-style complaints", () => {
    const persona = createDefaultPersona();

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "我今天的效率，像被谁偷偷拔了电源。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【比喻接梗执行】"));
    assert.ok(system.includes("先沿着用户自己给出的比喻接一句"));
    assert.ok(system.includes("别把“拔了电源”这种画面直接抹平"));
    assert.ok(system.includes("不要第一句就退回泛化安抚或直接盘问原因"));
  });

  it("adds an immediate style override block when the user explicitly asks for more humor and less assistantiness", () => {
    const persona = createDefaultPersona();
    persona.liveState.styleOverride = {
      humorBoost: true,
      teasingMode: "light",
      assistantySuppression: true,
      familiarityBoost: false,
      romanceBoost: false,
      roleplayStyle: null,
      remainingTurns: 6,
      sourceText: "你能不能有趣点，毒舌一点，但别伤人，别这么像助手。",
    };

    const messages = buildPrompt({
      memory: [],
      emotion: "neutral",
      history: [],
      userMessage: "你能不能有趣点，毒舌一点，但别伤人，别这么像助手。",
      persona,
    });

    const system = messages[0].content;
    assert.ok(system.includes("【当前风格要求】"));
    assert.ok(system.includes("更有趣一点"));
    assert.ok(system.includes("少一点助手腔"));
    assert.ok(system.includes("轻一点的损友式吐槽"));
  });
});
