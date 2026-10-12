# ADR 0002 — Backend Django + DRF, serveur faisant autorité, PostgreSQL

Statut : accepté (Phase 0).

## Contexte

Le dépôt v2 était vide. Un prototype v1 voisin (`../BabiVerse`) utilisait FastAPI avec SQLAlchemy asynchrone. L'économie doit être validée côté serveur, de façon atomique et idempotente. Le temps persistant doit dépendre de l'horloge serveur.

## Décision

- **Django 5.2+/6 + Django REST Framework**, base **PostgreSQL** pour le MVP de test et **SQLite** pour le prototype local (sélection par `DATABASE_URL`).
  - Migrations intégrées, admin pour inspecter joueurs, journal et missions, `transaction.atomic` et `select_for_update`, test runner intégré. Tout cela est déjà installé sur le poste de développement.
  - FastAPI (v1) n'est pas repris : son principal avantage, l'asynchrone, ne sert pas ici, et il faudrait réassembler migrations, admin et authentification.
- **Le serveur fait autorité** : le client n'envoie que des intentions (`acheter pain ×1`, `livrer colis X`) et sa zone et position. Le serveur recalcule tout : solde, stock, besoins, temps et récompenses.
- **Une ligne `Character` verrouillée par action** (`select_for_update`). Toutes les mutations d'un joueur sont ainsi sérialisées, ce qui empêche les doubles dépenses concurrentes.
- **Idempotence** : chaque action économique porte un en-tête `Idempotency-Key`. Le résultat est mémorisé dans `IdempotencyRecord` (unique par joueur et par clé). Un rejeu renvoie le même résultat sans effet. Une clé réutilisée pour une autre requête est refusée (409).
- **Point de sauvegarde par action** : un refus métier (`GameError`) annule toutes les écritures de l'action. Il n'y a jamais d'état partiellement validé.
- **Identité invitée** : jeton aléatoire, dont seul le hash SHA-256 est stocké. Ce jeton sert aussi de code de récupération. On pourra rattacher plus tard un compte (téléphone ou e-mail) au même `Player`.
- Pas de microservices, de files de messages ni de temps réel : un monolithe suffit pour le MVP.

## Conséquences

- Avec SQLite, `select_for_update` est sans effet. SQLite sérialise les écritures, donc la cohérence est préservée, mais les tests de concurrence réelle doivent tourner sur PostgreSQL (voir roadmap).
- La position et la zone envoyées par le client restent déclaratives. Le serveur vérifie la cohérence de zone (achat à l'épicerie, sieste à la maison), pas la géométrie fine. Les gains sont donc bornés par des règles serveur : durée minimale d'un service, plafond quotidien, intervalle entre ventes, stock.
