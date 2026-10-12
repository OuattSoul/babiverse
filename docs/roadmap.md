# Feuille de route

## État au 2026-10-09

| Phase | Contenu | État | Vérification |
|---|---|---|---|
| 0. Audit et décisions | dépôt vide ; v1 voisin (FastAPI + Phaser iso, menus) examiné ; ADR 0001/0002 | ✅ | — |
| 1. Monde jouable minimal | quartier 40×22, joueur, joystick et clavier, caméra, collisions, limites | ✅ | Vitest (collisions, limites) + E2E (façade, taxi, mur, joystick tactile) |
| 2. Espaces et interactions | maison, épicerie, transitions, système d'interaction générique, 5 PNJ | ✅ | Vitest (portes, portée, ligne de vue) + E2E |
| 3. Simulation de vie | faim et énergie, sieste, nourriture, inventaire, temps virtuel | ✅ | tests Django (besoins, hors ligne, bornes) + E2E |
| 4. Économie et entrepreneuriat | monnaie, achats, livraisons, missions, kiosque (achat, stock, vente, passif) | ✅ | tests Django + E2E `economie` |
| 5. Persistance et robustesse | sauvegarde/restauration, idempotence, concurrence, hors-ligne | ✅ | tests Django (rejeu, conflit, concurrence) + E2E (rechargement, coupure réseau) |
| 6. Essais | parcours complet, émulation mobile, documentation, déploiement | 🟡 | émulation mobile faite ; **pas encore testé sur un vrai téléphone Android** |
| 8. Ville modulaire (ADR 0004) | bâtiments compacts, 2 rues + 2 boulevards, 12 parcelles libres, commerces, mobilier urbain, panneaux publicitaires | ✅ | Vitest (`city.test.js` : échelle, chevauchements, accès, routes reliées, placement) + E2E |
| 9. Parcelles des joueurs | achat (unique, concurrence testée), construction (maisonnette, boutique), panneaux publicitaires loués, monde partagé visible par tous | ✅ | tests Django (`test_plots`, course à 3 joueurs) + E2E `parcelles` (2 navigateurs) |
| 10. Navigation et publicités (ADR 0005) | ville explorée à la caméra (clic = fiche, jamais de marche), logement au clic, sélection générique par volumes, fiches de parcelle (disponible / occupée / indisponible), supports publicitaires et annonces séparés, fiche publicitaire avec lien HTTPS | ✅ | Vitest (`interactions.test.js` : gestes, rayons de caméra réels, politiques, parcelles, publicités) + tests Django + E2E `interactions` (tactile, souris, pavé tactile simulé) |
| 7. Monde 3D (ADR 0003) | Three.js, caméra orbitale (pivoter, zoomer, naviguer), toucher pour aller, bâtiments transparents | ✅ | Vitest (chemins, caméra, structures) + E2E (pincer, pivoter, vue libre, toucher le sol ou une porte) |

## Limites connues

- **Pas de test sur un appareil physique.** La fluidité (60 images/s en 3D, régime établi) est mesurée dans Chrome avec émulation mobile et CPU ralenti ×4, pas sur un vrai Android d'entrée de gamme. Les 2 à 3 premières secondes après un chargement de page sont plus lentes (compilation des shaders, envoi des textures au GPU).
- **PostgreSQL validé en local** (2026-10-10) : tests backend et E2E passent sur PostgreSQL 17, base de dev migrée. Reste à choisir une base managée avec sauvegardes pour la production. Redis (limitation de débit partagée) n'a pas encore été essayé avec un vrai serveur.
- Position et zone sont déclarées par le client. Le serveur valide la cohérence de zone, pas la géométrie fine, et borne les gains par règles. Un client modifié peut donc enchaîner plus vite les actions autorisées, mais jamais dépasser les plafonds.
- Le jeton invité dans `localStorage` est perdu si le joueur efface les données du navigateur sans avoir noté son code de récupération.
- Le service worker met l'application en cache, mais le jeu exige le réseau pour les actions économiques. C'est voulu.
- Modèles 3D procéduraux simples (boîtes, cônes) : pas de modèles dessinés (glTF), pas de son.
- Les PNJ ne contournent pas les obstacles : clients en ligne droite, flânerie de Koffi en zone dégagée.
- Gestes testés en émulation (tactile Chrome, souris Playwright). Le pavé tactile est simulé par des événements molette : pas encore essayé sur de vrais pavés tactiles (macOS, Windows Precision). Le défilement vertical à deux doigts du pavé tactile zoome comme une molette.
- Annonces publicitaires fictives et statiques (`shared/ads.json`). Pas d'interface d'administration, pas de vente d'espaces, pas de statistiques envoyées au serveur (`adTracking` reste en mémoire).
- Changer de zone vers la ville prend environ 6 s avec le CPU ralenti ×4, dont environ 5 s pour construire la ville (peinture du sol, fusion du décor). À optimiser avant un essai sur un vrai téléphone d'entrée de gamme.

## Prochaines priorités (par impact)

1. **Test terrain** : 5 à 10 testeurs sur Android d'entrée de gamme via un déploiement HTTPS. Mesurer le temps de chargement et la fluidité, collecter les retours sur l'équilibrage.
2. **Production PostgreSQL + Redis** : base managée avec sauvegardes automatiques et test de restauration, `REDIS_URL` dès plusieurs workers.
3. **Lisibilité et onboarding** : tutoriel contextuel (premières minutes guidées par Koffi), sons simples, retours visuels (+250 F flottant).
4. **Équilibrage** à partir de données : temps pour ouvrir le kiosque, argent moyen par session. Ajouter une télémétrie minimale côté serveur.
5. **Contenu** : 2e emploi (artisan : réparations), meubles achetables pour le studio, horaires des PNJ (maquis le soir).
6. **Kiosque v2** : prix réglable avec effet sur la demande, frais de place quotidiens, 2e type de commerce.
7. **Compte** : rattacher un numéro de téléphone ou un e-mail au joueur invité.
8. **Bâtiments des joueurs v2** : intérieurs aménageables, boutique reliée à une vraie activité (vente depuis sa boutique), plusieurs parcelles, revente.
9. **Ville** : carte de la ville reliant plusieurs quartiers (Treichville, Adjamé, Plateau…), modèles glTF.

Toujours hors périmètre du MVP : multijoueur, chat, marché entre joueurs, paiements réels, vente d'espaces publicitaires et facturation des annonceurs, blockchain.
