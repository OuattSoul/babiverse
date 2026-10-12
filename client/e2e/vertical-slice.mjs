// Scénario 1 — tranche verticale obligatoire (étapes 1 à 17 du cahier des charges).
import { BASE, c, session, T } from './lib.mjs';

export async function run() {
  const s = await session('tranche');
  const { page, cdp, wait, check } = s;
  try {
    // 1-2. Lancement et création du personnage
    await page.goto(BASE);
    await page.waitForSelector('#login-form', { timeout: 15000 });
    await s.shot('00-connexion');
    await s.signUp();
    await s.shot('01-creation');
    await page.fill('#char-name', 'Kouadio');
    await page.click('[data-profile="etudiant"]');
    await page.click('#btn-start');
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 15000 });
    await wait(800);
    let p = await s.player();
    check('Création du personnage et apparition chez soi', p.zone === 'maison', JSON.stringify(p));
    check('HUD : solde de départ affiché', (await page.textContent('#hud-money')).replace(/\s/g, '') === '4000F');
    await s.shot('02-maison');

    // 8-10. Se déplacer dans le logement, faire une sieste
    const energyBefore = (await s.state()).character.energy;
    await s.walkTo(c(2, 2));
    check('Invite contextuelle près du lit', (await s.prompt()) === 'Faire une sieste');
    await s.interact();
    await page.waitForFunction((e) => window.__babi.store.state.character.energy > e, energyBefore, { timeout: 8000 }).catch(() => {});
    await wait(800);
    const energyAfter = (await s.state()).character.energy;
    check("Sieste : récupération d'énergie (+45, plafonnée à 100)", energyAfter >= Math.min(100, energyBefore + 40), `${energyBefore} -> ${energyAfter}`);
    await s.interact();
    await wait(300);
    check('Sieste : refusée pendant le temps de récupération', (await page.textContent('#prompt-label')).includes('Tu viens de te reposer'));

    // 11. Sortir du logement
    await s.walkTo(c(4, 6));
    await s.interact();
    await s.waitZone('quartier');
    p = await s.player();
    // « Chez moi » = ma maison du lotissement : on ressort devant sa porte.
    const homeId = await page.evaluate(() => window.__babi.world.playerBuildingList().find((b) => b.mine && b.home !== undefined)?.id);
    const front = await s.stand(homeId);
    check('Sortie : réapparition devant la porte de ma maison du lotissement', !!front && Math.hypot(p.x - front.x, p.y - front.y) < 4, JSON.stringify(p));
    const homeDoor = await page.evaluate((id) => window.__babi.world.dynamicInteractables.find((i) => i.id === id).tile, homeId);
    const zd = await s.zoneData();
    await s.shot('03-quartier');

    // 6. Collisions
    p = await s.hold({ x: 0, y: -1 }, 1200);
    const facadeBottom = (homeDoor[1] + 1) * T;
    check('Collision : la façade bloque le joueur', p.y >= facadeBottom + 5 - 0.01, `y=${p.y.toFixed(1)}`);
    const stand = zd.props.find((x) => x.kind === 'garba_stand').tile;
    await s.goto(c(stand[0] - 2, stand[1]));
    p = await s.hold({ x: 1, y: 0 }, 1500);
    check("Collision : l'étal de garba bloque le passage", p.x + 7 <= stand[0] * T + 0.01, `x=${p.x.toFixed(1)}`);
    await s.goto(c(1, 22));
    p = await s.hold({ x: -1, y: 0 }, 1500);
    check('Limites : le mur d\'enceinte arrête le joueur', p.x - 7 >= T - 0.01, `x=${p.x.toFixed(1)}`);

    // 4. Joystick tactile réel (zone fixe en bas à gauche)
    await s.goto(c(8, 22));
    const before = await s.player();
    const jz = await page.evaluate(() => { const r = document.getElementById('joystick-zone').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [jz] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: jz.x + i * 9, y: jz.y }] });
      await wait(30);
    }
    await wait(900);
    await s.shot('04-joystick');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(150);
    const after = await s.player();
    check('Joystick tactile : le personnage se déplace', Math.hypot(after.x - before.x, after.y - before.y) > 40, `${before.x.toFixed(0)} -> ${after.x.toFixed(0)}`);

    // Caméra 3D : zoom, rotation, navigation libre, recentrage
    const rig = () => page.evaluate(() => { const r = window.__babi.rig; return { dist: r.goal.dist, yaw: r.goal.yaw, free: r.free, tx: r.goal.target.x }; });
    let r0 = await rig();
    await page.click('#btn-zoom-in');
    check('Caméra : bouton zoom avant', (await rig()).dist < r0.dist);
    r0 = await rig();
    await page.click('#btn-rot-left');
    check('Caméra : bouton de rotation (45°)', Math.abs((await rig()).yaw - r0.yaw - Math.PI / 4) < 1e-6);
    r0 = await rig();
    await s.drag([{ x: 120, y: 330 }, { x: 240, y: 330 }], [{ x: 60, y: 330 }, { x: 300, y: 330 }]);
    check('Caméra : pincer à deux doigts pour zoomer', (await rig()).dist < r0.dist - 0.5, `${r0.dist.toFixed(1)} -> ${(await rig()).dist.toFixed(1)}`);
    r0 = await rig();
    await s.drag([{ x: 120, y: 300 }, { x: 240, y: 300 }], [{ x: 140, y: 240 }, { x: 220, y: 360 }]);
    check('Caméra : tourner à deux doigts pour pivoter', Math.abs((await rig()).yaw - r0.yaw) > 0.3);
    r0 = await rig();
    await s.drag([{ x: 180, y: 420 }], [{ x: 300, y: 420 }]);
    let r1 = await rig();
    check('Navigation libre : glisser un doigt déplace la vue', r1.free && Math.abs(r1.tx - r0.tx) > 0.5);
    check('Navigation libre : bouton « Revenir à mon personnage » visible', await page.isVisible('#btn-recenter'));
    await s.shot('05-vue-libre');
    await page.click('#btn-recenter');
    check('Recentrage sur le joueur', !(await rig()).free && !(await page.isVisible('#btn-recenter')));
    await page.click('#btn-compass');
    await wait(1800); // laisser la caméra se stabiliser avant de viser

    // Toucher le sol de la ville : rien ne se passe (la ville se parcourt avec la caméra et le joystick)
    // Destination visible à l'écran (près du joueur) et hors de la zone où flâne Tonton Koffi.
    await s.goto(c(14, 12));
    // Caméra par défaut (le test de pincement l'a laissée très zoomée).
    await page.evaluate(() => { const g = window.__babi.rig.goal; g.dist = 17; g.yaw = 0; g.tilt = 0; });
    await wait(1800);
    const dest = c(13, 14);
    // Le point doit tomber sur la carte, loin du joystick, des boutons et de l'invite.
    const ds = await s.screenOf(dest);
    check("Toucher le sol : la destination est sur la carte, loin du joystick et des boutons", ds.x > 40 && ds.x < 300 && ds.y > 200 && ds.y < 560, `${ds.x.toFixed(0)},${ds.y.toFixed(0)}`);
    const destScreen = await s.screenOf(dest);
    const beforeTap = await s.player();
    await s.tap(destScreen);
    await wait(1200);
    p = await s.player();
    check('Ville : toucher le sol ne déplace pas le personnage', Math.hypot(p.x - beforeTap.x, p.y - beforeTap.y) < 2 && !(await page.evaluate(() => window.__babi.world.path)), `${p.x.toFixed(0)},${p.y.toFixed(0)}`);

    // Interaction trop lointaine : rien ne se passe
    const epicerieFront = await s.stand('door_epicerie');
    await s.goto({ x: epicerieFront.x, y: epicerieFront.y + 3 * T });
    check("Pas d'invite quand la porte est trop loin", (await s.prompt()) !== "Entrer à l'épicerie");

    // 12-15. Épicerie : entrer, parler au commerçant, acheter
    await wait(900);
    // Toucher l'épicerie : fondu, puis le personnage est à l'intérieur (sans marcher jusqu'à la porte).
    const doorTile = zd.interactables.find((i) => i.id === 'door_epicerie').tile;
    // On centre la vue sur la porte (vue libre), comme le ferait un joueur avant de la toucher.
    await page.evaluate(([x, z]) => { const r = window.__babi.rig; r.setFree(true); r.goal.target.set(x, 0.5, z); }, [doorTile[0] + 0.5, doorTile[1] + 1]);
    await wait(1500);
    const doorScreen = await s.screenOf({ x: c(...doorTile).x, y: c(...doorTile).y + 16 }, 0.6);
    const under = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName, [doorScreen.x, doorScreen.y]);
    check("La porte est visible et touchable (pas sous l'interface)", under === 'CANVAS', `${doorScreen.x.toFixed(0)},${doorScreen.y.toFixed(0)} ${under}`);
    await s.tap(doorScreen);
    await s.waitZone('epicerie').catch(() => {});
    check("Toucher l'épicerie : le joueur est aussitôt à l'intérieur", (await s.player()).zone === 'epicerie', (await s.player()).zone);
    if ((await s.player()).zone !== 'epicerie') { await s.goto(epicerieFront); await s.interact(); await s.waitZone('epicerie'); }
    await s.path(c(2, 7), c(2, 5));
    check('Invite près du commerçant (au-dessus du comptoir)', (await s.prompt()) === 'Parler à M. Fofana');
    await s.interact();
    await page.click('text=Voir les produits');
    await wait(300);
    await s.shot('06-boutique');
    const balBefore = (await s.state()).character.balance;
    const painBefore = (await s.state()).inventory.pain || 0;
    await page.click('[data-item="pain"] button.buy');
    await page.waitForFunction((b) => window.__babi.store.state.character.balance < b, balBefore, { timeout: 5000 });
    let st = await s.state();
    check('Achat : solde diminué du prix', st.character.balance === balBefore - 150, `${balBefore} -> ${st.character.balance}`);
    check("Achat : produit ajouté à l'inventaire", (st.inventory.pain || 0) === painBefore + 1);
    check('Achat : stock du commerce diminué', st.shops.epicerie.pain === 19);
    check('Achat : solde affiché mis à jour', (await page.textContent('#shop-balance')).replace(/\s/g, '') === `${st.character.balance.toLocaleString('fr-FR')}F`.replace(/\s/g, ''));

    // 16. Achat refusé faute de solde (3 casiers = 5 400 F)
    await page.click('[data-item="casier_boissons"] [aria-label="plus"]');
    await page.click('[data-item="casier_boissons"] [aria-label="plus"]');
    await page.click('[data-item="casier_boissons"] button.buy');
    await page.waitForSelector('.toast.error', { timeout: 5000 });
    const toast = await page.textContent('.toast.error');
    st = await s.state();
    check('Achat refusé si solde insuffisant', toast.includes('Solde insuffisant') && st.character.balance === balBefore - 150, toast);
    check('Refus : inventaire et stock inchangés', !st.inventory.casier_boissons && st.shops.epicerie.casier_boissons === 5);
    await s.shot('07-refus');
    await page.click('#sheet-close');

    // Consommer le pain depuis le sac
    const hungerBefore = st.character.hunger;
    await page.click('#btn-bag');
    await page.click('[data-item="pain"] button');
    await page.waitForFunction((h) => window.__babi.store.state.character.hunger < h, hungerBefore, { timeout: 5000 });
    check('Consommation : la faim diminue', (await s.state()).character.hunger < hungerBefore);
    await page.click('#sheet-close');

    // 17. Quitter et revenir : progression restaurée
    await s.walkTo(c(4, 6));
    const saved = await s.state();
    // Fermeture de l'onglet : la sauvegarde part via « pagehide » (fetch keepalive).
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await wait(800);
    await page.reload();
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 15000 });
    await wait(800);
    p = await s.player();
    st = await s.state();
    check('Reconnexion : zone restaurée (épicerie)', p.zone === 'epicerie', JSON.stringify(p));
    check('Reconnexion : position restaurée', Math.hypot(p.x - c(4, 6).x, p.y - c(4, 6).y) < 6, `${p.x.toFixed(0)},${p.y.toFixed(0)}`);
    check('Reconnexion : solde et inventaire conservés',
      st.character.balance === saved.character.balance && JSON.stringify(st.inventory) === JSON.stringify(saved.inventory));
    await s.shot('08-reconnexion');

    // Fluidité en régime établi : on laisse passer la phase de démarrage (compilation des shaders,
    // envoi des textures au GPU), puis médiane de 3 mesures d'une seconde en marchant.
    await wait(4000);
    await page.evaluate(() => { window.__babi.touchInput.forced = { x: 1, y: 0.3 }; });
    const samples = [];
    for (let i = 0; i < 3; i++) { await wait(1050); samples.push(await page.evaluate(() => window.__babi.fps())); }
    await page.evaluate(() => { window.__babi.touchInput.forced = null; });
    const fps = samples.sort((a, b) => a - b)[1];
    check('Performance : images/s avec CPU ralenti ×4', fps >= 30, `${fps.toFixed(0)} fps`);
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
