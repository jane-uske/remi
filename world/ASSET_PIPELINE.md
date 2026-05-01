# Remi World Asset Pipeline

## Current Decision

Do not keep improving visual quality by hand-building more Babylon primitive
props forever. The next useful art step is an asset pipeline spike:

- generate or author a few small `.glb` props
- clean them in Blender or an equivalent tool
- load them into Babylon
- verify scale, lighting, collision, console health, and performance

This is not a decision to import a full asset pack, a full generated island, or
a runtime Remi character.

## AI Asset Tools

AI tools such as Meshy, Tripo, Rodin, Stable Fast 3D, or Hunyuan3D can be useful
for first-pass prop shapes.

Use them for single assets:

- lantern posts
- garden signs
- flower clusters
- fence pieces
- path stones
- small cottage modules
- barrels, pots, crates, and rocks

Do not use them for:

- one-shot full island scenes
- merged cottage + terrain + garden dioramas
- runtime Remi character models without retopology, rigging, and animation
- assets whose style cannot be reduced into the current cozy low-poly/voxel
  direction

## Why Not Direct High-Poly Imports

The Meshy character test observed on 2026-05-01 produced roughly:

- 641,040 triangles
- 320,488 vertices

That is acceptable as sculpt/reference output, but it is not a browser-game
runtime asset for this project. A single asset at that density would consume too
much budget before cottage, garden, water, land editing, and future NPC logic
are considered.

## Runtime Budgets

These are first-pass budgets for Remi World V1. They are intentionally small.

| Asset Type | Target Triangles | Notes |
|---|---:|---|
| Flower cluster / grass tuft | 100-800 | Several can appear together |
| Small rock / crate / pot | 200-1,500 | Keep silhouettes readable |
| Lantern / sign / fence piece | 500-3,000 | First asset-pipeline candidates |
| Tree or cottage module | 2,000-8,000 | Use sparingly and reuse modules |
| Full cottage kit combined | 8,000-20,000 | Split into modules if possible |
| Remi character prototype | 20,000-60,000 | Requires rig/animation pipeline |

Anything above these limits must be reduced in Blender, Meshy low-poly mode, or
another decimation/retopology step before entering `world/`.

## Reference-To-Asset Workflow

1. Crop the reference image into single-object references.
2. Generate one object at a time, not a whole scene.
3. Export `.glb`.
4. Open in Blender for cleanup:
   - apply scale and rotation
   - set origin at the bottom center or logical pivot
   - reduce triangles
   - remove hidden geometry
   - simplify material count
   - rename meshes and materials clearly
5. Place the cleaned file under `world/public/assets/models/`.
6. Load it through a small Babylon asset loader wrapper.
7. Keep the old primitive prefab until the asset is proven stable.
8. Verify:
   - `npm test`
   - `npm run build`
   - browser smoke for loading, scale, lighting, and console errors

## First Spike

The first `.glb` spike should stay small:

- `lantern_post.glb`
- `remis_garden_sign.glb`
- `flower_cluster_blue_pink.glb`

Success means:

- all three load in `world/`
- they match the current scale
- they do not break placement/removal
- console has no loader errors
- performance remains acceptable on the current island scene

This spike proves the pipeline. It is not a final art pass.

## Remi Character Boundary

Remi as an NPC is a separate asset problem.

A usable Remi character needs:

- rigged humanoid skeleton or VRM-compatible rig
- idle animation
- blink support
- look-at support
- expression or lip-sync support
- acceptable browser triangle count
- material style compatible with the island

Generated high-poly character meshes can guide design, but they are not enough
for runtime NPC integration.
