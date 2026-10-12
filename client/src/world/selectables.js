// Modèle générique de sélection (module pur, testé).
//
// Un clic ou un toucher bref est traité en un seul endroit :
// 1. les objets sélectionnables d'une zone sont décrits par des volumes (boîtes en cases, hauteur
//    en unités 3D), déduits des données de la zone : jamais par les maillages affichés ;
// 2. le rayon du clic est testé contre ces volumes : le décor non interactif n'en a pas, il ne
//    peut donc pas intercepter un clic destiné à un objet situé derrière lui ;
// 3. la politique de navigation de la zone décide de la suite : sélection, déplacement ou rien.
//
// Repère : x = colonne, z = ligne de la grille, y = hauteur. 1 unité = 1 case.

/**
 * Catégories d'objets. `bias` (unités) départage deux volumes presque à la même distance :
 * un objet petit et précis (porte, meuble) passe devant le grand volume qui le contient.
 */
export const CATEGORIES = {
  npc: { label: 'Habitant', bias: 0.6 },
  door: { label: 'Porte', bias: 0.5 },
  furniture: { label: 'Meuble', bias: 0.4 },
  billboard: { label: 'Publicité', bias: 0.4 },
  shop: { label: 'Commerce', bias: 0.3 },
  building: { label: 'Bâtiment', bias: 0 },
  plot: { label: 'Parcelle', bias: -0.2 },
  lot: { label: 'Emplacement', bias: -0.3 },
  decor: { label: 'Décor', selectable: false },
};

const TYPE_CATEGORY = {
  door: 'door', bed: 'furniture', info: 'furniture', kiosk: 'shop', billboard: 'billboard',
  plot: 'plot', player_building: 'building', npc: 'npc', delivery: 'building',
};

const HEIGHT = { door: 1.3, furniture: 1.5, shop: 1.9, billboard: 2.3, building: 1.6, npc: 1.6, plotSign: 1.3, plotGround: 0.12 };

export const categoryOf = (it) => it.category || TYPE_CATEGORY[it.type] || 'decor';

/** Politique de navigation : 'camera' (ville : glisser pour explorer) ou 'walk' (logement : cliquer pour marcher). */
export const navigationOf = (zone) => zone.navigation || (zone.outdoor ? 'camera' : 'walk');

const box = (x0, z0, x1, z1, y1, y0 = 0) => ({ x0, z0, x1, z1, y0, y1 });
const inRect = (it, r) => it.tile[0] >= r.x0 && it.tile[0] <= r.x1 && it.tile[1] >= r.y0 && it.tile[1] <= r.y1;

/**
 * Objets sélectionnables fixes d'une zone.
 * - Un bâtiment regroupe les éléments posés sur sa façade (porte, pancarte, livraison) : on le
 *   sélectionne en entier et sa fiche liste leurs actions.
 * - Les autres éléments interactifs ont leur propre volume (parcelle : sol + panneau).
 * Retourne [{ id, category, boxes, attached: [id d'interactable], building?, interactable? }].
 */
export function buildSelectables(zone, { dynamic = [], playerBuildings = [] } = {}) {
  const all = [...zone.interactables, ...dynamic];
  const claimed = new Set();
  const out = [];
  for (const b of [...(zone.buildings || []), ...playerBuildings]) {
    const attached = all.filter((it) => inRect(it, b)).map((it) => it.id);
    attached.forEach((id) => claimed.add(id));
    out.push({
      id: `bld_${b.id}`, category: b.category || 'building', building: b, attached,
      boxes: [box(b.x0, b.y0, b.x1 + 1, b.y1 + 1, HEIGHT.building)],
    });
  }
  for (const it of all) {
    if (claimed.has(it.id)) continue;
    const category = categoryOf(it);
    if (CATEGORIES[category]?.selectable === false) continue;
    out.push({ id: it.id, category, interactable: it, attached: [it.id], boxes: boxesFor(it, category, zone) });
  }
  return out;
}

function boxesFor(it, category, zone) {
  const [tx, ty] = it.tile;
  if (category === 'plot') {
    const p = (zone.plots || []).find((q) => q.id === it.plot);
    const ground = p ? [box(p.x, p.y, p.x + p.w, p.y + p.h, HEIGHT.plotGround)] : [];
    return [...ground, box(tx, ty, tx + 1, ty + 1, HEIGHT.plotSign)];
  }
  return [box(tx, ty, tx + (it.w || 1), ty + (it.h || 1), HEIGHT[category] ?? 1.2)];
}

/** Volumes des PNJ à leur position courante (pixels de grille → cases). */
export function npcSelectables(npcs, tile = 32) {
  return npcs.map((n) => {
    const x = n.x / tile;
    const z = n.y / tile;
    return { id: n.id, category: 'npc', attached: [n.id], boxes: [box(x - 0.3, z - 0.3, x + 0.3, z + 0.3, HEIGHT.npc)] };
  });
}

/** Distance le long du rayon jusqu'à la boîte (méthode des dalles), ou null. */
export function rayBox(ray, b) {
  const o = ray.origin;
  const d = ray.direction;
  let tmin = 0;
  let tmax = Infinity;
  for (const [oa, da, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, b.y0, b.y1], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(da) < 1e-9) {
      if (oa < lo || oa > hi) return null;
      continue;
    }
    let t1 = (lo - oa) / da;
    let t2 = (hi - oa) / da;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

/** Objet visé par un rayon : le plus proche, à la priorité de catégorie près. { item, distance } ou null. */
export function pickSelectable(ray, items) {
  let best = null;
  for (const item of items) {
    const cat = CATEGORIES[item.category];
    if (!cat || cat.selectable === false) continue;
    let t = Infinity;
    for (const b of item.boxes) {
      const hit = rayBox(ray, b);
      if (hit !== null && hit < t) t = hit;
    }
    if (t === Infinity) continue;
    const score = t - (cat.bias || 0);
    if (!best || score < best.score) best = { item, distance: t, score };
  }
  return best && { item: best.item, distance: best.distance };
}

/**
 * Conséquence d'un clic. Sélectionner un objet ne déplace jamais le personnage ; marcher n'est
 * possible que dans une zone en navigation 'walk', et seulement en visant le sol.
 * Retourne { kind: 'select', id } | { kind: 'walk', point } | { kind: 'none' }.
 */
export function resolveTap({ navigation, pick, ground }) {
  if (pick) return { kind: 'select', id: pick.item.id };
  if (navigation === 'walk' && ground) return { kind: 'walk', point: ground };
  return { kind: 'none' };
}
