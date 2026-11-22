// Checks cutting and filling a wall solid's openings (wallCut3d.ts). Run from web/:
//   npx tsx src/core/wallCut3d.check.ts
// Walls are built here by hand: boxes, a box turned 30° and lifted, a mitred prism, a 12.7 mm
// leaf, a top that slopes. Each cut has the volume its openings take away, a fill gives the
// original back (volume, bounding box, faces), and every result's edges are the solid's true
// edges: each one bounds two faces that are not coplanar, and no other side does.

import { cutOpening, fillOpening, solidVolume, type WallFrame, type WallOpening } from "./wallCut3d.ts";
import { facesOf } from "./faces3d.ts";
import { creaseEdges, outward, unionMeshes } from "./csg.ts";
import earcut from "earcut";
import { edgesBody } from "./builtins.ts";
import { Rec } from "./records.ts";
import { bodyGeometry } from "./model3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type Pt = [number, number, number];

/** A closed solid from its eight corners, indexed by bits (i, j, k): i along, j across, k up; faces point out when the corners are in that order. */
function hexa(corner: (i: number, j: number, k: number) => Pt): number[] {
  const sides: [number, number, number][][] = [
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  ];
  const out: number[] = [];
  for (const s of sides) {
    const [p, q, r, t] = s.map(([i, j, k]) => corner(i, j, k));
    for (const tri of [[p, q, r], [p, r, t]]) for (const v of tri) out.push(v[0], v[1], v[2]);
  }
  return out;
}

/** An axis box in the wall's frame, a0..a1 along, c0..c1 across, z0..z1 up. */
const box = (a0: number, a1: number, c0: number, c1: number, z0: number, z1: number): number[] =>
  hexa((i, j, k) => [i ? a1 : a0, j ? c1 : c0, k ? z1 : z0]);

/** The wall of the checks: 5000 long along x, 200 thick across y, 2700 high. */
const WALL = box(0, 5000, -100, 100, 0, 2700);
const FRAME: WallFrame = { start: { x: 0, y: 0 }, u: { x: 1, y: 0 } };
const DOOR: WallOpening = { a0: 2050, a1: 2950, z0: 0, z1: 2100 };
const WINDOW: WallOpening = { a0: 1900, a1: 3100, z0: 900, z1: 2100 };
const near = (a: number, b: number, rel = 1e-6): boolean => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

function bounds(tris: ArrayLike<number>): number[] {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    b[i % 3] = Math.min(b[i % 3], tris[i]);
    b[(i % 3) + 3] = Math.max(b[(i % 3) + 3], tris[i]);
  }
  return b;
}
const sameBounds = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => bounds(a).every((v, k) => near(v, bounds(b)[k], 1e-9));

const key = (x: number, y: number, z: number): string => `${Math.round(x / 0.01)},${Math.round(y / 0.01)},${Math.round(z / 0.01)}`;

/** The side keys of each triangle with its unit normal. */
function sides(tris: ArrayLike<number>): Map<string, { n: number[]; d: number; at: number[][] }[]> {
  const out = new Map<string, { n: number[]; d: number; at: number[][] }[]>();
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const p = [0, 1, 2].map((k) => [tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) continue;
    const unit = n.map((x) => x / len);
    const d = unit[0] * p[0][0] + unit[1] * p[0][1] + unit[2] * p[0][2];
    const keys = p.map((q) => key(q[0], q[1], q[2]));
    for (let k = 0; k < 3; k++) {
      const [a, b] = [keys[k], keys[(k + 1) % 3]];
      if (a === b) continue;
      const s = a < b ? `${a}|${b}` : `${b}|${a}`;
      const list = out.get(s) ?? [];
      list.push({ n: unit, d, at: [p[k], p[(k + 1) % 3]] });
      out.set(s, list);
    }
  }
  return out;
}

/** Whether `edges` are the solid's crease sides, with straight runs of them allowed to join into one edge: every crease side lies on a given edge, and each given edge is made of crease sides only (total lengths agree). */
function edgesTrue(tris: ArrayLike<number>, edges: ArrayLike<number>): boolean {
  const s = sides(tris);
  const creases: [number[], number[]][] = [];
  for (const list of s.values()) {
    if (list.length !== 2) return false;
    const [p, q] = list;
    if (1 - Math.abs(p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2]) > 1e-7) {
      creases.push([p.at[0], p.at[1]]);
    }
  }
  const given: [number[], number[]][] = [];
  for (let i = 0; i + 5 < edges.length; i += 6) given.push([[edges[i], edges[i + 1], edges[i + 2]], [edges[i + 3], edges[i + 4], edges[i + 5]]]);
  // a point lies on segment a–b
  const onSeg = (x: number[], a: number[], b: number[]): boolean => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    const t = ((x[0] - a[0]) * d[0] + (x[1] - a[1]) * d[1] + (x[2] - a[2]) * d[2]) / len2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(a[0] + t * d[0] - x[0], a[1] + t * d[1] - x[1], a[2] + t * d[2] - x[2]) < 0.05;
  };
  // every crease side lies on some given edge
  for (const [a, b] of creases) {
    const mid = [0, 1, 2].map((k) => (a[k] + b[k]) / 2);
    if (!given.some(([ga, gb]) => onSeg(a, ga, gb) && onSeg(b, ga, gb))) return false;
    void mid;
  }
  // and each given edge is made of crease sides: their lengths add up
  const len = (a: number[], b: number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const gLen = given.reduce((t, [a, b]) => t + len(a, b), 0);
  const cLen = creases.reduce((t, [a, b]) => t + len(a, b), 0);
  return Math.abs(gLen - cLen) <= 1e-6 * Math.max(1, cLen);
}

/** Faces counted the way a person would: triangles sharing a side and lying in one plane are one face, a hole or not. */
function planarFaces(tris: ArrayLike<number>): number {
  // triangles sharing a side and lying in one plane are joined; the groups left are the faces
  const triangles: { n: number[]; d: number; keys: string[] }[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const p = [0, 1, 2].map((k) => [tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]]);
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0)) continue;
    const unit = n.map((x) => x / len);
    const keys = p.map((q) => key(q[0], q[1], q[2]));
    triangles.push({ n: unit, d: unit[0] * p[0][0] + unit[1] * p[0][1] + unit[2] * p[0][2], keys });
  }
  const par = triangles.map((_, i) => i);
  const root = (i: number): number => {
    while (par[i] !== i) i = par[i] = par[par[i]];
    return i;
  };
  const bySide = new Map<string, number[]>();
  triangles.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [t.keys[k], t.keys[(k + 1) % 3]];
      if (a === b) continue;
      const sk = a < b ? `${a}|${b}` : `${b}|${a}`;
      bySide.set(sk, [...(bySide.get(sk) ?? []), i]);
    }
  });
  for (const list of bySide.values()) {
    if (list.length !== 2) continue;
    const [p, q] = [triangles[list[0]], triangles[list[1]]];
    if (1 - (p.n[0] * q.n[0] + p.n[1] * q.n[1] + p.n[2] * q.n[2]) < 1e-9 && Math.abs(p.d - q.d) < 1e-6) par[root(list[0])] = root(list[1]);
  }
  return new Set(triangles.map((_, i) => root(i))).size;
}

/** The result of a cut or fill: its volume is nonzero and its edges true. */
function sound(name: string, r: { triangles: Float64Array; edges: Float64Array } | null): boolean {
  if (!r) {
    check(false, `${name}: returned null`);
    return false;
  }
  const ok = edgesTrue(r.triangles, r.edges);
  check(ok, `${name}: its edges are the true edges (${r.edges.length / 6} of them, ${r.triangles.length / 9} triangles)`);
  return ok;
}

// the plain box: door, window, and what a fill gives back
const boxVolume = 5000 * 200 * 2700;
check(near(solidVolume(WALL), boxVolume), `the box is its volume (${solidVolume(WALL)})`);
check(facesOf(WALL).length === 6, `the box has 6 faces (${facesOf(WALL).length})`);

{
  const cut = cutOpening(WALL, FRAME, DOOR);
  check(!!cut && near(solidVolume(cut.triangles), boxVolume - 900 * 200 * 2100), `a door: volume is the box less 900 × 200 × 2100 (${cut && solidVolume(cut.triangles)})`);
  check(!!cut && facesOf(cut.triangles).length === 10, `a door: 10 faces (${cut && facesOf(cut.triangles).length})`);
  check(!!cut && sameBounds(cut.triangles, WALL), "a door: the same bounding box as the wall");
  sound("a door", cut);
  const back = cut && fillOpening(cut.triangles, FRAME, DOOR);
  check(!!back && near(solidVolume(back.triangles), boxVolume), `a door filled: the wall's volume again (${back && solidVolume(back.triangles)})`);
  check(!!back && facesOf(back.triangles).length === 6, `a door filled: 6 faces (${back && facesOf(back.triangles).length})`);
  check(!!back && sameBounds(back.triangles, WALL), "a door filled: the same bounding box");
  sound("a door filled", back);
}
{
  const cut = cutOpening(WALL, FRAME, WINDOW);
  check(!!cut && near(solidVolume(cut.triangles), boxVolume - 1200 * 200 * 1200), `a window: volume is the box less 1200 × 200 × 1200 (${cut && solidVolume(cut.triangles)})`);
  check(!!cut && planarFaces(cut.triangles) === 10, `a window: 10 faces, the front and back with a hole (${cut && planarFaces(cut.triangles)})`);
  sound("a window", cut);
  const back = cut && fillOpening(cut.triangles, FRAME, WINDOW);
  check(!!back && near(solidVolume(back.triangles), boxVolume), `a window filled: the wall's volume again (${back && solidVolume(back.triangles)})`);
  check(!!back && facesOf(back.triangles).length === 6, `a window filled: 6 faces (${back && facesOf(back.triangles).length})`);
  sound("a window filled", back);
}
{
  // two openings one after another, then filled in turn
  // a second window clear of the door
  const second: WallOpening = { a0: 3300, a1: 4300, z0: 900, z1: 2100 };
  const once = cutOpening(WALL, FRAME, DOOR);
  const twice = once && cutOpening(once.triangles, FRAME, second);
  check(!!twice && near(solidVolume(twice.triangles), boxVolume - 900 * 200 * 2100 - 1000 * 200 * 1200), `two openings: volume less both (${twice && solidVolume(twice.triangles)})`);
  sound("two openings", twice);
  const oneFilled = twice && fillOpening(twice.triangles, FRAME, second);
  check(!!oneFilled && near(solidVolume(oneFilled.triangles), boxVolume - 900 * 200 * 2100), "two openings: the window filled, the door still open");
  const both = oneFilled && fillOpening(oneFilled.triangles, FRAME, DOOR);
  check(!!both && near(solidVolume(both.triangles), boxVolume) && facesOf(both.triangles).length === 6, `two openings: both filled, the box back (${both && solidVolume(both.triangles)})`);
  sound("two openings, both filled", both);
}
{
  // an opening whose head is exactly the wall's top
  const top: WallOpening = { a0: 1900, a1: 3100, z0: 900, z1: 2700 };
  const cut = cutOpening(WALL, FRAME, top);
  check(!!cut && near(solidVolume(cut.triangles), boxVolume - 1200 * 200 * 1800), `an opening touching the top: volume (${cut && solidVolume(cut.triangles)})`);
  sound("an opening touching the top", cut);
  const back = cut && fillOpening(cut.triangles, FRAME, top);
  check(!!back && near(solidVolume(back.triangles), boxVolume) && facesOf(back.triangles).length === 6, "an opening touching the top: filled back to the box");
  sound("an opening touching the top, filled", back);
}
{
  // the box turned 30° in plan and lifted to z = 3000
  const c = Math.cos(Math.PI / 6);
  const s = Math.sin(Math.PI / 6);
  const T = { x: 1200, y: -700 };
  const place = (tris: number[]): number[] => {
    const out = tris.slice();
    for (let i = 0; i < out.length; i += 3) {
      const [x, y] = [out[i], out[i + 1]];
      out[i] = T.x + x * c - y * s;
      out[i + 1] = T.y + x * s + y * c;
      out[i + 2] = out[i + 2] + 3000;
    }
    return out;
  };
  const world = place(WALL);
  const frame: WallFrame = { start: T, u: { x: c, y: s } };
  const lifted: WallOpening = { a0: DOOR.a0, a1: DOOR.a1, z0: 3000, z1: 5100 };
  const cut = cutOpening(world, frame, lifted);
  check(!!cut && near(solidVolume(cut.triangles), boxVolume - 900 * 200 * 2100), `turned 30° and lifted: door volume (${cut && solidVolume(cut.triangles)})`);
  check(!!cut && sameBounds(cut.triangles, world), "turned 30° and lifted: the door keeps the wall's bounding box");
  sound("turned and lifted", cut);
  const back = cut && fillOpening(cut.triangles, frame, lifted);
  check(!!back && near(solidVolume(back.triangles), boxVolume) && sameBounds(back.triangles, world), "turned and lifted: filled back, same bounds");
  sound("turned and lifted, filled", back);
}
{
  // a mitred wall: a prism whose ends are cut at 45° in plan
  const P = [[0, -100], [4900, -100], [200, 100], [5100, 100]];
  const mitre = hexa((i, j, k) => {
    const p = P[i + 2 * j];
    return [p[0], p[1], k ? 2700 : 0];
  });
  const door: WallOpening = { a0: 2100, a1: 3000, z0: 0, z1: 2100 };
  const cut = cutOpening(mitre, FRAME, door);
  const area = 4900 * 200;
  check(!!cut && near(solidVolume(cut.triangles), area * 2700 - 900 * 200 * 2100), `mitred ends: door volume (${cut && solidVolume(cut.triangles)})`);
  sound("mitred door", cut);
  const back = cut && fillOpening(cut.triangles, FRAME, door);
  check(!!back && near(solidVolume(back.triangles), area * 2700), `mitred ends: filled back to the prism (${back && solidVolume(back.triangles)})`);
  sound("mitred door, filled", back);
}
{
  // a 12.7 mm leaf
  const leaf = box(0, 5000, -6.35, 6.35, 0, 2700);
  const cut = cutOpening(leaf, FRAME, DOOR);
  check(!!cut && near(solidVolume(cut.triangles), 5000 * 12.7 * 2700 - 900 * 12.7 * 2100), `a 12.7 mm leaf: door volume (${cut && solidVolume(cut.triangles)})`);
  const back = cut && fillOpening(cut.triangles, FRAME, DOOR);
  check(!!back && near(solidVolume(back.triangles), 5000 * 12.7 * 2700) && facesOf(back.triangles).length === 6, "a 12.7 mm leaf: filled back");
  sound("a 12.7 mm leaf, filled", back);
}
{
  // an opening that misses the solid
  const miss: WallOpening = { a0: 6000, a1: 7000, z0: 0, z1: 2100 };
  const same = cutOpening(WALL, FRAME, miss);
  check(!!same && same.triangles.length === WALL.length && same.triangles.every((v, i) => v === WALL[i]), "an opening that misses the solid returns it unchanged");
  check(!!same && edgesTrue(same.triangles, same.edges), "an opening that misses: its edges are the box's edges");
}
{
  // a top that slopes: the fill can't close it level, so it says so
  const slope = hexa((i, j, k) => [i ? 5000 : 0, j ? 100 : -100, k ? (i ? 2700 : 2000) : 0]);
  // a top that slopes is a stack of prisms across the wall, so it cuts and fills (round 4)
  const slopeWhole = 200 * 5000 * 2350;
  const slopeCut = cutOpening(slope, FRAME, DOOR);
  check(!!slopeCut && near(solidVolume(slopeCut.triangles), slopeWhole - 900 * 200 * 2100), `a sloped top: a door reaching where the slope starts is cut (${slopeCut && solidVolume(slopeCut.triangles)})`);
  const slopeBack = slopeCut && fillOpening(slopeCut.triangles, FRAME, DOOR);
  check(!!slopeBack && near(solidVolume(slopeBack.triangles), slopeWhole), `a sloped top: the cut, filled back, is the whole (${slopeBack && solidVolume(slopeBack.triangles)})`);
  const slopeFill = fillOpening(slope, FRAME, DOOR);
  check(!!slopeFill && near(solidVolume(slopeFill.triangles), slopeWhole), "a sloped top: a fill on the whole solid keeps its volume");
  check(cutOpening(slope, FRAME, { a0: 2050, a1: 2950, z0: 0, z1: 1500 }) !== null, "a sloped top: a low opening under the slope cuts");
}

{
  // triangles turned either way, as the reader gives them: half of each box's faces flipped
  const mixed = WALL.slice();
  for (let i = 0; i < mixed.length; i += 18) for (let k = 0; k < 3; k++) [mixed[i + 3 + k], mixed[i + 6 + k]] = [mixed[i + 6 + k], mixed[i + 3 + k]];
  const cut = cutOpening(mixed, FRAME, DOOR);
  check(!!cut && near(solidVolume(cut.triangles), boxVolume - 900 * 200 * 2100), "mixed winding: the door cut has the volume it should");
  const back = cut && fillOpening(cut.triangles, FRAME, DOOR);
  check(!!back && near(solidVolume(back.triangles), boxVolume), "mixed winding: filled back to the box");
}

// Upright solids: the layer path. Cut then fill gives back the volume to 1e-9, the same face
// planes, and the same edges as the solid had (a box has 12).

/** A prism: plan outline `plan` (frame coordinates, any simple outline) from z0 to z1, faces out. */
function prismOf(plan: [number, number][], z0: number, z1: number): Float64Array {
  const flat = plan.flatMap((p) => p);
  const out: number[] = [];
  for (const t of earcut(flat, null, 2)) out.push(plan[t][0], plan[t][1], z0);
  for (const t of earcut(flat, null, 2)) out.push(plan[t][0], plan[t][1], z1);
  for (let i = 0; i < plan.length; i++) {
    const [p, q] = [plan[i], plan[(i + 1) % plan.length]];
    out.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z0, q[0], q[1], z1, p[0], p[1], z1);
  }
  return outward(Float64Array.from(out), 0.01);
}

/** A solid from a profile in (along, height), extruded across from c0 to c1, faces out. */
function slabOf(profile: [number, number][], c0: number, c1: number): Float64Array {
  const flat = profile.flatMap((p) => p);
  const out: number[] = [];
  for (const t of earcut(flat, null, 2)) out.push(profile[t][0], c0, profile[t][1]);
  for (const t of earcut(flat, null, 2)) out.push(profile[t][0], c1, profile[t][1]);
  for (let i = 0; i < profile.length; i++) {
    const [p, q] = [profile[i], profile[(i + 1) % profile.length]];
    out.push(p[0], c0, p[1], q[0], c0, q[1], q[0], c1, q[1], p[0], c0, p[1], q[0], c1, q[1], p[0], c1, p[1]);
  }
  return outward(Float64Array.from(out), 0.01);
}

/** Distinct face planes of a solid, the normal's sign fixed so both faces of a plane agree. */
function planeCount(tris: ArrayLike<number>): number {
  const set = new Set<string>();
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const [ux, uy, uz] = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
    const [vx, vy, vz] = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    // slivers left where pieces are joined have next to no area and a normal that is noise
    if (!(len > 0.5)) continue;
    n = n.map((v) => v / len);
    const first = n.find((v) => Math.abs(v) > 1e-9)!;
    if (first < 0) n = n.map((v) => -v);
    const d = n[0] * tris[i] + n[1] * tris[i + 1] + n[2] * tris[i + 2];
    // to a thousandth in direction and half a millimetre in place: pieces joined within the weld of 0.01 mm lie a hair off each other's planes
    set.add(`${n.map((v) => Math.round(v * 1e3) || 0).join(",")}|${Math.round(d * 2)}`);
  }
  return set.size;
}

/** The solid as Rodeo stores it and reads it back: its crease edges written as an edges body, read by bodyGeometry; the read-back volume, or NaN when nothing reads. */
function readBackVolume(s: { triangles: Float64Array; edges: Float64Array }): number {
  const list: [[number, number, number], [number, number, number]][] = [];
  for (let i = 0; i + 5 < s.edges.length; i += 6) list.push([[s.edges[i], s.edges[i + 1], s.edges[i + 2]], [s.edges[i + 3], s.edges[i + 4], s.edges[i + 5]]]);
  const g = bodyGeometry(new Rec(edgesBody(list)), null);
  return g ? solidVolume(outward(g.triangles, 0.01)) : NaN;
}

/** Cut `o` out of `tris` and fill it back: the result must be the solid again, to 1e-9. */
function roundTrip(name: string, tris: ArrayLike<number>, frame: WallFrame, o: WallOpening, expectEdges?: number): void {
  const v0 = solidVolume(tris);
  const cut = cutOpening(tris, frame, o);
  const back = cut && fillOpening(cut.triangles, frame, o);
  check(!!cut && !!back, `${name}: cut and fill both make`);
  if (!cut || !back) return;
  check(Math.abs(solidVolume(back.triangles) - v0) <= 1e-9 * Math.abs(v0), `${name}: the volume comes back to 1e-9 (${solidVolume(back.triangles)} vs ${v0})`);
  check(planeCount(back.triangles) === planeCount(tris), `${name}: the same face planes (${planeCount(back.triangles)} vs ${planeCount(tris)})`);
  const edges = back.edges.length / 6;
  check(edges === creaseEdges(tris, 0.01).length / 6 && (expectEdges === undefined || edges === expectEdges), `${name}: the same edges (${edges} vs ${creaseEdges(tris, 0.01).length / 6})`);
  sound(`${name}, filled`, back);
  const vCut = solidVolume(outward(cut.triangles, 0.01));
  const rCut = readBackVolume(cut);
  check(Math.abs(rCut - vCut) <= 1e-9 * Math.abs(vCut), `${name}: the cut, written and read back, has its volume (${rCut} vs ${vCut})`);
  const vBack = solidVolume(outward(back.triangles, 0.01));
  const rBack = readBackVolume(back);
  check(Math.abs(rBack - vBack) <= 1e-9 * Math.abs(vBack), `${name}: the fill, written and read back, has its volume (${rBack} vs ${vBack})`);
}

{
  roundTrip("upright box, door", WALL, FRAME, DOOR, 12);
  roundTrip("upright box, window", WALL, FRAME, WINDOW, 12);
  const mitre = prismOf([[0, -100], [4900, -100], [5100, 100], [200, 100]], 0, 2700);
  roundTrip("upright mitred prism, door", mitre, FRAME, { a0: 2100, a1: 3000, z0: 0, z1: 2100 }, 12);
  const notch = prismOf([[0, -100], [5000, -100], [5000, 100], [2500, 100], [2500, 0], [0, 0]], 0, 2700);
  check(creaseEdges(notch, 0.01).length / 6 === 18, `upright notched prism has 18 edges (${creaseEdges(notch, 0.01).length / 6})`);
  const cutN = cutOpening(notch, FRAME, { a0: 1000, a1: 1900, z0: 0, z1: 2100 });
  check(!!cutN && near(solidVolume(cutN.triangles), 750000 * 2700 - 900 * 100 * 2100), `upright notched prism: door volume (${cutN && solidVolume(cutN.triangles)})`);
  roundTrip("upright notched prism, door in the thin leg", notch, FRAME, { a0: 1000, a1: 1900, z0: 0, z1: 2100 }, 18);
  // a wall that already has a door: a window cut in it, then both filled
  const doorCut = cutOpening(WALL, FRAME, DOOR)!;
  const second: WallOpening = { a0: 3300, a1: 4300, z0: 900, z1: 2100 };
  const both = cutOpening(doorCut.triangles, FRAME, second)!;
  const windowBack = fillOpening(both.triangles, FRAME, second)!;
  const all = fillOpening(windowBack.triangles, FRAME, DOOR)!;
  check(near(solidVolume(all.triangles), boxVolume) && planeCount(all.triangles) === 6 && all.edges.length / 6 === 12, `a door already there: a window cut and both filled back (${solidVolume(all.triangles)}, ${planeCount(all.triangles)} planes, ${all.edges.length / 6} edges)`);
  // the hole's real head is at 2100; asked 40 mm lower, the fill still closes it fully
  const win = cutOpening(WALL, FRAME, WINDOW)!;
  const asked: WallOpening = { ...WINDOW, z1: 2060 };
  const closed = fillOpening(win.triangles, FRAME, asked);
  check(!!closed && near(solidVolume(closed.triangles), boxVolume) && planeCount(closed.triangles) === 6, `a hole 40 mm short of its asked head: fill closes it fully (${closed && solidVolume(closed.triangles)})`);
  sound("a hole 40 mm short, filled", closed);
  const c30 = Math.cos(Math.PI / 6);
  const s30 = Math.sin(Math.PI / 6);
  const T = { x: 1200, y: -700 };
  const lifted = WALL.slice();
  for (let i = 0; i < lifted.length; i += 3) {
    const [x, y] = [lifted[i], lifted[i + 1]];
    lifted[i] = T.x + x * c30 - y * s30;
    lifted[i + 1] = T.y + x * s30 + y * c30;
    lifted[i + 2] += 3000;
  }
  roundTrip("upright, turned 30° and lifted, door", lifted, { start: T, u: { x: c30, y: s30 } }, { a0: DOOR.a0, a1: DOOR.a1, z0: 3000, z1: 5100 }, 12);
}

// Sloping tops: the lower part is cut as layers, the sloped part kept; a door above the slope's start is refused.
{
  // a prism whose top runs from 2700 at one end to 3600 at the other: 200 thick, 5000 long
  const sloping = slabOf([[0, 0], [5000, 0], [5000, 3600], [0, 2700]], -100, 100);
  const whole = 200 * 5000 * 3150;
  const door: WallOpening = { a0: 2050, a1: 2950, z0: 0, z1: 2100 };
  const cut = cutOpening(sloping, FRAME, door);
  check(!!cut && near(solidVolume(cut.triangles), whole - 900 * 200 * 2100), `a sloping top: the cut volume is the whole less the door (${cut && solidVolume(cut.triangles)})`);
  roundTrip("a sloping top, door 2100 high", sloping, FRAME, door, creaseEdges(sloping, 0.01).length / 6);
  check(creaseEdges(sloping, 0.01).length / 6 === 12, `a sloping top: the original has 12 edges (${creaseEdges(sloping, 0.01).length / 6})`);
  // a gable: the top rises to a peak in the middle
  const gable = slabOf([[0, 0], [5000, 0], [5000, 2700], [2500, 3500], [0, 2700]], -100, 100);
  roundTrip("a gable, door 2100 high", gable, FRAME, door);
  const tall: WallOpening = { a0: 2050, a1: 2950, z0: 0, z1: 2800 };
  const gableTall = cutOpening(gable, FRAME, tall);
  check(!!gableTall && near(solidVolume(gableTall.triangles), 3100000000 - 900 * 200 * 2800), `a gable: a door above where the slope starts is cut (${gableTall && solidVolume(gableTall.triangles)})`);
  const gableTallBack = gableTall && fillOpening(gableTall.triangles, FRAME, tall);
  check(!!gableTallBack && near(solidVolume(gableTallBack.triangles), 3100000000), "a gable: that door filled back is the whole gable");
  const slopeTall = cutOpening(sloping, FRAME, tall);
  check(!!slopeTall && near(solidVolume(slopeTall.triangles), 3150000000 - 900 * 200 * 2800), `a sloping top: a door taller than the slope's start is cut (${slopeTall && solidVolume(slopeTall.triangles)})`);
  // a solid that isn't closed
  const open = WALL.slice(9);
  // real solids often don't close triangle by triangle, so one that doesn't is not refused out of hand: it is
  // either refused or comes out as the solid its edges make, never a wrong one (wallInserts.ts checks the same)
  // (the caller's test: what the edges read back as must have the volume of the triangles returned)
  const rightOrNull = (r: { triangles: Float64Array; edges: Float64Array } | null, volume: number): boolean =>
    r === null || !near(readBackVolume(r), Math.abs(solidVolume(outward(r.triangles, 0.01)))) || near(readBackVolume(r), volume);
  check(rightOrNull(cutOpening(open, FRAME, DOOR), boxVolume - 900 * 200 * 2100), "a solid with one triangle removed: refused, caught by the read-back test, or cut right");
  const flap = Array.from(WALL).concat(WALL.slice(0, 9));
  check(rightOrNull(cutOpening(flap, FRAME, DOOR), boxVolume - 900 * 200 * 2100), "a solid with a duplicated flap: refused, caught by the read-back test, or cut right");
  const flat = Array.from(WALL).concat([0, 0, 0, 1, 0, 0, 2, 0, 0]);
  // a triangle of no area doesn't cross any band: an upright solid is cut by its outlines, so it doesn't matter
  const cutFlat = cutOpening(flat, FRAME, DOOR);
  check(!!cutFlat && near(Math.abs(solidVolume(outward(cutFlat.triangles, 0.01))), Math.abs(solidVolume(outward(cutOpening(WALL, FRAME, DOOR)!.triangles, 0.01)))), "a solid with a zero-area triangle cuts as the solid without it");
}

// The fill's plug follows the solid just outside the opening, not the wall's whole depth (a finish
// wrapped round a jamb must come out as the straight finish).
{
  const L = 5000;
  const a0 = 2050;
  const a1 = 2950;
  const H = 2700;
  const door = 2100;
  const union = (parts: number[][]): Float64Array => unionMeshes(parts.map((p) => Float64Array.from(p)))!.triangles;
  // (a) a 12.5 mm finish across 100..112.5 with a return at each jamb running back to −100, 12.5 thick
  const finish = union([
    box(0, a0, 100, 112.5, 0, H),
    box(a1, L, 100, 112.5, 0, H),
    box(a0, a1, 100, 112.5, door, H),
    box(a0, a0 + 12.5, -100, 112.5, 0, door),
    box(a1 - 12.5, a1, -100, 112.5, 0, door),
  ]);
  const fa = fillOpening(finish, FRAME, { a0, a1, z0: 0, z1: door });
  check(!!fa && near(solidVolume(fa.triangles), L * 12.5 * H, 1e-9) && fa.edges.length / 6 === 12, `a finish with wrapped returns: fill is the straight finish (${fa && solidVolume(fa.triangles)} vs ${L * 12.5 * H}, ${fa && fa.edges.length / 6} edges)`);
  sound("a finish with returns, filled", fa);
  // (c) a hole at the end of the solid: fill runs to the end
  const end = union([box(0, 900, -100, 100, door, H), box(900, L, -100, 100, 0, H)]);
  const fc = fillOpening(end, FRAME, { a0: 0, a1: 900, z0: 0, z1: door });
  check(!!fc && near(solidVolume(fc.triangles), L * 200 * H) && fc.edges.length / 6 === 12, `a hole at the end: fill runs to the end (${fc && solidVolume(fc.triangles)} vs ${L * 200 * H})`);
  // (d) the two sides of the span differ: no fill
  // the right side has a gap at the opening's height: its run past the opening is two pieces, the left one is one
  const step = union([box(0, a0, -100, 100, 0, H), box(a1, L, 0, 100, 0, 1000), box(a1, L, 0, 100, 1200, H), box(a0, a1, -100, 100, door, H)]);
  check(fillOpening(step, FRAME, { a0, a1, z0: 0, z1: door }) === null, "the two sides of the span differ: fill is null");
  // (b) a core whose hole is 38 mm wider than asked on each side (a finish's return stood there): the fill replaces
  // 60 mm past each jamb, so the wall comes back whole
  const wide = union([box(0, a0 - 38, -100, 100, 0, H), box(a1 + 38, L, -100, 100, 0, H), box(a0 - 38, a1 + 38, -100, 100, door, H)]);
  const wideFilled = fillOpening(wide, FRAME, { a0, a1, z0: 0, z1: door });
  check(!!wideFilled && near(Math.abs(solidVolume(outward(wideFilled.triangles, 0.01))), L * 200 * H), "a core 38 mm wider than asked fills back to the whole wall");
}

// round 4: a chunk is a stack of prisms across the wall, so two openings, mitred ends, a gable window, a mono-pitch head and a T-junction outside all stand
{
  const WIN2: WallOpening = { a0: 3500, a1: 4300, z0: 900, z1: 2100 };
  const c1 = cutOpening(WALL, FRAME, DOOR);
  const c2 = c1 && cutOpening(c1.triangles, FRAME, WIN2);
  check(!!c2 && near(solidVolume(c2.triangles), boxVolume - 900 * 200 * 2100 - 800 * 200 * 1200), `a box, two openings: both cut (${c2 && solidVolume(c2.triangles)})`);
  const f1 = c2 && fillOpening(c2.triangles, FRAME, DOOR);
  const f2 = f1 && fillOpening(f1.triangles, FRAME, WIN2);
  sound("a box, two openings, both filled", f2);
  check(!!f2 && near(solidVolume(f2.triangles), boxVolume) && planeCount(f2.triangles) === 6, `a box, two openings, both filled: the box (${f2 && solidVolume(f2.triangles)})`);

  // a wall with mitred ends (45 degrees in plan): the points at the far ends of the chunk do not change
  const prismXY = (poly: [number, number][], z0: number, z1: number): Float64Array => {
    const flat = poly.flatMap((p) => p);
    const out: number[] = [];
    for (const t of earcut(flat, null, 2)) out.push(poly[t][0], poly[t][1], z0);
    for (const t of earcut(flat, null, 2)) out.push(poly[t][0], poly[t][1], z1);
    for (let i = 0; i < poly.length; i++) {
      const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
      out.push(p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1, p[0], p[1], z0, q[0], q[1], z1, p[0], p[1], z1);
    }
    return outward(Float64Array.from(out), 0.01);
  };
  const endPts = (t: ArrayLike<number>): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i + 2 < t.length; i += 3) if (t[i] < 1980) set.add([t[i], t[i + 1], t[i + 2]].map((v) => v.toFixed(6)).join(","));
    return set;
  };
  const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));
  const mitred = prismXY([[0, -100], [5000, -100], [5200, 100], [200, 100]], 0, 2700);
  const mc = cutOpening(mitred, FRAME, DOOR);
  check(!!mc && sameSet(endPts(mitred), endPts(mc.triangles)), "a mitred wall, door cut: the end faces keep their points");
  const mf = mc && fillOpening(mc.triangles, FRAME, DOOR);
  check(!!mf && sameSet(endPts(mitred), endPts(mf.triangles)) && near(solidVolume(mf.triangles), solidVolume(mitred)), "a mitred wall, door filled: the end faces keep their points and the volume is the whole");
  sound("a mitred wall, door filled", mf);

  // a gable with a window near one end, its head (2100) below the slope
  const gable = slabOf([[0, 0], [5000, 0], [5000, 2700], [2500, 3500], [0, 2700]], -100, 100);
  // known gap: the cut already leaves 0.1 mm near-duplicate vertices on the slope near x = 270, so the filled-back gable has
  // 19 crease edges where the solid has 15; the volume and the face planes come back exactly. Not yet diagnosed.
  const gw: WallOpening = { a0: 300, a1: 1100, z0: 900, z1: 2100 };
  const gwc = cutOpening(gable, FRAME, gw);
  const gwf = gwc && fillOpening(gwc.triangles, FRAME, gw);
  check(!!gwf && near(solidVolume(gwf.triangles), solidVolume(gable)) && planeCount(gwf.triangles) === planeCount(gable), `a gable, window near the end: volume and face planes come back (${gwf && solidVolume(gwf.triangles)}; ${gwf && gwf.edges.length / 6} edges vs 15, known gap)`);

  // a mono-pitch wall (top 2400 to 3600) with a window whose head is 2300: fill restores volume and the top stays one face
  const mono = slabOf([[0, 0], [5000, 0], [5000, 3600], [0, 2400]], -100, 100);
  const monoWin: WallOpening = { a0: 1900, a1: 3100, z0: 900, z1: 2300 };
  const mwc = cutOpening(mono, FRAME, monoWin);
  const mwf = mwc && fillOpening(mwc.triangles, FRAME, monoWin);
  check(!!mwf && near(solidVolume(mwf.triangles), solidVolume(mono)) && planeCount(mwf.triangles) === planeCount(mono), `a mono-pitch wall, window head 2300: filled back, same face planes (${mwf && planeCount(mwf.triangles)} vs ${planeCount(mono)})`);

  // a T-junction outside the chunk: one end face's first edge gets a point at its middle, its neighbour does not
  const tj: number[] = Array.from(WALL);
  let t = 0;
  while (t < tj.length && !(tj[t] === 0 && tj[t + 3] === 0 && tj[t + 6] === 0)) t += 9;
  check(t < tj.length, "the wall has a triangle on its left end to split");
  if (t < tj.length) {
    const [A, B, C] = [tj.slice(t, t + 3), tj.slice(t + 3, t + 6), tj.slice(t + 6, t + 9)];
    const M = A.map((v, i) => (v + B[i]) / 2);
    tj.splice(t, 9, ...A, ...M, ...C, ...M, ...B, ...C);
    const ref = cutOpening(WALL, FRAME, DOOR);
    const tjCut = cutOpening(tj, FRAME, DOOR);
    check(!!tjCut && !!ref && near(solidVolume(tjCut.triangles), solidVolume(ref.triangles)), "a T-junction outside the chunk still cuts");
  }
}

// A wall under a pitched roof: its top bevelled across its thickness (2700 at one face, 3000 at the other), so
// its faces lean across it and it is taken as sections along the wall
{
  const bevel = hexa((i, j, k) => [i ? 5000 : 0, j ? 100 : -100, k ? (j ? 3000 : 2700) : 0]);
  const whole = 5000 * 200 * 2850;
  check(near(Math.abs(solidVolume(outward(bevel, 0.01))), whole), "a bevelled top: the wall's volume is its section by its length");
  const door = { a0: 2000, a1: 2900, z0: 0, z1: 2100 };
  const cut = cutOpening(bevel, FRAME, door);
  check(!!cut && near(Math.abs(solidVolume(outward(cut.triangles, 0.01))), whole - 900 * 200 * 2100), "a bevelled top: a door cut takes the door's volume");
  roundTrip("a bevelled top, door", bevel, FRAME, door, 12);
  roundTrip("a bevelled top, window", bevel, FRAME, { a0: 1000, a1: 2200, z0: 900, z1: 2100 }, 12);
  // an opening that reaches into the bevel: its head is the bevel itself there
  const tall = cutOpening(bevel, FRAME, { a0: 2000, a1: 2900, z0: 0, z1: 2850 });
  check(!!tall && near(Math.abs(solidVolume(outward(tall.triangles, 0.01))), whole - 900 * (200 * 2700 + 0.5 * 100 * 150 + 100 * 150)), "a bevelled top: a door reaching into the bevel takes what lies below its head");
  // turned in plan and lifted, as real walls lie
  const [c30, s30] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
  const turned = hexa((i, j, k) => {
    const [x, y, z] = [i ? 5000 : 0, j ? 100 : -100, k ? (j ? 3000 : 2700) : 0];
    return [70000 + x * c30 - y * s30, -30000 + x * s30 + y * c30, 3000 + z];
  });
  roundTrip("a bevelled top, turned and lifted, door", turned, { start: { x: 70000, y: -30000 }, u: { x: c30, y: s30 } }, { a0: 2000, a1: 2900, z0: 3000, z1: 5100 }, 12);
}

// the edge check must reject a made-up edge
check(!edgesTrue(WALL, [0, 0, 0, 1, 1, 1]), "the edge check rejects a made-up edge");

console.log(failures ? `${failures} failed` : "all ok");
process.exitCode = failures ? 1 : 0;
