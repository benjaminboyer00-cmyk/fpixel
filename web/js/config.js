// Où est le serveur, et réglages du joueur (sauvegardés dans le navigateur).

export const HF_SPACE_HOST = 'benji4565-fpixel.hf.space';

export const isTouch = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;

function isLocalHost(host) {
  const h = host.split(':')[0];
  return h === 'localhost' || h === '127.0.0.1' || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
}

// - page servie par le serveur lui-même (Space HF ou local) => même origine
// - page sur Vercel (ou ailleurs)                            => Space HF
// - ?server=hote[:port] pour forcer un autre serveur
function resolveHost() {
  const forced = new URLSearchParams(location.search).get('server');
  if (forced) return forced;
  const h = location.hostname;
  if (isLocalHost(location.host) || h.endsWith('.hf.space')) return location.host;
  return HF_SPACE_HOST;
}

export const SERVER_HOST = resolveHost();
const secure = !isLocalHost(SERVER_HOST);
export const HTTP_BASE = `${secure ? 'https' : 'http'}://${SERVER_HOST}`;
export const WS_URL = `${secure ? 'wss' : 'ws'}://${SERVER_HOST}/ws`;

const KEY = 'fpixel-settings-v2';
const OLD_KEY = 'fpixel-settings-v1';
const DEFAULTS = {
  name: '', mode: 'ffa', room: '', bots: true, diff: 'normal', limit: 0, fill: 0, autoFire: true, minimap: true,
  sens: 1, sensScope: 1, fov: 90, scale: isTouch ? 0.5 : 0.6, volume: 0.6, invertY: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
    // v1 -> v2 : on garde les réglages, mais le tir automatique passe à « activé » par défaut
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || '{}');
    delete old.autoFire;
    return { ...DEFAULTS, ...old };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* navigation privée : tant pis */ }
}
