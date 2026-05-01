# Remi World Project Goals

## Current Truth

Remi World is an independent Babylon.js prototype inside `world/`.

It is not connected to the main Remi session runtime, voice chain, Memory V2, or Remi NPC brain. The current build is a local first-person island slice: it can render a cozy island, move the player, place and remove small decoration objects, expand and remove empty shoreline land patches, save those local changes in browser localStorage, and show a small checklist for a short shoreline-shaping loop. It now has an optional local World bridge for client context, runtime snapshots, text send, avatar projection, and local WorldEvent normalization, but `world_event` is not sent to the backend by default.

Current maturity: demo usable / early V1 slice. It is still not a real sandbox, not a production game, and not a real Remi integration. The direction is worth continuing because the island now reads as a place and the first manual expansion/editing loop works, but the 3-5 minute repeatable experience is still prototype-grade.

## Product North Star

Build a small first-person living space where the user can return, decorate, and eventually be accompanied by Remi as a persistent NPC who can observe actions, remember shared history, and react naturally.

For the world project, the first milestone is not intelligence. The first milestone is place attachment: the island must feel like a coherent home space before Remi is connected to it.

## Hard Boundaries

- Keep `world/` independently runnable.
- Do not import `web/`, `server/session`, voice, memory, or Remi main-chain code.
- Do not connect Remi NPC, voice, real memory, or backend world-event ingestion until the island loop feels worth returning to and the server has a dedicated `world_event` route.
- Do not chase high-fidelity realism. The intended style is cozy low-poly / voxel-inspired, warm, readable, and lightweight.
- Do not build a full Minecraft clone in the MVP phase.

## Target Experience

On open, the user should immediately understand:

- this is a small island
- there is a warm cottage
- there is a garden and a path
- the player is in first person
- the bottom hotbar controls small decoration actions
- this space could later belong to the user and Remi

The first 3 minutes should support:

- enter and exit view control without getting stuck
- move around without obvious broken states
- select one of six hotbar actions
- place several details on valid ground
- remove the detail being aimed at
- remove an empty filled shoreline patch while keeping land connected
- refresh and see local placed details restored
- clear the local layout during development

## V1 Longer Execution Record

Status: implemented through a useful V1 slice on 2026-04-29, with real gaps called out below.

### Milestone 1: Scene Structure Completion

Status: implemented.

What changed:

- `prefabs/cottage.ts` owns the cottage mesh set.
- `prefabs/garden.ts` owns garden flowers, fence, sign, trees, and small garden details.
- `prefabs/waterfront.ts` owns water and shore decoration.
- `prefabs/background.ts` owns island base, distant silhouettes, and voxel clouds.
- `worldScene.ts` now focuses on scene bootstrap, camera/input, placement mutation, render loop, and module assembly.

Remaining structure debt:

- `worldScene.ts` is still about 650 lines because object mutation, land mutation, persistence callbacks, camera/input, and visual effect application still live there.
- Placement targeting, feedback copy, and preview mesh/update have been split out. The next structural split should be an object/land editing controller before adding more edit modes.

### Milestone 2: Island Art Pass 0.2

Status: implemented as a primitive art pass.

What changed:

- Cottage gained stronger roof layers, trim, door/window detail, warmer window hierarchy, chimney smoke, barrel/pot clutter, and entry details.
- Garden gained denser flower clusters, grass tufts, sign polish, and stronger fence rhythm.
- Waterfront gained clearer water/shore boundary, foam strips, stones, dock-like accents, and distant island silhouettes.
- Hotbar objects remain visually consistent with the primitive/voxel direction.

Real judgment:

- The first screen now reads as "small cozy island" within a few seconds.
- It is better than a raw procedural box demo, but it is still primitive art, not finished visual identity.
- Do not bring in GLB/asset packs yet; the spatial loop still needs more validation first.

### Milestone 3: Placement Loop 0.3

Status: implemented at prototype level.

What changed:

- Placement blocks water, cottage footprint, too-close-to-player, and overlap with existing placed objects.
- Invalid preview is more visible and the hint text uses island-tidy language instead of technical errors.
- Removal targets the placed object footprint near the current aim point instead of blindly removing the latest object.
- Placed objects now have ids and footprint radii.
- A local placed-object record shape exists for later save/load and future adapter work.

Remaining interaction debt:

- Removal is footprint targeting on the ground point, not true mesh/silhouette raycast.
- The player can still aim awkwardly near scenery; this is usable but not yet natural.
- Placement is still small-decoration only. No digging, inventory, crafting, or block sandbox.

### Milestone 4: Local Persistence 0.1

Status: implemented.

What changed:

- Placed objects save to `localStorage` under `remi-world:placed-objects:v1`.
- Refresh restores local placed objects.
- A small development clear button clears the local island layout.
- Bad or incompatible storage payloads are ignored instead of crashing the page.

Boundary:

- This is only browser-local persistence.
- It is not Remi memory, not account sync, not multi-device state, and not a server save.

### Milestone 5: First 3-Minute Experience Pass

Status: improved into a shoreline-shaping loop.

What changed:

- The initial view frames cottage, garden, path, light, water, and distant silhouettes.
- The quest card now gives three expansion-led goals: fill one shoreline patch, plant a flower on new land, and light the expanded edge.
- Browser smoke covers the expansion loop and local persistence path.

Real judgment:

- This is now more than a technical render demo.
- It is closer to a coherent 3-minute loop, but still not a durable 3-5 minute world. The biggest gap is now interaction depth: editing land is discrete and local-only, and object targeting is improved but not true mesh selection.
- Remi NPC should still wait. Connecting Remi now would hide the real bottleneck instead of solving it.

## Input Control Fix Record

Status: implemented on 2026-04-29.

What changed:

- Click-to-enter view control now requests browser Pointer Lock on the canvas.
- Esc / pointer-lock loss exits view control, clears held movement keys, and returns to the click-to-reenter state.
- Normal mousemove fallback remains best-effort if Pointer Lock is unavailable.

Why:

- The previous implementation hid the cursor but did not lock it. The pointer could still move to the browser/window edge, after which camera rotation stopped. Pointer Lock fixes the root cause by making mouse movement relative instead of bounded by screen position.

## Island Expansion MVP Record

Status: implemented on 2026-04-29 as a first shoreline-fill slice.

What changed:

- Hotbar gained a sixth `Land` slot.
- Selecting `Land` and aiming just beyond the shoreline fills a connected grass/earth patch.
- Fill rules are intentionally narrow: original island edge or existing filled land adjacency, maximum two rings outward, no isolated water patches, no filling under the player, and no duplicate land.
- Expanded land is stored separately from placed decoration objects under `remi-world:land-cells:v1`.
- Normal decoration placement can use expanded land as valid terrain.
- Player navigation logic can treat expanded land as walkable terrain.
- Local clear removes both placed objects and expanded land.

Real judgment:

- This validates the "I can make my island bigger by hand" loop at prototype level.
- It is not a full terrain editor: there is no digging, no land removal, no height editing, no inventory cost, and no terrain mesh merging.
- The visual style of filled land is still primitive. It works as a gameplay signal, not finished island art.

## Expansion Comfort Batch Record

Status: implemented on 2026-04-30 as the follow-up batch after the shoreline-fill 0.1 slice.

What changed:

- Navigation now has a wider cottage/eave comfort blocker, plus simple blockers for garden fence rails and both tree trunks.
- Walking from filled shoreline into adjacent water no longer snaps the player back to the original island edge; it holds the last filled-land position instead.
- `Land` selection now uses land-specific guidance instead of generic place-object copy.
- The land-fill preview is now a square patch preview, separate from the round decoration placement preview.
- Filled land cells gained primitive shore lips, small grass tufts, and occasional pebbles so they read less like raw cubes.

Real judgment:

- This is a meaningful improvement over 0.1 because it addresses the two most obvious prototype tells: collision discomfort and unclear expansion affordance.
- It is still not a terrain system. Filled land is still discrete cells, has no removal action, no height blending, no cost/inventory, and no mesh merging.
- The next bottleneck is no longer "can I expand the island at all"; it is "can I shape the island for a few minutes without the interaction feeling toy-like".

## Placement And Expansion Editing Batch Record

Status: implemented on 2026-04-30 as a batch after placement control 0.4 and expansion editing 0.2.

What changed:

- Object removal now uses a first-person crosshair ray in addition to object footprint radii, instead of relying only on the ground preview point.
- If an object is close to the old ground-preview target but not under the crosshair, feedback tells the player to put the crosshair on the detail itself.
- `Backspace` now removes the latest placed decoration as a local cleanup/undo shortcut, while `R` / right-click remain target-oriented.
- `Land` right-click / `R` can remove an empty filled shoreline patch.
- Land removal is intentionally constrained: occupied patches cannot be removed, and cells that support an outer patch cannot be removed until the outer patch is removed first.
- If `Land` removal is not aimed at a filled patch, it falls back to the latest empty removable patch so the action also works as a simple undo.
- Detail placement can auto-nudge to a nearby valid spot when the aimed spot is occupied, which makes the flower + lamp shoreline goal less brittle.
- The first-session goal loop now focuses on expanding one patch, planting it, and lighting the expanded edge.
- `worldObservationAdapter.ts` defines a pure local observation boundary for future Remi integration without importing `web/`, `server/session`, memory, voice, or Remi runtime code.
- `ART_STYLE_GUIDE.md` records the current primitive low-poly / voxel-inspired rules before introducing `.glb` or external assets.

Real judgment:

- This is the first point where the world has a small edit loop, not just a placement demo.
- It is still local single-player state and still lacks undo history, terrain costs, land height editing, and mesh-level selection.
- The Remi observation adapter is only a boundary object. It does not mean Remi can actually observe, remember, or talk about the world yet.

## Placement/Preview Structure Split Record

Status: implemented on 2026-04-30 as a structural follow-up after the first editing loop.

What changed:

- `worldPlacementFlow.ts` owns camera-based placement status, placed-object target extraction, and invalid placement/land feedback copy.
- `worldPlacementPreview.ts` owns placement preview meshes, land-vs-decoration preview mode, preview height, color, alpha, and pulse update.
- `worldScene.ts` now imports those helpers and keeps the actual scene state mutation in place.
- Added focused tests for placement feedback, target extraction, and preview height rules.

Real judgment:

- This reduces the risk of continuing to add behavior directly into `worldScene.ts`, but it is not a full controller split yet.
- The scene file still owns too many responsibilities for a mature game loop. It is acceptable for the current V1 prototype, but object placement/removal and land editing should be extracted before adding undo history, hover selection UI, or more terrain rules.
- No Remi/NPC/session/voice/memory integration was added.

## Visual Rescue v0.2 Record

Status: implemented on 2026-05-01 as a screenshot-oriented visual pass.

What changed:

- Added a shared scene palette at `src/world/art/remiworldPalette.ts`.
- Added a dusk lighting preset at `src/world/lighting/createEveningLighting.ts`.
- Added a hero camera preset at `src/world/camera/heroCameraPreset.ts`.
- Reworked scene materials to reduce fluorescent grass, pure-black roof reads, over-saturated flowers, and flat programmer-demo colors.
- Rebuilt flowers into small low-poly clusters instead of saturated ball flowers.
- Reduced grass density into readable clumps with more open ground.
- Rebuilt lanterns into wood-post, shade, warm-core, small-range light props instead of oversized white glow spheres.
- Muted and scaled trees so they support the cottage rather than compete with it.
- Added fog, ACES tone mapping, restrained bloom/glow, and shadow registration for cottage, trees, fences, and the Remi stand-in.
- Added a dev-only `Alt+Shift+I` Babylon Inspector toggle.
- Added `?heroShot=1` screenshot mode to hide HUD and placement preview without changing the normal interactive mode.

Real judgment:

- This is a real visual improvement over the previous demo look: the grass is no longer fluorescent, lantern/window light is warmer and less overexposed, and the composition now has a path, cottage, right-side Remi stand zone, muted sky, and more readable foreground/midground/background.
- It is still not reference-render quality. The current scene uses procedural primitives, not authored voxel props or a real Remi character model.
- The attempted stronger warm horizon plane produced visible backdrop artifacts and was removed. A better skybox or proper gradient shader is the right next step if the scene needs stronger sunset layering.
- No new gameplay, map, task, backpack, building, chat, voice, network, memory, or Remi NPC behavior was added.

## Evidence

Latest commands:

- `cd world && npm test` passed: 17 test files, 65 tests.
- `cd world && npm run build` passed.
- Build still emits the existing Vite/Babylon large chunk warning; it is not a runtime failure, but chunking should be revisited before productionizing.

Earlier batch commands:

- `cd world && npm test` passed: 12 test files, 51 tests.
- `cd world && npm run build` passed.
- Build still emits the existing Vite/Babylon large chunk warning; it is not a runtime failure, but chunking should be revisited before productionizing.

Browser smoke on `http://127.0.0.1:5178/`:

- first screen rendered with cottage, garden, path, lamps, water, and distant islands
- placed a lamp
- selected and placed a blue flower
- removed the aimed blue flower with `R`
- checklist reached all three completed states during the action run
- `localStorage` restored the remaining lamp after refresh
- clear button removed local layout and stayed cleared after refresh
- 30 second forward movement did not crash, but exposed the close-to-cottage collision gap
- console check: 0 errors / 0 warnings, excluding normal Babylon info logs
- Pointer Lock smoke: automated browser click verified `canvas.requestPointerLock()` is called and Esc returns the scene to inactive state. Native `document.pointerLockElement` can require manual browser confirmation because Playwright does not reliably expose real Pointer Lock state.
- Expansion smoke: selected `Land`, filled one shoreline patch, placed a blue flower on that expanded land, refreshed and restored both records, then cleared both local storage keys.
- Expansion comfort smoke: selected `Land`, confirmed land-specific guidance, filled one shoreline patch, placed a blue flower on the filled patch, moved briefly on/near the filled shoreline, refreshed and restored both land and object records, cleared both storage keys, and saw 0 console errors / 0 warnings.
- Placement/expansion editing smoke: filled one shoreline patch, planted a blue flower, auto-nudged a lamp onto the expanded edge, completed all three UI goals, blocked land removal while the patch was occupied, removed both placed decorations with `Backspace`, removed the empty land patch with `R`, refreshed with no local records left, cleared local storage, and saw 0 app console errors / 0 warnings.
- Placement/preview structure split smoke: first screen rendered, placed one lamp, removed it with `Backspace`, Esc paused view control, click re-entered view control, local storage updated correctly, and console check showed 0 app errors / 0 warnings. The full land-fill browser loop was not repeated in this smoke because automated mouse aiming to the shoreline is not stable enough; land/placement rules remained covered by tests and the earlier expansion smoke.
- Visual Rescue v0.2 smoke: opened `http://127.0.0.1:5180/?heroShot=1`, captured a clean 1280x720 hero-shot screenshot with HUD hidden, verified the sky sample is muted purple rather than white/gray (`[195, 175, 202]` range), and checked the scene visually for non-fluorescent grass, warm cottage windows, right-side Remi stand zone, and no visible horizon-plane artifact.

Screenshots:

- `/tmp/remi-world-v1-longer-first.png`
- `/tmp/remi-world-v1-longer-after-flower.png`
- `/tmp/remi-world-v1-longer-after-actions.png`
- `/tmp/remi-world-v1-longer-after-reload.png`
- `/tmp/remi-world-v1-longer-after-30s.png`
- `/tmp/remi-world-v1-longer-after-clear-reload.png`
- `/tmp/remi-world-expansion-after-land.png`
- `/tmp/remi-world-expansion-after-flower.png`
- `/tmp/remi-world-expansion-after-reload.png`
- `/tmp/remi-world-batch2-first.png`
- `/tmp/remi-world-batch2-after-land.png`
- `/tmp/remi-world-batch2-after-flower.png`
- `/tmp/remi-world-batch2-after-move.png`
- `/tmp/remi-world-batch2-after-reload.png`
- `/tmp/remi-world-batch2-after-clear.png`
- `/tmp/remi-world-final5-first.png`
- `/tmp/remi-world-final5-after-loop.png`
- `/tmp/remi-world-final5-after-remove-land.png`
- `/tmp/remi-world-structure-split-first.png`
- `/tmp/remi-world-structure-split-after-smoke.png`
- `.playwright-cli/page-2026-04-30T16-12-04-878Z.png`

## Execution Order

### Phase 0: Independent World Slice

Status: complete enough for current V1 work.

Goal: prove `world/` can run alone as a Babylon prototype.

Acceptance:

- `cd world && npm test` passes
- `cd world && npm run build` passes
- Vite runs on a local port without starting the main Remi app
- scene renders without console errors
- player can move, look, place, remove, save locally, and clear locally

### Phase 1: Island Feel MVP

Status: mostly met, with navigation debt.

Goal: make the island feel like a coherent place, not a primitive test scene.

Acceptance:

- open page and understand the space within 5 seconds: met
- move for 30 seconds without crash or control lock: met
- move for 30 seconds without awkward facade/eave proximity: not met
- place and remove multiple objects: met
- first screenshot reads as a small cozy island: met

### Phase 2: Art Pass 0.2

Status: met for primitive V1.

Goal: establish a reusable Remi World visual language while still using Babylon primitives.

Acceptance:

- scene no longer reads as only boxes and spheres: partly met
- cottage, path, garden, lamps, and water each have distinct visual roles: met
- no external asset dependency introduced: met

### Phase 3: Placement Loop 0.3

Status: met for small-decoration prototype.

Goal: make decoration actions feel intentional.

Acceptance:

- block water, cottage footprint, too-close, and overlap placement: met
- target removal by aim footprint: met
- persist a local registry-ready placed-object shape: met
- true mesh raycast / silhouette targeting: not met

### Phase 4: Local Persistence 0.1

Status: met.

Goal: make the island start feeling like "my local space".

Acceptance:

- placed objects survive refresh: met
- clear removes local layout: met
- bad stored data does not crash page: covered by tests
- account/server/Remi memory sync: intentionally not in scope

### Phase 5: First 3-Minute Experience Pass

Status: improved, still prototype-grade.

Goal: validate whether the world can support a short repeatable experience loop.

Acceptance:

- user can infer a short task from the UI: met for the expansion loop
- user can see the result of their decoration: met
- movement/collision supports comfortable exploration: partly met after navigation pass, still prototype-grade
- user can expand, plant, and light one patch: met
- enough value to start Remi NPC integration: not yet

### Phase 6: Island Expansion MVP

Status: met for shoreline-fill prototype plus follow-up editing pass.

Goal: let the user manually expand the island without turning the MVP into a full block sandbox.

Acceptance:

- hotbar exposes a clear land-fill action: met
- land can be filled from shore outward: met
- isolated water and too-far cells are rejected: met by tests
- filled land persists locally and restores after refresh: met
- ordinary decoration can be placed on filled land: met
- filled-land preview is visually distinct from decoration preview: met
- filled land no longer looks like only one raw grass cube: partly met
- empty filled-land removal with connectivity protection: met
- digging / height editing / terrain merge: intentionally not in scope

### Phase 7: Remi Runtime Bridge

Status: local World bridge connected; backend ingestion not connected.

Goal: prepare the boundary through which Remi can observe world actions without coupling World to Web, session, voice, or memory internals.

Current boundary:

- `worldObservationAdapter.ts` can turn local `WorldEvent` records into Remi-observable candidate objects.
- `world/src/remiWorldBridge.ts` uses a local lightweight runtime client for World `client_context`, connection/runtime state, `sendText`, avatar projection, and WorldEvent -> RemiWorldEvent conversion.
- World events are normalized locally but are not sent by default because the server still lacks a dedicated `world_event` route.
- This bridge is not wired to Remi memory, session internals, voice, NPC behavior, root app runtime SDK, or backend event acknowledgement yet.

### Phase 8: Remi NPC Prototype

Status: future.

Goal: introduce Remi as an embodied NPC only after the island loop has enough value.

Prerequisites:

- island feel is strong enough
- placement loop is usable
- event boundary is stable
- character asset requirements are defined: idle, blink, look-at, simple animation, lighting compatibility

## Asset Strategy

Short term: procedural Babylon primitives with a strict style guide.

Medium term: validate a small `.glb` pipeline using Blender, Blockbench,
MagicaVoxel, or AI-generated first-pass props after cleanup. See
[ASSET_PIPELINE.md](ASSET_PIPELINE.md).

Current style guide:

- See `ART_STYLE_GUIDE.md`.

Asset pipeline judgment:

- AI tools can generate useful first-pass props, but direct high-poly imports are not runtime-ready.
- The 2026-05-01 Meshy character test was roughly 641k triangles / 320k vertices, which is reference/sculpt density, not a browser-game NPC asset.
- Generate or author single props first: lantern, garden sign, flower cluster.
- Do not import a full generated island scene or a generated Remi character directly into runtime.

Avoid for now:

- large mixed-style asset packs
- realistic high-poly assets
- static AI-rendered backgrounds as core scene assets
- importing a full voxel engine before the design proves it needs one

## Parallel Work Rules

Parallel work is allowed when write sets do not overlap.

Good parallel splits:

- one task edits docs only
- one task edits one prefab module
- one task writes tests for placement/navigation logic

Do not parallelize:

- multiple agents editing `worldScene.ts`
- scene refactor and visual mesh edits in the same functions
- Remi integration while island MVP is still unstable

## Immediate Next Task Packages

1. Browser product check: verify whether the expansion loop feels understandable without explanation.
2. Object/land editing controller split: extract placement/removal mutation out of `worldScene.ts` before adding more edit modes.
3. Land editing 0.3: decide whether to add explicit undo history, land hover highlight, or selected-cell UI before adding more terrain rules.
4. Asset Pipeline Spike 0.1: load cleaned `.glb` versions of a lantern, garden sign, and flower cluster; verify scale, lighting, collision, build, and console health.
5. Remi NPC pre-design: only start after the world loop survives a product check.
