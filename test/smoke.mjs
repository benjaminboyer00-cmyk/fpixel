// Test de fumée du serveur : lance un serveur local avec des bots WebSocket.
// Usage : node test/smoke.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 7861;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), KILL_LIMIT: '2' }, stdio: 'inherit' });
process.on('exit', () => srv.kill());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, cond, extra = '') {
  console.log(`${cond ? '  ok ' : ' FAIL'}  ${name}${cond ? '' : '  ' + extra}`);
  if (!cond) failed++;
}

class Bot {
  constructor(name) { this.name = name; this.log = []; this.waiters = []; }
  async connect() {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.t !== 's') this.log.push(m);
      if (m.t === 's') this.lastSnap = m;
      this.waiters = this.waiters.filter((w) => !(w.type === m.t && (!w.pred || w.pred(m)) && (w.res(m), true)));
    });
    await new Promise((r) => this.ws.on('open', r));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  join(mode, room) { this.send({ t: 'join', name: this.name, mode, room }); }
  waitFor(type, pred, ms = 5000) {
    const old = this.log.find((m) => m.t === type && (!pred || pred(m)));
    if (old) return Promise.resolve(old);
    return new Promise((res, rej) => {
      const w = { type, pred, res };
      this.waiters.push(w);
      setTimeout(() => { this.waiters = this.waiters.filter((x) => x !== w); rej(new Error(`timeout ${this.name} attend ${type}`)); }, ms);
    });
  }
  async waitCount(type, n, ms = 6000) {
    const t0 = Date.now();
    while (this.log.filter((m) => m.t === type).length < n) {
      if (Date.now() - t0 > ms) throw new Error(`timeout ${this.name} attend ${n}x ${type}`);
      await sleep(50);
    }
  }
  has(type, pred) { return this.log.some((m) => m.t === type && (!pred || pred(m))); }
  pos(x, y, z, yaw = 0, w = 0) { this.send({ t: 'in', x, y, z, yaw, pitch: 0, w }); }
  fire(w, o, d, extra = {}) { this.send({ t: 'fire', w, ox: o[0], oy: o[1], oz: o[2], dx: d[0], dy: d[1], dz: d[2], seed: 1, rt: Date.now(), ...extra }); }
}

async function main() {
  await sleep(700);
  const health = await (await fetch(`http://localhost:${PORT}/health`)).json();
  check('/health répond', health.ok === true);
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  check('le serveur sert le client (index.html)', html.includes('<canvas'), html.slice(0, 80));
  const trav = await fetch(`http://localhost:${PORT}/..%2fserver%2findex.js`);
  check('pas de path traversal', trav.status !== 200);

  // ---------- DUEL ----------
  console.log('\n[duel]');
  const A = new Bot('Alice'), B = new Bot('Bob');
  await A.connect(); A.join('duel');
  const wA = await A.waitFor('welcome');
  check('Alice attend un adversaire (state waiting)', wA.state === 'waiting');
  check('welcome contient la limite de frags', wA.room.limit === 2);
  await B.connect(); B.join('duel');
  await B.waitFor('welcome');
  await A.waitFor('state', (m) => m.s === 'playing');
  check('le duel démarre quand le 2e joueur arrive', true);
  const C = new Bot('Carl'); await C.connect(); C.join('duel');
  const wC = await C.waitFor('welcome');
  check('un 3e joueur est placé dans un autre salon', wC.room.id !== wA.room.id, JSON.stringify(wC.room));
  C.ws.close();

  await A.waitFor('spawn'); await B.waitFor('spawn');
  await sleep(2200); // fin de la protection d'apparition

  // Mur entre les deux : le long mur de (16,-10) fait 8x0.8x2.4
  A.pos(16, 0, -14, 0, 3); B.pos(16, 0, -6, Math.PI, 3);
  await sleep(300);
  A.fire(3, [16, 1.6, -14], [0, 0, 1]);
  await sleep(300);
  check('un mur bloque le tir', !A.has('hit'));

  // Tir en terrain dégagé, à 5 m, à hauteur de tête
  A.pos(-15, 0, -25, 0, 3); B.pos(-15, 0, -20, Math.PI, 3);
  await sleep(300);
  A.fire(3, [-15, 1.6, -25], [0, 0, 1]);
  const hit = await A.waitFor('hit');
  check('headshot revolver = kill', hit.k === 1 && hit.h === 1, JSON.stringify(hit));
  const kill = await B.waitFor('kill');
  check('kill diffusé avec le bon tueur', kill.a === wA.id && kill.v === (await B.waitFor('welcome')).id);
  const sc = await A.waitFor('score', (m) => m.p.some((r) => r[1] === 1));
  check('score mis à jour', sc.p.find((r) => r[0] === wA.id)[1] === 1);

  // Respawn après 3 s puis second kill => fin de manche (limite = 2)
  await B.waitCount('spawn', 2); // 1: démarrage du duel, 2: respawn après la mort
  check('respawn après la mort', true);
  await sleep(2200);
  A.pos(-15, 0, -25, 0, 0); B.pos(-15, 0, -22, Math.PI, 0);
  await sleep(300);
  // fusil d'assaut, poitrine (y=1.0) : 20 dégâts par balle, 5 balles
  for (let i = 0; i < 6; i++) { A.fire(0, [-15, 1.0, -25], [0, 0, 1], { seed: i }); await sleep(120); }
  const end = await A.waitFor('state', (m) => m.s === 'ended', 4000);
  check('fin de manche à la limite de frags', end.win && end.win.id === wA.id, JSON.stringify(end));
  const again = await A.waitFor('state', (m) => m.s === 'playing' && A.log.indexOf(m) > A.log.indexOf(end), 12000);
  check('nouvelle manche après l\'écran de fin', !!again);
  A.ws.close(); B.ws.close();

  // ---------- ÉQUIPES ----------
  console.log('\n[équipes]');
  const T = [new Bot('T1'), new Bot('T2'), new Bot('T3')];
  const welcomes = [];
  for (const b of T) { await b.connect(); b.join('tdm', 'test'); welcomes.push(await b.waitFor('welcome')); }
  const teams = welcomes.map((w) => w.team);
  const reds = teams.filter((t) => t === 'red').length;
  check('équipes équilibrées (2/1)', reds === 1 || reds === 2, teams.join(','));
  const sameIdx = [0, 1, 2].filter((i) => teams[i] === teams[0]);
  const enemyIdx = [0, 1, 2].filter((i) => teams[i] !== teams[0]);
  await sleep(2200);
  if (sameIdx.length >= 2 && enemyIdx.length >= 1) {
    const shooter = T[0], mate = T[sameIdx[1]], enemy = T[enemyIdx[0]];
    shooter.pos(-15, 0, -25, 0, 3); mate.pos(-15, 0, -22, 0, 3); enemy.pos(-15, 0, -19, 0, 3);
    await sleep(300);
    shooter.fire(3, [-15, 1.6, -25], [0, 0, 1]);
    const h = await shooter.waitFor('hit');
    check('le tir traverse un coéquipier et touche l\'ennemi', h.v === welcomes[enemyIdx[0]].id, JSON.stringify(h));
  }
  T.forEach((b) => b.ws.close());
  await sleep(200);

  const lobby = await (await fetch(`http://localhost:${PORT}/api/rooms`)).json();
  check('salons vides supprimés', lobby.online === 0, JSON.stringify(lobby));
}

main().catch((e) => { console.error('ERREUR', e); failed++; }).finally(() => {
  console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
  srv.kill();
  process.exit(failed ? 1 : 0);
});
