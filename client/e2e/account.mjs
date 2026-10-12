// Scénario « compte » : inscription, rappel d'e-mail, confirmation d'adresse, déconnexion, connexion par nom
// d'utilisateur (l'e-mail n'est pas un identifiant), mot de passe oublié, réinitialisation, lien invalide.
//
// Les liens envoyés par e-mail sont lus dans la console du backend (DJANGO_DEBUG=1, sans RESEND_API_KEY) :
// lancer le backend avec sa sortie redirigée vers un fichier et passer ce fichier dans E2E_MAIL_LOG.
// Sans E2E_MAIL_LOG, les étapes qui suivent un lien sont sautées.
import { readFileSync } from 'node:fs';
import { BASE, PASSWORD, session } from './lib.mjs';

const MAIL_LOG = process.env.E2E_MAIL_LOG;
const NEW_PASSWORD = 'Nouveau-Mdp-2026';

/** Dernier lien `#kind=…` envoyé à cette adresse (e-mails de la console en quoted-printable). */
function lastLink(kind, to) {
  const text = readFileSync(MAIL_LOG, 'utf8').replace(/=\r?\n/g, '').replace(/=3D/g, '=');
  const mails = text.split('Content-Type: text/plain').filter((m) => m.includes(`To: ${to}`));
  const match = mails.at(-1)?.match(new RegExp(`#${kind}=([\\w-]+)`));
  if (!match) throw new Error(`Aucun lien ${kind} pour ${to} dans ${MAIL_LOG}`);
  return match[1];
}

export async function run() {
  const s = await session('compte');
  const { page, wait, check } = s;
  // Les refus attendus (mauvais identifiants, lien invalide) apparaissent comme des 400 dans la console.
  const forgetExpected400 = () => {
    for (let i = s.consoleErrors.length - 1; i >= 0; i--) if (/status of 400/.test(s.consoleErrors[i])) s.consoleErrors.splice(i, 1);
  };
  const openLink = async (kind, token) => {
    // Le lien de l'e-mail s'ouvre dans un nouvel onglet : on repart d'une page vide pour recharger le jeu.
    await page.goto('about:blank');
    await page.goto(`${BASE}#${kind}=${token}`);
  };
  const inGame = () => page.waitForFunction(() => window.__babi?.player(), null, { timeout: 15000 });
  const openSettings = async () => {
    await page.click('#btn-settings');
    await page.waitForFunction(() => document.querySelector('#account-info dd'), null, { timeout: 5000 });
    return page.textContent('#sheet');
  };
  const failLogin = async (login, password) => {
    await page.fill('#auth-login', login);
    await page.fill('#auth-password', password);
    await page.click('#login-form-submit');
    await page.waitForFunction(() => document.querySelector('#login-form .error')?.textContent, null, { timeout: 5000 });
    const msg = await page.textContent('#login-form .error');
    forgetExpected400();
    return msg;
  };

  try {
    const username = await s.signUp();
    const email = `${username}@exemple.ci`;
    check('Inscription : création du personnage sans redemander le nom', (await page.textContent('#char-name')) === username
      && !(await page.$('input#char-name')));
    await page.click('[data-profile="salarie"]');
    await page.click('#btn-start');
    await inGame();
    check('Rappel : confirmer l\'adresse e-mail', await page.isVisible('.toast:has-text("Confirme ton adresse")'));

    let settings = await openSettings();
    check('Réglages : adresse en attente de confirmation', settings.includes(username)
      && settings.includes('aucune adresse confirmée') && settings.includes(`En attente de confirmation : ${email}`));
    await s.shot('01-reglages');

    if (MAIL_LOG) {
      await openLink('verify', lastLink('verify', email));
      await page.waitForFunction(() => /confirmé|invalide/.test(document.querySelector('#verify-status')?.textContent),
        null, { timeout: 10000 });
      check('Lien de confirmation : adresse confirmée', (await page.textContent('#verify-status')).includes(email));
      await s.shot('02-confirmation');
      await page.click('#verify-continue');
      await inGame();
      settings = await openSettings();
      check('Réglages : adresse confirmée', settings.includes(`${email} ✓`) && !settings.includes('En attente'));
    } else {
      console.log('compte : E2E_MAIL_LOG absent, confirmation d\'adresse et réinitialisation non suivies');
    }

    await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click();
    await page.waitForSelector('#login-form', { timeout: 15000 });
    check('Déconnexion : retour à l\'écran de connexion',
      await page.evaluate(() => localStorage.getItem('babiverse.token') === null));

    check('Connexion refusée avec un mauvais mot de passe', (await failLogin(username, 'pas-le-bon-mdp')).includes('incorrect'));
    check('L\'e-mail ne permet pas de se connecter', (await failLogin(email, PASSWORD)).includes('incorrect'));

    await page.fill('#auth-login', username);
    await page.fill('#auth-password', PASSWORD);
    await page.click('#login-form-submit');
    await inGame();
    check('Connexion par nom d\'utilisateur : même personnage', (await page.textContent('#hud-name')) === username);

    // Mot de passe oublié (par nom d'utilisateur) : réponse identique dans tous les cas.
    await page.evaluate(() => localStorage.removeItem('babiverse.token'));
    await page.goto(BASE);
    await page.click('#btn-forgot', { timeout: 15000 });
    await page.fill('#forgot-login', username);
    await page.click('#forgot-form-submit');
    await page.waitForSelector('[role="status"]:has-text("lien")', { timeout: 5000 });
    check('Mot de passe oublié : confirmation affichée', true);
    await s.shot('03-oubli');

    if (MAIL_LOG) {
      await wait(500); // l'e-mail part hors de la requête
      await openLink('reset', lastLink('reset', email));
      await page.waitForSelector('#reset-form', { timeout: 15000 });
      await page.fill('#reset-password', NEW_PASSWORD);
      await page.fill('#reset-password2', NEW_PASSWORD);
      await page.click('#reset-form-submit');
      await inGame();
      check('Réinitialisation par le lien : connecté avec le nouveau mot de passe', (await page.textContent('#hud-name')) === username);
    }

    // Lien de réinitialisation invalide : refus clair, le jeton disparaît de l'adresse.
    await openLink('reset', 'lien-invalide-123');
    await page.waitForSelector('#reset-form', { timeout: 15000 });
    check('Lien : le jeton est retiré de la barre d\'adresse', !page.url().includes('reset='));
    await page.fill('#reset-password', NEW_PASSWORD);
    await page.fill('#reset-password2', NEW_PASSWORD);
    await page.click('#reset-form-submit');
    await page.waitForFunction(() => document.querySelector('#reset-form .error')?.textContent, null, { timeout: 5000 });
    check('Lien invalide refusé', (await page.textContent('#reset-form .error')).includes('invalide'));
    forgetExpected400();
  } catch (err) {
    await s.fail(err);
  }
  return s.finish();
}
