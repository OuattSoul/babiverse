// Accès d'une carte de l'atelier depuis la Cité Akwaba : recherche d'une case libre pour son panneau.
import { buildCity } from "@jeu/world/city.js";
import { occupancy, placementIssue } from "@jeu/world/placement.js";
import { cityWithout } from "@jeu/world/removal.js";

/**
 * Case libre de la Cité Akwaba pour le panneau d'accès d'une carte, la plus proche du point de départ de la ville :
 * mêmes règles que le jeu (client/src/world/dataMaps.js `withEntrances`) — ville sans les éléments retirés, éléments
 * placés par l'atelier, cases d'accès des autres cartes publiées, une case libre devant le panneau.
 */
export function freeEntranceTile(placements: any[], removals: string[], taken: [number, number][]): [number, number] | null {
  const city = cityWithout(buildCity(), removals).zone;
  const occ = occupancy(city);
  const W = city.map[0].length, H = city.map.length;
  const used = new Set(taken.map(([x, y]) => `${x},${y}`));
  const near = (x: number, y: number) => taken.some(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y) <= 1);
  const solid = (x: number, y: number) => x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1 || !!occ.grid.solid[y * occ.grid.w + x];
  const [sx, sy] = city.spawns?.default ?? [W >> 1, H >> 1];
  let best: [number, number] | null = null, bestD = Infinity;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const d = Math.abs(x - sx) + Math.abs(y - sy);
    if (d >= bestD || used.has(`${x},${y}`) || near(x, y)) continue;
    if (placementIssue(city, occ, { family: "prop", x, y, w: 1, h: 1, facing: "S" }, placements)) continue;
    if (![[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dx, dy]) => !solid(x + dx, y + dy))) continue;
    best = [x, y]; bestD = d;
  }
  return best;
}
