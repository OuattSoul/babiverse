// Interface de dessin minimale : le même moteur de rendu isométrique alimente Phaser (éditeur, scènes de test)
// et Canvas 2D (vignettes du catalogue), sans dupliquer la logique de dessin.
import { loadedImage } from "../character/svgimg";

export interface TextOpts { size?: number; color?: number; bold?: boolean; align?: "center" | "left"; bg?: number | null }

export interface Painter {
  poly(pts: number[], fill: number | null, alpha?: number, stroke?: number | null, strokeW?: number): void;
  line(pts: number[], color: number, width: number, alpha?: number): void;
  circle(x: number, y: number, r: number, fill: number, alpha?: number): void;
  text(x: number, y: number, str: string, opts?: TextOpts): void;
  /** Image (sprite importé, personnage composé) : coin haut-gauche (x, y), taille w × h en unités du monde. */
  image(src: string, x: number, y: number, w: number, h: number, alpha?: number): void;
  /** Image projetée : son coin haut-gauche en o, son axe horizontal le long de u, son axe vertical le long de v
   *  (sol modulaire posé sur une emprise isométrique). */
  imageQuad(src: string, o: [number, number], u: [number, number], v: [number, number], alpha?: number): void;
}

export const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

export class CanvasPainter implements Painter {
  constructor(private ctx: CanvasRenderingContext2D) {}
  private path(pts: number[]) {
    const c = this.ctx; c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  }
  poly(pts: number[], fill: number | null, alpha = 1, stroke: number | null = null, strokeW = 1) {
    const c = this.ctx; this.path(pts); c.closePath();
    if (fill !== null) { c.globalAlpha = alpha; c.fillStyle = hex(fill); c.fill(); }
    if (stroke !== null) { c.globalAlpha = 1; c.strokeStyle = hex(stroke); c.lineWidth = strokeW; c.stroke(); }
    c.globalAlpha = 1;
  }
  line(pts: number[], color: number, width: number, alpha = 1) {
    const c = this.ctx; this.path(pts); c.globalAlpha = alpha; c.strokeStyle = hex(color); c.lineWidth = width; c.lineCap = "round"; c.stroke(); c.globalAlpha = 1;
  }
  circle(x: number, y: number, r: number, fill: number, alpha = 1) {
    const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.globalAlpha = alpha; c.fillStyle = hex(fill); c.fill(); c.globalAlpha = 1;
  }
  text(x: number, y: number, str: string, o: TextOpts = {}) {
    const c = this.ctx; const size = o.size ?? 11;
    c.font = `${o.bold ? 700 : 500} ${size}px Archivo, system-ui, sans-serif`;
    c.textAlign = o.align === "left" ? "left" : "center"; c.textBaseline = "middle";
    if (o.bg != null) {
      const w = c.measureText(str).width + 6;
      c.fillStyle = hex(o.bg); c.fillRect(o.align === "left" ? x - 3 : x - w / 2, y - size / 2 - 2, w, size + 4);
    }
    c.fillStyle = hex(o.color ?? 0x1d2a30); c.fillText(str, x, y);
  }
  image(src: string, x: number, y: number, w: number, h: number, alpha = 1) {
    const img = loadedImage(src);
    if (!img) return;
    const c = this.ctx; c.globalAlpha = alpha; c.drawImage(img, x, y, w, h); c.globalAlpha = 1;
  }
  imageQuad(src: string, o: [number, number], u: [number, number], v: [number, number], alpha = 1) {
    const img = loadedImage(src);
    if (!img) return;
    const c = this.ctx;
    c.save(); c.globalAlpha = alpha; c.transform(u[0], u[1], v[0], v[1], o[0], o[1]); c.drawImage(img, 0, 0, 1, 1); c.restore();
  }
}

export function dashed(p: Painter, a: [number, number], b: [number, number], color: number, width: number, dash = 6, gap = 5, alpha = 1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!len) return;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash);
    p.line([a[0] + ux * s, a[1] + uy * s, a[0] + ux * e, a[1] + uy * e], color, width, alpha);
  }
}
