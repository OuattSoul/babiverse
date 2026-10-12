import { describe, expect, it } from 'vitest';
import { buildCity, canPlaceBuilding, cityExtent, doorTile, H, W } from '../src/world/city.js';
import { buildGrid, isSolid, TILE } from '../src/world/grid.js';
import { findPath } from '../src/world/pathfinding.js';

const city = buildCity();
const grid = buildGrid(city);
const BODY = { hw: 7, hh: 5 };
const c = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });
const solidAt = (x, y) => isSolid(grid, x, y);
const ROAD = new Set(['=', '-', '|', '+', '_']);
const overlap = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
const plotRect = (p) => ({ x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1 });

/** Cases praticables atteignables depuis le point d'apparition (parcours en largeur). */
function reachable() {
  const [sx, sy] = city.spawns.default;
  const seen = new Set([`${sx},${sy}`]);
  const queue = [[sx, sy]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`;
      if (!seen.has(k) && !solidAt(x + dx, y + dy)) { seen.add(k); queue.push([x + dx, y + dy]); }
    }
  }
  return seen;
}
const REACH = reachable();

describe('carte sans taille fixe', () => {
  it('la carte englobe tout son contenu, avec son enceinte', () => {
    expect(city.map.length).toBe(H);
    expect(city.map[0].length).toBe(W);
    const inside = (x, y) => x >= 1 && y >= 1 && x <= W - 2 && y <= H - 2;
    for (const b of city.buildings) expect(inside(b.x1, b.y1), b.id).toBe(true);
    for (const p of city.plots) expect(inside(p.x + p.w - 1, p.y + p.h - 1), p.id).toBe(true);
    for (const p of city.props) expect(inside(p.tile[0] + (p.w || 1) - 1, p.tile[1] + (p.h || 1) - 1), p.kind).toBe(true);
  });

  it('un élément placé au-delà du bord agrandit la carte', () => {
    const base = cityExtent([{ x0: 1, y0: 1, x1: 54, y1: 38 }]);
    expect(base).toEqual({ w: 56, h: 40 });
    expect(cityExtent([{ x0: 1, y0: 1, x1: 54, y1: 38 }, { x0: 120, y0: 70, x1: 124, y1: 71 }])).toEqual({ w: 126, h: 73 });
    expect(cityExtent([{ x0: 1, y0: 1, x1: 54, y1: 38 }], 3)).toEqual({ w: 59, h: 43 });
  });

  it("refuse les coordonnées sur ou avant l'enceinte", () => {
    expect(() => cityExtent([{ x0: 0, y0: 4, x1: 2, y1: 5 }])).toThrow(/hors carte/);
  });
});

describe('échelle des bâtiments', () => {
  it('tous les bâtiments sont compacts (≤ 5 cases de large, 2 de profondeur)', () => {
    for (const b of city.buildings) {
      expect(b.x1 - b.x0 + 1, b.id).toBeLessThanOrEqual(5);
      expect(b.y1 - b.y0 + 1, b.id).toBe(2);
    }
  });

  it('les bâtiments occupent une petite part de la ville', () => {
    const area = city.buildings.reduce((n, b) => n + (b.x1 - b.x0 + 1) * (b.y1 - b.y0 + 1), 0);
    expect(area / (W * H)).toBeLessThan(0.06);
  });

  it('les bâtiments ne se chevauchent pas et ne touchent pas les routes', () => {
    city.buildings.forEach((a, i) => {
      city.buildings.slice(i + 1).forEach((b) => expect(overlap(a, b), `${a.id}/${b.id}`).toBe(false));
      for (let y = a.y0; y <= a.y1; y++) for (let x = a.x0; x <= a.x1; x++) expect(ROAD.has(city.map[y][x]), a.id).toBe(false);
    });
  });

  it('chaque porte s\'ouvre sur une case praticable reliée au réseau', () => {
    for (const b of city.buildings) {
      const [x, y] = doorTile(b);
      const fy = b.facing === 'S' ? y + 1 : y - 1;
      expect(REACH.has(`${x},${fy}`), b.id).toBe(true);
    }
  });
});

describe('réseau routier', () => {
  it('toutes les routes et tous les trottoirs sont reliés', () => {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (ROAD.has(city.map[y][x]) && !solidAt(x, y)) expect(REACH.has(`${x},${y}`), `${x},${y}`).toBe(true);
      }
    }
  });

  it('les carrefours ont des passages piétons', () => {
    const crossings = city.map.join('').split('').filter((ch) => ch === '+').length;
    expect(crossings).toBe(H_ROADS_COUNT * V_ROADS_COUNT * 4 * 3);
  });

  it('la majorité de la ville praticable est accessible depuis la rue', () => {
    let walkable = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!solidAt(x, y)) walkable++;
    expect(REACH.size / walkable).toBeGreaterThan(0.98);
  });
});
const H_ROADS_COUNT = city.roads.horizontal.length;
const V_ROADS_COUNT = city.roads.vertical.length;

describe('parcelles des joueurs', () => {
  it('au moins 10 parcelles libres, séparées des bâtiments publics et des routes', () => {
    expect(city.plots.length).toBeGreaterThanOrEqual(10);
    for (const p of city.plots) {
      const r = plotRect(p);
      for (const b of city.buildings) expect(overlap(r, b), `${p.id}/${b.id}`).toBe(false);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) expect(city.map[y][x], `${p.id} ${x},${y}`).toBe('l');
    }
  });

  it('les parcelles ne se chevauchent pas et sont espacées', () => {
    city.plots.forEach((a, i) => city.plots.slice(i + 1).forEach((b) => {
      const ra = plotRect(a);
      const grown = { x0: ra.x0 - 1, y0: ra.y0 - 1, x1: ra.x1 + 1, y1: ra.y1 + 1 };
      expect(overlap(grown, plotRect(b)), `${a.id}/${b.id}`).toBe(false);
    }));
  });

  it('chaque parcelle est accessible depuis la rue, par son côté d\'accès', () => {
    for (const p of city.plots) {
      const fy = p.front === 'S' ? p.y + p.h : p.y - 1;
      let ok = false;
      for (let x = p.x; x < p.x + p.w; x++) if (REACH.has(`${x},${fy}`)) ok = true;
      expect(ok, p.id).toBe(true);
    }
  });

  it('validation de placement d\'un futur bâtiment de joueur', () => {
    const p = city.plots.find((x) => x.id === 'P04');
    const inside = { x0: p.x, y0: p.y + 1, x1: p.x + 2, y1: p.y + 2 };
    expect(canPlaceBuilding(city, inside, solidAt)).toEqual({ ok: true, plot: 'P04' });
    expect(canPlaceBuilding(city, { x0: p.x, y0: p.y + p.h - 1, x1: p.x + 2, y1: p.y + p.h }, solidAt).ok).toBe(false); // déborde
    expect(canPlaceBuilding(city, { x0: 18, y0: 20, x1: 20, y1: 21 }, solidAt)).toEqual({ ok: false, reason: 'hors_parcelle' });
    const [sx, sy] = city.props.find((x) => x.kind === 'plotsign' && x.plot === 'P04').tile;
    expect(canPlaceBuilding(city, { x0: sx, y0: sy - 1, x1: sx, y1: sy }, solidAt).reason).toBe('occupe');
  });
});

describe('mobilier urbain et commerces', () => {
  it('panneaux publicitaires, lampadaires, poteaux et commerces présents', () => {
    const kinds = (k) => city.props.filter((p) => p.kind === k).length;
    expect(kinds('billboard')).toBeGreaterThanOrEqual(4);
    expect(kinds('lamp')).toBeGreaterThanOrEqual(10);
    expect(kinds('pole')).toBeGreaterThanOrEqual(10);
    expect(kinds('bench') + kinds('bin')).toBeGreaterThanOrEqual(6);
    expect(city.buildings.filter((b) => b.sign).length).toBeGreaterThanOrEqual(5);
    for (const p of city.props.filter((x) => x.kind === 'billboard')) expect(p.slot).toBeTruthy();
  });

  it('aucun décor solide ne coupe un trottoir sur toute sa largeur', () => {
    // Un trottoir d'une case occupé par un poteau reste contournable par la chaussée voisine.
    for (const p of city.props.filter((x) => x.solid && ['pole', 'lamp', 'stop', 'roadsign'].includes(x.kind))) {
      const [x, y] = p.tile;
      const around = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !solidAt(x + dx, y + dy)).length;
      expect(around, `${p.kind} ${x},${y}`).toBeGreaterThanOrEqual(2);
    }
  });

  it('les lieux de la tranche jouable restent accessibles à pied', () => {
    for (const id of ['door_epicerie', 'kiosk', 'drop_maquis', 'drop_epicerie', 'drop_sud_1', 'drop_sud_2']) {
      const it = city.interactables.find((i) => i.id === id);
      const [x, y] = it.tile;
      const path = findPath(grid, c(...city.spawns.default), c(x, y), BODY);
      expect(path, id).not.toBeNull();
    }
  });
});
