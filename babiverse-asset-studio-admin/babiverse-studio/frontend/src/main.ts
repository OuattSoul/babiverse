import "./style.css";
import "./studio.css";
import { api, hasToken, setToken, whenAuthLost } from "./api";
import { parseHash, go } from "./router";
import { can, ctx, errorBox, h, loadLibrary, loading, toast } from "./ui";
import { catalogView } from "./views/catalog";
import { creatorView } from "./views/creator";
import { editorView } from "./views/editor";
import { cityView } from "./views/city";
import { charactersView, characterStudio, crowdView } from "./views/characters";
import { kitPartEditor, kitPartsView, kitStudio, kitsView, kitView } from "./views/kits";
import { partEditor, partsView } from "./views/parts";
import { mediaView } from "./views/media";
import { assemblyView, behaviorsView, dashboardView, historyView, reviewView, sectionView, variantsView } from "./views/pages";
import { settingsView, transferView, usersView } from "./views/admin";
import { gameView } from "./views/game";
import { gameMapView } from "./views/gameMap";

const app = document.getElementById("app")!;
let cleanup: (() => void) | null = null;

interface NavItem { hash: string; label: string; perm?: string }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: "Pilotage", items: [
    { hash: "#/", label: "Tableau de bord", perm: "asset.read" },
    { hash: "#/catalogue", label: "Catalogue des assets", perm: "asset.read" },
    { hash: "#/creer", label: "Créer un élément", perm: "asset.create" } ] },
  { group: "Ateliers", items: [
    { hash: "#/personnages", label: "Personnages", perm: "asset.read" },
    { hash: "#/modulaire", label: "Ateliers modulaires", perm: "asset.read" },
    { hash: "#/batiments", label: "Bâtiments et infrastructures", perm: "asset.read" },
    { hash: "#/interieurs", label: "Intérieurs et mobilier", perm: "asset.read" },
    { hash: "#/terrains", label: "Routes, terrains et végétation", perm: "asset.read" },
    { hash: "#/vehicules", label: "Véhicules et transports", perm: "asset.read" },
    { hash: "#/assemblage", label: "Atelier d'assemblage", perm: "asset.read" } ] },
  { group: "Ressources", items: [
    { hash: "#/medias", label: "Bibliothèque de médias", perm: "asset.read" },
    { hash: "#/composants", label: "Composants de personnage", perm: "asset.read" },
    { hash: "#/modulaire/composants", label: "Composants modulaires", perm: "asset.read" },
    { hash: "#/comportements", label: "Interactions et comportements", perm: "asset.read" },
    { hash: "#/variantes", label: "Variantes et thèmes", perm: "asset.read" } ] },
  { group: "Monde", items: [{ hash: "#/carte", label: "Carte de test" }, { hash: "#/jeu", label: "Intégration au jeu", perm: "asset.read" }, { hash: "#/jeu/carte", label: "Carte du jeu", perm: "asset.read" }] },
  { group: "Cycle de vie", items: [
    { hash: "#/validation", label: "Validation et publication", perm: "asset.read" },
    { hash: "#/historique", label: "Versions et historique", perm: "asset.read" },
    { hash: "#/transferts", label: "Importation et exportation", perm: "asset.export" } ] },
  { group: "Administration", items: [
    { hash: "#/utilisateurs", label: "Utilisateurs et permissions", perm: "admin.users" },
    { hash: "#/parametres", label: "Paramètres du projet" } ] },
];

function shell(): HTMLElement {
  const main = h("main", { id: "main", tabindex: "-1" });
  const nav = h("nav", { class: "nav", "aria-label": "Navigation principale" },
    h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }), h("div", {}, h("strong", {}, "Babiverse"), h("span", {}, "Asset Studio · Cité Akwaba"))),
    NAV.map((g) => {
      const items = g.items.filter((n) => !n.perm || can(n.perm));
      return items.length ? h("div", { class: "nav-group" }, h("p", { class: "nav-title" }, g.group),
        h("ul", {}, items.map((n) => h("li", {}, h("a", { href: n.hash, "data-hash": n.hash }, n.label))))) : null;
    }),
    h("div", { class: "who" }, h("span", {}, ctx.user!.username, h("small", {}, ctx.user!.role_label)),
      h("button", { class: "linkish", onclick: async () => { await api.logout().catch(() => {}); setToken(null); location.hash = "#/"; boot(); } }, "Se déconnecter")));
  const menu = h("button", { class: "menu-btn", "aria-label": "Menu", onclick: () => document.body.classList.toggle("nav-open") }, "☰");
  const shade = h("div", { class: "nav-shade", onclick: () => document.body.classList.remove("nav-open") });
  return h("div", { class: "shell" }, menu, shade, nav, main);
}

const ALIASES: Record<string, string> = { asset: "catalogue", ville: "carte", publications: "historique" };

async function route() {
  cleanup?.(); cleanup = null;
  document.body.classList.remove("nav-open");
  const main = document.getElementById("main")!;
  const { path, query } = parseHash();
  const top = path[0];
  const current = top === "jeu" && path[1] === "carte" ? "#/jeu/carte"
    : top === "modulaire" && (path[1] === "composants" || path[2] === "composants") ? "#/modulaire/composants"
    : `#/${ALIASES[top ?? ""] ?? (top === "composants" && path[1] ? "composants" : top ?? "")}`;
  document.querySelectorAll<HTMLAnchorElement>(".nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.hash === current));
  main.replaceChildren(loading());
  try {
    if (!can("asset.read") && !["carte", "ville", "parametres"].includes(top ?? "")) return go("#/carte");
    let r: void | (() => void) = undefined;
    switch (top) {
      case undefined: await dashboardView(main); break;
      case "catalogue": await catalogView(main, { status: query.get("statut") ?? "", category: query.get("categorie") ?? "" }); break;
      case "creer": r = await creatorView(main, query.get("famille")); break;
      case "personnages":
        if (path[1] === "foule") await crowdView(main);
        else if (path[1]) r = await characterStudio(main, path[1]);
        else await charactersView(main);
        break;
      case "composants": if (path[1]) await partEditor(main, path[1]); else await partsView(main); break;
      case "modulaire":
        if (!path[1]) await kitsView(main);
        else if (path[1] === "composants") await kitPartsView(main, null);
        else if (path[2] === "composants") { if (path[3]) await kitPartEditor(main, path[1], path[3]); else await kitPartsView(main, path[1]); }
        else if (path[2]) r = await kitStudio(main, path[1], path[2]);
        else await kitView(main, path[1]);
        break;
      case "batiments": case "interieurs": case "terrains": case "vehicules": await sectionView(main, top); break;
      case "assemblage": r = await assemblyView(main); break;
      case "medias": await mediaView(main); break;
      case "comportements": await behaviorsView(main); break;
      case "variantes": await variantsView(main); break;
      case "carte": case "ville": r = await cityView(main); break;
      case "jeu": if (path[1] === "carte") r = await gameMapView(main); else await gameView(main); break;
      case "validation": await reviewView(main); break;
      case "historique": case "publications": await historyView(main); break;
      case "transferts": case "imports": await transferView(main); break;
      case "utilisateurs": await usersView(main); break;
      case "parametres": await settingsView(main); break;
      case "asset": r = await editorView(main, path[1]); break;
      default: main.replaceChildren(h("div", { class: "empty" }, h("p", {}, "Cette page n'existe pas."), h("a", { href: "#/" }, "Retour au tableau de bord")));
    }
    if (typeof r === "function") cleanup = r;
    main.focus({ preventScroll: true });
  } catch (e) {
    main.replaceChildren(errorBox(e));
  }
}

function loginScreen(message = "") {
  const u = h("input", { autocomplete: "username", required: true, name: "username" }) as HTMLInputElement;
  const p = h("input", { type: "password", autocomplete: "current-password", required: true, name: "password" }) as HTMLInputElement;
  const err = h("p", { class: "form-error", role: "alert" }, message);
  const submit = h("button", { class: "btn btn-primary", type: "submit" }, "Se connecter");
  app.replaceChildren(h("div", { class: "login" },
    h("form", { class: "login-card", onsubmit: async (e: Event) => {
      e.preventDefault();
      submit.disabled = true; submit.textContent = "Connexion…";
      try { const r = await api.login(u.value, p.value); setToken(r.token); boot(); }
      catch (x) { err.textContent = (x as Error).message; submit.disabled = false; submit.textContent = "Se connecter"; }
    } },
      h("span", { class: "brand-mark big", "aria-hidden": "true" }),
      h("h1", {}, "Babiverse Asset Studio"),
      h("p", { class: "muted" }, "Cité Akwaba — atelier de création de contenu. Réservé aux administrateurs du contenu."),
      h("label", {}, "Identifiant", u), h("label", {}, "Mot de passe", p), err, submit,
      h("p", { class: "muted small", id: "dev-hint" }))));
  u.focus();
}

async function boot() {
  if (!hasToken()) return loginScreen();
  app.replaceChildren(h("div", { class: "login" }, loading("Ouverture de l'atelier…")));
  try {
    [ctx.user, ctx.tax] = await Promise.all([api.me(), api.taxonomy()]);
    if (can("asset.read")) await loadLibrary();
  } catch { setToken(null); return loginScreen(); }
  app.replaceChildren(shell(), h("div", { id: "toasts", "aria-live": "polite" }));
  if (ctx.user!.dev) document.body.classList.add("env-dev");
  route();
}

whenAuthLost(() => { if (ctx.user) { ctx.user = null; loginScreen("Votre session a expiré : reconnectez-vous. Les modifications non enregistrées sont perdues."); } });
window.addEventListener("hashchange", () => { if (ctx.user && document.getElementById("main")) route(); });
window.addEventListener("unhandledrejection", (e) => toast(String(e.reason?.message ?? e.reason), "err"));
boot();
