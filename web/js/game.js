// Boucle de jeu : joueur local (prédit côté client), autres joueurs (interpolés), tirs, effets, HUD.
import * as THREE from 'three';
import {
  TICK_MS, INTERP_MS, EYE_HEIGHT, MAX_HP, RESPAWN_MS, WALK_SPEED, WEAPONS, GUN_ORDER, KNIFE,
} from '../shared/config.js';
import { BOXES } from '../shared/map.js';
import { mulberry32, applySpread, lookDir, clamp, angleLerp, rayAABB } from '../shared/util.js';
import { createWorld } from './world.js';
import { buildPlayer, makeNameSprite } from './models.js';
import { ViewModel } from './viewmodel.js';
import { Fx } from './fx.js';
import { stepPlayer } from './physics.js';
import { playerColor } from './hud.js';
import { sfx } from './audio.js';
import { isTouch, saveSettings } from './config.js';
import { Minimap } from './minimap.js';

const MAX_TRACER = 90;

export class Game {
  constructor({ canvas, input, net, hud, getSettings }) {
    this.canvas = canvas;
    this.input = input;
    this.net = net;
    this.hud = hud;
    this.getSettings = getSettings;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 150);
    this.camera.rotation.order = 'YXZ';
    createWorld(this.scene);
    this.fx = new Fx(this.scene);
    this.minimap = new Minimap(document.getElementById('minimap'));

    // 2e scène : l'arme en main
    this.vmScene = new THREE.Scene();
    this.vmScene.add(new THREE.HemisphereLight(0xeaf4ff, 0x556644, 1.6));
    const vl = new THREE.DirectionalLight(0xffffff, 1.4);
    vl.position.set(0.5, 1, 0.6);
    this.vmScene.add(vl);
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 5);
    this.viewmodel = new ViewModel(this.vmScene);

    this.players = new Map();
    this.running = false;
    this.paused = false;
    this.me = null;
    this.state = 'playing';
    this.frames = 0;
    this._v = new THREE.Vector3();

    this._bindNet();
    this.applySettings();
    addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------ réglages ----
  applySettings() {
    const s = this.getSettings();
    sfx.setVolume(s.volume);
    this.resize();
  }

  resize() {
    const s = this.getSettings();
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(Math.max(160, Math.floor(w * s.scale)), Math.max(90, Math.floor(h * s.scale)), false);
    this.aspect = w / h;
    this.minimap?.resize();
    this.camera.aspect = this.aspect;
    this.vmCamera.aspect = this.aspect;
    this.vmCamera.updateProjectionMatrix();
    this._applyFov(true);
  }

  // Le réglage est un FOV horizontal ; three.js veut un FOV vertical.
  baseVFov() {
    const hf = (this.getSettings().fov * Math.PI) / 180;
    return (2 * Math.atan(Math.tan(hf / 2) / this.aspect) * 180) / Math.PI;
  }

  _applyFov(snap) {
    const w = WEAPONS[this.me?.weapon ?? 0];
    const target = this.me?.scoped && w.zoom ? w.zoom : this.baseVFov();
    this.fov = snap || !this.fov ? target : this.fov + (target - this.fov) * 0.35;
    if (snap || Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ cycle de vie ----
  start(welcome) {
    this.stop();
    this.myId = welcome.id;
    this.teamName = welcome.team;
    this.room = welcome.room;
    this.mode = welcome.room.mode;
    this.limit = welcome.room.limit;
    this.gun = welcome.room.mode === 'gun';
    const mine = welcome.players.find((p) => p.id === welcome.id);
    this.state = welcome.state;
    this.winner = welcome.win;
    this.until = welcome.until;
    this.teamKills = welcome.teamKills || { red: 0, blue: 0 };
    this.net.syncFromWelcome(welcome.ts);

    this.me = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, pitch: 0,
      level: mine?.lvl ?? 0,
      hp: MAX_HP, alive: false, spawned: false, weapon: this.gun ? GUN_ORDER[mine?.lvl ?? 0] : 0, ammo: WEAPONS.map((w) => w.mag),
      reloadUntil: 0, nextFire: 0, switchUntil: 0, scoped: false, scopeToggle: false,
      respawnAt: 0, killer: null, deadT: 0, prot: 0, lastSend: 0,
    };
    for (const p of welcome.players) this._addPlayer(p);
    this.viewmodel.setWeapon(this.me.weapon);
    this.hud.setAllowed(this._allowedSet());
    this.fov = 0;
    this._applyFov(true);
    this.scoreDirty = true;
    this.banner();

    this.running = true;
    this.paused = false;
    this.last = performance.now();
    this.fpsT = this.last; this.fpsN = 0; this.fps = 0;
    this.hud.show();
    this.minimap.resize();
    this.hud.hint(isTouch
      ? 'Joystick : bouger · glisser à droite : viser · le tir est automatique sur un ennemi'
      : 'F / Entrée : tirer · Flèches : viser · M : mini-carte · tir auto activé (réglages)', 10000);
    document.body.classList.add('ingame');
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    for (const p of this.players.values()) this._removeModel(p);
    this.players.clear();
    this.fx.clear();
    this.minimap.clear();
    this.input.enabled = false;
    this.input.reset();
    document.body.classList.remove('ingame');
    this.hud.hide();
    document.getElementById('scope').classList.add('hidden');
    document.body.classList.remove('scoped');
  }

  setPaused(v) {
    this.paused = v;
    this.input.enabled = this.running && !v;
    if (v) this.input.reset();
  }

  // ------------------------------------------------------------ joueurs ----
  _addPlayer(info) {
    let p = this.players.get(info.id);
    if (p) return p;
    const color = playerColor(this.mode, info);
    const model = buildPlayer(color);
    model.group.visible = false;
    this.scene.add(model.group);
    p = {
      id: info.id, name: info.name, team: info.team, bot: !!info.bot, k: info.k || 0, d: info.d || 0, lvl: info.lvl || 0,
      hp: info.hp ?? 0, weapon: info.w ?? 0, prot: 0, snaps: [], model, sprite: null, lastX: 0, lastZ: 0, walk: 0,
    };
    // Nom au-dessus de la tête : seulement les coéquipiers en mode équipes (pas de "wallhack")
    if (info.id !== this.myId && this.mode === 'tdm' && info.team === this.myTeam()) {
      p.sprite = makeNameSprite(info.name, color);
      model.group.add(p.sprite);
    }
    this.players.set(info.id, p);
    return p;
  }

  myTeam() { return this.teamName ?? null; }

  _removeModel(p) {
    this.scene.remove(p.model.group);
    p.model.group.traverse((o) => { if (o.material?.map) o.material.map.dispose(); });
  }

  _name(id) { return this.players.get(id)?.name ?? '?'; }

  // ------------------------------------------------------------ réseau ----
  _bindNet() {
    const n = this.net;
    n.on('pjoin', (m) => {
      const p = this._addPlayer(m.p);
      this.scoreDirty = true;
      if (!p.bot) this.hud.sysMessage(`${p.name} a rejoint`);
    });
    n.on('pleave', (m) => {
      const p = this.players.get(m.id);
      if (!p) return;
      if (!p.bot) this.hud.sysMessage(`${p.name} est parti`);
      this._removeModel(p);
      this.players.delete(m.id);
      this.scoreDirty = true;
    });
    n.on('s', (m) => {
      for (const e of m.p) {
        const [id, x, y, z, yaw, pitch, hp, w, prot] = e;
        if (id === this.myId) {
          if (this.me?.alive) this.me.hp = hp;
          if (this.me) this.me.prot = prot;
          continue;
        }
        const p = this.players.get(id) || this._addPlayer({ id, name: '?', team: null });
        p.snaps.push({ ts: m.ts, x, y, z, yaw, pitch });
        if (p.snaps.length > 30) p.snaps.shift();
        p.hp = hp; p.weapon = w; p.prot = prot;
      }
    });
    n.on('spawn', (m) => this._onSpawn(m));
    n.on('shot', (m) => this._onRemoteShot(m));
    n.on('hit', (m) => {
      this.hud.hitmarker(m.k);
      sfx.play(m.k ? 'kill' : m.h ? 'headshot' : 'hit');
      const v = this.players.get(m.v);
      if (v && v.model.group.visible) {
        const g = v.model.group.position;
        this.fx.burst(g.x, g.y + (m.h ? 1.6 : 1.1), g.z, '#c62d32', m.k ? 14 : 5, 3.5);
      }
    });
    n.on('dmg', (m) => this._onDamage(m));
    n.on('kill', (m) => this._onKill(m));
    n.on('score', (m) => {
      for (const [id, k, d, lvl] of m.p) {
        const p = this.players.get(id);
        if (p) { p.k = k; p.d = d; p.lvl = lvl ?? 0; }
        if (id === this.myId && this.gun) this._setLevel(lvl ?? 0);
      }
      this.teamKills = m.team;
      this.scoreDirty = true;
    });
    n.on('state', (m) => {
      this.state = m.s;
      this.winner = m.win;
      this.until = m.until;
      if (m.s === 'ended') {
        const w = m.win;
        const mine = w && (w.team ? w.team === this.myTeam() : w.id === this.myId);
        if (mine) sfx.play('win');
      }
      this.scoreDirty = true;
    });
  }

  _onSpawn(m) {
    const me = this.me;
    if (!me) return;
    me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vy = me.vz = 0;
    me.yaw = m.yaw; me.pitch = 0;
    me.hp = m.hp; me.alive = true; me.spawned = true; me.deadT = 0; me.killer = null;
    me.ammo = WEAPONS.map((w) => w.mag);
    me.reloadUntil = 0; me.nextFire = 0; me.scopeToggle = false;
    if (this.gun && !this._allowed(me.weapon)) this._switchTo(GUN_ORDER[me.level], performance.now());
    this.hud.death(false);
    if (this.state !== 'waiting') sfx.play('spawn');
  }

  _onDamage(m) {
    const me = this.me;
    if (!me) return;
    me.hp = m.hp;
    const dx = m.x - me.x, dz = m.z - me.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    this.hud.damage(Math.atan2((dx * rx + dz * rz) / len, (dx * fx + dz * fz) / len));
    sfx.play('hurt');
  }

  _onKill(m) {
    const killer = this.players.get(m.a) ?? (m.a === this.myId ? { name: 'Toi', id: this.myId, team: this.myTeam() } : null);
    const victim = this.players.get(m.v) ?? (m.v === this.myId ? { name: 'Toi', id: this.myId, team: this.myTeam() } : null);
    const mine = m.a === this.myId || m.v === this.myId;
    this.hud.killfeed(killer, victim, m.w, m.h, mine, this.mode);
    if (m.v === this.myId) {
      const me = this.me;
      me.alive = false; me.deadT = 0; me.hp = 0; me.killer = m.a;
      me.respawnAt = performance.now() + RESPAWN_MS;
      me.scoped = false; me.scopeToggle = false;
      this.input.reset();
    } else {
      const v = this.players.get(m.v);
      if (v) {
        v.hp = 0;
        const g = v.model.group.position;
        this.fx.burst(g.x, g.y + 1, g.z, playerColor(this.mode, v), 18, 5, 0.9);
        v.model.group.visible = false;
      }
    }
  }

  _onRemoteShot(m) {
    const p = this.players.get(m.id);
    const w = WEAPONS[m.w];
    if (!w) return;
    const [ox, oy, oz] = m.o;
    // léger décalage vers la main droite du tireur pour que la traînée parte de l'arme
    const yaw = p?.model.group.rotation.y ?? 0;
    const sx = ox + Math.cos(yaw) * 0.25, sz = oz - Math.sin(yaw) * 0.25, sy = oy - 0.3;
    for (const e of m.e) {
      this.fx.tracer(sx, sy, sz, e[0], e[1], e[2]);
      this.fx.burst(e[0], e[1], e[2], '#cfcfcf', 2, 2, 0.3);
    }
    this.minimap.ping(ox, oz, p ? playerColor(this.mode, p) : '#ffffff');
    const cam = this.camera.position;
    const dx = ox - cam.x, dz = oz - cam.z;
    const dist = Math.hypot(dx, dz, oy - cam.y);
    const yawMe = this.me?.yaw ?? 0;
    const pan = dist > 0.5 ? (dx * Math.cos(yawMe) + dz * -Math.sin(yawMe)) / dist : 0;
    const gain = Math.pow(clamp(1 - dist / 70, 0, 1), 1.5);
    sfx.play(w.id, { gain, pan });
  }

  // ------------------------------------------------------------ boucle ----
  _frame(t) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((tt) => this._frame(tt));
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    this._updateLocal(dt, now);
    this._updateRemotes(dt);
    this.fx.update(dt);
    this._updateCamera(dt, now);
    this._updateHud(now);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);

    this.fpsN++;
    if (now - this.fpsT > 500) {
      this.fps = Math.round((this.fpsN * 1000) / (now - this.fpsT));
      this.fpsN = 0; this.fpsT = now;
      this.hud.netinfo(`${this.fps} FPS · ${Math.round(this.net.rtt)} ms`);
    }
  }

  _updateLocal(dt, now) {
    const me = this.me, inp = this.input, s = this.getSettings();
    const w = WEAPONS[me.weapon];

    // --- caméra (souris / doigt) ---
    const [lx, ly] = inp.takeLook(dt);
    if (lx || ly) {
      const ratio = this.fov / this.baseVFov();
      const k = s.sens * ratio * (me.scoped ? s.sensScope : 1);
      me.yaw -= lx * k;
      me.pitch = clamp(me.pitch - ly * k * (s.invertY ? -1 : 1), -1.5, 1.5);
    }

    if (!me.alive) {
      me.deadT += dt;
    } else if (me.reloadUntil && now >= me.reloadUntil) {
      me.ammo[me.weapon] = w.mag;
      me.reloadUntil = 0;
    }
    if (me.alive && inp.active) {
      // --- changement d'arme ---
      let want = inp.takeWeapon();
      const cyc = inp.takeCycle();
      if (cyc) want = this._cycleWeapon(Math.sign(cyc));
      if (want !== null && want !== me.weapon && WEAPONS[want] && this._allowed(want)) this._switchTo(want, now);

      // --- rechargement ---
      if (inp.takeReload()) this._startReload(now);

      // --- zoom sniper ---
      if (inp.takeScopeToggle()) me.scopeToggle = !me.scopeToggle;
      const wantScope = isTouch ? me.scopeToggle : inp.scopeHeld;
      me.scoped = !!(w.zoom && wantScope && !me.reloadUntil);
      if (!w.zoom) me.scopeToggle = false;

      // --- tir ---
      // tir maintenu pour toutes les armes (cadence de l'arme) ; tir auto si un ennemi est dans le viseur
      const pressed = inp.takeFirePress(now);
      let firing = inp.fireHeld || pressed;
      if (!firing && s.autoFire && this._enemyInCrosshair(w, me)) firing = true;
      if (firing) this._tryFire(now);
    } else {
      me.scoped = false;
    }

    // --- déplacement ---
    let wx = 0, wz = 0;
    const active = me.alive && inp.active;
    if (active) {
      const mx = inp.moveX, my = inp.moveY;
      const l = Math.hypot(mx, my);
      if (l > 0) {
        const nx = mx / Math.max(1, l), ny = my / Math.max(1, l);
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
        const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
        wx = fx * ny + rx * nx;
        wz = fz * ny + rz * nx;
      }
    }
    const speed = WALK_SPEED * w.speed * (me.scoped ? 0.5 : 1);
    if (me.spawned) {
      stepPlayer(me, dt, wx, wz, speed, active && inp.jumpHeld);
      if (me.y < -10) { me.y = 3; me.vy = 0; }
    }
    if (me.alive) {
      // envoi de la position au serveur (20 Hz)
      if (now - me.lastSend >= TICK_MS) {
        me.lastSend = now;
        const r = (v) => Math.round(v * 1000) / 1000;
        this.net.send({ t: 'in', x: r(me.x), y: r(me.y), z: r(me.z), yaw: r(me.yaw), pitch: r(me.pitch), w: me.weapon });
      }
    }
    me.speed2d = Math.hypot(me.vx, me.vz);
  }

  // Un ennemi vivant, sans mur devant, est-il pile sous le viseur ? (tir automatique)
  _enemyInCrosshair(w, me) {
    if (w.zoom && !me.scoped) return false;
    const ex = me.x, ey = me.y + EYE_HEIGHT, ez = me.z;
    const [dx, dy, dz] = lookDir(me.yaw, me.pitch);
    let reach = w.melee ? w.range : 80;
    for (const b of BOXES) {
      const h = rayAABB(ex, ey, ez, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, reach);
      if (h >= 0 && h < reach) reach = h;
    }
    const pad = 0.12;
    for (const p of this.players.values()) {
      if (p.id === this.myId || p.hp <= 0 || p.prot || !p.snaps.length) continue;
      if (this.mode === 'tdm' && p.team === this.myTeam()) continue;
      const g = p.model.group.position;
      const body = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.35 - pad, g.y, g.z - 0.35 - pad, g.x + 0.35 + pad, g.y + 1.4, g.z + 0.35 + pad, reach);
      const head = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.25 - pad, g.y + 1.4, g.z - 0.25 - pad, g.x + 0.25 + pad, g.y + 1.85, g.z + 0.25 + pad, reach);
      if (body >= 0 || head >= 0) return true;
    }
    return false;
  }

  // ---- Gun Game : l'arme dépend du niveau, le couteau reste toujours utilisable ----
  _allowed(i) { return !this.gun || i === GUN_ORDER[this.me.level] || i === KNIFE; }
  _allowedSet() { return this.gun ? new Set([GUN_ORDER[this.me.level], KNIFE]) : null; }

  _cycleWeapon(dir) {
    let i = this.me.weapon;
    for (let k = 0; k < WEAPONS.length; k++) {
      i = (i + dir + WEAPONS.length) % WEAPONS.length;
      if (this._allowed(i)) return i;
    }
    return this.me.weapon;
  }

  _setLevel(lvl) {
    const me = this.me;
    if (!this.gun || lvl === me.level) return;
    const up = lvl > me.level;
    me.level = lvl;
    const w = GUN_ORDER[lvl];
    me.ammo[w] = WEAPONS[w].mag;
    this._switchTo(w, performance.now());
    this.hud.setAllowed(this._allowedSet());
    this.hud.hint(`${up ? 'Niveau supérieur' : 'Niveau perdu'} : ${lvl + 1}/${GUN_ORDER.length} — ${WEAPONS[w].name}`, 3500);
    if (up) sfx.play('spawn');
  }

  _switchTo(i, now) {
    const me = this.me;
    me.weapon = i;
    me.reloadUntil = 0;
    me.scoped = false; me.scopeToggle = false;
    me.switchUntil = now + 250;
    this.viewmodel.setWeapon(i);
  }

  _startReload(now) {
    const me = this.me, w = WEAPONS[me.weapon];
    if (!w.mag || me.reloadUntil || me.ammo[me.weapon] >= w.mag) return;
    me.reloadUntil = now + w.reload;
    me.scoped = false; me.scopeToggle = false;
    sfx.play('reload');
  }

  _tryFire(now) {
    const me = this.me, w = WEAPONS[me.weapon];
    if (this.state === 'ended' || now < me.nextFire || now < me.switchUntil || me.reloadUntil) return;
    if (w.mag && me.ammo[me.weapon] <= 0) {
      sfx.play('empty');
      me.nextFire = now + 250;
      this._startReload(now);
      return;
    }
    me.nextFire = now + w.interval;
    if (w.mag) me.ammo[me.weapon]--;

    const ex = me.x, ey = me.y + EYE_HEIGHT, ez = me.z;
    const [dx, dy, dz] = lookDir(me.yaw, me.pitch);
    const seed = (Math.random() * 2147483647) | 0;
    const spread = w.scopeSpread !== undefined && me.scoped ? w.scopeSpread : w.spread;

    this.net.send({
      t: 'fire', w: me.weapon, seed, sc: me.scoped ? 1 : 0,
      ox: +ex.toFixed(3), oy: +ey.toFixed(3), oz: +ez.toFixed(3),
      dx: +dx.toFixed(4), dy: +dy.toFixed(4), dz: +dz.toFixed(4),
      rt: Math.round(this.net.serverNow() - INTERP_MS),
    });

    // Effets locaux immédiats (même graine que le serveur => mêmes plombs)
    this.viewmodel.fire();
    sfx.play(w.id);
    if (!w.melee) {
      const rng = mulberry32(seed);
      const mz = this.camera.localToWorld(this._v.set(0.2, -0.18, -0.7));
      const mx0 = mz.x, my0 = mz.y, mz0 = mz.z;
      for (let i = 0; i < w.pellets; i++) {
        const [px, py, pz] = applySpread(dx, dy, dz, spread, rng);
        let tt = MAX_TRACER;
        for (const b of BOXES) {
          const h = rayAABB(ex, ey, ez, px, py, pz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, tt);
          if (h >= 0 && h < tt) tt = h;
        }
        this.fx.tracer(mx0, my0, mz0, ex + px * tt, ey + py * tt, ez + pz * tt);
        if (tt < MAX_TRACER) this.fx.burst(ex + px * tt, ey + py * tt, ez + pz * tt, '#cfcfcf', 2, 2, 0.3);
      }
      me.pitch += w.recoil * 0.004; // léger recul de la visée
    }
    if (w.mag && me.ammo[me.weapon] === 0) this._startReload(now + w.interval - 1);
  }

  _updateRemotes(dt) {
    const renderT = this.net.serverNow() - INTERP_MS;
    for (const p of this.players.values()) {
      const s = p.snaps;
      const g = p.model.group;
      if (p.id === this.myId || !s.length || p.hp <= 0) { g.visible = false; continue; }
      while (s.length > 2 && s[1].ts <= renderT) s.shift();
      let x, y, z, yaw, pitch;
      if (s.length === 1 || renderT <= s[0].ts) {
        ({ x, y, z, yaw, pitch } = s[0]);
      } else {
        const a = s[0], b = s[1];
        const f = clamp((renderT - a.ts) / (b.ts - a.ts || 1), 0, 1);
        x = a.x + (b.x - a.x) * f; y = a.y + (b.y - a.y) * f; z = a.z + (b.z - a.z) * f;
        yaw = angleLerp(a.yaw, b.yaw, f); pitch = a.pitch + (b.pitch - a.pitch) * f;
      }
      g.visible = true;
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      p.model.head.rotation.x = clamp(pitch, -1.2, 1.2);
      p.model.setWeapon(WEAPONS[p.weapon]?.id ?? 'ar');

      // animation de marche
      const moved = Math.hypot(x - p.lastX, z - p.lastZ) / Math.max(dt, 1e-3);
      p.lastX = x; p.lastZ = z;
      p.walk += Math.min(moved, 8) * dt * 2.2;
      const amp = Math.min(1, moved / 4) * 0.7;
      p.model.legs[0].rotation.x = Math.sin(p.walk) * amp;
      p.model.legs[1].rotation.x = -Math.sin(p.walk) * amp;
      // clignote pendant la protection d'apparition
      g.visible = !p.prot || Math.floor(performance.now() / 120) % 2 === 0;
    }
  }

  _updateCamera(dt, now) {
    const me = this.me, cam = this.camera;
    let eye = me.y + EYE_HEIGHT;
    let roll = 0;
    if (!me.alive && me.spawned) {
      const k = Math.min(1, me.deadT * 2.5);
      eye = me.y + EYE_HEIGHT - (EYE_HEIGHT - 0.35) * k;
      roll = 0.9 * k;
    }
    cam.position.set(me.x, eye, me.z);
    cam.rotation.set(me.pitch, me.yaw, roll);
    this._applyFov(false);

    const w = WEAPONS[me.weapon];
    const scopedIn = me.scoped && w.zoom && this.fov < w.zoom + 6;
    document.getElementById('scope').classList.toggle('hidden', !scopedIn);
    document.body.classList.toggle('scoped', scopedIn);
    this.viewmodel.update(dt, {
      speed: me.speed2d || 0,
      onGround: me.onGround,
      reloadProgress: me.reloadUntil ? clamp(1 - (me.reloadUntil - now) / w.reload, 0, 1) : null,
      visible: me.alive && !scopedIn,
    });
  }

  banner() {
    const st = this.state;
    if (st === 'waiting') return this.hud.banner("En attente d'un adversaire…", 'Dis à ton pote de choisir 1v1 (même nom de salon si tu en as mis un)');
    if (st === 'ended') {
      const w = this.winner;
      let title = 'Fin de manche';
      if (w?.team) title = `L'équipe ${w.team === 'red' ? 'ROUGE' : 'BLEUE'} gagne !`;
      else if (w) title = w.id === this.myId ? 'VICTOIRE !' : `${this._name(w.id)} gagne !`;
      const left = Math.max(0, Math.ceil((this.until - this.net.serverNow()) / 1000));
      return this.hud.banner(title, `Nouvelle manche dans ${left}s`);
    }
    return this.hud.banner(null);
  }

  _updateHud(now) {
    const me = this.me;
    this.hud.setHp(me.alive ? me.hp : 0);
    this.hud.setWeapon(me.weapon, me.ammo[me.weapon], !!me.reloadUntil);

    if (!me.alive && me.spawned && this.state !== 'ended') {
      const left = Math.max(0, Math.ceil((me.respawnAt - now) / 1000));
      this.hud.death(true, me.killer ? this._name(me.killer) : '', left);
    } else if (!me.alive) {
      this.hud.death(false);
    }
    this.banner();

    const s = this.getSettings();
    if (this.input.takeMapToggle()) {
      s.minimap = !s.minimap;
      saveSettings(s);
      const box = document.getElementById('s-map');
      if (box) box.checked = s.minimap;
    }
    this.minimap.setVisible(s.minimap !== false);
    if (s.minimap !== false) this.minimap.draw(this, now);

    const list = () => [...this.players.values()];
    if (this.scoreDirty) {
      this.scoreDirty = false;
      this.hud.scoreLine(this.mode, list(), this.teamKills, this.myId, this.limit);
    }
    const showBoard = this.input.scoreHeld || this.state === 'ended';
    this.hud.showScoreboard(showBoard);
    if (showBoard && (this._boardT ?? 0) < now) {
      this._boardT = now + 250;
      this.hud.renderScoreboard(this.mode, list(), this.teamKills, this.myId);
    }
  }
}
