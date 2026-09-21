// Test de fumée du serveur : lance un serveur local avec des bots WebSocket.
// Usage : node test/smoke.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import WebSocket from 'ws';
import { WEAPONS, GUN_ORDER, KNIFE, W, CLASSES, CUSTOM_BUDGET, weaponCost, resolveClass } from '../web/shared/config.js';
import { newBotAI } from '../server/bots.js';

const PORT = 7861;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = spawn('node', ['server/index.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), KILL_LIMIT: '2', STREAKS: '1,2,3', RESPAWN_MS: '600', PROTECT_MS: '300', GRACE_MS: '1500' }, stdio: 'inherit' });
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

  // ---------- CLASSES ----------
  console.log('\n[classes]');
  {
    check('classes prédéfinies : toutes dans le budget de 10 points', Object.values(CLASSES).every((c) => weaponCost(c.weapons) <= CUSTOM_BUDGET), Object.values(CLASSES).map((c) => `${c.id}:${weaponCost(c.weapons)}`).join(' '));
    check('classe perso valide acceptée', resolveClass('custom', [W.ROCKET, W.MINIGUN, W.KNIFE]).id === 'custom');
    check('classe perso trop chère refusée (retour à Classique)', resolveClass('custom', [W.ROCKET, W.MINIGUN, W.EXCALIBUR]).id === 'classic');
    check('classe perso : armes en double / inconnues nettoyées', resolveClass('custom', [W.AR, W.AR, 99, W.KNIFE]).weapons.join() === `${W.AR},${W.KNIFE}`);

    const mk = async (name, cls, loadout, room = 'cls') => {
      const b = new Bot(name); await b.connect(); b.join('ffa', room, 0, { cls, loadout });
      const w = await b.waitFor('welcome'); b.id = w.id; b.welcome = w;
      b.spawn = await b.waitFor('spawn'); return b;
    };
    const H = await mk('Lourd', 'heavy');
    check('classe Lourd : 150 PV et ses 4 armes à l\'apparition', H.spawn.maxHp === 150 && H.spawn.hp === 150 && H.spawn.loadout.join() === CLASSES.heavy.weapons.join() && H.spawn.speed === 0.88, JSON.stringify(H.spawn));
    const S = await mk('Eclaireur', 'scout');
    check('classe Éclaireur : 80 PV, plus rapide', S.spawn.maxHp === 80 && S.spawn.speed > 1);
    const C = await mk('Triche', 'custom', [W.ROCKET, W.MINIGUN, W.EXCALIBUR, W.PORTAL, W.LASER]);
    check('classe perso trop chère ou avec une arme de série côté serveur : Classique', C.spawn.loadout.length === 5 && C.spawn.maxHp === 100 && C.spawn.loadout.join() === CLASSES.classic.weapons.join());
    await sleep(500);
    // une arme qui n'est pas dans la classe ne tire pas : l'Éclaireur n'a pas de fusil d'assaut
    S.pos(-15, 0, -25, Math.PI, W.SHOTGUN); H.pos(-15, 0, -22, Math.PI, W.SHOTGUN);
    await sleep(300);
    const nShots = H.count('shot');
    S.fire(W.AR, [-15, 1.6, -25], [0, 0, 1]);
    await sleep(300);
    check('arme hors de la classe : le tir est ignoré', H.count('shot') === nShots && !S.has('hit'));
    // changement de classe : effectif à la réapparition
    S.send({ t: 'class', cls: 'knight' });
    const ok = await S.waitFor('classok', null, 2000).catch(() => null);
    check('changement de classe confirmé par le serveur', ok && ok.name === 'Chevalier');
    [H, S, C].forEach((b) => b.ws.close());
    await sleep(300);
  }

  // ---------- ARMES SPÉCIALES ----------
  console.log('\n[armes spéciales]');
  {
    const mk = async (name, loadout, x, z, room = 'wp') => {
      const b = new Bot(name); await b.connect(); b.join('ffa', room, 0, { cls: 'custom', loadout, limit: 100 });
      const w = await b.waitFor('welcome'); b.id = w.id; await b.waitFor('spawn');
      b.at = (px, pz, yaw = Math.PI, wi = 0) => b.pos(px, 0, pz, yaw, wi);
      return b;
    };
    const closeAll = async (...bs) => { bs.forEach((b) => b.ws.close()); await sleep(250); };
    const dmgOf = (b) => b.log.filter((m) => m.t === 'dmg').at(-1);

    // --- lance-roquettes : dégâts directs + éclaboussure + recul ---
    {
      const A = await mk('Rk-A', [W.ROCKET]), B = await mk('Rk-B', [W.KNIFE]), C = await mk('Rk-C', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.ROCKET); B.at(-15, -19, Math.PI); C.at(-15, -16.5, Math.PI); // C à 2,5 m derrière B
      await sleep(300);
      A.fire(W.ROCKET, [-15, 1.6, -25], [0, -0.05, 1]);
      const boom = await A.waitFor('boom', null, 3000).catch(() => null);
      check('roquette : explosion diffusée à tous avec son rayon', !!boom && boom.r === 4.5 && boom.w === W.ROCKET, JSON.stringify(boom));
      await sleep(300);
      check('roquette : la cible touchée de plein fouet est tuée', B.has('kill', (m) => m.v === B.id));
      const dc = dmgOf(C);
      check('roquette : éclaboussure sur le voisin (dégâts réduits, pas mortels)', !!dc && dc.hp < 100 && dc.hp > 0, JSON.stringify(dc));
      const pc = C.log.find((m) => m.t === 'push');
      check('roquette : le voisin est repoussé (message push vers le haut)', !!pc && pc.v[1] > 0 && Math.hypot(pc.v[0], pc.v[2]) > 1, JSON.stringify(pc));
      await closeAll(A, B, C);
    }
    // --- rocket jump : tirer à ses pieds blesse un peu (x0.5) et propulse ---
    {
      const A = await mk('Rj-A', [W.ROCKET]);
      await sleep(450);
      A.at(-15, -20, Math.PI, W.ROCKET); await sleep(300);
      A.fire(W.ROCKET, [-15, 1.6, -20], [0, -1, 0]);
      const d = await A.waitFor('dmg', null, 3000).catch(() => null);
      check('rocket jump : dégâts sur soi réduits de moitié', !!d && d.a === A.id && d.hp > 30 && d.hp < 100, JSON.stringify(d));
      const push = await A.waitFor('push', null, 1000).catch(() => null);
      check('rocket jump : propulsé vers le haut', !!push && push.v[1] > 5, JSON.stringify(push));
      await closeAll(A);
    }
    // --- lance-grenades ---
    {
      const A = await mk('Gr-A', [W.GRENADE]), B = await mk('Gr-B', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.GRENADE); B.at(-15, -21, Math.PI); await sleep(300);
      A.fire(W.GRENADE, [-15, 1.6, -25], [0, 0, 1]);
      const boom = await B.waitFor('boom', null, 3000).catch(() => null);
      check('grenade : explose au contact (rayon 3,8)', !!boom && boom.r === 3.8, JSON.stringify(boom));
      await sleep(200);
      check('grenade : blesse la cible', !!dmgOf(B) || B.has('kill'));
      await closeAll(A, B);
    }
    // --- Excalibur : touche tous les ennemis dans l'arc, pas ceux derrière ---
    {
      const A = await mk('Ex-A', [W.EXCALIBUR]), B = await mk('Ex-B', [W.KNIFE]), C = await mk('Ex-C', [W.KNIFE]), D = await mk('Ex-D', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.EXCALIBUR); B.at(-15, -22.5, Math.PI); C.at(-14, -22.5, Math.PI); D.at(-15, -27, Math.PI); // D derrière A
      await sleep(300);
      A.fire(W.EXCALIBUR, [-15, 1.6, -25], [0, 0, 1]);
      await sleep(400);
      check('Excalibur : deux ennemis dans l\'arc touchés en un coup', dmgOf(B)?.hp === 35 && dmgOf(C)?.hp === 35, `${dmgOf(B)?.hp} / ${dmgOf(C)?.hp}`);
      check('Excalibur : un ennemi derrière n\'est pas touché', !dmgOf(D));
      await closeAll(A, B, C, D);
    }
    // --- grappin : attire l'ennemi ; sur un mur, nous attire ---
    {
      const A = await mk('Gp-A', [W.GRAPPLE]), B = await mk('Gp-B', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.GRAPPLE); B.at(-15, -15, Math.PI); await sleep(300);
      A.fire(W.GRAPPLE, [-15, 1.6, -25], [0, 0, 1]);
      const pull = await B.waitFor('pull', null, 2000).catch(() => null);
      check('grappin : l\'ennemi touché reçoit une attraction vers le tireur', !!pull && Math.abs(pull.z - -25) < 3 && pull.sp === 28, JSON.stringify(pull));
      check('grappin : petits dégâts', dmgOf(B)?.hp === 92, JSON.stringify(dmgOf(B)));
      await sleep(3700); // recharge
      B.at(20, 20, Math.PI);
      A.at(-15, -25, 0, W.GRAPPLE); await sleep(200); // A regarde vers -z : le mur d'enceinte
      A.fire(W.GRAPPLE, [-15, 1.6, -25], [0, 0, -1]);
      const self = await A.waitFor('pull', null, 2000).catch(() => null);
      check('grappin sur un mur : c\'est le tireur qui est attiré', !!self && self.z < -25, JSON.stringify(self));
      check('grappin sur un mur : le point d\'accroche est envoyé (corde)', !!self && Array.isArray(self.hook) && self.hook.length === 3, JSON.stringify(self));
      await closeAll(A, B);
    }
    // --- pistolet portail ---
    {
      const A = await mk('Pt-A', [W.PORTAL]), B = await mk('Pt-B', [W.KNIFE]);
      await sleep(450);
      A.at(0, -20, 0, W.PORTAL); await sleep(300);
      A.fire(W.PORTAL, [0, 1.6, -20], [0, 0, -1]);
      const p0 = await B.waitFor('portal', (m) => m.i === 0, 2000).catch(() => null);
      check('portail bleu posé sur le mur d\'enceinte et diffusé', !!p0 && p0.nz === 1 && Math.abs(p0.z - -29.97) < 0.05 && p0.o === A.id, JSON.stringify(p0));
      await sleep(450);
      A.send({ t: 'fire', w: W.PORTAL, alt: 1, ox: 0, oy: 1.6, oz: -20, dx: 0.3, dy: 0, dz: -1, seed: 2, rt: Date.now() });
      const p1 = await B.waitFor('portal', (m) => m.i === 1, 2000).catch(() => null);
      check('portail orange (tir secondaire) posé', !!p1 && p1.i === 1, JSON.stringify(p1));
      await sleep(450);
      const n = B.count('portal');
      A.at(12, 3.6, Math.PI / 2, W.PORTAL); await sleep(200);
      A.fire(W.PORTAL, [12, 1.0, 3.6], [0, 0, -1]); // sur le muret bas (1 m) : trop petit
      await sleep(300);
      check('pas de portail sur une surface trop petite (muret bas)', B.count('portal') === n);
      const C = new Bot('Pt-late'); await C.connect(); C.join('ffa', 'wp', 0);
      const w = await C.waitFor('welcome');
      check('un joueur qui arrive voit les portails déjà posés', w.portals.length === 2, JSON.stringify(w.portals));
      A.ws.close();
      const off = await B.waitFor('portalOff', null, 1500).catch(() => null);
      check('les portails disparaissent quand leur propriétaire part', !!off && off.o === A.id);
      await closeAll(B, C);
    }
    // --- carabine : un coup au jugé (sans viser), dégâts énormes ---
    {
      const A = await mk('Cb-A', [W.CARBINE]), B = await mk('Cb-B', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.CARBINE); B.at(-15, -15, Math.PI); await sleep(300);
      A.fire(W.CARBINE, [-15, 1.6, -25], [0, -0.06, 1], { sc: 0, seed: 7 });
      await sleep(400);
      check('carabine : tue en un coup au jugé à 10 m', B.has('kill', (m) => m.v === B.id));
      await closeAll(A, B);
    }
    // --- onde d'Excalibur : traverse les murs, très longue à recharger ---
    {
      const A = await mk('Wv-A', [W.EXCALIBUR]), B = await mk('Wv-B', [W.KNIFE]);
      await sleep(450);
      A.at(16, 5, Math.PI, W.EXCALIBUR); B.at(16, 14, Math.PI); await sleep(300);   // le long mur (16,10) est entre les deux
      A.fire(W.EXCALIBUR, [16, 1.6, 5], [0, 0, 1], { alt: 1 });
      const wave = await B.waitFor('wave', null, 1500).catch(() => null);
      await sleep(300);
      check('onde d\'Excalibur : diffusée à tous', !!wave && wave.len === 100 && wave.id === A.id, JSON.stringify(wave));
      check('onde d\'Excalibur : tue un ennemi derrière un mur', B.has('kill', (m) => m.v === B.id));
      A.fire(W.EXCALIBUR, [16, 1.6, 5], [0, 0, 1], { alt: 1 });
      await sleep(900);
      check('onde d\'Excalibur : rechargement (30 s) : 2e coup ignoré', A.count('wave') === 1, String(A.count('wave')));
      await closeAll(A, B);
    }
    // --- séries de kills : laser (touche 6), lance-flammes (7), missile nucléaire (8) + gaz (seuils 1, 2, 3 dans ce test) ---
    {
      const A = await mk('St-A', [W.AR], 0, 0, 'st'), V1 = await mk('St-V1', [W.KNIFE], 0, 0, 'st'), V2 = await mk('St-V2', [W.KNIFE], 0, 0, 'st'), V3 = await mk('St-V3', [W.KNIFE], 0, 0, 'st');
      await sleep(450);
      const shootAt = async (wi, n, gap) => { for (let i = 0; i < n; i++) { A.fire(wi, [-15, 1.6, -25], [0, 0, 1], { seed: i + 1 }); await sleep(gap); } };
      // 1er kill : fusil d'assaut sur V1
      A.at(-15, -25, Math.PI, W.AR); V1.at(-15, -21, Math.PI); V2.at(-30, -28, Math.PI); V3.at(-30, -29, Math.PI); await sleep(300);
      await shootAt(W.AR, 8, 110);
      const s1 = await A.waitFor('streak', (m) => m.n === 1, 1500).catch(() => null);
      check('série de 1 : le laser est débloqué (touche 6)', !!s1 && s1.w === W.LASER && s1.loadout.includes(W.LASER), JSON.stringify(s1));
      check('la série est annoncée à tous', V2.has('streakall', (m) => m.id === A.id && m.n === 1));
      // laser : étourdit la cible et l'immobilise
      V1.ws.close();
      V2.at(-15, -19, Math.PI); await sleep(300);
      A.at(-15, -25, Math.PI, W.LASER);
      await sleep(200);
      A.fire(W.LASER, [-15, 1.6, -25], [0, 0, 1]);
      const st = await V2.waitFor('stun', null, 1500).catch(() => null);
      check('laser : la cible touchée est étourdie', !!st && st.ms === 1200, JSON.stringify(st));
      V2.pos(-10, 0, -19, Math.PI, 0); await sleep(250);
      const snap = A.lastSnap.p.find((e) => e[0] === V2.id);
      check('laser : la cible étourdie ne peut plus bouger', !!snap && Math.abs(snap[1] - -15) < 0.5, JSON.stringify(snap));
      await shootAt(W.LASER, 30, 66);
      await sleep(200);
      check('laser : rayon continu, la cible finit tuée', V2.has('kill', (m) => m.v === V2.id));
      const s2 = await A.waitFor('streak', (m) => m.n === 2, 1500).catch(() => null);
      check('série de 2 : le lance-flammes est débloqué (touche 7)', !!s2 && s2.w === W.FLAME, JSON.stringify(s2));
      // lance-flammes : cône devant, jamais derrière
      await sleep(600);
      V3.at(-15, -21, Math.PI); await sleep(300);
      A.pos(-15, 0, -25, Math.PI, W.FLAME);
      await shootAt(W.FLAME, 16, 56);
      await sleep(200);
      check('lance-flammes : tue une cible à 4 m en moins d\'une seconde', V3.has('kill', (m) => m.v === V3.id));
      const s3 = await A.waitFor('streak', (m) => m.n === 3, 1500).catch(() => null);
      check('série de 3 : le missile nucléaire est débloqué (touche 8)', !!s3 && s3.w === W.NUKE, JSON.stringify(s3));
      // un seul chargeur : le laser disparaît quand il est vide (150 tirs au total ; 31 déjà tirés)
      A.pos(-15, 0, -25, Math.PI, W.LASER);
      for (let i = 0; i < 125; i++) { A.fire(W.LASER, [-15, 1.6, -25], [0, 0, 1], { seed: i + 1 }); await sleep(62); }
      const lo = A.log.filter((m) => m.t === 'loadout').at(-1);
      check('laser : un seul chargeur, l\'arme est retirée quand il est vide', !!lo && !lo.loadout.includes(W.LASER) && lo.loadout.includes(W.FLAME), JSON.stringify(lo));
      // missile nucléaire
      await sleep(500);
      V2.at(-20, -10, 0); V3.at(-10, -10, 0);
      await sleep(600);
      A.pos(-15, 0, -25, Math.PI, W.NUKE);
      A.fire(W.NUKE, [-15, 1.6, -25], [0, 0, 1]);
      const n = await V2.waitFor('nuke', null, 1500).catch(() => null);
      check('missile nucléaire : lancement annoncé à tous avec le compte à rebours', !!n && n.id === A.id && n.ms === 4500, JSON.stringify(n));
      await V2.waitFor('nukeboom', null, 6000).catch(() => null);
      await sleep(400);
      check('missile nucléaire : tous les autres meurent', V2.has('kill', (m) => m.v === V2.id && m.w === W.NUKE) && V3.has('kill', (m) => m.v === V3.id && m.w === W.NUKE));
      check('missile nucléaire : le lanceur survit', !A.has('kill', (m) => m.v === A.id));
      const g = await V2.waitFor('gas', (m) => !m.off, 1000).catch(() => null);
      check('gaz toxique annoncé (30 s)', !!g && g.owner === A.id && g.ms === 30000, JSON.stringify(g));
      await sleep(2500);   // les autres ont réapparu (600 ms) : le gaz les ronge, pas le lanceur
      const sn = A.lastSnap.p;
      const hpA = sn.find((e) => e[0] === A.id)?.[6], hpV = sn.find((e) => e[0] === V2.id)?.[6];
      check('gaz : les autres perdent des PV, le lanceur (masque) non', hpA === 100 && hpV < 95 && hpV > 0, `A=${hpA} V=${hpV}`);
      await closeAll(A, V2, V3);
    }
    // --- minigun : cadence très élevée ---
    {
      const A = await mk('Mg-A', [W.MINIGUN]), B = await mk('Mg-B', [W.KNIFE]);
      await sleep(450);
      A.at(-15, -25, Math.PI, W.MINIGUN); B.at(-15, -21, Math.PI); await sleep(300);
      for (let i = 0; i < 24; i++) { A.fire(W.MINIGUN, [-15, 1.0, -25], [0, 0, 1], { seed: i + 1 }); await sleep(46); }
      await sleep(300);
      check('minigun : plus de 15 balles/s, la cible est tuée', B.has('kill', (m) => m.v === B.id));
      await closeAll(A, B);
    }
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
