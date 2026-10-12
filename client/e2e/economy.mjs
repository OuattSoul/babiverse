// Scénario 2 — boucle économique : mission, emploi, entreprise, coupure réseau, persistance.
import { c, session } from './lib.mjs';

// Positions de la tranche économique dans la ville (voir world/city.js).
const KIOSK_FRONT = c(6, 17);   // devant le comptoir du kiosque
const DIABATE_FRONT = c(33, 12); // trottoir face à M. Diabaté
const ADJOUA_FRONT = c(11, 17);  // devant l'étal de garba

export async function run() {
  const s = await session('economie');
  const { page, context, wait, check } = s;

  // Les trajets utilisent la recherche de chemin du jeu (comme un toucher au sol).
  const go = (dest) => s.goto(dest);

  const closeSheet = () => page.evaluate(() => { if (window.__babi.store.modalOpen) document.getElementById('sheet-close').click(); });

  /** Agit sur une mission depuis le journal et attend que le serveur ait confirmé. */
  async function journal(missionId, buttonText) {
    const expected = buttonText === 'Réclamer' ? 'rewarded' : 'active';
    await closeSheet();
    await page.click('#btn-journal');
    await page.click(`[data-mission="${missionId}"] >> text=${buttonText}`);
    await page.waitForFunction(([id, st]) => window.__babi.store.mission(id)?.status === st, [missionId, expected], { timeout: 10000 });
    await wait(300);
    await closeSheet();
  }

  const balance = async () => (await s.state()).character.balance;

  try {
    await s.createCharacter('Awa', 'entrepreneur');
    check('Profil entrepreneur : capital de 9 000 F', (await balance()) === 9000);
    await s.walkTo(c(4, 6));
    await s.interact();
    await s.waitZone('quartier');

    // Mission d'accueil : aller parler à Tonton Koffi (il flâne dans la rue)
    await go(c(9, 19));
    for (let i = 0; i < 6 && (await s.prompt()) !== 'Parler à Tonton Koffi'; i++) {
      const k = await page.evaluate(() => { const n = window.__babi.scene().npcs.find((x) => x.id === 'koffi'); return { x: n.x, y: n.y + 18 }; });
      await s.goto(k, 6000);
    }
    check('Invite près de Tonton Koffi (PNJ mobile)', (await s.prompt()) === 'Parler à Tonton Koffi');
    await s.interact();
    await wait(700);
    await s.shot('01-koffi');
    await closeSheet();
    await page.waitForFunction(() => window.__babi.store.mission('m_bienvenue')?.status === 'completed', null, { timeout: 8000 });
    await journal('m_bienvenue', 'Réclamer');
    check('Mission : récompense versée une fois (+300 F)', (await balance()) === 9300);
    await journal('m_livraison', 'Accepter');
    await journal('m_kiosque', 'Accepter');
    const missions = Object.fromEntries((await s.state()).missions.map((m) => [m.id, m.status]));
    check('Missions acceptées : en cours', missions.m_livraison === 'active' && missions.m_kiosque === 'active', JSON.stringify(missions));

    // Emploi : service de livraison pour M. Diabaté
    await go(DIABATE_FRONT);
    check('Invite près de M. Diabaté', (await s.prompt()) === 'Parler à M. Diabaté');
    await s.interact();
    await page.click('text=Commencer une livraison');
    await page.waitForFunction(() => !!window.__babi.store.state.job.active, null, { timeout: 10000 });
    const started = Date.now();
    const shift = (await s.state()).job.active;
    check('Service commencé : 3 colis', shift?.targets.length === 3, JSON.stringify(shift?.targets));
    await s.shot('02-livraison');
    for (const target of shift.targets) {
      await go(await s.stand(target));
      const label = await s.prompt();
      check(`Livraison possible sur place (${target})`, label?.startsWith('Livrer le colis'), label);
      const done = (await s.state()).job.active.delivered.length;
      await s.interact();
      await page.waitForFunction((n) => window.__babi.store.state.job.active?.delivered.length > n, done, { timeout: 8000 }).catch(() => {});
    }
    check('Tous les colis livrés', (await s.state()).job.active.delivered.length === 3);
    await go(DIABATE_FRONT);
    const remaining = 31000 - (Date.now() - started);
    if (remaining > 0) await wait(remaining); // durée minimale d'un service côté serveur
    await s.interact();
    await page.click('text=Terminer et être payé');
    await page.waitForFunction(() => !window.__babi.store.state.job.active, null, { timeout: 5000 });
    check('Salaire versé (+1 200 F)', (await balance()) === 10500, String(await balance()));
    await journal('m_livraison', 'Réclamer');
    check('Mission « Premier boulot » récompensée (+500 F)', (await balance()) === 11000);

    // Entreprise : ouvrir le kiosque sur son emplacement réel
    await go(KIOSK_FRONT);
    check('Invite : ouvrir le kiosque', (await s.prompt())?.startsWith('Ouvrir mon kiosque'), await s.prompt());
    await s.interact();
    await page.click('#sheet .buttons button.primary');
    await page.waitForFunction(() => window.__babi.store.state.business.open, null, { timeout: 5000 });
    check('Kiosque ouvert : coût de lancement débité (9 600 F, remise entrepreneur)', (await balance()) === 1400);
    await closeSheet();
    await wait(300);
    check('Le kiosque apparaît dans le monde (modèle 3D ouvert)', await page.evaluate(() => window.__babi.scene().kioskOpen()));
    await journal('m_kiosque', 'Réclamer');
    check('Mission « Mon propre business » (+1 000 F)', (await balance()) === 2400);
    await s.shot('03-kiosque');

    // Acheter un casier de boissons à l'épicerie
    await go(await s.stand('door_epicerie'));
    await s.interact();
    await s.waitZone('epicerie');
    await s.path(c(2, 7), c(2, 5));
    await s.interact();
    await page.click('text=Voir les produits');
    await page.click('[data-item="casier_boissons"] button.buy');
    await page.waitForFunction(() => window.__babi.store.state.inventory.casier_boissons === 1, null, { timeout: 8000 });
    check('Achat du casier (1 800 F)', (await balance()) === 600);
    await closeSheet();

    // Réapprovisionner le kiosque puis servir un client
    await s.goto(c(5, 7));
    await s.interact();
    await s.waitZone('quartier');
    await go(KIOSK_FRONT);
    check('Invite : gérer le kiosque', (await s.prompt()) === 'Gérer mon kiosque');
    await s.interact();
    await page.click('text=Déposer 1 casier');
    await page.waitForFunction(() => window.__babi.store.state.business.stock === 12, null, { timeout: 5000 });
    check('Stock du kiosque : 12 boissons, casier retiré du sac', !(await s.state()).inventory.casier_boissons);
    await page.click('text=Tenir le kiosque');
    await page.waitForFunction(() => window.__babi.scene().customers.waiting(), null, { timeout: 45000 });
    await wait(300);
    check('Un client attend : invite « Servir »', (await s.prompt())?.startsWith('Servir le client'), await s.prompt());
    await s.shot('05-client');
    await s.interact();
    await page.waitForFunction(() => window.__babi.store.state.business.stock === 11, null, { timeout: 5000 });
    const st = await s.state();
    check('Vente : +250 F, stock 11', st.character.balance === 850 && st.business.units_sold === 1);
    check('Mission « Première vente » terminée', st.missions.find((m) => m.id === 'm_premiere_vente')?.status === 'completed');

    // Persistance de l'entreprise après rechargement
    await page.reload();
    await page.waitForFunction(() => window.__babi?.player(), null, { timeout: 15000 });
    await wait(800);
    const st2 = await s.state();
    check('Reconnexion : kiosque, stock et solde conservés', st2.business.open && st2.business.stock === 11 && st2.character.balance === 850);
    await s.shot('06-reconnexion');

    // Coupure réseau pendant un achat (en dernier : l'émulation hors ligne ralentit ensuite le navigateur)
    await s.goto(ADJOUA_FRONT);
    check('Invite près de Tantie Adjoua', (await s.prompt()) === 'Parler à Tantie Adjoua', await s.prompt());
    await s.interact();
    await page.click('text=Voir les produits');
    await context.setOffline(true);
    await page.click('[data-item="garba"] button.buy');
    await page.waitForSelector('.toast.error >> text=Connexion perdue', { timeout: 10000 });
    check('Hors ligne : achat non appliqué', (await balance()) === 850 && !(await s.state()).inventory.garba);
    check('Hors ligne : indicateur réseau', await page.evaluate(() => document.getElementById('net').classList.contains('offline')));
    await s.shot('07-hors-ligne');
    await context.setOffline(false);
    await page.click('[data-item="garba"] button.buy');
    await page.waitForFunction(() => window.__babi.store.state.inventory.garba === 1, null, { timeout: 30000 });
    check('Retour du réseau : achat appliqué une seule fois', (await balance()) === 350);
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
