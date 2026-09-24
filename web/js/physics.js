// Déplacement d'un joueur : boîte alignée sur les axes contre les boîtes de la carte.
// Le joueur peut monter les marches <= STEP_HEIGHT sans sauter et sauter ~1.27 m.
// Utilisé par le client (joueur local) et par le serveur (bots) : la carte est passée en paramètre.
import { PLAYER_RADIUS as R, PLAYER_HEIGHT as H, STEP_HEIGHT, GRAVITY, JUMP_SPEED } from '../shared/config.js';

const overlaps = (x, y, z, b) =>
  x + R > b.x0 && x - R < b.x1 && z + R > b.z0 && z - R < b.z1 && y + H > b.y0 && y < b.y1;

function blockedAt(boxes, x, y, z) {
  for (const b of boxes) if (overlaps(x, y, z, b)) return true;
  return false;
}

const approach = (v, target, maxDelta) => v + Math.max(-maxDelta, Math.min(maxDelta, target - v));

function resolveHoriz(p, axis, boxes) {
  for (const b of boxes) {
    if (!overlaps(p.x, p.y, p.z, b)) continue;
    const rise = b.y1 - p.y;
    // marche : on monte dessus si on est au sol et qu'il y a la place
    if (p.onGround && rise > 0 && rise <= STEP_HEIGHT && !blockedAt(boxes, p.x, b.y1 + 0.001, p.z)) {
      p.y = b.y1 + 0.001;
      continue;
    }
    if (axis === 'x') {
      const v = p.vx;
      if (v > 0) p.x = b.x0 - R - 1e-4;
      else if (v < 0) p.x = b.x1 + R + 1e-4;
      else p.x = p.x - (b.x0 - R) < (b.x1 + R) - p.x ? b.x0 - R - 1e-4 : b.x1 + R + 1e-4;
      p.vx = 0;
    } else {
      const v = p.vz;
      if (v > 0) p.z = b.z0 - R - 1e-4;
      else if (v < 0) p.z = b.z1 + R + 1e-4;
      else p.z = p.z - (b.z0 - R) < (b.z1 + R) - p.z ? b.z0 - R - 1e-4 : b.z1 + R + 1e-4;
      p.vz = 0;
    }
  }
}

// Réglages de « sensation » (joueur local seulement, activés par p.feel) : tolérances de saut et glissade.
export const COYOTE_S = 0.1;        // on peut encore sauter 100 ms après avoir quitté un rebord
export const JUMP_BUFFER_S = 0.12;  // un saut demandé juste avant d'atterrir part dès le contact
const SLIDE_FRICTION = 5;           // décélération (m/s²) pendant une glissade : l'élan dure
const AIR_ACCEL = 30;               // contrôle aérien (strafe) : on ne perd pas son élan en l'air
const HOP_LOSS = 0.93;              // part d'élan gardée à chaque saut enchaîné au-dessus de la vitesse normale

// p : { x, y, z, vx, vy, vz, onGround } (y = pieds). wishX/wishZ : direction monde normalisée.
// map : { boxes, half }
// Champs optionnels (p.feel) : p.sliding (glissade en cours), p.airMax (vitesse max en l'air, élan compris).
export function stepPlayer(p, dt, wishX, wishZ, speed, jump, map) {
  const boxes = map.boxes;
  if (p.feel) {
    // tolérances de saut : « coyote time » + saut mémorisé
    p.coyote = p.onGround ? COYOTE_S : Math.max(0, (p.coyote || 0) - dt);
    p.jbuf = jump ? JUMP_BUFFER_S : Math.max(0, (p.jbuf || 0) - dt);
    if (p.jbuf > 0 && p.coyote > 0 && p.vy <= 0.01) {
      p.vy = JUMP_SPEED; p.onGround = false; p.coyote = 0; p.jbuf = 0; p.jumped = true;
      // enchaîner les sauts garde l'élan d'une glissade, mais il s'use un peu à chaque rebond
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > speed) { p.vx *= HOP_LOSS; p.vz *= HOP_LOSS; }
    }
  } else if (jump && p.onGround) { p.vy = JUMP_SPEED; p.onGround = false; }

  if (p.feel && p.sliding && p.onGround) {
    // glissade : la vitesse décroît lentement, on peut à peine l'orienter
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > 1e-3) {
      const ns = Math.max(0, sp - SLIDE_FRICTION * dt);
      p.vx = (p.vx / sp) * ns; p.vz = (p.vz / sp) * ns;
      p.vx += wishX * 4 * dt; p.vz += wishZ * 4 * dt;
    }
  } else if (p.feel && !p.onGround) {
    // en l'air (façon Quake) : on accélère vers la direction voulue sans jamais freiner l'élan acquis
    const proj = p.vx * wishX + p.vz * wishZ;
    const add = Math.min(Math.max(0, speed - proj), AIR_ACCEL * dt);
    p.vx += wishX * add; p.vz += wishZ * add;
    const sp = Math.hypot(p.vx, p.vz), cap = Math.max(speed, p.airMax || 0);
    if (sp > cap) { p.vx *= cap / sp; p.vz *= cap / sp; }
  } else {
    const accel = p.onGround ? 70 : 14;
    p.vx = approach(p.vx, wishX * speed, accel * dt);
    p.vz = approach(p.vz, wishZ * speed, accel * dt);
  }
  p.vy -= GRAVITY * dt;

  p.x += p.vx * dt; resolveHoriz(p, 'x', boxes);
  p.z += p.vz * dt; resolveHoriz(p, 'z', boxes);

  p.y += p.vy * dt;
  p.onGround = false;
  if (p.y <= 0) { p.y = 0; if (p.vy < 0) p.vy = 0; p.onGround = true; }
  for (const b of boxes) {
    if (!overlaps(p.x, p.y, p.z, b)) continue;
    if (p.vy <= 0) { p.y = b.y1; p.vy = 0; p.onGround = true; }
    else { p.y = b.y0 - H - 1e-3; p.vy = 0; }
  }

  const lim = map.half - R;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
}
