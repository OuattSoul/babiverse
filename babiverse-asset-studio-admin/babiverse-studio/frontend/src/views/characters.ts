// Atelier de personnages modulaires : chaque calque (corps, visage, coiffure, vêtements, accessoires, motifs)
// se change indépendamment ; seules les options réellement présentes dans la bibliothèque sont proposées.
import { api, ApiError, type AssetAction } from "../api";
import { go } from "../router";
import { checkOutfit, composePart, effective, fitsGender, randomCharacter, seeded, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, type CharacterProps, type Layer } from "../character/compose";
import { svgImage, svgDataUrl } from "../character/svgimg";
import { mountGame, PreviewScene } from "../render/stage";
import { characterTemplate } from "../templates";
import type { AssetDetail, AssetSummary, PartPayload, Variant } from "../types";
import { can, characterSvg, ctx, emptyState, field, h, modal, partsRecord, pill, refreshParts, reportView, slugify, slotLabel, toast, uniqueId, fill } from "../ui";
import { duplicateDialog } from "./catalog";
import { historyPanel, usagePanel } from "./editorParts";

const GROUPS: { title: string; slots: string[] }[] = [
  { title: "Cheveux", slots: ["hair", "hair_accessory"] },
  { title: "Visage", slots: ["eyes", "eyebrows", "nose", "mouth", "beard", "makeup"] },
  { title: "Vêtements", slots: ["top", "outerwear", "bottom", "dress"] },
  { title: "Chaussures", slots: ["shoes"] },
  { title: "Accessoires", slots: ["glasses", "headwear", "bag", "watch", "jewelry"] },
];
const BACKGROUNDS: Record<string, string> = { clair: "#eef3f1", rue: "#9fb08a", sable: "#e6d3a3", nuit: "#1d2a3a", mur: "#e9d7ad" };
const thumbCache = new Map<string, string>();

function partThumb(part: PartPayload, body: PartPayload | undefined, colors?: Record<string, string>): HTMLImageElement {
  const key = `${part.id}@${part.version}|${body?.id ?? ""}|${JSON.stringify(colors ?? {})}`;
  let url = thumbCache.get(key);
  if (!url) { url = svgDataUrl(composePart(part, { ghostBody: part.slot === "body" ? null : body, colors })); thumbCache.set(key, url); }
  const img = h("img", { src: url, alt: part.name, loading: "lazy" });
  return img;
}

// ------------------------------------------------------------------ liste des habitants

export async function charactersView(root: HTMLElement) {
  await refreshParts();
  const list = await api.assets({ family: "character" });
  const parts = [...ctx.parts.values()];
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Atelier de personnages"),
      h("p", { class: "lede" }, `Habitants de Cité Akwaba composés de calques SVG. Bibliothèque : ${parts.length} composants dans ${new Set(parts.map((p) => p.slot)).size} emplacements.`)),
      h("div", { class: "row" },
        h("a", { class: "btn", href: "#/composants" }, "Bibliothèque de composants"),
        h("a", { class: "btn", href: "#/personnages/foule" }, "Générer des habitants"),
        can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => newCharacter() }, "Nouvel habitant") : null)),
    list.length ? h("div", { class: "char-cards" }, list.map((a) => h("button", { class: "char-card", onclick: () => go(`#/personnages/${a.id}`), "data-asset": a.technical_name },
      svgImage(characterSvg(a.preview.properties, null, { background: "#eef3f1" }), a.name),
      h("strong", {}, a.name), h("span", { class: "small muted" }, a.subcategory ?? ""), pill(a.status),
      a.variants ? h("span", { class: "small muted" }, `${a.variants} tenue(s)`) : null)))
      : emptyState("Aucun habitant pour l'instant.", can("asset.create") ? h("button", { class: "btn btn-primary", onclick: () => newCharacter() }, "Créer le premier") : null));
}

export async function newCharacter(props?: CharacterProps, name = "Nouvel habitant") {
  const lib = [...ctx.parts.values()].filter((p) => !p.archived);
  const gen = props ?? randomCharacter(lib.filter((p) => p.published_version), seeded(Date.now() % 99991)) ?? randomCharacter(lib, seeded(7));
  if (!gen) return toast("La bibliothèque ne contient aucun corps : importez d'abord un composant « Corps ».", "err");
  const d = characterTemplate(gen.body);
  d.name = name; d.properties = { ...d.properties, ...gen };
  d.subcategory = "Habitant";
  const tech = `${slugify(name)}-${Date.now().toString(36).slice(-4)}`;
  try { const a = await api.create("characters", tech, d); toast("Brouillon créé"); go(`#/personnages/${a.id}`); }
  catch (e) { toast((e as Error).message, "err"); }
}

// ------------------------------------------------------------------ foule de quartier

export async function crowdView(root: HTMLElement) {
  await refreshParts();
  let seed = Math.floor(Math.random() * 100000);
  let n = 12;
  let onlyPublished = true;
  let bg = "rue";
  const grid = h("div", {});
  const count = h("input", { type: "number", min: 2, max: 40, value: n, class: "num", "aria-label": "Nombre d'habitants" }) as HTMLInputElement;
  const pub = h("input", { type: "checkbox", checked: onlyPublished }) as HTMLInputElement;
  const bgSel = h("select", { "aria-label": "Fond" }, Object.keys(BACKGROUNDS).map((k) => h("option", { value: k, selected: k === bg }, k))) as HTMLSelectElement;
  let crowd: (CharacterProps | null)[] = [];
  const picked = new Set<number>();
  function gen() {
    const lib = [...ctx.parts.values()].filter((p) => !p.archived && (!onlyPublished || p.published_version));
    const rng = seeded(seed);
    crowd = Array.from({ length: n }, () => randomCharacter(lib, rng));
    picked.clear();
    draw();
  }
  function draw() {
    const color = BACKGROUNDS[bg];
    fill(grid, 
      h("h2", {}, "Lisibilité à la taille de la ville (40 px)"),
      h("div", { class: "crowd crowd-small", style: { background: color } }, crowd.map((c) => c ? svgImage(characterSvg(c), "") : null)),
      h("h2", {}, "Taille de fiche (96 px) — touchez pour sélectionner"),
      h("div", { class: "crowd crowd-large", style: { background: color } }, crowd.map((c, i) => c ? h("button", { class: `crowd-pick${picked.has(i) ? " on" : ""}`, "aria-pressed": String(picked.has(i)),
        onclick: () => { if (picked.has(i)) picked.delete(i); else picked.add(i); draw(); } }, svgImage(characterSvg(c), `Habitant ${i + 1}`)) : null)),
      h("p", { class: "muted" }, `${new Set(crowd.filter(Boolean).map((c) => JSON.stringify(c!.layers))).size} combinaisons distinctes, toutes compatibles avec les règles des composants.`));
  }
  count.addEventListener("change", () => { n = Math.max(2, Math.min(40, Number(count.value))); gen(); });
  pub.addEventListener("change", () => { onlyPublished = pub.checked; gen(); });
  bgSel.addEventListener("change", () => { bg = bgSel.value; draw(); });
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Foule de quartier"),
      h("p", { class: "lede" }, "Habitants tirés au sort parmi les combinaisons compatibles, sans aucun dessin supplémentaire.")),
      h("a", { class: "btn", href: "#/personnages" }, "Retour à l'atelier")),
    h("div", { class: "filters" }, field("Nombre", count), h("label", { class: "toggle" }, pub, "Composants publiés seulement"), field("Fond", bgSel),
      h("button", { class: "btn", onclick: () => { seed = Math.floor(Math.random() * 100000); gen(); } }, "Régénérer"),
      can("asset.create") ? h("button", { class: "btn btn-primary", onclick: async () => {
        if (!picked.size) return toast("Sélectionnez au moins un habitant.", "err");
        let ok = 0;
        for (const i of picked) {
          const c = crowd[i]!;
          const d = characterTemplate(c.body); d.properties = { ...d.properties, ...c }; d.name = `Habitant n°${seed % 1000}-${i + 1}`; d.subcategory = "Habitant";
          try { await api.create("characters", `habitant-${seed}-${i + 1}`, d); ok++; } catch (e) { toast((e as Error).message, "err"); }
        }
        toast(`${ok} habitant(s) enregistré(s) en brouillon`);
        picked.clear(); draw();
      } }, "Enregistrer la sélection") : null),
    grid);
  gen();
}

// ------------------------------------------------------------------ studio d'un personnage

export async function characterStudio(root: HTMLElement, id: string): Promise<() => void> {
  await refreshParts();
  let asset: AssetDetail = await api.asset(id);
  if (asset.family !== "character") { go(`#/asset/${id}`); return () => {}; }
  let def = structuredClone(asset.definition);
  let dirty = false;
  let editing: string = "";          // "" = tenue de base, sinon identifiant de variante
  let bg = "clair";
  let view: "pied" | "portrait" | "ville" | "iso" = "pied";
  let others: AssetSummary[] = [];
  let game: any = null;
  api.assets({ family: "character", status: "published" }).then((l) => { others = l.filter((a) => a.id !== id); if (view === "ville") renderPreview(); });

  const editable = () => asset.versions[asset.versions.length - 1].status === "draft" && !asset.archived && can("asset.edit");
  const props = () => def.properties as CharacterProps;
  const variant = (): Variant | null => def.variants.find((v: Variant) => v.id === editing) ?? null;
  const eff = () => effective(props(), variant());
  const lib = () => [...ctx.parts.values()].filter((p) => !p.archived);
  const body = () => ctx.parts.get(eff().body);

  const head = h("header", { class: "ed-head" });
  const banner = h("div", { class: "ed-banner" });
  const preview = h("div", { class: "char-preview" });
  const previewBar = h("div", { class: "bar-row" });
  const issues = h("div", { class: "panel" });
  const controls = h("div", { class: "char-controls" });
  const side = h("div", { class: "ed-side" });
  fill(root, h("div", { class: "editor" }, head, banner,
    h("div", { class: "char-body" },
      h("section", { class: "char-stage", "aria-label": "Aperçu du personnage" }, previewBar, preview, issues, side),
      controls)));

  function changed() { dirty = true; renderHead(); renderPreview(); renderIssues(); renderControls(); }

  // --------------------------------------------------- écriture dans la tenue de base ou la variante
  function setLayer(slot: string, layer: Layer | null) {
    const v = variant();
    if (v) {
      v.props.layers ??= {};
      const baseHas = !!props().layers[slot];
      if (layer === null) { if (baseHas) v.props.layers[slot] = null; else delete v.props.layers[slot]; }
      else v.props.layers[slot] = layer;
    } else {
      if (layer === null) delete props().layers[slot]; else props().layers[slot] = layer;
    }
    changed();
  }
  function setGlobal(key: "skin" | "hair_color" | "eye_color", value: string) {
    const v = variant();
    if (v) v.props[key] = value; else (props() as any)[key] = value;
    changed();
  }

  // --------------------------------------------------- en-tête et actions
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
    if (can("asset.create")) acts.push(btn("Dupliquer", () => duplicateDialog({ ...asset, family: "character" })));
    if (can("asset.archive")) acts.push(asset.archived ? btn("Restaurer", () => act("restore")) : btn("Archiver", () => act("archive"), "btn btn-quiet"));
    const name = h("input", { value: def.name, class: "title-input", disabled: !editable(), "aria-label": "Nom du personnage" }) as HTMLInputElement;
    name.addEventListener("change", () => { def.name = name.value; dirty = true; renderHead(); });
    const role = h("input", { value: props().role ?? "", disabled: !editable(), placeholder: "Rôle dans le quartier", "aria-label": "Rôle" }) as HTMLInputElement;
    role.addEventListener("change", () => { props().role = role.value; def.description = role.value; dirty = true; renderHead(); });
    fill(head, h("div", { class: "ed-title" },
      h("button", { class: "back", onclick: () => go("#/personnages"), "aria-label": "Retour" }, "‹"),
      h("div", {}, name, h("p", { class: "meta" }, pill(asset.status), ` v${asset.latest_version}`, asset.published_version ? ` (publiée : v${asset.published_version})` : "",
        " · ", h("code", {}, asset.technical_name), " · ", role))),
      h("div", { class: "ed-actions" }, acts));
    fill(banner);
    if (!editable()) banner.append(h("p", {}, asset.archived ? "Personnage archivé." : latest.status === "published" ? "Version publiée et figée : ses composants exacts sont figés aussi. Créez une nouvelle version pour la modifier." : "Lecture seule."));
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
      h("div", { class: "seg", role: "group", "aria-label": "Vue" }, ([["pied", "En pied"], ["portrait", "Portrait"], ["ville", "En situation"], ["iso", "Vue isométrique"]] as const)
        .map(([k, l]) => h("button", { class: view === k ? "on" : "", onclick: () => { view = k; renderPreview(); } }, l))),
      h("select", { "aria-label": "Fond", onchange: (e: Event) => { bg = (e.target as HTMLSelectElement).value; renderPreview(); } },
        Object.keys(BACKGROUNDS).map((k) => h("option", { value: k, selected: k === bg }, `Fond ${k}`))),
      def.variants.length ? h("select", { "aria-label": "Tenue affichée et modifiée", onchange: (e: Event) => { editing = (e.target as HTMLSelectElement).value; renderPreview(); renderIssues(); renderControls(); } },
        h("option", { value: "" }, "Tenue de base"), def.variants.map((v: Variant) => h("option", { value: v.id, selected: v.id === editing }, `Tenue : ${v.name}`))) : null,
      h("span", { class: "small muted" }, "Pose : vue de face uniquement (aucune animation n'existe dans le moteur)."));
    const p = props(), v = variant();
    const color = BACKGROUNDS[bg];
    if (view === "pied" || view === "portrait") {
      fill(preview, h("div", { class: `char-big ${view}`, style: { background: color } }, svgImage(characterSvg(p, v, { crop: view === "portrait" ? "portrait" : "full" }), def.name)));
    } else if (view === "ville") {
      const crowd = others.slice(0, 5).map((o) => characterSvg(o.preview.properties));
      fill(preview, h("div", { class: "char-situ", style: { background: color } },
        h("div", { class: "situ-row" }, h("span", { class: "small" }, "96 px"), svgImage(characterSvg(p, v), def.name), ...crowd.map((s) => svgImage(s, ""))),
        h("div", { class: "situ-row small-row" }, h("span", { class: "small" }, "40 px"), svgImage(characterSvg(p, v), def.name), ...crowd.map((s) => svgImage(s, ""))),
        h("p", { class: "small muted" }, "Côte à côte avec les habitants publiés, aux tailles d'une fiche et de la ville.")));
    } else {
      const host = h("div", { class: "stage stage-char" });
      fill(preview, host);
      const sc = new PreviewScene();
      sc.state = { family: "character", def, rotation: 0, variant: v, furniture: {}, background: parseInt(color.slice(1), 16),
        flags: { grid: true, footprint: false, collision: false, entrances: false, connectors: false, zones: false, dims: false } };
      game = mountGame(host, sc);
    }
  }

  function renderIssues() {
    const local = checkOutfit(eff(), partsRecord(), Object.fromEntries(Object.entries(ctx.tax!.character_slots).map(([k, s]) => [k, s.label])));
    fill(issues, h("h2", {}, "Compatibilité"),
      local.length ? h("ul", { class: "report" }, local.map((i) => h("li", { class: "rep-error" }, h("strong", {}, slotLabel(i.slot)), " ", i.message)))
        : h("p", { class: "report-ok" }, `Tenue ${editing ? `« ${variant()?.name} »` : "de base"} compatible.`),
      h("h3", {}, "Rapport du serveur (dernier enregistrement)"), reportView(asset.validation));
  }

  // --------------------------------------------------- commandes par calque
  function slotPicker(slot: string): HTMLElement {
    const e = eff();
    const cur = e.layers[slot] ?? null;
    const b = body();
    // les composants réservés à l'autre genre ne sont pas proposés (un homme ne met ni rouge à lèvres ni talons)
    const all = lib().filter((p) => p.slot === slot);
    const options = all.filter((p) => fitsGender(p, b));
    const hiddenN = all.length - options.length;
    const parts = partsRecord();
    const reason = (p: PartPayload): string | null => {
      const trial = structuredClone(e); trial.layers[slot] = { part: p.id, colors: {} };
      const iss = checkOutfit(trial, parts).filter((i) => !i.message.startsWith("Tenue incomplète"));
      return iss.length ? iss[0].message : null;
    };
    const dis = !editable();
    const tiles = h("div", { class: "part-tiles", role: "listbox", "aria-label": slotLabel(slot) },
      ["bottom", "top", "shoes", "eyes"].includes(slot) ? null : h("button", { class: `part-tile${!cur ? " on" : ""}`, disabled: dis, onclick: () => setLayer(slot, null), role: "option", "aria-selected": String(!cur) }, h("span", { class: "none" }, "Aucun")),
      options.map((p) => {
        const why = reason(p);
        return h("button", { class: `part-tile${cur?.part === p.id ? " on" : ""}${why ? " incompat" : ""}`, disabled: dis, title: why ? `Incompatible : ${why}` : p.name,
          role: "option", "aria-selected": String(cur?.part === p.id), "data-part": p.technical_name,
          onclick: () => {
            if (why && !confirm(`${why}\nChoisir quand même ? La tenue sera signalée incompatible.`)) return;
            setLayer(slot, { part: p.id, colors: cur?.part === p.id ? cur.colors ?? {} : {} , pattern: cur?.part === p.id ? cur.pattern ?? null : null });
          } }, partThumb(p, b), h("span", {}, p.name), p.published_version ? null : h("span", { class: "tag" }, "brouillon"));
      }));
    const gLabel = b?.props?.gender === "male" ? "aux femmes" : "aux hommes";
    const out = h("div", { class: "slot", "data-slot": slot }, h("h3", {}, slotLabel(slot)),
      options.length ? tiles : h("p", { class: "muted small" }, hiddenN ? `Emplacement réservé ${gLabel} pour cette silhouette.` : "Aucun composant de ce type dans la bibliothèque."),
      options.length && hiddenN ? h("p", { class: "small muted" }, `${hiddenN} composant(s) réservé(s) ${gLabel} non proposé(s).`) : null);
    if (cur) {
      const part = ctx.parts.get(cur.part);
      if (part) out.append(colorControls(slot, cur, part));
    }
    return out;
  }

  function swatches(current: string, palette: string[], onPick: (c: string) => void, free = true): HTMLElement {
    const dis = !editable();
    const custom = h("input", { type: "color", value: current, disabled: dis, "aria-label": "Couleur personnalisée" }) as HTMLInputElement;
    custom.addEventListener("change", () => onPick(custom.value));
    return h("div", { class: "swatch-row" }, palette.map((c) => h("button", { class: `sw${c.toLowerCase() === current.toLowerCase() ? " on" : ""}`, style: { background: c }, disabled: dis, title: c, "aria-label": `Couleur ${c}`, onclick: () => onPick(c) })),
      free ? custom : null);
  }

  function colorControls(slot: string, layer: Layer, part: PartPayload): HTMLElement {
    const chans = ["primary", "secondary", "accent"].filter((c) => c in (part.channels ?? {}));
    const box = h("div", { class: "layer-colors" });
    if (!chans.length) {
      const globals = ["skin", "hair", "eyes"].filter((c) => c in (part.channels ?? {}));
      const lab: Record<string, string> = { skin: "la teinte de peau", hair: "la couleur des cheveux", eyes: "la couleur des yeux" };
      box.append(h("p", { class: "small muted" }, globals.length ? `Couleur réglée par ${globals.map((g) => lab[g]).join(" et ")}.` : "Composant non recolorable : couleurs d'origine."));
      return box;
    }
    const names: Record<string, string> = { primary: "Couleur principale", secondary: "Couleur secondaire", accent: "Couleur d'accent" };
    for (const ch of chans) {
      const pal: string[] = part.props?.palette?.[ch] ?? [];
      const cur = layer.colors?.[ch] ?? part.props?.default_colors?.[ch] ?? part.channels[ch];
      box.append(h("div", { class: "field" }, h("span", {}, names[ch], pal.length ? h("small", {}, " (palette imposée)") : null),
        swatches(cur, pal.length ? pal : CLOTH_COLORS, (c) => setLayer(slot, { ...layer, colors: { ...(layer.colors ?? {}), [ch]: c } }), !pal.length)));
    }
    if (["top", "bottom", "dress", "outerwear"].includes(slot) && chans.includes("primary")) {
      const patterns = lib().filter((p) => p.slot === "pattern");
      if (patterns.length) {
        const pat = layer.pattern ?? null;
        const sel = h("select", { disabled: !editable(), "aria-label": "Motif" }, h("option", { value: "" }, "Sans motif"),
          patterns.map((p) => h("option", { value: p.id, selected: pat?.part === p.id }, p.name))) as HTMLSelectElement;
        sel.addEventListener("change", () => setLayer(slot, { ...layer, pattern: sel.value ? { part: sel.value, colors: {}, channel: "primary", scale: 1 } : null }));
        const row = h("div", { class: "field" }, h("span", {}, "Motif"), sel);
        if (pat) {
          const pp = ctx.parts.get(pat.part);
          if (pp) {
            row.append(h("div", { class: "pattern-prev" }, svgImage(composePart(pp, { colors: pat.colors }), pp.name)));
            for (const ch of Object.keys(pp.channels ?? {})) {
              const cur = pat.colors?.[ch] ?? pp.props?.default_colors?.[ch] ?? pp.channels[ch];
              row.append(h("small", {}, `Motif — ${names[ch] ?? ch}`), swatches(cur, CLOTH_COLORS, (c) => setLayer(slot, { ...layer, pattern: { ...pat, colors: { ...(pat.colors ?? {}), [ch]: c } } })));
            }
            const sc = h("input", { type: "range", min: 0.5, max: 2.5, step: 0.25, value: pat.scale ?? 1, disabled: !editable(), "aria-label": "Taille du motif" }) as HTMLInputElement;
            sc.addEventListener("change", () => setLayer(slot, { ...layer, pattern: { ...pat, scale: Number(sc.value) } }));
            row.append(field("Taille du motif", sc));
          }
        }
        box.append(row);
      }
    }
    return box;
  }

  function bodyControls(): HTMLElement {
    const e = eff();
    const bodies = lib().filter((p) => p.slot === "body");
    const dis = !editable();
    const hs = h("input", { type: "range", min: 0.85, max: 1.15, step: 0.01, value: props().height_scale ?? 1, disabled: dis, "aria-label": "Taille" }) as HTMLInputElement;
    hs.addEventListener("change", () => { props().height_scale = Number(hs.value); changed(); });
    return h("div", { class: "slot", "data-slot": "body" },
      h("h3", {}, "Silhouette"),
      h("div", { class: "part-tiles" }, bodies.map((p) => h("button", { class: `part-tile${e.body === p.id ? " on" : ""}`, disabled: dis || !!editing, title: editing ? "La silhouette se choisit sur la tenue de base" : p.name,
        onclick: () => {
          // changer de silhouette retire les composants réservés à l'autre genre (tenue de base et variantes)
          const removed = new Set<string>();
          const clean = (layers: Record<string, Layer | null | undefined>) => {
            for (const [slot, layer] of Object.entries(layers ?? {})) {
              const part = layer && ctx.parts.get(layer.part);
              if (part && !fitsGender(part, p)) { delete layers[slot]; removed.add(part.name); }
            }
          };
          props().body = p.id;
          clean(props().layers);
          for (const v of def.variants as Variant[]) clean(v.props.layers ?? {});
          if (removed.size) toast(`Retiré (réservé à l'autre genre) : ${[...removed].join(", ")}`);
          changed();
        } }, partThumb(p, undefined), h("span", {}, p.name), p.props?.gender ? h("span", { class: "tag" }, p.props.gender === "female" ? "femme" : "homme") : null))),
      h("div", { class: "field" }, h("span", {}, "Teinte de peau"), swatches(e.skin, SKIN_TONES, (c) => setGlobal("skin", c))),
      field("Taille (morphologie dans les limites du modèle : ±15 %)", hs));
  }

  function renderControls() {
    const sy = controls.scrollTop;
    const e = eff();
    const sections = [
      h("details", { class: "sec", open: true }, h("summary", {}, "Corps"), h("div", { class: "sec-body" }, bodyControls())),
      ...GROUPS.map((g) => h("details", { class: "sec", open: g.title !== "Accessoires" }, h("summary", {}, g.title), h("div", { class: "sec-body" },
        g.title === "Cheveux" ? h("div", { class: "field" }, h("span", {}, "Couleur des cheveux, sourcils et barbe"), swatches(e.hair_color, HAIR_COLORS, (c) => setGlobal("hair_color", c))) : null,
        g.title === "Visage" ? h("div", { class: "field" }, h("span", {}, "Couleur des yeux"), swatches(e.eye_color, ["#2a1a10", "#3b2414", "#4a3020", "#2f4f4f", "#3b5323"], (c) => setGlobal("eye_color", c))) : null,
        g.slots.map(slotPicker)))),
      variantsPanel(),
    ];
    fill(controls, ...sections);
    controls.scrollTop = sy;
  }

  function variantsPanel(): HTMLElement {
    const dis = !editable();
    return h("details", { class: "sec", open: true, id: "sec-variants" }, h("summary", {}, "Tenues et variantes"), h("div", { class: "sec-body" },
      h("p", { class: "muted" }, "Une tenue (préréglage) ne stocke que les calques qui diffèrent de la tenue de base. Choisissez la tenue à modifier dans la barre de l'aperçu."),
      def.variants.length ? h("ul", { class: "list" }, def.variants.map((v: Variant, i: number) => h("li", { class: "row" },
        h("button", { class: `btn btn-small${editing === v.id ? " btn-primary" : ""}`, onclick: () => { editing = editing === v.id ? "" : v.id; renderPreview(); renderIssues(); renderControls(); } }, editing === v.id ? `Modification : ${v.name}` : v.name),
        h("span", { class: "small muted" }, `${Object.keys(v.props.layers ?? {}).length} calque(s) modifié(s)`),
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => { const c = structuredClone(v); c.id = uniqueId(def.variants, "tenue"); c.name = `${v.name} (copie)`; def.variants.push(c); changed(); } }, "Dupliquer"),
        h("button", { class: "icon-btn", disabled: dis, "aria-label": "Supprimer la tenue", onclick: () => { def.variants.splice(i, 1); if (editing === v.id) editing = ""; changed(); } }, "×")))) : h("p", { class: "small muted" }, "Aucune tenue enregistrée."),
      h("div", { class: "row" },
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => {
          const name = prompt("Nom de la nouvelle tenue", "Tenue du dimanche"); if (!name) return;
          const v: Variant = { id: uniqueId(def.variants, slugify(name).slice(0, 30) || "tenue"), name, materials: {}, props: { layers: {} } };
          def.variants.push(v); editing = v.id; changed();
        } }, "Nouvelle tenue"),
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => importOutfit() }, "Reprendre la tenue d'un autre personnage"),
        h("button", { class: "btn btn-small", disabled: dis, onclick: () => {
          const r = randomCharacter(lib().filter((p) => p.published_version), seeded(Date.now() % 99991));
          if (!r) return;
          const clothes = ["top", "bottom", "dress", "outerwear", "shoes", "headwear", "bag"];
          for (const s of clothes) setLayerQuiet(s, r.layers[s] ?? null);
          changed();
        } }, "Tenue au hasard"))));
  }
  function setLayerQuiet(slot: string, layer: Layer | null) {
    const v = variant();
    if (v) { v.props.layers ??= {}; if (layer === null) { if (props().layers[slot]) v.props.layers[slot] = null; else delete v.props.layers[slot]; } else v.props.layers[slot] = layer; }
    else if (layer === null) delete props().layers[slot]; else props().layers[slot] = layer;
  }
  async function importOutfit() {
    const all = (await api.assets({ family: "character" })).filter((a) => a.id !== id);
    const sel = h("select", {}, all.flatMap((a) => [h("option", { value: `${a.id}|` }, `${a.name} — tenue de base`),
      ...a.preview.variants.map((v) => h("option", { value: `${a.id}|${v.id}` }, `${a.name} — ${v.name}`))])) as HTMLSelectElement;
    const close = modal("Reprendre une tenue", h("div", { class: "fields" }, h("label", {}, "Tenue source", sel),
      h("p", { class: "muted" }, "Les vêtements, chaussures et accessoires sont copiés dans la tenue en cours d'édition ; le visage et la silhouette ne changent pas.")), [
      { label: "Reprendre", run: () => {
        const [aid, vid] = sel.value.split("|");
        const src = all.find((a) => a.id === aid)!;
        const srcEff = effective(src.preview.properties, src.preview.variants.find((v) => v.id === vid) ?? null);
        for (const s of ["top", "bottom", "dress", "outerwear", "shoes", "headwear", "bag", "watch", "jewelry", "glasses"]) setLayerQuiet(s, srcEff.layers[s] ?? null);
        close(); changed();
      } }]);
  }

  async function renderSide() {
    fill(side, historyPanel(asset, (a) => { asset = a; def = structuredClone(a.definition); dirty = false; rerender(); }), usagePanel(asset));
  }

  function rerender() { renderHead(); renderPreview(); renderIssues(); renderControls(); renderSide(); }
  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
  window.addEventListener("beforeunload", beforeUnload);
  const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (editable() && dirty) save(); } };
  window.addEventListener("keydown", key);
  rerender();
  return () => { window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("keydown", key); if (game) game.destroy(true); };
}
