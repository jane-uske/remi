# Portrait Runtime Compatibility Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce how much the default 2D portrait still interprets state on its own, while keeping the current fallback path and preserving present-day motion and mouth feel.

**Architecture:** Keep `RemiPortraitAvatar` as a render sink. Push the remaining fallback interpretation into a thinner compatibility adapter in `portraitState.ts`, and make the component render from one normalized portrait view model instead of mixing `renderModel` and raw fallback values branch-by-branch. Preserve `liveLip` as a bounded mouth overlay only; do not let it become a second phase/state source.

**Tech Stack:** React, TypeScript, Next.js app router, mocha + ts-node tests

---

## File Map

- Modify: `web/src/components/RemiPortraitAvatar.tsx`
  - Current issue: still computes gaze, eye scale, motion, breath, copy, and presence label locally by choosing between `renderModel` and `portraitState`.
  - Target role: SVG renderer plus `liveLip` mouth overlay.
- Modify: `web/src/lib/portrait/portraitState.ts`
  - Current issue: compatibility derivation still owns presence/gaze/mouth/emphasis, and the component also re-derives some presentational values on top.
  - Target role: fallback-only compatibility adapter that can output a normalized portrait render input when `renderModel` is absent.
- Modify: `web/test/remiPortraitAvatar.test.ts`
  - Add render-path tests proving runtime input wins and fallback still renders.
- Modify: `web/test/portraitState.test.ts`
  - Add tests proving compatibility output does not override runtime truth and still preserves old fallback behavior.

## Current Boundary To Preserve

- Keep:
  - legacy raw props on `RemiPortraitAvatar`
  - `derivePortraitState()` fallback behavior for callers that still do not provide `renderModel`
  - `liveLip` loop as a mouth-shape smoothing overlay
- Do not do:
  - `useRemiChat` refactor
  - new UI or new renderer features
  - 3D or cross-end work
  - product copy redesign

## Design Decision

Recommended approach: create one normalized portrait display object and make `RemiPortraitAvatar` render from that object only.

- Why this is the right scope:
  - It removes duplicated interpretation without deleting safety rails.
  - It keeps the fallback path intact when `renderModel` is missing.
  - It does not require changing runtime truth, selectors, or 3D code.
- What stays local in the component:
  - SVG geometry
  - theme lookup
  - eyebrow and mouth path rendering
  - `liveLip` polling and bounded mouth overlay
- What should move out of the component:
  - `renderModel ? X : fallbackY` branching for presence label, companion line, gaze, eye scale, posture/motion, and breath

---

### Task 1: Lock The Current Portrait Contract With Tests

**Files:**
- Modify: `web/test/remiPortraitAvatar.test.ts`
- Modify: `web/test/portraitState.test.ts`

- [ ] **Step 1: Add a failing portrait render-path test for runtime precedence**

Add a test in `web/test/remiPortraitAvatar.test.ts` that renders `RemiPortraitAvatar` with intentionally conflicting raw props and runtime props, then asserts the rendered text and phase markers come from runtime/render-model input.

Expected assertions:
- presence label matches `renderModel.presenceLabel`
- companion line matches `renderModel.companionLine`
- emotion label matches `renderModel.emotion`
- markup does not expose fallback-derived listening/speaking copy

- [ ] **Step 2: Add a failing fallback test for legacy compatibility**

Add a test in `web/test/remiPortraitAvatar.test.ts` that omits `renderModel` and `runtimeState`, passes legacy raw props, and asserts the portrait still renders the old fallback state correctly for at least one listening case and one speaking/thinking case.

Expected assertions:
- fallback listening renders `"在听"` and listening copy
- fallback speaking or thinking renders the old label/copy path

- [ ] **Step 3: Add a failing compatibility-adapter test**

Add a test in `web/test/portraitState.test.ts` that proves when `renderModel` exists, compatibility output uses runtime-driven values and does not let raw `turnState` or `voiceActive` override them.

Also add one fallback-only test proving the compatibility adapter still derives a sensible listening/thinking/speaking state when `renderModel` is absent.

- [ ] **Step 4: Run the targeted tests and confirm they fail for the missing boundary**

Run:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx","module":"commonjs"}' ../node_modules/.bin/mocha --require ts-node/register/transpile-only --require tsconfig-paths/register test/remiPortraitAvatar.test.ts
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/portraitState.test.ts
```

Expected:
- at least one new assertion fails because the component still mixes renderer logic and compatibility logic

---

### Task 2: Thin `portraitState.ts` Into A Compatibility Adapter

**Files:**
- Modify: `web/src/lib/portrait/portraitState.ts`
- Test: `web/test/portraitState.test.ts`

- [ ] **Step 1: Introduce a normalized portrait display shape**

Add a new exported type in `web/src/lib/portrait/portraitState.ts` that represents what the portrait renderer needs after interpretation is complete.

Recommended shape:

```ts
export type PortraitDisplayModel = {
  emotion: Emotion;
  presenceState: PortraitPresenceState;
  presenceLabel: string;
  companionLine: string;
  mouthLevel: number;
  gaze: { x: number; y: number };
  eyeScale: number;
  breathOffset: number;
  motion: string;
};
```

This is deliberately small and renderer-facing. It is not a new runtime truth type.

- [ ] **Step 2: Keep `derivePortraitState()` for legacy callers**

Do not delete `derivePortraitState()`. Keep it returning the current fallback `PortraitState`, because old callers and tests still depend on it.

Add a comment near the export:

```ts
// TODO(phase-3): remove once all portrait callers pass runtime render input.
```

- [ ] **Step 3: Add a new compatibility builder that prefers runtime input**

Add a new exported function in `portraitState.ts`, for example:

```ts
export function buildPortraitDisplayModel(
  input: DerivePortraitStateInput,
): PortraitDisplayModel
```

Rules:
- if `renderModel` exists, build the display model from it first
- only use fallback `derivePortraitState()` when `renderModel` is absent
- do not let raw `turnState`, `busy`, `voiceActive`, or `userSpeaking` override runtime-driven labels/gaze/posture when `renderModel` exists
- when using runtime input, map:
  - `renderModel.gazeX/Y` -> `gaze`
  - `renderModel.blink` -> `eyeScale`
  - `renderModel.breath` -> `breathOffset`
  - `renderModel.posture` -> `motion`
  - `renderModel.presenceLabel` / `companionLine` directly
- when using fallback input, preserve current local mappings for gaze, eye scale, breath, motion, label, and copy

- [ ] **Step 4: Keep live lip out of state interpretation**

Ensure the new adapter does not infer phase or presence from live lip. `liveLip` should remain a render-time mouth overlay in the component, not part of compatibility state truth.

- [ ] **Step 5: Run the portrait-state tests**

Run:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/portraitState.test.ts
```

Expected:
- all `portraitState` tests pass

---

### Task 3: Make `RemiPortraitAvatar` Render From One Input Path

**Files:**
- Modify: `web/src/components/RemiPortraitAvatar.tsx`
- Test: `web/test/remiPortraitAvatar.test.ts`

- [ ] **Step 1: Replace branch-by-branch state picking with one display model**

Inside `RemiPortraitAvatar`, replace the current pattern:

```ts
const portraitState = derivePortraitState(...)
const gaze = renderModel ? ... : ...
const eyeScale = renderModel ? ... : ...
const motion = renderModel ? ... : ...
const companionLine = renderModel ? ... : ...
```

with:

```ts
const portraitDisplay = useMemo(
  () => buildPortraitDisplayModel({ ... }),
  [...deps],
)
```

Then render from `portraitDisplay` for:
- `effectiveEmotion`
- `gaze`
- `eyeScale`
- `motion`
- `companionLine`
- `presenceLabel`
- `breathOffset`

- [ ] **Step 2: Keep mouth feel but narrow the override**

Preserve the current high-frequency lip behavior, but only as:

```ts
const mouthLevel = clamp01(
  Math.max(portraitDisplay.mouthLevel, liveLip.active ? liveLip.envelope * 0.92 : 0),
)
```

Do not let `liveLip` decide `presenceLabel`, `presenceState`, `gaze`, or `motion`.

- [ ] **Step 3: Remove local presentational fallback helpers that are no longer needed**

Delete or stop using the helpers/constants that become redundant after the adapter exists:
- `PRESENCE_LABELS`
- `GAZE`
- `BREATH`
- `eyeScaleFor()`
- `bodyTransform()`
- `stageCopy()`

Keep only helpers that still belong to rendering:
- `clamp01()`
- `eyebrowPath()`
- `mouthPath()`
- `motionFromRenderModel()` only if still needed inside the adapter; otherwise move or remove it

- [ ] **Step 4: Leave legacy props in place with an explicit TODO**

Do not remove:
- `turnState`
- `avatarIntent`
- `avatarFrame`
- `voiceActive`
- `busy`
- `userSpeaking`
- `recording`

Add a concise TODO near the props type or compatibility call:

```ts
// TODO(phase-3): drop legacy portrait props after all callers provide runtimeState/renderModel.
```

Reason:
- the current app still relies on a safe fallback path when runtime input is absent or regresses

- [ ] **Step 5: Run the portrait component tests**

Run:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx","module":"commonjs"}' ../node_modules/.bin/mocha --require ts-node/register/transpile-only --require tsconfig-paths/register test/remiPortraitAvatar.test.ts
```

Expected:
- runtime render-model precedence test passes
- fallback compatibility test passes

---

### Task 4: Final Verification For This Narrow Change

**Files:**
- Verify only the portrait chain and tests above

- [ ] **Step 1: Run the targeted portrait/runtime test set**

Run:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/avatarRenderModel.test.ts test/portraitState.test.ts
TS_NODE_PROJECT=tsconfig.test.json TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx","module":"commonjs"}' ../node_modules/.bin/mocha --require ts-node/register/transpile-only --require tsconfig-paths/register test/remiPortraitAvatar.test.ts
```

Expected:
- portrait compatibility still works
- runtime-driven inputs still render correctly

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
./node_modules/.bin/tsc -p web/tsconfig.json --noEmit
```

Expected:
- pass with no new errors

- [ ] **Step 3: Sanity-check for scope creep**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
git diff -- web/src/components/RemiPortraitAvatar.tsx web/src/lib/portrait/portraitState.ts web/test/remiPortraitAvatar.test.ts web/test/portraitState.test.ts
```

Expected:
- only portrait-chain files changed
- no accidental edits in `useRemiChat`, 3D, or cross-end code

---

## Success Criteria

- `RemiPortraitAvatar` renders from one normalized portrait display input instead of interpreting state in multiple places.
- Runtime truth wins whenever `renderModel` exists.
- Fallback remains intact when runtime input is absent.
- `liveLip` only smooths mouth motion and does not become a second state source.
- No range expansion into `useRemiChat`, 3D, cross-end, or product copy redesign.

## Risks And Guardrails

- Main risk: removing too much local fallback can change mouth/body feel.
  - Guardrail: keep `liveLip` overlay and keep fallback builder in `portraitState.ts`.
- Main risk: `renderModel` path and fallback path drift apart semantically.
  - Guardrail: tests must cover both runtime precedence and raw fallback.
- Main risk: accidental deletion of legacy props before fallback can be trusted.
  - Guardrail: keep props, add TODO, and defer deletion to a later phase.

## What This Plan Explicitly Does Not Do

- does not remove the fallback path
- does not change `useRemiChat`
- does not touch 3D
- does not change the product copy system beyond moving existing portrait copy selection out of the component
- does not attempt a Phase 3 runtime/renderer abstraction

## Self-Review

- Spec coverage: the plan covers audit, distinction between fallback vs migratable logic, portrait-only implementation, TODO-marked retained compatibility, targeted tests, and explicit scope limits.
- Placeholder scan: no `TBD` or “implement later” placeholders remain.
- Scope check: this is one narrow portrait-chain change, not a broader runtime refactor.

