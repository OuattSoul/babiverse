"""Taxonomie extensible du catalogue Babiverse.

Une *famille* porte le schéma technique, le rendu et les règles (bâtiment, intérieur, route…) :
elle est définie par le CODE, car elle correspond à une capacité du moteur.
Une *catégorie* est un regroupement métier (santé, commerce…) rattaché à une famille : elle est
stockée en BASE et se crée depuis l'administration, sans code ni nouvelle table.
`DEFAULT_CATEGORIES` ne sert qu'à remplir une base neuve ; `CATEGORY_BY_KEY` est rechargé depuis la
base au démarrage et après chaque modification (`reload`).
"""
from __future__ import annotations

import json
import sqlite3
import time

A, X, N = "available", "experimental", "unavailable"

# Capacités réelles de chaque famille dans l'atelier ; `game` décrit l'intégration au jeu Babiverse
# actuel (client Three.js) : « adapter » = export disponible mais avec perte (voir docs/INTEGRATION.md).
FAMILIES = {
    "building": {
        "label": "Bâtiment", "implemented": True, "representation": "procedural", "representations": ["procedural"],
        "description": "Volume procédural isométrique : emprise, étages, toiture, façade modulaire, entrées.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": N,
                         "export": A, "behaviors": A, "publish": A, "assembly": A},
        "limits": "Pas de sprite dessiné : le rendu est procédural. Toitures à pans réservées aux emprises rectangulaires.",
        "game": "adapter",
    },
    "interior": {
        "label": "Intérieur", "implemented": True, "representation": "assembly", "representations": ["assembly"],
        "description": "Plan sur grille de tuiles : pièces, portes, mobilier, point d'apparition, zones interdites.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": N, "variants": N, "import": N,
                         "export": A, "behaviors": A, "publish": A, "assembly": A},
        "limits": "Un seul niveau. Un intérieur ne se place pas en ville : il s'associe à un bâtiment.",
        "game": "adapter",
    },
    "road": {
        "label": "Segment routier", "implemented": True, "representation": "segment", "representations": ["segment"],
        "description": "Segment carré connectable : droite, virages, T, croix, extrémité, rampe.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": N,
                         "export": A, "behaviors": N, "publish": A, "assembly": N},
        "limits": "Pas de circulation simulée dans l'atelier.",
        "game": "unavailable",
    },
    "surface": {
        "label": "Surface / terrain", "implemented": True, "representation": "surface", "representations": ["surface"],
        "description": "Revêtement au sol (pelouse, sable, eau, pavés, parking) qui change le terrain sous lui.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": X,
                         "export": A, "behaviors": N, "publish": A, "assembly": N},
        "limits": "Emprise rectangulaire ou case par case ; texture importée affichée en motif répété (expérimental).",
        "game": "unavailable",
    },
    "prop": {
        "label": "Mobilier urbain, végétation, décor", "implemented": True, "representation": "procedural",
        "representations": ["procedural", "sprite"],
        "description": "Objet posé en ville : forme procédurale (arbre, lampadaire, banc…) ou image importée.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": A,
                         "export": A, "behaviors": A, "publish": A, "assembly": N},
        "limits": "Sprite : une seule vue (pas de rendu par angle de rotation).",
        "game": "unavailable",
    },
    "furniture": {
        "label": "Meuble d'intérieur", "implemented": True, "representation": "procedural",
        "representations": ["procedural", "sprite"],
        "description": "Meuble posé dans un intérieur, avec une action déclarative reconnue par le moteur.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": A,
                         "export": A, "behaviors": A, "publish": A, "assembly": N},
        "limits": "Se place dans un intérieur (éditeur de plan), pas en ville.",
        "game": "unavailable",
    },
    "vehicle": {
        "label": "Véhicule", "implemented": True, "representation": "procedural", "representations": ["procedural", "sprite"],
        "description": "Véhicule stationné : carrosserie procédurale (voiture, taxi, gbaka, bus, moto…) ou image importée.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": A,
                         "export": A, "behaviors": X, "publish": A, "assembly": N},
        "limits": "Aucune conduite, trajectoire ni animation de roues : le moteur ne les prend pas en charge.",
        "game": "unavailable",
    },
    "character": {
        "label": "Personnage", "implemented": True, "representation": "svg", "representations": ["svg"],
        "description": "Habitant composé de calques SVG (corps, visage, coiffure, vêtements, accessoires, motifs).",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": A, "variants": A, "import": A,
                         "export": A, "behaviors": X, "publish": A, "assembly": A},
        "limits": "Vue de face uniquement, aucune animation. Le jeu actuel (3D) n'en reprend que la teinte de peau, "
                  "la couleur du haut et le type de coiffure.",
        "game": "adapter",
    },
    "character_part": {
        "label": "Composant de personnage", "implemented": True, "representation": "svg", "representations": ["svg"],
        "description": "Calque SVG réutilisable (coiffure, haut, chaussures, motif…) avec canaux de couleur et ancrage.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": N, "variants": N, "import": A,
                         "export": A, "behaviors": N, "publish": A, "assembly": A},
        "limits": "SVG assaini (pas de script, d'image externe ni de police) ; recoloration seulement via les canaux déclarés.",
        "game": "adapter",
    },
    "component": {
        "label": "Composant modulaire", "implemented": True, "representation": "svg", "representations": ["svg"],
        "description": "Pièce SVG réutilisable d'un kit (toiture, porte, roue, feuillage, coussin, bordure…) avec canaux de couleur et ancrage.",
        "capabilities": {"create": A, "edit": A, "preview": A, "place": N, "variants": N, "import": A,
                         "export": A, "behaviors": N, "publish": A, "assembly": A},
        "limits": "SVG assaini ; une pièce appartient à un seul kit et s'accroche aux points d'ancrage de la base.",
        "game": "unavailable",
    },
}

# Représentation « modular » : assemblage déclaratif de composants SVG d'un kit (voir KITS), même principe que
# les personnages. Ajoutée aux familles visuelles ; les autres représentations restent disponibles.
for _f in ("building", "vehicle", "prop", "furniture", "surface"):
    FAMILIES[_f]["representations"].append("modular")
    FAMILIES[_f]["capabilities"]["assembly"] = A
FAMILIES["building"]["limits"] += " Assemblage modulaire SVG : vue de face uniquement."
for _f in ("vehicle", "prop", "furniture"):
    FAMILIES[_f]["limits"] += " Assemblage modulaire SVG : une seule vue, comme un sprite."

# Familles qui se placent dans une scène de test
PLACEABLE = {"building", "road", "surface", "prop", "vehicle", "character"}

# rules : identifiants de règles métier appliquées par validation._category_rules
CATEGORY_RULES = {
    "player_house": "Maison de joueur : attribuable et avec au moins un intérieur",
    "shop_required": "Commerce : façade commerciale obligatoire",
    "service_entrance_recommended": "Entrée de service ou d'urgence recommandée",
    "road_access_required": "Accès routier obligatoire",
}

# Matériaux attendus par famille (emplacements de couleur)
MATERIAL_SLOTS = {
    "building": ["wall", "roof", "trim"],
    "interior": ["floor", "wall"],
    "road": ["asphalt", "marking", "sidewalk"],
    "surface": ["base", "detail"],
    "prop": ["primary", "secondary"],
    "furniture": ["primary", "secondary"],
    "vehicle": ["body", "trim", "glass"],
    "character": [],
    "character_part": [],
    "component": [],
}
SLOT_LABELS = {"wall": "Murs", "roof": "Toiture", "trim": "Menuiseries et bordures", "floor": "Sol", "asphalt": "Chaussée",
               "marking": "Marquage", "sidewalk": "Trottoir", "base": "Couleur de base", "detail": "Couleur de détail",
               "primary": "Couleur principale", "secondary": "Couleur secondaire", "body": "Carrosserie",
               "glass": "Vitres"}

_S = lambda *a: list(a)  # noqa: E731

DEFAULT_CATEGORIES = [
    {"key": "residential", "label": "Habitations", "family": "building", "rules": ["player_house"],
     "subcategories": _S("Maison de joueur", "Maison économique", "Maison moderne", "Maison traditionnelle",
                         "Maison haut de gamme", "Villa", "Immeuble résidentiel", "Studio", "Résidence universitaire",
                         "Logement social", "Maison en construction", "Bâtiment abandonné")},
    {"key": "commerce", "label": "Commerce et activités", "family": "building", "rules": ["shop_required"],
     "subcategories": _S("Boutique de quartier", "Supermarché", "Marché couvert", "Restaurant", "Maquis", "Café",
                         "Boulangerie", "Salon de coiffure", "Pressing", "Atelier de réparation", "Quincaillerie",
                         "Banque", "Agence de transfert d'argent", "Coworking", "Hôtel", "Entrepôt")},
    {"key": "health", "label": "Santé", "family": "building", "rules": ["service_entrance_recommended"],
     "subcategories": _S("CHU", "Hôpital général", "Clinique privée", "Centre de santé", "Dispensaire",
                         "Pharmacie", "Laboratoire", "Cabinet médical", "Cabinet dentaire")},
    {"key": "education", "label": "Éducation et formation", "family": "building", "rules": [],
     "subcategories": _S("École primaire publique", "École primaire privée", "Collège", "Lycée", "Université",
                         "Grande école", "Centre de formation", "Bibliothèque", "Crèche")},
    {"key": "security", "label": "Sécurité et secours", "family": "building", "rules": ["service_entrance_recommended"],
     "subcategories": _S("Commissariat", "Poste de police", "Caserne de sapeurs-pompiers", "Centre de secours",
                         "Poste de contrôle")},
    {"key": "community", "label": "Religion et lieux communautaires", "family": "building", "rules": [],
     "subcategories": _S("Église", "Mosquée", "Salle de prière", "Centre communautaire", "Centre culturel",
                         "Maison de quartier")},
    {"key": "utilities", "label": "Énergie, eau et services techniques", "family": "building", "rules": [],
     "subcategories": _S("Station-service", "Transformateur", "Château d'eau", "Station de pompage",
                         "Centre de collecte des déchets", "Antenne télécom")},
    {"key": "public", "label": "Administration et institutions", "family": "building", "rules": [],
     "subcategories": _S("Mairie", "Préfecture", "Tribunal", "Bureau de poste", "Centre d'état civil")},
    {"key": "leisure", "label": "Loisirs et tourisme", "family": "building", "rules": [],
     "subcategories": _S("Cinéma", "Théâtre", "Musée", "Gymnase", "Salle de sport", "Stade")},
    {"key": "transport_hub", "label": "Transport", "family": "building", "rules": ["road_access_required"],
     "subcategories": _S("Gare routière", "Station de taxis", "Gare de gbakas", "Embarcadère")},
    {"key": "construction", "label": "Construction et développement", "family": "building", "rules": [],
     "subcategories": _S("Chantier", "Bâtiment en construction", "Ruine")},
    {"key": "interior", "label": "Intérieurs", "family": "interior", "rules": [],
     "subcategories": _S("Logement", "Commerce", "Bureau", "Salle de classe", "Médical", "Accueil")},
    {"key": "road", "label": "Voirie", "family": "road", "rules": [],
     "subcategories": _S("Rue résidentielle", "Route 2 voies", "Route 3 voies", "Avenue", "Boulevard",
                         "Sens unique", "Rue piétonne")},
    {"key": "paving", "label": "Places, parkings et trottoirs", "family": "surface", "rules": [],
     "subcategories": _S("Place", "Parking", "Trottoir", "Cour", "Terrain de sport")},
    {"key": "nature", "label": "Espaces naturels et aquatiques", "family": "surface", "rules": [],
     "subcategories": _S("Pelouse", "Plage", "Lagune", "Piscine", "Terre battue")},
    {"key": "urban_furniture", "label": "Mobilier urbain", "family": "prop", "rules": [],
     "subcategories": _S("Lampadaire", "Banc", "Poubelle", "Panneau", "Clôture", "Abribus", "Borne", "Kiosque")},
    {"key": "vegetation", "label": "Végétation", "family": "prop", "rules": [],
     "subcategories": _S("Arbre", "Palmier", "Buisson", "Plante", "Massif fleuri")},
    {"key": "decoration", "label": "Décoration", "family": "prop", "rules": [],
     "subcategories": _S("Fontaine", "Statue", "Jarre", "Guirlande", "Étal")},
    {"key": "furniture_home", "label": "Mobilier de maison", "family": "furniture", "rules": [],
     "subcategories": _S("Lit", "Canapé", "Fauteuil", "Table", "Chaise", "Bureau", "Armoire", "Télévision",
                         "Réfrigérateur", "Cuisine", "Sanitaires", "Douche", "Lampe", "Plante")},
    {"key": "furniture_shop", "label": "Mobilier commercial", "family": "furniture", "rules": [],
     "subcategories": _S("Comptoir", "Étagère", "Vitrine réfrigérée", "Caisse")},
    {"key": "furniture_school", "label": "Équipement scolaire", "family": "furniture", "rules": [],
     "subcategories": _S("Pupitre", "Tableau", "Bureau du maître")},
    {"key": "furniture_medical", "label": "Mobilier médical", "family": "furniture", "rules": [],
     "subcategories": _S("Lit médical", "Table d'examen", "Armoire à pharmacie", "Paravent")},
    {"key": "vehicles", "label": "Véhicules et transports", "family": "vehicle", "rules": [],
     "subcategories": _S("Voiture", "Taxi", "Gbaka", "Wôrô-wôrô", "Autobus", "Moto", "Vélo", "Utilitaire",
                         "Véhicule de secours")},
    {"key": "characters", "label": "Habitants", "family": "character", "rules": [],
     "subcategories": _S("Habitant", "Commerçant", "Personnel de santé", "Élève", "Agent public", "PNJ de mission")},
    {"key": "character_parts", "label": "Composants de personnage", "family": "character_part", "rules": [],
     "subcategories": []},
    {"key": "kit_components", "label": "Composants modulaires", "family": "component", "rules": [],
     "subcategories": _S("Bâtiment", "Véhicule", "Végétation", "Mobilier urbain", "Meuble", "Surface")},
]

CATEGORIES: list[dict] = []
CATEGORY_BY_KEY: dict[str, dict] = {}


def _row_to_cat(r) -> dict:
    return {"key": r["key"], "label": r["label"], "family": r["family"], "rules": json.loads(r["rules"]),
            "subcategories": json.loads(r["subcategories"]), "description": r["description"],
            "builtin": bool(r["builtin"]), "archived": bool(r["archived"]), "position": r["position"]}


def seed_categories(conn: sqlite3.Connection) -> None:
    """Ajoute les catégories par défaut absentes (n'écrase jamais une catégorie modifiée)."""
    now = time.time()
    for i, c in enumerate(DEFAULT_CATEGORIES):
        conn.execute("INSERT OR IGNORE INTO categories (key, label, family, rules, subcategories, description, builtin, archived, position, created_at, updated_at) "
                     "VALUES (?,?,?,?,?,?,1,0,?,?,?)",
                     (c["key"], c["label"], c["family"], json.dumps(c["rules"]), json.dumps(c["subcategories"], ensure_ascii=False),
                      c.get("description", ""), i * 10, now, now))
    conn.commit()


def reload(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT * FROM categories ORDER BY position, label").fetchall()
    CATEGORIES[:] = [_row_to_cat(r) for r in rows]
    CATEGORY_BY_KEY.clear()
    CATEGORY_BY_KEY.update({c["key"]: c for c in CATEGORIES})


# ---------------------------------------------------------------- mobilier d'intérieur intégré
# Meubles de base (rétrocompatibles avec le prototype). Les meubles créés dans l'atelier (famille
# « furniture ») s'y ajoutent par leur identifiant d'asset.
FURNITURE = {
    "bed": {"label": "Lit", "w": 2, "d": 3, "actions": ["sleep"], "color": "#8e6fb5", "h": 7},
    "sofa": {"label": "Canapé", "w": 3, "d": 1, "actions": ["sit"], "color": "#c0623b", "h": 9},
    "armchair": {"label": "Fauteuil", "w": 1, "d": 1, "actions": ["sit"], "color": "#c0623b", "h": 9},
    "table": {"label": "Table", "w": 2, "d": 2, "actions": ["eat"], "color": "#a07a4a", "h": 10},
    "chair": {"label": "Chaise", "w": 1, "d": 1, "actions": ["sit"], "color": "#a07a4a", "h": 9},
    "kitchen": {"label": "Cuisine", "w": 3, "d": 1, "actions": ["cook"], "color": "#d9d4c7", "h": 13},
    "fridge": {"label": "Réfrigérateur", "w": 1, "d": 1, "actions": ["store"], "color": "#e9eef2", "h": 24},
    "shower": {"label": "Douche", "w": 1, "d": 1, "actions": ["wash"], "color": "#7fb7d6", "h": 26},
    "wc": {"label": "WC", "w": 1, "d": 1, "actions": ["use"], "color": "#f1f1f1", "h": 6},
    "desk": {"label": "Bureau", "w": 2, "d": 1, "actions": ["work"], "color": "#6b4f35", "h": 10},
    "wardrobe": {"label": "Armoire", "w": 2, "d": 1, "actions": ["store"], "color": "#5a4632", "h": 26},
    "tv": {"label": "Télévision", "w": 2, "d": 1, "actions": ["watch"], "color": "#2b2b2b", "h": 8},
    "counter": {"label": "Comptoir", "w": 3, "d": 1, "actions": ["shop"], "color": "#b5833f", "h": 12},
    "shelf": {"label": "Étagère", "w": 2, "d": 1, "actions": ["shop", "store"], "color": "#7d5d3b", "h": 22},
    "plant": {"label": "Plante", "w": 1, "d": 1, "actions": [], "color": "#3f8f4a", "h": 16},
    "lamp": {"label": "Lampe", "w": 1, "d": 1, "actions": [], "color": "#f2c94c", "h": 20},
}

INTERIOR_TILES_PER_CELL = 4  # une case extérieure = 4 × 4 tuiles d'intérieur

# ---------------------------------------------------------------- façades modulaires (assemblage)
# floors : "ground" = rez-de-chaussée seulement, "upper" = étages seulement, "any".
FACADE_MODULES = {
    "auto": {"label": "Automatique (style du bâtiment)", "floors": "any"},
    "blank": {"label": "Mur plein", "floors": "any"},
    "window": {"label": "Fenêtre", "floors": "any"},
    "window_band": {"label": "Baie vitrée", "floors": "any"},
    "shutters": {"label": "Fenêtre à persiennes", "floors": "any"},
    "claustra": {"label": "Claustra (ventilation)", "floors": "any"},
    "balcony": {"label": "Balcon", "floors": "upper"},
    "door": {"label": "Porte", "floors": "ground"},
    "shopfront": {"label": "Vitrine", "floors": "ground"},
    "garage": {"label": "Porte de garage", "floors": "ground"},
}

# ---------------------------------------------------------------- formes procédurales
PROP_SHAPES = {
    "tree": {"label": "Arbre", "w": 1, "d": 1, "h": 6},
    "palm": {"label": "Palmier", "w": 1, "d": 1, "h": 8},
    "bush": {"label": "Buisson", "w": 1, "d": 1, "h": 1.2},
    "flowerbed": {"label": "Massif fleuri", "w": 2, "d": 1, "h": 0.6},
    "lamp_post": {"label": "Lampadaire", "w": 1, "d": 1, "h": 5},
    "bench": {"label": "Banc", "w": 2, "d": 1, "h": 1},
    "bin": {"label": "Poubelle", "w": 1, "d": 1, "h": 1},
    "sign": {"label": "Panneau", "w": 1, "d": 1, "h": 2.5},
    "fence": {"label": "Clôture", "w": 3, "d": 1, "h": 1.5},
    "bus_stop": {"label": "Abribus", "w": 3, "d": 1, "h": 2.6},
    "kiosk": {"label": "Kiosque", "w": 2, "d": 2, "h": 2.8},
    "box": {"label": "Volume simple", "w": 1, "d": 1, "h": 1},
}
FURNITURE_SHAPES = {"box": "Bloc", "bed": "Lit", "table": "Table", "seat": "Assise", "cabinet": "Meuble haut",
                    "counter": "Comptoir", "plant": "Plante", "screen": "Écran", "lamp": "Lampe"}
VEHICLE_KINDS = {
    "car": {"label": "Voiture", "w": 1, "d": 2, "h": 1.5},
    "taxi": {"label": "Taxi", "w": 1, "d": 2, "h": 1.5},
    "gbaka": {"label": "Gbaka (minibus)", "w": 1, "d": 3, "h": 2.3},
    "bus": {"label": "Autobus", "w": 2, "d": 5, "h": 3.2},
    "moto": {"label": "Moto", "w": 1, "d": 1, "h": 1.2},
    "bike": {"label": "Vélo", "w": 1, "d": 1, "h": 1.1},
    "utility": {"label": "Utilitaire", "w": 1, "d": 3, "h": 2.4},
    "emergency": {"label": "Véhicule de secours", "w": 1, "d": 3, "h": 2.6},
}
SURFACE_KINDS = {
    "grass": {"label": "Pelouse", "terrain": "ground"},
    "sand": {"label": "Sable", "terrain": "sand"},
    "water": {"label": "Eau", "terrain": "water"},
    "pool": {"label": "Piscine", "terrain": "water"},
    "paving": {"label": "Pavés", "terrain": "ground"},
    "parking": {"label": "Parking", "terrain": "ground"},
    "dirt": {"label": "Terre battue", "terrain": "ground"},
}

# ---------------------------------------------------------------- personnages modulaires
# Repère commun des composants : viewBox 0 0 200 380, axe vertical x = 100, pieds vers y = 365.
CHARACTER_FRAME = [0, 0, 200, 380]
# z : ordre de rendu par défaut ; back_z : calque arrière (cheveux derrière la tête, sac à dos…)
CHARACTER_SLOTS = {
    "body": {"label": "Corps", "z": 10, "back_z": 0, "required": True},
    "bottom": {"label": "Bas (pantalon, short, jupe)", "z": 30, "back_z": 0},
    "dress": {"label": "Robe ou boubou", "z": 34, "back_z": 0},
    "shoes": {"label": "Chaussures", "z": 36, "back_z": 0},
    "top": {"label": "Haut (t-shirt, chemise)", "z": 40, "back_z": 0},
    "outerwear": {"label": "Veste et surcouche", "z": 46, "back_z": 0},
    "eyes": {"label": "Yeux", "z": 52, "back_z": 0},
    "eyebrows": {"label": "Sourcils", "z": 54, "back_z": 0},
    "nose": {"label": "Nez", "z": 53, "back_z": 0},
    "mouth": {"label": "Bouche et expression", "z": 55, "back_z": 0},
    "beard": {"label": "Barbe et moustache", "z": 56, "back_z": 0},
    "makeup": {"label": "Maquillage", "z": 57, "back_z": 0},
    "hair": {"label": "Coiffure", "z": 60, "back_z": 2},
    "hair_accessory": {"label": "Accessoire capillaire", "z": 62, "back_z": 0},
    "glasses": {"label": "Lunettes", "z": 64, "back_z": 0},
    "headwear": {"label": "Chapeau, casquette, foulard", "z": 66, "back_z": 1},
    "jewelry": {"label": "Bijoux", "z": 58, "back_z": 0},
    "watch": {"label": "Montre", "z": 48, "back_z": 0},
    "bag": {"label": "Sac", "z": 50, "back_z": 1},
    "pattern": {"label": "Motif (tuile répétée)", "z": 0, "back_z": 0},
}
# Couleurs globales d'un personnage (partagées par tous ses calques) et couleurs propres à un calque.
GLOBAL_CHANNELS = ["skin", "hair", "eyes"]
LAYER_CHANNELS = ["primary", "secondary", "accent"]
BODY_ANCHORS = ["head_top", "eyes", "mouth", "neck", "shoulders", "waist", "feet", "wrist_left", "wrist_right", "ears"]
# Position des ancrages sur le corps de référence. Un calque accroché à « eyes » est dessiné pour ce corps ;
# sur un autre corps, il est décalé de (ancrage du corps − ancrage de référence).
REFERENCE_ANCHORS = {"head_top": [100, 22], "eyes": [100, 62], "mouth": [100, 84], "neck": [100, 108],
                     "shoulders": [100, 124], "waist": [100, 224], "feet": [100, 362], "wrist_left": [50, 246],
                     "wrist_right": [150, 246], "ears": [100, 66]}
REQUIRED_BODY_ANCHORS = ["eyes", "neck", "shoulders", "waist", "feet"]
# Genre d'une silhouette (corps) ; un composant peut être réservé à un genre (rouge à lèvres, talons, barbe…).
GENDERS = {"male": "Homme", "female": "Femme"}
GAME_HAIR = ["short", "afro", "braids", "bald"]  # coiffures du jeu actuel (backend/game/services/state.py)

# ---------------------------------------------------------------- kits modulaires (hors personnages)
# Même principe que les personnages : une BASE (structure, carrosserie, tronc, meuble, sol) qui déclare des
# points d'ancrage, et des composants indépendants qui s'y accrochent. Aucune combinaison n'est dessinée.
#  - frame : repère commun des composants (viewBox) ; ground : ligne du sol (vue de face) ; view : front | top
#  - globals : couleurs partagées par toutes les pièces (canal --babi-<nom>) ; les pièces ont en plus
#    leurs couleurs propres primary / secondary / accent
#  - anchors : position de référence de chaque point d'ancrage (là où les pièces sont dessinées). Une base
#    déclare pour chaque point une LISTE de positions : la pièce est dessinée une fois par position (fenêtres
#    par étage, roues par essieu, coussins par place…). Point absent de la base = pièce incompatible.
#  - pattern_slots : emplacements dont la couleur principale peut recevoir un motif
#  - random : probabilité d'un emplacement facultatif dans le générateur
KITS = {
    "building": {
        "label": "Façades de bâtiment", "family": "building", "frame": [0, 0, 200, 280], "ground": 270, "view": "front",
        "description": "Façade vue de face : structure (1 à 4 niveaux), toiture, portes, fenêtres par étage, vitrines, auvents, enseignes, équipements.",
        "globals": {"trim": {"label": "Menuiseries", "default": "#2f5d62"}, "glass": {"label": "Vitrages", "default": "#9cc8d6"}},
        "slots": {
            "base": {"label": "Structure (murs et niveaux)", "z": 10, "required": True},
            "roof": {"label": "Toiture", "z": 20, "anchor": "roof"},
            "rooftop": {"label": "Équipement de toit", "z": 22, "anchor": "rooftop"},
            "ground": {"label": "Rez-de-chaussée (fenêtres, vitrine)", "z": 30, "anchor": "ground"},
            "windows": {"label": "Fenêtres d'étage", "z": 30, "anchor": "floors"},
            "door": {"label": "Porte d'entrée", "z": 32, "required": True, "anchor": "door"},
            "balcony": {"label": "Balcon", "z": 36, "anchor": "floors"},
            "wall_extra": {"label": "Équipement mural", "z": 38, "anchor": "wall_side"},
            "awning": {"label": "Auvent", "z": 44, "anchor": "awning"},
            "sign": {"label": "Enseigne", "z": 46, "anchor": "sign"},
            "front": {"label": "Clôture et abords", "z": 60, "anchor": "front"},
            "greenery": {"label": "Plantes devant la façade", "z": 62, "anchor": "front"},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {"roof": [100, 210], "rooftop": [100, 210], "door": [100, 270], "ground": [100, 270], "floors": [100, 210],
                    "sign": [100, 219], "awning": [100, 228], "wall_side": [158, 250], "front": [100, 270]},
        "required_anchors": ["roof", "door", "ground"],
        "pattern_slots": ["base", "awning", "front"],
        "random": {"roof": 0.92, "ground": 1, "windows": 1, "balcony": 0.3, "wall_extra": 0.3, "awning": 0.35, "sign": 0.3,
                   "rooftop": 0.35, "front": 0.3, "greenery": 0.35},
    },
    "vehicle": {
        "label": "Véhicules", "family": "vehicle", "frame": [0, 0, 240, 140], "ground": 130, "view": "front",
        "description": "Véhicule vu de profil (avant à droite) : carrosserie, roues par essieu, livrée, phares, pare-chocs, toit, chargement.",
        "globals": {"glass": {"label": "Vitres", "default": "#9cc8d6"}, "chrome": {"label": "Chromes et jantes", "default": "#c8ced3"}},
        "slots": {
            "base": {"label": "Carrosserie", "z": 10, "required": True},
            "livery": {"label": "Livrée (bande, damier)", "z": 14, "anchor": "side"},
            "decal": {"label": "Autocollant", "z": 16, "anchor": "side"},
            "wheels": {"label": "Roues", "z": 30, "required": True, "anchor": "wheels"},
            "bumper": {"label": "Pare-chocs avant", "z": 32, "anchor": "front"},
            "rear": {"label": "Arrière (feux, roue de secours)", "z": 33, "anchor": "rear"},
            "lights": {"label": "Phares", "z": 34, "anchor": "front"},
            "roof": {"label": "Toit (galerie, enseigne, gyrophare)", "z": 40, "anchor": "roof"},
            "cargo": {"label": "Chargement sur le toit", "z": 42, "anchor": "roof"},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {"wheels": [62, 116], "roof": [120, 62], "front": [222, 104], "rear": [18, 104], "side": [120, 104]},
        "required_anchors": ["wheels", "front", "rear", "side"],
        "pattern_slots": ["base", "livery"],
        "random": {"livery": 0.4, "decal": 0.25, "bumper": 0.45, "lights": 1, "rear": 0.5, "roof": 0.35, "cargo": 0.3},
    },
    "vegetation": {
        "label": "Végétation", "family": "prop", "frame": [0, 0, 160, 220], "ground": 210, "view": "front",
        "description": "Arbres, palmiers et massifs : tronc, feuillage, fleurs ou fruits, bac ou pied d'arbre, couvre-sol.",
        "globals": {"leaf": {"label": "Feuillage", "default": "#3f8f4a"}, "bark": {"label": "Écorce", "default": "#7a5236"}},
        "slots": {
            "base": {"label": "Tronc ou tige", "z": 10, "required": True},
            "canopy": {"label": "Feuillage", "z": 20, "required": True, "anchor": "crown"},
            "blossom": {"label": "Fleurs ou fruits", "z": 30, "anchor": "crown"},
            "planter": {"label": "Bac, pot ou pied d'arbre", "z": 40, "anchor": "ground"},
            "ground_cover": {"label": "Couvre-sol", "z": 44, "anchor": "ground"},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {"crown": [80, 110], "ground": [80, 210]},
        "required_anchors": ["crown", "ground"],
        "pattern_slots": ["planter"],
        "random": {"blossom": 0.35, "planter": 0.4, "ground_cover": 0.45},
    },
    "street": {
        "label": "Mobilier urbain et étals", "family": "prop", "frame": [0, 0, 160, 220], "ground": 210, "view": "front",
        "description": "Lampadaires, panneaux, bancs, abribus et étals de marché : structure, tête, toit ou parasol, assise, marchandises, accessoires.",
        "globals": {"metal": {"label": "Métal", "default": "#4a5560"}, "wood": {"label": "Bois", "default": "#a0703c"}},
        "slots": {
            "base": {"label": "Structure", "z": 10, "required": True},
            "head": {"label": "Tête (lanterne, panneau)", "z": 30, "anchor": "head"},
            "canopy": {"label": "Toit ou parasol", "z": 40, "anchor": "canopy"},
            "seat": {"label": "Assise", "z": 24, "anchor": "seat"},
            "goods": {"label": "Marchandises", "z": 34, "anchor": "counter"},
            "attachment": {"label": "Accessoire accroché", "z": 28, "anchor": "mid"},
            "ground": {"label": "Objet au sol", "z": 50, "anchor": "side"},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {"head": [80, 40], "mid": [80, 130], "seat": [80, 172], "counter": [80, 160], "canopy": [80, 60],
                    "side": [128, 210]},
        "required_anchors": ["side"],
        "pattern_slots": ["canopy"],
        "random": {"head": 0.9, "canopy": 0.7, "seat": 0.9, "goods": 0.85, "attachment": 0.3, "ground": 0.35},
    },
    "furniture": {
        "label": "Meubles", "family": "furniture", "frame": [0, 0, 200, 160], "ground": 150, "view": "front",
        "description": "Meubles vus de face : structure, pieds, coussins par place, literie, poignées, plaid, objet posé.",
        "globals": {"wood": {"label": "Bois", "default": "#8b5a33"}, "metal": {"label": "Métal", "default": "#6b7378"}},
        "slots": {
            "base": {"label": "Structure du meuble", "z": 10, "required": True},
            "legs": {"label": "Pieds", "z": 8, "anchor": "legs"},
            "cushion": {"label": "Coussins (par place)", "z": 30, "anchor": "seat"},
            "bedding": {"label": "Literie", "z": 30, "anchor": "bed"},
            "throw": {"label": "Plaid ou pagne", "z": 34, "anchor": "throw"},
            "handles": {"label": "Poignées", "z": 32, "anchor": "front"},
            "top_item": {"label": "Objet posé", "z": 40, "anchor": "top"},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {"legs": [60, 150], "seat": [100, 104], "bed": [100, 108], "throw": [100, 104], "front": [100, 120],
                    "top": [100, 90]},
        "required_anchors": [],
        "pattern_slots": ["base", "cushion", "bedding", "throw"],
        "random": {"legs": 0.9, "cushion": 0.95, "bedding": 1, "throw": 0.3, "handles": 1, "top_item": 0.6},
    },
    "surface": {
        "label": "Surfaces et sols", "family": "surface", "frame": [0, 0, 200, 200], "ground": 200, "view": "top",
        "description": "Tuile de sol vue de dessus, répétée sur l'emprise : revêtement, motif, détails, marquage, bordure.",
        "globals": {"line": {"label": "Marquage", "default": "#f4f1e8"}, "stone": {"label": "Bordures", "default": "#b9b4a8"}},
        "slots": {
            "base": {"label": "Revêtement", "z": 10, "required": True},
            "details": {"label": "Détails (touffes, cailloux, feuilles)", "z": 30},
            "marking": {"label": "Marquage au sol", "z": 35},
            "edging": {"label": "Bordure", "z": 40},
            "pattern": {"label": "Motif (tuile répétée)", "z": 0},
        },
        "anchors": {},
        "required_anchors": [],
        "pattern_slots": ["base"],
        "random": {"details": 0.6, "marking": 0.25, "edging": 0.4},
    },
}
KIT_FAMILIES = {k: v["family"] for k, v in KITS.items()}
MODULAR_FAMILIES = {"building", "vehicle", "prop", "furniture", "surface"}
KIT_CHANNELS = sorted({g for k in KITS.values() for g in k["globals"]})


def catalog_payload() -> dict:
    return {
        "families": FAMILIES, "categories": CATEGORIES, "category_rules": CATEGORY_RULES,
        "material_slots": MATERIAL_SLOTS, "slot_labels": SLOT_LABELS, "furniture": FURNITURE,
        "interior_tiles_per_cell": INTERIOR_TILES_PER_CELL, "facade_modules": FACADE_MODULES,
        "prop_shapes": PROP_SHAPES, "furniture_shapes": FURNITURE_SHAPES, "vehicle_kinds": VEHICLE_KINDS,
        "surface_kinds": SURFACE_KINDS, "character_slots": CHARACTER_SLOTS, "character_frame": CHARACTER_FRAME,
        "global_channels": GLOBAL_CHANNELS, "layer_channels": LAYER_CHANNELS, "body_anchors": BODY_ANCHORS,
        "reference_anchors": REFERENCE_ANCHORS, "kits": KITS, "genders": GENDERS,
        "placeable": sorted(PLACEABLE),
    }
