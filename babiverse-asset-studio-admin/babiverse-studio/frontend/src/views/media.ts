import { api } from "../api";
import { can, confirmDialog, ctx, emptyState, field, fmtDate, fmtSize, h, refreshMedia, row, toast, fill } from "../ui";
import { mediaThumb } from "../forms";
import { openAsset } from "./editorParts";

export async function mediaView(root: HTMLElement) {
  const q = h("input", { type: "search", placeholder: "Nom, fichier ou étiquette…", "aria-label": "Rechercher" }) as HTMLInputElement;
  const kind = h("select", { "aria-label": "Type" }, [["", "Tous types"], ["svg", "SVG"], ["raster", "Images (PNG, WebP…)"], ["model", "Modèles 3D (GLB, glTF)"]].map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const cat = h("select", { "aria-label": "Classement" }, h("option", { value: "" }, "Tous classements"), Object.entries(ctx.tax!.media_categories).map(([k, l]) => h("option", { value: k }, l))) as HTMLSelectElement;
  const arch = h("input", { type: "checkbox" }) as HTMLInputElement;
  const grid = h("div", { class: "media-lib" });
  const detail = h("aside", { class: "media-detail" });
  const files = h("input", { type: "file", multiple: true, accept: ".svg,image/svg+xml,image/png,image/webp,image/jpeg,image/gif,.glb,.gltf,model/gltf-binary,model/gltf+json", "aria-label": "Fichiers à importer" }) as HTMLInputElement;
  const upCat = h("select", { "aria-label": "Classement des fichiers importés" }, Object.entries(ctx.tax!.media_categories).map(([k, l]) => h("option", { value: k, selected: k === "sprite" }, l))) as HTMLSelectElement;
  const upTags = h("input", { placeholder: "étiquettes, séparées par des virgules", "aria-label": "Étiquettes des fichiers importés" }) as HTMLInputElement;
  const progress = h("p", { class: "muted", "aria-live": "polite" });

  fill(root, 
    h("header", { class: "page-head" }, h("div", {}, h("h1", {}, "Bibliothèque de médias"),
      h("p", { class: "lede" }, `Fichiers utilisés par les assets. Formats : SVG (assaini), PNG, WebP, JPEG, GIF · ${ctx.tax!.limits.upload_mb} Mo et ${ctx.tax!.limits.image_px} px maximum. Modèles 3D : GLB, ou glTF autonome (tampons et textures intégrés), ${ctx.tax!.limits.model_mb ?? 20} Mo maximum, sans compression Draco ni Meshopt ; ils servent de paysages aux cartes du jeu (« Villes et cartes »).`))),
    can("media.upload") ? h("div", { class: "panel" }, h("h2", {}, "Importer des fichiers"), row(field("Fichiers", files), field("Classement", upCat), field("Étiquettes", upTags)), progress) : null,
    h("div", { class: "filters" }, q, kind, cat, h("label", { class: "toggle" }, arch, "Archivés")),
    h("div", { class: "media-layout" }, grid, detail));

  files.addEventListener("change", async () => {
    const list = [...(files.files ?? [])];
    let ok = 0;
    for (const [i, f] of list.entries()) {
      progress.textContent = `Import ${i + 1}/${list.length} : ${f.name}…`;
      try { await api.uploadMedia(f, f.name, { category: upCat.value, tags: upTags.value }); ok++; }
      catch (e) { toast(`${f.name} : ${(e as Error).message}`, "err"); }
    }
    progress.textContent = `${ok} fichier(s) importé(s) sur ${list.length}.`;
    files.value = "";
    await refreshMedia(); load();
  });

  async function load() {
    const items = await api.media({ q: q.value, kind: kind.value, category: cat.value, archived: arch.checked });
    fill(grid, ...(items.length ? items.map((m) => h("button", { class: "media-tile", onclick: () => show(m.id), "data-media": m.name },
      mediaThumb(m, 96), h("span", {}, m.name), h("small", { class: "muted" }, `${m.kind === "svg" ? "SVG" : m.mime.split("/")[1].toUpperCase()} · ${fmtSize(m.size)} · rév. ${m.revision}`)))
      : [emptyState("Aucun fichier.")]));
  }
  async function show(id: string) {
    const m = await api.mediaDetail(id);
    const mine = m.created_by === ctx.user!.username || can("media.manage");
    const name = h("input", { value: m.name, disabled: !mine }) as HTMLInputElement;
    const tags = h("input", { value: m.tags.join(", "), disabled: !mine }) as HTMLInputElement;
    const c = h("select", { disabled: !mine }, Object.entries(ctx.tax!.media_categories).map(([k, l]) => h("option", { value: k, selected: k === m.category }, l))) as HTMLSelectElement;
    const repl = h("input", { type: "file", disabled: !mine || !can("media.upload"), accept: m.kind === "svg" ? ".svg,image/svg+xml" : m.kind === "model" ? ".glb,.gltf" : "image/png,image/webp,image/jpeg,image/gif", "aria-label": "Fichier de remplacement" }) as HTMLInputElement;
    repl.addEventListener("change", async () => {
      const f = repl.files?.[0]; if (!f) return;
      try { await api.replaceMedia(m.id, f, f.name); toast("Fichier remplacé : même identifiant, nouvelle révision"); await refreshMedia(); show(m.id); load(); } catch (e) { toast((e as Error).message, "err"); }
    });
    fill(detail, h("div", { class: "panel" },
      m.kind === "model"
        ? h("div", { class: "model-facts" }, h("p", {}, `Modèle 3D ${m.meta.format?.toUpperCase()} · ${m.meta.size?.join(" × ")} unités (largeur × hauteur × profondeur) · ${m.meta.triangles} triangles · ${m.meta.materials} matériau(x) · ${m.meta.textures} texture(s)`),
            h("p", { class: "small" }, `Objets nommés : ${(m.meta.objects ?? []).map((o) => o.unique ? o.name : `${o.name} (en double)`).join(", ") || "aucun"}`),
            (m.meta.warnings ?? []).map((w) => h("p", { class: "small txt-danger" }, w)))
        : h("div", { class: `svg-prev ${m.kind === "svg" ? "checker" : ""}` }, h("img", { src: m.url, alt: m.name })),
      h("h2", {}, m.name),
      h("p", { class: "meta" }, `${m.filename} · ${m.mime} · ${fmtSize(m.size)} · ${Math.round(m.width)} × ${Math.round(m.height)} · révision ${m.revision}`),
      h("p", { class: "meta" }, `Importé par ${m.created_by}, ${fmtDate(m.created_at)}`, h("br"), h("code", { title: "Identifiant stable" }, m.id)),
      m.kind === "svg" ? h("p", { class: "small" }, `Canaux recolorables : ${Object.keys(m.meta.channels ?? {}).join(", ") || "aucun"} · couleurs fixes : ${Object.keys(m.meta.colors ?? {}).length}`) : null,
      m.meta.warnings?.length ? h("ul", { class: "report" }, m.meta.warnings.map((w) => h("li", { class: "rep-warning" }, w))) : null,
      field("Nom", name), field("Étiquettes", tags), field("Classement", c),
      mine ? h("button", { class: "btn btn-small", onclick: async () => {
        try { await api.updateMedia(m.id, { name: name.value, tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean), category: c.value }); toast("Enregistré"); await refreshMedia(); load(); }
        catch (e) { toast((e as Error).message, "err"); }
      } }, "Enregistrer") : null,
      field("Remplacer le fichier", repl, "Les assets qui l'utilisent suivent ; les versions publiées gardent la révision figée à leur publication."),
      h("h3", {}, `Utilisé par (${m.usage.length})`),
      m.usage.length ? h("ul", { class: "list" }, m.usage.map((u) => h("li", {}, h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); openAsset(u.asset_id, u.family); } }, u.name),
        ` v${u.version} (${u.status})`, u.pinned_revision ? ` · figé sur la révision ${u.pinned_revision}` : ""))) : h("p", { class: "muted small" }, "Aucun asset n'utilise ce fichier."),
      m.kind === "model" ? h("h3", {}, `Cartes du jeu (${(m as any).map_usage?.length ?? 0})`) : null,
      m.kind === "model" ? ((m as any).map_usage?.length
        ? h("ul", { class: "list", id: "media-map-usage" }, (m as any).map_usage.map((u: any) => h("li", {}, h("a", { href: `#/monde/carte/${u.map_id}` }, u.name),
          ` (${u.status}) · ${u.uses.map((x: any) => `${x.where} : révision ${x.revision ?? "courante"}`).join(" ; ")}`)))
        : h("p", { class: "muted small" }, "Aucune carte n'utilise ce modèle.")) : null,
      h("h3", {}, "Révisions"),
      h("ul", { class: "list" }, m.revisions.map((r) => h("li", {}, h("a", { href: r.url, target: "_blank", rel: "noopener" }, `Révision ${r.revision}`), ` · ${r.filename} · ${fmtSize(r.size)} · ${fmtDate(r.created_at)}`))),
      mine ? h("button", { class: "btn btn-small btn-quiet", onclick: async () => {
        if (!m.archived && !(await confirmDialog("Archiver", "Archiver ce fichier ? C'est possible seulement s'il n'est plus utilisé.", "Archiver", true))) return;
        try { await api.archiveMedia(m.id, !m.archived); toast(m.archived ? "Restauré" : "Archivé"); await refreshMedia(); show(m.id); load(); } catch (e) { toast((e as Error).message, "err"); }
      } }, m.archived ? "Restaurer" : "Archiver") : null));
    detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  let t = 0;
  q.addEventListener("input", () => { clearTimeout(t); t = window.setTimeout(load, 200); });
  [kind, cat, arch].forEach((e) => e.addEventListener("change", load));
  await load();
}
