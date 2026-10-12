import { describe, expect, it } from 'vitest';
import { characterViews, pickView } from '../src/atelier/views.js';
import { placeIcon } from '../src/world/icons.js';
import { BUILDINGS } from '../src/world/city.js';

const part = (slot, front, extra = {}) => ({ slot, z: 40, back_z: 0, props: {}, channels: {}, defs: '', back: '', front, ...extra });
const PARTS = {
  'corps@1': part('body', '<ellipse id="tete" cx="100" cy="64" rx="32" ry="38"/>', { z: 10 }),
  'yeux@1': part('eyes', '<circle class="oeil" cx="86" cy="62" r="3"/>', { z: 52 }),
  'afro@1': part('hair', '<path class="frange" d="M60 62 Q100 10 140 62 Z"/>', { z: 60, back_z: 2, back: '<circle class="masse" cx="100" cy="50" r="54"/>' }),
  'sac@1': part('bag', '<path class="bretelles" d="M76 124 L82 200"/>', { z: 50, back_z: 1, back: '<rect class="sac" x="64" y="126" width="72" height="82"/>' }),
  'tshirt@1': part('top', '<rect class="haut" x="60" y="120" width="80" height="110"/>'),
};
const LOOK = {
  body: 'corps@1', skin: '#8d5524', hair_color: '#111111', height_scale: 1,
  layers: { eyes: { part: 'yeux@1' }, hair: { part: 'afro@1' }, bag: { part: 'sac@1' }, top: { part: 'tshirt@1', colors: { primary: '#c0392b' } } },
};
// ordre d'apparition des calques dans un SVG (le dernier est dessiné par-dessus)
const order = (svg, ...names) => names.map((n) => svg.indexOf(n));

describe('vues des personnages de l’atelier', () => {
  const v = characterViews(LOOK, PARTS);

  it('face : le SVG de l’atelier, calques arrière derrière le corps', () => {
    expect(v.front).toContain('class="oeil"');
    const [masse, tete, haut, sac] = order(v.front, 'class="masse"', 'id="g-body-tete"', 'class="haut"', 'class="sac"');
    expect(masse).toBeLessThan(tete);
    expect(sac).toBeLessThan(haut);
  });

  it('dos : pas de visage, cheveux et sac à dos par-dessus le corps, nuque coiffée', () => {
    expect(v.back).not.toContain('class="oeil"');
    const [tete, haut, masse, sac] = order(v.back, 'id="b-body-tete"', 'class="haut"', 'class="masse"', 'class="sac"');
    expect(masse).toBeGreaterThan(tete);
    expect(sac).toBeGreaterThan(haut);
    expect(v.back).toMatch(/<ellipse cx="100"[^>]*fill:var\(--babi-hair/);
  });

  it('profil : corps aminci, demi-visage découpé, nez, couleurs gardées', () => {
    expect(v.side).toContain('scale(0.55 1)');
    expect(v.side).toContain('class="oeil"');
    expect(v.side).toMatch(/clipPath id="s-eyes-half"/);
    expect(v.side).toContain('url(#s-eyes-half)');
    expect(v.side).toContain('--babi-primary:#c0392b');
    // la frange ne descend pas sur le visage
    expect(v.side).toContain('url(#s-hair-crown)');
  });

  it('identifiants propres à chaque vue (plusieurs vues dans une même page)', () => {
    const ids = (svg) => [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const all = [...ids(v.front), ...ids(v.back), ...ids(v.side)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('choix de la vue selon le cap et la caméra', () => {
    expect(pickView(0)).toEqual({ view: 'front', mirror: false });
    expect(pickView(Math.PI)).toEqual({ view: 'back', mirror: false });
    expect(pickView(Math.PI / 2)).toEqual({ view: 'side', mirror: false });
    expect(pickView(-Math.PI / 2)).toEqual({ view: 'side', mirror: true });
    expect(pickView(3 * Math.PI / 2)).toEqual({ view: 'side', mirror: true });
    // près de 45°, la vue en cours est gardée (pas de clignotement)
    expect(pickView(Math.PI / 4 + 0.05, 'front').view).toBe('front');
    expect(pickView(Math.PI / 4 + 0.05, 'side').view).toBe('side');
    expect(pickView(Math.PI / 4 + 0.2, 'front').view).toBe('side');
  });
});

describe('icônes des lieux', () => {
  it('chaque commerce du jeu a sa propre icône', () => {
    const shops = BUILDINGS.filter((b) => b.category === 'shop');
    const icons = shops.map(placeIcon);
    expect(icons).toEqual(['🛒', '🍲', '📦', '🧵', '💊', '💸']);
    expect(new Set(icons).size).toBe(shops.length);
  });

  it('maison du joueur, constructions et bâtiments placés depuis l’atelier', () => {
    expect(placeIcon({ zone: 'maison', name: 'Maison' })).toBe('🏠');
    expect(placeIcon({ id: 'pb_P01', template: 'boutique', name: 'CHEZ AWA', category: 'shop' })).toBe('🏪');
    expect(placeIcon({ id: 'pb_P02', template: 'maisonnette', name: 'Ma maison' })).toBe('🏡');
    expect(placeIcon({ id: 'a1', name: 'Pharmacie du Plateau', category: 'shop' })).toBe('💊');
    expect(placeIcon({ id: 'a2', name: 'Chez Tantie', category: 'shop', render: { category: 'restaurant' } })).toBe('🍲');
    expect(placeIcon({ id: 'a3', name: 'Salon Élégance', category: 'shop' })).toBe('💇');
    expect(placeIcon({ id: 'a4', name: 'École primaire' })).toBe('🏫');
    expect(placeIcon({ id: 'a5', name: 'Bâtiment B', category: 'shop' })).toBe('🏪');
    expect(placeIcon({ id: 'a6', name: 'Bâtiment C' })).toBe('🏢');
    expect(placeIcon({ id: 'a7', name: 'X', icon: '🎵' })).toBe('🎵');
  });
});
