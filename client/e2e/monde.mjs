// Scénario 10 — parcours vertical du monde multi-villes : dans l'atelier, l'administrateur crée une ville, une zone et
// une carte, importe un paysage GLB, le place, rend une boutique interactive (objet nommé du modèle) et trace une zone
// à la main, puis publie ; dans le jeu, le joueur prend le panneau de la Cité Akwaba, arrive sur la carte publiée,
// voit le paysage 3D, consulte la boutique, et rentre. Vérifie aussi : brouillon sans effet, désactivation d'un objet,
// données du joueur conservées, carte historique intacte.
// Prérequis : E2E_STUDIO_URL vers un atelier DE TEST (interface construite), backend lancé avec ATELIER_URL vers ce même
// atelier et un cache court (ATELIER_CACHE_S=1), client démarré.
import { fileURLToPath } from 'node:url';
import { boxGlb } from './glb.mjs';
import { session } from './lib.mjs';

const STUDIO = process.env.E2E_STUDIO_URL;
const SHOTS = (n) => fileURLToPath(new URL(`./screenshots/monde-${n}.png`, import.meta.url));
let studioToken = null;

async function studioApi(path, method = 'GET', body) {
  if (!studioToken) {
    const login = await fetch(`${STUDIO}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
    studioToken = (await login.json()).token;
  }
  const res = await fetch(`${STUDIO}${path}`, { method, headers: { Authorization: `Bearer ${studioToken}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return res.json();
}

/** Brouillon d'une carte de l'atelier, prêt à renvoyer (emprises recalculées par le serveur). */
async function draftOf(id) {
  const d = (await studioApi(`/api/game/maps/${id}`)).draft;
  d.landscapes = d.landscapes.map(({ footprint: _f, ...l }) => l);
  return d;
}

export async function run() {
  const s = await session('monde', { desktop: true });
  const { page, check, wait } = s;
  if (!STUDIO) { check('E2E_STUDIO_URL défini (atelier de test)', false); return s.finish(); }
  const sfx = Date.now().toString(36).slice(-5);
  const ids = { city: `ville_${sfx}`, district: `zone_${sfx}`, map: `marche_${sfx}` };
  const gamePack = async () => (await (await fetch(new URL('/api/atelier/pack', process.env.BASE_URL || 'http://localhost:5173'))).json()).pack;
  try {
    // Repartir d'un atelier de test sans autre carte publiée (une case d'accès ne sert qu'à une carte)
    for (const c of (await studioApi('/api/game/world')).cities) {
      for (const dd of c.districts) for (const m of dd.maps) if (m.status === 'published') await studioApi(`/api/game/maps/${m.id}/disable`, 'POST');
    }
    // ------------------------------------------------------------------ 1. Atelier
    const admin = await s.context.browser().newPage({ viewport: { width: 1400, height: 1100 } });
    admin.on('dialog', (d) => d.accept());
    await admin.goto(`${STUDIO}/`);
    await admin.fill('input[name=username]', 'admin');
    await admin.fill('input[name=password]', 'admin');
    await admin.click('button[type=submit]');
    await admin.waitForSelector('nav.nav', { timeout: 60000 });
    await admin.goto(`${STUDIO}/#/monde`);
    await admin.waitForSelector('#city-id', { timeout: 30000 });
    await admin.fill('#city-id', ids.city);
    await admin.fill('#city-name', `Abidjan Sud ${sfx}`);
    await admin.click('#city-create');
    await admin.waitForSelector(`[data-city="${ids.city}"]`, { timeout: 15000 });
    await admin.selectOption('#district-city', ids.city);
    await admin.fill('#district-id', ids.district);
    await admin.fill('#district-name', 'Treichville');
    await admin.click('#district-create');
    await admin.waitForSelector(`[data-district="${ids.district}"]`, { timeout: 15000 });
    check('Atelier : ville et zone créées', true);
    await admin.selectOption('#map-district', ids.district);
    await admin.fill('#map-id', ids.map);
    await admin.fill('#map-name', 'Marché de Treichville');
    await admin.fill('#map-width', '20');
    await admin.fill('#map-height', '16');
    await admin.selectOption('#map-ground', 'paving');
    await admin.click('#map-create');
    await admin.waitForSelector('#map-canvas', { timeout: 15000 });
    check('Atelier : carte créée, éditeur ouvert', admin.url().endsWith(`#/monde/carte/${ids.map}`), admin.url());

    // paysage GLB : import (vérifié par le serveur), puis instance placée
    const glb = boxGlb([['Boutique', [1, 1, 0.5], [2, 2, 1]], ['Mur', [4, 0.5, 0], [1, 1, 4]]]);
    await admin.setInputFiles('#land-file', { name: 'marche.glb', mimeType: 'model/gltf-binary', buffer: glb });
    await admin.waitForSelector('#land-upload-info >> text=Modèle valide', { timeout: 15000 });
    check('Atelier : GLB importé et analysé (objets nommés)', (await admin.textContent('#land-upload-info')).includes('Boutique, Mur'));
    await admin.setInputFiles('#land-file', { name: 'faux.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('glTF pas vraiment') });
    await admin.waitForSelector('#land-upload-info >> text=Fichier refusé', { timeout: 15000 });
    check('Atelier : fichier corrompu refusé avec sa raison', true, await admin.textContent('#land-upload-info'));
    await admin.selectOption('#land-media', { index: 0 });
    await admin.click('#land-add');
    const land = admin.locator('[data-land="paysage_1"]');
    await land.locator('[data-k="x"]').fill('6');
    await land.locator('[data-k="z"]').fill('6');

    // boutique : zone déduite de l'objet « Boutique » du modèle
    await admin.click('#it-add');
    let it = admin.locator('[data-it="objet_1"]');
    await it.locator('[data-k="name"]').fill("Boutique d'Awa");
    await it.locator('[data-k="landscape"]').selectOption('paysage_1');
    it = admin.locator('[data-it="objet_1"]');
    await it.locator('[data-k="node"]').selectOption('Boutique');
    it = admin.locator('[data-it="objet_1"]');
    await it.locator('[data-k="label"]').fill('Regarder la boutique');
    await it.locator('[data-k="text"]').fill('Pagnes et wax du marché de Treichville.');
    // sortie : passage vers la Cité Akwaba
    await admin.click('#it-add');
    it = admin.locator('[data-it="objet_2"]');
    await it.locator('[data-k="name"]').fill('Retour à la Cité Akwaba');
    await it.locator('[data-k="type"]').selectOption('door');
    it = admin.locator('[data-it="objet_2"]');
    for (const [k, v] of [['x', '10'], ['y', '14'], ['w', '1'], ['h', '1']]) await it.locator(`[data-k="area.${k}"]`).fill(v);
    await it.locator('[data-k="label"]').fill('Rentrer à la Cité Akwaba');
    // étal : zone tracée à la main sur l'aperçu (objet non individualisé)
    await admin.click('#it-add');
    it = admin.locator('[data-it="objet_3"]');
    await it.locator('[data-k="name"]').fill('Étal de fruits');
    await it.locator('[data-k="type"]').selectOption('info');
    it = admin.locator('[data-it="objet_3"]');
    await it.locator('[data-k="text"]').fill('Mangues et ananas.');
    await admin.locator('#map-canvas').scrollIntoViewIfNeeded();
    const box = await admin.locator('#map-canvas').boundingBox();
    const cell = (x, y) => [box.x + (x + 0.5) * (box.width / 20), box.y + (y + 0.5) * (box.height / 16)];
    await admin.mouse.move(...cell(14, 10));
    await admin.mouse.down();
    await admin.mouse.move(...cell(15, 10), { steps: 4 });
    await admin.mouse.up();
    await admin.fill('#spawn-x', '10');
    await admin.fill('#spawn-y', '13');
    await admin.fill('#entr-x', '42');
    await admin.fill('#entr-y', '39');
    await admin.fill('#entr-label', '→ TREICHVILLE');
    // enregistrement : réponse du serveur, puis éditeur rechargé avec le brouillon tel qu'il l'a enregistré
    const reloaded = admin.waitForResponse((r) => r.url().endsWith(`/api/game/maps/${ids.map}`) && r.request().method() === 'GET', { timeout: 20000 });
    await Promise.all([admin.waitForResponse((r) => r.url().endsWith('/draft') && r.request().method() === 'PUT'), admin.click('#map-save')]);
    await reloaded;
    await admin.waitForTimeout(500);
    check('Atelier : brouillon enregistré sans problème', (await admin.textContent('#map-issues')).includes('Aucun problème'), await admin.textContent('#map-issues'));
    const saved = (await studioApi(`/api/game/maps/${ids.map}`)).draft;
    const byId = Object.fromEntries(saved.interactives.map((i) => [i.id, i]));
    check('Atelier : emprise du paysage calculée', JSON.stringify(saved.landscapes[0].footprint) === JSON.stringify({ x: 6, y: 4, w: 5, h: 4 }), JSON.stringify(saved.landscapes[0]));
    check('Atelier : zone de la boutique déduite de l’objet du modèle', JSON.stringify(byId.objet_1.area) === JSON.stringify({ x: 6, y: 6, w: 2, h: 1 }), JSON.stringify(byId.objet_1));
    check('Atelier : zone de l’étal tracée à la main', JSON.stringify(byId.objet_3.area) === JSON.stringify({ x: 14, y: 10, w: 2, h: 1 }), JSON.stringify(byId.objet_3.area));
    await wait(2500);
    check('Brouillon : absent du jeu avant publication', !((await gamePack())?.maps || []).some((m) => m.id === ids.map));
    await admin.screenshot({ path: SHOTS('01-atelier'), fullPage: true });
    await admin.click('#map-publish');
    await admin.click('.modal .btn-primary');
    await admin.waitForSelector('#map-publish >> text=Publier une nouvelle version', { timeout: 15000 });
    check('Atelier : carte publiée (version 1)', (await studioApi(`/api/game/maps/${ids.map}`)).published_version === 1);
    await wait(2500); // cache du pack côté jeu

    // ------------------------------------------------------------------ 2. Jeu
    await s.signUp();
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 30000 });
    const balance0 = (await s.state()).character.balance;
    const sign = await page.evaluate((mid) => ({
      door: window.__babi.world.zoneById('quartier').interactables.find((i) => i.id === `vers_${mid}`) || null,
      skipped: window.__babi.world.zoneById('quartier').atelier?.entrances || [],
    }), ids.map);
    check('Jeu : panneau d’accès dans la Cité Akwaba', !!sign.door && sign.door.tile.join(',') === '42,39', JSON.stringify(sign));
    await page.evaluate(() => window.__babi.actions.enterDoor({ zone: 'quartier', spawn: 'from_maison' }));
    await s.waitZone('quartier');
    await page.waitForFunction(() => window.__babi.perf().prefetched.length > 0, null, { timeout: 10000 }).catch(() => {});
    const pre = await page.evaluate(() => window.__babi.perf());
    check('Optimisation : modèle du marché préchargé depuis la ville (sans être analysé)', pre.prefetched.some((u) => u.startsWith('/api/atelier/models/')) && pre.models.loaded === 0, JSON.stringify(pre.prefetched));
    await page.evaluate((mid) => { const p = window.__babi.stand(`vers_${mid}`); window.__babi.goTo(p.x, p.y); }, ids.map);
    await page.waitForFunction(() => /^Aller/.test(window.__babi.prompt() || ''), null, { timeout: 30000 }).catch(() => {});
    check('Jeu : le panneau propose d’aller au marché', /^Aller : Marché de Treichville/.test(await s.prompt() || ''), await s.prompt());
    await s.interact();
    await s.waitZone(ids.map);
    await page.waitForFunction(() => window.__babi.world.landscapes?.status.loaded + window.__babi.world.landscapes?.status.failed >= 1, null, { timeout: 20000 }).catch(() => {});
    const inMap = await page.evaluate(() => {
      const w = window.__babi.world;
      const holder = w.landscapes?.group.getObjectByName('landscape:paysage_1');
      let meshes = 0;
      holder?.traverse((o) => { if (o.isMesh && !o.userData.placeholder) meshes++; });
      const p = w.player.body;
      return {
        map: window.__babi.map(), status: w.landscapes && { loaded: w.landscapes.status.loaded, failed: w.landscapes.status.failed },
        meshes, pos: holder?.position.toArray(), solid: !!w.grid.solid[4 * w.grid.w + 6], tile: [Math.floor(p.x / 32), Math.floor(p.y / 32)],
        free: !w.grid.solid[Math.floor(p.y / 32) * w.grid.w + Math.floor(p.x / 32)],
        ids: w.zone.interactables.map((i) => i.id),
      };
    });
    check('Jeu : carte publiée chargée (ville et zone de l’atelier)', inMap.map?.id === ids.map && inMap.map?.city === ids.city && inMap.map?.district === ids.district, JSON.stringify(inMap.map));
    check('Jeu : paysage GLB chargé et placé', inMap.status?.loaded === 1 && inMap.meshes === 2 && inMap.pos?.join(',') === '6,0,6', JSON.stringify(inMap));
    check('Jeu : emprise du paysage infranchissable', inMap.solid);
    check('Jeu : arrivée sur une case libre', inMap.free && inMap.tile.join(',') === '10,13', inMap.tile.join(','));
    check('Jeu : objets interactifs de la carte', ['objet_1', 'objet_2', 'objet_3'].every((i) => inMap.ids.includes(i)), inMap.ids.join(','));
    const server = await page.evaluate(async () => (await (await fetch('/api/state', { headers: { Authorization: `Bearer ${localStorage.getItem('babiverse.token')}` } })).json()).state);
    check('Serveur : position enregistrée sur la nouvelle carte', server.character.zone === ids.map, server.character.zone);
    check('Données du joueur conservées (solde)', server.character.balance === balance0, `${balance0} → ${server.character.balance}`);
    await page.evaluate(() => { const r = window.__babi.rig; r.setFree(true); r.goal.target.set(9, 0.5, 8); r.goal.dist = 13; r.goal.yaw = 0.6; });
    await wait(2000);
    await s.shot('02-carte');

    // boutique : invite, puis fiche avec son texte
    await page.evaluate(() => { const p = window.__babi.stand('objet_1'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => /boutique/i.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
    check('Jeu : la boutique propose une action', (await s.prompt()) === 'Regarder la boutique', await s.prompt());
    await s.interact();
    await page.waitForFunction(() => document.querySelector('#sheet')?.textContent.includes('Pagnes'), null, { timeout: 10000 }).catch(() => {});
    check('Jeu : fiche de la boutique ouverte', ((await page.textContent('#sheet').catch(() => '')) || '').includes('Pagnes et wax'));
    await s.shot('03-boutique');
    await page.keyboard.press('Escape');

    // brouillon modifié sans publication : rien ne change dans le jeu ; publication : l'étal est désactivé
    const d = (await studioApi(`/api/game/maps/${ids.map}`)).draft;
    d.interactives.find((i) => i.id === 'objet_3').active = false;
    d.landscapes = d.landscapes.map(({ footprint: _f, ...l }) => l);
    await studioApi(`/api/game/maps/${ids.map}/draft`, 'PUT', d);
    await wait(2500);
    await page.reload();
    await page.waitForFunction((mid) => window.__babi?.player()?.zone === mid, ids.map, { timeout: 30000 });
    check('Jeu : retour sur la carte au rechargement (position sauvegardée)', true);
    check('Brouillon non publié : l’étal reste actif dans le jeu', await page.evaluate(() => window.__babi.world.zone.interactables.some((i) => i.id === 'objet_3')));
    await studioApi(`/api/game/maps/${ids.map}/publish`, 'POST', { note: 'Étal fermé' });
    await wait(2500);
    await page.reload();
    await page.waitForFunction((mid) => window.__babi?.player()?.zone === mid, ids.map, { timeout: 30000 });
    await page.waitForFunction(() => window.__babi.world.landscapes?.status.loaded === 1, null, { timeout: 20000 }).catch(() => {});
    const v2 = await page.evaluate(() => ({ ids: window.__babi.world.zone.interactables.map((i) => i.id), loaded: window.__babi.world.landscapes?.status.loaded, version: window.__babi.map()?.version }));
    check('Version 2 publiée : étal désactivé, paysage inchangé', !v2.ids.includes('objet_3') && v2.ids.includes('objet_1') && v2.loaded === 1 && v2.version === 2, JSON.stringify(v2));

    const perf = await page.evaluate(() => window.__babi.perf());
    check('Mesures : appels de dessin, triangles, temps de chargement des modèles', perf.drawCalls > 0 && perf.triangles > 0 && Object.keys(perf.models.timings).length === 1, JSON.stringify({ calls: perf.drawCalls, tris: perf.triangles, timings: perf.models.timings }));

    // ---------------------------------------------------------------- connexions : gbaka à condition, refus serveur
    const port = `port_${sfx}`;
    const market = await draftOf(ids.map);
    market.arrivals = [{ id: 'gare', x: 15, y: 13 }];
    await studioApi(`/api/game/maps/${ids.map}/draft`, 'PUT', market);
    await studioApi(`/api/game/maps/${ids.map}/publish`, 'POST', { note: 'Gare routière' });
    await studioApi('/api/game/maps', 'POST', { id: port, district_id: ids.district, name: 'Port-Bouët', width: 16, height: 12, ground: 'sand' });
    const portDraft = {
      width: 16, height: 12, ground: 'sand', spawn: [8, 9], landscapes: [], arrivals: [],
      interactives: [
        { id: 'gbaka', name: 'Gbaka pour Treichville', type: 'door', mode: 'transport', area: { x: 4, y: 4, w: 2, h: 1 },
          target: { zone: ids.map, spawn: 'gare' }, conditions: [{ type: 'min_balance', amount: 999999 }] },
        { id: 'retour', name: 'Retour', type: 'door', area: { x: 8, y: 10, w: 1, h: 1 }, target: { zone: 'quartier', spawn: `from_${port}` } },
      ],
      entrance: { zone: 'quartier', x: 42, y: 38, label: '→ PORT-BOUËT' },
    };
    const saved2 = await studioApi(`/api/game/maps/${port}/draft`, 'PUT', portDraft);
    check('Atelier : carte reliée par un gbaka à condition, sans problème', saved2.issues?.length === 0, JSON.stringify(saved2.issues || saved2));
    await studioApi(`/api/game/maps/${port}/publish`, 'POST', {});
    const graph = await studioApi('/api/game/connections');
    check('Atelier : graphe des connexions', graph.edges.some((e) => e.from === port && e.to === ids.map && e.spawn === 'gare' && e.mode === 'transport'));
    await wait(2500);
    // trajet réel (chaque passage est enregistré par le serveur) : marché → Cité Akwaba → Port-Bouët
    await page.reload();
    await page.waitForFunction((mid) => window.__babi?.player()?.zone === mid, ids.map, { timeout: 30000 });
    await page.evaluate(() => { const p = window.__babi.stand('objet_2'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => /^Rentrer/.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
    await s.interact();
    await s.waitZone('quartier');
    await page.evaluate((pid) => { const p = window.__babi.stand(`vers_${pid}`); window.__babi.goTo(p.x, p.y); }, port);
    await page.waitForFunction(() => /Port-Bouët/.test(window.__babi.prompt() || ''), null, { timeout: 30000 }).catch(() => {});
    await s.interact();
    await s.waitZone(port);
    const gbaka = await page.evaluate(() => {
      const w = window.__babi.world;
      const it = w.zone.interactables.find((i) => i.id === 'gbaka');
      return { it, desc: w.zone.interactables.length };
    });
    await page.evaluate(() => { const p = window.__babi.stand('gbaka'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => /Gbaka/.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
    check('Jeu : passage en transport proposé', /Prendre : Gbaka pour Treichville/.test(await s.prompt() || ''), await s.prompt());
    await s.interact();
    await wait(1200);
    check('Jeu : condition non remplie, passage refusé', (await s.player()).zone === port, (await s.player()).zone);
    const serverZone = async () => page.evaluate(async () => (await (await fetch('/api/state', { headers: { Authorization: `Bearer ${localStorage.getItem('babiverse.token')}` } })).json()).state.character.zone);
    check('Serveur : arrivée à Port-Bouët enregistrée (par le panneau de la ville)', (await serverZone()) === port, await serverZone());
    const bypass = await page.evaluate(async (mid) => {
      const token = localStorage.getItem('babiverse.token');
      const res = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `bypass-${Date.now()}` },
        body: JSON.stringify({ pos: { zone: mid, x: 15.5 * 32, y: 13.5 * 32 } }) });
      const st = await (await fetch('/api/state', { headers: { Authorization: `Bearer ${token}` } })).json();
      return { status: res.status, zone: st.state.character.zone };
    }, ids.map);
    check('Serveur : contournement par requête directe refusé', bypass.zone === port, JSON.stringify(bypass));
    const portV2 = await draftOf(port);
    portV2.interactives[0].conditions = [{ type: 'min_balance', amount: 1000 }];
    await studioApi(`/api/game/maps/${port}/draft`, 'PUT', portV2);
    await studioApi(`/api/game/maps/${port}/publish`, 'POST', {});
    await wait(2500);
    await page.reload();
    await page.waitForFunction((pid) => window.__babi?.player()?.zone === pid, port, { timeout: 30000 });
    await page.evaluate(() => { const p = window.__babi.stand('gbaka'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => /Gbaka/.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
    await s.interact();
    await s.waitZone(ids.map);
    const atGare = await page.evaluate(() => { const p = window.__babi.world.player.body; return [Math.floor(p.x / 32), Math.floor(p.y / 32)]; });
    check('Jeu : condition remplie, arrivée au point « gare » du marché', atGare.join(',') === '15,13', atGare.join(','));
    check('Données du joueur conservées après le transport (aucun prélèvement)', (await s.state()).character.balance === balance0);

    // ---------------------------------------------------------------- versions : restauration depuis l'interface
    const editor = await s.context.browser().newPage({ viewport: { width: 1400, height: 1100 } });
    await editor.goto(`${STUDIO}/`);
    await editor.evaluate((t) => localStorage.setItem('babiverse.token', t), studioToken);
    await editor.goto(`${STUDIO}/#/monde/carte/${ids.map}`);
    await editor.reload(); // le jeton est lu au chargement de l'application
    await editor.waitForSelector('#map-versions', { timeout: 30000 });
    const activeBefore = (await studioApi(`/api/game/maps/${ids.map}`)).published_version;
    await editor.locator('[data-version="1"] button', { hasText: 'Restaurer dans le brouillon' }).click();
    await editor.waitForFunction(() => document.querySelector('#map-changes')?.textContent.includes('Point'), null, { timeout: 15000, polling: 250 }).catch(() => {});
    const restored = await studioApi(`/api/game/maps/${ids.map}`);
    check('Atelier : version 1 restaurée dans le brouillon, version active inchangée', restored.published_version === activeBefore && restored.draft_pending
      && restored.draft.interactives.some((i) => i.id === 'objet_3' && i.active !== false), JSON.stringify({ v: restored.published_version, changes: restored.changes }));
    check('Atelier : aperçu de ce que la publication changerait', (await editor.textContent('#map-changes')).includes('Objet interactif objet_3 modifié'), await editor.textContent('#map-changes'));
    await editor.screenshot({ path: SHOTS('04-versions'), fullPage: true });
    await editor.close();
    await studioApi(`/api/game/maps/${ids.map}/restore`, 'POST', { version: activeBefore }); // brouillon remis à la version active

    // retour à la Cité Akwaba par la porte de la carte
    await page.evaluate(() => { const p = window.__babi.stand('objet_2'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => /^Rentrer/.test(window.__babi.prompt() || ''), null, { timeout: 20000 }).catch(() => {});
    await s.interact();
    await s.waitZone('quartier');
    const back = await page.evaluate(() => {
      const w = window.__babi.world;
      const p = w.player.body;
      return { tile: [Math.floor(p.x / 32), Math.floor(p.y / 32)], size: [w.grid.w, w.grid.h], epicerie: w.zone.interactables.find((i) => i.id === 'door_epicerie')?.tile,
        buildings: w.zone.buildings.filter((b) => !('owner' in b)).length, models: w.landscapes };
    });
    check('Retour devant le panneau dans la Cité Akwaba', back.tile.join(',') === '42,40', back.tile.join(','));
    check('Carte historique intacte (taille, épicerie, bâtiments, aucun paysage)', back.size.join(',') === '108,105' && back.epicerie?.join(',') === '12,10' && back.buildings === 11 && back.models === null, JSON.stringify(back));
    check('Données du joueur conservées après l’aller-retour', (await s.state()).character.balance === balance0);

    // ---------------------------------------------------------------- erreurs : carte désactivée sous les pieds du joueur
    await page.evaluate((pid) => { const p = window.__babi.stand(`vers_${pid}`); window.__babi.goTo(p.x, p.y); }, port);
    await page.waitForFunction(() => /Port-Bouët/.test(window.__babi.prompt() || ''), null, { timeout: 30000 }).catch(() => {});
    await s.interact();
    await s.waitZone(port);
    await studioApi(`/api/game/maps/${port}/disable`, 'POST');
    await wait(2500);
    await page.reload();
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 30000 });
    const fallback = await page.evaluate(() => ({ zone: window.__babi.player().zone, toast: document.body.textContent.includes("n'est plus accessible") }));
    check('Erreur : carte désactivée → retour à la Cité Akwaba avec un message', fallback.zone === 'quartier' && fallback.toast, JSON.stringify(fallback));
    const tile = await page.evaluate(() => { const p = window.__babi.world.player.body; return [Math.floor(p.x / 32), Math.floor(p.y / 32)]; });
    check('Erreur : réapparition au point de départ de la ville', tile.join(',') === '6,12', tile.join(','));
    await page.evaluate((pid) => window.__babi.actions.enterDoor({ zone: pid, spawn: 'default' }), port);
    await wait(800);
    check('Erreur : porte vers une carte désactivée refusée sur place', (await s.player()).zone === 'quartier');
    await studioApi(`/api/game/maps/${port}/enable`, 'POST');
    await admin.close();
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
