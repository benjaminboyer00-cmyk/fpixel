// Armurerie : skins d'armes débloqués par les frags faits avec chaque arme (compteur gardé dans ce navigateur).
import { WEAPONS } from '../shared/config.js';
import { SKINS, skinIndex } from '../shared/skins.js';
import { weaponImg } from './weapon-icons.js';

// Armes sans dégâts (portail, grappin) : on ne peut pas faire de frags avec, elles progressent avec les frags totaux / 4
const noKills = (w) => w.kind === 'portal' || w.kind === 'grapple';
export const armoryWeapons = () => WEAPONS.filter((w) => !w.item);

export function weaponProgress(stats, w) {
  return noKills(w) ? Math.floor((stats.kills || 0) / 4) : (stats.wk?.[w.id] || 0);
}

export const isUnlocked = (stats, w, skin) => weaponProgress(stats, w) >= SKINS[skin].need;

// Skins portés, limités à ceux réellement débloqués : { idArme: indexSkin } (sans les skins standard)
export function equippedSkins(settings, stats) {
  const out = {};
  for (const w of armoryWeapons()) {
    const si = skinIndex(settings.skins?.[w.id]);
    if (si > 0 && isUnlocked(stats, w, si)) out[w.id] = si;
  }
  return out;
}

// Format envoyé au serveur : { indexArme: indexSkin }
export function skinsForServer(byId) {
  const out = {};
  WEAPONS.forEach((w, i) => { if (byId[w.id]) out[i] = byId[w.id]; });
  return out;
}

function el(tag, props = {}, ...children) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...children);
  return e;
}

export function renderArmory(list, sub, settings, stats, onChange) {
  list.replaceChildren();
  let unlocked = 0, total = 0;
  for (const w of armoryWeapons()) {
    const prog = weaponProgress(stats, w);
    const cur = skinIndex(settings.skins?.[w.id]);
    const skins = el('div', { className: 'arm-skins', role: 'radiogroup', ariaLabel: `Skins ${w.name}` });
    SKINS.forEach((s, si) => {
      total++;
      const open = prog >= s.need;
      if (open) unlocked++;
      const on = open && (cur === si || (si === 0 && !isUnlocked(stats, w, cur)));
      const b = el('button', { className: `arm-skin${on ? ' sel' : ''}${open ? '' : ' locked'}`, type: 'button', title: open ? s.name : `${s.name} : ${s.need} frags avec cette arme` },
        weaponImg(w.id, 60, 'w-icon', si), el('small', { textContent: open ? s.name : `${prog}/${s.need}` }));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      if (!open) b.setAttribute('aria-disabled', 'true');
      b.addEventListener('click', () => {
        if (!open) return;
        if (si === 0) delete settings.skins[w.id]; else settings.skins[w.id] = s.id;
        onChange();
        renderArmory(list, sub, settings, stats, onChange);
      });
      skins.append(b);
    });
    const label = noKills(w) ? `${prog} pts (frags totaux ÷ 4)` : `${prog} frag${prog > 1 ? 's' : ''}`;
    list.append(el('div', { className: 'arm-row' },
      el('div', { className: 'arm-name' }, weaponImg(w.id, 96, 'w-icon', cur > 0 && isUnlocked(stats, w, cur) ? cur : 0), el('b', { textContent: w.name }), el('small', { textContent: label })),
      skins));
  }
  sub.textContent = `${unlocked}/${total} débloqués`;
}
