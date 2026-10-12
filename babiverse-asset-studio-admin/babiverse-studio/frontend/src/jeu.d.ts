// Modules purs du jeu Babiverse importés par la page « Carte du jeu » (alias @jeu → client/src, voir vite.config.ts).
declare module "@jeu/world/city.js" {
  export function buildCity(opts?: { residentialBlocks?: number }): any;
}
declare module "@jeu/world/removal.js" {
  export interface CityElement { key: string; kind: "building" | "tree" | "prop"; label: string; rect: { x0: number; y0: number; x1: number; y1: number }; protected: string | null }
  export function cityElements(city: any): CityElement[];
  export function elementAt(elements: CityElement[], x: number, y: number): CityElement | null;
  export function cityWithout(city: any, keys: string[]): { zone: any; removed: string[]; refused: { key: string; reason: string }[] };
}
declare module "@jeu/world/placement.js" {
  export const FRONT: Record<string, [number, number]>;
  export function occupancy(zone: any): { grid: { w: number; h: number; solid: Uint8Array }; reserved: Set<string> };
  export function placementIssue(zone: any, occ: any, p: any, others?: any[]): string | null;
}
