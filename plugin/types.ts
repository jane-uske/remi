import type { TurnInterpretation, ResponsePolicy } from "../brain/turn_interpreter";
import type { PersonaState } from "../persona";
import type { TtsRequestContext } from "../voice/tts_request_context";

// ── Hook interfaces ────────────────────────────────────────────────

export interface CharacterRulesHook {
  extendRules(baseRules: string[]): string[];
}

export interface TurnInterpreterHook {
  postProcess(
    interpretation: TurnInterpretation,
    policy: ResponsePolicy,
    input: { userMessage: string; inputSource: "text" | "voice" },
  ): { interpretation: TurnInterpretation; policy: ResponsePolicy };
}

export interface PromptInjectionHook {
  getPromptSections(context: {
    userMessage: string;
    persona: PersonaState;
    interpretation?: TurnInterpretation | null;
  }): string[];
}

export type OutputGuardResult =
  | { action: "pass" }
  | { action: "modify"; modified: string }
  | { action: "block"; replacement: string };

export interface OutputGuardHook {
  review(
    reply: string,
    context: { userMessage: string; persona: PersonaState },
  ): OutputGuardResult;
}

export interface TtsModifierHook {
  modifyTtsParams(
    params: {
      expressionPreset: string;
      speechRate: number;
      emotion?: string;
      emotionScale?: number;
      contextText?: string;
    },
    context: TtsRequestContext,
  ): {
    expressionPreset: string;
    speechRate: number;
    emotion?: string;
    emotionScale?: number;
    contextText?: string;
  };
}

// ── Plugin definition ──────────────────────────────────────────────

export interface RemiPlugin {
  id: string;
  name: string;
  version: string;
  enabled?(): boolean;

  characterRules?: CharacterRulesHook;
  turnInterpreter?: TurnInterpreterHook;
  promptInjection?: PromptInjectionHook;
  outputGuard?: OutputGuardHook;
  ttsModifier?: TtsModifierHook;
}
