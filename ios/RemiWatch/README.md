# RemiWatch (watchOS MVP)

A minimal **standalone** watchOS SwiftUI chat client for the Remi backend — the
watch counterpart to `ios/RemiChatLite`. First-version MVP: connect, send a
message, stream Remi's reply.

## Scope (MVP)

- Standalone watch app (`WKWatchOnly`) — no iPhone companion required
- WebSocket streaming chat (`chat_chunk` / `chat_end`), auto-reconnect + keep-alive
- Inline `<emotion>…</emotion>` markup stripped from bubbles (reuses
  `RemiEmotionTag` from the iOS client verbatim)
- Text input via the watch dictation/scribble keyboard, plus quick-reply chips
- Connection + emotion status dot

**Not yet** (future): auth beyond loopback-bypass / dev-key, voice / TTS, history
restore, Clerk sign-in, complications.

## Layout

```
ios/RemiWatch/
├── gen_project.rb              # regenerates RemiWatch.xcodeproj from the sources
├── RemiWatch.xcodeproj         # generated (do not hand-edit; re-run gen_project.rb)
└── RemiWatch/
    ├── RemiWatchApp.swift      # @main App
    ├── ContentView.swift       # SwiftUI chat UI
    ├── WatchChatStore.swift    # WS transport + protocol + streaming buffer
    ├── WatchConfig.swift       # WS URL + optional dev-key resolution
    ├── WatchModels.swift       # message model + wire-message parser
    ├── RemiEmotionTag.swift    # copied from RemiChatLite (emotion-tag stripping)
    ├── Info.plist              # WKWatchOnly + dev ATS exception (ws:// allowed)
    └── Assets.xcassets         # AppIcon placeholder + AccentColor
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

## Config overrides

Resolved per value as: process env → `Info.plist` → baked-in default.

| Key | Purpose | Default |
| --- | --- | --- |
| `REMI_WATCH_WS_URL` | Gateway WS URL | `ws://127.0.0.1:3000/ws` |
| `REMI_WATCH_MOBILE_DEV_KEY` | `X-Remi-Mobile-Key` for dev-key auth | unset |

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

- Inner-test target, not production hardening. The `Info.plist` ATS exception
  (`NSAllowsArbitraryLoads`) exists only so the MVP can hit a local `ws://`
  gateway; tighten before any release.
- `RemiEmotionTag.swift` is duplicated from `RemiChatLite` rather than shared, to
  keep this a self-contained standalone project with no cross-target coupling. If
  the iOS copy changes, re-copy it here.
