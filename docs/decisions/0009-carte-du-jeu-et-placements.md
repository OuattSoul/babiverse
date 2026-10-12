# ADR 0009 — Carte du jeu dans l'atelier : l'administrateur place les éléments publiés dans la ville

Statut : accepté (2026-10-12). Complète l'ADR 0008.

## Contexte

Les bâtiments, objets, véhicules et surfaces publiés dans l'atelier n'apparaissaient nulle part dans le jeu : seule la garde-robe, les habitants et l'intérieur de la maison passaient par le pack de jeu. Demande : « l'admin doit avoir accès à la carte entière du jeu afin de tracer la dimension sur un espace où il souhaite insérer un élément ».

## Décision

1. **La carte vient du jeu** : la ville est générée par des modules purs du client (`client/src/world/city.js`, `grid.js`). La page « Carte du jeu » de l'atelier (`#/jeu/carte`) les importe directement (alias Vite `@jeu` → `client/src`) : l'administrateur voit exactement la ville des joueurs. Conséquence : reconstruire l'atelier (`npm run build`) quand la ville du jeu change.
2. **Mêmes règles des deux côtés** : `client/src/world/placement.js` (`occupancy`, `placementIssue`) refuse routes et trottoirs, parcelles des joueurs, lotissement et ses extensions, bâtiments, arbres et décor solide, portes, guichets, panneaux et PNJ, les chevauchements, une façade sans passage et un bâtiment collé à l'entrée d'un autre. L'atelier s'en sert pour guider ; le jeu ignore à l'affichage un placement devenu invalide (ville modifiée depuis), avec sa raison.
3. **Placement** = asset publié + rectangle de cases + orientation (`settings` de l'atelier, clé `game.placements`, `GET/POST/DELETE /api/game/placements`, écriture `asset.publish`). L'élément garde son emprise (tournée selon l'orientation) et se centre dans la zone tracée ; une surface prend la taille tracée (40 cases au plus). Le serveur de l'atelier vérifie ce qu'il connaît : famille, publication, dimensions, chevauchements.
4. **Pack de jeu** : `placements` (position, orientation, données de rendu, intérieur associé du bâtiment) et `kits` (objets modulaires), composants dans `parts`. Le jeu suit la version publiée courante de chaque élément.
5. **Retrait des éléments d'origine** (ajout du même jour) : bâtiments, arbres et mobilier de la ville ont une clé stable (`bld:<id>`, `tree:x,y`, `prop:<type>:x,y`, `client/src/world/removal.js`). L'administrateur les retire ou les remet depuis la carte (`game.removals`, `/api/game/removals`, `removals` dans le pack) ; le jeu les enlève avant d'ajouter les placements, ce qui libère leur place. Ce dont le jeu a besoin est **protégé** et jamais retiré, même si une clé le demande : commerce à intérieur dessiné (épicerie), emploi (dépôt Diabaté), destinations de livraison, kiosque du joueur, étal de garba, parcelles et panneaux publicitaires (connus du serveur).
6. **Rendu dans le jeu** (`client/src/atelier/world.js`, `engine3d/atelierBuilders.js`) : les placements deviennent des données de la ville. Bâtiment : cases solides, volume 3D d'après la définition (étages, couleurs, toit plat, à deux pans ou à quatre pans, fenêtres, porte, vitrine, auvent, enseigne), fiche, porte vers son intérieur (`int_<id>`, converti comme la maison, sans sieste) ou fiche seule. Objet : forme procédurale ou image de l'assemblage modulaire tournée vers la caméra. Véhicule : modèles du jeu à sa couleur. Surface : revêtement peint (l'eau bloque le passage).

## Conséquences

- Les bâtiments modulaires de l'atelier sont rendus en volume 3D d'après leurs couleurs et leurs étages, pas avec leur façade SVG (vue de face seulement, incompatible avec la caméra orbitale).
- Un élément placé n'a pas de comportement de jeu (commerce, emploi…) : fiche et intérieur seulement.
- La carte affichée dans l'atelier correspond à un seul bloc de lotissement ; toutes les colonnes du lotissement sont de toute façon réservées.
