# ADR 0004 — Ville modulaire, bâtiments compacts et parcelles pour les joueurs

Statut : accepté.

## Contexte

Les bâtiments étaient trop grands : 5 à 8 cases × 4, soit plus de 20 cases chacun pour un personnage d'une case. Ils occupaient une grande part d'un quartier de 40×22 cases, et il fallait libérer de la place pour les futures constructions des joueurs. La carte était dessinée à la main ligne par ligne, ce qui la rendait difficile à agrandir.

## Décision

1. **Gabarits compacts.** Chaque bâtiment fait 3 à 5 cases de large et 2 de profondeur (une rangée de toit, une de façade). Les murs mesurent 1,3 unité pour un personnage de 0,95, les toits sont bas et l'enseigne est en saillie. Les façades peuvent donner au nord ou au sud, donc border une rue des deux côtés.
2. **Ville générée par des données** (`client/src/world/city.js`) :
   - `H_ROADS` et `V_ROADS` décrivent le réseau : trottoir, chaussée de 3 voies, trottoir. Les carrefours et passages piétons sont déduits automatiquement ;
   - `BUILDINGS` contient les bâtiments publics et prédéfinis (gabarit, position, orientation, enseigne) ;
   - `PLOTS` contient les parcelles réservées aux joueurs (rectangle et côté d'accès) ;
   - `AD_SLOTS` contient les emplacements publicitaires, avec leur contenu dans `world/ads.js` ;
   - le mobilier (lampadaires, poteaux et câbles, bancs, poubelles, stops, panneaux de direction, véhicules) est défini par des listes.

   La grille de collision, le rendu 3D, les interactions et les tests sont déduits de ces données. Ajouter un bâtiment ou une parcelle tient en une ligne.
3. **Séparation public / joueurs.**
   - Les bâtiments publics sont dans `BUILDINGS`.
   - Les terrains des joueurs sont dans `PLOTS`, avec un sol spécifique (`l`), un contour au sol et un panneau « PARCELLE Pxx ».
   - `canPlaceBuilding(city, rect, solidAt)` valide un futur placement : le bâtiment doit tenir dans une seule parcelle, ne toucher ni route, ni bâtiment, ni décor solide, et garder un accès devant sa façade.
4. **Échelle de la ville** : taille déduite du contenu (`cityExtent`, sans limite fixe), aujourd'hui 56×40 cases, 2 rues, 2 boulevards, 9 îlots, 12 bâtiments compacts, **12 parcelles libres**. Les bâtiments occupent moins de 6 % de la surface, vérifié par un test.

## Conséquences

- Les identifiants utilisés par le serveur (portes, livraisons `drop_*`, kiosque) sont conservés : aucune migration nécessaire. Une position sauvegardée devenue invalide dans la nouvelle carte renvoie le joueur au point d'apparition (comportement existant).
- Performance mesurée dans Chrome en émulation mobile, CPU ralenti ×4 : 58 à 60 images/s, environ 80 appels de dessin, environ 12 000 triangles. Le décor immobile est fusionné par matériau.
- **Suite réalisée** :
  - les parcelles et les emplacements publicitaires sont passés dans `shared/city.json`, lu par le serveur et le client ;
  - le serveur attribue les parcelles (`PlotClaim`), calcule l'emplacement des constructions et loue les panneaux (`AdCampaign`) ;
  - les bâtiments des autres joueurs sont affichés et solides chez tous les joueurs.

  Voir `docs/economy.md`.
