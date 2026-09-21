// Carte unique, symétrique, faite uniquement de boîtes alignées sur les axes.
// Le client s'en sert pour dessiner + collisions, le serveur pour bloquer les tirs.
// Repère : X = droite, Y = haut, Z = profondeur. Rouge en z<0, Bleu en z>0.

export const HALF = 30; // la zone de jeu va de -30 à +30 sur X et Z

export const BOXES = [];

// cx,cz = centre ; w = taille en X ; d = taille en Z ; h = hauteur ; y0 = base
function add(cx, cz, w, d, h, y0 = 0, c = 'crate') {
  BOXES.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + h, c });
}

// Répète un bloc dans les 4 quadrants (miroir en X et Z).
function mirror4(cx, cz, w, d, h, y0 = 0, c = 'crate') {
  for (const sx of [1, -1]) {
    if (cx === 0 && sx === -1) continue;
    for (const sz of [1, -1]) {
      if (cz === 0 && sz === -1) continue;
      add(cx * sx, cz * sz, w, d, h, y0, c);
    }
  }
}

// --- Murs d'enceinte ---
add(0, -HALF - 0.5, 2 * HALF + 2, 1, 6, 0, 'wall');
add(0, HALF + 0.5, 2 * HALF + 2, 1, 6, 0, 'wall');
add(-HALF - 0.5, 0, 1, 2 * HALF + 2, 6, 0, 'wall');
add(HALF + 0.5, 0, 1, 2 * HALF + 2, 6, 0, 'wall');

// --- Plateforme centrale (haut 1.5) avec escaliers sur les côtés X ---
add(0, 0, 6, 6, 1.5, 0, 'platform');
for (const s of [1, -1]) {
  add(s * 3.75, 0, 1.5, 3, 1.0, 0, 'stairs');
  add(s * 5.25, 0, 1.5, 3, 0.5, 0, 'stairs');
}

// --- Tours de sniper (haut 3.0) sur les flancs, escalier côté centre ---
for (const s of [1, -1]) {
  add(s * 24, 0, 6, 9, 3.0, 0, 'platform');
  add(s * 24, 4.25, 6, 0.5, 1.0, 3.0, 'wall'); // rebords
  add(s * 24, -4.25, 6, 0.5, 1.0, 3.0, 'wall');
  for (let i = 0; i < 5; i++) {
    add(s * (20.4 - i * 1.2), 0, 1.2, 3, 2.5 - i * 0.5, 0, 'stairs');
  }
}

// --- Décor répété dans chaque quadrant ---
mirror4(10, 6, 2, 2, 2, 0, 'crate');          // grosse caisse
mirror4(5, 9, 1.2, 1.2, 1.2, 0, 'crateDark'); // petites caisses sautables
mirror4(6.3, 9, 1.2, 1.2, 1.2, 0, 'crateDark');
mirror4(12, 3, 6, 0.6, 1.0, 0, 'low');        // muret bas
mirror4(3.5, 14, 5, 0.6, 1.0, 0, 'low');
mirror4(16, 10, 8, 0.8, 2.4, 0, 'wall');      // long mur
mirror4(8, 17, 0.8, 6, 2.4, 0, 'wall');       // mur en profondeur
mirror4(14, 18, 1.2, 1.2, 4, 0, 'pillar');    // pilier
mirror4(22, 20, 3, 3, 2.4, 0, 'stone');       // bloc

// --- Points d'apparition ---
// team: 'red' | 'blue' | null (null = utilisé seulement hors mode équipe)
// yaw : 0 regarde vers -Z, PI regarde vers +Z
export const SPAWNS = [];
for (const x of [-22, -11, 0, 11, 22]) {
  SPAWNS.push({ x, z: -26, yaw: Math.PI, team: 'red' });
  SPAWNS.push({ x, z: 26, yaw: 0, team: 'blue' });
}
for (const sx of [1, -1]) {
  for (const sz of [1, -1]) {
    SPAWNS.push({ x: sx * 27, z: sz * 16, yaw: sx > 0 ? Math.PI / 2 : -Math.PI / 2, team: null });
  }
}
