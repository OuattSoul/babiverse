// Assistant de création guidé : famille → catégorie → identité → apparence → comportements → aperçu → enregistrement.
import { api } from "../api";
import { go } from "../router";
import { mountGame, PreviewScene } from "../render/stage";
import { roadConnectors, templateFor } from "../templates";
import { randomCharacter, seeded } from "../character/compose";
import type { AssetDefinition, AssetSummary, Family, Report } from "../types";
import { can, ctx, emptyState, famLabel, familyCard, field, h, reportView, slugify, thumbnail, toast, fill } from "../ui";
import { familySections, identitySection, renderSection, type SectionSpec } from "../forms";
import { behaviorsSection, openAsset } from "./editorParts";
import { duplicateDialog } from "./catalog";

const STEPS = ["Famille", "Catégorie", "Identité", "Apparence et dimensions", "Comportements", "Aperçu", "Enregistrement"];

const QUICK: Record<string, SectionSpec[]> = {
  building: [
    { id: "geometry", title: "Dimensions", fields: [
      { path: "footprint.w", label: "Largeur en cases", kind: "number", min: 1, max: 64 },
      { path: "footprint.d", label: "Profondeur en cases", kind: "number", min: 1, max: 64 },
      { path: "properties.floors", label: "Nombre de niveaux", kind: "number", min: 1, max: 40 },
      { path: "height_m", label: "Hauteur (m)", kind: "number", min: 2.5, max: 300, step: 0.5, hint: "2,5 m minimum par niveau" },
    ] },
    { id: "appearance", title: "Apparence", fields: [
      { path: "materials.wall", label: "Murs", kind: "color" }, { path: "materials.roof", label: "Toiture", kind: "color" },
      { path: "materials.trim", label: "Menuiseries", kind: "color" },
      { path: "properties.style.roof", label: "Type de toit", kind: "select", options: { flat: "Toit-terrasse", gable: "Deux pans", hip: "Quatre pans" } },
      { path: "properties.style.window_style", label: "Fenêtres", kind: "select", options: { grid: "Fenêtres", band: "Bandeau vitré", none: "Aucune" } },
      { path: "properties.style.door_style", label: "Porte", kind: "select", options: { wood: "Bois", glass: "Vitrée", metal: "Métal" } },
      { path: "properties.shop.sign_text", label: "Texte de l'enseigne", kind: "text", show: (d) => !!d.properties.shop },
    ] },
  ],
  road: [{ id: "geometry", title: "Segment", fields: [
    { path: "properties.kind", label: "Type de segment", kind: "select", options: { straight: "Droit", curve_left: "Virage à gauche", curve_right: "Virage à droite", tee: "Jonction en T", cross: "Croisement", end: "Extrémité" } },
    { path: "properties.lanes", label: "Voies", kind: "number", min: 1, max: 8 },
    { path: "footprint.w", label: "Largeur en cases", kind: "number", min: 1, max: 8 },
    { path: "properties.sidewalk", label: "Trottoirs", kind: "check" },
    { path: "materials.asphalt", label: "Chaussée", kind: "color" }, { path: "materials.marking", label: "Marquage", kind: "color" },
  ] }],
  interior: [{ id: "geometry", title: "Plan de départ", intro: "Une pièce et une porte sont créées : vous dessinerez les autres pièces et poserez les meubles dans l'éditeur de plan.", fields: [
    { path: "properties.width", label: "Largeur (tuiles)", kind: "number", min: 2, max: 64 },
    { path: "properties.depth", label: "Profondeur (tuiles)", kind: "number", min: 2, max: 64 },
    { path: "materials.floor", label: "Sol", kind: "color" }, { path: "materials.wall", label: "Murs", kind: "color" },
  ] }],
};

export async function creatorView(root: HTMLElement, family?: string | null) {
  const s: { step: number; family: Family | null; category: string; def: AssetDefinition | null; tech: string; techTouched: boolean; report: Report | null } =
    { step: family ? 1 : 0, family: (family as Family) || null, category: "", def: null, tech: "", techTouched: false, report: null };
  let game: any = null;
  const body = h("div", { class: "wizard-body" });
  const steps = h("ol", { class: "steps" });
  const nav = h("div", { class: "wizard-nav" });
  fill(root, h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Créer un élément"),
    h("p", { class: "lede" }, "Un parcours guidé : seuls les réglages utiles à la famille choisie sont demandés. Tout reste modifiable ensuite."))), steps, body, nav);

  const models = await api.assets({ status: "published" });

  function setDef() {
    if (!s.family || !s.category) return;
    const extra: any = {};
    if (s.family === "character") {
      const gen = randomCharacter([...ctx.parts.values()].filter((p) => p.published_version), seeded(Date.now() % 100000));
      const d = templateFor("character", s.category, { bodyId: gen?.body ?? "" });
      if (gen) d.properties = { ...d.properties, ...gen };
      s.def = d; return;
    }
    s.def = templateFor(s.family, s.category, extra);
    if (s.family === "building") {
      // un intérieur publié adapté est associé d'office (modifiable ensuite dans l'éditeur)
      const wanted = s.category === "residential" ? "Logement" : s.category === "commerce" ? "Commerce" : s.category === "health" ? "Médical" : null;
      const interiors = models.filter((m) => m.family === "interior");
      const pick = interiors.find((m) => m.subcategory === wanted) ?? (s.category === "residential" ? interiors[0] : null);
      if (pick) {
        s.def.properties.interiors = [{ interior_id: pick.id, label: "Base", min_level: 1 }];
        s.def.behaviors = [{ id: "enter_interior", params: {} }];
      }
      if (s.category === "residential") { s.def.subcategory = "Maison de joueur"; s.def.behaviors.push({ id: "assignable_home", params: {} }); }
      // catégories qui recommandent une entrée de service ou d'urgence (santé, secours) : une est posée d'office
      const rules = ctx.tax!.categories.find((c) => c.key === s.category)?.rules ?? [];
      if (rules.includes("service_entrance_recommended")) {
        const health = s.category === "health";
        s.def.entrances.push({ id: health ? "urgences" : "service", cell: [s.def.footprint.w - 1, s.def.footprint.d - 1], side: "E", kind: health ? "emergency" : "service" });
      }
    }
  }

  function changed(rebuild: boolean) {
    const d = s.def!;
    if (s.family === "road") {
      d.footprint.d = d.footprint.w;
      d.connectors = roadConnectors(d.properties.kind, d.footprint.w, d.properties.lanes, !!d.properties.oneway);
    }
    if (s.family === "building") {
      const min = d.properties.floors * 2.5;
      if (d.height_m < min) d.height_m = Math.round((min + 1) * 2) / 2;
      const main = d.entrances.find((e) => e.kind === "main");
      if (main && (main.cell[0] >= d.footprint.w || main.cell[1] >= d.footprint.d)) main.cell = [0, d.footprint.d - 1];
      if (main) main.cell[1] = d.footprint.d - 1;
      for (const e of d.entrances) if (e.kind !== "main") { e.cell = [d.footprint.w - 1, d.footprint.d - 1]; e.side = "E"; }
    }
    if (s.family === "interior") {
      const ip = d.properties; const r = ip.rooms[0];
      r.w = ip.width; r.d = ip.depth; ip.doors[0].cell = [Math.floor(ip.width / 2), ip.depth - 1]; ip.spawn = [Math.floor(ip.width / 2), ip.depth - 2];
    }
    s.report = null;
    if (rebuild) render();
  }

  function render() {
    if (game) { game.destroy(true); game = null; }
    fill(steps, ...STEPS.map((t, i) => h("li", { class: i === s.step ? "on" : i < s.step ? "done" : "", "aria-current": i === s.step ? "step" : null },
      h("span", { class: "step-n" }, String(i + 1)), h("span", { class: "step-t" }, t))));
    const fam = s.family;
    const back = s.step > 0 ? h("button", { class: "btn", onclick: () => { s.step--; render(); } }, "Précédent") : h("span");
    const next = (label = "Suivant", enabled = true) => h("button", { class: "btn btn-primary", disabled: !enabled, onclick: () => { s.step++; render(); } }, label);
    const cancel = h("button", { class: "btn btn-quiet", onclick: () => go("#/catalogue") }, "Annuler");
    switch (s.step) {
      case 0: {
        const families = Object.keys(ctx.tax!.families) as Family[];
        fill(body, h("div", { class: "fam-grid" }, families.map((f) => familyCard(f, (pick) => {
          if (pick === "character_part") return go("#/composants/nouveau");
          if (pick === "component") return go("#/modulaire/composants");
          s.family = pick; s.category = ""; s.step = 1; render();
        }, f === fam))));
        fill(nav, cancel);
        break;
      }
      case 1: {
        const cats = ctx.tax!.categories.filter((c) => c.family === fam && !c.archived);
        const fmodels = models.filter((m) => m.family === fam).slice(0, 8);
        fill(body, 
          h("p", { class: "muted" }, `Famille : ${famLabel(fam!)}. Choisissez la catégorie métier ; elles se gèrent dans Paramètres du projet.`),
          h("div", { class: "cat-grid" }, cats.map((c) => h("button", { class: `cat-card${s.category === c.key ? " on" : ""}`, onclick: () => { s.category = c.key; setDef(); s.step = 2; render(); } },
            h("strong", {}, c.label), h("span", { class: "small muted" }, c.subcategories.slice(0, 6).join(", ") + (c.subcategories.length > 6 ? "…" : ""))))),
          fmodels.length ? h("div", {}, h("h2", {}, "Ou partir d'un modèle publié"), h("div", { class: "mini-cards" }, fmodels.map((m: AssetSummary) =>
            h("button", { class: "mini", onclick: () => duplicateDialog(m) }, thumbnail(m.preview, m.family, 110), h("span", {}, m.name))))) : null,
          !cats.length ? emptyState("Aucune catégorie pour cette famille.") : null);
        fill(nav, back, cancel);
        break;
      }
      case 2: {
        const d = s.def!;
        const cat = ctx.tax!.categories.find((c) => c.key === s.category)!;
        const tech = h("input", { value: s.tech, required: true, "aria-label": "Identifiant technique" }) as HTMLInputElement;
        tech.addEventListener("input", () => { s.tech = tech.value; s.techTouched = true; });
        const idSec = identitySection(d, cat.subcategories, () => { if (!s.techTouched) { s.tech = slugify(d.name); tech.value = s.tech; } }, false);
        fill(body, idSec, field("Identifiant technique (généré)", tech, "Stable : minuscules, chiffres et tirets. Il sert de référence et ne change jamais, même si le nom change."));
        fill(nav, back, cancel, h("button", { class: "btn btn-primary", onclick: () => {
          if ((d.name ?? "").trim().length < 2) return toast("Donnez un nom d'au moins 2 caractères.", "err");
          if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(s.tech)) return toast("Identifiant technique invalide.", "err");
          s.step++; render();
        } }, "Suivant"));
        (idSec.querySelector("input") as HTMLInputElement)?.focus();
        break;
      }
      case 3: {
        const d = s.def!;
        const specs = QUICK[fam!] ?? familySections(fam!);
        fill(body, ...(fam === "character"
          ? [h("p", {}, "Une tenue compatible a été tirée au sort à partir de la bibliothèque de composants publiés."),
             h("p", { class: "muted" }, "Vous choisirez chaque composant (coiffure, vêtements, accessoires, couleurs) dans l'atelier de personnages juste après l'enregistrement.")]
          : specs.map((sp) => renderSection(sp, d, changed, false))));
        fill(nav, back, cancel, next());
        break;
      }
      case 4: {
        const sec = behaviorsSection(s.def!, fam!, (r) => { if (r) render(); }, false);
        fill(body, sec ?? h("p", { class: "muted" }, "Cette famille n'a pas de comportement configurable."));
        fill(nav, back, cancel, next());
        break;
      }
      case 5: {
        const host = h("div", { class: "stage" });
        const rep = h("div", { class: "panel" }, h("h2", {}, "Vérification du serveur"), h("p", { class: "loading" }, "Vérification…"));
        fill(body, h("div", { class: "wizard-preview" }, host, rep));
        const sc = new PreviewScene();
        sc.state = { family: fam!, def: s.def!, rotation: 0, variant: null, furniture: ctx.tax!.furniture,
          flags: { grid: true, footprint: true, collision: true, entrances: true, connectors: true, zones: true, dims: true } };
        game = mountGame(host, sc);
        api.validateDefinition(s.category, s.def).then((r) => { s.report = r; fill(rep, h("h2", {}, "Vérification du serveur"), reportView(r)); })
          .catch((e) => fill(rep, h("p", { class: "txt-danger" }, (e as Error).message)));
        fill(nav, back, cancel, next());
        break;
      }
      case 6: {
        const status = h("p", { class: "muted", "aria-live": "polite" });
        const doCreate = async (then: "draft" | "submit" | "publish") => {
          status.textContent = "Enregistrement en cours…";
          try {
            let a = await api.create(s.category, s.tech, s.def);
            if (then !== "draft") a = await api.action(a.id, "submit");
            if (then === "publish") { a = await api.action(a.id, "approve"); a = await api.action(a.id, "publish"); }
            toast(then === "publish" ? "Créé et publié" : then === "submit" ? "Créé et soumis à validation" : "Brouillon enregistré");
            openAsset(a.id, a.family);
          } catch (e) {
            status.textContent = "";
            toast((e as Error).message, "err");
            const err = e as any;
            if (err.report) body.append(h("div", { class: "panel" }, reportView(err.report)));
          }
        };
        fill(body, h("div", { class: "panel" },
          h("h2", {}, s.def!.name),
          h("p", {}, `${famLabel(fam!)} · ${ctx.tax!.categories.find((c) => c.key === s.category)?.label} · `, h("code", {}, s.tech)),
          s.report ? reportView(s.report) : null,
          h("p", { class: "muted" }, "Un brouillon reste modifiable et n'apparaît pas dans le catalogue du jeu. La publication relance toutes les vérifications."),
          status));
        fill(nav, back, cancel,
          h("button", { class: "btn", onclick: async () => { s.report = await api.validateDefinition(s.category, s.def); render(); } }, "Valider"),
          can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => doCreate("draft") }, "Enregistrer comme brouillon") : null,
          can("asset.edit") ? h("button", { class: "btn", onclick: () => doCreate("submit") }, "Enregistrer et soumettre") : null,
          can("asset.validate") && can("asset.publish") ? h("button", { class: "btn", onclick: () => doCreate("publish") }, "Enregistrer et publier") : null);
        break;
      }
    }
  }
  if (s.family) { /* famille imposée par l'URL : on commence à la catégorie */ }
  render();
  return () => { if (game) game.destroy(true); };
}
