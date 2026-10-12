# Conception du monde

## Principes

- Monde en **3D low-poly** (Three.js), construit à partir des cartes ASCII : 1 case = 1 unité 3D = 32 px de grille.
- **Caméra orbitale** : elle suit le joueur, ou passe en vue libre dès qu'on fait glisser la carte. Pincer zoome, tourner à deux doigts fait pivoter. L'inclinaison suit le zoom. Les bâtiments qui cachent le joueur deviennent transparents.
- **Navigation selon la zone** (ADR 0005) :
  - **ville** (`navigation: 'camera'`) : glisser explore, et un clic ouvre la fiche de l'objet visé sans jamais faire marcher ;
  - **logement** (`navigation: 'walk'`) : un clic sur le sol fait marcher (A*, `world/pathfinding.js`), et un clic sur un meuble ou une porte ouvre sa fiche.
- Les cartes sont des grilles ASCII dans `client/src/world/zones.js`. La légende (praticable, solide, opaque) est dans `world/grid.js`.
- Les décors (véhicules, étals, kiosque, mobilier urbain, panneaux) sont des `props`, et ceux marqués `solid` bloquent le passage. Le décor immobile est fusionné par matériau pour limiter les appels de dessin.
- Les bâtiments sont déduits des cartes (`world/structures.js`) : murs en volume, façade sud peinte (porte, fenêtres), toit à quatre pans en tôle, ocre ou bleu. On entre par la porte.

## Zones du MVP

### Cité Akwaba (extérieur, 56 × 40 cases, générée par `world/city.js`)

La carte n'a **pas de taille fixe** : `cityExtent` la calcule à partir de son contenu (routes, bâtiments, parcelles, panneaux, décors, végétation). Un élément placé au-delà du bord actuel agrandit la ville vers l'est ou le sud. Les routes, le sol, l'enceinte, les limites et le zoom de la caméra, ainsi que la circulation, suivent. Elle mesure aujourd'hui 108 × 105 cases, lotissement compris. L'origine reste fixe et les coordonnées commencent à 1, car la case 0 est l'enceinte : les positions enregistrées par le serveur restent valables quand la carte grandit.

### Lotissement et maison initiale

Le **Lotissement Akwaba** (`residential` dans `shared/city.json`) est une zone de 64 × 64 cases, au sud-est de la ville, sans route qui la traverse. Elle contient 1 024 emplacements de 2 × 2 cases. À la création de son personnage, chaque joueur reçoit automatiquement le premier emplacement libre, et sa maisonnette y est construite dans la **même transaction** (`services/homes.py`, modèle `Home`). Une seule ligne porte l'emplacement et la maison, et elle est unique par joueur, par numéro d'emplacement et par coordonnées. Les connexions suivantes ne font que relire cette maison. Une réinitialisation du personnage la conserve.

L'emplacement *n* a une position fixe, calculée de la même façon par le serveur et par le client (`world/residential.js`). Quand les 1 024 emplacements sont pris, l'emplacement 1 024 ouvre un nouveau bloc de 64 × 64 cases au sud. La carte grandit et aucune maison ne bouge. Les emplacements libres affichent une bordure, un fond blanc semi-transparent et un « + », dessinés par un seul maillage instancié.

```
  P01            │ │  P02   P03       │ │  (herbe)        ← parcelles libres au nord
 [Moi][Voisin][Épicerie] │ │ [Maquis] [Dépôt]  │ │  P04   P05
 ═════ Avenue Akwaba ════╪═╪══════════════════╪═╪═══════════   (taxi, gbaka, poteaux, lampadaires)
  kiosque  garba         │ │  Place Akwaba    │ │  P06   P07
  (Koffi, Aya)           │ │  (bancs, palmier)│ │
 [Kouassi]   [Voisin]    │ │ [Couture][Pharma][Transfert] │ │ [Bamba]
 ═════ Rue des Fromagers ╪═╪══════════════════╪═╪═══════════
 [Voisin]  P08           │ │  P09     P10     │ │  P11   P12
          Bd de l'Ouest ─┘ └─        Bd de l'Est ┘ └─
```

- **Réseau routier** : 2 rues est-ouest et 2 boulevards nord-sud. Chaque voie a un trottoir, une chaussée et un marquage central, et les 4 carrefours ont des passages piétons. Des panneaux indiquent Adjamé, Plateau, Treichville et Marcory aux extrémités.
- **Bâtiments compacts** : 3 à 5 cases × 2. Commerces avec enseigne : épicerie, maquis, dépôt, couture, pharmacie, transfert d'argent.
- **12 parcelles** pour les bâtiments des joueurs, dont 11 à vendre et une indisponible (P12, réservée par la mairie, panneau gris). Chacune a un contour au sol, des piquets et un panneau, et toutes sont espacées et accessibles depuis la rue.
- **Mobilier** :
  - poteaux électriques reliés par des câbles et lampadaires allumés la nuit ;
  - bancs, poubelles, stops ;
  - 5 supports publicitaires (`ad_slots`) : 4 panneaux en bord de route et un totem sur la place. Trois affichent une annonce fictive (`shared/ads.json`), deux sont libres (« VOTRE PUB ICI »).
- Les décors solides de 1 case posés sur un trottoir restent contournables par la chaussée (vérifié par un test).

### Mon studio (intérieur, 10 × 8)

Lit (sieste), frigo (message), étagère, table, tapis. Sortie par le paillasson en bas.

### Épicerie Chez Fofana (intérieur, 12 × 9)

Rayons, frigos à boissons, comptoir. M. Fofana se tient derrière le comptoir, on lui parle par-dessus. Sortie en bas.

## Transitions

Une porte (`type: 'door'`) indique `target: { zone, spawn }`. Au moment de l'interaction :

1. fondu au noir de 200 ms ;
2. sauvegarde immédiate de la zone et du point d'arrivée (`/api/sync`) ;
3. construction de la nouvelle zone en 3D, avec libération de la précédente et précompilation des shaders ;
4. apparition au point nommé : `from_maison` devant la porte de la maison, `entree` sur le paillasson.

L'inventaire, le solde et les besoins vivent dans l'état serveur, indépendamment de la scène : ils ne sont jamais réinitialisés. À la reconnexion, la position sauvegardée est réutilisée si elle est praticable, sinon on revient au point d'apparition par défaut de la zone.

## Collisions

Le module pur `world/grid.js` gère les collisions :

- corps du joueur de 14 × 10 px aux pieds ;
- résolution axe par axe, ce qui permet de glisser le long des murs ;
- sous-pas d'un quart de case au maximum : aucun passage à travers un mur, même si le jeu saccade ;
- l'extérieur de la carte est solide.

Il n'y a pas de moteur physique. Les PNJ utilisent le même module.

## Système d'interaction

Chaque élément interactif est déclaré par des données :

```js
{ id: 'lit', type: 'bed', tile: [1, 1], w: 2, label: 'Faire une sieste', range: 44 }
```

- **Type** (`door`, `info`, `bed`, `npc`, `delivery`, `kiosk`) : `world/interactionTypes.js` le transforme en actions `{ label, enabled, reason, run }`, à partir de l'état serveur courant. Une liste vide rend l'élément invisible, comme un point de livraison hors service.
- **Sélection** (`world/interaction.js`, pur) : on retient l'élément le plus proche **à portée** (44 px par défaut, réglable) et **en vue**. La ligne de vue est bloquée par les murs et façades, pas par les meubles : on parle à l'épicier par-dessus son comptoir.
- **Invite** : sur ordinateur, « E — Entrer chez moi » ; sur mobile, le bouton ✋. Une flèche jaune marque la cible. Si la condition n'est pas remplie, l'invite affiche la raison (« Tu viens de te reposer (encore 42 s) »).
- Ajouter un objet ne demande que des données, plus un type si le comportement est nouveau. Le contrôleur du joueur ne change jamais.

### Sélection au clic

Tous les clics passent par `World3D.onTap`, en un seul point :

1. **Clic ou glissement** (`world/pointer.js`) : la caméra écarte les glissements, les gestes à deux doigts, les appuis longs et le clic droit.
2. **Objet visé** (`world/selectables.js`) : le rayon du clic est testé contre des volumes déduits des données. Le décor n'en a pas, donc il ne bloque jamais un objet interactif situé derrière lui. Un bâtiment regroupe sa porte, sa pancarte et ses points de livraison.
3. **Politique de la zone** (`resolveTap`) : sélection, marche (logement seulement) ou rien.
4. **Fiche** (`world/selection.js`, `ui.selection`) :
   - elle affiche les informations et les actions de l'objet ;
   - une action de proximité hors de portée devient « Y aller : … », un déplacement explicite suivi de l'action ;
   - une publicité diffusée ouvre une fiche dédiée : image complète, description, « En savoir plus » (lien HTTPS validé).

| Catégorie | Exemples | Volume cliquable |
|---|---|---|
| `building` / `shop` | maisons, épicerie, maquis, boutiques des joueurs | rectangle du bâtiment, 1,9 de haut |
| `plot` | P01 à P12 | sol de la parcelle et panneau |
| `door` | sorties du studio et de l'épicerie | case de la porte |
| `furniture` | lit, frigo, rayons | case(s) du meuble |
| `billboard` | panneaux, totem | support |
| `npc` | Koffi, Aya, Adjoua… | silhouette (suit le PNJ) |
| `decor` | arbres, véhicules, lampadaires | aucun (ne bloque pas les clics) |

## PNJ

| PNJ | Lieu | Rôle |
|---|---|---|
| Tonton Koffi | rue (flâne) | doyen du quartier, donne les premières missions |
| Aya | sous le manguier | étudiante, donne des conseils |
| M. Fofana | épicerie | commerçant |
| Tantie Adjoua | étal de garba | vendeuse de garba et d'alloco |
| M. Diabaté | devant le dépôt | employeur (livraisons) |
| Clients | route → kiosque | viennent quand le joueur « tient » son kiosque, attendent 20 s puis repartent |

Le « ! » jaune au-dessus d'un PNJ signale une mission à prendre ou une récompense à réclamer. Le champ `behavior` des PNJ (`static`, `wander`, plus tard horaires et trajets) est prévu pour évoluer sans changer la scène.

## Ambiance et culture

Les décors sont contemporains et ordinaires : taxi orange, gbaka, maquis avec parasols, garba et alloco, café Touba, sachets d'eau, cour en terre battue et toits en tôle. Il n'y a ni marque réelle ni caricature. Les dialogues sont en français courant, avec quelques expressions locales mesurées (« Akwaba »).
