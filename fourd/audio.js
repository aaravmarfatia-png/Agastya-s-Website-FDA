// Procedural binaural audio (Web Audio API, HRTF PannerNodes). Created only after a user click,
// muted until enabled, closed on exit. Sources are positioned in camera space so that rotating the
// globe moves the sound around the listener's head.
export class SpatialAudio {
  constructor() { this.ctx = null; this.on = false; }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // three drone voices on a harmonic series (A1, E2, A2) orbiting the listener
    this.voices = [55, 82.41, 110].map((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 1 ? "triangle" : "sine";
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = "lowpass"; filt.frequency.value = 420; filt.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = [0.32, 0.12, 0.16][i];
      const p = this.panner();
      osc.connect(filt).connect(g).connect(p).connect(this.master);
      osc.start();
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.03;
      const lg = ctx.createGain(); lg.gain.value = 160;
      lfo.connect(lg).connect(filt.frequency); lfo.start();
      return { osc, filt, g, p, base: f, angle: (i / 3) * Math.PI * 2, lfo };
    });
    // W-axis shimmer voice (fifth above the octave), faded in with W
    this.shimmer = ctx.createOscillator(); this.shimmer.type = "sine"; this.shimmer.frequency.value = 330;
    this.shimmerGain = ctx.createGain(); this.shimmerGain.gain.value = 0;
    this.shimmerPan = this.panner();
    this.shimmer.connect(this.shimmerGain).connect(this.shimmerPan).connect(this.master);
    this.shimmer.start();

    this.on = true;
    this.master.gain.setTargetAtTime(0.55, ctx.currentTime, 0.8);
  }

  panner() {
    const p = this.ctx.createPanner();
    p.panningModel = "HRTF"; p.distanceModel = "inverse"; p.refDistance = 1; p.rolloffFactor = 0.6;
    return p;
  }

  setPos(p, x, y, z) {
    const t = this.ctx.currentTime;
    if (p.positionX) { p.positionX.setTargetAtTime(x, t, 0.08); p.positionY.setTargetAtTime(y, t, 0.08); p.positionZ.setTargetAtTime(z, t, 0.08); }
    else p.setPosition(x, y, z);
  }

  /** called every frame: globeYaw rotates the drone ring, w = W-axis depth, speed = time-scrub speed */
  update(globeYaw, w, speed) {
    if (!this.on) return;
    this.voices.forEach((v, i) => {
      const a = v.angle + globeYaw;
      this.setPos(v.p, Math.sin(a) * 2.2, (i - 1) * 0.6, -Math.cos(a) * 2.2);
      v.osc.detune.setTargetAtTime(Math.max(-600, Math.min(600, speed * 40)), this.ctx.currentTime, 0.2);
    });
    this.shimmerGain.gain.setTargetAtTime(0.04 * Math.min(1, w), this.ctx.currentTime, 0.3);
    this.shimmer.frequency.setTargetAtTime(330 * (1 + w * 0.25), this.ctx.currentTime, 0.3);
    this.setPos(this.shimmerPan, Math.sin(globeYaw * 2) * 1.5, 1.2, -1);
  }

  /** a short sonar ping from a direction in camera space */
  ping(dir, pitch = 880, gain = 0.18) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(pitch, t); o.frequency.exponentialRampToValueAtTime(pitch * 0.5, t + 0.5);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    const p = this.panner(); this.setPos(p, dir.x * 2, dir.y * 2, dir.z * 2);
    o.connect(g).connect(p).connect(this.master);
    o.start(t); o.stop(t + 0.65);
  }

  /** shockwave: filtered noise sweep + sub thump */
  shock(dir) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = ctx.sampleRate * 1.6, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    const n = ctx.createBufferSource(); n.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 4;
    bp.frequency.setValueAtTime(180, t); bp.frequency.exponentialRampToValueAtTime(2400, t + 1.4);
    const g = ctx.createGain(); g.gain.value = 0.22;
    const p = this.panner(); this.setPos(p, dir.x * 2, dir.y * 2, dir.z * 2);
    n.connect(bp).connect(g).connect(p).connect(this.master); n.start(t);
    const s = ctx.createOscillator(); s.frequency.setValueAtTime(70, t); s.frequency.exponentialRampToValueAtTime(32, t + 0.6);
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0.5, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    s.connect(sg).connect(this.master); s.start(t); s.stop(t + 0.75);
  }

  async stop() {
    if (!this.ctx) return;
    this.on = false;
    try { this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); } catch { /* ignore */ }
    const ctx = this.ctx; this.ctx = null;
    setTimeout(() => ctx.close().catch(() => {}), 250);
  }
}
