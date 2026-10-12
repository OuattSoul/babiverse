// Parcours de bout en bout du Babiverse Asset Studio (Chrome installé + playwright-core).
// Lance deux serveurs indépendants (bases et médias séparés) : A = environnement de travail, B = « autre environnement »
// pour la réimportation. Usage : npm run build && npm run e2e   (CHROME_PATH pour un autre navigateur)
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BACKEND = join(ROOT, "backend");
const PY = process.env.PYTHON || join(BACKEND, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = fileURLToPath(new URL("./screenshots/", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/jupe-e2e.svg", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
for (const f of readdirSync(SHOTS)) rmSync(join(SHOTS, f));

const work = mkdtempSync(join(tmpdir(), "babiverse-e2e-"));
const results = [];
let failures = 0;
const servers = [];

function startServer(name, port) {
  const env = { ...process.env, BABIVERSE_DB: join(work, `${name}.db`), BABIVERSE_MEDIA_DIR: join(work, `${name}-media`),
    BABIVERSE_FRONTEND: join(ROOT, "frontend", "dist"), BABIVERSE_PBKDF2_ITERATIONS: "2000", BABIVERSE_ENV: "development", PYTHONUTF8: "1" };
  const p = spawn(PY, ["-m", "uvicorn", "app.main:app", "--port", String(port), "--log-level", "warning"], { cwd: BACKEND, env, stdio: ["ignore", "inherit", "inherit"] });
  servers.push(p);
  return `http://127.0.0.1:${port}`;
}
async function waitUp(base) {
  for (let i = 0; i < 480; i++) { // premier démarrage : amorçage complet (bibliothèques SVG), jusqu'à 4 min
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* démarrage */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Serveur ${base} injoignable`);
}

async function step(page, name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`  ✓ ${name} (${Date.now() - t} ms)`);
    await page.screenshot({ path: join(SHOTS, `${String(results.length).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`) });
  } catch (e) {
    failures++;
    results.push(`  ✗ ${name} : ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: join(SHOTS, `ECHEC-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`) }).catch(() => {});
    throw e;
  }
}

async function login(page, base, user = "admin") {
  await page.goto(`${base}/#/`);
  await page.getByLabel("Identifiant").fill(user);
  await page.getByLabel("Mot de passe").fill(user);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.locator(".nav").waitFor();
}
const toastText = (page, re) => page.locator(".toast", { hasText: re }).first().waitFor({ timeout: 15000 });

async function placeAt(page, tech, x, y, rotation = 0) {
  await page.locator(`.pal[data-asset="${tech}"]`).click();
  if (rotation) await page.locator(".pal-opts .seg button", { hasText: `${rotation}°` }).click();
  await page.waitForTimeout(400);
  const pt = await page.evaluate(([cx, cy]) => window.__babiCity.cellToScreen(cx, cy), [x, y]);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
  await page.locator(".city-info h2", { hasText: /Placé|Refusé/ }).waitFor();
  const title = await page.locator(".city-info h2").first().textContent();
  if (title !== "Placé") throw new Error(`placement refusé : ${await page.locator(".city-info").textContent()}`);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const errors = [];
const watch = (page, label) => {
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) errors.push(`${label}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? d.defaultValue() || "Tenue E2E" : undefined));
};

try {
  const A = startServer("a", 8765), B = startServer("b", 8766);
  await Promise.all([waitUp(A), waitUp(B)]);
  const ctxA = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: "fr-FR", acceptDownloads: true });
  const page = await ctxA.newPage();
  watch(page, "A");
  const stamp = Date.now().toString(36).slice(-5);
  const assetName = `Clinique Akwaba ${stamp}`;
  let assetUrl = "";
  let tech = "";
  let bundleAsset = "";

  console.log("Parcours 1 — asset (bâtiment)");
  await step(page, "ouvrir et se connecter", () => login(page, A));
  await step(page, "créer un nouvel asset avec l'assistant", async () => {
    await page.goto(`${A}/#/creer`);
    await page.locator('.fam-card[data-family="building"]').click();
    await page.locator(".cat-card", { hasText: "Santé" }).click();
    await page.locator("#sec-identity input").first().fill(assetName);
    await page.locator("#sec-identity input").first().dispatchEvent("input");
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.locator("#sec-appearance input[type=color]").first().fill("#d35400");
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.locator(".wizard-preview .report-ok, .wizard-preview .report-sum").first().waitFor();
    await page.getByRole("button", { name: "Suivant" }).click();
    await page.getByRole("button", { name: "Enregistrer comme brouillon" }).click();
    await page.waitForURL(/#\/asset\//);
    assetUrl = page.url();
    tech = (await page.locator(".ed-title code").first().textContent()).trim();
  });
  await step(page, "modifier son apparence et enregistrer le brouillon", async () => {
    await page.locator("#sec-appearance select").first().selectOption("hip");
    await page.locator("#sec-appearance input[type=color]").nth(1).fill("#1e3d6b");
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await toastText(page, /Brouillon enregistré/);
  });
  await step(page, "recharger la page et retrouver le brouillon", async () => {
    await page.reload();
    await page.locator(".ed-title h1", { hasText: assetName }).waitFor();
    const roof = await page.locator("#sec-appearance select").first().inputValue();
    const col = await page.locator("#sec-appearance input[type=color]").nth(1).inputValue();
    if (roof !== "hip" || col !== "#1e3d6b") throw new Error(`modifications non conservées (${roof}, ${col})`);
    await page.goto(`${A}/#/catalogue`);
    await page.getByLabel("Rechercher").fill(assetName);
    await page.locator(`.card[data-asset="${tech}"] .pill-draft, .line[data-asset="${tech}"] .pill-draft`).first().waitFor();
  });
  await step(page, "valider puis publier", async () => {
    await page.goto(assetUrl);
    await page.getByRole("button", { name: "Soumettre à validation" }).click();
    await toastText(page, /Soumis/);
    await page.getByRole("button", { name: "Approuver" }).click();
    await toastText(page, /Approuvé/);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await page.locator(".ed-title .pill-published").waitFor();
  });
  await step(page, "le retrouver dans le catalogue", async () => {
    await page.goto(`${A}/#/catalogue?statut=published`);
    await page.getByLabel("Rechercher").fill(stamp);
    await page.locator(`[data-asset="${tech}"] .pill-published`).first().waitFor();
  });
  await step(page, "le placer dans la carte de test", async () => {
    await page.goto(`${A}/#/carte`);
    await page.locator(".stage-city canvas").waitFor();
    await placeAt(page, tech, 22, 12, 180);
  });
  let zip1 = join(work, "export-asset.zip");
  await step(page, "exporter l'asset", async () => {
    await page.goto(`${A}/#/transferts`);
    await page.getByLabel("Filtrer les assets").fill(stamp);
    await page.locator(".pick", { hasText: assetName }).locator("input").check();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter la sélection" }).click()]);
    await dl.saveAs(zip1);
  });

  console.log("Parcours 2 — personnage SVG modulaire");
  const partName = `Jupe E2E ${stamp}`;
  let charUrl = "", charTech = "";
  await step(page, "importer un composant SVG (assaini) et définir ses couleurs", async () => {
    await page.goto(`${A}/#/composants/nouveau`);
    await page.getByLabel("Fichier SVG").setInputFiles(FIXTURE);
    await page.locator("h2", { hasText: "2. Vérification" }).waitFor();
    const warn = await page.locator(".import-check").textContent();
    if (!/Contenu actif retiré|script/i.test(warn)) throw new Error("le script n'a pas été signalé comme retiré");
    await page.getByLabel("Canal pour #336699").selectOption("primary");
    await page.getByRole("button", { name: "Appliquer la convention de couleurs" }).click();
    await toastText(page, /Convention appliquée/);
    await page.locator(".import-check", { hasText: "primary" }).waitFor();
    await page.locator(".panel", { hasText: "4. Créer" }).locator("input").fill(partName);
    await page.locator(".panel", { hasText: "4. Créer" }).locator("select").selectOption("bottom");
    await page.getByRole("button", { name: "Créer le composant" }).click();
    await page.waitForURL(/#\/composants\/[0-9a-f-]{36}/);
    await page.getByRole("button", { name: "Soumettre à validation" }).click();
    await page.getByRole("button", { name: "Approuver" }).click();
    await page.getByRole("button", { name: "Publier" }).click();
    await page.locator(".ed-title .pill-published").waitFor();
  });
  await step(page, "créer un personnage et changer ses composants", async () => {
    await page.goto(`${A}/#/personnages`);
    await page.getByRole("button", { name: "Nouvel habitant" }).click();
    await page.waitForURL(/#\/personnages\/[0-9a-f-]{36}/);
    charUrl = page.url();
    charTech = (await page.locator(".ed-title code").first().textContent()).trim();
    await page.evaluate(() => document.querySelectorAll(".char-controls details").forEach((d) => (d.open = true)));
    const dressOn = page.locator('.slot[data-slot="dress"] .part-tile.on[data-part]');
    if (await dressOn.count()) await page.locator('.slot[data-slot="dress"] .part-tile', { hasText: "Aucun" }).click();
    if (!(await page.locator('.slot[data-slot="top"] .part-tile.on').count())) await page.locator('.slot[data-slot="top"] .part-tile[data-part]').first().click();
    const hw = page.locator('.slot[data-slot="headwear"] .part-tile:not(.on)', { hasText: "Aucun" });
    if (await hw.count()) await hw.click();
    await page.locator('.slot[data-slot="hair"] .part-tile[data-part="part-coiffure-tresses"]').click();
    await page.locator('.slot[data-slot="bottom"] .part-tile', { hasText: partName }).click();
    await page.locator('.slot[data-slot="top"] .layer-colors .sw').nth(3).click();
    await page.getByText("Tenue de base compatible.").waitFor();
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await toastText(page, /Brouillon enregistré/);
  });
  await step(page, "recharger et retrouver le personnage modifié", async () => {
    await page.reload();
    await page.locator('.slot[data-slot="bottom"] .part-tile.on', { hasText: partName }).waitFor();
    await page.locator('.slot[data-slot="hair"] .part-tile.on[data-part="part-coiffure-tresses"]').waitFor();
    const n = await page.locator(".char-big img").evaluate((img) => img.naturalWidth);
    if (!n) throw new Error("aperçu du personnage non rendu");
  });
  await step(page, "créer une tenue (variante) et voir le personnage en situation", async () => {
    await page.getByRole("button", { name: "Nouvelle tenue" }).click();
    await page.evaluate(() => document.querySelectorAll(".char-controls details").forEach((d) => (d.open = true)));
    await page.locator('.slot[data-slot="shoes"] .part-tile[data-part="part-sandales"]').click();
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await toastText(page, /Brouillon enregistré/);
    await page.getByRole("button", { name: "En situation" }).click();
    await page.locator(".situ-row.small-row img").first().waitFor();
  });
  await step(page, "valider et publier le personnage", async () => {
    await page.getByRole("button", { name: "Soumettre à validation" }).click();
    await page.getByRole("button", { name: "Approuver" }).click();
    await page.getByRole("button", { name: "Publier" }).click();
    await page.locator(".ed-title .pill-published").waitFor();
  });
  await step(page, "placer le personnage dans la carte de test", async () => {
    await page.goto(`${A}/#/carte`);
    await page.locator(".stage-city canvas").waitFor();
    await page.getByLabel("Famille").selectOption("character");
    await placeAt(page, charTech, 24, 15);
  });
  let zip2 = join(work, "export-personnage.zip");
  await step(page, "exporter le personnage avec ses composants", async () => {
    await page.goto(`${A}/#/transferts`);
    await page.getByLabel("Filtrer les assets").fill(charTech.slice(0, 12));
    await page.locator(".pick").first().locator("input").check();
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter la sélection" }).click()]);
    await dl.saveAs(zip2);
  });
  await step(page, "atelier modulaire : créer un bâtiment et changer ses composants", async () => {
    await page.goto(`${A}/#/modulaire/building`);
    await page.getByRole("button", { name: "Nouvel élément" }).first().click();
    await page.locator(".modal").getByRole("button", { name: "Créer" }).click();
    await page.waitForURL(/#\/modulaire\/building\/[0-9a-f-]{36}/);
    await page.getByRole("tab", { name: "Structure" }).click();
    await page.locator('.slot[data-slot="base"] .part-tile[data-part="kit-building-r-plus-2"]').click();
    await page.getByRole("tab", { name: "Toiture" }).click();
    await page.locator('.slot[data-slot="roof"] .part-tile[data-part="kit-building-toit-terrasse"]').click();
    await page.getByRole("tab", { name: "Ouvertures" }).click();
    await page.locator('.slot[data-slot="door"] .part-tile[data-part="kit-building-porte-arc"]').click();
    await page.getByText("Assemblage de base compatible.").waitFor();
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await toastText(page, /Brouillon enregistré/);
    await page.reload();
    await page.getByRole("tab", { name: "Ouvertures" }).click();
    await page.locator('.slot[data-slot="door"] .part-tile.on[data-part="kit-building-porte-arc"]').waitFor();
    const n = await page.locator(".kit-big img").evaluate((img) => img.naturalWidth);
    if (!n) throw new Error("aperçu de l'assemblage non rendu");
  });
  await step(page, "atelier modulaire : variante, publication et tests du kit", async () => {
    await page.getByRole("tab", { name: "Variantes" }).click();
    await page.getByRole("button", { name: "Nouvelle variante" }).click();
    await page.getByRole("tab", { name: "Toiture" }).click();
    await page.locator('.slot[data-slot="roof"] .part-tile[data-part="kit-building-toit-tropical"]').click();
    await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
    await toastText(page, /Brouillon enregistré/);
    await page.getByRole("button", { name: "Soumettre à validation" }).click();
    await page.getByRole("button", { name: "Approuver" }).click();
    await page.getByRole("button", { name: "Publier" }).click();
    await page.locator(".ed-title .pill-published").waitFor();
    await page.goto(`${A}/#/modulaire/building`);
    await page.locator(".kit-crowd.crowd-small img").first().waitFor();
    await page.locator(".summary .big").waitFor();
    const ko = await page.locator(".tests li.ko").allTextContents();
    if (ko.length) throw new Error(`tests du kit en échec : ${ko.join(" | ")}`);
  });

  console.log("Réimport dans un autre environnement");
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR" });
  const pb = await ctxB.newPage();
  watch(pb, "B");
  await step(pb, "réimporter l'asset et le personnage dans l'environnement B", async () => {
    await login(pb, B);
    for (const zip of [zip1, zip2]) {
      await pb.goto(`${B}/#/transferts`);
      await pb.getByLabel("Lot à importer").setInputFiles(zip);
      await pb.locator("h2", { hasText: "Aperçu avant import" }).waitFor();
      await pb.getByRole("button", { name: "Appliquer l'import" }).click();
      await pb.locator("h2", { hasText: "Rapport d'import" }).waitFor();
      const txt = await pb.locator("div.panel", { hasText: "Rapport d'import" }).textContent();
      if (/rep-error/.test(await pb.locator("div.panel", { hasText: "Rapport d'import" }).innerHTML())) throw new Error(`erreurs d'import : ${txt}`);
    }
    await pb.goto(`${B}/#/catalogue?statut=published`);
    await pb.getByLabel("Rechercher").fill(stamp);
    await pb.locator(`[data-asset="${tech}"] .pill-published`).first().waitFor();
    await pb.goto(`${B}/#/personnages`);
    const card = pb.locator(`.char-card[data-asset="${charTech}"]`);
    await card.waitFor();
    const w = await card.locator("img").evaluate((img) => img.naturalWidth);
    if (!w) throw new Error("personnage réimporté non rendu");
    bundleAsset = charTech;
  });

  console.log("Mobile");
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "fr-FR" });
  const pm = await ctxM.newPage();
  watch(pm, "mobile");
  await step(pm, "mobile : connexion, menu, catalogue et personnage", async () => {
    await login(pm, A, "publieur");
    await pm.getByRole("button", { name: "Menu" }).tap();
    await pm.locator(".nav a", { hasText: "Catalogue des assets" }).tap();
    await pm.locator(".cards .card, .rows .line").first().waitFor();
    const over = await pm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 2) throw new Error(`défilement horizontal de ${over} px`);
    await pm.goto(charUrl);
    await pm.locator(".char-big img").waitFor();
    const over2 = await pm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over2 > 2) throw new Error(`défilement horizontal de ${over2} px dans l'atelier`);
  });
  await step(pm, "mobile : validation et carte de test", async () => {
    await pm.goto(`${A}/#/validation`);
    await pm.locator("h1", { hasText: "Validation" }).waitFor();
    await pm.goto(`${A}/#/carte`);
    await pm.locator(".stage-city canvas").waitFor();
  });
  void bundleAsset;
} catch (e) {
  console.error(e.message);
} finally {
  console.log(results.join("\n"));
  if (errors.length) { console.log("Erreurs JavaScript :"); for (const e of errors.slice(0, 20)) console.log("  ! " + e); }
  await browser.close();
  for (const s of servers) s.kill();
  console.log(failures || errors.length ? `ÉCHEC (${failures} étape(s), ${errors.length} erreur(s) JS)` : `OK — ${results.length} étapes`);
  process.exitCode = failures || errors.length ? 1 : 0;
}
