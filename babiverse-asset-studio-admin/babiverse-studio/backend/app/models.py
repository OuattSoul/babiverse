"""Modèle universel d'asset + extensions typées par famille (pydantic v2, strict).

Tous les champs ajoutés depuis le prototype v0.1 ont une valeur par défaut : une définition ancienne
reste valide telle quelle (rétrocompatibilité sans réécriture des versions publiées).
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

Side = Literal["N", "E", "S", "W"]
Cell = Annotated[list[int], Field(min_length=2, max_length=2)]
Point = Annotated[list[float], Field(min_length=2, max_length=2)]
Slug = Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9_\-]{0,47}$")]
RefId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$")]
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")


def _check_hex_map(v: dict[str, str]) -> dict[str, str]:
    for k, c in v.items():
        if not HEX.match(c):
            raise ValueError(f"couleur invalide pour {k}: {c}")
    return v


def _check_hex(v: str) -> str:
    if not HEX.match(v):
        raise ValueError(f"couleur invalide : {v}")
    return v


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Footprint(Strict):
    kind: Literal["rect", "cells"] = "rect"
    w: int = Field(1, ge=1, le=64)
    d: int = Field(1, ge=1, le=64)
    cells: Optional[list[Cell]] = None


class Entrance(Strict):
    id: Slug
    cell: Cell
    side: Side
    kind: Literal["main", "service", "emergency", "delivery"] = "main"


class Connector(Strict):
    id: Slug
    side: Side
    kind: Literal["road"] = "road"
    lanes: int = Field(2, ge=1, le=8)
    width_cells: int = Field(2, ge=1, le=8)
    level: int = Field(0, ge=-2, le=4)
    flow: Literal["both", "in", "out"] = "both"


class Zone(Strict):
    id: Slug
    kind: Literal["interaction", "safety", "forbidden", "delivery", "parking"]
    label: str = Field("", max_length=60)
    cells: list[Cell] = Field(default_factory=list, max_length=256)


class Variant(Strict):
    id: Slug
    name: str = Field(min_length=1, max_length=60)
    description: str = Field("", max_length=200)
    materials: dict[str, str] = Field(default_factory=dict)
    props: dict[str, Any] = Field(default_factory=dict)

    _hex = field_validator("materials")(classmethod(lambda cls, v: _check_hex_map(v)))


class PlacementRules(Strict):
    allowed_terrain: list[Literal["ground", "sand", "water"]] = Field(default_factory=lambda: ["ground"])
    road_access: Literal["required", "preferred", "none"] = "preferred"
    safety_margin: int = Field(0, ge=0, le=4)
    max_height_m: Optional[float] = Field(None, gt=0, le=300)


class BehaviorRef(Strict):
    id: Slug
    params: dict[str, Any] = Field(default_factory=dict)


class AssetDefinition(Strict):
    """Contenu versionné d'un asset. Identité stable (id, nom technique, catégorie) : voir table assets."""
    name: str = Field(min_length=2, max_length=80)
    description: str = Field("", max_length=1000)
    subcategory: Optional[str] = Field(None, max_length=60)
    tags: list[Annotated[str, Field(max_length=30)]] = Field(default_factory=list, max_length=20)
    representation: Literal["procedural", "segment", "surface", "assembly", "model", "sprite", "svg", "modular"]
    unit: Literal["cell"] = "cell"
    cell_size_m: float = Field(2.0, gt=0, le=10)
    footprint: Footprint
    height_m: float = Field(3.0, ge=0, le=300)
    anchor: Cell = Field(default_factory=lambda: [0, 0])
    default_rotation: Literal[0, 90, 180, 270] = 0
    entrances: list[Entrance] = Field(default_factory=list, max_length=16)
    connectors: list[Connector] = Field(default_factory=list, max_length=4)
    collision: Literal["footprint", "none"] = "footprint"
    zones: list[Zone] = Field(default_factory=list, max_length=32)
    materials: dict[str, str] = Field(default_factory=dict)
    variants: list[Variant] = Field(default_factory=list, max_length=32)
    default_variant: Optional[str] = Field(None, max_length=48)
    placement: PlacementRules = Field(default_factory=PlacementRules)
    resources: list[RefId] = Field(default_factory=list, max_length=32)  # identifiants de médias utilisés
    cover: Optional[RefId] = None  # image de couverture (média)
    behaviors: list[BehaviorRef] = Field(default_factory=list, max_length=16)
    properties: dict[str, Any] = Field(default_factory=dict)

    _hex = field_validator("materials")(classmethod(lambda cls, v: _check_hex_map(v)))


# ---------- Assemblage modulaire (kits hors personnages) ----------

class ModularPattern(Strict):
    part: RefId
    colors: dict[str, str] = Field(default_factory=dict)
    channel: Literal["primary", "secondary", "accent"] = "primary"
    scale: float = Field(1.0, ge=0.25, le=4)

    _hex = field_validator("colors")(classmethod(lambda cls, v: _check_hex_map(v)))


class ModularLayer(Strict):
    part: RefId
    colors: dict[str, str] = Field(default_factory=dict)
    pattern: Optional[ModularPattern] = None

    _hex = field_validator("colors")(classmethod(lambda cls, v: _check_hex_map(v)))


class ModularProps(Strict):
    """Assemblage déclaratif : une base du kit + un composant par emplacement (voir taxonomy.KITS)."""
    kit: str = Field(min_length=1, max_length=24)
    base: RefId
    base_colors: dict[str, str] = Field(default_factory=dict)  # couleurs propres de la base (primary…)
    base_pattern: Optional[ModularPattern] = None
    colors: dict[str, str] = Field(default_factory=dict)  # couleurs partagées du kit (globals)
    layers: dict[str, ModularLayer] = Field(default_factory=dict)

    _hex = field_validator("colors", "base_colors")(classmethod(lambda cls, v: _check_hex_map(v)))


class ComponentProps(Strict):
    """Pièce SVG d'un kit modulaire. Une base (slot « base ») déclare ses points d'ancrage (listes de positions)."""
    kit: str = Field(min_length=1, max_length=24)
    slot: str = Field(min_length=1, max_length=24)
    svg_media: RefId
    offset: Point = Field(default_factory=lambda: [0.0, 0.0])
    scale: float = Field(1.0, gt=0.1, le=5)
    anchor: Optional[str] = Field(None, max_length=24)
    z: Optional[int] = Field(None, ge=-50, le=200)
    default_colors: dict[str, str] = Field(default_factory=dict)
    palette: dict[str, list[str]] = Field(default_factory=dict)
    bases: list[RefId] = Field(default_factory=list, max_length=16)  # bases compatibles (vide = toutes)
    requires_slots: list[str] = Field(default_factory=list, max_length=8)
    incompatible_slots: list[str] = Field(default_factory=list, max_length=8)
    incompatible_parts: list[RefId] = Field(default_factory=list, max_length=32)
    anchors: dict[str, list[Point]] = Field(default_factory=dict)  # bases seulement

    _hex = field_validator("default_colors")(classmethod(lambda cls, v: _check_hex_map(v)))

    @field_validator("palette")
    @classmethod
    def _pal(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        for k, cols in v.items():
            if len(cols) > 24:
                raise ValueError(f"palette {k} : 24 couleurs maximum")
            for c in cols:
                _check_hex(c)
        return v

    @field_validator("anchors")
    @classmethod
    def _anch(cls, v: dict[str, list[list[float]]]) -> dict[str, list[list[float]]]:
        for k, pts in v.items():
            if len(pts) > 12:
                raise ValueError(f"ancrage {k} : 12 positions maximum")
        return v


# ---------- Extensions par famille ----------

class InteriorLink(Strict):
    interior_id: str = Field(min_length=1, max_length=64)
    label: str = Field("Base", max_length=40)
    min_level: int = Field(1, ge=1, le=10)


class BuildingStyle(Strict):
    roof: Literal["flat", "gable", "hip"] = "flat"
    window_style: Literal["none", "grid", "band"] = "grid"
    door_style: Literal["wood", "glass", "metal"] = "wood"


class ShopProps(Strict):
    sign_text: str = Field("", max_length=24)
    shopfront: bool = True
    awning: bool = True
    goods_slots: int = Field(0, ge=0, le=200)


class FacadeSlot(Strict):
    """Module de façade posé sur une case de bord, un côté et un étage (assemblage modulaire)."""
    cell: Cell
    side: Side
    floor: int = Field(0, ge=0, le=39)
    module: str = Field(min_length=1, max_length=24)


class BuildingProps(Strict):
    floors: int = Field(1, ge=1, le=40)
    occupancy: int = Field(0, ge=0, le=20000)
    ownership: Literal["player", "npc", "admin", "decor"] = "npc"
    assignable_to_player: bool = False
    upgrade_level: Optional[int] = Field(None, ge=1, le=10)
    interiors: list[InteriorLink] = Field(default_factory=list, max_length=8)
    style: BuildingStyle = Field(default_factory=BuildingStyle)
    shop: Optional[ShopProps] = None
    facade: list[FacadeSlot] = Field(default_factory=list, max_length=512)
    modular: Optional[ModularProps] = None


class Room(Strict):
    id: Slug
    name: str = Field(min_length=1, max_length=40)
    type: Literal["living", "bedroom", "kitchen", "bathroom", "toilet", "office", "dining", "corridor",
                  "terrace", "garage", "shop", "classroom", "consultation", "waiting", "meeting", "lobby"]
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1, le=64)
    d: int = Field(ge=1, le=64)


class Door(Strict):
    id: Slug
    cell: Cell
    side: Side
    connects: Annotated[list[str], Field(min_length=2, max_length=2)]


class Furniture(Strict):
    id: Slug
    item: str = Field(min_length=1, max_length=64)  # meuble intégré (clé) ou asset « furniture » (identifiant)
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(1, ge=1, le=8)
    d: int = Field(1, ge=1, le=8)
    interactive: bool = False
    action: Optional[str] = Field(None, max_length=20)


class InteriorProps(Strict):
    mode: Literal["instanced", "open", "decorative"] = "instanced"
    width: int = Field(8, ge=2, le=64)
    depth: int = Field(8, ge=2, le=64)
    rooms: list[Room] = Field(default_factory=list, max_length=32)
    doors: list[Door] = Field(default_factory=list, max_length=64)
    furniture: list[Furniture] = Field(default_factory=list, max_length=256)
    spawn: Cell = Field(default_factory=lambda: [0, 0])
    forbidden: list[Cell] = Field(default_factory=list, max_length=256)


class RoadProps(Strict):
    kind: Literal["straight", "curve_left", "curve_right", "tee", "cross", "end", "ramp"]
    lanes: int = Field(2, ge=1, le=8)
    oneway: bool = False
    sidewalk: bool = True
    markings: Literal["none", "dashed", "solid", "double"] = "dashed"


class SpriteRef(Strict):
    media: RefId
    anchor: Point = Field(default_factory=lambda: [0.5, 1.0])  # point au sol, en fraction de l'image
    scale: float = Field(1.0, gt=0.01, le=10)


class SurfaceProps(Strict):
    kind: str = Field("grass", max_length=24)
    terrain: Literal["ground", "sand", "water"] = "ground"
    walkable: bool = True
    buildable: bool = False
    pattern: Literal["plain", "stripes", "checker", "dots", "waves"] = "plain"
    texture: Optional[RefId] = None
    modular: Optional[ModularProps] = None


class PropProps(Strict):
    shape: Optional[str] = Field(None, max_length=24)
    sprite: Optional[SpriteRef] = None
    modular: Optional[ModularProps] = None


class FurnitureProps(Strict):
    shape: str = Field("box", max_length=24)
    w: int = Field(1, ge=1, le=8)
    d: int = Field(1, ge=1, le=8)
    height_px: int = Field(10, ge=1, le=80)
    actions: list[str] = Field(default_factory=list, max_length=6)
    sprite: Optional[SpriteRef] = None
    modular: Optional[ModularProps] = None


class VehicleProps(Strict):
    kind: str = Field("car", max_length=24)
    stripe: bool = False
    roof_sign: Optional[str] = Field(None, max_length=12)
    seats: int = Field(4, ge=1, le=80)
    parking: Literal["road", "parking", "anywhere"] = "road"
    anchors: dict[str, Point] = Field(default_factory=dict)  # points d'ancrage nommés (conducteur, porte…), en cases
    sprite: Optional[SpriteRef] = None
    modular: Optional[ModularProps] = None


class CharacterPartProps(Strict):
    slot: str = Field(min_length=1, max_length=24)
    svg_media: RefId
    offset: Point = Field(default_factory=lambda: [0.0, 0.0])
    scale: float = Field(1.0, gt=0.1, le=5)
    anchor: Optional[str] = Field(None, max_length=24)  # point d'ancrage du corps auquel s'accroche le calque
    z: Optional[int] = Field(None, ge=-50, le=200)
    default_colors: dict[str, str] = Field(default_factory=dict)
    palette: dict[str, list[str]] = Field(default_factory=dict)  # couleurs autorisées par canal (vide = libre)
    bodies: list[RefId] = Field(default_factory=list, max_length=16)  # corps compatibles (vide = tous)
    requires_slots: list[str] = Field(default_factory=list, max_length=8)
    incompatible_slots: list[str] = Field(default_factory=list, max_length=8)
    incompatible_parts: list[RefId] = Field(default_factory=list, max_length=32)
    anchors: dict[str, Point] = Field(default_factory=dict)  # corps seulement : points d'ancrage fournis
    gender: Optional[Literal["male", "female"]] = None  # corps seulement : genre de la silhouette
    genders: list[Literal["male", "female"]] = Field(default_factory=list, max_length=2)  # réservé à ces genres (vide = tous)
    game_hint: Optional[str] = Field(None, max_length=24)  # correspondance pour l'adaptateur du jeu actuel

    _hex = field_validator("default_colors")(classmethod(lambda cls, v: _check_hex_map(v)))

    @field_validator("palette")
    @classmethod
    def _pal(cls, v: dict[str, list[str]]) -> dict[str, list[str]]:
        for k, cols in v.items():
            if len(cols) > 24:
                raise ValueError(f"palette {k} : 24 couleurs maximum")
            for c in cols:
                _check_hex(c)
        return v


class PatternRef(Strict):
    part: RefId
    colors: dict[str, str] = Field(default_factory=dict)
    channel: Literal["primary", "secondary", "accent"] = "primary"
    scale: float = Field(1.0, ge=0.25, le=4)

    _hex = field_validator("colors")(classmethod(lambda cls, v: _check_hex_map(v)))


class CharacterLayer(Strict):
    part: RefId
    colors: dict[str, str] = Field(default_factory=dict)
    pattern: Optional[PatternRef] = None

    _hex = field_validator("colors")(classmethod(lambda cls, v: _check_hex_map(v)))


class CharacterProps(Strict):
    body: RefId
    skin: str = "#a86b3c"
    hair_color: str = "#1b1b1b"
    eye_color: str = "#3b2414"
    height_scale: float = Field(1.0, ge=0.85, le=1.15)
    layers: dict[str, CharacterLayer] = Field(default_factory=dict)
    role: str = Field("", max_length=60)
    view: Literal["front"] = "front"

    @field_validator("skin", "hair_color", "eye_color")
    @classmethod
    def _c(cls, v: str) -> str:
        return _check_hex(v)


FAMILY_PROPS = {"building": BuildingProps, "interior": InteriorProps, "road": RoadProps, "surface": SurfaceProps,
                "prop": PropProps, "furniture": FurnitureProps, "vehicle": VehicleProps,
                "character": CharacterProps, "character_part": CharacterPartProps, "component": ComponentProps}


# ---------- Requêtes API ----------

class CreateAssetIn(Strict):
    category: str
    technical_name: Slug
    definition: AssetDefinition


class UpdateDraftIn(Strict):
    definition: AssetDefinition
    note: Optional[str] = Field(None, max_length=200)


class DuplicateIn(Strict):
    technical_name: Slug
    name: str = Field(min_length=2, max_length=80)


class RevertIn(Strict):
    from_version: int = Field(ge=1)


class LoginIn(Strict):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=200)


class LogoutIn(Strict):
    everywhere: bool = False


class GameSettingsIn(Strict):
    """Intégration au jeu : intérieur de la maison du joueur, habitant de chaque PNJ ("" = auto, "keep" = apparence du jeu)."""
    home_interior: Optional[str] = Field(None, max_length=64)
    npcs: Optional[dict[str, str]] = None
    extra_inhabitants: Optional[bool] = None


class PlacementIn(Strict):
    """Élément publié posé sur la carte du jeu : coin nord-ouest (x, y) en cases, orientation de la façade."""
    asset_id: str = Field(min_length=1, max_length=64)
    x: int = Field(ge=0, le=400)
    y: int = Field(ge=0, le=400)
    facing: Literal["S", "N", "E", "W"] = "S"
    w: Optional[int] = Field(None, ge=1, le=40)  # surfaces seulement : taille tracée
    h: Optional[int] = Field(None, ge=1, le=40)


class RemovalIn(Strict):
    """Élément d'origine de la ville à retirer (clé de client/src/world/removal.js)."""
    key: str = Field(min_length=3, max_length=80)
    label: str = Field("", max_length=60)


class PublishInhabitantsIn(Strict):
    ids: Optional[list[str]] = Field(None, max_length=500)


class PasswordIn(Strict):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=1, max_length=200)


class UserIn(Strict):
    username: str = Field(min_length=2, max_length=40)
    password: str = Field(min_length=1, max_length=200)
    role: str


class UserPatch(Strict):
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=1, max_length=200)


class CategoryIn(Strict):
    key: Slug
    label: str = Field(min_length=2, max_length=60)
    family: str
    rules: list[str] = Field(default_factory=list, max_length=8)
    subcategories: list[Annotated[str, Field(min_length=1, max_length=60)]] = Field(default_factory=list, max_length=60)
    description: str = Field("", max_length=300)


class CategoryPatch(Strict):
    label: Optional[str] = Field(None, min_length=2, max_length=60)
    rules: Optional[list[str]] = Field(None, max_length=8)
    subcategories: Optional[list[Annotated[str, Field(min_length=1, max_length=60)]]] = Field(None, max_length=60)
    description: Optional[str] = Field(None, max_length=300)
    archived: Optional[bool] = None


class MediaPatch(Strict):
    name: Optional[str] = Field(None, min_length=1, max_length=80)
    tags: Optional[list[Annotated[str, Field(max_length=30)]]] = Field(None, max_length=20)
    category: Optional[str] = None


class ChannelAssignIn(Strict):
    mapping: dict[str, Literal["skin", "hair", "eyes", "primary", "secondary", "accent",
                               "trim", "glass", "chrome", "leaf", "bark", "metal", "wood", "line", "stone"]]


class SceneIn(Strict):
    name: str = Field(min_length=2, max_length=60)
    description: str = Field("", max_length=300)
    width: int = Field(40, ge=8, le=120)
    height: int = Field(40, ge=8, le=120)
    template: Literal["blank", "coast", "lagoon"] = "coast"


class ScenePatch(Strict):
    name: Optional[str] = Field(None, min_length=2, max_length=60)
    description: Optional[str] = Field(None, max_length=300)


class PlaceIn(Strict):
    asset_id: str
    x: int
    y: int
    rotation: Literal[0, 90, 180, 270] = 0
    variant_id: Optional[str] = None
    label: Optional[str] = Field(None, max_length=60)


class MovePatch(Strict):
    x: Optional[int] = None
    y: Optional[int] = None
    rotation: Optional[Literal[0, 90, 180, 270]] = None
    variant_id: Optional[str] = None
    label: Optional[str] = Field(None, max_length=60)


class MigrateIn(Strict):
    to_version: int
    instance_ids: Optional[list[str]] = None


class ExportIn(Strict):
    asset_ids: list[str] = Field(default_factory=list, max_length=2000)
    all_assets: bool = False
    include_dependencies: bool = True
    versions: Literal["published", "latest", "all"] = "all"
    scene_ids: list[str] = Field(default_factory=list, max_length=20)


class ImportApplyIn(Strict):
    decisions: dict[str, Literal["create", "skip", "copy", "new_version"]] = Field(default_factory=dict)
    import_scenes: bool = True


# ---------------------------------------------------------------- monde : villes, zones, cartes (worldmaps.py)
# Identifiants stables, en minuscules : ceux des cartes deviennent les zones du jeu (Character.zone, 32 caractères).
WORLD_ID = r"^[a-z][a-z0-9_]{0,47}$"
MAP_ID = r"^[a-z][a-z0-9_]{0,31}$"
ITEM_ID = r"^[a-z0-9][a-z0-9_]{0,31}$"


class CityIn(Strict):
    id: str = Field(pattern=WORLD_ID)
    name: str = Field(min_length=1, max_length=80)
    description: str = Field("", max_length=500)


class DistrictIn(Strict):
    id: str = Field(pattern=WORLD_ID)
    city_id: str = Field(pattern=WORLD_ID)
    name: str = Field(min_length=1, max_length=80)
    description: str = Field("", max_length=500)


class MapArea(Strict):
    """Rectangle de cases (coin nord-ouest, largeur, profondeur)."""
    x: int = Field(ge=0, le=200)
    y: int = Field(ge=0, le=200)
    w: int = Field(ge=1, le=60)
    h: int = Field(ge=1, le=60)


class LandscapeIn(Strict):
    """Instance d'un paysage 3D (média de la médiathèque) placée sur une carte. Ses réglages ne touchent pas le fichier."""
    id: str = Field(pattern=ITEM_ID)
    media_id: str = Field(min_length=1, max_length=64)
    revision: Optional[int] = Field(None, ge=1)   # absent : révision courante du fichier, figée à l'enregistrement
    x: float = Field(ge=0, le=200)                # origine du modèle, en cases
    z: float = Field(ge=0, le=200)
    rotation: Literal[0, 90, 180, 270] = 0        # degrés, sens horaire vu du dessus (nord en haut)
    scale: float = Field(1.0, gt=0, le=20)        # 1 unité du modèle = 1 case à l'échelle 1
    solid: bool = True                            # emprise au sol infranchissable


class MapTarget(Strict):
    zone: str = Field(pattern=r"^[a-z][a-z0-9_]{0,31}$")
    spawn: str = Field("default", pattern=r"^[a-z][a-z0-9_]{0,47}$")


class ConditionIn(Strict):
    """Condition de passage d'une porte, vérifiée par le serveur du jeu (jamais par la seule configuration)."""
    type: Literal["mission_completed", "min_balance"]
    mission: Optional[str] = Field(None, pattern=r"^m_[a-z0-9_]{1,40}$")
    amount: Optional[int] = Field(None, ge=0, le=10_000_000)


class ArrivalIn(Strict):
    """Point d'arrivée nommé sur une carte (destination d'une porte venant d'ailleurs)."""
    id: str = Field(pattern=ITEM_ID)
    x: int = Field(ge=0, le=200)
    y: int = Field(ge=0, le=200)


class InteractiveIn(Strict):
    """Objet interactif : zone tracée à la main, ou déduite d'un objet nommé du modèle (`landscape` + `node`)."""
    id: str = Field(pattern=ITEM_ID)
    name: str = Field(min_length=1, max_length=60)
    type: Literal["shop", "info", "door"]
    active: bool = True
    area: Optional[MapArea] = None
    landscape: Optional[str] = Field(None, pattern=ITEM_ID)
    node: Optional[str] = Field(None, min_length=1, max_length=80)
    label: str = Field("", max_length=60)
    text: str = Field("", max_length=400)
    target: Optional[MapTarget] = None
    conditions: list[ConditionIn] = Field(default_factory=list, max_length=4)
    mode: Literal["walk", "transport"] = "walk"   # « transport » : gbaka, taxi… (déplacements entre communes, villes)


class MapEntranceIn(Strict):
    """Accès depuis la Cité Akwaba : panneau posé sur une case de la ville (vérifiée par le jeu à l'affichage)."""
    zone: Literal["quartier"] = "quartier"
    x: int = Field(ge=1, le=400)
    y: int = Field(ge=1, le=400)
    label: str = Field(min_length=1, max_length=24)


class MapDraftIn(Strict):
    width: int = Field(ge=8, le=120)
    height: int = Field(ge=8, le=120)
    ground: Literal["grass", "dirt", "paving", "sand"] = "grass"
    spawn: list[int] = Field(min_length=2, max_length=2)
    landscapes: list[LandscapeIn] = Field(default_factory=list, max_length=50)
    interactives: list[InteractiveIn] = Field(default_factory=list, max_length=100)
    arrivals: list[ArrivalIn] = Field(default_factory=list, max_length=20)
    entrance: Optional[MapEntranceIn] = None


class MapIn(Strict):
    id: str = Field(pattern=MAP_ID)
    district_id: str = Field(pattern=WORLD_ID)
    name: str = Field(min_length=1, max_length=60)
    description: str = Field("", max_length=500)
    width: int = Field(24, ge=8, le=120)
    height: int = Field(18, ge=8, le=120)
    ground: Literal["grass", "dirt", "paving", "sand"] = "grass"


class MapRestoreIn(Strict):
    version: int = Field(ge=1)


class MapPublishIn(Strict):
    note: str = Field("", max_length=200)
