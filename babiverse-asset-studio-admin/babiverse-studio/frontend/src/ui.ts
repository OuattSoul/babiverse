import type { AssetDefinition, Capability, Family, Media, PartPayload, Report, Taxonomy, User, Variant } from "./types";
import { api } from "./api";
import { CanvasPainter } from "./render/painter";
import { drawAsset, iso, TW, TH, drawTile, setCharacterResolver, setMediaResolver, setModularResolver } from "./render/iso";
import { rotatedSize } from "./geometry";
import { composeCharacter, composePart, type CharacterProps } from "./character/compose";
import { svgDataUrl, svgImage } from "./character/svgimg";
import { composeKit, composeKitPart, type KitSpec, type ModularProps } from "./modular/compose";

type Child = Node | string | number | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k in el && typeof v !== "string") (el as any)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** Remplace le contenu d'un élément en ignorant les enfants absents (null, undefined, false). */
export function fill(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren(...(children.flat().filter((c) => c !== null && c !== undefined && c !== false) as (Node | string)[]).map((c) => (typeof c === "number" ? String(c) : c)));
}

// ------------------------------------------------------------------ contexte de session

export const ctx: { user: User | null; tax: Taxonomy | null; parts: Map<string, PartPayload>; kitParts: Map<string, PartPayload>; media: Map<string, Media> } = {
  user: null, tax: null, parts: new Map(), kitParts: new Map(), media: new Map(),
};
export const can = (perm: string) => !!ctx.user?.permissions.includes(perm);
export const catLabel = (key: string) => ctx.tax?.categories.find((c) => c.key === key)?.label ?? key;
export const famLabel = (f: string) => ctx.tax?.families[f as Family]?.label ?? f;
export const slotLabel = (s: string) => ctx.tax?.character_slots[s]?.label ?? s;
export const partsRecord = () => Object.fromEntries(ctx.parts);
export const kitPartsRecord = () => Object.fromEntries(ctx.kitParts);
export const kitSpec = (kit: string): KitSpec | undefined => ctx.tax?.kits?.[kit];
export const kitSlotLabel = (kit: string, slot: string) => kitSpec(kit)?.slots[slot]?.label ?? slot;

export async function loadLibrary() {
  const [parts, kitParts, media, archived] = await Promise.all([api.parts(true), api.kitParts(), api.media(), api.media({ archived: true })]);
  ctx.parts = new Map(parts.map((p) => [p.id, p]));
  ctx.kitParts = new Map(kitParts.map((p) => [p.id, p]));
  ctx.media = new Map([...media, ...archived].map((m) => [m.id, m]));
  charCache.clear(); modCache.clear();
}
export async function refreshParts() { ctx.parts = new Map((await api.parts(true)).map((p) => [p.id, p])); charCache.clear(); }
export async function refreshKitParts() { ctx.kitParts = new Map((await api.kitParts()).map((p) => [p.id, p])); modCache.clear(); }
export async function refreshMedia() {
  const [media, archived] = await Promise.all([api.media(), api.media({ archived: true })]);
  ctx.media = new Map([...media, ...archived].map((m) => [m.id, m]));
}

// rendu des personnages et des images dans le moteur isométrique
const charCache = new Map<string, string>();
setMediaResolver((id) => ctx.media.get(id)?.url ?? null);
setCharacterResolver((def, variant) => characterUrl(def.properties, variant));
const modCache = new Map<string, string>();
setModularResolver((def, variant) => {
  const m = def.properties?.modular as ModularProps | undefined;
  const kit = m ? kitSpec(m.kit) : undefined;
  if (!m || !kit || !ctx.kitParts.size) return null;
  const key = JSON.stringify([m, variant?.props ?? null]);
  let url = modCache.get(key);
  if (!url) {
    url = svgDataUrl(composeKit(m, kitPartsRecord(), kit, { variant, idPrefix: "m", stretch: kit.view === "top", width: 240 }).svg);
    modCache.set(key, url);
    if (modCache.size > 300) modCache.delete(modCache.keys().next().value as string);
  }
  return { url, frame: kit.frame, ground: kit.ground, view: kit.view };
});

/** SVG composé d'un assemblage modulaire (null si le kit est inconnu). */
export function modularSvg(m: ModularProps, variant: Variant | null = null, opts: { background?: string | null; idPrefix?: string; width?: number } = {}): string | null {
  const kit = kitSpec(m?.kit);
  if (!kit) return null;
  return composeKit(m, kitPartsRecord(), kit, { variant, idPrefix: opts.idPrefix ?? "m", background: opts.background, width: opts.width }).svg;
}

export function characterSvg(props: CharacterProps, variant: Variant | null = null, opts: { background?: string | null; crop?: "full" | "portrait"; width?: number } = {}): string {
  return composeCharacter(props, partsRecord(), { variant, idPrefix: "c", ...opts }).svg;
}
export function characterUrl(props: CharacterProps, variant: Variant | null = null): string | null {
  if (!props?.body || !ctx.parts.size) return null;
  const key = JSON.stringify([props, variant?.props ?? null]);
  let url = charCache.get(key);
  if (!url) {
    url = svgDataUrl(characterSvg(props, variant, { width: 200 }));
    charCache.set(key, url);
    if (charCache.size > 300) charCache.delete(charCache.keys().next().value as string);
  }
  return url;
}

export const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon", in_review: "En validation", validated: "Validé", published: "Publié", archived: "Archivé", superseded: "Remplacée",
};
export function pill(status: string) { return h("span", { class: `pill pill-${status}` }, STATUS_LABEL[status] ?? status); }

const CAP_LABEL: Record<Capability, string> = { available: "disponible", experimental: "expérimental", unavailable: "non pris en charge" };
export function capBadge(c: Capability, label?: string) {
  return h("span", { class: `cap cap-${c}`, title: CAP_LABEL[c] }, label ? `${label} · ${CAP_LABEL[c]}` : CAP_LABEL[c]);
}
export const CAP_NAMES: Record<string, string> = {
  create: "Création", edit: "Édition", preview: "Aperçu", place: "Placement", variants: "Variantes", import: "Import de fichiers",
  export: "Export", behaviors: "Comportements", publish: "Publication", assembly: "Assemblage",
};

export function toast(msg: string, kind: "ok" | "err" = "ok") {
  const host = document.getElementById("toasts");
  if (!host) return;
  const t = h("div", { class: `toast toast-${kind}`, role: kind === "err" ? "alert" : "status" }, msg);
  host.append(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3200);
}

export function reportView(r: Report | null, onPath?: (p: string) => void): HTMLElement {
  if (!r) return h("p", { class: "muted" }, "Pas encore vérifié.");
  if (!r.items.length) return h("p", { class: "report-ok" }, "Aucun problème détecté.");
  const errors = r.items.filter((i) => i.level === "error"), warns = r.items.filter((i) => i.level === "warning");
  return h("div", {},
    h("p", { class: "report-sum" }, errors.length ? h("strong", { class: "txt-danger" }, `${errors.length} erreur(s) bloquante(s)`) : h("strong", { class: "txt-ok" }, "Aucune erreur bloquante"),
      warns.length ? ` · ${warns.length} avertissement(s)` : ""),
    h("ul", { class: "report" }, [...errors, ...warns].map((i) => h("li", { class: `rep-${i.level}`, onclick: () => onPath?.(i.path) },
      h("strong", {}, i.level === "error" ? "Erreur" : "Avertissement"), " ", i.message,
      i.path ? h("code", {}, i.path) : null))));
}

export function modal(title: string, body: HTMLElement, actions: { label: string; kind?: string; run: () => void | Promise<void> }[], opts: { wide?: boolean; cancel?: string } = {}): () => void {
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const wrap = h("div", { class: "modal-wrap", onclick: (e: Event) => { if (e.target === wrap) close(); } },
    h("div", { class: `modal${opts.wide ? " modal-wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
      h("h2", {}, title), body,
      h("div", { class: "modal-actions" },
        h("button", { class: "btn", onclick: close }, opts.cancel ?? "Annuler"),
        actions.map((a) => {
          const b = h("button", { class: `btn ${a.kind ?? "btn-primary"}` }, a.label);
          b.addEventListener("click", async () => { b.disabled = true; try { await a.run(); } finally { b.disabled = false; } });
          return b;
        }))));
  document.body.append(wrap);
  document.addEventListener("keydown", onKey);
  (wrap.querySelector("input,select,textarea,button.btn-primary") as HTMLElement | null)?.focus();
  return close;
}

export function confirmDialog(title: string, text: string, okLabel = "Confirmer", danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const close = modal(title, h("p", {}, text), [{ label: okLabel, kind: danger ? "btn-danger" : "btn-primary", run: () => { done = true; close(); resolve(true); } }]);
    const obs = new MutationObserver(() => { if (!document.body.contains(document.querySelector(".modal-wrap")) && !done) { obs.disconnect(); resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function slugify(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "asset";
}
export function uniqueId(list: { id: string }[], prefix: string) { let n = 1; while (list.some((i) => i.id === `${prefix}-${n}`)) n++; return `${prefix}-${n}`; }

export function fmtDate(ts: number) {
  return new Date(ts * 1000).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
export function fmtSize(n: number) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`; }

// ------------------------------------------------------------------ vignettes réelles

/** Vignette : rendu isométrique (Canvas 2D, même moteur que les scènes) ou SVG composé pour les personnages. */
export function thumbnail(def: AssetDefinition, family: string, size = 168): HTMLElement {
  if (family === "character") {
    const url = characterUrl(def.properties);
    const box = h("div", { class: "thumb thumb-char", style: { width: `${size}px`, height: `${size * 0.75}px` } });
    if (url) { const img = h("img", { src: url, alt: "" }); box.append(img); } else box.append(h("span", { class: "muted small" }, "aperçu indisponible"));
    return box;
  }
  if (def.representation === "modular" && def.properties?.modular) {
    const svg = modularSvg(def.properties.modular, null, { background: "#eef3f1", width: 240 });
    const box = h("div", { class: "thumb thumb-char", style: { width: `${size}px`, height: `${size * 0.75}px` } });
    box.append(svg ? svgImage(svg) : h("span", { class: "muted small" }, "aperçu indisponible"));
    return box;
  }
  if (family === "component") {
    const box = h("div", { class: "thumb thumb-char", style: { width: `${size}px`, height: `${size * 0.75}px` } });
    const part = [...ctx.kitParts.values()].find((p) => p.props?.svg_media === def.properties?.svg_media);
    const kit = kitSpec(def.properties?.kit);
    const ghost = [...ctx.kitParts.values()].find((p) => p.kit === def.properties?.kit && p.slot === "base");
    if (part && kit) box.append(svgImage(composeKitPart(part, kit, { ghostBase: ghost })));
    else if (def.properties?.svg_media && ctx.media.get(def.properties.svg_media)) box.append(h("img", { src: ctx.media.get(def.properties.svg_media)!.url, alt: "" }));
    return box;
  }
  if (family === "character_part") {
    const part = [...ctx.parts.values()].find((p) => p.props?.svg_media === def.properties?.svg_media && p.name === def.name)
      ?? [...ctx.parts.values()].find((p) => p.props?.svg_media === def.properties?.svg_media);
    const box = h("div", { class: "thumb thumb-char", style: { width: `${size}px`, height: `${size * 0.75}px` } });
    const body = [...ctx.parts.values()].find((p) => p.slot === "body");
    if (part) box.append(svgImage(composePart(part, { ghostBody: part.slot === "body" || part.slot === "pattern" ? null : body })));
    else if (def.properties?.svg_media && ctx.media.get(def.properties.svg_media)) box.append(h("img", { src: ctx.media.get(def.properties.svg_media)!.url, alt: "" }));
    return box;
  }
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = h("canvas", { width: size * dpr, height: size * 0.75 * dpr, class: "thumb" }) as HTMLCanvasElement;
  c.style.width = `${size}px`; c.style.height = `${size * 0.75}px`;
  const g = c.getContext("2d");
  if (!g) return c;
  const draw = () => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height);
    try {
      const indoor = family === "interior" || family === "furniture";
      const [w, d] = family === "interior" ? [def.properties.width, def.properties.depth] : family === "furniture" ? [def.properties.w ?? 1, def.properties.d ?? 1] : rotatedSize(def, 0);
      const hz = family === "interior" ? 30 : family === "furniture" ? (def.properties.height_px ?? 10) + 10 : def.height_m * 9 + 20;
      const spanX = (w + d) * TW / 2, spanY = (w + d) * TH / 2 + hz;
      const s = Math.min((size * 0.86) / spanX, (size * 0.66) / spanY, family === "prop" || family === "vehicle" ? 2.2 : 1.4) * dpr;
      const [cx, cy] = iso(w / 2, d / 2, indoor ? 8 : def.height_m * 4);
      g.setTransform(s, 0, 0, s, c.width / 2 - cx * s, c.height / 2 - cy * s + 4 * dpr);
      const p = new CanvasPainter(g);
      if (!indoor) for (let y = 0; y < d; y++) for (let x = 0; x < w; x++) drawTile(p, x, y, 0xa7c48a, 1, null);
      drawAsset(p, family, def, { x: 0, y: 0, rotation: 0 }, ctx.tax?.furniture ?? {});
    } catch { /* définition incomplète : vignette vide */ }
  };
  draw();
  // une image (sprite) peut arriver après le premier dessin
  const sprite = def.properties?.sprite?.media ?? def.properties?.texture;
  if (sprite && ctx.media.get(sprite)) { const im = new Image(); im.onload = draw; im.src = ctx.media.get(sprite)!.url; }
  return c;
}

export function emptyState(text: string, ...actions: (HTMLElement | null)[]) {
  return h("div", { class: "empty" }, h("p", {}, text), actions.length ? h("div", { class: "row center" }, actions) : null);
}

export function loading(text = "Chargement…") { return h("p", { class: "loading", role: "status" }, text); }

export function errorBox(e: unknown) { return h("div", { class: "empty" }, h("p", { class: "txt-danger" }, (e as Error).message)); }

/** Champ de formulaire libellé (vocabulaire non technique, aide facultative). */
export const field = (label: string, control: HTMLElement, hint?: string) => h("label", { class: "field" }, h("span", {}, label), control, hint ? h("small", {}, hint) : null);
export const row = (...c: (HTMLElement | null | false)[]) => h("div", { class: "row" }, c.filter(Boolean) as HTMLElement[]);

export function familyCard(f: Family, onPick: (f: Family) => void, active = false): HTMLElement {
  const info = ctx.tax!.families[f];
  const caps = Object.entries(info.capabilities);
  return h("button", { class: `fam-card${active ? " on" : ""}`, type: "button", onclick: () => onPick(f), "data-family": f },
    h("span", { class: `fam-dot fam-${f}`, "aria-hidden": "true" }),
    h("strong", {}, info.label),
    h("span", { class: "small muted" }, info.description),
    h("span", { class: "caps" }, caps.filter(([, v]) => v !== "available").map(([k, v]) => capBadge(v, CAP_NAMES[k] ?? k))),
    h("span", { class: "small muted" }, info.limits));
}

export const AUDIT_LABEL: Record<string, string> = {
  "asset.create": "Création", "asset.update_draft": "Brouillon modifié", "asset.new_draft": "Nouvelle version", "asset.submit": "Soumis",
  "asset.approve": "Approuvé", "asset.reject": "Renvoyé en brouillon", "asset.publish": "Publié", "asset.archive": "Archivé", "asset.restore": "Restauré",
  "asset.migrate": "Migration d'instances", "asset.revert": "Retour à une version", "asset.import": "Import de lot",
  "world.place": "Placement", "world.move": "Déplacement", "world.remove": "Retrait", "scene.create": "Scène créée", "scene.update": "Scène modifiée",
  "scene.delete": "Scène supprimée", "scene.clear": "Scène vidée", "media.upload": "Fichier importé", "media.replace": "Fichier remplacé",
  "media.update": "Fichier renommé", "media.archive": "Fichier archivé", "media.restore": "Fichier restauré", "category.create": "Catégorie créée",
  "category.update": "Catégorie modifiée", "user.create": "Utilisateur créé", "user.update": "Utilisateur modifié", "user.password": "Mot de passe changé",
  "auth.login": "Connexion", "bundle.export": "Export", "bundle.preview": "Import analysé", "bundle.rollback": "Import annulé",
};
