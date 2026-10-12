# Babiverse Asset Studio — Cité Akwaba (v1.0)

Atelier d'administration no-code du contenu de Cité Akwaba. Un administrateur y crée, assemble, prévisualise, valide, publie, versionne, exporte et réimporte bâtiments, intérieurs, meubles, routes, surfaces, végétation, mobilier urbain, véhicules et **habitants modulaires en SVG** — sans modifier le code.

> **Principe directeur** : le code définit les capacités du système (familles, rendu, règles, comportements) ; l'administration crée et gère le contenu qui utilise ces capacités.

> **Position vis-à-vis du jeu.** Le jeu Babiverse (client Three.js + serveur Django, à la racine de ce dépôt) et l'atelier (FastAPI + Phaser) sont deux applications distinctes. L'atelier **ne modifie jamais** le jeu de production : ses « scènes de test » sont des scènes de prévisualisation. L'intégration passe par deux exports documentés (voir [docs/INTEGRATION.md](docs/INTEGRATION.md)).

Documentation :

| Document | Contenu |
|---|---|
| [docs/GUIDE_ADMINISTRATEUR.md](docs/GUIDE_ADMINISTRATEUR.md) | Guide pas à pas pour un administrateur non développeur |
| [docs/FAMILLES.md](docs/FAMILLES.md) | Tableau des familles supportées et de leurs capacités réelles |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Formats d'échange, intégration avec le moteur Babiverse, ce qui est compatible et ce qui exige un adaptateur |
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Environnement de test, déploiement sécurisé, sauvegardes |
| [docs/AUDIT.md](docs/AUDIT.md) | Audit du prototype v0.1, écarts constatés et ce qui reste à faire |

---

## 1. Lancer l'atelier en local

Prérequis : Python 3.11+ et Node 20+.

```bash
# Backend
cd backend
python -m venv .venv
.venv/Scripts/activate            # Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt

# Frontend : compiler une fois
cd ../frontend
npm install
npm run build

# Tout servir depuis le backend
cd ../backend
python -m uvicorn app.main:app --port 8000
# → http://localhost:8000
```

Développement du frontend avec rechargement : `npm run dev` dans `frontend/` (le proxy Vite renvoie `/api` vers le port 8000).

Au premier démarrage, la base est créée et remplie avec un **kit de départ publié** : routes, intérieurs, boutique, maisons (dont une à façade modulaire), mobilier urbain, végétation, surfaces, véhicules (taxi, gbaka, voiture, moto), meubles, **56 composants SVG de personnage** (19 emplacements), 3 habitants (Kouadio, Awa, Yao) placés dans la scène « Quartier de test », et **243 composants modulaires** répartis en 6 kits (façades, véhicules, végétation, mobilier urbain, meubles, surfaces) avec 18 éléments assemblés publiés. Ce premier démarrage prend environ une minute.

Comptes de **développement** (créés seulement hors production, mot de passe = identifiant) : `admin`, `editeur`, `publieur`, `lecteur`, `joueur`. En production, aucun compte de développement n'est créé (voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)).

Base : `backend/babiverse.db` (SQLite) ; fichiers importés : `backend/media/` (hors base). Les deux se règlent par `BABIVERSE_DB` et `BABIVERSE_MEDIA_DIR`.

## 2. Tests

```bash
cd backend  && .venv/Scripts/python -m pytest       # 45 tests
cd frontend && npm test                             # 31 tests (Vitest)
cd frontend && npm run build && npm run e2e         # 20 étapes de bout en bout (Chrome + playwright-core)
```

- **Backend** (`tests/test_scenarios.py`, `tests/test_studio.py`) : création, brouillon, duplication, validation, publication, archivage, permissions par rôle, sessions (déconnexion, verrouillage après échecs, comptes désactivés), schémas, références entre assets, médias (assainissement SVG, signatures de type, limites, liens signés, remplacement avec figeage des révisions), personnages (incompatibilités, palettes, corps, variantes, composants non publiés), nouvelles familles et règles de placement par couche, scènes de test séparées, intérieurs (circulation, meubles créés dans l'atelier), comportements, façades modulaires, retour à une version et comparaison, export/import aller-retour dans un environnement neuf (identifiants conservés, conflits, copies, annulation), archives malveillantes, **migration d'une base du prototype v0.1**, **persistance après redémarrage**, refus de démarrer en production sans secrets, comptes de développement désactivés en production.
- **Frontend** : compositeur de personnages (ordre des calques, ancrages, motifs, préfixage des identifiants, couleurs refusées si non hexadécimales), règles de compatibilité, générateur d'habitants, circulation dans les intérieurs, modèles de création, géométrie.
- **Bout en bout** (`frontend/e2e/run.mjs`, deux serveurs indépendants) — parcours asset : connexion → assistant de création → modification de l'apparence → brouillon → rechargement → brouillon retrouvé → validation → publication → catalogue → placement dans la carte de test → export → **réimport dans un autre environnement**. Parcours personnage : import d'un SVG piégé (script retiré) → convention de couleurs → composant publié → nouvel habitant → coiffure, bas importé, couleur du haut → brouillon → rechargement → tenue (variante) → vue en situation → publication → placement → export avec dépendances → réimport et rendu dans l'autre environnement. Mobile (390 × 844, tactile) : menu, catalogue, atelier de personnages sans défilement horizontal, validation, carte. Captures dans `frontend/e2e/screenshots/`.

## 3. Architecture

```
frontend (Vite + TypeScript + Phaser 3)                backend (FastAPI + Pydantic + SQLite)
┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ main.ts        navigation, routage        │          │ main.py       API, permissions, en-têtes │
│ views/         20 sections (ateliers,     │  HTTPS   │ service.py    cycle de vie, versions,    │
│                catalogue, carte, import…) │  JSON    │               scènes, médias, utilisateurs│
│ forms.ts       formulaires déclaratifs    │ ───────► │ validation.py règles par famille         │
│ character/     compositeur SVG pur,       │          │ placement.py  règles par couche          │
│                compatibilités, générateur │          │ svgsafe.py    assainissement SVG         │
│ render/        moteur isométrique         │          │ media.py      stockage par empreinte     │
│ interior.ts    circulation (pur)          │          │ bundle.py     import / export            │
└──────────────────────────────────────────┘          │ runtime.py    intégration jeu            │
                                                      │ taxonomy.py   familles, registres        │
                                                      │ behaviors.py  comportements déclaratifs  │
                                                      │ db.py         migrations numérotées      │
                                                      └──────────────────────────────────────────┘
```

Séparation stricte des quatre notions :

| Notion | Où | Qui la définit |
|---|---|---|
| **Famille technique** (bâtiment, intérieur, route, surface, objet, meuble, véhicule, personnage, composant) | `taxonomy.FAMILIES`, `models.FAMILY_PROPS`, `validation.py`, `render/iso.ts` | le code (capacité du moteur) |
| **Catégorie métier** (Santé, Maquis, Taxi, Habitants…) | table `categories` | l'administration (Paramètres du projet), sans code |
| **Définition d'asset** | table `asset_versions` (JSON validé, une ligne par version, dépendances figées à la publication) | l'administration |
| **Instance placée** | table `instances` (`asset_id` stable + `version` explicite + scène + position) | la carte de test |

Données : `assets`, `asset_versions` (définition, statut, rapport, `pins` = versions et révisions exactes des dépendances au moment de la publication), `instances` (avec `scene_id`), `scenes`, `categories`, `media` / `media_revisions` (métadonnées ; fichiers sur disque), `imports`, `users`, `sessions`, `audit`, `settings`. Le schéma évolue par **migrations numérotées** (`db.MIGRATIONS`, `PRAGMA user_version`) ; une base du prototype v0.1 est reprise sans perte (test `test_migration_from_prototype_v01_database`).

Cycle de vie : `draft → in_review → validated → published → superseded`, archivage porté par l'asset. Une version publiée est figée ; la modifier crée une nouvelle version. Le **retour à une version** copie l'ancienne définition dans un nouveau brouillon (jamais d'écrasement). Les instances gardent leur version jusqu'à une **migration explicite**.

## 4. Faire sans code (résumé — détails dans le guide)

- **Un bâtiment, un véhicule, un arbre, un étal, un meuble ou un sol assemblé** : *Ateliers modulaires → kit → Nouvel élément* ; chaque partie se change seule (base, toiture, porte, roues, feuillage, coussins…), couleurs partagées, motifs, variantes, configuration JSON ; rue de test à 96 / 40 px, combinaisons possibles et tests de la bibliothèque sur la page du kit. Nouveau composant : *Composants modulaires → Importer un composant SVG*.
- **Un personnage** : *Personnages → Nouvel habitant* ; choisir silhouette, peau, coiffure, visage, vêtements, motifs, accessoires (seules les options présentes dans la bibliothèque sont proposées, les incompatibilités sont signalées) ; *Nouvelle tenue* pour une variante ; enregistrer, soumettre, publier. Nouveau composant : *Composants de personnage → Importer un composant SVG*.
- **Un bâtiment** : *Créer un élément → Bâtiment → catégorie* ; dimensions, couleurs, toiture ; puis l'éditeur pour les entrées, intérieurs associés, comportements ; la façade se compose module par module (*Atelier d'assemblage*).
- **Un intérieur** : *Créer un élément → Intérieur* ; dans l'éditeur, outils de clic : dessiner une pièce, porte, meuble (y compris ceux créés dans l'atelier), déplacer/pivoter un meuble, point d'apparition, zone interdite ; calque « Circulation ».
- **Une variante** : section *Variantes et thèmes* de l'éditeur (couleurs, enseigne, toiture, motif…) ; comparaison côte à côte ; variante par défaut.
- **Un lot d'assets** : *Importation et exportation* → cocher, exporter (zip) ; dans l'autre environnement, importer, vérifier l'aperçu, choisir les décisions de conflit, appliquer ; annulable.
- **Une nouvelle catégorie** : *Paramètres du projet → Nouvelle catégorie* (famille existante, sous-catégories, règles métier).

## 5. Limites réelles

Voir [docs/FAMILLES.md](docs/FAMILLES.md) et [docs/AUDIT.md](docs/AUDIT.md). En bref : personnages en vue de face, sans animation ; véhicules immobiles ; rendu procédural (sprites importés en une seule vue) ; pas d'import 3D (aucun rendu 3D) ; SQLite et un seul processus ; le jeu Three.js actuel n'exploite qu'une partie du contenu, via un adaptateur avec pertes.
