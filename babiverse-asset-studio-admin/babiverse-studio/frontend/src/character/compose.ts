// Compositeur de personnages modulaires : définition déclarative + composants SVG → un SVG autonome.
// Module PUR (aucun accès au DOM) : le même code peut être repris par le moteur du jeu.
// Convention : repère 0 0 200 380 ; couleurs par variables CSS --babi-<canal> (skin, hair, eyes / primary, secondary, accent).
import type { PartPayload, Variant } from "../types";

export const FRAME = [0, 0, 200, 380];
export const REFERENCE_ANCHORS: Record<string, [number, number]> = {
  head_top: [100, 22], eyes: [100, 62], mouth: [100, 84], neck: [100, 108], shoulders: [100, 124], waist: [100, 224],
  feet: [100, 362], wrist_left: [50, 246], wrist_right: [150, 246], ears: [100, 66],
};
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface PatternRef { part: string; colors?: Record<string, string>; channel?: "primary" | "secondary" | "accent"; scale?: number }
export interface Layer { part: string; colors?: Record<string, string>; pattern?: PatternRef | null }
export interface CharacterProps {
  body: string; skin: string; hair_color: string; eye_color: string; height_scale?: number;
  layers: Record<string, Layer | null>; role?: string; view?: "front";
}

/** Calques et couleurs globales effectifs, variante (préréglage de tenue) appliquée. */
export function effective(props: CharacterProps, variant?: Variant | null): CharacterProps {
  const layers: Record<string, Layer> = {};
  for (const [k, v] of Object.entries(props.layers || {})) if (v) layers[k] = v;
  const out: CharacterProps = { ...props, layers };
  if (variant?.props) {
    for (const [slot, layer] of Object.entries((variant.props.layers ?? {}) as Record<string, Layer | null>)) {
      if (layer === null) delete layers[slot]; else layers[slot] = layer;
    }
    for (const k of ["skin", "hair_color", "eye_color"] as const) if (typeof variant.props[k] === "string") out[k] = variant.props[k];
  }
  return out;
}

/** Préfixe les identifiants internes d'un fragment pour éviter les collisions entre calques. */
export function prefixIds(fragment: string, prefix: string): string {
  return fragment
    .replace(/\bid="([^"]+)"/g, (_m, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)\s]+)\)/g, (_m, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_m, id) => `href="#${prefix}${id}"`);
}

const color = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export interface ComposeOptions { variant?: Variant | null; idPrefix?: string; background?: string | null; width?: number; height?: number; crop?: "full" | "portrait" }
export interface ComposeResult { svg: string; missing: string[] }

export function composeCharacter(props: CharacterProps, parts: Record<string, PartPayload>, opts: ComposeOptions = {}): ComposeResult {
  const p = effective(props, opts.variant);
  const pre = opts.idPrefix ?? "c";
  const missing: string[] = [];
  const body = parts[p.body];
  const anchors: Record<string, [number, number]> = body?.props?.anchors && Object.keys(body.props.anchors).length ? body.props.anchors : REFERENCE_ANCHORS;
  const defs: string[] = [];
  const items: { z: number; order: number; svg: string }[] = [];
  let order = 0;

  const vars = (colors: Record<string, string>) =>
    Object.entries(colors).map(([k, v]) => `--babi-${k}:${v}`).join(";");

  const place = (slot: string, part: PartPayload, layer: Layer | null) => {
    const props = part.props || {};
    let dx = num(props.offset?.[0], 0), dy = num(props.offset?.[1], 0);
    const a = props.anchor as string | undefined;
    if (a && anchors[a] && REFERENCE_ANCHORS[a]) { dx += anchors[a][0] - REFERENCE_ANCHORS[a][0]; dy += anchors[a][1] - REFERENCE_ANCHORS[a][1]; }
    const s = num(props.scale, 1);
    const transform = `translate(${dx} ${dy})${s !== 1 ? ` scale(${s})` : ""}`;
    const colors: Record<string, string> = {};
    for (const ch of ["primary", "secondary", "accent"]) {
      const v = color(layer?.colors?.[ch], color(props.default_colors?.[ch], part.channels?.[ch] ?? "#888888"));
      colors[ch] = v;
    }
    const lp = `${pre}-${slot}-`;
    if (layer?.pattern) {
      const pat = parts[layer.pattern.part];
      if (!pat) missing.push(layer.pattern.part);
      else {
        const vb = pat.view_box ?? [0, 0, 20, 20];
        const ps = num(layer.pattern.scale, 1);
        const pcol: Record<string, string> = {};
        for (const ch of ["primary", "secondary", "accent"]) pcol[ch] = color(layer.pattern.colors?.[ch], color(pat.props?.default_colors?.[ch], pat.channels?.[ch] ?? "#888888"));
        const pid = `${lp}pattern`;
        const pp = `${lp}p-`;
        defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${vb[2] * ps}" height="${vb[3] * ps}">`
          + `<g transform="scale(${ps}) translate(${-vb[0]} ${-vb[1]})" style="${vars(pcol)}">${prefixIds(pat.defs, pp)}${prefixIds(pat.front, pp)}</g></pattern>`);
        colors[layer.pattern.channel ?? "primary"] = `url(#${pid})`;
      }
    }
    if (part.defs) defs.push(prefixIds(part.defs, lp));
    const style = vars(colors);
    if (part.back) items.push({ z: part.back_z ?? 0, order: order++, svg: `<g data-slot="${slot}-back" transform="${transform}" style="${style}">${prefixIds(part.back, lp)}</g>` });
    if (part.front) items.push({ z: part.z ?? 50, order: order++, svg: `<g data-slot="${slot}" transform="${transform}" style="${style}">${prefixIds(part.front, lp)}</g>` });
  };

  if (body) place("body", body, null); else missing.push(p.body);
  for (const [slot, layer] of Object.entries(p.layers)) {
    if (!layer) continue;
    const part = parts[layer.part];
    if (!part) { missing.push(layer.part); continue; }
    place(slot, part, layer);
  }
  items.sort((a, b) => a.z - b.z || a.order - b.order);
  const hs = num(p.height_scale, 1);
  const globals = `--babi-skin:${color(p.skin, "#a86b3c")};--babi-hair:${color(p.hair_color, "#1b1b1b")};--babi-eyes:${color(p.eye_color, "#3b2414")}`;
  const vb = opts.crop === "portrait" ? "40 0 120 150" : FRAME.join(" ");
  const size = opts.width ? ` width="${opts.width}" height="${opts.height ?? Math.round(opts.width * (opts.crop === "portrait" ? 1.25 : 1.9))}"` : "";
  const bg = opts.background ? `<rect x="-50" y="-50" width="300" height="480" fill="${color(opts.background, "#ffffff")}"/>` : "";
  const body_ = `<g style="${globals}" transform="translate(100 365) scale(${hs}) translate(-100 -365)">${items.map((i) => i.svg).join("")}</g>`;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${bg}${body_}</svg>`,
    missing,
  };
}

/** Aperçu isolé d'un composant (couleurs par défaut), éventuellement posé sur un corps fantôme. */
export function composePart(part: PartPayload, opts: { ghostBody?: PartPayload | null; colors?: Record<string, string>; size?: number } = {}): string {
  const colors: Record<string, string> = {};
  for (const ch of ["primary", "secondary", "accent"]) colors[ch] = color(opts.colors?.[ch], color(part.props?.default_colors?.[ch], part.channels?.[ch] ?? "#888888"));
  const style = Object.entries(colors).map(([k, v]) => `--babi-${k}:${v}`).join(";") + ";--babi-skin:#a86b3c;--babi-hair:#1b1b1b;--babi-eyes:#3b2414";
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  if (part.slot === "pattern") {
    const vb = part.view_box ?? [0, 0, 20, 20];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb[2] * 3} ${vb[3] * 3}"${size}><defs><pattern id="pp" patternUnits="userSpaceOnUse" width="${vb[2]}" height="${vb[3]}">`
      + `<g style="${style}">${prefixIds(part.defs, "pp-")}${prefixIds(part.front, "pp-")}</g></pattern></defs><rect width="${vb[2] * 3}" height="${vb[3] * 3}" fill="url(#pp)"/></svg>`;
  }
  const ghost = opts.ghostBody ? `<g style="--babi-skin:#cfd8d6;opacity:0.55">${prefixIds(opts.ghostBody.back + opts.ghostBody.front, "gb-")}</g>` : "";
  const head = ["eyes", "eyebrows", "nose", "mouth", "beard", "hair", "hair_accessory", "glasses", "headwear", "jewelry"].includes(part.slot);
  const vb = head ? "40 -6 120 140" : part.slot === "shoes" ? "40 300 120 80" : "0 0 200 380";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${size}>${part.defs ? `<defs>${prefixIds(part.defs, "p-")}</defs>` : ""}`
    + `<g style="${style}">${prefixIds(part.back, "p-")}${ghost}${prefixIds(part.front, "p-")}</g></svg>`;
}

// ------------------------------------------------------------------ règles de compatibilité (miroir du serveur)

export interface OutfitIssue { slot: string; message: string }
const GENDER_LABEL: Record<string, string> = { male: "masculines", female: "féminines" };

/** Un composant réservé à un genre (rouge à lèvres, talons, barbe…) convient-il à cette silhouette ? */
export function fitsGender(part: PartPayload, body: PartPayload | undefined): boolean {
  const allowed: string[] = part.props?.genders ?? [];
  const g: string | undefined = body?.props?.gender;
  return !allowed.length || !g || allowed.includes(g);
}
export const genderReason = (part: PartPayload) =>
  `« ${part.name} » est réservé aux silhouettes ${(part.props?.genders ?? []).map((g: string) => GENDER_LABEL[g] ?? g).join(" et ")}.`;

export function checkOutfit(props: CharacterProps, parts: Record<string, PartPayload>, slotLabels: Record<string, string> = {}): OutfitIssue[] {
  const issues: OutfitIssue[] = [];
  const body = parts[props.body];
  if (!body || body.slot !== "body") return [{ slot: "body", message: "Corps introuvable." }];
  const used: Record<string, PartPayload> = {};
  for (const [slot, layer] of Object.entries(props.layers)) {
    if (!layer) continue;
    const part = parts[layer.part];
    if (!part) { issues.push({ slot, message: "Composant introuvable." }); continue; }
    if (part.slot !== slot) { issues.push({ slot, message: `« ${part.name} » n'est pas un composant de cet emplacement.` }); continue; }
    const bodies: string[] = part.props?.bodies ?? [];
    if (bodies.length && !bodies.includes(props.body)) issues.push({ slot, message: `« ${part.name} » n'est pas compatible avec « ${body.name} ».` });
    if (!fitsGender(part, body)) issues.push({ slot, message: genderReason(part) });
    for (const [ch, col] of Object.entries(layer.colors ?? {})) {
      const pal: string[] = part.props?.palette?.[ch] ?? [];
      if (pal.length && !pal.map((c) => c.toLowerCase()).includes(col.toLowerCase())) issues.push({ slot, message: `Couleur ${col} hors de la palette autorisée de « ${part.name} ».` });
    }
    used[slot] = part;
  }
  const label = (s: string) => slotLabels[s] ?? s;
  for (const [slot, part] of Object.entries(used)) {
    for (const other of part.props?.incompatible_slots ?? []) if (used[other]) issues.push({ slot, message: `« ${part.name} » ne se porte pas avec un composant « ${label(other)} ».` });
    for (const pid of part.props?.incompatible_parts ?? []) {
      const q = Object.values(used).find((x) => x.id === pid);
      if (q) issues.push({ slot, message: `« ${part.name} » est incompatible avec « ${q.name} ».` });
    }
    for (const need of part.props?.requires_slots ?? []) if (!used[need]) issues.push({ slot, message: `« ${part.name} » nécessite un composant « ${label(need)} ».` });
  }
  const has = (...s: string[]) => s.some((x) => used[x]);
  if (!has("top", "dress", "outerwear") || !has("bottom", "dress")) issues.push({ slot: "top", message: "Tenue incomplète : il faut un haut et un bas, ou une robe / un boubou." });
  return issues;
}

// ------------------------------------------------------------------ génération d'habitants

export type Rng = () => number;
export function seeded(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

export const SKIN_TONES = ["#f1c27d", "#e0ac69", "#c68642", "#a86b3c", "#8d5524", "#6f4422", "#5c3a1e", "#3f2716"];
export const HAIR_COLORS = ["#111111", "#1b1b1b", "#2b1a12", "#3b2414", "#5a3825", "#7a4a2a", "#b0b0b0"];
export const CLOTH_COLORS = ["#e67e22", "#27ae60", "#2980b9", "#c0392b", "#8e44ad", "#f1c40f", "#16a085", "#2c3e50", "#ecf0f1", "#d35400", "#1e3d6b", "#7f8c8d"];

/** Tire au sort une tenue complète et compatible (aucune combinaison invalide n'est produite). */
export function randomCharacter(lib: PartPayload[], rng: Rng, tries = 40): CharacterProps | null {
  const live = lib.filter((p) => !p.archived);
  const bySlot = (slot: string) => live.filter((p) => p.slot === slot);
  const bodies = bySlot("body");
  if (!bodies.length) return null;
  const parts = Object.fromEntries(live.map((p) => [p.id, p]));
  const colorFor = (part: PartPayload, ch: string) => {
    const pal: string[] = part.props?.palette?.[ch] ?? [];
    return pal.length ? pick(rng, pal) : pick(rng, CLOTH_COLORS);
  };
  const layerOf = (part: PartPayload): Layer => {
    const colors: Record<string, string> = {};
    for (const ch of Object.keys(part.channels ?? {})) if (["primary", "secondary", "accent"].includes(ch)) colors[ch] = colorFor(part, ch);
    const layer: Layer = { part: part.id, colors };
    const patterns = bySlot("pattern");
    if (patterns.length && ["top", "dress", "bottom"].includes(part.slot) && rng() < 0.3 && part.channels?.primary) {
      const pat = pick(rng, patterns);
      const pc: Record<string, string> = {};
      for (const ch of Object.keys(pat.channels ?? {})) pc[ch] = pick(rng, CLOTH_COLORS);
      layer.pattern = { part: pat.id, colors: pc, channel: "primary", scale: 1 };
    }
    return layer;
  };
  for (let t = 0; t < tries; t++) {
    const body = pick(rng, bodies);
    const fits = (p: PartPayload) => (!(p.props?.bodies?.length) || p.props.bodies.includes(body.id)) && fitsGender(p, body);
    const choose = (slot: string, prob: number) => {
      const opts = bySlot(slot).filter(fits);
      return opts.length && rng() < prob ? layerOf(pick(rng, opts)) : null;
    };
    const layers: Record<string, Layer | null> = {
      eyes: choose("eyes", 1), eyebrows: choose("eyebrows", 1), nose: choose("nose", 1), mouth: choose("mouth", 1),
      hair: choose("hair", 0.9), beard: choose("beard", 0.25), makeup: choose("makeup", 0.45), shoes: choose("shoes", 1),
      glasses: choose("glasses", 0.15), headwear: choose("headwear", 0.15), bag: choose("bag", 0.2), watch: choose("watch", 0.2),
      jewelry: choose("jewelry", 0.2),
    };
    if (rng() < (body.props?.gender === "female" ? 0.4 : 0.12) && bySlot("dress").some(fits)) layers.dress = choose("dress", 1);
    else { layers.top = choose("top", 1); layers.bottom = choose("bottom", 1); if (rng() < 0.15) layers.outerwear = choose("outerwear", 1); }
    const props: CharacterProps = {
      body: body.id, skin: pick(rng, SKIN_TONES), hair_color: pick(rng, HAIR_COLORS), eye_color: pick(rng, ["#2a1a10", "#3b2414", "#4a3020"]),
      height_scale: Math.round((0.94 + rng() * 0.12) * 100) / 100,
      layers: Object.fromEntries(Object.entries(layers).filter(([, v]) => v)) as Record<string, Layer>,
    };
    if (!checkOutfit(props, parts).length) return props;
  }
  return null;
}
