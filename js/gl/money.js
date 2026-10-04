import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Flying banknotes that burn as you scroll, with embers and gold dust.
// burn: 0 = all intact, ~1.3 = everything burned. Scroll-driven and reversible.

const BILL_ASPECT = 2.348;
const VALUES = [100, 2];

const billVert = /* glsl */ `
attribute float aBurnAt;
attribute float aManual;
attribute vec4 aSeed;
attribute float aVariant;
uniform float uTime;
uniform float uBurn;
varying vec2 vUv;
varying float vB;
varying vec4 vSeed;
varying float vVariant;
varying vec3 vN;
varying float vDepth;

void main() {
  vec3 p = position;
  float t = uTime * (0.7 + aSeed.x * 0.6) + aSeed.y * 6.2831;
  float b = clamp((uBurn - aBurnAt) * 3.5, 0.0, 1.0);
  b = max(b, aManual);

  float k1 = 2.6, k2 = 4.0;
  float bendAmt = (0.25 + 0.2 * sin(t * 0.6)) * (aSeed.w - 0.5) * 1.4;
  float w1 = sin(p.x * k1 + t * 1.7) * 0.07;
  float w2 = sin(p.y * k2 + t * 1.1 + aSeed.z * 4.0) * 0.03;
  float ax = abs(p.x);
  float curl = b * 0.9 * pow(ax, 2.4) + b * 0.35 * p.y * p.y;
  p.z += w1 + w2 + bendAmt * p.x * p.x + curl;

  float dzdx = cos(p.x * k1 + t * 1.7) * 0.07 * k1 + 2.0 * p.x * bendAmt + b * 0.9 * 2.4 * pow(ax, 1.4) * sign(p.x);
  float dzdy = cos(p.y * k2 + t * 1.1 + aSeed.z * 4.0) * 0.03 * k2 + b * 0.7 * p.y;
  vec3 n = normalize(vec3(-dzdx, -dzdy, 1.0));

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  vUv = uv;
  vB = b;
  vSeed = aSeed;
  vVariant = aVariant;
}
`;

const billFrag = /* glsl */ `
uniform sampler2D uTex;
uniform float uTime;
uniform float uFire;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec2 vUv;
varying float vB;
varying vec4 vSeed;
varying float vVariant;
varying vec3 vN;
varying float vDepth;
${NOISE}

void main() {
  vec2 uv = vUv;
  vec2 q = abs(uv - 0.5) * vec2(${BILL_ASPECT.toFixed(3)}, 1.0);
  vec2 c = q - vec2(${(BILL_ASPECT / 2).toFixed(3)} - 0.035, 0.5 - 0.035);
  if (length(max(c, 0.0)) > 0.035) discard;

  float n = fbm(uv * vec2(7.0, 3.0) + vSeed.zw * 37.0);
  vec2 ig = vec2(fract(vSeed.z * 7.13), fract(vSeed.w * 3.71));
  float d = length((uv - ig) * vec2(${BILL_ASPECT.toFixed(3)}, 1.0)) / 2.4;
  float field = d * 0.8 + n * 0.45;
  float e = field - vB * 1.3;
  if (vB > 0.0 && e < 0.0) discard;

  vec2 tuv = vec2(gl_FrontFacing ? uv.x : 1.0 - uv.x, uv.y * 0.5 + (vVariant < 0.5 ? 0.5 : 0.0));
  vec3 tex = texture2D(uTex, tuv).rgb;
  float lum = dot(tex, vec3(0.299, 0.587, 0.114));
  tex = mix(vec3(lum), tex, 0.85);

  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 Lkey = normalize(vec3(-0.4, 0.8, 0.6));
  vec3 Lfire = normalize(vec3(0.1, -1.0, 0.3));
  float dk = max(dot(N, Lkey), 0.0);
  float df = max(dot(N, Lfire), 0.0) + 0.25;
  vec3 light = vec3(0.13) + vec3(0.9, 0.86, 0.8) * dk * 0.7 + vec3(1.0, 0.42, 0.12) * df * (0.18 + 1.4 * uFire);
  vec3 col = tex * light;
  if (!gl_FrontFacing) col *= vec3(0.55, 0.62, 0.54);

  if (vB > 0.0) {
    float charr = 1.0 - smoothstep(0.0, 0.2, e);
    col = mix(col, vec3(0.02, 0.01, 0.005), charr * 0.96);
    float ember = 1.0 - smoothstep(0.0, 0.035, e);
    float flick = 0.7 + 0.3 * sin(uTime * 23.0 + vSeed.x * 50.0 + uv.x * 40.0);
    vec3 hot = mix(vec3(1.0, 0.14, 0.02), vec3(1.0, 0.7, 0.3), ember * ember);
    col += hot * ember * (2.5 + 6.0 * ember) * flick;
    float sp = step(0.92, vnoise(uv * 90.0 + uTime * 2.5)) * charr * (1.0 - ember);
    col += vec3(1.0, 0.35, 0.08) * sp * 2.5;
  }

  float f = smoothstep(uFogNear, uFogFar, vDepth);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

const bgFrag = /* glsl */ `
uniform float uTime;
uniform float uFire;
uniform float uPulse;
uniform float uAspect;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 uv = vUv;
  vec2 p = (uv - vec2(0.5, -0.1)) * vec2(uAspect, 1.0);
  float glow = exp(-length(p * vec2(0.9, 1.5)) * 2.2);
  float smoke = fbm(uv * vec2(3.0 * uAspect, 2.0) + vec2(uTime * 0.01, -uTime * 0.05));
  float top = smoothstep(0.4, 1.0, uv.y);
  vec3 col = vec3(0.010, 0.009, 0.010);
  col += vec3(1.0, 0.32, 0.07) * glow * (0.05 + 0.55 * uFire) * (0.55 + 0.9 * smoke);
  col += vec3(0.75, 0.6, 0.4) * smoke * smoke * 0.035 * (1.0 - top * 0.6);
  col *= 1.0 + uPulse * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

const bgVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const emberVert = /* glsl */ `
attribute float aLife;
attribute float aSize;
uniform float uPx;
varying float vLife;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uPx * (0.4 + 0.6 * aLife) / max(-mv.z, 0.1);
  vLife = aLife;
}
`;
const emberFrag = /* glsl */ `
varying float vLife;
void main() {
  if (vLife <= 0.0) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d);
  vec3 hot = mix(vec3(1.0, 0.12, 0.02), vec3(1.0, 0.75, 0.35), vLife * vLife);
  gl_FragColor = vec4(hot * (1.5 + 4.0 * vLife) * a * vLife, 1.0);
}
`;

const dustVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uPx;
uniform vec3 uCam;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * (0.05 + aSeed.x * 0.08);
  p.x += sin(t * 6.0 + aSeed.y * 30.0) * 0.6;
  float y = p.y + t * 3.0;
  p.y = uCam.y - 8.0 + mod(y - (uCam.y - 8.0), 16.0);
  p.z += cos(t * 5.0 + aSeed.z * 30.0) * 0.6;
  p.z = uCam.z + 2.0 - mod(uCam.z + 2.0 - p.z, 34.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.0 + aSeed.w * 2.0) * uPx / max(-mv.z, 0.5);
  vA = (0.35 + 0.65 * sin(uTime * (1.0 + aSeed.x * 3.0) + aSeed.y * 40.0) * 0.5 + 0.5) * smoothstep(34.0, 6.0, -mv.z);
}
`;
const dustFrag = /* glsl */ `
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA;
  gl_FragColor = vec4(vec3(1.0, 0.82, 0.5) * a * 0.9, 1.0);
}
`;

export class MoneyScene {
  constructor({ texture, mobile }) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 90);
    this.bloom = 0.9;
    this.scene.add(this.camera);
    this.mobile = mobile;
    this.count = mobile ? 46 : 96;

    this.burn = 0;        // scroll-driven
    this.travel = 0;      // camera travel 0..1
    this.water = 1;       // underwater calmness
    this.pulse = 0;       // music kick
    this.scrollVel = 0;
    this.mouse = new THREE.Vector2();
    this._mouseS = new THREE.Vector2();
    this.burnedValue = 0;
    this.onIgnite = null;

    this._initBackground();
    this._initBills(texture);
    this._initEmbers();
    this._initDust();

    this._tmpM = new THREE.Matrix4();
    this._tmpQ = new THREE.Quaternion();
    this._tmpE = new THREE.Euler();
    this._tmpV = new THREE.Vector3();
    this._tmpS = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
  }

  _initBackground() {
    const mat = new THREE.ShaderMaterial({
      vertexShader: bgVert,
      fragmentShader: bgFrag,
      uniforms: { uTime: { value: 0 }, uFire: { value: 0 }, uPulse: { value: 0 }, uAspect: { value: 1 } },
      depthWrite: false,
      depthTest: false,
    });
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.bg.position.z = -70;
    this.bg.renderOrder = -10;
    this.bg.frustumCulled = false;
    this.camera.add(this.bg);
  }

  _initBills(texture) {
    const n = this.count;
    const geo = new THREE.PlaneGeometry(1, 1 / BILL_ASPECT, 22, 8);
    const burnAt = new Float32Array(n);
    const manual = new Float32Array(n);
    const seed = new Float32Array(n * 4);
    const variant = new Float32Array(n);
    this.bills = [];
    for (let i = 0; i < n; i++) {
      burnAt[i] = 0.12 + Math.random() * 0.83;
      variant[i] = Math.random() < 0.72 ? 0 : 1;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28));
      this.bills.push({
        pos: new THREE.Vector3((Math.random() - 0.5) * 17, (Math.random() - 0.5) * 12, 4 - Math.random() * 30),
        vel: new THREE.Vector3((Math.random() - 0.5) * 0.15, -0.12 - Math.random() * 0.22, (Math.random() - 0.5) * 0.1),
        quat: q,
        spin: new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.6),
        scale: 1.25 + Math.random() * 0.8,
        phase: Math.random() * 100,
        manual: 0, manualHold: 0, igniting: false,
        b: 0,
      });
    }
    geo.setAttribute('aBurnAt', new THREE.InstancedBufferAttribute(burnAt, 1));
    geo.setAttribute('aManual', new THREE.InstancedBufferAttribute(manual, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aVariant', new THREE.InstancedBufferAttribute(variant, 1));
    this.burnAt = burnAt;
    this.variant = variant;
    this.manualAttr = geo.getAttribute('aManual');

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.billMat = new THREE.ShaderMaterial({
      vertexShader: billVert,
      fragmentShader: billFrag,
      side: THREE.DoubleSide,
      uniforms: {
        uTex: { value: texture },
        uTime: { value: 0 },
        uBurn: { value: 0 },
        uFire: { value: 0 },
        uFogColor: { value: new THREE.Color(0x070605) },
        uFogNear: { value: 9 },
        uFogFar: { value: 30 },
      },
    });
    this.mesh = new THREE.InstancedMesh(geo, this.billMat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  _initEmbers() {
    const n = this.mobile ? 320 : 900;
    this.emberN = n;
    this.embers = { pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), max: new Float32Array(n), size: new Float32Array(n) };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.embers.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.emberLifeAttr = new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLife', this.emberLifeAttr);
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.embers.size, 1));
    for (let i = 0; i < n; i++) this.embers.size[i] = 0.6 + Math.random() * 1.6;
    this.emberMat = new THREE.ShaderMaterial({
      vertexShader: emberVert, fragmentShader: emberFrag,
      uniforms: { uPx: { value: 300 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.emberPoints = new THREE.Points(geo, this.emberMat);
    this.emberPoints.frustumCulled = false;
    this.scene.add(this.emberPoints);
    this._emberCursor = 0;
  }

  _initDust() {
    const n = this.mobile ? 700 : 1800;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 2] = 4 - Math.random() * 34;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: dustVert, fragmentShader: dustFrag,
      uniforms: { uTime: { value: 0 }, uPx: { value: 300 }, uCam: { value: new THREE.Vector3() } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  spawnEmber(x, y, z, spread = 0.6, power = 1) {
    const e = this.embers;
    const i = this._emberCursor;
    this._emberCursor = (i + 1) % this.emberN;
    e.pos[i * 3] = x + (Math.random() - 0.5) * spread;
    e.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread * 0.5;
    e.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
    e.vel[i * 3] = (Math.random() - 0.5) * 0.5 * power;
    e.vel[i * 3 + 1] = (0.5 + Math.random() * 1.1) * power;
    e.vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5 * power;
    e.max[i] = 0.7 + Math.random() * 1.8;
    e.life[i] = e.max[i];
  }

  // click-to-burn; returns true when a bill caught fire
  pick(ndcX, ndcY) {
    this._ray.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hit = this._ray.intersectObject(this.mesh, false)[0];
    if (!hit || hit.instanceId == null) return false;
    const bill = this.bills[hit.instanceId];
    if (bill.b > 0.02 || bill.igniting) return false;
    bill.igniting = true;
    for (let k = 0; k < 24; k++) this.spawnEmber(hit.point.x, hit.point.y, hit.point.z, 0.25, 1.6);
    if (this.onIgnite) this.onIgnite(VALUES[this.variant[hit.instanceId]]);
    return true;
  }

  igniteAll() {
    let n = 0;
    for (const bl of this.bills) {
      if (bl.b > 0.02 || bl.igniting) continue;
      bl.igniting = true;
      bl.manual = -Math.random() * 1.4;
      n++;
    }
    return n;
  }

  rain(seconds = 6) { this.rainT = seconds; }

  resize(w, h, dpr) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dist = 70;
    const hh = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist;
    this.bg.scale.set(hh * this.camera.aspect * 1.05, hh * 1.05, 1);
    this.bg.material.uniforms.uAspect.value = this.camera.aspect;
    const px = h * dpr * 0.5;
    this.emberMat.uniforms.uPx.value = px * 0.06;
    this.dustMat.uniforms.uPx.value = px * 0.035;
  }

  update(dt, t) {
    const ts = 1 - 0.55 * this.water;
    const st = t * (0.6 + 0.4 * ts);

    // camera: dolly through the bills
    this._mouseS.lerp(this.mouse, 1 - Math.pow(0.001, dt));
    const cam = this.camera;
    const tz = 7 - this.travel * 19;
    cam.position.set(this._mouseS.x * 0.7 + Math.sin(t * 0.13) * 0.25, -this._mouseS.y * 0.45 - this.travel * 0.8 + Math.sin(t * 0.17) * 0.12, tz);
    cam.lookAt(this._mouseS.x * 0.2, -this.travel * 1.2, tz - 10);
    cam.rotation.z += Math.sin(t * 0.21) * 0.015 + this._mouseS.x * 0.02;

    const burn = this.burn;
    let fire = 0;
    let burned = 0;
    let manualDirty = false;
    const camZ = cam.position.z, camY = cam.position.y;
    const wind = THREE.MathUtils.clamp(this.scrollVel * 0.0035, -2.5, 2.5);
    this.rainT = Math.max(0, (this.rainT || 0) - dt);
    const fall = this.rainT > 0 ? 4 : 1;
    const mx = this._mouseS.x, my = this._mouseS.y;
    const pv = this._tmpV;

    for (let i = 0; i < this.count; i++) {
      const bl = this.bills[i];
      // physics
      bl.pos.x += (bl.vel.x + Math.sin(st * 0.5 + bl.phase) * 0.12) * dt * ts;
      bl.pos.y += (bl.vel.y * fall + wind) * dt * (0.5 + ts * 0.5);
      bl.pos.z += (bl.vel.z + Math.cos(st * 0.4 + bl.phase) * 0.08) * dt * ts;
      this._tmpE.set(bl.spin.x * dt * ts, bl.spin.y * dt * ts, bl.spin.z * dt * ts);
      this._tmpQ.setFromEuler(this._tmpE);
      bl.quat.multiply(this._tmpQ);

      // cursor repel (screen-space)
      pv.copy(bl.pos).project(cam);
      const dx = pv.x - mx, dy = pv.y - my;
      const d2 = dx * dx + dy * dy;
      if (pv.z < 1 && d2 < 0.03) {
        const f = (0.03 - d2) * 40 * dt;
        bl.pos.x += dx * f * 4;
        bl.pos.y += dy * f * 3;
      }

      // wrap around camera volume
      if (bl.pos.y < camY - 7.5) bl.pos.y += 15;
      else if (bl.pos.y > camY + 7.5) bl.pos.y -= 15;
      if (bl.pos.z > camZ + 2) bl.pos.z -= 31;
      else if (bl.pos.z < camZ - 29) bl.pos.z += 31;
      if (bl.pos.x > 10) bl.pos.x -= 20; else if (bl.pos.x < -10) bl.pos.x += 20;

      // manual ignite
      if (bl.igniting) {
        bl.manual = Math.min(1, bl.manual + dt / 1.7);
        if (bl.manual > 0 && bl.manual < 0.97 && Math.random() < dt * 30) this.spawnEmber(bl.pos.x, bl.pos.y, bl.pos.z, bl.scale * 0.7, 1);
        if (bl.manual >= 1) {
          bl.manualHold += dt;
          if (bl.manualHold > 0.4) {
            bl.igniting = false; bl.manual = 0; bl.manualHold = 0;
            bl.pos.set((Math.random() - 0.5) * 16, camY + 7, camZ - 6 - Math.random() * 16);
          }
        }
        this.manualAttr.array[i] = Math.max(0, bl.manual);
        manualDirty = true;
      }

      const b = Math.max(THREE.MathUtils.clamp((burn - this.burnAt[i]) * 3.5, 0, 1), Math.max(0, bl.manual));
      bl.b = b;
      if (b >= 0.999) burned += VALUES[this.variant[i]];
      if (b > 0.0 && b < 0.97) {
        fire += 1;
        if (Math.random() < dt * 34) {
          const s = bl.scale;
          this.spawnEmber(bl.pos.x, bl.pos.y, bl.pos.z, s * 0.7, 1);
        }
      }

      this._tmpS.set(bl.scale, bl.scale, bl.scale);
      this._tmpM.compose(bl.pos, bl.quat, this._tmpS);
      this.mesh.setMatrixAt(i, this._tmpM);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (manualDirty) this.manualAttr.needsUpdate = true;
    this.burnedValue = burned;

    // ambient embers once things are on fire
    const fireLevel = Math.min(1, fire / (this.count * 0.15));
    this._fire = THREE.MathUtils.lerp(this._fire || 0, fireLevel, 1 - Math.pow(0.05, dt));
    if (burn > 0.05 && Math.random() < dt * 20 * this._fire) {
      this.spawnEmber((Math.random() - 0.5) * 14, camY - 5, camZ - 4 - Math.random() * 14, 2, 1.4);
    }

    // embers integrate
    const e = this.embers;
    const life = this.emberLifeAttr.array;
    for (let i = 0; i < this.emberN; i++) {
      if (e.life[i] <= 0) { life[i] = 0; continue; }
      e.life[i] -= dt;
      const k = i * 3;
      e.vel[k] += Math.sin(t * 3 + i) * 0.6 * dt;
      e.vel[k + 2] += Math.cos(t * 2.3 + i * 1.7) * 0.6 * dt;
      e.vel[k + 1] += 0.3 * dt;
      e.pos[k] += e.vel[k] * dt;
      e.pos[k + 1] += (e.vel[k + 1] + wind * 0.5) * dt;
      e.pos[k + 2] += e.vel[k + 2] * dt;
      life[i] = Math.max(0, e.life[i] / e.max[i]);
    }
    this.emberPoints.geometry.attributes.position.needsUpdate = true;
    this.emberLifeAttr.needsUpdate = true;

    // uniforms
    const u = this.billMat.uniforms;
    u.uTime.value = st;
    u.uBurn.value = burn;
    u.uFire.value = this._fire;
    this.bg.material.uniforms.uTime.value = t;
    this.bg.material.uniforms.uFire.value = this._fire * 0.85 + this.pulse * 0.1;
    this.bg.material.uniforms.uPulse.value = this.pulse;
    this.dustMat.uniforms.uTime.value = t;
    this.dustMat.uniforms.uCam.value.copy(cam.position);
  }
}
