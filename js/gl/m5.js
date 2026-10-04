import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural BMW M5 (F90) — built from lofted cross-sections + projected decals.
// Units: meters. x → forward, y → up, z → left. Ground at y = 0.

const XF = 1.603;          // front axle
const XR = -1.379;         // rear axle
const WHEEL_R = 0.352;
const ARCH_R = 0.405;
const TRACK = 0.805;       // wheel center |z|
const HR = 0.17;           // shoulder rounding height

const S = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// monotone cubic (Fritsch–Carlson) through [x, y] pairs, x ascending
function curve(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d = [];
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

// ---------------------------------------------------------------- body profile
const topY = curve([
  [-2.485, 0.93], [-2.44, 1.0], [-2.36, 1.03], [-2.1, 1.04], [-1.75, 1.03], [-1.2, 1.005], [-0.4, 0.99],
  [0.4, 0.975], [0.85, 0.955], [1.25, 0.915], [1.7, 0.865], [2.1, 0.815], [2.3, 0.785], [2.42, 0.76], [2.485, 0.72],
]);
const sillY = curve([
  [-2.485, 0.3], [-2.35, 0.24], [-2.0, 0.215], [-1.0, 0.2], [1.0, 0.195], [1.9, 0.18], [2.3, 0.17], [2.485, 0.2],
]);
const roofH = curve([
  [-1.66, 0], [-1.55, 0.08], [-1.4, 0.2], [-1.2, 0.33], [-1.0, 0.41], [-0.8, 0.452], [-0.5, 0.476], [-0.2, 0.47],
  [0.0, 0.445], [0.2, 0.385], [0.4, 0.285], [0.6, 0.165], [0.75, 0.075], [0.86, 0],
]);
const GH_X0 = -1.66, GH_X1 = 0.86;

function archY(x) {
  let y = -1;
  for (const xc of [XF, XR]) {
    const dx = Math.abs(x - xc);
    y = Math.max(y, dx < ARCH_R ? WHEEL_R + Math.sqrt(ARCH_R * ARCH_R - dx * dx) : WHEEL_R - (dx - ARCH_R) * 14);
  }
  return y;
}
const yBot = (x) => Math.max(sillY(x), archY(x));
const noseLen = (y) => 2.485 - 0.085 * S(0.5, 0.78, y) - 0.035 * (1 - S(0.12, 0.3, y));
const tailLen = (y) => 2.475 - 0.06 * (1 - S(0.24, 0.5, y)) - 0.025 * S(0.98, 1.05, y);

function halfW(x, y) {
  const L = x >= 0 ? noseLen(y) : tailLen(y);
  const xn = Math.abs(x) / L;
  if (xn >= 1) return 0;
  const p = x >= 0 ? 5.5 : 6.5;
  let w = 0.94 * Math.pow(1 - Math.pow(xn, p), 1 / p);
  w *= 1 - 0.04 * S(0.6, 2.4, x);
  w += (0.016 * Math.exp(-(((x - XF) / 0.55) ** 2)) + 0.022 * Math.exp(-(((x - XR) / 0.6) ** 2))) * S(0.35, 0.6, y);
  w *= 1 + 0.006 * Math.exp(-(((y - 0.8) / 0.022) ** 2));
  return w * Math.min(1, xn < 0.999 ? 1 : 0);
}
const dome = (x, z) => 0.026 * S(0.95, 1.5, x) * (1 - S(2.0, 2.38, x)) * Math.exp(-((z / 0.34) ** 2));

function sectionMid(x) {
  const yT = topY(x), yB = yBot(x);
  return { yT, yB, yM: Math.max(yT - HR, yB + 0.012) };
}

function bodyPoint(x, th, out) {
  const { yT, yB, yM } = sectionMid(x);
  const c = Math.cos(th), s = Math.sin(th);
  const upper = s >= 0;
  const n = upper ? 3.0 : 7.0;
  const sz = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const sy = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  const y = upper ? yM + (yT - yM) * sy : yM + (yM - yB) * sy;
  const z = halfW(x, y) * sz;
  const yy = upper ? y + dome(x, z) * sy * sy * sy : y;
  return out.set(x, yy, z);
}

// implicit test used to project decals onto the body
function bodyF(px, py, pz) {
  if (Math.abs(px) > 2.49) return 2;
  const { yT, yB, yM } = sectionMid(px);
  if (py > yT || py < yB) return 2;
  let sy, n;
  if (py >= yM) { sy = (py - yM) / Math.max(1e-4, yT - yM); n = 3.0; }
  else { sy = (yM - py) / Math.max(1e-4, yM - yB); n = 7.0; }
  const W = halfW(px, py);
  if (W <= 1e-4) return 2;
  return Math.pow(Math.abs(pz) / W, n) + Math.pow(sy, n);
}

const _o = new THREE.Vector3();
function projectToBody(origin, dir) {
  // march then bisect
  let t0 = 0, t1 = -1;
  for (let t = 0; t < 4; t += 0.006) {
    _o.copy(origin).addScaledVector(dir, t);
    if (bodyF(_o.x, _o.y, _o.z) < 1) { t1 = t; break; }
    t0 = t;
  }
  if (t1 < 0) return null;
  for (let i = 0; i < 24; i++) {
    const tm = (t0 + t1) / 2;
    _o.copy(origin).addScaledVector(dir, tm);
    if (bodyF(_o.x, _o.y, _o.z) < 1) t1 = tm; else t0 = tm;
  }
  const p = origin.clone().addScaledVector(dir, t1);
  const e = 0.0025;
  const f = (x, y, z) => Math.min(bodyF(x, y, z), 1.6);
  const nrm = new THREE.Vector3(
    f(p.x + e, p.y, p.z) - f(p.x - e, p.y, p.z),
    f(p.x, p.y + e, p.z) - f(p.x, p.y - e, p.z),
    f(p.x, p.y, p.z + e) - f(p.x, p.y, p.z - e),
  );
  if (!(nrm.lengthSq() > 1e-12)) nrm.copy(dir).negate();
  nrm.normalize();
  if (nrm.dot(dir) > 0) nrm.negate();
  return { p, n: nrm };
}

// ---------------------------------------------------------------- greenhouse
function ghPoint(x, phi, out) {
  const yT = topY(x);
  const { yM } = sectionMid(x);
  const W = halfW(x, yT - 0.05);
  const A = W * 0.86;
  const B = roofH(x);
  const n = 2.5;
  const c = Math.cos(phi), s = Math.max(0, Math.sin(phi));
  const sz = Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  const sy = Math.pow(s, 2 / n);
  const z = A * sz * (1 - 0.1 * sy);
  const u = Math.min(1, Math.abs(z) / Math.max(W, 1e-3));
  const ySurf = yM + (yT - yM) * Math.pow(1 - Math.pow(u, 3), 1 / 3);
  return out.set(x, ySurf - 0.004 + B * sy, z);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
function ghNormal(x, phi) {
  const e = 0.002;
  ghPoint(x + e, phi, _a); ghPoint(x - e, phi, _b);
  ghPoint(x, phi + e, _c); ghPoint(x, phi - e, _d);
  const n = new THREE.Vector3().crossVectors(_a.sub(_b), _c.sub(_d)).normalize();
  const p = ghPoint(x, phi, new THREE.Vector3());
  if (n.y * (p.y - 0.8) + n.z * p.z < 0) n.negate();
  if (!(n.lengthSq() > 0.5)) n.set(0, 1, 0);
  return n;
}

// ---------------------------------------------------------------- geometry helpers
function gridGeometry(nu, nv, fn, { closeV = false, outward } = {}) {
  const pos = [];
  const uvs = [];
  const idx = [];
  const p = new THREE.Vector3();
  const cols = closeV ? nv : nv + 1;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j < cols; j++) {
      fn(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      uvs.push(i / nu, j / nv);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * cols + j;
      const b = i * cols + ((j + 1) % cols);
      const c = (i + 1) * cols + j;
      const d = (i + 1) * cols + ((j + 1) % cols);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (outward) orient(g, outward);
  return g;
}

// flip winding if the average normal disagrees with an outward hint (function of position → vector)
function orient(g, outward) {
  const n = g.attributes.normal, p = g.attributes.position;
  let score = 0;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  const step = Math.max(1, Math.floor(p.count / 200));
  for (let i = 0; i < p.count; i += step) {
    v.fromBufferAttribute(n, i);
    q.fromBufferAttribute(p, i);
    score += v.dot(outward(q));
  }
  if (score < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}

function subdivide(g) {
  const p = g.attributes.position;
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), bc = new THREE.Vector3(), ca = new THREE.Vector3();
  const push = (...vs) => vs.forEach((v) => out.push(v.x, v.y, v.z));
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    ab.addVectors(a, b).multiplyScalar(0.5); bc.addVectors(b, c).multiplyScalar(0.5); ca.addVectors(c, a).multiplyScalar(0.5);
    push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return r;
}

// project a 2D shape onto the body. plane: { o, u, v, d } (vectors); shape coords (su, sv) map to o + u*su + v*sv
function decal(shape, plane, offset = 0.003, subdiv = 3, curveSegs = 10) {
  let g = new THREE.ShapeGeometry(shape, curveSegs).toNonIndexed();
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  for (let i = 0; i < subdiv; i++) g = subdivide(g);
  const pos = g.attributes.position;
  const uvs = new Float32Array(pos.count * 2);
  const bb = new THREE.Box2();
  for (let i = 0; i < pos.count; i++) bb.expandByPoint(new THREE.Vector2(pos.getX(i), pos.getY(i)));
  const size = bb.getSize(new THREE.Vector2());
  const keep = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const su = pos.getX(i), sv = pos.getY(i);
    uvs[i * 2] = (su - bb.min.x) / size.x;
    uvs[i * 2 + 1] = (sv - bb.min.y) / size.y;
    const origin = plane.o.clone().addScaledVector(plane.u, su).addScaledVector(plane.v, sv).addScaledVector(plane.d, -1.6);
    const hit = projectToBody(origin, plane.d);
    if (!hit) { pos.setXYZ(i, origin.x, origin.y, origin.z); continue; }
    keep[i] = 1;
    const q = hit.p.addScaledVector(hit.n, offset);
    pos.setXYZ(i, q.x, q.y, q.z);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g = mergeVertices(g, 1e-5);
  g.computeVertexNormals();
  const dn = plane.d.clone().negate();
  orient(g, () => dn);
  return g;
}

function planeFor(o, d, uHint, v = new THREE.Vector3(0, 1, 0)) {
  d = d.clone().normalize();
  const u = uHint.clone().addScaledVector(d, -uHint.dot(d)).normalize();
  const vv = v.clone().addScaledVector(d, -v.dot(d)).addScaledVector(u, -v.dot(u)).normalize();
  return { o, u, v: vv, d };
}

function roundedPoly(points, radius) {
  // points: [[x,y],...] closed polygon; corners rounded with quadratic curves
  const s = new THREE.Shape();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n];
    const r = Array.isArray(radius) ? radius[i] : radius;
    const v1 = new THREE.Vector2(p0[0] - p1[0], p0[1] - p1[1]);
    const v2 = new THREE.Vector2(p2[0] - p1[0], p2[1] - p1[1]);
    const r1 = Math.min(r, v1.length() / 2), r2 = Math.min(r, v2.length() / 2);
    v1.normalize(); v2.normalize();
    const a = [p1[0] + v1.x * r1, p1[1] + v1.y * r1];
    const b = [p1[0] + v2.x * r2, p1[1] + v2.y * r2];
    if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
    s.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
  }
  s.closePath();
  return s;
}

// project a polyline in plane coords onto body → points (with offset)
function projectLine(pts2, plane, offset = 0.002) {
  const out = [];
  for (const [su, sv] of pts2) {
    const origin = plane.o.clone().addScaledVector(plane.u, su).addScaledVector(plane.v, sv).addScaledVector(plane.d, -1.6);
    const hit = projectToBody(origin, plane.d);
    if (hit) out.push(hit.p.addScaledVector(hit.n, offset));
  }
  return out;
}

function tube(points, radius, segs = 64, radial = 8, closed = false) {
  const c = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(c, segs, radius, radial, closed);
}

function placeOn(geo, p, n, up = new THREE.Vector3(0, 1, 0)) {
  // orient geometry's +z along n at point p
  const m = new THREE.Matrix4();
  const z = n.clone().normalize();
  let x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  m.makeBasis(x, y, z).setPosition(p);
  geo.applyMatrix4(m);
  return geo;
}

function mirrorZ(g) {
  const m = g.clone();
  m.scale(1, 1, -1);
  if (m.index) {
    const ix = m.index.array;
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  } else {
    const p = m.attributes.position;
    const attrs = Object.values(m.attributes);
    for (let i = 0; i < p.count; i += 3) {
      for (const at of attrs) {
        for (let k = 0; k < at.itemSize; k++) {
          const t = at.array[(i + 1) * at.itemSize + k];
          at.array[(i + 1) * at.itemSize + k] = at.array[(i + 2) * at.itemSize + k];
          at.array[(i + 2) * at.itemSize + k] = t;
        }
      }
    }
  }
  m.computeVertexNormals();
  return m;
}

function normalizeForMerge(g) {
  let r = g.index ? g.toNonIndexed() : g.clone();
  for (const k of Object.keys(r.attributes)) if (!['position', 'normal', 'uv'].includes(k)) r.deleteAttribute(k);
  if (!r.attributes.normal) r.computeVertexNormals();
  if (!r.attributes.uv) r.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(r.attributes.position.count * 2), 2));
  return r;
}

// ---------------------------------------------------------------- textures
function canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

const FONT = '"Unbounded", "Arial Black", Arial, sans-serif';

function roundelTex() {
  return canvasTex(512, 512, (g, w) => {
    const c = w / 2;
    g.clearRect(0, 0, w, w);
    const ring = (r, col) => { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fillStyle = col; g.fill(); };
    const grad = g.createLinearGradient(0, 0, w, w);
    grad.addColorStop(0, '#f4f6f8'); grad.addColorStop(0.5, '#8d9399'); grad.addColorStop(1, '#e8ebee');
    ring(c, grad);
    ring(c * 0.96, '#0a0a0c');
    ring(c * 0.64, grad);
    // quadrants
    const q = c * 0.6;
    const quad = (a0, col) => { g.beginPath(); g.moveTo(c, c); g.arc(c, c, q, a0, a0 + Math.PI / 2); g.closePath(); g.fillStyle = col; g.fill(); };
    quad(-Math.PI / 2, '#f2f4f6'); quad(0, '#1c69d4'); quad(Math.PI / 2, '#f2f4f6'); quad(Math.PI, '#1c69d4');
    // letters on ring
    g.fillStyle = '#f4f6f8';
    g.font = `700 ${Math.round(c * 0.26)}px Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const letters = ['B', 'M', 'W'];
    letters.forEach((L, i) => {
      const a = -Math.PI / 2 + (i - 1) * 0.62;
      g.save(); g.translate(c + Math.cos(a) * c * 0.8, c + Math.sin(a) * c * 0.8); g.rotate(a + Math.PI / 2); g.fillText(L, 0, 0); g.restore();
    });
  });
}

function m5BadgeTex() {
  return canvasTex(512, 200, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cols = ['#81c4ff', '#16588e', '#e7222e'];
    g.save(); g.transform(1, 0, -0.35, 1, 40, 0);
    cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(30 + i * 34, 30, 26, 140); });
    g.restore();
    const grad = g.createLinearGradient(0, 30, 0, 170);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.5, '#9aa1a8'); grad.addColorStop(0.55, '#e9edf0'); grad.addColorStop(1, '#6d737a');
    g.fillStyle = grad;
    g.font = `italic 900 150px ${FONT}`;
    g.textBaseline = 'middle';
    g.fillText('M5', 190, 104);
  });
}

function carbonTex() {
  const t = canvasTex(256, 256, (g, w) => {
    const s = 16;
    for (let y = 0; y < w; y += s) {
      for (let x = 0; x < w; x += s) {
        const k = ((x / s) + (y / s)) % 4 < 2;
        const gr = g.createLinearGradient(x, y, x + (k ? s : 0), y + (k ? 0 : s));
        gr.addColorStop(0, '#0d0e10'); gr.addColorStop(0.5, '#2a2c30'); gr.addColorStop(1, '#0d0e10');
        g.fillStyle = gr; g.fillRect(x, y, s, s);
      }
    }
  }, { repeat: true });
  t.repeat.set(10, 4);
  return t;
}

function honeycombTex() {
  const t = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#020203'; g.fillRect(0, 0, w, w);
    g.strokeStyle = '#2b2d31'; g.lineWidth = 5;
    const r = 16, hh = Math.sqrt(3) * r;
    for (let row = -1; row < 12; row++) {
      for (let col = -1; col < 12; col++) {
        const cx = col * r * 3 + (row % 2 ? r * 1.5 : 0);
        const cy = row * hh / 2;
        g.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
        g.closePath(); g.stroke();
      }
    }
  }, { repeat: true, srgb: true });
  t.repeat.set(5, 2);
  return t;
}

function letterTex(text, color = '#fff') {
  return canvasTex(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.fillStyle = color; g.font = `italic 900 92px ${FONT}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, w / 2 + 4);
  });
}

// ---------------------------------------------------------------- paints
export const PAINTS = {
  brands: { name: 'Brands Hatch Grey', color: 0x3e4349, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  sapphire: { name: 'Black Sapphire', color: 0x0a0b0f, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.02 },
  marina: { name: 'Marina Bay Blue', color: 0x0f3a80, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  frozen: { name: 'Frozen Dark Grey', color: 0x4b4f54, metalness: 0.45, roughness: 0.58, clearcoat: 0.25, clearcoatRoughness: 0.5 },
  motegi: { name: 'Motegi Red', color: 0x6d0a14, metalness: 0.5, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03 },
  frozenCsl: { name: 'Frozen Brooklyn Grey', color: 0x6b7075, metalness: 0.3, roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 },
  // G82 M4 palette
  isle: { name: 'Isle of Man Green', color: 0x0b3d2f, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.07 },
  brooklyn: { name: 'Brooklyn Grey', color: 0x7d8287, metalness: 0.35, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 },
  saopaulo: { name: 'São Paulo Yellow', color: 0xd9a400, metalness: 0.1, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.07 },
  toronto: { name: 'Toronto Red', color: 0x7a0710, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.07 },
  portimao: { name: 'Portimao Blue', color: 0x123e7c, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.07 },
};

// ---------------------------------------------------------------- build
export function buildM5() {
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color: PAINTS.brands.color, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.0 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x040405, metalness: 0.3, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04 }),
    matte: new THREE.MeshStandardMaterial({ color: 0x070708, roughness: 0.85, metalness: 0.1 }),
    honey: new THREE.MeshStandardMaterial({ map: honeycombTex(), roughness: 0.6, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0.6, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 1, roughness: 0.14 }),
    darkChrome: new THREE.MeshStandardMaterial({ color: 0x6f757c, metalness: 1, roughness: 0.2 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonTex(), color: 0x9a9a9a, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.93, metalness: 0, side: THREE.DoubleSide }),
    rim: new THREE.MeshPhysicalMaterial({ color: 0x1b1c1f, metalness: 0.9, roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.1, side: THREE.DoubleSide }),
    rimFace: new THREE.MeshPhysicalMaterial({ color: 0x2b2d31, metalness: 0.95, roughness: 0.22, clearcoat: 0.8 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x5b5e63, metalness: 0.9, roughness: 0.42 }),
    caliper: new THREE.MeshPhysicalMaterial({ color: 0x1c5fc8, metalness: 0.2, roughness: 0.32, clearcoat: 1 }),
    lamp: new THREE.MeshPhysicalMaterial({ color: 0x06080b, metalness: 0.7, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 }),
    tailHousing: new THREE.MeshPhysicalMaterial({ color: 0x2c0306, metalness: 0.3, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, emissive: 0x000000 }),
    angel: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.13, 0.15) }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.01, 0.01) }),
    roundel: new THREE.MeshStandardMaterial({ map: roundelTex(), transparent: true, roughness: 0.25, metalness: 0.5, alphaTest: 0.05 }),
    badge: new THREE.MeshStandardMaterial({ map: m5BadgeTex(), transparent: true, roughness: 0.25, metalness: 0.6, alphaTest: 0.05 }),
    caliperLogo: new THREE.MeshBasicMaterial({ map: letterTex('M'), transparent: true, depthWrite: false }),
  };

  for (const [k, m] of Object.entries(mats)) m.name = k;
  const parts = {};
  const add = (key, geo) => { (parts[key] ||= []).push(geo); };
  const addBoth = (key, geo) => { add(key, geo); add(key, mirrorZ(geo)); };

  // ---- lower body (loft)
  const stations = [];
  const NS = 150;
  for (let i = 0; i <= NS; i++) stations.push(2.485 * Math.sin(Math.PI * (i / NS - 0.5)));
  for (const xc of [XF, XR]) for (const s of [-1, 1]) for (const dd of [-0.02, -0.008, -0.002, 0.003, 0.01, 0.02]) stations.push(xc + s * (ARCH_R + dd));
  for (let x = -2.4; x <= 2.4; x += 0.05) stations.push(x);
  stations.sort((a, b) => a - b);
  const xs = stations.filter((x, i) => i === 0 || x - stations[i - 1] > 0.002);
  const NTH = 104;
  const body = gridGeometry(xs.length - 1, NTH, (u, v, out) => {
    const i = Math.round(u * (xs.length - 1));
    return bodyPoint(xs[i], -Math.PI / 2 + v * Math.PI * 2, out);
  }, { closeV: true, outward: (q) => new THREE.Vector3(q.x * 0.3, q.y - 0.55, q.z) });
  const bodyMesh = new THREE.Mesh(body, mats.paint);

  // ---- greenhouse paint shell
  const GNX = 110, GNP = 56;
  const gh = gridGeometry(GNX, GNP, (u, v, out) => ghPoint(GH_X0 + (GH_X1 - GH_X0) * u, v * Math.PI, out),
    { outward: (q) => new THREE.Vector3(0, q.y - 0.8, q.z) });
  const ghMesh = new THREE.Mesh(gh, mats.paint);

  // greenhouse patches (glass/carbon/black) defined in (x, phi) space
  const patch = (key, nu, nv, fn, off) => {
    const g = gridGeometry(nu, nv, (a, b, out) => {
      const [x, phi] = fn(a, b);
      ghPoint(x, phi, out);
      out.addScaledVector(ghNormal(x, phi), off);
      return out;
    }, { outward: (q) => new THREE.Vector3(0, q.y - 0.8, q.z) });
    add(key, g);
    return g;
  };
  const PHI_SIDE_LO = 0.075, PHI_SIDE_HI = 0.6, PHI_TOP = 0.8;
  // windshield
  patch('glass', 40, 30, (a, b) => [0.835 - a * 0.86, PHI_TOP - 0.06 + b * (Math.PI - 2 * (PHI_TOP - 0.06))], 0.003);
  // rear window
  patch('glass', 30, 30, (a, b) => [-1.63 + a * 0.67, PHI_TOP - 0.04 + b * (Math.PI - 2 * (PHI_TOP - 0.04))], 0.003);
  // carbon roof
  patch('carbon', 40, 16, (a, b) => [-0.98 + a * 0.97, PHI_TOP + 0.03 + b * (Math.PI - 2 * (PHI_TOP + 0.03))], 0.0035);
  // side windows with Hofmeister kink (left, phi near 0; right mirrored phi near PI)
  const xFrontEdge = (b) => 0.6 - b * 0.06;
  const xRearEdge = (b) => {
    if (b < 0.18) return -1.3 - (b / 0.18) * 0.13;                           // the kink
    return -1.43 + ((b - 0.18) / 0.82) * 0.46 - 0.04 * Math.sin(((b - 0.18) / 0.82) * Math.PI);
  };
  for (const side of [0, 1]) {
    const mapPhi = (phi) => (side ? Math.PI - phi : phi);
    patch('glass', 60, 14, (a, b) => {
      const phi = PHI_SIDE_LO + b * (PHI_SIDE_HI - PHI_SIDE_LO);
      return [xFrontEdge(b) + (xRearEdge(b) - xFrontEdge(b)) * a, mapPhi(phi)];
    }, 0.0035);
    // B-pillar
    patch('gloss', 4, 12, (a, b) => [-0.31 - b * 0.03 - a * 0.075, mapPhi(PHI_SIDE_LO - 0.01 + b * (PHI_SIDE_HI - PHI_SIDE_LO + 0.02))], 0.0055);
    // chrome DLO trim
    const trim = [];
    const N = 50;
    for (let i = 0; i <= N; i++) { const b = 0; const a = i / N; trim.push([xFrontEdge(b) + (xRearEdge(b) - xFrontEdge(b)) * a, PHI_SIDE_LO - 0.012]); }
    for (let i = 1; i <= 14; i++) { const b = i / 14; trim.push([xRearEdge(b) - 0.012, PHI_SIDE_LO + b * (PHI_SIDE_HI - PHI_SIDE_LO)]); }
    for (let i = 1; i <= N; i++) { const b = 1; const a = 1 - i / N; trim.push([xFrontEdge(b) + (xRearEdge(b) - xFrontEdge(b)) * a, PHI_SIDE_HI + 0.012]); }
    const tp = trim.map(([x, phi]) => ghPoint(x, mapPhi(phi), new THREE.Vector3()).addScaledVector(ghNormal(x, mapPhi(phi)), 0.004));
    add('darkChrome', tube(tp, 0.0055, 220, 6));
  }

  // ---- front: kidney grilles
  const front = planeFor(new THREE.Vector3(2.5, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1));
  const kidneyPts = [[0.05, 0.508], [0.275, 0.522], [0.292, 0.655], [0.055, 0.676]];
  const kidney = roundedPoly(kidneyPts, [0.03, 0.045, 0.04, 0.03]);
  const kGeo = decal(kidney, front, 0.004, 3);
  add('gloss', kGeo); add('gloss', mirrorZ(kGeo));
  const kOutline = kidney.getSpacedPoints(90).map((p) => [p.x, p.y]);
  const kFrame = projectLine(kOutline, front, 0.012);
  const kTube = tube(kFrame, 0.011, 160, 8, true);
  add('chrome', kTube); add('chrome', mirrorZ(kTube));
  // double slats
  for (let i = 0; i < 7; i++) {
    for (const off of [-0.006, 0.006]) {
      const zc = 0.075 + i * 0.033 + off;
      const y0 = 0.515 + (zc - 0.05) * 0.06, y1 = 0.672 - (zc - 0.05) * 0.085;
      const line = projectLine([[zc, y0 + 0.01], [zc, (y0 + y1) / 2], [zc, y1 - 0.01]], front, 0.009);
      if (line.length === 3) { const t = tube(line, 0.0035, 6, 4); add('gloss', t); add('gloss', mirrorZ(t)); }
    }
  }

  // headlights
  const hlPlane = planeFor(new THREE.Vector3(2.3, 0, 0.56), new THREE.Vector3(-1, -0.05, -0.55), new THREE.Vector3(0, 0, 1));
  const hlPts = [[-0.235, 0.648], [0.13, 0.672], [0.255, 0.7], [0.27, 0.752], [0.1, 0.748], [-0.225, 0.714]];
  const hlShape = roundedPoly(hlPts, [0.025, 0.06, 0.03, 0.03, 0.05, 0.025]);
  const hlGeo = decal(hlShape, hlPlane, 0.004, 3);
  add('lamp', hlGeo); add('lamp', mirrorZ(hlGeo));
  const lightAnchors = [];
  for (const [su, sv] of [[-0.12, 0.684], [0.06, 0.704]]) {
    const origin = hlPlane.o.clone().addScaledVector(hlPlane.u, su).addScaledVector(hlPlane.v, sv).addScaledVector(hlPlane.d, -1.6);
    const hit = projectToBody(origin, hlPlane.d);
    if (!hit) continue;
    const ringPos = hit.p.clone().addScaledVector(hit.n, 0.008);
    const ring = placeOn(new THREE.TorusGeometry(0.038, 0.0055, 8, 6).rotateZ(Math.PI / 6), ringPos, hit.n);
    add('angel', ring); add('angel', mirrorZ(ring));
    const lens = placeOn(new THREE.SphereGeometry(0.02, 16, 12).scale(1, 1, 0.5), hit.p.clone().addScaledVector(hit.n, 0.002), hit.n);
    add('chrome', lens); add('chrome', mirrorZ(lens));
    lightAnchors.push(hit.p.clone());
  }
  const brow = projectLine([[-0.2, 0.718], [-0.05, 0.728], [0.1, 0.738], [0.22, 0.744]], hlPlane, 0.007);
  if (brow.length > 2) { const t = tube(brow, 0.0045, 40, 6); add('angel', t); add('angel', mirrorZ(t)); }

  // lower intakes
  const center = roundedPoly([[-0.3, 0.255], [0.3, 0.255], [0.33, 0.39], [-0.33, 0.39]], 0.03);
  add('honey', decal(center, front, 0.004, 3));
  const sidePlane = planeFor(new THREE.Vector3(2.4, 0, 0.6), new THREE.Vector3(-1, 0, -0.25), new THREE.Vector3(0, 0, 1));
  const sideIn = roundedPoly([[-0.18, 0.235], [0.2, 0.25], [0.24, 0.47], [-0.12, 0.445]], [0.03, 0.05, 0.06, 0.03]);
  const siGeo = decal(sideIn, sidePlane, 0.004, 3);
  add('honey', siGeo); add('honey', mirrorZ(siGeo));
  const blade = projectLine([[0.03, 0.25], [0.04, 0.36], [0.05, 0.46]], sidePlane, 0.012);
  if (blade.length === 3) { const t = tube(blade, 0.008, 8, 6); add('gloss', t); add('gloss', mirrorZ(t)); }
  // splitter lip
  const lip = [];
  for (let z = -0.86; z <= 0.861; z += 0.04) lip.push([z, 0.215]);
  const lipPts = projectLine(lip, front, 0.012);
  add('gloss', tube(lipPts, 0.016, 80, 6));
  // front roundel
  const fr = projectToBody(new THREE.Vector3(3.2, 1.25, 0), new THREE.Vector3(-1, -0.75, 0).normalize());
  if (fr) add('roundel', placeOn(new THREE.CircleGeometry(0.041, 40), fr.p.clone().addScaledVector(fr.n, 0.004), fr.n));

  // ---- side: gills, skirts, handles, shut lines
  const side = planeFor(new THREE.Vector3(0, 0, 1.5), new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, 0));
  const gill = roundedPoly([[1.0, 0.668], [1.165, 0.676], [1.18, 0.738], [1.02, 0.734]], 0.012);
  const gGeo = decal(gill, side, 0.003, 3);
  add('gloss', gGeo); add('gloss', mirrorZ(gGeo));
  const gb = projectLine([[1.01, 0.703], [1.09, 0.706], [1.17, 0.708]], side, 0.006);
  if (gb.length === 3) { const t = tube(gb, 0.004, 8, 6); add('chrome', t); add('chrome', mirrorZ(t)); }
  const gBadge = projectToBody(new THREE.Vector3(1.09, 0.64, 1.5), new THREE.Vector3(0, 0, -1));
  if (gBadge) {
    const b = placeOn(new THREE.PlaneGeometry(0.09, 0.035), gBadge.p.clone().addScaledVector(gBadge.n, 0.003), gBadge.n);
    add('badge', b); add('badge', mirrorZ(b));
  }
  const skirt = roundedPoly([[-0.93, 0.205], [1.18, 0.2], [1.18, 0.285], [-0.93, 0.29]], 0.02);
  const skGeo = decal(skirt, side, 0.003, 3, 6);
  add('gloss', skGeo); add('gloss', mirrorZ(skGeo));
  for (const hx of [0.14, -0.9]) {
    const h = projectToBody(new THREE.Vector3(hx, 0.865, 1.5), new THREE.Vector3(0, 0, -1));
    if (!h) continue;
    const cap = placeOn(new THREE.CapsuleGeometry(0.011, 0.12, 4, 10).rotateZ(Math.PI / 2).scale(1, 1, 0.6), h.p.clone().addScaledVector(h.n, 0.009), h.n);
    add('chrome', cap); add('chrome', mirrorZ(cap));
  }
  const shut = [
    [[0.955, 0.3], [0.958, 0.6], [0.962, 0.94]],
    [[-0.325, 0.3], [-0.33, 0.6], [-0.335, 0.95]],
    [[-1.235, 0.955], [-1.2, 0.82], [-1.1, 0.7], [-0.99, 0.62], [-0.93, 0.5], [-0.925, 0.3]],
  ];
  for (const line of shut) {
    const dense = [];
    for (let i = 0; i < line.length - 1; i++) for (let k = 0; k < 8; k++) {
      const t = k / 8;
      dense.push([line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t]);
    }
    dense.push(line[line.length - 1]);
    const pts = projectLine(dense, side, 0.0006);
    if (pts.length > 3) { const t = tube(pts, 0.0022, 60, 4); add('matte', t); add('matte', mirrorZ(t)); }
  }
  const top = planeFor(new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1));
  const hoodLine = [];
  for (let x = 0.9; x <= 2.3; x += 0.05) hoodLine.push([x, -(0.705 - 0.06 * S(1.9, 2.32, x))]);
  const hl = projectLine(hoodLine, top, 0.0006);
  if (hl.length > 3) { const t = tube(hl, 0.0022, 60, 4); add('matte', t); add('matte', mirrorZ(t)); }

  // mirrors
  const mirrorBase = projectToBody(new THREE.Vector3(0.5, 0.935, 1.5), new THREE.Vector3(0, 0, -1));
  if (mirrorBase) {
    const cup = new THREE.LatheGeometry([
      new THREE.Vector2(0.0001, 0), new THREE.Vector2(0.03, 0.006), new THREE.Vector2(0.055, 0.025),
      new THREE.Vector2(0.07, 0.055), new THREE.Vector2(0.074, 0.085), new THREE.Vector2(0.072, 0.095),
    ], 28);
    cup.rotateZ(Math.PI / 2);          // axis → -x (front tip forward)
    cup.scale(1, 0.85, 1.45);
    cup.rotateY(0.08);
    const headC = new THREE.Vector3(0.53, mirrorBase.p.y + 0.08, mirrorBase.p.z + 0.12);
    cup.translate(headC.x + 0.045, headC.y, headC.z);
    add('paint', cup); add('paint', mirrorZ(cup));
    const glassM = new THREE.CircleGeometry(0.07, 28).scale(1.42, 0.82, 1);
    glassM.rotateY(-Math.PI / 2 + 0.08);
    glassM.translate(headC.x - 0.048, headC.y, headC.z);
    add('darkChrome', glassM); add('darkChrome', mirrorZ(glassM));
    const stem = new THREE.BoxGeometry(0.07, 0.03, 0.12);
    stem.translate(headC.x + 0.01, headC.y - 0.045, mirrorBase.p.z + 0.05);
    add('gloss', stem); add('gloss', mirrorZ(stem));
  }

  // ---- rear: taillights, exhausts, diffuser, lip, plate, badges
  const tlPlane = planeFor(new THREE.Vector3(-2.35, 0, 0.6), new THREE.Vector3(1, 0, -0.42), new THREE.Vector3(0, 0, 1));
  const tlShape = roundedPoly([[-0.31, 0.885], [0.17, 0.86], [0.235, 0.885], [0.22, 0.975], [-0.29, 0.972]], [0.015, 0.03, 0.02, 0.03, 0.015]);
  const tlGeo = decal(tlShape, tlPlane, 0.004, 3);
  add('tailHousing', tlGeo); add('tailHousing', mirrorZ(tlGeo));
  for (const [y0, x1, y1] of [[0.955, 0.13, 0.89], [0.928, 0.05, 0.896]]) {
    const L = [];
    for (let s = -0.24; s < x1 - 0.03; s += 0.03) L.push([s, y0]);
    L.push([x1 - 0.015, y0 - 0.004], [x1, y0 - 0.02]);
    for (let y = y0 - 0.035; y >= y1; y -= 0.015) L.push([x1 + 0.004, y]);
    const pts = projectLine(L, tlPlane, 0.008);
    if (pts.length > 4) { const t = tube(pts, 0.0048, 60, 6); add('led', t); add('led', mirrorZ(t)); }
  }
  const rear = planeFor(new THREE.Vector3(-2.6, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1));
  const diff = roundedPoly([[-0.78, 0.235], [0.78, 0.235], [0.8, 0.37], [-0.8, 0.37]], 0.04);
  add('gloss', decal(diff, rear, 0.004, 3));
  for (let i = -3; i <= 3; i++) {
    const fin = projectLine([[i * 0.11, 0.24], [i * 0.11, 0.3], [i * 0.11, 0.365]], rear, 0.02);
    if (fin.length === 3) add('gloss', tube(fin, 0.006, 6, 4));
  }
  const exhausts = [];
  for (const z of [0.5, 0.63]) {
    const h = projectToBody(new THREE.Vector3(-3.2, 0.3, z), new THREE.Vector3(1, 0, 0));
    if (!h) continue;
    const tip = new THREE.CylinderGeometry(0.046, 0.044, 0.14, 28, 1, true).rotateZ(Math.PI / 2);
    tip.translate(h.p.x - 0.03, 0.3, z);
    add('chrome', tip); add('chrome', mirrorZ(tip));
    const inner = new THREE.CircleGeometry(0.042, 24).rotateY(-Math.PI / 2);
    inner.translate(h.p.x - 0.06, 0.3, z);
    add('matte', inner); add('matte', mirrorZ(inner));
    const ring = new THREE.TorusGeometry(0.045, 0.004, 6, 28).rotateY(Math.PI / 2);
    ring.translate(h.p.x - 0.1, 0.3, z);
    add('chrome', ring); add('chrome', mirrorZ(ring));
    exhausts.push(new THREE.Vector3(h.p.x - 0.11, 0.3, z), new THREE.Vector3(h.p.x - 0.11, 0.3, -z));
  }
  const rr = projectToBody(new THREE.Vector3(-3.5, 0.925, 0), new THREE.Vector3(1, 0, 0));
  if (rr) add('roundel', placeOn(new THREE.CircleGeometry(0.04, 40), rr.p.clone().addScaledVector(rr.n, 0.003), rr.n));
  const rb = projectToBody(new THREE.Vector3(-3.5, 0.855, -0.47), new THREE.Vector3(1, 0, 0));
  if (rb) add('badge', placeOn(new THREE.PlaneGeometry(0.13, 0.05), rb.p.clone().addScaledVector(rb.n, 0.003), rb.n));
  // trunk lip spoiler (carbon)
  const lipShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.075, 0.0), new THREE.Vector2(0.085, 0.018), new THREE.Vector2(0.01, 0.012)]);
  const spoiler = new THREE.ExtrudeGeometry(lipShape, { depth: 1.36, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 4, steps: 30 });
  spoiler.translate(0, 0, -0.68);
  {
    const p = spoiler.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i);
      const xEdge = -2.36 + 0.04 * (z / 0.7) ** 4;
      const x = xEdge - p.getX(i);
      const { yT, yM } = sectionMid(xEdge);
      const W = halfW(xEdge, yT - 0.03);
      const u = Math.min(1, Math.abs(z) / W);
      const ySurf = yM + (yT - yM) * Math.pow(1 - Math.pow(u, 3), 1 / 3);
      p.setXYZ(i, x, ySurf - 0.006 + p.getY(i), z);
    }
    spoiler.computeVertexNormals();
  }
  add('carbon', spoiler);

  // ---- wheels
  const wheelGroup = new THREE.Group();
  const wheelPositions = [
    [XF, TRACK, 1, 0.255], [XF, -TRACK, -1, 0.255], [XR, TRACK, 1, 0.27], [XR, -TRACK, -1, 0.27],
  ];
  for (const [wx, wz, sideS, width] of wheelPositions) {
    const isFront = wx > 0;
    const w = buildWheel(width, isFront, sideS);
    const m = new THREE.Matrix4().makeRotationY(sideS > 0 ? 0 : Math.PI).setPosition(wx, WHEEL_R, wz);
    for (const [k, list] of Object.entries(w)) for (const g of list) { g.applyMatrix4(m); add(k, g); }
  }
  // arch liners + underbody
  for (const xc of [XF, XR]) {
    const liner = new THREE.CylinderGeometry(ARCH_R - 0.004, ARCH_R - 0.004, 0.42, 40, 1, true, Math.PI / 2 - 0.35, Math.PI + 0.7).rotateX(Math.PI / 2);
    liner.translate(xc, WHEEL_R, 0.74);
    add('matteDouble', liner); add('matteDouble', mirrorZ(liner));
    const back = new THREE.CircleGeometry(ARCH_R, 40, -0.35, Math.PI + 0.7);
    back.translate(xc, WHEEL_R, 0.55);
    add('matteDouble', back); add('matteDouble', mirrorZ(back));
  }
  const under = new THREE.BoxGeometry(4.5, 0.3, 1.15);
  under.translate(0, 0.33, 0);
  add('matte', under);

  // ---- assemble
  const group = new THREE.Group();
  group.add(bodyMesh, ghMesh);
  mats.matteDouble = mats.matte.clone();
  mats.matteDouble.side = THREE.DoubleSide;
  const meshes = {};
  for (const [key, list] of Object.entries(parts)) {
    const merged = mergeGeometries(list.map(normalizeForMerge), false);
    if (!merged) { console.warn('merge failed for', key); continue; }
    const mesh = new THREE.Mesh(merged, mats[key]);
    meshes[key] = mesh;
    group.add(mesh);
  }
  wheelGroup.name = 'wheels';
  group.add(wheelGroup);

  // light anchors (left side; mirrored for right)
  const headlights = lightAnchors.length ? [lightAnchors[0], lightAnchors[0].clone().setZ(-lightAnchors[0].z)] : [];

  const state = { paint: 'brands', target: new THREE.Color(PAINTS.brands.color), lights: 0 };
  function setPaint(key) {
    const p = PAINTS[key];
    if (!p) return;
    state.paint = key;
    state.target.set(p.color);
    state.pTarget = p;
  }
  function setLights(level) { state.lights = level; }
  const angelOff = new THREE.Color(0.12, 0.13, 0.15), angelOn = new THREE.Color(7, 7.6, 8.6);
  const ledOff = new THREE.Color(0.25, 0.01, 0.01), ledOn = new THREE.Color(9, 0.25, 0.18);
  let lightsS = 0;
  function update(dt) {
    const k = 1 - Math.pow(0.02, dt);
    mats.paint.color.lerp(state.target, k);
    if (state.pTarget) {
      const p = state.pTarget;
      mats.paint.metalness += (p.metalness - mats.paint.metalness) * k;
      mats.paint.roughness += (p.roughness - mats.paint.roughness) * k;
      mats.paint.clearcoat += (p.clearcoat - mats.paint.clearcoat) * k;
      mats.paint.clearcoatRoughness += (p.clearcoatRoughness - mats.paint.clearcoatRoughness) * k;
    }
    lightsS += (state.lights - lightsS) * (1 - Math.pow(0.0005, dt));
    mats.angel.color.copy(angelOff).lerp(angelOn, lightsS);
    mats.led.color.copy(ledOff).lerp(ledOn, lightsS);
    mats.tailHousing.emissive.setRGB(0.25 * lightsS, 0.0, 0.0);
  }

  const rearPoint = new THREE.Vector3(-2.75, 0.6, 0);
  return { group, mats, meshes, exhausts, headlights, rear: rearPoint, setPaint: (k) => { setPaint(k); return PAINTS[k]?.name; }, setLights, update };
}

function buildWheel(width, isFront, sideS) {
  const out = { tire: [], rim: [], rimFace: [], disc: [], caliper: [], chrome: [], roundel: [], caliperLogo: [], matte: [] };
  const w2 = width / 2;
  const prof = [
    [0.258, -w2 + 0.014], [0.29, -w2], [0.328, -w2 + 0.006], [0.346, -w2 * 0.62], [WHEEL_R, 0],
    [0.346, w2 * 0.62], [0.328, w2 - 0.006], [0.29, w2], [0.258, w2 - 0.014],
  ].map(([r, h]) => new THREE.Vector2(r, h));
  out.tire.push(new THREE.LatheGeometry(prof, 72).rotateX(Math.PI / 2));
  // barrel + lip
  const barrel = new THREE.CylinderGeometry(0.248, 0.248, width - 0.03, 48, 1, true).rotateX(Math.PI / 2);
  out.rim.push(barrel);
  out.rimFace.push(new THREE.TorusGeometry(0.252, 0.011, 8, 64).translate(0, 0, w2 - 0.012));
  // inner dark disc to hide the void
  out.matte.push(new THREE.CircleGeometry(0.25, 40).translate(0, 0, -w2 + 0.02));
  // spokes: 5 Y-pairs
  const zIn = w2 - 0.075, zOut = w2 - 0.022;
  for (let k = 0; k < 5; k++) {
    const beta = (k / 5) * Math.PI * 2 + Math.PI / 2;
    for (const s of [-1, 1]) {
      const ai = beta + s * 0.04, ao = beta + s * 0.14;
      const pi = new THREE.Vector3(Math.cos(ai) * 0.072, Math.sin(ai) * 0.072, zIn);
      const po = new THREE.Vector3(Math.cos(ao) * 0.244, Math.sin(ao) * 0.244, zOut);
      const dir = po.clone().sub(pi);
      const len = dir.length();
      dir.normalize();
      const zAxis = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, dir).normalize();
      const g = new THREE.BoxGeometry(len, 0.024, 0.03);
      // taper: narrower at hub
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const t = p.getX(i) / len + 0.5; p.setY(i, p.getY(i) * (0.75 + 0.45 * t)); }
      g.computeVertexNormals();
      g.applyMatrix4(new THREE.Matrix4().makeBasis(dir, yAxis, zAxis).setPosition(pi.clone().add(po).multiplyScalar(0.5)));
      out.rimFace.push(g);
    }
  }
  out.rimFace.push(new THREE.CylinderGeometry(0.082, 0.09, 0.05, 32).rotateX(Math.PI / 2).translate(0, 0, zIn - 0.005));
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + Math.PI / 5 + Math.PI / 2;
    out.chrome.push(new THREE.CylinderGeometry(0.009, 0.009, 0.016, 6).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.055, Math.sin(a) * 0.055, zIn + 0.025));
  }
  out.roundel.push(new THREE.CircleGeometry(0.03, 32).translate(0, 0, zIn + 0.021));
  // brakes
  out.disc.push(new THREE.CylinderGeometry(0.19, 0.19, 0.028, 56).rotateX(Math.PI / 2).translate(0, 0, w2 - 0.15));
  out.matte.push(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 32).rotateX(Math.PI / 2).translate(0, 0, w2 - 0.13));
  const a0 = isFront ? 2.35 : 0.55;
  const ac = sideS > 0 ? a0 : Math.PI - a0;
  const sector = new THREE.Shape();
  const half = 0.42;
  sector.absarc(0, 0, 0.218, ac - half, ac + half, false);
  sector.absarc(0, 0, 0.135, ac + half, ac - half, true);
  const cal = new THREE.ExtrudeGeometry(sector, { depth: 0.075, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 3, curveSegments: 24 });
  cal.translate(0, 0, w2 - 0.19);
  out.caliper.push(cal);
  const logo = new THREE.PlaneGeometry(0.05, 0.05);
  logo.rotateZ(ac - Math.PI / 2 + (sideS > 0 ? 0 : 0));
  logo.translate(Math.cos(ac) * 0.178, Math.sin(ac) * 0.178, w2 - 0.103);
  out.caliperLogo.push(logo);
  return out;
}
