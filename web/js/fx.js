// Effets : traînées de balles et petits cubes qui giclent (impacts, sang pixelisé).
import * as THREE from 'three';
import { buildPlane } from './models.js';

const tracerGeo = new THREE.BoxGeometry(0.035, 0.035, 1);
const partGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
const unitGeo = new THREE.BoxGeometry(1, 1, 1); // ondes et boules de feu : mises à l'échelle en mètres

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
      const m = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: 0xffb84a, transparent: true, fog: false }));
      m.visible = false; m.userData = { life: 0, max: 0.35, r: 1 };
      scene.add(m);
      this.flashes.push(m);
    }
    this.waves = [];  // ondes d'Excalibur
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(unitGeo, new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, fog: false, depthTest: false, side: 2 /* DoubleSide (absent du build three.js allégé) */ }));
      m.visible = false; m.renderOrder = 10; m.frustumCulled = false; m.userData = { life: 0, max: 0.7 };
      scene.add(m);
      this.waves.push(m);
    }
    this.wi = 0;
    this.planes = new Map();  // avions en papier des autres joueurs
    this.projs = new Map();  // roquettes / grenades en vol
    this.portals = new Map(); // "propriétaire:i" -> mesh
    this.fi = 0;
    this.ti = 0;
    this.pi = 0;
    this._v = new THREE.Vector3();
  }

  // Onde d'Excalibur : grand plan lumineux qui traverse tout (visible à travers les murs), s'estompe en 0,7 s
  wave(o, d, len) {
    const m = this.waves[this.wi++ % this.waves.length];
    m.position.set(o[0] + d[0] * len / 2, o[1] + d[1] * len / 2, o[2] + d[2] * len / 2);
    m.lookAt(o[0] + d[0] * len, o[1] + d[1] * len, o[2] + d[2] * len);
    m.scale.set(3.4, 2.6, len);
    m.userData.life = m.userData.max = 0.7;
    m.visible = true;
  }

  // Jet de flammes : particules projetées dans la direction du tir
  jet(x, y, z, dx, dy, dz) {
    const cols = ['#ff9a2e', '#ffd45a', '#ff5a1f', '#ffe9a0'];
    for (let i = 0; i < 5; i++) {
      const m = this.parts[this.pi++ % this.parts.length];
      const v = 7 + Math.random() * 6;
      m.position.set(x, y, z);
      m.material.color.set(cols[(Math.random() * cols.length) | 0]);
      m.userData.vx = dx * v + (Math.random() - 0.5) * 1.6;
      m.userData.vy = dy * v + (Math.random() - 0.3) * 1.6 + 1.2;
      m.userData.vz = dz * v + (Math.random() - 0.5) * 1.6;
      m.userData.life = 0.35 + Math.random() * 0.25;
      m.scale.setScalar(1.6);
      m.visible = true;
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

  addProj(id, kind, x, y, z, vx, vy, vz, g, bounce = 0) {
    const orb = kind === 'orb';
    const grenade = kind === 'grenade' || kind === 'frag' || orb;
    const sz = orb ? 1.7 : grenade ? 0.24 : 0.16;
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(sz, sz, grenade ? sz : 0.5),
      new THREE.MeshBasicMaterial({ color: orb ? 0xc040ff : grenade ? 0x4d5a3d : 0xd9d9d9, fog: false }));
    m.position.set(x, y, z);
    this.scene.add(m);
    this.projs.set(id, { m, vx, vy, vz, g, trail: 0, grenade, bounce, orb });
  }

  // Rebond calculé par le serveur : on recale la position et la vitesse
  bounceProj(id, o, v) {
    const p = this.projs.get(id);
    if (!p) return;
    p.m.position.set(o[0], o[1], o[2]);
    p.vx = v[0]; p.vy = v[1]; p.vz = v[2];
  }

  // Avion en papier d'un autre joueur : on glisse vers la dernière position reçue
  setPlane(id, x, y, z, yaw, pitch) {
    let p = this.planes.get(id);
    if (!p) {
      const m = buildPlane();
      m.position.set(x, y, z);
      this.scene.add(m);
      p = { m, tx: x, ty: y, tz: z, yaw, pitch };
      this.planes.set(id, p);
    }
    p.tx = x; p.ty = y; p.tz = z; p.yaw = yaw; p.pitch = pitch;
  }

  removePlane(id) {
    const p = this.planes.get(id);
    if (!p) return;
    this.scene.remove(p.m);
    p.m.traverse((o) => { o.geometry?.dispose?.(); });
    this.planes.delete(id);
  }

  removeProj(id) {
    const p = this.projs.get(id);
    if (!p) return;
    this.scene.remove(p.m);
    p.m.geometry.dispose(); p.m.material.dispose();
    this.projs.delete(id);
  }

  // Portail : cadre coloré + intérieur lumineux, posé contre un mur (n = normale horizontale)
  setPortal(key, i, x, y, z, nx, nz, ny = 0) {
    this.removePortal(key);
    const color = i === 0 ? 0x3e82f7 : 0xf5a524;
    const g = new THREE.Group();
    const flat = ny !== 0;   // portail de sol / de plafond : carré posé à plat
    g.add(new THREE.Mesh(new THREE.BoxGeometry(flat ? 1.6 : 1.2, flat ? 0.05 : 2.2, flat ? 1.6 : 0.05), new THREE.MeshBasicMaterial({ color, fog: false })));
    const inner = new THREE.Mesh(new THREE.BoxGeometry(flat ? 1.32 : 0.92, flat ? 0.06 : 1.92, flat ? 1.32 : 0.06), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xbfd8ff : 0xffe2b0, transparent: true, opacity: 0.85, fog: false }));
    g.add(inner);
    g.position.set(x, y, z);
    if (!flat) g.rotation.y = Math.atan2(nx, nz);
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
      m.scale.setScalar(u.r * (0.8 + 1.2 * t));
      m.material.opacity = 0.9 * (1 - t);
      m.rotation.y += dt * 4;
    }
    for (const m of this.waves) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) { m.visible = false; continue; }
      const t = 1 - m.userData.life / m.userData.max;
      m.material.opacity = 0.5 * (1 - t);
      m.scale.x = 3.4 * (1 - t * 0.7);
    }
    for (const p of this.projs.values()) {
      p.vy -= p.g * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      if (p.bounce && p.m.position.y < 0.12) { // grenade à main : elle roule sur le sol
        p.m.position.y = 0.12; if (p.vy < 0) p.vy = 0;
        const f = Math.pow(0.94, dt / 0.033); p.vx *= f; p.vz *= f;
      }
      if (!p.grenade) p.m.lookAt(p.m.position.x + p.vx, p.m.position.y + p.vy, p.m.position.z + p.vz);
      p.trail -= dt;
      if (p.trail <= 0) { p.trail = p.orb ? 0.02 : 0.035; this.burst(p.m.position.x, p.m.position.y, p.m.position.z, p.orb ? '#c040ff' : p.grenade ? '#8a8a8a' : '#ffb04a', p.orb ? 5 : 1, p.orb ? 5 : 0.6, 0.5); if (p.orb) p.m.rotation.y += 0.4; }
    }
    const k = 1 - Math.exp(-dt * 18);
    for (const p of this.planes.values()) {
      p.m.position.x += (p.tx - p.m.position.x) * k; p.m.position.y += (p.ty - p.m.position.y) * k; p.m.position.z += (p.tz - p.m.position.z) * k;
      p.m.rotation.set(p.pitch, p.yaw, 0);
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
    for (const m of this.waves) m.visible = false;
    for (const id of [...this.projs.keys()]) this.removeProj(id);
    for (const id of [...this.planes.keys()]) this.removePlane(id);
    for (const k of [...this.portals.keys()]) this.removePortal(k);
  }
}
