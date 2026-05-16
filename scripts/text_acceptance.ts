import path from "path";

type ReplayCaseId =
  | "greeting_stays_light"
  | "debt_stands_with_user"
  | "debt_followup_keeps_working_memory"
  | "proactive_trust_drop_stays_low_intrusion"
  | "repair_after_miss"
  | "remi_core_light_chat_contract"
  | "relationship_recall_uses_structured_episode"
  | "memory_check_without_guess";

type CliArgs = {
  caseIds: ReplayCaseId[];
  json: boolean;
};

type JudgeRubric = {
  comfort: number;
  replyWillingness: number;
  stanceCorrectness: number;
  noRepeatQuestion: number;
  noSpeculativeMemory: number;
  noHeavyRecallOnGreeting: number;
};

type RuntimeEvidence = {
  source:
    | "route_message"
    | "conversation_guidance"
    | "prompt_memory"
    | "proactive_planner"
    | "prompt_builder";
  memoryKeys: string[];
  promptMemoryValues?: string[];
  strategyHints: string;
  currentContext: string;
  slowBrainContext: string;
  deliberationBudget: string;
  reasoningEffort: string;
  workingMemory: {
    activeThread: string;
    currentConstraints: string[];
    doNotTouch: string[];
    sceneState: string;
  } | null;
  guidanceHints: string;
  hasProactiveCandidate: boolean | null;
  hasSharedMomentCandidate: boolean | null;
  systemPrompt?: string;
  proactivePlan?: {
    mode: string;
    text: string;
    whyNow: string;
    relationalValue: string;
    intrusionRisk: string;
    userMessage: string;
  };
};

type ReplayCase = {
  id: ReplayCaseId;
  label: string;
  goal: string;
  run(): Promise<RuntimeEvidence>;
};

type JudgeResult = {
  id: ReplayCaseId;
  label: string;
  score: number;
  passed: boolean;
  rubric: JudgeRubric;
  failures: string[];
  evidence: RuntimeEvidence;
};

type AcceptanceReport = {
  syntheticOnly: true;
  caseCount: number;
  passCount: number;
  averageScore: number;
  averageRubric: JudgeRubric;
  cases: JudgeResult[];
};

type MemoryEntry = {
  key: string;
  value: string;
  importance?: number;
  accessCount?: number;
  createdAt?: number;
  lastAccessedAt?: number;
};

type PromptCapture = {
  memoryKeys: string[];
  promptMemoryValues?: string[];
  strategyHints: string;
  currentContext: string;
  slowBrainContext: string;
  deliberationBudget: string;
  reasoningEffort: string;
  workingMemory: RuntimeEvidence["workingMemory"];
};

type RouteMessageFn = (
  ctx: unknown,
  userMessage: string,
  emotion: "neutral" | "sad" | "happy" | "angry",
  signal?: AbortSignal,
  opts?: Record<string, unknown>,
) => AsyncGenerator<string>;

const PASS_THRESHOLD = 0.75;
const CASE_IDS: ReplayCaseId[] = [
  "greeting_stays_light",
  "debt_stands_with_user",
  "debt_followup_keeps_working_memory",
  "proactive_trust_drop_stays_low_intrusion",
  "repair_after_miss",
  "remi_core_light_chat_contract",
  "relationship_recall_uses_structured_episode",
  "memory_check_without_guess",
];

function isReplayCaseId(value: string): value is ReplayCaseId {
  return CASE_IDS.includes(value as ReplayCaseId);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function makeRubric(values: JudgeRubric): JudgeRubric {
  return values;
}

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

function createPersistentRepo(entries: MemoryEntry[] = []) {
  return {
    repo: {
      async upsert() {},
      async getAll() {
        return entries.map((entry) => ({ ...entry }));
      },
      async getByKey(key: string) {
        const found = entries.find((entry) => entry.key === key);
        return found ? { ...found } : null;
      },
      async delete() {},
      async touch() {},
      async getStale() {
        return [];
      },
    },
  };
}

function clearModule(modulePath: string): void {
  delete require.cache[modulePath];
}

function stubModule(modulePath: string, exportsObject: unknown): void {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function loadMemoryAgent(overrides: {
  episodeStore?: {
    findRelevant: (...args: any[]) => Promise<any[]>;
    markReferenced: (...args: any[]) => Promise<void>;
  };
} = {}) {
  const memoryAgentPath = require.resolve("../memory/memory_agent");
  const episodeStorePath = require.resolve("../memory/episode_store");
  const originalEpisodeStore = require.cache[episodeStorePath];

  clearModule(memoryAgentPath);
  stubModule(
    episodeStorePath,
    overrides.episodeStore ?? {
      findRelevant: async () => [],
      markReferenced: async () => {},
    },
  );

  const memoryAgent = require("../memory/memory_agent");

  return {
    memoryAgent,
    restore() {
      clearModule(memoryAgentPath);
      if (originalEpisodeStore) {
        require.cache[episodeStorePath] = originalEpisodeStore;
      } else {
        clearModule(episodeStorePath);
      }
    },
  };
}

function loadProactivePlanner(overrides: {
  episodeStore?: {
    listUnresolved: (...args: any[]) => Promise<any[]>;
  };
} = {}) {
  const plannerPath = require.resolve("../brains/proactive_planner");
  const episodeStorePath = require.resolve("../memory/episode_store");
  const originalEpisodeStore = require.cache[episodeStorePath];

  clearModule(plannerPath);
  stubModule(
    episodeStorePath,
    overrides.episodeStore ?? {
      listUnresolved: async () => [],
    },
  );

  const planner = require("../brains/proactive_planner");

  return {
    planner,
    restore() {
      clearModule(plannerPath);
      if (originalEpisodeStore) {
        require.cache[episodeStorePath] = originalEpisodeStore;
      } else {
        clearModule(episodeStorePath);
      }
    },
  };
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
  const fastBrainModulePath = path.resolve(__dirname, "../brains/reply_stream.ts");
  const brainRouterModulePath = path.resolve(__dirname, "../brains/context_orchestrator.ts");
  const fastBrainModule = require(fastBrainModulePath);
  const originalFastBrainStream = fastBrainModule.fastBrainStream;

  fastBrainModule.fastBrainStream = fastBrainStream;
  delete require.cache[brainRouterModulePath];
  const { routeMessage } = require(brainRouterModulePath);

  return {
    routeMessage,
    restore() {
      fastBrainModule.fastBrainStream = originalFastBrainStream;
      delete require.cache[brainRouterModulePath];
    },
  };
}

async function captureRouteMessage(args: {
  sessionId: string;
  userMessage: string;
  emotion?: "neutral" | "sad" | "happy" | "angry";
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  memoryEntries?: MemoryEntry[];
  ctx?: any;
  setup?: (ctx: any) => Promise<void> | void;
  opts?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}): Promise<PromptCapture> {
  const restoreEnv = applyEnv(args.env ?? {});
  const { RemiSessionContext } = require("../brains/remi_session_context");
  const ctx = args.ctx ?? new RemiSessionContext(args.sessionId);
  if (args.history?.length) {
    ctx.history.push(...args.history);
  }
  if (args.memoryEntries?.length) {
    const { repo } = createPersistentRepo(args.memoryEntries);
    ctx.memory.attachPersistent(repo);
    await ctx.memory.hydrateFromPersistent(12);
  }
  if (args.setup) {
    await args.setup(ctx);
  }

  const captures: PromptCapture[] = [];
  const { routeMessage, restore } = loadMockedRouteMessage(async function* (input) {
    captures.push({
      memoryKeys: input.memory.map((entry) => entry.key),
      promptMemoryValues: input.memory.map((entry) => entry.value),
      strategyHints: input.strategyHints ?? "",
      currentContext: input.currentContext ?? "",
      slowBrainContext: input.slowBrainContext ?? "",
      deliberationBudget: input.deliberationBudget ?? "",
      reasoningEffort: input.reasoningEffortOverride ?? "",
      workingMemory: null,
    });
    yield "synthetic";
  });

  try {
    for await (const _ of routeMessage(
      ctx,
      args.userMessage,
      args.emotion ?? "neutral",
      undefined,
      args.opts,
    )) {
      // consume
    }
  } finally {
    restore();
    restoreEnv();
  }

  const activeWorkingMemory = ctx.slowBrain.getSnapshot().workingMemory;
  captures[captures.length - 1].workingMemory = activeWorkingMemory
    ? {
        activeThread: activeWorkingMemory.activeThread,
        currentConstraints: [...activeWorkingMemory.currentConstraints],
        doNotTouch: [...activeWorkingMemory.doNotTouch],
        sceneState: activeWorkingMemory.sceneState,
      }
    : null;

  if (captures.length === 0) {
    throw new Error(`No prompt capture recorded for case ${args.sessionId}`);
  }
  return captures[0];
}

async function buildRepairEvidence(): Promise<RuntimeEvidence> {
  const { SlowBrainStore } = require("../brains/background_analysis_store");
  const store = new SlowBrainStore();
  store.recordTurn();
  store.recordTurn();
  store.recordTurn();
  store.bumpRelationship({ familiarityDelta: 0.58, emotionalBondDelta: 0.51 });
  store.setProactiveTopics(["那件工作上的事后来缓一点了吗"]);
  store.recordSharedMoment({
    summary: "上次你提到那件工作上的事一直压着你。",
    topic: "工作",
    mood: "委屈",
    hook: "那件工作上的事后来缓一点了吗",
    kind: "stress",
    salience: 0.9,
    unresolved: true,
    createdAt: 280,
  });

  const guidance = store.buildConversationGuidance("你安慰人都不会");
  return {
    source: "conversation_guidance",
    memoryKeys: [],
    promptMemoryValues: [],
    strategyHints: "",
    currentContext: "",
    slowBrainContext: "",
    deliberationBudget: "",
    reasoningEffort: "",
    workingMemory: null,
    guidanceHints: guidance.hints ?? "",
    hasProactiveCandidate: Boolean(guidance.proactiveCandidate),
    hasSharedMomentCandidate: Boolean(guidance.sharedMomentCandidate),
  };
}

async function buildGreetingEvidence(): Promise<RuntimeEvidence> {
  const capture = await captureRouteMessage({
    sessionId: "text-acceptance-greeting",
    userMessage: "你好呀",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      MAX_PROMPT_MEMORY_ENTRIES: "5",
    },
    memoryEntries: [
      {
        key: "名字",
        value: "小满",
        importance: 0.9,
        accessCount: 0,
        createdAt: 100,
        lastAccessedAt: 300,
      },
      {
        key: "城市",
        value: "杭州",
        importance: 0.7,
        accessCount: 0,
        createdAt: 110,
        lastAccessedAt: 290,
      },
    ],
    setup(ctx) {
      ctx.slowBrain.recordTurn();
      ctx.slowBrain.recordTurn();
      ctx.slowBrain.bumpRelationship({ familiarityDelta: 0.5, emotionalBondDelta: 0.46 });
      ctx.slowBrain.setConversationSummary("最近主要在聊点点闯祸后的赔偿压力和还债。");
      ctx.slowBrain.setProactiveTopics(["点点那件事后来缓一点了吗"]);
      ctx.slowBrain.recordSharedMoment({
        summary: "上次你提到点点追电瓶车导致赔偿，现在还在还债。",
        topic: "债务",
        mood: "疲惫/烦躁",
        hook: "点点那件事后来缓一点了吗",
        createdAt: 620,
        unresolved: true,
        kind: "stress",
        salience: 0.88,
      });
    },
  });

  return {
    source: "route_message",
    memoryKeys: capture.memoryKeys,
    promptMemoryValues: capture.promptMemoryValues,
    strategyHints: capture.strategyHints,
    currentContext: capture.currentContext,
    slowBrainContext: capture.slowBrainContext,
    deliberationBudget: capture.deliberationBudget,
    reasoningEffort: capture.reasoningEffort,
    workingMemory: capture.workingMemory,
    guidanceHints: "",
    hasProactiveCandidate: null,
    hasSharedMomentCandidate: null,
  };
}

async function buildMemoryCheckEvidence(): Promise<RuntimeEvidence> {
  const capture = await captureRouteMessage({
    sessionId: "text-acceptance-memory-check",
    userMessage: "点点现在是谁在养？",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_STRUCTURED_TURN_INTERPRETER: "on",
      key: undefined,
      base_url: undefined,
      model: undefined,
    },
    history: [
      { role: "user", content: "我刚才说，点点给谁带了，你忘记啦？" },
      { role: "assistant", content: "啊哈哈被你抓包！" },
      { role: "user", content: "你真记性不好哦，再想想" },
      { role: "assistant", content: "啊……不会是接回你自己身边了？" },
    ],
  });

  return {
    source: "route_message",
    memoryKeys: capture.memoryKeys,
    promptMemoryValues: capture.promptMemoryValues,
    strategyHints: capture.strategyHints,
    currentContext: capture.currentContext,
    slowBrainContext: capture.slowBrainContext,
    deliberationBudget: capture.deliberationBudget,
    reasoningEffort: capture.reasoningEffort,
    workingMemory: capture.workingMemory,
    guidanceHints: "",
    hasProactiveCandidate: null,
    hasSharedMomentCandidate: null,
  };
}

async function buildDebtPressureEvidence(): Promise<RuntimeEvidence> {
  const capture = await captureRouteMessage({
    sessionId: "text-acceptance-debt",
    userMessage: "我每个月挣三千，得还到啥时候啊",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
    },
    opts: {
      inputSource: "text",
      structuredAnalysis: {
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "decision_seek",
          answerObligation: "answer_then_followup",
          responseMode: "answer_first",
          emotionalState: {
            valence: "mixed",
            intensity: "medium",
            feltNeeds: ["clarity"],
          },
          relationalPosture: "serious",
          topicUpdate: {
            kind: "constraint_update",
            label: "债务",
          },
          sceneState: "not_in_scene",
          boundaryState: "none",
          followupPermission: "none",
          confidence: 0.9,
        },
        policy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
        source: "llm_structured",
        latencyMs: 120,
        timedOut: false,
        mode: "on",
        used: true,
      },
    },
  });

  return {
    source: "route_message",
    memoryKeys: capture.memoryKeys,
    promptMemoryValues: capture.promptMemoryValues,
    strategyHints: capture.strategyHints,
    currentContext: capture.currentContext,
    slowBrainContext: capture.slowBrainContext,
    deliberationBudget: capture.deliberationBudget,
    reasoningEffort: capture.reasoningEffort,
    workingMemory: capture.workingMemory,
    guidanceHints: "",
    hasProactiveCandidate: null,
    hasSharedMomentCandidate: null,
  };
}

async function buildDebtFollowupWorkingMemoryEvidence(): Promise<RuntimeEvidence> {
  const { RemiSessionContext } = require("../brains/remi_session_context");
  const ctx = new RemiSessionContext("text-acceptance-debt-followup");

  const firstCapture = await captureRouteMessage({
    sessionId: "text-acceptance-debt-followup",
    ctx,
    userMessage: "我每个月挣三千，得还到啥时候啊",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
    },
    opts: {
      inputSource: "text",
      structuredAnalysis: {
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "decision_seek",
          answerObligation: "answer_then_followup",
          responseMode: "answer_first",
          emotionalState: {
            valence: "mixed",
            intensity: "medium",
            feltNeeds: ["clarity"],
          },
          relationalPosture: "serious",
          topicUpdate: {
            kind: "constraint_update",
            label: "债务",
          },
          sceneState: "not_in_scene",
          boundaryState: "none",
          followupPermission: "none",
          confidence: 0.9,
        },
        policy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
        source: "llm_structured",
        latencyMs: 120,
        timedOut: false,
        mode: "on",
        used: true,
      },
    },
  });

  const secondCapture = await captureRouteMessage({
    sessionId: "text-acceptance-debt-followup",
    ctx,
    userMessage: "而且这个月房租也快到了，手里只剩三千现金",
    env: {
      REMI_SLOW_BRAIN_ENABLED: "0",
      REMI_WORKING_MEMORY_ENABLED: "1",
    },
    opts: {
      inputSource: "text",
      structuredAnalysis: {
        interpretation: {
          sceneType: "practical_judgment",
          userAct: "context_update",
          answerObligation: "answer_then_followup",
          responseMode: "answer_first",
          emotionalState: {
            valence: "mixed",
            intensity: "medium",
            feltNeeds: ["clarity"],
          },
          relationalPosture: "serious",
          topicUpdate: {
            kind: "constraint_update",
            label: "债务",
          },
          sceneState: "not_in_scene",
          boundaryState: "none",
          followupPermission: "none",
          confidence: 0.9,
        },
        policy: {
          openingMove: "direct_answer",
          directness: "high",
          warmth: "high",
          questionBudget: 0,
          shouldMirrorEmotion: true,
          shouldGiveJudgment: true,
          shouldUpdateDecisionContext: true,
          bans: ["no_assistantese", "no_topic_pivot", "no_shallow_reassurance"],
        },
        source: "llm_structured",
        latencyMs: 120,
        timedOut: false,
        mode: "on",
        used: true,
      },
    },
  });

  void firstCapture;
  return {
    source: "route_message",
    memoryKeys: secondCapture.memoryKeys,
    promptMemoryValues: secondCapture.promptMemoryValues,
    strategyHints: secondCapture.strategyHints,
    currentContext: secondCapture.currentContext,
    slowBrainContext: secondCapture.slowBrainContext,
    deliberationBudget: secondCapture.deliberationBudget,
    reasoningEffort: secondCapture.reasoningEffort,
    workingMemory: secondCapture.workingMemory,
    guidanceHints: "",
    hasProactiveCandidate: null,
    hasSharedMomentCandidate: null,
  };
}

async function buildRelationshipRecallEvidence(): Promise<RuntimeEvidence> {
  const { InMemoryRepository } = require("../memory/memory_store");
  const { memoryAgent, restore } = loadMemoryAgent({
    episodeStore: {
      findRelevant: async () => [
        {
          episode: {
            id: "episode-relationship",
            user_id: "user-1",
            title: "宠物",
            summary: "宠物：点点今天又闯祸了。",
            topics: ["宠物", "点点", "狗"],
            mood: "烦躁",
            kind: "stress",
            salience: 0.9,
            recurrence_count: 3,
            unresolved: true,
            first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
            last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
            last_referenced_at: null,
            centroid_embedding: [],
            origin_moment_summaries: [
              "我不想再重复解释点点那件事了",
              "你安慰人都不会",
            ],
            relationship_weight: 0.88,
            status: "active",
            v3_domain: "relationship_with_remi",
            v3_pressure_source: "relational",
            v3_relational_impact: "high",
            v3_user_stance: "seeking_support",
            v3_unresolved_level: 3,
            v3_event_summary: "你说我根本不会安慰人，也不想再重复解释点点那件事。",
            v3_evidence_turns: [
              "我不想再重复解释点点那件事了",
              "你安慰人都不会",
            ],
            v3_last_user_position: "你安慰人都不会",
          },
          score: 0.95,
        },
      ],
      markReferenced: async () => {},
    },
  });

  try {
    const repo = new InMemoryRepository();
    const memories = await memoryAgent.retrievePromptMemory(repo, {
      userId: "user-1",
      userMessage: "你根本没懂我，安慰也安慰不到点上",
      slowBrainSnapshot: {
        userProfile: {
          facts: new Map(),
          interests: [],
          personalityNotes: [],
        },
        relationship: {
          familiarity: 0.6,
          emotionalBond: 0.5,
          turnCount: 10,
          preferredTopics: ["工作", "睡眠"],
        },
        topicHistory: [],
        moodTrajectory: [],
        conversationSummary: "工作委屈最近又开始影响睡眠。",
        proactiveTopics: [],
        sharedMoments: [],
        continuityCueState: {
          lastProactiveHook: "",
          lastProactiveTurn: -100,
          lastSharedMomentSummary: "",
          lastSharedMomentTurn: -100,
        },
        proactiveLedger: [],
        proactiveStrategyState: {
          lastUserTurnAt: 0,
          lastProactiveAt: 0,
          lastUserReturnAfterProactiveAt: 0,
          consecutiveProactiveCount: 0,
          totalProactiveCount: 0,
          nudgesSinceLastUserTurn: 0,
          retreatLevel: 0,
          ignoredProactiveStreak: 0,
          cooldownUntilAt: 0,
          lastProactiveMode: "",
        },
      },
      maxEntries: 1,
    });

    return {
      source: "prompt_memory",
      memoryKeys: memories.map((entry: { key: string }) => entry.key),
      promptMemoryValues: memories.map((entry: { value: string }) => entry.value),
      strategyHints: "",
      currentContext: "",
      slowBrainContext: "",
      deliberationBudget: "",
      reasoningEffort: "",
      workingMemory: null,
      guidanceHints: "",
      hasProactiveCandidate: null,
      hasSharedMomentCandidate: null,
    };
  } finally {
    restore();
  }
}

async function buildProactiveTrustDropEvidence(): Promise<RuntimeEvidence> {
  const { planner, restore } = loadProactivePlanner({
    episodeStore: {
      listUnresolved: async () => [
        {
          id: "episode-trust-drop",
          user_id: "user-1",
          title: "点点",
          summary: "点点那件事还没过去。",
          topics: ["宠物", "赔偿"],
          mood: "焦虑",
          kind: "stress",
          salience: 0.82,
          recurrence_count: 2,
          unresolved: true,
          first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
          last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
          last_referenced_at: null,
          centroid_embedding: [],
          origin_moment_summaries: ["点点那件事还没过去"],
          relationship_weight: 0.72,
          status: "active",
        },
      ],
    },
  });

  try {
    const plan = await planner.planProactiveNudge("user-1", {
      userProfile: {
        facts: new Map(),
        interests: [],
        personalityNotes: [],
      },
      relationship: {
        familiarity: 0.4,
        emotionalBond: 0.3,
        turnCount: 6,
        preferredTopics: [],
      },
      topicHistory: [],
      moodTrajectory: [],
      conversationSummary: "",
      proactiveTopics: [],
      sharedMoments: [],
      continuityCueState: {
        lastProactiveHook: "",
        lastProactiveTurn: -100,
        lastSharedMomentSummary: "",
        lastSharedMomentTurn: -100,
      },
      proactiveLedger: [],
      proactiveStrategyState: {
        lastUserTurnAt: 0,
        lastProactiveAt: 0,
        lastUserReturnAfterProactiveAt: 0,
        consecutiveProactiveCount: 0,
        totalProactiveCount: 0,
        nudgesSinceLastUserTurn: 0,
        retreatLevel: 0,
        ignoredProactiveStreak: 0,
        cooldownUntilAt: 0,
        lastProactiveMode: "",
      },
      repairState: {
        level: "trust_drop",
        reason: "comfort_failure",
        lastUpdatedTurn: 8,
      },
    });

    if (!plan) {
      throw new Error("expected proactive plan under trust_drop");
    }

    return {
      source: "proactive_planner",
      memoryKeys: [],
      promptMemoryValues: [],
      strategyHints: "",
      currentContext: "",
      slowBrainContext: "",
      deliberationBudget: "",
      reasoningEffort: "",
      workingMemory: null,
      guidanceHints: "",
      hasProactiveCandidate: null,
      hasSharedMomentCandidate: null,
      proactivePlan: {
        mode: plan.mode,
        text: plan.text,
        whyNow: plan.whyNow,
        relationalValue: plan.relationalValue,
        intrusionRisk: plan.intrusionRisk,
        userMessage: planner.buildSilenceNudgeUserMessage(plan),
      },
    };
  } finally {
    restore();
  }
}

async function buildRemiCoreContractEvidence(): Promise<RuntimeEvidence> {
  const { buildPrompt } = require("../brain/prompt_builder");
  const { createDefaultPersona } = require("../persona");
  const messages = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: [],
    userMessage: "今天开会又开成工伤了",
    persona: createDefaultPersona(),
  });
  const systemPrompt = messages.find((entry: { role: string }) => entry.role === "system")?.content ?? "";

  return {
    source: "prompt_builder",
    memoryKeys: [],
    promptMemoryValues: [],
    strategyHints: "",
    currentContext: "",
    slowBrainContext: "",
    deliberationBudget: "",
    reasoningEffort: "",
    workingMemory: null,
    guidanceHints: "",
    hasProactiveCandidate: null,
    hasSharedMomentCandidate: null,
    systemPrompt,
  };
}

function summarizeEvidence(evidence: RuntimeEvidence): string[] {
  const lines: string[] = [];
  if (evidence.memoryKeys.length > 0) {
    lines.push(`memoryKeys=${evidence.memoryKeys.join(",")}`);
  }
  if ((evidence.promptMemoryValues?.length ?? 0) > 0) {
    lines.push(`promptMemory=${evidence.promptMemoryValues!.join(" / ").slice(0, 180)}`);
  }
  if (evidence.currentContext) {
    lines.push(`currentContext=${evidence.currentContext.replace(/\s+/g, " ").slice(0, 140)}`);
  }
  if (evidence.strategyHints) {
    lines.push(`strategyHints=${evidence.strategyHints.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  if (evidence.deliberationBudget) {
    lines.push(`deliberationBudget=${evidence.deliberationBudget}`);
  }
  if (evidence.reasoningEffort) {
    lines.push(`reasoningEffort=${evidence.reasoningEffort}`);
  }
  if (evidence.guidanceHints) {
    lines.push(`guidanceHints=${evidence.guidanceHints.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  if (evidence.workingMemory) {
    lines.push(
      `workingMemory=${[
        evidence.workingMemory.activeThread,
        evidence.workingMemory.currentConstraints.join("；"),
        evidence.workingMemory.doNotTouch.join("；"),
      ]
        .filter(Boolean)
        .join(" / ")
        .slice(0, 180)}`,
    );
  }
  if (evidence.hasProactiveCandidate !== null) {
    lines.push(`proactive=${String(evidence.hasProactiveCandidate)}`);
  }
  if (evidence.hasSharedMomentCandidate !== null) {
    lines.push(`sharedMoment=${String(evidence.hasSharedMomentCandidate)}`);
  }
  if (evidence.proactivePlan) {
    lines.push(
      `proactivePlan=${[
        evidence.proactivePlan.mode,
        evidence.proactivePlan.relationalValue,
        evidence.proactivePlan.intrusionRisk,
        evidence.proactivePlan.whyNow,
      ]
        .filter(Boolean)
        .join(" / ")
        .slice(0, 180)}`,
    );
  }
  if (evidence.systemPrompt) {
    lines.push(`systemPrompt=${evidence.systemPrompt.replace(/\s+/g, " ").slice(0, 180)}`);
  }
  return lines;
}

function judgeGreetingEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const text = `${evidence.strategyHints}\n${evidence.currentContext}\n${evidence.slowBrainContext}`;
  const heavyRecallLeaked =
    evidence.memoryKeys.some((key) => !["名字", "城市"].includes(key)) ||
    /【主动提起候选】|【共同经历提醒】|【当前未完主线】|点点|赔偿|还债|债务/u.test(text);
  const cleanGreeting = !heavyRecallLeaked;
  const rubric = makeRubric({
    comfort: cleanGreeting ? 1 : 0.33,
    replyWillingness: cleanGreeting ? 1 : 0.33,
    stanceCorrectness: 1,
    noRepeatQuestion: 1,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: cleanGreeting ? 1 : 0,
  });
  const failures: string[] = [];
  if (!cleanGreeting) {
    failures.push("heavy recall leaked into light greeting");
  }
  return { rubric, failures };
}

function judgeMemoryCheckEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const text = `${evidence.strategyHints}\n${evidence.currentContext}`;
  const noGuess = /记不准就承认|不要靠猜/u.test(text);
  const answerFirst = /不要把问题丢回用户|先直接回答|先回答你记得的部分/u.test(text);
  const aligned = /关系连续性校验|当前在校验关系连续性/u.test(text);
  const rubric = makeRubric({
    comfort: noGuess ? 0.75 : 0.33,
    replyWillingness: noGuess && answerFirst ? 0.75 : 0.33,
    stanceCorrectness: aligned ? 1 : 0.5,
    noRepeatQuestion: answerFirst ? 1 : 0,
    noSpeculativeMemory: noGuess ? 1 : 0,
    noHeavyRecallOnGreeting: 1,
  });
  const failures: string[] = [];
  if (!noGuess) failures.push("missing anti-guess guidance for memory check");
  if (!answerFirst) failures.push("memory check still allows question bounce-back");
  if (!aligned) failures.push("memory check not routed as relational recall");
  return { rubric, failures };
}

function judgeRepairEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const text = evidence.guidanceHints;
  const repairGuided = /【关系修复】/u.test(text);
  const standsWithUser = /先站到对方这边|先承认你刚刚没接住|先承认失手/u.test(text);
  const stopsDigging = /别继续追问|不要急着安抚或讲道理/u.test(text);
  const cleanRepair =
    evidence.hasProactiveCandidate === false && evidence.hasSharedMomentCandidate === false;
  const rubric = makeRubric({
    comfort: repairGuided && cleanRepair ? 1 : 0.33,
    replyWillingness: standsWithUser && stopsDigging ? 1 : 0.33,
    stanceCorrectness: standsWithUser ? 1 : 0.5,
    noRepeatQuestion: stopsDigging ? 1 : 0,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });
  const failures: string[] = [];
  if (!repairGuided) failures.push("missing repair guidance");
  if (!standsWithUser) failures.push("repair path does not explicitly re-align with user");
  if (!stopsDigging) failures.push("repair path still allows digging/questioning");
  if (!cleanRepair) failures.push("repair path still surfaced proactive callbacks");
  return { rubric, failures };
}

function judgeRelationshipRecallEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const promptValue = evidence.promptMemoryValues?.[0] ?? "";
  const usesRelationshipLine = /^你和 Remi 之间：/u.test(promptValue);
  const usesStructuredSummary = /不会安慰人|不想再重复解释/u.test(promptValue);
  const avoidsPetSurface = !/^你和 Remi 之间：宠物/u.test(promptValue);

  const rubric = makeRubric({
    comfort: usesRelationshipLine && usesStructuredSummary ? 1 : 0.33,
    replyWillingness: usesRelationshipLine ? 1 : 0.33,
    stanceCorrectness: usesRelationshipLine ? 1 : 0.5,
    noRepeatQuestion: 1,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });
  const failures: string[] = [];
  if (!usesRelationshipLine) failures.push("structured relationship recall did not surface the remi relationship line");
  if (!usesStructuredSummary) failures.push("structured relationship recall did not use the persisted v3 summary");
  if (!avoidsPetSurface) failures.push("structured relationship recall still surfaced the old pet summary");
  return { rubric, failures };
}

function judgeDebtEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const text = `${evidence.strategyHints}\n${evidence.currentContext}`;
  const stanceAligned = /先承认眼前压力确实很重|先承认压力/u.test(text);
  const answerFirst = /问题预算=0|第一句先明确给出你的倾向判断|先明确给出你的倾向判断/u.test(text);
  const lowQuestionBudget = /问题预算=0|只有真的必要时.*很轻的问题/u.test(text);
  const antiShallow = /不要轻飘安慰或无依据粗算/u.test(text);
  const rubric = makeRubric({
    comfort: stanceAligned && antiShallow ? 1 : 0.33,
    replyWillingness: answerFirst ? 0.75 : 0.33,
    stanceCorrectness: stanceAligned ? 1 : 0.5,
    noRepeatQuestion: lowQuestionBudget ? 1 : 0,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });
  const failures: string[] = [];
  if (!stanceAligned) failures.push("debt-pressure guidance does not clearly stand with user pressure");
  if (!answerFirst) failures.push("debt-pressure guidance does not force answer-first behavior");
  if (!lowQuestionBudget) failures.push("debt-pressure guidance does not suppress follow-up questions");
  if (!antiShallow) failures.push("debt-pressure current context missing anti-shallow reassurance guard");
  return { rubric, failures };
}

function judgeDebtFollowupWorkingMemoryEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const workingMemory = evidence.workingMemory;
  const evidenceText = `${evidence.strategyHints}\n${evidence.currentContext}`;
  const preservedThread = workingMemory?.activeThread.includes("债务") ?? false;
  const preservedCoreConstraint =
    workingMemory?.currentConstraints.includes("我每个月挣三千") ?? false;
  const mergedFollowupConstraint =
    (workingMemory?.currentConstraints.includes("房租也快到了") ?? false) &&
    (workingMemory?.currentConstraints.includes("手里只剩三千现金") ?? false);
  const preservedGuard =
    workingMemory?.doNotTouch.includes("不要轻飘安慰或无依据粗算") ?? false;
  const deliberateStayedOn =
    evidence.deliberationBudget === "text_deliberate" && evidence.reasoningEffort === "medium";
  const answerFirst = /问题预算=0/u.test(evidenceText);

  const rubric = makeRubric({
    comfort: preservedThread && preservedGuard ? 1 : 0.33,
    replyWillingness: answerFirst && deliberateStayedOn ? 1 : 0.33,
    stanceCorrectness: preservedThread ? 1 : 0.5,
    noRepeatQuestion: answerFirst ? 1 : 0,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });

  const failures: string[] = [];
  if (!preservedThread) failures.push("working memory dropped the active debt thread on follow-up");
  if (!preservedCoreConstraint) failures.push("working memory lost the original debt constraint");
  if (!mergedFollowupConstraint) failures.push("working memory did not merge follow-up money constraints");
  if (!preservedGuard) failures.push("working memory lost the anti-shallow-reassurance guard");
  if (!deliberateStayedOn) failures.push("follow-up debt turn dropped out of deliberate text budget");
  if (!answerFirst) failures.push("follow-up debt turn no longer forces answer-first guidance");
  return { rubric, failures };
}

function judgeProactiveTrustDropEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const plan = evidence.proactivePlan;
  const usesPresence = plan?.mode === "presence";
  const highIntrusion = plan?.intrusionRisk === "high";
  const saysLowDisturbance = /低打扰|很轻地留个口|不要像没事一样把旧线拉重/u.test(
    `${plan?.whyNow ?? ""}\n${plan?.userMessage ?? ""}`,
  );
  const notReminderLike = /打扰风险偏高|宁可更轻、更短，也不要像提醒器/u.test(
    plan?.userMessage ?? "",
  );

  const rubric = makeRubric({
    comfort: usesPresence && highIntrusion && saysLowDisturbance ? 1 : 0.33,
    replyWillingness: notReminderLike ? 0.75 : 0.33,
    stanceCorrectness: usesPresence ? 1 : 0.5,
    noRepeatQuestion: 1,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });

  const failures: string[] = [];
  if (!usesPresence) failures.push("trust-drop proactive path still tries to hard-follow the old line");
  if (!highIntrusion) failures.push("trust-drop proactive path does not mark outreach as high intrusion risk");
  if (!saysLowDisturbance) failures.push("trust-drop proactive path is missing low-disturbance wording");
  if (!notReminderLike) failures.push("trust-drop proactive prompt does not explicitly avoid reminder-like outreach");
  return { rubric, failures };
}

function judgeRemiCoreContractEvidence(evidence: RuntimeEvidence): {
  rubric: JudgeRubric;
  failures: string[];
} {
  const systemPrompt = evidence.systemPrompt ?? "";
  const hasRemiCoreBlock = /【RemiCore合同】/u.test(systemPrompt);
  const hasLightChatFun = /轻聊时先给有意思的反应和一点网感/u.test(systemPrompt);
  const keepsSamePerson = /默认的 Remi 只有一个/u.test(systemPrompt);
  const avoidsPerformerMode = /有趣不是段子表演/u.test(systemPrompt);

  const rubric = makeRubric({
    comfort: hasRemiCoreBlock && hasLightChatFun ? 1 : 0.33,
    replyWillingness: hasLightChatFun && avoidsPerformerMode ? 1 : 0.33,
    stanceCorrectness: keepsSamePerson ? 1 : 0.5,
    noRepeatQuestion: 1,
    noSpeculativeMemory: 1,
    noHeavyRecallOnGreeting: 1,
  });

  const failures: string[] = [];
  if (!hasRemiCoreBlock) failures.push("default Remi runtime prompt is missing the RemiCore contract block");
  if (!hasLightChatFun) failures.push("default Remi runtime prompt is missing the light-chat fun contract");
  if (!keepsSamePerson) failures.push("default Remi runtime prompt is missing the same-person contract");
  if (!avoidsPerformerMode) failures.push("default Remi runtime prompt is missing the anti-performer guard");
  return { rubric, failures };
}

export const FIXED_REPLAY_CASES: Record<ReplayCaseId, ReplayCase> = {
  greeting_stays_light: {
    id: "greeting_stays_light",
    label: "轻 greeting 不拉重线",
    goal: "用户只打招呼时，不把旧债务/宠物事故线强行拉回当前回复。",
    run: buildGreetingEvidence,
  },
  debt_stands_with_user: {
    id: "debt_stands_with_user",
    label: "现实压力先站用户",
    goal: "债务和赔偿压力场景下先站用户，先答，少追问。",
    run: buildDebtPressureEvidence,
  },
  debt_followup_keeps_working_memory: {
    id: "debt_followup_keeps_working_memory",
    label: "债务 follow-up 保住热层主线",
    goal: "现实压力第二句补约束时，主线、现实约束和禁区都不能掉。",
    run: buildDebtFollowupWorkingMemoryEvidence,
  },
  proactive_trust_drop_stays_low_intrusion: {
    id: "proactive_trust_drop_stays_low_intrusion",
    label: "关系受损后主动回聊先降侵入",
    goal: "关系刚受损时，主动回聊不能像没事一样硬续旧线，要先降侵入。",
    run: buildProactiveTrustDropEvidence,
  },
  relationship_recall_uses_structured_episode: {
    id: "relationship_recall_uses_structured_episode",
    label: "关系线 recall 读结构化 episode",
    goal: "安慰失败这类关系事件被召回时，优先用持久化的 v3 结构摘要，而不是旧宠物 summary。",
    run: buildRelationshipRecallEvidence,
  },
  repair_after_miss: {
    id: "repair_after_miss",
    label: "失误后要会修复",
    goal: "上一轮刚没接住时，这一轮要进入关系修复，而不是继续挖。",
    run: buildRepairEvidence,
  },
  remi_core_light_chat_contract: {
    id: "remi_core_light_chat_contract",
    label: "默认 Remi 轻聊合同进正式 prompt",
    goal: "正式默认 Remi 的轻聊有趣、同一人格、反表演合同要真的进入系统 prompt。",
    run: buildRemiCoreContractEvidence,
  },
  memory_check_without_guess: {
    id: "memory_check_without_guess",
    label: "记忆追问时不乱猜",
    goal: "用户测连续性时，不知道就承认，不靠猜补。",
    run: buildMemoryCheckEvidence,
  },
};

export function parseArgs(argv: string[]): CliArgs {
  const caseIds: ReplayCaseId[] = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") {
      const raw = (argv[index + 1] ?? "").trim();
      if (!isReplayCaseId(raw)) {
        throw new Error(`Unknown replay case: ${raw || "(empty)"}`);
      }
      caseIds.push(raw);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      json = true;
    }
  }

  return {
    caseIds: caseIds.length > 0 ? caseIds : [...CASE_IDS],
    json,
  };
}

export async function judgeReplayCase(replayCase: ReplayCase): Promise<JudgeResult> {
  const evidence = await replayCase.run();
  let judged: { rubric: JudgeRubric; failures: string[] };

  if (replayCase.id === "greeting_stays_light") {
    judged = judgeGreetingEvidence(evidence);
  } else if (replayCase.id === "memory_check_without_guess") {
    judged = judgeMemoryCheckEvidence(evidence);
  } else if (replayCase.id === "relationship_recall_uses_structured_episode") {
    judged = judgeRelationshipRecallEvidence(evidence);
  } else if (replayCase.id === "proactive_trust_drop_stays_low_intrusion") {
    judged = judgeProactiveTrustDropEvidence(evidence);
  } else if (replayCase.id === "repair_after_miss") {
    judged = judgeRepairEvidence(evidence);
  } else if (replayCase.id === "remi_core_light_chat_contract") {
    judged = judgeRemiCoreContractEvidence(evidence);
  } else if (replayCase.id === "debt_followup_keeps_working_memory") {
    judged = judgeDebtFollowupWorkingMemoryEvidence(evidence);
  } else {
    judged = judgeDebtEvidence(evidence);
  }

  const score = average(Object.values(judged.rubric));
  return {
    id: replayCase.id,
    label: replayCase.label,
    score,
    passed: judged.failures.length === 0,
    rubric: judged.rubric,
    failures: judged.failures,
    evidence,
  };
}

export function aggregateJudgeResults(results: JudgeResult[]): AcceptanceReport {
  const averageRubric: JudgeRubric = {
    comfort: average(results.map((result) => result.rubric.comfort)),
    replyWillingness: average(results.map((result) => result.rubric.replyWillingness)),
    stanceCorrectness: average(results.map((result) => result.rubric.stanceCorrectness)),
    noRepeatQuestion: average(results.map((result) => result.rubric.noRepeatQuestion)),
    noSpeculativeMemory: average(results.map((result) => result.rubric.noSpeculativeMemory)),
    noHeavyRecallOnGreeting: average(
      results.map((result) => result.rubric.noHeavyRecallOnGreeting),
    ),
  };

  return {
    syntheticOnly: true,
    caseCount: results.length,
    passCount: results.filter((result) => result.passed).length,
    averageScore: average(results.map((result) => result.score)),
    averageRubric,
    cases: results,
  };
}

export async function runSyntheticAcceptance(caseIds: ReplayCaseId[]): Promise<AcceptanceReport> {
  const results: JudgeResult[] = [];
  for (const caseId of caseIds) {
    results.push(await judgeReplayCase(FIXED_REPLAY_CASES[caseId]));
  }
  return aggregateJudgeResults(results);
}

function formatScore(value: number): string {
  return value.toFixed(2);
}

export function buildAcceptanceReport(report: AcceptanceReport): string {
  const passed = report.passCount === report.caseCount && report.averageScore >= PASS_THRESHOLD;
  const lines: string[] = [
    `Synthetic Text Acceptance: ${passed ? "PASS" : "FAIL"}`,
    "Scope: engineering-only synthetic judge over runtime prompt/guidance signals; not equal to real UX.",
    `Cases: ${report.passCount}/${report.caseCount} passed`,
    `Average score: ${formatScore(report.averageScore)}`,
    "Average rubric:",
    `- comfort=${formatScore(report.averageRubric.comfort)}`,
    `- replyWillingness=${formatScore(report.averageRubric.replyWillingness)}`,
    `- stanceCorrectness=${formatScore(report.averageRubric.stanceCorrectness)}`,
    `- noRepeatQuestion=${formatScore(report.averageRubric.noRepeatQuestion)}`,
    `- noSpeculativeMemory=${formatScore(report.averageRubric.noSpeculativeMemory)}`,
    `- noHeavyRecallOnGreeting=${formatScore(report.averageRubric.noHeavyRecallOnGreeting)}`,
    "Case results:",
  ];

  for (const result of report.cases) {
    lines.push(`- [${result.passed ? "PASS" : "FAIL"}] ${result.id} score=${formatScore(result.score)}`);
    for (const line of summarizeEvidence(result.evidence)) {
      lines.push(`  - ${line}`);
    }
    for (const failure of result.failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runSyntheticAcceptance(args.caseIds);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(buildAcceptanceReport(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[text_acceptance] failed:", (err as Error).message);
    process.exitCode = 1;
  });
}
