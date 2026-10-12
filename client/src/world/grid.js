// Grille de collision et géométrie du monde. Module pur (aucune dépendance à Phaser),
// partagé par le rendu, le contrôleur du joueur, les PNJ et les tests.

export const TILE = 32;

// Légende des cartes ASCII : caractère -> index dans le tileset, solide, opaque (bloque la vue).
export const LEGEND = {
  '.': { index: 0, name: 'terre' },
  '_': { index: 1, name: 'trottoir' },
  '=': { index: 2, name: 'goudron' },
  '-': { index: 3, name: 'goudron_ligne' },
  ',': { index: 4, name: 'herbe' },
  'r': { index: 5, name: 'toit_tole', solid: true, opaque: true },
  'o': { index: 6, name: 'toit_ocre', solid: true, opaque: true },
  'g': { index: 7, name: 'toit_bleu', solid: true, opaque: true },
  'W': { index: 8, name: 'facade_creme', solid: true, opaque: true },
  'Y': { index: 9, name: 'facade_jaune', solid: true, opaque: true },
  'H': { index: 10, name: 'fenetre_creme', solid: true, opaque: true },
  'h': { index: 11, name: 'fenetre_jaune', solid: true, opaque: true },
  'D': { index: 12, name: 'porte', solid: true, opaque: true },
  'T': { index: 13, name: 'manguier', solid: true },
  'p': { index: 14, name: 'palmier', solid: true },
  '#': { index: 15, name: 'mur_cloture', solid: true, opaque: true },
  'w': { index: 16, name: 'mur_interieur', solid: true, opaque: true },
  'f': { index: 17, name: 'carrelage' },
  'F': { index: 18, name: 'ciment' },
  'E': { index: 19, name: 'paillasson' },
  'L': { index: 20, name: 'lit', solid: true },
  'S': { index: 21, name: 'etagere', solid: true },
  'Q': { index: 22, name: 'comptoir', solid: true },
  'K': { index: 23, name: 'table', solid: true },
  'Z': { index: 24, name: 'frigo', solid: true },
  'm': { index: 25, name: 'tapis' },
  '%': { index: 26, name: 'buisson', solid: true },
  '+': { index: 27, name: 'passage_pieton' },
  '|': { index: 28, name: 'goudron_ligne_verticale' },
  'l': { index: 29, name: 'parcelle' },
  ':': { index: 30, name: 'paves' },
};
export const TILE_COUNT = 31;

/**
 * Grille de collision d'une zone. `extra` : rectangles de cases solides et opaques ajoutés à la
 * volée (bâtiments construits par les joueurs, connus seulement par l'état serveur).
 */
export function buildGrid(zone, extra = []) {
  const h = zone.map.length;
  const w = zone.map[0].length;
  const solid = new Uint8Array(w * h);
  const opaque = new Uint8Array(w * h);
  const indices = [];
  for (let y = 0; y < h; y++) {
    const row = zone.map[y];
    if (row.length !== w) throw new Error(`Zone ${zone.id} : la ligne ${y} fait ${row.length} au lieu de ${w}`);
    const line = [];
    for (let x = 0; x < w; x++) {
      const def = LEGEND[row[x]];
      if (!def) throw new Error(`Zone ${zone.id} : caractère inconnu « ${row[x]} » en ${x},${y}`);
      line.push(def.index);
      solid[y * w + x] = def.solid ? 1 : 0;
      opaque[y * w + x] = def.opaque ? 1 : 0;
    }
    indices.push(line);
  }
  // Les décors multi-cases (véhicules, étals...) bloquent aussi le passage.
  for (const prop of zone.props || []) {
    if (!prop.solid) continue;
    const [px, py] = prop.tile;
    for (let dy = 0; dy < (prop.h || 1); dy++) {
      for (let dx = 0; dx < (prop.w || 1); dx++) solid[(py + dy) * w + px + dx] = 1;
    }
  }
  for (const r of extra) {
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) { solid[y * w + x] = 1; opaque[y * w + x] = 1; }
  }
  return { w, h, solid, opaque, indices, pxWidth: w * TILE, pxHeight: h * TILE };
}

export function isSolid(grid, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return true;
  return grid.solid[ty * grid.w + tx] === 1;
}

function isOpaque(grid, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return true;
  return grid.opaque[ty * grid.w + tx] === 1;
}

/** Le rectangle (centre x,y ; demi-tailles hw,hh) touche-t-il une case solide ? */
export function rectCollides(grid, x, y, hw, hh) {
  const x0 = Math.floor((x - hw) / TILE);
  const x1 = Math.floor((x + hw - 0.001) / TILE);
  const y0 = Math.floor((y - hh) / TILE);
  const y1 = Math.floor((y + hh - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) if (isSolid(grid, tx, ty)) return true;
  }
  return false;
}

/**
 * Déplace un corps en résolvant les collisions axe par axe (glissement le long des murs).
 * Le déplacement par appel doit rester inférieur à une demi-case (dt plafonné par l'appelant).
 */
export function moveBody(grid, body, dx, dy) {
  let { x, y } = body;
  const { hw, hh } = body;
  if (dx !== 0) {
    const nx = x + dx;
    if (!rectCollides(grid, nx, y, hw, hh)) x = nx;
    else if (dx > 0) x = Math.floor((nx + hw) / TILE) * TILE - hw;
    else x = (Math.floor((nx - hw) / TILE) + 1) * TILE + hw;
    if (rectCollides(grid, x, y, hw, hh)) x = body.x; // sécurité : ne jamais entrer dans un mur
  }
  if (dy !== 0) {
    const ny = y + dy;
    if (!rectCollides(grid, x, ny, hw, hh)) y = ny;
    else if (dy > 0) y = Math.floor((ny + hh) / TILE) * TILE - hh;
    else y = (Math.floor((ny - hh) / TILE) + 1) * TILE + hh;
    if (rectCollides(grid, x, y, hw, hh)) y = body.y;
  }
  return { x, y };
}

/** Ligne de vue entre deux points : bloquée par les cases opaques (murs), pas par les meubles. */
export function lineOfSight(grid, x0, y0, x1, y1) {
  const endTx = Math.floor(x1 / TILE);
  const endTy = Math.floor(y1 / TILE);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / 6));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const tx = Math.floor((x0 + (x1 - x0) * t) / TILE);
    const ty = Math.floor((y0 + (y1 - y0) * t) / TILE);
    if (tx === endTx && ty === endTy) continue; // la cible elle-même peut être un mur (porte)
    if (isOpaque(grid, tx, ty)) return false;
  }
  return true;
}

export const tileCenter = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE });

/** Centre en pixels d'un élément défini par sa case d'origine et sa taille en cases. */
export function anchorOf(def) {
  const [tx, ty] = def.tile;
  return { x: (tx + (def.w || 1) / 2) * TILE, y: (ty + (def.h || 1) / 2) * TILE };
}

/** Côté praticable d'une case (porte, façade) : décalage vers la case libre voisine, sud en priorité. */
export function frontOf(grid, tx, ty) {
  for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (!isSolid(grid, tx + dx, ty + dy)) return { dx, dy };
  return { dx: 0, dy: 1 };
}
