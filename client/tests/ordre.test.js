// Ordre des positions envoyées au serveur (net/api.js) : horodatage croissant par onglet.
import { describe, expect, it } from 'vitest';
import { CLIENT_ID, stampPos } from '../src/net/api.js';

describe('horodatage des positions', () => {
  it('toute requête portant une position est horodatée, sans modifier l’original', () => {
    const body = { item: 'pain', pos: { zone: 'epicerie', x: 1, y: 2 } };
    const a = stampPos(body);
    const b = stampPos(body);
    expect(body.pos.t).toBeUndefined();
    expect(a.pos).toMatchObject({ zone: 'epicerie', x: 1, y: 2, c: CLIENT_ID });
    expect(b.pos.t).toBeGreaterThanOrEqual(a.pos.t);
    expect(a.item).toBe('pain');
  });

  it('requêtes sans position inchangées', () => {
    const body = { username: 'awa' };
    expect(stampPos(body)).toBe(body);
    expect(stampPos(undefined)).toBeUndefined();
  });
});
