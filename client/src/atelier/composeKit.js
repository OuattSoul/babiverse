// Compositeur des kits modulaires de l'atelier (base qui déclare des points d'ancrage + composants accrochés).
// Module PUR, repris de l'atelier (babiverse-studio/frontend/src/modular/compose.ts, `composeKit`) : garder identiques.
import { prefixIds } from './compose.js';

const HEX = /^#[0-9a-fA-F]{6}$/;
const CHANNELS = ['primary', 'secondary', 'accent'];
const color = (v, fallback) => (v && HEX.test(v) ? v : fallback);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const vars = (colors) => Object.entries(colors).map(([k, v]) => `--babi-${k}:${v}`).join(';');

function partColors(part, colors) {
  const out = {};
  for (const ch of CHANNELS) out[ch] = color(colors?.[ch], color(part.props?.default_colors?.[ch], part.channels?.[ch] ?? '#888888'));
  return out;
}

/** Positions où une pièce est dessinée : une par position du point d'ancrage de la base. */
function placements(part, base, kit) {
  const a = part.props?.anchor;
  if (!a) return [[0, 0]];
  const ref = kit.anchors[a];
  const pts = base?.props?.anchors?.[a] ?? [];
  return ref ? pts.map((p) => [p[0] - ref[0], p[1] - ref[1]]) : [];
}

function patternDefs(pat, parts, id, missing) {
  const p = parts[pat.part];
  if (!p) { missing.push(pat.part); return null; }
  const vb = p.view_box ?? [0, 0, 20, 20];
  const s = num(pat.scale, 1);
  const pp = `${id}-`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${vb[2] * s}" height="${vb[3] * s}">`
    + `<g transform="scale(${s}) translate(${-vb[0]} ${-vb[1]})" style="${vars(partColors(p, pat.colors))}">${prefixIds(p.defs || '', pp)}${prefixIds(p.front || '', pp)}</g></pattern>`;
}

/** m : properties.modular (clés de composants du pack) ; kit : spécification du kit. Retourne { svg, missing }. */
export function composeKit(m, parts, kit, opts = {}) {
  const pre = opts.idPrefix ?? 'k';
  const missing = [];
  const base = parts[m.base];
  const defs = [];
  const items = [];
  let order = 0;
  const place = (slot, part, layer) => {
    const props = part.props || {};
    const lp = `${pre}-${slot}-`;
    const colors = partColors(part, layer.colors);
    if (layer.pattern) {
      const pid = `${lp}pattern`;
      const d = patternDefs(layer.pattern, parts, pid, missing);
      if (d) { defs.push(d); colors[layer.pattern.channel ?? 'primary'] = `url(#${pid})`; }
    }
    if (part.defs) defs.push(prefixIds(part.defs, lp));
    const pos = slot === 'base' ? [[0, 0]] : placements(part, base, kit);
    const s = num(props.scale, 1);
    const style = vars(colors);
    for (const [ax, ay] of pos) {
      const tr = `translate(${num(props.offset?.[0], 0) + ax} ${num(props.offset?.[1], 0) + ay})${s !== 1 ? ` scale(${s})` : ''}`;
      if (part.back) items.push({ z: part.back_z ?? 0, order: order++, svg: `<g transform="${tr}" style="${style}">${prefixIds(part.back, lp)}</g>` });
      if (part.front) items.push({ z: part.z ?? 50, order: order++, svg: `<g transform="${tr}" style="${style}">${prefixIds(part.front, lp)}</g>` });
    }
  };
  if (base) place('base', base, { colors: m.base_colors, pattern: m.base_pattern }); else missing.push(m.base);
  for (const [slot, layer] of Object.entries(m.layers || {})) {
    if (!layer) continue;
    const part = parts[layer.part];
    if (!part) { missing.push(layer.part); continue; }
    place(slot, part, layer);
  }
  items.sort((a, b) => a.z - b.z || a.order - b.order);
  const globals = {};
  for (const [g, spec] of Object.entries(kit.globals || {})) globals[g] = color(m.colors?.[g], spec.default);
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${kit.frame.join(' ')}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}`
      + `<g style="${vars(globals)}">${items.map((i) => i.svg).join('')}</g></svg>`,
    missing,
  };
}
