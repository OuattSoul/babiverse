// PNJ en 3D : comportement simple (immobile, flânerie) et clients du kiosque.
// Positions en pixels de grille (mêmes unités que les collisions) ; rendu en cases.
import { isSolid, moveBody, TILE } from '../world/grid.js';
import { animateCharacter, buildCharacter, faceTowards } from './character.js';
import { textSprite } from './materials.js';
import { inhabitantLooks } from '../atelier/pack.js';

const SPEED = 55; // px/s
const FACING = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };

export class Npc {
  constructor(world, { id, x, y, look, name, behavior }) {
    this.world = world;
    this.id = id;
    this.body = { x, y, hw: 6, hh: 4 };
    this.home = { x, y };
    this.behavior = behavior || { type: 'static' };
    this.model = buildCharacter(look);
    this.model.rotation.y = FACING[this.behavior.facing || 'down'];
    world.zoneGroup.add(this.model);
    if (name) {
      this.label = textSprite(name, { size: 24 });
      this.label.position.y = 1.45;
      this.model.add(this.label);
    }
    this.target = null;
    this.waitUntil = 0;
    this.speed = 0;
    this.sync();
  }

  get x() { return this.body.x; }
  get y() { return this.body.y; }

  sync() { this.model.position.set(this.body.x / TILE, 0, this.body.y / TILE); }

  walkTo(x, y) { this.target = { x, y }; }

  face(dir) { this.model.rotation.y = FACING[dir]; }

  /** Avance vers la cible ; retourne true une fois arrivé (ou bloqué). */
  step(dt, grid) {
    if (!this.target) { this.speed = 0; return true; }
    const dx = this.target.x - this.body.x;
    const dy = this.target.y - this.body.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) { this.target = null; this.speed = 0; return true; }
    const s = Math.min(dist, SPEED * dt);
    const next = moveBody(grid, this.body, (dx / dist) * s, (dy / dist) * s);
    const moved = Math.hypot(next.x - this.body.x, next.y - this.body.y);
    this.body.x = next.x;
    this.body.y = next.y;
    faceTowards(this.model, dx, dy, dt);
    this.speed = moved / Math.max(dt, 1e-3) / SPEED;
    if (moved < s * 0.2) { this.target = null; this.speed = 0; return true; }
    return false;
  }

  update(time, dt, grid) {
    if (this.behavior.type === 'wander') {
      if (this.target) this.step(dt, grid);
      else if (time > this.waitUntil) {
        const r = this.behavior.radius * TILE;
        const tx = this.home.x + (Math.random() * 2 - 1) * r;
        const ty = this.home.y + (Math.random() * 2 - 1) * r;
        if (!isSolid(grid, Math.floor(tx / TILE), Math.floor(ty / TILE))) this.walkTo(tx, ty);
        this.waitUntil = time + 2000 + Math.random() * 3000;
      }
    }
    animateCharacter(this.model, dt, this.speed);
    this.sync();
  }

  destroy() { this.model.removeFromParent(); }
}

const CUSTOMER_LOOKS = [
  { skin: '#8d5524', outfit: '#27ae60', hair: 'short', pants: '#34495e' },
  { skin: '#c68642', outfit: '#8e44ad', hair: 'braids', pants: '#2c3e50' },
  { skin: '#5c3a1e', outfit: '#f1c40f', hair: 'afro', pants: '#7f8c8d' },
  { skin: '#f1c27d', outfit: '#e74c3c', hair: 'short', pants: '#2d3436' },
];

const randomOf = (list) => list[Math.floor(Math.random() * list.length)];

/** Quand le joueur « tient » son kiosque, un client arrive, attend au comptoir puis repart. */
export class KioskCustomers {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.active = false;
    this.current = null;
    this.nextAt = 0;
  }

  setActive(value) {
    this.active = value;
    this.nextAt = this.world.time + 1500;
    if (!value && this.current?.state !== 'leaving') this.leave();
  }

  waiting() { return this.current?.state === 'waiting'; }

  served() {
    this.world.floatText(this.current.npc.x, this.current.npc.y, 'Merci !');
    this.leave();
  }

  leave() {
    const c = this.current;
    if (!c) return;
    c.state = 'leaving';
    c.bubble?.removeFromParent();
    c.npc.walkTo(c.exit.x, c.exit.y);
  }

  update(time, dt, grid, playerNear) {
    if (this.active && !playerNear) {
      this.setActive(false);
      this.world.ui.toast('Tu as quitté ton kiosque : plus de clients pour le moment.', 'info');
    }
    const c = this.current;
    if (c) {
      if (c.state === 'arriving' && c.npc.step(dt, grid)) {
        c.state = 'waiting';
        c.until = time + 20000;
        c.npc.face('up');
        c.bubble = this.world.makeBubble();
        c.bubble.position.y = 1.7;
        c.npc.model.add(c.bubble);
      } else if (c.state === 'waiting' && time > c.until) {
        this.world.floatText(c.npc.x, c.npc.y, 'Trop long…');
        this.leave();
      } else if (c.state === 'leaving' && c.npc.step(dt, grid)) {
        c.npc.destroy();
        this.current = null;
        this.nextAt = time + 5000 + Math.random() * 5000;
        return;
      }
      animateCharacter(c.npc.model, dt, c.npc.speed);
      c.npc.sync();
      return;
    }
    if (this.active && time > this.nextAt) {
      const [sx, sy] = this.cfg.spawns[Math.floor(Math.random() * this.cfg.spawns.length)];
      const spawn = { x: (sx + 0.5) * TILE, y: (sy + 0.5) * TILE };
      const [wx, wy] = this.cfg.wait;
      const npc = new Npc(this.world, {
        id: 'client', x: spawn.x, y: spawn.y,
        look: randomOf(inhabitantLooks().length ? inhabitantLooks() : CUSTOMER_LOOKS),
      });
      npc.walkTo((wx + 0.5) * TILE, (wy + 0.5) * TILE);
      this.current = { npc, state: 'arriving', exit: spawn };
    }
  }

  destroy() { this.current?.npc.destroy(); }
}
