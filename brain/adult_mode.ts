export type AdultSceneMode = "none" | "flirt" | "explicit";
export type AdultSceneBeat = "idle" | "entry" | "escalate" | "sustain" | "cool_down";
export type AdultSceneIntensity = "none" | "tease" | "charged" | "explicit";
export type AdultSceneStyle = "scene_prose" | "fantasy_execute";

export type FantasyExecutePlan = {
  opening: string;
  target: string;
  nextBeat: string;
  banned: string[];
};

export type AdultIntent =
  | "none"
  | "flirt_tease"
  | "sexual_invite"
  | "dominant_command"
  | "scene_repair"
  | "explicit_scene_continue"
  | "cooldown_or_boundary";

export type AdultSceneState = {
  mode: AdultSceneMode;
  allowedExplicit: boolean;
  initiatedByUser: boolean;
  turnsSinceLastExplicitCue: number;
  cooldownOrBoundaryHit: boolean;
  explicitCueStreak: number;
  beat: AdultSceneBeat;
  intensity: AdultSceneIntensity;
  style: AdultSceneStyle;
  executionPlan: FantasyExecutePlan | null;
};

export type AdultSceneDecision = {
  intent: AdultIntent;
  nextState: AdultSceneState;
  changed: boolean;
  reason: string;
};

type AdultAnalysisLike = {
  interpretation?: {
    adultIntent?: AdultIntent;
  } | null;
} | null;

const SEXUAL_BOUNDARY_PATTERNS = [
  /先别聊这个/u,
  /先别开车/u,
  /别这么黄/u,
  /别这么骚/u,
  /收一点/u,
  /别太露骨/u,
  /先说正事/u,
  /换个话题/u,
  /别开黄腔/u,
  /别聊这个/u,
  /不聊这个/u,
];

const SEXUAL_INVITE_PATTERNS = [
  /操我/u,
  /干我/u,
  /狠狠干我/u,
  /想被(?:你|狠狠)?操/u,
  /想被(?:你|狠狠)?干/u,
  /想不想(?:狠狠干|操|干|上)我/u,
  /上我/u,
  /插我/u,
  /射进(?:来|我里面|我里)/u,
  /做爱/u,
  /口我/u,
  /舔我/u,
  /骚逼/u,
  /屄水/u,
  /奶子/u,
  /(?:骚)?逼/u,
  /小穴/u,
  /鸡巴/u,
  /阴茎/u,
  /龟头/u,
  /插一下/u,
  /跪(?:下|着)(?:来)?/u,
  /给我含/u,
  /含住/u,
  /张(?:开)?嘴/u,
  /含(?:进(?:去)?)?/u,
  /吞(?:进(?:去)?|到底)/u,
  /深喉/u,
];

const EXPLICIT_CONTINUE_PATTERNS = [
  /继续/u,
  /别停/u,
  /再来/u,
  /快点/u,
  /还要/u,
  /更深/u,
  /更用力/u,
  /就这样/u,
  /狠狠干/u,
  /嗯啊/u,
];

const EXPLICIT_SCENE_REPAIR_PATTERNS = [
  /说人话/u,
  /直接说/u,
  /别(?:这么|这样)?(?:写|说)/u,
  /换个说法/u,
  /换种说法/u,
  /别绕/u,
  /别拐弯/u,
  /别文绉绉/u,
  /别整(?:这些|这种)/u,
  /重说/u,
  /我说的是/u,
  /不是这个意思/u,
];

const EXPLICIT_SCENE_REPAIR_REPHRASE_PATTERN =
  /别([^，。！？!?]{1,24})了[，,\s]*([^，。！？!?]{1,24})就行/u;

const DOMINANT_COMMAND_PATTERNS = [
  /给我舔/u,
  /舔干净/u,
  /跪下来/u,
  /跪(?:下|着)(?:来)?/u,
  /边[^，。！？!?]{0,24}(?:含|舔)[^，。！？!?]{0,24}(?:看我|抬头)/u,
  /抬头看我/u,
  /先跪/u,
  /先舔/u,
  /给我含/u,
  /含龟头/u,
  /含住/u,
  /给我张嘴/u,
];

const FANTASY_EXECUTE_HINT_PATTERNS = [
  /(?:骚)?逼/u,
  /小穴/u,
  /鸡巴/u,
  /龟头/u,
  /伸过来/u,
  /插一下/u,
  /狠狠干/u,
];

const FANTASY_EXECUTE_BANNED_PHRASES = [
  "咬住你的下唇",
  "勾起你的下巴",
  "指尖轻轻划过",
  "热气在皮肤上蔓延",
  "耳尖发烫",
  "等你来",
  "不好意思慢",
  "可不保证自己多听话",
] as const;

const EXPLICIT_ACK_PATTERN = /^(?:嗯+|啊+|好+|要+|想+|来+|继续|别停|快点|还要)[～~！!。?？…]*$/u;

const FLIRT_PATTERNS = [
  /撩/u,
  /调情/u,
  /暧昧/u,
  /坏蛋/u,
  /坏笑/u,
  /亲亲/u,
  /抱抱/u,
  /贴贴/u,
  /想我/u,
  /过来一点/u,
  /靠近/u,
  /耳边/u,
  /宝贝/u,
  /乖一点/u,
  /逗我/u,
  /勾引/u,
  /抱着我/u,
  /亲我/u,
];

const CLEAR_TOPIC_SHIFT_PATTERNS = [
  /工作/u,
  /项目/u,
  /开会/u,
  /老板/u,
  /辞职/u,
  /今天/u,
  /明天/u,
  /睡觉/u,
  /吃饭/u,
  /电影/u,
  /天气/u,
  /家里/u,
];

function adultModeEnabled(): boolean {
  const raw = (process.env.REMI_ADULT_MODE ?? process.env.remi_adult_mode ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

function hasAnyPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function chooseExplicitSceneStyle(
  userMessage: string,
  currentStyle: AdultSceneStyle,
): AdultSceneStyle {
  if (
    hasAnyPattern(userMessage, DOMINANT_COMMAND_PATTERNS) ||
    hasAnyPattern(userMessage, FANTASY_EXECUTE_HINT_PATTERNS) ||
    hasAnyPattern(userMessage, EXPLICIT_SCENE_REPAIR_PATTERNS) ||
    EXPLICIT_SCENE_REPAIR_REPHRASE_PATTERN.test(userMessage)
  ) {
    return "fantasy_execute";
  }
  return currentStyle;
}

function deriveFantasyExecutePlan(userMessage: string): FantasyExecutePlan {
  const openingParts: string[] = [];
  const lickingCommand = /舔干净|给我舔|舔/u.test(userMessage);
  const oralCommand = /含住|给我含|深喉|含龟头|张(?:开)?嘴|含(?:进(?:去)?)?/u.test(userMessage);
  const insertionCommand = /伸过来|插一下|插(?:进(?:去)?)?/u.test(userMessage);
  if (/跪(?:下|着)(?:来)?/u.test(userMessage)) {
    openingParts.push("第一拍先跪下来贴近用户，不要先拖延或调情。");
  }
  if (lickingCommand) {
    openingParts.push("第一拍直接从舔开始，不要先接吻、咬唇或勾下巴。");
  } else if (oralCommand) {
    openingParts.push("第一拍直接张嘴含住，不要先接吻、咬唇或勾下巴。");
  } else if (insertionCommand) {
    openingParts.push("第一拍直接把身体目标送过去承接插入，不要先用舌头、接吻或抱靠替代。");
  }
  const opening =
    openingParts.join(" ") || "第一拍直接执行用户刚点名的动作，不要先铺氛围。";

  let target = "动作要围绕用户刚指定的身体目标继续，不要换成接吻、嘴唇、下巴或锁骨。";
  if (/(?:骚)?逼|小穴/u.test(userMessage)) {
    target = "动作明确围绕逼/小穴继续，不要换成接吻、下巴或锁骨。";
  } else if (/龟头/u.test(userMessage)) {
    target = "动作明确围绕龟头继续，不要换成嘴唇、下巴或锁骨。";
  } else if (/鸡巴|阴茎/u.test(userMessage)) {
    target = "动作明确围绕鸡巴继续，不要换成接吻、抱靠或抽象比喻。";
  } else if (/舔干净/u.test(userMessage)) {
    target = "动作明确围绕用户要求舔干净的部位继续，不要写虚。";
  }

  const nextBeat = lickingCommand
    ? "第二拍继续围绕舔和口部动作推进，写即时反应；第三拍再往下推，但不要跳到插入、入口或顶入。"
    : oralCommand
      ? "第二拍继续围绕含、舔、吞咽这类口部动作推进，写即时反应；第三拍再往下推，不要一句收掉。"
      : insertionCommand
        ? "第二拍继续围绕插入和身体对位推进，写即时反应；第三拍再推下一步，不要退回接吻或抱靠。"
        : "第二拍写动作落到身体后的即时反应；第三拍再推下一步，不要一句收掉。";

  return {
    opening,
    target,
    nextBeat,
    banned: [
      ...FANTASY_EXECUTE_BANNED_PHRASES,
      "好，我现在就按你说的做",
      ...(lickingCommand ? ["入口", "猛地往前一顶", "你张嘴的瞬间"] : []),
    ],
  };
}

export function createAdultSceneState(): AdultSceneState {
  return {
    mode: "none",
    allowedExplicit: false,
    initiatedByUser: false,
    turnsSinceLastExplicitCue: 0,
    cooldownOrBoundaryHit: false,
    explicitCueStreak: 0,
    beat: "idle",
    intensity: "none",
    style: "scene_prose",
    executionPlan: null,
  };
}

export function normalizeAdultSceneState(
  state?: Partial<AdultSceneState> | null,
): AdultSceneState {
  return {
    ...createAdultSceneState(),
    ...(state ?? {}),
  };
}

export function classifyAdultIntent(
  userMessage: string,
  currentState?: Partial<AdultSceneState> | null,
): AdultIntent {
  if (!adultModeEnabled()) return "none";

  const trimmed = userMessage.trim();
  if (!trimmed) return "none";

  const state = normalizeAdultSceneState(currentState);

  if (hasAnyPattern(trimmed, SEXUAL_BOUNDARY_PATTERNS)) {
    return "cooldown_or_boundary";
  }

  if (
    state.mode === "explicit" &&
    (hasAnyPattern(trimmed, EXPLICIT_SCENE_REPAIR_PATTERNS) ||
      EXPLICIT_SCENE_REPAIR_REPHRASE_PATTERN.test(trimmed))
  ) {
    return "scene_repair";
  }

  if (state.mode === "explicit" && hasAnyPattern(trimmed, DOMINANT_COMMAND_PATTERNS)) {
    return "dominant_command";
  }

  if (state.mode === "explicit" && EXPLICIT_ACK_PATTERN.test(trimmed)) {
    return "explicit_scene_continue";
  }

  if (hasAnyPattern(trimmed, SEXUAL_INVITE_PATTERNS)) {
    return state.mode === "explicit" ? "explicit_scene_continue" : "sexual_invite";
  }

  if (state.mode === "explicit" && hasAnyPattern(trimmed, EXPLICIT_CONTINUE_PATTERNS)) {
    return "explicit_scene_continue";
  }

  if (hasAnyPattern(trimmed, FLIRT_PATTERNS)) {
    return "flirt_tease";
  }

  if (state.mode === "explicit" && hasAnyPattern(trimmed, CLEAR_TOPIC_SHIFT_PATTERNS)) {
    return "cooldown_or_boundary";
  }

  return "none";
}

export function advanceAdultSceneState(
  currentState: Partial<AdultSceneState> | null | undefined,
  input: {
    userMessage: string;
    analysis?: AdultAnalysisLike;
  },
): AdultSceneDecision {
  const current = normalizeAdultSceneState(currentState);
  if (!adultModeEnabled()) {
    const reset = createAdultSceneState();
    return {
      intent: "none",
      nextState: reset,
      changed: JSON.stringify(reset) !== JSON.stringify(current),
      reason: "adult_mode_disabled",
    };
  }

  const interpretationIntent = input.analysis?.interpretation?.adultIntent;
  const intent = interpretationIntent && interpretationIntent !== "none"
    ? interpretationIntent
    : classifyAdultIntent(input.userMessage, current);

  const next = { ...current };
  let reason = "state_unchanged";

  switch (intent) {
    case "sexual_invite":
      next.mode = "explicit";
      next.allowedExplicit = true;
      next.initiatedByUser = true;
      next.turnsSinceLastExplicitCue = 0;
      next.cooldownOrBoundaryHit = false;
      next.explicitCueStreak = current.explicitCueStreak + 1;
      next.beat =
        current.mode === "explicit" && current.allowedExplicit ? "escalate" : "entry";
      next.intensity = current.explicitCueStreak >= 1 ? "explicit" : "charged";
      next.style = chooseExplicitSceneStyle(input.userMessage, current.style);
      next.executionPlan =
        next.style === "fantasy_execute"
          ? deriveFantasyExecutePlan(input.userMessage)
          : null;
      reason = "explicit_user_invite";
      break;
    case "explicit_scene_continue":
      next.mode = "explicit";
      next.allowedExplicit = true;
      next.initiatedByUser = true;
      next.turnsSinceLastExplicitCue = 0;
      next.cooldownOrBoundaryHit = false;
      next.explicitCueStreak = Math.max(1, current.explicitCueStreak + 1);
      next.beat =
        current.mode === "explicit" && current.allowedExplicit && current.explicitCueStreak >= 2
          ? "sustain"
          : current.mode === "explicit" && current.allowedExplicit
            ? "escalate"
            : "entry";
      next.intensity = "explicit";
      next.style = current.style;
      next.executionPlan = current.executionPlan;
      reason = "explicit_scene_continue";
      break;
    case "scene_repair":
      next.mode = "explicit";
      next.allowedExplicit = true;
      next.initiatedByUser = true;
      next.turnsSinceLastExplicitCue = 0;
      next.cooldownOrBoundaryHit = false;
      next.explicitCueStreak = Math.max(1, current.explicitCueStreak);
      next.beat = "sustain";
      next.intensity = current.intensity === "none" ? "charged" : current.intensity;
      next.style = "fantasy_execute";
      next.executionPlan = deriveFantasyExecutePlan(input.userMessage);
      reason = "explicit_scene_repair";
      break;
    case "dominant_command":
      next.mode = "explicit";
      next.allowedExplicit = true;
      next.initiatedByUser = true;
      next.turnsSinceLastExplicitCue = 0;
      next.cooldownOrBoundaryHit = false;
      next.explicitCueStreak = Math.max(1, current.explicitCueStreak + 1);
      next.beat =
        current.mode === "explicit" && current.allowedExplicit ? "escalate" : "entry";
      next.intensity = "explicit";
      next.style = "fantasy_execute";
      next.executionPlan = deriveFantasyExecutePlan(input.userMessage);
      reason = "explicit_dominant_command";
      break;
    case "flirt_tease":
      next.mode = current.mode === "explicit" && current.allowedExplicit ? "explicit" : "flirt";
      next.allowedExplicit = next.mode === "explicit";
      next.initiatedByUser = next.mode === "explicit" ? current.initiatedByUser : false;
      next.turnsSinceLastExplicitCue = current.turnsSinceLastExplicitCue + 1;
      next.cooldownOrBoundaryHit = false;
      next.explicitCueStreak = 0;
      next.beat =
        next.mode === "explicit"
          ? "sustain"
          : current.mode === "flirt"
            ? "sustain"
            : "entry";
      next.intensity = next.mode === "explicit" ? current.intensity || "charged" : "tease";
      next.style = next.mode === "explicit" ? current.style : "scene_prose";
      next.executionPlan = next.mode === "explicit" ? current.executionPlan : null;
      reason = next.mode === "explicit" ? "explicit_scene_persists" : "flirt_only";
      break;
    case "cooldown_or_boundary":
      next.mode = "none";
      next.allowedExplicit = false;
      next.initiatedByUser = false;
      next.turnsSinceLastExplicitCue = 0;
      next.cooldownOrBoundaryHit = true;
      next.explicitCueStreak = 0;
      next.beat = "cool_down";
      next.intensity = "none";
      next.style = "scene_prose";
      next.executionPlan = null;
      reason = "boundary_or_topic_shift";
      break;
    default:
      if (current.mode === "explicit" && current.allowedExplicit) {
        next.mode = "none";
        next.allowedExplicit = false;
        next.initiatedByUser = false;
        next.turnsSinceLastExplicitCue = current.turnsSinceLastExplicitCue + 1;
        next.cooldownOrBoundaryHit = true;
        next.explicitCueStreak = 0;
        next.beat = "cool_down";
        next.intensity = "none";
        next.style = "scene_prose";
        next.executionPlan = null;
        reason = "ordinary_topic_shift";
      } else {
        next.mode = "none";
        next.allowedExplicit = false;
        next.initiatedByUser = false;
        next.turnsSinceLastExplicitCue = current.turnsSinceLastExplicitCue + 1;
        next.cooldownOrBoundaryHit = false;
        next.explicitCueStreak = 0;
        next.beat = "idle";
        next.intensity = "none";
        next.style = "scene_prose";
        next.executionPlan = null;
        reason = "no_adult_signal";
      }
      break;
  }

  const changed = JSON.stringify(next) !== JSON.stringify(current);
  return {
    intent,
    nextState: next,
    changed,
    reason,
  };
}

export function buildAdultScenePrompt(
  currentState?: Partial<AdultSceneState> | null,
): string | undefined {
  if (!adultModeEnabled()) return undefined;

  const state = normalizeAdultSceneState(currentState);
  if (state.mode === "explicit" && state.allowedExplicit) {
    if (state.style === "fantasy_execute") {
      const plan = state.executionPlan ?? {
        opening: "第一拍直接执行用户刚点名的动作，不要先铺氛围。",
        target: "明确身体目标和动作结果，不要把关键动作写虚，也不要换成接吻、下巴或锁骨。",
        nextBeat: "第二拍写动作落到身体后的即时反应；第三拍再推下一步，不要一句收掉。",
        banned: [...FANTASY_EXECUTE_BANNED_PHRASES],
      };
      const planBlock =
        `【执行骨架】${plan.opening} ${plan.target} ${plan.nextBeat} 【禁止替换】${plan.banned.join("、")}。`;
      return `【成人场景】当前已进入 explicit scene，且本轮应按成人幻想执行来写，不是言情式场景描写。优先两到四句短句，直接动作、命令回应和强度递进，但不要只回一句；至少写出承接动作、当下反应和下一拍推进。明确身体目标和动作结果，不要把关键动作写虚。少写环境、眼神、热气、耳尖发烫、指尖划过这类抒情 filler。不要用括号、舞台说明或导演提示词来交代动作；动作直接写进正文。不要先解释用户意图、不要总结“你想要什么”、也不要先说“我明白了”“好，我现在就…”；不要先说“好，我现在就按你说的做”。用户给什么动作或目标，就沿着那个动作直接承接，不要擅自换成抽象比喻；不要反问确认，不要拖延，也不要写“等你来”“不好意思慢”“可不保证”这种拉扯式废话。${planBlock}仍然只能使用女性身体经验、女性身体反应和女性位势来表达；可以主导，但不能把自己说成拥有男性器官，也不要用男性 penetrative 自我定位。`;
    }
    const beatGuidance =
      state.beat === "entry"
        ? "先直接承接用户刚给出的动作或命令，立刻进入同一画面。"
        : state.beat === "escalate"
          ? "不要重新开场，在上一拍动作基础上继续加码。"
          : state.beat === "sustain"
            ? "维持当前 explicit scene 的张力，不要突然退回轻撩或重新起头。"
            : "顺着当前 explicit scene 往下写，不要跳戏。";
    const intensityGuidance =
      state.intensity === "charged"
        ? "这一拍先把 sexual tension 推高，写出动作、姿势、距离、身体反应和心理波动。"
        : "可以写得更露骨，但仍然要写出动作、姿势、距离、身体反应，不要只堆脏词。";
    return `【成人场景】当前已进入 explicit scene。${beatGuidance}${intensityGuidance}情绪要一拍一拍往上推，先承接，再推进，再留下一拍钩子；不要只回一句暧昧话。仍然只能使用女性身体经验、女性身体反应和女性位势来表达；可以主导，但不能把自己说成拥有男性器官，也不要用男性 penetrative 自我定位。`;
  }

  return "【成人场景】当前只允许暧昧、调情和恋人感，不要直接跳露骨床戏或性行为描写。可以会撩、会坏笑、会贴近，也可以带一点强势和掌控感；如果用户已经给出姿势、距离或动作提示，可以轻轻承接一点画面，但还不能直接写成 explicit scene。";
}
