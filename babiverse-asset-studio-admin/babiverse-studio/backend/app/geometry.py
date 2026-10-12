"""Géométrie de grille commune : rotations, emprises, côtés.

Convention : x croît vers l'Est, y croît vers le Sud (grille écran).
Une rotation de 90° est horaire : N -> E -> S -> W.
La position d'une instance (x, y) est le coin minimal de son emprise *après* rotation.
"""
from __future__ import annotations

from typing import Iterable

SIDES = ["N", "E", "S", "W"]
DELTA = {"N": (0, -1), "E": (1, 0), "S": (0, 1), "W": (-1, 0)}
OPPOSITE = {"N": "S", "S": "N", "E": "W", "W": "E"}

Cell = tuple[int, int]


def rotate_side(side: str, rotation: int) -> str:
    steps = (rotation // 90) % 4
    return SIDES[(SIDES.index(side) + steps) % 4]


def footprint_cells(footprint: dict) -> list[Cell]:
    """Cellules de l'emprise à rotation 0 (relatives au coin minimal)."""
    if footprint["kind"] == "rect":
        return [(x, y) for y in range(footprint["d"]) for x in range(footprint["w"])]
    return [tuple(c) for c in footprint.get("cells") or []]


class Transform:
    """Transformation rotation + recalage au coin minimal, partagée par toutes les primitives
    d'un asset (emprise, entrées, zones) pour qu'elles restent cohérentes."""

    def __init__(self, cells: Iterable[Cell], rotation: int):
        self.steps = (rotation // 90) % 4
        rotated = [self._rot(c) for c in cells]
        self.min_x = min((c[0] for c in rotated), default=0)
        self.min_y = min((c[1] for c in rotated), default=0)

    def _rot(self, c: Cell) -> Cell:
        x, y = c
        for _ in range(self.steps):
            x, y = -y, x
        return (x, y)

    def cell(self, c: Cell) -> Cell:
        x, y = self._rot(tuple(c))
        return (x - self.min_x, y - self.min_y)

    def side(self, side: str) -> str:
        return SIDES[(SIDES.index(side) + self.steps) % 4]


def placed_cells(defn: dict, x: int, y: int, rotation: int) -> list[Cell]:
    base = footprint_cells(defn["footprint"])
    t = Transform(base, rotation)
    return [(x + cx, y + cy) for cx, cy in (t.cell(c) for c in base)]


def placed_entrances(defn: dict, x: int, y: int, rotation: int) -> list[dict]:
    base = footprint_cells(defn["footprint"])
    t = Transform(base, rotation)
    out = []
    for e in defn.get("entrances", []):
        cx, cy = t.cell(tuple(e["cell"]))
        side = t.side(e["side"])
        dx, dy = DELTA[side]
        out.append({**e, "cell": (x + cx, y + cy), "side": side, "front": (x + cx + dx, y + cy + dy)})
    return out


def placed_connectors(defn: dict, rotation: int) -> dict[str, dict]:
    """Connecteurs routiers indexés par côté, après rotation."""
    return {rotate_side(c["side"], rotation): c for c in defn.get("connectors", [])}


def bbox(cells: Iterable[Cell]) -> tuple[int, int, int, int]:
    cells = list(cells)
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    return min(xs), min(ys), max(xs), max(ys)


def is_connected(cells: Iterable[Cell]) -> bool:
    cells = set(cells)
    if not cells:
        return False
    start = next(iter(cells))
    seen = {start}
    stack = [start]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in DELTA.values():
            n = (cx + dx, cy + dy)
            if n in cells and n not in seen:
                seen.add(n)
                stack.append(n)
    return len(seen) == len(cells)


def side_strip(rect: tuple[int, int, int, int], side: str) -> list[Cell]:
    """Cellules immédiatement à l'extérieur d'un côté d'un rectangle (x, y, w, d)."""
    x, y, w, d = rect
    if side == "N":
        return [(x + i, y - 1) for i in range(w)]
    if side == "S":
        return [(x + i, y + d) for i in range(w)]
    if side == "W":
        return [(x - 1, y + j) for j in range(d)]
    return [(x + w, y + j) for j in range(d)]
