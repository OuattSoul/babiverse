// Bibliothèque des composants de personnage, import sécurisé de SVG et éditeur de composant.
import { api, ApiError, type AssetAction } from "../api";
import { go } from "../router";
import { composeCharacter, composePart, REFERENCE_ANCHORS, type CharacterProps } from "../character/compose";
import { svgImage } from "../character/svgimg";
import { partTemplate } from "../templates";
import type { AssetDetail, Media, PartPayload } from "../types";
import { can, ctx, emptyState, field, fmtSize, h, partsRecord, pill, refreshMedia, refreshParts, reportView, row, slotLabel, slugify, toast, fill } from "../ui";
import { historyPanel, usagePanel } from "./editorParts";

const CHANNEL_LABEL: Record<string, string> = { "": "Couleur fixe", skin: "Peau", hair: "Cheveux", eyes: "Yeux", primary: "Couleur principale", secondary: "Couleur secondaire", accent: "Couleur d'accent" };

export async function partsView(root: HTMLElement) {
  await refreshParts();
  const all = await api.assets({ family: "character_part" });
  const bySlot = new Map<string, typeof all>();
  for (const a of all) { const s = a.preview.properties.slot; bySlot.set(s, [...(bySlot.get(s) ?? []), a]); }
  const body = [...ctx.parts.values()].find((p) => p.slot === "body");
  const filter = h("select", { "aria-label": "Emplacement" }, h("option", { value: "" }, "Tous les emplacements"),
    Object.entries(ctx.tax!.character_slots).map(([k, s]) => h("option", { value: k }, `${s.label} (${bySlot.get(k)?.length ?? 0})`))) as HTMLSelectElement;
  const grid = h("div", {});
  const draw = () => fill(grid, ...[...bySlot.entries()].filter(([k]) => !filter.value || k === filter.value).map(([slot, list]) =>
    h("section", { class: "slot-group" }, h("h2", {}, slotLabel(slot)), h("div", { class: "part-lib" }, list.map((a) => {
      const p = ctx.parts.get(a.id);
      return h("button", { class: "part-card", onclick: () => go(`#/composants/${a.id}`), "data-asset": a.technical_name },
        p ? svgImage(composePart(p, { ghostBody: slot === "body" || slot === "pattern" ? null : body })) : h("span", { class: "muted" }, a.archived ? "archivé" : "—"),
        h("span", {}, a.name), pill(a.status));
    })))));
  filter.addEventListener("change", draw);
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Composants de personnage"),
      h("p", { class: "lede" }, "Calques SVG réutilisables par tous les habitants. Repère commun 0 0 200 380, couleurs par canaux. Un composant publié peut être utilisé par un personnage publié.")),
      can("media.upload") && can("asset.create") ? h("a", { class: "btn btn-primary", href: "#/composants/nouveau" }, "Importer un composant SVG") : null),
    h("div", { class: "filters" }, filter, h("a", { class: "btn", href: "#/personnages" }, "Atelier de personnages")),
    all.length ? grid : emptyState("Aucun composant."));
  draw();
}

// ------------------------------------------------------------------ import d'un SVG

export async function importPartView(root: HTMLElement) {
  let media: Media | null = null;
  const area = h("div", { class: "import-steps" });
  const file = h("input", { type: "file", accept: ".svg,image/svg+xml", "aria-label": "Fichier SVG" }) as HTMLInputElement;
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Importer un composant SVG"),
      h("p", { class: "lede" }, "Le fichier est vérifié et assaini par le serveur (scripts, liens externes, images intégrées et DOCTYPE refusés ou retirés). Seul le SVG nettoyé est conservé."))),
    h("div", { class: "panel" }, h("h2", {}, "1. Choisir le fichier"), field("Fichier SVG depuis cet appareil", file,
      `SVG uniquement · ${ctx.tax!.limits.upload_mb} Mo maximum · idéalement dessiné dans le repère 0 0 200 380 (axe vertical x = 100).`)),
    area);
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    if (!f) return;
    fill(area, h("p", { class: "loading" }, "Vérification par le serveur…"));
    try {
      media = await api.uploadMedia(f, f.name, { category: "character_part", name: f.name.replace(/\.svg$/i, "") });
      await refreshMedia();
      step2();
    } catch (e) { fill(area, h("div", { class: "panel" }, h("p", { class: "txt-danger" }, (e as Error).message))); }
  });

  async function step2() {
    const m = media!;
    const svg = (await api.mediaSvg(m.id)).svg;
    const vb = m.meta.view_box ?? [];
    const frameOk = vb.join(" ") === "0 0 200 380";
    const colors = Object.keys(m.meta.colors ?? {});
    const chans = Object.keys(m.meta.channels ?? {});
    const map: Record<string, string> = {};
    const mapping = h("div", { class: "table" }, colors.map((c) => {
      const s = h("select", { "aria-label": `Canal pour ${c}` }, Object.entries(CHANNEL_LABEL).map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
      s.addEventListener("change", () => { if (s.value) map[c] = s.value; else delete map[c]; });
      return h("div", { class: "trow" }, h("span", { class: "sw", style: { background: c } }), h("code", {}, c), h("span", { class: "small muted" }, `${m.meta.colors![c]} élément(s)`), s);
    }));
    const slot = h("select", { "aria-label": "Emplacement" }, Object.entries(ctx.tax!.character_slots).map(([k, s]) => h("option", { value: k }, s.label))) as HTMLSelectElement;
    const name = h("input", { value: m.name }) as HTMLInputElement;
    fill(area, 
      h("div", { class: "panel import-check" }, h("h2", {}, "2. Vérification et aperçu"),
        h("div", { class: "split" }, h("div", { class: "svg-prev checker" }, svgImage(svg, m.name)),
          h("div", {},
            h("p", {}, `viewBox : `, h("code", {}, vb.join(" ")), frameOk ? h("span", { class: "tag tag-ok" }, "repère commun") : h("span", { class: "tag tag-err" }, "repère différent : réglez échelle et décalage ensuite")),
            h("p", {}, `${fmtSize(m.size)} · ${colors.length} couleur(s) fixe(s) · canaux recolorables : ${chans.length ? chans.join(", ") : "aucun"}`),
            m.meta.has_back_layer ? h("p", { class: "small" }, "Contient un calque arrière (data-babi-layer=\"back\").") : null,
            m.meta.warnings?.length ? h("ul", { class: "report" }, m.meta.warnings.map((w) => h("li", { class: "rep-warning" }, w))) : h("p", { class: "report-ok" }, "Aucun contenu dangereux détecté.")))),
      h("div", { class: "panel" }, h("h2", {}, "3. Couleurs personnalisables"),
        h("p", { class: "muted" }, "Un SVG quelconque n'est pas recolorable. Associez chaque couleur à un canal pour la rendre modifiable ; « Couleur fixe » conserve le rendu d'origine. Convention : style=\"fill:var(--babi-<canal>, couleur)\"."),
        colors.length ? mapping : h("p", { class: "muted" }, "Aucune couleur fixe détectée."),
        colors.length ? h("button", { class: "btn", onclick: async () => {
          if (!Object.keys(map).length) return toast("Choisissez au moins un canal.", "err");
          try { media = await api.assignChannels(m.id, map); await refreshMedia(); toast(`Convention appliquée (révision ${media.revision})`); step2(); } catch (e) { toast((e as Error).message, "err"); }
        } }, "Appliquer la convention de couleurs") : null),
      h("div", { class: "panel" }, h("h2", {}, "4. Créer le composant"),
        row(field("Nom", name), field("Emplacement", slot)),
        h("button", { class: "btn btn-primary", onclick: async () => {
          const d = partTemplate(m.id, slot.value);
          d.name = name.value.trim() || m.name;
          d.tags = [slot.value];
          const ref = REFERENCE_ANCHORS;
          d.properties.anchor = { eyes: "eyes", eyebrows: "eyes", nose: "eyes", mouth: "mouth", beard: "mouth", makeup: "mouth", hair: "head_top", hair_accessory: "head_top", headwear: "head_top",
            glasses: "eyes", top: "shoulders", outerwear: "shoulders", dress: "shoulders", bag: "shoulders", bottom: "waist", shoes: "feet", watch: "wrist_left", jewelry: "neck" }[slot.value] ?? null;
          if (slot.value === "body") d.properties.anchors = structuredClone(ref);
          for (const ch of Object.keys(media!.meta.channels ?? {})) if (["primary", "secondary", "accent"].includes(ch)) d.properties.default_colors[ch] = media!.meta.channels![ch];
          try {
            const a = await api.create("character_parts", `part-${slugify(d.name)}-${Date.now().toString(36).slice(-4)}`, d);
            toast("Composant créé en brouillon"); go(`#/composants/${a.id}`);
          } catch (e) { toast((e as Error).message, "err"); }
        } }, "Créer le composant")));
  }
}

// ------------------------------------------------------------------ éditeur de composant

export async function partEditor(root: HTMLElement, id: string) {
  if (id === "nouveau") return importPartView(root);
  await refreshParts();
  let asset: AssetDetail = await api.asset(id);
  if (asset.family !== "character_part") return go(`#/asset/${id}`);
  let def = structuredClone(asset.definition);
  let dirty = false;
  const chars = await api.assets({ family: "character", status: "published" });
  let testBody = [...ctx.parts.values()].find((p) => p.slot === "body")?.id ?? "";
  const editable = () => asset.versions[asset.versions.length - 1].status === "draft" && !asset.archived && can("asset.edit");
  const P = () => def.properties;
  const head = h("header", { class: "ed-head" });
  const prev = h("div", { class: "part-preview" });
  const form = h("div", { class: "ed-form" });
  const side = h("div", { class: "ed-side" });
  fill(root, h("div", { class: "editor" }, head, h("div", { class: "ed-body" }, h("section", { class: "ed-preview" }, prev, side), form)));

  const payload = (): PartPayload | null => {
    const base = ctx.parts.get(id);
    if (!base) return null;
    const slot = P().slot;
    const z = P().z ?? ctx.tax!.character_slots[slot]?.z ?? 50;
    return { ...base, slot, props: P(), z, back_z: ctx.tax!.character_slots[slot]?.back_z ?? 0, name: def.name };
  };
  function changed() { dirty = true; renderHead(); renderPreview(); }

  function renderPreview() {
    const p = payload();
    if (!p) { fill(prev, h("p", { class: "muted" }, "Aperçu indisponible.")); return; }
    const parts = { ...partsRecord(), [id]: p };
    const bodies = [...ctx.parts.values()].filter((x) => x.slot === "body");
    const bodySel = h("select", { "aria-label": "Corps de test" }, bodies.map((b) => h("option", { value: b.id, selected: b.id === testBody }, b.name))) as HTMLSelectElement;
    bodySel.addEventListener("change", () => { testBody = bodySel.value; renderPreview(); });
    const host = chars.find((c) => c.preview.properties.body === testBody) ?? chars[0];
    let test: CharacterProps | null = null;
    if (p.slot === "body") test = { ...(host?.preview.properties ?? { skin: "#a86b3c", hair_color: "#1b1b1b", eye_color: "#3b2414", layers: {} }), body: id };
    else if (p.slot !== "pattern") {
      const layers = { ...(host?.preview.properties.layers ?? {}) };
      if (p.slot === "dress") { delete layers.top; delete layers.bottom; }
      if (["top", "bottom"].includes(p.slot)) delete layers.dress;
      layers[p.slot] = { part: id, colors: {} };
      test = { ...(host?.preview.properties ?? { skin: "#a86b3c", hair_color: "#1b1b1b", eye_color: "#3b2414" }), body: testBody, layers };
    }
    fill(prev, 
      h("div", { class: "split" },
        h("figure", {}, h("div", { class: "svg-prev checker" }, svgImage(composePart(p))), h("figcaption", { class: "small muted" }, "Composant seul")),
        test ? h("figure", {}, h("div", { class: "svg-prev" }, svgImage(composeCharacter(test, parts, { background: "#eef3f1" }).svg)),
          h("figcaption", { class: "small" }, "Sur un habitant de test · ", bodySel)) : null),
      p.slot !== "body" && p.slot !== "pattern" ? h("p", { class: "small muted" }, "L'aperçu suit vos réglages avant enregistrement (ancrage, décalage, échelle, ordre).") : null);
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
    fill(head, h("div", { class: "ed-title" }, h("button", { class: "back", onclick: () => go("#/composants"), "aria-label": "Retour" }, "‹"),
      h("div", {}, h("h1", {}, def.name), h("p", { class: "meta" }, pill(asset.status), ` v${asset.latest_version} · ${slotLabel(P().slot)} · `, h("code", {}, asset.technical_name)))),
      h("div", { class: "ed-actions" }, acts));
  }
  async function save() {
    try { asset = await api.saveDraft(id, def); def = structuredClone(asset.definition); dirty = false; await refreshParts(); toast(asset.validation?.ok ? "Enregistré" : `Enregistré avec ${asset.validation?.errors} erreur(s)`, asset.validation?.ok ? "ok" : "err"); rerender(); }
    catch (e) { fail(e); }
  }
  async function act(a: AssetAction) {
    if (dirty && a === "submit") await save();
    try { asset = await api.action(id, a); def = structuredClone(asset.definition); await refreshParts(); toast("Fait"); rerender(); } catch (e) { fail(e); }
  }
  function fail(e: unknown) { toast((e as Error).message, "err"); if (e instanceof ApiError && e.report) { asset = { ...asset, validation: e.report }; renderSide(); } }

  function renderForm() {
    const dis = !editable();
    const p = P();
    const m = ctx.media.get(p.svg_media);
    const chans = Object.keys(m?.meta.channels ?? {}).filter((c) => ["primary", "secondary", "accent"].includes(c));
    const inp = (val: any, on: (v: string) => void, attrs: Record<string, any> = {}) => { const e = h("input", { value: val ?? "", disabled: dis, ...attrs }) as HTMLInputElement; e.addEventListener("change", () => on(e.value)); return e; };
    const sel = (val: string, opts: Record<string, string>, on: (v: string) => void) => { const e = h("select", { disabled: dis }, Object.entries(opts).map(([k, l]) => h("option", { value: k, selected: k === (val ?? "") }, l))) as HTMLSelectElement; e.addEventListener("change", () => on(e.value)); return e; };
    const slots = Object.fromEntries(Object.entries(ctx.tax!.character_slots).map(([k, s]) => [k, s.label]));
    const checks = (list: string[], opts: Record<string, string>, on: (l: string[]) => void) => h("div", { class: "row" }, Object.entries(opts).map(([k, l]) => {
      const c = h("input", { type: "checkbox", checked: list.includes(k), disabled: dis }) as HTMLInputElement;
      c.addEventListener("change", () => on(c.checked ? [...list, k] : list.filter((x) => x !== k)));
      return h("label", { class: "toggle" }, c, l);
    }));
    const bodies = Object.fromEntries([...ctx.parts.values()].filter((x) => x.slot === "body").map((b) => [b.id, b.name]));
    const others = Object.fromEntries([...ctx.parts.values()].filter((x) => x.id !== id && x.slot !== "pattern" && x.slot !== "body").map((x) => [x.id, `${slotLabel(x.slot)} — ${x.name}`]));
    const sec = (title: string, ...body: (HTMLElement | null)[]) => h("details", { class: "sec", open: true }, h("summary", {}, title), h("div", { class: "sec-body" }, body));
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
            try { await api.replaceMedia(p.svg_media, file, file.name); await refreshMedia(); await refreshParts(); toast("Fichier remplacé (nouvelle révision)"); renderForm(); renderPreview(); }
            catch (e) { toast((e as Error).message, "err"); }
          });
          return field("Remplacer le fichier", f);
        })() : null),
      sec("Position et superposition",
        h("p", { class: "muted" }, "Le calque est accroché à un point du corps : sur une autre silhouette, il suit automatiquement ce point."),
        row(field("Point d'ancrage", sel(p.anchor ?? "", { "": "Aucun", ...Object.fromEntries(ctx.tax!.body_anchors.map((a) => [a, a])) }, (v) => { p.anchor = v || null; changed(); })),
          field("Ordre de rendu", inp(p.z ?? "", (v) => { p.z = v === "" ? null : Number(v); changed(); }, { type: "number", class: "num", placeholder: String(ctx.tax!.character_slots[p.slot]?.z ?? "") }), "Vide = ordre par défaut de l'emplacement"),
          field("Décalage horizontal", inp(p.offset?.[0] ?? 0, (v) => { p.offset = [Number(v), p.offset?.[1] ?? 0]; changed(); }, { type: "number", class: "num", step: 0.5 })),
          field("Décalage vertical", inp(p.offset?.[1] ?? 0, (v) => { p.offset = [p.offset?.[0] ?? 0, Number(v)]; changed(); }, { type: "number", class: "num", step: 0.5 })),
          field("Échelle", inp(p.scale ?? 1, (v) => { p.scale = Number(v); changed(); }, { type: "number", class: "num", step: 0.05, min: 0.1, max: 5 })))),
      p.slot === "body" ? sec("Genre de la silhouette",
        h("p", { class: "muted" }, "Les composants réservés à l'autre genre (maquillage, talons, barbe…) ne seront pas proposés pour cette silhouette et seront refusés par le serveur."),
        field("Genre", sel(p.gender ?? "", { "": "Non précisé", male: "Homme", female: "Femme" }, (v) => { p.gender = v || null; changed(); }))) : null,
      p.slot === "body" ? sec("Points d'ancrage du corps",
        h("p", { class: "muted" }, "Coordonnées dans le repère 200 × 380. Les composants s'y alignent."),
        h("div", { class: "table" }, ctx.tax!.body_anchors.map((a) => h("div", { class: "trow" }, h("strong", {}, a),
          inp(p.anchors?.[a]?.[0] ?? "", (v) => { p.anchors[a] = [Number(v), p.anchors?.[a]?.[1] ?? REFERENCE_ANCHORS[a][1]]; changed(); }, { type: "number", class: "num", "aria-label": `${a} x` }),
          inp(p.anchors?.[a]?.[1] ?? "", (v) => { p.anchors[a] = [p.anchors?.[a]?.[0] ?? REFERENCE_ANCHORS[a][0], Number(v)]; changed(); }, { type: "number", class: "num", "aria-label": `${a} y` }))))) : null,
      chans.length ? sec("Couleurs", ...chans.map((ch) => {
        const pal: string[] = p.palette?.[ch] ?? [];
        const c = h("input", { type: "color", value: p.default_colors?.[ch] ?? m?.meta.channels?.[ch] ?? "#888888", disabled: dis }) as HTMLInputElement;
        c.addEventListener("change", () => { p.default_colors = { ...(p.default_colors ?? {}), [ch]: c.value }; changed(); });
        const add = h("input", { type: "color", value: "#c0392b", disabled: dis, "aria-label": "Couleur à autoriser" }) as HTMLInputElement;
        return h("div", { class: "field" }, h("span", {}, CHANNEL_LABEL[ch]), row(field("Par défaut", c),
          h("div", { class: "field" }, h("span", {}, "Palette autorisée (vide = libre)"), h("div", { class: "swatch-row" },
            pal.map((col, i) => h("button", { class: "sw", style: { background: col }, disabled: dis, title: `Retirer ${col}`, onclick: () => { pal.splice(i, 1); p.palette = { ...p.palette, [ch]: pal }; if (!pal.length) delete p.palette[ch]; changed(); renderForm(); } })),
            add, h("button", { class: "btn btn-small", disabled: dis, onclick: () => { p.palette = { ...(p.palette ?? {}), [ch]: [...pal, add.value] }; changed(); renderForm(); } }, "Autoriser")))));
      })) : null,
      p.slot !== "body" && p.slot !== "pattern" ? sec("Compatibilités et dépendances",
        field("Réservé à (aucun = tout le monde)", checks(p.genders ?? [], { male: "Hommes", female: "Femmes" }, (l) => { p.genders = l; changed(); }),
          "Exemple : rouge à lèvres et talons réservés aux femmes, barbe réservée aux hommes."),
        field("Corps compatibles (aucun = tous)", checks(p.bodies ?? [], bodies, (l) => { p.bodies = l; changed(); })),
        field("Ne se porte pas avec ces emplacements", checks(p.incompatible_slots ?? [], slots, (l) => { p.incompatible_slots = l; changed(); })),
        field("Nécessite ces emplacements", checks(p.requires_slots ?? [], slots, (l) => { p.requires_slots = l; changed(); })),
        field("Incompatible avec ces composants", (() => {
          const e = h("select", { multiple: true, size: 6, disabled: dis }, Object.entries(others).map(([k, l]) => h("option", { value: k, selected: (p.incompatible_parts ?? []).includes(k) }, l))) as HTMLSelectElement;
          e.addEventListener("change", () => { p.incompatible_parts = [...e.selectedOptions].map((o) => o.value); changed(); });
          return e;
        })()),
        p.slot === "hair" ? field("Correspondance dans le jeu actuel (3D)", sel(p.game_hint ?? "", { "": "Non définie", short: "Courte", afro: "Afro", braids: "Tresses", bald: "Rasé" }, (v) => { p.game_hint = v || null; changed(); }),
          "Le jeu Three.js ne connaît que ces 4 coiffures : utilisé par l'adaptateur d'export.") : null) : null);
  }
  function renderSide() {
    fill(side, h("div", { class: "panel" }, h("h2", {}, "Validation"), reportView(asset.validation)),
      historyPanel(asset, (a) => { asset = a; def = structuredClone(a.definition); dirty = false; rerender(); }), usagePanel(asset));
  }
  function rerender() { renderHead(); renderForm(); renderPreview(); renderSide(); }
  rerender();
}
