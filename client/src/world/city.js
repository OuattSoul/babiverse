// Générateur modulaire de la Cité Akwaba.
//
// La ville est décrite par des DONNÉES : un réseau de rues qui découpe des îlots, puis des
// bâtiments (gabarits réutilisables), des parcelles réservées aux joueurs et du mobilier urbain.
// Ajouter un bâtiment ou une parcelle = ajouter une ligne ; la carte de collision, le rendu 3D
// et les interactions en sont déduits. Module pur (testé avec Vitest).

import CITY from '../../../shared/city.json';
import { exitSpawnOf, interiorIdOf } from './interiors.js';
import { RESIDENTIAL, residentialRect } from './residential.js';

// La carte n'a pas de taille fixe : elle s'étend vers l'est et le sud pour contenir tout ce qui y est
// déclaré (voir cityExtent, plus bas). Placer un élément au-delà du bord actuel agrandit la ville ;
// routes, sol et enceinte suivent. L'origine (0, 0) reste fixe : les coordonnées enregistrées par le
// serveur (parcelles, constructions, positions) restent valables quand la carte grandit.

// --- Réseau routier ------------------------------------------------------------------
// Une route = trottoir, 3 voies (goudron / marquage / goudron), trottoir.
export const H_ROADS = [{ id: 'avenue', name: 'Avenue Akwaba', y: 12 }, { id: 'rue2', name: 'Rue des Fromagers', y: 26 }];
export const V_ROADS = [{ id: 'bd_ouest', name: 'Boulevard de l\'Ouest', x: 17 }, { id: 'bd_est', name: 'Boulevard de l\'Est', x: 37 }];

const inSpan = (v, start) => v >= start && v <= start + 4;
const roadCore = (v, start) => v >= start + 1 && v <= start + 3;

// --- Gabarits de bâtiments : façade (une rangée) + toit (une rangée). 'D' = porte. ---
// Tous les bâtiments occupent 2×2 cases ; on entre dans leur intérieur en les touchant.
export const TEMPLATES = {
  maison: { facade: 'HD', roof: 'r' },
  maison_b: { facade: 'DW', roof: 'g' },
  maison_c: { facade: 'HD', roof: 'o' },
  boutique: { facade: 'YD', roof: 'g' },
  boutique_b: { facade: 'Dh', roof: 'o' },
  maquis: { facade: 'WD', roof: 'g' },
  depot: { facade: 'YD', roof: 'r' },
};

// Bâtiments publics ou prédéfinis (n'appartiennent à aucun joueur).
// name, category ('building' par défaut, 'shop' pour un commerce) et info alimentent leur fiche.
// facing : 'S' = façade au sud (donne sur la rue au sud), 'N' = façade au nord.
// interior : type d'intérieur généré (world/interiors.js) ; zone : intérieur dessiné à la main (zones.js).
export const BUILDINGS = [
  // Îlot A (nord-ouest) : voisin, épicerie. « Chez moi » est la maison du joueur dans le lotissement.
  { id: 'voisin_nord', template: 'maison_b', x: 7, y: 9, facing: 'S', name: 'Maison des voisins', interior: 'house', info: 'Une maison du quartier. Ça sent bon le foutou.' },
  { id: 'epicerie', template: 'boutique', x: 11, y: 9, facing: 'S', sign: { text: 'ÉPICERIE', bg: '#16a085', fg: '#fff' }, name: 'Épicerie Chez Fofana', category: 'shop', zone: 'epicerie', enterLabel: "Entrer à l'épicerie", info: 'Produits du quotidien et casiers de boissons pour ton kiosque.' },
  // Îlot B : maquis et dépôt Diabaté
  { id: 'maquis', template: 'maquis', x: 24, y: 9, facing: 'S', sign: { text: 'MAQUIS LE BON COIN', bg: '#27ae60', fg: '#fff' }, name: 'Maquis Le Bon Coin', category: 'shop', interior: 'maquis', info: 'Le maquis « Le Bon Coin » ouvre le soir. On y sert poisson braisé et attiéké.' },
  { id: 'depot', template: 'depot', x: 31, y: 9, facing: 'S', sign: { text: 'DÉPÔT DIABATÉ', bg: '#2c3e50', fg: '#f1c40f' }, name: 'Dépôt Diabaté', category: 'shop', interior: 'depot', info: 'Dépôt Diabaté — Livraisons dans tout le quartier. Le patron attend devant le dépôt.' },
  // Îlot D : maisons sur la rue des Fromagers
  { id: 'kouassi', template: 'maison', x: 4, y: 24, facing: 'S', name: 'Maison des Kouassi', interior: 'house', info: 'Les photos de famille des Kouassi sont posées sur la table.' },
  { id: 'voisin_sud', template: 'maison_b', x: 12, y: 24, facing: 'S', name: 'Maison', interior: 'house' },
  // Îlot E : petits commerces autour de la place
  { id: 'couture', template: 'boutique', x: 23, y: 24, facing: 'S', sign: { text: 'COUTURE', bg: '#8e44ad', fg: '#fff' }, name: 'Atelier de couture', category: 'shop', interior: 'shop', info: "Atelier de couture : pagnes, uniformes, retouches. « Revenez demain, c'est presque fini ! »" },
  { id: 'pharmacie', template: 'boutique_b', x: 28, y: 24, facing: 'S', sign: { text: '✚ PHARMACIE', bg: '#27ae60', fg: '#fff' }, name: 'Pharmacie', category: 'shop', interior: 'pharmacy', info: 'La pharmacie du quartier. Pharmacie de garde cette semaine.' },
  { id: 'transfert', template: 'boutique', x: 33, y: 24, facing: 'S', sign: { text: 'TRANSFERT', bg: '#e67e22', fg: '#fff' }, name: "Kiosque de transfert d'argent", category: 'shop', interior: 'shop', info: "Dépôts et retraits d'argent mobile (service non disponible dans le jeu)." },
  // Îlot F : chez Mme Bamba
  { id: 'bamba', template: 'maison_c', x: 45, y: 24, facing: 'S', name: 'Chez Mme Bamba', interior: 'house', info: "Des pagnes neufs, encore pliés, attendent d'être vendus au marché." },
  // Îlot G : maison donnant au nord sur la rue des Fromagers
  { id: 'voisin_g', template: 'maison_c', x: 3, y: 31, facing: 'N', name: 'Maison', interior: 'house' },
];

// Parcelles constructibles et emplacements publicitaires : source unique partagée avec le serveur.
// front : côté par lequel on accède à la parcelle.
export const PLOTS = CITY.plots;
export const AD_SLOTS = CITY.ad_slots;
export const PLAYER_BUILDINGS = CITY.player_buildings;

// Îlots : zone, sol par défaut, place pavée éventuelle.
const PLAZA = { x0: 24, y0: 18, x1: 34, y1: 22 };

// --- Mobilier urbain (décors) -------------------------------------------------------------
const POLES_Y = [12, 26]; // poteaux électriques sur le trottoir nord des deux rues
const POLE_X = [3, 9, 15, 23, 29, 35, 44, 50];
const LAMPS = [
  ...[5, 11, 25, 31, 46, 52].map((x) => [x, 16]),
  ...[6, 12, 24, 32, 45, 51].map((x) => [x, 30]),
  ...[5, 21, 34].map((y) => [17, y]), ...[8, 22, 35].map((y) => [41, y]),
];

function decor() {
  const props = [
    // Les véhicules circulent sur les voies (voir world/traffic.js) : aucun n'est garé sur la chaussée.
    // Maquis et dépôt
    { kind: 'parasol', tile: [23, 11], solid: true },
    { kind: 'parasol', tile: [29, 11], solid: true },
    { kind: 'crates', tile: [30, 11], solid: true },
    { kind: 'crates', tile: [35, 11], solid: true },
    // Kiosque du joueur et étal de garba
    { kind: 'kiosk', tile: [5, 18], w: 2, solid: true },
    { kind: 'garba_stand', tile: [10, 18], w: 2, solid: true },
    // Place Akwaba
    { kind: 'bench', tile: [26, 19], solid: true }, { kind: 'bench', tile: [32, 19], solid: true },
    { kind: 'bench', tile: [26, 22], solid: true }, { kind: 'bench', tile: [32, 22], solid: true },
    { kind: 'bin', tile: [24, 18], solid: true }, { kind: 'bin', tile: [34, 22], solid: true },
    { kind: 'bin', tile: [9, 11], solid: true }, { kind: 'bin', tile: [36, 25], solid: true },
    // Signalisation : stops aux carrefours (à côté des passages piétons, pas au bout), directions aux extrémités des boulevards
    { kind: 'stop', tile: [15, 16], solid: true }, { kind: 'stop', tile: [24, 12], solid: true },
    { kind: 'stop', tile: [35, 16], solid: true }, { kind: 'stop', tile: [43, 12], solid: true },
    { kind: 'stop', tile: [15, 30], solid: true }, { kind: 'stop', tile: [43, 26], solid: true },
    { kind: 'roadsign', tile: [21, 2], text: '↑ ADJAMÉ', solid: true },
    { kind: 'roadsign', tile: [41, 2], text: '↑ PLATEAU', solid: true },
    { kind: 'roadsign', tile: [17, 37], text: '↓ TREICHVILLE', solid: true },
    { kind: 'roadsign', tile: [37, 37], text: '↓ MARCORY', solid: true },
  ];
  for (const y of POLES_Y) for (const x of POLE_X) props.push({ kind: 'pole', tile: [x, y], solid: true, wireGroup: `poles_${y}` });
  for (const [x, y] of LAMPS) props.push({ kind: 'lamp', tile: [x, y], solid: true });
  for (const slot of AD_SLOTS) props.push({ kind: 'billboard', tile: [slot.x, slot.y], w: slot.w, solid: true, slot: slot.id, facing: slot.facing, support: slot.support, board: slot.board });
  for (const p of PLOTS) {
    props.push({ kind: 'plot', tile: [p.x, p.y], w: p.w, h: p.h, plot: p.id });
    props.push({ kind: 'plotsign', tile: plotSignTile(p), plot: p.id, facing: p.front, solid: true });
  }
  return props;
}

// Arbres : alignements le long des cours et dans les îlots.
const TREES = [
  [1, 8], [9, 2], [12, 3], [14, 6], [1, 20], [15, 21], [2, 36], [6, 35], [16, 34],
  [22, 8], [36, 8], [22, 20], [36, 20], [22, 36], [29, 37], [36, 34],
  [42, 2], [48, 2], [54, 3], [42, 22], [54, 23], [42, 35], [54, 37], [48, 38],
];
const PALMS = [[10, 7], [28, 7], [46, 11], [16, 1], [8, 31], [30, 22]];
const BUSHES = [[2, 11], [22, 11], [36, 1], [42, 17], [54, 17]];

export function plotSignTile(p) {
  const cx = p.x + Math.floor(p.w / 2);
  return p.front === 'S' ? [cx, p.y + p.h - 1] : [cx, p.y];
}

// --- Étendue de la carte -----------------------------------------------------------------------

/**
 * Rectangles (cases, bornes incluses) de tout ce qui doit tenir dans la carte. Le lotissement compte
 * `blocks` blocs ouverts : le serveur en ouvre un de plus, au sud, quand les précédents sont pleins.
 */
function contentRects(blocks = 1) {
  const rects = [];
  const tile = ([x, y], w = 1, h = 1) => rects.push({ x0: x, y0: y, x1: x + w - 1, y1: y + h - 1 });
  for (const r of H_ROADS) rects.push({ x0: 1, y0: r.y, x1: 1, y1: r.y + 4 });
  for (const r of V_ROADS) rects.push({ x0: r.x, y0: 1, x1: r.x + 4, y1: 1 });
  rects.push(PLAZA, residentialRect(blocks));
  for (const b of BUILDINGS) rects.push(buildingRect(b));
  for (const p of PLOTS) tile([p.x, p.y], p.w, p.h);
  for (const a of AD_SLOTS) tile([a.x, a.y], a.w || 1);
  for (const p of decor()) tile(p.tile, p.w, p.h);
  for (const t of [...TREES, ...PALMS, ...BUSHES]) tile(t);
  return rects;
}

/**
 * Taille de carte qui contient tous les rectangles, plus `margin` cases de terrain libre et la
 * rangée d'enceinte. Les coordonnées doivent être ≥ 1 (la case 0 est l'enceinte).
 */
export function cityExtent(rects, margin = 0) {
  let w = 1;
  let h = 1;
  for (const r of rects) {
    if (r.x0 < 1 || r.y0 < 1) throw new Error(`Élément hors carte en ${r.x0},${r.y0} : les coordonnées commencent à 1`);
    w = Math.max(w, r.x1 + 1);
    h = Math.max(h, r.y1 + 1);
  }
  return { w: w + margin + 1, h: h + margin + 1 };
}

// Taille de la carte avec un seul bloc de lotissement ouvert.
export const { w: W, h: H } = cityExtent(contentRects());

// --- Construction de la carte ---------------------------------------------------------------

function blank(W, H) {
  return Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : '.')));
}

function paintRoads(m, W, H) {
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const hr = H_ROADS.find((r) => inSpan(y, r.y));
      const vr = V_ROADS.find((r) => inSpan(x, r.x));
      if (!hr && !vr) continue;
      const hCore = hr && roadCore(y, hr.y);
      const vCore = vr && roadCore(x, vr.x);
      if (hCore && vCore) m[y][x] = '=';                         // carrefour
      else if (hCore) m[y][x] = y === hr.y + 2 && !vr ? '-' : '='; // voie horizontale
      else if (vCore) m[y][x] = x === vr.x + 2 && !hr ? '|' : '='; // voie verticale
      else m[y][x] = '_';                                         // trottoir
    }
  }
  // Passages piétons de part et d'autre de chaque carrefour.
  for (const hr of H_ROADS) {
    for (const vr of V_ROADS) {
      for (let k = 1; k <= 3; k++) {
        for (const x of [vr.x - 1, vr.x + 5]) if (m[hr.y + k][x] !== '#') m[hr.y + k][x] = '+';
        for (const y of [hr.y - 1, hr.y + 5]) if (m[y][vr.x + k] !== '#') m[y][vr.x + k] = '+';
      }
    }
  }
}

/** Cases occupées par un bâtiment : [rangée de toit, rangée de façade] selon l'orientation. */
export function buildingRect(b) {
  const t = TEMPLATES[b.template];
  const w = t.facade.length;
  return { x0: b.x, y0: b.y, x1: b.x + w - 1, y1: b.y + 1, facadeY: b.facing === 'S' ? b.y + 1 : b.y, ...t };
}

export function doorTile(b) {
  const r = buildingRect(b);
  return [r.x0 + r.facade.indexOf('D'), r.facadeY];
}

function stampBuilding(m, b) {
  const r = buildingRect(b);
  for (let i = 0; i < r.facade.length; i++) {
    m[r.facadeY][r.x0 + i] = r.facade[i];
    m[b.facing === 'S' ? r.y0 : r.y1][r.x0 + i] = r.roof;
  }
}

function buildMap(blocks) {
  const { w: W, h: H } = cityExtent(contentRects(blocks));
  const m = blank(W, H);
  // Herbe dans les îlots de bord ; terre battue ailleurs (cours, rues de quartier, lotissement).
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) if ((y < 7 || y > 31) && m[y][x] === '.') m[y][x] = ',';
  const lots = residentialRect(blocks);
  for (let y = lots.y0; y <= lots.y1; y++) for (let x = lots.x0; x <= lots.x1; x++) m[y][x] = '.';
  paintRoads(m, W, H);
  for (let y = PLAZA.y0; y <= PLAZA.y1; y++) for (let x = PLAZA.x0; x <= PLAZA.x1; x++) m[y][x] = ':';
  for (const p of PLOTS) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) m[y][x] = 'l';
  for (const b of BUILDINGS) stampBuilding(m, b);
  for (const [x, y] of TREES) m[y][x] = 'T';
  for (const [x, y] of PALMS) m[y][x] = 'p';
  for (const [x, y] of BUSHES) m[y][x] = '%';
  return m.map((row) => row.join(''));
}

// --- Validation de placement (futurs bâtiments des joueurs) ------------------------------------

const ROAD_CHARS = new Set(['=', '-', '|', '+', '_']);

/**
 * Un bâtiment de joueur peut-il occuper ce rectangle ?
 * Il doit tenir entièrement dans une parcelle, ne chevaucher ni route ni bâtiment ni décor solide,
 * et garder un accès praticable devant sa façade.
 */
export function canPlaceBuilding(city, rect, solidAt) {
  const plot = city.plots.find((p) => rect.x0 >= p.x && rect.y0 >= p.y && rect.x1 < p.x + p.w && rect.y1 < p.y + p.h);
  if (!plot) return { ok: false, reason: 'hors_parcelle' };
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (ROAD_CHARS.has(city.map[y][x])) return { ok: false, reason: 'route' };
      if (city.map[y][x] !== 'l' || solidAt(x, y)) return { ok: false, reason: 'occupe' };
    }
  }
  const frontY = plot.front === 'S' ? rect.y1 + 1 : rect.y0 - 1;
  let access = false;
  for (let x = rect.x0; x <= rect.x1; x++) if (!solidAt(x, frontY)) access = true;
  return access ? { ok: true, plot: plot.id } : { ok: false, reason: 'sans_acces' };
}

// --- Zone « quartier » complète ----------------------------------------------------------------

/** residentialBlocks : blocs de lotissement ouverts (state.world.residential.blocks). */
export function buildCity({ residentialBlocks = 1 } = {}) {
  const map = buildMap(residentialBlocks);
  const byId = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
  const door = (id) => doorTile(byId[id]);
  const front = (id) => { const [x, y] = door(id); return [x, byId[id].facing === 'S' ? y + 1 : y - 1]; };

  // Chaque bâtiment a une porte qui mène à son intérieur ; les colis se livrent à la fenêtre.
  const windowTile = (id) => {
    const r = buildingRect(byId[id]);
    return [r.x0 + [...r.facade].findIndex((ch) => ch !== 'D'), r.facadeY];
  };
  const interactables = [
    ...BUILDINGS.map((b) => ({
      id: `door_${b.id}`, type: 'door', tile: door(b.id), label: b.enterLabel || `Entrer : ${b.name}`,
      target: { zone: interiorIdOf(b), spawn: 'entree' },
    })),
    { id: 'kiosk', type: 'kiosk', tile: [5, 18], w: 2, range: 50 },
    { id: 'drop_maquis', type: 'delivery', tile: windowTile('maquis'), label: 'Livrer le colis au maquis' },
    { id: 'drop_epicerie', type: 'delivery', tile: windowTile('epicerie'), label: "Livrer le colis à l'épicerie" },
    { id: 'drop_sud_1', type: 'delivery', tile: windowTile('kouassi'), label: 'Livrer le colis chez les Kouassi' },
    { id: 'drop_sud_2', type: 'delivery', tile: windowTile('bamba'), label: 'Livrer le colis chez Mme Bamba' },
    ...PLOTS.map((p) => ({ id: `plot_${p.id}`, type: 'plot', tile: plotSignTile(p), plot: p.id, label: `Parcelle ${p.id}`, size: `${p.w}×${p.h}` })),
    ...AD_SLOTS.map((a) => ({ id: `ad_${a.id}`, type: 'billboard', tile: [a.x, a.y], w: a.w, slot: a.id, support: a.support, board: a.board, label: 'Regarder le panneau' })),
  ];

  return {
    id: 'quartier',
    name: 'Cité Akwaba',
    outdoor: true,
    // Ville : on explore en faisant glisser la caméra ; un clic sélectionne, il ne fait jamais marcher.
    navigation: 'camera',
    map,
    buildings: BUILDINGS.map((b) => ({ ...b, ...buildingRect(b) })),
    plots: PLOTS,
    // Maisons initiales des joueurs : affichées d'après l'état serveur (voir world/residential.js).
    residential: { ...RESIDENTIAL, blocks: residentialBlocks },
    roads: { horizontal: H_ROADS, vertical: V_ROADS },
    // Sortie du studio : devant ma maison du lotissement (World3D.spawnTile) ; ce point ne sert que si
    // elle n'est pas encore connue.
    spawns: { default: [6, 12], [exitSpawnOf('maison')]: [6, 12], ...Object.fromEntries(BUILDINGS.map((b) => [exitSpawnOf(b.id), front(b.id)])) },
    props: decor(),
    interactables,
    npcs: [
      { id: 'koffi', tile: [8, 21], behavior: { type: 'wander', radius: 2 } },
      { id: 'aya', tile: [14, 21], behavior: { type: 'static', facing: 'right' } },
      { id: 'adjoua', tile: [11, 19], behavior: { type: 'static', facing: 'up' }, range: 72 },
      { id: 'diabate', tile: [33, 11], behavior: { type: 'static', facing: 'down' } },
      { id: 'ibrahim', tile: [27, 11], behavior: { type: 'static', facing: 'down' } },
      { id: 'seydou', tile: [30, 16], behavior: { type: 'static', facing: 'up' } },
      { id: 'fatou', tile: [29, 20], behavior: { type: 'wander', radius: 2 } },
      { id: 'awa', tile: [25, 23], behavior: { type: 'static', facing: 'down' } },
      { id: 'kouassi', tile: [2, 23], behavior: { type: 'static', facing: 'right' } },
      { id: 'bamba', tile: [45, 23], behavior: { type: 'wander', radius: 1 } },
    ],
    // Animation de la ville : véhicules en circulation et passants anonymes (voir world/traffic.js).
    ambient: { vehicles: 12, pedestrians: 16 },
    // Clients du kiosque : ils longent la cour au nord de l'îlot puis attendent devant le comptoir.
    customers: { spawns: [[1, 17], [16, 17]], wait: [6, 17] },
  };
}
