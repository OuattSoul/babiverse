// Scénario 3 — parcelles des joueurs (deux navigateurs : monde partagé).
// A achète une parcelle, construit une boutique, ouvre son kiosque et loue un panneau publicitaire ;
// B, sur un autre appareil, voit tout cela dans le monde et ne peut pas acheter la parcelle de A.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { c, session, T } from './lib.mjs';

const BACKEND = fileURLToPath(new URL('../../backend/', import.meta.url));
const DB = process.env.E2E_DATABASE_URL || 'sqlite:///e2e.sqlite3';

/** Donne de l'argent virtuel à un personnage (outil de test : passe par la base du serveur E2E). */
function grant(name, amount) {
  execFileSync('python', ['manage.py', 'shell', '-c',
    `from game.models import Character as C; C.objects.filter(name='${name}').update(balance=${amount})`],
  { cwd: BACKEND, env: { ...process.env, DATABASE_URL: DB }, stdio: 'pipe' });
}

export async function run() {
  const suffix = String(Date.now() % 100000);
  let nameA = '';
  const a = await session('parcelles-A');
  const b = await session('parcelles-B');
  const { check } = a;
  const plotOf = (s, id) => s.page.evaluate((i) => window.__babi.store.state.world.plots[i] || null, id);
  // Autant de bâtiments 3D que de constructions connues du serveur (toutes, pas seulement les miennes).
  const rendered = (s) => s.page.evaluate(() => {
    const built = Object.values(window.__babi.store.state.world.plots).filter((p) => p.building).length;
    return built > 0 && window.__babi.world.playerGroup.children.length === built;
  });
  const refresh = (s) => s.page.evaluate(async () => {
    const r = await fetch('/api/state', { headers: { Authorization: `Bearer ${localStorage.getItem('babiverse.token')}` } });
    window.__babi.store.apply((await r.json()).state);
  });

  try {
    // --- Joueur A ------------------------------------------------------------------
    nameA = await a.createCharacter(`awa${suffix}`, 'entrepreneur');
    grant(nameA, 60000);
    await refresh(a);
    await a.walkTo(c(4, 6));
    await a.interact();
    await a.waitZone('quartier');

    // Une parcelle encore libre d'après le serveur (la base E2E garde celles des passages précédents)
    const taken = Object.keys((await a.state()).world.plots);
    // (P12 est indisponible à la vente : voir shared/city.json)
    const PLOT = ['P04', 'P05', 'P06', 'P07', 'P01', 'P02', 'P03', 'P08', 'P09', 'P10', 'P11'].find((id) => !taken.includes(id));
    if (!PLOT) throw new Error('Plus aucune parcelle libre : réinitialiser la base E2E');
    await a.goto(await a.stand(`plot_${PLOT}`));
    check('Invite : acheter la parcelle libre', (await a.prompt())?.startsWith(`Acheter la parcelle ${PLOT}`), await a.prompt());
    await a.interact();
    await a.page.click('#sheet .buttons button.primary');
    await a.page.waitForFunction((id) => window.__babi.store.state.world.plots[id]?.mine, PLOT, { timeout: 8000 });
    check('Achat : parcelle attribuée et débitée (15 000 F)', (await a.state()).character.balance === 45000);
    await a.wait(400);
    check('Le panneau affiche le nouveau propriétaire', await a.page.evaluate((id) =>
      window.__babi.world.props.find((p) => p.def.kind === 'plotsign' && p.def.plot === id).object.userData.key.includes('"mine":true'), PLOT));

    // Construction d'une boutique
    check('Invite : construire sur ma parcelle', (await a.prompt()) === 'Construire sur ma parcelle', await a.prompt());
    await a.interact();
    await a.page.fill('#build-name', 'Chez Awa');
    await a.page.click('[data-template="boutique"] button');
    await a.page.waitForFunction((id) => window.__babi.store.state.world.plots[id]?.building, PLOT, { timeout: 8000 });
    const building = (await plotOf(a, PLOT)).building;
    check('Construction : boutique posée par le serveur dans la parcelle', building.template === 'boutique', JSON.stringify(building));
    check('Construction : coût débité (18 000 F)', (await a.state()).character.balance === 45000 - 18000);
    await a.wait(500);
    check('La boutique apparaît en 3D', await rendered(a));
    await a.shot('01-boutique');

    // Le kiosque, puis une publicité sur le panneau de la place
    await a.goto(c(6, 17));
    await a.interact();
    await a.page.click('#sheet .buttons button.primary');
    await a.page.waitForFunction(() => window.__babi.store.state.business.open, null, { timeout: 8000 });
    await a.page.evaluate(() => { if (window.__babi.store.modalOpen) document.getElementById('sheet-close').click(); });
    // Panneau libre (les loués au passage précédent restent occupés 3 jours) et case où se tenir devant.
    const AD_STANDS = { pub_place: c(35, 16), pub_rue2: c(28, 30) };
    const rentedAds = Object.keys((await a.state()).world.ads);
    const SLOT = Object.keys(AD_STANDS).find((id) => !rentedAds.includes(id));
    if (!SLOT) throw new Error('Plus aucun panneau libre : réinitialiser la base E2E');
    await a.goto(AD_STANDS[SLOT]);
    check('Invite : louer le panneau publicitaire', (await a.prompt())?.startsWith('Louer ce panneau'), await a.prompt());
    await a.interact();
    await a.page.click('#sheet .buttons button.primary');
    await a.page.waitForFunction((id) => window.__babi.store.state.world.ads[id]?.mine, SLOT, { timeout: 8000 });
    check('Publicité : panneau loué au nom du kiosque', (await a.state()).world.ads[SLOT].title === `KIOSQUE DE ${nameA.toUpperCase()}`);
    await a.shot('02-publicite');

    // --- Joueur B, sur un autre appareil ---------------------------------------------
    await b.createCharacter(`Yao${suffix}`, 'salarie');
    await b.walkTo(c(4, 6));
    await b.interact();
    await b.waitZone('quartier');
    const seen = await plotOf(b, PLOT);
    b.check('B voit la parcelle et la boutique de A', seen?.owner === nameA && !seen.mine && seen.building?.name === 'Chez Awa', JSON.stringify(seen));
    b.check('B voit la publicité de A', (await b.state()).world.ads[SLOT]?.title?.includes(nameA.toUpperCase()));
    await b.wait(500);
    b.check('La boutique de A est construite en 3D chez B', await rendered(b));
    await b.goto(await b.stand(`plot_${PLOT}`));
    b.check('B ne peut pas acheter la parcelle de A', (await b.prompt()) === `Parcelle de ${nameA}`, await b.prompt());
    // La boutique est solide : B ne peut pas la traverser (on la longe par sa façade).
    const south = building.facing === 'S';
    const wall = south ? (building.y0 + 2) * T : building.y0 * T;
    await b.goto({ x: (building.x0 + 0.5) * T, y: south ? wall + T / 2 : wall - T / 2 });
    const p = await b.hold({ x: 0, y: south ? -1 : 1 }, 1200);
    b.check('Collision : la boutique de A bloque B', south ? p.y - 5 >= wall - 0.01 : p.y + 5 <= wall + 0.01, `y=${p.y.toFixed(1)} mur=${wall}`);
    await b.shot('03-vue-joueur-B');

    // Intérieurs privés : B ne peut pas entrer chez A, ni par la porte ni en forçant la zone envoyée au serveur.
    const enter = (s) => s.page.evaluate((id) => {
      const w = window.__babi.world;
      return w.enterBuilding(w.playerBuildings().find((x) => x.plot === id));
    }, PLOT);
    b.check('B ne peut pas entrer dans la boutique de A', (await enter(b)) === false);
    const forced = await b.page.evaluate(async (id) => {
      const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('babiverse.token')}` },
        body: JSON.stringify({ pos: { zone: `int_pb_${id}`, x: 100, y: 100 } }) });
      return (await r.json()).state.character.zone;
    }, PLOT);
    b.check('Le serveur refuse la zone intérieure de A envoyée par B', forced !== `int_pb_${PLOT}`, forced);
    check('A entre dans sa propre boutique', (await enter(a)) === true);
    await a.waitZone(`int_pb_${PLOT}`);
  } catch (err) {
    await a.fail(err);
  }
  return (await a.finish()) + (await b.finish());
}
