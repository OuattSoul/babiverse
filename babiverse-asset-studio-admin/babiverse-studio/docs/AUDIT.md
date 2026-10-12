# Audit du prototype et écarts traités (2026-10-11)

## 1. Constat sur le prototype v0.1 (avant travaux)

Vérifié dans le code, tests lancés : 21 tests backend et 4 tests frontend verts, TypeScript compilant.

| Annoncé ou attendu | Réalité dans le code v0.1 |
|---|---|
| Bâtiments, intérieurs, segments routiers | **Fonctionnels** : schémas, validation, rendu, placement, versions, migration d'instances. |
| Personnages, véhicules, mobilier urbain, surfaces | **Absents** : déclarés dans `taxonomy.py` avec `implemented: False`, pages « bientôt » sans fonction. |
| Personnage modulaire SVG (`Atelier Babiverse.md`) | **Le moteur `BabiAvatar` et ses fichiers `character/*.js` n'existent pas** dans le dépôt : seul le texte du document est présent. |
| Import de fichiers | **Absent** (`resources` « réservé aux imports »). |
| Catégories configurables | Codées en dur dans `taxonomy.py`. |
| Import / export | Absent. |
| Gestion des utilisateurs | Lecture seule, comptes créés par code ; mots de passe de développement triviaux créés en toutes circonstances. |
| Sessions | Pas de déconnexion serveur, pas d'expiration d'inactivité, pas de limitation des échecs. |
| Monde de test | Un seul monde, sans distinction affichée avec la production. |
| Migrations | `CREATE TABLE IF NOT EXISTS` seulement, aucune gestion de version de schéma. |
| Intégration au jeu | Le README v0.1 supposait que le dépôt du jeu n'était pas accessible et que l'atelier deviendrait « le moteur du jeu ». En réalité le jeu est **dans ce même dépôt**, en **Three.js + Django**, avec ses propres formats (`TEMPLATES`, `shared/city.json`, apparence `{skin, outfit, hair}`) : aucun lien n'existait. |

## 2. Ce qui a été fait

- **Fondations** : configuration par variables d'environnement ; migrations numérotées (`PRAGMA user_version`) reprenant une base v0.1 sans perte ; catégories en base, administrables ; capacités déclarées par famille et affichées ; registre de comportements déclaratifs ; sessions glissantes révocables, verrouillage après 5 échecs, gestion des comptes et des rôles (nouveau rôle Lecteur) ; en-têtes de sécurité ; journal d'audit étendu ; refus de démarrer en production sans secrets, aucun compte de développement en production.
- **Six familles ajoutées** : surface, objet (mobilier urbain, végétation, décor), meuble d'intérieur, véhicule, personnage, composant de personnage — schémas, validation serveur, rendu isométrique, règles de placement par couche, formulaires générés.
- **Personnages modulaires** : bibliothèque de 56 composants SVG dessinés dans le repère du document d'origine (19 emplacements), import sécurisé de nouveaux SVG avec convention de couleurs, compositeur pur réutilisable par le jeu, ancrages par silhouette, motifs, palettes, incompatibilités et dépendances (vérifiées côté client et côté serveur), tenues en variantes, générateur d'habitants, vue en situation.
- **Bâtiments et intérieurs** : façade modulaire (atelier d'assemblage), outils d'intérieur (dessin de pièce, déplacement et rotation de meubles, circulation), meubles créés dans l'atelier utilisables dans les intérieurs.
- **Médiathèque** : stockage par empreinte hors base, type vérifié par signature, assainissement SVG, limites configurables, liens signés, remplacement sans perte de références, révisions figées par les versions publiées, archivage contrôlé.
- **Versions** : dépendances figées à la publication, comparaison de versions, retour contrôlé à une version.
- **Scènes de test multiples**, séparées et explicitement présentées comme non-production ; déplacement, étiquette, variante d'instance.
- **Import / export** documentés, aperçu, conflits, rapport, annulation ; **intégration** : catalogue d'exécution et adaptateur du jeu actuel.
- **Interface** : 18 sections, assistant de création en 7 étapes, catalogue grille/liste, tableau de bord, responsive et tactile.
- **Tests** : 41 backend, 19 frontend, 18 étapes de bout en bout dans Chrome (deux environnements, mobile).

## 3. Ce qui reste à faire (limites réelles)

1. **Côté jeu** : écrire le chargeur du catalogue d'exécution dans le client Three.js (constructeurs pour surfaces, objets, véhicules, meubles ; générateur d'intérieurs à partir des plans ; personnages SVG en panneaux ou poursuite des modèles 3D). L'atelier fournit les formats et le compositeur, pas ce code.
2. **Animations et poses** de personnages : aucun système n'existe (vue de face seulement).
3. **Véhicules** : conduite, trajectoires, roues — non pris en charge par le moteur.
4. **Textures de surface** : expérimental (vignette seulement, pas de pavage texturé).
5. **Sprites** : une seule vue, pas de rendu par angle.
6. **Assemblages** : depuis le 2026-10-12, bâtiments (façade), véhicules, végétation, mobilier urbain, meubles et surfaces s'assemblent par kits de composants SVG (une seule vue). Restent non disponibles : toits multiples sur une emprise en L, groupes de décor, assemblage en volume 3D.
7. **Échelle** : SQLite et un seul processus ; passer à PostgreSQL avant un usage intensif à plusieurs.
8. **Limitation des échecs de connexion** en mémoire (remise à zéro au redémarrage, par processus).
9. Variantes limitées par niveau ou contexte : le jeu n'a pas encore cette règle, elle n'est donc pas proposée.
10. Pas de test sur appareil mobile physique (émulation Chrome seulement).
