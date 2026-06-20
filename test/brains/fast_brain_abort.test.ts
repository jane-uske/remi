const assert = require("assert").strict;
const path = require("path");

function withMockedQwenClient(mockExports, run) {
  const qwenPath = path.resolve(__dirname, "../../llm/qwen_client.ts");
  const fastBrainPath = path.resolve(__dirname, "../../brains/reply_stream.ts");
  const previousQwen = require.cache[qwenPath];
  const previousFastBrain = require.cache[fastBrainPath];

  require.cache[qwenPath] = {
    id: qwenPath,
    filename: qwenPath,
    loaded: true,
    exports: {
      hasLlmConfig: () => true,
      localLlmEnabled: () => true,
      ...mockExports,
    },
  };
  delete require.cache[fastBrainPath];

  try {
    const fastBrain = require(fastBrainPath);
    return run(fastBrain);
  } finally {
    if (previousQwen) {
      require.cache[qwenPath] = previousQwen;
    } else {
      delete require.cache[qwenPath];
    }
    if (previousFastBrain) {
      require.cache[fastBrainPath] = previousFastBrain;
    } else {
      delete require.cache[fastBrainPath];
    }
  }
}

describe("fast_brain abort handling", () => {
  const originalEnv = {
    key: process.env.key,
    base_url: process.env.base_url,
    model: process.env.model,
    REMI_LOCAL_LLM_ENABLED: process.env.REMI_LOCAL_LLM_ENABLED,
    REMI_FAST_BRAIN_MODEL: process.env.REMI_FAST_BRAIN_MODEL,
    REMI_FAST_BRAIN_REASONING_EFFORT: process.env.REMI_FAST_BRAIN_REASONING_EFFORT,
  };

  beforeEach(() => {
    process.env.key = "test-key";
    process.env.base_url = "http://localhost:11434/v1";
    process.env.model = "test-model";
    delete process.env.REMI_LOCAL_LLM_ENABLED;
    delete process.env.REMI_FAST_BRAIN_MODEL;
  });

  afterEach(() => {
    if (originalEnv.key === undefined) delete process.env.key;
    else process.env.key = originalEnv.key;

    if (originalEnv.base_url === undefined) delete process.env.base_url;
    else process.env.base_url = originalEnv.base_url;

    if (originalEnv.model === undefined) delete process.env.model;
    else process.env.model = originalEnv.model;

    if (originalEnv.REMI_LOCAL_LLM_ENABLED === undefined) {
      delete process.env.REMI_LOCAL_LLM_ENABLED;
    } else {
      process.env.REMI_LOCAL_LLM_ENABLED = originalEnv.REMI_LOCAL_LLM_ENABLED;
    }

    if (originalEnv.REMI_FAST_BRAIN_MODEL === undefined) {
      delete process.env.REMI_FAST_BRAIN_MODEL;
    } else {
      process.env.REMI_FAST_BRAIN_MODEL = originalEnv.REMI_FAST_BRAIN_MODEL;
    }

    if (originalEnv.REMI_FAST_BRAIN_REASONING_EFFORT === undefined) {
      delete process.env.REMI_FAST_BRAIN_REASONING_EFFORT;
    } else {
      process.env.REMI_FAST_BRAIN_REASONING_EFFORT =
        originalEnv.REMI_FAST_BRAIN_REASONING_EFFORT;
    }
  });

  it("does not emit error fallback text when streaming is aborted", async () => {
    await withMockedQwenClient(
      {
        async collectStreamTokens() {
          const err = new Error("Request was aborted.");
          err.name = "AbortError";
          throw err;
        },
        async recoverVisibleReply() {
          return "ignored";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, []);
      },
    );
  });

  it("still emits fallback text for real LLM failures", async () => {
    await withMockedQwenClient(
      {
        async collectStreamTokens() {
          throw new Error("provider down");
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, ["啊…出了点问题，等我缓缓再试试…"]);
      },
    );
  });

  it("surfaces a config-specific message for authentication failures", async () => {
    await withMockedQwenClient(
      {
        async collectStreamTokens() {
          const err = new Error("401 The API key format is incorrect.");
          err.code = "AuthenticationError";
          err.status = 401;
          throw err;
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, [
          "我这边的大脑连接凭据不对，暂时没法回复。把 LLM 的 key 配好后再试一次。",
        ]);
      },
    );
  });

  it("forwards raw/reasoning/visible first-chunk callbacks", async () => {
    let firstChunkCalls = 0;
    let firstReasoningCalls = 0;
    let firstVisibleCalls = 0;
    await withMockedQwenClient(
      {
        async collectStreamTokens(_, __, callbacks) {
          callbacks?.onFirstChunk?.();
          callbacks?.onFirstReasoningChunk?.();
          callbacks?.onFirstVisibleContent?.();
          return {
            tokens: ["真实回答"],
            contentChars: 12,
            reasoningChars: 4,
            visibleChars: 4,
          };
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
          onFirstLlmChunk: () => {
            firstChunkCalls += 1;
          },
          onFirstLlmReasoningChunk: () => {
            firstReasoningCalls += 1;
          },
          onFirstLlmVisibleContent: () => {
            firstVisibleCalls += 1;
          },
        })) {
          chunks.push(token);
        }
        assert.equal(firstChunkCalls, 1);
        assert.equal(firstReasoningCalls, 1);
        assert.equal(firstVisibleCalls, 1);
        assert.equal(chunks.join(""), "真实回答");
      },
    );
  });

  it("passes configured fast-brain reasoning effort to collectStreamTokens", async () => {
    process.env.REMI_FAST_BRAIN_REASONING_EFFORT = "minimal";
    let seenOptions = null;
    await withMockedQwenClient(
      {
        async collectStreamTokens(_, __, ___, options) {
          seenOptions = options;
          return {
            tokens: ["ok"],
            contentChars: 2,
            reasoningChars: 0,
            visibleChars: 2,
          };
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, ["ok"]);
      },
    );
    assert.deepEqual(seenOptions, { reasoningEffort: "minimal", model: "test-model" });
  });

  it("ignores REMI_FAST_BRAIN_MODEL and uses REMI_LLM_MODEL for fast-brain stream", async () => {
    process.env.REMI_FAST_BRAIN_MODEL = "fast-model";
    let seenOptions = null;
    await withMockedQwenClient(
      {
        async collectStreamTokens(_, __, ___, options) {
          seenOptions = options;
          return {
            tokens: ["ok"],
            contentChars: 2,
            reasoningChars: 0,
            visibleChars: 2,
          };
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, ["ok"]);
      },
    );
    assert.deepEqual(seenOptions, { model: "test-model" });
  });

  it("recovers via non-stream when visible stream tokens are empty", async () => {
    let recoverCalls = 0;
    await withMockedQwenClient(
      {
        async collectStreamTokens() {
          return {
            tokens: [],
            contentChars: 0,
            reasoningChars: 1200,
            visibleChars: 0,
          };
        },
        async recoverVisibleReply() {
          recoverCalls += 1;
          return "白色蕾丝边。";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你穿的什么颜色内裤",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.equal(recoverCalls, 1);
        assert.deepEqual(chunks, ["白色蕾丝边。"]);
      },
    );
  });

  it("falls back immediately when local llm is disabled", async () => {
    process.env.REMI_LOCAL_LLM_ENABLED = "0";
    await withMockedQwenClient(
      {
        hasLlmConfig: () => false,
        localLlmEnabled: () => false,
        async collectStreamTokens() {
          throw new Error("should not be called");
        },
        async recoverVisibleReply() {
          return "";
        },
      },
      async ({ fastBrainStream }) => {
        const chunks = [];
        for await (const token of fastBrainStream({
          userMessage: "你好",
          emotion: "neutral",
          memory: [],
          history: [],
        })) {
          chunks.push(token);
        }
        assert.deepEqual(chunks, ["嗯…我听到了「你好」，不过我现在还没连上大脑…等一下就好。"]);
      },
    );
  });
});
