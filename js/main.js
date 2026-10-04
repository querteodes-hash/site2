import * as THREE from 'three';
import { Stage } from './gl/stage.js';
import { AudioHub } from './audio/hub.js';
import { V8 } from './audio/v8.js';
import { Cursor, magnetic, glassLight, tilt, scramble, noiseDataURL } from './ui/fx.js';
import { Terminal } from './ui/terminal.js';
import { CARS, resolveCar } from './car-config.js';
import { PAINTS } from './gl/m5.js';

const { gsap, ScrollTrigger, Lenis } = window;
gsap.registerPlugin(ScrollTrigger);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const MOBILE = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const hub = new AudioHub();
const v8 = new V8(hub);
const track = $('#track');
let stage = null;
let lenis = null;
let entered = false;
let soundOn = false;

const S = {
  moneyP: 0, contactP: 0, mix1: 0, mix2: 0, mix3: 0, vpnP: 0, worksP: 0, garageP: 0,
  scrollY: 0, velocity: 0, inGarage: false, section: 0,
};

// ---------------------------------------------------------------- grain overlay
$('.noise').style.backgroundImage = `url(${noiseDataURL()})`;

// ---------------------------------------------------------------- preloader
const loader = {
  el: $('#loader'),
  log: $('#loaderLog'),
  count: $('#loaderCount'),
  bar: $('#loaderBar'),
  task: $('#loaderTask'),
  clock: $('#loaderClock'),
  shown: 0,
  target: 0,
  lines: [],
};

const logQueue = [];
let logTimer = null;
function logLine(html) {
  logQueue.push(html);
  if (logTimer) return;
  logTimer = setInterval(() => {
    const next = logQueue.shift();
    if (!next) { clearInterval(logTimer); logTimer = null; return; }
    loader.lines.push(next);
    if (loader.lines.length > 14) loader.lines.shift();
    loader.log.innerHTML = loader.lines.join('\n');
  }, 150);
}

function setProgress(p, label) {
  loader.target = Math.max(loader.target, p);
  if (label) loader.task.textContent = label;
}

const bootLines = [
  '[ <span class="ok">ok</span> ] mounting /dev/bbb',
  '[ <span class="ok">ok</span> ] secure boot · signature verified',
  '[ <span class="ok">ok</span> ] loading kernel modules: wireguard nf_tables',
  '[ <span class="ok">ok</span> ] spinning up gpu context',
];

function loaderClock() {
  const d = new Date();
  loader.clock.textContent = d.toTimeString().slice(0, 8);
}

async function boot() {
  loaderClock();
  const clockT = setInterval(loaderClock, 1000);
  gsap.to('.loader__stroke', { strokeDashoffset: 0, duration: 2.4, ease: 'power2.inOut' });
  bootLines.forEach(logLine);

  const counter = () => {
    loader.shown += (loader.target - loader.shown) * Math.min(1, gsap.ticker.deltaRatio() * 0.08);
    if (loader.target - loader.shown < 0.002) loader.shown = loader.target;
    const v = Math.round(loader.shown * 100);
    loader.count.textContent = String(v).padStart(3, '0');
    loader.bar.style.transform = `scaleX(${loader.shown})`;
    $('.loader__fill').style.clipPath = `inset(${(1 - loader.shown) * 100}% 0 0 0)`;
  };
  gsap.ticker.add(counter);

  const minTime = new Promise((r) => setTimeout(r, REDUCED ? 600 : 2600));

  // fonts
  const fontP = (document.fonts?.ready || Promise.resolve()).then(() => {
    setProgress(0.12, 'fonts: unbounded · cormorant · jetbrains mono · manrope');
    logLine('[ <span class="ok">ok</span> ] fonts loaded · 4 families');
  });

  // textures
  const texP = new Promise((res) => {
    new THREE.TextureLoader().load('assets/img/bills.jpg', (t) => {
      setProgress(0.25, 'texture: bills.jpg');
      logLine('[ <span class="ok">ok</span> ] printing money · bills.jpg');
      res(t);
    }, undefined, () => res(new THREE.Texture()));
  });
  const imgP = new Promise((res) => { const i = new Image(); i.onload = i.onerror = res; i.src = 'assets/img/franklin.jpg'; });

  // audio buffer (don't block forever on mobile)
  const audioP = new Promise((res) => {
    let done = false;
    const ok = () => {
      if (done) return; done = true;
      setProgress(0.35, 'audio: LONOWN, Asenssia — addiction');
      logLine('[ <span class="ok">ok</span> ] audio stream · lowpass armed (underwater)');
      res();
    };
    track.addEventListener('canplaythrough', ok, { once: true });
    track.addEventListener('canplay', () => setTimeout(ok, 1200), { once: true });
    track.addEventListener('error', ok, { once: true });
    setTimeout(ok, 6000);
    track.load();
  });

  const tex = await texP;
  await fontP;
  const preset = await resolveCar();
  if (preset.model) logLine('[ <span class="ok">ok</span> ] garage: <span class="gold">' + preset.model + '</span> found');

  // WebGL
  stage = new Stage($('#gl'), { mobile: MOBILE });
  try {
    await stage.init(tex, (step, p) => {
      const map = {
        money: [0.5, 'scene: burning money · instanced bills', '[ <span class="ok">ok</span> ] scene/money · embers · gold dust'],
        tunnel: [0.62, 'scene: encrypted tunnel · globe', '[ <span class="ok">ok</span> ] scene/vpn · hex tunnel · 7 nodes'],
        garage: [0.8, 'scene: garage · BMW M4 CSL', '[ <span class="ok">ok</span> ] scene/garage · <span class="gold">M4 CSL · S58B30T0 · 550 hp</span>'],
        compiled: [0.9, 'compiling shaders', '[ <span class="ok">ok</span> ] shaders compiled'],
        modelFailed: [0.7, 'model failed — procedural M5', '[ <span style="color:#ff6b6b">!!</span> ] model failed · fallback: procedural M5 F90'],
      }[step];
      if (step === 'model') { setProgress(0.62 + p * 0.16, `model: ${preset.model} · ${Math.round(p * 100)}%`); return; }
      if (map) { setProgress(map[0], map[1]); logLine(map[2]); }
    }, preset);
    applyCar(stage.carIsModel ? preset : CARS.m5);
  } catch (e) {
    console.error(e);
    logLine('[ <span style="color:#ff6b6b">!!</span> ] webgl failed — fallback mode');
    stage = null;
  }

  if (stage) stage.money.onIgnite = () => hub.ignite();

  await Promise.all([imgP, audioP, minTime]);
  setProgress(1, 'ready');
  logLine('[ <span class="ok">ok</span> ] <span class="gold">all systems nominal</span>');
  await new Promise((r) => { const chk = () => (loader.shown > 0.998 ? r() : requestAnimationFrame(chk)); chk(); });
  await new Promise((r) => setTimeout(r, 450));
  clearInterval(clockT);
  gsap.ticker.remove(counter);

  const enter = $('#loaderEnter');
  enter.hidden = false;
  gsap.from(enter.children, { y: 24, opacity: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out' });
  gsap.to('.loader__count, .loader__right', { opacity: 0.25, duration: 0.6 });
  enter.querySelector('[data-enter="sound"]').focus({ preventScroll: true });

  $$('[data-enter]').forEach((b) => b.addEventListener('click', () => enterSite(b.dataset.enter === 'sound'), { once: true }));
}

async function enterSite(withSound) {
  if (entered) return;
  entered = true;
  if (withSound) {
    try { await hub.start(track); await hub.play(); setSound(true); } catch (e) { console.warn(e); }
  }
  intro();
}

// ---------------------------------------------------------------- intro / exit loader
function intro() {
  const tl = gsap.timeline({ defaults: { ease: 'power4.inOut' } });
  tl.to('.loader__inner', { opacity: 0, scale: 1.08, filter: 'blur(10px)', duration: 0.7 }, 0);
  tl.to('.loader__slices i', {
    rotationX: -92, opacity: 0, duration: 1.2, stagger: { each: 0.06, from: 'center' },
  }, 0.25);
  if (stage) {
    tl.to(stage, { fade: 1, duration: 1.6, ease: 'power2.out' }, 0.35);
    tl.fromTo(stage, { flash: 0.8 }, { flash: 0, duration: 1.4, ease: 'power2.out' }, 0.35);
  }
  hub.whoosh(1.4, 0.35);
  tl.add(() => {
    $('#loader').remove();
    document.body.classList.remove('is-loading');
    lenis?.start();
    ScrollTrigger.refresh();
  }, 1.5);
  tl.from('.hero__letter', {
    yPercent: 60, rotationX: -110, z: -400, opacity: 0, duration: 1.6, stagger: 0.12, ease: 'expo.out',
  }, 0.75);
  tl.from('.hero__kicker, .hero__sub, .hero__roles', { y: 30, opacity: 0, duration: 1.1, stagger: 0.1, ease: 'power3.out' }, 1.2);
  tl.from('.hero__bottom > *, .hero__click', { y: 20, opacity: 0, duration: 1, stagger: 0.1, ease: 'power3.out' }, 1.4);
  tl.from('.nav > *', { y: -30, opacity: 0, duration: 1, stagger: 0.08, ease: 'power3.out' }, 1.3);
  tl.from('.hud > *, .console-btn', { opacity: 0, duration: 1.2, stagger: 0.05 }, 1.6);
  typeRoles();
}

// ---------------------------------------------------------------- car preset → DOM + engine
let carName = 'BMW M4 CSL';
function applyCar(c) {
  v8.configure(c.engine);
  $('#carTitle').textContent = c.title;
  $('#carTitleEm').textContent = c.titleEm;
  $('#carSub').textContent = c.sub;
  $('#carQuote').textContent = c.quote;
  $('#menuCar').textContent = c.menu;
  carName = c.name;
  $$('#specs .spec').forEach((el, i) => {
    const s = c.specs[i];
    if (!s) return;
    const b = el.querySelector('b');
    b.dataset.count = s.v;
    if (s.dec) b.dataset.dec = s.dec; else delete b.dataset.dec;
    el.querySelector('span').textContent = s.unit;
  });
  if (c.credit) { const cr = $('#carCredit'); cr.textContent = c.credit; cr.hidden = false; }
  buildPaints(c);
}

function buildPaints(c) {
  const wrap = $('#paints');
  wrap.innerHTML = '';
  const pick = (key, silent) => {
    $$('button', wrap).forEach((x) => x.setAttribute('aria-checked', String(x.dataset.paint === key)));
    stage?.garage?.setPaint(key);
    $('#paintName').textContent = PAINTS[key]?.name || key;
    if (!silent) hub.tick(1800, 0.03);
  };
  for (const key of c.paints) {
    const p = PAINTS[key];
    if (!p) continue;
    const b = document.createElement('button');
    b.setAttribute('role', 'radio');
    b.dataset.paint = key;
    b.title = p.name;
    b.setAttribute('aria-label', p.name);
    b.style.setProperty('--c', `#${p.color.toString(16).padStart(6, '0')}`);
    b.addEventListener('click', () => pick(key));
    wrap.appendChild(b);
  }
  pick(c.paint, true);
}
buildPaints(CARS.m4);

// ---------------------------------------------------------------- sound toggle
function setSound(on) {
  soundOn = on;
  const btn = $('#soundBtn');
  btn.classList.toggle('is-on', on);
  btn.setAttribute('aria-pressed', String(on));
  $('#soundTxt').textContent = on ? 'sound on' : 'sound off';
}

async function toggleSound(force) {
  const want = force ?? !soundOn;
  if (want) {
    await hub.start(track);
    await hub.play();
    hub.setDepth(audioDepth(), true);
  } else {
    hub.mute();
    v8.stop();
    garageEngineUI(false);
  }
  setSound(want);
}
$('#soundBtn').addEventListener('click', () => toggleSound());

document.addEventListener('visibilitychange', () => {
  if (!hub.ctx) return;
  if (document.hidden) { track.pause(); hub.ctx.suspend(); }
  else if (soundOn) { hub.ctx.resume(); track.play().catch(() => {}); }
});

// ---------------------------------------------------------------- hero roles typing
function typeRoles() {
  const el = $('#role');
  const roles = ['coder', 'pentester', 'full-stack developer', 'network engineer', 'vpn builder'];
  let i = 0;
  const cycle = () => {
    const word = roles[i++ % roles.length];
    const tl = gsap.timeline({ onComplete: () => setTimeout(cycle, 1600) });
    const cur = el.textContent;
    tl.to({ n: cur.length }, { n: 0, duration: cur.length * 0.025, ease: 'none', onUpdate() { el.textContent = cur.slice(0, Math.round(this.targets()[0].n)); } });
    tl.to({ n: 0 }, { n: word.length, duration: word.length * 0.055, ease: 'none', onUpdate() { el.textContent = word.slice(0, Math.round(this.targets()[0].n)); } });
  };
  setTimeout(cycle, 2200);
}

// ---------------------------------------------------------------- smooth scroll
function setupScroll() {
  lenis = new Lenis({ duration: 1.25, smoothWheel: true, wheelMultiplier: 0.9, touchMultiplier: 1.4 });
  lenis.stop();
  lenis.on('scroll', (e) => {
    S.velocity = e.velocity;
    ScrollTrigger.update();
  });
  gsap.ticker.add((t) => lenis.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

function audioDepth() {
  return 1 - smooth(0, innerHeight * 1.15, scrollY);
}

// ---------------------------------------------------------------- section animations
function setupSections() {
  const st = (o) => ScrollTrigger.create(o);


  // --- HERO exit: letters fly apart in 3D
  const heroTl = gsap.timeline({ scrollTrigger: { trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true } });
  heroTl.to('.hero__in', { rotationX: 38, z: -420, yPercent: -18, opacity: 0, ease: 'none' }, 0);
  heroTl.to('.hero__letter:nth-child(1)', { xPercent: -60, rotationY: -55, z: 220, ease: 'none' }, 0);
  heroTl.to('.hero__letter:nth-child(3)', { xPercent: 60, rotationY: 55, z: 220, ease: 'none' }, 0);
  heroTl.to('.hero__letter:nth-child(2)', { z: 420, ease: 'none' }, 0);
  heroTl.to('.hero__bottom, .hero__click', { opacity: 0, y: -60, ease: 'none' }, 0);

  // hero title follows the mouse
  if (!MOBILE) {
    const rx = gsap.quickTo('.hero__title', 'rotationX', { duration: 1.2, ease: 'power3.out' });
    const ry = gsap.quickTo('.hero__title', 'rotationY', { duration: 1.2, ease: 'power3.out' });
    addEventListener('pointermove', (e) => {
      rx(((e.clientY / innerHeight) - 0.5) * -14);
      ry(((e.clientX / innerWidth) - 0.5) * 20);
    });
  }

  // --- ABOUT
  gsap.fromTo('.about__grid', { rotationX: 22, y: 160, z: -260, opacity: 0 }, {
    rotationX: 0, y: 0, z: 0, opacity: 1, ease: 'none',
    scrollTrigger: { trigger: '#about', start: 'top bottom', end: 'top 25%', scrub: true },
  });
  gsap.to('.about__grid', {
    rotationX: -14, z: -320, opacity: 0.15, ease: 'none',
    scrollTrigger: { trigger: '#about', start: 'bottom 70%', end: 'bottom top', scrub: true },
  });
  gsap.fromTo('.portrait', { rotationY: -28, xPercent: -10 }, {
    rotationY: 0, xPercent: 0, ease: 'none',
    scrollTrigger: { trigger: '#about', start: 'top bottom', end: 'top 20%', scrub: true },
  });
  gsap.fromTo('.portrait__img img', { '--py': '-6%' }, {
    '--py': '6%', ease: 'none',
    scrollTrigger: { trigger: '#about', start: 'top bottom', end: 'bottom top', scrub: true },
  });
  revealLines('#about');
  gsap.from('.stat', {
    rotationX: -80, y: 40, opacity: 0, transformOrigin: '50% 100%', duration: 1.1, stagger: 0.1, ease: 'power3.out',
    scrollTrigger: { trigger: '.stats', start: 'top 85%' },
  });
  countUp('.stats [data-count]', '.stats');

  // marquee
  const mq = $('.marquee__track');
  mq.innerHTML += mq.innerHTML;
  let mqX = 0;
  gsap.ticker.add(() => {
    const w = mq.scrollWidth / 2;
    mqX -= 0.6 + Math.min(14, Math.abs(S.velocity) * 0.35);
    if (mqX <= -w) mqX += w;
    mq.style.transform = `translate3d(${mqX}px,0,0)`;
  });

  // --- ARSENAL: 3D carousel
  const ring = $('#carouselRing');
  const roles = $$('.role', ring);
  const step = 360 / roles.length;
  const radius = () => ring.offsetWidth * 0.78;
  const layout = () => {
    const R = radius();
    roles.forEach((r, i) => { r.style.transform = `rotateY(${i * step}deg) translateZ(${R}px)`; });
  };
  layout();
  addEventListener('resize', layout);
  const ringState = { rot: 0 };
  const applyRing = () => {
    const R = radius();
    ring.style.transform = `translateZ(${-R}px) rotateY(${ringState.rot}deg)`;
    roles.forEach((r, i) => {
      const a = ((i * step + ringState.rot) % 360 + 360) % 360;
      const facing = Math.cos((a * Math.PI) / 180);
      r.style.opacity = String(0.08 + 0.92 * smooth(-0.2, 1, facing));
      r.style.filter = facing > 0.92 ? 'none' : `blur(${(1 - facing) * 3}px)`;
    });
  };
  applyRing();
  st({
    trigger: '#arsenal', start: 'top top', end: () => `+=${innerHeight * 3}`, pin: '.arsenal__pin', scrub: true,
    onUpdate: (s) => {
      const p = s.progress;
      const target = -smooth(0.06, 0.94, p) * step * (roles.length - 1);
      gsap.to(ringState, { rot: target, duration: 0.6, ease: 'power3.out', overwrite: true, onUpdate: applyRing });
      $('#roleIdx').textContent = String(Math.min(roles.length, Math.round(-target / step) + 1)).padStart(2, '0');
      $('#roleBar').style.transform = `scaleX(${p})`;
    },
  });
  gsap.fromTo('.carousel', { rotationX: 30, y: 200, opacity: 0 }, {
    rotationX: 0, y: 0, opacity: 1, ease: 'none',
    scrollTrigger: { trigger: '#arsenal', start: 'top bottom', end: 'top top', scrub: true },
  });
  gsap.fromTo('.arsenal__bgword', { xPercent: -30 }, {
    xPercent: -70, ease: 'none',
    scrollTrigger: { trigger: '#arsenal', start: 'top bottom', end: () => `+=${innerHeight * 4}`, scrub: true },
  });
  gsap.from('.arsenal__head > *', {
    y: 60, opacity: 0, stagger: 0.1, duration: 1, ease: 'power3.out',
    scrollTrigger: { trigger: '#arsenal', start: 'top 60%' },
  });

  // --- VPN
  gsap.set('.vpn__panel', { visibility: 'hidden' });
  gsap.set('.vpn__info, .vpn__side', { transformPerspective: 1400 });
  const vpnTl = gsap.timeline({
    scrollTrigger: {
      trigger: '#vpn', start: 'top top', end: () => `+=${innerHeight * 3.4}`, pin: '.vpn__pin', scrub: true,
      onUpdate: (s) => { S.vpnP = s.progress; },
    },
  });
  vpnTl.fromTo('.vpn__tunnel', { scale: 0.55, opacity: 0, filter: 'blur(12px)' }, { scale: 1, opacity: 1, filter: 'blur(0px)', duration: 0.08, ease: 'power2.out' }, 0);
  vpnTl.to('.vpn__tunnel', { scale: 1.08, duration: 0.32, ease: 'none' }, 0.08);
  vpnTl.to('.vpn__tunnel', { scale: 3.2, opacity: 0, filter: 'blur(14px)', duration: 0.1, ease: 'power2.in' }, 0.4);
  vpnTl.set('.vpn__panel', { visibility: 'visible' }, 0.5);
  vpnTl.fromTo('.vpn__info', { rotationY: 30, x: -140, z: -300, opacity: 0 }, { rotationY: 0, x: 0, z: 0, opacity: 1, duration: 0.14, ease: 'power3.out' }, 0.52);
  vpnTl.fromTo('.vpn__side', { rotationY: -30, x: 140, z: -300, opacity: 0 }, { rotationY: 0, x: 0, z: 0, opacity: 1, duration: 0.14, ease: 'power3.out' }, 0.58);
  vpnTl.fromTo('.features li', { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.015, duration: 0.06 }, 0.6);
  vpnTl.to({}, { duration: 0.25 }, 0.75);
  st({ trigger: '#vpn', start: 'top 60%', end: 'bottom top', onToggle: (s) => hexRain(s.isActive) });
  st({ trigger: '#vpn', start: () => `top+=${innerHeight * 1.8} top`, onEnter: typeVpnTerminal, once: true });
  st({ trigger: '#vpn', start: 'top 70%', once: true, onEnter: () => scramble($('[data-scramble-big]'), 'ENCRYPTED', 1.6) });

  // --- WORKS: horizontal 3D coverflow
  const trackEl = $('#worksTrack');
  const cards = $$('.work', trackEl);
  const dist = () => Math.max(0, trackEl.scrollWidth - innerWidth);
  st({
    trigger: '#works', start: 'top top', end: () => `+=${dist() + innerHeight * 0.6}`, pin: '.works__pin', scrub: 0.6,
    invalidateOnRefresh: true,
    onUpdate: (s) => {
      S.worksP = s.progress;
      const x = -dist() * s.progress;
      trackEl.style.transform = `translate3d(${x}px,0,0)`;
      const cx = innerWidth / 2;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const d = clamp((r.left + r.width / 2 - cx) / innerWidth, -1.2, 1.2);
        c.style.transform = `perspective(1400px) rotateY(${d * -32}deg) translateZ(${-Math.abs(d) * 220}px) scale(${1 - Math.abs(d) * 0.08})`;
        c.style.opacity = String(1 - Math.max(0, Math.abs(d) - 0.7) * 1.2);
      }
      $('#worksBar').style.transform = `scaleX(${s.progress})`;
    },
  });
  gsap.fromTo('.works__track', { rotationX: 25, y: 180, opacity: 0 }, {
    rotationX: 0, y: 0, opacity: 1, ease: 'none',
    scrollTrigger: { trigger: '#works', start: 'top bottom', end: 'top top', scrub: true },
  });
  gsap.from('.works__head > *', { y: 60, opacity: 0, stagger: 0.1, duration: 1, ease: 'power3.out', scrollTrigger: { trigger: '#works', start: 'top 60%' } });

  // --- GARAGE
  const gTl = gsap.timeline({
    scrollTrigger: {
      trigger: '#garage', start: 'top top', end: () => `+=${innerHeight * 4}`, pin: '.garage__pin', scrub: true,
      onUpdate: (s) => { S.garageP = s.progress; },
      onToggle: (s) => {
        S.inGarage = s.isActive;
        cursor.setZone(s.isActive ? 'drag' : '');
        if (!s.isActive && v8.running) { v8.stop(); garageEngineUI(false); }
      },
    },
  });
  gTl.fromTo('.garage__title > *', { y: 80, opacity: 0, rotationX: -40 }, { y: 0, opacity: 1, rotationX: 0, stagger: 0.015, duration: 0.07, ease: 'power3.out' }, 0);
  gTl.fromTo('.dash', { y: 120, opacity: 0, rotationX: 30 }, { y: 0, opacity: 1, rotationX: 0, duration: 0.08, ease: 'power3.out' }, 0.03);
  gTl.to('.garage__title', { y: -120, opacity: 0, duration: 0.08, ease: 'power2.in' }, 0.42);
  gTl.fromTo('.spec', { y: 60, opacity: 0, rotationX: -60 }, { y: 0, opacity: 1, rotationX: 0, stagger: 0.02, duration: 0.08, ease: 'power3.out' }, 0.2);
  gTl.to('.spec', { y: -60, opacity: 0, stagger: 0.01, duration: 0.06, ease: 'power2.in' }, 0.72);
  gTl.to({}, { duration: 0.2 }, 0.8);
  st({ trigger: '#garage', start: () => `top+=${innerHeight * 0.8} top`, once: true, onEnter: () => countUp('#specs [data-count]', null, true) });

  // --- CONTACT
  gsap.fromTo('.contact__in', { rotationX: 24, y: 160, z: -300, opacity: 0 }, {
    rotationX: 0, y: 0, z: 0, opacity: 1, ease: 'none',
    scrollTrigger: { trigger: '#contact', start: 'top bottom', end: 'top 20%', scrub: true },
  });
  revealLines('#contact');
  gsap.from('.clink', {
    rotationY: -70, x: -40, opacity: 0, transformOrigin: '0% 50%', duration: 1.2, stagger: 0.12, ease: 'power3.out',
    scrollTrigger: { trigger: '.contact__grid', start: 'top 90%' },
  });

  // --- HUD
  const secs = $$('.sec');
  const dots = $('#hudDots');
  secs.forEach((sec, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.setAttribute('aria-label', sec.dataset.name);
    b.addEventListener('click', () => jumpTo(`#${sec.id}`));
    li.appendChild(b);
    dots.appendChild(li);
    st({
      trigger: sec, start: 'top 55%', end: 'bottom 55%',
      onToggle: (s) => {
        if (!s.isActive) return;
        S.section = i;
        $('#hudIdx').textContent = sec.dataset.index;
        $('#hudName').textContent = sec.dataset.name;
        $$('button', dots).forEach((d, k) => d.classList.toggle('is-active', k === i));
        hub.tick(1600 + i * 120, 0.025);
      },
    });
  });
  st({ start: 0, end: 'max', onUpdate: (s) => { $('#hudBar').style.transform = `scaleY(${s.progress})`; } });

  // --- scene timeline (created after the pins so their spacing is accounted for)
  st({ trigger: '#hero', start: 'top top', endTrigger: '#arsenal', end: 'bottom bottom', onUpdate: (s) => { S.moneyP = s.progress; } });
  st({ trigger: '#vpn', start: 'top bottom', end: 'top top', onUpdate: (s) => { S.mix1 = s.progress; } });
  st({ trigger: '#garage', start: 'top bottom', end: 'top top', onUpdate: (s) => { S.mix2 = s.progress; } });
  st({ trigger: '#contact', start: 'top bottom', end: 'top 20%', onUpdate: (s) => { S.mix3 = s.progress; } });
  st({ trigger: '#contact', start: 'top bottom', end: 'bottom bottom', onUpdate: (s) => { S.contactP = s.progress; } });
}

function revealLines(scope) {
  $$(`${scope} [data-reveal]`).forEach((el, i) => {
    gsap.from(el, {
      yPercent: 115, rotationX: -70, transformOrigin: '50% 100%', duration: 1.3, delay: i * 0.08, ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 92%' },
    });
  });
  $$(`${scope} [data-fade]`).forEach((el) => {
    gsap.from(el, { y: 40, opacity: 0, duration: 1.2, ease: 'power3.out', scrollTrigger: { trigger: el, start: 'top 90%' } });
  });
}

function countUp(sel, trigger, now = false) {
  $$(sel).forEach((el) => {
    const to = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.dec || '0', 10);
    const run = () => gsap.fromTo({ v: 0 }, { v: 0 }, {
      v: to, duration: 2, ease: 'power3.out',
      onUpdate() { el.textContent = this.targets()[0].v.toFixed(dec); },
    });
    if (now) run();
    else ScrollTrigger.create({ trigger: trigger || el, start: 'top 85%', once: true, onEnter: run });
  });
}

// ---------------------------------------------------------------- VPN extras
let hexT = null;
function hexRain(on) {
  const el = $('#hexrain');
  clearInterval(hexT);
  if (!on) return;
  const cols = Math.ceil(innerWidth / 9);
  const rows = Math.ceil(innerHeight / 15);
  const hex = '0123456789abcdef';
  const line = () => { let s = ''; for (let i = 0; i < cols; i++) s += Math.random() < 0.55 ? hex[(Math.random() * 16) | 0] : ' '; return s; };
  const lines = Array.from({ length: rows }, line);
  el.textContent = lines.join('\n');
  hexT = setInterval(() => {
    lines.pop(); lines.unshift(line());
    el.textContent = lines.join('\n');
  }, 90);
}

function typeVpnTerminal() {
  const el = $('#vpnTerm');
  const script = [
    ['<span class="g">bbb@edge-01</span>:<span class="c">~</span>$ ', 'bbb-vpn connect --node fra-01'],
    ['<span class="m">›</span> ', 'resolving edge… <span class="g">ok</span>'],
    ['<span class="m">›</span> ', 'handshake: noise_ik · x25519 <span class="g">✓</span>'],
    ['<span class="m">›</span> ', 'tunnel <span class="y">wg0</span> up · mtu 1420'],
    ['<span class="m">›</span> ', 'dns: encrypted · leak test <span class="g">passed</span>'],
    ['<span class="m">›</span> ', 'latency <span class="c">23ms</span> · loss <span class="c">0.0%</span>'],
    ['<span class="g">✔</span> ', 'connected. <span class="y">your traffic is yours.</span>'],
  ];
  let html = '';
  let li = 0;
  const next = () => {
    if (li >= script.length) { el.innerHTML = html + '<span class="caret"></span>'; return; }
    const [prefix, body] = script[li++];
    const plain = body.replace(/<[^>]+>/g, '');
    let k = 0;
    const tick = setInterval(() => {
      k += 2;
      el.innerHTML = html + prefix + plain.slice(0, k) + '<span class="caret"></span>';
      if (k >= plain.length) {
        clearInterval(tick);
        html += prefix + body + '\n';
        el.innerHTML = html;
        hub.tick(2600, 0.02);
        setTimeout(next, li === 1 ? 420 : 160);
      }
    }, 22);
  };
  next();
}

// nav + nodes ping jitter
function pings() {
  const nodes = $$('#nodes li');
  let active = 0;
  setInterval(() => {
    const ms = Math.round(19 + Math.random() * 10);
    $('#navPing').textContent = `${ms}ms`;
    nodes.forEach((n) => {
      const b = n.querySelector('b');
      const base = parseInt(b.dataset.base || (b.dataset.base = parseInt(b.textContent, 10)), 10);
      b.textContent = `${Math.max(5, base + Math.round((Math.random() - 0.5) * 6))}ms`;
    });
  }, 1400);
  setInterval(() => {
    nodes.forEach((n, i) => n.classList.toggle('is-active', i === active));
    $('#navNode').textContent = nodes[active]?.dataset.node || 'FRA-01';
    active = (active + 1) % Math.min(3, nodes.length);
  }, 4200);
}

// ---------------------------------------------------------------- menu + jumps
const menu = $('#menu');
const menuBtn = $('#menuBtn');
let menuOpen = false;
function toggleMenu(force) {
  menuOpen = force ?? !menuOpen;
  menuBtn.setAttribute('aria-expanded', String(menuOpen));
  menu.setAttribute('aria-hidden', String(!menuOpen));
  if (menuOpen) {
    menu.classList.add('is-open');
    lenis?.stop();
    gsap.to('.menu__bg', { opacity: 1, duration: 0.5 });
    gsap.fromTo('.menu__list a', { yPercent: 110, rotationX: -80, opacity: 0 }, { yPercent: 0, rotationX: 0, opacity: 1, duration: 0.9, stagger: 0.05, ease: 'expo.out' });
    gsap.fromTo('.menu__side', { opacity: 0, x: 30 }, { opacity: 1, x: 0, duration: 0.8, delay: 0.3 });
    hub.whoosh(0.5, 0.15);
  } else {
    gsap.to('.menu__list a', { yPercent: -110, opacity: 0, duration: 0.45, stagger: 0.02, ease: 'power3.in' });
    gsap.to('.menu__bg', { opacity: 0, duration: 0.5, delay: 0.15, onComplete: () => menu.classList.remove('is-open') });
    lenis?.start();
  }
}
menuBtn.addEventListener('click', () => toggleMenu());
$$('.menu__list a').forEach((a) => {
  const b = a.querySelector('b');
  a.addEventListener('pointerenter', () => { scramble(b, b.dataset.text || b.textContent, 0.5); hub.tick(2400, 0.02); });
});

let jumping = false;
function jumpTo(hash) {
  const target = $(hash);
  if (!target || jumping) return;
  jumping = true;
  if (menuOpen) toggleMenu(false);
  const label = $('#shutterLabel');
  label.textContent = `/${target.id}`;
  hub.whoosh(0.9, 0.3);
  const tl = gsap.timeline({ onComplete: () => { jumping = false; } });
  tl.set('.shutter i', { transformOrigin: '50% 100%' });
  tl.to('.shutter i', { scaleY: 1, duration: 0.55, stagger: { each: 0.045, from: 'random' }, ease: 'power4.inOut' });
  tl.to(label, { opacity: 1, duration: 0.2 }, '-=0.2');
  tl.add(() => {
    lenis.start();
    const y = target.getBoundingClientRect().top + scrollY;
    lenis.scrollTo(y, { immediate: true, force: true });
    ScrollTrigger.update();
  });
  tl.set('.shutter i', { transformOrigin: '50% 0%' }, '+=0.25');
  tl.to(label, { opacity: 0, duration: 0.2 });
  tl.to('.shutter i', { scaleY: 0, duration: 0.6, stagger: { each: 0.045, from: 'random' }, ease: 'power4.inOut' }, '<');
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-link]');
  if (!a) return;
  e.preventDefault();
  jumpTo(a.getAttribute('href'));
});

// ---------------------------------------------------------------- garage controls
const startBtn = $('#startBtn');
const revBtn = $('#revBtn');
function garageEngineUI(on) {
  startBtn.classList.toggle('is-on', on);
  startBtn.setAttribute('aria-pressed', String(on));
  revBtn.disabled = !on;
  if (stage) { stage.garage.running = on; stage.garage.lights = on ? 1 : 0; }
}
async function ensureEngine() {
  if (!soundOn) await toggleSound(true);
  if (!v8.ready) await v8.init();
  return v8.ready;
}
startBtn.addEventListener('click', async () => {
  if (v8.running || v8.starting) { v8.stop(); garageEngineUI(false); return; }
  const ok = await ensureEngine();
  if (!ok) { toast('движок недоступен в этом браузере'); if (stage) stage.garage.lights = 1; return; }
  v8.start();
  garageEngineUI(true);
  stage?.garage.shake(0.01);
});
v8.onPop = () => { stage?.garage.pop(0.8 + Math.random() * 0.6); };
const throttle = (on) => {
  if (!v8.running) return;
  v8.setThrottle(on);
  revBtn.classList.toggle('is-down', on);
};
revBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); revBtn.setPointerCapture?.(e.pointerId); throttle(true); });
['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => revBtn.addEventListener(ev, () => throttle(false)));
revBtn.addEventListener('contextmenu', (e) => e.preventDefault());


// drag to orbit
{
  const pin = $('.garage__pin');
  let down = false, lx = 0;
  pin.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.dash, a, button')) return;
    down = true; lx = e.clientX;
  });
  addEventListener('pointermove', (e) => {
    if (!down || !stage) return;
    stage.garage.dragBy((e.clientX - lx) * 0.05);
    lx = e.clientX;
  });
  addEventListener('pointerup', () => { down = false; });
}

// tachometer ticks
{
  const g = $('#tachoTicks');
  const ns = 'http://www.w3.org/2000/svg';
  for (let i = 0; i <= 8; i++) {
    const a = (-225 + (i / 8) * 270) * (Math.PI / 180);
    const tick = document.createElementNS(ns, 'line');
    const r1 = 74, r2 = 66;
    tick.setAttribute('x1', 100 + Math.cos(a) * r1); tick.setAttribute('y1', 100 + Math.sin(a) * r1);
    tick.setAttribute('x2', 100 + Math.cos(a) * r2); tick.setAttribute('y2', 100 + Math.sin(a) * r2);
    tick.setAttribute('class', `tick${i >= 6 ? ' red' : ''}`);
    g.appendChild(tick);
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', 100 + Math.cos(a) * 54); t.setAttribute('y', 100 + Math.sin(a) * 54);
    t.textContent = i;
    g.appendChild(t);
  }
}
const tachoVal = $('#tachoVal');
const tachoNeedle = $('#tachoNeedle');
const rpmVal = $('#rpmVal');
function drawTacho(rpm) {
  const f = clamp(rpm / 8000, 0, 1);
  tachoVal.style.strokeDasharray = `${(f * 395.8).toFixed(1)} 527.8`;
  tachoNeedle.style.transform = `rotate(${-135 + f * 270}deg)`;
  rpmVal.textContent = Math.round(rpm / 10) * 10;
}

// ---------------------------------------------------------------- keyboard
const konami = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kIdx = 0;
addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea')) return;
  kIdx = e.key === konami[kIdx] ? kIdx + 1 : (e.key === konami[0] ? 1 : 0);
  if (kIdx === konami.length) { kIdx = 0; moneyRain(); }
  if (e.key === '`' || e.key === 'ё') { e.preventDefault(); term.toggle(); }
  if (e.key === 'Escape') { if (menuOpen) toggleMenu(false); term.toggle(false); }
  if ((e.key === 'm' || e.key === 'ь') && entered) toggleSound();
  if (e.code === 'Space' && S.inGarage) { e.preventDefault(); if (!e.repeat) throttle(true); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') throttle(false); });

function moneyRain() {
  toast('💸 money rain');
  stage?.money.rain(7);
  if (stage) gsap.fromTo(stage, { flash: 0.6 }, { flash: 0, duration: 1.2 });
  hub.whoosh(1.2, 0.3);
}

// ---------------------------------------------------------------- toast + misc
let toastT;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('is-on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('is-on'), 2200);
}
$('#copyMail').addEventListener('click', async (e) => {
  const mail = e.currentTarget.dataset.mail;
  try { await navigator.clipboard.writeText(mail); toast('email скопирован'); } catch { location.href = `mailto:${mail}`; }
});

// click on bills to set them on fire
document.addEventListener('click', (e) => {
  if (!stage || !entered || e.target.closest('a, button, input, .glass, .menu, .console')) return;
  const view = stage.state;
  const moneyVisible = (view.a === 0 && view.t < 0.5) || (view.b === 3 && view.t > 0.5);
  if (!moneyVisible) return;
  stage.money.pick((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});

// ---------------------------------------------------------------- terminal
const term = new Terminal({
  root: $('#console'), out: $('#consoleOut'), form: $('#consoleForm'), input: $('#consoleInput'),
  api: {
    goto: (id) => jumpTo(`#${id}`),
    ignite: () => {
      if (S.section > 2 && S.section < 6) jumpTo('#hero');
      setTimeout(() => { stage?.money.igniteAll(); hub.ignite(); }, S.section > 2 && S.section < 6 ? 1300 : 0);
    },
    vroom: async () => {
      jumpTo('#garage');
      setTimeout(async () => { if (!v8.running) startBtn.click(); }, 1500);
    },
    sound: (on) => toggleSound(on),
    carName: () => carName,
    onToggle: (open) => { if (open) lenis?.stop(); else if (!menuOpen) lenis?.start(); },
  },
});
$('#consoleBtn').addEventListener('click', () => term.toggle());
$('#consoleClose').addEventListener('click', () => term.toggle(false));

// ---------------------------------------------------------------- frame loop
const cursor = new Cursor($('#cursor'), $('#cursorLabel'));
const mouse = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}, { passive: true });

let burnedShown = 0;
let surfaced = false;
let last = performance.now();
const clock0 = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = (now - clock0) / 1000;
  cursor.update();

  // audio
  const depth = audioDepth();
  if (hub.ctx) hub.setDepth(depth);
  const lv = hub.analyse();
  if (!surfaced && depth < 0.04 && entered) {
    surfaced = true;
    if (stage) gsap.fromTo(stage, { flash: 0.55 }, { flash: 0, duration: 1.4, ease: 'power2.out' });
  } else if (depth > 0.5) surfaced = false;


  if (stage?.ready) {
    const s = S.mix1 + S.mix2 + S.mix3;
    const a = Math.min(2, Math.floor(s));
    const k = s - a;
    stage.setView(a, a + 1, k, a === 1 ? 1 : 0);
    stage.water = depth;
    stage.velocity = S.velocity * 60;

    const money = stage.money;
    money.mouse.copy(mouse);
    money.water = depth;
    money.pulse = lv.pulse;
    money.scrollVel = S.velocity * 60;
    if (s < 1.5) {
      money.burn = S.moneyP * 1.25;
      money.travel = S.moneyP;
    } else {
      money.burn = 1.3 * (1 - smooth(0.15, 0.85, S.contactP));
      money.travel = 0.35 + S.contactP * 0.4;
    }

    const tun = stage.tunnel;
    tun.p = S.vpnP;
    tun.works = S.worksP;
    tun.mouse.copy(mouse);
    tun.pulse = lv.pulse;
    tun.speed = S.velocity * 60;

    const gar = stage.garage;
    gar.p = S.garageP;
    gar.mouse.copy(mouse);
    gar.rpm = v8.rpm;
    gar.throttle = v8.load > 0.5 ? 1 : 0;

    stage.render(dt, t);

    // HUD
    const burned = money.burnedValue;
    burnedShown += (burned - burnedShown) * 0.1;
    $('#burned').textContent = `$${Math.round(burnedShown).toLocaleString('en-US')}`;
  }
  requestAnimationFrame(frame);
}

function hudClock() {
  $('#hudTime').textContent = new Date().toTimeString().slice(0, 8);
  if (stage) $('#hudFps').textContent = `${Math.round(stage.fps)} fps`;
}

// ---------------------------------------------------------------- go
setupScroll();
setupSections();
magnetic(gsap);
glassLight();
tilt(gsap);
pings();
setInterval(hudClock, 1000);
// engine runs on its own clock, independent of the render frame rate
setInterval(() => {
  if (!v8.ready) return;
  v8.update(0.02, (performance.now() - clock0) / 1000);
  drawTacho(v8.rpm);
}, 20);
hudClock();
boot();
requestAnimationFrame(frame);
requestAnimationFrame(() => ScrollTrigger.refresh());
