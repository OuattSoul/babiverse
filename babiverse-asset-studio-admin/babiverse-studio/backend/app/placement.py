"""Règles de placement dans une scène de test : limites, terrain, collisions par couche, accès, raccords routiers.

Couches d'occupation :
- sol : surfaces (pelouse, sable, eau, parking…) — elles remplacent le terrain de base sous elles ;
- voirie et objets (`occupancy`) : routes, bâtiments, objets de décor à collision ;
- véhicules : posés sur la voirie ou un parking, jamais sur un objet ;
- personnages : sans collision, mais jamais à l'intérieur d'un bâtiment ou d'un objet.
"""
from __future__ import annotations

import json
import sqlite3

from . import geometry as g
from .taxonomy import CATEGORY_BY_KEY
from .validation import Report, connectors_compatible

TERRAIN = {"g": "ground", "s": "sand", "w": "water"}


class WorldState:
    """Vue en mémoire d'une scène pour un contrôle de placement (définitions mises en cache par version)."""

    def __init__(self, conn: sqlite3.Connection | None, ignore_instance: str | None = None, scene_id: str = "main",
                 empty: bool = False):
        self.occupancy: dict[g.Cell, dict] = {}
        self.surfaces: dict[g.Cell, dict] = {}
        self.vehicles: dict[g.Cell, dict] = {}
        self.characters: dict[g.Cell, dict] = {}
        self.instances: list[dict] = []
        self._defs: dict[tuple[str, int], dict] = {}
        if conn is None:
            return
        s = conn.execute("SELECT * FROM scenes WHERE id = ?", (scene_id,)).fetchone()
        if not s:
            raise KeyError(scene_id)
        self.scene_id = scene_id
        self.width, self.height = s["width"], s["height"]
        self.terrain: list[str] = json.loads(s["terrain"])  # une ligne par y, un caractère par x
        if empty:
            return
        rows = conn.execute(
            "SELECT i.*, a.family, v.definition FROM instances i JOIN assets a ON a.id = i.asset_id "
            "JOIN asset_versions v ON v.asset_id = i.asset_id AND v.version = i.version WHERE i.scene_id = ?", (scene_id,)
        ).fetchall()
        for row in rows:
            if row["id"] == ignore_instance:
                continue
            defn = self._defs.setdefault((row["asset_id"], row["version"]), json.loads(row["definition"]))
            self.add({"id": row["id"], "asset_id": row["asset_id"], "version": row["version"], "family": row["family"],
                      "x": row["x"], "y": row["y"], "rotation": row["rotation"], "def": defn})

    def add(self, inst: dict) -> None:
        defn = inst["def"]
        inst["cells"] = g.placed_cells(defn, inst["x"], inst["y"], inst["rotation"])
        self.instances.append(inst)
        fam = inst["family"]
        target = {"surface": self.surfaces, "vehicle": self.vehicles, "character": self.characters}.get(fam)
        if target is not None:
            for c in inst["cells"]:
                target[c] = inst
        elif defn.get("collision", "footprint") != "none":
            for c in inst["cells"]:
                self.occupancy[c] = inst

    def base_terrain(self, c: g.Cell) -> str:
        return TERRAIN.get(self.terrain[c[1]][c[0]], "ground")

    def terrain_at(self, c: g.Cell) -> str:
        s = self.surfaces.get(c)
        if s:
            return (s["def"].get("properties") or {}).get("terrain", "ground")
        return self.base_terrain(c)

    def in_bounds(self, c: g.Cell) -> bool:
        return 0 <= c[0] < self.width and 0 <= c[1] < self.height


def _names(insts) -> str:
    return ", ".join(sorted({i["def"]["name"] for i in insts}))


def check_placement(world: WorldState, defn: dict, family: str, x: int, y: int, rotation: int) -> Report:
    r = Report()
    cells = g.placed_cells(defn, x, y, rotation)
    cell_set = set(cells)
    label = defn.get("name", "?")

    # 1. Limites du monde
    out = [c for c in cells if not world.in_bounds(c)]
    if out:
        r.error("bounds", f"« {label} » dépasse les limites du monde ({world.width}×{world.height}).")
        return r

    # 2. Terrain (une surface se pose sur le terrain de base ; le reste sur le terrain effectif)
    allowed = set(defn["placement"]["allowed_terrain"])
    terr = world.base_terrain if family == "surface" else world.terrain_at
    bad = {terr(c) for c in cells} - allowed
    if bad:
        r.error("terrain", f"Terrain incompatible : {', '.join(sorted(bad))} (autorisé : {', '.join(sorted(allowed))}).")

    occ = [world.occupancy[c] for c in cells if c in world.occupancy]
    surf = [world.surfaces[c] for c in cells if c in world.surfaces]
    veh = [world.vehicles[c] for c in cells if c in world.vehicles]
    chars = [world.characters[c] for c in cells if c in world.characters]
    collides = defn.get("collision", "footprint") != "none"

    # 3. Collisions par couche
    if family == "surface":
        if surf:
            r.error("collision", f"Collision avec : {_names(surf)} (deux surfaces ne se superposent pas).")
        roads = [o for o in occ if o["family"] == "road"]
        if roads:
            r.error("collision", f"Collision avec : {_names(roads)} (une route ne se pose pas sur une surface).")
        if not (defn.get("properties") or {}).get("buildable"):
            objs = [o for o in occ if o["family"] != "road"] + veh
            if objs:
                r.error("surface.not_buildable", f"Surface non constructible sous : {_names(objs)}.")
    elif family == "vehicle":
        objs = [o for o in occ if o["family"] != "road"]
        if objs or veh:
            r.error("collision", f"Collision avec : {_names(objs + veh)}.")
        parking = (defn.get("properties") or {}).get("parking", "road")
        def on_road(c):
            o = world.occupancy.get(c)
            return o is not None and o["family"] == "road"
        def on_park(c):
            s = world.surfaces.get(c)
            return s is not None and (s["def"].get("properties") or {}).get("kind") == "parking"
        if parking == "road" and not all(on_road(c) for c in cells):
            r.error("vehicle.off_road", "Ce véhicule se stationne sur la voirie : placez-le entièrement sur une route.")
        elif parking == "parking" and not all(on_road(c) or on_park(c) for c in cells):
            r.error("vehicle.off_road", "Ce véhicule se stationne sur une route ou un parking.")
    elif family == "character":
        inside = [o for o in occ if o["family"] != "road"]
        if inside:
            r.error("character.inside", f"Le personnage serait à l'intérieur de : {_names(inside)}.")
        if chars:
            r.warn("character.crowd", f"Case déjà occupée par : {_names(chars)}.")
    else:
        if collides and occ:
            r.error("collision", f"Collision avec : {_names(occ)}.")
        if collides and (veh or chars):
            r.error("collision", f"Collision avec : {_names(veh + chars)}.")
        if family != "road":
            blocking = [s for s in surf if not (s["def"].get("properties") or {}).get("buildable")]
            if collides and blocking:
                r.error("surface.not_buildable", f"Surface non constructible : {_names(blocking)}.")
        elif surf:
            r.error("collision", f"Collision avec : {_names(surf)} (une route ne se pose pas sur une surface).")
        if family == "road" and veh:
            r.error("collision", f"Collision avec : {_names(veh)}.")

    # 4. Zone de sécurité (les routes sont tolérées dans la marge)
    m = defn["placement"]["safety_margin"]
    if m:
        x0, y0, x1, y1 = g.bbox(cells)
        for yy in range(y0 - m, y1 + m + 1):
            for xx in range(x0 - m, x1 + m + 1):
                o = world.occupancy.get((xx, yy))
                if (xx, yy) not in cell_set and o and o["family"] != "road":
                    r.error("safety_margin", f"Zone de sécurité de {m} case(s) occupée par « {o['def']['name']} ».")
                    break
            else:
                continue
            break

    if family == "building":
        _check_entrances(r, world, defn, x, y, rotation)
        _check_roads_facing_building(r, world, cell_set)
    elif family == "road":
        _check_road_links(r, world, defn, cells, rotation)
    return r


def _check_entrances(r: Report, world: WorldState, defn: dict, x: int, y: int, rotation: int):
    access = defn["placement"]["road_access"]
    for e in g.placed_entrances(defn, x, y, rotation):
        front = e["front"]
        if not world.in_bounds(front):
            r.error("entrance.bounds", f"L'entrée « {e['id']} » donne hors du monde.")
            continue
        o = world.occupancy.get(front)
        if o and o["family"] != "road":
            r.error("entrance.blocked", f"L'entrée « {e['id']} » est bloquée par « {o['def']['name']} ».")
            continue
        if front in world.vehicles:
            r.warn("entrance.vehicle", f"Un véhicule stationne devant l'entrée « {e['id']} ».")
        if e["kind"] == "main" and access != "none":
            near_road = o is not None and o["family"] == "road"
            if not near_road:
                # tolérance : une case de trottoir/cour entre l'entrée et la route
                dx, dy = g.DELTA[e["side"]]
                o2 = world.occupancy.get((front[0] + dx, front[1] + dy))
                near_road = o2 is not None and o2["family"] == "road"
            if not near_road:
                msg = f"L'entrée principale « {e['id']} » n'est pas desservie par une route (≤ 2 cases)."
                (r.error if access == "required" else r.warn)("entrance.road_access", msg)


def _check_roads_facing_building(r: Report, world: WorldState, cell_set: set):
    for inst in world.instances:
        if inst["family"] != "road":
            continue
        size = inst["def"]["footprint"]["w"]
        rect = (inst["x"], inst["y"], size, size)
        for side in g.placed_connectors(inst["def"], inst["rotation"]):
            if any(c in cell_set for c in g.side_strip(rect, side)):
                r.warn("road.dead_end", f"Un raccord de « {inst['def']['name']} » débouche sur ce bâtiment.")


def _check_road_links(r: Report, world: WorldState, defn: dict, cells: list, rotation: int):
    size = defn["footprint"]["w"]
    x0, y0, _, _ = g.bbox(cells)
    rect = (x0, y0, size, size)
    mine = g.placed_connectors(defn, rotation)
    for side in g.SIDES:
        strip = g.side_strip(rect, side)
        neighbours = {id(world.occupancy[c]): world.occupancy[c] for c in strip if c in world.occupancy}
        my_conn = mine.get(side)
        if not neighbours:
            continue
        for n in neighbours.values():
            if n["family"] != "road":
                if my_conn:
                    r.warn("road.dead_end", f"Le raccord {side} débouche sur « {n['def']['name']} ».")
                continue
            nsize = n["def"]["footprint"]["w"]
            their_conn = g.placed_connectors(n["def"], n["rotation"]).get(g.OPPOSITE[side])
            if not my_conn and not their_conn:
                continue  # routes parallèles, pas de raccord : autorisé
            aligned = nsize == size and (n["x"] == x0 if side in ("N", "S") else n["y"] == y0)
            if not aligned:
                r.error("road.misaligned", f"Raccord {side} désaligné avec « {n['def']['name']} » (discontinuité visuelle).")
                continue
            if my_conn and not their_conn:
                r.error("road.no_counterpart", f"Le raccord {side} bute sur le flanc de « {n['def']['name']} ».")
                continue
            if their_conn and not my_conn:
                r.error("road.no_counterpart", f"« {n['def']['name']} » arrive côté {side} où ce segment n'a pas de raccord.")
                continue
            ok, why = connectors_compatible(my_conn, their_conn)
            if not ok:
                r.error("road.incompatible", f"Raccord {side} incompatible avec « {n['def']['name']} » : {why}.")


def road_compatibility(defn: dict, others: list[dict]) -> list[dict]:
    """Pour un segment, liste les segments publiés raccordables : pour chaque côté du segment (rotation 0),
    les autres segments et rotations dont un raccord peut lui faire face."""
    out = []
    mine = g.placed_connectors(defn, 0)
    for other in others:
        matches = []
        for rot in (0, 90, 180, 270):
            theirs = g.placed_connectors(other["definition"], rot)
            for side, c in mine.items():
                tc = theirs.get(g.OPPOSITE[side])
                if tc:
                    ok, why = connectors_compatible(c, tc)
                    matches.append({"side": side, "rotation": rot, "ok": ok, "reason": why})
        good = [m for m in matches if m["ok"]]
        out.append({"asset_id": other["asset_id"], "name": other["definition"]["name"],
                    "compatible": bool(good), "matches": good[:8],
                    "reason": "" if good else (matches[0]["reason"] if matches else "aucun raccord")})
    return out


def is_category_family(category: str, family: str) -> bool:
    return CATEGORY_BY_KEY.get(category, {}).get("family") == family
