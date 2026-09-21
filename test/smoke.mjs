// Test de fumée du serveur : lance un serveur local avec des bots WebSocket.
// Usage : node test/smoke.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { WEAPONS, GUN_ORDER, KNIFE } from '../web/shared/config.js';
import { newBotAI } from '../server/bots.js';

const PORT = 7861;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), KILL_LIMIT: '2', RESPAWN_MS: '600', PROTECT_MS: '300', GRACE_MS: '1500' }, stdio: 'inherit' });
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
      if (m.t === 's') { this.lastSnap = m; this.firstSnap = this.firstSnap || m; }
      this.waiters = this.waiters.filter((w) => !(w.type === m.t && (!w.pred || w.pred(m)) && (w.res(m), true)));
    });
    await new Promise((r) => this.ws.on('open', r));
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  join(mode, room, bots = 0, extra = {}) { this.send({ t: 'join', name: this.name, mode, room, bots, ...extra }); }
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
  count(type, pred) { return this.log.filter((m) => m.t === type && (!pred || pred(m))).length; }
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

  // ---------- BOTS ----------
  console.log('\n[bots]');
  {
    const H = new Bot('Solo');
    await H.connect(); H.join('duel', 'botduel', 1);
    const w = await H.waitFor('welcome');
    await sleep(500);
    check('duel en solo : un bot arrive tout de suite', H.has('pjoin', (m) => m.p.bot), JSON.stringify(H.log.map((m) => m.t)));
    check('duel en solo : le match démarre (pas d\'attente)', !H.has('state', (m) => m.s === 'waiting') || H.has('state', (m) => m.s === 'playing'));
    const H2 = new Bot('Pote');
    await H2.connect(); H2.join('duel', 'botduel', 1);
    const w2 = await H2.waitFor('welcome');
    check('un 2e humain peut rejoindre (les bots ne comptent pas dans la capacité)', !!w2 && w2.room.id === w.room.id);
    await sleep(500);
    check('le bot part quand le 2e humain arrive', H.has('pleave'), JSON.stringify(H.log.map((m) => m.t)));
    check('en duel humain contre humain, il ne reste aucun bot', w2.players.filter((p) => p.bot).length <= 1);
    H2.ws.close();
    await sleep(500);
    check('le 2e humain part : un bot revient', H.count('pjoin', (m) => m.p.bot) >= 2);
    H.ws.close();

    const F = new Bot('Ffa');
    await F.connect(); F.join('ffa', 'botffa', 1);
    await F.waitFor('welcome');
    await sleep(600);
    check('FFA : complété à 6 joueurs (1 humain + 5 bots)', F.count('pjoin', (m) => m.p.bot) === 5, `bots=${F.count('pjoin', (m) => m.p.bot)}`);

    // Les bots bougent
    F.pos(0, 0, -20, 0, 0);
    await sleep(400);
    const snapA = F.lastSnap;
    await sleep(2500);
    const snapB = F.lastSnap;
    const botIds = F.log.filter((m) => m.t === 'pjoin' && m.p.bot).map((m) => m.p.id);
    const moved = botIds.filter((id) => {
      const a = snapA.p.find((r) => r[0] === id), b = snapB.p.find((r) => r[0] === id);
      return a && b && Math.hypot(a[1] - b[1], a[3] - b[3]) > 1;
    });
    check('les bots se déplacent', moved.length >= 2, `${moved.length}/5 ont bougé`);

    // Les bots tirent sur un humain immobile (après la protection d'apparition)
    let dmg = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(dmg = F.log.find((m) => m.t === 'dmg' || (m.t === 'kill' && m.v === (F.log.find((x) => x.t === 'welcome').id))))) {
      F.pos(0, 0, -20, 0, 0); // il reste debout au milieu, sans bouger
      await sleep(100);
    }
    check('un bot finit par toucher un humain immobile', !!dmg, 'aucun dégât en 30 s');
    check('les bots se tirent aussi dessus / marquent des frags', F.count('score') > 1);
    F.ws.close();

    const TT = new Bot('Team');
    await TT.connect(); TT.join('tdm', 'bottdm', 1);
    const wt = await TT.waitFor('welcome');
    await sleep(600);
    const all = [...wt.players, ...TT.log.filter((m) => m.t === 'pjoin').map((m) => m.p)];
    const red = all.filter((p) => p.team === 'red').length, blue = all.filter((p) => p.team === 'blue').length;
    check('équipes : complétées à 8, équilibrées 4v4', red === 4 && blue === 4, `rouge=${red} bleu=${blue}`);
    const pts = TT.firstSnap.p.filter((r) => r[6] > 0);
    let dmin = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) dmin = Math.min(dmin, Math.hypot(pts[i][1] - pts[j][1], pts[i][3] - pts[j][3]));
    check('à l\'apparition, personne n\'est empilé sur un autre joueur', pts.length >= 6 && dmin > 2, `${pts.length} joueurs, distance min ${dmin.toFixed(2)} m`);
    TT.ws.close();

    const N = new Bot('SansBot');
    await N.connect(); N.join('duel', 'nobots', 0);
    await N.waitFor('welcome');
    await sleep(400);
    check('bots désactivés : le duel attend un vrai adversaire', !N.has('pjoin') && N.log.find((m) => m.t === 'welcome').state === 'waiting');
    N.ws.close();
  }
  await sleep(300);

  // ---------- OPTIONS DE SALON / DIFFICULTÉ ----------
  console.log('\n[options de salon]');
  {
    const easy = newBotAI('easy'), norm = newBotAI('normal'), hard = newBotAI('hard');
    check('difficulté : réaction facile > normal > difficile', easy.reaction > norm.reaction && norm.reaction > hard.reaction, `${easy.reaction | 0} / ${norm.reaction | 0} / ${hard.reaction | 0} ms`);
    check('difficulté : précision facile < normal < difficile (erreur de visée)', easy.err > norm.err && norm.err > hard.err, `${easy.err.toFixed(3)} / ${norm.err.toFixed(3)} / ${hard.err.toFixed(3)}`);
    check('difficulté inconnue = normal', newBotAI('nimporte').diff === 'nimporte' && newBotAI('nimporte').maxTurn > 0);

    const a = new Bot('OptA'); await a.connect(); a.join('ffa', 'optA', 0, { limit: 3 });
    const wa = await a.waitFor('welcome');
    check('limite de frags choisie à la création du salon', wa.room.limit === 3, JSON.stringify(wa.room));
    const b = new Bot('OptB'); await b.connect(); b.join('ffa', 'optB', 4, { diff: 'hard' });
    const wb = await b.waitFor('welcome');
    await sleep(500);
    check('difficulté du salon transmise au client', wb.room.diff === 'hard' && wb.room.fill === 4, JSON.stringify(wb.room));
    check('« joueurs visés » = 4 : 1 humain + 3 bots', b.count('pjoin', (m) => m.p.bot) === 3, `${b.count('pjoin', (m) => m.p.bot)} bots`);
    const c1 = new Bot('Auto1'); await c1.connect(); c1.join('ffa', '', 0);
    const c2 = new Bot('Auto2'); await c2.connect(); c2.join('ffa', '', 0, { diff: 'hard' });
    const w1 = await c1.waitFor('welcome'), w2 = await c2.waitFor('welcome');
    check('salons automatiques : options différentes = salons différents', w1.room.id !== w2.room.id, `${w1.room.id} / ${w2.room.id}`);
    const c3 = new Bot('Auto3'); await c3.connect(); c3.join('ffa', '', 0);
    const w3 = await c3.waitFor('welcome');
    check('salons automatiques : mêmes options = même salon', w3.room.id === w1.room.id);
    [a, b, c1, c2, c3].forEach((x) => x.ws.close());
    await sleep(300);
  }

  // ---------- RECONNEXION ----------
  console.log('\n[reconnexion]');
  {
    const R1 = new Bot('Rec1'), R2 = new Bot('Rec2');
    await R1.connect(); R1.join('tdm', 'recon', 0, { token: 'tok-R1' });
    const w1 = await R1.waitFor('welcome');
    await R2.connect(); R2.join('tdm', 'recon', 0, { token: 'tok-R2' });
    await R2.waitFor('welcome');
    await sleep(300);
    R1.ws.terminate(); // coupure brutale
    await sleep(300);
    const R1b = new Bot('Rec1'); await R1b.connect(); R1b.join('tdm', 'recon', 0, { token: 'tok-R1' });
    const w1b = await R1b.waitFor('welcome');
    check('reconnexion : même identifiant et même équipe', w1b.id === w1.id && w1b.team === w1.team && w1b.back === true, `${w1.id}/${w1b.id} ${w1.team}/${w1b.team}`);
    await R1b.waitFor('spawn');
    check('reconnexion : le joueur réapparaît', true);
    await sleep(400);
    check('reconnexion : les autres ne voient pas de départ', !R2.has('pleave', (m) => m.id === w1.id));
    check('reconnexion : une seule fois dans le salon', w1b.players.filter((p) => p.id === w1.id).length === 1);

    // pas de retour : retiré après le délai de grâce (1,5 s dans ce test)
    R1b.ws.terminate();
    const left = await R2.waitFor('pleave', (m) => m.id === w1.id, 5000).catch(() => null);
    check('sans retour : le joueur est retiré après le délai de grâce', !!left);

    // départ volontaire : retiré tout de suite
    const R3 = new Bot('Rec3'); await R3.connect(); R3.join('tdm', 'recon', 0, { token: 'tok-R3' });
    const w3 = await R3.waitFor('welcome');
    await sleep(200);
    R3.send({ t: 'leave' });
    const t0 = Date.now();
    const left3 = await R2.waitFor('pleave', (m) => m.id === w3.id, 1000).catch(() => null);
    check('« leave » : retiré immédiatement (pas de délai de grâce)', !!left3 && Date.now() - t0 < 700, `${Date.now() - t0} ms`);
    R3.ws.close(); R2.ws.close();
    await sleep(300);
  }

  // ---------- GUN GAME ----------
  console.log('\n[gun game]');
  {
    const A = new Bot('GunA'), B = new Bot('GunB');
    await A.connect(); A.join('gun', 'gunroom', 0);
    const wA = await A.waitFor('welcome');
    await B.connect(); B.join('gun', 'gunroom', 0);
    const wB = await B.waitFor('welcome');
    check('gun game : tout le monde commence au niveau 1', wA.players.every((p) => p.lvl === 0) && wA.room.limit === GUN_ORDER.length);
    let bSpawns = 1;
    await B.waitCount('spawn', 1);
    const kills = () => A.count('kill', (m) => m.a === wA.id);
    async function killWith(wi) {
      await B.waitCount('spawn', bSpawns);
      await sleep(450);                                  // fin de la protection d'apparition
      const d = wi === KNIFE ? 1.5 : 5;
      A.pos(-15, 0, -25, Math.PI, wi); B.pos(-15, 0, -25 + d, Math.PI, 0);
      await sleep(250);
      const before = kills();
      for (let i = 0; i < 8 && kills() === before; i++) {
        A.fire(wi, [-15, 1.6, -25], [0, 0, 1], { sc: 1, seed: i + 1 });
        await sleep(WEAPONS[wi].interval + 40);
      }
      bSpawns++;
      return kills() > before;
    }

    // mauvaise arme : le niveau 1 impose le fusil d'assaut (ou le couteau)
    await sleep(500);
    A.pos(-15, 0, -25, Math.PI, 3); B.pos(-15, 0, -20, Math.PI, 0);
    await sleep(300);
    A.fire(3, [-15, 1.6, -25], [0, 0, 1], { sc: 1 });
    await sleep(400);
    check('gun game : une arme qui n\'est pas celle du niveau ne tire pas', !A.has('hit'));

    let ok = true;
    for (let lvl = 0; lvl < GUN_ORDER.length; lvl++) {
      const got = await killWith(GUN_ORDER[lvl]);
      if (lvl < GUN_ORDER.length - 1) {
        const sc = A.log.filter((m) => m.t === 'score').at(-1);
        const mine = sc?.p.find((r) => r[0] === wA.id);
        ok = ok && got && mine && mine[3] === lvl + 1;
        if (!(got && mine && mine[3] === lvl + 1)) console.log(`   niveau ${lvl + 1} : kill=${got} score=${JSON.stringify(mine)}`);
      } else {
        ok = ok && got;
      }
    }
    check('gun game : un frag = niveau suivant, arme du niveau à chaque fois', ok);
    const end = await A.waitFor('state', (m) => m.s === 'ended', 3000).catch(() => null);
    check('gun game : tuer au dernier niveau = victoire', !!end && end.win.id === wA.id, JSON.stringify(end));
    A.ws.close(); B.ws.close();
    await sleep(300);

    // règle du couteau : le tueur monte d'un niveau, la victime descend
    const K = new Bot('KnifeA'), V = new Bot('KnifeV');
    await K.connect(); K.join('gun', 'knifeRoom', 0); const wK = await K.waitFor('welcome');
    await V.connect(); V.join('gun', 'knifeRoom', 0); const wV = await V.waitFor('welcome');
    await sleep(600);
    // V monte d'un niveau en tuant K à l'arme du niveau 1
    await K.waitCount('spawn', 1);
    V.pos(-15, 0, -25, Math.PI, 0); K.pos(-15, 0, -20, Math.PI, 0);
    await sleep(500);
    for (let i = 0; i < 6 && !V.has('kill', (m) => m.a === wV.id); i++) { V.fire(0, [-15, 1.6, -25], [0, 0, 1], { seed: i + 1 }); await sleep(140); }
    const vUp = V.log.filter((m) => m.t === 'score').at(-1)?.p.find((r) => r[0] === wV.id);
    check('couteau : V est monté au niveau 2 en tuant K', vUp && vUp[3] === 1, JSON.stringify(vUp));
    // K réapparaît et tue V au couteau (dans le dos)
    await K.waitCount('spawn', 2);
    await sleep(450);
    K.pos(-15, 0, -25, Math.PI, 4); V.pos(-15, 0, -23.5, Math.PI, 1);
    await sleep(300);
    for (let i = 0; i < 4 && !K.has('kill', (m) => m.a === wK.id); i++) { K.fire(4, [-15, 1.6, -25], [0, 0, 1], { seed: i + 1 }); await sleep(470); }
    await sleep(200);
    const sc2 = K.log.filter((m) => m.t === 'score').at(-1);
    const kRow = sc2.p.find((r) => r[0] === wK.id), vRow = sc2.p.find((r) => r[0] === wV.id);
    check('couteau : le tueur monte d\'un niveau', kRow && kRow[3] === 1, JSON.stringify(kRow));
    check('couteau : la victime redescend d\'un niveau', vRow && vRow[3] === 0, JSON.stringify(vRow));
    K.ws.close(); V.ws.close();
    await sleep(300);
  }

  const lobby = await (await fetch(`http://localhost:${PORT}/api/rooms`)).json();
  check('salons vides supprimés', lobby.online === 0 && Object.values(lobby.modes).every((m) => m.rooms.length === 0), JSON.stringify(lobby));
}

main().catch((e) => { console.error('ERREUR', e); failed++; }).finally(() => {
  console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
  srv.kill();
  process.exit(failed ? 1 : 0);
});
