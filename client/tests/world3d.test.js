import { describe, expect, it } from 'vitest';
import { angleDelta, inputToWorld, orbitPosition, panDelta, ZOOM, zoomProgress } from '../src/engine3d/cameraMath.js';
import { buildGrid, rectCollides, TILE } from '../src/world/grid.js';
import { clearSegment, findPath, nearestWalkable } from '../src/world/pathfinding.js';
import { findBuildings, wallRects } from '../src/world/structures.js';
import { ZONES } from '../src/world/zones.js';

const BODY = { hw: 7, hh: 5 };
const c = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
const quartier = buildGrid(ZONES.quartier);

describe('recherche de chemin', () => {
  const zone = ZONES.quartier;
  const kouassi = zone.buildings.find((b) => b.id === 'kouassi');
  const [mx, my] = zone.interactables.find((i) => i.id === 'door_kouassi').tile;
  const [sx, sy] = zone.spawns.default;
  const valid = (from, path) => {
    let prev = from;
    for (const p of path) {
      expect(clearSegment(quartier, prev, p, BODY)).toBe(true);
      expect(rectCollides(quartier, p.x, p.y, BODY.hw, BODY.hh)).toBe(false);
      prev = p;
    }
  };

  it('contourne la maison pour aller derrière', () => {
    const goal = c(kouassi.x0 + 1, kouassi.y0 - 2);
    const path = findPath(quartier, c(mx, my + 1), goal, BODY);
    expect(path).not.toBeNull();
    valid(c(mx, my + 1), path);
    expect(path.at(-1)).toEqual(goal);
  });

  // Bâtiments de 2×2 : la porte est à un angle, la case libre la plus proche peut être devant ou à côté.
  const besideDoor = [c(mx, my + 1), c(mx + 1, my), c(mx - 1, my)];

  it('vise une case praticable contre la porte quand la cible est le mur', () => {
    const path = findPath(quartier, c(sx, sy), c(mx, my), BODY);
    expect(besideDoor).toContainEqual(path.at(-1));
  });

  it('ligne droite dans une cour dégagée', () => {
    const path = findPath(quartier, c(2, 22), c(12, 22), BODY);
    expect(path).toHaveLength(1);
  });

  it('les décors de plusieurs cases sont contournés', () => {
    const [tx, ty] = zone.props.find((p) => p.kind === 'garba_stand').tile;
    const path = findPath(quartier, c(tx - 2, ty), c(tx + 3, ty), BODY);
    valid(c(tx - 2, ty), path);
    expect(path.length).toBeGreaterThan(1);
  });

  it("case la plus proche d'un point dans un bâtiment", () => {
    const { tx, ty } = nearestWalkable(quartier, c(mx, my).x, c(mx, my).y);
    expect(besideDoor).toContainEqual(c(tx, ty));
  });

  it("traverse la ville d'un coin à l'autre sans chevaucher d'obstacle", () => {
    const path = findPath(quartier, c(2, 38), c(53, 1), BODY);
    expect(path).not.toBeNull();
    valid(c(2, 38), path);
  });
});

describe('structures des cartes', () => {
  it("détecte les bâtiments d'une carte dessinée à la main", () => {
    const map = ['#######', '#.rrr.#', '#.HDH.#', '#.....#', '#######'];
    expect(findBuildings(map)).toEqual([{ x0: 2, y0: 1, x1: 4, y1: 2, roof: 'r', facade: 'HDH' }]);
  });

  it('fusionne les murs en rectangles', () => {
    const rects = wallRects(ZONES.maison.map, 'w');
    const cells = rects.reduce((n, r) => n + (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1), 0);
    const expected = ZONES.maison.map.join('').split('').filter((ch) => ch === 'w').length;
    expect(cells).toBe(expected);
    expect(rects.length).toBeLessThan(8);
  });
});

describe('caméra orbitale', () => {
  it('yaw 0 : caméra au sud, au-dessus de la cible', () => {
    const p = orbitPosition({ x: 0, y: 0, z: 0 }, 0, Math.PI / 4, 10);
    expect(p.x).toBeCloseTo(0);
    expect(p.z).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
  });

  it("les commandes suivent l\'écran quelle que soit la rotation", () => {
    // Sans rotation : « haut de l'écran » = nord (z négatif).
    expect(inputToWorld(0, -1, 0).z).toBeCloseTo(-1);
    // Caméra tournée de 90° (à l'est, regard vers l'ouest) : « haut » = ouest.
    const w = inputToWorld(0, -1, Math.PI / 2);
    expect(w.x).toBeCloseTo(-1);
    expect(w.z).toBeCloseTo(0);
  });

  it("glisser vers la droite déplace la vue vers l\'ouest (la carte suit le doigt)", () => {
    expect(panDelta(100, 0, 0, 10, 800).x).toBeLessThan(0);
  });

  it('angle le plus court', () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
  });

  it("zoom : la ville se dézoome bien plus loin qu'un logement, vue d'ensemble comprise", () => {
    expect(ZOOM.outdoor.max).toBeGreaterThan(ZOOM.indoor.max * 2);
    expect(ZOOM.outdoor.overview).toBeGreaterThan(ZOOM.outdoor.default);
    expect(ZOOM.outdoor.overview).toBeLessThanOrEqual(ZOOM.outdoor.max);
  });

  it('avancement du zoom borné entre 0 et 1', () => {
    const r = { min: 5, max: 25 };
    expect(zoomProgress(5, r)).toBe(0);
    expect(zoomProgress(15, r)).toBeCloseTo(0.5);
    expect(zoomProgress(80, r)).toBe(1);
    expect(zoomProgress(1, r)).toBe(0);
  });
});
