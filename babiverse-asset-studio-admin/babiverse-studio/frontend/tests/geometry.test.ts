// Parité avec backend/app/geometry.py (cf. test_rotation_moves_entrance côté serveur).
import { describe, expect, it } from "vitest";
import { placedCells, placedEntrances, rotateSide, rotatedSize } from "../src/geometry";
import { roadConnectors } from "../src/templates";
import { screenToGrid, iso } from "../src/render/iso";

const def: any = { footprint: { kind: "rect", w: 3, d: 2 }, entrances: [{ id: "p", cell: [0, 1], side: "S", kind: "main" }] };

describe("géométrie", () => {
  it("fait tourner l'emprise et l'entrée comme le serveur", () => {
    const e = placedEntrances(def, 10, 10, 90)[0];
    expect(e.side).toBe("W");
    expect(e.cell).toEqual([10, 10]);
    expect(placedCells(def, 10, 10, 90).sort()).toEqual([[10, 10], [10, 11], [10, 12], [11, 10], [11, 11], [11, 12]].sort());
    expect(rotatedSize(def, 90)).toEqual([2, 3]);
  });
  it("tourne les côtés dans le sens horaire", () => {
    expect(["N", "E", "S", "W"].map((s) => rotateSide(s as any, 90))).toEqual(["E", "S", "W", "N"]);
  });
  it("génère des raccords cohérents pour un sens unique", () => {
    const c = roadConnectors("straight", 2, 2, true);
    expect(c.map((x) => x.flow).sort()).toEqual(["in", "out"]);
    expect(roadConnectors("cross", 3, 3, false).every((x) => x.width_cells === 3 && x.lanes === 3)).toBe(true);
  });
  it("inverse correctement la projection isométrique", () => {
    const [sx, sy] = iso(7.25, 3.5);
    const [gx, gy] = screenToGrid(sx, sy);
    expect(gx).toBeCloseTo(7.25); expect(gy).toBeCloseTo(3.5);
  });
});
