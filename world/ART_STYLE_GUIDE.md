# Remi World Primitive Art Style Guide

## Current Scope

This guide covers the V1 primitive style only. It is for Babylon.js boxes, cylinders, spheres, planes, and small generated materials. It is not a final asset bible and does not require `.glb`, VRM, Blockbench, MagicaVoxel, or external asset packs. Future `.glb` pipeline rules live in [ASSET_PIPELINE.md](ASSET_PIPELINE.md).

## Visual Target

Remi World should read as a cozy low-poly / voxel-inspired island home:

- warm cottage first
- readable garden clusters
- clean shoreline and water edge
- small hand-placed details
- soft dusk lighting
- no realistic high-poly props in the V1 slice

The style should feel intentionally simple, not like placeholder debug geometry.

## Scale Rules

- One shoreline land-fill cell is `0.8 x 0.8` world units.
- Small decorations should fit inside one cell unless they are explicitly a structure.
- Flowers stay low and readable: thin stem, one blossom, small footprint.
- Lanterns should be tall enough to read in first person, but not block paths.
- Cottage and trees are scenery blockers, not buildable objects.

## Shape Rules

- Use boxes for terrain, wood, stone, fences, roof layers, and voxel foliage.
- Use low-segment spheres only for flowers, fruit, smoke, small pebbles, and glow hints.
- Use cylinders sparingly for barrels, pots, and lantern glow holders.
- Prefer stacked simple shapes over single oversized blocks.
- Avoid decorative SVG or screen-space illustrations inside the 3D scene.

## Color Rules

- Keep the scene warm, readable, and varied.
- Use `src/world/art/remiworldPalette.ts` as the source of truth for scene color choices.
- Grass must stay low-saturation and warm; avoid fluorescent or pure green values.
- Wood should use at least two tones: warm wall/wood and darker trim.
- Roof darks should remain warm brown and readable, never pure black.
- Flowers should provide small accent colors, not dominate the scene.
- Tree crowns should sit behind the cottage emotionally; keep foliage muted and smaller than the house silhouette.
- Preview colors are UI language: green/yellow for valid, orange/red for invalid.
- Do not drift into one-note beige, purple, dark slate, or brown-only palettes.

## Lighting Rules

- The cottage, lanterns, and windows are the emotional center.
- The active lighting preset lives in `src/world/lighting/createEveningLighting.ts`.
- Use one warm low-angle directional key light, plus soft sky fill. Do not flatten the scene with high-intensity ambient light.
- Windows and lanterns should have small-range warm point lights.
- Warm emissive materials can mark light sources, but should not replace actual point lights where local glow matters.
- Avoid oversized white glow balls. Lanterns need a wood support, small shade, warm core, and restrained local light.
- Shadows matter for the cottage, trees, fences, and Remi stand-in; ground should receive those shadows.
- Glow and bloom should be restrained and mostly read from windows/lanterns, not the whole scene.
- Dusk sky and fog can soften the scene, but the player must still read ground and shoreline clearly.

## Hero Shot Rules

- The canonical camera preset lives in `src/world/camera/heroCameraPreset.ts`.
- FOV should stay in the 35-50 degree range to avoid strong wide-angle distortion.
- The cottage should occupy the left/middle emotional center.
- The Remi stand zone should read on the right side of the composition.
- The path should lead from foreground into the cottage/Remi area.
- Foreground flowers and grass should add depth without blocking the house or Remi stand zone.
- Keep distant silhouettes, water, fog, and sky readable enough to create background depth.

## Expansion Land Rules

- Filled land should look like a small shoreline patch, not a generic cube.
- Every filled cell should have:
  - grass top
  - earth body
  - edge lip
  - 2-3 small natural details when not too noisy
- Land cells remain discrete in V1; no terrain mesh merging yet.

## Asset Pipeline Boundary

Do not replace the scene with external `.glb` assets until these conditions are met:

- the 3-minute island loop is comfortable
- placement and land editing rules are stable
- the object categories are clear enough to avoid wasted asset work

The next valid exception is a small asset-pipeline spike, not a broad art pass.
Likely first spike assets:

- lantern variants
- garden sign
- flower cluster

Likely authored assets later:

- cottage prop set
- flower/grass variants
- fence/path kit
- shore stones and wood planks

Remi character assets are a separate pipeline because they need idle, blink, look-at, animation compatibility, and later voice/memory integration. High-poly AI character output should be treated as reference until it is retopologized, rigged, and performance-checked.
Visual Rescue v0.2 does not change that boundary. The current Remi shape is only
a composition stand-in, not a character asset or Remi NPC integration.
