// Point d'entrée : menu, réglages, pause, connexion, lancement du jeu.
import { Net, fetchLobby, wakeServer } from './net.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { loadSettings, saveSettings, isTouch, SERVER_HOST } from './config.js';
import { MODES, SHOP, WEAPONS, shopPrice } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { mountClassPicker } from './classes-ui.js';
import { mountMenu, readInvite } from './menu.js';
import { weaponImg } from './weapon-icons.js';

// Stats cumulées, gardées dans ce navigateur (aucun serveur de stockage nécessaire)
const STATS_KEY = 'fpixel-stats-v1';
function loadStats() {
  try { return { matches: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, head: 0, best: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') }; } catch { return { matches: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, head: 0, best: 0 }; }
}
function recordMatch(row, won) { // row = [id, frags, morts, dégâts, précision, têtes, série max, arme]
  const s = loadStats();
  s.matches++; if (won) s.wins++;
  s.kills += row[1]; s.deaths += row[2]; s.dmg += row[3]; s.head += row[5]; s.best = Math.max(s.best, row[6]);
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* navigation privée */ }
}

const $ = (id) => document.getElementById(id);
const settings = loadSettings();
if (isTouch) document.body.classList.add('touch');

const net = new Net();
const input = new Input($('game'));
const hud = new Hud();
let game = null;
let busy = false;
let cancelled = false;
let settingsOpen = false;
let shopOpen = false;
let reconnecting = false;
let welcomeWaiter = null;
let pendingRid = null;   // salon choisi dans le navigateur de salons (pour ce lancement seulement)

// Jeton de reconnexion : permet de reprendre sa place (score, équipe, niveau) après une coupure
const token = (() => {
  const fresh = () => (crypto.randomUUID?.() || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);
  try {
    let t = sessionStorage.getItem('fpixel-token');
    if (!t) { t = fresh(); sessionStorage.setItem('fpixel-token', t); }
    return t;
  } catch { return fresh(); }
})();

function joinMsg() {
  return {
    t: 'join', name: settings.name, mode: settings.mode,
    // « Entre potes » : salon nommé ; survie : salon privé (solo) sauf si on donne un nom pour jouer en coop
    room: settings.lobby === 'friends' || settings.mode === 'survival' ? (settings.room.trim() || (settings.mode === 'survival' ? `solo-${token.slice(0, 10)}` : '')) : '',
    bots: settings.bots ? (settings.fill || 1) : 0, diff: settings.diff, limit: settings.limit, token,
    map: settings.map, cls: settings.cls, loadout: settings.cls === 'custom' ? settings.custom : undefined,
    rid: pendingRid || undefined,   // salon choisi dans la liste « Salons ouverts »
  };
}

// ---------------------------------------------------------------- menu ----
if (!Object.hasOwn(MODES, settings.mode)) settings.mode = 'ffa';
if (!Object.hasOwn(MAPS, settings.map)) settings.map = 'arena';
if (readInvite(location.search, settings)) {   // lien d'invitation ?room=…&mode=… : lu une fois puis retiré de l'URL
  saveSettings(settings);
  const keep = new URLSearchParams(location.search);
  for (const k of ['room', 'mode', 'map']) keep.delete(k);    // on garde les réglages techniques (debug, server)
  const q = keep.toString().replace(/=(&|$)/g, '$1');
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : ''));
}
const menu = mountMenu({ settings, save: () => saveSettings(settings), onPlay: () => play(), onOpenSettings: () => openSettings(), loadStats });

// en partie (pause) : changer de classe, effectif à la prochaine réapparition
function mountPausePicker() {
  mountClassPicker($('pause-cls'), settings, {
    save: () => saveSettings(settings), compact: true,
    onChange: () => net.send({ t: 'class', cls: settings.cls, loadout: settings.cls === 'custom' ? settings.custom : undefined }),
  });
}

function setStatus(kind, text) {
  const s = $('status');
  s.className = `status ${kind}`;
  s.querySelector('span').textContent = text;
}

async function refreshStatus() {
  if (busy || game?.running) return;
  const lobby = await fetchLobby(6000);
  if (busy || game?.running) return;
  menu.setLobby(lobby);
  if (!lobby) {
    setStatus('off', 'Serveur en veille');
    return;
  }
  setStatus('on', lobby.online ? `${lobby.online} en ligne` : 'En ligne');
  for (const m of Object.keys(MODES)) {
    const e = document.querySelector(`[data-count="${m}"]`);
    if (e) e.textContent = lobby.modes[m]?.players ? `${lobby.modes[m].players} en jeu` : '';
  }
}
setInterval(refreshStatus, 6000);
refreshStatus();

function showMenu(msg) {
  shopOpen = false; $('shop').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('touch').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('reconnect').classList.add('hidden');
  reconnecting = false;
  $('play').disabled = false;
  $('play').textContent = 'JOUER';
  busy = false;
  menu.render();
  if (msg) setStatus('off', msg); else refreshStatus();
}

function enterFullscreen() {
  try {
    const el = document.documentElement;
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    p?.catch?.(() => {});
    screen.orientation?.lock?.('landscape')?.catch?.(() => {});
  } catch { /* pas grave */ }
}

async function play() {
  if (busy) return;
  busy = true;
  pendingRid = menu.takeJoinRid();
  cancelled = false;
  sfx.init(); // doit être appelé dans un geste utilisateur
  if (isTouch) enterFullscreen();

  const name = $('name').value.trim() || `Joueur${Math.floor(100 + Math.random() * 900)}`;
  settings.name = name;
  $('name').value = name;
  saveSettings(settings);

  $('play').disabled = true;
  $('play').textContent = 'CONNEXION…';
  setStatus('wait', 'Connexion…');

  try {
    if (!game) { game = new Game({ canvas: $('game'), input, net, hud, getSettings: () => settings }); game.onMatchEnd = recordMatch; game.onShop = () => toggleShop(); game.onShopChange = () => { if (shopOpen) renderShop(); }; }
  } catch (e) {
    console.error(e);
    return showMenu("WebGL n'est pas disponible sur cet appareil/navigateur.");
  }

  const awake = await wakeServer(
    (s) => { setStatus('wait', `Réveil… ${s} s`); $('play').textContent = `RÉVEIL DU SERVEUR… ${s} s`; },   // le Space gratuit s'endort quand personne ne joue
    () => cancelled,
  );
  if (!awake) return showMenu('Serveur injoignable. Réessaie dans un instant.');

  net.on('welcome', onWelcome);
  net.on('error', (m) => {
    net.close();
    if (game?.running) game.stop();
    showMenu(m.msg || 'Erreur serveur');
  });
  net.on('close', () => { if (game?.running) reconnect(); });
  try {
    await net.connect();
  } catch (e) {
    return showMenu(`Connexion impossible (${SERVER_HOST}).`);
  }
  net.send(joinMsg());
}
$('play').addEventListener('click', play);

// Connexion perdue en pleine partie : on retente tout seul (le Space peut redémarrer ou se réveiller)
async function reconnect() {
  if (reconnecting) return;
  reconnecting = true;
  game.setPaused(true);
  $('reconnect').classList.remove('hidden');
  const t0 = Date.now();
  let ok = false;
  for (let attempt = 1; game.running && Date.now() - t0 < 120000; attempt++) {
    $('reco-sub').textContent = `tentative ${attempt}…`;
    await new Promise((r) => setTimeout(r, Math.min(1000 * attempt, 4000)));
    if (!game.running) break;
    if (!(await fetchLobby(5000))) continue;          // serveur pas encore revenu
    try { await net.connect(); } catch { continue; }
    ok = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 6000);
      welcomeWaiter = () => { clearTimeout(timer); resolve(true); };
      net.send(joinMsg());
    });
    welcomeWaiter = null;
    if (ok) break;
  }
  $('reconnect').classList.add('hidden');
  reconnecting = false;
  if (!ok && game.running) { game.stop(); showMenu('Connexion perdue avec le serveur.'); }
}

function onWelcome(m) {
  pendingRid = null;   // une reconnexion doit reprendre la place (jeton), pas re-cibler le salon choisi
  $('menu').classList.add('hidden');
  welcomeWaiter?.();
  game.start(m);
  game.setPaused(false);
  input.enabled = true;
  if (isTouch) {
    $('touch').classList.remove('hidden');
  } else {
    input.requestLock();
    // si le navigateur refuse (geste expiré), on affiche l'écran "Reprendre"
    setTimeout(() => { if (game.running && !input.locked) showPause(true); }, 500);
  }
}

// ---------------------------------------------------------------- pause ----
function showPause(first = false) {
  $('pause-class').classList.toggle('hidden', game.mode === 'gun' || game.mode === 'survival');
  mountPausePicker();
  $('pause').querySelector('h2').textContent = first ? 'PRÊT ?' : 'PAUSE';
  $('resume').textContent = first ? 'Jouer' : 'Reprendre';
  $('pause').classList.remove('hidden');
  game.setPaused(true);
}
function hidePause() {
  $('pause').classList.add('hidden');
  game.setPaused(false);
}
input.onLockChange = (locked) => {
  if (!game?.running) return;
  if (locked) hidePause();
  else if (!settingsOpen && !shopOpen) showPause();
};
input.onPause = () => showPause();
document.addEventListener('pointerlockerror', () => { if (game?.running && !input.locked) showPause(true); });

$('resume').addEventListener('click', () => {
  if (isTouch) hidePause();
  else input.requestLock();
});
$('quit').addEventListener('click', () => {
  net.send({ t: 'leave' });   // départ volontaire : le serveur libère la place tout de suite
  net.close();
  game.stop();
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu();
});

// ---------------------------------------------------------------- boutique (survie) ----
function renderShop() {
  const me = game?.me;
  if (!me) return;
  $('shop-cash').textContent = `💰 ${me.cash}`;
  const list = $('shop-list');
  list.replaceChildren();
  const owned = new Set(me.loadout);
  const row = (it) => {
    const price = shopPrice(it, me.up);
    const lvl = it.kind === 'up' ? (me.up[it.stat] || 0) : 0;
    const have = it.kind === 'weapon' && owned.has(it.w);
    const maxed = it.kind === 'up' && lvl >= it.max;
    const name = it.kind === 'weapon' ? WEAPONS[it.w].name : it.name;
    const div = document.createElement('div');
    div.className = `shop-row${have || maxed ? ' own' : ''}`;
    if (it.kind === 'weapon') div.prepend(weaponImg(WEAPONS[it.w].id, 44, 'w-icon shop-icon'));
    const b = document.createElement('b'); b.textContent = it.kind === 'up' ? `${name} (${lvl}/${it.max})` : name;
    const small = document.createElement('small'); small.textContent = it.desc || (it.kind === 'weapon' ? `Touche ${me.loadout.length + 1} une fois achetée` : '');
    const p = document.createElement('span'); p.className = 'price'; p.textContent = have ? 'Possédé' : maxed ? 'Max' : `💰 ${price}`;
    const btn = document.createElement('button'); btn.textContent = 'Acheter';
    btn.disabled = have || maxed || me.cash < price;
    btn.addEventListener('click', () => net.send({ t: 'buy', id: it.id }));
    div.append(b, small, p, btn);
    return div;
  };
  const sec = (title, items) => { const h = document.createElement('h3'); h.textContent = title; list.append(h, ...items.map(row)); };
  sec('Équipement', SHOP.filter((i) => i.kind !== 'weapon'));
  sec('Armes', SHOP.filter((i) => i.kind === 'weapon'));
}
function toggleShop(force) {
  if (!game?.running || game.mode !== 'survival') return;
  shopOpen = force !== undefined ? force : !shopOpen;
  $('shop').classList.toggle('hidden', !shopOpen);
  if (shopOpen) {
    renderShop();
    if (document.pointerLockElement) document.exitPointerLock();   // pour pouvoir cliquer sur les articles
  } else if (!isTouch) input.requestLock();
}
$('shop-close').addEventListener('click', () => toggleShop(false));
document.addEventListener('keydown', (e) => { if (shopOpen && (e.code === 'KeyB' || e.code === 'Escape')) { e.preventDefault(); toggleShop(false); } });

// ---------------------------------------------------------------- réglages ----
const SLIDERS = [
  ['s-sens', 'o-sens', 'sens', (v) => v.toFixed(2)],
  ['s-scope', 'o-scope', 'sensScope', (v) => v.toFixed(2)],
  ['s-fov', 'o-fov', 'fov', (v) => `${Math.round(v)}°`],
  ['s-scale', 'o-scale', 'scale', (v) => `${Math.round(v * 100)}%`],
  ['s-vol', 'o-vol', 'volume', (v) => `${Math.round(v * 100)}%`],
];
for (const [id, out, key, fmt] of SLIDERS) {
  const s = $(id), o = $(out);
  s.value = settings[key];
  o.textContent = fmt(Number(s.value));
  s.addEventListener('input', () => {
    settings[key] = Number(s.value);
    o.textContent = fmt(settings[key]);
    saveSettings(settings);
    game?.applySettings();
  });
}
$('s-map').checked = settings.minimap !== false;
$('s-map').addEventListener('change', () => { settings.minimap = $('s-map').checked; saveSettings(settings); });
$('s-auto').checked = !!settings.autoFire;
$('s-auto').addEventListener('change', () => { settings.autoFire = $('s-auto').checked; saveSettings(settings); });
$('s-inv').checked = !!settings.invertY;
$('s-inv').addEventListener('change', () => { settings.invertY = $('s-inv').checked; saveSettings(settings); });

function openSettings() { settingsOpen = true; $('settings').classList.remove('hidden'); }
function closeSettings() { settingsOpen = false; $('settings').classList.add('hidden'); }
$('pause-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', closeSettings);

// Outils de test (uniquement avec ?debug dans l'URL)
if (location.search.includes('debug')) {
  window.__fpixel = { get game() { return game; }, input, net, hud, settings };
}
