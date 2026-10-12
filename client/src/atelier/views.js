// Vues d'un personnage de l'atelier : face (le SVG de l'atelier), dos et profil, composées à partir des mêmes
// composants pour que le personnage se voie de tous les côtés quand il tourne (comme le modèle 3D).
// Module PUR : on transforme les composants (calques retirés, déplacés, écrasés en largeur) puis on réutilise
// le compositeur de l'atelier (compose.js) sans le modifier.
import { composeCharacter, REFERENCE_ANCHORS } from './compose.js';

// Traits du visage : invisibles de dos ; de profil, seule la moitié tournée vers l'avant reste.
const FACE = new Set(['eyes', 'eyebrows', 'nose', 'mouth', 'beard', 'glasses']);
// Calques portés sur la tête : écrasés moins fort que le corps (une tête de profil reste presque aussi large).
const HEAD = new Set(['hair', 'headwear', 'hair_accessory']);
const LOW = new Set(['nose', 'mouth', 'beard']); // bas du visage : au bord avant de la tête de profil
export const SIDE_BODY = 0.55; // largeur du corps de profil (épaisseur) / largeur de face
export const SIDE_HEAD = 0.8;
const HAIR = 'fill:var(--babi-hair,#1b1b1b)';
const SKIN = 'fill:var(--babi-skin,#a86b3c)';

const squash = (svg, k) => (svg ? `<g transform="translate(100 0) scale(${k} 1) translate(-100 0)">${svg}</g>` : svg);
const clipped = (svg, id) => (svg ? `<g clip-path="url(#${id})">${svg}</g>` : svg);
const clipDef = (id, [x, y, w, h]) => `<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`;

/** Tête de la silhouette (d'après ses points d'ancrage) : centre aux yeux, sommet du crâne. */
function headOf(body) {
  const a = body?.props?.anchors && Object.keys(body.props.anchors).length ? body.props.anchors : REFERENCE_ANCHORS;
  const top = (a.head_top || REFERENCE_ANCHORS.head_top)[1];
  const cy = (a.eyes || REFERENCE_ANCHORS.eyes)[1];
  const ry = Math.max(20, cy - top);
  return { cy, ry, rx: ry * 0.84, chin: cy + ry };
}

/** Copie des composants avec, pour chaque clé, `edit(part, key)` → composant modifié (null = retiré). */
function editParts(props, parts, edit) {
  const out = { ...parts };
  const used = [props.body, ...Object.values(props.layers || {}).map((l) => l?.part)];
  for (const key of used) if (key && parts[key]) out[key] = edit(parts[key], key);
  return out;
}

/** Vue de dos (avant miroir) : pas de visage, calques arrière (cheveux longs, sac à dos) passés devant, nuque. */
function backView(props, parts) {
  const head = headOf(parts[props.body]);
  const layers = {};
  for (const [slot, layer] of Object.entries(props.layers || {})) if (layer && !FACE.has(slot)) layers[slot] = layer;
  const edited = editParts({ ...props, layers }, parts, (part) => {
    const p = { ...part };
    if (part.back) { p.front = `${part.back}${part.front || ''}`; p.back = ''; p.z = 70 + (part.back_z ?? 0); }
    if (part.slot === 'hair') {
      // l'arrière du crâne est couvert de cheveux (les coiffures ne dessinent que la frange)
      const nape = `<ellipse cx="100" cy="${head.cy - 2}" rx="${head.rx * 1.02}" ry="${head.ry * 0.92}" style="${HAIR}"/>`;
      p.front = `${nape}${p.front || ''}`;
    }
    return p;
  });
  return composeCharacter({ ...props, layers }, edited, { idPrefix: 'b' }).svg;
}

/** Vue de profil, tournée vers la droite (+x) : corps aminci, tête de profil (nez, un œil), nuque coiffée. */
function sideView(props, parts) {
  const body = parts[props.body];
  const head = headOf(body);
  const neck = head.chin - 8;
  const hx = head.rx * SIDE_HEAD; // demi-largeur de la tête de profil
  const edited = editParts(props, parts, (part, key) => {
    const p = { ...part };
    const slot = key === props.body ? 'body' : part.slot;
    if (slot === 'body') {
      // corps sous le menton, aminci ; la tête est redessinée de profil (oreille au milieu, nez en saillie)
      p.defs = `${part.defs || ''}${clipDef('neck', [0, neck, 200, 400])}`;
      const ex = 100 + hx * 0.05;
      const ear = `<ellipse cx="${ex}" cy="${head.cy + 5}" rx="${head.rx * 0.18}" ry="${head.ry * 0.24}" style="${SKIN}"/>`
        + `<ellipse cx="${ex}" cy="${head.cy + 5}" rx="${head.rx * 0.08}" ry="${head.ry * 0.13}" style="fill:rgba(0,0,0,0.15)"/>`;
      const nose = `<ellipse cx="${100 + hx * 0.98}" cy="${head.cy + head.ry * 0.2}" rx="${head.rx * 0.16}" ry="${head.ry * 0.14}" style="${SKIN}"/>`;
      const skull = `<ellipse cx="100" cy="${head.cy}" rx="${hx}" ry="${head.ry}" style="${SKIN}"/>`;
      p.front = `${clipped(squash(part.front, SIDE_BODY), 'neck')}${nose}${skull}${ear}`;
      p.back = squash(part.back, SIDE_BODY);
      return p;
    }
    if (FACE.has(slot)) {
      // moitié avant du visage seulement, poussée vers l'avant (yeux un peu en retrait, bouche et nez au bord),
      // sans dépasser du crâne
      const shift = hx - head.rx * (LOW.has(slot) ? 0.45 : 0.75);
      p.defs = `${part.defs || ''}${clipDef('half', [102, 0, 100, 400])}`
        + `<clipPath id="skull"><ellipse cx="100" cy="${head.cy}" rx="${hx + 1}" ry="${head.ry + 1}"/></clipPath>`;
      p.front = clipped(`<g transform="translate(${shift} 0)">${clipped(part.front, 'half')}</g>`, 'skull');
      p.back = '';
      return p;
    }
    if (slot === 'jewelry') {
      // boucle d'oreille : celle de droite, ramenée sur l'oreille au milieu de la tête
      p.defs = `${part.defs || ''}${clipDef('half', [100, 0, 100, 400])}`;
      p.front = `<g transform="translate(${-head.rx + hx * 0.05} 0)">${clipped(part.front, 'half')}</g>`;
      return p;
    }
    if (HEAD.has(slot)) {
      const back = slot === 'hair'
        ? clipped(`<ellipse cx="100" cy="${head.cy}" rx="${hx + 1.5}" ry="${head.ry + 1.5}" style="${HAIR}"/>`, 'nape')
        : '';
      // la masse de cheveux part vers l'arrière de la tête ; la frange ne descend pas sur le visage
      // (gardée au-dessus des sourcils, ou en arrière de la tempe)
      const front = `<g transform="translate(${-hx * 0.12} 0)">${squash(part.front, SIDE_HEAD)}</g>`;
      p.defs = `${part.defs || ''}<clipPath id="crown"><rect x="0" y="0" width="200" height="${head.cy - head.ry * 0.38}"/>`
        + `<rect x="0" y="0" width="${100 + hx * 0.3}" height="400"/></clipPath>`
        // limite des cheveux arrondie : du sommet vers l'avant, puis derrière l'oreille jusqu'à la nuque
        + `<clipPath id="nape"><path d="M0 0 L${100 + hx * 0.35} 0 Q${100 - hx * 0.05} ${head.cy - head.ry * 0.2} `
        + `${100 - hx * 0.3} ${head.chin - 8} L0 ${head.chin - 8} Z"/></clipPath>`;
      p.front = `${slot === 'hair' ? clipped(front, 'crown') : front}${back}`;
      p.back = part.back ? `<g transform="translate(${-hx * 0.4} 0)">${squash(part.back, SIDE_HEAD)}</g>` : '';
      return p;
    }
    p.front = squash(part.front, SIDE_BODY);
    // ce qui est porté dans le dos (sac à dos) dépasse derrière le corps
    p.back = part.back ? `<g transform="translate(-18 0)">${squash(part.back, SIDE_BODY)}</g>` : '';
    return p;
  });
  return composeCharacter(props, edited, { idPrefix: 's' }).svg;
}

/** { front, back, side } : SVG des trois vues (dos à afficher en miroir, profil tourné vers la droite). */
export function characterViews(props, parts) {
  return {
    front: composeCharacter(props, parts, { idPrefix: 'g' }).svg,
    back: backView(props, parts),
    side: sideView(props, parts),
  };
}

/**
 * Vue à afficher : d = cap du personnage − direction de la caméra (radians, 0 = il regarde la caméra).
 * Retourne { view: 'front' | 'back' | 'side', mirror } (profil en miroir = tourné vers la gauche de l'écran) ;
 * `current` garde la vue en cours un peu au-delà de 45° pour éviter les clignotements.
 */
export function pickView(d, current = null) {
  const a = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
  const q = Math.PI / 4;
  const inside = (v, m) => (v === 'front' ? a < q + m : v === 'back' ? a > 3 * q - m : a > q - m && a < 3 * q + m);
  const view = current && inside(current, 0.1) ? current : ['front', 'back', 'side'].find((v) => inside(v, 0));
  return { view, mirror: view === 'side' && Math.sin(d) < 0 };
}
