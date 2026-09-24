// Boucle de jeu : joueur local (prédit côté client), autres joueurs (interpolés), tirs, effets, HUD.
import * as THREE from 'three';
import {
  TICK_MS, INTERP_MS, MIN_INTERP_MS, MAX_EXTRAP_MS, MODES, EYE_HEIGHT, EYE_HEIGHT_CROUCH, MAX_HP, RESPAWN_MS, WALK_SPEED, JUMP_SPEED, SPRINT_MUL, CROUCH_SPEED_MUL, WEAPONS, GUN_ORDER, KNIFE, resolveClass, STREAK_WEAPONS,
} from '../shared/config.js';
import { mapById } from '../shared/map.js';
import { mulberry32, applySpread, lookDir, clamp, angleLerp, rayAABB, shotSeed } from '../shared/util.js';
import { createWorld } from './world.js';
import { buildPlayer, makeNameSprite } from './models.js';
import { ViewModel } from './viewmodel.js';
import { Fx } from './fx.js';
import { stepPlayer } from './physics.js';
import { playerColor } from './hud.js';
import { sfx } from './audio.js';
import { isTouch, saveSettings } from './config.js';
import { Minimap } from './minimap.js';
import { stepPlane, PLANE } from '../shared/plane.js';

const MAX_TRACER = 90;
const SLIDE_MS = 700;            // durée d'une glissade
const SLIDE_COOLDOWN_MS = 1100;  // délai avant la suivante
const SLIDE_BOOST = 1.2;         // vitesse de départ = sprint × 1,2 (annoncée au serveur : message 'slide')

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
    this.world = createWorld(this.scene);
    this.map = null;
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
    this.portals = new Map();   // id du propriétaire -> [portail bleu, portail orange]
    this.shake = 0;
    this._crouchT = 0;
    this.interp = INTERP_MS;    // retard d'affichage des autres joueurs (ms), ajusté à la gigue du réseau
    this._jit = 0; this._lastSnapAt = 0; this._predAt = 0;
    this.mvp = null; this.onMatchEnd = null;
    this.surv = null; this.endWave = 0; this.onShop = null; this.onShopChange = null;   // mode survie
    this.nukeAt = 0;            // heure d'impact du missile nucléaire en vol
    this.gas = null;            // gaz toxique : { owner, until }
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
    const me = this.me;
    const base = this.baseVFov();
    const kick = me?.sliding ? 1.1 : me?.sprinting && (me.speed2d || 0) > WALK_SPEED ? 1.05 : 1;   // la vitesse se sent
    const target = me?.scoped && w.zoom ? w.zoom : me?.aiming && w.ads ? base * w.ads.zoomMul : base * kick;
    this.fov = snap || !this.fov ? target : this.fov + (target - this.fov) * 0.35;
    if (snap || Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ cycle de vie ----
  start(welcome) {
    this.stop();
    this.sn = welcome.sn | 0; this.shotN = 0;   // graines de tir (le serveur remet son compteur à 0 à chaque welcome)
    this.myId = welcome.id;
    this.teamName = welcome.team;
    this.room = welcome.room;
    this.mode = welcome.room.mode;
    this.limit = welcome.room.limit;
    this.map = mapById(welcome.room.map);
    this.world.load(this.map);
    this.minimap.setMap(this.map);
    this.camera.far = this.map.fog[1] + 40;
    this.gun = welcome.room.mode === 'gun';
    const mine = welcome.players.find((p) => p.id === welcome.id);
    this.state = welcome.state;
    this.winner = welcome.win;
    this.until = welcome.until;
    this.teamKills = welcome.teamKills || { red: 0, blue: 0 };
    this.net.syncFromWelcome(welcome.ts);

    const s0 = this.getSettings();
    const level = mine?.lvl ?? 0;
    const loadout = this.gun ? [GUN_ORDER[level], KNIFE] : resolveClass(s0.cls, s0.custom).weapons.slice();
    this.me = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, pitch: 0,
      level, loadout, maxHp: MAX_HP, speedMul: 1, nades: 0, nadeReady: 0, cash: 0, up: { hp: 0, dmg: 0, spd: 0 }, charging: false, chargeAt: 0, flight: null, lastPc: 0, preYaw: 0, prePitch: 0, pull: null, portalUntil: 0, stunUntil: 0, altUntil: {}, jumpPrev: false,
      hp: MAX_HP, alive: false, spawned: false, weapon: loadout[0], ammo: WEAPONS.map((w) => w.mag),
      reloadUntil: 0, nextFire: 0, switchUntil: 0, scoped: false, aiming: false, scopeToggle: false, crouch: false, sprinting: false,
      feel: true, sliding: false, slideUntil: 0, slideReady: 0, airMax: 0, wasGround: true, fallVy: 0,
      respawnAt: 0, killer: null, deadT: 0, prot: 0, lastSend: 0,
    };
    for (const p of welcome.players) this._addPlayer(p);
    this.portals.clear();
    for (const q of welcome.portals || []) this._setPortal(q);
    this.nukeAt = 0; this.gas = null;
    this.interp = INTERP_MS; this._jit = 0; this._lastSnapAt = 0;
    if (welcome.gas) this._setGas({ owner: welcome.gas.owner, ms: welcome.gas.ms });
    this.hud.skins = this.getSkins?.() || {};
    this.viewmodel.setSkins(this.hud.skins);
    this.viewmodel.setWeapon(this.me.weapon);
    this.hud.setLoadout(loadout);
    this.hud.setStats(null);
    this.surv = welcome.surv || null; this.endWave = 0;
    this.fov = 0;
    this._crouchT = 0;
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
      : 'F / Entrée : tirer · Flèches : viser · 1-9 : armes · E / clic droit : tir secondaire · M : mini-carte', 10000);
    document.body.classList.add('ingame');
    document.body.classList.toggle('survival', this.mode === 'survival');
    this._raf = requestAnimationFrame((t) => this._frame(t));
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    for (const p of this.players.values()) this._removeModel(p);
    this.players.clear();
    this.portals.clear();
    this.fx.clear();
    this.nukeAt = 0; this.gas = null;
    this.hud.nuke(false); this.hud.gas(null);
    this._gasLook(false);
    this.minimap.clear();
    this.input.enabled = false;
    this.input.reset();
    document.body.classList.remove('ingame', 'survival');
    this.hud.hide();
    document.getElementById('scope').classList.add('hidden');
    document.body.classList.remove('scoped', 'aiming');
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
    const color = info.mob ? info.mob.c : playerColor(this.mode, info);
    // skins envoyés par le serveur : { indexArme: indexSkin } -> { idArme: indexSkin }
    const skins = {};
    for (const [wi, si] of Object.entries(info.sk || {})) if (WEAPONS[wi]) skins[WEAPONS[wi].id] = si;
    const model = buildPlayer(color, skins);
    model.group.visible = false;
    if (info.mob) model.group.scale.setScalar(info.mob.s);
    this.scene.add(model.group);
    p = {
      id: info.id, name: info.name, team: info.team, bot: !!info.bot, k: info.k || 0, d: info.d || 0, lvl: info.lvl || 0,
      hp: info.hp ?? 0, weapon: info.w ?? 0, prot: 0, snaps: [], model, sprite: null, lastX: 0, lastZ: 0, walk: 0,
    };
    // Nom au-dessus de la tête : seulement les coéquipiers en mode équipes (pas de "wallhack")
    if (info.mob) { // barre de vie flottante des monstres
      const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: 0.6, fog: false }));
      const fill = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xe5484d, transparent: true, fog: false }));
      bg.scale.set(1.0, 0.13, 1); fill.scale.set(0.96, 0.09, 1);
      bg.position.set(0, 2.3, 0); fill.position.set(0, 2.3, 0);
      bg.renderOrder = 1; fill.renderOrder = 2;
      model.group.add(bg, fill);
      p.mob = info.mob; p.hpFill = fill;
    }
    if (info.id !== this.myId && MODES[this.mode]?.teams && info.team === this.myTeam()) {
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
      // gigue d'arrivée des snapshots -> retard d'affichage : juste assez pour toujours avoir 2 positions à interpoler
      const t = performance.now();
      if (this._lastSnapAt) this._jit += (Math.min(200, Math.abs(t - this._lastSnapAt - TICK_MS)) - this._jit) * 0.05;
      this._lastSnapAt = t;
      this.interp += (clamp(TICK_MS * 2 + this._jit * 2.5, MIN_INTERP_MS, 220) - this.interp) * 0.02;
      for (const e of m.p) {
        const [id, x, y, z, yaw, pitch, hp, w, prot, crouch] = e;
        if (id === this.myId) {
          if (this.me?.alive) this.me.hp = hp;
          if (this.me) this.me.prot = prot;
          continue;
        }
        const p = this.players.get(id) || this._addPlayer({ id, name: '?', team: null });
        p.snaps.push({ ts: m.ts, x, y, z, yaw, pitch });
        if (p.snaps.length > 30) p.snaps.shift();
        p.hp = hp; p.weapon = w; p.prot = prot; p.crouch = !!crouch;
      }
    });
    n.on('spawn', (m) => this._onSpawn(m));
    n.on('shot', (m) => this._onRemoteShot(m));
    n.on('hit', (m) => {
      this.hud.hitmarker(m.k, m.h);
      if (m.k || m.h || performance.now() - this._predAt > 400) sfx.play(m.k ? 'kill' : m.h ? 'headshot' : 'hit');
      const v = this.players.get(m.v);
      if (v && v.model.group.visible) {
        const g = v.model.group.position;
        this.fx.burst(g.x, g.y + (m.h ? 1.6 : 1.1), g.z, '#c62d32', m.k ? 14 : 5, 3.5);
        // chiffre de dégâts flottant au-dessus de la cible (jaune = tête)
        const sp = this._v.set(g.x, g.y + (m.h ? 1.9 : 1.4), g.z).project(this.camera);
        if (m.d > 0 && sp.z < 1) this.hud.dmgNumber((sp.x + 1) / 2, (1 - sp.y) / 2, m.d, !!m.h, !!m.k);
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
    n.on('proj', (m) => {
      const w = WEAPONS[m.w];
      this.fx.addProj(m.id, w?.id, m.o[0], m.o[1], m.o[2], m.v[0], m.v[1], m.v[2], m.g, w?.proj?.bounce || 0);
    });
    n.on('pbounce', (m) => this.fx.bounceProj(m.id, m.o, m.v));
    n.on('nades', (m) => { if (this.me) this.me.nades = m.n; });
    // ---- survie ----
    n.on('surv', (m) => {
      const prev = this.surv;
      this.surv = m;
      if (prev && m.wave > prev.wave && m.phase === 'fight') { this.hud.hint(`MANCHE ${m.wave} !`, 3500); sfx.play('streak'); }
    });
    n.on('wave', (m) => { this.hud.hint(`Manche ${m.n} terminée ! +${m.bonus} 💰 · B : boutique`, 6000); sfx.play('win'); });
    n.on('cash', (m) => {
      const me = this.me;
      if (!me) return;
      me.cash = m.n; if (m.up) me.up = m.up;
      this.onShopChange?.();
    });
    n.on('stats', (m) => { if (this.me) { this.me.maxHp = m.maxHp; this.me.speedMul = m.speed; } });
    n.on('buyfail', (m) => this.hud.hint(m.why === 'cash' ? 'Pas assez de points' : m.why === 'owned' ? 'Tu l\'as déjà' : m.why === 'full' ? 'Rien à faire ici (déjà au maximum)' : 'Achat impossible', 2000));
    n.on('bought', () => sfx.play('spawn'));
    n.on('mystery', (m) => { // boîte mystère : arme aléatoire (rare = le prototype)
      const w = WEAPONS[m.w];
      this.hud.hint(m.rare ? `🎁 ARME LÉGENDAIRE : ${w.name} !!` : `🎁 Boîte mystère : ${w.name}`, m.rare ? 5000 : 3000);
      sfx.play(m.rare ? 'streak' : 'spawn');
    });
    n.on('charge', (m) => { const p = this.players.get(m.id); if (p) p.charging = !!m.on; });   // canon à orbe : lueur pendant la charge
    n.on('planeOn', (m) => { // on prend les commandes de l'avion en papier
      const me = this.me;
      if (!me) return;
      me.flight = { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: m.pitch, born: performance.now() };
      me.preYaw = me.yaw; me.prePitch = me.pitch;           // la souris sert à diriger l'avion ; on rendra la visée à la fin du vol
      me.yaw = m.yaw; me.pitch = m.pitch; me.lastPc = 0;
      me.scoped = false; me.aiming = false; me.scopeToggle = false; me.crouch = false; me.sprinting = false;
      sfx.play('plane');
      this.hud.hint('AVION : souris = diriger · tir = abandonner · tête = mort, corps = 60', 5000);
    });
    n.on('plane', (m) => {
      if (m.id !== this.myId) return this.fx.setPlane(m.id, m.x, m.y, m.z, m.yaw, m.pitch);
      const f = this.me?.flight;
      if (!f) return;
      // le message du serveur a ~1/2 ping de retard : on le prolonge dans son cap, puis on rapproche doucement notre avion prédit
      const lag = this.net.rtt / 2000, c = Math.cos(m.pitch), sp = PLANE.speed * lag;
      const ex = m.x - Math.sin(m.yaw) * c * sp, ey = m.y + Math.sin(m.pitch) * sp, ez = m.z - Math.cos(m.yaw) * c * sp;
      const err = Math.hypot(ex - f.x, ey - f.y, ez - f.z);
      const k = err > 5 ? 1 : 0.12;
      f.x += (ex - f.x) * k; f.y += (ey - f.y) * k; f.z += (ez - f.z) * k;
    });
    n.on('planeOff', (m) => {
      this.fx.removePlane(m.id);
      this.fx.burst(m.x, m.y, m.z, '#f4f1e8', 12, 3.5, 0.7);
      const me = this.me;
      if (m.id === this.myId && me?.flight) {
        me.flight = null;
        me.yaw = me.preYaw; me.pitch = me.prePitch;
        this.hud.hint(m.why === 'hit' ? 'Touché !' : m.why === 'wall' || m.why === 'ground' ? 'Avion écrasé' : 'Vol terminé', 1800);
      }
    });
    n.on('boom', (m) => {
      this.fx.removeProj(m.id);
      this.fx.explosion(m.x, m.y, m.z, m.r);
      const cam = this.camera.position;
      const dist = Math.hypot(m.x - cam.x, m.y - cam.y, m.z - cam.z);
      sfx.play('boom', { gain: Math.pow(clamp(1 - dist / 80, 0, 1), 1.3) });
      this.shake = Math.max(this.shake, 0.06 * clamp(1 - dist / (m.r * 3), 0, 1));
    });
    n.on('portal', (m) => this._setPortal(m));
    n.on('portalOff', (m) => {
      this.portals.delete(m.o);
      this.fx.removePortal(`${m.o}:0`); this.fx.removePortal(`${m.o}:1`);
    });
    n.on('fix', (m) => { // le serveur a refusé un déplacement trop rapide : on se recale sur sa position
      const me = this.me;
      if (!me?.alive) return;
      me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vz = 0; me.pull = null;
    });
    n.on('push', (m) => { // recul d'explosion : impulsion calculée par le serveur
      const me = this.me;
      if (!me?.alive) return;
      me.vx += m.v[0]; me.vy += m.v[1]; me.vz += m.v[2];
      me.onGround = false;
    });
    n.on('pull', (m) => { // grappin : on est attiré vers un point
      const me = this.me;
      if (me?.alive) me.pull = { x: m.x, y: m.y, z: m.z, sp: m.sp, until: performance.now() + m.ms, hook: m.hook };
    });
    n.on('streak', (m) => { // série de kills : nouvelle arme (touche 6, 7 ou 8)
      const me = this.me, w = WEAPONS[m.w];
      me.loadout = m.loadout.slice();
      me.ammo[m.w] = w.mag;
      this.hud.setLoadout(me.loadout);
      this.hud.hint(`SÉRIE DE ${m.n} ! Touche ${6 + w.streak} : ${w.name} (un seul chargeur)`, 6000);
      sfx.play('streak');
    });
    n.on('streakall', (m) => { if (m.id !== this.myId) this.hud.sysMessage(`${this._name(m.id)} est à ${m.n} kills d'affilée !`); });
    n.on('loadout', (m) => { // arme de série vide : retirée
      const me = this.me;
      me.loadout = m.loadout.slice();
      this.hud.setLoadout(me.loadout);
      if (!me.loadout.includes(me.weapon)) this._switchTo(me.loadout[0], performance.now());
    });
    n.on('stun', (m) => {
      const me = this.me;
      me.stunUntil = performance.now() + m.ms;
      me.scoped = false; me.aiming = false; me.scopeToggle = false;
      this.hud.hint('ÉTOURDI !', m.ms);
      this.shake = Math.max(this.shake, 0.04);
      sfx.play('stun');
    });
    n.on('wave', (m) => { // onde d'Excalibur
      this.fx.wave(m.o, m.d, m.len);
      const cam = this.camera.position;
      const dist = Math.hypot(m.o[0] - cam.x, m.o[2] - cam.z);
      sfx.play('wave', { gain: Math.pow(clamp(1 - dist / 90, 0.15, 1), 1.2) });
      this.shake = Math.max(this.shake, 0.05);
    });
    n.on('nuke', (m) => {
      this.nukeAt = performance.now() + m.ms;
      this.hud.nuke(true, m.id === this.myId ? 'Lancé par toi' : `Lancé par ${this._name(m.id)}`);
      sfx.siren(m.ms);
    });
    n.on('nukeOff', () => { this.nukeAt = 0; this.hud.nuke(false); });
    n.on('nukeboom', () => {
      this.nukeAt = 0;
      this.hud.nuke(false);
      this.hud.flash();
      sfx.play('nukeboom');
      this.shake = 0.3;
    });
    n.on('gas', (m) => this._setGas(m));
    n.on('classok', (m) => this.hud.hint(`Classe « ${m.name} » à ta prochaine réapparition`, 4000));
    n.on('state', (m) => {
      this.state = m.s;
      this.winner = m.win;
      this.until = m.until;
      if (m.s === 'ended') {
        const w = m.win;
        const mine = w && (w.team ? w.team === this.myTeam() : w.id === this.myId);
        if (mine) sfx.play('win');
        if (m.wave !== undefined) this.endWave = m.wave;
        if (m.stats) {
          this.hud.setStats(m.stats.rows, m.stats.mvp);
          this.mvp = m.stats.mvp;
          const row = m.stats.rows.find((r) => r[0] === this.myId);
          if (row) this.onMatchEnd?.(row, !!mine);
        }
      } else { this.hud.setStats(null); this.mvp = null; }
      this.scoreDirty = true;
    });
  }

  _onSpawn(m) {
    const me = this.me;
    if (!me) return;
    me.x = m.x; me.y = m.y; me.z = m.z; me.vx = me.vy = me.vz = 0;
    me.yaw = m.yaw; me.pitch = 0;
    me.hp = m.hp; me.alive = true; me.spawned = true; me.deadT = 0; me.killer = null; me.sliding = false; me.airMax = 0;
    me.ammo = WEAPONS.map((w) => w.mag);
    me.reloadUntil = 0; me.nextFire = 0; me.scopeToggle = false; me.pull = null; me.nades = m.nades ?? 0;
    me.charging = false; me.flight = null;
    if (m.loadout) {
      me.loadout = m.loadout.slice();
      me.maxHp = m.maxHp ?? MAX_HP;
      me.speedMul = m.speed ?? 1;
      this.hud.setLoadout(me.loadout);
      if (!me.loadout.includes(me.weapon)) this._switchTo(me.loadout[0], performance.now());
    }
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
    if (m.a === this.myId && m.v !== this.myId && !this.players.get(m.v)?.mob) this.onMyKill?.(m.w, !!m.h);   // progression des skins
    if (m.v === this.myId) {
      const me = this.me;
      me.alive = false; me.deadT = 0; me.hp = 0; me.killer = m.a;
      me.respawnAt = performance.now() + RESPAWN_MS;
      me.scoped = false; me.aiming = false; me.scopeToggle = false; me.crouch = false; me.sprinting = false;
      me.charging = false; me.flight = null; me.sliding = false;
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
    if (w.kind === 'flame') {
      const e = m.e[0], l = Math.hypot(e[0] - ox, e[1] - oy, e[2] - oz) || 1;
      this.fx.jet(sx, sy, sz, (e[0] - ox) / l, (e[1] - oy) / l, (e[2] - oz) / l);
    } else if (w.kind === 'grapple') {
      this.fx.tracer(sx, sy, sz, m.e[0][0], m.e[0][1], m.e[0][2], 0xe58a2b, 0.25);
    } else {
      for (const e of m.e) {
        this.fx.tracer(sx, sy, sz, e[0], e[1], e[2], w.kind === 'sweep' ? 0xdfe8f5 : w.kind === 'beam' ? 0x66ffff : 0xffe9a0);
        this.fx.burst(e[0], e[1], e[2], '#cfcfcf', 2, 2, 0.3);
      }
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
      this.hud.netinfo(`${this.fps} FPS · ${Math.round(this.net.rtt)} ms · affichage −${Math.round(this.interp)} ms`);
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
      if (inp.takeShop()) {
        if (this.mode === 'survival') this.onShop?.();
      }

      // --- changement d'arme ---
      const slot = inp.takeWeapon();
      let want;
      if (slot !== null) {
        if (slot >= 5 && this.mode !== 'survival') { const sw = STREAK_WEAPONS[slot - 5]; want = me.loadout.includes(sw) ? sw : undefined; }   // touches 6-8 : armes de série
        else { const c = me.loadout[slot]; want = WEAPONS[c]?.streak === undefined ? c : undefined; }
      }
      const cyc = inp.takeCycle();
      if (cyc) want = this._cycleWeapon(Math.sign(cyc));
      if (want !== undefined && want !== me.weapon && WEAPONS[want] && !me.flight) this._switchTo(want, now);

      // --- rechargement ---
      if (inp.takeReload()) this._startReload(now);
      if (inp.takeNade()) this._throwNade(now);

      // --- zoom sniper / visée précise (AR, carabine, minigun...) ---
      if (inp.takeScopeToggle()) me.scopeToggle = !me.scopeToggle;
      const wantScope = isTouch ? me.scopeToggle : inp.scopeHeld;
      me.scoped = !!(w.zoom && wantScope && !me.reloadUntil);
      me.aiming = !!(w.ads && wantScope && !me.reloadUntil);
      if (!w.zoom && !w.ads) me.scopeToggle = false;

      // --- accroupi (bascule) / sprint (maintien, ou joystick à fond sur mobile) ---
      // C en plein sprint au sol = glissade (vitesse, silhouette basse) au lieu de s'accroupir
      if (inp.takeCrouchToggle() && !me.flight) {
        if (me.sprinting && me.onGround && !me.pull && me.speed2d > WALK_SPEED * 1.1 && now >= me.slideReady) this._startSlide(now, w);
        else if (me.sliding) this._endSlide();
        else me.crouch = !me.crouch;
      }
      const wantSprint = isTouch ? Math.hypot(inp.moveX, inp.moveY) > 0.85 : inp.sprintHeld;
      me.sprinting = !!(wantSprint && !me.crouch && !me.sliding && !me.scoped && !me.aiming && !me.charging && !me.flight);

      // --- tir ---
      // tir maintenu pour toutes les armes (cadence de l'arme) ; tir auto si un ennemi est dans le viseur
      const pressed = inp.takeFirePress(now);
      let firing = inp.fireHeld || pressed;
      if (!firing && s.autoFire && w.kind !== 'portal' && this._enemyInCrosshair(w, me)) firing = true;
      if (me.flight) {
        if (pressed) this.net.send({ t: 'pcancel' });           // tirer pendant le vol : on abandonne l'avion
        inp.takeAlt();
      } else if (w.kind === 'portal') {
        // pistolet portail : tir = portail bleu, tir secondaire (clic droit / E / ZOOM) = portail orange
        const alt = inp.takeAlt();
        if (firing || alt) this._tryFire(now, alt);
      } else if (w.alt) {
        // Excalibur : tir = coup d'épée, tir secondaire = onde qui traverse la carte (très longue recharge)
        const alt = inp.takeAlt();
        if (alt) this._tryFire(now, true);
        else if (firing) this._tryFire(now);
      } else if (w.charge) {
        inp.takeAlt();
        this._updateCharge(now, w, firing);
      } else {
        inp.takeAlt();
        if (firing) this._tryFire(now);
      }
    } else {
      me.scoped = false; me.aiming = false; me.sprinting = false;
    }

    // --- déplacement ---
    let wx = 0, wz = 0;
    const active = me.alive && inp.active;
    if (active && !me.flight) {
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
    let speed = WALK_SPEED * w.speed * (me.scoped ? 0.5 : me.aiming ? 0.8 : 1)
      * (me.crouch ? CROUCH_SPEED_MUL : me.sprinting ? SPRINT_MUL : 1) * me.speedMul * (me.charging ? 0.35 : 1);
    const stunned = now < me.stunUntil;
    if (stunned) { wx = wz = 0; me.vx = me.vz = 0; me.pull = null; }
    const jumpNow = active && inp.jumpHeld && !stunned && !me.flight;
    if (me.pull && jumpNow && !me.jumpPrev) { me.pull = null; me.vy = Math.max(me.vy, JUMP_SPEED); }   // saut = on se décroche en gardant son élan
    me.jumpPrev = jumpNow;
    if (me.pull) { // grappin : on est tiré vers le point d'accroche
      const dx = me.pull.x - me.x, dy = me.pull.y - me.y, dz = me.pull.z - me.z, l = Math.hypot(dx, dy, dz);
      if (!me.alive || now >= me.pull.until || l < 1.2) me.pull = null;
      else {
        const k = me.pull.sp / l;
        me.vx = dx * k; me.vz = dz * k;
        if (dy > 0.2) me.vy = Math.max(me.vy, dy * k);
        wx = dx / l; wz = dz / l; speed = me.pull.sp;
        if (me.pull.hook) { // corde tendue jusqu'au point d'accroche
          const mz = this.camera.localToWorld(this._v.set(0.2, -0.18, -0.7));
          this.fx.tracer(mz.x, mz.y, mz.z, me.pull.hook[0], me.pull.hook[1], me.pull.hook[2], 0xe58a2b, 0.06);
        }
      }
    }
    if (me.flight) { // avion en papier : la souris (yaw/pitch) donne le cap voulu, on simule le vol localement
      stepPlane(me.flight, dt, me.yaw, me.pitch);
      if (now - me.lastPc >= TICK_MS) {
        me.lastPc = now;
        const r = (v) => Math.round(v * 1000) / 1000;
        this.net.send({ t: 'pc', yaw: r(me.yaw), pitch: r(me.pitch) });
      }
    }
    if (me.sliding && (now >= me.slideUntil || !me.alive || me.pull || me.flight || stunned)) this._endSlide();
    if (me.spawned) {
      if (me.onGround && !me.sliding) me.airMax = speed;          // élan emporté en l'air (la glissade garde le sien)
      else if (me.sliding) me.airMax = Math.max(speed, Math.hypot(me.vx, me.vz));
      me.jumped = false;
      const vyBefore = me.vy;
      stepPlayer(me, dt, wx, wz, speed, jumpNow && !me.pull, this.map);
      if (me.jumped && me.sliding) this._endSlide();               // saut en glissade : on part avec toute la vitesse
      if (me.onGround && !me.wasGround && vyBefore < -9) { this._landKick = Math.min(0.12, -vyBefore * 0.008); sfx.play('land'); }
      me.wasGround = me.onGround;
      if (me.y < -10) { me.y = 3; me.vy = 0; }
      this._checkPortals(now, wx, wz);
    }
    if (me.alive) {
      // envoi de la position au serveur (20 Hz)
      if (now - me.lastSend >= TICK_MS) {
        me.lastSend = now;
        const r = (v) => Math.round(v * 1000) / 1000;
        const fl = me.flight; // pendant le vol, le corps garde sa direction d'avant
        this.net.send({ t: 'in', x: r(me.x), y: r(me.y), z: r(me.z), yaw: r(fl ? me.preYaw : me.yaw), pitch: r(fl ? me.prePitch : me.pitch), w: me.weapon, c: me.crouch || me.sliding ? 1 : 0 });
      }
    }
    me.speed2d = Math.hypot(me.vx, me.vz);
  }

  // Glissade : élan vers l'avant (au-dessus du sprint), silhouette basse, puis courte recharge
  _startSlide(now, w) {
    const me = this.me;
    const sp = Math.hypot(me.vx, me.vz);
    const boost = Math.max(sp, WALK_SPEED * w.speed * SPRINT_MUL * me.speedMul * SLIDE_BOOST);
    me.vx = (me.vx / sp) * boost; me.vz = (me.vz / sp) * boost;
    me.sliding = true; me.crouch = false; me.sprinting = false;
    me.slideUntil = now + SLIDE_MS; me.slideReady = now + SLIDE_COOLDOWN_MS;
    this.net.send({ t: 'slide' });   // le serveur élargit un instant son contrôle de vitesse
    sfx.play('slide');
  }

  _endSlide() { this.me.sliding = false; this.me.slideUntil = 0; }

  // Distance du premier ennemi touché par ce rayon (positions affichées), ou 0 si aucun avant `reach`
  _rayEnemy(ex, ey, ez, dx, dy, dz, reach) {
    let best = 0;
    for (const p of this.players.values()) {
      if (p.id === this.myId || p.hp <= 0 || p.prot || !p.snaps.length || !p.model.group.visible) continue;
      if (MODES[this.mode]?.teams && p.team === this.myTeam()) continue;
      const g = p.model.group.position;
      const body = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.35, g.y, g.z - 0.35, g.x + 0.35, g.y + 1.4, g.z + 0.35, reach);
      const head = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.25, g.y + 1.4, g.z - 0.25, g.x + 0.25, g.y + 1.85, g.z + 0.25, reach);
      for (const t of [body, head]) if (t >= 0 && (!best || t < best)) best = t;
    }
    return best;
  }

  // Un ennemi vivant, sans mur devant, est-il pile sous le viseur ? (tir automatique)
  _enemyInCrosshair(w, me) {
    if (w.zoom && !me.scoped) return false;
    const ex = me.x, ey = me.y + EYE_HEIGHT, ez = me.z;
    const [dx, dy, dz] = lookDir(me.yaw, me.pitch);
    let reach = w.melee ? w.range : 80;
    for (const b of this.map.boxes) {
      const h = rayAABB(ex, ey, ez, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, reach);
      if (h >= 0 && h < reach) reach = h;
    }
    const pad = 0.12;
    for (const p of this.players.values()) {
      if (p.id === this.myId || p.hp <= 0 || p.prot || !p.snaps.length) continue;
      if (MODES[this.mode]?.teams && p.team === this.myTeam()) continue;
      const g = p.model.group.position;
      const body = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.35 - pad, g.y, g.z - 0.35 - pad, g.x + 0.35 + pad, g.y + 1.4, g.z + 0.35 + pad, reach);
      const head = rayAABB(ex, ey, ez, dx, dy, dz, g.x - 0.25 - pad, g.y + 1.4, g.z - 0.25 - pad, g.x + 0.25 + pad, g.y + 1.85, g.z + 0.25 + pad, reach);
      if (body >= 0 || head >= 0) return true;
    }
    return false;
  }

  // ---- portails : traverser l'un ressort par l'autre, en gardant sa vitesse ----
  _setPortal(q) {
    const pair = this.portals.get(q.o) || [null, null];
    pair[q.i] = { x: q.x, y: q.y, z: q.z, nx: q.nx, ny: q.ny || 0, nz: q.nz };
    this.portals.set(q.o, pair);
    this.fx.setPortal(`${q.o}:${q.i}`, q.i, q.x, q.y, q.z, q.nx, q.nz, q.ny || 0);
  }

  // Le joueur est-il en train d'entrer dans ce portail ?
  _inPortal(A, wx, wz) {
    const me = this.me;
    if (A.ny > 0) { // sol : on marche dessus ou on tombe dedans
      return Math.abs(me.x - A.x) < 0.65 && Math.abs(me.z - A.z) < 0.65 && me.y <= A.y + 0.1 && me.y >= A.y - 0.8 && me.vy <= 0.5;
    }
    if (A.ny < 0) { // plafond : on saute / on monte dedans
      const head = me.y + 1.8;
      return Math.abs(me.x - A.x) < 0.65 && Math.abs(me.z - A.z) < 0.65 && head >= A.y - 0.1 && head <= A.y + 0.8 && me.vy > 0.5;
    }
    const rx = me.x - A.x, rz = me.z - A.z;
    const depth = rx * A.nx + rz * A.nz;               // distance devant le portail
    const lateral = -rx * A.nz + rz * A.nx;            // décalage le long du portail
    if (depth < -0.15 || depth > 0.55 || Math.abs(lateral) > 0.55 || Math.abs(me.y + 0.9 - A.y) > 1.0) return false;
    return wx * A.nx + wz * A.nz < -0.2 || me.vx * A.nx + me.vz * A.nz < -1;
  }

  // Traversée : on ressort par l'autre portail en gardant sa vitesse (tomber dans un portail de sol = être propulsé par la sortie)
  _teleport(A, B, now) {
    const me = this.me;
    const speed = Math.hypot(me.vx, me.vy, me.vz);
    if (B.ny !== 0) {                                  // sortie au sol / au plafond
      const up = B.ny > 0, s = Math.max(speed, 7.5);
      me.x = B.x; me.z = B.z;
      me.y = up ? B.y : B.y - 1.85;
      me.vy = up ? s : -s;
      if (A.ny === 0) { me.vx *= 0.3; me.vz *= 0.3; } else { me.vx *= 0.6; me.vz *= 0.6; }
    } else if (A.ny !== 0) {                           // du sol / plafond vers un mur : projeté horizontalement
      const yaw = Math.atan2(-B.nx, -B.nz), k = Math.max(speed, 6);
      me.x = B.x + B.nx * 0.9; me.z = B.z + B.nz * 0.9; me.y = B.y - 1.0 + 0.01;
      me.vx = B.nx * k; me.vz = B.nz * k; me.vy = 0;
      me.yaw = yaw;
    } else {                                           // mur -> mur : la vue tourne pour ressortir dans le bon sens
      const dYaw = Math.atan2(-B.nx, -B.nz) - Math.atan2(A.nx, A.nz);
      const sp = Math.hypot(me.vx, me.vz);
      const ang = Math.atan2(-me.vx, -me.vz) + dYaw;
      me.x = B.x + B.nx * 0.9; me.z = B.z + B.nz * 0.9; me.y = B.y - 1.0 + 0.01;
      if (sp < 1) { me.vx = B.nx * 4.5; me.vz = B.nz * 4.5; }
      else { const k = Math.max(sp, 4.5); me.vx = -Math.sin(ang) * k; me.vz = -Math.cos(ang) * k; }
      me.yaw += dYaw;
    }
    me.onGround = false;
    me.portalUntil = now + 700;
    sfx.play('portal');
  }

  _checkPortals(now, wx, wz) {
    const me = this.me;
    if (!me.alive || now < me.portalUntil) return;
    for (const pair of this.portals.values()) {
      if (!pair[0] || !pair[1]) continue;
      for (let i = 0; i < 2; i++) {
        if (!this._inPortal(pair[i], wx, wz)) continue;
        this._teleport(pair[i], pair[1 - i], now);
        return;
      }
    }
  }

  // ---- gaz toxique (après le missile nucléaire) : brouillard vert pour tous, sauf le lanceur qui porte un masque ----
  _setGas(m) {
    if (m.off) { this.gas = null; this.hud.gas(null); this._gasLook(false); return; }
    this.gas = { owner: m.owner, until: performance.now() + m.ms };
    this._gasLook(m.owner !== this.myId);
  }

  _gasLook(toxic) {
    const sc = this.scene, map = this.map;
    if (!sc.fog || !map) return;
    if (toxic) { sc.background.set('#6f8f2a'); sc.fog.color.set('#6f8f2a'); sc.fog.near = 1; sc.fog.far = 26; }
    else { sc.background.set(map.sky); sc.fog.color.set(map.sky); sc.fog.near = map.fog[0]; sc.fog.far = map.fog[1]; }
  }

  _cycleWeapon(dir) {
    const me = this.me, n = me.loadout.length;
    const i = me.loadout.indexOf(me.weapon);
    return me.loadout[((i < 0 ? 0 : i) + dir + n) % n];
  }

  // Gun Game : niveau gagné/perdu => nouvelle arme (le couteau reste toujours utilisable)
  _setLevel(lvl) {
    const me = this.me;
    if (!this.gun || lvl === me.level) return;
    const up = lvl > me.level;
    me.level = lvl;
    const w = GUN_ORDER[lvl];
    me.ammo[w] = WEAPONS[w].mag;
    me.loadout = [w, KNIFE];
    this.hud.setLoadout(me.loadout);
    this._switchTo(w, performance.now());
    this.hud.hint(`${up ? 'Niveau supérieur' : 'Niveau perdu'} : ${lvl + 1}/${GUN_ORDER.length} — ${WEAPONS[w].name}`, 3500);
    if (up) sfx.play('spawn');
  }

  _switchTo(i, now) {
    const me = this.me;
    if (me.charging) { me.charging = false; this.net.send({ t: 'charge', on: 0 }); }
    me.weapon = i;
    me.reloadUntil = 0;
    me.scoped = false; me.aiming = false; me.scopeToggle = false;
    me.switchUntil = now + 250;
    this.viewmodel.setWeapon(i);
  }

  // Canon à orbe : un appui lance la charge (1,5 s, déplacement ralenti), le tir part tout seul quand elle est pleine
  _updateCharge(now, w, firing) {
    const me = this.me;
    if (!me.charging) {
      if (!firing) return;
      if (me.ammo[me.weapon] <= 0) return this._tryFire(now);          // vide : clic à vide + rechargement
      if (now < me.nextFire || now < me.switchUntil || me.reloadUntil || now < me.stunUntil || this.state === 'ended') return;
      me.charging = true; me.chargeAt = now;
      this.net.send({ t: 'charge', on: 1 });
      sfx.play('charge');
      return;
    }
    if (now - me.chargeAt >= w.charge) {
      me.charging = false;
      this._tryFire(now);
    }
  }

  // Grenade à main (touche G) : lancée en cloche dans la direction du regard, rebondit et explose après 2,4 s
  _throwNade(now) {
    const me = this.me;
    if (this.gun || me.flight || this.state === 'ended' || me.nades <= 0 || now < me.nadeReady || now < me.stunUntil) return;
    me.nades--; me.nadeReady = now + 800;
    const [dx, dy, dz] = lookDir(me.yaw, me.pitch);
    const up = dy + 0.22, l = Math.hypot(dx, up, dz);   // un peu vers le haut, comme un vrai lancer
    this.net.send({ t: 'nade', dx: +(dx / l).toFixed(4), dy: +(up / l).toFixed(4), dz: +(dz / l).toFixed(4) });
    this.viewmodel.fire();
    sfx.play('throw');
  }

  _startReload(now) {
    const me = this.me, w = WEAPONS[me.weapon];
    if (!w.mag || w.noReload || me.reloadUntil || me.ammo[me.weapon] >= w.mag) return;
    me.reloadUntil = now + w.reload;
    me.scoped = false; me.aiming = false; me.scopeToggle = false;
    sfx.play('reload');
  }

  _tryFire(now, alt = false) {
    const me = this.me, w = WEAPONS[me.weapon];
    if (this.state === 'ended' || now < me.nextFire || now < me.switchUntil || me.reloadUntil || now < me.stunUntil) return;
    if (alt && w.alt) { // coup ultime : recharge très longue
      const left = (me.altUntil[me.weapon] || 0) - now;
      if (left > 0) { this.hud.hint(`${w.alt.name} : recharge ${Math.ceil(left / 1000)} s`, 1500); return; }
      me.altUntil[me.weapon] = now + w.alt.cooldown;
    }
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
    const seed = shotSeed(this.sn, this.shotN++);   // imposée par le serveur (nonce du welcome), voir shared/util.js
    const spread = w.scopeSpread !== undefined && me.scoped ? w.scopeSpread
      : w.ads && me.aiming && w.ads.spread !== undefined ? w.ads.spread : w.spread;

    this.net.send({
      t: 'fire', w: me.weapon, sc: me.scoped ? 1 : 0, ad: me.aiming ? 1 : 0, alt: alt ? 1 : 0,
      ox: +ex.toFixed(3), oy: +ey.toFixed(3), oz: +ez.toFixed(3),
      dx: +dx.toFixed(4), dy: +dy.toFixed(4), dz: +dz.toFixed(4),
      rt: Math.round(this.net.serverNow() - this.interp),
    });

    // Effets locaux immédiats (même graine que le serveur => mêmes plombs)
    this.viewmodel.fire();
    sfx.play(w.kind === 'portal' && alt ? 'portal2' : alt && w.alt ? 'wave' : w.id);
    if (alt && w.alt) return; // l'onde est dessinée à la réception du message du serveur
    if (w.kind === 'portal') return;
    if (w.kind === 'flame') {
      const mz = this.camera.localToWorld(this._v.set(0.2, -0.18, -0.7));
      this.fx.jet(mz.x, mz.y, mz.z, dx, dy, dz);
    }
    if (w.kind === 'grapple' || w.kind === 'beam') {
      // pas de message "shot" pour le tireur : on dessine le trait jusqu'au premier mur (les ennemis touchés sont gérés par le serveur)
      let reach = w.range;
      for (const b of this.map.boxes) {
        const h = rayAABB(ex, ey, ez, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, reach);
        if (h >= 0 && h < reach) reach = h;
      }
      const mz = this.camera.localToWorld(this._v.set(0.2, -0.18, -0.7));
      const end = [ex + dx * reach, ey + dy * reach, ez + dz * reach];
      if (w.kind === 'beam') this.fx.tracer(mz.x, mz.y, mz.z, end[0], end[1], end[2], 0x66ffff, 0.07);
      else this.fx.tracer(mz.x, mz.y, mz.z, end[0], end[1], end[2], 0xe58a2b, 0.25);
    }
    if (!w.melee) {
      const rng = mulberry32(seed);
      let predicted = false;
      const mz = this.camera.localToWorld(this._v.set(0.2, -0.18, -0.7));
      const mx0 = mz.x, my0 = mz.y, mz0 = mz.z;
      for (let i = 0; i < (w.kind ? 0 : w.pellets); i++) {
        const [px, py, pz] = applySpread(dx, dy, dz, spread, rng);
        let tt = MAX_TRACER;
        for (const b of this.map.boxes) {
          const h = rayAABB(ex, ey, ez, px, py, pz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, tt);
          if (h >= 0 && h < tt) tt = h;
        }
        // ennemi touché d'après ce qu'on voit à l'écran : étincelle tout de suite (le serveur confirme ~1 ping plus tard)
        const eh = w.kind || w.melee ? null : this._rayEnemy(ex, ey, ez, px, py, pz, tt);
        if (eh) { tt = eh; predicted = true; this.fx.burst(ex + px * tt, ey + py * tt, ez + pz * tt, '#c62d32', 3, 2.5, 0.25); }
        this.fx.tracer(mx0, my0, mz0, ex + px * tt, ey + py * tt, ez + pz * tt);
        if (tt < MAX_TRACER && !eh) this.fx.burst(ex + px * tt, ey + py * tt, ez + pz * tt, '#cfcfcf', 2, 2, 0.3);
      }
      if (predicted) { this._predAt = now; sfx.play('tick'); }
      me.pitch += w.recoil * 0.004; // léger recul de la visée
    }
    if (w.mag && me.ammo[me.weapon] === 0) this._startReload(now + w.interval - 1);
  }

  _updateRemotes(dt) {
    const renderT = this.net.serverNow() - this.interp;
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
        const span = b.ts - a.ts || 1;
        // snapshot en retard : on prolonge le mouvement un court instant (sauf saut de téléportation : réapparition)
        const jump = Math.hypot(b.x - a.x, b.z - a.z) > 5;
        const f = clamp((renderT - a.ts) / span, 0, jump ? 1 : 1 + MAX_EXTRAP_MS / span);
        const fi = Math.min(f, 1);
        x = a.x + (b.x - a.x) * f; z = a.z + (b.z - a.z) * f;
        y = a.y + (b.y - a.y) * fi + (f > 1 ? clamp((b.y - a.y) * (f - 1), -0.3, 0.6) : 0);
        yaw = angleLerp(a.yaw, b.yaw, f); pitch = a.pitch + (b.pitch - a.pitch) * fi;
      }
      g.visible = true;
      g.position.set(x, y, z);
      g.rotation.y = yaw;
      if (!p.mob) g.scale.y += ((p.crouch ? 0.72 : 1) - g.scale.y) * Math.min(1, dt * 10);   // accroupi : silhouette tassée
      p.model.head.rotation.x = clamp(pitch, -1.2, 1.2);
      p.model.setWeapon(WEAPONS[p.weapon]?.id ?? 'ar');

      if (p.hpFill) { const f = clamp(p.hp / p.mob.max, 0, 1); p.hpFill.scale.x = 0.96 * f + 1e-4; p.hpFill.position.x = -0.48 * (1 - f); }
      if (p.charging) this.fx.burst(g.position.x, g.position.y + 1.3, g.position.z, '#c040ff', 1, 1.6, 0.4);

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
    this._crouchT += ((me.crouch || me.sliding ? 1 : 0) - this._crouchT) * Math.min(1, dt * (me.sliding ? 16 : 10));
    this._landKick = Math.max(0, (this._landKick || 0) - dt * 0.6);
    let eye = me.y + EYE_HEIGHT - (EYE_HEIGHT - EYE_HEIGHT_CROUCH) * this._crouchT - this._landKick;
    let roll = 0;
    if (!me.alive && me.spawned) {
      const k = Math.min(1, me.deadT * 2.5);
      eye = me.y + EYE_HEIGHT - (EYE_HEIGHT - 0.35) * k;
      roll = 0.9 * k;
    }
    const fl = me.flight;
    if (fl) { // vue depuis le nez de l'avion, qui s'incline dans les virages
      let d = (me.yaw - fl.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
      cam.position.set(fl.x, fl.y, fl.z);
      cam.rotation.set(fl.pitch, fl.yaw, clamp(d * 0.5, -0.5, 0.5));
      this._applyFov(false);
      document.getElementById('scope').classList.add('hidden');
      document.body.classList.remove('scoped', 'aiming');
      this.viewmodel.update(dt, { speed: 0, onGround: true, reloadProgress: null, visible: false });
      return;
    }
    cam.position.set(me.x, eye, me.z);
    let sx = 0, sy = 0;
    if (this.shake > 0.001) {
      sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.02, dt);
    }
    cam.rotation.set(me.pitch + sx, me.yaw + sy, roll);
    this._applyFov(false);

    const w = WEAPONS[me.weapon];
    const scopedIn = me.scoped && w.zoom && this.fov < w.zoom + 6;
    document.getElementById('scope').classList.toggle('hidden', !scopedIn);
    document.body.classList.toggle('scoped', scopedIn);
    document.body.classList.toggle('aiming', !!(me.aiming && w.ads));
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
      if (this.mode === 'survival') return this.hud.banner(`FIN DE PARTIE — manche ${this.endWave}`, `${this.mvp != null ? `MVP : ${this._name(this.mvp)} · ` : ''}Nouvelle partie dans ${Math.max(0, Math.ceil((this.until - this.net.serverNow()) / 1000))}s`);
      if (w?.team) title = `L'équipe ${w.team === 'red' ? 'ROUGE' : 'BLEUE'} gagne !`;
      else if (w) title = w.id === this.myId ? 'VICTOIRE !' : `${this._name(w.id)} gagne !`;
      const left = Math.max(0, Math.ceil((this.until - this.net.serverNow()) / 1000));
      return this.hud.banner(title, `${this.mvp != null ? `MVP : ${this._name(this.mvp)} · ` : ''}Nouvelle manche dans ${left}s`);
    }
    return this.hud.banner(null);
  }

  _updateHud(now) {
    const me = this.me;
    this.hud.setHp(me.alive ? me.hp : 0, me.maxHp);
    this.hud.setNades(me.nades, !this.gun);
    if (this.mode === 'survival') this.hud.survLine(this.surv, me.cash, this.surv ? Math.max(0, Math.ceil((this.surv.until - this.net.serverNow()) / 1000)) : 0);
    this.hud.setWeapon(me.weapon, me.ammo[me.weapon], !!me.reloadUntil);
    const cw = WEAPONS[me.weapon];
    let special = '';
    if (cw.alt) {
      const left = (me.altUntil[me.weapon] || 0) - now;
      special = left > 0 ? `${cw.alt.name} : recharge ${Math.ceil(left / 1000)} s` : `${cw.alt.name} : PRÊT (clic droit / E)`;
    } else if (cw.kind === 'portal') special = 'Clic : portail bleu · clic droit / E : portail orange';
    else if (cw.kind === 'grapple') special = 'Saut pendant le grappin : on se décroche en gardant l\'élan';
    else if (cw.charge) special = `Un appui : charge ${(cw.charge / 1000).toFixed(1).replace('.', ',')} s (tu ralentis), puis l'orbe traverse les ennemis`;
    else if (cw.kind === 'plane') special = 'Un appui : lancer · souris : diriger · tir : abandonner';
    else if (cw.streak !== undefined) special = `Arme de série · un seul chargeur${cw.kind === 'nuke' ? ' · 1 missile' : ''}`;
    if (me.flight) special = `AVION EN PAPIER · ${Math.max(0, Math.ceil(PLANE.life - (now - me.flight.born) / 1000))} s · tir : abandonner`;
    this.hud.setSpecial(special);
    this.hud.setCharge(me.charging ? clamp((now - me.chargeAt) / cw.charge, 0, 1) : null);
    if (this.nukeAt) this.hud.nukeCount(Math.max(0, (this.nukeAt - now) / 1000));
    if (this.gas) this.hud.gas(this.gas.owner === this.myId ? 'mask' : 'toxic', Math.max(0, (this.gas.until - now) / 1000));

    if (!me.alive && me.spawned && this.state !== 'ended') {
      const left = Math.max(0, Math.ceil((me.respawnAt - now) / 1000));
      this.hud.death(true, me.killer ? this._name(me.killer) : '', this.mode === 'survival' ? -1 : left);
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

    const list = () => [...this.players.values()].filter((p) => !p.mob);
    if (this.scoreDirty) {
      this.scoreDirty = false;
      if (this.mode !== 'survival') this.hud.scoreLine(this.mode, list(), this.teamKills, this.myId, this.limit);
    }
    const showBoard = this.input.scoreHeld || this.state === 'ended';
    this.hud.showScoreboard(showBoard);
    if (showBoard && (this._boardT ?? 0) < now) {
      this._boardT = now + 250;
      this.hud.renderScoreboard(this.mode, list(), this.teamKills, this.myId);
    }
  }
}
