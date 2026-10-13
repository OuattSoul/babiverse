"""Règles du jeu centralisées.

Toutes les valeurs d'équilibrage (prix, salaires, vitesses des besoins, missions...)
vivent ici. Le serveur est la seule source de vérité : le client récupère une copie
publique de ces règles via GET /api/config pour l'affichage et la prédiction locale.
"""

import json
from pathlib import Path

from django.conf import settings

from game import maps

CONFIG_VERSION = 2

# Données de la ville partagées avec le client (parcelles, panneaux, bâtiments constructibles).
SHARED = Path(__file__).resolve().parents[2] / "shared"
CITY = json.loads((SHARED / "city.json").read_text(encoding="utf-8"))
PLOTS = {p["id"]: p for p in CITY["plots"]}
AD_SLOTS = {a["id"]: a for a in CITY["ad_slots"]}
PLAYER_BUILDINGS = CITY["player_buildings"]
PLOT_PRICE = CITY["plot_price"]
MAX_PLOTS_PER_PLAYER = CITY["max_plots_per_player"]
AD_RENTAL = CITY["ad_rental"]
# Lotissement des maisons initiales (attribution automatique, voir services/homes.py).
RESIDENTIAL = CITY["residential"]
# Annonces de démonstration et affectation des emplacements (statuts free, reserved, active, disabled).
ADS = json.loads((SHARED / "ads.json").read_text(encoding="utf-8"))
AD_PLACEMENTS = ADS["placements"]
ADVERTS = ADS["adverts"]

# Zones connues du serveur = cartes publiées du catalogue shared/maps.json (voir game/maps.py ; la géométrie
# vit côté client, client/src/world/maps.js). Carte historique : ("quartier", "maison", "epicerie").
ZONES = maps.published_ids()
# Intérieurs des bâtiments de la ville (int_<bâtiment>, int_pb_<parcelle>), générés par le client.
INTERIOR_ZONE_RE = maps.interior_pattern()


def zone_known(zone):
    """Carte intégrée publiée, intérieur généré, ou carte publiée par l'atelier (pack de jeu en vigueur)."""
    if zone in ZONES or (isinstance(zone, str) and bool(INTERIOR_ZONE_RE.match(zone))):
        return True
    return isinstance(zone, str) and zone in maps.atelier_maps()
START_ZONE = maps.CATALOGUE["start_map"]  # "maison"

TIME = {
    # Une journée virtuelle = 24 heures réelles, fuseau d'Abidjan (UTC+0).
    "timezone": "Africa/Abidjan",
    # Les revenus passifs ne s'accumulent pas au-delà de 3 jours virtuels.
    "offline_passive_cap_hours": 72,
}

NEEDS = {
    "min": 0,
    "max": 100,
    "start": {"hunger": 30, "energy": 70},
    # Variation pendant le temps de jeu actif.
    "hunger_per_minute": 1.2,
    "energy_per_minute": 0.8,
    # Au-delà de cet écart entre deux requêtes, le joueur est considéré absent :
    # seules ces secondes sont comptées, les besoins sont donc suspendus hors ligne.
    "max_active_gap_seconds": 120,
    # Seuils au-delà desquels le travail est refusé.
    "work_min_energy": 20,
    "work_max_hunger": 85,
    # Seuil purement client : en dessous, le personnage marche plus lentement.
    "tired_threshold": 15,
}

REST = {
    "zone": "maison",
    "energy_gain": 45,
    "hunger_cost": 4,
    "cooldown_seconds": 90,
}

ITEMS = {
    "pain": {"name": "Pain", "category": "food", "effects": {"hunger": -15}},
    "sachet_eau": {"name": "Sachet d'eau", "category": "food", "effects": {"hunger": -3, "energy": 3}},
    "cafe_touba": {"name": "Café Touba", "category": "food", "effects": {"hunger": -2, "energy": 12}},
    "sardines": {"name": "Boîte de sardines", "category": "food", "effects": {"hunger": -25}},
    "garba": {"name": "Garba (attiéké-thon)", "category": "food", "effects": {"hunger": -45, "energy": 5}},
    "alloco": {"name": "Alloco", "category": "food", "effects": {"hunger": -25}},
    "casier_boissons": {
        "name": "Casier de boissons (12)",
        "category": "stock",
        "effects": {},
        "stock_units": 12,
    },
    "cahier": {"name": "Cahier de cours", "category": "misc", "effects": {}},
    "caisse_outils": {"name": "Caisse à outils", "category": "misc", "effects": {}},
    "carnet_comptes": {"name": "Carnet de comptes", "category": "misc", "effects": {}},
}

SHOPS = {
    "epicerie": {
        "name": "Épicerie Chez Fofana",
        "zone": "epicerie",
        # Le stock est réapprovisionné chaque jour virtuel.
        "items": {
            "pain": {"price": 150, "daily_stock": 20},
            "sachet_eau": {"price": 50, "daily_stock": 40},
            "cafe_touba": {"price": 200, "daily_stock": 15},
            "sardines": {"price": 450, "daily_stock": 8},
            "casier_boissons": {"price": 1800, "daily_stock": 5},
        },
    },
    "garba": {
        "name": "Garba de Tantie Adjoua",
        "zone": "quartier",
        "items": {
            "garba": {"price": 500, "daily_stock": 10},
            "alloco": {"price": 300, "daily_stock": 10},
        },
    },
}

PROFILES = {
    "etudiant": {
        "label": "Étudiant",
        "description": "Peu d'argent, mais tout le temps d'apprendre le quartier.",
        "goal": "Financer tes fournitures puis lancer ton premier petit commerce.",
        "balance": 4000,
        "items": {"pain": 2, "cahier": 1},
        "wage_multiplier": 1.0,
        "business_cost_multiplier": 1.0,
    },
    "salarie": {
        "label": "Salarié",
        "description": "Un salaire modeste et quelques économies de départ.",
        "goal": "Faire fructifier tes économies avec une activité à côté.",
        "balance": 8000,
        "items": {"cafe_touba": 2},
        "wage_multiplier": 1.0,
        "business_cost_multiplier": 1.0,
    },
    "artisan": {
        "label": "Artisan",
        "description": "Habile de tes mains : les petits boulots paient mieux.",
        "goal": "Gagner la confiance du quartier et monter ton affaire.",
        "balance": 5000,
        "items": {"caisse_outils": 1},
        "wage_multiplier": 1.25,
        "business_cost_multiplier": 1.0,
    },
    "independant": {
        "label": "Travailleur indépendant",
        "description": "Débrouillard, tu enchaînes les missions rémunérées.",
        "goal": "Multiplier les sources de revenus.",
        "balance": 6000,
        "items": {"sachet_eau": 4},
        "wage_multiplier": 1.1,
        "business_cost_multiplier": 1.0,
    },
    "entrepreneur": {
        "label": "Entrepreneur débutant",
        "description": "Un petit capital et un réseau qui baisse tes coûts de lancement.",
        "goal": "Ouvrir ton kiosque au plus vite et le rendre rentable.",
        "balance": 9000,
        "items": {"carnet_comptes": 1},
        "wage_multiplier": 1.0,
        "business_cost_multiplier": 0.8,
        # Dispense de la condition « avoir terminé un premier travail ».
        "business_unlocked": True,
    },
}

JOBS = {
    "livraison": {
        "name": "Livraisons pour M. Diabaté",
        "employer": "diabate",
        "zone": "quartier",
        "base_wage": 1200,
        "energy_cost": 15,
        "hunger_cost": 8,
        "deliveries": 3,
        "targets": ["drop_maquis", "drop_epicerie", "drop_sud_1", "drop_sud_2"],
        # Garde-fous anti-triche : durée minimale d'un service et entre deux livraisons.
        "min_duration_seconds": 30,
        # Deux destinations voisines sont à ~2 s de marche : le délai reste en dessous.
        "min_seconds_between_deliveries": 1.5,
        # Un service non terminé expire : il ne se réalise pas hors ligne.
        "max_duration_seconds": 900,
        "max_shifts_per_day": 8,
    },
}

BUSINESS_TYPES = {
    "kiosque": {
        "name": "Kiosque à boissons",
        "zone": "quartier",
        "cost": 12000,
        "sale_price": 250,
        "stock_item": "casier_boissons",
        "max_stock": 48,
        # Vente active : le joueur sert lui-même les clients au kiosque.
        "min_seconds_between_sales": 4,
        # Vente passive : le voisinage achète un peu, même en ton absence.
        "passive_units_per_hour": 2,
        # Condition de déblocage (hors profil entrepreneur).
        "unlock_jobs_completed": 1,
    },
}

# Missions pilotées par événements. "requires" = missions à avoir récompensées.
MISSIONS = [
    {
        "id": "m_bienvenue", "title": "Bonjour le quartier",
        "description": "Va saluer Tonton Koffi, il connaît tout le monde ici.",
        "event": "talk_npc", "filter": {"npc": "koffi"}, "target": 1,
        "reward": 300, "requires": [], "giver": None, "auto_accept": True,
    },
    {
        "id": "m_courses", "title": "Les premières courses",
        "description": "Achète quelque chose à l'épicerie Chez Fofana.",
        "event": "purchase", "filter": {"shop": "epicerie"}, "target": 1,
        "reward": 300, "requires": ["m_bienvenue"], "giver": "koffi",
    },
    {
        "id": "m_manger", "title": "Ventre affamé n'a point d'oreilles",
        "description": "Mange quelque chose pour calmer ta faim.",
        "event": "consume", "filter": {"category": "food"}, "target": 1,
        "reward": 200, "requires": ["m_courses"], "giver": "koffi",
    },
    {
        "id": "m_sieste", "title": "Recharger les batteries",
        "description": "Fais une sieste dans ton lit, chez toi.",
        "event": "rest", "filter": {}, "target": 1,
        "reward": 200, "requires": ["m_bienvenue"], "giver": "koffi",
    },
    {
        "id": "m_livraison", "title": "Premier boulot",
        "description": "Termine un service de livraison pour M. Diabaté.",
        "event": "job_complete", "filter": {"job": "livraison"}, "target": 1,
        "reward": 500, "requires": ["m_bienvenue"], "giver": "diabate",
    },
    {
        "id": "m_epargne", "title": "Petit à petit l'oiseau fait son nid",
        "description": "Économise 12 000 F pour pouvoir lancer ton kiosque.",
        "event": "balance", "filter": {}, "target": 12000,
        "reward": 800, "requires": ["m_livraison"], "giver": "diabate",
    },
    {
        "id": "m_kiosque", "title": "Mon propre business",
        "description": "Ouvre ton kiosque à boissons sur l'emplacement libre près de la route.",
        "event": "business_open", "filter": {}, "target": 1,
        "reward": 1000, "requires": ["m_bienvenue"], "giver": "koffi",
    },
    {
        "id": "m_premiere_vente", "title": "Première vente",
        "description": "Sers ton premier client au kiosque.",
        "event": "sale", "filter": {}, "target": 1,
        "reward": 500, "requires": ["m_kiosque"], "giver": None, "auto_accept": True,
    },
    {
        "id": "m_dix_ventes", "title": "Le client est roi",
        "description": "Sers 10 clients au kiosque.",
        "event": "sale", "filter": {}, "target": 10,
        "reward": 1500, "requires": ["m_premiere_vente"], "giver": None, "auto_accept": True,
    },
]
MISSIONS += [
    {
        "id": "m_terrain", "title": "Propriétaire",
        "description": "Achète une parcelle libre du quartier (les panneaux jaunes « PARCELLE »).",
        "event": "plot_buy", "filter": {}, "target": 1,
        "reward": 1000, "requires": ["m_kiosque"], "giver": "koffi",
    },
    {
        "id": "m_construire", "title": "Bâtisseur",
        "description": "Construis un bâtiment sur ta parcelle.",
        "event": "plot_build", "filter": {}, "target": 1,
        "reward": 2000, "requires": ["m_terrain"], "giver": None, "auto_accept": True,
    },
]
MISSIONS_BY_ID = {m["id"]: m for m in MISSIONS}

NPCS = ("koffi", "aya", "fofana", "adjoua", "diabate", "ibrahim", "seydou", "fatou", "awa", "kouassi", "bamba")


# --- Rencontres entre joueurs (services/social.py) -------------------------------------
SOCIAL = {
    "poll_s": 2,              # boucle sociale du client : position, joueurs proches, notifications
    "call_poll_s": 1,         # pendant un appel (mise en relation plus rapide)
    "visible_s": 10,          # un joueur sans nouvelle depuis 10 s disparaît de la ville des autres
    "near_tiles": 3,          # distance d'affichage de la barre « Chatter / Appeler / Ajouter ami » (client)
    "reach_tiles": 5,         # distance acceptée par le serveur (marge : positions reçues toutes les 2 s)
    "call_ring_s": 30,        # un appel sans réponse devient « manqué » après 30 s
    "call_lost_s": 20,        # communication coupée si l'autre ne donne plus signe de vie
    "retry_after_decline_s": 120,
    "max_requests_per_hour": 30,
    "message_max": 500,
    "notifications_max": 40,
}


def public_config():
    """Copie des règles exposée au client (aucun secret ici)."""
    return {
        "version": CONFIG_VERSION,
        "zones": list(ZONES),
        "time": TIME,
        "needs": NEEDS,
        "rest": REST,
        "items": ITEMS,
        "shops": SHOPS,
        "profiles": PROFILES,
        "jobs": JOBS,
        "business_types": BUSINESS_TYPES,
        "missions": MISSIONS,
        "plot_price": PLOT_PRICE,
        "max_plots_per_player": MAX_PLOTS_PER_PLAYER,
        "player_buildings": PLAYER_BUILDINGS,
        "ad_rental": AD_RENTAL,
        "residential": RESIDENTIAL,
        "social": {**SOCIAL, "ice_servers": settings.WEBRTC_ICE_SERVERS},
    }
