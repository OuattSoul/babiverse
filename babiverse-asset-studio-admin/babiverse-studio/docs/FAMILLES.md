# Familles supportées et capacités réelles

Source de vérité : `backend/app/taxonomy.py` (`FAMILIES[...]["capabilities"]`), affichée dans l'interface (*Paramètres du projet*, cartes de l'assistant, pages de section). Une famille n'est pas déclarée « disponible » parce qu'elle apparaît dans le menu : chaque capacité ci-dessous est implémentée côté serveur (schéma, validation, placement) et côté interface (formulaire, rendu), et couverte par des tests.

Légende : ✅ disponible · 🧪 expérimental · — non pris en charge.

| Famille | Création | Édition | Aperçu | Placement | Variantes | Import de fichiers | Export | Comportements | Publication | Assemblage | Jeu actuel |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Bâtiment | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ façade | adaptateur (2×2) |
| Intérieur | ✅ | ✅ | ✅ | — (associé à un bâtiment) | — | — | ✅ | ✅ | ✅ | ✅ pièces/meubles | non chargé |
| Segment routier | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | — | ✅ | — | non chargé |
| Surface / terrain | ✅ | ✅ | ✅ | ✅ | ✅ | 🧪 texture | ✅ | — | ✅ | — | non chargé |
| Mobilier urbain, végétation, décor | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ sprite | ✅ | ✅ | ✅ | — | non chargé |
| Meuble d'intérieur | ✅ | ✅ | ✅ | ✅ (dans un intérieur) | ✅ | ✅ sprite | ✅ | ✅ | ✅ | — | non chargé |
| Véhicule | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ sprite | ✅ | 🧪 | ✅ | — | non chargé |
| Personnage | ✅ | ✅ | ✅ | ✅ | ✅ tenues | ✅ (via composants) | ✅ | 🧪 | ✅ | ✅ calques | adaptateur (peau, haut, coiffure) |
| Composant de personnage | ✅ | ✅ | ✅ | — | — | ✅ SVG | ✅ | — | ✅ | ✅ | via le personnage |
| Composant modulaire | ✅ | ✅ | ✅ | — | — | ✅ SVG | ✅ | — | ✅ | ✅ | non chargé |

**Représentation modulaire** (bâtiment, véhicule, objet, meuble, surface) : en plus de leur rendu procédural ou sprite, ces familles peuvent être **assemblées** à partir d'un kit de composants SVG. Voir « Composant modulaire et kits » ci-dessous.

## Détail par famille

### Bâtiment (`building`, rendu procédural)
Emprise rectangulaire ou case par case (d'un seul tenant), étages, hauteur cohérente (≥ 2,5 m par niveau), toiture terrasse / deux pans / quatre pans (pans : emprises rectangulaires seulement), fenêtres, porte, façade commerciale (enseigne, vitrine, auvent, emplacements de marchandises), entrées typées (principale, service, urgence, livraison), zones (interaction, sécurité, interdite, livraison, stationnement), intérieurs par niveau, **façade modulaire** (9 modules avec règles de niveau), propriété, capacité, niveau d'amélioration, attribution à un joueur. Règles de catégorie : maison de joueur, commerce, entrée de service, accès routier obligatoire.
Limites : pas de sprite dessiné ; façades Nord/Ouest visibles seulement en pivotant.

### Intérieur (`interior`, assemblage)
Grille de tuiles (1 case de ville = 4 × 4 tuiles), pièces typées, portes (vers une pièce ou l'extérieur), mobilier (intégré ou meubles de l'atelier) avec action, point d'apparition, zones interdites. Validation : chevauchements, portes bloquées, accessibilité de chaque pièce, meubles dans une seule pièce, ne bloquant pas une porte, **circulation** depuis l'apparition (avertissement si un meuble interactif ou une pièce n'est pas atteignable à pied), taille compatible avec l'emprise du bâtiment hôte.
Limites : un seul niveau ; cloisons déplacées en modifiant les dimensions des pièces.

### Segment routier (`road`)
Droite, virages, T, croix, extrémité, rampe ; voies, sens unique, trottoirs, marquage ; raccords générés (voies, largeur, niveau, sens) ; compatibilité calculée ; au placement : alignement, raccord face à raccord, flanc.

### Surface (`surface`)
Type (pelouse, sable, eau, piscine, pavés, parking, terre), terrain obtenu (remplace le terrain de base), praticable, constructible, motif. Couche « sol » : pas de superposition de surfaces ni de route sur une surface ; un objet ne se pose que sur une surface constructible.
Expérimental : une texture importée n'est affichée qu'en vignette (pas de pavage texturé).

### Mobilier urbain, végétation, décor (`prop`)
12 formes procédurales ou image importée (point d'ancrage au sol, échelle). Collision ou décor traversable, zone de sécurité.
Limite : un sprite n'a qu'une vue (il ne change pas selon la rotation).

### Meuble d'intérieur (`furniture`)
Forme ou image, taille en tuiles, hauteur visuelle, actions déclarées parmi celles du moteur. Utilisable dans tous les intérieurs (référencé par son identifiant ; il doit être publié avant l'intérieur qui l'utilise).

### Véhicule (`vehicle`)
8 types, carrosserie procédurale ou image, couleurs, bande, enseigne de toit, places, points d'ancrage nommés (affichés dans l'aperçu), stationnement : voirie, voirie ou parking, partout.
Non pris en charge : conduite, trajectoires, animation des roues (le moteur ne les a pas).

### Personnage (`character`, SVG)
Composition déclarative : corps (silhouette homme ou femme), couleurs globales (peau, cheveux, yeux), taille ±15 %, un calque par emplacement (20 emplacements, dont le maquillage), couleurs par calque (palettes respectées), motif par vêtement, **tenues en variantes** (ne stockent que les différences). Validation serveur : composants existants, publiés pour publier, du bon emplacement, compatibles avec le corps et avec son **genre** (composants réservés : maquillage, talons, robes… pour les femmes ; barbe, cravate pour les hommes), incompatibilités et dépendances, palette, tenue complète. Les versions exactes des composants sont **figées à la publication**.
Non pris en charge : poses autres que de face, animation.

### Composant de personnage (`character_part`, SVG)
SVG assaini, canaux de couleur (convention `var(--babi-<canal>, défaut)`), ancrage sur le corps (le calque suit les points d'ancrage de chaque silhouette compatible), ordre de rendu, décalage, échelle, palette, corps compatibles, emplacements incompatibles/nécessaires, composants incompatibles, calque arrière, correspondance avec les coiffures du jeu actuel. Un corps déclare ses points d'ancrage.

### Composant modulaire (`component`, SVG) et kits
Six kits définis dans `taxonomy.KITS` (repère, ligne de sol, emplacements, points d'ancrage de référence, couleurs partagées, emplacements à motif) :

| Kit | Famille | Repère | Emplacements | Départ |
|---|---|---|---|---|
| Façades de bâtiment | bâtiment | 0 0 200 280, sol y = 270, vue de face | structure, toiture, équipement de toit, rez-de-chaussée, fenêtres d'étage, porte, balcon, équipement mural, auvent, enseigne, clôture, plantes, motif | 66 composants |
| Véhicules | véhicule | 0 0 240 140, profil | carrosserie, roues, livrée, autocollant, pare-chocs, arrière, phares, toit, chargement, motif | 45 |
| Végétation | objet | 0 0 160 220 | tronc, feuillage, fleurs/fruits, bac ou pied d'arbre, couvre-sol, motif | 29 |
| Mobilier urbain et étals | objet | 0 0 160 220 | structure, tête, toit/parasol, assise, marchandises, accessoire, objet au sol, motif | 38 |
| Meubles | meuble | 0 0 200 160 | structure, pieds, coussins, literie, plaid, poignées, objet posé, motif | 38 |
| Surfaces et sols | surface | 0 0 200 200, vue de dessus | revêtement, détails, marquage, bordure, motif | 27 |

Une base déclare ses points d'ancrage sous forme de **listes de positions** ; une pièce accrochée à un point est dessinée à chaque position (fenêtres par étage, roues par essieu) et devient incompatible avec une base qui n'a pas ce point. Règles vérifiées par le serveur et par l'interface : base et pièces du même kit, emplacement, bases autorisées, point d'ancrage, palette, motif autorisé, incompatibilités, dépendances, emplacements obligatoires, variantes ; à la publication, composants publiés et versions figées.
Limites : une seule vue (façade de face, véhicule de profil) ; dans la carte isométrique, l'image est posée debout comme un sprite (les sols sont projetés sur l'emprise) ; le jeu Three.js ne charge pas encore ces assemblages.

## Comportements (`backend/app/behaviors.py`)

| Comportement | Familles | Jeu actuel |
|---|---|---|
| Ouvrir un intérieur | bâtiment | exploité (via adaptateur) |
| Logement attribuable à un joueur | bâtiment | exploité (lotissement) |
| Vente de marchandises | bâtiment, meuble | exploité |
| Fiche d'information | bâtiment, objet, véhicule, personnage, meuble | exploité |
| Dormir | meuble | exploité (sieste) |
| Zone d'interaction, S'asseoir, Manger, Cuisiner, Travailler, Ranger, Se laver, Utiliser, Regarder, Allumé la nuit, Flâner, Dialogue simple, Stationné | selon le comportement | atelier seulement (extension du moteur à écrire) |

« Exploité » signifie que le jeu Babiverse a déjà la mécanique correspondante ; aucun export automatique ne l'active encore dans le jeu (voir `INTEGRATION.md`).
