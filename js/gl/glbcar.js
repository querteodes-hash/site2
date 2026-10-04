import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { PAINTS } from './m5.js';

// Loads a car model (GLB/glTF, e.g. from Sketchfab), normalizes it to real-world size
// (front → +x, wheels on y = 0) and exposes the same interface as the procedural M5.

const PAINT_RX = /paint|body|carpaint|car_paint|exterior|lack|coat|kaross/i;
const NOT_PAINT_RX = /glass|window|windshield|tire|tyre|rubber|rim|wheel|disc|brake|caliper|chrome|light|lamp|lens|interior|seat|plastic|trim|carbon|grill|grille|mirror_glass|badge|logo|plate|exhaust|black|matte|dash|engine/i;
const HEAD_RX = /head|drl|angel|front.?light|frontlamp|led_front|daytime/i;
const TAIL_RX = /tail|rear.?light|brake.?light|backlight|stop.?light|rearlamp|led_rear/i;

export async function loadGLBCar(preset, onProgress) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../../vendor/three/addons/libs/draco/gltf/', import.meta.url).href);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(preset.model, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  draco.dispose();

  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // drop baked ground/shadow planes: very flat meshes covering the whole footprint
  const full = new THREE.Box3().setFromObject(root);
  const fullSize = full.getSize(new THREE.Vector3());
  const maxDim = Math.max(fullSize.x, fullSize.y, fullSize.z);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3());
    if (s.y < maxDim * 0.01 && s.x > fullSize.x * 0.85 && s.z > fullSize.z * 0.85) o.visible = false;
  });

  // orient: longest horizontal axis → x, glTF front (+z) → +x
  const pivot = new THREE.Group();
  pivot.add(root);
  const box0 = boxOfVisible(root);
  const s0 = box0.getSize(new THREE.Vector3());
  let ry = preset.rotateY;
  if (ry == null) ry = s0.z > s0.x ? Math.PI / 2 : 0;
  if (preset.flip) ry += Math.PI;
  root.rotation.y = ry;
  root.updateMatrixWorld(true);

  // scale to real length, center, wheels on the floor
  let box = boxOfVisible(root);
  const size = box.getSize(new THREE.Vector3());
  const k = (preset.length || 4.8) / size.x;
  root.scale.multiplyScalar(k);
  root.updateMatrixWorld(true);
  box = boxOfVisible(root);
  const c = box.getCenter(new THREE.Vector3());
  root.position.x -= c.x;
  root.position.z -= c.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  box = boxOfVisible(root);

  // materials
  const matStats = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    o.frustumCulled = true;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach((m) => {
      if (!m) return;
      if ('envMapIntensity' in m) m.envMapIntensity = 1;
      const st = matStats.get(m) || { tris: 0, meshes: [] };
      st.tris += tris;
      st.meshes.push(o);
      matStats.set(m, st);
    });
  });

  const byName = (names) => [...matStats.keys()].filter((m) => names?.includes(m.name));
  const M = preset.materials || {};
  let paintMats = M.paint ? byName(M.paint) : [...matStats.keys()].filter((m) => PAINT_RX.test(m.name) && !NOT_PAINT_RX.test(m.name));
  if (!paintMats.length) {
    const cands = [...matStats.entries()]
      .filter(([m]) => m.color && !m.transparent && !NOT_PAINT_RX.test(m.name) && luminance(m.color) > 0.03)
      .sort((a, b) => b[1].tris - a[1].tris);
    if (cands.length) paintMats = [cands[0][0]];
  }
  // rebuild smooth normals on painted panels (many exported car models ship faceted/broken normals,
  // which show up as crumpled reflections on glossy paint)
  const fixed = new Set();
  const smoothIters = preset.normalSmoothing ?? 6;
  for (const m of smoothIters > 0 ? paintMats : []) {
    for (const mesh of matStats.get(m).meshes) {
      if (fixed.has(mesh.geometry)) continue;
      fixed.add(mesh.geometry);
      smoothNormals(mesh.geometry, smoothIters, THREE.MathUtils.degToRad(preset.creaseAngle ?? 40));
    }
  }

  // upgrade paint to clear-coated physical material
  const paints = paintMats.map((m) => {
    let p = m;
    if (!m.isMeshPhysicalMaterial) {
      p = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(p, m);
      p.name = m.name;
      for (const mesh of matStats.get(m).meshes) {
        if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((x) => (x === m ? p : x));
        else mesh.material = p;
      }
    }
    p.clearcoat = Math.max(p.clearcoat || 0, 1);
    p.clearcoatRoughness = 0.04;
    p.envMapIntensity = 1;
    return p;
  });
  const original = paints.map((p) => ({ color: p.color.clone(), metalness: p.metalness, roughness: p.roughness, clearcoat: p.clearcoat, clearcoatRoughness: p.clearcoatRoughness }));

  // lights
  const heads = M.head ? byName(M.head) : [], tails = M.tail ? byName(M.tail) : [];
  if (!M.head && !M.tail) {
    for (const m of matStats.keys()) {
      if (!('emissive' in m)) continue;
      if (TAIL_RX.test(m.name)) tails.push(m);
      else if (HEAD_RX.test(m.name)) heads.push(m);
    }
  }
  const prepLight = (m, col) => {
    const base = Math.min(4, m.emissiveIntensity ?? 1);
    if (m.emissive.getHex() === 0 && !m.emissiveMap) m.emissive.set(col);
    m.userData.baseEmissive = base;
    m.emissiveIntensity = base * 0.15;
  };
  heads.forEach((m) => prepLight(m, 0xe8f0ff));
  tails.forEach((m) => prepLight(m, 0xff1408));

  const group = new THREE.Group();
  group.add(pivot);

  const minX = box.min.x, maxX = box.max.x;
  const A = preset.anchors || {};
  const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  const exhausts = A.exhausts ? A.exhausts.map(v3) : [];
  if (!A.exhausts) for (const z of [0.42, 0.55]) exhausts.push(new THREE.Vector3(minX - 0.04, 0.32, z), new THREE.Vector3(minX - 0.04, 0.32, -z));
  const headlights = A.headlights ? A.headlights.map(v3) : [new THREE.Vector3(maxX - 0.22, 0.68, 0.62), new THREE.Vector3(maxX - 0.22, 0.68, -0.62)];
  const rear = A.rear ? v3(A.rear) : new THREE.Vector3(minX - 0.3, 0.6, 0);

  const state = { target: null, lights: 0 };
  let lightsS = 0;
  return {
    group,
    exhausts,
    headlights,
    rear,
    isModel: true,
    paintCount: paints.length,
    setPaint(key) {
      if (key === 'original') { state.target = 'original'; return 'Original'; }
      if (!PAINTS[key]) return null;
      state.target = PAINTS[key];
      state.color = new THREE.Color(PAINTS[key].color);
      return PAINTS[key].name;
    },
    setLights(l) { state.lights = l; },
    update(dt) {
      const kk = 1 - Math.pow(0.02, dt);
      if (state.target) {
        paints.forEach((p, i) => {
          const t = state.target === 'original' ? original[i] : state.target;
          const col = state.target === 'original' ? original[i].color : state.color;
          p.color.lerp(col, kk);
          p.metalness += (t.metalness - p.metalness) * kk;
          p.roughness += (t.roughness - p.roughness) * kk;
          p.clearcoatRoughness += (t.clearcoatRoughness - p.clearcoatRoughness) * kk;
        });
      }
      lightsS += (state.lights - lightsS) * (1 - Math.pow(0.0005, dt));
      heads.forEach((m) => { m.emissiveIntensity = m.userData.baseEmissive * (0.15 + 3.5 * lightsS); });
      tails.forEach((m) => { m.emissiveIntensity = m.userData.baseEmissive * (0.15 + 3 * lightsS); });
    },
  };
}

// Creased vertex normals + a few rounds of normal diffusion across smooth edges.
// Irons out shading ripples of low-poly bodywork without moving any vertices.
function smoothNormals(geo, iterations, crease) {
  const pos = geo.attributes.position;
  const n = pos.count;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  const tri = idx.length / 3;
  const cosC = Math.cos(crease);

  // weld by position so split seams still share neighbours
  const weld = new Int32Array(n);
  const keys = new Map();
  const b = new THREE.Box3().setFromBufferAttribute(pos);
  const q = 2e4 / Math.max(1e-6, b.getSize(new THREE.Vector3()).length());
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * q)}|${Math.round(pos.getY(i) * q)}|${Math.round(pos.getZ(i) * q)}`;
    let w = keys.get(key);
    if (w === undefined) { w = keys.size; keys.set(key, w); }
    weld[i] = w;
  }
  const W = keys.size;

  // face normals (area weighted)
  const fn = new Float32Array(tri * 3);
  const a = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const facesOf = Array.from({ length: W }, () => []);
  for (let t = 0; t < tri; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    a.fromBufferAttribute(pos, i0);
    c.fromBufferAttribute(pos, i1).sub(a);
    d.fromBufferAttribute(pos, i2).sub(a);
    c.cross(d);
    fn[t * 3] = c.x; fn[t * 3 + 1] = c.y; fn[t * 3 + 2] = c.z;
    facesOf[weld[i0]].push(t); facesOf[weld[i1]].push(t); facesOf[weld[i2]].push(t);
  }
  const unit = (t) => { const x = fn[t * 3], y = fn[t * 3 + 1], z = fn[t * 3 + 2]; const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

  // creased per-vertex normals
  const nrm = new Float32Array(n * 3);
  for (let t = 0; t < tri; t++) {
    const [ux, uy, uz] = unit(t);
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      for (const f of facesOf[weld[v]]) {
        const [fx, fy, fz] = unit(f);
        if (fx * ux + fy * uy + fz * uz < cosC) continue;
        sx += fn[f * 3]; sy += fn[f * 3 + 1]; sz += fn[f * 3 + 2];
      }
      nrm[v * 3] += sx; nrm[v * 3 + 1] += sy; nrm[v * 3 + 2] += sz;
    }
  }
  const norm = (arr) => { for (let i = 0; i < n; i++) { const l = Math.hypot(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]) || 1; arr[i * 3] /= l; arr[i * 3 + 1] /= l; arr[i * 3 + 2] /= l; } };
  norm(nrm);

  // neighbours via triangle edges
  const nb = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < tri; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    nb[i0].add(i1); nb[i0].add(i2); nb[i1].add(i0); nb[i1].add(i2); nb[i2].add(i0); nb[i2].add(i1);
  }
  let cur = nrm, next = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      let sx = cur[i * 3], sy = cur[i * 3 + 1], sz = cur[i * 3 + 2];
      for (const j of nb[i]) {
        const dot = cur[i * 3] * cur[j * 3] + cur[i * 3 + 1] * cur[j * 3 + 1] + cur[i * 3 + 2] * cur[j * 3 + 2];
        if (dot < cosC) continue;
        sx += cur[j * 3] * 0.6; sy += cur[j * 3 + 1] * 0.6; sz += cur[j * 3 + 2] * 0.6;
      }
      next[i * 3] = sx; next[i * 3 + 1] = sy; next[i * 3 + 2] = sz;
    }
    norm(next);
    [cur, next] = [next, cur];
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(cur, 3));
}

function boxOfVisible(root) {
  const box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isMesh && o.visible) box.expandByObject(o); });
  return box;
}

function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
