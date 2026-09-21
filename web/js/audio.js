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

  // name: ar shotgun sniper revolver knife | hit headshot kill hurt reload empty spawn
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
