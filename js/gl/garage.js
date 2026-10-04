import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { buildM5 } from './m5.js';

// Dark detailing studio with a hex-light ceiling, glossy floor and the M5.

const floorShader = {
  name: 'GarageFloor',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uGlow: { value: 0 },
    uTail: { value: 0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vW;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 w = modelMatrix * vec4(position, 1.0);
      vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uGlow;
    uniform float uTail;
    varying vec4 vUv;
    varying vec3 vW;
    float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
    // distance to the nearest edge of a hexagonal tile grid
    float hexEdge(vec2 p) {
      const vec2 s = vec2(1.0, 1.7320508);
      vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
      vec4 hp = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
      vec2 q = dot(hp.xy, hp.xy) < dot(hp.zw, hp.zw) ? hp.xy : hp.zw;
      q = abs(q);
      return 0.5 - max(dot(q, s * 0.5), q.x);
    }
    void main() {
      float dist = length(vW.xz);
      vec3 r = vec3(0.0);
    #ifndef NO_REFLECT
      vec2 uv = vUv.xy / vUv.w;
      float blur = 0.0025 + dist * 0.0007;
      r = texture2D(tDiffuse, uv).rgb * 0.2;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785 + h(vW.xz * 13.0) * 0.6;
        r += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * blur).rgb * 0.1;
      }
    #endif
      float fade = exp(-dist * dist / 22.0);
      float pool = exp(-dist * dist / 14.0);
      vec3 base = color * (0.35 + 1.4 * pool) + vec3(0.03, 0.03, 0.034) * pool;
      float he = hexEdge(vW.xz / 1.3);
      float fw = fwidth(he);
      float seam = (1.0 - smoothstep(0.0, max(0.012, fw * 1.5), he)) * (1.0 - smoothstep(0.01, 0.04, fw));
      base += vec3(0.05, 0.05, 0.055) * seam * exp(-dist * dist / 70.0);
      // headlight pool on the floor, in front of the car
      vec2 hp = vW.xz - vec2(5.2, 0.0);
      base += vec3(0.95, 0.97, 1.0) * uGlow * 0.55 * exp(-dot(hp * vec2(0.28, 0.55), hp * vec2(0.28, 0.55)));
      vec2 tp = vW.xz - vec2(-3.1, 0.0);
      base += vec3(1.0, 0.04, 0.02) * uTail * 0.25 * exp(-dot(tp * vec2(0.6, 0.5), tp * vec2(0.6, 0.5)));
      gl_FragColor = vec4(base + r * 0.3 * fade, 1.0);
    }
  `,
};

function hexGrid(radius, cols, rows, barW, barH, mat) {
  const pts = [];
  const hh = Math.sqrt(3) * radius;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = (c - (cols - 1) / 2) * radius * 1.5 * 1.08;
      const cz = (r - (rows - 1) / 2) * hh * 1.08 + (c % 2 ? hh * 0.54 : 0);
      pts.push([cx, cz]);
    }
  }
  const n = pts.length * 6;
  const geo = new THREE.BoxGeometry(1, barH, barW);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let k = 0;
  for (const [cx, cz] of pts) {
    for (let e = 0; e < 6; e++) {
      const a0 = (e / 6) * Math.PI * 2, a1 = ((e + 1) / 6) * Math.PI * 2;
      p.set(cx + (Math.cos(a0) + Math.cos(a1)) * 0.5 * radius, 0, cz + (Math.sin(a0) + Math.sin(a1)) * 0.5 * radius);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -((a0 + a1) / 2 + Math.PI / 2));
      s.set(radius * 0.9, 1, 1);
      m.compose(p, q, s);
      mesh.setMatrixAt(k++, m);
    }
  }
  return mesh;
}

function flameTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(160,200,255,0.95)');
  gr.addColorStop(0.35, 'rgba(255,170,60,0.85)');
  gr.addColorStop(0.7, 'rgba(255,60,10,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 64, 10, 128, 64, 128);
  gr.addColorStop(0, 'rgba(0,0,0,0.95)');
  gr.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(c);
}

const beamVert = /* glsl */ `
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  vY = uv.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;
const beamFrag = /* glsl */ `
uniform float uOn;
varying float vY;
varying vec3 vN;
varying vec3 vV;
void main() {
  float edge = pow(abs(dot(vN, vV)), 1.5);
  float a = vY * vY * edge * uOn * 0.22;
  gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
}
`;

export class GarageScene {
  constructor(renderer, { mobile, car }) {
    this.mobile = mobile;
    this._prebuilt = car;
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030304);
    this.scene.fog = new THREE.Fog(0x030304, 11, 26);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 80);
    this.bloom = 0.5;
    this.p = 0;
    this.mouse = new THREE.Vector2();
    this._m = new THREE.Vector2();
    this.drag = 0;          // user orbit offset (radians)
    this._dragV = 0;
    this.rpm = 0;
    this.throttle = 0;
    this.running = false;
    this.lights = 0;
    this._shake = 0;
    this._flash = 0;
    this.portrait = false;

    this._buildEnv();
    this._buildRoom();
    this._buildCar();
    this._buildFx();
  }

  _buildEnv() {
    // studio used only for reflections
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x000000);
    // photo-studio gradient: bright ceiling → dim horizon → dark floor, so glossy paint
    // shows smooth gradients instead of black voids
    env.add(new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vP; void main(){
        float h = normalize(vP).y;
        vec3 c = mix(vec3(0.05, 0.05, 0.055), vec3(0.32, 0.32, 0.34), smoothstep(-0.05, 0.85, h));
        c *= mix(0.25, 1.0, smoothstep(-0.4, 0.0, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
    })));
    const hexMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.1, 1.15) });
    const hex = hexGrid(0.85, 11, 9, 0.12, 0.06, hexMat);
    hex.position.y = 4.4;
    env.add(hex);
    // big soft overhead box: broad highlights that show the body shape
    const soft = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.7), side: THREE.DoubleSide }));
    soft.rotation.x = Math.PI / 2;
    soft.position.y = 4.2;
    env.add(soft);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.95) });
    for (const z of [-7, 7]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 0.5), strip);
      s.position.set(0, 1.6, z);
      s.lookAt(0, 1.6, 0);
      env.add(s);
    }
    const warm = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.48, 0.28) }));
    warm.position.set(8, 2, 0);
    warm.lookAt(0, 1, 0);
    env.add(warm);
    const cool = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.34, 0.6) }));
    cool.position.set(-8, 2, 0);
    cool.lookAt(0, 1, 0);
    env.add(cool);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.012, 0.014) }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.6;
    env.add(floor);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(env, 0.05);
    this.scene.environment = this.envRT.texture;
    pmrem.dispose();
  }

  _buildRoom() {
    const hexMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.25, 1.25, 1.3), fog: false });
    const hex = hexGrid(0.85, 11, 9, 0.09, 0.05, hexMat);
    hex.position.y = 5;
    this.scene.add(hex);
    this.hex = hex;

    const size = 60;
    if (!this.mobile) {
      this.floor = new Reflector(new THREE.PlaneGeometry(size, size), {
        shader: floorShader,
        color: 0x08080a,
        textureWidth: 640,
        textureHeight: 640,
        clipBias: 0.003,
      });
    } else {
      // phones: same dark hex-tiled floor, without the extra reflection pass
      this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.ShaderMaterial({
        defines: { NO_REFLECT: '' },
        uniforms: {
          color: { value: new THREE.Color(0x060608) },
          tDiffuse: { value: null },
          textureMatrix: { value: new THREE.Matrix4() },
          uGlow: { value: 0 },
          uTail: { value: 0 },
        },
        vertexShader: floorShader.vertexShader,
        fragmentShader: floorShader.fragmentShader,
      }));
    }
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 2.9), new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.95, color: 0x000000 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.003;
    this.scene.add(shadow);

    // direct lights to add contact definition
    const key = new THREE.DirectionalLight(0xffffff, 0.7);
    key.position.set(2, 6, 3);
    this.scene.add(key);
  }

  _buildCar() {
    const car = this._prebuilt || buildM5();
    this.car = car;
    this.carRoot = new THREE.Group();
    this.carRoot.add(car.group);
    this.scene.add(this.carRoot);

    // headlight beams + spotlights
    this.beams = [];
    this.spots = [];
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: beamVert, fragmentShader: beamFrag,
      uniforms: { uOn: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beamMat = beamMat;
    if (car.headlights.length) {
      const hp = car.headlights[0];
      const spot = new THREE.SpotLight(0xe8f0ff, 0, 18, 0.55, 0.7, 1.2);
      spot.position.set(hp.x, hp.y, 0);
      spot.target.position.set(hp.x + 6, 0, 0);
      car.group.add(spot, spot.target);
      this.spots.push(spot);
    }
    for (const hp of car.headlights) {
      const cone = new THREE.ConeGeometry(1.5, 6, 32, 1, true);
      cone.translate(0, -3, 0);
      cone.rotateZ(Math.PI / 2);
      const beam = new THREE.Mesh(cone, beamMat);
      beam.position.copy(hp);
      beam.rotation.y = hp.z > 0 ? -0.06 : 0.06;
      beam.rotation.z = -0.1;
      beam.renderOrder = 5;
      car.group.add(beam);
      this.beams.push(beam);
    }
    // one rear light does both the tail glow and the exhaust pop flash
    this.rearLight = new THREE.PointLight(0xff1a10, 0, 5, 1.5);
    this.rearLight.position.copy(car.rear);
    car.group.add(this.rearLight);
    this._tailC = new THREE.Color(0xff1a10);
    this._popC = new THREE.Color(0xff7a20);
  }

  _buildFx() {
    const tex = flameTexture();
    this.flames = [];
    for (const p of this.car.exhausts) {
      const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, color: new THREE.Color(3, 2.2, 1.6) });
      const s = new THREE.Sprite(mat);
      s.position.copy(p);
      s.scale.setScalar(0.001);
      s.userData = { base: p.clone(), life: 0 };
      this.car.group.add(s);
      this.flames.push(s);
    }
  }

  setPaint(key) { return this.car.setPaint(key); }

  pop(strength = 1) {
    this._flash = Math.max(this._flash, strength);
    for (const f of this.flames) {
      if (Math.random() < 0.75) {
        f.userData.life = 0.06 + Math.random() * 0.08 * strength;
        f.userData.size = (0.18 + Math.random() * 0.25) * strength;
      }
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.9;
    // tall screens: narrower lens and no visible light ceiling (it would wash out the top half)
    this.camera.fov = this.portrait ? 44 : 34;
    this.camera.updateProjectionMatrix();
    this.hex.visible = !this.portrait;
    this.bloom = this.portrait || this.mobile ? 0.3 : 0.5;
  }

  update(dt, t) {
    const S = THREE.MathUtils.smoothstep;
    this._m.lerp(this.mouse, 1 - Math.pow(0.003, dt));
    this._dragV *= Math.pow(0.04, dt);
    this.drag += this._dragV * dt;

    // camera orbit keyframes: [azimuth, radius, height, lookY]
    const K = [
      [0.62, 7.0, 0.85, 0.55],
      [1.57, 7.6, 1.0, 0.6],
      [2.55, 6.9, 1.15, 0.55],
      [3.6, 7.2, 0.7, 0.5],
      [5.55, 8.0, 2.0, 0.45],
    ];
    const p = THREE.MathUtils.clamp(this.p, 0, 1) * (K.length - 1);
    const i = Math.min(K.length - 2, Math.floor(p));
    const f = S(p - i, 0, 1);
    const k = K[i].map((v, j) => v + (K[i + 1][j] - v) * f);
    const az = k[0] + this.drag + this._m.x * 0.15;
    const rad = k[1] * (this.portrait ? 1.55 : 1);
    const cam = this.camera;
    cam.position.set(Math.cos(az) * rad, k[2] - this._m.y * 0.25, Math.sin(az) * rad);

    // engine shake
    const rpmN = this.rpm / 7200;
    const amp = this.running ? 0.0025 + rpmN * this.throttle * 0.006 + this._shake : 0;
    this._shake *= Math.pow(0.02, dt);
    const cg = this.car.group;
    cg.position.y = Math.sin(t * (20 + rpmN * 60)) * amp * 0.6;
    cg.rotation.x = Math.sin(t * 31) * amp * 0.5;
    cg.rotation.z = -this.throttle * rpmN * 0.006 + Math.sin(t * 17) * amp * 0.4;
    cam.position.x += (Math.random() - 0.5) * amp * 0.6;
    cam.position.y += (Math.random() - 0.5) * amp * 0.6;
    cam.lookAt(0, k[3], 0);

    // lights
    this.car.setLights(this.lights);
    this.car.update(dt);
    const L = this._lightsS = THREE.MathUtils.lerp(this._lightsS || 0, this.lights, 1 - Math.pow(0.002, dt));
    this.spots.forEach((s) => { s.intensity = L * 90; });
    this.beamMat.uniforms.uOn.value = L;
    if (this.floor.material.uniforms) {
      this.floor.material.uniforms.uGlow.value = L;
      this.floor.material.uniforms.uTail.value = L;
    }

    // flames
    this._flash *= Math.pow(0.0001, dt);
    const tail = L * 3, pop = this._flash * 25;
    this.rearLight.intensity = tail + pop;
    this.rearLight.color.copy(this._tailC).lerp(this._popC, pop / Math.max(0.001, tail + pop));
    for (const fl of this.flames) {
      const u = fl.userData;
      if (u.life > 0) {
        u.life -= dt;
        const s = u.size * (0.7 + Math.random() * 0.6);
        fl.scale.set(s * 1.6, s, 1);
        fl.position.copy(u.base).add(new THREE.Vector3(-s * 0.55, 0, 0));
      } else {
        fl.scale.setScalar(0.0001);
      }
    }
  }

  shake(v) { this._shake = Math.max(this._shake, v); }

  dragBy(dx) { this._dragV += dx; }
}
