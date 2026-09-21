// Arme en vue première personne, dessinée dans une 2e scène (pas de clipping dans les murs).
import * as THREE from 'three';
import { WEAPONS } from '../shared/config.js';
import { buildGun, VM_POSE } from './models.js';

export class ViewModel {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.guns = WEAPONS.map((w) => {
      const g = buildGun(w.id);
      g.scale.setScalar(0.72);
      g.visible = false;
      this.root.add(g);
      return g;
    });
    this.flash = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.flash.visible = false;
    this.cur = -1;
    this.kick = 0;
    this.swap = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.setWeapon(0);
  }

  setWeapon(i) {
    if (this.cur >= 0) this.guns[this.cur].visible = false;
    this.cur = i;
    const g = this.guns[i];
    g.visible = true;
    g.add(this.flash);
    this.flash.position.copy(g.userData.muzzle);
    this.flash.scale.setScalar(0.75);
    this.swap = 1;
  }

  fire() {
    this.kick = 1;
    const w = WEAPONS[this.cur];
    if (!w.melee && w.kind !== 'grapple' && w.kind !== 'portal') this.flashT = 0.05;
  }

  update(dt, { speed, onGround, reloadProgress, visible }) {
    this.root.visible = visible;
    if (!visible) return;
    const w = WEAPONS[this.cur];
    const pose = VM_POSE[w.id];
    const g = this.guns[this.cur];

    const moving = onGround ? Math.min(1, speed / 6) : 0;
    this.bobT += dt * (2 + speed * 1.3);
    const bobX = Math.sin(this.bobT) * 0.010 * moving;
    const bobY = Math.abs(Math.cos(this.bobT)) * 0.012 * moving;

    this.kick = Math.max(0, this.kick - dt * (w.melee ? 4.5 : 9));
    this.swap = Math.max(0, this.swap - dt * 4);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    this.flash.rotation.z = Math.random() * 3;

    const dip = reloadProgress === null ? 0 : Math.sin(reloadProgress * Math.PI);

    let px = pose.p[0] + bobX, py = pose.p[1] + bobY, pz = pose.p[2];
    let rx = pose.r[0], ry = pose.r[1], rz = pose.r[2];

    if (w.melee) {
      const s = Math.sin(this.kick * Math.PI);           // coup de couteau : 0 -> 1 -> 0
      rx += -this.kick * 1.4; ry += this.kick * 0.9; px -= this.kick * 0.1; pz -= s * 0.1;
    } else {
      pz += this.kick * 0.06 * (0.6 + w.recoil * 0.4);
      rx += this.kick * 0.06 * (0.6 + w.recoil * 0.5);
    }
    py -= this.swap * 0.3 + dip * 0.16;
    rx += this.swap * 0.6 - dip * 0.7;
    rz += dip * 0.4;

    g.position.set(px, py, pz);
    g.rotation.set(rx, ry, rz);
  }
}
