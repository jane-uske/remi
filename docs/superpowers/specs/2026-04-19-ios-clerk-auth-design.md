# iOS Clerk Auth Design

## Goal

Add formal iOS sign-in using Clerk's hosted/native-prebuilt authentication flow so the iOS client can authenticate as the same identity system already used by Web, then reuse the existing `Authorization: Bearer <token>` WebSocket path without introducing a second auth backend.

## Why Now

The current iOS client is still an inner-test app with `JWT` and `mobile dev key` fallbacks. That is enough for local validation, but it blocks real identity continuity across Web and iOS. The bottleneck is no longer "can iOS connect at all", but "can iOS enter the same user identity graph as Web".

This work is worth doing now because it improves the cross-device continuity layer directly. It is more aligned with the north star than polishing iOS visuals or forcing Web UI parity.

## Non-Goals

- No custom native login form
- No account/profile management page
- No rewrite of the iOS chat UI
- No changes to server auth semantics beyond consuming the same Clerk session tokens already accepted today
- No claims that iOS voice is production-ready

## Current Reality

- Web already uses Clerk as the formal identity path.
- The backend already verifies Clerk session JWTs in `REMI_AUTH_MODE=clerk`.
- The iOS client already knows how to send `Authorization: Bearer` headers over WebSocket.
- The iOS client currently reads auth only from environment variables, so there is no real signed-in state in-app.

## Recommended Approach

Use Clerk's official iOS SDK with prebuilt SwiftUI auth UI:

1. Add `ClerkKit` and `ClerkKitUI` via Swift Package Manager.
2. Configure Clerk at app launch with a publishable key.
3. Gate the existing chat UI behind a lightweight auth shell.
4. Present `AuthView` for sign-in/sign-up.
5. Resolve the current Clerk session token from the SDK and keep using `Authorization: Bearer <token>` for the existing WebSocket connection.
6. Keep legacy `JWT` / `mobile dev key` fallback for local development and rollback safety.

This is the fastest path that still lands on the correct identity system.

## Alternatives Considered

### 1. Clerk iOS SDK + AuthView

Pros:
- Fastest path to formal auth
- Matches the Web identity system
- Avoids custom auth UI and token plumbing
- Keeps backend unchanged

Cons:
- Requires adding Clerk SDK to the Xcode project
- Requires Clerk dashboard native-app setup and associated domains outside the repo

### 2. Browser-based Clerk hosted sign-in with manual callback handling

Pros:
- Also relatively fast

Cons:
- More custom token lifecycle work
- Easier to get session refresh and sign-out wrong
- More likely to become transitional debt

### 3. Stay on legacy JWT bridge

Pros:
- Lowest immediate code churn

Cons:
- Does not solve formal sign-in
- Keeps iOS off the real identity path
- Delays cross-device continuity

## Architecture

### App Layer

Add an iOS auth shell that decides whether the app should:

- enter Clerk-backed formal auth mode
- stay on legacy dev/fallback auth mode

The auth shell owns:

- whether Clerk is enabled
- whether the user is signed in
- current user id
- current session token lookup
- sign-out action

### Chat Layer

`RemiChatStore` should stop reaching into `ProcessInfo` for its effective auth token.

Instead, the store receives an auth provider abstraction that supplies:

- current bearer token, if any
- effective user id, if any
- fallback mobile dev key, if any

That keeps chat transport separate from identity source.

### Identity / Cache Layer

Message cache bucketing should stop depending only on JWT payload parsing. With Clerk, the stable cache key should come from:

1. explicit current user id from auth provider
2. legacy JWT-derived user id
3. default bucket fallback

That prevents Clerk users from collapsing into the anonymous/default bucket.

## Data Flow

1. App launch reads runtime auth mode and Clerk publishable key.
2. If Clerk mode is enabled and configured:
   - configure Clerk
   - inject Clerk into SwiftUI environment
   - render auth gate
3. User signs in using `AuthView`.
4. iOS auth layer reads:
   - `clerk.user?.id`
   - `try await clerk.auth.getToken()`
5. `RemiChatStore` uses that token for `Authorization: Bearer`.
6. Backend verifies Clerk token using existing auth logic and resolves the same user identity family as Web.
7. Local cache keys use the resolved user id instead of relying on JWT parsing only.

## Error Handling

- If Clerk mode is selected but the publishable key is missing, fail closed into legacy mode instead of crashing the app.
- If Clerk is enabled but the user is signed out, do not connect chat yet; show the auth view.
- If token retrieval fails transiently, show a user-visible auth/system error and do not open the socket with an empty bearer token.
- If sign-out occurs, stop the chat store, clear in-memory state, and return to the auth gate.

## Rollout / Fallback

- Formal auth is enabled only when iOS runtime config explicitly selects Clerk mode and a publishable key is present.
- Existing `REMI_IOS_JWT` and `REMI_IOS_MOBILE_DEV_KEY` paths remain available as fallbacks.
- This keeps local testing and recovery paths alive while moving the default production-like route onto Clerk.

## Testing

Because the iOS target does not currently have an XCTest target, the first verification layer will use the existing lightweight Swift regression script pattern.

Add regression coverage for:

- auth runtime policy resolution
- cache bucket selection preferring explicit user id over JWT parsing

Then run a build-level verification against the Xcode project after the code changes.

## External Setup Required

These are required outside the repo before formal iOS auth works end-to-end:

- Add the iOS app under Clerk Native Applications
- Enable Native API in Clerk
- Add associated domains for Clerk Frontend API
- Provide iOS runtime publishable key

## Remaining Gaps After This Work

- iOS voice path still remains experimental
- No full account settings/profile management UI
- No guarantee yet that all production auth edge cases are covered on device
- No automatic migration of existing local dev history buckets into Clerk user buckets
