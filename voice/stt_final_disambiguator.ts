import fs from "fs";
import path from "path";

import { createLogger } from "../infra/logger";

const logger = createLogger("stt_final_disambiguator");

export interface SttFinalDisambiguationResult {
  text: string;
  changed: boolean;
  matchedRuleIds: string[];
}

type RawDisambiguationRule = {
  id?: unknown;
  canonical?: unknown;
  aliases?: unknown;
};

type DisambiguationRule = {
  id: string;
  canonical: string;
  aliases: string[];
};

type CompiledAlias = {
  ruleId: string;
  canonical: string;
  alias: string;
  aliasChars: number;
};

type DictionaryState =
  | {
      kind: "ok";
      rules: DisambiguationRule[];
      aliases: CompiledAlias[];
    }
  | {
      kind: "bypass";
      reason: "disabled" | "missing_path";
    }
  | {
      kind: "error";
      error: string;
    };

type DictionaryCacheEntry = {
  resolvedPath: string | null;
  mtimeMs: number | null;
  state: DictionaryState;
};

let cache: DictionaryCacheEntry | null = null;

function disambiguationEnabled(): boolean {
  const raw = (process.env.REMI_STT_FINAL_DISAMBIG_ENABLED ?? "0").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

export function sttFinalDisambiguationLogDiffEnabled(): boolean {
  const raw = (process.env.REMI_STT_FINAL_DISAMBIG_LOG_DIFF ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false";
}

function dictionaryPath(): string | null {
  const raw = process.env.REMI_STT_FINAL_DISAMBIG_DICT_PATH?.trim();
  return raw ? path.resolve(raw) : null;
}

function charCount(input: string): number {
  return [...input].length;
}

function validateRule(raw: RawDisambiguationRule, index: number): DisambiguationRule {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  if (!id) throw new Error(`rule[${index}].id must be a non-empty string`);

  const canonical = typeof raw.canonical === "string" ? raw.canonical.trim() : "";
  if (!canonical) throw new Error(`rule[${index}].canonical must be a non-empty string`);

  if (!Array.isArray(raw.aliases) || raw.aliases.length === 0) {
    throw new Error(`rule[${index}].aliases must be a non-empty string array`);
  }

  const seenAliases = new Set<string>();
  const aliases: string[] = [];
  for (const aliasRaw of raw.aliases) {
    const alias = typeof aliasRaw === "string" ? aliasRaw.trim() : "";
    if (!alias) throw new Error(`rule[${index}].aliases contains an empty alias`);
    if (charCount(alias) <= 1) {
      throw new Error(`rule[${index}].aliases contains single-char alias "${alias}"`);
    }
    if (alias === canonical) continue;
    if (seenAliases.has(alias)) continue;
    seenAliases.add(alias);
    aliases.push(alias);
  }

  if (aliases.length === 0) {
    throw new Error(`rule[${index}] has no valid aliases after normalization`);
  }

  return { id, canonical, aliases };
}

function buildCompiledAliases(rules: DisambiguationRule[]): CompiledAlias[] {
  return rules
    .flatMap((rule) =>
      rule.aliases.map((alias) => ({
        ruleId: rule.id,
        canonical: rule.canonical,
        alias,
        aliasChars: charCount(alias),
      })),
    )
    .sort((a, b) => {
      if (b.aliasChars !== a.aliasChars) return b.aliasChars - a.aliasChars;
      if (b.alias.length !== a.alias.length) return b.alias.length - a.alias.length;
      return a.alias.localeCompare(b.alias, "zh-CN");
    });
}

function loadDictionary(): DictionaryState {
  if (!disambiguationEnabled()) {
    return { kind: "bypass", reason: "disabled" };
  }

  const resolvedPath = dictionaryPath();
  if (!resolvedPath) {
    return { kind: "bypass", reason: "missing_path" };
  }

  let mtimeMs: number | null = null;
  try {
    mtimeMs = fs.statSync(resolvedPath).mtimeMs;
  } catch (err) {
    const error = `failed to stat dict: ${(err as Error).message}`;
    if (
      cache &&
      cache.resolvedPath === resolvedPath &&
      cache.mtimeMs === null &&
      cache.state.kind === "error" &&
      cache.state.error === error
    ) {
      return cache.state;
    }
    const state: DictionaryState = { kind: "error", error };
    cache = { resolvedPath, mtimeMs: null, state };
    logger.warn("STT final disambiguation disabled by dictionary load failure", {
      path: resolvedPath,
      error,
    });
    return state;
  }

  if (cache && cache.resolvedPath === resolvedPath && cache.mtimeMs === mtimeMs) {
    return cache.state;
  }

  try {
    const rawText = fs.readFileSync(resolvedPath, "utf8");
    const parsed = JSON.parse(rawText) as RawDisambiguationRule[];
    if (!Array.isArray(parsed)) {
      throw new Error("dictionary must be a JSON array");
    }
    const rules = parsed.map((entry, index) => validateRule(entry, index));
    const aliases = buildCompiledAliases(rules);
    const state: DictionaryState = { kind: "ok", rules, aliases };
    cache = { resolvedPath, mtimeMs, state };
    return state;
  } catch (err) {
    const error = (err as Error).message;
    const state: DictionaryState = { kind: "error", error };
    cache = { resolvedPath, mtimeMs, state };
    logger.warn("STT final disambiguation disabled by dictionary parse failure", {
      path: resolvedPath,
      error,
    });
    return state;
  }
}

export function disambiguateSttFinal(rawText: string): SttFinalDisambiguationResult {
  if (!rawText) {
    return { text: rawText, changed: false, matchedRuleIds: [] };
  }

  const state = loadDictionary();
  if (state.kind !== "ok" || state.aliases.length === 0) {
    return { text: rawText, changed: false, matchedRuleIds: [] };
  }

  let text = rawText;
  const matchedRuleIds = new Set<string>();

  for (const alias of state.aliases) {
    if (text.includes(alias.canonical)) continue;
    if (!text.includes(alias.alias)) continue;
    text = text.split(alias.alias).join(alias.canonical);
    matchedRuleIds.add(alias.ruleId);
  }

  return {
    text,
    changed: text !== rawText,
    matchedRuleIds: [...matchedRuleIds],
  };
}

export function __resetSttFinalDisambiguatorForTests(): void {
  cache = null;
}
