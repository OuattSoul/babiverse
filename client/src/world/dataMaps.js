// Cartes publiées par l'atelier (pack de jeu, section `maps`) → zones du jeu. Module pur (testé avec Vitest).
//
// Une carte de l'atelier devient une zone au format habituel (grille ASCII, portes, objets interactifs, points
// d'apparition) ; seuls ses paysages 3D sont en plus : `zone.landscapes` (dessinés par engine3d/landscapes.js) et
// `zone.blocked` (emprises au sol infranchissables, lues par la grille de collision). Les comportements viennent
// du registre existant (world/interactionTypes.js) : `door` (passage vers une autre carte) et `info` (fiche, pour
// une boutique ou un panneau). Aucune configuration ne peut fournir de code.
//
// Unités : 1 case = 1 unité 3D = 32 px ; un modèle est posé à son origine en (x, z) cases, tourné d'un quart de tour
// (sens horaire vu du dessus) et mis à l'échelle (1 unité du modèle = 1 case). Même règle d'emprise que l'atelier
// (backend/app/worldmaps.py, footprint).
import { exitSpawnOf } from './interiors.js';
import { occupancy, placementIssue } from './placement.js';

const MAP_ID = /^[a-z][a-z0-9_]{0,31}$/;
const GROUND = { grass: ',', dirt: '.', paving: ':', sand: '.' };
const EPS = 1e-6;
const INTERACTIVE = {
  door: { type: 'door', category: 'door' },
  shop: { type: 'info', category: 'shop' },
  info: { type: 'info', category: 'furniture' },
};

/** Cases couvertes au sol par une instance de paysage : { x, y, w, h }. */
export function footprint(inst, bbox) {
  const s = inst.scale ?? 1;
  const r = ((inst.rotation || 0) * Math.PI) / 180;
  const c = Math.round(Math.cos(r));
  const n = Math.round(Math.sin(r));
  const xs = [];
  const zs = [];
  for (const x of [bbox[0] * s, bbox[3] * s]) {
    for (const z of [bbox[2] * s, bbox[5] * s]) {
      xs.push(inst.x + x * c - z * n);
      zs.push(inst.z + x * n + z * c);
    }
  }
  const x0 = Math.floor(Math.min(...xs) + EPS);
  const y0 = Math.floor(Math.min(...zs) + EPS);
  const x1 = Math.ceil(Math.max(...xs) - EPS);
  const y1 = Math.ceil(Math.max(...zs) - EPS);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** Adresse du fichier d'un modèle, relayé par le serveur du jeu (même origine, révision figée). */
export const modelUrl = (m) => `/api/atelier/models/${encodeURIComponent(m.media_id)}/${m.revision}`;

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** Carte du pack utilisable par le jeu ? (`reserved` : identifiants des cartes intégrées, prioritaires) */
export function usableMap(m, reserved = []) {
  return !!m && typeof m.id === 'string' && MAP_ID.test(m.id) && !m.id.startsWith('int_') && !reserved.includes(m.id)
    && intIn(m.width, 8, 120) && intIn(m.height, 8, 120) && Array.isArray(m.spawn)
    && Array.isArray(m.landscapes) && Array.isArray(m.interactives);
}

const inRect = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Case libre la plus proche (parcours en largeur) : un point d'arrivée ne doit jamais tomber dans un obstacle. */
function freeTile(w, h, blocked, [sx, sy]) {
  const free = (x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1 && !blocked.some((r) => inRect(r, x, y));
  const start = [Math.min(Math.max(sx, 1), w - 2), Math.min(Math.max(sy, 1), h - 2)];
  const seen = new Set([start.join(',')]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    if (free(x, y)) return [x, y];
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const k = `${x + dx},${y + dy}`;
      if (x + dx > 0 && y + dy > 0 && x + dx < w - 1 && y + dy < h - 1 && !seen.has(k)) { seen.add(k); queue.push([x + dx, y + dy]); }
    }
  }
  return start;
}

/**
 * Modèles à précharger depuis une zone : ceux des cartes de l'atelier joignables directement (portes, panneaux),
 * dans la limite de `budget` octets, sans ceux déjà en cache. Le préchargement ne fait que remplir le cache HTTP du
 * navigateur (aucune analyse, aucune mémoire graphique) ; il est coupé en mode économie de données ou en 2G.
 */
export function prefetchPlan(zone, zoneOf, { budget = 6 * 1024 * 1024, cached = () => false, connection = null } = {}) {
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '')) return [];
  const targets = [...new Set((zone.interactables || []).filter((i) => i.type === 'door' && i.target?.zone).map((i) => i.target.zone))];
  const out = [];
  let total = 0;
  for (const id of targets) {
    for (const l of zoneOf(id)?.landscapes || []) {
      if (out.includes(l.url) || cached(l.url)) continue;
      if (total + l.bytes > budget) return out;
      total += l.bytes;
      out.push(l.url);
    }
  }
  return out;
}

/** Zone du jeu construite à partir d'une carte publiée par l'atelier. */
export function dataZone(m) {
  const w = m.width;
  const h = m.height;
  const ground = GROUND[m.ground] || ',';
  const map = Array.from({ length: h }, (_, y) => (y === 0 || y === h - 1 ? '#'.repeat(w) : `#${ground.repeat(w - 2)}#`));
  const landscapes = [];
  for (const inst of m.landscapes) {
    const model = m.models?.[inst.id];
    if (!model?.bbox) continue;
    landscapes.push({
      id: inst.id, url: modelUrl(model), bytes: model.bytes || 0, x: inst.x, z: inst.z, rotation: inst.rotation || 0, scale: inst.scale ?? 1,
      solid: inst.solid !== false, bbox: model.bbox, footprint: inst.footprint || footprint(inst, model.bbox),
    });
  }
  const blocked = landscapes.filter((l) => l.solid).map(({ footprint: f }) => ({ x0: f.x, y0: f.y, x1: f.x + f.w - 1, y1: f.y + f.h - 1 }));
  const interactables = [];
  for (const it of m.interactives) {
    const kind = INTERACTIVE[it.type];
    const a = it.area;
    if (!kind || it.active === false || !a) continue; // désactivé : ni invite, ni fiche, le paysage ne change pas
    const base = {
      id: it.id, ...kind, tile: [a.x, a.y], w: a.w, h: a.h, name: it.name, text: it.text || '',
      // portée : depuis le bord de la zone, pas seulement depuis son centre
      range: 44 + 16 * Math.max(a.w, a.h),
    };
    if (kind.type === 'door') {
      if (!it.target?.zone) continue;
      const transport = it.mode === 'transport';
      interactables.push({
        ...base, label: it.label || (transport ? `Prendre : ${it.name}` : `Aller : ${it.name}`), mode: transport ? 'transport' : 'walk',
        target: { zone: it.target.zone, spawn: it.target.spawn || 'default' },
        ...(it.conditions?.length ? { conditions: it.conditions } : {}),
      });
    } else {
      interactables.push({ ...base, label: it.label || `Voir : ${it.name}` });
    }
  }
  const spawn = freeTile(w, h, blocked, m.spawn);
  // Points d'arrivée nommés (destinations des portes venant d'autres cartes), jamais dans un obstacle.
  const arrivals = Object.fromEntries((m.arrivals || []).filter((a) => a && typeof a.id === 'string')
    .map((a) => [a.id, freeTile(w, h, blocked, [a.x, a.y])]));
  return {
    id: m.id,
    name: m.name,
    outdoor: true,
    // Extérieur : glisser = caméra, déplacement au joystick ou au clavier (comme la Cité Akwaba).
    navigation: 'camera',
    map,
    buildings: [],
    blocked,
    landscapes,
    spawns: { ...arrivals, default: spawn, entree: spawn },
    props: [],
    interactables,
    npcs: [],
    atelierMap: { version: m.version, city: m.city, district: m.district },
  };
}

/**
 * Accès aux cartes de l'atelier depuis une zone (aujourd'hui la Cité Akwaba) : un panneau de direction (décor
 * existant `roadsign`) sur la case choisie, qui est aussi la porte vers la carte, et le point de retour devant lui.
 * Une case refusée par les règles de placement de la ville (route, bâtiment, parcelle, porte…) est ignorée, avec sa raison.
 */
export function withEntrances(zone, maps) {
  const list = maps.filter((m) => m.entrance && (m.entrance.zone || 'quartier') === zone.id);
  if (!list.length) return { zone, skipped: [] };
  const occ = occupancy(zone);
  const out = { ...zone, props: [...(zone.props || [])], interactables: [...(zone.interactables || [])], spawns: { ...zone.spawns } };
  const skipped = [];
  const taken = [];
  for (const m of list) {
    const { x, y, label } = m.entrance;
    const p = { family: 'prop', x, y, w: 1, h: 1, facing: 'S', name: m.name };
    const reason = !Number.isInteger(x) || !Number.isInteger(y) ? 'Case invalide.' : placementIssue(zone, occ, p, taken);
    if (reason) { skipped.push({ id: m.id, reason }); continue; }
    const W = zone.map[0].length;
    const front = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => [x + dx, y + dy])
      .find(([fx, fy]) => fx > 0 && fy > 0 && fx < W - 1 && fy < zone.map.length - 1 && !occ.grid.solid[fy * occ.grid.w + fx]
        && !taken.some((t) => t.x === fx && t.y === fy));
    if (!front) { skipped.push({ id: m.id, reason: 'Aucune case libre devant le panneau.' }); continue; }
    taken.push(p);
    out.props.push({ kind: 'roadsign', tile: [x, y], text: label || m.name, solid: true, atelierMap: m.id });
    out.interactables.push({
      id: `vers_${m.id}`, type: 'door', category: 'door', tile: [x, y], name: m.name, label: `Aller : ${m.name}`,
      text: m.city?.name ? `${m.name} — ${m.district?.name || ''}, ${m.city.name}` : m.name, target: { zone: m.id, spawn: 'default' },
    });
    out.spawns[exitSpawnOf(m.id)] = front;
  }
  return { zone: out, skipped };
}
