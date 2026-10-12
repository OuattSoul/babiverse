# Atelier Babiverse

Personnage masculin modulaire en SVG pour le simulateur de ville. Chaque partie se change seule : peau, coiffure, haut, bas, chaussures, accessoires et motifs, à partir d'une simple configuration JSON.

## Foule de quartier

Test de lisibilité : des habitants générés au hasard, sans aucun dessin supplémentaire, affichés à la taille d'une vue ville.

96 px

40 px

silhouettes possibles.

## Configuration JSON

Le moteur ne lit que des identifiants, des couleurs hexadécimales et des nombres. Toute valeur inconnue est remplacée par une valeur par défaut sûre et signalée.

Configuration du personnage affiché

## Tests de validation

## Ajouter une variante

### Méthode

1. Créer un fichier dans le dossier de la catégorie, par exemple `character/hair/bantu_knots.js`.
2. Dessiner dans le repère commun `0 0 200 380`, axe vertical en x = 100, et colorer uniquement avec les variables (`var(--hair-color)`, ombres en `rgba(0,0,0,a)`).
3. Appeler `BabiAvatar.register('hair', { … })` et charger le fichier après le registre.
4. Relancer les tests : alignement, couleurs, calques et débordements sont vérifiés automatiquement.

Le moteur, l'éditeur et les autres variantes ne changent pas. La coiffure « Crête » est livrée ainsi, dans son propre fichier.

### Exemple

```
BabiAvatar.register('hair', {
  id: 'bantu_knots',
  label: 'Bantu knots',
  topY: 30, coversEars: false,
  hatLift: -8, hatScale: 1.06,
  back: () => '',
  front: () => {
    const { P, C, S } = BabiAvatar.util;
    return P(CAP, S('hair-color'))
      + C(84, 50, 7, S('hair-color'))
      + C(116, 50, 7, S('hair-color'));
  }
});
```
---

## État réel dans le dépôt (2026-10-11)

Le moteur `BabiAvatar` et les fichiers `character/<catégorie>/*.js` décrits ci-dessus **n'ont jamais été présents dans ce dépôt**. Le concept (repère commun `0 0 200 380`, axe x = 100, couleurs par variables CSS, calque arrière) a été repris dans l'Asset Studio, sans code à écrire par variante :

- un nouveau composant s'ajoute depuis l'interface (*Composants de personnage → Importer un composant SVG*) ; le serveur l'assainit et la convention de couleurs devient `var(--babi-<canal>, défaut)` (canaux `skin`, `hair`, `eyes`, `primary`, `secondary`, `accent`) ;
- le calque arrière s'écrit `<g data-babi-layer="back">` ;
- la composition est faite par `babiverse-studio/frontend/src/character/compose.ts` (module pur, réutilisable par le jeu) ;
- les contrôles (alignement, couleurs, compatibilités) sont faits par le serveur à chaque enregistrement et publication.

Voir `babiverse-studio/docs/GUIDE_ADMINISTRATEUR.md` (§ 4 et 5) et `babiverse-studio/docs/INTEGRATION.md`.
