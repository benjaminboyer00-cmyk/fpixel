// Serveur FPIXEL : WebSocket (salons + logique de jeu) + fichiers statiques du client.
// Tourne sur un Space Hugging Face (Docker, port 7860) ou en local : `npm run dev`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { randomInt } from 'node:crypto';

import {
  TICK_MS, REWIND_MAX_MS, MAX_RAY, EYE_HEIGHT, MAX_HP, WALK_SPEED, SPRINT_MUL, RESPAWN_MS, SPAWN_PROTECT_MS,
  REGEN_DELAY_MS, REGEN_PER_S, END_SCREEN_MS, BODY_HALF, BODY_TOP, HEAD_HALF, HEAD_TOP, BODY_TOP_CROUCH, HEAD_TOP_CROUCH,
  MODES, WEAPONS, GUN_ORDER, KNIFE, CLASSES, resolveClass, W, STREAK_WEAPONS, STREAK_AT, NUKE_GAS_MS, NUKE_GAS_DPS, NADE_MAX, NADE_REGEN_MS, SURV, shopItem, shopPrice,
  MYSTERY_POOL, MYSTERY_RARE, MYSTERY_RARE_CHANCE,
} from '../web/shared/config.js';
import { MAPS, mapById } from '../web/shared/map.js';
import { rayAABB, applySpread, mulberry32, clamp, shotSeed } from '../web/shared/util.js';
import { BOT_NAMES, newBotAI, botStep, botClass, computeFlow } from './bots.js';
import { MOBS, mobPower, waveList, newMobState, mobStep } from './mobs.js';
import { stepPlane, PLANE } from '../web/shared/plane.js';

// Survie : réglages surchargeables (tests) — durées de préparation / de fin de partie, argent de départ, vitesse des monstres
const SURV_T = { first: Number(process.env.SURV_FIRST_PREP_MS) || SURV.FIRST_PREP_MS, prep: Number(process.env.SURV_PREP_MS) || SURV.PREP_MS, over: Number(process.env.SURV_OVER_MS) || SURV.OVER_MS };
const SURV_CASH = process.env.SURV_START_CASH !== undefined ? Number(process.env.SURV_START_CASH) : SURV.START_CASH;
const MOB_SPEED = Number(process.env.SURV_MOB_SPEED) || 1;

const STREAKS = process.env.STREAKS ? process.env.STREAKS.split(',').map(Number) : STREAK_AT; // kills d'affilée pour le laser, le lance-flammes, le missile

const PORT = Number(process.env.PORT) || 7860;
// surcharges pour les tests
const RESPAWN = Number(process.env.RESPAWN_MS) || RESPAWN_MS;
const PROTECT = Number(process.env.PROTECT_MS) || SPAWN_PROTECT_MS;
const GRACE_MS = Number(process.env.GRACE_MS) || 20000; // temps laissé à un joueur déconnecté pour revenir
// Contrôle des déplacements : 0 pour le désactiver (tests qui téléportent les joueurs)
const MOVE_CHECK = process.env.MOVE_CHECK !== '0';
const WEB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

// ---------------------------------------------------------------- HTTP ----

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

function sendJson(res, obj) {
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

// Fichiers statiques : compressés (gzip) et mis en cache mémoire une fois pour toutes en production (un déploiement
// = un nouveau process = cache forcément à jour). En dev (`npm run dev`), on relit le disque à chaque requête pour
// voir les changements sans redémarrer. L'ETag permet aux navigateurs de ne pas retélécharger un fichier inchangé
// (304), important juste après le réveil d'un Space endormi où plusieurs joueurs chargent tout en même temps.
const PROD = process.env.NODE_ENV === 'production';
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);
const staticCache = new Map(); // chemin de fichier -> { data, gz, mime, etag }

function loadStatic(file, cb) {
  const cached = staticCache.get(file);
  if (PROD && cached) return cb(null, cached);
  fs.stat(file, (serr, st) => {
    if (serr) return cb(serr);
    fs.readFile(file, (err, data) => {
      if (err) return cb(err);
      const ext = path.extname(file);
      const entry = {
        data,
        mime: MIME[ext] || 'application/octet-stream',
        etag: `"${st.size}-${Math.round(st.mtimeMs)}"`,
        gz: COMPRESSIBLE.has(ext) ? zlib.gzipSync(data) : null,
      };
      if (PROD) staticCache.set(file, entry);
      cb(null, entry);
    });
  });
}

const httpServer = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }

  if (pathname === '/health' || pathname === '/api/rooms') return sendJson(res, lobbyInfo());

  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(WEB_ROOT, pathname));
  if (!file.startsWith(WEB_ROOT + path.sep)) { res.writeHead(403); return res.end('403'); }
  loadStatic(file, (err, entry) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); return res.end(); }
    const gz = entry.gz && (req.headers['accept-encoding'] || '').includes('gzip');
    res.writeHead(200, {
      'Content-Type': entry.mime,
      'Cache-Control': 'no-cache',
      ETag: entry.etag,
      ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
    });
    res.end(gz ? entry.gz : entry.data);
  });
});

// ---------------------------------------------------------------- Salons ----

const rooms = new Map(); // id -> room
const tokens = new Map(); // jeton de reconnexion -> joueur
let nextPlayerId = 1;
let nextAutoRoom = 1;

// Charge de la boucle de jeu (visible dans /health) : retard moyen / max du tick et temps de calcul par tick, en ms
const tickStats = { late: 0, lateMax: 0, work: 0, workMax: 0 };

function lobbyInfo() {
  const modes = {};
  for (const m of Object.keys(MODES)) modes[m] = { players: 0, max: MODES[m].max, rooms: [] };
  let online = 0;
  for (const r of rooms.values()) {
    const n = humanCount(r);
    modes[r.mode].players += n;
    online += n;
    if (r.private) continue;   // survie en solo : jamais listée (son nom dérive du jeton de reconnexion)
    modes[r.mode].rooms.push({ rid: r.id, id: r.name, n, max: r.cfg.max, bots: r.fill, diff: r.diff, map: r.map.id, auto: r.auto, state: r.state });
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  return { ok: true, online, modes, tick: { ms: TICK_MS, late: r1(tickStats.late), lateMax: r1(tickStats.lateMax), work: r1(tickStats.work), workMax: r1(tickStats.workMax) } };
}

function humanCount(room) {
  let n = 0;
  for (const p of room.players.values()) if (!p.bot) n++;
  return n;
}

// Options d'un salon, choisies par celui qui le crée :
//   bots  : 0 = aucun, 1 = compléter automatiquement, N (2..10) = viser N joueurs au total
//   diff  : easy | normal | hard (niveau des bots)
//   limit : frags pour gagner (0 = valeur du mode)
const DIFF_IDS = ['easy', 'normal', 'hard'];
function parseOpts(m) {
  let bots = m.bots;
  if (bots === undefined || bots === true) bots = 1;
  else if (bots === false) bots = 0;
  bots = Number(bots);
  bots = Number.isFinite(bots) ? clamp(Math.round(bots), 0, 10) : 1;
  return {
    bots,
    diff: DIFF_IDS.includes(m.diff) ? m.diff : 'normal',
    limit: clamp(Math.round(Number(m.limit)) || 0, 0, 200),
    map: typeof m.map === 'string' && Object.hasOwn(MAPS, m.map) ? m.map : 'arena',
  };
}
const optsKey = (o) => `${o.bots}|${o.diff}|${o.limit}|${o.map}`;

// La capacité ne compte que les humains : les bots cèdent leur place.
// Les salons automatiques sont partagés seulement entre joueurs qui ont choisi les mêmes options.
function findRoom(mode, name, opts) {
  const cfg = MODES[mode];
  if (name) {
    const id = `${mode}:${name}`;
    let room = rooms.get(id);
    if (!room) room = createRoom(id, mode, name, opts);
    if (!room) return null;
    return humanCount(room) >= cfg.max ? null : room;
  }
  const key = optsKey(opts);
  for (const r of rooms.values()) {
    if (r.mode === mode && r.auto && r.optsKey === key && humanCount(r) < cfg.max) return r;
  }
  const n = nextAutoRoom++;
  const room = createRoom(`${mode}#${n}`, mode, `salon ${n}`, opts);
  if (!room) return null;
  room.auto = true;
  return room;
}

const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 40;   // chaque salon fait tourner jusqu'à 10 bots : on borne le total

function createRoom(id, mode, name, opts) {
  if (rooms.size >= MAX_ROOMS) return null;
  const cfg = MODES[mode];
  const map = mapById(opts.map);
  const room = {
    id, mode, name, cfg, auto: false,
    fill: mode === 'survival' || opts.bots === 0 ? 0 : opts.bots === 1 ? cfg.fill : Math.min(opts.bots, cfg.max), // joueurs visés (humains + bots)
    diff: opts.diff, optsKey: optsKey(opts), map,
    killLimit: mode === 'gun' ? GUN_ORDER.length : opts.limit || Number(process.env.KILL_LIMIT) || cfg.killLimit,
    players: new Map(),
    state: mode === 'duel' ? 'waiting' : 'playing', // waiting (duel seul) | playing | ended
    teamKills: { red: 0, blue: 0 },
    endAt: 0, winner: null,
    projs: [], nextProj: 1,        // projectiles en vol (roquettes, grenades)
    portals: new Map(),            // id du propriétaire -> [portail bleu, portail orange]
    planes: new Map(),             // avions en papier en vol : id du pilote -> avion
    surv: mode === 'survival' ? { wave: 0, phase: 'prep', until: Date.now() + SURV_T.first, queue: [], nextSpawn: 0, lastSent: 0 } : null,   // manches de la survie
    flow: null, flowAt: 0, flowKey: '',   // champ de flux des monstres (survie)
    nuke: null,                    // missile nucléaire en vol : { owner, at }
    gas: null,                     // gaz toxique après le missile : { owner, until }
    private: mode === 'survival' && name.startsWith('solo'),   // survie solo : jamais listée publiquement
  };
  rooms.set(id, room);
  return room;
}

// ---------------------------------------------------------------- Envoi ----

function send(p, obj) {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
}
function broadcast(room, obj, except = null) {
  const data = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}
const r2 = (v) => Math.round(v * 100) / 100;

function cleanName(s, id) {
  const n = String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 14);
  return n || `Joueur${id}`;
}
function cleanRoom(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
}

// ---------------------------------------------------------------- Joueurs ----

function pickTeam(room) {
  if (room.mode === 'survival') return 'blue';   // les joueurs sont ensemble contre les monstres (rouges)
  if (!room.cfg.teams) return null;
  let red = 0, blue = 0;
  for (const q of room.players.values()) q.team === 'red' ? red++ : blue++;
  return red < blue ? 'red' : blue < red ? 'blue' : Math.random() < 0.5 ? 'red' : 'blue';
}

function newPlayer(room, id, ws, name, team) {
  return {
    id, ws, room, name, team,
    bot: false, vx: 0, vy: 0, vz: 0, onGround: true,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, weapon: 0,
    hp: 0, alive: false, k: 0, d: 0, level: 0,
    token: null, away: false, graceUntil: 0, leaving: false,
    cls: CLASSES.classic, pending: null, loadout: CLASSES.classic.weapons.slice(), maxHp: MAX_HP, speedMul: 1, pull: null,
    streak: 0, streakAmmo: {}, stunUntil: 0, altUntil: {},
    nades: 0, nadeReady: 0, nadeRegenAt: 0, st: newStats(), chargeAt: 0,
    cash: 0, owned: [], up: { hp: 0, dmg: 0, spd: 0 }, dmgMul: 1, mob: null, mst: null, scale: 1, nextAtk: 0,   // survie
    respawnAt: 0, protectUntil: 0, lastDamage: 0, nextFire: 0, crouch: false,
    hist: [],
  };
}

function addPlayer(room, ws, name) {
  const id = nextPlayerId++;
  const p = newPlayer(room, id, ws, cleanName(name, id), pickTeam(room));
  if (room.mode === 'survival') p.cash = SURV_CASH + Math.max(0, room.surv.wave - 1) * 120;   // rattrapage pour ceux qui arrivent en cours de partie
  room.players.set(id, p);
  ws.player = p;
  return p;
}

// ---- bots ----
function addBot(room) {
  const id = nextPlayerId++;
  const used = new Set([...room.players.values()].map((q) => q.name));
  const free = BOT_NAMES.filter((n) => !used.has(`Bot ${n}`));
  const name = `Bot ${free.length ? free[(Math.random() * free.length) | 0] : id}`;
  const b = newPlayer(room, id, null, name, pickTeam(room));
  b.bot = true;
  b.ai = newBotAI(room.diff);
  room.players.set(id, b);
  broadcast(room, { t: 'pjoin', p: publicPlayer(b) });
  spawnPlayer(room, b);
}

function dropPlayer(room, p) {
  room.players.delete(p.id);
  broadcast(room, { t: 'pleave', id: p.id });
}

// Ajuste le nombre de bots pour que la partie soit "pleine" (humains + bots = room.fill).
// Retourne true si des bots ont été ajoutés ou retirés.
function adjustBots(room) {
  if (room.mode === 'survival') return false;
  const humans = humanCount(room);
  if (!humans) return false;
  const want = room.fill > 0 ? Math.max(0, room.fill - humans) : 0;
  let bots = [...room.players.values()].filter((p) => p.bot);
  let changed = false;
  while (bots.length > want) {
    let pool = bots;
    if (room.cfg.teams) { // on retire un bot de l'équipe la plus nombreuse
      const count = { red: 0, blue: 0 };
      for (const q of room.players.values()) count[q.team]++;
      const big = count.red >= count.blue ? 'red' : 'blue';
      const inBig = bots.filter((b) => b.team === big);
      if (inBig.length) pool = inBig;
    }
    dropPlayer(room, pool[pool.length - 1]);
    bots = [...room.players.values()].filter((p) => p.bot);
    changed = true;
  }
  while (bots.length < want) { addBot(room); bots = [...room.players.values()].filter((p) => p.bot); changed = true; }
  if (changed) broadcast(room, scoreMsg(room));
  return changed;
}

// À appeler quand un humain arrive ou part. Retourne true si le match a été relancé.
function afterRosterChange(room) {
  const changed = adjustBots(room);
  if (room.cfg.id === 'duel') {
    if (room.players.size >= 2 && (changed || room.state === 'waiting')) { resetMatch(room); return true; }
    if (room.players.size < 2 && room.state !== 'waiting') {
      room.state = 'waiting';
      broadcast(room, { t: 'state', s: 'waiting', win: null });
    }
  }
  return false;
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, team: p.team, k: p.k, d: p.d, hp: p.hp, w: p.weapon, bot: !!p.bot, lvl: shownLevel(p),
    ...(p.mob ? { mob: { c: p.mob.color, s: p.mob.scale, max: p.maxHp, t: p.mob.type } } : {}),
  };
}

const shownLevel = (p) => Math.min(p.level, GUN_ORDER.length - 1);

function scoreMsg(room) {
  return {
    t: 'score',
    p: [...room.players.values()].filter((p) => !p.mob).map((p) => [p.id, p.k, p.d, shownLevel(p)]),
    team: room.teamKills,
  };
}

const SPAWN_SIGHT = 45;   // au-delà, un ennemi qui voit le point d'apparition n'est pas une menace immédiate
// L'ennemi q voit-il le point d'apparition s (de ses yeux au torse d'un joueur debout) ?
function spawnVisible(map, q, s, d) {
  if (d < 0.5) return true;
  const oy = q.y + 1.6, ty = 1.2;
  const dx = (s.x - q.x) / d, dz = (s.z - q.z) / d, dy = (ty - oy) / d, l = Math.hypot(dx, dy, dz);
  return rayMap(map, q.x, oy, q.z, dx / l, dy / l, dz / l, d * l).t >= d * l - 0.3;
}

function pickSpawn(room, p) {
  const others = [...room.players.values()].filter((q) => q !== p && q.alive);
  const enemies = others.filter((q) => !room.cfg.teams || q.team !== p.team);
  const spawns = room.map.spawns;
  let pool = spawns.filter((s) => (room.cfg.teams ? s.team === p.team : true));
  if (!pool.length) pool = spawns;
  const scored = pool.map((s) => {
    let dmin = 1e9, seen = 0;
    for (const q of enemies) {
      const d = Math.hypot(q.x - s.x, q.z - s.z);
      dmin = Math.min(dmin, d);
      if (d < SPAWN_SIGHT && spawnVisible(room.map, q, s, d)) seen++;
    }
    // jamais sur quelqu'un (coéquipier compris) : sinon les joueurs apparaissent empilés
    const taken = others.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 2.5);
    // un point vu par un ennemi est fortement déconseillé : c'est ce qui donne les « spawn kills »
    return { s, dmin: Math.min(dmin, 60) + Math.random() * 6 - seen * 45 - (taken ? 1000 : 0) }; // un peu d'aléatoire pour ne pas être prévisible
  });
  scored.sort((a, b) => b.dmin - a.dmin);
  return scored[0].s;
}

// Statistiques de manche (écran de fin)
function newStats() { return { shots: 0, hits: 0, dmg: 0, head: 0, bestStreak: 0, byWeapon: {} }; }
// Seules les armes « de visée » comptent pour la précision (pas le laser/flammes, grappin, portail, missile)
const countsAcc = (wi) => { const w = WEAPONS[wi]; return !!w && w.streak === undefined && !w.item && w.kind !== 'portal' && w.kind !== 'grapple'; };

function statsMsg(room) {
  const rows = [];
  let mvp = null;
  for (const p of room.players.values()) {
    if (p.mob) continue;
    const s = p.st;
    let fav = -1, fn = 0;
    for (const [wi, n] of Object.entries(s.byWeapon)) if (n > fn) { fn = n; fav = +wi; }
    const acc = s.shots ? Math.min(100, Math.round((100 * s.hits) / s.shots)) : 0;
    rows.push([p.id, p.k, p.d, Math.round(s.dmg), acc, s.head, s.bestStreak, fav]);
    if (!mvp || p.k > mvp.k || (p.k === mvp.k && s.dmg > mvp.st.dmg)) mvp = p;
  }
  return { rows, mvp: mvp ? mvp.id : null };
}

// Applique la classe (choisie à l'arrivée, ou changée depuis la pause : effet à la réapparition)
function applyClass(room, p) {
  if (room.mode === 'survival') { // survie : revolver + couteau, puis ce qui a été acheté à la boutique
    p.pending = null;
    p.loadout = [...SURV.START_WEAPONS, ...p.owned];
    p.maxHp = MAX_HP + 25 * p.up.hp; p.speedMul = 1 + 0.06 * p.up.spd; p.dmgMul = 1 + 0.15 * p.up.dmg;
    p.streakAmmo = {};
    if (!p.loadout.includes(p.weapon)) p.weapon = p.loadout[0];
    return;
  }
  if (p.bot && room.mode !== 'gun') p.pending = botClass(p.ai.diff);   // les bots changent de classe à chaque réapparition
  if (p.pending) { p.cls = p.pending; p.pending = null; }
  if (room.mode === 'gun') { p.loadout = [GUN_ORDER[shownLevel(p)], KNIFE]; p.maxHp = MAX_HP; p.speedMul = 1; }
  else { p.loadout = p.cls.weapons.slice(); p.maxHp = p.cls.hp; p.speedMul = p.cls.speed; }
  p.streakAmmo = {};
  if (!p.loadout.includes(p.weapon)) p.weapon = p.loadout[0];
}

function spawnPlayer(room, p, now = Date.now()) {
  applyClass(room, p);
  const s = pickSpawn(room, p);
  p.x = s.x; p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
  p.vx = p.vy = p.vz = 0; p.onGround = true;
  p.hp = p.maxHp; p.alive = true; p.pull = null; p.stunUntil = 0;
  p.nades = room.mode === 'gun' ? 0 : NADE_MAX; p.nadeRegenAt = 0; p.nadeReady = 0;
  p.protectUntil = now + PROTECT;
  p.lastDamage = 0; p.nextFire = 0;
  p.hist = [];
  resetMove(p, now);
  send(p, { t: 'spawn', x: s.x, y: 0, z: s.z, yaw: s.yaw, hp: p.maxHp, maxHp: p.maxHp, loadout: p.loadout, speed: p.speedMul, nades: p.nades });
}

function resetMatch(room) {
  if (room.mode === 'survival') { // fin de partie : tout recommence à la manche 1
    for (const p of [...room.players.values()]) if (p.mob) dropPlayer(room, p);
    room.surv = { wave: 0, phase: 'prep', until: Date.now() + SURV_T.first, queue: [], nextSpawn: 0, lastSent: 0 };
    room.flow = null;
    for (const p of room.players.values()) { p.cash = SURV_CASH; p.owned = []; p.up = { hp: 0, dmg: 0, spd: 0 }; p.dmgMul = 1; sendCash(p); }
  }
  room.teamKills = { red: 0, blue: 0 };
  room.winner = null;
  room.nuke = null;
  for (const id of [...room.planes.keys()]) endPlane(room, id, 'reset');
  if (room.gas) { room.gas = null; broadcast(room, { t: 'gas', off: 1 }); }
  room.state = room.cfg.id === 'duel' && room.players.size < 2 ? 'waiting' : 'playing';
  for (const p of room.players.values()) { p.k = 0; p.d = 0; p.level = 0; p.streak = 0; p.st = newStats(); }
  broadcast(room, { t: 'state', s: room.state, win: null });
  broadcast(room, scoreMsg(room));
  const now = Date.now();
  for (const p of room.players.values()) if (!p.away) spawnPlayer(room, p, now);
}

function removePlayer(p) {
  const room = p.room;
  if (p.token && tokens.get(p.token) === p) tokens.delete(p.token);
  if (!room || !room.players.delete(p.id)) return;
  if (room.portals.delete(p.id)) broadcast(room, { t: 'portalOff', o: p.id });
  endPlane(room, p.id, 'leave');
  if (room.nuke?.owner === p) { room.nuke = null; broadcast(room, { t: 'nukeOff' }); }
  if (room.gas?.owner === p) { room.gas = null; broadcast(room, { t: 'gas', off: 1 }); }
  broadcast(room, { t: 'pleave', id: p.id });
  if (!humanCount(room)) { rooms.delete(room.id); return; } // plus d'humains : on ferme (les bots partent avec)
  broadcast(room, scoreMsg(room));
  afterRosterChange(room);
}

// ---------------------------------------------------------------- Tirs ----

function sampleHist(q, t) {
  const h = q.hist;
  if (!h.length) return { x: q.x, y: q.y, z: q.z, yaw: q.yaw };
  const last = h[h.length - 1];
  if (t >= last[0]) return { x: last[1], y: last[2], z: last[3], yaw: last[4] };
  if (t <= h[0][0]) return { x: h[0][1], y: h[0][2], z: h[0][3], yaw: h[0][4] };
  for (let i = h.length - 2; i >= 0; i--) {
    if (h[i][0] <= t) {
      const a = h[i], b = h[i + 1];
      const f = (t - a[0]) / (b[0] - a[0] || 1);
      return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, z: a[3] + (b[3] - a[3]) * f, yaw: b[4] };
    }
  }
  return { x: last[1], y: last[2], z: last[3], yaw: last[4] };
}

function falloff(w, dist) {
  if (!w.falloff) return 1;
  const [r0, r1, min] = w.falloff;
  if (dist <= r0) return 1;
  if (dist >= r1) return min;
  return 1 - (1 - min) * ((dist - r0) / (r1 - r0));
}

// ---- outils de tir ----

// Premier obstacle de la carte le long du rayon (distance + boîte touchée)
function rayMap(map, ox, oy, oz, dx, dy, dz, maxD) {
  let t = maxD, box = null;
  for (const b of map.boxes) {
    const h = rayAABB(ox, oy, oz, dx, dy, dz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, t);
    if (h >= 0 && h < t) { t = h; box = b; }
  }
  return { t, box };
}

// Premier joueur touché (corps ou tête) avant tMax ; pad agrandit les boîtes (mêlée, foudre)
function rayPlayers(targets, ox, oy, oz, dx, dy, dz, tMax, pad = 0) {
  let best = null;
  for (const tg of targets) {
    const sc = tg.q.scale || 1;   // les gros monstres ont une boîte de collision à leur taille
    const crouch = tg.q.crouch;   // accroupi : profil plus bas, plus dur à toucher (surtout à la tête)
    const bh = BODY_HALF * sc, bt = (crouch ? BODY_TOP_CROUCH : BODY_TOP) * sc, hh = HEAD_HALF * sc, ht = (crouch ? HEAD_TOP_CROUCH : HEAD_TOP) * sc;
    const tb = rayAABB(ox, oy, oz, dx, dy, dz,
      tg.x - bh - pad, tg.y, tg.z - bh - pad, tg.x + bh + pad, tg.y + bt, tg.z + bh + pad, tMax);
    const th = rayAABB(ox, oy, oz, dx, dy, dz,
      tg.x - hh - pad, tg.y + bt, tg.z - hh - pad, tg.x + hh + pad, tg.y + ht, tg.z + hh + pad, tMax);
    let t = -1, head = false;
    if (th >= 0 && (tb < 0 || th <= tb)) { t = th; head = true; } else if (tb >= 0) t = tb;
    if (t >= 0 && t < tMax && (!best || t < best.t)) best = { tg, t, head };
  }
  return best;
}

// Pas de mur entre les points a et b ?
function clearLine(map, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return true;
  const { box, t } = rayMap(map, a[0], a[1], a[2], dx / d, dy / d, dz / d, d);
  return !box || t >= d - 0.25;
}

// Face de la boîte touchée en (px,py,pz) : la plus proche du point d'impact
function hitNormal(box, px, py, pz) {
  const faces = [
    [Math.abs(px - box.x0), -1, 0, 0], [Math.abs(px - box.x1), 1, 0, 0],
    [Math.abs(pz - box.z0), 0, 0, -1], [Math.abs(pz - box.z1), 0, 0, 1],
    [Math.abs(py - box.y0), 0, -1, 0], [Math.abs(py - box.y1), 0, 1, 0],
  ];
  faces.sort((a, b) => a[0] - b[0]);
  return { nx: faces[0][1], ny: faces[0][2], nz: faces[0][3] };
}

// ---- contrôle des déplacements envoyés par les clients ----
// Le client calcule encore son mouvement (réactivité), mais le serveur tient un « budget de distance » qui se recharge à la
// vitesse max autorisée (sprint × bonus de classe + marge). Un saut de position plus grand que le budget est refusé et le
// client est recalé ({t:'fix'}). Seau percé plafonné à ~1 s de course : une coupure réseau (paquets en rafale) passe sans
// accroc, un speedhack ou une téléportation non. Grappin et explosions ouvrent une fenêtre plus large (moveBoost / resetMove).
const MOVE_SLACK = 2.5;
const SLIDE_EVERY_MS = 1000;                              // glissade : le client en annonce au plus une par seconde                                   // mètres de tolérance permanente
function resetMove(p, now) { p.mv = { t: now, budget: 1e9 }; }  // prochaine position acceptée telle quelle (réapparition…)
function moveBoost(p, now, ms, speed) {
  const active = now < (p.boostUntil || 0);
  p.boostSpeed = active ? Math.max(p.boostSpeed || 0, speed) : speed;
  p.boostUntil = Math.max(active ? p.boostUntil : 0, now + ms);
}
function nearPortal(room, x, z) {
  for (const pair of room.portals.values()) for (const q of pair) if (q && Math.hypot(q.x - x, q.z - z) < 3.2) return true;
  return false;
}
function checkMove(p, x, z, now) {
  if (!MOVE_CHECK || p.bot) return true;
  const mv = p.mv || (p.mv = { t: now, budget: 0 });
  const dt = Math.min(1000, Math.max(0, now - mv.t)) / 1000;
  mv.t = now;
  const vmax = WALK_SPEED * SPRINT_MUL * (p.speedMul || 1) * 1.3 + (now < (p.boostUntil || 0) ? p.boostSpeed || 0 : 0);
  const cap = vmax * 0.8 + MOVE_SLACK;   // ~0,8 s de course d'avance au maximum
  if (mv.budget > cap && mv.budget < 1e8) mv.budget = cap;
  const d = Math.hypot(x - p.x, z - p.z);
  if (mv.budget >= 1e8) { mv.budget = cap; return true; }       // après une remise à zéro
  mv.budget = Math.min(cap, mv.budget + vmax * dt);
  if (d <= mv.budget) { mv.budget -= d; return true; }
  if (nearPortal(p.room, x, z) && nearPortal(p.room, p.x, p.z)) { mv.budget = cap; return true; }   // traversée de portail
  p.moveStrikes = (p.moveStrikes || 0) + 1;
  return false;
}

// Recul / attraction : les mouvements sont calculés par les clients, on leur envoie l'impulsion
function pushPlayer(q, vx, vy, vz) {
  moveBoost(q, Date.now(), 1500, Math.hypot(vx, vz) * 1.2 + 4);
  if (q.bot) { q.vx += vx; q.vy += vy; q.vz += vz; q.onGround = false; }
  else send(q, { t: 'push', v: [r2(vx), r2(vy), r2(vz)] });
}
function pullPlayer(q, to, pull, now, hook = null) {
  moveBoost(q, now, pull.ms + 600, pull.speed * 1.25);
  if (q.bot) q.pull = { x: to.x, z: to.z, speed: pull.speed, until: now + pull.ms };
  else send(q, { t: 'pull', x: r2(to.x), y: r2(to.y), z: r2(to.z), sp: pull.speed, ms: pull.ms, ...(hook ? { hook: hook.map(r2) } : {}) });
}

// Étourdissement (laser) : la victime ne peut ni bouger ni tirer
function stun(q, ms, now) {
  if (!q.alive) return;
  const was = now < q.stunUntil;
  q.stunUntil = now + ms;
  if (!q.bot && !was) send(q, { t: 'stun', ms });
}

// ---- projectiles (lance-roquettes, lance-grenades) ----
function fireProjectile(room, p, w, wi, o, d, now) {
  const pr = w.proj;
  const P = {
    id: room.nextProj++, owner: p, wi, w, born: now,
    x: o[0] + d[0] * 0.5, y: o[1] + d[1] * 0.5, z: o[2] + d[2] * 0.5,
    vx: d[0] * pr.speed, vy: d[1] * pr.speed, vz: d[2] * pr.speed,
  };
  room.projs.push(P);
  broadcast(room, { t: 'proj', id: P.id, w: wi, s: p.id, o: [r2(P.x), r2(P.y), r2(P.z)], v: [r2(P.vx), r2(P.vy), r2(P.vz)], g: pr.gravity });
}

function explode(room, P, pt, now, direct = null) {
  const w = P.w, pr = w.proj, owner = P.owner;
  broadcast(room, { t: 'boom', id: P.id, w: P.wi, x: r2(pt.x), y: r2(pt.y), z: r2(pt.z), r: pr.radius });
  for (const q of [...room.players.values()]) {
    if (!q.alive || now < q.protectUntil) continue;
    const c = [q.x, q.y + 0.9, q.z];
    const dist = Math.hypot(c[0] - pt.x, c[1] - pt.y, c[2] - pt.z);
    if (dist > pr.radius) continue;
    if (!clearLine(room.map, [pt.x, pt.y, pt.z], c)) continue; // à couvert derrière un mur
    const f = q === direct ? 1 : 1 - (1 - pr.minMul) * (dist / pr.radius); // tir direct = dégâts complets
    const self = q === owner;
    const friendly = !self && room.cfg.teams && q.team === owner.team;
    if (!friendly) applyDamage(room, owner, q, w.dmg * f * (self ? pr.self : 1), false, P.wi, now);
    // recul : plus fort près de l'explosion, et toujours un peu vers le haut (le "rocket jump")
    const l = dist || 1;
    const k = pr.knock * f * (self ? 1.1 : 1);
    pushPlayer(q, ((c[0] - pt.x) / l) * k, ((c[1] - pt.y) / l) * k + 4, ((c[2] - pt.z) / l) * k, now);
  }
}

function stepProjectiles(room, now, dt) {
  if (!room.projs.length) return;
  const keep = [];
  for (const P of room.projs) {
    const pr = P.w.proj;
    const nvy = P.vy - pr.gravity * dt;
    const dx = P.vx * dt, dy = nvy * dt, dz = P.vz * dt;
    const len = Math.hypot(dx, dy, dz);
    let tHit = len + 1, direct = null, hitBox = null, ground = false;
    let ux = 0, uy = 0, uz = 0;
    if (len > 0) {
      ux = dx / len; uy = dy / len; uz = dz / len;
      const m = rayMap(room.map, P.x, P.y, P.z, ux, uy, uz, len);
      if (m.box) { tHit = m.t; hitBox = m.box; }
      if (uy < 0 && P.y + dy <= 0) { // sol
        const tg = Math.max(0, -P.y / uy);
        if (tg < tHit) { tHit = tg; hitBox = null; ground = true; }
      }
      if (pr.pierce) { // orbe : traverse les ennemis en leur infligeant des dégâts une fois chacun
        const seg = Math.min(len, tHit);
        for (const q of room.players.values()) {
          if (q === P.owner || !q.alive || now < q.protectUntil) continue;
          if (room.cfg.teams && q.team === P.owner.team) continue;
          if (P.hit && P.hit.has(q.id)) continue;
          const cx = q.x - P.x, cy = q.y + 0.9 - P.y, cz = q.z - P.z;
          const t = clamp(cx * ux + cy * uy + cz * uz, 0, seg);
          if (Math.hypot(cx - ux * t, cy - uy * t, cz - uz * t) <= pr.pierce) {
            (P.hit = P.hit || new Set()).add(q.id);
            applyDamage(room, P.owner, q, pr.passDmg, false, P.wi, now);
          }
        }
      }
      if (!pr.bounce && !pr.pierce) { // les grenades à main rebondissent sur tout (joueurs compris) : seules les roquettes touchent de plein fouet
        for (const q of room.players.values()) {
          if (!q.alive || now < q.protectUntil) continue;
          if (q === P.owner && now - P.born < 150) continue;   // ne pas se toucher soi-même au départ
          const tb = rayAABB(P.x, P.y, P.z, ux, uy, uz, q.x - 0.35, q.y, q.z - 0.35, q.x + 0.35, q.y + 1.85, q.z + 0.35, Math.min(tHit, len));
          if (tb >= 0 && tb < tHit) { tHit = tb; direct = q; }
        }
      }
    }
    if (tHit <= len && !pr.bounce) {
      // on recule un peu pour ne pas exploser "dans" le mur (sinon l'explosion se croit à couvert)
      const back = Math.min(tHit, 0.2);
      explode(room, P, { x: P.x + ux * (tHit - back), y: Math.max(0.1, P.y + uy * (tHit - back)), z: P.z + uz * (tHit - back) }, now, direct);
      continue;
    }
    if (now - P.born > pr.life * 1000) { explode(room, P, { x: P.x, y: Math.max(0.1, P.y), z: P.z }, now); continue; }
    if (tHit <= len) { // grenade à main : rebond
      const tt = Math.max(0, tHit - 0.02);
      P.x += ux * tt; P.y += uy * tt; P.z += uz * tt;
      if (ground) P.y = Math.max(P.y, 0.06);
      const n = ground ? { nx: 0, ny: 1, nz: 0 } : hitNormal(hitBox, P.x + ux * 0.02, P.y + uy * 0.02, P.z + uz * 0.02);
      let vx = P.vx, vy = nvy, vz = P.vz;
      const vn = vx * n.nx + vy * n.ny + vz * n.nz;
      if (vn < 0) { const k = (1 + pr.bounce) * vn; vx -= k * n.nx; vy -= k * n.ny; vz -= k * n.nz; }
      vx *= 0.9; vz *= 0.9;
      if (ground && Math.abs(vn) < 1.2) { // au repos : elle roule en ralentissant
        vy = 0; vx *= 0.7; vz *= 0.7;
        if (!P.rest) { P.rest = true; broadcast(room, { t: 'pbounce', id: P.id, o: [r2(P.x), r2(P.y), r2(P.z)], v: [r2(vx), 0, r2(vz)] }); }
      } else {
        P.rest = false;
        broadcast(room, { t: 'pbounce', id: P.id, o: [r2(P.x), r2(P.y), r2(P.z)], v: [r2(vx), r2(vy), r2(vz)] });
      }
      P.vx = vx; P.vy = vy; P.vz = vz;
      keep.push(P);
      continue;
    }
    P.x += dx; P.y += dy; P.z += dz; P.vy = nvy;
    if (P.rest) { P.vx *= 0.94; P.vz *= 0.94; }
    keep.push(P);
  }
  room.projs = keep;
}

// ---- avion en papier : le pilote le dirige (message « pc »), le serveur le simule et gère les contacts ----
function firePlane(room, p, o, d) {
  if (room.planes.has(p.id)) return;
  const yaw = Math.atan2(-d[0], -d[2]), pitch = Math.asin(clamp(d[1], -1, 1));
  const pl = { owner: p, x: o[0] + d[0] * 0.8, y: o[1] + d[1] * 0.8, z: o[2] + d[2] * 0.8, yaw, pitch, wantYaw: yaw, wantPitch: pitch, born: Date.now() };
  room.planes.set(p.id, pl);
  send(p, { t: 'planeOn', x: r2(pl.x), y: r2(pl.y), z: r2(pl.z), yaw: r2(yaw), pitch: r2(pitch) });
}

function endPlane(room, id, why) {
  const pl = room.planes.get(id);
  if (!pl) return;
  room.planes.delete(id);
  broadcast(room, { t: 'planeOff', id, why, x: r2(pl.x), y: r2(pl.y), z: r2(pl.z) });
}

function stepPlanes(room, now, dt) {
  if (!room.planes.size) return;
  for (const [id, pl] of [...room.planes]) {
    const owner = pl.owner;
    if (!owner.alive || !room.players.has(id) || room.state === 'ended') { endPlane(room, id, 'death'); continue; }
    const ox = pl.x, oy = pl.y, oz = pl.z;
    stepPlane(pl, dt, pl.wantYaw, pl.wantPitch);
    const dx = pl.x - ox, dy = pl.y - oy, dz = pl.z - oz, len = Math.hypot(dx, dy, dz);
    if (len > 0) {
      const m = rayMap(room.map, ox, oy, oz, dx / len, dy / len, dz / len, len + PLANE.radius * 0.5);
      if (m.box) { endPlane(room, id, 'wall'); continue; }
    }
    if (pl.y <= 0.05) { endPlane(room, id, 'ground'); continue; }
    if (now - pl.born > PLANE.life * 1000) { endPlane(room, id, 'time'); continue; }
    // contact : tête = mort, corps = 60
    let hit = null;
    for (const q of room.players.values()) {
      if (q === owner || !q.alive || now < q.protectUntil) continue;
      if (room.cfg.teams && q.team === owner.team) continue;
      const r = PLANE.radius;
      if (Math.abs(pl.x - q.x) < BODY_HALF + r && Math.abs(pl.z - q.z) < BODY_HALF + r && pl.y > q.y - r && pl.y < q.y + HEAD_TOP + r) { hit = q; break; }
    }
    if (hit) {
      const head = pl.y >= hit.y + BODY_TOP - 0.05;
      endPlane(room, id, 'hit');
      applyDamage(room, owner, hit, head ? PLANE.head : PLANE.body, head, W.PLANE, now);
      continue;
    }
    broadcast(room, { t: 'plane', id, x: r2(pl.x), y: r2(pl.y), z: r2(pl.z), yaw: r2(pl.yaw), pitch: r2(pl.pitch) });
  }
}

// ================================================================ SURVIE ====
const sendCash = (p) => send(p, { t: 'cash', n: p.cash, up: p.up, owned: p.owned });

function liveMobs(room) {
  let n = 0;
  for (const p of room.players.values()) if (p.mob && p.alive) n++;
  return n;
}

function survMsg(room) {
  const S = room.surv;
  return { t: 'surv', wave: S.wave, phase: S.phase, left: S.queue.length + liveMobs(room), until: S.until };
}

// Fait apparaître un monstre à l'un des 3 points les plus éloignés des joueurs
function spawnMob(room, key, now) {
  const S = room.surv, def = MOBS[key], pw = mobPower(S.wave, room.diff);
  const humans = [...room.players.values()].filter((q) => !q.bot && q.alive);
  const list = room.map.mobSpawns || room.map.spawns;
  const scored = list.map((s) => ({ s, d: Math.min(999, ...humans.map((h) => Math.hypot(h.x - s.x, h.z - s.z))) })).sort((a, b) => b.d - a.d).slice(0, 3);
  const at = scored[(Math.random() * scored.length) | 0].s;
  const id = nextPlayerId++;
  const p = newPlayer(room, id, null, def.name, 'red');
  p.bot = true;
  p.mob = { type: key, dmg: pw.dmg, reward: def.reward + Math.floor(S.wave * 0.5), scale: def.scale, color: def.color };
  p.mst = newMobState(def);
  p.maxHp = Math.max(1, Math.round(def.hp * pw.hp)); p.hp = p.maxHp;
  p.speedMul = def.speed * pw.speed * MOB_SPEED;
  p.scale = def.scale;
  p.weapon = def.weapon ?? KNIFE; p.loadout = [p.weapon];
  p.x = at.x + (Math.random() - 0.5) * 3; p.z = at.z + (Math.random() - 0.5) * 3; p.y = 0;
  p.yaw = Math.random() * Math.PI * 2;
  p.alive = true; p.protectUntil = now + 300; p.hist = [];
  room.players.set(id, p);
  broadcast(room, { t: 'pjoin', p: publicPlayer(p) });
}

// Coup au corps à corps d'un monstre (le délai entre deux coups est réglé par le monstre)
function mobMelee(room, m, t, now) {
  const def = MOBS[m.mob.type];
  if (now < m.nextAtk || now < t.protectUntil) return;
  m.nextAtk = now + def.melee.cd;
  broadcast(room, { t: 'shot', id: m.id, w: KNIFE, o: [r2(m.x), r2(m.y + 1.2), r2(m.z)], e: [[r2(t.x), r2(t.y + 1.0), r2(t.z)]] });
  applyDamage(room, m, t, def.melee.dmg, false, KNIFE, now);
}

// Champ de flux : distance de chaque case au joueur vivant le plus proche (recalculé quand ils bougent)
function ensureFlow(room, now, humans) {
  const alive = humans.filter((h) => h.alive);
  if (!alive.length) { room.flow = null; return; }
  const key = alive.map((h) => `${Math.round(h.x / 2)},${Math.round(h.z / 2)}`).join('|');
  if (!room.flow || (now - room.flowAt > 800 && key !== room.flowKey) || now - room.flowAt > 3000) {
    room.flow = computeFlow(room.map, alive);
    room.flowAt = now; room.flowKey = key;
  }
}

function stepSurvival(room, now) {
  const S = room.surv;
  if (!S) return;
  for (const p of [...room.players.values()]) if (p.mob && !p.alive) dropPlayer(room, p);   // les monstres morts disparaissent
  if (room.state === 'ended') return;
  const humans = [...room.players.values()].filter((p) => !p.bot && !p.away);
  if (!humans.length) return;
  const live = liveMobs(room);
  if (S.phase === 'prep') {
    if (now >= S.until) {                              // début de manche
      S.wave++; S.phase = 'fight';
      S.queue = waveList(S.wave, humans.length);
      S.nextSpawn = now + 1200;
      broadcast(room, survMsg(room));
    }
  } else {
    if (S.queue.length && live < SURV.MAX_MOBS && now >= S.nextSpawn) {
      spawnMob(room, S.queue.shift(), now);
      S.nextSpawn = now + Math.max(250, 900 - S.wave * 25);
    }
    if (!S.queue.length && live === 0) {               // manche gagnée : prime, soins, retour des joueurs à terre
      const bonus = SURV.WAVE_BONUS + 20 * S.wave;
      for (const h of humans) {
        h.cash += bonus; sendCash(h);
        if (!h.alive) spawnPlayer(room, h, now); else h.hp = h.maxHp;
      }
      S.phase = 'prep'; S.until = now + SURV_T.prep;
      broadcast(room, { t: 'wave', n: S.wave, bonus });
      broadcast(room, survMsg(room));
    } else if (humans.every((h) => !h.alive)) {        // tous à terre : fin de partie
      room.state = 'ended'; room.winner = null; room.endAt = now + SURV_T.over;
      broadcast(room, { t: 'state', s: 'ended', win: null, until: room.endAt, stats: statsMsg(room), wave: S.wave });
      broadcast(room, survMsg(room));
    }
  }
  if (now - S.lastSent > 500) { S.lastSent = now; broadcast(room, survMsg(room)); }
  if (live) ensureFlow(room, now, humans);
}

// Achat à la boutique (survie) : arme, soins, grenades ou amélioration
function handleBuy(p, m) {
  const room = p.room;
  if (room.mode !== 'survival' || room.state === 'ended' || p.mob) return;
  const it = shopItem(String(m.id));
  if (!it) return;
  const fail = (why) => send(p, { t: 'buyfail', id: it.id, why });
  const price = shopPrice(it, p.up);
  if (p.cash < price) return fail('cash');
  if (it.kind === 'weapon') {
    if (p.owned.includes(it.w) || p.loadout.includes(it.w)) return fail('owned');
    if (p.loadout.length >= 9) return fail('full');
    p.owned.push(it.w); p.loadout.push(it.w);
    send(p, { t: 'loadout', loadout: p.loadout });
  } else if (it.kind === 'heal') {
    if (!p.alive || p.hp >= p.maxHp) return fail('full');
    p.hp = p.maxHp;
  } else if (it.kind === 'nades') {
    if (p.nades >= NADE_MAX) return fail('full');
    p.nades = NADE_MAX; p.nadeRegenAt = 0;
    send(p, { t: 'nades', n: p.nades });
  } else if (it.kind === 'up') {
    if ((p.up[it.stat] || 0) >= it.max) return fail('max');
    p.up[it.stat]++;
    if (it.stat === 'hp') { p.maxHp += 25; if (p.alive) p.hp += 25; }
    else if (it.stat === 'spd') p.speedMul = 1 + 0.06 * p.up.spd;
    else p.dmgMul = 1 + 0.15 * p.up.dmg;
    send(p, { t: 'stats', maxHp: p.maxHp, speed: p.speedMul });
  } else if (it.kind === 'mystery') {
    if (p.loadout.length >= 9) return fail('full');
    const wi = Math.random() < MYSTERY_RARE_CHANCE ? MYSTERY_RARE : MYSTERY_POOL[(Math.random() * MYSTERY_POOL.length) | 0];
    if (!p.owned.includes(wi)) p.owned.push(wi);
    if (!p.loadout.includes(wi)) p.loadout.push(wi);
    send(p, { t: 'loadout', loadout: p.loadout });
    send(p, { t: 'mystery', w: wi, rare: wi === MYSTERY_RARE });
  }
  p.cash -= price;
  sendCash(p);
  send(p, { t: 'bought', id: it.id });
}

// ---- grenade à main (touche G) : lancée dans la direction visée, rebondit, explose après 2,4 s ----
function handleNade(p, m, now) {
  const room = p.room;
  if (!p.alive || room.state === 'ended' || room.mode === 'gun' || now < p.stunUntil) return;
  if (p.nades <= 0 || now < p.nadeReady) return;
  let dx = +m.dx, dy = +m.dy, dz = +m.dz;
  if (!Number.isFinite(dx + dy + dz)) return;
  const dl = Math.hypot(dx, dy, dz);
  if (dl < 0.5) return;
  dx /= dl; dy /= dl; dz /= dl;
  const o = [p.x, p.y + EYE_HEIGHT, p.z];
  p.nades--;
  p.nadeReady = now + 800;
  if (!p.nadeRegenAt) p.nadeRegenAt = now + NADE_REGEN_MS;
  p.protectUntil = 0;
  fireProjectile(room, p, WEAPONS[W.FRAG], W.FRAG, o, [dx, dy, dz], now);
  if (!p.bot) send(p, { t: 'nades', n: p.nades });
}

// ---- épée (Excalibur) : touche tous les ennemis dans un arc devant soi ----
function fireSweep(room, p, w, wi, o, d, targets, now) {
  const hit = [];
  for (const tg of targets) {
    const c = [tg.x, tg.y + 0.9, tg.z];
    const v = [c[0] - o[0], c[1] - o[1], c[2] - o[2]];
    const dist = Math.hypot(v[0], v[1], v[2]);
    if (dist > w.range + 0.4 || dist < 0.01) continue;
    if ((v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dist < w.cone) continue;
    if (!clearLine(room.map, o, c)) continue;
    hit.push(tg.q);
  }
  broadcast(room, { t: 'shot', id: p.id, w: wi, o: [r2(o[0]), r2(o[1]), r2(o[2])], e: [[r2(o[0] + d[0] * w.range), r2(o[1] + d[1] * w.range), r2(o[2] + d[2] * w.range)]] }, p);
  for (const q of hit) {
    applyDamage(room, p, q, w.dmg, false, wi, now);
    if (!q.alive) p.hp = Math.min(p.maxHp, p.hp + (w.heal || 0)); // chaque frag à l'épée soigne
  }
}

// ---- grappin : attire l'ennemi touché vers soi ; sur un mur, c'est nous qui sommes attirés ----
function fireGrapple(room, p, w, wi, o, d, targets, now) {
  const wall = rayMap(room.map, o[0], o[1], o[2], d[0], d[1], d[2], w.range);
  const pl = rayPlayers(targets, o[0], o[1], o[2], d[0], d[1], d[2], wall.t, 0.15);
  let end;
  if (pl) {
    end = [o[0] + d[0] * pl.t, o[1] + d[1] * pl.t, o[2] + d[2] * pl.t];
    applyDamage(room, p, pl.tg.q, w.dmg, pl.head, wi, now);
    if (pl.tg.q.alive) pullPlayer(pl.tg.q, { x: p.x + d[0] * 1.2, y: p.y, z: p.z + d[2] * 1.2 }, w.pull, now);
  } else {
    end = [o[0] + d[0] * wall.t, o[1] + d[1] * wall.t, o[2] + d[2] * wall.t];
    if (wall.box) {
      const n = hitNormal(wall.box, end[0], end[1], end[2]);
      pullPlayer(p, { x: end[0] + n.nx * 0.8, y: Math.max(0, end[1] - 1.4 + n.ny * 0.8), z: end[2] + n.nz * 0.8 }, w.pull, now, end);
    }
  }
  broadcast(room, { t: 'shot', id: p.id, w: wi, o: [r2(o[0]), r2(o[1]), r2(o[2])], e: [end.map(r2)] }, p);
}

// ---- pistolet portail : pose un portail (bleu ou orange) sur un mur, sur le sol, ou sur le dessus / dessous d'une boîte ----
const PORTAL_W = 1.0, PORTAL_H = 2.0, PORTAL_S = 1.4;   // mur : 1 x 2 m ; sol et plafond : carré de 1,4 m
function firePortal(room, p, w, m, o, d) {
  const which = m.alt ? 1 : 0;
  const wall = rayMap(room.map, o[0], o[1], o[2], d[0], d[1], d[2], w.range);
  let floorT = Infinity;                                 // le sol (y = 0) n'est pas une boîte : intersection du plan
  if (d[1] < -0.001) { const t = -o[1] / d[1]; if (t > 0 && t <= w.range) floorT = t; }
  const wallT = wall.box ? wall.t : Infinity;
  let portal = null;
  if (floorT < wallT) {
    const lim = room.map.half - PORTAL_S / 2;
    portal = { x: clamp(o[0] + d[0] * floorT, -lim, lim), y: 0.03, z: clamp(o[2] + d[2] * floorT, -lim, lim), nx: 0, ny: 1, nz: 0 };
  } else if (wall.box) {
    const b = wall.box;
    const px = o[0] + d[0] * wall.t, py = o[1] + d[1] * wall.t, pz = o[2] + d[2] * wall.t;
    const n = hitNormal(b, px, py, pz);
    if (n.ny !== 0) {                                    // dessus (n.ny = 1) ou dessous (-1) d'une boîte
      const h = PORTAL_S / 2;
      if (b.x1 - b.x0 < PORTAL_S + 0.05 || b.z1 - b.z0 < PORTAL_S + 0.05) return;   // surface trop petite
      portal = { x: clamp(px, b.x0 + h, b.x1 - h), y: n.ny > 0 ? b.y1 + 0.03 : b.y0 - 0.03, z: clamp(pz, b.z0 + h, b.z1 - h), nx: 0, ny: n.ny, nz: 0 };
    } else {
      const alongX = n.nz !== 0;                         // face ±Z : le portail s'étend selon X
      const lo = alongX ? b.x0 : b.z0, hi = alongX ? b.x1 : b.z1;
      if (hi - lo < PORTAL_W + 0.05 || b.y1 - b.y0 < PORTAL_H + 0.05) return; // la face est trop petite
      const along = clamp(alongX ? px : pz, lo + PORTAL_W / 2, hi - PORTAL_W / 2);
      const cy = clamp(py, b.y0 + PORTAL_H / 2, b.y1 - PORTAL_H / 2);
      portal = alongX
        ? { x: along, y: cy, z: (n.nz > 0 ? b.z1 : b.z0) + n.nz * 0.03, nx: 0, ny: 0, nz: n.nz }
        : { x: (n.nx > 0 ? b.x1 : b.x0) + n.nx * 0.03, y: cy, z: along, nx: n.nx, ny: 0, nz: 0 };
    }
  } else return;
  const pair = room.portals.get(p.id) || [null, null];
  pair[which] = portal;
  room.portals.set(p.id, pair);
  broadcast(room, { t: 'portal', o: p.id, i: which, x: r2(portal.x), y: r2(portal.y), z: r2(portal.z), nx: portal.nx, ny: portal.ny, nz: portal.nz });
}

// ---- laser (arme de série) : rayon continu jusqu'au premier mur ; la cible touchée est étourdie ----
function fireBeam(room, p, w, wi, o, d, targets, now) {
  const wall = rayMap(room.map, o[0], o[1], o[2], d[0], d[1], d[2], w.range);
  const hit = rayPlayers(targets, o[0], o[1], o[2], d[0], d[1], d[2], wall.t, 0.12);
  const t = hit ? hit.t : wall.t;
  broadcast(room, { t: 'shot', id: p.id, w: wi, o: [r2(o[0]), r2(o[1]), r2(o[2])], e: [[r2(o[0] + d[0] * t), r2(o[1] + d[1] * t), r2(o[2] + d[2] * t)]] }, p);
  if (!hit) return;
  applyDamage(room, p, hit.tg.q, w.dmg, false, wi, now);
  stun(hit.tg.q, w.stun, now);
}

// ---- coup ultime d'Excalibur : onde qui traverse tout (murs compris), énormes dégâts, recharge très longue ----
function fireWave(room, p, w, wi, o, d, targets, now) {
  const a = w.alt;
  if (now < (p.altUntil[wi] || 0)) return;
  p.altUntil[wi] = now + a.cooldown;
  broadcast(room, { t: 'wave', id: p.id, w: wi, o: [r2(o[0]), r2(o[1]), r2(o[2])], d: d.map((v) => r2(v)), len: a.range });
  for (const tg of targets) {
    const v = [tg.x - o[0], tg.y + 0.9 - o[1], tg.z - o[2]];
    const t = v[0] * d[0] + v[1] * d[1] + v[2] * d[2];
    if (t < -0.5 || t > a.range) continue;
    const perp = Math.hypot(v[0] - d[0] * t, v[1] - d[1] * t, v[2] - d[2] * t);
    if (perp > a.width) continue;
    applyDamage(room, p, tg.q, a.dmg, false, wi, now);
    if (!tg.q.alive) p.hp = Math.min(p.maxHp, p.hp + (w.heal || 0));
  }
}

// ---- missile nucléaire (série de 15) : compte à rebours, puis tous les autres meurent et un gaz toxique reste ----
function fireNuke(room, p, w, now) {
  if (room.nuke) return;
  room.nuke = { owner: p, at: now + w.delay };
  broadcast(room, { t: 'nuke', id: p.id, ms: w.delay });
}

function detonateNuke(room, now) {
  const owner = room.nuke.owner;
  room.nuke = null;
  broadcast(room, { t: 'nukeboom', id: owner.id });
  room.nukeKilling = true; // la victoire éventuelle n'est vérifiée qu'une fois tout le monde touché
  for (const q of [...room.players.values()]) {
    if (q === owner || !q.alive) continue;
    q.protectUntil = 0;
    const friendly = room.cfg.teams && q.team === owner.team;
    applyDamage(room, friendly ? q : owner, q, 1e6, false, W.NUKE, now); // coéquipier : mort sans frag
  }
  room.nukeKilling = false;
  checkWin(room, owner, now);
  room.gas = { owner, until: now + NUKE_GAS_MS };
  broadcast(room, { t: 'gas', owner: owner.id, ms: NUKE_GAS_MS });
}

// Gaz toxique : tout le monde sauf le lanceur (masque à gaz) perd des PV chaque tick
function stepGas(room, now, dt) {
  const g = room.gas;
  if (!g) return;
  if (now >= g.until || room.state === 'ended') { room.gas = null; broadcast(room, { t: 'gas', off: 1 }); return; }
  for (const q of room.players.values()) {
    if (!q.alive || q === g.owner) continue;
    q.hp -= NUKE_GAS_DPS * dt;
    q.lastDamage = now;
    if (q.hp <= 0) { q.hp = 0.01; applyDamage(room, g.owner, q, 1, false, W.NUKE, now); }
  }
}

// Série de kills : débloque une arme (touches 6, 7, 8), à un seul chargeur
function awardStreak(room, p) {
  if (p.bot || room.mode === 'gun' || room.mode === 'survival') return;
  const i = STREAKS.indexOf(p.streak);
  if (i < 0) return;
  const wi = STREAK_WEAPONS[i];
  if (!p.loadout.includes(wi)) p.loadout.push(wi);
  p.streakAmmo[wi] = WEAPONS[wi].mag;
  send(p, { t: 'streak', n: p.streak, w: wi, loadout: p.loadout });
  broadcast(room, { t: 'streakall', id: p.id, n: p.streak });
}

function handleFire(p, m, now) {
  const room = p.room;
  // humains : la graine est imposée par le serveur (compteur incrémenté à chaque message « fire », comme côté client)
  const seed = p.bot ? m.seed | 0 : shotSeed(p.sn, p.shotN++);
  if (!p.alive || room.state === 'ended') return;
  const wi = m.w | 0;
  const w = WEAPONS[wi];
  if (!w || !p.loadout.includes(wi)) return; // seules les armes de sa classe (ou de son niveau en Gun Game)
  if (now < p.stunUntil) return;              // étourdi : ne peut pas tirer
  if (w.streak !== undefined && !(p.streakAmmo[wi] > 0)) return;
  if (w.charge) { // canon à orbe : le tir n'est accepté qu'après la charge complète (le client la commence par un message « charge »)
    if (!p.chargeAt || now - p.chargeAt < w.charge - 300) return;
    p.chargeAt = 0;
    broadcast(room, { t: 'charge', id: p.id, on: 0 }, p);
  }

  // Cadence de tir (avec une tolérance pour la gigue réseau)
  if (now + 100 < p.nextFire) return;
  p.nextFire = Math.max(p.nextFire, now - 60) + w.interval;
  p.protectUntil = 0; // tirer annule la protection d'apparition
  if (countsAcc(wi)) p.st.shots++;
  if (w.streak !== undefined && --p.streakAmmo[wi] <= 0) { // un seul chargeur : arme retirée une fois vide
    p.loadout = p.loadout.filter((i) => i !== wi);
    if (p.weapon === wi) p.weapon = p.loadout[0];
    send(p, { t: 'loadout', loadout: p.loadout });
  }

  let dx = +m.dx, dy = +m.dy, dz = +m.dz;
  if (!Number.isFinite(dx + dy + dz)) return;
  const dl = Math.hypot(dx, dy, dz);
  if (dl < 0.5) return;
  dx /= dl; dy /= dl; dz /= dl;

  let ox = +m.ox, oy = +m.oy, oz = +m.oz;
  const ex = p.x, ey = p.y + EYE_HEIGHT, ez = p.z;
  // L'origine envoyée doit rester proche des yeux ET visible depuis eux : sinon, collé à un mur, un client modifié
  // pouvait placer l'origine jusqu'à 3 m plus loin, de l'autre côté du mur, et tirer à travers.
  if (!Number.isFinite(ox + oy + oz) || Math.hypot(ox - ex, oy - ey, oz - ez) > 3 || !clearLine(room.map, [ex, ey, ez], [ox, oy, oz])) { ox = ex; oy = ey; oz = ez; }

  const rng = mulberry32(seed);
  // même règle que le client (game.js) : lunette > visée (ADS) > hanche. Avant, le serveur ignorait l'ADS :
  // le client affichait un tir précis (0.004) mais le serveur calculait la dispersion de la hanche (0.014) => touches fantômes.
  const spread = w.scopeSpread !== undefined && m.sc ? w.scopeSpread
    : w.ads && m.ad && w.ads.spread !== undefined ? w.ads.spread : w.spread;
  const maxD = w.melee ? w.range : MAX_RAY;
  const rewindT = clamp(Number.isFinite(+m.rt) ? +m.rt : now, now - REWIND_MAX_MS, now);
  const pad = w.melee ? 0.25 : 0;

  // Cibles au moment (rembobiné) où le tireur a vu l'écran
  const targets = [];
  for (const q of room.players.values()) {
    if (q === p || !q.alive || now < q.protectUntil) continue;
    if (room.cfg.teams && q.team === p.team) continue;
    targets.push({ q, ...sampleHist(q, rewindT) });
  }

  const o = [ox, oy, oz], dir = [dx, dy, dz];
  if (m.alt && w.alt) return fireWave(room, p, w, wi, o, dir, targets, now);
  switch (w.kind) {
    case 'rocket': return fireProjectile(room, p, w, wi, o, applySpread(dx, dy, dz, spread, rng), now);
    case 'sweep': case 'flame': return fireSweep(room, p, w, wi, o, dir, targets, now);
    case 'grapple': return fireGrapple(room, p, w, wi, o, dir, targets, now);
    case 'portal': return firePortal(room, p, w, m, o, dir);
    case 'beam': return fireBeam(room, p, w, wi, o, dir, targets, now);
    case 'nuke': return fireNuke(room, p, w, now);
    case 'orb': return fireProjectile(room, p, w, wi, o, dir, now);
    case 'plane': return firePlane(room, p, o, dir);
    default: break;
  }

  // Tir instantané (fusil d'assaut, pompe, sniper, revolver, couteau, minigun)
  const hits = new Map(); // id -> { q, dmg, head, backstab }
  const ends = [];
  for (let i = 0; i < w.pellets; i++) {
    const [px, py, pz] = applySpread(dx, dy, dz, spread, rng);
    const wall = rayMap(room.map, ox, oy, oz, px, py, pz, maxD);
    const best = rayPlayers(targets, ox, oy, oz, px, py, pz, wall.t, pad);
    const dist = best ? best.t : wall.t;
    ends.push([r2(ox + px * dist), r2(oy + py * dist), r2(oz + pz * dist)]);
    if (best) {
      let dmg = w.dmg * (best.head ? w.headMul : 1) * falloff(w, best.t);
      let backstab = false;
      if (w.melee) {
        // dans le dos ? (les deux regardent dans le même sens)
        const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
        const vx = -Math.sin(best.tg.yaw), vz = -Math.cos(best.tg.yaw);
        if (fx * vx + fz * vz > 0.35) { dmg = w.backstab; backstab = true; }
      }
      const h = hits.get(best.tg.q.id) || { q: best.tg.q, dmg: 0, head: false, backstab: false };
      h.dmg += dmg;
      h.head = h.head || best.head;
      h.backstab = h.backstab || backstab;
      hits.set(h.q.id, h);
    }
  }

  // Visuel du tir pour les autres joueurs
  broadcast(room, { t: 'shot', id: p.id, w: wi, o: [r2(ox), r2(oy), r2(oz)], e: ends }, p);

  for (const h of hits.values()) applyDamage(room, p, h.q, h.dmg, h.head, wi, now);
}

function applyDamage(room, atk, vic, amount, head, wi, now) {
  if (!vic.alive || room.state === 'ended') return;
  const suicide = atk === vic;
  if (!suicide) amount *= atk.mob ? atk.mob.dmg : atk.dmgMul || 1;   // survie : force des monstres, amélioration de dégâts des joueurs
  if (!suicide) {
    const real = Math.min(amount, Math.max(0, vic.hp));
    atk.st.dmg += real;
    if (countsAcc(wi)) atk.st.hits++;
    if (head) atk.st.head++;
    if (vic.bot && vic.ai) vic.ai.alert = { x: atk.x, z: atk.z, until: now + 6000 }; // un bot touché va voir d'où ça vient
  }
  vic.hp -= amount;
  vic.lastDamage = now;
  const dead = vic.hp <= 0;
  if (!suicide) send(atk, { t: 'hit', v: vic.id, d: Math.round(amount), h: head ? 1 : 0, k: dead ? 1 : 0 });
  if (!dead) {
    send(vic, { t: 'dmg', a: atk.id, hp: Math.ceil(vic.hp), x: r2(atk.x), z: r2(atk.z) });
    return;
  }
  vic.hp = 0; vic.alive = false; vic.d++; vic.streak = 0;
  vic.chargeAt = 0;
  endPlane(room, vic.id, 'death');
  vic.respawnAt = room.mode === 'survival' ? 0 : now + RESPAWN;   // survie : on revient à la manche suivante
  if (suicide) { // mort par sa propre explosion : pas de frag
    broadcast(room, { t: 'kill', a: atk.id, v: vic.id, w: wi, h: 0 });
    broadcast(room, scoreMsg(room));
    return;
  }
  atk.k++; atk.streak++;
  if (room.mode === 'survival' && vic.mob && !atk.mob) { atk.cash += vic.mob.reward; sendCash(atk); }
  atk.st.bestStreak = Math.max(atk.st.bestStreak, atk.streak);
  atk.st.byWeapon[wi] = (atk.st.byWeapon[wi] || 0) + 1;
  if (room.cfg.teams) room.teamKills[atk.team]++;
  if (room.mode === 'gun') {
    // un frag avec l'arme du niveau (ou au couteau) fait monter d'un niveau ; un frag au couteau fait aussi descendre la victime
    if (wi === GUN_ORDER[shownLevel(atk)] || wi === KNIFE) atk.level++;
    if (wi === KNIFE && vic.level > 0) vic.level--;
    if (atk.level < GUN_ORDER.length) { atk.weapon = GUN_ORDER[atk.level]; atk.loadout = [atk.weapon, KNIFE]; }
  }
  broadcast(room, { t: 'kill', a: atk.id, v: vic.id, w: wi, h: head ? 1 : 0 });
  broadcast(room, scoreMsg(room));
  awardStreak(room, atk);
  if (!room.nukeKilling) checkWin(room, atk, now);
}

function checkWin(room, lastKiller, now) {
  if (room.mode === 'survival') return;   // sandbox sans fin
  const limit = room.killLimit;
  let winner = null;
  if (room.cfg.teams) {
    if (room.teamKills.red >= limit) winner = { team: 'red' };
    else if (room.teamKills.blue >= limit) winner = { team: 'blue' };
  } else if (room.mode === 'gun') {
    if (lastKiller.level >= GUN_ORDER.length) winner = { id: lastKiller.id };
  } else if (lastKiller.k >= limit) {
    winner = { id: lastKiller.id };
  }
  if (!winner) return;
  room.state = 'ended';
  room.winner = winner;
  room.endAt = now + END_SCREEN_MS;
  broadcast(room, { t: 'state', s: 'ended', win: winner, until: room.endAt, stats: statsMsg(room) });
}

// ---------------------------------------------------------------- Messages ----

function handleMessage(ws, raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return; }
  if (!m || typeof m.t !== 'string') return;
  const now = Date.now();

  if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', c: m.c, s: now }));

  if (m.t === 'join') {
    if (ws.player) return;
    const mode = typeof m.mode === 'string' && Object.hasOwn(MODES, m.mode) ? m.mode : 'ffa';
    const token = typeof m.token === 'string' ? m.token.slice(0, 64) : '';
    const ghost = token ? tokens.get(token) : null;
    let room, p, returning = false;
    if (ghost && rooms.get(ghost.room.id) === ghost.room && ghost.room.mode === mode) {
      // reconnexion (le jeton prouve que c'est le même client, même si l'ancienne connexion semble encore ouverte) :
      // le joueur reprend sa place avec son score, son équipe et son niveau
      room = ghost.room; p = ghost; returning = true;
      const old = p.ws;
      if (old && old !== ws) { old.player = null; try { old.terminate(); } catch { /* déjà fermée */ } }
      p.ws = ws; ws.player = p; p.away = false; p.graceUntil = 0;
    } else {
      if (ghost) removePlayer(ghost); // ancien joueur avec ce jeton dans un autre salon : on le retire
      // navigateur de salons : rejoindre un salon précis par son identifiant (même mode, pas plein, pas privé)
      const picked = typeof m.rid === 'string' ? rooms.get(m.rid.slice(0, 40)) : null;
      room = picked && picked.mode === mode && !picked.private && humanCount(picked) < picked.cfg.max ? picked : findRoom(mode, cleanRoom(m.room), parseOpts(m));
      if (!room) return ws.send(JSON.stringify({ t: 'error', msg: rooms.size >= MAX_ROOMS ? 'Serveur plein, réessaie dans un moment.' : 'Ce salon est complet.' }));
      p = addPlayer(room, ws, m.name);
      p.cls = resolveClass(m.cls, m.loadout);
      if (token) { p.token = token; tokens.set(token, p); }
    }
    p.sn = randomInt(0, 2 ** 31); p.shotN = 0;   // graines de tir : le serveur les impose (voir shotSeed)
    send(p, {
      t: 'welcome', id: p.id, ts: now, team: p.team, sn: p.sn,
      room: { id: room.id, name: room.name, mode: room.mode, limit: room.killLimit, diff: room.diff, fill: room.fill, map: room.map.id },
      players: [...room.players.values()].map(publicPlayer),
      state: room.state, win: room.winner, until: room.endAt,
      teamKills: room.teamKills, back: returning,
      surv: room.surv ? survMsg(room) : null,
      gas: room.gas ? { owner: room.gas.owner.id, ms: Math.max(0, room.gas.until - now) } : null,
      portals: [...room.portals].flatMap(([o, pair]) => pair.map((q, i) => q && { o, i, x: q.x, y: q.y, z: q.z, nx: q.nx, ny: q.ny, nz: q.nz }).filter(Boolean)),
    });
    if (room.mode === 'survival') sendCash(p);
    if (returning) {
      spawnPlayer(room, p, now);
      broadcast(room, scoreMsg(room));
      return;
    }
    broadcast(room, { t: 'pjoin', p: publicPlayer(p) }, p);
    // bots ajoutés/retirés ; en duel le match (re)démarre quand il y a deux joueurs
    if (!afterRosterChange(room)) {
      spawnPlayer(room, p, now);
      broadcast(room, scoreMsg(room));
    }
    return;
  }

  const p = ws.player;
  if (!p) return;

  if (m.t === 'class') { // changement de classe : pris en compte à la prochaine apparition
    p.pending = resolveClass(m.cls, m.loadout);
    send(p, { t: 'classok', name: p.pending.name });
    return;
  }

  if (m.t === 'leave') { // départ volontaire : pas de délai de grâce
    p.leaving = true;
    ws.player = null;
    removePlayer(p);
    return;
  }

  if (m.t === 'in') {
    if (!p.alive || now < p.stunUntil) return;
    const x = +m.x, y = +m.y, z = +m.z;
    if (!Number.isFinite(x + y + z)) return;
    const half = p.room.map.half;
    const nx = clamp(x, -half, half), nz = clamp(z, -half, half);
    if (checkMove(p, nx, nz, now)) { p.x = nx; p.z = nz; p.y = clamp(y, -5, 20); }
    else if (now - (p.lastFix || 0) > 250) { p.lastFix = now; send(p, { t: 'fix', x: r2(p.x), y: r2(p.y), z: r2(p.z) }); }   // recalage (au plus 4 fois/s)
    p.yaw = Number.isFinite(+m.yaw) ? +m.yaw : p.yaw;
    p.pitch = clamp(Number.isFinite(+m.pitch) ? +m.pitch : p.pitch, -1.6, 1.6);
    p.crouch = !!m.c;
    const wi = m.w | 0;
    if (p.loadout.includes(wi)) {
      if (wi !== p.weapon && p.chargeAt) { p.chargeAt = 0; broadcast(p.room, { t: 'charge', id: p.id, on: 0 }, p); }
      p.weapon = wi;
    }
  } else if (m.t === 'fire') {
    handleFire(p, m, now);
  } else if (m.t === 'slide') {          // glissade annoncée : courte fenêtre de vitesse (au plus une par seconde)
    if (!p.alive || now < (p.slideReady || 0)) return;
    p.slideReady = now + SLIDE_EVERY_MS;
    moveBoost(p, now, 900, WALK_SPEED * SPRINT_MUL * (p.speedMul || 1) * 0.15);   // petit bonus : la glissade décélère vite, le plafond normal suffit presque
  } else if (m.t === 'nade') {
    handleNade(p, m, now);
  } else if (m.t === 'buy') {
    handleBuy(p, m);
  } else if (m.t === 'charge') { // début / annulation de la charge du canon à orbe
    if (p.alive && WEAPONS[p.weapon]?.charge && !(m.on && now < p.stunUntil)) {
      p.chargeAt = m.on ? now : 0;
      broadcast(p.room, { t: 'charge', id: p.id, on: m.on ? 1 : 0 }, p);
    }
  } else if (m.t === 'pc') { // pilotage de l'avion en papier : cap voulu
    const pl = p.room.planes.get(p.id);
    if (pl && Number.isFinite(+m.yaw) && Number.isFinite(+m.pitch)) { pl.wantYaw = +m.yaw; pl.wantPitch = clamp(+m.pitch, -1, 1); }
  } else if (m.t === 'pcancel') {
    endPlane(p.room, p.id, 'cancel');
  }
}

// ---------------------------------------------------------------- Boucle ----

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const late = Math.max(0, now - lastTick - TICK_MS);
  lastTick = now;
  tickStats.late += (late - tickStats.late) * 0.02;
  tickStats.lateMax = Math.max(late, tickStats.lateMax * 0.995);
  for (const room of [...rooms.values()]) {
    try {
      tickRoom(room, now);
    } catch (e) {
      // une erreur dans un salon ne doit pas bloquer les autres : on log et on ferme ce salon proprement
      console.error(`[tick ${room.id}]`, e?.stack || e);
      rooms.delete(room.id);
      for (const p of room.players.values()) {
        if (p.token && tokens.get(p.token) === p) tokens.delete(p.token);
        if (p.ws) { p.ws.player = null; try { p.ws.send(JSON.stringify({ t: 'error', msg: 'Erreur serveur : salon fermé.' })); p.ws.close(); } catch { /* déjà fermée */ } }
      }
    }
  }
  const work = Date.now() - now;
  tickStats.work += (work - tickStats.work) * 0.02;
  tickStats.workMax = Math.max(work, tickStats.workMax * 0.995);
}, TICK_MS);

function tickRoom(room, now) {
  // fin de manche -> nouvelle manche
  if (room.state === 'ended' && now >= room.endAt) resetMatch(room);

  const snap = [];
  const expired = [];
  for (const p of room.players.values()) {
    if (p.away) { // déconnecté : invisible et intouchable, retiré après le délai de grâce
      if (now >= p.graceUntil) expired.push(p);
      snap.push([p.id, 0, 0, 0, 0, 0, 0, p.weapon, 0, 0]);
      continue;
    }
    if (!p.alive && p.respawnAt && now >= p.respawnAt && room.state !== 'ended') {
      p.respawnAt = 0;
      spawnPlayer(room, p, now);
    }
    if (p.bot && p.alive && room.state === 'playing' && now >= p.stunUntil) {
      const f = p.mob ? mobStep(room, p, now, TICK_MS / 1000) : botStep(room, p, now, TICK_MS / 1000);
      if (f) { if (f.melee) mobMelee(room, p, f.melee, now); else if (f.nade) handleNade(p, f, now); else handleFire(p, f, now); }
    }
    if (p.alive && p.nades < NADE_MAX && p.nadeRegenAt && now >= p.nadeRegenAt && room.mode !== 'gun') {
      p.nades++;
      p.nadeRegenAt = p.nades < NADE_MAX ? now + NADE_REGEN_MS : 0;
      if (!p.bot) send(p, { t: 'nades', n: p.nades });
    }
    if (p.alive) {
      if (p.hp < p.maxHp && now - p.lastDamage > REGEN_DELAY_MS) p.hp = Math.min(p.maxHp, p.hp + REGEN_PER_S * (TICK_MS / 1000));
      p.hist.push([now, p.x, p.y, p.z, p.yaw]);
      while (p.hist.length && now - p.hist[0][0] > 1000) p.hist.shift();
    }
    snap.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), Math.ceil(p.hp), p.weapon, p.alive && now < p.protectUntil ? 1 : 0, p.crouch ? 1 : 0]);
  }
  stepSurvival(room, now);
  stepProjectiles(room, now, TICK_MS / 1000);
  stepPlanes(room, now, TICK_MS / 1000);
  if (room.nuke && now >= room.nuke.at && room.state === 'playing') detonateNuke(room, now);
  stepGas(room, now, TICK_MS / 1000);
  broadcast(room, { t: 's', ts: now, p: snap });
  for (const p of expired) removePlayer(p);
}

// ---------------------------------------------------------------- WebSocket ----

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 2048 });

// Limites anti-abus : un seul script ne doit pas pouvoir remplir le serveur de salons pleins de bots
const MAX_CONN = Number(process.env.MAX_CONN) || 200;       // connexions simultanées au total
const MAX_PER_IP = Number(process.env.MAX_PER_IP) || 8;     // par adresse (une famille / un LAN reste OK)
const connsByIp = new Map();
// Derrière le proxy Hugging Face, l'adresse réelle est la première de X-Forwarded-For
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const n = connsByIp.get(ip) || 0;
  if (wss.clients.size > MAX_CONN || n >= MAX_PER_IP) { ws.close(1013, 'busy'); return; }
  connsByIp.set(ip, n + 1);
  ws.on('close', () => { const c = (connsByIp.get(ip) || 1) - 1; if (c > 0) connsByIp.set(ip, c); else connsByIp.delete(ip); });
  ws.isAlive = true;
  ws.msgCount = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    if (++ws.msgCount > 150) { // anti-flood : un client normal envoie ~35 msg/s
      if (ws.msgCount > 400) ws.terminate(); // flood manifeste : on coupe
      return;
    }
    try {
      handleMessage(ws, data.toString());
    } catch (e) {
      // un message malformé ne doit jamais faire tomber tout le serveur (et tous les salons avec)
      console.error('[message]', e?.stack || e);
    }
  });
  ws.on('close', () => {
    const p = ws.player;
    if (!p || p.ws !== ws) return; // ancienne connexion déjà remplacée par une reconnexion
    if (p.leaving || !p.token) return removePlayer(p);
    // coupure réseau / redémarrage : on garde la place quelques secondes pour permettre la reconnexion
    p.ws = null; p.away = true; p.graceUntil = Date.now() + GRACE_MS;
    p.alive = false; p.hp = 0; p.respawnAt = 0; p.hist = [];
  });
  ws.on('error', () => {});
});

setInterval(() => { for (const ws of wss.clients) ws.msgCount = 0; }, 1000);

// Coupe les connexions mortes (utile derrière le proxy de Hugging Face)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

httpServer.listen(PORT, () => console.log(`FPIXEL serveur prêt sur http://localhost:${PORT}`));
