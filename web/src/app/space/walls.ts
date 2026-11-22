// Rooms from walls: the net boundary of each room a set of walls closes (the walls' inner faces),
// and its gross boundary (to the walls' centre lines), for Spaces that are kept to their walls.
// Free of the page: roomsOf takes the walls' footprints, so checks run without a document
// (walls.check.ts). wallRooms reads them from a session.

import type { EditSession, Pt } from "../../core/index.ts";
import { ringArea, wallPolys } from "../wallPolys.ts";

/** A room walls close: its net boundary on the drawing, and its gross one when it can be found. */
export interface WallRoom {
  readonly net: Pt[];
  readonly gross: Pt[] | null;
}

/** A net edge lies on a wall's face when its direction is within this angle of the centre line (sine). 0.01 degrees. */
const PARALLEL = Math.sin((0.01 * Math.PI) / 180);
/** mm: how far a net edge may sit from a face, and how little its overlap with a wall's span may be */
const FACE_TOL = 1;
/** mm: a wall thinner than this has no two faces to find */
const MIN_THICKNESS = 1;

/** A straight wall's faces, from its footprint: its direction u, its normal n, its centre line n·p = c, its thickness and its span along u. */
interface WallLine {
  readonly u: Pt;
  readonly n: Pt;
  readonly c: number;
  readonly t: number;
  readonly lo: number;
  readonly hi: number;
}

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const unit = (a: Pt): Pt => {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

/**
 * The rooms the walls `wallIds` close. Throws when their outlines can't be joined.
 * (Walls in groups among them are read by wallFootprints, as Create Polys from Walls does.)
 */
export function wallRooms(session: EditSession, wallIds: string[]): WallRoom[] {
  if (!wallIds.length) return [];
  return roomsOf(session.wallFootprints(wallIds));
}

/**
 * The rooms walls with these footprints close (each footprint a ring of plan points, as
 * wallFootprints gives them). The net boundary of a room is its inner faces; its gross boundary
 * moves each net edge that lies on a wall's face out to that wall's centre line and rebuilds the
 * ring from the moved lines. Edges on no wall (a wall's end cap, say) stay where they are. The
 * gross ring is null when the result isn't a simple ring of at least the net area (a curved wall
 * can make one). Throws when the outlines can't be joined (wallPolys).
 */
export function roomsOf(footprints: readonly Pt[][]): WallRoom[] {
  const nets = wallPolys(footprints, true);
  if (!nets.length) return [];
  const walls = footprints.map(lineOf).filter((w): w is WallLine => w !== null);
  return nets.map((net) => ({ net, gross: grossOf(net, walls) }));
}

/**
 * A wall's centre line and faces, from its footprint: the footprint's longest edge is one face,
 * and the longest edge parallel to it on the other side is the other. Null when the footprint has
 * no such pair (a curved wall's many short edges, a wall with no thickness).
 */
function lineOf(fp: readonly Pt[]): WallLine | null {
  const m = fp.length;
  if (m < 3) return null;
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < m; i++) {
    const l = len(sub(fp[(i + 1) % m], fp[i]));
    if (l > bestLen) [best, bestLen] = [i, l];
  }
  if (best < 0 || bestLen < FACE_TOL) return null;
  const a = fp[best];
  const b = fp[(best + 1) % m];
  const u = unit(sub(b, a));
  let other = -1;
  let otherLen = 0;
  for (let j = 0; j < m; j++) {
    if (j === best) continue;
    const p = fp[j];
    const q = fp[(j + 1) % m];
    const d = sub(q, p);
    const l = len(d);
    // parallel to the face, and not on its line (a face's own collinear pieces)
    if (l <= otherLen || l < FACE_TOL || Math.abs(cross(u, d)) / l > PARALLEL || Math.abs(cross(u, sub(p, a))) < FACE_TOL) continue;
    other = j;
    otherLen = l;
  }
  if (other < 0) return null;
  const p = fp[other];
  const q = fp[(other + 1) % m];
  const n: Pt = { x: -u.y, y: u.x };
  const d1 = dot(n, a);
  const d2 = dot(n, p);
  const t = Math.abs(d1 - d2);
  if (t < MIN_THICKNESS) return null;
  const span = [dot(u, a), dot(u, b), dot(u, p), dot(u, q)];
  return { u, n, c: (d1 + d2) / 2, t, lo: Math.min(...span), hi: Math.max(...span) };
}

/** Whether the net edge a→b lies on a wall's face: parallel to its centre line, half its thickness off it, and over its span. */
function onFace(a: Pt, b: Pt, w: WallLine): boolean {
  const d = sub(b, a);
  const l = len(d);
  if (l < FACE_TOL || Math.abs(cross(w.u, d)) / l > PARALLEL) return false;
  if (Math.abs(Math.abs(dot(w.n, a) - w.c) - w.t / 2) > FACE_TOL) return false;
  const s0 = dot(w.u, a);
  const s1 = dot(w.u, b);
  return Math.min(Math.max(s0, s1), w.hi) - Math.max(Math.min(s0, s1), w.lo) > FACE_TOL;
}

/** An edge of the ring as a line: a point on it and its direction; `moved` when it was put on a wall's centre line (its normal and offset then). */
interface Edge {
  readonly p: Pt;
  readonly d: Pt;
  readonly moved: boolean;
  readonly n: Pt;
  readonly c: number;
}

/** The gross ring of a net ring, or null (see roomsOf). */
function grossOf(net: readonly Pt[], walls: readonly WallLine[]): Pt[] | null {
  const m = net.length;
  if (m < 3) return null;
  const edges: Edge[] = net.map((a, i) => {
    const b = net[(i + 1) % m];
    const w = walls.find((x) => onFace(a, b, x));
    if (w) return { p: { x: a.x + w.n.x * (w.c - dot(w.n, a)), y: a.y + w.n.y * (w.c - dot(w.n, a)) }, d: w.u, moved: true, n: w.n, c: w.c };
    return { p: a, d: unit(sub(b, a)), moved: false, n: { x: 0, y: 0 }, c: 0 };
  });
  const out: Pt[] = [];
  for (let k = 0; k < m; k++) {
    const prev = edges[(k - 1 + m) % m];
    const cur = edges[k];
    const den = cross(prev.d, cur.d);
    if (Math.abs(den) <= PARALLEL) {
      // parallel neighbours: the corner keeps the offset of the moved edge beside it
      const base = net[k];
      const e = prev.moved ? prev : cur.moved ? cur : null;
      out.push(e ? { x: base.x + e.n.x * (e.c - dot(e.n, base)), y: base.y + e.n.y * (e.c - dot(e.n, base)) } : base);
      continue;
    }
    const t = cross(sub(cur.p, prev.p), cur.d) / den;
    out.push({ x: prev.p.x + prev.d.x * t, y: prev.p.y + prev.d.y * t });
  }
  const clean = out.filter((p, i) => {
    const q = out[(i - 1 + m) % m];
    return len(sub(p, q)) > 1e-3;
  });
  if (clean.length < 3) return null;
  const netArea = ringArea(net);
  if (!isSimple(clean) || ringArea(clean) < netArea - 1e-6 || Math.sign(signed(clean)) !== Math.sign(signed(net))) return null;
  return clean;
}

const signed = (ring: readonly Pt[]): number => ring.reduce((acc, p, i) => acc + cross(p, ring[(i + 1) % ring.length]), 0) / 2;

/** Whether no two edges of the ring that aren't neighbours touch. */
function isSimple(ring: readonly Pt[]): boolean {
  const m = ring.length;
  const orient = (a: Pt, b: Pt, c: Pt): number => cross(sub(b, a), sub(c, a));
  for (let i = 0; i < m; i++) {
    for (let j = i + 2; j < m; j++) {
      if (i === 0 && j === m - 1) continue;
      const a = ring[i];
      const b = ring[(i + 1) % m];
      const c = ring[j];
      const d = ring[(j + 1) % m];
      const o1 = orient(a, b, c);
      const o2 = orient(a, b, d);
      const o3 = orient(c, d, a);
      const o4 = orient(c, d, b);
      if (o1 * o2 <= 0 && o3 * o4 <= 0) return false;
    }
  }
  return true;
}
