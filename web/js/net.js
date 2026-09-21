// Connexion WebSocket + synchronisation d'horloge avec le serveur.
import { HTTP_BASE, WS_URL } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un Space HF gratuit s'endort : on le réveille avec des requêtes /health jusqu'à ce qu'il réponde.
export async function fetchLobby(timeoutMs = 4000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${HTTP_BASE}/api/rooms`, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.ok ? j : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function wakeServer(onTick, shouldCancel) {
  const t0 = Date.now();
  for (;;) {
    if (shouldCancel()) return false;
    const lobby = await fetchLobby(5000);
    if (lobby) return true;
    const s = Math.round((Date.now() - t0) / 1000);
    if (s > 120) return false;
    onTick(s);
    await sleep(2500);
  }
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.offset = null;   // serveur - client (ms)
    this.rtt = 0;
    this.pingTimer = 0;
    this.open = false;
  }

  on(type, fn) { this.handlers.set(type, fn); return this; }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      this.ws = ws;
      const fail = setTimeout(() => { try { ws.close(); } catch { /* */ } reject(new Error('timeout')); }, 10000);
      ws.onopen = () => {
        clearTimeout(fail);
        this.open = true;
        this._startPing();
        resolve();
      };
      ws.onerror = () => { clearTimeout(fail); reject(new Error('erreur de connexion')); };
      ws.onclose = () => {
        this.open = false;
        clearInterval(this.pingTimer);
        this.handlers.get('close')?.();
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') return this._onPong(m);
        this.handlers.get(m.t)?.(m);
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.handlers.delete('close');
    clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* */ }
    this.open = false;
  }

  _startPing() {
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping(); setTimeout(ping, 250); setTimeout(ping, 600);
    this.pingTimer = setInterval(ping, 2000);
  }

  _onPong(m) {
    const now = Date.now();
    this.rtt = now - m.c;
    const sample = m.s + this.rtt / 2 - now;
    this.offset = this.offset === null ? sample : this.offset * 0.7 + sample * 0.3;
  }

  // Heure du serveur estimée (ms, même repère que `ts` dans les snapshots)
  serverNow() { return Date.now() + (this.offset ?? 0); }
  syncFromWelcome(ts) { if (this.offset === null) this.offset = ts - Date.now(); }
}
