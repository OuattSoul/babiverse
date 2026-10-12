// Rendu isométrique procédural de Babiverse : bâtiments, routes, intérieurs, surfaces, objets, véhicules,
// personnages, terrain et calques d'édition. Toutes les familles passent par drawAsset.
import type { AssetDefinition, Cell, Side, Variant, FurnitureSpec } from "../types";
import { DELTA, footprintCells, placedCells, placedEntrances, rotateSide, rotatedSize, Transform } from "../geometry";
import { dashed, type Painter } from "./painter";

export const TW = 64, TH = 32, PX_PER_M = 9;

export function iso(gx: number, gy: number, z = 0): [number, number] {
  return [(gx - gy) * (TW / 2), (gx + gy) * (TH / 2) - z];
}
export function screenToGrid(sx: number, sy: number): [number, number] {
  const a = sx / (TW / 2), b = sy / (TH / 2);
  return [(a + b) / 2, (b - a) / 2];
}
export const col = (h: string | undefined, fallback = 0x999999) => (h && /^#[0-9a-f]{6}$/i.test(h) ? parseInt(h.slice(1), 16) : fallback);
export function shade(c: number, f: number): number {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f)), g = Math.min(255, Math.round(((c >> 8) & 255) * f)), b = Math.min(255, Math.round((c & 255) * f));
  return (r << 16) | (g << 8) | b;
}
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => [(a >> s) & 255, (b >> s) & 255];
  const m = (s: number) => { const [x, y] = ch(s); return Math.round(x + (y - x) * t); };
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
const P = (...pts: [number, number][]) => pts.flat();

export const TERRAIN_COLORS: Record<string, number> = { g: 0x9bb97a, s: 0xe6d3a3, w: 0x3d8db0 };

// Résolveurs injectés par l'interface : URL signée d'un média, image composée d'un personnage.
let mediaUrl: (id: string) => string | null = () => null;
let characterImage: (def: AssetDefinition, variant: Variant | null) => string | null = () => null;
export function setMediaResolver(fn: (id: string) => string | null) { mediaUrl = fn; }
export function setCharacterResolver(fn: (def: AssetDefinition, variant: Variant | null) => string | null) { characterImage = fn; }
// assemblage modulaire composé (SVG) : URL de l'image + repère du kit (pour poser la ligne de sol au bon endroit)
export interface ModularImage { url: string; frame: number[]; ground: number; view: "front" | "top" }
let modularImage: (def: AssetDefinition, variant: Variant | null) => ModularImage | null = () => null;
export function setModularResolver(fn: (def: AssetDefinition, variant: Variant | null) => ModularImage | null) { modularImage = fn; }

export function drawTile(p: Painter, x: number, y: number, fill: number, alpha = 1, stroke: number | null = null) {
  p.poly(P(iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)), fill, alpha, stroke, 1);
}

export interface Place { x: number; y: number; rotation: number; variant?: Variant | null; alpha?: number }

export function resolved(def: AssetDefinition, variant?: Variant | null) {
  const mats = { ...def.materials, ...(variant?.materials || {}) };
  const props = JSON.parse(JSON.stringify(def.properties || {}));
  if (variant?.props) {
    if (variant.props.roof && props.style) props.style.roof = variant.props.roof;
    if (variant.props.sign_text != null && props.shop) props.shop.sign_text = variant.props.sign_text;
    if (variant.props.awning != null && props.shop) props.shop.awning = variant.props.awning;
    if (variant.props.markings) props.markings = variant.props.markings;
    if (variant.props.pattern) props.pattern = variant.props.pattern;
    if (variant.props.roof_sign != null) props.roof_sign = variant.props.roof_sign;
    if (variant.props.stripe != null) props.stripe = variant.props.stripe;
  }
  return { mats, props };
}

// ------------------------------------------------------------------ bâtiments

export function drawBuilding(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const wall = col(mats.wall, 0xe6d6b8), roof = col(mats.roof, 0x9a4f3a), trim = col(mats.trim, 0x3a5a6a);
  const floors = Math.max(1, props.floors || 1);
  const style = props.style || { roof: "flat", window_style: "grid", door_style: "wood" };
  const H = Math.max(def.height_m, 2.5) * PX_PER_M;
  const roofKind = def.footprint.kind === "rect" ? style.roof : "flat";
  const wallH = roofKind === "flat" ? H : Math.max(H * 0.66, floors * 2.6 * PX_PER_M);
  const fh = wallH / floors;
  const cells = placedCells(def, pl.x, pl.y, pl.rotation);
  const set = new Set(cells.map((c) => c.join(",")));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  const ents = placedEntrances(def, pl.x, pl.y, pl.rotation);
  const doorAt = new Map(ents.map((e) => [`${e.cell[0]},${e.cell[1]},${e.side}`, e]));
  const doorColor = { wood: 0x6b4423, glass: 0x8fc9d9, metal: 0x737b82 }[style.door_style as string] ?? 0x6b4423;
  const shop = props.shop && props.shop.shopfront ? props.shop : null;
  const mainSide = ents.find((e) => e.kind === "main")?.side;
  // modules de façade (assemblage), exprimés dans le repère de l'asset : on applique la même rotation
  const t = new Transform(footprintCells(def.footprint), pl.rotation);
  const modules = new Map<string, string>();
  for (const s of props.facade ?? []) {
    const [cx, cy] = t.cell(s.cell as Cell);
    modules.set(`${pl.x + cx},${pl.y + cy},${t.side(s.side)},${s.floor}`, s.module);
  }

  // ombre portée
  const [sw, sd] = rotatedSize(def, pl.rotation);
  p.poly(P(iso(pl.x + 0.15, pl.y + sd + 0.05), iso(pl.x + sw + 0.15, pl.y + sd + 0.05), iso(pl.x + sw + 0.35, pl.y + sd + 0.35), iso(pl.x + 0.35, pl.y + sd + 0.35)), 0x000000, 0.08);

  // murs visibles : faces Sud (y+1) et Est (x+1) de chaque case, de l'arrière vers l'avant
  const sorted = [...cells].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  for (const [x, y] of sorted) {
    const mods = (side: Side) => Array.from({ length: floors }, (_, f) => modules.get(`${x},${y},${side},${f}`) ?? "auto");
    if (!has(x, y + 1)) face(p, "S", x, y, wallH, shade(wall, 0.8), trim, fh, floors, style.window_style, doorAt.get(`${x},${y},S`), doorColor, shop && mainSide === "S", mods("S"));
    if (!has(x + 1, y)) face(p, "E", x, y, wallH, shade(wall, 0.94), trim, fh, floors, style.window_style, doorAt.get(`${x},${y},E`), doorColor, shop && mainSide === "E", mods("E"));
    if (roofKind === "flat") {
      p.poly(P(iso(x, y, wallH), iso(x + 1, y, wallH), iso(x + 1, y + 1, wallH), iso(x, y + 1, wallH)), roof, 1);
    }
  }
  if (roofKind === "flat") {
    // acrotère sur le contour
    for (const [x, y] of cells) {
      if (!has(x, y - 1)) p.line(P(iso(x, y, wallH), iso(x + 1, y, wallH)), trim, 2);
      if (!has(x - 1, y)) p.line(P(iso(x, y, wallH), iso(x, y + 1, wallH)), trim, 2);
      if (!has(x, y + 1)) p.line(P(iso(x, y + 1, wallH), iso(x + 1, y + 1, wallH)), trim, 2);
      if (!has(x + 1, y)) p.line(P(iso(x + 1, y, wallH), iso(x + 1, y + 1, wallH)), trim, 2);
    }
  } else {
    pitchedRoof(p, pl.x, pl.y, sw, sd, wallH, Math.max(H - wallH, Math.min(sw, sd) * 8), roof, wall, roofKind);
  }

  if (shop) shopfront(p, shop, ents.find((e) => e.kind === "main"), pl, sw, sd, fh, trim);
}

function face(p: Painter, side: "S" | "E", x: number, y: number, h: number, fill: number, trim: number, fh: number, floors: number,
              windows: string, door: any, doorColor: number, isShopFace: boolean | null, mods: string[]) {
  // segment de base de la face
  const a: [number, number] = side === "S" ? [x, y + 1] : [x + 1, y];
  const b: [number, number] = side === "S" ? [x + 1, y + 1] : [x + 1, y + 1];
  const at = (t: number, z: number, out = 0) => {
    const [ox, oy] = side === "S" ? [0, out] : [out, 0];
    return iso(a[0] + (b[0] - a[0]) * t + ox, a[1] + (b[1] - a[1]) * t + oy, z);
  };
  p.poly(P(at(0, 0), at(1, 0), at(1, h), at(0, h)), fill, 1);
  p.line(P(at(0, 2), at(1, 2)), shade(fill, 0.75), 2);
  const glass = (t0: number, t1: number, z0: number, z1: number) =>
    p.poly(P(at(t0, z0), at(t1, z0), at(t1, z1), at(t0, z1)), 0x34505e, 1, 0xf3efe6, 1.2);
  const drawDoor = (kind: string, color: number) => {
    const dh = Math.min(fh * 0.8, 2.3 * PX_PER_M);
    p.poly(P(at(0.3, 0), at(0.7, 0), at(0.7, dh), at(0.3, dh)), color, 1, trim, 1.5);
    if (kind === "main") p.poly(P(at(0.24, -1), at(0.76, -1), at(0.8, -4), at(0.2, -4)), 0xd8d2c4, 1);
  };
  for (let f = 0; f < floors; f++) {
    const z0 = f * fh;
    const mod = mods[f] ?? "auto";
    if (mod === "auto") {
      if (f === 0 && door) continue;
      if (f === 0 && isShopFace) {
        p.poly(P(at(0.08, z0 + fh * 0.12), at(0.92, z0 + fh * 0.12), at(0.92, z0 + fh * 0.62), at(0.08, z0 + fh * 0.62)), 0x9cc8d6, 1, shade(trim, 1), 1.5);
        continue;
      }
      if (windows === "none") continue;
      const [t0, t1] = windows === "band" ? [0.04, 0.96] : [0.28, 0.72];
      glass(t0, t1, z0 + fh * 0.38, z0 + fh * 0.78);
      continue;
    }
    if (mod === "window") glass(0.28, 0.72, z0 + fh * 0.38, z0 + fh * 0.78);
    else if (mod === "window_band") glass(0.04, 0.96, z0 + fh * 0.36, z0 + fh * 0.8);
    else if (mod === "shutters") {
      glass(0.32, 0.68, z0 + fh * 0.36, z0 + fh * 0.8);
      p.poly(P(at(0.14, z0 + fh * 0.36), at(0.3, z0 + fh * 0.36), at(0.3, z0 + fh * 0.8), at(0.14, z0 + fh * 0.8)), trim, 1);
      p.poly(P(at(0.7, z0 + fh * 0.36), at(0.86, z0 + fh * 0.36), at(0.86, z0 + fh * 0.8), at(0.7, z0 + fh * 0.8)), trim, 1);
    } else if (mod === "claustra") {
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
        const t0 = 0.2 + i * 0.16, z = z0 + fh * (0.4 + j * 0.2);
        p.poly(P(at(t0, z), at(t0 + 0.11, z), at(t0 + 0.11, z + fh * 0.14), at(t0, z + fh * 0.14)), shade(fill, 0.6), 1);
      }
    } else if (mod === "balcony") {
      glass(0.3, 0.7, z0 + fh * 0.12, z0 + fh * 0.85);
      p.poly(P(at(0.08, z0 + 1), at(0.92, z0 + 1), at(0.92, z0 + 1, 0.35), at(0.08, z0 + 1, 0.35)), shade(fill, 0.7), 1);
      p.line(P(at(0.08, z0 + fh * 0.4, 0.35), at(0.92, z0 + fh * 0.4, 0.35)), trim, 1.5);
      for (const tt of [0.08, 0.3, 0.5, 0.7, 0.92]) p.line(P(at(tt, z0 + 1, 0.35), at(tt, z0 + fh * 0.4, 0.35)), trim, 1);
    } else if (mod === "door") drawDoor(door?.kind ?? "main", doorColor);
    else if (mod === "shopfront") p.poly(P(at(0.08, z0 + fh * 0.12), at(0.92, z0 + fh * 0.12), at(0.92, z0 + fh * 0.62), at(0.08, z0 + fh * 0.62)), 0x9cc8d6, 1, shade(trim, 1), 1.5);
    else if (mod === "garage") {
      const gh = Math.min(fh * 0.75, 2.2 * PX_PER_M);
      p.poly(P(at(0.12, 0), at(0.88, 0), at(0.88, gh), at(0.12, gh)), 0x8a9298, 1, trim, 1.2);
      for (let k = 1; k < 5; k++) p.line(P(at(0.12, (gh * k) / 5), at(0.88, (gh * k) / 5)), 0x6f777d, 1);
    }
  }
  if (door && mods[0] === "auto") drawDoor(door.kind, door.kind === "main" ? doorColor : shade(trim, 1.1));
  p.line(P(at(0, h), at(1, h)), trim, 1.5);
}

function pitchedRoof(p: Painter, x: number, y: number, w: number, d: number, z: number, rh: number, roof: number, wall: number, kind: string) {
  const top = z + rh;
  const alongX = w >= d;
  if (alongX) {
    const ym = y + d / 2;
    const inset = kind === "hip" ? Math.min(d / 2, w / 2) : 0;
    const r1 = iso(x + inset, ym, top), r2 = iso(x + w - inset, ym, top);
    p.poly(P(iso(x, y, z), iso(x + w, y, z), r2, r1), shade(roof, 0.78), 1);                    // versant Nord
    if (kind === "hip") p.poly(P(iso(x, y, z), iso(x, y + d, z), r1), shade(roof, 0.7), 1);       // croupe Ouest
    if (kind === "hip") p.poly(P(iso(x + w, y, z), iso(x + w, y + d, z), r2), shade(roof, 0.92), 1); // croupe Est
    else p.poly(P(iso(x + w, y, z), iso(x + w, y + d, z), r2), shade(wall, 0.94), 1);              // pignon Est
    p.poly(P(iso(x, y + d, z), iso(x + w, y + d, z), r2, r1), roof, 1);                           // versant Sud
    p.line(P(r1, r2), shade(roof, 0.6), 2);
  } else {
    const xm = x + w / 2;
    const inset = kind === "hip" ? w / 2 : 0;
    const r1 = iso(xm, y + inset, top), r2 = iso(xm, y + d - inset, top);
    p.poly(P(iso(x, y, z), iso(x, y + d, z), r2, r1), shade(roof, 0.72), 1);                     // versant Ouest
    if (kind === "hip") p.poly(P(iso(x, y, z), iso(x + w, y, z), r1), shade(roof, 0.78), 1);
    p.poly(P(iso(x + w, y, z), iso(x + w, y + d, z), r2, r1), shade(roof, 0.95), 1);              // versant Est
    if (kind === "hip") p.poly(P(iso(x, y + d, z), iso(x + w, y + d, z), r2), roof, 1);
    else p.poly(P(iso(x, y + d, z), iso(x + w, y + d, z), r2), shade(wall, 0.8), 1);               // pignon Sud
    p.line(P(r1, r2), shade(roof, 0.6), 2);
  }
}

function shopfront(p: Painter, shop: any, main: { cell: Cell; side: Side } | undefined, pl: Place, w: number, d: number, fh: number, trim: number) {
  if (!main || (main.side !== "S" && main.side !== "E")) return;
  const S = main.side === "S";
  const a: [number, number] = S ? [pl.x, pl.y + d] : [pl.x + w, pl.y];
  const b: [number, number] = S ? [pl.x + w, pl.y + d] : [pl.x + w, pl.y + d];
  const [ox, oy] = DELTA[main.side];
  const at = (t: number, z: number, out = 0) => iso(a[0] + (b[0] - a[0]) * t + ox * out, a[1] + (b[1] - a[1]) * t + oy * out, z);
  const zA = fh * 0.58;
  if (shop.awning) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      p.poly(P(at(t0, zA), at(t1, zA), at(t1, zA - 9, 0.38), at(t0, zA - 9, 0.38)), i % 2 ? 0xf6f1e4 : trim, 1);
    }
  }
  if (shop.sign_text) {
    const z0 = zA + 2, z1 = Math.min(zA + 15, fh - 1);
    p.poly(P(at(0.06, z0), at(0.94, z0), at(0.94, z1), at(0.06, z1)), 0xfbf7ec, 1, trim, 1.5);
    const [cx, cy] = at(0.5, (z0 + z1) / 2);
    p.text(cx, cy, String(shop.sign_text).slice(0, 24), { size: 8, bold: true, color: trim });
  }
}

// ------------------------------------------------------------------ routes

export function drawRoad(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const asphalt = col(mats.asphalt, 0x4a4e54), marking = col(mats.marking, 0xf3f0e6), walk = col(mats.sidewalk, 0xc9c1b1);
  const n = def.footprint.w, x = pl.x, y = pl.y;
  const conns = def.connectors.map((c) => ({ ...c, side: rotateSide(c.side, pl.rotation) }));
  const level = Math.max(0, ...def.connectors.map((c) => c.level)) * 10;
  if (level) p.poly(P(iso(x, y + n, 0), iso(x + n, y + n, 0), iso(x + n, y + n, level), iso(x, y + n, level)), 0x8f8a80, 1);
  p.poly(P(iso(x, y, level), iso(x + n, y, level), iso(x + n, y + n, level), iso(x, y + n, level)), asphalt, 1);
  const sw = props.sidewalk ? 0.2 : 0;
  const strip = (s: Side) => {
    const q = { N: [[x, y], [x + n, y], [x + n, y + sw], [x, y + sw]], S: [[x, y + n - sw], [x + n, y + n - sw], [x + n, y + n], [x, y + n]],
      W: [[x, y], [x + sw, y], [x + sw, y + n], [x, y + n]], E: [[x + n - sw, y], [x + n, y], [x + n, y + n], [x + n - sw, y + n]] }[s];
    p.poly(q.flatMap(([a, b]) => iso(a, b, level)), walk, 1);
  };
  const connected = new Set(conns.map((c) => c.side));
  if (sw) {
    for (const s of ["N", "E", "S", "W"] as Side[]) if (!connected.has(s)) strip(s);
    for (const [cx, cy] of [[x, y], [x + n - sw, y], [x, y + n - sw], [x + n - sw, y + n - sw]])
      p.poly(P(iso(cx, cy, level), iso(cx + sw, cy, level), iso(cx + sw, cy + sw, level), iso(cx, cy + sw, level)), walk, 1);
  }
  const c: [number, number] = [x + n / 2, y + n / 2];
  const mid = (s: Side): [number, number] => ({ N: [x + n / 2, y], S: [x + n / 2, y + n], E: [x + n, y + n / 2], W: [x, y + n / 2] }[s] as [number, number]);
  const perp = (s: Side): [number, number] => (s === "N" || s === "S" ? [1, 0] : [0, 1]);
  const markings = props.markings || "dashed";
  const usable = n - 2 * sw;
  for (const k of conns) {
    const m = mid(k.side), [px, py] = perp(k.side);
    const line = (off: number, dash: boolean, w = 1.6, alpha = 0.95) => {
      const a = iso(m[0] + px * off, m[1] + py * off, level), b = iso(c[0] + px * off, c[1] + py * off, level);
      if (dash) dashed(p, a, b, marking, w, 6, 5, alpha); else p.line([...a, ...b], marking, w, alpha);
    };
    if (!props.oneway && markings !== "none") {
      if (markings === "double") { line(-0.05, false); line(0.05, false); } else line(0, markings === "dashed");
    }
    const lanes = props.lanes || 2, lw = usable / lanes;
    for (let i = 1; i < lanes; i++) {
      const off = -usable / 2 + i * lw;
      if (Math.abs(off) < 0.01 && !props.oneway) continue;
      line(off, true, 1, 0.55);
    }
    if (props.oneway) {
      // flèche dans le sens de circulation (entrée -> sortie)
      const towardCenter = k.flow === "in";
      const a = towardCenter ? m : c, b = towardCenter ? c : m;
      const tip = iso(a[0] + (b[0] - a[0]) * 0.75, a[1] + (b[1] - a[1]) * 0.75, level);
      const base = iso(a[0] + (b[0] - a[0]) * 0.45, a[1] + (b[1] - a[1]) * 0.45, level);
      p.line([...base, ...tip], marking, 2.2);
      const ang = Math.atan2(tip[1] - base[1], tip[0] - base[0]);
      p.line([tip[0] - 7 * Math.cos(ang - 0.5), tip[1] - 7 * Math.sin(ang - 0.5), ...tip, tip[0] - 7 * Math.cos(ang + 0.5), tip[1] - 7 * Math.sin(ang + 0.5)], marking, 2.2);
    }
  }
  if (props.kind === "end") { const [cx, cy] = iso(c[0], c[1], level); p.circle(cx, cy, 6, walk, 1); }
}

// ------------------------------------------------------------------ intérieurs

const ROOM_TINT: Record<string, number> = {
  living: 0xe8c99a, bedroom: 0xc9b6dd, kitchen: 0xe7e0c8, bathroom: 0xb8dbe6, toilet: 0xcfe3ea, office: 0xd6c6a8, dining: 0xe2c49a,
  corridor: 0xd8d2c4, terrace: 0xcfd9b8, garage: 0xbfc3c6, shop: 0xd4dbde, classroom: 0xe3d8b0, consultation: 0xd2e6e0,
  waiting: 0xdde3cf, meeting: 0xd9cfbf, lobby: 0xe4dccb,
};

export interface InteriorOverlay { highlight?: string | null; reachable?: Set<string> | null; selected?: string | null }

export function drawInterior(p: Painter, def: AssetDefinition, furniture: Record<string, FurnitureSpec>, opts: InteriorOverlay = {}) {
  const ip = def.properties;
  const floor = col(def.materials.floor, 0xd8b98a), wallC = col(def.materials.wall, 0xf1e7d6);
  const W = ip.width, D = ip.depth;
  const owner = new Map<string, string>();
  for (const r of ip.rooms) for (let yy = r.y; yy < r.y + r.d; yy++) for (let xx = r.x; xx < r.x + r.w; xx++) owner.set(`${xx},${yy}`, r.id);
  const roomType = new Map(ip.rooms.map((r: any) => [r.id, r.type]));
  // dalle extérieure
  p.poly(P(iso(0, 0), iso(W, 0), iso(W, D), iso(0, D)), 0x000000, 0.06);
  for (let yy = 0; yy < D; yy++) for (let xx = 0; xx < W; xx++) {
    const id = owner.get(`${xx},${yy}`);
    if (!id) continue;
    const tint = mix(floor, ROOM_TINT[roomType.get(id) as string] ?? floor, 0.45);
    drawTile(p, xx, yy, (xx + yy) % 2 ? tint : shade(tint, 0.96), 1, null);
    if (opts.reachable && !opts.reachable.has(`${xx},${yy}`)) drawTile(p, xx, yy, 0xc0392b, 0.18, null);
    else if (opts.reachable) drawTile(p, xx, yy, 0x2f9e6e, 0.12, null);
  }
  const doorEdges = new Set<string>();
  for (const d of ip.doors) {
    const [dx, dy] = DELTA[d.side as Side];
    doorEdges.add(edgeKey(d.cell[0], d.cell[1], d.cell[0] + dx, d.cell[1] + dy));
  }
  // murs : arêtes entre cases de pièces différentes (ou vers l'extérieur)
  const WH = 26;
  const edges: { a: [number, number]; b: [number, number]; back: boolean; door: boolean }[] = [];
  for (let yy = -1; yy <= D; yy++) for (let xx = -1; xx <= W; xx++) {
    const here = owner.get(`${xx},${yy}`);
    const right = owner.get(`${xx + 1},${yy}`), down = owner.get(`${xx},${yy + 1}`);
    if (here !== right && (here || right)) edges.push({ a: [xx + 1, yy], b: [xx + 1, yy + 1], back: !here, door: doorEdges.has(edgeKey(xx, yy, xx + 1, yy)) });
    if (here !== down && (here || down)) edges.push({ a: [xx, yy + 1], b: [xx + 1, yy + 1], back: !here, door: doorEdges.has(edgeKey(xx, yy, xx, yy + 1)) });
  }
  edges.sort((e1, e2) => e1.a[0] + e1.a[1] - (e2.a[0] + e2.a[1]));
  for (const e of edges) {
    const outerFront = e.a[0] >= W || e.a[1] >= D;
    const h = e.door ? 0 : outerFront ? 5 : WH;
    if (e.door) {
      p.line([...iso(e.a[0], e.a[1], 1), ...iso(e.b[0], e.b[1], 1)], 0xb8336a, 3);
      continue;
    }
    const fillC = e.a[0] === e.b[0] ? shade(wallC, 0.92) : shade(wallC, 0.8);
    p.poly(P(iso(e.a[0], e.a[1]), iso(e.b[0], e.b[1]), iso(e.b[0], e.b[1], h), iso(e.a[0], e.a[1], h)), fillC, 1);
    p.line([...iso(e.a[0], e.a[1], h), ...iso(e.b[0], e.b[1], h)], shade(wallC, 0.6), 1);
  }
  // mobilier (de l'arrière vers l'avant)
  const furn = [...ip.furniture].sort((a: any, b: any) => a.x + a.y - (b.x + b.y));
  for (const f of furn) {
    const spec = furniture[f.item];
    const c = col(spec?.color, 0x8a7a6a), h = spec?.h ?? 10;
    box(p, f.x + 0.08, f.y + 0.08, f.w - 0.16, f.d - 0.16, h, c);
    if (f.interactive) { const [cx, cy] = iso(f.x + f.w / 2, f.y + f.d / 2, h + 6); p.circle(cx, cy, 3.2, 0xb8336a, 1); }
    if (opts.highlight === f.id || opts.selected === f.id) p.poly(P(iso(f.x, f.y), iso(f.x + f.w, f.y), iso(f.x + f.w, f.y + f.d), iso(f.x, f.y + f.d)), null, 1, 0xb8336a, 2.5);
  }
  for (const c of ip.forbidden || []) drawTile(p, c[0], c[1], 0xc0392b, 0.28, 0xc0392b);
  const [sx, sy] = iso(ip.spawn[0] + 0.5, ip.spawn[1] + 0.5);
  p.circle(sx, sy, 7, 0x0f3a4a, 0.25); p.circle(sx, sy - 10, 4.5, 0x0f3a4a, 1); p.line([sx, sy - 6, sx, sy], 0x0f3a4a, 3);
}

function edgeKey(x1: number, y1: number, x2: number, y2: number) {
  return x1 + y1 < x2 + y2 || (x1 + y1 === x2 + y2 && x1 < x2) ? `${x1},${y1}|${x2},${y2}` : `${x2},${y2}|${x1},${y1}`;
}

export function box(p: Painter, x: number, y: number, w: number, d: number, h: number, c: number, z0 = 0) {
  p.poly(P(iso(x, y + d, z0), iso(x + w, y + d, z0), iso(x + w, y + d, z0 + h), iso(x, y + d, z0 + h)), shade(c, 0.78), 1);
  p.poly(P(iso(x + w, y, z0), iso(x + w, y + d, z0), iso(x + w, y + d, z0 + h), iso(x + w, y, z0 + h)), shade(c, 0.9), 1);
  p.poly(P(iso(x, y, z0 + h), iso(x + w, y, z0 + h), iso(x + w, y + d, z0 + h), iso(x, y + d, z0 + h)), c, 1);
}

// ------------------------------------------------------------------ surfaces

export function drawSurface(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const base = col(mats.base, 0x8fbf6a), detail = col(mats.detail, 0x7aac58);
  const cells = placedCells(def, pl.x, pl.y, pl.rotation);
  const pattern = props.pattern ?? "plain";
  for (const [x, y] of cells) {
    drawTile(p, x, y, pattern === "checker" && (x + y) % 2 ? detail : base, 1, null);
    if (pattern === "dots") for (const [dx, dy] of [[0.3, 0.3], [0.7, 0.5], [0.4, 0.8]]) { const [cx, cy] = iso(x + dx, y + dy); p.circle(cx, cy, 1.6, detail, 0.9); }
    if (pattern === "stripes") p.line([...iso(x + 0.1, y + 0.5), ...iso(x + 0.9, y + 0.5)], detail, 1.6, 0.9);
    if (pattern === "waves") for (const dy of [0.3, 0.7]) {
      const pts: number[] = [];
      for (let k = 0; k <= 6; k++) { const xx = x + k / 6; pts.push(...iso(xx, y + dy + Math.sin(k * 1.4) * 0.05)); }
      p.line(pts, detail, 1.2, 0.85);
    }
  }
  if (props.kind === "parking") {
    // marquage des places : une ligne par case le long de la largeur
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1, y0 = Math.min(...ys), y1 = Math.max(...ys) + 1;
    for (let x = x0; x <= x1; x++) p.line([...iso(x, y0 + 0.1), ...iso(x, y1 - 0.1)], detail, 1.4, 0.95);
  }
  const tex = props.texture ? mediaUrl(props.texture) : null;
  if (tex) {
    // texture importée (expérimental) : aperçu en vignette au centre de la surface
    const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
    const [cx, cy] = iso((Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...ys) + Math.max(...ys) + 1) / 2);
    p.image(tex, cx - 14, cy - 10, 28, 20, 0.85);
  }
}

// ------------------------------------------------------------------ objets (mobilier urbain, végétation, décor)

function spriteDraw(p: Painter, sprite: any, cx: number, cy: number, heightPx: number) {
  const url = mediaUrl(sprite.media);
  if (!url) return false;
  const s = sprite.scale ?? 1;
  const h = heightPx * s, w = h; // ratio corrigé par l'image (carrée par défaut)
  p.image(url, cx - w * (sprite.anchor?.[0] ?? 0.5), cy - h * (sprite.anchor?.[1] ?? 1), w, h);
  return true;
}

export function drawProp(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const c1 = col(mats.primary, 0x3f8f4a), c2 = col(mats.secondary, 0x6b4423);
  const [w, d] = rotatedSize(def, pl.rotation);
  const x = pl.x, y = pl.y, H = Math.max(0.3, def.height_m) * PX_PER_M;
  const [cx, cy] = iso(x + w / 2, y + d / 2);
  p.poly(P(iso(x + 0.15, y + d - 0.05), iso(x + w - 0.05, y + d - 0.05), iso(x + w, y + d + 0.1), iso(x + 0.2, y + d + 0.1)), 0x000000, 0.08);
  if (def.representation === "sprite" && props.sprite) { if (spriteDraw(p, props.sprite, cx, cy, Math.max(H, 18))) return; }
  const along = w >= d;
  switch (props.shape) {
    case "tree":
      box(p, x + w / 2 - 0.08, y + d / 2 - 0.08, 0.16, 0.16, H * 0.45, c2);
      p.circle(cx, cy - H * 0.62, 13, shade(c1, 0.82));
      p.circle(cx - 6, cy - H * 0.7, 10, c1); p.circle(cx + 6, cy - H * 0.74, 9, shade(c1, 1.1));
      break;
    case "palm": {
      const top: [number, number] = [cx + 4, cy - H];
      p.line([cx, cy, cx + 2, cy - H * 0.5, ...top], c2, 3);
      for (const [dx, dy] of [[-16, 4], [16, 4], [-10, -8], [12, -9], [0, 10]]) p.line([...top, top[0] + dx / 2, top[1] + dy / 2 - 3, top[0] + dx, top[1] + dy], c1, 3);
      break;
    }
    case "bush": p.circle(cx - 5, cy - 4, 7, shade(c1, 0.9)); p.circle(cx + 4, cy - 5, 8, c1); p.circle(cx, cy - 9, 6, shade(c1, 1.1)); break;
    case "flowerbed":
      box(p, x + 0.05, y + 0.1, w - 0.1, d - 0.2, 4, c2);
      for (let i = 0; i < 6; i++) { const [fx, fy] = iso(x + 0.2 + (i % 3) * (w - 0.4) / 2, y + 0.3 + Math.floor(i / 3) * (d - 0.6), 6); p.circle(fx, fy, 2.4, i % 2 ? c1 : 0xf1c40f); }
      break;
    case "lamp_post":
      p.line([cx, cy, cx, cy - H], c1, 2.5);
      p.line([cx, cy - H, cx + 7, cy - H + 2], c1, 2);
      p.circle(cx + 8, cy - H + 4, 3.5, c2);
      break;
    case "bench":
      box(p, x + 0.1, y + 0.3, w - 0.2, d - 0.6, 4, c1, 3);
      if (along) box(p, x + 0.1, y + 0.25, w - 0.2, 0.08, 8, c1, 4); else box(p, x + 0.25, y + 0.1, 0.08, d - 0.2, 8, c1, 4);
      break;
    case "bin": box(p, x + 0.3, y + 0.3, 0.4, 0.4, 8, c1); box(p, x + 0.28, y + 0.28, 0.44, 0.44, 1.5, c2, 8); break;
    case "sign":
      p.line([cx, cy, cx, cy - H], c2, 2);
      p.poly([cx - 9, cy - H, cx + 9, cy - H, cx + 9, cy - H + 10, cx - 9, cy - H + 10], c1, 1, c2, 1);
      break;
    case "fence":
      for (let i = 0; i <= (along ? w : d); i++) { const [fx, fy] = along ? iso(x + i, y + d / 2) : iso(x + w / 2, y + i); p.line([fx, fy, fx, fy - H], c2, 2); }
      { const a = along ? iso(x, y + d / 2) : iso(x + w / 2, y), b = along ? iso(x + w, y + d / 2) : iso(x + w / 2, y + d);
        p.line([a[0], a[1] - H * 0.4, b[0], b[1] - H * 0.4], c1, 2); p.line([a[0], a[1] - H * 0.85, b[0], b[1] - H * 0.85], c1, 2); }
      break;
    case "bus_stop":
      box(p, x + 0.1, y + 0.15, w - 0.2, d - 0.3, 2, c1, H - 2);
      for (const [px, py] of [[x + 0.15, y + 0.2], [x + w - 0.25, y + 0.2]]) box(p, px, py, 0.08, 0.08, H - 2, c1);
      box(p, x + 0.2, y + 0.2, w - 0.4, 0.06, H * 0.7, c2, 2);
      break;
    case "kiosk": box(p, x + 0.15, y + 0.15, w - 0.3, d - 0.3, H * 0.75, c2); box(p, x, y, w, d, 3, c1, H * 0.75); break;
    default: box(p, x + 0.1, y + 0.1, w - 0.2, d - 0.2, H, c1);
  }
}

// ------------------------------------------------------------------ meubles (aperçu d'un asset « furniture »)

export function drawFurnitureAsset(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const c1 = col(mats.primary, 0xa07a4a), c2 = col(mats.secondary, 0x5a4632);
  const rot = pl.rotation % 180 !== 0;
  const w = (rot ? props.d : props.w) ?? 1, d = (rot ? props.w : props.d) ?? 1, h = props.height_px ?? 10;
  const x = pl.x, y = pl.y;
  for (let yy = 0; yy < d; yy++) for (let xx = 0; xx < w; xx++) drawTile(p, x + xx, y + yy, 0xf5f8f7, 1, 0xd3dedb);
  if (def.representation === "sprite" && props.sprite) { const [cx, cy] = iso(x + w / 2, y + d / 2); if (spriteDraw(p, props.sprite, cx, cy, Math.max(h * 2, 24))) return; }
  box(p, x + 0.08, y + 0.08, w - 0.16, d - 0.16, h, c1);
  if (props.shape === "bed") box(p, x + 0.12, y + 0.12, w - 0.24, Math.min(0.5, d / 3), 3, 0xffffff, h);
  if (props.shape === "seat" || props.shape === "counter") box(p, x + 0.08, y + 0.08, w - 0.16, 0.12, h * 0.8, c2, h);
  if (props.shape === "screen") box(p, x + 0.2, y + 0.4, w - 0.4, 0.1, h * 1.2, 0x1d2731, h);
  if (props.shape === "plant") { const [cx, cy] = iso(x + w / 2, y + d / 2, h + 6); p.circle(cx, cy, 7, 0x3f8f4a); }
  if (props.shape === "lamp") { const [cx, cy] = iso(x + w / 2, y + d / 2, h + 4); p.circle(cx, cy, 5, 0xf2c94c); }
}

// ------------------------------------------------------------------ véhicules

export function drawVehicle(p: Painter, def: AssetDefinition, pl: Place) {
  const { mats, props } = resolved(def, pl.variant);
  const body = col(mats.body, 0xe67e22), trim = col(mats.trim, 0x1d2a30), glass = col(mats.glass, 0x9cc8d6);
  const [w, d] = rotatedSize(def, pl.rotation);
  const x = pl.x, y = pl.y, H = Math.max(0.8, def.height_m) * PX_PER_M;
  p.poly(P(iso(x + 0.1, y + 0.1), iso(x + w - 0.1, y + 0.1), iso(x + w - 0.05, y + d - 0.05), iso(x + 0.15, y + d - 0.05)), 0x000000, 0.12);
  const [cx, cy] = iso(x + w / 2, y + d / 2);
  if (def.representation === "sprite" && props.sprite) { if (spriteDraw(p, props.sprite, cx, cy, Math.max(H * 1.6, 24))) return; }
  const kind = props.kind ?? "car";
  if (kind === "moto" || kind === "bike") {
    const along = w >= d;
    const a = along ? iso(x + 0.2, y + 0.5) : iso(x + 0.5, y + 0.2), b = along ? iso(x + 0.8, y + 0.5) : iso(x + 0.5, y + 0.8);
    p.circle(a[0], a[1] - 3, 3.5, trim); p.circle(b[0], b[1] - 3, 3.5, trim);
    p.line([a[0], a[1] - 4, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 8, b[0], b[1] - 4], body, kind === "bike" ? 1.6 : 3.2);
    return;
  }
  const inset = 0.12, bodyH = H * 0.55, cabH = H * 0.45;
  box(p, x + inset, y + inset, w - 2 * inset, d - 2 * inset, bodyH, body);
  const tall = kind === "gbaka" || kind === "bus" || kind === "utility" || kind === "emergency";
  const along = d >= w;
  const [ci, cj] = tall ? [0.16, 0.16] : along ? [0.18, d * 0.25] : [w * 0.25, 0.18];
  box(p, x + ci, y + cj, w - 2 * ci, d - 2 * cj, cabH, tall ? body : glass, bodyH);
  if (tall) {
    // bandeau de vitres sur les faces visibles
    const z0 = bodyH + cabH * 0.2, z1 = bodyH + cabH * 0.8;
    p.poly(P(iso(x + ci, y + d - cj, z0), iso(x + w - ci, y + d - cj, z0), iso(x + w - ci, y + d - cj, z1), iso(x + ci, y + d - cj, z1)), glass, 1);
    p.poly(P(iso(x + w - ci, y + cj, z0), iso(x + w - ci, y + d - cj, z0), iso(x + w - ci, y + d - cj, z1), iso(x + w - ci, y + cj, z1)), shade(glass, 0.9), 1);
  }
  if (props.stripe) p.line([...iso(x + inset, y + d - inset, bodyH * 0.5), ...iso(x + w - inset, y + d - inset, bodyH * 0.5)], trim, 2.5);
  if (kind === "emergency") { const [lx, ly] = iso(x + w / 2, y + d / 2, bodyH + cabH + 2); p.circle(lx, ly, 3, 0xd63031); }
  if (props.roof_sign) {
    const [sx, sy] = iso(x + w / 2, y + d / 2, bodyH + cabH + 4);
    p.text(sx, sy, String(props.roof_sign).slice(0, 12), { size: 7, bold: true, color: 0x1d2a30, bg: 0xf9e79f });
  }
}

// ------------------------------------------------------------------ personnages

export function drawCharacter(p: Painter, def: AssetDefinition, pl: Place) {
  const [cx, cy] = iso(pl.x + 0.5, pl.y + 0.5);
  p.poly([cx - 6, cy, cx, cy - 3, cx + 6, cy, cx, cy + 3], 0x000000, 0.18);
  const url = characterImage(def, pl.variant ?? null);
  const h = Math.max(1, def.height_m) * PX_PER_M * 1.1;
  const w = h * (200 / 380);
  if (url) p.image(url, cx - w / 2, cy - h * (365 / 380), w, h, pl.alpha ?? 1);
  else { p.line([cx, cy, cx, cy - h * 0.7], 0x2c3e50, 3); p.circle(cx, cy - h * 0.82, 3, 0xa86b3c); }
}

// ------------------------------------------------------------------ dispatch + calques

// ------------------------------------------------------------------ assemblages modulaires

/** Sol : l'image vue de dessus est projetée sur l'emprise. Autres familles : image debout (une seule vue, comme un sprite),
 *  centrée sur l'emprise, ligne de sol du kit posée sur le coin avant. Retourne faux si l'image n'est pas disponible. */
export function drawModular(p: Painter, family: string, def: AssetDefinition, pl: Place): boolean {
  const img = modularImage(def, pl.variant ?? null);
  if (!img) return false;
  const [w, d] = family === "furniture" ? (pl.rotation % 180 ? [def.properties.d ?? 1, def.properties.w ?? 1] : [def.properties.w ?? 1, def.properties.d ?? 1]) : rotatedSize(def, pl.rotation);
  const x = pl.x, y = pl.y;
  if (img.view === "top") {
    const o = iso(x, y), u = iso(x + w, y), v = iso(x, y + d);
    p.imageQuad(img.url, o, [u[0] - o[0], u[1] - o[1]], [v[0] - o[0], v[1] - o[1]], pl.alpha ?? 1);
    return true;
  }
  const [, , fw, fh] = img.frame;
  const [cx] = iso(x + w / 2, y + d / 2);
  const front = iso(x + w, y + d)[1];
  const bw = (w + d) * (TW / 2) * 0.92, bh = bw * fh / fw;
  p.poly(P(iso(x + 0.1, y + 0.1), iso(x + w - 0.05, y + 0.1), iso(x + w - 0.05, y + d - 0.05), iso(x + 0.1, y + d - 0.05)), 0x000000, 0.1);
  p.image(img.url, cx - bw / 2, front - 4 - bh * (img.ground / fh), bw, bh, pl.alpha ?? 1);
  return true;
}

export function drawAsset(p: Painter, family: string, def: AssetDefinition, pl: Place, furniture: Record<string, FurnitureSpec> = {}, overlay: InteriorOverlay = {}) {
  if (def.representation === "modular" && family !== "furniture" && drawModular(p, family, def, pl)) return;
  if (def.representation === "modular" && family === "furniture") {
    const rot = pl.rotation % 180 !== 0, fw = (rot ? def.properties.d : def.properties.w) ?? 1, fd = (rot ? def.properties.w : def.properties.d) ?? 1;
    for (let yy = 0; yy < fd; yy++) for (let xx = 0; xx < fw; xx++) drawTile(p, pl.x + xx, pl.y + yy, 0xf5f8f7, 1, 0xd3dedb);
    if (drawModular(p, family, def, pl)) return;
  }
  if (family === "road") drawRoad(p, def, pl);
  else if (family === "interior") drawInterior(p, def, furniture, overlay);
  else if (family === "surface") drawSurface(p, def, pl);
  else if (family === "prop") drawProp(p, def, pl);
  else if (family === "furniture") drawFurnitureAsset(p, def, pl);
  else if (family === "vehicle") drawVehicle(p, def, pl);
  else if (family === "character") drawCharacter(p, def, pl);
  else if (family === "building") drawBuilding(p, def, pl);
}

export interface OverlayFlags { grid: boolean; footprint: boolean; collision: boolean; entrances: boolean; connectors: boolean; zones: boolean; dims: boolean; anchors?: boolean }

export function drawOverlays(p: Painter, family: string, def: AssetDefinition, pl: Place, f: OverlayFlags) {
  const cells = placedCells(def, pl.x, pl.y, pl.rotation);
  if (f.footprint) for (const [x, y] of cells) drawTile(p, x, y, 0x2f9e6e, 0.22, 0x2f9e6e);
  if (f.collision && def.collision !== "none") {
    const set = new Set(cells.map((c) => c.join(",")));
    for (const [x, y] of cells) {
      if (!set.has(`${x},${y - 1}`)) p.line([...iso(x, y), ...iso(x + 1, y)], 0xc0392b, 2);
      if (!set.has(`${x - 1},${y}`)) p.line([...iso(x, y), ...iso(x, y + 1)], 0xc0392b, 2);
      if (!set.has(`${x},${y + 1}`)) p.line([...iso(x, y + 1), ...iso(x + 1, y + 1)], 0xc0392b, 2);
      if (!set.has(`${x + 1},${y}`)) p.line([...iso(x + 1, y), ...iso(x + 1, y + 1)], 0xc0392b, 2);
    }
    const m = def.placement.safety_margin;
    if (m) {
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, x1 = Math.max(...xs) + 1 + m, y1 = Math.max(...ys) + 1 + m;
      for (const [a, b] of [[[x0, y0], [x1, y0]], [[x1, y0], [x1, y1]], [[x1, y1], [x0, y1]], [[x0, y1], [x0, y0]]] as [number, number][][])
        dashed(p, iso(a[0], a[1]), iso(b[0], b[1]), 0xc0392b, 1.5, 5, 4, 0.8);
    }
  }
  if (f.anchors !== false && f.footprint) {
    const t = new Transform(footprintCells(def.footprint), pl.rotation);
    const [ax, ay] = t.cell(def.anchor);
    const [px, py] = iso(pl.x + ax + 0.5, pl.y + ay + 0.5);
    p.circle(px, py, 4, 0xe0a100, 1); p.circle(px, py, 2, 0xffffff, 1);
    if (family === "vehicle") for (const [name, pt] of Object.entries((def.properties?.anchors ?? {}) as Record<string, [number, number]>)) {
      const q = t.point(pt[0], pt[1], def.footprint.w, def.footprint.d);
      const [qx, qy] = iso(pl.x + q[0], pl.y + q[1], 4);
      p.circle(qx, qy, 3, 0x7b4fa8, 1);
      p.text(qx, qy - 9, name, { size: 8, color: 0xffffff, bg: 0x7b4fa8 });
    }
  }
  if (f.zones && family !== "road") {
    for (const z of def.zones) {
      const colr = { interaction: 0x7b4fa8, safety: 0xc0392b, forbidden: 0xc0392b, delivery: 0xd98e04, parking: 0x2b6cb0 }[z.kind];
      for (const c of z.cells) {
        const [cx, cy] = rotCell(def, c, pl);
        drawTile(p, cx, cy, colr, 0.25, colr);
      }
    }
  }
  if (f.entrances && family === "building") {
    for (const e of placedEntrances(def, pl.x, pl.y, pl.rotation)) {
      const [dx, dy] = DELTA[e.side];
      const cx = e.cell[0] + 0.5 + dx * 0.5, cy = e.cell[1] + 0.5 + dy * 0.5;
      const a = iso(cx, cy, 2), b = iso(cx + dx * 0.9, cy + dy * 0.9, 2);
      const colr = e.kind === "main" ? 0x1f6fb2 : 0xd98e04;
      p.line([...a, ...b], colr, 3);
      p.circle(b[0], b[1], 4.5, colr, 1);
      p.text(b[0], b[1] - 11, e.id, { size: 9, color: 0xffffff, bg: colr, bold: true });
    }
  }
  if (f.connectors && family === "road") {
    const n = def.footprint.w, x = pl.x, y = pl.y;
    for (const c of def.connectors) {
      const s = rotateSide(c.side, pl.rotation);
      const seg = { N: [[x, y], [x + n, y]], S: [[x, y + n], [x + n, y + n]], W: [[x, y], [x, y + n]], E: [[x + n, y], [x + n, y + n]] }[s];
      const a = iso(seg[0][0], seg[0][1], 1), b = iso(seg[1][0], seg[1][1], 1);
      p.line([...a, ...b], 0xe0a100, 5, 0.9);
      const flow = c.flow === "both" ? "⇄" : c.flow === "in" ? "entrée" : "sortie";
      const [ox, oy] = DELTA[s];
      const mx = (seg[0][0] + seg[1][0]) / 2 + ox * 0.9, my = (seg[0][1] + seg[1][1]) / 2 + oy * 0.9;
      const [lx, ly] = iso(mx, my, 1);
      p.line([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, lx, ly], 0xe0a100, 1.5, 0.9);
      p.text(lx, ly, `${s} · ${c.lanes} v${c.level ? ` · niv ${c.level}` : ""} · ${flow}`, { size: 9, color: 0x1d2a30, bg: 0xffe08a });
    }
  }
  if (f.dims) {
    const [w, d] = rotatedSize(def, pl.rotation);
    const a = iso(pl.x, pl.y + d), b = iso(pl.x + w, pl.y + d);
    p.text((a[0] + b[0]) / 2 - 10, (a[1] + b[1]) / 2 + (family === "road" ? 52 : 26), `${w} × ${d} cases · ${(w * def.cell_size_m).toFixed(0)} × ${(d * def.cell_size_m).toFixed(0)} m · h ${def.height_m} m`, { size: 10, color: 0xffffff, bg: 0x0f3a4a });
  }
}

function rotCell(def: AssetDefinition, c: Cell, pl: Place): Cell {
  // une zone peut déborder de l'emprise : on applique la même rotation que l'emprise
  const fake = { ...def, footprint: { kind: "cells" as const, w: 1, d: 1, cells: [...footprintCells(def.footprint), c] } };
  const all = placedCells(fake as AssetDefinition, pl.x, pl.y, pl.rotation);
  const base = placedCells(def, pl.x, pl.y, pl.rotation);
  // recalage : la boîte de l'emprise seule fait foi
  const bx = Math.min(...base.map((q) => q[0])), by = Math.min(...base.map((q) => q[1]));
  const fx = Math.min(...all.slice(0, -1).map((q) => q[0])), fy = Math.min(...all.slice(0, -1).map((q) => q[1]));
  const last = all[all.length - 1];
  return [last[0] - fx + bx, last[1] - fy + by];
}
