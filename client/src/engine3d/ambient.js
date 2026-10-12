// Vie de la ville en 3D : véhicules qui circulent sur les voies et passants sur les trottoirs.
// La logique (voies, freinage, grille des passants) est dans world/traffic.js.
import { TILE } from '../world/grid.js';
import { findPath } from '../world/pathfinding.js';
import {
  entryClear, headingAngle, initialTraffic, makeVehicle, pedestrianGrid, pickKind, randomLook,
  stepTraffic, strollTiles, tileToPx, trafficLanes, VEHICLES, vehiclePose,
} from '../world/traffic.js';
import { buildProp } from './builders.js';
import { Npc } from './actors.js';
import { inhabitantLooks } from '../atelier/pack.js';

const PED_BODY = { hw: 6, hh: 4 };
const STROLL_RADIUS = 12; // cases : destinations proches (recherche de chemin peu coûteuse)
const SPAWN_EVERY_MS = 1200;

export class CityAmbient {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    const { grid } = world;
    this.lanes = trafficLanes(world.zone.roads, grid.w, grid.h);
    this.nextId = 0;
    this.vehicles = [];
    for (const v of initialTraffic(this.lanes, cfg.vehicles)) this.addVehicle(v);
    this.nextSpawn = 0;

    this.refreshGrid();
    this.pedestrians = [];
    for (let i = 0; i < cfg.pedestrians; i++) this.addPedestrian();
  }

  // --- Véhicules ---------------------------------------------------------------------
  addVehicle(v) {
    v.id = this.nextId++;
    v.model = buildProp({ kind: v.kind, tile: [0, 0], color: v.color });
    this.world.zoneGroup.add(v.model);
    this.vehicles.push(v);
    this.syncVehicle(v);
  }

  syncVehicle(v) {
    const p = vehiclePose(v);
    v.model.position.set(p.x, 0, p.z);
    v.model.rotation.y = headingAngle(p.hx, p.hz);
  }

  spawnVehicle(time) {
    if (this.vehicles.length >= this.cfg.vehicles || time < this.nextSpawn) return;
    this.nextSpawn = time + SPAWN_EVERY_MS * (0.5 + Math.random());
    const lane = this.lanes[Math.floor(Math.random() * this.lanes.length)];
    const kind = pickKind();
    if (!entryClear(this.vehicles, lane, VEHICLES[kind].len)) return;
    this.addVehicle(makeVehicle(0, kind, lane, lane.from));
  }

  // --- Passants ------------------------------------------------------------------------
  refreshGrid() {
    this.baseGrid = this.world.grid;
    this.pedGrid = pedestrianGrid(this.world.grid, this.world.zone.map);
    this.tiles = strollTiles(this.pedGrid, this.world.zone.map);
  }

  addPedestrian() {
    const start = tileToPx(this.tiles[Math.floor(Math.random() * this.tiles.length)]);
    // Passants : habitants de l'atelier quand il y en a, sinon apparences tirées au sort.
    const looks = inhabitantLooks();
    this.nextPed = (this.nextPed ?? Math.floor(Math.random() * 1000)) + 1;
    const look = looks.length ? looks[this.nextPed % looks.length] : randomLook();
    const npc = new Npc(this.world, { id: 'passant', x: start.x, y: start.y, look });
    this.pedestrians.push({ npc, path: [], waitUntil: this.world.time + Math.random() * 3000 });
  }

  /** Nouvelle promenade vers un trottoir proche. */
  planWalk(p) {
    const { x, y } = p.npc.body;
    const near = this.tiles.filter(([tx, ty]) => Math.abs(tx * TILE - x) < STROLL_RADIUS * TILE && Math.abs(ty * TILE - y) < STROLL_RADIUS * TILE);
    if (!near.length) return;
    const dest = tileToPx(near[Math.floor(Math.random() * near.length)]);
    p.path = findPath(this.pedGrid, { x, y }, dest, PED_BODY) || [];
    if (p.path.length) p.npc.walkTo(p.path[0].x, p.path[0].y);
  }

  updatePedestrian(p, time, dt) {
    const { npc } = p;
    if (p.path.length) {
      if (npc.step(dt, this.world.grid)) {
        p.path.shift();
        if (p.path.length) npc.walkTo(p.path[0].x, p.path[0].y);
        else p.waitUntil = time + 1000 + Math.random() * 4000;
      }
    } else if (time > p.waitUntil) {
      this.planWalk(p);
      p.waitUntil = time + 2000;
    }
    npc.update(time, dt, this.world.grid);
  }

  // --- Boucle --------------------------------------------------------------------------
  /** people : personnes à éviter en plus des passants (joueur, PNJ), en pixels de grille. */
  update(time, dt, people) {
    if (this.world.grid !== this.baseGrid) this.refreshGrid();
    for (const p of this.pedestrians) this.updatePedestrian(p, time, dt);

    const obstacles = [...people, ...this.pedestrians.map((p) => p.npc.body)].map((b) => ({ x: b.x / TILE, z: b.y / TILE }));
    stepTraffic(this.vehicles, obstacles, dt);
    for (const v of this.vehicles) {
      if (v.done) { v.model.removeFromParent(); continue; }
      this.syncVehicle(v);
    }
    this.vehicles = this.vehicles.filter((v) => !v.done);
    this.spawnVehicle(time);
  }

  destroy() {
    for (const v of this.vehicles) v.model.removeFromParent();
    for (const p of this.pedestrians) p.npc.destroy();
    this.vehicles = [];
    this.pedestrians = [];
  }
}
