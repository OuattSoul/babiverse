import { describe, expect, it } from 'vitest';
import { BUILDINGS, PLAYER_BUILDINGS } from '../src/world/city.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { INTERIOR_KINDS, interiorIdOf, interiorZone } from '../src/world/interiors.js';
import { findPath } from '../src/world/pathfinding.js';
import { buildSelectables } from '../src/world/selectables.js';
import { ZONES, zoneById } from '../src/world/zones.js';

const BODY = { hw: 7, hh: 5 };
const c = ([tx, ty]) => ({ x: (tx + 0.5) * 32, y: (ty + 0.5) * 32 });
const city = ZONES.quartier;
const cityGrid = buildGrid(city);

describe('bâtiments de 2×2 cases', () => {
  it('tous les bâtiments de la ville et des joueurs occupent 2×2 cases', () => {
    for (const b of city.buildings) {
      expect([b.x1 - b.x0 + 1, b.y1 - b.y0 + 1], b.id).toEqual([2, 2]);
    }
    for (const [id, t] of Object.entries(PLAYER_BUILDINGS)) {
      expect(t.facade, id).toHaveLength(2);
      expect(t.facade, id).toContain('D');
      expect(INTERIOR_KINDS, id).toContain(t.interior);
    }
  });

  it('la porte de chaque bâtiment donne sur une case libre', () => {
    for (const b of city.buildings) {
      const [x, y] = city.spawns[`from_${b.id}`];
      expect(isSolid(cityGrid, x, y), b.id).toBe(false);
    }
  });
});

describe('intérieurs', () => {
  it('chaque bâtiment a une porte vers un intérieur existant', () => {
    for (const b of BUILDINGS) {
      const door = city.interactables.find((i) => i.id === `door_${b.id}`);
      expect(door?.type, b.id).toBe('door');
      expect(door.target.zone).toBe(interiorIdOf(b));
      const zone = ZONES[door.target.zone];
      expect(zone, b.id).toBeDefined();
      expect(zone.spawns[door.target.spawn], b.id).toBeDefined();
    }
  });

  it('dans un intérieur, on apparaît près de la porte qui ramène devant le bâtiment', () => {
    for (const b of BUILDINGS.filter((x) => !x.zone)) {
      const zone = ZONES[interiorIdOf(b)];
      const grid = buildGrid(zone);
      const exit = zone.interactables.find((i) => i.type === 'door');
      expect(exit.target).toEqual({ zone: 'quartier', spawn: `from_${b.id}` });
      expect(city.spawns[exit.target.spawn]).toBeDefined();
      const [sx, sy] = zone.spawns.entree;
      expect(isSolid(grid, sx, sy)).toBe(false);
      expect(Math.hypot(sx - exit.tile[0], sy - exit.tile[1])).toBeLessThanOrEqual(1);
      // Le meuble « Regarder » est accessible depuis l'entrée.
      for (const it of zone.interactables.filter((i) => i.type === 'info')) {
        const path = findPath(grid, c(zone.spawns.entree), c(it.tile), BODY);
        expect(path, `${b.id} ${it.id}`).not.toBeNull();
      }
    }
  });

  it("toucher un bâtiment le sélectionne en entier (il porte l'intérieur où entrer)", () => {
    const sel = buildSelectables(city);
    for (const b of city.buildings) {
      const s = sel.find((x) => x.id === `bld_${b.id}`);
      expect(s.building.id).toBe(b.id);
      expect(s.attached).toContain(`door_${b.id}`);
    }
  });

  it("intérieur d'une construction de joueur, généré depuis l'état serveur", () => {
    const pb = { id: 'pb_P06', name: 'Chez Awa', template: 'boutique' };
    const zone = zoneById('int_pb_P06', [pb]);
    expect(zone.id).toBe('int_pb_P06');
    expect(zone.name).toBe('Chez Awa');
    expect(zone.map.join('')).toContain('Q'); // boutique : comptoir
    expect(zone.interactables[0].target).toEqual({ zone: 'quartier', spawn: 'from_pb_P06' });
    expect(zoneById('int_pb_P07', [pb])).toBeNull();
  });

  it('tous les types d\'intérieur produisent une zone valide', () => {
    for (const kind of INTERIOR_KINDS) {
      const zone = interiorZone({ id: `test_${kind}`, name: kind, interior: kind, info: 'x' });
      expect(() => buildGrid(zone)).not.toThrow();
      expect(zone.interactables.length).toBe(2);
    }
  });
});
