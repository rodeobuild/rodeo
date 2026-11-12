// Plane geometry for Site Context: the outlines of roads, rail and waterways (offset lines), the
// areas of buildings and parks, simplifying contours, and joining OpenStreetMap ways into rings.
// Points are {x, y} pairs; for ring stitching x is longitude and y latitude.

import type { Pt } from "../../core/index.ts";

const EPS = 1e-9;

export function samePoint(a: Pt, b: Pt, eps = EPS): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** The points with each run of repeats of the same point reduced to one. */
export function dedupe(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) if (out.length === 0 || !samePoint(out[out.length - 1], p)) out.push({ x: p.x, y: p.y });
  return out;
}

/**
 * The line `points` moved `d` to its left (negative: right), with mitred corners: a corner's
 * offset is stretched along the bisector, up to twice `d` (a sharper turn is cut at that length).
 * Returns [] when fewer than two distinct points remain.
 */
export function offsetLine(points: readonly Pt[], d: number, miterLimit = 2): Pt[] {
  const pts = dedupe(points);
  const n = pts.length;
  if (n < 2) return [];
  // unit left normal of each segment
  const normals: Pt[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    normals.push({ x: -dy / len, y: dx / len });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (i === 0) out.push({ x: p.x + normals[0].x * d, y: p.y + normals[0].y * d });
    else if (i === n - 1) out.push({ x: p.x + normals[n - 2].x * d, y: p.y + normals[n - 2].y * d });
    else {
      const a = normals[i - 1];
      const b = normals[i];
      let mx = a.x + b.x;
      let my = a.y + b.y;
      const ml = Math.hypot(mx, my);
      if (ml < EPS) {
        // a full reversal: the previous segment's normal
        out.push({ x: p.x + a.x * d, y: p.y + a.y * d });
        continue;
      }
      mx /= ml;
      my /= ml;
      // cosine of half the turn: the miter's stretch is 1 / cos
      const cos = mx * a.x + my * a.y;
      const k = Math.min(miterLimit, 1 / Math.max(cos, EPS));
      out.push({ x: p.x + mx * d * k, y: p.y + my * d * k });
    }
  }
  return out;
}

/** Signed area of a polygon (shoelace); positive for counter-clockwise. The ring closes itself. */
export function polygonArea(points: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** The centre of mass of a polygon's area; the mean of its vertices when it has no area. */
export function polygonCentroid(points: readonly Pt[]): Pt {
  const area = polygonArea(points);
  if (Math.abs(area) < EPS) {
    const n = Math.max(points.length, 1);
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

/** Douglas-Peucker simplification of an open line: points within `tol` of the chord are dropped. */
export function simplify(points: readonly Pt[], tol: number): Pt[] {
  if (points.length < 3) return points.map((p) => ({ x: p.x, y: p.y }));
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    const pa = points[a];
    const pb = points[b];
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy);
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const p = points[i];
      const d = len < EPS ? Math.hypot(p.x - pa.x, p.y - pa.y) : Math.abs((p.x - pa.x) * dy - (p.y - pa.y) * dx) / len;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push({ x: points[i].x, y: points[i].y });
  return out;
}

/**
 * Joins line pieces (each a list of points) end to end into closed rings, as a multipolygon's
 * member ways are joined. A piece is turned round when it fits the chain the other way. Pieces that
 * never close are dropped.
 */
export function stitchRings(lines: readonly (readonly Pt[])[]): Pt[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.map((p) => ({ x: p.x, y: p.y })));
  const rings: Pt[][] = [];
  const isClosed = (r: Pt[]): boolean => r.length >= 4 && samePoint(r[0], r[r.length - 1]);
  while (pool.length > 0) {
    let ring = pool.pop() as Pt[];
    let joined = true;
    while (!isClosed(ring) && joined) {
      joined = false;
      for (let i = 0; i < pool.length; i++) {
        const piece = pool[i];
        const head = ring[0];
        const tail = ring[ring.length - 1];
        const last = piece.length - 1;
        if (samePoint(tail, piece[0])) ring = ring.concat(piece.slice(1));
        else if (samePoint(tail, piece[last])) ring = ring.concat(piece.slice(0, last).reverse());
        else if (samePoint(head, piece[last])) ring = piece.slice(0, last).concat(ring);
        else if (samePoint(head, piece[0])) ring = piece.slice(1).reverse().concat(ring);
        else continue;
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(ring);
  }
  return rings;
}

/** True when `p` is inside the ring (even-odd; a closing point repeated or not). */
export function pointInRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * A multipolygon's outer rings, each with the inner rings inside it as its holes (an inner ring
 * goes to the first outer ring holding its first point; one inside none is left out).
 */
export function ringsWithHoles(outers: readonly Pt[][], inners: readonly Pt[][]): { outer: Pt[]; holes: Pt[][] }[] {
  const out = outers.map((outer) => ({ outer, holes: [] as Pt[][] }));
  const boxes = outers.map((r) => {
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  });
  for (const inner of inners) {
    const p = inner[0];
    const k = out.findIndex((o, i) => {
      const b = boxes[i];
      return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && pointInRing(p, o.outer);
    });
    if (k >= 0) out[k].holes.push(inner);
  }
  return out;
}

/** True when segments ab and cd cross at a point inside both (touching at an end does not count). */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * A polygon with holes as one outline that a fill shows the holes in: the outline anticlockwise,
 * and each hole, clockwise, joined to it by a cut there and back from the hole's nearest corner to
 * the nearest corner of the outline it can reach without crossing anything. A hole with no such
 * cut is left out (filled over).
 */
export function keyhole(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt[] {
  const open = (pts: readonly Pt[]): Pt[] => {
    const out = dedupe(pts);
    if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
    return out;
  };
  let ring = open(outer);
  if (polygonArea(ring) < 0) ring.reverse();
  const pending = holes.map(open).filter((h) => h.length >= 3);
  for (const h of pending) if (polygonArea(h) > 0) h.reverse();
  // the holes nearest the outline first, so later ones can reach it through the holes joined before
  const edgesOf = (r: readonly Pt[]): [Pt, Pt][] => r.map((p, i) => [p, r[(i + 1) % r.length]]);
  while (pending.length) {
    let joined = false;
    for (let k = 0; k < pending.length && !joined; k++) {
      const hole = pending[k];
      const others = pending.filter((_, j) => j !== k).flatMap(edgesOf);
      const walls = [...edgesOf(ring), ...edgesOf(hole), ...others];
      // try the hole's corners against the outline's, nearest pairs first, a bounded number of them
      const most = 64;
      const pairs: { hi: number; ri: number; d: number }[] = [];
      const step = Math.max(1, Math.floor(hole.length / 16));
      for (let hi = 0; hi < hole.length; hi += step) {
        const hp = hole[hi];
        for (let ri = 0; ri < ring.length; ri++) {
          const d = (ring[ri].x - hp.x) ** 2 + (ring[ri].y - hp.y) ** 2;
          if (pairs.length === most && d >= pairs[most - 1].d) continue;
          let at = pairs.length;
          while (at > 0 && pairs[at - 1].d > d) at--;
          pairs.splice(at, 0, { hi, ri, d });
          if (pairs.length > most) pairs.pop();
        }
      }
      for (const { hi, ri } of pairs) {
        const a = hole[hi];
        const b = ring[ri];
        if (walls.some(([p, q]) => crosses(a, b, p, q))) continue;
        const around = [...hole.slice(hi), ...hole.slice(0, hi), hole[hi]];
        ring = [...ring.slice(0, ri + 1), ...around, ...ring.slice(ri)];
        pending.splice(k, 1);
        joined = true;
        break;
      }
    }
    // what is left can't be reached: filled over
    if (!joined) break;
  }
  return ring;
}
