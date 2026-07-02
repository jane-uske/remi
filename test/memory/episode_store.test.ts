const assert = require("assert").strict;

function clearModule(modulePath) {
  delete require.cache[modulePath];
}

function applyEnv(values) {
  const previous = {};
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

function stubModule(modulePath, exportsObject) {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports: exportsObject,
  };
}

function loadEpisodeStore(overrides = {}) {
  const episodeStorePath = require.resolve("../../memory/episode_store");
  const embeddingClientPath = require.resolve("../../llm/embedding_client");
  const episodeRepositoryPath = require.resolve("../../storage/repositories/episode_repository");
  const databasePath = require.resolve("../../storage/database");
  const originalEmbeddingClient = require.cache[embeddingClientPath];
  const originalEpisodeRepository = require.cache[episodeRepositoryPath];
  const originalDatabase = require.cache[databasePath];

  clearModule(episodeStorePath);

  stubModule(embeddingClientPath, overrides.embeddingClient ?? { embed: async () => [] });
  stubModule(episodeRepositoryPath, overrides.episodeRepository ?? {
    insertEpisode: async () => null,
    updateEpisode: async () => null,
    findSimilarEpisodes: async () => [],
    getUnresolvedEpisodes: async () => [],
  });
  // 只有显式传入 database 覆盖时才 stub storage/database，默认保留真实模块，
  // 不改变既有用例（依赖真实 isDatabaseReady() 短路为 false）的行为。
  if (overrides.database) {
    stubModule(databasePath, overrides.database);
  }

  const episodeStore = require("../../memory/episode_store");

  return {
    episodeStore,
    restore() {
      clearModule(episodeStorePath);
      if (originalEmbeddingClient) {
        require.cache[embeddingClientPath] = originalEmbeddingClient;
      } else {
        clearModule(embeddingClientPath);
      }
      if (originalEpisodeRepository) {
        require.cache[episodeRepositoryPath] = originalEpisodeRepository;
      } else {
        clearModule(episodeRepositoryPath);
      }
      if (overrides.database) {
        if (originalDatabase) {
          require.cache[databasePath] = originalDatabase;
        } else {
          clearModule(databasePath);
        }
      }
    },
  };
}

function makeVector(seedValues) {
  const vector = new Array(768).fill(0);
  seedValues.forEach((value, index) => {
    vector[index] = value;
  });
  return vector;
}

function makeEpisode(overrides = {}) {
  return {
    id: "episode-1",
    user_id: "user-1",
    title: "睡眠",
    summary: "睡眠：最近又失眠了",
    topics: ["睡眠"],
    mood: "tired",
    kind: "unresolved",
    salience: 0.6,
    recurrence_count: 2,
    unresolved: true,
    first_seen_at: new Date("2026-04-01T00:00:00.000Z"),
    last_seen_at: new Date("2026-04-10T00:00:00.000Z"),
    last_referenced_at: null,
    centroid_embedding: makeVector([1, 0, 0]),
    origin_moment_summaries: ["第一条", "第二条"],
    relationship_weight: 0.4,
    status: "active",
    ...overrides,
  };
}

describe("episode_store", () => {
  afterEach(() => {
    const episodeStorePath = require.resolve("../../memory/episode_store");
    clearModule(episodeStorePath);
  });

  it("ingest creates a new episode when no similar episode exists", async () => {
    const calls = {
      embed: [],
      insert: [],
    };
    const insertResult = makeEpisode({
      recurrence_count: 1,
      centroid_embedding: makeVector([0.4, 0.5, 0.6]),
      origin_moment_summaries: ["昨晚又失眠了"],
      salience: 0.7,
      relationship_weight: 0.7,
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async (text) => {
          calls.embed.push(text);
          return makeVector([0.4, 0.5, 0.6]);
        },
      },
      episodeRepository: {
        insertEpisode: async (params) => {
          calls.insert.push(params);
          return insertResult;
        },
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "昨晚又失眠了",
        topic: "睡眠",
        mood: "tired",
        kind: "unresolved",
        salience: 0.7,
        unresolved: true,
      });

      assert.equal(calls.embed[0], "昨晚又失眠了 睡眠 tired");
      assert.equal(calls.insert.length, 1);
      assert.deepEqual(calls.insert[0], {
        userId: "user-1",
        title: "睡眠",
        summary: "睡眠：昨晚又失眠了",
        topics: ["睡眠"],
        mood: "tired",
        kind: "unresolved",
        salience: 0.7,
        unresolved: true,
        status: "active",
        centroidEmbedding: makeVector([0.4, 0.5, 0.6]),
        originMomentSummaries: ["昨晚又失眠了"],
        relationshipWeight: 0.7,
        v3Domain: "other",
        v3PressureSource: "unknown",
        v3RelationalImpact: "low",
        v3UserStance: "neutral",
        v3UnresolvedLevel: 3,
        v3EventSummary: "睡眠:昨晚又失眠了",
        v3EvidenceTurns: ["昨晚又失眠了"],
        v3LastUserPosition: "昨晚又失眠了",
      });
      assert.equal(episode, insertResult);
    } finally {
      restore();
    }
  });

  it("ingest merges into an existing episode when similarity is above threshold", async () => {
    const calls = {
      update: [],
    };
    const existing = makeEpisode({
      recurrence_count: 2,
      centroid_embedding: makeVector([10, 0]),
      origin_moment_summaries: ["第一条", "第二条"],
      salience: 0.6,
      relationship_weight: 0.4,
    });
    const updatedResult = makeEpisode({
      recurrence_count: 3,
      centroid_embedding: makeVector([10, 1 / 3]),
      origin_moment_summaries: ["第一条", "第二条", "第三条"],
      salience: 0.9,
      relationship_weight: 0.9,
      summary: "睡眠：第三条",
      mood: "worried",
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([10, 1]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          throw new Error("insertEpisode should not be called");
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return updatedResult;
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "第三条",
        topic: "睡眠",
        mood: "worried",
        kind: "unresolved",
        salience: 0.9,
        unresolved: false,
      });

      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].id, "episode-1");
      assert.equal(calls.update[0].params.recurrenceCount, 3);
      assert.equal(calls.update[0].params.salience, 0.9);
      assert.deepEqual(calls.update[0].params.originMomentSummaries, ["第一条", "第二条", "第三条"]);
      assert.deepEqual(calls.update[0].params.centroidEmbedding.slice(0, 2), [10, 1 / 3]);
      assert.equal(calls.update[0].params.relationshipWeight, 0.9);
      assert.equal(calls.update[0].params.status, "active");
      assert.equal(calls.update[0].params.unresolved, true);
      assert.equal(calls.update[0].params.v3Domain, "other");
      assert.equal(calls.update[0].params.v3PressureSource, "unknown");
      assert.equal(calls.update[0].params.v3RelationalImpact, "low");
      assert.equal(calls.update[0].params.v3UserStance, "neutral");
      assert.equal(calls.update[0].params.v3UnresolvedLevel, 3);
      assert.deepEqual(calls.update[0].params.v3EvidenceTurns, ["第一条", "第二条", "第三条"]);
      assert.equal(calls.update[0].params.v3LastUserPosition, "第三条");
      assert.equal(episode, updatedResult);
    } finally {
      restore();
    }
  });

  it("ingest creates a new episode when similarity is below threshold", async () => {
    const calls = {
      insert: 0,
      update: 0,
    };
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([0, 1]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          calls.insert += 1;
          return makeEpisode({ id: "episode-new", recurrence_count: 1 });
        },
        updateEpisode: async () => {
          calls.update += 1;
          return null;
        },
        findSimilarEpisodes: async () => [makeEpisode({ centroid_embedding: makeVector([1, 0]) })],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.ingest({
        userId: "user-1",
        summary: "换了一个完全不同的话题",
        topic: "工作",
        mood: "neutral",
        kind: "milestone",
        salience: 0.5,
        unresolved: false,
      });

      assert.equal(calls.insert, 1);
      assert.equal(calls.update, 0);
    } finally {
      restore();
    }
  });

  it("ingest does not merge a new discrete topic into an overly broad episode", async () => {
    const calls = {
      insert: [],
      update: [],
    };
    const existing = makeEpisode({
      title: "工作",
      summary: "工作：最近总在继续聊工作",
      topics: ["工作", "美食", "音乐", "影视动漫", "感情", "游戏"],
      recurrence_count: 16,
      centroid_embedding: makeVector([10, 0]),
      origin_moment_summaries: [
        "最近工作压力还是很大",
        "昨天又聊到想吃火锅",
        "今天分享了最近在听的歌",
        "还提到了最近在追的动漫",
      ],
      salience: 0.8,
    });
    const insertResult = makeEpisode({
      id: "episode-new",
      title: "旅游",
      summary: "旅游：准备去海边散心",
      topics: ["旅游"],
      recurrence_count: 1,
      centroid_embedding: makeVector([10, 1]),
      origin_moment_summaries: ["准备去海边散心"],
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([10, 1]),
      },
      episodeRepository: {
        insertEpisode: async (params) => {
          calls.insert.push(params);
          return insertResult;
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return existing;
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "准备去海边散心",
        topic: "旅游",
        mood: "excited",
        kind: "plan",
        salience: 0.7,
        unresolved: false,
      });

      assert.equal(calls.update.length, 0);
      assert.equal(calls.insert.length, 1);
      assert.equal(calls.insert[0].title, "旅游");
      assert.equal(episode, insertResult);
    } finally {
      restore();
    }
  });

  it("ingest still merges same-topic moments into a narrow episode", async () => {
    const calls = {
      insert: 0,
      update: [],
    };
    const existing = makeEpisode({
      title: "工作",
      summary: "工作：这个项目最近有点卡",
      topics: ["工作"],
      recurrence_count: 2,
      unresolved: false,
      status: "cooling",
      centroid_embedding: makeVector([10, 0]),
      origin_moment_summaries: ["这个项目最近有点卡", "这周工作压力有点大"],
    });
    const updatedResult = makeEpisode({
      title: "工作",
      summary: "工作：今天开会还是在聊项目进度",
      topics: ["工作"],
      recurrence_count: 3,
      unresolved: false,
      status: "cooling",
      centroid_embedding: makeVector([10, 1 / 3]),
      origin_moment_summaries: ["这个项目最近有点卡", "这周工作压力有点大", "今天开会还是在聊项目进度"],
      mood: "stressed",
      salience: 0.8,
      relationship_weight: 0.8,
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([10, 1]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          calls.insert += 1;
          return null;
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return updatedResult;
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const episode = await episodeStore.ingest({
        userId: "user-1",
        summary: "今天开会还是在聊项目进度",
        topic: "工作",
        mood: "stressed",
        kind: "routine",
        salience: 0.8,
        unresolved: false,
      });

      assert.equal(calls.insert, 0);
      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].id, "episode-1");
      assert.equal(calls.update[0].params.recurrenceCount, 3);
      assert.deepEqual(calls.update[0].params.topics, ["工作"]);
      assert.equal(calls.update[0].params.summary, "工作：今天开会还是在聊项目进度");
      assert.equal(episode, updatedResult);
    } finally {
      restore();
    }
  });

  it("findRelevant ranks episodes by blended score", async () => {
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T00:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "high-cosine",
            centroid_embedding: makeVector([1, 0]),
            salience: 0.4,
            unresolved: false,
            last_seen_at: new Date("2026-04-02T00:00:00.000Z"),
          }),
          makeEpisode({
            id: "unresolved-recent",
            centroid_embedding: makeVector([0.8, 0.2]),
            salience: 0.7,
            unresolved: true,
            last_seen_at: new Date("2026-04-11T00:00:00.000Z"),
          }),
          makeEpisode({
            id: "stale-low",
            centroid_embedding: makeVector([0.5, 0.5]),
            salience: 0.2,
            unresolved: false,
            last_seen_at: new Date("2026-03-01T00:00:00.000Z"),
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "最近睡得怎么样");

      assert.deepEqual(
        ranked.map((entry) => entry.episode.id),
        ["unresolved-recent", "high-cosine", "stale-low"],
      );
      assert.equal(ranked[0].score > ranked[1].score, true);
      assert.equal(ranked[1].score > ranked[2].score, true);
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("findRelevant demotes wide recently referenced episodes on weakly anchored queries", async () => {
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T06:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "wide-recent",
            title: "工作",
            summary: "工作：最近总在继续聊工作",
            topics: ["工作", "美食", "音乐", "影视动漫", "感情", "游戏"],
            salience: 0.95,
            recurrence_count: 12,
            unresolved: false,
            last_seen_at: new Date("2026-04-12T05:00:00.000Z"),
            last_referenced_at: new Date("2026-04-12T04:30:00.000Z"),
            centroid_embedding: makeVector([1, 0]),
            origin_moment_summaries: [
              "最近工作压力还是很大",
              "昨天又聊到想吃火锅",
              "今天分享了最近在听的歌",
              "还提到了最近在追的动漫",
            ],
          }),
          makeEpisode({
            id: "sleep-line",
            title: "睡眠",
            summary: "睡眠：昨晚又没睡好。",
            topics: ["睡眠"],
            salience: 0.55,
            recurrence_count: 2,
            unresolved: false,
            last_seen_at: new Date("2026-04-08T00:00:00.000Z"),
            last_referenced_at: new Date("2026-04-01T00:00:00.000Z"),
            centroid_embedding: makeVector([0.6, 0.4]),
            origin_moment_summaries: ["昨晚又没睡好", "这周一直浅睡"],
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "我昨晚又没睡好");

      assert.deepEqual(
        ranked.map((entry) => entry.episode.id),
        ["sleep-line", "wide-recent"],
      );
      assert.equal(ranked[0].score > ranked[1].score, true);
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("findRelevant exempts a recently referenced episode from the strong penalty when the user actively follows up on it", async () => {
    // 场景："对了，上次说的那个岗位后来怎么样了" —— 用户主动跟进面试这条线，
    // 该 episode 1 小时前刚被引用过（在 6h 复读惩罚窗口内），且查询与其
    // 词面锚点完全不重叠（topicAnchorHit=false, lexicalOverlap=0，已用
    // extractKeywords 验证），只有余弦相似度这一个信号能救回它。
    // episode 本身结构窄（1 个 topic、1 条 origin summary、recurrence 低），
    // 不是宽泛合集，因此符合"结构上可信"的豁免前提。
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T06:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "interview-followup",
            title: "面试",
            summary: "面试：上周投了简历在等消息",
            topics: ["面试"],
            salience: 0.6,
            recurrence_count: 1,
            unresolved: true,
            last_seen_at: new Date("2026-04-12T04:00:00.000Z"),
            last_referenced_at: new Date("2026-04-12T05:00:00.000Z"),
            centroid_embedding: makeVector([1, 0]),
            origin_moment_summaries: ["上周投了简历在等消息"],
          }),
          makeEpisode({
            id: "unrelated-noise",
            title: "健身",
            summary: "健身：办了张健身卡",
            topics: ["健身"],
            salience: 0.3,
            recurrence_count: 1,
            unresolved: false,
            last_seen_at: new Date("2026-03-01T00:00:00.000Z"),
            last_referenced_at: null,
            centroid_embedding: makeVector([0, 1]),
            origin_moment_summaries: ["办了张健身卡"],
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
      database: { isDatabaseReady: () => true },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "对了那个岗位后来怎么样了");

      const followUp = ranked.find((entry) => entry.episode.id === "interview-followup");
      assert.ok(followUp, "跟进目标 episode 应该出现在召回结果里");
      assert.equal(ranked[0].episode.id, "interview-followup");
      assert.equal(followUp.diagnostics.recentReferencePenaltyKind, "followup");
      assert.equal(followUp.diagnostics.followUpExemptionApplied, true);
      assert.equal(followUp.diagnostics.isBatchTopCosine, true);
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("findRelevant keeps the strong penalty on a wide, weakly anchored episode surfaced by chit-chat drift even if its raw cosine is highest", async () => {
    // 场景：闲聊漂移带出一个宽泛合集 episode（多话题、高 recurrence、
    // 多条 origin summary），即使它恰好是本批次余弦最高（人为构造成和
    // query 同向量，cosine=1），也不该被判定为"用户主动跟进"——因为它
    // isTooWideForCrossTopicMerge()=true，质心早已被多个话题稀释，
    // 高余弦是漂移带出的假象而非可信的主题命中。应继续吃 STRONG 惩罚，
    // 排名让位给更窄、更对题、且不在惩罚窗口内的 episode。
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T06:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "wide-drift",
            title: "工作",
            summary: "工作：最近总在继续聊工作",
            topics: ["工作", "美食", "音乐", "影视动漫", "感情", "游戏"],
            salience: 0.95,
            recurrence_count: 12,
            unresolved: false,
            last_seen_at: new Date("2026-04-12T05:00:00.000Z"),
            last_referenced_at: new Date("2026-04-12T05:30:00.000Z"),
            centroid_embedding: makeVector([1, 0]),
            origin_moment_summaries: [
              "最近工作压力还是很大",
              "昨天又聊到想吃火锅",
              "今天分享了最近在听的歌",
              "还提到了最近在追的动漫",
            ],
          }),
          makeEpisode({
            id: "narrow-untouched",
            title: "阅读",
            summary: "阅读：在看一本新小说",
            topics: ["阅读"],
            salience: 0.5,
            recurrence_count: 1,
            unresolved: false,
            last_seen_at: new Date("2026-04-11T00:00:00.000Z"),
            last_referenced_at: null,
            centroid_embedding: makeVector([0.7, 0.3]),
            origin_moment_summaries: ["在看一本新小说"],
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
      database: { isDatabaseReady: () => true },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "随便聊聊今天心情还行");

      const drifted = ranked.find((entry) => entry.episode.id === "wide-drift");
      assert.ok(drifted, "宽泛 episode 仍应作为候选出现（只是被压分）");
      assert.equal(drifted.diagnostics.recentReferencePenaltyKind, "strong");
      assert.equal(drifted.diagnostics.followUpExemptionApplied, false);
      assert.equal(
        ranked.map((entry) => entry.episode.id).indexOf("narrow-untouched") <
          ranked.map((entry) => entry.episode.id).indexOf("wide-drift"),
        true,
        "更窄、未被惩罚的 episode 应该排在被复读惩罚压制的宽泛 episode 之前",
      );
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("findRelevant returns an empty array when repository returns no episodes", async () => {
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "hello");
      assert.deepEqual(ranked, []);
    } finally {
      restore();
    }
  });

  it("moves active episodes into cooling when lifecycle is enabled and the new turn is no longer unresolved", async () => {
    const restoreEnv = applyEnv({ REMI_EPISODE_LIFECYCLE_ENABLED: "1" });
    const calls = {
      update: [],
    };
    const existing = makeEpisode({
      status: "active",
      unresolved: true,
      centroid_embedding: makeVector([1, 0]),
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          throw new Error("insertEpisode should not be called");
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return makeEpisode({
            status: params.status,
            unresolved: params.unresolved,
          });
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.ingest({
        userId: "user-1",
        summary: "这两天我只是又提了一下睡眠这条线",
        topic: "睡眠",
        mood: "tired",
        kind: "routine",
        salience: 0.5,
        unresolved: false,
        statusHint: "cooling",
      });

      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].params.status, "cooling");
      assert.equal(calls.update[0].params.unresolved, false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("reopens resolved episodes to active when lifecycle is enabled and a new unresolved turn hits the same line", async () => {
    const restoreEnv = applyEnv({ REMI_EPISODE_LIFECYCLE_ENABLED: "1" });
    const calls = {
      update: [],
    };
    const existing = makeEpisode({
      status: "resolved",
      unresolved: false,
      centroid_embedding: makeVector([1, 0]),
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          throw new Error("insertEpisode should not be called");
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return makeEpisode({
            status: params.status,
            unresolved: params.unresolved,
          });
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.ingest({
        userId: "user-1",
        summary: "这件事其实还没过去，我还是会因为它难受",
        topic: "睡眠",
        mood: "worried",
        kind: "stress",
        salience: 0.9,
        unresolved: true,
        statusHint: "active",
      });

      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].params.status, "active");
      assert.equal(calls.update[0].params.unresolved, true);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("moves cooling episodes into resolved when lifecycle is enabled and the user closes the loop", async () => {
    const restoreEnv = applyEnv({ REMI_EPISODE_LIFECYCLE_ENABLED: "1" });
    const calls = {
      update: [],
    };
    const existing = makeEpisode({
      status: "cooling",
      unresolved: false,
      centroid_embedding: makeVector([1, 0]),
    });
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => {
          throw new Error("insertEpisode should not be called");
        },
        updateEpisode: async (id, params) => {
          calls.update.push({ id, params });
          return makeEpisode({
            status: params.status,
            unresolved: params.unresolved,
          });
        },
        findSimilarEpisodes: async () => [existing],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.ingest({
        userId: "user-1",
        summary: "这件事已经过去了，不用再聊了",
        topic: "睡眠",
        mood: "relieved",
        kind: "routine",
        salience: 0.4,
        unresolved: false,
        statusHint: "resolved",
      });

      assert.equal(calls.update.length, 1);
      assert.equal(calls.update[0].params.status, "resolved");
      assert.equal(calls.update[0].params.unresolved, false);
    } finally {
      restore();
      restoreEnv();
    }
  });

  it("penalizes episodes referenced within the last six hours", async () => {
    const realDateNow = Date.now;
    Date.now = () => new Date("2026-04-12T06:00:00.000Z").getTime();
    const { episodeStore, restore } = loadEpisodeStore({
      embeddingClient: {
        embed: async () => makeVector([1, 0]),
      },
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async () => null,
        findSimilarEpisodes: async () => [
          makeEpisode({
            id: "freshly-mentioned",
            centroid_embedding: makeVector([1, 0]),
            salience: 0.9,
            unresolved: true,
            last_seen_at: new Date("2026-04-12T05:00:00.000Z"),
            last_referenced_at: new Date("2026-04-12T04:30:00.000Z"),
          }),
          makeEpisode({
            id: "same-line-not-recently-mentioned",
            centroid_embedding: makeVector([1, 0]),
            salience: 0.85,
            unresolved: true,
            last_seen_at: new Date("2026-04-12T05:00:00.000Z"),
            last_referenced_at: new Date("2026-04-10T04:30:00.000Z"),
          }),
        ],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      const ranked = await episodeStore.findRelevant("user-1", "睡眠这条线最近怎么样");

      assert.deepEqual(
        ranked.map((entry) => entry.episode.id),
        ["same-line-not-recently-mentioned", "freshly-mentioned"],
      );
    } finally {
      Date.now = realDateNow;
      restore();
    }
  });

  it("cosineSimilarity computes expected values", () => {
    const { episodeStore, restore } = loadEpisodeStore();

    try {
      assert.equal(episodeStore.cosineSimilarity([1, 0], [1, 0]), 1);
      assert.equal(episodeStore.cosineSimilarity([1, 0], [0, 1]), 0);
      assert.equal(
        Math.round(episodeStore.cosineSimilarity([1, 1], [1, 0]) * 1000) / 1000,
        0.707,
      );
      assert.equal(episodeStore.cosineSimilarity([], [1, 0]), 0);
    } finally {
      restore();
    }
  });

  it("markReferenced delegates to updateEpisode", async () => {
    const calls = [];
    const { episodeStore, restore } = loadEpisodeStore({
      episodeRepository: {
        insertEpisode: async () => null,
        updateEpisode: async (id, params) => {
          calls.push({ id, params });
          return makeEpisode();
        },
        findSimilarEpisodes: async () => [],
        getUnresolvedEpisodes: async () => [],
      },
    });

    try {
      await episodeStore.markReferenced("episode-1");

      assert.equal(calls.length, 1);
      assert.equal(calls[0].id, "episode-1");
      assert.ok(calls[0].params.lastReferencedAt instanceof Date);
    } finally {
      restore();
    }
  });
});
