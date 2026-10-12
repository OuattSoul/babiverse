// Menu de navigation horizontal, toujours visible en jeu : Chez moi, Ville, Opportunités, Mon profil.
// L'élément actif suit la vue courante (zone) ou le panneau ouvert depuis le menu.
import { bus } from '../state/store.js';

const PANELS = new Set(['opportunities', 'profile']);

export const nav = {
  view: null, // 'home' | 'city' : déduit de la zone chargée
  panel: null, // 'opportunities' | 'profile' : panneau ouvert depuis le menu

  /** handlers : { home, city, opportunities, profile } appelés au clic. */
  init(handlers) {
    this.root = document.getElementById('main-nav');
    for (const btn of this.root.querySelectorAll('button[data-nav]')) {
      btn.addEventListener('click', () => {
        // Rend le focus au jeu : Espace / Entrée servent à interagir, pas à recliquer le bouton.
        btn.blur();
        handlers[btn.dataset.nav]?.();
      });
    }
    bus.on('zone', (zone) => { this.view = zone === 'maison' ? 'home' : 'city'; this.render(); });
    bus.on('sheet-opened', (kind) => { this.panel = PANELS.has(kind) ? kind : null; this.render(); });
    bus.on('sheet-closed', () => { this.panel = null; this.render(); });
  },

  show() { this.root.hidden = false; this.render(); },

  render() {
    const active = this.panel || this.view;
    for (const btn of this.root.querySelectorAll('button[data-nav]')) {
      const on = btn.dataset.nav === active;
      btn.classList.toggle('active', on);
      if (on) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  },
};
