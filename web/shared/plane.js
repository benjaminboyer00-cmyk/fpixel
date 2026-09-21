// Avion en papier : vol lent et planant, dirigé vers un cap (yaw/pitch) avec une vitesse de virage limitée.
// Simulé à l'identique par le serveur (autoritaire : collisions, dégâts) et par le client du pilote (pour un pilotage sans retard).
import { clamp } from './util.js';

export const PLANE = {
  speed: 10,        // m/s
  sink: 0.7,        // m/s de perte d'altitude à plat : il plane vers le sol
  turnYaw: 1.6,     // rad/s max
  turnPitch: 1.1,
  life: 15,         // secondes de vol maximum
  radius: 0.4,      // rayon de contact avec un joueur
  head: 200,        // touche à la tête : tue à coup sûr
  body: 60,         // touche au corps : deux avions pour tuer
};

const angDiff = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// p : { x, y, z, yaw, pitch } ; wantYaw / wantPitch : cap voulu par le pilote
export function stepPlane(p, dt, wantYaw, wantPitch) {
  p.yaw += clamp(angDiff(p.yaw, wantYaw), -PLANE.turnYaw * dt, PLANE.turnYaw * dt);
  p.pitch = clamp(p.pitch + clamp(wantPitch - p.pitch, -PLANE.turnPitch * dt, PLANE.turnPitch * dt), -1.0, 1.0);
  const c = Math.cos(p.pitch);
  p.x += -Math.sin(p.yaw) * c * PLANE.speed * dt;
  p.z += -Math.cos(p.yaw) * c * PLANE.speed * dt;
  p.y += (Math.sin(p.pitch) * PLANE.speed - PLANE.sink) * dt;
}
