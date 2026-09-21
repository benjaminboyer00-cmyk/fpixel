// Petits utilitaires mathématiques partagés (aucune dépendance).

export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Rayon contre boîte alignée sur les axes (méthode des "slabs").
// Retourne la distance d'entrée (>= 0) ou -1 si pas d'impact avant maxT.
export function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1, maxT) {
  let tmin = 0;
  let tmax = maxT;
  if (Math.abs(dx) < 1e-9) {
    if (ox < x0 || ox > x1) return -1;
  } else {
    const inv = 1 / dx;
    let t1 = (x0 - ox) * inv;
    let t2 = (x1 - ox) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) {
    if (oy < y0 || oy > y1) return -1;
  } else {
    const inv = 1 / dy;
    let t1 = (y0 - oy) * inv;
    let t2 = (y1 - oy) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < z0 || oz > z1) return -1;
  } else {
    const inv = 1 / dz;
    let t1 = (z0 - oz) * inv;
    let t2 = (z1 - oz) * inv;
    if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// Dévie une direction unitaire dans un cône (disque uniforme) avec un RNG à graine.
// Client et serveur utilisent la même graine => mêmes plombs des deux côtés.
export function applySpread(dx, dy, dz, spread, rng) {
  if (spread <= 0) return [dx, dy, dz];
  // base orthonormée (u, v) perpendiculaire à d
  let ux, uy, uz;
  if (Math.abs(dy) > 0.99) { ux = 1; uy = 0; uz = 0; }
  else {
    ux = dz; uy = 0; uz = -dx; // d x up
    const l = Math.hypot(ux, uz) || 1;
    ux /= l; uz /= l;
  }
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(rng()) * spread;
  const cu = Math.cos(a) * r;
  const cv = Math.sin(a) * r;
  let ox = dx + ux * cu + vx * cv;
  let oy = dy + uy * cu + vy * cv;
  let oz = dz + uz * cu + vz * cv;
  const l = Math.hypot(ox, oy, oz) || 1;
  return [ox / l, oy / l, oz / l];
}

// Direction de regard (yaw autour de Y, pitch vers le haut), convention three.js : yaw 0 regarde -Z.
export function lookDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
