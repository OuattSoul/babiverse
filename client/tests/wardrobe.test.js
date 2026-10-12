import { describe, expect, it } from 'vitest';
import { bodiesOf, createChoice, fits, genderOf, gendersOf, optionsFor } from '../src/atelier/wardrobe.js';

const part = (id, slot, extra = {}) => ({ id, name: id, slot, bodies: [], genders: [], palette: {}, default_colors: {}, channels: ['primary'], ...extra });

// Garde-robe d'un pack : deux silhouettes par genre, composants réservés (maquillage, talons, robe, barbe, cravate)
const W = {
  bodies: [
    part('homme', 'body', { gender: 'male' }), part('homme-fort', 'body', { gender: 'male' }),
    part('femme', 'body', { gender: 'female' }), part('femme-ronde', 'body', { gender: 'female' }),
  ],
  slots: {
    hair: [part('afro', 'hair'), part('chignon', 'hair', { genders: ['female'] })],
    top: [part('tshirt', 'top'), part('chemise-cravate', 'top', { genders: ['male'] }), part('blouse', 'top', { genders: ['female'] })],
    bottom: [part('jean', 'bottom'), part('jupe', 'bottom', { genders: ['female'] })],
    dress: [part('robe', 'dress', { genders: ['female'] })],
    shoes: [part('baskets', 'shoes'), part('talons', 'shoes', { genders: ['female'] })],
    headwear: [part('casquette', 'headwear'), part('foulard', 'headwear', { genders: ['female'] })],
    makeup: [part('rouge', 'makeup', { genders: ['female'] })],
    beard: [part('barbe', 'beard', { genders: ['male'] })],
    bag: [part('sac-main', 'bag', { genders: ['female'] }), part('sac-dos', 'bag', { bodies: ['homme-fort'] })],
  },
  skin_tones: ['#f1c27d', '#8d5524'], hair_colors: ['#111111', '#b0b0b0'], cloth_colors: ['#e67e22', '#2980b9'],
};
const byId = Object.fromEntries([...W.bodies, ...Object.values(W.slots).flat()].map((e) => [e.id, e]));
const worn = (choice) => Object.entries(choice.layers).filter(([, l]) => l).map(([slot, l]) => [slot, byId[l.part]]);
const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

describe('garde-robe : genre', () => {
  it('genre déclaré, sinon déduit du nom ; genres proposés', () => {
    expect(genderOf({ id: 'x', name: 'Corps silhouette féminine' })).toBe('female');
    expect(genderOf({ id: 'x', name: 'Corps silhouette masculine' })).toBe('male');
    expect(genderOf(W.bodies[2])).toBe('female');
    expect(gendersOf(W)).toEqual(['female', 'male']);
    expect(bodiesOf(W, 'male').map((b) => b.id)).toEqual(['homme', 'homme-fort']);
  });

  it('seuls les composants du genre et de la silhouette sont proposés', () => {
    const homme = byId.homme;
    expect(fits(byId.rouge, homme)).toBe(false);
    expect(fits(byId.barbe, homme)).toBe(true);
    expect(optionsFor(W, 'shoes', homme).map((e) => e.id)).toEqual(['baskets']);
    expect(optionsFor(W, 'dress', homme)).toEqual([]);
    expect(optionsFor(W, 'bag', homme)).toEqual([]); // sac à dos : silhouette forte seulement
    expect(optionsFor(W, 'bag', byId['homme-fort']).map((e) => e.id)).toEqual(['sac-dos']);
    expect(optionsFor(W, 'top', byId.femme).map((e) => e.id)).toEqual(['tshirt', 'blouse']);
  });

  it('changer de genre retire tout ce qui est réservé à l\'autre et garde une tenue complète', () => {
    const sel = createChoice(W);
    sel.setGender('female');
    sel.wear('makeup', byId.rouge);
    sel.wear('shoes', byId.talons);
    sel.wear('hair', byId.chignon);
    sel.wear('dress', byId.robe);
    expect(sel.choice.layers.top).toBeNull();
    sel.setGender('male');
    expect(sel.choice.gender).toBe('male');
    expect(bodiesOf(W, 'male').map((b) => b.id)).toContain(sel.choice.body);
    for (const [, e] of worn(sel.choice)) expect(fits(e, sel.body())).toBe(true);
    expect(sel.choice.layers.top?.part).toBe('tshirt');
    expect(sel.choice.layers.bottom?.part).toBe('jean');
    expect(sel.choice.layers.shoes?.part).toBe('baskets');
  });

  it('robe OU haut + bas', () => {
    const sel = createChoice(W);
    sel.setGender('female');
    sel.wear('dress', byId.robe);
    expect([sel.choice.layers.top, sel.choice.layers.bottom]).toEqual([null, null]);
    sel.wear('top', byId.blouse);
    expect(sel.choice.layers.dress).toBeNull();
    expect(sel.choice.layers.bottom?.part).toBe('jean'); // complété
    sel.wear('dress', byId.robe);
    sel.wear('dress', null);
    expect(sel.choice.layers.top?.part).toBe('tshirt');
  });
});

describe('garde-robe : au hasard', () => {
  it('le tirage reste dans le genre actif, jamais de mélange', () => {
    for (const gender of ['female', 'male']) {
      const sel = createChoice(W);
      sel.setGender(gender);
      const rng = seeded(gender === 'male' ? 7 : 11);
      for (let i = 0; i < 300; i++) {
        sel.randomize(rng);
        expect(sel.choice.gender).toBe(gender);
        expect(genderOf(sel.body())).toBe(gender);
        for (const [, e] of worn(sel.choice)) expect(fits(e, sel.body())).toBe(true);
        const l = sel.choice.layers;
        expect(!!l.dress || (!!l.top && !!l.bottom)).toBe(true);
      }
    }
  });

  it('le tirage parcourt les silhouettes et composants du genre', () => {
    const sel = createChoice(W);
    sel.setGender('female');
    const seen = new Set();
    const rng = seeded(3);
    for (let i = 0; i < 300; i++) {
      sel.randomize(rng);
      seen.add(sel.choice.body);
      for (const [, e] of worn(sel.choice)) seen.add(e.id);
    }
    for (const id of ['femme', 'femme-ronde', 'robe', 'talons', 'rouge', 'chignon', 'foulard', 'sac-main']) expect(seen).toContain(id);
    for (const id of ['homme', 'barbe', 'chemise-cravate', 'sac-dos']) expect(seen).not.toContain(id);
  });

  it('reprend une apparence enregistrée en écartant ce qui ne va plus', () => {
    const sel = createChoice(W);
    expect(sel.restore({ body: 'inconnu' })).toBe(false);
    expect(sel.restore({ body: 'homme', skin: '#8d5524', layers: {
      top: { part: 'tshirt', colors: { primary: '#2980b9' } }, makeup: { part: 'rouge' }, beard: { part: 'barbe' },
    } })).toBe(true);
    expect(sel.choice.gender).toBe('male');
    expect(sel.choice.skin).toBe('#8d5524');
    expect(sel.choice.layers.makeup).toBeUndefined();
    expect(sel.choice.layers.beard.part).toBe('barbe');
    expect(sel.choice.layers.bottom.part).toBe('jean');
  });
});
