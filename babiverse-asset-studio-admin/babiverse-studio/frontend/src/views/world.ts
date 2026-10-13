// Monde du jeu : villes → zones (communes, quartiers) → cartes jouables, et éditeur de carte.
// Une carte se construit en brouillon (paysages 3D de la médiathèque, objets interactifs, point d'arrivée, accès depuis la
// Cité Akwaba), puis se publie : le jeu ne reçoit que la version publiée. Toutes les règles sont vérifiées par le serveur
// (backend/app/worldmaps.py) ; cet écran montre ses réponses (problèmes bloquants, emprises calculées).
import { api } from "../api";
import { go } from "../router";
import { can, confirmDialog, field, fill, fmtDate, fmtSize, h, row, toast } from "../ui";
import type { Media } from "../types";
import { freeEntranceTile } from "../mapEntrance";

const MAP_STATUS: Record<string, string> = { draft: "Brouillon", published: "Publiée", disabled: "Désactivée" };
const GROUNDS: Record<string, string> = { grass: "Herbe", dirt: "Terre battue", paving: "Pavés", sand: "Sable" };
const TYPES: Record<string, string> = { shop: "Boutique (fiche)", info: "Information (fiche)", door: "Passage vers une autre carte" };
const statusPill = (s: string) => h("span", { class: `pill pill-${s === "published" ? "published" : s === "disabled" ? "archived" : "draft"}` }, MAP_STATUS[s] ?? s);
const num = (v: string, d = 0) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
// Un affichage lancé avant une action (restauration, enregistrement) ne doit pas écraser celui qui suit : seul le
// dernier affichage demandé écrit à l'écran.
let renderSeq = 0;

export async function worldView(root: HTMLElement, path: string[]): Promise<(() => void) | void> {
  if (path[1] === "carte" && path[2]) return mapEditor(root, decodeURIComponent(path[2]));
  const seq = ++renderSeq;
  const [w, graph] = await Promise.all([api.worldMaps(), api.mapConnections()]);
  if (seq !== renderSeq) return;
  const manage = can("world.manage");
  const districts = w.cities.flatMap((c: any) => c.districts.map((d: any) => ({ ...d, city: c })));

  const input = (id: string, attrs: Record<string, any> = {}) => h("input", { id, ...attrs }) as HTMLInputElement;
  const cityId = input("city-id", { placeholder: "abidjan_sud", pattern: "[a-z][a-z0-9_]*" });
  const cityName = input("city-name", { placeholder: "Abidjan Sud" });
  const distCity = h("select", { id: "district-city" }, w.cities.map((c: any) => h("option", { value: c.id }, c.name))) as HTMLSelectElement;
  const distId = input("district-id", { placeholder: "treichville" });
  const distName = input("district-name", { placeholder: "Treichville" });
  const mapDist = h("select", { id: "map-district" }, districts.map((d: any) => h("option", { value: d.id }, `${d.city.name} › ${d.name}`))) as HTMLSelectElement;
  const mapId = input("map-id", { placeholder: "marche_treichville", maxlength: 32 });
  const mapName = input("map-name", { placeholder: "Marché de Treichville" });
  const mapW = input("map-width", { type: "number", value: "24", min: 8, max: 120 });
  const mapH = input("map-height", { type: "number", value: "18", min: 8, max: 120 });
  const mapGround = h("select", { id: "map-ground" }, Object.entries(GROUNDS).map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;

  async function run(fn: () => Promise<any>, msg: string, then?: (r: any) => void) {
    try { const r = await fn(); toast(msg); if (then) then(r); else await worldView(root, path); } catch (e) { toast((e as Error).message, "err"); }
  }

  const forms = manage ? h("section", { class: "panel" }, h("h2", {}, "Créer"),
    h("h3", {}, "Ville"), row(field("Identifiant", cityId, "minuscules, chiffres, _ ; définitif"), field("Nom", cityName),
      h("button", { id: "city-create", class: "btn btn-small", onclick: () => run(() => api.createCity({ id: cityId.value.trim(), name: cityName.value.trim() }), "Ville créée.") }, "Créer la ville")),
    h("h3", {}, "Zone (commune, quartier)"), w.cities.length ? row(field("Ville", distCity), field("Identifiant", distId), field("Nom", distName),
      h("button", { id: "district-create", class: "btn btn-small", onclick: () => run(() => api.createDistrict({ id: distId.value.trim(), city_id: distCity.value, name: distName.value.trim() }), "Zone créée.") }, "Créer la zone"))
      : h("p", { class: "muted small" }, "Créer d'abord une ville."),
    h("h3", {}, "Carte jouable"), districts.length ? row(field("Zone", mapDist), field("Identifiant", mapId, "devient la zone du jeu ; jamais renommé"), field("Nom", mapName),
      field("Largeur", mapW), field("Profondeur", mapH), field("Sol", mapGround),
      h("button", { id: "map-create", class: "btn btn-small btn-primary", onclick: () => run(() => api.createMap({
        id: mapId.value.trim(), district_id: mapDist.value, name: mapName.value.trim(), width: num(mapW.value, 24), height: num(mapH.value, 18), ground: mapGround.value,
      }), "Carte créée (brouillon).", (m) => go(`#/monde/carte/${m.id}`)) }, "Créer la carte"))
      : h("p", { class: "muted small" }, "Créer d'abord une zone.")) : null;

  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Villes et cartes du jeu"),
      h("p", { class: "lede" }, "Chaque carte devient une zone jouable. Le jeu ne reçoit que les versions publiées : un brouillon ne change jamais la carte active."),
      h("p", { class: "muted small" }, `Cartes intégrées au jeu, non modifiables ici : ${w.builtin_maps.join(", ")} (Cité Akwaba, studio, épicerie).`))),
    h("div", { class: "rows", id: "world-tree" }, w.cities.length ? w.cities.map((c: any) => h("section", { class: "panel", "data-city": c.id },
      h("h2", {}, c.name, h("small", { class: "muted" }, ` · ${c.id}`)),
      c.districts.length ? c.districts.map((d: any) => h("div", { "data-district": d.id }, h("h3", {}, d.name),
        d.maps.length ? h("div", { class: "rows" }, d.maps.map((m: any) => h("article", { class: "line", "data-map": m.id },
          h("div", {}, h("a", { href: `#/monde/carte/${m.id}` }, m.name), h("div", { class: "meta" }, `${m.id}${m.published_version ? ` · version publiée ${m.published_version}` : ""}${m.draft_pending && m.published_version ? " · brouillon modifié non publié" : ""}`)),
          statusPill(m.status)))) : h("p", { class: "muted small" }, "Aucune carte.")))
        : h("p", { class: "muted small" }, "Aucune zone."))) : h("p", { class: "muted" }, "Aucune ville pour l'instant.")),
    h("section", { class: "panel", id: "connections" }, h("h2", {}, "Connexions entre cartes"),
      h("p", { class: "muted small" }, "Passages des cartes publiées : accès depuis la Cité Akwaba et portes. Le serveur du jeu n'accepte l'arrivée sur une carte que par l'un d'eux, conditions remplies."),
      graph.edges.length ? h("ul", {}, graph.edges.map((e: any) => h("li", { "data-edge": `${e.from}>${e.to}` },
        `${e.from} → ${e.to} (arrivée ${e.spawn}) · ${e.kind === "entrance" ? `panneau « ${e.label} » en (${e.tile.join(", ")})` : `${e.mode === "transport" ? "transport" : "porte"} « ${e.label} »`}`
        + (e.conditions.length ? ` · conditions : ${e.conditions.map((c: any) => c.type === "mission_completed" ? `mission ${c.mission}` : `solde ≥ ${c.amount} F`).join(", ")}` : ""))))
        : h("p", { class: "muted small" }, "Aucune carte publiée.")),
    forms);
}

// ------------------------------------------------------------------ éditeur de carte

async function mapEditor(root: HTMLElement, id: string) {
  const seq = ++renderSeq;
  const [detail, models] = await Promise.all([api.mapDetail(id), api.media({ kind: "model" })]);
  if (seq !== renderSeq) return;
  const draft = JSON.parse(JSON.stringify(detail.draft));
  const manage = can("world.manage");
  let dirty = false;
  let selected: string | null = null; // objet interactif dont la zone se trace sur l'aperçu
  const modelOf = (mid: string): Media | undefined => (models as Media[]).find((m) => m.id === mid);
  const touch = () => { dirty = true; status.textContent = "Modifications non enregistrées."; publishBtn.disabled = true; draw(); };

  // --- aperçu vu de dessus (cases), tracé des zones par glisser
  const canvas = h("canvas", { id: "map-canvas", class: "map-preview", "aria-label": "Aperçu de la carte vu de dessus" }) as HTMLCanvasElement;
  const CELL = Math.max(8, Math.min(28, Math.floor(640 / Math.max(draft.width, draft.height))));
  function draw() {
    canvas.width = draft.width * CELL; canvas.height = draft.height * CELL;
    const g = canvas.getContext("2d")!;
    g.fillStyle = ({ grass: "#9dc183", dirt: "#d8c39a", paving: "#c9c3b8", sand: "#eedfa6" } as any)[draft.ground] || "#9dc183";
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = "#8d8a83"; g.fillRect(0, 0, canvas.width, CELL); g.fillRect(0, canvas.height - CELL, canvas.width, CELL);
    g.fillRect(0, 0, CELL, canvas.height); g.fillRect(canvas.width - CELL, 0, CELL, canvas.height);
    g.strokeStyle = "rgba(0,0,0,.08)";
    for (let x = 0; x <= draft.width; x++) { g.beginPath(); g.moveTo(x * CELL, 0); g.lineTo(x * CELL, canvas.height); g.stroke(); }
    for (let y = 0; y <= draft.height; y++) { g.beginPath(); g.moveTo(0, y * CELL); g.lineTo(canvas.width, y * CELL); g.stroke(); }
    for (const l of draft.landscapes) {
      const f = l.footprint;
      if (!f) continue;
      g.fillStyle = l.solid ? "rgba(31,111,235,.35)" : "rgba(31,111,235,.15)"; g.fillRect(f.x * CELL, f.y * CELL, f.w * CELL, f.h * CELL);
      g.strokeStyle = "#1f6feb"; g.strokeRect(f.x * CELL, f.y * CELL, f.w * CELL, f.h * CELL);
      g.fillStyle = "#0b3d91"; g.font = "11px sans-serif"; g.fillText(l.id, f.x * CELL + 3, f.y * CELL + 12);
    }
    for (const it of draft.interactives) {
      const a = it.area;
      if (!a) continue;
      const color = !it.active ? "#7f8c8d" : it.type === "door" ? "#c0392b" : it.type === "shop" ? "#27ae60" : "#f39c12";
      g.fillStyle = color + "66"; g.fillRect(a.x * CELL, a.y * CELL, a.w * CELL, a.h * CELL);
      g.strokeStyle = color; g.lineWidth = it.id === selected ? 3 : 1; g.strokeRect(a.x * CELL, a.y * CELL, a.w * CELL, a.h * CELL); g.lineWidth = 1;
      g.fillStyle = "#222"; g.fillText(it.name, a.x * CELL + 2, (a.y + a.h) * CELL - 3);
    }
    for (const a of draft.arrivals ?? []) {
      g.strokeStyle = "#8e44ad"; g.strokeRect(a.x * CELL + 2, a.y * CELL + 2, CELL - 4, CELL - 4);
      g.fillStyle = "#5b2c6f"; g.fillText(a.id, a.x * CELL + 2, a.y * CELL - 2);
    }
    const [sx, sy] = draft.spawn;
    g.fillStyle = "#8e44ad"; g.beginPath(); g.arc((sx + 0.5) * CELL, (sy + 0.5) * CELL, CELL * 0.35, 0, Math.PI * 2); g.fill();
  }
  let dragFrom: [number, number] | null = null;
  const cellAt = (e: MouseEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / (r.width / draft.width)), Math.floor((e.clientY - r.top) / (r.height / draft.height))]; };
  canvas.addEventListener("mousedown", (e) => { if (manage && selected) dragFrom = cellAt(e); });
  canvas.addEventListener("mouseup", (e) => {
    if (!dragFrom || !selected) return;
    const [x1, y1] = cellAt(e);
    const it = draft.interactives.find((i: any) => i.id === selected);
    if (it) {
      it.node = null; it.landscape = it.landscape ?? null;
      it.area = { x: Math.min(dragFrom[0], x1), y: Math.min(dragFrom[1], y1), w: Math.abs(x1 - dragFrom[0]) + 1, h: Math.abs(y1 - dragFrom[1]) + 1 };
      dragFrom = null; touch(); renderLists();
    }
  });

  // --- paysages
  const upload = h("input", { id: "land-file", type: "file", accept: ".glb,.gltf,model/gltf-binary,model/gltf+json", disabled: !can("media.upload") }) as HTMLInputElement;
  const uploadInfo = h("div", { id: "land-upload-info", "aria-live": "polite", class: "small" });
  const pick = h("select", { id: "land-media" }, (models as Media[]).filter((m) => !m.archived).map((m) => h("option", { value: m.id }, `${m.name} · ${m.meta.size?.join("×")} · rév. ${m.revision}`))) as HTMLSelectElement;
  upload.addEventListener("change", async () => {
    const f = upload.files?.[0];
    if (!f) return;
    uploadInfo.textContent = "Import et vérification…";
    try {
      const m = await api.uploadMedia(f, f.name, { name: f.name.replace(/\.(glb|gltf)$/i, ""), category: "landscape" });
      (models as Media[]).unshift(m);
      pick.prepend(h("option", { value: m.id, selected: true }, `${m.name} · ${m.meta.size?.join("×")} · rév. ${m.revision}`));
      pick.value = m.id;
      fill(uploadInfo, h("p", { class: "txt-ok" }, `Modèle valide : ${m.name} (${fmtSize(m.size)}), ${m.meta.size?.join(" × ")} unités, ${m.meta.triangles} triangles.`),
        h("p", {}, `Objets nommés : ${(m.meta.objects ?? []).map((o) => o.unique ? o.name : `${o.name} (en double)`).join(", ") || "aucun"}`),
        (m.meta.warnings ?? []).map((w) => h("p", { class: "txt-danger" }, w)));
    } catch (e) { fill(uploadInfo, h("p", { class: "txt-danger" }, `Fichier refusé : ${(e as Error).message}`)); }
    upload.value = "";
  });
  const addLand = h("button", { id: "land-add", class: "btn btn-small", disabled: !manage, onclick: () => {
    if (!pick.value) return toast("Importer ou choisir un modèle 3D.", "err");
    let n = 1; while (draft.landscapes.some((l: any) => l.id === `paysage_${n}`)) n++;
    draft.landscapes.push({ id: `paysage_${n}`, media_id: pick.value, x: Math.floor(draft.width / 3), z: Math.floor(draft.height / 3), rotation: 0, scale: 1, solid: true });
    touch(); renderLists();
  } }, "Ajouter à la carte");

  const lands = h("div", { class: "rows", id: "land-list" });
  const items = h("div", { class: "rows", id: "it-list" });
  function inputFor(obj: any, key: string, attrs: Record<string, any> = {}, parse: (v: string) => any = (v) => v) {
    const el = h("input", { value: obj[key] ?? "", disabled: !manage, "data-k": key, ...attrs }) as HTMLInputElement;
    el.addEventListener("input", () => { obj[key] = parse(el.value); touch(); });
    return el;
  }
  function renderLists() {
    fill(lands, draft.landscapes.length ? draft.landscapes.map((l: any) => {
      const m = modelOf(l.media_id);
      const rot = h("select", { "data-k": "rotation", disabled: !manage }, [0, 90, 180, 270].map((r) => h("option", { value: r, selected: r === l.rotation }, `${r}°`))) as HTMLSelectElement;
      rot.addEventListener("change", () => { l.rotation = Number(rot.value); touch(); });
      const solid = h("input", { type: "checkbox", checked: l.solid !== false, disabled: !manage, "data-k": "solid" }) as HTMLInputElement;
      solid.addEventListener("change", () => { l.solid = solid.checked; touch(); });
      const newer = detail.newer_revisions?.[l.id];
      return h("article", { class: "line", "data-land": l.id },
        h("div", {}, h("strong", {}, l.id),
          newer && l.revision < newer ? h("p", { class: "small txt-danger" }, `Révision ${newer} du fichier disponible (la carte garde la révision ${l.revision}). `,
            manage ? h("button", { class: "btn btn-small", "data-k": "adopt", onclick: () => { l.revision = newer; touch(); renderLists(); } }, `Utiliser la révision ${newer}`) : null) : null,
          h("div", { class: "meta" }, `${m ? m.name : l.media_id}${l.revision ? ` · révision figée ${l.revision}` : " · révision courante à l'enregistrement"}${l.footprint ? ` · emprise ${l.footprint.w}×${l.footprint.h} en (${l.footprint.x}, ${l.footprint.y})` : ""}`)),
        row(field("x", inputFor(l, "x", { type: "number", step: "0.5", style: { width: "5em" } }, (v) => num(v))),
          field("z", inputFor(l, "z", { type: "number", step: "0.5", style: { width: "5em" } }, (v) => num(v))),
          field("Rotation", rot), field("Échelle", inputFor(l, "scale", { type: "number", step: "0.1", min: "0.1", style: { width: "5em" } }, (v) => num(v, 1))),
          h("label", { class: "toggle" }, solid, "Infranchissable"),
          manage ? h("button", { class: "btn btn-small btn-danger", onclick: async () => {
            if (!(await confirmDialog("Retirer ce paysage ?", `L'instance « ${l.id} » sera retirée du brouillon (le fichier reste dans la médiathèque et les autres cartes ne changent pas).`, "Retirer", true))) return;
            draft.landscapes = draft.landscapes.filter((x: any) => x !== l);
            for (const it of draft.interactives) if (it.landscape === l.id) { it.landscape = null; it.node = null; }
            touch(); renderLists();
          } }, "Retirer") : null));
    }) : h("p", { class: "muted small" }, "Aucun paysage."));

    fill(items, draft.interactives.length ? draft.interactives.map((it: any) => {
      const type = h("select", { "data-k": "type", disabled: !manage }, Object.entries(TYPES).map(([k, lbl]) => h("option", { value: k, selected: k === it.type }, lbl))) as HTMLSelectElement;
      type.addEventListener("change", () => { it.type = type.value; if (it.type === "door" && !it.target) it.target = { zone: "quartier", spawn: `from_${id}` }; touch(); renderLists(); });
      const active = h("input", { type: "checkbox", checked: it.active !== false, disabled: !manage, "data-k": "active" }) as HTMLInputElement;
      active.addEventListener("change", () => { it.active = active.checked; touch(); });
      const land = h("select", { "data-k": "landscape", disabled: !manage }, h("option", { value: "" }, "— zone tracée à la main —"),
        draft.landscapes.map((l: any) => h("option", { value: l.id, selected: l.id === it.landscape }, l.id))) as HTMLSelectElement;
      const objects = it.landscape ? (modelOf(draft.landscapes.find((l: any) => l.id === it.landscape)?.media_id)?.meta.objects ?? []).filter((o) => o.unique) : [];
      const node = h("select", { "data-k": "node", disabled: !manage || !it.landscape }, h("option", { value: "" }, objects.length || !it.landscape ? "— aucun objet —" : "— aucun objet nommé unique —"),
        objects.map((o) => h("option", { value: o.name, selected: o.name === it.node }, o.name))) as HTMLSelectElement;
      land.addEventListener("change", () => { it.landscape = land.value || null; it.node = null; touch(); renderLists(); });
      node.addEventListener("change", () => { it.node = node.value || null; if (it.node) it.area = null; touch(); renderLists(); });
      const a = it.area ?? (it.area = null);
      const areaFields = it.node ? h("p", { class: "small muted" }, a ? `Zone déduite de l'objet : ${a.w}×${a.h} en (${a.x}, ${a.y})` : "Zone calculée à l'enregistrement d'après l'objet du modèle.")
        : row(...(["x", "y", "w", "h"] as const).map((k) => {
          const el = h("input", { type: "number", min: k === "w" || k === "h" ? 1 : 0, value: a?.[k] ?? "", disabled: !manage, "data-k": `area.${k}`, style: { width: "4.5em" } }) as HTMLInputElement;
          el.addEventListener("input", () => { it.area = { x: 1, y: 1, w: 1, h: 1, ...(it.area ?? {}), [k]: num(el.value, 1) }; touch(); });
          return field(k, el);
        }));
      const target = it.type === "door" ? (() => {
        const zones = Object.keys(detail.targets);
        const cur = it.target?.zone ?? "quartier";
        const z = h("select", { "data-k": "target.zone", disabled: !manage }, zones.map((t: string) => h("option", { value: t, selected: t === cur }, t))) as HTMLSelectElement;
        const spawns: string[] = detail.targets[cur] ?? ["default"];
        const sp = h("select", { "data-k": "target.spawn", disabled: !manage }, spawns.map((x: string) => h("option", { value: x, selected: x === it.target?.spawn }, x))) as HTMLSelectElement;
        z.addEventListener("change", () => { it.target = { zone: z.value, spawn: (detail.targets[z.value] ?? ["default"])[0] }; touch(); renderLists(); });
        sp.addEventListener("change", () => { it.target = { zone: z.value, spawn: sp.value }; touch(); });
        const mode = h("select", { "data-k": "mode", disabled: !manage }, [["walk", "À pied"], ["transport", "Transport (gbaka, taxi…)"]].map(([k, l]) => h("option", { value: k, selected: k === (it.mode ?? "walk") }, l))) as HTMLSelectElement;
        mode.addEventListener("change", () => { it.mode = mode.value; touch(); });
        it.conditions = it.conditions ?? [];
        const conds = it.conditions.map((c: any, k: number) => h("li", { "data-cond": k },
          c.type === "mission_completed" ? `Mission terminée : ${c.mission} ` : `Solde d'au moins ${c.amount} F `,
          manage ? h("button", { class: "btn btn-small", onclick: () => { it.conditions.splice(k, 1); touch(); renderLists(); } }, "Retirer") : null));
        const mission = h("select", { "data-k": "cond.mission", disabled: !manage }, detail.missions.map((m: string) => h("option", { value: m }, m))) as HTMLSelectElement;
        const amount = h("input", { type: "number", min: 0, step: 100, value: "1000", "data-k": "cond.amount", disabled: !manage, style: { width: "6em" } }) as HTMLInputElement;
        return h("div", {}, row(field("Destination", z), field("Point d'arrivée", sp, "points proposés par le serveur pour cette destination"), field("Passage", mode)),
          h("p", { class: "small" }, "Conditions de passage (vérifiées par le serveur du jeu) :"),
          h("ul", { class: "small" }, conds.length ? conds : h("li", { class: "muted" }, "aucune")),
          manage ? row(field("Mission", mission),
            h("button", { class: "btn btn-small", "data-k": "cond.add-mission", onclick: () => { it.conditions.push({ type: "mission_completed", mission: mission.value }); touch(); renderLists(); } }, "Exiger la mission"),
            field("Solde", amount),
            h("button", { class: "btn btn-small", "data-k": "cond.add-balance", onclick: () => { it.conditions.push({ type: "min_balance", amount: num(amount.value) }); touch(); renderLists(); } }, "Exiger un solde")) : null);
      })() : null;
      return h("article", { class: `line ${it.id === selected ? "selected" : ""}`, "data-it": it.id, onclick: () => { if (selected !== it.id) { selected = it.id; draw(); } } },
        h("div", {}, h("strong", {}, it.id), h("div", { class: "meta" }, it.active === false ? "désactivé : aucune interaction dans le jeu" : TYPES[it.type])),
        h("div", {}, row(field("Nom affiché", inputFor(it, "name")), field("Type", type), h("label", { class: "toggle" }, active, "Actif")),
          row(field("Paysage", land), field("Objet du modèle", node)), areaFields,
          row(field("Libellé de l'action", inputFor(it, "label", { placeholder: "Regarder la boutique" })), field("Texte de la fiche", inputFor(it, "text"))), target,
          manage ? h("button", { class: "btn btn-small btn-danger", onclick: async () => {
            if (!(await confirmDialog("Supprimer cet objet interactif ?", `« ${it.name} » sera retiré du brouillon.`, "Supprimer", true))) return;
            draft.interactives = draft.interactives.filter((x: any) => x !== it); touch(); renderLists();
          } }, "Supprimer") : null));
    }) : h("p", { class: "muted small" }, "Aucun objet interactif."));
    draw();
  }
  const addIt = h("button", { id: "it-add", class: "btn btn-small", disabled: !manage, onclick: () => {
    let n = 1; while (draft.interactives.some((i: any) => i.id === `objet_${n}`)) n++;
    draft.interactives.push({ id: `objet_${n}`, name: `Objet ${n}`, type: "shop", active: true, area: { x: 2, y: 2, w: 2, h: 1 }, landscape: null, node: null, label: "", text: "" });
    selected = `objet_${n}`; touch(); renderLists();
  } }, "Ajouter un objet interactif");

  // --- arrivée, accès, sol
  const spawnX = inputFor({ get v() { return draft.spawn[0]; }, set v(x) { draft.spawn = [x, draft.spawn[1]]; } }, "v", { id: "spawn-x", type: "number", style: { width: "4.5em" } }, (v) => num(v));
  const spawnY = inputFor({ get v() { return draft.spawn[1]; }, set v(y) { draft.spawn = [draft.spawn[0], y]; } }, "v", { id: "spawn-y", type: "number", style: { width: "4.5em" } }, (v) => num(v));
  const entr = draft.entrance ?? { zone: "quartier", x: "", y: "", label: "" };
  const syncEntrance = () => { draft.entrance = entr.x !== "" && entr.y !== "" && String(entr.label).trim() ? { zone: "quartier", x: Number(entr.x), y: Number(entr.y), label: String(entr.label).trim() } : null; };
  const entrance = row(
    field("Case x", inputFor(entr, "x", { id: "entr-x", type: "number", style: { width: "5em" } }, (v) => { const r = v === "" ? "" : num(v); queueMicrotask(syncEntrance); return r; })),
    field("Case y", inputFor(entr, "y", { id: "entr-y", type: "number", style: { width: "5em" } }, (v) => { const r = v === "" ? "" : num(v); queueMicrotask(syncEntrance); return r; })),
    field("Texte du panneau", inputFor(entr, "label", { id: "entr-label", maxlength: 24, placeholder: "→ TREICHVILLE" }, (v) => { queueMicrotask(syncEntrance); return v; })));
  draft.arrivals = draft.arrivals ?? [];
  const arrivalsBox = h("div", { id: "arrival-list" });
  function renderArrivals() {
    fill(arrivalsBox, draft.arrivals.length ? draft.arrivals.map((a: any) => h("article", { class: "line", "data-arrival": a.id },
      row(field("Identifiant", inputFor(a, "id", { style: { width: "9em" } }, (v) => v.trim())),
        field("x", inputFor(a, "x", { type: "number", style: { width: "4.5em" } }, (v) => num(v))),
        field("y", inputFor(a, "y", { type: "number", style: { width: "4.5em" } }, (v) => num(v))),
        manage ? h("button", { class: "btn btn-small", onclick: () => { draft.arrivals = draft.arrivals.filter((x: any) => x !== a); touch(); renderArrivals(); } }, "Retirer") : null)))
      : h("p", { class: "muted small" }, "Aucun point d'arrivée nommé (les portes venant d'ailleurs arrivent au point d'arrivée principal)."));
  }
  const addArrival = h("button", { id: "arrival-add", class: "btn btn-small", disabled: !manage, onclick: () => {
    let n = 1; while (draft.arrivals.some((a: any) => a.id === `arrivee_${n}`)) n++;
    draft.arrivals.push({ id: `arrivee_${n}`, x: draft.spawn[0], y: draft.spawn[1] }); touch(); renderArrivals();
  } }, "Ajouter un point d'arrivée");
  // --- corrections en un clic des deux manques d'une carte neuve (aucune sortie, aucun accès)
  const hasExit = () => draft.interactives.some((it: any) => it.type === "door" && it.active !== false);
  const addExit = () => {
    let n = 1; while (draft.interactives.some((i: any) => i.id === (n === 1 ? "sortie" : `sortie_${n}`))) n++;
    const exitId = n === 1 ? "sortie" : `sortie_${n}`;
    const w = Math.min(2, draft.width - 2);
    draft.interactives.push({ id: exitId, name: "Retour à la Cité Akwaba", type: "door", active: true,
      area: { x: Math.max(1, Math.min(draft.spawn[0], draft.width - 1 - w)), y: draft.height - 2, w, h: 1 }, landscape: null, node: null,
      label: "Retourner à la Cité Akwaba", text: "", mode: "walk", conditions: [],
      // retour devant le panneau d'accès de cette carte s'il existe, sinon au départ de la ville
      target: { zone: "quartier", spawn: draft.entrance ? `from_${id}` : "default" } });
    selected = exitId; touch(); renderLists();
    toast("Porte de sortie ajoutée en bas de la carte (zone modifiable). Enregistrer le brouillon pour revérifier.");
  };
  const proposeEntrance = async () => {
    try {
      const [game, graph] = await Promise.all([api.gamePlacements(), api.mapConnections()]);
      const taken = (graph.edges as any[]).filter((e) => e.kind === "entrance" && e.to !== id && e.from === "quartier" && e.tile).map((e) => e.tile as [number, number]);
      const tile = freeEntranceTile((game.placements as any[]).filter((p) => p.available !== false), (game.removals as any[]).map((r) => r.key), taken);
      if (!tile) return toast("Aucune case libre trouvée dans la Cité Akwaba : la saisir à la main.", "err");
      entr.x = tile[0]; entr.y = tile[1];
      if (!String(entr.label).trim()) entr.label = `→ ${String(detail.name).toUpperCase()}`.slice(0, 24);
      for (const [k, v] of [["entr-x", entr.x], ["entr-y", entr.y], ["entr-label", entr.label]] as const) {
        const el = root.querySelector<HTMLInputElement>(`#${k}`); if (el) el.value = String(v);
      }
      syncEntrance();
      // une porte déjà créée vers le départ de la ville revient plutôt devant ce panneau
      for (const it of draft.interactives) if (it.type === "door" && it.target?.zone === "quartier" && it.target.spawn === "default") it.target.spawn = `from_${id}`;
      touch(); renderLists();
      toast(`Case d'accès proposée : (${tile[0]}, ${tile[1]}). Enregistrer le brouillon pour revérifier.`);
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const fixes = manage ? row(
    !hasExit() ? h("button", { id: "fix-exit", class: "btn btn-small", onclick: (ev: Event) => { (ev.currentTarget as HTMLButtonElement).disabled = true; addExit(); } }, "Ajouter une porte de retour vers la Cité Akwaba") : null,
    !draft.entrance ? h("button", { id: "fix-entrance", class: "btn btn-small", onclick: async (ev: Event) => { const b = ev.currentTarget as HTMLButtonElement; b.disabled = true; await proposeEntrance(); b.disabled = !!draft.entrance; } }, "Proposer une case d'accès libre") : null) : null;

  const ground = h("select", { id: "draft-ground", disabled: !manage }, Object.entries(GROUNDS).map(([k, l]) => h("option", { value: k, selected: k === draft.ground }, l))) as HTMLSelectElement;
  ground.addEventListener("change", () => { draft.ground = ground.value; touch(); });

  // --- enregistrement, publication
  const status = h("p", { id: "map-status", class: "muted", "aria-live": "polite" }, detail.draft_pending && detail.published_version ? "Brouillon différent de la version publiée." : "");
  const save = h("button", { id: "map-save", class: "btn btn-primary", disabled: !manage, onclick: async () => {
    syncEntrance();
    // l'emprise est recalculée par le serveur : on n'envoie que les réglages de chaque instance
    const body = { ...draft, landscapes: draft.landscapes.map(({ footprint: _f, ...l }: any) => l) };
    try { await api.saveMapDraft(id, body); toast("Brouillon enregistré (la carte publiée ne change pas)."); await mapEditor(root, id); } catch (e) { toast((e as Error).message, "err"); }
  } }, "Enregistrer le brouillon");
  const reset = h("button", { id: "map-reset", class: "btn", disabled: !manage, onclick: async () => {
    if (dirty && !(await confirmDialog("Annuler les modifications ?", "Les changements non enregistrés seront perdus.", "Annuler les modifications", true))) return;
    await mapEditor(root, id);
  } }, "Annuler les modifications");
  const publishBtn = h("button", { id: "map-publish", class: "btn btn-primary", disabled: !can("world.publish") || detail.issues.length > 0, onclick: async () => {
    if (dirty) return toast("Enregistrer le brouillon avant de publier.", "err");
    if (!(await confirmDialog("Publier cette carte ?", `La version ${(detail.published_version ?? 0) + 1} remplacera la carte active dans le jeu.`, "Publier"))) return;
    try { await api.publishMap(id); toast("Carte publiée : le jeu la charge à sa prochaine lecture du pack."); await mapEditor(root, id); } catch (e) { toast((e as Error).message, "err"); }
  } }, detail.published_version ? "Publier une nouvelle version" : "Publier") as HTMLButtonElement;
  const toggle = detail.published_version && can("world.publish") ? h("button", { id: "map-disable", class: "btn", onclick: async () => {
    const enable = detail.status === "disabled";
    if (!enable && !(await confirmDialog("Désactiver cette carte ?", "Le jeu cessera de la proposer. Les données des joueurs sont conservées.", "Désactiver", true))) return;
    try { await api.setMapStatus(id, enable); toast(enable ? "Carte réactivée." : "Carte désactivée."); await mapEditor(root, id); } catch (e) { toast((e as Error).message, "err"); }
  } }, detail.status === "disabled" ? "Réactiver" : "Désactiver") : null;

  fill(root,
    h("header", { class: "page-head" }, h("div", {},
      h("p", { class: "muted small" }, h("a", { href: "#/monde" }, "Villes et cartes"), ` › ${detail.city_id} › ${detail.district_id}`),
      h("h1", {}, detail.name, " ", statusPill(detail.status)),
      h("p", { class: "lede" }, `${id} · ${draft.width}×${draft.height} cases${detail.published_version ? ` · version publiée ${detail.published_version}` : " · jamais publiée"}`)),
      row(save, reset, publishBtn, toggle)),
    status,
    h("p", { id: "map-weight", class: detail.weight.warnings.length ? "txt-danger small" : "muted small" },
      `Poids pour le jeu : ${fmtSize(detail.weight.bytes || 1)} à télécharger (${detail.weight.files} fichier(s) pour ${detail.weight.instances} instance(s)), `
      + `${detail.weight.triangles.toLocaleString("fr-FR")} triangles. `, detail.weight.warnings.join(" ")),
    detail.issues.length ? h("section", { class: "panel", id: "map-issues" }, h("h2", {}, "À corriger avant publication"), h("ul", {}, detail.issues.map((i: string) => h("li", { class: "txt-danger" }, i))), fixes)
      : h("p", { class: "txt-ok", id: "map-issues" }, "Aucun problème : le brouillon peut être publié."),
    h("section", { class: "panel" }, h("h2", {}, "Aperçu vu de dessus"), canvas,
        h("p", { class: "muted small" }, "Bleu : emprises des paysages · vert : boutiques · orange : informations · rouge : passages · violet : arrivée. "
          + "Sélectionner un objet interactif puis glisser sur l'aperçu pour tracer sa zone."),
        row(field("Sol", ground), field("Arrivée x", spawnX), field("Arrivée y", spawnY))),
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Points d'arrivée nommés"),
        h("p", { class: "muted small" }, "Destinations des portes venant d'autres cartes (gare, quai…). Le jeu ne place jamais un joueur dans un obstacle."),
        addArrival, arrivalsBox),
      h("section", { class: "panel" }, h("h2", {}, "Accès depuis la Cité Akwaba"),
        h("p", { class: "muted small" }, "Un panneau de direction posé sur cette case de la ville mène à la carte. Le jeu refuse une case de route, de bâtiment ou de parcelle (le panneau n'apparaît pas)."),
        entrance)),
    h("section", { class: "panel" }, h("h2", {}, "Paysages 3D"),
      h("p", { class: "muted small" }, "Une instance place un modèle de la médiathèque sur cette carte. Modifier sa position, sa rotation ou son échelle ne change ni le fichier ni les autres cartes ; "
        + "la révision du fichier est figée à l'enregistrement. 1 unité du modèle = 1 case à l'échelle 1."),
      row(field("Importer un GLB / glTF", upload), field("Modèle", pick), addLand), uploadInfo, lands),
    h("section", { class: "panel" }, h("h2", {}, "Objets interactifs"),
      h("p", { class: "muted small" }, "Rendre interactif un objet sans toucher au modèle : choisir un objet nommé du paysage (zone déduite), ou tracer une zone à la main pour un maillage fusionné. "
        + "Un objet désactivé reste visible mais n'offre plus d'action."), addIt, items),
    h("section", { class: "panel", id: "map-changes" }, h("h2", {}, "Aperçu de la publication"),
      detail.changes.length ? h("ul", {}, detail.changes.map((c: string) => h("li", {}, c)))
        : h("p", { class: "muted small" }, "Le brouillon enregistré est identique à la version publiée.")),
    detail.versions.length ? h("section", { class: "panel", id: "map-versions" }, h("h2", {}, "Versions publiées"),
      h("p", { class: "muted small" }, "Restaurer reprend une version dans le brouillon ; rien ne change dans le jeu avant la publication."),
      h("ul", {}, detail.versions.map((v: any) => h("li", { "data-version": v.version },
        `Version ${v.version}${v.version === detail.published_version ? " (active)" : ""} · ${v.published_by} · ${fmtDate(v.published_at)}${v.note ? ` · ${v.note}` : ""} `,
        manage && v.version !== detail.published_version ? h("button", { class: "btn btn-small", onclick: async () => {
          if (dirty && !(await confirmDialog("Remplacer le brouillon ?", "Les modifications non enregistrées seront perdues.", "Restaurer", true))) return;
          try { await api.restoreMap(id, v.version); toast(`Version ${v.version} reprise dans le brouillon (non publiée).`); await mapEditor(root, id); } catch (e) { toast((e as Error).message, "err"); }
        } }, "Restaurer dans le brouillon") : null)))) : null);
  renderLists();
  renderArrivals();
  window.onbeforeunload = () => (dirty ? "Modifications non enregistrées" : null);
  return () => { window.onbeforeunload = null; };
}
