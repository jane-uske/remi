const assert = require("assert").strict;

const { resetConfig } = require("../../server/config");
const { speakWithMlx } = require("../../voice/tts_mlx");

describe("MLX TTS request body", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    resetConfig();
  });

  it("uses a low default temperature for consistent segmented speech", async () => {
    process.env.REMI_TTS_MLX_URL = "http://127.0.0.1:18000";
    delete process.env.REMI_TTS_MLX_TEMPERATURE;
    resetConfig();

    let body: Record<string, unknown> | null = null;
    global.fetch = async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };

    await speakWithMlx("测试一句话", undefined, "neutral");

    assert.equal(body?.temperature, 0.35);
  });

  it("lets env override the MLX sampling temperature", async () => {
    process.env.REMI_TTS_MLX_URL = "http://127.0.0.1:18000";
    process.env.REMI_TTS_MLX_TEMPERATURE = "0.2";
    resetConfig();

    let body: Record<string, unknown> | null = null;
    global.fetch = async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };

    await speakWithMlx("测试一句话", undefined, "neutral");

    assert.equal(body?.temperature, 0.2);
  });
});
