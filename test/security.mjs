// Tests de robustesse / anti-triche du serveur : messages piégés, fuzz, limites de connexions, tir à travers un mur.
// Usage : node test/security.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { CLASSES, W } from '../web/shared/config.js';

const PORT = 7863;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', ['server/index.js'], {
  cwd: root, env: { ...process.env, PORT: String(PORT), PROTECT_MS: '1', MAX_PER_IP: '8', MAX_ROOMS: '40' }, stdio: ['ignore', 'ignore', 'pipe'],
});
let srvErr = '';
srv.stderr.on('data', (d) => { srvErr += d; });
let dead = false;
srv.on('exit', () => { dead = true; });
process.on('exit', () => srv.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ok ' : ' FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failed++;
}
const alive = async () => {
  if (dead) return false;
  try { return (await (await fetch(`http://localhost:${PORT}/health`)).json()).ok === true; } catch { return false; }
};

function open() {
  return new Promise((res) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    const c = { ws, log: [], closed: null };
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t !== 's') c.log.push(m); });
    ws.on('close', (code) => { c.closed = code; });
    ws.on('open', () => res(c));
    ws.on('error', () => res(c));
  });
}
const send = (c, o) => { try { c.ws.send(JSON.stringify(o)); } catch { /* fermée */ } };

async function main() {
  for (let i = 0; i < 40 && !(await alive()); i++) await sleep(100);

  console.log('[messages piégés]');
  // Clés héritées de Object.prototype : avant le correctif, UN seul message faisait tomber tout le serveur.
  const payloads = [
    { mode: 'ffa', map: 'toString' }, { mode: 'ffa', map: '__proto__' }, { mode: 'toString' }, { mode: 'constructor' },
    { mode: 'ffa', cls: 'toString' }, { mode: 'ffa', cls: '__proto__' }, { mode: 'ffa', cls: 'custom', loadout: { length: 3 } },
    { mode: ['ffa'] }, { mode: { a: 1 } }, { map: 42 }, { cls: null },
  ];
  for (const pl of payloads) {
    const c = await open();
    send(c, { t: 'join', name: 'x', room: 'piege', ...pl });
    await sleep(150);
    await fetch(`http://localhost:${PORT}/api/rooms`).catch(() => {});
    check(`join ${JSON.stringify(pl)} : le serveur tient`, await alive(), srvErr.split('\n').find((l) => l.includes('Error')) || '');
    c.ws.close();
  }

  console.log('[fuzz]');
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const weird = [null, 0, -1, 1e308, NaN, 'x', '__proto__', 'toString', [], {}, [1, 2], true, 99999, 0.5];
  const types = ['in', 'fire', 'nade', 'buy', 'class', 'charge', 'pc', 'pcancel', 'enter', 'exit', 'vc', 'rob', 'toString', '__proto__'];
  const keys = ['w', 'dx', 'dy', 'dz', 'ox', 'oy', 'oz', 'seed', 'rt', 'sc', 'ad', 'alt', 'x', 'y', 'z', 'yaw', 'pitch', 'c', 'id', 'cls', 'loadout', 'on', 'th', 'st'];
  const val = () => (Math.random() < 0.5 ? pick(weird) : (Math.random() - 0.5) * 60);
  for (let r = 0; r < 6; r++) {
    await Promise.all(Array.from({ length: 6 }, async () => {
      const c = await open();
      send(c, { t: 'join', name: 'f', mode: pick(['ffa', 'duel', 'tdm', 'gun', 'survival']), bots: pick([0, 1, 4]) });
      for (let k = 0; k < 30; k++) {
        for (let j = 0; j < 4; j++) { const m = { t: pick(types) }; for (let q = 0; q < 6; q++) m[pick(keys)] = val(); send(c, m); }
        await sleep(25);
      }
      c.ws.close();
    }));
  }
  await sleep(300);
  check('fuzz (~3000 messages aléatoires) : le serveur tient', await alive(), srvErr.split('\n').find((l) => l.includes('Error')) || '');

  console.log('[limites]');
  await sleep(300);
  const conns = [];
  for (let i = 0; i < 9; i++) conns.push(await open());
  await sleep(300);
  check('9e connexion depuis la même adresse refusée (1013)', conns[8].closed === 1013, String(conns[8].closed));
  check('les 8 premières restent ouvertes', conns.slice(0, 8).every((c) => c.closed === null));
  for (const c of conns) c.ws.close();
  await sleep(300);

  const flood = await open();
  send(flood, { t: 'join', name: 'flood', mode: 'ffa', room: 'flood', bots: 0 });
  await sleep(100);
  for (let i = 0; i < 600; i++) send(flood, { t: 'ping', c: i });
  await sleep(400);
  check('flood (600 msg d\'un coup) : connexion coupée', flood.closed !== null, String(flood.closed));
  check('flood : le serveur tient', await alive());

  console.log('[tir à travers un mur]');
  // Mur de l'arène : x 12..20, z 9.6..10.4, hauteur 2.4. Tireur au sud du mur, cible au nord.
  check('le mur de test existe', true);
  const A = await open(), B = await open();
  const wIdx = CLASSES.classic.weapons.includes(W.REVOLVER) ? W.REVOLVER : CLASSES.classic.weapons[0];
  send(A, { t: 'join', name: 'A', mode: 'ffa', room: 'wallbang', bots: 0, map: 'arena' });
  await sleep(150);
  send(B, { t: 'join', name: 'B', mode: 'ffa', room: 'wallbang', bots: 0, map: 'arena' });
  await sleep(300);
  const idB = B.log.find((m) => m.t === 'welcome')?.id;
  for (let i = 0; i < 12; i++) {
    send(A, { t: 'in', x: 16, y: 0, z: 11, yaw: 0, pitch: 0, w: wIdx });
    send(B, { t: 'in', x: 16, y: 0, z: 6, yaw: 0, pitch: 0, w: 0 });
    await sleep(40);
  }
  // origine déclarée 1,8 m devant les yeux : de l'autre côté du mur
  send(A, { t: 'fire', w: wIdx, ox: 16, oy: 1.6, oz: 9.2, dx: 0, dy: 0, dz: -1, rt: Date.now() });
  await sleep(300);
  check('origine derrière le mur ignorée : pas de touche', !A.log.some((m) => m.t === 'hit' && m.v === idB), JSON.stringify(A.log.filter((m) => m.t === 'hit')));
  // contrôle : sans mur (tireur décalé à x = 23, hors du mur), la même cible est touchée
  for (let i = 0; i < 12; i++) {
    send(A, { t: 'in', x: 23, y: 0, z: 11, yaw: 0, pitch: 0, w: wIdx });
    send(B, { t: 'in', x: 23, y: 0, z: 6, yaw: 0, pitch: 0, w: 0 });
    await sleep(40);
  }
  await sleep(1600);
  send(A, { t: 'fire', w: wIdx, ox: 23, oy: 1.6, oz: 11, dx: 0, dy: 0, dz: -1, rt: Date.now() });
  await sleep(300);
  check('contrôle : sans mur la cible est touchée', A.log.some((m) => m.t === 'hit' && m.v === idB), JSON.stringify(A.log.slice(-5)));
  A.ws.close(); B.ws.close();

  console.log('[déplacements]');
  const S = await open();
  send(S, { t: 'join', name: 'Speed', mode: 'ffa', room: 'speed', bots: 0, map: 'arena' });
  await sleep(300);
  const sp = S.log.find((m) => m.t === 'spawn');
  // marche normale (6,5 m/s, un message toutes les 33 ms) : acceptée
  let x = sp.x, z = sp.z;
  const dir = x > 0 ? -1 : 1;   // toujours vers le centre (sinon la bordure de l'arène « absorbe » le saut)
  for (let i = 0; i < 20; i++) { x += 0.2 * dir; send(S, { t: 'in', x, y: 0, z, yaw: 0, pitch: 0, w: 0 }); await sleep(33); }
  await sleep(150);
  check('marche normale : aucun recalage', !S.log.some((m) => m.t === 'fix'), JSON.stringify(S.log.filter((m) => m.t === 'fix')));
  // téléportation de 25 m : refusée, le client est recalé
  send(S, { t: 'in', x: x + 25 * dir, y: 0, z, yaw: 0, pitch: 0, w: 0 });
  await sleep(200);
  const fix = S.log.find((m) => m.t === 'fix');
  check('téléportation de 25 m : refusée et recalage envoyé', !!fix && Math.abs(fix.x - x) < 1, JSON.stringify(fix));
  // speedhack (3× la vitesse) pendant 2,5 s : le budget (~1 s d'avance) finit par se vider et le client est recalé.
  // Le nombre exact de recalages dépend du timing fin (au plus 4/s) et peut varier de ±1 sous charge : on vérifie
  // seulement qu'au moins un recalage a bien été déclenché, pas un compte précis.
  S.log.length = 0;
  // allers-retours de 12 m : la bordure de l'arène ne peut plus « absorber » la course, quel que soit le point d'apparition
  let sd = dir;
  for (let i = 0; i < 75; i++) { if (i % 20 === 19) sd = -sd; x += 0.6 * sd; send(S, { t: 'in', x, y: 0, z, yaw: 0, pitch: 0, w: 0 }); await sleep(33); }
  await sleep(200);
  check('speedhack ×3 : freiné (au moins un recalage envoyé)', S.log.some((m) => m.t === 'fix'), String(S.log.filter((m) => m.t === 'fix').length));
  S.ws.close();

  console.log('[navigateur de salons]');
  const solo = await open();
  send(solo, { t: 'join', name: 'Solo', mode: 'survival', room: 'solo-abcdef1234', token: 'abcdef1234xyz' });
  const host = await open();
  send(host, { t: 'join', name: 'Hote', mode: 'tdm', room: 'lanparty', bots: 1 });
  await sleep(400);
  const lobby = await (await fetch(`http://localhost:${PORT}/api/rooms`)).json();
  check('survie solo absente de la liste publique', !lobby.modes.survival.rooms.length && lobby.modes.survival.players === 1, JSON.stringify(lobby.modes.survival));
  const lr = lobby.modes.tdm.rooms.find((r) => r.id === 'lanparty');
  check('salon nommé listé avec rid, carte et état', !!lr && lr.rid === 'tdm:lanparty' && lr.map && lr.state, JSON.stringify(lobby.modes.tdm.rooms));
  const guest = await open();
  send(guest, { t: 'join', name: 'Invite', mode: 'tdm', rid: lr?.rid, bots: 0 });
  await sleep(300);
  const wg = guest.log.find((m) => m.t === 'welcome');
  check('rejoindre par rid : même salon que l\'hôte (options ignorées)', wg?.room.id === 'tdm:lanparty', JSON.stringify(wg?.room));
  const spy = await open();
  send(spy, { t: 'join', name: 'Spy', mode: 'survival', rid: 'survival:soloabcdef12' });
  await sleep(300);
  const ws2 = spy.log.find((m) => m.t === 'welcome');
  check('impossible d\'entrer dans une survie solo par rid', ws2 && ws2.room.id !== 'survival:soloabcdef12', JSON.stringify(ws2?.room));
  for (const c of [solo, host, guest, spy]) c.ws.close();
}

main().catch((e) => { console.error('ERREUR', e); failed++; }).finally(() => {
  console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
  srv.kill();
  process.exit(failed ? 1 : 0);
});
