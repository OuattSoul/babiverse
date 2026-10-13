// Registre des cartes jouables : catalogue partagé avec le serveur (shared/maps.json) + générateurs de contenu.
// Module pur (testé avec Vitest).
//
// Une carte = une zone du jeu (même identifiant que Character.zone côté serveur). Le catalogue dit quelles cartes
// existent, à quelle ville et quelle zone (commune, quartier) elles appartiennent, et si elles sont publiées ; le
// générateur indiqué par `source` produit leur contenu au format de zone habituel (grille ASCII, portes, PNJ…).
//
// Carte historique (migrée le 2026-10-13) : Cité Akwaba et ses intérieurs ne sont PAS convertis en données. Leurs
// générateurs appellent le code d'origine (world/city.js, world/handmadeZones.js, world/interiors.js) : coordonnées,
// collisions et interactions restent exactement les mêmes (tests/carteHistorique.test.js).
import CATALOGUE from '../../../shared/maps.json';
import { BUILDINGS, buildCity } from './city.js';
import { EPICERIE, STUDIO } from './handmadeZones.js';
import { interiorIdOf, interiorZone } from './interiors.js';

const FORMAT = 'babiverse-maps';
const STATUSES = ['draft', 'published', 'disabled'];
const KINDS = ['outdoor', 'home', 'interior'];
const MAP_ID = /^[a-z][a-z0-9_]{0,31}$/;
const ENTITY_ID = /^[a-z][a-z0-9_]{0,47}$/;
// Cartes dont le reste du jeu a besoin aujourd'hui (repli de World3D, missions, commerces).
const REQUIRED = ['quartier'];

/** Générateurs de contenu des cartes de type « generator ». Seules des données choisissent un générateur : pas de code. */
const GENERATORS = {
  city: ({ residentialBlocks } = {}) => buildCity({ residentialBlocks }),
  studio: () => STUDIO,
  epicerie: () => EPICERIE,
};
const INTERIOR_GENERATOR = 'interior';

/** Liste des incohérences du catalogue (vide s'il est valide). Mêmes règles que backend/game/maps.py, plus les générateurs connus. */
export function catalogueErrors(cat) {
  const errors = [];
  if (!cat || cat.format !== FORMAT || cat.format_version !== 1) return ['format de catalogue inconnu'];
  const ids = (items = [], label, pattern) => {
    const seen = new Set();
    for (const it of items) {
      if (typeof it.id !== 'string' || !pattern.test(it.id)) errors.push(`${label} : identifiant invalide ${it.id}`);
      else if (seen.has(it.id)) errors.push(`${label} : identifiant en double ${it.id}`);
      if (!STATUSES.includes(it.status)) errors.push(`${label} ${it.id} : statut inconnu ${it.status}`);
      if (typeof it.name !== 'string' || !it.name.trim()) errors.push(`${label} ${it.id} : nom manquant`);
      seen.add(it.id);
    }
    return seen;
  };
  const cities = ids(cat.cities, 'ville', ENTITY_ID);
  const districts = ids(cat.districts, 'zone', ENTITY_ID);
  for (const d of cat.districts || []) if (!cities.has(d.city)) errors.push(`zone ${d.id} : ville inconnue ${d.city}`);
  ids(cat.maps, 'carte', MAP_ID);
  for (const m of cat.maps || []) {
    if (m.id?.startsWith('int_')) errors.push(`carte ${m.id} : le préfixe int_ est réservé aux intérieurs générés`);
    if (!districts.has(m.district)) errors.push(`carte ${m.id} : zone inconnue ${m.district}`);
    if (!KINDS.includes(m.kind)) errors.push(`carte ${m.id} : type inconnu ${m.kind}`);
    if (m.source?.type !== 'generator' || !GENERATORS[m.source.generator]) errors.push(`carte ${m.id} : source non prise en charge`);
  }
  const gen = cat.generated_interiors;
  if (!gen || !districts.has(gen.district) || typeof gen.pattern !== 'string' || gen.source?.generator !== INTERIOR_GENERATOR) {
    errors.push('intérieurs générés : zone, motif ou générateur manquant');
  }
  const published = new Set((cat.maps || []).filter((m) => m.status === 'published').map((m) => m.id));
  if (!published.has(cat.start_map)) errors.push(`carte de départ invalide ${cat.start_map}`);
  for (const id of REQUIRED) if (!published.has(id)) errors.push(`carte requise non publiée : ${id}`);
  return errors;
}

/** Catalogue validé ; un catalogue invalide arrête le chargement du jeu (mieux qu'une ville à moitié construite). */
export function checkCatalogue(cat) {
  const errors = catalogueErrors(cat);
  if (errors.length) throw new Error(`Catalogue des cartes invalide : ${errors.join(' ; ')}`);
  return cat;
}

export const MAP_CATALOGUE = checkCatalogue(CATALOGUE);
export const START_MAP = MAP_CATALOGUE.start_map;
const INTERIOR_RE = new RegExp(MAP_CATALOGUE.generated_interiors.pattern);

/** Cartes publiées, dans l'ordre du catalogue. */
export const publishedMaps = (cat = MAP_CATALOGUE) => cat.maps.filter((m) => m.status === 'published');

/** Vrai pour un identifiant d'intérieur généré (int_<bâtiment>, int_pb_<parcelle>…). */
export const isGeneratedInterior = (id) => typeof id === 'string' && INTERIOR_RE.test(id);

// Cartes publiées par l'atelier (pack de jeu), connues après applyPack : métadonnées seulement.
const atelierMaps = new Map();

/** Identifiants des cartes intégrées au jeu (prioritaires sur celles de l'atelier). */
export const builtinMapIds = (cat = MAP_CATALOGUE) => cat.maps.map((m) => m.id);

/** Enregistre les cartes publiées par l'atelier (liste déjà filtrée par world/dataMaps.usableMap). */
export function setAtelierMaps(list = []) {
  atelierMaps.clear();
  for (const m of list) {
    atelierMaps.set(m.id, { id: m.id, name: m.name, kind: 'outdoor', district: m.district?.id ?? null, city: m.city?.id ?? null, source: 'atelier', version: m.version });
  }
}

/** Métadonnées d'une carte publiée ou d'un intérieur généré : { id, name?, kind, district, city }, sinon null. */
export function mapInfo(id, cat = MAP_CATALOGUE) {
  const entry = publishedMaps(cat).find((m) => m.id === id);
  const district = entry ? entry.district : isGeneratedInterior(id) ? cat.generated_interiors.district : null;
  if (!district) return atelierMaps.get(id) || null;
  const city = cat.districts.find((d) => d.id === district).city;
  return entry
    ? { id, name: entry.name, kind: entry.kind, district, city }
    : { id, kind: 'interior', district, city };
}

/**
 * Contenu (zone) d'une carte publiée du catalogue, ou null. `options` est transmis au générateur
 * (ville : `residentialBlocks`, blocs de lotissement ouverts par le serveur).
 */
export function buildMap(id, options = {}, cat = MAP_CATALOGUE) {
  const entry = publishedMaps(cat).find((m) => m.id === id);
  return entry ? GENERATORS[entry.source.generator](options) : null;
}

/**
 * Toutes les zones des cartes publiées, dans l'ordre historique : cartes du catalogue, puis intérieurs générés
 * des bâtiments de la ville qui n'ont pas d'intérieur dessiné (int_<bâtiment>).
 */
export function catalogueZones(cat = MAP_CATALOGUE) {
  const zones = {};
  for (const m of publishedMaps(cat)) zones[m.id] = buildMap(m.id, {}, cat);
  for (const b of BUILDINGS) if (!b.zone) zones[interiorIdOf(b)] = interiorZone(b);
  return zones;
}
