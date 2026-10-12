# Économie

Toutes les valeurs se trouvent dans `backend/game/rules.py`. Le client les lit via `GET /api/config` et n'en décide aucune.

## Monnaie

- Le **franc CFA virtuel (F)** est un entier, toujours ≥ 0 (contrainte en base `character_balance_non_negative`).
- La monnaie est **strictement virtuelle** : ni achat, ni retrait, ni conversion, ni blockchain.
- Chaque mouvement est enregistré dans le journal `LedgerEntry` : type, montant signé, solde après l'opération, libellé et date. Les 30 derniers mouvements sont visibles dans ⚙️.

## Prix

| Commerce | Produit | Prix | Stock / jour | Effet |
|---|---|---|---|---|
| Épicerie Chez Fofana | Pain | 150 | 20 | faim −15 |
| | Sachet d'eau | 50 | 40 | faim −3, énergie +3 |
| | Café Touba | 200 | 15 | faim −2, énergie +12 |
| | Boîte de sardines | 450 | 8 | faim −25 |
| | Casier de boissons (12) | 1 800 | 5 | stock du kiosque |
| Garba de Tantie Adjoua | Garba | 500 | 10 | faim −45, énergie +5 |
| | Alloco | 300 | 10 | faim −25 |

Le stock des commerces est propre à chaque joueur, puisque le jeu est solo, et se renouvelle chaque jour virtuel.

## Revenus

| Source | Montant | Garde-fous serveur |
|---|---|---|
| Service de livraison | 1 200 F × multiplicateur du profil | 3 livraisons validées, ≥ 1,5 s entre deux livraisons, ≥ 30 s par service, 8 services/jour, énergie ≥ 20, faim ≤ 85, expiration après 15 min |
| Missions | 200 à 1 500 F | une seule récompense (transition d'état et idempotence) |
| Vente active au kiosque | 250 F/boisson | stock ≥ 1, ≥ 4 s entre deux ventes, joueur dans la zone |
| Ventes passives | 2 boissons/h | **plafond : 72 h (3 jours virtuels) d'absence**, et jamais plus que le stock |

## Entreprise : kiosque à boissons

- Ouverture : 12 000 F (9 600 F pour un entrepreneur). Il faut avoir terminé un service de livraison, sauf pour un entrepreneur.
- Cycle :
  1. acheter un casier à l'épicerie (1 800 F) ;
  2. le **déposer** au kiosque (+12 boissons, 48 au maximum) ;
  3. « tenir le kiosque » : des clients viennent au comptoir ;
  4. servir à 250 F l'unité.
- Le panneau du kiosque affiche stock, prix, ventes, recettes, dépenses (lancement + casiers) et bénéfice. Le joueur voit l'investissement se rembourser.
- Ventes passives : chaque requête calcule `heures écoulées (≤ 72) × 2`, puis vend dans la limite du stock. Les fractions sont reportées. Un message résume les ventes au retour du joueur.
- Pas de frais d'exploitation dans le MVP : le paramètre pourra être ajouté dans `BUSINESS_TYPES`.

## Parcelles, constructions et publicité (monde partagé)

Les valeurs se trouvent dans `shared/city.json` : une seule source pour le serveur et le client.

| Action | Prix | Règles serveur |
|---|---|---|
| Acheter une parcelle | 15 000 F | une par joueur ; parcelle unique en base (`PlotClaim.plot_id`), donc deux acheteurs simultanés ne peuvent pas l'obtenir tous les deux, et seul le gagnant est débité |
| Construire une maisonnette (3×2) | 10 000 F | sur sa propre parcelle, une seule construction |
| Construire une petite boutique (4×2, enseigne au nom choisi) | 18 000 F | idem ; nom de 2 à 20 caractères |
| Louer un panneau publicitaire | 2 000 F / 3 jours virtuels | il faut posséder une entreprise ; un panneau loué reste occupé jusqu'à expiration ; **+1 vente passive par heure** pendant la location |

- **L'emplacement du bâtiment est calculé par le serveur** (`services/plots.placement`) : contre le côté d'accès de la parcelle, la porte orientée vers la rue, sans jamais masquer le panneau ni placer la porte face à lui. Le client ne fait qu'afficher ce que le serveur renvoie.
- **L'état public** (propriétaires, constructions, publicités en cours) est joint à chaque réponse (`state.world`). Les joueurs voient donc les changements des autres au plus tard au battement de cœur suivant (45 s), sans multijoueur temps réel.
- Supprimer un personnage libère sa parcelle et sa publicité.
- Deux nouvelles missions : « Propriétaire » (+1 000 F) et « Bâtisseur » (+2 000 F).

## Garanties transactionnelles

1. **Atomicité** : chaque action s'exécute dans une transaction et un point de sauvegarde. Un refus (solde insuffisant, stock épuisé, mauvaise zone, quantité invalide) annule toutes les écritures. Il n'y a jamais d'achat débité sans objet, ni d'objet sans débit.
2. **Sérialisation** : la ligne du personnage est verrouillée (`select_for_update`) pendant l'action. Deux achats simultanés ne peuvent pas dépenser deux fois le même argent (test `test_concurrency`).
3. **Idempotence** :
   - l'en-tête `Idempotency-Key` est obligatoire pour les achats, la consommation, la sieste, l'emploi, le kiosque et les récompenses ;
   - un rejeu renvoie le résultat d'origine (`replayed: true`) et un état à jour ;
   - une clé réutilisée pour une autre requête renvoie 409 `idempotency_conflict` ;
   - les clés sont propres à chaque joueur.
4. **Autorité** : le solde, les prix et les gains viennent du serveur. Le client n'envoie que l'intention, sa zone et sa position.

## Leviers d'équilibrage

Tous ces leviers se trouvent dans `rules.py` :

- `PROFILES[*].balance`, `wage_multiplier`, `business_cost_multiplier` ;
- `SHOPS[*].items[*].price` et `daily_stock` ;
- `JOBS.livraison.base_wage`, `max_shifts_per_day`, `min_duration_seconds` ;
- `BUSINESS_TYPES.kiosque.cost`, `sale_price`, `passive_units_per_hour`, `max_stock` ;
- `TIME.offline_passive_cap_hours` ;
- `MISSIONS[*].reward`.

Après modification, relancer `python manage.py test game` : plusieurs tests vérifient des montants précis et doivent alors être adaptés.
