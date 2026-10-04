// Engine controller: rpm physics, start/stop sequence, rev limiter, turbo whistle.


export class V8 {
  constructor(hub) {
    this.hub = hub;
    this.cfg = { cylinders: 8, idle: 780, redline: 7200 };
    this.rpm = 0;
    this.running = false;
    this.starting = 0;
    this.throttle = 0;       // input 0/1
    this.load = 0;           // effective
    this.cut = 0;
    this.boost = 0;
    this.ready = false;
    this.onPop = null;
    this.onState = null;
  }

  configure(cfg) { if (!this.ready) Object.assign(this.cfg, cfg); }

  async init() {
    const ctx = this.hub.ctx;
    if (!ctx || this.ready) return this.ready;
    if (!ctx.audioWorklet) return false;
    try {
      await ctx.audioWorklet.addModule(new URL('./v8-worklet.js', import.meta.url));
    } catch (e) {
      console.warn('[v8] worklet failed', e);
      return false;
    }
    this.node = new AudioWorkletNode(ctx, 'v8', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { cylinders: this.cfg.cylinders } });
    this.node.port.onmessage = (e) => { if (e.data === 'pop' && this.onPop) this.onPop(); };
    this.pRpm = this.node.parameters.get('rpm');
    this.pLoad = this.node.parameters.get('load');
    this.pStarter = this.node.parameters.get('starter');

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    const body = ctx.createBiquadFilter();
    body.type = 'peaking'; body.frequency.value = 110; body.Q.value = 0.8; body.gain.value = 5;
    this.node.connect(body).connect(this.out);

    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 2000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.out);
    this.turbo.start();

    this.out.connect(this.hub.engineBus);
    this.ready = true;
    return true;
  }

  start() {
    if (!this.ready || this.running || this.starting) return;
    this.starting = 0.0001;
    const now = this.hub.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(1, now, 0.05);
    this.hub.setDuck(0.6);
    this.onState?.('starting');
  }

  stop() {
    if (!this.ready) return;
    this.running = false;
    this.starting = 0;
    this.throttle = 0;
    this.pStarter.setValueAtTime(0, this.hub.ctx.currentTime);
    this.hub.setDuck(0);
    this.onState?.('off');
  }

  setThrottle(on) { this.throttle = on ? 1 : 0; }

  update(_frameDt, t) {
    if (!this.ready) return;
    const ctx = this.hub.ctx;
    const now = ctx.currentTime;
    // step on the audio clock so slow frames don't slow the engine down
    const dtAll = Math.min(0.2, this._last == null ? 0.016 : Math.max(0, now - this._last));
    this._last = now;
    const steps = Math.max(1, Math.ceil(dtAll / 0.02));
    for (let i = 0; i < steps; i++) this._step(dtAll / steps, t, now);
    this._apply(dtAll, now);
  }

  _step(dt, t, now) {
    const IDLE = this.cfg.idle, LIMIT = this.cfg.redline + 50;
    let load = 0;

    if (this.starting) {
      this.starting += dt;
      const s = this.starting;
      if (s < 0.8) {
        this.pStarter.setValueAtTime(1, now);
        this.rpm = 210 + Math.sin(s * 60) * 40;
        load = 0.1;
      } else if (s < 1.0) {
        this.pStarter.setValueAtTime(0, now);
        this.rpm += (2500 - this.rpm) * Math.min(1, dt * 18);
        load = 0.75;
      } else {
        this.starting = 0;
        this.running = true;
        this.onState?.('running');
      }
    } else if (this.running) {
      let thr = this.throttle;
      if (this.cut > 0) { this.cut -= dt; thr = 0; }
      if (thr) {
        const accel = 9500 * (1 - Math.pow(this.rpm / 7700, 2)) + 1400;
        this.rpm += accel * dt;
        if (this.rpm >= LIMIT) { this.rpm = LIMIT - 180; this.cut = 0.07; }
        load = 1;
      } else {
        this.rpm -= (2300 + (this.rpm - IDLE) * 0.95) * dt;
        if (this.rpm < IDLE) this.rpm += (IDLE - this.rpm) * Math.min(1, dt * 7);
        load = this.rpm < IDLE * 1.2 ? 0.16 : 0;
      }
      if (!thr && this.rpm < IDLE * 1.1) this.rpm += Math.sin(t * 6.3) * 6;
    } else {
      this.rpm = Math.max(0, this.rpm - (900 + this.rpm * 1.6) * dt);
      if (this.rpm < 30 && this.out.gain.value > 0.001) this.out.gain.setTargetAtTime(0, now, 0.1);
    }

    this.load = load;
  }

  _apply(dt, now) {
    const load = this.load;
    this.pRpm.setValueAtTime(this.rpm, now);
    this.pLoad.setValueAtTime(load, now);

    // turbo spool + whistle
    const want = this.running && load > 0.5 && this.rpm > 2400 ? Math.min(1, (this.rpm - 2400) / 3200) : 0;
    const prev = this.boost;
    this.boost += (want - this.boost) * Math.min(1, dt * (want > this.boost ? 2.6 : 7));
    this.turbo.frequency.setTargetAtTime(1900 + this.boost * 5200, now, 0.05);
    this.turboGain.gain.setTargetAtTime(this.boost * 0.01, now, 0.05);
    if (prev > 0.55 && want === 0 && !this._bov) {
      this._bov = true;
      this._blowOff(prev);
    }
    if (want > 0.3) this._bov = false;
  }

  _blowOff(level) {
    const ctx = this.hub.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.hub.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass'; hp.frequency.setValueAtTime(3200, t); hp.frequency.exponentialRampToValueAtTime(900, t + 0.4); hp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t, Math.random()); src.stop(t + 0.5);
  }
}
