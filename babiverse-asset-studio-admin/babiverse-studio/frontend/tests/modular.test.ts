import { describe, expect, it } from "vitest";
import { seeded } from "../src/character/compose";
import {
  checkAssembly, composeKit, countCombinations, effectiveModular, fitsBase, hardcodedColors, libraryChecks, randomAssembly,
  type KitSpec, type ModularProps,
} from "../src/modular/compose";
import type { PartPayload } from "../src/types";

const KIT: KitSpec = {
  label: "Test", family: "vehicle", frame: [0, 0, 240, 140], ground: 130, view: "front", description: "",
  globals: { glass: { label: "Vitres", default: "#9cc8d6" } },
  slots: { base: { label: "Carrosserie", z: 10, required: true }, wheels: { label: "Roues", z: 30, required: true, anchor: "wheels" },
    roof: { label: "Toit", z: 40, anchor: "roof" }, cargo: { label: "Chargement", z: 42, anchor: "roof" }, livery: { label: "Livrée", z: 14, anchor: "side" },
    pattern: { label: "Motif", z: 0 } },
  anchors: { wheels: [62, 116], roof: [120, 62], side: [120, 104] }, required_anchors: ["wheels"], pattern_slots: ["base", "livery"],
  random: { roof: 0.5, cargo: 0.5, livery: 0.5 },
};
const part = (id: string, slot: string, props: any = {}, extra: Partial<PartPayload> = {}): PartPayload => ({
  kit: "vehicle", id, technical_name: id, name: id, version: 1, status: "published", published_version: 1, archived: false, slot, props, tags: [],
  view_box: [0, 0, 240, 140], channels: { primary: "#111111" }, z: (KIT.slots[slot]?.z ?? 50), back_z: 0, defs: "", back: "",
  front: `<path style="fill:var(--babi-primary,#111111)" d="M0 0"/>`, ...extra,
});
const LIB: PartPayload[] = [
  part("car", "base", { anchors: { wheels: [[62, 116], [178, 116]], roof: [[120, 62]], side: [[120, 104]] } }),
  part("bus", "base", { anchors: { wheels: [[46, 116], [172, 116], [202, 116]], roof: [[120, 36]], side: [[110, 104]] } }),
  part("moto", "base", { anchors: { wheels: [[86, 116], [156, 116]], side: [[124, 96]] } }),
  part("wheel", "wheels", { anchor: "wheels" }),
  part("rack", "roof", { anchor: "roof" }),
  part("sign", "roof", { anchor: "roof" }),
  part("bags", "cargo", { anchor: "roof", requires_slots: ["roof"], incompatible_parts: ["sign"] }),
  part("stripe", "livery", { anchor: "side", bases: ["car", "bus"], palette: { primary: ["#f1c40f", "#ffffff"] } }),
  part("checker", "pattern", {}, { view_box: [0, 0, 12, 12], front: '<rect id="sq" width="6" height="6" style="fill:var(--babi-primary,#000000)"/>' }),
  part("other-kit", "wheels", { anchor: "wheels" }, { kit: "building" }),
];
const REC = Object.fromEntries(LIB.map((p) => [p.id, p]));
const taxi: ModularProps = { kit: "vehicle", base: "car", colors: { glass: "#5f7f8e" }, base_colors: { primary: "#e67e22" },
  layers: { wheels: { part: "wheel" }, roof: { part: "sign" }, livery: { part: "stripe", colors: { primary: "#f1c40f" } } } };

describe("compositeur des kits modulaires", () => {
  it("dessine une pièce par position du point d'ancrage (roues par essieu) et suit la base", () => {
    const car = composeKit(taxi, REC, KIT).svg;
    expect((car.match(/data-slot="wheels"/g) ?? []).length).toBe(2);
    expect(car).toContain('data-slot="wheels" transform="translate(116 0)"');
    const bus = composeKit({ ...taxi, base: "bus" }, REC, KIT).svg;
    expect((bus.match(/data-slot="wheels"/g) ?? []).length).toBe(3);
    expect(bus).toContain('data-slot="roof" transform="translate(0 -26)"');
    expect(car).toContain("--babi-glass:#5f7f8e");
    expect(car).toContain("--babi-primary:#e67e22");
    expect(car.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140"')).toBe(true);
  });
  it("ordonne les calques et masque une pièce sans point d'ancrage sur la base", () => {
    const { svg, hidden } = composeKit({ ...taxi, base: "moto", layers: { wheels: { part: "wheel" }, roof: { part: "rack" } } }, REC, KIT);
    expect(hidden).toEqual(["roof"]);
    const order = ['data-slot="base"', 'data-slot="wheels"'].map((s) => svg.indexOf(s));
    expect(order[0]).toBeGreaterThan(-1);
    expect(order[1]).toBeGreaterThan(order[0]);
  });
  it("applique un motif sur la couleur principale et préfixe les identifiants", () => {
    const m = { ...taxi, base_pattern: { part: "checker", colors: { primary: "#1d2a30" } } };
    const a = composeKit(m, REC, KIT, { idPrefix: "a" }).svg, b = composeKit(m, REC, KIT, { idPrefix: "b" }).svg;
    expect(a).toContain('--babi-primary:url(#a-base-pattern)');
    expect(a).toContain('id="a-base-pattern-sq"');
    expect(b).toContain('id="b-base-pattern-sq"');
  });
  it("refuse les couleurs non hexadécimales", () => {
    const svg = composeKit({ ...taxi, base_colors: { primary: "red;}<script>" }, colors: { glass: "url(javascript:x)" } }, REC, KIT).svg;
    expect(svg).not.toMatch(/script|javascript/);
  });
  it("applique une variante (différences seulement)", () => {
    const e = effectiveModular(taxi, { id: "v", name: "v", materials: {}, props: { layers: { roof: null }, base_colors: { primary: "#27ae60" } } });
    expect(e.layers.roof).toBeUndefined();
    expect(e.base_colors?.primary).toBe("#27ae60");
    expect(e.layers.wheels).toBeDefined();
  });
});

describe("règles d'assemblage (miroir du serveur)", () => {
  const msgs = (m: ModularProps) => checkAssembly(m, REC, KIT, "vehicle").filter((i) => i.level === "error").map((i) => i.message).join(" | ");
  it("accepte un assemblage valide", () => expect(msgs(taxi)).toBe(""));
  it("signale ancrage absent, base incompatible, dépendance, incompatibilité, obligatoire, autre kit, palette et motif", () => {
    expect(msgs({ ...taxi, base: "moto" })).toMatch(/ne peut pas s'accrocher.*\|.*pas compatible avec la base/);
    expect(msgs({ ...taxi, layers: { wheels: { part: "wheel" }, cargo: { part: "bags" } } })).toMatch(/nécessite un composant « Toit »/);
    expect(msgs({ ...taxi, layers: { ...taxi.layers, cargo: { part: "bags" } } })).toMatch(/incompatible avec « sign »/);
    expect(msgs({ ...taxi, layers: { roof: { part: "rack" } } })).toMatch(/obligatoire vide : Roues/);
    expect(msgs({ ...taxi, layers: { wheels: { part: "other-kit" } } })).toMatch(/autre kit/);
    expect(msgs({ ...taxi, layers: { ...taxi.layers, livery: { part: "stripe", colors: { primary: "#00ff00" } } } })).toMatch(/palette/);
    expect(msgs({ ...taxi, layers: { ...taxi.layers, roof: { part: "rack", pattern: { part: "checker" } } } })).toMatch(/n'accepte pas de motif/);
  });
  it("fitsBase tient compte des bases autorisées et des points d'ancrage", () => {
    expect(fitsBase(REC.stripe, REC.moto)).toBe(false);
    expect(fitsBase(REC.rack, REC.moto)).toBe(false);
    expect(fitsBase(REC.wheel, REC.moto)).toBe(true);
  });
});

describe("générateur, combinatoire et contrôles de bibliothèque", () => {
  it("ne produit que des assemblages valides, sur toutes les bases", () => {
    const rng = seeded(42);
    const bases = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const m = randomAssembly(LIB, "vehicle", KIT, rng)!;
      expect(m).not.toBeNull();
      bases.add(m.base);
      expect(checkAssembly(m, REC, KIT, "vehicle").filter((x) => x.level === "error")).toEqual([]);
    }
    expect(bases.size).toBe(3);
  });
  it("compte les silhouettes par base selon les pièces qui s'y accrochent", () => {
    const c = countCombinations(LIB, "vehicle", KIT);
    // voiture et bus : 1 roue × (2 toits + aucun) × (1 chargement + aucun) × (1 livrée + aucune) = 12 ; moto : 1
    expect(c.bases.map((b) => b.count)).toEqual([12, 12, 1]);
    expect(c.total).toBe(25);
  });
  it("repère les couleurs matière codées en dur mais admet ombres, lumières et canaux", () => {
    expect(hardcodedColors('<path style="fill:var(--babi-primary,#ff0000)"/><path style="fill:rgba(0,0,0,0.2)"/>')).toEqual([]);
    expect(hardcodedColors('<path fill="#ff0000"/>')).toEqual(["#ff0000"]);
  });
  it("les contrôles automatiques passent sur une bibliothèque saine", () => {
    const res = libraryChecks(LIB, "vehicle", KIT);
    expect(res.filter((r) => !r.ok)).toEqual([]);
    expect(res.length).toBeGreaterThanOrEqual(8);
  });
});
