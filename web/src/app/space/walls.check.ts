// Checks rooms from walls (walls.ts) on footprints alone, so it needs no drawing. Run from web/:
//   npx tsx src/app/space/walls.check.ts
// Four 200 mm walls round a 4000 x 3000 room give one room of 12 m² net and 13.44 m² gross (to the
// walls' centre lines); two rooms sharing a 100 mm partition meet on its centre line; an L-shaped
// room; walls that don't close make no room; and a wall of another thickness on one side.

import type { Pt } from "../../core/index.ts";
import { roomsOf, type WallRoom } from "./walls.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 0.5): boolean => Math.abs(a - b) <= eps;
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const area = (ring: readonly Pt[]): number => Math.abs(ring.reduce((a, p, i) => a + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0)) / 2;
const bounds = (ring: readonly Pt[]): { x0: number; x1: number; y0: number; y1: number } => ({
  x0: Math.min(...ring.map((p) => p.x)),
  x1: Math.max(...ring.map((p) => p.x)),
  y0: Math.min(...ring.map((p) => p.y)),
  y1: Math.max(...ring.map((p) => p.y)),
});
const hasCorner = (ring: readonly Pt[], x: number, y: number): boolean => ring.some((p) => near(p.x, x, 0.01) && near(p.y, y, 0.01));

/** Four 200 mm walls round a 4000 x 3000 room, the right one `right` thick (its centre line at x = 4100). */
const box = (right = 200): Pt[][] => [
  rect(-100, -200, 4100, 0), // bottom
  rect(-100, 3000, 4100, 3200), // top
  rect(-200, -100, 0, 3100), // left
  rect(4100 - right / 2, -100, 4100 + right / 2, 3100), // right
];

// one room, net and gross
{
  const rooms = roomsOf(box());
  check(rooms.length === 1, `four walls round a room give one room (${rooms.length})`);
  const r = rooms[0];
  check(near(area(r.net), 12e6, 1), `its net area is 12 m² (${area(r.net)})`);
  check(!!r.gross && near(area(r.gross), 13.44e6, 1), `its gross area is 13.44 m², 4200 x 3200 to the centre lines (${r.gross && area(r.gross)})`);
  check(!!r.gross && hasCorner(r.gross, -100, -100) && hasCorner(r.gross, 4100, 3100), "the gross corners lie on the walls' centre lines");
}

// two rooms sharing a 100 mm partition
{
  const rooms = roomsOf([...box(), rect(1950, -100, 2050, 3100)]);
  check(rooms.length === 2, `two rooms with a partition give two (${rooms.length})`);
  const grossSum = rooms.reduce((a, r) => a + (r.gross ? area(r.gross) : NaN), 0);
  check(near(grossSum, 13.44e6, 1), `their gross areas sum to the area inside the outer centre lines (${grossSum})`);
  const xs = rooms.map((r) => bounds(r.gross ?? []));
  check(xs.some((b) => near(b.x1, 2000)) && xs.some((b) => near(b.x0, 2000)), "the gross boundaries meet on the partition's centre line x = 2000");
}

// an L-shaped room
{
  const walls: Pt[][] = [
    rect(-100, -200, 4100, 0), // bottom
    rect(4000, -100, 4200, 1700), // right, lower part
    rect(2000, 1500, 4100, 1700), // the step's wall
    rect(2000, 1500, 2200, 3200), // the upper part's right wall
    rect(-100, 3000, 2200, 3200), // top of the upper part
    rect(-200, -100, 0, 3100), // left
  ];
  const rooms = roomsOf(walls);
  check(rooms.length === 1, `an L-shaped room is one room (${rooms.length})`);
  const r = rooms[0];
  check(near(area(r.net), 9e6, 1), `its net area is 9 m² (${area(r.net)})`);
  check(!!r.gross && near(area(r.gross), 10.44e6, 1), `its gross area is 10.44 m² (${r.gross && area(r.gross)})`);
  check(!!r.gross && hasCorner(r.gross, 2100, 1600) && hasCorner(r.gross, 4100, 1600), "its inner corner goes out to the step's centre line");
}

// walls that don't close
{
  const open = roomsOf([rect(-100, -200, 4100, 0), rect(-200, -100, 0, 3100), rect(4000, -100, 4200, 3100)]);
  check(open.length === 0, "walls that do not close make no room");
  check(roomsOf([]).length === 0, "no walls make no room");
}

// a wall of another thickness on one side: the room's net side moves, its gross stays at the centre line
{
  const rooms = roomsOf(box(300));
  check(rooms.length === 1, "a wall of 300 mm on one side still closes one room");
  const r = rooms[0];
  check(near(area(r.net), 3950 * 3000, 1), `its net area is the 3950 x 3000 inside (${area(r.net)})`);
  check(!!r.gross && near(area(r.gross), 13.44e6, 1), `its gross area is still 13.44 m² to the centre lines (${r.gross && area(r.gross)})`);
}

// a curved wall (an annulus of short segments): its edges stay put and the gross, when given, is no smaller than the net
{
  const n = 48;
  const ring = (r: number): Pt[] => Array.from({ length: n }, (_, i) => ({ x: r * Math.cos((2 * Math.PI * i) / n), y: r * Math.sin((2 * Math.PI * i) / n) }));
  const outer = ring(3000);
  const inner = ring(2500);
  const band: Pt[][] = outer.map((p, i) => {
    const q = outer[(i + 1) % n];
    const ip = inner[i];
    const iq = inner[(i + 1) % n];
    return [p, q, iq, ip];
  });
  const rooms: WallRoom[] = roomsOf(band);
  check(rooms.length === 1, `a closed curved wall gives one room (${rooms.length})`);
  const r = rooms[0];
  check(!!r && (r.gross === null || area(r.gross) >= area(r.net) - 1), "a curved room's gross is null or no smaller than its net");
}

console.log(failures ? `${failures} failed` : "all ok");
process.exit(failures ? 1 : 0);
