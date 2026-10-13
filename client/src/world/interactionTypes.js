// Registre générique des types d'interaction.
// Chaque type transforme la définition d'un élément (zones.js) en liste d'actions
// { id, label, enabled, reason, run, remote }. Liste vide = élément invisible pour l'instant.
// remote : l'action est possible à distance (consulter, acheter) ; sinon il faut être à portée.
import { resolveSlot } from './ads.js';
import { conditionReason } from './conditions.js';
import { PLOTS } from './city.js';
import { NPCS } from './npcs.js';
import { plotView } from './plots.js';

const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;

export const INTERACTION_TYPES = {
  // Porte : passage vers une autre zone. Avec des conditions (cartes de l'atelier), l'action reste visible mais
  // désactivée tant qu'elles ne sont pas remplies ; le serveur revérifie à l'arrivée.
  door: (it, { actions, store }) => {
    const action = { id: 'enter', label: it.label, run: () => actions.enterDoor(it.target) };
    const reason = it.conditions?.length ? conditionReason(it.conditions, store) : null;
    return reason ? [{ ...action, enabled: false, reason }] : [action];
  },

  // Élément d'information : l'action ouvre sa fiche (texte, actions éventuelles).
  info: (it, { actions }) => [
    { id: 'look', label: it.label, remote: true, run: () => actions.inspect(it.id) },
  ],

  // Parcelle : achat si elle est libre, construction si elle est à moi, consultation sinon.
  // L'éligibilité affichée n'est qu'indicative : le serveur revérifie tout au moment de l'achat.
  plot: (it, { store, actions }) => {
    const world = store.state.world || { plots: {} };
    const def = PLOTS.find((p) => p.id === it.plot);
    const view = plotView(def, {
      claim: world.plots[it.plot], price: store.config.plot_price, balance: store.state.character.balance,
      ownsPlot: Object.values(world.plots).some((p) => p.mine),
    });
    const look = (label) => [{ id: 'look', label, remote: true, run: () => actions.inspect(it.id) }];
    if (view.state === 'unavailable') return look(`Parcelle ${it.plot} — non disponible`);
    if (view.state === 'available') {
      if (view.reason && !view.reason.startsWith('Il te faut')) return look(`Parcelle ${it.plot} — libre`);
      return [{
        id: 'buy', label: `Acheter la parcelle ${it.plot} (${fmt(view.price)})`, enabled: view.eligible, reason: view.reason,
        remote: true, run: () => actions.buyPlot(it.plot, it.size),
      }];
    }
    if (view.state === 'mine' && !view.building) {
      return [{ id: 'build', label: 'Construire sur ma parcelle', remote: true, run: () => actions.openBuildPanel(it.plot) }];
    }
    return look(view.state === 'mine' ? `Ma parcelle ${it.plot}` : `Parcelle de ${view.owner}`);
  },

  // Bâtiment construit par un joueur (le mien ou celui d'un voisin).
  player_building: (it, { actions }) => {
    const b = it.building;
    const kind = b.template === 'boutique' ? 'Boutique' : 'Maisonnette';
    if (b.home !== undefined) return [{ id: 'look', label: b.name, remote: true, run: () => actions.inspect(it.id) }];
    return [{ id: 'look', label: b.mine ? `Mon bâtiment : ${b.name}` : `${kind} de ${b.owner}`, remote: true, run: () => actions.inspect(it.id) }];
  },

  // Emplacement publicitaire : annonce diffusée, location si libre et si on a une entreprise.
  billboard: (it, { store, actions }) => {
    const view = slotView(it.slot, store);
    if (view.status === 'active') return [{ id: 'view_ad', label: 'Voir la publicité', remote: true, run: () => actions.inspect(it.id) }];
    if (view.status === 'free' && store.state.business?.open) {
      const price = store.config.ad_rental.price;
      const balance = store.state.character.balance;
      return [{
        id: 'rent', label: `Louer ce panneau (${fmt(price)})`, enabled: balance >= price, remote: true,
        reason: balance >= price ? null : `Il te faut ${fmt(price)}`,
        run: () => actions.rentAd(it.slot),
      }];
    }
    return [{ id: 'look', label: it.label, remote: true, run: () => actions.inspect(it.id) }];
  },

  bed: (it, { store, actions }) => {
    const c = store.state.character;
    const readyAt = c.rest_ready_at ? Date.parse(c.rest_ready_at) : 0;
    const wait = Math.ceil((readyAt - store.serverNow().getTime()) / 1000);
    const enabled = wait <= 0;
    return [{
      id: 'rest', label: it.label, enabled,
      reason: enabled ? null : `Tu viens de te reposer (encore ${wait} s)`,
      run: () => actions.rest(),
    }];
  },

  npc: (it, { actions }) => [
    { id: 'talk', label: `Parler à ${NPCS[it.npc].name}`, run: () => actions.talk(it.npc) },
  ],

  delivery: (it, { store, actions }) => {
    const shift = store.state.job.active;
    if (!shift || !shift.targets.includes(it.id) || shift.delivered.includes(it.id)) return [];
    return [{ id: 'deliver', label: it.label, run: () => actions.deliver(it.id) }];
  },

  kiosk: (it, { store, actions, scene }) => {
    const biz = store.state.business;
    if (!biz.open) {
      const balance = store.state.character.balance;
      let reason = null;
      if (!biz.unlocked) reason = "Termine d'abord un premier travail (M. Diabaté)";
      else if (balance < biz.cost) reason = `Il te faut ${fmt(biz.cost)} pour ouvrir`;
      return [{ id: 'open', label: `Ouvrir mon kiosque (${fmt(biz.cost)})`, enabled: !reason, reason, run: () => actions.openBusiness() }];
    }
    const list = [];
    if (scene.customers?.waiting()) {
      list.push({
        id: 'serve', label: `Servir le client (+${fmt(biz.sale_price)})`, enabled: biz.stock > 0,
        reason: biz.stock > 0 ? null : 'Stock vide : achète un casier à l\'épicerie',
        run: () => actions.serveCustomer(),
      });
    }
    list.push({ id: 'manage', label: 'Gérer mon kiosque', run: () => actions.openBusinessPanel() });
    return list;
  },
};

/** Ce qu'affiche un emplacement publicitaire, avec la campagne éventuelle d'un joueur (état serveur). */
export function slotView(slotId, store) {
  return resolveSlot(slotId, { live: store.state?.world?.ads?.[slotId] || null, now: store.serverNow().getTime() });
}

export function actionsFor(it, ctx) {
  const builder = INTERACTION_TYPES[it.type];
  if (!builder) throw new Error(`Type d'interaction inconnu : ${it.type}`);
  return builder(it, ctx);
}
