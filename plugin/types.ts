import type { TurnInterpretation, ResponsePolicy } from "../brain/turn_interpreter";
import type { PersonaState } from "../persona";
import type { TtsRequestContext } from "../voice/tts_request_context";

// ── Hook interfaces ────────────────────────────────────────────────

/** Per-connection context passed to plugin hooks (e.g. adult mode session flag). */
export interface PluginSessionContext {
  connId?: string;
  /** Mirrors brains/nsfw_mode isNsfwEnabled(connId) — set by the host. */
  nsfwEnabled?: boolean;
}

export interface CharacterRulesHook {
  extendRules(baseRules: string[], context?: PluginSessionContext): string[];
}

export interface TurnInterpreterHook {
  postProcess(
    interpretation: TurnInterpretation,
    policy: ResponsePolicy,
    input: { userMessage: string; inputSource: "text" | "voice"; connId?: string },
  ): { interpretation: TurnInterpretation; policy: ResponsePolicy };
}

export interface PromptInjectionHook {
  getPromptSections(context: {
    userMessage: string;
    persona: PersonaState;
    interpretation?: TurnInterpretation | null;
  } & PluginSessionContext): string[];
  /** When true, the host should strip heavy persona layers (soul, tone contract,
   *  relational stance, proactive intent) so the plugin's own steering dominates. */
  wantsLeanPersona?(context?: PluginSessionContext): boolean;
}

export type OutputGuardResult =
  | { action: "pass" }
  | { action: "modify"; modified: string }
  | { action: "block"; replacement: string };

export interface OutputGuardHook {
  review(
    reply: string,
    context: { userMessage: string; persona: PersonaState } & PluginSessionContext,
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

  onSessionStart?(connId: string): void;
  onSessionEnd?(connId: string): void;

  characterRules?: CharacterRulesHook;
  turnInterpreter?: TurnInterpreterHook;
  promptInjection?: PromptInjectionHook;
  outputGuard?: OutputGuardHook;
  ttsModifier?: TtsModifierHook;
}
