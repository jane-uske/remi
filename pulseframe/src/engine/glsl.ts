import * as THREE from 'three';

/** Shared fullscreen-pass vertex shader (GLSL ES 3.0 via material.glslVersion). */
export const FULLSCREEN_VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GLSL_UTILS = /* glsl */ `
float pfHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float pfNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pfHash(i);
  float b = pfHash(i + vec2(1.0, 0.0));
  float c = pfHash(i + vec2(0.0, 1.0));
  float d = pfHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float pfFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * pfNoise(p);
    p = rot * p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return v;
}

float pfLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Cover-fit mapping: screen uv -> image uv without stretching the subject.
// scale > 1 magnifies around the centre; offset shifts in image space.
vec2 pfCoverUV(vec2 uv, float canvasAspect, float imageAspect, float scale, vec2 offset) {
  vec2 st = uv - 0.5;
  float s = canvasAspect / imageAspect;
  if (s > 1.0) st.y /= s;
  else st.x *= s;
  st /= scale;
  return st + 0.5 + offset;
}
`;

export interface FullscreenPass {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  mesh: THREE.Mesh;
  material: THREE.RawShaderMaterial;
}

export function createFullscreenPass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): FullscreenPass {
  const material = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: FULLSCREEN_VERT,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, camera, mesh, material };
}

export function disposeFullscreenPass(pass: FullscreenPass): void {
  pass.mesh.geometry.dispose();
  pass.material.dispose();
}
