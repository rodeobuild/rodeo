// Cutting an opening through a wall's 3D solid, and filling it back in, for doors and windows. Works
// in the wall's own frame (along the wall = x, across = y, up = z; mm) and turns the result back into
// plan. Only a chunk of the solid around the opening is rebuilt: the rest, outside the chunk, is kept
// as it is. The chunk must be a stack of prisms across the wall (its faces run along the wall or
// across it, a sloping top passes); it is cut into bands across the wall, each a region in the
// (along, height) plane, and the opening is taken out of, or put back into, those regions. The
// reader gives a wall's solids mixed winding and T-junctions; nothing here relies on either.

import earcut from "earcut";
import polygonClipping from "polygon-clipping";
import { creaseEdges, outward } from "./csg.ts";

/** A wall's frame: a point on its line and its unit direction in plan. along = (p − start)·u, across = (p − start)·n with n = (−u.y, u.x). */
export interface WallFrame {
  start: { x: number; y: number };
  u: { x: number; y: number };
}
/** An opening through a wall: from a0 to a1 along it, from z0 to z1 in height (model z, mm). */
export interface WallOpening {
  a0: number;
  a1: number;
  z0: number;
  z1: number;
}
/** A solid as triangles (9 numbers each) with the straight edges that bound its faces (6 numbers each). */
export interface CutSolid {
  triangles: Float64Array;
  edges: Float64Array;
}

/** Points this close (mm) are one point. */
const WELD = 0.01;
/** How far (mm) a cutter reaches past a solid's own extent where the opening runs off it. */
const BEYOND = 1000;
/** How far (mm) a fill's levels snap to an existing level within. */
const GROW = 100;
/** How far (mm) the fill's strip reaches past each jamb and past the opening's head and sill. */
const STRIP = 60;
/** Faces count as along the wall or across it when |n·axis| is beyond this, or within its complement. */
const PRISM = 0.999;
/** Twice the area (mm²) under which a triangle is a sliver, left out when asking which way the wall's faces lie. */
const SLIVER = 0.5;

type Pair = [number, number];
type Multi = Pair[][][];

/** One band of the chunk across the wall: from y = zl to y = zh, and its region in (along, height). */
interface Band {
  zl: number;
  zh: number;
  region: Multi;
}

/** A wall's frame: a point on its line and its unit direction in plan. along = (p − start)·u, across = (p − start)·n with n = (−u.y, u.x). */
export interface WallFrame {
  start: { x: number; y: number };
  u: { x: number; y: number };
}

/** An opening through a wall: from a0 to a1 along it, from z0 to z1 in height (model z, mm). */
export interface WallOpening {
  a0: number;
  a1: number;
  z0: number;
  z1: number;
}

/** A solid as triangles (9 numbers each) with the straight edges that bound its faces (6 numbers each). */
export interface CutSolid {
  triangles: Float64Array;
  edges: Float64Array;
}

/** The solid's points in the frame's (along, across, z), 9 numbers a triangle. */
function toLocal(tris: ArrayLike<number>, f: WallFrame): Float64Array {
  const [ux, uy] = [f.u.x, f.u.y];
  const [nx, ny] = [-uy, ux];
  const out = new Float64Array(tris.length);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const [dx, dy] = [tris[i] - f.start.x, tris[i + 1] - f.start.y];
    out[i] = dx * ux + dy * uy;
    out[i + 1] = dx * nx + dy * ny;
    out[i + 2] = tris[i + 2];
  }
  return out;
}

/** Points in the frame's (along, across, z) back to plan and height, mm. */
function toWorld(loc: ArrayLike<number>, f: WallFrame): Float64Array {
  const [ux, uy] = [f.u.x, f.u.y];
  const [nx, ny] = [-uy, ux];
  const out = new Float64Array(loc.length);
  for (let i = 0; i + 2 < loc.length; i += 3) {
    const [a, c] = [loc[i], loc[i + 1]];
    out[i] = f.start.x + a * ux + c * nx;
    out[i + 1] = f.start.y + a * uy + c * ny;
    out[i + 2] = loc[i + 2];
  }
  return out;
}

function solidOut(tris: ArrayLike<number>, edges: ArrayLike<number>, f: WallFrame): CutSolid {
  return { triangles: toWorld(tris, f), edges: toWorld(edges, f) };
}

/** A solid's own edges as they stand, for a solid left as it was. */
function unchanged(tris: ArrayLike<number>): CutSolid {
  return { triangles: Float64Array.from(tris), edges: solidEdges(tris) };
}

/** The distinct heights of the solid's vertices, ascending, welded at WELD. */
function levelsOf(loc: ArrayLike<number>): number[] {
  const zs = [];
  for (let i = 2; i < loc.length; i += 3) zs.push(loc[i]);
  zs.sort((a, b) => a - b);
  const out: number[] = [];
  for (const z of zs) if (!out.length || z - out[out.length - 1] > WELD) out.push(z);
  return out;
}

/** The level nearest `z` within GROW of it, or `z` when none is. */
function snapTo(levels: number[], z: number): number {
  let best: number | null = null;
  for (const l of levels) if (Math.abs(l - z) <= GROW && (best === null || Math.abs(l - z) < Math.abs(best - z))) best = l;
  return best ?? z;
}

/** Plan area of a region, mm² (outer rings less holes). */
function areaOf(m: Multi): number {
  let total = 0;
  for (const poly of m) poly.forEach((ring, j) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [p, q] = [ring[i], ring[(i + 1) % ring.length]];
      a += p[0] * q[1] - q[0] * p[1];
    }
    total += (j === 0 ? 1 : -1) * Math.abs(a) / 2;
  });
  return total;
}

/**
 * A polygon-clipping operation that doesn't give up on outlines whose points nearly touch (it throws
 * "Unable to complete output ring" on some real walls' bands): tried as given, then with every point
 * on a grid of a millionth of a millimetre, then coarser ones up to 0.01 mm.
 */
function clip(op: "xor" | "difference" | "union" | "intersection", first: Multi, ...rest: Multi[]): Multi {
  const grid = (m: Multi, step: number): Multi => m.map((poly) => poly.map((ring) => ring.map(([x, y]): Pair => [Math.round(x / step) * step, Math.round(y / step) * step])));
  let failure: unknown = null;
  for (const step of [0, 1e-6, 1e-4, 1e-3, 1e-2]) {
    try {
      const [a, ...b] = step ? [first, ...rest].map((m) => grid(m, step)) : [first, ...rest];
      return polygonClipping[op](a, ...b) as Multi;
    } catch (e) {
      failure = e;
    }
  }
  throw failure;
}

/** Outlines this close (mm²) in area are one: float noise leaves slivers where they meet. */
const SAME_AREA = 1e-3;

/** Bands with the same outline as their neighbour become one. */
function mergeEqual(bands: Band[]): Band[] {
  const out: Band[] = [];
  for (const b of bands) {
    const last = out[out.length - 1];
    if (last && areaOf(clip("xor", last.region, b.region)) < SAME_AREA) last.zh = b.zh;
    else out.push({ ...b });
  }
  return out;
}

/** Ring points without the closing repeat polygon-clipping gives, nor repeats of a point beside it. */
const open = (ring: Pair[]): Pair[] => {
  const out: Pair[] = [];
  const near = (p: Pair, q: Pair): boolean => Math.hypot(p[0] - q[0], p[1] - q[1]) <= WELD;
  for (const p of ring) if (!out.length || !near(p, out[out.length - 1])) out.push(p);
  while (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
};

/** The rectangle a0..a1 × c0..c1 as a region. */
const rect = (a0: number, a1: number, c0: number, c1: number): Multi => [[[[a0, c0], [a1, c0], [a1, c1], [a0, c1]]]];

/** Where the line along = x crosses the region: the across intervals it lies inside (even-odd over the rings). */
function acrossAt(m: Multi, x: number): [number, number][] {
  const cs: number[] = [];
  for (const poly of m) for (const ring of poly) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % ring.length];
      if ((p[0] <= x && x < q[0]) || (q[0] <= x && x < p[0])) cs.push(p[1] + ((x - p[0]) * (q[1] - p[1])) / (q[0] - p[0]));
    }
  }
  cs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < cs.length; i += 2) out.push([cs[i], cs[i + 1]]);
  return out;
}

/** Edges that run straight on through a point where only two of them meet are one edge. */
function joinStraight(edges: number[]): number[] {
  const key = (x: number, y: number, z: number): string => `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
  const E = edges.length / 6;
  const ends = (e: number): [string, string] => [key(edges[6 * e], edges[6 * e + 1], edges[6 * e + 2]), key(edges[6 * e + 3], edges[6 * e + 4], edges[6 * e + 5])];
  const pos = new Map<string, number[]>();
  const uses = new Map<string, number[]>();
  for (let e = 0; e < E; e++) {
    const [a, b] = ends(e);
    pos.set(a, edges.slice(6 * e, 6 * e + 3));
    pos.set(b, edges.slice(6 * e + 3, 6 * e + 6));
    for (const k of [a, b]) uses.set(k, [...(uses.get(k) ?? []), e]);
  }
  // a point where exactly two edges meet, running opposite ways, is straight
  const straight = new Set<string>();
  for (const [k, list] of uses) {
    if (list.length !== 2) continue;
    const o = list.map((e) => {
      const [a, b] = ends(e);
      const far = a === k ? b : a;
      return pos.get(far)!.map((v, i) => v - pos.get(k)![i]);
    });
    const [d1, d2] = o;
    const cross = Math.hypot(d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]);
    const dot = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
    if (dot < 0 && cross <= 1e-6 * Math.hypot(...d1) * Math.hypot(...d2)) straight.add(k);
  }
  // edges meeting at a straight point are one chain; a chain's two free ends are its new ends
  const parent = Array.from({ length: E }, (_, e) => e);
  const root = (e: number): number => {
    while (parent[e] !== e) e = parent[e] = parent[parent[e]];
    return e;
  };
  for (const k of straight) {
    const [a, b] = uses.get(k)!;
    parent[root(a)] = root(b);
  }
  const chains = new Map<number, { free: string[]; keys: Set<string> }>();
  for (let e = 0; e < E; e++) {
    const r = root(e);
    const c = chains.get(r) ?? { free: [], keys: new Set() };
    for (const k of ends(e)) {
      if (!straight.has(k)) c.free.push(k);
      c.keys.add(k);
    }
    chains.set(r, c);
  }
  const out: number[] = [];
  for (let e = 0; e < E; e++) {
    const c = chains.get(root(e))!;
    if (root(e) !== e) continue;
    if (c.free.length !== 2) {
      // a closed run of straight points, or a single edge: its own edges as they are
      for (let f = 0; f < E; f++) if (root(f) === e) out.push(...edges.slice(6 * f, 6 * f + 6));
      continue;
    }
    out.push(...pos.get(c.free[0])!, ...pos.get(c.free[1])!);
  }
  return out;
}

/** Triangles of area below this (mm²) are dropped. */
const FLAT = 1e-9;

function triArea(t: ArrayLike<number>, i: number): number {
  const [ux, uy, uz] = [t[i + 3] - t[i], t[i + 4] - t[i + 1], t[i + 5] - t[i + 2]];
  const [vx, vy, vz] = [t[i + 6] - t[i], t[i + 7] - t[i + 1], t[i + 8] - t[i + 2]];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function dropFlat(tris: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) if (triArea(tris, i) > FLAT) out.push(...tris.slice(i, i + 9));
  return out;
}

/**
 * The triangles with every corner moved onto the first corner met within WELD of it. The part of a solid kept and
 * the piece rebuilt beside it reach the same point by different sums (a clip here, a slice there), a hair apart;
 * left so, splitting sides at each other's corners makes slivers between the two.
 */
function welded(tris: number[]): number[] {
  const cells = new Map<string, number[][]>();
  const out = new Array<number>(tris.length);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const p = [tris[i], tris[i + 1], tris[i + 2]];
    const c = p.map((v) => Math.floor(v / WELD));
    let found: number[] | null = null;
    for (let dx = -1; dx <= 1 && !found; dx++)
      for (let dy = -1; dy <= 1 && !found; dy++)
        for (let dz = -1; dz <= 1 && !found; dz++) {
          for (const q of cells.get(`${c[0] + dx},${c[1] + dy},${c[2] + dz}`) ?? []) {
            if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= WELD) {
              found = q;
              break;
            }
          }
        }
    if (!found) {
      const key = `${c[0]},${c[1]},${c[2]}`;
      cells.set(key, [...(cells.get(key) ?? []), p]);
      found = p;
    }
    out[i] = found[0];
    out[i + 1] = found[1];
    out[i + 2] = found[2];
  }
  return out;
}

/** Why the last cut or fill gave nothing, for the message the edit shows. */
let refusal = "";
const no = (why: string): null => {
  refusal = why;
  return null;
};
/** Why the last cutOpening or fillOpening returned null, in a few words; "" when it didn't. */
export function lastRefusal(): string {
  return refusal;
}

/** Faces meeting at less than this (radians) are one face: no edge is kept between them. Small, so a top that slopes a few degrees keeps the edge where its slope starts. */
const CREASE = (0.1 * Math.PI) / 180;

/** A solid of more triangles than this isn't rebuilt (a wall's component has tens, seldom hundreds). */
const MOST_TRIANGLES = 4000;

/** Each side of a triangle with a corner of the mesh lying on it is split there, so the faces meet edge to edge. */
function splitT(tris: number[]): number[] {
  let cur = tris;
  // every side against every corner, a pass at a time: a solid of thousands of triangles would hold the editor for
  // minutes, so it is given up instead (the caller leaves that solid as it was)
  const most = Math.max(8 * tris.length, 9 * 600);
  if (tris.length > 9 * MOST_TRIANGLES) throw new Error("too many triangles to join");
  const started = Date.now();
  for (let pass = 0; pass < 12; pass++) {
    const pts = new Map<string, number[]>();
    for (let i = 0; i < cur.length; i += 3) pts.set(`${Math.round(cur[i] / WELD)},${Math.round(cur[i + 1] / WELD)},${Math.round(cur[i + 2] / WELD)}`, [cur[i], cur[i + 1], cur[i + 2]]);
    const list = [...pts.values()];
    const out: number[] = [];
    let changed = false;
    for (let i = 0; i + 8 < cur.length; i += 9) {
      const v = [0, 1, 2].map((k) => [cur[i + 3 * k], cur[i + 3 * k + 1], cur[i + 3 * k + 2]]);
      let split = false;
      for (let s = 0; s < 3 && !split; s++) {
        const [p, q, r] = [v[s], v[(s + 1) % 3], v[(s + 2) % 3]];
        const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
        const len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        for (const x of list) {
          const t = ((x[0] - p[0]) * d[0] + (x[1] - p[1]) * d[1] + (x[2] - p[2]) * d[2]) / len2;
          if (!(t > 1e-9 && t < 1 - 1e-9)) continue;
          if (Math.hypot(p[0] + t * d[0] - x[0], p[1] + t * d[1] - x[1], p[2] + t * d[2] - x[2]) > WELD) continue;
          // a corner at an end of the side is that end
          if (Math.hypot(x[0] - p[0], x[1] - p[1], x[2] - p[2]) <= WELD || Math.hypot(x[0] - q[0], x[1] - q[1], x[2] - q[2]) <= WELD) continue;
          out.push(...p, ...x, ...r, ...x, ...q, ...r);
          split = changed = true;
          break;
        }
      }
      if (!split) out.push(...cur.slice(i, i + 9));
    }
    cur = out;
    if (cur.length > most || Date.now() - started > 700) throw new Error("too many triangles to join");
    if (!changed) break;
  }
  return cur;
}

/** The polygon kept where f ≥ 0, its cut edges closed with points where f crosses 0. */
function clipHalf(poly: number[][], f: (p: number[]) => number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const [fp, fq] = [f(p), f(q)];
    if (fp >= 0) out.push(p);
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push(p.map((v, k) => v + t * (q[k] - v)));
    }
  }
  return out;
}

/**
 * The whole solid from the part kept and the piece rebuilt: T-junctions split, zero-area triangles dropped. The part
 * kept is the solid's own triangles, which in real drawings often don't close edge to edge (a face's side meeting two
 * shorter ones), so closure isn't asked of the result here: the caller checks that the edges written rebuild the solid
 * (wallInserts.ts).
 */
function finishWhole(local: number[], f: WallFrame): CutSolid {
  const one = welded(local);
  let joined: number[];
  try {
    joined = splitT(one);
  } catch {
    // too many faces to join side by side in the time an edit may take: left as welded, for the caller's test to judge
    joined = one;
  }
  const tris = outward(Float64Array.from(dropFlat(joined)), WELD);
  return solidOut(tris, joinStraight(creaseEdges(tris, WELD, CREASE)), f);
}

/**
 * The straight edges that bound a solid's faces, as a body keeps them (6 numbers each): its triangles joined edge to
 * edge first (real solids' faces often meet a side with two shorter ones), then every side where two faces meet at
 * an angle, straight runs joined. For a solid left as it is.
 */
export function solidEdges(tris: ArrayLike<number>): Float64Array {
  let whole: number[];
  try {
    whole = dropFlat(splitT(welded(Array.from(tris))));
  } catch {
    whole = Array.from(tris);
  }
  return Float64Array.from(joinStraight(creaseEdges(outward(Float64Array.from(whole), WELD), WELD, CREASE)));
}

/** Volume of a closed triangle solid (mm³), by the divergence theorem: positive when its faces point out. */
export function solidVolume(tris: ArrayLike<number>): number {
  let v = 0;
  for (let i = 0; i + 8 < tris.length; i += 9) {
    v += tris[i] * (tris[i + 4] * tris[i + 8] - tris[i + 5] * tris[i + 7]) - tris[i + 1] * (tris[i + 3] * tris[i + 8] - tris[i + 5] * tris[i + 6]) + tris[i + 2] * (tris[i + 3] * tris[i + 7] - tris[i + 4] * tris[i + 6]);
  }
  return v / 6;
}

/** The chunk's outline bounds along the wall: a0 − STRIP − 10 .. a1 + STRIP + 10, or the solid's own end where it ends inside. */
function chunkBounds(loc: ArrayLike<number>, o: WallOpening): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < loc.length; i += 3) {
    lo = Math.min(lo, loc[i]);
    hi = Math.max(hi, loc[i]);
  }
  let x0 = o.a0 - STRIP - 10;
  let x1 = o.a1 + STRIP + 10;
  if (lo > x0) x0 = lo - 1;
  if (hi < x1) x1 = hi + 1;
  return [x0, x1];
}

/** The solid's triangles split by the planes along = x0 and along = x1: the parts outside them, and the chunk between them (frame coordinates, 9 numbers a triangle). */
function splitAlong(loc: ArrayLike<number>, x0: number, x1: number): { outside: number[]; chunk: number[] } {
  const outside: number[] = [];
  const chunk: number[] = [];
  const fan = (poly: number[][], into: number[]): void => {
    for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) into.push(p[0], p[1], p[2]);
  };
  for (let t = 0; t + 8 < loc.length; t += 9) {
    const poly = [0, 1, 2].map((k) => [loc[t + 3 * k], loc[t + 3 * k + 1], loc[t + 3 * k + 2]]);
    fan(clipHalf(poly, (p) => x0 - p[0]), outside);
    fan(clipHalf(poly, (p) => p[0] - x1), outside);
    fan(clipHalf(clipHalf(poly, (p) => p[0] - x0), (p) => x1 - p[0]), chunk);
  }
  return { outside, chunk };
}

/** Whether every triangle of the chunk runs along the wall or across it (its normal has no part along the wall's height... or has no across part). */
function isPrisms(chunk: ArrayLike<number>): boolean {
  for (let i = 0; i + 8 < chunk.length; i += 9) {
    const [ux, uy, uz] = [chunk[i + 3] - chunk[i], chunk[i + 4] - chunk[i + 1], chunk[i + 5] - chunk[i + 2]];
    const [vx, vy, vz] = [chunk[i + 6] - chunk[i], chunk[i + 7] - chunk[i + 1], chunk[i + 8] - chunk[i + 2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    // a sliver's normal is noise (joining leaves a few, of next to no area): it says nothing of how the wall lies
    if (!(len > SLIVER)) continue;
    const ny = Math.abs(n[1]) / len;
    if (!(ny > PRISM || ny < 1 - PRISM)) return false;
  }
  return true;
}

/** The chunk's region in the (along, height) plane at across = ym: its triangles crossing that plane, chained, the chains' ends on x = x0 or x1 closed along those lines in order of height. null when they don't close. */
function sliceAcross(chunk: ArrayLike<number>, ym: number, x0: number, x1: number): Multi | null {
  const keyOf = (p: Pair): string => `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)}`;
  const graph = new Map<string, { p: Pair; nb: string[] }>();
  const node = (p: Pair): string => {
    const k = keyOf(p);
    if (!graph.has(k)) graph.set(k, { p, nb: [] });
    return k;
  };
  for (let t = 0; t + 8 < chunk.length; t += 9) {
    const v = [0, 1, 2].map((k) => [chunk[t + 3 * k], chunk[t + 3 * k + 1], chunk[t + 3 * k + 2]]);
    const hits: Pair[] = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      let [p, q] = [v[i], v[j]];
      if ((p[1] - ym) * (q[1] - ym) >= 0) continue;
      if (keyOf([p[0], p[2]]) > keyOf([q[0], q[2]])) [p, q] = [q, p];
      const s = (ym - p[1]) / (q[1] - p[1]);
      hits.push([p[0] + s * (q[0] - p[0]), p[2] + s * (q[2] - p[2])]);
    }
    if (hits.length === 0) continue;
    if (hits.length !== 2) return no("a face of the wall there meets the cut at a single point");
    const [a, b] = [node(hits[0]), node(hits[1])];
    if (a === b) continue;
    graph.get(a)!.nb.push(b);
    graph.get(b)!.nb.push(a);
  }
  // chain ends lie on the chunk's two ends: join each pair along the line, in order of height
  for (const x of [x0, x1]) {
    const ends = [...graph.values()].filter((g) => g.nb.length === 1 && Math.abs(g.p[0] - x) <= WELD).sort((a, b) => a.p[1] - b.p[1]);
    if (ends.length % 2) return no("the wall's outline there is open");
    for (let i = 0; i < ends.length; i += 2) {
      const [a, b] = [keyOf(ends[i].p), keyOf(ends[i + 1].p)];
      graph.get(a)!.nb.push(b);
      graph.get(b)!.nb.push(a);
    }
  }
  for (const g of graph.values()) if (g.nb.length !== 2) return no("the wall's outline there doesn't close");
  const rings: Pair[][] = [];
  const seen = new Set<string>();
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    const ring: Pair[] = [];
    let prev: string | null = null;
    let cur = start;
    for (;;) {
      seen.add(cur);
      const g = graph.get(cur)!;
      ring.push(g.p);
      const next: string = g.nb[0] !== prev ? g.nb[0] : g.nb[1];
      prev = cur;
      cur = next;
      if (cur === start) break;
      if (seen.has(cur)) return no("the wall's outline there crosses itself");
    }
    if (ring.length < 3) return no("the wall's outline there has no area");
    rings.push(ring.map((p): Pair => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]));
  }
  if (!rings.length) return [];
  const geoms = rings.map((r) => [[r]] as Multi);
  return clip("xor", geoms[0], ...geoms.slice(1));
}

/** The chunk as bands across the wall: between each two neighbouring across-levels, its region in the (along, height) plane. null when a band won't close. */
function bandsAcross(chunk: ArrayLike<number>, x0: number, x1: number, extra: number[] = [], merge = true): Band[] | null {
  const ys: number[] = [];
  for (let i = 1; i < chunk.length; i += 3) ys.push(chunk[i]);
  ys.sort((a, b) => a - b);
  const levels: number[] = [];
  for (const y of ys) if (!levels.length || y - levels[levels.length - 1] > WELD) levels.push(y);
  // nothing of the solid has any depth here (it doesn't reach the opening): no bands
  if (levels.length < 2) return [];
  // steps asked for besides its own (the sill and the head, when it is stacked by height)
  const [first, last] = [levels[0], levels[levels.length - 1]];
  for (const y of extra) if (y > first + WELD && y < last - WELD && levels.every((l) => Math.abs(l - y) > WELD)) levels.push(y);
  levels.sort((a, b) => a - b);
  const bands: Band[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const region = sliceAcross(chunk, (levels[i] + levels[i + 1]) / 2, x0, x1);
    if (!region) return null;
    bands.push({ zl: levels[i], zh: levels[i + 1], region });
  }
  return merge ? mergeEqual(bands) : bands;
}

/** The chunk rebuilt from its bands across the wall: at each across-level the faces where one band's region is not covered by its neighbour's, and each band's walls as quads along every region edge, except along the chunk's two ends, where the solid runs on outside. Every edge is split where a corner of any face lies on it, so faces meet walls without T-junctions. 9 numbers a triangle. */
function rebuildAcross(bands0: Band[], x0: number, x1: number, openFirst = false, openLast = false): number[] {
  const bands = mergeEqual(bands0);
  const n = bands.length;
  const levelY = bands.map((b) => b.zl).concat([bands[n - 1].zh]);
  const faces: { y: number; polys: Multi }[] = [];
  const exposed = (m: Multi): Multi => clip("difference", m, []).filter((poly) => areaOf([poly]) > SAME_AREA);
  for (let k = 0; k <= n; k++) {
    const below = k > 0 ? bands[k - 1].region : [];
    const above = k < n ? bands[k].region : [];
    // an end of the stack where the solid goes on beyond the piece has no face
    if ((k === 0 && openFirst) || (k === n && openLast)) continue;
    if (k < n) faces.push({ y: levelY[k], polys: exposed(clip("difference", above, below)) });
    if (k > 0) faces.push({ y: levelY[k], polys: exposed(clip("difference", below, above)) });
  }
  // every corner of every face: any edge these lie on is split there, on the walls and the faces alike
  const corners = new Map<string, Pair>();
  const wk = (p: Pair): string => `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)}`;
  for (const f of faces) for (const poly of f.polys) for (const ring of poly) for (const p of open(ring)) corners.set(wk(p), p);
  const cornerList = [...corners.values()];
  const splitRing = (ring: Pair[]): Pair[] => {
    const pts = open(ring);
    const out: Pair[] = [];
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      const r = pts[(j + 1) % pts.length];
      out.push(p);
      const [dx, dy] = [r[0] - p[0], r[1] - p[1]];
      const len2 = dx * dx + dy * dy;
      const found: [number, Pair][] = [];
      for (const x of cornerList) {
        const t = ((x[0] - p[0]) * dx + (x[1] - p[1]) * dy) / len2;
        if (!(t > 0 && t < 1)) continue;
        if (Math.hypot(x[0] - (p[0] + t * dx), x[1] - (p[1] + t * dy)) <= WELD) found.push([t, x]);
      }
      found.sort((a, b) => a[0] - b[0]);
      for (const [, x] of found) if (wk(x) !== wk(out[out.length - 1])) out.push(x);
    }
    return out;
  };
  const tris: number[] = [];
  for (const f of faces) for (const poly of f.polys) {
    const data: number[] = [];
    const holes: number[] = [];
    poly.forEach((ring, j) => {
      if (j > 0) holes.push(data.length / 2);
      for (const p of splitRing(ring)) data.push(p[0], p[1]);
    });
    if (data.length < 6) continue;
    for (const k of earcut(data, holes.length ? holes : null, 2)) tris.push(data[2 * k], f.y, data[2 * k + 1]);
  }
  for (let i = 0; i < n; i++) {
    const [yl, yh] = [levelY[i], levelY[i + 1]];
    for (const poly of bands[i].region) for (const ring of poly) {
      const pts = splitRing(ring);
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j];
        const b = pts[(j + 1) % pts.length];
        // the solid runs on outside the chunk past either end: no wall there
        if (Math.abs(a[0] - b[0]) <= WELD && (Math.abs(a[0] - x0) <= WELD || Math.abs(a[0] - x1) <= WELD)) continue;
        tris.push(a[0], yl, a[1], b[0], yl, b[1], b[0], yh, b[1], a[0], yl, a[1], b[0], yh, b[1], a[0], yh, a[1]);
      }
    }
  }
  return tris;
}

/** The chunk's z range. */
function zRangeOf(chunk: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i < chunk.length; i += 3) {
    lo = Math.min(lo, chunk[i]);
    hi = Math.max(hi, chunk[i]);
  }
  return [lo, hi];
}

// ---- the first stack tried: levels up the wall, on a piece local in height too ----------------
// Most of what makes a real wall's solid awkward lies away from the opening: a top that slopes
// along the wall or is bevelled across it, a mitred end. Cut off 70 mm above the head and below
// the sill as well as beside the jambs, the piece left is nearly always upright faces and level
// ones, whatever way the upright ones turn in plan (a finish mitred round a corner, a return), and
// is a stack of plan outlines up the wall.

/** A piece's triangles with across and height swapped, so the code that stacks across the wall stacks up it (and back again). */
function swapped(t: ArrayLike<number>): number[] {
  const out = new Array<number>(t.length);
  for (let i = 0; i + 2 < t.length; i += 3) {
    out[i] = t[i];
    out[i + 1] = t[i + 2];
    out[i + 2] = t[i + 1];
  }
  return out;
}

/** Whether every triangle of the piece is level or upright (slivers aside). */
function isUpright(piece: ArrayLike<number>): boolean {
  for (let i = 0; i + 8 < piece.length; i += 9) {
    const [ux, uy, uz] = [piece[i + 3] - piece[i], piece[i + 4] - piece[i + 1], piece[i + 5] - piece[i + 2]];
    const [vx, vy, vz] = [piece[i + 6] - piece[i], piece[i + 7] - piece[i + 1], piece[i + 8] - piece[i + 2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > SLIVER)) continue;
    const nz = Math.abs(n[2]) / len;
    if (!(nz > PRISM || nz < 1 - PRISM)) return false;
  }
  return true;
}

/** The heights the piece is cut off at: STRIP + 10 below z0 and above z1, or just past the solid's own bottom or top where that comes first (nothing is cut off there). */
function upBounds(chunk: ArrayLike<number>, z0: number, z1: number, margin = STRIP + 10): [number, number] {
  const [lo, hi] = zRangeOf(chunk);
  return [lo > z0 - margin ? lo - 1 : z0 - margin, hi < z1 + margin ? hi + 1 : z1 + margin];
}

/** How far above the head and below the sill the piece reaches, tried in turn: the first keeps a finish's return over the head inside it; the closer ones are for a top that starts sloping just above the opening. */
const UP_MARGINS = [STRIP + 10, 25, 5];

/** The chunk split by the planes z = zl and z = zh: what lies beyond them, kept as it is, and the piece between. */
function splitUp(chunk: ArrayLike<number>, zl: number, zh: number): { beyond: number[]; piece: number[] } {
  const beyond: number[] = [];
  const piece: number[] = [];
  const fan = (poly: number[][], into: number[]): void => {
    for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) into.push(p[0], p[1], p[2]);
  };
  for (let t = 0; t + 8 < chunk.length; t += 9) {
    const poly = [0, 1, 2].map((k) => [chunk[t + 3 * k], chunk[t + 3 * k + 1], chunk[t + 3 * k + 2]]);
    fan(clipHalf(poly, (p) => zl - p[2]), beyond);
    fan(clipHalf(poly, (p) => p[2] - zh), beyond);
    fan(clipHalf(clipHalf(poly, (p) => p[2] - zl), (p) => zh - p[2]), piece);
  }
  return { beyond, piece };
}

/** Whether the solid goes on below and above the piece (it was cut off there, at zl and zh). */
function openUp(piece: ArrayLike<number>, zl: number, zh: number): [boolean, boolean] {
  const [lo, hi] = zRangeOf(piece);
  return [Math.abs(lo - zl) <= WELD, Math.abs(hi - zh) <= WELD];
}

/** The opening cut through an upright piece, level by level; "same" when it misses. */
function cutUp(piece: number[], x0: number, x1: number, zl: number, zh: number, o: WallOpening): number[] | "same" | null {
  const bands = bandsAcross(swapped(piece), x0, x1, [o.z0, o.z1], false);
  if (!bands) return null;
  if (!bands.length) return "same";
  const [lo, hi] = zRangeOf(piece);
  const from = o.z0 <= lo + WELD ? -Infinity : o.z0;
  const to = o.z1 >= hi - WELD ? Infinity : o.z1;
  const cut = rect(o.a0, o.a1, -1e7, 1e7);
  let changed = false;
  for (const b of bands) {
    if (!(b.zl >= from - WELD && b.zh <= to + WELD)) continue;
    if (clip("intersection", b.region, cut).length) changed = true;
    b.region = clip("difference", b.region, cut);
  }
  if (!changed) return "same";
  const [openFirst, openLast] = openUp(piece, zl, zh);
  return swapped(rebuildAcross(bands, x0, x1, openFirst, openLast));
}

/** The opening (z0..z1, snapped to the solid's own levels) filled in an upright piece: at every level from STRIP below it to STRIP above, what stands between the jambs and STRIP past them gives way to the wall as it runs just outside, carried straight across. */
function fillUp(piece: number[], x0: number, x1: number, zl: number, zh: number, o: WallOpening, z0: number, z1: number): number[] | "same" | null {
  const bands = bandsAcross(swapped(piece), x0, x1, [z0 - STRIP, z1 + STRIP], false);
  if (!bands) return null;
  if (!bands.length) return "same";
  const strip = rect(o.a0 - STRIP, o.a1 + STRIP, -1e7, 1e7);
  const [xl, xr] = [o.a0 - STRIP - 1, o.a1 + STRIP + 1];
  for (const b of bands) {
    if (!(b.zl >= z0 - STRIP - WELD && b.zh <= z1 + STRIP + WELD)) continue;
    const L = acrossAt(b.region, xl).filter(([a, c]) => c > a);
    const R = acrossAt(b.region, xr).filter(([a, c]) => c > a);
    let region = clip("difference", b.region, strip);
    if (L.length && R.length) {
      // in plan the wall runs straight on: a layer thicker or set otherwise on one side isn't guessed across
      if (L.length !== R.length || L.some((l, i) => Math.abs(l[0] - R[i][0]) > 0.5 || Math.abs(l[1] - R[i][1]) > 0.5)) return no("the wall differs on the two sides of the opening");
      region = clip("union", region, ...L.map((l, i): Multi => [[[[xl, l[0]], [xr, R[i][0]], [xr, R[i][1]], [xl, l[1]]] as Pair[]]]));
    } else if (L.length) {
      region = clip("union", region, ...L.map(([a, c]) => rect(xl, o.a1, a, c)));
    } else if (R.length) {
      region = clip("union", region, ...R.map(([a, c]) => rect(o.a0, xr, a, c)));
    }
    b.region = region;
  }
  const [openFirst, openLast] = openUp(piece, zl, zh);
  return swapped(rebuildAcross(bands, x0, x1, openFirst, openLast));
}

// ---- the other stack: sections along the wall -------------------------------------------------
// A wall under a pitched roof often has its top bevelled across its thickness, so its faces lean
// across it and the piece is no stack of prisms across the wall. Level along the wall, it is one
// along it: between each two points along the wall where it changes, one section in (across, height).

/** Whether every triangle of the piece stands across the wall's line or runs along it (its normal lies along the wall, or has no part along it). */
function isSections(chunk: ArrayLike<number>): boolean {
  for (let i = 0; i + 8 < chunk.length; i += 9) {
    const [ux, uy, uz] = [chunk[i + 3] - chunk[i], chunk[i + 4] - chunk[i + 1], chunk[i + 5] - chunk[i + 2]];
    const [vx, vy, vz] = [chunk[i + 6] - chunk[i], chunk[i + 7] - chunk[i + 1], chunk[i + 8] - chunk[i + 2]];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > SLIVER)) continue;
    const nx = Math.abs(n[0]) / len;
    if (!(nx > PRISM || nx < 1 - PRISM)) return false;
  }
  return true;
}

/** The piece's section in (across, height) at along = xm: its triangles crossing that plane chained into rings, even-odd. null when they don't close. */
function sectionAt(chunk: ArrayLike<number>, xm: number): Multi | null {
  const keyOf = (p: Pair): string => `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)}`;
  const graph = new Map<string, { p: Pair; nb: string[] }>();
  const node = (p: Pair): string => {
    const k = keyOf(p);
    if (!graph.has(k)) graph.set(k, { p, nb: [] });
    return k;
  };
  for (let t = 0; t + 8 < chunk.length; t += 9) {
    const v = [0, 1, 2].map((k) => [chunk[t + 3 * k], chunk[t + 3 * k + 1], chunk[t + 3 * k + 2]]);
    const hits: Pair[] = [];
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
      let [p, q] = [v[i], v[j]];
      if ((p[0] - xm) * (q[0] - xm) >= 0) continue;
      // one order per side, so both triangles sharing it reach the same point
      if (keyOf([p[1], p[2]]) > keyOf([q[1], q[2]]) || (keyOf([p[1], p[2]]) === keyOf([q[1], q[2]]) && p[0] > q[0])) [p, q] = [q, p];
      const f = (xm - p[0]) / (q[0] - p[0]);
      hits.push([p[1] + f * (q[1] - p[1]), p[2] + f * (q[2] - p[2])]);
    }
    if (hits.length === 0) continue;
    if (hits.length !== 2) return no("a face of the wall there meets the cut at a single point");
    const [a, b] = [node(hits[0]), node(hits[1])];
    if (a === b) continue;
    graph.get(a)!.nb.push(b);
    graph.get(b)!.nb.push(a);
  }
  for (const g of graph.values()) if (g.nb.length !== 2) return no("the wall's section there doesn't close");
  const rings: Pair[][] = [];
  const seen = new Set<string>();
  for (const start of graph.keys()) {
    if (seen.has(start)) continue;
    const ring: Pair[] = [];
    let prev: string | null = null;
    let cur = start;
    for (;;) {
      seen.add(cur);
      const g = graph.get(cur)!;
      ring.push(g.p);
      const next: string = g.nb[0] !== prev ? g.nb[0] : g.nb[1];
      prev = cur;
      cur = next;
      if (cur === start) break;
      if (seen.has(cur)) return no("the wall's section there crosses itself");
    }
    if (ring.length < 3) return no("the wall's section there has no area");
    rings.push(ring.map((p): Pair => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]));
  }
  if (!rings.length) return [];
  const geoms = rings.map((r) => [[r]] as Multi);
  return clip("xor", geoms[0], ...geoms.slice(1));
}

/** The piece as sections along the wall: its own points along it and `extra` give the steps; null when a section won't close. */
function sectionsOf(chunk: ArrayLike<number>, extra: number[]): Band[] | null {
  const xs: number[] = [];
  for (let i = 0; i < chunk.length; i += 3) xs.push(chunk[i]);
  xs.sort((a, b) => a - b);
  const levels: number[] = [];
  for (const x of xs) if (!levels.length || x - levels[levels.length - 1] > WELD) levels.push(x);
  if (levels.length < 2) return [];
  const [first, last] = [levels[0], levels[levels.length - 1]];
  for (const x of extra) if (x > first + WELD && x < last - WELD && levels.every((l) => Math.abs(l - x) > WELD)) levels.push(x);
  levels.sort((a, b) => a - b);
  const bands: Band[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const region = sectionAt(chunk, (levels[i] + levels[i + 1]) / 2);
    if (!region) return null;
    bands.push({ zl: levels[i], zh: levels[i + 1], region });
  }
  return bands;
}

/**
 * The piece rebuilt from its sections along the wall: where one section isn't covered by the next, a face across
 * the wall, and each section's outline swept along its step. An end where the solid goes on beyond the piece
 * (`openStart`, `openEnd`) gets no face. Frame coordinates, 9 numbers a triangle.
 */
function rebuildSections(bands0: Band[], openStart: boolean, openEnd: boolean): number[] {
  const bands = mergeEqual(bands0);
  const n = bands.length;
  const levelX = bands.map((b) => b.zl).concat([bands[n - 1].zh]);
  const faces: { x: number; polys: Multi }[] = [];
  const exposed = (m: Multi): Multi => m.filter((poly) => areaOf([poly]) > SAME_AREA);
  for (let k = 0; k <= n; k++) {
    if ((k === 0 && openStart) || (k === n && openEnd)) continue;
    const before = k > 0 ? bands[k - 1].region : [];
    const after = k < n ? bands[k].region : [];
    if (k < n) faces.push({ x: levelX[k], polys: exposed(clip("difference", after, before)) });
    if (k > 0) faces.push({ x: levelX[k], polys: exposed(clip("difference", before, after)) });
  }
  // every corner of every face splits the outline sides it lies on, so faces and sides meet corner to corner
  const corners = new Map<string, Pair>();
  const wk = (p: Pair): string => `${Math.round(p[0] / WELD)},${Math.round(p[1] / WELD)}`;
  for (const f of faces) for (const poly of f.polys) for (const ring of poly) for (const p of open(ring)) corners.set(wk(p), p);
  for (const b of bands) for (const poly of b.region) for (const ring of poly) for (const p of open(ring)) corners.set(wk(p), p);
  const cornerList = [...corners.values()];
  const splitRing = (ring: Pair[]): Pair[] => {
    const pts = open(ring);
    const out: Pair[] = [];
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j];
      const r = pts[(j + 1) % pts.length];
      out.push(p);
      const [dx, dy] = [r[0] - p[0], r[1] - p[1]];
      const len2 = dx * dx + dy * dy;
      const found: [number, Pair][] = [];
      for (const c of cornerList) {
        const t = ((c[0] - p[0]) * dx + (c[1] - p[1]) * dy) / len2;
        if (!(t > 0 && t < 1)) continue;
        if (Math.hypot(c[0] - (p[0] + t * dx), c[1] - (p[1] + t * dy)) <= WELD) found.push([t, c]);
      }
      found.sort((a, b) => a[0] - b[0]);
      for (const [, c] of found) if (wk(c) !== wk(out[out.length - 1]) && wk(c) !== wk(p) && wk(c) !== wk(r)) out.push(c);
    }
    return out;
  };
  const tris: number[] = [];
  for (const f of faces) for (const poly of f.polys) {
    const data: number[] = [];
    const holes: number[] = [];
    poly.forEach((ring, j) => {
      if (j > 0) holes.push(data.length / 2);
      for (const p of splitRing(ring)) data.push(p[0], p[1]);
    });
    if (data.length < 6) continue;
    for (const k of earcut(data, holes.length ? holes : null, 2)) tris.push(f.x, data[2 * k], data[2 * k + 1]);
  }
  for (let i = 0; i < n; i++) {
    const [xl, xh] = [levelX[i], levelX[i + 1]];
    for (const poly of bands[i].region) for (const ring of poly) {
      const pts = splitRing(ring);
      for (let j = 0; j < pts.length; j++) {
        const a = pts[j];
        const b = pts[(j + 1) % pts.length];
        tris.push(xl, a[0], a[1], xl, b[0], b[1], xh, b[0], b[1], xl, a[0], a[1], xh, b[0], b[1], xh, a[0], a[1]);
      }
    }
  }
  return tris;
}

/** Least and most across of the piece's points. */
function acrossRange(chunk: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 1; i < chunk.length; i += 3) {
    lo = Math.min(lo, chunk[i]);
    hi = Math.max(hi, chunk[i]);
  }
  return [lo, hi];
}

/** Whether the solid goes on beyond the piece at its start and its end (the piece was cut off there, at x0 and x1). */
function openEnds(chunk: ArrayLike<number>, x0: number, x1: number): [boolean, boolean] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < chunk.length; i += 3) {
    lo = Math.min(lo, chunk[i]);
    hi = Math.max(hi, chunk[i]);
  }
  return [Math.abs(lo - x0) <= WELD, Math.abs(hi - x1) <= WELD];
}

/** The opening cut through a piece made of sections along the wall; "same" when it misses. */
function cutSections(chunk: number[], x0: number, x1: number, o: WallOpening): number[] | "same" | null {
  const bands = sectionsOf(chunk, [o.a0, o.a1]);
  if (!bands) return null;
  if (!bands.length) return "same";
  const [zlo, zhi] = zRangeOf(chunk);
  const [clo, chi] = acrossRange(chunk);
  const cut = rect(clo - BEYOND, chi + BEYOND, o.z0 <= zlo + WELD ? o.z0 - BEYOND : o.z0, o.z1 >= zhi - WELD ? o.z1 + BEYOND : o.z1);
  let changed = false;
  for (const b of bands) {
    if (!(b.zl >= o.a0 - WELD && b.zh <= o.a1 + WELD)) continue;
    if (clip("intersection", b.region, cut).length) changed = true;
    b.region = clip("difference", b.region, cut);
  }
  if (!changed) return "same";
  const [openStart, openEnd] = openEnds(chunk, x0, x1);
  return rebuildSections(bands, openStart, openEnd);
}

/** The opening filled in a piece made of sections along the wall: between the jambs (and STRIP past them) each section takes, over the opening's height, the section the wall has just outside. */
function fillSections(chunk: number[], x0: number, x1: number, o: WallOpening): number[] | "same" | null {
  const [xl, xr] = [o.a0 - STRIP, o.a1 + STRIP];
  const bands = sectionsOf(chunk, [xl, xr, o.a0, o.a1]);
  if (!bands) return null;
  if (!bands.length) return "same";
  const levels = levelsOf(chunk);
  const z0 = snapTo(levels, o.z0);
  const z1 = snapTo(levels, o.z1);
  if (!(z1 > z0)) return no("the opening has no height");
  const over = rect(-1e7, 1e7, z0 - STRIP, z1 + STRIP);
  const side = (x: number): Multi | null => {
    const m = sectionAt(chunk, x);
    return m ? clip("intersection", m, over) : null;
  };
  const L = side(xl - 1);
  const R = side(xr + 1);
  if (!L || !R) return null;
  let plug: Multi;
  let [from, to] = [xl, xr];
  if (L.length && R.length) {
    if (areaOf(clip("xor", L, R)) > 1e-3 * Math.max(areaOf(L), areaOf(R)) + SAME_AREA) return no("the wall differs on the two sides of the opening");
    plug = L;
  } else if (L.length) {
    plug = L;
    to = o.a1;
  } else if (R.length) {
    plug = R;
    from = o.a0;
  } else plug = [];
  for (const b of bands) {
    if (!(b.zl >= from - WELD && b.zh <= to + WELD)) continue;
    const cleared = clip("difference", b.region, over);
    b.region = plug.length ? clip("union", cleared, plug) : cleared;
  }
  const [openStart, openEnd] = openEnds(chunk, x0, x1);
  return rebuildSections(bands, openStart, openEnd);
}

/** The opening cut out of `tris`: the chunk around it rebuilt, the rest of the solid kept; the solid unchanged when the opening misses it; null when it can't be cut cleanly. */
export function cutOpening(tris: ArrayLike<number>, frame: WallFrame, o: WallOpening): CutSolid | null {
  refusal = "";
  try {
    return cutChunk(tris, frame, o);
  } catch (e) {
    // polygon-clipping refuses some near-degenerate outlines: no answer is better than a wrong one
    return no(e instanceof Error && e.message.startsWith("too many") ? "that part of the wall has too many faces" : "the wall's outline there is too fine to work out");
  }
}

function cutChunk(tris: ArrayLike<number>, frame: WallFrame, o: WallOpening): CutSolid | null {
  const loc = toLocal(tris, frame);
  const [x0, x1] = chunkBounds(loc, o);
  const { outside, chunk } = splitAlong(loc, x0, x1);
  if (!chunk.length) return unchanged(tris);
  for (const margin of UP_MARGINS) {
    // first the piece local in height too, level by level
    const [zl, zh] = upBounds(chunk, o.z0, o.z1, margin);
    const { beyond, piece } = splitUp(chunk, zl, zh);
    if (!piece.length || !isUpright(piece)) continue;
    const r = cutUp(piece, x0, x1, zl, zh, o);
    if (r === "same") return unchanged(tris);
    if (r) return finishWhole([...outside, ...beyond, ...r], frame);
    break;
  }
  if (!isPrisms(chunk)) {
    // its faces lean across the wall (a top bevelled under a roof): taken as sections along the wall instead
    if (!isSections(chunk)) return no("the wall there has faces that lean both along it and across it");
    const r = cutSections(chunk, x0, x1, o);
    if (r === "same") return unchanged(tris);
    return r ? finishWhole([...outside, ...r], frame) : null;
  }
  const bands = bandsAcross(chunk, x0, x1);
  if (!bands) return null;
  if (!bands.length) return unchanged(tris);
  const [zlo, zhi] = zRangeOf(chunk);
  const cut = rect(o.a0, o.a1, o.z0 <= zlo + WELD ? o.z0 - BEYOND : o.z0, o.z1 >= zhi - WELD ? o.z1 + BEYOND : o.z1);
  let changed = false;
  for (const b of bands) {
    if (clip("intersection", b.region, cut).length) changed = true;
    b.region = clip("difference", b.region, cut);
  }
  if (!changed) return unchanged(tris);
  if (bands.every((b) => !b.region.length)) return no("nothing of the wall would be left there");
  return finishWhole([...outside, ...rebuildAcross(bands, x0, x1)], frame);
}

/** `tris` with the opening filled back in: the solid as it runs just outside the opening carried across it. null when it can't, including when the solid on the two sides of the opening differs. */
export function fillOpening(tris: ArrayLike<number>, frame: WallFrame, o: WallOpening): CutSolid | null {
  refusal = "";
  try {
    return fillChunk(tris, frame, o);
  } catch (e) {
    return no(e instanceof Error && e.message.startsWith("too many") ? "that part of the wall has too many faces" : "the wall's outline there is too fine to work out");
  }
}

function fillChunk(tris: ArrayLike<number>, frame: WallFrame, o: WallOpening): CutSolid | null {
  const loc = toLocal(tris, frame);
  const [x0, x1] = chunkBounds(loc, o);
  const { outside, chunk } = splitAlong(loc, x0, x1);
  if (!chunk.length) return unchanged(tris);
  {
    const all = levelsOf(chunk);
    const [z0, z1] = [snapTo(all, o.z0), snapTo(all, o.z1)];
    for (const margin of z1 > z0 ? UP_MARGINS : []) {
      const [zl, zh] = upBounds(chunk, z0, z1, margin);
      const { beyond, piece } = splitUp(chunk, zl, zh);
      if (!piece.length || !isUpright(piece)) continue;
      const r = fillUp(piece, x0, x1, zl, zh, o, z0, z1);
      if (r === "same") return unchanged(tris);
      if (r) return finishWhole([...outside, ...beyond, ...r], frame);
      break;
    }
  }
  if (!isPrisms(chunk)) {
    if (!isSections(chunk)) return no("the wall there has faces that lean both along it and across it");
    const r = fillSections(chunk, x0, x1, o);
    if (r === "same") return unchanged(tris);
    return r ? finishWhole([...outside, ...r], frame) : null;
  }
  const bands = bandsAcross(chunk, x0, x1);
  if (!bands) return null;
  if (!bands.length) return unchanged(tris);
  const levels = levelsOf(chunk);
  const z0 = snapTo(levels, o.z0);
  const z1 = snapTo(levels, o.z1);
  if (!(z1 > z0)) return no("the opening has no height");
  const [zlo, zhi] = [z0 - STRIP, z1 + STRIP];
  const strip = rect(o.a0 - STRIP, o.a1 + STRIP, zlo, zhi);
  const [xl, xr] = [o.a0 - STRIP - 1, o.a1 + STRIP + 1];
  const within = (iv: [number, number][]): [number, number][] => iv.map(([a, b]): [number, number] => [Math.max(a, zlo), Math.min(b, zhi)]).filter(([a, b]) => b > a);
  for (const b of bands) {
    const L = within(acrossAt(b.region, xl));
    const R = within(acrossAt(b.region, xr));
    let region = clip("difference", b.region, strip);
    if (L.length && R.length) {
      if (L.length !== R.length) return no("the wall differs on the two sides of the opening");
      const quads: Multi[] = L.map((l, i): Multi => [[[[xl, l[0]], [xr, R[i][0]], [xr, R[i][1]], [xl, l[1]]] as Pair[]]]);
      region = clip("union", region, ...quads);
    } else if (L.length) {
      // the solid ends at the opening on the right: carry the left side across to its far jamb
      region = clip("union", region, ...L.map(([a, c]) => rect(xl, o.a1, a, c)));
    } else if (R.length) {
      region = clip("union", region, ...R.map(([a, c]) => rect(o.a0, xr, a, c)));
    }
    b.region = region;
  }
  return finishWhole([...outside, ...rebuildAcross(bands, x0, x1)], frame);
}
