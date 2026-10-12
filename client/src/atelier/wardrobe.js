// Garde-robe de l'atelier à la création du personnage (module pur, sans DOM) : genre, silhouettes et
// composants compatibles, robe ou haut + bas, tirage au hasard limité au genre choisi.
// Mêmes règles que le serveur (backend/game/atelier.py → clean_look).

/** Emplacements portables, dans l'ordre de l'écran : [emplacement, libellé, choix « rien » (null = obligatoire)]. */
export const WARDROBE_SECTIONS = [
  ['hair', 'Coiffure', 'Rasé'],
  ['top', 'Haut', null],
  ['bottom', 'Bas', null],
  ['dress', 'Robe ou boubou', 'Aucune'],
  ['outerwear', 'Veste', 'Aucune'],
  ['shoes', 'Chaussures', null],
  ['headwear', 'Chapeau, casquette, foulard', 'Aucun'],
  ['hair_accessory', 'Accessoire de cheveux', 'Aucun'],
  ['glasses', 'Lunettes', 'Aucunes'],
  ['jewelry', 'Bijoux', 'Aucun'],
  ['watch', 'Montre', 'Aucune'],
  ['bag', 'Sac', 'Aucun'],
  ['beard', 'Barbe et moustache', 'Aucune'],
  ['makeup', 'Maquillage', 'Aucun'],
];
export const GENDER_LABELS = { female: 'Féminin', male: 'Masculin' };
// Probabilité de porter un élément facultatif lors d'un tirage au hasard
const CHANCE = { hair: 0.9, outerwear: 0.15, headwear: 0.15, hair_accessory: 0.15, glasses: 0.15, jewelry: 0.25,
  watch: 0.2, bag: 0.2, beard: 0.3, makeup: 0.45 };

const pick = (list, rng) => list[Math.floor(rng() * list.length)];

/** Genre d'une silhouette : déclaré dans l'atelier, sinon déduit du nom (ancien pack). */
export function genderOf(body) {
  if (!body) return null;
  if (body.gender === 'male' || body.gender === 'female') return body.gender;
  return /f[ée]m|femme/i.test(`${body.name} ${body.id}`) ? 'female' : 'male';
}

/** Genres proposés, dans l'ordre Féminin puis Masculin, d'après les silhouettes publiées. */
export function gendersOf(w) {
  const present = new Set(w.bodies.map(genderOf));
  return Object.keys(GENDER_LABELS).filter((g) => present.has(g));
}

export const bodiesOf = (w, gender) => w.bodies.filter((b) => genderOf(b) === gender);

/** Un composant va-t-il sur cette silhouette ? (silhouettes permises et genre réservé) */
export function fits(e, body) {
  if (!e || !body) return false;
  if (e.bodies?.length && !e.bodies.includes(body.id)) return false;
  return !e.genders?.length || e.genders.includes(genderOf(body));
}

/** Composants de cet emplacement portables par la silhouette choisie. */
export const optionsFor = (w, slot, body) => (w.slots[slot] || []).filter((e) => fits(e, body));

export const colorsOf = (w, e) => (e.palette?.primary?.length ? e.palette.primary : w.cloth_colors);

/**
 * Sélection modifiable : { gender, body, skin, hair_color, layers{slot: {part, colors} | null} }.
 * Toutes les opérations gardent une tenue cohérente : rien d'incompatible, robe OU haut + bas.
 */
export function createChoice(w) {
  const choice = { gender: null, body: null, skin: w.skin_tones[0], hair_color: w.hair_colors[0], layers: {} };
  const bodyOf = () => w.bodies.find((b) => b.id === choice.body);
  const part = (slot) => {
    const layer = choice.layers[slot];
    return layer ? (w.slots[slot] || []).find((e) => e.id === layer.part) || null : null;
  };
  const layerOf = (e, color) => ({
    part: e.id,
    colors: e.channels.includes('primary') ? { primary: color || e.default_colors?.primary || colorsOf(w, e)[0] } : {},
  });

  const api = {
    choice,
    body: bodyOf,
    part,
    options: (slot) => optionsFor(w, slot, bodyOf()),

    /** Porte `e` (ou rien) à cet emplacement ; une robe retire haut et bas, un haut ou un bas retire la robe. */
    wear(slot, e, color) {
      choice.layers[slot] = e ? layerOf(e, color) : null;
      if (slot === 'dress' && e) { choice.layers.top = null; choice.layers.bottom = null; }
      if ((slot === 'top' || slot === 'bottom') && e) choice.layers.dress = null;
      api.complete();
    },

    /** Retire ce qui ne va plus sur la silhouette et complète la tenue (haut + bas si pas de robe, chaussures). */
    complete() {
      const body = bodyOf();
      for (const [slot] of WARDROBE_SECTIONS) if (choice.layers[slot] && !fits(part(slot), body)) choice.layers[slot] = null;
      const first = (slot) => optionsFor(w, slot, body)[0];
      if (!choice.layers.dress) {
        for (const slot of ['top', 'bottom']) if (!choice.layers[slot] && first(slot)) choice.layers[slot] = layerOf(first(slot));
      }
      if (!choice.layers.shoes && first('shoes')) choice.layers.shoes = layerOf(first('shoes'));
    },

    /** Change de silhouette (du même genre ou non) en gardant ce qui lui va. */
    setBody(id) {
      const body = w.bodies.find((b) => b.id === id);
      if (!body) return;
      choice.body = id;
      choice.gender = genderOf(body);
      api.complete();
    },

    /** Change de genre : seules les silhouettes et tenues de ce genre restent proposées. */
    setGender(gender) {
      if (choice.gender === gender) return;
      const bodies = bodiesOf(w, gender);
      if (!bodies.length) return;
      api.setBody(bodies[0].id);
    },

    /** Tirage au hasard parmi les silhouettes et composants du genre actif (jamais de l'autre genre). */
    randomize(rng = Math.random) {
      const bodies = bodiesOf(w, choice.gender);
      const body = pick(bodies.length ? bodies : w.bodies, rng);
      choice.body = body.id;
      choice.gender = genderOf(body);
      choice.skin = pick(w.skin_tones, rng);
      choice.hair_color = pick(w.hair_colors.slice(0, 5), rng);
      choice.layers = {};
      const put = (slot, chance = 1) => {
        const opts = optionsFor(w, slot, body);
        if (!opts.length || rng() >= chance) return;
        const e = pick(opts, rng);
        choice.layers[slot] = layerOf(e, pick(colorsOf(w, e), rng));
      };
      if (optionsFor(w, 'dress', body).length && rng() < (choice.gender === 'female' ? 0.4 : 0.12)) put('dress');
      else { put('top'); put('bottom'); }
      put('shoes');
      for (const [slot, chance] of Object.entries(CHANCE)) put(slot, chance);
      api.complete();
    },

    /** Reprend une apparence enregistrée ({body, skin, hair_color, layers}) ; false si sa silhouette n'existe plus. */
    restore(look) {
      const body = look && w.bodies.find((b) => b.id === look.body);
      if (!body) return false;
      choice.body = body.id;
      choice.gender = genderOf(body);
      if (w.skin_tones.includes(look.skin)) choice.skin = look.skin;
      if (w.hair_colors.includes(look.hair_color)) choice.hair_color = look.hair_color;
      choice.layers = {};
      for (const [slot] of WARDROBE_SECTIONS) {
        const layer = look.layers?.[slot];
        const e = layer && (w.slots[slot] || []).find((x) => x.id === layer.part);
        if (e && fits(e, body)) choice.layers[slot] = { part: e.id, colors: { ...(layer.colors || {}) } };
      }
      api.complete();
      return true;
    },
  };
  return api;
}
