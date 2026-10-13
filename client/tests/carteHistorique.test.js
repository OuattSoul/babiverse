// Non-régression de la carte historique (Cité Akwaba et ses intérieurs).
//
// Référence figée le 2026-10-13, AVANT la migration vers le registre de cartes (world/maps.js) : l'instantané
// (__snapshots__/carteHistorique.test.js.snap) et les valeurs explicites ci-dessous décrivent la carte telle que le
// jeu la construisait. Ils ne doivent jamais être régénérés pour « faire passer » un changement : une différence
// signifie que des coordonnées, des collisions ou des interactions ont bougé.
import { afterEach, describe, expect, it } from 'vitest';
import { cityWithout } from '../src/world/removal.js';
import { buildCity } from '../src/world/city.js';
import { buildGrid } from '../src/world/grid.js';
import { buildSelectables } from '../src/world/selectables.js';
import { setCityDecorator, setResidentialBlocks, START_ZONE, ZONES, zoneById } from '../src/world/zones.js';

/** Grille de collision lisible : X = solide et opaque, o = solide seulement, . = praticable. */
function gridRows(zone) {
  const g = buildGrid(zone);
  return Array.from({ length: g.h }, (_, y) => Array.from({ length: g.w }, (_, x) => {
    const i = y * g.w + x;
    return g.opaque[i] ? 'X' : g.solid[i] ? 'o' : '.';
  }).join(''));
}

/** Tout ce que le rendu, les collisions et les interactions lisent dans une zone. */
const fiche = (zone) => ({ zone, grid: gridRows(zone), selectables: buildSelectables(zone) });

const HISTORIC_IDS = ['quartier', 'maison', 'epicerie', 'int_voisin_nord', 'int_maquis', 'int_depot', 'int_kouassi', 'int_voisin_sud',
  'int_couture', 'int_pharmacie', 'int_transfert', 'int_bamba', 'int_voisin_g'];

afterEach(() => setCityDecorator(null));

describe('carte historique : valeurs figées', () => {
  it('mêmes zones, même zone de départ', () => {
    expect(Object.keys(ZONES)).toEqual(HISTORIC_IDS);
    expect(START_ZONE).toBe('maison');
  });

  it('même taille de ville (origine fixe, croissance vers le sud)', () => {
    const q = ZONES.quartier;
    expect([q.map[0].length, q.map.length]).toEqual([108, 105]);
    const q2 = buildCity({ residentialBlocks: 2 });
    expect([q2.map[0].length, q2.map.length]).toEqual([108, 169]);
    expect(q2.map.slice(0, 104)).toEqual(q.map.slice(0, 104)); // rien ne bouge au nord du nouveau bloc
  });

  it('mêmes portes, points d’apparition et lotissement', () => {
    const q = ZONES.quartier;
    const doors = Object.fromEntries(q.interactables.filter((i) => i.type === 'door').map((i) => [i.id, i.tile]));
    expect(doors).toEqual({
      door_voisin_nord: [7, 10], door_epicerie: [12, 10], door_maquis: [25, 10], door_depot: [32, 10],
      door_kouassi: [5, 25], door_voisin_sud: [12, 25], door_couture: [24, 25], door_pharmacie: [28, 25],
      door_transfert: [34, 25], door_bamba: [46, 25], door_voisin_g: [4, 31],
    });
    expect(q.spawns).toEqual({
      default: [6, 12], from_maison: [6, 12], from_voisin_nord: [7, 11], from_epicerie: [12, 11], from_maquis: [25, 11],
      from_depot: [32, 11], from_kouassi: [5, 26], from_voisin_sud: [12, 26], from_couture: [24, 26], from_pharmacie: [28, 26],
      from_transfert: [34, 26], from_bamba: [46, 26], from_voisin_g: [4, 30],
    });
    expect([q.residential.x, q.residential.y, q.residential.w, q.residential.h]).toEqual([43, 40, 64, 64]);
    expect({ b: q.buildings.length, props: q.props.length, it: q.interactables.length, npcs: q.npcs.length })
      .toEqual({ b: 11, props: 87, it: 33, npcs: 10 });
  });
});

describe('carte historique : instantané complet', () => {
  it('ville (1 bloc de lotissement) : carte, grille de collision, volumes cliquables, données', () => {
    expect(fiche(ZONES.quartier)).toMatchSnapshot();
  });

  it('ville agrandie (2 blocs) : identique hormis le bloc ajouté', () => {
    const q2 = buildCity({ residentialBlocks: 2 });
    expect({ map: q2.map, residential: q2.residential, grid: gridRows(q2) }).toMatchSnapshot();
  });

  for (const id of HISTORIC_IDS.slice(1)) {
    it(`intérieur ${id}`, () => expect(fiche(ZONES[id])).toMatchSnapshot());
  }

  it("intérieur d'une construction de joueur (int_pb_*)", () => {
    const zone = zoneById('int_pb_P06', [{ id: 'pb_P06', name: 'Chez Awa', template: 'boutique' }]);
    expect(fiche(zone)).toMatchSnapshot();
    expect(zoneById('int_pb_P07', [{ id: 'pb_P06', name: 'Chez Awa', template: 'boutique' }])).toBeNull();
    expect(zoneById('zone_inconnue')).toBeNull();
  });
});

describe('carte historique : chemins dynamiques conservés', () => {
  it('le décorateur de l’atelier s’applique à la ville puis se retire sans trace', () => {
    const before = ZONES.quartier;
    setCityDecorator((zone) => cityWithout(zone, ['bld:pharmacie']).zone);
    expect(ZONES.quartier.buildings.some((b) => b.id === 'pharmacie')).toBe(false);
    expect(ZONES.quartier.id).toBe('quartier');
    setCityDecorator(null);
    expect(ZONES.quartier).toEqual(before);
  });

  it('l’ouverture d’un bloc de lotissement régénère la ville en gardant le décorateur', () => {
    setCityDecorator((zone) => cityWithout(zone, ['bld:pharmacie']).zone);
    expect(setResidentialBlocks(1)).toBe(false); // pas de changement : même bloc
    expect(setResidentialBlocks(2)).toBe(true);
    expect(ZONES.quartier.map.length).toBe(169);
    expect(ZONES.quartier.buildings.some((b) => b.id === 'pharmacie')).toBe(false);
    // Retour à l'état de départ pour les autres tests (le registre ne revient pas en arrière tout seul).
    ZONES.quartier = buildCity();
  });
});
