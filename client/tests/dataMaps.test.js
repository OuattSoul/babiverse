// Cartes publiées par l'atelier dans le jeu : zone, paysages 3D, emprises, objets interactifs, accès depuis la ville.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyPack, resetPack } from '../src/atelier/pack.js';
import { buildLandscapes, detachLandscapes } from '../src/engine3d/landscapes.js';
import { createModelCache } from '../src/engine3d/modelCache.js';
import { buildCity } from '../src/world/city.js';
import { conditionReason } from '../src/world/conditions.js';
import { dataZone, footprint, modelUrl, prefetchPlan, usableMap, withEntrances } from '../src/world/dataMaps.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { actionsFor } from '../src/world/interactionTypes.js';
import { mapInfo } from '../src/world/maps.js';
import { buildSelectables } from '../src/world/selectables.js';
import { resolveZoneRequest, ZONES, zoneById } from '../src/world/zones.js';

const BBOX = [0, 0, -2, 4.5, 2, 2];
/** Carte telle que la publie l'atelier (GET /api/runtime/game-pack, section maps). */
const MAP = {
  id: 'marche_treichville', name: 'Marché de Treichville', version: 1,
  city: { id: 'abidjan_sud', name: 'Abidjan Sud' }, district: { id: 'treichville', name: 'Treichville' },
  width: 20, height: 16, ground: 'paving', spawn: [10, 13],
  landscapes: [{ id: 'marche', media_id: 'm-abc', revision: 1, x: 6, z: 6, rotation: 0, scale: 1, solid: true, footprint: { x: 6, y: 4, w: 5, h: 4 } }],
  interactives: [
    { id: 'boutique', name: "Boutique d'Awa", type: 'shop', active: true, area: { x: 6, y: 6, w: 2, h: 1 }, landscape: 'marche', node: 'Boutique', label: 'Regarder la boutique', text: 'Pagnes et wax.' },
    { id: 'etal', name: 'Étal fermé', type: 'info', active: false, area: { x: 14, y: 10, w: 2, h: 1 }, text: '' },
    { id: 'sortie', name: 'Retour', type: 'door', active: true, area: { x: 10, y: 14, w: 1, h: 1 }, label: 'Rentrer', target: { zone: 'quartier', spawn: 'from_marche_treichville' } },
  ],
  entrance: { zone: 'quartier', x: 42, y: 39, label: '→ TREICHVILLE' },
  models: { marche: { media_id: 'm-abc', revision: 1, mime: 'model/gltf-binary', bbox: BBOX, sha256: 'x', bytes: 1 } },
};
const PACK = (maps) => ({ format: 'babiverse-game-pack', format_version: 1, parts: {}, wardrobe: { bodies: [], slots: {} }, inhabitants: [], kits: {}, maps });
const clone = (v) => JSON.parse(JSON.stringify(v));

afterEach(() => resetPack());

describe('emprise au sol (même règle que l’atelier)', () => {
  // mêmes cas que babiverse-studio/backend/tests/test_worldmaps.py::test_footprint_same_rule_as_the_game
  it.each([
    [{ x: 6, z: 6, rotation: 0, scale: 1 }, { x: 6, y: 4, w: 5, h: 4 }],
    [{ x: 6, z: 6, rotation: 90, scale: 1 }, { x: 4, y: 6, w: 4, h: 5 }],
    [{ x: 6, z: 6, rotation: 180, scale: 1 }, { x: 1, y: 4, w: 5, h: 4 }],
    [{ x: 6, z: 6, rotation: 270, scale: 2 }, { x: 2, y: -3, w: 8, h: 9 }],
    [{ x: 2.5, z: 3.25, rotation: 0, scale: 0.5 }, { x: 2, y: 2, w: 3, h: 3 }],
  ])('%o', (inst, expected) => expect(footprint(inst, BBOX)).toEqual(expected));

  it('l’emprise suit la rotation du rendu (Three.js : rotation.y = −angle)', () => {
    const o = new THREE.Object3D();
    o.position.set(6, 0, 6);
    o.rotation.y = -Math.PI / 2;
    o.updateMatrixWorld();
    const p = new THREE.Vector3(4.5, 0, 2).applyMatrix4(o.matrixWorld); // coin (x max, z max) du modèle
    const f = footprint({ x: 6, z: 6, rotation: 90, scale: 1 }, BBOX);
    expect(p.x).toBeCloseTo(4);
    expect(p.z).toBeCloseTo(10.5);
    expect(p.x >= f.x && p.x <= f.x + f.w && p.z >= f.y && p.z <= f.y + f.h).toBe(true);
  });
});

describe('carte de l’atelier → zone du jeu', () => {
  const zone = dataZone(MAP);

  it('grille, sol, enceinte, collisions des paysages (sans masquer la vue)', () => {
    expect([zone.map[0].length, zone.map.length]).toEqual([20, 16]);
    expect(zone.map[0]).toBe('#'.repeat(20));
    expect(zone.map[5]).toBe(`#${':'.repeat(18)}#`);
    const grid = buildGrid(zone);
    expect(isSolid(grid, 6, 4) && isSolid(grid, 10, 7)).toBe(true);
    expect(isSolid(grid, 11, 7) || isSolid(grid, 5, 4)).toBe(false);
    expect(grid.opaque[4 * 20 + 6]).toBe(0);
    expect(zone.landscapes[0]).toMatchObject({ id: 'marche', url: '/api/atelier/models/m-abc/1', bbox: BBOX, solid: true });
    expect(modelUrl({ media_id: 'm a', revision: 3 })).toBe('/api/atelier/models/m%20a/3');
  });

  it('boutique interactive (fiche), objet désactivé absent, porte de sortie vers la ville', () => {
    const ids = zone.interactables.map((i) => i.id);
    expect(ids).toEqual(['boutique', 'sortie']);
    const shop = zone.interactables[0];
    expect(shop).toMatchObject({ type: 'info', category: 'shop', tile: [6, 6], w: 2, h: 1, name: "Boutique d'Awa", text: 'Pagnes et wax.' });
    const calls = [];
    const ctx = { actions: { inspect: (id) => calls.push(['inspect', id]), enterDoor: (t) => calls.push(['door', t]) } };
    actionsFor(shop, ctx)[0].run();
    actionsFor(zone.interactables[1], ctx)[0].run();
    expect(calls).toEqual([['inspect', 'boutique'], ['door', { zone: 'quartier', spawn: 'from_marche_treichville' }]]);
    const sel = buildSelectables(zone).find((s) => s.id === 'boutique');
    expect(sel.category).toBe('shop');
    expect(sel.boxes[0]).toMatchObject({ x0: 6, z0: 6, x1: 8, z1: 7 });
  });

  it('point d’arrivée déplacé hors d’un obstacle', () => {
    expect(zone.spawns.default).toEqual([10, 13]);
    const blocked = dataZone({ ...clone(MAP), spawn: [7, 5] });
    const [x, y] = blocked.spawns.default;
    expect(isSolid(buildGrid(blocked), x, y)).toBe(false);
  });

  it('cartes inutilisables refusées (identifiant réservé, invalide, incomplète)', () => {
    expect(usableMap(MAP, ['quartier'])).toBe(true);
    expect(usableMap({ ...MAP, id: 'quartier' }, ['quartier'])).toBe(false);
    expect(usableMap({ ...MAP, id: 'int_x' })).toBe(false);
    expect(usableMap({ ...MAP, id: 'Marché' })).toBe(false);
    expect(usableMap({ ...MAP, width: 400 })).toBe(false);
    expect(usableMap({ ...MAP, landscapes: undefined })).toBe(false);
  });
});

describe('accès depuis la Cité Akwaba', () => {
  it('panneau de direction = porte vers la carte, point de retour devant, reste de la ville intact', () => {
    const city = buildCity();
    const { zone, skipped } = withEntrances(city, [MAP]);
    expect(skipped).toEqual([]);
    expect(zone.props.at(-1)).toMatchObject({ kind: 'roadsign', tile: [42, 39], text: '→ TREICHVILLE', solid: true });
    expect(zone.interactables.at(-1)).toMatchObject({ id: 'vers_marche_treichville', type: 'door', tile: [42, 39], target: { zone: 'marche_treichville', spawn: 'default' } });
    expect(zone.spawns.from_marche_treichville).toEqual([42, 40]);
    expect(zone.map).toEqual(city.map);
    expect(zone.props.slice(0, -1)).toEqual(city.props);
    expect(zone.interactables.slice(0, -1)).toEqual(city.interactables);
  });

  it('case interdite (route, bâtiment) : accès ignoré avec sa raison', () => {
    const onRoad = { ...clone(MAP), entrance: { zone: 'quartier', x: 18, y: 13, label: 'X' } };
    const { zone, skipped } = withEntrances(buildCity(), [onRoad]);
    expect(skipped[0].reason).toMatch(/route/);
    expect(zone.props.length).toBe(buildCity().props.length);
  });
});

describe('pack de jeu avec des cartes', () => {
  it('installe la carte, son accès et ses métadonnées ; resetPack revient à la carte historique', () => {
    const before = buildCity();
    expect(applyPack(PACK([MAP, { ...clone(MAP), id: 'quartier' }]))).toBe(true);
    expect(zoneById('marche_treichville').name).toBe('Marché de Treichville');
    expect(ZONES.quartier.name).toBe('Cité Akwaba'); // la carte historique n'est jamais remplacée
    expect(ZONES.quartier.interactables.some((i) => i.id === 'vers_marche_treichville')).toBe(true);
    expect(mapInfo('marche_treichville')).toMatchObject({ city: 'abidjan_sud', district: 'treichville', source: 'atelier', version: 1 });
    expect(mapInfo('quartier').district).toBe('cite_akwaba');
    resetPack();
    expect(zoneById('marche_treichville')).toBeNull();
    expect(mapInfo('marche_treichville')).toBeNull();
    expect(ZONES.quartier).toEqual(before);
  });
});

describe('modèles 3D : cache et chargement progressif', () => {
  const fakeModel = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial())); return g; };

  it('un seul téléchargement pour plusieurs instances ; géométries partagées protégées', async () => {
    const calls = [];
    const cache = createModelCache(async (url) => { calls.push(url); return fakeModel(); });
    const [a, b] = await Promise.all([cache.instantiate('/m/1'), cache.instantiate('/m/1')]);
    expect(calls).toEqual(['/m/1']);
    expect(a).not.toBe(b);
    expect(a.children[0].geometry).toBe(b.children[0].geometry);
    expect(a.children[0].geometry.userData.shared).toBe(true);
    cache.release([]);
    expect(cache.size()).toBe(0);
  });

  it('échec : signalé, nouvel essai possible', async () => {
    let fail = true;
    const cache = createModelCache(async () => { if (fail) throw new Error('404'); return fakeModel(); });
    await expect(cache.get('/m/2')).rejects.toThrow('404');
    fail = false;
    await expect(cache.get('/m/2')).resolves.toBeTruthy();
    expect(cache.stats).toMatchObject({ requests: 2, loaded: 1, failed: 1 });
  });

  it('volume provisoire remplacé par le modèle, rouge si le fichier manque, rien après avoir quitté la carte', async () => {
    const zone = dataZone({ ...clone(MAP), landscapes: [...MAP.landscapes, { ...MAP.landscapes[0], id: 'absent' }], models: { ...MAP.models, absent: { ...MAP.models.marche, media_id: 'm-absent' } } });
    const cache = createModelCache(async (url) => { if (url.includes('absent')) throw new Error('introuvable'); return fakeModel(); });
    const errors = [];
    const built = buildLandscapes(zone, cache, { onError: (inst) => errors.push(inst.id) });
    const holder = built.group.getObjectByName('landscape:marche');
    expect(holder.position.toArray()).toEqual([6, 0, 6]);
    expect(holder.children[0].userData.placeholder).toBe(true);
    await built.status.done;
    expect(holder.children[0].userData.placeholder).toBeUndefined();
    expect(built.status).toMatchObject({ total: 2, loaded: 1, failed: 1 });
    expect(errors).toEqual(['absent']);
    expect(built.group.getObjectByName('landscape:absent').children[0].material.color.getHex()).toBe(0xe74c3c);

    const later = buildLandscapes(zone, createModelCache(async () => fakeModel()));
    detachLandscapes(later);
    await later.status.done;
    expect(later.group.getObjectByName('landscape:marche').children[0].userData.placeholder).toBe(true);
  });
});

describe('connexions : points d’arrivée, transport, conditions de passage', () => {
  const PORT = {
    ...clone(MAP), id: 'port_bouet', name: 'Port-Bouët', arrivals: [{ id: 'gare', x: 15, y: 13 }, { id: 'quai', x: 7, y: 5 }],
    interactives: [{ id: 'gbaka', name: 'Gbaka pour Treichville', type: 'door', mode: 'transport', active: true, area: { x: 2, y: 2, w: 2, h: 1 },
      target: { zone: 'marche_treichville', spawn: 'gare' },
      conditions: [{ type: 'mission_completed', mission: 'm_livraison' }, { type: 'min_balance', amount: 1000 }] }],
  };
  const store = (missions, balance) => ({
    state: { missions, character: { balance } }, config: { missions: [{ id: 'm_livraison', title: 'Premier boulot' }] },
  });

  it('points d’arrivée nommés, déplacés hors obstacle', () => {
    const zone = dataZone(PORT);
    expect(zone.spawns.gare).toEqual([15, 13]);
    expect(isSolid(buildGrid(zone), ...zone.spawns.quai)).toBe(false); // (7, 5) est dans l'emprise du paysage
    expect(zone.spawns.default).toEqual([10, 13]);
  });

  it('transport : libellé par défaut ; conditions : action désactivée avec sa raison, puis ouverte', () => {
    const door = dataZone(PORT).interactables[0];
    expect(door).toMatchObject({ label: 'Prendre : Gbaka pour Treichville', mode: 'transport', target: { zone: 'marche_treichville', spawn: 'gare' } });
    const run = (s) => actionsFor(door, { actions: { enterDoor: () => {} }, store: s })[0];
    expect(run(store([], 5000))).toMatchObject({ enabled: false, reason: "Termine d'abord la mission « Premier boulot »." });
    expect(run(store([{ id: 'm_livraison', status: 'rewarded' }], 999)).reason).toMatch(/1 000 F|1 000 F/);
    expect(run(store([{ id: 'm_livraison', status: 'completed' }], 1000)).enabled).toBeUndefined();
    expect(conditionReason([{ type: 'inconnue' }], store([], 0))).toBe('Passage fermé.');
  });

  it('porte sans condition : action inchangée (forme historique)', () => {
    const door = buildCity().interactables.find((i) => i.id === 'door_epicerie');
    const [a] = actionsFor(door, { actions: { enterDoor: () => {} }, store: store([], 0) });
    expect(Object.keys(a).sort()).toEqual(['id', 'label', 'run']);
  });
});

describe('gestion des erreurs', () => {
  it('zone introuvable : Cité Akwaba au point de départ, position d’une autre carte ignorée', () => {
    const lost = resolveZoneRequest('carte_desactivee', [], { spawn: 'entree', pos: { x: 320, y: 320 } });
    expect(lost).toMatchObject({ fallback: true, spawn: 'default', pos: undefined });
    expect(lost.zone.id).toBe('quartier');
    const ok = resolveZoneRequest('epicerie', [], { spawn: 'entree', pos: { x: 5, y: 6 } });
    expect(ok).toMatchObject({ fallback: false, spawn: 'entree', pos: { x: 5, y: 6 } });
    applyPack(PACK([MAP]));
    expect(resolveZoneRequest('marche_treichville').fallback).toBe(false);
  });

  it('modèle trop long à charger : échec signalé, la carte reste jouable', async () => {
    const cache = createModelCache(() => new Promise(() => {}), { timeoutMs: 30 });
    await expect(cache.get('/m/lent')).rejects.toThrow(/Délai dépassé/);
    expect(cache.has('/m/lent')).toBe(false); // nouvel essai possible
    const built = buildLandscapes(dataZone(MAP), createModelCache(() => new Promise(() => {}), { timeoutMs: 30 }));
    await built.status.done;
    expect(built.status.failed).toBe(1);
  });

  it('pack avec une carte malformée : ignorée sans casser les autres', () => {
    const broken = { ...clone(MAP), id: 'cassee', landscapes: [{ id: 'x' }], interactives: [{ id: 'y', type: 'door', area: null }] };
    expect(applyPack(PACK([broken, MAP]))).toBe(true);
    expect(zoneById('marche_treichville')).not.toBeNull();
    expect(zoneById('cassee').landscapes).toEqual([]); // paysage sans modèle publié : écarté
  });
});

describe('optimisation du chargement', () => {
  const fakeModel = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial())); return g; };
  const many = (n) => ({
    ...clone(MAP),
    landscapes: Array.from({ length: n }, (_, i) => ({ ...MAP.landscapes[0], id: `p${i}`, media_id: `m${i}`, x: 1 + i * 2, z: 2, footprint: { x: 1 + i * 2, y: 2, w: 1, h: 1 } })),
    models: Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, { ...MAP.models.marche, media_id: `m${i}`, bytes: 1000 * (i + 1) }])),
  });

  it('au plus deux téléchargements à la fois, les plus proches du joueur d’abord', async () => {
    const started = [];
    const cache = createModelCache(async (url) => { started.push(url); await new Promise((r) => setTimeout(r, 5)); return fakeModel(); }, { concurrency: 2 });
    const built = buildLandscapes(dataZone(many(6)), cache, { origin: [11, 2] });
    await built.status.done;
    expect(cache.stats.maxActive).toBe(2);
    expect(built.status.order.slice(0, 2)).toEqual(['p5', 'p4']); // centres en x = 11.5 et 9.5
    expect(started[0]).toBe('/api/atelier/models/m5/1');
    expect(Object.keys(cache.stats.timings)).toHaveLength(6);
  });

  it('préchargement : modèles des cartes voisines, dans le budget, jamais en économie de données', () => {
    const market = dataZone(many(3)); // 1 000 + 2 000 + 3 000 octets
    const city = withEntrances(buildCity(), [MAP]).zone;
    const zoneOf = (id) => (id === 'marche_treichville' ? market : null);
    expect(prefetchPlan(city, zoneOf)).toEqual(['/api/atelier/models/m0/1', '/api/atelier/models/m1/1', '/api/atelier/models/m2/1']);
    expect(prefetchPlan(city, zoneOf, { budget: 3500 })).toEqual(['/api/atelier/models/m0/1', '/api/atelier/models/m1/1']);
    expect(prefetchPlan(city, zoneOf, { cached: (u) => u.endsWith('m0/1') })).not.toContain('/api/atelier/models/m0/1');
    expect(prefetchPlan(city, zoneOf, { connection: { saveData: true } })).toEqual([]);
    expect(prefetchPlan(city, zoneOf, { connection: { effectiveType: 'slow-2g' } })).toEqual([]);
    expect(prefetchPlan(buildCity(), zoneOf)).toEqual([]); // carte historique seule : aucun téléchargement
  });
});
