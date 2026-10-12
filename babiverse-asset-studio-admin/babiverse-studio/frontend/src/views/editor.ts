import { api, ApiError, type AssetAction } from "../api";
import { DELTA, footprintCells, SIDES } from "../geometry";
import { mountGame, PreviewScene } from "../render/stage";
import type { OverlayFlags } from "../render/iso";
import { roadConnectors } from "../templates";
import type { AssetDetail, AssetDefinition, AssetSummary, FurnitureSpec, Report, Side } from "../types";
import { can, catLabel, ctx, famLabel, field, h, modal, pill, reportView, slugify, toast, uniqueId, fill } from "../ui";
import { go } from "../router";
import { familySections, identitySection, placementSection, renderSection, getPath, setPath } from "../forms";
import { behaviorsSection, compareVariants, facadeSection, historyPanel, usagePanel, variantsSection } from "./editorParts";
import { interiorReach } from "../interior";

const SIDE_LABEL: Record<Side, string> = { N: "Nord", E: "Est", S: "Sud", W: "Ouest" };
const ROOM_TYPES: Record<string, string> = {
  living: "Salon", bedroom: "Chambre", kitchen: "Cuisine", bathroom: "Salle de bains", toilet: "Toilettes", office: "Bureau",
  dining: "Salle à manger", corridor: "Couloir", terrace: "Terrasse", garage: "Garage", shop: "Magasin", classroom: "Salle de classe",
  consultation: "Consultation", waiting: "Salle d'attente", meeting: "Salle de réunion", lobby: "Hall d'accueil",
};
const ROAD_KINDS: Record<string, string> = {
  straight: "Segment droit", curve_left: "Virage à gauche", curve_right: "Virage à droite", tee: "Jonction en T",
  cross: "Jonction en croix", end: "Extrémité", ramp: "Rampe (changement de niveau)",
};

type Tool = "none" | "cell" | "entrance" | "door" | "spawn" | "forbidden" | "erase" | "room" | "move" | "rotate" | `furn:${string}`;

/** Registre des meubles : meubles intégrés + assets « Meuble d'intérieur » créés dans l'atelier. */
export function furnitureRegistry(assets: AssetSummary[]): Record<string, FurnitureSpec> {
  const reg: Record<string, FurnitureSpec> = { ...ctx.tax!.furniture };
  for (const a of assets) {
    if (a.family !== "furniture" || a.archived) continue;
    const p = a.preview.properties;
    reg[a.id] = { label: `${a.name}${a.published_version ? "" : " (brouillon)"}`, w: p.w ?? 1, d: p.d ?? 1, actions: p.actions ?? [],
      color: a.preview.materials.primary ?? "#a07a4a", h: p.height_px ?? 10 };
  }
  return reg;
}

export async function editorView(root: HTMLElement, id: string): Promise<() => void> {
  let asset: AssetDetail = await api.asset(id);
  if (asset.family === "character") { go(`#/personnages/${id}`); return () => {}; }
  if (asset.family === "character_part") { go(`#/composants/${id}`); return () => {}; }
  if (asset.family === "component") { go(`#/modulaire/${asset.definition.properties.kit}/composants/${id}`); return () => {}; }
  let def: AssetDefinition = structuredClone(asset.definition);
  let dirty = false;
  let rotation = 0;
  let variantId = def.default_variant ?? "";
  let tool: Tool = "none";
  let pending: [number, number] | null = null;   // premier coin d'une pièce, meuble à déplacer
  let selectedFurn: string | null = null;
  let showWalk = false;
  const flags: OverlayFlags = { grid: true, footprint: true, collision: true, entrances: true, connectors: true, zones: true, dims: true };
  const family = asset.family;
  let interiors: AssetSummary[] = [];
  let furniture: Record<string, FurnitureSpec> = ctx.tax!.furniture;
  if (family === "building") interiors = (await api.assets({ family: "interior" })).filter((a) => !a.archived);
  if (family === "interior") furniture = furnitureRegistry(await api.assets({ family: "furniture" }));

  const editable = () => asset.versions[asset.versions.length - 1].status === "draft" && !asset.archived && can("asset.edit");

  // ---------------------------------------------------------------- squelette
  const head = h("header", { class: "ed-head" });
  const banner = h("div", { class: "ed-banner" });
  const form = h("div", { class: "ed-form" });
  const stage = h("div", { class: "stage" });
  const toolbar = h("div", { class: "stage-bar" });
  const toolHelp = h("p", { class: "tool-help", "aria-live": "polite" });
  const sidePanel = h("div", { class: "ed-side" });
  fill(root, h("div", { class: "editor" }, head, banner,
    h("div", { class: "ed-body" }, h("section", { class: "ed-preview", "aria-label": "Aperçu" }, toolbar, stage, toolHelp, sidePanel), form)));

  const scene = new PreviewScene();
  const game = mountGame(stage, scene);
  scene.cellCb = onCell;

  function refreshPreview() {
    const variant = def.variants.find((v) => v.id === variantId) ?? null;
    const overlay = family === "interior" ? { selected: selectedFurn, reachable: showWalk ? interiorReach(def.properties) : null } : undefined;
    try { scene.set({ family, def, rotation, variant, flags, furniture, overlay }); } catch (e) { console.warn(e); }
  }
  function changed(rebuild = false) {
    dirty = true;
    renderHead();
    if (family === "road") syncRoad();
    refreshPreview();
    if (rebuild) scheduleForm();
  }
  let formPending = false;
  function scheduleForm() {
    if (formPending) return;
    formPending = true;
    requestAnimationFrame(() => { formPending = false; renderForm(); renderToolbar(); });
  }

  // ---------------------------------------------------------------- en-tête & actions
  function renderHead() {
    const latest = asset.versions[asset.versions.length - 1];
    const acts: HTMLElement[] = [];
    const btn = (label: string, run: () => void, kind = "btn", title?: string) => h("button", { class: kind, onclick: run, title }, label);
    if (editable()) {
      acts.push(btn(dirty ? "Enregistrer le brouillon" : "Brouillon enregistré", save, dirty ? "btn btn-primary" : "btn"));
      acts.push(btn("Soumettre à validation", () => act("submit"), "btn"));
    }
    if (latest.status === "in_review" && can("asset.validate")) { acts.push(btn("Approuver", () => act("approve"), "btn btn-primary")); acts.push(btn("Renvoyer en brouillon", () => act("reject"))); }
    if (latest.status === "validated" && can("asset.publish")) { acts.push(btn("Publier", () => act("publish"), "btn btn-primary")); acts.push(btn("Renvoyer en brouillon", () => act("reject"))); }
    if (["published", "validated", "superseded"].includes(latest.status) && can("asset.edit") && !asset.archived) acts.push(btn("Créer une nouvelle version", newVersion, "btn"));
    if (can("asset.create")) acts.push(btn("Dupliquer", duplicate));
    if (can("asset.archive")) acts.push(asset.archived ? btn("Restaurer", () => act("restore")) : btn("Archiver", () => act("archive"), "btn btn-quiet"));
    fill(head, 
      h("div", { class: "ed-title" },
        h("button", { class: "back", onclick: () => history.length > 1 ? history.back() : go("#/catalogue"), "aria-label": "Retour" }, "‹"),
        h("div", {},
          h("h1", {}, def.name || "Sans nom"),
          h("p", { class: "meta" }, pill(asset.status), ` v${asset.latest_version}`,
            asset.published_version ? ` (publiée : v${asset.published_version})` : "", ` · ${famLabel(family)} · ${catLabel(asset.category)} · `,
            h("code", { title: "Identifiant technique stable" }, asset.technical_name)))),
      h("div", { class: "ed-actions" }, acts));
    fill(banner);
    if (!editable()) {
      const msg = asset.archived ? "Cet asset est archivé : il n'est plus proposé au placement. Les instances existantes restent en place."
        : latest.status === "in_review" ? "Cette version attend la validation d'un publieur. Elle n'est plus modifiable."
        : latest.status === "validated" ? "Version validée, prête à publier."
        : ["published", "superseded"].includes(latest.status) ? "Version publiée et figée. Créez une nouvelle version pour la modifier : les instances déjà placées gardent celle-ci."
        : "Lecture seule : votre rôle ne permet pas de modifier cet asset.";
      banner.append(h("p", {}, msg));
    }
    if (def.representation === "modular" && def.properties?.modular?.kit) {
      banner.append(h("p", {}, "Apparence assemblée à partir de composants : elle se modifie dans l'atelier modulaire. Cette page règle les autres propriétés (emprise, entrées, comportements…). ",
        h("a", { href: `#/modulaire/${def.properties.modular.kit}/${id}` }, "Ouvrir l'atelier modulaire")));
    }
    banner.hidden = !banner.childElementCount;
  }

  async function save() {
    try {
      asset = await api.saveDraft(id, def);
      def = structuredClone(asset.definition); dirty = false;
      toast(asset.validation?.ok ? "Brouillon enregistré" : `Brouillon enregistré avec ${asset.validation?.errors} erreur(s) à corriger`, asset.validation?.ok ? "ok" : "err");
      rerender();
    } catch (e) { fail(e); }
  }
  async function act(a: AssetAction) {
    if (dirty && a === "submit") await save();
    try {
      asset = await api.action(id, a);
      def = structuredClone(asset.definition);
      toast({ submit: "Soumis à validation", approve: "Approuvé", reject: "Renvoyé en brouillon", publish: "Publié : disponible dans le catalogue", archive: "Archivé", restore: "Restauré" }[a]);
      rerender();
      if (a === "publish") maybeOfferMigration();
    } catch (e) { fail(e); }
  }
  async function newVersion() {
    try { asset = await api.newDraft(id); def = structuredClone(asset.definition); toast(`Version ${asset.latest_version} créée en brouillon`); rerender(); }
    catch (e) { fail(e); }
  }
  function duplicate() {
    const name = h("input", { value: `${def.name} (copie)`, required: true }) as HTMLInputElement;
    const tech = h("input", { value: slugify(`${asset.technical_name}-copie`), required: true }) as HTMLInputElement;
    name.addEventListener("input", () => (tech.value = slugify(name.value)));
    const close = modal("Dupliquer l'asset", h("div", { class: "fields" }, h("label", {}, "Nom", name), h("label", {}, "Identifiant technique", tech),
      h("p", { class: "muted" }, "La copie part de la version publiée (ou du dernier brouillon) et devient un nouveau brouillon indépendant.")), [
      { label: "Dupliquer", run: async () => { try { const a = await api.duplicate(id, tech.value, name.value); close(); toast("Copie créée"); go(`#/asset/${a.id}`); } catch (e) { fail(e); } } },
    ]);
  }
  async function maybeOfferMigration() {
    const old = asset.versions.filter((v) => v.version !== asset.published_version && v.instances > 0);
    if (!old.length || !asset.published_version) return;
    const prev = await api.migration(id, asset.published_version);
    const body = h("div", {},
      h("p", {}, `${prev.instances.length} instance(s) utilisent une version antérieure. Elles restent intactes tant que vous ne les migrez pas.`),
      h("p", {}, `${prev.compatible} compatible(s) avec v${asset.published_version}, ${prev.blocked} bloquée(s).`),
      prev.blocked ? h("ul", { class: "report" }, prev.instances.filter((i: any) => !i.compatible).slice(0, 6).map((i: any) =>
        h("li", { class: "rep-error" }, `Case (${i.x}, ${i.y}) : ${i.report.items.filter((x: any) => x.level === "error").map((x: any) => x.message).join(" ")}`))) : null);
    const close = modal("Migration des instances", body, prev.compatible ? [{ label: `Migrer ${prev.compatible} instance(s)`, run: async () => {
      const r = await api.migrate(id, asset.published_version!); close(); toast(`${r.migrated.length} instance(s) migrée(s), ${r.skipped.length} conservée(s) sur l'ancienne version`); asset = await api.asset(id); rerender();
    } }] : []);
  }
  function fail(e: unknown) {
    if (e instanceof ApiError) {
      toast(e.message, "err");
      if (e.report) { asset = { ...asset, validation: e.report }; renderSide(); }
    } else toast(String(e), "err");
  }

  // ---------------------------------------------------------------- barre d'aperçu
  function renderToolbar() {
    const rot = h("div", { class: "seg", role: "group", "aria-label": "Rotation" },
      [0, 90, 180, 270].map((r) => h("button", { class: r === rotation ? "on" : "", onclick: () => { rotation = r; tool = "none"; renderToolbar(); refreshPreview(); } }, `${r}°`)));
    const variant = family !== "interior" && def.variants.length ? h("select", { "aria-label": "Variante affichée", onchange: (e: Event) => { variantId = (e.target as HTMLSelectElement).value; refreshPreview(); } },
      h("option", { value: "" }, "Apparence de base"), def.variants.map((v) => h("option", { value: v.id, selected: v.id === variantId }, v.name))) : null;
    const layerDefs: [keyof OverlayFlags, string][] = family === "road" ? [["grid", "Grille"], ["connectors", "Raccords"], ["dims", "Cotes"]]
      : family === "interior" || family === "furniture" ? [] : family === "building"
        ? [["grid", "Grille"], ["footprint", "Emprise et ancrage"], ["collision", "Collision"], ["entrances", "Entrées"], ["zones", "Zones"], ["dims", "Cotes"]]
        : [["grid", "Grille"], ["footprint", "Emprise et ancrage"], ["collision", "Collision"], ["dims", "Cotes"]];
    const layers = h("div", { class: "layers" }, layerDefs.map(([k, label]) =>
      h("label", { class: "chip" }, h("input", { type: "checkbox", checked: flags[k], onchange: (e: Event) => { flags[k] = (e.target as HTMLInputElement).checked; refreshPreview(); } }), label)),
      family === "interior" ? h("label", { class: "chip" }, h("input", { type: "checkbox", checked: showWalk, onchange: (e: Event) => { showWalk = (e.target as HTMLInputElement).checked; refreshPreview(); } }), "Circulation") : null);
    const tools: [Tool, string][] = !editable() ? [] : family === "building"
      ? [["none", "Naviguer"], ["entrance", "Placer l'entrée principale"], ...(def.footprint.kind === "cells" ? [["cell", "Ajouter / retirer des cases"] as [Tool, string]] : [])]
      : family === "interior" ? [["none", "Naviguer"], ["room", "Dessiner une pièce"], ["door", "Porte"], ["spawn", "Point d'apparition"], ["forbidden", "Zone interdite"],
        ["move", "Déplacer un meuble"], ["rotate", "Pivoter un meuble"], ["erase", "Retirer un meuble"],
        ...Object.entries(furniture).map(([k, f]) => [`furn:${k}`, `Poser : ${f.label}`] as [Tool, string])] : [];
    const toolSel = tools.length ? h("select", { "aria-label": "Outil de clic", onchange: (e: Event) => { tool = (e.target as HTMLSelectElement).value as Tool; pending = null; if (tool !== "none" && family === "building") { rotation = 0; renderToolbar(); refreshPreview(); } renderToolHelp(); } },
      tools.map(([t, l]) => h("option", { value: t, selected: t === tool }, l))) : null;
    fill(toolbar, h("div", { class: "bar-row" }, family !== "interior" ? rot : null, variant, toolSel,
      h("div", { class: "zoom" }, h("button", { onclick: () => scene.zoomBy(1.2), "aria-label": "Zoomer" }, "+"), h("button", { onclick: () => scene.zoomBy(1 / 1.2), "aria-label": "Dézoomer" }, "−"), h("button", { onclick: () => scene.fit() }, "Recadrer"))),
      layers.childElementCount ? layers : "");
    renderToolHelp();
  }
  function renderToolHelp() {
    const t = tool;
    toolHelp.textContent = t === "none" ? "Glissez pour déplacer la vue, molette, pincement ou boutons pour zoomer."
      : t === "entrance" ? "Touchez une case en bordure : l'entrée principale s'y place, face vers l'extérieur. Touchez à nouveau pour changer de façade."
      : t === "cell" ? "Touchez une case pour l'ajouter à l'emprise ou la retirer."
      : t === "room" ? (pending ? `Premier coin : (${pending.join(", ")}). Touchez le coin opposé.` : "Touchez le premier coin de la nouvelle pièce, puis le coin opposé.")
      : t === "door" ? "Touchez une case de pièce contre un mur : une porte est créée vers la pièce voisine ou l'extérieur. Touchez à nouveau pour changer de mur."
      : t === "spawn" ? "Touchez la case où le joueur apparaît en entrant."
      : t === "forbidden" ? "Touchez des cases pour les interdire ou les rétablir."
      : t === "erase" ? "Touchez un meuble pour le retirer."
      : t === "move" ? (selectedFurn ? `Touchez la nouvelle position (coin Nord-Ouest) de « ${selectedFurn} ».` : "Touchez le meuble à déplacer.")
      : t === "rotate" ? "Touchez un meuble pour le faire pivoter d'un quart de tour."
      : `Touchez une case pour poser l'élément (coin Nord-Ouest).`;
  }

  // ---------------------------------------------------------------- outils de clic
  function onCell(x: number, y: number) {
    if (!editable() || tool === "none") return;
    if (family === "building") {
      const cells = footprintCells(def.footprint);
      const set = new Set(cells.map((c) => c.join(",")));
      if (tool === "cell") {
        const k = `${x},${y}`;
        if (x < 0 || y < 0) return;
        const next = set.has(k) ? cells.filter((c) => c.join(",") !== k) : [...cells, [x, y] as [number, number]];
        if (!next.length) return;
        def.footprint = { kind: "cells", w: 1, d: 1, cells: next };
        return changed(true);
      }
      if (tool === "entrance") {
        if (!set.has(`${x},${y}`)) return toast("Touchez une case de l'emprise.", "err");
        const out = (["S", "E", "W", "N"] as Side[]).filter((s) => !set.has(`${x + DELTA[s][0]},${y + DELTA[s][1]}`));
        if (!out.length) return toast("Cette case n'a pas de façade extérieure.", "err");
        let main = def.entrances.find((e) => e.kind === "main");
        if (!main) { main = { id: "porte", cell: [x, y], side: out[0], kind: "main" }; def.entrances.push(main); }
        else if (main.cell[0] === x && main.cell[1] === y) main.side = out[(out.indexOf(main.side) + 1) % out.length];
        else { main.cell = [x, y]; main.side = out[0]; }
        return changed(true);
      }
    }
    if (family === "interior") {
      const ip = def.properties;
      if (x < 0 || y < 0 || x >= ip.width || y >= ip.depth) return;
      const roomAt = (cx: number, cy: number) => ip.rooms.find((r: any) => cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.d);
      const furnAt = (cx: number, cy: number) => ip.furniture.find((f: any) => cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.d);
      if (tool === "spawn") { ip.spawn = [x, y]; return changed(true); }
      if (tool === "room") {
        if (!pending) { pending = [x, y]; renderToolHelp(); return; }
        const [x0, y0] = pending; pending = null;
        const rx = Math.min(x0, x), ry = Math.min(y0, y), rw = Math.abs(x - x0) + 1, rd = Math.abs(y - y0) + 1;
        // la nouvelle pièce est découpée dans les pièces existantes qu'elle recouvre entièrement
        ip.rooms = ip.rooms.filter((r: any) => !(r.x >= rx && r.y >= ry && r.x + r.w <= rx + rw && r.y + r.d <= ry + rd));
        ip.rooms.push({ id: uniqueId(ip.rooms, "piece"), name: "Nouvelle pièce", type: "bedroom", x: rx, y: ry, w: rw, d: rd });
        toast("Pièce ajoutée : vérifiez qu'elle ne chevauche pas une autre pièce et ajoutez une porte.");
        return changed(true);
      }
      if (tool === "forbidden") {
        const i = ip.forbidden.findIndex((c: number[]) => c[0] === x && c[1] === y);
        if (i >= 0) ip.forbidden.splice(i, 1); else ip.forbidden.push([x, y]);
        return changed(true);
      }
      if (tool === "erase") {
        const f = furnAt(x, y);
        if (f) { ip.furniture.splice(ip.furniture.indexOf(f), 1); return changed(true); }
        return;
      }
      if (tool === "rotate") {
        const f = furnAt(x, y);
        if (f) { [f.w, f.d] = [f.d, f.w]; return changed(true); }
        return;
      }
      if (tool === "move") {
        if (!selectedFurn) { const f = furnAt(x, y); if (f) { selectedFurn = f.id; renderToolHelp(); refreshPreview(); } return; }
        const f = ip.furniture.find((q: any) => q.id === selectedFurn);
        selectedFurn = null;
        if (f) { f.x = x; f.y = y; return changed(true); }
        return;
      }
      if (tool === "door") {
        const room = roomAt(x, y);
        if (!room) return toast("Touchez une case située dans une pièce.", "err");
        const options = SIDES.map((s) => {
          const nx = x + DELTA[s][0], ny = y + DELTA[s][1];
          const outside = nx < 0 || ny < 0 || nx >= ip.width || ny >= ip.depth;
          const other = outside ? "exterior" : roomAt(nx, ny)?.id;
          return other && other !== room.id ? { s, other } : null;
        }).filter(Boolean) as { s: Side; other: string }[];
        if (!options.length) return toast("Cette case n'est contre aucun mur.", "err");
        const existing = ip.doors.find((d: any) => d.cell[0] === x && d.cell[1] === y);
        if (existing) {
          const i = options.findIndex((o) => o.s === existing.side);
          if (i === options.length - 1) ip.doors.splice(ip.doors.indexOf(existing), 1);
          else { existing.side = options[i + 1].s; existing.connects = [room.id, options[i + 1].other]; }
        } else ip.doors.push({ id: uniqueId(ip.doors, options[0].other === "exterior" ? "sortie" : "porte"), cell: [x, y], side: options[0].s, connects: [room.id, options[0].other] });
        return changed(true);
      }
      if (tool.startsWith("furn:")) {
        const item = tool.slice(5), spec = furniture[item];
        ip.furniture.push({ id: uniqueId(ip.furniture, slugify(spec.label).slice(0, 20) || "meuble"), item, x, y, w: spec.w, d: spec.d, interactive: spec.actions.length > 0, action: spec.actions[0] ?? null });
        return changed(true);
      }
    }
  }

  // ---------------------------------------------------------------- formulaires
  const dis = () => !editable();
  function input(path: string, opts: { type?: string; min?: number; max?: number; step?: number; list?: string; rebuild?: boolean; nullable?: boolean } = {}) {
    const v = getPath(def, path);
    const el = h("input", { type: opts.type ?? "text", value: v ?? "", min: opts.min, max: opts.max, step: opts.step, list: opts.list, disabled: dis() }) as HTMLInputElement;
    el.addEventListener(opts.rebuild ? "change" : "input", () => {
      let val: any = el.value;
      if (opts.type === "number") val = el.value === "" ? (opts.nullable ? null : 0) : Number(el.value);
      setPath(def, path, val); changed(!!opts.rebuild);
    });
    return el;
  }
  function select(path: string, options: Record<string, string>, rebuild = true) {
    const v = String(getPath(def, path));
    const el = h("select", { disabled: dis() }, Object.entries(options).map(([k, l]) => h("option", { value: k, selected: k === v }, l))) as HTMLSelectElement;
    el.addEventListener("change", () => { const raw = el.value; setPath(def, path, /^-?\d+$/.test(raw) && typeof getPath(def, path) === "number" ? Number(raw) : raw); changed(rebuild); });
    return el;
  }
  function check(path: string, rebuild = true) {
    const el = h("input", { type: "checkbox", checked: !!getPath(def, path), disabled: dis() }) as HTMLInputElement;
    el.addEventListener("change", () => { setPath(def, path, el.checked); changed(rebuild); });
    return el;
  }
  function color(path: string) {
    const el = h("input", { type: "color", value: getPath(def, path) ?? "#999999", disabled: dis() }) as HTMLInputElement;
    el.addEventListener("input", () => { setPath(def, path, el.value); changed(false); });
    return el;
  }
  const section = (title: string, anchor: string, ...body: (HTMLElement | null | HTMLElement[])[]) => h("details", { class: "sec", open: true, id: `sec-${anchor}` }, h("summary", {}, title), h("div", { class: "sec-body" }, body.flat()));
  const rowEl = (...c: (HTMLElement | null)[]) => h("div", { class: "row" }, c);
  const addBtn = (label: string, run: () => void) => h("button", { class: "btn btn-small", disabled: dis(), onclick: () => { run(); changed(true); } }, label);
  const delBtn = (list: any[], i: number) => h("button", { class: "icon-btn", disabled: dis(), "aria-label": "Supprimer", onclick: () => { list.splice(i, 1); changed(true); } }, "×");
  const cellInputs = (arr: number[], labels = ["x", "y"]) => {
    const mk = (i: number) => { const e = h("input", { type: "number", value: arr[i], class: "num", disabled: dis(), "aria-label": labels[i] }) as HTMLInputElement; e.addEventListener("change", () => { arr[i] = Number(e.value); changed(true); }); return e; };
    return h("span", { class: "pair" }, mk(0), mk(1));
  };
  const sideSelect = (obj: any, key = "side") => { const e = h("select", { disabled: dis() }, SIDES.map((s) => h("option", { value: s, selected: obj[key] === s }, SIDE_LABEL[s]))) as HTMLSelectElement; e.addEventListener("change", () => { obj[key] = e.value; changed(true); }); return e; };
  const txt = (obj: any, key: string, cls = "") => { const e = h("input", { value: obj[key] ?? "", class: cls, disabled: dis() }) as HTMLInputElement; e.addEventListener("change", () => { obj[key] = e.value; changed(true); }); return e; };

  function appearance() {
    const slots = ctx.tax!.material_slots[family] ?? [];
    const mats = h("div", { class: "swatches" }, slots.map((s) => field(ctx.tax!.slot_labels[s] ?? s, color(`materials.${s}`))));
    if (family !== "building") return section("Apparence", "appearance", mats);
    const p = def.properties;
    const shop = p.shop;
    return section("Apparence", "appearance", mats,
      rowEl(field("Toiture", select("properties.style.roof", { flat: "Toit-terrasse", gable: "Deux pans", hip: "Quatre pans" })),
        field("Fenêtres", select("properties.style.window_style", { grid: "Fenêtres", band: "Bandeau vitré", none: "Aucune" })),
        field("Porte", select("properties.style.door_style", { wood: "Bois", glass: "Vitrée", metal: "Métal" }))),
      h("label", { class: "toggle" }, h("input", { type: "checkbox", checked: !!shop, disabled: dis(), onchange: (e: Event) => {
        p.shop = (e.target as HTMLInputElement).checked ? { sign_text: "", shopfront: true, awning: true, goods_slots: 0 } : null; changed(true);
      } }), "Façade commerciale (enseigne, vitrine)"),
      shop ? rowEl(field("Texte de l'enseigne", input("properties.shop.sign_text"), "24 caractères maximum"),
        field("Emplacements de marchandises", input("properties.shop.goods_slots", { type: "number", min: 0, max: 200 }))) : null,
      shop ? rowEl(h("label", { class: "toggle" }, check("properties.shop.awning"), "Auvent"), h("label", { class: "toggle" }, check("properties.shop.shopfront"), "Vitrine")) : null);
  }

  function geometry() {
    if (family === "interior") {
      const ip = def.properties;
      const t = ctx.tax!.interior_tiles_per_cell;
      return section("Plan", "geometry",
        rowEl(field("Largeur (tuiles)", input("properties.width", { type: "number", min: 2, max: 64, rebuild: true })),
          field("Profondeur (tuiles)", input("properties.depth", { type: "number", min: 2, max: 64, rebuild: true })),
          field("Mode", select("properties.mode", { instanced: "Instancié (scène séparée)", open: "Ouvert (dans la ville)", decorative: "Décoratif" }))),
        h("p", { class: "muted" }, `Une case de ville = ${t} × ${t} tuiles. Bâtiment hôte minimal : ${Math.ceil(ip.width / t)} × ${Math.ceil(ip.depth / t)} cases.`),
        h("h3", {}, "Pièces"),
        h("div", { class: "table" }, ip.rooms.map((r: any, i: number) => {
          const type = h("select", { disabled: dis() }, Object.entries(ROOM_TYPES).map(([k, l]) => h("option", { value: k, selected: r.type === k }, l))) as HTMLSelectElement;
          type.addEventListener("change", () => { r.type = type.value; changed(true); });
          const n = (k: string, lab: string) => { const e = h("input", { type: "number", class: "num", value: r[k], min: k === "w" || k === "d" ? 1 : 0, disabled: dis(), "aria-label": lab }) as HTMLInputElement; e.addEventListener("change", () => { r[k] = Number(e.value); changed(true); }); return e; };
          return h("div", { class: "trow" }, txt(r, "name"), type, h("span", { class: "pair" }, "x", n("x", "Position x"), "y", n("y", "Position y")), h("span", { class: "pair" }, "l", n("w", "Largeur"), "p", n("d", "Profondeur")), delBtn(ip.rooms, i));
        })),
        addBtn("Ajouter une pièce", () => ip.rooms.push({ id: uniqueId(ip.rooms, "piece"), name: "Nouvelle pièce", type: "bedroom", x: 0, y: 0, w: 3, d: 3 })),
        h("p", { class: "small muted" }, "Astuce : l'outil « Dessiner une pièce » trace une pièce en deux touchers sur le plan ; modifiez ses dimensions ici pour déplacer une cloison."),
        h("h3", {}, "Portes"),
        h("div", { class: "table" }, ip.doors.map((d: any, i: number) => {
          const opts = [...ip.rooms.map((r: any) => [r.id, r.name]), ["exterior", "Extérieur"]];
          const conn = (j: number) => { const e = h("select", { disabled: dis() }, opts.map(([k, l]) => h("option", { value: k, selected: d.connects[j] === k }, l))) as HTMLSelectElement; e.addEventListener("change", () => { d.connects[j] = e.value; changed(true); }); return e; };
          return h("div", { class: "trow" }, h("code", {}, d.id), cellInputs(d.cell), sideSelect(d), conn(0), "→", conn(1), delBtn(ip.doors, i));
        })),
        h("h3", {}, "Mobilier"),
        h("div", { class: "table" }, ip.furniture.map((f: any, i: number) => {
          const spec = furniture[f.item];
          const act = h("select", { disabled: dis() }, h("option", { value: "" }, "Décoratif"), (spec?.actions ?? []).map((a) => h("option", { value: a, selected: f.interactive && f.action === a }, `Action : ${ctx.tax!.behaviors[a]?.label ?? a}`))) as HTMLSelectElement;
          act.addEventListener("change", () => { f.interactive = !!act.value; f.action = act.value || null; changed(true); });
          const n = (k: string) => { const e = h("input", { type: "number", class: "num", value: f[k], disabled: dis(), "aria-label": k }) as HTMLInputElement; e.addEventListener("change", () => { f[k] = Number(e.value); changed(true); }); return e; };
          return h("div", { class: "trow" }, h("span", {}, spec?.label ?? `Meuble inconnu (${f.item})`), h("span", { class: "pair" }, "x", n("x"), "y", n("y")), h("span", { class: "pair" }, "l", n("w"), "p", n("d")), act,
            h("button", { class: "btn btn-small", disabled: dis(), onclick: () => { const c = structuredClone(f); c.id = uniqueId(ip.furniture, f.id.replace(/-\d+$/, "")); c.x = Math.min(ip.width - c.w, f.x + 1); ip.furniture.push(c); changed(true); } }, "Dupliquer"),
            delBtn(ip.furniture, i));
        })),
        h("p", { class: "muted" }, "Pour poser un meuble, choisissez-le dans l'outil de clic au-dessus du plan. Les meubles créés dans l'atelier (famille « Meuble d'intérieur ») y figurent aussi."),
        field("Point d'apparition", cellInputs(ip.spawn)));
    }
    if (family === "road") {
      const size = h("input", { type: "number", min: 1, max: 8, value: def.footprint.w, disabled: dis() }) as HTMLInputElement;
      size.addEventListener("change", () => { def.footprint = { kind: "rect", w: Number(size.value), d: Number(size.value), cells: null }; regenConnectors(); changed(true); });
      return section("Géométrie du segment", "geometry",
        rowEl(field("Type de segment", select("properties.kind", ROAD_KINDS)), field("Emprise (cases)", size, "Carrée : largeur = longueur")),
        rowEl(field("Voies", input("properties.lanes", { type: "number", min: 1, max: 8, rebuild: true })),
          field("Marquage", select("properties.markings", { dashed: "Discontinu", solid: "Continu", double: "Double continu", none: "Aucun" }))),
        rowEl(h("label", { class: "toggle" }, check("properties.oneway"), "Sens unique"), h("label", { class: "toggle" }, check("properties.sidewalk"), "Trottoirs")),
        h("h3", {}, "Raccords"),
        h("p", { class: "muted" }, "Générés à partir du type, de l'emprise et des voies. Vous pouvez ajuster le sens et le niveau de chaque raccord."),
        h("div", { class: "table" }, def.connectors.map((c) => {
          const flow = h("select", { disabled: dis() }, [["both", "Double sens"], ["in", "Entrée"], ["out", "Sortie"]].map(([k, l]) => h("option", { value: k, selected: c.flow === k }, l))) as HTMLSelectElement;
          flow.addEventListener("change", () => { c.flow = flow.value as any; changed(true); });
          const lvl = h("input", { type: "number", class: "num", min: -2, max: 4, value: c.level, disabled: dis(), "aria-label": "Niveau" }) as HTMLInputElement;
          lvl.addEventListener("change", () => { c.level = Number(lvl.value); changed(true); });
          return h("div", { class: "trow" }, h("strong", {}, SIDE_LABEL[c.side]), h("span", {}, `${c.lanes} voies · ${c.width_cells} cases`), flow, h("span", { class: "pair" }, "niveau", lvl));
        })));
    }
    const p = def.properties;
    const fp = def.footprint;
    const kind = h("select", { disabled: dis() }, h("option", { value: "rect", selected: fp.kind === "rect" }, "Rectangulaire"), h("option", { value: "cells", selected: fp.kind === "cells" }, "Composée (case par case)")) as HTMLSelectElement;
    kind.addEventListener("change", () => {
      def.footprint = kind.value === "cells" ? { kind: "cells", w: 1, d: 1, cells: footprintCells(fp) } : { kind: "rect", w: Math.max(1, ...footprintCells(fp).map((c) => c[0] + 1)), d: Math.max(1, ...footprintCells(fp).map((c) => c[1] + 1)), cells: null };
      changed(true);
    });
    return section("Géométrie", "geometry",
      rowEl(field("Emprise", kind), fp.kind === "rect" ? field("Largeur en cases", input("footprint.w", { type: "number", min: 1, max: 64, rebuild: true })) : null,
        fp.kind === "rect" ? field("Profondeur en cases", input("footprint.d", { type: "number", min: 1, max: 64, rebuild: true })) : null),
      fp.kind === "cells" ? h("p", { class: "muted" }, `${footprintCells(fp).length} case(s). Utilisez l'outil « Ajouter / retirer des cases » sur l'aperçu.`) : null,
      rowEl(field("Étages", input("properties.floors", { type: "number", min: 1, max: 40, rebuild: true })),
        field("Hauteur (m)", input("height_m", { type: "number", min: 0, max: 300, step: 0.5 }), `Minimum ${(p.floors * 2.5).toFixed(1)} m`),
        field("Taille d'une case (m)", input("cell_size_m", { type: "number", min: 0.5, max: 10, step: 0.5 }))),
      rowEl(field("Point d'ancrage", cellInputs(def.anchor)), field("Rotation par défaut", select("default_rotation", { 0: "0°", 90: "90°", 180: "180°", 270: "270°" })),
        field("Collision", select("collision", { footprint: "Emprise au sol", none: "Aucune (décor traversable)" }))));
  }

  function entrancesSection() {
    // les objets n'ont pas d'entrée mais peuvent porter des zones (comportement « Zone d'interaction »)
    if (family !== "building" && family !== "prop") return null;
    const building = family === "building";
    const KINDS = { main: "Principale", service: "Service", emergency: "Urgence", delivery: "Livraison" };
    return section(building ? "Entrées et zones" : "Zones", "interactions",
      building ? h("div", { class: "table" }, def.entrances.map((e, i) => {
        const k = h("select", { disabled: dis() }, Object.entries(KINDS).map(([v, l]) => h("option", { value: v, selected: e.kind === v }, l))) as HTMLSelectElement;
        k.addEventListener("change", () => { e.kind = k.value as any; changed(true); });
        return h("div", { class: "trow" }, txt(e, "id", "short"), h("span", { class: "pair" }, "case", cellInputs(e.cell)), sideSelect(e), k, delBtn(def.entrances, i));
      })) : null,
      building ? addBtn("Ajouter une entrée", () => def.entrances.push({ id: uniqueId(def.entrances, "entree"), cell: [0, 0], side: "N", kind: "service" })) : null,
      building ? h("h3", {}, "Zones") : null,
      h("div", { class: "table" }, def.zones.map((z, i) => {
        const k = h("select", { disabled: dis() }, Object.entries({ interaction: "Interaction", safety: "Sécurité", forbidden: "Interdite", delivery: "Livraison", parking: "Stationnement" }).map(([v, l]) => h("option", { value: v, selected: z.kind === v }, l))) as HTMLSelectElement;
        k.addEventListener("change", () => { z.kind = k.value as any; changed(true); });
        const cells = h("input", { value: z.cells.map((c) => c.join(",")).join(" ; "), disabled: dis(), "aria-label": "Cases" }) as HTMLInputElement;
        cells.addEventListener("change", () => { z.cells = cells.value.split(";").map((s) => s.split(",").map((n) => parseInt(n.trim(), 10))).filter((c) => c.length === 2 && c.every(Number.isFinite)) as any; changed(true); });
        return h("div", { class: "trow" }, h("code", {}, z.id), txt(z, "label"), k, cells, delBtn(def.zones, i));
      })),
      addBtn("Ajouter une zone", () => def.zones.push({ id: uniqueId(def.zones, "zone"), kind: "interaction", label: "Zone", cells: [] })),
      h("p", { class: "muted" }, `Cases relatives au coin Nord-Ouest, format « x,y ; x,y ». Une zone peut déborder de 3 cases autour ${building ? "du bâtiment" : "de l'objet"}.`));
  }

  function buildingProps() {
    if (family !== "building") return null;
    const p = def.properties;
    const options = interiors.map((a) => [a.id, `${a.name}${a.published_version ? "" : " (non publié)"}`]);
    return section("Usage et intérieurs", "usage",
      rowEl(field("Propriété", select("properties.ownership", { player: "Joueur", npc: "PNJ", admin: "Administration", decor: "Décor" })),
        field("Capacité d'occupation", input("properties.occupancy", { type: "number", min: 0 })),
        field("Niveau d'amélioration", input("properties.upgrade_level", { type: "number", min: 1, max: 10, nullable: true }))),
      h("label", { class: "toggle" }, check("properties.assignable_to_player"), "Attribuable à un joueur"),
      h("h3", {}, "Intérieurs associés"),
      h("div", { class: "table" }, p.interiors.map((l: any, i: number) => {
        const s = h("select", { disabled: dis() }, options.map(([k, lab]) => h("option", { value: k, selected: l.interior_id === k }, lab))) as HTMLSelectElement;
        s.addEventListener("change", () => { l.interior_id = s.value; changed(true); });
        const lvl = h("input", { type: "number", class: "num", min: 1, max: 10, value: l.min_level, disabled: dis(), "aria-label": "Niveau minimal" }) as HTMLInputElement;
        lvl.addEventListener("change", () => { l.min_level = Number(lvl.value); changed(true); });
        return h("div", { class: "trow" }, txt(l, "label", "short"), s, h("span", { class: "pair" }, "niv.", lvl),
          h("button", { class: "btn btn-small", onclick: () => go(`#/asset/${l.interior_id}`) }, "Ouvrir"), delBtn(p.interiors, i));
      })),
      options.length ? addBtn("Associer un intérieur", () => p.interiors.push({ interior_id: options[0][0], label: p.interiors.length ? "Amélioré" : "Base", min_level: p.interiors.length + 1 }))
        : h("p", { class: "muted" }, "Aucun intérieur disponible : créez-en un dans la section Intérieurs."),
      h("p", { class: "muted" }, "Plusieurs intérieurs permettent des configurations par niveau (base, amélioré, premium)."));
  }

  function advanced() {
    const ta = h("textarea", { rows: 14, class: "json", spellcheck: false, disabled: dis() }, JSON.stringify(def, null, 2)) as HTMLTextAreaElement;
    const apply = h("button", { class: "btn btn-small", disabled: dis(), onclick: () => {
      try { def = JSON.parse(ta.value); changed(true); toast("Définition appliquée (non enregistrée)"); } catch (e) { toast(`JSON invalide : ${(e as Error).message}`, "err"); }
    } }, "Appliquer le JSON");
    const s = section("Données techniques (avancé)", "json", h("p", { class: "muted" }, "Pour les réglages non exposés dans les formulaires. Le serveur valide tout avant enregistrement."), ta, apply);
    s.open = false;
    return s;
  }

  function renderForm() {
    const sy = form.scrollTop;
    const closed = new Set([...form.querySelectorAll("details")].filter((d) => !(d as HTMLDetailsElement).open).map((d) => d.id));
    const cat = ctx.tax!.categories.find((c) => c.key === asset.category);
    const generic = familySections(family);
    const parts: (HTMLElement | null)[] = [identitySection(def, cat?.subcategories ?? [], changed, dis())];
    if (generic.length) parts.push(...generic.map((s) => renderSection(s, def, changed, dis())));
    else parts.push(geometry(), appearance());
    parts.push(family === "building" ? facadeSection(def, changed, dis()) : null, buildingProps(), entrancesSection(),
      behaviorsSection(def, family, changed, dis()),
      family !== "interior" && family !== "furniture" ? placementSection(def, family, changed, dis()) : null,
      variantsSection(def, family, changed, dis(), (a, b) => compareVariants(family, def, a, b)), advanced());
    fill(form, ...parts.filter(Boolean) as HTMLElement[]);
    form.querySelectorAll("details").forEach((d) => { if (closed.has(d.id)) (d as HTMLDetailsElement).open = false; });
    form.scrollTop = sy;
  }

  function regenConnectors() {
    const p = def.properties;
    const levels = def.connectors.map((c) => c.level);
    const lv = Math.min(0, ...levels) === 0 ? Math.max(0, ...levels) : Math.min(...levels);
    def.connectors = roadConnectors(p.kind, def.footprint.w, p.lanes, p.oneway, p.kind === "ramp" ? 0 : lv, p.kind === "ramp" ? 1 : lv);
  }
  let roadKey = "";
  function syncRoad() {
    const p = def.properties;
    const key = [p.kind, def.footprint.w, p.lanes, p.oneway].join("|");
    if (roadKey && key !== roadKey) regenConnectors();
    roadKey = key;
  }

  // ---------------------------------------------------------------- panneau validation, versions, utilisation
  async function renderSide() {
    const r: Report | null = asset.validation;
    const latest = asset.versions[asset.versions.length - 1];
    const checkBtn = h("button", { class: "btn btn-small", onclick: async () => {
      if (dirty && editable()) await save();
      try { const rep = await api.validate(id, true); asset = { ...asset, validation: rep }; renderSide(); toast(rep.ok ? "Prêt à publier : aucune erreur" : `${rep.errors} erreur(s) bloquante(s)`, rep.ok ? "ok" : "err"); } catch (e) { fail(e); }
    } }, "Vérifier la publiabilité");
    const jump = (path: string) => {
      const sec = path.split(".")[0];
      const map: Record<string, string> = { entrances: "interactions", zones: "interactions", materials: "appearance", variants: "variants", default_variant: "variants",
        footprint: "geometry", connectors: "geometry", height_m: "geometry", placement: "placement", name: "identity", subcategory: "identity", behaviors: "behaviors",
        resources: "identity", cover: "identity" };
      const target = path.startsWith("properties.interiors") ? "usage" : path.startsWith("properties.facade") ? "facade" : path.startsWith("properties.") ? (family === "building" ? "geometry" : "appearance") : map[sec];
      (document.getElementById(`sec-${target}`) ?? document.getElementById("sec-geometry"))?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    fill(sidePanel, 
      h("div", { class: "panel" }, h("h2", {}, "Validation"), h("p", { class: "muted" }, dirty ? "Modifications non enregistrées : le rapport date du dernier enregistrement." : `État de la v${latest.version}.`),
        reportView(r, jump), checkBtn),
      historyPanel(asset, (a) => { asset = a; def = structuredClone(a.definition); dirty = false; rerender(); }),
      asset.published_version && asset.versions.some((v) => v.instances && v.version !== asset.published_version) && can("asset.publish")
        ? h("div", { class: "panel" }, h("button", { class: "btn btn-small", onclick: maybeOfferMigration }, "Migrer les instances anciennes")) : h("span"),
      usagePanel(asset),
      family === "road" && asset.latest_version ? await roadPanel() : h("span"));
  }
  async function roadPanel() {
    try {
      const list = await api.roadCompat(id);
      return h("div", { class: "panel" }, h("h2", {}, "Raccordements"),
        h("p", { class: "muted" }, "Segments publiés raccordables à ce segment (d'après la version enregistrée)."),
        h("ul", { class: "compat" }, list.map((c) => h("li", { class: c.compatible ? "ok" : "ko" }, h("span", {}, c.compatible ? "✓" : "✕"), " ", c.name,
          c.compatible ? h("small", {}, ` côtés ${[...new Set(c.matches.map((m: any) => m.side))].join(", ")}`) : h("small", {}, ` — ${c.reason}`)))));
    } catch { return h("span"); }
  }

  function rerender() { renderHead(); renderToolbar(); renderForm(); refreshPreview(); renderSide(); }

  const beforeUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
  window.addEventListener("beforeunload", beforeUnload);
  const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (editable() && dirty) save(); } };
  window.addEventListener("keydown", key);

  if (family === "road") { const p = def.properties; roadKey = [p.kind, def.footprint.w, p.lanes, p.oneway].join("|"); }
  rerender();
  return () => {
    window.removeEventListener("beforeunload", beforeUnload); window.removeEventListener("keydown", key);
    game.destroy(true);
  };
}
