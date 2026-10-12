import { describe, expect, it } from 'vitest';
import { buildCity } from '../src/world/city.js';
import { buildGrid } from '../src/world/grid.js';
import { NPCS } from '../src/world/npcs.js';
import { findPath } from '../src/world/pathfinding.js';
import {
  clearanceTo, entryClear, headingAngle, initialTraffic, makeVehicle, pedestrianGrid,
  stepTraffic, strollTiles, tileToPx, trafficLanes, vehiclePose,
} from '../src/world/traffic.js';

const city = buildCity();
const grid = buildGrid(city);
const lanes = trafficLanes(city.roads, grid.w, grid.h);
const lane = (id) => lanes.find((l) => l.id === id);
const run = (vehicles, people, seconds) => { for (let t = 0; t < seconds; t += 0.05) stepTraffic(vehicles, people, 0.05); };

describe('circulation', () => {
  it('chaque voie suit le goudron sur toute la traversée de la carte', () => {
    expect(lanes).toHaveLength(8);
    for (const l of lanes) {
      const across = l.axis === 'x' ? grid.w : grid.h;
      for (let k = 1; k < across - 1; k++) {
        const [x, y] = l.axis === 'x' ? [k, Math.floor(l.at)] : [Math.floor(l.at), k];
        expect('=+'.includes(city.map[y][x]), `${l.id} en ${x},${y}`).toBe(true);
      }
    }
  });

  it('on roule à droite : vers l\'est au sud de la route, vers le sud à l\'ouest du boulevard', () => {
    expect(lane('avenue_e').at).toBeGreaterThan(lane('avenue_o').at);
    expect(lane('bd_ouest_s').at).toBeLessThan(lane('bd_ouest_n').at);
  });

  it('le modèle est tourné dans le sens de la marche', () => {
    const v = makeVehicle(0, 'taxi', lane('bd_est_s'), 5, () => 0.5);
    const p = vehiclePose(v);
    const a = headingAngle(p.hx, p.hz);
    // Rotation de +x autour de y : (cos a, -sin a) doit donner le cap (0, +1).
    expect(Math.cos(a)).toBeCloseTo(p.hx);
    expect(-Math.sin(a)).toBeCloseTo(p.hz);
  });

  it('un véhicule avance, puis sort de la carte', () => {
    const v = makeVehicle(0, 'moto', lane('avenue_e'), 0, () => 0.5);
    run([v], [], 2);
    expect(v.pos).toBeGreaterThan(1);
    run([v], [], 60);
    expect(v.done).toBe(true);
  });

  it("s'arrête devant un piéton sur sa voie et repart quand il est passé", () => {
    const l = lane('avenue_e');
    const v = makeVehicle(0, 'taxi', l, 10, () => 0.5);
    const person = { x: 16.5, z: l.at };
    run([v], [person], 6);
    expect(v.speed).toBeLessThan(0.05);
    expect(v.pos + v.len / 2).toBeLessThan(person.x);
    run([v], [], 2);
    expect(v.pos).toBeGreaterThan(person.x);
  });

  it('ignore les passants sur le trottoir', () => {
    const l = lane('avenue_o');
    const v = makeVehicle(0, 'gbaka', l, 30, () => 0.5);
    expect(clearanceTo(v, { x: 25, z: 12.5 })).toBe(Infinity);
  });

  it('garde ses distances derrière un véhicule arrêté', () => {
    const l = lane('rue2_o');
    const front = makeVehicle(0, 'gbaka', l, 20, () => 0.5);
    const back = makeVehicle(1, 'taxi', l, 30, () => 0.5);
    run([front, back], [{ x: 18.5, z: l.at }], 6);
    expect(back.pos - front.pos).toBeGreaterThan((back.len + front.len) / 2);
  });

  it('pas d\'interblocage au carrefour : les véhicules finissent par passer', () => {
    const h = makeVehicle(0, 'taxi', lane('avenue_e'), 16, () => 0.5);
    const v = makeVehicle(1, 'voiture', lane('bd_ouest_s'), 12, () => 0.5);
    run([h, v], [], 30);
    expect(h.pos).toBeGreaterThan(24);
    expect(v.pos).toBeGreaterThan(18);
  });

  it('trafic initial réparti sans chevauchement, entrée de voie libre ou non', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const list = initialTraffic(lanes, 12, rand);
    expect(list.length).toBeGreaterThan(8);
    for (const a of list) for (const b of list) if (a !== b && a.lane === b.lane) expect(Math.abs(a.pos - b.pos)).toBeGreaterThan((a.len + b.len) / 2);
    const l = lane('avenue_e');
    expect(entryClear([], l, 2)).toBe(true);
    expect(entryClear([makeVehicle(0, 'taxi', l, l.from + 1)], l, 2)).toBe(false);
  });
});

describe('passants et habitants', () => {
  const ped = pedestrianGrid(grid, city.map);
  const tiles = strollTiles(ped, city.map);

  it('les passants ne marchent pas sur la chaussée (hors passages piétons)', () => {
    expect(tiles.length).toBeGreaterThan(200);
    const path = findPath(ped, tileToPx([17, 10]), tileToPx([21, 18]), { hw: 6, hh: 4 });
    expect(path).not.toBeNull();
    let prev = tileToPx([17, 10]);
    for (const p of path) {
      for (let t = 0; t <= 1; t += 0.05) {
        const x = Math.floor((prev.x + (p.x - prev.x) * t) / 32);
        const y = Math.floor((prev.y + (p.y - prev.y) * t) / 32);
        expect('=-|'.includes(city.map[y][x]), `chaussée en ${x},${y}`).toBe(false);
      }
      prev = p;
    }
  });

  it('chaque habitant placé dans la ville est connu et sur une case praticable', () => {
    for (const n of city.npcs) {
      expect(NPCS[n.id], n.id).toBeDefined();
      const [x, y] = n.tile;
      expect(grid.solid[y * grid.w + x], n.id).toBe(0);
    }
    expect(city.npcs.length).toBeGreaterThanOrEqual(10);
  });
});
