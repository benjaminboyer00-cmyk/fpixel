// IA des bots : ils utilisent exactement le même joueur, la même physique et le même tir que les humains
// (le tir passe par handleFire côté serveur : mêmes dégâts, mêmes murs, mêmes plombs).
import { stepPlayer } from '../web/js/physics.js';
import { rayAABB, lookDir, clamp } from '../web/shared/util.js';
import { EYE_HEIGHT, WALK_SPEED, WEAPONS, PLAYER_RADIUS, PLAYER_HEIGHT, GUN_ORDER } from '../web/shared/config.js';

export const BOT_NAMES = ['Léo', 'Maya', 'Nico', 'Zoé', 'Enzo', 'Lina', 'Hugo', 'Jade', 'Noah', 'Emma', 'Tom', 'Chloé'];

//            fusil d'assaut, pompe, sniper, revolver, couteau
const PREF = [14, 5, 32, 10, 1.8];   // distance de combat préférée
const RANGE = [60, 16, 100, 45, 2.2]; // ne tire pas au-delà

// Points de patrouille : au sol, à distance des obstacles, hors de l'intérieur des bâtiments (calculés une fois par carte)
const navCache = new Map();
function navFor(map) {
  let nav = navCache.get(map.id);
  if (nav) return nav;
  nav = [];
  const m = PLAYER_RADIUS + 0.4, lim = map.half - 4;
  for (let x = -lim; x <= lim; x += 4) {
    for (let z = -lim; z <= lim; z += 4) {
      const blocked = map.boxes.some((b) => x + m > b.x0 && x - m < b.x1 && z + m > b.z0 && z - m < b.z1 && b.y0 < PLAYER_HEIGHT);
      const inside = map.interiors.some((r) => x > r.x0 - 1 && x < r.x1 + 1 && z > r.z0 - 1 && z < r.z1 + 1);
      if (!blocked && !inside) nav.push({ x, z });
    }
  }
  navCache.set(map.id, nav);
  return nav;
}

// Réglages par difficulté. err = imprécision de visée (rad), turn = vitesse de rotation (rad/s),
// react = temps de réaction (ms), head = chance de viser la tête, pause = pause entre rafales (ms).
export const DIFFS = {
  easy:   { skill: [0.25, 0.4], react: [1400, 2000], err: [0.2, 0.26],   turn: [0.9, 1.3], head: 0,    pause: [1200, 2500], sight: 30, speed: 0.55, tol: 0.16, burst: [1, 2] },
  normal: { skill: [0.65, 1.0], react: [350, 600],  err: null,           turn: null,       head: 0.3,  pause: [300, 800],  sight: 70, speed: 0.85, tol: 0.09 },
  hard:   { skill: [0.9, 1.0],  react: [150, 300],  err: [0.012, 0.02],  turn: [7, 8.5],   head: 0.55, pause: [150, 400],  sight: 95, speed: 0.95, tol: 0.06 },
};

export function newBotAI(diff = 'normal') {
  const D = DIFFS[diff] || DIFFS.normal;
  const r = (a, b) => a + Math.random() * (b - a);
  const skill = r(D.skill[0], D.skill[1]);
  return {
    diff, skill,
    reaction: r(D.react[0], D.react[1]),
    err: D.err ? r(D.err[0], D.err[1]) : 0.06 - 0.035 * skill,
    maxTurn: D.turn ? r(D.turn[0], D.turn[1]) : 2.5 + 3 * skill,
    headChance: diff === 'normal' ? D.head * skill : D.head,
    pauseRange: D.pause, burstRange: D.burst || [3, 7], sight: D.sight, speedMul: D.speed, tol: D.tol,
    target: null, seenAt: 0, nextScan: 0,
    wp: null, lastPos: { x: 0, z: 0 }, lastCheck: 0,
    strafe: 1, strafeUntil: 0, mid: 0, aimHead: false, burstLeft: D.burst ? D.burst[1] : 4, pause: 0,
  };
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function canSee(b, t, sight, boxes) {
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

function scan(room, b, now) {
  const ai = b.ai;
  ai.nextScan = now + 200 + Math.random() * 150;
  const t = pickTarget(room, b, now);
  if (t && (!ai.target || ai.target.id !== t.id || !ai.target.alive)) {
    ai.seenAt = now;                                   // nouvelle cible : temps de réaction
    ai.mid = Math.random() < 0.7 ? 0 : 3;              // fusil d'assaut ou revolver à moyenne distance
    ai.aimHead = Math.random() < ai.headChance;
  }
  if (!t) ai.seenAt = 0;
  ai.target = t;
  if (room.mode === 'gun') {
    b.weapon = GUN_ORDER[Math.min(b.level, GUN_ORDER.length - 1)];   // en Gun Game l'arme dépend du niveau
  } else if (t) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    b.weapon = d < 9 ? 1 : d < 38 ? ai.mid : 2;
  } else {
    b.weapon = 0;
  }
}

// Fait avancer le bot d'un tick. Retourne un message de tir (comme un client) ou null.
export function botStep(room, b, now, dt) {
  const ai = b.ai;
  if (b.pull) { // attiré par un grappin : on se laisse tirer vers le tireur
    const px = b.pull.x - b.x, pz = b.pull.z - b.z, pl = Math.hypot(px, pz);
    if (now < b.pull.until && pl > 1.6) {
      stepPlayer(b, dt / 2, px / pl, pz / pl, b.pull.speed, false, room.map);
      stepPlayer(b, dt / 2, px / pl, pz / pl, b.pull.speed, false, room.map);
      return null;
    }
    b.pull = null;
  }
  if (now >= ai.nextScan) scan(room, b, now);
  const t = ai.target && ai.target.alive ? ai.target : null;

  let fw = 0, st = 0, jump = false, fire = null;
  let desYaw = b.yaw, desPitch = 0;
  const eyeY = b.y + EYE_HEIGHT;
  const maxTurn = ai.maxTurn; // rad/s

  if (t) {
    const dx = t.x - b.x, dz = t.z - b.z, d = Math.hypot(dx, dz);
    desYaw = Math.atan2(-dx, -dz);
    desPitch = Math.atan2(t.y + (ai.aimHead ? 1.62 : 1.15) - eyeY, Math.max(d, 0.1));
    const pref = PREF[b.weapon];
    fw = d > pref * 1.25 ? 1 : d < pref * 0.6 ? -1 : 0;
    if (now >= ai.strafeUntil) { ai.strafe = Math.random() < 0.5 ? -1 : 1; ai.strafeUntil = now + 500 + Math.random() * 1100; }
    st = ai.strafe * 0.8;
    if (b.onGround && Math.random() < dt * 0.35) jump = true; // saute de temps en temps pour esquiver
  } else {
    // patrouille vers un point au hasard
    const nav = navFor(room.map);
    if (!ai.wp || Math.hypot(ai.wp.x - b.x, ai.wp.z - b.z) < 1.5) ai.wp = nav[(Math.random() * nav.length) | 0];
    desYaw = Math.atan2(-(ai.wp.x - b.x), -(ai.wp.z - b.z));
    fw = Math.abs(angDiff(b.yaw, desYaw)) < 0.7 ? 1 : 0;
    if (now - ai.lastCheck > 700) {               // coincé contre un obstacle ? on saute et on change de but
      if (fw && Math.hypot(b.x - ai.lastPos.x, b.z - ai.lastPos.z) < 0.5) { ai.wp = null; jump = b.onGround; }
      ai.lastPos = { x: b.x, z: b.z };
      ai.lastCheck = now;
    }
  }

  // rotation limitée : un bot ne se retourne pas instantanément
  b.yaw += clamp(angDiff(b.yaw, desYaw), -maxTurn * dt, maxTurn * dt);
  b.pitch = clamp(b.pitch + clamp(desPitch - b.pitch, -maxTurn * dt, maxTurn * dt), -1.2, 1.2);

  // déplacement (2 sous-pas pour ne pas traverser les murs fins à 20 Hz)
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw), rx = Math.cos(b.yaw), rz = -Math.sin(b.yaw);
  let wx = fx * fw + rx * st, wz = fz * fw + rz * st;
  const l = Math.hypot(wx, wz);
  if (l > 1) { wx /= l; wz /= l; }
  const speed = WALK_SPEED * WEAPONS[b.weapon].speed * (t ? ai.speedMul : ai.speedMul * 0.8);
  stepPlayer(b, dt / 2, wx, wz, speed, jump, room.map);
  stepPlayer(b, dt / 2, wx, wz, speed, false, room.map);

  // tir : réaction écoulée, bien aligné, à portée
  if (t && now - ai.seenAt >= ai.reaction && now >= ai.pause) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    const tol = b.weapon === 2 ? ai.tol * 0.4 : ai.tol;
    if (Math.abs(angDiff(b.yaw, desYaw)) < tol && Math.abs(desPitch - b.pitch) < tol + 0.03 && d <= RANGE[b.weapon] && now >= b.nextFire - 30) {
      const w = WEAPONS[b.weapon];
      const e = ai.err; // imprécision de visée
      const [ux, uy, uz] = lookDir(b.yaw + (Math.random() - 0.5) * 2 * e, b.pitch + (Math.random() - 0.5) * 2 * e);
      fire = {
        w: b.weapon, ox: b.x, oy: b.y + EYE_HEIGHT, oz: b.z, dx: ux, dy: uy, dz: uz,
        seed: (Math.random() * 2147483647) | 0, sc: w.zoom ? 1 : 0, rt: now,
      };
      if (w.auto && --ai.burstLeft <= 0) {        // rafales : quelques balles puis une pause
        ai.pause = now + ai.pauseRange[0] + Math.random() * (ai.pauseRange[1] - ai.pauseRange[0]);
        const [b0, b1] = ai.burstRange;
        ai.burstLeft = b0 + ((Math.random() * (b1 - b0 + 1)) | 0);
      }
    }
  }
  return fire;
}
