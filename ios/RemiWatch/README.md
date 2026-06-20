# RemiWatch (watchOS MVP)

A minimal **standalone** watchOS SwiftUI client for the Remi backend — the
watch counterpart to `ios/RemiChatLite`. The default experience is a **Blob
presence screen** (organic gradient companion + waveform); chat history is a
secondary sheet.

## Scope

- Standalone watch app (`WKWatchOnly`) — no iPhone companion required
- **Blob presence UI** (`RemiBlobScreen`): breathe/float/glow blob, gradient
  waveform, OLED black background; driven by `RemiPresencePhase` (idle /
  listening / speaking)
- WebSocket streaming chat (`chat_chunk` / `chat_end`), auto-reconnect + keep-alive
- Inline `<emotion>…</emotion>` markup stripped from bubbles (reuses
  `RemiEmotionTag` from the iOS client verbatim)
- **History restore**: `history_page` (replace/prepend) hydrated on connect, with
  a "Load earlier" affordance backed by `history_more` pagination — opened via
  toolbar bubble icon as `WatchChatSheet`
- **TTS playback**: Remi's `voice` MP3 segments queued + played sequentially via
  `AVAudioPlayer`, with a mute toggle and barge-in (new send cuts current speech)
- **Voice input**: WatchKit system dictation (`presentTextInputController`) on
  device; Simulator falls back to `TextFieldLink` when no `WKInterfaceController`
  is available (`WatchSpeechInput`)
- **Auth**: `Authorization: Bearer <clerk-session-token>` when a token is present
  (Keychain / env / Info.plist), `X-Remi-Mobile-Key` dev-key fallback, else
  unauthenticated for the gateway loopback bypass
- **Watch-face complication**: WidgetKit extension with animated mini gradient
  blob (`accessoryCircular`, `accessoryInline`, `accessoryRectangular`,
  `accessoryCorner`) — one tap from the face
- Connection + emotion + sign-in status

**Not yet** (future): WatchConnectivity token hand-off from iPhone,
interactive Clerk sign-in UI on-watch, full-duplex streaming voice input,
live emotion data in the complication (App Group).

## Layout

```
ios/RemiWatch/
├── gen_project.rb              # regenerates RemiWatch.xcodeproj (app + complication targets)
├── RemiWatch.xcodeproj         # generated (do not hand-edit; re-run gen_project.rb)
├── design/
│   └── Blob.dc.html            # Claude Design reference (Remi Watch · Blob)
├── RemiWatch/                  # the watch app target
│   ├── RemiWatchApp.swift      # @main App
│   ├── ContentView.swift       # Blob main screen + chat history sheet
│   ├── RemiBlobScreen.swift    # primary presence UI (blob + waveform + mic)
│   ├── RemiBlobView.swift      # animated gradient blob + rings
│   ├── RemiBlobShape.swift     # organic blob morph shape
│   ├── RemiBlobPalette.swift   # warm gradient palette (#FFB07E / #E07AC8 / #5B78E2)
│   ├── RemiWaveformView.swift  # gradient audio bars
│   ├── WatchSpeechInput.swift  # WatchKit dictation + Simulator TextFieldLink fallback
│   ├── WatchChatStore.swift    # WS transport + protocol + streaming + history + presence
│   ├── WatchVoicePlayer.swift  # sequential MP3 TTS playback (AVAudioPlayer)
│   ├── WatchAuth.swift         # Keychain-backed bearer-token store
│   ├── WatchConfig.swift       # WS URL + dev-key + env/plist resolution
│   ├── WatchModels.swift       # message model + wire-message parser (+ history/voice)
│   ├── RemiEmotionTag.swift    # copied from RemiChatLite (emotion-tag stripping)
│   ├── Info.plist              # WKWatchOnly + mic usage + dev ATS exception
│   └── Assets.xcassets         # AppIcon placeholder + AccentColor
└── RemiComplication/           # the WidgetKit complication extension target
    ├── RemiComplication.swift  # mini animated gradient blob widget
    └── Info.plist              # NSExtension widgetkit-extension
```

## Build & run (watch simulator)

```bash
cd ios/RemiWatch
ruby gen_project.rb           # only needed after adding/removing source files
                              # (requires: gem install --user-install xcodeproj)

DEVICE="Apple Watch Series 11 (46mm)"
xcodebuild -project RemiWatch.xcodeproj -scheme RemiWatch \
  -destination "platform=watchOS Simulator,name=$DEVICE" \
  -derivedDataPath build build

xcrun simctl boot "$DEVICE" 2>/dev/null; open -a Simulator
xcrun simctl install "$DEVICE" build/Build/Products/Debug-watchsimulator/RemiWatch.app
xcrun simctl launch "$DEVICE" run.remi.watch
```

The watch **simulator** shares the Mac's network, so the default
`ws://127.0.0.1:3000/ws` reaches a local gateway (`npm run dev` or the
local-prod Docker stack). The connection uses the gateway's loopback auth bypass
(`REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1`), so no token is needed for local dev.

On a **physical watch**, use your Mac's LAN IP — `127.0.0.1` points at the watch
itself, not your dev machine:

```bash
REMI_WATCH_WS_URL=ws://192.168.x.x:3001/ws
```

## Config overrides

Resolved per value as: process env → `Info.plist` → baked-in default.

| Key | Purpose | Default |
| --- | --- | --- |
| `REMI_WATCH_WS_URL` | Gateway WS URL | `ws://127.0.0.1:3000/ws` |
| `REMI_WATCH_MOBILE_DEV_KEY` | `X-Remi-Mobile-Key` for dev-key auth | unset |
| `REMI_WATCH_AUTH_TOKEN` | Clerk session token (or legacy JWT) sent as `Bearer` | unset |

## Auth

Connect-time precedence: **bearer token → dev-key → none** (logged as
`ws connect auth=…`). With no token the gateway's loopback bypass authenticates
local-dev connections; with a token, `Authorization: Bearer <token>` is sent and
the gateway verifies it (a bad token is rejected → reconnect, proving the header
is honored).

A standalone watchOS app cannot host Clerk's interactive sign-in UI the way iOS
does, so the Clerk **session token is supplied out-of-band** and cached in the
Keychain (`WatchAuth`). The production hand-off path is the paired iPhone's
`RemiChatLite` Clerk session pushed over WatchConnectivity (requires promoting
this to a companion target) or Clerk's watchOS SDK once adopted — either calls
`WatchAuth.store(token:)`. For dev, inject `REMI_WATCH_AUTH_TOKEN`.

## Complication

The `RemiComplication` WidgetKit extension is embedded in the app's `PlugIns`.
After installing, add it on the watch: long-press the face → **Edit** → a
complication slot → pick **Remi**. Tapping it launches the app. It's static in
the MVP (animated blob, no live emotion feed yet).

For the simulator, inject env via `SIMCTL_CHILD_<KEY>`, e.g.
`SIMCTL_CHILD_REMI_WATCH_WS_URL=wss://app-rem.remi.run/ws xcrun simctl launch …`.

## Dev self-test probe

`WatchChatStore` has an env-gated probe used to verify the full
connect → stream → strip → bubble path without a UI tap (it is **off** unless the
env var is set):

```bash
SIMCTL_CHILD_REMI_WATCH_AUTOSEND=1 \
SIMCTL_CHILD_REMI_WATCH_AUTOSEND_TEXT="Hi Remi from the watch." \
  xcrun simctl launch "$DEVICE" run.remi.watch

# read the finalized (stripped) bubble text from the unified log:
xcrun simctl spawn "$DEVICE" log show --last 30s \
  --predicate 'subsystem == "run.remi.watch"' | grep "bubble finalized"
```

## Notes

- Inner-test target, not production hardening. The `Info.plist` ATS exception is
  scoped to loopback (`NSAllowsLocalNetworking` + `127.0.0.1`/`localhost` insecure
  exceptions) so the MVP can hit a local `ws://` gateway while public hosts must
  use `wss://`. No blanket `NSAllowsArbitraryLoads`.
- The client connects with `tts_transport=buffered_voice` (see `WatchConfig`), so
  the gateway sends base64 `voice` (MP3) frames `WatchVoicePlayer` can play instead
  of `voice_pcm_chunk` streaming. The gateway also defaults `client=watch_lite` to
  buffered voice (`server/session/tts_transport.ts`).
- `RemiEmotionTag.swift` is duplicated from `RemiChatLite` rather than shared, to
  keep this a self-contained standalone project with no cross-target coupling. If
  the iOS copy changes, re-copy it here.
- `Speech` framework is **not** available on watchOS; voice input uses WatchKit
  dictation on device. The Simulator has no `WKInterfaceController`, so mic taps
  there open `TextFieldLink` instead.