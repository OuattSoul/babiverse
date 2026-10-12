// Barre du haut, visible dès l'écran de connexion : fréquentation (gauche), identité du jeu (centre),
// compte (droite). Les compteurs viennent du serveur (`GET /api/presence`) ; rien n'est simulé.
import { api } from '../net/api.js';
import { ui } from './ui.js';

const el = ui.el;
const $ = (sel) => document.querySelector(sel);
const PRESENCE_MS = 45000; // même rythme que le battement de cœur

export const topbar = {
  init() {
    this.root = $('#topbar');
    this.root.hidden = false;
    this.refresh();
    setInterval(() => { if (document.visibilityState === 'visible') this.refresh(); }, PRESENCE_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refresh(); });
  },

  async refresh() {
    let data = null;
    try { data = await api.presence(); } catch { /* hors ligne : on affiche « — » */ }
    setCount('#stat-players', '#val-players', data?.players_online, 'Joueurs connectés');
    // Pas de mode visiteur : le serveur renvoie null, on n'invente pas de chiffre.
    setCount('#stat-visitors', '#val-visitors', data?.visitors, 'Visiteurs présents',
      'pas encore de comptage (le jeu se joue avec un compte)');
  },

  /** Pas de session : « Se connecter » et « S'inscrire ». mode = formulaire affiché ('login' | 'register'). */
  showGuest({ mode = null, onLogin, onRegister }) {
    // `short` : libellé de repli pour les très petits écrans (CSS).
    const btn = (id, label, short, cls, on, onclick) => el('button', {
      id, class: `tb-btn ${cls}${on ? ' on' : ''}`, 'aria-pressed': on ? 'true' : 'false', 'aria-label': label, onclick,
    }, el('span', { class: 'long' }, label), el('span', { class: 'short', 'aria-hidden': 'true' }, short));
    $('#tb-account').replaceChildren(
      btn('tb-login', 'Se connecter', 'Connexion', '', mode === 'login', onLogin),
      btn('tb-register', "S'inscrire", "S'inscrire", 'primary', mode === 'register', onRegister));
  },

  /** En jeu : pseudonyme du personnage ; ouvre « Mon compte » (réglages). */
  showPlayer({ name, username, onOpen }) {
    const tip = `Mon compte${username ? ` (${username})` : ''}`;
    $('#tb-account').replaceChildren(el('button', {
      class: 'tb-account', 'data-tip': tip, 'data-tip-pos': 'bottom-end', 'aria-label': tip, onclick: onOpen,
    },
    el('span', { class: 'tb-avatar', 'aria-hidden': 'true' }, (name || '?').charAt(0).toUpperCase()),
    el('strong', { id: 'hud-name' }, name)));
  },

  clearAccount() { $('#tb-account').replaceChildren(); },
};

function setCount(boxSel, valSel, value, label, unknown = 'indisponible') {
  const known = Number.isInteger(value);
  $(valSel).textContent = known ? value.toLocaleString('fr-FR') : '—';
  const text = known ? `${label} : ${value.toLocaleString('fr-FR')}` : `${label} : ${unknown}`;
  const box = $(boxSel);
  box.classList.toggle('unknown', !known);
  box.dataset.tip = text;
  box.setAttribute('aria-label', text);
}
