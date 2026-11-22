// Texture coordinates for a mesh's triangles under one of Vectorworks' texture mapping methods.
// Pure functions: no DOM, no three.js, no imports. Lengths are mm and angles radians in this module.
// Every method first finds a surface pair (su, sv) in mm for each corner, then places it on the
// image the way planeUvs does in model3d.ts: offset, rotation, scale, then flip on u.

export interface MapSpec {
  /** the mapping method; Vectorworks' kind 0 with the auto-align flag is "autoPlane" */
  mapType: "plane" | "autoPlane" | "sphere" | "cylinder" | "perimeter" | "surfaceUV";
  /** mm */
  offsetU: number;
  offsetV: number;
  /** 1 = the texture's own size */
  scale: number;
  /** radians */
  rotation: number;
  /** mm: a sphere's or cylinder's radius; 0 or less takes the largest distance from the axis (or centre) */
  radius: number;
  flip: boolean;
  /** autoPlane's "align to longest edge"; surfaceUV ignores it */
  longestEdge: boolean;
  /** accepted for the flag; the mapping rules do not use it */
  worldZ: boolean;
  /** the u, v and w rows (9 numbers) and the offset after them (3): texture-space point t = rows · p + origin */
  axes: readonly number[];
  origin: readonly number[];
  /** the image's size at scale 1, in mm across, and its height over its width */
  imageSize: number;
  aspect: number;
  /** the lower corner autoPlane, surfaceUV and perimeter measure from (their z origin and caps too); when absent, the least x, y and z of the triangles */
  boxMin?: readonly [number, number, number];
  /** the upper corner of the object's box (greatest x, y and z), used by surfaceUV on level faces; when absent, the greatest of `tris` */
  boxMax?: readonly [number, number, number];
  /** surfaceUV only: faces standing on the object's outline (an extrude's sides) take their distance along the outline across and their height up, as perimeter's sides do; level faces and other faces keep surfaceUV's own rules */
  outline?: boolean;
}

/** |n.z| above this is a level face (facing up or down): a cap, for perimeter */
const LEVEL_NZ = 0.999;
const TAU = 2 * Math.PI;
/** node keys in perimeterDistances use this as the stride of a pair of node ids */
const NODE_STRIDE = 67108864;

interface Placement {
  offU: number;
  offV: number;
  cos: number;
  sin: number;
  size: number;
  height: number;
  flip: boolean;
}

interface Frame {
  rows: Float64Array;
  origin: Float64Array;
}

/** Scratch for one texture-space point (rows · p + origin). */
const tp = new Float64Array(3);

/**
 * (u, v) for each corner of `tris` (9 numbers per triangle, in the object's own frame): 6 numbers per
 * triangle, in fractions of the image, v up. Its length is (tris.length / 9) × 6 whatever the geometry;
 * every value is finite (a degenerate triangle with no normal is treated as a level face).
 * Returns zeros when imageSize · scale or aspect is not above zero.
 */
export function mapUvs(tris: Float64Array, spec: MapSpec): Float64Array {
  const n = Math.floor(tris.length / 9);
  const out = new Float64Array(n * 6);
  const size = spec.imageSize * spec.scale;
  if (!(size > 0) || !(spec.aspect > 0)) return out;
  const pl: Placement = {
    offU: spec.offsetU,
    offV: spec.offsetV,
    cos: Math.cos(spec.rotation),
    sin: Math.sin(spec.rotation),
    size,
    height: size * spec.aspect,
    flip: spec.flip,
  };
  const src = finiteCorners(tris, n * 9);
  const lo = lowerCorner(src, n, spec.boxMin);
  const hi = upperCorner(src, n, spec.boxMax);
  switch (spec.mapType) {
    case "plane":
      planeInto(src, n, frameOf(spec), pl, out);
      break;
    case "autoPlane":
      autoPlaneInto(src, n, spec.longestEdge, lo, pl, out);
      break;
    case "surfaceUV":
      if (spec.outline) perimeterInto(src, n, false, lo, pl, out, hi[0], true);
      else autoPlaneInto(src, n, false, lo, pl, out, hi[0]);
      break;
    case "cylinder":
      radialInto(src, n, frameOf(spec), spec.radius, false, pl, out);
      break;
    case "sphere":
      radialInto(src, n, frameOf(spec), spec.radius, true, pl, out);
      break;
    case "perimeter":
      perimeterInto(src, n, spec.longestEdge, lo, pl, out);
      break;
  }
  for (let j = 0; j < out.length; j++) if (!Number.isFinite(out[j])) out[j] = 0;
  return out;
}

/**
 * The arc length along an extrude's outline for each corner of its side triangles: 3 numbers per
 * triangle, in mm, counter-clockwise seen from +z, starting at the outline's lowest (x, then y) point.
 * NaN where a triangle is not a side (a cap, a sloping face or a degenerate triangle). A side's
 * corners all share the one segment, so the distance follows the segment's own direction; a closed
 * outline's last segment ends at its whole length. A closed loop walks counter-clockwise seen from +z
 * (by its signed area in xy), whatever the triangles' winding.
 * With smoothOnly, only the sides on a run of smooth outline (joints turning under 30°) are given, with
 * the distance measured from the run's first point in walk order (see smoothRuns); the rest are NaN.
 */
export function perimeterDistances(tris: Float64Array, smoothOnly = false): Float64Array {
  const n = Math.floor(tris.length / 9);
  const out = new Float64Array(n * 3).fill(NaN);
  if (n === 0) return out;
  const src = finiteCorners(tris, n * 9);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    x0 = Math.min(x0, src[i]);
    y0 = Math.min(y0, src[i + 1]);
    z0 = Math.min(z0, src[i + 2]);
    x1 = Math.max(x1, src[i]);
    y1 = Math.max(y1, src[i + 1]);
    z1 = Math.max(z1, src[i + 2]);
  }
  // corners closer than this in xy are one point; the box's diagonal sets the scale
  const tol = 1e-6 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(tol > 0)) return out;

  // xy points rounded to the tolerance grid, as nodes; segments as edges between nodes
  const nodeIds = new Map<string, number>();
  const vx: number[] = [];
  const vy: number[] = [];
  const nodeOf = (x: number, y: number): number => {
    const key = `${Math.round(x / tol)},${Math.round(y / tol)}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = vx.length;
      nodeIds.set(key, id);
      vx.push(x);
      vy.push(y);
    }
    return id;
  };
  const edgeIds = new Map<number, number>();
  const eA: number[] = [];
  const eB: number[] = [];
  const triEdge = new Int32Array(n).fill(-1);

  for (let t = 0; t < n; t++) {
    const i = 9 * t;
    const ax = src[i], ay = src[i + 1], az = src[i + 2];
    const bx = src[i + 3], by = src[i + 4], bz = src[i + 5];
    const cx = src[i + 6], cy = src[i + 7], cz = src[i + 8];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nX = e1y * e2z - e1z * e2y;
    const nY = e1z * e2x - e1x * e2z;
    const nZ = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nX, nY, nZ);
    const big = Math.max(
      e1x * e1x + e1y * e1y + e1z * e1z,
      e2x * e2x + e2y * e2y + e2z * e2z,
      (e2x - e1x) ** 2 + (e2y - e1y) ** 2 + (e2z - e1z) ** 2,
    );
    // caps, level faces and degenerate triangles are not sides
    if (!(len > 1e-12 * big) || Math.abs(nZ) > LEVEL_NZ * len) continue;

    // the two corners furthest apart in xy make the segment; the third corner must lie on it
    const dAB = (bx - ax) ** 2 + (by - ay) ** 2;
    const dBC = (cx - bx) ** 2 + (cy - by) ** 2;
    const dCA = (ax - cx) ** 2 + (ay - cy) ** 2;
    let px: number, py: number, qx: number, qy: number, rx: number, ry: number;
    if (dAB >= dBC && dAB >= dCA) {
      px = ax; py = ay; qx = bx; qy = by; rx = cx; ry = cy;
    } else if (dBC >= dCA) {
      px = bx; py = by; qx = cx; qy = cy; rx = ax; ry = ay;
    } else {
      px = cx; py = cy; qx = ax; qy = ay; rx = bx; ry = by;
    }
    const segLen = Math.hypot(qx - px, qy - py);
    if (!(segLen > tol)) continue;
    const off = Math.abs((qx - px) * (ry - py) - (qy - py) * (rx - px)) / segLen;
    // a corner off the line means a sloping face: the caller maps it as autoPlane
    if (off > tol) continue;

    const ia = nodeOf(px, py);
    const ib = nodeOf(qx, qy);
    if (ia === ib) continue;
    const lo = Math.min(ia, ib);
    const hi = Math.max(ia, ib);
    const key = lo * NODE_STRIDE + hi;
    let e = edgeIds.get(key);
    if (e === undefined) {
      e = eA.length;
      edgeIds.set(key, e);
      eA.push(lo);
      eB.push(hi);
    }
    triEdge[t] = e;
  }

  const edgeCount = eA.length;
  if (edgeCount === 0) return out;
  const nodeCount = vx.length;
  const deg = new Int32Array(nodeCount);
  for (let e = 0; e < edgeCount; e++) {
    deg[eA[e]]++;
    deg[eB[e]]++;
  }
  const first = new Int32Array(nodeCount + 1);
  for (let v = 0; v < nodeCount; v++) first[v + 1] = first[v] + deg[v];
  const fillAt = Int32Array.from(first.subarray(0, nodeCount));
  const adj = new Int32Array(2 * edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    adj[fillAt[eA[e]]++] = e;
    adj[fillAt[eB[e]]++] = e;
  }

  // walk from open ends first, then from every other point, each in order of x then y
  const order: number[] = [];
  for (let v = 0; v < nodeCount; v++) order.push(v);
  order.sort((p, q) => (deg[p] === 1 ? 0 : 1) - (deg[q] === 1 ? 0 : 1) || vx[p] - vx[q] || vy[p] - vy[q]);

  const used = new Uint8Array(edgeCount);
  const smooth = new Uint8Array(edgeCount);
  const d0 = new Float64Array(edgeCount);
  const fx = new Float64Array(edgeCount);
  const fy = new Float64Array(edgeCount);
  const dirX = new Float64Array(edgeCount);
  const dirY = new Float64Array(edgeCount);
  const stepE: number[] = [];
  const stepFrom: number[] = [];
  const stepTo: number[] = [];
  for (const s of order) {
    let free = false;
    for (let k = first[s]; k < first[s + 1]; k++) {
      if (!used[adj[k]]) {
        free = true;
        break;
      }
    }
    if (!free) continue;
    stepE.length = 0;
    stepFrom.length = 0;
    stepTo.length = 0;
    let cur = s;
    for (;;) {
      let next = -1;
      for (let k = first[cur]; k < first[cur + 1]; k++) {
        if (!used[adj[k]]) {
          next = adj[k];
          break;
        }
      }
      if (next < 0) break;
      used[next] = 1;
      const to = eA[next] === cur ? eB[next] : eA[next];
      stepE.push(next);
      stepFrom.push(cur);
      stepTo.push(to);
      cur = to;
    }
    // a closed loop walks counter-clockwise seen from +z: reverse it when its signed area in xy is negative
    const closed = stepE.length > 0 && stepTo[stepTo.length - 1] === s;
    let area = 0;
    if (closed) {
      for (let i = 0; i < stepE.length; i++) {
        const f = stepFrom[i];
        const g = stepFrom[(i + 1) % stepE.length];
        area += vx[f] * vy[g] - vx[g] * vy[f];
      }
    }
    if (closed && area < 0) {
      stepE.reverse();
      stepFrom.reverse();
      stepTo.reverse();
      for (let i = 0; i < stepE.length; i++) {
        const f = stepFrom[i];
        stepFrom[i] = stepTo[i];
        stepTo[i] = f;
      }
    }
    if (smoothOnly) {
      smoothRuns(vx, vy, stepE, stepFrom, stepTo, closed, d0, fx, fy, dirX, dirY, smooth);
      continue;
    }
    let d = 0;
    for (let i = 0; i < stepE.length; i++) {
      const e = stepE[i];
      const f = stepFrom[i];
      const g = stepTo[i];
      const ex = vx[g] - vx[f];
      const ey = vy[g] - vy[f];
      const sl = Math.hypot(ex, ey);
      d0[e] = d;
      fx[e] = vx[f];
      fy[e] = vy[f];
      dirX[e] = ex / sl;
      dirY[e] = ey / sl;
      d += sl;
    }
  }

  for (let t = 0; t < n; t++) {
    const e = triEdge[t];
    if (e < 0 || (smoothOnly && !smooth[e])) continue;
    for (let k = 0; k < 3; k++) {
      const x = src[9 * t + 3 * k];
      const y = src[9 * t + 3 * k + 1];
      out[3 * t + k] = d0[e] + (x - fx[e]) * dirX[e] + (y - fy[e]) * dirY[e];
    }
  }
  return out;
}

/** Copies the first `count` values with any non-finite one replaced by 0, so the maths stays finite. */
function finiteCorners(tris: Float64Array, count: number): Float64Array {
  let clean = true;
  for (let i = 0; i < count; i++) {
    if (!Number.isFinite(tris[i])) {
      clean = false;
      break;
    }
  }
  if (clean) return tris;
  const copy = tris.slice(0, count);
  for (let i = 0; i < count; i++) if (!Number.isFinite(copy[i])) copy[i] = 0;
  return copy;
}

/** Places a surface pair (su, sv) on the image, as planeUvs does, and writes (u, v) at index j. */
function put(out: Float64Array, j: number, su: number, sv: number, pl: Placement): void {
  const a = su - pl.offU;
  const b = sv - pl.offV;
  let u = (a * pl.cos + b * pl.sin) / pl.size;
  if (pl.flip) u = -u;
  out[j] = u;
  out[j + 1] = (b * pl.cos - a * pl.sin) / pl.height;
}

/** The texture-space rows and origin: missing values take the identity and zero. */
function frameOf(spec: MapSpec): Frame {
  const rows = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  for (let i = 0; i < 9 && i < spec.axes.length; i++) rows[i] = spec.axes[i];
  const origin = new Float64Array(3);
  for (let i = 0; i < 3 && i < spec.origin.length; i++) origin[i] = spec.origin[i];
  return { rows, origin };
}

/** texture-space point of (x, y, z) into tp: rows · p + origin */
function texPoint(f: Frame, x: number, y: number, z: number): void {
  const r = f.rows;
  const o = f.origin;
  tp[0] = r[0] * x + r[1] * y + r[2] * z + o[0];
  tp[1] = r[3] * x + r[4] * y + r[5] * z + o[1];
  tp[2] = r[6] * x + r[7] * y + r[8] * z + o[2];
}

function planeInto(src: Float64Array, n: number, f: Frame, pl: Placement, out: Float64Array): void {
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = 9 * t + 3 * k;
      texPoint(f, src[i], src[i + 1], src[i + 2]);
      put(out, 6 * t + 2 * k, tp[0], tp[1], pl);
    }
  }
}

/**
 * Cylinder (sphere when `sphere`): the angle about the texture-space z axis, times the radius, across;
 * z (sphere: the latitude, times the radius) up. A corner on the axis has no angle of its own and takes
 * the largest angle of the triangle's corners off the axis. Angles unwrap within a triangle.
 */
function radialInto(src: Float64Array, n: number, f: Frame, radius: number, sphere: boolean, pl: Placement, out: Float64Array): void {
  let R = radius;
  if (!(R > 0)) {
    let far = 0;
    for (let i = 0; i < n * 9; i += 3) {
      texPoint(f, src[i], src[i + 1], src[i + 2]);
      const d = sphere ? Math.hypot(tp[0], tp[1], tp[2]) : Math.hypot(tp[0], tp[1]);
      if (d > far) far = d;
    }
    R = far;
  }
  const axisEps = 1e-9 * Math.max(R, 1);
  const ang = [0, 0, 0];
  const rho = [0, 0, 0];
  const lat = [0, 0, 0];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = 9 * t + 3 * k;
      texPoint(f, src[i], src[i + 1], src[i + 2]);
      ang[k] = Math.atan2(tp[1], tp[0]);
      rho[k] = Math.hypot(tp[0], tp[1]);
      lat[k] = sphere ? Math.atan2(tp[2], rho[k]) : tp[2];
    }
    let ref = -Infinity;
    let found = false;
    for (let k = 0; k < 3; k++) {
      if (rho[k] > axisEps && ang[k] > ref) {
        ref = ang[k];
        found = true;
      }
    }
    for (let k = 0; k < 3; k++) if (rho[k] <= axisEps) ang[k] = found ? ref : 0;
    // a corner more than a half turn behind the largest angle moves on by a full turn
    const m = Math.max(ang[0], ang[1], ang[2]);
    for (let k = 0; k < 3; k++) if (m - ang[k] > Math.PI) ang[k] += TAU;
    for (let k = 0; k < 3; k++) {
      put(out, 6 * t + 2 * k, ang[k] * R, sphere ? lat[k] * R : lat[k], pl);
    }
  }
}

/**
 * Each triangle on its own plane: u runs horizontally across the face (ẑ × n, with the sign the
 * horizontalSign rule picks, so a face's image reads the same whichever way its triangles are wound),
 * or, with longest, along its flat face's longest boundary edge (faceEdgeVectors); v runs up the face. Measured from `lo`, the lower corner. A level face (|n.z| above LEVEL_NZ)
 * takes x and y. Triangles with no area count as level.
 */
function autoPlaneInto(src: Float64Array, n: number, longest: boolean, lo: [number, number, number], pl: Placement, out: Float64Array, far?: number): void {
  const lx = lo[0];
  const ly = lo[1];
  const lz = lo[2];
  const face = longest ? faceEdgeVectors(src, n) : null;
  for (let t = 0; t < n; t++) {
    const i = 9 * t;
    const e1x = src[i + 3] - src[i], e1y = src[i + 4] - src[i + 1], e1z = src[i + 5] - src[i + 2];
    const e2x = src[i + 6] - src[i], e2y = src[i + 7] - src[i + 1], e2z = src[i + 8] - src[i + 2];
    const e3x = e2x - e1x, e3y = e2y - e1y, e3z = e2z - e1z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz);
    const l1 = e1x * e1x + e1y * e1y + e1z * e1z;
    const l2 = e2x * e2x + e2y * e2y + e2z * e2z;
    const l3 = e3x * e3x + e3y * e3y + e3z * e3z;
    if (!(len > 1e-12 * Math.max(l1, l2, l3)) || Math.abs(nz) > LEVEL_NZ * len) {
      for (let k = 0; k < 3; k++) {
        // Vectorworks' surface UV runs across a level face from the far side of the object's box: thin panel extrudes in real drawings hold their image flipped with an offset of its width to read the right way round
        const su = far !== undefined ? far - src[i + 3 * k] : src[i + 3 * k] - lx;
        put(out, 6 * t + 2 * k, su, src[i + 3 * k + 1] - ly, pl);
      }
      continue;
    }
    nx /= len;
    ny /= len;
    nz /= len;
    let ux: number;
    let uy: number;
    let uz: number;
    if (longest) {
      let ex: number, ey: number, ez: number;
      if (face && Number.isFinite(face[3 * t])) {
        ex = face[3 * t];
        ey = face[3 * t + 1];
        ez = face[3 * t + 2];
      } else {
        // no boundary edge in its face: the triangle's own longest edge
        let best = signedEdge(e1x, e1y, e1z);
        const c2 = signedEdge(e2x, e2y, e2z);
        if (longerEdge(c2, best)) best = c2;
        const c3 = signedEdge(e3x, e3y, e3z);
        if (longerEdge(c3, best)) best = c3;
        ex = best[0]; ey = best[1]; ez = best[2];
      }
      // the edge's sign: its larger horizontal component positive, or z positive when it is vertical
      if (Math.max(Math.abs(ex), Math.abs(ey)) <= 1e-9) {
        if (ez < 0) {
          ex = -ex; ey = -ey; ez = -ez;
        }
      } else if (horizontalSign(ex, ey) < 0) {
        ex = -ex; ey = -ey; ez = -ez;
      }
      const el = Math.hypot(ex, ey, ez);
      ux = ex / el;
      uy = ey / el;
      uz = ez / el;
    } else {
      // ẑ × n, turned to the sign the rule picks, so the winding does not matter
      const cl = Math.hypot(nx, ny);
      const hs = horizontalSign(-ny, nx);
      ux = (hs * -ny) / cl;
      uy = (hs * nx) / cl;
      uz = 0;
    }
    // v runs up the face: n × u, turned so that it rises (or, for a vertical u, follows the horizontal rule)
    let vx = ny * uz - nz * uy;
    let vy = nz * ux - nx * uz;
    let vz = nx * uy - ny * ux;
    if (Math.abs(vz) > 1e-9) {
      if (vz < 0) {
        vx = -vx; vy = -vy; vz = -vz;
      }
    } else {
      const vs = horizontalSign(vx, vy);
      vx *= vs; vy *= vs;
    }
    for (let k = 0; k < 3; k++) {
      const dx = src[i + 3 * k] - lx;
      const dy = src[i + 3 * k + 1] - ly;
      const dz = src[i + 3 * k + 2] - lz;
      put(out, 6 * t + 2 * k, dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz, pl);
    }
  }
}

/**
 * Perimeter: sides take their arc length along the outline (perimeterDistances) across and z above
 * the lower corner up; caps and any other triangle take autoPlane's coordinates.
 */
function perimeterInto(src: Float64Array, n: number, longest: boolean, lo: [number, number, number], pl: Placement, out: Float64Array, far?: number, smoothOnly = false): void {
  autoPlaneInto(src, n, longest, lo, pl, out, far);
  const dist = perimeterDistances(src, smoothOnly);
  const lz = lo[2];
  for (let t = 0; t < n; t++) {
    if (!Number.isFinite(dist[3 * t]) || !Number.isFinite(dist[3 * t + 1]) || !Number.isFinite(dist[3 * t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      put(out, 6 * t + 2 * k, dist[3 * t + k], src[9 * t + 3 * k + 2] - lz, pl);
    }
  }
}

type V3 = [number, number, number];

/** an edge vector with its sign fixed by the rule: its larger horizontal component positive, or z when it is vertical */
function signedEdge(x: number, y: number, z: number): V3 {
  if (Math.max(Math.abs(x), Math.abs(y)) <= 1e-9) return z < 0 ? [-x, -y, -z] : [x, y, z];
  return horizontalSign(x, y) < 0 ? [-x, -y, -z] : [x, y, z];
}

/**
 * True when edge a is longer than edge b. Equal lengths (within 1e-9 relative) go to the one whose
 * components are larger first in x, then y, then z, so the winding of the triangles does not pick.
 */
function longerEdge(a: V3, b: V3): boolean {
  const la = Math.hypot(a[0], a[1], a[2]);
  const lb = Math.hypot(b[0], b[1], b[2]);
  if (Math.abs(la - lb) > 1e-9 * Math.max(la, lb)) return la > lb;
  const tol = 1e-9 * Math.max(la, lb);
  for (let k = 0; k < 3; k++) if (Math.abs(a[k] - b[k]) > tol) return a[k] > b[k];
  return false;
}

/**
 * +1 or −1: the sign that makes the larger-magnitude of (x, y) positive; when |x| and |y| are equal
 * within 1e-9, the sign that makes x positive.
 */
function horizontalSign(x: number, y: number): number {
  if (Math.abs(Math.abs(x) - Math.abs(y)) <= 1e-9) return x >= 0 ? 1 : -1;
  if (Math.abs(x) > Math.abs(y)) return x > 0 ? 1 : -1;
  return y > 0 ? 1 : -1;
}

/** The upper corner the surface coordinates measure from: the spec's boxMax where given and finite, else the greatest x, y and z of the corners. */
function upperCorner(src: Float64Array, n: number, given: readonly number[] | undefined): [number, number, number] {
  let hx = -Infinity;
  let hy = -Infinity;
  let hz = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    if (src[i] > hx) hx = src[i];
    if (src[i + 1] > hy) hy = src[i + 1];
    if (src[i + 2] > hz) hz = src[i + 2];
  }
  const pick = (v: number | undefined, m: number): number => (v !== undefined && Number.isFinite(v) ? v : m);
  return [pick(given?.[0], hx), pick(given?.[1], hy), pick(given?.[2], hz)];
}

/** cos of 30°: two directions whose dot product is above it turn by less than 30° at their joint */
const SMOOTH_COS = Math.cos(Math.PI / 6);

/**
 * Lays out the walk's steps as runs of smooth outline. A joint turning by less than 30° joins two
 * segments; a run is a maximal chain of segments joined that way, and a segment with no smooth joint
 * is on no run. A run's distances start at its first point in walk order; a closed loop smooth all
 * the way round starts at the walk's start. Sets d0, fx, fy, dirX, dirY per edge, and smooth[e] = 1
 * for the segments on a run.
 */
function smoothRuns(
  vx: number[], vy: number[], stepE: number[], stepFrom: number[], stepTo: number[], closed: boolean,
  d0: Float64Array, fx: Float64Array, fy: Float64Array, dirX: Float64Array, dirY: Float64Array, smooth: Uint8Array,
): void {
  const L = stepE.length;
  const dxs = new Float64Array(L);
  const dys = new Float64Array(L);
  const lens = new Float64Array(L);
  for (let i = 0; i < L; i++) {
    const f = stepFrom[i];
    const g = stepTo[i];
    const ex = vx[g] - vx[f];
    const ey = vy[g] - vy[f];
    const len = Math.hypot(ex, ey);
    lens[i] = len;
    dxs[i] = ex / len;
    dys[i] = ey / len;
  }
  const turnSmooth = (a: number, b: number): boolean => dxs[a] * dxs[b] + dys[a] * dys[b] > SMOOTH_COS;
  // a closed loop that is not smooth all the way round starts at a sharp joint, so no run crosses the start
  let start = 0;
  if (closed) {
    for (let i = 0; i < L; i++) {
      if (!turnSmooth((i - 1 + L) % L, i)) {
        start = i;
        break;
      }
    }
  }
  const idx = new Int32Array(L);
  for (let k = 0; k < L; k++) idx[k] = (start + k) % L;
  let k = 0;
  while (k < L) {
    let end = k;
    while (end + 1 < L && turnSmooth(idx[end], idx[end + 1])) end++;
    const onRun = end > k;
    let acc = 0;
    for (let m = k; m <= end; m++) {
      const i = idx[m];
      const e = stepE[i];
      const f = stepFrom[i];
      d0[e] = acc;
      fx[e] = vx[f];
      fy[e] = vy[f];
      dirX[e] = dxs[i];
      dirY[e] = dys[i];
      smooth[e] = onRun ? 1 : 0;
      acc += lens[i];
    }
    k = end + 1;
  }
}

/**
 * The lower corner the surface coordinates measure from: the spec's boxMin where given and finite,
 * else the least x, y and z of the corners.
 */
function lowerCorner(src: Float64Array, n: number, given: readonly number[] | undefined): [number, number, number] {
  let lx = Infinity;
  let ly = Infinity;
  let lz = Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    if (src[i] < lx) lx = src[i];
    if (src[i + 1] < ly) ly = src[i + 1];
    if (src[i + 2] < lz) lz = src[i + 2];
  }
  const pick = (v: number | undefined, m: number): number => (v !== undefined && Number.isFinite(v) ? v : m);
  return [pick(given?.[0], lx), pick(given?.[1], ly), pick(given?.[2], lz)];
}

/**
 * For each triangle, the edge vector of its flat face's longest boundary edge. A flat face is the set
 * of triangles with the same unit normal (within 1e-4) and the same plane (within 1e-6 × the box
 * diagonal). A boundary edge is one that exactly one triangle of its face uses; edges are keyed by
 * their two rounded end points, whichever order they come in. Ties go to the first edge found.
 * NaN where a triangle is level or degenerate, or its face has no boundary edge.
 */
function faceEdgeVectors(src: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n * 3).fill(NaN);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n * 9; i += 3) {
    x0 = Math.min(x0, src[i]);
    y0 = Math.min(y0, src[i + 1]);
    z0 = Math.min(z0, src[i + 2]);
    x1 = Math.max(x1, src[i]);
    y1 = Math.max(y1, src[i + 1]);
    z1 = Math.max(z1, src[i + 2]);
  }
  const tol = 1e-6 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  if (!(tol > 0)) return out;

  const gid = new Int32Array(n).fill(-1);
  const groups = new Map<string, number>();
  for (let t = 0; t < n; t++) {
    const i = 9 * t;
    const e1x = src[i + 3] - src[i], e1y = src[i + 4] - src[i + 1], e1z = src[i + 5] - src[i + 2];
    const e2x = src[i + 6] - src[i], e2y = src[i + 7] - src[i + 1], e2z = src[i + 8] - src[i + 2];
    const nX = e1y * e2z - e1z * e2y;
    const nY = e1z * e2x - e1x * e2z;
    const nZ = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nX, nY, nZ);
    const big = Math.max(
      e1x * e1x + e1y * e1y + e1z * e1z,
      e2x * e2x + e2y * e2y + e2z * e2z,
      (e2x - e1x) ** 2 + (e2y - e1y) ** 2 + (e2z - e1z) ** 2,
    );
    if (!(len > 1e-12 * big) || Math.abs(nZ) > LEVEL_NZ * len) continue;
    // the normal's sign is fixed by its first non-zero component in the order z, y, x, so both windings group together
    const flip = Math.abs(nZ) > 1e-9 * len ? (nZ < 0 ? -1 : 1) : Math.abs(nY) > 1e-9 * len ? (nY < 0 ? -1 : 1) : nX < 0 ? -1 : 1;
    const nx = (flip * nX) / len, ny = (flip * nY) / len, nz = (flip * nZ) / len;
    const d = nx * src[i] + ny * src[i + 1] + nz * src[i + 2];
    const key = `${Math.round(nx * 1e4)},${Math.round(ny * 1e4)},${Math.round(nz * 1e4)},${Math.round(d / tol)}`;
    let g = groups.get(key);
    if (g === undefined) {
      g = groups.size;
      groups.set(key, g);
    }
    gid[t] = g;
  }

  // a face of one triangle has that triangle's own longest edge, which the caller takes; no edge keys needed
  const size = new Int32Array(groups.size);
  for (let t = 0; t < n; t++) if (gid[t] >= 0) size[gid[t]]++;
  const edges = new Map<string, { g: number; count: number; v: V3 }>();
  const pk = (x: number, y: number, z: number): string => `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
  for (let t = 0; t < n; t++) {
    const g = gid[t];
    if (g < 0 || size[g] < 2) continue;
    const i = 9 * t;
    for (let k = 0; k < 3; k++) {
      const a = i + 3 * k;
      const b = i + 3 * ((k + 1) % 3);
      const p = pk(src[a], src[a + 1], src[a + 2]);
      const q = pk(src[b], src[b + 1], src[b + 2]);
      const key = `${g}|${p < q ? `${p}~${q}` : `${q}~${p}`}`;
      const ed = edges.get(key);
      if (ed) {
        ed.count++;
      } else {
        edges.set(key, {
          g,
          count: 1,
          v: signedEdge(src[b] - src[a], src[b + 1] - src[a + 1], src[b + 2] - src[a + 2]),
        });
      }
    }
  }
  const best: (V3 | undefined)[] = new Array(groups.size);
  for (const ed of edges.values()) {
    if (ed.count !== 1 || !(Math.hypot(ed.v[0], ed.v[1], ed.v[2]) > 0)) continue;
    const cur = best[ed.g];
    if (!cur || longerEdge(ed.v, cur)) best[ed.g] = ed.v;
  }
  for (let t = 0; t < n; t++) {
    const g = gid[t];
    const v = g >= 0 ? best[g] : undefined;
    if (!v) continue;
    out[3 * t] = v[0];
    out[3 * t + 1] = v[1];
    out[3 * t + 2] = v[2];
  }
  return out;
}

/**
 * 1 when triangle t's unit normal has n.z above 0.999 (an up-facing cap), −1 when below −0.999, else 0.
 * A degenerate triangle is 0.
 */
export function capOf(tris: Float64Array, t: number): 1 | -1 | 0 {
  const i = 9 * t;
  if (i < 0 || i + 8 >= tris.length) return 0;
  const e1x = tris[i + 3] - tris[i], e1y = tris[i + 4] - tris[i + 1], e1z = tris[i + 5] - tris[i + 2];
  const e2x = tris[i + 6] - tris[i], e2y = tris[i + 7] - tris[i + 1], e2z = tris[i + 8] - tris[i + 2];
  const nX = e1y * e2z - e1z * e2y;
  const nY = e1z * e2x - e1x * e2z;
  const nZ = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nX, nY, nZ);
  const big = Math.max(
    e1x * e1x + e1y * e1y + e1z * e1z,
    e2x * e2x + e2y * e2y + e2z * e2z,
    (e2x - e1x) ** 2 + (e2y - e1y) ** 2 + (e2z - e1z) ** 2,
  );
  if (!(len > 1e-12 * big)) return 0;
  const nz = nZ / len;
  if (nz > LEVEL_NZ) return 1;
  if (nz < -LEVEL_NZ) return -1;
  return 0;
}
