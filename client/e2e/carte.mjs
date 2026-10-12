// Scénario 8 — carte du jeu de l'atelier : l'administrateur trace une zone et y place un bâtiment publié, puis le
// joueur le voit dans la ville, l'approche et entre dans son intérieur.
// Prérequis : E2E_STUDIO_URL vers un atelier DE TEST (ses placements sont modifiés), backend lancé avec ATELIER_URL
// vers ce même atelier, client démarré.
import { fileURLToPath } from 'node:url';
import { session } from './lib.mjs';

const STUDIO = process.env.E2E_STUDIO_URL;

async function studioApi(path, method = 'GET', body) {
  const login = await fetch(`${STUDIO}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  const { token } = await login.json();
  const res = await fetch(`${STUDIO}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return res.json();
}

export async function run() {
  const s = await session('carte');
  const { page, check, wait } = s;
  if (!STUDIO) { check('E2E_STUDIO_URL défini (atelier de test)', false); return s.finish(); }
  try {
    // Repartir d'une carte vide
    const start = await studioApi('/api/game/placements');
    for (const p of start.placements) await studioApi(`/api/game/placements/${p.id}`, 'DELETE');
    for (const r of start.removals) await studioApi(`/api/game/removals/${encodeURIComponent(r.key)}`, 'DELETE');

    // 1. Atelier : tracer une zone sur la carte du jeu et y placer un bâtiment
    const admin = await s.context.browser().newPage({ viewport: { width: 1400, height: 1000 } });
    await admin.goto(`${STUDIO}/`);
    await admin.fill('input[name=username]', 'admin');
    await admin.fill('input[name=password]', 'admin');
    await admin.click('button[type=submit]');
    await admin.waitForSelector('nav.nav', { timeout: 60000 });
    await admin.goto(`${STUDIO}/#/jeu/carte`);
    await admin.waitForSelector('.gmap-overlay', { timeout: 30000 });
    await admin.waitForTimeout(500); // échelle de départ ajustée à la largeur
    // Position écran d'une case : échelle et marge des règles lues sur le calque (data-scale, data-ruler).
    const cell = async (x, y) => {
      const box = await admin.locator('.gmap-overlay').boundingBox();
      const { scale, ruler } = await admin.locator('.gmap-overlay').evaluate((c) => ({ scale: +c.dataset.scale, ruler: +c.dataset.ruler }));
      return { x: box.x + ruler + (x + 0.5) * scale, y: box.y + ruler + (y + 0.5) * scale };
    };
    const at = async (fn, x, y, opts) => { const c = await cell(x, y); return fn(c.x, c.y, opts); };
    await at((x, y, o) => admin.mouse.move(x, y, o), 28, 8);
    await admin.mouse.down();
    await at((x, y, o) => admin.mouse.move(x, y, o), 30, 9, { steps: 5 });
    await admin.mouse.up();
    await admin.waitForSelector('.gmap-panel >> text=Zone tracée');
    check('Atelier : zone tracée sur la carte du jeu', (await admin.textContent('.gmap-panel')).includes('3 × 2'));
    const card = admin.locator('.gmap-asset', { has: admin.locator('strong', { hasText: /^Boutique de quartier$/ }) });
    check('Atelier : le bâtiment publié tient dans la zone', await card.locator('button', { hasText: 'Placer ici' }).isVisible());
    await card.locator('button', { hasText: 'Placer ici' }).click();
    await admin.waitForSelector('.gmap-line', { timeout: 10000 });
    const placed = (await studioApi('/api/game/placements')).placements;
    const shop = placed.find((p) => p.family === 'building');
    check('Atelier : bâtiment enregistré sur la carte', !!shop && shop.x === 28 && shop.y === 8, JSON.stringify(shop));
    // une zone interdite (route) est signalée
    await at((x, y, o) => admin.mouse.move(x, y, o), 18, 13);
    await admin.mouse.down();
    await at((x, y, o) => admin.mouse.move(x, y, o), 19, 14, { steps: 3 });
    await admin.mouse.up();
    check('Atelier : une route est refusée', (await admin.textContent('.gmap-panel')).includes('route'));
    // retirer un bâtiment d'origine (la pharmacie) ; l'épicerie, utile au jeu, est protégée
    await at((x, y) => admin.mouse.click(x, y), 12, 10);
    check("Atelier : l'épicerie est protégée", (await admin.textContent('.gmap-panel')).includes('Protégé')
      && !(await admin.locator('.gmap-panel button', { hasText: 'Retirer de la carte' }).count()));
    await at((x, y) => admin.mouse.click(x, y), 28, 24);
    await admin.locator('.gmap-panel button', { hasText: 'Retirer de la carte' }).click();
    await admin.waitForSelector('.gmap-panel >> text=Retiré de la ville du jeu', { timeout: 10000 });
    check("Atelier : bâtiment d'origine retiré", (await studioApi('/api/game/placements')).removals.some((r) => r.key === 'bld:pharmacie'));
    await admin.screenshot({ path: fileURLToPath(new URL('./screenshots/carte-01-atelier.png', import.meta.url)) });
    // objets, véhicule et surface par l'API (mêmes règles)
    const assets = (await studioApi('/api/game/placements')).assets;
    const id = (t) => assets.find((a) => a.technical_name === t)?.id;
    await studioApi('/api/game/placements', 'POST', { asset_id: id('kit-manguier'), x: 33, y: 8 });
    await studioApi('/api/game/placements', 'POST', { asset_id: id('taxi-compteur'), x: 13, y: 8, facing: 'S' });
    await studioApi('/api/game/placements', 'POST', { asset_id: id('pelouse'), x: 54, y: 8, w: 6, h: 3 });
    await admin.close();
    await wait(3000); // cache du pack côté jeu

    // 2. Jeu : le bâtiment est dans la ville, solide, avec sa fiche et sa porte
    await s.signUp();
    await page.fill('#char-name', 'Visiteur');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 30000 });
    await page.evaluate(() => window.__babi.world.loadZone('quartier', { pos: { x: 27.5 * 32, y: 11.5 * 32 } }));
    await s.waitZone('quartier');
    const inCity = await page.evaluate((pid) => {
      const w = window.__babi.world;
      const b = w.zone.buildings.find((x) => x.id === pid);
      return {
        building: !!b, rendered: w.buildings.length, solid: b ? !!w.grid.solid[b.y0 * w.grid.w + b.x0] : false,
        selectable: w.selectables.some((x) => x.id === `bld_${pid}`),
        props: w.zone.props.filter((d) => d.kind?.startsWith('atl_')).map((d) => d.kind),
        skipped: w.zone.atelier?.skipped || [],
        door: w.zone.interactables.find((i) => i.id === `door_${pid}`)?.target?.zone || null,
        pharmacie: w.zone.buildings.some((x) => x.id === 'pharmacie'), freed: !w.grid.solid[24 * w.grid.w + 28],
        epicerie: w.zone.buildings.some((x) => x.id === 'epicerie'),
      };
    }, shop.id);
    check('Jeu : le bâtiment placé apparaît dans la ville', inCity.building && inCity.solid, JSON.stringify(inCity));
    check('Jeu : il a une fiche (sélection)', inCity.selectable);
    check('Jeu : objet, véhicule et surface présents', ['atl_prop', 'atl_vehicle', 'atl_surface'].every((k) => inCity.props.includes(k)), inCity.props.join(','));
    check('Jeu : aucun placement ignoré', !inCity.skipped.length, JSON.stringify(inCity.skipped));
    check("Jeu : la pharmacie retirée n'est plus dans la ville (place libre)", !inCity.pharmacie && inCity.freed);
    check("Jeu : l'épicerie est toujours là", inCity.epicerie);
    await page.evaluate(() => {
      const r = window.__babi.rig;
      r.setFree(true); r.goal.target.set(29, 0.5, 10); r.goal.dist = 11; r.goal.yaw = 0.5;
    });
    await wait(2500);
    await s.shot('02-ville');

    // 3. Entrer dans le bâtiment (intérieur associé dans l'atelier)
    if (inCity.door) {
      await page.evaluate((pid) => { const p = window.__babi.stand(`door_${pid}`); window.__babi.goTo(p.x, p.y); }, shop.id);
      await page.waitForFunction(() => /^Entrer/.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
      check('Jeu : la porte propose d’entrer', /^Entrer/.test(await s.prompt() || ''), await s.prompt());
      await s.interact();
      await s.waitZone(inCity.door);
      check('Jeu : intérieur du bâtiment ouvert', (await s.player()).zone === inCity.door);
      await s.shot('03-interieur');
    } else {
      check('Jeu : bâtiment sans intérieur (fiche seulement)', true);
    }
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
