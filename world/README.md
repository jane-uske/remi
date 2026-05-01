# Remi World

This is an independent Babylon.js prototype for the Remi World direction.

The project direction, phase order, and acceptance criteria are tracked in
[PROJECT_GOALS.md](PROJECT_GOALS.md). The current primitive visual rules are in
[ART_STYLE_GUIDE.md](ART_STYLE_GUIDE.md), and the future `.glb` asset pipeline
boundary is in [ASSET_PIPELINE.md](ASSET_PIPELINE.md).

It intentionally does not import or start the main Remi app, backend session runtime, voice chain, or memory chain. The first island slice only validates:

- a fixed first-person island scene
- a warm voxel-style cottage, garden, path, lamps, water, distant island silhouettes, and a hero-shot Remi stand zone
- player movement and mouse/drag look
- object placement/removal
- a bottom hotbar with six MVP actions, including local land shaping
- local world-event text for placement/removal feedback
- optional local World bridge connection state when `VITE_REMI_WS_URL` is configured

## Run

```bash
cd world
npm install --install-strategy=nested
npm run dev
```

Open the local URL printed by Vite.

For the current visual-review composition, use the screenshot route:

```text
http://127.0.0.1:5173/?heroShot=1
```

`heroShot=1` hides the HUD, crosshair, hotbar, dev clear button, and placement
preview so the scene can be judged as a clean hero shot. It does not change the
normal interactive mode.

In dev builds, press `Alt+Shift+I` to show or hide the Babylon Inspector for
lighting, material, mesh, and performance debugging.

To let the prototype connect through the optional local World bridge:

```bash
VITE_REMI_WS_URL=ws://localhost:3001/ws npm run dev
```

World events are normalized locally but are not sent to the Remi backend by
default. Only enable this after the backend has a dedicated `world_event` route:

```bash
VITE_REMI_WS_URL=ws://localhost:3001/ws VITE_REMI_WORLD_EVENT_SEND=1 npm run dev
```

## Current Boundary

This is not yet a full RemiWorld integration. The prototype now has a local
`RemiWorldBridge` that mirrors a small runtime state for client context,
connection state, text send, avatar projection, and local WorldEvent to
RemiWorldEvent conversion.

The bridge still does not import backend session code, voice chain code, memory
code, or the root app runtime SDK. The next backend step is a real
`world_event` server route that can acknowledge events without treating them as
chat.

## Visual Rescue v0.2 Boundary

The current visual pass is intentionally a screenshot-quality rescue pass, not a
new gameplay slice. It adds:

- a shared RemiWorld palette in `src/world/art/remiworldPalette.ts`
- an evening lighting setup in `src/world/lighting/createEveningLighting.ts`
- a fixed hero camera preset in `src/world/camera/heroCameraPreset.ts`
- lower-saturation grass, flowers, trees, roof, wood, stone, water, and warm light materials
- smaller lantern geometry with local warm point lights instead of oversized white glow balls
- grass and flower clumps that leave readable open ground
- a simple Remi stand-in zone on the right side of the composition
- fog, ACES tone mapping, restrained bloom/glow, and shadows

Real judgment: this is better than the previous programmer-demo look, but it is
not reference-render quality. The biggest remaining visual gaps are a real Remi
character asset, authored voxel prefabs, a better sky shader/skybox, and manual
art-direction passes on object placement and silhouette.
