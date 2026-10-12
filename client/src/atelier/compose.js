// Compositeur de personnages de l'atelier : définition déclarative + composants SVG → un SVG autonome.
// Module PUR, repris de l'atelier (babiverse-studio/frontend/src/character/compose.ts) : garder les deux identiques.
// Repère 0 0 200 380 ; couleurs par variables CSS --babi-<canal> (skin, hair, eyes / primary, secondary, accent).

export const FRAME = [0, 0, 200, 380];
export const REFERENCE_ANCHORS = {
  head_top: [100, 22], eyes: [100, 62], mouth: [100, 84], neck: [100, 108], shoulders: [100, 124], waist: [100, 224],
  feet: [100, 362], wrist_left: [50, 246], wrist_right: [150, 246], ears: [100, 66],
};
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Préfixe les identifiants internes d'un fragment pour éviter les collisions entre calques. */
export function prefixIds(fragment, prefix) {
  return fragment
    .replace(/\bid="([^"]+)"/g, (_m, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)\s]+)\)/g, (_m, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_m, id) => `href="#${prefix}${id}"`);
}

const color = (v, fallback) => (v && HEX.test(v) ? v : fallback);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * props : { body, skin, hair_color, eye_color, height_scale, layers: { slot: { part, colors, pattern } } }
 * parts : { clé: { slot, z, back_z, props, view_box, channels, defs, back, front } }
 * Retourne { svg, missing } (composants introuvables, ignorés).
 */
export function composeCharacter(props, parts, opts = {}) {
  const pre = opts.idPrefix ?? 'c';
  const missing = [];
  const body = parts[props.body];
  const anchors = body?.props?.anchors && Object.keys(body.props.anchors).length ? body.props.anchors : REFERENCE_ANCHORS;
  const defs = [];
  const items = [];
  let order = 0;
  const vars = (colors) => Object.entries(colors).map(([k, v]) => `--babi-${k}:${v}`).join(';');

  const place = (slot, part, layer) => {
    const p = part.props || {};
    let dx = num(p.offset?.[0], 0);
    let dy = num(p.offset?.[1], 0);
    const a = p.anchor;
    if (a && anchors[a] && REFERENCE_ANCHORS[a]) { dx += anchors[a][0] - REFERENCE_ANCHORS[a][0]; dy += anchors[a][1] - REFERENCE_ANCHORS[a][1]; }
    const s = num(p.scale, 1);
    const transform = `translate(${dx} ${dy})${s !== 1 ? ` scale(${s})` : ''}`;
    const colors = {};
    for (const ch of ['primary', 'secondary', 'accent']) colors[ch] = color(layer?.colors?.[ch], color(p.default_colors?.[ch], part.channels?.[ch] ?? '#888888'));
    const lp = `${pre}-${slot}-`;
    if (layer?.pattern) {
      const pat = parts[layer.pattern.part];
      if (!pat) missing.push(layer.pattern.part);
      else {
        const vb = pat.view_box ?? [0, 0, 20, 20];
        const ps = num(layer.pattern.scale, 1);
        const pcol = {};
        for (const ch of ['primary', 'secondary', 'accent']) pcol[ch] = color(layer.pattern.colors?.[ch], color(pat.props?.default_colors?.[ch], pat.channels?.[ch] ?? '#888888'));
        const pid = `${lp}pattern`;
        const pp = `${lp}p-`;
        defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${vb[2] * ps}" height="${vb[3] * ps}">`
          + `<g transform="scale(${ps}) translate(${-vb[0]} ${-vb[1]})" style="${vars(pcol)}">${prefixIds(pat.defs || '', pp)}${prefixIds(pat.front || '', pp)}</g></pattern>`);
        colors[layer.pattern.channel ?? 'primary'] = `url(#${pid})`;
      }
    }
    if (part.defs) defs.push(prefixIds(part.defs, lp));
    const style = vars(colors);
    if (part.back) items.push({ z: part.back_z ?? 0, order: order++, svg: `<g data-slot="${slot}-back" transform="${transform}" style="${style}">${prefixIds(part.back, lp)}</g>` });
    if (part.front) items.push({ z: part.z ?? 50, order: order++, svg: `<g data-slot="${slot}" transform="${transform}" style="${style}">${prefixIds(part.front, lp)}</g>` });
  };

  if (body) place('body', body, null); else missing.push(props.body);
  for (const [slot, layer] of Object.entries(props.layers || {})) {
    if (!layer) continue;
    const part = parts[layer.part];
    if (!part) { missing.push(layer.part); continue; }
    place(slot, part, layer);
  }
  items.sort((a, b) => a.z - b.z || a.order - b.order);
  const hs = num(props.height_scale, 1);
  const globals = `--babi-skin:${color(props.skin, '#a86b3c')};--babi-hair:${color(props.hair_color, '#1b1b1b')};--babi-eyes:${color(props.eye_color, '#3b2414')}`;
  const vb = opts.crop === 'portrait' ? '40 0 120 150' : FRAME.join(' ');
  const size = opts.width ? ` width="${opts.width}" height="${opts.height ?? Math.round(opts.width * (opts.crop === 'portrait' ? 1.25 : 1.9))}"` : '';
  const inner = `<g style="${globals}" transform="translate(100 365) scale(${hs}) translate(-100 -365)">${items.map((i) => i.svg).join('')}</g>`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${defs.length ? `<defs>${defs.join('')}</defs>` : ''}${inner}</svg>`,
    missing,
  };
}

export const svgDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
