// Skins d'armes (camouflages) : purement visuels, débloqués par les frags faits avec l'arme.
// La progression est comptée dans le navigateur (pas de compte) : le serveur vérifie seulement qu'un skin existe
// avant de le montrer aux autres. Un skin ne donne aucun avantage, tricher dessus n'a donc pas d'enjeu.
// Chaque skin = 3 teintes (sombre, moyenne, claire) qui remplacent les couleurs d'origine selon leur luminosité.

export const SKINS = [
  { id: 'std', name: 'Standard', need: 0, pal: null },
  { id: 'desert', name: 'Désert', need: 10, pal: ['#5e4a30', '#a8875a', '#dcc592'] },
  { id: 'foret', name: 'Forêt', need: 25, pal: ['#26341f', '#4f6b3a', '#93a563'] },
  { id: 'nuit', name: 'Nuit', need: 50, pal: ['#121828', '#2c3a5c', '#6a82bd'] },
  { id: 'braise', name: 'Braise', need: 100, pal: ['#1c0f0f', '#8a1f1f', '#f0632d'] },
  { id: 'or', name: 'Or', need: 200, pal: ['#6b4a0c', '#c9971c', '#ffe07a'] },
  { id: 'diamant', name: 'Diamant', need: 400, pal: ['#2d6f86', '#7fd3e8', '#effcff'] },
];

export const skinIndex = (id) => Math.max(0, SKINS.findIndex((s) => s.id === id));

// Couleur d'origine -> couleur du skin (même luminosité relative, 3 paliers + légère nuance à l'intérieur du palier)
const cache = new Map();
export function skinColor(hex, skin) {
  const s = SKINS[skin];
  if (!s || !s.pal) return hex;
  const key = `${skin}${hex}`;
  let out = cache.get(key);
  if (out) return out;
  const n = parseInt(hex.length === 4 ? hex.slice(1).split('').map((c) => c + c).join('') : hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const tier = l < 0.16 ? 0 : l < 0.42 ? 1 : 2;
  const base = parseInt(s.pal[tier].slice(1), 16);
  const k = 0.88 + Math.min(0.24, (l - [0, 0.16, 0.42][tier]) * 0.9);   // garde un peu du relief d'origine
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  out = `#${((f((base >> 16) & 255) << 16) | (f((base >> 8) & 255) << 8) | f(base & 255)).toString(16).padStart(6, '0')}`;
  cache.set(key, out);
  return out;
}

// Validation d'un choix de skins envoyé par un client : { indexArme: indexSkin } -> objet propre (skins non standard seulement)
export function cleanSkins(sk, weaponCount) {
  const out = {};
  if (!sk || typeof sk !== 'object' || Array.isArray(sk)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(sk)) {
    if (++n > 64) break;
    const wi = Number(k), si = Number(v);
    if (Number.isInteger(wi) && wi >= 0 && wi < weaponCount && Number.isInteger(si) && si > 0 && si < SKINS.length) out[wi] = si;
  }
  return out;
}
