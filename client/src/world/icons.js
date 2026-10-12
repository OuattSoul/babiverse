// Icônes descriptives des lieux (étiquettes de la carte, enseignes) à la place de leur nom.
// Module PUR : un bâtiment peut donner son icône (`icon`), sinon elle est déduite de son identifiant, de son
// gabarit, puis de mots de son nom / sa catégorie / sa description (bâtiments placés depuis l'atelier).

// Bâtiments du jeu et gabarits des constructions de joueurs.
const BY_ID = {
  epicerie: '🛒', maquis: '🍲', depot: '📦', couture: '🧵', pharmacie: '💊', transfert: '💸',
};
const BY_TEMPLATE = { boutique: '🏪', maisonnette: '🏡' };

// Mots (sans accents, en minuscules) → icône ; le premier qui correspond l'emporte.
const WORDS = [
  [/pharma|medicament/, '💊'],
  [/hopital|clinique|sante|dispensaire|infirm/, '🏥'],
  [/maquis|restau|cuisine|garba|alloco|grill|braise|cantine/, '🍲'],
  [/cafe|the\b/, '☕'],
  [/bar\b|buvette|boisson|jus/, '🍹'],
  [/boulang|patiss|pain/, '🥖'],
  [/boucher|viande/, '🥩'],
  [/poisson/, '🐟'],
  [/fruit|legume|primeur/, '🍌'],
  [/epicerie|supermarche|superette|alimentation|marche|commerce general/, '🛒'],
  [/coiff|salon|beaute|barbier/, '💇'],
  [/couture|tailleur|tissu|pagne|mode|vetement|habit|boutique de mode/, '🧵'],
  [/chaussure|cordonn/, '👞'],
  [/banque|transfert|argent|mobile money|change|guichet/, '💸'],
  [/telephon|portable|phone|cyber|informatique/, '📱'],
  [/garage|meca|reparation|vulcani/, '🔧'],
  [/station|essence|carburant/, '⛽'],
  [/depot|livraison|entrepot|stock/, '📦'],
  [/ecole|college|lycee|universite|classe/, '🏫'],
  [/police|commissariat|gendarm/, '👮'],
  [/pompier|caserne/, '🚒'],
  [/mairie|administration|prefecture/, '🏛️'],
  [/eglise|chapelle|temple/, '⛪'],
  [/mosquee/, '🕌'],
  [/hotel|auberge|residence/, '🏨'],
  [/bureau|immeuble|entreprise/, '🏢'],
  [/maison|habitation|villa|logement|domicile/, '🏠'],
];

const plain = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Icône d'un bâtiment du jeu, d'une construction de joueur ou d'un bâtiment placé depuis l'atelier. */
export function placeIcon(b) {
  if (b.zone === 'maison') return '🏠';
  if (b.icon) return b.icon;
  if (BY_ID[b.id]) return BY_ID[b.id];
  if (BY_TEMPLATE[b.template]) return BY_TEMPLATE[b.template];
  const text = plain([b.name, b.render?.category, b.render?.description, b.info].filter(Boolean).join(' '));
  for (const [re, icon] of WORDS) if (re.test(text)) return icon;
  return b.category === 'shop' ? '🏪' : '🏢';
}
