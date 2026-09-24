// Test du menu et du sélecteur de classes en jsdom (aucun WebGL) : usage : node test/menu.mjs
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'web/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'https://fpixel.test/?room=Les-Potes&mode=tdm&map=village', pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.history = dom.window.history; Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.matchMedia = () => ({ matches: false });

let failed = 0;
const check = (name, cond, extra = '') => { console.log(`${cond ? '  ok ' : ' FAIL'}  ${name}${cond ? '' : '  ' + extra}`); if (!cond) failed++; };

const { WEAPONS, W, CLASSES, MODES } = await import('../web/shared/config.js');
const { weaponFacts, mountClassPicker } = await import('../web/js/classes-ui.js');
const { mountMenu, readInvite, inviteLink, summaryText, mapThumbSvg } = await import('../web/js/menu.js');
const { weaponSvg, ICON_ART } = await import('../web/js/weapon-icons.js');
const { MAPS } = await import('../web/shared/map.js');

console.log('[icônes]');
check('une icône par arme', WEAPONS.every((w) => ICON_ART[w.id]), WEAPONS.filter((w) => !ICON_ART[w.id]).map((w) => w.id).join(','));
check('grilles 24×12', Object.values(ICON_ART).every((a) => a.length === 12 && a.every((r) => r.length === 24)));
check('SVG généré', weaponSvg('ar').startsWith('<svg') && weaponSvg('ar').includes('<rect'));

console.log('[fiche d\'arme]');
const sn = weaponFacts(WEAPONS[W.SNIPER]);
check('sniper : 100 dégâts par tir, tête = kill', sn.perShot === 100 && sn.headKill, JSON.stringify(sn));
check('sniper : précision parfaite (lunette), pas 10 %', sn.scores.precision === 1 && sn.precisionTxt === 'parfaite', sn.precisionTxt);
const sg = weaponFacts(WEAPONS[W.SHOTGUN]);
check('pompe : 9 plombs comptés (162 / tir)', sg.perShot === 162 && sg.bodyKill);
const ar = weaponFacts(WEAPONS[W.AR]);
check('fusil d\'assaut : précision en visant (ads)', ar.precisionTxt.includes('en visant') && ar.scores.precision > 0.9, ar.precisionTxt);
const pl = weaponFacts(WEAPONS[W.PLANE]);
check('avion : étiquette Pilotée + texte spécial (pas « 0 dégâts »)', pl.tags.includes('Pilotée') && pl.special);
check('portail : Utilitaire', weaponFacts(WEAPONS[W.PORTAL]).tags.includes('Utilitaire'));
check('aucun NaN dans les scores', WEAPONS.every((w) => Object.values(weaponFacts(w).scores).every(Number.isFinite)));

console.log('[lien d\'invitation]');
const settings = { name: '', mode: 'ffa', room: '', lobby: 'quick', map: 'arena', cls: 'classic', custom: [0, 3, 4], bots: true, diff: 'normal', limit: 0, fill: 0 };
check('lecture ?room=&mode=&map= (salon nettoyé)', readInvite(location.search, settings) && settings.room === 'lespotes' && settings.mode === 'tdm' && settings.map === 'village' && settings.lobby === 'friends', JSON.stringify(settings));
const link = inviteLink(settings, 'https://fpixel.test/');
check('lien généré', link === 'https://fpixel.test/?room=lespotes&mode=tdm&map=village', link);
check('mode inconnu ignoré', !readInvite('?mode=toString', { ...settings }) );

console.log('[menu]');
const saves = [];
let played = 0;
const menu = mountMenu({ settings, save: () => saves.push(1), onPlay: () => { played++; }, onOpenSettings: () => {}, loadStats: () => ({ matches: 0 }) });
const $ = (id) => document.getElementById(id);
check('tuile TDM sélectionnée', document.querySelector('.mode[data-mode="tdm"]').classList.contains('sel'));
check('résumé : mode, carte, frags, salon', /Match à mort.*Village.*30 frags.*lespotes/.test($('menu-summary').textContent), $('menu-summary').textContent);
check('une vignette SVG par carte', $('map-picker').querySelectorAll('.map-tile svg').length === Object.keys(MAPS).length);
check('vignette : les boîtes de la carte sont dessinées', mapThumbSvg(MAPS.arena).split('<rect').length > 30);
document.querySelector('.mode[data-mode="survival"]').click();
check('Survie : le réglage des monstres est visible', !$('f-diff').classList.contains('hidden') && $('f-diff').firstChild.textContent.trim() === 'Monstres');
check('Survie : « Partie rapide » désactivée, salon coop proposé', document.querySelector('.seg-btn[data-lobby="quick"]').disabled && !$('friends-box').classList.contains('hidden'));
document.querySelector('.mode[data-mode="gun"]').click();
check('Gun Game : frise de 5 niveaux', document.querySelectorAll('.cls-frise-step').length === 5);
document.querySelector('.mode[data-mode="ffa"]').click();
check('FFA : cartes de classes visibles', !document.querySelector('.cls-cards').classList.contains('hidden'));
check('aucun bouton imbriqué dans une carte', document.querySelectorAll('.cls-card button').length === 0);
const sniperCard = document.querySelector('.cls-card[data-cls="sniper"]');
sniperCard.querySelector('.cls-slot').click();
check('cliquer un slot : fiche affichée ET classe sélectionnée (carte non choisie)', !document.querySelector('.cls-fiche.pop').classList.contains('hidden') && settings.cls === 'sniper');
sniperCard.querySelector('.cls-slot').click();
check('re-cliquer un slot de sa classe ne change rien', settings.cls === 'sniper');
document.querySelector('.cls-card[data-cls="custom"]').click();
check('Perso : panneau ouvert', !document.querySelector('.cls-custom').classList.contains('hidden'));
for (const i of settings.custom.slice()) document.querySelector(`.cls-w[data-w="${i}"]`).click();
check('Perso vide : avertissement + JOUER désactivé', !document.querySelector('.cls-warn').classList.contains('hidden') && $('play').disabled);
document.querySelector('.cls-card[data-cls="classic"]').click();
document.querySelector('.cls-card[data-cls="custom"]').click();
check('Perso vide : on peut y revenir et le panneau se rouvre', settings.cls === 'custom' && !document.querySelector('.cls-custom').classList.contains('hidden'));
document.querySelector(`.cls-w[data-w="${W.ORB}"]`).click();
check('Perso : arme à 10 pts acceptée, JOUER réactivé', settings.custom.length === 1 && !$('play').disabled);
document.querySelector(`.cls-w[data-w="${W.AR}"]`).click();
check('Perso : trop cher = grisé, coût manquant affiché, liste inchangée', settings.custom.length === 1 && document.querySelector(`.cls-w[data-w="${W.AR}"]`).classList.contains('off') && /manque/.test(document.querySelector(`.cls-w[data-w="${W.AR}"] .cls-w-cost`).textContent));
check('Perso : slots de la carte suivent la liste', document.querySelectorAll('.cls-card[data-cls="custom"] .cls-slot').length === 1);
check('sauvegardes déclenchées', saves.length > 5);
check('aide clavier : touches surlignées', (menu.renderKeyboard(), document.querySelectorAll('#kbd-grid kbd.on').length >= 12));

console.log('[skins]');
{
  const { SKINS, skinColor, cleanSkins } = await import('../web/shared/skins.js');
  const { equippedSkins, skinsForServer, renderArmory, weaponProgress } = await import('../web/js/armory.js');
  check('skin standard = couleurs d\'origine', skinColor('#3b3f46', 0) === '#3b3f46');
  check('skin Or : couleur changée et valide', /^#[0-9a-f]{6}$/.test(skinColor('#3b3f46', 5)) && skinColor('#3b3f46', 5) !== '#3b3f46');
  check('icône avec skin différente de l\'icône standard', weaponSvg('ar', 5) !== weaponSvg('ar') && weaponSvg('ar', 5).includes('#0a0d12'));
  check('validation serveur : clés et valeurs hors bornes rejetées', JSON.stringify(cleanSkins({ 0: 2, 1: 0, 2: 99, x: 1, 3: 1.5 }, WEAPONS.length)) === '{"0":2}');
  const stats = { kills: 40, wk: { ar: 30, sniper: 5 } };
  const st = { skins: { ar: 'foret', sniper: 'or', portal: 'desert' } };
  const eq = equippedSkins(st, stats);
  check('skin débloqué porté, skin verrouillé ignoré', eq.ar === 2 && eq.sniper === undefined, JSON.stringify(eq));
  check('portail : progresse avec les frags totaux / 4', weaponProgress(stats, WEAPONS[W.PORTAL]) === 10 && eq.portal === 1, JSON.stringify(eq));
  check('format serveur : index d\'arme -> index de skin', skinsForServer(eq)[W.AR] === 2);
  let saved = 0;
  renderArmory($('armory-list'), $('armory-sub'), st, stats, () => saved++);
  const row = [...document.querySelectorAll('.arm-row')].find((r) => r.textContent.includes(WEAPONS[W.AR].name));
  check('armurerie : une ligne par arme, 7 skins chacune', document.querySelectorAll('.arm-row').length > 10 && row.querySelectorAll('.arm-skin').length === SKINS.length);
  check('armurerie : Forêt porté, Nuit verrouillé (30/50)', row.querySelectorAll('.arm-skin')[2].classList.contains('sel') && row.querySelectorAll('.arm-skin')[3].classList.contains('locked') && /30\/50/.test(row.querySelectorAll('.arm-skin')[3].textContent));
  row.querySelectorAll('.arm-skin')[1].click();
  check('armurerie : choisir Désert enregistre le choix', st.skins.ar === 'desert' && saved === 1);
  const row2 = [...document.querySelectorAll('.arm-row')].find((r) => r.textContent.includes(WEAPONS[W.AR].name));
  row2.querySelectorAll('.arm-skin')[4].click();
  check('armurerie : un skin verrouillé ne se choisit pas', st.skins.ar === 'desert' && saved === 1);
}

console.log('[viseur]');
{
  const { applyCrosshair, cleanXh } = await import('../web/js/crosshair.js');
  const x = cleanXh({ style: 'circle', size: 99, gap: -3, thick: 'a', color: 'red', outline: false });
  check('réglage nettoyé (bornes, couleur, forme)', x.style === 'circle' && x.size === 20 && x.gap === 0 && x.thick === 2 && x.color === '#ffffff' && !x.outline, JSON.stringify(x));
  check('réglage vide = viseur par défaut', JSON.stringify(cleanXh(null)) === JSON.stringify({ style: 'cross', size: 8, gap: 6, thick: 2, color: '#ffffff', outline: true }));
  applyCrosshair($('crosshair'), { style: 'dot', size: 10, gap: 4, thick: 3, color: '#4dff6a', outline: true });
  const e = $('crosshair');
  check('viseur appliqué : forme et variables CSS', e.classList.contains('s-dot') && !e.classList.contains('s-cross') && e.style.getPropertyValue('--xl') === '10px' && e.style.getPropertyValue('--xc') === '#4dff6a');
}

console.log('[navigateur de salons]');
document.querySelector('.mode[data-mode="ffa"]').click();
menu.setLobby({ modes: { ffa: { rooms: [{ rid: 'ffa#3', id: 'salon 3', n: 4, max: 10, bots: 6, map: 'village', auto: true, state: 'playing' }, { rid: 'ffa:vide', id: 'vide', n: 0, max: 10, map: 'arena' }] } } });
check('un salon listé (les salons vides sont masqués)', document.querySelectorAll('.room-row-btn').length === 1);
document.querySelector('.room-row-btn').click();
check('clic : lance la partie avec ce salon', played === 1 && menu.takeJoinRid() === 'ffa#3' && menu.takeJoinRid() === null);
check('ligne : nom, carte, remplissage', /salon 3/.test(document.querySelector('.room-row-btn').textContent) && /Village/.test(document.querySelector('.room-row-btn').textContent) && /4\/10/.test(document.querySelector('.room-row-btn').textContent));
console.log(failed ? `\n${failed} échec(s)` : '\nTout est OK');
process.exit(failed ? 1 : 0);
