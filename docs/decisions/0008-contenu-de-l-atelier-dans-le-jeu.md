# ADR 0008 — Le jeu charge le contenu de l'atelier d'assets (pack de jeu)

Statut : accepté (2026-10-12). Complété par l'ADR 0009 (placement des éléments publiés sur la carte du jeu).

## Contexte

L'atelier d'assets (`babiverse-asset-studio-admin/`, FastAPI + SQLite) produit personnages, composants SVG, intérieurs et meubles, mais le jeu Three.js n'en chargeait rien. Demande : atelier = administration, jeu = joueurs ; les nouveaux joueurs composent leur personnage avec les composants de l'atelier, l'intérieur « Chez moi » est celui choisi dans l'atelier, les habitants de l'atelier remplacent les PNJ en gardant leur mobilité.

## Décision

1. **Un seul contrat** : le « pack de jeu » (`babiverse-game-pack` v1) construit par l'atelier (`app/gamepack.py`, `GET /api/runtime/game-pack`). Versions publiées seulement ; composants SVG inclus (clés `id@version`), sans lien de fichier signé.
2. **L'atelier choisit, le jeu applique** : réglages `game.*` de l'atelier (page « Intégration au jeu ») — intérieur de la maison, habitant de chaque PNJ (« auto » par défaut : les habitants publiés les plus récemment ajoutés d'abord, même silhouette si possible), promeneurs oui/non. L'atelier n'écrit jamais dans le jeu.
3. **Transport** : Django lit le pack en direct (`ATELIER_URL` + clé partagée `ATELIER_KEY` = `BABIVERSE_GAME_KEY`, cache 15 s, dernier pack gardé si l'atelier tombe), sinon le fichier `shared/atelier/game-pack.json` écrit par `manage.py sync_atelier` (production). Le client le reçoit par `GET /api/atelier/pack` (public, ETag = révision).
4. **Le serveur reste l'autorité** : l'apparence choisie à la création (`appearance.studio`) est validée contre la garde-robe (composant connu, silhouette compatible, palette, teintes), le visage est imposé par la silhouette et une apparence 3D classique de repli est calculée.
5. **Rendu** : les personnages de l'atelier sont des pantins articulés (SVG rastérisé découpé en tronc, bras et jambes, plans tournés vers la caméra, membres qui balancent à la marche) avec ombre ; le joueur peut changer d'apparence à tout moment (`POST /api/character/appearance`, même validation qu'à la création) ; les PNJ gardent identité, dialogues, place et comportement. L'intérieur est converti en zone (`client/src/atelier/home.js`) en insérant des murs entre pièces ; la zone garde l'identifiant `maison` (sieste et règles serveur inchangées).
6. **Sans pack, rien ne change** : le jeu garde son contenu d'origine (tests et E2E existants inchangés).

## Conséquences

- Vue de face uniquement pour les personnages de l'atelier (pas de dos ni de profil) ; ce qui recouvre un bras (cheveux longs, sac) suit le bras quand il balance.
- Les meubles de l'atelier sont rendus en volumes simples à leur couleur (pas encore les assemblages SVG modulaires).
- Les actions de meubles autres que la sieste sont des fiches d'information.
- Une apparence de joueur suit la version publiée courante de ses composants (un composant amélioré dans l'atelier met à jour tous les joueurs qui le portent) ; un composant archivé disparaît du personnage, une silhouette archivée ramène au modèle 3D.
