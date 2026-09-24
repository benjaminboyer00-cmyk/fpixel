// Menu principal : état -> rendu. Aucune dépendance three.js, donc testable en jsdom (test/menu.mjs).
//  - modes en tuiles, carte en vignettes (vue du dessus générée depuis shared/map.js), classe via classes-ui.js
//  - « Partie rapide » / « Entre potes » (salon nommé + lien d'invitation ?room=…&mode=…)
//  - barre du bas toujours visible : pseudo, résumé de ce qu'on lance, JOUER
import { MODES } from '../shared/config.js';
import { MAPS } from '../shared/map.js';
import { mountClassPicker } from './classes-ui.js';

const $ = (id) => document.getElementById(id);
const MODE_ORDER = ['ffa', 'tdm', 'duel', 'gun', 'survival'];
const IMPOSED = new Set(['gun', 'survival']);

// ---- vignette de carte : vue du dessus, boîtes teintées selon leur hauteur ----
export function mapThumbSvg(map) {
  const h = map.half;
  const shade = (b) => (b.y1 - b.y0 >= 4 ? '#8b97a8' : b.y1 - b.y0 >= 1.8 ? '#5a6779' : '#33404f');
  let r = '';
  for (const b of map.boxes) {
    if (b.x1 <= -h + 0.5 || b.x0 >= h - 0.5 || b.z1 <= -h + 0.5 || b.z0 >= h - 0.5) continue; // murs d'enceinte : inutiles
    r += `<rect x="${b.x0.toFixed(1)}" y="${b.z0.toFixed(1)}" width="${(b.x1 - b.x0).toFixed(1)}" height="${(b.z1 - b.z0).toFixed(1)}" fill="${shade(b)}"/>`;
  }
  for (const s of map.spawns) r += `<rect x="${(s.x - h * 0.02).toFixed(1)}" y="${(s.z - h * 0.02).toFixed(1)}" width="${(h * 0.04).toFixed(1)}" height="${(h * 0.04).toFixed(1)}" fill="${s.team === 'red' ? '#e5484d' : s.team === 'blue' ? '#3e82f7' : '#ffb703'}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-h} ${-h} ${2 * h} ${2 * h}" shape-rendering="crispEdges"><rect x="${-h}" y="${-h}" width="${2 * h}" height="${2 * h}" fill="#0a0d12"/>${r}</svg>`;
}

// ---- lien d'invitation ----
export function inviteLink(settings, base = location.origin + location.pathname) {
  const q = new URLSearchParams();
  q.set('room', settings.room.trim());
  q.set('mode', settings.mode);
  if (!IMPOSED.has(settings.mode) || settings.mode === 'survival') q.set('map', settings.map);
  return `${base}?${q.toString()}`;
}
export function readInvite(search, settings) {
  const q = new URLSearchParams(search);
  const room = (q.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const mode = q.get('mode');
  const map = q.get('map');
  let changed = false;
  if (room) { settings.room = room; settings.lobby = 'friends'; changed = true; }
  if (mode && Object.hasOwn(MODES, mode)) { settings.mode = mode; changed = true; }
  if (map && Object.hasOwn(MAPS, map)) { settings.map = map; changed = true; }
  return changed;
}

// ---- résumé (ligne au-dessus de JOUER) ----
export function summaryText(settings) {
  const m = MODES[settings.mode];
  const bits = [m.label];
  bits.push(MAPS[settings.map]?.name || settings.map);
  if (!IMPOSED.has(settings.mode) || settings.mode === 'survival') {
    if (settings.mode !== 'survival') bits.push(`${settings.limit || m.killLimit} frags`);
  }
  if (settings.mode === 'survival') bits.push(settings.room.trim() ? `coop « ${settings.room.trim()} »` : 'solo');
  else if (settings.lobby === 'friends' && settings.room.trim()) bits.push(`salon « ${settings.room.trim()} »`);
  else bits.push('public');
  if (settings.mode !== 'survival' && settings.mode !== 'duel') bits.push(settings.bots ? `bots ${settings.diff}` : 'sans bots');
  if (settings.mode === 'survival') bits.push(`monstres ${settings.diff}`);
  return bits.join(' · ');
}

// ---- clavier ----
const KEYS = [
  ['Échap', 'Pause'], ['1‑9', 'Armes'], ['Tab', 'Scores'],
  ['Z', 'Avancer'], ['Q', 'Gauche'], ['S', 'Reculer'], ['D', 'Droite'], ['Espace', 'Sauter'], ['Maj', 'Sprint'], ['C', 'Accroupi · glissade en sprint'],
  ['R', 'Recharger'], ['F', 'Tirer'], ['E', 'Tir 2 / portail'], ['G', 'Grenade'], ['B', 'Boutique / banque'], ['V', 'Voiture'], ['M', 'Mini-carte'],
];
const ROWS = [['Échap', '1‑9', 'Tab'], ['A', 'Z', 'E', 'R', 'T'], ['Q', 'S', 'D', 'F', 'G'], ['Maj', 'W', 'X', 'C', 'V', 'B'], ['Espace']];
function renderKeyboard(grid, legend) {
  const map = new Map(KEYS);
  grid.replaceChildren();
  for (const row of ROWS) {
    const r = document.createElement('div'); r.className = 'kbd-row';
    for (const k of row) {
      const key = document.createElement('kbd');
      key.textContent = k;
      if (map.has(k)) { key.classList.add('on'); key.title = map.get(k); key.dataset.label = map.get(k); }
      if (k === 'Espace') key.classList.add('wide');
      if (k === 'Maj' || k === 'Échap' || k === 'Tab') key.classList.add('mid');
      r.append(key);
    }
    grid.append(r);
  }
  legend.replaceChildren();
  for (const [k, v] of KEYS) { const b = document.createElement('b'); b.textContent = k; legend.append(b, ` ${v} · `); }
  legend.append(document.createTextNode('Souris : viser · Clic gauche : tirer · Clic droit : zoom / tir secondaire · Molette : changer d\'arme'));
}

// ---- montage ----
export function mountMenu({ settings, save, onPlay, onOpenSettings, loadStats }) {
  const state = { lobbyOnline: null };
  const picker = mountClassPicker($('cls-picker'), settings, { save, onUpdate: () => renderBar() });

  // cartes
  const mapWrap = $('map-picker');
  for (const m of Object.values(MAPS)) {
    const b = document.createElement('button');
    b.className = 'map-tile'; b.type = 'button'; b.dataset.map = m.id; b.setAttribute('role', 'radio');
    b.innerHTML = `${mapThumbSvg(m)}<b>${m.name}</b><small>${m.desc}</small>`;
    b.addEventListener('click', () => { settings.map = m.id; render(); save(); });
    mapWrap.append(b);
  }

  // modes
  for (const btn of document.querySelectorAll('.mode')) btn.addEventListener('click', () => { settings.mode = btn.dataset.mode; if (!MODE_ORDER.includes(settings.mode)) settings.mode = 'ffa'; render(); save(); });

  // type de partie
  for (const btn of document.querySelectorAll('.seg-btn')) btn.addEventListener('click', () => { settings.lobby = btn.dataset.lobby; render(); save(); if (settings.lobby === 'friends') $('room').focus(); });
  $('room').value = settings.room || '';
  $('room').addEventListener('input', () => { settings.room = $('room').value; render(); save(); });
  $('name').value = settings.name || '';
  $('name').addEventListener('input', () => { settings.name = $('name').value; save(); });
  for (const id of ['name', 'room']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') onPlay(); });

  // options
  $('bots').checked = settings.bots !== false;
  $('bots').addEventListener('change', () => { settings.bots = $('bots').checked; render(); save(); });
  for (const [id, key, num] of [['diff', 'diff', false], ['limit', 'limit', true], ['fill', 'fill', true]]) {
    const e = $(id);
    e.value = String(settings[key]);
    if (e.value !== String(settings[key])) e.selectedIndex = 0;
    e.addEventListener('change', () => { settings[key] = num ? Number(e.value) : e.value; render(); save(); });
  }

  // lien d'invitation
  $('copy-link').addEventListener('click', async () => {
    if (!settings.room.trim()) { $('room').focus(); flash($('copy-link'), 'Donne un nom'); return; }
    const url = inviteLink(settings);
    try { await navigator.clipboard.writeText(url); flash($('copy-link'), 'Copié !'); }
    catch { prompt('Copie ce lien :', url); }
  });
  function flash(btn, txt) { const old = btn.textContent; btn.textContent = txt; setTimeout(() => { btn.textContent = old; }, 1400); }

  // aides
  $('open-settings').addEventListener('click', onOpenSettings);
  $('open-help').addEventListener('click', () => { renderKeyboard($('kbd-grid'), $('kbd-legend')); $('help').classList.remove('hidden'); });
  $('close-help').addEventListener('click', () => $('help').classList.add('hidden'));
  $('open-stats').addEventListener('click', () => { renderStats(); $('stats').classList.remove('hidden'); });
  $('close-stats').addEventListener('click', () => $('stats').classList.add('hidden'));
  function renderStats() {
    const s = loadStats();
    const box = $('mystats');
    box.replaceChildren();
    if (!s.matches) { box.textContent = 'Pas encore de partie terminée.'; return; }
    const rows = [['Parties', s.matches], ['Victoires', `${s.wins} (${Math.round((100 * s.wins) / s.matches)} %)`], ['Frags', s.kills], ['Morts', s.deaths], ['K/D', (s.kills / Math.max(1, s.deaths)).toFixed(2)], ['Dégâts', s.dmg], ['Têtes', s.head], ['Meilleure série', s.best]];
    for (const [k, v] of rows) { const d = document.createElement('div'); d.innerHTML = `<small></small><b></b>`; d.firstChild.textContent = k; d.lastChild.textContent = String(v); box.append(d); }
  }

  let render = function () {
    const m = settings.mode;
    const imposed = IMPOSED.has(m);
    for (const btn of document.querySelectorAll('.mode')) { const on = btn.dataset.mode === m; btn.classList.toggle('sel', on); btn.setAttribute('aria-checked', on ? 'true' : 'false'); }
    $('mode-desc').textContent = MODES[m].desc + (MODES[m].max ? ` · jusqu'à ${MODES[m].max} joueurs` : '');
    picker.setMode(m);
    $('arsenal-sub').textContent = imposed ? (m === 'gun' ? 'armes imposées' : 'équipement de départ') : 'choisis ta classe';

    // carte : la Survie évite la petite arène
    if (m === 'survival' && settings.map === 'arena') settings.map = 'city';
    for (const t of mapWrap.querySelectorAll('.map-tile')) { const on = t.dataset.map === settings.map; t.classList.toggle('sel', on); t.setAttribute('aria-checked', on ? 'true' : 'false'); }

    // partie
    const surv = m === 'survival';
    const friends = settings.lobby === 'friends' || surv;
    for (const b of document.querySelectorAll('.seg-btn')) { const on = (b.dataset.lobby === 'friends') === friends; b.classList.toggle('sel', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.disabled = surv && b.dataset.lobby === 'quick'; }
    $('friends-box').classList.toggle('hidden', !friends);
    $('lobby-hint').textContent = surv ? 'Seul par défaut. Donne un nom de salon pour jouer en coop (4 max).'
      : friends ? 'Tes potes tapent le même nom, ou ouvrent ton lien.' : 'Tu rejoins un salon public avec les mêmes réglages.';
    $('room').placeholder = surv ? 'ex : coop' : 'ex : potes';
    $('f-bots-row').classList.toggle('hidden', surv || m === 'duel');
    $('f-diff').firstChild.textContent = surv ? 'Monstres' : 'Bots';
    $('f-diff').classList.toggle('hidden', !surv && !settings.bots);
    $('f-limit').classList.toggle('hidden', imposed);
    $('f-fill').classList.toggle('hidden', surv || m === 'duel' || !settings.bots);
    $('lobby-opts').classList.toggle('hidden', m === 'duel' && !friends);

    renderBar();
  };
  function renderBar() {
    const imposed = IMPOSED.has(settings.mode);
    $('menu-summary').textContent = summaryText(settings);
    const ok = picker.isValid();
    $('play').disabled = !ok && !imposed;
    $('play').title = ok || imposed ? '' : 'Choisis au moins une arme pour la classe Perso';
  }

  // ---- navigateur de salons (données de /api/rooms, rafraîchies par main.js) ----
  function renderRooms() {
    const list = $('rooms-list');
    const rooms = (state.lobby?.modes?.[settings.mode]?.rooms || []).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 6);
    $('rooms-box').classList.toggle('hidden', !state.lobby || settings.mode === 'survival' && !rooms.length);
    $('rooms-count').textContent = rooms.length ? `(${rooms.length})` : '';
    list.replaceChildren();
    if (!rooms.length) { const e = document.createElement('div'); e.className = 'rooms-empty'; e.textContent = state.lobby ? 'Aucun salon ouvert dans ce mode : lance-toi, les autres te rejoindront.' : ''; list.append(e); return; }
    for (const r of rooms) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'room-row-btn';
      const full = r.n >= r.max;
      b.disabled = full;
      const name = document.createElement('b'); name.textContent = r.auto ? r.id : `« ${r.id} »`;
      const meta = document.createElement('small'); meta.textContent = `${MAPS[r.map]?.name || r.map}${r.bots ? ' · bots' : ''}${r.state === 'ended' ? ' · fin de manche' : ''}`;
      const n = document.createElement('em'); n.textContent = full ? 'plein' : `${r.n}/${r.max}`;
      b.append(name, meta, n);
      b.addEventListener('click', () => { state.joinRid = r.rid; onPlay(); });
      list.append(b);
    }
  }
  function setLobby(lobby) { state.lobby = lobby; renderRooms(); }

  const baseRender = render;
  render = function () { baseRender(); renderRooms(); };   // eslint-disable-line no-func-assign
  render();
  return {
    render, picker, setLobby,
    takeJoinRid: () => { const r = state.joinRid; state.joinRid = null; return r; },
    renderKeyboard: () => renderKeyboard($('kbd-grid'), $('kbd-legend')),
  };
}
