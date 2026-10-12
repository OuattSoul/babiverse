# Architecture

## Vue d'ensemble

```
┌──────────────────────── Navigateur (mobile) ────────────────────────┐
│  A. Monde 3D (Three.js)       C. Client applicatif                  │
│  engine3d/World3D   ◄──────── main.js (démarrage, battement de cœur)│
│  engine3d/CameraRig, actors   ui/ (HUD, invites, panneaux, écrans)   │
│  world/ (pur : grille,        engine3d/input (joystick, clavier, ✋)  │
│   collisions, interactions)   game/actions ── net/api ──┐           │
└──────────────────────────────────────────────────────── │ ──────────┘
                                                 HTTPS JSON│ (actions ciblées)
┌──────────────────────── Serveur Django ───────────────── ▼ ─────────┐
│  D. Backend : views.run_action (auth → verrou → idempotence → temps  │
│     → action dans un point de sauvegarde → instantané d'état)        │
│  B. Simulation : services/core, life, work, business, missions      │
│     rules.py (toutes les valeurs d'équilibrage)                      │
│  E. Persistance : models.py (PostgreSQL / SQLite, migrations)        │
└──────────────────────────────────────────────────────────────────────┘
```

| Bloc | Emplacement | Responsabilités |
|---|---|---|
| A. Monde et moteur | `client/src/engine3d`, `client/src/world` | Rendu 3D, caméra orbitale et gestes, déplacements, recherche de chemin, collisions, PNJ, transitions, interactions |
| B. Simulation | `backend/game/services`, `backend/game/rules.py` | Faim et énergie, inventaire, achats, monnaie, emploi, missions, kiosque, temps virtuel |
| C. Client applicatif | `client/src/main.js`, `ui/`, `net/`, `game/` | Démarrage, contrôles, interfaces secondaires, appels réseau, erreurs et hors-ligne |
| D. Backend | `backend/game/views.py`, `auth.py` | Identité, validation, transactions atomiques, idempotence, règles de temps |
| E. Persistance | `backend/game/models.py`, `migrations/` | Profil, position et zone, solde, inventaire, journal, missions, services, entreprise, horodatages |

Les systèmes de simulation (B) ne connaissent ni le rendu ni l'interface : ils reçoivent un personnage et une intention, et renvoient un résultat ou une `GameError`. Le monde (A) ne connaît pas l'économie. Il interroge le registre `world/interactionTypes.js`, qui lit l'état serveur et appelle `game/actions.js`.

## Flux d'une action (exemple : acheter un pain)

1. Le joueur s'approche de M. Fofana, ou le touche à l'écran : il y marche seul. Toutes les 100 ms, `World3D.scan()` appelle `findTarget()`, qui tient compte de la distance et de la ligne de vue. L'invite « Parler à M. Fofana » s'affiche.
2. ✋ ou **E**, puis « Voir les produits », puis « Acheter ». `actions.buy()` appelle `POST /api/shop/buy` avec `{shop, item, quantity, pos:{zone,x,y}}` et un en-tête `Idempotency-Key` aléatoire.
3. Côté serveur, `run_action` :
   1. authentifie le jeton (hash SHA-256) ;
   2. verrouille la ligne `Character` (`select_for_update`) ;
   3. si la clé a déjà été vue, renvoie le résultat mémorisé ;
   4. applique le temps écoulé : besoins, services expirés, ventes passives ;
   5. enregistre zone et position ;
   6. exécute `life.buy` dans un **point de sauvegarde**. Le serveur vérifie la zone, la quantité, le stock du jour et le solde, puis débite, écrit au journal, ajoute à l'inventaire et fait progresser les missions ;
   7. mémorise le résultat sous la clé et renvoie `{ok, result | error, state}`.
4. Le client remplace son état par `state`. HUD, boutique et monde se rafraîchissent par l'événement `state`. Aucune valeur économique n'est calculée localement.

En cas de coupure réseau, `net/api.js` refait la requête jusqu'à 3 fois **avec la même clé**. Le serveur ne l'applique donc qu'une fois. Si elle échoue, l'action est signalée comme non enregistrée, l'indicateur réseau passe au rouge, et l'exploration continue.

## Synchronisation

- **Pas de requête par image.** Les déplacements sont 100 % locaux.
- **Battement de cœur** toutes les 45 s (`POST /api/sync`) : sauvegarde de la position, avancée des besoins côté serveur, ventes passives.
- **Sauvegarde immédiate** à chaque changement de zone, quand l'onglet passe en arrière-plan et à la fermeture (`fetch keepalive`).
- Chaque réponse contient l'état complet, ce qui est compact pour le MVP. Un numéro `version` permet d'ignorer une réponse arrivée en retard.
- La faim et l'énergie sont **prédites localement** entre deux réponses (`sim/needs.js`) avec les mêmes règles que le serveur, puis corrigées à chaque réponse.

## Identité et sécurité

- **Comptes** (ADR 0006 et 0007) : `POST /api/auth/register` (nom d'utilisateur sans espace, mot de passe haché par Django, e-mail facultatif) puis `POST /api/auth/login` (**nom d'utilisateur** + mot de passe). Chaque connexion ouvre une session `AuthToken` : jeton aléatoire de 192 bits, seul son hash est stocké, conservé côté client dans `localStorage` ; elle expire après 30 jours sans utilisation (180 jours au plus). Déconnexion (`auth/logout`, un appareil ou tous), changement de mot de passe (`auth/password/change`).
- **E-mail de récupération** : facultatif, utilisé seulement une fois confirmé par lien (`auth/email`, `auth/email/resend`, `auth/email/verify`, lien `#verify=` valable 24 h). Récupération par lien à usage unique valable 30 min, envoyé à l'adresse confirmée (`auth/password/forgot` par nom d'utilisateur ou e-mail, puis `auth/password/reset`). Aucune réponse ne révèle si une adresse est inscrite ; les e-mails partent par **Resend** hors de la requête (`game/mail.py`). Verrouillage 15 min après 5 échecs, 10 requêtes/min par IP sur ces routes. Nettoyage quotidien : `python manage.py purge_comptes`.
- Toutes les requêtes portent `Authorization: Bearer <jeton>`. Chaque requête ne lit que le personnage du joueur authentifié. Les identifiants transmis, comme `shift_id`, sont toujours filtrés par ce personnage, avec un test d'isolation dédié.
- Les entrées sont validées : types et bornes des quantités, nom (regex), profil, zone, coordonnées, et apparence prise dans une liste blanche.
- Les erreurs suivent un format uniforme (`{ok:false, error:{code,message}}`) sans trace interne. Les exceptions inattendues sont journalisées côté serveur (logger `game`).
- La limitation de débit DRF s'applique : 30/min sans authentification, 240/min par joueur, 10/min par IP sur les routes de compte.
- Les secrets passent par les variables d'environnement. `DJANGO_SECRET_KEY` est obligatoire quand `DJANGO_DEBUG=0`. Aucun secret ne se trouve dans le client.

## Extensibilité prévue (sans l'implémenter)

- **Nouvelles zones** : ajouter une entrée dans `world/zones.js` et l'identifiant dans `rules.ZONES`. Les portes relient les zones par `target: {zone, spawn}`.
- **Nouveaux objets interactifs** : ajouter un type dans `INTERACTION_TYPES`. Le contrôleur du joueur ne change pas.
- **Comportements de PNJ** : le champ `behavior` (`static`, `wander`) accueillera horaires et trajets.
- **Entreprises** : `BUSINESS_TYPES` est un dictionnaire ; le modèle `Business.type_id` est déjà générique.
- **Comptes** : liste des sessions actives par appareil, file de tâches pour les e-mails, numéro de téléphone.
- **Multijoueur** : hors périmètre. La séparation client/serveur et l'état autoritaire le rendent envisageable.
