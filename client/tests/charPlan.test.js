import { describe, expect, it } from 'vitest';
import { facePaint, gaitFor, hairPaint, hairStyle, LAYOUT, outfitKey, outfitOf, skinPaint, SVG_CROPS } from '../src/engine3d/charPlan.js';

// Garde-robe minimale (comme le pack de l'atelier) : entrée par clé, recherche par identifiant.
const W = {
  fem: { gender: 'female' },
  hom: { gender: 'male' },
  afro: { name: 'Afro' },
  longs: { name: 'Cheveux longs lissés' },
  rase: { name: 'Coupe rase' },
  courte: { name: 'Coupe courte' },
  queue: { name: 'Queue de cheval', default_colors: { primary: '#e84393' } },
  tshirt: { name: 'T-shirt', default_colors: { primary: '#2980b9' } },
  chemise: { name: 'Chemise', default_colors: { primary: '#ecf0f1' } },
  debardeur: { name: 'Débardeur', default_colors: { primary: '#f1c40f' } },
  jean: { name: 'Jean', default_colors: { primary: '#3b5b8c' } },
  short: { name: 'Short', default_colors: { primary: '#16a085' } },
  jupe: { name: 'Jupe', default_colors: { primary: '#c0392b' } },
  robe: { name: 'Robe', default_colors: { primary: '#8e44ad' } },
  boubou: { name: 'Boubou', default_colors: { primary: '#ecf0f1' } },
  veste: { name: 'Veste ouverte', default_colors: { primary: '#34495e' } },
  gilet: { name: 'Gilet sans manches', default_colors: { primary: '#7f8c8d' } },
  baskets: { name: 'Baskets', default_colors: { primary: '#ecf0f1' } },
  barbe: { name: 'Barbe courte' },
  lunettes: { name: 'Lunettes de vue' },
};
const entry = (key) => W[String(key).split('@')[0]] || null;
const svg = (body, layers) => ({ body, skin: '#6f4422', hair_color: '#2b1a12', layers });
const L = (part, primary) => ({ part: `${part}@1`, colors: primary ? { primary } : {} });
const colorsAt = (ops, rect) => ops.filter((o) => o.rect && JSON.stringify(o.rect) === JSON.stringify(rect)).map((o) => o.color);

describe('personnages animés : tenue de l\'atelier', () => {
  it('couleurs choisies, ou couleur par défaut de la pièce', () => {
    const o = outfitOf(null, svg('hom@2', { hair: L('courte'), top: L('tshirt', '#27ae60'), bottom: L('jean'), shoes: L('baskets') }), entry);
    expect(o.colors).toEqual({ skin: '#6f4422', hair: '#2b1a12', top: '#27ae60', bottom: '#3b5b8c', shoes: '#ecf0f1', outer: null });
    expect(o.style).toMatchObject({ gender: 'male', hair: 'short', sleeves: 'short', skirt: false, shorts: false });
  });

  it('manches : t-shirt courtes, chemise longues, débardeur sans ; boubou longues', () => {
    const sleeves = (top) => outfitOf(null, svg('hom@1', { top: L(top), bottom: L('jean') }), entry).style.sleeves;
    expect(sleeves('tshirt')).toBe('short');
    expect(sleeves('chemise')).toBe('long');
    expect(sleeves('debardeur')).toBe('none');
    expect(outfitOf(null, svg('hom@1', { dress: L('boubou') }), entry).style.sleeves).toBe('long');
  });

  it('robe : haut et bas de sa couleur, jupe ; jupe et short reconnus', () => {
    const o = outfitOf(null, svg('fem@1', { dress: L('robe', '#e67e22') }), entry);
    expect(o.colors.top).toBe('#e67e22');
    expect(o.colors.bottom).toBe('#e67e22');
    expect(o.style).toMatchObject({ gender: 'female', skirt: true });
    expect(outfitOf(null, svg('fem@1', { top: L('tshirt'), bottom: L('jupe') }), entry).style.skirt).toBe(true);
    expect(outfitOf(null, svg('hom@1', { top: L('tshirt'), bottom: L('short') }), entry).style.shorts).toBe(true);
  });

  it('veste (manches longues) ou gilet ; barbe, lunettes ; coiffures', () => {
    const veste = outfitOf(null, svg('hom@1', { top: L('tshirt'), outerwear: L('veste'), bottom: L('jean') }), entry);
    expect(veste.style).toMatchObject({ jacket: true, vest: false });
    expect(veste.colors.outer).toBe('#34495e');
    expect(outfitOf(null, svg('hom@1', { top: L('tshirt'), outerwear: L('gilet') }), entry).style).toMatchObject({ jacket: false, vest: true });
    expect(outfitOf(null, svg('hom@1', { beard: L('barbe'), glasses: L('lunettes') }), entry).style).toMatchObject({ beard: true, glasses: true });
    expect(outfitOf(null, svg('fem@1', { hair: L('queue') }), entry).colors.hair).toBe('#e84393');
    expect(outfitOf(null, svg('fem@1', { hair: L('queue', '#9b59b6') }), entry).colors.hair).toBe('#9b59b6');
    expect(outfitOf(null, svg('hom@1', {}), entry).style.hair).toBe('bald');
    expect([hairStyle('Afro'), hairStyle('Cheveux longs lissés'), hairStyle('Coupe rase'), hairStyle('Coupe courte')]).toEqual(['afro', 'long', 'bald', 'short']);
  });

  it('apparence classique du jeu (sans atelier) : tresses = femme aux cheveux longs, couleurs reprises', () => {
    const o = outfitOf({ skin: '#c68642', outfit: '#e67e22', pants: '#2c3e50', hair: 'braids' }, null);
    expect(o.style).toMatchObject({ gender: 'female', hair: 'long' });
    expect(o.colors).toMatchObject({ skin: '#c68642', top: '#e67e22', bottom: '#2c3e50' });
  });
});

describe('personnages animés : peinture de la texture', () => {
  const base = { colors: { skin: '#6f4422', hair: '#111111', top: '#27ae60', bottom: '#3b5b8c', shoes: '#ecf0f1', outer: '#34495e' }, style: { hair: 'short', sleeves: 'short', jacket: false, vest: false, shorts: false, beard: false, glasses: false } };

  it('peau partout, haut sur le torse et les bras, bas sur les jambes, chaussures, mains', () => {
    const ops = skinPaint(base);
    expect(ops[0]).toEqual({ rect: [0, 0, 1024, 1024], color: '#6f4422' });
    expect(colorsAt(ops, LAYOUT.torso)).toEqual(['#27ae60']);
    expect(colorsAt(ops, LAYOUT.legs)).toEqual(['#3b5b8c']);
    expect(colorsAt(ops, LAYOUT.shoes)).toEqual(['#ecf0f1']);
    expect(colorsAt(ops, LAYOUT.hands)).toEqual(['#6f4422']);
  });

  it('manches courtes : avant-bras nus ; sans manches : bras nus ; manches longues : rien', () => {
    expect(colorsAt(skinPaint(base), LAYOUT.foreArms[0])).toEqual(['#6f4422']);
    expect(colorsAt(skinPaint(base), LAYOUT.upperArms[0])).toEqual([]);
    expect(colorsAt(skinPaint({ ...base, style: { ...base.style, sleeves: 'none' } }), LAYOUT.upperArms[1])).toEqual(['#6f4422']);
    expect(colorsAt(skinPaint({ ...base, style: { ...base.style, sleeves: 'long' } }), LAYOUT.foreArms[0])).toEqual([]);
  });

  it('veste : torse et bras à sa couleur, haut visible au milieu ; short : tibias nus', () => {
    const veste = skinPaint({ ...base, style: { ...base.style, jacket: true } });
    expect(colorsAt(veste, LAYOUT.torso)).toEqual(['#27ae60', '#34495e']);
    expect(colorsAt(veste, LAYOUT.foreArms[0])).toEqual([]); // manches longues de la veste
    expect(colorsAt(skinPaint({ ...base, style: { ...base.style, shorts: true } }), LAYOUT.shins)).toEqual(['#6f4422']);
  });

  it('cheveux : rien si rasé, nuque plus longue pour les cheveux longs ; visage simple avec barbe et lunettes', () => {
    expect(hairPaint('bald', '#111')).toEqual([]);
    const nape = (h) => hairPaint(h, '#111')[1].rect[3];
    expect(nape('long')).toBeGreaterThan(nape('short'));
    const face = facePaint({ beard: true, glasses: true }, base.colors);
    expect(face.some((o) => o.ring)).toBe(true);
    expect(face.filter((o) => o.color === '#111111').length).toBeGreaterThan(3);
    expect(skinPaint(base, { face: false }).some((o) => o.ellipse)).toBe(false); // visage pris dans la vue SVG
  });

  it('découpes SVG dans le repère 200 × 380, vers les zones de la texture', () => {
    for (const { from, to } of Object.values(SVG_CROPS)) {
      expect(from[0] + from[2]).toBeLessThanOrEqual(200);
      expect(from[1] + from[3]).toBeLessThanOrEqual(380);
      expect(to[0] + to[2]).toBeLessThanOrEqual(1024);
      expect(to[1] + to[3]).toBeLessThanOrEqual(1024);
    }
    expect(outfitKey(base, 'a')).not.toBe(outfitKey(base, 'b'));
  });
});

describe('personnages animés : allure', () => {
  it('repos, marche (course ralentie mêlée au repos), course ; booléen des autres joueurs', () => {
    expect(gaitFor(0)).toMatchObject({ name: 'idle', run: 0 });
    expect(gaitFor(false).name).toBe('idle');
    expect(gaitFor(1)).toMatchObject({ name: 'walk' });
    expect(gaitFor(true).name).toBe('walk');
    expect(gaitFor(1).run).toBeLessThan(1);
    expect(gaitFor(1).rate).toBeLessThan(1);
    expect(gaitFor(1.4)).toMatchObject({ name: 'sprint', run: 1, rate: 1 });
  });
});
