import * as THREE from 'three';
import { GLSL_UTILS, createFullscreenPass, disposeFullscreenPass, FullscreenPass } from '../glsl';
import { PFScene, SceneFrameInput } from './types';

/**
 * Particle Bloom — the image is rebuilt from ~50k points sampled in the
 * vertex shader. Kicks blast the particles outward along per-particle random
 * directions; an exponential envelope pulls them smoothly back home. Mids add
 * ambient drift, highs enlarge and brighten the points. A dark blurred copy
 * of the image stays behind the cloud so the composition never falls apart.
 */

const PARTICLE_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 aUv;
in vec4 aRand;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
uniform sampler2D tMap;
uniform float uCanvasAspect;
uniform float uImageAspect;
uniform float uTime;
uniform float uBeatTime;
uniform float uBeatAmp;
uniform float uLevel;
uniform float uMid;
uniform float uHigh;
uniform float uIntensity;
uniform float uDepth;
uniform float uSizeScale;

out vec3 vColor;

${GLSL_UTILS}

void main() {
  vec2 cuv = pfCoverUV(aUv, uCanvasAspect, uImageAspect, 1.0, vec2(0.0));
  vec3 col = textureLod(tMap, cuv, 0.0).rgb;
  float lum = pfLuma(col);

  vec3 home = position;
  home.z += (lum - 0.45) * uDepth * 0.4;

  // ambient drift with the mids
  home.xy += vec2(
    sin(uTime * 1.6 + aRand.x * 6.283 + home.y * 3.2),
    cos(uTime * 1.25 + aRand.y * 6.283 + home.x * 2.7)
  ) * (0.0025 + uMid * 0.014) * uIntensity;

  // beat explosion with smooth return
  float bt = max(uTime - uBeatTime, 0.0);
  float env = exp(-bt * 3.4) * uBeatAmp;
  vec3 dir = normalize(vec3(aRand.xyz * 2.0 - 1.0) + vec3(home.xy * 0.7, 0.45));
  vec3 pos = home + dir * env * (0.25 + aRand.w * 0.75) * (0.1 + 0.5 * uIntensity);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float size = 1.15 + aRand.w * 1.3 + uHigh * 2.6 * uIntensity + env * 2.2;
  gl_PointSize = clamp(size * uSizeScale / max(-mv.z, 0.1), 1.0, 48.0);

  vColor = col * (0.8 + uLevel * 0.65 + env * 0.7 + uHigh * 0.3);
}
`;

const PARTICLE_FRAG = /* glsl */ `
precision highp float;
in vec3 vColor;
out vec4 fragColor;

void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.14, d);
  if (a < 0.02) discard;
  fragColor = vec4(vColor, a);
}
`;

const BG_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tMap;
uniform float uCanvasAspect;
uniform float uImageAspect;
uniform vec2 uCam;
uniform float uLevel;

${GLSL_UTILS}

void main() {
  vec2 cuv = pfCoverUV(vUv, uCanvasAspect, uImageAspect, 0.92, uCam * 0.3);
  vec3 col = texture(tMap, cuv, 5.0).rgb;
  fragColor = vec4(col * (0.16 + uLevel * 0.06), 1.0);
}
`;

const CAM_FOV = 40;
const CAM_Z = 2.4;

export class ParticleBloom implements PFScene {
  readonly id = 'particles';

  private bgPass: FullscreenPass;
  private bgUniforms: Record<string, THREE.IUniform>;

  private pointsScene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private points: THREE.Points | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.RawShaderMaterial;
  private uniforms: Record<string, THREE.IUniform>;

  private width = 1280;
  private height = 720;
  private beatTime = -10;

  constructor() {
    this.bgUniforms = {
      tMap: { value: null },
      uCanvasAspect: { value: 16 / 9 },
      uImageAspect: { value: 1 },
      uCam: { value: new THREE.Vector2() },
      uLevel: { value: 0 },
    };
    this.bgPass = createFullscreenPass(BG_FRAG, this.bgUniforms);

    this.uniforms = {
      tMap: { value: null },
      uCanvasAspect: { value: 16 / 9 },
      uImageAspect: { value: 1 },
      uTime: { value: 0 },
      uBeatTime: { value: -10 },
      uBeatAmp: { value: 0 },
      uLevel: { value: 0 },
      uMid: { value: 0 },
      uHigh: { value: 0 },
      uIntensity: { value: 0.65 },
      uDepth: { value: 0.6 },
      uSizeScale: { value: 700 },
    };
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    this.camera = new THREE.PerspectiveCamera(CAM_FOV, 16 / 9, 0.1, 10);
    this.camera.position.set(0, 0, CAM_Z);
  }

  private rebuildGeometry(): void {
    const aspect = this.width / this.height;
    const density = 210;
    const cols = Math.round(density * Math.sqrt(aspect));
    const rows = Math.round(density / Math.sqrt(aspect));
    const count = cols * rows;

    const planeH = 2 * CAM_Z * Math.tan((CAM_FOV * Math.PI) / 360) * 1.04;
    const planeW = planeH * aspect;

    const positions = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const rands = new Float32Array(count * 4);
    let seed = 987654321;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let i3 = 0;
    let i2 = 0;
    let i4 = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) / cols;
        const v = (y + 0.5) / rows;
        positions[i3++] = (u - 0.5) * planeW;
        positions[i3++] = (v - 0.5) * planeH;
        positions[i3++] = 0;
        uvs[i2++] = u;
        uvs[i2++] = v;
        rands[i4++] = rand();
        rands[i4++] = rand();
        rands[i4++] = rand();
        rands[i4++] = rand();
      }
    }

    if (this.points) {
      this.pointsScene.remove(this.points);
      this.geometry?.dispose();
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geometry.setAttribute('aUv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('aRand', new THREE.BufferAttribute(rands, 4));
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.pointsScene.add(this.points);
  }

  setImage(tex: THREE.Texture, imageAspect: number): void {
    this.uniforms.tMap.value = tex;
    this.uniforms.uImageAspect.value = imageAspect;
    this.bgUniforms.tMap.value = tex;
    this.bgUniforms.uImageAspect.value = imageAspect;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const aspect = width / height;
    this.uniforms.uCanvasAspect.value = aspect;
    this.bgUniforms.uCanvasAspect.value = aspect;
    this.uniforms.uSizeScale.value = height * 0.85;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.rebuildGeometry();
  }

  update({ time, audio, params, cam }: SceneFrameInput): void {
    if (audio.beatHit) {
      this.beatTime = time;
      this.uniforms.uBeatAmp.value = Math.min(1.4, 0.5 + audio.low * 1.1) * params.beatSensitivity * 0.6 + 0.35;
    }
    const u = this.uniforms;
    u.uTime.value = time;
    u.uBeatTime.value = this.beatTime;
    u.uLevel.value = audio.level;
    u.uMid.value = audio.mid;
    u.uHigh.value = audio.high;
    u.uIntensity.value = params.intensity;
    u.uDepth.value = params.depth;
    (this.bgUniforms.uCam.value as THREE.Vector2).copy(cam);
    this.bgUniforms.uLevel.value = audio.level;

    this.camera.position.set(cam.x * 8, cam.y * 6, CAM_Z);
    this.camera.lookAt(0, 0, 0);
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    renderer.setRenderTarget(target);
    renderer.render(this.bgPass.scene, this.bgPass.camera);
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.pointsScene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    disposeFullscreenPass(this.bgPass);
    if (this.points) this.pointsScene.remove(this.points);
    this.geometry?.dispose();
    this.material.dispose();
  }
}
