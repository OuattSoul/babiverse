import Phaser from "phaser";
import { loadedImage } from "../character/svgimg";
import { hex, type Painter, type TextOpts } from "./painter";

let keySeq = 0;
const keys = new Map<string, string>();

/** Dessine dans un Graphics Phaser ; les textes et images deviennent des objets ajoutés au conteneur. */
export class PhaserPainter implements Painter {
  constructor(private scene: Phaser.Scene, public g: Phaser.GameObjects.Graphics, private container: Phaser.GameObjects.Container) {}
  poly(pts: number[], fill: number | null, alpha = 1, stroke: number | null = null, strokeW = 1) {
    const points = [];
    for (let i = 0; i < pts.length; i += 2) points.push(new Phaser.Math.Vector2(pts[i], pts[i + 1]));
    if (fill !== null) { this.g.fillStyle(fill, alpha); this.g.fillPoints(points, true); }
    if (stroke !== null) { this.g.lineStyle(strokeW, stroke, 1); this.g.strokePoints(points, true); }
  }
  line(pts: number[], color: number, width: number, alpha = 1) {
    this.g.lineStyle(width, color, alpha); this.g.beginPath(); this.g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) this.g.lineTo(pts[i], pts[i + 1]);
    this.g.strokePath();
  }
  circle(x: number, y: number, r: number, fill: number, alpha = 1) { this.g.fillStyle(fill, alpha); this.g.fillCircle(x, y, r); }
  text(x: number, y: number, str: string, o: TextOpts = {}) {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: "Archivo, system-ui, sans-serif", fontSize: `${o.size ?? 11}px`, fontStyle: o.bold ? "bold" : "normal",
      color: hex(o.color ?? 0x1d2a30), backgroundColor: o.bg != null ? hex(o.bg) : undefined, padding: o.bg != null ? { x: 3, y: 1 } : undefined,
      resolution: 2,
    });
    t.setOrigin(o.align === "left" ? 0 : 0.5, 0.5);
    this.container.add(t);
  }
  image(src: string, x: number, y: number, w: number, h: number, alpha = 1) {
    const img = loadedImage(src);
    if (!img) return; // la scène se redessine quand l'image est chargée (onImagesLoaded)
    let key = keys.get(src);
    if (!key) { key = `img${keySeq++}`; keys.set(src, key); }
    if (!this.scene.textures.exists(key)) {
      // rastérisation sur un canvas 2D : un SVG passé directement à WebGL peut être rendu noir ou vide
      const ratio = (img.naturalHeight || h) / (img.naturalWidth || w) || h / w;
      const cw = Math.max(64, Math.min(512, Math.round(img.naturalWidth || w * 4)));
      const c = document.createElement("canvas");
      c.width = cw; c.height = Math.max(1, Math.round(cw * ratio));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      this.scene.textures.addCanvas(key, c);
    }
    // un objet Graphics est créé pour la suite du dessin afin de respecter l'ordre de superposition
    const im = this.scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(w, h).setAlpha(alpha);
    this.container.add(im);
    const g = this.scene.add.graphics();
    this.container.add(g);
    this.g = g;
  }
  imageQuad(src: string, o: [number, number], u: [number, number], v: [number, number], alpha = 1) {
    const img = loadedImage(src);
    if (!img) return;
    // Phaser ne sait pas cisailler une image : la projection est rastérisée une fois sur un canvas 2D
    const xs = [0, u[0], v[0], u[0] + v[0]], ys = [0, u[1], v[1], u[1] + v[1]];
    const x0 = Math.min(...xs), y0 = Math.min(...ys), bw = Math.max(...xs) - x0, bh = Math.max(...ys) - y0;
    const key = `quad|${src}|${u.map(Math.round)}|${v.map(Math.round)}`;
    let tex = keys.get(key);
    if (!tex) { tex = `img${keySeq++}`; keys.set(key, tex); }
    if (!this.scene.textures.exists(tex)) {
      const k = 2, c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(bw * k)); c.height = Math.max(1, Math.ceil(bh * k));
      const g2 = c.getContext("2d")!;
      g2.setTransform(u[0] * k, u[1] * k, v[0] * k, v[1] * k, -x0 * k, -y0 * k);
      g2.drawImage(img, 0, 0, 1, 1);
      this.scene.textures.addCanvas(tex, c);
    }
    const im = this.scene.add.image(o[0] + x0, o[1] + y0, tex).setOrigin(0, 0).setDisplaySize(bw, bh).setAlpha(alpha);
    this.container.add(im);
    const g = this.scene.add.graphics();
    this.container.add(g);
    this.g = g;
  }
}
