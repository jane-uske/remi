# Phase 2 Runtime Page Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove remaining page-level role-state interpretation from the default web shell so `ChatWindow`, `VoiceIndicator`, and hero/companion copy consume the same runtime-derived outputs.

**Architecture:** Keep `CanonicalAvatarState` and `AvatarRenderModel` as the only truth-bearing layers. Add a thin set of page-facing selectors/view models in `remiRuntimeSelectors.ts`, then have `RemiChatApp` compose those selector outputs into child props. Do not rewrite `useRemiChat`, do not touch 3D, and keep compatibility fallbacks where a full cutover is not worth Phase 2 scope.

**Tech Stack:** React 19, Next.js App Router, TypeScript, existing Mocha + ts-node web tests.

---

## File map

- Modify: `web/src/runtime/remiRuntimeSelectors.ts`
  Purpose: add page-facing selector outputs for chat status, voice indicator, and shared companion copy.
- Modify: `web/src/components/RemiChatApp.tsx`
  Purpose: stop passing raw role-state booleans/turn-state semantics into page components where selectors can provide view models.
- Modify: `web/src/components/ChatWindow.tsx`
  Purpose: consume a unified status model instead of interpreting `turnState` / `thinkingHint` / `listeningHint`.
- Modify: `web/src/components/VoiceIndicator.tsx`
  Purpose: consume a voice indicator view model instead of only a raw `active` boolean.
- Create: `web/test/runtime/remiRuntimeSelectors.test.ts`
  Purpose: lock Phase 2 selector semantics before UI wiring.
- Create: `web/test/chatWindow.test.ts`
  Purpose: verify the status pill and `aria-busy` follow selector outputs instead of raw turn-state logic.
- Create: `web/test/voiceIndicator.test.ts`
  Purpose: verify indicator label/active state come from the unified selector model.
- Optional modify: `web/test/remiChatApp.test.ts`
  Purpose: only if wiring complexity needs a shallow composition check. Skip if existing tests plus selector tests already cover the contract.

## Scope guard

- In scope:
  - `ChatWindow` status pill
  - `VoiceIndicator`
  - hero/companion copy usage
  - page-level logic still stitching `waiting` / `voiceActive` / `recording` / `turnState` / `userSpeaking`
- Out of scope:
  - `useRemiChat` rewrite
  - 3D runtime / renderer work
  - cross-platform runtime unification
  - visual redesign
  - new Phase 3 runtime or protocol work

## Task 1: Add page-facing runtime selectors

**Files:**
- Modify: `web/src/runtime/remiRuntimeSelectors.ts`
- Test: `web/test/runtime/remiRuntimeSelectors.test.ts`

- [ ] **Step 1: Write the failing selector tests**

```ts
const assert = require("node:assert/strict");
const {
  selectChatWindowStatus,
  selectVoiceIndicatorModel,
  getRuntimeCompanionLine,
} = require("../../src/runtime/remiRuntimeSelectors");

describe("remiRuntimeSelectors", () => {
  it("maps listening runtime state into a listening chat status pill", () => {
    const model = selectChatWindowStatus(makeRuntimeState({
      phase: "listening",
      phaseReason: "user_voice",
      turn: { serverState: "listening_active" },
    }), { streamingText: "" });

    assert.equal(model.badgeLabel, "听着");
    assert.equal(model.responseBusy, false);
  });

  it("maps thinking/runtime response states into a response-busy chat status", () => {
    const model = selectChatWindowStatus(makeRuntimeState({
      phase: "thinking",
      phaseReason: "awaiting_model",
      turn: { serverState: "confirmed_end" },
    }), { streamingText: "" });

    assert.equal(model.badgeLabel, "准备回复");
    assert.equal(model.responseBusy, true);
  });

  it("maps speaking runtime state into an active voice indicator", () => {
    const model = selectVoiceIndicatorModel(makeRuntimeState({
      phase: "speaking",
      phaseReason: "assistant_audio_active",
      assistant: { playbackActive: true, playbackTailActive: false },
    }));

    assert.equal(model.active, true);
    assert.equal(model.label, "speaking");
  });
});
```

- [ ] **Step 2: Run the selector tests and confirm they fail for missing exports**

Run:
`cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/remiRuntimeSelectors.test.ts`

Expected:
- failure for `selectChatWindowStatus` / `selectVoiceIndicatorModel` not existing yet

- [ ] **Step 3: Implement the minimal selectors**

```ts
export type ChatWindowStatusModel = {
  badgeLabel: string | null;
  responseBusy: boolean;
};

export type VoiceIndicatorModel = {
  active: boolean;
  label: string;
};

export function selectChatWindowStatus(
  state: CanonicalAvatarState,
  input: { streamingText: string },
): ChatWindowStatusModel {
  // derive pill label from runtime phase/phaseReason/turn.serverState
  // derive responseBusy from runtime phase, not page-level booleans
}

export function selectVoiceIndicatorModel(
  state: CanonicalAvatarState,
): VoiceIndicatorModel {
  // active for speaking + playback tail only
  // label stays "speaking" for active, "voice" otherwise
}
```

- [ ] **Step 4: Re-run selector tests**

Run:
`cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/remiRuntimeSelectors.test.ts`

Expected:
- `3 passing`

## Task 2: Wire `RemiChatApp` to selector outputs

**Files:**
- Modify: `web/src/components/RemiChatApp.tsx`
- Modify: `web/src/components/ChatWindow.tsx`
- Modify: `web/src/components/VoiceIndicator.tsx`

- [ ] **Step 1: Add failing component tests for the new contracts**

```ts
describe("ChatWindow", () => {
  it("renders the supplied status pill instead of deriving one from turn state", () => {
    // render ChatWindow with a status model prop
    // assert the supplied badge label is visible
  });
});

describe("VoiceIndicator", () => {
  it("renders the supplied label and active state from the selector model", () => {
    // render VoiceIndicator with { active: true, label: "speaking" }
    // assert label and data-active
  });
});
```

- [ ] **Step 2: Run those tests and confirm they fail on old props**

Run:
- `cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/chatWindow.test.ts`
- `cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/voiceIndicator.test.ts`

Expected:
- prop/type failures or missing model fields

- [ ] **Step 3: Update `RemiChatApp` to compose selector outputs**

```ts
const chatWindowStatus = selectChatWindowStatus(runtimeState, {
  streamingText,
});
const voiceIndicator = selectVoiceIndicatorModel(runtimeState);

<VoiceIndicator model={voiceIndicator} />
<ChatWindow
  ...
  statusModel={chatWindowStatus}
/>
```

Notes:
- Keep `heroPrompt = avatarRenderModel.companionLine`; it is already Phase 1-compliant.
- Do not reintroduce raw `waiting` / `turnState` decision logic into `RemiChatApp`.

- [ ] **Step 4: Update `ChatWindow` to consume a status model**

```ts
export type ChatWindowProps = {
  ...
  statusModel: ChatWindowStatusModel;
  // TODO(Phase 2 cleanup): delete legacy listeningHint/thinkingHint/turnState props if no longer needed.
};

const statusLabel = statusModel.badgeLabel;
const responseBusy = statusModel.responseBusy;
```

Notes:
- `streamStatus` local state for `aria-live` can remain if it is only detecting stream edge transitions.
- Remove internal `getTurnStateLabel()` once the selector fully owns the badge.

- [ ] **Step 5: Update `VoiceIndicator` to consume a selector model**

```ts
export type VoiceIndicatorProps = {
  model: VoiceIndicatorModel;
};

data-active={model.active ? "true" : "false"}
{model.label}
```

- [ ] **Step 6: Re-run the component tests**

Run:
- `cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/chatWindow.test.ts`
- `cd /Users/rare/Desktop/remi-ai/web && TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/voiceIndicator.test.ts`

Expected:
- both pass

## Task 3: Prune page-level raw-state interpretation

**Files:**
- Modify: `web/src/components/RemiChatApp.tsx`
- Modify: `web/src/components/ChatWindow.tsx`

- [ ] **Step 1: Remove direct page-level status interpretation that selectors now own**

Checklist:
- `ChatWindow` no longer decides badge text from raw `turnState`
- `ChatWindow` no longer decides `aria-busy` from stitched booleans/turn states
- `VoiceIndicator` no longer decides its label from a raw boolean
- `RemiChatApp` hero copy still reads `avatarRenderModel.companionLine`

- [ ] **Step 2: Keep the smallest compatibility layer only where needed**

```ts
// TODO(Phase 2 cleanup): once callsites are migrated, remove legacy props.
```

Use TODOs only if a full prop deletion would create unnecessary churn in this phase.

## Task 4: Verification and diff review

**Files:**
- Test: `web/test/runtime/remiRuntimeSelectors.test.ts`
- Test: `web/test/chatWindow.test.ts`
- Test: `web/test/voiceIndicator.test.ts`
- Existing regression: `web/test/runtime/remiRuntimeAdapter.test.ts`
- Existing regression: `web/test/runtime/avatarRenderModel.test.ts`
- Existing regression: `web/test/portraitState.test.ts`
- Existing regression: `web/test/remiPortraitAvatar.test.ts`
- Existing regression: `web/test/useRemChat.turnState.test.ts`

- [ ] **Step 1: Run targeted tests**

Run:
```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register \
  test/runtime/remiRuntimeSelectors.test.ts \
  test/chatWindow.test.ts \
  test/voiceIndicator.test.ts \
  test/runtime/remiRuntimeAdapter.test.ts \
  test/runtime/avatarRenderModel.test.ts \
  test/portraitState.test.ts \
  test/remiPortraitAvatar.test.ts \
  test/useRemChat.turnState.test.ts
```

Expected:
- selector and page tests pass
- Phase 1 runtime tests still pass

- [ ] **Step 2: Run web typecheck/build verification**

Run:
```bash
cd /Users/rare/Desktop/remi-ai
./node_modules/.bin/tsc -p web/tsconfig.json --noEmit
rm -rf web/.next && npm run build --prefix web
```

Expected:
- typecheck passes
- Next build passes
- existing unrelated lint warnings may still appear; do not expand scope unless this phase introduces new warnings/errors

- [ ] **Step 3: Review diff against the Phase 2 done criteria**

Checklist:
- `ChatWindow` status pill reads a selector/model, not raw turn-state logic
- `VoiceIndicator` reads a selector/model, not raw boolean interpretation
- hero/companion copy still comes from the unified runtime/render model path
- page-level raw state stitching is materially reduced
- no 3D or runtime-core expansion slipped in

---

## Self-review

- Spec coverage:
  - `ChatWindow` status strip: covered in Task 1 + Task 2
  - `VoiceIndicator`: covered in Task 1 + Task 2
  - hero/companion copy: preserved and explicitly checked in Task 3
  - avoid `useRemiChat` rewrite / no 3D / no cross-end expansion: enforced in scope guard
- Placeholder scan:
  - no `TBD` / `implement later`
  - one TODO is intentionally scoped to legacy prop cleanup only
- Type consistency:
  - `ChatWindowStatusModel` and `VoiceIndicatorModel` are introduced once in selectors and then consumed by components/tests

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-19-phase-2-runtime-page-convergence.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks
2. Inline Execution - Execute tasks in this session using executing-plans

Which approach?
