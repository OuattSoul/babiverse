// Personnages 3D animés (Kenney Animated Characters, CC0) : un corps humain unique dont les vêtements sont une
// image (texture 1024² en coordonnées de référence) peinte d'après la tenue de l'atelier.
// Module pur (sans Three.js ni canvas) : style de la tenue, couleurs, opérations de peinture. Testé avec Vitest.
// Le chargement, la peinture et l'animation sont dans characterKit.js.

/**
 * Zones de la texture du modèle (pixels sur 1024, origine en haut à gauche), relevées sur une mire :
 * la tête s'enroule sur x 0–640 (visage au centre, nuque aux bords), torse et bras partagent leur zone
 * (avant du torse en bas, dos au-dessus, bras de l'épaule au poignet vers les bords).
 */
export const LAYOUT = {
  head: [0, 0, 640, 490],
  crown: [0, 0, 640, 70],
  face: [185, 64, 270, 266], // d'une oreille à l'autre, du front au menton
  torso: [0, 490, 640, 534],
  torsoFront: [228, 768, 184, 256],
  torsoBack: [228, 512, 184, 256],
  upperArms: [[150, 640, 106, 190], [384, 640, 108, 190]],
  foreArms: [[30, 640, 120, 190], [492, 640, 118, 190]],
  legs: [612, 764, 412, 260],
  shins: [612, 880, 412, 144],
  shoes: [640, 134, 184, 390],
  hands: [824, 134, 200, 390],
};

// Découpes de la vue de face SVG de l'atelier (repère 0 0 200 380) reportées sur la texture.
export const SVG_CROPS = {
  face: { from: [68, 26, 64, 84], to: LAYOUT.face },
  torso: { from: [70, 118, 60, 108], to: LAYOUT.torsoFront },
  skirt: { from: [64, 222, 72, 110], to: LAYOUT.legs },
};

const DEFAULTS = { top: '#e67e22', bottom: '#2c3e50', shoes: '#3a2a20', hair: '#1b1b1b', skin: '#8d5524' };
const SHORT_SLEEVES = /t-shirt|polo|blouse|bouffant|kaba|robe(?! longue)/i;
const NO_SLEEVES = /débardeur|debardeur|bustier/i;
const LONG_HAIR = /long|box braids|queue|nattes/i;
const AFRO = /afro|bantu/i;
const BALD = /ras/i;
const SKIRT = /jupe|pagne/i;
const SHORTS = /short/i;

/** Coiffure → style peint : rasé, court, long (dans la nuque), afro (volume plus large). */
export function hairStyle(name) {
  if (!name) return 'short';
  if (BALD.test(name)) return 'bald';
  if (AFRO.test(name)) return 'afro';
  if (LONG_HAIR.test(name)) return 'long';
  return 'short';
}

/**
 * Tenue d'une apparence → { colors {skin, hair, top, bottom, shoes, outer}, style }.
 * - apparence de l'atelier (`svg` : {body, skin, hair_color, layers{emplacement: {part, colors}}}) ; `entry(clé)`
 *   donne la pièce de la garde-robe (name, default_colors, gender pour une silhouette) ;
 * - apparence classique du jeu ({skin, outfit, pants, hair: 'afro' | 'short' | 'braids'}).
 */
export function outfitOf(look, svg, entry = () => null) {
  return svg ? studioOutfit(svg, entry) : classicOutfit(look);
}

function studioOutfit(svg, entry) {
  const layer = (slot) => svg.layers?.[slot] || null;
  const piece = (slot) => (layer(slot) ? entry(layer(slot).part) : null);
  const color = (slot) => {
    const l = layer(slot);
    if (!l) return null;
    return l.colors?.primary || piece(slot)?.default_colors?.primary || null;
  };
  const name = (slot) => piece(slot)?.name || '';
  const dress = !!layer('dress');
  const outerName = name('outerwear');
  const topName = dress ? name('dress') : name('top');
  return {
    colors: {
      skin: svg.skin || DEFAULTS.skin,
      hair: color('hair') || svg.hair_color || DEFAULTS.hair,
      top: (dress ? color('dress') : color('top')) || DEFAULTS.top,
      bottom: (dress ? color('dress') : color('bottom')) || DEFAULTS.bottom,
      shoes: color('shoes') || DEFAULTS.shoes,
      outer: color('outerwear'),
    },
    style: {
      gender: entry(svg.body)?.gender === 'female' ? 'female' : 'male',
      hair: layer('hair') ? hairStyle(name('hair')) : 'bald',
      beard: !!layer('beard'),
      glasses: !!layer('glasses'),
      sleeves: /boubou/i.test(topName) ? 'long' : NO_SLEEVES.test(topName) ? 'none' : SHORT_SLEEVES.test(topName) ? 'short' : 'long',
      jacket: !!layer('outerwear') && !/gilet|sans manches/i.test(outerName),
      vest: !!layer('outerwear') && /gilet|sans manches/i.test(outerName),
      skirt: dress || SKIRT.test(name('bottom')),
      shorts: !dress && SHORTS.test(name('bottom')),
    },
  };
}

function classicOutfit(look) {
  const hair = look?.hair || 'short';
  return {
    colors: {
      skin: look?.skin || DEFAULTS.skin,
      hair: look?.hair_color || DEFAULTS.hair,
      top: look?.outfit || DEFAULTS.top,
      bottom: look?.pants || DEFAULTS.bottom,
      shoes: DEFAULTS.shoes,
      outer: null,
    },
    style: {
      gender: hair === 'braids' ? 'female' : 'male',
      hair: hair === 'braids' ? 'long' : hair === 'afro' ? 'afro' : 'short',
      beard: false, glasses: false, sleeves: 'short', jacket: false, vest: false, skirt: false, shorts: false,
    },
  };
}

const rect = (r, color) => ({ rect: r, color });

/**
 * Opérations de peinture de la texture (repère 1024), dans l'ordre : peau partout, haut (et manches),
 * veste ou gilet, bas, chaussures, cheveux, puis visage simple si `face` (sans vue SVG de l'atelier).
 */
export function skinPaint({ colors, style }, { face = true } = {}) {
  const L = LAYOUT;
  const ops = [rect([0, 0, 1024, 1024], colors.skin), rect(L.torso, colors.top)];
  if (style.jacket && colors.outer) {
    ops.push(rect(L.torso, colors.outer));
    // Veste ouverte : le haut se voit au milieu du torse, devant.
    ops.push(rect([298, 768, 44, 256], colors.top));
  } else if (style.vest && colors.outer) {
    ops.push(rect([L.torsoFront[0], 490, L.torsoFront[2], 534], colors.outer));
  }
  if (!style.jacket && style.sleeves !== 'long') {
    for (const r of L.foreArms) ops.push(rect(r, colors.skin));
    if (style.sleeves === 'none') for (const r of L.upperArms) ops.push(rect(r, colors.skin));
  }
  ops.push(rect(L.legs, colors.bottom));
  if (style.shorts) ops.push(rect(L.shins, colors.skin));
  ops.push(rect(L.shoes, colors.shoes), rect(L.hands, colors.skin));
  ops.push(...hairPaint(style.hair, colors.hair));
  if (face) ops.push(...facePaint(style, colors));
  return ops;
}

/** Cheveux autour de la tête : sommet, côtés et nuque (le front est dessiné par le visage). */
export function hairPaint(hair, color) {
  if (hair === 'bald') return [];
  const back = { short: 300, afro: 330, long: 470 }[hair] || 300;
  const side = hair === 'afro' ? 200 : 160;
  return [
    rect([0, 0, 640, hair === 'afro' ? 110 : 80], color),
    rect([0, 60, side, back - 60], color),
    rect([640 - side, 60, side, back - 60], color),
  ];
}

/** Visage simple (apparence classique) : sourcils, yeux, nez, bouche ; barbe et lunettes. */
export function facePaint(style, colors) {
  const ops = [
    rect([228, 70, 184, 92], colors.hair), // frange / front
    { ellipse: [284, 214, 16, 20], color: '#ffffff' }, { ellipse: [356, 214, 16, 20], color: '#ffffff' },
    { ellipse: [286, 218, 9, 12], color: '#2b1a12' }, { ellipse: [354, 218, 9, 12], color: '#2b1a12' },
    rect([266, 184, 38, 9], colors.hair), rect([336, 184, 38, 9], colors.hair),
    { ellipse: [320, 268, 22, 8], color: '#5a2a1a' },
  ];
  if (style.beard) ops.push(rect([240, 248, 160, 70], colors.hair), { ellipse: [320, 268, 20, 7], color: '#5a2a1a' });
  if (style.glasses) ops.push({ ring: [284, 214, 26, 6], color: '#1b1b1b' }, { ring: [356, 214, 26, 6], color: '#1b1b1b' }, rect([306, 210, 28, 6], '#1b1b1b'));
  return ops;
}

/**
 * Animation selon la vitesse (normalisée, ~1 = marche ; booléen accepté) : repos, marche (course ralentie,
 * mêlée au repos), course. Retourne les poids et la cadence de la course.
 */
export function gaitFor(speed) {
  const s = +speed;
  if (!(s > 0.05)) return { name: 'idle', run: 0, rate: 1 };
  if (s > 1.25) return { name: 'sprint', run: 1, rate: 1 };
  return { name: 'walk', run: 0.7, rate: 0.62 + 0.15 * Math.min(1, s) };
}

/** Clé de cache d'une tenue (texture partagée par les personnages habillés pareil). */
export const outfitKey = (o, svgKey = '') => `${JSON.stringify(o.colors)}|${JSON.stringify(o.style)}|${svgKey}`;
