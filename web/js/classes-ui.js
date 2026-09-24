// Sélecteur de classe (menu + pause).
//  - cartes de classe (PV / vitesse en blocs, armes en slots numérotés comme dans le HUD), accessibles au clavier
//  - fiche d'arme calculée depuis shared/config.js : dégâts PAR TIR, cadence, portée, meilleure précision, étiquettes
//  - classe « Perso » : budget en blocs, puces grisées avec le coût manquant, jamais bloquée même si la liste est vide
//  - modes imposés (Gun Game, Survie) : on montre ce que le mode donne vraiment
import { CLASSES, WEAPONS, CUSTOM_BUDGET, CUSTOM_MAX_WEAPONS, weaponCost, resolveClass, GUN_ORDER, SURV, MAX_HP } from '../shared/config.js';
import { weaponImg } from './weapon-icons.js';

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('aria-') || k === 'role' || k === 'tabindex') e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const c of children) e.append(c);
  return e;
}
const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

// Barre en blocs pixel : segments pleins / vides, pas de dégradé.
export function barEl(score, segments = 5, cls = '') {
  const bar = el('span', { className: `bar ${cls}`.trim() });
  const on = Math.round(clamp01(score) * segments);
  for (let i = 0; i < segments; i++) bar.append(el('i', { className: i < on ? 'on' : '' }));
  return bar;
}

// ------------------------------------------------------------ fiche d'arme ----
// Tout vient des champs bruts de config.js : si une arme est rééquilibrée, la fiche suit.
export function weaponFacts(w) {
  const perShot = w.dmg * Math.max(1, w.pellets || 1);
  const rps = 1000 / w.interval;
  const bestSpread = w.scopeSpread !== undefined ? w.scopeSpread : w.ads?.spread !== undefined ? Math.min(w.spread, w.ads.spread) : w.spread;
  let rangeM, rangeTxt;
  if (w.melee) { rangeM = w.range ?? 2.5; rangeTxt = `${rangeM} m (mêlée)`; }
  else if (w.proj) { rangeM = w.proj.speed * w.proj.life; rangeTxt = `${Math.round(rangeM)} m`; }
  else if (w.falloff) { rangeM = w.falloff[1]; rangeTxt = `${w.falloff[0]}–${w.falloff[1]} m`; }
  else if (w.range) { rangeM = w.range; rangeTxt = `${w.range} m`; }
  else { rangeM = 999; rangeTxt = 'illimitée'; }
  const tags = [];
  if (w.kind === 'portal' || w.kind === 'grapple') tags.push('Utilitaire');
  if (w.proj?.radius) tags.push('Zone');
  if (w.kind === 'plane') tags.push('Pilotée');
  if (w.kind === 'orb') tags.push('Charge 1,5 s');
  if (w.kind === 'beam' && w.stun) tags.push('Étourdit');
  if (w.melee) tags.push('Mêlée');
  if (w.auto) tags.push('Auto');
  if (w.zoom) tags.push('Lunette');
  if (w.heal) tags.push(`+${w.heal} PV par coup`);
  if (w.alt) tags.push('Tir secondaire');
  if (w.backstab) tags.push(`Dos : ${w.backstab}`);
  const headKill = w.dmg > 0 && w.dmg * (w.headMul || 1) >= MAX_HP;
  const bodyKill = perShot >= MAX_HP;
  const special = w.kind === 'plane' ? 'Tête = mort, corps 60' : w.kind === 'portal' ? 'Ne blesse pas : téléporte' : w.kind === 'nuke' ? 'Détruit tout, puis gaz' : null;
  return {
    perShot, rps, rangeTxt, tags, headKill, bodyKill, special,
    scores: {
      dmg: clamp01(perShot / 120), cadence: clamp01(rps / 12),
      range: clamp01(rangeM / (w.melee ? 4 : 100)), precision: bestSpread === 0 ? 1 : clamp01(1 - bestSpread / 0.1),
    },
    precisionTxt: w.melee ? 'mêlée' : bestSpread === 0 ? 'parfaite' : `${Math.round((1 - bestSpread / 0.1) * 100)} %${w.scopeSpread !== undefined || w.ads ? ' en visant' : ''}`,
    mag: w.mag ? `${w.mag} balles · recharge ${(w.reload / 1000).toFixed(1)} s` : w.noReload ? 'un seul chargeur' : 'illimité',
  };
}

export function ficheEl(w) {
  const f = weaponFacts(w);
  const row = (label, score, txt) => el('div', { className: 'fiche-row' }, el('small', { textContent: label }), barEl(score), el('em', { textContent: txt }));
  const head = el('div', { className: 'fiche-head' }, weaponImg(w.id, 64), el('div', {}, el('b', { textContent: w.name }), el('small', { textContent: f.mag })));
  const box = el('div', { className: 'cls-fiche-body' }, head,
    row('Dégâts', f.scores.dmg, w.dmg > 0 ? `${f.perShot} / tir` : f.special || '—'),
    row('Cadence', f.scores.cadence, `${Math.round(f.rps * 10) / 10} tirs/s`),
    row('Portée', f.scores.range, f.rangeTxt),
    row('Précision', f.scores.precision, f.precisionTxt));
  const tags = el('div', { className: 'fiche-tags' });
  if (f.bodyKill) tags.append(el('span', { className: 'tag hot', textContent: '1 tir = kill' }));
  else if (f.headKill) tags.append(el('span', { className: 'tag hot', textContent: 'Tête = kill' }));
  for (const t of f.tags) tags.append(el('span', { className: 'tag', textContent: t }));
  if (f.special && w.dmg > 0) tags.append(el('span', { className: 'tag', textContent: f.special }));
  if (tags.children.length) box.append(tags);
  return box;
}

// ------------------------------------------------------------ sélecteur ----
// settings.cls : identifiant de classe ou 'custom' ; settings.custom : liste ordonnée d'index d'armes (touches 1..5)
export function mountClassPicker(root, settings, { save, onChange, onUpdate, custom = true, compact = false } = {}) {
  const cardsWrap = el('div', { className: `cls-cards${compact ? ' compact' : ''}`, role: 'radiogroup', 'aria-label': 'Classe' });
  // fiche d'arme : bulle flottante à côté de l'arme survolée / touchée (hors du flux, jamais cachée sous le pli)
  const ficheBox = el('div', { className: 'cls-fiche pop hidden', role: 'tooltip' });
  const customBox = el('div', { className: 'cls-custom hidden' });
  const imposedBox = el('div', { className: 'cls-imposed hidden' });
  root.replaceChildren(cardsWrap, customBox, imposedBox);
  document.querySelectorAll('.cls-fiche.pop').forEach((f) => f.remove());   // remontage (pause) : une seule bulle
  document.body.append(ficheBox);

  const selectable = WEAPONS.map((w, i) => ({ w, i })).filter(({ w }) => w.streak === undefined && !w.item);
  const validList = (list) => (Array.isArray(list) ? list.filter((i) => WEAPONS[i] && WEAPONS[i].streak === undefined && !WEAPONS[i].item) : []);
  settings.custom = validList(settings.custom);

  let ficheAnchor = null;
  function showFiche(i, anchor) {
    ficheBox.replaceChildren(ficheEl(WEAPONS[i]));
    ficheBox.classList.remove('hidden');
    ficheAnchor = anchor || null;
    if (!anchor || typeof anchor.getBoundingClientRect !== 'function') return;
    const r = anchor.getBoundingClientRect();
    const fw = ficheBox.offsetWidth || 280, fh = ficheBox.offsetHeight || 190;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = r.right + 10;
    if (x + fw > vw - 8) x = r.left - fw - 10;          // pas de place à droite : à gauche
    if (x < 8) x = Math.max(8, Math.min(vw - fw - 8, r.left)); // ni l'un ni l'autre : sous l'arme
    let y = x === Math.max(8, Math.min(vw - fw - 8, r.left)) && (r.right + 10 + fw > vw - 8) ? r.bottom + 8 : r.top - 10;
    y = Math.max(8, Math.min(vh - fh - 8, y));
    ficheBox.style.left = `${Math.round(x)}px`; ficheBox.style.top = `${Math.round(y)}px`;
  }
  function hideFiche() { ficheBox.classList.add('hidden'); ficheAnchor = null; }
  // toucher ailleurs / défiler / Échap : on ferme la bulle
  document.addEventListener('pointerdown', (e) => { if (ficheAnchor && !e.target.closest('.cls-slot, .cls-w, .cls-fiche')) hideFiche(); }, true);
  document.addEventListener('scroll', hideFiche, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideFiche(); });

  function slotsEl(weapons) {
    const slots = el('div', { className: 'cls-slots' });
    weapons.forEach((wi, k) => {
      const slot = el('span', { className: 'cls-slot', dataset: { w: String(wi) }, title: WEAPONS[wi].name }, el('b', { textContent: String(k + 1) }), weaponImg(WEAPONS[wi].id, 44));
      slots.append(slot);
    });
    return slots;
  }
  function statsEl(hp, speed) {
    return el('div', { className: 'cls-bars' },
      el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'PV' }), barEl(hp / 150), el('em', { textContent: String(hp) })),
      el('div', { className: 'cls-bar-row' }, el('small', { textContent: 'Vitesse' }), barEl(speed / 1.2), el('em', { textContent: `${Math.round(speed * 100)} %` })));
  }

  // ---- cartes ----
  const cardEls = new Map();
  function makeCard(id, name, hp, speed, weapons, extraClass = '') {
    const card = el('div', { className: `cls-card ${extraClass}`.trim(), role: 'radio', 'aria-checked': 'false', tabindex: '0', dataset: { cls: id } },
      el('b', { className: 'cls-name', textContent: name }), statsEl(hp, speed), slotsEl(weapons));
    cardEls.set(id, card);
    cardsWrap.append(card);
    return card;
  }
  for (const c of Object.values(CLASSES)) makeCard(c.id, c.name, c.hp, c.speed, c.weapons);
  const customCard = custom ? makeCard('custom', 'Perso', 100, 1, settings.custom, 'cls-card-custom') : null;

  cardsWrap.addEventListener('click', (e) => {
    const slot = e.target.closest('.cls-slot');
    const card = e.target.closest('.cls-card');
    if (!card) return;
    if (slot) { showFiche(Number(slot.dataset.w), slot); if (card.dataset.cls === settings.cls) return; } // regarder une arme de sa classe ne change rien
    selectClass(card.dataset.cls);
  });
  cardsWrap.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const slot = e.target.closest('.cls-slot');
    if (slot) showFiche(Number(slot.dataset.w), slot);
  });
  cardsWrap.addEventListener('pointerout', (e) => {
    if (e.pointerType === 'touch') return;
    if (e.target.closest('.cls-slot') && !e.relatedTarget?.closest?.('.cls-slot')) hideFiche();
  });
  cardsWrap.addEventListener('keydown', (e) => {
    const card = e.target.closest('.cls-card');
    if (!card) return;
    const cards = [...cardsWrap.querySelectorAll('.cls-card')];
    const i = cards.indexOf(card);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectClass(card.dataset.cls); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); cards[(i + 1) % cards.length].focus(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); cards[(i - 1 + cards.length) % cards.length].focus(); }
  });

  // ---- Perso : budget + puces ----
  const budgetBar = el('div', { className: 'cls-budget-bar', 'aria-hidden': 'true' });
  const budgetTxt = el('div', { className: 'cls-budget-txt' });
  const warn = el('div', { className: 'cls-warn hidden' });
  const chipsWrap = el('div', { className: 'cls-weapons' });
  customBox.replaceChildren(el('div', { className: 'cls-budget' }, budgetBar, budgetTxt), warn, chipsWrap);
  const chips = new Map();
  for (const { w, i } of selectable) {
    const chip = el('button', { className: 'cls-w', type: 'button', dataset: { w: String(i) } },
      weaponImg(w.id, 40), el('b', { textContent: w.name }), el('em', { className: 'cls-w-num' }), el('small', { className: 'cls-w-cost' }));
    chip.addEventListener('click', () => toggleWeapon(i, chip));
    chip.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') showFiche(i, chip); });
    chip.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hideFiche(); });
    chips.set(i, chip);
    chipsWrap.append(chip);
  }
  function toggleWeapon(i, chip) {
    const list = settings.custom.slice();
    const at = list.indexOf(i);
    if (at >= 0) list.splice(at, 1);
    else {
      if (list.length >= CUSTOM_MAX_WEAPONS || weaponCost(list) + WEAPONS[i].cost > CUSTOM_BUDGET) { showFiche(i, chip); chip?.classList.add('shake'); setTimeout(() => chip?.classList.remove('shake'), 350); return; }
      list.push(i);
    }
    settings.custom = list;
    settings.cls = 'custom';
    render(); save?.(); if (isValid()) onChange?.(); onUpdate?.();
  }
  function renderCustom() {
    const list = settings.custom;
    const cost = weaponCost(list);
    const remaining = CUSTOM_BUDGET - cost;
    budgetBar.replaceChildren();
    for (let i = 0; i < CUSTOM_BUDGET; i++) budgetBar.append(el('i', { className: i < cost ? 'on' : '' }));
    budgetTxt.textContent = `${cost} / ${CUSTOM_BUDGET} pts · ${list.length} / ${CUSTOM_MAX_WEAPONS} armes`;
    warn.classList.toggle('hidden', list.length > 0);
    warn.textContent = 'Choisis au moins une arme (sinon tu joueras Classique).';
    for (const [i, chip] of chips) {
      const pos = list.indexOf(i), w = WEAPONS[i];
      const fits = list.length < CUSTOM_MAX_WEAPONS && w.cost <= remaining;
      const miss = w.cost - Math.max(0, remaining);
      chip.classList.toggle('sel', pos >= 0);
      chip.classList.toggle('off', pos < 0 && !fits);
      chip.setAttribute('aria-pressed', pos >= 0 ? 'true' : 'false');
      chip.querySelector('.cls-w-num').textContent = pos >= 0 ? String(pos + 1) : '';
      chip.querySelector('.cls-w-cost').textContent = pos >= 0 || fits ? `${w.cost} pt${w.cost > 1 ? 's' : ''}` : list.length >= CUSTOM_MAX_WEAPONS ? 'plein' : `manque ${miss} pt${miss > 1 ? 's' : ''}`;
    }
    if (customCard) customCard.querySelector('.cls-slots').replaceWith(slotsEl(list));
  }

  // ---- modes imposés ----
  const step = (wi, label) => el('div', { className: 'cls-frise-step' }, weaponImg(WEAPONS[wi].id, 56), el('small', { textContent: label ?? WEAPONS[wi].name }));
  const arrow = (t = '→') => el('span', { className: 'cls-frise-arrow', textContent: t });
  function renderImposed(mode) {
    imposedBox.replaceChildren();
    if (mode === 'gun') {
      const frise = el('div', { className: 'cls-frise' });
      GUN_ORDER.forEach((wi, k) => { if (k) frise.append(arrow()); frise.append(step(wi, `${k + 1}. ${WEAPONS[wi].name}`)); });
      imposedBox.append(el('div', { className: 'cls-imposed-title', textContent: 'Gun Game : un frag = arme suivante. Un frag au couteau fait aussi reculer la victime.' }), frise);
    } else if (mode === 'survival') {
      const frise = el('div', { className: 'cls-frise' });
      SURV.START_WEAPONS.forEach((wi, k) => { if (k) frise.append(arrow('+')); frise.append(step(wi)); });
      frise.append(arrow(), el('div', { className: 'cls-frise-step' }, el('span', { className: 'cls-frise-shop', textContent: '🛒' }), el('small', { textContent: 'Boutique (B)' })));
      imposedBox.append(el('div', { className: 'cls-imposed-title', textContent: `Survie : départ à ${SURV.START_CASH} $, le reste s'achète entre les manches.` }), frise);
    }
  }

  function selectClass(id) {
    const opening = id === 'custom' && settings.cls !== 'custom';
    settings.cls = id;
    render(); save?.(); if (isValid()) onChange?.(); onUpdate?.();
    if (opening) customBox.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });   // le panneau Perso est sous les cartes
  }
  const isValid = () => settings.cls !== 'custom' || settings.custom.length > 0;

  function render() {
    for (const [id, card] of cardEls) { const on = settings.cls === id; card.classList.toggle('sel', on); card.setAttribute('aria-checked', on ? 'true' : 'false'); }
    customBox.classList.toggle('hidden', settings.cls !== 'custom' || cardsWrap.classList.contains('hidden'));
    renderCustom();
  }

  // Sélection libre (multi/duel/…) ou aperçu imposé (Gun Game / Survie)
  function setMode(mode) {
    const imposed = ['gun', 'survival'].includes(mode) ? mode : null;
    cardsWrap.classList.toggle('hidden', !!imposed);
    hideFiche();
    imposedBox.classList.toggle('hidden', !imposed);
    if (imposed) renderImposed(imposed);
    render();
  }

  // état initial : classe inconnue -> Classique ; Perso trop cher -> on garde ce qui rentre, la carte prévient
  if (!Object.hasOwn(CLASSES, settings.cls) && !(custom && settings.cls === 'custom')) settings.cls = 'classic';
  if (settings.cls === 'custom' && resolveClass('custom', settings.custom).id !== 'custom') {
    const kept = [];
    for (const i of settings.custom) if (kept.length < CUSTOM_MAX_WEAPONS && weaponCost(kept) + WEAPONS[i].cost <= CUSTOM_BUDGET) kept.push(i);
    settings.custom = kept;
  }
  setMode(null);

  return { refresh: render, setMode, isValid, showFiche };
}
