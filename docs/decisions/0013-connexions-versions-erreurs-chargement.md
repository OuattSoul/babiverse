# ADR 0013 — Monde multi-villes : connexions, versions, permissions, erreurs, chargement

Statut : accepté (2026-10-13). Suite du parcours vertical (ADR 0012) ; termine les fonctions restantes du prompt maître.

## Décision

1. **Connexions entre cartes.** Une connexion est une porte (`door`) d'une carte vers une autre, ou l'accès d'une carte
   depuis la Cité Akwaba. Chaque carte peut déclarer des **points d'arrivée nommés** (`arrivals`) ; la publication vérifie
   que la destination est publiée et que son point d'arrivée existe (`worldmaps.allowed_spawns`). Une porte peut porter
   un **mode** (`walk`, `transport` : gbaka, taxi, préparation des trajets entre communes et villes) et des **conditions**
   (`mission_completed`, `min_balance` ; registre fermé, aucun code). Le client explique un passage fermé
   (`world/conditions.js`) ; **le serveur du jeu décide** : `maps.entry_allowed` n'accepte l'arrivée sur une carte de
   l'atelier que depuis la Cité Akwaba (si la carte y a un accès) ou par une porte active d'une autre carte dont les
   conditions sont remplies ; sinon la position est ignorée. Aucun prélèvement : un passage payant demanderait une
   action économique dédiée. Graphe des connexions : `GET /api/game/connections`, affiché dans « Villes et cartes ».
2. **Versions et restauration.** Consulter une version (`GET …/versions/{n}`), la reprendre dans le brouillon
   (`POST …/restore`, `world.manage`, rien n'est publié), aperçu de ce que la publication changerait (`changes`),
   révision plus récente d'un fichier signalée et adoptée explicitement (`newer_revisions`), cartes utilisant un fichier
   dans la médiathèque (`map_usage`).
3. **Permissions.** Matrice testée sur toutes les routes du monde (administrateur, publieur, éditeur, lecteur, joueur,
   sans session) ; actions tracées dans le journal d'audit (`world.*`) ; côté jeu, aucune route d'écriture du monde, routes
   du contenu de l'atelier en lecture seule, identifiants de fichiers filtrés ; textes de l'atelier affichés comme texte.
4. **Erreurs.** Zone introuvable au chargement → Cité Akwaba au point de départ avec un message (`resolveZoneRequest`) ;
   porte vers une carte indisponible → message, pas de changement de zone ; modèle trop long à charger (30 s) → volume
   rouge, nouvel essai à la prochaine entrée ; fichier momentanément indisponible côté serveur → **503** `Retry-After`
   (et non 404) ; carte malformée dans le pack → ignorée. **Ordre des positions** : chaque requête portant `pos` est
   horodatée par l'onglet (`pos.t`, `pos.c`, `net/api.stampPos`) et le serveur ignore une position plus ancienne que la
   dernière appliquée pour le même onglet (`state._in_order`, cache Django) : un battement de cœur ou une interrogation
   des rencontres partis avant un changement de zone ne ramènent plus le joueur en arrière (défaut révélé par l'E2E).
5. **Chargement.** File de téléchargement des modèles (2 à la fois, les plus proches du joueur d'abord) ; préchargement
   discret, dans le cache HTTP seulement, des modèles des cartes voisines (budget 6 Mo, coupé en économie de données ou
   en 2G) ; mesures `window.__babi.perf()` (appels de dessin, triangles, géométries, textures, temps par modèle) ; poids
   d'une carte dans l'atelier (octets distincts, triangles, fichiers) avec avertissement au-delà du budget mobile
   (8 Mo, 300 000 triangles, 12 fichiers), sans bloquer la publication.

## Conséquences

- Un joueur ne peut plus « sauter » d'une carte de l'atelier à une autre en envoyant une position : le serveur vérifie le
  passage. Le serveur ne vérifie toujours pas la géométrie fine (distance au panneau) : limite connue du jeu.
- Les missions utilisables en condition sont recopiées dans l'atelier (`worldmaps.GAME_MISSIONS`) ; un test du jeu
  vérifie que la liste est identique à `rules.MISSIONS`.
- L'ordre des positions repose sur le cache Django : avec plusieurs processus sans `REDIS_URL`, chaque processus a sa
  mémoire (protection partielle) ; un redémarrage l'efface (la position suivante est acceptée, comme avant).
