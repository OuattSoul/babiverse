// Circulation dans un intérieur : cases atteignables à pied depuis le point d'apparition.
// Miroir de backend/app/validation.py:interior_walk (le serveur reste l'autorité).
import { DELTA } from "./geometry";
import type { Side } from "./types";

export function interiorReach(ip: any): Set<string> {
  const owner = new Map<string, string>();
  for (const r of ip.rooms ?? []) for (let y = r.y; y < r.y + r.d; y++) for (let x = r.x; x < r.x + r.w; x++) if (!owner.has(`${x},${y}`)) owner.set(`${x},${y}`, r.id);
  const blocked = new Set<string>((ip.forbidden ?? []).map((c: number[]) => c.join(",")));
  for (const f of ip.furniture ?? []) for (let y = f.y; y < f.y + f.d; y++) for (let x = f.x; x < f.x + f.w; x++) blocked.add(`${x},${y}`);
  const doors = new Set<string>();
  for (const d of ip.doors ?? []) {
    const [dx, dy] = DELTA[d.side as Side];
    const a = `${d.cell[0]},${d.cell[1]}`, b = `${d.cell[0] + dx},${d.cell[1] + dy}`;
    doors.add(`${a}|${b}`); doors.add(`${b}|${a}`);
  }
  const start = (ip.spawn ?? [0, 0]).join(",");
  const seen = new Set<string>();
  if (!owner.has(start) || blocked.has(start)) return seen;
  seen.add(start);
  const queue = [start];
  while (queue.length) {
    const c = queue.shift()!;
    const [x, y] = c.split(",").map(Number);
    for (const [dx, dy] of Object.values(DELTA)) {
      const n = `${x + dx},${y + dy}`;
      if (seen.has(n) || !owner.has(n) || blocked.has(n)) continue;
      if (owner.get(n) !== owner.get(c) && !doors.has(`${c}|${n}`)) continue;
      seen.add(n); queue.push(n);
    }
  }
  return seen;
}
