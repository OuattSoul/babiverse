import { afterEach, describe, expect, it } from 'vitest';
import { composeCharacter } from '../src/atelier/compose.js';
import { homeZone } from '../src/atelier/home.js';
import { applyPack, atelier, inhabitantLooks, resetPack, roamerDefs, studioLook, svgCharacter, wardrobeReady } from '../src/atelier/pack.js';
import { buildGrid, isSolid } from '../src/world/grid.js';
import { NPCS } from '../src/world/npcs.js';
import { findPath } from '../src/world/pathfinding.js';
import { buildSelectables } from '../src/world/selectables.js';
import { ZONES } from '../src/world/zones.js';

const BODY = { hw: 7, hh: 5 };
const c = ([tx, ty]) => ({ x: (tx + 0.5) * 32, y: (ty + 0.5) * 32 });

// Intérieur « studio de base » de l'atelier (seed) : salon au nord, chambre et salle d'eau au sud.
const STUDIO = {
  asset_id: 'int-1', version: 1, name: 'Intérieur studio de base', materials: { floor: '#d8b98a', wall: '#f1e7d6' },
  interior: {
    width: 8, depth: 8,
    rooms: [
      { id: 'salon', name: 'Salon', type: 'living', x: 0, y: 0, w: 8, d: 5 },
      { id: 'chambre', name: 'Chambre', type: 'bedroom', x: 0, y: 5, w: 5, d: 3 },
      { id: 'sdb', name: "Salle d'eau", type: 'bathroom', x: 5, y: 5, w: 3, d: 3 },
    ],
    doors: [
      { id: 'entree', cell: [3, 0], side: 'N', connects: ['salon', 'exterior'] },
      { id: 'p-chambre', cell: [2, 4], side: 'S', connects: ['salon', 'chambre'] },
      { id: 'p-sdb', cell: [6, 4], side: 'S', connects: ['salon', 'sdb'] },
    ],
    furniture: [
      { id: 'canape', item: 'sofa', x: 0, y: 1, w: 3, d: 1, interactive: true, action: 'sit' },
      { id: 'table', item: 'table', x: 5, y: 2, w: 2, d: 2, interactive: true, action: 'eat' },
      { id: 'lit', item: 'bed', x: 0, y: 5, w: 2, d: 3, interactive: true, action: 'sleep' },
      { id: 'douche', item: 'shower', x: 7, y: 7, w: 1, d: 1, interactive: true, action: 'wash' },
    ],
    spawn: [3, 1], forbidden: [],
  },
  furniture: {
    sofa: { label: 'Canapé', shape: 'seat', color: '#c0623b', height_px: 9, actions: ['sit'] },
    table: { label: 'Table', shape: 'table', color: '#a07a4a', height_px: 10, actions: ['eat'] },
    bed: { label: 'Lit', shape: 'bed', color: '#8e6fb5', height_px: 7, actions: ['sleep'] },
    shower: { label: 'Douche', shape: 'cabinet', color: '#7fb7d6', height_px: 26, actions: ['wash'] },
  },
};

const part = (slot, front = '<rect width="10" height="10" style="fill:var(--babi-primary,#888)"/>', extra = {}) => ({
  slot, z: 40, back_z: 0, props: {}, view_box: [0, 0, 200, 380], channels: { primary: '#888888' }, defs: '', back: '', front, ...extra,
});
const entry = (id, slot, extra = {}) => ({ id, key: `${id}@1`, name: id, slot, bodies: [], palette: {}, default_colors: {}, channels: ['primary'], ...extra });
const character = { body: 'corps@1', skin: '#8d5524', hair_color: '#111111', eye_color: '#3b2414', height_scale: 1, layers: { top: { part: 'tshirt@1', colors: { primary: '#c0392b' } } } };
const PACK = {
  format: 'babiverse-game-pack', format_version: 1, revision: 'r1',
  parts: { 'corps@1': part('body'), 'tshirt@1': part('top'), 'jean@1': part('bottom'), 'yeux@1': part('eyes') },
  wardrobe: {
    bodies: [entry('corps', 'body')],
    slots: { hair: [], top: [entry('tshirt', 'top')], bottom: [entry('jean', 'bottom')], shoes: [] },
    face: { corps: { eyes: 'yeux', eyebrows: null, nose: null, mouth: null } },
    face_parts: { eyes: [entry('yeux', 'eyes')] },
    skin_tones: ['#8d5524'], hair_colors: ['#111111'], cloth_colors: ['#c0392b'],
  },
  inhabitants: [
    { technical_name: 'habitante-awa', name: 'Awa', role: 'Couturière', greeting: 'Bonjour !', npc: 'awa', roams: false, character, appearance: { skin: '#8d5524', outfit: '#c0392b', hair: 'braids' } },
    { technical_name: 'habitant-yao', name: 'Yao, vendeur', role: 'Vendeur', greeting: '', npc: null, roams: true, character, appearance: { skin: '#8d5524', outfit: '#c0392b', hair: 'short' } },
  ],
  home: STUDIO,
};

describe("intérieur de l'atelier → zone du jeu", () => {
  const zone = homeZone(STUDIO);
  const grid = buildGrid(zone);

  it('produit une carte valide entourée de murs, avec un mur entre les pièces', () => {
    expect(zone.id).toBe('maison');
    const w = zone.map[0].length;
    expect(zone.map.every((row) => row.length === w)).toBe(true);
    // 8 tuiles + 2 bords + 1 colonne (chambre | salle d'eau) ; 8 + 2 + 1 ligne (salon / pièces du fond)
    expect([w, zone.map.length]).toEqual([11, 11]);
    expect(zone.map[0].replace('E', '')).toMatch(/^w+$/);
    expect(zone.map[6]).toMatch(/^w[fw]+w$/); // ligne de mur insérée, ouverte par les deux portes
    expect(zone.map[6].split('f').length - 1).toBe(2);
  });

  it('la porte vers l’extérieur ramène dans la ville, devant ma maison', () => {
    const door = zone.interactables.find((i) => i.type === 'door');
    expect(zone.map[door.tile[1]][door.tile[0]]).toBe('E');
    expect(door.target).toEqual({ zone: 'quartier', spawn: 'from_maison' });
    expect(isSolid(grid, ...zone.spawns.entree)).toBe(false);
  });

  it('le lit sert à la sieste, les meubles bloquent le passage et ont une fiche', () => {
    const bed = zone.interactables.find((i) => i.id === 'lit');
    expect(bed.type).toBe('bed');
    expect(isSolid(grid, bed.tile[0], bed.tile[1])).toBe(true);
    expect(zone.interactables.filter((i) => i.type === 'info').map((i) => i.name)).toEqual(['Canapé', 'Table', 'Douche']);
    expect(zone.props.every((p) => p.kind === 'furniture' && p.solid)).toBe(true);
    expect(buildSelectables(zone).some((s) => s.id === 'lit')).toBe(true);
  });

  it('chaque pièce est accessible à pied depuis l’entrée', () => {
    const from = c(zone.spawns.entree);
    for (const target of [[3, 9], [8, 8], [6, 3]]) {
      expect(isSolid(grid, ...target)).toBe(false);
      expect(findPath(grid, from, c(target), BODY), `case ${target}`).not.toBeNull();
    }
  });

  it('garde les couleurs de sol et de murs de l’atelier', () => {
    expect(zone.palette).toEqual({ floor: '#d8b98a', wall: '#f1e7d6' });
  });
});

describe('compositeur de personnages', () => {
  it('assemble les calques avec les couleurs du personnage et signale les manquants', () => {
    const { svg, missing } = composeCharacter({ ...character, layers: { ...character.layers, hair: { part: 'absent@1' } } }, PACK.parts);
    expect(svg).toContain('--babi-skin:#8d5524');
    expect(svg).toContain('--babi-primary:#c0392b');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(missing).toEqual(['absent@1']);
  });
});

describe('pack de l’atelier dans le jeu', () => {
  afterEach(resetPack);

  it('sans pack, rien ne change', () => {
    expect(applyPack(null)).toBe(false);
    expect(wardrobeReady()).toBe(false);
    expect(svgCharacter({ skin: '#fff' })).toBeNull();
    expect(inhabitantLooks()).toEqual([]);
  });

  it('remplace l’apparence des PNJ, ajoute les promeneurs et la maison', () => {
    const before = ZONES.maison;
    const koffi = NPCS.koffi.look;
    expect(applyPack(PACK)).toBe(true);
    expect(NPCS.awa.look.svg).toBe(character);
    expect(NPCS.awa.name).toBe('Awa');
    expect(NPCS.koffi.look).toBe(koffi);
    expect(NPCS['hab_habitant-yao']).toMatchObject({ name: 'Yao', local: true, services: [] });
    expect(ZONES.maison).not.toBe(before);
    expect(ZONES.maison.name).toBe('Intérieur studio de base');
    const defs = roamerDefs(ZONES.quartier);
    expect(defs).toHaveLength(1);
    expect(ZONES.quartier.map[defs[0].tile[1]][defs[0].tile[0]]).toBe('_');
    expect(defs[0].behavior.type).toBe('wander');
    expect(inhabitantLooks()).toHaveLength(2);
    resetPack();
    expect(ZONES.maison).toBe(before);
    expect(NPCS.awa.look.svg).toBeUndefined();
    expect(NPCS['hab_habitant-yao']).toBeUndefined();
  });

  it('résout l’apparence d’un joueur (identifiants d’assets) vers les composants du pack, visage compris', () => {
    applyPack(PACK);
    expect(wardrobeReady()).toBe(true);
    const look = studioLook({ body: 'corps', skin: '#8d5524', hair_color: '#111111', layers: { top: { part: 'tshirt', colors: { primary: '#c0392b' } }, bottom: { part: 'jean', colors: {} }, hair: null } });
    expect(Object.keys(look.layers).sort()).toEqual(['bottom', 'eyes', 'top']);
    const props = svgCharacter({ skin: '#c68642', outfit: '#c0392b', hair: 'bald', studio: look });
    expect(props.body).toBe('corps@1');
    expect(props.layers.top).toEqual({ part: 'tshirt@1', colors: { primary: '#c0392b' } });
    expect(props.layers.eyes.part).toBe('yeux@1');
    // silhouette retirée de l'atelier : retour au modèle 3D
    expect(svgCharacter({ studio: { ...look, body: 'disparu' } })).toBeNull();
    expect(atelier.byId.size).toBe(4);
  });
});
