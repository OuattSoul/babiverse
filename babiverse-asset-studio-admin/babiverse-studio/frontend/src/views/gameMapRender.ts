// Dessin de la carte du jeu (vue de dessus) pour la page « Carte du jeu » : sol, routes, parcelles, bâtiments avec
// toit, façade et porte, végétation, mobilier en pictogrammes, éléments placés depuis l'atelier, éléments retirés,
// zones libres, règles graduées et étiquettes sans chevauchement. Module sans état : tout vient de `MapModel`.

export const RULER = 22; // marge des règles graduées (px)

export interface MapModel {
  city: any;               // ville telle que le jeu l'affiche (éléments retirés enlevés)
  base: any;               // ville d'origine (pour dessiner en fantôme les éléments retirés)
  gone: Set<string>;       // clés des éléments d'origine retirés
  elements: { key: string; kind: string; label: string; rect: { x0: number; y0: number; x1: number; y1: number } }[];
  placements: { id: string; family: string; x: number; y: number; w: number; h: number; facing: string; name?: string | null }[];
  assetOf: (p: any) => any; // définition de l'asset d'un placement (ou null)
  free: Uint8Array | null; // 1 = case où un élément peut être posé (calque « zones libres »)
}
export interface MapLayers { labels: boolean; grid: boolean; free: boolean }

const C = {
  dirt: "#dcc9a3", grass: "#a7cc7a", grassDot: "#93bb66", sidewalk: "#d9d4ca", curb: "#b9b2a5", asphalt: "#4d4d53",
  lane: "#f4f1e8", plaza: "#cdbda4", plazaLine: "#b8a68c", plot: "#f3dfb3", plotLine: "#c98a2b", wall: "#8f877b",
  shadow: "rgba(0,0,0,0.18)", ink: "#2b2118",
};
const ROOF: Record<string, string> = { r: "#9c5b3c", o: "#c8874a", g: "#6d8ea8" };
const WALL: Record<string, string> = { W: "#efe3c8", H: "#efe3c8", Y: "#f2c14e", h: "#f2c14e", D: "#7a3423" };
export const FAMILY_COLOR: Record<string, string> = { building: "#c0392b", prop: "#27ae60", vehicle: "#2980b9", surface: "#8e44ad" };

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

/** Sol d'une case selon le caractère de la carte (le bâti et la végétation sont dessinés ensuite). */
function ground(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, s: number) {
  const px = RULER + x * s, py = RULER + y * s;
  switch (ch) {
    case ",": case "T": case "p": case "%":
      ctx.fillStyle = C.grass; ctx.fillRect(px, py, s, s);
      if (s >= 8 && (x * 7 + y * 3) % 5 === 0) { ctx.fillStyle = C.grassDot; ctx.fillRect(px + s * 0.3, py + s * 0.4, Math.max(1, s * 0.15), Math.max(1, s * 0.15)); }
      return;
    case "_":
      ctx.fillStyle = C.sidewalk; ctx.fillRect(px, py, s, s);
      if (s >= 10) { ctx.strokeStyle = "rgba(0,0,0,0.06)"; ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1); }
      return;
    case "=": case "-": case "|": case "+":
      ctx.fillStyle = C.asphalt; ctx.fillRect(px, py, s, s);
      ctx.fillStyle = C.lane;
      if (ch === "-") ctx.fillRect(px + s * 0.15, py + s * 0.45, s * 0.5, Math.max(1, s * 0.1));
      if (ch === "|") ctx.fillRect(px + s * 0.45, py + s * 0.15, Math.max(1, s * 0.1), s * 0.5);
      if (ch === "+") for (let k = 0; k < 3; k++) ctx.fillRect(px + s * (0.1 + k * 0.32), py + s * 0.1, s * 0.18, s * 0.8);
      return;
    case ":":
      ctx.fillStyle = C.plaza; ctx.fillRect(px, py, s, s);
      if (s >= 8) { ctx.strokeStyle = C.plazaLine; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1); }
      return;
    case "l": ctx.fillStyle = C.plot; ctx.fillRect(px, py, s, s); return;
    case "#": ctx.fillStyle = C.wall; ctx.fillRect(px, py, s, s); return;
    default: ctx.fillStyle = C.dirt; ctx.fillRect(px, py, s, s);
  }
}

function tree(ctx: CanvasRenderingContext2D, ch: string, x: number, y: number, s: number, alpha = 1) {
  const cx = RULER + (x + 0.5) * s, cy = RULER + (y + 0.5) * s;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(cx + s * 0.08, cy + s * 0.1, s * 0.48, 0, Math.PI * 2); ctx.fill();
  if (ch === "p") {
    ctx.strokeStyle = "#2e7d32"; ctx.lineWidth = Math.max(1.5, s * 0.16); ctx.lineCap = "round";
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * s * 0.5, cy + Math.sin(a) * s * 0.5); ctx.stroke(); }
    ctx.fillStyle = "#8b6b3e"; ctx.beginPath(); ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2); ctx.fill();
  } else {
    const r = ch === "%" ? s * 0.34 : s * 0.48;
    ctx.fillStyle = ch === "%" ? "#2e7d32" : "#2f6b2f"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ch === "%" ? "#e91e63" : "#3d8a3d"; ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * (ch === "%" ? 0.2 : 0.45), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** Bâtiment vu de dessus : toit, bande de façade du côté de l'entrée, porte, ombre portée. */
function building(ctx: CanvasRenderingContext2D, r: { x0: number; y0: number; x1: number; y1: number }, s: number,
  o: { roof: string; wall: string; facing: string; door?: [number, number] | null; accent?: string | null; alpha?: number }) {
  const px = RULER + r.x0 * s, py = RULER + r.y0 * s, w = (r.x1 - r.x0 + 1) * s, hh = (r.y1 - r.y0 + 1) * s;
  const inset = Math.max(1, s * 0.12);
  ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
  ctx.fillStyle = C.shadow; ctx.fillRect(px + inset + s * 0.15, py + inset + s * 0.15, w - inset * 2, hh - inset * 2);
  ctx.fillStyle = o.roof; ctx.fillRect(px + inset, py + inset, w - inset * 2, hh - inset * 2);
  // faîtage et arêtes du toit
  ctx.strokeStyle = shade(o.roof.startsWith("#") ? o.roof : "#9c5b3c", 0.75); ctx.lineWidth = Math.max(1, s * 0.08);
  ctx.strokeRect(px + inset, py + inset, w - inset * 2, hh - inset * 2);
  ctx.beginPath(); ctx.moveTo(px + inset, py + inset); ctx.lineTo(px + w / 2, py + hh / 2); ctx.lineTo(px + w - inset, py + inset);
  ctx.moveTo(px + inset, py + hh - inset); ctx.lineTo(px + w / 2, py + hh / 2); ctx.lineTo(px + w - inset, py + hh - inset); ctx.stroke();
  // façade (côté de l'entrée)
  const t = Math.max(2, s * 0.28);
  ctx.fillStyle = o.accent || o.wall;
  if (o.facing === "N") ctx.fillRect(px + inset, py + inset, w - inset * 2, t);
  else if (o.facing === "E") ctx.fillRect(px + w - inset - t, py + inset, t, hh - inset * 2);
  else if (o.facing === "W") ctx.fillRect(px + inset, py + inset, t, hh - inset * 2);
  else ctx.fillRect(px + inset, py + hh - inset - t, w - inset * 2, t);
  if (o.door) {
    const [dx, dy] = o.door;
    const cx = RULER + (dx + 0.5) * s, cy = RULER + (dy + 0.5) * s;
    const d = Math.max(3, s * 0.36);
    ctx.fillStyle = "#5a2b1a";
    if (o.facing === "N") ctx.fillRect(cx - d / 2, py + inset - 1, d, t * 0.9);
    else if (o.facing === "E") ctx.fillRect(px + w - inset - t * 0.9 + 1, cy - d / 2, t * 0.9, d);
    else if (o.facing === "W") ctx.fillRect(px + inset - 1, cy - d / 2, t * 0.9, d);
    else ctx.fillRect(cx - d / 2, py + hh - inset - t * 0.9 + 1, d, t * 0.9);
  }
  ctx.restore();
}

/** Pictogramme du mobilier d'origine (une case, ou sa largeur). */
function prop(ctx: CanvasRenderingContext2D, p: any, s: number, alpha = 1) {
  const [x, y] = p.tile;
  const w = (p.w || 1) * s, hh = (p.h || 1) * s;
  const px = RULER + x * s, py = RULER + y * s, cx = px + w / 2, cy = py + hh / 2;
  const dot = (r: number, fill: string, stroke?: string) => {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  };
  ctx.save(); ctx.globalAlpha = alpha;
  switch (p.kind) {
    case "lamp": dot(s * 0.3, "#f7dc6f", "#5d6d7e"); break;
    case "pole": ctx.fillStyle = "#6b4f3a"; ctx.fillRect(cx - s * 0.15, cy - s * 0.15, s * 0.3, s * 0.3); break;
    case "bench": ctx.fillStyle = "#8d5a2b"; ctx.fillRect(px + s * 0.12, cy - s * 0.16, w - s * 0.24, s * 0.32); break;
    case "bin": dot(s * 0.26, "#1e8449", "#145a32"); break;
    case "stop": {
      ctx.fillStyle = "#c0392b"; ctx.beginPath();
      for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k / 8) * Math.PI * 2; ctx.lineTo(cx + Math.cos(a) * s * 0.32, cy + Math.sin(a) * s * 0.32); }
      ctx.closePath(); ctx.fill(); break;
    }
    case "roadsign": ctx.fillStyle = "#1f6feb"; ctx.fillRect(cx - s * 0.4, cy - s * 0.18, s * 0.8, s * 0.36); break;
    case "parasol": dot(s * 0.42, "#c0392b", "#ffffff"); break;
    case "crates": ctx.fillStyle = "#b9770e"; ctx.fillRect(px + s * 0.15, py + s * 0.15, s * 0.3, s * 0.3); ctx.fillRect(px + s * 0.5, py + s * 0.45, s * 0.3, s * 0.3); break;
    case "kiosk": case "garba_stand":
      ctx.fillStyle = p.kind === "kiosk" ? "#e67e22" : "#d35400"; ctx.fillRect(px + s * 0.08, py + s * 0.12, w - s * 0.16, hh - s * 0.24);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1; ctx.strokeRect(px + s * 0.08, py + s * 0.12, w - s * 0.16, hh - s * 0.24); break;
    case "billboard": ctx.fillStyle = "#2c3e50"; ctx.fillRect(px + s * 0.05, cy - s * 0.2, w - s * 0.1, s * 0.4); ctx.fillStyle = "#ecf0f1"; ctx.fillRect(px + s * 0.12, cy - s * 0.12, w - s * 0.24, s * 0.24); break;
    case "plotsign": ctx.fillStyle = "#f1c40f"; ctx.fillRect(cx - s * 0.3, cy - s * 0.12, s * 0.6, s * 0.24); break;
    default: break;
  }
  ctx.restore();
}

/** Élément placé depuis l'atelier : bâtiment à ses couleurs, objet, véhicule, surface ; liseré bleu « atelier ». */
function placement(ctx: CanvasRenderingContext2D, p: any, def: any, s: number) {
  const px = RULER + p.x * s, py = RULER + p.y * s, w = p.w * s, hh = p.h * s;
  const m = def?.materials ?? {};
  if (p.family === "surface") {
    ctx.fillStyle = m.base ?? "#8fbf6a"; ctx.globalAlpha = 0.85; ctx.fillRect(px, py, w, hh); ctx.globalAlpha = 1;
    ctx.strokeStyle = m.detail ?? "#7aac58"; ctx.lineWidth = 1;
    for (let k = s; k < w; k += s) { ctx.beginPath(); ctx.moveTo(px + k, py); ctx.lineTo(px + k, py + hh); ctx.stroke(); }
  } else if (p.family === "building") {
    const fw = p.facing === "E" || p.facing === "W" ? p.h : p.w;
    const k = Math.floor(fw / 2);
    const door: [number, number] = p.facing === "N" ? [p.x + p.w - 1 - k, p.y] : p.facing === "E" ? [p.x + p.w - 1, p.y + k] : p.facing === "W" ? [p.x, p.y + p.h - 1 - k] : [p.x + k, p.y + p.h - 1];
    building(ctx, { x0: p.x, y0: p.y, x1: p.x + p.w - 1, y1: p.y + p.h - 1 }, s, { roof: m.roof ?? "#9c5b3c", wall: m.wall ?? "#efe3c8", accent: m.trim ?? null, facing: p.facing, door });
  } else if (p.family === "vehicle") {
    ctx.fillStyle = m.body ?? FAMILY_COLOR.vehicle; ctx.beginPath(); ctx.roundRect(px + s * 0.12, py + s * 0.08, w - s * 0.24, hh - s * 0.16, s * 0.25); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(px + s * 0.25, py + hh * 0.3, w - s * 0.5, hh * 0.2);
  } else {
    const cx = px + w / 2, cy = py + hh / 2, r = Math.min(w, hh) * 0.42;
    ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(cx + 1, cy + 1, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = m.primary ?? "#3f8f4a"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.setLineDash([Math.max(3, s * 0.4), Math.max(2, s * 0.25)]);
  ctx.strokeStyle = "#1f6feb"; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, w - 2, hh - 2); ctx.setLineDash([]);
}

function cross(ctx: CanvasRenderingContext2D, r: { x0: number; y0: number; x1: number; y1: number }, s: number) {
  const x0 = RULER + r.x0 * s + 2, y0 = RULER + r.y0 * s + 2, x1 = RULER + (r.x1 + 1) * s - 2, y1 = RULER + (r.y1 + 1) * s - 2;
  ctx.strokeStyle = "#c0392b"; ctx.lineWidth = Math.max(2, s * 0.15); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1, y0); ctx.lineTo(x0, y1); ctx.stroke();
}

/** Étiquettes : posées par ordre de priorité, sautées si elles en chevauchent une autre. */
function labels(ctx: CanvasRenderingContext2D, items: { text: string; x: number; y: number; color: string; bg: string }[], s: number) {
  const size = Math.max(10, Math.min(15, s * 0.9));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const it of items) {
    const w = ctx.measureText(it.text).width + 8, hh = size + 5;
    const b = { x0: it.x - w / 2, y0: it.y - hh / 2, x1: it.x + w / 2, y1: it.y + hh / 2 };
    if (placed.some((q) => b.x0 < q.x1 && q.x0 < b.x1 && b.y0 < q.y1 && q.y0 < b.y1)) continue;
    placed.push(b);
    ctx.fillStyle = it.bg; ctx.beginPath(); ctx.roundRect(b.x0, b.y0, w, hh, hh / 2); ctx.fill();
    ctx.fillStyle = it.color; ctx.fillText(it.text, it.x, it.y + 0.5);
  }
}

/** Couche de base (redessinée quand la ville, les placements, l'échelle ou les calques changent). */
export function drawBase(ctx: CanvasRenderingContext2D, m: MapModel, s: number, layers: MapLayers) {
  const map: string[] = m.city.map;
  const W = map[0].length, H = map.length;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ground(ctx, map[y][x], x, y, s);
  // parcelles des joueurs : contour pointillé
  ctx.setLineDash([Math.max(3, s * 0.5), Math.max(2, s * 0.3)]); ctx.strokeStyle = C.plotLine; ctx.lineWidth = Math.max(1, s * 0.12);
  for (const p of m.city.plots) ctx.strokeRect(RULER + p.x * s + 1, RULER + p.y * s + 1, p.w * s - 2, p.h * s - 2);
  ctx.setLineDash([]);
  // lotissement (réservé aux maisons des joueurs) : hachures
  const r = m.city.residential;
  ctx.save(); ctx.beginPath(); ctx.rect(RULER + r.x * s, RULER + r.y * s, r.w * s, (H - r.y) * s); ctx.clip();
  ctx.fillStyle = "rgba(201,138,43,0.12)"; ctx.fillRect(RULER + r.x * s, RULER + r.y * s, r.w * s, (H - r.y) * s);
  ctx.strokeStyle = "rgba(150,100,40,0.35)"; ctx.lineWidth = 1; ctx.beginPath();
  for (let k = -H; k < W + H; k += 2) { ctx.moveTo(RULER + (r.x + k) * s, RULER + r.y * s); ctx.lineTo(RULER + (r.x + k + H) * s, RULER + (r.y + H) * s); }
  ctx.stroke(); ctx.restore();
  // surfaces de l'atelier sous le reste
  for (const p of m.placements) if (p.family === "surface") placement(ctx, p, m.assetOf(p), s);
  // bâtiments d'origine
  for (const b of m.city.buildings) {
    if (b.atelier) continue;
    const di = b.facade?.indexOf("D") ?? -1;
    const door: [number, number] | null = di >= 0 ? [b.x0 + di, b.facing === "N" ? b.y0 : b.y1] : null;
    const wallCh = [...(b.facade || "W")].find((c: string) => c !== "D") || "W";
    building(ctx, b, s, { roof: ROOF[b.roof] ?? "#9c5b3c", wall: WALL[wallCh] ?? "#efe3c8", accent: b.sign?.bg ?? null, facing: b.facing, door });
  }
  // végétation et mobilier d'origine
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ("Tp%".includes(map[y][x])) tree(ctx, map[y][x], x, y, s);
  for (const p of m.city.props) if (!p.kind.startsWith("atl_") && p.kind !== "plot") prop(ctx, p, s);
  // éléments d'origine retirés : fantôme + croix rouge
  const baseByKey = new Map<string, any>(m.base.props.map((p: any) => [`prop:${p.kind}:${p.tile[0]},${p.tile[1]}`, p]));
  for (const e of m.elements) {
    if (!m.gone.has(e.key)) continue;
    if (e.kind === "building") {
      const b = m.base.buildings.find((x: any) => `bld:${x.id}` === e.key);
      if (b) building(ctx, b, s, { roof: ROOF[b.roof] ?? "#9c5b3c", wall: "#efe3c8", facing: b.facing, alpha: 0.3 });
    } else if (e.kind === "tree") tree(ctx, m.base.map[e.rect.y0][e.rect.x0], e.rect.x0, e.rect.y0, s, 0.3);
    else if (baseByKey.has(e.key)) prop(ctx, baseByKey.get(e.key), s, 0.3);
    cross(ctx, e.rect, s);
  }
  // éléments placés depuis l'atelier
  for (const p of m.placements) if (p.family !== "surface") placement(ctx, p, m.assetOf(p), s);
  // zones libres : vert = un élément peut être posé, rouge léger = interdit
  if (layers.free && m.free) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ok = m.free[y * W + x];
      ctx.fillStyle = ok ? "rgba(46,204,113,0.38)" : "rgba(120,20,10,0.32)";
      ctx.fillRect(RULER + x * s, RULER + y * s, s, s);
      if (ok && s >= 8) { ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1; ctx.strokeRect(RULER + x * s + 1.5, RULER + y * s + 1.5, s - 3, s - 3); }
    }
  }
  if (layers.grid && s >= 6) {
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x++) { ctx.strokeStyle = x % 10 ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.moveTo(RULER + x * s + 0.5, RULER); ctx.lineTo(RULER + x * s + 0.5, RULER + H * s); ctx.stroke(); }
    for (let y = 0; y <= H; y++) { ctx.strokeStyle = y % 10 ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.moveTo(RULER, RULER + y * s + 0.5); ctx.lineTo(RULER + W * s, RULER + y * s + 0.5); ctx.stroke(); }
  }
  // règles graduées (coordonnées en cases)
  ctx.fillStyle = "#1d2a30"; ctx.fillRect(0, 0, RULER + W * s, RULER); ctx.fillRect(0, 0, RULER, RULER + H * s);
  ctx.fillStyle = "#e8eef0"; ctx.font = "600 10px system-ui, sans-serif"; ctx.textBaseline = "middle";
  const step = s >= 14 ? 5 : 10;
  ctx.textAlign = "center";
  for (let x = 0; x < W; x += step) ctx.fillText(String(x), RULER + (x + 0.5) * s, RULER / 2);
  ctx.textAlign = "right";
  for (let y = 0; y < H; y += step) ctx.fillText(String(y), RULER - 3, RULER + (y + 0.5) * s);
  if (layers.labels) {
    const items: { text: string; x: number; y: number; color: string; bg: string }[] = [];
    for (const p of m.placements) items.push({ text: p.name ?? "?", x: RULER + (p.x + p.w / 2) * s, y: RULER + (p.y + p.h / 2) * s, color: "#ffffff", bg: "rgba(31,111,235,0.92)" });
    for (const b of m.city.buildings) if (!b.atelier) items.push({ text: b.sign?.text ?? b.name, x: RULER + ((b.x0 + b.x1 + 1) / 2) * s, y: RULER + (b.y0 - 0.15) * s, color: "#ffffff", bg: "rgba(29,42,48,0.85)" });
    for (const p of m.city.plots) items.push({ text: p.id, x: RULER + (p.x + p.w / 2) * s, y: RULER + (p.y + p.h / 2) * s, color: "#7a4d10", bg: "rgba(255,248,230,0.9)" });
    for (const rd of [...(m.city.roads?.horizontal ?? [])]) items.push({ text: rd.name, x: RULER + 9 * s, y: RULER + (rd.y + 2.5) * s, color: "#ffffff", bg: "rgba(0,0,0,0.35)" });
    for (const rd of [...(m.city.roads?.vertical ?? [])]) items.push({ text: rd.name, x: RULER + (rd.x + 2.5) * s, y: RULER + 4 * s, color: "#ffffff", bg: "rgba(0,0,0,0.35)" });
    items.push({ text: r.name ?? "Lotissement", x: RULER + (r.x + r.w / 2) * s, y: RULER + (r.y + 3) * s, color: "#7a4d10", bg: "rgba(255,248,230,0.9)" });
    labels(ctx, items, s);
  }
}

export interface Overlay {
  hover: [number, number] | null;
  hoverRect: { x0: number; y0: number; x1: number; y1: number } | null;
  selectedRect: { x0: number; y0: number; x1: number; y1: number } | null;
  drawn: { x: number; y: number; w: number; h: number } | null;
  blocked: (x: number, y: number) => boolean;
}

/** Couche interactive (survol, sélection, zone tracée), redessinée à chaque mouvement. */
export function drawOverlay(ctx: CanvasRenderingContext2D, s: number, o: Overlay) {
  const rect = (r: { x0: number; y0: number; x1: number; y1: number }, color: string, width: number) => {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.strokeRect(RULER + r.x0 * s - 1, RULER + r.y0 * s - 1, (r.x1 - r.x0 + 1) * s + 2, (r.y1 - r.y0 + 1) * s + 2);
  };
  if (o.hoverRect) rect(o.hoverRect, "rgba(255,255,255,0.95)", 2);
  if (o.selectedRect) { rect(o.selectedRect, "#1d2a30", 4); rect(o.selectedRect, "#f1c40f", 2); }
  if (o.hover && !o.drawn) {
    ctx.strokeStyle = "rgba(29,42,48,0.8)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(RULER + o.hover[0] * s + 0.5, RULER + o.hover[1] * s + 0.5, s - 1, s - 1);
  }
  if (o.drawn) {
    const d = o.drawn;
    for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) {
      ctx.fillStyle = o.blocked(x, y) ? "rgba(192,57,43,0.45)" : "rgba(39,174,96,0.35)";
      ctx.fillRect(RULER + x * s, RULER + y * s, s, s);
    }
    ctx.setLineDash([6, 4]); ctx.lineWidth = 2; ctx.strokeStyle = "#1d2a30";
    ctx.strokeRect(RULER + d.x * s, RULER + d.y * s, d.w * s, d.h * s); ctx.setLineDash([]);
    const text = `${d.w} × ${d.h}`;
    ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
    const tw = ctx.measureText(text).width + 10;
    const tx = RULER + d.x * s, ty = Math.max(RULER + 16, RULER + d.y * s - 3);
    ctx.fillStyle = "#1d2a30"; ctx.beginPath(); ctx.roundRect(tx, ty - 16, tw, 16, 4); ctx.fill();
    ctx.fillStyle = "#ffffff"; ctx.fillText(text, tx + 5, ty - 2);
  }
}
