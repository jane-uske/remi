// Aurora background field — framework-free WebGL renderer for Remi's portal.
// Mouse-reactive aurora curtains whose palette bends toward the current emotion.
// No deps. Instantiate with a <canvas>, call start(), setTint(hex), and dispose().
//
// Perf budget: native refresh rate, hidden 0fps.
// FBM reduced to 3 octaves, aurora bands reduced to 3, DPR capped at 1.


const VERT = `attribute vec2 a_pos; void main(){ gl_Position = vec4(a_pos,0.0,1.0); }`;

const FRAG = `
precision mediump float;

uniform vec2  u_resolution;
uniform float u_time;
uniform vec2  u_mouse;     // smoothed, pixels, origin bottom-left
uniform float u_inside;    // 0..1 pointer presence
uniform vec3  u_tint;      // current emotion color (0..1)
uniform vec4  u_ripples[6];// xy pos px, z age sec (<0 dead), w strength

#define PI 3.14159265359
#define TAU 6.28318530718
mat2 rot(float a){ float c=cos(a),s=sin(a); return mat2(c,-s,s,c); }
float hash21(vec2 p){ vec3 q=fract(vec3(p.xyx)*0.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec2 hash22(vec2 p){ vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); q+=dot(q,q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }
float gnoise(vec2 p){
  vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  vec2 ga=hash22(i)*2.0-1.0, gb=hash22(i+vec2(1,0))*2.0-1.0;
  vec2 gc=hash22(i+vec2(0,1))*2.0-1.0, gd=hash22(i+vec2(1,1))*2.0-1.0;
  float va=dot(ga,f), vb=dot(gb,f-vec2(1,0)), vc=dot(gc,f-vec2(0,1)), vd=dot(gd,f-vec2(1,1));
  return mix(mix(va,vb,u.x),mix(vc,vd,u.x),u.y);
}
float fbm(vec2 p){ float s=0.0,a=0.5; mat2 m=rot(0.5); for(int i=0;i<3;i++){ s+=a*gnoise(p); p=m*p*2.0; a*=0.5; } return s; }
float ripples(vec2 px, float speed, float wave, float decay){
  float sum=0.0;
  for(int i=0;i<6;i++){ vec4 r=u_ripples[i]; if(r.z<0.0) continue;
    float d=distance(px,r.xy); float rad=r.z*speed; float ring=d-rad;
    sum += sin(ring/wave*TAU)*exp(-r.z/decay)*exp(-ring*ring/(wave*wave*1.5))*r.w; }
  return sum;
}
float rippleFlash(vec2 px, float speed, float th, float decay){
  float b=0.0;
  for(int i=0;i<6;i++){ vec4 r=u_ripples[i]; if(r.z<0.0) continue;
    float d=distance(px,r.xy); float ring=abs(d-r.z*speed);
    b=max(b, exp(-r.z/decay)*exp(-ring*ring/(th*th))*r.w); }
  return b;
}
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0); }

vec3 palAur(float t){
  vec3 a=vec3(0.10,0.80,0.66);
  vec3 b=vec3(0.20,0.42,1.00);
  vec3 c=vec3(0.60,0.30,1.00);
  vec3 col=mix(a,b,smoothstep(0.0,0.55,t));
  return mix(col,c,smoothstep(0.55,1.0,t));
}

void main(){
  vec2 res=u_resolution;
  vec2 uv=gl_FragCoord.xy/res;
  vec2 p=(gl_FragCoord.xy-0.5*res)/res.y;
  vec2 m=(u_mouse-0.5*res)/res.y;

  float md=length(p-m);
  float pull=exp(-md*md*3.0)*(0.30+0.55*u_inside);
  p += normalize(p-m+1e-4)*pull*0.10;

  float rp=ripples(gl_FragCoord.xy, 380.0, 34.0, 1.9);
  p.y += rp*0.012;

  vec3 col = mix(vec3(0.030,0.035,0.072), vec3(0.012,0.016,0.040), uv.y);
  float st=hash21(floor(gl_FragCoord.xy/2.0));
  col += step(0.9991, st)*vec3(0.5,0.6,0.85)*(0.25+0.7*uv.y);

  vec3 aur=vec3(0.0);
  for(int k=0;k<3;k++){
    float fk=float(k);
    float t=u_time*(0.05+0.018*fk);
    float wav=fbm(vec2(p.x*0.85 - t + fk*5.3, fk*2.1));
    float cy = -0.32 + 0.17*fk + 0.18*wav;
    float striate = fbm(vec2(p.x*4.6 + t*2.0 + fk*3.0, p.y*1.5 - t));
    float d=abs(p.y-cy);
    float band = 0.0090/(d*d+0.0090);
    band *= 0.5+0.7*striate;
    band *= smoothstep(0.75,-0.3, p.y-cy);
    band *= 1.0+1.3*pull;
    float hue = clamp(0.22+0.5*(p.y+0.5)+0.25*wav+0.1*fk, 0.0, 1.0);
    vec3 base = mix(palAur(hue), u_tint, 0.5);
    aur += base*band;
  }
  col += aur*0.82;

  float fl=rippleFlash(gl_FragCoord.xy, 380.0, 24.0, 1.6);
  col += mix(palAur(0.6), u_tint, 0.55)*fl*0.9;
  col += mix(palAur(0.45), u_tint, 0.5)*exp(-md*md*16.0)*0.35*(0.3+0.6*u_inside);
  col *= 1.0 - 0.32*smoothstep(0.45,1.25,length(p*vec2(0.85,1.0)));

  col = aces(col*1.04);
  col = pow(col, vec3(0.92));
  gl_FragColor=vec4(col,1.0);
}`;

function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

type Ripple = { x: number; y: number; t0: number; strength: number };

export class AuroraField {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private quad: WebGLBuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private raf = 0;
  private startTime = performance.now();
  private lastFrame = this.startTime;
  private dpr = 1;
  private mouse: { x: number; y: number };
  private smooth: { x: number; y: number };
  private inside = 0;
  private insideTarget = 0;
  private hidden = false; // tab visibility
  private ripples: Ripple[] = [];
  private tintTarget: [number, number, number] = [0.18, 0.83, 0.75];
  private tintCur: [number, number, number] = [0.18, 0.83, 0.75];
  private listeners: Array<[string, EventTarget, EventListener]> = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const opts: WebGLContextAttributes = { antialias: false, alpha: false, powerPreference: "low-power" };
    const gl = (canvas.getContext("webgl", opts) ||
      canvas.getContext("experimental-webgl", opts)) as WebGLRenderingContext | null;
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;

    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.program = this.link(VERT, FRAG);
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(this.program, i)!;
      const name = info.name.replace(/\[0\]$/, "");
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.smooth = { ...this.mouse };

    this.on(window, "resize", () => this.resize());
    this.on(window, "pointermove", (e) => {
      const ev = e as PointerEvent;
      this.mouse.x = ev.clientX; this.mouse.y = ev.clientY; this.insideTarget = 1;
    });
    this.on(window, "pointerdown", (e) => {
      const ev = e as PointerEvent;
      this.mouse.x = ev.clientX; this.mouse.y = ev.clientY; this.insideTarget = 1;
      this.addRipple(ev.clientX, ev.clientY, 1);
    });
    this.on(window, "pointerleave", () => { this.insideTarget = 0; });
    this.on(window, "blur", () => { this.insideTarget = 0; });
    this.on(document, "visibilitychange", () => {
      this.hidden = document.hidden;
    });
    this.resize();
  }

  private on(target: EventTarget, type: string, fn: EventListener) {
    target.addEventListener(type, fn, { passive: true });
    this.listeners.push([type, target, fn]);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error("Aurora shader compile failed: " + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, "a_pos");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error("Aurora link failed: " + gl.getProgramInfoLog(p));
    }
    return p;
  }

  setTint(hex: string) {
    const [r, g, b] = hexToRgb01(hex);
    this.tintTarget = [Math.min(1, r * 1.05), Math.min(1, g * 1.05), Math.min(1, b * 1.05)];
  }

  addRipple(x: number, y: number, strength: number) {
    const t = (performance.now() - this.startTime) / 1000;
    this.ripples.push({ x, y, t0: t, strength });
    if (this.ripples.length > 6) this.ripples.shift();
  }

  resize() {
    // Cap DPR at 1 — this shader is per-pixel heavy; retina doubles pixel count 4x.
    this.dpr = 1;
    const w = Math.floor(window.innerWidth * this.dpr);
    const h = Math.floor(window.innerHeight * this.dpr);
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  start() {
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.hidden) return;
      this.renderFrame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  private renderFrame() {
    const gl = this.gl;
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    let dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    dt = Math.min(dt, 0.05);

    const k = 1 - Math.pow(0.0015, dt);
    this.smooth.x += (this.mouse.x - this.smooth.x) * k;
    this.smooth.y += (this.mouse.y - this.smooth.y) * k;
    const ki = 1 - Math.pow(0.05, dt);
    this.inside += (this.insideTarget - this.inside) * ki;
    const kc = 1 - Math.pow(0.02, dt);
    for (let i = 0; i < 3; i++) this.tintCur[i] += (this.tintTarget[i] - this.tintCur[i]) * kc;

    gl.useProgram(this.program);
    const dpr = this.dpr, H = this.canvas.height, W = this.canvas.width;
    const u = this.u;
    if (u.u_resolution) gl.uniform2f(u.u_resolution, W, H);
    if (u.u_time) gl.uniform1f(u.u_time, t);
    if (u.u_mouse) gl.uniform2f(u.u_mouse, this.smooth.x * dpr, H - this.smooth.y * dpr);
    if (u.u_inside) gl.uniform1f(u.u_inside, this.inside);
    if (u.u_tint) gl.uniform3f(u.u_tint, this.tintCur[0], this.tintCur[1], this.tintCur[2]);
    if (u.u_ripples) {
      const arr = new Float32Array(6 * 4);
      for (let i = 0; i < 6; i++) {
        const r = this.ripples[i];
        if (r) { arr[i*4] = r.x*dpr; arr[i*4+1] = H - r.y*dpr; arr[i*4+2] = t - r.t0; arr[i*4+3] = r.strength; }
        else arr[i*4+2] = -1;
      }
      gl.uniform4fv(u.u_ripples, arr);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    for (const [type, target, fn] of this.listeners) target.removeEventListener(type, fn);
    this.listeners = [];
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteBuffer(this.quad);
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }
}
