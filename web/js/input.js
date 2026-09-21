// Entrées : clavier/souris (pointer lock) sur PC, joystick + boutons sur mobile.
// Les mouvements de caméra sont renvoyés en radians "à sensibilité 1" ; le jeu applique ensuite le réglage.
import { isTouch } from './config.js';

const LOOK_MOUSE = 0.0022; // rad par pixel
const LOOK_TOUCH = 0.0042;
const STICK_R = 55;
const KEY_LOOK = 2.4;      // rad/s max : viser avec les flèches (portable sans souris)
const KEY_LOOK_MIN = 0.55; // ...en démarrant lentement pour pouvoir viser finement
const FIRE_KEYS = ['KeyF', 'Enter', 'NumpadEnter', 'ControlRight']; // tirer au clavier

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.enabled = false;        // mis à true par le jeu quand une partie tourne et n'est pas en pause
    this.locked = false;         // pointer lock (PC)
    this.keys = new Set();
    this.fireSrc = { mouse: false, key: false, touch: false }; // plusieurs sources : clic, clavier, bouton tactile
    this.scopeHeld = false;
    this.jumpHeld = false;
    this.scoreHeld = false;
    this.stick = { x: 0, y: 0 };
    this.onPause = null;         // demande de pause (bouton tactile)
    this.onLockChange = null;    // (locked) => void
    this._firePressAt = -1e9;
    this._reload = false;
    this._weapon = null;
    this._cycle = 0;
    this._scopeToggle = false;
    this._alt = false;           // tir secondaire (pistolet portail) : clic droit, E, ou bouton ZOOM sur mobile
    this._mapToggle = false;
    this._arrowT = { x: 0, y: 0 };
    this._lookX = 0;
    this._lookY = 0;
    this.touches = new Map();
    if (isTouch) this._initTouch(); else this._initDesktop();
  }

  get active() { return this.enabled && (isTouch || this.locked); }
  get fireHeld() { const f = this.fireSrc; return f.mouse || f.key || f.touch; }

  get moveX() {
    if (isTouch) return this.stick.x;
    return (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
  }
  get moveY() {
    if (isTouch) return this.stick.y;
    return (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
  }

  takeLook(dt = 0) {
    if (dt && !isTouch) { // flèches : viser au clavier
      const k = this.keys, t = this._arrowT;
      const kx = (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0);
      const ky = (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0);
      t.x = kx ? t.x + dt : 0;                       // plus on garde la flèche, plus ça tourne vite
      t.y = ky ? t.y + dt : 0;
      const speed = (s) => KEY_LOOK_MIN + Math.min(1, s / 0.4) * (KEY_LOOK - KEY_LOOK_MIN);
      this._lookX += kx * speed(t.x) * dt;
      this._lookY += ky * speed(t.y) * dt;
    }
    const r = [this._lookX, this._lookY];
    this._lookX = this._lookY = 0;
    return this.active ? r : [0, 0];
  }
  takeFirePress(now, windowMs = 150) {
    const ok = now - this._firePressAt < windowMs;
    this._firePressAt = -1e9;
    return ok && this.active;
  }
  takeMapToggle() { const r = this._mapToggle; this._mapToggle = false; return r && this.active; }
  takeReload() { const r = this._reload; this._reload = false; return r && this.active; }
  takeWeapon() { const w = this._weapon; this._weapon = null; return this.active ? w : null; }
  takeCycle() { const c = this._cycle; this._cycle = 0; return this.active ? c : 0; }
  takeAlt() { const r = this._alt; this._alt = false; return r && this.active; }
  takeScopeToggle() { const r = this._scopeToggle; this._scopeToggle = false; return r && this.active; }

  reset() {
    this.keys.clear();
    this.fireSrc.mouse = this.fireSrc.key = this.fireSrc.touch = false;
    this.scopeHeld = this.jumpHeld = this.scoreHeld = false;
    this.stick.x = this.stick.y = 0;
    this._lookX = this._lookY = 0;
    this._reload = false; this._weapon = null; this._cycle = 0; this._scopeToggle = false; this._alt = false; this._mapToggle = false;
    this._arrowT.x = this._arrowT.y = 0;
  }

  requestLock() {
    if (isTouch) return;
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.canvas.requestPointerLock(); } catch { /* */ } });
    } catch {
      try { this.canvas.requestPointerLock(); } catch { /* */ }
    }
  }

  // ------------------------------------------------------------ PC ----
  _initDesktop() {
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) this.reset();
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const c = e.code;
      if (c === 'Tab') { e.preventDefault(); this.scoreHeld = true; return; }
      if (c === 'Space') { e.preventDefault(); this.jumpHeld = true; return; }
      if (c === 'KeyR') { this._reload = true; return; }
      if (c === 'KeyM') { this._mapToggle = true; return; }
      if (c === 'KeyE') { this._alt = true; return; }
      if (FIRE_KEYS.includes(c)) {
        e.preventDefault();
        if (!this.fireSrc.key) this._firePressAt = performance.now();
        this.fireSrc.key = true;
        return;
      }
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(c);
      if (m) { this._weapon = Number(m[1]) - 1; return; }
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c)) {
        e.preventDefault();
        this.keys.add(c);
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (FIRE_KEYS.includes(e.code)) this.fireSrc.key = false;
      if (e.code === 'Space') this.jumpHeld = false;
      if (e.code === 'Tab') { this.scoreHeld = false; e.preventDefault(); }
    });
    window.addEventListener('blur', () => this.reset());

    document.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) { this.fireSrc.mouse = true; this._firePressAt = performance.now(); }
      if (e.button === 2) { this.scopeHeld = true; this._alt = true; }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireSrc.mouse = false;
      if (e.button === 2) this.scopeHeld = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active) return;
      // Chrome envoie parfois un énorme saut de souris : on l'ignore
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this._lookX += e.movementX * LOOK_MOUSE;
      this._lookY += e.movementY * LOOK_MOUSE;
    });
    document.addEventListener('wheel', (e) => {
      if (!this.active) return;
      this._cycle += e.deltaY > 0 ? 1 : -1;
    }, { passive: true });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ------------------------------------------------------------ Mobile ----
  _initTouch() {
    const root = document.getElementById('touch');
    const base = document.getElementById('stick-base');
    const knob = document.getElementById('stick-knob');

    const press = (act, on, arg) => {
      switch (act) {
        case 'fire': this.fireSrc.touch = on; if (on) this._firePressAt = performance.now(); break;
        case 'jump': this.jumpHeld = on; break;
        case 'score': this.scoreHeld = on; break;
        case 'reload': if (on) this._reload = true; break;
        case 'scope': if (on) { this._scopeToggle = true; this._alt = true; } break;
        case 'pause': if (on) this.onPause?.(); break;
        case 'weapon': if (on) this._weapon = arg; break;
      }
    };

    root.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const el = t.target.closest ? t.target.closest('[data-act],[data-w]') : null;
        if (el) {
          const isW = el.dataset.w !== undefined;
          const act = isW ? 'weapon' : el.dataset.act;
          this.touches.set(t.identifier, { role: act, el, x: t.clientX, y: t.clientY });
          el.classList.add('down');
          press(act, true, isW ? Number(el.dataset.w) : undefined);
        } else if (t.clientX < innerWidth * 0.45 && ![...this.touches.values()].some((v) => v.role === 'stick')) {
          this.touches.set(t.identifier, { role: 'stick', ox: t.clientX, oy: t.clientY });
          base.style.display = 'block';
          base.style.left = `${t.clientX}px`;
          base.style.top = `${t.clientY}px`;
          knob.style.transform = 'translate(0,0)';
        } else {
          this.touches.set(t.identifier, { role: 'look', x: t.clientX, y: t.clientY });
        }
      }
    }, { passive: false });

    root.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = this.touches.get(t.identifier);
        if (!s) continue;
        if (s.role === 'stick') {
          let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
          const len = Math.hypot(dx, dy);
          if (len > STICK_R) { dx = (dx / len) * STICK_R; dy = (dy / len) * STICK_R; }
          knob.style.transform = `translate(${dx}px, ${dy}px)`;
          const nx = dx / STICK_R, ny = -dy / STICK_R;
          this.stick.x = Math.abs(nx) < 0.12 ? 0 : nx;
          this.stick.y = Math.abs(ny) < 0.12 ? 0 : ny;
        } else if (s.role === 'look' || s.role === 'fire') {
          this._lookX += (t.clientX - s.x) * LOOK_TOUCH;
          this._lookY += (t.clientY - s.y) * LOOK_TOUCH;
          s.x = t.clientX; s.y = t.clientY;
        }
      }
    }, { passive: false });

    const end = (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const s = this.touches.get(t.identifier);
        if (!s) continue;
        this.touches.delete(t.identifier);
        if (s.role === 'stick') {
          this.stick.x = this.stick.y = 0;
          base.style.display = 'none';
        } else if (s.el) {
          s.el.classList.remove('down');
          press(s.role, false);
        }
      }
    };
    root.addEventListener('touchend', end, { passive: false });
    root.addEventListener('touchcancel', end, { passive: false });

    // Empêche le zoom/pincement iOS
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }
}
