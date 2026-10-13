import type { KitSpec } from "./modular/compose";

export type Side = "N" | "E" | "S" | "W";
export type Cell = [number, number];
export type Family = "building" | "interior" | "road" | "prop" | "vehicle" | "surface" | "character" | "character_part" | "furniture" | "component";
export type Capability = "available" | "experimental" | "unavailable";

export interface Footprint { kind: "rect" | "cells"; w: number; d: number; cells?: Cell[] | null }
export interface Entrance { id: string; cell: Cell; side: Side; kind: "main" | "service" | "emergency" | "delivery" }
export interface Connector { id: string; side: Side; kind: "road"; lanes: number; width_cells: number; level: number; flow: "both" | "in" | "out" }
export interface Zone { id: string; kind: "interaction" | "safety" | "forbidden" | "delivery" | "parking"; label: string; cells: Cell[] }
export interface Variant { id: string; name: string; description?: string; materials: Record<string, string>; props: Record<string, any> }
export interface BehaviorRef { id: string; params: Record<string, any> }

export interface AssetDefinition {
  name: string; description: string; subcategory: string | null; tags: string[];
  representation: "procedural" | "segment" | "surface" | "assembly" | "model" | "sprite" | "svg" | "modular";
  unit: "cell"; cell_size_m: number; footprint: Footprint; height_m: number; anchor: Cell;
  default_rotation: 0 | 90 | 180 | 270; entrances: Entrance[]; connectors: Connector[];
  collision: "footprint" | "none"; zones: Zone[]; materials: Record<string, string>; variants: Variant[];
  default_variant?: string | null;
  placement: { allowed_terrain: string[]; road_access: "required" | "preferred" | "none"; safety_margin: number; max_height_m: number | null };
  resources: string[]; cover?: string | null; behaviors: BehaviorRef[]; properties: any;
}

export interface ReportItem { level: "error" | "warning"; code: string; message: string; path: string }
export interface Report { ok: boolean; errors: number; warnings: number; items: ReportItem[] }

export interface AssetSummary {
  id: string; technical_name: string; category: string; family: Family; name: string; subcategory: string | null;
  tags: string[]; footprint: Footprint; height_m: number; status: string; latest_version: number;
  published_version: number | null; archived: boolean; derived_from: string | null; instances: number;
  created_at: number; updated_at: number; created_by: string; preview: AssetDefinition;
  errors: number | null; warnings: number | null; variants: number;
}
export interface Pins { assets: Record<string, number>; media: Record<string, number> }
export interface VersionMeta {
  version: number; status: string; created_by: string; created_at: number; updated_at: number; published_at: number | null;
  instances: number; note: string | null; pins: Pins | null;
}
export interface Usage {
  instances: { scene_id: string; scene_name: string | null; version: number; n: number }[];
  referenced_by: { asset_id: string; technical_name: string; name: string; family: Family; version: number; status: string; archived: boolean }[];
}
export interface AssetDetail extends AssetSummary { definition: AssetDefinition; validation: Report | null; versions: VersionMeta[]; usage: Usage }

export interface Category { key: string; label: string; family: Family; rules: string[]; subcategories: string[]; description: string; builtin: boolean; archived: boolean }
export interface FurnitureSpec { label: string; w: number; d: number; actions: string[]; color: string; h?: number }
export interface FamilyInfo {
  label: string; implemented: boolean; representation: string; representations: string[]; description: string;
  capabilities: Record<string, Capability>; limits: string; game: "adapter" | "unavailable";
}
export interface BehaviorParam { type: "int" | "float" | "bool" | "str" | "choice"; label: string; default: any; min?: number; max?: number; options?: string[] }
export interface BehaviorSpec { label: string; families: Family[]; engine: "game" | "preview"; description: string; params: Record<string, BehaviorParam>; requires?: string }
export interface SlotSpec { label: string; z: number; back_z: number; required?: boolean }
export interface Taxonomy {
  families: Record<Family, FamilyInfo>;
  categories: Category[]; category_rules: Record<string, string>; material_slots: Record<string, string[]>; slot_labels: Record<string, string>;
  furniture: Record<string, FurnitureSpec>; interior_tiles_per_cell: number; facade_modules: Record<string, { label: string; floors: string }>;
  prop_shapes: Record<string, { label: string; w: number; d: number; h: number }>; furniture_shapes: Record<string, string>;
  vehicle_kinds: Record<string, { label: string; w: number; d: number; h: number }>; surface_kinds: Record<string, { label: string; terrain: string }>;
  character_slots: Record<string, SlotSpec>; character_frame: number[]; global_channels: string[]; layer_channels: string[];
  body_anchors: string[]; reference_anchors: Record<string, [number, number]>; placeable: Family[];
  kits: Record<string, KitSpec>; genders: Record<string, string>;
  behaviors: Record<string, BehaviorSpec>; permissions: Record<string, string>;
  roles: Record<string, { label: string; permissions: string[] }>; media_categories: Record<string, string>;
  limits: { upload_mb: number; import_mb: number; image_px: number; model_mb?: number };
}
export interface User { id: number; username: string; role: string; role_label: string; permissions: string[]; dev?: boolean; active?: boolean }
export interface CatalogEntry { asset_id: string; technical_name: string; category: string; family: Family; version: number; definition: AssetDefinition; pins: Pins | null }
export interface Instance {
  id: string; asset_id: string; version: number; x: number; y: number; rotation: number; variant_id: string | null; owner_id: number;
  scene_id?: string; data?: { label?: string };
}
export interface World { id: string; name: string; description: string; width: number; height: number; terrain: string[]; instances: Instance[]; notice?: string }
export interface SceneSummary { id: string; name: string; description: string; width: number; height: number; instances: number; updated_at: number; created_by: string }

export interface Media {
  id: string; name: string; filename: string; kind: "svg" | "raster" | "model"; mime: string; size: number; sha256: string;
  width: number; height: number; tags: string[]; category: string; revision: number; archived: boolean;
  created_by: string; created_at: number; updated_at: number; url: string;
  meta: { view_box?: number[]; colors?: Record<string, number>; channels?: Record<string, string>; recolorable?: boolean;
          has_back_layer?: boolean; warnings?: string[]; removed?: Record<string, number>;
          // modèles 3D (GLB / glTF) : dimensions en unités du modèle (1 unité = 1 case à l'échelle 1), objets nommés
          format?: string; bbox?: number[]; size?: number[]; triangles?: number; materials?: number; textures?: number;
          objects?: { name: string; node: number; box: number[]; unique: boolean }[] };
}
export interface MediaDetail extends Media {
  map_usage?: { map_id: string; name: string; status: string; uses: { where: string; revision: number | null }[] }[];
  usage: { asset_id: string; technical_name: string; name: string; family: Family; version: number; status: string; archived: boolean; pinned_revision: number | null }[];
  revisions: { revision: number; filename: string; size: number; created_by: string; created_at: number; url: string }[];
}

export interface PartPayload {
  kit?: string;
  id: string; technical_name: string; name: string; version: number; status: string; published_version: number | null; archived: boolean;
  slot: string; props: any; tags: string[]; view_box: number[] | null; channels: Record<string, string>; z: number; back_z: number;
  defs: string; back: string; front: string;
}
export interface CharacterRender { asset_id: string; version: number; status: string; definition: AssetDefinition; parts: Record<string, PartPayload>; pinned: boolean }
