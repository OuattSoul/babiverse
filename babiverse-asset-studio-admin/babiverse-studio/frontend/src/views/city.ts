// Carte de test : scènes de prévisualisation (jamais le monde de production du jeu).
import { api, ApiError, download } from "../api";
import { go, parseHash } from "../router";
import { CityScene, mountGame, PreviewScene, type CityEntry } from "../render/stage";
import { iso } from "../render/iso";
import type { AssetDefinition, CatalogEntry, Instance, World } from "../types";
import { can, catLabel, confirmDialog, ctx, famLabel, field, h, modal, refreshParts, reportView, thumbnail, toast, fill } from "../ui";
import { furnitureRegistry } from "./editor";

export async function cityView(root: HTMLElement): Promise<() => void> {
  await refreshParts();
  const scenes = await api.scenes();
  const sid = parseHash().query.get("scene") ?? scenes[0]?.id ?? "main";
  const [world, catalog] = await Promise.all([api.scene(sid), api.catalog()]);
  const defs = new Map<string, { family: string; definition: AssetDefinition }>();
  for (const c of catalog) defs.set(`${c.asset_id}@${c.version}`, { family: c.family, definition: c.definition });
  // chargement différé : seules les versions réellement présentes dans la scène sont demandées
  const missing = [...new Set(world.instances.map((i) => `${i.asset_id}@${i.version}`))].filter((k) => !defs.has(k));
  if (missing.length) {
    const extra = await api.definitions(missing);
    for (const [k, v] of Object.entries(extra)) defs.set(k, { family: v.family, definition: v.definition });
  }
  const placeable = catalog.filter((c) => ctx.tax!.placeable.includes(c.family));

  const stage = h("div", { class: "stage stage-city" });
  const palette = h("div", { class: "palette" });
  const info = h("div", { class: "city-info" });
  const status = h("p", { class: "city-status muted", "aria-live": "polite" }, "Touchez un objet pour l'inspecter, ou choisissez un asset à placer.");
  const sceneSel = h("select", { "aria-label": "Scène de test" }, scenes.map((s) => h("option", { value: s.id, selected: s.id === sid }, `${s.name} (${s.instances})`))) as HTMLSelectElement;
  sceneSel.addEventListener("change", () => go(`#/carte?scene=${sceneSel.value}`));
  const sceneTools = h("div", { class: "row" }, sceneSel,
    can("scene.manage") ? h("button", { class: "btn btn-small", onclick: () => newScene() }, "Nouvelle scène") : null,
    can("scene.manage") ? h("button", { class: "btn btn-small", onclick: async () => {
      const name = prompt("Nom de la copie", `${world.name} (copie)`); if (!name) return;
      try { const s = await api.duplicateScene(world.id, name); toast("Scène dupliquée"); go(`#/carte?scene=${s.id}`); } catch (e) { toast((e as Error).message, "err"); }
    } }, "Dupliquer") : null,
    can("scene.manage") ? h("button", { class: "btn btn-small btn-quiet", onclick: async () => {
      if (!(await confirmDialog("Vider la scène", `Retirer les ${world.instances.length} objets de « ${world.name} » ?`, "Vider", true))) return;
      await api.clearScene(world.id); toast("Scène vidée"); go(`#/carte?scene=${world.id}`);
    } }, "Vider") : null,
    can("scene.manage") && world.id !== "main" ? h("button", { class: "btn btn-small btn-quiet", onclick: async () => {
      if (!(await confirmDialog("Supprimer la scène", `Supprimer définitivement « ${world.name} » ?`, "Supprimer", true))) return;
      await api.deleteScene(world.id); toast("Scène supprimée"); go("#/carte");
    } }, "Supprimer") : null,
    can("asset.export") ? h("button", { class: "btn btn-small", onclick: async () => {
      try { const r = await api.exportBundle({ asset_ids: [], scene_ids: [world.id], include_dependencies: true, versions: "all" }); download(r.blob, r.filename); toast(`Scène exportée avec ${r.assets} asset(s)`); }
      catch (e) { toast((e as Error).message, "err"); }
    } }, "Exporter la scène") : null);

  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Carte de test de Cité Akwaba"),
      h("p", { class: "lede" }, "Scène de prévisualisation de l'atelier : ce n'est pas le monde de production du jeu. Les assets publiés s'y placent avec les règles du serveur (terrain, collisions par couche, accès routier, raccords).")),
      sceneTools),
    h("div", { class: "city" }, h("aside", { class: "city-side" }, palette, info), h("div", { class: "city-main" }, stage, status,
      h("div", { class: "bar-row" }, h("button", { class: "btn btn-small", onclick: () => scene.zoomBy(1.2), "aria-label": "Zoomer" }, "+"),
        h("button", { class: "btn btn-small", onclick: () => scene.zoomBy(1 / 1.2), "aria-label": "Dézoomer" }, "−"),
        h("span", { class: "small muted" }, `${world.width} × ${world.height} cases · ${world.instances.length} objets · glisser pour se déplacer, pincer ou molette pour zoomer`)))));

  const scene = new CityScene();
  scene.world = world; scene.defs = defs;
  const game = mountGame(stage, scene);
  // aide aux tests de bout en bout (lecture seule) : position à l'écran du centre d'une case
  (window as any).__babiCity = {
    cellToScreen(x: number, y: number) {
      const cam = scene.cameras?.main; if (!cam) return null;
      const [wx, wy] = iso(x + 0.5, y + 0.5);
      const r = stage.getBoundingClientRect();
      return { x: r.left + (wx - cam.worldView.x) * cam.zoom, y: r.top + (wy - cam.worldView.y) * cam.zoom };
    },
  };
  let picked: CatalogEntry | null = null;
  let moving: Instance | null = null;
  let rotation = 0, variant = "";
  let famFilter = "";

  function renderPalette() {
    const fams = [...new Set(placeable.map((c) => c.family))];
    const groups = new Map<string, CatalogEntry[]>();
    for (const c of placeable.filter((c) => !famFilter || c.family === famFilter)) { const k = `${famLabel(c.family)} · ${catLabel(c.category)}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
    fill(palette, 
      h("h2", {}, moving ? "Déplacer" : "Placer un asset publié"),
      !can("world.place") ? h("p", { class: "muted" }, "Votre rôle ne permet pas de placer des objets.") : "",
      h("select", { "aria-label": "Famille", onchange: (e: Event) => { famFilter = (e.target as HTMLSelectElement).value; renderPalette(); } },
        h("option", { value: "" }, "Toutes les familles"), fams.map((f) => h("option", { value: f, selected: f === famFilter }, famLabel(f)))),
      ...[...groups.entries()].map(([g, items]) => h("div", {}, h("h3", {}, g), h("div", { class: "pal-grid" }, items.map((c) =>
        h("button", { class: `pal ${picked?.asset_id === c.asset_id ? "on" : ""}`, disabled: !can("world.place"), onclick: () => pick(picked?.asset_id === c.asset_id ? null : c), title: c.definition.name, "data-asset": c.technical_name },
          thumbnail(c.definition, c.family, 84), h("span", {}, c.definition.name)))))),
      picked || moving ? h("div", { class: "pal-opts" },
        h("div", { class: "seg" }, [0, 90, 180, 270].map((r) => h("button", { class: r === rotation ? "on" : "", onclick: () => { rotation = r; renderPalette(); syncGhost(); } }, `${r}°`))),
        picked && picked.definition.variants.length ? h("select", { "aria-label": "Variante", onchange: (e: Event) => { variant = (e.target as HTMLSelectElement).value; syncGhost(); } },
          h("option", { value: "" }, "Apparence de base"), picked.definition.variants.map((v) => h("option", { value: v.id, selected: v.id === variant }, v.name))) : null,
        h("button", { class: "btn btn-small", onclick: () => pick(null) }, moving ? "Annuler le déplacement" : "Arrêter de placer")) : "");
  }
  function pick(c: CatalogEntry | null) {
    picked = c; moving = null; rotation = c?.definition.default_rotation ?? 0; variant = c?.definition.default_variant ?? "";
    renderPalette(); syncGhost();
    status.textContent = c ? `Touchez une case pour placer « ${c.definition.name} » (coin Nord-Ouest). R pour pivoter, Échap pour arrêter.` : "Touchez un objet pour l'inspecter.";
  }
  function syncGhost() {
    if (moving) {
      const d = defs.get(`${moving.asset_id}@${moving.version}`)!;
      scene.setGhost({ entry: { asset_id: moving.asset_id, version: moving.version, family: d.family, definition: d.definition }, rotation, variant: d.definition.variants.find((v) => v.id === moving!.variant_id) ?? null, moving: moving.id });
    } else scene.setGhost(picked ? { entry: picked as CityEntry, rotation, variant: picked.definition.variants.find((v) => v.id === variant) ?? null } : null);
    scene.drawInstances();
  }

  scene.onPlace = async (x, y) => {
    if (moving) {
      const inst = moving;
      try {
        const u = await api.move(world.id, inst.id, { x, y, rotation });
        Object.assign(inst, u); moving = null; scene.setGhost(null); scene.drawInstances(); renderPalette(); showInstance(inst); toast("Déplacé");
      } catch (e) { refused(e); }
      return;
    }
    if (!picked) return;
    try {
      const r = await api.place(world.id, { asset_id: picked.asset_id, x, y, rotation, variant_id: variant || null });
      world.instances.push(r.instance);
      scene.drawInstances();
      fill(info, h("div", { class: "panel" }, h("h2", {}, "Placé"), reportView(r.report)));
      toast(r.report.warnings ? `Placé avec ${r.report.warnings} avertissement(s)` : "Placé");
    } catch (e) { refused(e); }
  };
  function refused(e: unknown) {
    const err = e as ApiError;
    fill(info, h("div", { class: "panel" }, h("h2", {}, "Refusé"), reportView(err.report ?? null), err.report ? null : h("p", {}, err.message)));
    toast(`${err.message} Voir le détail.`, "err");
  }
  scene.onHoverCell = (x, y) => { if (picked || moving) status.textContent = `Case (${x}, ${y}) · rotation ${rotation}° — touchez pour ${moving ? "déplacer" : "placer"}.`; };
  scene.onPick = (cell, inst) => {
    scene.selected = inst?.id ?? null; scene.drawInstances();
    if (!inst) { fill(info, h("p", { class: "muted" }, `Case (${cell[0]}, ${cell[1]}) : terrain ${({ g: "sol", s: "sable", w: "eau" } as any)[world.terrain[cell[1]]?.[cell[0]]] ?? "hors carte"}.`)); return; }
    showInstance(inst);
  };

  function showInstance(inst: Instance) {
    const d = defs.get(`${inst.asset_id}@${inst.version}`)!;
    const cat = catalog.find((c) => c.asset_id === inst.asset_id);
    const outdated = cat && cat.version !== inst.version;
    const interiors = d.family === "building" ? d.definition.properties.interiors as any[] : [];
    const mine = inst.owner_id === ctx.user!.id || can("world.edit_any");
    const label = h("input", { value: inst.data?.label ?? "", placeholder: "Étiquette de l'instance", disabled: !mine, "aria-label": "Étiquette" }) as HTMLInputElement;
    label.addEventListener("change", async () => { try { Object.assign(inst, await api.move(world.id, inst.id, { label: label.value })); toast("Étiquette enregistrée"); } catch (e) { refused(e); } });
    const vs = d.definition.variants.length ? h("select", { disabled: !mine, "aria-label": "Variante de l'instance" }, h("option", { value: "" }, "Apparence de base"),
      d.definition.variants.map((v) => h("option", { value: v.id, selected: v.id === inst.variant_id }, v.name))) as HTMLSelectElement : null;
    vs?.addEventListener("change", async () => { try { Object.assign(inst, await api.move(world.id, inst.id, { variant_id: vs.value || null })); scene.drawInstances(); } catch (e) { refused(e); } });
    fill(info, h("div", { class: "panel" },
      h("h2", {}, d.definition.name),
      h("p", { class: "meta" }, `${famLabel(d.family)} · v${inst.version}${outdated ? ` (catalogue : v${cat!.version})` : ""} · case (${inst.x}, ${inst.y}) · ${inst.rotation}°`),
      outdated ? h("p", { class: "muted small" }, "Cette instance conserve sa version d'origine tant qu'elle n'est pas migrée.") : null,
      field("Étiquette", label), vs ? field("Variante", vs) : null,
      h("div", { class: "row" },
        interiors.length ? h("button", { class: "btn btn-primary btn-small", onclick: () => enter(interiors[0].interior_id, d.definition.name) }, "Entrer") : null,
        mine ? h("button", { class: "btn btn-small", onclick: () => { moving = inst; picked = null; rotation = inst.rotation; renderPalette(); syncGhost(); status.textContent = "Touchez la nouvelle case (coin Nord-Ouest)."; } }, "Déplacer") : null,
        mine ? h("button", { class: "btn btn-small", onclick: async () => {
          try { Object.assign(inst, await api.move(world.id, inst.id, { rotation: (inst.rotation + 90) % 360 })); scene.drawInstances(); showInstance(inst); } catch (e) { refused(e); }
        } }, "Pivoter") : null,
        mine ? h("button", { class: "btn btn-small btn-quiet", onclick: async () => {
          await api.remove(world.id, inst.id); world.instances.splice(world.instances.indexOf(inst), 1); scene.selected = null; scene.drawInstances(); fill(info); toast("Retiré de la scène");
        } }, "Retirer") : null,
        h("a", { class: "btn btn-small", href: d.family === "character" ? `#/personnages/${inst.asset_id}` : `#/asset/${inst.asset_id}` }, "Voir l'asset"))));
  }

  async function enter(interiorId: string, house: string) {
    const entry = catalog.find((c) => c.asset_id === interiorId);
    if (!entry) return toast("Intérieur non publié.", "err");
    const furniture = furnitureRegistry(await api.assets({ family: "furniture" }));
    const host = h("div", { class: "stage stage-interior" });
    let g: any;
    const close = modal(`${house} — ${entry.definition.name}`, h("div", {}, h("p", { class: "muted" }, "Visite (vue) : le joueur apparaît au repère bleu ; les pastilles marquent les meubles interactifs."), host), [], { wide: true, cancel: "Sortir" });
    const sc = new PreviewScene();
    sc.state = { family: "interior", def: entry.definition, rotation: 0, variant: null, furniture,
      flags: { grid: false, footprint: false, collision: false, entrances: false, connectors: false, zones: false, dims: false } };
    g = mountGame(host, sc);
    const obs = new MutationObserver(() => { if (!document.body.contains(host)) { g.destroy(true); obs.disconnect(); } });
    obs.observe(document.body, { childList: true, subtree: true });
    void close;
  }

  function newScene() {
    const name = h("input", { value: "Nouvelle scène" }) as HTMLInputElement;
    const w = h("input", { type: "number", value: 30, min: 8, max: 120, class: "num" }) as HTMLInputElement;
    const hh = h("input", { type: "number", value: 30, min: 8, max: 120, class: "num" }) as HTMLInputElement;
    const tpl = h("select", {}, [["coast", "Quartier côtier (sol, plage, lagune)"], ["blank", "Terrain plat"], ["lagoon", "Autour d'une lagune"]].map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
    const close = modal("Nouvelle scène de test", h("div", { class: "fields" }, field("Nom", name), h("div", { class: "row" }, field("Largeur (cases)", w), field("Profondeur (cases)", hh)), field("Terrain", tpl)), [{
      label: "Créer", run: async () => {
        try { const s = await api.createScene({ name: name.value, width: Number(w.value), height: Number(hh.value), template: tpl.value }); close(); go(`#/carte?scene=${s.id}`); }
        catch (e) { toast((e as Error).message, "err"); }
      } }]);
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if ((picked || moving) && (e.key === "r" || e.key === "R")) { rotation = (rotation + 90) % 360; renderPalette(); syncGhost(); }
    if (e.key === "Escape") pick(null);
  };
  window.addEventListener("keydown", onKey);
  renderPalette();
  void (world as World);
  return () => { window.removeEventListener("keydown", onKey); game.destroy(true); };
}
