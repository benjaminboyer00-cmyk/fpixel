// Sélecteur de classe (menu + pause) : cartes défilables (PV/vitesse en barres, armes en slots numérotés avec icône 3D),
// fiche d'arme (Dégâts/Cadence/Portée/Précision) calculée depuis shared/config.js, et « Perso » (budget de points).
import { CLASSES, WEAPONS, CUSTOM_BUDGET, CUSTOM_MAX_WEAPONS, weaponCost, resolveClass, GUN_ORDER, SURV } from '../shared/config.js';
import { weaponIcon } from './weapon-icons.js';

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Barre en blocs pixel (comme le reste de l'UI : segments pleins/vides, pas de dégradé).
function barEl(score, segments = 5) {
  const bar = el('div', { className: 'bar' });
  const on = Math.round(clamp01(score) * segments);
  for (let i = 0; i < segments; i++) bar.append(el('i', { className: i < on ? 'on' : '' }));
  return bar;
}

function weaponImg(id, size = 28) {
  const img = el('img', { className: 'w-icon', width: size, height: size, alt: '' });
  img.src = weaponIcon(id, size * 2); // rendu en 2x pour rester net sur les écrans HiDPI
  return img;
}

// 4 barres calculées à partir des champs bruts de config.js (jamais écrites à la main) :
// Dégâts = DPS (dmg × pellets × 1000 / interval), Cadence = tirs/s, Portée = falloff / portée projectile / mêlée, Précision = inverse du spread.
function weaponScores(w) {
  const dps = (w.dmg * Math.max(1, w.pellets)) * 1000 / w.interval;
  const rps = 1000 / w.interval;
  let rangeM;
  if (w.melee) rangeM = w.range ?? 2.5;
  else if (w.proj) rangeM = w.proj.speed * w.proj.life;
  else if (w.falloff) rangeM = w.falloff[1];
  else if (w.range) rangeM = w.range;
  else rangeM = 999; // pas de chute de dégâts : portée effectivement illimitée
  return {
    dmg: clamp01(dps / 220), cadence: clamp01(rps / 15),
    range: clamp01(rangeM / (w.melee ? 5 : 100)), precision: w.spread === 0 ? 1 : clamp01(1 - w.spread / 0.1),
    dpsTxt: Math.round(dps), rpsTxt: Math.round(rps * 10) / 10, rangeTxt: rangeM >= 999 ? '∞' : `${Math.round(rangeM)} m`,
  };
}

function fiche(w) {
  const s = weaponScores(w);
  const row = (label, score, txt) => el('div', { className: 'fiche-row' }, el('small', { textContent: label }), barEl(score), el('em', { textContent: txt }));
  return el('div', { className: 'cls-fiche-body' },
    el('div', { className: 'fiche-head' }, weaponImg(w.id, 34), el('b', { textContent: w.name })),
    row('Dégâts', s.dmg, `${s.dpsTxt} dps`),
    row('Cadence', s.cadence, `${s.rpsTxt}/s`),
    row('Portée', s.range, s.rangeTxt),
    row('Précision', s.precision, w.melee ? 'mêlée' : `${Math.round(s.precision * 100)}%`));
}

// settings.cls : identifiant de classe ou 'custom' ; settings.custom : liste ordonnée d'index d'armes pour « Perso »
export function mountClassPicker(root, settings, { save, onChange, custom = true }) {
  const cardsWrap = el('div', { className: 'cls-cards' });
  const ficheBox = el('div', { className: 'cls-fiche hidden' });
  const customBox = el('div', { className: 'cls-custom hidden' });
  const imposedBox = el('div', { className: 'cls-imposed hidden' });
  root.replaceChildren(cardsWrap, ficheBox, customBox, imposedBox);

  const selectable = WEAPONS.map((w, i) => ({ w, i })).filter(({ w }) => w.streak === undefined && !w.item);

  function showFiche(i) {
    ficheBox.replaceChildren(fiche(WEAPONS[i]));
    ficheBox.classList.remove('hidden');
  }

  // ---- cartes de classe prédéfinies ----
  const cardEls = new Map();
  for (const c of Object.values(CLASSES)) {
    const slots = el('div', { className: 'cls-slots' });
    c.weapons.forEach((wi, k) => {
      const slot = el('button', { className: 'cls-slot', type: 'button' }, el('b', { textContent: String(k + 1) }), weaponImg(WEAPONS[wi].id));
      slot.dataset.w = String(wi);
      slots.append(slot);
    });
    const card = el('button', { className: 'cls-card', type: 'button', role: 'option' },
      el('b', { textContent: c.name }),
      el('div', { className: 'cls-bars' },
        el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'PV' }), barEl(c.hp / 150), el('em', { textContent: c.hp })),
        el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'Vitesse' }), barEl(c.speed / 1.2))),
      slots);
    card.dataset.cls = c.id;
    cardEls.set(c.id, card);
    cardsWrap.append(card);
  }

  // ---- carte « Perso » ----
  let personSlots = null;
  if (custom) {
    const slots = el('div', { className: 'cls-slots' });
    personSlots = slots;
    const card = el('button', { className: 'cls-card cls-card-custom', type: 'button', role: 'option' },
      el('b', { textContent: '🛠 Perso' }),
      el('div', { className: 'cls-bars' },
        el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'PV' }), barEl(100 / 150), el('em', { textContent: 100 })),
        el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'Vitesse' }), barEl(1 / 1.2))),
      slots);
    card.dataset.cls = 'custom';
    cardEls.set('custom', card);
    cardsWrap.append(card);
  }

  // Sélection / survol : clic sur une carte = choisir la classe ; survol (ou clic) d'un slot = fiche de l'arme.
  cardsWrap.addEventListener('click', (e) => {
    const slot = e.target.closest('.cls-slot');
    const card = e.target.closest('.cls-card');
    if (!card) return;
    if (slot) showFiche(Number(slot.dataset.w));
    selectClass(card.dataset.cls);
  });
  cardsWrap.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const slot = e.target.closest('.cls-slot');
    if (slot) showFiche(Number(slot.dataset.w));
  });

  // ---- Perso : budget en 10 blocs + liste d'armes ----
  const budgetBar = el('div', { className: 'cls-budget-bar' });
  const budgetTxt = el('div', { className: 'cls-budget-txt' });
  const weaponsList = el('div', { className: 'cls-weapons' });
  customBox.replaceChildren(el('div', { className: 'cls-budget' }, budgetBar, budgetTxt), weaponsList);

  const chips = new Map(); // index d'arme -> élément chip
  for (const { w, i } of selectable) {
    const chip = el('button', { className: 'cls-w', type: 'button' },
      weaponImg(w.id, 24), el('b', { textContent: w.name }),
      el('em', { className: 'cls-w-num', textContent: '' }),
      el('small', { className: 'cls-w-cost', textContent: `${w.cost} pt${w.cost > 1 ? 's' : ''}` }));
    chip.dataset.w = String(i);
    chip.addEventListener('click', () => {
      const list = settings.custom.slice();
      const at = list.indexOf(i);
      if (at >= 0) list.splice(at, 1);
      else {
        if (list.length >= CUSTOM_MAX_WEAPONS || weaponCost(list) + w.cost > CUSTOM_BUDGET) return; // grisé : pas d'action
        list.push(i);
      }
      settings.custom = list;
      settings.cls = 'custom';
      renderCustom(); renderCards(); save(); onChange?.();
    });
    chip.addEventListener('mouseenter', () => showFiche(i));
    chips.set(i, chip);
    weaponsList.append(chip);
  }

  function renderCustom() {
    const list = Array.isArray(settings.custom) ? settings.custom : [];
    const cost = weaponCost(list);
    const remaining = CUSTOM_BUDGET - cost;
    budgetBar.replaceChildren();
    for (let i = 0; i < CUSTOM_BUDGET; i++) budgetBar.append(el('i', { className: i < cost ? 'on' : '' }));
    budgetTxt.textContent = `${cost} / ${CUSTOM_BUDGET} points · ${list.length} / ${CUSTOM_MAX_WEAPONS} armes`;
    budgetBar.classList.toggle('bad', !list.length);
    for (const [i, chip] of chips) {
      const pos = list.indexOf(i);
      const w = WEAPONS[i];
      const wouldFit = list.length < CUSTOM_MAX_WEAPONS && w.cost <= remaining;
      chip.classList.toggle('sel', pos >= 0);
      chip.classList.toggle('off', pos < 0 && !wouldFit);
      chip.querySelector('.cls-w-num').textContent = pos >= 0 ? String(pos + 1) : '';
      chip.querySelector('.cls-w-cost').textContent = pos >= 0 ? '' : (wouldFit ? `${w.cost} pt${w.cost > 1 ? 's' : ''}` : `+${w.cost} pt${w.cost > 1 ? 's' : ''}`);
    }
    if (personSlots) {
      personSlots.replaceChildren();
      list.forEach((wi, k) => {
        const slot = el('button', { className: 'cls-slot', type: 'button' }, el('b', { textContent: String(k + 1) }), weaponImg(WEAPONS[wi].id));
        slot.dataset.w = String(wi);
        personSlots.append(slot);
      });
    }
  }

  // ---- classes imposées (Gun Game, Survie) : ce que le mode donne réellement, sans réglage possible ----
  function renderImposed(mode) {
    if (mode === 'gun') {
      const frise = el('div', { className: 'cls-frise' });
      GUN_ORDER.forEach((wi, k) => {
        if (k > 0) frise.append(el('span', { className: 'cls-frise-arrow', textContent: '→' }));
        frise.append(el('div', { className: 'cls-frise-step' }, weaponImg(WEAPONS[wi].id, 30), el('small', { textContent: WEAPONS[wi].name })));
      });
      imposedBox.replaceChildren(el('div', { className: 'cls-imposed-title', textContent: 'Gun Game : une arme par niveau, dans cet ordre' }), frise);
    } else if (mode === 'survival') {
      const row = el('div', { className: 'cls-frise' },
        ...SURV.START_WEAPONS.flatMap((wi, k) => {
          const step = el('div', { className: 'cls-frise-step' }, weaponImg(WEAPONS[wi].id, 30), el('small', { textContent: WEAPONS[wi].name }));
          return k > 0 ? [el('span', { className: 'cls-frise-arrow', textContent: '+' }), step] : [step];
        }),
        el('span', { className: 'cls-frise-arrow', textContent: '→' }),
        el('div', { className: 'cls-frise-step' }, el('div', { className: 'cls-frise-shop', textContent: '🛒' }), el('small', { textContent: 'Boutique' })));
      imposedBox.replaceChildren(el('div', { className: 'cls-imposed-title', textContent: 'Survie : équipement de départ, le reste s\'achète en jeu' }), row);
    }
  }

  function selectClass(id) {
    if (id === 'custom') {
      if (!Array.isArray(settings.custom) || !settings.custom.length) return; // rien de choisi : on ne peut pas jouer Perso vide
    }
    settings.cls = id;
    save();
    onChange?.();
    renderCards();
    customBox.classList.toggle('hidden', id !== 'custom');
  }

  function renderCards() {
    for (const [id, card] of cardEls) card.classList.toggle('sel', settings.cls === id);
  }

  // Bascule entre la sélection libre (multi/duel/…) et l'aperçu imposé (Gun Game / Survie).
  function setMode(mode) {
    const imposed = mode === 'gun' || mode === 'survival' ? mode : null;
    cardsWrap.classList.toggle('hidden', !!imposed);
    ficheBox.classList.add('hidden');
    customBox.classList.toggle('hidden', !!imposed || settings.cls !== 'custom');
    imposedBox.classList.toggle('hidden', !imposed);
    if (imposed) renderImposed(imposed);
  }

  // état initial : classe invalide -> Classique ; « custom » invalide (armes disparues, trop cher) -> Classique
  const savedCustom = Array.isArray(settings.custom) ? settings.custom.filter((i) => WEAPONS[i] && WEAPONS[i].streak === undefined && !WEAPONS[i].item) : [];
  settings.custom = savedCustom;
  const resolved = resolveClass(settings.cls, savedCustom);
  settings.cls = (CLASSES[settings.cls] || (custom && settings.cls === 'custom' && resolved.id === 'custom')) ? settings.cls : 'classic';
  renderCards();
  renderCustom();
  customBox.classList.toggle('hidden', settings.cls !== 'custom');
  setMode(null);

  return { refresh: () => { renderCards(); renderCustom(); }, setMode };
}
