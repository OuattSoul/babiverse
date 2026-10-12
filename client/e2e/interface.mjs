// Scénario 6 — barre du haut (fréquentation, identité, compte) et panneau latéral (jauges, outils),
// sur téléphone tactile puis sur ordinateur.
import { BASE, session } from './lib.mjs';

const box = (page, sel) => page.locator(sel).boundingBox();
const overlap = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tipShown = (page, sel) => page.$eval(sel, (n) => getComputedStyle(n, '::after').opacity === '1');

async function mobile() {
  const s = await session('interface-mobile');
  const { page, wait, check } = s;
  try {
    // Écran de connexion : la barre est déjà là, avec les actions de compte.
    await page.goto(BASE);
    await page.waitForSelector('#tb-login', { timeout: 15000 });
    check('Connexion : barre du haut visible', await page.isVisible('#topbar'));
    check('Connexion : « Se connecter » actif', (await page.getAttribute('#tb-login', 'aria-pressed')) === 'true');
    await page.waitForFunction(() => document.getElementById('val-players').textContent !== '—', null, { timeout: 10000 });
    const players = await page.textContent('#val-players');
    check('Joueurs connectés : chiffre fourni par le serveur', /^\d+$/.test(players.replace(/\s/g, '')), players);
    check('Visiteurs : aucun chiffre inventé', (await page.textContent('#val-visitors')) === '—');
    await page.click('#tb-register');
    check("« S'inscrire » ouvre le formulaire d'inscription", await page.isVisible('#auth-username'));
    const card = await box(page, '#screen .card');
    check('Le formulaire ne passe pas sous la barre', card.y >= (await box(page, '#topbar')).y + (await box(page, '#topbar')).height);
    await s.shot('01-inscription');

    await page.click('#tb-login');
    check('« Se connecter » revient au formulaire de connexion', await page.isVisible('#login-form'));

    await s.createCharacter('Koffi', 'etudiant');
    check('En jeu : pseudonyme dans la barre', (await page.textContent('#hud-name')) === 'Koffi');
    check('En jeu : plus de boutons de connexion', !(await page.$('#tb-login')));
    const brand = await box(page, '.tb-brand');
    const vw = page.viewportSize().width;
    check('Logo centré', Math.abs(brand.x + brand.width / 2 - vw / 2) < 2, `${brand.x + brand.width / 2} / ${vw / 2}`);

    // Jauges : remplissage = valeur réelle (repas = 100 − faim).
    const needs = await page.evaluate(() => window.__babi.store.needs());
    const ring = async (id) => Number(await page.$eval(`#${id} .ring`, (n) => n.style.strokeDashoffset));
    check('Jauge repas = 100 − faim', Math.abs(100 - (await ring('gauge-food')) - (100 - Math.round(needs.hunger))) <= 1);
    check('Jauge énergie = énergie', Math.abs(100 - (await ring('gauge-energy')) - Math.round(needs.energy)) <= 1);

    // État bas : énergie sous le seuil de travail → jauge rouge et infobulle explicite.
    await page.evaluate(() => { const st = window.__babi.store; st.apply({ ...st.state, character: { ...st.state.character, energy: 5 } }); });
    await wait(1200);
    check('Énergie basse : anneau rouge', await page.$eval('#gauge-energy .ring', (n) => getComputedStyle(n).stroke === 'rgb(255, 90, 71)'));
    check('Toasts : aucune jauge masquée', !overlap(await box(page, '#toasts'), await box(page, '#sidebar')));

    // Toucher sur une jauge : infobulle ; appui long sur un outil : infobulle sans ouvrir le panneau.
    await s.tap(await center(page, '#gauge-energy'));
    check('Toucher une jauge affiche son infobulle', await tipShown(page, '#gauge-energy'));
    check("Infobulle d'énergie basse", /sieste/.test(await page.getAttribute('#gauge-energy', 'data-tip')));
    await s.shot('02-jeu-infobulle');
    const p = await center(page, '#btn-settings');
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await wait(700);
    check('Appui long : infobulle « Réglages »', await tipShown(page, '#btn-settings'));
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(300);
    check("Appui long : le panneau ne s'ouvre pas", await page.isHidden('#sheet'));

    // Toucher bref : le panneau des missions s'ouvre, regroupé par état.
    await s.tap(await center(page, '#btn-journal'));
    check('Missions : panneau ouvert', (await page.textContent('#sheet-title')) === 'Journal des missions');
    check('Missions : groupes par état', (await page.$$('.group-title')).length >= 1);
    await s.shot('03-missions');
    await page.click('#sheet-close');

    await s.tap(await center(page, '#btn-settings'));
    check('Réglages : panneau ouvert', (await page.textContent('#sheet-title')) === 'Réglages');
    await page.click('#sheet-close');
    await page.click('.tb-account');
    check('Compte (barre du haut) : ouvre les réglages', (await page.textContent('#sheet-title')) === 'Réglages');
    await page.click('#sheet-close');

    // Rien ne se chevauche : panneau, joystick, commandes caméra, menu du bas.
    const side = await box(page, '#sidebar');
    check('Panneau latéral sans chevauchement du joystick', !overlap(side, await box(page, '#joystick-zone')));
    check('Panneau latéral sans chevauchement du menu du bas', !overlap(side, await box(page, '#main-nav')));
    check('Panneau latéral sous la barre du haut', !overlap(side, await box(page, '#topbar')) && !overlap(side, await box(page, '#hud')));
    check('Commandes caméra dégagées', !overlap(await box(page, '#cam-controls'), await box(page, '#hud')));
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}

async function desktop() {
  const s = await session('interface-ordinateur', { desktop: true });
  const { page, check } = s;
  try {
    await s.createCharacter('Aya', 'salarie');
    await page.hover('#gauge-food');
    await page.waitForTimeout(250);
    check('Survol : infobulle de la jauge repas', await tipShown(page, '#gauge-food'));
    check('Infobulle : valeur du repas', /^Repas : \d+ %/.test(await page.getAttribute('#gauge-food', 'data-tip')));
    await page.hover('#stat-players');
    await page.waitForTimeout(250);
    check('Survol : infobulle des joueurs connectés', await tipShown(page, '#stat-players'));
    await s.shot('01-jeu');
    await page.click('#btn-bag');
    check('Sac : panneau ouvert', (await page.textContent('#sheet-title')) === 'Mon sac');
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}

async function center(page, sel) {
  const b = await box(page, sel);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export async function run() {
  return (await mobile()) + (await desktop());
}
