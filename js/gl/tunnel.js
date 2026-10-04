import * as THREE from 'three';

// VPN scene: flight through an encrypted hex tunnel, then a dotted globe with node links.

const TUNNEL_LEN = 112;
const RING_STEP = 1.4;
const R = 2.9;
const GLOBE_R = 3.2;
const GLOBE_Z = -128;

const NODES = [
  ['FRA-01', 50.11, 8.68],
  ['AMS-01', 52.37, 4.9],
  ['HEL-01', 60.17, 24.94],
  ['STO-01', 59.33, 18.07],
  ['WAW-01', 52.23, 21.01],
  ['IST-01', 41.01, 28.98],
  ['TYO-01', 35.68, 139.69],
];

// tiny 3D value noise for the globe "landmass" mask
function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(xf), v = s(yf), w = s(zf);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
    l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm3(x, y, z) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) { v += a * noise3(x, y, z); x *= 2.02; y *= 2.02; z *= 2.02; a *= 0.5; }
  return v;
}

function latLon(lat, lon, r) {
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta));
}

const barVert = /* glsl */ `
attribute float aZ;
attribute float aHue;
uniform float uTime;
uniform float uCamZ;
varying float vI;
varying float vHue;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  float dz = abs(wp.z - uCamZ);
  float wave = smoothstep(0.9, 1.0, fract(aZ * 0.045 - uTime * 0.35));
  vI = (0.22 + 1.7 * wave) * smoothstep(55.0, 4.0, dz) * smoothstep(0.0, 2.0, dz);
  vHue = aHue;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const barFrag = /* glsl */ `
varying float vI;
varying float vHue;
void main() {
  vec3 cyan = vec3(0.35, 0.94, 1.0);
  vec3 gold = vec3(1.0, 0.75, 0.38);
  gl_FragColor = vec4(mix(cyan, gold, vHue) * vI * 0.85, 1.0);
}
`;

const streakVert = /* glsl */ `
attribute vec4 aData; // angle, z0, speed, hue
uniform float uTime;
uniform float uCamZ;
uniform float uWarp;
varying float vI;
varying float vHue;
varying float vT;
void main() {
  float ang = aData.x;
  float z = mod(aData.y + uTime * aData.z * (1.0 + uWarp * 3.0), ${TUNNEL_LEN.toFixed(1)}) - ${TUNNEL_LEN.toFixed(1)} + 6.0;
  vec3 p = position;
  p.z *= 1.0 + uWarp * 4.0;
  float r = ${(R * 0.93).toFixed(3)};
  vec3 wp = vec3(cos(ang) * r + p.x, sin(ang) * r + p.y, z + p.z);
  float dz = abs(wp.z - uCamZ);
  vI = smoothstep(50.0, 3.0, dz);
  vHue = aData.w;
  vT = position.z + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const streakFrag = /* glsl */ `
varying float vI;
varying float vHue;
varying float vT;
void main() {
  vec3 c = mix(vec3(0.4, 0.95, 1.0), vec3(1.0, 1.0, 1.0), vHue);
  gl_FragColor = vec4(c * vI * (0.25 + 2.2 * vT), 1.0);
}
`;

const dotVert = /* glsl */ `
attribute float aLand;
uniform float uPx;
uniform float uTime;
varying float vA;
varying float vLand;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * (aLand > 0.5 ? 1.0 : 0.6) / -mv.z;
  vec3 wn = normalize(mat3(modelMatrix) * normalize(position));
  vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  vA = smoothstep(-0.1, 0.5, dot(wn, toCam));
  vLand = aLand;
}
`;
const dotFrag = /* glsl */ `
varying float vA;
varying float vLand;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 c = vLand > 0.5 ? vec3(0.45, 0.92, 1.0) * 1.3 : vec3(0.2, 0.45, 0.6) * 0.45;
  gl_FragColor = vec4(c * vA, 1.0);
}
`;

const atmoVert = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const atmoFrag = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(vN, vV)), 3.0);
  gl_FragColor = vec4(vec3(0.3, 0.85, 1.0) * f * 1.6, 1.0);
}
`;

const arcVert = /* glsl */ `
varying float vU;
void main() { vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const arcFrag = /* glsl */ `
uniform float uTime;
uniform float uOffset;
uniform float uShow;
varying float vU;
void main() {
  float head = fract(uTime * 0.35 + uOffset);
  float d = head - vU;
  float trail = d > 0.0 ? exp(-d * 9.0) : 0.0;
  float base = 0.18;
  float vis = step(vU, uShow);
  vec3 c = vec3(0.4, 0.95, 1.0) * (base + trail * 4.0) + vec3(1.0) * pow(trail, 8.0) * 3.0;
  gl_FragColor = vec4(c * vis, 1.0);
}
`;

export class TunnelScene {
  constructor({ mobile }) {
    this.mobile = mobile;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x010305);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    this.bloom = 0.7;
    this.p = 0;        // vpn progress
    this.works = 0;    // works progress
    this.warp = 0;
    this.pulse = 0;
    this.mouse = new THREE.Vector2();
    this._m = new THREE.Vector2();
    this.portrait = false;

    this._buildTunnel();
    this._buildGlobe();
    this._buildStars();
  }

  _buildTunnel() {
    const rings = Math.floor(TUNNEL_LEN / RING_STEP);
    const n = rings * 6;
    const geo = new THREE.BoxGeometry(1, 0.022, 0.022);
    const aZ = new Float32Array(n);
    const aHue = new Float32Array(n);
    const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
      vertexShader: barVert, fragmentShader: barFrag,
      uniforms: { uTime: { value: 0 }, uCamZ: { value: 0 } },
    }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const side = R; // hexagon side == circumradius
    let k = 0;
    for (let r = 0; r < rings; r++) {
      const z = 4 - r * RING_STEP;
      const twist = r * 0.045;
      const gold = Math.random() < 0.06 ? 1 : 0;
      for (let e = 0; e < 6; e++) {
        const a0 = twist + (e / 6) * Math.PI * 2;
        const a1 = twist + ((e + 1) / 6) * Math.PI * 2;
        p.set((Math.cos(a0) + Math.cos(a1)) * 0.5 * R, (Math.sin(a0) + Math.sin(a1)) * 0.5 * R, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), (a0 + a1) * 0.5 + Math.PI / 2);
        s.set(side * (0.86 + Math.random() * 0.12), 1, 1);
        m.compose(p, q, s);
        mesh.setMatrixAt(k, m);
        aZ[k] = z;
        aHue[k] = gold;
        k++;
      }
    }
    geo.setAttribute('aZ', new THREE.InstancedBufferAttribute(aZ, 1));
    geo.setAttribute('aHue', new THREE.InstancedBufferAttribute(aHue, 1));
    mesh.frustumCulled = false;
    this.bars = mesh;
    this.scene.add(mesh);

    // data streaks
    const sn = this.mobile ? 140 : 320;
    const sgeo = new THREE.BoxGeometry(0.018, 0.018, 1.6);
    const data = new Float32Array(sn * 4);
    for (let i = 0; i < sn; i++) {
      data[i * 4] = Math.random() * Math.PI * 2;
      data[i * 4 + 1] = Math.random() * TUNNEL_LEN;
      data[i * 4 + 2] = 6 + Math.random() * 18;
      data[i * 4 + 3] = Math.random() < 0.2 ? 1 : 0;
    }
    sgeo.setAttribute('aData', new THREE.InstancedBufferAttribute(data, 4));
    this.streakMat = new THREE.ShaderMaterial({
      vertexShader: streakVert, fragmentShader: streakFrag,
      uniforms: { uTime: { value: 0 }, uCamZ: { value: 0 }, uWarp: { value: 0 } },
    });
    const streaks = new THREE.InstancedMesh(sgeo, this.streakMat, sn);
    streaks.frustumCulled = false;
    this.scene.add(streaks);
  }

  _buildGlobe() {
    const g = new THREE.Group();
    g.position.set(0, 0, GLOBE_Z);
    g.rotation.set(0.38, 0, 0.12);
    this.globe = g;
    this.scene.add(g);
    const spin = new THREE.Group();
    this.spin = spin;
    g.add(spin);

    // occluder
    spin.add(new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 0.985, 48, 32), new THREE.MeshBasicMaterial({ color: 0x020507 })));

    // dots
    const N = this.mobile ? 5000 : 11000;
    const pos = [];
    const land = [];
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = golden * i;
      const x = Math.cos(th) * r, z = Math.sin(th) * r;
      const v = fbm3(x * 1.9 + 3.1, y * 1.9 + 1.7, z * 1.9 + 8.3);
      const isLand = v > 0.53 ? 1 : 0;
      if (!isLand && i % 3 !== 0) continue;
      pos.push(x * GLOBE_R, y * GLOBE_R, z * GLOBE_R);
      land.push(isLand);
    }
    const dgeo = new THREE.BufferGeometry();
    dgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    dgeo.setAttribute('aLand', new THREE.Float32BufferAttribute(land, 1));
    this.dotMat = new THREE.ShaderMaterial({ vertexShader: dotVert, fragmentShader: dotFrag, uniforms: { uPx: { value: 30 }, uTime: { value: 0 } } });
    spin.add(new THREE.Points(dgeo, this.dotMat));

    // atmosphere
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(GLOBE_R * 1.13, 48, 32), new THREE.ShaderMaterial({
      vertexShader: atmoVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    g.add(atmo);
    // orbit rings
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(GLOBE_R * (1.35 + i * 0.22), 0.004, 4, 180),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.9, 1.0).multiplyScalar(i ? 0.25 : 0.45) }),
      );
      ring.rotation.x = Math.PI / 2 + (i ? 0.3 : -0.2);
      ring.rotation.y = i ? 0.4 : -0.1;
      g.add(ring);
      (this.rings ||= []).push(ring);
    }

    // nodes + arcs
    this.nodeMeshes = [];
    this.arcMats = [];
    const hub = latLon(NODES[0][1], NODES[0][2], GLOBE_R);
    const nodeGeo = new THREE.SphereGeometry(0.032, 12, 8);
    const pulseGeo = new THREE.RingGeometry(0.045, 0.055, 32);
    NODES.forEach(([, lat, lon], i) => {
      const p = latLon(lat, lon, GLOBE_R * 1.003);
      const dot = new THREE.Mesh(nodeGeo, new THREE.MeshBasicMaterial({ color: i === 0 ? new THREE.Color(3, 2.2, 1.1) : new THREE.Color(1.6, 3.2, 3.6) }));
      dot.position.copy(p);
      spin.add(dot);
      const pulse = new THREE.Mesh(pulseGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.6, 2.0), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
      pulse.position.copy(p);
      pulse.lookAt(p.clone().multiplyScalar(2));
      pulse.userData.phase = i * 0.37;
      spin.add(pulse);
      this.nodeMeshes.push(pulse);
      if (i === 0) return;
      const mid = hub.clone().add(p).multiplyScalar(0.5);
      const dist = hub.distanceTo(p);
      mid.normalize().multiplyScalar(GLOBE_R * (1 + 0.25 + dist * 0.12));
      const curve = new THREE.QuadraticBezierCurve3(hub, mid, p);
      const mat = new THREE.ShaderMaterial({
        vertexShader: arcVert, fragmentShader: arcFrag,
        uniforms: { uTime: { value: 0 }, uOffset: { value: Math.random() }, uShow: { value: 0 } },
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      this.arcMats.push(mat);
      spin.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.009, 6, false), mat));
    });
    spin.rotation.y = -2.0;
  }

  _buildStars() {
    const n = this.mobile ? 800 : 2000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(140 + Math.random() * 80);
      pos.set([v.x, v.y, v.z + GLOBE_Z], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color(0.6, 0.8, 1.0), size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false }));
    this.scene.add(this.stars);
  }

  resize(w, h, dpr) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.portrait = w / h < 0.9;
    this.dotMat.uniforms.uPx.value = h * dpr * 0.02;
  }

  update(dt, t) {
    const S = THREE.MathUtils.smoothstep;
    const p = this.p;
    this._m.lerp(this.mouse, 1 - Math.pow(0.002, dt));
    const cam = this.camera;

    // flight (0..0.5) through tunnel, exit (0.5..0.64) to globe
    const fly = S(p, 0.0, 0.5);
    const exit = S(p, 0.46, 0.66);
    const zTunnel = 4 - fly * (TUNNEL_LEN - 8);
    const globeView = this.portrait
      ? new THREE.Vector3(0, -1.6, GLOBE_Z + 17)
      : new THREE.Vector3(-5.2, 0.3, GLOBE_Z + 15);
    const tunnelPos = new THREE.Vector3(Math.sin(t * 0.7) * 0.15, Math.cos(t * 0.5) * 0.12, zTunnel);
    cam.position.lerpVectors(tunnelPos, globeView, exit);

    // works: pull back
    const wk = S(this.works, 0, 1);
    cam.position.z += wk * 7;
    cam.position.y += wk * 1.2;

    cam.position.x += this._m.x * 0.5;
    cam.position.y += -this._m.y * 0.35;
    const look = new THREE.Vector3().lerpVectors(
      new THREE.Vector3(0, 0, zTunnel - 20),
      new THREE.Vector3(this.portrait ? 0 : -5.2 + wk * 5.2, this.portrait ? 0.6 : 0.1, GLOBE_Z),
      exit,
    );
    cam.lookAt(look);
    cam.rotation.z += (1 - exit) * (fly * 1.6 + Math.sin(t * 0.4) * 0.05);

    // warp effect: fov kick during flight
    const flying = fly > 0.001 && fly < 0.999 ? 1 : 0;
    this.warp = THREE.MathUtils.lerp(this.warp, flying * Math.min(1, Math.abs(this.speed || 0) * 0.004), 1 - Math.pow(0.02, dt));
    cam.fov = 60 + this.warp * 18 - exit * 18;
    cam.updateProjectionMatrix();

    this.bars.material.uniforms.uTime.value = t;
    this.bars.material.uniforms.uCamZ.value = cam.position.z;
    this.streakMat.uniforms.uTime.value = t;
    this.streakMat.uniforms.uCamZ.value = cam.position.z;
    this.streakMat.uniforms.uWarp.value = this.warp;

    // globe
    this.spin.rotation.y += dt * (0.06 + this.pulse * 0.08);
    this.globe.rotation.x = 0.38 + this._m.y * 0.1;
    const show = S(p, 0.55, 0.9);
    this.arcMats.forEach((m, i) => {
      m.uniforms.uTime.value = t;
      m.uniforms.uShow.value = THREE.MathUtils.clamp(show * 1.4 - i * 0.06, 0, 1);
    });
    this.nodeMeshes.forEach((m) => {
      const k = (t * 0.6 + m.userData.phase) % 1;
      m.scale.setScalar(1 + k * 2.2);
      m.material.opacity = (1 - k) * 0.7;
    });
    this.rings.forEach((r, i) => { r.rotation.z += dt * (i ? -0.05 : 0.08); });
  }
}
