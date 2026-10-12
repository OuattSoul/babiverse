import { api, download, setToken } from "../api";
import type { AssetSummary, Category, Family } from "../types";
import { can, capBadge, CAP_NAMES, confirmDialog, ctx, emptyState, famLabel, field, fmtDate, fmtSize, h, modal, pill, row, slugify, toast, fill } from "../ui";

// ------------------------------------------------------------------ import et export

const DECISION_LABEL: Record<string, string> = { create: "Créer (identifiant conservé)", skip: "Ignorer", copy: "Importer comme copie", new_version: "Ajouter une nouvelle version" };
const STATUS_LABEL: Record<string, string> = { new: "Nouveau", identical: "Déjà présent à l'identique", conflict_id: "Conflit : contenu différent", conflict_name: "Conflit : nom technique pris", invalid: "Invalide" };

export async function transferView(root: HTMLElement) {
  const assets = await api.assets();
  const scenes = await api.scenes();
  const chosen = new Set<string>();
  const sceneSet = new Set<string>();
  const q = h("input", { type: "search", placeholder: "Filtrer…", "aria-label": "Filtrer les assets" }) as HTMLInputElement;
  const deps = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const vers = h("select", { "aria-label": "Versions" }, [["all", "Toutes les versions"], ["published", "Version publiée"], ["latest", "Dernière version"]].map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const list = h("div", { class: "pick-list" });
  const drawList = () => fill(list, ...assets.filter((a) => !q.value || a.name.toLowerCase().includes(q.value.toLowerCase()) || a.technical_name.includes(q.value.toLowerCase()))
    .map((a: AssetSummary) => {
      const c = h("input", { type: "checkbox", checked: chosen.has(a.id) }) as HTMLInputElement;
      c.addEventListener("change", () => { if (c.checked) chosen.add(a.id); else chosen.delete(a.id); });
      return h("label", { class: "toggle pick" }, c, a.name, h("span", { class: "small muted" }, ` ${famLabel(a.family)} · v${a.latest_version}`), pill(a.status));
    }));
  q.addEventListener("input", drawList);
  const runExport = async (all: boolean) => {
    if (!all && !chosen.size && !sceneSet.size) return toast("Choisissez au moins un asset ou une scène.", "err");
    try {
      const r = await api.exportBundle({ asset_ids: [...chosen], all_assets: all, include_dependencies: deps.checked, versions: vers.value, scene_ids: [...sceneSet] });
      download(r.blob, r.filename);
      toast(`Export : ${r.assets} asset(s), ${r.media} fichier(s)`);
    } catch (e) { toast((e as Error).message, "err"); }
  };
  const file = h("input", { type: "file", accept: ".zip,application/zip", "aria-label": "Lot à importer" }) as HTMLInputElement;
  const preview = h("div", {});
  const history = h("div", {});
  file.addEventListener("change", async () => {
    const f = file.files?.[0]; if (!f) return;
    fill(preview, h("p", { class: "loading" }, "Analyse du lot…"));
    try { showPreview(await api.importPreview(f, f.name)); } catch (e) { fill(preview, h("p", { class: "txt-danger" }, (e as Error).message)); }
    file.value = "";
  });
  function showPreview(p: any) {
    const decisions: Record<string, string> = {};
    const scenesBox = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
    fill(preview, h("div", { class: "panel" }, h("h2", {}, "Aperçu avant import"),
      h("p", { class: "meta" }, `Format ${p.manifest.format} v${p.manifest.format_version} · exporté par ${p.manifest.exported_by} le ${fmtDate(p.manifest.exported_at)}`),
      h("p", {}, Object.entries(p.summary).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS_LABEL[k].toLowerCase()}`).join(" · ")),
      p.new_categories.length ? h("p", { class: "small" }, `Catégories créées : ${p.new_categories.map((c: any) => c.label).join(", ")}`) : null,
      h("table", { class: "import-table" }, h("tr", {}, h("th", {}, "Asset"), h("th", {}, "Famille"), h("th", {}, "État"), h("th", {}, "Décision")),
        p.assets.map((a: any) => {
          const sel = h("select", { "aria-label": `Décision pour ${a.technical_name}` }, a.options.map((o: string) => h("option", { value: o, selected: o === a.default }, DECISION_LABEL[o]))) as HTMLSelectElement;
          sel.addEventListener("change", () => { decisions[a.asset_id] = sel.value; });
          return h("tr", { class: `imp-${a.status}` }, h("td", {}, a.name ?? a.technical_name, h("br"), h("code", {}, a.technical_name)), h("td", {}, famLabel(a.family)),
            h("td", {}, STATUS_LABEL[a.status], a.message ? h("div", { class: "small muted" }, a.message) : null), h("td", {}, sel));
        })),
      p.media.length ? h("details", {}, h("summary", {}, `${p.media.length} fichier(s)`), h("ul", { class: "list" }, p.media.map((m: any) => h("li", {}, `${m.name} — ${m.status}${m.message ? ` (${m.message})` : ""}`)))) : null,
      p.scenes.length ? h("label", { class: "toggle" }, scenesBox, `Importer ${p.scenes.length} scène(s) de test (créées sous un nouvel identifiant)`) : null,
      h("p", { class: "small muted" }, "Rien n'est écrasé : un conflit s'ignore, s'importe en copie (références internes renommées) ou s'ajoute comme nouvelle version brouillon."),
      h("div", { class: "row" }, h("button", { class: "btn btn-primary", onclick: async () => {
        try {
          const r = await api.importApply(p.id, decisions, scenesBox.checked);
          const res = r.result;
          fill(preview, h("div", { class: "panel" }, h("h2", {}, "Rapport d'import"),
            h("ul", { class: "list" },
              h("li", {}, `${res.created_assets.length} asset(s) créé(s), ${res.copied_assets.length} copie(s), ${res.new_versions.length} nouvelle(s) version(s), ${res.skipped.length} ignoré(s)`),
              h("li", {}, `${res.created_media.length} fichier(s) ajouté(s), ${res.reused_media.length} réutilisé(s) (même empreinte)`),
              h("li", {}, `${res.created_scenes.length} scène(s), ${res.instances} instance(s)`)),
            res.errors.length ? h("ul", { class: "report" }, res.errors.map((e: string) => h("li", { class: "rep-error" }, e))) : null,
            res.warnings.length ? h("ul", { class: "report" }, res.warnings.map((e: string) => h("li", { class: "rep-warning" }, e))) : null,
            h("button", { class: "btn btn-quiet", onclick: () => rollback(p.id) }, "Annuler cet import")));
          toast("Import appliqué"); loadHistory();
        } catch (e) { toast((e as Error).message, "err"); }
      } }, "Appliquer l'import"))));
  }
  async function rollback(id: string) {
    if (!(await confirmDialog("Annuler l'import", "Supprimer tout ce que cet import a créé ? Impossible si ces éléments ont été réutilisés depuis.", "Annuler l'import", true))) return;
    try { await api.importRollback(id); toast("Import annulé"); loadHistory(); } catch (e) { toast((e as Error).message, "err"); }
  }
  async function loadHistory() {
    if (!can("asset.import")) return;
    const rows = await api.imports();
    fill(history, rows.length ? h("ul", { class: "list" }, rows.map((r) => h("li", {}, `${fmtDate(r.created_at)} · ${r.filename} · ${r.created_by} · `, h("strong", {}, { pending: "analysé", applied: "appliqué", rolled_back: "annulé" }[r.status as string] ?? r.status),
      r.status === "applied" ? h("button", { class: "btn btn-small btn-quiet", onclick: () => rollback(r.id) }, "Annuler") : null))) : h("p", { class: "muted" }, "Aucun import."));
  }
  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Importation et exportation"),
      h("p", { class: "lede" }, "Lots au format « babiverse-studio-bundle » v1 : manifeste versionné, identifiants stables, dépendances et fichiers inclus. Un export se réimporte sans perte de références."))),
    can("asset.export") ? h("section", { class: "panel" }, h("h2", {}, "Exporter"),
      row(field("Versions", vers), h("label", { class: "toggle" }, deps, "Inclure les dépendances (intérieurs, composants, meubles, fichiers)")),
      h("div", { class: "row" }, h("span", { class: "small" }, "Scènes de test :"), scenes.map((s) => {
        const c = h("input", { type: "checkbox" }) as HTMLInputElement;
        c.addEventListener("change", () => { if (c.checked) sceneSet.add(s.id); else sceneSet.delete(s.id); });
        return h("label", { class: "toggle" }, c, `${s.name} (${s.instances})`);
      })),
      q, list,
      h("div", { class: "row" }, h("button", { class: "btn btn-primary", onclick: () => runExport(false) }, "Exporter la sélection"), h("button", { class: "btn", onclick: () => runExport(true) }, "Exporter tout le catalogue"))) : null,
    can("asset.import") ? h("section", { class: "panel" }, h("h2", {}, "Importer un lot"), field("Archive .zip", file, `${ctx.tax!.limits.import_mb} Mo maximum ; chaque fichier est revérifié (empreinte, type, assainissement SVG).`), preview,
      h("h3", {}, "Imports précédents"), history) : h("p", { class: "muted" }, "L'import de lots est réservé aux publieurs et administrateurs."),
    can("asset.export") ? h("section", { class: "panel" }, h("h2", {}, "Intégration avec le jeu"),
      h("p", {}, "Deux sorties pour le moteur de Babiverse (voir docs/INTEGRATION.md). Rien n'est synchronisé automatiquement avec le jeu de production."),
      h("ul", { class: "list" },
        h("li", {}, h("strong", {}, "Catalogue d'exécution"), " — versions publiées et dépendances figées, format cible d'un futur chargeur. ",
          h("button", { class: "btn btn-small", onclick: async () => download(new Blob([JSON.stringify(await api.runtimeCatalog(), null, 1)], { type: "application/json" }), "babiverse-runtime-catalog.json") }, "Télécharger")),
        h("li", {}, h("strong", {}, "Adaptateur du jeu actuel (Three.js)"), " — apparences {skin, outfit, hair} et gabarits de bâtiments 2 × 2, avec la liste de ce qui est perdu. ",
          h("button", { class: "btn btn-small", onclick: async () => {
            const a = await api.gameAdapter();
            download(new Blob([JSON.stringify(a, null, 1)], { type: "application/json" }), "babiverse-game-adapter.json");
            modal("Adaptateur du jeu actuel", h("div", {}, h("p", {}, `${a.characters.length} personnage(s), ${a.building_templates.filter((b: any) => b.compatible).length}/${a.building_templates.length} bâtiment(s) convertibles.`),
              h("p", { class: "small muted" }, `Familles non prises en charge par le jeu : ${a.unsupported_families.map(famLabel).join(", ") || "aucune"}.`)), [], { cancel: "Fermer" });
          } }, "Télécharger")))) : null);
  drawList(); loadHistory();
}

// ------------------------------------------------------------------ utilisateurs et permissions

export async function usersView(root: HTMLElement) {
  const roles = ctx.tax!.roles;
  const perms = ctx.tax!.permissions;
  const matrix = h("table", { class: "perm-table" }, h("tr", {}, h("th", {}, "Permission"), Object.values(roles).map((r) => h("th", {}, r.label))),
    Object.entries(perms).map(([p, label]) => h("tr", {}, h("td", {}, label, h("br"), h("code", {}, p)), Object.values(roles).map((r) => h("td", { class: "c" }, r.permissions.includes(p) ? "✓" : "")))));
  const list = h("div", {});
  async function load() {
    const users = await api.users();
    fill(list, h("div", { class: "rows" }, users.map((u) => {
      const role = h("select", { "aria-label": `Rôle de ${u.username}` }, Object.entries(roles).map(([k, r]) => h("option", { value: k, selected: k === u.role }, r.label))) as HTMLSelectElement;
      role.addEventListener("change", async () => { try { await api.updateUser(u.id, { role: role.value }); toast("Rôle modifié"); } catch (e) { toast((e as Error).message, "err"); load(); } });
      return h("article", { class: "line" }, h("strong", {}, u.username), role, h("span", { class: "meta" }, `${u.sessions} session(s) · créé ${u.created_at ? fmtDate(u.created_at) : "—"}`),
        h("span", {}, u.active ? h("span", { class: "tag tag-ok" }, "actif") : h("span", { class: "tag tag-err" }, "désactivé")),
        h("div", { class: "card-actions" },
          h("button", { class: "btn btn-small", onclick: () => resetPw(u) }, "Nouveau mot de passe"),
          h("button", { class: "btn btn-small btn-quiet", onclick: async () => { try { await api.updateUser(u.id, { active: !u.active }); toast(u.active ? "Compte désactivé : sessions fermées" : "Compte réactivé"); load(); } catch (e) { toast((e as Error).message, "err"); } } }, u.active ? "Désactiver" : "Réactiver")));
    })));
  }
  function resetPw(u: any) {
    const pw = h("input", { type: "password", autocomplete: "new-password" }) as HTMLInputElement;
    const close = modal(`Mot de passe de ${u.username}`, h("div", { class: "fields" }, field("Nouveau mot de passe", pw, "10 caractères minimum, majuscules, minuscules et chiffres. Les sessions de l'utilisateur sont fermées.")), [
      { label: "Enregistrer", run: async () => { try { await api.updateUser(u.id, { password: pw.value }); close(); toast("Mot de passe changé"); } catch (e) { toast((e as Error).message, "err"); } } }]);
  }
  const name = h("input", { autocomplete: "off", "aria-label": "Identifiant" }) as HTMLInputElement;
  const pw = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Mot de passe" }) as HTMLInputElement;
  const role = h("select", { "aria-label": "Rôle" }, Object.entries(roles).map(([k, r]) => h("option", { value: k, selected: k === "editor" }, r.label))) as HTMLSelectElement;
  fill(root, h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Utilisateurs et permissions"),
    h("p", { class: "lede" }, "Les permissions sont vérifiées par le serveur sur chaque opération ; masquer un bouton n'est jamais une protection."))),
    h("section", { class: "panel" }, h("h2", {}, "Ajouter un utilisateur"), row(field("Identifiant", name), field("Mot de passe", pw), field("Rôle", role),
      h("button", { class: "btn btn-primary", onclick: async () => {
        try { await api.createUser({ username: name.value, password: pw.value, role: role.value }); toast("Utilisateur créé"); name.value = ""; pw.value = ""; load(); } catch (e) { toast((e as Error).message, "err"); }
      } }, "Créer"))),
    list, h("section", { class: "panel" }, h("h2", {}, "Rôles et permissions"), h("div", { class: "scroll-x" }, matrix)));
  await load();
}

// ------------------------------------------------------------------ paramètres du projet

export async function settingsView(root: HTMLElement) {
  const sys = can("admin.settings") ? await api.system().catch(() => null) : null;
  const cats = h("div", {});
  const drawCats = () => fill(cats, h("div", { class: "rows" }, ctx.tax!.categories.map((c: Category) => h("article", { class: "line" },
    h("div", {}, h("strong", {}, c.label), h("div", { class: "meta" }, h("code", {}, c.key), ` · ${famLabel(c.family)}${c.builtin ? "" : " · créée dans l'atelier"}`)),
    h("div", { class: "meta" }, `${c.subcategories.length} sous-catégorie(s)`, c.rules.length ? ` · règles : ${c.rules.map((r) => ctx.tax!.category_rules[r] ?? r).join(" ; ")}` : ""),
    c.archived ? h("span", { class: "tag tag-err" }, "archivée") : h("span", {}),
    can("admin.settings") ? h("div", { class: "card-actions" }, h("button", { class: "btn btn-small", onclick: () => editCategory(c) }, "Modifier"),
      h("button", { class: "btn btn-small btn-quiet", onclick: async () => { try { await api.updateCategory(c.key, { archived: !c.archived }); await reloadTax(); } catch (e) { toast((e as Error).message, "err"); } } }, c.archived ? "Restaurer" : "Archiver")) : null))));
  async function reloadTax() { ctx.tax = await api.taxonomy(); drawCats(); }
  function editCategory(c: Category | null) {
    const label = h("input", { value: c?.label ?? "" }) as HTMLInputElement;
    const key = h("input", { value: c?.key ?? "", disabled: !!c }) as HTMLInputElement;
    label.addEventListener("input", () => { if (!c) key.value = slugify(label.value); });
    const fam = h("select", { disabled: !!c }, Object.entries(ctx.tax!.families).map(([k, f]) => h("option", { value: k, selected: k === c?.family }, f.label))) as HTMLSelectElement;
    const subs = h("textarea", { rows: 5 }, (c?.subcategories ?? []).join("\n")) as HTMLTextAreaElement;
    const desc = h("input", { value: c?.description ?? "" }) as HTMLInputElement;
    const rules = Object.entries(ctx.tax!.category_rules).map(([k, l]) => { const cb = h("input", { type: "checkbox", checked: c?.rules.includes(k) }) as HTMLInputElement; cb.dataset.k = k; return h("label", { class: "toggle" }, cb, l); });
    const close = modal(c ? `Catégorie « ${c.label} »` : "Nouvelle catégorie", h("div", { class: "fields" },
      field("Nom", label), field("Identifiant", key, "Stable, utilisé par les assets"), field("Famille technique", fam, "Détermine le rendu et les règles : ne change plus ensuite"),
      field("Description", desc), field("Sous-catégories (une par ligne)", subs), h("div", { class: "field" }, h("span", {}, "Règles métier"), ...rules)), [{
      label: "Enregistrer", run: async () => {
        const data = { label: label.value, description: desc.value, subcategories: subs.value.split("\n").map((s) => s.trim()).filter(Boolean),
          rules: rules.map((r) => r.querySelector("input")!).filter((i) => i.checked).map((i) => i.dataset.k!) };
        try {
          if (c) await api.updateCategory(c.key, data); else await api.createCategory({ ...data, key: key.value, family: fam.value });
          close(); toast("Catégorie enregistrée"); await reloadTax();
        } catch (e) { toast((e as Error).message, "err"); }
      } }]);
  }
  const cur = h("input", { type: "password", autocomplete: "current-password", "aria-label": "Mot de passe actuel" }) as HTMLInputElement;
  const nw = h("input", { type: "password", autocomplete: "new-password", "aria-label": "Nouveau mot de passe" }) as HTMLInputElement;
  fill(root, h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Paramètres du projet"))),
    h("div", { class: "dash" },
      h("section", { class: "panel" }, h("h2", {}, "Votre compte"), h("p", {}, `${ctx.user!.username} · ${ctx.user!.role_label}`),
        row(field("Mot de passe actuel", cur), field("Nouveau mot de passe", nw)),
        h("div", { class: "row" }, h("button", { class: "btn btn-small", onclick: async () => {
          try { await api.changePassword(cur.value, nw.value); toast("Mot de passe changé ; vos autres sessions sont fermées."); cur.value = nw.value = ""; } catch (e) { toast((e as Error).message, "err"); }
        } }, "Changer le mot de passe"),
          h("button", { class: "btn btn-small btn-quiet", onclick: async () => { await api.logout(true).catch(() => {}); setToken(null); location.hash = "#/"; location.reload(); } }, "Se déconnecter partout"))),
      sys ? h("section", { class: "panel" }, h("h2", {}, "Système"), h("ul", { class: "list" },
        h("li", {}, `Environnement : ${sys.env}${sys.dev_accounts ? " (comptes de développement actifs)" : ""}`),
        h("li", {}, `Version ${sys.version} · schéma de base v${sys.schema_version}`),
        h("li", {}, `Base : ${sys.db_path}`), h("li", {}, `Fichiers : ${fmtSize(sys.media_bytes)}`),
        h("li", {}, `Limites : ${sys.limits.upload_mb} Mo par fichier, ${sys.limits.import_mb} Mo par lot, ${sys.limits.image_px} px`),
        h("li", {}, `Sessions : ${sys.sessions.hours} h maximum, ${sys.sessions.idle_min} min d'inactivité`),
        h("li", {}, Object.entries(sys.counts).map(([k, v]) => `${k} ${v}`).join(" · ")))) : null),
    h("section", { class: "panel" }, h("h2", {}, "Familles techniques et capacités"),
      h("p", { class: "muted" }, "Définies par le code du moteur. « Non pris en charge » signifie que l'atelier ne propose pas la fonction : rien n'est simulé."),
      h("div", { class: "scroll-x" }, h("table", { class: "perm-table" }, h("tr", {}, h("th", {}, "Famille"), Object.keys(CAP_NAMES).map((k) => h("th", {}, CAP_NAMES[k])), h("th", {}, "Jeu actuel")),
        (Object.entries(ctx.tax!.families) as [Family, any][]).map(([k, f]) => h("tr", {}, h("td", {}, f.label), Object.keys(CAP_NAMES).map((c) => h("td", {}, capBadge(f.capabilities[c] ?? "unavailable"))),
          h("td", {}, f.game === "adapter" ? "adaptateur" : "non chargé")))))),
    h("section", { class: "panel" }, h("div", { class: "page-head" }, h("h2", {}, "Catégories métier"),
      can("admin.settings") ? h("button", { class: "btn btn-primary btn-small", onclick: () => editCategory(null) }, "Nouvelle catégorie") : null),
      h("p", { class: "muted" }, "Une catégorie se rattache à une famille existante : la créer ne demande ni code, ni table, ni route d'API."), cats));
  drawCats();
  void emptyState;
}
