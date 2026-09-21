// IA des bots : ils utilisent exactement le même joueur, la même physique et le même tir que les humains
// (le tir passe par handleFire côté serveur : mêmes dégâts, mêmes murs, mêmes plombs).
import { stepPlayer } from '../web/js/physics.js';
import { BOXES } from '../web/shared/map.js';
import { rayAABB, lookDir, clamp } from '../web/shared/util.js';
import { EYE_HEIGHT, WALK_SPEED, WEAPONS, PLAYER_RADIUS, PLAYER_HEIGHT } from '../web/shared/config.js';

export const BOT_NAMES = ['Léo', 'Maya', 'Nico', 'Zoé', 'Enzo', 'Lina', 'Hugo', 'Jade', 'Noah', 'Emma', 'Tom', 'Chloé'];

const SIGHT = 70;
//            fusil d'assaut, pompe, sniper, revolver, couteau
const PREF = [14, 5, 32, 10, 1.8];   // distance de combat préférée
const RANGE = [60, 16, 100, 45, 2.2]; // ne tire pas au-delà

// Points de patrouille : au sol, à distance des obstacles
const NAV = [];
for (let x = -26; x <= 26; x += 4) {
  for (let z = -26; z <= 26; z += 4) {
    const m = PLAYER_RADIUS + 0.4;
    const blocked = BOXES.some((b) => x + m > b.x0 && x - m < b.x1 && z + m > b.z0 && z - m < b.z1 && b.y0 < PLAYER_HEIGHT);
    if (!blocked) NAV.push({ x, z });
  }
}

export function newBotAI() {
  return {
    skill: 0.65 + Math.random() * 0.35,   // 0.65 = mou, 1 = bon
    target: null, seenAt: 0, nextScan: 0, reaction: 350 + Math.random() * 250,
    wp: null, lastPos: { x: 0, z: 0 }, lastCheck: 0,
    strafe: 1, strafeUntil: 0, mid: 0, aimHead: false, burstLeft: 4, pause: 0,
  };
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function canSee(b, t) {
  const ex = b.x, ey = b.y + EYE_HEIGHT, ez = b.z;
  for (const ty of [t.y + 1.0, t.y + 1.6]) {
    const dx = t.x - ex, dy = ty - ey, dz = t.z - ez;
    const d = Math.hypot(dx, dy, dz);
    if (d > SIGHT) return false;
    const ux = dx / d, uy = dy / d, uz = dz / d;
    let blocked = false;
    for (const bx of BOXES) {
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
    if (d < bestD && canSee(b, q)) { best = q; bestD = d; }
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
    ai.aimHead = Math.random() < 0.3 * ai.skill;
  }
  if (!t) ai.seenAt = 0;
  ai.target = t;
  if (t) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    b.weapon = d < 9 ? 1 : d < 38 ? ai.mid : 2;
  } else {
    b.weapon = 0;
  }
}

// Fait avancer le bot d'un tick. Retourne un message de tir (comme un client) ou null.
export function botStep(room, b, now, dt) {
  const ai = b.ai;
  if (now >= ai.nextScan) scan(room, b, now);
  const t = ai.target && ai.target.alive ? ai.target : null;

  let fw = 0, st = 0, jump = false, fire = null;
  let desYaw = b.yaw, desPitch = 0;
  const eyeY = b.y + EYE_HEIGHT;
  const maxTurn = 2.5 + 3 * ai.skill; // rad/s

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
    if (!ai.wp || Math.hypot(ai.wp.x - b.x, ai.wp.z - b.z) < 1.5) ai.wp = NAV[(Math.random() * NAV.length) | 0];
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
  const speed = WALK_SPEED * WEAPONS[b.weapon].speed * (t ? 0.85 : 0.7);
  stepPlayer(b, dt / 2, wx, wz, speed, jump);
  stepPlayer(b, dt / 2, wx, wz, speed, false);

  // tir : réaction écoulée, bien aligné, à portée
  if (t && now - ai.seenAt >= ai.reaction && now >= ai.pause) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    const tol = b.weapon === 2 ? 0.035 : 0.09;
    if (Math.abs(angDiff(b.yaw, desYaw)) < tol && Math.abs(desPitch - b.pitch) < tol + 0.03 && d <= RANGE[b.weapon] && now >= b.nextFire - 30) {
      const w = WEAPONS[b.weapon];
      const e = 0.06 - 0.035 * ai.skill; // imprécision de visée
      const [ux, uy, uz] = lookDir(b.yaw + (Math.random() - 0.5) * 2 * e, b.pitch + (Math.random() - 0.5) * 2 * e);
      fire = {
        w: b.weapon, ox: b.x, oy: b.y + EYE_HEIGHT, oz: b.z, dx: ux, dy: uy, dz: uz,
        seed: (Math.random() * 2147483647) | 0, sc: w.zoom ? 1 : 0, rt: now,
      };
      if (w.auto && --ai.burstLeft <= 0) {        // rafales : quelques balles puis une pause
        ai.pause = now + 300 + Math.random() * 500;
        ai.burstLeft = 3 + ((Math.random() * 5) | 0);
      }
    }
  }
  return fire;
}
