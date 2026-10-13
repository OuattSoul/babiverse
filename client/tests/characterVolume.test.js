import { describe, expect, it } from 'vitest';
import { allowedRange, alphaSpans, ATLAS_W, loftPiece, pieceRows, PIECES, VIEW_H, VIEW_W } from '../src/engine3d/characterVolume.js';

// Atlas factice (1 pixel par unité) : silhouette de face = tronc 70–130 (sommet à 20, pieds à 362)
// et bras 40–62 / 138–160 ; profil = corps de 85 à 120 (z de −15 à +20).
const RES = 1;
const W = ATLAS_W * RES;
const data = new Uint8ClampedArray(W * VIEW_H * 4);
const fill = (view, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[(y * W + view * VIEW_W + x) * 4 + 3] = 255;
};
fill(0, 70, 20, 130, 362);
fill(0, 40, 120, 62, 270);
fill(0, 138, 120, 160, 270);
fill(2, 85, 20, 120, 362);
const span = alphaSpans(data, W, RES);

describe('volume des personnages de l’atelier', () => {
  it('lit les silhouettes dans l’atlas', () => {
    expect(span(0, 100, 0, 200)).toEqual([70, 130]);
    expect(span(0, 150, 0, 70)).toEqual([40, 62]);
    expect(span(2, 100, 0, 200)).toEqual([85, 120]);
    expect(span(0, 10, 0, 200)).toBeNull();
  });

  it('retire les bras du tronc et des jambes', () => {
    expect(allowedRange(PIECES.torso, 50)).toEqual([0, 200]);
    expect(allowedRange(PIECES.torso, 150)).toEqual([70, 130]);
    expect(allowedRange(PIECES.legL, 250)).toEqual([70, 100]);
    expect(allowedRange(PIECES.legL, 300)).toEqual([0, 100]);
  });

  it('rangées : largeur de face, profondeur de profil ; bras de section ronde', () => {
    const torso = pieceRows(PIECES.torso, span);
    expect(torso[0].y).toBeGreaterThanOrEqual(20);
    const head = torso.find((r) => r.y > 50 && r.y < 60);
    expect(head).toMatchObject({ xl: 70, xr: 130, zb: -15, zf: 20 });
    const arm = pieceRows(PIECES.armL, span);
    expect(arm.length).toBeGreaterThan(10);
    for (const r of arm) {
      expect([r.xl, r.xr]).toEqual([40, 62]);
      expect(r.zb).toBeCloseTo(-r.zf);
      expect(r.zf).toBeGreaterThan(5);
    }
  });

  it('maillage fermé, à l’échelle de la silhouette, poids des vues cohérents', () => {
    const piece = PIECES.torso;
    const rows = pieceRows(piece, span);
    const m = loftPiece(rows, piece);
    const n = 12;
    expect(m.position.length / 3).toBe(rows.length * n + 2);
    expect(m.index.length).toBe((rows.length - 1) * n * 6 + 2 * n * 3);
    const xs = m.position.filter((_, i) => i % 3 === 0);
    const zs = m.position.filter((_, i) => i % 3 === 2);
    expect(Math.min(...xs)).toBeCloseTo(70 - piece.pivot[0]);
    expect(Math.max(...xs)).toBeCloseTo(130 - piece.pivot[0]);
    // vraie épaisseur (et non un plan)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(30);
    for (let i = 0; i < m.weight.length; i += 3) expect(m.weight[i] + m.weight[i + 1] + m.weight[i + 2]).toBeCloseTo(1);
    // sommet tourné vers l'avant : vue de face ; vers l'arrière : dos ; sur le côté : profil
    expect(m.weight.slice(0, 3)).toEqual([1, 0, 0]);
    m.weight.slice(6 * 3, 6 * 3 + 3).forEach((w, i) => expect(w).toBeCloseTo([0, 1, 0][i]));
    expect(m.weight[3 * 3 + 2]).toBeCloseTo(1);
    // coordonnées de texture dans la bonne vue de l'atlas
    for (let i = 0; i < m.uv.length; i += 2) expect(m.uv[i]).toBeLessThanOrEqual(VIEW_W / ATLAS_W);
    for (let i = 0; i < m.uvSide.length; i += 2) expect(m.uvSide[i]).toBeGreaterThanOrEqual((2 * VIEW_W) / ATLAS_W);
  });

  it('faces tournées vers l’extérieur', () => {
    const rows = pieceRows(PIECES.torso, span);
    const m = loftPiece(rows, PIECES.torso);
    const p = (i) => m.position.slice(i * 3, i * 3 + 3);
    let outward = 0;
    const tris = (rows.length - 1) * 12 * 2;
    for (let t = 0; t < tris; t++) {
      const [a, b, c] = [p(m.index[t * 3]), p(m.index[t * 3 + 1]), p(m.index[t * 3 + 2])];
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const nx = u[1] * v[2] - u[2] * v[1];
      const nz = u[0] * v[1] - u[1] * v[0];
      // direction du centre de la section (rangée du premier sommet) vers le triangle
      const row = rows[Math.floor(m.index[t * 3] / 12)];
      const cx = (a[0] + b[0] + c[0]) / 3 - ((row.xl + row.xr) / 2 - PIECES.torso.pivot[0]);
      const cz = (a[2] + b[2] + c[2]) / 3 - (row.zb + row.zf) / 2;
      if (nx * cx + nz * cz > 0) outward++;
    }
    expect(outward).toBe(tris);
  });

  it('pièce absente de l’image : pas de maillage', () => {
    expect(loftPiece(pieceRows(PIECES.legL, () => null), PIECES.legL)).toBeNull();
  });
});
