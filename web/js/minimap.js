// Mini-carte : toute l'arène vue de dessus (haut = côté rouge).
// Montre TOUJOURS les coéquipiers, et les joueurs qui tirent (un anneau pendant 2 s à l'endroit du tir).
// Les ennemis qui ne tirent pas restent invisibles : ce n'est pas un wallhack.
import { TEAM_COLORS } from '../shared/config.js';
import { playerColor } from './hud.js';

const BOX_COLORS = {
  wall: '#566172', crate: '#b07a3d', crateDark: '#835a2c', platform: '#7d91aa',
  stairs: '#9aa8ba', low: '#7f8f52', pillar: '#c1c5cc', stone: '#868b93',
  brick: '#8a4632', brickDark: '#6a3628', roof: '#4b3c32', wood: '#7a5c39', plaster: '#c4bba4',
  fence: '#8f7850', bush: '#356632', concrete: '#82858b', metal: '#56606c', road: '#5c5c5f',
};
const PING_MS = 2200;

export class Minimap {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.pings = [];
    this.visible = true;
    this.stats = { allies: 0, pings: 0 };
    this.map = null;
    this.bg = null;
  }

  setMap(map) { this.map = map; this.resize(); }

  // (re)dessine le décor une fois ; à rappeler si la taille CSS change
  resize() {
    if (!this.map) return;
    const HALF = this.map.half;
    const css = this.c.clientWidth || 170;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.c.width = this.c.height = Math.round(css * dpr);
    this.s = this.c.width / (2 * HALF + 2);   // pixels par mètre
    const bg = document.createElement('canvas');
    bg.width = bg.height = this.c.width;
    const g = bg.getContext('2d');
    g.fillStyle = '#233322';
    g.fillRect(0, 0, bg.width, bg.height);
    const boxes = this.map.boxes.filter((b) => b.y0 < 6).sort((a, b) => a.y1 - b.y1); // sans le plafond des cartes intérieures
    for (const b of boxes) {
      const x = this.X(b.x0), y = this.Z(b.z0), w = (b.x1 - b.x0) * this.s, h = (b.z1 - b.z0) * this.s;
      g.fillStyle = BOX_COLORS[b.c] || '#666';
      g.fillRect(x, y, w, h);
      if (b.y1 - b.y0 >= 2) { g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, w - 1, h - 1); }
    }
    this.bg = bg;
  }

  X(x) { return (x + this.map.half + 1) * this.s; }
  Z(z) { return (z + this.map.half + 1) * this.s; }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.c.classList.toggle('hidden', !v);
  }

  ping(x, z, color) {
    this.pings.push({ x, z, color, t: performance.now() });
    if (this.pings.length > 40) this.pings.shift();
  }

  clear() { this.pings.length = 0; }

  _dot(x, y, r, color) {
    const c = this.ctx;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = color; c.fill();
    c.lineWidth = this.dpr; c.strokeStyle = 'rgba(0,0,0,.85)'; c.stroke();
  }

  // game : instance de Game (players, me, mode, myId, teamName)
  draw(game, now) {
    if (!this.map || !this.bg) return;
    const c = this.ctx, d = this.dpr;
    c.clearRect(0, 0, this.c.width, this.c.height);
    c.drawImage(this.bg, 0, 0);

    // coéquipiers (toujours visibles)
    let allies = 0;
    if (game.mode === 'tdm') {
      for (const p of game.players.values()) {
        if (p.id === game.myId || p.team !== game.teamName || p.hp <= 0 || !p.snaps.length) continue;
        const pos = p.model.group.position;
        this._dot(this.X(pos.x), this.Z(pos.z), 3.6 * d, TEAM_COLORS[p.team]);
        allies++;
      }
    }

    // tirs récents (anneau qui s'agrandit et s'efface)
    this.pings = this.pings.filter((p) => now - p.t < PING_MS);
    for (const p of this.pings) {
      const k = (now - p.t) / PING_MS;
      const x = this.X(p.x), y = this.Z(p.z);
      c.globalAlpha = 1 - k;
      c.beginPath(); c.arc(x, y, (3 + k * 9) * d, 0, Math.PI * 2);
      c.lineWidth = 2 * d; c.strokeStyle = p.color; c.stroke();
      c.beginPath(); c.arc(x, y, 2.4 * d, 0, Math.PI * 2);
      c.fillStyle = p.color; c.fill();
      c.globalAlpha = 1;
    }

    // moi : champ de vision + flèche
    const me = game.me;
    if (me?.spawned) {
      const x = this.X(me.x), y = this.Z(me.z);
      const a = Math.atan2(-Math.cos(me.yaw), -Math.sin(me.yaw));
      const half = ((game.getSettings().fov * Math.PI) / 180) / 2;
      c.beginPath(); c.moveTo(x, y); c.arc(x, y, 15 * this.s, a - half, a + half); c.closePath();
      c.fillStyle = 'rgba(255,255,255,.14)'; c.fill();
      c.save(); c.translate(x, y); c.rotate(a);
      c.beginPath(); c.moveTo(6 * d, 0); c.lineTo(-4 * d, 4 * d); c.lineTo(-2 * d, 0); c.lineTo(-4 * d, -4 * d); c.closePath();
      c.fillStyle = me.alive ? '#ffffff' : '#888'; c.fill();
      c.lineWidth = d; c.strokeStyle = '#000'; c.stroke();
      c.restore();
    }
    this.stats = { allies, pings: this.pings.length };
  }
}
