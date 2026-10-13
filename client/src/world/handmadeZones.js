// Zones dessinées à la main de la carte historique : le studio du joueur et l'épicerie. Coordonnées en cases.
// Déplacées telles quelles depuis world/zones.js (2026-10-13) : elles servent de contenu aux cartes « maison » et
// « epicerie » du catalogue (world/maps.js). Ne pas modifier leurs coordonnées : positions et portes en dépendent.

export const STUDIO = {
  id: 'maison',
  name: 'Mon studio',
  outdoor: false,
  // Logement : cliquer sur le sol fait marcher ; cliquer sur un meuble le sélectionne.
  navigation: 'walk',
  map: [
    'wwwwwwwwww',
    'wLLffZfSSw',
    'wffffffffw',
    'wfffmmfKKw',
    'wfffmmfffw',
    'wffffffffw',
    'wffffffffw',
    'wwwwEwwwww',
  ],
  spawns: { default: [3, 2], entree: [4, 6] },
  props: [],
  interactables: [
    { id: 'lit', type: 'bed', tile: [1, 1], w: 2, name: 'Lit', label: 'Faire une sieste', text: "Une petite sieste redonne de l'énergie." },
    { id: 'frigo', type: 'info', tile: [5, 1], name: 'Frigo', label: 'Ouvrir le frigo', text: 'Le frigo est presque vide… Un tour à l\'épicerie s\'impose.' },
    { id: 'sortie_maison', type: 'door', tile: [4, 7], name: "Porte d'entrée", label: 'Sortir', target: { zone: 'quartier', spawn: 'from_maison' }, range: 40 },
  ],
  npcs: [],
};

export const EPICERIE = {
  id: 'epicerie',
  name: 'Épicerie Chez Fofana',
  outdoor: false,
  navigation: 'walk',
  map: [
    'wwwwwwwwwwww',
    'wSSSSZZSSSSw',
    'wffffffffffw',
    'wffffffffSSw',
    'wQQQQffffffw',
    'wffffffSSffw',
    'wffffffffffw',
    'wffffffffffw',
    'wwwwwEwwwwww',
  ],
  spawns: { default: [5, 7], entree: [5, 7] },
  props: [],
  interactables: [
    { id: 'rayons', type: 'info', tile: [2, 1], name: 'Rayons', label: 'Regarder les rayons', text: 'Riz, huile, sucre, savon, cubes… Les produits du quotidien.' },
    { id: 'sortie_epicerie', type: 'door', tile: [5, 8], name: "Porte de l'épicerie", label: 'Sortir', target: { zone: 'quartier', spawn: 'from_epicerie' }, range: 40 },
  ],
  npcs: [
    { id: 'fofana', tile: [2, 3], behavior: { type: 'static', facing: 'down' }, range: 80 },
  ],
};
