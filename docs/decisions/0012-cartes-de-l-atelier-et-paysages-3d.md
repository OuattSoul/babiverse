# ADR 0012 — Cartes publiées par l'atelier : villes, paysages 3D, objets interactifs, passage entre cartes

Statut : accepté (2026-10-13). Parcours vertical minimal du monde multi-villes (audit `docs/architecture-audit.md`, ADR 0011).

## Contexte

Objectif du parcours : depuis l'administration, créer une ville et une carte, importer un paysage GLB/GLTF, le placer,
rendre une boutique interactive, publier, et jouer la carte dans le jeu en préservant la Cité Akwaba et les données des joueurs.

## Décision

1. **Les cartes vivent dans l'atelier** (décision 1 de l'audit). Migration additive `_m4` : `cities`, `districts`,
   `game_maps` (brouillon JSON + `published_version` + statut `draft` / `published` / `disabled`), `map_versions`
   (versions publiées immuables). Service `backend/app/worldmaps.py`, routes `/api/game/world`, `/api/game/maps/…`
   (le préfixe `/api/world` appartenait déjà aux scènes de test). Permissions `world.manage` (éditeur, publieur) et
   `world.publish` (publieur) ; lecteur et joueur ne modifient rien.
2. **Ressource, instance, objet, comportement, état séparés.** Ressource : modèle 3D de la médiathèque (kind `model`,
   révisions). Instance (`landscapes`) : position (x, z en cases), quart de tour horaire, échelle, emprise solide ;
   **la révision du fichier est figée** à l'enregistrement, donc remplacer un fichier ne change pas une carte publiée.
   Objet interactif (`interactives`) : zone de cases tracée à la main, ou déduite d'un **objet nommé unique** du modèle
   (sinon refus explicite). Comportement : type du registre existant (`shop` → fiche `info` catégorie commerce, `info`,
   `door`), jamais de code. État du jeu : inchangé, dans Django.
3. **Médiathèque : GLB et glTF autonome** (`backend/app/gltf.py`) : glTF 2.0, structure, tampons et images intégrés
   (`data:`), pas de Draco/Meshopt (le jeu n'a pas les décodeurs), dimensions, objets nommés (doublons signalés),
   triangles, matériaux. Plafond `BABIVERSE_MAX_MODEL_MB` (20 Mo). Stockage existant (disque ou base) : le stockage objet
   recommandé par l'audit n'est **pas** encore en place.
4. **Unités** : 1 unité du modèle = 1 case = 1 unité Three.js à l'échelle 1 ; emprise au sol calculée par la même règle
   côté atelier (`worldmaps.footprint`) et jeu (`world/dataMaps.footprint`), tests communs.
5. **Publication** : contrôle complet (fichiers, emprises dans la carte, arrivée hors obstacle, destinations publiées,
   sortie active, accès depuis la ville, case d'accès non partagée) ; un brouillon n'atteint jamais le jeu.
6. **Diffusion** : section `maps` du pack de jeu (versions publiées seulement). Django relaie les fichiers 3D au
   navigateur (`GET /api/atelier/models/<média>/<révision>`, même origine, cache immuable) seulement s'ils sont annoncés
   par le pack et que leur empreinte SHA-256 correspond ; `sync_atelier` les copie à côté du pack. Django reconnaît les
   cartes du pack comme zones (`rules.zone_known` → `maps.atelier_maps`) ; le catalogue intégré a priorité.
7. **Jeu** : une carte devient une zone ordinaire (`world/dataMaps.dataZone`) ; `zone.blocked` (emprises) entre dans
   la grille de collision ; `engine3d/landscapes.js` pose un volume provisoire puis le modèle (`GLTFLoader` chargé à la
   demande, cache partagé `engine3d/modelCache.js`, libération des modèles inutilisés au changement de zone).
8. **Passage entre cartes** : accès depuis la Cité Akwaba = panneau de direction (`roadsign`) sur une case validée par les
   règles de placement de la ville (`world/placement.js`), porte vers la carte, retour devant le panneau (`from_<carte>`).

## Conséquences

- La Cité Akwaba n'est jamais remplacée : une carte de l'atelier ne peut pas prendre un identifiant intégré ni `int_`.
- Si l'atelier est injoignable et qu'aucun pack synchronisé n'existe, les cartes de l'atelier disparaissent du jeu ; la
  position d'un joueur qui s'y trouvait reste en base mais il réapparaît dans la Cité Akwaba (copie en base côté Django :
  risque R3 de l'audit, non traité).
- Limites : pas d'aperçu 3D dans l'atelier (aperçu vu de dessus) ; rotation par quarts de tour ; un seul accès par carte,
  depuis la Cité Akwaba ; pas de comportement économique sur les boutiques des nouvelles cartes (fiche seulement) ;
  modèles sans compression ; fichiers 3D en base sur Render gratuit.
