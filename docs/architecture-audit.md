# Audit d'architecture — évolution vers un monde multi-villes (phase 0)

> Date : 2026-10-13 · Branche `main` (commit `be01d7f`) · Périmètre : phase 0 du prompt maître « Monde 3D multi-villes et modulaire ».
> Aucun code applicatif ni aucune donnée n'a été modifié pendant cet audit. Seuls ce document et `MEMOIRE_PROJET.md` ont été écrits.

## 0. Synthèse

- **Le projet n'a pas besoin d'être réécrit.** Il possède déjà presque toutes les briques du système visé, sous d'autres noms :
  un format de carte déclaratif (la « zone »), un registre de types d'interaction, des portes qui relient des zones,
  un atelier d'administration avec rôles, versions et publication, et un canal de diffusion du contenu vers le jeu (le « pack de jeu »).
- **Ce qui manque vraiment** : la notion de ville / commune / carte en tant que données, des versions de carte (brouillon ≠ publié),
  le format GLB/GLTF (aucun chargeur, aucun stockage adapté), et la capacité du serveur de jeu à reconnaître une carte qui n'est pas codée en dur.
- **La carte historique (Cité Akwaba, zone `quartier`) est générée par du code** (`client/src/world/city.js`) à partir de constantes et de `shared/city.json`.
  Elle doit rester générée ainsi au début : on l'enregistre comme « carte de type générateur » plutôt que de la convertir en données, ce qui garantit des coordonnées identiques à la case près.
- **Trois risques majeurs** : les identifiants de zone sont une liste fixe côté serveur (`rules.ZONES`) ; les placements de l'atelier sont visibles dans le jeu dès leur enregistrement (pas de brouillon) ;
  l'hébergement Render gratuit n'a pas de disque persistant, donc aucun endroit sûr pour des fichiers GLB volumineux.
- **État de référence : vert.** 397 tests unitaires et d'intégration exécutés, tous passants ; les deux builds de production passent. Les tests de bout en bout n'ont pas été lancés (voir § 4).

## 1. Architecture observée

Le dépôt contient **deux applications distinctes** qui communiquent par HTTP.

```
┌──────────────────────── JEU ────────────────────────┐        ┌────────────── ATELIER D'ASSETS ──────────────┐
│ client/  Vite 6 + Three.js 0.179.1 (PWA, DOM)       │        │ frontend/  Vite + TypeScript + Phaser 3.88    │
│   world/*   logique pure (grille, ville, zones…)    │        │   (2D isométrique ; importe les modules purs  │
│   engine3d/* rendu Three.js                         │        │    du jeu par l'alias Vite @jeu)              │
│   atelier/*  application du pack de l'atelier       │        │ backend/   FastAPI + Pydantic                 │
│        │  HTTPS JSON /api/*                         │        │   SQL brut, migrations numérotées (db.py)     │
│ backend/ Django 5.2+ + DRF (autorité serveur)       │◄──────►│   rôles admin/editor/publisher/viewer/player  │
│   game/ modèles, services, migrations Django        │  pack  │   assets versionnés, médiathèque, réglages    │
│   PostgreSQL (Render babi_verse_db) / SQLite        │  de    │   PostgreSQL (babiverse_studio) / SQLite      │
└─────────────────────────────────────────────────────┘  jeu   └───────────────────────────────────────────────┘
          shared/city.json, shared/ads.json : lus par le client ET par le serveur du jeu
```

| Domaine | Constat vérifié dans le code |
|---|---|
| Frontend du jeu | JavaScript ES modules sans framework, UI en DOM (`client/src/ui/*`), PWA (`client/public/sw.js`) |
| Moteur 3D | **Three.js 0.179.1** (`client/package.json`). Seul module annexe utilisé : `three/addons/utils/BufferGeometryUtils.js`. **Aucun chargeur de modèle** (ni GLTFLoader, ni autre) |
| Scène et rendu | `engine3d/World3D.js` (`loadZone`, transitions, joueur, PNJ, sélection, jour/nuit) ; `engine3d/builders.js` construit tout de façon procédurale (géométries mises en cache, fusion des décors statiques) |
| Caméra | `engine3d/CameraRig.js` + `cameraMath.js` : orbitale, bornée à la taille de la grille |
| Déplacement et collisions | **Grille de cases** : `world/grid.js` (`buildGrid`, `moveBody` axe par axe, `lineOfSight`), 1 case = 32 px = 1 unité 3D. Pas de physique ni de collision par maillage |
| Navigation | A* 8 directions (`world/pathfinding.js`) dans les intérieurs ; joystick/clavier en ville (ADR 0005) |
| Sélection | Volumes cliquables par catégorie (`world/selectables.js`), rayon contre boîtes, pas de raycast sur maillage |
| Interactions | Registre `world/interactionTypes.js` (`door`, `info`, `bed`, `npc`, `delivery`, `kiosk`, `plot`, `billboard`, `player_building`…) qui renvoie des actions ; les actions économiques passent par `game/actions.js` puis le serveur |
| Backend du jeu | Django + DRF, vues fonctionnelles, pipeline transactionnel `views.run_action` (verrou de ligne, idempotence, savepoint) |
| Base du jeu | PostgreSQL si `DATABASE_URL`, sinon SQLite ; migrations Django `0001` à `0008` |
| Authentification du jeu | Modèle `Player` propre (pas `django.contrib.auth`), jetons `AuthToken` hachés. **Aucun rôle administrateur côté jeu** ; `/admin/` Django sert aux super-utilisateurs Django |
| Atelier (administration) | Application séparée `babiverse-asset-studio-admin/babiverse-studio/` : FastAPI, rôles et permissions fines (`auth.py`), cycle `draft → in_review → validated → published → superseded`, audit, médiathèque, page « Carte du jeu » |
| Base de l'atelier | PostgreSQL (`babiverse_studio`) ou SQLite ; migrations `_m1` à `_m3` dans `db.py` ; réglages clé/valeur dans la table `settings` |
| Stockage des fichiers | Atelier : disque (`media/`, par empreinte SHA-256) ou **en base** (`media_blobs`, BYTEA) quand `BABIVERSE_MEDIA_STORAGE=database` (cas de Render gratuit). Types acceptés : SVG assaini, PNG, WebP, JPEG, GIF ; 5 Mo maximum |
| Diffusion du contenu | Atelier `GET /api/runtime/game-pack` (clé `X-Babiverse-Game-Key`) → Django `game/atelier.py` (cache 15 s, 60 s en production, dernier pack gardé en mémoire, repli fichier) → `GET /api/atelier/pack` (ETag) → client `atelier/pack.js` `applyPack`, **une seule fois au démarrage** (`main.js`) |
| Multijoueur | Pas de temps réel : interrogation `POST /api/social/poll` toutes les 2 s ; présence filtrée par **identifiant de zone** (`services/social.shared_zone`) |
| Déploiement | `render.yaml` (deux services web Python gratuits, Oregon), deux projets Vercel (`client/vercel.json`, `…/frontend/vercel.json`) qui relaient `/api/*` vers Render. `migrate` lancé au démarrage du service Django |
| Tests | Django test runner, Vitest (jeu et atelier), pytest (atelier), E2E maison avec playwright-core dans Chrome |

## 2. Fichiers importants et responsabilités

### 2.1 Carte et monde (client du jeu)

| Fichier | Responsabilité | Sort prévu |
|---|---|---|
| `client/src/world/city.js` | **Générateur de Cité Akwaba** : rues (`H_ROADS`, `V_ROADS`), gabarits (`TEMPLATES`), 11 bâtiments (`BUILDINGS`), place, arbres, mobilier (`decor()`), PNJ, interactables, points d'apparition, `cityExtent` | Conservé tel quel ; enveloppé par un adaptateur |
| `client/src/world/zones.js` | Registre `ZONES` (`quartier`, `maison`, `epicerie`, intérieurs `int_*`), `zoneById`, `setResidentialBlocks`, `setCityDecorator` | **Point d'extension principal** : `zoneById` apprend à servir les cartes publiées |
| `client/src/world/interiors.js` | Intérieurs générés `int_<bâtiment>` / `int_pb_<parcelle>`, conventions `from_<id>` | Conservé |
| `client/src/world/grid.js` | Légende ASCII (31 caractères), grille de collision, déplacements | Conservé ; les paysages 3D y projettent leur emprise |
| `client/src/world/structures.js` | Regroupe les cases de bâtiment de la grille ASCII en volumes | Conservé |
| `client/src/world/residential.js` | Géométrie du lotissement (**dupliquée** dans `backend/game/services/homes.py`) | Conservé, intouchable sans migration |
| `client/src/world/placement.js`, `removal.js` | Règles de placement et éléments d'origine retirables, partagées jeu/atelier | Réutilisées pour les nouvelles cartes |
| `client/src/world/interactionTypes.js` | Registre des types d'interaction | **Base du système d'interactions configurables** |
| `client/src/world/selectables.js`, `selection.js`, `interaction.js` | Volumes cliquables, fiches, cible à portée | Étendus aux zones interactives manuelles |
| `client/src/engine3d/World3D.js` | `loadZone` (libère l'ancienne zone par `disposeGroup`, construit la nouvelle), `transitionTo`, `enterBuilding`, `spawnTile`, `resolveSpawn` | Adapté : chargement asynchrone d'une carte publiée et de ses modèles |
| `client/src/engine3d/builders.js` | `buildZone` : sol, cellules, décors, bâtiments, câbles, fusion des statiques | Complété par un constructeur de paysages GLB |
| `client/src/engine3d/materials.js` | `disposeGroup`, matériaux en cache | Réutilisé pour libérer les modèles |
| `client/src/atelier/world.js` | `cityWithPlacements` : placements de l'atelier → bâtiments/objets de la zone | Généralisé à toute carte |
| `client/src/atelier/pack.js` | `applyPack` (PNJ, promeneurs, maison, retraits, placements) | Conservé ; la partie « monde » migrera vers les versions de carte |

### 2.2 Serveur du jeu

| Fichier | Responsabilité | Lien avec la carte |
|---|---|---|
| `backend/game/rules.py` | Toutes les règles ; `ZONES = ("quartier", "maison", "epicerie")` et `INTERIOR_ZONE_RE` ; `zone_known()` ; `SHOPS`, `JOBS`, `BUSINESS_TYPES` portent chacun une **zone obligatoire** | **Liste fixe** à rendre extensible |
| `backend/game/services/state.py` | `apply_position` : zone inconnue → position ignorée en silence ; `private_interior_allowed` ; borne 1 000 000 px | Doit reconnaître les cartes publiées |
| `backend/game/services/core.py` | `require_zone(char, zone, message)` utilisé par achats, sieste, emploi, kiosque, parcelles, panneaux | Les actions économiques restent liées à `quartier`, `epicerie`, `maison` |
| `backend/game/services/plots.py`, `homes.py` | Parcelles, constructions, lotissement : coordonnées calculées **côté serveur** depuis `shared/city.json` | Ne jamais déplacer ces coordonnées |
| `backend/game/services/social.py` | `shared_zone` : on voit les joueurs de la **même zone** | Une carte = une zone : compatible si les identifiants sont uniques |
| `backend/game/models.py` | `Character.zone` (`CharField(max_length=32)`), `pos_x`/`pos_y` en pixels ; `PlotClaim`, `Home`, `Business`, `AdCampaign`, `LedgerEntry`… | Données des joueurs à protéger |
| `backend/game/atelier.py` | Récupération et cache du pack de l'atelier | Canal naturel pour les cartes publiées |

### 2.3 Atelier d'assets (`babiverse-asset-studio-admin/babiverse-studio/`)

| Fichier | Responsabilité |
|---|---|
| `backend/app/auth.py` | Permissions (`asset.*`, `media.*`, `world.place`, `world.edit_any`, `scene.manage`, `admin.*`) et rôles |
| `backend/app/db.py` | Schéma, migrations numérotées, couche PostgreSQL/SQLite, `settings` |
| `backend/app/service.py`, `validation.py`, `taxonomy.py` | Assets, versions, familles techniques, catégories, règles de validation |
| `backend/app/media.py` | Médiathèque, contrôle par signature, liens signés |
| `backend/app/gameworld.py` | **Placements sur la carte du jeu** (réglage `game.placements`) et retraits d'éléments d'origine (`game.removals`) |
| `backend/app/gamepack.py` | Construction du pack (garde-robe, habitants, maison, placements, retraits, kits), `revision` = empreinte du contenu |
| `frontend/src/views/gameMap.ts`, `gameMapRender.ts` | Page « Carte du jeu » : affiche la vraie ville avec les modules du jeu, trace des zones, place des éléments |
| `frontend/src/views/city.ts` | Scènes de test isométriques (table `scenes`), sans lien avec le jeu |

## 3. Fonctionnement de la carte actuelle

### 3.1 Construction

1. Au chargement du module, `zones.js` appelle `buildCity()` : une grille ASCII est construite (enceinte `#`, terre, herbe, rues, passages piétons, place, parcelles `l`, bâtiments estampillés depuis leurs gabarits, arbres `T`, palmiers `p`, buissons `%`).
2. La zone renvoyée contient : `id: 'quartier'`, `name: 'Cité Akwaba'`, `outdoor`, `navigation: 'camera'`, `map`, `buildings`, `plots`, `residential`, `roads`, `spawns`, `props`, `interactables`, `npcs`, `ambient`, `customers`.
3. Après la réponse du serveur, `setResidentialBlocks(blocks)` régénère la ville si le lotissement s'est agrandi vers le sud.
4. Si un pack d'atelier est présent, `applyPack` installe un décorateur : retraits d'éléments d'origine (`cityWithout`), puis placements (`cityWithPlacements`).
5. `World3D.loadZone` construit la grille de collision (`buildGrid` + constructions des joueurs), le rendu (`buildZone`), les volumes cliquables, les PNJ et l'animation de rue.

### 3.2 Coordonnées et repères (à ne jamais modifier)

- 1 case = 32 px de grille = 1 unité Three.js. x vers l'est, y de grille = z 3D vers le sud. Origine (0, 0) fixe, case 0 = enceinte.
- La ville grandit vers l'est et le sud (`cityExtent`, environ 108 × 105 cases avec un bloc de lotissement) ; l'origine ne bouge jamais.
- Rues : Avenue Akwaba y = 12, Rue des Fromagers y = 26, boulevards x = 17 et x = 37 (chaque route fait 5 cases).
- Bâtiments publics : 2 × 2 cases, coordonnées dans `BUILDINGS`. Parcelles P01–P12 et panneaux : `shared/city.json`. Lotissement : 64 × 64 cases en (43, 40), emplacements 2 × 2.
- Positions des joueurs : `Character.pos_x/pos_y` en **pixels** et `Character.zone`. Une position qui tombe dans un obstacle est remplacée par le point d'apparition (`World3D.resolveSpawn`).

### 3.3 Identifiants existants

| Élément | Identifiant | Référencé par |
|---|---|---|
| Zones | `quartier`, `maison`, `epicerie`, `int_<bâtiment>`, `int_pb_<parcelle>`, `int_home_<emplacement>` (réservé) | `Character.zone`, `BugReport.zone`, `rules.SHOPS/JOBS/BUSINESS_TYPES`, `require_zone`, social |
| Points d'apparition | `default`, `entree`, `from_<zone>` | portes, `spawnTile` |
| Bâtiments | `voisin_nord`, `epicerie`, `maquis`, `depot`, `kouassi`, `voisin_sud`, `couture`, `pharmacie`, `transfert`, `bamba`, `voisin_g` | portes, livraisons, retraits (`bld:<id>`), icônes |
| Interactables | `door_<id>`, `kiosk`, `drop_*`, `plot_<id>`, `ad_<id>`, `lit`, `frigo`, `sortie_*`, `rayons` | missions, livraisons, fiches |
| Parcelles, panneaux | `P01`–`P12`, identifiants de `ad_slots` | `PlotClaim.plot_id`, `AdCampaign.slot` |
| Maisons | numéro d'emplacement `Home.slot` | position calculée par `homes.lot_origin` |
| Éléments retirables | `bld:<id>`, `tree:x,y`, `prop:<type>:x,y` | réglage `game.removals` |

Ces identifiants sont la clé de la compatibilité : **aucun ne doit être renommé**.

### 3.4 Liens entre carte, maisons et données persistantes

- La maison initiale d'un joueur n'est pas stockée en coordonnées : seul `Home.slot` l'est, la position est recalculée des deux côtés par la même formule.
- Les constructions des joueurs (`PlotClaim` : `template`, `x0`, `y0`, `facing`) sont placées par le serveur dans une parcelle de `shared/city.json`.
- « Chez moi » (`maison`) est la même zone pour tous ; l'entrée et la sortie passent par `from_maison`.
- Les actions économiques vérifient la zone du personnage côté serveur (`require_zone`) : l'épicerie exige `epicerie`, la sieste `maison` ; le kiosque, l'emploi, les parcelles et les panneaux exigent `quartier` ou la zone indiquée dans `rules.py`.

## 4. État de référence (exécuté le 2026-10-13)

| Suite | Commande | Résultat |
|---|---|---|
| Django (jeu) | `cd backend && DATABASE_URL= ../.venv/Scripts/python.exe manage.py test game` | **147 tests OK** (38,9 s, SQLite) |
| Vitest (jeu) | `cd client && npx vitest run` | **152 tests OK**, 13 fichiers |
| pytest (atelier) | `cd …/babiverse-studio/backend && .venv/Scripts/python.exe -m pytest -q` | **60 tests OK** (3 min 59 s, SQLite), 1 avertissement de dépréciation httpx |
| Vitest (atelier) | `cd …/babiverse-studio/frontend && npx vitest run` | **38 tests OK**, 4 fichiers |
| Build du jeu | `cd client && npx vite build` | OK (`three` 524 Ko, code 219 Ko) |
| Build de l'atelier | `cd …/frontend && npm run build` | OK (`tsc --noEmit` sans erreur ; un seul paquet JS de 1,8 Mo) |
| Migrations Django | `manage.py makemigrations --check --dry-run` | Aucune migration en attente |
| Contrôles Django | `manage.py check` | Aucun problème |

**Précaution appliquée** : `backend/.env` pointe `DATABASE_URL` vers la base Render de production. Les tests ont été lancés avec `DATABASE_URL=` vide, ce qui force SQLite (le chargeur `.env` utilise `setdefault` et n'écrase pas une variable déjà définie). Toute commande Django future doit garder cette précaution.

**Non exécuté** :
- **Tests de bout en bout** (`npm run e2e`) : ils exigent le backend et Vite lancés, Chrome, une base dédiée (`babiverse_e2e`) et, pour `carte` et `atelier`, un atelier de test. Les lancer avec la configuration locale actuelle risquerait d'écrire dans la base Render. À lancer à l'étape 1 avec une base locale explicite.
- **Lancement manuel du jeu** dans un navigateur : non fait pour la même raison. Le build et les tests du moteur (`world3d.test.js`) couvrent le chargement des zones, pas le rendu WebGL réel.
- **Tests PostgreSQL de l'atelier** (`BABIVERSE_TEST_DATABASE_URL`) : aucun rôle PostgreSQL de test disponible dans cette session.

## 5. Défauts et écarts préexistants (ne pas les compter comme régressions)

1. **E2E `parcelles` cassé** depuis avant le 2026-10-10 (documenté dans `MEMOIRE_PROJET.md` § 10).
2. E2E `tranche` / `economie` : délais de marche parfois dépassés au premier essai.
3. Les placements de l'atelier sont vérifiés contre la ville **à l'affichage** dans le jeu, pas par le serveur de l'atelier ; un placement devenu invalide est ignoré silencieusement côté joueur.
4. Les placements et retraits sont **visibles dans le jeu dès leur enregistrement** (au délai de cache près) : il n'existe aucun brouillon pour la carte.
5. Le pack de l'atelier n'est chargé qu'au démarrage du client : un joueur connecté ne voit un changement qu'après rechargement.
6. Géométrie du lotissement dupliquée entre `client/src/world/residential.js` et `backend/game/services/homes.py` (cohérente aujourd'hui, testée des deux côtés).
7. Entrer dans la ville coûte environ 6 s sur un processeur ralenti ×4 (peinture du sol, fusion du décor).
8. Mémoire du projet partiellement périmée : elle indiquait « branche `master`, aucun commit » alors que le dépôt est sur `main` avec 2 commits ; elle disait `vercel.json` racine et `api/index.py` non versionnés alors qu'ils le sont. `shared/atelier/game-pack.json` n'existe pas (il n'est créé que par `manage.py sync_atelier`).
9. Avertissements sans conséquence : dépréciation `httpx` dans le client de test FastAPI ; paquet JS de l'atelier de 1,8 Mo.

## 6. Dépendances à préserver

- **Coordonnées** : toutes celles du § 3.2 ; l'unité 1 case = 32 px = 1 unité 3D ; l'orientation x est, z sud.
- **Identifiants** du § 3.3, en particulier `quartier`, `maison`, `epicerie`, `int_*`, `from_*`, `P01`–`P12`, `Home.slot`.
- **Autorité serveur** : le client n'envoie que l'intention et `pos {zone, x, y}`. Une configuration de carte ne doit jamais autoriser une action à elle seule.
- **Modules purs** de `client/src/world/*` (testés sans Three.js) et leur réutilisation par l'atelier via l'alias `@jeu`.
- **Règles de placement partagées** (`world/placement.js`) entre l'atelier et le jeu.
- **Comportement « sans pack rien ne change »** (ADR 0008) : le jeu doit fonctionner si l'atelier est endormi ou injoignable.
- **Pipeline `run_action`** (verrou, idempotence, savepoint) pour toute action qui touche l'économie ou la propriété.
- **Données des joueurs** : `Character`, `Home`, `PlotClaim`, `Business`, `AdCampaign`, `InventoryItem`, `LedgerEntry`, relations sociales.

## 7. Correspondance entre les concepts cibles et l'existant

| Concept cible | Existant | Décision proposée |
|---|---|---|
| City | Rien | **Nouveau** (table de l'atelier) |
| District | Rien (Cité Akwaba n'existe que comme nom de zone) | **Nouveau** (table de l'atelier) |
| GameMap | La « zone » du client (format complet : grille, spawns, props, interactables, PNJ) | **Réutiliser le format de zone comme format de carte.** Nouvelle table de l'atelier qui référence un identifiant de zone |
| MapVersion | `asset_versions` (modèle à imiter : brouillon, publication, `superseded`, retour arrière) | **Nouveau**, calqué sur `asset_versions` |
| MapConnection | Interactable `door` avec `target: {zone, spawn}` | **Réutiliser** : une connexion est une porte dont la cible est une autre carte ; validée à la publication |
| LandscapeAsset | Assets versionnés de l'atelier (familles `building`, `prop`, `surface`…) + médiathèque | **Nouvelle famille `landscape`** dans `taxonomy.FAMILIES`, avec un média GLB. Pas de nouvelle table d'assets |
| MapLandscape | Placements (`game.placements` : asset publié + rectangle + orientation) | **Généraliser le placement** : position, rotation libre, échelle, rattaché à une version de carte |
| SceneObject | Interactables de zone + éléments retirables (`bld:<id>`…) | Nouvelle entrée de la version de carte : sous-objet nommé du modèle **ou** zone manuelle en cases |
| InteractionConfig | `world/interactionTypes.js` (client) + `behaviors.py` (atelier) | **Réutiliser le registre** ; la configuration ne contient que des données, jamais de code |
| État persistant | Modèles Django du jeu | **Inchangé**, reste dans Django |

La table `scenes` de l'atelier **ne doit pas** servir de GameMap : ce sont des bacs à sable isométriques (Phaser) où même le rôle `player` peut placer des objets ; leurs coordonnées et leur rotation entières ne correspondent pas au jeu.

## 8. Risques de régression

| # | Risque | Gravité | Parade |
|---|---|---|---|
| R1 | `rules.ZONES` est une liste fixe : une nouvelle carte serait refusée par `apply_position`, qui **ignore la position en silence**, et le joueur réapparaîtrait au mauvais endroit | Haute | Le serveur apprend la liste des cartes publiées ; test « position dans une nouvelle carte conservée » |
| R2 | Brouillons visibles en jeu : le mécanisme actuel des placements publie immédiatement | Haute | Versions de carte ; le pack ne transporte que la version publiée ; migrer `game.placements` vers la version publiée n° 1 de `quartier` |
| R3 | Atelier endormi (Render gratuit) ou redémarrage de Django : sans copie locale, les nouvelles cartes disparaissent du jeu | Haute | Django garde en base un instantané de la dernière publication valide (petite table) ; repli sur la carte historique |
| R4 | Fichiers GLB lourds en base PostgreSQL (seul stockage durable de l'hébergement gratuit) | Haute | Stockage objet compatible S3 (décision à prendre, § 9) ; plafond de taille ; pas de GLB en BYTEA hors développement |
| R5 | Renommer une zone ou un bâtiment casse `Character.zone`, `require_zone`, missions, livraisons, retraits | Haute | Identifiants historiques figés ; la carte historique garde l'identifiant `quartier` |
| R6 | Collisions : un modèle GLB n'a pas de cases solides | Moyenne | L'instance déclare une emprise en cases (et des cases bloquantes) projetée dans `buildGrid` ; aucun moteur physique |
| R7 | Échelle des modèles : un GLB est en mètres, le jeu en cases | Moyenne | Convention écrite et testée (1 unité = 1 case), dimensions mesurées à l'import, échelle par instance |
| R8 | `loadZone` est synchrone ; charger un GLB est asynchrone | Moyenne | Charger les modèles pendant le fondu de `transitionTo`, puis appeler `loadZone` ; erreur → boîte de remplacement |
| R9 | Mémoire GPU : `disposeGroup` libère géométries et matériaux, mais des modèles partagés entre instances seraient libérés trop tôt ou jamais | Moyenne | Cache de modèles avec compteur de références, vidé au changement de carte |
| R10 | Le décorateur de ville (`setCityDecorator`) et `setResidentialBlocks` ne concernent que `quartier` | Moyenne | Garder ce chemin pour la carte historique ; les nouvelles cartes utilisent le chargeur générique |
| R11 | Présence sociale par zone : des identifiants de carte en collision mélangeraient des joueurs | Faible | Identifiants uniques validés côté serveur ; longueur ≤ 32 (`Character.zone`) |
| R12 | L'atelier importe les modules du jeu (`@jeu`) : un changement de la ville impose de reconstruire l'atelier | Faible | Inchangé ; à rappeler dans la procédure de publication |

## 9. Décisions à valider avant l'étape 2

1. **Où vivent villes, cartes et versions ?** Recommandation : **dans l'atelier** (il a déjà rôles, publication, audit, médiathèque et la page « Carte du jeu »), avec une copie de la version publiée dans Django pour l'autorité serveur (R1, R3). L'alternative, tout mettre dans Django/DRF, créerait une seconde interface d'administration et dupliquerait le système de publication.
2. **Stockage des fichiers GLB.** Le disque de Render gratuit s'efface ; la base n'est pas faite pour des fichiers de plusieurs Mo. Recommandation : un stockage objet compatible S3 (Cloudflare R2 ou équivalent) derrière l'interface existante `service.store_file` / `read_file`, avec un troisième mode `BABIVERSE_MEDIA_STORAGE=s3`. Sans ce choix, l'import GLB ne pourra être livré qu'en développement local.
3. **GLTF multi-fichiers.** Recommandation : accepter **GLB seulement** au premier lot (un seul fichier, textures embarquées) ; GLTF + fichiers annexes en lot zip ensuite.
4. **Dépendance `GLTFLoader`.** Elle fait partie de `three` (`three/addons/loaders/GLTFLoader.js`) : aucune nouvelle bibliothèque. Les décodeurs Draco/Meshopt ne seront ajoutés que si un modèle réel l'exige.

## 10. Plan de migration adapté au dépôt

Chaque étape est livrable seule, garde la carte historique intacte et se termine par les suites du § 4 (plus les E2E dès l'étape 1).

### Étape 1 — Filet de sécurité (aucun changement de comportement)

- Tests de référence de la carte historique dans `client/tests/` : empreinte de `buildCity()` (grille, bâtiments, interactables, spawns, PNJ) figée dans un instantané ; coordonnées des portes et des parcelles ; grille de collision.
- Test Django : position conservée pour chaque zone connue ; position ignorée pour une zone inconnue (comportement actuel documenté).
- Lancer les E2E sur une base locale explicite (`DATABASE_URL` vers `babiverse_e2e`, jamais Render), noter les échecs préexistants.

### Étape 2 — La carte historique devient la première carte référencée (phase 1 du prompt)

- **Client** : `client/src/world/maps.js` (nouveau, pur) : registre de cartes `{ id, kind: 'generator' | 'data', build }`. `quartier`, `maison`, `epicerie` et les intérieurs y sont enregistrés comme cartes de type générateur qui appellent le code actuel. `zones.js` délègue à ce registre ; l'ancien chemin reste accessible par un drapeau pendant la transition.
- **Atelier** : migration `_m4` dans `db.py` : tables `cities`, `districts`, `game_maps`, `map_versions`. Données initiales : ville « Abidjan », commune « Cité Akwaba », carte `quartier` (type générateur), version n° 1 publiée qui **reprend tels quels** les réglages `game.placements` et `game.removals` (les réglages restent lus en repli).
- **Critère de sortie** : instantanés identiques, E2E identiques, pack identique pour la partie existante.

> **Réalisé le 2026-10-13 (étapes 1 et 2, côté jeu)** — voir ADR 0011. Écart assumé avec le plan : la carte historique est
> référencée par un catalogue partagé `shared/maps.json` (lu par Django et par le client) plutôt que par des tables de
> l'atelier. Sans système de publication, ces tables auraient doublé le réglage `game.placements` et créé deux sources de
> vérité ; elles sont reportées à l'étape 3, où les cartes publiées par l'atelier rejoindront le catalogue. Le drapeau de
> retour arrière est `?carte=historique` (ou `localStorage['babiverse.carte'] = 'historique'`).

### Étape 3 — API et publication (phase 2)

- **Atelier** : `backend/app/worldmaps.py` (nouveau) + routes dans `main.py` : villes, communes, cartes, versions (brouillon, prévisualisation, publication, retour arrière), connexions ; permissions nouvelles `world.manage` et `world.publish` dans `auth.py` ; validation serveur des identifiants (regex de zone, ≤ 32 caractères, unicité), des cibles de portes, des points d'arrivée.
- **Pack** : section `maps` contenant **uniquement les versions publiées** ; la révision du pack change à chaque publication (cache et ETag existants).
- **Django** : migration `0009` : modèle `PublishedMap` (identifiant, révision, emprise, points d'arrivée, connexions) alimenté depuis le pack ; `rules.zone_known` accepte ces identifiants ; `apply_position` inchangé pour les zones historiques. Aucune colonne existante modifiée.

> **Parcours vertical réalisé le 2026-10-13 (étapes 3 à 6, version minimale)** — voir ADR 0012 : villes, zones, cartes
> et versions dans l'atelier ; import GLB / glTF autonome ; instances placées ; objets interactifs (objet nommé ou zone
> tracée) ; publication contrôlée ; cartes reconnues par Django via le pack ; chargement progressif dans le jeu ; accès
> depuis la Cité Akwaba et retour. Restent : stockage objet (R4), copie en base côté Django (R3), aperçu 3D dans
> l'atelier, rotation libre, comportements économiques sur les nouvelles boutiques, mesures de performance sur téléphone.

> **Fonctions restantes réalisées le 2026-10-13** — voir ADR 0013 : connexions entre cartes (points d'arrivée, transport,
> conditions vérifiées par le serveur), versions consultables et restaurables avec aperçu de publication, matrice des
> permissions testée et audit, gestion des erreurs (repli sur la Cité Akwaba, 503, délai de chargement, ordre des
> positions), chargement optimisé (file, proximité, préchargement des voisines, mesures, poids des cartes). Restent : R3
> (copie en base côté Django), R4 (stockage objet), aperçu 3D dans l'atelier, mesures sur un vrai téléphone.

### Étape 4 — Chargeur générique et paysages (phases 3 et 7)

- **Atelier** : famille `landscape` (`taxonomy.py`, `validation.py`), média `model/gltf-binary` dans `media.py` (signature `glTF` version 2, taille plafonnée, lecture du JSON pour les noms de nœuds, boîte englobante, nombre de triangles, matériaux et textures).
- **Client** : `engine3d/modelCache.js` (nouveau) : `GLTFLoader` de `three/addons`, un chargement par fichier, clones par instance, compteur de références, libération au changement de carte. `engine3d/builders.js` : constructeur de paysage (position, rotation, échelle). `World3D.transitionTo` attend le chargement des modèles avant `loadZone`.
- Collisions : chaque instance de paysage déclare son emprise en cases ; `buildGrid` les reçoit comme les constructions des joueurs (`extra`).
- Mesures : temps de chargement et nombre d'appels de dessin exposés dans `window.__babi`.

### Étape 5 — Atelier : villes, cartes, bibliothèque, éditeur (phase 4)

- Nouvelles vues dans `frontend/src/views/` (villes, cartes, bibliothèque de paysages), enregistrées dans `router.ts`.
- L'éditeur reprend `gameMap.ts` / `gameMapRender.ts` (vue de dessus, cases) : sélection d'une instance, position, rotation, échelle, emprise, annulation des changements non enregistrés. La prévisualisation 3D d'un GLB utilise `three`, déjà présent dans le dépôt (seule dépendance ajoutée à l'atelier, justifiée par l'aperçu).
- Interactions : sur un objet, choix d'un nœud du modèle (si les noms sont uniques et validés) ou tracé d'une zone manuelle en cases ; type pris dans le registre (`door`, `info`, boutique, logement…) ; activation et désactivation sans toucher au modèle.

### Étape 6 — Navigation entre cartes (phase 5)

- Une connexion est une porte (`door`) dont la cible est une carte publiée. Premier périmètre : deux cartes publiées reliées dans les deux sens.
- Serveur : la position dans la carte d'arrivée est acceptée seulement si la carte est publiée ; le personnage, l'inventaire, le solde et les relations ne dépendent pas de la zone, donc rien n'est à déplacer.
- Client : point d'arrivée validé par `resolveSpawn` (repli si obstacle), test dédié.

### Étape 7 — Déploiement (phase 8)

- Migrations : Django `0009` (additive), atelier `_m4` et suivantes (additives). Aucun `DROP`, aucune réécriture de colonne.
- Procédure : sauvegarde de la base avant déploiement, `migrate` au démarrage (existant), retour arrière par redéploiement du commit précédent (les tables ajoutées sont ignorées par l'ancien code).
- Variables nouvelles à documenter dans `docs/deploiement-render-vercel.md` : stockage objet (si retenu), taille maximale d'un modèle.

## 11. Tests à ajouter

| Niveau | Tests |
|---|---|
| Client (Vitest) | Instantané de la carte historique ; registre de cartes ; chargement d'une carte de données ; conversion emprise → cases solides ; point d'arrivée hors obstacle ; zone interactive manuelle ; interaction désactivée = aucune action ; cache de modèles (une seule requête pour deux instances, libération) ; erreur de chargement → remplacement |
| Atelier (pytest) | Création ville / commune / carte ; identifiants invalides refusés ; brouillon absent du pack ; publication validée (connexions, assets publiés) ; retour arrière ; permissions (lecteur et joueur refusés) ; import GLB valide / invalide / trop lourd / faux type ; migration `_m4` sur une base contenant des placements |
| Django | Carte publiée reconnue ; carte désactivée → position historique conservée, pas d'effacement ; changement de carte sans perte de solde ni d'inventaire ; migration `0009` avec données représentatives |
| E2E | Carte historique jouable (scénarios existants) ; passage entre deux cartes ; brouillon invisible côté joueur |

Les tests du moteur 3D ne peuvent pas vérifier le rendu WebGL réel sous Vitest ; ils seront complétés par les E2E dans Chrome.
