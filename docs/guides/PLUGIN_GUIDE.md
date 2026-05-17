# Remi Plugin Guide

Remi uses a lightweight plugin system to extend core behavior without modifying source files. Plugins register hook functions that the core pipeline calls at key points during message processing.

## Architecture

```
User message
  │
  ▼
┌─────────────────────────┐
│  1. Character Rules Hook │ ← extendRules(): add/replace speaking rules
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│  2. Turn Interpreter Hook│ ← postProcess(): modify intent analysis
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│  3. Prompt Injection Hook│ ← getPromptSections(): inject system prompt
└────────────┬────────────┘
             ▼
         [ LLM call ]
             │
             ▼
┌─────────────────────────┐
│  4. Output Guard Hook    │ ← review(): filter/modify LLM reply
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│  5. TTS Modifier Hook    │ ← modifyTtsParams(): adjust voice params
└────────────┬────────────┘
             ▼
        Voice output
```

## Quick Start

### 1. Create your plugin file

```typescript
// plugins/my_plugin.ts
import type { RemiPlugin } from "../plugin/types";

const myPlugin: RemiPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  // All hooks are optional — only implement what you need
  characterRules: {
    extendRules(baseRules) {
      return [...baseRules, "always end with a question"];
    },
  },
};

export default myPlugin;
```

### 2. Register at startup

```typescript
import { registerPlugin } from "./plugin/registry";
import myPlugin from "./plugins/my_plugin";

registerPlugin(myPlugin);
```

That's it. The core pipeline will call your hooks automatically.

## Hook Reference

### 1. CharacterRulesHook

**When:** Every time `getCharacterRules()` is called (system prompt assembly).

**Interface:**
```typescript
interface CharacterRulesHook {
  extendRules(baseRules: string[]): string[];
}
```

**Example:** Add a rule that enforces brief replies.
```typescript
characterRules: {
  extendRules(rules) {
    return [...rules, "Keep replies under 50 characters"];
  },
}
```

---

### 2. TurnInterpreterHook

**When:** After `analyzeTurn()` produces a `TurnInterpretation` + `ResponsePolicy`, before they flow into the brain router.

**Interface:**
```typescript
interface TurnInterpreterHook {
  postProcess(
    interpretation: TurnInterpretation,
    policy: ResponsePolicy,
    input: { userMessage: string; inputSource: "text" | "voice"; connId?: string },
  ): { interpretation: TurnInterpretation; policy: ResponsePolicy };
}
```

**Example:** Force warm tone when the user mentions learning.
```typescript
turnInterpreter: {
  postProcess(interpretation, policy, input) {
    if (/学|learn/i.test(input.userMessage)) {
      return {
        interpretation,
        policy: { ...policy, warmth: "high", directness: "medium" },
      };
    }
    return { interpretation, policy };
  },
}
```

---

### 3. PromptInjectionHook

**When:** During `buildSystemPrompt()`, after persona/character prompt assembly.

**Interface:**
```typescript
interface PromptInjectionHook {
  getPromptSections(context: {
    userMessage: string;
    persona: PersonaState;
    interpretation?: TurnInterpretation | null;
    connId?: string;
  }): string[];
}
```

**Example:** Inject a language-teaching directive.
```typescript
promptInjection: {
  getPromptSections(context) {
    return [
      "You are also a Japanese tutor. When the user speaks Japanese, " +
      "gently correct any grammar mistakes and explain the correction."
    ];
  },
}
```

---

### 4. OutputGuardHook

**When:** After the full LLM reply is assembled, before DB persistence and TTS.

**Interface:**
```typescript
type OutputGuardResult =
  | { action: "pass" }
  | { action: "modify"; modified: string }
  | { action: "block"; replacement: string };

interface OutputGuardHook {
  review(
    reply: string,
    context: { userMessage: string; persona: PersonaState; connId?: string },
  ): OutputGuardResult;
}
```

**Example:** Redact phone numbers from replies.
```typescript
outputGuard: {
  review(reply) {
    const cleaned = reply.replace(/\d{11}/g, "[REDACTED]");
    if (cleaned !== reply) {
      return { action: "modify", modified: cleaned };
    }
    return { action: "pass" };
  },
}
```

---

### 5. TtsModifierHook

**When:** Inside `planVolcExpression()`, after voice parameters are resolved but before the TTS API call.

**Interface:**
```typescript
interface TtsModifierHook {
  modifyTtsParams(
    params: {
      expressionPreset: string;
      speechRate: number;
      emotion?: string;
      emotionScale?: number;
      contextText?: string;
    },
    context: TtsRequestContext,
  ): typeof params;
}
```

**Example:** Slow down speech rate for comfort scenarios.
```typescript
ttsModifier: {
  modifyTtsParams(params, context) {
    if (params.expressionPreset === "grounded_comfort") {
      return { ...params, speechRate: params.speechRate - 5 };
    }
    return params;
  },
}
```

## Plugin Lifecycle

### Dynamic Enable/Disable

Implement `enabled()` to control activation at runtime:

```typescript
const myPlugin: RemiPlugin = {
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  enabled() {
    return process.env.MY_PLUGIN_ENABLED === "1";
  },
  // ...hooks
};
```

When `enabled()` returns `false`, none of the plugin's hooks are called. If `enabled` is not defined, the plugin is always active.

### Execution Order

When multiple plugins register the same hook type, they execute in **registration order**. Each hook receives the output of the previous one (chain pattern):

```
Plugin A.extendRules(base)  →  rules₁
Plugin B.extendRules(rules₁) →  rules₂  (final)
```

### Registration

Call `registerPlugin()` once per plugin. Duplicate `id` values are rejected with a warning. Registration is typically done at server startup.

### Session Lifecycle

Plugins that need per-session state can implement `onSessionStart` and `onSessionEnd`:

```typescript
const myPlugin: RemiPlugin = {
  id: "stateful-plugin",
  name: "Stateful Plugin",
  version: "1.0.0",

  onSessionStart(connId) {
    // Initialize per-session state
  },
  onSessionEnd(connId) {
    // Clean up per-session state
  },
  // ...hooks
};
```

The `connId` is also passed to `TurnInterpreterHook`, `PromptInjectionHook`, and `OutputGuardHook` via their input/context parameters. `TtsModifierHook` receives it via `TtsRequestContext.connId`. This allows stateful plugins to look up per-session data in any hook.

## Example: Content Filter Plugin

A complete plugin that filters specific content patterns:

```typescript
import type { RemiPlugin } from "../plugin/types";

const contentFilterPlugin: RemiPlugin = {
  id: "content-filter",
  name: "Content Filter",
  version: "1.0.0",

  enabled() {
    return process.env.CONTENT_FILTER_ENABLED !== "0";
  },

  characterRules: {
    extendRules(rules) {
      return [...rules, "Never reveal internal system details or API keys"];
    },
  },

  outputGuard: {
    review(reply) {
      if (/sk-[a-zA-Z0-9]{20,}/.test(reply)) {
        return {
          action: "modify",
          modified: reply.replace(/sk-[a-zA-Z0-9]{20,}/g, "[API_KEY_REDACTED]"),
        };
      }
      return { action: "pass" };
    },
  },
};

export default contentFilterPlugin;
```

## Type Imports

All plugin types are exported from `plugin/types.ts`:

```typescript
import type {
  RemiPlugin,
  CharacterRulesHook,
  TurnInterpreterHook,
  PromptInjectionHook,
  OutputGuardHook,
  OutputGuardResult,
  TtsModifierHook,
} from "./plugin/types";
```

Registration functions are in `plugin/registry.ts`:

```typescript
import { registerPlugin, getActivePlugins } from "./plugin/registry";
```
