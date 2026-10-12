# BabiVerse — Cité Akwaba

Simulateur de vie et d'entrepreneuriat dans un quartier fictif d'Abidjan, jouable dans le navigateur mobile.

Le joueur incarne un habitant de la Cité Akwaba. Il explore la rue, entre chez lui et à l'épicerie, parle aux voisins, mange, fait la sieste, livre des colis pour M. Diabaté, puis ouvre son kiosque à boissons et sert ses clients. Tout se passe dans le monde, pas dans des menus.

- **Client** : Vite + Three.js (3D low-poly, caméra orbitale : pivoter, zoomer, naviguer), interface DOM superposée, PWA.
- **Serveur** : Django + Django REST Framework, qui fait autorité sur l'économie, le temps et les missions.
- **Base** : PostgreSQL (tests réels) ou SQLite (prototype local).

## Démarrage rapide (poste de développement)

Prérequis : Python 3.12+ et Node 20+.

```bash
# 1. Backend (port 8010)
cd backend
python -m venv .venv && .venv/Scripts/activate   # Linux/macOS : source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # obligatoire : DEBUG est désactivé par défaut (DJANGO_DEBUG=1 dans ce fichier)
python manage.py migrate
python manage.py runserver 127.0.0.1:8010

# 2. Client (port 5173, proxifie /api vers :8010)
cd client
npm install
npm run dev
```

Ouvrir <http://localhost:5173> et créer un compte : nom d'utilisateur et mot de passe pour se connecter, e-mail facultatif (sert à récupérer le compte, une fois confirmé). En local sans `RESEND_API_KEY`, les e-mails (confirmation, mot de passe oublié) s'affichent dans la console du backend. Pour tester sur un téléphone du même réseau Wi-Fi, ouvrir `http://<ip-du-pc>:5173` (Vite écoute sur toutes les interfaces).

**Contenu de l'atelier d'assets** (garde-robe de création, habitants à la place des PNJ, intérieur « Chez moi ») : démarrer l'atelier (`babiverse-asset-studio-admin/babiverse-studio`, port 8000) ; en DEBUG, le backend le lit tout seul sur `http://127.0.0.1:8000` avec la clé `babiverse-dev` (`ATELIER_URL`, `ATELIER_KEY`). Les choix se font dans l'atelier, page **Intégration au jeu** ; seuls les éléments publiés passent dans le jeu. En production : `python manage.py sync_atelier --url … --key …` écrit `shared/atelier/game-pack.json`, lu quand l'atelier n'est pas joignable. Sans atelier ni fichier, le jeu garde son contenu d'origine. Voir [ADR 0008](docs/decisions/0008-contenu-de-l-atelier-dans-le-jeu.md). Pour **placer des bâtiments, objets, véhicules ou surfaces publiés dans la ville**, page **Carte du jeu** de l'atelier : tracer une zone sur la carte, choisir l'élément, « Placer ici » ; il apparaît dans le jeu au prochain chargement de la ville ([ADR 0009](docs/decisions/0009-carte-du-jeu-et-placements.md)). L'atelier embarque le générateur de la ville du jeu : le reconstruire (`npm run build` dans son `frontend/`) après un changement de la ville.

Commandes :

| | Mobile | Ordinateur |
|---|---|---|
| Se déplacer | joystick (bas gauche) ; dans un logement, **toucher le sol** | ZQSD / WASD / flèches ; dans un logement, **clic sur le sol** |
| Consulter un objet (bâtiment, parcelle, panneau, meuble, PNJ) | toucher bref : sa fiche s'ouvre, **sans déplacement** | clic |
| Interagir | bouton ✋ à proximité, ou action de la fiche (« Y aller : … » si l'objet est loin) | **E**, Espace, Entrée, ou action de la fiche |
| Naviguer dans la ville | glisser un doigt | glisser (clic gauche), ou défilement horizontal du pavé tactile |
| Zoomer | pincer à deux doigts, ou ＋ / － | molette, pincement du pavé tactile, ou ＋ / － |
| Pivoter | tourner à deux doigts, ou ⟲ / ⟳ | clic droit glissé (vertical : inclinaison) |
| Fermer une fiche | ✕, « Fermer », ou toucher le monde | idem, ou Échap |
| Revenir au personnage | « 📍 Revenir à mon personnage » ou boussole | idem |
| Changer de vue | menu du bas : 🏠 Chez moi, 🗺️ Ville (vue d'ensemble ; second appui : retour au personnage), 🎯 Opportunités, 👤 Mon profil | idem |

Dans la ville, un clic ne fait jamais marcher le personnage : il ouvre la fiche de l'objet visé. Un geste qui dépasse le seuil de glissement (6 px à la souris, 12 px au doigt, voir `client/src/world/pointer.js`) déplace la caméra et ne sélectionne rien.

### PostgreSQL

Recommandé dès la bêta : SQLite verrouille toute la base à chaque écriture, PostgreSQL seulement la ligne du personnage.

Avec Docker : `docker compose up -d` (PostgreSQL 17 et Redis 7, voir `docker-compose.yml`). Sans Docker, avec un PostgreSQL installé (`psql -U postgres`) :

```sql
CREATE USER babiverse WITH PASSWORD 'babiverse' CREATEDB;   -- CREATEDB : les tests créent leur propre base
CREATE DATABASE babiverse OWNER babiverse;
```

```bash
# backend/.env (voir backend/.env.example)
DATABASE_URL=postgres://babiverse:babiverse@localhost:5432/babiverse
# REDIS_URL=redis://localhost:6379/0   # facultatif en local
```

Puis `python manage.py migrate`. Sans `DATABASE_URL`, le serveur utilise `backend/db.sqlite3`. Base managée (Neon, Supabase, Scaleway…) : ajouter `?sslmode=require` à l'URL.

Reprendre les données d'une base SQLite existante (à faire sur une base PostgreSQL neuve, juste migrée ; sous Windows, `PYTHONUTF8=1` est nécessaire pour que l'export soit en UTF-8) :

```bash
cd backend
PYTHONUTF8=1 DATABASE_URL=sqlite:///db.sqlite3 python manage.py dumpdata --natural-foreign --exclude contenttypes --exclude auth.permission --exclude admin.logentry --exclude sessions -o dump.json
python manage.py migrate && python manage.py loaddata dump.json && python manage.py sqlsequencereset game auth | python manage.py dbshell
```

## Tests

```bash
cd backend && python manage.py test game     # 117 tests (SQLite ou PostgreSQL selon DATABASE_URL) : comptes (e-mail confirmé, sessions, Resend), économie, temps, missions, parcelles, maisons initiales, publicités, idempotence, concurrence, isolation
cd client  && npm test                       # 111 tests : ville, lotissement, cartes, collisions, ligne de vue, interactions, sélection, gestes, publicités, chemins, caméra, besoins
```

Tests de bout en bout dans Chrome, avec émulation mobile 360×740, tactile et CPU ralenti ×4. Ils exigent backend et client démarrés :

```bash
# Base vierge recommandée pour l'E2E
cd backend && DATABASE_URL=sqlite:///e2e.sqlite3 python manage.py migrate && DATABASE_URL=sqlite:///e2e.sqlite3 python manage.py runserver 127.0.0.1:8010
cd client  && npm run dev
cd client  && npm run e2e                    # ou : node e2e/run.mjs tranche | economie | parcelles | interactions | compte | social
```

Le scénario `compte` suit aussi les liens reçus par e-mail si la sortie du backend (sans `RESEND_API_KEY`) est redirigée vers un fichier passé dans `E2E_MAIL_LOG` (par exemple `python manage.py runserver 127.0.0.1:8010 > mails.log 2>&1` puis `E2E_MAIL_LOG=../backend/mails.log npm run e2e`).

`CHROME_PATH` permet d'indiquer un autre navigateur Chromium, et `BASE_URL` un autre client (par exemple un Vite lancé avec `API_URL=http://127.0.0.1:8020 npx vite --port 5183` pour ne pas toucher à la base de développement). Les captures sont enregistrées dans `client/e2e/screenshots/`.

## Structure

```
backend/
  config/            réglages Django (DATABASE_URL, .env, journalisation)
  game/rules.py      TOUTES les règles d'équilibrage (prix, salaires, besoins, missions…)
  game/models.py     Player, Character, inventaire, journal, idempotence, missions, services, kiosque
  game/services/     systèmes de simulation (core, life, work, business, missions, state)
  game/views.py      API : verrou, idempotence, point de sauvegarde, instantané d'état
  game/tests/        tests unitaires et d'intégration
client/
  src/world/         données et logique pures : cartes, collisions, interactions, PNJ
  src/engine3d/      Three.js : monde 3D, caméra orbitale et gestes, modèles, PNJ, joystick
  src/game/          actions de jeu (monde ↔ serveur ↔ interface)
  src/net/           client HTTP (jeton, idempotence, reprises, hors-ligne)
  src/ui/            HUD, invites, panneaux, écrans
  e2e/               scénarios navigateur
shared/city.json     parcelles, supports publicitaires, bâtiments constructibles, prix (lu par le serveur ET le client)
shared/ads.json      annonces de démonstration (fictives) et affectation des emplacements publicitaires
docs/                architecture, game design, monde, économie, feuille de route, décisions
```

## Déploiement (petit groupe de testeurs)

1. **Serveur** : une VM Linux (1 vCPU / 1 Go suffisent pour quelques dizaines de testeurs), PostgreSQL 15+ et Python 3.12+.
2. **Backend** : déployer `backend/` **et `shared/`** (le serveur lit `shared/city.json`), puis `pip install -r requirements.txt gunicorn` et définir les variables d'environnement :
   - `DJANGO_DEBUG=0` ;
   - `DJANGO_SECRET_KEY=<long aléatoire>` ;
   - `DJANGO_ALLOWED_HOSTS=jeu.exemple.ci` ;
   - `DATABASE_URL=postgres://…` ;
   - **e-mails par [Resend](https://resend.com/docs/send-with-python)** (confirmation d'adresse, mot de passe oublié, alertes de sécurité) : `RESEND_API_KEY=re_…` (**obligatoire** : sans clé, le serveur refuse de démarrer en production), `DEFAULT_FROM_EMAIL=BabiVerse <no-reply@jeu.exemple.ci>` sur un domaine vérifié dans Resend, `PUBLIC_URL=https://jeu.exemple.ci` (adresse des liens) ; tester l'envoi avant d'ouvrir aux testeurs ;
   - `REDIS_URL=redis://…` dès qu'il y a plusieurs workers gunicorn : sans Redis, chaque processus a ses propres compteurs de limitation de débit (limites multipliées par le nombre de workers) ;
   - `NUM_PROXIES=1` derrière un proxy (Caddy/Nginx) : la limite par IP des routes de compte utilise alors la vraie adresse du client et non un `X-Forwarded-For` falsifiable ;
   - appels vocaux entre joueurs (WebRTC) : `WEBRTC_ICE_SERVERS` en JSON (défaut : STUN public de Google). Pour les réseaux mobiles stricts, ajouter un relais TURN, par exemple `[{"urls": "stun:stun.l.google.com:19302"}, {"urls": "turn:turn.exemple.ci:3478", "username": "…", "credential": "…"}]`. Les appels exigent HTTPS (micro) ;
   - facultatif : `SECURE_HSTS_SECONDS` (défaut 86400, à allonger une fois HTTPS validé), `SECURE_SSL_REDIRECT=0` seulement si le proxy redirige déjà.

   Sans `DJANGO_DEBUG=1`, DEBUG est désactivé et la clé secrète est exigée (le serveur refuse de démarrer sinon). Vérifier avec `python manage.py check --deploy`.

   Lancer ensuite `python manage.py migrate`, `python manage.py collectstatic`, puis `gunicorn config.wsgi -b 127.0.0.1:8010 -w 3`.
3. **Client** : `npm ci && npm run build`, puis servir `client/dist/` en statique.
4. **Proxy HTTPS** (Caddy ou Nginx) : `/` vers `client/dist`, `/api/` et `/admin/` vers `127.0.0.1:8010`. HTTPS est nécessaire pour le service worker et l'installation en PWA.

Exemple Caddy :

```
jeu.exemple.ci {
  handle /api/* { reverse_proxy 127.0.0.1:8010 }
  handle /admin/* { reverse_proxy 127.0.0.1:8010 }
  handle /static/* { root * /srv/babiverse/backend/staticfiles; uri strip_prefix /static; file_server }
  handle { root * /srv/babiverse/client/dist; try_files {path} /index.html; file_server }
}
```

Tâche quotidienne (cron) : `python manage.py purge_comptes` supprime les sessions expirées et les liens périmés.

Un compte administrateur (`python manage.py createsuperuser`) donne accès à `/admin/` pour suivre joueurs, journaux et missions.

## Documentation

- [docs/architecture.md](docs/architecture.md) : modules, flux d'une action, autorité serveur
- [docs/game-design.md](docs/game-design.md) : boucle de jeu, profils, besoins, missions
- [docs/world-design.md](docs/world-design.md) : zones, collisions, interactions, PNJ
- [docs/economy.md](docs/economy.md) : monnaie, prix, revenus, plafonds, idempotence
- [docs/roadmap.md](docs/roadmap.md) : phases, état d'avancement, limites connues
- [docs/decisions/](docs/decisions/) : décisions techniques structurantes

La monnaie du jeu est **strictement virtuelle**. Aucune conversion en argent réel, aucun paiement, aucune blockchain.
