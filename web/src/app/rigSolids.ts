// What Rigging's tools add in 3D beside their plan (tools/rigging.ts): a straight or curved truss
// hung with its underside at a height, its chords, bars and lacing as tubes in the sections
// rigShapes.ts draws from above; a lighting pipe as a tube along its path; a junction block with its
// chords out along each arm; a base plate; and a tower of truss section standing from a plate. Each
// is faces in the tool's own frame: x and y across the plan from the click, z up from the layer.
// Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { bayStations, junctionProblem, JUNCTION_ARMS, sectionProblem, type CurvedTruss, type JunctionKind, type StraightTruss, type TrussSection } from "./rigShapes.ts";
import { prism, tube, type Point3, type Solid } from "./solids3d.ts";

/** most members a truss is drawn with in 3D: past it the piece is refused, not made slow */
export const MAX_MEMBERS = 4000;
/** the refusal for a truss or tower with more members than that */
export const TOO_MANY_MEMBERS = "The truss has too many members to draw in 3D: set a longer Connection Interval or Ladder Bar Spacing.";
/** facets round a truss member's tube, and round a pipe */
const MEMBER_SIDES = 6;
const PIPE_SIDES = 12;
/** degrees a curved truss's section is sampled in */
const ARC_STEP = 2;

/** A tube of a truss: a path through points, and its diameter. */
export interface Member {
  readonly path: readonly Point3[];
  readonly dia: number;
}

/** The point `s` along a section (from its start), `y` across from its middle (positive to the left) and `z` up from its underside. */
type Frame = (s: number, y: number, z: number) => Point3;

const rad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * A section's members through `frame`, as rigShapes' section draws them from above. A box has four
 * chords, with bars across at top and bottom and lacing zig-zagging down each side; a triangle its
 * apex chord up the middle, bars across the base and lacing on its two slopes; a ladder two chords
 * lying flat at the top, with bars across and lacing corner to corner.
 */
export function sectionMembers(t: TrussSection, length: number, spacing: number, frame: Frame, steps: number): Member[] {
  const c = t.chord;
  const yc = t.width / 2 - c / 2;
  const zb = c / 2;
  const zt = t.width - c / 2;
  const out: Member[] = [];
  const along = (y: number, z: number): Point3[] => Array.from({ length: steps + 1 }, (_, i) => frame((length * i) / steps, y, z));
  const chord = (y: number, z: number): void => {
    out.push({ path: along(y, z), dia: c });
  };
  const xs = bayStations(length, c, spacing);
  const bays = xs.length - 1;
  const bar = (x: number, z: number): void => {
    if (t.ladderBar > 0) out.push({ path: [frame(x, -yc, z), frame(x, yc, z)], dia: t.ladderBar });
  };
  const lace = (a: Point3, b: Point3): void => {
    if (t.lacing > 0) out.push({ path: [a, b], dia: t.lacing });
  };
  if (t.profile === "box") {
    chord(-yc, zb);
    chord(yc, zb);
    chord(-yc, zt);
    chord(yc, zt);
    for (const x of xs) {
      bar(x, zb);
      bar(x, zt);
    }
    for (let i = 0; i < bays; i++) {
      const up = i % 2 === 0;
      const [za, zz] = up ? [zb, zt] : [zt, zb];
      for (const side of [-yc, yc]) lace(frame(xs[i], side, za), frame(xs[i + 1], side, zz));
    }
  } else if (t.profile === "triangle") {
    chord(-yc, zb);
    chord(yc, zb);
    chord(0, zt);
    for (const x of xs) bar(x, zb);
    for (let i = 0; i < bays; i++) {
      if (i % 2 === 0) {
        lace(frame(xs[i], -yc, zb), frame(xs[i + 1], 0, zt));
        lace(frame(xs[i], yc, zb), frame(xs[i + 1], 0, zt));
      } else {
        lace(frame(xs[i], 0, zt), frame(xs[i + 1], -yc, zb));
        lace(frame(xs[i], 0, zt), frame(xs[i + 1], yc, zb));
      }
    }
  } else {
    chord(-yc, zt);
    chord(yc, zt);
    for (const x of xs) bar(x, zt);
    for (let i = 0; i < bays; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      lace(frame(xs[i], s * yc, zt), frame(xs[i + 1], -s * yc, zt));
    }
  }
  return out;
}

/** The members of a straight truss `length` long from the origin along +x, its underside at `height`: sections as straightTruss lays them. */
export function straightTrussMembers(t: StraightTruss, length: number, height: number): Member[] {
  const full = Math.floor(length / t.interval + 1e-9);
  const rest = length - full * t.interval;
  const out: Member[] = [];
  for (let i = 0; i < full; i++) {
    const x0 = i * t.interval;
    out.push(...sectionMembers(t, t.interval, t.ladderSpacing, (s, y, z): Point3 => [x0 + s, y, height + z], 1));
  }
  if (rest > t.chord) {
    const x0 = full * t.interval;
    out.push(...sectionMembers(t, rest, t.ladderSpacing, (s, y, z): Point3 => [x0 + s, y, height + z], 1));
  }
  return out;
}

/** The members of a curved truss round the origin, its arc's middle on +y, its underside at `height`: sections as curvedTruss lays them. */
export function curvedTrussMembers(t: CurvedTruss, height: number): Member[] {
  const mid = t.diameter / 2 - t.width / 2;
  const perDeg = rad(mid);
  const start = 90 - t.totalArc / 2;
  const sectionAt = (from: number, sweep: number): Member[] =>
    sectionMembers(
      t,
      sweep * perDeg,
      t.ladderArc * perDeg,
      (s, y, z): Point3 => {
        const a = rad(from + s / perDeg);
        const r = mid + y;
        return [r * Math.cos(a), r * Math.sin(a), height + z];
      },
      Math.max(2, Math.ceil(sweep / ARC_STEP)),
    );
  const out: Member[] = [];
  const full = Math.floor(t.totalArc / t.segmentArc + 1e-9);
  for (let i = 0; i < full; i++) out.push(...sectionAt(start + i * t.segmentArc, t.segmentArc));
  const rest = t.totalArc - full * t.segmentArc;
  if (rest * perDeg > t.chord) out.push(...sectionAt(start + full * t.segmentArc, rest));
  return out;
}

/** Each member as a tube (degenerate ones left out). */
function membersSolid(members: readonly Member[]): Solid {
  const faces: Solid = [];
  for (const m of members) {
    if (!(m.dia > 0)) continue;
    const a = m.path[0];
    const b = m.path[m.path.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6) continue;
    faces.push(...tube([...m.path], m.dia / 2, false, MEMBER_SIDES));
  }
  return faces;
}

/** A straight truss's solid, or why it can't be drawn in 3D. */
export function straightTrussSolid(t: StraightTruss, length: number, height: number): Solid | string {
  const members = straightTrussMembers(t, length, height);
  return members.length > MAX_MEMBERS ? TOO_MANY_MEMBERS : membersSolid(members);
}

/** A curved truss's solid, or why it can't be drawn in 3D. */
export function curvedTrussSolid(t: CurvedTruss, height: number): Solid | string {
  const members = curvedTrussMembers(t, height);
  return members.length > MAX_MEMBERS ? TOO_MANY_MEMBERS : membersSolid(members);
}

/**
 * A lighting pipe along a clicked path at `height`: a tube its diameter across, closed when the
 * path is; or why it can't be drawn. Repeated points are dropped.
 */
export function pipeSolid(path: readonly Pt[], closed: boolean, diameter: number, height: number): Solid | string {
  if (!(diameter > 0)) return "Set a pipe Diameter over 0.";
  const pts: Pt[] = [];
  for (const p of path) if (!pts.length || Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 1e-6) pts.push(p);
  if (closed && pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop();
  if (pts.length < 2) return "Click points apart for the pipe.";
  return tube(
    pts.map((p): Point3 => [p.x, p.y, height]),
    diameter / 2,
    closed && pts.length > 2,
    PIPE_SIDES,
  );
}

/** Square outline of half-width `h`, centred on the origin. */
const square = (h: number): Pt[] => [
  { x: -h, y: -h },
  { x: h, y: -h },
  { x: h, y: h },
  { x: -h, y: h },
];

/**
 * A junction block of truss `width` and `chord`, its centre at (0, 0) and its underside at `height`:
 * a block a width square and as high, with the chords out along each of its kind's arms, a width
 * beyond the block; or why it can't be drawn.
 */
export function junctionSolid(kind: JunctionKind, width: number, chord: number, height: number): Solid | string {
  const problem = junctionProblem(width, chord);
  if (problem) return problem;
  const h = width / 2;
  const yc = h - chord / 2;
  const members: Member[] = [];
  for (const arm of JUNCTION_ARMS[kind]) {
    // the arm's two across axes, the chords at their corners
    const [u, v] = arm[0] !== 0 ? [[0, 1, 0], [0, 0, 1]] : arm[1] !== 0 ? [[1, 0, 0], [0, 0, 1]] : [[1, 0, 0], [0, 1, 0]];
    for (const a of [-yc, yc]) {
      for (const b of [-yc, yc]) {
        const at = (k: number): Point3 => [u[0] * a + v[0] * b + arm[0] * k, u[1] * a + v[1] * b + arm[1] * k, height + h + u[2] * a + v[2] * b + arm[2] * k];
        members.push({ path: [at(0), at(width)], dia: chord });
      }
    }
  }
  const block = prism([square(h)], height, height + width);
  return [...block, ...membersSolid(members)];
}

/** A base plate `size` square on the layer, `thickness` thick, centred on the origin: or why it can't be drawn. */
export function plateSolid(size: number, thickness: number): Solid | string {
  if (!(size > 0) || !(thickness > 0)) return "Set the plate's Size and Thickness over 0.";
  return prism([square(size / 2)], 0, thickness);
}

/**
 * A tower of truss section `t` standing on a plate `base` thick at the origin, `height` tall above
 * it: four vertical chords, a square of bars at each bay and lacing down each face; or why not.
 */
export function towerSolid(t: TrussSection, height: number, spacing: number, base: number): Solid | string {
  const problem = sectionProblem(t) ?? junctionProblem(t.width, t.chord);
  if (problem) return problem;
  if (!(height > t.chord)) return "Set the tower's Height over the chord width.";
  if (!(spacing > 0)) return "Set the Ladder Bar Spacing over 0.";
  const yc = t.width / 2 - t.chord / 2;
  const top = base + height;
  const zs = bayStations(height, t.chord, spacing).map((z) => base + z);
  const corners: [number, number][] = [
    [-yc, -yc],
    [yc, -yc],
    [yc, yc],
    [-yc, yc],
  ];
  const members: Member[] = corners.map(([x, y]) => ({ path: [[x, y, base], [x, y, top]], dia: t.chord }));
  if (members.length + zs.length * 4 + zs.length * 4 > MAX_MEMBERS) return TOO_MANY_MEMBERS;
  if (t.ladderBar > 0) {
    for (const z of zs) {
      for (let k = 0; k < 4; k++) {
        const [a, b] = corners[k];
        const [c, d] = corners[(k + 1) % 4];
        members.push({ path: [[a, b, z], [c, d, z]], dia: t.ladderBar });
      }
    }
  }
  if (t.lacing > 0) {
    for (let i = 0; i + 1 < zs.length; i++) {
      for (let k = 0; k < 4; k++) {
        const [a, b] = corners[k];
        const [c, d] = corners[(k + 1) % 4];
        const up = i % 2 === 0;
        members.push({ path: up ? [[a, b, zs[i]], [c, d, zs[i + 1]]] : [[c, d, zs[i]], [a, b, zs[i + 1]]], dia: t.lacing });
      }
    }
  }
  return membersSolid(members);
}
