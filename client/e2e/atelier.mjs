// Scénario 7 — contenu de l'atelier d'assets dans le jeu : garde-robe de création, habitants à la place des PNJ
// et en promenade, intérieur de la maison choisi dans l'atelier.
// Prérequis : backend lancé avec ATELIER_URL vers un atelier démarré. Avec E2E_STUDIO_URL (un atelier de TEST :
// ses réglages sont modifiés et ses habitants brouillons publiés), le scénario choisit lui-même la maison.
import { session } from './lib.mjs';

const STUDIO = process.env.E2E_STUDIO_URL;

async function configureStudio() {
  const login = await fetch(`${STUDIO}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin' }) });
  const { token } = await login.json();
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const view = await (await fetch(`${STUDIO}/api/game/settings`, { headers: h })).json();
  const home = view.interiors.find((i) => i.technical_name === 'interieur-studio-base');
  await fetch(`${STUDIO}/api/game/settings`, { method: 'PUT', headers: h, body: JSON.stringify({ home_interior: home.id, extra_inhabitants: true }) });
  await fetch(`${STUDIO}/api/game/publish-inhabitants`, { method: 'POST', headers: h, body: '{}' });
  return home;
}

export async function run() {
  const s = await session('atelier');
  const { page, check, wait } = s;
  try {
    const home = STUDIO ? await configureStudio() : null;
    if (STUDIO) await wait(3000); // cache du pack côté jeu
    await s.signUp();
    const pack = await page.evaluate(() => fetch('/api/atelier/pack').then((r) => r.json()).then((r) => r.pack));
    check("Pack de l'atelier servi par le jeu", !!pack, pack ? `révision ${pack.revision}` : 'aucun pack');
    if (!pack) return await s.finish();

    // 1. Création : garde-robe de l'atelier
    check('Création : choix de la garde-robe de l’atelier', await page.isVisible('#btn-random-look'));
    const labels = await page.$$eval('.wardrobe > label', (els) => els.map((e) => e.textContent));
    check('Création : silhouette, peau, coiffure, haut, bas, chaussures',
      ['Silhouette', 'Peau', 'Coiffure', 'Haut', 'Bas', 'Chaussures'].every((l) => labels.includes(l)), labels.join(', '));
    const src1 = await page.getAttribute('.preview-svg', 'src');
    await page.click('#btn-random-look');
    await page.locator('.wardrobe label:text-is("Coiffure") + .chips .chip').nth(2).click(); // une autre coiffure
    const src2 = await page.getAttribute('.preview-svg', 'src');
    check('Création : l’aperçu SVG suit les choix', src1.startsWith('data:image/svg+xml') && src1 !== src2);
    await s.shot('01-creation');
    await page.fill('#char-name', 'Mariam');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 20000 });
    await wait(1500);
    const look = (await s.state()).character.appearance;
    check('Apparence de l’atelier enregistrée par le serveur', !!look.studio?.layers?.top && !!look.studio?.layers?.bottom, JSON.stringify(Object.keys(look.studio?.layers || {})));

    // 2. Maison : intérieur choisi dans l'atelier
    const zone = await page.evaluate(() => ({ id: window.__babi.world.zoneId, name: window.__babi.world.zone.name, sprite: !!window.__babi.world.player.model.userData.puppet }));
    check('Le joueur apparaît chez lui', zone.id === 'maison', zone.id);
    check('Personnage du joueur dessiné avec ses composants', zone.sprite);
    if (pack.home) check('Maison : intérieur de l’atelier', zone.name === pack.home.name, zone.name);
    if (home) check('Maison : celui choisi dans l’atelier', pack.home?.asset_id === home.id || zone.name === pack.home?.name);
    await s.shot('02-maison');
    const energy = (await s.state()).character.energy;
    await page.evaluate(() => { const p = window.__babi.stand('lit'); window.__babi.goTo(p.x, p.y); });
    // Marche articulée : pendant le trajet, jambes et bras pivotent en opposition.
    const swing = await page.evaluate(async () => {
      const { joints } = window.__babi.world.player.model.userData.puppet;
      let legs = 0; let opposed = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 50));
        legs = Math.max(legs, Math.abs(joints.legL.rotation.z));
        if (joints.legL.rotation.z * joints.legR.rotation.z < 0 && joints.legL.rotation.z * joints.armL.rotation.z < 0) opposed = true;
      }
      return { legs, opposed };
    });
    check('Marche : jambes et bras se balancent en opposition', swing.legs > 0.1 && swing.opposed, JSON.stringify(swing));
    await page.waitForFunction(() => window.__babi.prompt() === 'Faire une sieste', null, { timeout: 20000 }).catch(() => {});
    check('Maison : le lit de l’atelier propose la sieste', (await s.prompt()) === 'Faire une sieste', await s.prompt());
    await s.interact();
    await page.waitForFunction((e) => window.__babi.store.state.character.energy > e, energy, { timeout: 8000 }).catch(() => {});
    check('Maison : la sieste fonctionne', (await s.state()).character.energy > energy);
    // Vues : de face, de profil et de dos selon le cap du personnage par rapport à la caméra.
    const views = await page.evaluate(async () => {
      const w = window.__babi.world;
      const m = w.player.model;
      const seen = [];
      for (const k of [0, 1, 2, 3]) {
        await new Promise((r) => setTimeout(r, 300));
        const yaw = Math.atan2(w.rig.camera.position.x - m.position.x, w.rig.camera.position.z - m.position.z);
        const want = ['front', 'side', 'back', 'side'][k];
        const p = m.userData.puppet;
        // la vue de dos ou de profil est rastérisée à la première demande : on attend qu'elle s'affiche
        for (let t = 0; t < 40 && p.view !== want; t++) {
          m.rotation.y = yaw + (k * Math.PI) / 2;
          await new Promise((r) => setTimeout(r, 50));
        }
        m.rotation.y = yaw + (k * Math.PI) / 2;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        seen.push(p.view + (p.mirror ? '<' : ''));
      }
      return seen;
    });
    check('Personnage vu de face, de profil et de dos quand il tourne', views.join(',') === 'front,side,back,side<', views.join(','));

    // 3. Ville : PNJ et habitants de l'atelier
    await page.evaluate(() => { const p = window.__babi.stand('sortie_maison'); window.__babi.goTo(p.x, p.y); });
    await page.waitForFunction(() => window.__babi.prompt() === 'Sortir', null, { timeout: 20000 }).catch(() => {});
    await s.interact();
    await s.waitZone('quartier');
    await wait(1500);
    const city = await page.evaluate(() => {
      const w = window.__babi.world;
      const npcs = w.npcs.map((n) => ({ id: n.id, sprite: !!n.model.userData.puppet, behavior: n.behavior.type }));
      const peds = w.ambient?.pedestrians.filter((p) => p.npc.model.userData.puppet).length ?? 0;
      return { npcs, peds };
    });
    const replaced = pack.inhabitants.filter((x) => x.npc && city.npcs.some((n) => n.id === x.npc));
    check('PNJ remplacés par les habitants de l’atelier',
      replaced.length > 0 && replaced.every((x) => city.npcs.find((n) => n.id === x.npc).sprite), `${replaced.length} PNJ`);
    const koffi = city.npcs.find((n) => n.id === 'koffi');
    check('Les PNJ gardent leur mobilité', koffi?.behavior === 'wander', koffi?.behavior);
    const roamers = city.npcs.filter((n) => n.id.startsWith('hab_'));
    check('Habitants sans PNJ : promeneurs en ville', pack.inhabitants.some((x) => x.roams) ? roamers.length > 0 && roamers.every((n) => n.behavior === 'wander') : true, `${roamers.length} promeneur(s)`);
    check('Passants : habitants de l’atelier', city.peds > 0, `${city.peds}`);
    if (roamers.length) {
      await page.evaluate((id) => window.__babi.actions.talk(id), roamers[0].id);
      await wait(400);
      check('On peut parler à un promeneur', await page.isVisible('.dialog, [role="dialog"]'));
    }
    // un promeneur se déplace
    if (roamers.length) {
      const before = await page.evaluate(() => window.__babi.world.npcs.filter((n) => n.id.startsWith('hab_')).map((n) => [n.x, n.y]));
      await wait(6000);
      const after = await page.evaluate(() => window.__babi.world.npcs.filter((n) => n.id.startsWith('hab_')).map((n) => [n.x, n.y]));
      check('Les promeneurs bougent', after.some(([x, y], i) => Math.hypot(x - before[i][0], y - before[i][1]) > 4));
    }
    await page.evaluate(() => window.__babi.rig.recenter());
    await wait(800);
    await s.shot('03-ville');

    // 4. Changer d'apparence après la création (Mon profil)
    const before = JSON.stringify((await s.state()).character.appearance);
    await page.evaluate(() => { window.__oldModel = window.__babi.world.player.model; });
    await page.click('button[data-nav="profile"]');
    await page.click('#btn-edit-look', { timeout: 10000 });
    await page.waitForSelector('#btn-save-look', { timeout: 10000 });
    check('Profil : la garde-robe reprend l’apparence actuelle',
      await page.evaluate(() => document.querySelectorAll('.wardrobe .chip.on').length >= 4));
    await page.click('#btn-random-look');
    await page.locator('.wardrobe label:text-is("Haut") + .chips .chip').nth(1).click();
    await page.click('#btn-save-look');
    await page.waitForFunction((b) => JSON.stringify(window.__babi.store.state.character.appearance) !== b, before, { timeout: 10000 }).catch(() => {});
    const after = (await s.state()).character.appearance;
    check('Profil : nouvelle apparence enregistrée', JSON.stringify(after) !== before && !!after.studio);
    check('Profil : le personnage change aussitôt dans le monde',
      await page.evaluate(() => window.__babi.world.player.model !== window.__oldModel && !!window.__babi.world.player.model.userData.puppet));
    await wait(800);
    await s.shot('04-nouvelle-apparence');
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
