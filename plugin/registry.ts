import { createLogger } from "../infra/logger";
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
