# PulseFrame

**Browser-based music-reactive animated cover creator.** Drop in a still image and
a track, and PulseFrame turns them into a living, beat-driven cover you can record
to a video file — entirely in the browser. No server, no login, no upload, no cloud.
Your media never leaves the tab.

Built with **React + TypeScript + Three.js (WebGL2)** and tuned for the latest
desktop Chrome.

---

## Quick start

```bash
cd pulseframe
npm install
npm run dev
# open http://localhost:5910
```

That's it. The app opens with a **built-in demo** already loaded — a synthwave cover
image and a 120 BPM track ("Midnight Circuit"), both generated procedurally in the
browser. Press the big play button (or the on-canvas prompt if the browser blocks
autoplay) and the cover comes alive immediately, before you upload anything.

### Other commands

```bash
npm run typecheck   # tsc --noEmit — strict type check, no emit
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve the production build on http://localhost:5911
```

---

## What it does

### 1. Reacts to the music
The audio engine (`src/audio/AudioEngine.ts`) runs a WebAudio `AnalyserNode` once per
render frame and extracts, with **adaptive per-band normalization** so every band uses
its full dynamic range regardless of absolute level:

| Signal | Drives |
|--------|--------|
| **Low** (25–160 Hz, kick/bass) | Impact, zoom punch, spatial push |
| **Mid** (160–2000 Hz) | Layer displacement / breathing / deformation |
| **High** (2–9.5 kHz) | Fine detail, particle brightness, chromatic fringe |
| **Beat** (low-band spectral flux) | Shockwave / burst on each detected kick |
| **Overall energy** | Global intensity |

Beats are found by **positive spectral flux** on the low band with an adaptive
threshold and a refractory window, so a sustained bassline still produces clean kick
onsets instead of a pinned-at-max blob. Features are attack/release smoothed — reactive
but never jittery. High-frequency audio data is read through refs and never pushed
through React state.

### 2. Three visual scenes

- **Dimension Rift** (the showcase) — multi-layer parallax with pseudo-depth derived
  from image luminance, slow continuous camera drift, beat-triggered shockwave rings
  and zoom punch, mid-band breathing, high-band unsharp detail, plus a glowing rift
  seam. Post: bloom, chromatic aberration, vignette, film grain. The subject stays
  recognizable throughout.
- **Liquid Chrome** — flowing FBM warp of the image with beat-driven ripple drops,
  fake-normal specular sheen, and iridescent high-band tinting.
- **Particle Bloom** — ~50k GPU points sampled from the image that hold its shape,
  then burst outward on each beat and smoothly settle back; mid drift and high-band
  size/brightness modulation.

### 3. Live parameters
Seven sliders apply in real time (no reload, no re-init of the render loop):
**Effect Intensity, Beat Sensitivity, Motion Speed, Depth, Glow, Chromatic Aberration,
Camera Motion** — plus **Reset** and **Randomize**. Configurations can be saved as
named **presets** to LocalStorage and re-applied or deleted later.

### 4. Your own media
Drag-and-drop or pick:
- **Images**: JPG / PNG / WebP (auto-downscaled past 2048 px on the long edge)
- **Audio**: MP3 / WAV / anything the browser can decode

Everything is processed locally. Bad or oversized files produce a clear, human-readable
error toast — never a black screen. Old textures, buffers and object URLs are released
when you re-upload.

### 5. Three aspect ratios
**16:9** (1280×720), **1:1** (960×960), **9:16** (720×1280). The image is cover-fit,
never stretched, so the subject keeps its proportions and stays well composed.

### 6. Video export
Record a **5-second or 10-second WebM** (VP9 video + Opus audio) containing the live
visuals *and* the original audio, muxed in sync. Export uses real-time
`canvas.captureStream(60)` + `MediaRecorder`, with a progress bar and a cancel button.
Keep the tab visible while recording (the app warns you if it's hidden, since browsers
throttle background tabs). The result is a normal `.webm` you can download and drop
straight into a screen/social pipeline.

---

## Project structure

```
pulseframe/
├── index.html
├── vite.config.ts            # ports: dev 5910, preview 5911
├── tsconfig.json             # strict, noUnusedLocals/Parameters
├── src/
│   ├── main.tsx              # React root
│   ├── App.tsx               # top-level layout
│   ├── controller.ts         # singleton app controller: boots engine, wires
│   │                         #   audio↔visuals, media I/O, export, presets,
│   │                         #   installs window.__pulseframe test hook
│   ├── types.ts              # SceneId/AspectId/VisualParams/AudioFrame/... + defaults
│   ├── state/
│   │   ├── store.ts          # useSyncExternalStore store + toasts (no per-frame state)
│   │   └── presets.ts        # LocalStorage preset load/save/delete
│   ├── audio/
│   │   ├── AudioEngine.ts     # WebAudio graph, band analysis, beat detection, export tap
│   │   └── demoTrack.ts       # procedural 120 BPM demo track (OfflineAudioContext)
│   ├── assets/
│   │   └── demoImage.ts       # procedural synthwave demo cover (2D canvas)
│   ├── engine/
│   │   ├── VisualEngine.ts    # WebGL2 renderer, render target, post pass, RAF loop,
│   │   │                      #   camera drift, visibility-based pause, WebGL probe
│   │   ├── glsl.ts            # shared GLSL (cover-fit UV, noise/fbm, fullscreen pass)
│   │   └── scenes/
│   │       ├── types.ts
│   │       ├── DimensionRift.ts
│   │       ├── LiquidChrome.ts
│   │       └── ParticleBloom.ts
│   ├── export/
│   │   └── Recorder.ts        # MediaRecorder over canvas + audio stream → WebM
│   ├── components/           # TopBar, MediaPanel, Stage, Transport, ParamsPanel,
│   │                         #   PresetsPanel, ExportPanel, Toasts
│   └── styles.css            # studio dark theme
```

### Architecture notes
- The Three.js render loop lives entirely **outside React** and is created once. React
  updates never recreate it; audio data flows to shaders through refs, not state.
- WebGL support is probed at boot; if WebGL2 is unavailable the app shows a clear
  explanatory message instead of a black canvas.
- Rendering pauses on `visibilitychange` (hidden tab) to save GPU.
- All GPU resources (textures, geometries, materials, render targets) and Blob URLs
  are disposed on scene switch, re-upload, and teardown.

---

## Browser requirements

- **Latest desktop Chrome** is the target and the best experience. Chromium-based
  Edge and recent Firefox also work.
- **WebGL2** and **WebAudio** are required.
- Video export needs **`MediaRecorder`** with a WebM/VP9 (or VP8) + Opus codec —
  available in Chrome/Edge. Safari's MediaRecorder WebM support is limited, so export
  may be unavailable there even though the visuals render.
- Autoplay policies mean audio starts on your first click; the app shows an explicit
  click-to-play prompt rather than failing silently.

---

## Known limitations

- **Export is real-time.** A 10-second clip takes ~10 seconds to record, and the tab
  must stay visible — background tabs are throttled by the browser and would drop
  frames. There is no offline/faster-than-real-time encoder.
- **WebM only.** Output is WebM (VP9/Opus). Converting to MP4 for platforms that
  require it is left to an external tool (e.g. ffmpeg).
- **Very large images** are downscaled to 2048 px on the long edge to protect GPU
  memory and framerate.
- **Beat detection is calibrated for 60 fps.** On low-framerate or heavily throttled
  hardware (or headless software rendering), the flux-based detector under-samples
  onsets and may catch fewer beats than the track actually contains.
- **Particle Bloom** uses ~50k points; on integrated GPUs it is the heaviest scene.
- No persistence beyond LocalStorage presets — uploaded media and exports are not saved
  between sessions by design (privacy: nothing is stored or uploaded).
