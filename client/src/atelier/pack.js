// Contenu de l'atelier d'assets dans le jeu (pack « babiverse-game-pack », lu par GET /api/atelier/pack).
// Module pur (aucun rendu) : garde-robe de création, habitants qui remplacent les PNJ ou se promènent en ville,
// intérieur de la maison du joueur. Sans pack, le jeu garde exactement son contenu d'origine.
import { NPCS } from '../world/npcs.js';
import { setCityDecorator, ZONES } from '../world/zones.js';
import { homeZone } from './home.js';
import { cityWithPlacements } from './world.js';
import { cityWithout } from '../world/removal.js';
import { dataZone, usableMap, withEntrances } from '../world/dataMaps.js';
import { builtinMapIds, setAtelierMaps } from '../world/maps.js';

export const MAX_ROAMERS = 24; // habitants nommés en plus des PNJ ; les autres ne servent qu'aux passants
const PANTS = '#2c3e50';
const FACE_SLOTS = ['eyes', 'eyebrows', 'nose', 'mouth'];

export const atelier = {
  pack: null,
  /** Pièces de la garde-robe par identifiant d'asset (silhouettes, vêtements, visage). */
  byId: new Map(),
  roamers: [],
  /** Cartes publiées par l'atelier, installées dans ZONES. */
  maps: [],
};

// Contenu d'origine, restauré par resetPack (tests).
const ORIGINAL = { looks: Object.fromEntries(Object.entries(NPCS).map(([id, n]) => [id, n.look])), maison: ZONES.maison };

const valid = (p) => p && p.format === 'babiverse-game-pack' && p.format_version === 1 && p.parts && p.wardrobe;

/** Charge le pack : remplace l'apparence des PNJ, ajoute les habitants promeneurs, remplace « Chez moi ». */
export function applyPack(pack) {
  if (!valid(pack)) return false;
  atelier.pack = pack;
  atelier.byId = new Map();
  const w = pack.wardrobe;
  for (const e of [...w.bodies, ...Object.values(w.slots).flat(), ...Object.values(w.face_parts || {}).flat()]) atelier.byId.set(e.id, e);
  for (const x of pack.inhabitants || []) {
    const look = { ...x.appearance, pants: PANTS, svg: x.character };
    if (x.npc && NPCS[x.npc]) NPCS[x.npc].look = { ...NPCS[x.npc].look, svg: x.character };
    x.look = look;
  }
  atelier.roamers = (pack.inhabitants || []).filter((x) => x.roams).slice(0, MAX_ROAMERS).map((x) => {
    const id = `hab_${x.technical_name}`;
    NPCS[id] = { name: x.name.split(',')[0].trim(), role: x.role || 'Habitant du quartier', look: x.look,
      lines: [x.greeting || 'Akwaba ! Bienvenue à la Cité.'], services: [], local: true };
    return id;
  });
  if (pack.home?.interior) {
    try { ZONES.maison = homeZone(pack.home); } catch { /* plan illisible : on garde le studio d'origine */ }
  }
  // Cartes publiées par l'atelier (autres quartiers, communes, villes) : une zone chacune, chargée à la demande
  // par World3D ; une carte inutilisable (identifiant réservé, données incomplètes) est ignorée.
  const maps = (pack.maps || []).filter((m) => usableMap(m, builtinMapIds()));
  atelier.maps = [];
  for (const m of maps) {
    try { ZONES[m.id] = dataZone(m); atelier.maps.push(m.id); } catch { /* carte illisible : ignorée */ }
  }
  setAtelierMaps(maps.filter((m) => atelier.maps.includes(m.id)));
  const reachable = maps.filter((m) => atelier.maps.includes(m.id));
  // Carte du jeu de l'atelier : éléments d'origine retirés, puis éléments placés (bâtiments et leurs intérieurs,
  // objets, véhicules, surfaces) — un élément peut prendre la place d'un élément retiré — puis accès aux cartes.
  if (pack.placements?.length || pack.removals?.length || reachable.some((m) => m.entrance)) {
    setCityDecorator((city) => {
      const cleared = cityWithout(city, pack.removals || []);
      const { zone, interiors } = cityWithPlacements(cleared.zone, pack.placements || []);
      const entrances = withEntrances(zone, reachable);
      const out = entrances.zone;
      out.atelier = { ...(zone.atelier || {}), removed: cleared.removed, refused: cleared.refused, entrances: entrances.skipped };
      Object.assign(ZONES, interiors);
      return out;
    });
  }
  return true;
}

/** Garde-robe utilisable pour la création : au moins une silhouette, un haut et un bas. */
export function wardrobeReady() {
  const w = atelier.pack?.wardrobe;
  return !!(w && w.bodies.length && w.slots.top?.length && w.slots.bottom?.length);
}

/**
 * Définition SVG d'une apparence (clés de composants du pack), ou null pour le modèle 3D d'origine.
 * - look.svg : habitant (déjà en clés) ;
 * - look.studio : joueur (identifiants d'assets, version publiée courante du pack).
 */
export function svgCharacter(look) {
  const pack = atelier.pack;
  if (!pack || !look) return null;
  if (look.svg) return pack.parts[look.svg.body] ? look.svg : null;
  const s = look.studio;
  if (!s) return null;
  const key = (id) => atelier.byId.get(id)?.key;
  if (!key(s.body)) return null;
  const layers = {};
  for (const [slot, layer] of Object.entries(s.layers || {})) {
    const k = key(layer.part);
    if (k) layers[slot] = { part: k, colors: layer.colors || {} };
  }
  return { body: key(s.body), skin: s.skin, hair_color: s.hair_color, eye_color: '#3b2414', height_scale: 1, layers };
}

/** Apparence choisie à la création → { body, skin, hair_color, layers } (identifiants d'assets) avec visage. */
export function studioLook(choice) {
  const face = atelier.pack?.wardrobe.face?.[choice.body] || {};
  const layers = {};
  for (const slot of FACE_SLOTS) if (face[slot]) layers[slot] = { part: face[slot], colors: {} };
  for (const [slot, layer] of Object.entries(choice.layers)) if (layer) layers[slot] = { part: layer.part, colors: { ...layer.colors } };
  return { body: choice.body, skin: choice.skin, hair_color: choice.hair_color, layers };
}

/** Apparences des habitants (passants, clients du kiosque) ; vide sans pack. */
export function inhabitantLooks() {
  return (atelier.pack?.inhabitants || []).map((x) => x.look).filter(Boolean);
}

/**
 * Habitants promeneurs placés sur les trottoirs du centre-ville, loin des PNJ (positions déterministes).
 * zone : la ville (carte ASCII) ; renvoie des définitions de PNJ comme celles de zones.js.
 */
export function roamerDefs(zone) {
  if (!atelier.roamers.length) return [];
  const taken = (zone.npcs || []).map((n) => n.tile);
  const spots = [];
  for (let y = 0; y < Math.min(zone.map.length, 36); y++) {
    for (let x = 0; x < Math.min(zone.map[y].length, 56); x++) {
      if (zone.map[y][x] !== '_') continue;
      if (taken.some(([tx, ty]) => Math.abs(tx - x) + Math.abs(ty - y) < 4)) continue;
      spots.push([x, y]);
    }
  }
  if (!spots.length) return [];
  const step = Math.max(1, Math.floor(spots.length / atelier.roamers.length));
  return atelier.roamers.map((id, i) => ({
    id, tile: spots[(i * step + Math.floor(step / 2)) % spots.length], behavior: { type: 'wander', radius: 3 },
  }));
}

/** Remet le module à zéro (tests). */
export function resetPack() {
  atelier.pack = null;
  atelier.byId = new Map();
  for (const id of atelier.roamers) delete NPCS[id];
  atelier.roamers = [];
  for (const [id, look] of Object.entries(ORIGINAL.looks)) NPCS[id].look = look;
  ZONES.maison = ORIGINAL.maison;
  for (const id of Object.keys(ZONES)) if (id.startsWith('int_atl_')) delete ZONES[id];
  for (const id of atelier.maps || []) delete ZONES[id];
  atelier.maps = [];
  setAtelierMaps([]);
  setCityDecorator(null);
}
