// Animation de la ville : circulation sur les voies et passants sur les trottoirs.
// Module pur (testé avec Vitest) ; le rendu 3D est dans engine3d/ambient.js.
// Unités : cases (1 case = 1 unité du monde 3D), x vers l'est, z (= y de la grille) vers le sud.

import { TILE } from './grid.js';

// --- Véhicules -------------------------------------------------------------------------

// len / wid : encombrement (cases) ; speed : vitesse de croisière (cases/s) ; weight : fréquence.
export const VEHICLES = {
  taxi: { len: 1.8, wid: 0.85, speed: 3.2, weight: 3 },
  woroworo: { len: 1.8, wid: 0.85, speed: 2.9, weight: 2 },
  voiture: { len: 1.8, wid: 0.85, speed: 3, weight: 3 },
  gbaka: { len: 2.8, wid: 0.92, speed: 2.3, weight: 2 },
  moto: { len: 0.9, wid: 0.35, speed: 3.6, weight: 2 },
};
export const CAR_COLORS = ['#c0392b', '#2c3e50', '#ecf0f1', '#7f8c8d', '#2980b9', '#1e8449'];

const ACCEL = 3; // cases/s²
const BRAKE = 9;
const GAP = 0.7; // distance de sécurité derrière un obstacle (cases)
const LOOK = 1.6; // anticipation : distance de freinage supplémentaire
const UNJAM_MS = 4000; // bloqué par un véhicule aussi longtemps : on force le passage (évite l'interblocage)
const GHOST_MS = 1500;

/**
 * Voies de circulation déduites du réseau routier : on roule à droite.
 * Route horizontale (y = trottoir nord) : y+3 vers l'est, y+1 vers l'ouest.
 * Route verticale (x = trottoir ouest) : x+1 vers le sud, x+3 vers le nord.
 */
export function trafficLanes(roads, w, h) {
  const lanes = [];
  for (const r of roads.horizontal) {
    lanes.push({ id: `${r.id}_e`, axis: 'x', at: r.y + 3.5, dir: 1, from: -3, to: w + 3 });
    lanes.push({ id: `${r.id}_o`, axis: 'x', at: r.y + 1.5, dir: -1, from: w + 3, to: -3 });
  }
  for (const r of roads.vertical) {
    lanes.push({ id: `${r.id}_s`, axis: 'z', at: r.x + 1.5, dir: 1, from: -3, to: h + 3 });
    lanes.push({ id: `${r.id}_n`, axis: 'z', at: r.x + 3.5, dir: -1, from: h + 3, to: -3 });
  }
  return lanes;
}

/** Position au sol et cap (vecteur unitaire) d'un véhicule sur sa voie. */
export function vehiclePose(v) {
  const { lane } = v;
  return lane.axis === 'x'
    ? { x: v.pos, z: lane.at, hx: lane.dir, hz: 0 }
    : { x: lane.at, z: v.pos, hx: 0, hz: lane.dir };
}

/** Angle de rotation (autour de y) d'un modèle dont l'avant pointe vers +x. */
export const headingAngle = (hx, hz) => Math.atan2(-hz, hx);

export function pickKind(rand = Math.random) {
  const kinds = Object.entries(VEHICLES);
  let r = rand() * kinds.reduce((s, [, k]) => s + k.weight, 0);
  for (const [kind, k] of kinds) { r -= k.weight; if (r < 0) return kind; }
  return kinds[0][0];
}

export function makeVehicle(id, kind, lane, pos, rand = Math.random) {
  const k = VEHICLES[kind];
  return {
    id, kind, lane, pos,
    len: k.len, wid: k.wid,
    cruise: k.speed * (0.85 + rand() * 0.3),
    speed: 0,
    color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
    jammedMs: 0,
    ghostMs: 0,
    done: false,
  };
}

/**
 * Distance libre devant le véhicule `v` avant l'obstacle `o` ({ x, z, hx?, hz?, len?, wid? }),
 * ou Infinity si l'obstacle n'est pas sur sa trajectoire.
 */
export function clearanceTo(v, o) {
  const p = vehiclePose(v);
  const dx = o.x - p.x;
  const dz = o.z - p.z;
  const ahead = dx * p.hx + dz * p.hz;
  const side = Math.abs(-dx * p.hz + dz * p.hx);
  // Encombrement de l'obstacle selon notre axe : véhicule parallèle, perpendiculaire ou piéton.
  const parallel = o.hx !== undefined && Math.abs(o.hx * p.hx + o.hz * p.hz) > 0.5;
  const oLong = o.len === undefined ? 0.25 : (parallel ? o.len : o.wid) / 2;
  const oSide = o.len === undefined ? 0.25 : (parallel ? o.wid : o.len) / 2;
  if (side > v.wid / 2 + oSide + 0.1) return Infinity;
  if (ahead <= 0) return Infinity; // derrière nous
  return ahead - v.len / 2 - oLong;
}

/**
 * Fait avancer les véhicules d'un pas de temps. `people` : piétons et joueur ({ x, z } en cases).
 * Chaque véhicule ralentit puis s'arrête derrière ce qui le précède ; un véhicule sorti de la carte
 * est marqué `done`.
 */
export function stepTraffic(vehicles, people, dt) {
  const poses = new Map(vehicles.map((v) => [v, { ...vehiclePose(v), len: v.len, wid: v.wid }]));
  const blockers = new Map();
  for (const v of vehicles) {
    let free = Infinity;
    let by = null;
    for (const p of people) free = Math.min(free, clearanceTo(v, p));
    if (v.ghostMs <= 0) {
      for (const o of vehicles) {
        if (o === v) continue;
        const c = clearanceTo(v, poses.get(o));
        if (c < free) { free = c; by = o; }
      }
    }
    blockers.set(v, { free, by });
  }
  for (const v of vehicles) {
    let { free, by } = blockers.get(v);
    // Deux véhicules qui se bloquent mutuellement (carrefour) : le plus ancien passe.
    if (by && blockers.get(by).by === v && v.id < by.id) free = Infinity;
    const stopAt = free - GAP;
    const target = stopAt <= 0 ? 0 : Math.min(v.cruise, v.cruise * (stopAt / LOOK));
    v.speed = target > v.speed ? Math.min(target, v.speed + ACCEL * dt) : Math.max(target, v.speed - BRAKE * dt);
    if (stopAt > 0) v.pos += v.lane.dir * Math.min(v.speed * dt, stopAt);
    // Interblocage (plusieurs véhicules au carrefour) : après un long arrêt, on passe « à travers ».
    v.ghostMs = Math.max(0, v.ghostMs - dt * 1000);
    v.jammedMs = v.speed < 0.05 && by ? v.jammedMs + dt * 1000 : 0;
    if (v.jammedMs > UNJAM_MS) { v.jammedMs = 0; v.ghostMs = GHOST_MS; }
    if ((v.pos - v.lane.to) * v.lane.dir >= 0) v.done = true;
  }
}

/** L'entrée de la voie est-elle libre pour faire apparaître un véhicule de longueur `len` ? */
export function entryClear(vehicles, lane, len) {
  return vehicles.every((v) => v.lane !== lane || Math.abs(v.pos - lane.from) > (v.len + len) / 2 + 1.5);
}

/** Positions de départ réparties sur les voies (la ville n'est pas vide au chargement). */
export function initialTraffic(lanes, count, rand = Math.random) {
  const out = [];
  for (let i = 0; i < count * 4 && out.length < count; i++) {
    const lane = lanes[Math.floor(rand() * lanes.length)];
    const kind = pickKind(rand);
    const lo = Math.min(lane.from, lane.to) + 4;
    const hi = Math.max(lane.from, lane.to) - 4;
    const pos = lo + rand() * (hi - lo);
    const len = VEHICLES[kind].len;
    if (out.some((v) => v.lane === lane && Math.abs(v.pos - pos) < (v.len + len) / 2 + 2)) continue;
    out.push(makeVehicle(out.length, kind, lane, pos, rand));
  }
  return out;
}

// --- Passants -----------------------------------------------------------------------------

const ROAD = new Set(['=', '-', '|']);
// Lieux de promenade : trottoirs, passages piétons et place pavée.
const STROLL = new Set(['_', '+', ':']);

/**
 * Grille de déplacement des passants : la grille de collision, plus la chaussée (ils ne
 * traversent qu'aux passages piétons).
 */
export function pedestrianGrid(grid, map) {
  const solid = grid.solid.slice();
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (ROAD.has(map[y][x])) solid[y * grid.w + x] = 1;
  return { ...grid, solid };
}

/** Cases où un passant peut se rendre (trottoirs, passages, place), hors obstacles. */
export function strollTiles(grid, map) {
  const out = [];
  for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (STROLL.has(map[y][x]) && !grid.solid[y * grid.w + x]) out.push([x, y]);
  return out;
}

const SKINS = ['#5c3a1e', '#8d5524', '#c68642', '#6b4423', '#a0672e'];
const OUTFITS = ['#e74c3c', '#27ae60', '#8e44ad', '#f1c40f', '#2980b9', '#e67e22', '#16a085', '#ecf0f1', '#d35400', '#c0392b'];
const PANTS = ['#2c3e50', '#34495e', '#7f8c8d', '#2d3436', '#5d4037', '#1a5276'];
const HAIRS = ['short', 'braids', 'afro', 'bald'];

/** Apparence aléatoire d'un passant. */
export function randomLook(rand = Math.random) {
  const any = (list) => list[Math.floor(rand() * list.length)];
  return { skin: any(SKINS), outfit: any(OUTFITS), pants: any(PANTS), hair: any(HAIRS) };
}

export const tileToPx = ([x, y]) => ({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE });
