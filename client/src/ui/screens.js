// Écrans hors monde : chargement, compte (connexion, inscription, mot de passe), création du personnage,
// session perdue, réglages.
import { api, auth } from '../net/api.js';
import { store } from '../state/store.js';
import { createPreview } from '../engine3d/preview.js';
import { composeCharacter, svgDataUrl } from '../atelier/compose.js';
import { atelier, studioLook, svgCharacter, wardrobeReady } from '../atelier/pack.js';
import { bodiesOf, colorsOf, createChoice, fits, gendersOf, GENDER_LABELS, WARDROBE_SECTIONS } from '../atelier/wardrobe.js';
import { ui } from './ui.js';

const el = ui.el;
const $ = (sel) => document.querySelector(sel);
const SKINS = ['#f1c27d', '#c68642', '#8d5524', '#5c3a1e'];
const OUTFITS = ['#e67e22', '#27ae60', '#2980b9', '#c0392b', '#8e44ad', '#f1c40f'];
const HAIRS = [['short', 'Courts'], ['afro', 'Afro'], ['braids', 'Tresses'], ['bald', 'Rasé']];
const MIN_PASSWORD = 8;

function showScreen(...children) {
  const screen = $('#screen');
  screen.replaceChildren(el('div', { class: 'card' }, ...children));
  screen.hidden = false;
}

export function hideScreen() {
  $('#screen').hidden = true;
}

export function loadingScreen(text = 'Chargement du quartier…') {
  showScreen(el('h1', {}, 'BabiVerse'), el('p', { class: 'muted' }, text));
}

export function errorScreen(text, onRetry) {
  showScreen(el('h1', {}, 'BabiVerse'), el('p', {}, text), el('button', { class: 'primary', onclick: onRetry }, 'Réessayer'));
}

// --- Compte ---------------------------------------------------------------------

/** Message lisible pour une erreur d'API sur les écrans de compte. */
function accountError(err) {
  if (err.code === 'network') return 'Connexion impossible. Vérifie ton réseau.';
  if (err.status === 429) return 'Trop de tentatives. Patiente une minute avant de réessayer.';
  return err.message;
}

/** Champ de formulaire étiqueté. */
function field(id, label, attrs = {}) {
  const input = el('input', { id, name: id, ...attrs });
  return { input, nodes: [el('label', { for: id }, label), input] };
}

/** Mot de passe + confirmation, avec bouton afficher/masquer. */
function passwordFields(prefix, label = 'Mot de passe') {
  const pwd = field(`${prefix}-password`, label, { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const again = field(`${prefix}-password2`, 'Confirme le mot de passe', { type: 'password', autocomplete: 'new-password', maxlength: 128 });
  const toggle = el('button', { type: 'button', class: 'ghost small' }, 'Afficher');
  toggle.addEventListener('click', () => {
    const show = pwd.input.type === 'password';
    pwd.input.type = again.input.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Masquer' : 'Afficher';
  });
  return {
    nodes: [...pwd.nodes,
      el('small', { class: 'muted' }, `Au moins ${MIN_PASSWORD} caractères, pas uniquement des chiffres, `
        + 'ni trop proche de ton nom d\'utilisateur ou de ton e-mail.'),
      ...again.nodes, toggle],
    value: () => pwd.input.value,
    /** Message d'erreur, ou '' si les deux saisies sont valides. */
    check() {
      if (pwd.input.value.length < MIN_PASSWORD) return `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`;
      if (pwd.input.value !== again.input.value) return 'Les deux mots de passe ne correspondent pas.';
      return '';
    },
  };
}

/**
 * Formulaire envoyé par son bouton ou la touche Entrée. `onSubmit(fail)` peut appeler `fail(message)`
 * pour un refus local, ou laisser remonter une erreur d'API : le message s'affiche sous les champs.
 */
function accountForm(id, submitLabel, children, onSubmit) {
  const error = el('p', { class: 'error', role: 'alert' });
  const submit = el('button', { class: 'primary big', type: 'submit', id: `${id}-submit` }, submitLabel);
  const form = el('form', { class: 'account-form', id, novalidate: true }, ...children, error, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    submit.disabled = true;
    try {
      await onSubmit((msg) => { throw Object.assign(new Error(msg), { local: true }); });
    } catch (err) {
      error.textContent = err.local ? err.message : accountError(err);
    }
    submit.disabled = false;
  });
  return form;
}

const USERNAME_RE = /^[a-z0-9][a-z0-9_.]{2,19}$/;

/** Champs d'inscription : nom d'utilisateur et mot de passe (pour se connecter), e-mail facultatif. */
function registerFields() {
  const username = field('auth-username', "Nom d'utilisateur", { autocomplete: 'username', maxlength: 20,
    autocapitalize: 'none', spellcheck: 'false', placeholder: 'ex. kouadio225' });
  // Pas d'espace ni de majuscule : on corrige pendant la saisie plutôt que de refuser ensuite.
  username.input.addEventListener('input', () => {
    const clean = username.input.value.toLowerCase().replace(/\s+/g, '');
    if (clean !== username.input.value) username.input.value = clean;
  });
  const email = field('auth-email', 'Adresse e-mail (facultatif, recommandé)', { type: 'email', autocomplete: 'email',
    maxlength: 254, autocapitalize: 'none', placeholder: 'toi@exemple.com' });
  const password = passwordFields('auth');
  return {
    nodes: [...username.nodes,
      el('small', { class: 'muted' }, '3 à 20 caractères sans espace : lettres, chiffres, « _ » ou « . ». C\'est avec lui '
        + 'que tu te connectes, et c\'est aussi le nom de ton personnage, visible des autres joueurs.'),
      ...password.nodes,
      ...email.nodes,
      el('small', { class: 'muted' }, 'Sert uniquement à récupérer ton compte si tu oublies ton mot de passe ou s\'il est '
        + 'piraté. Tu recevras un lien pour la confirmer. Sans adresse confirmée, un mot de passe perdu = compte perdu.')],
    password,
    /** Message d'erreur local, ou ''. */
    check() {
      if (!USERNAME_RE.test(username.input.value)) {
        return "Nom d'utilisateur : 3 à 20 caractères (lettres, chiffres, « _ » ou « . »), en commençant par une lettre ou un chiffre.";
      }
      return password.check();
    },
    data: () => ({ username: username.input.value.trim(), email: email.input.value.trim(), password: password.value() }),
  };
}

/** Sans e-mail, on demande une confirmation explicite : un mot de passe perdu ne pourra pas être récupéré. */
function confirmNoEmail(data) {
  return data.email || window.confirm('Sans adresse e-mail, tu ne pourras pas récupérer ton compte si tu oublies ton '
    + 'mot de passe. Continuer sans e-mail ? (Tu pourras en ajouter une plus tard dans ⚙️ Réglages.)');
}

/**
 * Connexion, inscription ou mot de passe oublié. Résout une fois une session ouverte (`auth.token`).
 * onShow(mode, show) : appelé à chaque formulaire affiché (la barre du haut suit et peut en changer).
 */
export function authScreen(mode = 'login', { onShow } = {}) {
  return new Promise((resolve) => {
    const show = (m) => {
      onShow?.(m, show);
      if (m === 'register') {
        const f = registerFields();
        showScreen(
          el('h1', {}, 'BabiVerse'),
          el('h2', {}, 'Créer mon compte'),
          accountForm('register-form', 'Créer mon compte', f.nodes, async (fail) => {
            const bad = f.check();
            if (bad) fail(bad);
            const data = f.data();
            if (!confirmNoEmail(data)) return;
            auth.token = (await api.register(data)).token;
            resolve();
          }),
          el('p', { class: 'muted' }, 'Ton nom d\'utilisateur sera aussi le nom de ton personnage ; son apparence se choisit juste après. Aucun paiement réel. ',
            el('a', { href: '#', onclick: (e) => { e.preventDefault(); privacyDialog(() => show('register')); } },
              'Ce que nous enregistrons')),
          el('button', { class: 'ghost', type: 'button', onclick: () => show('login') }, "J'ai déjà un compte"),
        );
      } else if (m === 'forgot') {
        const login = field('forgot-login', "Nom d'utilisateur ou adresse e-mail", { autocomplete: 'username',
          maxlength: 254, autocapitalize: 'none', spellcheck: 'false' });
        const done = el('p', { class: 'muted', role: 'status' });
        showScreen(
          el('h2', {}, 'Mot de passe oublié'),
          el('p', { class: 'muted' }, 'Nous enverrons un lien à l\'adresse e-mail confirmée de ton compte pour choisir un '
            + 'nouveau mot de passe. Il est valable 30 minutes et ne sert qu\'une fois.'),
          accountForm('forgot-form', 'Envoyer le lien', login.nodes, async (fail) => {
            if (!login.input.value.trim()) fail("Indique ton nom d'utilisateur ou ton adresse e-mail.");
            done.textContent = (await api.forgotPassword(login.input.value.trim())).message;
          }),
          done,
          el('button', { class: 'ghost', type: 'button', onclick: () => show('login') }, 'Retour à la connexion'),
        );
      } else {
        const login = field('auth-login', "Nom d'utilisateur", { autocomplete: 'username', maxlength: 20,
          autocapitalize: 'none', spellcheck: 'false' });
        const password = field('auth-password', 'Mot de passe', { type: 'password', autocomplete: 'current-password', maxlength: 128 });
        showScreen(
          el('h1', {}, 'BabiVerse'),
          el('p', { class: 'muted' }, 'Cité Akwaba, Abidjan. Connecte-toi pour retrouver ta vie de quartier.'),
          accountForm('login-form', 'Se connecter', [...login.nodes, ...password.nodes], async (fail) => {
            if (!login.input.value.trim() || !password.input.value) fail('Remplis les deux champs.');
            auth.token = (await api.login(login.input.value.trim(), password.input.value)).token;
            resolve();
          }),
          el('button', { class: 'ghost', type: 'button', id: 'btn-forgot', onclick: () => show('forgot') }, 'Mot de passe oublié ?'),
          el('button', { type: 'button', id: 'btn-register', onclick: () => show('register') }, 'Créer un compte'),
        );
      }
    };
    show(mode);
  });
}

/** Ancien compte invité : rattache nom d'utilisateur, mot de passe (et e-mail) à la partie en cours. Résout avec le compte. */
export function secureAccountScreen() {
  return new Promise((resolve) => {
    const f = registerFields();
    showScreen(
      el('h2', {}, 'Sécurise ton compte'),
      el('p', {}, 'BabiVerse passe aux comptes : choisis un nom d\'utilisateur et un mot de passe pour te connecter, '
        + 'et ajoute une adresse e-mail pour pouvoir récupérer ton compte. Ta partie est conservée.'),
      accountForm('register-form', 'Enregistrer', f.nodes, async (fail) => {
        const bad = f.check();
        if (bad) fail(bad);
        const data = f.data();
        if (!confirmNoEmail(data)) return;
        resolve((await api.register(data)).account);
      }),
    );
  });
}

/** Choix d'un nouveau mot de passe depuis le lien reçu par e-mail. Résout aussi en cas d'abandon. */
export function resetPasswordScreen(token) {
  return new Promise((resolve) => {
    const password = passwordFields('reset', 'Nouveau mot de passe');
    showScreen(
      el('h2', {}, 'Nouveau mot de passe'),
      el('p', { class: 'muted' }, 'Tous tes appareils seront déconnectés, puis tu seras connecté ici.'),
      accountForm('reset-form', 'Changer le mot de passe', password.nodes, async (fail) => {
        const bad = password.check();
        if (bad) fail(bad);
        auth.token = (await api.resetPassword(token, password.value())).token;
        resolve();
      }),
      el('button', { class: 'ghost', type: 'button', onclick: () => resolve() }, 'Annuler'),
    );
  });
}

/** Confirmation d'adresse depuis le lien reçu par e-mail (fonctionne aussi sans être connecté). */
export function verifyEmailScreen(token) {
  return new Promise((resolve) => {
    const status = el('p', { role: 'status', id: 'verify-status' }, 'Confirmation de ton adresse…');
    const next = el('button', { class: 'primary', id: 'verify-continue', disabled: true, onclick: () => resolve() }, 'Continuer');
    showScreen(el('h2', {}, 'Adresse e-mail'), status, next);
    api.verifyEmail(token)
      .then(({ account }) => {
        status.textContent = `C'est confirmé : ${account.email} servira à récupérer le compte « ${account.username} ».`;
      })
      .catch((err) => {
        status.className = 'error';
        status.textContent = accountError(err);
      })
      .finally(() => { next.disabled = false; });
  });
}

// --- Garde-robe de l'atelier ---------------------------------------------------------------

const shortName = (name) => name.replace(/^Corps\s*(?:à|—|-)?\s*silhouette\s+/i, '').replace(/^\p{L}/u, (c) => c.toUpperCase());
// Cadrage des vignettes dans le repère des personnages (0 0 200 380) : la partie du corps qui porte l'élément.
const HEAD = '35 0 130 130';
const THUMB_VIEW = {
  body: '0 0 200 380', hair: HEAD, headwear: HEAD, hair_accessory: HEAD, glasses: '45 30 110 80', beard: '45 40 110 90',
  makeup: '50 35 100 80', jewelry: '35 30 130 120', top: '15 90 170 170', outerwear: '15 90 170 190',
  bottom: '25 200 150 180', dress: '15 90 170 290', shoes: '40 290 120 90', watch: '20 170 160 130', bag: '0 80 200 240',
};

/**
 * Choix de l'apparence parmi les composants PUBLIÉS dans l'atelier : genre, silhouette, peau, puis tout ce qui
 * se porte (coiffure, haut, bas, robe, veste, chaussures, accessoires, barbe, maquillage) avec leurs couleurs.
 * Chaque option est une vignette dessinée avec le vrai composant, sur la silhouette choisie ; seuls les
 * composants compatibles avec le genre et la silhouette sont proposés (règles dans atelier/wardrobe.js).
 * `initial` : apparence `studio` actuelle (changement après la création), sinon tirage au sort.
 * Retourne { preview, lead, element, value(), start(), dispose() }.
 */
function wardrobePicker(initial = null) {
  const w = atelier.pack.wardrobe;
  const sel = createChoice(w);
  const { choice } = sel;
  if (!sel.restore(initial)) sel.randomize();

  // Vignettes : la silhouette (peau, visage) avec le seul élément montré, en cache tant que rien ne change.
  const thumbs = new Map();
  const thumb = (slot, layers) => {
    const props = svgCharacter({ studio: studioLook({ body: choice.body, skin: choice.skin, hair_color: choice.hair_color, layers }) });
    if (!props) return '';
    const id = `${slot}|${JSON.stringify(props)}`;
    if (!thumbs.has(id)) {
      const { svg } = composeCharacter(props, atelier.pack.parts, { idPrefix: `t${thumbs.size}` });
      thumbs.set(id, svgDataUrl(svg.replace(/viewBox="[^"]*"/, `viewBox="${THUMB_VIEW[slot] || THUMB_VIEW.body}"`)));
    }
    return thumbs.get(id);
  };

  const preview = el('img', { class: 'preview preview-svg', alt: 'Aperçu de ton personnage' });
  const lead = el('div', { class: 'wardrobe' });
  const form = el('div', { class: 'wardrobe' });
  const chips = (items, isOn, onPick) => el('div', { class: 'chips' }, ...items.map(([value, label]) => {
    const b = el('button', { class: `chip${isOn(value) ? ' on' : ''}`, type: 'button', 'data-value': value }, label);
    b.addEventListener('click', () => onPick(value));
    return b;
  }));
  const tiles = (slot, items) => el('div', { class: 'tiles', 'data-slot': slot }, ...items.map(({ id, label, src, on, pick }) => {
    const b = el('button', { class: `tile${on ? ' on' : ''}`, type: 'button', 'data-part': id, title: label, 'aria-pressed': String(on) },
      el('img', { src, alt: '' }), el('span', {}, label));
    b.addEventListener('click', pick);
    return b;
  }));
  const swatches = (colors, current, onPick, label) => el('div', { class: 'swatches', role: 'group', 'aria-label': label }, ...colors.map((c) => {
    const b = el('button', { class: `swatch${current === c ? ' on' : ''}`, style: `background:${c}`, 'aria-label': c, type: 'button' });
    b.addEventListener('click', () => onPick(c));
    return b;
  }));

  const draw = () => {
    const props = svgCharacter({ studio: studioLook(choice) });
    if (props) preview.src = svgDataUrl(composeCharacter(props, atelier.pack.parts, { idPrefix: 'p', width: 110 }).svg);
    // Genre, silhouette (vignettes du genre choisi seulement), peau
    const head = [];
    const genders = gendersOf(w);
    if (genders.length > 1) {
      head.push(el('label', {}, 'Genre'), chips(genders.map((g) => [g, GENDER_LABELS[g]]), (g) => g === choice.gender,
        (g) => { sel.setGender(g); draw(); }));
    }
    const bodies = bodiesOf(w, choice.gender);
    if (bodies.length > 1) {
      head.push(el('label', {}, 'Silhouette'), tiles('body', bodies.map((b) => ({
        id: b.id, label: shortName(b.name), on: b.id === choice.body,
        src: thumb('body', Object.fromEntries(Object.entries(choice.layers).filter(([slot, l]) => l && sel.part(slot) && fits(sel.part(slot), b)))),
        pick: () => { sel.setBody(b.id); draw(); },
      }))));
    }
    head.push(el('label', {}, 'Peau'), swatches(w.skin_tones, choice.skin, (c) => { choice.skin = c; draw(); }, 'Teinte de peau'));
    lead.replaceChildren(...head);

    // Tout ce qui se porte : uniquement les emplacements qui ont au moins un composant compatible
    const sections = [];
    for (const [slot, label, none] of WARDROBE_SECTIONS) {
      const options = sel.options(slot);
      if (!options.length) continue;
      const cur = choice.layers[slot];
      const items = options.map((e) => {
        const colors = cur?.part === e.id ? cur.colors : (e.default_colors?.primary ? { primary: e.default_colors.primary } : {});
        return { id: e.id, label: e.name, on: cur?.part === e.id, src: thumb(slot, { [slot]: { part: e.id, colors } }),
          pick: () => { sel.wear(slot, e, cur?.colors?.primary); draw(); } };
      });
      if (none) items.unshift({ id: '', label: none, on: !cur, src: thumb(slot, {}), pick: () => { sel.wear(slot, null); draw(); } });
      sections.push(el('label', {}, label), tiles(slot, items));
      const e = sel.part(slot);
      if (slot === 'hair' && e) sections.push(swatches(w.hair_colors, choice.hair_color, (c) => { choice.hair_color = c; draw(); }, 'Couleur des cheveux'));
      else if (e && e.channels.includes('primary')) {
        const palette = colorsOf(w, e);
        if (!palette.includes(cur.colors.primary)) cur.colors.primary = palette[0];
        sections.push(swatches(palette, cur.colors.primary, (c) => { cur.colors.primary = c; draw(); }, `Couleur : ${label}`));
      }
    }
    form.replaceChildren(...sections);
  };
  const dice = el('button', { class: 'chip', type: 'button', id: 'btn-random-look' }, '🎲 Au hasard');
  dice.addEventListener('click', () => { sel.randomize(); draw(); });
  draw();
  return {
    preview: el('div', { class: 'preview-col' }, preview, dice),
    lead,
    element: form,
    value: () => ({ studio: studioLook(choice) }),
    start() {},
    dispose() { thumbs.clear(); },
  };
}

/** Apparence classique du modèle 3D (sans garde-robe de l'atelier) : peau, tenue, cheveux, aperçu 3D. */
function classicPicker(initial = null) {
  const look = {
    skin: SKINS.includes(initial?.skin) ? initial.skin : SKINS[1],
    outfit: OUTFITS.includes(initial?.outfit) ? initial.outfit : OUTFITS[0],
    hair: HAIRS.some(([v]) => v === initial?.hair) ? initial.hair : 'short',
  };
  const preview = el('canvas', { width: 96, height: 120, class: 'preview' });
  let preview3d = null;
  const redraw = () => preview3d?.setLook({ ...look, pants: '#2c3e50' });
  const swatches = (values, key) => el('div', { class: 'swatches' }, ...values.map((v) => {
    const b = el('button', { class: `swatch${look[key] === v ? ' on' : ''}`, style: `background:${v}`, 'aria-label': v, type: 'button' });
    b.addEventListener('click', () => {
      look[key] = v;
      b.parentElement.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b));
      redraw();
    });
    return b;
  }));
  const hairs = el('div', { class: 'chips' }, ...HAIRS.map(([v, label]) => {
    const b = el('button', { class: `chip${look.hair === v ? ' on' : ''}`, type: 'button' }, label);
    b.addEventListener('click', () => {
      look.hair = v;
      b.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === b));
      redraw();
    });
    return b;
  }));
  return {
    preview,
    lead: el('div', {}, el('label', {}, 'Peau'), swatches(SKINS, 'skin'), el('label', {}, 'Tenue'), swatches(OUTFITS, 'outfit'),
      el('label', {}, 'Cheveux'), hairs),
    element: null,
    value: () => ({ ...look }),
    /** À appeler une fois le canvas affiché (l'aperçu 3D lit sa taille). */
    start() { preview3d = createPreview(preview); redraw(); },
    dispose() { preview3d?.dispose(); preview3d = null; },
  };
}

/** Sélecteur d'apparence : garde-robe de l'atelier si elle est disponible, sinon apparence classique. */
function appearancePicker(initial = null) {
  return wardrobeReady() ? wardrobePicker(initial?.studio) : classicPicker(initial);
}

/** Changer d'apparence après la création (depuis « Mon profil ») : gratuit, validé par le serveur. */
export function appearancePanel({ onSaved } = {}) {
  const picker = appearancePicker(store.state.character.appearance);
  const error = el('p', { class: 'error', role: 'alert' });
  const save = el('button', { class: 'primary big', id: 'btn-save-look' }, 'Enregistrer mon apparence');
  save.addEventListener('click', async () => {
    error.textContent = '';
    save.disabled = true;
    try {
      const res = await api.action('character/appearance', { appearance: picker.value() });
      store.apply(res.state);
      onSaved?.();
      ui.close();
      ui.toast('Nouvelle apparence enregistrée.', 'success');
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });
  const nodes = [el('div', { class: 'creator' }, picker.preview, el('div', { class: 'grow' }, picker.lead)), picker.element, error, save]
    .filter(Boolean);
  ui.open('Mon apparence', 'Change de tenue quand tu veux : c\'est gratuit.', () => nodes, 'appearance', { onClose: () => picker.dispose() });
  picker.start();
}

/**
 * Création du personnage. Résout avec l'état serveur du nouveau personnage.
 * `username` : nom d'utilisateur choisi à l'inscription ; il sert de nom dans le jeu (on ne le redemande pas,
 * le serveur le reprend lui-même).
 */
export function creationScreen(username) {
  return new Promise((resolve) => {
    const picker = appearancePicker();
    let profile = 'etudiant';
    const name = el('strong', { id: 'char-name', class: 'char-name' }, username || '');
    const error = el('p', { class: 'error', role: 'alert' });

    const profiles = el('div', { class: 'profiles' }, ...Object.entries(store.config.profiles).map(([id, p]) => {
      const b = el('button', { class: `profile${id === profile ? ' on' : ''}`, type: 'button', 'data-profile': id },
        el('strong', {}, p.label),
        el('small', {}, `${p.description} Départ : ${p.balance.toLocaleString('fr-FR')} F.`));
      b.addEventListener('click', () => {
        profile = id;
        profiles.querySelectorAll('.profile').forEach((s) => s.classList.toggle('on', s === b));
      });
      return b;
    }));

    const start = el('button', { class: 'primary big', id: 'btn-start' }, 'Entrer dans le quartier');
    start.addEventListener('click', async () => {
      error.textContent = '';
      start.disabled = true;
      try {
        const res = await api.createCharacter({ profile, appearance: picker.value() });
        picker.dispose();
        resolve(res.state);
      } catch (err) {
        error.textContent = err.message;
        start.disabled = false;
      }
    });

    showScreen(
      el('h1', {}, 'BabiVerse'),
      el('p', { class: 'muted' }, 'Cité Akwaba, Abidjan. Crée ton personnage et commence ta nouvelle vie.'),
      el('div', { class: 'creator' },
        picker.preview,
        el('div', { class: 'grow' }, el('label', {}, 'Ton nom dans le jeu'), name, picker.lead)),
      picker.element,
      el('label', {}, 'Ta situation de départ'), profiles,
      error, start,
      el('p', { class: 'muted' }, 'Ton nom d\'utilisateur est visible des autres joueurs. Aucun paiement réel.'),
    );
    picker.start();
  });
}

export function sessionLostScreen() {
  auth.token = null;
  showScreen(
    el('h2', {}, 'Session expirée'),
    el('p', {}, 'Tu as été déconnecté (mot de passe changé, déconnexion à distance ou compte supprimé). '
      + 'Reconnecte-toi pour reprendre ta partie.'),
    el('button', { class: 'primary', onclick: () => location.reload() }, 'Se connecter'),
  );
}

// Notice affichée aux testeurs (inscription et réglages). À garder fidèle à ce que fait le serveur.
const PRIVACY = [
  ['Ce que le jeu enregistre', 'Ton compte : nom d\'utilisateur, mot de passe (le serveur n\'en garde qu\'une empreinte, '
    + 'jamais le mot de passe lui-même) et, si tu la donnes, ton adresse e-mail. Ton pseudonyme et l\'apparence de ton personnage, ta progression '
    + '(argent virtuel, objets, missions, constructions, position dans le jeu), la date de ta dernière connexion et les '
    + 'signalements de bug que tu envoies (avec le lieu du jeu et le type de navigateur). Ni téléphone ni nom réel.'],
  ['Pourquoi', 'Uniquement pour faire fonctionner le jeu, sauvegarder ta partie et corriger les bugs de la bêta. '
    + 'L\'e-mail ne sert qu\'à récupérer ton compte et à te prévenir des changements importants (mot de passe, adresse, '
    + 'connexion bloquée) ; il est envoyé par notre prestataire d\'e-mails, Resend. '
    + 'Rien n\'est vendu ni partagé. Le nom de ton personnage (ton nom d\'utilisateur) est visible des autres joueurs (maison, parcelle, panneau) ; '
    + 'ton e-mail et ton nom d\'utilisateur ne le sont pas.'],
  ['Données techniques', 'Comme tout site, le serveur voit ton adresse IP le temps de la connexion (journaux techniques). '
    + 'Ta session est un jeton conservé sur ton appareil ; le serveur n\'en garde qu\'une empreinte. Elle expire après '
    + '30 jours sans jouer (180 jours au plus).'],
  ['Argent', 'Le franc CFA du jeu est virtuel : aucun paiement réel, aucune conversion, aucune donnée bancaire.'],
  ['Durée et suppression', 'Les données sont conservées pendant la bêta. Tu peux supprimer ton compte et toutes ses '
    + 'données à tout moment dans ⚙️ Réglages → « Supprimer mon compte ».'],
];

const privacyContent = () => PRIVACY.flatMap(([title, text]) => [el('h3', {}, title), el('p', {}, text)]);

/** Notice de données en plein écran (depuis l'inscription). */
export function privacyDialog(onBack = () => location.reload()) {
  showScreen(el('h2', {}, 'Tes données dans la bêta'), ...privacyContent(),
    el('button', { class: 'primary', onclick: onBack }, 'Retour'));
}

/** Section « Mon compte » des réglages : identifiants, changement de mot de passe, déconnexion. */
function accountSection() {
  const info = el('dl', { class: 'facts', id: 'account-info' }, el('dt', {}, 'Chargement…'));
  const emailNote = el('div', { id: 'email-note' });
  const emailStatus = el('p', { class: 'muted', role: 'status' });
  const showAccount = (account) => {
    info.replaceChildren(
      el('dt', {}, "Nom d'utilisateur"), el('dd', {}, account.username || '—'),
      el('dt', {}, 'E-mail de récupération'), el('dd', {}, account.email ? `${account.email} ✓` : 'aucune adresse confirmée'),
    );
    const notes = [];
    if (account.pending_email) {
      notes.push(el('p', { class: 'muted' }, `En attente de confirmation : ${account.pending_email}. Ouvre le lien reçu `
        + 'par e-mail (pense aux indésirables).'));
      const again = el('button', { type: 'button', id: 'btn-email-resend' }, 'Renvoyer le lien');
      again.addEventListener('click', async () => {
        again.disabled = true;
        try {
          showAccount((await api.resendEmail()).account);
          emailStatus.textContent = 'Lien renvoyé.';
        } catch (err) {
          emailStatus.textContent = accountError(err);
        }
        again.disabled = false;
      });
      notes.push(again);
    } else if (!account.email) {
      notes.push(el('p', { class: 'error' }, 'Sans adresse e-mail confirmée, tu ne pourras pas récupérer ton compte si tu '
        + 'oublies ton mot de passe ou s\'il est piraté.'));
    }
    emailNote.replaceChildren(...notes);
  };
  api.account().then(({ account }) => showAccount(account))
    .catch(() => info.replaceChildren(el('dt', {}, 'Indisponible hors ligne.')));

  // Ajouter / changer / retirer l'adresse : le mot de passe actuel est exigé.
  const newEmail = field('email-new', 'Nouvelle adresse e-mail', { type: 'email', autocomplete: 'email', maxlength: 254,
    autocapitalize: 'none' });
  const emailPwd = field('email-password', 'Mot de passe actuel', { type: 'password', autocomplete: 'current-password', maxlength: 128 });
  const emailForm = accountForm('email-form', 'Envoyer le lien de confirmation', [...newEmail.nodes, ...emailPwd.nodes,
    el('small', { class: 'muted' }, 'L\'ancienne adresse reste active tant que la nouvelle n\'est pas confirmée.')],
  async (fail) => {
    emailStatus.textContent = '';
    if (!newEmail.input.value.trim()) fail('Indique la nouvelle adresse.');
    showAccount((await api.setEmail(newEmail.input.value.trim(), emailPwd.input.value)).account);
    emailForm.reset();
    emailStatus.textContent = 'Lien de confirmation envoyé à la nouvelle adresse.';
  });
  const removeEmail = el('button', { type: 'button', class: 'ghost small' }, 'Retirer mon adresse e-mail');
  removeEmail.addEventListener('click', async () => {
    if (!emailPwd.input.value) { emailStatus.textContent = 'Saisis ton mot de passe actuel pour retirer l\'adresse.'; return; }
    if (!window.confirm('Retirer ton adresse ? Tu ne pourras plus récupérer ton compte en cas d\'oubli du mot de passe.')) return;
    try {
      showAccount((await api.setEmail('', emailPwd.input.value)).account);
      emailForm.reset();
      emailStatus.textContent = 'Adresse retirée.';
    } catch (err) {
      emailStatus.textContent = accountError(err);
    }
  });
  emailForm.append(removeEmail);

  const current = field('pwd-current', 'Mot de passe actuel', { type: 'password', autocomplete: 'current-password', maxlength: 128 });
  const next = passwordFields('pwd-new', 'Nouveau mot de passe');
  const status = el('p', { class: 'muted', role: 'status' });
  const change = accountForm('password-form', 'Changer le mot de passe', [...current.nodes, ...next.nodes], async (fail) => {
    status.textContent = '';
    const bad = next.check();
    if (bad) fail(bad);
    await api.changePassword(current.input.value, next.value());
    change.reset();
    status.textContent = 'Mot de passe changé. Tes autres appareils ont été déconnectés.';
  });

  const logout = (everywhere) => async () => {
    if (everywhere && !window.confirm('Déconnecter tous tes appareils, y compris celui-ci ?')) return;
    try { await api.logout(everywhere); } catch { /* hors ligne : on oublie quand même la session locale */ }
    auth.token = null;
    location.reload();
  };
  return [
    el('h3', {}, 'Mon compte'),
    info,
    emailNote,
    el('details', { id: 'email-details' }, el('summary', {}, 'Ajouter ou changer mon adresse e-mail'), emailForm),
    emailStatus,
    el('details', {}, el('summary', {}, 'Changer mon mot de passe'), change, status),
    el('div', { class: 'buttons' },
      el('button', { onclick: logout(false) }, 'Se déconnecter'),
      el('button', { class: 'ghost', onclick: logout(true) }, 'Déconnecter tous mes appareils')),
  ];
}

export function settingsPanel() {
  // Créés une seule fois : le panneau est re-rendu à chaque mise à jour d'état.
  const account = accountSection();
  const ledger = el('div', { class: 'ledger' }, el('p', { class: 'muted' }, 'Chargement de l\'historique…'));
  const bugText = el('textarea', { id: 'bug-text', rows: 3, maxlength: 1000, placeholder: 'Ce qui s\'est passé, ce que tu attendais…' });
  const bugStatus = el('p', { class: 'muted', role: 'status' });
  const sendBug = el('button', {
    class: 'primary',
    onclick: async () => {
      sendBug.disabled = true;
      try {
        await api.reportBug(bugText.value.trim(), store.pos.zone);
        bugText.value = '';
        bugStatus.textContent = 'Merci ! Ton signalement a bien été envoyé.';
      } catch (err) {
        bugStatus.textContent = err.message;
      }
      sendBug.disabled = false;
    },
  }, 'Envoyer le signalement');
  const privacy = el('div', {});
  privacy.append(el('button', { class: 'ghost', onclick: () => privacy.replaceChildren(...privacyContent()) }, 'Ce que nous enregistrons'));
  fetchLedger(ledger);
  ui.open('Réglages', '', () => {
    return [
      ...account,
      el('h3', {}, 'Mes derniers mouvements'),
      ledger,
      el('h3', {}, 'Signaler un bug'),
      el('label', { for: 'bug-text', class: 'muted' }, 'Décris le problème (5 à 1 000 caractères).'),
      bugText, sendBug, bugStatus,
      el('h3', {}, 'Mes données'),
      privacy,
      el('div', { class: 'buttons' },
        el('button', {
          class: 'danger',
          onclick: async () => {
            if (!window.confirm('Effacer définitivement ce personnage et recommencer ?')) return;
            await api.deleteCharacter();
            location.reload();
          },
        }, 'Recommencer une partie'),
        el('button', {
          class: 'danger',
          onclick: async () => {
            if (!window.confirm('Supprimer définitivement ton compte et toutes ses données (personnage, maison, parcelle, '
              + 'signalements) ? Tu ne pourras plus te connecter avec ce compte.')) return;
            try {
              await api.deleteAccount();
              auth.token = null;
              location.reload();
            } catch (err) {
              ui.toast(err.message, 'error');
            }
          },
        }, 'Supprimer mon compte')),
    ];
  });
}

async function fetchLedger(container) {
  try {
    const res = await fetch('/api/ledger', { headers: { Authorization: `Bearer ${auth.token}` } }).then((r) => r.json());
    container.replaceChildren(...res.entries.map((e) => el('div', { class: 'row' },
      el('div', { class: 'grow' }, el('strong', {}, e.description), el('small', {}, new Date(e.at).toLocaleString('fr-FR'))),
      el('span', { class: e.amount >= 0 ? 'pos' : 'neg' }, `${e.amount > 0 ? '+' : ''}${e.amount.toLocaleString('fr-FR')} F`))));
  } catch {
    container.replaceChildren(el('p', { class: 'muted' }, 'Historique indisponible hors ligne.'));
  }
}
