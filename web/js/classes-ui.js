// Sélecteur de classe (menu + pause) : classes prédéfinies ou « Perso » (armes au choix avec un budget de points).
import { CLASSES, WEAPONS, CUSTOM_BUDGET, CUSTOM_MAX_WEAPONS, weaponCost, resolveClass } from '../shared/config.js';

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

// settings.cls : identifiant de classe ou 'custom' ; settings.custom : liste d'index d'armes pour « Perso »
export function mountClassPicker(root, settings, { save, onChange, custom = true }) {
  const sel = el('select', { ariaLabel: 'Classe' });
  for (const c of Object.values(CLASSES)) sel.append(el('option', { value: c.id, textContent: c.name }));
  if (custom) sel.append(el('option', { value: 'custom', textContent: 'Perso (choisis tes armes)…' }));
  const desc = el('div', { className: 'cls-desc' });
  const box = el('div', { className: 'cls-custom hidden' });
  const budget = el('div', { className: 'cls-budget' });
  const checks = WEAPONS.map((w, i) => {
    const cb = el('input', { type: 'checkbox' });
    cb.dataset.w = String(i);
    box.append(el('label', { className: 'cls-w' }, cb, ` ${w.name} `, el('small', { textContent: `${w.cost} pt${w.cost > 1 ? 's' : ''}` })));
    return cb;
  });
  box.append(budget);
  root.replaceChildren(sel, desc, box);

  const chosen = () => checks.filter((c) => c.checked).map((c) => Number(c.dataset.w));

  function refresh() {
    const isCustom = sel.value === 'custom';
    box.classList.toggle('hidden', !isCustom);
    if (isCustom) {
      const list = chosen();
      const cost = weaponCost(list);
      budget.textContent = `${cost} / ${CUSTOM_BUDGET} points · ${list.length} / ${CUSTOM_MAX_WEAPONS} armes`;
      budget.classList.toggle('bad', !list.length || cost > CUSTOM_BUDGET);
      desc.textContent = list.length ? `Touches : ${list.map((i, k) => `${k + 1} ${WEAPONS[i].name}`).join(' · ')}` : 'Choisis au moins une arme';
    } else {
      const c = CLASSES[sel.value];
      desc.textContent = `${c.desc}${c.hp !== 100 ? '' : ''}`;
    }
  }

  function apply() {
    if (sel.value === 'custom') {
      const list = chosen();
      if (!list.length || weaponCost(list) > CUSTOM_BUDGET) return;   // choix invalide : on garde l'ancien
      settings.custom = list;
    }
    settings.cls = sel.value;
    save();
    onChange?.();
  }

  sel.addEventListener('change', () => { refresh(); apply(); });
  for (const cb of checks) {
    cb.addEventListener('change', () => {
      const list = chosen();
      if (cb.checked && (list.length > CUSTOM_MAX_WEAPONS || weaponCost(list) > CUSTOM_BUDGET)) cb.checked = false; // trop cher / trop d'armes
      refresh(); apply();
    });
  }

  // état initial
  const valid = CLASSES[settings.cls] || (custom && settings.cls === 'custom');
  sel.value = valid ? settings.cls : 'classic';
  const saved = Array.isArray(settings.custom) ? settings.custom : [];
  const init = resolveClass('custom', saved);
  for (const c of checks) c.checked = init.id === 'custom' && init.weapons.includes(Number(c.dataset.w));
  if (sel.value === 'custom' && init.id !== 'custom') sel.value = 'classic';
  refresh();
  return { refresh };
}
