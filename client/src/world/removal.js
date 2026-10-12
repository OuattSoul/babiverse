// Éléments d'origine de la ville que l'administrateur peut retirer depuis l'atelier (page « Carte du jeu »).
// Module pur, testé, partagé par le jeu et l'atelier.
//
// Chaque élément a une clé stable : bâtiment `bld:<id>`, arbre/palmier/buisson `tree:x,y`, mobilier `prop:<type>:x,y`.
// Ce dont le jeu a besoin pour fonctionner est protégé (jamais retiré, même si une clé le demande) : commerces avec
// intérieur ou PNJ dédié, emploi, destinations de livraison, kiosque du joueur, étal de garba, parcelles, panneaux
// publicitaires (ces trois derniers sont aussi connus du serveur).

const TREE_CHARS = { T: 'Manguier', p: 'Palmier', '%': 'Buisson' };
const PROP_LABELS = {
  parasol: 'Parasol', crates: 'Casiers', bench: 'Banc', bin: 'Poubelle', stop: 'Panneau stop', roadsign: 'Panneau de direction',
  pole: 'Poteau électrique', lamp: 'Lampadaire', kiosk: 'Kiosque du joueur', garba_stand: 'Étal de garba',
  billboard: 'Panneau publicitaire', plot: 'Parcelle', plotsign: 'Panneau de parcelle',
};
const PROTECTED_PROPS = {
  kiosk: 'le kiosque à boissons des joueurs', garba_stand: "l'étal de Tantie Adjoua (repas)",
  billboard: 'un emplacement publicitaire loué par les joueurs', plot: 'une parcelle achetable', plotsign: 'une parcelle achetable',
};
const PROTECTED_BUILDINGS = { depot: "l'emploi de livreur chez M. Diabaté" };

const inRect = ([x, y], r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
/** Sol rendu à la place d'un élément retiré (même règle que la génération de la ville). */
const groundAt = (y) => (y < 7 || y > 31 ? ',' : '.');

/**
 * Éléments d'origine de la ville : [{ key, kind: building|tree|prop, label, rect: {x0,y0,x1,y1}, protected: raison|null }].
 */
export function cityElements(city) {
  const out = [];
  for (const b of city.buildings || []) {
    if (b.atelier) continue;
    const rect = { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 };
    const delivery = (city.interactables || []).some((i) => i.type === 'delivery' && inRect(i.tile, rect));
    const reason = PROTECTED_BUILDINGS[b.id] || (b.zone ? `${b.name} (intérieur et commerçant du jeu)` : null) || (delivery ? 'une destination des livraisons' : null);
    out.push({ key: `bld:${b.id}`, kind: 'building', label: b.name, rect, protected: reason });
  }
  city.map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (TREE_CHARS[row[x]]) out.push({ key: `tree:${x},${y}`, kind: 'tree', label: TREE_CHARS[row[x]], rect: { x0: x, y0: y, x1: x, y1: y }, protected: null });
    }
  });
  for (const p of city.props || []) {
    if (p.kind.startsWith('atl_') || p.kind === 'plot') continue;
    const [x, y] = p.tile;
    out.push({
      key: `prop:${p.kind}:${x},${y}`, kind: 'prop', label: p.text ? `${PROP_LABELS[p.kind]} ${p.text}` : PROP_LABELS[p.kind] || p.kind,
      rect: { x0: x, y0: y, x1: x + (p.w || 1) - 1, y1: y + (p.h || 1) - 1 }, protected: PROTECTED_PROPS[p.kind] || null,
    });
  }
  return out;
}

/** Élément d'origine sous une case (le plus petit d'abord : un banc devant un bâtiment), ou null. */
export function elementAt(elements, x, y) {
  const hit = elements.filter((e) => inRect([x, y], e.rect));
  hit.sort((a, b) => (a.rect.x1 - a.rect.x0 + 1) * (a.rect.y1 - a.rect.y0 + 1) - (b.rect.x1 - b.rect.x0 + 1) * (b.rect.y1 - b.rect.y0 + 1));
  return hit[0] || null;
}

/**
 * Ville sans les éléments retirés (clés). Les éléments protégés ou inconnus sont ignorés.
 * Retourne { zone, removed: [clés appliquées], refused: [{ key, reason }] } ; la zone d'origine n'est pas modifiée.
 */
export function cityWithout(city, keys = []) {
  if (!keys.length) return { zone: city, removed: [], refused: [] };
  const byKey = new Map(cityElements(city).map((e) => [e.key, e]));
  const removed = [];
  const refused = [];
  const map = city.map.map((row) => row.split(''));
  const gone = new Set();
  let buildings = city.buildings || [];
  let interactables = city.interactables || [];
  for (const key of keys) {
    const e = byKey.get(key);
    if (!e) { refused.push({ key, reason: 'Élément inconnu (la ville a changé).' }); continue; }
    if (e.protected) { refused.push({ key, reason: `Protégé : ${e.protected}.` }); continue; }
    removed.push(key);
    if (e.kind === 'prop') { gone.add(key); continue; }
    for (let y = e.rect.y0; y <= e.rect.y1; y++) for (let x = e.rect.x0; x <= e.rect.x1; x++) map[y][x] = groundAt(y);
    if (e.kind === 'building') {
      const id = key.slice(4);
      buildings = buildings.filter((b) => b.id !== id);
      interactables = interactables.filter((i) => !inRect(i.tile, e.rect));
    }
  }
  const props = (city.props || []).filter((p) => !gone.has(`prop:${p.kind}:${p.tile[0]},${p.tile[1]}`));
  return { zone: { ...city, map: map.map((row) => row.join('')), buildings, interactables, props }, removed, refused };
}
