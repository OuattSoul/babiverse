# ADR 0003 — Passage du rendu en 3D (Three.js) avec caméra orbitale

Statut : accepté. Remplace la partie « rendu » de l'ADR 0001 ; les autres décisions restent valables.

## Contexte

Retour du porteur du projet : la vue 2D de dessus paraît « figée ». On ne peut ni pivoter, ni zoomer, ni parcourir la ville du regard. Il souhaite une interaction comparable à celle de [Lagos Life](https://lagoslife.app/).

Constat sur ce site, d'après la page et ses scripts : une ville en **3D low-poly rendue avec Three.js** (`WebGLRenderer`, `PerspectiveCamera`, `InstancedMesh`), vue en perspective inclinée, des icônes de lieux, et des lieux organisés en petites scènes avec des « stations » d'action.

## Décision

- **Three.js 0.179** remplace Phaser pour le rendu. La perspective est en 3D low-poly : bâtiments extrudés avec toits à quatre pans, arbres, véhicules, personnages articulés.
- **Caméra orbitale** (`engine3d/CameraRig.js`) :
  - glisser à un doigt : naviguer librement dans la ville ;
  - pincer : zoomer ;
  - tourner à deux doigts : pivoter ;
  - souris : clic droit pour pivoter et incliner, molette pour zoomer ;
  - boutons ⟲ ⟳ ＋ － et boussole (nord), plus le bouton « Revenir à mon personnage » en vue libre ;
  - inclinaison automatique selon le zoom : plus on zoome, plus la vue se rapproche de la hauteur d'homme.
- **Déplacement** :
  - joystick fixe en bas à gauche, ou clavier, toujours relatif à l'angle de la caméra ;
  - **toucher le sol** pour y aller (A* sur la grille, `world/pathfinding.js`) ;
  - **toucher un PNJ ou une porte** : le personnage s'y rend puis interagit.
- **Inchangé** :
  - grille, collisions, interactions, actions, interface, serveur, sauvegardes ;
  - positions en pixels de grille (1 case = 32 px = 1 unité 3D), donc les parties existantes restent compatibles.
- Les bâtiments deviennent transparents quand ils cachent le joueur.

## Conséquences mesurées

| | Phaser (avant) | Three.js (après) |
|---|---|---|
| Poids JS (gzip) | ~360 Ko | ~150 Ko |
| Appels de dessin (quartier) | — | 45 |
| Triangles visibles | — | ~900 |
| Images/s, Chrome mobile émulé, CPU ×4 | 60 | 56–60 |

- Pas d'ombres temps réel : un disque sous chaque personnage suffit et ne coûte presque rien.
- Les décors statiques ont des matrices figées et les shaders sont précompilés au chargement de chaque zone.
- La mesure n'a pas été faite sur un vrai téléphone Android : c'est le premier point du test terrain.
- Lagos Life passe d'un lieu à l'autre par une carte de la ville. Ici, on garde la marche dans un quartier continu. Une carte de la ville avec plusieurs quartiers est une suite naturelle (voir roadmap), et ce moteur s'y prête.
