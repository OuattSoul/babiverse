# ADR 0001 — Perspective 2D vue de dessus, Phaser 3

Statut : accepté (Phase 0). Réversible : coût moyen (le rendu est isolé dans `client/src/engine`).

## Contexte

Monde explorable dans le navigateur, sur des smartphones Android d'entrée de gamme et des connexions instables. Il faut un MVP jouable en 4 à 6 semaines, sans graphiste dédié au départ.

## Options comparées

| Critère | 2D vue de dessus | 2D isométrique / 2.5D | 3D légère (Three.js / Babylon.js) |
|---|---|---|---|
| Monde explorable, disposition des bâtiments | Simple : grille directe | Bon rendu, mais tri de profondeur et façades plus complexes | Très expressif, mais modélisation coûteuse |
| Déplacements et collisions | Grille AABB triviale, testable | Conversion de coordonnées, collisions en losange | Moteur physique ou navmesh nécessaire |
| Caméra et scènes | Suivi 2D, bornes | Idem 2D | Caméra 3D à régler (occlusion, angle) |
| Interactions (proximité, ligne de vue) | Distance et raycast sur grille | Idem, après projection | Raycast 3D |
| Performance Android d'entrée de gamme | Excellente (tilemap avec culling) | Bonne | Fragile (GPU, mémoire, chauffe) |
| Poids initial | Faible | Faible à moyen | Élevé (moteur + modèles + textures) |
| Production d'assets | Tuiles 32 px, générables par code | Tuiles iso plus difficiles à dessiner | Modèles 3D |
| Coût du MVP | Faible | Moyen | Élevé |
| Évolutivité (quartiers, villes) | Ajout de cartes (Tiled possible) | Idem | Idem mais coûteux |

Moteurs évalués :

- **Phaser 3** : moteur 2D web mature (tilemaps, caméra, animations, entrées, WebGL avec repli Canvas), une seule dépendance npm, très documenté.
- **Phaser 4** (4.2.1 disponible) : API proche, mais plus récent ; documentation et retours communautaires moins fournis. La migration depuis Phaser 3 reste possible plus tard.
- **Three.js / Babylon.js** : excellents pour la 3D, surdimensionnés pour une vue 2D.
- **Godot (export web)** : bon éditeur, mais export WASM lourd (plusieurs Mo, démarrage lent sur mobile modeste) et intégration plus difficile avec une interface DOM et un backend web.

## Décision

- **Perspective 2D vue de dessus**, tuiles de 32 px, cartes ASCII versionnées dans le code (`client/src/world/zones.js`).
- **Phaser 3.90** pour le rendu (tilemap, sprites, caméra, tweens) et le clavier.
- **Collisions maison** (module pur `world/grid.js`) plutôt qu'Arcade Physics. Elles sont déterministes, testées avec Vitest, et le monde n'a besoin que de collisions AABB contre une grille. Les PNJ réutilisent le même module.
- **Textures générées par code** (`engine/textures.js`) : aucune image à télécharger. On pourra les remplacer par de vrais sprites sans toucher à la logique.
- **Interface secondaire en DOM**, au-dessus du canvas : texte net, accessible, bon marché à rendre.

## Conséquences

- Le chunk Phaser pèse environ 340 Ko gzip. Une version de Phaser personnalisée (sans les modules inutilisés) est une optimisation possible plus tard.
- L'éditeur de cartes Tiled pourra remplacer les cartes ASCII quand les quartiers grandiront. La grille de collision sera alors dérivée d'un calque Tiled.
