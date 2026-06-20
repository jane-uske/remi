import { getConfig } from "../server/config";
import { isNsfwEnabled } from "../brains/nsfw_mode";
import { createLogger } from "../infra/logger";
import { getMlxInstruct, type Emotion } from "./tts_emotion";
import { getSessionTtsRuntimeOverride } from "./tts_runtime_overrides";
import { buildVoiceStyleInstruct } from "../capabilities/voice_style/voice_style_presets";
import type { TtsPcmChunk } from "./tts";

const logger = createLogger("tts_mlx");

const WAV_HEADER_SIZE = 44;

// MLX TTS can produce looping audio for very short moaning text (e.g. "嗯啊"
// → 6 seconds instead of ~0.5s). Cap output duration to prevent this.
const MAX_AUDIO_SEC_PER_CHAR = 1.5;
const MIN_MAX_AUDIO_SEC = 2.0;
const MLX_SAMPLE_RATE = 24000;
const MLX_BYTES_PER_SAMPLE = 2; // 16-bit mono

function maxAudioBytes(textLength: number): number {
  const maxSec = Math.max(MIN_MAX_AUDIO_SEC, textLength * MAX_AUDIO_SEC_PER_CHAR);
  return Math.ceil(maxSec * MLX_SAMPLE_RATE * MLX_BYTES_PER_SAMPLE);
}

function truncateWavIfNeeded(wav: Buffer, textLength: number): Buffer {
  if (wav.length < WAV_HEADER_SIZE + 4) return wav;
  const dataSize = wav.readUInt32LE(40);
  const cap = maxAudioBytes(textLength);
  if (dataSize <= cap) return wav;

  const truncatedDataSize = cap - (cap % MLX_BYTES_PER_SAMPLE);
  const truncated = Buffer.alloc(WAV_HEADER_SIZE + truncatedDataSize);
  wav.copy(truncated, 0, 0, WAV_HEADER_SIZE);
  wav.copy(truncated, WAV_HEADER_SIZE, WAV_HEADER_SIZE, WAV_HEADER_SIZE + truncatedDataSize);
  // Fix RIFF + data size fields
  truncated.writeUInt32LE(36 + truncatedDataSize, 4);
  truncated.writeUInt32LE(truncatedDataSize, 40);

  const origSec = (dataSize / (MLX_SAMPLE_RATE * MLX_BYTES_PER_SAMPLE)).toFixed(2);
  const cappedSec = (truncatedDataSize / (MLX_SAMPLE_RATE * MLX_BYTES_PER_SAMPLE)).toFixed(2);
  logger.warn("mlx audio truncated (model looping)", {
    textLength,
    origSec,
    cappedSec,
  });
  return truncated;
}

function getMlxBaseUrl(): string {
  return getConfig().REMI_TTS_MLX_URL.replace(/\/$/, "");
}

export function isMlxConfigured(): boolean {
  return Boolean(getConfig().REMI_TTS_MLX_URL);
}

function resolveMlxInstruct(
  text: string,
  emotion: Emotion | undefined,
  connId?: string | null,
): string {
  const override = connId ? getSessionTtsRuntimeOverride(connId) : null;

  let instruct: string;
  let profile: string;

  // Priority 1: user-set voice style (highest — explicit user request)
  if (override?.mlxVoiceStyleId) {
    instruct = buildVoiceStyleInstruct(override.mlxVoiceStyleId, emotion);
    profile = "voice_style";
  } else {
    // Priority 2: NSFW session instruct
    const nsfwInstruct = getConfig().REMI_TTS_MLX_NSFW_INSTRUCT?.trim();
    const nsfwActive = Boolean(connId && isNsfwEnabled(connId));
    if (nsfwActive && nsfwInstruct) {
      instruct = nsfwInstruct;
      profile = "nsfw";
    } else {
      // Priority 3: env static override → Priority 4: per-emotion default
      const envInstruct = getConfig().REMI_TTS_MLX_INSTRUCT?.trim();
      instruct = envInstruct || getMlxInstruct(emotion ?? "neutral", text);
      profile = nsfwActive ? "nsfw_missing_instruct" : "default";
    }
  }

  // Append user speed/pitch modifiers (stack with any style)
  if (override?.mlxSpeedModifier) instruct += override.mlxSpeedModifier;
  if (override?.mlxPitchModifier) instruct += override.mlxPitchModifier;

  logger.debug("mlx instruct", { profile, instruct });
  return instruct;
}

function buildRequestBody(
  text: string,
  emotion?: Emotion,
  stream = false,
  connId?: string | null,
): Record<string, unknown> {
  const temperature = getConfig().REMI_TTS_MLX_TEMPERATURE;
  const body: Record<string, unknown> = {
    model: getConfig().REMI_TTS_MLX_MODEL,
    input: text,
    voice: getConfig().REMI_TTS_MLX_SPEAKER,
    instruct: resolveMlxInstruct(text, emotion, connId),
    language: getConfig().REMI_TTS_MLX_LANGUAGE,
    response_format: "wav",
    stream,
  };
  if (temperature !== undefined) body.temperature = temperature;
  return body;
}

export async function speakWithMlx(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
  connId?: string | null,
): Promise<Buffer> {
  const baseUrl = getMlxBaseUrl();
  const body = buildRequestBody(text, emotion, false, connId);

  logger.debug("mlx 合成请求", {
    speaker: body.voice,
    language: body.language,
    textLen: text.length,
  });

  const t0 = Date.now();
  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(
      errorText
        ? `MLX TTS 请求失败 (${response.status}): ${errorText.slice(0, 240)}`
        : `MLX TTS 请求失败 (${response.status})`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const audio = truncateWavIfNeeded(Buffer.from(arrayBuffer), text.length);
  logger.info("mlx 合成完成", { duration: Date.now() - t0, bytes: audio.length });
  return audio;
}

export async function streamMlxPcm(
  text: string,
  signal: AbortSignal | undefined,
  emotion: Emotion | undefined,
  onChunk: (chunk: TtsPcmChunk) => void,
  connId?: string | null,
): Promise<void> {
  const baseUrl = getMlxBaseUrl();
  const body = buildRequestBody(text, emotion, true, connId);

  const t0 = Date.now();
  let firstChunkMs: number | null = null;

  const response = await fetch(`${baseUrl}/v1/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => "")).trim();
    throw new Error(
      errorText
        ? `MLX TTS stream 失败 (${response.status}): ${errorText.slice(0, 240)}`
        : `MLX TTS stream 失败 (${response.status})`,
    );
  }

  if (!response.body) {
    throw new Error("MLX TTS stream: no response body");
  }

  const reader = response.body.getReader();
  let headerSkipped = false;
  let buffer = Buffer.alloc(0);
  let totalPcmBytes = 0;
  const pcmByteCap = maxAudioBytes(text.length);
  let capReached = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || capReached) break;

      buffer = Buffer.concat([buffer, Buffer.from(value)]);

      // Skip WAV header (first 44 bytes)
      if (!headerSkipped) {
        if (buffer.length < WAV_HEADER_SIZE) continue;
        buffer = buffer.subarray(WAV_HEADER_SIZE);
        headerSkipped = true;
      }

      // Emit PCM in ~4096-sample chunks (8192 bytes at 16-bit)
      const chunkSize = 8192;
      while (buffer.length >= chunkSize) {
        if (totalPcmBytes + chunkSize > pcmByteCap) {
          capReached = true;
          logger.warn("mlx stream truncated (model looping)", {
            textLength: text.length,
            cappedSec: (pcmByteCap / (MLX_SAMPLE_RATE * MLX_BYTES_PER_SAMPLE)).toFixed(2),
          });
          break;
        }
        const pcm = buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);
        totalPcmBytes += chunkSize;

        if (firstChunkMs === null) {
          firstChunkMs = Date.now() - t0;
        }

        onChunk({
          pcm: Buffer.from(pcm),
          sampleRate: 24000,
          channels: 1,
          bitsPerSample: 16,
        });
      }
    }

    // Flush remaining (only if cap not reached)
    if (!capReached && buffer.length > 0 && headerSkipped) {
      const remaining = Math.min(buffer.length, pcmByteCap - totalPcmBytes);
      if (remaining > 0) {
        onChunk({
          pcm: Buffer.from(buffer.subarray(0, remaining)),
          sampleRate: 24000,
          channels: 1,
          bitsPerSample: 16,
        });
      }
    }
  } finally {
    reader.releaseLock();
  }

  logger.info("mlx stream 完成", {
    duration: Date.now() - t0,
    firstChunkMs,
    textLen: text.length,
    truncated: capReached,
  });
}
