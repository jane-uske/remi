import { promises as fs } from "node:fs";
import path from "node:path";

import type { Emotion } from "../avatar/types";
import {
  clearActivePersonaPack,
  setActivePersonaPack,
} from "../brains/persona_pack_mode";
import { loadPersonaPack } from "../persona/pack/loader";
import { resetConfig } from "../server/config";
import { loadEnvFile } from "../server/config/load_env";
import {
  resolvePackMlxInstruct,
  resolvePackMlxSpeaker,
  speakWithMlx,
} from "../voice/tts_mlx";

export const NAMI_VOICE_EVAL_CONN_ID = "nami-voice-eval";
export const NAMI_VOICE_EVAL_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "artifacts/nami_voice_eval",
);

export interface NamiVoiceEvalCase {
  id: "weather-read" | "money-spark" | "soft-guard";
  text: string;
  emotion: Emotion;
}

export interface NamiVoiceEvalMetadata {
  packId: "nami";
  speaker: string | null;
  instruct: string | null;
  edgeVoiceId: string | null;
  outputDir: string;
}

export function buildNamiVoiceEvalCases(): NamiVoiceEvalCase[] {
  return [
    {
      id: "weather-read",
      emotion: "curious",
      text: "云层往东压，风向也变了。别发呆，照我说的把帆收起来，晚一点就来不及了。",
    },
    {
      id: "money-spark",
      emotion: "playful",
      text: "等等，你说这笔钱没人认领？先别乱花，拿来我算算。帮你管账可以，抽成另算。",
    },
    {
      id: "soft-guard",
      emotion: "concerned",
      text: "啧，别硬撑了。事情已经够麻烦，你再倒下我还得多救一个。坐好，我来想办法。",
    },
  ];
}

export function prepareNamiVoiceEvalRuntime(): void {
  loadEnvFile();
  resetConfig();
}

export function resolveNamiVoiceEvalMetadata(
  connId = NAMI_VOICE_EVAL_CONN_ID,
): NamiVoiceEvalMetadata {
  setActivePersonaPack(connId, "nami");
  const pack = loadPersonaPack("nami");
  return {
    packId: "nami",
    speaker: resolvePackMlxSpeaker(connId),
    instruct: resolvePackMlxInstruct(connId),
    edgeVoiceId: pack?.manifest.voice?.voiceId?.trim() || null,
    outputDir: NAMI_VOICE_EVAL_OUTPUT_DIR,
  };
}

async function runNamiVoiceEval(): Promise<void> {
  prepareNamiVoiceEvalRuntime();
  const connId = NAMI_VOICE_EVAL_CONN_ID;
  const metadata = resolveNamiVoiceEvalMetadata(connId);
  await fs.mkdir(NAMI_VOICE_EVAL_OUTPUT_DIR, { recursive: true });

  console.log("[nami_voice_eval] voice metadata");
  console.log(JSON.stringify(metadata, null, 2));

  const cases = buildNamiVoiceEvalCases();
  try {
    for (let i = 0; i < cases.length; i += 1) {
      const item = cases[i];
      const wav = await speakWithMlx(item.text, undefined, item.emotion, connId);
      const filePath = path.join(
        NAMI_VOICE_EVAL_OUTPUT_DIR,
        `${String(i + 1).padStart(2, "0")}-${item.id}.wav`,
      );
      await fs.writeFile(filePath, wav);
      console.log(
        JSON.stringify(
          {
            id: item.id,
            emotion: item.emotion,
            speaker: metadata.speaker,
            instruct: metadata.instruct,
            filePath,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    clearActivePersonaPack(connId);
  }
}

if (require.main === module) {
  runNamiVoiceEval().catch((error) => {
    console.error("[nami_voice_eval] failed:", error);
    process.exitCode = 1;
  });
}
