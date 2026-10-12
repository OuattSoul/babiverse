// État d'une parcelle vu par le joueur (module pur, testé).
// L'éligibilité affichée ici ne sert qu'à l'interface : l'achat est toujours revalidé par le serveur
// (solde, disponibilité, limite par joueur, concurrence), qui seul débite et attribue.

export const PLOT_CONDITIONS = [
  'Une seule parcelle par joueur.',
  'Paiement en francs CFA virtuels, débité par le serveur après vérification.',
  "La parcelle doit être libre au moment de l'achat.",
];

export function plotCategory(plot) {
  const area = plot.w * plot.h;
  if (area <= 20) return 'Petite parcelle';
  if (area <= 25) return 'Parcelle moyenne';
  return 'Grande parcelle';
}

/**
 * plot : définition (shared/city.json) ; claim : entrée de state.world.plots (ou absente).
 * Retourne { state: 'available'|'mine'|'occupied'|'unavailable', eligible, reason, ... }.
 */
export function plotView(plot, { claim = null, ownsPlot = false, balance = 0, price = 0 } = {}) {
  const base = { id: plot.id, size: `${plot.w}×${plot.h} cases`, category: plotCategory(plot), price };
  if (plot.status === 'unavailable') return { ...base, state: 'unavailable', eligible: false, reason: plot.reason || null };
  if (claim) {
    return {
      ...base, state: claim.mine ? 'mine' : 'occupied', eligible: false,
      owner: claim.owner, building: claim.building || null,
    };
  }
  let reason = null;
  if (ownsPlot) reason = 'Tu possèdes déjà une parcelle dans le quartier.';
  else if (balance < price) reason = `Il te faut ${Math.round(price).toLocaleString('fr-FR')} F`;
  return { ...base, state: 'available', eligible: !reason, reason };
}
