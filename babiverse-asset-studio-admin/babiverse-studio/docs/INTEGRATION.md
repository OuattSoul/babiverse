# Intégration avec le moteur de Babiverse

## 1. État des lieux (vérifié dans le dépôt)

| | Jeu Babiverse (racine du dépôt) | Asset Studio (ce dossier) |
|---|---|---|
| Client | Vite + **Three.js** (3D low-poly) | Vite + TypeScript + **Phaser** (isométrique 2D) |
| Serveur | Django + DRF, PostgreSQL | FastAPI, SQLite |
| Bâtiments | gabarits codés `TEMPLATES` (façade en lettres `H/W/Y/h/D`, toit `r/o/g`) dans `client/src/world/city.js`, tous en **2 × 2** | définitions procédurales libres (emprise, étages, façade modulaire…) |
| Personnages | `engine3d/character.js` : boîtes 3D à partir de `appearance = {skin, outfit, hair}` (valeurs limitées par `backend/game/services/state.py` : 4 peaux, 6 couleurs, 4 coiffures) | composition SVG de calques |
| Intérieurs | plans générés en code (`world/interiors.js` : `house`, `shop`, `pharmacy`, `maquis`, `depot`) | plans déclaratifs |

**Mise à jour du 2026-10-12** : le jeu charge désormais le **pack de jeu** (§ 1 bis) : garde-robe de création, habitants à la place des PNJ, intérieur de la maison du joueur. Le reste de cette page (catalogue d'exécution, adaptateur) reste valable pour les autres familles.

**Conséquence (avant le pack de jeu)** : le jeu ne chargeait aucun contenu de l'atelier. Rien n'est synchronisé automatiquement, et l'atelier n'écrit jamais dans le dépôt ou la base du jeu. L'intégration passe par deux exports, décrits ci-dessous, et par des adaptateurs côté jeu à écrire.

## 1 bis. Pack de jeu — `GET /api/runtime/game-pack` (chargé par le jeu)

Format `babiverse-game-pack` v1 (`backend/app/gamepack.py`), versions publiées seulement :

| Clé | Contenu | Usage dans le jeu |
|---|---|---|
| `wardrobe` | silhouettes (`bodies`), `slots.hair/top/bottom/shoes`, visage par défaut de chaque silhouette (`face`), teintes de peau, couleurs de cheveux et de tissu | écran de création du personnage |
| `inhabitants` | habitants publiés : définition SVG (clés `id@version` figées), nom, rôle, salutation, apparence 3D de repli, `npc` attribué, `roams` | apparence des PNJ, promeneurs, passants, clients du kiosque |
| `npcs` | les 11 PNJ du jeu et l'habitant attribué | page « Intégration au jeu » |
| `home` | intérieur choisi pour « Chez moi » (plan, matériaux, meubles décrits) | zone `maison` |
| `parts` | composants SVG nécessaires (`defs/back/front`, canaux, ancrages) | compositeur `client/src/atelier/compose.js` |
| `revision` | empreinte du contenu | ETag côté jeu |

- **Accès** : en-tête `X-Babiverse-Game-Key` = `BABIVERSE_GAME_KEY` (défaut `babiverse-dev` hors production, aucune clé en production sans variable), ou session avec `asset.export`.
- **Réglages** (page `#/jeu`, table `settings`, clés `game.*`) : `PUT /api/game/settings {home_interior, npcs: {pnj: asset_id | "" (auto) | "keep"}, extra_inhabitants}` (permission `asset.publish`) ; `GET /api/game/settings` (lecture). Attribution « auto » : les habitants publiés les plus récemment ajoutés remplacent les PNJ en priorité (même silhouette si possible) ; un nouvel habitant publié prend donc la place d'un plus ancien.
- **Publication en lot** des habitants générés : `POST /api/game/publish-inhabitants` (brouillon → relecture → validé → publié ; `asset.validate` + `asset.publish`).
- **Côté jeu** : Django lit le pack en direct (`ATELIER_URL`, `ATELIER_KEY`, cache `ATELIER_CACHE_S`) ou le fichier `shared/atelier/game-pack.json` (`python manage.py sync_atelier`), et le sert au client par `GET /api/atelier/pack`. Voir l'ADR 0008 du jeu.

### Carte du jeu — éléments placés (`#/jeu/carte`, ADR 0009 du jeu)

- La page affiche la vraie ville : elle importe les modules purs du jeu (`client/src/world/city.js`, `placement.js`) sous l'alias Vite `@jeu` (`vite.config.ts`, déclarations `src/jeu.d.ts`). **Reconstruire l'atelier quand la ville du jeu change.**
- `GET /api/game/placements` → `{placements, assets}` (éléments plaçables : bâtiments, objets, véhicules, surfaces publiés) ; `POST /api/game/placements {asset_id, x, y, facing, w?, h?}` (`w`/`h` pour une surface seulement) ; `DELETE /api/game/placements/{id}` ; écriture `asset.publish`. Le serveur vérifie famille, publication, emprise selon l'orientation, chevauchements (une surface peut passer sous un autre élément, pas sous une autre surface) ; les règles de la ville (routes, parcelles, lotissement, décor, portes) sont appliquées par la page et par le jeu (`placementIssue`).
- Éléments d'origine de la ville : `POST /api/game/removals {key, label}` / `DELETE /api/game/removals/{key}` (clés `bld:<id>`, `tree:x,y`, `prop:<type>:x,y` de `client/src/world/removal.js`) ; la vue `GET /api/game/placements` renvoie aussi `removals`. Les éléments utiles au jeu (commerces, emploi, livraisons, kiosque, étal, parcelles, publicités) sont protégés par le jeu : la page n'offre pas de les retirer et le jeu ignore une telle clé.
- Pack : `removals[]` (clés retirées) ; `placements[] = {id, family, x, y, w, h, facing, asset_id, version, name, render}` (`render` : matériaux, hauteur, catégorie, description ; bâtiment : étages, style, boutique, case de la porte, comportements, `interior` au format de `home` ; objet : forme ou `modular` ; véhicule : type, enseigne ; surface : type, motif, `walkable`) et `kits` (spécifications des kits des objets modulaires).

## 2. Catalogue d'exécution — `GET /api/runtime/catalog`

Format `babiverse-runtime-catalog`, version 1. C'est le **format cible** qu'un chargeur du jeu lirait.

```json
{
  "format": "babiverse-runtime-catalog", "format_version": 1, "generated_at": 1760000000.0,
  "character_frame": [0, 0, 200, 380],
  "assets": [
    { "asset_id": "uuid", "technical_name": "taxi-compteur", "family": "vehicle", "category": "vehicles",
      "version": 1, "definition": { "...": "définition validée" },
      "pins": { "assets": { "uuid-dependance": 2 }, "media": { "m-…": 1 } },
      "media": { "m-…": { "revision": 1, "mime": "image/png", "width": 64, "height": 64, "sha256": "…", "url": "/api/media/…?sig=…" } } }
  ],
  "character_parts": {
    "uuid-composant@1": { "slot": "top", "z": 40, "back_z": 0, "props": { "anchor": "shoulders", "...": "…" },
                          "view_box": [0, 0, 200, 380], "channels": { "primary": "#2980b9" },
                          "defs": "…", "back": "…", "front": "<path style=\"fill:var(--babi-primary,#2980b9)\" …/>" }
  }
}
```

Règles :
- seules les versions **publiées** et non archivées y figurent ;
- `pins` donne la version exacte de chaque dépendance (composants, intérieurs, meubles) et la révision exacte de chaque fichier, figées à la publication ; un chargeur doit les respecter pour garantir que le rendu ne change pas silencieusement ;
- les liens de fichiers sont **signés et expirent** (12 h) : un outil de synchronisation doit les télécharger et les stocker de son côté (l'empreinte `sha256` permet le dédoublonnage) ;
- les instances (positions) ne font pas partie du catalogue : le monde du jeu reste géré par le jeu.

### Rendre un personnage dans le jeu
`frontend/src/character/compose.ts` est un module **pur** (aucun accès au DOM) : `composeCharacter(props, parts)` produit un SVG autonome à partir d'une définition et des `character_parts`. Il peut être copié tel quel dans le client du jeu. Deux voies possibles côté Three.js :
1. **Panneau (billboard)** : rastériser le SVG (Image → canvas) en texture d'un `THREE.Sprite` — rapide à brancher, vue de face uniquement.
2. **Garder les modèles 3D actuels** et n'utiliser que l'adaptateur ci-dessous.

### Rendre un assemblage modulaire (bâtiment, véhicule, objet, meuble, surface)
Le catalogue contient aussi `kits` (spécification des kits) et `kit_parts` (composants exacts, clés `id@version`). `frontend/src/modular/compose.ts` est un module **pur** : `composeKit(properties.modular, parts, kits[kit])` produit le SVG ; `checkAssembly` reproduit les règles du serveur. Même voie que les personnages côté Three.js : texture d'un panneau (`THREE.Sprite`) pour les vues de face, texture plaquée sur le sol pour le kit « surface ».

## 3. Adaptateur du jeu actuel — `GET /api/runtime/game-adapter`

Conversion **avec pertes** vers ce que le jeu comprend déjà :

```json
{
  "format": "babiverse-game-adapter", "format_version": 1,
  "characters": [ { "technical_name": "habitant-kouadio", "appearance": { "skin": "#8d5524", "outfit": "#e67e22", "hair": "short" },
                    "lossy": true, "lost": ["coiffure exacte", "visage", "chaussures", "accessoires", "motifs", "couleur du bas"],
                    "exact": { "skin": "#8d5524", "outfit": "#ecf0f1", "hair_color": "#1b1b1b" } } ],
  "building_templates": [ { "technical_name": "maison-moderne-etage", "compatible": true, "template": { "facade": "hD", "roof": "g" },
                            "facing": "S", "sign": null, "lost": ["étages", "style de toiture", "couleurs exactes", "…"] },
                          { "technical_name": "clinique", "compatible": false, "reason": "Le jeu actuel n'utilise que des bâtiments 2 × 2 (emprise 3 × 2)." } ],
  "unsupported_families": ["interior", "prop", "road", "surface", "vehicle", "furniture"]
}
```

- **Personnages** → `appearance` : peau = la plus proche des 4 du jeu ; `outfit` = couleur principale du haut (ou de la robe, de la veste) ramenée à la plus proche des 6 ; `hair` = `game_hint` du composant de coiffure (`short`, `afro`, `braids`, `bald`), `short` à défaut, `bald` sans coiffure. Utilisable directement comme apparence de PNJ ou comme préréglage proposé à la création de personnage.
- **Bâtiments** 2 × 2 avec entrée principale au sud ou au nord → entrée de `TEMPLATES` : lettre `D` pour la porte (ou un module porte/vitrine/garage), `H`/`h` pour une fenêtre, `W`/`Y` pour un mur plein (crème ou jaune selon la couleur des murs), toit `r`/`o`/`g` selon la couleur. Les autres bâtiments sont marqués incompatibles avec la raison.
- Intégration : reporter les gabarits dans `client/src/world/city.js` (`TEMPLATES`, `BUILDINGS`) ou `shared/city.json` (`player_buildings`), après revue. Aucun fichier n'est modifié automatiquement.

## 4. Lots d'échange entre environnements — `POST /api/export`, `POST /api/imports`

Format `babiverse-studio-bundle`, version 1 (zip) :

```
manifest.json            format, format_version, studio_version, exported_at, exported_by, versions_mode,
                         assets[], media[], categories[], scenes[], dependencies{asset_id: [ids]}
assets/<asset_id>.json   {asset: {id, technical_name, family, category, …}, versions: [{version, status, definition, pins, note, …}]}
media/<sha256>.<ext>     un fichier par révision utile (SVG déjà assaini, images)
scenes/<scene_id>.json   {id, name, width, height, terrain, instances: [{asset_id, version, x, y, rotation, variant_id, data}]}
```

Garanties : identifiants d'assets et de médias conservés ; à l'import, revérification complète (chemins, taille, empreintes, type par signature, assainissement SVG, schéma de chaque version) ; aperçu avant application ; décisions par asset (créer, ignorer, copier avec renommage des références internes, nouvelle version) ; jamais d'écrasement ; scènes recréées sous un nouvel identifiant, chaque instance replacée avec les règles de placement ; rapport ; annulation tant que rien n'a été réutilisé.

## 5. Ce qui est compatible tout de suite, ce qui demande un adaptateur

| Contenu | Immédiatement exploitable par le jeu | Ce qu'il faut écrire côté jeu |
|---|---|---|
| Apparence de personnage | oui, via `game-adapter` (avec pertes) | rien pour l'apparence 3D actuelle ; un rendu SVG en panneau pour la fidélité complète |
| Bâtiment 2 × 2 | oui, via `game-adapter` (gabarit façade/toit) | report manuel dans `TEMPLATES` ; un chargeur du catalogue pour les autres tailles, étages et façades modulaires |
| Intérieurs | non | un générateur de zone `int_*` à partir de `properties.rooms/doors/furniture` (les intérieurs du jeu sont aujourd'hui codés) |
| Comportements « exploités » | mécanique existante | relier `behaviors[]` aux types d'interaction de `client/src/world/interactionTypes.js` |
| Comportements « atelier seulement » | non | la mécanique elle-même, puis la liaison |
| Routes, surfaces, objets, véhicules, meubles | non | constructeurs Three.js correspondants dans `engine3d/builders.js` |
| Sprites importés | non | chargement de textures et panneaux |

## 6. Contrat stable pour un futur chargeur

- `asset_id` (UUID) et `technical_name` ne changent jamais ;
- une version publiée ne change jamais ; `pins` décrit toutes ses dépendances ;
- le jeu devrait référencer `asset_id@version` dans ses données de monde, comme le font les instances de l'atelier ;
- l'ajout de champs aux définitions est rétrocompatible (valeurs par défaut) ; un changement incompatible incrémentera `format_version`.
