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

    let getCalls = 0;
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
          getCalls += 1;
          if (getCalls < 3) {
            return {
              ok: false,
              status: 503,
              text: async () => "",
            };
          }
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

    const result = await runtime.transcribeWav(Buffer.from("fake wav"), 16000);
    assert.deepEqual(result, {
      text: "你好",
      path: "server",
      fallbackReason: null,
      requestDegraded: false,
    });

    await runtime.shutdown();
    assert.deepEqual(killSignals, ["SIGTERM"]);
  });

  it("reuses an already-running whisper-server instead of spawning another copy", async () => {
    const spawnCalls = [];
    const runtime = createWhisperServerRuntime({
      env: {
        whisper_use_server: "1",
        whisper_server_autostart: "1",
        whisper_server_cmd: "whisper-server",
        whisper_server_url: "http://127.0.0.1:8178",
        whisper_server_request_path: "/inference",
        whisper_model: "/tmp/model.gguf",
        whisper_lang: "zh",
      },
      sleep: async () => {},
      spawn: ((cmd, args, options) => {
        spawnCalls.push({ cmd, args, options });
        throw new Error("should not spawn when server is already ready");
      }),
      fetch: async (_input, init) => {
        const method = init?.method || "GET";
        if (method === "GET") {
          return {
            ok: true,
            status: 200,
            text: async () => "",
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ text: "复用成功" }),
        };
      },
    });

    assert.equal(await runtime.warm(), true);
    assert.equal(spawnCalls.length, 0);

    const result = await runtime.transcribeWav(Buffer.from("fake wav"), 16000);
    assert.equal(result.path, "server");
    assert.equal(result.text, "复用成功");
  });

  it("supports remote whisper-server mode without requiring a local model file", async () => {
    const runtime = createWhisperServerRuntime({
      env: {
        whisper_use_server: "1",
        whisper_server_autostart: "0",
        whisper_server_url: "http://host.docker.internal:8080",
        whisper_server_request_path: "/inference",
        whisper_lang: "zh",
      },
      sleep: async () => {},
      fetch: async (_input, init) => {
        const method = init?.method || "GET";
        if (method === "POST") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ text: "远程识别成功" }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
    });

    const result = await runtime.transcribeWav(Buffer.from("fake wav"), 16000, {
      allowCliFallback: false,
      jobPriority: "high",
      traceId: "trace-remote-only",
    });
    assert.deepEqual(result, {
      text: "远程识别成功",
      path: "server",
      fallbackReason: null,
      requestDegraded: false,
    });
  });

  it("enters a degraded window after a failed server request, skips low-value jobs, and routes high-value jobs straight to cli", async () => {
    let now = 1_000;
    let postCalls = 0;
    let cliCalls = 0;
    const runtime = createWhisperServerRuntime({
      env: {
        whisper_use_server: "1",
        whisper_server_autostart: "0",
        whisper_server_url: "http://127.0.0.1:8080",
        whisper_server_request_path: "/inference",
        whisper_server_request_timeout_ms: "1500",
        whisper_model: "/tmp/model.gguf",
        whisper_lang: "zh",
      },
      now: () => now,
      sleep: async () => {},
      fetch: async (_input, init) => {
        const method = init?.method || "GET";
        if (method === "POST") {
          postCalls += 1;
          const error = new Error("request aborted");
          error.name = "AbortError";
          throw error;
        }
        return {
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
    });

    const highAfterFailure = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        cliCalls += 1;
        return "你好";
      },
      {
        jobPriority: "high",
        allowCliFallback: true,
        traceId: "trace-high-1",
      },
    );
    assert.deepEqual(highAfterFailure, {
      text: "你好",
      path: "cli",
      fallbackReason: "request_abort",
      requestDegraded: true,
    });

    const lowDuringDegraded = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        cliCalls += 1;
        return "不该触发";
      },
      {
        jobPriority: "low",
        allowCliFallback: false,
        traceId: "trace-low",
      },
    );
    assert.deepEqual(lowDuringDegraded, {
      text: "",
      path: "skipped",
      fallbackReason: "disabled_for_low_priority",
      requestDegraded: true,
    });

    const highDuringDegraded = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        cliCalls += 1;
        return "你好呀";
      },
      {
        jobPriority: "high",
        allowCliFallback: true,
        traceId: "trace-high-2",
      },
    );
    assert.deepEqual(highDuringDegraded, {
      text: "你好呀",
      path: "cli",
      fallbackReason: "degraded_window",
      requestDegraded: true,
    });

    assert.equal(postCalls, 1);
    assert.equal(cliCalls, 2);

    now += 16_000;
    const afterWindow = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        cliCalls += 1;
        return "第三次";
      },
      {
        jobPriority: "high",
        allowCliFallback: true,
        traceId: "trace-high-3",
      },
    );
    assert.equal(afterWindow.path, "cli");
    assert.equal(afterWindow.fallbackReason, "request_abort");
    assert.equal(postCalls, 2);
    assert.equal(cliCalls, 3);
  });

  it("skips instead of throwing when remote-only whisper-server mode degrades and no local cli fallback exists", async () => {
    let now = 1_000;
    const runtime = createWhisperServerRuntime({
      env: {
        whisper_use_server: "1",
        whisper_server_autostart: "0",
        whisper_server_url: "http://127.0.0.1:8080",
        whisper_server_request_path: "/inference",
        whisper_server_request_timeout_ms: "1500",
        whisper_lang: "zh",
      },
      now: () => now,
      sleep: async () => {},
      fetch: async (_input, init) => {
        const method = init?.method || "GET";
        if (method === "POST") {
          const error = new Error("request aborted");
          error.name = "AbortError";
          throw error;
        }
        return {
          ok: true,
          status: 200,
          text: async () => "",
        };
      },
    });

    const firstFailure = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        throw new Error("cli should not run");
      },
      {
        jobPriority: "high",
        allowCliFallback: true,
        traceId: "trace-remote-failure-1",
      },
    );
    assert.deepEqual(firstFailure, {
      text: "",
      path: "skipped",
      fallbackReason: "request_abort",
      requestDegraded: true,
    });

    now += 100;

    const degradedRetry = await runtime.transcribePreferServer(
      Buffer.from("fake wav"),
      async () => {
        throw new Error("cli should not run");
      },
      {
        jobPriority: "high",
        allowCliFallback: true,
        traceId: "trace-remote-failure-2",
      },
    );
    assert.deepEqual(degradedRetry, {
      text: "",
      path: "skipped",
      fallbackReason: "degraded_window",
      requestDegraded: true,
    });
  });
});
