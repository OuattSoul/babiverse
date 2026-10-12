// Prérequis des comportements (miroir de _validate_behaviors côté serveur).
import { describe, expect, it } from "vitest";
import { blockedReason, fulfil } from "../src/behaviors";
import { buildingTemplate, propTemplate } from "../src/templates";

describe("prérequis des comportements", () => {
  it("crée une zone d'interaction devant l'entrée principale et la référence", () => {
    const d = buildingTemplate("health");
    const params = fulfil(d, "building", "interaction_zone", { zone_id: "" });
    expect(params.zone_id).toBe("accueil");
    expect(d.zones).toEqual([{ id: "accueil", kind: "interaction", label: "Accueil", cells: [[0, 2]] }]);
  });
  it("réutilise une zone d'interaction existante", () => {
    const d = buildingTemplate("health");
    d.zones.push({ id: "guichet", kind: "interaction", label: "Guichet", cells: [[1, 2]] });
    expect(fulfil(d, "building", "interaction_zone", { zone_id: "" }).zone_id).toBe("guichet");
    expect(d.zones).toHaveLength(1);
  });
  it("place la zone d'un objet juste au sud de son emprise", () => {
    const d = propTemplate("urban_furniture");
    fulfil(d, "prop", "interaction_zone", { zone_id: "" });
    expect(d.zones[0].cells).toEqual([[0, 1]]);
  });
  it("rend le bâtiment attribuable et lui donne une façade commerciale si besoin", () => {
    const d = buildingTemplate("health");
    d.name = "CHU de Cocody";
    fulfil(d, "building", "assignable_home", {});
    fulfil(d, "building", "shop", { goods_slots: 12 });
    expect(d.properties.assignable_to_player).toBe(true);
    expect(d.properties.shop.sign_text).toBe("CHU DE COCODY");
  });
  it("refuse « Ouvrir un intérieur » sans intérieur associé", () => {
    const d = buildingTemplate("health");
    expect(blockedReason(d, "enter_interior")).toMatch(/intérieur/);
    d.properties.interiors = [{ interior_id: "x", label: "Base", min_level: 1 }];
    expect(blockedReason(d, "enter_interior")).toBeNull();
  });
});
