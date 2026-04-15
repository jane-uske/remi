const assert = require("assert").strict;
const { EventEmitter } = require("events");

const {
  buildWhisperServerArgs,
  createWhisperServerRuntime,
  readWhisperServerConfig,
} = require("../../voice/stt_whisper_runtime");

describe("stt whisper runtime", () => {
  it("parses config and builds the whisper-server argv", () => {
    const config = readWhisperServerConfig({
      whisper_use_server: "0",
      whisper_server_host: "0.0.0.0",
      whisper_server_port: "9000",
      whisper_server_request_path: "inference",
      whisper_server_url: "http://example.com/",
      whisper_server_autostart: "false",
      whisper_server_retry_cooldown_ms: "1234",
      whisper_server_ready_timeout_ms: "2345",
      whisper_server_request_timeout_ms: "3456",
      stt_preview_enabled: "false",
      whisper_server_cmd: "custom-whisper-server",
      whisper_model: "/tmp/model.gguf",
      whisper_lang: "en",
      whisper_prompt: "你好",
      whisper_server_extra_args: "--foo bar",
    });

    assert.deepEqual(config, {
      useServer: false,
      host: "0.0.0.0",
      port: 9000,
      inferencePath: "/inference",
      baseUrl: "http://example.com",
      inferenceUrl: "http://example.com/inference",
      autostart: false,
      cooldownMs: 1234,
      readyTimeoutMs: 2345,
      requestTimeoutMs: 3456,
      previewEnabled: false,
      cmd: "custom-whisper-server",
      model: "/tmp/model.gguf",
      lang: "en",
      prompt: "你好",
      extraArgs: ["--foo", "bar"],
    });

    assert.deepEqual(buildWhisperServerArgs(config), [
      "-m",
      "/tmp/model.gguf",
      "-l",
      "en",
      "--host",
      "0.0.0.0",
      "--port",
      "9000",
      "--inference-path",
      "/inference",
      "--convert",
      "--prompt",
      "你好",
      "--foo",
      "bar",
    ]);
  });

  it("starts, transcribes, and shuts down through the helper runtime", async () => {
    const spawnCalls = [];
    const killSignals = [];
    const fakeProc = new EventEmitter();
    fakeProc.stdout = new EventEmitter();
    fakeProc.stderr = new EventEmitter();
    fakeProc.exitCode = null;
    fakeProc.kill = (signal) => {
      killSignals.push(signal);
      fakeProc.exitCode = 0;
      process.nextTick(() => fakeProc.emit("exit", 0, signal));
      return true;
    };

    const runtime = createWhisperServerRuntime({
      env: {
        whisper_use_server: "1",
        whisper_server_autostart: "1",
        whisper_server_cmd: "whisper-server",
        whisper_server_url: "http://127.0.0.1:8080",
        whisper_server_request_path: "/inference",
        whisper_server_ready_timeout_ms: "1500",
        whisper_server_request_timeout_ms: "1500",
        whisper_model: "/tmp/model.gguf",
        whisper_lang: "zh",
      },
      now: () => 1000,
      sleep: async () => {},
      spawn: ((cmd, args, options) => {
        spawnCalls.push({ cmd, args, options });
        return fakeProc;
      }),
      fetch: async (input, init) => {
        const method = init?.method || "GET";
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            text: async () => "",
          };
        }
        assert.equal(String(input), "http://127.0.0.1:8080/inference");
        assert.equal(method, "POST");
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ text: "你好" }),
        };
      },
    });

    assert.equal(await runtime.warm(), true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].cmd, "whisper-server");
    assert.ok(spawnCalls[0].args.includes("--convert"));
    assert.ok(spawnCalls[0].args.includes("/tmp/model.gguf"));

    const text = await runtime.transcribeWav(Buffer.from("fake wav"), 16000);
    assert.equal(text, "你好");

    await runtime.shutdown();
    assert.deepEqual(killSignals, ["SIGTERM"]);
  });
});
