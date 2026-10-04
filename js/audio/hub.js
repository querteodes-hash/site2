// Audio graph: music (with underwater filter) + engine + UI sfx → master → analyser → out

export class AudioHub {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.levels = { bass: 0, mid: 0, high: 0, pulse: 0 };
    this._bassAvg = 0;
    this.depth = 1;
  }

  // must be called from a user gesture
  async start(trackEl) {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.6;
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.master.connect(limiter).connect(this.analyser).connect(ctx.destination);

    // ---------- music chain
    this.musicIn = ctx.createGain();
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.Q.value = 3;
    this.lowpass.frequency.value = 380;
    this.lowshelf = ctx.createBiquadFilter();
    this.lowshelf.type = 'lowshelf';
    this.lowshelf.frequency.value = 160;
    this.lowshelf.gain.value = 5;
    // watery chorus
    this.chorusDelay = ctx.createDelay(0.1);
    this.chorusDelay.delayTime.value = 0.018;
    this.chorusLfo = ctx.createOscillator();
    this.chorusLfo.frequency.value = 0.45;
    this.chorusDepth = ctx.createGain();
    this.chorusDepth.gain.value = 0.006;
    this.chorusLfo.connect(this.chorusDepth).connect(this.chorusDelay.delayTime);
    this.chorusLfo.start();
    this.chorusWet = ctx.createGain();
    this.chorusWet.gain.value = 0.6;
    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.4);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.55;
    this.musicDry = ctx.createGain();
    this.musicOut = ctx.createGain();
    this.musicOut.gain.value = 0.9;
    this.duck = ctx.createGain();

    this.musicIn.connect(this.lowshelf).connect(this.lowpass);
    this.lowpass.connect(this.musicDry).connect(this.musicOut);
    this.lowpass.connect(this.chorusDelay).connect(this.chorusWet).connect(this.musicOut);
    this.lowpass.connect(this.reverb).connect(this.reverbWet).connect(this.musicOut);
    this.musicOut.connect(this.duck).connect(this.master);

    if (trackEl) {
      this.track = trackEl;
      try {
        this.trackSrc = ctx.createMediaElementSource(trackEl);
        this.trackSrc.connect(this.musicIn);
      } catch (e) { console.warn('[audio] media source failed', e); }
    }

    // sfx bus
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.5;
    this.sfx.connect(this.master);
    this.noise = this._noiseBuffer(2);

    // engine bus
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0.9;
    this.engineBus.connect(this.master);

    if (ctx.state !== 'running') await ctx.resume();
    this.setDepth(1, true);
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  async play() {
    if (!this.ctx) return;
    this.enabled = true;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (this.track) {
      try { await this.track.play(); } catch (e) { console.warn('[audio] play blocked', e); }
    }
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(1, now, 0.4);
  }

  mute() {
    if (!this.ctx) return;
    this.enabled = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.15);
    clearTimeout(this._pauseT);
    this._pauseT = setTimeout(() => { if (!this.enabled && this.track) this.track.pause(); }, 600);
  }

  // 1 = fully underwater, 0 = clear
  setDepth(d, instant = false) {
    if (!this.ctx) return;
    d = Math.min(1, Math.max(0, d));
    if (!instant && Math.abs(d - this.depth) < 0.002) return;
    this.depth = d;
    const now = this.ctx.currentTime;
    const tc = instant ? 0.001 : 0.08;
    const f = 340 * Math.pow(20000 / 340, Math.pow(1 - d, 1.6));
    this.lowpass.frequency.setTargetAtTime(f, now, tc);
    this.lowpass.Q.setTargetAtTime(0.7 + d * 3.5, now, tc);
    this.lowshelf.gain.setTargetAtTime(d * 6, now, tc);
    this.chorusWet.gain.setTargetAtTime(d * 0.65, now, tc);
    this.chorusDepth.gain.setTargetAtTime(0.001 + d * 0.006, now, tc);
    this.reverbWet.gain.setTargetAtTime(0.06 + d * 0.5, now, tc);
    this.musicDry.gain.setTargetAtTime(1 - d * 0.25, now, tc);
    this.musicOut.gain.setTargetAtTime(0.78 + (1 - d) * 0.2, now, tc);
  }

  setDuck(v) {
    if (!this.ctx) return;
    this.duck.gain.setTargetAtTime(1 - v, this.ctx.currentTime, 0.25);
  }

  analyse() {
    const L = this.levels;
    if (!this.ctx || !this.enabled) { L.bass *= 0.9; L.pulse *= 0.9; return L; }
    this.analyser.getByteFrequencyData(this.freq);
    const f = this.freq;
    let b = 0, m = 0, h = 0;
    for (let i = 1; i < 6; i++) b += f[i];
    for (let i = 8; i < 60; i++) m += f[i];
    for (let i = 80; i < 220; i++) h += f[i];
    b /= 5 * 255; m /= 52 * 255; h /= 140 * 255;
    this._bassAvg += (b - this._bassAvg) * 0.04;
    if (b > this._bassAvg * 1.18 && b > 0.35 && L.bass <= b) L.pulse = Math.min(1, L.pulse + (b - this._bassAvg) * 3);
    L.pulse *= 0.9;
    L.bass = b; L.mid = m; L.high = h;
    return L;
  }

  // ---------- tiny synthesized UI sfx
  tick(freq = 2200, vol = 0.05) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + 0.05);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t); o.stop(t + 0.07);
  }

  whoosh(dur = 0.7, vol = 0.25, up = true) {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(up ? 300 : 3000, t);
    bp.frequency.exponentialRampToValueAtTime(up ? 3200 : 260, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  ignite() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // flint click
    this.tick(5200, 0.08);
    // whoomp
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    lp.frequency.exponentialRampToValueAtTime(600, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(lp).connect(g).connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + 1.2);
    // crackles
    for (let i = 0; i < 8; i++) {
      const tt = t + 0.1 + Math.random() * 0.9;
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2500;
      const gg = ctx.createGain();
      gg.gain.setValueAtTime(0.0001, tt);
      gg.gain.exponentialRampToValueAtTime(0.12 * Math.random() + 0.03, tt + 0.003);
      gg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.03);
      s.connect(hp).connect(gg).connect(this.sfx);
      s.start(tt, Math.random()); s.stop(tt + 0.05);
    }
  }
}
