// Scénario — deux joueurs se rencontrent dans la ville : barre de proximité, demande de discussion ignorée
// puis acceptée depuis 🔔, messages, demande d'ami, appel manqué (30 s) puis rappel décroché (voix simulée).
// Deux navigateurs : Awa sur téléphone tactile, Bakary sur ordinateur. Micro simulé par Chrome.
import { session } from './lib.mjs';

const MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];

const visible = (page, sel) => page.isVisible(sel);
const until = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

/** Va dans la ville et se place à côté de `near` (pixels), sur une case libre. */
async function meet(s, near) {
  await s.page.evaluate(() => window.__babi.world.showCity());
  // Entrer dans la ville est long sur le téléphone simulé (CPU ×4) : délai plus large que waitZone.
  await s.page.waitForFunction(() => window.__babi.player()?.zone === 'quartier', null, { timeout: 40000 });
  await s.wait(400);
  if (!near) return s.player();
  for (const [dx, dy] of [[48, 0], [-48, 0], [0, 48], [0, -48], [64, 32], [-64, -32]]) {
    await s.page.evaluate(([x, y]) => window.__babi.world.loadZone('quartier', { pos: { x, y } }), [near.x + dx, near.y + dy]);
    await s.wait(500);
    const p = await s.player();
    if (Math.hypot(p.x - near.x - dx, p.y - near.y - dy) < 2) return p;
  }
  throw new Error('aucune case libre près de l\'autre joueur');
}

export async function run() {
  const a = await session('social-a', { args: MEDIA });
  const b = await session('social-b', { desktop: true, args: MEDIA });
  const check = a.check;
  try {
    await a.createCharacter('Awa', 'etudiant');
    await b.createCharacter('Bakary', 'salarie');
    const pa = await meet(a);
    await meet(b, pa);

    // --- Présence et barre de proximité -----------------------------------------------
    check('Awa voit Bakary dans la ville', await until(a.page, () => window.__babi.world.remotes.list().some((p) => p.name === 'Bakary')));
    check('Bakary voit Awa', await until(b.page, () => window.__babi.world.remotes.list().some((p) => p.name === 'Awa')));
    check('Barre de proximité affichée (Awa)', await until(a.page, () => !document.getElementById('social-bar').hidden));
    const labels = await a.page.$$eval('#social-bar .soc-act', (n) => n.map((x) => x.textContent));
    check('Barre : Chatter, Appeler, Ajouter ami', labels.join('|') === '💬Chatter|📞Appeler|🤝Ajouter ami', labels.join('|'));
    check('Barre au nom du joueur proche', (await a.page.textContent('#social-bar .soc-who')).includes('Bakary'));
    const bar = await a.page.locator('#social-bar').boundingBox();
    const joy = await a.page.locator('#joystick-zone').boundingBox();
    check('Téléphone : la barre ne chevauche pas le joystick', bar.y + bar.height <= joy.y + 1, `${bar.y + bar.height} / ${joy.y}`);
    await a.shot('01-barre-proximite');
    await b.page.evaluate(() => { const r = window.__babi.rig; r.goal.dist = 8; r.recenter(); });
    await b.wait(1500);
    await b.shot('00-joueurs-face-a-face');

    // --- Discussion : ignorée, puis acceptée depuis 🔔 ----------------------------------
    await a.page.click('#social-bar .soc-act.chat');
    check('Bakary reçoit la demande de discussion', await until(b.page, () => !document.getElementById('social-incoming').hidden));
    check('Texte de la demande', (await b.page.textContent('#social-incoming')).includes('Awa veut discuter avec toi'));
    check('Badge 🔔 non lu', await until(b.page, () => document.getElementById('social-count').textContent === '1'));
    await b.shot('01-demande-recue');
    await b.page.click('#social-incoming .soc-x');
    check('Ignorée : la carte disparaît', await until(b.page, () => document.getElementById('social-incoming').hidden));
    check('Ignorée : plus de badge (lue)', await until(b.page, () => document.getElementById('social-count').hidden));
    await b.page.click('#btn-social');
    const row = b.page.locator('.soc-row', { hasText: 'Awa veut discuter avec toi' });
    check('Ignorée : toujours dans 🔔, marquée lue', (await row.count()) === 1 && !(await row.getAttribute('class')).includes('unread'));
    await b.shot('02-notifications');
    await row.locator('button.primary').click();
    check('Acceptée : la discussion s\'ouvre (Bakary)', await until(b.page, () => !!document.getElementById('chat-input')));
    check('Awa : discussion ouverte automatiquement', await until(a.page, () => !!document.getElementById('chat-input')));
    await a.page.fill('#chat-input', 'Salut Bakary !');
    await a.page.click('#chat-send');
    check('Message reçu par Bakary', await until(b.page, () => document.getElementById('chat-list')?.textContent.includes('Salut Bakary !')));
    await b.page.fill('#chat-input', 'Bonjour Awa 👋');
    await b.page.press('#chat-input', 'Enter');
    check('Réponse reçue par Awa', await until(a.page, () => document.getElementById('chat-list')?.textContent.includes('Bonjour Awa')));
    await a.shot('02-discussion');
    await a.page.click('#sheet-close');
    await b.page.click('#sheet-close');

    // --- Ami ------------------------------------------------------------------------
    check('Barre revenue après fermeture (Bakary)', await until(b.page, () => !document.getElementById('social-bar').hidden));
    await b.page.click('#social-bar .soc-act.friend');
    check('Awa reçoit la demande d\'ami', await until(a.page, () => document.getElementById('social-incoming').textContent.includes('veut devenir ton ami')));
    await a.page.click('#soc-accept');
    check('Amis : « ★ Ami » dans la barre, plus de bouton Ajouter ami', await until(b.page,
      () => document.querySelector('#social-bar .soc-friend') && !document.querySelector('#social-bar .soc-act.friend')));

    // --- Appel sans réponse : manqué après 30 s, puis rappel ---------------------------
    await a.page.click('#social-bar .soc-act.call');
    check('Awa : écran « Appel vers Bakary… »', await until(a.page, () => document.getElementById('call-panel').textContent.includes('Appel vers Bakary')));
    check('Bakary : ça sonne (Décrocher / Refuser)', await until(b.page, () => !!document.getElementById('call-accept')));
    await b.shot('03-appel-entrant');
    check('Sonnerie arrêtée après 30 s (Bakary)', await until(b.page, () => document.getElementById('call-panel').hidden, null, 40000));
    check('Awa : écran d\'appel fermé', await until(a.page, () => document.getElementById('call-panel').hidden, null, 10000));
    await b.page.click('#btn-social');
    const missed = b.page.locator('.soc-row', { hasText: 'Appel manqué de Awa' });
    check('Appel manqué gardé dans 🔔 avec « Rappeler »', (await missed.count()) === 1 && (await missed.locator('button', { hasText: 'Rappeler' }).count()) === 1);
    await b.shot('04-appel-manque');
    await missed.locator('button', { hasText: 'Rappeler' }).click();
    check('Awa reçoit le rappel', await until(a.page, () => !!document.getElementById('call-accept')));
    await a.page.click('#call-accept');
    check('En ligne des deux côtés', await until(a.page, () => document.getElementById('call-panel').textContent.includes('En ligne avec Bakary'))
      && await until(b.page, () => document.getElementById('call-panel').textContent.includes('En ligne avec Awa')));
    check('Liaison audio établie (WebRTC)', await until(a.page, () => window.__babi.social.voice?.pc.connectionState === 'connected', null, 30000),
      await a.page.evaluate(() => window.__babi.social.voice?.pc.connectionState));
    await a.shot('03-en-ligne');
    await b.page.click('#call-hangup');
    check('Raccroché : écran fermé chez Awa', await until(a.page, () => document.getElementById('call-panel').hidden, null, 10000));

    // --- Appel refusé ------------------------------------------------------------------
    await b.page.click('#sheet-close').catch(() => {});
    await a.page.click('#social-bar .soc-act.call');
    check('Bakary : appel entrant', await until(b.page, () => !!document.getElementById('call-decline')));
    await b.page.click('#call-decline');
    check('Awa : appel refusé, écran fermé', await until(a.page, () => document.getElementById('call-panel').hidden, null, 10000));
  } catch (err) {
    await a.fail(err);
    await b.shot('erreur');
  }
  b.check('Aucune erreur (Bakary)', b.consoleErrors.length === 0, b.consoleErrors.slice(0, 3).join(' | '));
  return (await a.finish()) + (await b.finish());
}
