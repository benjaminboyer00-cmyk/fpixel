// Modèles low-poly (que des boîtes) : armes et joueurs.
import * as THREE from 'three';

const matCache = new Map();
export function mat(color) {
  let m = matCache.get(color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo, mat(color));
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  return m;
}

// Armes : canon vers -Z, origine vers la poignée. userData.muzzle = position de la bouche du canon.
export function buildGun(id) {
  const g = new THREE.Group();
  let muzzle = [0, 0.02, -0.7];
  switch (id) {
    case 'ar':
      g.add(box(0.06, 0.1, 0.5, '#3b3f46', 0, 0, -0.2));
      g.add(box(0.03, 0.03, 0.3, '#1d2025', 0, 0.02, -0.55));
      g.add(box(0.07, 0.07, 0.22, '#4f5560', 0, -0.01, -0.4));
      g.add(box(0.045, 0.15, 0.07, '#2a2d33', 0, -0.12, -0.17));
      g.add(box(0.055, 0.09, 0.2, '#3b3f46', 0, -0.01, 0.2));
      g.add(box(0.045, 0.1, 0.05, '#2a2d33', 0, -0.1, 0.02));
      g.add(box(0.02, 0.04, 0.03, '#111', 0, 0.07, -0.1));
      muzzle = [0, 0.02, -0.72];
      break;
    case 'shotgun':
      g.add(box(0.045, 0.045, 0.62, '#3a3d44', 0, 0.02, -0.45));
      g.add(box(0.075, 0.06, 0.2, '#7a4b28', 0, -0.03, -0.35));
      g.add(box(0.06, 0.09, 0.36, '#55341c', 0, 0, -0.05));
      g.add(box(0.055, 0.1, 0.28, '#7a4b28', 0, -0.02, 0.25));
      g.add(box(0.045, 0.09, 0.05, '#55341c', 0, -0.09, 0.05));
      muzzle = [0, 0.02, -0.78];
      break;
    case 'sniper':
      g.add(box(0.03, 0.03, 0.85, '#20242a', 0, 0.02, -0.6));
      g.add(box(0.055, 0.09, 0.5, '#33422f', 0, 0, -0.1));
      g.add(box(0.055, 0.11, 0.3, '#33422f', 0, -0.02, 0.3));
      g.add(box(0.05, 0.05, 0.26, '#111318', 0, 0.09, -0.15));
      g.add(box(0.07, 0.07, 0.04, '#111318', 0, 0.09, -0.29));
      g.add(box(0.04, 0.08, 0.06, '#20242a', 0, -0.08, -0.05));
      muzzle = [0, 0.02, -1.05];
      break;
    case 'revolver':
      g.add(box(0.03, 0.03, 0.24, '#aab0b8', 0, 0.035, -0.2));
      g.add(box(0.065, 0.065, 0.09, '#8c939c', 0, 0.02, -0.06));
      g.add(box(0.04, 0.07, 0.14, '#9aa1aa', 0, 0.015, 0.02));
      g.add(box(0.04, 0.12, 0.06, '#6b4423', 0, -0.075, 0.07));
      muzzle = [0, 0.035, -0.33];
      break;
    case 'knife':
      g.add(box(0.02, 0.06, 0.28, '#e6ebf0', 0, 0, -0.2));
      g.add(box(0.06, 0.02, 0.025, '#555b66', 0, 0, -0.05));
      g.add(box(0.03, 0.035, 0.12, '#4a3222', 0, 0, 0.03));
      muzzle = [0, 0, -0.35];
      break;
  }
  g.userData.muzzle = new THREE.Vector3(...muzzle);
  return g;
}

// Position / rotation de l'arme en vue première personne
export const VM_POSE = {
  ar: { p: [0.21, -0.25, -0.66], r: [0, 0, 0] },
  shotgun: { p: [0.21, -0.25, -0.66], r: [0, 0, 0] },
  sniper: { p: [0.2, -0.24, -0.6], r: [0, 0, 0] },
  revolver: { p: [0.19, -0.22, -0.55], r: [0.05, 0, 0] },
  knife: { p: [0.22, -0.24, -0.6], r: [0.3, -0.4, 0.5] },
};

// Joueur adverse : tête, torse, jambes, bras + arme. Faces vers -Z (comme la caméra à yaw 0).
export function buildPlayer(color) {
  const g = new THREE.Group();
  g.add(box(0.6, 0.7, 0.34, color, 0, 1.05, 0));           // torse (0.7 -> 1.4)

  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  head.add(box(0.4, 0.4, 0.4, '#f0c8a0'));
  head.add(box(0.08, 0.06, 0.02, '#1b1b1b', -0.09, 0.03, -0.205));
  head.add(box(0.08, 0.06, 0.02, '#1b1b1b', 0.09, 0.03, -0.205));
  head.add(box(0.42, 0.12, 0.42, '#3a2a1e', 0, 0.16, 0));  // cheveux
  g.add(head);

  const legs = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.15, 0.7, 0);
    pivot.add(box(0.24, 0.7, 0.26, '#2a3140', 0, -0.35, 0));
    g.add(pivot);
    legs.push(pivot);
  }

  // Bras droit tendu vers l'avant, tenant l'arme
  const holder = new THREE.Group();
  holder.position.set(0.3, 1.2, -0.05);
  holder.add(box(0.14, 0.14, 0.5, color, 0, 0, -0.2));
  g.add(holder);
  // Bras gauche (soutient l'arme)
  const armL = box(0.14, 0.14, 0.4, color, -0.18, 1.2, -0.3);
  g.add(armL);

  const guns = {};
  let cur = null;
  const setWeapon = (id) => {
    if (cur === id) return;
    if (cur && guns[cur]) guns[cur].visible = false;
    if (!guns[id]) {
      guns[id] = buildGun(id);
      guns[id].position.set(0, 0.02, -0.35);
      guns[id].scale.setScalar(0.9);
      holder.add(guns[id]);
    }
    guns[id].visible = true;
    cur = id;
  };

  return { group: g, head, legs, setWeapon };
}

export function makeNameSprite(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 34px monospace';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 6; x.strokeStyle = '#000';
  x.strokeText(name, 128, 34);
  x.fillStyle = color;
  x.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  s.scale.set(1.8, 0.45, 1);
  s.position.y = 2.25;
  return s;
}
