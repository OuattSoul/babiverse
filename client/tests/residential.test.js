import { describe, expect, it } from 'vitest';
import CITY from '../../shared/city.json';
import { buildCity } from '../src/world/city.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { freeLots, homeBuildings, lotOrigin, lotSelectables, LOTS_PER_BLOCK, RESIDENTIAL, residentialRect } from '../src/world/residential.js';
import { buildSelectables } from '../src/world/selectables.js';
import { describeSelection } from '../src/world/selection.js';
import { exitSpawnOf, interiorIdOf } from '../src/world/interiors.js';
import { ZONES } from '../src/world/zones.js';

const ROAD = new Set(['=', '-', '|', '+', '_']);
const home = (slot, extra = {}) => {
  const [x, y] = lotOrigin(slot);
  return { slot, x, y, template: RESIDENTIAL.template, facing: RESIDENTIAL.facing, owner: `J${slot}`, mine: false, ...extra };
};

describe('lotissement : géométrie (identique au serveur, services/homes.py)', () => {
  it('64×64 cases : 1 024 emplacements de 2×2 distincts, dans la zone', () => {
    expect(LOTS_PER_BLOCK).toBe(1024);
    const r = residentialRect(1);
    const seen = new Set();
    for (let n = 0; n < LOTS_PER_BLOCK; n++) {
      const [x, y] = lotOrigin(n);
      expect(x >= r.x0 && x + 1 <= r.x1 && y >= r.y0 && y + 1 <= r.y1).toBe(true);
      seen.add(`${x},${y}`);
    }
    expect(seen.size).toBe(1024);
    expect(lotOrigin(0)).toEqual([RESIDENTIAL.x, RESIDENTIAL.y]);
    expect(lotOrigin(33)).toEqual([RESIDENTIAL.x + 2, RESIDENTIAL.y + 2]);
  });

  it('le bloc suivant prolonge la zone vers le sud', () => {
    expect(lotOrigin(1024)).toEqual([RESIDENTIAL.x, RESIDENTIAL.y + RESIDENTIAL.h]);
    expect(residentialRect(2).y1).toBe(RESIDENTIAL.y + 2 * RESIDENTIAL.h - 1);
  });
});

describe('lotissement dans la ville', () => {
  it('ni route, ni bâtiment, ni décor solide dans la zone', () => {
    const city = buildCity();
    const grid = buildGrid(city);
    const r = residentialRect(1);
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        expect(ROAD.has(city.map[y][x]), `${x},${y}`).toBe(false);
        expect(isSolid(grid, x, y), `${x},${y}`).toBe(false);
      }
    }
    for (const p of CITY.plots) {
      const overlaps = p.x <= r.x1 && r.x0 <= p.x + p.w - 1 && p.y <= r.y1 && r.y0 <= p.y + p.h - 1;
      expect(overlaps, p.id).toBe(false);
    }
  });

  it("l'ouverture d'un bloc agrandit la carte sans déplacer le reste", () => {
    const one = buildCity();
    const two = buildCity({ residentialBlocks: 2 });
    expect(two.residential.blocks).toBe(2);
    expect(two.map.length).toBe(one.map.length + RESIDENTIAL.h);
    // Tout ce qui existait (hors enceinte sud et routes prolongées) est inchangé.
    for (let y = 1; y < one.map.length - 1; y++) expect(two.map[y].slice(0, one.map[0].length - 1)).toBe(one.map[y].slice(0, -1));
  });
});

describe('maisons et emplacements libres', () => {
  it("les emplacements occupés n'affichent pas de « + »", () => {
    const homes = [home(0, { mine: true }), home(5)];
    const lots = freeLots(1, homes);
    expect(lots.length).toBe(1022);
    expect(lots.some((l) => l.slot === 0 || l.slot === 5)).toBe(false);
    expect(freeLots(2, homes).length).toBe(2046);
  });

  it('une maison occupe exactement son emplacement de 2×2, à la position enregistrée', () => {
    const [b] = homeBuildings([home(7, { mine: true })], CITY.player_buildings);
    const [x, y] = lotOrigin(7);
    expect({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 }).toEqual({ x0: x, y0: y, x1: x + 1, y1: y + 1 });
    expect(b.name).toBe('Ma maison');
    expect(homeBuildings([home(8)], CITY.player_buildings)[0].name).toBe('Maison de J8');
  });

  it("« Chez moi » : seule ma maison mène au studio, la ville n'a plus de bâtiment « Chez moi »", () => {
    const [mine, other] = homeBuildings([home(3, { mine: true }), home(4)], CITY.player_buildings);
    expect(interiorIdOf(mine)).toBe('maison');
    expect(exitSpawnOf(mine.zone)).toBe(ZONES.maison.interactables.find((i) => i.id === 'sortie_maison').target.spawn);
    expect(interiorIdOf(other)).toBe('int_home_4');
    expect(buildCity().buildings.some((b) => b.id === 'maison' || b.zone === 'maison')).toBe(false);
  });

  it("fiches : ma maison, celle d'un voisin, un emplacement libre", () => {
    const city = buildCity();
    const homes = homeBuildings([home(0, { mine: true }), home(1)], CITY.player_buildings);
    const sel = buildSelectables(city, { playerBuildings: homes });
    const ctx = { store: { state: { business: {} } }, actions: {} };
    const mineSheet = describeSelection(sel.find((s) => s.id === 'bld_home_0'), ctx, new Map());
    expect(mineSheet.title).toBe('Ma maison');
    expect(mineSheet.facts).toEqual([['Propriétaire', 'Toi']]);
    const other = describeSelection(sel.find((s) => s.id === 'bld_home_1'), ctx, new Map());
    expect(other.facts).toEqual([['Propriétaire', 'J1']]);
    const [lot] = lotSelectables(freeLots(1, [home(0), home(1)]));
    const free = describeSelection(lot, ctx, new Map());
    expect(free.title).toBe('Emplacement libre');
    expect(free.actions).toEqual([]);
  });
});
