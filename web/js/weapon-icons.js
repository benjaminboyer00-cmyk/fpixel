// Icônes pixel art des armes (vue de profil, canon vers la droite), dessinées à la main sur une grille 24×12.
// Aucun rendu WebGL : chaque icône est un SVG de rectangles, généré une fois puis mis en cache. Même style que le
// reste de l'interface (aplats, contour noir, ombre dure), donc net à toutes les tailles avec image-rendering: pixelated.
//
// Lettres : . vide  k contour  G métal sombre  g métal  L métal clair  w bois  y jaune  r rouge  b bleu  c cyan
//           o orange  e vert  p violet  W blanc  d gris foncé (ombre)  n crème (papier)
import { skinColor } from '../shared/skins.js';
const PAL = {
  k: '#0a0d12', G: '#3b4453', g: '#6b7686', L: '#a3adbd', w: '#a06b3a', y: '#ffb703', r: '#e5484d', b: '#3e82f7',
  c: '#4fd1e0', o: '#ff7a1a', e: '#46a758', p: '#8e4ec6', W: '#f4f6f8', d: '#222831', n: '#efe7d2',
};

// Chaque arme : 12 lignes de 24 caractères.
const ART = {
  ar: [
    '........................',
    '........................',
    '..........kkkkkk........',
    '.kkkkkkkkkLLLLLLkkkkkkk.',
    'kGGGGGGGGGGGGGGGGGgggggk',
    'kGGGGGGGGGGGGGGGGGkkkkkk',
    'kkkkkkkkkGGkkkkkkGGk....',
    '.....kGGk.kGGk..kkkk....',
    '.....kGGk..kGGk.........',
    '.....kkkk..kkkk.........',
    '........................',
    '........................',
  ],
  shotgun: [
    '........................',
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'kwwwwwwkgggggggggggggggk',
    'kwwwwwwkGGGGGGGGGGGGGGGk',
    'kkkkkkkkkkwwwwwwkkkkkkk.',
    '....kGGk.kwwwwwwk.......',
    '....kGGk.kkkkkkkk.......',
    '....kkkk................',
    '........................',
    '........................',
  ],
  sniper: [
    '........................',
    '.......kkkkkkk..........',
    '.......kcccccck.........',
    '.kkkkkkkkkkkkkkkkkkkkkkk',
    'kGGGGGGGGGGGGGGGgggggggk',
    'kGGGGGGGGGGGGGGGkkkkkkkk',
    'kkkkkkkkkGGkkkkkkkk.....',
    '....kGGk.kGGk.kGkGk.....',
    '....kGGk.kkkk.kkkkk.....',
    '....kkkk................',
    '........................',
    '........................',
  ],
  revolver: [
    '........................',
    '........................',
    '........................',
    '.......kkkkkkkkkkkkkkkk.',
    '......kLLLLLLLLggggggggk',
    '......kLLGGGGGkkkkkkkkk.',
    '......kLkGGGGGk.........',
    '.......kkGGGkkk.........',
    '.......kwwwk............',
    '.......kwwwk............',
    '........kkk.............',
    '........................',
  ],
  knife: [
    '........................',
    '........................',
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkk.......',
    'kwwwwwwkLLLLLLLLLkkkkk..',
    'kwwwwwwkLLLLLLLLLLLLLLk.',
    'kkkkkkkkWWWWWWWWWWWkkk..',
    '........kkkkkkkkkkk.....',
    '........................',
    '........................',
    '........................',
  ],
  rocket: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'kggggggggggggggggggkrrrk',
    'kGGGGGGGGGGGGGGGGGGkrrrk',
    'kggggggggggggggggggkrrrk',
    'kkkkkkkkkkkkkkkkkkkkkkk.',
    '.....kGGk...kGGk........',
    '.....kGGk...kkkk........',
    '.....kkkk...............',
    '........................',
    '........................',
  ],
  excalibur: [
    '........................',
    '...........kk...........',
    '..........kWWk..........',
    '..........kWLk..........',
    '..........kWLk..........',
    '..........kWLk..........',
    '..........kWLk..........',
    '.......kkkkyykkkk.......',
    '.......kyyyyyyyyk.......',
    '.......kkkkGGkkkk.......',
    '..........kGGk..........',
    '..........kkkk..........',
  ],
  grapple: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkk..kk..',
    'kGGGGGGGGGGGGGGGGGkkLLk.',
    'kGGGGGGGGGGGGGGGGGLLLLk.',
    'kGGGGGGGGGGGGGGGGGkkkLk.',
    'kkkkkkkkkGGkkkkkkk.kLLk.',
    '.....kGGk.kGGk.....kLk..',
    '.....kGGk.kkkk....kkk...',
    '.....kkkk...............',
    '........................',
    '........................',
  ],
  portal: [
    '........................',
    '........................',
    '.......kkkkkkkkkkk......',
    '......kWWWWWWWWWWWkkkk..',
    '.....kWWWWWWWWWWWWkbbbk.',
    '.....kWWWkkkkkWWWWkookk.',
    '.....kWWk.....kkkkkkkk..',
    '......kkkGGGk...........',
    '.........kGGk...........',
    '.........kGGk...........',
    '.........kkkk...........',
    '........................',
  ],
  minigun: [
    '........................',
    '..kkkkkkkkkkkkkkkkkkkkk.',
    '.kGGGGGGGGkgggggggggggk.',
    '.kGGGGGGGGkGGGGGGGGGGGGk',
    '.kGGGGGGGGkgggggggggggk.',
    '.kGGGGGGGGkGGGGGGGGGGGGk',
    '.kGGGGGGGGkgggggggggggk.',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    '...kGGk.....kGGk........',
    '...kGGk.....kkkk........',
    '...kkkk.................',
    '........................',
  ],
  grenade: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkkkkkk..',
    'kwwwwwkGGGGGGGGGGGGGGGk.',
    'kwwwwwkGGkkkkkkkkkGGGGk.',
    'kwwwwwkGkeeeeeeeekGGGGk.',
    'kkkkkkkkkeeeeeeeekkkkkk.',
    '....kGGk.keeeeeek.......',
    '....kGGk..kkkkkk........',
    '....kkkk................',
    '........................',
    '........................',
  ],
  laser: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkkkk....',
    'kppppppppppppppppppkkkk.',
    'kpccccccccccccccccpkcccW',
    'kppppppppppppppppppkkkk.',
    'kkkkkkkkkppkkkkkkkkk....',
    '....kGGk.kppk...........',
    '....kGGk.kkkk...........',
    '....kkkk................',
    '........................',
    '........................',
  ],
  carbine: [
    '........................',
    '........kkkkk...........',
    '........kcccck..........',
    '.kkkkkkkkkkkkkkkkkkkkkk.',
    'kwwwwwwwGGGGGGGGGgggggkk',
    'kwwwwwwwGGGGGGGGGkkkkkk.',
    'kkkkkkkkkGGkkkkkkk......',
    '....kwwk.kGGk.kwwk......',
    '....kwwk.kkkk.kkkk......',
    '....kkkk................',
    '........................',
    '........................',
  ],
  flame: [
    '........................',
    '........................',
    '.kkkkkkkkkkkkkkkkk......',
    'kGGGGGGGGGGGGGGGGGkkk...',
    'kGrrrrrrrrrGGGGGGGkooko.',
    'kGrrrrrrrrrGGGGGGGkoyyoo',
    'kGGGGGGGGGGGGGGGGGkooko.',
    'kkkkkkkkkkGGkkkkkkkkk...',
    '....kGGk.kGGk...........',
    '....kGGk.kkkk...........',
    '....kkkk................',
    '........................',
  ],
  nuke: [
    '........................',
    '........................',
    '.kk.....kkkkkkkkkkkkkk..',
    '.kGkkkkkGGGGGGGGGGGGGGkk',
    '.kGGGGGGGGkykyGGGGGGGGrk',
    '.kGGGGGGGGyyyyGGGGGGGGrk',
    '.kGGGGGGGGkykyGGGGGGGGrk',
    '.kGkkkkkGGGGGGGGGGGGGGkk',
    '.kk.....kkkkkkkkkkkkkk..',
    '........................',
    '........................',
    '........................',
  ],
  frag: [
    '........................',
    '..........kkkkk.........',
    '.........kLkkkkk........',
    '.........kkeeeek........',
    '........keeeeeeek.......',
    '.......keeeeeeeeek......',
    '.......keekeeeeeek......',
    '.......keeeeeeeeek......',
    '........keeeeeeek.......',
    '.........keeeeek........',
    '..........kkkkk.........',
    '........................',
  ],
  orb: [
    '........................',
    '.kkkkkkkkkkkkkkkkkk.....',
    'kGGGGGGGGGGGGGGGGGGkkk..',
    'kGppppppppppppppGGGkppk.',
    'kGpcccccccccccccpGGkcck.',
    'kGppppppppppppppGGGkppk.',
    'kGGGGGGGGGGGGGGGGGGkkk..',
    'kkkkkkkkkkGGkkkkkkk.....',
    '....kGGk.kGGk...........',
    '....kGGk.kkkk...........',
    '....kkkk................',
    '........................',
  ],
  plane: [
    '........................',
    '......kk................',
    '......knnkk.............',
    '......knnnnkk...........',
    '......knnnnnnkk.........',
    '......knnnnnnnnkkkkkk...',
    '......knnnnnnnnnnnnnnk..',
    '......knnkkkkkkkkkkkk...',
    '......knnk..............',
    '......knnk..............',
    '......kkk...............',
    '........................',
  ],
  raygun: [
    '........................',
    '........................',
    '......kkkkkkkkkkkkkkk...',
    '.....kLLLLLLLLLLLLLLLk..',
    '.....kLeeeeeeeeeLLLLLLk.',
    '.....kLLLLLLLLLLLLLLLk..',
    '......kkkGGGkkkkkkkkk...',
    '.........kGGk...........',
    '.........kGGk...........',
    '.........kkkk...........',
    '........................',
    '........................',
  ],
  ballista: [
    '........................',
    '..............kk........',
    '.............kwwk.......',
    '.kkkkkkkkkkkkkwwkkkkkkk.',
    'kwwwwwwwwGGGGGwwGGggggk.',
    'kwwwwwwwwGGGGGwwGGkkkkk.',
    'kkkkkkkkkGGkkkkwwkkk....',
    '....kwwk.kGGk.kwwk......',
    '....kwwk.kkkk..kk.......',
    '....kkkk................',
    '........................',
    '........................',
  ],
  cheat: [
    '........................',
    '..........kkkkkk........',
    '.........krrrrrrk.......',
    '..kkkkkkkkGGGGGGkkkkkkk.',
    '.kGGrrrrrGGGGGGGGGrrrrrk',
    '.kGGGGGGGGGGGGGGGGkkkkkk',
    '.kkkkkkkkGGGkkkkGGk.....',
    '....kGGk.kGGk..kGGk.....',
    '....kGGk..kGGk.kkkk.....',
    '....kGGk...kGGk.........',
    '....kkkk....kkkk........',
    '........................',
  ],
};

export const ICON_W = 24, ICON_H = 12;

// SVG de l'icône (rectangles fusionnés par lignes pour rester léger). skin : index dans SKINS (contour noir inchangé).
export function weaponSvg(id, skin = 0) {
  const rows = ART[id] || ART.knife;
  let rects = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < ICON_W;) {
      const ch = row[x];
      if (ch === '.' || !PAL[ch]) { x++; continue; }
      let x2 = x + 1;
      while (x2 < ICON_W && row[x2] === ch) x2++;
      const fill = skin && ch !== 'k' ? skinColor(PAL[ch], skin) : PAL[ch];
      rects += `<rect x="${x}" y="${y}" width="${x2 - x}" height="1" fill="${fill}"/>`;
      x = x2;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ICON_W} ${ICON_H}" shape-rendering="crispEdges">${rects}</svg>`;
}

const cache = new Map();
export function weaponIcon(id, skin = 0) {
  const key = `${id}:${skin | 0}`;
  let url = cache.get(key);
  if (!url) { url = `data:image/svg+xml;utf8,${encodeURIComponent(weaponSvg(id, skin | 0))}`; cache.set(key, url); }
  return url;
}

// Élément <img> prêt à l'emploi (largeur en px ; la hauteur suit le ratio 2:1)
export function weaponImg(id, width = 48, className = 'w-icon', skin = 0) {
  const img = document.createElement('img');
  img.className = className; img.alt = ''; img.width = width; img.height = width / 2; img.src = weaponIcon(id, skin); img.draggable = false;
  return img;
}

export const ICON_ART = ART; // exporté pour les tests / l'aperçu
