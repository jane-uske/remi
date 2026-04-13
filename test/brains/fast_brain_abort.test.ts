const assert = require("assert").strict;
const path = require("path");

function withMockedQwenClient(mockExports, run) {
  const qwenPath = path.resolve(__dirname, "../../llm/qwen_client.ts");
  const fastBrainPath = path.resolve(__dirname, "../../brains/fast_brain.ts");
  const previousQwen = require.cache[qwenPath];
  const previousFastBrain = require.cache[fastBrainPath];

  require.cache[qwenPath] = {
    id: qwenPath,
    filename: qwenPath,
    loaded: true,
    exports: mockExports,
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
  };

  beforeEach(() => {
    process.env.key = "test-key";
    process.env.base_url = "http://localhost:11434/v1";
    process.env.model = "test-model";
  });

  afterEach(() => {
    if (originalEnv.key === undefined) delete process.env.key;
    else process.env.key = originalEnv.key;

    if (originalEnv.base_url === undefined) delete process.env.base_url;
    else process.env.base_url = originalEnv.base_url;

    if (originalEnv.model === undefined) delete process.env.model;
    else process.env.model = originalEnv.model;
  });

  it("does not emit error fallback text when streaming is aborted", async () => {
    await withMockedQwenClient(
      {
        async *streamTokens() {
          const err = new Error("Request was aborted.");
          err.name = "AbortError";
          throw err;
        },
        async complete() {
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
        async *streamTokens() {
          throw new Error("provider down");
        },
        async complete() {
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
        async *streamTokens() {
          const err = new Error("401 The API key format is incorrect.");
          err.code = "AuthenticationError";
          err.status = 401;
          throw err;
        },
        async complete() {
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
});
