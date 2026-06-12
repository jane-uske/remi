# Remi Persona Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-facing Remi persona presets that change expression style and humor while preserving one shared Remi identity, shared relationship continuity, and shared Memory V2 state.

**Architecture:** Introduce a formal preset registry under `persona/`, persist one active preset per user in Postgres, hydrate that preset during session bootstrap, and expose a user-facing selector in Web. The preset affects only prompt expression guidance and persona profile assembly; it must not fork messages, relationship state, working memory, or episodes.

**Tech Stack:** TypeScript, Node.js, Postgres, WebSocket session transport, Next.js/React, Mocha + ts-node

---

## File Map

### New files

- `persona/presets.ts`
  - Formal user-facing preset schema and registry
- `storage/repositories/user_persona_preset_repository.ts`
  - Load/save the active preset for one user
- `test/persona/presets.test.ts`
  - Preset registry coverage and guardrails
- `test/storage/user_persona_preset_repository.test.ts`
  - Repository load/save behavior
- `web/test/personaPresetSelector.test.ts`
  - Selector UI behavior

### Modified files

- `persona/index.ts`
  - Extend prompt assembly with a small `【表达风格】` block generated from structured preset fields
- `brain/prompt_builder.ts`
  - Feed preset-derived style guidance into the persona prompt path without bloating system prompt assembly
- `brains/remi_session_context.ts`
  - Add session-level apply/get helpers for user-facing preset IDs
- `brains/dev_presets.ts`
  - Stop acting as the source of truth for user presets; keep only dev-only compatibility helpers
- `storage/schema.sql`
  - Add a narrow table for one active preset per user
- `storage/types.ts`
  - Add DB type for persisted preset row
- `server/session/bootstrap.ts`
  - Load persisted preset after user identity is resolved
- `server/session/message_router.ts`
  - Add WS commands for reading/updating the user preset
- `server/session/developer.ts`
  - Reuse validated preset IDs instead of a separate hardcoded list
- `server/session/index.ts`
  - Wire new preset read/save handlers into the live session runtime
- `test/brain/prompt_builder.test.ts`
  - Assert style block rendering and continuity boundaries
- `test/server/session/developer.test.ts`
  - Keep dev command compatibility after preset extraction
- `test/server/session/user_identity_bootstrap.test.ts`
  - Extend bootstrap coverage for preset hydration
- `web/src/components/RemiAccountMenu.tsx`
  - Host the user-facing preset selector
- `web/src/hooks/useRemiChat.ts`
  - Send/receive preset messages and expose actions/state to UI
- `web/test/remiAccountMenu.test.ts`
  - Cover rendering and change events
- `TASKS.md`
  - Record the new work item after implementation is complete

### Existing files to read before coding

- `docs/superpowers/specs/2026-04-19-remi-persona-presets-design.md`
- `persona/index.ts`
- `brain/prompt_builder.ts`
- `server/session/bootstrap.ts`
- `server/session/message_router.ts`
- `server/session/index.ts`
- `web/src/hooks/useRemiChat.ts`
- `web/src/components/RemiAccountMenu.tsx`

---

### Task 1: Extract a Formal Persona Preset Registry

**Files:**
- Create: `persona/presets.ts`
- Test: `test/persona/presets.test.ts`
- Modify: `brains/dev_presets.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
const assert = require("assert").strict;
const {
  getPersonaPreset,
  listPersonaPresets,
  isPersonaPresetId,
} = require("../../persona/presets");

describe("persona preset registry", () => {
  it("exposes the four user-facing presets", () => {
    const ids = listPersonaPresets().map((preset: { id: string }) => preset.id);
    assert.deepEqual(ids, [
      "witty_warm",
      "relaxed_roast",
      "playful_attached",
      "calm_healing",
    ]);
  });

  it("guards unknown preset ids", () => {
    assert.equal(isPersonaPresetId("witty_warm"), true);
    assert.equal(isPersonaPresetId("nope"), false);
    assert.equal(getPersonaPreset("relaxed_roast").expression.teasingStyle, "light");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/persona/presets.test.ts"
```

Expected: FAIL with `Cannot find module '../../persona/presets'`

- [ ] **Step 3: Write the minimal registry implementation**

```ts
export type PersonaPresetId =
  | "witty_warm"
  | "relaxed_roast"
  | "playful_attached"
  | "calm_healing";

export type PersonaStylePreset = {
  id: PersonaPresetId;
  label: string;
  summary: string;
  profile: {
    coreIdentity: string;
    toneGuide: string;
    proactiveGuide: string;
  };
  expression: {
    humorLevel: "low" | "medium" | "high";
    playfulness: "low" | "medium" | "high";
    teasingStyle: "off" | "light" | "playful";
    directness: "soft" | "balanced" | "clear";
    warmth: "steady" | "warm" | "bright";
    proactiveEnergy: "low" | "guarded" | "balanced";
    opinionStrength: "soft" | "balanced" | "clear";
    banterAllowed: boolean;
  };
};

const PRESETS: Record<PersonaPresetId, PersonaStylePreset> = {
  witty_warm: {
    id: "witty_warm",
    label: "温柔机灵",
    summary: "稳、会接、带一点轻幽默。",
    profile: {
      coreIdentity: "温柔、稳定、会自然接住对话，也会轻轻带一点机灵感。",
      toneGuide: "先接住，再轻轻推进，幽默只点到为止。",
      proactiveGuide: "主动保持低打扰，像自然续话，不像提醒器。",
    },
    expression: {
      humorLevel: "medium",
      playfulness: "medium",
      teasingStyle: "off",
      directness: "balanced",
      warmth: "warm",
      proactiveEnergy: "guarded",
      opinionStrength: "soft",
      banterAllowed: true,
    },
  },
  relaxed_roast: {
    id: "relaxed_roast",
    label: "松弛吐槽",
    summary: "更有梗，轻微嘴贫，但不攻击。",
    profile: {
      coreIdentity: "松弛、口语化、偶尔会轻轻吐槽，但底色还是接得住人。",
      toneGuide: "可以更有梗，但不要阴阳怪气，不要刺人。",
      proactiveGuide: "主动时像自然接梗或补一句看法，不要抢话。",
    },
    expression: {
      humorLevel: "high",
      playfulness: "medium",
      teasingStyle: "light",
      directness: "clear",
      warmth: "steady",
      proactiveEnergy: "guarded",
      opinionStrength: "balanced",
      banterAllowed: true,
    },
  },
  playful_attached: {
    id: "playful_attached",
    label: "活泼黏人",
    summary: "更轻快、更亮、更会逗。",
    profile: {
      coreIdentity: "反应更快、更轻快，愿意把气氛托起来，但不做浮夸角色。",
      toneGuide: "可以更亮、更生活化，但别过甜、别过吵。",
      proactiveGuide: "主动可以略多一点，像有点黏人的自然接话。",
    },
    expression: {
      humorLevel: "medium",
      playfulness: "high",
      teasingStyle: "playful",
      directness: "balanced",
      warmth: "bright",
      proactiveEnergy: "balanced",
      opinionStrength: "soft",
      banterAllowed: true,
    },
  },
  calm_healing: {
    id: "calm_healing",
    label: "冷静治愈",
    summary: "更稳、更静、更能接住人。",
    profile: {
      coreIdentity: "安静、稳、会让人慢下来，但不是治疗师口吻。",
      toneGuide: "少夸张，更多 grounded 感，幽默只保留很轻的一点。",
      proactiveGuide: "主动更克制，优先在场感和轻确认。",
    },
    expression: {
      humorLevel: "low",
      playfulness: "low",
      teasingStyle: "off",
      directness: "soft",
      warmth: "steady",
      proactiveEnergy: "low",
      opinionStrength: "soft",
      banterAllowed: false,
    },
  },
};

export function listPersonaPresets(): PersonaStylePreset[] {
  return Object.values(PRESETS);
}

export function getPersonaPreset(id: PersonaPresetId): PersonaStylePreset {
  return PRESETS[id];
}

export function isPersonaPresetId(value: string): value is PersonaPresetId {
  return value in PRESETS;
}
```

Also narrow `brains/dev_presets.ts` to import `PersonaPresetId`, `getPersonaPreset`, and `isPersonaPresetId` from `persona/presets.ts` instead of keeping a second source of truth.

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/persona/presets.test.ts" "test/server/session/developer.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add persona/presets.ts test/persona/presets.test.ts brains/dev_presets.ts test/server/session/developer.test.ts
git commit -m "feat: add formal remi persona preset registry"
```

---

### Task 2: Persist One Active Persona Preset per User

**Files:**
- Modify: `storage/schema.sql`
- Modify: `storage/types.ts`
- Create: `storage/repositories/user_persona_preset_repository.ts`
- Test: `test/storage/user_persona_preset_repository.test.ts`

- [ ] **Step 1: Write the failing repository test**

```ts
const assert = require("assert").strict;
const repo = require("../../storage/repositories/user_persona_preset_repository");

describe("user persona preset repository", () => {
  it("returns null when a user has no saved preset", async () => {
    const value = await repo.getUserPersonaPreset("00000000-0000-0000-0000-000000000001");
    assert.equal(value, null);
  });

  it("upserts and reloads the active preset", async () => {
    const userId = "00000000-0000-0000-0000-000000000002";
    await repo.saveUserPersonaPreset(userId, "playful_attached");
    const value = await repo.getUserPersonaPreset(userId);
    assert.equal(value, "playful_attached");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/storage/user_persona_preset_repository.test.ts"
```

Expected: FAIL with `Cannot find module '../../storage/repositories/user_persona_preset_repository'`

- [ ] **Step 3: Add the schema and repository**

Add this table to `storage/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS user_persona_presets (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  preset_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_persona_presets_preset_id
  ON user_persona_presets (preset_id);
```

Add this type to `storage/types.ts`:

```ts
export interface DbUserPersonaPreset {
  user_id: string;
  preset_id: string;
  updated_at: Date;
}
```

Create `storage/repositories/user_persona_preset_repository.ts`:

```ts
import { query } from "../database";
import type { PersonaPresetId } from "../../persona/presets";

export async function getUserPersonaPreset(userId: string): Promise<PersonaPresetId | null> {
  const result = await query(
    `SELECT preset_id
       FROM user_persona_presets
      WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0] as { preset_id?: PersonaPresetId } | undefined;
  return row?.preset_id ?? null;
}

export async function saveUserPersonaPreset(
  userId: string,
  presetId: PersonaPresetId,
): Promise<void> {
  await query(
    `INSERT INTO user_persona_presets (user_id, preset_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id)
     DO UPDATE SET
       preset_id = EXCLUDED.preset_id,
       updated_at = now()`,
    [userId, presetId],
  );
}
```

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/storage/user_persona_preset_repository.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add storage/schema.sql storage/types.ts storage/repositories/user_persona_preset_repository.ts test/storage/user_persona_preset_repository.test.ts
git commit -m "feat: persist active remi persona preset per user"
```

---

### Task 3: Hydrate the Preset into Session Bootstrap and Prompt Assembly

**Files:**
- Modify: `brains/remi_session_context.ts`
- Modify: `persona/index.ts`
- Modify: `brain/prompt_builder.ts`
- Modify: `server/session/bootstrap.ts`
- Modify: `test/brain/prompt_builder.test.ts`
- Modify: `test/server/session/user_identity_bootstrap.test.ts`

- [ ] **Step 1: Write the failing behavior tests**

Add this case to `test/brain/prompt_builder.test.ts`:

```ts
it("renders a compact persona style block for the selected preset", () => {
  const { createDefaultPersona } = require("../../persona");
  const { applyUserPersonaPreset } = require("../../brains/remi_session_context");
  const { buildPrompt } = require("../../brain/prompt_builder");

  const persona = createDefaultPersona();
  applyUserPersonaPreset(persona, "relaxed_roast");

  const messages = buildPrompt({
    memory: [],
    emotion: "neutral",
    history: [],
    userMessage: "你说句实话",
    persona,
  });

  const system = messages[0].content;
  assert.ok(system.includes("【表达风格】"));
  assert.ok(system.includes("允许轻微吐槽"));
  assert.ok(!system.includes("不同的人格有不同记忆"));
});
```

Add this bootstrap case to `test/server/session/user_identity_bootstrap.test.ts`:

```ts
const bootstrap = require("../../server/session/bootstrap");

it("hydrates the saved persona preset after resolving the storage user", async () => {
  const applied: string[] = [];
  const original = bootstrap.hydrateUserPersonaPreset;
  const brain = {
    setUserId() {},
    applyUserPersonaPreset(presetId: string) {
      applied.push(presetId);
    },
  };

  bootstrap.hydrateUserPersonaPreset = async (input: any) => {
    input.brain.applyUserPersonaPreset("playful_attached");
  };

  try {
    await bootstrap.hydrateUserPersonaPreset({ brain, userId: "u1" });
    assert.deepEqual(applied, ["playful_attached"]);
  } finally {
    bootstrap.hydrateUserPersonaPreset = original;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/brain/prompt_builder.test.ts" "test/server/session/user_identity_bootstrap.test.ts"
```

Expected: FAIL because `applyUserPersonaPreset` and `hydrateUserPersonaPreset` do not exist yet

- [ ] **Step 3: Implement session apply/hydration and prompt rendering**

In `brains/remi_session_context.ts`, add a narrow helper:

```ts
import { getPersonaPreset, type PersonaPresetId } from "../persona/presets";

export function applyUserPersonaPreset(persona: PersonaState, presetId: PersonaPresetId): void {
  const preset = getPersonaPreset(presetId);
  persona.profile = {
    presetId: preset.id,
    label: preset.label,
    coreIdentity: preset.profile.coreIdentity,
    toneGuide: preset.profile.toneGuide,
    proactiveGuide: preset.profile.proactiveGuide,
  };
}

applyUserPersonaPreset(presetId: PersonaPresetId): void {
  applyUserPersonaPreset(this.persona, presetId);
}
```

In `persona/index.ts`, add a compact style block builder:

```ts
function buildExpressionStyleGuidance(persona: PersonaState): string {
  switch (persona.profile.presetId) {
    case "relaxed_roast":
      return "【表达风格】允许轻微吐槽和松弛口语感；可以直接一点，但不要阴阳怪气、不要刺人。";
    case "playful_attached":
      return "【表达风格】整体更轻快、更亮一点；允许轻 playful tease，但不要过甜、不要闹腾。";
    case "calm_healing":
      return "【表达风格】整体更稳、更 grounded；幽默只保留很轻的一点，不要像治疗师口吻。";
    default:
      return "【表达风格】保持温柔机灵；幽默轻一点，先接住，再自然推进。";
  }
}
```

Then inject it in `buildPersonaPrompt()` before `【人格设定】`.

In `server/session/bootstrap.ts`, load the persisted preset after `brain.setUserId(userId)`:

```ts
import { getUserPersonaPreset } from "../../storage/repositories/user_persona_preset_repository";

export async function hydrateUserPersonaPreset(input: {
  userId: string;
  brain: Pick<RemiSessionContext, "applyUserPersonaPreset">;
}): Promise<void> {
  const presetId = await getUserPersonaPreset(input.userId);
  if (presetId) {
    input.brain.applyUserPersonaPreset(presetId);
  }
}

await hydrateUserPersonaPreset({
  userId,
  brain: input.brain,
});
```

Keep the helper narrow. It should not own session creation, history restore, or relationship hydrate. Its only job is to apply the saved user preset if one exists.

If you need a matching prompt-builder tweak in `brain/prompt_builder.ts`, keep it to passing through the persona state already assembled by `RemiSessionContext`. Do not add a second preset lookup path there.

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/brain/prompt_builder.test.ts" "test/server/session/user_identity_bootstrap.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add brains/remi_session_context.ts persona/index.ts brain/prompt_builder.ts server/session/bootstrap.ts test/brain/prompt_builder.test.ts test/server/session/user_identity_bootstrap.test.ts
git commit -m "feat: hydrate user persona presets into remi sessions"
```

---

### Task 4: Add WebSocket Read/Write Commands for the Active Preset

**Files:**
- Modify: `server/session/message_router.ts`
- Modify: `server/session/index.ts`
- Modify: `web/src/hooks/useRemiChat.ts`
- Test: `test/server/session/persona_preset_session.test.ts`

- [ ] **Step 1: Write the failing session protocol test**

```ts
const assert = require("assert").strict;
const { attachSessionMessageHandlers } = require("../../server/session/message_router");

describe("persona preset session protocol", () => {
  it("routes persona preset get/set commands", () => {
    const seen: string[] = [];
    let handler: (raw: unknown) => void = () => {};
    const ws = { on(_event: string, listener: (raw: unknown) => void) { handler = listener; } };

    attachSessionMessageHandlers({
      ws,
      connId: "c1",
      storageUserId: "u1",
      parseHistoryCursor() { return null; },
      sendHistoryPage: async () => {},
      handleAudioPcm() {},
      runDevApplyPreset() {},
      runDevSetTtsVoice() {},
      runDevResetState() {},
      handleDuplexStart() {},
      handleDuplexStop() {},
      handleAudioStream() {},
      handleAudioChunk() {},
      handleAudioEnd() {},
      handlePlaybackStart() {},
      handlePlaybackEnd() {},
      handleClientContext() {},
      handleChat() {},
      handleGetPersonaPreset() { seen.push("get"); },
      handleSetPersonaPreset() { seen.push("set"); },
    });

    handler(JSON.stringify({ type: "get_persona_preset" }));
    handler(JSON.stringify({ type: "set_persona_preset", presetId: "witty_warm" }));

    assert.deepEqual(seen, ["get", "set"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/server/session/persona_preset_session.test.ts"
```

Expected: FAIL because the handlers are not part of the router input yet

- [ ] **Step 3: Add the WS protocol and live session handlers**

Extend `attachSessionMessageHandlers()` input and switch:

```ts
  handleGetPersonaPreset: () => void;
  handleSetPersonaPreset: (data: any) => void;
```

```ts
case "get_persona_preset":
  input.handleGetPersonaPreset();
  break;
case "set_persona_preset":
  input.handleSetPersonaPreset(data);
  break;
```

In `server/session/index.ts`, add live handlers:

```ts
import {
  getUserPersonaPreset,
  saveUserPersonaPreset,
} from "../../storage/repositories/user_persona_preset_repository";
import { isPersonaPresetId } from "../../persona/presets";

const handleGetPersonaPreset = async () => {
  const presetId =
    (brain.userId && await getUserPersonaPreset(brain.userId)) ||
    brain.persona.profile.presetId;
  send(ws, { type: "persona_preset_state", presetId });
};

const handleSetPersonaPreset = async (data: any) => {
  const presetId = typeof data.presetId === "string" ? data.presetId.trim() : "";
  if (!isPersonaPresetId(presetId)) {
    send(ws, { type: "error", content: "未知 persona preset" });
    return;
  }
  brain.applyUserPersonaPreset(presetId);
  if (brain.userId) {
    await saveUserPersonaPreset(brain.userId, presetId);
  }
  send(ws, { type: "persona_preset_state", presetId });
};
```

In `web/src/hooks/useRemiChat.ts`, add:

```ts
const [personaPreset, setPersonaPreset] = useState("witty_warm");

case "persona_preset_state": {
  const presetId =
    typeof data.presetId === "string" && data.presetId.trim()
      ? data.presetId.trim()
      : "witty_warm";
  setPersonaPreset(presetId);
  break;
}
```

and expose:

```ts
const requestPersonaPreset = useCallback(() => {
  wsRef.current?.send(JSON.stringify({ type: "get_persona_preset" }));
}, []);

const updatePersonaPreset = useCallback((presetId: string) => {
  wsRef.current?.send(JSON.stringify({ type: "set_persona_preset", presetId }));
}, []);
```

- [ ] **Step 4: Run the targeted tests**

Run:

```bash
npm test -- --require ts-node/register/transpile-only "test/server/session/persona_preset_session.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/session/message_router.ts server/session/index.ts web/src/hooks/useRemiChat.ts test/server/session/persona_preset_session.test.ts
git commit -m "feat: add session protocol for user persona presets"
```

---

### Task 5: Expose the Preset Selector in Web UI

**Files:**
- Modify: `web/src/components/RemiAccountMenu.tsx`
- Modify: `web/src/components/RemiChatApp.tsx`
- Modify: `web/src/hooks/useRemiChat.ts`
- Modify: `web/test/remiAccountMenu.test.ts`
- Create: `web/test/personaPresetSelector.test.ts`

- [ ] **Step 1: Write the failing UI tests**

Add this case to `web/test/remiAccountMenu.test.ts`:

```ts
it("renders the persona preset selector and forwards changes", () => {
  let seen = "";
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const { RemiAccountMenu } = require("../src/components/RemiAccountMenu");

  const html = renderToStaticMarkup(
    React.createElement(RemiAccountMenu, {
      emotionLabel: "neutral",
      currentUserId: "user_001",
      isDefaultDevUser: false,
      wsTargetLabel: "ws://localhost",
      canSignOut: false,
      onSignOut: async () => {},
      personaPreset: "witty_warm",
      onPersonaPresetChange: (value: string) => {
        seen = value;
      },
    }),
  );

  assert.ok(html.includes("表达风格"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --prefix web -- --require ts-node/register "test/remiAccountMenu.test.ts"
```

Expected: FAIL because `personaPreset` props and selector UI do not exist yet

- [ ] **Step 3: Add the selector UI**

In `web/src/components/RemiAccountMenu.tsx`, extend props:

```ts
type RemiAccountMenuProps = {
  emotionLabel: string;
  currentUserId: string;
  isDefaultDevUser: boolean;
  wsTargetLabel: string;
  canSignOut: boolean;
  onSignOut: () => Promise<void>;
  personaPreset: string;
  onPersonaPresetChange: (presetId: string) => void;
};
```

Add a narrow selector block inside the open menu:

```tsx
<div className="border-b border-white/10 px-4 py-4">
  <p className="text-xs uppercase tracking-[0.22em] text-[var(--remi-dim)]">
    表达风格
  </p>
  <label className="mt-3 flex flex-col gap-2 text-sm text-[var(--foreground)]">
    <span className="text-[11px] text-[var(--remi-dim)]">
      只改变 Remi 的表达风格，不会重置关系或记忆
    </span>
    <select
      value={personaPreset}
      onChange={(event) => onPersonaPresetChange(event.target.value)}
      className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-3 text-sm text-[var(--foreground)]"
    >
      <option value="witty_warm">温柔机灵</option>
      <option value="relaxed_roast">松弛吐槽</option>
      <option value="playful_attached">活泼黏人</option>
      <option value="calm_healing">冷静治愈</option>
    </select>
  </label>
</div>
```

In `web/src/components/RemiChatApp.tsx`, thread `personaPreset` and `updatePersonaPreset` through to `RemiAccountMenu`.

- [ ] **Step 4: Run the targeted UI tests**

Run:

```bash
npm test --prefix web -- --require ts-node/register "test/remiAccountMenu.test.ts" "test/personaPresetSelector.test.ts"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/components/RemiAccountMenu.tsx web/src/components/RemiChatApp.tsx web/src/hooks/useRemiChat.ts web/test/remiAccountMenu.test.ts web/test/personaPresetSelector.test.ts
git commit -m "feat: expose remi persona preset selector in web"
```

---

### Task 6: Verification and Docs Update

**Files:**
- Modify: `TASKS.md`
- Optional modify if behavior wording changed: `CURRENT_FOCUS.md`

- [ ] **Step 1: Add the final regression coverage**

Run:

```bash
npm test -- --require ts-node/register/transpile-only \
  "test/persona/presets.test.ts" \
  "test/storage/user_persona_preset_repository.test.ts" \
  "test/brain/prompt_builder.test.ts" \
  "test/server/session/developer.test.ts" \
  "test/server/session/user_identity_bootstrap.test.ts" \
  "test/server/session/persona_preset_session.test.ts"
```

Expected: PASS

Run:

```bash
npm test --prefix web -- --require ts-node/register \
  "test/remiAccountMenu.test.ts" \
  "test/personaPresetSelector.test.ts"
```

Expected: PASS

- [ ] **Step 2: Typecheck both packages**

Run:

```bash
npm run typecheck
npm run build --prefix web
```

Expected: PASS

- [ ] **Step 3: Update task tracking**

Add a narrow note to `TASKS.md` under parallel work or current productization work:

```md
- [x] 用户可选人格预设 V1（表达层）
  - 已完成：用户可在 Web 选择 4 个表达风格预设
  - 已完成：选择结果按 user 持久化，reconnect 后继续生效
  - 已完成：关系、workingMemory、Memory V2 episodes 继续共享
  - 边界：仍不支持自由 prompt / 自定义人格规则
```

- [ ] **Step 4: Manual verification**

Check in a real browser session:

```text
1. 登录或进入同一用户会话
2. 打开账户菜单，确认能看到“表达风格”
3. 切到“松弛吐槽”，发送“你直接说，我这个想法是不是有点蠢”
4. 观察回复：更直接、更有松弛感，但不攻击
5. 刷新页面或断开重连，确认 preset 仍保持
6. 再问“刚刚我们在聊什么”，确认 continuity 没丢
```

Expected:

- preset persists
- reply style changes
- memory/relationship continuity remains intact

- [ ] **Step 5: Commit**

```bash
git add TASKS.md
git commit -m "docs: record remi persona preset v1 status"
```

---

## Self-Review

### Spec coverage

- User-facing preset selector: covered by Task 5
- Shared memory/relationship continuity: enforced by Tasks 2 and 3
- Structured preset schema: Task 1
- Persistent per-user choice: Task 2
- Session hydration: Task 3
- Narrow WS protocol for Web control: Task 4
- No free-form prompt authoring: preserved by the file map and prompt task boundaries

### Placeholder scan

- No `TBD`, `TODO`, or "implement later" placeholders remain
- Each task includes exact files, tests, commands, and concrete code snippets

### Type consistency

- Canonical user preset IDs:
  - `witty_warm`
  - `relaxed_roast`
  - `playful_attached`
  - `calm_healing`
- Canonical repository API:
  - `getUserPersonaPreset(userId)`
  - `saveUserPersonaPreset(userId, presetId)`
- Canonical session methods/messages:
  - `applyUserPersonaPreset(presetId)`
  - `get_persona_preset`
  - `set_persona_preset`
  - `persona_preset_state`
