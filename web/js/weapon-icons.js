// Icônes d'armes : rendu hors écran des modèles low-poly de models.js (mêmes assets qu'en jeu, rien à dessiner à la main).
import * as THREE from 'three';
import { buildGun } from './models.js';

let renderer = null, scene = null, camera = null;
const cache = new Map();

function ensureRenderer() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x2a2f24, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 3, 2.4);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);
}

// Boîte englobante approximative (les modèles n'utilisent que des boîtes ; le build three.js allégé n'a pas Box3),
// calculée à partir de la position/l'échelle de chaque enfant direct, sans tenir compte d'une éventuelle rotation locale.
function localBounds(group) {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of group.children) {
    const hx = c.scale.x / 2, hy = c.scale.y / 2, hz = c.scale.z / 2;
    minX = Math.min(minX, c.position.x - hx); maxX = Math.max(maxX, c.position.x + hx);
    minY = Math.min(minY, c.position.y - hy); maxY = Math.max(maxY, c.position.y + hy);
    minZ = Math.min(minZ, c.position.z - hz); maxZ = Math.max(maxZ, c.position.z + hz);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2, sx: maxX - minX, sy: maxY - minY, sz: maxZ - minZ };
}

// Rendu 3/4 avant-gauche, cadré automatiquement sur la boîte englobante (marche pour un couteau comme pour un lance-roquettes).
export function weaponIcon(weaponId, size = 64) {
  const key = `${weaponId}:${size}`;
  if (cache.has(key)) return cache.get(key);
  ensureRenderer();
  renderer.setSize(size, size, false);

  const inner = buildGun(weaponId);
  const b = localBounds(inner);
  inner.position.set(-b.cx, -b.cy, -b.cz); // recentre le modèle sur l'origine du pivot

  const pivot = new THREE.Group();
  pivot.add(inner);
  pivot.rotation.y = Math.PI * 0.24;
  pivot.rotation.x = -0.08;
  scene.add(pivot);

  const radius = Math.max(b.sx, b.sy, b.sz, 0.05);
  const dist = radius * 1.9;
  camera.position.set(dist * 0.6, dist * 0.5, dist * 0.8);
  camera.near = Math.max(0.01, dist * 0.05);
  camera.far = dist * 6;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(pivot);
  cache.set(key, url);
  return url;
}
