// Flat surfaces found in a triangle mesh, for writers that have a face of their own for one (Rhino's trimmed
// planar surface): an open piece whose triangles all lie on one plane and face one way, as the rings its
// outline makes on that plane, each outer ring with the holes inside it. Site Context's water, green spaces,
// paths and roads on flat ground, a floor or one plane of a roof come out of the 3D view this way, as
// triangles; a writer that knows the flat surface can write it as one face, so it shows its outline and not
// the triangles' diagonals. Pure geometry, no rhino3dm.

import polygonClipping, { type Pair, type Polygon } from "polygon-clipping";
import type { Pt } from "../core/types.ts";
import { ringArea, straightened } from "./prism.ts";

type Vec = [number, number, number];

/** One part of a flat surface, in its plane's own coordinates (x along `u`, y along `v`). */
export interface FlatRegion {
  /** the outline, anticlockwise seen from the side the surface faces, its first point not repeated, no point on a straight run */
  outer: Pt[];
  /** the holes inside it, each clockwise, likewise */
  holes: Pt[][];
}

export interface Flat {
  /** a point of the plane, mm */
  origin: Vec;
  /** the plane's axes, each of length 1: a ring's point (x, y) is origin + x·u + y·v */
  u: Vec;
  v: Vec;
  /** u × v, the side the surface faces */
  n: Vec;
  regions: FlatRegion[];
  /** a ring's point in the model, mm: the piece's own corner where it is one, else origin + x·u + y·v */
  at(p: Pt): Vec;
}

/** A piece in more separate parts than this stays one mesh rather than becoming that many surfaces. */
export const MOST_REGIONS = 16;

/** The most triangles whose union is taken when their outline does not close cleanly: polygon-clipping takes 70 ms for 300 triangles all overlapping, 3 s for 1,000. */
const MOST_UNION = 500;

/**
 * The flat surface a piece's triangles (9 floats each, mm) make, or null when they make something else: corners
 * off one plane (by more than a few float32 steps), a triangle facing the other way, or rings that cross or touch.
 * Corners are matched by their exact coordinates, as the 3D view's triangles share them. Its outline is the sides
 * no triangle runs back along; a flat sliver (three corners in a line) is a triangle like any other, so a corner
 * the triangulation passed over on a straight run still closes it. Where triangles overlap (a path's strip folding
 * over itself at a sharp bend), the outline is that of their union instead.
 */
export function flatOf(t: Float32Array, most = MOST_REGIONS): Flat | null {
  const count = Math.floor(t.length / 9);
  if (count < 1) return null;
  let big = 0;
  for (let i = 0; i < 9 * count; i++) big = Math.max(big, Math.abs(t[i]));
  // a few float32 steps at the corners' size, at least a hundredth of a millimetre (as prismOf)
  const tol = Math.max(0.01, 4e-7 * big);

  // the corners, by exact position, and the triangles that have three different ones
  const ids = new Map<string, number>();
  const xyz: number[] = [];
  const idOf = (i: number): number => {
    const key = `${t[i]} ${t[i + 1]} ${t[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = xyz.length / 3;
      xyz.push(t[i], t[i + 1], t[i + 2]);
      ids.set(key, id);
    }
    return id;
  };
  const tris: number[] = [];
  // twice the area-weighted normal
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (let i = 0; i < 9 * count; i += 9) {
    const a = idOf(i);
    const b = idOf(i + 3);
    const c = idOf(i + 6);
    if (a === b || b === c || c === a) continue;
    const ux = t[i + 3] - t[i];
    const uy = t[i + 4] - t[i + 1];
    const uz = t[i + 5] - t[i + 2];
    const vx = t[i + 6] - t[i];
    const vy = t[i + 7] - t[i + 1];
    const vz = t[i + 8] - t[i + 2];
    sx += uy * vz - uz * vy;
    sy += uz * vx - ux * vz;
    sz += ux * vy - uy * vx;
    tris.push(a, b, c);
  }
  const len = Math.hypot(sx, sy, sz);
  if (!(len > 0) || tris.length === 0) return null;
  const n: Vec = [sx / len, sy / len, sz / len];

  // the plane through the corners' middle, every corner on it
  const corners = xyz.length / 3;
  const origin: Vec = [0, 0, 0];
  for (let k = 0; k < corners; k++) for (let j = 0; j < 3; j++) origin[j] += xyz[3 * k + j] / corners;
  for (let k = 0; k < corners; k++) {
    const off = (xyz[3 * k] - origin[0]) * n[0] + (xyz[3 * k + 1] - origin[1]) * n[1] + (xyz[3 * k + 2] - origin[2]) * n[2];
    if (Math.abs(off) > tol) return null;
  }
  // its axes: u level unless the plane is nearly so (then along x), v up the plane
  const u = unit(Math.abs(n[2]) > 0.9 ? cross([0, 1, 0], n) : cross([0, 0, 1], n));
  const v = cross(n, u);
  const pts: Pt[] = [];
  for (let k = 0; k < corners; k++) {
    const d: Vec = [xyz[3 * k] - origin[0], xyz[3 * k + 1] - origin[1], xyz[3 * k + 2] - origin[2]];
    pts.push({ x: dot(d, u), y: dot(d, v) });
  }

  // each triangle facing n (a sliver either way)
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]];
    const area2 = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const longest = Math.max(dist(a, b), dist(b, c), dist(c, a));
    if (area2 < -tol * longest) return null;
  }
  const loops = outline(tris, pts, tol) ?? union(tris, pts, tol);
  if (!loops) return null;

  // each outline anticlockwise, each hole clockwise and inside the smallest outline round it
  const areas = loops.map(ringArea);
  if (areas.some((a) => !(Math.abs(a) > 0))) return null;
  const outers = loops.map((_, i) => i).filter((i) => areas[i] > 0);
  if (outers.length === 0 || outers.length > most) return null;
  const regions = new Map<number, FlatRegion>(outers.map((i) => [i, { outer: loops[i], holes: [] }]));
  for (let i = 0; i < loops.length; i++) {
    if (areas[i] > 0) continue;
    let best = -1;
    for (const o of outers) if (inside(loops[i][0], loops[o]) && (best < 0 || areas[o] < areas[best])) best = o;
    if (best < 0) return null;
    regions.get(best)!.holes.push(loops[i]);
  }
  // the corners as the piece has them, so a writer puts them back exactly
  const own = new Map<Pt, Vec>(pts.map((p, k) => [p, [xyz[3 * k], xyz[3 * k + 1], xyz[3 * k + 2]]]));
  const at = (p: Pt): Vec =>
    own.get(p) ?? [origin[0] + p.x * u[0] + p.y * v[0], origin[1] + p.x * u[1] + p.y * v[1], origin[2] + p.x * u[2] + p.y * v[2]];
  return { origin, u, v, n, regions: [...regions.values()], at };
}

/**
 * The rings of the sides no triangle runs back along, each straightened; null when a side is run twice the same
 * way, a corner is left by two of them, or the rings cross or touch.
 */
function outline(tris: readonly number[], pts: readonly Pt[], tol: number): Pt[][] | null {
  const corners = pts.length;
  const runs = new Set<number>();
  for (let k = 0; k < tris.length; k += 3) {
    for (let j = 0; j < 3; j++) {
      const key = tris[k + j] * corners + tris[k + ((j + 1) % 3)];
      if (runs.has(key)) return null;
      runs.add(key);
    }
  }
  const next = new Map<number, number>();
  for (const key of runs) {
    const a = Math.floor(key / corners);
    const b = key - a * corners;
    if (runs.has(b * corners + a)) continue;
    if (next.has(a)) return null;
    next.set(a, b);
  }
  if (next.size < 3) return null;
  const loops: Pt[][] = [];
  const taken = new Set<number>();
  for (const start of next.keys()) {
    if (taken.has(start)) continue;
    const loop: Pt[] = [];
    let at = start;
    do {
      if (taken.has(at)) return null;
      taken.add(at);
      loop.push(pts[at]);
      const to = next.get(at);
      if (to === undefined) return null;
      at = to;
    } while (at !== start);
    const ring = straightened(loop, tol);
    if (ring.length < 3) return null;
    loops.push(ring);
  }
  return crossing(loops, tol) ? null : loops;
}

/** The rings of the triangles' union (polygon-clipping), each straightened; null when there are too many, it fails, or they cross or touch. */
function union(tris: readonly number[], pts: readonly Pt[], tol: number): Pt[][] | null {
  if (tris.length / 3 > MOST_UNION) return null;
  const polys: Polygon[] = [];
  for (let k = 0; k < tris.length; k += 3) {
    const ring: Pair[] = [tris[k], tris[k + 1], tris[k + 2], tris[k]].map((i) => [pts[i].x, pts[i].y]);
    polys.push([ring]);
  }
  let merged: Pair[][][];
  try {
    merged = polys.length > 1 ? polygonClipping.union(polys[0], ...polys.slice(1)) : [polys[0]];
  } catch {
    return null;
  }
  const loops: Pt[][] = [];
  for (const poly of merged) {
    for (const r of poly) {
      // closed, its first point repeated
      const ring = straightened(r.slice(0, -1).map(([x, y]) => ({ x, y })), tol);
      if (ring.length < 3) return null;
      loops.push(ring);
    }
  }
  return loops.length && !crossing(loops, tol) ? loops : null;
}

/**
 * Whether any two sides of the rings cross or touch, other than a ring's neighbouring sides at their shared
 * corner: the sides are put in the cells of a grid they pass over, and those sharing a cell are tried.
 */
function crossing(rings: readonly (readonly Pt[])[], tol: number): boolean {
  const sides: [Pt, Pt, number, number][] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  rings.forEach((r, k) => {
    for (let i = 0; i < r.length; i++) {
      sides.push([r[i], r[(i + 1) % r.length], k, i]);
      x0 = Math.min(x0, r[i].x);
      y0 = Math.min(y0, r[i].y);
      x1 = Math.max(x1, r[i].x);
      y1 = Math.max(y1, r[i].y);
    }
  });
  const cells = Math.max(1, Math.ceil(Math.sqrt(sides.length)));
  const cw = (x1 - x0) / cells || 1;
  const ch = (y1 - y0) / cells || 1;
  const cellOf = (x: number, size: number, from: number): number => Math.min(cells - 1, Math.max(0, Math.floor((x - from) / size)));
  const grid = new Map<number, number[]>();
  sides.forEach(([a, b], s) => {
    const ci0 = cellOf(Math.min(a.x, b.x) - tol, cw, x0);
    const ci1 = cellOf(Math.max(a.x, b.x) + tol, cw, x0);
    const cj0 = cellOf(Math.min(a.y, b.y) - tol, ch, y0);
    const cj1 = cellOf(Math.max(a.y, b.y) + tol, ch, y0);
    for (let i = ci0; i <= ci1; i++) {
      for (let j = cj0; j <= cj1; j++) {
        const key = j * cells + i;
        const list = grid.get(key);
        if (list) list.push(s);
        else grid.set(key, [s]);
      }
    }
  });
  for (const list of grid.values()) {
    for (let p = 0; p < list.length; p++) {
      for (let q = p + 1; q < list.length; q++) {
        const [a, b, ka, ia] = sides[list[p]];
        const [c, d, kc, ic] = sides[list[q]];
        if (ka === kc) {
          const size = rings[ka].length;
          // neighbours share a corner, and only that
          if ((ia + 1) % size === ic || (ic + 1) % size === ia) {
            if (size > 3 && overlapping(a, b, c, d, tol)) return true;
            continue;
          }
        }
        if (meet(a, b, c, d, tol)) return true;
      }
    }
  }
  return false;
}

/** Whether neighbouring sides a-b and c-d (sharing one corner) double back along each other. */
function overlapping(a: Pt, b: Pt, c: Pt, d: Pt, tol: number): boolean {
  // the shared corner and the two far ends
  const [shared, p, q] = samePt(b, c) ? [b, a, d] : [a, b, c];
  const ux = p.x - shared.x;
  const uy = p.y - shared.y;
  const vx = q.x - shared.x;
  const vy = q.y - shared.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  return Math.abs(ux * vy - uy * vx) <= tol * Math.max(lu, lv) && ux * vx + uy * vy > 0;
}

/** Whether segments a-b and c-d meet, ends and touching included (within `tol`). */
function meet(a: Pt, b: Pt, c: Pt, d: Pt, tol: number): boolean {
  if (Math.max(a.x, b.x) < Math.min(c.x, d.x) - tol || Math.max(c.x, d.x) < Math.min(a.x, b.x) - tol) return false;
  if (Math.max(a.y, b.y) < Math.min(c.y, d.y) - tol || Math.max(c.y, d.y) < Math.min(a.y, b.y) - tol) return false;
  const lab = dist(a, b) || 1;
  const lcd = dist(c, d) || 1;
  // signed distances of each segment's ends from the other's line
  const dc = side(a, b, c) / lab;
  const dd = side(a, b, d) / lab;
  const da = side(c, d, a) / lcd;
  const db = side(c, d, b) / lcd;
  if (((dc > tol && dd < -tol) || (dc < -tol && dd > tol)) && ((da > tol && db < -tol) || (da < -tol && db > tol))) return true;
  // an end on the other segment
  return near(c, a, b, tol) || near(d, a, b, tol) || near(a, c, d, tol) || near(b, c, d, tol);
}

/** Twice the signed area of a, b, p: positive when p is left of a→b. */
function side(a: Pt, b: Pt, p: Pt): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Whether p lies on segment a-b, within `tol`. */
function near(p: Pt, a: Pt, b: Pt, tol: number): boolean {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  const s = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2)) : 0;
  return Math.hypot(a.x + s * (b.x - a.x) - p.x, a.y + s * (b.y - a.y) - p.y) <= tol;
}

/** Whether p is inside ring r (even-odd), p not on it. */
function inside(p: Pt, r: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i];
    const b = r[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function samePt(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec, b: Vec): Vec {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit(a: Vec): Vec {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
