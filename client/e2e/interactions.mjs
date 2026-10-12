// Scénario 4 — navigation, sélection et publicités (critères d'acceptation).
// Mobile (tactile, 360×740, CPU ×4) puis ordinateur (souris, pavé tactile simulé par la molette).
import { c, session, T } from './lib.mjs';

const AD_URL = 'https://example.com/garba-chez-adjoua';

/** Centre la vue libre sur un point (cases) et attend que la caméra se stabilise. */
async function look(s, x, z, { dist = 12, yaw = 0 } = {}) {
  await s.page.evaluate(([px, pz, d, y]) => {
    const r = window.__babi.rig;
    r.setFree(true);
    r.goal.target.set(px, 0.5, pz);
    r.goal.dist = d;
    r.goal.yaw = y;
    r.goal.tilt = 0;
  }, [x, z, dist, yaw]);
  // Caméra lissée : avec le CPU ralenti, la convergence prend plus de temps réel qu'à 60 images/s.
  await s.page.waitForFunction(() => {
    const r = window.__babi.rig;
    return r.cur.target.distanceTo(r.goal.target) < 0.01 && Math.abs(r.cur.dist - r.goal.dist) < 0.01
      && Math.abs(r.cur.pitch - r.pitchFor(r.goal.dist)) < 0.002 && Math.abs(Math.sin(r.cur.yaw - r.goal.yaw)) < 0.002;
  }, null, { timeout: 10000, polling: 100 }).catch(() => {});
  await s.wait(150);
}

/** Point écran d'un point du monde (cases, hauteur), vérifié : sur la carte, pas sous l'interface. */
async function aim(s, x, z, h = 0) {
  const p = await s.screenOf({ x: x * T, y: z * T }, h);
  const under = await s.page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.tagName, [p.x, p.y]);
  return { ...p, onCanvas: under === 'CANVAS' };
}

const sheet = (s) => s.page.evaluate(() => ({
  open: !document.getElementById('sheet').hidden,
  title: document.getElementById('sheet-title').textContent,
  modal: window.__babi.store.modalOpen,
}));
const moved = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const camTarget = (s) => s.page.evaluate(() => { const t = window.__babi.rig.goal.target; return { x: t.x, z: t.z, dist: window.__babi.rig.goal.dist }; });

async function mobile() {
  const s = await session('interactions-mobile');
  const { page, context, wait, check } = s;
  const buyRequests = [];
  page.on('request', (r) => { if (r.url().includes('/api/plots/buy')) buyRequests.push(r.url()); });
  await context.route('https://example.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Annonceur fictif</h1>' }));
  try {
    await s.createCharacter(`Ines${Date.now() % 100000}`, 'etudiant');

    // --- Logement : cliquer sur le sol fait marcher ----------------------------------------
    await look(s, 4.5, 4, { dist: 10 });
    const floor = await aim(s, 4.5, 5.5);
    check('Logement : le sol visé est touchable', floor.onCanvas, `${floor.x.toFixed(0)},${floor.y.toFixed(0)}`);
    await s.tap(floor);
    await page.waitForFunction(([x, y]) => { const p = window.__babi.player(); return Math.hypot(p.x - x, p.y - y) < 20; }, [c(4, 5).x, c(4, 5).y], { timeout: 10000 }).catch(() => {});
    let p = await s.player();
    check('Logement : toucher le sol déplace le personnage', moved(p, c(4, 5)) < 20, `${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    check('Logement : toucher le sol n\'ouvre aucune fiche', !(await sheet(s)).open);

    // --- Logement : cliquer sur un meuble affiche ses actions, sans en faire une destination ---
    // Cadré sur le lit : collé au mur ouest, il passerait sinon sous le panneau latéral gauche.
    await look(s, 3.5, 3, { dist: 10 });
    const before = await s.player();
    const bed = await aim(s, 2, 1.5, 0.4);
    check('Logement : le lit est touchable', bed.onCanvas, `${bed.x.toFixed(0)},${bed.y.toFixed(0)}`);
    await s.tap(bed);
    await wait(500);
    let sh = await sheet(s);
    p = await s.player();
    check('Meuble : la fiche du lit s\'ouvre', sh.open && sh.title === 'Lit', sh.title);
    check('Meuble : le lit n\'est pas une destination (aucun déplacement)', moved(p, before) < 2 && !(await page.evaluate(() => window.__babi.world.path)));
    check('Meuble : l\'action « sieste » est proposée', await page.isVisible('#sheet [data-action="rest"]'));
    await s.shot('01-meuble');

    // --- Fermer la fiche rend le contrôle -----------------------------------------------------
    await page.click('#selection-close');
    sh = await sheet(s);
    check('Fermeture : la fiche se ferme et le jeu reprend la main', !sh.open && !sh.modal);
    p = await s.hold({ x: 0, y: -1 }, 500);
    check('Fermeture : le personnage se déplace de nouveau', moved(p, before) > 10);

    // --- La porte : « Y aller : Sortir » --------------------------------------------------------
    await look(s, 4.5, 5, { dist: 10 });
    const door = await aim(s, 4.5, 7.5, 0.6);
    check('Logement : la porte est touchable', door.onCanvas, `${door.x.toFixed(0)},${door.y.toFixed(0)}`);
    await s.tap(door);
    await wait(400);
    check('Porte : sa fiche propose de sortir', await page.isVisible('#sheet [data-action="enter"]'));
    await page.click('#sheet [data-action="enter"]');
    // Marche jusqu'à la porte puis fondu : plus long que waitZone() avec le CPU ralenti.
    await page.waitForFunction(() => window.__babi.player()?.zone === 'quartier', null, { timeout: 15000 }).catch(() => {});
    await wait(400);
    check('Porte : « Sortir » mène dans la ville', (await s.player()).zone === 'quartier');

    // --- Ville : toucher un bâtiment fait entrer le joueur dans son intérieur -------------------
    await look(s, 12, 11);
    const epicerie = await aim(s, 12, 10, 0.6);
    await s.tap(epicerie);
    await page.waitForFunction(() => window.__babi.player()?.zone === 'epicerie', null, { timeout: 15000 }).catch(() => {});
    await wait(400);
    check('Bâtiment : un toucher fait entrer dans son intérieur', (await s.player()).zone === 'epicerie', (await s.player()).zone);
    check('Bâtiment : aucune fiche ouverte', !(await sheet(s)).open);
    // Retour en ville : on réapparaît devant la porte du bâtiment.
    await page.evaluate(() => { const w = window.__babi.world; w.transitionTo('quartier', w.citySpawn()); });
    await page.waitForFunction(() => window.__babi.player()?.zone === 'quartier', null, { timeout: 15000 }).catch(() => {});
    await wait(400);
    const start = await s.player();
    const front = await s.stand('door_epicerie');
    check('Bâtiment : la sortie ramène devant sa porte', moved(start, front) < 20, `${start.x.toFixed(0)},${start.y.toFixed(0)}`);

    // --- Ville : glisser déplace la caméra sans rien sélectionner -------------------------------
    const state = await s.state();
    const freePlot = ['P04', 'P05', 'P06', 'P07', 'P02', 'P03'].find((id) => !state.world.plots[id]);
    const plotDef = (await s.zoneData()).props.find((x) => x.kind === 'plot' && x.plot === freePlot);
    await look(s, plotDef.tile[0] + 2.5, plotDef.tile[1] + 2.5);
    const overPlot = await aim(s, plotDef.tile[0] + 2.5, plotDef.tile[1] + 2.5);
    const cam0 = await camTarget(s);
    await s.drag([overPlot], [{ x: overPlot.x + 110, y: overPlot.y + 60 }]);
    const cam1 = await camTarget(s);
    check('Glissement : la caméra se déplace', Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 0.5, `${cam0.x.toFixed(1)} -> ${cam1.x.toFixed(1)}`);
    check('Glissement : aucune parcelle sélectionnée', !(await sheet(s)).open);
    check('Glissement : le personnage ne bouge pas', moved(await s.player(), start) < 2);

    // --- Ville : après zoom et déplacement, un toucher bref sélectionne la parcelle -----------
    await page.click('#btn-zoom-in');
    await s.drag([{ x: 180, y: 380 }], [{ x: 140, y: 360 }]);
    await wait(1200);
    const plotPt = await aim(s, plotDef.tile[0] + 1.5, plotDef.tile[1] + 1.5, 0.05);
    check('Parcelle : visible et touchable après zoom et glissement', plotPt.onCanvas);
    await s.tap(plotPt);
    await wait(500);
    sh = await sheet(s);
    check('Parcelle : un toucher bref ouvre sa fiche', sh.title === `Parcelle ${freePlot}`, sh.title);
    const facts = await page.$$eval('#sheet .facts dt', (n) => n.map((x) => x.textContent));
    check('Parcelle disponible : identifiant, dimensions, catégorie, prix, conditions', ['Identifiant', 'Dimensions', 'Catégorie', 'Prix', 'Conditions'].every((f) => facts.includes(f)), facts.join(','));
    check('Parcelle : bouton « Acheter » désactivé faute de solde (4 000 F)', await page.isDisabled('#sheet [data-action="buy"]'));
    check('Parcelle : la sélection n\'envoie aucune transaction', buyRequests.length === 0);
    await s.shot('02-parcelle');
    await page.click('#selection-close');

    // --- Aucune transaction immobilière sans vérification serveur ------------------------------
    const balance = (await s.state()).character.balance;
    const forced = await page.evaluate(async (plot) => {
      const r = await fetch('/api/plots/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `e2e-force-${Date.now()}`, Authorization: `Bearer ${localStorage.getItem('babiverse.token')}` },
        body: JSON.stringify({ plot, pos: { zone: 'quartier', x: 100, y: 100 } }),
      });
      return { status: r.status, body: await r.json() };
    }, freePlot);
    check('Serveur : achat refusé sans solde suffisant', forced.status === 409 && forced.body.error.code === 'insufficient_funds', JSON.stringify(forced.body.error));
    check('Serveur : solde et parcelle inchangés', forced.body.state.character.balance === balance && !forced.body.state.world.plots[freePlot]);

    // Parcelle indisponible
    const p12 = (await s.zoneData()).props.find((x) => x.kind === 'plot' && x.plot === 'P12');
    await look(s, p12.tile[0] + 2.5, p12.tile[1] + 3);
    await s.tap(await aim(s, p12.tile[0] + 1.5, p12.tile[1] + 3.5, 0.05));
    await wait(500);
    check('Parcelle indisponible : motif affiché, pas de bouton Acheter',
      (await page.textContent('#sheet-subtitle')) === 'Non disponible' && !(await page.isVisible('#sheet [data-action="buy"]')));
    await page.click('#selection-close');

    // --- Publicité --------------------------------------------------------------------------
    await look(s, 16, 12.5, { dist: 9 });
    const camBefore = await camTarget(s);
    const posBefore = await s.player();
    const board = await aim(s, 16, 11.5, 1.75);
    check('Publicité : le panneau est touchable', board.onCanvas);
    await s.tap(board);
    await page.waitForSelector('#sheet img.ad-image', { timeout: 4000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelector('#sheet img.ad-image')?.complete, null, { timeout: 5000 }).catch(() => {});
    const img = await page.evaluate(() => {
      const i = document.querySelector('#sheet img.ad-image');
      if (!i) return null;
      const r = i.getBoundingClientRect();
      return { nw: i.naturalWidth, nh: i.naturalHeight, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
    });
    check('Publicité : la fiche affiche le visuel chargé', img && img.nw > 0, JSON.stringify(img));
    check('Publicité : visuel complet, proportions d\'origine', img && Math.abs(img.w / img.h - img.nw / img.nh) < 0.02 && img.right <= 360, JSON.stringify(img));
    check('Publicité : titre, mention « Publicité » et description', (await page.textContent('#sheet-title')) === 'Garba Chez Adjoua'
      && (await page.textContent('#sheet .badge.ad')) === 'Publicité' && (await page.textContent('#sheet .ad-description')).includes('Attiéké'));
    check('Publicité : bouton « En savoir plus »', (await page.textContent('#ad-more'))?.startsWith('En savoir plus'));
    const camAfter = await camTarget(s);
    check('Publicité : ni la caméra ni le personnage ne bougent', Math.hypot(camAfter.x - camBefore.x, camAfter.z - camBefore.z) < 0.01 && moved(await s.player(), posBefore) < 1);
    const buttons = await page.$$eval('#sheet button', (b) => b.map((x) => { const r = x.getBoundingClientRect(); return { h: r.height, bottom: r.bottom }; }));
    check('Smartphone : boutons de la fiche visibles et assez grands', buttons.every((b) => b.h >= 36 && b.bottom <= 740), JSON.stringify(buttons));
    await s.shot('03-publicite');
    const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 5000 }), page.click('#ad-more')]);
    await popup.waitForLoadState().catch(() => {});
    check('« En savoir plus » ouvre l\'URL prévue', popup.url() === AD_URL, popup.url());
    await popup.close();
    check('Le jeu reste ouvert derrière le lien', (await sheet(s)).open);
    await page.click('#ad-close');
    sh = await sheet(s);
    check('Fermeture de la publicité : retour au jeu', !sh.open && !sh.modal);
    p = await s.hold({ x: 1, y: 0 }, 400);
    check('Fermeture de la publicité : le personnage répond aux commandes', moved(p, posBefore) > 5);

    // Supports sans annonce de démonstration : libres, ou loués par un joueur (la base E2E garde
    // les locations des passages précédents du scénario « parcelles » pendant 3 jours).
    const rented = (await s.state()).world.ads;
    for (const slot of [{ id: 'pub_place', x: 36, z: 17.5 }, { id: 'pub_rue2', x: 29, z: 31.5 }]) {
      await look(s, slot.x, slot.z + 0.5, { dist: 9, yaw: Math.PI });
      await s.tap(await aim(s, slot.x, slot.z, 1.75));
      await wait(500);
      if (rented[slot.id]) {
        check(`Campagne d'un joueur (${slot.id}) : fiche publicitaire, sans lien externe`,
          (await page.textContent('#sheet-title')) === rented[slot.id].title && await page.isVisible('#sheet .ad-generated') && !(await page.isVisible('#ad-more')));
        await page.click('#ad-close');
      } else {
        check(`Support libre (${slot.id}) : fiche d'emplacement, pas d'annonce`, (await page.textContent('#sheet-title')) === 'Emplacement publicitaire libre' && !(await page.isVisible('#ad-more')));
        await page.click('#selection-close');
      }
    }

    // Totem (format portrait)
    await look(s, 29.5, 19.5, { dist: 8 });
    await s.tap(await aim(s, 29.5, 18.5, 1.0));
    await page.waitForFunction(() => document.querySelector('#sheet img.ad-image')?.complete, null, { timeout: 5000 }).catch(() => {});
    const totem = await page.evaluate(() => { const i = document.querySelector('#sheet img.ad-image'); const r = i?.getBoundingClientRect(); return i && { ratio: r.width / r.height, natural: i.naturalWidth / i.naturalHeight }; });
    check('Totem : visuel portrait affiché sans déformation', totem && totem.natural < 1 && Math.abs(totem.ratio - totem.natural) < 0.02, JSON.stringify(totem));
    await s.shot('04-totem');
    await page.click('#ad-close');
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}

async function desktop() {
  const s = await session('interactions-ordinateur', { desktop: true });
  const { page, wait, check } = s;
  try {
    await s.createCharacter(`Yann${Date.now() % 100000}`, 'salarie');
    await s.walkTo(c(4, 6));
    await page.keyboard.press('e');
    await s.waitZone('quartier');
    const start = await s.player();

    // Glisser à la souris au-dessus d'un bâtiment : la caméra bouge, rien n'est sélectionné.
    await look(s, 12.5, 11);
    const shop = await aim(s, 13, 10, 0.6);
    const cam0 = await camTarget(s);
    await page.mouse.move(shop.x, shop.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(shop.x + i * 15, shop.y + i * 6);
    await page.mouse.up();
    await wait(300);
    const cam1 = await camTarget(s);
    check('Souris : un glissement déplace la caméra', Math.hypot(cam1.x - cam0.x, cam1.z - cam0.z) > 0.5);
    check('Souris : un glissement ne sélectionne pas le bâtiment', !(await sheet(s)).open);

    // Clic avec un léger tremblement (sous le seuil) : c'est un clic, on entre dans le bâtiment.
    await look(s, 12, 11);
    const shop2 = await aim(s, 12, 10, 0.6);
    await page.mouse.move(shop2.x, shop2.y);
    await page.mouse.down();
    await page.mouse.move(shop2.x + 3, shop2.y + 2);
    await page.mouse.up();
    await page.waitForFunction(() => window.__babi.player()?.zone === 'epicerie', null, { timeout: 15000 }).catch(() => {});
    check('Souris : un clic sur un bâtiment fait entrer dedans', (await s.player()).zone === 'epicerie', (await s.player()).zone);
    await page.evaluate(() => { const w = window.__babi.world; w.transitionTo('quartier', w.citySpawn()); });
    await page.waitForFunction(() => window.__babi.player()?.zone === 'quartier', null, { timeout: 15000 }).catch(() => {});
    await wait(400);

    // Pavé tactile : pincer (molette + ctrl) zoome, défilement horizontal déplace la carte.
    const before = await camTarget(s);
    await page.evaluate(() => {
      const cv = document.querySelector('#game canvas');
      cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -60, ctrlKey: true, bubbles: true, cancelable: true }));
      cv.dispatchEvent(new WheelEvent('wheel', { deltaX: 80, deltaY: 0, bubbles: true, cancelable: true }));
    });
    const after = await camTarget(s);
    check('Pavé tactile : pincer zoome', after.dist < before.dist);
    check('Pavé tactile : défiler à deux doigts déplace la carte', Math.abs(after.x - before.x) + Math.abs(after.z - before.z) > 0.1);

    // Après zoom et déplacement, le clic vise toujours juste.
    await page.mouse.wheel(0, 300);
    await wait(1500);
    const pharmacie = (await s.zoneData()).buildings.find((b) => b.id === 'pharmacie');
    await look(s, pharmacie.x0 + 1, pharmacie.y1 + 1.5, { dist: 20, yaw: 0.6 });
    const ph = await aim(s, pharmacie.x0 + 1, pharmacie.y1 + 0.5, 0.6);
    await page.mouse.click(ph.x, ph.y);
    await page.waitForFunction(() => window.__babi.player()?.zone === 'int_pharmacie', null, { timeout: 15000 }).catch(() => {});
    await wait(600);
    check('Après zoom, rotation et glissement : le clic fait entrer dans le bon bâtiment', (await s.player()).zone === 'int_pharmacie', (await s.player()).zone);
    await s.shot('01-pharmacie');

    // Clavier dans l'intérieur : le personnage répond.
    const inside = await s.player();
    await page.keyboard.down('d');
    await wait(500);
    await page.keyboard.up('d');
    check("Clavier : le personnage se déplace dans l'intérieur", moved(await s.player(), inside) > 10);
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}

export async function run() {
  return (await mobile()) + (await desktop());
}
