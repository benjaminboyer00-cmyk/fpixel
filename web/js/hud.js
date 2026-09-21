// Tout ce qui est affiché par-dessus le jeu (DOM). Les noms de joueurs passent par textContent.
import { WEAPONS, TEAM_COLORS, FFA_COLORS, MODES } from '../shared/config.js';

const $ = (id) => document.getElementById(id);
const teamName = { red: 'ROUGE', blue: 'BLEU' };

export function playerColor(mode, p) {
  if (p.team) return TEAM_COLORS[p.team];
  if (mode === 'duel') return '#e5484d';
  return FFA_COLORS[p.id % FFA_COLORS.length];
}

function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const c of children) e.append(c);
  return e;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.cache = {};
    this.hitT = 0;
    this.dmgT = 0;
    this._buildWeaponBars();
  }

  _buildWeaponBars() {
    const bar = $('weapons'), tbar = $('t-weapons');
    this.slots = [];
    this.tslots = [];
    WEAPONS.forEach((w, i) => {
      const s = el('div', { className: 'wslot' }, el('b', { textContent: w.key }), w.name.replace('Fusil ', 'F. '));
      bar.append(s);
      this.slots.push(s);
      const t = el('button', { className: 'tw', textContent: w.key });
      t.dataset.w = String(i);
      tbar.append(t);
      this.tslots.push(t);
    });
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); this.banner(null); this.death(false); this.showScoreboard(false); }

  _set(id, key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply($(id), value);
  }

  setHp(hp) {
    hp = Math.max(0, Math.round(hp));
    this._set('hp-text', 'hp', hp, (e, v) => {
      e.textContent = v;
      const f = $('hp-fill');
      f.style.width = `${v}%`;
      f.style.background = v > 60 ? '#46a758' : v > 30 ? '#f5a524' : '#e5484d';
    });
  }

  setWeapon(i, ammo, reloading) {
    const w = WEAPONS[i];
    this._set('weapon-name', 'wn', w.name + (reloading ? ' — rechargement…' : ''), (e, v) => { e.textContent = v; });
    const key = `${i}:${ammo}`;
    this._set('ammo', 'ammo', key, (e) => {
      e.classList.toggle('low', w.mag > 0 && ammo <= Math.ceil(w.mag * 0.25));
      e.replaceChildren(w.mag ? `${ammo}` : '—', ...(w.mag ? [el('small', { textContent: ` / ${w.mag}` })] : []));
    });
    this._set('weapons', 'sel', i, () => {
      this.slots.forEach((s, k) => s.classList.toggle('sel', k === i));
      this.tslots.forEach((s, k) => s.classList.toggle('sel', k === i));
    });
  }

  killfeed(killer, victim, weaponIdx, head, mine, mode) {
    const feed = $('killfeed');
    const row = el('div');
    if (mine) row.className = 'me';
    const name = (p) => el('span', { textContent: p ? p.name : '?', style: `color:${p ? playerColor(mode, p) : '#fff'}` });
    row.append(name(killer), el('span', { textContent: ` [${WEAPONS[weaponIdx]?.name ?? '?'}]${head ? ' ★' : ''} ` }), name(victim));
    feed.append(row);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  sysMessage(text) {
    const row = el('div', { textContent: text, style: 'color:#aab5c4' });
    $('killfeed').append(row);
    setTimeout(() => row.remove(), 6000);
  }

  banner(title, sub = '') {
    const e = $('banner');
    if (!title) { if (this.cache.banner !== '') { e.replaceChildren(); this.cache.banner = ''; } return; }
    const k = `${title}|${sub}`;
    if (this.cache.banner === k) return;
    this.cache.banner = k;
    e.replaceChildren(title, ...(sub ? [el('small', { textContent: sub })] : []));
  }

  death(show, killerName = '', seconds = 0) {
    $('death').classList.toggle('hidden', !show);
    if (!show) return;
    $('death-title').textContent = killerName ? `Éliminé par ${killerName}` : 'Éliminé';
    $('death-sub').textContent = seconds > 0 ? `Réapparition dans ${seconds}s` : 'Réapparition…';
  }

  hitmarker(kill) {
    const e = $('hitmarker');
    e.classList.toggle('kill', !!kill);
    e.classList.add('on');
    clearTimeout(this.hitT);
    this.hitT = setTimeout(() => e.classList.remove('on'), 90);
  }

  // angle en radians, 0 = l'attaquant est devant nous, positif = vers la droite
  damage(angle) {
    const f = $('dmg-flash'), a = $('dmg-arrow');
    a.style.transform = `rotate(${angle}rad)`;
    f.classList.add('on'); a.classList.add('on');
    clearTimeout(this.dmgT);
    this.dmgT = setTimeout(() => { f.classList.remove('on'); a.classList.remove('on'); }, 120);
  }

  netinfo(text) { this._set('netinfo', 'net', text, (e, v) => { e.textContent = v; }); }

  // -------- scores --------
  scoreLine(mode, players, teamKills, meId, limit) {
    const me = players.find((p) => p.id === meId);
    const line = $('score-line'), sub = $('score-sub');
    if (MODES[mode].teams) {
      line.replaceChildren(
        el('span', { textContent: `ROUGE ${teamKills.red}`, style: `color:${'#ff6b70'}` }), ' — ',
        el('span', { textContent: `${teamKills.blue} BLEU`, style: `color:${'#6ea0ff'}` }));
      sub.textContent = `Premier à ${limit} frags${me?.team ? ` · tu es ${teamName[me.team]}` : ''}`;
    } else if (mode === 'duel') {
      const foe = players.find((p) => p.id !== meId);
      line.textContent = foe ? `Toi ${me?.k ?? 0} — ${foe.k} ${foe.name}` : 'Duel 1v1';
      sub.textContent = `Premier à ${limit} frags`;
    } else {
      const top = [...players].sort((a, b) => b.k - a.k)[0];
      line.textContent = `Toi ${me?.k ?? 0} frags`;
      sub.textContent = top ? `Leader : ${top.name} (${top.k}) · objectif ${limit}` : `Objectif ${limit}`;
    }
  }

  showScoreboard(show) { $('scoreboard').classList.toggle('hidden', !show); }

  renderScoreboard(mode, players, teamKills, meId) {
    const box = $('scoreboard');
    const table = (list, title, color) => {
      const t = el('table');
      t.append(el('tr', {}, el('th', { textContent: 'Joueur' }), el('th', { textContent: 'Frags' }), el('th', { textContent: 'Morts' })));
      for (const p of [...list].sort((a, b) => b.k - a.k || a.d - b.d)) {
        const tr = el('tr', p.id === meId ? { className: 'me' } : {});
        tr.append(el('td', { textContent: p.name, style: `color:${playerColor(mode, p)}` }), el('td', { textContent: p.k }), el('td', { textContent: p.d }));
        t.append(tr);
      }
      const wrap = el('div');
      if (title) wrap.append(el('h3', { textContent: title, style: `color:${color}` }));
      wrap.append(t);
      return wrap;
    };
    if (MODES[mode].teams) {
      box.replaceChildren(
        table(players.filter((p) => p.team === 'red'), `ÉQUIPE ROUGE — ${teamKills.red}`, TEAM_COLORS.red),
        table(players.filter((p) => p.team === 'blue'), `ÉQUIPE BLEUE — ${teamKills.blue}`, TEAM_COLORS.blue));
    } else {
      box.replaceChildren(table(players, MODES[mode].label, '#fff'));
    }
  }
}
