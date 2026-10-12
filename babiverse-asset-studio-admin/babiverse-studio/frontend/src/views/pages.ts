import { api } from "../api";
import { go } from "../router";
import { mountGame, PreviewScene } from "../render/stage";
import type { AssetDetail, AssetSummary, Family } from "../types";
import { AUDIT_LABEL, can, capBadge, CAP_NAMES, catLabel, ctx, emptyState, famLabel, fmtDate, h, pill, reportView, row, field, thumbnail, toast, fill } from "../ui";
import { catalogView } from "./catalog";
import { compareVariants, facadeSection, openAsset } from "./editorParts";

// ------------------------------------------------------------------ tableau de bord

export async function dashboardView(root: HTMLElement) {
  const d = await api.dashboard();
  const st = (s: string) => d.by_status[s] ?? 0;
  const item = (a: any) => h("li", {}, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(a.id, a.family); } }, a.name), " ", pill(a.status),
    h("span", { class: "muted small" }, ` ${famLabel(a.family)} · ${fmtDate(a.updated_at)}`));
  const max = Math.max(1, ...Object.values(d.by_family as Record<string, number>));
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, `Bonjour ${ctx.user!.username}`),
      h("p", { class: "lede" }, "Babiverse Asset Studio — Cité Akwaba : l'état du catalogue et ce qui attend une action.")),
      h("div", { class: "row" },
        can("asset.create") ? h("a", { class: "btn btn-primary", href: "#/creer" }, "Créer un élément") : null,
        h("a", { class: "btn", href: "#/medias" }, "Bibliothèque de médias"), h("a", { class: "btn", href: "#/carte" }, "Carte de test"))),
    h("dl", { class: "kpis" },
      [["Assets au total", d.total, ""], ["Publiés", st("published"), "published"], ["Brouillons", st("draft"), "draft"], ["En attente de validation", st("in_review") + st("validated"), "in_review,validated"],
       ["Archivés", st("archived"), "archived"], ["Fichiers", d.media, ""], ["Scènes de test", d.scenes, ""]].map(([l, n, s]) =>
        h("div", { class: "kpi", onclick: () => s ? go(`#/catalogue?statut=${s}`) : null }, h("dt", {}, l as string), h("dd", {}, String(n))))),
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Par famille"), h("ul", { class: "bars" }, Object.entries(d.by_family as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([f, n]) =>
        h("li", {}, h("span", {}, famLabel(f)), h("span", { class: "bar" }, h("span", { style: { width: `${(n / max) * 100}%` } })), h("strong", {}, String(n)))))),
      h("section", { class: "panel" }, h("h2", {}, "Par catégorie"), h("ul", { class: "list cols" }, Object.entries(d.by_category as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([c, n]) =>
        h("li", {}, h("a", { href: `#/catalogue?categorie=${c}` }, catLabel(c)), ` · ${n}`)))),
      h("section", { class: "panel" }, h("h2", {}, "À valider ou publier"), d.waiting.length ? h("ul", { class: "list" }, d.waiting.map(item)) : h("p", { class: "muted" }, "Rien en attente.")),
      h("section", { class: "panel" }, h("h2", {}, "Éléments présentant des erreurs"), d.with_errors.length ? h("ul", { class: "list" }, d.with_errors.map((a: any) =>
        h("li", {}, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(a.id, a.family); } }, a.name), h("span", { class: "tag tag-err" }, `${a.errors} erreur(s)`)))) : h("p", { class: "report-ok" }, "Aucun.")),
      h("section", { class: "panel" }, h("h2", {}, "Dernières modifications"), h("ul", { class: "list" }, d.recent_changes.map((e: any) =>
        h("li", {}, h("strong", {}, AUDIT_LABEL[e.action] ?? e.action), " · ", e.name ?? "", h("span", { class: "muted small" }, ` ${fmtDate(e.ts)} · ${e.username}`))))),
      h("section", { class: "panel" }, h("h2", {}, "Derniers assets créés"), h("ul", { class: "list" }, d.recent_created.map(item)))));
}

// ------------------------------------------------------------------ sections par famille

function capsPanel(fams: Family[]): HTMLElement {
  return h("div", { class: "fam-caps" }, fams.map((f) => {
    const info = ctx.tax!.families[f];
    return h("div", { class: "panel" }, h("h2", {}, info.label), h("p", { class: "small muted" }, info.description),
      h("div", { class: "caps" }, Object.entries(info.capabilities).map(([k, v]) => capBadge(v, CAP_NAMES[k] ?? k))),
      h("p", { class: "small muted" }, info.limits),
      h("p", { class: "small" }, info.game === "adapter" ? "Jeu actuel : export avec adaptateur (voir Import et export)." : "Jeu actuel : pas encore chargé par le moteur (extension à écrire)."),
      can("asset.create") ? h("a", { class: "btn btn-small", href: f === "character_part" ? "#/composants/nouveau" : f === "component" ? "#/modulaire/composants" : `#/creer?famille=${f}` }, `Créer : ${info.label}`) : null);
  }));
}

export const SECTIONS: Record<string, { title: string; intro: string; families: Family[] }> = {
  batiments: { title: "Bâtiments et infrastructures", families: ["building"],
    intro: "Habitations, commerces, santé, éducation, sécurité, administration… : des catégories configurables d'une même famille procédurale." },
  interieurs: { title: "Intérieurs et mobilier", families: ["interior", "furniture"],
    intro: "Plans d'intérieurs (pièces, portes, circulation) et meubles réutilisables avec actions déclaratives." },
  terrains: { title: "Routes, terrains et végétation", families: ["road", "surface", "prop"],
    intro: "Segments routiers connectables, surfaces (pelouse, sable, eau, parking), végétation et mobilier urbain." },
  vehicules: { title: "Véhicules et transports", families: ["vehicle"],
    intro: "Taxis, gbakas, wôrô-wôrô, motos… stationnés dans les scènes de test. La conduite n'est pas simulée." },
};

export async function sectionView(root: HTMLElement, key: string) {
  const s = SECTIONS[key];
  await catalogView(root, { families: s.families, title: s.title, intro: s.intro, extra: capsPanel(s.families) });
}

// ------------------------------------------------------------------ atelier d'assemblage

export async function assemblyView(root: HTMLElement): Promise<() => void> {
  const buildings = (await api.assets({ family: "building" })).filter((a) => !a.archived);
  const sel = h("select", { "aria-label": "Bâtiment à assembler" }, h("option", { value: "" }, "Choisir un bâtiment…"),
    buildings.map((b) => h("option", { value: b.id }, `${b.name} (${b.status === "draft" ? "brouillon" : `v${b.latest_version}`})`))) as HTMLSelectElement;
  const work = h("div", {});
  let game: any = null;
  const mods = ctx.tax!.facade_modules;
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Atelier d'assemblage"),
      h("p", { class: "lede" }, "Assembler des éléments à partir de modules compatibles. La compatibilité est vérifiée : tout ne s'assemble pas avec tout."))),
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Façades de bâtiment"), h("p", { class: "small muted" }, "Portes, fenêtres, persiennes, balcons, vitrines, claustras, garages : module par module, niveau par niveau."),
        h("table", { class: "mini-table" }, h("tr", {}, h("th", {}, "Module"), h("th", {}, "Niveaux autorisés")),
          Object.entries(mods).filter(([k]) => k !== "auto").map(([, m]) => h("tr", {}, h("td", {}, m.label), h("td", {}, m.floors === "ground" ? "Rez-de-chaussée" : m.floors === "upper" ? "Étages" : "Tous"))))),
      h("section", { class: "panel" }, h("h2", {}, "Tenues de personnage"), h("p", { class: "small muted" }, "Corps, visage, coiffure, vêtements, motifs et accessoires s'assemblent par calques, avec règles d'incompatibilité et de dépendance."),
        h("a", { class: "btn btn-small", href: "#/personnages" }, "Ouvrir l'atelier de personnages")),
      h("section", { class: "panel" }, h("h2", {}, "Intérieurs"), h("p", { class: "small muted" }, "Pièces, portes et meubles (intégrés ou créés dans l'atelier) s'assemblent sur la grille d'un intérieur."),
        h("a", { class: "btn btn-small", href: "#/interieurs" }, "Voir les intérieurs")),
      h("section", { class: "panel" }, h("h2", {}, "Non disponible"), h("p", { class: "small muted" },
        "Composer un véhicule à partir de pièces, assembler des toits multiples ou des modules de décor libres : le moteur n'a pas de système de connecteurs pour cela. Ces assemblages restent à développer."))),
    h("div", { class: "panel" }, h("h2", {}, "Assembler une façade"), row(field("Bâtiment", sel)), work));
  sel.addEventListener("change", async () => {
    if (game) { game.destroy(true); game = null; }
    if (!sel.value) return fill(work);
    let a: AssetDetail = await api.asset(sel.value);
    const editable = a.versions[a.versions.length - 1].status === "draft" && can("asset.edit");
    const def = structuredClone(a.definition);
    const host = h("div", { class: "stage" });
    const scene = new PreviewScene();
    let rotation = 0;
    const set = () => scene.set({ family: "building", def, rotation, variant: null, furniture: {}, flags: { grid: true, footprint: false, collision: false, entrances: true, connectors: false, zones: false, dims: false } });
    const formBox = h("div", {});
    const status = h("div", {});
    const renderForm = () => fill(formBox, facadeSection(def, (r) => { set(); if (r) renderForm(); }, !editable));
    fill(work, 
      editable ? null : h("p", { class: "ed-banner" }, "Version non modifiable : ", can("asset.edit") ? h("button", { class: "btn btn-small", onclick: async () => { await api.newDraft(a.id); sel.dispatchEvent(new Event("change")); } }, "Créer une nouvelle version brouillon") : "lecture seule."),
      h("div", { class: "ed-body" }, h("div", {}, h("div", { class: "seg" }, [0, 90, 180, 270].map((r) => h("button", { onclick: () => { rotation = r; set(); } }, `${r}°`))), host, status),
        h("div", {}, formBox, editable ? h("button", { class: "btn btn-primary", onclick: async () => {
          try { a = await api.saveDraft(a.id, def); fill(status, reportView(a.validation)); toast("Façade enregistrée"); } catch (e) { toast((e as Error).message, "err"); }
        } }, "Enregistrer la façade") : null, h("a", { class: "btn", href: `#/asset/${a.id}` }, "Ouvrir dans l'éditeur complet"))));
    game = mountGame(host, scene);
    set(); renderForm();
  });
  return () => { if (game) game.destroy(true); };
}

// ------------------------------------------------------------------ comportements

export async function behaviorsView(root: HTMLElement) {
  const usage = await api.behaviorUsage();
  const reg = ctx.tax!.behaviors;
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Interactions et comportements"),
      h("p", { class: "lede" }, "Registre des comportements que le moteur connaît. L'administration les associe aux assets et règle leurs paramètres ; aucun code n'est jamais saisi ni exécuté depuis l'interface. Une nouvelle mécanique demande une extension du moteur, puis s'active ici sans code."))),
    h("div", { class: "behaviors" }, Object.entries(reg).map(([id, b]) => h("article", { class: "panel", id: `b-${id}` },
      h("h2", {}, b.label, " ", h("span", { class: `cap ${b.engine === "game" ? "cap-available" : "cap-experimental"}` }, b.engine === "game" ? "exploité par le jeu" : "atelier seulement")),
      h("p", {}, b.description), b.requires ? h("p", { class: "small" }, `Prérequis : ${b.requires}`) : null,
      h("p", { class: "small muted" }, "Identifiant : ", h("code", {}, id), " · familles : ", b.families.map(famLabel).join(", ")),
      Object.keys(b.params).length ? h("table", { class: "mini-table" }, h("tr", {}, h("th", {}, "Paramètre"), h("th", {}, "Type"), h("th", {}, "Défaut"), h("th", {}, "Limites")),
        Object.entries(b.params).map(([k, p]) => h("tr", {}, h("td", {}, p.label, " ", h("code", {}, k)), h("td", {}, p.type), h("td", {}, String(p.default)), h("td", {}, p.min !== undefined ? `${p.min} – ${p.max}` : p.max ? `${p.max} car.` : "—"))))
        : h("p", { class: "small muted" }, "Aucun paramètre."),
      h("p", { class: "small" }, `Utilisé par ${usage[id]?.length ?? 0} asset(s)`, usage[id]?.length ? ": " : ".",
        ...(usage[id] ?? []).slice(0, 8).flatMap((a, i) => [i ? ", " : "", h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(a.id, a.family); } }, a.name)]))))));
}

// ------------------------------------------------------------------ variantes et thèmes

export async function variantsView(root: HTMLElement) {
  const all = (await api.assets()).filter((a) => a.variants > 0 && !a.archived);
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Variantes et thèmes visuels"),
      h("p", { class: "lede" }, "Une variante réutilise la définition de base et ne remplace que quelques paramètres (couleurs, enseigne, toiture, motif, tenue). Elles se créent dans l'éditeur de chaque asset."))),
    all.length ? h("div", { class: "rows" }, all.map((a: AssetSummary) => h("article", { class: "line" },
      h("button", { class: "line-thumb", onclick: () => openAsset(a.id, a.family) }, thumbnail(a.preview, a.family, 72)),
      h("div", {}, h("strong", {}, a.name), h("div", { class: "meta" }, `${famLabel(a.family)} · ${a.variants} variante(s)`)),
      h("div", { class: "meta" }, a.preview.variants.map((v) => v.name + (a.preview.default_variant === v.id ? " (par défaut)" : "")).join(" · ")),
      h("div", {}, pill(a.status)),
      h("div", { class: "card-actions" },
        a.family !== "character" ? h("button", { class: "btn btn-small", onclick: () => compareVariants(a.family, a.preview, null, a.preview.variants[0]) }, "Comparer") : null,
        h("button", { class: "btn btn-small", onclick: () => openAsset(a.id, a.family) }, "Modifier")))))
      : emptyState("Aucun asset n'a encore de variante."));
}

// ------------------------------------------------------------------ validation et publication

export async function reviewView(root: HTMLElement) {
  const items = (await api.assets({ status: "in_review,validated" }));
  const drafts = (await api.assets({ status: "draft" })).slice(0, 30);
  const run = async (id: string, a: "approve" | "publish" | "reject") => {
    try { await api.action(id, a); toast({ approve: "Approuvé", publish: "Publié", reject: "Renvoyé en brouillon" }[a]); reviewView(root); }
    catch (e) { toast((e as Error).message, "err"); const r = (e as any).report; if (r) root.querySelector(`[data-review="${id}"] .rev-report`)?.replaceChildren(reportView(r)); }
  };
  const rowFor = (a: AssetSummary) => h("article", { class: "review", "data-review": a.id }, thumbnail(a.preview, a.family, 120),
    h("div", {}, h("h3", {}, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(a.id, a.family); } }, a.name)),
      h("p", { class: "meta" }, `${famLabel(a.family)} · ${catLabel(a.category)} · v${a.latest_version} · par ${a.created_by}`), pill(a.status),
      a.errors ? h("span", { class: "tag tag-err" }, `${a.errors} erreur(s)`) : null, h("div", { class: "rev-report" })),
    h("div", { class: "row" },
      a.status === "in_review" && can("asset.validate") ? h("button", { class: "btn btn-primary btn-small", onclick: () => run(a.id, "approve") }, "Approuver") : null,
      a.status === "validated" && can("asset.publish") ? h("button", { class: "btn btn-primary btn-small", onclick: () => run(a.id, "publish") }, "Publier") : null,
      can("asset.validate") ? h("button", { class: "btn btn-small", onclick: () => run(a.id, "reject") }, "Renvoyer en brouillon") : null,
      h("button", { class: "btn btn-small", onclick: async () => { const r = await api.validate(a.id, true); root.querySelector(`[data-review="${a.id}"] .rev-report`)?.replaceChildren(reportView(r)); } }, "Vérifier")));
  fill(root, h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Validation et publication"),
    h("p", { class: "lede" }, "Cycle : brouillon → en validation → validé → publié → remplacé. Chaque approbation et publication relance toutes les vérifications (schéma, références, dépendances publiées, plaçabilité). Une publication ne remplace jamais silencieusement la précédente : celle-ci passe en « remplacée » et reste servie aux instances qui l'utilisent."))),
    h("h2", {}, "En attente"), items.length ? h("div", { class: "reviews" }, items.map(rowFor)) : emptyState("Aucun asset en attente de validation."),
    h("h2", {}, "Brouillons récents"), drafts.length ? h("div", { class: "reviews" }, drafts.map(rowFor)) : emptyState("Aucun brouillon."));
}

// ------------------------------------------------------------------ versions et historique

export async function historyView(root: HTMLElement) {
  const q = h("select", { "aria-label": "Type d'action" }, h("option", { value: "" }, "Toutes les actions"),
    [["asset.", "Assets"], ["world.", "Placements"], ["scene.", "Scènes"], ["media.", "Médias"], ["bundle.", "Imports et exports"], ["user.", "Utilisateurs"], ["category.", "Catégories"], ["auth.", "Connexions"]]
      .map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const list = h("div", {});
  const pub = (await api.assets({ sort: "updated" })).filter((a) => a.published_version || a.latest_version > 1);
  async function load() {
    if (!can("admin.audit")) { fill(list, h("p", { class: "muted" }, "Le journal d'audit est réservé aux publieurs et administrateurs.")); return; }
    const rows = await api.audit({ action: q.value, limit: "200" });
    fill(list, h("ul", { class: "audit" }, rows.map((e) => h("li", {}, h("span", { class: "muted" }, fmtDate(e.ts)), " ", h("strong", {}, e.username), " ", AUDIT_LABEL[e.action] ?? e.action,
      e.detail?.version ? ` v${e.detail.version}` : "", e.detail?.technical_name ? ` « ${e.detail.technical_name} »` : "", e.detail?.filename ? ` « ${e.detail.filename} »` : "",
      e.target && e.action.startsWith("asset.") ? h("a", { href: `#/asset/${e.target}`, class: "small" }, " ouvrir") : null))));
  }
  q.addEventListener("change", load);
  fill(root, h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Versions et historique"),
    h("p", { class: "lede" }, "Chaque version conserve sa définition et les versions exactes de ses dépendances au moment de la publication. Le retour à une version antérieure crée un nouveau brouillon : rien n'est écrasé."))),
    h("h2", {}, "Assets versionnés"),
    h("div", { class: "table wide" }, h("div", { class: "trow thead" }, h("span", {}, "Asset"), h("span", {}, "Famille"), h("span", {}, "Publiée"), h("span", {}, "Dernière"), h("span", {}, "Placés"), h("span", {}, "État")),
      pub.map((a) => h("div", { class: "trow" }, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(a.id, a.family); } }, a.name), h("span", {}, famLabel(a.family)),
        h("span", {}, a.published_version ? `v${a.published_version}` : "—"), h("span", {}, `v${a.latest_version}`), h("span", {}, String(a.instances)), pill(a.status)))),
    h("h2", {}, "Journal d'audit"), h("div", { class: "filters" }, q), list);
  await load();
}
