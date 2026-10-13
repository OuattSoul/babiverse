// Formulaires générés à partir de schémas déclaratifs : un schéma par famille, aucun écran codé par catégorie.
// Les libellés sont ceux d'un administrateur (« Largeur en cases »), le chemin technique reste dans `path`.
import { api } from "./api";
import type { AssetDefinition, Media } from "./types";
import { ctx, field, fmtSize, h, modal, refreshMedia, toast } from "./ui";

export type FieldKind = "text" | "textarea" | "number" | "select" | "check" | "color" | "tags" | "media" | "multicheck";
export interface FieldSpec {
  path: string; label: string; kind: FieldKind; hint?: string;
  options?: Record<string, string> | (() => Record<string, string>);
  min?: number; max?: number; step?: number; nullable?: boolean; rebuild?: boolean;
  show?: (def: AssetDefinition) => boolean; mediaKind?: "svg" | "raster" | "any"; mediaCategory?: string;
}
export interface SectionSpec { id: string; title: string; intro?: string; fields: FieldSpec[] }

export function getPath(o: any, path: string) { return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
export function setPath(o: any, path: string, v: any) {
  const ks = path.split("."); let cur = o;
  for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null) cur[ks[i]] = {}; cur = cur[ks[i]]; }
  cur[ks[ks.length - 1]] = v;
}

const opts = (o: FieldSpec["options"]) => (typeof o === "function" ? o() : o ?? {});

export function control(def: AssetDefinition, f: FieldSpec, onChange: (rebuild: boolean) => void, disabled: boolean): HTMLElement {
  const v = getPath(def, f.path);
  const done = (val: any, rebuild = !!f.rebuild) => { setPath(def, f.path, val); onChange(rebuild); };
  switch (f.kind) {
    case "textarea": {
      const el = h("textarea", { rows: 3, disabled }, v ?? "") as HTMLTextAreaElement;
      el.addEventListener("input", () => done(el.value, false));
      return el;
    }
    case "number": {
      const el = h("input", { type: "number", value: v ?? "", min: f.min, max: f.max, step: f.step ?? 1, disabled, inputmode: "decimal" }) as HTMLInputElement;
      el.addEventListener("change", () => done(el.value === "" ? (f.nullable ? null : 0) : Number(el.value), true));
      return el;
    }
    case "select": {
      const el = h("select", { disabled }, Object.entries(opts(f.options)).map(([k, l]) => h("option", { value: k, selected: String(v ?? "") === k }, l))) as HTMLSelectElement;
      el.addEventListener("change", () => done(el.value === "" && f.nullable ? null : /^-?\d+$/.test(el.value) && typeof v === "number" ? Number(el.value) : el.value, true));
      return el;
    }
    case "check": {
      const el = h("input", { type: "checkbox", checked: !!v, disabled }) as HTMLInputElement;
      el.addEventListener("change", () => done(el.checked, true));
      return el;
    }
    case "color": {
      const el = h("input", { type: "color", value: v ?? "#999999", disabled }) as HTMLInputElement;
      el.addEventListener("input", () => done(el.value, false));
      el.addEventListener("change", () => onChange(true));
      return el;
    }
    case "tags": {
      const el = h("input", { value: (v ?? []).join(", "), disabled, placeholder: "séparées par des virgules" }) as HTMLInputElement;
      el.addEventListener("change", () => done(el.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20), false));
      return el;
    }
    case "multicheck": {
      const cur: string[] = Array.isArray(v) ? v : [];
      return h("div", { class: "row" }, Object.entries(opts(f.options)).map(([k, l]) => {
        const c = h("input", { type: "checkbox", checked: cur.includes(k), disabled }) as HTMLInputElement;
        c.addEventListener("change", () => done(c.checked ? [...new Set([...(getPath(def, f.path) ?? []), k])] : (getPath(def, f.path) ?? []).filter((x: string) => x !== k), true));
        return h("label", { class: "toggle" }, c, l);
      }));
    }
    case "media":
      return mediaPicker(v ?? null, (id) => done(id, true), { disabled, kind: f.mediaKind ?? "any", category: f.mediaCategory, nullable: f.nullable });
    default: {
      const el = h("input", { value: v ?? "", disabled }) as HTMLInputElement;
      el.addEventListener("input", () => done(el.value, false));
      el.addEventListener("change", () => onChange(true));
      return el;
    }
  }
}

export function renderSection(spec: SectionSpec, def: AssetDefinition, onChange: (rebuild: boolean) => void, disabled: boolean, open = true): HTMLDetailsElement {
  const fields = spec.fields.filter((f) => !f.show || f.show(def));
  const inline = fields.filter((f) => f.kind !== "textarea" && f.kind !== "multicheck" && f.kind !== "media");
  const block = fields.filter((f) => !inline.includes(f));
  const s = h("details", { class: "sec", open, id: `sec-${spec.id}` }, h("summary", {}, spec.title),
    h("div", { class: "sec-body" },
      spec.intro ? h("p", { class: "muted" }, spec.intro) : null,
      inline.length ? h("div", { class: "row" }, inline.map((f) => f.kind === "check"
        ? h("label", { class: "toggle" }, control(def, f, onChange, disabled), f.label)
        : field(f.label, control(def, f, onChange, disabled), f.hint))) : null,
      block.map((f) => field(f.label, control(def, f, onChange, disabled), f.hint))));
  return s;
}

// ------------------------------------------------------------------ sélecteur de fichiers

export function mediaThumb(m: Media | undefined, size = 56): HTMLElement {
  if (!m) return h("span", { class: "media-thumb empty-thumb", style: { width: `${size}px`, height: `${size}px` } }, "—");
  if (m.kind === "model") return h("span", { class: "media-thumb model-thumb", style: { width: `${size}px`, height: `${size}px` }, title: m.name }, "3D");
  return h("span", { class: "media-thumb", style: { width: `${size}px`, height: `${size}px` } }, h("img", { src: m.url, alt: m.name, loading: "lazy" }));
}

export function mediaPicker(current: string | null, onPick: (id: string | null) => void,
                            o: { disabled?: boolean; kind?: "svg" | "raster" | "any"; category?: string; nullable?: boolean } = {}): HTMLElement {
  const m = current ? ctx.media.get(current) : undefined;
  const label = h("span", { class: "small" }, m ? `${m.name}${m.archived ? " (archivé)" : ""}` : current ? "Fichier introuvable" : "Aucun fichier");
  return h("div", { class: "media-pick" }, mediaThumb(m), label,
    h("button", { type: "button", class: "btn btn-small", disabled: o.disabled, onclick: () => openMediaChooser(onPick, o) }, m ? "Changer…" : "Choisir…"),
    o.nullable && current ? h("button", { type: "button", class: "btn btn-small btn-quiet", disabled: o.disabled, onclick: () => onPick(null) }, "Retirer") : null);
}

export function openMediaChooser(onPick: (id: string) => void, o: { kind?: "svg" | "raster" | "any"; category?: string } = {}) {
  const grid = h("div", { class: "media-grid" });
  const q = h("input", { type: "search", placeholder: "Rechercher un fichier…", "aria-label": "Rechercher un fichier" }) as HTMLInputElement;
  const file = h("input", { type: "file", accept: o.kind === "svg" ? ".svg,image/svg+xml" : o.kind === "raster" ? "image/png,image/webp,image/jpeg,image/gif" : ".svg,image/*" }) as HTMLInputElement;
  const render = () => {
    const items = [...ctx.media.values()].filter((m) => !m.archived && (o.kind === "any" || !o.kind || m.kind === o.kind)
      && (!q.value || m.name.toLowerCase().includes(q.value.toLowerCase())));
    grid.replaceChildren(...(items.length ? items.map((m) => h("button", { type: "button", class: "media-tile", onclick: () => { close(); onPick(m.id); } },
      mediaThumb(m, 72), h("span", {}, m.name), h("small", { class: "muted" }, `${m.kind === "svg" ? "SVG" : m.mime.split("/")[1].toUpperCase()} · ${fmtSize(m.size)}`)))
      : [h("p", { class: "muted" }, "Aucun fichier compatible. Importez-en un ci-dessous.")]));
  };
  q.addEventListener("input", render);
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const m = await api.uploadMedia(f, f.name, { category: o.category ?? "other" });
      await refreshMedia();
      toast(`« ${m.name} » importé`);
      close(); onPick(m.id);
    } catch (e) { toast((e as Error).message, "err"); }
  });
  const close = modal("Choisir un fichier", h("div", { class: "fields" }, q, grid,
    h("label", {}, "Ou importer depuis cet appareil", file, h("small", {}, `Formats : ${o.kind === "svg" ? "SVG" : "SVG, PNG, WebP, JPEG, GIF"} · ${ctx.tax?.limits.upload_mb ?? 5} Mo maximum`))), [], { wide: true, cancel: "Fermer" });
  render();
}

// ------------------------------------------------------------------ schémas par famille

const SHAPES = () => Object.fromEntries(Object.entries(ctx.tax!.prop_shapes).map(([k, v]) => [k, v.label]));
const FURN_SHAPES = () => ctx.tax!.furniture_shapes;
const VEHICLES = () => Object.fromEntries(Object.entries(ctx.tax!.vehicle_kinds).map(([k, v]) => [k, v.label]));
const SURFACES = () => Object.fromEntries(Object.entries(ctx.tax!.surface_kinds).map(([k, v]) => [k, v.label]));
const isSprite = (d: AssetDefinition) => d.representation === "sprite";

export function familySections(family: string): SectionSpec[] {
  switch (family) {
    case "surface": return [
      { id: "appearance", title: "Apparence de la surface", fields: [
        { path: "properties.kind", label: "Type de surface", kind: "select", options: SURFACES },
        { path: "properties.terrain", label: "Terrain obtenu", kind: "select", options: { ground: "Sol", sand: "Sable", water: "Eau" }, hint: "Remplace le terrain sous la surface" },
        { path: "properties.pattern", label: "Motif", kind: "select", options: { plain: "Uni", stripes: "Rayures", checker: "Damier", dots: "Pointillés", waves: "Vagues" } },
        { path: "materials.base", label: "Couleur de base", kind: "color" },
        { path: "materials.detail", label: "Couleur du motif", kind: "color" },
        { path: "properties.texture", label: "Texture importée (expérimental)", kind: "media", mediaKind: "any", mediaCategory: "texture", nullable: true,
          hint: "Affichée en vignette dans l'aperçu : le pavage par texture n'est pas encore rendu." },
      ] },
      { id: "geometry", title: "Dimensions et règles", fields: [
        { path: "footprint.w", label: "Largeur en cases", kind: "number", min: 1, max: 64 },
        { path: "footprint.d", label: "Profondeur en cases", kind: "number", min: 1, max: 64 },
        { path: "properties.walkable", label: "Praticable à pied", kind: "check" },
        { path: "properties.buildable", label: "Constructible (objets posables dessus)", kind: "check" },
      ] },
    ];
    case "prop": return [
      { id: "appearance", title: "Forme et apparence", fields: [
        { path: "representation", label: "Mode de rendu", kind: "select", options: { procedural: "Forme dessinée par le moteur", sprite: "Image importée" } },
        { path: "properties.shape", label: "Forme", kind: "select", options: SHAPES, show: (d) => !isSprite(d) },
        { path: "properties.sprite.media", label: "Image de l'objet", kind: "media", mediaKind: "any", mediaCategory: "sprite", show: isSprite },
        { path: "properties.sprite.scale", label: "Échelle de l'image", kind: "number", min: 0.1, max: 10, step: 0.1, show: isSprite },
        { path: "materials.primary", label: "Couleur principale", kind: "color" },
        { path: "materials.secondary", label: "Couleur secondaire", kind: "color" },
      ] },
      { id: "geometry", title: "Dimensions et collision", fields: [
        { path: "footprint.w", label: "Largeur en cases", kind: "number", min: 1, max: 16 },
        { path: "footprint.d", label: "Profondeur en cases", kind: "number", min: 1, max: 16 },
        { path: "height_m", label: "Hauteur (m)", kind: "number", min: 0, max: 40, step: 0.5 },
        { path: "collision", label: "Collision", kind: "select", options: { footprint: "Bloque le passage", none: "Traversable (décor)" } },
        { path: "default_rotation", label: "Orientation par défaut", kind: "select", options: { 0: "0°", 90: "90°", 180: "180°", 270: "270°" } },
      ] },
    ];
    case "furniture": return [
      { id: "appearance", title: "Forme et apparence", fields: [
        { path: "representation", label: "Mode de rendu", kind: "select", options: { procedural: "Forme dessinée par le moteur", sprite: "Image importée" } },
        { path: "properties.shape", label: "Forme", kind: "select", options: FURN_SHAPES, show: (d) => !isSprite(d) },
        { path: "properties.sprite.media", label: "Image du meuble", kind: "media", mediaKind: "any", mediaCategory: "sprite", show: isSprite },
        { path: "materials.primary", label: "Couleur principale", kind: "color" },
        { path: "materials.secondary", label: "Couleur secondaire", kind: "color" },
      ] },
      { id: "geometry", title: "Taille dans un intérieur", intro: "Mesurée en tuiles d'intérieur (une case de ville = 4 × 4 tuiles).", fields: [
        { path: "properties.w", label: "Largeur en tuiles", kind: "number", min: 1, max: 8 },
        { path: "properties.d", label: "Profondeur en tuiles", kind: "number", min: 1, max: 8 },
        { path: "properties.height_px", label: "Hauteur visuelle", kind: "number", min: 1, max: 80 },
      ] },
      { id: "actions", title: "Actions possibles", intro: "Actions reconnues par le moteur ; elles se choisissent ensuite meuble par meuble dans l'éditeur de plan.", fields: [
        { path: "properties.actions", label: "Actions", kind: "multicheck", options: () => Object.fromEntries(
          ["sleep", "sit", "eat", "cook", "work", "store", "wash", "use", "watch", "shop"].map((a) => [a, ctx.tax!.behaviors[a]?.label ?? a])) },
      ] },
    ];
    case "vehicle": return [
      { id: "appearance", title: "Modèle et apparence", fields: [
        { path: "properties.kind", label: "Type de véhicule", kind: "select", options: VEHICLES },
        { path: "representation", label: "Mode de rendu", kind: "select", options: { procedural: "Carrosserie dessinée par le moteur", sprite: "Image importée" } },
        { path: "properties.sprite.media", label: "Image du véhicule", kind: "media", mediaKind: "any", mediaCategory: "sprite", show: isSprite },
        { path: "materials.body", label: "Carrosserie", kind: "color" },
        { path: "materials.trim", label: "Bandes et pneus", kind: "color" },
        { path: "materials.glass", label: "Vitres", kind: "color" },
        { path: "properties.stripe", label: "Bande décorative", kind: "check" },
        { path: "properties.roof_sign", label: "Enseigne de toit", kind: "text", hint: "12 caractères (taxis)" },
      ] },
      { id: "geometry", title: "Dimensions et stationnement", fields: [
        { path: "footprint.w", label: "Largeur en cases", kind: "number", min: 1, max: 4 },
        { path: "footprint.d", label: "Longueur en cases", kind: "number", min: 1, max: 8 },
        { path: "height_m", label: "Hauteur (m)", kind: "number", min: 0.5, max: 5, step: 0.1 },
        { path: "properties.seats", label: "Places", kind: "number", min: 1, max: 80 },
        { path: "properties.parking", label: "Stationnement", kind: "select", options: { road: "Sur la voirie", parking: "Voirie ou parking", anywhere: "Partout" } },
        { path: "default_rotation", label: "Orientation par défaut", kind: "select", options: { 0: "0°", 90: "90°", 180: "180°", 270: "270°" } },
      ] },
    ];
    default: return [];
  }
}

export function identitySection(def: AssetDefinition, subcats: string[], onChange: (r: boolean) => void, disabled: boolean): HTMLDetailsElement {
  const dl = h("datalist", { id: "subcats" }, subcats.map((s) => h("option", { value: s })));
  const s = renderSection({ id: "identity", title: "Identité", fields: [
    { path: "name", label: "Nom affiché", kind: "text", hint: "Peut changer à tout moment : l'identifiant technique, lui, ne change jamais." },
    { path: "subcategory", label: "Sous-catégorie", kind: "text" },
    { path: "tags", label: "Étiquettes", kind: "tags" },
    { path: "description", label: "Description", kind: "textarea" },
    { path: "cover", label: "Image de couverture (facultative)", kind: "media", mediaKind: "any", mediaCategory: "cover", nullable: true },
  ] }, def, onChange, disabled);
  const sub = s.querySelectorAll("input")[1] as HTMLInputElement | undefined;
  sub?.setAttribute("list", "subcats");
  s.querySelector(".sec-body")!.append(dl);
  return s;
}

export function placementSection(def: AssetDefinition, family: string, onChange: (r: boolean) => void, disabled: boolean): HTMLDetailsElement {
  const pl = def.placement;
  const terr = h("div", { class: "row" }, ([["ground", "Sol"], ["sand", "Sable"], ["water", "Eau"]] as const).map(([k, l]) => {
    const c = h("input", { type: "checkbox", checked: pl.allowed_terrain.includes(k), disabled }) as HTMLInputElement;
    c.addEventListener("change", () => { pl.allowed_terrain = c.checked ? [...new Set([...pl.allowed_terrain, k])] : pl.allowed_terrain.filter((t) => t !== k); onChange(false); });
    return h("label", { class: "toggle" }, c, l);
  }));
  const extra: FieldSpec[] = family === "building" ? [
    { path: "placement.road_access", label: "Accès routier", kind: "select", options: { required: "Obligatoire", preferred: "Recommandé", none: "Aucun" }, hint: "Entrée principale à 2 cases maximum d'une route" },
    { path: "placement.safety_margin", label: "Zone de sécurité (cases)", kind: "number", min: 0, max: 4 },
    { path: "placement.max_height_m", label: "Hauteur maximale (m)", kind: "number", min: 0, max: 300, nullable: true },
  ] : family === "prop" ? [{ path: "placement.safety_margin", label: "Zone de sécurité (cases)", kind: "number", min: 0, max: 4 }] : [];
  const sec = renderSection({ id: "placement", title: "Règles de placement", fields: extra }, def, onChange, disabled);
  sec.querySelector(".sec-body")!.prepend(field("Terrains autorisés", terr));
  return sec;
}
