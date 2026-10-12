"""Références d'une définition vers d'autres assets et vers des médias.

Source unique utilisée par la validation (intégrité), l'export (dépendances), la publication (figeage des
versions et révisions utilisées) et la médiathèque (« où ce fichier est-il utilisé ? »).
"""
from __future__ import annotations

from .taxonomy import FURNITURE, MODULAR_FAMILIES


def _modular_layer_sets(defn: dict) -> list[dict]:
    m = (defn.get("properties") or {}).get("modular") or {}
    return [m.get("layers") or {}] + [(v.get("props") or {}).get("layers") or {} for v in defn.get("variants") or []]


def asset_refs(defn: dict, family: str) -> set[str]:
    p = defn.get("properties") or {}
    out: set[str] = set()
    if family == "building":
        out |= {l["interior_id"] for l in p.get("interiors") or []}
    elif family == "interior":
        out |= {f["item"] for f in p.get("furniture") or [] if f.get("item") not in FURNITURE}
    elif family == "character":
        if p.get("body"):
            out.add(p["body"])
        layer_sets = [p.get("layers") or {}] + [(v.get("props") or {}).get("layers") or {} for v in defn.get("variants") or []]
        for layers in layer_sets:
            for layer in layers.values():
                if not layer:
                    continue
                out.add(layer["part"])
                if layer.get("pattern"):
                    out.add(layer["pattern"]["part"])
    elif family == "character_part":
        out |= set(p.get("bodies") or []) | set(p.get("incompatible_parts") or [])
    elif family == "component":
        out |= set(p.get("bases") or []) | set(p.get("incompatible_parts") or [])
    if family in MODULAR_FAMILIES and defn.get("representation") == "modular" and p.get("modular"):
        m = p["modular"]
        out.add(m["base"])
        if m.get("base_pattern"):
            out.add(m["base_pattern"]["part"])
        for layers in _modular_layer_sets(defn):
            for layer in layers.values():
                if not layer:
                    continue
                out.add(layer["part"])
                if layer.get("pattern"):
                    out.add(layer["pattern"]["part"])
    return out


def media_refs(defn: dict, family: str) -> set[str]:
    p = defn.get("properties") or {}
    out = set(defn.get("resources") or [])
    if defn.get("cover"):
        out.add(defn["cover"])
    if family in ("prop", "furniture", "vehicle") and p.get("sprite"):
        out.add(p["sprite"]["media"])
    if family == "surface" and p.get("texture"):
        out.add(p["texture"])
    if family in ("character_part", "component") and p.get("svg_media"):
        out.add(p["svg_media"])
    return out


def remap(defn: dict, family: str, assets: dict[str, str], media: dict[str, str]) -> dict:
    """Copie de la définition dont les références sont renommées (import en copie, médias dédoublonnés)."""
    import copy
    d = copy.deepcopy(defn)
    a = lambda x: assets.get(x, x)  # noqa: E731
    m = lambda x: media.get(x, x)  # noqa: E731
    d["resources"] = [m(x) for x in d.get("resources") or []]
    if d.get("cover"):
        d["cover"] = m(d["cover"])
    p = d.get("properties") or {}
    if family == "building":
        for l in p.get("interiors") or []:
            l["interior_id"] = a(l["interior_id"])
    elif family == "interior":
        for f in p.get("furniture") or []:
            f["item"] = a(f["item"])
    elif family == "character":
        if p.get("body"):
            p["body"] = a(p["body"])
        layer_sets = [p.get("layers") or {}] + [(v.get("props") or {}).get("layers") or {} for v in d.get("variants") or []]
        for layers in layer_sets:
            for layer in layers.values():
                if not layer:
                    continue
                layer["part"] = a(layer["part"])
                if layer.get("pattern"):
                    layer["pattern"]["part"] = a(layer["pattern"]["part"])
    elif family == "character_part":
        p["bodies"] = [a(x) for x in p.get("bodies") or []]
        p["incompatible_parts"] = [a(x) for x in p.get("incompatible_parts") or []]
        if p.get("svg_media"):
            p["svg_media"] = m(p["svg_media"])
    elif family == "component":
        p["bases"] = [a(x) for x in p.get("bases") or []]
        p["incompatible_parts"] = [a(x) for x in p.get("incompatible_parts") or []]
        if p.get("svg_media"):
            p["svg_media"] = m(p["svg_media"])
    if family in MODULAR_FAMILIES and p.get("modular"):
        mod = p["modular"]
        mod["base"] = a(mod["base"])
        if mod.get("base_pattern"):
            mod["base_pattern"]["part"] = a(mod["base_pattern"]["part"])
        for layers in _modular_layer_sets(d):
            for layer in layers.values():
                if not layer:
                    continue
                layer["part"] = a(layer["part"])
                if layer.get("pattern"):
                    layer["pattern"]["part"] = a(layer["pattern"]["part"])
    if family in ("prop", "furniture", "vehicle") and p.get("sprite"):
        p["sprite"]["media"] = m(p["sprite"]["media"])
    if family == "surface" and p.get("texture"):
        p["texture"] = m(p["texture"])
    return d
