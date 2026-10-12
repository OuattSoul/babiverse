import { afterEach, describe, expect, it } from 'vitest';
import { applyPack, resetPack } from '../src/atelier/pack.js';
import { cityWithPlacements } from '../src/atelier/world.js';
import { buildCity } from '../src/world/city.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { occupancy, placementIssue } from '../src/world/placement.js';
import { cityElements, cityWithout, elementAt } from '../src/world/removal.js';
import { ZONES } from '../src/world/zones.js';

const city = buildCity();
const elements = cityElements(city);
const byKey = new Map(elements.map((e) => [e.key, e]));
const PACK = { format: 'babiverse-game-pack', format_version: 1, parts: {}, wardrobe: { bodies: [], slots: {} }, inhabitants: [], kits: {} };

describe("éléments d'origine de la ville", () => {
  it('liste bâtiments, végétation et mobilier avec une clé stable', () => {
    expect(byKey.get('bld:pharmacie')).toMatchObject({ kind: 'building', label: 'Pharmacie', protected: null });
    expect(elements.some((e) => e.kind === 'tree' && e.label === 'Manguier')).toBe(true);
    expect(elements.some((e) => e.key.startsWith('prop:lamp:'))).toBe(true);
    expect(elementAt(elements, 28, 24).key).toBe('bld:pharmacie');
  });

  it('protège ce dont le jeu a besoin', () => {
    expect(byKey.get('bld:epicerie').protected).toMatch(/intérieur/);
    expect(byKey.get('bld:depot').protected).toMatch(/livreur/);
    expect(byKey.get('bld:maquis').protected).toMatch(/livraisons/);
    expect(byKey.get('bld:kouassi').protected).toMatch(/livraisons/);
    for (const kind of ['kiosk', 'garba_stand', 'billboard', 'plotsign']) {
      expect(elements.filter((e) => e.key.startsWith(`prop:${kind}:`)).every((e) => e.protected)).toBe(true);
    }
  });

  it('retire un bâtiment, un arbre et un banc ; refuse un élément protégé ou inconnu', () => {
    const tree = elements.find((e) => e.kind === 'tree');
    const bench = elements.find((e) => e.key.startsWith('prop:bench:'));
    const { zone, removed, refused } = cityWithout(city, ['bld:pharmacie', tree.key, bench.key, 'bld:epicerie', 'bld:inexistant']);
    expect(removed).toEqual(['bld:pharmacie', tree.key, bench.key]);
    expect(refused.map((r) => r.key)).toEqual(['bld:epicerie', 'bld:inexistant']);
    expect(zone.buildings.some((b) => b.id === 'pharmacie')).toBe(false);
    expect(zone.buildings.some((b) => b.id === 'epicerie')).toBe(true);
    expect(zone.interactables.some((i) => i.id === 'door_pharmacie')).toBe(false);
    expect(zone.props.some((p) => `prop:${p.kind}:${p.tile[0]},${p.tile[1]}` === bench.key)).toBe(false);
    const grid = buildGrid(zone);
    const r = byKey.get('bld:pharmacie').rect;
    expect(isSolid(grid, r.x0, r.y0)).toBe(false);
    expect(isSolid(grid, tree.rect.x0, tree.rect.y0)).toBe(false);
    expect(city.buildings.some((b) => b.id === 'pharmacie')).toBe(true); // ville d'origine intacte
  });

  it("la place libérée peut accueillir un élément de l'atelier", () => {
    const r = byKey.get('bld:pharmacie').rect;
    const p = { id: 'atl_rep', family: 'building', x: r.x0, y: r.y0, w: 2, h: 2, facing: 'S', name: 'Clinique', render: {} };
    expect(placementIssue(city, occupancy(city), p)).toMatch(/Occupé/);
    const cleared = cityWithout(city, ['bld:pharmacie']).zone;
    expect(placementIssue(cleared, occupancy(cleared), p)).toBeNull();
    expect(cityWithPlacements(cleared, [p]).skipped).toEqual([]);
  });
});

describe('retraits appliqués par le pack', () => {
  afterEach(resetPack);

  it('la ville du jeu perd les éléments retirés, et les retrouve sans pack', () => {
    applyPack({ ...PACK, placements: [], removals: ['bld:couture', 'bld:epicerie'] });
    expect(ZONES.quartier.buildings.some((b) => b.id === 'couture')).toBe(false);
    expect(ZONES.quartier.buildings.some((b) => b.id === 'epicerie')).toBe(true);
    expect(ZONES.quartier.atelier.refused).toEqual([{ key: 'bld:epicerie', reason: expect.stringMatching(/Protégé/) }]);
    resetPack();
    expect(ZONES.quartier.buildings.some((b) => b.id === 'couture')).toBe(true);
  });
});
