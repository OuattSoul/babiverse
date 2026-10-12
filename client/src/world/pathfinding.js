// Recherche de chemin sur la grille (A*, 8 directions sans couper les coins), puis lissage.
// Module pur : utilisé pour « toucher le sol pour y aller » et testé avec Vitest.
import { isSolid, rectCollides, TILE } from './grid.js';

const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

const tileOf = (px) => Math.floor(px / TILE);
const center = (t) => (t + 0.5) * TILE;

/** Case praticable la plus proche d'un point (recherche en anneaux). */
export function nearestWalkable(grid, px, py, maxRadius = 6) {
  const tx = tileOf(px);
  const ty = tileOf(py);
  if (!isSolid(grid, tx, ty)) return { tx, ty };
  let best = null;
  let bestD = Infinity;
  for (let r = 1; r <= maxRadius && !best; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || isSolid(grid, tx + dx, ty + dy)) continue;
        const d = Math.hypot(center(tx + dx) - px, center(ty + dy) - py);
        if (d < bestD) { bestD = d; best = { tx: tx + dx, ty: ty + dy }; }
      }
    }
  }
  return best;
}

function astar(grid, sx, sy, gx, gy) {
  const w = grid.w;
  const key = (x, y) => y * w + x;
  const open = [{ x: sx, y: sy, f: 0 }];
  const g = new Map([[key(sx, sy), 0]]);
  const came = new Map();
  const h = (x, y) => Math.hypot(gx - x, gy - y);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === gx && cur.y === gy) {
      const path = [[gx, gy]];
      let k = key(gx, gy);
      while (came.has(k)) { k = came.get(k); path.push([k % w, Math.floor(k / w)]); }
      return path.reverse();
    }
    for (const [dx, dy, cost] of DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (isSolid(grid, nx, ny)) continue;
      if (dx && dy && (isSolid(grid, cur.x + dx, cur.y) || isSolid(grid, cur.x, cur.y + dy))) continue;
      const ng = g.get(key(cur.x, cur.y)) + cost;
      const nk = key(nx, ny);
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, key(cur.x, cur.y));
        open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}

/** Le corps peut-il aller en ligne droite de a à b sans toucher d'obstacle ? */
export function clearSegment(grid, a, b, body) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(d / 4));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (rectCollides(grid, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, body.hw + 1, body.hh + 1)) return false;
  }
  return true;
}

/**
 * Chemin en pixels de `from` vers `to` (ou la case praticable la plus proche).
 * Retourne une liste de points de passage (sans le point de départ), ou null si inaccessible.
 */
export function findPath(grid, from, to, body) {
  const goal = nearestWalkable(grid, to.x, to.y);
  if (!goal) return null;
  const start = { tx: tileOf(from.x), ty: tileOf(from.y) };
  const tiles = astar(grid, start.tx, start.ty, goal.tx, goal.ty);
  if (!tiles) return null;
  const exact = !isSolid(grid, tileOf(to.x), tileOf(to.y)) && !rectCollides(grid, to.x, to.y, body.hw, body.hh);
  const points = tiles.slice(1).map(([x, y]) => ({ x: center(x), y: center(y) }));
  if (exact) points.push({ x: to.x, y: to.y });
  if (!points.length) return exact ? [{ x: to.x, y: to.y }] : [];
  // Lissage : on saute les points intermédiaires quand la ligne droite est dégagée.
  const out = [];
  let anchor = { x: from.x, y: from.y };
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !clearSegment(grid, anchor, points[j], body)) j--;
    out.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return out;
}
