"""Données de départ : migrations, catégories, utilisateurs, scène de test, kit de base publié.

Le kit sert de modèles à dupliquer ; tout nouveau contenu se crée ensuite depuis le Studio.
Chaque lot de contenu est ajouté une seule fois (drapeau dans la table settings), y compris sur une base
existante du prototype v0.1 : rien n'est jamais écrasé.
"""
from __future__ import annotations

import json
import secrets
import time

from . import auth, service
from .config import Settings
from .db import get_setting, migrate, set_setting
from .seed_characters import CHARACTERS, PARTS
from .seed_kits import EXAMPLES as KIT_EXAMPLES, PARTS as KIT_PARTS
from .taxonomy import KITS, reload as reload_categories, seed_categories

SYSTEM = {"id": 0, "username": "system", "role": "admin", "permissions": sorted(auth.ROLE_PERMISSIONS["admin"])}

DEV_USERS = [("admin", "admin", "admin"), ("editeur", "editeur", "editor"),
             ("publieur", "publieur", "publisher"), ("lecteur", "lecteur", "viewer"), ("joueur", "joueur", "player")]

ROAD_MAT = {"asphalt": "#4a4e54", "marking": "#f3f0e6", "sidewalk": "#c9c1b1"}


def road_def(kind: str, name: str, lanes=2, width=2, sides=None, oneway=False, flows=None, markings="dashed") -> dict:
    from .validation import ROAD_SIDES
    sides = sides or sorted(ROAD_SIDES[kind])
    return {
        "name": name, "description": f"Segment {kind}, {lanes} voies, emprise {width}×{width}.",
        "subcategory": "Route 2 voies" if lanes == 2 else "Route 3 voies", "tags": ["route", kind],
        "representation": "segment", "footprint": {"kind": "rect", "w": width, "d": width}, "height_m": 0,
        "connectors": [{"id": f"c{s.lower()}", "side": s, "lanes": lanes, "width_cells": width, "level": 0,
                        "flow": (flows or {}).get(s, "both")} for s in sides],
        "materials": dict(ROAD_MAT), "placement": {"allowed_terrain": ["ground", "sand"], "road_access": "none"},
        "properties": {"kind": kind, "lanes": lanes, "oneway": oneway, "sidewalk": True, "markings": markings},
    }


STUDIO_INTERIOR = {
    "name": "Intérieur — studio de base", "description": "Salon-cuisine, chambre, salle d'eau. Pour maisons 2×2.",
    "subcategory": "Logement", "tags": ["logement", "studio"], "representation": "assembly",
    "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 3,
    "materials": {"floor": "#d8b98a", "wall": "#f1e7d6"},
    "properties": {
        "mode": "instanced", "width": 8, "depth": 8,
        "rooms": [{"id": "salon", "name": "Salon", "type": "living", "x": 0, "y": 0, "w": 8, "d": 5},
                  {"id": "chambre", "name": "Chambre", "type": "bedroom", "x": 0, "y": 5, "w": 5, "d": 3},
                  {"id": "sdb", "name": "Salle d'eau", "type": "bathroom", "x": 5, "y": 5, "w": 3, "d": 3}],
        "doors": [{"id": "entree", "cell": [3, 0], "side": "N", "connects": ["salon", "exterior"]},
                  {"id": "p-chambre", "cell": [2, 4], "side": "S", "connects": ["salon", "chambre"]},
                  {"id": "p-sdb", "cell": [6, 4], "side": "S", "connects": ["salon", "sdb"]}],
        "furniture": [
            {"id": "canape", "item": "sofa", "x": 0, "y": 1, "w": 3, "d": 1, "interactive": True, "action": "sit"},
            {"id": "tele", "item": "tv", "x": 0, "y": 3, "w": 2, "d": 1},
            {"id": "cuisine", "item": "kitchen", "x": 5, "y": 0, "w": 3, "d": 1, "interactive": True, "action": "cook"},
            {"id": "table", "item": "table", "x": 5, "y": 2, "w": 2, "d": 2, "interactive": True, "action": "eat"},
            {"id": "lit", "item": "bed", "x": 0, "y": 5, "w": 2, "d": 3, "interactive": True, "action": "sleep"},
            {"id": "armoire", "item": "wardrobe", "x": 3, "y": 7, "w": 2, "d": 1},
            {"id": "wc", "item": "wc", "x": 5, "y": 7, "w": 1, "d": 1, "interactive": True, "action": "use"},
            {"id": "douche", "item": "shower", "x": 7, "y": 7, "w": 1, "d": 1, "interactive": True, "action": "wash"}],
        "spawn": [3, 1], "forbidden": [],
    },
}

SHOP_INTERIOR = {
    "name": "Intérieur — boutique de quartier", "description": "Espace de vente avec comptoir et étagères.",
    "subcategory": "Commerce", "tags": ["commerce"], "representation": "assembly",
    "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 3.5,
    "materials": {"floor": "#cfd4d6", "wall": "#f4efe3"},
    "properties": {
        "mode": "instanced", "width": 8, "depth": 6,
        "rooms": [{"id": "vente", "name": "Espace de vente", "type": "shop", "x": 0, "y": 0, "w": 8, "d": 6}],
        "doors": [{"id": "entree", "cell": [3, 5], "side": "S", "connects": ["vente", "exterior"]}],
        "furniture": [
            {"id": "comptoir", "item": "counter", "x": 2, "y": 1, "w": 3, "d": 1, "interactive": True, "action": "shop"},
            {"id": "etagere-g", "item": "shelf", "x": 0, "y": 3, "w": 2, "d": 1, "interactive": True, "action": "shop"},
            {"id": "etagere-d", "item": "shelf", "x": 6, "y": 3, "w": 2, "d": 1, "interactive": True, "action": "shop"},
            {"id": "plante", "item": "plant", "x": 7, "y": 0, "w": 1, "d": 1}],
        "spawn": [3, 4], "forbidden": [],
    },
}


def shop_def(interior_id: str) -> dict:
    return {
        "name": "Boutique de quartier", "description": "Petite boutique de quartier avec auvent et enseigne.",
        "subcategory": "Boutique de quartier", "tags": ["commerce", "quartier"], "representation": "procedural",
        "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 4,
        "entrances": [{"id": "porte", "cell": [0, 1], "side": "S", "kind": "main"},
                      {"id": "livraison", "cell": [1, 0], "side": "E", "kind": "delivery"}],
        "zones": [{"id": "vitrine", "kind": "interaction", "label": "Vitrine", "cells": [[0, 2], [1, 2]]}],
        "materials": {"wall": "#e9d7ad", "roof": "#b4573e", "trim": "#2e6b8a"},
        "variants": [{"id": "facade-verte", "name": "Façade verte", "materials": {"wall": "#bcd8b0", "trim": "#2f6b3a"}}],
        "placement": {"allowed_terrain": ["ground"], "road_access": "preferred"},
        "behaviors": [{"id": "enter_interior", "params": {}}, {"id": "shop", "params": {"goods_slots": 24}}],
        "properties": {"floors": 1, "occupancy": 6, "ownership": "npc",
                       "interiors": [{"interior_id": interior_id, "label": "Base"}],
                       "style": {"roof": "flat", "window_style": "band", "door_style": "glass"},
                       "shop": {"sign_text": "BOUTIQUE", "shopfront": True, "awning": True, "goods_slots": 24}},
    }


def house_def(interior_id: str) -> dict:
    return {
        "name": "Maison économique", "description": "Maison basse en parpaings enduits, toit à deux pans.",
        "subcategory": "Maison économique", "tags": ["habitation"], "representation": "procedural",
        "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 4.5,
        "entrances": [{"id": "porte", "cell": [1, 1], "side": "S", "kind": "main"}],
        "materials": {"wall": "#efe2c6", "roof": "#8e4a35", "trim": "#5b3a29"},
        "placement": {"allowed_terrain": ["ground"], "road_access": "preferred"},
        "behaviors": [{"id": "enter_interior", "params": {}}],
        "properties": {"floors": 1, "occupancy": 4, "ownership": "npc",
                       "interiors": [{"interior_id": interior_id, "label": "Base"}],
                       "style": {"roof": "gable", "window_style": "grid", "door_style": "wood"}},
    }


def modern_house_def(interior_id: str) -> dict:
    """Maison à étage dont la façade est assemblée module par module (atelier d'assemblage)."""
    facade = [{"cell": [0, 1], "side": "S", "floor": 0, "module": "shutters"},
              {"cell": [1, 1], "side": "S", "floor": 0, "module": "door"},
              {"cell": [0, 1], "side": "S", "floor": 1, "module": "balcony"},
              {"cell": [1, 1], "side": "S", "floor": 1, "module": "window_band"},
              {"cell": [1, 0], "side": "E", "floor": 0, "module": "claustra"},
              {"cell": [1, 1], "side": "E", "floor": 0, "module": "garage"},
              {"cell": [1, 0], "side": "E", "floor": 1, "module": "shutters"},
              {"cell": [1, 1], "side": "E", "floor": 1, "module": "window"}]
    return {
        "name": "Maison moderne à étage", "description": "Façade assemblée : persiennes, balcon, claustra, porte de garage.",
        "subcategory": "Maison moderne", "tags": ["habitation", "façade modulaire"], "representation": "procedural",
        "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 7,
        "entrances": [{"id": "porte", "cell": [1, 1], "side": "S", "kind": "main"}],
        "materials": {"wall": "#f3ead8", "roof": "#3f6f8f", "trim": "#7a4b2a"},
        "variants": [{"id": "ocre", "name": "Enduit ocre", "materials": {"wall": "#e3b778"}},
                     {"id": "terrasse", "name": "Toit-terrasse", "props": {"roof": "flat"}}],
        "default_variant": None,
        "placement": {"allowed_terrain": ["ground"], "road_access": "preferred"},
        "behaviors": [{"id": "enter_interior", "params": {}}, {"id": "assignable_home", "params": {}}],
        "properties": {"floors": 2, "occupancy": 6, "ownership": "player", "assignable_to_player": True, "upgrade_level": 2,
                       "interiors": [{"interior_id": interior_id, "label": "Base"}],
                       "style": {"roof": "hip", "window_style": "grid", "door_style": "wood"}, "facade": facade},
    }


def base(**kw) -> dict:
    d = {"description": "", "tags": [], "footprint": {"kind": "rect", "w": 1, "d": 1}, "height_m": 1,
         "placement": {"allowed_terrain": ["ground", "sand"], "road_access": "none"}}
    d.update(kw)
    return d


PROPS = [
    ("urban_furniture", "lampadaire-akwaba", base(name="Lampadaire Akwaba", subcategory="Lampadaire", representation="procedural", height_m=5,
     tags=["éclairage"], materials={"primary": "#3b4a52", "secondary": "#ffe9a8"},
     behaviors=[{"id": "light_at_night", "params": {"radius": 3}}], properties={"shape": "lamp_post"})),
    ("urban_furniture", "banc-public", base(name="Banc public", subcategory="Banc", representation="procedural", footprint={"kind": "rect", "w": 2, "d": 1},
     materials={"primary": "#8a5a2b", "secondary": "#3b4a52"}, behaviors=[{"id": "sit", "params": {}}], properties={"shape": "bench"})),
    ("urban_furniture", "poubelle-rue", base(name="Poubelle de rue", subcategory="Poubelle", representation="procedural",
     materials={"primary": "#2f7d55", "secondary": "#1d2a30"}, properties={"shape": "bin"})),
    ("urban_furniture", "abribus", base(name="Abribus", subcategory="Abribus", representation="procedural", footprint={"kind": "rect", "w": 3, "d": 1}, height_m=2.6,
     materials={"primary": "#2e6b8a", "secondary": "#d4e6ec"}, properties={"shape": "bus_stop"})),
    ("vegetation", "arbre-fromager", base(name="Fromager", subcategory="Arbre", representation="procedural", height_m=6,
     materials={"primary": "#3f8f4a", "secondary": "#6b4423"}, properties={"shape": "tree"},
     variants=[{"id": "flamboyant", "name": "Flamboyant en fleurs", "materials": {"primary": "#d6452c"}}])),
    ("vegetation", "palmier", base(name="Palmier", subcategory="Palmier", representation="procedural", height_m=8,
     materials={"primary": "#4f9a3a", "secondary": "#8a6a3b"}, properties={"shape": "palm"})),
    ("vegetation", "buisson", base(name="Buisson", subcategory="Buisson", representation="procedural", height_m=1.2,
     materials={"primary": "#5c9e45", "secondary": "#3d6e2e"}, properties={"shape": "bush"})),
]

SURFACES = [
    ("nature", "pelouse", base(name="Pelouse", subcategory="Pelouse", representation="surface", collision="none", height_m=0,
     footprint={"kind": "rect", "w": 4, "d": 3}, materials={"base": "#8fbf6a", "detail": "#7aac58"},
     properties={"kind": "grass", "terrain": "ground", "walkable": True, "buildable": True, "pattern": "dots"})),
    ("paving", "parking-4-places", base(name="Parking 4 places", subcategory="Parking", representation="surface", collision="none", height_m=0,
     footprint={"kind": "rect", "w": 4, "d": 3}, materials={"base": "#7d8186", "detail": "#f3f0e6"},
     placement={"allowed_terrain": ["ground"], "road_access": "none"},
     properties={"kind": "parking", "terrain": "ground", "walkable": True, "buildable": False, "pattern": "stripes"})),
    ("nature", "bassin-lagune", base(name="Bassin de lagune", subcategory="Lagune", representation="surface", collision="none", height_m=0,
     footprint={"kind": "rect", "w": 3, "d": 3}, materials={"base": "#3d8db0", "detail": "#7fc3dd"},
     placement={"allowed_terrain": ["ground", "sand", "water"], "road_access": "none"},
     properties={"kind": "water", "terrain": "water", "walkable": False, "buildable": False, "pattern": "waves"})),
]

VEHICLES = [
    ("vehicles", "taxi-compteur", base(name="Taxi compteur", subcategory="Taxi", representation="procedural", footprint={"kind": "rect", "w": 1, "d": 2},
     height_m=1.5, materials={"body": "#e67e22", "trim": "#1d2a30", "glass": "#9cc8d6"}, behaviors=[{"id": "parked", "params": {}}],
     placement={"allowed_terrain": ["ground", "sand"], "road_access": "none"},
     variants=[{"id": "woro-woro-vert", "name": "Wôrô-wôrô vert", "materials": {"body": "#27ae60"}, "props": {"roof_sign": ""}}],
     properties={"kind": "taxi", "roof_sign": "TAXI", "seats": 4, "parking": "road", "anchors": {"conducteur": [0.3, 0.8]}})),
    ("vehicles", "gbaka", base(name="Gbaka", subcategory="Gbaka", representation="procedural", footprint={"kind": "rect", "w": 1, "d": 3},
     height_m=2.3, materials={"body": "#f1c40f", "trim": "#27ae60", "glass": "#9cc8d6"},
     placement={"allowed_terrain": ["ground", "sand"], "road_access": "none"},
     properties={"kind": "gbaka", "stripe": True, "seats": 18, "parking": "road", "anchors": {"porte": [1.0, 1.5]}})),
    ("vehicles", "voiture-particuliere", base(name="Voiture particulière", subcategory="Voiture", representation="procedural",
     footprint={"kind": "rect", "w": 1, "d": 2}, height_m=1.5, materials={"body": "#2980b9", "trim": "#1d2a30", "glass": "#9cc8d6"},
     placement={"allowed_terrain": ["ground"], "road_access": "none"},
     properties={"kind": "car", "seats": 5, "parking": "parking"})),
    ("vehicles", "moto-djakarta", base(name="Moto « djakarta »", subcategory="Moto", representation="procedural", height_m=1.2,
     materials={"body": "#c0392b", "trim": "#1d2a30", "glass": "#9cc8d6"}, collision="footprint",
     placement={"allowed_terrain": ["ground", "sand"], "road_access": "none"},
     properties={"kind": "moto", "seats": 2, "parking": "anywhere"})),
]

FURNITURE_ASSETS = [
    ("furniture_medical", "lit-medical", base(name="Lit médical", subcategory="Lit médical", representation="procedural",
     materials={"primary": "#e9eef2", "secondary": "#7fb7d6"}, collision="footprint",
     properties={"shape": "bed", "w": 1, "d": 2, "height_px": 9, "actions": ["sleep"]})),
    ("furniture_school", "pupitre", base(name="Pupitre d'élève", subcategory="Pupitre", representation="procedural",
     materials={"primary": "#a07a4a", "secondary": "#5a4632"}, properties={"shape": "table", "w": 1, "d": 1, "height_px": 9, "actions": ["work"]})),
]


def clinic_interior(bed_id: str) -> dict:
    return {
        "name": "Intérieur — cabinet médical", "description": "Accueil et salle de consultation.",
        "subcategory": "Médical", "tags": ["santé"], "representation": "assembly",
        "footprint": {"kind": "rect", "w": 2, "d": 2}, "height_m": 3,
        "materials": {"floor": "#dfe8e6", "wall": "#f6f8f7"},
        "properties": {
            "mode": "instanced", "width": 8, "depth": 7,
            "rooms": [{"id": "accueil", "name": "Accueil", "type": "waiting", "x": 0, "y": 0, "w": 8, "d": 3},
                      {"id": "consult", "name": "Consultation", "type": "consultation", "x": 0, "y": 3, "w": 8, "d": 4}],
            "doors": [{"id": "entree", "cell": [4, 0], "side": "N", "connects": ["accueil", "exterior"]},
                      {"id": "p-consult", "cell": [4, 2], "side": "S", "connects": ["accueil", "consult"]}],
            "furniture": [
                {"id": "chaise-1", "item": "chair", "x": 0, "y": 1, "w": 1, "d": 1, "interactive": True, "action": "sit"},
                {"id": "chaise-2", "item": "chair", "x": 1, "y": 1, "w": 1, "d": 1, "interactive": True, "action": "sit"},
                {"id": "bureau", "item": "desk", "x": 1, "y": 4, "w": 2, "d": 1, "interactive": True, "action": "work"},
                {"id": "lit", "item": bed_id, "x": 6, "y": 4, "w": 1, "d": 2, "interactive": True, "action": "sleep"},
                {"id": "plante", "item": "plant", "x": 7, "y": 0, "w": 1, "d": 1}],
            "spawn": [4, 1], "forbidden": [],
        },
    }


def _publish(conn, category, tech, d) -> str:
    a = service.create_asset(conn, SYSTEM, category, tech, d)
    for step in (service.submit, service.approve, service.publish):
        step(conn, SYSTEM, a["id"])
    return a["id"]


def _by_tech(conn, tech: str) -> str | None:
    row = conn.execute("SELECT id FROM assets WHERE technical_name=?", (tech,)).fetchone()
    return row["id"] if row else None


def seed_parts(conn) -> dict[str, str]:
    """Importe la bibliothèque SVG de départ par le même chemin que l'administration ; retourne {clé: asset_id}."""
    ids: dict[str, str] = {}
    pending = []
    for p in PARTS:
        existing = _by_tech(conn, f"part-{p['key']}")
        if existing:
            ids[p["key"]] = existing
            continue
        m = service.upload_media(conn, SYSTEM, p["svg"].encode("utf-8"), f"{p['key']}.svg", name=p["name"],
                                 category="pattern" if p["slot"] == "pattern" else "character_part", tags=p.get("tags", []))
        pending.append((p, m["id"]))
    for p, mid in sorted(pending, key=lambda t: t[0]["slot"] != "body"):  # les corps d'abord (référencés par les autres)
        props = {"slot": p["slot"], "svg_media": mid, "anchor": p.get("anchor"), "default_colors": p.get("defaults", {}),
                 "palette": p.get("palette", {}), "bodies": [ids[b] for b in p.get("bodies", [])],
                 "incompatible_slots": p.get("incompatible_slots", []), "requires_slots": p.get("requires_slots", []),
                 "anchors": p.get("anchors", {}), "game_hint": p.get("hint"),
                 "gender": p.get("gender"), "genders": p.get("genders", [])}
        d = {"name": p["name"], "description": "", "tags": p.get("tags", []) or [p["slot"]], "representation": "svg",
             "footprint": {"kind": "rect", "w": 1, "d": 1}, "height_m": 0, "resources": [], "properties": props}
        ids[p["key"]] = _publish(conn, "character_parts", f"part-{p['key']}", d)
    # incompatibilités entre composants : seconde passe (les identifiants existent maintenant)
    for p in PARTS:
        if not p.get("incompatible"):
            continue
        aid = ids[p["key"]]
        a = service.asset_detail(conn, aid)
        d = a["definition"]
        wanted = sorted(ids[k] for k in p["incompatible"])
        if sorted(d["properties"].get("incompatible_parts") or []) == wanted:
            continue
        d["properties"]["incompatible_parts"] = wanted
        service.new_draft(conn, SYSTEM, aid, d, note="Incompatibilités")
        for step in (service.submit, service.approve, service.publish):
            step(conn, SYSTEM, aid)
    return ids


def upgrade_character_parts(conn, ids: dict[str, str]) -> None:
    """Applique le genre (silhouettes) et les réservations (composants) de la bibliothèque à une base existante.
    Une nouvelle version est publiée seulement si la définition diffère ; rien d'autre n'est modifié."""
    for p in PARTS:
        aid = ids.get(p["key"])
        a = service.asset_detail(conn, aid) if aid else None
        if not a or a["archived"]:
            continue
        d = a["definition"]
        props = d["properties"]
        wanted = {"gender": p.get("gender"), "genders": p.get("genders", []), "bodies": [ids[b] for b in p.get("bodies", [])]}
        if all((props.get(k) or None) == (v or None) for k, v in wanted.items()) and d["name"] == p["name"]:
            continue
        if a["versions"][-1]["status"] != "published":
            continue  # un brouillon de l'administrateur est en cours : on n'y touche pas
        props.update(wanted)
        d["name"] = p["name"]
        service.new_draft(conn, SYSTEM, aid, d, note="Genre et composants réservés")
        for step in (service.submit, service.approve, service.publish):
            step(conn, SYSTEM, aid)


def _layer(ids: dict, spec) -> dict | None:
    if spec is None:
        return None
    key, colors = spec[0], spec[1]
    layer = {"part": ids[key], "colors": colors}
    if len(spec) > 2:
        pkey, pcolors = spec[2]
        layer["pattern"] = {"part": ids[pkey], "colors": pcolors, "channel": "primary", "scale": 1.0}
    return layer


def seed_characters(conn, ids: dict[str, str]) -> dict[str, str]:
    out = {}
    for c in CHARACTERS:
        if _by_tech(conn, c["key"]):
            out[c["key"]] = _by_tech(conn, c["key"])
            continue
        props = {"body": ids[c["body"]], "skin": c["skin"], "hair_color": c["hair_color"], "eye_color": c["eye_color"],
                 "height_scale": 1.0, "role": c["role"], "layers": {k: _layer(ids, v) for k, v in c["layers"].items()}}
        variants = [{"id": v["id"], "name": v["name"], "materials": {}, "props": {"layers": {k: _layer(ids, s) for k, s in v["layers"].items()}}}
                    for v in c.get("variants", [])]
        d = {"name": c["name"], "description": c["role"], "subcategory": c["sub"], "tags": ["habitant"], "representation": "svg",
             "footprint": {"kind": "rect", "w": 1, "d": 1}, "height_m": 1.75, "collision": "none",
             "placement": {"allowed_terrain": ["ground", "sand"], "road_access": "none"},
             "behaviors": [{"id": "npc_dialogue", "params": {"greeting": f"Akwaba ! Je suis {c['name'].split(',')[0]}."}}],
             "variants": variants, "properties": props}
        out[c["key"]] = _publish(conn, "characters", c["key"], d)
    return out


def _seed_core(conn) -> None:
    roads = {}
    for kind, label in [("straight", "Route 2 voies — droite"), ("curve_left", "Route 2 voies — virage gauche"),
                        ("curve_right", "Route 2 voies — virage droite"), ("tee", "Route 2 voies — carrefour en T"),
                        ("cross", "Route 2 voies — carrefour en croix"), ("end", "Route 2 voies — extrémité")]:
        roads[kind] = _publish(conn, "road", f"route-2v-{kind.replace('_', '-')}", road_def(kind, label))
    studio = _publish(conn, "interior", "interieur-studio-base", STUDIO_INTERIOR)
    shop_in = _publish(conn, "interior", "interieur-boutique", SHOP_INTERIOR)
    shop = _publish(conn, "commerce", "boutique-quartier", shop_def(shop_in))
    house = _publish(conn, "residential", "maison-economique", house_def(studio))

    # Quartier de démonstration : une avenue Est-Ouest, une boutique, une maison
    for x in range(0, 40, 2):
        if x == 20:
            service.place(conn, SYSTEM, roads["cross"], x, 10, 0, None)
        else:
            service.place(conn, SYSTEM, roads["straight"], x, 10, 90, None)
    service.place(conn, SYSTEM, shop, 12, 8, 0, None)
    service.place(conn, SYSTEM, house, 16, 8, 0, None)


def _seed_world_content(conn) -> None:
    ids = {}
    for cat, tech, d in FURNITURE_ASSETS + PROPS + SURFACES + VEHICLES:
        ids[tech] = _by_tech(conn, tech) or _publish(conn, cat, tech, d)
    if not _by_tech(conn, "interieur-cabinet-medical"):
        _publish(conn, "interior", "interieur-cabinet-medical", clinic_interior(ids["lit-medical"]))
    studio = _by_tech(conn, "interieur-studio-base")
    if studio and not _by_tech(conn, "maison-moderne-etage"):
        ids["maison-moderne-etage"] = _publish(conn, "residential", "maison-moderne-etage", modern_house_def(studio))
    # décor de la scène principale, hors des cases utilisées par les tests de scénario (les refus éventuels — scène modifiée par l'utilisateur — sont ignorés)
    spots = [("pelouse", 3, 14, 0), ("parking-4-places", 33, 13, 0), ("arbre-fromager", 10, 6, 0), ("arbre-fromager", 22, 7, 0),
             ("palmier", 5, 15, 0), ("buisson", 7, 15, 0), ("lampadaire-akwaba", 14, 12, 0), ("lampadaire-akwaba", 26, 12, 0),
             ("banc-public", 17, 12, 0), ("poubelle-rue", 19, 12, 0), ("abribus", 30, 12, 0), ("taxi-compteur", 6, 10, 90),
             ("gbaka", 32, 11, 90), ("voiture-particuliere", 34, 14, 0), ("moto-djakarta", 11, 12, 0), ("maison-moderne-etage", 28, 8, 0)]
    for tech, x, y, rot in spots:
        if tech not in ids:
            continue
        try:
            service.place(conn, SYSTEM, ids[tech], x, y, rot, None)
        except service.ServiceError:
            pass


def seed(conn, settings: Settings | None = None, with_content: bool = True) -> None:
    migrate(conn)
    seed_categories(conn)
    reload_categories(conn)
    if settings and settings.production:
        # une base venue du développement : les comptes « mot de passe = identifiant » sont désactivés
        for u, _p, _r in DEV_USERS:
            row = conn.execute("SELECT id, pw_hash FROM users WHERE username=? AND active=1", (u,)).fetchone()
            if row and auth.verify_password(u, row["pw_hash"]):
                conn.execute("UPDATE users SET active=0 WHERE id=?", (row["id"],))
                conn.execute("DELETE FROM sessions WHERE user_id=?", (row["id"],))
        conn.commit()
        if not conn.execute("SELECT 1 FROM users WHERE role='admin' AND active=1").fetchone():
            auth.create_user(conn, settings.admin_user.lower(), settings.admin_password, "admin")
    elif not conn.execute("SELECT 1 FROM users").fetchone():
        import os
        for u, p, r in DEV_USERS:
            auth.create_user(conn, u, os.environ.get(f"BABIVERSE_PW_{u.upper()}", p), r)
    elif not conn.execute("SELECT 1 FROM users WHERE username='lecteur'").fetchone() and conn.execute("SELECT 1 FROM users WHERE username='admin'").fetchone():
        auth.create_user(conn, "lecteur", "lecteur", "viewer")
    if not get_setting(conn, "secret"):
        set_setting(conn, "secret", secrets.token_hex(32))
        conn.commit()
    if not conn.execute("SELECT 1 FROM scenes WHERE id='main'").fetchone():
        terr = service.terrain_template(40, 40, "coast")
        w = conn.execute("SELECT * FROM world WHERE id=1").fetchone()
        conn.execute("INSERT INTO scenes (id, name, description, width, height, terrain, created_by, created_at, updated_at) "
                     "VALUES ('main', 'Quartier de test', 'Scène de prévisualisation principale.', ?, ?, ?, 'system', ?, ?)",
                     (w["width"] if w else 40, w["height"] if w else 40, w["terrain"] if w else json.dumps(terr), time.time(), time.time()))
        conn.commit()
    if not with_content:
        return
    if not conn.execute("SELECT 1 FROM assets").fetchone():
        _seed_core(conn)
    if not get_setting(conn, "seed.characters"):
        ids = seed_parts(conn)
        seed_characters(conn, ids)
        set_setting(conn, "seed.characters", "1")
        set_setting(conn, "seed.characters_v2", "1")
        conn.commit()
    elif not get_setting(conn, "seed.characters_v2"):
        # base existante : genre des silhouettes, composants réservés, maquillage, garde-robe féminine, nouveaux habitants
        ids = seed_parts(conn)
        upgrade_character_parts(conn, ids)
        seed_characters(conn, ids)
        set_setting(conn, "seed.characters_v2", "1")
        conn.commit()
    if not get_setting(conn, "seed.world_content"):
        _seed_world_content(conn)
        chars = {c["key"]: _by_tech(conn, c["key"]) for c in CHARACTERS}
        for key, (x, y) in {"habitant-kouadio": (13, 13), "habitante-awa": (16, 13), "habitant-yao": (9, 13)}.items():
            if chars.get(key):
                try:
                    service.place(conn, SYSTEM, chars[key], x, y, 0, None)
                except service.ServiceError:
                    pass
        set_setting(conn, "seed.world_content", "1")
        conn.commit()
    if not get_setting(conn, "seed.kits"):
        ids = seed_kit_parts(conn)
        seed_kit_examples(conn, ids)
        set_setting(conn, "seed.kits", "1")
        conn.commit()


# ---------------------------------------------------------------- kits modulaires

KIT_SUBCATEGORY = {"building": "Bâtiment", "vehicle": "Véhicule", "vegetation": "Végétation", "street": "Mobilier urbain",
                   "furniture": "Meuble", "surface": "Surface"}


def seed_kit_parts(conn) -> dict[str, str]:
    """Importe la bibliothèque des kits par le même chemin que l'administration ; retourne {clé: asset_id}."""
    ids: dict[str, str] = {}
    pending = []
    for p in KIT_PARTS:
        existing = _by_tech(conn, f"kit-{p['key']}")
        if existing:
            ids[p["key"]] = existing
            continue
        m = service.upload_media(conn, SYSTEM, p["svg"].encode("utf-8"), f"{p['key']}.svg", name=p["name"], category="component",
                                 tags=[p["kit"], p["slot"]])
        pending.append((p, m["id"]))
    for p, mid in sorted(pending, key=lambda t: t[0]["slot"] != "base"):  # les bases d'abord (référencées par les autres)
        slot_spec = KITS[p["kit"]]["slots"][p["slot"]]
        anchor = None if p["slot"] in ("base", "pattern") else p.get("anchor", slot_spec.get("anchor"))
        props = {"kit": p["kit"], "slot": p["slot"], "svg_media": mid, "anchor": anchor, "default_colors": p.get("defaults", {}),
                 "palette": {}, "bases": [ids[b] for b in p.get("bases", [])], "requires_slots": p.get("requires_slots", []),
                 "incompatible_slots": p.get("incompatible_slots", []), "anchors": p.get("anchors", {})}
        d = {"name": p["name"], "description": "", "subcategory": KIT_SUBCATEGORY[p["kit"]], "tags": p.get("tags", []) or [p["slot"]],
             "representation": "svg", "footprint": {"kind": "rect", "w": 1, "d": 1}, "height_m": 0, "resources": [], "properties": props}
        ids[p["key"]] = _publish(conn, "kit_components", f"kit-{p['key']}", d)
    for p in KIT_PARTS:  # incompatibilités : seconde passe (les identifiants existent maintenant)
        if not p.get("incompatible"):
            continue
        aid = ids[p["key"]]
        d = service.asset_detail(conn, aid)["definition"]
        wanted = sorted(ids[k] for k in p["incompatible"])
        if sorted(d["properties"].get("incompatible_parts") or []) == wanted:
            continue
        d["properties"]["incompatible_parts"] = wanted
        service.new_draft(conn, SYSTEM, aid, d, note="Incompatibilités")
        for step in (service.submit, service.approve, service.publish):
            step(conn, SYSTEM, aid)
    return ids


def _kit_layer(ids: dict, kit: str, spec) -> dict | None:
    if spec is None:
        return None
    layer = {"part": ids[f"{kit}-{spec[0]}"], "colors": spec[1]}
    if len(spec) > 2 and spec[2]:
        pkey, pcolors = spec[2]
        layer["pattern"] = {"part": ids[f"{kit}-{pkey}"], "colors": pcolors, "channel": "primary", "scale": 1.0}
    return layer


def seed_kit_examples(conn, ids: dict[str, str]) -> dict[str, str]:
    out = {}
    for e in KIT_EXAMPLES:
        if _by_tech(conn, e["key"]):
            out[e["key"]] = _by_tech(conn, e["key"])
            continue
        kit = e["kit"]
        modular = {"kit": kit, "base": ids[f"{kit}-{e['base']}"], "base_colors": e.get("base_colors", {}), "colors": e.get("colors", {}),
                   "layers": {s: _kit_layer(ids, kit, spec) for s, spec in e["layers"].items()}}
        if e.get("base_pattern"):
            pkey, pcolors = e["base_pattern"]
            modular["base_pattern"] = {"part": ids[f"{kit}-{pkey}"], "colors": pcolors, "channel": "primary", "scale": 1.0}
        d = json.loads(json.dumps(e["def"]))
        d["properties"] = {**d.get("properties", {}), "modular": modular, **({"shop": e["shop"]} if e.get("shop") else {})}
        d["variants"] = [{"id": v["id"], "name": v["name"], "materials": {},
                          "props": {**{k: v[k] for k in ("base_colors", "colors") if k in v},
                                    **({"layers": {s: _kit_layer(ids, kit, spec) for s, spec in v["layers"].items()}} if "layers" in v else {})}}
                         for v in e.get("variants", [])]
        out[e["key"]] = _publish(conn, e["category"], e["key"], d)
    return out
