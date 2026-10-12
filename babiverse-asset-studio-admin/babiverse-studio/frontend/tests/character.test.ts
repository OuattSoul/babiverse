import { describe, expect, it } from "vitest";
import { checkOutfit, composeCharacter, composePart, effective, prefixIds, randomCharacter, seeded, type CharacterProps } from "../src/character/compose";
import { interiorReach } from "../src/interior";
import { templateFor } from "../src/templates";
import type { PartPayload } from "../src/types";

const part = (id: string, slot: string, front: string, props: any = {}, extra: Partial<PartPayload> = {}): PartPayload => ({
  id, technical_name: id, name: id, version: 1, status: "published", published_version: 1, archived: false, slot, props, tags: [],
  view_box: [0, 0, 200, 380], channels: { primary: "#111111" }, z: { body: 10, top: 40, bottom: 30, hair: 60, headwear: 66, dress: 34, shoes: 36 }[slot] ?? 50,
  back_z: 0, defs: "", back: "", front, ...extra,
});

const LIB: PartPayload[] = [
  part("body-m", "body", '<path d="M0 0"/>', { anchors: { eyes: [100, 62], head_top: [100, 22], waist: [100, 224], shoulders: [100, 124], neck: [100, 108], feet: [100, 362] } }, { channels: {} }),
  part("body-f", "body", '<path d="M1 1"/>', { anchors: { eyes: [100, 64], head_top: [100, 26], waist: [100, 224], shoulders: [100, 126], neck: [100, 108], feet: [100, 362] } }, { channels: {} }),
  part("tee", "top", '<path style="fill:var(--babi-primary,#2980b9)" d="M2 2"/>', { anchor: "shoulders", default_colors: { primary: "#2980b9" } }),
  part("pants", "bottom", '<path d="M3 3"/>', { anchor: "waist" }),
  part("dress", "dress", '<path d="M4 4"/>', { anchor: "shoulders", incompatible_slots: ["top", "bottom"] }),
  part("afro", "hair", '<path d="M5 5"/>', { anchor: "head_top" }, { back: '<g data-babi-layer="back"><circle r="5"/></g>' }),
  part("cap", "headwear", '<path d="M6 6"/>', { anchor: "head_top", incompatible_parts: ["afro"] }),
  part("beard", "beard", '<path d="M7 7"/>', { anchor: "mouth", bodies: ["body-m"] }),
  part("shoes", "shoes", '<path d="M8 8"/>', { anchor: "feet", palette: { primary: ["#111111", "#3a2a20"] } }),
  part("stripes", "pattern", '<rect id="r" width="20" height="7"/>', {}, { view_box: [0, 0, 20, 20], defs: '<linearGradient id="g"/>' }),
];
const REC = Object.fromEntries(LIB.map((p) => [p.id, p]));
const base: CharacterProps = { body: "body-m", skin: "#8d5524", hair_color: "#111111", eye_color: "#3b2414",
  layers: { top: { part: "tee", colors: { primary: "#c0392b" } }, bottom: { part: "pants" }, hair: { part: "afro" } } };

describe("compositeur de personnages", () => {
  it("superpose les calques par ordre de rendu et place le calque arrière derrière le corps", () => {
    const { svg, missing } = composeCharacter(base, REC);
    expect(missing).toEqual([]);
    const order = ["data-slot=\"hair-back\"", "data-slot=\"body\"", "data-slot=\"bottom\"", "data-slot=\"top\"", "data-slot=\"hair\""].map((s) => svg.indexOf(s));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]))).toBe(true);
    expect(svg).toContain("--babi-skin:#8d5524");
    expect(svg).toContain("--babi-primary:#c0392b");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 380"')).toBe(true);
  });
  it("décale un calque selon les ancrages d'un autre corps", () => {
    const f = composeCharacter({ ...base, body: "body-f" }, REC).svg;
    expect(f).toMatch(/data-slot="hair" transform="translate\(0 4\)"/);       // head_top 26 au lieu de 22
    expect(f).toMatch(/data-slot="top" transform="translate\(0 2\)"/);        // shoulders 126 au lieu de 124
  });
  it("applique un motif comme remplissage du canal choisi, identifiants préfixés", () => {
    const p = { ...base, layers: { ...base.layers, top: { part: "tee", pattern: { part: "stripes", colors: { primary: "#ffffff" }, channel: "primary" as const, scale: 2 } } } };
    const svg = composeCharacter(p, REC, { idPrefix: "x" }).svg;
    expect(svg).toContain('<pattern id="x-top-pattern" patternUnits="userSpaceOnUse" width="40" height="40">');
    expect(svg).toContain("--babi-primary:url(#x-top-pattern)");
    expect(svg).toContain('id="x-top-p-r"');
  });
  it("refuse les couleurs non hexadécimales (pas d'injection de style)", () => {
    const evil = { ...base, skin: "red;}</style><script>", layers: { top: { part: "tee", colors: { primary: "url(javascript:x)" } }, bottom: { part: "pants" } } };
    const svg = composeCharacter(evil as any, REC).svg;
    expect(svg).not.toContain("script");
    expect(svg).not.toContain("javascript");
    expect(svg).toContain("--babi-skin:#a86b3c");
  });
  it("signale les composants manquants", () => {
    expect(composeCharacter({ ...base, layers: { top: { part: "inconnu" } } }, REC).missing).toEqual(["inconnu"]);
  });
  it("applique une variante (tenue) sans modifier la base", () => {
    const v = { id: "robe", name: "Robe", materials: {}, props: { layers: { dress: { part: "dress" }, top: null, bottom: null }, skin: "#5c3a1e" } };
    const e = effective(base, v);
    expect(Object.keys(e.layers).sort()).toEqual(["dress", "hair"]);
    expect(e.skin).toBe("#5c3a1e");
    expect(Object.keys(base.layers).sort()).toEqual(["bottom", "hair", "top"]);
  });
  it("prefixIds réécrit id, url(#) et href", () => {
    expect(prefixIds('<g id="a" fill="url(#a)"><use href="#a"/></g>', "p-")).toBe('<g id="p-a" fill="url(#p-a)"><use href="#p-a"/></g>');
  });
  it("aperçu d'un motif en tuile répétée", () => {
    expect(composePart(REC.stripes)).toContain('fill="url(#pp)"');
  });
});

describe("règles de compatibilité (miroir du serveur)", () => {
  it("accepte une tenue complète et compatible", () => { expect(checkOutfit(base, REC)).toEqual([]); });
  it("refuse incompatibilités, dépendances de corps, palette et tenue incomplète", () => {
    const msgs = (p: CharacterProps) => checkOutfit(p, REC).map((i) => i.message).join(" | ");
    expect(msgs({ ...base, layers: { ...base.layers, headwear: { part: "cap" } } })).toMatch(/incompatible avec « afro »/);
    expect(msgs({ ...base, layers: { ...base.layers, dress: { part: "dress" } } })).toMatch(/ne se porte pas/);
    expect(msgs({ ...base, body: "body-f", layers: { ...base.layers, beard: { part: "beard" } } })).toMatch(/pas compatible/);
    expect(msgs({ ...base, layers: { ...base.layers, shoes: { part: "shoes", colors: { primary: "#00ff00" } } } })).toMatch(/palette/);
    expect(msgs({ ...base, layers: { top: { part: "tee" } } })).toMatch(/Tenue incomplète/);
  });
});

describe("générateur d'habitants", () => {
  it("ne produit que des combinaisons compatibles et reproductibles", () => {
    const rng = seeded(42);
    const crowd = Array.from({ length: 30 }, () => randomCharacter(LIB, rng));
    expect(crowd.every(Boolean)).toBe(true);
    for (const c of crowd) expect(checkOutfit(c!, REC)).toEqual([]);
    expect(JSON.stringify(randomCharacter(LIB, seeded(7)))).toBe(JSON.stringify(randomCharacter(LIB, seeded(7))));
  });
  it("retourne null sans aucun corps", () => { expect(randomCharacter(LIB.filter((p) => p.slot !== "body"), seeded(1))).toBeNull(); });
});

describe("intérieurs : circulation", () => {
  const ip = { width: 6, depth: 4, spawn: [1, 1], forbidden: [],
    rooms: [{ id: "a", x: 0, y: 0, w: 3, d: 4 }, { id: "b", x: 3, y: 0, w: 3, d: 4 }],
    doors: [{ cell: [2, 1], side: "E" }], furniture: [] as any[] };
  it("traverse les portes mais pas les murs", () => {
    expect(interiorReach(ip).has("4,1")).toBe(true);
    expect(interiorReach({ ...ip, doors: [] }).has("4,1")).toBe(false);
  });
  it("les meubles bloquent le passage", () => {
    expect(interiorReach({ ...ip, furniture: [{ x: 2, y: 0, w: 1, d: 4 }] }).has("4,1")).toBe(false);
  });
});

describe("modèles de création", () => {
  it("fournit un point de départ cohérent pour chaque famille", () => {
    for (const f of ["building", "road", "interior", "surface", "prop", "furniture", "vehicle", "character", "character_part"]) {
      const d = templateFor(f, f === "building" ? "commerce" : "", { bodyId: "b", mediaId: "m", slot: "top" });
      expect(d.representation).toBeTruthy();
      expect(d.behaviors).toEqual([]);
    }
    expect(templateFor("building", "commerce").properties.shop.sign_text).toBe("BOUTIQUE");
    expect(templateFor("vehicle", "").properties.parking).toBe("road");
  });
});

describe("règles de genre", () => {
  const G: PartPayload[] = [
    part("homme", "body", '<path d="M0 0"/>', { gender: "male", anchors: { eyes: [100, 62], shoulders: [100, 124], waist: [100, 224], feet: [100, 362] } }, { channels: {} }),
    part("femme", "body", '<path d="M1 1"/>', { gender: "female", anchors: { eyes: [100, 64], shoulders: [100, 126], waist: [100, 224], feet: [100, 362] } }, { channels: {} }),
    part("tee", "top", '<path d="M2 2"/>', { anchor: "shoulders" }),
    part("jupe", "bottom", '<path d="M3 3"/>', { anchor: "waist", genders: ["female"] }),
    part("pantalon", "bottom", '<path d="M3 4"/>', { anchor: "waist" }),
    part("talons", "shoes", '<path d="M4 4"/>', { anchor: "feet", genders: ["female"] }),
    part("baskets", "shoes", '<path d="M4 5"/>', { anchor: "feet" }),
    part("rouge", "makeup", '<path d="M5 5"/>', { anchor: "mouth", genders: ["female"] }),
    part("barbe", "beard", '<path d="M6 6"/>', { anchor: "mouth", genders: ["male"] }),
  ];
  const R = Object.fromEntries(G.map((p) => [p.id, p]));
  const homme: CharacterProps = { body: "homme", skin: "#8d5524", hair_color: "#111111", eye_color: "#3b2414",
    layers: { top: { part: "tee" }, bottom: { part: "pantalon" }, shoes: { part: "baskets" } } };
  it("refuse rouge à lèvres et talons pour un homme, barbe pour une femme", () => {
    const msg = (p: CharacterProps) => checkOutfit(p, R).map((i) => i.message).join(" | ");
    expect(msg({ ...homme, layers: { ...homme.layers, makeup: { part: "rouge" } } })).toMatch(/réservé aux silhouettes féminines/);
    expect(msg({ ...homme, layers: { ...homme.layers, shoes: { part: "talons" } } })).toMatch(/réservé aux silhouettes féminines/);
    expect(msg({ ...homme, body: "femme", layers: { ...homme.layers, beard: { part: "barbe" } } })).toMatch(/réservé aux silhouettes masculines/);
    expect(msg({ ...homme, body: "femme", layers: { ...homme.layers, makeup: { part: "rouge" }, shoes: { part: "talons" }, bottom: { part: "jupe" } } })).toBe("");
  });
  it("le générateur respecte le genre de la silhouette", () => {
    const rng = seeded(11);
    for (let i = 0; i < 80; i++) {
      const c = randomCharacter(G, rng)!;
      const used = Object.values(c.layers).map((l) => l!.part);
      if (c.body === "homme") expect(used.filter((p) => ["jupe", "talons", "rouge"].includes(p))).toEqual([]);
      else expect(used).not.toContain("barbe");
    }
  });
});
