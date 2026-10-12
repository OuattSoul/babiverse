// Outils partagés des scénarios de bout en bout (Chrome installé + playwright-core).
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const BASE = process.env.BASE_URL || 'http://localhost:5173/?debug=1';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SHOTS = fileURLToPath(new URL('./screenshots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });

export const T = 32;
export const PASSWORD = 'Akwaba-E2E-2026';
let accounts = 0;
/** Nom d'utilisateur unique (3 à 20 caractères) pour chaque compte créé par les scénarios. */
export const uniqueUsername = (prefix = 'e2e') => `${prefix}${Date.now().toString(36)}${accounts++}`.slice(0, 20);
export const c = (tx, ty) => ({ x: (tx + 0.5) * T, y: (ty + 0.5) * T });

/** desktop : profil ordinateur (souris, grand écran, sans tactile) au lieu d'un Android d'entrée de gamme. */
export async function session(name, { desktop = false, args = [] } = {}) {
  // Efface les captures du run précédent de ce scénario (étapes renommées, captures d'échec).
  for (const f of readdirSync(SHOTS)) if (f.startsWith(`${name}-`)) rmSync(`${SHOTS}${f}`);
  const results = [];
  let failures = 0;
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args });
  // Profil « Android d'entrée de gamme » : petit écran, tactile, processeur ralenti ×4.
  const context = await browser.newContext(desktop
    ? { viewport: { width: 1280, height: 800 }, locale: 'fr-FR' }
    : { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'fr-FR' });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (!desktop) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  // Les refus métier attendus (409) et les échecs réseau simulés apparaissent comme
  // « Failed to load resource » : ils ne sont pas des erreurs du jeu.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of 409|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(m.text())) consoleErrors.push(m.text());
  });

  const wait = (ms) => page.waitForTimeout(ms);
  const s = {
    page, context, cdp, wait, consoleErrors,
    check(label, ok, detail = '') {
      results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
      if (!ok) failures++;
    },
    // Une capture ratée (page très ralentie) ne doit pas faire échouer le scénario.
    shot: (n) => page.screenshot({ path: `${SHOTS}${name}-${n}.png`, timeout: 60000 }).catch((e) => console.warn(`capture ${n} : ${e.message.split('\n')[0]}`)),
    player: () => page.evaluate(() => window.__babi.player()),
    state: () => page.evaluate(() => window.__babi.store.state),
    prompt: () => page.evaluate(() => window.__babi.prompt()),

    /** Marche en ligne droite vers un point (pixels) via l'entrée virtuelle du joystick. */
    async walkTo({ x, y }, timeout = 20000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const p = await s.player();
        const dx = x - p.x;
        const dy = y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < 3) break;
        const k = Math.min(1, d / 12);
        await page.evaluate(([fx, fy]) => { window.__babi.touchInput.forced = { x: fx, y: fy }; }, [(dx / d) * k, (dy / d) * k]);
        await wait(40);
      }
      await page.evaluate(() => { window.__babi.touchInput.forced = null; });
      await wait(150);
      return s.player();
    },

    /** Va jusqu'à un point en suivant le chemin calculé par le jeu (comme un toucher au sol). */
    async goto({ x, y }, timeout = 30000) {
      await page.evaluate(([gx, gy]) => window.__babi.goTo(gx, gy), [x, y]);
      await page.waitForFunction(([gx, gy]) => {
        const p = window.__babi.player();
        return Math.hypot(p.x - gx, p.y - gy) < 6 || !window.__babi.world.path;
      }, [x, y], { timeout, polling: 100 });
      await wait(250);
      return s.player();
    },

    /** Case où se tenir pour utiliser un élément de la zone courante (données du monde). */
    stand: (id) => page.evaluate((i) => window.__babi.stand(i), id),
    zoneData: () => page.evaluate(() => {
      const z = window.__babi.world.zone;
      return { props: z.props, interactables: z.interactables, spawns: z.spawns, buildings: z.buildings || [] };
    }),

    async path(...points) {
      for (const pt of points) await s.walkTo(pt);
      return s.player();
    },

    async hold(dir, ms) {
      await page.evaluate((d) => { window.__babi.touchInput.forced = d; }, dir);
      await wait(ms);
      await page.evaluate(() => { window.__babi.touchInput.forced = null; });
      await wait(100);
      return s.player();
    },

    /** Appuie sur le bouton d'action tactile. */
    async interact() {
      await page.locator('#action-btn').dispatchEvent('pointerdown');
      await wait(450);
    },

    async waitZone(zone) {
      // Construire la ville prend ~5 s avec le CPU ralenti ×4 (peinture du sol, fusion du décor).
      await page.waitForFunction((z) => window.__babi.player()?.zone === z, zone, { timeout: 15000 });
      await wait(400);
    },

    /** Ouvre le jeu et crée un compte (écran « Créer un compte ») ; s'arrête sur la création du personnage. */
    async signUp(username = uniqueUsername()) {
      await page.goto(BASE);
      await page.click('#btn-register', { timeout: 15000 });
      await page.fill('#auth-username', username);
      await page.fill('#auth-email', `${username}@exemple.ci`);
      await page.fill('#auth-password', PASSWORD);
      await page.fill('#auth-password2', PASSWORD);
      await page.click('#register-form-submit');
      await page.waitForSelector('#char-name', { timeout: 15000 });
      return username;
    },

    async createCharacter(charName, profile) {
      await s.signUp();
      await page.fill('#char-name', charName);
      await page.click(`[data-profile="${profile}"]`);
      await page.click('#btn-start');
      await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 15000 });
      await wait(800);
    },

    /** Coordonnées écran d'un point du monde (pixels de grille) selon la caméra courante. */
    async screenOf({ x, y }, height = 0) {
      return page.evaluate(([wx, wy, h]) => {
        const cam = window.__babi.rig.camera;
        const v = cam.position.clone().set(wx / 32, h, wy / 32).project(cam);
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      }, [x, y, height]);
    },

    /** Toucher bref (événements tactiles réels). */
    async tap({ x, y }) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await wait(60);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(200);
    },

    /** Glissé tactile à un ou deux doigts : from/to = listes de points. */
    async drag(from, to, steps = 8) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: from });
      for (let i = 1; i <= steps; i++) {
        const pts = from.map((p, k) => ({ x: p.x + ((to[k].x - p.x) * i) / steps, y: p.y + ((to[k].y - p.y) * i) / steps, id: k }));
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts });
        await wait(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(300);
    },

    async finish() {
      s.check('Aucune erreur JavaScript', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
      await browser.close();
      console.log(`\n== ${name} ==\n${results.join('\n')}`);
      return failures;
    },

    async fail(err) {
      s.check('Exécution du scénario', false, err.stack || err.message);
      await s.shot('erreur').catch(() => {});
    },
  };
  return s;
}
