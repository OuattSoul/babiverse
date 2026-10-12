# ADR 0005 — Navigation, sélection des objets et emplacements publicitaires

Statut : accepté.

## Contexte

Un clic ou un toucher bref servait à tout : dans la ville comme dans le logement, il envoyait le personnage vers le point touché, ou jusqu'à l'élément le plus proche du point, puis déclenchait l'interaction. Ce comportement entrait en conflit avec la consultation des bâtiments, des parcelles et des panneaux : regarder une parcelle lointaine déclenchait une longue marche, et un glissement de caméra mal reconnu pouvait sélectionner un objet. Les panneaux publicitaires n'affichaient que du texte, sans image, sans description ni lien, et leur contenu était codé en dur dans le client.

## Décision

1. **Gestes classés en un seul endroit** (`world/pointer.js`, pur). Le seuil entre clic et glissement dépend du type de pointeur : 6 px à la souris, 8 px au stylet, 12 px au doigt. Un appui long (plus de 500 ms), un geste à deux doigts ou un clic droit ne sont jamais des clics. À la molette, le pincement du pavé tactile (`ctrlKey`) zoome et le défilement horizontal à deux doigts déplace la carte. `CameraRig` applique ces règles et ne transmet que les vrais clics (`onTap`).
2. **Modèle générique de sélection** (`world/selectables.js`, pur).
   - Catégories : `plot`, `building`, `shop`, `door`, `furniture`, `billboard`, `npc`, et `decor`, non sélectionnable.
   - Chaque objet sélectionnable est décrit par des **volumes** (boîtes) déduits des données de la zone, jamais par les maillages affichés. Le décor n'a pas de volume, donc il ne peut pas intercepter un clic destiné à un objet situé derrière lui.
   - Un bâtiment regroupe les éléments posés sur sa façade (porte, pancarte, point de livraison) : on le sélectionne en entier, et sa fiche liste leurs actions.
   - Le volume le plus proche le long du rayon l'emporte. Une petite priorité par catégorie départage un objet précis (porte, meuble) du grand volume qui le contient.
3. **Politique de navigation par zone** (`zone.navigation`) :
   - `camera` (ville) : glisser explore, et un clic sélectionne. Un clic ne fait **jamais** marcher : le personnage se déplace au joystick ou au clavier, ou par le bouton explicite « Y aller » d'une fiche.
   - `walk` (logement, épicerie) : un clic sur le sol fait marcher (A*), un clic sur un meuble ou une porte le sélectionne et n'en fait pas une destination.

   `resolveTap()` traduit (zone, objet visé, sol visé) en `select`, `walk` ou `none`.
4. **Fiches de sélection.**
   - `world/selection.js` décrit la fiche : titre, informations, faits, et actions issues du registre `interactionTypes.js`.
   - Une action est soit consultable à distance (`remote` : consulter, acheter une parcelle, louer un panneau), soit de proximité (entrer, se reposer, parler). Hors de portée, une action de proximité devient « Y aller : … », qui conduit le personnage puis l'exécute à l'arrivée.
   - L'invite de proximité (E / ✋) est conservée.
   - Ouvrir une fiche ne déplace ni le personnage ni la caméra. La fermer, par le bouton, Échap ou un clic dans le monde, rend la main.
5. **Parcelles.**
   - La fiche dépend de l'état de la parcelle : disponible (identifiant, prix, dimensions, catégorie, conditions, bouton « Acheter » si le joueur est éligible), occupée (propriétaire, bâtiment), indisponible (motif).
   - Sélectionner une parcelle n'envoie aucune requête. L'achat exige un clic sur « Acheter », puis une confirmation, puis la validation du serveur, qui refuse aussi une parcelle `status: "unavailable"`.
6. **Publicités : séparation support / annonce / affectation / statistiques.**
   - Le **support** est décrit dans `shared/city.json` (`ad_slots`) : position, orientation, type (`billboard` en bord de route, `totem` en zone commerciale) et dimensions du visuel.
   - Les **annonces** et leur **affectation** sont dans `shared/ads.json`. Statuts d'emplacement : `free`, `reserved`, `active`, `disabled`. Une annonce comprend annonceur, titre, description, image, URL et dates.
   - `resolveSlot()` (client) et `placement_refusal()` (serveur) appliquent la même règle. Une annonce absente, suspendue, expirée, programmée ou incomplète laisse le support vide : jamais de fiche d'annonce invalide. La campagne d'un joueur (`AdCampaign`) occupe un emplacement libre.
   - **Liens** : HTTPS uniquement, sans identifiants. Ils s'ouvrent dans un nouvel onglet (`noopener,noreferrer`). Images : fichier local du jeu ou HTTPS.
   - Le visuel est dessiné entier sur le panneau (ajusté sans recadrage), avec la mention « PUB ». La fiche montre l'image dans ses proportions d'origine, la mention « Publicité », le titre, la description, « En savoir plus » et « Fermer et revenir au jeu ».
   - **Statistiques** : `game/adTracking.js` garde en mémoire les ouvertures de fiche et les clics, sans envoi réseau. C'est le point d'intégration des futures campagnes.

## Conséquences

- Changer une annonce revient à modifier `shared/ads.json`, sans toucher à la géométrie ni reconstruire la scène. Ajouter un support revient à ajouter une ligne dans `ad_slots`.
- Dans la ville, aller quelque part au clic demande une action explicite (« Y aller »). Le joystick et le clavier restent le moyen principal de se déplacer.
- Les annonces de démonstration sont fictives et pointent vers `example.com` (domaine réservé aux exemples). Il n'y a ni vente d'espaces, ni paiement d'annonceurs, ni facturation.
- Tests : `client/tests/interactions.test.js` (rayons calculés avec une vraie caméra Three.js, y compris après zoom, déplacement et rotation), `backend/game/tests/test_plots.py` (parcelle indisponible, statuts d'emplacement) et le scénario de bout en bout `client/e2e/interactions.mjs` (tactile mobile, souris, pavé tactile simulé).
