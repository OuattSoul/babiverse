// Miroir client de backend/app/geometry.py — le serveur reste l'autorité, le client s'en sert pour l'aperçu.
import type { AssetDefinition, Cell, Footprint, Side } from "./types";

export const SIDES: Side[] = ["N", "E", "S", "W"];
export const DELTA: Record<Side, Cell> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
export const OPPOSITE: Record<Side, Side> = { N: "S", S: "N", E: "W", W: "E" };

export function rotateSide(side: Side, rotation: number): Side {
  const steps = ((rotation / 90) % 4 + 4) % 4;
  return SIDES[(SIDES.indexOf(side) + steps) % 4];
}

export function footprintCells(fp: Footprint): Cell[] {
  if (fp.kind === "rect") {
    const out: Cell[] = [];
    for (let y = 0; y < fp.d; y++) for (let x = 0; x < fp.w; x++) out.push([x, y]);
    return out;
  }
  return (fp.cells || []).map((c) => [c[0], c[1]] as Cell);
}

export class Transform {
  steps: number; minX = 0; minY = 0;
  constructor(cells: Cell[], rotation: number) {
    this.steps = ((rotation / 90) % 4 + 4) % 4;
    const r = cells.map((c) => this.rot(c));
    if (r.length) { this.minX = Math.min(...r.map((c) => c[0])); this.minY = Math.min(...r.map((c) => c[1])); }
  }
  private rot([x, y]: Cell): Cell { for (let i = 0; i < this.steps; i++) [x, y] = [-y, x]; return [x, y]; }
  cell(c: Cell): Cell { const [x, y] = this.rot(c); return [x - this.minX, y - this.minY]; }
  side(s: Side): Side { return SIDES[(SIDES.indexOf(s) + this.steps) % 4]; }
  /** Point continu (coin de case) : utilisé pour les coordonnées de dessin. */
  point(px: number, py: number, w0: number, d0: number): [number, number] {
    // rotation autour de l'origine de la boîte englobante, puis recalage
    let x = px, y = py;
    for (let i = 0; i < this.steps; i++) [x, y] = [-y, x];
    // boîte englobante tournée de [0,w0]x[0,d0]
    const corners: Cell[] = [[0, 0], [w0, 0], [0, d0], [w0, d0]].map(([a, b]) => { let u = a, v = b; for (let i = 0; i < this.steps; i++) [u, v] = [-v, u]; return [u, v] as Cell; });
    const mx = Math.min(...corners.map((c) => c[0])), my = Math.min(...corners.map((c) => c[1]));
    return [x - mx, y - my];
  }
}

export function placedCells(def: AssetDefinition, x: number, y: number, rotation: number): Cell[] {
  const base = footprintCells(def.footprint);
  const t = new Transform(base, rotation);
  return base.map((c) => { const [cx, cy] = t.cell(c); return [x + cx, y + cy] as Cell; });
}

export function rotatedSize(def: AssetDefinition, rotation: number): [number, number] {
  const cells = placedCells(def, 0, 0, rotation);
  return [Math.max(...cells.map((c) => c[0])) + 1, Math.max(...cells.map((c) => c[1])) + 1];
}

export function placedEntrances(def: AssetDefinition, x: number, y: number, rotation: number) {
  const base = footprintCells(def.footprint);
  const t = new Transform(base, rotation);
  return def.entrances.map((e) => {
    const [cx, cy] = t.cell(e.cell);
    const side = t.side(e.side);
    return { ...e, cell: [x + cx, y + cy] as Cell, side };
  });
}

export const ROAD_SIDES: Record<string, Side[]> = {
  straight: ["N", "S"], ramp: ["N", "S"], curve_left: ["S", "W"], curve_right: ["E", "S"],
  tee: ["E", "S", "W"], cross: ["E", "N", "S", "W"], end: ["S"],
};
