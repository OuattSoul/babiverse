// Plan des modèles 3D de la ville (kits Kenney) : quel modèle pour quel bâtiment, côté de la porte,
// miroir, mise à l'échelle et recoloration de la palette. Module pur (sans Three.js) : testé avec Vitest.
// Le chargement et la construction des objets 3D sont dans cityKit.js.

// Maisons du kit (façade côté +z) et position de leur porte en unités du modèle (x, vers la droite vue de face).
export const HOUSES = {
  'building-type-g': { door: -0.49 },
  'building-type-o': { door: 0.38 },
  'building-type-a': { door: 0 },
  'building-type-h': { door: 0 },
  'building-type-i': { door: 0 },
  'building-type-m': { door: 0.05 },
};
const HOMES = ['building-type-g', 'building-type-o', 'building-type-a', 'building-type-m', 'building-type-i'];
// Commerces : maisons de plain-pied, avec auvent et enseigne.
const SHOPS = ['building-type-h', 'building-type-g', 'building-type-i'];

const MAX_SHIFT = 0.2; // décalage maximal du modèle pour rapprocher sa porte de la case de porte
export const INSET = 0.3; // même retrait que les volumes dessinés (builders.js)
export const HEIGHT_BOOST = 1.9; // maisons du kit rehaussées : plus hautes que les personnages (1,35)

const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** Commerce (enseigne) ou habitation. */
export const isShop = (b) => !!b.sign || b.category === 'shop';

/**
 * Modèle d'un bâtiment de la ville : choisi d'après son identifiant (toujours le même pour un bâtiment),
 * retourné en miroir si sa porte n'est pas du bon côté, décalé (au plus MAX_SHIFT) vers la case de porte.
 * `sizeOf(modèle)` → {w, h, d} ; `door` rendu : position de la porte dans le repère de la façade (+z), en cases.
 */
export function houseChoice(b, sizeOf, list = isShop(b) ? SHOPS : HOMES) {
  const model = list[hash(b.id ?? `${b.x0},${b.y0}`) % list.length];
  const size = sizeOf(model);
  const cells = b.facade.length;
  const idx = Math.max(0, b.facade.indexOf('D'));
  const fromCenter = idx + 0.5 - cells / 2;
  // Façade au nord : le modèle est tourné d'un demi-tour, sa droite est notre gauche.
  const door = b.facing === 'N' ? -fromCenter : fromCenter;
  const modelDoor = HOUSES[model].door;
  const mirror = modelDoor !== 0 && Math.sign(modelDoor) !== Math.sign(door);
  const scale = fitScale(size, { w: cells - INSET, d: 2 - INSET });
  const placed = (mirror ? -modelDoor : modelDoor) * scale.x;
  const shift = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, door - placed));
  return { model, mirror, shift, scale, door: placed + shift };
}

/**
 * Échelle d'un modèle {w, h, d} pour tenir dans une emprise {w, d} : uniforme au sol (rien ne dépasse),
 * hauteur multipliée par `boost`.
 */
export function fitScale(size, footprint, boost = HEIGHT_BOOST) {
  const s = Math.min(footprint.w / size.w, footprint.d / size.d);
  return { x: s, y: s * boost, z: s };
}

// Zones de la palette 512×512 des kits (x, y, largeur, hauteur en pixels), repérées sur les modèles.
export const PALETTE = {
  roof: [32, 128, 32, 128], // toits des maisons (vert d'origine)
  wall: [192, 256, 64, 128], // murs des maisons (blanc ; la case grise x 32 colore les bordures, gardées)
  awning: [32, 128, 32, 128], // toile de l'auvent des commerces (palette du kit commercial)
  paint: { taxi: [288, 128, 32, 128], sedan: [416, 128, 32, 128], van: [480, 128, 32, 128] }, // carrosseries
};

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
export const hexToRgb = (hex) => {
  const v = parseInt(hex.replace('#', '').replace(/^(.)(.)(.)$/, '$1$1$2$2$3$3'), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/**
 * Repeint une zone de la palette (pixels RGBA, ImageData.data) dans la couleur voulue en gardant
 * son dégradé : chaque pixel prend la couleur cible, éclaircie ou assombrie comme l'original
 * par rapport à la moyenne de la zone.
 */
export function recolor(data, width, [x0, y0, w, h], hex) {
  const target = hexToRgb(hex);
  let sum = 0;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * width + x) * 4; sum += lum(data[i], data[i + 1], data[i + 2]); }
  const mean = sum / (w * h) || 1;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4;
      const k = lum(data[i], data[i + 1], data[i + 2]) / mean;
      for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(target[c] * k)));
    }
  }
}

/** Variation stable (rotation, taille) d'un arbre selon sa case : la ville est la même à chaque visite. */
export function treeVariation(x, y) {
  const h = hash(`${x},${y}`);
  return { rot: ((h % 360) * Math.PI) / 180, scale: 0.9 + ((h >> 9) % 21) / 100 };
}
