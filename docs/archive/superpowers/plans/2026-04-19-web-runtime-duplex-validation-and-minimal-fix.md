# Web Runtime / Duplex Validation And Minimal Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate whether the current Web default chain actually holds together in real runtime/duplex use, then fix only the smallest verified state-alignment bugs without reopening architecture work.

**Architecture:** Treat this as a runtime validation pass, not a refactor. Use the existing `CanonicalAvatarState -> AvatarRenderModel -> selectors -> portrait/status/voice indicator` chain as the truth path, compare it against real browser/devtools/log evidence, and only patch the narrowest layer that is demonstrably wrong: selector first, adapter second, portrait display model third. If no worthwhile mismatch is found, stop with evidence and make no code changes.

**Tech Stack:** Next.js web app, React, TypeScript, mocha + ts-node tests, structured live logs, browser manual duplex validation

---

## Scope And Constraints

- This plan is **Web default chain only**.
- This plan is **validation-first**.
- Do **not**:
  - rewrite `web/src/hooks/useRemiChat.ts`
  - touch 3D runtime or VRM code
  - do cross-end unification
  - add new UI
  - continue compatibility cleanup
  - do broad architecture cleanup
- Synthetic soak is only regression evidence. It does **not** count as real browser duplex acceptance.

## Current Evidence Baseline

- `CURRENT_FOCUS.md` explicitly says the project is in **Memory V2 observation + frontend spot-check**, not “continue frontend cleanup”.
- `npm run duplex:data-entry` currently reports:
  - `status: synthetic_ready_browser_pending`
  - live browser log candidates under `artifacts/live/dev_server_*.log`
- Current Web runtime truth chain already exists in:
  - `web/src/runtime/remiRuntimeAdapter.ts`
  - `web/src/runtime/avatarRenderModel.ts`
  - `web/src/runtime/remiRuntimeSelectors.ts`
  - `web/src/components/RemiPortraitAvatar.tsx`
  - `web/src/components/ChatWindow.tsx`
  - `web/src/components/VoiceIndicator.tsx`
  - `web/src/components/AvatarDevtoolsPanel.tsx`
  - `web/src/lib/rem3d/devtoolsStore.ts`

## File Map

### Validation-only reads

- Read: `docs/DUPLEX_DATA_ANALYSIS_ENTRY.md`
- Read: `web/src/hooks/useRemiChat.ts`
- Read: `web/src/runtime/remiRuntimeAdapter.ts`
- Read: `web/src/runtime/avatarRenderModel.ts`
- Read: `web/src/runtime/remiRuntimeSelectors.ts`
- Read: `web/src/components/RemiChatApp.tsx`
- Read: `web/src/components/ChatWindow.tsx`
- Read: `web/src/components/VoiceIndicator.tsx`
- Read: `web/src/components/RemiPortraitAvatar.tsx`
- Read: `web/src/lib/rem3d/devtoolsStore.ts`
- Read: `web/src/components/AvatarDevtoolsPanel.tsx`

### Conditional code-touch surface

- Modify only if a real mismatch is observed:
  - `web/src/runtime/remiRuntimeSelectors.ts`
  - `web/src/runtime/remiRuntimeAdapter.ts`
  - `web/src/runtime/avatarRenderModel.ts`
  - `web/src/lib/portrait/portraitState.ts`
  - `web/src/components/RemiPortraitAvatar.tsx`
  - `web/src/lib/rem3d/devtoolsStore.ts`
  - `web/src/components/AvatarDevtoolsPanel.tsx`
- Avoid modifying:
  - `web/src/hooks/useRemiChat.ts`
  - `web/src/components/RemiChatApp.tsx`
  - page-level boolean assembly
  - 3D files

### Conditional test files

- `web/test/runtime/remiRuntimeAdapter.test.ts`
- `web/test/runtime/remiRuntimeSelectors.test.ts`
- `web/test/runtime/avatarRenderModel.test.ts`
- `web/test/portraitState.test.ts`
- `web/test/remiPortraitAvatar.test.ts`
- `web/test/chatWindow.test.ts`
- `web/test/voiceIndicator.test.ts`
- `web/test/rem3d/devtoolsStore.test.ts`

## Runtime Source -> UI Surface Map

| Concern | Truth source | UI / debug surface |
|---|---|---|
| phase / phaseReason | `adaptRemiRuntimeState()` | `AvatarDevtoolsPanel`, portrait `runtimeState.phase`, selectors |
| playback active / tail | `runtimeState.assistant.playbackActive` / `playbackTailActive` | voice indicator, devtools snapshot, portrait mouth behavior |
| user speech / hold / open mic idle | `runtimeState.user.*` + `turn.serverState` | status pill, portrait label/copy, devtools |
| assistant text-only fallback | `runtimeState.phase=thinking` + `phaseReason=assistant_text_streaming` | status pill, hero prompt, portrait, devtools |
| reconnect | `connectionPhase -> runtimeState.connection` | header connection badge, devtools, runtime phase |
| portrait visible behavior | `avatarRenderModel` + `buildPortraitDisplayModel()` + `liveLip` mouth overlay | `RemiPortraitAvatar` |
| inspector evidence | `publishAvatarRuntimeSnapshot()` + runtime logs in `useRemiChat.ts` | `AvatarDevtoolsPanel`, `devtoolsStore` |

## Validation Scenarios And Expected Behavior

Use these six scenarios only.

| Scenario | Runtime truth expectation | Status pill | Voice indicator | Portrait expectation | Highest-risk mismatch point |
|---|---|---|---|---|---|
| user keeps talking with 0.5-1s pause | `listening/user_voice -> listening/user_hold -> listening/user_voice` or `thinking/awaiting_model` only after true commit | `听着 -> 还在听 -> 听着` | off | listening presence, no speaking jump | adapter hold/commit timing |
| assistant speaking -> tail -> end | `speaking/assistant_audio_active -> speaking/assistant_audio_tail -> idle or listening/open_mic_idle` | likely none during active, no stuck busy after end | active during active, validate tail behavior explicitly | speaking then settle, mouth can tail briefly but should not get stuck | selector currently ignores `playbackTailActive`; validate if visual drop is too early |
| user interrupts assistant | `speaking -> reacting/user_interrupt -> listening/user_voice` | `被打断`, then `听着` | should stop quickly | portrait yields floor, then listening | reacting hold window / selector lag |
| text-only fallback | `thinking/assistant_text_streaming`, no fake speaking | `准备回复` or `准备回应` depending turn state | off | thinking/downcast, no speaking label | adapter text-only transition timing |
| reconnect / network reset | `idle/connecting` or `idle/disconnected`, no stale speaking/playback | no stale response busy badge | off | not speaking, no stale mouth/speaking label | stale tail/playback carryover |
| duplex=true open mic idle | `listening/open_mic_idle` | `还在听` | off | listening presence, no fake thinking | selectors vs portrait copy mismatch |

---

### Task 1: Establish The Validation Baseline

**Files:**
- Read: `docs/DUPLEX_DATA_ANALYSIS_ENTRY.md`
- Read: `CURRENT_FOCUS.md`
- Read: `web/src/hooks/useRemiChat.ts`
- Read: `web/src/runtime/remiRuntimeAdapter.ts`
- Read: `web/src/runtime/remiRuntimeSelectors.ts`
- Read: `web/src/components/RemiPortraitAvatar.tsx`
- Read: `web/src/components/ChatWindow.tsx`
- Read: `web/src/components/VoiceIndicator.tsx`
- Read: `web/src/components/AvatarDevtoolsPanel.tsx`
- Read: `web/src/lib/rem3d/devtoolsStore.ts`

- [ ] **Step 1: Confirm the duplex entrypoint and live log candidates**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
npm run duplex:data-entry
ls -lt artifacts/live/dev_server_*.log | head -n 5
```

Expected:
- `duplex:data-entry` reports `synthetic_ready_browser_pending`
- at least one `artifacts/live/dev_server_*.log` exists

- [ ] **Step 2: Capture the current state source map before touching code**

Read the files above and write down, in the working notes for the session, these exact mappings:
- `runtimeState.phase/phaseReason` source
- `ChatWindow` badge source
- `VoiceIndicator` active source
- portrait phase/render input source
- devtools snapshot/log source

Expected result:
- one clear source of truth per surface, with any multi-source exceptions explicitly noted

- [ ] **Step 3: Note likely risk points before runtime validation**

Record these already-visible code risks:
- `selectVoiceIndicatorModel()` currently keys off `assistant.playbackActive` only
- `ChatWindow` only surfaces a subset of assistant states as badge labels
- portrait mouth can continue through `liveLip` overlay after state changes
- reconnect relies on adapter resets rather than component cleanup

Expected result:
- a short pre-validation hypothesis list, not yet a bug list

---

### Task 2: Run Real Browser Validation For The Six Scenarios

**Files:**
- Use runtime surfaces only; no edits yet

- [ ] **Step 1: Open the Web app with runtime inspector enabled**

Open the default Web shell at:

```text
http://localhost:3001/?remDevtools=1
```

If the local app is not already running, start it with the project’s standard local app flow before proceeding.

Expected:
- default Web chain loads
- `AvatarDevtoolsPanel` is visible
- portrait, ChatWindow, VoiceIndicator, and status bar are all present

- [ ] **Step 2: Identify the current live log file**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
LATEST_LOG=$(ls -t artifacts/live/dev_server_*.log | head -n 1)
echo "$LATEST_LOG"
tail -n 20 "$LATEST_LOG"
```

Expected:
- `LATEST_LOG` points to the most recent live log
- log is recent enough to use for this validation pass

- [ ] **Step 3: Validate scenario 1 — user continuous speech with short pause**

Manual action:
- speak a single thought with a 0.5-1 second pause in the middle, then continue

Collect:
- devtools runtime log entries
- current snapshot fields: `runtimePhase`, `runtimePhaseReason`, `turnState`, `userSpeaking`, `userRecording`, `mouthLevel`
- visible ChatWindow badge
- VoiceIndicator state
- portrait presence label / behavior

Then grep the log:

```bash
cd /Users/rare/Desktop/remi-ai
rg -n "\\[Latency\\]|\\[TurnTaking\\]|\\[TurnState\\]|\\[TurnTiming\\]" "$LATEST_LOG" | tail -n 80
```

Expected:
- no early jump to `thinking/awaiting_model` during a short intra-turn pause
- no temporary speaking indicator for the assistant

- [ ] **Step 4: Validate scenario 2 — assistant speaking -> tail -> end**

Manual action:
- send or speak a prompt that reliably triggers an audible answer
- watch the transition from first audio through playback end

Collect the same evidence as Step 3.

Expected:
- runtime goes `assistant_audio_active -> assistant_audio_tail -> idle|open_mic_idle`
- VoiceIndicator behavior during tail is explicitly observed and written down
- no stuck speaking/tail after playback drain finishes

- [ ] **Step 5: Validate scenario 3 — user interrupts assistant**

Manual action:
- trigger assistant speech
- interrupt mid-utterance with user speech

Collect the same evidence as Step 3.

Expected:
- runtime enters `reacting/user_interrupt` briefly, then returns to `listening/user_voice`
- playback stops quickly
- no stale speaking badge/indicator remains

- [ ] **Step 6: Validate scenario 4 — text-only fallback**

Manual action:
- force or reproduce a no-audio answer path if available in the current environment
- otherwise reproduce a condition where text streams before audio can start

Collect the same evidence as Step 3.

Expected:
- runtime is `thinking/assistant_text_streaming`
- VoiceIndicator stays off
- portrait stays thinking, not speaking

- [ ] **Step 7: Validate scenario 5 — reconnect / network reset**

Manual action:
- trigger a temporary connection drop or browser-side network interruption, then allow reconnect

Collect:
- header connection badge
- runtime snapshot/log entries
- whether status pill or portrait remains stuck in a prior speaking/thinking state

Expected:
- runtime resets to `idle/connecting` or `idle/disconnected`
- no stale playback state survives reconnect

- [ ] **Step 8: Validate scenario 6 — duplex=true open mic idle**

Manual action:
- enter duplex mode
- stop speaking while keeping the mic open

Collect the same evidence as Step 3.

Expected:
- runtime is `listening/open_mic_idle`
- status pill is `还在听`
- VoiceIndicator stays off
- portrait reads as listening/idle-presence, not thinking or speaking

---

### Task 3: Turn Validation Evidence Into A Bug List

**Files:**
- No edits yet unless a mismatch is confirmed

- [ ] **Step 1: Classify each scenario as pass, partial, or fail**

For each of the six scenarios, answer:
- runtime truth observed
- expected truth
- UI surface agreement or disagreement
- likely mismatch layer: adapter / selector / render-model / portrait overlay / devtools only

Expected:
- a table of six scenarios with explicit pass/fail status

- [ ] **Step 2: Only keep bugs that affect real user-visible alignment**

Do **not** promote issues that are purely cosmetic or speculative.

Keep only:
- stuck state
- early/late release that changes user-visible behavior
- portrait/status/voice indicator disagreement that lasts long enough to be noticeable
- reconnect stale state

Discard:
- “code feels awkward”
- “we could make copy nicer”
- minor devtools-only nits with no runtime ambiguity

- [ ] **Step 3: Limit the fix scope**

If there are issues, keep only the top 1-2 by user-visible impact.

Repair preference order:
1. `remiRuntimeSelectors.ts`
2. `remiRuntimeAdapter.ts`
3. `avatarRenderModel.ts` or `portraitState.ts`
4. `RemiPortraitAvatar.tsx`
5. `devtoolsStore.ts` / `AvatarDevtoolsPanel.tsx`

Do not fix the same symptom in multiple layers.

---

### Task 4: Apply Only The Smallest Verified Fix

**Files:**
- Modify only the narrowest layer that owns the bug
- Modify matching tests first

- [ ] **Step 1: Write a failing test in the owning layer**

Pick the test file that matches the observed bug:

- selector bug:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/remiRuntimeSelectors.test.ts
```

Possible selector test shape:

```ts
it("keeps the voice indicator active through speaking tail", () => {
  const model = selectVoiceIndicatorModel(
    makeRuntimeState({
      phase: "speaking",
      phaseReason: "assistant_audio_tail",
      assistant: {
        waiting: false,
        streaming: false,
        playbackActive: false,
        playbackTailActive: true,
        textOnly: false,
      },
    }),
  );

  assert.deepEqual(model, {
    active: true,
    label: "speaking",
  });
});
```

- adapter bug:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/remiRuntimeAdapter.test.ts
```

Possible adapter test shape:

```ts
it("drops stale speaking state immediately on reconnect", () => {
  const prev = adaptRemiRuntimeState(makeInput({
    turnState: "assistant_speaking",
    turnReason: "playback_start",
    voiceActive: true,
  }));

  const next = adaptRemiRuntimeState(makeInput({
    connection: "connecting",
    turnState: "assistant_speaking",
    turnReason: "playback_start",
    voiceActive: true,
  }), prev);

  assert.equal(next.phase, "idle");
  assert.equal(next.phaseReason, "connecting");
  assert.equal(next.assistant.playbackActive, false);
});
```

- portrait/display bug:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/portraitState.test.ts
TS_NODE_PROJECT=tsconfig.test.json TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx","module":"commonjs"}' ../node_modules/.bin/mocha --require ts-node/register/transpile-only --require tsconfig-paths/register test/remiPortraitAvatar.test.ts
```

Possible portrait test shape:

```ts
it("does not let live mouth motion change the portrait phase label", () => {
  const display = buildPortraitDisplayModel({
    renderModel: {
      emotion: "neutral",
      phase: "thinking",
      phaseReason: "assistant_text_streaming",
      presenceLabel: "思考中",
      companionLine: "让我想一下，我马上接上。",
      mouthOpen: 0,
      blink: 0.16,
      smile: 0.08,
      gazeX: -1,
      gazeY: 4,
      headYaw: 0,
      headPitch: 0.12,
      breath: 0.82,
      posture: { translateX: 4, translateY: 5, scale: 0.985, rotateDeg: -1 },
    },
  });

  assert.equal(display.presenceLabel, "思考中");
  assert.equal(display.presenceState, "thinking");
});
```

Expected:
- exactly one newly-added test fails for the observed bug

- [ ] **Step 2: Implement the smallest code change that makes the test pass**

Rules:
- change only one ownership layer for each bug
- avoid adding new page-level boolean stitching
- avoid touching `useRemiChat.ts` unless the bug is impossible to solve elsewhere

Possible minimal selector fix shape:

```ts
export function selectVoiceIndicatorModel(
  state: CanonicalAvatarState,
): VoiceIndicatorModel {
  const active =
    state.assistant.playbackActive || state.assistant.playbackTailActive;

  return {
    active,
    label: active ? "speaking" : "voice",
  };
}
```

Expected:
- fix is local, understandable, and directly tied to the failing test

- [ ] **Step 3: Re-run the targeted test and confirm green**

Run only the affected test file(s) first.

Expected:
- failing test now passes

- [ ] **Step 4: Stop once the user-visible mismatch is fixed**

Do not chain a second cleanup unless it is the same bug and still user-visible.

If no meaningful bug was found in Task 3:
- skip Task 4 entirely
- keep the code unchanged

---

### Task 5: Verification And Final Review

**Files:**
- Verify only touched files and relevant test surface

- [ ] **Step 1: Run the focused runtime test suite**

Run:

```bash
cd /Users/rare/Desktop/remi-ai/web
TS_NODE_PROJECT=tsconfig.test.json ../node_modules/.bin/mocha --require ts-node/register --require tsconfig-paths/register test/runtime/remiRuntimeAdapter.test.ts test/runtime/remiRuntimeSelectors.test.ts test/runtime/avatarRenderModel.test.ts test/portraitState.test.ts test/rem3d/devtoolsStore.test.ts
TS_NODE_PROJECT=tsconfig.test.json TS_NODE_COMPILER_OPTIONS='{"jsx":"react-jsx","module":"commonjs"}' ../node_modules/.bin/mocha --require ts-node/register/transpile-only --require tsconfig-paths/register test/remiPortraitAvatar.test.ts test/chatWindow.test.ts test/voiceIndicator.test.ts
```

Expected:
- all targeted runtime/portrait/status/devtools tests pass

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
./node_modules/.bin/tsc -p web/tsconfig.json --noEmit
```

Expected:
- pass with no new type errors

- [ ] **Step 3: Confirm there was no scope creep**

Run:

```bash
cd /Users/rare/Desktop/remi-ai
git status --short -- web/src/runtime web/src/components web/src/lib/portrait web/src/lib/rem3d web/test
```

Expected:
- only the expected validation/fix files are touched
- no 3D, cross-end, or `useRemiChat` rewrite occurred

- [ ] **Step 4: Produce the acceptance conclusion**

Final report must answer, for each scenario:
- expected state flow
- actual checked behavior
- whether there was a mismatch
- whether it was fixed or intentionally left alone

And end with one of two conclusions:
- `Web 默认链路这轮足够稳定，可以先停前端收口，回到主线程`
- `仍有 1-2 个明显 runtime 错位，建议先修完再停`

No third vague option.

---

## Success Criteria

- At least one real browser/runtime validation pass is completed.
- All six requested scenarios are checked against runtime truth and UI behavior.
- Any fix is minimal and ownership-correct.
- If no worthwhile issue is found, the work ends with evidence and **no code changes**.
- No architecture expansion occurs.

## What This Plan Explicitly Does Not Do

- no new runtime architecture work
- no cleanup-only refactor
- no 3D work
- no cross-end work
- no new product UI
- no broad `useRemiChat` surgery

## Self-Review

- Spec coverage: includes scenario matrix, source mapping, real-browser validation, issue triage, minimal-fix boundary, targeted tests, and explicit “no code if no issue” path.
- Placeholder scan: no `TBD`, no “implement later”, no unbounded refactor language.
- Scope check: focused on Web default runtime validation only; no spill into broader frontend or memory work.

