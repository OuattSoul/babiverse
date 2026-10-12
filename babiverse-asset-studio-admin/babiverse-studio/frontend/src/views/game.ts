// Intégration au jeu : ce que les joueurs voient de l'atelier (atelier = admin, jeu = joueurs).
// Intérieur de la maison du joueur, habitant qui remplace chaque PNJ, garde-robe de création, publication des habitants.
import { api } from "../api";
import { svgImage } from "../character/svgimg";
import { can, characterSvg, fill, h, pill, toast } from "../ui";

const MOBILITY_NOTE = "Le PNJ garde son rôle, ses dialogues, sa place et sa mobilité (immobile ou flâneur) : seule son apparence change.";

export async function gameView(root: HTMLElement) {
  const [s, chars] = await Promise.all([api.gameSettings(), api.catalog("character")]);
  const defs = new Map(chars.map((c: any) => [c.asset_id, c.definition]));
  const editable = can("asset.publish");
  const portrait = (id: string | null, size = 52) => {
    const d = id ? defs.get(id) : null;
    return d ? svgImage(characterSvg(d.properties, null, { crop: "portrait", background: "#eef3f1", width: size }), d.name) : h("span", { class: "game-portrait-empty" }, "jeu");
  };
  const published = s.characters.filter((c: any) => c.published_version);
  const nameOf = (id: string | null) => s.characters.find((c: any) => c.id === id)?.name ?? "";

  async function save(body: any, msg: string) {
    try { await api.saveGameSettings(body); toast(msg); await gameView(root); } catch (e) { toast((e as Error).message, "err"); }
  }

  // --- maison du joueur
  const home = h("select", { disabled: !editable, "aria-label": "Intérieur de la maison du joueur" },
    h("option", { value: "" }, "Studio d'origine du jeu"),
    s.interiors.map((i: any) => h("option", { value: i.id, selected: i.id === s.home_interior, disabled: !i.published_version },
      `${i.name}${i.subcategory ? ` · ${i.subcategory}` : ""}${i.published_version ? "" : " (non publié)"}`))) as HTMLSelectElement;
  home.addEventListener("change", () => save({ home_interior: home.value }, home.value ? "Maison du joueur : nouvel intérieur enregistré." : "Maison du joueur : studio d'origine."));

  // --- PNJ
  const npcRows = s.game_npcs.map((n: any) => {
    const cur = s.npcs[n.id] ?? "";
    const sel = h("select", { disabled: !editable, "aria-label": `Habitant pour ${n.name}` },
      h("option", { value: "" }, `Automatique${cur === "" && s.resolved[n.id] ? ` (${nameOf(s.resolved[n.id])})` : ""}`),
      h("option", { value: "keep", selected: cur === "keep" }, "Garder l'apparence du jeu"),
      published.map((c: any) => h("option", { value: c.id, selected: c.id === cur }, c.name))) as HTMLSelectElement;
    sel.addEventListener("change", () => save({ npcs: { ...s.npcs, [n.id]: sel.value } }, `${n.name} : habitant enregistré.`));
    return h("article", { class: "line game-npc" }, portrait(s.resolved[n.id]),
      h("div", {}, h("strong", {}, n.name), h("div", { class: "meta" }, `${n.role} · ${n.mobility}`)), sel);
  });

  // --- habitants en plus
  const extras = h("input", { type: "checkbox", checked: s.extra_inhabitants, disabled: !editable }) as HTMLInputElement;
  extras.addEventListener("change", () => save({ extra_inhabitants: extras.checked }, extras.checked ? "Les autres habitants se promènent en ville." : "Seuls les PNJ apparaissent en ville."));

  // --- habitants non publiés
  const drafts = s.characters.filter((c: any) => ["draft", "in_review", "validated"].includes(c.status));
  const publishBtn = can("asset.validate") && can("asset.publish") && drafts.length ? h("button", { class: "btn btn-primary btn-small", onclick: async () => {
    publishBtn!.disabled = true; publishBtn!.textContent = "Publication…";
    try {
      const r = await api.publishInhabitants();
      toast(`${r.published.length} habitant(s) publié(s)${r.failed.length ? `, ${r.failed.length} refusé(s) : ${r.failed.map((f) => `${f.technical_name} (${f.error})`).join(" ; ")}` : ""}.`, r.failed.length ? "err" : "ok");
      await gameView(root);
    } catch (e) { toast((e as Error).message, "err"); publishBtn!.disabled = false; }
  } }, `Publier les ${drafts.length} habitant(s) non publié(s)`) : null;

  const download = can("asset.export") ? h("button", { class: "btn btn-small", onclick: async () => {
    try {
      const pack = await api.gamePack();
      const a = h("a", { href: URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: "application/json" })), download: "game-pack.json" });
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast((e as Error).message, "err"); }
  } }, "Télécharger le pack (game-pack.json)") : null;

  const w = s.wardrobe;
  fill(root,
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Intégration au jeu"),
      h("p", { class: "muted" }, "Ce que les joueurs de Babiverse reçoivent de l'atelier. Seuls les éléments publiés passent dans le jeu ; "
        + "le jeu relit le pack quelques secondes après chaque modification (ou à la synchronisation, en production)."),
      h("p", { class: "muted small" }, `Révision du pack : ${s.revision}`)),
      h("div", { class: "row" }, h("a", { class: "btn btn-small btn-primary", href: "#/jeu/carte" }, "Carte du jeu : placer des éléments"), download)),
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Création du personnage"),
        h("p", {}, "Chaque nouveau joueur choisit sa silhouette, sa peau, sa coiffure, son haut, son bas et ses chaussures parmi les composants publiés."),
        h("ul", { class: "list" },
          h("li", {}, `${w.body} silhouette(s), ${w.hair} coiffure(s), ${w.top} haut(s), ${w.bottom} bas, ${w.shoes} paire(s) de chaussures`)),
        w.body && w.top && w.bottom ? null : h("p", { class: "txt-danger" }, "Garde-robe incomplète : le jeu garde son écran de création d'origine tant qu'il manque une silhouette, un haut ou un bas publié."),
        h("p", { class: "muted small" }, h("a", { href: "#/composants" }, "Gérer les composants de personnage"))),
      h("section", { class: "panel" }, h("h2", {}, "Maison du joueur (« Chez moi »)"),
        h("p", {}, "Intérieur ouvert par la maison de chaque joueur dans le lotissement. Le lit sert à la sieste ; la porte d'entrée ramène dans la ville."),
        home,
        s.home ? h("p", { class: "muted small" }, `Dans le jeu : ${s.home.name}`) : h("p", { class: "muted small" }, "Dans le jeu : studio dessiné à la main."),
        s.home_interior && !s.home ? h("p", { class: "txt-danger" }, "L'intérieur choisi n'est plus publié : le jeu reprend le studio d'origine.") : null),
      h("section", { class: "panel" }, h("h2", {}, "Habitants publiés"),
        h("p", {}, `${published.length} habitant(s) publié(s) · ${drafts.length} non publié(s).`),
        drafts.length ? h("p", { class: "muted small" }, "Un habitant généré reste un brouillon tant qu'il n'est pas publié : il n'apparaît pas dans le jeu.") : null,
        publishBtn,
        h("label", { class: "toggle" }, extras, "Les habitants sans PNJ se promènent aussi dans la ville"),
        s.extras.length ? h("div", { class: "game-crowd" }, s.extras.slice(0, 24).map((id: string) => portrait(id, 40))) : null)),
    h("section", { class: "panel" }, h("h2", {}, "Habitants des PNJ"), h("p", { class: "muted" }, MOBILITY_NOTE),
      h("p", { class: "muted small" }, "Automatique : les habitants publiés les plus récemment ajoutés remplacent les PNJ en priorité (même silhouette si possible)."),
      h("div", { class: "rows" }, npcRows)),
    drafts.length ? h("section", { class: "panel" }, h("h2", {}, "Habitants non publiés"),
      h("div", { class: "rows" }, drafts.slice(0, 60).map((c: any) => h("article", { class: "line game-npc" }, h("span", {}),
        h("div", {}, h("a", { href: `#/personnages/${c.id}` }, c.name), h("div", { class: "meta" }, c.technical_name)), pill(c.status))))) : null);
}
