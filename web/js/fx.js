// Effets : traînées de balles et petits cubes qui giclent (impacts, sang pixelisé).
import * as THREE from 'three';

const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    for (let i = 0; i < 40; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, fog: false }));
      m.visible = false; m.frustumCulled = false;
      m.userData.life = 0;
      scene.add(m);
      this.tracers.push(m);
    }
    this.parts = [];
    for (let i = 0; i < 100; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.visible = false;
      m.userData = { life: 0, vx: 0, vy: 0, vz: 0 };
      scene.add(m);
      this.parts.push(m);
    }
    this.flashes = []; // boules de feu des explosions
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, fog: false }));
      m.visible = false; m.userData = { life: 0, max: 0.35, r: 1 };
      scene.add(m);
      this.flashes.push(m);
    }
    this.projs = new Map();  // roquettes / grenades en vol
    this.portals = new Map(); // "propriétaire:i" -> mesh
    this.fi = 0;
    this.ti = 0;
    this.pi = 0;
    this._v = new THREE.Vector3();
  }

  // Éclair : ligne brisée entre les points (chaque segment est découpé et décalé au hasard)
  bolt(points, color = 0x8ee8ff) {
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], b = points[k + 1];
      let px = a[0], py = a[1], pz = a[2];
      const n = 5;
      for (let j = 1; j <= n; j++) {
        const f = j / n, jit = j === n ? 0 : 0.25;
        const x = a[0] + (b[0] - a[0]) * f + (Math.random() - 0.5) * jit;
        const y = a[1] + (b[1] - a[1]) * f + (Math.random() - 0.5) * jit;
        const z = a[2] + (b[2] - a[2]) * f + (Math.random() - 0.5) * jit;
        this.tracer(px, py, pz, x, y, z, color, 0.16);
        px = x; py = y; pz = z;
      }
    }
  }

  explosion(x, y, z, r) {
    const m = this.flashes[this.fi++ % this.flashes.length];
    m.position.set(x, y, z);
    m.userData.life = m.userData.max; m.userData.r = r;
    m.visible = true;
    this.burst(x, y, z, '#ff9a2e', 16, r * 2.2, 0.7);
    this.burst(x, y, z, '#ffd45a', 10, r * 1.6, 0.5);
    this.burst(x, y, z, '#5b5b5b', 10, r * 1.2, 0.9);
  }

  addProj(id, kind, x, y, z, vx, vy, vz, g) {
    const grenade = kind === 'grenade';
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(grenade ? 0.24 : 0.16, grenade ? 0.24 : 0.16, grenade ? 0.24 : 0.5),
      new THREE.MeshBasicMaterial({ color: grenade ? 0x4d5a3d : 0xd9d9d9, fog: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.projs.set(id, { m, vx, vy, vz, g, trail: 0, grenade });
  }

  removeProj(id) {
    const p = this.projs.get(id);
    if (!p) return;
    this.scene.remove(p.m);
    p.m.geometry.dispose(); p.m.material.dispose();
    this.projs.delete(id);
  }

  // Portail : cadre coloré + intérieur lumineux, posé contre un mur (n = normale horizontale)
  setPortal(key, i, x, y, z, nx, nz) {
    this.removePortal(key);
    const color = i === 0 ? 0x3e82f7 : 0xf5a524;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.05), new THREE.MeshBasicMaterial({ color, fog: false })));
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.92, 0.06), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xbfd8ff : 0xffe2b0, transparent: true, opacity: 0.85, fog: false }));
    g.add(inner);
    g.position.set(x, y, z);
    g.rotation.y = Math.atan2(nx, nz);
    g.userData.inner = inner;
    this.scene.add(g);
    this.portals.set(key, g);
  }

  removePortal(key) {
    const g = this.portals.get(key);
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
    this.portals.delete(key);
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffe9a0, life = 0.07) {
    const m = this.tracers[this.ti++ % this.tracers.length];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 0.05) return;
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.lookAt(bx, by, bz);
    m.scale.set(1, 1, len);
    m.material.color.setHex(color);
    m.material.opacity = 0.9;
    m.userData.life = m.userData.max = life;
    m.visible = true;
  }

  burst(x, y, z, color, n = 8, speed = 3, life = 0.5) {
    for (let i = 0; i < n; i++) {
      const m = this.parts[this.pi++ % this.parts.length];
      m.position.set(x, y, z);
      m.material.color.set(color);
      m.userData.vx = (Math.random() - 0.5) * speed;
      m.userData.vy = Math.random() * speed * 0.9;
      m.userData.vz = (Math.random() - 0.5) * speed;
      m.userData.life = life * (0.6 + Math.random() * 0.6);
      m.scale.setScalar(1);
      m.visible = true;
    }
  }

  update(dt) {
    for (const m of this.tracers) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) m.visible = false;
      else m.material.opacity = Math.min(1, m.userData.life / 0.07);
    }
    for (const m of this.flashes) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      const t = 1 - u.life / u.max;
      m.scale.setScalar(u.r * (0.5 + 1.3 * t));
      m.material.opacity = 0.9 * (1 - t);
      m.rotation.y += dt * 4;
    }
    for (const p of this.projs.values()) {
      p.vy -= p.g * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      if (!p.grenade) p.m.lookAt(p.m.position.x + p.vx, p.m.position.y + p.vy, p.m.position.z + p.vz);
      p.trail -= dt;
      if (p.trail <= 0) { p.trail = 0.035; this.burst(p.m.position.x, p.m.position.y, p.m.position.z, p.grenade ? '#8a8a8a' : '#ffb04a', 1, 0.6, 0.4); }
    }
    const pulse = 0.75 + 0.2 * Math.sin(performance.now() / 120);
    for (const g of this.portals.values()) g.userData.inner.material.opacity = pulse;
    for (const m of this.parts) {
      if (!m.visible) continue;
      const u = m.userData;
      u.life -= dt;
      if (u.life <= 0) { m.visible = false; continue; }
      u.vy -= 12 * dt;
      m.position.x += u.vx * dt;
      m.position.y = Math.max(0.03, m.position.y + u.vy * dt);
      m.position.z += u.vz * dt;
      m.scale.setScalar(Math.min(1, u.life * 3));
    }
  }

  clear() {
    for (const m of this.tracers) m.visible = false;
    for (const m of this.parts) m.visible = false;
    for (const m of this.flashes) m.visible = false;
    for (const id of [...this.projs.keys()]) this.removeProj(id);
    for (const k of [...this.portals.keys()]) this.removePortal(k);
  }
}
