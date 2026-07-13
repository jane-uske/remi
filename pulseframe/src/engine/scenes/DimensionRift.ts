import * as THREE from 'three';
import { GLSL_UTILS, createFullscreenPass, disposeFullscreenPass, FullscreenPass } from '../glsl';
import { PFScene, SceneFrameInput } from './types';

/**
 * Dimension Rift — the flagship scene.
 *
 * The uploaded image is split into three virtual depth layers (background,
 * subject, foreground bokeh) that parallax against each other under a slow
 * drifting camera. A blurred-luminance pseudo depth map gives the subject
 * layer a 2.5D relief. Kicks fire a zoom punch plus an expanding shockwave
 * ring; mids breathe the layers; highs sharpen detail and light dust motes.
 */

const FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tMap;
uniform float uCanvasAspect;
uniform float uImageAspect;
uniform float uTime;
uniform vec2 uCam;
uniform float uZoom;
uniform float uLevel;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uBeatTime;
uniform float uIntensity;
uniform float uDepth;

${GLSL_UTILS}

vec3 dustLayer(vec2 p, float t, float scale, float seed) {
  vec2 g = p * scale + vec2(seed * 3.1, t * 0.06 * scale);
  vec2 id = floor(g);
  vec2 f = fract(g);
  float h = pfHash(id + seed);
  vec2 c = vec2(fract(h * 13.7), fract(h * 7.31)) * 0.6 + 0.2;
  float d = length(f - c);
  float tw = 0.5 + 0.5 * sin(t * (0.6 + h * 1.7) + h * 6.283);
  float m = smoothstep(0.09, 0.0, d) * step(0.82, h) * tw;
  return vec3(m);
}

void main() {
  vec2 uv = vUv;
  vec2 suv = uv - 0.5;
  suv.x *= uCanvasAspect;
  float rad = length(suv);
  vec2 radDir = rad > 0.0015 ? suv / rad : vec2(0.0);

  // --- beat shockwave ring (uv distortion travelling outward) ---
  float waveT = max(uTime - uBeatTime, 0.0);
  float ring = waveT * 1.05;
  float ripple = exp(-pow((rad - ring) * 8.5, 2.0)) * exp(-waveT * 3.2) * uIntensity;
  uv += radDir * ripple * 0.02 * vec2(1.0 / uCanvasAspect, 1.0);

  // --- beat punch zoom ---
  float punch = uBeat * uBeat * (0.03 + 0.055 * uIntensity);
  float zoom = uZoom + punch + uLow * 0.02 * uIntensity;

  // --- mid-band layer breathing (spatially varying displacement) ---
  vec2 midOff = vec2(
    sin(uTime * 1.35 + suv.y * 3.4),
    cos(uTime * 1.07 + suv.x * 3.1)
  ) * uMid * 0.011 * uIntensity;

  // --- subject layer with pseudo-depth parallax ---
  vec2 cuv0 = pfCoverUV(uv + midOff, uCanvasAspect, uImageAspect, zoom, vec2(0.0));
  float dep = pfLuma(texture(tMap, cuv0, 4.0).rgb);
  vec2 par = uCam * (dep - 0.42) * uDepth * 1.5;
  vec2 uvMain = pfCoverUV(uv + midOff, uCanvasAspect, uImageAspect, zoom, par + uCam * 0.8);
  vec3 mainCol = texture(tMap, uvMain).rgb;

  // treble-driven detail (unsharp mask)
  vec3 softCol = texture(tMap, uvMain, 2.5).rgb;
  mainCol += (mainCol - softCol) * uHigh * 1.5 * uIntensity;

  // --- background layer: wider, blurred, darker, slower parallax ---
  vec2 uvBg = pfCoverUV(uv, uCanvasAspect, uImageAspect, zoom * 0.82, uCam * 0.35);
  vec3 bgCol = texture(tMap, uvBg, 4.5).rgb * vec3(0.38, 0.42, 0.55);

  // --- foreground bokeh layer: heavily magnified + blurred, fastest parallax ---
  vec2 uvFg = pfCoverUV(uv, uCanvasAspect, uImageAspect, zoom * 2.1, uCam * 2.3);
  vec3 fgCol = texture(tMap, uvFg, 5.5).rgb * 0.9;

  // --- depth composition: subject in a centre portal, space at the edges ---
  float edge = smoothstep(0.34, 0.66, rad);
  float corner = smoothstep(0.58, 0.92, rad);
  vec3 col = mix(mainCol, bgCol, edge * (0.3 + 0.45 * uDepth));
  col = mix(col, fgCol, corner * (0.2 + 0.4 * uDepth));

  // rift seam glow between subject and background
  float seam = smoothstep(0.3, 0.42, rad) * (1.0 - smoothstep(0.46, 0.62, rad));
  col += seam * vec3(0.35, 0.5, 0.9) * (0.06 + uLow * 0.22) * uIntensity * uDepth;

  // shockwave highlight
  col += ripple * vec3(0.7, 0.82, 1.0) * 0.4;

  // dust motes, brightened by treble
  vec3 dust = dustLayer(suv + uCam * 3.0, uTime, 5.0, 1.0)
            + dustLayer(suv + uCam * 6.0, uTime * 1.3, 9.0, 2.0) * 0.6;
  col += dust * (0.05 + uHigh * 0.3) * uIntensity * vec3(0.75, 0.85, 1.0);

  // energy exposure + beat flash
  col *= 0.92 + 0.26 * uLevel * uIntensity;
  col *= 1.0 + uBeat * 0.14 * uIntensity;

  fragColor = vec4(col, 1.0);
}
`;

export class DimensionRift implements PFScene {
  readonly id = 'rift';
  private pass: FullscreenPass;
  private uniforms: Record<string, THREE.IUniform>;
  private beatTime = -10;

  constructor() {
    this.uniforms = {
      tMap: { value: null },
      uCanvasAspect: { value: 16 / 9 },
      uImageAspect: { value: 1 },
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector2() },
      uZoom: { value: 1 },
      uLevel: { value: 0 },
      uLow: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uBeat: { value: 0 },
      uBeatTime: { value: -10 },
      uIntensity: { value: 0.65 },
      uDepth: { value: 0.6 },
    };
    this.pass = createFullscreenPass(FRAG, this.uniforms);
  }

  setImage(tex: THREE.Texture, imageAspect: number): void {
    this.uniforms.tMap.value = tex;
    this.uniforms.uImageAspect.value = imageAspect;
  }

  setSize(width: number, height: number): void {
    this.uniforms.uCanvasAspect.value = width / height;
  }

  update({ time, audio, params, cam }: SceneFrameInput): void {
    if (audio.beatHit) this.beatTime = time;
    const u = this.uniforms;
    u.uTime.value = time;
    (u.uCam.value as THREE.Vector2).copy(cam);
    u.uZoom.value = 1.02 + Math.sin(time * 0.19) * 0.028 * params.cameraMotion;
    u.uLevel.value = audio.level;
    u.uLow.value = audio.low;
    u.uMid.value = audio.mid;
    u.uHigh.value = audio.high;
    u.uBeat.value = audio.beat;
    u.uBeatTime.value = this.beatTime;
    u.uIntensity.value = params.intensity;
    u.uDepth.value = params.depth;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.render(this.pass.scene, this.pass.camera);
  }

  dispose(): void {
    disposeFullscreenPass(this.pass);
  }
}
