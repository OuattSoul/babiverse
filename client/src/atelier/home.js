// Intérieur conçu dans l'atelier → zone jouable du jeu (même format que world/zones.js). Module pur, testé.
//
// L'atelier décrit un plan sur grille (1 tuile = 1 case du jeu) : pièces rectangulaires accolées, portes posées
// sur un côté de case, meubles, point d'apparition. Le jeu, lui, dessine les murs dans des cases. On insère donc
// une ligne (ou colonne) de mur entre deux pièces voisines différentes ; là où cette ligne traverse une même
// pièce, elle reste du sol (la pièce s'élargit d'une case). Une porte entre deux pièces ouvre le mur ; la porte
// vers l'extérieur devient le paillasson « E » qui ramène dans la ville.

const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OUTDOOR_FLOOR = new Set(['garage', 'terrace']);
// Texte des fiches des meubles (le jeu n'a pas de mécanique pour ces actions : ce sont des fiches d'information).
const ACTION_TEXT = {
  sit: "Tu t'installes un moment. On est bien chez soi.",
  eat: "La table est prête… encore faut-il avoir quelque chose à manger.",
  cook: "La cuisine attend des provisions de l'épicerie.",
  store: 'Rien de spécial à l\'intérieur pour l\'instant.',
  wash: "Un peu d'eau fraîche, ça fait du bien.",
  use: 'Tout est propre.',
  watch: 'Les informations du soir passent à la télévision.',
  work: 'Un coin calme pour travailler.',
  shop: 'Quelques affaires bien rangées.',
};
const ACTION_LABEL = { sit: "S'asseoir", eat: 'Regarder la table', cook: 'Regarder la cuisine', store: 'Ouvrir', wash: 'Se rafraîchir', use: 'Regarder', watch: 'Regarder la télé', work: 'Regarder' };

/**
 * home : { name, materials: {floor, wall}, interior: {width, depth, rooms, doors, furniture, spawn}, furniture: {item: spec} }
 * Retourne la zone (id, map, spawns, props « furniture », interactables : porte, lit, fiches).
 */
export function homeZone(home, { id = 'maison', exit = { zone: 'quartier', spawn: 'from_maison' }, beds: allowNap = true } = {}) {
  const p = home.interior;
  const W = p.width;
  const D = p.depth;
  const owner = Array.from({ length: D }, () => Array(W).fill(null));
  const type = {};
  for (const r of p.rooms || []) {
    type[r.id] = r.type;
    for (let y = r.y; y < Math.min(D, r.y + r.d); y++) for (let x = r.x; x < Math.min(W, r.x + r.w); x++) owner[y][x] ??= r.id;
  }
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < D ? owner[y][x] : null);
  const split = (a, b) => a && b && a !== b;
  // Colonnes (lignes) de mur à insérer avant la colonne k (la ligne k)
  const wallCol = Array.from({ length: W }, (_, k) => k > 0 && owner.some((row) => split(row[k - 1], row[k])));
  const wallRow = Array.from({ length: D }, (_, k) => k > 0 && owner[k - 1].some((a, x) => split(a, owner[k][x])));
  const gx = [];
  const gy = [];
  for (let x = 0; x < W; x++) gx.push(x === 0 ? 1 : gx[x - 1] + 1 + (wallCol[x] ? 1 : 0));
  for (let y = 0; y < D; y++) gy.push(y === 0 ? 1 : gy[y - 1] + 1 + (wallRow[y] ? 1 : 0));
  const GW = gx[W - 1] + 2;
  const GH = gy[D - 1] + 2;
  const grid = Array.from({ length: GH }, () => Array(GW).fill('w'));
  const floor = (room) => (OUTDOOR_FLOOR.has(type[room]) ? 'F' : 'f');

  for (let y = 0; y < D; y++) {
    for (let x = 0; x < W; x++) {
      if (owner[y][x]) grid[gy[y]][gx[x]] = floor(owner[y][x]);
      // mur inséré à gauche / au-dessus : du sol s'il traverse une seule et même pièce
      if (wallCol[x] && owner[y][x] && owner[y][x] === at(x - 1, y)) grid[gy[y]][gx[x] - 1] = floor(owner[y][x]);
      if (wallRow[y] && owner[y][x] && owner[y][x] === at(x, y - 1)) grid[gy[y] - 1][gx[x]] = floor(owner[y][x]);
      if (wallCol[x] && wallRow[y] && owner[y][x]
        && [at(x - 1, y), at(x, y - 1), at(x - 1, y - 1)].every((o) => o === owner[y][x])) grid[gy[y] - 1][gx[x] - 1] = floor(owner[y][x]);
    }
  }

  const cell = ([x, y]) => [gx[Math.max(0, Math.min(W - 1, x))], gy[Math.max(0, Math.min(D - 1, y))]];
  let exitDoor = null;
  for (const d of p.doors || []) {
    const [x, y] = d.cell;
    if (!at(x, y) || !DELTA[d.side]) continue;
    const [cx, cy] = cell(d.cell);
    const [tx, ty] = [cx + DELTA[d.side][0], cy + DELTA[d.side][1]];
    if (d.connects.includes('exterior')) {
      if (!exitDoor) { grid[ty][tx] = 'E'; exitDoor = { tile: [tx, ty], inside: [cx, cy] }; }
    } else if (grid[ty][tx] === 'w') grid[ty][tx] = floor(at(x, y));
  }
  const [sx, sy] = cell(p.spawn || [0, 0]);
  if (!exitDoor) {
    // plan sans sortie (refusé par l'atelier) : paillasson sous le point d'apparition
    grid[GH - 1][sx] = 'E';
    exitDoor = { tile: [sx, GH - 1], inside: [sx, GH - 2] };
  }

  const props = [];
  const interactables = [
    { id: 'sortie_maison', type: 'door', tile: exitDoor.tile, name: "Porte d'entrée", label: 'Sortir', target: exit, range: 40 },
  ];
  let beds = 0;
  for (const f of p.furniture || []) {
    const spec = home.furniture?.[f.item] || { label: 'Meuble', shape: 'box', color: '#a07a4a', height_px: 10, actions: [] };
    const [x0, y0] = cell([f.x, f.y]);
    const [x1, y1] = cell([f.x + f.w - 1, f.y + f.d - 1]);
    const box = { tile: [x0, y0], w: x1 - x0 + 1, h: y1 - y0 + 1 };
    // portée mesurée depuis le centre du meuble : un grand lit doit s'utiliser depuis n'importe quel côté
    const range = Math.round((Math.max(box.w, box.h) / 2 + 0.9) * 32);
    props.push({ kind: 'furniture', ...box, solid: true, shape: spec.shape, color: spec.color, height: spec.height_px, name: spec.label });
    const action = f.action || (spec.actions || [])[0] || null;
    // La sieste n'est possible que chez soi (règle du serveur) : ailleurs, le lit n'est qu'une fiche.
    if (allowNap && (action === 'sleep' || (!f.action && (spec.actions || []).includes('sleep')))) {
      interactables.push({ id: beds++ ? `lit_${f.id}` : 'lit', type: 'bed', ...box, range, name: spec.label, label: 'Faire une sieste', text: "Une petite sieste redonne de l'énergie." });
    } else if (f.interactive || action) {
      interactables.push({ id: `meuble_${f.id}`, type: 'info', ...box, range, name: spec.label, label: ACTION_LABEL[action] || 'Regarder', text: ACTION_TEXT[action] || `${spec.label}.` });
    }
  }

  return {
    id,
    name: home.name,
    outdoor: false,
    navigation: 'walk',
    map: grid.map((row) => row.join('')),
    palette: { floor: home.materials?.floor || null, wall: home.materials?.wall || null },
    spawns: { default: [sx, sy], entree: exitDoor.inside },
    props,
    interactables,
    npcs: [],
    source: { asset_id: home.asset_id, version: home.version },
  };
}
