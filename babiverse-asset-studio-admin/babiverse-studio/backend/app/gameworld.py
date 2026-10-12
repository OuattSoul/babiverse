"""Éléments placés par l'administrateur sur la carte du jeu (page « Carte du jeu » de l'atelier).

Un placement = un asset PUBLIÉ (bâtiment, objet, véhicule ou surface) posé sur un rectangle de cases de la ville
du jeu (`x`, `y`, `w`, `h`, orientation `facing` de la façade ou de l'avant). Les placements sont des réglages de
l'atelier (`settings`, clé `game.placements`) et partent dans le pack de jeu, avec ce qu'il faut pour les dessiner.

La carte elle-même est générée par le jeu (client/src/world/city.js) : l'atelier l'affiche avec les mêmes modules
et y vérifie routes, bâtiments, parcelles et décor. Le serveur ne contrôle ici que ce qu'il connaît : asset publié
de la bonne famille, dimensions cohérentes avec l'emprise, pas de chevauchement entre placements. Le jeu, lui,
ignore à l'affichage un placement devenu incompatible avec la carte.
"""
from __future__ import annotations

import json
import re
import secrets
import time

from .db import audit, get_setting, set_setting, tx
from .service import ServiceError, get_asset_row, get_version_row
from .taxonomy import KITS

KEY = "game.placements"
KEY_REMOVED = "game.removals"
# Clés des éléments d'origine de la ville (client/src/world/removal.js) : bâtiment, arbre, mobilier
REMOVAL_KEY = re.compile(r"^(bld:[a-z0-9_]{1,40}|tree:\d{1,3},\d{1,3}|prop:[a-z_]{1,24}:\d{1,3},\d{1,3})$")
MAX_REMOVALS = 500
FAMILIES = ("building", "prop", "vehicle", "surface")
SIDES = ("S", "N", "E", "W")
MAX_PLACEMENTS = 400
MAX_COORD = 400
MAX_SURFACE = 40


def _load(conn) -> list[dict]:
    try:
        items = json.loads(get_setting(conn, KEY) or "[]")
    except ValueError:
        return []
    return items if isinstance(items, list) else []


def _save(conn, items: list[dict]) -> None:
    set_setting(conn, KEY, json.dumps(items))


def _published(conn, asset_id: str) -> tuple[dict, dict]:
    a = get_asset_row(conn, asset_id)
    if a["family"] not in FAMILIES:
        raise ServiceError(422, "Seuls les bâtiments, objets, véhicules et surfaces se placent sur la carte du jeu.")
    if a["archived"] or not a["published_version"]:
        raise ServiceError(422, "L'élément doit être publié (et non archivé) pour être placé dans le jeu.")
    return a, json.loads(get_version_row(conn, asset_id, a["published_version"])["definition"])


def _removals(conn) -> list[dict]:
    try:
        items = json.loads(get_setting(conn, KEY_REMOVED) or "[]")
    except ValueError:
        return []
    return [r for r in items if isinstance(r, dict) and isinstance(r.get("key"), str)] if isinstance(items, list) else []


def remove_original(conn, user: dict, key: str, label: str = "") -> dict:
    """Retire un élément d'origine de la ville (le jeu ignore la demande si l'élément est protégé)."""
    if not REMOVAL_KEY.match(key or ""):
        raise ServiceError(422, "Élément de la ville inconnu.")
    items = _removals(conn)
    if any(r["key"] == key for r in items):
        raise ServiceError(409, "Cet élément est déjà retiré de la carte.")
    if len(items) >= MAX_REMOVALS:
        raise ServiceError(409, f"{MAX_REMOVALS} éléments retirés au maximum.")
    items.append({"key": key, "label": (label or "")[:60], "created_by": user["username"], "created_at": time.time()})
    with tx(conn):
        set_setting(conn, KEY_REMOVED, json.dumps(items))
        audit(conn, user["username"], "game.remove_original", key, {"label": label})
    return list_view(conn)


def restore_original(conn, user: dict, key: str) -> dict:
    items = _removals(conn)
    left = [r for r in items if r["key"] != key]
    if len(left) == len(items):
        raise ServiceError(404, "Cet élément n'est pas retiré.")
    with tx(conn):
        set_setting(conn, KEY_REMOVED, json.dumps(left))
        audit(conn, user["username"], "game.restore_original", key, {})
    return list_view(conn)


def footprint(definition: dict, facing: str) -> tuple[int, int]:
    """Emprise en cases (largeur est-ouest, profondeur nord-sud) selon l'orientation."""
    fp = definition.get("footprint") or {}
    w, d = int(fp.get("w") or 1), int(fp.get("d") or 1)
    return (d, w) if facing in ("E", "W") else (w, d)


def _overlap(a: dict, b: dict) -> bool:
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def list_view(conn) -> dict:
    """Placements + éléments plaçables (publiés), pour la page « Carte du jeu »."""
    items = _load(conn)
    assets = []
    for a in conn.execute(f"SELECT * FROM assets WHERE family IN ({','.join('?' * len(FAMILIES))}) AND archived=0 "
                          "AND published_version IS NOT NULL ORDER BY family, technical_name", FAMILIES):
        d = json.loads(get_version_row(conn, a["id"], a["published_version"])["definition"])
        fp = d.get("footprint") or {}
        assets.append({"id": a["id"], "technical_name": a["technical_name"], "family": a["family"], "category": a["category"],
                       "name": d["name"], "subcategory": d.get("subcategory", ""), "w": fp.get("w", 1), "d": fp.get("d", 1),
                       "version": a["published_version"], "definition": d})
    names = {a["id"]: a["name"] for a in assets}
    for p in items:
        p["name"] = names.get(p["asset_id"])
        p["available"] = p["asset_id"] in names
    return {"placements": items, "assets": assets, "removals": _removals(conn)}


def add(conn, user: dict, body: dict) -> dict:
    a, d = _published(conn, body.get("asset_id", ""))
    facing = body.get("facing") or "S"
    if facing not in SIDES:
        raise ServiceError(422, "Orientation inconnue (S, N, E ou W).")
    try:
        x, y = int(body["x"]), int(body["y"])
    except (KeyError, TypeError, ValueError):
        raise ServiceError(422, "Position manquante.") from None
    if a["family"] == "surface":
        w, h = int(body.get("w") or 0), int(body.get("h") or 0)
        if not (1 <= w <= MAX_SURFACE and 1 <= h <= MAX_SURFACE):
            raise ServiceError(422, f"Une surface couvre de 1 à {MAX_SURFACE} cases de côté.")
    else:
        w, h = footprint(d, facing)
    if not (0 < x and 0 < y and x + w < MAX_COORD and y + h < MAX_COORD):
        raise ServiceError(422, "Hors de la carte du jeu.")
    items = _load(conn)
    if len(items) >= MAX_PLACEMENTS:
        raise ServiceError(409, f"{MAX_PLACEMENTS} éléments au maximum sur la carte.")
    new = {"id": f"atl_{secrets.token_hex(4)}", "asset_id": a["id"], "family": a["family"], "x": x, "y": y, "w": w, "h": h,
           "facing": facing, "created_by": user["username"], "created_at": time.time()}
    # Une surface peut accueillir des objets, des véhicules et d'autres éléments (pas une autre surface).
    clash = next((p for p in items if _overlap(p, new) and (p["family"] == "surface") == (new["family"] == "surface")), None)
    if clash:
        raise ServiceError(409, "Cet emplacement chevauche un élément déjà placé.")
    items.append(new)
    with tx(conn):
        _save(conn, items)
        audit(conn, user["username"], "game.place", a["id"], {k: new[k] for k in ("id", "x", "y", "w", "h", "facing")})
    return list_view(conn)


def remove(conn, user: dict, placement_id: str) -> dict:
    items = _load(conn)
    left = [p for p in items if p["id"] != placement_id]
    if len(left) == len(items):
        raise ServiceError(404, "Élément introuvable sur la carte.")
    with tx(conn):
        _save(conn, left)
        audit(conn, user["username"], "game.unplace", placement_id, {})
    return list_view(conn)


# ---------------------------------------------------------------- pack de jeu

def _modular(conn, parts: dict, add_part, m: dict | None, pins: dict) -> dict | None:
    """Assemblage modulaire avec ses composants en clés `id@version` (versions figées à la publication)."""
    if not m or m.get("kit") not in KITS:
        return None

    def ref(pid):
        ver = pins.get(pid)
        if not ver:
            row = conn.execute("SELECT published_version FROM assets WHERE id=?", (pid,)).fetchone()
            ver = row["published_version"] if row else None
        return add_part(conn, parts, pid, ver)

    base = ref(m.get("base", ""))
    if not base:
        return None
    out = {**m, "base": base, "layers": {}}
    if m.get("base_pattern") and ref(m["base_pattern"]["part"]):
        out["base_pattern"] = {**m["base_pattern"], "part": ref(m["base_pattern"]["part"])}
    for slot, layer in (m.get("layers") or {}).items():
        if not layer or not ref(layer["part"]):
            continue
        out["layers"][slot] = {**layer, "part": ref(layer["part"])}
        if layer.get("pattern") and ref(layer["pattern"]["part"]):
            out["layers"][slot]["pattern"] = {**layer["pattern"], "part": ref(layer["pattern"]["part"])}
    return out


def pack_removals(conn) -> list[str]:
    return [r["key"] for r in _removals(conn)]


def pack_placements(conn, parts: dict, add_part, interior_of) -> tuple[list[dict], dict]:
    """Placements prêts à dessiner + spécifications des kits utilisés. `interior_of(asset_id)` → intérieur ou None."""
    out, kits = [], {}
    for p in _load(conn):
        a = conn.execute("SELECT * FROM assets WHERE id=?", (p["asset_id"],)).fetchone()
        if not a or a["archived"] or not a["published_version"]:
            continue
        v = get_version_row(conn, a["id"], a["published_version"])
        d = json.loads(v["definition"])
        pins = (json.loads(v["pins"]) if v["pins"] else {}).get("assets") or {}
        props = d.get("properties") or {}
        render = {"materials": d.get("materials") or {}, "height_m": d.get("height_m"), "category": a["category"],
                  "subcategory": d.get("subcategory", ""), "description": d.get("description", "")}
        if a["family"] == "building":
            main = next((e for e in d.get("entrances") or [] if e.get("kind") == "main"), None)
            fw = (d.get("footprint") or {}).get("w", 1)
            render.update(floors=props.get("floors", 1), style=props.get("style") or {}, shop=props.get("shop"),
                          door=min(fw - 1, max(0, (main or {}).get("cell", [fw // 2, 0])[0])),
                          behaviors=[b["id"] for b in d.get("behaviors") or []])
            links = props.get("interiors") or []
            if links:
                render["interior"] = interior_of(links[0]["interior_id"])
        elif a["family"] == "prop":
            render.update(shape=props.get("shape"))
        elif a["family"] == "vehicle":
            render.update(kind=props.get("kind", "car"), roof_sign=props.get("roof_sign"), stripe=props.get("stripe", False))
        else:
            render.update(kind=props.get("kind"), pattern=props.get("pattern", "plain"), walkable=props.get("walkable", True))
        if a["family"] == "prop" and d.get("representation") == "modular":
            modular = _modular(conn, parts, add_part, props.get("modular"), pins)
            if modular:
                render["modular"] = modular
                kits[modular["kit"]] = KITS[modular["kit"]]
        out.append({**{k: p[k] for k in ("id", "family", "x", "y", "w", "h", "facing")},
                    "asset_id": a["id"], "version": a["published_version"], "technical_name": a["technical_name"],
                    "name": d["name"], "render": render})
    return out, kits
