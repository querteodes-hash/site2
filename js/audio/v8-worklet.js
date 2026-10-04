// Twin-turbo V8 (S63-ish) synthesizer.
// Exhaust pulse train (8 firings per 720°, per-cylinder variation) → pipe resonances
// → rpm/load-tracking low-pass → saturation. Overrun produces afterfire pops.

class V8Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 9000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'starter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    this.fs = sampleRate;
    const cyl = options?.processorOptions?.cylinders === 6 ? 6 : 8;
    this.ncyl = cyl;
    this.phase = 0;
    this.nextFire = 0;
    this.cyl = 0;
    // V8: uneven bank pulses give the burble; I6: even and raspier
    this.amps = cyl === 8 ? [1.0, 0.8, 0.95, 0.76, 0.98, 0.84, 0.9, 0.79] : [1.0, 0.9, 0.97, 0.88, 0.99, 0.91];
    this.bank = cyl === 8 ? [0, 1, 0, 1, 1, 0, 1, 0] : [0, 1, 0, 1, 0, 1];
    this.pulses = [];
    this.bufL = new Float32Array(8192);
    this.bufR = new Float32Array(8192);
    this.bi = 0;
    this.d1L = Math.round(this.fs * 0.0031); this.d2L = Math.round(this.fs * 0.0073);
    this.d1R = Math.round(this.fs * 0.0034); this.d2R = Math.round(this.fs * 0.0079);
    this.svL = { low: 0, band: 0 }; this.svR = { low: 0, band: 0 };
    this.sv2L = { low: 0, band: 0 }; this.sv2R = { low: 0, band: 0 };
    this.dcL = { x: 0, y: 0 }; this.dcR = { x: 0, y: 0 };
    this.inL = { x: 0, y: 0 }; this.inR = { x: 0, y: 0 };
    this.rpmS = 0; this.loadS = 0; this.rpmPrev = 0;
    this.seed = 0x9e3779b9;
    this.starterPh = 0;
    this.time = 0;
    this.popCool = 0;
    this.noiseLP = 0;
    this.stLP = 0;
  }

  rand() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  fire(rpm, decel) {
    const c = this.cyl;
    this.cyl = (c + 1) % this.ncyl;
    const load = this.loadS;
    let amp = this.amps[c] * (0.45 + 0.55 * load) * (0.88 + this.rand() * 0.24);
    let pop = false;
    if (decel && load < 0.08 && rpm > 2400 && this.popCool <= 0 && this.rand() < 0.11 * (rpm / 7000)) {
      pop = true;
      amp = 2.2 + this.rand() * 1.6;
      this.popCool = this.fs * (0.025 + this.rand() * 0.05);
      this.port.postMessage('pop');
    }
    const tau = (pop ? 0.011 + this.rand() * 0.01 : 0.0016 + 0.0024 * (1 - Math.min(1, rpm / 8000))) * this.fs;
    const rise = tau * (pop ? 0.05 : 0.14);
    this.pulses.push({
      e1: 1, e2: 1,
      d1: Math.exp(-1 / tau), d2: Math.exp(-1 / Math.max(1, rise)),
      amp, bank: this.bank[c], pop, life: tau * 7,
    });
  }

  // TPT state-variable low-pass (stable at any cutoff); k = damping (1/Q)
  svf(s, x, fc, k) {
    const g = Math.tan(Math.PI * Math.min(fc, this.fs * 0.45) / this.fs);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - s.band;
    const v1 = a1 * s.low + a2 * v3;
    const v2 = s.band + a2 * s.low + a3 * v3;
    s.low = 2 * v1 - s.low;
    s.band = 2 * v2 - s.band;
    return v2;
  }

  process(_inputs, outputs, params) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    const n = L.length;
    const rpmT = params.rpm[0];
    const loadT = params.load[0];
    const starter = params.starter[0];
    const fs = this.fs;

    for (let i = 0; i < n; i++) {
      this.rpmS += (rpmT - this.rpmS) * 0.0012;
      this.loadS += (loadT - this.loadS) * 0.0025;
      const rpm = this.rpmS;
      const decel = rpmT < rpm - 40;
      if (this.popCool > 0) this.popCool--;

      if (rpm > 60) {
        this.phase += rpm / 120 / fs;
        if (this.phase >= this.nextFire) {
          this.fire(rpm, decel);
          const jitter = (this.rand() - 0.5) * (0.07 - 0.05 * Math.min(1, rpm / 3000));
          this.nextFire += (1 / this.ncyl) * (1 + jitter);
        }
        if (this.phase >= 1) { this.phase -= 1; this.nextFire -= 1; }
      }

      // sum active pulses
      let xl = 0, xr = 0;
      for (let k = this.pulses.length - 1; k >= 0; k--) {
        const p = this.pulses[k];
        p.e1 *= p.d1; p.e2 *= p.d2;
        let v = p.amp * (p.e1 - p.e2);
        if (p.pop) v *= 0.5 + this.rand() * 1.3;
        else v *= 1 + (this.rand() - 0.5) * 0.35;
        if (p.bank === 0) { xl += v; xr += v * 0.45; } else { xr += v; xl += v * 0.45; }
        if (--p.life <= 0) this.pulses.splice(k, 1);
      }

      // remove the pulse train's DC before resonances/saturation
      const hl = xl - this.inL.x + 0.996 * this.inL.y; this.inL.x = xl; this.inL.y = hl; xl = hl;
      const hr = xr - this.inR.x + 0.996 * this.inR.y; this.inR.x = xr; this.inR.y = hr; xr = hr;

      // pipe resonances (two combs per side)
      const bi = this.bi;
      const m = 8191;
      const cl = xl + 0.42 * this.bufL[(bi - this.d1L) & m] + 0.3 * this.bufL[(bi - this.d2L) & m];
      const cr = xr + 0.42 * this.bufR[(bi - this.d1R) & m] + 0.3 * this.bufR[(bi - this.d2R) & m];
      this.bufL[bi] = cl * 0.62;
      this.bufR[bi] = cr * 0.62;
      this.bi = (bi + 1) & m;

      // tone: muffled at idle, opens with rpm and load
      const fc = 240 + rpm * 0.5 + this.loadS * 2400;
      let yl = this.svf(this.sv2L, this.svf(this.svL, cl, fc, 1.1), fc * 1.6, 1.3);
      let yr = this.svf(this.sv2R, this.svf(this.svR, cr, fc, 1.1), fc * 1.6, 1.3);

      // saturation
      const drive = 1.4 + this.loadS * 2.6;
      const nrm = 1 / Math.tanh(drive);
      yl = Math.tanh(yl * drive) * nrm;
      yr = Math.tanh(yr * drive) * nrm;

      // intake / mechanical hiss
      const wn = this.rand() * 2 - 1;
      this.noiseLP += (wn - this.noiseLP) * 0.25;
      const hiss = this.noiseLP * (0.004 + 0.035 * this.loadS * Math.min(1, rpm / 6500));
      yl += hiss; yr += hiss;

      // starter motor
      if (starter > 0.001) {
        this.time += 1 / fs;
        this.starterPh = (this.starterPh + 150 / fs) % 1;
        const saw = this.starterPh * 2 - 1;
        const mod = 0.55 + 0.45 * Math.sin(this.time * 2 * Math.PI * 9.5);
        const s = (saw * 0.6 + wn * 0.25) * mod * starter;
        this.stLP += (s - this.stLP) * 0.12;
        yl += this.stLP * 0.22; yr += this.stLP * 0.22;
      }

      // DC block
      const ol = yl - this.dcL.x + 0.995 * this.dcL.y; this.dcL.x = yl; this.dcL.y = ol;
      const or = yr - this.dcR.x + 0.995 * this.dcR.y; this.dcR.x = yr; this.dcR.y = or;
      L[i] = ol * 0.42;
      R[i] = or * 0.42;
    }
    return true;
  }
}

registerProcessor('v8', V8Processor);
