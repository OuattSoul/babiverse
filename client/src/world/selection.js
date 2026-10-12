// Contenu de la fiche d'un objet sélectionné (module pur : ne dépend que de l'état fourni).
// Retourne { title, subtitle, badge, lines, facts, actions, view, ad? } :
// - facts : lignes « libellé : valeur » (parcelle) ;
// - actions : celles des éléments rattachés, chacune avec `source` (élément à approcher) et `remote` ;
// - view : 'ad' pour une publicité diffusée (fiche dédiée), sinon 'info'.
import { ISSUE_TEXT, SUPPORT_LABELS } from './ads.js';
import { PLOTS } from './city.js';
import { actionsFor, slotView } from './interactionTypes.js';
import { NPCS } from './npcs.js';
import { PLOT_CONDITIONS, plotView } from './plots.js';
import { RESIDENTIAL } from './residential.js';
import { CATEGORIES } from './selectables.js';

const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;
const fmtNum = (n) => n.toLocaleString('fr-FR');
const TEMPLATE_NAMES = { boutique: 'Petite boutique', maisonnette: 'Maisonnette' };

/** Actions des éléments rattachés, sans les « regarder » qui ne font que rouvrir cette fiche. */
function attachedActions(item, ctx, interactables) {
  const out = [];
  for (const id of item.attached) {
    const it = item.category === 'npc' ? { type: 'npc', npc: id } : interactables.get(id);
    if (!it) continue;
    for (const a of actionsFor(it, ctx)) {
      if (a.id === 'look' || a.id === 'view_ad') continue;
      out.push({ ...a, source: id });
    }
  }
  return out;
}

export function describeSelection(item, ctx, interactables) {
  const actions = attachedActions(item, ctx, interactables);
  const badge = CATEGORIES[item.category]?.label || '';
  const texts = item.attached.map((id) => interactables.get(id)?.text).filter(Boolean);

  if (item.lot) {
    return {
      title: 'Emplacement libre', subtitle: RESIDENTIAL.name, badge,
      lines: ['La maison du prochain habitant du quartier sera construite ici à son arrivée.'],
      facts: [['Numéro', `Lot ${item.lot.slot + 1}`], ['Dimensions', `${RESIDENTIAL.lot}×${RESIDENTIAL.lot} cases`]],
      actions: [], view: 'info',
    };
  }

  if (item.building) {
    const b = item.building;
    if (b.home !== undefined) {
      return {
        title: b.name, subtitle: `${RESIDENTIAL.name} · lot ${b.home + 1}`, badge,
        lines: [b.mine ? 'Ta maison, construite à ton arrivée dans le quartier.' : "La maison d'un habitant du quartier."],
        facts: [['Propriétaire', b.mine ? 'Toi' : b.owner || '—']], actions, view: 'info',
      };
    }
    if (b.owner) {
      const kind = TEMPLATE_NAMES[b.template] || 'Bâtiment';
      return {
        title: b.name, subtitle: `${kind} · ${b.mine ? 'à toi' : `propriété de ${b.owner}`}`, badge,
        lines: ["L'aménagement intérieur arrive bientôt."], facts: [], actions, view: 'info',
      };
    }
    return { title: b.name || 'Bâtiment', subtitle: badge, badge, lines: [b.info, ...texts].filter(Boolean), facts: [], actions, view: 'info' };
  }

  if (item.category === 'npc') {
    const npc = NPCS[item.id];
    return { title: npc.name, subtitle: npc.role, badge, lines: [], facts: [], actions, view: 'info' };
  }

  const it = item.interactable;
  if (item.category === 'plot') return describePlot(it, ctx, actions, badge);
  if (item.category === 'billboard') return describeSlot(it, ctx, actions, badge);
  if (it.type === 'kiosk') {
    const open = !!ctx.store.state.business?.open;
    return {
      title: open ? 'Mon kiosque à boissons' : 'Emplacement de kiosque', subtitle: badge, badge,
      lines: [open ? 'Ton commerce : stock, ventes et service des clients.' : 'Un emplacement à louer pour ouvrir ton propre kiosque.'],
      facts: [], actions, view: 'info',
    };
  }
  return { title: it.name || it.label, subtitle: badge, badge, lines: texts, facts: [], actions, view: 'info' };
}

function describePlot(it, ctx, actions, badge) {
  const { store } = ctx;
  const world = store.state.world || { plots: {} };
  const def = PLOTS.find((p) => p.id === it.plot);
  const view = plotView(def, {
    claim: world.plots[it.plot], price: store.config.plot_price, balance: store.state.character.balance,
    ownsPlot: Object.values(world.plots).some((p) => p.mine),
  });
  const facts = [['Identifiant', view.id], ['Dimensions', view.size], ['Catégorie', view.category]];
  const base = { title: `Parcelle ${view.id}`, badge, actions, view: 'info', plot: view };
  if (view.state === 'unavailable') {
    return { ...base, subtitle: 'Non disponible', lines: [view.reason || "Cette parcelle n'est pas à vendre pour le moment."], facts };
  }
  if (view.state === 'available') {
    // Motif d'inéligibilité : déjà affiché sous le bouton « Acheter » s'il est présent.
    const lines = actions.some((a) => a.id === 'buy') ? [] : [view.reason].filter(Boolean);
    return {
      ...base, subtitle: 'Disponible', lines,
      facts: [...facts, ['Prix', fmt(view.price)], ['Conditions', PLOT_CONDITIONS.join(' ')]],
    };
  }
  const building = view.building ? `${TEMPLATE_NAMES[view.building.template] || 'Bâtiment'} « ${view.building.name} »` : 'Terrain nu';
  return {
    ...base, subtitle: view.state === 'mine' ? 'Ta parcelle' : 'Occupée',
    lines: view.state === 'occupied' && view.building ? ['La visite des bâtiments des autres joueurs arrive bientôt.'] : [],
    facts: [...facts, ['Propriétaire', view.state === 'mine' ? 'Toi' : view.owner], ['Bâtiment', building]],
  };
}

function describeSlot(it, ctx, actions, badge) {
  const view = slotView(it.slot, ctx.store);
  const support = SUPPORT_LABELS[it.support] || 'Support publicitaire';
  if (view.status === 'active') {
    return { title: view.ad.title, subtitle: 'Publicité', badge, lines: [], facts: [], actions, view: 'ad', ad: view.ad, slot: it.slot };
  }
  const titles = { free: 'Emplacement publicitaire libre', reserved: 'Emplacement réservé', disabled: 'Panneau hors service' };
  const lines = [];
  if (view.issue) lines.push(ISSUE_TEXT[view.issue]);
  if (view.status === 'free' && !ctx.store.state.business?.open) lines.push('Ouvre ton kiosque pour pouvoir y faire ta publicité.');
  if (view.status === 'reserved') lines.push('Une annonce sera bientôt affichée ici.');
  if (view.status === 'disabled') lines.push("Cet emplacement n'accueille pas d'annonce pour le moment.");
  const facts = [['Support', support]];
  if (it.board) facts.push(['Taille du visuel', `${fmtNum(it.board.w)} × ${fmtNum(it.board.h)} cases`]);
  return { title: titles[view.status], subtitle: support, badge, lines, facts, actions, view: 'info' };
}
