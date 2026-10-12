"""Validation des définitions d'assets.

Chaque contrôle produit une entrée {level, code, message, path}. Un asset ne peut être soumis,
validé ou publié que s'il n'a aucune erreur (les avertissements n'empêchent pas la publication).
`for_publish=True` durcit les contrôles d'intégrité : toute dépendance (intérieur, meuble, composant de
personnage, fichier) doit alors être publiée et non archivée.
"""
from __future__ import annotations

from collections import deque
from typing import Callable, Optional

from pydantic import ValidationError

from . import geometry as g
from .behaviors import BEHAVIORS, FURNITURE_ACTIONS, check_params
from .models import FAMILY_PROPS, AssetDefinition, CharacterLayer, ModularLayer
from .refs import media_refs
from .taxonomy import (CATEGORY_BY_KEY, CHARACTER_FRAME, CHARACTER_SLOTS, FACADE_MODULES, FAMILIES, FURNITURE,
                       FURNITURE_SHAPES, INTERIOR_TILES_PER_CELL, KITS, LAYER_CHANNELS, MATERIAL_SLOTS, MODULAR_FAMILIES,
                       PROP_SHAPES, REQUIRED_BODY_ANCHORS, SURFACE_KINDS, VEHICLE_KINDS, BODY_ANCHORS)

# resolve(asset_id) -> {"family", "category", "archived", "latest_definition", "published_definition"} | None
Resolver = Callable[[str], Optional[dict]]
# media(media_id) -> {"kind", "archived", "meta"} | None
MediaResolver = Callable[[str], Optional[dict]]


class Report:
    def __init__(self):
        self.items: list[dict] = []

    def error(self, code: str, message: str, path: str = ""):
        self.items.append({"level": "error", "code": code, "message": message, "path": path})

    def warn(self, code: str, message: str, path: str = ""):
        self.items.append({"level": "warning", "code": code, "message": message, "path": path})

    @property
    def ok(self) -> bool:
        return not any(i["level"] == "error" for i in self.items)

    def as_dict(self) -> dict:
        return {"ok": self.ok, "errors": sum(i["level"] == "error" for i in self.items),
                "warnings": sum(i["level"] == "warning" for i in self.items), "items": self.items}


def pydantic_errors(report: Report, exc: ValidationError, prefix: str = ""):
    for e in exc.errors():
        path = ".".join(str(p) for p in e["loc"])
        report.error("schema", e["msg"], f"{prefix}{path}")


def validate_definition(defn: dict, category: str, resolve: Resolver | None = None,
                        for_publish: bool = False, media: MediaResolver | None = None) -> Report:
    r = Report()
    cat = CATEGORY_BY_KEY.get(category)
    if not cat:
        r.error("category.unknown", f"Catégorie inconnue : {category}")
        return r
    family = cat["family"]
    if family not in FAMILIES or not FAMILIES[family]["implemented"]:
        r.error("family.not_implemented", f"La famille « {FAMILIES.get(family, {}).get('label', family)} » n'est pas encore prise en charge.")
        return r

    # 1. Schéma commun
    try:
        base = AssetDefinition.model_validate(defn).model_dump()
    except ValidationError as exc:
        pydantic_errors(r, exc)
        return r
    # 2. Schéma de la famille
    try:
        props = FAMILY_PROPS[family].model_validate(base["properties"]).model_dump()
    except ValidationError as exc:
        pydantic_errors(r, exc, "properties.")
        return r

    allowed_repr = FAMILIES[family]["representations"]
    if base["representation"] not in allowed_repr:
        r.error("representation", f"Représentation attendue pour cette famille : {' ou '.join(allowed_repr)}", "representation")

    if base["subcategory"] and cat["subcategories"] and base["subcategory"] not in cat["subcategories"]:
        r.warn("subcategory.custom", f"Sous-catégorie « {base['subcategory']} » hors liste de référence.", "subcategory")

    _validate_materials(r, base, family)
    _validate_variants(r, base, family)
    _validate_behaviors(r, base, props, family)
    _validate_media(r, base, family, media, for_publish)

    if family == "building":
        _validate_footprint(r, base)
        _validate_building(r, base, props, cat, resolve, for_publish)
    elif family == "road":
        _validate_road(r, base, props)
    elif family == "interior":
        _validate_interior(r, base, props, resolve, for_publish)
    elif family == "surface":
        _validate_footprint(r, base)
        _validate_surface(r, base, props)
    elif family == "prop":
        _validate_footprint(r, base)
        _validate_prop(r, base, props)
    elif family == "furniture":
        _validate_furniture(r, base, props)
    elif family == "vehicle":
        _validate_footprint(r, base)
        _validate_vehicle(r, base, props)
    elif family == "character_part":
        _validate_part(r, base, props, resolve, media)
    elif family == "character":
        _validate_character(r, base, props, resolve, for_publish)
    elif family == "component":
        _validate_component(r, base, props, resolve, media)
    if family in MODULAR_FAMILIES:
        _validate_modular(r, base, props, family, resolve, for_publish)
    if "road_access_required" in cat["rules"] and base["placement"]["road_access"] != "required":
        r.error("category.road_access", "Cette catégorie exige un accès routier obligatoire.", "placement.road_access")
    return r


# ---------------------------------------------------------------- commun

def _validate_materials(r: Report, base: dict, family: str):
    # assemblage modulaire : les couleurs viennent des composants (properties.modular), pas des matériaux
    required = [] if base["representation"] == "modular" else MATERIAL_SLOTS.get(family, [])
    for slot in required:
        if slot not in base["materials"]:
            r.error("materials.missing", f"Matériau obligatoire manquant : {slot}", f"materials.{slot}")
    for slot in base["materials"]:
        if slot not in MATERIAL_SLOTS.get(family, []) and family != "building":
            r.warn("materials.unused", f"Emplacement de matériau non utilisé : {slot}", f"materials.{slot}")


VARIANT_PROP_KEYS = {"building": {"sign_text", "roof", "awning"}, "road": {"markings"}, "interior": set(),
                     "surface": {"pattern"}, "prop": set(), "furniture": set(), "vehicle": {"roof_sign", "stripe"},
                     "character": {"layers", "skin", "hair_color", "eye_color"}, "character_part": set(), "component": set()}
# variantes d'un assemblage modulaire : calques et couleurs (seulement les différences)
for _f in MODULAR_FAMILIES:
    VARIANT_PROP_KEYS[_f] = VARIANT_PROP_KEYS[_f] | {"layers", "colors", "base_colors"}


def _validate_variants(r: Report, base: dict, family: str):
    seen = set()
    for i, v in enumerate(base["variants"]):
        if v["id"] in seen:
            r.error("variant.duplicate", f"Identifiant de variante en double : {v['id']}", f"variants.{i}.id")
        seen.add(v["id"])
        for slot in v["materials"]:
            if slot not in base["materials"]:
                r.error("variant.slot", f"La variante « {v['name']} » modifie un matériau inexistant : {slot}",
                        f"variants.{i}.materials")
        for key in v["props"]:
            if key not in VARIANT_PROP_KEYS.get(family, set()):
                r.error("variant.prop", f"Paramètre non modifiable par une variante : {key}", f"variants.{i}.props")
        vp = v["props"]
        if "sign_text" in vp and len(str(vp["sign_text"])) > 24:
            r.error("variant.sign", "Enseigne trop longue (24 caractères max).", f"variants.{i}.props.sign_text")
        if "roof" in vp and vp["roof"] not in ("flat", "gable", "hip"):
            r.error("variant.roof", "Type de toiture invalide.", f"variants.{i}.props.roof")
        if "markings" in vp and vp["markings"] not in ("none", "dashed", "solid", "double"):
            r.error("variant.markings", "Marquage invalide.", f"variants.{i}.props.markings")
        if "pattern" in vp and vp["pattern"] not in ("plain", "stripes", "checker", "dots", "waves"):
            r.error("variant.pattern", "Motif de surface invalide.", f"variants.{i}.props.pattern")
        if "roof_sign" in vp and (not isinstance(vp["roof_sign"], str) or len(vp["roof_sign"]) > 12):
            r.error("variant.roof_sign", "Enseigne de toit : 12 caractères maximum.", f"variants.{i}.props.roof_sign")
        if "stripe" in vp and not isinstance(vp["stripe"], bool):
            r.error("variant.stripe", "Bande décorative : vrai ou faux.", f"variants.{i}.props.stripe")
        for k in ("skin", "hair_color", "eye_color"):
            if k in vp and not (isinstance(vp[k], str) and len(vp[k]) == 7 and vp[k].startswith("#")):
                r.error("variant.color", f"Couleur invalide : {k}", f"variants.{i}.props.{k}")
        for k in ("colors", "base_colors"):
            if k in vp and (not isinstance(vp[k], dict) or not all(isinstance(c, str) and len(c) == 7 and c.startswith("#") for c in vp[k].values())):
                r.error("variant.color", f"Couleurs de variante invalides : {k}", f"variants.{i}.props.{k}")
        if "layers" in vp and family != "character":
            if not isinstance(vp["layers"], dict):
                r.error("variant.layers", "Calques de variante invalides.", f"variants.{i}.props.layers")
            else:
                for slot, layer in vp["layers"].items():
                    if layer is not None:
                        try:
                            ModularLayer.model_validate(layer)
                        except ValidationError as exc:
                            pydantic_errors(r, exc, f"variants.{i}.props.layers.{slot}.")
        elif "layers" in vp:
            if not isinstance(vp["layers"], dict):
                r.error("variant.layers", "Calques de variante invalides.", f"variants.{i}.props.layers")
            else:
                for slot, layer in vp["layers"].items():
                    if slot not in CHARACTER_SLOTS or slot in ("body", "pattern"):
                        r.error("variant.slot", f"Emplacement inconnu dans la variante : {slot}", f"variants.{i}.props.layers")
                    elif layer is not None:
                        try:
                            CharacterLayer.model_validate(layer)
                        except ValidationError as exc:
                            pydantic_errors(r, exc, f"variants.{i}.props.layers.{slot}.")
    dv = base.get("default_variant")
    if dv and dv not in seen:
        r.error("variant.default", f"Variante par défaut inconnue : {dv}", "default_variant")


def _validate_behaviors(r: Report, base: dict, props: dict, family: str):
    seen = set()
    for i, b in enumerate(base["behaviors"]):
        path = f"behaviors.{i}"
        spec = BEHAVIORS.get(b["id"])
        if not spec:
            r.error("behavior.unknown", f"Comportement inconnu du moteur : {b['id']}", path)
            continue
        if b["id"] in seen:
            r.error("behavior.duplicate", f"Comportement en double : {spec['label']}", path)
        seen.add(b["id"])
        if family not in spec["families"]:
            r.error("behavior.family", f"« {spec['label']} » n'est pas disponible pour cette famille.", path)
            continue
        for e in check_params(b["id"], b["params"]):
            r.error("behavior.param", f"{spec['label']} : {e}", path)
        if spec["engine"] == "preview":
            r.warn("behavior.preview_only", f"« {spec['label']} » est vérifié dans l'atelier mais pas encore exploité par le jeu.", path)
        if b["id"] == "enter_interior" and not props.get("interiors"):
            r.error("behavior.requires", "« Ouvrir un intérieur » exige au moins un intérieur associé.", path)
        if b["id"] == "assignable_home" and not props.get("assignable_to_player"):
            r.error("behavior.requires", "« Logement attribuable » exige que le bâtiment soit attribuable à un joueur.", path)
        if b["id"] == "shop" and family == "building" and not props.get("shop"):
            r.warn("behavior.requires", "Vente de marchandises sans façade commerciale.", path)
        if b["id"] == "interaction_zone":
            zid = b["params"].get("zone_id", "")
            if not zid:
                r.error("behavior.requires", "« Zone d'interaction » : choisissez la zone d'interaction concernée.", path)
            elif not any(z["id"] == zid and z["kind"] == "interaction" for z in base["zones"]):
                r.error("behavior.requires", f"Zone d'interaction « {zid} » introuvable dans les zones de l'asset.", path)


def _validate_media(r: Report, base: dict, family: str, media: MediaResolver | None, for_publish: bool):
    if media is None:
        return
    for mid in sorted(media_refs(base, family)):
        info = media(mid)
        if not info:
            r.error("media.missing", f"Fichier introuvable dans la médiathèque : {mid}", "resources")
        elif info["archived"]:
            (r.error if for_publish else r.warn)("media.archived", f"Le fichier « {info.get('name', mid)} » est archivé.", "resources")


def _validate_footprint(r: Report, base: dict) -> list[g.Cell]:
    fp = base["footprint"]
    if fp["kind"] == "cells":
        cells = [tuple(c) for c in (fp["cells"] or [])]
        if not cells:
            r.error("footprint.empty", "Emprise composée vide.", "footprint.cells")
            return []
        if len(set(cells)) != len(cells):
            r.error("footprint.duplicate", "Cellules d'emprise en double.", "footprint.cells")
        if any(c[0] < 0 or c[1] < 0 for c in cells):
            r.error("footprint.negative", "Les cellules d'emprise doivent être positives.", "footprint.cells")
        if not g.is_connected(cells):
            r.error("footprint.disconnected", "L'emprise composée doit être d'un seul tenant.", "footprint.cells")
    cells = g.footprint_cells(fp)
    if tuple(base["anchor"]) not in set(cells):
        r.error("anchor.outside", "Le point d'ancrage doit appartenir à l'emprise.", "anchor")
    return cells


# ---------------------------------------------------------------- bâtiments

def _validate_building(r: Report, base: dict, props: dict, cat: dict, resolve: Resolver | None, for_publish: bool):
    cells = set(g.footprint_cells(base["footprint"]))
    ids = set()
    for i, e in enumerate(base["entrances"]):
        path = f"entrances.{i}"
        if e["id"] in ids:
            r.error("entrance.duplicate", f"Entrée en double : {e['id']}", path)
        ids.add(e["id"])
        c = tuple(e["cell"])
        if c not in cells:
            r.error("entrance.outside", f"L'entrée « {e['id']} » n'est pas sur l'emprise.", path)
            continue
        dx, dy = g.DELTA[e["side"]]
        if (c[0] + dx, c[1] + dy) in cells:
            r.error("entrance.inner", f"L'entrée « {e['id']} » donne vers l'intérieur de l'emprise : choisissez une façade extérieure.", path)
    if not any(e["kind"] == "main" for e in base["entrances"]):
        r.error("entrance.main_missing", "Un bâtiment doit avoir une entrée principale.", "entrances")

    floors = props["floors"]
    if base["height_m"] < floors * 2.5:
        r.error("height.too_low", f"Hauteur insuffisante pour {floors} étage(s) : minimum {floors * 2.5:.1f} m.", "height_m")
    elif base["height_m"] > floors * 5 + 6:
        r.warn("height.high", "Hauteur élevée au regard du nombre d'étages.", "height_m")
    mh = base["placement"]["max_height_m"]
    if mh and base["height_m"] > mh:
        r.error("height.limit", f"Hauteur ({base['height_m']} m) supérieure à la limite de placement ({mh} m).", "height_m")

    xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
    bw, bd = max(xs) + 1, max(ys) + 1
    for i, z in enumerate(base["zones"]):
        for c in z["cells"]:
            if not (-3 <= c[0] <= bw + 2 and -3 <= c[1] <= bd + 2):
                r.error("zone.far", f"La zone « {z['id']} » s'éloigne de plus de 3 cases du bâtiment.", f"zones.{i}")
                break

    _validate_facade(r, base, props, cells)

    # Règles par catégorie
    rules = cat["rules"]
    if "shop_required" in rules and not props["shop"]:
        r.error("commerce.shop_missing", "Un commerce doit définir sa façade commerciale (enseigne, vitrine).", "properties.shop")
    if "service_entrance_recommended" in rules and not any(e["kind"] in ("service", "emergency") for e in base["entrances"]):
        r.warn("entrance.service_recommended", "Une entrée de service ou d'urgence est recommandée pour cette catégorie.", "entrances")
    if "player_house" in rules and props["ownership"] == "player":
        if not props["assignable_to_player"]:
            r.error("player.assignable", "Une maison de joueur doit être attribuable à un joueur.", "properties.assignable_to_player")
        if not props["interiors"]:
            r.error("player.interior_missing", "Une maison de joueur doit avoir au moins un intérieur associé.", "properties.interiors")

    # Intérieurs associés
    for i, link in enumerate(props["interiors"]):
        path = f"properties.interiors.{i}"
        info = resolve(link["interior_id"]) if resolve else None
        if not info:
            r.error("interior.unknown", f"Intérieur introuvable : {link['interior_id']}", path)
            continue
        if info["family"] != "interior":
            r.error("interior.wrong_family", "L'asset associé n'est pas un intérieur.", path)
            continue
        if info["archived"]:
            r.error("interior.archived", "L'intérieur associé est archivé.", path)
        idef = info["published_definition"]
        if idef is None:
            if for_publish:
                r.error("interior.unpublished", "L'intérieur associé doit être publié avant le bâtiment.", path)
            else:
                r.warn("interior.unpublished", "L'intérieur associé n'est pas encore publié.", path)
            idef = info["latest_definition"]
        ip = idef["properties"]
        maxw, maxd = bw * INTERIOR_TILES_PER_CELL, bd * INTERIOR_TILES_PER_CELL
        fits = (ip["width"] <= maxw and ip["depth"] <= maxd) or (ip["width"] <= maxd and ip["depth"] <= maxw)
        if not fits:
            r.error("interior.too_big",
                    f"Intérieur {ip['width']}×{ip['depth']} trop grand pour une emprise {bw}×{bd} (max {maxw}×{maxd} tuiles).", path)


def _validate_facade(r: Report, base: dict, props: dict, cells: set):
    seen = set()
    entrances = {(tuple(e["cell"]), e["side"]): e for e in base["entrances"]}
    for i, s in enumerate(props["facade"]):
        path = f"properties.facade.{i}"
        mod = FACADE_MODULES.get(s["module"])
        c = tuple(s["cell"])
        if not mod:
            r.error("facade.module", f"Module de façade inconnu : {s['module']}", path)
            continue
        if c not in cells:
            r.error("facade.outside", f"Module « {mod['label']} » hors de l'emprise.", path)
            continue
        dx, dy = g.DELTA[s["side"]]
        if (c[0] + dx, c[1] + dy) in cells:
            r.error("facade.inner", f"Module « {mod['label']} » sur une face intérieure.", path)
            continue
        if s["floor"] >= props["floors"]:
            r.error("facade.floor", f"Module « {mod['label']} » à l'étage {s['floor']} : le bâtiment n'a que {props['floors']} niveau(x).", path)
        key = (c, s["side"], s["floor"])
        if key in seen:
            r.error("facade.duplicate", "Deux modules au même emplacement de façade.", path)
        seen.add(key)
        if mod["floors"] == "ground" and s["floor"] != 0:
            r.error("facade.ground_only", f"« {mod['label']} » ne se pose qu'au rez-de-chaussée.", path)
        if mod["floors"] == "upper" and s["floor"] == 0:
            r.error("facade.upper_only", f"« {mod['label']} » ne se pose qu'aux étages.", path)
        if s["module"] == "door" and (c, s["side"]) not in entrances:
            r.warn("facade.door_without_entrance", "Porte dessinée sans entrée déclarée à cet endroit (porte décorative).", path)
        if s["floor"] == 0 and (c, s["side"]) in entrances and s["module"] not in ("door", "shopfront", "garage", "auto"):
            r.warn("facade.entrance_hidden", f"L'entrée « {entrances[(c, s['side'])]['id']} » est masquée par « {mod['label']} ».", path)


# ---------------------------------------------------------------- routes

ROAD_SIDES = {
    "straight": {"N", "S"}, "ramp": {"N", "S"}, "curve_left": {"S", "W"}, "curve_right": {"S", "E"},
    "tee": {"E", "S", "W"}, "cross": {"N", "E", "S", "W"}, "end": {"S"},
}


def _validate_road(r: Report, base: dict, props: dict):
    fp = base["footprint"]
    if fp["kind"] != "rect" or fp["w"] != fp["d"]:
        r.error("road.footprint", "Un segment routier occupe une emprise carrée (largeur = longueur).", "footprint")
        return
    size = fp["w"]
    if base["entrances"]:
        r.error("road.entrances", "Un segment routier n'a pas d'entrée de bâtiment.", "entrances")
    conns = base["connectors"]
    sides = [c["side"] for c in conns]
    if len(set(sides)) != len(sides):
        r.error("road.connector_side", "Deux raccords sur le même côté.", "connectors")
    expected = ROAD_SIDES[props["kind"]]
    if set(sides) != expected:
        r.error("road.connector_layout",
                f"Un segment « {props['kind']} » à rotation 0 doit avoir ses raccords sur : {', '.join(sorted(expected))} "
                f"(actuel : {', '.join(sorted(sides)) or 'aucun'}).", "connectors")
    for i, c in enumerate(conns):
        if c["width_cells"] != size:
            r.error("road.connector_width", f"Raccord {c['id']} : largeur {c['width_cells']} ≠ emprise {size}.", f"connectors.{i}")
        if c["lanes"] != props["lanes"]:
            r.error("road.connector_lanes", f"Raccord {c['id']} : {c['lanes']} voies ≠ {props['lanes']} voies du segment.", f"connectors.{i}")
        if props["lanes"] > size * 2:
            r.error("road.lanes_width", f"{props['lanes']} voies ne tiennent pas sur {size} case(s).", "properties.lanes")
    flows = [c["flow"] for c in conns]
    if props["oneway"]:
        if props["kind"] not in ("straight", "curve_left", "curve_right", "ramp"):
            r.error("road.oneway_kind", "Le sens unique n'est pris en charge que pour les droites, virages et rampes.", "properties.oneway")
        elif sorted(flows) != ["in", "out"]:
            r.error("road.oneway_flow", "Un sens unique doit avoir exactement un raccord entrant et un sortant.", "connectors")
    elif any(f != "both" for f in flows):
        r.error("road.twoway_flow", "Une route à double sens doit avoir des raccords « both ».", "connectors")
    levels = {c["level"] for c in conns}
    if props["kind"] == "ramp":
        if len(levels) != 2 or abs(max(levels) - min(levels)) != 1:
            r.error("road.ramp_levels", "Une rampe relie deux niveaux consécutifs.", "connectors")
    elif len(levels) > 1:
        r.error("road.levels", "Tous les raccords d'un segment non incliné doivent être au même niveau.", "connectors")
    if props["lanes"] % 2 == 1 and not props["oneway"]:
        r.warn("road.odd_lanes", "Nombre de voies impair en double sens : la voie centrale sera partagée.", "properties.lanes")


def connectors_compatible(a: dict, b: dict) -> tuple[bool, str]:
    """a et b se font face. Retourne (compatible, raison)."""
    if a["width_cells"] != b["width_cells"]:
        return False, f"largeurs différentes ({a['width_cells']} / {b['width_cells']} cases)"
    if a["lanes"] != b["lanes"]:
        return False, f"nombre de voies différent ({a['lanes']} / {b['lanes']})"
    if a["level"] != b["level"]:
        return False, f"niveaux différents ({a['level']} / {b['level']})"
    pair = {a["flow"], b["flow"]}
    if a["flow"] == "both" and b["flow"] == "both":
        return True, ""
    if pair == {"in", "out"}:
        return True, ""
    return False, f"sens de circulation incompatibles ({a['flow']} / {b['flow']})"


# ---------------------------------------------------------------- intérieurs

def furniture_spec(item: str, resolve: Resolver | None) -> Optional[dict]:
    """Spécification d'un meuble : intégré, ou asset « furniture » (définition publiée sinon dernière)."""
    if item in FURNITURE:
        return {**FURNITURE[item], "published": True, "archived": False}
    info = resolve(item) if resolve else None
    if not info or info["family"] != "furniture":
        return None
    d = info["published_definition"] or info["latest_definition"]
    p = d["properties"]
    return {"label": d["name"], "w": p.get("w", 1), "d": p.get("d", 1), "actions": p.get("actions", []),
            "published": info["published_definition"] is not None, "archived": info["archived"]}


def interior_walk(props: dict) -> dict:
    """Circulation : cases atteignables depuis le point d'apparition (pièces, portes, meubles bloquants)."""
    owner: dict[g.Cell, str] = {}
    for room in props["rooms"]:
        for yy in range(room["y"], room["y"] + room["d"]):
            for xx in range(room["x"], room["x"] + room["w"]):
                owner.setdefault((xx, yy), room["id"])
    blocked = {tuple(c) for c in props["forbidden"]}
    for f in props["furniture"]:
        for yy in range(f["y"], f["y"] + f["d"]):
            for xx in range(f["x"], f["x"] + f["w"]):
                blocked.add((xx, yy))
    door_edges = set()
    for d in props["doors"]:
        c = tuple(d["cell"])
        dx, dy = g.DELTA[d["side"]]
        n = (c[0] + dx, c[1] + dy)
        door_edges.add((c, n)); door_edges.add((n, c))
    start = tuple(props["spawn"])
    seen = set()
    if start in owner and start not in blocked:
        seen.add(start)
        q = deque([start])
        while q:
            c = q.popleft()
            for dx, dy in g.DELTA.values():
                n = (c[0] + dx, c[1] + dy)
                if n in seen or n not in owner or n in blocked:
                    continue
                if owner[n] != owner[c] and (c, n) not in door_edges:
                    continue
                seen.add(n); q.append(n)
    walkable = {c for c in owner if c not in blocked}
    return {"reachable": seen, "walkable": walkable, "owner": owner}


def _validate_interior(r: Report, base: dict, props: dict, resolve: Resolver | None = None, for_publish: bool = False):
    W, D = props["width"], props["depth"]
    rooms = {}
    owner: dict[g.Cell, str] = {}
    for i, room in enumerate(props["rooms"]):
        path = f"properties.rooms.{i}"
        if room["id"] in rooms:
            r.error("room.duplicate", f"Pièce en double : {room['id']}", path)
            continue
        if room["x"] + room["w"] > W or room["y"] + room["d"] > D:
            r.error("room.outside", f"La pièce « {room['name']} » dépasse les limites de l'intérieur ({W}×{D}).", path)
        rooms[room["id"]] = room
        for yy in range(room["y"], room["y"] + room["d"]):
            for xx in range(room["x"], room["x"] + room["w"]):
                if (xx, yy) in owner:
                    r.error("room.overlap", f"Les pièces « {owner[(xx, yy)]} » et « {room['id']} » se chevauchent.", path)
                    break
                owner[(xx, yy)] = room["id"]
            else:
                continue
            break
    if not rooms:
        r.error("interior.no_rooms", "Un intérieur doit contenir au moins une pièce.", "properties.rooms")
        return

    # Portes et graphe d'accessibilité
    graph: dict[str, set[str]] = {k: set() for k in list(rooms) + ["exterior"]}
    door_cells: set[g.Cell] = set()
    for i, d in enumerate(props["doors"]):
        path = f"properties.doors.{i}"
        c = tuple(d["cell"])
        a, b = d["connects"]
        if a not in rooms:
            r.error("door.room", f"Porte « {d['id']} » : pièce inconnue {a}.", path); continue
        if b != "exterior" and b not in rooms:
            r.error("door.room", f"Porte « {d['id']} » : pièce inconnue {b}.", path); continue
        if owner.get(c) != a:
            r.error("door.cell", f"Porte « {d['id']} » : la case {list(c)} n'est pas dans la pièce {a}.", path); continue
        dx, dy = g.DELTA[d["side"]]
        n = (c[0] + dx, c[1] + dy)
        if b == "exterior":
            if 0 <= n[0] < W and 0 <= n[1] < D:
                r.error("door.exterior", f"Porte « {d['id']} » : une sortie doit donner hors des limites de l'intérieur.", path); continue
        elif owner.get(n) != b:
            r.error("door.blocked", f"Porte « {d['id']} » : elle ne débouche pas dans la pièce {b} (porte bloquée).", path); continue
        graph[a].add(b); graph[b].add(a)
        door_cells.add(c)
        if b != "exterior":
            door_cells.add(n)
    if not graph["exterior"]:
        r.error("interior.no_exit", "Aucune porte ne relie l'intérieur à l'extérieur.", "properties.doors")
    else:
        seen = {"exterior"}
        q = deque(["exterior"])
        while q:
            for n in graph[q.popleft()]:
                if n not in seen:
                    seen.add(n); q.append(n)
        for rid in rooms:
            if rid not in seen:
                r.error("room.unreachable", f"La pièce « {rooms[rid]['name']} » est inaccessible.", "properties.doors")

    forbidden = {tuple(c) for c in props["forbidden"]}
    used: dict[g.Cell, str] = {}
    furn_ok = True
    for i, f in enumerate(props["furniture"]):
        path = f"properties.furniture.{i}"
        spec = furniture_spec(f["item"], resolve)
        if not spec:
            r.error("furniture.unknown", f"Meuble inconnu : {f['item']}", path); furn_ok = False; continue
        if spec["archived"]:
            r.error("furniture.archived", f"Le meuble « {spec['label']} » est archivé.", path)
        if not spec["published"]:
            (r.error if for_publish else r.warn)("furniture.unpublished", f"Le meuble « {spec['label']} » n'est pas encore publié.", path)
        if f["interactive"] and f["action"] not in spec["actions"]:
            r.error("furniture.action", f"Action « {f['action']} » impossible pour {spec['label']}.", path)
        fcells = [(xx, yy) for yy in range(f["y"], f["y"] + f["d"]) for xx in range(f["x"], f["x"] + f["w"])]
        if any(not (0 <= x < W and 0 <= y < D) for x, y in fcells):
            r.error("furniture.outside", f"{spec['label']} « {f['id']} » est hors des limites.", path); furn_ok = False; continue
        rset = {owner.get(c) for c in fcells}
        if None in rset or len(rset) != 1:
            r.error("furniture.room", f"{spec['label']} « {f['id']} » doit être entièrement dans une seule pièce.", path); continue
        for c in fcells:
            if c in used:
                r.error("furniture.overlap", f"{spec['label']} « {f['id']} » chevauche « {used[c]} ».", path); break
            if c in door_cells:
                r.error("furniture.door", f"{spec['label']} « {f['id']} » bloque une porte.", path); break
            if c in forbidden:
                r.error("furniture.forbidden", f"{spec['label']} « {f['id']} » est sur une zone interdite.", path); break
            used[c] = f["id"]

    sp = tuple(props["spawn"])
    if sp not in owner:
        r.error("spawn.outside", "Le point d'apparition doit être dans une pièce.", "properties.spawn")
    elif sp in used or sp in forbidden:
        r.error("spawn.blocked", "Le point d'apparition est occupé.", "properties.spawn")
    elif furn_ok:
        # circulation : depuis l'apparition, chaque meuble interactif doit être approchable
        walk = interior_walk(props)
        reach = walk["reachable"]
        for i, f in enumerate(props["furniture"]):
            if not f["interactive"]:
                continue
            around = {(xx + dx, yy + dy) for yy in range(f["y"], f["y"] + f["d"]) for xx in range(f["x"], f["x"] + f["w"])
                      for dx, dy in g.DELTA.values()}
            if not around & reach:
                r.warn("furniture.unreachable", f"Le meuble « {f['id']} » n'est accessible depuis aucune case libre (circulation bloquée).",
                       f"properties.furniture.{i}")
        lost = [rid for rid, room in rooms.items() if not any(owner.get(c) == rid for c in reach)]
        for rid in lost:
            r.warn("room.blocked", f"La pièce « {rooms[rid]['name']} » n'est pas atteignable à pied depuis le point d'apparition.", "properties.rooms")

    # Emprise minimale du bâtiment hôte, déduite de la taille de l'intérieur
    need = (-(-W // INTERIOR_TILES_PER_CELL), -(-D // INTERIOR_TILES_PER_CELL))
    fp = base["footprint"]
    if fp["kind"] != "rect" or (fp["w"], fp["d"]) != need:
        r.warn("interior.footprint", f"Emprise hôte minimale recalculée : {need[0]}×{need[1]} cases.", "footprint")


# ---------------------------------------------------------------- surfaces, objets, meubles, véhicules

def _validate_surface(r: Report, base: dict, props: dict):
    if props["kind"] not in SURFACE_KINDS:
        r.error("surface.kind", f"Type de surface inconnu : {props['kind']}", "properties.kind")
    elif SURFACE_KINDS[props["kind"]]["terrain"] != props["terrain"]:
        r.warn("surface.terrain", f"Le type « {SURFACE_KINDS[props['kind']]['label']} » correspond d'habitude au terrain "
                                  f"« {SURFACE_KINDS[props['kind']]['terrain']} ».", "properties.terrain")
    if props["terrain"] == "water" and props["walkable"]:
        r.warn("surface.water_walkable", "Une surface d'eau marquée praticable à pied.", "properties.walkable")
    if props["terrain"] == "water" and props["buildable"]:
        r.error("surface.water_buildable", "On ne construit pas sur l'eau : décochez « constructible ».", "properties.buildable")
    if base["height_m"] > 0.5:
        r.warn("surface.height", "Une surface est plate : hauteur ramenée à 0 au rendu.", "height_m")
    if base["entrances"] or base["connectors"]:
        r.error("surface.entrances", "Une surface n'a ni entrée ni raccord.", "entrances")


def _validate_sprite_or_shape(r: Report, base: dict, props: dict, shapes: dict, what: str):
    if base["representation"] == "modular":
        return  # contrôlé par _validate_modular
    if base["representation"] == "sprite":
        if not props.get("sprite"):
            r.error("sprite.missing", f"{what} en mode image : choisissez un fichier dans la médiathèque.", "properties.sprite")
    elif not props.get("shape"):
        r.error("shape.missing", f"{what} procédural : choisissez une forme.", "properties.shape")
    elif props["shape"] not in shapes:
        r.error("shape.unknown", f"Forme inconnue : {props['shape']}", "properties.shape")


def _validate_prop(r: Report, base: dict, props: dict):
    _validate_sprite_or_shape(r, base, props, PROP_SHAPES, "Objet")
    fp = base["footprint"]
    if fp["kind"] == "rect" and fp["w"] * fp["d"] > 36:
        r.warn("prop.large", "Objet très étendu : envisagez la famille Bâtiment ou Surface.", "footprint")
    if base["entrances"]:
        r.error("prop.entrances", "Un objet de décor n'a pas d'entrée : utilisez la famille Bâtiment.", "entrances")


def _validate_furniture(r: Report, base: dict, props: dict):
    _validate_sprite_or_shape(r, base, props, FURNITURE_SHAPES, "Meuble")
    for a in props["actions"]:
        if a not in FURNITURE_ACTIONS:
            r.error("furniture.action_unknown", f"Action inconnue du moteur : {a}", "properties.actions")
    if len(set(props["actions"])) != len(props["actions"]):
        r.error("furniture.action_duplicate", "Action en double.", "properties.actions")


def _validate_vehicle(r: Report, base: dict, props: dict):
    if props["kind"] not in VEHICLE_KINDS:
        r.error("vehicle.kind", f"Type de véhicule inconnu : {props['kind']}", "properties.kind")
    if base["representation"] == "sprite" and not props.get("sprite"):
        r.error("sprite.missing", "Véhicule en mode image : choisissez un fichier dans la médiathèque.", "properties.sprite")
    fp = base["footprint"]
    if fp["kind"] != "rect":
        r.error("vehicle.footprint", "Un véhicule a une emprise rectangulaire.", "footprint")
    for name, (ax, ay) in props["anchors"].items():
        if not (0 <= ax <= fp["w"] and 0 <= ay <= fp["d"]):
            r.error("vehicle.anchor", f"Point d'ancrage « {name} » hors du véhicule.", "properties.anchors")
    if props["roof_sign"] and props["kind"] != "taxi":
        r.warn("vehicle.roof_sign", "Enseigne de toit habituellement réservée aux taxis.", "properties.roof_sign")
    if base["entrances"] or base["connectors"]:
        r.error("vehicle.entrances", "Un véhicule n'a ni entrée de bâtiment ni raccord routier.", "entrances")


# ---------------------------------------------------------------- personnages

def _part_info(resolve: Resolver | None, part_id: str) -> Optional[dict]:
    info = resolve(part_id) if resolve else None
    if not info or info["family"] != "character_part":
        return None
    d = info["published_definition"] or info["latest_definition"]
    return {"id": part_id, "name": d["name"], "props": d["properties"], "archived": info["archived"],
            "published": info["published_definition"] is not None}


def _validate_part(r: Report, base: dict, props: dict, resolve: Resolver | None, media: MediaResolver | None):
    slot = props["slot"]
    if slot not in CHARACTER_SLOTS:
        r.error("part.slot", f"Emplacement inconnu : {slot}", "properties.slot")
        return
    info = media(props["svg_media"]) if media else None
    if media and info and info["kind"] != "svg":
        r.error("part.svg", "Un composant de personnage doit être un fichier SVG.", "properties.svg_media")
    channels = set((info or {}).get("meta", {}).get("channels", {}).keys()) if info else set()
    if info and not channels:
        r.warn("part.not_recolorable", "Aucun canal de couleur : le composant sera rendu avec ses couleurs d'origine.", "properties.svg_media")
    for ch in props["default_colors"]:
        if info and ch not in channels:
            r.warn("part.channel_unused", f"Couleur par défaut pour un canal absent du SVG : {ch}", "properties.default_colors")
    for ch in props["palette"]:
        if ch not in LAYER_CHANNELS:
            r.error("part.palette", f"Palette définie pour un canal non réglable par calque : {ch}", "properties.palette")
    vb = (info or {}).get("meta", {}).get("view_box")
    if vb and slot != "pattern" and [round(v) for v in vb] != CHARACTER_FRAME and props["scale"] == 1 and props["offset"] == [0, 0]:
        r.warn("part.frame", f"viewBox {vb} différent du repère commun 0 0 200 380 : ajustez l'échelle et le décalage.", "properties.scale")
    if props["anchor"] and props["anchor"] not in BODY_ANCHORS:
        r.error("part.anchor", f"Point d'ancrage inconnu : {props['anchor']}", "properties.anchor")
    if slot == "body":
        missing = [a for a in REQUIRED_BODY_ANCHORS if a not in props["anchors"]]
        if missing:
            r.error("part.body_anchors", f"Un corps doit définir les ancrages : {', '.join(missing)}.", "properties.anchors")
        for a in props["anchors"]:
            if a not in BODY_ANCHORS:
                r.error("part.anchor", f"Ancrage inconnu : {a}", "properties.anchors")
    for s in props["incompatible_slots"] + props["requires_slots"]:
        if s not in CHARACTER_SLOTS:
            r.error("part.slot_ref", f"Emplacement inconnu : {s}", "properties.incompatible_slots")
    for b in props["bodies"]:
        bi = _part_info(resolve, b)
        if not bi or bi["props"].get("slot") != "body":
            r.error("part.body_ref", f"Corps compatible introuvable : {b}", "properties.bodies")
    if slot == "pattern" and props["anchor"]:
        r.warn("part.pattern_anchor", "Un motif n'utilise pas de point d'ancrage.", "properties.anchor")
    if slot == "body" and not props["gender"]:
        r.warn("part.body_gender", "Silhouette sans genre : les composants réservés (maquillage, talons, barbe…) ne pourront pas être contrôlés.", "properties.gender")
    if slot != "body" and props["gender"]:
        r.warn("part.gender_ignored", "Seule une silhouette a un genre ; utilisez « Réservé à » pour un composant.", "properties.gender")
    if slot == "body" and props["genders"]:
        r.warn("part.genders_ignored", "« Réservé à » ne s'applique pas à une silhouette.", "properties.genders")


GENDER_LABEL = {"male": "masculines", "female": "féminines"}


def character_layers(props: dict, variant: dict | None = None) -> tuple[dict, dict]:
    """Calques et couleurs globales effectifs, variante appliquée."""
    layers = dict(props.get("layers") or {})
    globals_ = {"skin": props.get("skin"), "hair_color": props.get("hair_color"), "eye_color": props.get("eye_color")}
    if variant:
        vp = variant.get("props") or {}
        for slot, layer in (vp.get("layers") or {}).items():
            if layer is None:
                layers.pop(slot, None)
            else:
                layers[slot] = layer
        for k in globals_:
            if k in vp:
                globals_[k] = vp[k]
    return layers, globals_


def check_outfit(r: Report, props: dict, layers: dict, resolve: Resolver | None, for_publish: bool, prefix: str = ""):
    body = _part_info(resolve, props["body"])
    if not body or body["props"].get("slot") != "body":
        r.error("character.body", f"{prefix}Corps introuvable : {props['body']}", "properties.body")
        return
    if body["archived"]:
        r.error("character.archived", f"{prefix}Le corps « {body['name']} » est archivé.", "properties.body")
    if not body["published"]:
        (r.error if for_publish else r.warn)("character.unpublished", f"{prefix}Le corps « {body['name']} » n'est pas publié.", "properties.body")
    parts = {}
    for slot, layer in layers.items():
        path = f"properties.layers.{slot}"
        if slot not in CHARACTER_SLOTS or slot in ("body", "pattern"):
            r.error("character.slot", f"{prefix}Emplacement inconnu : {slot}", path)
            continue
        p = _part_info(resolve, layer["part"])
        if not p:
            r.error("character.part_missing", f"{prefix}Composant introuvable : {layer['part']}", path)
            continue
        if p["props"].get("slot") != slot:
            r.error("character.part_slot", f"{prefix}« {p['name']} » est un composant « {p['props'].get('slot')} », pas « {slot} ».", path)
            continue
        if p["archived"]:
            r.error("character.archived", f"{prefix}Le composant « {p['name']} » est archivé.", path)
        if not p["published"]:
            (r.error if for_publish else r.warn)("character.unpublished", f"{prefix}Le composant « {p['name']} » n'est pas publié.", path)
        if p["props"].get("bodies") and props["body"] not in p["props"]["bodies"]:
            r.error("character.body_incompatible", f"{prefix}« {p['name']} » n'est pas compatible avec le corps « {body['name']} ».", path)
        allowed = p["props"].get("genders") or []
        bg = body["props"].get("gender")
        if allowed and bg and bg not in allowed:
            r.error("character.gender", f"{prefix}« {p['name']} » est réservé aux silhouettes {' et '.join(GENDER_LABEL[g] for g in allowed)}.", path)
        elif allowed and not bg:
            r.warn("character.gender_unknown", f"{prefix}« {p['name']} » est réservé à un genre mais la silhouette « {body['name']} » n'en déclare pas.", path)
        for ch, col in (layer.get("colors") or {}).items():
            if ch not in LAYER_CHANNELS:
                r.error("character.channel", f"{prefix}Canal non réglable : {ch}", path)
                continue
            pal = (p["props"].get("palette") or {}).get(ch) or []
            if pal and col.lower() not in [c.lower() for c in pal]:
                r.error("character.palette", f"{prefix}Couleur {col} non autorisée pour « {p['name']} » ({ch}).", path)
        pat = layer.get("pattern")
        if pat:
            pp = _part_info(resolve, pat["part"])
            if not pp or pp["props"].get("slot") != "pattern":
                r.error("character.pattern", f"{prefix}Motif introuvable : {pat['part']}", path)
            elif not pp["published"]:
                (r.error if for_publish else r.warn)("character.unpublished", f"{prefix}Le motif « {pp['name']} » n'est pas publié.", path)
        parts[slot] = p
    for slot, p in parts.items():
        for other in p["props"].get("incompatible_slots") or []:
            if other in parts:
                r.error("character.incompatible", f"{prefix}« {p['name']} » est incompatible avec l'emplacement « {CHARACTER_SLOTS.get(other, {}).get('label', other)} ».",
                        f"properties.layers.{slot}")
        for pid in p["props"].get("incompatible_parts") or []:
            if any(q["id"] == pid for q in parts.values()):
                q = next(q for q in parts.values() if q["id"] == pid)
                r.error("character.incompatible", f"{prefix}« {p['name']} » est incompatible avec « {q['name']} ».", f"properties.layers.{slot}")
        for need in p["props"].get("requires_slots") or []:
            if need not in parts:
                r.error("character.requires", f"{prefix}« {p['name']} » nécessite un composant « {CHARACTER_SLOTS.get(need, {}).get('label', need)} ».",
                        f"properties.layers.{slot}")
    if not ({"top", "dress", "outerwear"} & set(parts)) or not ({"bottom", "dress"} & set(parts)):
        r.error("character.outfit", f"{prefix}Tenue incomplète : il faut un haut et un bas, ou une robe / un boubou.", "properties.layers")


def _validate_character(r: Report, base: dict, props: dict, resolve: Resolver | None, for_publish: bool):
    layers, _ = character_layers(props)
    check_outfit(r, props, layers, resolve, for_publish)
    for v in base["variants"]:
        if "layers" in v["props"] and isinstance(v["props"]["layers"], dict):
            vl, _ = character_layers(props, v)
            check_outfit(r, props, vl, resolve, for_publish, prefix=f"Variante « {v['name']} » : ")


# ---------------------------------------------------------------- kits modulaires

def _comp_info(resolve: Resolver | None, part_id: str) -> Optional[dict]:
    info = resolve(part_id) if resolve else None
    if not info or info["family"] != "component":
        return None
    d = info["published_definition"] or info["latest_definition"]
    return {"id": part_id, "name": d["name"], "props": d["properties"], "archived": info["archived"],
            "published": info["published_definition"] is not None}


def _validate_component(r: Report, base: dict, props: dict, resolve: Resolver | None, media: MediaResolver | None):
    kit = KITS.get(props["kit"])
    if not kit:
        r.error("component.kit", f"Kit inconnu : {props['kit']}", "properties.kit")
        return
    slot = props["slot"]
    if slot not in kit["slots"]:
        r.error("component.slot", f"Emplacement inconnu pour le kit « {kit['label']} » : {slot}", "properties.slot")
        return
    info = media(props["svg_media"]) if media else None
    if media and info and info["kind"] != "svg":
        r.error("component.svg", "Un composant modulaire doit être un fichier SVG.", "properties.svg_media")
    channels = set((info or {}).get("meta", {}).get("channels", {}).keys()) if info else set()
    if info and not channels:
        r.warn("component.not_recolorable", "Aucun canal de couleur : le composant sera rendu avec ses couleurs d'origine.", "properties.svg_media")
    allowed = set(LAYER_CHANNELS) | set(kit["globals"])
    for ch in sorted(channels - allowed):
        r.warn("component.channel_foreign", f"Canal « {ch} » étranger au kit : il gardera sa couleur par défaut.", "properties.svg_media")
    for ch in props["palette"]:
        if ch not in LAYER_CHANNELS:
            r.error("component.palette", f"Palette définie pour un canal non réglable par calque : {ch}", "properties.palette")
    vb = (info or {}).get("meta", {}).get("view_box")
    frame = " ".join(str(v) for v in kit["frame"])
    if vb and slot != "pattern" and [round(v) for v in vb] != kit["frame"] and props["scale"] == 1 and props["offset"] == [0, 0]:
        r.warn("component.frame", f"viewBox {vb} différent du repère du kit {frame} : ajustez l'échelle et le décalage.", "properties.scale")
    if props["anchor"] and props["anchor"] not in kit["anchors"]:
        r.error("component.anchor", f"Point d'ancrage inconnu dans ce kit : {props['anchor']}", "properties.anchor")
    if slot == "base":
        if props["anchor"]:
            r.warn("component.base_anchor", "Une base ne s'accroche à rien : elle FOURNIT les points d'ancrage.", "properties.anchor")
        missing = [a for a in kit["required_anchors"] if a not in props["anchors"]]
        if missing:
            r.error("component.base_anchors", f"Une base de ce kit doit définir les points d'ancrage : {', '.join(missing)}.", "properties.anchors")
        fx, fy, fw, fh = kit["frame"]
        for a, pts in props["anchors"].items():
            if a not in kit["anchors"]:
                r.error("component.anchor", f"Ancrage inconnu : {a}", "properties.anchors")
            for pt in pts:
                if not (fx <= pt[0] <= fx + fw and fy <= pt[1] <= fy + fh):
                    r.warn("component.anchor_outside", f"Position d'ancrage « {a} » hors du repère.", "properties.anchors")
    elif props["anchors"]:
        r.warn("component.anchors_ignored", "Seule une base fournit des points d'ancrage : ceux-ci sont ignorés.", "properties.anchors")
    for s_ in props["incompatible_slots"] + props["requires_slots"]:
        if s_ not in kit["slots"]:
            r.error("component.slot_ref", f"Emplacement inconnu : {s_}", "properties.incompatible_slots")
    for b in props["bases"]:
        bi = _comp_info(resolve, b)
        if not bi or bi["props"].get("slot") != "base" or bi["props"].get("kit") != props["kit"]:
            r.error("component.base_ref", f"Base compatible introuvable dans ce kit : {b}", "properties.bases")
    if slot == "pattern" and props["anchor"]:
        r.warn("component.pattern_anchor", "Un motif n'utilise pas de point d'ancrage.", "properties.anchor")


def modular_layers(m: dict, variant: dict | None = None) -> tuple[dict, dict, dict]:
    """Calques, couleurs partagées et couleurs de la base effectifs, variante appliquée."""
    layers = dict(m.get("layers") or {})
    colors = dict(m.get("colors") or {})
    base_colors = dict(m.get("base_colors") or {})
    if variant:
        vp = variant.get("props") or {}
        for slot, layer in (vp.get("layers") or {}).items():
            if layer is None:
                layers.pop(slot, None)
            else:
                layers[slot] = layer
        colors.update(vp.get("colors") or {})
        base_colors.update(vp.get("base_colors") or {})
    return layers, colors, base_colors


def _check_pattern(r: Report, kit_key: str, kit: dict, slot: str, pat: dict, resolve, for_publish: bool, prefix: str, path: str):
    if slot not in kit["pattern_slots"]:
        r.error("modular.pattern_slot", f"{prefix}L'emplacement « {kit['slots'].get(slot, {}).get('label', slot)} » n'accepte pas de motif.", path)
        return
    pp = _comp_info(resolve, pat["part"])
    if not pp or pp["props"].get("slot") != "pattern" or pp["props"].get("kit") != kit_key:
        r.error("modular.pattern", f"{prefix}Motif introuvable dans ce kit : {pat['part']}", path)
    elif pp["archived"]:
        r.error("modular.archived", f"{prefix}Le motif « {pp['name']} » est archivé.", path)
    elif not pp["published"]:
        (r.error if for_publish else r.warn)("modular.unpublished", f"{prefix}Le motif « {pp['name']} » n'est pas publié.", path)


def _check_colors(r: Report, part: dict, colors: dict, prefix: str, path: str):
    for ch, col in (colors or {}).items():
        if ch not in LAYER_CHANNELS:
            r.error("modular.channel", f"{prefix}Canal non réglable : {ch}", path)
            continue
        pal = (part["props"].get("palette") or {}).get(ch) or []
        if pal and col.lower() not in [c.lower() for c in pal]:
            r.error("modular.palette", f"{prefix}Couleur {col} non autorisée pour « {part['name']} » ({ch}).", path)


def check_assembly(r: Report, m: dict, layers: dict, colors: dict, base_colors: dict, family: str,
                   resolve: Resolver | None, for_publish: bool, prefix: str = "") -> dict | None:
    """Règles d'un assemblage modulaire (miroir de frontend/src/modular/compose.ts : checkAssembly)."""
    kit = KITS.get(m["kit"])
    if not kit:
        r.error("modular.kit", f"{prefix}Kit inconnu : {m['kit']}", "properties.modular.kit")
        return None
    if kit["family"] != family:
        r.error("modular.kit_family", f"{prefix}Le kit « {kit['label']} » ne s'applique pas à cette famille.", "properties.modular.kit")
        return None
    base = _comp_info(resolve, m["base"])
    if not base or base["props"].get("slot") != "base" or base["props"].get("kit") != m["kit"]:
        r.error("modular.base", f"{prefix}Base introuvable dans le kit « {kit['label']} » : {m['base']}", "properties.modular.base")
        return None
    if base["archived"]:
        r.error("modular.archived", f"{prefix}La base « {base['name']} » est archivée.", "properties.modular.base")
    if not base["published"]:
        (r.error if for_publish else r.warn)("modular.unpublished", f"{prefix}La base « {base['name']} » n'est pas publiée.", "properties.modular.base")
    for ch in colors:
        if ch not in kit["globals"]:
            r.error("modular.global", f"{prefix}Couleur partagée inconnue dans ce kit : {ch}", "properties.modular.colors")
    _check_colors(r, base, base_colors, prefix, "properties.modular.base_colors")
    if m.get("base_pattern"):
        _check_pattern(r, m["kit"], kit, "base", m["base_pattern"], resolve, for_publish, prefix, "properties.modular.base_pattern")
    anchors = base["props"].get("anchors") or {}
    parts: dict[str, dict] = {}
    for slot, layer in layers.items():
        path = f"properties.modular.layers.{slot}"
        if slot not in kit["slots"] or slot in ("base", "pattern"):
            r.error("modular.slot", f"{prefix}Emplacement inconnu : {slot}", path)
            continue
        label = kit["slots"][slot]["label"]
        p = _comp_info(resolve, layer["part"])
        if not p:
            r.error("modular.part_missing", f"{prefix}Composant introuvable : {layer['part']}", path)
            continue
        if p["props"].get("kit") != m["kit"]:
            r.error("modular.part_kit", f"{prefix}« {p['name']} » appartient à un autre kit.", path)
            continue
        if p["props"].get("slot") != slot:
            other = kit["slots"].get(p["props"].get("slot"), {}).get("label", p["props"].get("slot"))
            r.error("modular.part_slot", f"{prefix}« {p['name']} » est un composant « {other} », pas « {label} ».", path)
            continue
        if p["archived"]:
            r.error("modular.archived", f"{prefix}Le composant « {p['name']} » est archivé.", path)
        if not p["published"]:
            (r.error if for_publish else r.warn)("modular.unpublished", f"{prefix}Le composant « {p['name']} » n'est pas publié.", path)
        if p["props"].get("bases") and m["base"] not in p["props"]["bases"]:
            r.error("modular.base_incompatible", f"{prefix}« {p['name']} » n'est pas compatible avec la base « {base['name']} ».", path)
        a = p["props"].get("anchor")
        if a and a not in anchors:
            r.error("modular.anchor_missing", f"{prefix}« {p['name']} » ne peut pas s'accrocher : la base « {base['name']} » n'a pas de point « {a} ».", path)
        elif a and not anchors[a]:
            r.warn("modular.anchor_empty", f"{prefix}« {p['name']} » n'apparaît pas : la base « {base['name']} » n'a aucune position « {a} ».", path)
        _check_colors(r, p, layer.get("colors"), prefix, path)
        if layer.get("pattern"):
            _check_pattern(r, m["kit"], kit, slot, layer["pattern"], resolve, for_publish, prefix, path)
        parts[slot] = p
    for slot, p in parts.items():
        path = f"properties.modular.layers.{slot}"
        for other in p["props"].get("incompatible_slots") or []:
            if other in parts:
                r.error("modular.incompatible", f"{prefix}« {p['name']} » est incompatible avec l'emplacement « {kit['slots'].get(other, {}).get('label', other)} ».", path)
        for pid in p["props"].get("incompatible_parts") or []:
            q = next((q for q in parts.values() if q["id"] == pid), None)
            if q or pid == m["base"]:
                r.error("modular.incompatible", f"{prefix}« {p['name']} » est incompatible avec « {(q or base)['name']} ».", path)
        for need in p["props"].get("requires_slots") or []:
            if need not in parts:
                r.error("modular.requires", f"{prefix}« {p['name']} » nécessite un composant « {kit['slots'].get(need, {}).get('label', need)} ».", path)
    for slot, spec in kit["slots"].items():
        if spec.get("required") and slot != "base" and slot not in parts:
            r.error("modular.required", f"{prefix}Emplacement obligatoire vide : {spec['label']}.", "properties.modular.layers")
    return base


def _validate_modular(r: Report, base: dict, props: dict, family: str, resolve: Resolver | None, for_publish: bool):
    m = props.get("modular")
    if base["representation"] != "modular":
        if m:
            r.warn("modular.ignored", "Assemblage modulaire présent mais représentation différente : il est ignoré au rendu.", "representation")
        return
    if not m:
        r.error("modular.missing", "Représentation modulaire : choisissez un kit et une base.", "properties.modular")
        return
    layers, colors, base_colors = modular_layers(m)
    b = check_assembly(r, m, layers, colors, base_colors, family, resolve, for_publish)
    if b and family == "building":
        levels = len((b["props"].get("anchors") or {}).get("floors") or []) + 1
        if levels != props["floors"]:
            r.warn("modular.floors", f"La structure « {b['name']} » a {levels} niveau(x) mais le bâtiment en déclare {props['floors']}.", "properties.floors")
    for v in base["variants"]:
        vp = v["props"]
        if any(k in vp for k in ("layers", "colors", "base_colors")):
            vl, vc, vb = modular_layers(m, v)
            check_assembly(r, m, vl, vc, vb, family, resolve, for_publish, prefix=f"Variante « {v['name']} » : ")


def normalize(defn: dict, category: str) -> dict:
    """Forme canonique (valeurs par défaut explicites) + champs dérivés recalculés côté serveur."""
    cat = CATEGORY_BY_KEY.get(category)
    family = cat["family"] if cat else None
    try:
        defn = AssetDefinition.model_validate(defn).model_dump()
        if family in FAMILY_PROPS:
            defn["properties"] = FAMILY_PROPS[family].model_validate(defn["properties"]).model_dump()
    except ValidationError:
        return defn  # la validation signalera les erreurs ; on conserve la saisie telle quelle
    p = defn.get("properties") or {}
    if family == "interior":
        w, d = p.get("width", 8), p.get("depth", 8)
        if isinstance(w, int) and isinstance(d, int) and w > 0 and d > 0:
            defn["footprint"] = {"kind": "rect", "w": -(-w // INTERIOR_TILES_PER_CELL), "d": -(-d // INTERIOR_TILES_PER_CELL), "cells": None}
    elif family == "furniture":
        defn["footprint"] = {"kind": "rect", "w": 1, "d": 1, "cells": None}
        defn["anchor"] = [0, 0]
    elif family == "character":
        defn["footprint"] = {"kind": "rect", "w": 1, "d": 1, "cells": None}
        defn["anchor"] = [0, 0]
        defn["collision"] = "none"
        defn["height_m"] = round(1.75 * p.get("height_scale", 1.0), 2)
    elif family in ("character_part", "component"):
        defn["footprint"] = {"kind": "rect", "w": 1, "d": 1, "cells": None}
        defn["anchor"] = [0, 0]
        defn["collision"] = "none"
        defn["height_m"] = 0
    elif family == "surface":
        defn["height_m"] = 0
    return defn
