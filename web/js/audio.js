// Sons synthétisés à la volée (WebAudio) : aucun fichier audio à charger.

class Sfx {
  constructor() { this.ctx = null; this.master = null; this.volume = 0.6; this.noise = null; }

  // À appeler depuis un geste utilisateur (clic sur JOUER)
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  _out(gain, pan) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); node = p;
    }
    node.connect(this.master);
    return g;
  }

  _burst({ dur, type = 'lowpass', freq, freqEnd, q = 1, gain = 1, out }) {
    const c = this.ctx, t = c.currentTime;
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }

  _tone({ dur, freq, freqEnd, type = 'sine', gain = 1, out, delay = 0 }) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // Sirène du missile nucléaire : alarme qui monte et descend pendant ms millisecondes
  siren(ms) {
    if (!this.ctx || this.volume <= 0) return;
    const out = this._out(0.7, 0);
    for (let i = 0; i * 0.45 * 1000 < ms; i++) this._tone({ dur: 0.42, freq: 520, freqEnd: 900, type: 'sawtooth', gain: 0.22, out, delay: i * 0.45 });
  }

  // name: ar shotgun sniper revolver knife rocket grenade excalibur grapple portal minigun laser carbine flame nuke raygun ballista cheat wave stun streak nukeboom boom | hit headshot kill hurt reload empty spawn
  // opts: gain (0..1, atténuation distance), pan (-1..1)
  play(name, { gain = 1, pan = 0 } = {}) {
    if (!this.ctx || this.volume <= 0 || gain <= 0.01) return;
    const out = this._out(gain, pan);
    switch (name) {
      case 'ar':
        this._burst({ dur: 0.09, type: 'bandpass', freq: 2200, freqEnd: 900, q: 0.8, gain: 0.9, out });
        this._tone({ dur: 0.07, freq: 150, freqEnd: 60, type: 'square', gain: 0.35, out });
        break;
      case 'shotgun':
        this._burst({ dur: 0.35, type: 'lowpass', freq: 2500, freqEnd: 300, gain: 1.2, out });
        this._tone({ dur: 0.2, freq: 110, freqEnd: 40, type: 'sawtooth', gain: 0.6, out });
        break;
      case 'sniper':
        this._burst({ dur: 0.6, type: 'lowpass', freq: 3500, freqEnd: 200, gain: 1.3, out });
        this._tone({ dur: 0.4, freq: 90, freqEnd: 30, type: 'sawtooth', gain: 0.8, out });
        break;
      case 'revolver':
        this._burst({ dur: 0.22, type: 'bandpass', freq: 1800, freqEnd: 500, q: 0.7, gain: 1.1, out });
        this._tone({ dur: 0.16, freq: 130, freqEnd: 45, type: 'square', gain: 0.5, out });
        break;
      case 'knife':
        this._burst({ dur: 0.14, type: 'highpass', freq: 800, freqEnd: 4000, q: 0.5, gain: 0.5, out });
        break;
      case 'rocket':
        this._burst({ dur: 0.5, type: 'lowpass', freq: 1800, freqEnd: 200, gain: 1.1, out });
        this._tone({ dur: 0.35, freq: 200, freqEnd: 60, type: 'sawtooth', gain: 0.5, out });
        break;
      case 'grenade':
        this._burst({ dur: 0.2, type: 'lowpass', freq: 900, freqEnd: 150, gain: 1.0, out });
        this._tone({ dur: 0.18, freq: 120, freqEnd: 45, type: 'square', gain: 0.6, out });
        break;
      case 'excalibur':
        this._burst({ dur: 0.22, type: 'highpass', freq: 600, freqEnd: 5000, q: 0.6, gain: 0.7, out });
        this._tone({ dur: 0.4, freq: 1568, freqEnd: 1500, type: 'triangle', gain: 0.18, out, delay: 0.04 });
        break;
      case 'grapple':
        this._tone({ dur: 0.18, freq: 300, freqEnd: 1100, type: 'square', gain: 0.3, out });
        this._burst({ dur: 0.12, type: 'bandpass', freq: 3000, q: 1.5, gain: 0.5, out });
        break;
      case 'portal':
        this._tone({ dur: 0.25, freq: 500, freqEnd: 1300, type: 'sine', gain: 0.4, out });
        this._tone({ dur: 0.2, freq: 700, freqEnd: 1600, type: 'triangle', gain: 0.2, out, delay: 0.03 });
        break;
      case 'portal2':
        this._tone({ dur: 0.25, freq: 900, freqEnd: 350, type: 'sine', gain: 0.4, out });
        this._tone({ dur: 0.2, freq: 1200, freqEnd: 500, type: 'triangle', gain: 0.2, out, delay: 0.03 });
        break;
      case 'minigun':
        this._burst({ dur: 0.05, type: 'bandpass', freq: 1800, freqEnd: 800, q: 0.8, gain: 0.55, out });
        this._tone({ dur: 0.04, freq: 120, freqEnd: 60, type: 'square', gain: 0.2, out });
        break;
      case 'laser':
        this._tone({ dur: 0.07, freq: 1400, freqEnd: 900, type: 'sawtooth', gain: 0.22, out });
        this._tone({ dur: 0.06, freq: 2100, freqEnd: 1500, type: 'sine', gain: 0.15, out });
        break;
      case 'carbine':
        this._burst({ dur: 0.5, type: 'lowpass', freq: 4000, freqEnd: 250, gain: 1.4, out });
        this._tone({ dur: 0.35, freq: 100, freqEnd: 30, type: 'sawtooth', gain: 0.9, out });
        break;
      case 'flame':
        this._burst({ dur: 0.09, type: 'bandpass', freq: 700, freqEnd: 350, q: 0.6, gain: 0.8, out });
        break;
      case 'nuke':
        this._burst({ dur: 0.9, type: 'lowpass', freq: 2400, freqEnd: 120, gain: 1.2, out });
        this._tone({ dur: 0.8, freq: 90, freqEnd: 400, type: 'sawtooth', gain: 0.5, out });
        break;
      case 'wave':
        this._burst({ dur: 0.7, type: 'highpass', freq: 400, freqEnd: 6000, q: 0.5, gain: 1.0, out });
        this._tone({ dur: 0.9, freq: 180, freqEnd: 40, type: 'sawtooth', gain: 0.9, out });
        this._tone({ dur: 0.8, freq: 1568, freqEnd: 800, type: 'triangle', gain: 0.25, out, delay: 0.05 });
        break;
      case 'stun':
        this._tone({ dur: 0.35, freq: 90, freqEnd: 60, type: 'square', gain: 0.35, out });
        this._burst({ dur: 0.3, type: 'bandpass', freq: 1200, q: 2, gain: 0.5, out });
        break;
      case 'streak':
        [392, 523, 659, 784].forEach((f, i) => this._tone({ dur: 0.12, freq: f, type: 'square', gain: 0.22, out, delay: i * 0.08 }));
        break;
      case 'nukeboom':
        this._burst({ dur: 3.0, type: 'lowpass', freq: 1400, freqEnd: 40, gain: 2.2, out });
        this._tone({ dur: 2.5, freq: 60, freqEnd: 18, type: 'sawtooth', gain: 1.2, out });
        this._tone({ dur: 1.5, freq: 40, freqEnd: 15, type: 'sine', gain: 1.0, out });
        break;
      case 'boom':
        this._burst({ dur: 0.9, type: 'lowpass', freq: 1600, freqEnd: 90, gain: 1.7, out });
        this._tone({ dur: 0.6, freq: 80, freqEnd: 25, type: 'sawtooth', gain: 0.9, out });
        break;
      case 'orb':
        this._burst({ dur: 0.9, type: 'lowpass', freq: 1800, freqEnd: 80, gain: 1.6, out });
        this._tone({ dur: 0.7, freq: 70, freqEnd: 30, type: 'sawtooth', gain: 0.9, out });
        this._tone({ dur: 0.8, freq: 1400, freqEnd: 200, type: 'sine', gain: 0.3, out, delay: 0.02 });
        break;
      case 'charge':
        this._tone({ dur: 1.5, freq: 120, freqEnd: 900, type: 'sawtooth', gain: 0.22, out });
        this._tone({ dur: 1.5, freq: 240, freqEnd: 1800, type: 'sine', gain: 0.18, out });
        break;
      case 'plane':
        this._burst({ dur: 0.4, type: 'bandpass', freq: 1500, freqEnd: 700, q: 0.4, gain: 0.35, out });
        break;
      case 'raygun':
        this._tone({ dur: 0.09, freq: 2200, freqEnd: 500, type: 'sawtooth', gain: 0.35, out });
        this._tone({ dur: 0.07, freq: 3200, freqEnd: 1200, type: 'sine', gain: 0.2, out, delay: 0.01 });
        break;
      case 'ballista':
        this._burst({ dur: 0.55, type: 'lowpass', freq: 3800, freqEnd: 220, gain: 1.3, out });
        this._tone({ dur: 0.38, freq: 95, freqEnd: 32, type: 'sawtooth', gain: 0.85, out });
        break;
      case 'cheat':
        this._burst({ dur: 0.12, type: 'lowpass', freq: 2600, freqEnd: 300, gain: 1.1, out });
        this._tone({ dur: 0.1, freq: 160, freqEnd: 50, type: 'sawtooth', gain: 0.55, out });
        this._tone({ dur: 0.08, freq: 2400, freqEnd: 1800, type: 'sine', gain: 0.15, out, delay: 0.01 });
        break;
      case 'throw':
        this._burst({ dur: 0.18, type: 'bandpass', freq: 900, freqEnd: 300, q: 0.7, gain: 0.35, out });
        break;
      case 'tick': // impact probable, joué tout de suite (avant la confirmation du serveur)
        this._tone({ dur: 0.04, freq: 1000, type: 'square', gain: 0.1, out });
        break;
      case 'hit':
        this._tone({ dur: 0.05, freq: 1300, type: 'square', gain: 0.25, out });
        break;
      case 'headshot':
        this._tone({ dur: 0.07, freq: 1900, type: 'square', gain: 0.3, out });
        this._tone({ dur: 0.09, freq: 2600, type: 'square', gain: 0.25, out, delay: 0.05 });
        break;
      case 'kill':
        this._tone({ dur: 0.08, freq: 880, type: 'square', gain: 0.25, out });
        this._tone({ dur: 0.14, freq: 1320, type: 'square', gain: 0.25, out, delay: 0.08 });
        break;
      case 'hurt':
        this._tone({ dur: 0.18, freq: 160, freqEnd: 70, type: 'sawtooth', gain: 0.5, out });
        break;
      case 'reload':
        this._burst({ dur: 0.05, type: 'bandpass', freq: 3000, gain: 0.5, out });
        this._burst({ dur: 0.06, type: 'bandpass', freq: 2200, gain: 0.5, out });
        break;
      case 'empty':
        this._tone({ dur: 0.04, freq: 500, type: 'square', gain: 0.2, out });
        break;
      case 'spawn':
        this._tone({ dur: 0.15, freq: 400, freqEnd: 800, type: 'triangle', gain: 0.25, out });
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this._tone({ dur: 0.18, freq: f, type: 'square', gain: 0.2, out, delay: i * 0.12 }));
        break;
    }
  }
}

export const sfx = new Sfx();
