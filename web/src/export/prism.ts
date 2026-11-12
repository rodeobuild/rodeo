// Vertical prisms found in a triangle mesh, for writers that have a solid of their own for one (Rhino's
// extrusion): a closed mesh whose corners all sit at one of two heights, whose bottom and top are flat and
// share one outline (with any holes), and whose sides are upright walls along that outline. An extrude, a
// slab, a straight wall without openings and an imported building all come out of the 3D view this way, as
// triangles; a writer that knows the prism can write it as the solid it is, so its faces show no diagonals.
// Pure geometry, no rhino3dm.

import type { Pt } from "../core/types.ts";

export interface Prism {
  /** the bottom's height, mm */
  z0: number;
  /** the top's height, mm, above z0 */
  z1: number;
  /** the outline, anticlockwise seen from above, its first point not repeated, no point on a straight run */
  outer: Pt[];
  /** the holes, each clockwise seen from above, likewise */
  holes: Pt[][];
}

/** Two heights, areas or lengths agree to this part of their size (float32 corners keep about 7 digits). */
const AGREE = 1e-4;

/**
 * The prism a piece's triangles (9 floats each, mm, z up) make, or null when they make something else. Corners
 * are matched by their exact coordinates, as the 3D view's triangles share them; each end's triangles all face
 * one way, up or down.
 */
export function prismOf(t: Float32Array): Prism | null {
  const n = Math.floor(t.length / 9);
  // a triangle's prism has 8 triangles: 2 ends and 3 sides of 2
  if (n < 8) return null;
  let z0 = Infinity;
  let z1 = -Infinity;
  let big = 0;
  for (let i = 0; i < 9 * n; i += 3) {
    z0 = Math.min(z0, t[i + 2]);
    z1 = Math.max(z1, t[i + 2]);
    big = Math.max(big, Math.abs(t[i]), Math.abs(t[i + 1]), Math.abs(t[i + 2]));
  }
  // a few float32 steps at the corners' size, at least a hundredth of a millimetre
  const tol = Math.max(0.01, 4e-7 * big);
  if (!(z1 - z0 > 100 * tol)) return null;
  const levelOf = (z: number): number => (Math.abs(z - z0) <= tol ? 0 : Math.abs(z - z1) <= tol ? 1 : -1);

  // each corner's plan point, by its exact x and y
  const ids = new Map<string, number>();
  const pts: Pt[] = [];
  const idOf = (x: number, y: number): number => {
    const key = `${x} ${y}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = pts.length;
      pts.push({ x, y });
      ids.set(key, id);
    }
    return id;
  };

  // the ends: their signed plan areas (and unsigned, which match only when no triangle overlaps another or
  // faces the other way) and the edges of each, directed as its triangles run
  const signed = [0, 0];
  const unsigned = [0, 0];
  const edges: Map<number, Map<number, number>>[] = [new Map(), new Map()];
  const addEdge = (level: number, a: number, b: number): void => {
    let out = edges[level].get(a);
    if (!out) edges[level].set(a, (out = new Map()));
    out.set(b, (out.get(b) ?? 0) + 1);
  };
  let wallArea = 0;
  const walls: number[] = [];
  for (let i = 0; i < 9 * n; i += 9) {
    const la = levelOf(t[i + 2]);
    const lb = levelOf(t[i + 5]);
    const lc = levelOf(t[i + 8]);
    if (la < 0 || lb < 0 || lc < 0) return null;
    const a = idOf(t[i], t[i + 1]);
    const b = idOf(t[i + 3], t[i + 4]);
    const c = idOf(t[i + 6], t[i + 7]);
    const cross = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
    const longest = Math.max(dist(pts[a], pts[b]), dist(pts[b], pts[c]), dist(pts[c], pts[a]));
    if (la === lb && lb === lc) {
      // a degenerate sliver adds nothing
      if (Math.abs(cross) <= tol * longest) continue;
      signed[la] += cross / 2;
      unsigned[la] += Math.abs(cross) / 2;
      addEdge(la, a, b);
      addEdge(la, b, c);
      addEdge(la, c, a);
    } else {
      // a side: upright, so flat in plan
      if (Math.abs(cross) > tol * longest) return null;
      wallArea += area3(t, i);
      walls.push(a, b, c);
    }
  }
  // one end as large as the other, each with nothing doubled over or turned the other way (the ends may face
  // either way: the 3D view draws both sides)
  const capArea = Math.abs(signed[1]);
  if (!(capArea > 0) || !agree(Math.abs(signed[0]), capArea) || !agree(unsigned[0], capArea) || !agree(unsigned[1], capArea)) return null;

  // each end's boundary: the edges no other triangle of that end runs back along, taken as they run when the
  // end faces up
  const boundary = (level: number, flip: boolean): Map<number, number[]> => {
    const out = new Map<number, number[]>();
    for (const [a, to] of edges[level]) {
      for (const [b, k] of to) {
        const back = edges[level].get(b)?.get(a) ?? 0;
        for (let j = back; j < k; j++) {
          const [p, q] = flip ? [b, a] : [a, b];
          const list = out.get(p);
          if (list) list.push(q);
          else out.set(p, [q]);
        }
      }
    }
    return out;
  };
  const top = boundary(1, signed[1] < 0);
  const bottom = boundary(0, signed[0] < 0);
  // the same outline at both ends, each corner leaving by one edge
  let count = 0;
  for (const [a, to] of top) {
    if (to.length !== 1) return null;
    const below = bottom.get(a);
    if (!below || below.length !== 1 || below[0] !== to[0]) return null;
    count++;
  }
  if (count !== bottom.size) return null;

  // the outline's loops, walked from each corner not yet taken
  const loops: Pt[][] = [];
  const taken = new Set<number>();
  let perimeter = 0;
  for (const start of top.keys()) {
    if (taken.has(start)) continue;
    const loop: Pt[] = [];
    let at = start;
    do {
      const next = top.get(at)![0];
      if (taken.has(at) || !top.has(next)) return null;
      taken.add(at);
      loop.push(pts[at]);
      perimeter += dist(pts[at], pts[next]);
      at = next;
    } while (at !== start);
    if (loop.length < 3) return null;
    loops.push(loop);
  }
  // one outline, anticlockwise; holes clockwise inside it, the end's area what they leave
  const areas = loops.map(ringArea);
  const outers = areas.filter((a) => a > 0).length;
  if (outers !== 1 || !agree(areas.reduce((s, a) => s + a, 0), capArea)) return null;
  // the sides stand on the outline (at its corners, or on its runs where an end's triangulation passed over a
  // corner in a straight line) and cover it to the top, no more
  const runs = [...top].map(([a, to]) => [pts[a], pts[to[0]]] as const);
  const onOutline = (p: Pt): boolean =>
    runs.some(([a, b]) => {
      const len = dist(a, b);
      const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
      return len > 0 && Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) <= tol * len && along >= 0 && along <= len * len;
    });
  const checked = new Set<number>();
  for (const id of walls) {
    if (taken.has(id) || checked.has(id)) continue;
    if (!onOutline(pts[id])) return null;
    checked.add(id);
  }
  if (!agree(wallArea, perimeter * (z1 - z0))) return null;

  const outer = straightened(loops[areas.findIndex((a) => a > 0)], tol);
  const holes = loops.filter((_, i) => areas[i] < 0).map((l) => straightened(l, tol));
  if (outer.length < 3 || holes.some((h) => h.length < 3)) return null;
  return { z0, z1, outer, holes };
}

/** Whether two sizes agree to AGREE of the larger. */
function agree(a: number, b: number): boolean {
  return Math.abs(a - b) <= AGREE * Math.max(Math.abs(a), Math.abs(b));
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** A triangle's area in 3D, from its 9 floats at `i`. */
function area3(t: Float32Array, i: number): number {
  const ux = t[i + 3] - t[i];
  const uy = t[i + 4] - t[i + 1];
  const uz = t[i + 5] - t[i + 2];
  const vx = t[i + 6] - t[i];
  const vy = t[i + 7] - t[i + 1];
  const vz = t[i + 8] - t[i + 2];
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

/** A closed ring's signed area, positive anticlockwise. */
function ringArea(r: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i];
    const b = r[(i + 1) % r.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** A closed ring without its points on a straight run (within `tol` of the line through their neighbours). */
function straightened(r: readonly Pt[], tol: number): Pt[] {
  const out = [...r];
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const p = out[i];
      const b = out[(i + 1) % out.length];
      const len = dist(a, b);
      const off = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
      // on the run between its neighbours, not doubling back
      const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
      if (len > 0 && off <= tol * len && along > 0 && along < len * len) {
        out.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return out;
}
