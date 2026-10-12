// Point d'entrée : identité, chargement de l'état, création du personnage, démarrage du monde.
import './style.css';
import { World3D } from './engine3d/World3D.js';
import { initControls, touchInput } from './engine3d/input.js';
import { actions } from './game/actions.js';
import { applyPack } from './atelier/pack.js';
import { social } from './social/social.js';
import { api, auth } from './net/api.js';
import { bus, store } from './state/store.js';
import {
  appearancePanel, authScreen, creationScreen, errorScreen, hideScreen, loadingScreen, resetPasswordScreen, secureAccountScreen,
  sessionLostScreen, settingsPanel, verifyEmailScreen,
} from './ui/screens.js';
import { nav } from './ui/nav.js';
import { initTips } from './ui/tips.js';
import { topbar } from './ui/topbar.js';
import { ui } from './ui/ui.js';

const HEARTBEAT_MS = 45000;
let account = null;

async function boot() {
  loadingScreen();
  topbar.clearAccount();
  try {
    store.config = await api.config();
    // Contenu de l'atelier (garde-robe, habitants, maison) : facultatif, le jeu garde le sien sans lui.
    applyPack(await api.atelierPack().then((r) => r.pack).catch(() => null));
    // Liens reçus par e-mail : https://…/#reset=<jeton> ou #verify=<jeton> (le fragment n'est jamais envoyé
    // au serveur web) ; on l'efface aussitôt de la barre d'adresse.
    // #inscription : « S'inscrire » choisi dans la barre du haut après une session perdue.
    const link = new URLSearchParams(location.hash.slice(1));
    if (link.has('reset') || link.has('verify') || link.has('inscription')) history.replaceState(null, '', location.pathname + location.search);
    if (link.get('reset')) await resetPasswordScreen(link.get('reset'));
    if (link.get('verify')) await verifyEmailScreen(link.get('verify'));
    if (!auth.token) {
      await authScreen(link.has('inscription') ? 'register' : 'login', {
        onShow: (mode, show) => topbar.showGuest({ mode, onLogin: () => show('login'), onRegister: () => show('register') }),
      });
      topbar.clearAccount();
    }
    // Ancien compte invité (avant les identifiants) : il doit choisir nom d'utilisateur et mot de passe.
    account = (await api.account()).account;
    if (!account.registered) account = await secureAccountScreen();
    let state = (await api.state()).state;
    if (!state) state = await creationScreen();
    store.apply(state);
  } catch (err) {
    if (err.status === 401) return sessionLost();
    return errorScreen(`Impossible de joindre le serveur (${err.message}). Vérifie ta connexion.`, boot);
  }
  hideScreen();
  startGame();
  // Sans adresse confirmée, un mot de passe oublié fait perdre le compte : on le rappelle à chaque lancement.
  if (!account.email) {
    ui.toast(account.pending_email
      ? 'Confirme ton adresse e-mail (lien reçu par e-mail) pour pouvoir récupérer ton compte.'
      : 'Ajoute une adresse e-mail dans ⚙️ Réglages → Mon compte pour pouvoir récupérer ton compte.', 'info', 8000);
  }
}

/** Session perdue : écran de reconnexion, et la barre du haut repasse en « Se connecter / S'inscrire ». */
function sessionLost() {
  sessionLostScreen();
  topbar.showGuest({
    onLogin: () => location.reload(),
    onRegister: () => { location.hash = 'inscription'; location.reload(); },
  });
}

function startGame() {
  topbar.showPlayer({ name: store.state.character.name, username: account.username, onOpen: () => settingsPanel() });
  ui.init({
    onOpenBag: () => ui.inventory((item) => actions.consume(item)),
    onOpenJournal: () => ui.journal({ onAccept: (id) => actions.acceptMission(id), onClaim: (id) => actions.claimMission(id) }),
    onOpenSettings: () => settingsPanel(),
  });
  ui.show();
  const c = store.state.character;
  const world = new World3D(document.getElementById('game'));
  // Menu de navigation : chaque entrée ferme la fenêtre ouverte avant d'agir.
  nav.init({
    home: () => { ui.close(); world.goHome(); },
    city: () => { ui.close(); world.showCity(); },
    opportunities: () => ui.opportunities({
      onAccept: (id) => actions.acceptMission(id),
      onClaim: (id) => actions.claimMission(id),
      onLocate: (ids) => { ui.close(); world.locate(ids); },
    }),
    profile: () => ui.profile({ onEditLook: () => appearancePanel({ onSaved: () => world.refreshPlayerLook() }) }),
  });
  nav.show();
  world.loadZone(c.zone, { pos: c.x === null ? null : { x: c.x, y: c.y } });
  // Rencontres entre joueurs : position partagée, joueurs proches, demandes, discussions, appels.
  social.start(world);
  initControls({ onInteract: () => world.interact(), isModal: () => store.modalOpen });
  const rig = world.rig;
  document.getElementById('btn-recenter').addEventListener('click', () => rig.recenter());
  document.getElementById('btn-rot-left').addEventListener('click', () => rig.rotateBy(Math.PI / 4));
  document.getElementById('btn-rot-right').addEventListener('click', () => rig.rotateBy(-Math.PI / 4));
  document.getElementById('btn-zoom-in').addEventListener('click', () => rig.zoomBy(0.8));
  document.getElementById('btn-zoom-out').addEventListener('click', () => rig.zoomBy(1.25));
  document.getElementById('btn-compass').addEventListener('click', () => rig.resetNorth());

  // Battement de cœur : sauvegarde de la position et avancée des besoins côté serveur.
  const heartbeat = (opts) => {
    if (!store.pos.zone || !auth.token) return; // déconnecté : plus rien à sauvegarder
    api.sync({ ...store.pos }, opts).then((res) => store.apply(res.state)).catch(() => {});
  };
  setInterval(() => { if (document.visibilityState === 'visible') heartbeat(); }, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') heartbeat({ keepalive: true });
    else heartbeat(); // retour au jeu : ventes passives et état à jour
  });
  window.addEventListener('pagehide', () => heartbeat({ keepalive: true }));
  bus.on('auth-lost', sessionLost);

  // Accès de test automatisé (développement ou ?debug=1 uniquement).
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) {
    window.__babi = {
      world, store, actions, touchInput, rig, social,
      scene: () => world,
      fps: () => world.fps(),
      player: () => (world.player ? { zone: world.zoneId, x: world.player.body.x, y: world.player.body.y } : null),
      prompt: () => world.current?.action?.label || null,
      stand: (id) => world.standPoint(id),
      goTo: (x, y) => world.walkTo({ x, y }),
    };
  }
}

initTips();
topbar.init();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

boot();
