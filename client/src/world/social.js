// Rencontres entre joueurs : logique pure (sans rendu ni réseau), partagée par la boucle sociale et l'interface.
// Positions en pixels de grille, comme le reste du monde.

export const KINDS = {
  chat: { icon: '💬', action: 'Chatter', noun: 'discussion' },
  call: { icon: '📞', action: 'Appeler', noun: 'appel' },
  friend: { icon: '🤝', action: 'Ajouter ami', noun: "demande d'ami" },
};

/** Joueur le plus proche à moins de `range` pixels, ou null. */
export function nearestPlayer(me, players, range) {
  let best = null;
  let bestD = range;
  for (const p of players) {
    const d = Math.hypot(p.x - me.x, p.y - me.y);
    if (d <= bestD) { best = p; bestD = d; }
  }
  return best;
}

/**
 * Vitesse de suivi d'un joueur distant (px/s) : il parcourt l'écart jusqu'à sa dernière position connue
 * en un intervalle de mise à jour, ce qui donne un déplacement continu malgré des positions espacées.
 */
export function followSpeed(from, to, intervalS) {
  return Math.hypot(to.x - from.x, to.y - from.y) / Math.max(intervalS, 0.1);
}

/** Texte d'une notification (demande reçue, ou réponse à une de mes demandes). */
export function noticeText(n) {
  const who = n.other.name;
  if (n.direction === 'in') {
    if (n.kind === 'call') {
      if (n.status === 'missed') return `Appel manqué de ${who}`;
      if (n.status === 'pending') return `${who} t'appelle`;
      if (n.status === 'declined') return `Tu as refusé l'appel de ${who}`;
      return `Appel avec ${who}`;
    }
    const what = n.kind === 'chat' ? 'veut discuter avec toi' : 'veut devenir ton ami';
    if (n.status === 'pending') return `${who} ${what}`;
    if (n.status === 'accepted') return n.kind === 'chat' ? `Discussion ouverte avec ${who}` : `${who} et toi êtes amis`;
    if (n.status === 'declined') return `Tu as refusé la ${KINDS[n.kind].noun} de ${who}`;
    return `${who} a annulé sa ${KINDS[n.kind].noun}`;
  }
  if (n.kind === 'call') {
    if (n.status === 'missed') return `${who} n'a pas répondu à ton appel`;
    if (n.status === 'declined') return `${who} a refusé ton appel`;
    return `Appel avec ${who}`;
  }
  if (n.status === 'accepted') return n.kind === 'chat' ? `${who} a accepté de discuter` : `${who} a accepté ta demande d'ami`;
  return `${who} a refusé ta ${KINDS[n.kind].noun}`;
}

/** Actions proposées dans la liste des notifications. */
export function noticeActions(n, { chats = [] } = {}) {
  if (n.direction === 'in' && n.status === 'pending' && n.kind !== 'call') return ['accept', 'decline'];
  if (n.kind === 'call' && (n.status === 'missed' || n.status === 'declined' || (n.status === 'accepted' && n.ended))) return ['callback'];
  if (n.kind === 'chat' && n.status === 'accepted' && chats.includes(n.other.id)) return ['open_chat'];
  return [];
}

/** Prochaine demande reçue à afficher en surimpression (non lue, en attente, jamais montrée). Les appels ont leur propre écran. */
export function nextIncoming(notifications, shown) {
  return notifications.find((n) => n.direction === 'in' && n.status === 'pending' && !n.read && n.kind !== 'call' && !shown.has(n.id)) || null;
}

/** Réponses à mes demandes arrivées depuis le dernier passage (non lues, jamais annoncées). */
export function newOutcomes(notifications, announced) {
  return notifications.filter((n) => n.direction === 'out' && n.status !== 'pending' && !n.read && !announced.has(n.id));
}

/** Messages regroupés par interlocuteur, dans l'ordre ; fusionne sans doublon les nouveaux messages reçus. */
export function mergeMessages(byPartner, messages) {
  for (const m of messages) {
    const list = byPartner.get(m.with) || [];
    if (!list.some((x) => x.id === m.id)) {
      list.push(m);
      list.sort((a, b) => a.id - b.id);
    }
    byPartner.set(m.with, list);
  }
  return byPartner;
}

/** Secondes restantes avant une échéance (ISO), selon l'heure du serveur. */
export function secondsLeft(iso, now) {
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

/** Durée d'appel « m:ss ». */
export function clockOf(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
