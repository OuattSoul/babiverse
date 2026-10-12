// Éléments placés par l'administrateur dans l'atelier (page « Carte du jeu ») → ajoutés à la ville. Module pur, testé.
//
// Chaque placement du pack devient une donnée de la zone, comme le reste de la ville : bâtiment (`zone.buildings`,
// cases marquées solides sur la carte, porte et intérieur éventuel), objet, véhicule ou surface (`zone.props`).
// Un placement devenu incompatible avec la carte (route élargie, nouvelle parcelle…) est ignoré, avec sa raison.
import { exitSpawnOf } from '../world/interiors.js';
import { FRONT, occupancy, placementIssue } from '../world/placement.js';
import { homeZone } from './home.js';

/** Case de la porte d'un bâtiment placé : sur la rangée de façade, décalée comme l'entrée principale de l'atelier. */
export function doorOf(p) {
  const along = p.facing === 'E' || p.facing === 'W' ? p.h : p.w;
  const k = Math.max(0, Math.min(along - 1, p.render?.door ?? Math.floor(along / 2)));
  const x1 = p.x + p.w - 1;
  const y1 = p.y + p.h - 1;
  if (p.facing === 'N') return [x1 - k, p.y];
  if (p.facing === 'E') return [x1, p.y + k];
  if (p.facing === 'W') return [p.x, y1 - k];
  return [p.x + k, y1];
}

/**
 * Ville + placements de l'atelier. Retourne { zone, interiors: { id_de_zone: zone }, skipped: [{ id, reason }] }.
 * La zone d'origine n'est pas modifiée.
 */
export function cityWithPlacements(city, placements = []) {
  if (!placements.length) return { zone: city, interiors: {}, skipped: [] };
  const occ = occupancy(city);
  const map = city.map.map((row) => row.split(''));
  const zone = {
    ...city, buildings: [...(city.buildings || [])], props: [...(city.props || [])],
    interactables: [...(city.interactables || [])], spawns: { ...city.spawns },
  };
  const interiors = {};
  const skipped = [];
  const accepted = [];
  for (const p of placements) {
    const reason = placementIssue(city, occ, p, accepted);
    if (reason) { skipped.push({ id: p.id, reason }); continue; }
    accepted.push(p);
    const r = p.render || {};
    const base = { tile: [p.x, p.y], w: p.w, h: p.h, render: r, facing: p.facing, name: p.name };
    if (p.family === 'surface') zone.props.push({ ...base, kind: 'atl_surface', solid: r.walkable === false });
    else if (p.family === 'vehicle') zone.props.push({ ...base, kind: 'atl_vehicle', solid: true });
    else if (p.family === 'prop') zone.props.push({ ...base, kind: 'atl_prop', solid: true, noMerge: !!r.modular });
    else {
      // Bâtiment : cases solides et opaques (comme les façades du jeu), porte sur la façade.
      for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) map[y][x] = 'W';
      const door = doorOf(p);
      const shop = !!r.shop || r.category === 'commerce';
      zone.buildings.push({
        atelier: true, id: p.id, name: p.name, category: shop ? 'shop' : 'building', info: r.description || null,
        x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1, facing: p.facing, door, render: r,
        sign: r.shop?.sign_text ? { text: r.shop.sign_text } : null,
      });
      const [dx, dy] = FRONT[p.facing] || FRONT.S;
      zone.spawns[exitSpawnOf(p.id)] = [door[0] + dx, door[1] + dy];
      if (r.interior?.interior) {
        const id = `int_${p.id}`;
        try {
          interiors[id] = { ...homeZone(r.interior, { id, exit: { zone: 'quartier', spawn: exitSpawnOf(p.id) }, beds: false }), name: p.name };
          zone.interactables.push({ id: `door_${p.id}`, type: 'door', tile: door, label: `Entrer : ${p.name}`, target: { zone: id, spawn: 'entree' } });
        } catch { /* plan illisible : bâtiment sans intérieur */ }
      }
      if (!interiors[`int_${p.id}`]) {
        zone.interactables.push({ id: `info_${p.id}`, type: 'info', tile: door, name: p.name, label: 'Regarder', text: r.description || `${p.name}.` });
      }
    }
  }
  zone.map = map.map((row) => row.join(''));
  zone.atelier = { placed: accepted.map((p) => p.id), skipped };
  return { zone, interiors, skipped };
}
