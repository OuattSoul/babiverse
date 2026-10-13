# ADR 0011 — Catalogue des cartes : la carte historique devient la première carte référencée

Statut : accepté (2026-10-13). Phase 1 de l'évolution vers un monde multi-villes (audit : `docs/architecture-audit.md`).

## Contexte

Le jeu ne connaissait ses lieux que par du code : liste fixe `ZONES = ("quartier", "maison", "epicerie")` côté serveur,
objet `ZONES` construit en dur côté client (`world/zones.js`). Pour accueillir plus tard d'autres cartes, communes et villes
sans modifier le moteur, la carte actuelle doit d'abord être référencée par un système de cartes, **sans changer son rendu,
ses coordonnées, ses collisions, ses interactions ni les données des joueurs**.

## Décision

1. **Catalogue partagé `shared/maps.json`**, lu par le serveur et par le client comme `shared/city.json` : villes, zones
   (communes, quartiers), cartes. Une carte = une zone du jeu, même identifiant que `Character.zone`. Entrées actuelles :
   Abidjan › Cité Akwaba › `quartier` (extérieur), `maison` (logement), `epicerie` (intérieur), plus la règle des intérieurs
   générés (`int_…`, motif inchangé). Carte de départ : `maison`.
2. **Cartes de type « generator »** : la carte historique n'est pas convertie en données. Le catalogue nomme un générateur
   (`city`, `studio`, `epicerie`, `interior`) et le client l'exécute (`client/src/world/maps.js`) ; ces générateurs appellent
   le code d'origine (`world/city.js`, `world/handmadeZones.js` — contenu déplacé tel quel de `zones.js` —, `world/interiors.js`).
   Une configuration ne choisit qu'un générateur enregistré : jamais de code.
3. **Statuts** `draft` / `published` / `disabled` : seules les cartes publiées sont construites (client) et reconnues (serveur).
   Une carte désactivée n'efface rien : la position d'un joueur qui s'y trouvait reste en base, simplement ignorée.
4. **Validation des deux côtés** (`backend/game/maps.py`, `catalogueErrors` dans `world/maps.js`) : identifiants
   `^[a-z][a-z0-9_]{0,31}$` (taille de `Character.zone`), uniques, préfixe `int_` réservé, ville et zone existantes, type
   connu, source prise en charge, carte de départ publiée ; côté client, générateur connu et `quartier` publié (le jeu en a
   besoin). Catalogue invalide → arrêt au chargement (serveur et client), plutôt qu'un monde à moitié construit.
5. **Retour arrière pendant la transition** : `?carte=historique` dans l'adresse (ou `localStorage['babiverse.carte'] = 'historique'`)
   construit les zones par l'ancien chemin (`legacyZones`), sans le catalogue. `window.__babi.worldSource` indique le chemin actif.
6. **Ce qui ne change pas** : `World3D`, le rendu (`engine3d/*`), la grille, les interactions, le décorateur de l'atelier,
   l'agrandissement du lotissement, toutes les règles économiques (`require_zone`), les modèles et migrations Django.

## Conséquences

- Ajouter une carte « generator » = une ligne de catalogue + un générateur enregistré ; ajouter une carte de **données**
  (paysages GLB, éditée dans l'atelier, publiée par versions) reste à faire en phase 2 : le catalogue est prévu pour recevoir
  des cartes publiées par l'atelier, fusionnées avec les cartes intégrées.
- Les tables de villes, cartes et versions de l'atelier ne sont **pas** créées à cette étape : sans système de publication,
  elles auraient doublé le réglage `game.placements` (deux sources de vérité). Elles arrivent avec la publication (phase 2).
- Le nom d'une carte figure à la fois dans le catalogue et dans son générateur : un test vérifie qu'ils restent identiques.
- Référence de non-régression : `client/tests/carteHistorique.test.js` (instantané complet figé avant la migration) et
  `backend/game/tests/test_cartes.py`.
