// Lotissement : emplacements de 2×2 cases où le serveur construit la maison initiale de chaque
// joueur (module pur, testé). L'attribution est faite par le serveur (backend/game/services/homes.py),
// qui applique la même géométrie : le client ne fait qu'afficher les maisons reçues et les
// emplacements restés libres.

import CITY from '../../../shared/city.json';

export const RESIDENTIAL = CITY.residential;
const LOT = RESIDENTIAL.lot;
const COLS = RESIDENTIAL.w / LOT;
export const LOTS_PER_BLOCK = COLS * (RESIDENTIAL.h / LOT);

/** Case nord-ouest de l'emplacement `slot` : les blocs s'empilent vers le sud. */
export function lotOrigin(slot) {
  const block = Math.floor(slot / LOTS_PER_BLOCK);
  const local = slot % LOTS_PER_BLOCK;
  return [RESIDENTIAL.x + (local % COLS) * LOT, RESIDENTIAL.y + block * RESIDENTIAL.h + Math.floor(local / COLS) * LOT];
}

/** Rectangle (cases, bornes incluses) couvert par `blocks` blocs ouverts. */
export function residentialRect(blocks = 1) {
  const { x, y, w, h } = RESIDENTIAL;
  return { x0: x, y0: y, x1: x + w - 1, y1: y + blocks * h - 1 };
}

/** Emplacements sans maison parmi ceux des blocs ouverts : [{ slot, x, y }]. */
export function freeLots(blocks, homes = []) {
  const taken = new Set(homes.map((h) => h.slot));
  const out = [];
  for (let slot = 0; slot < blocks * LOTS_PER_BLOCK; slot++) {
    if (taken.has(slot)) continue;
    const [x, y] = lotOrigin(slot);
    out.push({ slot, x, y });
  }
  return out;
}

/**
 * Maisons reçues du serveur (state.world.residential.homes), au format des constructions de
 * joueurs affichées dans la ville. Position : celle enregistrée par le serveur.
 * Ma maison mène à mon studio (zone « maison », dessinée à la main) ; on en ressort devant elle.
 */
export function homeBuildings(homes, templates) {
  return homes.map((h) => {
    const t = templates[h.template];
    return {
      id: `home_${h.slot}`, category: 'building', home: h.slot, owner: h.owner, mine: h.mine,
      ...(h.mine ? { zone: 'maison' } : {}),
      name: h.mine ? 'Ma maison' : h.owner ? `Maison de ${h.owner}` : 'Maison', template: h.template,
      x0: h.x, y0: h.y, x1: h.x + t.facade.length - 1, y1: h.y + 1,
      facade: t.facade, roof: t.roof, facing: h.facing, sign: null,
    };
  });
}

/** Volumes sélectionnables des emplacements libres (fiche « Emplacement libre »). */
export function lotSelectables(lots) {
  return lots.map((l) => ({
    id: `lot_${l.slot}`, category: 'lot', lot: l, attached: [],
    boxes: [{ x0: l.x, z0: l.y, x1: l.x + LOT, z1: l.y + LOT, y0: 0, y1: 0.12 }],
  }));
}
