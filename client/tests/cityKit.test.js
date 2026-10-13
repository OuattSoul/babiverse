import { describe, expect, it } from 'vitest';
import { fitScale, HEIGHT_BOOST, houseChoice, HOUSES, INSET, isShop, recolor, treeVariation } from '../src/engine3d/kitPlan.js';
import { BUILDINGS, buildingRect } from '../src/world/city.js';

const SIZES = { 'building-type-g': { w: 1.45, h: 0.77, d: 1.18 }, 'building-type-o': { w: 1.27, h: 1.14, d: 1.03 } };
const sizeOf = (m) => SIZES[m] || { w: 1.3, h: 0.8, d: 1.0 };
const house = (facade, facing = 'S', extra = {}) => ({ id: 'test', x0: 0, y0: 0, facade, facing, ...extra });

describe('modèles de la ville : choix et placement', () => {
  it('porte du modèle du côté de la case de porte (façade au sud), sinon miroir', () => {
    const g = ['building-type-g'];
    // g a sa porte à gauche (-0,49) : porte à gauche → tel quel, porte à droite → miroir.
    expect(houseChoice(house('DW'), sizeOf, g)).toMatchObject({ model: 'building-type-g', mirror: false });
    expect(houseChoice(house('HD'), sizeOf, g)).toMatchObject({ mirror: true });
  });

  it('façade au nord : gauche et droite inversées par le demi-tour', () => {
    const g = ['building-type-g'];
    expect(houseChoice(house('HD', 'N'), sizeOf, g).mirror).toBe(false);
    expect(houseChoice(house('DW', 'N'), sizeOf, g).mirror).toBe(true);
  });

  it('porte rendue près de la case de porte, modèle décalé de 0,2 au plus', () => {
    for (const facade of ['HD', 'DW']) {
      for (const model of Object.keys(HOUSES)) {
        const c = houseChoice(house(facade), sizeOf, [model]);
        const want = facade === 'HD' ? 0.5 : -0.5;
        expect(Math.abs(c.shift)).toBeLessThanOrEqual(0.2 + 1e-9);
        expect(c.door * want).toBeGreaterThan(0); // porte rendue du même côté que la case de porte
      }
    }
    const g = houseChoice(house('HD'), sizeOf, ['building-type-g']);
    expect(Math.abs(g.door - 0.5)).toBeLessThan(0.1);
  });

  it('le modèle tient dans l\'emprise du bâtiment (2 × 2 cases moins le retrait)', () => {
    for (const model of Object.keys(SIZES)) {
      const { scale } = houseChoice(house('HD'), sizeOf, [model]);
      const size = SIZES[model];
      expect(size.w * scale.x).toBeLessThanOrEqual(2 - INSET + 1e-9);
      expect(size.d * scale.z).toBeLessThanOrEqual(2 - INSET + 1e-9);
    }
    expect(fitScale({ w: 1, h: 1, d: 2 }, { w: 1.7, d: 1.7 })).toEqual({ x: 0.85, y: 0.85 * HEIGHT_BOOST, z: 0.85 });
  });

  it('chaque bâtiment de la ville a toujours le même modèle ; commerces et maisons ont leurs listes', () => {
    for (const b of BUILDINGS) {
      const r = { ...b, ...buildingRect(b) };
      expect(houseChoice(r, sizeOf)).toEqual(houseChoice(r, sizeOf));
      expect(Object.keys(HOUSES)).toContain(houseChoice(r, sizeOf).model);
    }
    expect(isShop(BUILDINGS.find((b) => b.id === 'epicerie'))).toBe(true);
    expect(isShop(BUILDINGS.find((b) => b.id === 'kouassi'))).toBe(false);
    const models = new Set(BUILDINGS.map((b) => houseChoice({ ...b, ...buildingRect(b) }, sizeOf).model));
    expect(models.size).toBeGreaterThan(2); // la rue n'est pas faite d'une seule maison répétée
  });
});

describe('palette repeinte', () => {
  // Palette 4×2 : zone de 2×2 en dégradé (clair en haut), le reste intact.
  const pixels = () => new Uint8ClampedArray([
    200, 200, 200, 255, 200, 200, 200, 255, 9, 9, 9, 255, 9, 9, 9, 255,
    100, 100, 100, 255, 100, 100, 100, 255, 9, 9, 9, 255, 9, 9, 9, 255,
  ]);

  it('prend la couleur voulue en gardant le dégradé, sans toucher au reste', () => {
    const data = pixels();
    recolor(data, 4, [0, 0, 2, 2], '#c0392b');
    const top = [...data.slice(0, 3)];
    const bottom = [...data.slice(16, 19)];
    expect(top[0]).toBeGreaterThan(top[1]); // rouge dominant
    expect(top[0]).toBeGreaterThan(bottom[0]); // dégradé conservé
    expect([...data.slice(8, 11)]).toEqual([9, 9, 9]);
    // Moyenne de la zone ≈ couleur cible.
    expect(Math.round((top[0] + bottom[0]) / 2)).toBeGreaterThan(0xc0 - 4);
    expect(Math.round((top[0] + bottom[0]) / 2)).toBeLessThan(0xc0 + 4);
  });
});

describe('végétation', () => {
  it('variation stable selon la case, dans des bornes raisonnables', () => {
    expect(treeVariation(3, 4)).toEqual(treeVariation(3, 4));
    for (let x = 0; x < 30; x++) {
      const v = treeVariation(x, 7);
      expect(v.scale).toBeGreaterThanOrEqual(0.9);
      expect(v.scale).toBeLessThanOrEqual(1.1);
      expect(v.rot).toBeGreaterThanOrEqual(0);
      expect(v.rot).toBeLessThan(Math.PI * 2);
    }
  });
});
