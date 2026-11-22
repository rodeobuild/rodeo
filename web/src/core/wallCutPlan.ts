// Cutting an opening through a wall's plan drawing, and closing one again, in the wall's own
// coordinates (mm): x along the wall's line from its start, y across it (left of start→end positive).
// A wall's plan is loose parts: closed polygons (the whole wall, then each component, each filled in
// its own class) and lines (faces, component boundaries, jambs, returns), often one line several
// times in different classes. Where a door or window sits, the parts simply stop. These functions
// work out the changes (set, remove, add) that cut an opening through them, or close one again, and
// leave applying them to the caller's records. Ids for added parts are the caller's to make.

import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";

export interface PlanPart {
  /** the caller's key for the record */
  id: string;
  kind: "polygon" | "line";
  /** parts that draw alike (same class and attributes): pieces are only ever joined within one group */
  group: string;
  /** wall coordinates, mm; a polygon's ring without its first point repeated; a line's two ends */
  points: { x: number; y: number }[];
}
export type PlanChange =
  | { op: "set"; id: string; points: { x: number; y: number }[] }
  | { op: "remove"; id: string }
  /** a new part drawn like `like` (a copy of that record with these points) */
  | { op: "add"; like: string; kind: "polygon" | "line"; points: { x: number; y: number }[] };

type Pt = { x: number; y: number };

/** Points this close (mm) are one point, and edges this close are one edge. */
const SAME = 0.01;
/** Pieces this thin along x (mm) are dropped. */
const MIN_PIECE = 0.5;
/** How far the two pieces of a polygon may disagree in y at the zone to pair (mm). */
const POLY_Y_AGREE = 1;
/** How far two lines may be apart in y to join along the wall (mm). */
const LINE_Y_AGREE = 0.5;

/** Cuts an opening from x = a0 to a1 through the plan parts. */
export function cutPlanOpening(parts: readonly PlanPart[], a0: number, a1: number): PlanChange[] {
  const lo = Math.min(a0, a1);
  const hi = Math.max(a0, a1);
  const lines = parts.filter((p) => p.kind === "line");
  const sets: PlanChange[] = [];
  const jambs: PlanChange[] = [];
  const removes: PlanChange[] = [];
  const jambKeys = new Set<string>();

  for (const part of parts) {
    if (part.kind === "polygon") {
      const ring = part.points;
      const pieces = cutRing(ring, lo, hi);
      if (!pieces) continue;
      if (!pieces.length) {
        removes.push({ op: "remove", id: part.id });
        continue;
      }
      sets.push({ op: "set", id: part.id, points: pieces[0] });
      for (const piece of pieces.slice(1)) sets.push({ op: "add", like: part.id, kind: "polygon", points: piece });
      // jamb lines: edges the pieces gained on the strip's two sides
      const like = lineFor(lines, part.group);
      if (!like) continue;
      for (const piece of pieces)
        for (const x of [lo, hi]) {
          for (const [ya, yb] of gainedEdges(piece, ring, x)) {
            const key = `${like.group}|${x}|${Math.round(ya * 100)}|${Math.round(yb * 100)}`;
            if (jambKeys.has(key)) continue;
            jambKeys.add(key);
            jambs.push({ op: "add", like: like.id, kind: "line", points: [{ x, y: ya }, { x, y: yb }] });
          }
        }
    } else {
      const seg = cutSegment(part.points, lo, hi);
      if (seg === "untouched") continue;
      const [left, right] = seg;
      if (left && right) {
        sets.push({ op: "set", id: part.id, points: left });
        sets.push({ op: "add", like: part.id, kind: "line", points: right });
      } else if (left || right) {
        sets.push({ op: "set", id: part.id, points: (left ?? right)! });
      } else removes.push({ op: "remove", id: part.id });
    }
  }
  // removes last, so jamb copies can still be drawn like a line that is cut away
  return [...sets, ...jambs, ...removes];
}

/** Closes the opening that lies about a0..a1 (it may reach up to `trim` further each side). */
export function closePlanOpening(parts: readonly PlanPart[], a0: number, a1: number, trim = 60): PlanChange[] {
  const z0 = Math.min(a0, a1) - trim;
  const z1 = Math.max(a0, a1) + trim;
  const mid = (z0 + z1) / 2;
  const inZone = (x: number) => x >= z0 - SAME && x <= z1 + SAME;
  const sets: PlanChange[] = [];
  const removes: PlanChange[] = [];
  const gone = new Set<string>();

  // lines with both ends inside the zone: jambs and returns
  for (const p of parts)
    if (p.kind === "line" && p.points.every((q) => inZone(q.x))) {
      removes.push({ op: "remove", id: p.id });
      gone.add(p.id);
    }

  // polygons: a left piece (bulk left of the zone) and a right piece (bulk right of it) of one group
  type Side = { part: PlanPart; ring: Pt[]; y0: number; y1: number; minIn: number; maxIn: number };
  const lefts: Side[] = [];
  const rights: Side[] = [];
  for (const part of parts) {
    if (part.kind !== "polygon") continue;
    const inside = part.points.filter((q) => inZone(q.x));
    if (!inside.length) continue;
    const xs = part.points.map((q) => q.x);
    const ys = inside.map((q) => q.y);
    const side: Side = {
      part,
      ring: [...part.points],
      y0: Math.min(...ys),
      y1: Math.max(...ys),
      minIn: Math.min(...inside.map((q) => q.x)),
      maxIn: Math.max(...inside.map((q) => q.x)),
    };
    if (Math.min(...xs) < z0) lefts.push(side);
    if (Math.max(...xs) > z1) rights.push(side);
  }
  const usedRight = new Set<Side>();
  for (const L of lefts) {
    let best: Side | null = null;
    let bestD = Infinity;
    for (const R of rights) {
      if (usedRight.has(R) || R.part === L.part || R.part.group !== L.part.group) continue;
      const dy0 = Math.abs(L.y0 - R.y0);
      const dy1 = Math.abs(L.y1 - R.y1);
      if (dy0 > POLY_Y_AGREE || dy1 > POLY_Y_AGREE) continue;
      if (dy0 + dy1 < bestD) {
        bestD = dy0 + dy1;
        best = R;
      }
    }
    if (!best) continue;
    const xa = L.maxIn - SAME;
    const xb = best.minIn + SAME;
    if (!(xb > xa)) continue;
    const ya = Math.min(L.y0, best.y0);
    const yb = Math.max(L.y1, best.y1);
    const rect: Polygon = [
      [
        [xa, ya],
        [xb, ya],
        [xb, yb],
        [xa, yb],
        [xa, ya],
      ],
    ];
    const merged = polygonClipping.union(toPolygon(L.ring), rect, toPolygon(best.ring));
    if (merged.length !== 1 || merged[0].length !== 1) continue;
    let ring = fromRing(merged[0][0]);
    ring = dropCollinear(ring);
    ring = orientLike(ring, signedArea(L.ring));
    usedRight.add(best);
    sets.push({ op: "set", id: L.part.id, points: ring });
    removes.push({ op: "remove", id: best.part.id });
  }

  // lines along the wall: one end in the zone's left half with the rest left of it, and the same
  // group's line at the same y with one end in the right half and the rest right of it
  type Half = { part: PlanPart; far: Pt; inner: Pt; y: number };
  const leftHalf: Half[] = [];
  const rightHalf: Half[] = [];
  for (const p of parts) {
    if (p.kind !== "line" || gone.has(p.id) || p.points.length !== 2) continue;
    const [a, b] = p.points;
    if (Math.abs(a.y - b.y) >= 0.01 * Math.abs(a.x - b.x)) continue;
    const y = (a.y + b.y) / 2;
    for (const [e, f] of [
      [a, b],
      [b, a],
    ]) {
      if (e.x >= z0 - SAME && e.x <= mid && f.x < e.x - SAME) leftHalf.push({ part: p, far: f, inner: e, y });
      if (e.x >= mid && e.x <= z1 + SAME && f.x > e.x + SAME) rightHalf.push({ part: p, far: f, inner: e, y });
    }
  }
  const pairs: { L: Half; R: Half; gap: number }[] = [];
  for (const L of leftHalf)
    for (const R of rightHalf)
      if (L.part !== R.part && L.part.group === R.part.group && Math.abs(L.y - R.y) <= LINE_Y_AGREE)
        pairs.push({ L, R, gap: Math.abs(L.inner.x - R.inner.x) });
  pairs.sort((p, q) => p.gap - q.gap);
  const joinedL = new Set<string>();
  const joinedR = new Set<string>();
  for (const { L, R } of pairs) {
    if (joinedL.has(L.part.id) || joinedR.has(R.part.id)) continue;
    joinedL.add(L.part.id);
    joinedR.add(R.part.id);
    sets.push({ op: "set", id: L.part.id, points: [{ ...L.far }, { ...R.far }] });
    removes.push({ op: "remove", id: R.part.id });
  }
  return [...sets, ...removes];
}

/** The rings of `ring` less the strip lo..hi (all y), or null when the strip doesn't reach it. */
function cutRing(ring: readonly Pt[], lo: number, hi: number): Pt[][] | null {
  const xs = ring.map((p) => p.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (!(minX < hi - SAME && maxX > lo + SAME)) return null;
  const ys = ring.map((p) => p.y);
  const top = Math.max(...ys) + 1;
  const bottom = Math.min(...ys) - 1;
  const strip: Polygon = [
    [
      [lo, bottom],
      [hi, bottom],
      [hi, top],
      [lo, top],
      [lo, bottom],
    ],
  ];
  const out = polygonClipping.difference(toPolygon(ring), strip);
  return rings(out)
    .map((r) => ({ r, lo: Math.min(...r.map((p) => p.x)), hi: Math.max(...r.map((p) => p.x)) }))
    .filter((p) => p.hi - p.lo >= MIN_PIECE)
    .sort((p, q) => p.lo - q.lo)
    .map((p) => p.r);
}

/**
 * A line less the strip lo..hi: [left piece, right piece], each null when there is none; or
 * "untouched" when the line doesn't reach into the strip (a line lying on its edge stays).
 */
function cutSegment(points: readonly Pt[], lo: number, hi: number): "untouched" | [Pt[] | null, Pt[] | null] {
  const [p0, p1] = points;
  const dx = p1.x - p0.x;
  if (Math.max(p0.x, p1.x) <= lo + SAME || Math.min(p0.x, p1.x) >= hi - SAME) return "untouched";
  // the parameter ranges of the line (0 at p0, 1 at p1) left of lo and right of hi
  const left = halfRange(p0.x - lo, dx);
  const right = halfRange(hi - p0.x, -dx);
  const piece = (r: [number, number] | null): Pt[] | null => {
    if (!r || Math.abs(dx) * (r[1] - r[0]) < MIN_PIECE) return null;
    return [at(p0, p1, r[0]), at(p0, p1, r[1])];
  };
  return [piece(left), piece(right)];
}

/** The part of [0, 1] where A + B t <= 0, or null when there is none. */
function halfRange(A: number, B: number): [number, number] | null {
  if (Math.abs(B) < 1e-12) return A <= 0 ? [0, 1] : null;
  if (B > 0) {
    const t = -A / B;
    return t < 0 ? null : [0, Math.min(1, t)];
  }
  const t = -A / B;
  return t > 1 ? null : [Math.max(0, t), 1];
}

const at = (p0: Pt, p1: Pt, t: number): Pt => ({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t });

/** The line of the wall to draw a jamb like: one of its group, else any line of the wall. */
function lineFor(lines: readonly PlanPart[], group: string): PlanPart | undefined {
  return lines.find((l) => l.group === group) ?? lines[0];
}

/** The y ranges of the piece's edges lying on x, that the original ring had no edge covering. */
function gainedEdges(piece: readonly Pt[], original: readonly Pt[], x: number): [number, number][] {
  const have = edgesOn(original, x);
  return edgesOn(piece, x).filter(([ya, yb]) => !have.some(([oa, ob]) => oa <= ya + SAME && ob >= yb - SAME));
}

function edgesOn(ring: readonly Pt[], x: number): [number, number][] {
  const out: [number, number][] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (Math.abs(a.x - x) <= SAME && Math.abs(b.x - x) <= SAME && Math.abs(a.y - b.y) > SAME)
      out.push([Math.min(a.y, b.y), Math.max(a.y, b.y)]);
  });
  return out;
}

/** A polygon-clipping output polygon's outer rings, each without its repeated first point. */
function rings(m: MultiPolygon): Pt[][] {
  return m.map((poly) => fromRing(poly[0])).filter((r) => r.length >= 3);
}

function fromRing(ring: Pair[]): Pt[] {
  const out: Pt[] = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - x) > SAME || Math.abs(last.y - y) > SAME) out.push({ x, y });
  }
  while (out.length > 1 && Math.abs(out[0].x - out[out.length - 1].x) <= SAME && Math.abs(out[0].y - out[out.length - 1].y) <= SAME)
    out.pop();
  return out;
}

function toPolygon(ring: readonly Pt[]): Polygon {
  return [[...ring.map((p): Pair => [p.x, p.y]), [ring[0].x, ring[0].y]]];
}

function signedArea(ring: readonly Pt[]): number {
  let sum = 0;
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.y - b.x * a.y;
  });
  return sum / 2;
}

/** The ring, turned if need be to wind the way `reference` does. */
function orientLike(ring: Pt[], reference: number): Pt[] {
  return signedArea(ring) * reference < 0 ? [...ring].reverse() : ring;
}

/** Drops points lying on the straight line between their neighbours (real corners stay). */
function dropCollinear(ring: Pt[]): Pt[] {
  let out = ring;
  for (let changed = true; changed && out.length > 3; ) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const n = out.length;
      const a = out[(i + n - 1) % n];
      const p = out[i];
      const b = out[(i + 1) % n];
      if (onSegment(p, a, b)) {
        out = out.filter((_, j) => j !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Whether p lies within SAME of the segment ab. */
function onSegment(p: Pt, a: Pt, b: Pt): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (t < 0 || t > 1) return false;
  const cx = a.x + dx * t - p.x;
  const cy = a.y + dy * t - p.y;
  return Math.hypot(cx, cy) <= SAME;
}
