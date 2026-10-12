// Règles de placement des éléments de l'atelier sur la carte de la ville (module pur, testé).
// Partagé par le jeu (qui ignore un placement devenu incompatible) et par la page « Carte du jeu » de l'atelier
// (qui l'importe pour guider l'administrateur) : les deux appliquent exactement les mêmes règles.
import { buildGrid } from './grid.js';
import { RESIDENTIAL } from './residential.js';

const ROAD = new Set(['=', '-', '|', '+', '_']);
export const FRONT = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] };

/**
 * Occupation de la ville avant placement : grille de collision (bâtiments, arbres, décor solide) et cases réservées
 * (portes, guichets, panneaux, PNJ), qu'aucun élément ne doit recouvrir.
 */
export function occupancy(zone) {
  const grid = buildGrid(zone);
  const reserved = new Set();
  const doors = new Set(); // portes, guichets et livraisons : on ne colle pas un bâtiment contre (portes ambiguës)
  for (const it of zone.interactables || []) {
    const [tx, ty] = it.tile;
    for (let dy = 0; dy < (it.h || 1); dy++) for (let dx = 0; dx < (it.w || 1); dx++) reserved.add(`${tx + dx},${ty + dy}`);
    if (it.type === 'door' || it.type === 'delivery' || it.type === 'kiosk') doors.add(`${tx},${ty}`);
  }
  for (const n of zone.npcs || []) reserved.add(`${n.tile[0]},${n.tile[1]}`);
  return { grid, reserved, doors };
}

/** Zone réservée au lotissement et à ses extensions vers le sud (toutes les colonnes du lotissement). */
const inResidential = (x, y) => x >= RESIDENTIAL.x && x < RESIDENTIAL.x + RESIDENTIAL.w && y >= RESIDENTIAL.y;

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Raison pour laquelle une case ne peut pas être couverte par l'élément, ou null. */
function cellIssue(zone, occ, family, x, y) {
  const ch = zone.map[y][x];
  if (ROAD.has(ch)) return 'Sur une route ou un trottoir.';
  if (ch === 'l') return 'Sur une parcelle réservée aux joueurs.';
  if (inResidential(x, y)) return 'Dans le lotissement (réservé aux maisons des joueurs).';
  if (occ.grid.solid[y * occ.grid.w + x]) return 'Occupé par un bâtiment, un arbre ou un décor.';
  if (family !== 'surface' && occ.reserved.has(`${x},${y}`)) return 'Sur une porte, un guichet, un panneau ou un PNJ.';
  return null;
}

/** Cases devant la façade d'un bâtiment (côté `facing`). */
function frontCells(p) {
  const [dx, dy] = FRONT[p.facing] || FRONT.S;
  const cells = [];
  if (dy) for (let x = p.x; x < p.x + p.w; x++) cells.push([x, dy > 0 ? p.y + p.h : p.y - 1]);
  else for (let y = p.y; y < p.y + p.h; y++) cells.push([dx > 0 ? p.x + p.w : p.x - 1, y]);
  return cells;
}

/** Règles propres aux bâtiments : pas collé à une autre entrée, façade accessible. */
function buildingIssue(zone, occ, p, others) {
  // Deux portes voisines se disputeraient l'invite « Entrer ».
  for (let y = p.y - 1; y <= p.y + p.h; y++) {
    for (let x = p.x - 1; x <= p.x + p.w; x++) if (occ.doors?.has(`${x},${y}`)) return "Trop près de l'entrée d'un autre bâtiment.";
  }
  const W = zone.map[0].length;
  const H = zone.map.length;
  const free = ([x, y]) => x > 0 && y > 0 && x < W - 1 && y < H - 1 && !occ.grid.solid[y * occ.grid.w + x]
    && !others.some((o) => o.family !== 'surface' && overlap(o, { x, y, w: 1, h: 1 }));
  return frontCells(p).some(free) ? null : 'La façade ne donne sur aucun passage.';
}

/**
 * Raison pour laquelle un élément ne peut pas occuper ce rectangle, ou null s'il le peut.
 * p : { family: building|prop|vehicle|surface, x, y, w, h, facing } ; others : placements déjà acceptés.
 */
export function placementIssue(zone, occ, p, others = []) {
  const W = zone.map[0].length;
  const H = zone.map.length;
  if (p.x < 1 || p.y < 1 || p.x + p.w > W - 1 || p.y + p.h > H - 1) return 'Hors de la carte de la ville.';
  for (let y = p.y; y < p.y + p.h; y++) {
    for (let x = p.x; x < p.x + p.w; x++) {
      const issue = cellIssue(zone, occ, p.family, x, y);
      if (issue) return issue;
    }
  }
  // Une surface peut passer sous les autres éléments, pas sous une autre surface.
  const clash = others.find((o) => overlap(o, p) && (o.family === 'surface') === (p.family === 'surface'));
  if (clash) return `Chevauche « ${clash.name || 'un élément placé'} ».`;
  return p.family === 'building' ? buildingIssue(zone, occ, p, others) : null;
}
