// Zones jouables du jeu. Coordonnées en cases (1 case = 32 px).
// Ajouter un objet interactif = ajouter une entrée dans `interactables` avec un type
// connu de world/interactionTypes.js : le contrôleur du joueur n'a pas à changer.
//
// Depuis le 2026-10-13, les zones sont construites à partir du catalogue des cartes (world/maps.js,
// shared/maps.json) : la carte historique y est référencée et son contenu vient du même code qu'avant.
// Retour arrière pendant la transition : `?carte=historique` dans l'adresse, ou `babiverse.carte` =
// `historique` dans le localStorage, reconstruit les zones par l'ancien chemin, sans le catalogue.

import { BUILDINGS, buildCity, PLAYER_BUILDINGS } from './city.js';
import { EPICERIE, STUDIO } from './handmadeZones.js';
import { interiorIdOf, interiorZone } from './interiors.js';
import { buildMap, catalogueZones, START_MAP } from './maps.js';

/** Ancien chemin de construction des zones (avant le catalogue), gardé pour revenir en arrière. */
export function legacyZones() {
  const zones = { quartier: buildCity(), maison: STUDIO, epicerie: EPICERIE };
  // Intérieurs générés des bâtiments de la ville (ceux qui n'ont pas de zone dessinée à la main).
  for (const b of BUILDINGS) if (!b.zone) zones[interiorIdOf(b)] = interiorZone(b);
  return zones;
}

function legacyRequested() {
  try {
    if (new URLSearchParams(globalThis.location?.search || '').get('carte') === 'historique') return true;
    return globalThis.localStorage?.getItem('babiverse.carte') === 'historique';
  } catch {
    return false;
  }
}

/** Chemin de construction actif : 'catalogue' (par défaut) ou 'historique' (retour arrière). */
export const WORLD_SOURCE = legacyRequested() ? 'historique' : 'catalogue';

export const ZONES = WORLD_SOURCE === 'historique' ? legacyZones() : catalogueZones();

/** Ville régénérée avec `blocks` blocs de lotissement, par le chemin actif. */
const buildQuartier = (blocks) => (WORLD_SOURCE === 'historique'
  ? buildCity({ residentialBlocks: blocks })
  : buildMap('quartier', { residentialBlocks: blocks }));

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
 * Zone à charger pour une demande : la zone si elle existe, sinon la Cité Akwaba au point de départ (carte retirée,
 * désactivée ou pack de l'atelier indisponible). La position enregistrée n'est alors pas réutilisée : elle appartient
 * à une autre carte.
 */
export function resolveZoneRequest(id, playerBuildings = [], { spawn, pos } = {}) {
  const zone = zoneById(id, playerBuildings);
  if (zone) return { zone, spawn, pos, fallback: false };
  return { zone: ZONES.quartier, spawn: 'default', pos: undefined, fallback: true };
}

/**
 * Ouvre les nouveaux blocs du lotissement annoncés par le serveur : la ville est régénérée, plus
 * grande vers le sud (rien ne bouge). Retourne true si la carte a changé.
 */
export function setResidentialBlocks(blocks) {
  if (!(blocks > ZONES.quartier.residential.blocks)) return false;
  ZONES.quartier = cityDecorator(buildQuartier(blocks));
  return true;
}

// Ajouts à la ville venus de l'atelier (atelier/pack.js) : réappliqués quand la ville est régénérée.
let cityDecorator = (zone) => zone;

/** Installe la fonction qui complète la ville générée (null : ville d'origine) et l'applique tout de suite. */
export function setCityDecorator(fn) {
  cityDecorator = fn || ((zone) => zone);
  ZONES.quartier = cityDecorator(buildQuartier(ZONES.quartier.residential.blocks));
}

export const START_ZONE = START_MAP;
