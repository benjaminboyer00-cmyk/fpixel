// Constantes partagées entre le client (navigateur) et le serveur (Node).

export const TICK_MS = 50;            // un snapshot toutes les 50 ms (20 Hz)
export const INTERP_MS = 100;         // les autres joueurs sont affichés 100 ms "dans le passé"
export const REWIND_MAX_MS = 400;     // compensation de lag maximale côté serveur
export const MAX_RAY = 200;

export const EYE_HEIGHT = 1.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;
export const MAX_HP = 100;

export const RESPAWN_MS = 3000;
export const SPAWN_PROTECT_MS = 2000;
export const REGEN_DELAY_MS = 5000;
export const REGEN_PER_S = 12;
export const END_SCREEN_MS = 8000;

export const WALK_SPEED = 6.5;
export const JUMP_SPEED = 7.8;
export const GRAVITY = 24;
export const STEP_HEIGHT = 0.55;

// Hitboxes (relatives aux pieds du joueur)
export const BODY_HALF = 0.35;
export const BODY_TOP = 1.4;
export const HEAD_HALF = 0.25;
export const HEAD_TOP = 1.85;

export const MODES = {
  duel: { id: 'duel', label: '1v1', desc: 'Duel, premier à 10 frags', max: 2, fill: 2, killLimit: 10, teams: false },
  tdm: { id: 'tdm', label: 'Match à mort par équipe', desc: 'Rouge contre Bleu, 30 frags', max: 10, fill: 8, killLimit: 30, teams: true },
  ffa: { id: 'ffa', label: 'Chacun pour soi', desc: 'Tous contre tous, 20 frags', max: 10, fill: 6, killLimit: 20, teams: false },
};

// Index = touche du clavier (1..5). "range" = portée max en mètres (mêlée uniquement).
// falloff = [début, fin, multiplicateur minimum]
export const WEAPONS = [
  {
    id: 'ar', name: "Fusil d'assaut", key: '1', auto: true, interval: 100,
    dmg: 20, headMul: 1.5, pellets: 1, spread: 0.014,
    mag: 30, reload: 1900, falloff: [35, 90, 0.6], speed: 1.0, recoil: 0.5,
  },
  {
    id: 'shotgun', name: 'Fusil à pompe', key: '2', auto: false, interval: 850,
    dmg: 13, headMul: 1.0, pellets: 8, spread: 0.065,
    mag: 6, reload: 2400, falloff: [6, 22, 0.2], speed: 1.02, recoil: 1.6,
  },
  {
    id: 'sniper', name: 'Sniper', key: '3', auto: false, interval: 1400,
    dmg: 100, headMul: 2.0, pellets: 1, spread: 0.09, scopeSpread: 0,
    mag: 4, reload: 2800, falloff: null, speed: 0.92, recoil: 2.2, zoom: 22,
  },
  {
    id: 'revolver', name: 'Revolver', key: '4', auto: false, interval: 480,
    dmg: 52, headMul: 2.0, pellets: 1, spread: 0.004,
    mag: 6, reload: 2000, falloff: [40, 90, 0.7], speed: 1.0, recoil: 1.2,
  },
  {
    id: 'knife', name: 'Couteau', key: '5', auto: false, interval: 420,
    dmg: 50, headMul: 1.0, pellets: 1, spread: 0, melee: true, range: 2.4, backstab: 100,
    mag: 0, reload: 0, falloff: null, speed: 1.15, recoil: 0,
  },
];

export const TEAM_COLORS = { red: '#e5484d', blue: '#3e82f7' };
export const FFA_COLORS = ['#e5484d', '#f5a524', '#f5d90a', '#46a758', '#12a594', '#3e82f7', '#8e4ec6', '#e93d82', '#a18072', '#889096'];
