import * as THREE from 'three';
import { AspectId, AudioFrame, RENDER_SIZES, SceneId, VisualParams } from '../types';
import { GLSL_UTILS, createFullscreenPass, disposeFullscreenPass, FullscreenPass } from './glsl';
import { PFScene } from './scenes/types';

const POST_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tScene;
uniform vec2 uTexel;
uniform float uAspect;
uniform float uTime;
uniform float uGlow;
uniform float uCA;
uniform float uLevel;
uniform float uHigh;
uniform float uBeat;

${GLSL_UTILS}

void main() {
  vec2 uv = vUv;
  vec2 suv = uv - 0.5;

  // radial chromatic aberration, boosted by treble and beats
  float ca = uCA * (0.004 + uHigh * 0.005 + uBeat * 0.004);
  vec2 dir = suv * ca;
  vec3 col;
  col.r = texture(tScene, uv + dir).r;
  col.g = texture(tScene, uv).g;
  col.b = texture(tScene, uv - dir).b;

  // two-ring blur for bloom
  vec3 blurA = vec3(0.0);
  vec3 blurB = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 d = vec2(cos(a), sin(a));
    blurA += texture(tScene, uv + d * uTexel * 5.0).rgb;
    blurB += texture(tScene, uv + d * uTexel * 14.0).rgb;
  }
  blurA /= 8.0;
  blurB /= 8.0;
  vec3 soft = blurA * 0.6 + blurB * 0.4;
  vec3 bloom = max(soft - 0.42, 0.0);
  col += bloom * uGlow * (1.1 + uLevel * 1.1);

  // gentle filmic-ish shoulder to keep highlights pleasant
  col = col / (1.0 + col * 0.18);

  // vignette
  vec2 vv = suv * vec2(uAspect, 1.0);
  float vig = smoothstep(1.35, 0.45, dot(vv, vv) * 1.8);
  col *= mix(0.68, 1.02, vig);

  // fine animated grain
  float g = pfHash(uv * vec2(1613.0, 907.0) + vec2(fract(uTime * 13.7), fract(uTime * 7.3)) * 51.0) - 0.5;
  col += g * 0.035;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export type FrameListener = (audio: AudioFrame) => void;

export interface VisualEngineHooks {
  getParams(): VisualParams;
  analyse(dt: number, sensitivity: number): AudioFrame;
}

export class VisualEngine {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private rt: THREE.WebGLRenderTarget;
  private post: FullscreenPass;
  private postUniforms: Record<string, THREE.IUniform>;

  private scenes = new Map<SceneId, PFScene>();
  private activeId: SceneId = 'rift';

  private raf = 0;
  private running = false;
  private lastNow = 0;
  private time = 0;
  private cam = new THREE.Vector2();

  private width: number;
  private height: number;

  private imageTex: THREE.Texture | null = null;
  private imageAspect = 1;

  private frameListeners = new Set<FrameListener>();
  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
    } else if (this.running) {
      this.lastNow = performance.now() / 1000;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.tick);
    }
  };

  constructor(private hooks: VisualEngineHooks, aspect: AspectId) {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) {
      throw new Error(
        'WebGL2 is not available. PulseFrame needs hardware-accelerated graphics — please use a recent desktop Chrome with graphics acceleration enabled.',
      );
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    [this.width, this.height] = RENDER_SIZES[aspect];
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.setClearColor(0x05050a, 1);

    this.rt = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
    });

    this.postUniforms = {
      tScene: { value: this.rt.texture },
      uTexel: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
      uAspect: { value: this.width / this.height },
      uTime: { value: 0 },
      uGlow: { value: 0.5 },
      uCA: { value: 0.35 },
      uLevel: { value: 0 },
      uHigh: { value: 0 },
      uBeat: { value: 0 },
    };
    this.post = createFullscreenPass(POST_FRAG, this.postUniforms);

    document.addEventListener('visibilitychange', this.onVisibility);
  }

  registerScene(scene: PFScene): void {
    this.scenes.set(scene.id as SceneId, scene);
    scene.setSize(this.width, this.height);
    if (this.imageTex) scene.setImage(this.imageTex, this.imageAspect);
  }

  hasScene(id: SceneId): boolean {
    return this.scenes.has(id);
  }

  setScene(id: SceneId): void {
    if (this.scenes.has(id)) this.activeId = id;
  }

  setAspect(aspect: AspectId): void {
    [this.width, this.height] = RENDER_SIZES[aspect];
    this.renderer.setSize(this.width, this.height, false);
    this.rt.setSize(this.width, this.height);
    (this.postUniforms.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    this.postUniforms.uAspect.value = this.width / this.height;
    this.scenes.forEach((s) => s.setSize(this.width, this.height));
  }

  /** Takes ownership of the texture; the previous one is disposed. */
  setImage(tex: THREE.Texture, imageAspect: number): void {
    if (this.imageTex && this.imageTex !== tex) this.imageTex.dispose();
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.wrapT = THREE.MirroredRepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    this.imageTex = tex;
    this.imageAspect = imageAspect;
    this.scenes.forEach((s) => s.setImage(tex, imageAspect));
  }

  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now() / 1000;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.tick);
    this.renderFrame();
  };

  private renderFrame(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(Math.max(now - this.lastNow, 0.0001), 0.1);
    this.lastNow = now;

    const params = this.hooks.getParams();
    const speed = 0.3 + params.motionSpeed * 1.7;
    this.time += dt * speed;

    const audio = this.hooks.analyse(dt, params.beatSensitivity);

    const camAmp = params.cameraMotion * 0.032;
    this.cam.set(
      Math.sin(this.time * 0.31) * 0.7 + Math.sin(this.time * 0.127) * 0.3,
      Math.cos(this.time * 0.233) * 0.6 + Math.sin(this.time * 0.111) * 0.4,
    );
    this.cam.multiplyScalar(camAmp);

    const scene = this.scenes.get(this.activeId);
    if (scene) {
      scene.update({ dt, time: this.time, audio, params, cam: this.cam });
      scene.render(this.renderer, this.rt);
    }

    const pu = this.postUniforms;
    pu.uTime.value = this.time;
    pu.uGlow.value = params.glow;
    pu.uCA.value = params.chromatic;
    pu.uLevel.value = audio.level;
    pu.uHigh.value = audio.high;
    pu.uBeat.value = audio.beat;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.post.scene, this.post.camera);

    this.frameListeners.forEach((l) => l(audio));
  }

  /**
   * Test/diagnostic helper: renders one frame synchronously and returns the
   * average brightness (0..255) of a centre patch of the default framebuffer.
   */
  sampleBrightness(): number {
    this.renderFrame();
    const gl = this.renderer.getContext();
    const size = 24;
    const buf = new Uint8Array(size * size * 4);
    gl.readPixels(
      Math.floor(this.width / 2 - size / 2),
      Math.floor(this.height / 2 - size / 2),
      size,
      size,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      buf,
    );
    let sum = 0;
    for (let i = 0; i < buf.length; i += 4) sum += (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
    return sum / (size * size);
  }

  dispose(): void {
    this.stop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.scenes.forEach((s) => s.dispose());
    this.scenes.clear();
    disposeFullscreenPass(this.post);
    this.rt.dispose();
    this.imageTex?.dispose();
    this.imageTex = null;
    this.renderer.dispose();
  }
}
