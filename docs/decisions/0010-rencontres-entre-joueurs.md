# ADR 0010 — Rencontres entre joueurs : présence par interrogation, demandes, discussions et appels vocaux

Statut : accepté (2026-10-12). Premier élément de multijoueur temps réel du jeu (jusqu'ici : monde partagé rafraîchi toutes les 45 s).

## Contexte

Demande : « deux joueurs peuvent se rencontrer dans la ville s'ils s'y trouvent. Lorsqu'ils sont assez proches, afficher une barre contenant chatter, appeler, ajouter ami. Une demande est envoyée à l'autre joueur, qui peut accepter, refuser ou ne rien faire ; dans ce cas la notification demeure mais comme lue. La demande d'appel dure 30 s ; sans réponse, la notification reste pour permettre de rappeler. »

## Décision

1. **Présence par interrogation, pas de WebSocket** : le client envoie sa position toutes les 2 s (`POST /api/social/poll`, 1 s pendant un appel) et reçoit en retour les joueurs visibles de sa zone, ses notifications, ses nouveaux messages et l'appel en cours. Django reste en WSGI, sans Channels ni Redis obligatoire. Un joueur sans nouvelle depuis 10 s (`Character.seen_in_world_at`) disparaît de la ville des autres.
2. **Lieux partagés** : ville et intérieurs publics. « Chez moi » (`maison`, même identifiant pour chacun) et les intérieurs privés (`int_pb_*`, `int_home_*`) ne montrent personne.
3. **Le serveur arbitre** (`services/social.py`, valeurs dans `rules.SOCIAL`) : une demande exige la proximité (5 cases côté serveur, la barre s'affiche à 3 cases côté client — marge pour des positions vieilles de 2 s), sauf entre amis ou pour rappeler quelqu'un avec qui on a déjà échangé un appel ; l'autre joueur doit être présent. Doublons renvoyés tels quels, demande inverse en attente → « réponds-lui », 2 min d'attente après un refus, 30 demandes par heure.
4. **Une demande = une notification** (`SocialRequest`) : `pending` → `accepted` / `declined` ; ignorée, elle reste `pending` avec `read_at` (toujours traitable depuis 🔔). Appel : sonne 30 s puis `missed` (« Rappeler » dans 🔔) ; annulé par l'appelant → `missed` ; décroché → communication jusqu'à `ended_at` (raccroché, ou 20 s sans nouvelle de l'autre). L'expéditeur voit la réponse (`outcome_read_at`).
5. **Discussion** ouverte par une demande acceptée ou entre amis (`ChatMessage`, 500 caractères). **Amis** : `Friendship`, une ligne par paire.
6. **Voix en WebRTC** de navigateur à navigateur ; le serveur relaie seulement offre, réponse et candidats réseau (`CallSignal`, `POST /api/social/signal`). Serveurs ICE configurables (`WEBRTC_ICE_SERVERS`, STUN public de Google par défaut). Sans micro, l'appel reste établi en écoute seule.

## Conséquences

- Charge : environ une requête toutes les 2 s par joueur en jeu (5 à 7 lectures SQL) ; suffisant pour un prototype, à revoir (WebSocket, cache) au-delà de quelques centaines de joueurs simultanés.
- Les autres joueurs se déplacent avec 2 s de retard (suivi interpolé) et ne bloquent pas le passage.
- Sans relais TURN, un appel peut échouer entre certains réseaux mobiles (message « Liaison audio impossible ») ; la discussion écrite reste possible.
- Pas encore de blocage ni de signalement d'un joueur, ni de modération des messages.
