# Environnement de test et déploiement sécurisé

## 1. Variables d'environnement

Tous les réglages sensibles viennent de l'environnement (`backend/app/config.py`) ; aucun secret n'est dans le code.

| Variable | Rôle | Défaut |
|---|---|---|
| `BABIVERSE_ENV` | `development`, `test` ou `production` | `development` |
| `BABIVERSE_DATABASE_URL` | base **PostgreSQL** (`postgres://rôle:mdp@hôte:5432/base`, ajouter `?sslmode=require` pour une base managée) ; prioritaire sur `BABIVERSE_DB`. Lue aussi dans `backend/.env` | — |
| `BABIVERSE_DB` | chemin de la base SQLite (repli sans `BABIVERSE_DATABASE_URL`) | `backend/babiverse.db` |
| `BABIVERSE_MEDIA_DIR` | dossier des fichiers importés | dossier `media/` à côté de la base SQLite, `backend/media` avec PostgreSQL |
| `BABIVERSE_MEDIA_STORAGE` | `disk` (fichiers dans `BABIVERSE_MEDIA_DIR`) ou `database` (table `media_blobs` : hébergeur sans disque persistant, comme Render gratuit) ; `python -m app.media_to_db` y verse des fichiers existants | `disk` |
| `BABIVERSE_SECRET` | clé de signature des liens de fichiers (≥ 32 caractères aléatoires) | générée et conservée en base (hors production) |
| `BABIVERSE_ADMIN_USER`, `BABIVERSE_ADMIN_PASSWORD` | administrateur créé au premier démarrage en production (mot de passe ≥ 12 caractères) | — |
| `BABIVERSE_MAX_UPLOAD_MB` | taille maximale d'un fichier | 5 |
| `BABIVERSE_MAX_IMPORT_MB` | taille maximale d'un lot zip | 50 |
| `BABIVERSE_MAX_IMAGE_PX` | côté maximal d'une image | 4096 |
| `BABIVERSE_SESSION_HOURS` / `BABIVERSE_SESSION_IDLE_MIN` | durée maximale d'une session / expiration après inactivité | 12 / 120 |
| `BABIVERSE_PBKDF2_ITERATIONS` | coût du hachage des mots de passe (ne pas baisser en production) | 200 000 |
| `BABIVERSE_FRONTEND` | dossier du frontend compilé servi par le backend | `frontend/dist` |

En `production`, le serveur **refuse de démarrer** si `BABIVERSE_SECRET`, `BABIVERSE_ADMIN_USER` ou `BABIVERSE_ADMIN_PASSWORD` manquent, et **aucun compte de développement** n'est créé (test `test_production_refuses_missing_secrets`). La documentation interactive de l'API (`/api/docs`) est désactivée.

## 2. Environnement de test

Un environnement de test est une base et un dossier de fichiers séparés ; il ne partage rien avec un autre environnement.

```bash
cd backend
BABIVERSE_ENV=test BABIVERSE_DB=/srv/studio-test/studio.db BABIVERSE_MEDIA_DIR=/srv/studio-test/media \
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

Le contenu se transfère d'un environnement à l'autre par **Importation et exportation** (lot zip), jamais en copiant les bases. Les tests automatisés créent chacun leur base temporaire ; les tests de bout en bout lancent deux serveurs (`frontend/e2e/run.mjs`) avec des bases et dossiers temporaires.

## 3. Déploiement sécurisé

```bash
cd frontend && npm ci && npm run build
cd ../backend && pip install -r requirements.txt
export BABIVERSE_ENV=production
export BABIVERSE_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"   # à conserver dans le gestionnaire de secrets
export BABIVERSE_ADMIN_USER=chef-contenu
export BABIVERSE_ADMIN_PASSWORD='…'          # ≥ 12 caractères, à changer après la première connexion
export BABIVERSE_DATABASE_URL='postgres://studio:…@db.exemple:5432/babiverse_studio?sslmode=require'
export BABIVERSE_MEDIA_DIR=/var/lib/babiverse-studio/media
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1
```

- **PostgreSQL** recommandé en production (base créée avec `ENCODING 'UTF8' LOCALE 'C'` pour garder l'ordre de tri de SQLite) ; le schéma est créé au premier démarrage. Une base SQLite existante se reprend par `python -m app.copy_to_postgres [chemin.db] [URL]` (cible vide, effectifs vérifiés).
- **Un seul processus** (`--workers 1`) : les écritures sont sérialisées par un verrou en mémoire sur une connexion unique. Pour plusieurs processus, il faudra un pool de connexions et retirer ces verrous.
- Placer un **proxy HTTPS** devant (Caddy, nginx) ; ne jamais exposer uvicorn directement. Limiter la taille des requêtes au proxy (`client_max_body_size 60m` pour les lots).
- Le backend envoie `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy` et une **Content-Security-Policy** stricte pour l'interface ; les fichiers sont servis avec `Content-Security-Policy: default-src 'none'; sandbox` et des liens signés.
- Le dossier des médias ne doit pas être servi directement par le proxy : les fichiers passent par l'API (signature, en-têtes).
- Comptes : créer les comptes nominatifs dans *Utilisateurs et permissions* (mots de passe ≥ 10 caractères mêlant majuscules, minuscules et chiffres), puis changer le mot de passe initial de l'administrateur. Cinq échecs de connexion bloquent l'identifiant 5 minutes.
- Le journal d'audit (*Versions et historique*) trace créations, modifications, publications, imports, exports, placements, gestion des fichiers, des catégories et des utilisateurs, et les connexions.

Hébergement Vercel (interface) + Render (API, base) : voir [le guide du dépôt](../../../docs/deploiement-render-vercel.md) et `frontend/vercel.json`.

## 4. Sauvegardes et restauration

À sauvegarder ensemble : la base (`BABIVERSE_DB`) et le dossier des médias (`BABIVERSE_MEDIA_DIR`) ; les fichiers étant adressés par empreinte, une sauvegarde incrémentale suffit.

```bash
# PostgreSQL
pg_dump -Fc "$BABIVERSE_DATABASE_URL" -f "/sauvegardes/studio-$(date +%F).dump"
# SQLite : base cohérente même pendant l'utilisation (API de sauvegarde)
sqlite3 "$BABIVERSE_DB" ".backup '/sauvegardes/studio-$(date +%F).db'"
rsync -a "$BABIVERSE_MEDIA_DIR/" /sauvegardes/media/
```

Restauration : arrêter le service, remettre la base (`pg_restore -d <base vide> fichier.dump`, ou le fichier SQLite) et le dossier des médias, redémarrer ; les migrations manquantes s'appliquent au démarrage (table `schema_version` sous PostgreSQL, `PRAGMA user_version` sous SQLite). En complément, un **export « tout le catalogue »** régulier (lot zip) constitue une sauvegarde portable, réimportable dans un environnement neuf.

## 5. Mise à jour

Les migrations de schéma sont explicites et numérotées (`backend/app/db.py`, `MIGRATIONS`) ; elles n'effacent jamais de données et sont testées à partir d'une base du prototype v0.1. Toujours sauvegarder avant une mise à jour.
