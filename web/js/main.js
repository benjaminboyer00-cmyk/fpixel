// Point d'entrée : menu, réglages, pause, connexion, lancement du jeu.
import { Net, fetchLobby, wakeServer } from './net.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { loadSettings, saveSettings, isTouch, SERVER_HOST } from './config.js';
import { MODES } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { mountClassPicker } from './classes-ui.js';

// Stats cumulées, gardées dans ce navigateur (aucun serveur de stockage nécessaire)
const STATS_KEY = 'fpixel-stats-v1';
function loadStats() {
  try { return { matches: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, head: 0, best: 0, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') }; } catch { return { matches: 0, wins: 0, kills: 0, deaths: 0, dmg: 0, head: 0, best: 0 }; }
}
function showStats() {
  const s = loadStats(), el = document.getElementById('mystats');
  if (!el) return;
  el.textContent = s.matches
    ? `Parties ${s.matches} · Victoires ${s.wins} (${Math.round((100 * s.wins) / s.matches)} %) · Frags ${s.kills} · Morts ${s.deaths} (K/D ${(s.kills / Math.max(1, s.deaths)).toFixed(2)}) · Dégâts ${s.dmg} · Têtes ${s.head} · Meilleure série ${s.best}`
    : 'Pas encore de partie terminée.';
}
function recordMatch(row, won) { // row = [id, frags, morts, dégâts, précision, têtes, série max, arme]
  const s = loadStats();
  s.matches++; if (won) s.wins++;
  s.kills += row[1]; s.deaths += row[2]; s.dmg += row[3]; s.head += row[5]; s.best = Math.max(s.best, row[6]);
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch { /* navigation privée */ }
  showStats();
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
let reconnecting = false;
let welcomeWaiter = null;

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
    t: 'join', name: settings.name, mode: settings.mode, room: settings.room.trim(),
    bots: settings.bots ? (settings.fill || 1) : 0, diff: settings.diff, limit: settings.limit, token,
    map: settings.map, cls: settings.cls, loadout: settings.cls === 'custom' ? settings.custom : undefined,
  };
}

// ---------------------------------------------------------------- menu ----
$('name').value = settings.name;
$('room').value = settings.room;
if (!MODES[settings.mode]) settings.mode = 'ffa';

function selectMode(m) {
  settings.mode = m;
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('sel', b.dataset.mode === m));
  $('f-class').classList.toggle('off', m === 'gun'); // Gun Game : les armes sont imposées par le niveau
  saveSettings(settings);
}
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
selectMode(settings.mode);

showStats();
// carte + classe
for (const m of Object.values(MAPS)) $('map').append(Object.assign(document.createElement('option'), { value: m.id, textContent: m.name }));
if (!MAPS[settings.map]) settings.map = 'arena';
$('map').value = settings.map;
const showMapDesc = () => { $('map-desc').textContent = MAPS[settings.map].desc; };
showMapDesc();
$('map').addEventListener('change', () => { settings.map = $('map').value; showMapDesc(); saveSettings(settings); });
mountClassPicker($('cls-picker'), settings, { save: () => saveSettings(settings) });
// en partie (pause) : changer de classe, effectif à la prochaine réapparition
function mountPausePicker() {
  mountClassPicker($('pause-cls'), settings, {
    save: () => saveSettings(settings),
    onChange: () => net.send({ t: 'class', cls: settings.cls, loadout: settings.cls === 'custom' ? settings.custom : undefined }),
  });
}

$('bots').checked = settings.bots !== false;
$('bots').addEventListener('change', () => { settings.bots = $('bots').checked; saveSettings(settings); });
for (const [id, key, num] of [['diff', 'diff', false], ['limit', 'limit', true], ['fill', 'fill', true]]) {
  const el = $(id);
  el.value = String(settings[key]);
  if (el.value !== String(settings[key])) el.selectedIndex = 0; // valeur enregistrée qui n'existe plus
  el.addEventListener('change', () => { settings[key] = num ? Number(el.value) : el.value; saveSettings(settings); });
}
$('name').addEventListener('input', () => { settings.name = $('name').value; saveSettings(settings); });
$('room').addEventListener('input', () => { settings.room = $('room').value; saveSettings(settings); });
$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
$('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });

function setStatus(kind, text) {
  const s = $('status');
  s.className = `status ${kind}`;
  s.querySelector('span').textContent = text;
}

async function refreshStatus() {
  if (busy || game?.running) return;
  const lobby = await fetchLobby(6000);
  if (busy || game?.running) return;
  if (!lobby) {
    setStatus('off', 'Serveur en veille… il se réveille (ça peut prendre ~30 s).');
    return;
  }
  setStatus('on', `Serveur en ligne · ${lobby.online} joueur${lobby.online > 1 ? 's' : ''} connecté${lobby.online > 1 ? 's' : ''}`);
  for (const m of Object.keys(MODES)) {
    const e = document.querySelector(`[data-count="${m}"]`);
    if (e) e.textContent = lobby.modes[m].players ? `${lobby.modes[m].players} en jeu` : '';
  }
}
setInterval(refreshStatus, 6000);
refreshStatus();

function showMenu(msg) {
  $('menu').classList.remove('hidden');
  $('touch').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('reconnect').classList.add('hidden');
  reconnecting = false;
  $('play').disabled = false;
  $('play').textContent = 'JOUER';
  busy = false;
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
  cancelled = false;
  sfx.init(); // doit être appelé dans un geste utilisateur
  if (isTouch) enterFullscreen();

  const name = $('name').value.trim() || `Joueur${Math.floor(100 + Math.random() * 900)}`;
  settings.name = name;
  $('name').value = name;
  saveSettings(settings);

  $('play').disabled = true;
  $('play').textContent = 'CONNEXION…';
  setStatus('wait', 'Connexion au serveur…');

  try {
    if (!game) { game = new Game({ canvas: $('game'), input, net, hud, getSettings: () => settings }); game.onMatchEnd = recordMatch; }
  } catch (e) {
    console.error(e);
    return showMenu("WebGL n'est pas disponible sur cet appareil/navigateur.");
  }

  const awake = await wakeServer(
    (s) => setStatus('wait', `Réveil du serveur… ${s}s (le Space gratuit s'endort quand personne ne joue)`),
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
  $('pause-class').classList.toggle('hidden', game.mode === 'gun');
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
  else if (!settingsOpen) showPause();
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
$('open-settings').addEventListener('click', openSettings);
$('pause-settings').addEventListener('click', openSettings);
$('close-settings').addEventListener('click', closeSettings);

// Outils de test (uniquement avec ?debug dans l'URL)
if (location.search.includes('debug')) {
  window.__fpixel = { get game() { return game; }, input, net, hud, settings };
}
