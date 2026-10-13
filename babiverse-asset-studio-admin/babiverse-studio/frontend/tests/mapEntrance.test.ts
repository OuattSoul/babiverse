import { describe, expect, it } from "vitest";
import { freeEntranceTile } from "../src/mapEntrance";
// @ts-ignore module JS du jeu (alias @jeu)
import { buildCity } from "@jeu/world/city.js";
// @ts-ignore
import { withEntrances } from "@jeu/world/dataMaps.js";

const accepted = (tile: [number, number], others: { id: string; x: number; y: number }[] = []) => {
  const maps = [...others, { id: "test", x: tile[0], y: tile[1] }].map((m) => ({ id: m.id, name: m.id, entrance: { zone: "quartier", x: m.x, y: m.y, label: m.id } }));
  const { skipped } = withEntrances(buildCity(), maps);
  return !skipped.some((s: any) => s.id === "test");
};

describe("case d'accès depuis la Cité Akwaba", () => {
  it("propose une case que le jeu accepte", () => {
    const tile = freeEntranceTile([], [], []);
    expect(tile).not.toBeNull();
    expect(accepted(tile!)).toBe(true);
  });
  it("évite la case d'une autre carte publiée et ses voisines", () => {
    const first = freeEntranceTile([], [], [])!;
    const second = freeEntranceTile([], [], [first])!;
    expect(Math.abs(second[0] - first[0]) + Math.abs(second[1] - first[1])).toBeGreaterThan(1);
    expect(accepted(second, [{ id: "autre", x: first[0], y: first[1] }])).toBe(true);
  });
});
