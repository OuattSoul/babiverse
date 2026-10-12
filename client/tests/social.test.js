import { describe, expect, it } from 'vitest';
import {
  clockOf, followSpeed, mergeMessages, nearestPlayer, newOutcomes, nextIncoming, noticeActions, noticeText, secondsLeft,
} from '../src/world/social.js';

const other = { id: 7, name: 'Mariam' };
const note = (fields) => ({ id: 1, kind: 'chat', status: 'pending', direction: 'in', other, read: false, ...fields });

describe('rencontres entre joueurs', () => {
  it('trouve le joueur le plus proche à portée', () => {
    const players = [{ id: 1, x: 200, y: 100 }, { id: 2, x: 150, y: 100 }, { id: 3, x: 500, y: 500 }];
    expect(nearestPlayer({ x: 100, y: 100 }, players, 96).id).toBe(2);
    expect(nearestPlayer({ x: 100, y: 100 }, players, 40)).toBeNull();
    expect(nearestPlayer({ x: 100, y: 100 }, [], 96)).toBeNull();
  });

  it('suit un joueur distant à la vitesse qui comble l\'écart en un intervalle', () => {
    expect(followSpeed({ x: 0, y: 0 }, { x: 230, y: 0 }, 2)).toBe(115);
    expect(followSpeed({ x: 0, y: 0 }, { x: 0, y: 0 }, 2)).toBe(0);
  });

  it('décrit les notifications reçues et les réponses', () => {
    expect(noticeText(note())).toBe('Mariam veut discuter avec toi');
    expect(noticeText(note({ kind: 'friend' }))).toBe('Mariam veut devenir ton ami');
    expect(noticeText(note({ kind: 'call', status: 'missed' }))).toBe('Appel manqué de Mariam');
    expect(noticeText(note({ direction: 'out', status: 'accepted' }))).toBe('Mariam a accepté de discuter');
    expect(noticeText(note({ direction: 'out', kind: 'call', status: 'missed' }))).toBe("Mariam n'a pas répondu à ton appel");
    expect(noticeText(note({ direction: 'out', kind: 'friend', status: 'declined' }))).toBe("Mariam a refusé ta demande d'ami");
  });

  it('propose de répondre, rappeler ou ouvrir la discussion', () => {
    expect(noticeActions(note())).toEqual(['accept', 'decline']);
    // Une demande lue mais sans réponse reste traitable.
    expect(noticeActions(note({ read: true }))).toEqual(['accept', 'decline']);
    expect(noticeActions(note({ kind: 'call', status: 'missed' }))).toEqual(['callback']);
    expect(noticeActions(note({ kind: 'call', status: 'accepted', ended: true }))).toEqual(['callback']);
    expect(noticeActions(note({ status: 'accepted' }), { chats: [7] })).toEqual(['open_chat']);
    expect(noticeActions(note({ status: 'declined' }))).toEqual([]);
  });

  it('montre une seule fois chaque demande reçue non lue (les appels ont leur écran)', () => {
    const list = [note({ id: 3, kind: 'call' }), note({ id: 2, read: true }), note({ id: 1 })];
    expect(nextIncoming(list, new Set()).id).toBe(1);
    expect(nextIncoming(list, new Set([1]))).toBeNull();
  });

  it('annonce chaque réponse à mes demandes une seule fois', () => {
    const list = [note({ id: 4, direction: 'out', status: 'accepted' }), note({ id: 5, direction: 'out', status: 'pending' }),
      note({ id: 6, direction: 'out', status: 'declined', read: true })];
    expect(newOutcomes(list, new Set()).map((n) => n.id)).toEqual([4]);
    expect(newOutcomes(list, new Set([4]))).toEqual([]);
  });

  it('range les messages par interlocuteur sans doublon', () => {
    const byPartner = mergeMessages(new Map(), [{ id: 2, with: 7, text: 'b' }, { id: 1, with: 7, text: 'a' }, { id: 3, with: 9, text: 'c' }]);
    mergeMessages(byPartner, [{ id: 2, with: 7, text: 'b' }]);
    expect(byPartner.get(7).map((m) => m.text)).toEqual(['a', 'b']);
    expect(byPartner.get(9)).toHaveLength(1);
  });

  it('compte à rebours de la sonnerie et durée d\'appel', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    expect(secondsLeft('2026-10-12T10:00:30Z', now)).toBe(30);
    expect(secondsLeft('2026-10-12T09:59:00Z', now)).toBe(0);
    expect(clockOf(75)).toBe('1:15');
  });
});
