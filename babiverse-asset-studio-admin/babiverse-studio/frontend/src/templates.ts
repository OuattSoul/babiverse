// Modèles paramétriques de départ, un par famille : l'assistant de création les pré-remplit,
// l'administrateur n'a jamais à saisir de paramètre technique pour une création simple.
import type { AssetDefinition, Connector, Side } from "./types";
import { ROAD_SIDES } from "./geometry";

const base = (): Omit<AssetDefinition, "representation" | "properties" | "materials"> => ({
  name: "", description: "", subcategory: null, tags: [], unit: "cell", cell_size_m: 2,
  footprint: { kind: "rect", w: 2, d: 2, cells: null }, height_m: 4, anchor: [0, 0], default_rotation: 0,
  entrances: [], connectors: [], collision: "footprint", zones: [], variants: [], default_variant: null,
  placement: { allowed_terrain: ["ground"], road_access: "preferred", safety_margin: 0, max_height_m: null }, resources: [],
  cover: null, behaviors: [],
});

export function buildingTemplate(category: string): AssetDefinition {
  const commerce = category === "commerce";
  const home = category === "residential";
  return {
    ...base(), representation: "procedural", height_m: 4.5,
    entrances: [{ id: "porte", cell: [0, 1], side: "S", kind: "main" }],
    materials: { wall: "#efe2c6", roof: "#8e4a35", trim: "#2e6b8a" },
    placement: { allowed_terrain: ["ground"], road_access: category === "transport_hub" ? "required" : "preferred", safety_margin: 0, max_height_m: null },
    properties: {
      floors: 1, occupancy: 4, ownership: home ? "player" : "npc",
      assignable_to_player: home, upgrade_level: null, interiors: [],
      style: { roof: commerce ? "flat" : "gable", window_style: "grid", door_style: commerce ? "glass" : "wood" },
      shop: commerce ? { sign_text: "BOUTIQUE", shopfront: true, awning: true, goods_slots: 12 } : null,
      facade: [],
    },
  };
}

export function roadConnectors(kind: string, size: number, lanes: number, oneway: boolean, level = 0, level2 = level): Connector[] {
  const sides = ROAD_SIDES[kind] ?? ["N", "S"];
  return sides.map((s: Side, i) => ({
    id: `c${s.toLowerCase()}`, side: s, kind: "road", lanes, width_cells: size,
    level: kind === "ramp" && i === 0 ? level2 : level,
    flow: oneway ? (i === 0 ? "out" : "in") : "both",
  }));
}

export function roadTemplate(): AssetDefinition {
  return {
    ...base(), representation: "segment", height_m: 0, footprint: { kind: "rect", w: 2, d: 2, cells: null },
    connectors: roadConnectors("straight", 2, 2, false),
    materials: { asphalt: "#4a4e54", marking: "#f3f0e6", sidewalk: "#c9c1b1" },
    placement: { allowed_terrain: ["ground", "sand"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { kind: "straight", lanes: 2, oneway: false, sidewalk: true, markings: "dashed" },
  };
}

export function interiorTemplate(): AssetDefinition {
  return {
    ...base(), representation: "assembly", height_m: 3,
    materials: { floor: "#d8b98a", wall: "#f1e7d6" },
    properties: {
      mode: "instanced", width: 8, depth: 8,
      rooms: [{ id: "piece-1", name: "Pièce principale", type: "living", x: 0, y: 0, w: 8, d: 8 }],
      doors: [{ id: "entree", cell: [3, 7], side: "S", connects: ["piece-1", "exterior"] }],
      furniture: [], spawn: [3, 6], forbidden: [],
    },
  };
}

export function surfaceTemplate(category: string): AssetDefinition {
  const paving = category === "paving";
  return {
    ...base(), representation: "surface", height_m: 0, collision: "none", footprint: { kind: "rect", w: 4, d: 3, cells: null },
    materials: paving ? { base: "#a9a49a", detail: "#8f8a80" } : { base: "#8fbf6a", detail: "#7aac58" },
    placement: { allowed_terrain: ["ground", "sand"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { kind: paving ? "paving" : "grass", terrain: "ground", walkable: true, buildable: !paving, pattern: paving ? "checker" : "dots", texture: null },
  };
}

export function propTemplate(category: string): AssetDefinition {
  const veg = category === "vegetation";
  return {
    ...base(), representation: "procedural", height_m: veg ? 6 : 2, footprint: { kind: "rect", w: 1, d: 1, cells: null },
    materials: veg ? { primary: "#3f8f4a", secondary: "#6b4423" } : { primary: "#3b4a52", secondary: "#c9a227" },
    placement: { allowed_terrain: ["ground", "sand"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { shape: veg ? "tree" : "lamp_post", sprite: null },
  };
}

export function furnitureTemplate(): AssetDefinition {
  return {
    ...base(), representation: "procedural", height_m: 1, footprint: { kind: "rect", w: 1, d: 1, cells: null },
    materials: { primary: "#a07a4a", secondary: "#5a4632" },
    placement: { allowed_terrain: ["ground"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { shape: "box", w: 1, d: 1, height_px: 10, actions: [], sprite: null },
  };
}

export function vehicleTemplate(): AssetDefinition {
  return {
    ...base(), representation: "procedural", height_m: 1.5, footprint: { kind: "rect", w: 1, d: 2, cells: null },
    materials: { body: "#2980b9", trim: "#1d2a30", glass: "#9cc8d6" },
    placement: { allowed_terrain: ["ground", "sand"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { kind: "car", stripe: false, roof_sign: null, seats: 4, parking: "road", anchors: {}, sprite: null },
  };
}

export function characterTemplate(bodyId: string): AssetDefinition {
  return {
    ...base(), representation: "svg", height_m: 1.75, collision: "none", footprint: { kind: "rect", w: 1, d: 1, cells: null },
    materials: {}, placement: { allowed_terrain: ["ground", "sand"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { body: bodyId, skin: "#a86b3c", hair_color: "#1b1b1b", eye_color: "#3b2414", height_scale: 1, layers: {}, role: "", view: "front" },
  };
}

export function partTemplate(mediaId: string, slot: string): AssetDefinition {
  return {
    ...base(), representation: "svg", height_m: 0, collision: "none", footprint: { kind: "rect", w: 1, d: 1, cells: null }, materials: {},
    placement: { allowed_terrain: ["ground"], road_access: "none", safety_margin: 0, max_height_m: null },
    properties: { slot, svg_media: mediaId, offset: [0, 0], scale: 1, anchor: null, z: null, default_colors: {}, palette: {},
      bodies: [], requires_slots: [], incompatible_slots: [], incompatible_parts: [], anchors: {}, game_hint: null, gender: null, genders: [] },
  };
}

export function templateFor(family: string, category: string, extra: { bodyId?: string; mediaId?: string; slot?: string } = {}): AssetDefinition {
  switch (family) {
    case "road": return roadTemplate();
    case "interior": return interiorTemplate();
    case "surface": return surfaceTemplate(category);
    case "prop": return propTemplate(category);
    case "furniture": return furnitureTemplate();
    case "vehicle": return vehicleTemplate();
    case "character": return characterTemplate(extra.bodyId ?? "");
    case "character_part": return partTemplate(extra.mediaId ?? "", extra.slot ?? "top");
    default: return buildingTemplate(category);
  }
}
