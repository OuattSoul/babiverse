// Registre des cartes (world/maps.js) et migration de la carte historique vers le catalogue shared/maps.json.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCity } from '../src/world/city.js';
import { buildMap, catalogueErrors, catalogueZones, isGeneratedInterior, MAP_CATALOGUE, mapInfo, publishedMaps, START_MAP } from '../src/world/maps.js';
import { legacyZones, START_ZONE, WORLD_SOURCE, ZONES } from '../src/world/zones.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const withMap = (id, changes) => {
  const cat = clone(MAP_CATALOGUE);
  Object.assign(cat.maps.find((m) => m.id === id), changes);
  return cat;
};

describe('catalogue des cartes', () => {
  it('référence la carte historique : Abidjan › Cité Akwaba › quartier, maison, épicerie', () => {
    expect(catalogueErrors(MAP_CATALOGUE)).toEqual([]);
    expect(publishedMaps().map((m) => m.id)).toEqual(['quartier', 'maison', 'epicerie']);
    expect(START_MAP).toBe('maison');
    expect(START_ZONE).toBe('maison');
    expect(mapInfo('quartier')).toEqual({ id: 'quartier', name: 'Cité Akwaba', kind: 'outdoor', district: 'cite_akwaba', city: 'abidjan' });
    expect(mapInfo('int_maquis')).toEqual({ id: 'int_maquis', kind: 'interior', district: 'cite_akwaba', city: 'abidjan' });
    expect(mapInfo('inconnue')).toBeNull();
  });

  it('nom et identifiant du catalogue = ceux de la zone générée', () => {
    for (const m of publishedMaps()) {
      const zone = buildMap(m.id);
      expect([zone.id, zone.name]).toEqual([m.id, m.name]);
    }
  });

  it('même motif d’intérieurs générés que le serveur', () => {
    expect(MAP_CATALOGUE.generated_interiors.pattern).toBe('^int_[A-Za-z0-9_]{1,40}$');
    for (const id of ['int_maquis', 'int_pb_P03', 'int_home_12', 'int_atl_abc']) expect(isGeneratedInterior(id)).toBe(true);
    for (const id of ['int_', 'quartier', 'int_a b', null]) expect(isGeneratedInterior(id)).toBe(false);
  });

  it('refuse un catalogue incohérent', () => {
    const cases = [
      withMap('quartier', { status: 'disabled' }),                               // carte requise
      withMap('epicerie', { id: 'Epicerie' }),                                   // identifiant
      withMap('epicerie', { id: 'x'.repeat(33) }),                               // > Character.zone (32)
      withMap('epicerie', { id: 'int_marche' }),                                 // préfixe réservé
      withMap('epicerie', { id: 'maison' }),                                     // doublon
      withMap('epicerie', { district: 'cocody' }),                               // zone inconnue
      withMap('epicerie', { source: { type: 'generator', generator: 'eval' } }), // générateur inconnu
      withMap('epicerie', { source: { type: 'script', code: 'alert(1)' } }),     // aucun code
      withMap('maison', { status: 'draft' }),                                    // carte de départ non publiée
    ];
    for (const cat of cases) expect(catalogueErrors(cat)).not.toEqual([]);
    expect(catalogueErrors({ format: 'autre' })).toEqual(['format de catalogue inconnu']);
  });
});

describe('migration de la carte historique', () => {
  it('le jeu construit ses zones par le catalogue', () => {
    expect(WORLD_SOURCE).toBe('catalogue');
  });

  it('chemin du catalogue = ancien chemin, zone par zone et dans le même ordre', () => {
    const legacy = legacyZones();
    const fromCatalogue = catalogueZones();
    expect(Object.keys(fromCatalogue)).toEqual(Object.keys(legacy));
    expect(fromCatalogue).toEqual(legacy);
    expect(Object.keys(ZONES)).toEqual(Object.keys(legacy));
  });

  it('la ville agrandie par le serveur passe aussi par le catalogue, à l’identique', () => {
    for (const residentialBlocks of [1, 2, 3]) expect(buildMap('quartier', { residentialBlocks })).toEqual(buildCity({ residentialBlocks }));
  });

  it('une carte non publiée n’est pas construite, sans toucher aux autres', () => {
    const cat = withMap('epicerie', { status: 'disabled' });
    expect(buildMap('epicerie', {}, cat)).toBeNull();
    expect(mapInfo('epicerie', cat)).toBeNull();
    const zones = catalogueZones(cat);
    expect(zones.epicerie).toBeUndefined();
    expect(zones.quartier).toEqual(buildCity());
    expect(buildMap('inconnue')).toBeNull();
  });
});

describe('retour arrière vers l’ancien chemin', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it('?carte=historique construit les zones sans le catalogue, à l’identique', async () => {
    vi.stubGlobal('location', { search: '?carte=historique' });
    vi.resetModules();
    const legacy = await import('../src/world/zones.js');
    expect(legacy.WORLD_SOURCE).toBe('historique');
    expect(legacy.ZONES).toEqual(catalogueZones());
    expect(legacy.setResidentialBlocks(2)).toBe(true);
    expect(legacy.ZONES.quartier).toEqual(buildCity({ residentialBlocks: 2 }));
  });

  it('le réglage du navigateur active aussi l’ancien chemin', async () => {
    vi.stubGlobal('localStorage', { getItem: (k) => (k === 'babiverse.carte' ? 'historique' : null) });
    vi.resetModules();
    expect((await import('../src/world/zones.js')).WORLD_SOURCE).toBe('historique');
  });

  it('un stockage inaccessible ne bloque pas le jeu (chemin du catalogue)', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('bloqué'); } });
    vi.resetModules();
    expect((await import('../src/world/zones.js')).WORLD_SOURCE).toBe('catalogue');
  });
});
