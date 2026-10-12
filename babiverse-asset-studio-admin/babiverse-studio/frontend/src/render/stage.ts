// Scènes Phaser : aperçu d'asset (éditeur) et scène de test (placement).
import Phaser from "phaser";
import type { AssetDefinition, FurnitureSpec, Instance, Variant, World } from "../types";
import { PhaserPainter } from "./phaserPainter";
import { drawAsset, drawOverlays, drawTile, iso, screenToGrid, TERRAIN_COLORS, type InteriorOverlay, type OverlayFlags, TW, TH } from "./iso";
import { placedCells, rotatedSize } from "../geometry";
import { onImagesLoaded } from "../character/svgimg";

type CellCb = (x: number, y: number) => void;

abstract class PanZoomScene extends Phaser.Scene {
  private dragFrom: { x: number; y: number; sx: number; sy: number } | null = null;
  private pinch: { d: number; z: number } | null = null;
  protected dragged = false;
  protected onTap?: (wx: number, wy: number) => void;
  protected onHover?: (wx: number, wy: number) => void;
  private offImages: (() => void) | null = null;

  protected setupInput() {
    const cam = this.cameras.main;
    this.input.addPointer(1);
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { this.dragFrom = { x: p.x, y: p.y, sx: cam.scrollX, sy: cam.scrollY }; this.dragged = false; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1, p2 = this.input.pointer2;
      if (p1?.isDown && p2?.isDown) {
        // pincement à deux doigts (tablette, téléphone)
        const d = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (!this.pinch) this.pinch = { d, z: cam.zoom };
        else cam.setZoom(Phaser.Math.Clamp(this.pinch.z * (d / this.pinch.d), 0.3, 4));
        this.dragged = true;
        return;
      }
      this.pinch = null;
      if (this.dragFrom && p.isDown) {
        const dx = p.x - this.dragFrom.x, dy = p.y - this.dragFrom.y;
        if (Math.abs(dx) + Math.abs(dy) > (p.wasTouch ? 10 : 6)) this.dragged = true;
        if (this.dragged) { cam.scrollX = this.dragFrom.sx - dx / cam.zoom; cam.scrollY = this.dragFrom.sy - dy / cam.zoom; }
      } else if (this.onHover) { const w = cam.getWorldPoint(p.x, p.y); this.onHover(w.x, w.y); }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.dragged && this.onTap) { const w = cam.getWorldPoint(p.x, p.y); this.onTap(w.x, w.y); }
      this.dragFrom = null;
      if (!this.input.pointer2?.isDown) this.pinch = null;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy > 0 ? 0.9 : 1.1));
    this.offImages = onImagesLoaded(() => this.imagesReady());
    this.events.once("shutdown", () => this.offImages?.());
    this.events.once("destroy", () => this.offImages?.());
  }
  protected imagesReady() { /* redessin à l'arrivée d'une image */ }
  zoomBy(f: number) { const cam = this.cameras.main; cam.setZoom(Phaser.Math.Clamp(cam.zoom * f, 0.3, 4)); }
}

// ------------------------------------------------------------------ aperçu

export interface PreviewState {
  family: string; def: AssetDefinition; rotation: number; variant: Variant | null; flags: OverlayFlags;
  furniture: Record<string, FurnitureSpec>; highlight?: string | null; overlay?: InteriorOverlay; background?: number;
}

export class PreviewScene extends PanZoomScene {
  state!: PreviewState;
  cellCb: CellCb | null = null;
  private layer!: Phaser.GameObjects.Container;
  private fitted = false;
  constructor() { super("preview"); }

  create() {
    this.cameras.main.setBackgroundColor("#e4ecea");
    this.layer = this.add.container(0, 0);
    this.setupInput();
    this.onTap = (wx, wy) => {
      if (!this.cellCb) return;
      const [gx, gy] = screenToGrid(wx, wy);
      this.cellCb(Math.floor(gx), Math.floor(gy));
    };
    this.scale.on("resize", () => this.fit());
    if (this.state) this.redraw();
  }
  protected imagesReady() { if (this.layer && this.state) this.redraw(); }

  set(state: PreviewState) {
    const famChanged = !this.state || this.state.family !== state.family;
    this.state = state;
    if (famChanged) this.fitted = false;
    if (this.layer) this.redraw();
  }

  private bounds(): [number, number] {
    const s = this.state;
    if (s.family === "interior") return [s.def.properties.width, s.def.properties.depth];
    if (s.family === "furniture") return s.rotation % 180 ? [s.def.properties.d ?? 1, s.def.properties.w ?? 1] : [s.def.properties.w ?? 1, s.def.properties.d ?? 1];
    return rotatedSize(s.def, s.rotation);
  }

  redraw() {
    const s = this.state;
    this.layer.removeAll(true);
    if (s.background != null) this.cameras.main.setBackgroundColor(s.background);
    const g = this.add.graphics();
    this.layer.add(g);
    const p = new PhaserPainter(this, g, this.layer);
    const [w, d] = this.bounds();
    const indoor = s.family === "interior" || s.family === "furniture";
    const m = indoor ? 0 : s.family === "road" ? 2 : s.family === "character" ? 1 : 3;
    // plan de travail : grille de la ville autour de l'asset
    if (s.family !== "furniture") for (let y = -m; y < d + m; y++) for (let x = -m; x < w + m; x++) {
      if (indoor) drawTile(p, x, y, 0xf5f8f7, 1, 0xd3dedb);
      else drawTile(p, x, y, (x + y) % 2 ? 0xa7c48a : 0x9fbd82, 1, s.flags.grid ? 0x88a86c : null);
    }
    if (!indoor && s.flags.footprint) drawOverlays(p, s.family, s.def, { x: 0, y: 0, rotation: s.rotation }, { ...s.flags, collision: false, entrances: false, connectors: false, zones: false, dims: false });
    drawAsset(p, s.family, s.def, { x: 0, y: 0, rotation: s.rotation, variant: s.variant }, s.furniture, s.overlay ?? { highlight: s.highlight });
    if (!indoor) {
      const g2 = this.add.graphics(); this.layer.add(g2);
      drawOverlays(new PhaserPainter(this, g2, this.layer), s.family, s.def, { x: 0, y: 0, rotation: s.rotation }, { ...s.flags, footprint: false, anchors: false });
      if (s.flags.footprint) drawOverlays(new PhaserPainter(this, g2, this.layer), s.family, s.def, { x: 0, y: 0, rotation: s.rotation },
        { grid: false, footprint: true, collision: false, entrances: false, connectors: false, zones: false, dims: false, anchors: true });
    }
    if (!this.fitted) this.fit();
  }

  fit() {
    if (!this.state) return;
    const [w, d] = this.bounds();
    const cam = this.cameras.main;
    const hm = this.state.family === "character" ? 2 : this.state.def.height_m || 0;
    const [cx, cy] = iso(w / 2, d / 2, hm * 3);
    const spanX = (w + d) * TW / 2 + TW * 2, spanY = (w + d) * TH / 2 + (hm || 3) * 9 + TH * 3;
    cam.setZoom(Phaser.Math.Clamp(Math.min(cam.width / spanX, cam.height / spanY), 0.35, this.state.family === "character" ? 4 : 2));
    cam.centerOn(cx, cy);
    this.fitted = true;
  }
}

// ------------------------------------------------------------------ scène de test

export interface CityEntry { asset_id: string; version: number; family: string; definition: AssetDefinition }
export interface Ghost { entry: CityEntry; rotation: number; variant: Variant | null; moving?: string | null }

const LAYER_ORDER: Record<string, number> = { surface: -2000, road: -1000 };
const PICK_PRIORITY: Record<string, number> = { character: 5, vehicle: 4, prop: 3, building: 3, road: 1, surface: 0 };

export class CityScene extends PanZoomScene {
  world!: World;
  defs = new Map<string, { family: string; definition: AssetDefinition }>();
  ghost: Ghost | null = null;
  selected: string | null = null;
  onPick: ((cell: [number, number], inst: Instance | null) => void) | null = null;
  onPlace: ((x: number, y: number) => void) | null = null;
  onHoverCell: ((x: number, y: number) => void) | null = null;
  private instLayer!: Phaser.GameObjects.Container;
  private ghostLayer!: Phaser.GameObjects.Container;
  private hover: [number, number] | null = null;
  private pickMap = new Map<string, Instance>();
  constructor() { super("city"); }

  create() {
    this.cameras.main.setBackgroundColor("#cdd8d5");
    this.add.graphics().setName("terrain");
    this.instLayer = this.add.container(0, 0);
    this.ghostLayer = this.add.container(0, 0).setDepth(1e9);
    this.setupInput();
    this.onTap = (wx, wy) => {
      const [gx, gy] = screenToGrid(wx, wy); const x = Math.floor(gx), y = Math.floor(gy);
      if (this.ghost) { this.hover = [x, y]; this.drawGhost(); this.onPlace?.(x, y); }
      else this.onPick?.([x, y], this.pickMap.get(`${x},${y}`) ?? null);
    };
    this.onHover = (wx, wy) => {
      const [gx, gy] = screenToGrid(wx, wy); const c: [number, number] = [Math.floor(gx), Math.floor(gy)];
      if (!this.hover || this.hover[0] !== c[0] || this.hover[1] !== c[1]) { this.hover = c; this.drawGhost(); this.onHoverCell?.(c[0], c[1]); }
    };
    if (this.world) this.loadWorld(this.world, this.defs);
  }
  protected imagesReady() { if (this.instLayer && this.world) { this.drawInstances(); this.drawGhost(); } }

  loadWorld(world: World, defs: Map<string, { family: string; definition: AssetDefinition }>, recenter = false) {
    this.world = world; this.defs = defs;
    if (!this.instLayer) return;
    const tg = this.children.getByName("terrain") as Phaser.GameObjects.Graphics;
    tg.clear();
    const tp = new PhaserPainter(this, tg, this.instLayer);
    for (let y = 0; y < world.height; y++) for (let x = 0; x < world.width; x++) {
      const t = world.terrain[y][x];
      const base = TERRAIN_COLORS[t] ?? TERRAIN_COLORS.g;
      drawTile(tp, x, y, (x + y) % 2 && t !== "w" ? base : t === "w" ? base : 0x96b475, 1, null);
    }
    this.drawInstances();
    if (recenter || (!this.cameras.main.scrollX && !this.cameras.main.scrollY)) {
      const [cx, cy] = iso(world.width / 2, world.height / 3); this.cameras.main.centerOn(cx, cy); this.cameras.main.setZoom(world.width > 30 ? 0.9 : 1.2);
    }
  }

  drawInstances() {
    this.instLayer.removeAll(true);
    this.pickMap.clear();
    const prio = new Map<string, number>();
    const items = this.world.instances.map((i) => {
      const d = this.defs.get(`${i.asset_id}@${i.version}`);
      if (!d) return null;
      const cells = placedCells(d.definition, i.x, i.y, i.rotation);
      const pr = PICK_PRIORITY[d.family] ?? 2;
      for (const c of cells) {
        const k = c.join(",");
        if ((prio.get(k) ?? -1) <= pr) { prio.set(k, pr); this.pickMap.set(k, i); }
      }
      const depth = Math.max(...cells.map((c) => c[0] + c[1])) + (LAYER_ORDER[d.family] ?? 0) + (d.family === "character" ? 0.5 : 0);
      return { i, d, depth };
    }).filter(Boolean) as { i: Instance; d: { family: string; definition: AssetDefinition }; depth: number }[];
    items.sort((a, b) => a.depth - b.depth);
    for (const { i, d } of items) {
      const c = this.add.container(0, 0); this.instLayer.add(c);
      const g = this.add.graphics(); c.add(g);
      const p = new PhaserPainter(this, g, c);
      const variant = d.definition.variants.find((v) => v.id === i.variant_id) ?? null;
      if (this.selected === i.id) for (const [x, y] of placedCells(d.definition, i.x, i.y, i.rotation)) drawTile(p, x, y, 0xb8336a, 0.35, 0xb8336a);
      drawAsset(p, d.family, d.definition, { x: i.x, y: i.y, rotation: i.rotation, variant, alpha: this.ghost?.moving === i.id ? 0.35 : 1 });
    }
  }

  setGhost(g: Ghost | null) { this.ghost = g; this.drawGhost(); }

  private drawGhost() {
    if (!this.ghostLayer) return;
    this.ghostLayer.removeAll(true);
    if (!this.ghost || !this.hover) return;
    const g = this.add.graphics(); this.ghostLayer.add(g);
    const p = new PhaserPainter(this, g, this.ghostLayer);
    const { entry, rotation, variant } = this.ghost;
    const [x, y] = this.hover;
    const cells = placedCells(entry.definition, x, y, rotation);
    // indication locale seulement : le serveur reste l'autorité (couches, terrain, accès, raccords)
    const out = cells.some((c) => c[0] < 0 || c[1] < 0 || c[0] >= this.world.width || c[1] >= this.world.height);
    const sameLayer = (c: number[]) => {
      const o = this.pickMap.get(c.join(","));
      if (!o || o.id === this.ghost?.moving) return false;
      const fam = this.defs.get(`${o.asset_id}@${o.version}`)?.family;
      if (entry.family === "surface") return fam === "surface" || fam === "road";
      if (entry.family === "character") return fam === "building" || fam === "prop";
      if (entry.family === "vehicle") return fam !== "road" && fam !== "surface";
      return fam !== "surface";
    };
    const blocked = out || cells.some(sameLayer);
    for (const [cx, cy] of cells) drawTile(p, cx, cy, blocked ? 0xc0392b : 0x2f9e6e, 0.4, blocked ? 0xc0392b : 0x2f9e6e);
    g.setAlpha(0.95);
    const g2 = this.add.graphics().setAlpha(0.75); this.ghostLayer.add(g2);
    const gp = new PhaserPainter(this, g2, this.ghostLayer);
    drawAsset(gp, entry.family, entry.definition, { x, y, rotation, variant, alpha: 0.75 });
    if (entry.family === "building") drawOverlays(gp, entry.family, entry.definition, { x, y, rotation }, { grid: false, footprint: false, collision: false, entrances: true, connectors: false, zones: false, dims: false });
    if (entry.family === "road") drawOverlays(gp, entry.family, entry.definition, { x, y, rotation }, { grid: false, footprint: false, collision: false, entrances: false, connectors: true, zones: false, dims: false });
  }
}

export function mountGame(parent: HTMLElement, scene: Phaser.Scene): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO, parent, backgroundColor: "#e4ecea", antialias: true,
    scale: { mode: Phaser.Scale.RESIZE, width: parent.clientWidth || 600, height: parent.clientHeight || 400 },
    scene, banner: false, audio: { noAudio: true }, input: { activePointers: 2 },
  });
}
