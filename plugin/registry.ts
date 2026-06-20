import { isNsfwEnabled } from "../brains/nsfw_mode";
import { createLogger } from "../infra/logger";
import type { PluginSessionContext } from "./types";
import type {
  RemiPlugin,
  CharacterRulesHook,
  TurnInterpreterHook,
  PromptInjectionHook,
  OutputGuardHook,
  TtsModifierHook,
} from "./types";

const logger = createLogger("plugin_registry");
const plugins: RemiPlugin[] = [];

export function registerPlugin(plugin: RemiPlugin): void {
  if (plugins.some((p) => p.id === plugin.id)) {
    logger.warn("plugin already registered, skipping", { id: plugin.id });
    return;
  }
  plugins.push(plugin);
  logger.info("plugin registered", {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
  });
}

function isActive(plugin: RemiPlugin): boolean {
  return plugin.enabled ? plugin.enabled() : true;
}

export function getActivePlugins(): RemiPlugin[] {
  return plugins.filter(isActive);
}

export function getCharacterRulesHooks(): CharacterRulesHook[] {
  return getActivePlugins()
    .filter((p): p is RemiPlugin & { characterRules: CharacterRulesHook } =>
      p.characterRules != null,
    )
    .map((p) => p.characterRules);
}

export function getTurnInterpreterHooks(): TurnInterpreterHook[] {
  return getActivePlugins()
    .filter((p): p is RemiPlugin & { turnInterpreter: TurnInterpreterHook } =>
      p.turnInterpreter != null,
    )
    .map((p) => p.turnInterpreter);
}

export function getPromptInjectionHooks(): PromptInjectionHook[] {
  return getActivePlugins()
    .filter((p): p is RemiPlugin & { promptInjection: PromptInjectionHook } =>
      p.promptInjection != null,
    )
    .map((p) => p.promptInjection);
}

function pluginSessionContext(connId?: string): PluginSessionContext {
  return {
    connId,
    nsfwEnabled: connId ? isNsfwEnabled(connId) : false,
  };
}

/** True when any active plugin requests a lean persona (strips heavy persona layers). */
export function anyPluginWantsLeanPersona(connId?: string): boolean {
  const ctx = pluginSessionContext(connId);
  return getPromptInjectionHooks().some((h) => h.wantsLeanPersona?.(ctx));
}

export function getOutputGuardHooks(): OutputGuardHook[] {
  return getActivePlugins()
    .filter((p): p is RemiPlugin & { outputGuard: OutputGuardHook } =>
      p.outputGuard != null,
    )
    .map((p) => p.outputGuard);
}

export function getTtsModifierHooks(): TtsModifierHook[] {
  return getActivePlugins()
    .filter((p): p is RemiPlugin & { ttsModifier: TtsModifierHook } =>
      p.ttsModifier != null,
    )
    .map((p) => p.ttsModifier);
}

export function notifySessionStart(connId: string): void {
  for (const p of getActivePlugins()) {
    p.onSessionStart?.(connId);
  }
}

export function notifySessionEnd(connId: string): void {
  for (const p of getActivePlugins()) {
    p.onSessionEnd?.(connId);
  }
}
