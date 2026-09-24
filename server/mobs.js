// Monstres du mode survie : ce sont des joueurs « bot » de l'équipe rouge (mêmes déplacements, mêmes tirs, mêmes dégâts
// que les autres), avec des caractéristiques propres. Ils savent toujours où sont les joueurs et les suivent
// grâce au champ de flux calculé par la salle (voir bots.js : computeFlow).
import { stepPlayer } from '../web/js/physics.js';
import { WALK_SPEED, W, EYE_HEIGHT } from '../web/shared/config.js';
import { lookDir, clamp } from '../web/shared/util.js';
import { canSee, flowDir, randomRoam } from './bots.js';

// hp / speed (multiplicateur) / melee = { dmg, cd (ms), reach (m) } / weapon = arme à distance (index) avec pref = distance préférée et range = portée
// err = imprécision de tir (rad), react = délai avant de tirer (ms), scale = taille, reward = points gagnés par le tueur
export const MOBS = {
  zombie:   { name: 'Zombie',  hp: 60,   speed: 0.65, melee: { dmg: 14, cd: 900,  reach: 1.8 }, scale: 1.0, color: '#5f9a4a', reward: 10, sight: 45 },
  runner:   { name: 'Coureur', hp: 35,   speed: 1.15, melee: { dmg: 10, cd: 600,  reach: 1.7 }, scale: 0.9, color: '#c98a3a', reward: 14, sight: 45 },
  soldier:  { name: 'Soldat',  hp: 70,   speed: 0.6,  weapon: W.AR,     pref: 12, range: 40, err: 0.06, react: 600, scale: 1.0, color: '#6a7a3a', reward: 22, sight: 70 },
  brute:    { name: 'Brute',   hp: 380,  speed: 0.55, melee: { dmg: 38, cd: 1200, reach: 2.3 }, scale: 1.5, color: '#9a3a3a', reward: 70, sight: 45 },
  sniper:   { name: 'Tireur',  hp: 60,   speed: 0.55, weapon: W.SNIPER, pref: 40, range: 90, err: 0.03, react: 900, scale: 1.0, color: '#3a5a9a', reward: 45, sight: 100 },
  // Guetteur : n'arrive pas avec les manches, il est envoyé contre les joueurs perchés hors d'atteinte (grue, toits…)
  lookout:  { name: 'Guetteur', hp: 55,  speed: 0.75, weapon: W.AR, pref: 20, range: 90, err: 0.035, react: 700, scale: 1.0, color: '#e0a526', reward: 30, sight: 110, antiPerch: true },
  boss:     { name: 'Colosse', hp: 2400, speed: 0.5,  melee: { dmg: 60, cd: 1300, reach: 3.2 }, weapon: W.ROCKET, pref: 18, range: 60, err: 0.03, react: 800, scale: 2.0, color: '#7a2a8a', reward: 500, sight: 90 },
};

// Réglages de difficulté choisis à la création du salon (les bots « easy / normal / hard » du menu)
const DIFF = { easy: { hp: 0.7, dmg: 0.7 }, normal: { hp: 1, dmg: 1 }, hard: { hp: 1.35, dmg: 1.3 } };

// Puissance des monstres à la manche `wave`
export function mobPower(wave, diff) {
  const d = DIFF[diff] || DIFF.normal;
  return {
    hp: (1 + 0.1 * (wave - 1)) * d.hp,
    dmg: Math.min(3, 1 + 0.04 * (wave - 1)) * d.dmg,
    speed: Math.min(1.35, 1 + 0.015 * (wave - 1)),
  };
}

// Liste (mélangée) des monstres de la manche : de plus en plus nombreux et variés, un boss toutes les 5 manches
export function waveList(wave, humans) {
  const n = Math.round((5 + wave * 2.2) * (1 + 0.5 * (humans - 1)));
  const weights = [['zombie', 5]];
  if (wave >= 3) weights.push(['runner', 2.5]);
  if (wave >= 4) weights.push(['soldier', 2]);
  if (wave >= 6) weights.push(['brute', 0.7 + Math.min(1.5, wave * 0.05)]);
  if (wave >= 8) weights.push(['sniper', 1]);
  const total = weights.reduce((a, w) => a + w[1], 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    let r = Math.random() * total;
    for (const [k, w] of weights) { if ((r -= w) <= 0) { out.push(k); break; } }
  }
  if (wave % 5 === 0) for (let i = 0; i < Math.min(3, wave / 5); i++) out.push('boss');
  for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

export function newMobState(def) {
  return {
    nextSee: 0, sees: false, seenAt: 0, wasSees: false, strafe: 1, strafeUntil: 0, burstLeft: 3, pause: 0, lastCheck: 0, lastPos: { x: 0, z: 0 },
    react: (def.react || 0) * (0.8 + Math.random() * 0.4),
    roam: null, roamUntil: 0,   // civils : point de déambulation
  };
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// Un tick d'un monstre. Retourne null, { melee: cible } (coup au corps à corps) ou un message de tir (comme un client).
export function mobStep(room, m, now, dt) {
  const st = m.mst, def = MOBS[m.mob.type], map = room.map;
  const armed = def.weapon !== undefined;   // attention : le fusil d'assaut a l'index 0 (un simple « def.weapon » le prenait pour « pas d'arme »)
  if (m.pull) { m.pull = null; }
  let t = null, d = Infinity, tp = null, dp = Infinity;
  for (const q of room.players.values()) {                       // cible : le joueur humain vivant le plus proche…
    if (q.bot || !q.alive || q.away) continue;
    const dq = Math.hypot(q.x - m.x, q.z - m.z);
    if (dq < d) { d = dq; t = q; }
    if (q.perched && dq < dp) { dp = dq; tp = q; }
  }
  // …sauf pour les tireurs : un joueur perché hors d'atteinte (grue, toit) passe avant, le Guetteur ne vise que lui
  if (tp && armed && (def.antiPerch || dp <= def.range)) { t = tp; d = dp; }
  if (!t) return null;
  const dx = t.x - m.x, dz = t.z - m.z, ux = dx / (d || 1), uz = dz / (d || 1);
  if (now >= st.nextSee) {
    st.nextSee = now + 200 + Math.random() * 150;
    st.sees = d < def.sight && canSee(m, t, def.sight, map.boxes);
    if (st.sees && !st.wasSees) st.seenAt = now;
    st.wasSees = st.sees;
  }

  let mvx = 0, mvz = 0, jump = false, fire = null, melee = null;
  let desYaw = Math.atan2(-dx, -dz);
  const desPitch = Math.atan2(t.y + 1.1 - (m.y + EYE_HEIGHT), Math.max(d, 0.1));
  const follow = () => { const f = flowDir(map, room.flow, m.x, m.z); if (f) { mvx = f.x; mvz = f.z; } else { mvx = ux; mvz = uz; } };

  const unarmed = !def.melee && !armed;
  const reach = def.melee ? def.melee.reach : 0;
  if (unarmed) {
    if (d < def.sight * 0.6 && st.sees) {
      mvx = -ux; mvz = -uz;                                         // civil : fuit le joueur le plus proche
    } else {
      if (!st.roam || Math.hypot(st.roam.x - m.x, st.roam.z - m.z) < 2 || now > st.roamUntil) { st.roam = randomRoam(map, m); st.roamUntil = now + 15000; }
      if (st.roam) { const rx = st.roam.x - m.x, rz = st.roam.z - m.z, rl = Math.hypot(rx, rz) || 1; mvx = rx / rl; mvz = rz / rl; }
    }
    if (mvx || mvz) desYaw = Math.atan2(-mvx, -mvz);                 // fait face à la direction de déplacement, pas à la menace
  } else if (def.melee && d <= reach && Math.abs(t.y - m.y) < 2.2) {
    melee = t;                                                    // à portée : on frappe (cooldown géré par la salle)
  } else if (armed && st.sees && d <= def.range) {
    const fwd = d > def.pref * 1.2 ? 1 : d < def.pref * 0.6 ? -1 : 0;
    if (now >= st.strafeUntil) { st.strafe = Math.random() < 0.5 ? -1 : 1; st.strafeUntil = now + 600 + Math.random() * 1200; }
    mvx = ux * fwd - uz * st.strafe * 0.7;
    mvz = uz * fwd + ux * st.strafe * 0.7;
    if (Math.abs(angDiff(m.yaw, desYaw)) < 0.1 && now - st.seenAt >= st.react && now >= st.pause && now >= m.nextFire - 30) {
      const [fx, fy, fz] = lookDir(m.yaw + (Math.random() - 0.5) * 2 * def.err, m.pitch + (Math.random() - 0.5) * 2 * def.err);
      fire = { w: def.weapon, ox: m.x, oy: m.y + EYE_HEIGHT, oz: m.z, dx: fx, dy: fy, dz: fz, seed: (Math.random() * 2147483647) | 0, sc: 0, rt: now };
      if (--st.burstLeft <= 0) { st.pause = now + 700 + Math.random() * 900; st.burstLeft = 2 + ((Math.random() * 3) | 0); }
    }
  } else if (def.antiPerch && t.perched && d < def.pref) {
    // pas de ligne de vue sur le perché : on s'écarte pour avoir un angle plutôt que de rester en dessous
    if (now >= st.strafeUntil) { st.strafe = Math.random() < 0.5 ? -1 : 1; st.strafeUntil = now + 900 + Math.random() * 1200; }
    mvx = -ux - uz * st.strafe * 0.8; mvz = -uz + ux * st.strafe * 0.8;
  } else if (def.melee && st.sees && d < 14) {
    mvx = ux; mvz = uz;                                           // corps à corps : on fonce quand on voit sa proie
  } else {
    follow();                                                     // sinon on suit le champ de flux
  }

  // rotation limitée, puis déplacement (2 sous-pas)
  const turn = armed ? 3.5 : 5;
  m.yaw += clamp(angDiff(m.yaw, desYaw), -turn * dt, turn * dt);
  if (m.yaw > Math.PI) m.yaw -= Math.PI * 2; else if (m.yaw < -Math.PI) m.yaw += Math.PI * 2;   // on ramène le cap dans [-π, π] pour ne pas dériver
  m.pitch = clamp(m.pitch + clamp(desPitch - m.pitch, -3 * dt, 3 * dt), -1.2, 1.2);
  if (now - st.lastCheck > 700) {                                 // coincé ? on saute
    if ((mvx || mvz) && Math.hypot(m.x - st.lastPos.x, m.z - st.lastPos.z) < 0.35) jump = m.onGround;
    st.lastPos = { x: m.x, z: m.z };
    st.lastCheck = now;
  }
  if (armed) {                                                    // un tireur ne se coince jamais contre l'enceinte : il longe le mur
    const lim = map.half - 3;
    if (Math.abs(m.x) > lim && Math.sign(mvx) === Math.sign(m.x)) mvx = 0;
    if (Math.abs(m.z) > lim && Math.sign(mvz) === Math.sign(m.z)) mvz = 0;
  }
  const l = Math.hypot(mvx, mvz);
  if (l > 1) { mvx /= l; mvz /= l; }
  const speed = WALK_SPEED * m.speedMul;
  stepPlayer(m, dt / 2, mvx, mvz, speed, jump, map);
  stepPlayer(m, dt / 2, mvx, mvz, speed, false, map);
  return melee ? { melee } : fire;
}
