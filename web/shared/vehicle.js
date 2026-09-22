// Voiture du mode Braquage : physique arcade simple (avant/arrière + virage proportionnel à la vitesse),
// toujours au sol (pas de saut, pas de pente). Simulée à l'identique par le serveur (autoritaire) et par le
// client du conducteur (pilotage sans retard), comme l'avion en papier (voir shared/plane.js).
import { clamp } from './util.js';

export const CAR = {
  accel: 14,        // m/s² en accélérant
  brake: 24,        // m/s² en freinant / marche arrière
  friction: 7,       // décélération naturelle (pied hors des pédales)
  maxSpeed: 16,      // m/s en avant
  maxReverse: 7,     // m/s en marche arrière
  turnRate: 2.0,     // rad/s de virage à pleine vitesse
  radius: 1.3,       // empreinte de collision (carrée, simplifiée) contre les boîtes de la carte
  height: 1.5,
  enterRadius: 3.0,  // distance pour monter à bord
};

// car : { x, y, z, yaw, speed }. throttle/steer in [-1, 1].
export function stepCar(car, dt, throttle, steer, map) {
  if (throttle > 0.05) car.speed += CAR.accel * throttle * dt;
  else if (throttle < -0.05) car.speed += CAR.brake * throttle * dt;
  else {
    const f = CAR.friction * dt;
    car.speed = car.speed > 0 ? Math.max(0, car.speed - f) : Math.min(0, car.speed + f);
  }
  car.speed = clamp(car.speed, -CAR.maxReverse, CAR.maxSpeed);

  // le virage suit la vitesse (pas de rotation sur place) et s'inverse en marche arrière
  const speedFrac = clamp(Math.abs(car.speed) / CAR.maxSpeed, 0.18, 1);
  const turnDir = car.speed < 0 ? -1 : 1;
  car.yaw += steer * CAR.turnRate * speedFrac * turnDir * dt;

  const dx = -Math.sin(car.yaw) * car.speed * dt;
  const dz = -Math.cos(car.yaw) * car.speed * dt;
  const r = CAR.radius, cy0 = 0, cy1 = CAR.height;
  const hit = (x, z) => {
    for (const b of map.boxes) {
      if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1 && cy1 > b.y0 && cy0 < b.y1) return true;
    }
    return false;
  };
  if (!hit(car.x + dx, car.z)) car.x += dx; else car.speed *= 0.3;
  if (!hit(car.x, car.z + dz)) car.z += dz; else car.speed *= 0.3;

  const lim = map.half - r;
  car.x = clamp(car.x, -lim, lim);
  car.z = clamp(car.z, -lim, lim);
  car.y = 0;
}
