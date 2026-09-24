// Scène 3D : ciel, lumières, sol et boîtes de la carte, le tout en textures "pixel" procédurales.
//  - une texture dessinée par matériau (briques, planches, tôle…), 8 pixels par mètre partout
//  - ombre de contact en bas des murs (couleurs de sommets) et légère variation de teinte d'une boîte à l'autre
//  - sol peint d'un seul tenant : motif du sol, routes et ombres portées précalculées (soleil fixe)
//  - toutes les boîtes d'un même matériau fusionnées en un seul maillage (quelques draw calls au lieu de centaines)
import * as THREE from 'three';

const COLORS = {
  wall: '#7d8a99', crate: '#c98a45', crateDark: '#8f5d30', platform: '#6c7d92',
  stairs: '#8b98a9', low: '#9aa56b', pillar: '#b9bdc6', stone: '#8b8f96',
  // village
  brick: '#a5583f', brickDark: '#7d4130', roof: '#5d4a3e', wood: '#8a6a45', plaster: '#d9cfb8',
  fence: '#a58b62', bush: '#3f7a3b', concrete: '#9a9da3', metal: '#66707c', road: '#6f6f72',
  // chantier
  steel: '#c9a227', scaffold: '#8a949e', tarp: '#3c6e9e', rubble: '#8c8475', glass: '#8fb8c8',
};

const SUN = { x: 0.6, y: 1, z: 0.4 };   // même direction que la lumière du soleil
const PX = 16;                           // pixels par tuile de texture (une tuile = 2 m)

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// hasard reproductible (mêmes textures à chaque chargement)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Dessine un motif pixel : shade(x, y, rand) -> facteur de luminosité (1 = couleur de base)
function paint(g, hex, size, shade, seed, ox = 0, oy = 0) {
  const [r, gr, b] = hexToRgb(hex);
  const rand = rng(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = shade(x, y, rand);
      const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
      g.fillStyle = `rgb(${f(r)},${f(gr)},${f(b)})`;
      g.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

const noise = (v) => (rand) => 1 + (rand() - 0.5) * 2 * v;
// Motifs par matériau (sur une tuile de PX×PX pixels = 2 m × 2 m)
const PATTERNS = {
  brick: (x, y, rand) => {
    const row = y >> 2, off = row % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 7) return 0.72;              // joints
    return (1 + (rand() - 0.5) * 0.12) * (1 + (((x + off) >> 3) * 7 + row * 3) % 5 * 0.025);
  },
  wall: (x, y, rand) => (y % 8 === 7 || (x + ((y >> 3) % 2) * 4) % 8 === 7 ? 0.82 : noise(0.06)(rand)),
  crate: (x, y, rand) => {
    if (x < 2 || y < 2 || x > PX - 3 || y > PX - 3) return 0.72;       // cadre
    if (Math.abs(x - y) < 1.5) return 0.8;                             // traverse en diagonale
    return y % 4 === 1 ? 0.88 : noise(0.07)(rand);
  },
  wood: (x, y, rand) => (x % 4 === 3 ? 0.74 : (y * 5 + (x >> 2) * 11) % 23 === 0 ? 0.7 : noise(0.08)(rand)),
  fence: (x, y, rand) => (x % 4 === 3 ? 0.6 : y === 3 || y === 12 ? 0.8 : noise(0.08)(rand)),
  metal: (x, y, rand) => (x % 4 === 0 ? 1.12 : x % 4 === 3 ? 0.82 : noise(0.03)(rand)),
  steel: (x, y, rand) => (y < 2 || y > PX - 3 ? 0.78 : (x + y) % 8 < 1 ? 0.35 : noise(0.04)(rand)),   // poutre jaune et noire
  concrete: (x, y, rand) => (x === 0 || y === 0 ? 0.9 : noise(0.07)(rand) * (rand() < 0.03 ? 0.85 : 1)),
  stone: (x, y, rand) => {
    const row = y >> 2, off = (row * 3) % 8;
    if (y % 4 === 3 || (x + off) % 6 === 5) return 0.7;
    return noise(0.1)(rand);
  },
  low: (x, y, rand) => (y % 4 === 3 || (x + (y >> 2) * 3) % 6 === 5 ? 0.72 : noise(0.1)(rand) * (y < 3 && rand() < 0.4 ? 0.85 : 1)),
  roof: (x, y, rand) => (y % 4 === 3 ? 0.7 : y % 4 === 0 ? 1.1 : (x + (y >> 2) * 2) % 5 === 4 ? 0.85 : noise(0.06)(rand)),
  plaster: (x, y, rand) => noise(0.05)(rand) * (rand() < 0.02 ? 0.9 : 1),
  bush: (x, y, rand) => { const v = rand(); return v < 0.15 ? 0.7 : v > 0.88 ? 1.25 : 1 + (rand() - 0.5) * 0.2; },
  platform: (x, y, rand) => (x % 8 === 0 || y % 8 === 0 ? 0.8 : (x % 8 === 2 && y % 8 === 2) ? 1.25 : noise(0.04)(rand)),
  stairs: (x, y, rand) => (y % 8 === 0 ? 1.18 : y % 8 === 7 ? 0.78 : noise(0.05)(rand)),
  pillar: (x, y, rand) => (x % 4 === 0 ? 0.82 : x % 4 === 2 ? 1.1 : noise(0.04)(rand)),
  scaffold: (x, y, rand) => (x < 2 || x > PX - 3 || y < 2 ? 1.08 : (x + y) % 16 < 2 ? 1.0 : 0.55),
  tarp: (x, y, rand) => (y % 6 === 0 ? 0.82 : noise(0.05)(rand)),
  rubble: (x, y, rand) => { const v = rand(); return v < 0.2 ? 0.7 : v > 0.85 ? 1.2 : 1 + (rand() - 0.5) * 0.15; },
  glass: (x, y, rand) => (x === 0 || y === 0 ? 0.6 : x + y === 10 || x + y === 12 ? 1.35 : 1),
};

function materialTexture(kind, hex) {
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const g = c.getContext('2d');
  paint(g, hex, PX, PATTERNS[kind] || PATTERNS.concrete, kind.length * 977 + hex.charCodeAt(2));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- sol : motif + routes + ombres, dans une seule grande texture (8 px par mètre, filtrage « pixel ») ----
const FLOOR_PX = 8;
const FLOOR_PATTERNS = {
  grass: (x, y, rand) => { const v = rand(); return v < 0.06 ? 0.82 : v > 0.94 ? 1.15 : 1 + (rand() - 0.5) * 0.1; },
  tiles: (x, y, rand) => (x % 16 === 0 || y % 16 === 0 ? 0.82 : 1 + (rand() - 0.5) * 0.06),
  asphalt: (x, y, rand) => { const v = rand(); return v < 0.04 ? 1.2 : 1 + (rand() - 0.5) * 0.1; },
  dirt: (x, y, rand) => { const v = rand(); return v < 0.08 ? 0.8 : v > 0.95 ? 1.18 : 1 + (rand() - 0.5) * 0.12; },
};

function floorTexture(map) {
  const size = Math.round(map.half * 2 * FLOOR_PX);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const W = (x) => (x + map.half) * FLOOR_PX;           // mètres -> pixels

  // motif répété (tuile de 32 px = 4 m)
  const tile = document.createElement('canvas');
  tile.width = tile.height = 32;
  paint(tile.getContext('2d'), map.floor, 32, FLOOR_PATTERNS[map.floorKind] || FLOOR_PATTERNS.grass, 7);
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(0, 0, size, size);

  // zones peintes (terre battue, dalles…) déclarées par la carte
  for (const z of map.patches || []) {
    const pt = document.createElement('canvas');
    pt.width = pt.height = 32;
    paint(pt.getContext('2d'), z.color, 32, FLOOR_PATTERNS[z.kind] || FLOOR_PATTERNS.dirt, 11);
    g.fillStyle = g.createPattern(pt, 'repeat');
    g.fillRect(W(z.x0), W(z.z0), (z.x1 - z.x0) * FLOOR_PX, (z.z1 - z.z0) * FLOOR_PX);
  }

  // routes : asphalte + trottoirs + pointillés au centre
  const roads = map.boxes.filter((b) => b.c === 'road');
  if (roads.length) {
    const at = document.createElement('canvas');
    at.width = at.height = 32;
    paint(at.getContext('2d'), COLORS.road, 32, FLOOR_PATTERNS.asphalt, 3);
    const asphalt = g.createPattern(at, 'repeat');
    for (const b of roads) {                              // trottoirs (un peu plus larges que la chaussée)
      g.fillStyle = '#8d8f94';
      g.fillRect(W(b.x0) - 6, W(b.z0) - 6, (b.x1 - b.x0) * FLOOR_PX + 12, (b.z1 - b.z0) * FLOOR_PX + 12);
    }
    for (const b of roads) { g.fillStyle = asphalt; g.fillRect(W(b.x0), W(b.z0), (b.x1 - b.x0) * FLOOR_PX, (b.z1 - b.z0) * FLOOR_PX); }
    g.fillStyle = '#e6d9a8';
    for (const b of roads) {
      const alongX = b.x1 - b.x0 > b.z1 - b.z0;
      const mid = alongX ? (b.z0 + b.z1) / 2 : (b.x0 + b.x1) / 2;
      const [a0, a1] = alongX ? [b.x0, b.x1] : [b.z0, b.z1];
      for (let t = a0 + 1; t < a1 - 2; t += 4) {
        // pas de pointillés dans les carrefours
        const cross = roads.some((o) => o !== b && (alongX ? t + 1 > o.x0 && t < o.x1 : t + 1 > o.z0 && t < o.z1) && (alongX ? o.z1 - o.z0 > o.x1 - o.x0 : o.x1 - o.x0 > o.z1 - o.z0));
        if (cross) continue;
        if (alongX) g.fillRect(W(t), W(mid) - 1, 2 * FLOOR_PX, 2);
        else g.fillRect(W(mid) - 1, W(t), 2, 2 * FLOOR_PX);
      }
    }
  }

  // ombres : masque noir (pied des murs + ombre portée à l'opposé du soleil), flouté puis posé en une fois
  const m = document.createElement('canvas');
  m.width = m.height = size;
  const mg = m.getContext('2d');
  mg.fillStyle = '#000';
  const big = map.half * map.half * 2;
  for (const b of map.boxes) {
    if (b.c === 'road' || b.y1 <= 0.05) continue;
    if ((b.x1 - b.x0) * (b.z1 - b.z0) > big) continue;   // plafond d'une carte intérieure
    const pad = 0.25;
    if (b.y0 < 0.2) mg.fillRect(W(b.x0 - pad), W(b.z0 - pad), (b.x1 - b.x0 + 2 * pad) * FLOOR_PX, (b.z1 - b.z0 + 2 * pad) * FLOOR_PX);
    if (map.indoor) continue;
    // ombre portée : on balaie l'empreinte de la boîte de sa base à son sommet, décalée à l'opposé du soleil
    const steps = Math.max(2, Math.ceil((b.y1 - b.y0) * 2));
    for (let i = 0; i <= steps; i++) {
      const h = b.y0 + ((b.y1 - b.y0) * i) / steps;
      const dx = (-SUN.x / SUN.y) * h * 0.7, dz = (-SUN.z / SUN.y) * h * 0.7;
      mg.fillRect(W(b.x0 + dx), W(b.z0 + dz), (b.x1 - b.x0) * FLOOR_PX, (b.z1 - b.z0) * FLOOR_PX);
    }
  }
  g.save();
  g.globalAlpha = map.indoor ? 0.45 : 0.3;
  try { g.filter = `blur(${FLOOR_PX * 0.35}px)`; } catch { /* navigateur sans filtre : ombres nettes */ }
  g.drawImage(m, 0, 0);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- fusion des boîtes par matériau ----
// Le build three.js allégé n'exporte pas BufferAttribute : on récupère Float32BufferAttribute sur une BoxGeometry.
const Attr = new THREE.BoxGeometry(1, 1, 1).attributes.position.constructor;

function mergedBoxes(list, tile = 2) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  for (const b of list) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
    const g = new THREE.BoxGeometry(w, h, d);
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];   // +x -x +y -y +z -z
    // teinte propre à chaque boîte (±5 %) : casse la répétition
    const tint = 0.95 + (((Math.abs(cx * 13.1 + cz * 7.3 + cy * 3.7) * 1000) | 0) % 100) / 1000;
    const base = pos.length / 3;
    for (let i = 0; i < P.count; i++) {
      const y = P.getY(i) + cy, ny = N.getY(i);
      pos.push(P.getX(i) + cx, y, P.getZ(i) + cz);
      nor.push(N.getX(i), ny, N.getZ(i));
      const f = Math.floor(i / 4);
      // uv : un pixel de texture = même taille partout ; les faces verticales partent du sol (briques alignées)
      const u = (U.getX(i) * dims[f][0]) / tile + (f < 2 ? b.z0 : b.x0) / tile;
      const v = f === 2 || f === 3 ? (U.getY(i) * dims[f][1]) / tile + b.z0 / tile : (U.getY(i) * h + b.y0) / tile;
      uv.push(u, v);
      // ombre de contact : bas des faces verticales assombri quand la boîte touche le sol, dessous sombre
      let k = 1;
      if (ny < -0.5) k = 0.55;
      else if (Math.abs(ny) < 0.5 && y - b.y0 < 0.01) k = b.y0 < 0.05 ? 0.62 : 0.8;
      k *= tint;
      col.push(k, k, k);
    }
    const I = g.index;
    for (let i = 0; i < I.count; i++) idx.push(I.getX(i) + base);
    g.dispose();
  }
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.setAttribute('position', new Attr(new Float32Array(pos), 3));
  geo.setAttribute('normal', new Attr(new Float32Array(nor), 3));
  geo.setAttribute('uv', new Attr(new Float32Array(uv), 2));
  geo.setAttribute('color', new Attr(new Float32Array(col), 3));
  geo.setIndex(idx);   // tableau simple : three.js choisit Uint16 ou Uint32 (Attr, lui, convertirait en flottants)
  geo.clearGroups();
  geo.computeBoundingSphere();
  return geo;
}

export function createWorld(scene) {
  scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x556644, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(SUN.x, SUN.y, SUN.z);
  scene.add(sun);

  const mats = {};
  for (const [k, hex] of Object.entries(COLORS)) mats[k] = new THREE.MeshLambertMaterial({ map: materialTexture(k, hex), vertexColors: true });

  let current = null;
  // Construit (ou reconstruit) le décor d'une carte : ciel, brouillard, sol et boîtes
  function load(map) {
    if (current) {
      scene.remove(current);
      current.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      current.userData.floorMat?.map?.dispose();
      current.userData.floorMat?.dispose();
    }
    scene.background = new THREE.Color(map.sky);
    scene.fog = new THREE.Fog(map.sky, map.fog[0], map.fog[1]);

    const group = new THREE.Group();
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTexture(map) });
    group.userData.floorMat = floorMat;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.half * 2, map.half * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);

    const byMat = new Map();
    for (const b of map.boxes) {
      if (b.c === 'road') continue;                        // peinte dans le sol
      const k = mats[b.c] ? b.c : 'wall';
      if (!byMat.has(k)) byMat.set(k, []);
      byMat.get(k).push(b);
    }
    for (const [k, list] of byMat) group.add(new THREE.Mesh(mergedBoxes(list), mats[k]));
    scene.add(group);
    current = group;
  }
  return { load };
}
