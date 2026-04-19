import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import process from "node:process";
import path from "node:path";

import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

function print(section, lines) {
  console.log(`\n[doctor] ${section}`);
  for (const line of lines) {
    console.log(`- ${line}`);
  }
}

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

const sttProvider = (process.env.stt_provider || "openai").toLowerCase();
const incrementalSttProvider = (
  process.env.stt_incremental_provider ||
  process.env.STT_INCREMENTAL_PROVIDER ||
  ""
).toLowerCase();
const ttsProvider = (process.env.tts_provider || "edge").toLowerCase();
const llmConfigured = Boolean(
  process.env.key?.trim() &&
    process.env.base_url?.trim() &&
    process.env.model?.trim(),
);

print("Runtime", [
  `cwd: ${process.cwd()}`,
  `node: ${process.version}`,
  `platform: ${os.platform()} ${os.release()}`,
  `llm configured: ${llmConfigured ? "yes" : "no"}`,
  `stt provider: ${sttProvider}`,
  `incremental stt provider: ${incrementalSttProvider || "(disabled)"}`,
  `tts provider: ${ttsProvider}`,
]);

const sttLines = [];
if (sttProvider === "whisper-cpp") {
  const useServer = !["0", "false"].includes((process.env.whisper_use_server ?? "1").toLowerCase());
  const autostart = !["0", "false"].includes(
    (process.env.whisper_server_autostart ?? "1").toLowerCase(),
  );
  const serverUrl = process.env.whisper_server_url?.trim();
  sttLines.push(`whisper server enabled: ${useServer ? "yes" : "no"}`);
  sttLines.push(`whisper server autostart: ${autostart ? "yes" : "no"}`);
  if (useServer && !autostart && serverUrl) {
    sttLines.push(`whisper remote server url: ${serverUrl}`);
    sttLines.push(`whisper local model path: ${process.env.whisper_model || "(optional)"}`);
    sttLines.push(`whisper local model exists: ${exists(process.env.whisper_model) ? "yes" : "no"}`);
  } else {
    sttLines.push(`whisper_model exists: ${exists(process.env.whisper_model) ? "yes" : "no"}`);
    sttLines.push(`whisper_model path: ${process.env.whisper_model || "(missing)"}`);
  }
} else {
  sttLines.push(`stt_key set: ${process.env.stt_key?.trim() ? "yes" : "no"}`);
  sttLines.push(`stt_base_url set: ${process.env.stt_base_url?.trim() ? "yes" : "no"}`);
}
if (incrementalSttProvider === "openai-realtime") {
  sttLines.push(`streaming flag on: ${["0", "false"].includes((process.env.REMI_STREAMING_STT_ENABLED ?? "").toLowerCase()) ? "no" : "yes"}`);
  sttLines.push(`realtime stt_key set: ${process.env.stt_key?.trim() ? "yes" : "no"}`);
}
if (incrementalSttProvider === "sherpa-onnx") {
  const sherpaModelDir = process.env.STT_SHERPA_MODEL_DIR || path.join(process.cwd(), "models", "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16");
  sttLines.push(`streaming flag on: ${["0", "false"].includes((process.env.REMI_STREAMING_STT_ENABLED ?? "").toLowerCase()) ? "no" : "yes"}`);
  sttLines.push(`sherpa model dir: ${sherpaModelDir}`);
  sttLines.push(`sherpa tokens exists: ${exists(path.join(sherpaModelDir, "tokens.txt")) ? "yes" : "no"}`);
  sttLines.push(`sherpa encoder exists: ${exists(path.join(sherpaModelDir, "encoder-epoch-99-avg-1.int8.onnx")) || exists(path.join(sherpaModelDir, "encoder-epoch-99-avg-1.onnx")) ? "yes" : "no"}`);
  sttLines.push(`sherpa joiner exists: ${exists(path.join(sherpaModelDir, "joiner-epoch-99-avg-1.int8.onnx")) || exists(path.join(sherpaModelDir, "joiner-epoch-99-avg-1.onnx")) ? "yes" : "no"}`);
}
print("STT", sttLines);

const ttsLines = [];
if (ttsProvider === "piper") {
  ttsLines.push(`piper_model exists: ${exists(process.env.piper_model) ? "yes" : "no"}`);
  ttsLines.push(`piper_cmd exists: ${exists(process.env.piper_cmd) ? "yes" : "no"}`);
} else if (ttsProvider === "openai") {
  ttsLines.push(`tts_key set: ${process.env.tts_key?.trim() ? "yes" : "no"}`);
  ttsLines.push(`tts_base_url set: ${process.env.tts_base_url?.trim() ? "yes" : "no"}`);
} else if (ttsProvider === "volc") {
  ttsLines.push(
    `volc api key set: ${
      process.env.VOLC_TTS_API_KEY?.trim() || process.env.volc_tts_api_key?.trim() || process.env.tts_key?.trim()
        ? "yes"
        : "no"
    }`,
  );
  ttsLines.push(
    `volc resource id: ${
      process.env.VOLC_TTS_RESOURCE_ID || process.env.volc_tts_resource_id || "seed-tts-2.0"
    }`,
  );
  ttsLines.push(
    `volc voice type: ${
      process.env.VOLC_TTS_VOICE_TYPE ||
      process.env.volc_tts_voice_type ||
      process.env.tts_voice ||
      "(missing)"
    }`,
  );
  ttsLines.push(
    `volc dynamic style: ${
      (process.env.VOLC_TTS_ENABLE_DYNAMIC_STYLE ?? process.env.volc_tts_enable_dynamic_style) !== "0"
        ? "on"
        : "off"
    }`,
  );
} else {
  ttsLines.push(`edge voice: ${process.env.tts_voice || "zh-CN-XiaoyiNeural"}`);
}
print("TTS", ttsLines);

const dbPortOpen = await checkPort(5432);
const redisPortOpen = await checkPort(6379);
const dbUrl = (process.env.DATABASE_URL || "").trim();
const redisUrl = (process.env.REDIS_URL || "").trim();
print("Dependencies", [
  `DATABASE_URL set: ${dbUrl ? "yes" : "no"}`,
  `REDIS_URL set: ${redisUrl ? "yes" : "no"}`,
  `DATABASE_URL host: ${dbUrl ? (() => { try { return new URL(dbUrl).hostname; } catch { return "(invalid)"; } })() : "(missing)"}`,
  `REDIS_URL host: ${redisUrl ? (() => { try { return new URL(redisUrl).hostname; } catch { return "(invalid)"; } })() : "(missing)"}`,
  `localhost:5432 reachable: ${dbPortOpen ? "yes" : "no"}`,
  `localhost:6379 reachable: ${redisPortOpen ? "yes" : "no"}`,
]);

print("Frontend", [
  `NEXT_PUBLIC_VRM_URL: ${process.env.NEXT_PUBLIC_VRM_URL || "(default)"}`,
  `NEXT_PUBLIC_WS_URL: ${process.env.NEXT_PUBLIC_WS_URL || "(auto)"}`,
]);
