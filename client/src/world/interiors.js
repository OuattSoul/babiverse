// Intérieurs des bâtiments de la ville (commerces, maisons, constructions des joueurs).
// Chaque bâtiment déclare un type d'intérieur ; la zone est générée à partir d'un plan ASCII
// (même légende que les autres zones, voir grid.js). Module pur (testé avec Vitest).
//
// Identifiant de zone : `int_<id du bâtiment>` (ex. int_maquis, int_pb_P06 pour une construction
// de joueur). Le studio (« Chez moi », ouvert par ma maison du lotissement) et l'épicerie gardent
// leurs zones dessinées à la main (zones.js).

// Plans : 'E' = paillasson de la porte, dans le mur du bas ; on apparaît sur la case juste au-dessus.
const LAYOUTS = {
  house: [
    'wwwwwwwwww',
    'wLLfffKKZw',
    'wffffffffw',
    'wffmmmfffw',
    'wffmmmfffw',
    'wffffffffw',
    'wwwwEwwwww',
  ],
  shop: [
    'wwwwwwwwww',
    'wSSSSSSSSw',
    'wffffffffw',
    'wffQQQQffw',
    'wffffffffw',
    'wffffffffw',
    'wwwwEwwwww',
  ],
  pharmacy: [
    'wwwwwwwwww',
    'wSSSZZSSSw',
    'wffffffffw',
    'wSfQQQQfSw',
    'wSffffffSw',
    'wffffffffw',
    'wwwwEwwwww',
  ],
  maquis: [
    'wwwwwwwwwwww',
    'wQQQQffZZffw',
    'wffffffffffw',
    'wfKKffKKfffw',
    'wffffffffffw',
    'wfKKffKKfffw',
    'wffffffffffw',
    'wwwwwEwwwwww',
  ],
  depot: [
    'wwwwwwwwwwww',
    'wSSSSFFSSSSw',
    'wFFFFFFFFFFw',
    'wSSFFQQFFSSw',
    'wFFFFFFFFFFw',
    'wFFFFFFFFFFw',
    'wwwwwEwwwwww',
  ],
};

// Meuble à regarder (fiche d'information) selon le type d'intérieur.
const LOOK_AT = { house: 'K', shop: 'Q', pharmacy: 'Q', maquis: 'Q', depot: 'Q' };
const LOOK_NAME = { house: 'Table', shop: 'Comptoir', pharmacy: 'Comptoir', maquis: 'Comptoir', depot: 'Comptoir' };

export const INTERIOR_KINDS = Object.keys(LAYOUTS);

/** Zone d'intérieur d'un bâtiment (zone dessinée à la main si le bâtiment en déclare une). */
export const interiorIdOf = (b) => b.zone || `int_${b.id}`;

/** Point d'apparition dans la ville en sortant du bâtiment `id` (devant sa porte). */
export const exitSpawnOf = (id) => `from_${id}`;

function find(map, ch) {
  for (let y = 0; y < map.length; y++) {
    const x = map[y].indexOf(ch);
    if (x >= 0) return [x, y];
  }
  return null;
}

/**
 * Zone d'intérieur générée pour un bâtiment { id, name, interior, info? }.
 * Le joueur apparaît juste derrière la porte ; la porte ramène devant le bâtiment, dans la ville.
 */
export function interiorZone(b) {
  const kind = LAYOUTS[b.interior] ? b.interior : 'house';
  const map = LAYOUTS[kind];
  const [ex, ey] = find(map, 'E');
  const look = find(map, LOOK_AT[kind]);
  const interactables = [
    { id: `sortie_${b.id}`, type: 'door', tile: [ex, ey], name: 'Porte', label: 'Sortir', target: { zone: 'quartier', spawn: exitSpawnOf(b.id) }, range: 40 },
  ];
  if (b.info && look) {
    interactables.push({ id: `info_${b.id}`, type: 'info', tile: look, name: LOOK_NAME[kind], label: 'Regarder', text: b.info });
  }
  return {
    id: interiorIdOf({ id: b.id }),
    name: b.name,
    outdoor: false,
    navigation: 'walk',
    map,
    spawns: { default: [ex, ey - 1], entree: [ex, ey - 1] },
    props: [],
    interactables,
    npcs: [],
  };
}
