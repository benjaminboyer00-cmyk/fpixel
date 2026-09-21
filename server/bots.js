// IA des bots : ils utilisent exactement le même joueur, la même physique et le même tir que les humains
// (le tir passe par handleFire côté serveur : mêmes dégâts, mêmes murs, mêmes plombs).
//
// Comportements : patrouille et poursuite par pathfinding (A* sur une grille de la carte), réaction aux dégâts
// (ils vont voir d'où ça vient), mémoire de la dernière position vue, choix de l'arme selon la distance,
// fuite quand la vie est basse, grenades. La difficulté règle la précision et l'intelligence (voir DIFFS).
import { stepPlayer } from '../web/js/physics.js';
import { rayAABB, lookDir, clamp } from '../web/shared/util.js';
import { EYE_HEIGHT, WALK_SPEED, WEAPONS, PLAYER_RADIUS, PLAYER_HEIGHT, GUN_ORDER, CLASSES, W } from '../web/shared/config.js';

export const BOT_NAMES = ['Léo', 'Maya', 'Nico', 'Zoé', 'Enzo', 'Lina', 'Hugo', 'Jade', 'Noah', 'Emma', 'Tom', 'Chloé'];

// Profil de combat par arme : distance préférée, portée maximale, distance minimale (roquettes : jamais à bout portant).
// Les armes absentes (grappin, portail, armes de série...) ne sont jamais utilisées par les bots.
const PROFILE = {
  [W.AR]: { pref: 14, range: 60 },
  [W.SHOTGUN]: { pref: 5, range: 15 },
  [W.SNIPER]: { pref: 32, range: 100 },
  [W.REVOLVER]: { pref: 10, range: 45 },
  [W.KNIFE]: { pref: 1.8, range: 2.2 },
  [W.ROCKET]: { pref: 17, range: 55, minD: 5, feet: true },
  [W.EXCALIBUR]: { pref: 2.4, range: 3.0 },
  [W.MINIGUN]: { pref: 12, range: 42 },
  [W.GRENADE]: { pref: 14, range: 32, minD: 6, lob: true },
  [W.CARBINE]: { pref: 24, range: 80 },
};

// Classes jouées selon la difficulté (les bots faciles restent en classique)
const BOT_CLASSES = { easy: ['classic'], normal: ['classic', 'assault', 'sniper', 'heavy', 'knight', 'scout'], hard: Object.keys(CLASSES) };
export function botClass(diff) {
  const l = BOT_CLASSES[diff] || BOT_CLASSES.normal;
  return CLASSES[l[(Math.random() * l.length) | 0]];
}

// Réglages par difficulté. err = imprécision de visée (rad), turn = vitesse de rotation (rad/s),
// react = temps de réaction (ms), head = chance de viser la tête, pause = pause entre rafales (ms),
// hunt = durée (ms) pendant laquelle il poursuit la dernière position vue, alert = va voir d'où viennent les tirs,
// nades = chance de lancer une grenade à chaque balayage, flee = fuit sous cette fraction de vie.
export const DIFFS = {
  easy:   { skill: [0.25, 0.4], react: [1400, 2000], err: [0.2, 0.26],   turn: [0.9, 1.3], head: 0,    pause: [1200, 2500], sight: 30, speed: 0.55, tol: 0.16, burst: [1, 2], hunt: 0,    alert: false, nades: 0,    flee: 0 },
  normal: { skill: [0.65, 1.0], react: [350, 600],  err: null,           turn: null,       head: 0.3,  pause: [300, 800],  sight: 70, speed: 0.85, tol: 0.09,             hunt: 4000, alert: true,  nades: 0.03, flee: 0.25 },
  hard:   { skill: [0.9, 1.0],  react: [150, 300],  err: [0.012, 0.02],  turn: [7, 8.5],   head: 0.55, pause: [150, 400],  sight: 95, speed: 0.95, tol: 0.06,             hunt: 8000, alert: true,  nades: 0.08, flee: 0.35 },
};

export function newBotAI(diff = 'normal') {
  const D = DIFFS[diff] || DIFFS.normal;
  const r = (a, b) => a + Math.random() * (b - a);
  const skill = r(D.skill[0], D.skill[1]);
  return {
    diff, D, skill,
    reaction: r(D.react[0], D.react[1]),
    err: D.err ? r(D.err[0], D.err[1]) : 0.06 - 0.035 * skill,
    maxTurn: D.turn ? r(D.turn[0], D.turn[1]) : 2.5 + 3 * skill,
    headChance: diff === 'normal' ? D.head * skill : D.head,
    pauseRange: D.pause, burstRange: D.burst || [3, 7], sight: D.sight, speedMul: D.speed, tol: D.tol,
    target: null, seenAt: 0, nextScan: 0,
    lastPos: { x: 0, z: 0 }, lastCheck: 0,
    strafe: 1, strafeUntil: 0, aimHead: false, burstLeft: D.burst ? D.burst[1] : 4, pause: 0,
    // navigation et mémoire
    path: null, pi: 0, pathGoal: null, pathAt: 0, pathWait: 0,
    roam: null, roamUntil: 0,
    lastSeen: null, lastSeenAt: 0, alert: null,
    fleeUntil: -1e9, fleeGoal: null, switchAt: 0, nadeAt: 0, wantNade: false,
  };
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ------------------------------------------------------------------ navigation ----
// Grille de cases de 0,5 m : « praticable » = un joueur (rayon + marge) n'y touche aucune boîte de sa hauteur.
// Calculée une fois par carte ; A* + lissage du chemin.
const CELL = 0.5;
const grids = new Map();

function gridFor(map) {
  let g = grids.get(map.id);
  if (g) return g;
  const n = Math.round((map.half * 2) / CELL), o = -map.half + CELL / 2;
  const walk = new Uint8Array(n * n).fill(1);
  const m = PLAYER_RADIUS + 0.12;
  for (const b of map.boxes) {
    if (b.y0 >= PLAYER_HEIGHT || b.y1 <= 0.6) continue;              // trop haut (linteau, plafond) ou franchissable
    const i0 = Math.max(0, Math.floor((b.x0 - m - o) / CELL) + 1), i1 = Math.min(n - 1, Math.ceil((b.x1 + m - o) / CELL) - 1);
    const j0 = Math.max(0, Math.floor((b.z0 - m - o) / CELL) + 1), j1 = Math.min(n - 1, Math.ceil((b.z1 + m - o) / CELL) - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) walk[i + j * n] = 0;
  }
  g = { n, o, walk, main: new Uint8Array(n * n), roam: [], gs: new Float32Array(n * n), stamp: new Uint32Array(n * n), closed: new Uint32Array(n * n), came: new Int32Array(n * n), tick: 0 };
  // zone principale : tout ce qui est relié à la première apparition (on n'envoie pas un bot dans une case fermée)
  const cell = (v) => clamp(Math.round((v - o) / CELL), 0, n - 1);
  const sp = map.spawns[0];
  const start = snap(g, cell(sp.x), cell(sp.z), 12, false);
  if (start >= 0) {
    const stack = [start];
    g.main[start] = 1;
    while (stack.length) {
      const c = stack.pop(), ci = c % n, cj = (c / n) | 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + a, nj = cj + b;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const k = ni + nj * n;
        if (walk[k] && !g.main[k]) { g.main[k] = 1; stack.push(k); }
      }
    }
  }
  // points de patrouille : un peu partout (4 m), à distance des murs
  for (let j = 4; j < n; j += 8) {
    for (let i = 4; i < n; i += 8) {
      const k = i + j * n;
      if (!g.main[k]) continue;
      let ok = true;
      for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1; di++) if (!walk[i + di + (j + dj) * n]) { ok = false; break; }
      if (ok) g.roam.push({ x: o + i * CELL, z: o + j * CELL });
    }
  }
  grids.set(map.id, g);
  return g;
}

// Case praticable de la zone principale la plus proche (recherche en carré croissant)
function snap(g, ci, cj, maxR = 8, needMain = true) {
  const { n, walk, main } = g;
  const ok = (i, j) => i >= 0 && j >= 0 && i < n && j < n && walk[i + j * n] && (!needMain || main[i + j * n]);
  for (let r = 0; r <= maxR; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (ok(ci + di, cj + dj)) return ci + di + (cj + dj) * n;
      }
    }
  }
  return -1;
}

// File de priorité binaire (petit tas) pour A*
class Heap {
  constructor() { this.f = []; this.v = []; }
  get size() { return this.v.length; }
  push(f, v) {
    const F = this.f, V = this.v;
    let i = V.length;
    F.push(f); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [F[p], F[i]] = [F[i], F[p]]; [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop() {
    const F = this.f, V = this.v, top = V[0], lf = F.pop(), lv = V.pop();
    if (V.length) {
      F[0] = lf; V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < V.length && F[l] < F[m]) m = l;
        if (r < V.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [F[m], F[i]] = [F[i], F[m]]; [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return top;
  }
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

function lineClear(g, ax, az, bx, bz) {
  const { n, o, walk } = g;
  const d = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.ceil(d / 0.25));
  for (let k = 0; k <= steps; k++) {
    const x = ax + ((bx - ax) * k) / steps, z = az + ((bz - az) * k) / steps;
    const i = Math.round((x - o) / CELL), j = Math.round((z - o) / CELL);
    if (i < 0 || j < 0 || i >= n || j >= n || !walk[i + j * n]) return false;
  }
  return true;
}

// Chemin (liste de points monde) de (sx,sz) à (tx,tz), ou null s'il n'y en a pas
export function findPath(map, sx, sz, tx, tz) {
  const g = gridFor(map), { n, o, walk } = g;
  const cell = (v) => clamp(Math.round((v - o) / CELL), 0, n - 1);
  const s = snap(g, cell(sx), cell(sz)), t = snap(g, cell(tx), cell(tz));
  if (s < 0 || t < 0) return null;
  if (s === t) return [{ x: tx, z: tz }];
  const stamp = ++g.tick;
  const ti = t % n, tj = (t / n) | 0;
  const h = (i, j) => { const a = Math.abs(i - ti), b = Math.abs(j - tj); return Math.max(a, b) + 0.414 * Math.min(a, b); };
  const heap = new Heap();
  g.gs[s] = 0; g.stamp[s] = stamp; g.came[s] = -1;
  heap.push(h(s % n, (s / n) | 0), s);
  let found = false, expanded = 0;
  while (heap.size) {
    const cur = heap.pop();
    if (g.closed[cur] === stamp) continue;
    g.closed[cur] = stamp;
    if (cur === t) { found = true; break; }
    if (++expanded > 40000) break;
    const ci = cur % n, cj = (cur / n) | 0;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DX[k], nj = cj + DY[k];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = ni + nj * n;
      if (!walk[nk]) continue;
      if (k >= 4 && (!walk[ni + cj * n] || !walk[ci + nj * n])) continue;   // pas de passage en biais entre deux obstacles
      const ng = g.gs[cur] + (k >= 4 ? 1.414 : 1);
      if (g.stamp[nk] !== stamp || ng < g.gs[nk]) {
        g.stamp[nk] = stamp; g.gs[nk] = ng; g.came[nk] = cur;
        heap.push(ng + h(ni, nj), nk);
      }
    }
  }
  if (!found) return null;
  const pts = [];
  for (let c = t; c >= 0; c = g.came[c]) pts.push({ x: o + (c % n) * CELL, z: o + ((c / n) | 0) * CELL });
  pts.reverse();
  // lissage : on saute directement au point le plus lointain visible en ligne droite
  const out = [];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !lineClear(g, pts[a].x, pts[a].z, pts[b].x, pts[b].z)) b--;
    out.push(pts[b]);
    a = b;
  }
  if (!out.length) out.push(pts[pts.length - 1]);
  return out;
}

// ---- champ de flux (survie) : une seule recherche par salle donne, pour chaque case, la distance jusqu'au joueur humain le plus proche ;
// chaque monstre n'a plus qu'à descendre la pente (pas de chemin à calculer par monstre) ----
export function computeFlow(map, sources) {
  const g = gridFor(map), { n, o, walk } = g;
  const dist = new Float32Array(n * n).fill(Infinity);
  const heap = new Heap();
  const cell = (v) => clamp(Math.round((v - o) / CELL), 0, n - 1);
  for (const s of sources) {
    const k = snap(g, cell(s.x), cell(s.z), 6);
    if (k >= 0 && dist[k] !== 0) { dist[k] = 0; heap.push(0, k); }
  }
  while (heap.size) {
    const cur = heap.pop();
    const dc = dist[cur];
    const ci = cur % n, cj = (cur / n) | 0;
    for (let k = 0; k < 8; k++) {
      const ni = ci + DX[k], nj = cj + DY[k];
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const nk = ni + nj * n;
      if (!walk[nk]) continue;
      if (k >= 4 && (!walk[ni + cj * n] || !walk[ci + nj * n])) continue;
      const nd = dc + (k >= 4 ? 1.414 : 1);
      if (nd < dist[nk]) { dist[nk] = nd; heap.push(nd, nk); }
    }
  }
  return { dist, n, o };
}

// Direction (monde, normalisée) qui rapproche de la source la plus proche, ou null si on y est / si rien n'est joignable
export function flowDir(map, flow, x, z) {
  if (!flow) return null;
  const g = gridFor(map), { n, o, walk } = g, { dist } = flow;
  const cell = (v) => clamp(Math.round((v - o) / CELL), 0, n - 1);
  let c = cell(x) + cell(z) * n;
  if (!walk[c]) { c = snap(g, cell(x), cell(z), 3); if (c < 0) return null; }
  const ci = c % n, cj = (c / n) | 0;
  let best = -1, bd = dist[c];
  for (let k = 0; k < 8; k++) {
    const ni = ci + DX[k], nj = cj + DY[k];
    if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
    const nk = ni + nj * n;
    if (!walk[nk]) continue;
    if (k >= 4 && (!walk[ni + cj * n] || !walk[ci + nj * n])) continue;
    if (dist[nk] < bd) { bd = dist[nk]; best = nk; }
  }
  if (best < 0) return null;
  // on vise un peu plus loin que la case voisine : trajectoire plus lisse
  const bi = best % n, bj = (best / n) | 0;
  const tx = o + bi * CELL + (bi - ci) * CELL * 0.6, tz = o + bj * CELL + (bj - cj) * CELL * 0.6;
  const dx = tx - x, dz = tz - z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

// Direction (monde) vers le prochain point du chemin vers `goal`, recalculé si le but change
function pathDir(map, b, ai, goal, now) {
  const toGoal = () => {
    const dx = goal.x - b.x, dz = goal.z - b.z, l = Math.hypot(dx, dz);
    return l > 0.3 ? { x: dx / l, z: dz / l } : null;
  };
  const stale = !ai.path || !ai.pathGoal || Math.hypot(goal.x - ai.pathGoal.x, goal.z - ai.pathGoal.z) > 2.5 || now - ai.pathAt > 6000;
  if (stale && now >= ai.pathWait) {
    ai.path = findPath(map, b.x, b.z, goal.x, goal.z);
    ai.pathGoal = { x: goal.x, z: goal.z };
    ai.pi = 0; ai.pathAt = now;
    ai.pathWait = now + (ai.path ? 350 : 1500);
    if (!ai.path && goal === ai.roam) ai.roam = null;    // but inaccessible : on en choisit un autre
  }
  if (!ai.path) return toGoal();
  while (ai.pi < ai.path.length && Math.hypot(ai.path[ai.pi].x - b.x, ai.path[ai.pi].z - b.z) < 0.6) ai.pi++;
  if (ai.pi >= ai.path.length) { ai.path = null; return toGoal(); }
  const p = ai.path[ai.pi], dx = p.x - b.x, dz = p.z - b.z, l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
}

function randomRoam(map, b) {
  const g = gridFor(map);
  if (!g.roam.length) return null;
  for (let k = 0; k < 6; k++) {                       // on préfère un point assez loin
    const p = g.roam[(Math.random() * g.roam.length) | 0];
    if (Math.hypot(p.x - b.x, p.z - b.z) > 12) return p;
  }
  return g.roam[(Math.random() * g.roam.length) | 0];
}

// Point de repli : loin de la menace, dans la zone jouable
function fleePoint(map, b, threat) {
  const g = gridFor(map);
  let best = null, bs = -1;
  for (let k = 0; k < 14; k++) {
    const p = g.roam[(Math.random() * g.roam.length) | 0];
    if (!p) return null;
    const dT = Math.hypot(p.x - threat.x, p.z - threat.z), dB = Math.hypot(p.x - b.x, p.z - b.z);
    if (dB > 40) continue;
    const s = dT - dB * 0.5;
    if (s > bs) { bs = s; best = p; }
  }
  return best;
}

// ------------------------------------------------------------------ perception ----
export function canSee(b, t, sight, boxes) {
  const ex = b.x, ey = b.y + EYE_HEIGHT, ez = b.z;
  for (const ty of [t.y + 1.0, t.y + 1.6]) {
    const dx = t.x - ex, dy = ty - ey, dz = t.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > sight) return false;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    let blocked = false;
    for (const bx of boxes) {
      const h = rayAABB(ex, ey, ez, ux, uy, uz, bx.x0, bx.y0, bx.z0, bx.x1, bx.y1, bx.z1, d);
      if (h >= 0 && h < d - 0.3) { blocked = true; break; }
    }
    if (!blocked) return true;
  }
  return false;
}

function pickTarget(room, b, now) {
  let best = null, bestD = Infinity;
  for (const q of room.players.values()) {
    if (q === b || !q.alive || now < q.protectUntil) continue;
    if (room.cfg.teams && q.team === b.team) continue;
    const d = Math.hypot(q.x - b.x, q.z - b.z);
    if (d < bestD && canSee(b, q, b.ai.sight, room.map.boxes)) { best = q; bestD = d; }
  }
  return best;
}

// Meilleure arme de sa classe pour cette distance (avec un peu d'inertie pour ne pas changer sans arrêt)
function chooseWeapon(b, d, now) {
  const ai = b.ai;
  let best = -1, bs = -Infinity, fallback = -1, fr = 0;
  for (const wi of b.loadout) {
    const p = PROFILE[wi];
    if (!p) continue;
    if (p.range > fr) { fr = p.range; fallback = wi; }
    if (d > p.range || d < (p.minD || 0)) continue;
    const s = -Math.abs(Math.log(Math.max(d, 0.5) / p.pref)) + (wi === b.weapon ? 0.3 : 0);
    if (s > bs) { bs = s; best = wi; }
  }
  if (best < 0) best = fallback;
  if (best >= 0 && best !== b.weapon && now >= ai.switchAt) { b.weapon = best; ai.switchAt = now + 1200; }
}

function scan(room, b, now) {
  const ai = b.ai, D = ai.D;
  ai.nextScan = now + 200 + Math.random() * 150;
  const t = pickTarget(room, b, now);
  if (t && (!ai.target || ai.target.id !== t.id || !ai.target.alive)) {
    ai.seenAt = now;                                   // nouvelle cible : temps de réaction
    ai.aimHead = Math.random() < ai.headChance;
  }
  if (!t) ai.seenAt = 0;
  ai.target = t;
  if (room.mode === 'gun') {
    b.weapon = GUN_ORDER[Math.min(b.level, GUN_ORDER.length - 1)];   // en Gun Game l'arme dépend du niveau
    return;
  }
  if (t) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    chooseWeapon(b, d, now);
    if (D.nades && b.nades > 0 && now >= ai.nadeAt && d >= 7 && d <= 17 && Math.random() < D.nades) ai.wantNade = true;
  } else {
    const first = b.loadout.find((wi) => PROFILE[wi]);
    if (first !== undefined && now >= ai.switchAt) b.weapon = first;
  }
}

// ------------------------------------------------------------------ un tick ----
// Fait avancer le bot d'un tick. Retourne un message de tir (comme un client), un lancer de grenade { nade: true, ... } ou null.
export function botStep(room, b, now, dt) {
  const ai = b.ai, D = ai.D, map = room.map;
  if (b.pull) { // attiré par un grappin : on se laisse tirer vers le tireur
    const px = b.pull.x - b.x, pz = b.pull.z - b.z, pl = Math.hypot(px, pz);
    if (now < b.pull.until && pl > 1.6) {
      stepPlayer(b, dt / 2, px / pl, pz / pl, b.pull.speed, false, map);
      stepPlayer(b, dt / 2, px / pl, pz / pl, b.pull.speed, false, map);
      return null;
    }
    b.pull = null;
  }
  if (now >= ai.nextScan) scan(room, b, now);
  const t = ai.target && ai.target.alive ? ai.target : null;
  if (t) { ai.lastSeen = { x: t.x, z: t.z }; ai.lastSeenAt = now; }

  // vie basse : on rompt le combat un moment (une seule fois toutes les ~8 s)
  if (D.flee && t && now >= ai.fleeUntil + 4500 && b.hp < b.maxHp * D.flee) {
    ai.fleeGoal = fleePoint(map, b, t);
    if (ai.fleeGoal) { ai.fleeUntil = now + 3500; ai.path = null; ai.pathWait = 0; }
  }
  const fleeing = now < ai.fleeUntil && !!ai.fleeGoal;

  let mvx = 0, mvz = 0, jump = false, fire = null;
  let desYaw = b.yaw, desPitch = 0;
  const eyeY = b.y + EYE_HEIGHT;
  const maxTurn = ai.maxTurn; // rad/s
  const prof = PROFILE[b.weapon] || PROFILE[W.AR];
  let moving = false;

  if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    desYaw = Math.atan2(-dx, -dz);
    const w = WEAPONS[b.weapon];
    const aimY = prof.feet ? 0.25 : ai.aimHead ? 1.62 : 1.15;           // roquette : aux pieds (dégâts de zone)
    desPitch = Math.atan2(t.y + aimY - eyeY, Math.max(d, 0.1));
    if (prof.lob && w.proj) desPitch += 0.5 * Math.asin(clamp((w.proj.gravity * d) / (w.proj.speed * w.proj.speed), 0, 0.95));  // tir en cloche
    const ux = dx / (d || 1), uz = dz / (d || 1);
    if (fleeing) {
      const p = pathDir(map, b, ai, ai.fleeGoal, now);
      if (p) { mvx = p.x; mvz = p.z; } else { mvx = -ux; mvz = -uz; }
    } else {
      const fwd = d > prof.pref * 1.25 ? 1 : d < prof.pref * 0.6 ? -1 : 0;
      if (now >= ai.strafeUntil) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = now + 500 + Math.random() * 1100; }
      mvx = ux * fwd - uz * ai.strafe * 0.8;
      mvz = uz * fwd + ux * ai.strafe * 0.8;
    }
    moving = true;
    if (b.onGround && Math.random() < dt * 0.35) jump = true; // saute de temps en temps pour esquiver
  } else {
    // pas de cible : on va voir d'où on a été touché, sinon on poursuit la dernière position vue, sinon on patrouille
    let goal = null;
    if (D.alert && ai.alert && now < ai.alert.until) goal = ai.alert;
    else if (D.hunt && ai.lastSeenAt && now - ai.lastSeenAt < D.hunt) goal = ai.lastSeen;
    if (goal && Math.hypot(goal.x - b.x, goal.z - b.z) < 2) { if (goal === ai.alert) ai.alert = null; else ai.lastSeenAt = 0; goal = null; }
    if (!goal) {
      if (!ai.roam || Math.hypot(ai.roam.x - b.x, ai.roam.z - b.z) < 2 || now > ai.roamUntil) { ai.roam = randomRoam(map, b); ai.roamUntil = now + 20000; }
      goal = ai.roam;
    }
    if (goal) {
      const p = pathDir(map, b, ai, goal, now);
      if (p) { mvx = p.x; mvz = p.z; desYaw = Math.atan2(-p.x, -p.z); moving = true; }
    }
    ai.wantNade = false;
  }

  // coincé contre un obstacle ? on saute et on recalcule le chemin
  if (now - ai.lastCheck > 700) {
    if (moving && Math.hypot(b.x - ai.lastPos.x, b.z - ai.lastPos.z) < 0.35) {
      jump = b.onGround;
      ai.path = null; ai.pathWait = 0;
      if (!t) ai.roam = null;
    }
    ai.lastPos = { x: b.x, z: b.z };
    ai.lastCheck = now;
  }

  // rotation limitée : un bot ne se retourne pas instantanément
  b.yaw += clamp(angDiff(b.yaw, desYaw), -maxTurn * dt, maxTurn * dt);
  b.pitch = clamp(b.pitch + clamp(desPitch - b.pitch, -maxTurn * dt, maxTurn * dt), -1.2, 1.2);

  // déplacement (2 sous-pas pour ne pas traverser les murs fins) : la direction est en repère monde, le regard est indépendant
  let wx = mvx, wz = mvz;
  const l = Math.hypot(wx, wz);
  if (l > 1) { wx /= l; wz /= l; }
  const speed = WALK_SPEED * WEAPONS[b.weapon].speed * (b.speedMul || 1) * (t ? ai.speedMul : ai.speedMul * 0.8);
  stepPlayer(b, dt / 2, wx, wz, speed, jump, map);
  stepPlayer(b, dt / 2, wx, wz, speed, false, map);

  // grenade : lancée en cloche vers la cible
  if (t && ai.wantNade) {
    ai.wantNade = false;
    ai.nadeAt = now + 7000;
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    const th = 0.5 * Math.asin(clamp((18 * d) / (19 * 19), 0, 0.97));
    const yaw = Math.atan2(-dx, -dz);
    return { nade: true, dx: -Math.sin(yaw) * Math.cos(th), dy: Math.sin(th), dz: -Math.cos(yaw) * Math.cos(th) };
  }

  // tir : réaction écoulée, bien aligné, à portée
  if (t && now - ai.seenAt >= ai.reaction && now >= ai.pause) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    const tol = b.weapon === W.SNIPER || b.weapon === W.CARBINE ? ai.tol * 0.4 : ai.tol;
    if (Math.abs(angDiff(b.yaw, desYaw)) < tol && Math.abs(desPitch - b.pitch) < tol + 0.03 && d <= prof.range && d >= (prof.minD || 0) && now >= b.nextFire - 30) {
      const w = WEAPONS[b.weapon];
      const e = ai.err; // imprécision de visée
      const [ux, uy, uz] = lookDir(b.yaw + (Math.random() - 0.5) * 2 * e, b.pitch + (Math.random() - 0.5) * 2 * e);
      fire = {
        w: b.weapon, ox: b.x, oy: b.y + EYE_HEIGHT, oz: b.z, dx: ux, dy: uy, dz: uz,
        seed: (Math.random() * 2147483647) | 0, sc: w.zoom ? 1 : 0, rt: now,
      };
      if (w.auto && --ai.burstLeft <= 0) {        // rafales : quelques balles puis une pause
        const long = b.weapon === W.MINIGUN;      // le minigun arrose plus longtemps
        ai.pause = now + (ai.pauseRange[0] + Math.random() * (ai.pauseRange[1] - ai.pauseRange[0])) * (long ? 0.6 : 1);
        const [b0, b1] = long ? [14, 30] : ai.burstRange;
        ai.burstLeft = b0 + ((Math.random() * (b1 - b0 + 1)) | 0);
      }
    }
  }
  return fire;
}
