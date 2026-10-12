// Actions de jeu : relient le monde (scène), le serveur (API) et l'interface.
// Aucune conséquence économique n'est appliquée localement : seul l'état renvoyé
// par le serveur fait foi.
import { api, ApiError } from '../net/api.js';
import { bus, store } from '../state/store.js';
import { ui } from '../ui/ui.js';
import { NPCS } from '../world/npcs.js';
import { adTracking } from './adTracking.js';

const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;
let busy = false;

/** Exécute une action serveur avec position courante ; affiche le refus éventuel. */
async function perform(path, body = {}, { idempotent = true, quiet = false } = {}) {
  if (busy) return null;
  busy = true;
  try {
    const res = await api.action(path, { ...body, pos: { ...store.pos } }, idempotent);
    store.apply(res.state);
    return res.result || {};
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.body?.state) store.apply(err.body.state);
      if (!quiet) ui.toast(err.code === 'network' || err.code === 'server_unavailable'
        ? 'Connexion perdue : action non enregistrée. Réessaie.'
        : err.message, 'error');
      bus.emit('action-refused', { path, code: err.code });
      return null;
    }
    throw err;
  } finally {
    busy = false;
  }
}

const itemName = (id) => store.config.items[id]?.name || id;

function effectText(effects) {
  const parts = [];
  if (effects.hunger) parts.push(`faim ${effects.hunger > 0 ? '+' : ''}${effects.hunger}`);
  if (effects.energy) parts.push(`énergie ${effects.energy > 0 ? '+' : ''}${effects.energy}`);
  return parts.join(', ');
}

export const actions = {
  scene: null,

  enterDoor(target) {
    this.scene.transitionTo(target.zone, target.spawn);
  },

  /** Ouvre la fiche d'un élément (ou du bâtiment qui le porte), sans déplacer personnage ni caméra. */
  inspect(id) {
    this.scene?.selectByInteractable(id);
  },

  /** « En savoir plus » : seul un lien déjà validé (HTTPS) est ouvert, dans un nouvel onglet isolé. */
  openAdLink(ad, slot) {
    if (!ad.link) return;
    adTracking.track('click', { slot, ad: ad.id });
    window.open(ad.link, '_blank', 'noopener,noreferrer');
  },

  async rest() {
    const before = store.state.character.energy;
    await this.scene?.fadeAction(async () => {
      const res = await perform('rest');
      if (res) ui.toast(`Petite sieste : énergie ${Math.round(before)} → ${Math.round(store.state.character.energy)}`, 'success');
    });
  },

  async talk(npcId) {
    const npc = NPCS[npcId];
    // L'événement « discussion » alimente les missions ; pas de conséquence économique.
    // Hors du verrou `busy` pour ne pas bloquer l'achat qui suit souvent immédiatement.
    // Les habitants promeneurs venus de l'atelier (`local`) ne sont pas des PNJ du serveur : aucun événement.
    if (!npc.local) {
      api.action('npc/talk', { npc: npcId, pos: { ...store.pos } }, false)
        .then((res) => store.apply(res.state))
        .catch(() => {});
    }
    const buttons = [];
    for (const service of npc.services) {
      const [kind, id] = service.split(':');
      if (kind === 'shop') buttons.push({ label: 'Voir les produits', primary: true, onClick: () => this.openShop(id) });
      if (kind === 'job') buttons.push(...this.jobButtons(id));
    }
    buttons.push(...this.missionButtons(npcId));
    const lines = npc.lines;
    ui.dialog({
      title: npc.name, subtitle: npc.role,
      lines: [lines[Math.floor(Math.random() * lines.length)]],
      buttons,
    });
  },

  missionButtons(npcId) {
    const out = [];
    for (const m of store.state.missions) {
      const def = store.config.missions.find((d) => d.id === m.id);
      if (def.giver !== npcId) continue;
      if (m.status === 'available') {
        out.push({ label: `Mission : ${def.title}`, onClick: () => this.acceptMission(m.id) });
      } else if (m.status === 'completed') {
        out.push({ label: `Réclamer ${fmt(def.reward)} (${def.title})`, primary: true, onClick: () => this.claimMission(m.id) });
      }
    }
    return out;
  },

  // --- Commerce ---------------------------------------------------------------
  openShop(shopId) {
    ui.shop(shopId, (itemId, qty) => this.buy(shopId, itemId, qty));
  },

  async buy(shopId, itemId, quantity) {
    const before = store.state.character.balance;
    const res = await perform('shop/buy', { shop: shopId, item: itemId, quantity });
    if (res) ui.toast(`Acheté : ${quantity} × ${itemName(itemId)} (${fmt(before)} → ${fmt(store.state.character.balance)})`, 'success');
    return res;
  },

  async consume(itemId) {
    const res = await perform('items/consume', { item: itemId });
    if (res) ui.toast(`Tu consommes : ${itemName(itemId)} (${effectText(res.effects)})`, 'success');
    return res;
  },

  // --- Emploi -----------------------------------------------------------------
  jobButtons(jobId) {
    const job = store.state.job;
    if (job.active) {
      const left = job.active.targets.length - job.active.delivered.length;
      if (left > 0) return [{ label: `Livraisons en cours (${left} restante${left > 1 ? 's' : ''})`, disabled: true },
        { label: 'Abandonner le service', onClick: () => this.abandonJob() }];
      return [{ label: `Terminer et être payé (${fmt(job.wage)})`, primary: true, onClick: () => this.completeJob() }];
    }
    return [{
      label: `Commencer une livraison (${fmt(job.wage)})`, primary: true,
      disabled: job.shifts_today >= job.max_shifts_per_day,
      onClick: () => this.startJob(jobId),
    }];
  },

  async startJob(jobId) {
    const res = await perform('jobs/start', { job: jobId });
    if (res) {
      ui.close();
      ui.toast(`Service commencé : ${res.targets.length} colis à livrer. Suis les flèches jaunes !`, 'info');
    }
  },

  async deliver(target) {
    const res = await perform('jobs/deliver', { shift_id: store.state.job.active.shift_id, target }, { idempotent: false });
    if (res) {
      const job = store.state.job.active;
      const left = job.targets.length - job.delivered.length;
      ui.toast(left > 0 ? `Colis livré ! Encore ${left}.` : 'Tous les colis sont livrés. Retourne voir M. Diabaté.', 'success');
    }
  },

  async completeJob() {
    const res = await perform('jobs/complete', { shift_id: store.state.job.active.shift_id });
    if (res) {
      ui.close();
      ui.toast(`Service terminé : +${fmt(res.wage)}`, 'success');
    }
  },

  async abandonJob() {
    const res = await perform('jobs/abandon', { shift_id: store.state.job.active.shift_id });
    if (res) { ui.close(); ui.toast('Service abandonné, sans paiement.', 'info'); }
  },

  // --- Kiosque ----------------------------------------------------------------
  openBusiness() {
    const cost = store.state.business.cost;
    ui.confirm({
      title: 'Ouvrir un kiosque à boissons',
      text: `Coût de lancement : ${fmt(cost)}. Tu achèteras ensuite des casiers à l'épicerie pour remplir ton stock, et tu serviras les clients ici. Le voisinage achètera aussi un peu en ton absence.`,
      confirmLabel: `Payer ${fmt(cost)}`,
      onConfirm: async () => {
        const res = await perform('business/open', { type: 'kiosque' });
        if (res) { ui.toast('Ton kiosque est ouvert ! Remplis-le avec des casiers de boissons.', 'success'); this.openBusinessPanel(); }
      },
    });
  },

  openBusinessPanel() {
    ui.business({
      onRestock: (crates) => this.restock(crates),
      onToggleServing: () => this.toggleServing(),
      serving: () => !!this.scene?.customers?.active,
    });
  },

  async restock(crates) {
    const res = await perform('business/restock', { crates });
    if (res) ui.toast(`Stock du kiosque : ${res.stock} boissons`, 'success');
  },

  toggleServing() {
    const c = this.scene.customers;
    c.setActive(!c.active);
    ui.close();
    ui.toast(c.active ? 'Tu tiens ton kiosque : reste à proximité, les clients arrivent.' : 'Kiosque fermé pour le moment.', 'info');
  },

  async serveCustomer() {
    const res = await perform('business/sell');
    if (res) {
      this.scene.customers.served();
      ui.toast(`Vente : +${fmt(res.price)}`, 'success');
    }
  },

  // --- Parcelles et publicité -----------------------------------------------------
  buyPlot(plot, size) {
    const price = store.config.plot_price;
    ui.confirm({
      title: `Acheter la parcelle ${plot}`,
      text: `Terrain de ${size} cases : ${fmt(price)}. Tu pourras ensuite y construire une maisonnette ou une boutique. Une seule parcelle par joueur.`,
      confirmLabel: `Payer ${fmt(price)}`,
      onConfirm: async () => {
        const res = await perform('plots/buy', { plot });
        if (res) { ui.close(); ui.toast(`La parcelle ${plot} est à toi !`, 'success'); }
      },
    });
  },

  openBuildPanel(plot) {
    ui.buildPanel(plot, async (template, name) => {
      const res = await perform('plots/build', { plot, template, name });
      if (res) { ui.close(); ui.toast('Construction terminée !', 'success'); }
    });
  },

  async rentAd(slot) {
    const cfg = store.config.ad_rental;
    ui.confirm({
      title: 'Louer ce panneau publicitaire',
      text: `${fmt(cfg.price)} pour ${cfg.duration_hours / 24} jours. Tout le quartier verra la publicité de ton kiosque, et elle t'amènera des clients en plus.`,
      confirmLabel: `Payer ${fmt(cfg.price)}`,
      onConfirm: async () => {
        const res = await perform('ads/rent', { slot });
        if (res) { ui.close(); ui.toast('Ta publicité est affichée !', 'success'); }
      },
    });
  },

  // --- Missions ---------------------------------------------------------------
  async acceptMission(id) {
    const res = await perform('missions/accept', { mission: id }, { idempotent: false });
    if (res) { ui.close(); ui.toast('Mission acceptée ! Consulte le journal 📜.', 'info'); }
  },

  async claimMission(id) {
    const res = await perform('missions/claim', { mission: id });
    if (res) { ui.close(); ui.toast(`Mission accomplie : +${fmt(res.reward)}`, 'success'); }
  },
};
