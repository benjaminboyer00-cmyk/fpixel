// Tout ce qui est affiché par-dessus le jeu (DOM). Les noms de joueurs passent par textContent.
import { WEAPONS, TEAM_COLORS, FFA_COLORS, MODES, GUN_ORDER, NADE_MAX } from '../shared/config.js';

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
    this.loadout = [];
    this.slots = [];
    this.tslots = [];
  }

  // Barre d'armes de la classe : la touche affichée est la position dans la liste (1, 2, 3...)
  setLoadout(list) {
    const bar = $('weapons'), tbar = $('t-weapons');
    this.loadout = list.slice();
    this.slots = [];
    this.tslots = [];
    bar.replaceChildren();
    tbar.replaceChildren();
    list.forEach((wi, k) => {
      const w = WEAPONS[wi];
      const series = w.streak !== undefined;            // arme de série : touche 6, 7 ou 8
      const s = el('div', { className: series ? 'wslot streak' : 'wslot' }, el('b', { textContent: String(series ? 6 + w.streak : k + 1) }), w.name.replace('Fusil ', 'F. ').replace('Lance-', 'L. '));
      bar.append(s);
      this.slots.push(s);
      const t = el('button', { className: series ? 'tw streak' : 'tw', textContent: String(series ? 6 + w.streak : k + 1) });
      t.dataset.w = String(series ? 5 + w.streak : k);
      tbar.append(t);
      this.tslots.push(t);
    });
    delete this.cache.sel;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); this.banner(null); this.death(false); this.showScoreboard(false); }

  _set(id, key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply($(id), value);
  }

  setHp(hp, max = 100) {
    hp = Math.max(0, Math.round(hp));
    this._set('hp-text', 'hp', `${hp}/${max}`, (e) => {
      e.textContent = hp;
      const f = $('hp-fill'), r = hp / max;
      f.style.width = `${Math.min(100, r * 100)}%`;
      f.style.background = r > 0.6 ? '#46a758' : r > 0.3 ? '#f5a524' : '#e5484d';
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
      const cur = this.loadout.indexOf(i);
      this.slots.forEach((s, k) => s.classList.toggle('sel', k === cur));
      this.tslots.forEach((s, k) => s.classList.toggle('sel', k === cur));
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

  // petit message d'aide qui disparaît tout seul
  hint(text, ms = 8000) {
    const e = $('hint');
    e.textContent = text;
    e.classList.add('on');
    clearTimeout(this.hintT);
    this.hintT = setTimeout(() => e.classList.remove('on'), ms);
  }

  // Grenades à main restantes (touche G)
  setNades(n, show = true) {
    this._set('nades', 'nades', show ? n : -1, (e) => { e.textContent = show ? `G · Grenade ${'●'.repeat(n)}${'○'.repeat(Math.max(0, NADE_MAX - n))}` : ''; });
  }

  // Statistiques de fin de manche (null = masquées) : rows = [id, frags, morts, dégâts, précision %, têtes, série max, arme préférée]
  setStats(rows, mvp = null) {
    this.stats = rows ? new Map(rows.map((r) => [r[0], r])) : null;
    this.mvp = mvp;
  }

  // Petite ligne d'aide sous l'arme (tir secondaire, recharge de l'onde...)
  setSpecial(text) { this._set('special', 'special', text, (e, v) => { e.textContent = v; }); }

  // Missile nucléaire : cinématique (bandes noires, symbole, compte à rebours)
  nuke(show, who = '') {
    const e = $('nuke');
    if (!show) { e.classList.remove('on'); e.classList.add('hidden'); return; }
    $('nuke-sub').textContent = who;
    e.classList.remove('hidden');
    void e.offsetWidth;
    e.classList.add('on');
  }
  nukeCount(sec) { this._set('nuke-count', 'nc', Math.ceil(sec), (e, v) => { e.textContent = v > 0 ? v : ''; }); }

  // Flash blanc de l'explosion
  flash() {
    const f = $('flash');
    f.style.transition = 'none'; f.style.opacity = '1';
    void f.offsetWidth;
    f.style.transition = 'opacity 3s ease-out'; f.style.opacity = '0';
  }

  // Gaz toxique : kind = 'toxic' (les autres), 'mask' (le lanceur, masque à gaz), null = fini
  gas(kind, left = 0) {
    $('gas-overlay').classList.toggle('hidden', kind !== 'toxic');
    $('mask').classList.toggle('hidden', kind !== 'mask');
    const t = $('gas-text');
    t.classList.toggle('hidden', !kind);
    if (kind) this._set('gas-text', 'gas', `${kind}:${Math.ceil(left)}`, (e) => { e.textContent = kind === 'mask' ? `☣ MASQUE À GAZ · ${Math.ceil(left)} s` : `☣ GAZ TOXIQUE · ${Math.ceil(left)} s`; });
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
    } else if (mode === 'gun') {
      const lvl = me?.lvl ?? 0;
      line.textContent = `Niveau ${lvl + 1}/${GUN_ORDER.length} · ${WEAPONS[GUN_ORDER[lvl]].name}`;
      const top = [...players].sort((a, b) => (b.lvl - a.lvl) || (b.k - a.k))[0];
      sub.textContent = top ? `Leader : ${top.name} (niveau ${top.lvl + 1}) · tue au niveau ${GUN_ORDER.length} pour gagner` : '';
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
    const gun = mode === 'gun';
    const table = (list, title, color) => {
      const t = el('table');
      const st = this.stats;
      t.append(el('tr', {}, el('th', { textContent: 'Joueur' }), ...(gun ? [el('th', { textContent: 'Niveau' })] : []), el('th', { textContent: 'Frags' }), el('th', { textContent: 'Morts' }),
        ...(st ? ['Dégâts', 'Préc.', 'Têtes', 'Série', 'Arme'].map((h) => el('th', { textContent: h })) : [])));
      const order = gun ? (a, b) => (b.lvl - a.lvl) || (b.k - a.k) : (a, b) => b.k - a.k || a.d - b.d;
      for (const p of [...list].sort(order)) {
        const tr = el('tr', p.id === meId ? { className: 'me' } : {});
        tr.append(el('td', { textContent: p.name, style: `color:${playerColor(mode, p)}` }), ...(gun ? [el('td', { textContent: `${p.lvl + 1}/${GUN_ORDER.length}` })] : []), el('td', { textContent: p.k }), el('td', { textContent: p.d }));
        const r = st?.get(p.id);
        if (r) {
          if (this.mvp === p.id) tr.firstChild.textContent = `★ ${p.name}`;
          tr.append(el('td', { textContent: r[3] }), el('td', { textContent: `${r[4]}%` }), el('td', { textContent: r[5] }), el('td', { textContent: r[6] }), el('td', { textContent: WEAPONS[r[7]]?.name ?? '—' }));
        }
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
