# Game design — MVP

## Fantasme du joueur

« Je m'installe à la Cité Akwaba avec presque rien. Je connais mes voisins, je gagne mes premiers francs en livrant des colis, puis j'ouvre mon propre kiosque au bord de la route. »

## Boucle principale

1. **Explorer** la rue, les commerces et les voisins.
2. **Repérer** les opportunités : les « ! » au-dessus des PNJ, les invites contextuelles, le suivi de mission sous le HUD.
3. **Répondre à ses besoins** : manger (épicerie, garba) et faire la sieste chez soi.
4. **Travailler** : un service de livraison pour M. Diabaté, avec 3 colis à porter à pied dans le quartier.
5. **Gagner** un salaire versé par le serveur à la fin du service.
6. **Acheter** de la nourriture et des casiers de boissons.
7. **Améliorer** sa situation : missions et récompenses.
8. **Entreprendre** : ouvrir le kiosque sur l'emplacement « À LOUER ».
9. **Réinvestir** : acheter des casiers, remplir le stock, servir les clients qui viennent au comptoir.
10. **Débloquer** de nouveaux objectifs, par exemple « Le client est roi » (10 ventes).

Toutes ces étapes se jouent en se déplaçant. Les panneaux (boutique, sac, journal, kiosque) s'ouvrent depuis une interaction dans le monde ou depuis le HUD, et se referment pour revenir à la rue.

## Profils de départ

| Profil | Capital | Objets | Effet |
|---|---|---|---|
| Étudiant | 4 000 F | 2 pains, cahier | — |
| Salarié | 8 000 F | 2 cafés Touba | — |
| Artisan | 5 000 F | caisse à outils | salaire ×1,25 (1 500 F/service) |
| Travailleur indépendant | 6 000 F | 4 sachets d'eau | salaire ×1,1 (1 320 F/service) |
| Entrepreneur débutant | 9 000 F | carnet de comptes | kiosque −20 % (9 600 F), débloqué dès le départ |

Apparence : 4 carnations, 6 couleurs de tenue, 4 coiffures. Tout est validé par liste blanche côté serveur.

## Besoins

- **Faim** (0 = rassasié, 100 = affamé) : +1,2 par minute de jeu actif.
- **Énergie** (100 = en forme) : −0,8 par minute de jeu actif.
- Valeurs de départ : faim 30, énergie 70. Les valeurs restent bornées entre 0 et 100.
- **Suspendus hors ligne** : au-delà de 120 s sans requête, le joueur est considéré absent et le temps ne compte plus pour ses besoins.
- Effets :
  - énergie < 20 ou faim > 85 : le travail est refusé, avec un message explicite ;
  - énergie < 15 : le personnage marche 30 % moins vite.

  Il n'y a ni mort ni perte d'argent : les pénalités restent douces.
- Récupération :
  - **sieste** dans son lit : +45 énergie, +4 faim, 90 s de récupération ;
  - **aliments** : pain −15, garba −45 faim et +5 énergie, café +12 énergie, etc.

## Emploi : livraisons

- On parle à M. Diabaté, devant le dépôt, puis on choisit « Commencer une livraison ».
- Le serveur tire 3 destinations parmi 4 : le maquis, l'épicerie, chez les Kouassi et chez Mme Bamba. Des flèches jaunes les signalent et un colis apparaît au-dessus du personnage.
- À chaque destination : « Livrer le colis ». Le serveur exige au moins 1,5 s entre deux livraisons.
- Retour chez M. Diabaté : « Terminer et être payé ». Le serveur vérifie que tous les colis sont livrés et que le service a duré au moins 30 s. Il verse alors 1 200 F (selon le profil), puis applique −15 énergie et +8 faim.
- Un service dure au plus 15 min. Au-delà, il expire sans paiement : il ne se termine jamais tout seul hors ligne.
- Plafond : 8 services par jour virtuel.

## Missions

États : **disponible** → (accepter) → **en cours** → **terminée** → (réclamer) → **récompensée**. La récompense est versée une seule fois, garantie par la transition d'état et la clé d'idempotence.

| Mission | Objectif | Récompense | Débloquée par |
|---|---|---|---|
| Bonjour le quartier | parler à Tonton Koffi | 300 F | départ (acceptée d'office) |
| Les premières courses | acheter à l'épicerie | 300 F | Bonjour |
| Ventre affamé… | manger | 200 F | Courses |
| Recharger les batteries | sieste | 200 F | Bonjour |
| Premier boulot | 1 service de livraison | 500 F | Bonjour |
| Petit à petit l'oiseau fait son nid | avoir 12 000 F | 800 F | Premier boulot |
| Mon propre business | ouvrir le kiosque | 1 000 F | Bonjour |
| Première vente | servir 1 client | 500 F | Kiosque (acceptée d'office) |
| Le client est roi | servir 10 clients | 1 500 F | Première vente |

Les missions s'acceptent auprès de leur PNJ (Koffi, Diabaté) ou dans le journal 📜. Une mission « disponible » ne progresse pas tant qu'elle n'est pas acceptée.

## Rythme visé

- Étudiant : environ 5 à 7 services et les missions de départ avant de pouvoir ouvrir le kiosque, soit 10 à 15 min de jeu.
- Entrepreneur : 1 service et 2 missions, soit environ 3 min. Le parcours est vérifié par le scénario E2E `economie`.
- Le kiosque rapporte environ 1 200 F de marge par casier (12 × 250 F − 1 800 F). Le nombre de casiers est limité à 5 par jour, ce qui borne le stock.

## Temps virtuel

1 journée virtuelle = 24 heures réelles, à l'heure d'Abidjan (UTC+0). L'horloge du HUD affiche l'heure serveur. La rue s'assombrit le soir (18 h) et la nuit (19 h 30 – 5 h 30). Stocks des commerces et plafonds de travail se renouvellent chaque jour virtuel.
