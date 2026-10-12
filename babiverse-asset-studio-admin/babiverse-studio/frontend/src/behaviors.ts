// Prérequis des comportements déclaratifs (miroir des règles `behavior.requires` de backend/app/validation.py).
// Ajouter un comportement ne doit jamais produire d'erreur bloquante évitable : on remplit ce qui peut l'être
// (zone d'interaction, logement attribuable, façade commerciale) et on refuse ce qui demande un choix (intérieur).
import { DELTA, footprintCells } from "./geometry";
import type { AssetDefinition, Cell } from "./types";

export const interactionZones = (def: AssetDefinition) => def.zones.filter((z) => z.kind === "interaction");

/** Case devant l'entrée principale (bâtiment) ou juste au sud de l'emprise (objet). */
function frontCell(def: AssetDefinition): Cell {
  const main = def.entrances.find((e) => e.kind === "main") ?? def.entrances[0];
  if (main) { const [dx, dy] = DELTA[main.side]; return [main.cell[0] + dx, main.cell[1] + dy]; }
  const cells = footprintCells(def.footprint);
  const d = Math.max(...cells.map((c) => c[1])) + 1;
  return [cells.find((c) => c[1] === d - 1)?.[0] ?? 0, d];
}

/** Raison pour laquelle le comportement ne peut pas encore être ajouté (null = possible). */
export function blockedReason(def: AssetDefinition, id: string): string | null {
  if (id === "enter_interior" && !(def.properties?.interiors ?? []).length)
    return "Associez d'abord un intérieur au bâtiment (éditeur, section Intérieurs associés).";
  return null;
}

/** Complète l'asset pour satisfaire le prérequis du comportement et renvoie ses paramètres initiaux. */
export function fulfil(def: AssetDefinition, family: string, id: string, params: Record<string, any>): Record<string, any> {
  if (id === "interaction_zone") {
    let zone = interactionZones(def).find((z) => !def.behaviors.some((b) => b.id === id && b.params.zone_id === z.id));
    if (!zone) {
      let n = 1; while (def.zones.some((z) => z.id === (n === 1 ? "accueil" : `accueil-${n}`))) n++;
      zone = { id: n === 1 ? "accueil" : `accueil-${n}`, kind: "interaction", label: "Accueil", cells: [frontCell(def)] };
      def.zones.push(zone);
    }
    return { ...params, zone_id: zone.id };
  }
  if (id === "assignable_home" && family === "building") def.properties.assignable_to_player = true;
  if (id === "shop" && family === "building" && !def.properties.shop) {
    def.properties.shop = { sign_text: (def.name || "Boutique").toUpperCase().slice(0, 24), shopfront: true, awning: true,
      goods_slots: params.goods_slots ?? 12 };
  }
  return params;
}
