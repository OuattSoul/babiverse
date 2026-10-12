// Sections d'édition réutilisées par l'éditeur, l'assistant de création et l'atelier d'assemblage.
import { api } from "../api";
import { footprintCells, DELTA, SIDES } from "../geometry";
import { mountGame, PreviewScene } from "../render/stage";
import type { AssetDefinition, AssetDetail, BehaviorRef, Side, Variant } from "../types";
import { can, ctx, field, fmtDate, h, modal, pill, row, slugify, toast, uniqueId, fill } from "../ui";
import { go } from "../router";
import { blockedReason, fulfil, interactionZones } from "../behaviors";

const SIDE_LABEL: Record<Side, string> = { N: "Nord", E: "Est", S: "Sud", W: "Ouest" };

const section = (title: string, id: string, ...body: (HTMLElement | null | HTMLElement[])[]) =>
  h("details", { class: "sec", open: true, id: `sec-${id}` }, h("summary", {}, title), h("div", { class: "sec-body" }, body.flat()));

// ------------------------------------------------------------------ comportements déclaratifs

export function behaviorsSection(def: AssetDefinition, family: string, onChange: (r: boolean) => void, disabled: boolean): HTMLElement | null {
  const reg = ctx.tax!.behaviors;
  const available = Object.entries(reg).filter(([, b]) => b.families.includes(family as any));
  if (!available.length) return null;
  def.behaviors ??= [];
  const list = h("div", { class: "table" }, def.behaviors.map((b: BehaviorRef, i: number) => {
    const spec = reg[b.id];
    const params = Object.entries(spec?.params ?? {}).map(([k, p]) => {
      const v = b.params[k] ?? p.default;
      // l'identifiant de zone se choisit parmi les zones d'interaction déclarées (jamais en texte libre)
      const input = k === "zone_id"
        ? h("select", { disabled, "aria-label": p.label }, h("option", { value: "", selected: !v }, "— choisir une zone —"),
            interactionZones(def).map((z) => h("option", { value: z.id, selected: z.id === v }, `${z.label || z.id} (${z.id})`))) as unknown as HTMLInputElement
        : p.type === "bool"
        ? h("input", { type: "checkbox", checked: !!v, disabled }) as HTMLInputElement
        : p.type === "choice" ? h("select", { disabled }, (p.options ?? []).map((o) => h("option", { value: o, selected: o === v }, o))) as unknown as HTMLInputElement
        : h("input", { type: p.type === "str" ? "text" : "number", value: v, min: p.min, max: p.max, disabled, class: p.type === "str" ? "" : "num" }) as HTMLInputElement;
      input.addEventListener("change", () => {
        b.params[k] = p.type === "bool" ? input.checked : p.type === "str" || p.type === "choice" ? input.value : Number(input.value);
        onChange(false);
      });
      return field(p.label, input);
    });
    return h("div", { class: "behavior" },
      h("div", { class: "trow" }, h("strong", {}, spec?.label ?? b.id),
        h("span", { class: `cap ${spec?.engine === "game" ? "cap-available" : "cap-experimental"}` }, spec?.engine === "game" ? "exploité par le jeu" : "atelier seulement"),
        h("button", { class: "icon-btn", disabled, "aria-label": "Retirer le comportement", onclick: () => { def.behaviors.splice(i, 1); onChange(true); } }, "×")),
      spec ? h("p", { class: "small muted" }, spec.description, spec.requires ? ` Prérequis : ${spec.requires}` : "") : null,
      params.length ? h("div", { class: "row" }, params) : null);
  }));
  const free = available.filter(([k]) => !def.behaviors.some((b) => b.id === k));
  const sel = h("select", { disabled: disabled || !free.length, "aria-label": "Comportement à ajouter" },
    free.map(([k, b]) => h("option", { value: k }, `${b.label}${b.engine === "game" ? "" : " (atelier seulement)"}${blockedReason(def, k) ? " — prérequis manquant" : ""}`))) as HTMLSelectElement;
  return section("Interactions et comportements", "behaviors",
    h("p", { class: "muted" }, "Choisissez parmi les comportements que le moteur connaît. Aucun code n'est saisi ici : une nouvelle mécanique demande d'abord une extension du moteur."),
    list,
    free.length ? row(sel, h("button", { class: "btn btn-small", disabled, onclick: () => {
      const id = sel.value; const spec = reg[id];
      const blocked = blockedReason(def, id);
      if (blocked) return toast(blocked, "err");
      const zones = def.zones.length;
      const params = fulfil(def, family, id, Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, p.default])));
      def.behaviors.push({ id, params });
      if (def.zones.length > zones) toast(`Zone d'interaction « ${params.zone_id} » créée devant l'entrée (modifiable dans « Entrées et zones »).`);
      onChange(true);
    } }, "Ajouter")) : h("p", { class: "small muted" }, "Tous les comportements compatibles sont déjà associés."),
    h("a", { href: "#/comportements", class: "small" }, "Voir le registre des comportements"));
}

// ------------------------------------------------------------------ variantes

export const VARIANT_PROPS: Record<string, { key: string; label: string; kind: "text" | "select" | "check"; options?: Record<string, string> }[]> = {
  building: [{ key: "sign_text", label: "Enseigne", kind: "text" }, { key: "roof", label: "Toiture", kind: "select", options: { flat: "Toit-terrasse", gable: "Deux pans", hip: "Quatre pans" } }],
  road: [{ key: "markings", label: "Marquage", kind: "select", options: { dashed: "Discontinu", solid: "Continu", double: "Double", none: "Aucun" } }],
  surface: [{ key: "pattern", label: "Motif", kind: "select", options: { plain: "Uni", stripes: "Rayures", checker: "Damier", dots: "Pointillés", waves: "Vagues" } }],
  vehicle: [{ key: "roof_sign", label: "Enseigne de toit", kind: "text" }, { key: "stripe", label: "Bande décorative", kind: "check" }],
};

export function variantsSection(def: AssetDefinition, family: string, onChange: (r: boolean) => void, disabled: boolean,
                                 onCompare?: (a: Variant | null, b: Variant | null) => void): HTMLElement | null {
  if (family === "interior" || family === "character_part" || family === "character" || family === "component") return null;
  const slots = ctx.tax!.material_slots[family] ?? [];
  const props = VARIANT_PROPS[family] ?? [];
  const def_ = h("select", { disabled, "aria-label": "Variante par défaut" }, h("option", { value: "" }, "Apparence de base"),
    def.variants.map((v) => h("option", { value: v.id, selected: def.default_variant === v.id }, v.name))) as HTMLSelectElement;
  def_.addEventListener("change", () => { def.default_variant = def_.value || null; onChange(false); });
  const cmpA = h("select", { "aria-label": "Comparer : première apparence" }, h("option", { value: "" }, "Apparence de base"), def.variants.map((v) => h("option", { value: v.id }, v.name))) as HTMLSelectElement;
  const cmpB = h("select", { "aria-label": "Comparer : seconde apparence" }, h("option", { value: "" }, "Apparence de base"), def.variants.map((v, i) => h("option", { value: v.id, selected: i === 0 }, v.name))) as HTMLSelectElement;
  return section("Variantes et thèmes", "variants",
    h("p", { class: "muted" }, "Une variante réutilise la géométrie et ne remplace que les paramètres cochés : aucun fichier n'est dupliqué."),
    def.variants.map((v, i) => h("div", { class: "variant" },
      h("div", { class: "trow" },
        (() => { const e = h("input", { value: v.name, disabled, "aria-label": "Nom de la variante" }) as HTMLInputElement; e.addEventListener("change", () => { v.name = e.value; onChange(true); }); return e; })(),
        h("code", {}, v.id),
        h("button", { class: "btn btn-small", disabled, onclick: () => { const c = structuredClone(v); c.id = uniqueId(def.variants, slugify(v.id)); c.name = `${v.name} (copie)`; def.variants.splice(i + 1, 0, c); onChange(true); } }, "Dupliquer"),
        h("button", { class: "icon-btn", disabled, "aria-label": "Supprimer la variante", onclick: () => { def.variants.splice(i, 1); if (def.default_variant === v.id) def.default_variant = null; onChange(true); } }, "×")),
      h("div", { class: "swatches" }, slots.map((s) => {
        const on = s in v.materials;
        const cb = h("input", { type: "checkbox", checked: on, disabled, "aria-label": `Modifier ${s}` }) as HTMLInputElement;
        const c = h("input", { type: "color", value: v.materials[s] ?? def.materials[s] ?? "#999999", disabled: disabled || !on }) as HTMLInputElement;
        cb.addEventListener("change", () => { if (cb.checked) v.materials[s] = c.value; else delete v.materials[s]; onChange(true); });
        c.addEventListener("input", () => { v.materials[s] = c.value; onChange(false); });
        return h("label", { class: "field" }, h("span", {}, ctx.tax!.slot_labels[s] ?? s), h("span", { class: "pair" }, cb, c));
      })),
      props.length ? h("div", { class: "row" }, props.map((pp) => {
        const cur = v.props[pp.key];
        let el: HTMLInputElement | HTMLSelectElement;
        if (pp.kind === "select") el = h("select", { disabled }, h("option", { value: "" }, "Identique"), Object.entries(pp.options!).map(([k, l]) => h("option", { value: k, selected: cur === k }, l))) as HTMLSelectElement;
        else if (pp.kind === "check") el = h("select", { disabled }, [["", "Identique"], ["1", "Oui"], ["0", "Non"]].map(([k, l]) => h("option", { value: k, selected: cur === undefined ? k === "" : (cur ? "1" : "0") === k }, l))) as HTMLSelectElement;
        else el = h("input", { value: cur ?? "", placeholder: "identique", disabled }) as HTMLInputElement;
        el.addEventListener("change", () => {
          const val = el.value;
          if (val === "") delete v.props[pp.key];
          else v.props[pp.key] = pp.kind === "check" ? val === "1" : val;
          onChange(false);
        });
        return field(pp.label, el);
      })) : null)),
    h("button", { class: "btn btn-small", disabled, onclick: () => { const id = uniqueId(def.variants, "variante"); def.variants.push({ id, name: `Variante ${def.variants.length + 1}`, materials: {}, props: {} }); onChange(true); } }, "Ajouter une variante"),
    def.variants.length ? row(field("Variante proposée par défaut", def_),
      onCompare ? h("div", { class: "field" }, h("span", {}, "Comparer deux apparences"), h("span", { class: "pair" }, cmpA, cmpB,
        h("button", { class: "btn btn-small", onclick: () => onCompare(def.variants.find((v) => v.id === cmpA.value) ?? null, def.variants.find((v) => v.id === cmpB.value) ?? null) }, "Comparer"))) : null) : null);
}

export function compareVariants(family: string, def: AssetDefinition, a: Variant | null, b: Variant | null) {
  const mk = (variant: Variant | null) => {
    const host = h("div", { class: "stage stage-compare" });
    return { host, variant };
  };
  const left = mk(a), right = mk(b);
  const games: any[] = [];
  const close = modal("Comparer deux apparences", h("div", { class: "compare" },
    h("div", {}, h("h3", {}, a?.name ?? "Apparence de base"), left.host), h("div", {}, h("h3", {}, b?.name ?? "Apparence de base"), right.host)), [], { wide: true, cancel: "Fermer" });
  for (const side of [left, right]) {
    const sc = new PreviewScene();
    sc.state = { family, def, rotation: 0, variant: side.variant, furniture: ctx.tax!.furniture,
      flags: { grid: false, footprint: false, collision: false, entrances: false, connectors: false, zones: false, dims: false } };
    games.push(mountGame(side.host, sc));
  }
  const obs = new MutationObserver(() => { if (!document.body.contains(left.host)) { games.forEach((g) => g.destroy(true)); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
  void close;
}

// ------------------------------------------------------------------ façade modulaire (assemblage)

export function outerFaces(def: AssetDefinition): { cell: [number, number]; side: Side }[] {
  const cells = footprintCells(def.footprint);
  const set = new Set(cells.map((c) => c.join(",")));
  const out: { cell: [number, number]; side: Side }[] = [];
  for (const side of ["S", "E", "N", "W"] as Side[]) for (const [x, y] of cells) {
    const [dx, dy] = DELTA[side];
    if (!set.has(`${x + dx},${y + dy}`)) out.push({ cell: [x, y], side });
  }
  return out;
}

export function facadeSection(def: AssetDefinition, onChange: (r: boolean) => void, disabled: boolean): HTMLElement {
  const p = def.properties;
  p.facade ??= [];
  const floors = Math.max(1, p.floors || 1);
  const mods = ctx.tax!.facade_modules;
  const get = (c: number[], side: Side, f: number) => p.facade.find((s: any) => s.cell[0] === c[0] && s.cell[1] === c[1] && s.side === side && s.floor === f)?.module ?? "auto";
  const set = (c: [number, number], side: Side, f: number, m: string) => {
    p.facade = p.facade.filter((s: any) => !(s.cell[0] === c[0] && s.cell[1] === c[1] && s.side === side && s.floor === f));
    if (m !== "auto") p.facade.push({ cell: [...c], side, floor: f, module: m });
    onChange(true);
  };
  const faces = outerFaces(def);
  const entrances = new Map(def.entrances.map((e) => [`${e.cell[0]},${e.cell[1]},${e.side}`, e]));
  const table = h("div", { class: "facade-grid", style: { gridTemplateColumns: `minmax(120px, 1.2fr) repeat(${floors}, minmax(110px, 1fr))` } },
    h("span", { class: "thead" }, "Façade"),
    Array.from({ length: floors }, (_, f) => h("span", { class: "thead" }, f === 0 ? "Rez-de-chaussée" : `Étage ${f}`)),
    faces.flatMap(({ cell, side }) => {
      const ent = entrances.get(`${cell[0]},${cell[1]},${side}`);
      return [
        h("span", { class: "small" }, `${SIDE_LABEL[side]} · case ${cell[0] + 1},${cell[1] + 1}`, ent ? h("span", { class: "tag tag-ok" }, `entrée ${ent.id}`) : null),
        ...Array.from({ length: floors }, (_, f) => {
          const s = h("select", { disabled, "aria-label": `Module ${SIDE_LABEL[side]} ${cell.join(",")} niveau ${f}` },
            Object.entries(mods).filter(([, m]) => m.floors === "any" || (m.floors === "ground" ? f === 0 : f > 0))
              .map(([k, m]) => h("option", { value: k, selected: get(cell, side, f) === k }, m.label))) as HTMLSelectElement;
          s.addEventListener("change", () => set(cell, side, f, s.value));
          return s;
        }),
      ];
    }));
  return section("Façade modulaire (assemblage)", "facade",
    h("p", { class: "muted" }, "Assemblez la façade module par module. « Automatique » suit le style du bâtiment. Seuls les modules compatibles avec chaque niveau sont proposés ; le serveur revérifie tout (porte sans entrée, entrée masquée…)."),
    h("p", { class: "small muted" }, "La vue isométrique montre les façades Sud et Est : pivotez l'aperçu à 180° pour voir le Nord et l'Ouest."),
    table,
    p.facade.length ? h("button", { class: "btn btn-small btn-quiet", disabled, onclick: () => { p.facade = []; onChange(true); } }, "Tout remettre en automatique") : null);
}

// ------------------------------------------------------------------ versions, historique, utilisation

export function historyPanel(asset: AssetDetail, onReverted: (a: AssetDetail) => void): HTMLElement {
  const versions = [...asset.versions].reverse();
  const a = h("select", { "aria-label": "Version de départ" }, versions.map((v, i) => h("option", { value: v.version, selected: i === 1 }, `v${v.version}`))) as HTMLSelectElement;
  const b = h("select", { "aria-label": "Version d'arrivée" }, versions.map((v, i) => h("option", { value: v.version, selected: i === 0 }, `v${v.version}`))) as HTMLSelectElement;
  const out = h("div", { class: "diff" });
  const latest = asset.versions[asset.versions.length - 1];
  return h("div", { class: "panel" }, h("h2", {}, "Versions"),
    h("ol", { class: "versions", reversed: true }, versions.map((v) => h("li", {},
      h("strong", {}, `v${v.version}`), " ", pill(v.status), ` ${fmtDate(v.updated_at)} · ${v.created_by}`,
      v.note ? h("span", { class: "muted" }, ` — ${v.note}`) : null,
      v.instances ? h("span", { class: "muted" }, ` · ${v.instances} instance(s)`) : null,
      v.pins && (Object.keys(v.pins.assets).length || Object.keys(v.pins.media).length) ? h("span", { class: "tag", title: "Dépendances figées à la publication" }, "dépendances figées") : null,
      can("asset.edit") && can("asset.publish") && v.version !== latest.version && latest.status !== "in_review" && !asset.archived
        ? h("button", { class: "btn btn-small", onclick: async () => {
          try { const r = await api.revert(asset.id, v.version); toast(`La v${v.version} devient le brouillon v${r.latest_version}`); onReverted(r); }
          catch (e) { toast((e as Error).message, "err"); }
        } }, "Revenir à cette version") : null))),
    asset.versions.length > 1 ? h("div", { class: "diff-tools" }, h("span", { class: "pair" }, "Comparer", a, "et", b,
      h("button", { class: "btn btn-small", onclick: async () => {
        const d = await api.diff(asset.id, Number(a.value), Number(b.value));
        fill(out, d.changes.length ? h("table", { class: "diff-table" }, h("tr", {}, h("th", {}, "Champ"), h("th", {}, `v${a.value}`), h("th", {}, `v${b.value}`)),
          d.changes.slice(0, 80).map((c) => h("tr", { class: `diff-${c.kind}` }, h("td", {}, h("code", {}, c.path)), h("td", {}, fmt(c.before)), h("td", {}, fmt(c.after)))))
          : h("p", { class: "muted" }, "Aucune différence."));
      } }, "Voir les différences")), out) : null);
}
const fmt = (v: any) => (v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function usagePanel(asset: AssetDetail): HTMLElement {
  const u = asset.usage;
  return h("div", { class: "panel" }, h("h2", {}, "Utilisation"),
    u.instances.length ? h("ul", { class: "list" }, u.instances.map((i) => h("li", {}, `${i.n} instance(s) de la v${i.version} dans `,
      h("a", { href: `#/carte?scene=${i.scene_id}` }, i.scene_name ?? i.scene_id)))) : h("p", { class: "muted" }, "Placé dans aucune scène de test."),
    u.referenced_by.length ? h("div", {}, h("h3", {}, "Utilisé par"), h("ul", { class: "list" }, u.referenced_by.map((r) =>
      h("li", {}, h("a", { href: `#/asset/${r.asset_id}` }, r.name), ` (v${r.version}, `, pill(r.status), ")")))) : h("p", { class: "muted small" }, "Aucun autre asset ne le référence."));
}

export function openAsset(id: string, family: string, preview?: AssetDefinition) {
  if (family === "character") go(`#/personnages/${id}`);
  else if (family === "character_part") go(`#/composants/${id}`);
  else if (family === "component" && preview?.properties?.kit) go(`#/modulaire/${preview.properties.kit}/composants/${id}`);
  else if (preview?.representation === "modular" && preview.properties?.modular?.kit) go(`#/modulaire/${preview.properties.modular.kit}/${id}`);
  else go(`#/asset/${id}`);
}

export { SIDE_LABEL, SIDES };
