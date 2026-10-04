// Garage car presets.
// If `model` exists on the server it is loaded (GLB / glTF); otherwise the procedural M5 F90 is used.
// Force one with ?car=m5 or ?car=m4 in the URL.

export const CARS = {
  m4: {
    id: 'm4',
    model: 'assets/models/m4.glb',          // ~1M triangles, desktop
    modelLite: 'assets/models/m4-lite.glb', // simplified, phones/tablets
    length: 4.795,            // meters, used to auto-scale the model
    rotateY: null,            // radians; null = auto (longest axis → x)
    flip: false,              // set true if the car ends up facing backwards
    normalSmoothing: 0,       // high-poly model: keep its own normals (raise for low-poly bodies)
    title: 'M4',
    titleEm: 'CSL',
    menu: 'M4 CSL',
    name: 'BMW M4 CSL',
    sub: 'G82 · S58B30T0 · 3.0 I6 BITURBO · CSL',
    quote: 'Тот же принцип, что и в коде: мощность под контролем.',
    specs: [
      { v: 550, unit: 'л.с.' },
      { v: 650, unit: 'Н·м' },
      { v: 3.7, unit: 'с 0–100', dec: 1 },
      { v: 307, unit: 'км/ч' },
    ],
    engine: { cylinders: 6, idle: 820, redline: 7200 },
    paints: ['sapphire', 'frozenCsl', 'isle', 'saopaulo', 'toronto'],
    paint: 'sapphire',
    // material names inside the model
    materials: { paint: ['Car_Paint'], head: ['lightt'], tail: ['Red_Light'] },
    // anchor points in normalized model space (meters, front = +x)
    anchors: {
      exhausts: [[-2.39, 0.325, 0.39], [-2.39, 0.325, 0.28], [-2.39, 0.325, -0.28], [-2.39, 0.325, -0.39]],
      headlights: [[2.15, 0.66, 0.7], [2.15, 0.66, -0.7]],
      rear: [-2.65, 0.7, 0],
    },
    // CC BY 4.0 requires attribution
    credit: '3D: «BMW M4csl» — Mpgs Studios (sketchfab.com/mpgs.studio), CC BY 4.0',
  },
  m5: {
    id: 'm5',
    model: null,
    title: 'M5',
    titleEm: 'Competition',
    menu: 'M5 F90',
    name: 'BMW M5 F90 Competition',
    sub: 'F90 · S63B44T4 · 4.4 V8 BITURBO · M xDRIVE',
    quote: 'Тот же принцип, что и в коде: мощность под контролем.',
    specs: [
      { v: 625, unit: 'л.с.' },
      { v: 750, unit: 'Н·м' },
      { v: 3.3, unit: 'с 0–100', dec: 1 },
      { v: 305, unit: 'км/ч' },
    ],
    engine: { cylinders: 8, idle: 780, redline: 7200 },
    paints: ['brands', 'sapphire', 'marina', 'frozen', 'motegi'],
    paint: 'brands',
    credit: '',
  },
};

export async function resolveCar() {
  const forced = new URLSearchParams(location.search).get('car');
  if (forced && CARS[forced]) {
    if (!CARS[forced].model) return CARS[forced];
    if (await exists(CARS[forced].model)) return CARS[forced];
  }
  if (!forced && (await exists(CARS.m4.model))) return CARS.m4;
  return CARS.m5;
}

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch {
    return false;
  }
}
