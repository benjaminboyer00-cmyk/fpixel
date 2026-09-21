// Vérifie la carte et la physique du joueur sans navigateur : node test/physics.mjs
import { stepPlayer } from '../web/js/physics.js';
import { BOXES, SPAWNS } from '../web/shared/map.js';
import { PLAYER_RADIUS as R, PLAYER_HEIGHT as H } from '../web/shared/config.js';

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };
const player = (x, z, y = 0) => ({ x, y, z, vx: 0, vy: 0, vz: 0, onGround: true });
const overlaps = (p, b) => p.x + R > b.x0 && p.x - R < b.x1 && p.z + R > b.z0 && p.z - R < b.z1 && p.y + H > b.y0 && p.y < b.y1;

// simule `secs` secondes ; wish = direction monde ; jumpAt = liste de temps de saut
function run(p, secs, wx, wz, { speed = 6.5, jumpEvery = 0 } = {}) {
  const dt = 1 / 60;
  let maxY = p.y, t = 0;
  for (let i = 0; i < secs * 60; i++, t += dt) {
    const jump = jumpEvery && Math.floor(t / jumpEvery) !== Math.floor((t - dt) / jumpEvery);
    stepPlayer(p, dt, wx, wz, speed, jump);
    maxY = Math.max(maxY, p.y);
  }
  return maxY;
}

for (const s of SPAWNS) {
  const p = player(s.x, s.z);
  check(`spawn (${s.x},${s.z}) libre`, !BOXES.some((b) => overlaps(p, b)));
}

let p = player(10, 0);
let my = run(p, 3, -1, 0);
check('escalier de la plateforme centrale : on monte à 1.5 en marchant', Math.abs(my - 1.5) < 0.01, `max y=${my}`);

p = player(-10, 0); my = run(p, 3, 1, 0);
check('escalier centrale côté opposé', Math.abs(my - 1.5) < 0.01, `max y=${my}`);

p = player(13, 0); my = run(p, 3, 1, 0);
check('escalier de la tour de sniper : on monte à 3.0 en marchant', Math.abs(my - 3.0) < 0.01, `max y=${my}`);

p = player(-13, 0); my = run(p, 3, -1, 0);
check('tour de sniper côté opposé', Math.abs(my - 3.0) < 0.01, `max y=${my}`);

p = player(0, 0, 1.5); run(p, 0.05, 0, 0);
check('on reste posé sur la plateforme (pas de tremblement)', p.onGround && Math.abs(p.y - 1.5) < 0.01, `y=${p.y}`);

// petite caisse 1.2 à (5,9) : atteignable en sautant
p = player(5, 6); my = run(p, 1.5, 0, 1, { jumpEvery: 0.5 });
check('saut sur une petite caisse (1.2 m)', my > 1.19, `max y=${my}`);

// muret 1.0 à (12,3) : franchissable en sautant
p = player(12, 0.5); my = run(p, 1.2, 0, 1, { jumpEvery: 0.5 });
check('saut sur un muret (1.0 m)', my > 0.99, `max y=${my}`);

// grosse caisse 2 m à (10,6) : inatteignable depuis le sol (approche côté +z, sans muret)
p = player(10, 9); my = run(p, 2, 0, -1, { jumpEvery: 0.4 });
check('impossible de grimper une caisse de 2 m', my < 1.3, `max y=${my}`);

// le joueur ne traverse pas un mur
p = player(0, -20); run(p, 6, 0, 1);
check('le joueur est bloqué par les murs / obstacles (pas de traversée)', !BOXES.some((b) => overlaps(p, b)), `pos=${p.x.toFixed(2)},${p.z.toFixed(2)}`);

// enceinte
p = player(0, 25); run(p, 3, 0, 1);
check('le joueur ne sort pas de l\'arène', p.z <= 30, `z=${p.z}`);

console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
process.exit(failed ? 1 : 0);
