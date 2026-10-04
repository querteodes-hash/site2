// Small UI effects: custom cursor, magnetic buttons, glass highlight + tilt, text scramble.

const GLYPHS = '!<>-_\\/[]{}—=+*^?#01ABCDEF$';

export function scramble(el, text = el.dataset.text || el.textContent, duration = 0.9) {
  if (!el) return;
  el.dataset.text = text;
  const start = performance.now();
  const len = text.length;
  cancelAnimationFrame(el._scr);
  const step = (now) => {
    const p = Math.min(1, (now - start) / (duration * 1000));
    let out = '';
    for (let i = 0; i < len; i++) {
      const reveal = p * len * 1.15 - i * 0.15;
      if (text[i] === ' ' || reveal >= 1) out += text[i];
      else if (reveal > -2) out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      else out += ' ';
    }
    el.textContent = out;
    if (p < 1) el._scr = requestAnimationFrame(step);
    else el.textContent = text;
  };
  el._scr = requestAnimationFrame(step);
}

export class Cursor {
  constructor(root, label) {
    this.root = root;
    this.dot = root.querySelector('.cursor__dot');
    this.ring = root.querySelector('.cursor__ring');
    this.label = label;
    this.x = innerWidth / 2; this.y = innerHeight / 2;
    this.rx = this.x; this.ry = this.y;
    this.enabled = matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!this.enabled) return;
    document.documentElement.classList.add('has-cursor');
    addEventListener('pointermove', (e) => {
      this.x = e.clientX; this.y = e.clientY;
      this.root.classList.remove('is-hidden');
      this._hover(e.target);
    }, { passive: true });
    addEventListener('pointerdown', () => this.root.classList.add('is-down'));
    addEventListener('pointerup', () => this.root.classList.remove('is-down'));
    document.addEventListener('mouseleave', () => this.root.classList.add('is-hidden'));
  }

  _hover(t) {
    const labeled = t.closest?.('[data-cursor]');
    const link = t.closest?.('a, button, [data-magnetic], input, label');
    let text = '';
    if (labeled) {
      const v = labeled.dataset.cursor;
      text = v === 'hold' ? 'hold' : v === 'start' ? 'press' : v;
    } else if (this.zone) text = this.zone;
    this.root.classList.toggle('is-label', !!text);
    this.root.classList.toggle('is-link', !text && !!link);
    if (text !== this._text) { this.label.textContent = text; this._text = text; }
  }

  setZone(text) { this.zone = text; }

  update() {
    if (!this.enabled) return;
    this.rx += (this.x - this.rx) * 0.18;
    this.ry += (this.y - this.ry) * 0.18;
    this.dot.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    this.ring.style.transform = `translate3d(${this.rx}px, ${this.ry}px, 0)`;
  }
}

export function magnetic(gsap) {
  if (!matchMedia('(hover: hover)').matches) return;
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.28);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.35);
    });
    el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
  });
}

export function glassLight() {
  let last = null;
  addEventListener('pointermove', (e) => {
    const g = e.target.closest?.('.glass');
    if (!g) return;
    const r = g.getBoundingClientRect();
    g.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    g.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    last = g;
  }, { passive: true });
  return () => last;
}

export function tilt(gsap) {
  if (!matchMedia('(hover: hover)').matches) return;
  document.querySelectorAll('.portrait[data-tilt], .stat[data-tilt], .clink[data-tilt]').forEach((el) => {
    gsap.set(el, { transformPerspective: 900 });
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.8, ease: 'power3.out' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.8, ease: 'power3.out' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      rx(-py * 10); ry(px * 12);
    });
    el.addEventListener('pointerleave', () => { rx(0); ry(0); });
  });
}

export function noiseDataURL(size = 180) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
