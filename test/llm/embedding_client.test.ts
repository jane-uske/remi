  const assert = require("assert").strict;

function clearEmbeddingClientModule() {
  const modulePath = require.resolve("../../llm/embedding_client");
  delete require.cache[modulePath];
}

describe("embedding_client", () => {
  const originalEnv = {
    REMI_EMBEDDING_BASE_URL: process.env.REMI_EMBEDDING_BASE_URL,
    REMI_EMBEDDING_API_KEY: process.env.REMI_EMBEDDING_API_KEY,
    REMI_EMBEDDING_MODEL: process.env.REMI_EMBEDDING_MODEL,
    REM_EMBEDDING_BASE_URL: process.env.REM_EMBEDDING_BASE_URL,
    REM_EMBEDDING_API_KEY: process.env.REM_EMBEDDING_API_KEY,
    REM_EMBEDDING_MODEL: process.env.REM_EMBEDDING_MODEL,
    EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
    EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    base_url: process.env.base_url,
    key: process.env.key,
  };
  const originalFetch = global.fetch;

  afterEach(() => {
    clearEmbeddingClientModule();
    global.fetch = originalFetch;
    if (originalEnv.REMI_EMBEDDING_BASE_URL === undefined) {
      delete process.env.REMI_EMBEDDING_BASE_URL;
    } else {
      process.env.REMI_EMBEDDING_BASE_URL = originalEnv.REMI_EMBEDDING_BASE_URL;
    }
    if (originalEnv.REMI_EMBEDDING_API_KEY === undefined) {
      delete process.env.REMI_EMBEDDING_API_KEY;
    } else {
      process.env.REMI_EMBEDDING_API_KEY = originalEnv.REMI_EMBEDDING_API_KEY;
    }
    if (originalEnv.REMI_EMBEDDING_MODEL === undefined) {
      delete process.env.REMI_EMBEDDING_MODEL;
    } else {
      process.env.REMI_EMBEDDING_MODEL = originalEnv.REMI_EMBEDDING_MODEL;
    }
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
    if (originalEnv.EMBEDDING_BASE_URL === undefined) {
      delete process.env.EMBEDDING_BASE_URL;
    } else {
      process.env.EMBEDDING_BASE_URL = originalEnv.EMBEDDING_BASE_URL;
    }
    if (originalEnv.EMBEDDING_API_KEY === undefined) {
      delete process.env.EMBEDDING_API_KEY;
    } else {
      process.env.EMBEDDING_API_KEY = originalEnv.EMBEDDING_API_KEY;
    }
    if (originalEnv.EMBEDDING_MODEL === undefined) {
      delete process.env.EMBEDDING_MODEL;
    } else {
      process.env.EMBEDDING_MODEL = originalEnv.EMBEDDING_MODEL;
    }
    if (originalEnv.base_url === undefined) {
      delete process.env.base_url;
    } else {
      process.env.base_url = originalEnv.base_url;
    }
    if (originalEnv.key === undefined) {
      delete process.env.key;
    } else {
      process.env.key = originalEnv.key;
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
    process.env.REMI_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REMI_EMBEDDING_API_KEY = "test-key";
    process.env.REMI_EMBEDDING_MODEL = "nomic-embed-text";

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
    delete process.env.REMI_EMBEDDING_BASE_URL;
    process.env.REMI_EMBEDDING_API_KEY = "test-key";

    const { embed } = require("../../llm/embedding_client");
    await assert.rejects(
      () => embed("hello"),
      /missing REMI_EMBEDDING_BASE_URL/,
    );
  });

  it("throws a clear error when the endpoint returns the wrong dimension", async () => {
    global.fetch = async () => ({
      ok: true,
      async json() {
        return { data: [{ embedding: new Array(192).fill(0.1) }] };
      },
    });
    process.env.REMI_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REMI_EMBEDDING_API_KEY = "test-key";

    const { embed } = require("../../llm/embedding_client");
    await assert.rejects(
      () => embed("hello"),
      /returned 192 dimensions, expected 768/,
    );
  });

  it("accepts legacy REM_EMBEDDING_* env names", async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { data: [{ embedding: new Array(768).fill(0.2) }] };
        },
      };
    };
    delete process.env.REMI_EMBEDDING_BASE_URL;
    delete process.env.REMI_EMBEDDING_API_KEY;
    delete process.env.REMI_EMBEDDING_MODEL;
    process.env.REM_EMBEDDING_BASE_URL = "http://localhost:1234/v1";
    process.env.REM_EMBEDDING_API_KEY = "legacy-key";
    process.env.REM_EMBEDDING_MODEL = "text-embedding-nomic-embed-text-v1.5";

    const { embed } = require("../../llm/embedding_client");
    const embedding = await embed("legacy");

    assert.equal(embedding.length, 768);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:1234/v1/embeddings");
    assert.equal(calls[0].init.headers.Authorization, "Bearer legacy-key");
  });

  it("accepts generic EMBEDDING_* env names", async () => {
    const calls = [];
    global.fetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        async json() {
          return { data: [{ embedding: new Array(768).fill(0.3) }] };
        },
      };
    };
    delete process.env.REMI_EMBEDDING_BASE_URL;
    delete process.env.REMI_EMBEDDING_API_KEY;
    delete process.env.REMI_EMBEDDING_MODEL;
    delete process.env.REM_EMBEDDING_BASE_URL;
    delete process.env.REM_EMBEDDING_API_KEY;
    delete process.env.REM_EMBEDDING_MODEL;
    process.env.EMBEDDING_BASE_URL = "http://localhost:4321/v1";
    process.env.EMBEDDING_API_KEY = "generic-key";
    process.env.EMBEDDING_MODEL = "generic-model";

    const { embed } = require("../../llm/embedding_client");
    const embedding = await embed("generic");

    assert.equal(embedding.length, 768);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "http://localhost:4321/v1/embeddings");
    assert.equal(calls[0].init.headers.Authorization, "Bearer generic-key");
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
    process.env.REMI_EMBEDDING_BASE_URL = "http://localhost:11434/v1";
    process.env.REMI_EMBEDDING_API_KEY = "test-key";

    const { embedBatch } = require("../../llm/embedding_client");
    const embeddings = await embedBatch(["a", "bb", "ccc"]);

    assert.deepEqual(inputs, ["a", "bb", "ccc"]);
    assert.deepEqual(
      embeddings.map((embedding) => embedding[0]),
      [1, 2, 3],
    );
  });
});
