import { describe, expect, it } from 'vitest';
import { anchorOf, buildGrid, isSolid, lineOfSight, moveBody, rectCollides, TILE } from '../src/world/grid.js';
import { findTarget, primaryAction } from '../src/world/interaction.js';
import { NPCS } from '../src/world/npcs.js';
import { START_ZONE, ZONES } from '../src/world/zones.js';
import { dayPhase, predictNeeds } from '../src/sim/needs.js';

const grids = Object.fromEntries(Object.entries(ZONES).map(([id, z]) => [id, buildGrid(z)]));
const BODY = { hw: 7, hh: 5 };
const at = (tx, ty) => ({ x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, ...BODY });

describe('données des zones', () => {
  it('chaque carte est rectangulaire et entourée de murs', () => {
    for (const [id, g] of Object.entries(grids)) {
      for (let x = 0; x < g.w; x++) {
        expect(isSolid(g, x, 0), `${id} haut ${x}`).toBe(true);
      }
      for (let y = 0; y < g.h; y++) {
        expect(isSolid(g, 0, y), `${id} gauche ${y}`).toBe(true);
        expect(isSolid(g, g.w - 1, y), `${id} droite ${y}`).toBe(true);
      }
    }
  });

  it("tous les points d\'apparition sont praticables", () => {
    for (const [id, zone] of Object.entries(ZONES)) {
      for (const [name, [tx, ty]] of Object.entries(zone.spawns)) {
        expect(isSolid(grids[id], tx, ty), `${id}.${name}`).toBe(false);
      }
    }
  });

  it("chaque porte mène à une zone et un point d\'apparition existants", () => {
    for (const zone of Object.values(ZONES)) {
      for (const it of zone.interactables.filter((i) => i.type === 'door')) {
        const target = ZONES[it.target.zone];
        expect(target, it.id).toBeDefined();
        expect(target.spawns[it.target.spawn], `${it.id} -> ${it.target.spawn}`).toBeDefined();
      }
    }
    expect(ZONES[START_ZONE]).toBeDefined();
  });

  it('chaque élément interactif est atteignable depuis une case praticable voisine', () => {
    for (const [id, zone] of Object.entries(ZONES)) {
      const g = grids[id];
      for (const it of zone.interactables) {
        const a = anchorOf(it);
        const range = it.range ?? 44;
        let reachable = false;
        for (let ty = 0; ty < g.h && !reachable; ty++) {
          for (let tx = 0; tx < g.w && !reachable; tx++) {
            if (isSolid(g, tx, ty)) continue;
            const p = at(tx, ty);
            if (Math.hypot(p.x - a.x, p.y - a.y) <= range && lineOfSight(g, p.x, p.y, a.x, a.y)) reachable = true;
          }
        }
        expect(reachable, `${id}.${it.id}`).toBe(true);
      }
    }
  });

  it('chaque PNJ placé existe dans le registre', () => {
    for (const zone of Object.values(ZONES)) {
      for (const npc of zone.npcs) expect(NPCS[npc.id], npc.id).toBeDefined();
    }
  });
});

describe('déplacements et collisions', () => {
  const g = grids.quartier;
  const zone = ZONES.quartier;
  const kouassi = zone.buildings.find((b) => b.id === 'kouassi');
  const stand = zone.props.find((p) => p.kind === 'garba_stand');
  const [sx, sy] = zone.spawns.default;

  it('se déplace librement sur une case ouverte', () => {
    const p = moveBody(g, at(sx, sy), 3, 0);
    expect(p.x).toBeCloseTo(at(sx, sy).x + 3);
  });

  it('ne traverse pas une façade', () => {
    // Juste devant la façade de la maison des Kouassi, en remontant longtemps vers le nord.
    let body = at(kouassi.x0, kouassi.y1 + 1);
    for (let i = 0; i < 100; i++) body = { ...body, ...moveBody(g, body, 0, -4) };
    expect(body.y - BODY.hh).toBeGreaterThanOrEqual((kouassi.y1 + 1) * TILE);
    expect(rectCollides(g, body.x, body.y, BODY.hw, BODY.hh)).toBe(false);
  });

  it("glisse le long d'un mur en diagonale", () => {
    let body = at(kouassi.x0, kouassi.y1 + 1);
    for (let i = 0; i < 20; i++) body = { ...body, ...moveBody(g, body, 2, -2) };
    expect(body.x).toBeGreaterThan(at(kouassi.x0, 0).x + 30);
  });

  it('reste dans les limites de la carte', () => {
    let body = at(1, sy);
    for (let i = 0; i < 100; i++) body = { ...body, ...moveBody(g, body, -4, 0) };
    expect(body.x - BODY.hw).toBeGreaterThanOrEqual(TILE);
  });

  it('les décors solides (étal de garba) bloquent le passage', () => {
    const [tx, ty] = stand.tile;
    let body = at(tx - 3, ty);
    for (let i = 0; i < 40; i++) body = { ...body, ...moveBody(g, body, 4, 0) };
    expect(body.x + BODY.hw).toBeLessThanOrEqual(tx * TILE);
  });

  it('ne pénètre jamais dans un mur même avec de grands pas', () => {
    const interior = grids.maison;
    let body = at(4, 6);
    for (let i = 0; i < 200; i++) {
      const dx = (Math.sin(i) * 15);
      const dy = (Math.cos(i * 1.3) * 15);
      body = { ...body, ...moveBody(interior, body, dx, dy) };
      expect(rectCollides(interior, body.x, body.y, BODY.hw, BODY.hh)).toBe(false);
    }
  });
});

describe('interactions', () => {
  const g = grids.quartier;
  const zone = ZONES.quartier;
  const doorDef = zone.interactables.find((i) => i.id === 'door_kouassi');
  const [dx, dy] = doorDef.tile;
  const door = { id: 'door_kouassi', ...anchorOf(doorDef) };

  it('propose la porte quand le joueur est juste devant', () => {
    expect(findTarget(g, at(dx, dy + 1), [door])?.id).toBe('door_kouassi');
  });

  it('refuse quand le joueur est trop loin', () => {
    expect(findTarget(g, at(dx, dy + 4), [door])).toBeNull();
  });

  it("choisit l'élément le plus proche", () => {
    const other = { id: 'x', ...anchorOf({ tile: [dx + 1, dy + 1] }), los: false };
    expect(findTarget(g, at(dx + 1, dy + 1), [door, other])?.id).toBe('x');
  });

  it('la ligne de vue est bloquée par un mur mais pas par un comptoir', () => {
    const shop = grids.epicerie;
    const keeper = { id: 'fofana', ...anchorOf({ tile: [2, 3] }), range: 80 };
    expect(findTarget(shop, at(2, 5), [keeper])?.id).toBe('fofana');
    // Depuis la rue, derrière la maison : à portée mais sans vue.
    const behind = { id: 'derriere', ...anchorOf({ tile: [dx, dy - 2] }), range: 200 };
    expect(findTarget(g, at(dx, dy + 1), [behind])).toBeNull();
  });

  it('action principale : la première disponible, sinon la première', () => {
    expect(primaryAction([{ id: 'a', enabled: false }, { id: 'b' }]).id).toBe('b');
    expect(primaryAction([{ id: 'a', enabled: false }]).id).toBe('a');
    expect(primaryAction([])).toBeNull();
  });
});

describe('prédiction des besoins et temps', () => {
  const cfg = { min: 0, max: 100, hunger_per_minute: 1.2, energy_per_minute: 0.8, max_active_gap_seconds: 120 };

  it('évolue et reste bornée', () => {
    expect(predictNeeds({ hunger: 30, energy: 70 }, 60, cfg)).toEqual({ hunger: 31.2, energy: 69.2 });
    expect(predictNeeds({ hunger: 99, energy: 1 }, 600, cfg)).toEqual({ hunger: 100, energy: 0 });
  });

  it('nuit et jour à Abidjan (UTC)', () => {
    expect(dayPhase(new Date('2026-10-01T22:00:00Z')).name).toBe('nuit');
    expect(dayPhase(new Date('2026-10-01T12:00:00Z')).darkness).toBe(0);
  });
});
