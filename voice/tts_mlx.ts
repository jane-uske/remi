import { getConfig } from "../server/config";
import { createLogger } from "../infra/logger";
import { getMlxInstruct, type Emotion } from "./tts_emotion";
import type { TtsPcmChunk } from "./tts";

const logger = createLogger("tts_mlx");

const WAV_HEADER_SIZE = 44;

function getMlxBaseUrl(): string {
  return getConfig().REMI_TTS_MLX_URL.replace(/\/$/, "");
}

export function isMlxConfigured(): boolean {
  return Boolean(getConfig().REMI_TTS_MLX_URL);
}

function buildRequestBody(text: string, emotion?: Emotion, stream = false): Record<string, unknown> {
  const envInstruct = getConfig().REMI_TTS_MLX_INSTRUCT?.trim();
  return {
    model: getConfig().REMI_TTS_MLX_MODEL,
    input: text,
    voice: getConfig().REMI_TTS_MLX_SPEAKER,
    instruct: envInstruct || getMlxInstruct(emotion ?? "neutral", text),
    language: getConfig().REMI_TTS_MLX_LANGUAGE,
    response_format: "wav",
    stream,
  };
}

export async function speakWithMlx(
  text: string,
  signal?: AbortSignal,
  emotion?: Emotion,
): Promise<Buffer> {
  const baseUrl = getMlxBaseUrl();
  const body = buildRequestBody(text, emotion, false);

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
  const audio = Buffer.from(arrayBuffer);
  logger.info("mlx 合成完成", { duration: Date.now() - t0, bytes: audio.length });
  return audio;
}

export async function streamMlxPcm(
  text: string,
  signal: AbortSignal | undefined,
  emotion: Emotion | undefined,
  onChunk: (chunk: TtsPcmChunk) => void,
): Promise<void> {
  const baseUrl = getMlxBaseUrl();
  const body = buildRequestBody(text, emotion, true);

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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

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
        const pcm = buffer.subarray(0, chunkSize);
        buffer = buffer.subarray(chunkSize);

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

    // Flush remaining
    if (buffer.length > 0 && headerSkipped) {
      onChunk({
        pcm: Buffer.from(buffer),
        sampleRate: 24000,
        channels: 1,
        bitsPerSample: 16,
      });
    }
  } finally {
    reader.releaseLock();
  }

  logger.info("mlx stream 完成", {
    duration: Date.now() - t0,
    firstChunkMs,
    textLen: text.length,
  });
}
