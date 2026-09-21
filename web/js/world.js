// Scène 3D : ciel, lumières, sol et boîtes de la carte, le tout en textures "pixel" procédurales.
import * as THREE from 'three';
import { BOXES, HALF } from '../shared/map.js';

const COLORS = {
  wall: '#7d8a99', crate: '#c98a45', crateDark: '#8f5d30', platform: '#6c7d92',
  stairs: '#8b98a9', low: '#9aa56b', pillar: '#b9bdc6', stone: '#8b8f96',
};
const SKY = '#9ec9f0';

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Petite texture bruitée (sans lissage) => rendu "pixel art"
function pixelTexture(hex, size = 8, variance = 0.07, checker = 0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const [r, gr, b] = hexToRgb(hex);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let k = 1 + (Math.random() - 0.5) * variance * 2;
      if (checker && ((x >= size / 2) !== (y >= size / 2))) k *= 1 - checker;
      const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
      g.fillStyle = `rgb(${f(r)},${f(gr)},${f(b)})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// BoxGeometry dont les UV suivent les dimensions réelles : un pixel de texture = même taille partout
function boxGeometry(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]]; // +x -x +y -y +z -z
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  return g;
}

export function createWorld(scene) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 30, 95);

  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x556644, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.6, 1, 0.4);
  scene.add(sun);

  // Sol
  const floorTex = pixelTexture('#5d7f4a', 8, 0.08, 0.12);
  floorTex.repeat.set((HALF * 2) / 4, (HALF * 2) / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshLambertMaterial({ map: floorTex }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Boîtes de la carte
  const mats = {};
  for (const [k, hex] of Object.entries(COLORS)) mats[k] = new THREE.MeshLambertMaterial({ map: pixelTexture(hex) });
  const group = new THREE.Group();
  for (const b of BOXES) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
    const m = new THREE.Mesh(boxGeometry(w, h, d), mats[b.c] || mats.wall);
    m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
    group.add(m);
  }
  scene.add(group);
}
