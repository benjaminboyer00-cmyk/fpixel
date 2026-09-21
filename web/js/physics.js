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

// p : { x, y, z, vx, vy, vz, onGround } (y = pieds). wishX/wishZ : direction monde normalisée.
// map : { boxes, half }
export function stepPlayer(p, dt, wishX, wishZ, speed, jump, map) {
  const boxes = map.boxes;
  const accel = p.onGround ? 70 : 14;
  p.vx = approach(p.vx, wishX * speed, accel * dt);
  p.vz = approach(p.vz, wishZ * speed, accel * dt);
  if (jump && p.onGround) { p.vy = JUMP_SPEED; p.onGround = false; }
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
