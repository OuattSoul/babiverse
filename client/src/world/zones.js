// Données des zones du MVP. Coordonnées en cases (1 case = 32 px).
// Ajouter un objet interactif = ajouter une entrée dans `interactables` avec un type
// connu de world/interactionTypes.js : le contrôleur du joueur n'a pas à changer.

import { BUILDINGS, buildCity, PLAYER_BUILDINGS } from './city.js';
import { interiorIdOf, interiorZone } from './interiors.js';

export const ZONES = {
  // Le quartier est généré à partir de données (voir world/city.js).
  quartier: buildCity(),

  maison: {
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
  },

  epicerie: {
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
  },
};

// Intérieurs générés des bâtiments de la ville (ceux qui n'ont pas de zone dessinée à la main).
for (const b of BUILDINGS) if (!b.zone) ZONES[interiorIdOf(b)] = interiorZone(b);

/**
 * Zone par identifiant, y compris l'intérieur d'une construction de joueur (int_pb_<parcelle>),
 * généré à partir de la liste des constructions connues (état serveur). null si inconnue.
 */
export function zoneById(id, playerBuildings = []) {
  if (ZONES[id]) return ZONES[id];
  const b = playerBuildings.find((x) => interiorIdOf(x) === id);
  if (!b) return null;
  return interiorZone({ id: b.id, name: b.name, interior: PLAYER_BUILDINGS[b.template]?.interior || 'house' });
}

/**
 * Ouvre les nouveaux blocs du lotissement annoncés par le serveur : la ville est régénérée, plus
 * grande vers le sud (rien ne bouge). Retourne true si la carte a changé.
 */
export function setResidentialBlocks(blocks) {
  if (!(blocks > ZONES.quartier.residential.blocks)) return false;
  ZONES.quartier = cityDecorator(buildCity({ residentialBlocks: blocks }));
  return true;
}

// Ajouts à la ville venus de l'atelier (atelier/pack.js) : réappliqués quand la ville est régénérée.
let cityDecorator = (zone) => zone;

/** Installe la fonction qui complète la ville générée (null : ville d'origine) et l'applique tout de suite. */
export function setCityDecorator(fn) {
  cityDecorator = fn || ((zone) => zone);
  ZONES.quartier = cityDecorator(buildCity({ residentialBlocks: ZONES.quartier.residential.blocks }));
}

export const START_ZONE = 'maison';
