// Ateliers modulaires : bâtiments, véhicules, végétation, mobilier urbain, meubles et surfaces se composent comme les
// personnages — une base et des composants indépendants, sans dessiner aucune combinaison. Chaque kit a son atelier
// (aperçu, emplacements, couleurs, motifs, variantes, configuration JSON), sa rue de test (96 px / 40 px), son décompte de
// combinaisons, ses contrôles automatiques et sa bibliothèque de composants SVG importables.
import { api, ApiError, type AssetAction } from "../api";
import { go } from "../router";
import { seeded } from "../character/compose";
import { svgImage, svgDataUrl } from "../character/svgimg";
import {
  checkAssembly, composeKit, composeKitPart, countCombinations, effectiveModular, fitsBase, KIT_PALETTES, libraryChecks, placements, randomAssembly,
  type KitSpec, type LibCheck, type ModLayer, type ModPattern, type ModularProps,
} from "../modular/compose";
import { mountGame, PreviewScene } from "../render/stage";
import { templateFor } from "../templates";
import type { AssetDefinition, AssetDetail, AssetSummary, Media, PartPayload, Variant } from "../types";
import {
  can, ctx, emptyState, field, fill, fmtSize, h, kitPartsRecord, kitSlotLabel, kitSpec, modal, pill, refreshKitParts, refreshMedia, reportView, row,
  slugify, toast, uniqueId,
} from "../ui";
import { duplicateDialog } from "./catalog";
import { historyPanel, usagePanel } from "./editorParts";

// ------------------------------------------------------------------ réglages d'affichage par kit

const GROUPS: Record<string, { title: string; slots: string[] }[]> = {
  building: [{ title: "Structure", slots: ["base"] }, { title: "Toiture", slots: ["roof", "rooftop"] }, { title: "Ouvertures", slots: ["ground", "windows", "door", "balcony"] },
    { title: "Façade", slots: ["awning", "sign", "wall_extra"] }, { title: "Abords", slots: ["front", "greenery"] }],
  vehicle: [{ title: "Carrosserie", slots: ["base"] }, { title: "Roues", slots: ["wheels"] }, { title: "Livrée", slots: ["livery", "decal"] },
    { title: "Équipements", slots: ["lights", "bumper", "rear"] }, { title: "Toit", slots: ["roof", "cargo"] }],
  vegetation: [{ title: "Tronc", slots: ["base"] }, { title: "Feuillage", slots: ["canopy", "blossom"] }, { title: "Pied", slots: ["planter", "ground_cover"] }],
  street: [{ title: "Structure", slots: ["base"] }, { title: "Tête et toit", slots: ["head", "canopy"] }, { title: "Assise", slots: ["seat"] },
    { title: "Étal", slots: ["goods"] }, { title: "Accessoires", slots: ["attachment", "ground"] }],
  furniture: [{ title: "Structure", slots: ["base"] }, { title: "Pieds", slots: ["legs"] }, { title: "Garnissage", slots: ["cushion", "bedding", "throw"] },
    { title: "Façade", slots: ["handles"] }, { title: "Objets", slots: ["top_item"] }],
  surface: [{ title: "Revêtement", slots: ["base"] }, { title: "Détails", slots: ["details", "marking"] }, { title: "Bordure", slots: ["edging"] }],
};
// cadrage des vignettes, en coordonnées de référence (décalé avec la pièce quand la base la place ailleurs)
const CROP: Record<string, Record<string, number[]>> = {
  building: { roof: [0, 145, 200, 85], rooftop: [20, 130, 160, 85], ground: [20, 222, 160, 55], windows: [24, 160, 152, 50], door: [64, 222, 72, 52],
    balcony: [24, 176, 152, 40], wall_extra: [60, 205, 140, 70], awning: [16, 214, 168, 40], sign: [40, 204, 156, 32], front: [0, 226, 200, 54], greenery: [0, 170, 200, 110] },
  vehicle: { wheels: [36, 90, 52, 52], livery: [30, 88, 180, 32], decal: [116, 88, 36, 32], bumper: [196, 84, 40, 44], rear: [0, 30, 48, 100],
    lights: [196, 84, 36, 36], roof: [70, 36, 100, 32], cargo: [70, 16, 100, 48] },
  vegetation: { planter: [30, 170, 100, 50], ground_cover: [30, 180, 100, 40] },
  street: { head: [36, 0, 104, 64], canopy: [0, 10, 160, 70], seat: [10, 130, 140, 50], goods: [10, 120, 140, 50], attachment: [56, 96, 64, 56], ground: [100, 170, 60, 50] },
  furniture: { legs: [40, 120, 40, 40], cushion: [70, 64, 60, 56], throw: [90, 88, 60, 56], handles: [86, 106, 28, 28], top_item: [60, 36, 80, 60] },
};
const DEFAULT_CATEGORY: Record<string, string> = { building: "residential", vehicle: "vehicles", vegetation: "vegetation", street: "urban_furniture", furniture: "furniture_home", surface: "paving" };
const BACKGROUNDS: Record<string, string> = { clair: "#eef3f1", rue: "#9fb08a", sable: "#e6d3a3", nuit: "#1d2a3a", mur: "#e9d7ad" };
const NAMES: Record<string, string> = { primary: "Couleur principale", secondary: "Couleur secondaire", accent: "Couleur d'accent" };
const kitLib = (kit: string) => [...ctx.kitParts.values()].filter((p) => p.kit === kit && !p.archived);
const baseLevels = (b?: PartPayload) => ((b?.props?.anchors?.floors ?? []) as unknown[]).length + 1;
const thumbCache = new Map<string, string>();

/** Vignette d'une pièce posée sur une base « fantôme » où elle s'accroche, cadrée sur son emplacement. */
function partThumb(part: PartPayload, kit: KitSpec, kitKey: string, current?: PartPayload, colors?: Record<string, string>): HTMLImageElement {
  const lib = kitLib(kitKey);
  const ghost = part.slot === "base" || part.slot === "pattern" ? null
    : (current && fitsBase(part, current) ? current : lib.find((b) => b.slot === "base" && fitsBase(part, b))) ?? null;
  const crop = CROP[kitKey]?.[part.slot];
  let vb: string | undefined;
  if (crop && ghost) {
    const [dx, dy] = placements(part, ghost, kit)[0] ?? [0, 0];
    vb = [crop[0] + dx, crop[1] + dy, crop[2], crop[3]].join(" ");
  }
  const key = `${part.id}@${part.version}|${ghost?.id ?? ""}|${vb ?? ""}|${JSON.stringify(colors ?? {})}`;
  let url = thumbCache.get(key);
  if (!url) { url = svgDataUrl(composeKitPart(part, kit, { ghostBase: ghost, colors, viewBox: vb })); thumbCache.set(key, url); }
  return h("img", { src: url, alt: part.name, loading: "lazy" });
}

function modularOf(a: { preview?: AssetDefinition; definition?: AssetDefinition }): ModularProps | null {
  const d = a.definition ?? a.preview;
  return d?.representation === "modular" ? d.properties?.modular ?? null : null;
}

async function kitAssets(kitKey: string): Promise<AssetSummary[]> {
  const kit = kitSpec(kitKey)!;
  const all = await api.assets({ family: kit.family });
  return all.filter((a) => modularOf(a)?.kit === kitKey);
}

function assemblySvg(m: ModularProps, kit: KitSpec, opts: { variant?: Variant | null; background?: string; idPrefix?: string } = {}): string {
  return composeKit(m, kitPartsRecord(), kit, { variant: opts.variant, background: opts.background, idPrefix: opts.idPrefix ?? "m" }).svg;
}

// ------------------------------------------------------------------ accueil des ateliers

export async function kitsView(root: HTMLElement) {
  await refreshKitParts();
  const kits = Object.entries(ctx.tax!.kits);
  const lib = [...ctx.kitParts.values()];
  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Ateliers modulaires"),
      h("p", { class: "lede" }, "Chaque élément de la ville se compose comme un habitant : une base et des composants indépendants (toiture, porte, roues, feuillage, coussins, bordure…). "
        + `Aucune combinaison n'est dessinée : ${lib.length} composants dans ${kits.length} kits.`)),
      h("div", { class: "row" }, h("a", { class: "btn", href: "#/modulaire/composants" }, "Tous les composants"), h("a", { class: "btn", href: "#/personnages" }, "Atelier de personnages"))),
    h("div", { class: "kit-cards" }, kits.map(([key, kit]) => {
      const m = randomAssembly(lib, key, kit, seeded(key.length * 97 + 11));
      const combos = countCombinations(lib, key, kit);
      return h("a", { class: "kit-card", href: `#/modulaire/${key}`, "data-kit": key },
        h("div", { class: `kit-card-art${kit.view === "top" ? " top" : ""}` }, m ? svgImage(assemblySvg(m, kit, { idPrefix: `c${key}` }), "") : null),
        h("strong", {}, kit.label), h("span", { class: "small muted" }, kit.description),
        h("span", { class: "small" }, `${lib.filter((p) => p.kit === key).length} composants · ${combos.total.toLocaleString("fr-FR")} silhouettes`));
    })));
}

// ------------------------------------------------------------------ page d'un kit

export async function kitView(root: HTMLElement, kitKey: string) {
  const kit = kitSpec(kitKey);
  if (!kit) return fill(root, emptyState("Kit inconnu.", h("a", { class: "btn", href: "#/modulaire" }, "Ateliers modulaires")));
  await refreshKitParts();
  const assets = await kitAssets(kitKey);
  const lib = kitLib(kitKey);
  const combos = countCombinations(lib, kitKey, kit);
  const counts = Object.entries(kit.slots).map(([s, sp]) => h("span", { class: "count" }, h("b", {}, String(lib.filter((p) => p.slot === s).length)), sp.label));
  const street = h("div", {});
  const tests = h("div", {});
  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, kit.label),
      h("p", { class: "lede" }, `${kit.description} Repère ${kit.frame.join(" ")}, ${kit.view === "top" ? "vue de dessus" : "vue de face"}.`)),
      h("div", { class: "row" },
        h("a", { class: "btn", href: "#/modulaire" }, "Tous les kits"),
        h("a", { class: "btn", href: `#/modulaire/${kitKey}/composants` }, "Bibliothèque de composants"),
        can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => newModular(kitKey) }, "Nouvel élément") : null)),
    h("div", { class: "counts" }, counts),
    h("section", { class: "panel" }, h("h2", {}, `Éléments assemblés (${assets.length})`),
      assets.length ? h("div", { class: "char-cards kit-assets" }, assets.map((a) => h("button", { class: "char-card", onclick: () => go(`#/modulaire/${kitKey}/${a.id}`), "data-asset": a.technical_name },
        svgImage(assemblySvg(modularOf(a)!, kit, { background: "#eef3f1", idPrefix: `a${a.technical_name.replace(/[^a-z0-9]/g, "")}` }), a.name),
        h("strong", {}, a.name), h("span", { class: "small muted" }, a.subcategory ?? ""), pill(a.status),
        a.variants ? h("span", { class: "small muted" }, `${a.variants} variante(s)`) : null)))
        : emptyState("Aucun élément assemblé avec ce kit.", can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => newModular(kitKey) }, "Créer le premier") : null)),
    street,
    h("section", { class: "panel" }, h("h2", {}, "Combinaisons possibles"),
      h("p", {}, h("span", { class: "big" }, combos.total.toLocaleString("fr-FR")), " ", h("span", { class: "muted" }, "silhouettes, avant couleurs et motifs.")),
      h("p", { class: "small muted" }, combos.bases.map((b) => `${b.name} : ${b.count.toLocaleString("fr-FR")}`).join(" · ")),
      h("p", { class: "small muted" }, "Calcul : pour chaque base, produit du nombre de choix par emplacement (« aucun » compris pour un emplacement facultatif), "
        + "seulement parmi les composants qui s'accrochent à cette base. Les incompatibilités entre composants ne sont pas retranchées.")),
    tests);
  kitStreet(street, kitKey, kit);
  runLibraryTests(tests, kitKey, kit);
}

/** Rue de test : assemblages tirés au sort, aux tailles d'une fiche (96 px) et de la ville (40 px). */
function kitStreet(host: HTMLElement, kitKey: string, kit: KitSpec) {
  let seed = Math.floor(Math.random() * 100000), n = kitKey === "building" ? 10 : 14, onlyPublished = true;
  let bg = kitKey === "furniture" ? "mur" : kitKey === "surface" ? "clair" : "rue";
  let crowd: (ModularProps | null)[] = [];
  const picked = new Set<number>();
  const grid = h("div", {});
  const count = h("input", { type: "number", min: 2, max: 40, value: n, class: "num", "aria-label": "Nombre d'éléments" }) as HTMLInputElement;
  const pub = h("input", { type: "checkbox", checked: onlyPublished }) as HTMLInputElement;
  const bgSel = h("select", { "aria-label": "Fond" }, Object.keys(BACKGROUNDS).map((k) => h("option", { value: k, selected: k === bg }, k))) as HTMLSelectElement;
  const gen = () => {
    const lib = kitLib(kitKey).filter((p) => !onlyPublished || p.published_version);
    const rng = seeded(seed);
    crowd = Array.from({ length: n }, () => randomAssembly(lib, kitKey, kit, rng));
    picked.clear(); draw();
  };
  const draw = () => {
    const color = BACKGROUNDS[bg];
    const svgs = crowd.map((m, i) => (m ? assemblySvg(m, kit, { idPrefix: `s${i}` }) : null));
    fill(grid,
      h("p", { class: "scale-label" }, "96 px — touchez pour sélectionner"),
      h("div", { class: `crowd crowd-large kit-crowd${kit.view === "top" ? " top" : ""}`, style: { background: color } }, svgs.map((s, i) => s ? h("button", {
        class: `crowd-pick${picked.has(i) ? " on" : ""}`, "aria-pressed": String(picked.has(i)), onclick: () => { if (picked.has(i)) picked.delete(i); else picked.add(i); draw(); } },
      svgImage(s, `Élément ${i + 1}`)) : null)),
      h("p", { class: "scale-label" }, "40 px"),
      h("div", { class: `crowd crowd-small kit-crowd${kit.view === "top" ? " top" : ""}`, style: { background: color } }, svgs.map((s) => (s ? svgImage(s, "") : null))),
      h("p", { class: "muted" }, `${new Set(crowd.filter(Boolean).map((c) => JSON.stringify([c!.base, Object.values(c!.layers).map((l) => l?.part)]))).size} silhouettes distinctes, toutes conformes aux règles des composants.`));
  };
  count.addEventListener("change", () => { n = Math.max(2, Math.min(40, Number(count.value))); gen(); });
  pub.addEventListener("change", () => { onlyPublished = pub.checked; gen(); });
  bgSel.addEventListener("change", () => { bg = bgSel.value; draw(); });
  fill(host, h("section", { class: "panel" },
    h("div", { class: "sec-head" }, h("div", {}, h("h2", {}, kit.view === "top" ? "Mosaïque de test" : "Rue de test"),
      h("p", { class: "muted" }, "Test de lisibilité : éléments générés au hasard parmi les combinaisons compatibles, sans aucun dessin supplémentaire.")),
      h("div", { class: "filters" }, field("Nombre", count), h("label", { class: "toggle" }, pub, "Composants publiés seulement"), field("Fond", bgSel),
        h("button", { class: "btn", onclick: () => { seed = Math.floor(Math.random() * 100000); gen(); } }, "Nouvelle rue"),
        can("asset.create") ? h("button", { class: "btn btn-primary", onclick: async () => {
          if (!picked.size) return toast("Sélectionnez au moins un élément.", "err");
          let ok = 0;
          for (const i of picked) { if (await createModular(kitKey, crowd[i]!, `${kit.label.split(" ")[0]} n°${seed % 1000}-${i + 1}`, false)) ok++; }
          toast(`${ok} élément(s) enregistré(s) en brouillon`); picked.clear(); draw();
        } }, "Enregistrer la sélection") : null)),
    grid));
  gen();
}

/** Contrôles automatiques : règles pures (module compose.ts) + mesures réelles dans le navigateur (cadre, ligne de sol). */
async function runLibraryTests(host: HTMLElement, kitKey: string, kit: KitSpec) {
  const list = h("ul", { class: "tests" }, h("li", {}, h("span", {}, "Exécution…")));
  const sum = h("div", { class: "summary" });
  fill(host, h("section", { class: "panel" }, h("div", { class: "sec-head" }, h("h2", {}, "Tests de la bibliothèque"),
    h("button", { class: "btn", onclick: () => runLibraryTests(host, kitKey, kit) }, "Relancer")), sum, list));
  await new Promise((r) => setTimeout(r, 30));
  const lib = kitLib(kitKey);
  const res: LibCheck[] = [...libraryChecks(lib, kitKey, kit), ...measureParts(lib, kitKey, kit)];
  const ok = res.filter((r) => r.ok).length;
  fill(sum, h("span", { class: "big" }, `${ok} / ${res.length}`), h("span", { class: "muted" }, " tests réussis"));
  fill(list, ...res.map((r) => h("li", { class: r.ok ? "ok" : "ko" }, h("span", { class: "pill-test" }, r.ok ? "OK" : "ÉCHEC"), h("b", {}, r.name), h("span", {}, r.detail))));
}

function measureParts(lib: PartPayload[], kitKey: string, kit: KitSpec): LibCheck[] {
  const sandbox = h("div", { "aria-hidden": "true", style: { position: "absolute", left: "-10000px", top: "0", visibility: "hidden" } });
  document.body.append(sandbox);
  const [fx, fy, fw, fh] = kit.frame;
  const out: LibCheck[] = [];
  try {
    const bases = lib.filter((p) => p.slot === "base");
    const outside: string[] = [], floating: string[] = [];
    let measured = 0;
    for (const part of lib) {
      if (part.slot === "pattern") continue;
      const hosts = part.slot === "base" ? [part] : bases.filter((b) => fitsBase(part, b));
      for (const b of hosts) {
        // une base est mesurée avec ses emplacements obligatoires et ses pièces posées au sol (roues, pieds)
        const req: Record<string, ModLayer> = {};
        if (part.slot === "base") for (const [s, sp] of Object.entries(kit.slots)) {
          const atGround = !!sp.anchor && kit.anchors[sp.anchor]?.[1] === kit.ground;
          const opt = (sp.required || atGround) && s !== "base" ? lib.find((q) => q.slot === s && fitsBase(q, b)) : null;
          if (opt) req[s] = { part: opt.id };
        }
        const m: ModularProps = { kit: kitKey, base: b.id, layers: part.slot === "base" ? req : { [part.slot]: { part: part.id } } };
        sandbox.innerHTML = composeKit(m, kitPartsRecord(), kit, { idPrefix: "chk" }).svg;
        const g = sandbox.querySelectorAll<SVGGraphicsElement>(`[data-slot="${part.slot}"]`);
        for (const el of g) {
          const bb = el.getBBox(); const ctm = el.transform.baseVal.consolidate()?.matrix;
          const x = bb.x + (ctm?.e ?? 0), y = bb.y + (ctm?.f ?? 0);
          measured++;
          if (bb.width && (x < fx - 0.5 || y < fy - 0.5 || x + bb.width > fx + fw + 0.5 || y + bb.height > fy + fh + 0.5)) outside.push(`${part.name} sur ${b.name}`);
        }
        if (part.slot === "base" && kit.view === "front") {
          const root = sandbox.querySelector<SVGGraphicsElement>("svg > g");
          const bb = root?.getBBox();
          if (bb && Math.abs(bb.y + bb.height - kit.ground) > 8) floating.push(`${part.name} (${(bb.y + bb.height).toFixed(0)})`);
        }
      }
    }
    out.push({ name: "Chaque pièce reste dans le repère, sur chaque base compatible", ok: !outside.length,
      detail: outside.length ? outside.slice(0, 6).join(", ") + (outside.length > 6 ? ` (+${outside.length - 6})` : "") : `${measured} placements mesurés` });
    if (kit.view === "front") out.push({ name: "Chaque base repose sur la ligne de sol", ok: !floating.length, detail: floating.length ? floating.join(", ") : `sol à y = ${kit.ground}` });
  } finally { sandbox.remove(); }
  return out;
}

// ------------------------------------------------------------------ création

async function createModular(kitKey: string, m: ModularProps, name: string, open = true, category?: string): Promise<string | null> {
  const kit = kitSpec(kitKey)!;
  const cat = category ?? DEFAULT_CATEGORY[kitKey];
  const d = templateFor(kit.family, cat);
  d.name = name; d.representation = "modular"; d.tags = ["modulaire"];
  d.properties = { ...d.properties, modular: m };
  if (kit.family === "building") {
    const levels = baseLevels(ctx.kitParts.get(m.base));
    d.properties.floors = levels; d.height_m = Math.round((levels * 3 + 1.5) * 10) / 10;
    d.properties.ownership = "npc"; d.properties.assignable_to_player = false;
  }
  try {
    const a = await api.create(cat, `${slugify(name)}-${Date.now().toString(36).slice(-4)}`, d);
    if (open) { toast("Brouillon créé"); go(`#/modulaire/${kitKey}/${a.id}`); }
    return a.id;
  } catch (e) { toast((e as Error).message, "err"); return null; }
}

function newModular(kitKey: string) {
  const kit = kitSpec(kitKey)!;
  const cats = ctx.tax!.categories.filter((c) => c.family === kit.family && !c.archived);
  const name = h("input", { value: `Nouvel élément — ${kit.label.toLowerCase()}` }) as HTMLInputElement;
  const cat = h("select", {}, cats.map((c) => h("option", { value: c.key, selected: c.key === DEFAULT_CATEGORY[kitKey] }, c.label))) as HTMLSelectElement;
  const close = modal("Nouvel élément assemblé", h("div", { class: "fields" }, h("label", {}, "Nom", name), h("label", {}, "Catégorie", cat),
    h("p", { class: "muted" }, "L'élément part d'un assemblage tiré au sort parmi les combinaisons compatibles ; chaque partie se change ensuite indépendamment.")), [
    { label: "Créer", run: async () => {
      const lib = kitLib(kitKey);
      const m = randomAssembly(lib.filter((p) => p.published_version), kitKey, kit, seeded(Date.now() % 99991)) ?? randomAssembly(lib, kitKey, kit, seeded(7));
      if (!m) return toast("Ce kit n'a encore aucune base : importez d'abord un composant « Base ».", "err");
      close(); await createModular(kitKey, m, name.value.trim() || "Nouvel élément", true, cat.value);
    } }]);
}

// ------------------------------------------------------------------ studio d'un élément

export async function kitStudio(root: HTMLElement, kitKey: string, id: string): Promise<() => void> {
  await refreshKitParts();
  let asset: AssetDetail = await api.asset(id);
  const m0 = modularOf(asset);
  if (!m0) { go(`#/asset/${id}`); return () => {}; }
  if (m0.kit !== kitKey) { go(`#/modulaire/${m0.kit}/${id}`); return () => {}; }
  const kit = kitSpec(kitKey)!;
  let def = structuredClone(asset.definition);
  let dirty = false;
  let editing = "";                       // "" = assemblage de base, sinon identifiant de variante
  let tab = "base";
  let bg = kitKey === "furniture" ? "mur" : "clair";
  let view: "face" | "rue" | "iso" = "face";
  let game: any = null;
  const groups = GROUPS[kitKey] ?? [{ title: "Base", slots: ["base"] }, ...Object.keys(kit.slots).filter((s) => s !== "base" && s !== "pattern").map((s) => ({ title: kit.slots[s].label, slots: [s] }))];

  const editable = () => asset.versions[asset.versions.length - 1].status === "draft" && !asset.archived && can("asset.edit");
  const mod = () => def.properties.modular as ModularProps;
  const variant = (): Variant | null => def.variants.find((v: Variant) => v.id === editing) ?? null;
  const eff = () => effectiveModular(mod(), variant());
  const lib = () => kitLib(kitKey);
  const base = () => ctx.kitParts.get(mod().base);

  const head = h("header", { class: "ed-head" });
  const banner = h("div", { class: "ed-banner" });
  const previewBar = h("div", { class: "bar-row" });
  const preview = h("div", { class: "char-preview" });
  const issues = h("div", { class: "panel" });
  const side = h("div", { class: "ed-side" });
  const tabs = h("nav", { class: "kit-tabs", role: "tablist", "aria-label": "Parties de l'élément" });
  const controls = h("div", { class: "char-controls", role: "tabpanel" });
  fill(root, h("div", { class: "editor" }, head, banner,
    h("div", { class: "char-body" },
      h("section", { class: "char-stage", "aria-label": "Aperçu de l'élément" }, previewBar, preview, issues, side),
      h("section", { class: "kit-panel", "aria-label": "Personnalisation" }, tabs, controls))));

  function changed() { dirty = true; renderHead(); renderPreview(); renderIssues(); renderControls(); }

  // --------------------------------------------------- écriture dans l'assemblage de base ou dans la variante
  function setLayer(slot: string, layer: ModLayer | null) {
    const v = variant();
    if (v) {
      v.props.layers ??= {};
      if (layer === null) { if (mod().layers[slot]) v.props.layers[slot] = null; else delete v.props.layers[slot]; }
      else v.props.layers[slot] = layer;
    } else if (layer === null) delete mod().layers[slot]; else mod().layers[slot] = layer;
    changed();
  }
  function setColor(group: "colors" | "base_colors", key: string, value: string) {
    const v = variant();
    if (v) { v.props[group] = { ...(v.props[group] ?? {}), [key]: value }; }
    else mod()[group] = { ...(mod()[group] ?? {}), [key]: value };
    changed();
  }
  function setBase(id: string) {
    mod().base = id;
    // un composant qui ne s'accroche plus à la nouvelle base est retiré (sinon l'assemblage serait signalé incompatible)
    const b = ctx.kitParts.get(id)!;
    for (const [slot, layer] of Object.entries(mod().layers)) { const p = layer && ctx.kitParts.get(layer.part); if (p && !fitsBase(p, b)) delete mod().layers[slot]; }
    if (kit.family === "building") { const lv = baseLevels(b); def.properties.floors = lv; def.height_m = Math.round((lv * 3 + 1.5) * 10) / 10; }
    changed();
  }

  // --------------------------------------------------- en-tête et cycle de vie
  function renderHead() {
    const latest = asset.versions[asset.versions.length - 1];
    const acts: HTMLElement[] = [];
    const btn = (l: string, run: () => void, kind = "btn") => h("button", { class: kind, onclick: run }, l);
    if (editable()) { acts.push(btn(dirty ? "Enregistrer le brouillon" : "Brouillon enregistré", save, dirty ? "btn btn-primary" : "btn")); acts.push(btn("Soumettre à validation", () => act("submit"))); }
    if (latest.status === "in_review" && can("asset.validate")) { acts.push(btn("Approuver", () => act("approve"), "btn btn-primary")); acts.push(btn("Renvoyer en brouillon", () => act("reject"))); }
    if (latest.status === "validated" && can("asset.publish")) acts.push(btn("Publier", () => act("publish"), "btn btn-primary"));
    if (["published", "validated", "superseded"].includes(latest.status) && can("asset.edit") && !asset.archived) acts.push(btn("Créer une nouvelle version", async () => {
      try { asset = await api.newDraft(id); def = structuredClone(asset.definition); toast(`Version ${asset.latest_version} en brouillon`); rerender(); } catch (e) { fail(e); }
    }));
    if (can("asset.create")) acts.push(btn("Dupliquer", () => duplicateDialog({ ...asset })));
    acts.push(h("a", { class: "btn", href: `#/asset/${id}` }, "Propriétés de l'élément"));
    if (can("asset.archive")) acts.push(asset.archived ? btn("Restaurer", () => act("restore")) : btn("Archiver", () => act("archive"), "btn btn-quiet"));
    const name = h("input", { value: def.name, class: "title-input", disabled: !editable(), "aria-label": "Nom de l'élément" }) as HTMLInputElement;
    name.addEventListener("change", () => { def.name = name.value; dirty = true; renderHead(); });
    fill(head, h("div", { class: "ed-title" },
      h("button", { class: "back", onclick: () => go(`#/modulaire/${kitKey}`), "aria-label": "Retour" }, "‹"),
      h("div", {}, name, h("p", { class: "meta" }, pill(asset.status), ` v${asset.latest_version}`, asset.published_version ? ` (publiée : v${asset.published_version})` : "",
        " · ", h("code", {}, asset.technical_name), ` · ${kit.label}`))),
      h("div", { class: "ed-actions" }, acts));
    fill(banner);
    if (!editable()) banner.append(h("p", {}, asset.archived ? "Élément archivé." : latest.status === "published" ? "Version publiée et figée : ses composants exacts sont figés aussi. Créez une nouvelle version pour la modifier." : "Lecture seule."));
    banner.hidden = !banner.childElementCount;
  }
  async function save() {
    try {
      asset = await api.saveDraft(id, def); def = structuredClone(asset.definition); dirty = false;
      toast(asset.validation?.ok ? "Brouillon enregistré" : `Enregistré avec ${asset.validation?.errors} erreur(s)`, asset.validation?.ok ? "ok" : "err");
      rerender();
    } catch (e) { fail(e); }
  }
  async function act(a: AssetAction) {
    if (dirty && a === "submit") await save();
    try { asset = await api.action(id, a); def = structuredClone(asset.definition); toast({ submit: "Soumis", approve: "Approuvé", reject: "Renvoyé en brouillon", publish: "Publié", archive: "Archivé", restore: "Restauré" }[a]); rerender(); }
    catch (e) { fail(e); }
  }
  function fail(e: unknown) {
    toast((e as Error).message, "err");
    if (e instanceof ApiError && e.report) { asset = { ...asset, validation: e.report }; renderIssues(); }
  }

  // --------------------------------------------------- aperçu
  function renderPreview() {
    if (game) { game.destroy(true); game = null; }
    fill(previewBar,
      h("div", { class: "seg", role: "group", "aria-label": "Vue" }, ([["face", kit.view === "top" ? "Vue de dessus" : "Vue de face"], ["rue", "En situation"], ["iso", "Vue isométrique"]] as const)
        .map(([k, l]) => h("button", { class: view === k ? "on" : "", onclick: () => { view = k; renderPreview(); } }, l))),
      h("select", { "aria-label": "Fond", onchange: (e: Event) => { bg = (e.target as HTMLSelectElement).value; renderPreview(); } },
        Object.keys(BACKGROUNDS).map((k) => h("option", { value: k, selected: k === bg }, `Fond ${k}`))),
      def.variants.length ? h("select", { "aria-label": "Variante affichée et modifiée", onchange: (e: Event) => { editing = (e.target as HTMLSelectElement).value; renderPreview(); renderIssues(); renderControls(); } },
        h("option", { value: "" }, "Assemblage de base"), def.variants.map((v: Variant) => h("option", { value: v.id, selected: v.id === editing }, `Variante : ${v.name}`))) : null,
      h("button", { class: "btn btn-small", onclick: () => copy(assemblySvg(mod(), kit, { variant: variant(), idPrefix: slugify(asset.technical_name).replace(/-/g, "") || "babi" }), "SVG copié dans le presse-papiers.") }, "Copier le SVG"));
    const color = BACKGROUNDS[bg];
    const svg = assemblySvg(mod(), kit, { variant: variant() });
    if (view === "face") fill(preview, h("div", { class: `char-big kit-big${kit.view === "top" ? " top" : ""}`, style: { background: color } }, svgImage(svg, def.name)));
    else if (view === "rue") {
      const others = lib().length ? Array.from({ length: 5 }, (_, i) => randomAssembly(lib().filter((p) => p.published_version), kitKey, kit, seeded(31 + i))).filter(Boolean) as ModularProps[] : [];
      const row_ = (cls: string, label: string) => h("div", { class: `situ-row ${cls}` }, h("span", { class: "small" }, label), svgImage(svg, def.name),
        ...others.map((o, i) => svgImage(assemblySvg(o, kit, { idPrefix: `o${i}` }), "")));
      fill(preview, h("div", { class: `char-situ kit-situ${kit.view === "top" ? " top" : ""}`, style: { background: color } }, row_("", "96 px"), row_("small-row", "40 px"),
        h("p", { class: "small muted" }, "Côte à côte avec des éléments tirés au sort, aux tailles d'une fiche et de la ville.")));
    } else {
      const host = h("div", { class: "stage stage-char" });
      fill(preview, host);
      const sc = new PreviewScene();
      sc.state = { family: kit.family, def, rotation: 0, variant: variant(), furniture: {}, background: parseInt(color.slice(1), 16),
        flags: { grid: true, footprint: true, collision: false, entrances: kit.family === "building", connectors: false, zones: false, dims: false } };
      game = mountGame(host, sc);
    }
  }

  function renderIssues() {
    const local = checkAssembly(eff(), kitPartsRecord(), kit, kitKey);
    fill(issues, h("h2", {}, "Compatibilité"),
      local.length ? h("ul", { class: "report" }, local.map((i) => h("li", { class: `rep-${i.level}` }, h("strong", {}, kitSlotLabel(kitKey, i.slot)), " ", i.message)))
        : h("p", { class: "report-ok" }, `Assemblage ${editing ? `« ${variant()?.name} »` : "de base"} compatible.`),
      h("h3", {}, "Rapport du serveur (dernier enregistrement)"), reportView(asset.validation));
  }

  // --------------------------------------------------- commandes
  function swatches(current: string, palette: string[], onPick: (c: string) => void, free = true): HTMLElement {
    const dis = !editable();
    const custom = h("input", { type: "color", value: current, disabled: dis, "aria-label": "Couleur personnalisée" }) as HTMLInputElement;
    custom.addEventListener("change", () => onPick(custom.value));
    return h("div", { class: "swatch-row" }, palette.map((c) => h("button", { class: `sw${c.toLowerCase() === current.toLowerCase() ? " on" : ""}`, style: { background: c }, disabled: dis, title: c, "aria-label": `Couleur ${c}`, onclick: () => onPick(c) })),
      free ? custom : null);
  }

  function colorControls(part: PartPayload, colors: Record<string, string> | undefined, pattern: ModPattern | null | undefined, slot: string,
    onColor: (ch: string, c: string) => void, onPattern: (p: ModPattern | null) => void): HTMLElement {
    const box = h("div", { class: "layer-colors" });
    const chans = (["primary", "secondary", "accent"] as const).filter((c) => c in (part.channels ?? {}));
    const pal = KIT_PALETTES[kitKey];
    const offer = [...new Set([...(pal?.base ?? []), ...(pal?.layer ?? [])])];
    if (!chans.length) box.append(h("p", { class: "small muted" }, "Couleurs réglées par les couleurs partagées du kit, ou fixes."));
    for (const ch of chans) {
      const allowed: string[] = part.props?.palette?.[ch] ?? [];
      const cur = colors?.[ch] ?? part.props?.default_colors?.[ch] ?? part.channels[ch];
      box.append(h("div", { class: "field" }, h("span", {}, NAMES[ch], allowed.length ? h("small", {}, " (palette imposée)") : null),
        swatches(cur, allowed.length ? allowed : offer.length ? offer : [cur], (c) => onColor(ch, c), !allowed.length)));
    }
    if (kit.pattern_slots.includes(slot) && chans.includes("primary")) {
      const patterns = lib().filter((p) => p.slot === "pattern");
      if (patterns.length) {
        const sel = h("select", { disabled: !editable(), "aria-label": "Motif" }, h("option", { value: "" }, "Sans motif"),
          patterns.map((p) => h("option", { value: p.id, selected: pattern?.part === p.id }, p.name))) as HTMLSelectElement;
        sel.addEventListener("change", () => onPattern(sel.value ? { part: sel.value, colors: {}, channel: "primary", scale: 1 } : null));
        const fieldBox = h("div", { class: "field" }, h("span", {}, "Motif"), sel);
        const pp = pattern ? ctx.kitParts.get(pattern.part) : null;
        if (pattern && pp) {
          fieldBox.append(h("div", { class: "pattern-prev" }, svgImage(composeKitPart(pp, kit, { colors: pattern.colors }), pp.name)));
          for (const ch of Object.keys(pp.channels ?? {}).filter((c) => c in NAMES)) {
            const cur = pattern.colors?.[ch] ?? pp.props?.default_colors?.[ch] ?? pp.channels[ch];
            fieldBox.append(h("small", {}, `Motif — ${NAMES[ch]}`), swatches(cur, offer.length ? offer : [cur], (c) => onPattern({ ...pattern, colors: { ...(pattern.colors ?? {}), [ch]: c } })));
          }
          const sc = h("input", { type: "range", min: 0.5, max: 2.5, step: 0.25, value: pattern.scale ?? 1, disabled: !editable(), "aria-label": "Taille du motif" }) as HTMLInputElement;
          sc.addEventListener("change", () => onPattern({ ...pattern, scale: Number(sc.value) }));
          fieldBox.append(field("Taille du motif", sc));
        }
        box.append(fieldBox);
      }
    }
    return box;
  }

  function basePicker(): HTMLElement {
    const e = eff();
    const dis = !editable();
    const b = base();
    const tiles = h("div", { class: "part-tiles" }, lib().filter((p) => p.slot === "base").map((p) => h("button", {
      class: `part-tile${e.base === p.id ? " on" : ""}`, disabled: dis || !!editing, title: editing ? "La base se choisit sur l'assemblage de base" : p.name, "data-part": p.technical_name,
      onclick: () => setBase(p.id) }, partThumb(p, kit, kitKey), h("span", {}, p.name), p.published_version ? null : h("span", { class: "tag" }, "brouillon"))));
    const pal = KIT_PALETTES[kitKey];
    const globals = Object.entries(kit.globals).map(([g, spec]) => h("div", { class: "field" }, h("span", {}, `${spec.label} (couleur partagée)`),
      swatches(e.colors?.[g] ?? spec.default, pal?.globals[g]?.length ? pal.globals[g] : [spec.default], (c) => setColor("colors", g, c))));
    return h("div", { class: "slot", "data-slot": "base" }, h("h3", {}, kit.slots.base.label), tiles,
      kit.family === "building" && b ? h("p", { class: "small muted" }, `${baseLevels(b)} niveau(x) : le nombre d'étages du bâtiment suit la structure.`) : null,
      b ? colorControls(b, e.base_colors, e.base_pattern, "base", (ch, c) => setColor("base_colors", ch, c), (p) => { if (variant()) return toast("Le motif de la base se règle sur l'assemblage de base.", "err"); mod().base_pattern = p; changed(); }) : null,
      ...globals);
  }

  function slotPicker(slot: string): HTMLElement {
    const e = eff();
    const cur = e.layers[slot] ?? null;
    const b = base();
    const options = lib().filter((p) => p.slot === slot);
    const parts = kitPartsRecord();
    const reason = (p: PartPayload): string | null => {
      const trial = structuredClone(e); trial.layers[slot] = { part: p.id, colors: {} };
      const iss = checkAssembly(trial, parts, kit, kitKey).filter((i) => i.level === "error" && !i.message.startsWith("Emplacement obligatoire"));
      return iss.length ? iss[0].message : null;
    };
    const dis = !editable();
    const required = kit.slots[slot]?.required;
    const tiles = h("div", { class: "part-tiles", role: "listbox", "aria-label": kitSlotLabel(kitKey, slot) },
      required ? null : h("button", { class: `part-tile${!cur ? " on" : ""}`, disabled: dis, onclick: () => setLayer(slot, null), role: "option", "aria-selected": String(!cur) }, h("span", { class: "none" }, "Aucun")),
      options.map((p) => {
        const why = reason(p);
        return h("button", { class: `part-tile${cur?.part === p.id ? " on" : ""}${why ? " incompat" : ""}`, disabled: dis, title: why ? `Incompatible : ${why}` : p.name,
          role: "option", "aria-selected": String(cur?.part === p.id), "data-part": p.technical_name,
          onclick: () => {
            if (why && !confirm(`${why}\nChoisir quand même ? L'assemblage sera signalé incompatible.`)) return;
            setLayer(slot, { part: p.id, colors: cur?.part === p.id ? cur.colors ?? {} : {}, pattern: cur?.part === p.id ? cur.pattern ?? null : null });
          } }, partThumb(p, kit, kitKey, b), h("span", {}, p.name), p.published_version ? null : h("span", { class: "tag" }, "brouillon"));
      }));
    const out = h("div", { class: "slot", "data-slot": slot }, h("h3", {}, kitSlotLabel(kitKey, slot)),
      options.length ? tiles : h("p", { class: "muted small" }, "Aucun composant de ce type dans la bibliothèque."));
    const part = cur ? ctx.kitParts.get(cur.part) : null;
    if (cur && part) out.append(colorControls(part, cur.colors, cur.pattern, slot,
      (ch, c) => setLayer(slot, { ...cur, colors: { ...(cur.colors ?? {}), [ch]: c } }), (p) => setLayer(slot, { ...cur, pattern: p })));
    return out;
  }

  function variantsPanel(): HTMLElement {
    const dis = !editable();
    return h("div", { class: "sec-body" },
      h("p", { class: "muted" }, "Une variante (préréglage) ne stocke que les composants et couleurs qui diffèrent de l'assemblage de base. Choisissez la variante à modifier dans la barre de l'aperçu."),
      def.variants.length ? h("ul", { class: "list" }, def.variants.map((v: Variant, i: number) => h("li", { class: "row" },
        h("button", { class: `btn btn-small${editing === v.id ? " btn-primary" : ""}`, onclick: () => { editing = editing === v.id ? "" : v.id; renderPreview(); renderIssues(); renderControls(); } }, editing === v.id ? `Modification : ${v.name}` : v.name),
        h("span", { class: "small muted" }, `${Object.keys(v.props.layers ?? {}).length} composant(s), ${Object.keys({ ...(v.props.colors ?? {}), ...(v.props.base_colors ?? {}) }).length} couleur(s) modifiés`),
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => { const c = structuredClone(v); c.id = uniqueId(def.variants, "variante"); c.name = `${v.name} (copie)`; def.variants.push(c); changed(); } }, "Dupliquer"),
        h("button", { class: "icon-btn", disabled: dis, "aria-label": "Supprimer la variante", onclick: () => { def.variants.splice(i, 1); if (editing === v.id) editing = ""; changed(); } }, "×"))))
        : h("p", { class: "small muted" }, "Aucune variante enregistrée."),
      h("div", { class: "row" },
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => {
          const name = prompt("Nom de la nouvelle variante", "Couleurs du quartier"); if (!name) return;
          const v: Variant = { id: uniqueId(def.variants, slugify(name).slice(0, 30) || "variante"), name, materials: {}, props: { layers: {} } };
          def.variants.push(v); editing = v.id; changed();
        } }, "Nouvelle variante"),
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => {
          const r = randomAssembly(lib().filter((p) => p.published_version), kitKey, kit, seeded(Date.now() % 99991), { base: mod().base });
          if (!r) return toast("Aucun assemblage compatible trouvé pour cette base.", "err");
          if (variant()) { const v = variant()!; v.props.layers = { ...r.layers }; v.props.colors = r.colors; v.props.base_colors = r.base_colors; }
          else { mod().layers = r.layers; mod().colors = r.colors; mod().base_colors = r.base_colors; mod().base_pattern = r.base_pattern ?? null; }
          changed();
        } }, "Composants au hasard (même base)")));
  }

  function jsonPanel(): HTMLElement {
    const ta = h("textarea", { spellcheck: false, "aria-label": "Configuration JSON de l'assemblage", class: "kit-json" }) as HTMLTextAreaElement;
    ta.value = JSON.stringify(mod(), null, 2);
    const msg = h("p", { class: "small", role: "status" });
    return h("div", { class: "sec-body" },
      h("p", { class: "muted" }, "Le moteur ne lit que des identifiants de composants, des couleurs hexadécimales et des nombres. Le serveur revalide tout à l'enregistrement."),
      ta, msg,
      h("div", { class: "row" },
        h("button", { class: "btn btn-small btn-primary", disabled: !editable(), onclick: () => {
          try {
            const p = JSON.parse(ta.value);
            if (!p || typeof p !== "object" || typeof p.base !== "string" || typeof p.layers !== "object") throw new Error("il faut au moins « base » et « layers »");
            if (p.kit !== kitKey) throw new Error(`« kit » doit valoir « ${kitKey} »`);
            def.properties.modular = p; changed();
            const n = checkAssembly(p, kitPartsRecord(), kit, kitKey).length;
            msg.textContent = n ? `Appliqué avec ${n} remarque(s) : voir « Compatibilité ».` : "Configuration appliquée.";
          } catch (e) { msg.textContent = `JSON refusé : ${(e as Error).message}.`; }
        } }, "Appliquer"),
        h("button", { class: "btn btn-small", onclick: () => copy(ta.value, "JSON copié dans le presse-papiers.") }, "Copier")));
  }

  function renderControls() {
    const sy = controls.scrollTop;
    const all = [...groups.map((g) => ({ key: g.slots.join("+"), title: g.title })), { key: "variantes", title: "Variantes" }, { key: "json", title: "JSON" }];
    if (!all.some((t) => t.key === tab)) tab = all[0].key;
    fill(tabs, all.map((t) => h("button", { role: "tab", "aria-selected": String(t.key === tab), tabindex: t.key === tab ? 0 : -1, "data-tab": t.key,
      onclick: () => { tab = t.key; renderControls(); },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const i = all.findIndex((x) => x.key === tab);
        tab = all[(i + (e.key === "ArrowRight" ? 1 : all.length - 1)) % all.length].key; renderControls();
        (tabs.querySelector(`[data-tab="${tab}"]`) as HTMLElement | null)?.focus();
      } }, t.title)));
    if (tab === "variantes") fill(controls, variantsPanel());
    else if (tab === "json") fill(controls, jsonPanel());
    else fill(controls, ...tab.split("+").filter((s) => s in kit.slots).map((s) => (s === "base" ? basePicker() : slotPicker(s))));
    controls.scrollTop = sy;
  }

  function renderSide() { fill(side, historyPanel(asset, (a) => { asset = a; def = structuredClone(a.definition); dirty = false; rerender(); }), usagePanel(asset)); }
  function rerender() { renderHead(); renderPreview(); renderIssues(); renderControls(); renderSide(); }
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
  window.addEventListener("beforeunload", beforeUnload);
  const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (editable() && dirty) save(); } };
  window.addEventListener("keydown", key);
  rerender();
  return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("keydown", key); if (game) game.destroy(true); };
}

function copy(text: string, ok: string) {
  try { navigator.clipboard.writeText(text).then(() => toast(ok), () => toast("Copie bloquée par le navigateur.", "err")); } catch { toast("Copie bloquée par le navigateur.", "err"); }
}

// ------------------------------------------------------------------ bibliothèque de composants

export async function kitPartsView(root: HTMLElement, kitFilter: string | null) {
  await refreshKitParts();
  const all = (await api.assets({ family: "component" })).filter((a) => !kitFilter || a.preview.properties.kit === kitFilter);
  const kits = ctx.tax!.kits;
  const kitSel = h("select", { "aria-label": "Kit" }, h("option", { value: "" }, "Tous les kits"),
    Object.entries(kits).map(([k, s]) => h("option", { value: k, selected: k === kitFilter }, s.label))) as HTMLSelectElement;
  kitSel.addEventListener("change", () => go(kitSel.value ? `#/modulaire/${kitSel.value}/composants` : "#/modulaire/composants"));
  const groups = new Map<string, AssetSummary[]>();
  for (const a of all) { const k = `${a.preview.properties.kit}|${a.preview.properties.slot}`; groups.set(k, [...(groups.get(k) ?? []), a]); }
  const order = (k: string) => { const [kit, slot] = k.split("|"); return Object.keys(kits).indexOf(kit) * 100 + Object.keys(kits[kit]?.slots ?? {}).indexOf(slot); };
  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, kitFilter ? `Composants — ${kits[kitFilter]?.label ?? kitFilter}` : "Composants modulaires"),
      h("p", { class: "lede" }, "Calques SVG réutilisables par tous les éléments d'un kit. Couleurs par canaux (convention var(--babi-<canal>, défaut)), point d'ancrage sur la base. "
        + "Un composant publié peut être utilisé par un élément publié ; ses versions exactes sont figées à la publication de l'élément.")),
      can("media.upload") && can("asset.create") ? h("a", { class: "btn btn-primary", href: `#/modulaire/${kitFilter ?? "building"}/composants/nouveau` }, "Importer un composant SVG") : null),
    h("div", { class: "filters" }, kitSel, kitFilter ? h("a", { class: "btn", href: `#/modulaire/${kitFilter}` }, "Atelier du kit") : h("a", { class: "btn", href: "#/modulaire" }, "Ateliers modulaires")),
    all.length ? h("div", {}, [...groups.entries()].sort((a, b) => order(a[0]) - order(b[0])).map(([k, list]) => {
      const [kitKey, slot] = k.split("|");
      const kit = kits[kitKey];
      return h("section", { class: "slot-group" }, h("h2", {}, `${kitFilter ? "" : `${kit?.label ?? kitKey} · `}${kitSlotLabel(kitKey, slot)}`),
        h("div", { class: "part-lib" }, list.map((a) => {
          const p = ctx.kitParts.get(a.id);
          return h("button", { class: "part-card", onclick: () => go(`#/modulaire/${kitKey}/composants/${a.id}`), "data-asset": a.technical_name },
            p && kit ? partThumb(p, kit, kitKey) : h("span", { class: "muted" }, a.archived ? "archivé" : "—"), h("span", {}, a.name), pill(a.status));
        })));
    })) : emptyState("Aucun composant."));
}

const CHANNEL_LABEL: Record<string, string> = { "": "Couleur fixe", primary: "Couleur principale", secondary: "Couleur secondaire", accent: "Couleur d'accent" };

async function importKitPart(root: HTMLElement, kitKey: string) {
  const kit = kitSpec(kitKey)!;
  let media: Media | null = null;
  const area = h("div", { class: "import-steps" });
  const file = h("input", { type: "file", accept: ".svg,image/svg+xml", "aria-label": "Fichier SVG" }) as HTMLInputElement;
  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, `Importer un composant — ${kit.label}`),
      h("p", { class: "lede" }, "Le fichier est vérifié et assaini par le serveur (scripts, liens externes, images intégrées et DOCTYPE refusés ou retirés). Seul le SVG nettoyé est conservé."))),
    h("div", { class: "panel" }, h("h2", {}, "1. Choisir le fichier"), field("Fichier SVG depuis cet appareil", file,
      `SVG uniquement · ${ctx.tax!.limits.upload_mb} Mo maximum · idéalement dessiné dans le repère ${kit.frame.join(" ")}${kit.view === "front" ? `, sol à y = ${kit.ground}` : ", vue de dessus"}.`)),
    area);
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    fill(area, h("p", { class: "loading" }, "Vérification par le serveur…"));
    try { media = await api.uploadMedia(f, f.name, { category: "component", name: f.name.replace(/\.svg$/i, "") }); await refreshMedia(); step2(); }
    catch (e) { fill(area, h("div", { class: "panel" }, h("p", { class: "txt-danger" }, (e as Error).message))); }
  });
  async function step2() {
    const m = media!;
    const svg = (await api.mediaSvg(m.id)).svg;
    const vb = m.meta.view_box ?? [];
    const frameOk = vb.map(Math.round).join(" ") === kit.frame.join(" ");
    const colors = Object.keys(m.meta.colors ?? {});
    const chans = Object.keys(m.meta.channels ?? {});
    const labels: Record<string, string> = { ...CHANNEL_LABEL, ...Object.fromEntries(Object.entries(kit.globals).map(([g, s]) => [g, `${s.label} (partagée)`])) };
    const map: Record<string, string> = {};
    const mapping = h("div", { class: "table" }, colors.map((c) => {
      const s = h("select", { "aria-label": `Canal pour ${c}` }, Object.entries(labels).map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
      s.addEventListener("change", () => { if (s.value) map[c] = s.value; else delete map[c]; });
      return h("div", { class: "trow" }, h("span", { class: "sw", style: { background: c } }), h("code", {}, c), h("span", { class: "small muted" }, `${m.meta.colors![c]} élément(s)`), s);
    }));
    const slot = h("select", { "aria-label": "Emplacement" }, Object.entries(kit.slots).map(([k, s]) => h("option", { value: k }, s.label))) as HTMLSelectElement;
    const name = h("input", { value: m.name }) as HTMLInputElement;
    fill(area,
      h("div", { class: "panel import-check" }, h("h2", {}, "2. Vérification et aperçu"),
        h("div", { class: "split" }, h("div", { class: "svg-prev checker" }, svgImage(svg, m.name)),
          h("div", {},
            h("p", {}, "viewBox : ", h("code", {}, vb.join(" ")), frameOk ? h("span", { class: "tag tag-ok" }, "repère du kit") : h("span", { class: "tag tag-err" }, "repère différent : réglez échelle et décalage ensuite")),
            h("p", {}, `${fmtSize(m.size)} · ${colors.length} couleur(s) fixe(s) · canaux recolorables : ${chans.length ? chans.join(", ") : "aucun"}`),
            m.meta.warnings?.length ? h("ul", { class: "report" }, m.meta.warnings.map((w) => h("li", { class: "rep-warning" }, w))) : h("p", { class: "report-ok" }, "Aucun contenu dangereux détecté.")))),
      h("div", { class: "panel" }, h("h2", {}, "3. Couleurs personnalisables"),
        h("p", { class: "muted" }, "Associez chaque couleur à un canal pour la rendre modifiable : couleurs propres du composant (principale, secondaire, accent) ou couleurs partagées du kit. « Couleur fixe » conserve le rendu d'origine."),
        colors.length ? mapping : h("p", { class: "muted" }, "Aucune couleur fixe détectée."),
        colors.length ? h("button", { class: "btn", onclick: async () => {
          if (!Object.keys(map).length) return toast("Choisissez au moins un canal.", "err");
          try { media = await api.assignChannels(m.id, map); await refreshMedia(); toast(`Convention appliquée (révision ${media.revision})`); step2(); } catch (e) { toast((e as Error).message, "err"); }
        } }, "Appliquer la convention de couleurs") : null),
      h("div", { class: "panel" }, h("h2", {}, "4. Créer le composant"),
        row(field("Nom", name), field("Emplacement", slot)),
        h("button", { class: "btn btn-primary", onclick: async () => {
          const spec = kit.slots[slot.value];
          const d = templateFor("character_part", "", { mediaId: m.id, slot: slot.value });
          d.name = name.value.trim() || m.name; d.tags = [kitKey, slot.value]; d.subcategory = null;
          d.properties = { kit: kitKey, slot: slot.value, svg_media: m.id, offset: [0, 0], scale: 1, anchor: slot.value === "base" || slot.value === "pattern" ? null : spec?.anchor ?? null,
            z: null, default_colors: {}, palette: {}, bases: [], requires_slots: [], incompatible_slots: [], incompatible_parts: [],
            anchors: slot.value === "base" ? Object.fromEntries(Object.entries(kit.anchors).map(([a, p]) => [a, [p]])) : {} };
          for (const ch of Object.keys(media!.meta.channels ?? {})) if (ch in NAMES) d.properties.default_colors[ch] = media!.meta.channels![ch];
          try {
            const a = await api.create("kit_components", `kit-${kitKey}-${slugify(d.name)}`.slice(0, 40) + `-${Date.now().toString(36).slice(-4)}`, d);
            await refreshKitParts(); toast("Composant créé en brouillon"); go(`#/modulaire/${kitKey}/composants/${a.id}`);
          } catch (e) { toast((e as Error).message, "err"); }
        } }, "Créer le composant")));
  }
}

export async function kitPartEditor(root: HTMLElement, kitKey: string, id: string) {
  if (!kitSpec(kitKey)) return go("#/modulaire");
  if (id === "nouveau") return importKitPart(root, kitKey);
  await refreshKitParts();
  let asset: AssetDetail = await api.asset(id);
  if (asset.family !== "component") return go(`#/asset/${id}`);
  if (asset.definition.properties.kit !== kitKey) return go(`#/modulaire/${asset.definition.properties.kit}/composants/${id}`);
  const kit = kitSpec(kitKey)!;
  let def = structuredClone(asset.definition);
  let dirty = false;
  let testBase = kitLib(kitKey).find((p) => p.slot === "base")?.id ?? "";
  const editable = () => asset.versions[asset.versions.length - 1].status === "draft" && !asset.archived && can("asset.edit");
  const P = () => def.properties;
  const head = h("header", { class: "ed-head" });
  const prev = h("div", { class: "part-preview" });
  const form = h("div", { class: "ed-form" });
  const side = h("div", { class: "ed-side" });
  fill(root, h("div", { class: "editor" }, head, h("div", { class: "ed-body" }, h("section", { class: "ed-preview" }, prev, side), form)));

  const payload = (): PartPayload | null => {
    const b = ctx.kitParts.get(id);
    if (!b) return null;
    return { ...b, slot: P().slot, props: P(), z: P().z ?? kit.slots[P().slot]?.z ?? 50, back_z: kit.slots[P().slot]?.back_z ?? 0, name: def.name };
  };
  function changed() { dirty = true; renderHead(); renderPreview(); }

  function renderPreview() {
    const p = payload();
    if (!p) { fill(prev, h("p", { class: "muted" }, "Aperçu indisponible.")); return; }
    const parts = { ...kitPartsRecord(), [id]: p };
    const bases = kitLib(kitKey).filter((x) => x.slot === "base");
    const sel = h("select", { "aria-label": "Base de test" }, bases.map((b) => h("option", { value: b.id, selected: b.id === testBase }, b.name))) as HTMLSelectElement;
    sel.addEventListener("change", () => { testBase = sel.value; renderPreview(); });
    let test: ModularProps | null = null;
    if (p.slot === "base") test = randomAssembly(Object.values(parts), kitKey, kit, seeded(5), { base: id });
    else if (p.slot !== "pattern" && testBase) {
      test = randomAssembly(kitLib(kitKey), kitKey, kit, seeded(9), { base: testBase }) ?? { kit: kitKey, base: testBase, layers: {} };
      test.layers[p.slot] = { part: id, colors: {} };
    }
    fill(prev,
      h("div", { class: "split" },
        h("figure", {}, h("div", { class: "svg-prev checker" }, svgImage(composeKitPart(p, kit, { ghostBase: p.slot === "base" ? null : ctx.kitParts.get(testBase) }))), h("figcaption", { class: "small muted" }, "Composant seul")),
        test ? h("figure", {}, h("div", { class: "svg-prev" }, svgImage(composeKit(test, parts, kit, { background: "#eef3f1" }).svg)),
          h("figcaption", { class: "small" }, p.slot === "base" ? "Base garnie au hasard" : ["Sur une base de test · ", sel])) : null),
      h("p", { class: "small muted" }, "L'aperçu suit vos réglages avant enregistrement (ancrage, décalage, échelle, ordre, points d'ancrage)."));
  }

  function renderHead() {
    const latest = asset.versions[asset.versions.length - 1];
    const acts: HTMLElement[] = [];
    const btn = (l: string, run: () => void, kind = "btn") => h("button", { class: kind, onclick: run }, l);
    if (editable()) { acts.push(btn(dirty ? "Enregistrer le brouillon" : "Brouillon enregistré", save, dirty ? "btn btn-primary" : "btn")); acts.push(btn("Soumettre à validation", () => act("submit"))); }
    if (latest.status === "in_review" && can("asset.validate")) { acts.push(btn("Approuver", () => act("approve"), "btn btn-primary")); acts.push(btn("Renvoyer en brouillon", () => act("reject"))); }
    if (latest.status === "validated" && can("asset.publish")) acts.push(btn("Publier", () => act("publish"), "btn btn-primary"));
    if (["published", "validated", "superseded"].includes(latest.status) && can("asset.edit") && !asset.archived) acts.push(btn("Créer une nouvelle version", async () => {
      try { asset = await api.newDraft(id); def = structuredClone(asset.definition); rerender(); } catch (e) { fail(e); }
    }));
    if (can("asset.archive")) acts.push(asset.archived ? btn("Restaurer", () => act("restore")) : btn("Archiver", () => act("archive"), "btn btn-quiet"));
    fill(head, h("div", { class: "ed-title" }, h("button", { class: "back", onclick: () => go(`#/modulaire/${kitKey}/composants`), "aria-label": "Retour" }, "‹"),
      h("div", {}, h("h1", {}, def.name), h("p", { class: "meta" }, pill(asset.status), ` v${asset.latest_version} · ${kit.label} · ${kitSlotLabel(kitKey, P().slot)} · `, h("code", {}, asset.technical_name)))),
      h("div", { class: "ed-actions" }, acts));
  }
  async function save() {
    try { asset = await api.saveDraft(id, def); def = structuredClone(asset.definition); dirty = false; await refreshKitParts(); toast(asset.validation?.ok ? "Enregistré" : `Enregistré avec ${asset.validation?.errors} erreur(s)`, asset.validation?.ok ? "ok" : "err"); rerender(); }
    catch (e) { fail(e); }
  }
  async function act(a: AssetAction) {
    if (dirty && a === "submit") await save();
    try { asset = await api.action(id, a); def = structuredClone(asset.definition); await refreshKitParts(); toast("Fait"); rerender(); } catch (e) { fail(e); }
  }
  function fail(e: unknown) { toast((e as Error).message, "err"); if (e instanceof ApiError && e.report) { asset = { ...asset, validation: e.report }; renderSide(); } }

  function renderForm() {
    const dis = !editable();
    const p = P();
    const m = ctx.media.get(p.svg_media);
    const chans = Object.keys(m?.meta.channels ?? {}).filter((c) => c in NAMES);
    const inp = (val: any, on: (v: string) => void, attrs: Record<string, any> = {}) => { const e = h("input", { value: val ?? "", disabled: dis, ...attrs }) as HTMLInputElement; e.addEventListener("change", () => on(e.value)); return e; };
    const sel = (val: string, opts: Record<string, string>, on: (v: string) => void) => { const e = h("select", { disabled: dis }, Object.entries(opts).map(([k, l]) => h("option", { value: k, selected: k === (val ?? "") }, l))) as HTMLSelectElement; e.addEventListener("change", () => on(e.value)); return e; };
    const slots = Object.fromEntries(Object.entries(kit.slots).map(([k, s]) => [k, s.label]));
    const checks = (list: string[], opts: Record<string, string>, on: (l: string[]) => void) => h("div", { class: "row" }, Object.entries(opts).map(([k, l]) => {
      const c = h("input", { type: "checkbox", checked: list.includes(k), disabled: dis }) as HTMLInputElement;
      c.addEventListener("change", () => on(c.checked ? [...list, k] : list.filter((x) => x !== k)));
      return h("label", { class: "toggle" }, c, l);
    }));
    const bases = Object.fromEntries(kitLib(kitKey).filter((x) => x.slot === "base").map((b) => [b.id, b.name]));
    const others = Object.fromEntries(kitLib(kitKey).filter((x) => x.id !== id && x.slot !== "pattern").map((x) => [x.id, `${kitSlotLabel(kitKey, x.slot)} — ${x.name}`]));
    const sec = (title: string, ...body: (HTMLElement | null)[]) => h("details", { class: "sec", open: true }, h("summary", {}, title), h("div", { class: "sec-body" }, body));
    const ptsText = (pts: number[][] = []) => pts.map((q) => `${q[0]},${q[1]}`).join(" ; ");
    fill(form,
      sec("Identité", row(field("Nom", inp(def.name, (v) => { def.name = v; changed(); })), field("Emplacement", sel(p.slot, slots, (v) => { p.slot = v; changed(); renderForm(); }))),
        field("Étiquettes", inp(def.tags.join(", "), (v) => { def.tags = v.split(",").map((t) => t.trim()).filter(Boolean); changed(); }))),
      sec("Fichier SVG",
        h("p", {}, m ? `${m.name} · révision ${m.revision} · ${fmtSize(m.size)} · viewBox ${(m.meta.view_box ?? []).join(" ")}` : "Fichier introuvable"),
        h("p", { class: "small muted" }, `Canaux : ${Object.keys(m?.meta.channels ?? {}).join(", ") || "aucun (rendu d'origine)"}. Remplacer le fichier garde l'identifiant : les versions publiées gardent la révision qu'elles utilisaient.`),
        can("media.upload") ? (() => {
          const f = h("input", { type: "file", accept: ".svg,image/svg+xml", disabled: dis, "aria-label": "Nouveau fichier SVG" }) as HTMLInputElement;
          f.addEventListener("change", async () => {
            const file = f.files?.[0]; if (!file) return;
            try { await api.replaceMedia(p.svg_media, file, file.name); await refreshMedia(); await refreshKitParts(); toast("Fichier remplacé (nouvelle révision)"); renderForm(); renderPreview(); }
            catch (e) { toast((e as Error).message, "err"); }
          });
          return field("Remplacer le fichier", f);
        })() : null),
      p.slot === "base" ? sec("Points d'ancrage fournis par la base",
        h("p", { class: "muted" }, `Positions dans le repère ${kit.frame.join(" ")}, séparées par « ; ». Plusieurs positions = la pièce est dessinée plusieurs fois (fenêtres par étage, roues par essieu, coussins par place). Liste vide = aucune pièce de ce type sur cette base.`),
        h("div", { class: "table" }, Object.entries(kit.anchors).map(([a, ref]) => h("div", { class: "trow" }, h("strong", {}, a), h("span", { class: "small muted" }, `référence ${ref.join(",")}`),
          inp(ptsText(p.anchors?.[a]), (v) => {
            const pts = v.split(";").map((s) => s.trim()).filter(Boolean).map((s) => s.split(",").map(Number)).filter((q) => q.length === 2 && q.every(Number.isFinite));
            p.anchors = { ...(p.anchors ?? {}) };
            if (v.trim() === "-") delete p.anchors[a]; else p.anchors[a] = pts;
            changed();
          }, { "aria-label": `Positions ${a}`, placeholder: "absent (tapez des positions x,y)" }))))) : null,
      p.slot !== "base" && p.slot !== "pattern" ? sec("Position et superposition",
        h("p", { class: "muted" }, "La pièce est accrochée à un point de la base : sur une autre base, elle suit ce point (et se répète s'il a plusieurs positions)."),
        row(field("Point d'ancrage", sel(p.anchor ?? "", { "": "Aucun (repère entier)", ...Object.fromEntries(Object.keys(kit.anchors).map((a) => [a, a])) }, (v) => { p.anchor = v || null; changed(); })),
          field("Ordre de rendu", inp(p.z ?? "", (v) => { p.z = v === "" ? null : Number(v); changed(); }, { type: "number", class: "num", placeholder: String(kit.slots[p.slot]?.z ?? "") }), "Vide = ordre par défaut de l'emplacement"),
          field("Décalage horizontal", inp(p.offset?.[0] ?? 0, (v) => { p.offset = [Number(v), p.offset?.[1] ?? 0]; changed(); }, { type: "number", class: "num", step: 0.5 })),
          field("Décalage vertical", inp(p.offset?.[1] ?? 0, (v) => { p.offset = [p.offset?.[0] ?? 0, Number(v)]; changed(); }, { type: "number", class: "num", step: 0.5 })),
          field("Échelle", inp(p.scale ?? 1, (v) => { p.scale = Number(v); changed(); }, { type: "number", class: "num", step: 0.05, min: 0.1, max: 5 })))) : null,
      chans.length ? sec("Couleurs", ...chans.map((ch) => {
        const pal: string[] = p.palette?.[ch] ?? [];
        const c = h("input", { type: "color", value: p.default_colors?.[ch] ?? m?.meta.channels?.[ch] ?? "#888888", disabled: dis }) as HTMLInputElement;
        c.addEventListener("change", () => { p.default_colors = { ...(p.default_colors ?? {}), [ch]: c.value }; changed(); });
        const add = h("input", { type: "color", value: "#c0392b", disabled: dis, "aria-label": "Couleur à autoriser" }) as HTMLInputElement;
        return h("div", { class: "field" }, h("span", {}, NAMES[ch]), row(field("Par défaut", c),
          h("div", { class: "field" }, h("span", {}, "Palette autorisée (vide = libre)"), h("div", { class: "swatch-row" },
            pal.map((col, i) => h("button", { class: "sw", style: { background: col }, disabled: dis, title: `Retirer ${col}`, onclick: () => { pal.splice(i, 1); p.palette = { ...p.palette, [ch]: pal }; if (!pal.length) delete p.palette[ch]; changed(); renderForm(); } })),
            add, h("button", { class: "btn btn-small", disabled: dis, onclick: () => { p.palette = { ...(p.palette ?? {}), [ch]: [...pal, add.value] }; changed(); renderForm(); } }, "Autoriser")))));
      })) : null,
      p.slot !== "base" && p.slot !== "pattern" ? sec("Compatibilités et dépendances",
        field("Bases compatibles (aucune = toutes celles qui ont le point d'ancrage)", checks(p.bases ?? [], bases, (l) => { p.bases = l; changed(); })),
        field("Ne va pas avec ces emplacements", checks(p.incompatible_slots ?? [], slots, (l) => { p.incompatible_slots = l; changed(); })),
        field("Nécessite ces emplacements", checks(p.requires_slots ?? [], slots, (l) => { p.requires_slots = l; changed(); })),
        field("Incompatible avec ces composants", (() => {
          const e = h("select", { multiple: true, size: 6, disabled: dis }, Object.entries(others).map(([k, l]) => h("option", { value: k, selected: (p.incompatible_parts ?? []).includes(k) }, l))) as HTMLSelectElement;
          e.addEventListener("change", () => { p.incompatible_parts = [...e.selectedOptions].map((o) => o.value); changed(); });
          return e;
        })())) : null);
  }
  function renderSide() {
    fill(side, h("div", { class: "panel" }, h("h2", {}, "Validation"), reportView(asset.validation)),
      historyPanel(asset, (a) => { asset = a; def = structuredClone(a.definition); dirty = false; rerender(); }), usagePanel(asset));
  }
  function rerender() { renderHead(); renderForm(); renderPreview(); renderSide(); }
  rerender();
}
