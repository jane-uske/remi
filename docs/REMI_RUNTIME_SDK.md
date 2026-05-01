# Remi Runtime SDK Boundary

## Current Stage

This is the first protocol-level slice for a future cross-device Remi SDK.
It is not a full product SDK yet, but Web and World now both use this boundary
for the parts listed below.

The current implementation lives in `runtime/` and only provides:

- platform-neutral runtime protocol types
- client capability normalization
- `client_context` payload construction
- a pure runtime-state reducer for Remi events
- WebSocket server-message translation into runtime events
- `RemiRuntimeClient` for WebSocket lifecycle, `client_context`, raw message mirroring, `sendText`, and runtime-state updates
- SDK protocol outlets for Web voice send/control events
- local playback start/end mirroring so avatar phase can settle after Web audio drains or fails to start
- platform-neutral avatar runtime projection through `selectRemiAvatarRuntimeModel()`
- an opt-in Web shadow runtime mirror for dev visibility
- a minimal RemiWorld bridge
- a `sendWorldEvent` transport outlet
- world-event acknowledgement state

## Ownership Boundary

### Remi Owns

- identity and session continuity
- text reply generation
- persona, tone, relationship, and memory
- turn-taking state
- STT / TTS / streamed audio
- lip-sync cues
- emotion
- high-level avatar intent
- deciding whether a world event affects the current turn or memory

### World / Platform Owns

- rendering engine: Babylon, three.js, native UI, watch UI, desktop UI
- camera, movement, collision, picking, and placement rules
- concrete NPC body execution
- local world state and scene persistence
- animation availability and blending
- device-specific audio capture/playback
- notification and background behavior

### Runtime Bridge Owns

- WebSocket connection lifecycle
- platform capability declaration
- Remi server-event normalization
- platform-neutral runtime state
- platform-neutral avatar model projection for `emotion`, `avatarIntent`, `avatarFrame`, `lipSync`, `phase`, and `phaseReason`
- `sendText`, voice protocol sends, local playback start/end phase updates, and `sendWorldEvent`
- preserving the boundary between world observations and Remi memory writes

## Capability Model

Each client declares what it can support:

- `textInput`
- `audioInput`
- `audioOutput`
- `streamingAudio`
- `avatar2d`
- `avatar3d`
- `lipSync`
- `worldEvents`
- `backgroundPresence`
- `notifications`

This lets the same Remi runtime serve Web, desktop, mobile, watch, and world clients without assuming identical experiences.

## Memory Rule

World events may include memory hints, but they are not memory writes.

The world can report:

- what happened
- where it happened
- which object was involved
- whether it seems emotionally meaningful

Only Remi core decides whether that event is used in the current turn, written to working memory, or promoted toward episode memory.

## First Non-Goals

- no React dependency
- no Babylon or three.js dependency
- no Web audio dependency
- no replacement of `useRemiChat` UI/message/playback/avatar execution state
- no direct Memory V2 writes from the world
- no direct import of `server/session`, `brains`, or `memory` from `world/`
- no attempt to make every device support the same presentation

## Web Shadow Integration

The first Web integration keeps existing UI/audio/history/avatar behavior in
place while routing WebSocket creation, `client_context`, `sendText`, and voice
protocol sends through `RemiRuntimeClient`.

Enable it with:

```bash
NEXT_PUBLIC_REMI_RUNTIME_SHADOW=1
```

`useRemiChat` creates a `RemiRuntimeClient` instead of constructing the browser
`WebSocket` directly. The SDK client owns the WebSocket transport, sends
`client_context`, exposes `sendText`, mirrors raw server messages back to the
Web hook, and keeps a platform-neutral `RemiRuntimeState`.

The Web voice path also uses SDK protocol outlets for:

- `startDuplex(sampleRate)`
- `stopDuplex()`
- `sendAudioFrame(frame)`
- `sendAudioStreamBase64(audio, sampleRate)` as the compatibility fallback
- `notifyPlaybackStart(generationId)`
- `notifyPlaybackEnd(generationId)`

Microphone capture, PCM encoding, playback queues, and lip-sync timeline
execution remain Web/platform responsibilities.
The SDK only records playback start/end as platform-neutral phase state so the
shared avatar model can settle back to idle after local audio playback drains.
If browser audio cannot actually start, the Web audio queue still reports the
generation end back to the SDK so the shared avatar model does not remain stuck
in `speaking`.

When `NEXT_PUBLIC_REMI_RUNTIME_SHADOW=1` is enabled, this runtime state is also
emitted to avatar devtools logs under `runtime shadow:*`.

It still does not drive:

- existing React UI state
- message append / history state
- playback queues
- lip-sync timeline execution
- default chat avatar rendering decisions
- server request behavior

## Avatar Runtime Projection

`runtime/avatar_model.ts` exposes `selectRemiAvatarRuntimeModel(state)`. This
selector is intentionally pure and renderer-free. It gives Web, World, and
future clients the same high-level avatar inputs:

- phase and phase reason
- turn state and turn reason
- current emotion
- latest avatar frame
- latest avatar intent
- accumulated lip-sync cues for the active generation

It does not sample audio, blend animations, write bones, choose cameras, or
decide model-specific expression names. Those remain platform responsibilities.

The `/vrm` Web validation page consumes this projection while still using the
Web audio queue for playback/envelope and `Remi3DAvatar` for actual VRM
execution.

## Browser Validation

As of 2026-05-01, `http://127.0.0.1:3001/vrm?avatarDevtools=1` has been checked
against the real WebSocket / LLM / TTS path. The SDK panel showed a live
`avatar_intent`, accumulated TTS lip-sync cues for the active generation, and
then returned to `idle / idle_ready` after local playback settled.

This validates the runtime data boundary. It does not mean the final VRM
performance quality is mature; model-specific animation blending, camera,
lighting, and expression tuning still belong to the Web or World renderer.

## World Bridge

`world/src/remiWorldBridge.ts` is the first RemiWorld SDK adapter. It declares a
World client context with `avatar3d`, `streamingAudio`, `lipSync`, and
`worldEvents` enabled, then reuses `RemiRuntimeClient` for connection and
runtime-state updates.

In `world/src/main.ts`, the bridge is optional:

```bash
VITE_REMI_WS_URL=ws://localhost:3001/ws npm run dev --prefix world
```

Without `VITE_REMI_WS_URL`, RemiWorld stays in local-only mode. With the URL,
the bridge connects and can mirror Remi runtime state.

The bridge also exposes `getAvatarRuntimeModel()`, which returns the shared SDK
avatar projection for the current runtime state. World can use this as the
input layer for NPC animation, while keeping Babylon-specific blending and
scene execution local to World.

World events are converted into `RemiWorldEvent` records, but they are not sent
to the current backend by default:

```bash
VITE_REMI_WORLD_EVENT_SEND=1
```

This flag exists because the current server router does not yet have a
dedicated `world_event` case. Sending it before that route exists would risk
treating a world observation as a normal chat input.

## Next Practical Step

The next backend slice is to add a dedicated `world_event` route that returns
`world_event_ack` without falling through to chat. After that, RemiWorld can
enable `VITE_REMI_WORLD_EVENT_SEND=1` for real browser testing.
