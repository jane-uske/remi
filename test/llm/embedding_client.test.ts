const assert = require("assert").strict;

function clearEmbeddingClientModule() {
  const modulePath = require.resolve("../../llm/embedding_client");
  delete require.cache[modulePath];
}

describe("embedding_client", () => {
  const originalEnv = {
    REM_EMBEDDING_BASE_URL: process.env.REM_EMBEDDING_BASE_URL,
    REM_EMBEDDING_API_KEY: process.env.REM_EMBEDDING_API_KEY,
    REM_EMBEDDING_MODEL: process.env.REM_EMBEDDING_MODEL,
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    clearEmbeddingClientModule();
    global.fetch = originalFetch;
    if (originalEnv.REM_EMBEDDING_BASE_URL === undefined) {
      delete process.env.REM_EMBEDDING_BASE_URL;
    } else {
      process.env.REM_EMBEDDING_BASE_URL = originalEnv.REM_EMBEDDING_BASE_URL;
    }
    if (originalEnv.REM_EMBEDDING_API_KEY === undefined) {
      delete process.env.REM_EMBEDDING_API_KEY;
    } else {
      process.env.REM_EMBEDDING_API_KEY = originalEnv.REM_EMBEDDING_API_KEY;
    }
    if (originalEnv.REM_EMBEDDING_MODEL === undefined) {
      delete process.env.REM_EMBEDDING_MODEL;
    } else {
      process.env.REM_EMBEDDING_MODEL = originalEnv.REM_EMBEDDING_MODEL;
    }
  });

  it("posts to the embeddings endpoint and returns the embedding vector", async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { data: [{ embedding: new Array(768).fill(0.1) }] };
        },
      };
    };
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REM_EMBEDDING_API_KEY = "test-key";
    process.env.REM_EMBEDDING_MODEL = "nomic-embed-text";

    const { embed } = require("../../llm/embedding_client");
    const embedding = await embed("hello");

    assert.equal(embedding.length, 768);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:11434/v1/embeddings");
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: "nomic-embed-text",
      input: "hello",
    });
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
  });

  it("throws a clear error when required env vars are missing", async () => {
    delete process.env.REM_EMBEDDING_BASE_URL;
    process.env.REM_EMBEDDING_API_KEY = "test-key";

    const { embed } = require("../../llm/embedding_client");
    await assert.rejects(
      () => embed("hello"),
      /missing REM_EMBEDDING_BASE_URL/,
    );
  });

  it("throws a clear error when the endpoint returns the wrong dimension", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return { data: [{ embedding: new Array(192).fill(0.1) }] };
      },
    });
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REM_EMBEDDING_API_KEY = "test-key";

    const { embed } = require("../../llm/embedding_client");
    await assert.rejects(
      () => embed("hello"),
      /returned 192 dimensions, expected 768/,
    );
  });

  it("embedBatch calls embed once per input", async () => {
    const inputs = [];
    global.fetch = async (_url, init) => {
      const payload = JSON.parse(init.body);
      inputs.push(payload.input);
      return {
        ok: true,
        async json() {
          return { data: [{ embedding: new Array(768).fill(String(payload.input).length) }] };
        },
      };
    };
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REM_EMBEDDING_API_KEY = "test-key";

    const { embedBatch } = require("../../llm/embedding_client");
    const embeddings = await embedBatch(["a", "bb", "ccc"]);

    assert.deepEqual(inputs, ["a", "bb", "ccc"]);
    assert.deepEqual(
      embeddings.map((embedding) => embedding[0]),
      [1, 2, 3],
    );
  });
});
