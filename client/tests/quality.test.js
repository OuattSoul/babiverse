import { describe, expect, it } from 'vitest';
import { castShadows, qualityFor, shadowExtent, snapToTexel, tooSlow } from '../src/engine3d/quality.js';

describe("qualité d'affichage", () => {
  it('garde l\'anticrénelage sauf sur un téléphone à écran très dense', () => {
    expect(qualityFor({ dpr: 1.5, mobile: true }).antialias).toBe(true);
    expect(qualityFor({ dpr: 3, mobile: true }).antialias).toBe(false);
    expect(qualityFor({ dpr: 2, mobile: false }).antialias).toBe(true);
  });

  it('plafonne la finesse de l\'image et allume les ombres', () => {
    expect(qualityFor({ dpr: 3, mobile: true })).toMatchObject({ pixelRatio: 1.75, shadows: true, maxFps: 0 });
    expect(qualityFor({ dpr: 3, mobile: false }).pixelRatio).toBe(2);
    expect(qualityFor({ dpr: 1, mobile: true }).pixelRatio).toBe(1);
  });

  it('économie de batterie : image moins fine, sans ombres, 30 images par seconde', () => {
    expect(qualityFor({ dpr: 3, mobile: true, saver: true })).toMatchObject({ pixelRatio: 1, shadows: false, maxFps: 30 });
  });

  it('carte des ombres plus petite sur téléphone', () => {
    expect(qualityFor({ mobile: true }).shadowMapSize).toBe(1024);
    expect(qualityFor({ mobile: false }).shadowMapSize).toBe(2048);
  });

  it('jeu durablement saccadé : 12 des 15 dernières secondes sous 24 images par seconde', () => {
    expect(tooSlow(Array(15).fill(18))).toBe(true);
    expect(tooSlow(Array(14).fill(18))).toBe(false); // pas encore 15 mesures
    expect(tooSlow([...Array(12).fill(18), 40, 40, 40])).toBe(true);
    expect(tooSlow([...Array(7).fill(3), ...Array(8).fill(40)])).toBe(false); // saccade passagère
    expect(tooSlow([40, 40, ...Array(15).fill(20)])).toBe(true);
  });

  it('étend la zone des ombres avec le dézoom, dans des limites', () => {
    expect(shadowExtent(5)).toBe(12);
    expect(shadowExtent(40)).toBe(32);
    expect(shadowExtent(200)).toBe(60);
  });

  it('arrondit la position du soleil à un pixel de la carte des ombres', () => {
    const texel = (2 * 32) / 2048;
    const v = snapToTexel(10.01, 32, 2048);
    expect(Math.abs(v / texel - Math.round(v / texel))).toBeLessThan(1e-9);
    expect(Math.abs(v - 10.01)).toBeLessThanOrEqual(texel / 2);
  });
});

describe('ombres des maillages', () => {
  const node = (props, children = []) => ({ ...props, traverse(fn) { fn(this); for (const c of children) c.traverse(fn); } });
  const lit = { isMeshLambertMaterial: true, transparent: false, opacity: 1 };

  it('volumes opaques : projettent et reçoivent ; sol : reçoit seulement ; repères et calques translucides ignorés', () => {
    const wall = node({ isMesh: true, material: lit });
    const ground = node({ isMesh: true, name: 'ground', material: lit });
    const marker = node({ isMesh: true, material: { isMeshBasicMaterial: true } });
    const glass = node({ isMesh: true, material: { transparent: true, opacity: 0.4 } });
    const sprite = node({ isSprite: true, material: lit });
    castShadows(node({}, [wall, ground, marker, glass, sprite]));
    expect([wall.castShadow, wall.receiveShadow]).toEqual([true, true]);
    expect([ground.castShadow, ground.receiveShadow]).toEqual([false, true]);
    for (const o of [marker, glass, sprite]) expect(o.castShadow).toBeUndefined();
  });

  it('un maillage à plusieurs matériaux projette si l\'un d\'eux est éclairé', () => {
    const box = node({ isMesh: true, material: [{ isMeshBasicMaterial: true }, lit] });
    expect(castShadows(box).castShadow).toBe(true);
  });
});
