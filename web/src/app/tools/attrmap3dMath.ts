// The arithmetic of the Attribute Mapping tool in the 3D view, as pure functions with no DOM, so
// attrmap3d.check.ts runs them under Node. A textured triangle gives its plane's image: the frame
// (which 3D vectors one image across and one up), the tile under a point (the image's repeat that
// holds it) and the tile's corners. A part's placement follows texcoords.ts:
//
//   a = su − offsetU, b = sv − offsetV
//   u = F·(a·cos r + b·sin r) / W,   v = (b·cos r − a·sin r) / Hh
//
// with F = −1 when the part is flipped, W = imageSize·scale, Hh = W·aspect, r in radians. Moving,
// scaling and turning the tile change the offsets, scale or rotation so the picture follows the
// pointer; each function here returns those new values. Lengths are mm; the placement's rotation is
// in degrees, as the part stores it.

export type V3 = readonly [number, number, number];
export type V2 = readonly [number, number];

/** A part's placement as the tool reads it. */
export interface Placement {
  readonly offsetU: number;
  readonly offsetV: number;
  readonly scale: number;
  /** degrees */
  readonly rotation: number;
  readonly flip: boolean;
}

/** The image a texture shows: its real width in mm at scale 1, and its height over its width. */
export interface ImageSize {
  readonly imageSize: number;
  readonly aspect: number;
}

/**
 * A triangle's plane as the image lies on it: its corner P0 is at (u0, v0), A is the 3D vector for one
 * image across (du = 1) and B for one image up (dv = 1).
 */
export interface Frame {
  readonly P0: V3;
  readonly u0: number;
  readonly v0: number;
  readonly A: V3;
  readonly B: V3;
}

const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const times = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => {
  const d = (r * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
};

/** The frame of a triangle with world corners `P` and their texture coordinates `UV`; null where the uvs don't give a plane (a sliver). */
export function frameOf(P: readonly [V3, V3, V3], UV: readonly [V2, V2, V2]): Frame | null {
  const e1 = sub(P[1], P[0]);
  const e2 = sub(P[2], P[0]);
  const du1 = UV[1][0] - UV[0][0];
  const dv1 = UV[1][1] - UV[0][1];
  const du2 = UV[2][0] - UV[0][0];
  const dv2 = UV[2][1] - UV[0][1];
  const det = du1 * dv2 - dv1 * du2;
  if (!(Math.abs(det) > 1e-9)) return null;
  // e1 = du1·A + dv1·B and e2 = du2·A + dv2·B
  const A = times(sub(times(e1, dv2), times(e2, dv1)), 1 / det);
  const B = times(sub(times(e2, du1), times(e1, du2)), 1 / det);
  return { P0: P[0], u0: UV[0][0], v0: UV[0][1], A, B };
}

/** The coefficients (s, t) with w = s·A + t·B, for w in the plane of A and B; null when A and B are parallel. */
export function coords(w: V3, A: V3, B: V3): V2 | null {
  const aa = dot(A, A);
  const ab = dot(A, B);
  const bb = dot(B, B);
  const det = aa * bb - ab * ab;
  if (!(Math.abs(det) > 1e-12 * aa * bb)) return null;
  const wa = dot(w, A);
  const wb = dot(w, B);
  return [(bb * wa - ab * wb) / det, (aa * wb - ab * wa) / det];
}

/** The texture coordinates of point `Q` on the frame's plane; null when the frame is degenerate. */
export function uvOf(f: Frame, Q: V3): V2 | null {
  const c = coords(sub(Q, f.P0), f.A, f.B);
  return c ? [f.u0 + c[0], f.v0 + c[1]] : null;
}

/** The world point at texture coordinates (a, b) of the frame's plane: P0 + (a − u0)·A + (b − v0)·B. */
export function cornerAt(f: Frame, a: number, b: number): V3 {
  return add(f.P0, add(times(f.A, a - f.u0), times(f.B, b - f.v0)));
}

/** The tile (image repeat) a texture coordinate lies in: k = floor(u), l = floor(v). */
export function tileOf(uv: V2): [number, number] {
  return [Math.floor(uv[0]), Math.floor(uv[1])];
}

/** The four corners of tile (k, l): (k, l), (k + 1, l), (k + 1, l + 1), (k, l + 1). */
export function tileCorners(f: Frame, k: number, l: number): [V3, V3, V3, V3] {
  return [cornerAt(f, k, l), cornerAt(f, k + 1, l), cornerAt(f, k + 1, l + 1), cornerAt(f, k, l + 1)];
}

/** The image's size in surface mm: W across, Hh up. */
export function tileSize(p: Placement, s: ImageSize): { readonly W: number; readonly Hh: number } {
  const W = s.imageSize * p.scale;
  return { W, Hh: W * s.aspect };
}

/** The surface point (su, sv) of texture coordinates (u, v): the placement inverted. */
export function surfaceAt(p: Placement, s: ImageSize, u: number, v: number): V2 {
  const { W, Hh } = tileSize(p, s);
  const F = p.flip ? -1 : 1;
  const r = rad(p.rotation);
  const c = Math.cos(r);
  const sn = Math.sin(r);
  return [p.offsetU + F * W * u * c - Hh * v * sn, p.offsetV + F * W * u * sn + Hh * v * c];
}

/** The texture coordinates (u, v) at surface point (su, sv): texcoords.ts' placement. */
export function uvAtSurface(p: Placement, s: ImageSize, su: number, sv: number): V2 {
  const { W, Hh } = tileSize(p, s);
  const F = p.flip ? -1 : 1;
  const r = rad(p.rotation);
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const a = su - p.offsetU;
  const b = sv - p.offsetV;
  return [(F * (a * c + b * sn)) / W, (b * c - a * sn) / Hh];
}

/**
 * The offsets that move the picture by (du, dv) images along the frame's A and B. Every surface point
 * keeps its place and its texture coordinates drop by (du, dv): the picture has moved under the pointer.
 */
export function moveOffsets(p: Placement, s: ImageSize, du: number, dv: number): { readonly offsetU: number; readonly offsetV: number } {
  const { W, Hh } = tileSize(p, s);
  const F = p.flip ? -1 : 1;
  const r = rad(p.rotation);
  const c = Math.cos(r);
  const sn = Math.sin(r);
  return { offsetU: p.offsetU + F * W * du * c - Hh * dv * sn, offsetV: p.offsetV + F * W * du * sn + Hh * dv * c };
}

/** The surface point of tile corner (k, l) under the placement: its offset from the offsets is (a0, b0). */
function cornerOffset(p: Placement, s: ImageSize, k: number, l: number): { readonly a: number; readonly b: number } {
  const { W, Hh } = tileSize(p, s);
  const F = p.flip ? -1 : 1;
  const r = rad(p.rotation);
  const c = Math.cos(r);
  const sn = Math.sin(r);
  return { a: F * W * k * c - Hh * l * sn, b: F * W * k * sn + Hh * l * c };
}

/**
 * The scale and offsets that scale the tile about its corner (k, l) by `f`: the corner keeps its
 * surface point, and a surface point one tile along u from it now lies one tile of 1/f along.
 */
export function scaleAbout(p: Placement, s: ImageSize, k: number, l: number, f: number): { readonly scale: number; readonly offsetU: number; readonly offsetV: number } {
  const o = cornerOffset(p, s, k, l);
  return { scale: p.scale * f, offsetU: p.offsetU + o.a * (1 - f), offsetV: p.offsetV + o.b * (1 - f) };
}

/**
 * The surface angle (radians) that turns the tile so its first edge lies along the direction (α, β)
 * in its frame's basis, α and β in images: the tile's first edge, seen in surface space, runs at
 * the rotation, and the basis turns with the flip.
 */
export function turnAngle(p: Placement, s: ImageSize, alpha: number, beta: number): number {
  const { W, Hh } = tileSize(p, s);
  const F = p.flip ? -1 : 1;
  return F * Math.atan2(beta * Hh, alpha * W);
}

/**
 * The rotation (degrees) and offsets that turn the tile about its corner (k, l) by `delta` radians of
 * surface angle: the corner keeps its surface point.
 */
export function turnAbout(p: Placement, s: ImageSize, k: number, l: number, delta: number): { readonly rotation: number; readonly offsetU: number; readonly offsetV: number } {
  const before = cornerOffset(p, s, k, l);
  const turned = cornerOffset({ ...p, rotation: p.rotation + (delta * 180) / Math.PI }, s, k, l);
  return { rotation: deg(rad(p.rotation) + delta), offsetU: p.offsetU + before.a - turned.a, offsetV: p.offsetV + before.b - turned.b };
}

/** (α, β) snapped to the nearest `step` radians of direction, keeping its length. */
export function snapDirection(alpha: number, beta: number, step: number): V2 {
  const r = Math.hypot(alpha, beta);
  const t = Math.round(Math.atan2(beta, alpha) / step) * step;
  return [r * Math.cos(t), r * Math.sin(t)];
}

/**
 * The angle (radians) that turns the frame's first edge A onto the direction of `target` about the
 * plane's normal: a rigid turn of the tile's corners by this angle lays its edge along target.
 */
export function spinAngle(f: Frame, target: V3): number {
  const N = cross(f.A, f.B);
  const n = length(N);
  if (!(n > 0)) return 0;
  const axis: V3 = [N[0] / n, N[1] / n, N[2] / n];
  return Math.atan2(dot(axis, cross(f.A, target)), dot(f.A, target));
}

/** The point `x` (world) turned about `axis` (unit) through `angle`, about `centre`. */
export function turnPoint(x: V3, centre: V3, axis: V3, angle: number): V3 {
  const d = sub(x, centre);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const along = dot(axis, d);
  const cr = cross(axis, d);
  return add(centre, [d[0] * c + cr[0] * s + axis[0] * along * (1 - c), d[1] * c + cr[1] * s + axis[1] * along * (1 - c), d[2] * c + cr[2] * s + axis[2] * along * (1 - c)]);
}

/** The unit normal of a frame's plane (A × B normalised), for turnPoint. */
export function frameNormal(f: Frame): V3 {
  const N = cross(f.A, f.B);
  const n = length(N);
  return n > 0 ? [N[0] / n, N[1] / n, N[2] / n] : [0, 0, 1];
}

/** Vector helpers the tool shares with this arithmetic. */
export const vec = { add, sub, times, length, cross };
