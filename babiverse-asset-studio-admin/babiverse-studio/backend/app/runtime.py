"""Intégration avec le jeu : catalogue d'exécution et adaptateur vers le client Babiverse actuel.

1. `runtime_catalog` — format « babiverse-runtime-catalog » v1 : versions PUBLIÉES uniquement, avec les dépendances
   figées à la publication (composants de personnage, intérieurs, fichiers). C'est le format cible qu'un moteur
   chargerait. Le client actuel du jeu ne le lit PAS encore (voir docs/INTEGRATION.md).

2. `game_adapter` — conversion vers les contrats que le jeu actuel comprend réellement aujourd'hui :
   - personnages → `appearance = {skin, outfit, hair}` (backend/game/services/state.py : SKINS, OUTFITS, HAIRS) ;
   - bâtiments 2 × 2 → gabarits `{facade, roof}` (client/src/world/city.js TEMPLATES, engine3d/builders.js).
   Ces conversions perdent de l'information ; chaque entrée liste ce qui est perdu. Rien n'est écrit dans le
   dépôt du jeu : l'export est un fichier à intégrer volontairement.
"""
from __future__ import annotations

import json
import time

from . import media as md
from .refs import media_refs
from .service import CONTEXT, catalog, part_payload
from .taxonomy import CHARACTER_FRAME, KITS, MODULAR_FAMILIES

# Valeurs autorisées par le jeu actuel (copiées de backend/game/services/state.py et engine3d/builders.js)
GAME_SKINS = ["#f1c27d", "#c68642", "#8d5524", "#5c3a1e"]
GAME_OUTFITS = ["#e67e22", "#27ae60", "#2980b9", "#c0392b", "#8e44ad", "#f1c40f"]
GAME_HAIRS = ["short", "afro", "braids", "bald"]
GAME_FACADE = {"W": "#efe3c8", "Y": "#f2c14e"}  # mur crème / jaune ; H/h = avec fenêtre, D = porte
GAME_ROOF = {"r": "#9c5b3c", "o": "#c8874a", "g": "#6d8ea8"}


def _rgb(h: str) -> tuple[int, int, int]:
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def nearest(color: str, choices) -> str:
    c = _rgb(color)
    items = choices.items() if isinstance(choices, dict) else ((x, x) for x in choices)
    return min(items, key=lambda kv: sum((a - b) ** 2 for a, b in zip(c, _rgb(kv[1]))))[0]


def _media_index(conn, ids: set[str], pins: dict | None) -> dict:
    out = {}
    secret = CONTEXT.get("secret", "")
    for mid in ids:
        m = conn.execute("SELECT * FROM media WHERE id=?", (mid,)).fetchone()
        if not m:
            continue
        rev = ((pins or {}).get("media") or {}).get(mid) or m["revision"]
        r = conn.execute("SELECT * FROM media_revisions WHERE media_id=? AND revision=?", (mid, rev)).fetchone() or m
        out[mid] = {"revision": rev, "mime": r["mime"], "width": r["width"], "height": r["height"], "sha256": r["sha256"],
                    "url": md.signed_url(secret, mid, rev)}
    return out


PART_FIELDS = ("id", "name", "slot", "z", "back_z", "props", "view_box", "channels", "defs", "back", "front", "version", "kit")


def pinned_part(conn, pid: str, ver: int) -> dict | None:
    """Composant à une version exacte, avec la révision du fichier SVG figée à sa publication."""
    pv = conn.execute("SELECT pins FROM asset_versions WHERE asset_id=? AND version=?", (pid, ver)).fetchone()
    ppins = json.loads(pv["pins"]) if pv and pv["pins"] else {}
    p0 = part_payload(conn, pid, ver)
    if not p0:
        return None
    svg_id = p0["props"].get("svg_media")
    rev = (ppins.get("media") or {}).get(svg_id) if svg_id else None
    p = part_payload(conn, pid, ver, rev)
    return {k: p[k] for k in PART_FIELDS if k in p} if p else None


def runtime_catalog(conn) -> dict:
    entries = catalog(conn)
    parts: dict[str, dict] = {}
    out = []
    for e in entries:
        d, fam, pins = e["definition"], e["family"], e["pins"] or {}
        media = _media_index(conn, media_refs(d, fam), pins)
        if fam == "character" or (fam in MODULAR_FAMILIES and d.get("representation") == "modular"):
            for pid, ver in (pins.get("assets") or {}).items():
                key = f"{pid}@{ver}"
                if key in parts:
                    continue
                p = pinned_part(conn, pid, ver)
                if p:
                    parts[key] = p
        out.append({"asset_id": e["asset_id"], "technical_name": e["technical_name"], "family": fam, "category": e["category"],
                    "version": e["version"], "definition": d, "pins": e["pins"], "media": media})
    return {"format": "babiverse-runtime-catalog", "format_version": 1, "generated_at": time.time(),
            "character_frame": CHARACTER_FRAME, "assets": out,
            "character_parts": {k: v for k, v in parts.items() if "kit" not in v},
            "kit_parts": {k: v for k, v in parts.items() if "kit" in v}, "kits": KITS,
            "notice": "Versions publiées uniquement. Les liens de fichiers sont signés et expirent : téléchargez-les à la synchronisation."}


def _character_appearance(conn, e: dict) -> dict:
    d = e["definition"]
    p = d["properties"]
    pins = (e["pins"] or {}).get("assets") or {}
    lost = ["coiffure exacte", "visage", "chaussures", "accessoires", "motifs", "couleur du bas"]
    layers = p.get("layers") or {}
    top = layers.get("top") or layers.get("dress") or layers.get("outerwear")
    outfit_color = None
    if top:
        part = part_payload(conn, top["part"], pins.get(top["part"]))
        outfit_color = (top.get("colors") or {}).get("primary") or (part["props"].get("default_colors") or {}).get("primary") if part else None
    hair = "bald"
    if layers.get("hair"):
        part = part_payload(conn, layers["hair"]["part"], pins.get(layers["hair"]["part"]))
        hint = part["props"].get("game_hint") if part else None
        hair = hint if hint in GAME_HAIRS else "short"
    appearance = {"skin": nearest(p["skin"], GAME_SKINS), "outfit": nearest(outfit_color or "#e67e22", GAME_OUTFITS), "hair": hair}
    return {"asset_id": e["asset_id"], "technical_name": e["technical_name"], "name": d["name"], "version": e["version"],
            "appearance": appearance, "lossy": True, "lost": lost,
            "exact": {"skin": p["skin"], "outfit": outfit_color, "hair_color": p.get("hair_color")}}


def _building_template(e: dict) -> dict:
    d = e["definition"]
    p = d["properties"]
    fp = d["footprint"]
    base = {"asset_id": e["asset_id"], "technical_name": e["technical_name"], "name": d["name"], "version": e["version"]}
    if fp["kind"] != "rect" or (fp["w"], fp["d"]) != (2, 2):
        return {**base, "compatible": False, "reason": f"Le jeu actuel n'utilise que des bâtiments 2 × 2 (emprise {fp['w']} × {fp['d']})."}
    main = next((x for x in d["entrances"] if x["kind"] == "main"), None)
    if not main or main["side"] not in ("S", "N"):
        return {**base, "compatible": False, "reason": "Le jeu actuel n'a qu'une façade avant (entrée principale au sud ou au nord)."}
    wall = nearest(d["materials"].get("wall", "#efe3c8"), GAME_FACADE)
    window = "H" if wall == "W" else "h"
    custom = {(tuple(s["cell"]), s["side"]): s["module"] for s in p.get("facade") or [] if s["floor"] == 0}
    letters = []
    for x in range(2):
        cell = (x, 1 if main["side"] == "S" else 0)
        mod = custom.get((cell, main["side"]))
        if list(cell) == main["cell"] or mod in ("door", "shopfront", "garage"):
            letters.append("D")
        elif mod in ("blank", "claustra") or (mod is None and p["style"]["window_style"] == "none"):
            letters.append(wall)
        else:
            letters.append(window)
    tpl = {"facade": "".join(letters), "roof": nearest(d["materials"].get("roof", "#9c5b3c"), GAME_ROOF)}
    sign = (p.get("shop") or {}).get("sign_text") or None
    return {**base, "compatible": True, "template": tpl, "facing": main["side"], "sign": sign,
            "lost": ["étages", "style de toiture", "couleurs exactes", "entrées secondaires", "zones", "variantes"]}


def game_adapter(conn) -> dict:
    entries = catalog(conn)
    chars = [_character_appearance(conn, e) for e in entries if e["family"] == "character"]
    buildings = [_building_template(e) for e in entries if e["family"] == "building"]
    unsupported = sorted({e["family"] for e in entries} - {"character", "building", "character_part", "component"})
    return {
        "format": "babiverse-game-adapter", "format_version": 1, "generated_at": time.time(),
        "target": {"client": "client/src/world/city.js (TEMPLATES, BUILDINGS), client/src/engine3d/builders.js",
                   "server": "backend/game/services/state.py (SKINS, OUTFITS, HAIRS)"},
        "characters": chars, "building_templates": buildings,
        "unsupported_families": unsupported,
        "notice": "Conversion avec pertes vers le jeu Three.js actuel. Rien n'est synchronisé automatiquement : "
                  "les gabarits et apparences sont à reporter dans le dépôt du jeu (voir docs/INTEGRATION.md).",
    }
