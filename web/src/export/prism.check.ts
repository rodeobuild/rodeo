// Checks prismOf (prism.ts) under Node. Run from web/:
//   npx tsx src/export/prism.check.ts
// Upright prisms are found however their ends face and with a courtyard, a corner on a straight run (and the flat
// sliver an end's triangulation leaves there) and corners far from the origin; a pyramid, a tilted box, an open box,
// two boxes in one piece, an outline that touches itself and a terrain-like sheet are not prisms.

import { prismOf } from "./prism.ts";
import type { Pt } from "../core/types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type P3 = [number, number, number];

/**
 * A prism's triangles: each end a list of triangles given as plan points (anticlockwise seen from above), the
 * bottom turned to face down unless `bothUp`, and a wall (two triangles facing out) along each edge of each ring,
 * `rings` running as their loops do (the outline anticlockwise, holes clockwise).
 */
function prism(caps: Pt[][], rings: Pt[][], z0: number, z1: number, bothUp = false): Float32Array {
  const out: number[] = [];
  const at = (p: Pt, z: number): P3 => [p.x, p.y, z];
  for (const [a, b, c] of caps) {
    out.push(...at(a, z1), ...at(b, z1), ...at(c, z1));
    if (bothUp) out.push(...at(a, z0), ...at(b, z0), ...at(c, z0));
    else out.push(...at(a, z0), ...at(c, z0), ...at(b, z0));
  }
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      out.push(...at(a, z0), ...at(b, z0), ...at(b, z1), ...at(a, z0), ...at(b, z1), ...at(a, z1));
    }
  }
  return new Float32Array(out);
}

const pt = (x: number, y: number): Pt => ({ x, y });
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
/** A convex ring's triangles, fanned from its first corner. */
const fan = (r: Pt[]): Pt[][] => r.slice(1, -1).map((p, i) => [r[0], p, r[i + 2]]);
const sameRing = (got: readonly Pt[], want: readonly Pt[]): boolean => {
  if (got.length !== want.length) return false;
  const k = got.findIndex((p) => p.x === want[0].x && p.y === want[0].y);
  return k >= 0 && want.every((p, i) => got[(k + i) % got.length].x === p.x && got[(k + i) % got.length].y === p.y);
};
const flip = (t: Float32Array): Float32Array => {
  const out = new Float32Array(t);
  for (let i = 0; i < t.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [t[i + 6 + k], t[i + 3 + k]];
  return out;
};

// a box
{
  const r = rect(0, 0, 4000, 200);
  const p = prismOf(prism(fan(r), [r], 0, 3000));
  check(!!p && p.z0 === 0 && p.z1 === 3000 && sameRing(p.outer, r) && p.holes.length === 0, "a box: from 0 to 3000, its outline anticlockwise, no holes");
  const inward = prismOf(flip(prism(fan(r), [r], 0, 3000)));
  check(!!inward && sameRing(inward.outer, r), "a box facing in: the same prism");
  const up = prismOf(prism(fan(r), [r], 0, 3000, true));
  check(!!up && sameRing(up.outer, r), "a box whose bottom faces up too: the same prism");
}

// a building round a courtyard, far from the origin, standing on uneven heights
{
  const X = 250_000;
  const Y = -240_000;
  const outer = rect(X, Y, X + 20_000, Y + 16_000);
  const hole = rect(X + 6000, Y + 5000, X + 14_000, Y + 11_000).reverse();
  // the ring between them: for each side, a trapezoid in two triangles
  const inner = [...hole].reverse();
  const caps: Pt[][] = [];
  for (let k = 0; k < 4; k++) {
    const [o0, o1, i0, i1] = [outer[k], outer[(k + 1) % 4], inner[k], inner[(k + 1) % 4]];
    caps.push([o0, o1, i1], [o0, i1, i0]);
  }
  const p = prismOf(prism(caps, [outer, hole], 2502.91015625, 8502.91015625));
  check(!!p && p.holes.length === 1 && sameRing(p.outer, outer) && sameRing(p.holes[0], hole), "a courtyard: the outline and one hole, clockwise");
  check(!!p && Math.abs(p.z1 - p.z0 - 6000) < 1e-3, "a courtyard: 6 m high from its float32 base");
}

// a corner on a straight run, which the ends' triangulation passes in a flat sliver, and one it passes over
{
  const ring = [pt(0, 0), pt(2000, 0), pt(4000, 0), pt(4000, 2000), pt(0, 2000)];
  const caps = [[ring[0], ring[1], ring[2]], [ring[0], ring[2], ring[3]], [ring[0], ring[3], ring[4]]];
  const p = prismOf(prism(caps, [ring], 0, 3000));
  check(!!p && sameRing(p.outer, rect(0, 0, 4000, 2000)), "a corner on a straight run, with a sliver: the outline without it");
  const passed = prismOf(prism(caps.slice(1), [ring], 0, 3000));
  check(!!passed && sameRing(passed.outer, rect(0, 0, 4000, 2000)), "a corner on a straight run the ends pass over: the outline without it");
}

// not prisms
{
  const r = rect(0, 0, 1000, 1000);
  const apex: P3 = [500, 500, 1000];
  // its sides split in two at their middles, to have as many triangles as a prism
  const pyramid: number[] = [];
  for (const [a, b] of [[r[0], r[1]], [r[1], r[2]], [r[2], r[3]], [r[3], r[0]]]) {
    const m = [(a.x + b.x) / 2, (a.y + b.y) / 2, 0];
    pyramid.push(a.x, a.y, 0, ...m, ...apex, ...m, b.x, b.y, 0, ...apex);
  }
  for (const [a, b, c] of fan(r)) pyramid.push(a.x, a.y, 0, c.x, c.y, 0, b.x, b.y, 0);
  check(prismOf(new Float32Array(pyramid)) === null, "a pyramid: not a prism");

  const box = prism(fan(r), [r], 0, 1000);
  const tilted = new Float32Array(box);
  for (let i = 0; i < tilted.length; i += 3) tilted[i] += tilted[i + 2] * 0.1;
  check(prismOf(tilted) === null, "a box leaning over: not a prism");

  const open = prism(fan(r), [r], 0, 1000).slice(9 * 2);
  check(prismOf(open) === null, "a box without its top: not a prism");

  const r2 = rect(3000, 0, 4000, 1000);
  const two = new Float32Array([...prism(fan(r), [r], 0, 1000), ...prism(fan(r2), [r2], 0, 1000)]);
  check(prismOf(two) === null, "two boxes as one piece: not a prism");

  // a figure of eight: two squares meeting at a corner
  const eight = [pt(0, 0), pt(1000, 0), pt(1000, 1000), pt(2000, 1000), pt(2000, 2000), pt(1000, 2000), pt(1000, 1000), pt(0, 1000)];
  const eightCaps = [[eight[0], eight[1], eight[2]], [eight[0], eight[2], eight[7]], [eight[3], eight[4], eight[5]], [eight[3], eight[5], eight[6]]];
  check(prismOf(prism(eightCaps, [eight], 0, 1000)) === null, "an outline touching itself: not a prism");

  const sheet: number[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const z = (x: number, y: number): number => 10 * Math.sin(x + y);
    const [x, y] = [i * 100, j * 100];
    sheet.push(x, y, z(i, j), x + 100, y, z(i + 1, j), x + 100, y + 100, z(i + 1, j + 1), x, y, z(i, j), x + 100, y + 100, z(i + 1, j + 1), x, y + 100, z(i, j + 1));
  }
  check(prismOf(new Float32Array(sheet)) === null, "uneven ground: not a prism");
}

console.log(failures ? `${failures} check(s) failed` : "all prism checks passed");
process.exit(failures ? 1 : 0);
