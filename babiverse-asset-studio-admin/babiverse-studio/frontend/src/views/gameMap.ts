// Carte du jeu : la vraie ville de Babiverse (générée par les mêmes modules que le jeu), sur laquelle l'administrateur
// trace une zone puis y pose un élément publié (bâtiment, objet, véhicule, surface). Les règles de placement sont
// celles du jeu (client/src/world/placement.js) : routes, parcelles des joueurs, lotissement, bâtiments et décor.
// Les éléments d'origine de la ville (bâtiments, arbres, mobilier) peuvent aussi être retirés, sauf ceux dont le jeu
// a besoin (client/src/world/removal.js) ; un élément retiré libère sa place pour un placement.
// Dessin : views/gameMapRender.ts (couche de base mise en cache + couche interactive redessinée au survol).
import { buildCity } from "@jeu/world/city.js";
import { occupancy, placementIssue } from "@jeu/world/placement.js";
import { cityElements, cityWithout, elementAt, type CityElement } from "@jeu/world/removal.js";
import { api } from "../api";
import { can, fill, h, thumbnail, toast } from "../ui";
import { drawBase, drawOverlay, FAMILY_COLOR, RULER, type MapLayers } from "./gameMapRender";

interface Rect { x: number; y: number; w: number; h: number }
interface Placement extends Rect { id: string; asset_id: string; family: string; facing: string; name?: string | null; available?: boolean }
interface Placeable { id: string; technical_name: string; family: string; name: string; subcategory: string; w: number; d: number; definition: any }

const FAMILY_LABEL: Record<string, string> = { building: "Bâtiments", prop: "Objets et végétation", vehicle: "Véhicules", surface: "Surfaces" };
const FACING_LABEL: Record<string, string> = { S: "Façade au sud ↓", N: "Façade au nord ↑", E: "Façade à l'est →", W: "Façade à l'ouest ←" };
const KIND_LABEL: Record<string, string> = { building: "Bâtiment d'origine", tree: "Végétation d'origine", prop: "Mobilier d'origine" };
const GROUND_LABEL: Record<string, string> = {
  ".": "Terre battue", ",": "Herbe", "_": "Trottoir", "=": "Route", "-": "Route", "|": "Route", "+": "Passage piéton", ":": "Place pavée",
  "l": "Parcelle des joueurs", "#": "Mur d'enceinte",
};
const LAYERS_KEY = "babiverse.gmap.layers";

const footprint = (a: Placeable, facing: string) => (facing === "E" || facing === "W" ? { w: a.d, h: a.w } : { w: a.w, h: a.d });
const loadLayers = (): MapLayers => {
  try { return { labels: true, grid: true, free: false, ...JSON.parse(localStorage.getItem(LAYERS_KEY) || "{}") }; } catch { return { labels: true, grid: true, free: false }; }
};

export async function gameMapView(root: HTMLElement) {
  const base = buildCity();
  const elements = cityElements(base);
  const W = base.map[0].length;
  const H = base.map.length;
  const editable = can("asset.publish");
  let data: { placements: Placement[]; assets: Placeable[]; removals: { key: string; label: string }[] } = await api.gamePlacements();
  const assetById = () => new Map(data.assets.map((a) => [a.id, a]));
  let assets = assetById();
  // Ville telle que le jeu l'affiche : sans les éléments retirés (les placements sont dessinés par-dessus).
  let city: any;
  let occ: any;
  let free: Uint8Array = new Uint8Array(W * H);
  const removedKeys = () => new Set(data.removals.map((r) => r.key));
  const others = (except?: string) => data.placements.filter((p) => p.id !== except && p.available !== false);
  /** Case libre pour un élément d'une case (calque « zones libres », cases bloquées de la zone tracée). */
  const cellFree = (x: number, y: number) => !placementIssue(city, occ, { family: "prop", x, y, w: 1, h: 1 }, others());
  const refresh = () => {
    city = cityWithout(base, data.removals.map((r) => r.key)).zone;
    occ = occupancy(city);
    assets = assetById();
    free = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) free[y * W + x] = cellFree(x, y) ? 1 : 0;
  };
  refresh();

  let layers = loadLayers();
  let scale = 10;
  let picked: CityElement | null = null;
  let selected: Placement | null = null;
  let drawn: Rect | null = null;
  let hover: [number, number] | null = null;
  let facing = "S";
  let family = "building";

  const baseCanvas = h("canvas", { class: "gmap-canvas" }) as HTMLCanvasElement;
  const overlay = h("canvas", { class: "gmap-canvas gmap-overlay", "aria-label": "Carte de la ville du jeu : cliquer-glisser pour tracer une zone" }) as HTMLCanvasElement;
  const tip = h("div", { class: "gmap-tip", hidden: true });
  const stage = h("div", { class: "gmap-stage" }, baseCanvas, overlay, tip);
  const wrap = h("div", { class: "gmap-wrap" }, stage);
  const panel = h("div", { class: "gmap-panel" });
  const listBox = h("div", { class: "rows" });
  const removedBox = h("div", { class: "rows" });
  const zoomLabel = h("span", { class: "gmap-zoom muted small" });

  // --- dessin
  function drawAll() {
    const w = RULER + W * scale, hh = RULER + H * scale;
    for (const c of [baseCanvas, overlay]) { c.width = w; c.height = hh; }
    stage.style.width = `${w}px`; stage.style.height = `${hh}px`;
    drawBase(baseCanvas.getContext("2d")!, {
      city, base, gone: removedKeys(), elements, placements: data.placements,
      assetOf: (p) => assets.get(p.asset_id)?.definition ?? null, free,
    }, scale, layers);
    zoomLabel.textContent = `${scale} px par case`;
    overlay.dataset.scale = String(scale); overlay.dataset.ruler = String(RULER); // lus par les tests de bout en bout
    drawTop();
  }
  const rectOf = (r: { x: number; y: number; w: number; h: number }) => ({ x0: r.x, y0: r.y, x1: r.x + r.w - 1, y1: r.y + r.h - 1 });
  function hovered() {
    if (!hover) return null;
    const [x, y] = hover;
    const p = data.placements.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h && q.family !== "surface")
      ?? data.placements.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    if (p) return { placement: p };
    const e = elementAt(elements, x, y);
    return e ? { element: e } : null;
  }
  function drawTop() {
    const ctx = overlay.getContext("2d")!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const hv = hovered();
    drawOverlay(ctx, scale, {
      hover, drawn,
      hoverRect: hv?.placement ? rectOf(hv.placement) : hv?.element?.rect ?? null,
      selectedRect: selected ? rectOf(selected) : picked?.rect ?? null,
      blocked: (x, y) => !free[y * W + x],
    });
  }

  // --- infobulle
  function showTip(e: PointerEvent) {
    if (!hover) { tip.hidden = true; return; }
    const [x, y] = hover;
    const hv = hovered();
    let title: string, line: string, state: string, cls = "";
    if (hv?.placement) {
      const p = hv.placement;
      title = p.name ?? "Élément indisponible"; line = `${FAMILY_LABEL[p.family]} de l'atelier · ${p.w} × ${p.h}`;
      const issue = placementIssue(city, occ, p, others(p.id));
      state = issue ? `Ignoré par le jeu : ${issue}` : "Affiché dans le jeu"; cls = issue ? "bad" : "ok";
    } else if (hv?.element) {
      const el = hv.element;
      title = el.label; line = `${KIND_LABEL[el.kind]} · ${el.rect.x1 - el.rect.x0 + 1} × ${el.rect.y1 - el.rect.y0 + 1}`;
      if (removedKeys().has(el.key)) { state = "Retiré du jeu (cliquer pour le remettre)"; cls = "bad"; }
      else if (el.protected) { state = `Protégé : ${el.protected}`; cls = "warn"; }
      else { state = "Cliquer pour le retirer"; cls = ""; }
    } else {
      title = GROUND_LABEL[city.map[y][x]] ?? "Terrain";
      const issue = placementIssue(city, occ, { family: "prop", x, y, w: 1, h: 1 }, others());
      line = issue ?? "Libre : un élément peut être posé ici";
      state = ""; cls = issue ? "bad" : "ok";
    }
    fill(tip, h("strong", {}, title), h("span", { class: "muted" }, `Case ${x}, ${y}`), h("span", {}, line), state ? h("span", { class: `gmap-tip-state ${cls}` }, state) : null);
    tip.hidden = false;
    const b = stage.getBoundingClientRect();
    let left = e.clientX - b.left + 16, top = e.clientY - b.top + 16;
    if (e.clientX + 260 > window.innerWidth) left -= 270;
    tip.style.left = `${left}px`; tip.style.top = `${top}px`;
  }

  // --- souris : tracer (clic gauche), déplacer la vue (clic droit, molette ou Espace), zoomer (molette)
  const cellAt = (e: { clientX: number; clientY: number }): [number, number] | null => {
    const b = overlay.getBoundingClientRect();
    const x = Math.floor((e.clientX - b.left - RULER) / scale), y = Math.floor((e.clientY - b.top - RULER) / scale);
    return x >= 0 && y >= 0 && x < W && y < H ? [x, y] : null;
  };
  let start: [number, number] | null = null;
  let pan: { x: number; y: number; sl: number; st: number } | null = null;
  let space = false;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "Space" || (e.target as HTMLElement)?.closest?.("input, select, textarea, button")) return;
    space = e.type === "keydown"; if (space) e.preventDefault();
    overlay.style.cursor = space ? "grab" : "";
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  overlay.addEventListener("contextmenu", (e) => e.preventDefault());
  overlay.addEventListener("pointerdown", (e) => {
    overlay.setPointerCapture(e.pointerId);
    if (e.button !== 0 || space) { pan = { x: e.clientX, y: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop }; overlay.style.cursor = "grabbing"; return; }
    start = cellAt(e);
  });
  overlay.addEventListener("pointermove", (e) => {
    if (pan) { wrap.scrollLeft = pan.sl - (e.clientX - pan.x); wrap.scrollTop = pan.st - (e.clientY - pan.y); return; }
    const c = cellAt(e);
    hover = c;
    if (start && c) drawn = { x: Math.min(start[0], c[0]), y: Math.min(start[1], c[1]), w: Math.abs(c[0] - start[0]) + 1, h: Math.abs(c[1] - start[1]) + 1 };
    drawTop(); showTip(e);
  });
  overlay.addEventListener("pointerleave", () => { hover = null; tip.hidden = true; drawTop(); });
  overlay.addEventListener("pointerup", (e) => {
    if (pan) { pan = null; overlay.style.cursor = space ? "grab" : ""; return; }
    const c = cellAt(e);
    if (!start || !c) { start = null; return; }
    const click = c[0] === start[0] && c[1] === start[1];
    start = null;
    const hv = click ? hovered() : null;
    selected = hv?.placement ?? null;
    picked = !selected ? hv?.element ?? null : null;
    if (selected || picked) drawn = null;
    else if (click) drawn = { x: c[0], y: c[1], w: 1, h: 1 };
    drawTop(); renderPanel();
  });
  wrap.addEventListener("wheel", (e) => {
    e.preventDefault();
    const b = wrap.getBoundingClientRect();
    const mx = e.clientX - b.left, my = e.clientY - b.top;
    const cx = (wrap.scrollLeft + mx - RULER) / scale, cy = (wrap.scrollTop + my - RULER) / scale;
    const next = Math.max(4, Math.min(28, scale + (e.deltaY < 0 ? 2 : -2)));
    if (next === scale) return;
    scale = next; drawAll();
    wrap.scrollLeft = cx * scale + RULER - mx; wrap.scrollTop = cy * scale + RULER - my;
  }, { passive: false });

  // --- panneau : choisir l'élément à poser dans la zone tracée
  function candidate(a: Placeable, area: Rect) {
    if (a.family === "surface") return { family: a.family, x: area.x, y: area.y, w: Math.min(40, area.w), h: Math.min(40, area.h), facing };
    const fp = footprint(a, facing);
    if (fp.w > area.w || fp.h > area.h) return null;
    return { family: a.family, x: area.x + Math.floor((area.w - fp.w) / 2), y: area.y + Math.floor((area.h - fp.h) / 2), ...fp, facing };
  }

  const changed = () => { refresh(); drawAll(); renderPanel(); renderList(); };

  async function place(a: Placeable, c: any) {
    try {
      data = await api.addGamePlacement({ asset_id: a.id, x: c.x, y: c.y, facing, ...(a.family === "surface" ? { w: c.w, h: c.h } : {}) });
      toast(`« ${a.name} » placé sur la carte : visible dans le jeu au prochain chargement de la ville.`);
      drawn = null; selected = data.placements[data.placements.length - 1];
      changed();
    } catch (e) { toast((e as Error).message, "err"); }
  }

  async function toggleOriginal(e: CityElement) {
    const was = removedKeys().has(e.key);
    try {
      data = was ? await api.restoreOriginal(e.key) : await api.removeOriginal(e.key, e.label);
      toast(was ? `« ${e.label} » remis sur la carte du jeu.` : `« ${e.label} » retiré de la carte du jeu (visible au prochain chargement de la ville).`);
      changed();
    } catch (err) { toast((err as Error).message, "err"); }
  }

  async function remove(p: Placement) {
    try {
      data = await api.removeGamePlacement(p.id);
      toast("Élément retiré de la carte du jeu."); selected = null; changed();
    } catch (e) { toast((e as Error).message, "err"); }
  }

  const close = () => h("button", { class: "btn btn-small btn-quiet", onclick: () => { selected = null; picked = null; drawn = null; drawTop(); renderPanel(); } }, "Fermer");

  function renderPanel() {
    if (picked) {
      const e = picked;
      const gone = removedKeys().has(e.key);
      const size = `${e.rect.x1 - e.rect.x0 + 1} × ${e.rect.y1 - e.rect.y0 + 1}`;
      fill(panel, h("p", { class: "gmap-kicker" }, KIND_LABEL[e.kind]), h("h2", {}, e.label),
        h("p", { class: "muted" }, `Cases ${e.rect.x0}, ${e.rect.y0} · ${size}`),
        e.protected ? h("p", { class: "gmap-note warn" }, `Protégé : cet élément sert au jeu (${e.protected}). Il ne peut pas être retiré.`)
          : gone ? h("p", { class: "gmap-note bad" }, "Retiré de la ville du jeu.") : h("p", { class: "gmap-note ok" }, "Présent dans la ville du jeu."),
        editable && !e.protected ? h("button", { class: `btn btn-small${gone ? " btn-primary" : ""}`, onclick: () => toggleOriginal(e) }, gone ? "Remettre sur la carte" : "Retirer de la carte") : null,
        close());
      return;
    }
    if (selected) {
      const p = selected;
      const issue = placementIssue(city, occ, p, others(p.id));
      const def = assets.get(p.asset_id)?.definition;
      fill(panel, h("p", { class: "gmap-kicker" }, `${FAMILY_LABEL[p.family]} · atelier`), h("h2", {}, p.name ?? "Élément indisponible"),
        def ? thumbnail(def, p.family, 120) : null,
        h("p", { class: "muted" }, `Cases ${p.x}, ${p.y} · ${p.w} × ${p.h}${p.family === "building" ? ` · ${FACING_LABEL[p.facing]}` : ""}`),
        p.available === false ? h("p", { class: "gmap-note bad" }, "L'asset n'est plus publié : il n'apparaît plus dans le jeu.") : null,
        issue ? h("p", { class: "gmap-note bad" }, `Ignoré par le jeu : ${issue}`) : h("p", { class: "gmap-note ok" }, "Affiché dans le jeu."),
        editable ? h("button", { class: "btn btn-small", onclick: () => remove(p) }, "Retirer de la carte") : null,
        close());
      return;
    }
    if (!drawn) {
      fill(panel, h("h2", {}, "Placer ou retirer un élément"),
        h("ol", { class: "gmap-steps" },
          h("li", {}, h("strong", {}, "Tracez une zone"), " par cliquer-glisser : les cases libres s'affichent en vert, les cases occupées en rouge."),
          h("li", {}, h("strong", {}, "Choisissez l'orientation"), " et l'élément publié qui y tient, puis « Placer ici »."),
          h("li", {}, h("strong", {}, "Cliquez sur un élément"), " (de l'atelier ou d'origine) pour le voir ou le retirer.")),
        h("p", { class: "muted small" }, "Survolez la carte pour connaître chaque case. Molette : zoomer ; clic droit, clic molette ou Espace + glisser : déplacer la vue."),
        h("p", { class: "muted small" }, "Les éléments dont le jeu a besoin (commerces, livraisons, emploi, kiosque, parcelles, publicités) sont protégés."),
        editable ? null : h("p", { class: "gmap-note bad" }, "Lecture seule : la permission « Publier » est nécessaire pour modifier la carte."));
      return;
    }
    const area = drawn;
    let blocked = 0;
    for (let y = area.y; y < area.y + area.h; y++) for (let x = area.x; x < area.x + area.w; x++) if (!free[y * W + x]) blocked++;
    const facingSel = h("select", { "aria-label": "Orientation" }, Object.entries(FACING_LABEL).map(([k, l]) => h("option", { value: k, selected: k === facing }, l))) as HTMLSelectElement;
    facingSel.addEventListener("change", () => { facing = facingSel.value; renderPanel(); });
    const tabs = h("div", { class: "chips" }, Object.entries(FAMILY_LABEL).map(([k, l]) => h("button", {
      class: `chip${family === k ? " on" : ""}`, onclick: () => { family = k; renderPanel(); } }, l)));
    const items = data.assets.filter((a) => a.family === family).map((a) => {
      const c = candidate(a, area);
      const issue = c ? placementIssue(city, occ, c, others()) : `Trop grand pour la zone (${footprint(a, facing).w} × ${footprint(a, facing).h} cases).`;
      return { a, c, issue };
    }).sort((x, y) => Number(!!x.issue) - Number(!!y.issue));
    fill(panel, h("p", { class: "gmap-kicker" }, "Zone tracée"), h("h2", {}, `${area.w} × ${area.h} cases`),
      h("p", { class: "muted" }, `À partir de la case ${area.x}, ${area.y}`),
      blocked ? h("p", { class: "gmap-note bad" }, `${blocked} case(s) occupée(s) ou interdite(s) dans la zone (en rouge).`) : h("p", { class: "gmap-note ok" }, "Toute la zone est libre."),
      h("label", { class: "field" }, h("span", {}, "Orientation (façade, avant du véhicule)"), facingSel),
      tabs,
      items.length ? h("div", { class: "gmap-assets" }, items.map(({ a, c, issue }) => h("article", { class: `gmap-asset${issue ? " off" : ""}` },
        thumbnail(a.definition, a.family, 64),
        h("div", {}, h("strong", {}, a.name), h("div", { class: "meta" }, `${a.subcategory || a.technical_name} · ${a.family === "surface" ? `${c?.w} × ${c?.h} (zone tracée)` : `${a.w} × ${a.d} cases`}`),
          issue ? h("div", { class: "txt-danger small" }, issue) : null),
        editable && !issue ? h("button", { class: "btn btn-primary btn-small", onclick: () => place(a, c) }, "Placer ici") : null)))
        : h("p", { class: "muted" }, "Aucun élément publié dans cette famille."),
      h("button", { class: "btn btn-small btn-quiet", onclick: () => { drawn = null; drawTop(); renderPanel(); } }, "Effacer la zone"));
  }

  const focusOn = (r: { x0: number; y0: number; x1: number; y1: number }) => {
    wrap.scrollLeft = RULER + ((r.x0 + r.x1) / 2) * scale - wrap.clientWidth / 2;
    wrap.scrollTop = RULER + ((r.y0 + r.y1) / 2) * scale - wrap.clientHeight / 2;
    wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  function renderRemoved() {
    const byKey = new Map(elements.map((e) => [e.key, e]));
    fill(removedBox, data.removals.length ? data.removals.map((r) => {
      const e = byKey.get(r.key);
      return h("article", { class: "line gmap-line" },
        h("span", { class: "gmap-dot", style: { background: "#c0392b" } }),
        h("div", {}, h("strong", {}, e?.label ?? r.label ?? r.key), h("div", { class: "meta" }, e ? `${KIND_LABEL[e.kind]} · ${e.rect.x0}, ${e.rect.y0}` : "n'existe plus dans la ville du jeu")),
        e?.protected ? h("span", { class: "tag" }, "protégé : ignoré") : h("span", { class: "tag tag-ok" }, "retiré du jeu"),
        h("div", { class: "row" },
          e ? h("button", { class: "btn btn-small btn-quiet", onclick: () => { picked = e; selected = null; drawn = null; drawTop(); renderPanel(); focusOn(e.rect); } }, "Voir") : null,
          editable ? h("button", { class: "btn btn-small btn-quiet", onclick: () => (e ? toggleOriginal(e) : api.restoreOriginal(r.key).then((d) => { data = d; changed(); })) }, "Remettre") : null));
    }) : h("p", { class: "muted" }, "Aucun élément d'origine retiré."));
  }

  function renderList() {
    renderRemoved();
    fill(listBox, data.placements.length ? data.placements.map((p) => {
      const issue = placementIssue(city, occ, p, others(p.id));
      return h("article", { class: "line gmap-line" },
        h("span", { class: "gmap-dot", style: { background: FAMILY_COLOR[p.family] } }),
        h("div", {}, h("strong", {}, p.name ?? "Élément indisponible"), h("div", { class: "meta" }, `${FAMILY_LABEL[p.family]} · ${p.x}, ${p.y} · ${p.w} × ${p.h}`)),
        issue || p.available === false ? h("span", { class: "tag" }, issue ? "ignoré par le jeu" : "non publié") : h("span", { class: "tag tag-ok" }, "dans le jeu"),
        h("button", { class: "btn btn-small btn-quiet", onclick: () => { selected = p; picked = null; drawn = null; drawTop(); renderPanel(); focusOn(rectOf(p)); } }, "Voir"));
    }) : h("p", { class: "muted" }, "Aucun élément placé pour l'instant."));
  }

  // --- barre d'outils : zoom, calques
  const setScale = (s: number) => {
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2 - RULER) / scale, cy = (wrap.scrollTop + wrap.clientHeight / 2 - RULER) / scale;
    scale = Math.max(4, Math.min(28, s)); drawAll();
    wrap.scrollLeft = cx * scale + RULER - wrap.clientWidth / 2; wrap.scrollTop = cy * scale + RULER - wrap.clientHeight / 2;
  };
  // Centre-ville : là où sont les bâtiments, parcelles et mobilier (le lotissement, réservé, occupe le reste de la carte).
  const core = (() => {
    let x1 = 0, y1 = 0;
    for (const b of base.buildings) { x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    for (const p of base.plots) { x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
    for (const p of base.props) { x1 = Math.max(x1, p.tile[0]); y1 = Math.max(y1, p.tile[1]); }
    return { w: Math.min(W, x1 + 4), h: Math.min(H, y1 + 4) };
  })();
  const fitTo = (cw: number, ch: number) => {
    scale = Math.max(4, Math.min(28, Math.floor(Math.min((wrap.clientWidth - RULER - 4) / cw, (wrap.clientHeight - RULER - 4) / ch))));
    drawAll(); wrap.scrollLeft = 0; wrap.scrollTop = 0;
  };
  const fitCore = () => fitTo(core.w, core.h);
  const fitAll = () => fitTo(W, H);
  const toggle = (key: keyof MapLayers, label: string) => {
    const cb = h("input", { type: "checkbox", checked: layers[key] }) as HTMLInputElement;
    cb.addEventListener("change", () => {
      layers = { ...layers, [key]: cb.checked };
      try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)); } catch { /* préférence locale seulement */ }
      drawAll();
    });
    return h("label", { class: "toggle gmap-toggle" }, cb, label);
  };
  const toolbar = h("div", { class: "gmap-toolbar" },
    h("div", { class: "row" },
      h("button", { class: "btn btn-small", onclick: () => setScale(scale - 2), "aria-label": "Dézoomer" }, "−"),
      zoomLabel,
      h("button", { class: "btn btn-small", onclick: () => setScale(scale + 2), "aria-label": "Zoomer" }, "+"),
      h("button", { class: "btn btn-small btn-quiet", onclick: fitCore }, "Centre-ville"),
      h("button", { class: "btn btn-small btn-quiet", onclick: fitAll }, "Toute la carte")),
    h("div", { class: "row" }, toggle("labels", "Étiquettes"), toggle("grid", "Quadrillage"), toggle("free", "Zones libres")));
  const sw = (cls: string, label: string, style: Record<string, string> = {}) => h("span", { class: "gmap-key" }, h("span", { class: `gmap-sw ${cls}`, style }), label);
  const legend = h("div", { class: "gmap-legend" },
    sw("", "Route", { background: "#4d4d53" }), sw("", "Trottoir", { background: "#d9d4ca" }), sw("", "Place pavée", { background: "#cdbda4" }),
    sw("", "Herbe", { background: "#a7cc7a" }), sw("", "Terre battue", { background: "#dcc9a3" }),
    sw("dashed", "Parcelle des joueurs", { background: "#f3dfb3", borderColor: "#c98a2b" }), sw("hatch", "Lotissement (réservé)"),
    sw("roof", "Bâtiment (toit, façade, porte)"), sw("round", "Arbre, palmier, buisson", { background: "#2f6b2f" }),
    sw("round", "Mobilier (lampadaire, banc…)", { background: "#f7dc6f" }), sw("atelier", "Élément de l'atelier"),
    sw("removed", "Élément d'origine retiré"), sw("", "Zone libre (calque)", { background: "rgba(39,174,96,0.45)" }));

  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Carte du jeu"),
      h("p", { class: "muted" }, `La ville de Babiverse telle que les joueurs la voient (${W} × ${H} cases). Les éléments publiés posés ici apparaissent dans le jeu ; les éléments retirés en disparaissent.`)),
      h("a", { class: "btn btn-small btn-quiet", href: "#/jeu" }, "Intégration au jeu")),
    toolbar,
    h("div", { class: "gmap" }, wrap, panel),
    legend,
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Éléments placés"), listBox),
      h("section", { class: "panel" }, h("h2", {}, "Éléments d'origine retirés"), removedBox)));
  drawAll(); renderPanel(); renderList();
  // vue de départ : le centre-ville en entier
  requestAnimationFrame(() => { if (wrap.clientWidth) fitCore(); });
  return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); };
}
