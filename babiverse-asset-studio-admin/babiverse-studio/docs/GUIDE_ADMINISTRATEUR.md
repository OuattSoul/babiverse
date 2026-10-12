# Guide de l'administrateur — Babiverse Asset Studio

Ce guide s'adresse aux personnes qui créent et publient le contenu de Cité Akwaba. Aucune connaissance en programmation n'est nécessaire : tout se fait dans l'interface.

## 1. Les mots à connaître

| Mot | Ce que c'est |
|---|---|
| **Asset** (élément) | Un modèle réutilisable : une maison, un taxi, un banc, un habitant, un meuble… |
| **Famille** | La « nature technique » de l'élément (bâtiment, intérieur, route, surface, objet, meuble, véhicule, personnage, composant de personnage). Elle décide de ce qu'on peut régler. Les familles sont fixées par les développeurs. |
| **Catégorie** | Le rôle dans le quartier (Santé, Commerce, Habitants, Végétation…). Vous pouvez en créer de nouvelles. |
| **Version** | Chaque publication est une version figée. Pour modifier un élément publié, on crée une nouvelle version. |
| **Brouillon** | Version en cours de travail, invisible pour le jeu. |
| **Instance** | Un exemplaire posé dans une scène de test, à une position donnée. |
| **Variante** | Une déclinaison d'un même élément (autre couleur, autre enseigne, autre tenue) sans tout recopier. |
| **Scène de test** | Un petit quartier de prévisualisation. **Ce n'est pas le jeu en production.** |

## 2. Se repérer

Le menu de gauche (bouton ☰ sur téléphone) est organisé en groupes :

- **Pilotage** : tableau de bord, catalogue, création.
- **Ateliers** : personnages, bâtiments, intérieurs et mobilier, routes/terrains/végétation, véhicules, assemblage.
- **Ressources** : médiathèque, composants de personnage, comportements, variantes.
- **Monde** : la carte de test.
- **Cycle de vie** : validation et publication, versions et historique, import/export.
- **Administration** : utilisateurs, paramètres.

Les boutons affichés dépendent de votre rôle : un **Éditeur** crée et soumet, un **Publieur** approuve et publie, un **Lecteur** consulte, l'**Administrateur** fait tout.

## 3. Créer un élément (assistant)

*Créer un élément* vous guide en 7 étapes :

1. **Famille** : chaque carte indique ce qui est disponible, expérimental ou non pris en charge.
2. **Catégorie** : ou partez d'un modèle publié (bouton *Dupliquer*).
3. **Identité** : nom affiché, description, sous-catégorie, étiquettes, image de couverture. L'**identifiant technique** est proposé automatiquement ; il ne changera plus jamais, même si vous renommez l'élément.
4. **Apparence et dimensions** : seuls les réglages utiles à la famille sont demandés.
5. **Comportements** : ce que l'élément permet de faire (entrer, dormir, vendre…).
6. **Aperçu** : rendu isométrique et vérification par le serveur (erreurs bloquantes en rouge, avertissements en orange).
7. **Enregistrement** : *Enregistrer comme brouillon*, *Valider* (revérifier), *Enregistrer et soumettre*, *Enregistrer et publier* (si votre rôle le permet), ou *Annuler*.

Pour une maison ou un commerce, un intérieur publié adapté est associé d'office ; vous pourrez le changer dans l'éditeur.

## 4. Créer et habiller un habitant

1. *Personnages → Nouvel habitant* : un habitant compatible est tiré au sort à partir des composants publiés.
2. À droite, chaque partie se change indépendamment :
   - **Corps** : silhouette, teinte de peau, taille (±15 %, limite du modèle).
   - **Cheveux** : coiffure, couleur (elle s'applique aussi aux sourcils et à la barbe), accessoire capillaire.
   - **Visage** : yeux et leur couleur, sourcils, nez, bouche et expression, barbe.
   - **Vêtements** : haut, veste, bas, robe ou boubou. Pour chacun : couleurs, **motif** (rayures, wax, carreaux, pois…) et taille du motif.
   - **Chaussures** et **Accessoires** : lunettes, chapeau/casquette/foulard, sac, montre, bijoux.
3. Les vignettes grisées sont **incompatibles** avec la tenue en cours (l'infobulle dit pourquoi : par exemple une casquette ne se porte pas sur une coiffure afro). Le panneau *Compatibilité* résume l'état.
4. Au-dessus de l'aperçu : *En pied*, *Portrait*, *En situation* (à 96 px et 40 px, à côté des habitants publiés) et *Vue isométrique* ; choix du fond. Une seule pose existe (de face) : aucune animation n'est simulée.
5. **Tenues (variantes)** : *Nouvelle tenue*, puis choisissez-la dans la liste « Tenue » au-dessus de l'aperçu ; ce que vous changez ensuite ne concerne que cette tenue. *Reprendre la tenue d'un autre personnage* copie ses vêtements. *Tenue au hasard* tire une tenue compatible.
6. *Enregistrer le brouillon*, puis *Soumettre à validation*.

**Générer plusieurs habitants** : *Personnages → Générer des habitants* ; choisissez le nombre, régénérez, sélectionnez ceux qui vous plaisent et enregistrez-les en brouillons.

### Hommes et femmes
Chaque silhouette déclare son **genre** (homme ou femme) et un composant peut être **réservé** à un genre : le maquillage (rouge à lèvres, fard à paupières, khôl, fard à joues), les talons et ballerines, les jupes, robes et kaba, certaines coiffures (chignon, bantu knots, nattes, queue de cheval, cheveux longs), le foulard noué, les boucles d'oreilles et créoles, le sac à main sont réservés aux femmes ; la barbe, la moustache et la chemise-cravate aux hommes. Le reste (t-shirt, chemise, pantalon, jean, short, boubou, baskets, sandales, lunettes, montre, collier…) convient aux deux.
Dans l'atelier, les composants réservés à l'autre genre ne sont **pas proposés** (le nombre masqué est indiqué) ; changer de silhouette retire automatiquement ceux qui ne conviennent plus. Le serveur refuse de toute façon un homme avec du rouge à lèvres ou des talons. La règle se règle sans code dans l'éditeur du composant (*Réservé à*) et de la silhouette (*Genre*).

## 5. Ajouter un composant de personnage (SVG)

*Composants de personnage → Importer un composant SVG* :

1. Choisissez le fichier. Le serveur le vérifie : scripts, liens externes, images intégrées et textes sont **retirés** et signalés ; un fichier dangereux ou illisible est refusé.
2. Vérifiez l'aperçu et le **viewBox**. Le repère commun est `0 0 200 380` (personnage de face, axe au milieu, pieds en bas). Un autre repère se rattrape ensuite avec l'échelle et le décalage.
3. **Couleurs personnalisables** : un SVG n'est pas recolorable tout seul. Pour chaque couleur détectée, choisissez *Couleur fixe* ou un canal (*Couleur principale/secondaire/d'accent*, *Peau*, *Cheveux*, *Yeux*) puis *Appliquer la convention*. Une nouvelle révision du fichier est créée.
4. Donnez un nom et un emplacement (haut, bas, coiffure…), puis *Créer le composant*.
5. Dans l'éditeur du composant : point d'ancrage (il suit la silhouette choisie), ordre de superposition, décalage et échelle avec aperçu sur un habitant de test, couleurs par défaut, **palette imposée** (facultative), corps compatibles, emplacements incompatibles ou nécessaires, composants incompatibles. Pour une coiffure, la *correspondance dans le jeu actuel* sert à l'export vers le jeu 3D.
6. Publiez le composant : un personnage publié ne peut utiliser que des composants publiés.

Astuce pour les dessinateurs : un groupe `<g data-babi-layer="back">` au premier niveau du SVG est dessiné **derrière** le corps (cheveux longs, sac à dos).

## 6. Bâtiments, façades et intérieurs

- **Éditeur de bâtiment** : géométrie (emprise rectangulaire ou case par case, étages, hauteur), apparence (couleurs, toiture, fenêtres, porte, façade commerciale), entrées (outil de clic *Placer l'entrée principale*), zones, intérieurs associés (par niveau), comportements, règles de placement, variantes.
- **Façade modulaire** : dans l'éditeur (section *Façade modulaire*) ou l'*Atelier d'assemblage* : pour chaque façade et chaque niveau, choisissez fenêtre, baie vitrée, persiennes, claustra, balcon (étages seulement), porte, vitrine ou garage (rez-de-chaussée seulement). Pivotez l'aperçu à 180° pour voir le Nord et l'Ouest.
- **Intérieurs** : outils de clic au-dessus du plan : *Dessiner une pièce* (deux touchers aux coins opposés), *Porte* (touchez une case contre un mur ; touchez encore pour changer de mur), *Poser : …* (meubles intégrés et meubles créés dans l'atelier), *Déplacer un meuble*, *Pivoter un meuble*, *Retirer un meuble*, *Point d'apparition*, *Zone interdite*. Cochez **Circulation** pour voir en vert les cases atteignables à pied depuis l'apparition et en rouge les autres. Les meubles se dupliquent depuis le tableau *Mobilier*.
- **Nouveau meuble** : *Créer un élément → Meuble d'intérieur* : forme ou image importée, taille en tuiles, couleurs, actions possibles (s'asseoir, dormir, cuisiner…). Une action n'ajoute aucune mécanique : elle déclare ce que le moteur sait déjà faire.

## 7. Routes, surfaces, végétation, mobilier urbain, véhicules

- **Routes** : type de segment, voies, sens unique, trottoirs, marquage ; les raccords se génèrent seuls, le panneau *Raccordements* liste les segments compatibles.
- **Surfaces** : pelouse, sable, eau, piscine, pavés, parking, terre ; elles changent le terrain sous elles ; « constructible » autorise à poser des objets dessus.
- **Végétation et mobilier urbain** : forme dessinée (arbre, palmier, buisson, lampadaire, banc, poubelle, panneau, clôture, abribus, kiosque) ou image importée.
- **Véhicules** : type (voiture, taxi, gbaka, bus, moto, vélo, utilitaire, secours), couleurs, bande, enseigne de toit, stationnement (voirie, parking, partout). Ils restent immobiles : la conduite n'existe pas dans le moteur.

## 7 bis. Ateliers modulaires (bâtiments, véhicules, végétation, mobilier urbain, meubles, surfaces)

Même principe que les habitants : **on sépare les composants, jamais les combinaisons**. Chaque kit a une **base** (structure de 1 à 4 niveaux, carrosserie, tronc, structure de banc ou d'étal, meuble, revêtement de sol) et des composants indépendants (toiture, porte, fenêtres, auvent, enseigne ; roues, livrée, phares, galerie, chargement ; feuillage, fleurs, pot ; tête de lampadaire, parasol, marchandises ; pieds, coussins, literie, objet posé ; motif, bordure, marquage…).

*Ateliers modulaires* (menu Ateliers) :
1. Choisissez un kit. La page montre les éléments déjà assemblés, une **rue de test** (éléments tirés au sort à 96 px et 40 px, sans aucun dessin supplémentaire ; *Enregistrer la sélection* crée des brouillons), le **nombre de combinaisons possibles** et les **tests de la bibliothèque** (repère commun, aucune couleur codée en dur, points d'ancrage, pièces dans le cadre, base posée sur le sol, générateur sans combinaison invalide…).
2. *Nouvel élément* : un assemblage compatible est tiré au sort, puis chaque partie se change seule dans les onglets (*Structure*, *Toiture*, *Ouvertures*…). Les pièces incompatibles sont signalées avec leur raison ; une pièce qui ne s'accroche pas à la base choisie (balcon sur une maison sans étage, galerie sur une moto) est refusée.
3. Couleurs : couleurs propres de chaque pièce et **couleurs partagées** du kit (menuiseries et vitrages d'un bâtiment, vitres et chromes d'un véhicule, feuillage et écorce…). Motifs sur les emplacements prévus (murs, auvent, carrosserie, coussins, sol…).
4. Onglet *Variantes* : comme les tenues, une variante ne stocke que les différences. Onglet *JSON* : la configuration lisible et modifiable (le serveur revalide tout).
5. *Propriétés de l'élément* ouvre l'éditeur habituel (emprise, entrées, comportements, placement). Le nombre d'étages d'un bâtiment suit la structure choisie.
6. Enregistrez, soumettez, publiez : les versions exactes des composants sont figées à la publication. L'élément se place dans la carte de test (image debout ; les sols sont projetés sur leur emprise).

**Ajouter un composant** : *Composants modulaires → Importer un composant SVG* (ou depuis la page du kit). Dessinez dans le repère du kit (affiché à l'import : `0 0 200 280` pour les façades avec le sol à y = 270, `0 0 240 140` pour les véhicules, etc.), associez les couleurs aux canaux, choisissez l'emplacement. Dans l'éditeur : point d'ancrage, ordre, décalage, échelle, couleurs par défaut et palette, bases compatibles, incompatibilités et dépendances. Pour une **base**, saisissez ses points d'ancrage : plusieurs positions séparées par « ; » font répéter la pièce (fenêtres par étage, roues par essieu, coussins par place).

## 8. Variantes et thèmes

Dans l'éditeur, section *Variantes et thèmes* : *Ajouter*, *Dupliquer*, cocher les couleurs à remplacer, changer l'enseigne, la toiture, le motif… ; *Variante proposée par défaut* ; *Comparer* deux apparences côte à côte. La page *Variantes et thèmes* liste tous les éléments qui en ont.

## 9. Médiathèque

Importez des images (SVG, PNG, WebP, JPEG, GIF ; taille limitée, affichée à l'écran). Chaque fichier peut être renommé, classé, étiqueté, **remplacé** (même identifiant : les éléments qui l'utilisent suivent, mais une version déjà publiée garde la révision qu'elle utilisait) et archivé s'il n'est plus utilisé. La fiche d'un fichier liste où il est utilisé et toutes ses révisions.

## 10. Valider, publier, revenir en arrière

- *Soumettre à validation* (éditeur) → *Approuver* puis *Publier* (publieur). À chaque étape, le serveur revérifie tout, y compris que l'élément peut être posé quelque part.
- Publier une nouvelle version ne casse rien : l'ancienne passe « remplacée » et reste utilisée par les instances déjà placées. *Migrer les instances anciennes* propose de les passer à la nouvelle version, seulement là où c'est compatible.
- Panneau *Versions* : *Voir les différences* entre deux versions ; *Revenir à cette version* crée un nouveau brouillon à partir d'une ancienne version.
- *Archiver* retire l'élément du placement (impossible s'il est utilisé par un élément publié) ; *Restaurer* l'y remet.

## 11. Carte de test

Choisissez une scène (ou créez-en une : taille, type de terrain). Choisissez un élément publié dans la palette (filtre par famille), l'orientation et la variante, puis touchez une case. Le serveur vérifie terrain, collisions par couche, accès routier et raccords ; un refus s'explique dans le panneau. Touchez un objet pour l'étiqueter, changer sa variante, le **déplacer**, le pivoter, le retirer ou entrer dans le bâtiment. Une scène se duplique, se vide, s'exporte. **Rien de ce qui se passe ici n'atteint le jeu en production.**

## 12. Importer et exporter

*Importation et exportation* :

- **Exporter** : cochez des éléments (et des scènes), choisissez les versions, gardez « Inclure les dépendances » ; vous obtenez un fichier `.zip`.
- **Importer** : choisissez le `.zip` ; un **aperçu** indique pour chaque élément s'il est nouveau, identique, ou en conflit. Décidez : *Créer*, *Ignorer*, *Importer comme copie* (nouvel identifiant), *Ajouter une nouvelle version*. Rien n'est jamais écrasé. Après application, un **rapport** détaille le résultat ; *Annuler cet import* le défait tant que ses éléments n'ont pas été réutilisés.
- **Intégration avec le jeu** : deux fichiers téléchargeables pour l'équipe technique (voir `docs/INTEGRATION.md`).

## 13. Catégories, utilisateurs, paramètres

- *Paramètres du projet → Nouvelle catégorie* : nom, famille, sous-catégories, règles métier (maison de joueur, commerce avec façade, entrée de service recommandée, accès routier obligatoire). Archiver une catégorie empêche d'y créer de nouveaux éléments.
- *Utilisateurs et permissions* : créer un compte, changer un rôle, définir un nouveau mot de passe, désactiver (les sessions sont fermées). Le tableau des permissions montre ce que chaque rôle peut faire. Il reste toujours au moins un administrateur actif.
- *Paramètres du projet → Votre compte* : changer votre mot de passe, vous déconnecter partout.

## 14. En cas de problème

- Un message rouge explique toujours la cause ; dans les rapports, cliquez une ligne pour aller au champ concerné.
- *Session expirée* : reconnectez-vous ; un brouillon non enregistré est perdu (Ctrl+S enregistre dans les éditeurs).
- Une option manque (une coiffure, un meuble) : elle n'existe pas encore dans la bibliothèque. Importez-la ou demandez-la ; l'atelier ne propose jamais d'option fictive.
