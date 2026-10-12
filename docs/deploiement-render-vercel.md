# Déploiement : fronts sur Vercel, backends et base sur Render

```
navigateur ──► Vercel « babiverse »          (client/)                      /api/* ──► Render babiverse-api          ──► babi_verse_db
navigateur ──► Vercel « babiverse-atelier »  (atelier frontend/)            /api/* ──► Render babiverse-atelier-api  ──► babiverse_studio
                                                                 Render babiverse-api ── pack de jeu (HTTPS) ──► babiverse-atelier-api
```

- Chaque front appelle **son propre domaine** en `/api/…` ; Vercel relaie vers Render (`rewrites` des `vercel.json`). Le navigateur ne voit qu'une origine : pas de CORS, cookies et service worker inchangés.
- Une seule instance PostgreSQL Render (gratuite) contient deux bases : `babi_verse_db` (jeu) et `babiverse_studio` (atelier, créée par `CREATE DATABASE babiverse_studio TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`).
- Fichiers à jour dans le dépôt : [`render.yaml`](../render.yaml) (Blueprint des deux services), [`client/vercel.json`](../client/vercel.json), [`babiverse-asset-studio-admin/babiverse-studio/frontend/vercel.json`](../babiverse-asset-studio-admin/babiverse-studio/frontend/vercel.json).

## Limites du plan gratuit

| Point | Effet | Parade en place |
|---|---|---|
| Service endormi après 15 min sans requête | première requête ≈ 50 s | aucune (passer en Starter pour l'éviter) |
| Disque effacé à chaque redémarrage | fichiers de l'atelier perdus | `BABIVERSE_MEDIA_STORAGE=database` : SVG et images dans la table `media_blobs` |
| 750 h d'instance par mois pour tout le compte | deux services toujours réveillés dépasseraient | ils s'endorment quand personne ne joue ; le jeu n'interroge l'atelier que toutes les 60 s |
| Base gratuite supprimée 30 jours après sa création | perte des données | sauvegarder (`pg_dump`) et passer la base en payant avant l'échéance |
| Pas de commande « pre-deploy » | — | `migrate` lancé au démarrage du jeu |
| Lot d'import de l'atelier gardé sur disque entre l'aperçu et l'application | perdu si le service redémarre entre les deux | refaire l'aperçu |

## 1. Render : les deux backends

1. Pousser le dépôt sur GitHub (`render.yaml` à la racine).
2. Render > **New > Blueprint** > choisir le dépôt. Render lit `render.yaml` et crée `babiverse-api` et `babiverse-atelier-api` (Oregon, comme la base).
3. Renseigner les valeurs demandées (« sync: false ») :
   | Service | Variable | Valeur |
   |---|---|---|
   | babiverse-api | `DATABASE_URL` | *Internal Database URL* de l'instance, base `babi_verse_db` |
   | babiverse-api | `PUBLIC_URL` | adresse Vercel du jeu (étape 2), ex. `https://babiverse.vercel.app` |
   | babiverse-api | `RESEND_API_KEY` | clé Resend (obligatoire, sinon le serveur refuse de démarrer) |
   | babiverse-atelier-api | `BABIVERSE_DATABASE_URL` | même URL interne en remplaçant `/babi_verse_db` par `/babiverse_studio` |
   | babiverse-atelier-api | `BABIVERSE_ADMIN_USER`, `BABIVERSE_ADMIN_PASSWORD` | compte administrateur de l'atelier (mot de passe ≥ 12 caractères) |
   Générées automatiquement : `DJANGO_SECRET_KEY`, `BABIVERSE_SECRET`, `BABIVERSE_GAME_KEY` (recopiée dans `ATELIER_KEY` du jeu).
4. Noter les adresses publiques attribuées. Si elles ne sont pas exactement `https://babiverse-api.onrender.com` et `https://babiverse-atelier-api.onrender.com` (nom déjà pris), corriger `ATELIER_URL` dans Render et les deux `vercel.json`, puis pousser.
5. Vérifier : `https://babiverse-atelier-api.onrender.com/api/health` répond `{"ok": true…}` ; l'atelier crée son schéma et sa bibliothèque au premier démarrage (1 à 2 min) ; `https://babiverse-api.onrender.com/admin/` affiche la connexion Django.
6. Compte administrateur Django (facultatif) : Render > babiverse-api > **Shell** > `python manage.py createsuperuser`.

## 2. Vercel : les deux fronts

Deux projets Vercel, depuis le même dépôt (**Add New > Project**, importer le dépôt deux fois) :

| Projet | Root Directory | Framework | Réglages |
|---|---|---|---|
| babiverse (jeu) | `client` | Vite | lus dans `client/vercel.json` |
| babiverse-atelier | `babiverse-asset-studio-admin/babiverse-studio/frontend` | Vite | lus dans son `vercel.json` ; laisser cochée l'option *Include files outside the Root Directory* (l'atelier importe `client/src/world` et `shared/`) |

Aucune variable d'environnement n'est nécessaire côté Vercel. Après le premier déploiement, reporter l'adresse du jeu dans `PUBLIC_URL` (Render, babiverse-api).

Le `vercel.json` et le dossier `api/` à la racine du dépôt (Django en fonctions serverless) ne servent plus : ils sont ignorés tant que les projets Vercel ont la *Root Directory* ci-dessus.

## 3. Reprendre le contenu local de l'atelier (facultatif)

Sinon l'atelier de production démarre avec la bibliothèque de départ. Base cible **vide** (avant le premier démarrage du service, ou après l'avoir vidée) ; URL **externe** de la base, avec `?sslmode=require` :

```bash
cd babiverse-asset-studio-admin/babiverse-studio/backend
.venv/Scripts/python -m app.copy_to_postgres babiverse.db "postgresql://…render.com/babiverse_studio?sslmode=require"   # depuis SQLite
.venv/Scripts/python -m app.media_to_db "postgresql://…render.com/babiverse_studio?sslmode=require" media               # fichiers → base
```

Depuis la base PostgreSQL locale : `pg_dump --no-owner --no-acl <URL locale> | psql "<URL Render>"`, puis `media_to_db` comme ci-dessus. En production, les comptes de développement (mot de passe = identifiant) sont désactivés au démarrage et l'administrateur `BABIVERSE_ADMIN_USER` est créé.

## 4. Après le déploiement

- **Limitation de débit** : derrière Vercel puis Render, la vraie IP du joueur est dans `X-Forwarded-For` ; `NUM_PROXIES` reste vide (DRF identifie alors le client par tout l'en-tête). À régler après avoir observé l'en-tête reçu.
- **E-mails** : vérifier un domaine dans Resend et mettre `DEFAULT_FROM_EMAIL` sur ce domaine (`onboarding@resend.dev` ne livre qu'au propriétaire du compte Resend).
- **Tâche quotidienne** `python manage.py purge_comptes` : pas de cron gratuit sur Render ; à lancer à la main dans le Shell, ou via un *Cron Job* payant.
- **Sauvegardes** : `pg_dump -Fc "<URL externe>/babi_verse_db?sslmode=require" -f jeu.dump` (et `babiverse_studio`).
