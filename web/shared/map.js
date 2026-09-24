// Cartes : uniquement des boîtes alignées sur les axes.
// Le client s'en sert pour dessiner + collisions, le serveur pour bloquer les tirs et placer les joueurs.
// Repère : X = droite, Y = haut, Z = profondeur. Rouge en z<0, Bleu en z>0.
// yaw : 0 regarde vers -Z, PI regarde vers +Z.

// Outils communs pour construire une carte
function builder(half) {
  const boxes = [];
  // cx,cz = centre ; w = taille en X ; d = taille en Z ; h = hauteur ; y0 = base
  const add = (cx, cz, w, d, h, y0 = 0, c = 'crate') => {
    boxes.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, c });
  };
  // Même boîte, mais avec des bornes (x0,x1,z0,z1) — pratique pour les murs de maisons
  const span = (x0, x1, z0, z1, y0, y1, c = 'wall') => { boxes.push({ x0, x1, z0, z1, y0, y1, c }); };
  // Répète un bloc dans les 4 quadrants (miroir en X et Z).
  const mirror4 = (cx, cz, w, d, h, y0 = 0, c = 'crate') => {
    for (const sx of [1, -1]) {
      if (cx === 0 && sx === -1) continue;
      for (const sz of [1, -1]) {
        if (cz === 0 && sz === -1) continue;
        add(cx * sx, cz * sz, w, d, h, y0, c);
      }
    }
  };
  // Murs d'enceinte
  const enclose = (h = 6, c = 'wall') => {
    add(0, -half - 0.5, 2 * half + 2, 1, h, 0, c);
    add(0, half + 0.5, 2 * half + 2, 1, h, 0, c);
    add(-half - 0.5, 0, 1, 2 * half + 2, h, 0, c);
    add(half + 0.5, 0, 1, 2 * half + 2, h, 0, c);
  };
  // Mur percé de trous (portes, fenêtres) : axis 'x' = mur le long de X à z=fixed, 'z' = le long de Z à x=fixed.
  // holes : [{ a, b, y0, y1 }] (intervalle le long du mur + hauteurs de l'ouverture)
  const wall = (axis, fixed, t0, t1, h, holes = [], c = 'wall', th = 0.4) => {
    const put = (a, b, y0, y1) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      if (axis === 'x') span(a, b, fixed - th / 2, fixed + th / 2, y0, y1, c);
      else span(fixed - th / 2, fixed + th / 2, a, b, y0, y1, c);
    };
    let cur = t0;
    for (const o of [...holes].sort((p, q) => p.a - q.a)) {
      put(cur, o.a, 0, h);
      put(o.a, o.b, 0, o.y0);
      put(o.a, o.b, o.y1, h);
      cur = o.b;
    }
    put(cur, t1, 0, h);
  };
  return { boxes, add, span, mirror4, enclose, wall };
}

// ---------------------------------------------------------------- Arène (petite) ----
function buildArena() {
  const half = 30; // la zone de jeu va de -30 à +30 sur X et Z
  const { boxes, add, mirror4, enclose } = builder(half);
  enclose(6);

  // Plateforme centrale (haut 1.5) avec escaliers sur les côtés X
  add(0, 0, 6, 6, 1.5, 0, 'platform');
  for (const s of [1, -1]) {
    add(s * 3.75, 0, 1.5, 3, 1.0, 0, 'stairs');
    add(s * 5.25, 0, 1.5, 3, 0.5, 0, 'stairs');
  }

  // Tours de sniper (haut 3.0) sur les flancs, escalier côté centre
  for (const s of [1, -1]) {
    add(s * 24, 0, 6, 9, 3.0, 0, 'platform');
    add(s * 24, 4.25, 6, 0.5, 1.0, 3.0, 'wall'); // rebords
    add(s * 24, -4.25, 6, 0.5, 1.0, 3.0, 'wall');
    for (let i = 0; i < 5; i++) add(s * (20.4 - i * 1.2), 0, 1.2, 3, 2.5 - i * 0.5, 0, 'stairs');
  }

  // Décor répété dans chaque quadrant
  mirror4(10, 6, 2, 2, 2, 0, 'crate');          // grosse caisse
  mirror4(5, 9, 1.2, 1.2, 1.2, 0, 'crateDark'); // petites caisses sautables
  mirror4(6.3, 9, 1.2, 1.2, 1.2, 0, 'crateDark');
  mirror4(12, 3, 6, 0.6, 1.0, 0, 'low');        // muret bas
  mirror4(3.5, 14, 5, 0.6, 1.0, 0, 'low');
  mirror4(16, 10, 8, 0.8, 2.4, 0, 'wall');      // long mur
  mirror4(8, 17, 0.8, 6, 2.4, 0, 'wall');       // mur en profondeur
  mirror4(14, 18, 1.2, 1.2, 4, 0, 'pillar');    // pilier
  mirror4(22, 20, 3, 3, 2.4, 0, 'stone');       // bloc

  // Points d'apparition. team: 'red' | 'blue' | null (null = utilisé seulement hors mode équipe)
  const spawns = [];
  for (const x of [-22, -11, 0, 11, 22]) {
    spawns.push({ x, z: -26, yaw: Math.PI, team: 'red' });
    spawns.push({ x, z: 26, yaw: 0, team: 'blue' });
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      spawns.push({ x: sx * 27, z: sz * 16, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2, team: null });
    }
  }

  return {
    id: 'arena', name: 'Arène', desc: 'Petite carte symétrique, combats rapprochés',
    half, boxes, spawns, interiors: [],
    sky: '#9ec9f0', fog: [30, 95], floor: '#5d7f4a',
  };
}

export const DEFAULT_MAP = 'arena';
export const mapById = (id) => (typeof id === 'string' && Object.hasOwn(MAPS, id) ? MAPS[id] : MAPS[DEFAULT_MAP]);

// ---------------------------------------------------------------- Village (grande) ----
function buildVillage() {
  const half = 46;
  const { boxes, add, span, mirror4, enclose, wall } = builder(half);
  enclose(5, 'fence');
  const interiors = [];
  const DOOR = 1.6, WIN = 1.2;

  // Maison rectangulaire (centre cx,cz ; taille w x d ; hauteur 3) avec une porte par face indiquée et des fenêtres.
  // doors : sous-ensemble de 'n' (z-), 's' (z+), 'w' (x-), 'e' (x+)
  function house(cx, cz, w, d, doors, c = 'brick') {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, h = 3;
    const openings = (len, mid, door) => {
      const holes = [];
      if (door) holes.push({ a: mid - DOOR / 2, b: mid + DOOR / 2, y0: 0, y1: 2.3 });
      for (const f of [-0.3, 0.3]) {
        const m = mid + f * len;
        if (!door || Math.abs(f * len) > DOOR / 2 + WIN) holes.push({ a: m - WIN / 2, b: m + WIN / 2, y0: 1.0, y1: 2.0 });
      }
      return holes;
    };
    wall('x', z0, x0, x1, h, openings(w, cx, doors.includes('n')), c);
    wall('x', z1, x0, x1, h, openings(w, cx, doors.includes('s')), c);
    wall('z', x0, z0, z1, h, openings(d, cz, doors.includes('w')), c);
    wall('z', x1, z0, z1, h, openings(d, cz, doors.includes('e')), c);
    span(x0 - 0.3, x1 + 0.3, z0 - 0.3, z1 + 0.3, h, h + 0.35, 'roof'); // toit
    interiors.push({ x0, x1, z0, z1 });
    return { x0, x1, z0, z1 };
  }

  // Grande maison à côté du centre + sa moitié miroir : porte côté centre et côté cour
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const r = house(sx * 17, sz * 15, 10, 8, [sz > 0 ? 'n' : 's', sx > 0 ? 'w' : 'e'], 'brick');
      // mobilier : table + caisse dans la maison
      add(sx * 17, sz * 15, 1.6, 0.9, 0.85, 0, 'wood');
      add(sx * 20, sz * 17, 1, 1, 1, 0, 'crateDark');
      // petite maison plus loin, crépi clair
      house(sx * 34, sz * 9, 7, 6, [sx > 0 ? 'w' : 'e', sz > 0 ? 'n' : 's'], 'plaster');
      add(sx * 34, sz * 9, 1.2, 0.8, 0.85, 0, 'wood');
      // remise près du mur du fond
      house(sx * 29, sz * 35, 6, 5, [sz > 0 ? 'n' : 's'], 'brickDark');
    }
  }

  // Place centrale : puits en pierre + quelques caisses
  add(0, 0, 4, 4, 1.0, 0, 'stone');
  add(0, 0, 1.6, 1.6, 2.0, 1.0, 'stone');
  mirror4(6, 5, 1.4, 1.4, 1.2, 0, 'crate');
  mirror4(9, 0.01, 1.2, 1.2, 1.2, 0, 'crateDark');

  // Tours de guet en bois sur les flancs (haut 3), escalier côté centre
  for (const s of [1, -1]) {
    add(s * 42, 0, 6, 8, 3.0, 0, 'wood');
    add(s * 42, 3.75, 6, 0.5, 1.0, 3.0, 'fence');
    add(s * 42, -3.75, 6, 0.5, 1.0, 3.0, 'fence');
    for (let i = 0; i < 5; i++) add(s * (38.4 - i * 1.2), 0, 1.2, 3, 2.5 - i * 0.5, 0, 'stairs');
  }

  // Clôtures basses (sautables), buissons, murets, pilier de l'église en ruine
  mirror4(8, 25, 8, 0.4, 1.0, 0, 'fence');
  mirror4(26, 22, 0.4, 8, 1.0, 0, 'fence');
  mirror4(12, 33, 2.4, 2.4, 1.3, 0, 'bush');
  mirror4(40, 20, 2.4, 2.4, 1.3, 0, 'bush');
  mirror4(24, 3, 5, 0.6, 1.0, 0, 'low');
  mirror4(4, 38, 6, 0.8, 2.4, 0, 'concrete');   // muret de fond
  mirror4(22, 28, 1.2, 1.2, 3.6, 0, 'pillar');
  mirror4(15, 4, 3, 0.8, 1.8, 0, 'metal');      // conteneur bas

  // Apparitions : équipes aux deux bouts (rouge z<0, bleu z>0), les autres modes utilisent les 4 coins de la place
  const spawns = [];
  for (const x of [-32, -16, 0, 16, 32]) {
    spawns.push({ x, z: -42, yaw: Math.PI, team: 'red' });
    spawns.push({ x, z: 42, yaw: 0, team: 'blue' });
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) spawns.push({ x: sx * 44, z: sz * 20, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2, team: null });
  }

  return {
    id: 'village', name: 'Village', desc: 'Grande carte : maisons à traverser, tours de guet, places ouvertes',
    half, boxes, spawns, interiors,
    sky: '#b8d8f0', fog: [45, 130], floor: '#7a9a55',
  };
}

// ---------------------------------------------------------------- Entrepôt (petite, intérieure) ----
function buildWarehouse() {
  const half = 26;
  const { boxes, add, mirror4, enclose, wall } = builder(half);
  enclose(7, 'concrete');
  add(0, 0, 2 * half + 2, 2 * half + 2, 0.5, 7, 'roof');   // plafond

  // Bureau central : 4 murs percés de portes + toit
  const o = 4.2;
  for (const s of [1, -1]) {
    wall('x', s * o, -o, o, 3, [{ a: -0.8, b: 0.8, y0: 0, y1: 2.3 }], 'plaster');
    wall('z', s * o, -o, o, 3, [{ a: -0.8, b: 0.8, y0: 0, y1: 2.3 }], 'plaster');
  }
  add(0, 0, 9.2, 9.2, 0.35, 3, 'roof');
  add(0, 0, 1.6, 0.9, 0.85, 0, 'wood');

  // Passerelles surélevées (haut 3) sur les côtés, escaliers aux deux bouts, garde-corps côté mur
  for (const sx of [1, -1]) {
    add(sx * 21, 0, 5, 24, 3.0, 0, 'platform');
    add(sx * 23.75, 0, 0.5, 24, 1.0, 3.0, 'fence');
    for (const sz of [1, -1]) {
      for (let j = 1; j <= 6; j++) add(sx * 21, sz * (12 + (7 - j) - 0.5), 3, 1, 0.5 * j, 0, 'stairs');
    }
  }

  // Conteneurs, étagères, caisses, piliers (symétriques)
  mirror4(8, 15, 6, 2.5, 2.6, 0, 'metal');
  mirror4(13, 6.5, 2.5, 6, 2.6, 0, 'metal');
  mirror4(4, 8.5, 0.8, 7, 2.2, 0, 'crateDark');
  mirror4(6, 3, 1.2, 1.2, 1.2, 0, 'crate');
  mirror4(16, 10, 1.2, 1.2, 1.2, 0, 'crate');
  mirror4(2, 19, 2, 2, 2, 0, 'crate');
  mirror4(12, 12, 1.2, 1.2, 7, 0, 'pillar');
  mirror4(17, 17.5, 1.2, 1.2, 7, 0, 'pillar');
  mirror4(10, 21, 4, 0.6, 1.0, 0, 'low');

  const spawns = [];
  for (const x of [-16, -8, 0, 8, 16]) {
    spawns.push({ x, z: -22, yaw: Math.PI, team: 'red' });
    spawns.push({ x, z: 22, yaw: 0, team: 'blue' });
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) spawns.push({ x: sx * 15, z: sz * 2, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2, team: null });
  }

  return {
    id: 'warehouse', name: 'Entrepôt', desc: 'Petite carte intérieure : conteneurs, couloirs et passerelles',
    half, boxes, spawns, interiors: [],
    sky: '#23262c', fog: [10, 48], floor: '#57575c',
  };
}

// ---------------------------------------------------------------- Quartier (très grande, multi ou survie) ----
function buildCity() {
  const half = 64;
  const { boxes, add, span, mirror4, enclose, wall } = builder(half);
  enclose(6, 'concrete');
  const interiors = [];
  const DOOR = 1.8, WIN = 1.4;

  // Immeuble (une pièce, hauteur 3,4) : portes sur les faces indiquées ('n' z-, 's' z+, 'w' x-, 'e' x+), fenêtres, toit
  function building(cx, cz, w, d, doors, c = 'brick') {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, h = 3.4;
    const openings = (len, mid, door) => {
      const holes = [];
      if (door) holes.push({ a: mid - DOOR / 2, b: mid + DOOR / 2, y0: 0, y1: 2.4 });
      for (const f of [-0.3, 0.3]) {
        const m = mid + f * len;
        if (!door || Math.abs(f * len) > DOOR / 2 + WIN) holes.push({ a: m - WIN / 2, b: m + WIN / 2, y0: 1.0, y1: 2.0 });
      }
      return holes;
    };
    wall('x', z0, x0, x1, h, openings(w, cx, doors.includes('n')), c);
    wall('x', z1, x0, x1, h, openings(w, cx, doors.includes('s')), c);
    wall('z', x0, z0, z1, h, openings(d, cz, doors.includes('w')), c);
    wall('z', x1, z0, z1, h, openings(d, cz, doors.includes('e')), c);
    span(x0 - 0.3, x1 + 0.3, z0 - 0.3, z1 + 0.3, h, h + 0.35, 'roof');
    add(cx, cz, 1.8, 0.9, 0.85, 0, 'wood');           // table
    interiors.push({ x0, x1, z0, z1 });
  }

  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      building(sx * 24, sz * 24, 14, 12, [sz > 0 ? 'n' : 's', sx > 0 ? 'w' : 'e'], 'brick');
      building(sx * 48, sz * 24, 12, 14, [sx > 0 ? 'w' : 'e', sz > 0 ? 'n' : 's'], 'plaster');
      building(sx * 24, sz * 48, 14, 10, [sz > 0 ? 'n' : 's'], 'brickDark');
      building(sx * 48, sz * 48, 12, 12, [sx > 0 ? 'w' : 'e'], 'concrete');
    }
  }
  for (const s of [1, -1]) {
    building(s * 42, 0, 12, 16, [s > 0 ? 'w' : 'e', 'n', 's'], 'brick');
    building(0, s * 41, 16, 12, [s > 0 ? 'n' : 's', 'w', 'e'], 'plaster');
  }

  // Rues (cosmétique, sans collision) : quadrillage complet dans les couloirs dégagés entre les immeubles
  // (jamais sous un bâtiment, sinon la route se voit traverser les murs à l'intérieur)
  const STREET_LINES = [-59, -12.5, 12.5, 59];
  for (const v of STREET_LINES) {
    add(v, 0, 6, 2 * half + 2, 0.05, -0.05, 'road');   // rue nord-sud (le long de Z, à x=v)
    add(0, v, 2 * half + 2, 6, 0.05, -0.05, 'road');   // rue est-ouest (le long de X, à z=v)
  }
  // Lampadaires au coin des croisements intérieurs (décalés du centre pour ne pas gêner les voitures)
  for (const x of [-12.5, 12.5]) for (const z of [-12.5, 12.5]) add(x + (x > 0 ? 2.2 : -2.2), z + (z > 0 ? 2.2 : -2.2), 0.3, 0.3, 3.2, 0, 'pillar');

  // Place centrale : monument, murets, buissons
  add(0, 0, 6, 6, 1.0, 0, 'stone');
  add(0, 0, 2, 2, 2.6, 1.0, 'stone');
  mirror4(8, 8, 3, 0.6, 1.0, 0, 'low');
  mirror4(13, 13, 2.4, 2.4, 1.3, 0, 'bush');

  // Voitures abandonnées, barricades, caisses (pour se couvrir dans les rues)
  mirror4(9, 14, 4.2, 1.9, 1.5, 0, 'metal');
  mirror4(14, 7, 1.9, 4.2, 1.5, 0, 'metal');
  mirror4(36, 11, 4.2, 1.9, 1.5, 0, 'metal');
  mirror4(11, 34, 1.9, 4.2, 1.5, 0, 'metal');
  mirror4(36, 36, 4, 0.6, 1.0, 0, 'concrete');
  mirror4(36, 30, 0.6, 4, 1.0, 0, 'concrete');
  mirror4(30, 36, 0.6, 4, 1.0, 0, 'concrete');
  mirror4(58, 12, 1.6, 1.6, 1.6, 0, 'crate');
  mirror4(12, 52, 1.6, 1.6, 1.6, 0, 'crateDark');
  mirror4(58, 36, 2.4, 2.4, 1.3, 0, 'bush');
  mirror4(36, 58, 2.4, 2.4, 1.3, 0, 'bush');
  mirror4(20, 4, 1.2, 1.2, 4.5, 0, 'pillar');

  const spawns = [];
  for (const x of [-24, -12, 0, 12, 24]) {
    spawns.push({ x, z: -58, yaw: Math.PI, team: 'red' });
    spawns.push({ x, z: 58, yaw: 0, team: 'blue' });
  }
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) spawns.push({ x: sx * 58, z: sz * 30, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2, team: null });
  }
  // Points d'apparition des monstres en survie : tout le pourtour
  const mobSpawns = [
    [-58, -58], [58, -58], [-58, 58], [58, 58], [-58, 0], [58, 0], [0, -58], [-30, -58], [30, -58], [-58, -30], [58, -30], [-58, 30], [58, 30],
  ].map(([x, z]) => ({ x, z }));

  return {
    id: 'city', name: 'Quartier', desc: 'Très grande carte : rues, immeubles et place centrale (multi et survie)',
    half, boxes, spawns, mobSpawns, interiors,
    sky: '#a9c4dd', fog: [60, 170], floor: '#6b6e75',
  };
}

export const MAPS = { arena: buildArena(), village: buildVillage(), warehouse: buildWarehouse(), city: buildCity() };
