import { afterEach, describe, expect, it } from 'vitest';
import { applyPack, resetPack } from '../src/atelier/pack.js';
import { cityWithPlacements, doorOf } from '../src/atelier/world.js';
import { buildCity } from '../src/world/city.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { occupancy, placementIssue } from '../src/world/placement.js';
import { buildSelectables } from '../src/world/selectables.js';
import { ZONES } from '../src/world/zones.js';

const city = buildCity();
const occ = occupancy(city);

/** Premier rectangle libre (balayage de la carte) pour un élément donné. */
function freeSpot(p, others = []) {
  for (let y = 1; y < city.map.length - p.h; y++) {
    for (let x = 1; x < city.map[0].length - p.w; x++) {
      const c = { ...p, x, y };
      if (!placementIssue(city, occ, c, others)) return c;
    }
  }
  return null;
}

const INTERIOR = {
  name: 'Boutique', materials: { floor: '#d8b98a', wall: '#f1e7d6' },
  interior: {
    width: 6, depth: 5, rooms: [{ id: 'shop', name: 'Boutique', type: 'shop', x: 0, y: 0, w: 6, d: 5 }],
    doors: [{ id: 'e', cell: [2, 4], side: 'S', connects: ['shop', 'exterior'] }],
    furniture: [{ id: 'lit', item: 'bed', x: 0, y: 0, w: 2, d: 3, interactive: true, action: 'sleep' }], spawn: [2, 3], forbidden: [],
  },
  furniture: { bed: { label: 'Lit', shape: 'bed', color: '#8e6fb5', height_px: 7, actions: ['sleep'] } },
};

describe('règles de placement (partagées avec l’atelier)', () => {
  it('refuse routes, parcelles des joueurs, lotissement, bâtiments et bords', () => {
    const at = (x, y, w = 2, h = 2) => placementIssue(city, occ, { family: 'building', x, y, w, h, facing: 'S' });
    expect(at(18, 12)).toMatch(/route/); // boulevard de l'Ouest × avenue
    const plot = city.plots[0];
    expect(at(plot.x, plot.y, 1, 1)).toMatch(/parcelle/);
    expect(at(city.residential.x + 2, city.residential.y + 2)).toMatch(/lotissement/);
    const b = city.buildings[0];
    expect(at(b.x0, b.y0)).toMatch(/Occupé/);
    expect(at(0, 0)).toMatch(/Hors/);
  });

  it('trouve des emplacements libres, sans chevauchement entre éléments', () => {
    const a = freeSpot({ family: 'building', w: 2, h: 2, facing: 'S', name: 'A' });
    expect(a).not.toBeNull();
    expect(placementIssue(city, occ, { ...a, name: 'B' }, [a])).toMatch(/Chevauche « A »/);
    // une surface sous un bâtiment, c'est permis
    expect(placementIssue(city, occ, { family: 'surface', x: a.x, y: a.y, w: 2, h: 2 }, [a])).toBeNull();
  });
});

describe('placements de l’atelier dans la ville', () => {
  afterEach(resetPack);

  it('un bâtiment devient solide, avec sa porte, sa fiche et son intérieur', () => {
    const spot = freeSpot({ family: 'building', w: 3, h: 2, facing: 'S' });
    const p = { id: 'atl_test1', family: 'building', ...spot, name: 'Clinique', render: { floors: 2, door: 1, description: 'Soins', interior: INTERIOR } };
    const { zone, interiors, skipped } = cityWithPlacements(city, [p]);
    expect(skipped).toEqual([]);
    const grid = buildGrid(zone);
    expect(isSolid(grid, p.x, p.y)).toBe(true);
    expect(doorOf(p)).toEqual([p.x + 1, p.y + 1]);
    const door = zone.interactables.find((i) => i.id === 'door_atl_test1');
    expect(door.target).toEqual({ zone: 'int_atl_test1', spawn: 'entree' });
    expect(zone.spawns.from_atl_test1).toEqual([p.x + 1, p.y + 2]);
    expect(isSolid(grid, ...zone.spawns.from_atl_test1)).toBe(false);
    // intérieur public : le lit n'est qu'une fiche (sieste réservée à « Chez moi »), la porte ramène devant
    const inside = interiors.int_atl_test1;
    expect(inside.interactables.some((i) => i.type === 'bed')).toBe(false);
    expect(inside.interactables.find((i) => i.type === 'door').target).toEqual({ zone: 'quartier', spawn: 'from_atl_test1' });
    const sel = buildSelectables(zone).find((s) => s.id === 'bld_atl_test1');
    expect(sel.attached).toContain('door_atl_test1');
    expect(city.map[p.y][p.x]).not.toBe('W'); // la ville d'origine n'est pas modifiée
  });

  it('objets, véhicules et surfaces deviennent des décors ; un placement invalide est ignoré', () => {
    const tree = { id: 'atl_t', family: 'prop', ...freeSpot({ family: 'prop', w: 1, h: 1 }), facing: 'S', name: 'Arbre', render: { shape: 'tree' } };
    const lake = { id: 'atl_l', family: 'surface', ...freeSpot({ family: 'surface', w: 3, h: 3 }, [tree]), facing: 'S', name: 'Bassin', render: { walkable: false } };
    const bad = { id: 'atl_bad', family: 'vehicle', x: 18, y: 12, w: 1, h: 2, facing: 'S', name: 'Taxi', render: { kind: 'taxi' } };
    const { zone, skipped } = cityWithPlacements(city, [tree, lake, bad]);
    expect(zone.props.find((d) => d.kind === 'atl_prop')).toMatchObject({ tile: [tree.x, tree.y], solid: true });
    expect(zone.props.find((d) => d.kind === 'atl_surface')).toMatchObject({ w: 3, h: 3, solid: true });
    expect(skipped).toEqual([{ id: 'atl_bad', reason: expect.stringMatching(/route/) }]);
  });

  it('le pack installe les placements et les intérieurs ; la ville d’origine revient sans pack', () => {
    const spot = freeSpot({ family: 'building', w: 2, h: 2, facing: 'S' });
    const p = { id: 'atl_pk', family: 'building', ...spot, name: 'Boutique de test', render: { shop: { sign_text: 'TEST' }, interior: INTERIOR } };
    const before = ZONES.quartier;
    applyPack({ format: 'babiverse-game-pack', format_version: 1, parts: {}, wardrobe: { bodies: [], slots: {} }, inhabitants: [], placements: [p], kits: {} });
    expect(ZONES.quartier.buildings.some((b) => b.id === 'atl_pk' && b.category === 'shop')).toBe(true);
    expect(ZONES.int_atl_pk.name).toBe('Boutique de test');
    resetPack();
    expect(ZONES.quartier.buildings.some((b) => b.id === 'atl_pk')).toBe(false);
    expect(ZONES.int_atl_pk).toBeUndefined();
    expect(ZONES.quartier.map).toEqual(before.map);
  });
});
