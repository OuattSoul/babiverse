// Conditions de passage des portes (cartes publiées par l'atelier). Module pur.
// Même registre que le serveur du jeu (backend/game/maps.py, conditions_met) : le client ne fait qu'expliquer
// pourquoi un passage est fermé ; c'est le serveur qui accepte ou refuse l'arrivée sur la carte.
export const CONDITION_TYPES = ['mission_completed', 'min_balance'];
const fmt = (n) => `${Math.round(n).toLocaleString('fr-FR')} F`;

/** Raison pour laquelle le passage est fermé à ce joueur, ou null s'il est ouvert. Condition inconnue = fermé. */
export function conditionReason(conditions = [], store = {}) {
  for (const c of conditions) {
    if (c?.type === 'mission_completed') {
      const m = (store.state?.missions || []).find((x) => x.id === c.mission);
      if (!m || !['completed', 'rewarded'].includes(m.status)) {
        const title = (store.config?.missions || []).find((x) => x.id === c.mission)?.title || c.mission;
        return `Termine d'abord la mission « ${title} ».`;
      }
    } else if (c?.type === 'min_balance') {
      if (!((store.state?.character?.balance ?? 0) >= c.amount)) return `Il te faut au moins ${fmt(c.amount)} sur toi.`;
    } else {
      return 'Passage fermé.';
    }
  }
  return null;
}
