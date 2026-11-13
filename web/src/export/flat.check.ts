// Checks flatOf (flat.ts) under Node. Run from web/:
//   npx tsx src/export/flat.check.ts
// Flat pieces are found facing either way, tilted, with a hole, with a corner on a straight run (and the flat sliver
// the triangulation leaves there), folding over themselves, in several parts and far from the origin; a box, a bent
// strip, triangles facing both ways, two triangles meeting only at a corner and more parts than the most are not.

import { flatOf, MOST_REGIONS } from "./flat.ts";
import type { Pt } from "../core/types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

/** A ring's signed area, positive anticlockwise. */
function area(r: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i].x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * r[i].y;
  return s / 2;
}

/** Triangles given as plan points at height z, each anticlockwise seen from above unless `down`. */
function tris(list: number[][][], z = 0, down = false): Float32Array {
  const out: number[] = [];
  for (const [a, b, c] of list) for (const p of down ? [a, c, b] : [a, b, c]) out.push(p[0], p[1], z);
  return new Float32Array(out);
}

const square = (x: number, y: number, s: number): number[][][] => [
  [[x, y], [x + s, y], [x + s, y + s]],
  [[x, y], [x + s, y + s], [x, y + s]],
];

{
  const f = flatOf(tris(square(0, 0, 1000), 150));
  check(!!f && f.regions.length === 1 && f.regions[0].outer.length === 4 && f.regions[0].holes.length === 0, "a square: one part, four corners, no holes");
  check(!!f && near(f.n[2], 1) && near(area(f.regions[0].outer), 1e6), "a square: facing up, its outline anticlockwise round 1 m²");
  check(!!f && f.regions[0].outer.every((p) => near(f.at(p)[2], 150)), "a square: its corners back at their height, exactly");
}
{
  const f = flatOf(tris(square(0, 0, 1000), 3000, true));
  check(!!f && near(f.n[2], -1) && area(f.regions[0].outer) > 0, "a square facing down: n down, its outline anticlockwise seen from below");
}
{
  // a ring round a hole, two triangles a side
  const o = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const h = [[4, 4], [6, 4], [6, 6], [4, 6]];
  const list: number[][][] = [];
  for (let k = 0; k < 4; k++) list.push([o[k], o[(k + 1) % 4], h[(k + 1) % 4]], [o[k], h[(k + 1) % 4], h[k]]);
  const f = flatOf(tris(list));
  check(!!f && f.regions.length === 1 && f.regions[0].holes.length === 1, "a ring round a hole: one part with its hole");
  check(!!f && near(area(f.regions[0].outer), 100) && near(area(f.regions[0].holes[0]), -4), "a ring round a hole: the outline anticlockwise, the hole clockwise");
}
{
  // a corner on a straight run, passed over by a flat sliver
  const run = [[0, 0], [2000, 0], [4000, 0], [4000, 2000], [0, 2000]];
  const f = flatOf(tris([[run[0], run[1], run[2]], [run[0], run[2], run[3]], [run[0], run[3], run[4]]]));
  check(!!f && f.regions.length === 1 && f.regions[0].outer.length === 4, "a corner on a straight run: four corners, the run straightened");
}
{
  // a quad tilted 30° about x, far from the origin
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const [x0, y0, z0] = [3_000_000, -2_000_000, 40_000];
  const p = (x: number, y: number): number[] => [x0 + x, y0 + y * c, z0 + y * s];
  const f = flatOf(new Float32Array([...p(0, 0), ...p(4000, 0), ...p(4000, 3000), ...p(0, 0), ...p(4000, 3000), ...p(0, 3000)]));
  check(!!f && near(f.n[1], -s, 1e-4) && near(f.n[2], c, 1e-4), "a quad tilted 30°, 3 km out: flat, facing up the tilt");
  // float32 corners 3 km out are a quarter of a millimetre apart
  check(!!f && near(Math.abs(area(f.regions[0].outer)), 12e6, 12e6 * 1e-4), `a quad tilted 30°, 3 km out: its area in its plane (${f ? Math.round(area(f.regions[0].outer)) : 0} mm²)`);
}
{
  // a square and a triangle over its corner, overlapping: their union
  const f = flatOf(tris([...square(0, 0, 1000), [[500, 500], [1500, 500], [1500, 1500]]]));
  check(!!f && f.regions.length === 1 && near(area(f.regions[0].outer), 1375000, 1e-3), "overlapping triangles: one part, the union's outline");
}
{
  const f = flatOf(tris([...square(0, 0, 1000), ...square(3000, 0, 1000)]));
  check(!!f && f.regions.length === 2, "two squares apart: two parts");
  const many: number[][][] = [];
  for (let k = 0; k <= MOST_REGIONS; k++) many.push(...square(2000 * k, 0, 1000));
  check(flatOf(tris(many)) === null, `${MOST_REGIONS + 1} squares apart: more parts than the most, not flat`);
}

check(flatOf(tris([[[0, 0], [1, 0], [0, 1]], [[1, 0], [1, 1], [0, 1]]], 0).map((v, i) => (i === 11 ? 5 : v)) as Float32Array) === null, "a corner lifted off the plane: not flat");
check(flatOf(new Float32Array([...tris(square(0, 0, 1000)), ...tris(square(0, 0, 1000), 0, true)])) === null, "a square drawn both ways: not flat");
check(flatOf(tris([[[0, 0], [10, 0], [10, 10]], [[10, 10], [20, 10], [20, 20]]])) === null, "two triangles meeting only at a corner: not flat");
{
  const box: number[] = [];
  const at = (x: number, y: number, z: number): number[] => [x, y, z];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => void box.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad(at(0, 0, 0), at(0, 1, 0), at(1, 1, 0), at(1, 0, 0));
  quad(at(0, 0, 1), at(1, 0, 1), at(1, 1, 1), at(0, 1, 1));
  check(flatOf(new Float32Array(box)) === null, "two faces of a box: not flat");
}
{
  const rise = Math.tan((10 * Math.PI) / 180) * 1000;
  const strip = new Float32Array([
    ...[0, 0, 0, 1000, 0, 0, 1000, 1000, 0, 0, 0, 0, 1000, 1000, 0, 0, 1000, 0],
    ...[1000, 0, 0, 2000, 0, rise, 2000, 1000, rise, 1000, 0, 0, 2000, 1000, rise, 1000, 1000, 0],
  ]);
  check(flatOf(strip) === null, "a strip bent by 10°: not flat");
}
check(flatOf(new Float32Array(0)) === null, "no triangles: not flat");

if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all flat checks passed");
