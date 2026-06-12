# Remi Persona Presets Design

Date: 2026-04-19
Status: Draft approved in chat, written spec pending final user review

## 1. Conclusion

Remi should add a formal `persona preset` layer for end users, but the first version must stay within a narrow boundary:

- Users can choose from a small set of curated preset personalities.
- All presets still belong to the same Remi.
- Relationship continuity, Memory V2, working memory, and unresolved episodes remain shared.
- The preset only changes expression style, humor, directness, and lightweight proactive flavor.
- Free-form custom system prompts are out of scope for V1.

This is worth doing because the current system already has a partial persona prompt skeleton and internal preset mechanism, but it is still developer-facing and not productized. The opportunity is real. The risk is also real: if this becomes arbitrary prompt stuffing, it will weaken continuity and worsen prompt instability without producing a meaningful user-facing gain.

## 2. Problem

Current Remi has a base personality and some relational stance logic, but it does not yet provide a user-facing way to choose how that personality expresses itself.

The current state is:

- Concept exists: yes
- Internal prompt structure exists: yes
- Developer preset switching exists: yes
- User-facing personality selection exists: no
- Stable, evaluated multi-style personality system exists: no

The user problem is not just "make replies funnier." The actual need is:

- Remi should feel more like a fixed person with a recognizable style.
- Remi should support a few clearly different expression styles.
- Some styles should be more humorous or playful.
- This must not break the north star of "the same Remi continuously existing across turns and devices."

## 3. Product Decision

### 3.1 What V1 is

V1 is a user-facing preset selector for Remi's expression style.

It is not a character marketplace, not persona branching, and not a full editable prompt builder.

### 3.2 What V1 is not

V1 does not:

- create multiple memory identities
- split relationship state per preset
- let users write arbitrary system prompts
- rewrite Memory V2 retrieval or episode ownership
- turn Remi into radically different fictional characters

### 3.3 Identity rule

The chosen rule is:

`Same Remi, shared relationship, shared memory, different expression style.`

This rule is mandatory for V1. If preset switching creates the feeling that the user is now talking to a different entity, the design has failed.

## 4. User Experience

### 4.1 V1 preset list

Start with 4 curated presets:

1. `温柔机灵`
2. `松弛吐槽`
3. `活泼黏人`
4. `冷静治愈`

These names are user-facing. Internal IDs can be English.

### 4.2 Intended style differences

#### 温柔机灵

- Baseline Remi variant
- Warm, stable, catches context well
- Has light wit and light humor
- Should feel safest as the default

#### 松弛吐槽

- More banter
- More casual and opinionated
- Can lightly call out bad ideas
- Must never become hostile, mocking, or "internet snark machine"

#### 活泼黏人

- More playful
- More emotionally bright
- Slightly higher initiative in follow-up phrasing
- Can tease lightly, but should still respect the same relationship boundary logic

#### 冷静治愈

- Lower humor density
- More grounded and calming
- More stable, slightly slower-feeling verbal rhythm
- Still not flat or therapist-like

### 4.3 UX behavior

- User selects a preset from a normal product surface, not the developer panel.
- Preset change applies to future replies immediately.
- Existing relationship state and memory are preserved.
- Chat history is not cleared.
- The UI copy must explicitly frame this as changing "Remi's expression style" rather than switching to a different person.

Recommended explanatory copy:

`你切换的是 Remi 的表达风格，不是换了一个新的 Remi。`

## 5. Technical Design

### 5.1 Existing relevant system pieces

Current code already contains useful building blocks:

- `persona/index.ts`
- `brain/prompt_builder.ts`
- `brain/personality.ts`
- `brain/character_rules.ts`
- `brains/dev_presets.ts`
- developer-only preset application flow in `server/session/developer.ts`

This means V1 should be an extraction and productization task, not a fresh architecture rewrite.

### 5.2 New core abstraction

Introduce a formal preset schema that is short, structured, and composable.

Suggested shape:

```ts
type PersonaStylePreset = {
  id: "witty_warm" | "relaxed_roast" | "playful_attached" | "calm_healing";
  label: string;
  summary: string;
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
```

The important design constraint is that presets must be stored as structured knobs, not long prose paragraphs. Prompt prose should be generated from the structure, not authored directly per preset.

### 5.3 Prompt integration

The preset should affect only the expression layer of the prompt stack.

It may influence:

- `persona.profile`
- generated style guidance inside `buildPersonaPrompt()`
- default `tone contract` bias
- limited `relationalStance` expression bias

It must not directly rewrite:

- prompt memory retrieval rules
- episode recall ranking
- working memory logic
- relationship stage derivation
- unresolved episode planner logic

### 5.4 Prompt shape

Add a short new block in persona prompt assembly, for example:

`【表达风格】`

This block should be small and behavior-oriented. Example behavior guidance:

- humor usage frequency
- whether light banter is allowed
- how direct to be when disagreeing
- how bright or grounded default phrasing should feel

Do not allow this block to balloon into a second system prompt.

### 5.5 Persistence

Preset choice should be user-scoped persistent state, not session-only developer state.

Suggested storage principle:

- one active preset per user
- applied across reconnect and future sessions
- no branching of memory tables or relationship payloads

Implementation detail can be chosen later, but the contract is fixed:

- preset selection persists
- relationship continuity remains shared

## 6. Data and State Boundaries

### 6.1 Shared state

The following stay shared across presets:

- messages
- relationship state
- working memory
- Memory V2 episodes
- unresolved/resolved lifecycle
- proactive planner continuity inputs

### 6.2 Preset-owned state

Preset-owned state is limited to:

- active preset id
- optional future lightweight user preference overrides tied to expression style

### 6.3 Explicit non-goal

No per-preset memory namespace.

If the user switches from `温柔机灵` to `松弛吐槽`, Remi should still remember the same unresolved topics, relational stage, and current context.

## 7. Architecture Changes

### 7.1 Backend

Backend needs:

- formal preset registry
- validated preset IDs
- user-level preset load/save path
- persona construction that reads the saved preset

The existing developer preset path can remain for testing, but it should stop being the only way to switch personality.

### 7.2 Frontend

Frontend needs:

- a user-facing selector surface
- active preset display
- optimistic or confirmed update flow
- clear copy that explains continuity is preserved

This should not live only in `PresetControlPanel`, because that panel is explicitly developer-oriented and mixed with destructive reset actions.

### 7.3 Evaluation surface

Add fixtures for:

- humor tone drift
- assistanty regression
- over-teasing or hostile banter
- continuity preservation after preset switch

This matters because the main failure mode here is not "crash." It is style collapse or identity fragmentation.

## 8. Rollout Strategy

### 8.1 Phase 1

Internal enablement:

- formalize preset schema
- wire prompt generation
- keep existing dev controls working
- add tests and eval fixtures

### 8.2 Phase 2

User-facing selection:

- expose preset picker in Web
- persist per-user choice
- verify reconnect continuity

### 8.3 Phase 3

Observation:

- collect real conversations
- inspect whether presets are actually distinguishable
- check whether humorous presets increase delight without increasing annoyance

Do not move to custom prompt authoring from Phase 3 by default. That requires a separate product decision.

## 9. Risks and Tradeoffs

### 9.1 Main value

This can improve two user-perceived outcomes:

- Remi feels less generic
- Remi feels more like a recognizable person

### 9.2 Main risks

#### Risk 1: Fake progress

If the implementation is only "more adjectives in the prompt," the user will barely feel the difference. This would be busy work, not product progress.

#### Risk 2: Continuity damage

If presets are too strong, switching styles may feel like switching identities. That would directly weaken the north star.

#### Risk 3: Prompt bloat

If each preset adds long prose, system prompt size grows while latency gains stay flat or worsen.

#### Risk 4: Humor overshoot

If "funny" becomes "always joking," Remi becomes tiring and less trustworthy in emotional contexts.

### 9.3 Tradeoff choice

V1 deliberately trades flexibility for stability:

- fewer presets
- no free-form authoring
- structured preset knobs
- shared continuity

This is the right tradeoff for the current stage.

## 10. Testing and Acceptance

### 10.1 Functional acceptance

V1 is acceptable only if all of the following are true:

- users can select one of the curated presets
- the choice persists across reconnect/session restart
- memory and relationship continuity remain shared
- prompt assembly reflects the selected preset
- switching presets does not clear or fork history

### 10.2 Experience acceptance

Each preset must produce observable differences in:

- humor density
- phrasing rhythm
- directness
- initiative flavor

But all presets must still feel recognizably like Remi.

### 10.3 Regression checks

Need targeted checks for:

- assistanty regression
- excessive banter under emotional user input
- rude or sharp outputs in `松弛吐槽`
- over-cute or clingy outputs in `活泼黏人`
- flatness in `冷静治愈`

### 10.4 Post-V1 extension: LLM-first short-term style intent

After the preset V1 expression layer landed, a second narrow control layer was added for short-term style steering.

This layer is intentionally smaller than presets:

- Presets are the user's stable default expression preference.
- `styleIntent` is a temporary "for the next few turns, talk more like this" signal.

Current implementation rules:

- `turn_interpreter` is the primary path for detecting requests such as:
  - be more interesting or witty
  - be less assistant-like
  - sound more like a familiar person
  - allow light teasing
  - be slightly more romantic / more able to flirt
  - temporarily imitate a speaking/doing style
- A high-confidence `styleIntent` writes a short-lived session `styleOverride`.
- Explicit regex detection remains only as fallback for direct set/clear phrases.
- `styleOverride` is temporary and decays over a small turn window.
- Slow brain stores weak `responseStyleNotes` as candidate hints across sessions.
- Those weak notes must never auto-restore into a live `styleOverride`.
- Explicit clear phrases such as "恢复正常 / 正常跟我说 / 不用演了" clear both the current override and the weak notes.

Why this matters:

- It improves immediacy: the user can steer tone in natural language without changing presets.
- It preserves continuity better than free-form system prompts because it stays bounded and temporary.
- It is still not equivalent to "Remi now reliably feels witty/romantic in all scenes." It only improves control surface and routing.

## 11. Non-Goals After V1

The following are explicitly deferred:

- user-authored custom persona rules
- marketplace/community personas
- per-preset memory lanes
- extreme roleplay-style personas
- platform-specific persona variants

If later explored, they must be evaluated as separate projects, not smuggled into this V1.

## 12. Recommendation

Proceed with a narrow V1:

- 4 curated presets
- shared memory/relationship continuity
- structured preset schema
- small prompt overlay
- user-facing preset picker

Do not pursue free-form custom system prompts now.

That direction is tempting, but at the current project stage it would increase complexity faster than it increases "Remi feels real."
