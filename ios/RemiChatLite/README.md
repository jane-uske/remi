# RemiChatLite (iOS v0)

A minimal SwiftUI iOS chat client for Remi backend.

## Scope

- Text chat
- WebSocket streaming (`chat_chunk`/`chat_end`)
- Auto reconnect
- Local message cache (isolated by JWT user id when token exists)
- Auth header fallback: JWT first, mobile dev key second
- Push-to-talk voice input
- Experimental full-duplex voice toggle on iOS frontend
- Full-screen duplex demo scene for future voice-mode / 3D Rem integration

## Quick Start (Xcode)

1. Open the existing Xcode project:
   - `ios/RemiChatLite/RemiChatLite/RemiChatLite.xcodeproj`
2. Choose one shared scheme:
   - `RemiChatLite` for local development
   - `RemiChatLite-Tunnel` for Cloudflare Tunnel / remote iPhone testing
3. `RemiChatLite` already includes a safe local default:
   - `REMI_IOS_WS_URL=ws://127.0.0.1:3000/ws`
4. `RemiChatLite-Tunnel` already includes:
   - `REMI_IOS_WS_URL=wss://app-rem.remi.run/ws`
5. In Scheme -> Run -> Environment Variables, only add secrets locally when needed:
   - `REMI_IOS_JWT=<jwt-token>` for remote/tunnel mode
   - `REMI_IOS_MOBILE_DEV_KEY=<optional-dev-key>` for local dev-key mode
6. Build and run on device or simulator.

## Project Layout

- `RemiChatLite/RemiChatLite/RemiChatLite.xcodeproj`: canonical Xcode project
- `RemiChatLite/RemiChatLite/RemiChatLite/*.swift`: canonical iOS source files
- `checklists/IOS_V0_TESTFLIGHT_CHECKLIST.md`: inner-test runbook
- `scripts/cache_bucket_regression.swift`: local cache isolation regression script

## Backend Requirements

For dev-key mode (when JWT is enabled on server):

- `REMI_MOBILE_DEV_ENABLED=1`
- `REMI_MOBILE_DEV_KEY=<same-key-as-ios>`

For JWT mode:

- `JWT_SECRET=<configured>`
- client sends `Authorization: Bearer <token>`

## Notes

- This is an inner-test build target, not production hardening.
- v1 should remove dev-key and switch to JWT-only.
- Push-to-talk and duplex are now separate iOS entry buttons.
- Duplex button now opens a dedicated full-screen voice demo shell instead of staying inline in chat.
- Leaving the duplex demo shell now tears down the local duplex lane and stops any queued local TTS playback.
- Duplex voice is still experimental. The frontend now keeps mic capture and TTS on a shared `AVAudioSession`, but real-device validation is still required before treating it as usable.
- Runbook: `checklists/IOS_V0_TESTFLIGHT_CHECKLIST.md`
- Shared schemes intentionally do not commit JWT or dev-key values.
- Cache regression script example:
  - `tmp_bin=$(mktemp /tmp/remi-cache-regression.XXXXXX) && xcrun swiftc -parse-as-library ios/RemiChatLite/RemiChatLite/RemiChatLite/RemiChatIdentity.swift ios/RemiChatLite/scripts/cache_bucket_regression.swift -o "$tmp_bin" && "$tmp_bin" && rm -f "$tmp_bin"`
