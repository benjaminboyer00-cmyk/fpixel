// Serveur FPIXEL : WebSocket (salons + logique de jeu) + fichiers statiques du client.
// Tourne sur un Space Hugging Face (Docker, port 7860) ou en local : `npm run dev`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import {
  TICK_MS, REWIND_MAX_MS, MAX_RAY, EYE_HEIGHT, MAX_HP, RESPAWN_MS, SPAWN_PROTECT_MS,
  REGEN_DELAY_MS, REGEN_PER_S, END_SCREEN_MS, BODY_HALF, BODY_TOP, HEAD_HALF, HEAD_TOP,
  MODES, WEAPONS, GUN_ORDER, KNIFE,
} from '../web/shared/config.js';
import { BOXES, SPAWNS, HALF } from '../web/shared/map.js';
import { rayAABB, applySpread, mulberry32, clamp } from '../web/shared/util.js';
import { BOT_NAMES, newBotAI, botStep } from './bots.js';

const PORT = Number(process.env.PORT) || 7860;
// surcharges pour les tests
const RESPAWN = Number(process.env.RESPAWN_MS) || RESPAWN_MS;
const PROTECT = Number(process.env.PROTECT_MS) || SPAWN_PROTECT_MS;
const GRACE_MS = Number(process.env.GRACE_MS) || 20000; // temps laissé à un joueur déconnecté pour revenir
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

const httpServer = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { pathname = '/'; }

  if (pathname === '/health' || pathname === '/api/rooms') return sendJson(res, lobbyInfo());

  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(WEB_ROOT, pathname));
  if (!file.startsWith(WEB_ROOT + path.sep)) { res.writeHead(403); return res.end('403'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

// ---------------------------------------------------------------- Salons ----

const rooms = new Map(); // id -> room
const tokens = new Map(); // jeton de reconnexion -> joueur
let nextPlayerId = 1;
let nextAutoRoom = 1;

function lobbyInfo() {
  const modes = {};
  for (const m of Object.keys(MODES)) modes[m] = { players: 0, max: MODES[m].max, rooms: [] };
  let online = 0;
  for (const r of rooms.values()) {
    const n = humanCount(r);
    modes[r.mode].players += n;
    modes[r.mode].rooms.push({ id: r.name, n, max: r.cfg.max, bots: r.fill, diff: r.diff });
    online += n;
  }
  return { ok: true, online, modes };
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
  };
}
const optsKey = (o) => `${o.bots}|${o.diff}|${o.limit}`;

// La capacité ne compte que les humains : les bots cèdent leur place.
// Les salons automatiques sont partagés seulement entre joueurs qui ont choisi les mêmes options.
function findRoom(mode, name, opts) {
  const cfg = MODES[mode];
  if (name) {
    const id = `${mode}:${name}`;
    let room = rooms.get(id);
    if (!room) room = createRoom(id, mode, name, opts);
    return humanCount(room) >= cfg.max ? null : room;
  }
  const key = optsKey(opts);
  for (const r of rooms.values()) {
    if (r.mode === mode && r.auto && r.optsKey === key && humanCount(r) < cfg.max) return r;
  }
  const n = nextAutoRoom++;
  const room = createRoom(`${mode}#${n}`, mode, `salon ${n}`, opts);
  room.auto = true;
  return room;
}

function createRoom(id, mode, name, opts) {
  const cfg = MODES[mode];
  const room = {
    id, mode, name, cfg, auto: false,
    fill: opts.bots === 0 ? 0 : opts.bots === 1 ? cfg.fill : Math.min(opts.bots, cfg.max), // joueurs visés (humains + bots)
    diff: opts.diff, optsKey: optsKey(opts),
    killLimit: mode === 'gun' ? GUN_ORDER.length : opts.limit || Number(process.env.KILL_LIMIT) || cfg.killLimit,
    players: new Map(),
    state: mode === 'duel' ? 'waiting' : 'playing', // waiting (duel seul) | playing | ended
    teamKills: { red: 0, blue: 0 },
    endAt: 0, winner: null,
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
    respawnAt: 0, protectUntil: 0, lastDamage: 0, nextFire: 0,
    hist: [],
  };
}

function addPlayer(room, ws, name) {
  const id = nextPlayerId++;
  const p = newPlayer(room, id, ws, cleanName(name, id), pickTeam(room));
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
  return { id: p.id, name: p.name, team: p.team, k: p.k, d: p.d, hp: p.hp, w: p.weapon, bot: !!p.bot, lvl: shownLevel(p) };
}

const shownLevel = (p) => Math.min(p.level, GUN_ORDER.length - 1);

function scoreMsg(room) {
  return {
    t: 'score',
    p: [...room.players.values()].map((p) => [p.id, p.k, p.d, shownLevel(p)]),
    team: room.teamKills,
  };
}

function pickSpawn(room, p) {
  const others = [...room.players.values()].filter((q) => q !== p && q.alive);
  const enemies = others.filter((q) => !room.cfg.teams || q.team !== p.team);
  let pool = SPAWNS.filter((s) => (room.cfg.teams ? s.team === p.team : true));
  if (!pool.length) pool = SPAWNS;
  const scored = pool.map((s) => {
    let dmin = 1e9;
    for (const q of enemies) dmin = Math.min(dmin, Math.hypot(q.x - s.x, q.z - s.z));
    // jamais sur quelqu'un (coéquipier compris) : sinon les joueurs apparaissent empilés
    const taken = others.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 2.5);
    return { s, dmin: dmin + Math.random() * 6 - (taken ? 1000 : 0) }; // un peu d'aléatoire pour ne pas être prévisible
  });
  scored.sort((a, b) => b.dmin - a.dmin);
  return scored[0].s;
}

function spawnPlayer(room, p, now = Date.now()) {
  const s = pickSpawn(room, p);
  p.x = s.x; p.y = 0; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
  p.vx = p.vy = p.vz = 0; p.onGround = true;
  p.hp = MAX_HP; p.alive = true;
  p.protectUntil = now + PROTECT;
  if (room.mode === 'gun') p.weapon = GUN_ORDER[shownLevel(p)]; // en Gun Game l'arme dépend du niveau
  p.lastDamage = 0; p.nextFire = 0;
  p.hist = [];
  send(p, { t: 'spawn', x: s.x, y: 0, z: s.z, yaw: s.yaw, hp: MAX_HP });
}

function resetMatch(room) {
  room.teamKills = { red: 0, blue: 0 };
  room.winner = null;
  room.state = room.cfg.id === 'duel' && room.players.size < 2 ? 'waiting' : 'playing';
  for (const p of room.players.values()) { p.k = 0; p.d = 0; p.level = 0; }
  broadcast(room, { t: 'state', s: room.state, win: null });
  broadcast(room, scoreMsg(room));
  const now = Date.now();
  for (const p of room.players.values()) if (!p.away) spawnPlayer(room, p, now);
}

function removePlayer(p) {
  const room = p.room;
  if (p.token && tokens.get(p.token) === p) tokens.delete(p.token);
  if (!room || !room.players.delete(p.id)) return;
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

function handleFire(p, m, now) {
  const room = p.room;
  if (!p.alive || room.state === 'ended') return;
  const wi = m.w | 0;
  const w = WEAPONS[wi];
  if (!w) return;
  if (room.mode === 'gun' && wi !== GUN_ORDER[shownLevel(p)] && wi !== KNIFE) return; // Gun Game : arme du niveau, ou couteau

  // Cadence de tir (avec une tolérance pour la gigue réseau)
  if (now + 100 < p.nextFire) return;
  p.nextFire = Math.max(p.nextFire, now - 60) + w.interval;
  p.protectUntil = 0; // tirer annule la protection d'apparition

  let dx = +m.dx, dy = +m.dy, dz = +m.dz;
  if (!Number.isFinite(dx + dy + dz)) return;
  const dl = Math.hypot(dx, dy, dz);
  if (dl < 0.5) return;
  dx /= dl; dy /= dl; dz /= dl;

  let ox = +m.ox, oy = +m.oy, oz = +m.oz;
  const ex = p.x, ey = p.y + EYE_HEIGHT, ez = p.z;
  if (!Number.isFinite(ox + oy + oz) || Math.hypot(ox - ex, oy - ey, oz - ez) > 3) { ox = ex; oy = ey; oz = ez; }

  const rng = mulberry32(m.seed | 0);
  const spread = w.scopeSpread !== undefined && m.sc ? w.scopeSpread : w.spread;
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

  const hits = new Map(); // id -> { q, dmg, head, backstab }
  const ends = [];
  for (let i = 0; i < w.pellets; i++) {
    const [px, py, pz] = applySpread(dx, dy, dz, spread, rng);
    let tMap = maxD;
    for (const b of BOXES) {
      const t = rayAABB(ox, oy, oz, px, py, pz, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, tMap);
      if (t >= 0 && t < tMap) tMap = t;
    }
    let best = null;
    for (const tg of targets) {
      const tb = rayAABB(ox, oy, oz, px, py, pz,
        tg.x - BODY_HALF - pad, tg.y, tg.z - BODY_HALF - pad, tg.x + BODY_HALF + pad, tg.y + BODY_TOP, tg.z + BODY_HALF + pad, tMap);
      const th = rayAABB(ox, oy, oz, px, py, pz,
        tg.x - HEAD_HALF - pad, tg.y + BODY_TOP, tg.z - HEAD_HALF - pad, tg.x + HEAD_HALF + pad, tg.y + HEAD_TOP, tg.z + HEAD_HALF + pad, tMap);
      let t = -1, head = false;
      if (th >= 0 && (tb < 0 || th <= tb)) { t = th; head = true; } else if (tb >= 0) t = tb;
      if (t >= 0 && t < tMap && (!best || t < best.t)) best = { tg, t, head };
    }
    const dist = best ? best.t : tMap;
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
  vic.hp -= amount;
  vic.lastDamage = now;
  const dead = vic.hp <= 0;
  send(atk, { t: 'hit', v: vic.id, d: Math.round(amount), h: head ? 1 : 0, k: dead ? 1 : 0 });
  if (!dead) {
    send(vic, { t: 'dmg', a: atk.id, hp: Math.ceil(vic.hp), x: r2(atk.x), z: r2(atk.z) });
    return;
  }
  vic.hp = 0; vic.alive = false; vic.d++;
  vic.respawnAt = now + RESPAWN;
  atk.k++;
  if (room.cfg.teams) room.teamKills[atk.team]++;
  if (room.mode === 'gun') {
    // un frag avec l'arme du niveau (ou au couteau) fait monter d'un niveau ; un frag au couteau fait aussi descendre la victime
    if (wi === GUN_ORDER[shownLevel(atk)] || wi === KNIFE) atk.level++;
    if (wi === KNIFE && vic.level > 0) vic.level--;
    if (atk.level < GUN_ORDER.length) atk.weapon = GUN_ORDER[atk.level];
  }
  broadcast(room, { t: 'kill', a: atk.id, v: vic.id, w: wi, h: head ? 1 : 0 });
  broadcast(room, scoreMsg(room));
  checkWin(room, atk, now);
}

function checkWin(room, lastKiller, now) {
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
  broadcast(room, { t: 'state', s: 'ended', win: winner, until: room.endAt });
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
    const mode = MODES[m.mode] ? m.mode : 'ffa';
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
      room = findRoom(mode, cleanRoom(m.room), parseOpts(m));
      if (!room) return ws.send(JSON.stringify({ t: 'error', msg: 'Ce salon est complet.' }));
      p = addPlayer(room, ws, m.name);
      if (token) { p.token = token; tokens.set(token, p); }
    }
    send(p, {
      t: 'welcome', id: p.id, ts: now, team: p.team,
      room: { id: room.id, name: room.name, mode: room.mode, limit: room.killLimit, diff: room.diff, fill: room.fill },
      players: [...room.players.values()].map(publicPlayer),
      state: room.state, win: room.winner, until: room.endAt,
      teamKills: room.teamKills, back: returning,
    });
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

  if (m.t === 'leave') { // départ volontaire : pas de délai de grâce
    p.leaving = true;
    ws.player = null;
    removePlayer(p);
    return;
  }

  if (m.t === 'in') {
    if (!p.alive) return;
    const x = +m.x, y = +m.y, z = +m.z;
    if (!Number.isFinite(x + y + z)) return;
    p.x = clamp(x, -HALF, HALF); p.z = clamp(z, -HALF, HALF); p.y = clamp(y, -5, 20);
    p.yaw = Number.isFinite(+m.yaw) ? +m.yaw : p.yaw;
    p.pitch = clamp(Number.isFinite(+m.pitch) ? +m.pitch : p.pitch, -1.6, 1.6);
    const wi = m.w | 0;
    if (WEAPONS[wi] && !(p.room.mode === 'gun' && wi !== GUN_ORDER[shownLevel(p)] && wi !== KNIFE)) p.weapon = wi;
  } else if (m.t === 'fire') {
    handleFire(p, m, now);
  }
}

// ---------------------------------------------------------------- Boucle ----

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    // fin de manche -> nouvelle manche
    if (room.state === 'ended' && now >= room.endAt) resetMatch(room);

    const snap = [];
    const expired = [];
    for (const p of room.players.values()) {
      if (p.away) { // déconnecté : invisible et intouchable, retiré après le délai de grâce
        if (now >= p.graceUntil) expired.push(p);
        snap.push([p.id, 0, 0, 0, 0, 0, 0, p.weapon, 0]);
        continue;
      }
      if (!p.alive && p.respawnAt && now >= p.respawnAt && room.state !== 'ended') {
        p.respawnAt = 0;
        spawnPlayer(room, p, now);
      }
      if (p.bot && p.alive && room.state === 'playing') {
        const f = botStep(room, p, now, TICK_MS / 1000);
        if (f) handleFire(p, f, now);
      }
      if (p.alive) {
        if (p.hp < MAX_HP && now - p.lastDamage > REGEN_DELAY_MS) p.hp = Math.min(MAX_HP, p.hp + REGEN_PER_S * (TICK_MS / 1000));
        p.hist.push([now, p.x, p.y, p.z, p.yaw]);
        while (p.hist.length && now - p.hist[0][0] > 1000) p.hist.shift();
      }
      snap.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), Math.ceil(p.hp), p.weapon, p.alive && now < p.protectUntil ? 1 : 0]);
    }
    broadcast(room, { t: 's', ts: now, p: snap });
    for (const p of expired) removePlayer(p);
  }
}, TICK_MS);

// ---------------------------------------------------------------- WebSocket ----

const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.msgCount = 0;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (data) => {
    if (++ws.msgCount > 150) return; // anti-flood : un client normal envoie ~35 msg/s
    handleMessage(ws, data.toString());
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
