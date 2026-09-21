// Point d'entrée : menu, réglages, pause, connexion, lancement du jeu.
import { Net, fetchLobby, wakeServer } from './net.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { sfx } from './audio.js';
import { loadSettings, saveSettings, isTouch, SERVER_HOST } from './config.js';
import { MODES } from '../shared/config.js';

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

// ---------------------------------------------------------------- menu ----
$('name').value = settings.name;
$('room').value = settings.room;
if (!MODES[settings.mode]) settings.mode = 'ffa';

function selectMode(m) {
  settings.mode = m;
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('sel', b.dataset.mode === m));
  saveSettings(settings);
}
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => selectMode(b.dataset.mode)));
selectMode(settings.mode);

$('bots').checked = settings.bots !== false;
$('bots').addEventListener('change', () => { settings.bots = $('bots').checked; saveSettings(settings); });
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
    if (!game) game = new Game({ canvas: $('game'), input, net, hud, getSettings: () => settings });
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
  net.on('error', (m) => { net.close(); showMenu(m.msg || 'Erreur serveur'); });
  net.on('close', () => {
    if (game?.running) { game.stop(); showMenu('Connexion perdue avec le serveur.'); }
  });
  try {
    await net.connect();
  } catch (e) {
    return showMenu(`Connexion impossible (${SERVER_HOST}).`);
  }
  net.send({ t: 'join', name, mode: settings.mode, room: settings.room.trim(), bots: settings.bots ? 1 : 0 });
}
$('play').addEventListener('click', play);

function onWelcome(m) {
  $('menu').classList.add('hidden');
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
