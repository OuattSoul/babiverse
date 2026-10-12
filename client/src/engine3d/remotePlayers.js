// Autres joueurs présents dans la même zone (positions reçues par la boucle sociale toutes les 2 s).
// Chacun marche vers sa dernière position connue à la vitesse qui lui fait parcourir l'écart en un
// intervalle : le mouvement reste continu malgré des positions espacées. Ni collision ni interaction 3D.
import { TILE } from '../world/grid.js';
import { followSpeed } from '../world/social.js';
import { animateCharacter, buildCharacter, faceTowards } from './character.js';
import { disposeGroup, textSprite } from './materials.js';

const WALK = 115; // px/s : vitesse de marche du joueur, pour l'animation
const TELEPORT = TILE * 8; // écart trop grand (entrée dans la zone, « Y aller » lointain) : il apparaît directement

export class RemotePlayers {
  constructor(world) {
    this.world = world;
    this.byId = new Map();
    this.interval = 2;
  }

  /** Liste reçue du serveur pour la zone courante ; zoneGroup : groupe 3D où les ajouter. */
  sync(players, intervalS) {
    this.interval = intervalS;
    const seen = new Set();
    for (const p of players) {
      seen.add(p.id);
      let r = this.byId.get(p.id);
      const key = JSON.stringify([p.appearance, p.name, p.friend]);
      if (r && r.key !== key) { this.remove(p.id); r = null; }
      if (!r) r = this.add(p, key);
      r.target = { x: p.x, y: p.y };
      const gap = Math.hypot(p.x - r.body.x, p.y - r.body.y);
      if (gap > TELEPORT) { r.body.x = p.x; r.body.y = p.y; r.speed = 0; } else r.speed = followSpeed(r.body, r.target, intervalS);
      r.info = p;
    }
    for (const id of [...this.byId.keys()]) if (!seen.has(id)) this.remove(id);
  }

  add(p, key) {
    const model = buildCharacter({ ...p.appearance, pants: '#2c3e50' });
    const label = textSprite(`${p.friend ? '★ ' : ''}${p.name}`, { size: 24, bg: p.friend ? '#2e7d4f' : '#1f4e79' });
    label.position.y = 1.45;
    model.add(label);
    this.world.zoneGroup.add(model);
    const r = { id: p.id, key, model, label, body: { x: p.x, y: p.y }, target: { x: p.x, y: p.y }, speed: 0, info: p };
    this.byId.set(p.id, r);
    this.place(r);
    return r;
  }

  remove(id) {
    const r = this.byId.get(id);
    if (!r) return;
    r.model.removeFromParent();
    disposeGroup(r.model);
    this.byId.delete(id);
  }

  clear() { for (const id of [...this.byId.keys()]) this.remove(id); }

  place(r) { r.model.position.set(r.body.x / TILE, 0, r.body.y / TILE); }

  update(dt, showNames = true) {
    for (const r of this.byId.values()) {
      const dx = r.target.x - r.body.x;
      const dy = r.target.y - r.body.y;
      const d = Math.hypot(dx, dy);
      let moving = 0;
      if (d > 1) {
        const step = Math.min(d, Math.max(r.speed, 20) * dt);
        r.body.x += (dx / d) * step;
        r.body.y += (dy / d) * step;
        faceTowards(r.model, dx, dy, dt);
        moving = step / Math.max(dt, 1e-3) / WALK;
      }
      animateCharacter(r.model, dt, moving);
      r.label.visible = showNames;
      this.place(r);
    }
  }

  /** Joueurs tels qu'affichés (position interpolée), pour la barre de proximité. */
  list() { return [...this.byId.values()].map((r) => ({ ...r.info, x: r.body.x, y: r.body.y })); }
}
