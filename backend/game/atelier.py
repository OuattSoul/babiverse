"""Contenu venu de l'atelier d'assets (« pack de jeu », format babiverse-game-pack v1).

Le pack décrit la garde-robe de création du personnage, les habitants qui remplacent les PNJ et l'intérieur de
la maison du joueur. Il est lu en direct sur l'atelier (`ATELIER_URL`, clé `ATELIER_KEY`, mis en cache
`ATELIER_CACHE_S` secondes), sinon dans le dernier fichier synchronisé (`ATELIER_PACK_FILE`). Le serveur ne
s'en sert que pour valider l'apparence choisie à la création ; tout le rendu est côté client.
"""
import json
import logging
import re
import threading
import time
import urllib.error
import urllib.request

from django.conf import settings

log = logging.getLogger("game")
FORMAT = "babiverse-game-pack"
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
# Tout ce que le joueur peut porter (même liste que gamepack.WARDROBE_SLOTS de l'atelier)
WARDROBE_SLOTS = ("hair", "top", "bottom", "dress", "outerwear", "shoes", "headwear", "hair_accessory", "glasses",
                  "jewelry", "watch", "bag", "beard", "makeup")
FACE_SLOTS = ("eyes", "eyebrows", "nose", "mouth")
CHANNELS = ("primary", "secondary", "accent")

_lock = threading.Lock()
_cache = {"at": None, "pack": None, "source": None}


def _valid(pack) -> bool:
    return isinstance(pack, dict) and pack.get("format") == FORMAT and pack.get("format_version") == 1


def fetch(url: str | None = None, key: str | None = None, timeout: float = 3.0) -> dict | None:
    """Pack lu sur l'atelier, ou None (atelier injoignable, clé refusée, format inconnu)."""
    url = (url if url is not None else settings.ATELIER_URL).rstrip("/")
    if not url:
        return None
    req = urllib.request.Request(f"{url}/api/runtime/game-pack",
                                 headers={"X-Babiverse-Game-Key": key if key is not None else settings.ATELIER_KEY})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (URL de configuration)
            pack = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log.info("Atelier injoignable (%s) : %s", url, exc)
        return None
    return pack if _valid(pack) else None


def read_file(path: str | None = None) -> dict | None:
    try:
        with open(path or settings.ATELIER_PACK_FILE, encoding="utf-8") as f:
            pack = json.load(f)
    except (OSError, ValueError):
        return None
    return pack if _valid(pack) else None


def write_file(pack: dict, path: str | None = None) -> str:
    import os
    path = path or settings.ATELIER_PACK_FILE
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False)
    os.replace(tmp, path)
    return path


def current() -> dict | None:
    """Pack en vigueur : atelier en direct (dernier pack reçu gardé s'il ne répond plus), sinon fichier."""
    with _lock:
        now = time.monotonic()
        if _cache["at"] is not None and now - _cache["at"] < settings.ATELIER_CACHE_S:
            return _cache["pack"]
        live = fetch()
        if live:
            _cache.update(pack=live, source="atelier")
        elif _cache["source"] != "atelier":
            _cache.update(pack=read_file(), source="file")
        _cache["at"] = now
        return _cache["pack"]


def reset_cache():
    with _lock:
        _cache.update(at=None, pack=None, source=None)


# ---------------------------------------------------------------- apparence choisie à la création

def _rgb(h):
    return int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)


def nearest(color: str, choices) -> str:
    c = _rgb(color)
    return min(choices, key=lambda x: sum((a - b) ** 2 for a, b in zip(c, _rgb(x))))


def clean_look(raw, pack: dict | None) -> dict | None:
    """Apparence de l'atelier validée contre la garde-robe : {body, skin, hair_color, layers{slot: {part, colors}}}.

    Les composants inconnus, hors de la silhouette, réservés à l'autre genre ou hors palette sont écartés ; sans
    silhouette valide ni tenue (haut + bas, ou robe), None (le personnage garde l'apparence classique du jeu).
    Le visage est celui de la silhouette.
    """
    if not isinstance(raw, dict) or not pack:
        return None
    w = pack.get("wardrobe") or {}
    bodies = {b["id"]: b for b in w.get("bodies") or []}
    body = raw.get("body")
    if body not in bodies:
        return None
    gender = bodies[body].get("gender")
    skins = w.get("skin_tones") or []
    hair_colors = w.get("hair_colors") or []
    skin = raw.get("skin") if raw.get("skin") in skins else (skins[0] if skins else "#a86b3c")
    hair_color = raw.get("hair_color") if raw.get("hair_color") in hair_colors else (hair_colors[0] if hair_colors else "#1b1b1b")
    layers = {}
    asked = raw.get("layers") if isinstance(raw.get("layers"), dict) else {}
    for slot in WARDROBE_SLOTS:
        layer = asked.get(slot)
        if not isinstance(layer, dict):
            continue
        entry = next((e for e in (w.get("slots") or {}).get(slot) or [] if e["id"] == layer.get("part")), None)
        if not entry or (entry["bodies"] and body not in entry["bodies"]):
            continue
        if entry.get("genders") and gender and gender not in entry["genders"]:
            continue  # rouge à lèvres, talons… réservés aux femmes ; barbe, cravate… aux hommes
        colors = {}
        for ch, col in (layer.get("colors") or {}).items() if isinstance(layer.get("colors"), dict) else ():
            if ch not in CHANNELS or not isinstance(col, str) or not HEX.match(col):
                continue
            palette = [c.lower() for c in (entry.get("palette") or {}).get(ch) or []]
            if palette and col.lower() not in palette:
                continue
            colors[ch] = col.lower()
        layers[slot] = {"part": entry["id"], "colors": colors}
    if "dress" in layers:  # une robe (ou un boubou) remplace haut et bas
        layers.pop("top", None)
        layers.pop("bottom", None)
    elif "top" not in layers or "bottom" not in layers:
        return None
    for slot, pid in ((w.get("face") or {}).get(body) or {}).items():
        if slot in FACE_SLOTS and pid:
            layers[slot] = {"part": pid, "colors": {}}
    return {"body": body, "skin": skin, "hair_color": hair_color, "layers": layers}


def fallback_appearance(look: dict, pack: dict, skins, outfits, hairs) -> dict:
    """Apparence du jeu 3D d'origine la plus proche (affichée si le pack n'est plus disponible)."""
    w = pack.get("wardrobe") or {}
    slot = "top" if "top" in look["layers"] else "dress"
    top = look["layers"][slot]
    entry = next((e for e in (w.get("slots") or {}).get(slot) or [] if e["id"] == top["part"]), {})
    outfit = top["colors"].get("primary") or (entry.get("default_colors") or {}).get("primary") or outfits[0]
    hair = "bald"
    if "hair" in look["layers"]:
        h = next((e for e in (w.get("slots") or {}).get("hair") or [] if e["id"] == look["layers"]["hair"]["part"]), {})
        hair = h.get("game_hint") if h.get("game_hint") in hairs else "short"
    return {"skin": nearest(look["skin"], skins), "outfit": nearest(outfit, outfits), "hair": hair}
