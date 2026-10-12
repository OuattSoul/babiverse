// Analyse des cartes ASCII pour le rendu en volume : bâtiments, murs, objets. Module pur.

export const BUILDING_CHARS = new Set(['r', 'o', 'g', 'W', 'Y', 'H', 'h', 'D']);
export const ROOF_CHARS = new Set(['r', 'o', 'g']);

/**
 * Regroupe les cases de bâtiment contiguës en rectangles.
 * Retourne [{ x0, y0, x1, y1, roof, facade }] : `facade` = caractères de la rangée sud (porte, fenêtres).
 */
export function findBuildings(map) {
  const h = map.length;
  const w = map[0].length;
  const seen = new Uint8Array(w * h);
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !BUILDING_CHARS.has(map[y][x])) continue;
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      let x0 = x, y0 = y, x1 = x, y1 = y;
      const roofCount = {};
      while (stack.length) {
        const [cx, cy] = stack.pop();
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
        const ch = map[cy][cx];
        if (ROOF_CHARS.has(ch)) roofCount[ch] = (roofCount[ch] || 0) + 1;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !BUILDING_CHARS.has(map[ny][nx])) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      const roof = Object.entries(roofCount).sort((a, b) => b[1] - a[1])[0]?.[0] || 'r';
      out.push({ x0, y0, x1, y1, roof, facade: map[y1].slice(x0, x1 + 1) });
    }
  }
  return out;
}

/** Murs (#, w...) fusionnés en rectangles : segments horizontaux, puis fusion verticale. */
export function wallRects(map, ch) {
  const runs = [];
  map.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== ch) { x++; continue; }
      const start = x;
      while (x < row.length && row[x] === ch) x++;
      runs.push({ x0: start, x1: x - 1, y0: y, y1: y });
    }
  });
  const merged = [];
  for (const r of runs) {
    const prev = merged.find((m) => m.x0 === r.x0 && m.x1 === r.x1 && m.y1 === r.y0 - 1);
    if (prev) prev.y1 = r.y1;
    else merged.push({ ...r });
  }
  return merged;
}

/** Positions des cases portant un caractère donné (arbres, meubles...). */
export function cellsOf(map, ch) {
  const out = [];
  map.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === ch) out.push([x, y]); });
  return out;
}
