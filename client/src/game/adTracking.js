// Statistiques publicitaires : point d'intégration des futures campagnes.
// MVP : les événements (ouverture de fiche, clic « En savoir plus ») restent en mémoire, sans envoi
// réseau ni donnée personnelle. Une future API de campagne n'aura qu'à vider `pending()` vers le serveur.
const MAX = 200;
const events = [];

export const adTracking = {
  /** type : 'open' | 'click' ; slot : emplacement ; ad : identifiant de l'annonce. */
  track(type, { slot, ad }) {
    events.push({ type, slot, ad, at: new Date().toISOString() });
    if (events.length > MAX) events.shift();
  },
  pending: () => events.slice(),
};
