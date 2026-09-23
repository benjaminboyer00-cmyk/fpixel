// Constantes partagées entre le client (navigateur) et le serveur (Node).

export const TICK_MS = 33;            // un snapshot toutes les 33 ms (30 Hz)
export const INTERP_MS = 100;         // retard d'affichage initial des autres joueurs (ensuite adaptatif, voir MIN_INTERP_MS)
export const MIN_INTERP_MS = 66;      // retard d'affichage minimal : 2 snapshots
export const MAX_EXTRAP_MS = 100;     // si un snapshot tarde, on prolonge le mouvement au plus 100 ms
export const REWIND_MAX_MS = 400;     // compensation de lag maximale côté serveur
export const MAX_RAY = 200;

export const EYE_HEIGHT = 1.6;
export const EYE_HEIGHT_CROUCH = 1.05;  // caméra accroupie
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
export const SPRINT_MUL = 1.4;          // vitesse en sprint
export const CROUCH_SPEED_MUL = 0.55;   // vitesse accroupi

// Hitboxes (relatives aux pieds du joueur)
export const BODY_HALF = 0.35;
export const BODY_TOP = 1.4;
export const HEAD_HALF = 0.25;
export const HEAD_TOP = 1.85;
// Accroupi : profil plus bas (plus dur à toucher, surtout à la tête)
export const BODY_TOP_CROUCH = 0.95;
export const HEAD_TOP_CROUCH = 1.3;

export const MODES = {
  duel: { id: 'duel', label: '1v1', desc: 'Duel, premier à 10 frags', max: 2, fill: 2, killLimit: 10, teams: false },
  tdm: { id: 'tdm', label: 'Match à mort par équipe', desc: 'Rouge contre Bleu, 30 frags', max: 10, fill: 8, killLimit: 30, teams: true },
  ffa: { id: 'ffa', label: 'Chacun pour soi', desc: 'Tous contre tous, 20 frags', max: 10, fill: 6, killLimit: 20, teams: false },
  survival: { id: 'survival', label: 'Survie', desc: 'Manches infinies contre des monstres, solo ou coop', max: 4, fill: 0, killLimit: 0, teams: true },
  gun: { id: 'gun', label: 'Gun Game', desc: 'Une arme par niveau, le couteau gagne', max: 10, fill: 6, killLimit: 0, teams: false },
};

// Gun Game : arme de chaque niveau (index dans WEAPONS). Un frag = niveau suivant ; tuer au dernier niveau = victoire.
// Le couteau reste toujours utilisable : un frag au couteau fait monter d'un niveau ET fait descendre la victime.
export const GUN_ORDER = [0, 1, 3, 2, 4]; // fusil d'assaut, pompe, revolver, sniper, couteau
export const KNIFE = 4;

// Index = touche du clavier (1..5). "range" = portée max en mètres (mêlée uniquement).
// falloff = [début, fin, multiplicateur minimum]
export const WEAPONS = [
  {
    id: 'ar', name: "Fusil d'assaut", key: '1', auto: true, interval: 100, cost: 2,
    dmg: 20, headMul: 1.5, pellets: 1, spread: 0.014,
    mag: 30, reload: 1900, falloff: [35, 90, 0.6], speed: 1.0, recoil: 0.5,
    ads: { zoomMul: 0.8, spread: 0.004 },
  },
  {
    id: 'shotgun', name: 'Fusil à pompe', key: '2', auto: false, interval: 900, cost: 2,
    dmg: 18, headMul: 1.0, pellets: 9, spread: 0.055,
    mag: 6, reload: 2400, falloff: [8, 26, 0.15], speed: 1.02, recoil: 1.8,
  },
  {
    id: 'sniper', name: 'Sniper', key: '3', auto: false, interval: 1400, cost: 3,
    dmg: 100, headMul: 2.0, pellets: 1, spread: 0.09, scopeSpread: 0,
    mag: 4, reload: 2800, falloff: null, speed: 0.92, recoil: 2.2, zoom: 22,
  },
  {
    id: 'revolver', name: 'Revolver', key: '4', auto: false, interval: 480, cost: 1,
    dmg: 52, headMul: 2.0, pellets: 1, spread: 0.004,
    mag: 6, reload: 2000, falloff: [40, 90, 0.7], speed: 1.0, recoil: 1.2,
  },
  {
    id: 'knife', name: 'Couteau', key: '5', auto: false, interval: 420, cost: 0,
    dmg: 50, headMul: 1.0, pellets: 1, spread: 0, melee: true, range: 2.4, backstab: 100,
    mag: 0, reload: 0, falloff: null, speed: 1.15, recoil: 0,
  },
  // ---- armes spéciales (index 5+) ----
  // kind : 'rocket' (projectile explosif), 'sweep' (épée), 'grapple' (grappin), 'portal', 'beam' (laser), 'flame', 'nuke'
  {
    id: 'rocket', name: 'Lance-roquettes', kind: 'rocket', cost: 4, auto: false, interval: 1100,
    dmg: 110, headMul: 1, pellets: 1, spread: 0.004, mag: 3, reload: 2600, falloff: null, speed: 0.9, recoil: 2.0,
    proj: { speed: 32, gravity: 0, life: 4, radius: 4.5, minMul: 0.25, self: 0.5, knock: 15 },
  },
  {
    id: 'excalibur', name: 'Excalibur', kind: 'sweep', melee: true, cost: 4, auto: false, interval: 650,
    dmg: 65, headMul: 1, pellets: 1, spread: 0, range: 3.4, cone: 0.62, heal: 30, mag: 0, reload: 0, falloff: null, speed: 1.1, recoil: 0,
    // tir secondaire (clic droit / E) : une onde qui traverse les murs de toute la carte, mais très longue à recharger
    alt: { name: "Onde d'Excalibur", cooldown: 30000, dmg: 200, range: 100, width: 1.7 },
  },
  {
    id: 'grapple', name: 'Grappin', kind: 'grapple', cost: 2, auto: false, interval: 900,
    dmg: 8, headMul: 1, pellets: 1, spread: 0, range: 60, pull: { speed: 28, ms: 1300 }, mag: 0, reload: 0, falloff: null, speed: 1.0, recoil: 0,
  },
  {
    id: 'portal', name: 'Pistolet portail', kind: 'portal', cost: 3, auto: false, interval: 400,
    dmg: 0, headMul: 1, pellets: 1, spread: 0, range: 70, mag: 0, reload: 0, falloff: null, speed: 1.0, recoil: 0,
  },
  {
    id: 'minigun', name: 'Minigun', cost: 4, auto: true, interval: 45,
    dmg: 9, headMul: 1.3, pellets: 1, spread: 0.045, mag: 120, reload: 3600, falloff: [25, 60, 0.5], speed: 0.72, recoil: 0.25,
    ads: { zoomMul: 0.88, spread: 0.022 },
  },
  {
    id: 'grenade', name: 'Lance-grenades', kind: 'rocket', cost: 3, auto: false, interval: 900,
    dmg: 90, headMul: 1, pellets: 1, spread: 0.01, mag: 4, reload: 2400, falloff: null, speed: 0.95, recoil: 1.5,
    proj: { speed: 22, gravity: 14, life: 3, radius: 3.8, minMul: 0.25, self: 0.5, knock: 11 },
  },
  // ---- armes de série (index 11, 13, 14) : gagnées en enchaînant les kills sans mourir, un seul chargeur, pas de recharge ----
  // streak = numéro de l'arme dans STREAK_WEAPONS (touche 6, 7, 8)
  {
    id: 'laser', name: 'Laser', kind: 'beam', streak: 0, cost: 99, auto: true, interval: 60,
    dmg: 5, headMul: 1, pellets: 1, spread: 0, range: 70, stun: 1200, mag: 150, reload: 0, noReload: true, falloff: null, speed: 0.9, recoil: 0,
  },
  {
    id: 'carbine', name: 'Carabine', cost: 3, auto: false, interval: 1600,
    dmg: 110, headMul: 2, pellets: 1, spread: 0, mag: 4, reload: 3000, falloff: null, speed: 0.95, recoil: 2.6,
    ads: { zoomMul: 0.7, spread: 0 },
  },
  {
    id: 'flame', name: 'Lance-flammes', kind: 'flame', streak: 1, cost: 99, auto: true, interval: 50,
    dmg: 9, headMul: 1, pellets: 1, spread: 0, range: 11, cone: 0.82, mag: 250, reload: 0, noReload: true, falloff: null, speed: 0.95, recoil: 0,
  },
  {
    id: 'nuke', name: 'Missile nucléaire', kind: 'nuke', streak: 2, cost: 99, auto: false, interval: 1000,
    dmg: 0, headMul: 1, pellets: 1, spread: 0, delay: 4500, mag: 1, reload: 0, noReload: true, falloff: null, speed: 0.9, recoil: 0,
  },
  // ---- équipement (index 15) : grenade à main pour tout le monde (touche G), pas une arme de classe ----
  {
    id: 'frag', name: 'Grenade', kind: 'nade', item: true, cost: 99, auto: false, interval: 1000,
    dmg: 105, headMul: 1, pellets: 1, spread: 0, mag: 0, reload: 0, falloff: null, speed: 1, recoil: 0,
    proj: { speed: 19, gravity: 18, life: 2.4, radius: 4.2, minMul: 0.2, self: 0.6, knock: 12, bounce: 0.45 },
  },
  // ---- armes à 10 points (index 16, 17) : elles utilisent tout le budget d'une classe perso ----
  {
    // Canon à orbe : on appuie, il charge 1,5 s (on avance lentement), puis envoie une énorme boule qui TRAVERSE tous les
    // ennemis dans un couloir de 3,4 m de rayon (140 dégâts chacun) et explose sur le premier mur (zone de 9 m, 140 au centre).
    id: 'orb', name: 'Canon à orbe', kind: 'orb', cost: 10, auto: false, interval: 3000, charge: 1500,
    dmg: 140, headMul: 1, pellets: 1, spread: 0, mag: 2, reload: 4000, falloff: null, speed: 0.8, recoil: 2.5,
    proj: { speed: 40, gravity: 0, life: 4, radius: 9, minMul: 0.35, self: 0.5, knock: 22, pierce: 3.4, passDmg: 140 },
  },
  {
    // Avion en papier : on le lance et on le pilote à la première personne (souris). Il plane lentement ;
    // au contact d'un ennemi : tête = mort, corps = 60 (voir shared/plane.js). Tirer pendant le vol l'abandonne.
    id: 'plane', name: 'Avion en papier', kind: 'plane', cost: 10, auto: false, interval: 1500,
    dmg: 0, headMul: 1, pellets: 1, spread: 0, mag: 2, reload: 6000, falloff: null, speed: 1, recoil: 0,
  },
  // ---- armes bonus (index 18, 19) ----
  {
    // Pistolet laser : petit projectile explosif énergétique, rapide, dégâts modérés + zone (façon Ray Gun).
    id: 'raygun', name: 'Pistolet laser', kind: 'rocket', cost: 3, auto: false, interval: 550,
    dmg: 55, headMul: 1.4, pellets: 1, spread: 0.006, mag: 8, reload: 1800, falloff: null, speed: 1.0, recoil: 1.0,
    proj: { speed: 30, gravity: 0, life: 2.2, radius: 2.6, minMul: 0.3, self: 0.4, knock: 10 },
  },
  {
    // Ballista : sniper semi-rapide (cadence et rechargement meilleurs que le Sniper de base, un peu moins de dégâts).
    id: 'ballista', name: 'Ballista', cost: 4, auto: false, interval: 950,
    dmg: 85, headMul: 2.0, pellets: 1, spread: 0.05, scopeSpread: 0,
    mag: 7, reload: 2200, falloff: null, speed: 0.96, recoil: 1.8, zoom: 30,
  },
  {
    // Prototype X : arme secrète, uniquement obtenue via la boîte mystère (survie). Volontairement énorme
    // (mini-lance-roquettes entièrement automatique) : item = jamais dans la boutique ni les classes perso.
    id: 'cheat', name: 'Prototype X', kind: 'rocket', item: true, cost: 99, auto: true, interval: 130,
    dmg: 130, headMul: 1, pellets: 1, spread: 0.012, mag: 50, reload: 1800, falloff: null, speed: 1.0, recoil: 0.35,
    proj: { speed: 55, gravity: 0, life: 3, radius: 5, minMul: 0.45, self: 0.25, knock: 14 },
  },
];

// Index des armes
export const W = { AR: 0, SHOTGUN: 1, SNIPER: 2, REVOLVER: 3, KNIFE: 4, ROCKET: 5, EXCALIBUR: 6, GRAPPLE: 7, PORTAL: 8, MINIGUN: 9, GRENADE: 10, LASER: 11, CARBINE: 12, FLAME: 13, NUKE: 14, FRAG: 15, ORB: 16, PLANE: 17, RAYGUN: 18, BALLISTA: 19, CHEAT: 20 };

// Boîte mystère (survie) : arme aléatoire tirée de la boutique. Petite chance de tomber sur le prototype secret.
export const MYSTERY_POOL = WEAPONS.map((w, i) => i).filter((i) => WEAPONS[i].streak === undefined && !WEAPONS[i].item);
export const MYSTERY_RARE = W.CHEAT;
export const MYSTERY_RARE_CHANCE = 0.06;

// Grenades à main : 2 en réserve, une revient toutes les 12 s
export const NADE_MAX = 2;
export const NADE_REGEN_MS = 12000;

// Armes de série, dans l'ordre : touches 6, 7, 8 (débloquées à 5, 10, 15 kills d'affilée, pas en Gun Game)
export const STREAK_WEAPONS = [11, 13, 14];
export const STREAK_AT = [5, 10, 15];
export const NUKE_GAS_MS = 30000;   // durée du gaz toxique après le missile
export const NUKE_GAS_DPS = 6;      // dégâts par seconde du gaz

// Classes : un jeu d'armes (l'ordre = les touches 1, 2, 3...) + vie + vitesse.
export const CLASSES = {
  classic:   { id: 'classic',   name: 'Classique',      desc: 'Les 5 armes de base',                           weapons: [W.AR, W.SHOTGUN, W.SNIPER, W.REVOLVER, W.KNIFE], hp: 100, speed: 1 },
  assault:   { id: 'assault',   name: 'Assaut',         desc: "Fusil d'assaut, lance-grenades, revolver",       weapons: [W.AR, W.GRENADE, W.REVOLVER, W.KNIFE],           hp: 100, speed: 1 },
  sniper:    { id: 'sniper',    name: "Tireur d'élite", desc: 'Sniper, revolver, grappin (90 PV)',              weapons: [W.SNIPER, W.REVOLVER, W.GRAPPLE, W.KNIFE],       hp: 90,  speed: 1 },
  heavy:     { id: 'heavy',     name: 'Lourd',          desc: 'Minigun, lance-roquettes, pompe (lent, 150 PV)', weapons: [W.MINIGUN, W.ROCKET, W.SHOTGUN, W.KNIFE],        hp: 150, speed: 0.88 },
  knight:    { id: 'knight',    name: 'Chevalier',      desc: 'Excalibur, revolver, grappin (125 PV)',          weapons: [W.EXCALIBUR, W.REVOLVER, W.GRAPPLE],             hp: 125, speed: 1.02 },
  scientist: { id: 'scientist', name: 'Scientifique',   desc: "Pistolet portail, carabine, fusil d'assaut",     weapons: [W.PORTAL, W.CARBINE, W.AR, W.KNIFE],               hp: 100, speed: 1 },
  scout:     { id: 'scout',     name: 'Éclaireur',      desc: 'Pompe, revolver, grappin (rapide, 80 PV)',       weapons: [W.SHOTGUN, W.REVOLVER, W.GRAPPLE, W.KNIFE],      hp: 80,  speed: 1.14 },
};
export const CUSTOM_BUDGET = 10;       // points à dépenser pour une classe perso (coût de chaque arme : WEAPONS[i].cost)
export const CUSTOM_MAX_WEAPONS = 5;

export const weaponCost = (list) => list.reduce((s, i) => s + (WEAPONS[i]?.cost ?? 99), 0);

// Valide une classe demandée par un client (identifiant prédéfini, ou 'custom' + liste d'armes) : jamais de confiance aveugle.
export function resolveClass(id, loadout) {
  if (typeof id === 'string' && Object.hasOwn(CLASSES, id)) return CLASSES[id];
  if (id === 'custom' && Array.isArray(loadout)) {
    const seen = new Set();
    const weapons = [];
    for (const v of loadout) {
      const i = Number(v) | 0;
      if (WEAPONS[i] && WEAPONS[i].streak === undefined && !WEAPONS[i].item && !seen.has(i) && weapons.length < CUSTOM_MAX_WEAPONS) { seen.add(i); weapons.push(i); }
    }
    if (weapons.length && weaponCost(weapons) <= CUSTOM_BUDGET) return { id: 'custom', name: 'Perso', desc: '', weapons, hp: 100, speed: 1 };
  }
  return CLASSES.classic;
}

export const TEAM_COLORS = { red: '#e5484d', blue: '#3e82f7' };
export const FFA_COLORS = ['#e5484d', '#f5a524', '#f5d90a', '#46a758', '#12a594', '#3e82f7', '#8e4ec6', '#e93d82', '#a18072', '#889096'];

// ---------------------------------------------------------------- Mode survie ----
// Les joueurs (équipe bleue) affrontent des monstres (équipe rouge) manche après manche, sans fin.
// Entre deux manches : préparation. On gagne des points (💰) en tuant, et on les dépense à la boutique (touche B).
export const SURV = {
  PREP_MS: 15000,       // préparation entre deux manches
  FIRST_PREP_MS: 20000, // avant la première manche
  OVER_MS: 12000,       // écran de fin de partie avant de recommencer à la manche 1
  MAX_MOBS: 24,         // monstres vivants en même temps (les autres attendent)
  START_CASH: 150,
  WAVE_BONUS: 100,      // points offerts à chaque joueur à la fin d'une manche (+ 20 par numéro de manche)
  START_WEAPONS: [3, 4], // revolver + couteau
};

// Boutique. weapon : arme achetée pour le reste de la partie ; up : amélioration qui coûte plus cher à chaque niveau.
const shopWeapon = (id, w, price) => ({ id, kind: 'weapon', w, price });
export const SHOP = [
  { id: 'heal', kind: 'heal', name: 'Soins', desc: 'Vie pleine', price: 80 },
  { id: 'nades', kind: 'nades', name: 'Grenades', desc: 'Réserve pleine', price: 60 },
  { id: 'mystery', kind: 'mystery', name: '🎁 Boîte mystère', desc: 'Arme aléatoire... peut-être le prototype secret', price: 400 },
  { id: 'hp', kind: 'up', stat: 'hp', name: '+25 PV max', desc: 'Vie maximale', base: 250, growth: 1.5, max: 8 },
  { id: 'dmg', kind: 'up', stat: 'dmg', name: '+15 % de dégâts', desc: 'Toutes les armes', base: 500, growth: 1.6, max: 8 },
  { id: 'spd', kind: 'up', stat: 'spd', name: '+6 % de vitesse', desc: 'Déplacement', base: 300, growth: 1.5, max: 5 },
  shopWeapon('w-grapple', W.GRAPPLE, 200),
  shopWeapon('w-portal', W.PORTAL, 250),
  shopWeapon('w-shotgun', W.SHOTGUN, 300),
  shopWeapon('w-ar', W.AR, 350),
  shopWeapon('w-sniper', W.SNIPER, 650),
  shopWeapon('w-carbine', W.CARBINE, 750),
  shopWeapon('w-raygun', W.RAYGUN, 800),
  shopWeapon('w-grenade', W.GRENADE, 900),
  shopWeapon('w-ballista', W.BALLISTA, 950),
  shopWeapon('w-excalibur', W.EXCALIBUR, 1300),
  shopWeapon('w-rocket', W.ROCKET, 1600),
  shopWeapon('w-minigun', W.MINIGUN, 2200),
  shopWeapon('w-plane', W.PLANE, 2800),
  shopWeapon('w-orb', W.ORB, 3500),
];
export const shopItem = (id) => SHOP.find((s) => s.id === id);
// Prix actuel d'un article ; levels = niveaux d'amélioration de l'acheteur { hp, dmg, spd }
export const shopPrice = (it, levels = {}) => (it.kind === 'up' ? Math.round(it.base * Math.pow(it.growth, levels[it.stat] || 0)) : it.price);
