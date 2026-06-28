---
name: remi-aurora-glass-design
description: The visual design language ("Aurora Glass") for the Remi iOS companion app (ios/RemiChatLite). Use this skill WHENEVER you are styling, restyling, theming, or adding any UI to the Remi iOS app — new screens, views, buttons, sheets, colors, gradients, materials, motion, typography, or design tokens. Trigger even when the user doesn't say "design": any change touching RemiDesignTokens, SwiftUI views under ios/RemiChatLite, the avatar stage, chat bubbles, or input controls should follow this language. The goal is a premium ("高级感") yet warm, companionable ("陪伴感") feel inspired by visionOS spatial materials and Apple Music's ambient now-playing.
---

# Aurora Glass — Remi iOS Design Language

Remi is an emotional Live2D companion. The visual language must feel **premium first, warm always**. Premium ("高级感") comes from **depth + frosted glass + restraint**. Warmth ("陪伴感") comes from **living light** — an emotion-driven aura that breathes — never from clutter, candy colors, or gimmicks.

Reference north stars: **visionOS** (spatial depth, vibrancy, soft glass) × **Apple Music** ambient now-playing (volumetric color light behind the subject). When in doubt, ask: *"Does this feel like the avatar is floating in a calm, dimensional space, lit by her own mood?"* If a change makes it flatter, busier, or more saturated/toy-like, it's wrong.

## Source of truth (read before editing)

- `ios/RemiChatLite/RemiChatLite/RemiChatLite/RemiDesignTokens.swift` — the token enum. **All new colors/materials go through here**, not inline literals.
- `ios/RemiChatLite/RemiChatLite/RemiChatLite/RemiChatModels.swift` — `AvatarEmotion` aura hues + `displayName`.
- `RemiCompanionView.backgroundLayer`, `RemiAvatarStageView` — reference implementations of background depth + living aura.

## Core principles

1. **Depth over decoration.** Build space with layered gradients, a volumetric stage halo, and frosted glass — not borders, drop shadows, or dividers. The eye should fall to the avatar.
2. **Living light = warmth.** The avatar's presence is conveyed by a soft aura that breathes (~0.06 Hz) and shifts hue with emotion. This is the single most important "陪伴感" device. Keep it; never replace it with a static glow.
3. **Restraint reads as premium.** One accent (electric teal). Generous whitespace. Few, large type sizes. Slow, eased motion. If a screen feels busy, remove something.
4. **Glass, not opacity hacks.** Prefer `.glassEffect(.regular.tint(...))` / `.ultraThinMaterial` over flat semi-transparent fills. Layer a faint tint behind glass for depth.
5. **Emotion identity is sacred.** The per-emotion aura hues are the product's emotional vocabulary — don't redefine them without explicit sign-off. Refine luminance, never swap meanings.

## Tokens (concrete values)

**Accent** — electric teal `#24B8A6` (`RemiDesignTokens.accent`). The only accent. Used for active states, send, focus.

**Scene background** (`backgroundStops`):
- Dark ("deep space"): `rgb(0.04,0.05,0.09)` → `rgb(0.06,0.09,0.15)` → `rgb(0.05,0.12,0.17)`, top→bottom.
- Light ("dawn mist"): `rgb(0.97,0.98,1.00)` → `rgb(0.90,0.94,0.98)` → `rgb(0.85,0.92,0.94)`, top→bottom.

**Stage halo** (`stageHaloColor`) — radial glow centered at `(0.5, 0.34)`, behind the avatar, fading to `.clear` (endRadius ≈ 540):
- Dark: `rgb(0.16,0.45,0.46)` @ 0.50, **`.screen` blend** (additive glow).
- Light: `white` @ 0.70, **`.plusLighter` blend**.

**Glass tints** (`glassTint` / `strongGlassTint`): dark `white@0.05 / @0.12`; light `white@0.24 / @0.34`. Surface corner radius 22, inner 18.

**Emotion aura hues** (`AvatarEmotion.auraStart/EndHex`) — keep as-is:
| emotion | start | end |
|---|---|---|
| neutral | `#65d5f0` | `#287d97` |
| happy | `#f7a6cf` | `#db6f8f` |
| curious | `#8cb9ff` | `#4d7fd6` |
| shy | `#d7b2ff` | `#9c6ff0` |
| sad | `#95bfd0` | `#5c7f90` |

Render the aura as a blurred radial gradient (start→end→clear, blur ≈ 48) plus a soft blurred circle (blur ≈ 72), at ~0.28 alpha.

## Motion

Motion should feel like breathing, never snappy.
- **Aura breath** — the signature: scale `0.97↔1.06`, opacity `0.82↔1.0`, `.easeInOut(duration: 8).repeatForever(autoreverses: true)` (≈0.06 Hz). Drive with a `@State` bool toggled `.onAppear`.
- **Emotion crossfade** — `.easeInOut(duration: 1.2)` keyed on emotion.
- **Sheets / springs** — `.spring(response: 0.4, dampingFraction: 0.82)`.
- **Companion line** — `.easeInOut(duration: 0.6)`.
- Avatar render FPS is phase-driven for battery (speaking 30 / listening·thinking 24 / idle 14), see `RemiLive2DRenderer`. Visual motion design should assume the idle avatar still gently breathes/blinks.

## Typography

**SF Rounded** everywhere (`design: .rounded`). Rounded = warm without being childish. Large titles + generous whitespace; prefer one or two big sizes over many small ones. Weights: titles `.semibold`, body `.regular`/`.medium`.

## Accessibility (part of the design, not an afterthought)

Decorative layers (aura, halo, status dots) → `.accessibilityHidden(true)`. The avatar reads as one image element labeled with its current emotion `displayName`. Presence + companion line combine into one VoiceOver element. Every icon-only control needs a label/hint; press-and-hold controls need `.isButton` trait + a hint. Maintain contrast: text uses `RemiDesignTokens.primaryText/secondaryText`.

## Do / Don't

**Do**
- Route every color through `RemiDesignTokens`; add a token rather than an inline literal.
- Let the background carry depth; keep foreground surfaces glassy and quiet.
- Tie ambient color to emotion where it strengthens presence.
- Use slow, eased, breathing motion.

**Don't**
- Don't add hard borders, harsh shadows, or 1px dividers to create separation — use depth/glass.
- Don't introduce a second accent or saturated "candy" colors.
- Don't make motion fast/bouncy or use spinners where a soft fade works.
- Don't freeze or remove the living aura — it is the soul of "陪伴感".
- Don't redefine emotion→hue meanings without sign-off.

## When extending to new surfaces (bubbles, buttons, headers, etc.)

Evolve from the tokens above. A new surface is: a glass material + faint tint for depth, SF Rounded type, the teal accent only for active/primary affordances, eased motion, and — if it represents Remi's presence or state — a touch of the emotion light. Build it, then run it on the iPhone 17 simulator in **both** light and dark (Aurora Glass is designed dark-first; verify the deep-space glow):

```
xcodebuild -project ios/RemiChatLite/RemiChatLite/RemiChatLite.xcodeproj \
  -scheme RemiChatLite -destination 'platform=iOS Simulator,name=iPhone 17' build
```
