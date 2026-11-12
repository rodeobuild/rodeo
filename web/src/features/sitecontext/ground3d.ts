// Site Context in 3D on the ground: water, green spaces, squares, roads, paths and railways as
// surfaces laid on the terrain (the site model's own surface, so they follow it), each a little
// above it so the view does not flicker between them, and the trees as a trunk and a crown. Pure:
// faces as flat x, y, z triples in mm, as EditSession.addMeshes takes them. The writer puts each
// in a group with its plan drawing, so Top/Plan shows the drawing and 3D shows the surface.

import earcut from "earcut";
import type { Pt } from "../../core/index.ts";
import type { Rect } from "./clip.ts";
import type { SiteCategory, SiteGeom } from "./model.ts";
import { dedupe, offsetLine, samePoint } from "./shapes.ts";

/** The ground's height at a point of the drawing, mm; null off its edge. */
export type HeightAt = (x: number, y: number) => number | null;

/** The ground's height at any point, mm: the terrain's, its nearest edge's off it, and 0 without one. */
export type Ground = (x: number, y: number) => number;

/**
 * How far above the ground each kind lies, mm: enough that the view does not flicker between them
 * and the site model, and roads over paths over green over water where they cross. Small beside a
 * person.
 */
export const LIFT: Readonly<Partial<Record<SiteCategory, number>>> = { water: 150, green: 200, paths: 300, roads: 350, rail: 400 };

/** a surface is kept at least this far above the ground, mm: where the ground under a triangle rises closer, it is split */
const CLEAR_MM = 50;
/** ... and the least the ground may rise into its lift before it is, mm (for one laid with almost no lift) */
const LEAST_RISE_MM = 30;
/** a triangle is also split where the ground falls away under it by more than this, mm (it would float) */
const FLOAT_MM = 300;
/** ... down to this size, mm */
const SMALLEST_MM = 1500;
const MOST_SPLITS = 16;

/** trees along a row, mm apart */
export const TREE_SPACING_MM = 8000;

/** A face of three corners: x, y, z each. */
export type Face = number[];

/** The ground under a surface: `lookup` (the site model's surface) inside `box`, else flat at 0. */
export function groundOf(lookup: HeightAt | null, box: Rect | null): Ground {
  if (!lookup) return () => 0;
  let last = 0;
  return (x, y) => {
    let h = lookup(x, y);
    if (h === null && box) {
      // just off the surface (the area's edge, a rounding away): its nearest point inside
      h = lookup(Math.min(box.x1 - 1, Math.max(box.x0 + 1, x)), Math.min(box.y1 - 1, Math.max(box.y0 + 1, y)));
    }
    if (h === null || !Number.isFinite(h)) return last;
    last = h;
    return h;
  };
}

/** Twice the signed area of a triangle in plan: positive when it turns anticlockwise. */
function turn(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

/**
 * A triangle laid on the ground `lift` above it, facing up, split along its longest side wherever
 * the ground under it rises into its lift or falls away from it, so it follows hills, does not sink
 * into them and does not float over hollows. A lift is room to spare: on nearly flat ground (a
 * city's terrain tiles are noisy) the triangles stay whole.
 */
function drape(a: Pt, b: Pt, c: Pt, ground: Ground, lift: number, out: Face[], depth = 0): void {
  const rise = Math.max(lift - CLEAR_MM, LEAST_RISE_MM);
  /** whether the ground at a point is too far from the plane of the corners there (height `plane`) */
  const off = (x: number, y: number, plane: number): boolean => {
    const d = ground(x, y) - plane;
    return d > rise || -d > FLOAT_MM;
  };
  const za = ground(a.x, a.y);
  const zb = ground(b.x, b.y);
  const zc = ground(c.x, c.y);
  if (depth < MOST_SPLITS) {
    const sides: [Pt, Pt, Pt, number, number][] = [
      [a, b, c, za, zb],
      [b, c, a, zb, zc],
      [c, a, b, zc, za],
    ];
    let longest = sides[0];
    let length = 0;
    let bends = false;
    for (const side of sides) {
      const [p, q, , zp, zq] = side;
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      if (l > length) {
        length = l;
        longest = side;
      }
      if (off((p.x + q.x) / 2, (p.y + q.y) / 2, (zp + zq) / 2)) bends = true;
    }
    if (off((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (za + zb + zc) / 3)) bends = true;
    if (bends && length > SMALLEST_MM) {
      const [p, q, r] = longest;
      const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      drape(p, m, r, ground, lift, out, depth + 1);
      drape(m, q, r, ground, lift, out, depth + 1);
      return;
    }
  }
  out.push([a.x, a.y, za + lift, b.x, b.y, zb + lift, c.x, c.y, zc + lift]);
}

/** A triangle laid on the ground facing up, whichever way round its corners come; none when it has no area. */
function upTriangle(a: Pt, b: Pt, c: Pt, ground: Ground, lift: number, out: Face[]): void {
  const t = turn(a, b, c);
  if (Math.abs(t) < 1e-6) return;
  if (t > 0) drape(a, b, c, ground, lift, out);
  else drape(a, c, b, ground, lift, out);
}

/** A ring without its closing point and repeated points. */
function openRing(points: readonly Pt[]): Pt[] {
  const pts = dedupe(points);
  if (pts.length > 1 && samePoint(pts[0], pts[pts.length - 1])) pts.pop();
  return pts;
}

/** An area (its outline, less its holes) laid on the ground. */
export function areaFaces(outer: readonly Pt[], holes: readonly (readonly Pt[])[], ground: Ground, lift: number): Face[] {
  const rings = [openRing(outer), ...holes.map(openRing).filter((h) => h.length >= 3)];
  if (rings[0].length < 3) return [];
  const pts = rings.flat();
  const flat = pts.flatMap((p) => [p.x, p.y]);
  const starts: number[] = [];
  let at = rings[0].length;
  for (const h of rings.slice(1)) {
    starts.push(at);
    at += h.length;
  }
  const out: Face[] = [];
  const tri = earcut(flat, starts.length ? starts : undefined, 2);
  for (let k = 0; k + 2 < tri.length; k += 3) upTriangle(pts[tri[k]], pts[tri[k + 1]], pts[tri[k + 2]], ground, lift, out);
  return out;
}

/** A strip `width` mm wide along a line, laid on the ground. */
export function stripFaces(line: readonly Pt[], width: number, ground: Ground, lift: number): Face[] {
  const left = offsetLine(line, width / 2);
  const right = offsetLine(line, -width / 2);
  const out: Face[] = [];
  for (let i = 0; i + 1 < Math.min(left.length, right.length); i++) {
    upTriangle(right[i], right[i + 1], left[i + 1], ground, lift, out);
    upTriangle(right[i], left[i + 1], left[i], ground, lift, out);
  }
  return out;
}

/** The faces a feature lays on the ground: an area's, or a strip along its line. */
export function groundFaces(geom: SiteGeom, shape: { readonly kind: "area" } | { readonly kind: "strip"; readonly width: number }, ground: Ground, lift: number): Face[] {
  if (shape.kind === "area") {
    if (geom.kind === "polygon") return areaFaces(geom.points, geom.holes ?? [], ground, lift);
    if (geom.kind === "polyline" && geom.closed) return areaFaces(geom.points, [], ground, lift);
    return [];
  }
  if (geom.kind === "band" || geom.kind === "polyline") return stripFaces(geom.points, shape.width, ground, lift);
  return [];
}

/** Where trees stand: at a circle's centre, or every TREE_SPACING_MM along a line, both ends too. */
export function treeSpots(geom: SiteGeom): Pt[] {
  if (geom.kind === "circle") return [geom.at];
  if (geom.kind !== "polyline") return [];
  const pts = dedupe(geom.points);
  if (pts.length === 0) return [];
  const out: Pt[] = [pts[0]];
  let carried = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    let s = TREE_SPACING_MM - carried;
    while (s <= l) {
      out.push({ x: a.x + ((b.x - a.x) * s) / l, y: a.y + ((b.y - a.y) * s) / l });
      s += TREE_SPACING_MM;
    }
    carried = l - (s - TREE_SPACING_MM);
  }
  const end = pts[pts.length - 1];
  if (Math.hypot(end.x - out[out.length - 1].x, end.y - out[out.length - 1].y) > TREE_SPACING_MM / 2) out.push(end);
  return out;
}

/**
 * The tree the import stands at each tree: a six-sided trunk and a round crown `radius` mm across
 * its middle (the canopy's circle in plan), its foot at the origin, faces turning outwards.
 */
export function treeParts(radius = 2500): { trunk: Face[]; crown: Face[] } {
  const trunkR = 180;
  const trunkTop = 2800;
  const trunk: Face[] = [];
  const ring = Array.from({ length: 6 }, (_, k) => {
    const t = (2 * Math.PI * k) / 6;
    return [trunkR * Math.cos(t), trunkR * Math.sin(t)];
  });
  for (let k = 0; k < 6; k++) {
    const [x0, y0] = ring[k];
    const [x1, y1] = ring[(k + 1) % 6];
    trunk.push([x0, y0, 0, x1, y1, 0, x1, y1, trunkTop, x0, y0, trunkTop]);
  }
  trunk.push(ring.flatMap(([x, y]) => [x, y, trunkTop]));
  // the crown: a sphere of 10 slices and 6 bands, its middle 0.8 of its radius over the trunk's top
  const crown: Face[] = [];
  const cz = trunkTop + radius * 0.8;
  const slices = 10;
  const bands = 6;
  const at = (band: number, slice: number): number[] => {
    const phi = (Math.PI * band) / bands;
    const theta = (2 * Math.PI * slice) / slices;
    return [radius * Math.sin(phi) * Math.cos(theta), radius * Math.sin(phi) * Math.sin(theta), cz + radius * Math.cos(phi)];
  };
  for (let b = 0; b < bands; b++) {
    for (let s = 0; s < slices; s++) {
      const p00 = at(b, s);
      const p01 = at(b, s + 1);
      const p10 = at(b + 1, s);
      const p11 = at(b + 1, s + 1);
      // from the top down, anticlockwise seen from outside
      if (b === 0) crown.push([...p00, ...p10, ...p11]);
      else if (b === bands - 1) crown.push([...p00, ...p10, ...p01]);
      else crown.push([...p00, ...p10, ...p11, ...p01]);
    }
  }
  return { trunk, crown };
}
