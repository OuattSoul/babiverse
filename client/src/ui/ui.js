// Interface DOM superposée au monde : HUD, invite d'interaction, notifications, panneaux.
// Les panneaux restent secondaires : ils s'ouvrent depuis une interaction dans le monde
// (ou les boutons Sac / Journal) et gèlent le personnage tant qu'ils sont ouverts.
import { createPreview } from '../engine3d/preview.js';
import { bus, store } from '../state/store.js';
import { AD_SLOTS, PLOTS } from '../world/city.js';
import { slotView } from '../world/interactionTypes.js';
import { NPCS } from '../world/npcs.js';
import { PLOT_CONDITIONS } from '../world/plots.js';

const $ = (sel) => document.querySelector(sel);
const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const STATUS_LABEL = { available: 'Disponible', active: 'En cours', completed: 'Terminée', rewarded: 'Récompensée' };
const MISSION_GROUPS = [['completed', 'Récompenses à réclamer'], ['active', 'En cours'], ['available', 'Disponibles'], ['rewarded', 'Terminées']];

let rerender = null; // rafraîchit le panneau ouvert quand l'état change
let cleanup = null; // libère les ressources du panneau ouvert (aperçu 3D...)

export const ui = {
  el,

  init({ onOpenBag, onOpenJournal, onOpenSettings }) {
    $('#btn-bag').addEventListener('click', onOpenBag);
    $('#btn-journal').addEventListener('click', onOpenJournal);
    $('#btn-settings').addEventListener('click', onOpenSettings);
    $('#sheet-close').addEventListener('click', () => this.close());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && store.modalOpen) this.close(); });
    bus.on('state', () => { this.renderHud(); rerender?.(); });
    bus.on('network', (online) => {
      $('#net').classList.toggle('offline', !online);
      $('#net').title = online ? 'Connecté' : 'Hors ligne';
      if (!online) this.toast('Connexion perdue. Tu peux continuer à explorer ; les achats et gains attendront le retour du réseau.', 'error');
      else this.toast('Connexion rétablie.', 'info');
    });
    bus.on('notice', (n) => this.toast(n.message, n.type === 'passive_income' ? 'success' : 'info', 6000));
    setInterval(() => this.renderNeeds(), 1000);
  },

  show() { $('#hud').hidden = false; $('#sidebar').hidden = false; this.renderHud(); },

  renderHud() {
    const s = store.state;
    if (!s) return;
    $('#hud-money').textContent = fmt(s.character.balance);
    this.renderNeeds();
    this.renderTracker();
    this.renderMissionCount();
  },

  /** Jauges circulaires du panneau latéral : repas (inverse de la faim) et énergie, état « bas » aux seuils de travail. */
  renderNeeds() {
    if (!store.state) return;
    const cfg = store.config.needs;
    const { hunger, energy } = store.needs();
    const pct = (v) => Math.round(((v - cfg.min) / (cfg.max - cfg.min)) * 100);
    const food = 100 - pct(hunger);
    setGauge('#gauge-food', food, hunger >= cfg.work_max_hunger,
      `Repas : ${food} %`, 'trop faim pour travailler, mange quelque chose');
    setGauge('#gauge-energy', pct(energy), energy < cfg.work_min_energy,
      `Énergie : ${pct(energy)} %`, "pas assez d'énergie pour travailler, fais une sieste chez toi");
    const now = store.serverNow();
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const mm = String(now.getUTCMinutes()).padStart(2, '0');
    $('#hud-clock').textContent = `${hh}:${mm}`;
  },

  renderTracker() {
    const s = store.state;
    const tracker = $('#tracker');
    const shift = s.job.active;
    let text = null;
    if (shift) {
      const left = shift.targets.length - shift.delivered.length;
      text = left > 0 ? `📦 Livraisons : ${shift.delivered.length}/${shift.targets.length} — suis les flèches jaunes`
        : '📦 Colis livrés — retourne voir M. Diabaté';
    } else {
      const completed = s.missions.find((m) => m.status === 'completed');
      const active = s.missions.find((m) => m.status === 'active');
      const def = (m) => store.config.missions.find((d) => d.id === m.id);
      if (completed) text = `✅ ${def(completed).title} — réclame ta récompense (📜)`;
      else if (active) {
        const d = def(active);
        text = `🎯 ${d.title}${d.target > 1 ? ` (${Math.min(active.progress, d.target).toLocaleString('fr-FR')}/${d.target.toLocaleString('fr-FR')})` : ''}`;
      } else if (s.missions.some((m) => m.status === 'available')) text = '📜 Nouvelles missions disponibles';
    }
    tracker.hidden = !text;
    tracker.textContent = text || '';
    tracker.title = text || '';
  },

  /** Badge du bouton Missions : missions à accepter ou récompenses à réclamer (le « ! » des PNJ). */
  renderMissionCount() {
    const n = store.state.missions.filter((m) => m.status === 'available' || m.status === 'completed').length;
    const badge = $('#missions-count');
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    const label = n ? `Missions : ${n} à voir` : 'Missions';
    const btn = $('#btn-journal');
    btn.dataset.tip = label;
    btn.setAttribute('aria-label', label);
  },

  /** Invite contextuelle : { label, enabled, reason } ou null. */
  setPrompt(action) {
    const prompt = $('#prompt');
    const btn = $('#action-btn');
    if (!action || store.modalOpen) {
      prompt.hidden = true;
      btn.hidden = true;
      return;
    }
    prompt.hidden = false;
    btn.hidden = false;
    const disabled = action.enabled === false;
    $('#prompt-label').textContent = disabled ? `${action.label} — ${action.reason}` : action.label;
    prompt.classList.toggle('disabled', disabled);
    btn.classList.toggle('disabled', disabled);
  },

  toast(message, kind = 'info', ms = 3500) {
    const node = el('div', { class: `toast ${kind}`, role: 'status' }, message);
    $('#toasts').append(node);
    while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
    setTimeout(() => node.classList.add('hide'), ms);
    setTimeout(() => node.remove(), ms + 400);
  },

  // --- Fenêtre (centrée à l'écran) --------------------------------------------
  /** kind : nature de la fenêtre ouverte ('selection' pour la fiche d'un objet du monde). */
  kind: null,

  open(title, subtitle, render, kind = 'panel', { onClose } = {}) {
    const body = $('#sheet-body');
    cleanup?.();
    cleanup = onClose || null;
    this.kind = kind;
    $('#sheet-title').textContent = title;
    $('#sheet-subtitle').textContent = subtitle || '';
    rerender = () => { body.replaceChildren(...[render()].flat()); };
    rerender();
    body.scrollTop = 0;
    $('#sheet').hidden = false;
    $('#sheet-backdrop').hidden = false;
    store.modalOpen = true;
    this.setPrompt(null);
    bus.emit('sheet-opened', kind);
  },

  /** Redessine la fenêtre ouverte (données reçues hors de l'état du jeu : notifications, messages). */
  refresh() { rerender?.(); },

  close() {
    const wasOpen = store.modalOpen;
    $('#sheet').hidden = true;
    $('#sheet-backdrop').hidden = true;
    rerender = null;
    cleanup?.();
    cleanup = null;
    store.modalOpen = false;
    this.kind = null;
    if (wasOpen) bus.emit('sheet-closed');
  },

  /**
   * Fiche de l'objet sélectionné dans le monde. `describe()` est rappelée à chaque changement d'état
   * (solde, achat...) ; null = l'objet a disparu. near(source) : le joueur est-il à portée de
   * l'élément ? approach(action) : y aller sur demande explicite, puis agir.
   */
  selection({ describe, near, approach, onOpenLink }) {
    this.open('', '', () => {
      const d = describe();
      if (!d) { setTimeout(() => this.close()); return []; }
      $('#sheet-title').textContent = d.title;
      $('#sheet-subtitle').textContent = d.subtitle || '';
      const close = () => this.close();
      return d.view === 'ad' ? adBody(d, onOpenLink, close) : selectionBody(d, near, approach, close);
    }, 'selection');
  },

  dialog({ title, subtitle, lines = [], buttons = [] }) {
    this.open(title, subtitle, () => [
      ...lines.map((l) => el('p', { class: 'line' }, `« ${l} »`)),
      el('div', { class: 'buttons' },
        ...buttons.map((b) => el('button', { class: b.primary ? 'primary' : '', disabled: b.disabled, onclick: b.onClick }, b.label)),
        el('button', { class: 'ghost', onclick: () => this.close() }, 'Au revoir')),
    ]);
  },

  confirm({ title, text, confirmLabel, onConfirm }) {
    this.open(title, '', () => [
      el('p', {}, text),
      el('div', { class: 'buttons' },
        el('button', { class: 'primary', onclick: onConfirm }, confirmLabel),
        el('button', { class: 'ghost', onclick: () => this.close() }, 'Annuler')),
    ]);
  },

  shop(shopId, onBuy) {
    const shop = store.config.shops[shopId];
    const qty = {};
    this.open(shop.name, 'Prix en francs CFA virtuels', () => {
      const balance = store.state.character.balance;
      const stock = store.state.shops[shopId];
      const rows = Object.entries(shop.items).map(([itemId, offer]) => {
        const item = store.config.items[itemId];
        const q = qty[itemId] || 1;
        const total = offer.price * q;
        const left = stock[itemId];
        const effects = Object.entries(item.effects).map(([k, v]) => `${k === 'hunger' ? 'faim' : 'énergie'} ${v > 0 ? '+' : ''}${v}`).join(' · ');
        const step = (d) => () => { qty[itemId] = Math.max(1, Math.min(20, q + d)); rerender(); };
        return el('div', { class: 'row', 'data-item': itemId },
          el('div', { class: 'grow' },
            el('strong', {}, item.name),
            el('small', {}, `${fmt(offer.price)} · stock ${left}${effects ? ` · ${effects}` : ''}${item.category === 'stock' ? ' · pour ton kiosque' : ''}`)),
          el('div', { class: 'stepper' },
            el('button', { onclick: step(-1), 'aria-label': 'moins' }, '−'),
            el('span', {}, q),
            el('button', { onclick: step(1), 'aria-label': 'plus' }, '+')),
          el('button', {
            class: total > balance ? 'buy warn' : 'buy primary', disabled: left < q,
            onclick: async () => { await onBuy(itemId, q); qty[itemId] = 1; },
          }, left < q ? 'Épuisé' : `Acheter ${fmt(total)}`));
      });
      return [el('p', { class: 'balance' }, `Ton solde : `, el('strong', { id: 'shop-balance' }, fmt(balance))), ...rows];
    });
  },

  inventory(onConsume) {
    this.open('Mon sac', '', () => {
      const inv = store.state.inventory;
      const entries = Object.entries(inv);
      if (!entries.length) return el('p', { class: 'muted' }, 'Ton sac est vide.');
      return entries.map(([itemId, q]) => {
        const item = store.config.items[itemId];
        const edible = Object.keys(item.effects).length > 0;
        return el('div', { class: 'row', 'data-item': itemId },
          el('div', { class: 'grow' }, el('strong', {}, `${item.name} × ${q}`),
            el('small', {}, item.category === 'stock' ? 'À déposer dans ton kiosque' : item.category === 'food' ? 'Nourriture' : 'Objet personnel')),
          edible ? el('button', { class: 'primary', onclick: () => onConsume(itemId) }, 'Consommer') : null);
      });
    });
  },

  /** Missions regroupées : récompenses à réclamer, en cours, disponibles, terminées. */
  journal({ onAccept, onClaim }) {
    const row = (m) => {
      const def = store.config.missions.find((d) => d.id === m.id);
      const progress = def.target > 1 ? ` (${Math.min(m.progress, def.target).toLocaleString('fr-FR')}/${def.target.toLocaleString('fr-FR')})` : '';
      return el('div', { class: `row mission ${m.status}`, 'data-mission': m.id },
        el('div', { class: 'grow' },
          el('strong', {}, def.title),
          el('small', {}, `${def.description}${progress} · Récompense ${fmt(def.reward)}`),
          el('span', { class: `badge ${m.status}` }, STATUS_LABEL[m.status])),
        m.status === 'available' ? el('button', { onclick: () => onAccept(m.id) }, 'Accepter') : null,
        m.status === 'completed' ? el('button', { class: 'primary', onclick: () => onClaim(m.id) }, 'Réclamer') : null);
    };
    this.open('Journal des missions', '', () => {
      const list = store.state.missions;
      if (!list.length) return el('p', { class: 'muted' }, 'Aucune mission pour le moment.');
      return MISSION_GROUPS.flatMap(([status, title]) => {
        const group = list.filter((m) => m.status === status);
        return group.length ? [el('h3', { class: 'group-title' }, `${title} (${group.length})`), ...group.map(row)] : [];
      });
    });
  },

  /** Choix du bâtiment à construire sur sa parcelle, avec le nom de l'enseigne. */
  buildPanel(plot, onBuild) {
    const name = el('input', { id: 'build-name', maxlength: 20, value: store.state.character.name, autocomplete: 'off' });
    this.open(`Construire sur la parcelle ${plot}`, 'Le chantier est terminé immédiatement', () => [
      el('label', { for: 'build-name', class: 'muted' }, 'Nom affiché'), name,
      ...Object.entries(store.config.player_buildings).map(([id, t]) => {
        const enough = store.state.character.balance >= t.cost;
        return el('div', { class: 'row', 'data-template': id },
          el('div', { class: 'grow' }, el('strong', {}, t.name),
            el('small', {}, `${t.facade.length}×2 cases${t.sign ? ' · avec enseigne' : ''} · ${fmt(t.cost)}`)),
          el('button', { class: enough ? 'primary' : 'warn', onclick: () => onBuild(id, name.value.trim()) }, `Construire ${fmt(t.cost)}`));
      }),
    ]);
  },

  business({ onRestock, onToggleServing, serving }) {
    this.open('Mon kiosque à boissons', 'Emplacement près de la route', () => {
      const b = store.state.business;
      const crates = store.state.inventory.casier_boissons || 0;
      return [
        el('div', { class: 'stats' },
          stat('Stock', `${b.stock}/${b.max_stock}`), stat('Prix de vente', fmt(b.sale_price)),
          stat('Ventes', b.units_sold), stat('Recettes', fmt(b.revenue)),
          stat('Dépenses', fmt(b.spent)), stat('Bénéfice', fmt(b.profit), b.profit >= 0 ? 'pos' : 'neg')),
        el('p', { class: 'muted' }, `Un casier (12 boissons) coûte ${fmt(store.config.shops.epicerie.items.casier_boissons.price)} à l'épicerie. Chaque boisson se vend ${fmt(b.sale_price)}.`),
        el('div', { class: 'buttons' },
          el('button', { class: 'primary', disabled: crates < 1, onclick: () => onRestock(1) },
            crates ? `Déposer 1 casier (${crates} dans le sac)` : 'Aucun casier dans ton sac'),
          el('button', { class: serving() ? '' : 'primary', onclick: onToggleServing },
            serving() ? 'Arrêter de servir' : 'Tenir le kiosque (servir les clients)')),
      ];
    });
  },

  /**
   * Opportunités : uniquement ce que le jeu permet déjà (missions, livraisons, kiosque, parcelles,
   * publicité), avec conditions et récompenses tirées de la configuration et de l'état serveur.
   * onLocate(ids) : montre l'objet dans la ville et ouvre sa fiche.
   */
  opportunities({ onAccept, onClaim, onLocate }) {
    this.open('Opportunités', 'Ce que tu peux entreprendre dans le quartier', () => opportunityCards({ onAccept, onClaim, onLocate }), 'opportunities');
  },

  /** Profil du joueur : avatar 3D, identité, solde et progression (données existantes uniquement). */
  profile({ onEditLook } = {}) {
    const canvas = el('canvas', { class: 'preview profile-avatar', width: 96, height: 120, 'aria-label': 'Mon avatar' });
    let preview = null;
    this.open('Mon profil', '', () => profileBody(canvas, onEditLook), 'profile', { onClose: () => preview?.dispose() });
    preview = createPreview(canvas);
    preview.setLook({ ...store.state.character.appearance, pants: '#2c3e50' });
  },
};

// --- Opportunités ----------------------------------------------------------------------

function opportunityCard({ icon, title, text, status, statusClass = '', facts = [], buttons = [] }) {
  return el('article', { class: 'opp-card' },
    el('div', { class: 'opp-head' },
      el('span', { class: 'opp-icon', 'aria-hidden': 'true' }, icon),
      el('div', { class: 'grow' }, el('strong', {}, title), text ? el('small', {}, text) : null),
      status ? el('span', { class: `badge ${statusClass}` }, status) : null),
    facts.length ? el('dl', { class: 'facts' }, ...facts.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null,
    buttons.length ? el('div', { class: 'opp-actions' }, ...buttons) : null);
}

function opportunityCards({ onAccept, onClaim, onLocate }) {
  const s = store.state;
  const cfg = store.config;
  const balance = s.character.balance;
  const locate = (label, ids) => el('button', { onclick: () => onLocate(ids) }, label);
  const cards = [];

  // Missions en cours ou disponibles.
  for (const m of s.missions.filter((x) => x.status !== 'rewarded').sort((a, b) => order(a) - order(b))) {
    const def = cfg.missions.find((d) => d.id === m.id);
    const giver = def.giver ? NPCS[def.giver] : null;
    const progress = def.target > 1 ? ` (${Math.min(m.progress, def.target).toLocaleString('fr-FR')}/${def.target.toLocaleString('fr-FR')})` : '';
    const buttons = [];
    if (m.status === 'completed') buttons.push(el('button', { class: 'primary', onclick: () => onClaim(m.id) }, `Réclamer ${fmt(def.reward)}`));
    if (m.status === 'available') buttons.push(el('button', { class: 'primary', onclick: () => onAccept(m.id) }, 'Accepter'));
    if (giver && m.status !== 'completed') buttons.push(locate(`Voir ${giver.name}`, [def.giver]));
    cards.push(opportunityCard({
      icon: '📜', title: def.title, text: `${def.description}${progress}`,
      status: STATUS_LABEL[m.status], statusClass: m.status,
      facts: [['Proposée par', giver ? giver.name : 'Le quartier'], ['Récompense', fmt(def.reward)]],
      buttons,
    }));
  }

  // Travail : livraisons pour M. Diabaté.
  const job = s.job;
  const full = job.shifts_today >= job.max_shifts_per_day;
  cards.push(opportunityCard({
    icon: '📦', title: 'Livraisons pour M. Diabaté',
    text: 'Livre des colis dans le quartier, puis retourne au dépôt pour être payé.',
    status: job.active ? 'En cours' : full ? "Complet aujourd'hui" : 'Disponible',
    statusClass: job.active ? 'active' : full ? '' : 'completed',
    facts: [
      ['Conditions', `Faim au plus ${cfg.needs.work_max_hunger}, énergie au moins ${cfg.needs.work_min_energy}`],
      ["Aujourd'hui", `${job.shifts_today}/${job.max_shifts_per_day} services`],
      ['Récompense', `${fmt(job.wage)} par service`],
    ],
    buttons: [locate('Voir M. Diabaté', ['diabate'])],
  }));

  // Entreprise : kiosque à boissons.
  const biz = s.business;
  const bizReady = biz.unlocked && balance >= biz.cost;
  cards.push(biz.open
    ? opportunityCard({
      icon: '🥤', title: 'Mon kiosque à boissons', text: "Remplis ton stock à l'épicerie et sers les clients.",
      status: 'Ouvert', statusClass: 'completed',
      facts: [['Stock', `${biz.stock}/${biz.max_stock}`], ['Ventes', String(biz.units_sold)], ['Bénéfice', fmt(biz.profit)]],
      buttons: [locate('Voir mon kiosque', ['kiosk'])],
    })
    : opportunityCard({
      icon: '🥤', title: 'Ouvrir un kiosque à boissons',
      text: "Sur l'emplacement libre près de la route. Le voisinage achète aussi un peu en ton absence.",
      status: !biz.unlocked ? 'Verrouillé' : bizReady ? 'Accessible' : 'Fonds insuffisants',
      statusClass: bizReady ? 'completed' : '',
      facts: [
        ['Conditions', biz.unlocked ? 'Débloqué' : "Terminer d'abord un service de livraison (M. Diabaté)"],
        ['Coût', fmt(biz.cost)],
        ['Récompense', 'Recette de chaque boisson vendue'],
      ],
      buttons: [locate("Voir l'emplacement", ['kiosk'])],
    }));

  // Ma maison : attribuée et construite par le serveur à mon arrivée.
  const home = (s.world?.residential?.homes || []).find((h) => h.mine);
  if (home) {
    cards.push(opportunityCard({
      icon: '🏠', title: 'Ma maison', text: `Lot ${home.slot + 1} du lotissement, offerte à ton arrivée dans le quartier.`,
      status: 'Construite', statusClass: 'completed', facts: [],
      buttons: [locate('Voir ma maison', [`bld_home_${home.slot}`])],
    }));
  }

  // Immobilier : parcelles.
  const claims = s.world?.plots || {};
  const mine = Object.entries(claims).find(([, p]) => p.mine);
  if (mine) {
    const [id, p] = mine;
    cards.push(opportunityCard({
      icon: '🏗️', title: `Ma parcelle ${id}`,
      text: p.building ? `Bâtiment construit : ${p.building.name}` : 'Construis-y une maisonnette ou une boutique.',
      status: p.building ? 'Construite' : 'À construire', statusClass: p.building ? 'completed' : 'active',
      facts: p.building ? [] : [['Coût', Object.values(cfg.player_buildings).map((t) => `${t.name} ${fmt(t.cost)}`).join(' · ')]],
      buttons: [locate('Voir ma parcelle', [`bld_pb_${id}`, `plot_${id}`])],
    }));
  } else {
    const free = PLOTS.filter((p) => p.status !== 'unavailable' && !claims[p.id]);
    const affordable = balance >= cfg.plot_price;
    cards.push(opportunityCard({
      icon: '🏗️', title: 'Acheter une parcelle',
      text: free.length ? `${free.length} parcelle${free.length > 1 ? 's' : ''} libre${free.length > 1 ? 's' : ''} dans le quartier.` : 'Aucune parcelle libre pour le moment.',
      status: !free.length ? 'Indisponible' : affordable ? 'Accessible' : 'Fonds insuffisants',
      statusClass: free.length && affordable ? 'completed' : '',
      facts: [['Conditions', PLOT_CONDITIONS[0]], ['Prix', fmt(cfg.plot_price)], ['Récompense', 'Un terrain pour construire ta maisonnette ou ta boutique']],
      buttons: free.length ? [locate('Voir une parcelle libre', [`plot_${free[0].id}`])] : [],
    }));
  }

  // Publicité : location d'un panneau (réservée aux joueurs qui ont un kiosque).
  const freeSlots = AD_SLOTS.filter((a) => slotView(a.id, store).status === 'free');
  const ad = cfg.ad_rental;
  cards.push(opportunityCard({
    icon: '📣', title: 'Louer un panneau publicitaire',
    text: "Tout le quartier voit la publicité de ton kiosque, qui t'amène des clients.",
    status: !freeSlots.length ? 'Tous loués' : biz.open ? 'Accessible' : 'Verrouillé',
    statusClass: freeSlots.length && biz.open ? 'completed' : '',
    facts: [['Conditions', 'Avoir ouvert ton kiosque'], ['Prix', `${fmt(ad.price)} pour ${ad.duration_hours / 24} jours`], ['Panneaux libres', String(freeSlots.length)]],
    buttons: freeSlots.length ? [locate('Voir un panneau libre', [`ad_${freeSlots[0].id}`])] : [],
  }));

  return cards;
}

// --- Profil ---------------------------------------------------------------------------

function profileBody(avatar, onEditLook) {
  const s = store.state;
  const c = s.character;
  const profile = store.config.profiles[c.profile];
  const total = store.config.missions.length;
  const done = s.missions.filter((m) => m.status === 'rewarded').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const { hunger, energy } = store.needs();
  const plot = Object.entries(s.world?.plots || {}).find(([, p]) => p.mine);
  return [
    el('div', { class: 'profile-head' }, avatar,
      el('div', { class: 'grow' },
        el('strong', { class: 'profile-name' }, c.name),
        el('span', { class: 'badge' }, profile.label),
        profile.description ? el('small', {}, profile.description) : null,
        onEditLook ? el('button', { class: 'chip', type: 'button', id: 'btn-edit-look', onclick: onEditLook }, '👕 Changer d\'apparence') : null)),
    el('div', { class: 'profile-balance' }, el('small', {}, 'Solde virtuel'), el('strong', {}, fmt(c.balance))),
    el('div', { class: 'progress', role: 'group', 'aria-label': 'Progression' },
      el('div', { class: 'progress-label' }, el('span', {}, 'Progression'), el('b', {}, `${done}/${total} missions`)),
      el('div', { class: 'bar light' }, el('div', { class: 'fill energy', style: `width:${pct}%` }))),
    el('div', { class: 'stats' },
      stat('Livraisons', String(s.job.completed_total)),
      stat('Kiosque', s.business.open ? `${s.business.units_sold} ventes` : 'Fermé'),
      stat('Parcelle', plot ? plot[0] : '—'),
      stat('Faim', String(Math.round(hunger))),
      stat('Énergie', String(Math.round(energy))),
      stat('Objets', String(Object.values(s.inventory).reduce((n, q) => n + q, 0)))),
  ];
}

function selectionBody(d, near, approach, close) {
  const out = [];
  if (d.badge && d.badge !== d.subtitle) out.push(el('span', { class: 'badge' }, d.badge));
  for (const line of d.lines) out.push(el('p', {}, line));
  if (d.facts.length) out.push(el('dl', { class: 'facts' }, ...d.facts.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])));
  const buttons = [];
  for (const a of d.actions) {
    const disabled = a.enabled === false;
    // Action de proximité hors de portée : on propose d'y aller, jamais de déplacement implicite.
    const far = !a.remote && !near(a.source);
    buttons.push(el('button', {
      class: disabled ? '' : 'primary', disabled, 'data-action': a.id, 'data-approach': far ? '1' : null,
      onclick: () => {
        close();
        if (far) approach(a);
        else a.run();
      },
    }, far ? `Y aller : ${a.label}` : a.label));
    if (disabled && a.reason) buttons.push(el('small', { class: 'reason' }, a.reason));
  }
  buttons.push(el('button', { class: 'ghost', id: 'selection-close', onclick: close }, 'Fermer'));
  out.push(el('div', { class: 'buttons' }, ...buttons));
  return out;
}

/** Fiche d'une publicité : visuel complet dans ses proportions, description, lien externe validé. */
function adBody(d, onOpenLink, close) {
  const ad = d.ad;
  let visual;
  if (ad.image) visual = el('img', { class: 'ad-image', src: ad.image, alt: `Visuel publicitaire : ${ad.title}`, decoding: 'async' });
  else {
    // Campagne d'un joueur : pas d'image fournie, le visuel est composé à partir de ses couleurs.
    visual = el('div', { class: 'ad-image ad-generated' }, el('strong', {}, ad.title), el('small', {}, ad.description));
    visual.style.background = ad.bg;
    visual.style.color = ad.fg;
  }
  return [
    el('div', { class: 'ad-label' }, el('span', { class: 'badge ad' }, 'Publicité'), ad.advertiser ? el('small', {}, ad.advertiser) : null),
    el('figure', { class: 'ad-figure' }, visual),
    ad.description && ad.image ? el('p', { class: 'ad-description' }, ad.description) : null,
    el('div', { class: 'buttons' },
      ad.link
        ? el('button', { class: 'primary', id: 'ad-more', onclick: () => onOpenLink(ad) }, 'En savoir plus ↗')
        : el('p', { class: 'muted' }, 'Aucun lien externe pour cette annonce.'),
      ad.link ? el('small', { class: 'muted' }, `Ouvre ${new URL(ad.link).hostname} dans un nouvel onglet.`) : null,
      el('button', { class: 'ghost', id: 'ad-close', onclick: close }, 'Fermer et revenir au jeu')),
  ];
}

/** Jauge circulaire : remplissage en %, état « bas » distinct (couleur + pulsation), infobulle à jour. */
function setGauge(sel, pct, low, label, lowHint) {
  const gauge = $(sel);
  const value = Math.max(0, Math.min(100, pct));
  gauge.querySelector('.ring').style.strokeDashoffset = String(100 - value);
  gauge.classList.toggle('low', low);
  const text = low ? `${label} — ${lowHint}` : label;
  if (gauge.dataset.tip !== text) {
    gauge.dataset.tip = text;
    gauge.setAttribute('aria-label', text);
  }
}

function stat(label, value, cls = '') {
  return el('div', { class: `stat ${cls}` }, el('small', {}, label), el('strong', {}, value));
}

function order(m) {
  return { completed: 0, active: 1, available: 2, rewarded: 3 }[m.status];
}
