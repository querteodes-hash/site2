import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { NOISE, FULLSCREEN_VERT } from './glsl.js';
import { MoneyScene } from './money.js';
import { TunnelScene } from './tunnel.js';
import { GarageScene } from './garage.js';
import { loadGLBCar } from './glbcar.js';

// One renderer, several scenes. Scenes render into HDR targets and are blended
// with an animated dissolve (fire burn / digital glitch), then bloom + final grade.

const mixFrag = /* glsl */ `
uniform sampler2D tA;
uniform sampler2D tB;
uniform float uT;
uniform float uMode;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 uv = vUv;
  float t = uT;
  if (t <= 0.0) { gl_FragColor = texture2D(tA, uv); return; }
  if (t >= 1.0) { gl_FragColor = texture2D(tB, uv); return; }

  vec3 col;
  if (uMode < 0.5) {
    // FIRE: burn-through from the bottom with noisy front and glowing edge
    float n = fbm(vec2(uv.x * uAspect, uv.y) * 3.2 + vec2(0.0, -uTime * 0.15));
    float field = mix(n, uv.y, 0.55);
    float th = t * 1.35 - 0.12;
    float e = th - field;
    float showB = smoothstep(0.0, 0.012, e);
    float edge = 1.0 - smoothstep(0.0, 0.035, abs(e));
    float charA = smoothstep(-0.14, 0.0, e) * (1.0 - showB);
    vec2 heat = vec2(fbm(uv * 9.0 + uTime) - 0.5, fbm(uv * 9.0 - uTime) - 0.5) * 0.02 * edge;
    vec3 a = texture2D(tA, uv + heat).rgb * (1.0 - 0.9 * charA);
    vec3 b = texture2D(tB, (uv - 0.5) * (1.0 - 0.06 * (1.0 - t)) + 0.5 + heat).rgb;
    col = mix(a, b, showB);
    vec3 fire = mix(vec3(1.0, 0.18, 0.02), vec3(1.0, 0.8, 0.4), pow(edge, 4.0));
    col += fire * pow(edge, 2.5) * 2.6;
  } else {
    // DIGITAL: blocky glitch dissolve with cyan scan edge + RGB split
    vec2 cell = floor(vec2(uv.x * uAspect, uv.y) * 26.0);
    float r = hash12(cell + floor(uTime * 8.0) * 0.0);
    float field = mix(r, 1.0 - uv.x, 0.5);
    float th = t * 1.3 - 0.15;
    float e = th - field;
    float showB = step(0.0, e);
    float edge = 1.0 - smoothstep(0.0, 0.05, abs(e));
    float sh = edge * 0.012;
    vec3 a = vec3(texture2D(tA, uv + vec2(sh, 0.0)).r, texture2D(tA, uv).g, texture2D(tA, uv - vec2(sh, 0.0)).b);
    vec3 b = vec3(texture2D(tB, uv - vec2(sh, 0.0)).r, texture2D(tB, uv).g, texture2D(tB, uv + vec2(sh, 0.0)).b);
    col = mix(a, b, showB);
    float scan = step(0.5, fract(uv.y * 180.0)) * 0.5 + 0.5;
    col += vec3(0.3, 0.95, 1.0) * edge * edge * 0.7 * scan;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const finalFrag = /* glsl */ `
uniform sampler2D tC;
uniform float uTime;
uniform float uWater;
uniform float uVel;
uniform float uFade;
uniform float uAspect;
uniform float uFlash;
uniform vec2 uRes;
varying vec2 vUv;
${NOISE}
float caustic(vec2 p, float t) {
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    p += vec2(sin(p.y * 1.7 + t), cos(p.x * 1.3 - t * 0.8));
    c += 1.0 / (1.0 + 18.0 * abs(sin(p.x + p.y)));
  }
  return c / 3.0;
}
void main() {
  vec2 uv = vUv;
  float w = uWater;
  uv += w * vec2(sin(uv.y * 16.0 + uTime * 1.4), cos(uv.x * 12.0 + uTime * 1.1)) * 0.0045;
  vec2 dir = uv - 0.5;
  float ca = 0.0005 + min(abs(uVel), 3000.0) * 0.0000022 + w * 0.0025;
  vec3 col;
  col.r = texture2D(tC, uv + dir * ca * 2.0).r;
  col.g = texture2D(tC, uv).g;
  col.b = texture2D(tC, uv - dir * ca * 2.0).b;

  // underwater: murky tint + caustics + soft light shafts
  float c = caustic(vec2(uv.x * uAspect, uv.y) * 5.0, uTime * 0.6);
  float shafts = pow(max(0.0, sin((uv.x - uv.y * 0.35) * 9.0 + uTime * 0.25)), 6.0) * smoothstep(0.0, 1.0, uv.y);
  vec3 murky = col * vec3(0.78, 0.88, 0.9) + vec3(0.03, 0.065, 0.075) * (c * 0.5 + shafts * 0.6);
  col = mix(col, murky, w * 0.8);

  float v = smoothstep(1.25, 0.25, length(dir * vec2(uAspect * 0.75, 1.0)));
  col *= mix(0.42, 1.0, v);
  col += vec3(1.0, 0.55, 0.2) * uFlash * 0.6;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float g = hash12(vUv * uRes + fract(uTime * 7.3) * 100.0) - 0.5;
  gl_FragColor.rgb += g * 0.018;
  gl_FragColor.rgb *= uFade;
}
`;

export class Stage {
  constructor(canvas, { mobile }) {
    this.canvas = canvas;
    this.mobile = mobile;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    renderer.setClearColor(0x050506, 1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    this.maxDpr = mobile ? 1.5 : 2;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    // ?dpr=2 pins the render resolution (no adaptive downscaling) — handy for screenshots
    const forced = parseFloat(new URLSearchParams(location.search).get('dpr'));
    this.fixedDpr = forced > 0 ? forced : 0;
    if (this.fixedDpr) this.dpr = this.fixedDpr;
    this.state = { a: 0, b: 1, t: 0, mode: 0 };
    this.water = 1;
    this.velocity = 0;
    this.fade = 0;
    this.flash = 0;
    this.scenes = [];
    this.active = true;
    this._fpsT = 0; this._fpsN = 0; this.fps = 60;
    this._lowFor = 0;
  }

  async init(texture, onStep = () => {}, preset = null) {
    const mobile = this.mobile;
    this.money = new MoneyScene({ texture, mobile });
    onStep('money');
    await nextFrame();
    this.tunnel = new TunnelScene({ mobile });
    onStep('tunnel');
    await nextFrame();
    let car = null;
    if (preset?.model) {
      try {
        const src = mobile && preset.modelLite ? { ...preset, model: preset.modelLite } : preset;
        car = await loadGLBCar(src, (p) => onStep('model', p));
      } catch (e) {
        console.warn('[garage] model failed, using procedural M5', e);
        onStep('modelFailed');
      }
    }
    this.carIsModel = !!car;
    this.garage = new GarageScene(this.renderer, { mobile, car });
    onStep('garage');
    await nextFrame();
    // order matches scroll: hero/about/arsenal → vpn/works → garage → contact
    this.scenes = [this.money, this.tunnel, this.garage, this.money];

    const opts = { type: THREE.HalfFloatType, samples: mobile ? 0 : 4 };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtC = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });

    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.82);

    this.mixMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: mixFrag,
      uniforms: { tA: { value: null }, tB: { value: null }, uT: { value: 0 }, uMode: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: FULLSCREEN_VERT, fragmentShader: finalFrag,
      uniforms: {
        tC: { value: null }, uTime: { value: 0 }, uWater: { value: 1 }, uVel: { value: 0 }, uFade: { value: 0 },
        uAspect: { value: 1 }, uRes: { value: new THREE.Vector2() }, uFlash: { value: 0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mixMat);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // compile everything up front so the first transition doesn't hitch
    for (const s of [this.money, this.tunnel, this.garage]) {
      this.renderer.compile(s.scene, s.camera);
    }
    this.ready = true;
    onStep('compiled');
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.w = w; this.h = h;
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    const W = Math.floor(w * this.dpr), H = Math.floor(h * this.dpr);
    this.rtA?.setSize(W, H);
    this.rtB?.setSize(W, H);
    this.rtC?.setSize(W, H);
    this.bloom?.setSize(W, H);
    for (const s of new Set(this.scenes)) s.resize(w, h, this.dpr);
    if (this.mixMat) {
      this.mixMat.uniforms.uAspect.value = w / h;
      this.finalMat.uniforms.uAspect.value = w / h;
      this.finalMat.uniforms.uRes.value.set(W, H);
    }
  }

  // view: which scene indices are visible and the blend between them
  setView(a, b, t, mode) {
    this.state.a = a; this.state.b = b; this.state.t = t; this.state.mode = mode;
  }

  _adapt(dt) {
    this._fpsT += dt; this._fpsN++;
    if (this._fpsT >= 0.5) {
      this.fps = this._fpsN / this._fpsT;
      this._fpsT = 0; this._fpsN = 0;
      if (!this.fixedDpr && this.fps < 42 && this.dpr > 0.85) {
        this._lowFor++;
        if (this._lowFor >= 3) { this.dpr = Math.max(0.85, this.dpr - 0.2); this._lowFor = 0; this.resize(); }
      } else this._lowFor = 0;
    }
  }

  render(dt, t) {
    if (!this.rtA) return;
    this._adapt(dt);
    const r = this.renderer;
    const { a, b, t: k, mode } = this.state;
    const sa = this.scenes[a], sb = this.scenes[b];
    const needA = k < 1, needB = k > 0 && sb && sb !== sa;

    const updated = new Set();
    if (needA) { sa.update(dt, t); updated.add(sa); }
    if (needB && !updated.has(sb)) sb.update(dt, t);

    if (needA) { r.setRenderTarget(this.rtA); r.render(sa.scene, sa.camera); }
    if (needB) { r.setRenderTarget(this.rtB); r.render(sb.scene, sb.camera); }

    const u = this.mixMat.uniforms;
    u.tA.value = needA ? this.rtA.texture : this.rtB.texture;
    u.tB.value = needB ? this.rtB.texture : this.rtA.texture;
    u.uT.value = needA && needB ? k : 0;
    u.uMode.value = mode;
    u.uTime.value = t;
    this.quad.material = this.mixMat;
    r.setRenderTarget(this.rtC);
    r.render(this.quadScene, this.quadCam);

    const ba = sa?.bloom ?? 0.85, bb = sb?.bloom ?? ba;
    this.bloom.strength = needA && needB ? ba + (bb - ba) * k : (needA ? ba : bb);
    this.bloom.render(r, null, this.rtC, dt, false);

    const f = this.finalMat.uniforms;
    f.tC.value = this.rtC.texture;
    f.uTime.value = t;
    f.uWater.value = this.water;
    f.uVel.value = this.velocity;
    f.uFade.value = this.fade;
    f.uFlash.value = this.flash;
    this.quad.material = this.finalMat;
    r.setRenderTarget(null);
    r.render(this.quadScene, this.quadCam);
  }
}

function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }
