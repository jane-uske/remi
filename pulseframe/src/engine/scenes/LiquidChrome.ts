import * as THREE from 'three';
import { GLSL_UTILS, createFullscreenPass, disposeFullscreenPass, FullscreenPass } from '../glsl';
import { PFScene, SceneFrameInput } from './types';

/**
 * Liquid Chrome — the image becomes a molten metallic surface.
 * A flowing fbm field continuously warps the picture (energy controls the
 * warp amplitude), beats drop a ripple into the liquid, and a fake normal
 * derived from the flow field produces moving specular sheen whose
 * iridescent tint is driven by the high band.
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
uniform float uLevel;
uniform float uLow;
uniform float uMid;
uniform float uHigh;
uniform float uBeat;
uniform float uBeatTime;
uniform float uIntensity;
uniform float uDepth;

${GLSL_UTILS}

void main() {
  vec2 uv = vUv;
  vec2 suv = uv - 0.5;
  suv.x *= uCanvasAspect;
  float rad = length(suv);
  vec2 radDir = rad > 0.0015 ? suv / rad : vec2(0.0);

  // beat ripple: a drop landing in the liquid
  float waveT = max(uTime - uBeatTime, 0.0);
  float ring = waveT * 0.85;
  float rip = exp(-pow((rad - ring) * 7.5, 2.0)) * exp(-waveT * 2.8);

  // flowing warp field
  vec2 p = suv * (2.0 + uDepth * 1.6);
  float t = uTime * 0.32;
  vec2 flowSeed = vec2(t, -t * 0.7);
  float fx = pfFbm(p + flowSeed);
  float fy = pfFbm(p + vec2(-t * 0.8, t * 0.6) + 4.71);
  vec2 flow = vec2(fx, fy) - 0.5;

  float amp = (0.018 + uLow * 0.055 + uMid * 0.02 + uBeat * 0.03 + rip * 0.05) * uIntensity;
  vec2 warped = uv + flow * amp + radDir * rip * 0.022 * uIntensity;

  float zoom = 1.03 + uLow * 0.02 * uIntensity;
  vec2 cuv = pfCoverUV(warped, uCanvasAspect, uImageAspect, zoom, uCam * 0.8);
  vec3 col = texture(tMap, cuv).rgb;

  // fake liquid normal from the flow field gradient
  vec2 e = vec2(0.045, 0.0);
  float gx = pfFbm(p + e.xy + flowSeed) - pfFbm(p - e.xy + flowSeed);
  float gy = pfFbm(p + e.yx + flowSeed) - pfFbm(p - e.yx + flowSeed);
  gx += radDir.x * rip * 1.6;
  gy += radDir.y * rip * 1.6;
  vec3 nrm = normalize(vec3(-gx, -gy, 0.30));
  vec3 lightDir = normalize(vec3(0.45, 0.65, 0.6));
  float spec = pow(max(dot(nrm, lightDir), 0.0), 20.0);

  // iridescent sheen tinted by treble
  float hue = fract(fx * 0.7 + uHigh * 0.45 + uTime * 0.015);
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
  col += spec * mix(vec3(1.0), iri, 0.5 + uHigh * 0.35)
       * (0.2 + uHigh * 0.6 + uBeat * 0.25) * uIntensity;

  // subtle treble hue drift on the base image
  col = mix(col, col.brg, uHigh * 0.1 * uIntensity);

  // cool shadow tint in flow valleys for a metallic read
  col *= mix(vec3(1.0), vec3(0.82, 0.88, 1.05), (0.5 - abs(fx - 0.5)) * 0.7 * uIntensity);

  col *= 0.9 + 0.3 * uLevel * uIntensity;
  col *= 1.0 + uBeat * 0.1 * uIntensity;

  fragColor = vec4(col, 1.0);
}
`;

export class LiquidChrome implements PFScene {
  readonly id = 'chrome';
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
