// Volume des personnages de l'atelier (module PUR, sans three.js).
// Chaque pièce du corps (tronc et tête, deux bras, deux jambes) devient une forme ronde construite rangée par
// rangée de l'image : une section elliptique aussi large que la silhouette de face et aussi profonde que la
// silhouette de profil. Les trois vues de l'atelier y sont projetées : face devant, dos derrière, profil sur les
// côtés, fondues entre elles selon l'orientation de la surface. Le personnage a ainsi une vraie épaisseur sous
// tous les angles (plus de plans tournés vers la caméra) et se retrouve exactement en son image vu de face.
// Repère : celui des SVG (0 0 200 380, y vers le bas) ; profondeur z = abscisse du profil − 100 (vers l'avant).

export const VIEW_W = 200;
export const VIEW_H = 380;
export const ATLAS_W = 3 * VIEW_W; // atlas : face | dos (non retourné, même abscisse que la face) | profil
const SIDE_BODY = 0.55; // = SIDE_BODY de atelier/views.js (épaisseur du corps / largeur de face)
const thin = (x) => 100 + (x - 100) * SIDE_BODY;

const ARM_L = [20, 116, 70, 280];
const ARM_R = [130, 116, 180, 280];
const BODY = { rect: [0, 0, 200, 380], cut: [ARM_L, ARM_R] };

// rect [x0, y0, x1, y1] : zone de la pièce ; pivot [x, y] : épaule ou hanche ; cut : bras retirés de la pièce ;
// swing : amplitude de la marche (rad, autour de l'axe des x) ; round : section ronde, sans vue de profil.
// Tronc et jambes se chevauchent de 12 unités : pas de fente à la hanche quand la jambe pivote.
export const PIECES = {
  torso: { rect: [0, 0, 200, 242], pivot: [100, 236], cut: [ARM_L, ARM_R] },
  legL: { rect: [0, 230, 100, 380], pivot: [86, 236], cut: [ARM_L, ARM_R], swing: 0.5 },
  legR: { rect: [100, 230, 200, 380], pivot: [114, 236], cut: [ARM_L, ARM_R], swing: -0.5 },
  armL: { rect: ARM_L, pivot: [64, 128], cut: [], swing: -0.4, round: true },
  armR: { rect: ARM_R, pivot: [136, 128], cut: [], swing: 0.4, round: true },
};

/** Abscisses [x0, x1] de la pièce à la rangée y, bras retirés (null si rien). */
export function allowedRange(piece, y) {
  let [x0, , x1] = piece.rect;
  for (const [cx0, cy0, cx1, cy1] of piece.cut) {
    if (y < cy0 || y > cy1 || cx1 <= x0 || cx0 >= x1) continue;
    if ((cx0 + cx1) / 2 < (x0 + x1) / 2) x0 = Math.max(x0, cx1);
    else x1 = Math.min(x1, cx0);
  }
  return x0 < x1 ? [x0, x1] : null;
}

/**
 * Lecteur de silhouette dans les pixels RGBA de l'atlas (largeur `width` px, `res` px par unité SVG) :
 * span(view, y, x0, x1) → [première, dernière abscisse opaque] de la rangée y entre x0 et x1, ou null.
 * view : 0 face, 1 dos, 2 profil.
 */
export function alphaSpans(data, width, res, threshold = 128) {
  return (view, y, x0, x1) => {
    const row = Math.floor(y * res);
    const off = view * VIEW_W * res;
    const a = Math.max(0, Math.ceil(x0 * res));
    const b = Math.min(VIEW_W * res, Math.floor(x1 * res));
    let first = -1;
    let last = -1;
    for (let px = a; px < b; px++) {
      if (data[(row * width + off + px) * 4 + 3] > threshold) { if (first < 0) first = px; last = px; }
    }
    return first < 0 ? null : [first / res, (last + 1) / res];
  };
}

/**
 * Rangées d'une pièce : { y, xl, xr, zb, zf } (silhouette de face [xl, xr], profondeur [zb, zf]).
 * span : lecteur de silhouette (alphaSpans). Profondeur lue sur le profil au droit du corps (bras exclus) ;
 * bras, ou profil vide à cette hauteur : section presque ronde centrée.
 */
export function pieceRows(piece, span, step = 4) {
  const [, y0, , y1] = piece.rect;
  const rows = [];
  for (let y = y0 + step / 2; y < y1; y += step) {
    const range = allowedRange(piece, y);
    const front = range && span(0, y, range[0], range[1]);
    if (!front) continue;
    const [xl, xr] = front;
    const body = !piece.round && allowedRange(BODY, y);
    const side = body && span(2, y, thin(body[0]), thin(body[1]));
    const half = Math.max(1, (xr - xl) * 0.45);
    const [zb, zf] = side ? [side[0] - 100, side[1] - 100] : [-half, half];
    rows.push({ y, xl, xr, zb, zf });
  }
  return rows;
}

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

/**
 * Maillage d'une pièce à partir de ses rangées (null s'il y en a moins de deux).
 * Positions en unités SVG relatives au pivot (y vers le haut, z vers l'avant), coordonnées de texture dans
 * l'atlas : `uv` = face (le dos est au même endroit décalé d'un tiers), `uvSide` = profil ; `weight` = part de
 * la face, du dos et du profil (somme 1). Triangles orientés vers l'extérieur ; sommet et base fermés.
 */
export function loftPiece(rows, piece, { step = 4, segments = 12, inset = 1.5 } = {}) {
  if (rows.length < 2) return null;
  const [px, py] = piece.pivot;
  const n = piece.round ? 8 : segments;
  const position = [];
  const uv = [];
  const uvSide = [];
  const weight = [];
  const index = [];
  const vertex = (row, x, y, z, w) => {
    position.push(x - px, py - y, z);
    uv.push(clamp(x, row.xl + inset, row.xr - inset) / ATLAS_W, 1 - row.y / VIEW_H);
    uvSide.push((2 * VIEW_W + 100 + clamp(z, row.zb + inset, row.zf - inset)) / ATLAS_W, 1 - row.y / VIEW_H);
    weight.push(...w);
  };
  for (const row of rows) {
    const cx = (row.xl + row.xr) / 2;
    const cz = (row.zb + row.zf) / 2;
    const a = (row.xr - row.xl) / 2;
    const b = (row.zf - row.zb) / 2;
    for (let k = 0; k < n; k++) {
      const t = (2 * Math.PI * k) / n; // 0 = devant (+z), π/2 = côté +x
      const sx = Math.sin(t);
      const cz0 = Math.cos(t);
      // normale de l'ellipse dans le plan horizontal → part de chaque vue
      let nx = sx / Math.max(a, 0.5);
      let nz = cz0 / Math.max(b, 0.5);
      const len = Math.hypot(nx, nz) || 1;
      nx /= len; nz /= len;
      let w;
      if (piece.round) {
        const f = clamp(0.5 + nz * 1.5, 0, 1);
        w = [f, 1 - f, 0];
      } else {
        const f = Math.max(nz, 0) ** 4;
        const bk = Math.max(-nz, 0) ** 4;
        const s = nx ** 4;
        const sum = f + bk + s || 1;
        w = [f / sum, bk / sum, s / sum];
      }
      vertex(row, cx + a * sx, row.y, cz + b * cz0, w);
    }
  }
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let k = 0; k < n; k++) {
      const a = i * n + k;
      const b = i * n + ((k + 1) % n);
      index.push(a, a + n, b, b, a + n, b + n);
    }
  }
  // sommet (crâne, épaule) et base (semelle, main)
  const cap = (row, y, ring, top) => {
    const c = position.length / 3;
    vertex(row, (row.xl + row.xr) / 2, y, (row.zb + row.zf) / 2, [0.5, 0.5, 0]);
    for (let k = 0; k < n; k++) {
      const a = ring * n + k;
      const b = ring * n + ((k + 1) % n);
      if (top) index.push(c, a, b); else index.push(c, b, a);
    }
  };
  cap(rows[0], rows[0].y - step / 2, 0, true);
  const last = rows.length - 1;
  cap(rows[last], rows[last].y + step / 2, last, false);
  return { position, uv, uvSide, weight, index };
}
