"""Pack de jeu : ce que le jeu Babiverse charge réellement depuis l'atelier (atelier = admin, jeu = joueurs).

Format « babiverse-game-pack » v1, versions PUBLIÉES uniquement :
- `wardrobe` : garde-robe proposée aux nouveaux joueurs (silhouettes, coiffures, hauts, bas, chaussures,
  teintes de peau) et visage par défaut de chaque silhouette ;
- `inhabitants` : habitants publiés (personnages SVG) ; chacun remplace un PNJ du jeu (`npc`) ou se promène
  en ville en plus des PNJ (`npc` = null) ;
- `home` : intérieur choisi pour la maison du joueur (« Chez moi »), avec la description de ses meubles ;
- `parts` : composants SVG nécessaires, clés `id@version` (versions figées des habitants, version publiée
  courante pour la garde-robe).

Les choix (intérieur de la maison, habitant de chaque PNJ) sont des réglages de l'atelier (`settings`, clés
`game.*`) modifiés depuis la page « Intégration au jeu ». Le jeu lit le pack par `GET /api/runtime/game-pack`
(clé partagée `BABIVERSE_GAME_KEY` ou session) ou par un fichier exporté ; l'atelier n'écrit jamais dans le jeu.
"""
from __future__ import annotations

import hashlib
import json
import time

from . import gameworld
from .db import audit, get_setting, set_setting, tx
from .runtime import _character_appearance, pinned_part
from .service import ServiceError, approve, catalog, get_asset_row, get_version_row, publish, submit
from .taxonomy import CHARACTER_FRAME, FURNITURE

FORMAT = "babiverse-game-pack"
FORMAT_VERSION = 1

# PNJ du jeu (miroir de client/src/world/npcs.js et backend/game/rules.py NPCS) : identité et rôle gardés,
# seule l'apparence est remplacée par celle d'un habitant de l'atelier.
GAME_NPCS = [
    {"id": "koffi", "silhouette": "m", "name": "Tonton Koffi", "role": "Doyen du quartier", "mobility": "flâne"},
    {"id": "aya", "silhouette": "f", "name": "Aya", "role": "Étudiante en BTS", "mobility": "immobile"},
    {"id": "fofana", "silhouette": "m", "name": "M. Fofana", "role": "Épicier", "mobility": "immobile (épicerie)"},
    {"id": "adjoua", "silhouette": "f", "name": "Tantie Adjoua", "role": "Vendeuse de garba", "mobility": "immobile"},
    {"id": "diabate", "silhouette": "m", "name": "M. Diabaté", "role": "Grossiste", "mobility": "immobile"},
    {"id": "ibrahim", "silhouette": "m", "name": "Ibrahim", "role": "Chauffeur de taxi", "mobility": "immobile"},
    {"id": "seydou", "silhouette": "m", "name": "Seydou", "role": "Apprenti gbaka", "mobility": "immobile"},
    {"id": "fatou", "silhouette": "f", "name": "Fatou", "role": "Vendeuse d'eau", "mobility": "flâne"},
    {"id": "awa", "silhouette": "f", "name": "Awa", "role": "Couturière", "mobility": "immobile"},
    {"id": "kouassi", "silhouette": "m", "name": "Papa Kouassi", "role": "Mécanicien à la retraite", "mobility": "immobile"},
    {"id": "bamba", "silhouette": "f", "name": "Mme Bamba", "role": "Commerçante", "mobility": "flâne"},
]
NPC_IDS = [n["id"] for n in GAME_NPCS]

WARDROBE_SLOTS = ["hair", "top", "bottom", "shoes"]
FACE_SLOTS = ["eyes", "eyebrows", "nose", "mouth"]
# Mêmes listes que frontend/src/character/compose.ts (générateur d'habitants)
SKIN_TONES = ["#f1c27d", "#e0ac69", "#c68642", "#a86b3c", "#8d5524", "#6f4422", "#5c3a1e", "#3f2716"]
HAIR_COLORS = ["#111111", "#1b1b1b", "#2b1a12", "#3b2414", "#5a3825", "#7a4a2a", "#b0b0b0"]
CLOTH_COLORS = ["#e67e22", "#27ae60", "#2980b9", "#c0392b", "#8e44ad", "#f1c40f", "#16a085", "#2c3e50", "#ecf0f1",
                "#d35400", "#1e3d6b", "#7f8c8d"]
# Forme 3D d'un meuble intégré dans le jeu (même vocabulaire que FURNITURE_SHAPES)
BUILTIN_SHAPES = {"bed": "bed", "sofa": "seat", "armchair": "seat", "chair": "seat", "table": "table", "desk": "table",
                  "kitchen": "counter", "counter": "counter", "fridge": "cabinet", "wardrobe": "cabinet", "shelf": "cabinet",
                  "shower": "cabinet", "wc": "box", "tv": "screen", "plant": "plant", "lamp": "lamp"}

KEYS = {"home": "game.home_interior", "npcs": "game.npc_assignments", "extras": "game.extra_inhabitants"}
AUTO, KEEP = "", "keep"  # PNJ : habitant attribué automatiquement / apparence d'origine du jeu


# ---------------------------------------------------------------- réglages

def get_settings(conn) -> dict:
    try:
        npcs = json.loads(get_setting(conn, KEYS["npcs"]) or "{}")
    except ValueError:
        npcs = {}
    return {"home_interior": get_setting(conn, KEYS["home"]) or "",
            "npcs": {k: v for k, v in npcs.items() if k in NPC_IDS and isinstance(v, str)},
            "extra_inhabitants": (get_setting(conn, KEYS["extras"]) or "1") == "1"}


def update_settings(conn, user: dict, body: dict) -> dict:
    cur = get_settings(conn)
    if "home_interior" in body:
        hid = body["home_interior"] or ""
        if hid:
            a = get_asset_row(conn, hid)
            if a["family"] != "interior":
                raise ServiceError(422, "L'asset choisi pour la maison n'est pas un intérieur.")
            if a["archived"] or not a["published_version"]:
                raise ServiceError(422, "L'intérieur de la maison doit être publié (et non archivé).")
        cur["home_interior"] = hid
    if "npcs" in body:
        npcs = {}
        for npc, aid in (body["npcs"] or {}).items():
            if npc not in NPC_IDS:
                raise ServiceError(422, f"PNJ inconnu du jeu : {npc}")
            if aid in (AUTO, KEEP):
                if aid == KEEP:
                    npcs[npc] = KEEP
                continue
            a = get_asset_row(conn, aid)
            if a["family"] != "character":
                raise ServiceError(422, f"L'asset attribué à {npc} n'est pas un personnage.")
            if a["archived"] or not a["published_version"]:
                raise ServiceError(422, f"L'habitant attribué à {npc} doit être publié (et non archivé).")
            npcs[npc] = aid
        dup = [a for a in set(npcs.values()) if a != KEEP and list(npcs.values()).count(a) > 1]
        if dup:
            raise ServiceError(422, "Un même habitant ne peut pas remplacer deux PNJ.")
        cur["npcs"] = npcs
    if "extra_inhabitants" in body:
        cur["extra_inhabitants"] = bool(body["extra_inhabitants"])
    with tx(conn):
        set_setting(conn, KEYS["home"], cur["home_interior"])
        set_setting(conn, KEYS["npcs"], json.dumps(cur["npcs"]))
        set_setting(conn, KEYS["extras"], "1" if cur["extra_inhabitants"] else "0")
        audit(conn, user["username"], "game.settings", None, cur)
    return settings_view(conn)


def assign_npcs(settings: dict, inhabitants: list[dict]) -> dict[str, str | None]:
    """PNJ → habitant. Choix explicites d'abord ; les PNJ « auto » reçoivent les habitants les plus RÉCENTS
    (les derniers ajoutés remplacent les PNJ en priorité), en associant si possible les mêmes silhouettes.
    `inhabitants` : [{id, name, silhouette}] du plus récent au plus ancien."""
    ids = [x["id"] for x in inhabitants]
    chosen = {n: a for n, a in settings["npcs"].items() if a not in (AUTO, KEEP) and a in ids}
    out: dict[str, str | None] = {n: chosen.get(n) for n in NPC_IDS}
    auto = [n for n in GAME_NPCS if n["id"] not in chosen and settings["npcs"].get(n["id"]) != KEEP]
    # les plus récents d'abord : autant d'habitants que de PNJ à pourvoir
    pool = [x for x in inhabitants if x["id"] not in chosen.values()][:len(auto)]
    for rule in ("silhouette", "any"):
        for n in auto:
            if out[n["id"]] or not pool:
                continue
            match = next((x for x in pool if rule == "any" or x["silhouette"] == n["silhouette"]), None)
            if match:
                out[n["id"]] = match["id"]
                pool.remove(match)
    return out


def _silhouette(conn, body_id: str) -> str:
    row = conn.execute("SELECT technical_name FROM assets WHERE id=?", (body_id,)).fetchone()
    return "f" if row and ("femme" in row["technical_name"] or "fem" in row["technical_name"]) else "m"


def _brief(conn) -> list[dict]:
    """Habitants publiés, du plus récemment ajouté au plus ancien, pour l'attribution automatique."""
    created = {r["id"]: r["created_at"] for r in conn.execute("SELECT id, created_at FROM assets WHERE family='character'")}
    out = []
    for e in sorted(catalog(conn, "character"), key=lambda e: (-created.get(e["asset_id"], 0), e["technical_name"])):
        out.append({"id": e["asset_id"], "name": e["definition"]["name"], "silhouette": _silhouette(conn, e["definition"]["properties"]["body"])})
    return out


def settings_view(conn) -> dict:
    """Réglages + choix possibles, pour la page « Intégration au jeu »."""
    s = get_settings(conn)
    interiors, characters = [], []
    for a in conn.execute("SELECT * FROM assets WHERE family IN ('interior','character') AND archived=0 ORDER BY technical_name"):
        v = get_version_row(conn, a["id"], a["latest_version"])
        d = json.loads(v["definition"])
        row = {"id": a["id"], "technical_name": a["technical_name"], "name": d["name"], "subcategory": d.get("subcategory", ""),
               "published_version": a["published_version"], "status": v["status"]}
        (interiors if a["family"] == "interior" else characters).append(row)
    published = [c["id"] for c in sorted(characters, key=lambda c: c["technical_name"]) if c["published_version"]]
    resolved = assign_npcs(s, _brief(conn))
    taken = {a for a in resolved.values() if a}
    pack = game_pack(conn)
    return {**s, "game_npcs": GAME_NPCS, "interiors": interiors, "characters": characters, "resolved": resolved,
            "extras": [a for a in published if a not in taken] if s["extra_inhabitants"] else [],
            "wardrobe": {slot: len(pack["wardrobe"]["slots"].get(slot, [])) for slot in WARDROBE_SLOTS}
            | {"body": len(pack["wardrobe"]["bodies"])},
            "home": {"name": pack["home"]["name"]} if pack["home"] else None,
            "revision": pack["revision"], "drafts": sum(1 for c in characters if c["status"] in ("draft", "in_review", "validated"))}


def publish_inhabitants(conn, user: dict, ids: list[str] | None = None) -> dict:
    """Publie d'un coup les habitants non publiés (brouillon → relecture → validé → publié)."""
    done, failed = [], []
    rows = conn.execute("SELECT * FROM assets WHERE family='character' AND archived=0 ORDER BY technical_name").fetchall()
    for a in rows:
        if ids is not None and a["id"] not in ids:
            continue
        status = get_version_row(conn, a["id"], a["latest_version"])["status"]
        if status in ("published", "superseded"):
            continue
        try:
            for step, frm in ((submit, "draft"), (approve, "in_review"), (publish, "validated")):
                if status == frm:
                    step(conn, user, a["id"])
                    status = {"draft": "in_review", "in_review": "validated", "validated": "published"}[frm]
            done.append(a["technical_name"])
        except ServiceError as e:
            failed.append({"technical_name": a["technical_name"], "error": e.message})
    return {"published": done, "failed": failed}


# ---------------------------------------------------------------- pack

def _add(conn, parts: dict, pid: str, ver: int | None) -> str | None:
    if not ver:
        return None
    key = f"{pid}@{ver}"
    if key not in parts:
        parts[key] = pinned_part(conn, pid, ver)
    return key if parts[key] else None


def _wardrobe(conn, parts: dict) -> dict:
    lib = conn.execute("SELECT * FROM assets WHERE family='character_part' AND archived=0 AND published_version IS NOT NULL "
                       "ORDER BY technical_name").fetchall()
    bodies, slots, face = [], {s: [] for s in WARDROBE_SLOTS + FACE_SLOTS}, {}
    for a in lib:
        key = _add(conn, parts, a["id"], a["published_version"])
        if not key:
            continue
        p = parts[key]
        props = p["props"]
        entry = {"id": a["id"], "key": key, "name": p["name"], "slot": p["slot"], "bodies": props.get("bodies") or [],
                 "palette": props.get("palette") or {}, "default_colors": props.get("default_colors") or {},
                 "channels": [c for c in ("primary", "secondary", "accent") if c in (p.get("channels") or {})]}
        if p["slot"] == "body":
            bodies.append(entry)
        elif p["slot"] in slots:
            if p["slot"] == "hair":
                entry["game_hint"] = props.get("game_hint")
            slots[p["slot"]].append(entry)
    fits = lambda e, b: not e["bodies"] or b in e["bodies"]  # noqa: E731
    for b in bodies:
        face[b["id"]] = {s: next((e["id"] for e in slots[s] if fits(e, b["id"])), None) for s in FACE_SLOTS}
    return {"bodies": bodies, "slots": {s: slots[s] for s in WARDROBE_SLOTS}, "face": face,
            "face_parts": {s: slots[s] for s in FACE_SLOTS},
            "skin_tones": SKIN_TONES, "hair_colors": HAIR_COLORS, "cloth_colors": CLOTH_COLORS}


def _inhabitant(conn, parts: dict, e: dict) -> dict | None:
    d = e["definition"]
    p = d["properties"]
    pins = (e["pins"] or {}).get("assets") or {}

    def ref(pid):
        ver = pins.get(pid)
        if not ver:
            row = conn.execute("SELECT published_version FROM assets WHERE id=?", (pid,)).fetchone()
            ver = row["published_version"] if row else None
        return _add(conn, parts, pid, ver)

    body = ref(p["body"])
    if not body:
        return None
    layers = {}
    for slot, layer in (p.get("layers") or {}).items():
        if not layer:
            continue
        key = ref(layer["part"])
        if not key:
            continue
        out = {"part": key, "colors": layer.get("colors") or {}}
        pat = layer.get("pattern")
        if pat and ref(pat["part"]):
            out["pattern"] = {**pat, "part": ref(pat["part"])}
        layers[slot] = out
    greeting = next((b.get("params", {}).get("greeting") for b in d.get("behaviors") or [] if b.get("id") == "npc_dialogue"), None)
    return {"asset_id": e["asset_id"], "technical_name": e["technical_name"], "version": e["version"], "name": d["name"],
            "role": p.get("role") or d.get("subcategory") or "", "greeting": greeting or "",
            "character": {"body": body, "skin": p["skin"], "hair_color": p.get("hair_color", "#1b1b1b"),
                          "eye_color": p.get("eye_color", "#3b2414"), "height_scale": p.get("height_scale", 1.0), "layers": layers},
            "appearance": _character_appearance(conn, e)["appearance"]}


def _furniture(conn, item: str) -> dict:
    if item in FURNITURE:
        f = FURNITURE[item]
        return {"label": f["label"], "shape": BUILTIN_SHAPES.get(item, "box"), "color": f["color"], "height_px": f["h"],
                "actions": f["actions"]}
    row = conn.execute("SELECT * FROM assets WHERE id=?", (item,)).fetchone()
    if not row or row["family"] != "furniture" or not row["published_version"]:
        return {"label": "Meuble", "shape": "box", "color": "#a07a4a", "height_px": 10, "actions": []}
    d = json.loads(get_version_row(conn, item, row["published_version"])["definition"])
    p = d["properties"]
    mats = d.get("materials") or {}
    base = ((p.get("modular") or {}).get("base_colors") or {})
    color = mats.get("primary") or next(iter(base.values()), None) or "#a07a4a"
    shape = p.get("shape") or "box"
    if d.get("representation") == "modular":
        sub = (d.get("subcategory") or "").lower()
        shape = "bed" if "lit" in sub else "seat" if any(w in sub for w in ("canap", "fauteuil", "chaise")) \
            else "screen" if "télé" in sub else "table" if "table" in sub else "box"
    return {"label": d["name"], "shape": shape, "color": color, "height_px": p.get("height_px", 10), "actions": p.get("actions") or []}


def _home(conn, hid: str) -> dict | None:
    return _interior(conn, hid)


def _interior(conn, hid: str) -> dict | None:
    """Intérieur publié avec la description de ses meubles (maison du joueur, bâtiments placés sur la carte)."""
    if not hid:
        return None
    row = conn.execute("SELECT * FROM assets WHERE id=?", (hid,)).fetchone()
    if not row or row["family"] != "interior" or row["archived"] or not row["published_version"]:
        return None
    d = json.loads(get_version_row(conn, hid, row["published_version"])["definition"])
    p = d["properties"]
    return {"asset_id": hid, "technical_name": row["technical_name"], "version": row["published_version"], "name": d["name"],
            "materials": d.get("materials") or {}, "interior": p,
            "furniture": {f["item"]: _furniture(conn, f["item"]) for f in p.get("furniture") or []}}


def game_pack(conn) -> dict:
    parts: dict[str, dict | None] = {}
    settings = get_settings(conn)
    wardrobe = _wardrobe(conn, parts)
    inhabitants = [x for x in (_inhabitant(conn, parts, e) for e in catalog(conn, "character")) if x]
    inhabitants.sort(key=lambda x: x["technical_name"])
    assigned = assign_npcs(settings, _brief(conn))
    by_asset = {a: n for n, a in assigned.items() if a}
    for x in inhabitants:
        x["npc"] = by_asset.get(x["asset_id"])
        x["roams"] = x["npc"] is None and settings["extra_inhabitants"]
    placements, kits = gameworld.pack_placements(conn, parts, _add, lambda iid: _interior(conn, iid))
    body = {"wardrobe": wardrobe, "inhabitants": inhabitants, "home": _home(conn, settings["home_interior"]),
            "npcs": [{**n, "inhabitant": assigned[n["id"]]} for n in GAME_NPCS],
            "placements": placements, "kits": kits, "removals": gameworld.pack_removals(conn),
            "parts": {k: v for k, v in parts.items() if v}}
    revision = hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
    return {"format": FORMAT, "format_version": FORMAT_VERSION, "generated_at": time.time(), "revision": revision,
            "frame": CHARACTER_FRAME, **body}
