// Sélection de la cible d'interaction : module pur, testable sans moteur.
import { lineOfSight } from './grid.js';

export const DEFAULT_RANGE = 44;

/**
 * Retourne l'élément interactif le plus proche à portée (et en vue si requis), ou null.
 * candidates : [{ id, x, y, range?, los? (défaut true) }]
 */
export function findTarget(grid, player, candidates) {
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.hypot(c.x - player.x, c.y - player.y);
    if (d > (c.range ?? DEFAULT_RANGE) || d >= bestDist) continue;
    if (c.los !== false && !lineOfSight(grid, player.x, player.y, c.x, c.y)) continue;
    best = c;
    bestDist = d;
  }
  return best;
}

/** Première action exécutable, sinon la première (affichée désactivée avec sa raison). */
export function primaryAction(actions) {
  if (!actions || actions.length === 0) return null;
  return actions.find((a) => a.enabled !== false) || actions[0];
}
