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
    this.ti = 0;
    this.pi = 0;
    this._v = new THREE.Vector3();
  }

  tracer(ax, ay, az, bx, by, bz, color = 0xffe9a0) {
    const m = this.tracers[this.ti++ % this.tracers.length];
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 0.05) return;
    m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    m.lookAt(bx, by, bz);
    m.scale.set(1, 1, len);
    m.material.color.setHex(color);
    m.material.opacity = 0.9;
    m.userData.life = 0.07;
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
  }
}
