// État client : dernier instantané reçu du serveur + prédictions locales pour l'affichage.
import { predictNeeds } from '../sim/needs.js';

class Bus {
  constructor() { this.handlers = {}; }
  on(evt, fn) { (this.handlers[evt] ||= new Set()).add(fn); return () => this.handlers[evt].delete(fn); }
  emit(evt, payload) { for (const fn of this.handlers[evt] || []) fn(payload); }
}
export const bus = new Bus();

export const store = {
  config: null,
  state: null,
  receivedAt: 0,
  serverOffsetMs: 0,
  // Position courante dans le monde (écrite par la scène, lue pour les sauvegardes).
  pos: { zone: null, x: 0, y: 0 },
  // Interface ouverte : la scène gèle les déplacements.
  modalOpen: false,

  /** Applique un instantané serveur, en ignorant une réponse plus ancienne que l'état connu. */
  apply(snapshot) {
    if (!snapshot) return;
    if (this.state && snapshot.version < this.state.version) return;
    const prev = this.state;
    this.state = snapshot;
    this.receivedAt = performance.now();
    this.serverOffsetMs = Date.parse(snapshot.server_time) - Date.now();
    bus.emit('state', { state: snapshot, prev });
    for (const notice of snapshot.notices || []) bus.emit('notice', notice);
  },

  serverNow() {
    return new Date(Date.now() + this.serverOffsetMs);
  },

  needs() {
    const c = this.state.character;
    const elapsed = (performance.now() - this.receivedAt) / 1000;
    return predictNeeds({ hunger: c.hunger, energy: c.energy }, elapsed, this.config.needs);
  },

  mission(id) {
    return this.state?.missions.find((m) => m.id === id);
  },
};
