import { api } from "../api";
import { go } from "../router";
import type { AssetSummary, Family } from "../types";
import { can, catLabel, confirmDialog, ctx, emptyState, famLabel, fmtDate, h, modal, pill, slugify, STATUS_LABEL, thumbnail, toast, fill } from "../ui";
import { openAsset } from "./editorParts";

export interface CatalogOpts { families?: Family[]; title?: string; intro?: string; status?: string; category?: string; createLabel?: string; extra?: HTMLElement | null }

const pref = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* préférence non conservée */ } } };

export async function catalogView(root: HTMLElement, opts: CatalogOpts = {}) {
  const fams = opts.families ?? (Object.keys(ctx.tax!.families) as Family[]);
  const q = h("input", { type: "search", placeholder: "Nom, identifiant, catégorie ou étiquette…", "aria-label": "Rechercher" }) as HTMLInputElement;
  const fam = h("select", { "aria-label": "Famille" }, h("option", { value: "" }, "Toutes familles"), fams.map((f) => h("option", { value: f }, famLabel(f)))) as HTMLSelectElement;
  const cats = ctx.tax!.categories.filter((c) => fams.includes(c.family));
  const cat = h("select", { "aria-label": "Catégorie" }, h("option", { value: "" }, "Toutes catégories"), cats.map((c) => h("option", { value: c.key }, c.label))) as HTMLSelectElement;
  const st = h("select", { "aria-label": "Statut" }, h("option", { value: "" }, "Tous statuts"), Object.entries(STATUS_LABEL).filter(([k]) => k !== "superseded").map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const since = h("select", { "aria-label": "Période" }, [["", "Toute date"], ["1", "Modifiés aujourd'hui"], ["7", "7 derniers jours"], ["30", "30 derniers jours"]].map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const sort = h("select", { "aria-label": "Tri" }, h("option", { value: "updated" }, "Modifiés récemment"), h("option", { value: "created" }, "Créés récemment"), h("option", { value: "name" }, "Nom"), h("option", { value: "category" }, "Catégorie")) as HTMLSelectElement;
  let mode = pref.get("babiverse.catalog.mode") === "list" ? "list" : "grid";
  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "Affichage" });
  const grid = h("div", {});
  const count = h("p", { class: "muted", "aria-live": "polite" });
  if (fams.length === 1) fam.hidden = true;

  const newBtn = can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => go(`#/creer${fams.length === 1 ? `?famille=${fams[0]}` : ""}`) }, opts.createLabel ?? "Créer un élément") : null;
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, opts.title ?? "Catalogue des assets"), opts.intro ? h("p", { class: "lede" }, opts.intro) : null), newBtn),
    opts.extra ?? "",
    h("div", { class: "filters" }, q, fam, cat, st, since, sort, modeSeg), count, grid);

  if (opts.status) { if (![...st.options].some((o) => o.value === opts.status)) st.append(h("option", { value: opts.status }, "Sélection du tableau de bord")); st.value = opts.status; }
  if (opts.category) cat.value = opts.category;
  let timer = 0;
  let items: AssetSummary[] = [];
  function renderMode() {
    fill(modeSeg, ...(["grid", "list"] as const).map((m) => h("button", { class: mode === m ? "on" : "", "aria-pressed": String(mode === m), onclick: () => { mode = m; pref.set("babiverse.catalog.mode", m); renderMode(); draw(); } }, m === "grid" ? "Grille" : "Liste")));
  }
  async function load() {
    const params: Record<string, string> = { q: q.value, category: cat.value, status: st.value, sort: sort.value, family: fam.value || fams.join(",") };
    if (since.value) params.since = String(Date.now() / 1000 - Number(since.value) * 86400);
    fill(grid, h("p", { class: "loading" }, "Chargement…"));
    try { items = await api.assets(params); } catch (e) { fill(grid, emptyState((e as Error).message)); return; }
    count.textContent = `${items.length} élément${items.length > 1 ? "s" : ""}`;
    draw();
  }
  function draw() {
    if (!items.length) { fill(grid, emptyState("Aucun élément ne correspond à ces filtres.", newBtn ? h("button", { class: "btn", onclick: () => go("#/creer") }, "Créer un élément") : null)); return; }
    grid.className = mode === "grid" ? "cards" : "rows";
    fill(grid, ...items.map((a) => (mode === "grid" ? card(a, load) : line(a, load))));
  }
  [cat, st, sort, fam, since].forEach((s) => s.addEventListener("change", load));
  q.addEventListener("input", () => { clearTimeout(timer); timer = window.setTimeout(load, 200); });
  renderMode();
  await load();
}

function dims(a: AssetSummary) {
  if (a.family === "interior") return `${a.preview.properties.width} × ${a.preview.properties.depth} tuiles`;
  if (a.family === "furniture") return `${a.preview.properties.w} × ${a.preview.properties.d} tuiles`;
  if (a.family === "character") return `${a.height_m} m · ${Object.keys(a.preview.properties.layers ?? {}).length} calques`;
  if (a.family === "character_part") return ctx.tax!.character_slots[a.preview.properties.slot]?.label ?? a.preview.properties.slot;
  if (a.family === "component") return `${ctx.tax!.kits[a.preview.properties.kit]?.label ?? a.preview.properties.kit} · ${ctx.tax!.kits[a.preview.properties.kit]?.slots[a.preview.properties.slot]?.label ?? a.preview.properties.slot}`;
  const fp = a.footprint.kind === "rect" ? `${a.footprint.w} × ${a.footprint.d}` : `${a.footprint.cells?.length ?? 0} cases`;
  return `${fp} · ${a.height_m} m`;
}

function actions(a: AssetSummary, reload: () => void) {
  return [
    h("button", { class: "btn btn-small", onclick: () => openAsset(a.id, a.family, a.preview) }, "Ouvrir"),
    can("asset.create") ? h("button", { class: "btn btn-small", onclick: () => duplicateDialog(a) }, "Dupliquer") : null,
    can("asset.archive") ? h("button", { class: "btn btn-small btn-quiet", onclick: async () => {
      if (!a.archived && !(await confirmDialog("Archiver", `Archiver « ${a.name} » ? Il ne sera plus proposé au placement ; les instances existantes restent en place.`, "Archiver", true))) return;
      try { await api.action(a.id, a.archived ? "restore" : "archive"); toast(a.archived ? "Restauré" : "Archivé"); reload(); }
      catch (e) { toast((e as Error).message, "err"); }
    } }, a.archived ? "Restaurer" : "Archiver") : null,
  ];
}

function versionInfo(a: AssetSummary) {
  return h("span", { class: "ver" }, `v${a.latest_version}${a.published_version && a.published_version !== a.latest_version ? ` · publiée v${a.published_version}` : ""}`);
}

function card(a: AssetSummary, reload: () => void): HTMLElement {
  return h("article", { class: "card", "data-asset": a.technical_name },
    h("button", { class: "card-hit", onclick: () => openAsset(a.id, a.family, a.preview), "aria-label": `Ouvrir ${a.name}` }, thumbnail(a.preview, a.family)),
    h("div", { class: "card-body" },
      h("h3", {}, a.name),
      h("p", { class: "meta" }, famLabel(a.family), " · ", catLabel(a.category), a.subcategory ? ` · ${a.subcategory}` : ""),
      h("p", { class: "meta" }, dims(a)),
      h("div", { class: "card-foot" }, pill(a.status), versionInfo(a),
        a.instances ? h("span", { class: "ver" }, `${a.instances} placé(s)`) : null,
        a.variants ? h("span", { class: "ver" }, `${a.variants} variante(s)`) : null,
        a.errors ? h("span", { class: "tag tag-err" }, `${a.errors} erreur(s)`) : null),
      h("div", { class: "card-actions" }, actions(a, reload))));
}

function line(a: AssetSummary, reload: () => void): HTMLElement {
  return h("article", { class: "line", "data-asset": a.technical_name },
    h("button", { class: "line-thumb", onclick: () => openAsset(a.id, a.family, a.preview), "aria-label": `Ouvrir ${a.name}` }, thumbnail(a.preview, a.family, 72)),
    h("div", {}, h("strong", {}, a.name), h("div", { class: "meta" }, h("code", {}, a.technical_name), ` · ${famLabel(a.family)} · ${catLabel(a.category)}`)),
    h("div", { class: "meta" }, dims(a)),
    h("div", {}, pill(a.status), " ", versionInfo(a), a.errors ? h("span", { class: "tag tag-err" }, `${a.errors} err.`) : null),
    h("div", { class: "meta" }, `${fmtDate(a.updated_at)} · ${a.created_by}`, a.instances ? ` · ${a.instances} placé(s)` : ""),
    h("div", { class: "card-actions" }, actions(a, reload)));
}

export function duplicateDialog(a: { id: string; name: string; technical_name: string; family?: string }) {
  const name = h("input", { value: `${a.name} (copie)` }) as HTMLInputElement;
  const tech = h("input", { value: slugify(`${a.technical_name}-copie`) }) as HTMLInputElement;
  name.addEventListener("input", () => (tech.value = slugify(name.value)));
  const close = modal("Dupliquer", h("div", { class: "fields" }, h("label", {}, "Nom affiché", name), h("label", {}, "Identifiant technique", tech, h("small", {}, "Stable : il ne changera plus.")),
    h("p", { class: "muted" }, "La copie part de la version publiée (sinon du dernier brouillon) et devient un nouveau brouillon indépendant.")), [
    { label: "Dupliquer", run: async () => { try { const d = await api.duplicate(a.id, tech.value, name.value); close(); toast("Copie créée"); openAsset(d.id, d.family); } catch (e) { toast((e as Error).message, "err"); } } },
  ]);
}
