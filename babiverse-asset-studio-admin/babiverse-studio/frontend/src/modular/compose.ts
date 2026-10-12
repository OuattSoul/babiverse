// Compositeur générique des kits modulaires (bâtiments, véhicules, végétation, mobilier urbain, meubles, surfaces).
// Même principe que les personnages : une BASE qui déclare des points d'ancrage + des composants indépendants qui
// s'y accrochent. Aucune combinaison n'est dessinée. Module PUR (aucun accès au DOM), réutilisable par le jeu.
// Convention : repère du kit (taxonomy.KITS[kit].frame) ; couleurs par variables CSS --babi-<canal>.
import type { PartPayload, Variant } from "../types";
import { prefixIds, type Rng } from "../character/compose";

export interface KitSlot { label: string; z: number; back_z?: number; required?: boolean; anchor?: string }
export interface KitSpec {
  label: string; family: string; frame: number[]; ground: number; view: "front" | "top"; description: string;
  globals: Record<string, { label: string; default: string }>; slots: Record<string, KitSlot>;
  anchors: Record<string, [number, number]>; required_anchors: string[]; pattern_slots: string[]; random: Record<string, number>;
}
export interface ModPattern { part: string; colors?: Record<string, string>; channel?: "primary" | "secondary" | "accent"; scale?: number }
export interface ModLayer { part: string; colors?: Record<string, string>; pattern?: ModPattern | null }
export interface ModularProps {
  kit: string; base: string; base_colors?: Record<string, string>; base_pattern?: ModPattern | null;
  colors?: Record<string, string>; layers: Record<string, ModLayer | null>;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
export const LAYER_CHANNELS = ["primary", "secondary", "accent"] as const;
const color = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v : fallback);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** Calques et couleurs effectifs, variante (préréglage) appliquée : la variante ne stocke que les différences. */
export function effectiveModular(m: ModularProps, variant?: Variant | null): ModularProps {
  const layers: Record<string, ModLayer> = {};
  for (const [k, v] of Object.entries(m.layers || {})) if (v) layers[k] = v;
  const out: ModularProps = { ...m, layers, colors: { ...(m.colors ?? {}) }, base_colors: { ...(m.base_colors ?? {}) } };
  const vp = variant?.props;
  if (vp) {
    for (const [slot, layer] of Object.entries((vp.layers ?? {}) as Record<string, ModLayer | null>)) {
      if (layer === null) delete layers[slot]; else layers[slot] = layer;
    }
    Object.assign(out.colors!, vp.colors ?? {});
    Object.assign(out.base_colors!, vp.base_colors ?? {});
  }
  return out;
}

export function partColors(part: PartPayload, colors?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ch of LAYER_CHANNELS) out[ch] = color(colors?.[ch], color(part.props?.default_colors?.[ch], part.channels?.[ch] ?? "#888888"));
  return out;
}

const vars = (colors: Record<string, string>) => Object.entries(colors).map(([k, v]) => `--babi-${k}:${v}`).join(";");

/** Positions où une pièce est dessinée : une par position du point d'ancrage de la base (aucune si la base ne l'a pas). */
export function placements(part: PartPayload, base: PartPayload | undefined, kit: KitSpec): [number, number][] {
  const a = part.props?.anchor as string | undefined;
  if (!a) return [[0, 0]];
  const ref = kit.anchors[a];
  const pts: number[][] = base?.props?.anchors?.[a] ?? [];
  return ref ? pts.map((p) => [p[0] - ref[0], p[1] - ref[1]] as [number, number]) : [];
}

function patternDefs(pat: ModPattern, parts: Record<string, PartPayload>, id: string, missing: string[]): string | null {
  const p = parts[pat.part];
  if (!p) { missing.push(pat.part); return null; }
  const vb = p.view_box ?? [0, 0, 20, 20];
  const s = num(pat.scale, 1);
  const pp = `${id}-`;
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${vb[2] * s}" height="${vb[3] * s}">`
    + `<g transform="scale(${s}) translate(${-vb[0]} ${-vb[1]})" style="${vars(partColors(p, pat.colors))}">${prefixIds(p.defs, pp)}${prefixIds(p.front, pp)}</g></pattern>`;
}

export interface KitComposeOptions {
  variant?: Variant | null; idPrefix?: string; background?: string | null; width?: number; height?: number;
  /** étire l'image sur la boîte (surfaces posées sur une emprise rectangulaire) */
  stretch?: boolean;
}
export interface KitComposeResult { svg: string; missing: string[]; hidden: string[] }

export function composeKit(m: ModularProps, parts: Record<string, PartPayload>, kit: KitSpec, opts: KitComposeOptions = {}): KitComposeResult {
  const p = effectiveModular(m, opts.variant);
  const pre = opts.idPrefix ?? "k";
  const missing: string[] = [], hidden: string[] = [];
  const base = parts[p.base];
  const defs: string[] = [];
  const items: { z: number; order: number; svg: string }[] = [];
  let order = 0;

  const place = (slot: string, part: PartPayload, layer: { colors?: Record<string, string>; pattern?: ModPattern | null }) => {
    const props = part.props || {};
    const lp = `${pre}-${slot}-`;
    const colors = partColors(part, layer.colors);
    if (layer.pattern) {
      const pid = `${lp}pattern`;
      const d = patternDefs(layer.pattern, parts, pid, missing);
      if (d) { defs.push(d); colors[layer.pattern.channel ?? "primary"] = `url(#${pid})`; }
    }
    if (part.defs) defs.push(prefixIds(part.defs, lp));
    const pos = slot === "base" ? [[0, 0] as [number, number]] : placements(part, base, kit);
    if (!pos.length) { hidden.push(slot); return; }
    const s = num(props.scale, 1);
    const style = vars(colors);
    for (const [ax, ay] of pos) {
      const tr = `translate(${num(props.offset?.[0], 0) + ax} ${num(props.offset?.[1], 0) + ay})${s !== 1 ? ` scale(${s})` : ""}`;
      if (part.back) items.push({ z: part.back_z ?? 0, order: order++, svg: `<g data-slot="${slot}-back" transform="${tr}" style="${style}">${prefixIds(part.back, lp)}</g>` });
      if (part.front) items.push({ z: part.z ?? 50, order: order++, svg: `<g data-slot="${slot}" transform="${tr}" style="${style}">${prefixIds(part.front, lp)}</g>` });
    }
  };

  if (base) place("base", base, { colors: p.base_colors, pattern: p.base_pattern }); else missing.push(p.base);
  for (const [slot, layer] of Object.entries(p.layers)) {
    if (!layer) continue;
    const part = parts[layer.part];
    if (!part) { missing.push(layer.part); continue; }
    place(slot, part, layer);
  }
  items.sort((a, b) => a.z - b.z || a.order - b.order);
  const globals: Record<string, string> = {};
  for (const [g, spec] of Object.entries(kit.globals)) globals[g] = color(p.colors?.[g], spec.default);
  const [fx, fy, fw, fh] = kit.frame;
  const size = opts.width ? ` width="${opts.width}" height="${opts.height ?? Math.round(opts.width * fh / fw)}"` : "";
  const bg = opts.background ? `<rect x="${fx - fw}" y="${fy - fh}" width="${fw * 3}" height="${fh * 3}" fill="${color(opts.background, "#ffffff")}"/>` : "";
  const par = opts.stretch ? ` preserveAspectRatio="none"` : "";
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${kit.frame.join(" ")}"${size}${par}>${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${bg}`
      + `<g style="${vars(globals)}">${items.map((i) => i.svg).join("")}</g></svg>`,
    missing, hidden,
  };
}

/** Aperçu isolé d'une pièce (couleurs par défaut), posée sur une base « fantôme » si elle s'accroche à un point. */
export function composeKitPart(part: PartPayload, kit: KitSpec, opts: { ghostBase?: PartPayload | null; colors?: Record<string, string>; viewBox?: string } = {}): string {
  const globals = Object.fromEntries(Object.entries(kit.globals).map(([g, s]) => [g, s.default]));
  const style = vars({ ...globals, ...partColors(part, opts.colors) });
  if (part.slot === "pattern") {
    const vb = part.view_box ?? [0, 0, 20, 20];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb[2] * 3} ${vb[3] * 3}"><defs><pattern id="pp" patternUnits="userSpaceOnUse" width="${vb[2]}" height="${vb[3]}">`
      + `<g style="${style}">${prefixIds(part.defs, "pp-")}${prefixIds(part.front, "pp-")}</g></pattern></defs><rect width="${vb[2] * 3}" height="${vb[3] * 3}" fill="url(#pp)"/></svg>`;
  }
  const ghost = opts.ghostBase && part.slot !== "base" ? opts.ghostBase : null;
  const pos = part.slot === "base" ? [[0, 0]] : placements(part, ghost ?? undefined, kit);
  const shown = pos.length ? pos : [[0, 0]];
  const ghostSvg = ghost ? `<g style="${vars(Object.fromEntries(Object.entries(globals).map(([g]) => [g, "#cfd8d6"])))};--babi-primary:#dfe6e4;--babi-secondary:#cfd8d6;--babi-accent:#e8eeec;opacity:0.5">${prefixIds(ghost.back + ghost.front, "gb-")}</g>` : "";
  const body = shown.map(([x, y]) => `<g transform="translate(${x} ${y})">${prefixIds(part.back, "p-")}${prefixIds(part.front, "p-")}</g>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${opts.viewBox ?? kit.frame.join(" ")}">${part.defs ? `<defs>${prefixIds(part.defs, "p-")}</defs>` : ""}`
    + `${ghostSvg}<g style="${style}">${body}</g></svg>`;
}

// ------------------------------------------------------------------ règles de compatibilité (miroir de validation.check_assembly)

export interface KitIssue { slot: string; message: string; level: "error" | "warning" }

export function checkAssembly(m: ModularProps, parts: Record<string, PartPayload>, kit: KitSpec, kitKey: string): KitIssue[] {
  const issues: KitIssue[] = [];
  const err = (slot: string, message: string) => issues.push({ slot, message, level: "error" });
  const base = parts[m.base];
  if (!base || base.slot !== "base" || base.kit !== kitKey) return [{ slot: "base", message: "Base introuvable dans ce kit.", level: "error" }];
  const label = (s: string) => kit.slots[s]?.label ?? s;
  for (const ch of Object.keys(m.colors ?? {})) if (!(ch in kit.globals)) err("base", `Couleur partagée inconnue dans ce kit : ${ch}`);
  const palette = (part: PartPayload, slot: string, colors?: Record<string, string>) => {
    for (const [ch, col] of Object.entries(colors ?? {})) {
      if (!(LAYER_CHANNELS as readonly string[]).includes(ch)) { err(slot, `Canal non réglable : ${ch}`); continue; }
      const pal: string[] = part.props?.palette?.[ch] ?? [];
      if (pal.length && !pal.map((c) => c.toLowerCase()).includes(col.toLowerCase())) err(slot, `Couleur ${col} hors de la palette autorisée de « ${part.name} ».`);
    }
  };
  const patternOk = (slot: string, pat?: ModPattern | null) => {
    if (!pat) return;
    if (!kit.pattern_slots.includes(slot)) { err(slot, `L'emplacement « ${label(slot)} » n'accepte pas de motif.`); return; }
    const pp = parts[pat.part];
    if (!pp || pp.slot !== "pattern" || pp.kit !== kitKey) err(slot, "Motif introuvable dans ce kit.");
  };
  palette(base, "base", m.base_colors);
  patternOk("base", m.base_pattern);
  const anchors: Record<string, number[][]> = base.props?.anchors ?? {};
  const used: Record<string, PartPayload> = {};
  for (const [slot, layer] of Object.entries(m.layers)) {
    if (!layer) continue;
    if (!(slot in kit.slots) || slot === "base" || slot === "pattern") { err(slot, `Emplacement inconnu : ${slot}`); continue; }
    const part = parts[layer.part];
    if (!part) { err(slot, "Composant introuvable."); continue; }
    if (part.kit !== kitKey) { err(slot, `« ${part.name} » appartient à un autre kit.`); continue; }
    if (part.slot !== slot) { err(slot, `« ${part.name} » n'est pas un composant « ${label(slot)} ».`); continue; }
    const bases: string[] = part.props?.bases ?? [];
    if (bases.length && !bases.includes(m.base)) err(slot, `« ${part.name} » n'est pas compatible avec la base « ${base.name} ».`);
    const a = part.props?.anchor as string | undefined;
    if (a && !(a in anchors)) err(slot, `« ${part.name} » ne peut pas s'accrocher : la base « ${base.name} » n'a pas de point « ${a} ».`);
    else if (a && !anchors[a].length) issues.push({ slot, level: "warning", message: `« ${part.name} » n'apparaît pas : la base « ${base.name} » n'a aucune position « ${a} ».` });
    palette(part, slot, layer.colors);
    patternOk(slot, layer.pattern);
    used[slot] = part;
  }
  for (const [slot, part] of Object.entries(used)) {
    for (const other of part.props?.incompatible_slots ?? []) if (used[other]) err(slot, `« ${part.name} » est incompatible avec l'emplacement « ${label(other)} ».`);
    for (const pid of part.props?.incompatible_parts ?? []) {
      const q = Object.values(used).find((x) => x.id === pid) ?? (pid === m.base ? base : null);
      if (q) err(slot, `« ${part.name} » est incompatible avec « ${q.name} ».`);
    }
    for (const need of part.props?.requires_slots ?? []) if (!used[need]) err(slot, `« ${part.name} » nécessite un composant « ${label(need)} ».`);
  }
  for (const [slot, spec] of Object.entries(kit.slots)) if (spec.required && slot !== "base" && !used[slot]) err(slot, `Emplacement obligatoire vide : ${spec.label}.`);
  return issues;
}

/** Une pièce peut-elle s'accrocher à cette base (restriction de bases + point d'ancrage présent et non vide) ? */
export function fitsBase(part: PartPayload, base: PartPayload): boolean {
  const bases: string[] = part.props?.bases ?? [];
  if (bases.length && !bases.includes(base.id)) return false;
  const a = part.props?.anchor as string | undefined;
  return !a || !!(base.props?.anchors?.[a]?.length);
}

// ------------------------------------------------------------------ génération et combinatoire

const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length) % arr.length];

/** Couleurs réalistes par kit : les kits « naturels » gardent les couleurs de leurs pièces et ne varient que les teintes partagées. */
export const KIT_PALETTES: Record<string, { base: string[]; layer: string[]; free: boolean; globals: Record<string, string[]> }> = {
  building: { base: ["#efe2c6", "#f3ead8", "#e3b778", "#d8e2dc", "#f6d6c9", "#cfe3d3", "#f2e6a7", "#bcd8e8", "#e8d0e6", "#ffffff"],
    layer: ["#c0392b", "#2a9d8f", "#1f6f5c", "#e67e22", "#f1c40f", "#1e3d6b", "#6a4c93", "#d6337a", "#3f7d6b", "#8b5a2b"], free: true,
    globals: { trim: ["#2f5d62", "#7a4b2a", "#1d2a30", "#1f6f5c", "#8e2b2b", "#f4f1e8", "#3f6f8f"], glass: ["#9cc8d6", "#7fb2c9", "#b9d8e3", "#5f8ea3"] } },
  vehicle: { base: ["#e67e22", "#27ae60", "#f1c40f", "#2980b9", "#c0392b", "#f4f1e8", "#2d3436", "#8e44ad", "#16a085", "#bdc3c7", "#1e6f9f"],
    layer: ["#f1c40f", "#ffffff", "#1d2a30", "#c0392b", "#27ae60", "#f77f00", "#2e86de"], free: true,
    globals: { glass: ["#9cc8d6", "#5f7f8e", "#2d3e48"], chrome: ["#c8ced3", "#9aa3a8", "#2d3436"] } },
  vegetation: { base: [], layer: [], free: false,
    globals: { leaf: ["#3f8f4a", "#2f7d32", "#5a9e4b", "#6a994e", "#4f8f3a", "#2e6b3f", "#7fae4e"], bark: ["#7a5236", "#6b4f2a", "#8a7a68", "#5c4033"] } },
  street: { base: ["#d9c7a0", "#c9b48a", "#e9dcc2"], layer: ["#e63946", "#2a9d8f", "#f1c40f", "#1e6f3e", "#2980b9", "#e76f51", "#6a4c93"], free: true,
    globals: { metal: ["#4a5560", "#2d3436", "#1e6f3e", "#2f5d62", "#6b7378"], wood: ["#a0703c", "#8b5a33", "#c9a46a"] } },
  furniture: { base: ["#c0623b", "#2a9d8f", "#264653", "#e9c46a", "#6a4c93", "#efe6d2", "#c79a63", "#b5523b", "#e9e4d8"],
    layer: ["#e9c46a", "#e76f51", "#264653", "#2a9d8f", "#f4a261", "#9cc8d6", "#6a4c93", "#c0392b"], free: true,
    globals: { wood: ["#8b5a33", "#a0703c", "#5c4033", "#c9a46a"], metal: ["#6b7378", "#2d3436", "#c8ced3", "#b08d57"] } },
  surface: { base: [], layer: [], free: false, globals: { line: ["#f4f1e8", "#f1c40f"], stone: ["#b9b4a8", "#9a948a", "#cfc6b4"] } },
};

/** Tire au sort un assemblage complet et compatible (aucune combinaison invalide n'est produite). */
export function randomAssembly(lib: PartPayload[], kitKey: string, kit: KitSpec, rng: Rng, opts: { base?: string; tries?: number } = {}): ModularProps | null {
  const live = lib.filter((p) => p.kit === kitKey && !p.archived);
  const bySlot = (slot: string) => live.filter((p) => p.slot === slot);
  const bases = opts.base ? live.filter((p) => p.id === opts.base) : bySlot("base");
  if (!bases.length) return null;
  const parts = Object.fromEntries(live.map((p) => [p.id, p]));
  const pal = KIT_PALETTES[kitKey] ?? { base: [], layer: [], free: false, globals: {} };
  const patterns = bySlot("pattern");
  const colorsFor = (part: PartPayload): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const ch of LAYER_CHANNELS) {
      if (!(ch in (part.channels ?? {}))) continue;
      const allowed: string[] = part.props?.palette?.[ch] ?? [];
      if (allowed.length) out[ch] = pick(rng, allowed);
      else if (pal.free && rng() < 0.75) out[ch] = pick(rng, ch === "primary" && part.slot === "base" && pal.base.length ? pal.base : pal.layer);
    }
    return out;
  };
  const maybePattern = (slot: string): ModPattern | null => {
    if (!patterns.length || !kit.pattern_slots.includes(slot) || rng() > 0.18) return null;
    const pat = pick(rng, patterns);
    return { part: pat.id, colors: pal.free ? { primary: pick(rng, pal.layer.length ? pal.layer : ["#e67e22"]) } : {}, channel: "primary", scale: 1 };
  };
  for (let t = 0; t < (opts.tries ?? 60); t++) {
    const base = pick(rng, bases);
    const layers: Record<string, ModLayer> = {};
    for (const [slot, spec] of Object.entries(kit.slots)) {
      if (slot === "base" || slot === "pattern") continue;
      const options = bySlot(slot).filter((p) => fitsBase(p, base));
      if (!options.length) continue;
      if (!spec.required && rng() >= (kit.random[slot] ?? 0.5)) continue;
      const part = pick(rng, options);
      const layer: ModLayer = { part: part.id, colors: colorsFor(part) };
      const pat = maybePattern(slot);
      if (pat) layer.pattern = pat;
      layers[slot] = layer;
    }
    const colors: Record<string, string> = {};
    for (const g of Object.keys(kit.globals)) if (pal.globals[g]?.length) colors[g] = pick(rng, pal.globals[g]);
    const m: ModularProps = { kit: kitKey, base: base.id, base_colors: colorsFor(base), colors, layers };
    const bp = maybePattern("base");
    if (bp) m.base_pattern = bp;
    if (!checkAssembly(m, parts, kit, kitKey).some((i) => i.level === "error")) return m;
  }
  return null;
}

/** Nombre de silhouettes possibles (avant couleurs et motifs) : somme, par base, du produit des choix par emplacement. */
export function countCombinations(lib: PartPayload[], kitKey: string, kit: KitSpec): { total: number; bases: { name: string; count: number }[]; options: Record<string, number> } {
  const live = lib.filter((p) => p.kit === kitKey && !p.archived);
  const options: Record<string, number> = {};
  for (const p of live) options[p.slot] = (options[p.slot] ?? 0) + 1;
  const out = live.filter((p) => p.slot === "base").map((base) => {
    let count = 1;
    for (const [slot, spec] of Object.entries(kit.slots)) {
      if (slot === "base" || slot === "pattern") continue;
      const nOpt = live.filter((p) => p.slot === slot && fitsBase(p, base)).length;
      count *= nOpt + (spec.required ? 0 : 1);
    }
    return { name: base.name, count };
  });
  return { total: out.reduce((s, b) => s + b.count, 0), bases: out, options };
}

// ------------------------------------------------------------------ contrôles automatiques de la bibliothèque (sans DOM)

export interface LibCheck { name: string; ok: boolean; detail: string }

const FIXED_COLOR = /(?:fill|stroke|stop-color)\s*[:=]\s*"?\s*(#[0-9a-fA-F]{3,8}|rgba?\(([^)]*)\))/g;

/** Couleurs « matière » codées en dur (hors variables --babi-*) ; les ombres et lumières noires/blanches sont admises. */
export function hardcodedColors(fragment: string): string[] {
  const out: string[] = [];
  const cleaned = fragment.replace(/var\(--babi-[a-z]+\s*,\s*[^)]*\)/g, "var()");
  for (const m of cleaned.matchAll(FIXED_COLOR)) {
    if (m[2]) {
      const [r, g, b] = m[2].split(",").map((x) => Number(x.trim()));
      if ((r === 0 && g === 0 && b === 0) || (r === 255 && g === 255 && b === 255)) continue;
      if (r >= 230 && g >= 200 && b >= 140) continue; // halo lumineux chaud (lampes)
    }
    out.push(m[1]);
  }
  return out;
}

export function libraryChecks(lib: PartPayload[], kitKey: string, kit: KitSpec): LibCheck[] {
  const live = lib.filter((p) => p.kit === kitKey && !p.archived);
  const bases = live.filter((p) => p.slot === "base");
  const parts = Object.fromEntries(live.map((p) => [p.id, p]));
  const res: LibCheck[] = [];
  const t = (name: string, fn: () => { ok: boolean; detail: string }) => {
    try { res.push({ name, ...fn() }); } catch (e) { res.push({ name, ok: false, detail: `Exception : ${(e as Error).message}` }); }
  };
  t("Bibliothèque minimale (≥ 1 base, emplacements obligatoires pourvus)", () => {
    const empty = Object.entries(kit.slots).filter(([s, sp]) => sp.required && !live.some((p) => p.slot === s)).map(([, sp]) => sp.label);
    const counts = Object.entries(kit.slots).map(([s, sp]) => `${live.filter((p) => p.slot === s).length} ${sp.label.toLowerCase()}`);
    return { ok: bases.length > 0 && !empty.length, detail: empty.length ? `Vides : ${empty.join(", ")}` : counts.join(", ") };
  });
  t("Repère commun pour toutes les pièces", () => {
    const bad = live.filter((p) => p.slot !== "pattern" && p.view_box && p.view_box.map(Math.round).join(" ") !== kit.frame.join(" ")
      && num(p.props?.scale, 1) === 1 && !(p.props?.offset?.[0] || p.props?.offset?.[1]));
    return { ok: !bad.length, detail: bad.length ? bad.map((p) => p.name).join(", ") : `viewBox ${kit.frame.join(" ")}` };
  });
  t("Aucune couleur matière codée en dur", () => {
    const bad = live.filter((p) => hardcodedColors(p.defs + p.back + p.front).length);
    return { ok: !bad.length, detail: bad.length ? bad.map((p) => `${p.name} (${hardcodedColors(p.defs + p.back + p.front).slice(0, 2).join(", ")})`).join(" · ") : "toutes les couleurs passent par des canaux --babi-*" };
  });
  t("Chaque base fournit les points d'ancrage requis", () => {
    const bad = bases.filter((b) => kit.required_anchors.some((a) => !(a in (b.props?.anchors ?? {}))));
    return { ok: !bad.length, detail: bad.length ? bad.map((b) => b.name).join(", ") : `${bases.length} base(s) · points : ${kit.required_anchors.join(", ") || "aucun requis"}` };
  });
  t("Chaque pièce s'accroche à au moins une base", () => {
    const orphans = live.filter((p) => p.slot !== "base" && p.slot !== "pattern" && !bases.some((b) => fitsBase(p, b)));
    return { ok: !orphans.length, detail: orphans.length ? orphans.map((p) => p.name).join(", ") : `${live.length - bases.length} pièce(s) utilisables` };
  });
  t("Générateur : 60 tirages, aucune combinaison invalide", () => {
    let ok = 0, nul = 0;
    for (let i = 0; i < 60; i++) {
      const m = randomAssembly(live, kitKey, kit, seededLocal(1000 + i));
      if (!m) { nul++; continue; }
      if (!checkAssembly(m, parts, kit, kitKey).some((x) => x.level === "error")) ok++;
    }
    return { ok: ok === 60 - nul && nul < 60, detail: `${ok} assemblages valides, ${nul} échec(s) de tirage` };
  });
  t("Identifiants SVG uniques entre plusieurs assemblages", () => {
    const svgs = [0, 1, 2].map((i) => { const m = randomAssembly(live, kitKey, kit, seededLocal(77 + i)); return m ? composeKit(m, parts, kit, { idPrefix: `t${i}` }).svg : ""; }).join("");
    const ids = [...svgs.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    return { ok: !dup.length, detail: `${ids.length} identifiant(s), ${dup.length} doublon(s)` };
  });
  t("Le rendu ne contient ni script, ni image, ni ressource externe", () => {
    const bad = live.filter((p) => /<script|<image|<foreignObject|href="http|javascript:/i.test(p.defs + p.back + p.front));
    return { ok: !bad.length, detail: bad.length ? bad.map((p) => p.name).join(", ") : "formes vectorielles uniquement" };
  });
  return res;
}

function seededLocal(seed: number): Rng {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
