import type { UserMessageHistoryCursor } from "../../storage/repositories/message_repository";
import { createLogger } from "../../infra/logger";
import { send, getWsRateLimiter } from "../gateway";
import { devPresetCommandsEnabled } from "./runtime_config";

const logger = createLogger("session");

const AUDIO_BIN_MAGIC_V1 = Buffer.from([0x52, 0x41]);
const AUDIO_BIN_MAGIC_V2 = Buffer.from([0x52, 0x41, 0x55, 0x44]);
const AUDIO_BIN_VERSION = 1;
const AUDIO_BIN_HEADER_BYTES_V1 = 8;
const AUDIO_BIN_HEADER_BYTES_V2 = 16;
const AUDIO_BIN_CODEC_PCM16_MONO = 1;

export function parseBinaryAudioFrame(raw: unknown): { sampleRate: number; pcm: Buffer } | null {
  const asBuffer = (value: unknown): Buffer | null => {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof ArrayBuffer) return Buffer.from(value);
    if (Array.isArray(value) && value.every((entry) => Buffer.isBuffer(entry))) {
      return Buffer.concat(value as Buffer[]);
    }
    return null;
  };

  const buffer = asBuffer(raw);
  if (!buffer) return null;

  if (
    buffer.length >= AUDIO_BIN_HEADER_BYTES_V2 + 2 &&
    buffer.subarray(0, 4).equals(AUDIO_BIN_MAGIC_V2)
  ) {
    if (buffer[4] !== AUDIO_BIN_VERSION) return null;
    if (buffer[5] !== AUDIO_BIN_CODEC_PCM16_MONO) return null;

    const sampleRate = buffer.readUInt32LE(8);
    const payloadBytes = buffer.readUInt32LE(12);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
    if (payloadBytes <= 0 || buffer.length < AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes) return null;

    const pcm = buffer.subarray(
      AUDIO_BIN_HEADER_BYTES_V2,
      AUDIO_BIN_HEADER_BYTES_V2 + payloadBytes,
    );
    return { sampleRate, pcm: Buffer.from(pcm) };
  }

  if (
    buffer.length >= AUDIO_BIN_HEADER_BYTES_V1 + 2 &&
    buffer.subarray(0, 2).equals(AUDIO_BIN_MAGIC_V1)
  ) {
    if (buffer[2] !== AUDIO_BIN_VERSION) return null;

    const sampleRate = buffer.readUInt32LE(4);
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;

    const pcm = buffer.subarray(AUDIO_BIN_HEADER_BYTES_V1);
    if (pcm.length === 0) return null;
    return { sampleRate, pcm: Buffer.from(pcm) };
  }

  return null;
}

function readRawMessageText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString();
  if (Array.isArray(raw) && raw.every((entry) => Buffer.isBuffer(entry))) {
    return Buffer.concat(raw as Buffer[]).toString();
  }
  return String(raw ?? "");
}

export function attachSessionMessageHandlers(input: {
  ws: { on: (event: "message", listener: (raw: unknown) => void) => void };
  connId: string;
  storageUserId: string;
  parseHistoryCursor: (raw: unknown) => UserMessageHistoryCursor | null;
  sendHistoryPage: (
    mode: "replace" | "prepend",
    cursor?: UserMessageHistoryCursor | null,
  ) => Promise<void>;
  handleAudioPcm: (pcm: Buffer, sampleRate: number, transport: "binary" | "json") => void;
  runDevApplyPreset: (data: any) => void;
  runDevSetTtsVoice: (data: any) => void;
  runDevResetState: (data: any) => void;
  handleGetPersonaPreset: () => void;
  handleSetPersonaPreset: (data: any) => void;
  handleDuplexStart: (data: any) => void;
  handleDuplexStop: () => void;
  handleAudioStream: (data: any) => void;
  handleAudioChunk: (data: any) => void;
  handleAudioEnd: () => void;
  handlePlaybackStart: (data?: any) => void;
  handlePlaybackEnd: (data?: any) => void;
  handleClientContext: (data: any) => void;
  handleChat: (data: any) => void;
  handleWorldEvent: (data: any) => void;
  handleSetVoiceStyle: (data: any) => void;
  handleSetVoiceEngine: (data: any) => void;
}): void {
  input.ws.on("message", (raw) => {
    const binary = parseBinaryAudioFrame(raw);
    if (binary) {
      input.handleAudioPcm(binary.pcm, binary.sampleRate, "binary");
      return;
    }

    const rawText = readRawMessageText(raw);
    let data: any;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = { type: "chat", content: rawText };
    }

    const bypassRateLimit =
      data.type === "audio_stream" ||
      data.type === "audio_chunk" ||
      data.type === "playback_start" ||
      data.type === "playback_end";
    if (!bypassRateLimit) {
      const limiter = getWsRateLimiter();
      if (limiter && !limiter.check(input.connId)) {
        send(input.ws as any, { type: "error", content: "消息频率过高，请稍后再试" });
        return;
      }
    }

    switch (data.type) {
      case "history_more":
        void input
          .sendHistoryPage("prepend", input.parseHistoryCursor(data.cursor))
          .catch((error) => {
            logger.warn("[Storage] Failed to load older history", {
              error,
              connId: input.connId,
              userId: input.storageUserId,
            });
            send(input.ws as any, { type: "error", content: "加载历史记录失败，请稍后重试" });
          });
        break;
      case "dev_apply_preset":
        if (!devPresetCommandsEnabled()) {
          send(input.ws as any, { type: "error", content: "开发预设命令已禁用" });
          break;
        }
        input.runDevApplyPreset(data);
        break;
      case "dev_set_tts_voice":
        if (!devPresetCommandsEnabled()) {
          send(input.ws as any, { type: "error", content: "开发预设命令已禁用" });
          break;
        }
        input.runDevSetTtsVoice(data);
        break;
      case "dev_reset_state":
        if (!devPresetCommandsEnabled()) {
          send(input.ws as any, { type: "error", content: "开发预设命令已禁用" });
          break;
        }
        input.runDevResetState(data);
        break;
      case "get_persona_preset":
        input.handleGetPersonaPreset();
        break;
      case "set_persona_preset":
        input.handleSetPersonaPreset(data);
        break;
      case "duplex_start":
        input.handleDuplexStart(data);
        break;
      case "duplex_stop":
        input.handleDuplexStop();
        break;
      case "audio_stream":
        input.handleAudioStream(data);
        break;
      case "audio_chunk":
        input.handleAudioChunk(data);
        break;
      case "audio_end":
        input.handleAudioEnd();
        break;
      case "playback_start":
        input.handlePlaybackStart(data);
        break;
      case "playback_end":
        input.handlePlaybackEnd(data);
        break;
      case "client_context":
        input.handleClientContext(data);
        break;
      case "world_event":
        input.handleWorldEvent(data);
        break;
      case "set_voice_style":
        input.handleSetVoiceStyle(data);
        break;
      case "set_voice_engine":
        input.handleSetVoiceEngine(data);
        break;
      default:
        input.handleChat(data);
        break;
    }
  });
}
