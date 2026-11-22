// Checks the texture mapping module (mapUvs and perimeterDistances in texcoords.ts) under Node on
// synthetic geometry only. Run from web/:
//   npx tsx src/core/texcoords.check.ts
// Nothing is drawn. Boxes, prisms, cylinders and spheres are built here. The autoPlane-on-a-panel line
// compares with boxMappedUvs in model3d.ts, the logo case that boxUvs.check.ts pins down.

import { capOf, mapUvs, perimeterDistances, type MapSpec } from "./texcoords.ts";
import { boxMappedUvs } from "./model3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps;
const allFinite = (a: ArrayLike<number>): boolean => {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false;
  return true;
};

const BASE: MapSpec = {
  mapType: "plane",
  offsetU: 0,
  offsetV: 0,
  scale: 1,
  rotation: 0,
  radius: 0,
  flip: false,
  longestEdge: false,
  worldZ: false,
  axes: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  origin: [0, 0, 0],
  imageSize: 1000,
  aspect: 0.5,
};
const spec = (p: Partial<MapSpec>): MapSpec => ({ ...BASE, ...p });

type Pt = [number, number, number];

/** appends two triangles (a, b, c) and (a, c, d) of a quad */
function quad(o: number[], a: Pt, b: Pt, c: Pt, d: Pt): void {
  o.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** a box: 12 triangles, counter-clockwise seen from outside */
function box(x0: number, y0: number, z0: number, w: number, d: number, h: number): Float64Array {
  const x1 = x0 + w;
  const y1 = y0 + d;
  const z1 = z0 + h;
  const o: number[] = [];
  quad(o, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // bottom, -z
  quad(o, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // top, +z
  quad(o, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); // front, -y
  quad(o, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]); // back, +y
  quad(o, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]); // left, -x
  quad(o, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); // right, +x
  return Float64Array.from(o);
}

/** the sides of an extruded outline (counter-clockwise seen from +z gives outward normals) */
function prismSides(pts: [number, number][], h: number, o: number[]): void {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = pts[i];
    const [qx, qy] = pts[(i + 1) % n];
    quad(o, [px, py, 0], [qx, qy, 0], [qx, qy, h], [px, py, h]);
  }
}

/** an extruded convex outline: sides and two fan caps (a fan from the first point) */
function prism(pts: [number, number][], h: number): Float64Array {
  const o: number[] = [];
  prismSides(pts, h, o);
  const n = pts.length;
  const [ax, ay] = pts[0];
  for (let i = 1; i + 1 < n; i++) {
    const [bx, by] = pts[i];
    const [cx, cy] = pts[i + 1];
    o.push(ax, ay, 0, cx, cy, 0, bx, by, 0); // bottom, -z
    o.push(ax, ay, h, bx, by, h, cx, cy, h); // top, +z
  }
  return Float64Array.from(o);
}

/** a circle of n facets, counter-clockwise from +x, extruded to h, with its caps */
function cylinderMesh(r: number, h: number, n: number): Float64Array {
  const pts: [number, number][] = [];
  for (let k = 0; k < n; k++) pts.push([r * Math.cos((2 * Math.PI * k) / n), r * Math.sin((2 * Math.PI * k) / n)]);
  return prism(pts, h);
}

/** a latitude and longitude sphere; its poles are exact points, so some triangles have no area */
function sphereMesh(r: number, n: number): Float64Array {
  const m = n / 2;
  const pt = (j: number, k: number): Pt => {
    if (j === 0) return [0, 0, -r];
    if (j === m) return [0, 0, r];
    const phi = -Math.PI / 2 + (Math.PI * j) / m;
    const th = (2 * Math.PI * k) / n;
    return [r * Math.cos(phi) * Math.cos(th), r * Math.cos(phi) * Math.sin(th), r * Math.sin(phi)];
  };
  const o: number[] = [];
  const outward = (a: Pt, b: Pt, c: Pt): void => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cen = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
    if (nx * cen[0] + ny * cen[1] + nz * cen[2] < 0) o.push(...a, ...c, ...b);
    else o.push(...a, ...b, ...c);
  };
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const A = pt(j, k), B = pt(j, k1), C = pt(j + 1, k1), D = pt(j + 1, k);
      outward(A, B, C);
      outward(A, C, D);
    }
  }
  return Float64Array.from(o);
}

interface Corner { x: number; y: number; z: number; u: number; v: number; t: number; k: number }
function corners(tris: Float64Array, uv: Float64Array): Corner[] {
  const list: Corner[] = [];
  for (let t = 0; t < tris.length / 9; t++) {
    for (let k = 0; k < 3; k++) {
      const i = 9 * t + 3 * k;
      list.push({ x: tris[i], y: tris[i + 1], z: tris[i + 2], u: uv[6 * t + 2 * k], v: uv[6 * t + 2 * k + 1], t, k });
    }
  }
  return list;
}

/** the unit normal of triangle t */
function triNormal(tris: Float64Array, t: number): [number, number, number] {
  const i = 9 * t;
  const ux = tris[i + 3] - tris[i], uy = tris[i + 4] - tris[i + 1], uz = tris[i + 5] - tris[i + 2];
  const vx = tris[i + 6] - tris[i], vy = tris[i + 7] - tris[i + 1], vz = tris[i + 8] - tris[i + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** true when every corner of every triangle matches fn(x, y, z) = [u, v] */
function everyCorner(tris: Float64Array, uv: Float64Array, fn: (x: number, y: number, z: number) => [number, number]): boolean {
  for (const c of corners(tris, uv)) {
    const [eu, ev] = fn(c.x, c.y, c.z);
    if (!near(c.u, eu, 1e-9) || !near(c.v, ev, 1e-9)) return false;
  }
  return true;
}

/** the largest spread of u over the corners of a triangle, in u units */
function maxUJumpInTri(uv: Float64Array, t: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 3; k++) {
    lo = Math.min(lo, uv[6 * t + 2 * k]);
    hi = Math.max(hi, uv[6 * t + 2 * k]);
  }
  return hi - lo;
}

/** for every side triangle, u grows along ẑ × n where the xy corners separate */
function neverMirrors(tris: Float64Array, uv: Float64Array, sides: number[]): boolean {
  for (const t of sides) {
    const [nx, ny] = triNormal(tris, t);
    const cx = -ny, cy = nx; // ẑ × n
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const dx = tris[9 * t + 3 * b] - tris[9 * t + 3 * a];
        const dy = tris[9 * t + 3 * b + 1] - tris[9 * t + 3 * a + 1];
        const du = uv[6 * t + 2 * b] - uv[6 * t + 2 * a];
        const s = dx * cx + dy * cy;
        if (Math.abs(s) > 1e-9 && du * s < -1e-9) return false;
      }
    }
  }
  return true;
}

/** side triangles: not level, not degenerate */
function sideTris(tris: Float64Array): number[] {
  const out: number[] = [];
  for (let t = 0; t < tris.length / 9; t++) {
    const i = 9 * t;
    const area = Math.hypot(
      (tris[i + 4] - tris[i + 1]) * (tris[i + 8] - tris[i + 2]) - (tris[i + 5] - tris[i + 2]) * (tris[i + 7] - tris[i + 1]),
      (tris[i + 5] - tris[i + 2]) * (tris[i + 6] - tris[i]) - (tris[i + 3] - tris[i]) * (tris[i + 8] - tris[i + 2]),
      (tris[i + 3] - tris[i]) * (tris[i + 7] - tris[i + 1]) - (tris[i + 4] - tris[i + 1]) * (tris[i + 6] - tris[i]),
    );
    if (area < 1e-9) continue;
    if (Math.abs(triNormal(tris, t)[2]) < 0.999) out.push(t);
  }
  return out;
}

// --- 1. plane, identity axes, zero origin ---------------------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const uv = mapUvs(B, spec({ mapType: "plane" }));
  check(
    uv.length === (B.length / 9) * 6 && allFinite(uv) && everyCorner(B, uv, (x, y) => [x / 1000, y / 500]),
    "plane, identity axes: every corner of a box gets u = x / imageSize, v = y / (imageSize · aspect)",
  );
  // the smear: a side face parallel to z has the same (u, v) at its top and bottom corners
  let smear = true;
  for (const c of corners(B, uv)) {
    if (c.y !== 200) continue;
    for (const d of corners(B, uv)) {
      if (d.y === 200 && d.x === c.x && Math.abs(d.z - c.z) > 1) {
        if (!near(d.u, c.u, 1e-9) || !near(d.v, c.v, 1e-9)) smear = false;
      }
    }
  }
  check(smear, "plane: the front face (parallel to z) has the same (u, v) at its top and bottom corners");
}

// --- 2. plane origin and a vertical plane -------------------------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const shifted = mapUvs(B, spec({ mapType: "plane", origin: [10, 20, 0] }));
  check(
    everyCorner(B, shifted, (x, y) => [(x + 10) / 1000, (y + 20) / 500]),
    "plane with origin (10, 20, 0): the surface shifts by exactly that",
  );
  const vertical = mapUvs(B, spec({ mapType: "plane", axes: [1, 0, 0, 0, 0, 1, 0, 1, 0] }));
  check(
    everyCorner(B, vertical, (x, _y, z) => [x / 1000, z / 500]),
    "plane with axes u = x̂, v = ẑ (a vertical plane): u = x, v = z",
  );
}

// --- 3. placement: offset, scale, rotation, flip, all four ---------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  check(everyCorner(B, mapUvs(B, spec({ offsetU: 250 })), (x, y) => [(x - 250) / 1000, y / 500]),
    "placement: offsetU 250 shifts u by −250 / width");
  check(everyCorner(B, mapUvs(B, spec({ scale: 2 })), (x, y) => [x / 2000, y / 1000]),
    "placement: scale 2 halves u and v");
  check(everyCorner(B, mapUvs(B, spec({ rotation: Math.PI / 2 })), (x, y) => [y / 1000, -x / 500]),
    "placement: rotation 90° maps (su, sv) to u = sv / width, v = −su / height");
  check(everyCorner(B, mapUvs(B, spec({ flip: true })), (x, y) => [-x / 1000, y / 500]),
    "placement: flip negates u only");
  check(
    everyCorner(B, mapUvs(B, spec({ offsetU: 250, offsetV: 100, scale: 2, rotation: Math.PI / 2, flip: true })),
      (x, y) => [-((y - 100) / 2000), -((x - 250) / 1000)]),
    "placement: offset, scale, quarter turn and flip together match the formula by hand",
  );
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  check(
    everyCorner(B, mapUvs(B, spec({ offsetU: 250, offsetV: 100, scale: 2, rotation: Math.PI / 6, flip: true })),
      (x, y) => {
        const a = x - 250, b = y - 100;
        return [-((a * c + b * s) / 2000), (b * c - a * s) / 1000];
      }),
    "placement: all four together at 30° match the formula by hand",
  );
}

// --- 4. autoPlane on a box ----------------------------------------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const uv = mapUvs(B, spec({ mapType: "autoPlane" }));
  const cx = 250, cy = 400, cz = 300;
  let outward = true;
  for (let t = 0; t < B.length / 9; t++) {
    const [nx, ny, nz] = triNormal(B, t);
    const gx = (B[9 * t] + B[9 * t + 3] + B[9 * t + 6]) / 3 - cx;
    const gy = (B[9 * t + 1] + B[9 * t + 4] + B[9 * t + 7]) / 3 - cy;
    const gz = (B[9 * t + 2] + B[9 * t + 5] + B[9 * t + 8]) / 3 - cz;
    if (nx * gx + ny * gy + nz * gz <= 0) outward = false;
  }
  check(outward, "box test data: every triangle is wound counter-clockwise seen from outside");

  let undistorted = true;
  for (let t = 0; t < B.length / 9; t++) {
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const i = 9 * t + 3 * k, j = 9 * t + 3 * k2;
      const l3 = Math.hypot(B[j] - B[i], B[j + 1] - B[i + 1], B[j + 2] - B[i + 2]);
      const du = (uv[6 * t + 2 * k2] - uv[6 * t + 2 * k]) * 1000;
      const dv = (uv[6 * t + 2 * k2 + 1] - uv[6 * t + 2 * k + 1]) * 1000 * 0.5;
      if (!near(l3, Math.hypot(du, dv), 1e-6)) undistorted = false;
    }
  }
  check(undistorted, "autoPlane on a box: every triangle keeps its 3D edge lengths (undistorted, within 1e-6)");

  // whole triangles on one face: the four sides and the top
  const faceTris = (pred: (x: number, y: number, z: number) => boolean): number[] => {
    const out: number[] = [];
    for (let t = 0; t < B.length / 9; t++) {
      let all = true;
      for (let k = 0; k < 3; k++) if (!pred(B[9 * t + 3 * k], B[9 * t + 3 * k + 1], B[9 * t + 3 * k + 2])) all = false;
      if (all) out.push(t);
    }
    return out;
  };
  const cornersOf = (ts: number[]): Corner[] => ts.flatMap((t) => [0, 1, 2].map((k) => ({
    x: B[9 * t + 3 * k], y: B[9 * t + 3 * k + 1], z: B[9 * t + 3 * k + 2],
    u: uv[6 * t + 2 * k], v: uv[6 * t + 2 * k + 1], t, k,
  })));
  // growth(cs, axis, f): over every pair of corners on the face, f grows with the axis
  const grows = (cs: Corner[], axis: "x" | "y" | "z", f: "u" | "v"): boolean =>
    cs.length > 0 && cs.every((a) => cs.every((b) => a[axis] === b[axis] || (b[axis] - a[axis]) * (b[f] - a[f]) > 0));
  const front = cornersOf(faceTris((_x, y) => y === 200));
  const back = cornersOf(faceTris((_x, y) => y === 600));
  const right = cornersOf(faceTris((x) => x === 400));
  const left = cornersOf(faceTris((x) => x === 100));
  check(grows(front, "x", "u") && grows(front, "z", "v"), "autoPlane front face (normal −y): u grows with +x, v with +z");
  check(grows(back, "x", "u") && grows(back, "z", "v"), "autoPlane back face (normal +y): u grows with +x, v with +z");
  check(grows(right, "y", "u") && grows(right, "z", "v"), "autoPlane right face (normal +x): u grows with +y, v with +z");
  check(grows(left, "y", "u") && grows(left, "z", "v"), "autoPlane left face (normal −x): u grows with +y, v with +z");

  const top = cornersOf(faceTris((_x, _y, z) => z === 550));
  const topOk = top.length > 0 && top.every((c) => near(c.u * 1000, c.x - 100, 1e-6) && near(c.v * 500, c.y - 200, 1e-6));
  check(topOk, "autoPlane top face: u = x − min x, v = y − min y");

  const lowerCorner = corners(B, uv).find((c) => c.x === 100 && c.y === 200 && c.z === 50);
  check(!!lowerCorner && near(lowerCorner.u, 0) && near(lowerCorner.v, 0), "autoPlane: the front face's lower corner is (0, 0)");
}

// --- 5. autoPlane on a panel matches boxMappedUvs (the logo case) -------------------------------------
{
  const W = 2126, H = 2400, SIZE = 2128, ASPECT = 1421 / 1259;
  const x0 = 1614, y0 = -170, z0 = 0;
  const P = Float64Array.from([
    x0, y0, z0, x0 + W, y0, z0, x0 + W, y0, z0 + H,
    x0, y0, z0, x0 + W, y0, z0 + H, x0, y0, z0 + H,
  ]);
  const placed = mapUvs(P, spec({ mapType: "autoPlane", offsetU: SIZE, offsetV: 150, scale: 0.8, rotation: 0.3, imageSize: SIZE, aspect: ASPECT }));
  const refPlaced = boxMappedUvs(P, { offsetU: SIZE, offsetV: 150, scaleU: 0.8, scaleV: 0.8, rotation: 0.3 }, SIZE, ASPECT);
  check(
    placed.length === refPlaced.length && placed.every((v, i) => near(v, refPlaced[i], 1e-9)),
    "autoPlane on a panel in the plane y = y0 matches boxMappedUvs with an offset, scale and rotation",
  );
  const plain = mapUvs(P, spec({ mapType: "autoPlane", imageSize: SIZE, aspect: ASPECT }));
  const refPlain = boxMappedUvs(P, { offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1, rotation: 0 }, SIZE, ASPECT);
  check(
    plain.length === refPlain.length && plain.every((v, i) => near(v, refPlain[i], 1e-9)),
    "autoPlane on the same panel with no placement matches boxMappedUvs",
  );
}

// --- 6. autoPlane on a 30° sloping roof face ---------------------------------------------------------
{
  const s = Math.tan(Math.PI / 6);
  const R = Float64Array.from([0, 0, 0, 400, 0, 0, 400, 300, 300 * s, 0, 0, 0, 400, 300, 300 * s, 0, 300, 300 * s]);
  const uv = mapUvs(R, spec({ mapType: "autoPlane" }));
  let undistorted = true;
  for (let t = 0; t < 2; t++) {
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const i = 9 * t + 3 * k, j = 9 * t + 3 * k2;
      const l3 = Math.hypot(R[j] - R[i], R[j + 1] - R[i + 1], R[j + 2] - R[i + 2]);
      const du = (uv[6 * t + 2 * k2] - uv[6 * t + 2 * k]) * 1000;
      const dv = (uv[6 * t + 2 * k2 + 1] - uv[6 * t + 2 * k + 1]) * 1000 * 0.5;
      if (!near(l3, Math.hypot(du, dv), 1e-6)) undistorted = false;
    }
  }
  check(undistorted, "autoPlane on a 30° sloping roof face: undistorted (edge lengths)");
  // corner 0 is the eave (0, 0, 0), corner 2 of triangle 2 is (0, 300, z): v grows up the slope
  const eave = uv[0] === 0 && uv[1] === 0;
  const up = uv[6 * 1 + 2 * 2 + 1] > uv[1] && near(uv[6 * 1 + 2 * 2], uv[0], 1e-9);
  check(eave && up, "autoPlane on the roof: v grows up the slope; u does not change along the eave-ridge direction");
}

// --- 7. longestEdge ----------------------------------------------------------------------------------
{
  // a vertical plane y = 0, turned 25° in its own plane
  const c25 = Math.cos((25 * Math.PI) / 180), s25 = Math.sin((25 * Math.PI) / 180);
  const d = [c25, 0, s25], e = [-s25, 0, c25];
  const P1 = [1000 * d[0], 0, 1000 * d[2]];
  const P2 = [500 * d[0] + 300 * e[0], 0, 500 * d[2] + 300 * e[2]];
  const T = Float64Array.from([0, 0, 0, ...P1, ...P2]);
  const uvL = mapUvs(T, spec({ mapType: "autoPlane", longestEdge: true }));
  const uvD = mapUvs(T, spec({ mapType: "autoPlane", longestEdge: false }));
  const longDu = uvL[2] - uvL[0], longDv = uvL[3] - uvL[1];
  check(near(longDv, 0, 1e-9) && near(longDu, 1, 1e-9), "longestEdge: a triangle turned 25° in its plane runs u along its longest edge (zero v difference)");
  check(!near(uvD[3] - uvD[1], 0, 1e-3), "longestEdge off: the same triangle's long side is not along u (the default runs u horizontal)");
  let undist = true;
  for (let k = 0; k < 3; k++) {
    const k2 = (k + 1) % 3;
    const i = 3 * k, j = 3 * k2;
    const l3 = Math.hypot(T[j] - T[i], T[j + 1] - T[i + 1], T[j + 2] - T[i + 2]);
    const du = (uvL[2 * k2] - uvL[2 * k]) * 1000;
    const dv = (uvL[2 * k2 + 1] - uvL[2 * k + 1]) * 500;
    if (!near(l3, Math.hypot(du, dv), 1e-6)) undist = false;
  }
  check(undist, "longestEdge: the triangle stays undistorted");

  // a rectangle as two triangles, turned 25°: both run u along the long side (the face's longest boundary edge)
  const R2 = [1000 * d[0] + 300 * e[0], 0, 1000 * d[2] + 300 * e[2]];
  const P3 = [300 * e[0], 0, 300 * e[2]];
  const Q = Float64Array.from([0, 0, 0, ...P1, ...R2, 0, 0, 0, ...R2, ...P3]);
  const uvQ = mapUvs(Q, spec({ mapType: "autoPlane", longestEdge: true }));
  // triangle 1: the long side P0 → P1 is corners 0 → 1; triangle 2: R2 → P3 is corners 1 → 2
  const q1u = uvQ[2] - uvQ[0], q1v = uvQ[3] - uvQ[1];
  const q2u = uvQ[6 + 4] - uvQ[6 + 2], q2v = uvQ[6 + 5] - uvQ[6 + 3];
  check(near(q1u, 1, 1e-9) && near(q1v, 0, 1e-9) && near(q2u, -1, 1e-9) && near(q2v, 0, 1e-9),
    "longestEdge per face: both triangles of a 25°-turned rectangle run u along its long side (zero v difference)");

  // an L-shaped flat face in the plane y = 0, split into four triangles (counter-clockwise in its own frame)
  const at = (a: number, b: number): number[] => [a * d[0] + b * e[0], 0, a * d[2] + b * e[2]];
  const Ltris: [number, number][][] = [
    [[0, 0], [4000, 0], [1000, 1000]],
    [[4000, 0], [4000, 1000], [1000, 1000]],
    [[0, 0], [1000, 1000], [1000, 3000]],
    [[0, 0], [1000, 3000], [0, 3000]],
  ];
  const LF = Float64Array.from(Ltris.flatMap((tr) => tr.flatMap(([a, b]) => at(a, b))));
  const luv = mapUvs(LF, spec({ mapType: "autoPlane", longestEdge: true }));
  // one frame over the whole face: u runs along d (the bottom arm, 4 m, the longest outer edge), v along e
  let aligned = true;
  for (let t = 0; t < 4; t++) {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const dp = [0, 1, 2].map((k) => LF[9 * t + 3 * b + k] - LF[9 * t + 3 * a + k]);
        const du = (luv[6 * t + 2 * b] - luv[6 * t + 2 * a]) * 1000;
        const dv = (luv[6 * t + 2 * b + 1] - luv[6 * t + 2 * a + 1]) * 500;
        if (!near(du, dp[0] * d[0] + dp[2] * d[2], 1e-6) || !near(dv, dp[0] * e[0] + dp[2] * e[2], 1e-6)) aligned = false;
      }
    }
  }
  check(aligned, "longestEdge on an L-shaped flat face split into four triangles: every triangle aligns to the L's longest outer edge");

  // a box with longestEdge on stays undistorted
  const BL = box(100, 200, 50, 300, 400, 500);
  const buv = mapUvs(BL, spec({ mapType: "autoPlane", longestEdge: true }));
  let boxUndist = true;
  for (let t = 0; t < BL.length / 9; t++) {
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3;
      const i = 9 * t + 3 * k, j = 9 * t + 3 * k2;
      const l3 = Math.hypot(BL[j] - BL[i], BL[j + 1] - BL[i + 1], BL[j + 2] - BL[i + 2]);
      const du = (buv[6 * t + 2 * k2] - buv[6 * t + 2 * k]) * 1000;
      const dv = (buv[6 * t + 2 * k2 + 1] - buv[6 * t + 2 * k + 1]) * 500;
      if (!near(l3, Math.hypot(du, dv), 1e-6)) boxUndist = false;
    }
  }
  check(boxUndist, "longestEdge on a box: every triangle stays undistorted (edge-length test)");
}

// --- 8. surfaceUV: sides and the roof equal autoPlane; the level faces run from the far side ----------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const s = Math.tan(Math.PI / 6);
  const R = Float64Array.from([0, 0, 0, 400, 0, 0, 400, 300, 300 * s, 0, 0, 0, 400, 300, 300 * s, 0, 300, 300 * s]);
  const sideIdx = (t: number): boolean => [4, 5, 6, 7, 8, 9, 10, 11].includes(t);
  const autoB = mapUvs(B, spec({ mapType: "autoPlane" }));
  const surfB = mapUvs(B, spec({ mapType: "surfaceUV" }));
  const surfBLong = mapUvs(B, spec({ mapType: "surfaceUV", longestEdge: true }));
  const sidesSame = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(sideIdx).every((t) =>
    [0, 1, 2, 3, 4, 5].every((j) => surfB[6 * t + j] === autoB[6 * t + j] && surfBLong[6 * t + j] === autoB[6 * t + j]));
  check(sidesSame, "surfaceUV equals autoPlane (longestEdge off) on the box's four side faces, whichever longestEdge is");
  const autoR = mapUvs(R, spec({ mapType: "autoPlane" }));
  const surfR = mapUvs(R, spec({ mapType: "surfaceUV" }));
  check(surfR.every((v, i) => v === autoR[i]), "surfaceUV equals autoPlane (longestEdge off) on the sloping roof face");
  // the box's top (+z) and bottom (−z) are level: surfaceUV runs su = xmax − x, autoPlane su = x − xmin
  const levelT = [0, 1, 2, 3];
  const xmin = 100, xmax = 400, W = xmax - xmin;
  const topBottomOk = levelT.every((t) => [0, 1, 2].every((k) => {
    const x = B[9 * t + 3 * k];
    return near(surfB[6 * t + 2 * k] * 1000, xmax - x, 1e-6) && near(autoB[6 * t + 2 * k] * 1000, x - xmin, 1e-6)
      && near(surfB[6 * t + 2 * k] + autoB[6 * t + 2 * k], W / 1000, 1e-9);
  }));
  check(topBottomOk, "surfaceUV on the box's top and bottom: su = xmax − x (autoPlane's x − xmin), the two summing to the width");
}

// --- 8a. surfaceUV on a level panel: flipped with an offset of its width, and unflipped ---------------
{
  const x0 = 1614.3, y0 = -170.2, z0 = 3.5;
  const W = 2125.6, D = 2400, S = 2127.7, ASPECT = 1421 / 1259;
  const xmax = x0 + W, ymin = y0;
  // a level panel of two triangles (normal up), at an arbitrary position
  const PL = Float64Array.from([x0, y0, z0, x0 + W, y0, z0, x0 + W, y0 + D, z0, x0, y0, z0, x0 + W, y0 + D, z0, x0, y0 + D, z0]);
  const flipped = mapUvs(PL, spec({ mapType: "surfaceUV", flip: true, offsetU: S, offsetV: 0, imageSize: S, aspect: ASPECT }));
  check(everyCorner(PL, flipped, (x, y) => [(x - (xmax - S)) / S, (y - ymin) / (S * ASPECT)]),
    "surfaceUV on a level panel, flipped with offset = image width: u = (x − (xmax − S)) / S, so it reads (x − xmin)/S + (S − W)/S, v = (y − ymin) / (S·aspect)");
  let grows = true;
  for (let k = 0; k < 6; k++) for (let j = 0; j < 6; j++) {
    const dxk = PL[3 * k] - PL[3 * j];
    const duk = flipped[2 * k] - flipped[2 * j];
    if (Math.abs(dxk) > 1e-9 && duk * dxk <= 0) grows = false;
  }
  check(grows, "surfaceUV flipped panel: the image is not mirrored (every pair of corners, u grows with +x)");
  const plain = mapUvs(PL, spec({ mapType: "surfaceUV", imageSize: S, aspect: ASPECT }));
  check(everyCorner(PL, plain, (x, y) => [(xmax - x) / S, (y - ymin) / (S * ASPECT)]),
    "surfaceUV on a level panel, no flip, no offset: u = (xmax − x) / S, so it grows with −x");
}

// --- 8b. boxMin: a half of a box maps as the whole box does -------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const whole = mapUvs(B, spec({ mapType: "autoPlane" }));
  const half = B.subarray(9 * 4, 9 * 10);
  const halfUv = mapUvs(half, spec({ mapType: "autoPlane", boxMin: [100, 200, 50] }));
  check(halfUv.length === 36 && halfUv.every((v, i) => near(v, whole[24 + i], 1e-9)),
    "boxMin: half a box's triangles, with boxMin = the whole box's lower corner, get the same uvs as the whole box");

  // a prism standing on z = 500, and only its top caps: the caps measure from the whole box's bottom with boxMin
  const P = prism([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 2000);
  const Pz = Float64Array.from(P, (v, i) => (i % 3 === 2 ? v + 500 : v));
  const pWhole = mapUvs(Pz, spec({ mapType: "autoPlane" }));
  const caps = Pz.subarray(9 * 10, 9 * 12);
  const capUv = mapUvs(caps, spec({ mapType: "autoPlane", boxMin: [0, 0, 500] }));
  check(capUv.every((v, i) => near(v, pWhole[60 + i], 1e-9)),
    "boxMin: the top caps alone, with boxMin = the whole prism's lower corner, match the whole prism's caps");
  // boxMin moves the origin: a box lower corner at (100, 200, 50) moves a level face's u and v by exactly that
  const shiftedB = mapUvs(B, spec({ mapType: "autoPlane", boxMin: [0, 0, 0] }));
  const topT = [2, 3];
  const topShift = topT.every((t) => [0, 1, 2].every((k) =>
    near(shiftedB[6 * t + 2 * k] - whole[6 * t + 2 * k], 100 / 1000, 1e-9) &&
    near(shiftedB[6 * t + 2 * k + 1] - whole[6 * t + 2 * k + 1], 200 / 500, 1e-9)));
  check(topShift, "boxMin moves the origin: with boxMin (0, 0, 0) the top face moves by the box's lower corner over the image size");
}

// --- 8c. capOf ----------------------------------------------------------------------------------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const caps = Array.from({ length: 12 }, (_, t) => capOf(B, t));
  const plus = caps.filter((c) => c === 1).length;
  const minus = caps.filter((c) => c === -1).length;
  const zero = caps.filter((c) => c === 0).length;
  check(plus === 2 && minus === 2 && zero === 8 && caps[0] === -1 && caps[1] === -1 && caps[2] === 1 && caps[3] === 1,
    "capOf on a box: two triangles of +1 (top), two of −1 (bottom), eight of 0");
  check(capOf(Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]), 0) === 0, "capOf: a degenerate triangle is 0");
}

// --- 8d. surfaceUV with an explicit boxMax, for half a box: the same as the whole box -----------------
{
  const B = box(100, 200, 50, 300, 400, 500);
  const whole = mapUvs(B, spec({ mapType: "surfaceUV" }));
  const half = B.subarray(9 * 2, 9 * 6);   // the top and the front: a level face and a side
  const halfUv = mapUvs(half, spec({ mapType: "surfaceUV", boxMin: [100, 200, 50], boxMax: [400, 600, 550] }));
  check(halfUv.length === 24 && halfUv.every((v, i) => near(v, whole[12 + i], 1e-9)),
    "surfaceUV: half a box's triangles with boxMin and boxMax the whole box's corners give the same uvs as the whole box");
}

// --- 8e. surfaceUV with outline: smooth runs of an outline take their distance along it ---------------
{
  const isCap = (M: Float64Array, t: number): boolean => Math.abs(triNormal(M, t)[2]) > 0.999;
  // the coordinates of a set of triangles: u grows along the outline; a vertex shared by two segments must read one u
  const seamFree = (M: Float64Array, uv: Float64Array, tris: Set<number>, seamXY: [number, number]): { continuous: boolean; spanAtSeam: number } => {
    const groups = new Map<string, { lo: number; hi: number; seam: boolean }>();
    for (const c of corners(M, uv)) {
      if (!tris.has(c.t)) continue;
      const key = `${Math.round(c.x * 1e6)},${Math.round(c.y * 1e6)},${Math.round(c.z * 1e6)}`;
      const onSeam = Math.abs(c.x - seamXY[0]) < 1e-6 && Math.abs(c.y - seamXY[1]) < 1e-6;
      const g = groups.get(key) ?? { lo: Infinity, hi: -Infinity, seam: onSeam };
      g.lo = Math.min(g.lo, c.u);
      g.hi = Math.max(g.hi, c.u);
      groups.set(key, g);
    }
    let continuous = true;
    let spanAtSeam = 0;
    for (const g of groups.values()) {
      if (g.seam) spanAtSeam = g.hi - g.lo;
      else if (g.hi - g.lo > 1e-9) continuous = false;
    }
    return { continuous, spanAtSeam };
  };
  const lowestXY = (pts: [number, number][]): [number, number] => {
    let k = 0;
    for (let j = 1; j < pts.length; j++) {
      if (pts[j][0] < pts[k][0] || (pts[j][0] === pts[k][0] && pts[j][1] < pts[k][1])) k = j;
    }
    return pts[k];
  };
  const polyLength = (pts: [number, number][]): number => {
    let L = 0;
    for (let j = 0; j < pts.length; j++) {
      const a = pts[j], b = pts[(j + 1) % pts.length];
      L += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return L;
  };

  // (a) a 64-sided prism: the whole outline is one smooth run; sides equal perimeter's, caps follow surfaceUV's far side
  const R = 500, N = 64, H = 1000;
  const pts: [number, number][] = [];
  for (let k = 0; k < N; k++) pts.push([R * Math.cos((2 * Math.PI * k) / N), R * Math.sin((2 * Math.PI * k) / N)]);
  const P = prism(pts, H);
  const uvO = mapUvs(P, spec({ mapType: "surfaceUV", outline: true, aspect: 0.5 }));
  const perimUv = mapUvs(P, spec({ mapType: "perimeter", aspect: 0.5 }));
  const plainUv = mapUvs(P, spec({ mapType: "surfaceUV", aspect: 0.5 }));
  const sideSet = new Set(sideTris(P));
  let sidesOk = sideSet.size === 2 * N;
  for (let t = 0; t < P.length / 9; t++) {
    if (isCap(P, t)) continue;
    for (let j = 0; j < 6; j++) if (uvO[6 * t + j] !== perimUv[6 * t + j]) sidesOk = false;
  }
  check(sidesOk, "surfaceUV outline on a 64-sided prism: the sides equal perimeter's sides exactly (one smooth run round the whole loop)");
  const pAll = seamFree(P, uvO, sideSet, lowestXY(pts));
  check(pAll.continuous && near(pAll.spanAtSeam, (N * 2 * R * Math.sin(Math.PI / N)) / 1000, 1e-9),
    "surfaceUV outline on a 64-sided prism: u is continuous at every shared vertical edge, and the seam runs to the outline's whole length");
  let capsOk = true;
  let capCount = 0;
  for (let t = 0; t < P.length / 9; t++) {
    if (!isCap(P, t)) continue;
    capCount++;
    for (let j = 0; j < 6; j++) if (uvO[6 * t + j] !== plainUv[6 * t + j]) capsOk = false;
  }
  check(capsOk && capCount === 2 * (N - 2), "surfaceUV outline on a 64-sided prism: the caps follow surfaceUV's far-side rule");

  // (b) a box: every joint is 90°, so no run: identical to surfaceUV without outline on every triangle
  const B = box(100, 200, 50, 300, 400, 500);
  const bo = mapUvs(B, spec({ mapType: "surfaceUV", outline: true }));
  const bplain = mapUvs(B, spec({ mapType: "surfaceUV" }));
  check(bo.length === bplain.length && bo.every((v, i) => v === bplain[i]),
    "surfaceUV outline on a box: identical to surfaceUV without outline on every triangle (every joint is 90°)");

  // (b2) a rounded rectangle: four straight sides and four quarter-circle fillets of 8 segments, one smooth run
  {
    const W = 1000, Hh = 600, rr = 200, seg = 8;
    const arc = (cx: number, cy: number, a0: number, from: number, to: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let k = from; k <= to; k++) {
        const a = a0 + ((Math.PI / 2) * k) / seg;
        out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
      }
      return out;
    };
    const rounded: [number, number][] = [[rr, 0], [W - rr, 0]];
    rounded.push(...arc(W - rr, rr, -Math.PI / 2, 1, seg));
    rounded.push([W, Hh - rr]);
    rounded.push(...arc(W - rr, Hh - rr, 0, 1, seg));
    rounded.push([rr, Hh]);
    rounded.push(...arc(rr, Hh - rr, Math.PI / 2, 1, seg));
    rounded.push([0, rr]);
    rounded.push(...arc(rr, rr, Math.PI, 1, seg - 1));
    const RR = prism(rounded, 1000);
    const ruv = mapUvs(RR, spec({ mapType: "surfaceUV", outline: true, aspect: 0.5 }));
    const rsides = new Set(sideTris(RR));
    const rs = seamFree(RR, ruv, rsides, lowestXY(rounded));
    check(rs.continuous && near(rs.spanAtSeam, polyLength(rounded) / 1000, 1e-9),
      "surfaceUV outline on a rounded rectangle (fillets of 8 segments): one smooth run; u continuous at every joint, total = the outline's length");
  }

  // (b3) a D: a half circle of 16 segments closed by a straight side (90° joints): the arc is one run, the side is surfaceUV's own
  {
    const RD = 500, nd = 16;
    const arcPts: [number, number][] = [];
    for (let k = 0; k <= nd; k++) arcPts.push([RD * Math.cos((Math.PI * k) / nd), RD * Math.sin((Math.PI * k) / nd)]);
    const o: number[] = [];
    prismSides(arcPts, 1000, o);
    const D = Float64Array.from(o);
    const duv = mapUvs(D, spec({ mapType: "surfaceUV", outline: true, aspect: 0.5 }));
    const dplain = mapUvs(D, spec({ mapType: "surfaceUV", aspect: 0.5 }));
    // the arc's chords: triangles 0 to 31; the straight side (closing the loop): triangles 32 and 33
    const arcTris = new Set<number>();
    for (let t = 0; t < 32; t++) arcTris.add(t);
    const arcLen = nd * 2 * RD * Math.sin(Math.PI / (2 * nd));
    let minU = Infinity, maxU = -Infinity;
    for (const c of corners(D, duv)) if (arcTris.has(c.t)) { minU = Math.min(minU, c.u); maxU = Math.max(maxU, c.u); }
    const arcRun = seamFree(D, duv, arcTris, [-1e9, -1e9]);
    check(arcRun.continuous && near(minU, 0, 1e-9) && near(maxU, arcLen / 1000, 1e-9),
      "surfaceUV outline on a D: the arc is one run, u from 0 to the arc's length, continuous inside it");
    let sideSame = true;
    for (let t = 32; t < 34; t++) for (let j = 0; j < 6; j++) if (duv[6 * t + j] !== dplain[6 * t + j]) sideSame = false;
    check(sideSame, "surfaceUV outline on a D: the straight side equals surfaceUV without outline");
  }

  // (c) outline false is surfaceUV unchanged: on the box and the prism
  const boxNo = mapUvs(B, spec({ mapType: "surfaceUV", outline: false }));
  check(boxNo.every((v, i) => v === bplain[i]), "surfaceUV with outline false on the box: the same as surfaceUV");
  const prismNo = mapUvs(P, spec({ mapType: "surfaceUV", outline: false, aspect: 0.5 }));
  check(prismNo.every((v, i) => v === plainUv[i]), "surfaceUV with outline false on the prism: the same as surfaceUV");

  // (e) a sloping roof face with outline true equals surfaceUV without it
  const tilt = Math.tan(Math.PI / 6);
  const RF = Float64Array.from([0, 0, 0, 400, 0, 0, 400, 300, 300 * tilt, 0, 0, 0, 400, 300, 300 * tilt, 0, 300, 300 * tilt]);
  const roofO = mapUvs(RF, spec({ mapType: "surfaceUV", outline: true }));
  const roofP = mapUvs(RF, spec({ mapType: "surfaceUV" }));
  check(roofO.every((v, i) => v === roofP[i]), "surfaceUV outline on a sloping roof face: equals surfaceUV without outline");
}

// --- 9. perimeter on a square prism ------------------------------------------------------------------
{
  const A = 1000, Hh = 2000;
  const P = prism([[0, 0], [A, 0], [A, A], [0, A]], Hh);
  const uv = mapUvs(P, spec({ mapType: "perimeter" }));
  const auto = mapUvs(P, spec({ mapType: "autoPlane" }));
  const sides = sideTris(P);
  const sideIndex = (t: number): number => {
    const i = 9 * t;
    const xs = [P[i], P[i + 3], P[i + 6]], ys = [P[i + 1], P[i + 4], P[i + 7]];
    if (ys.every((y) => y === 0)) return 0;
    if (xs.every((x) => x === A)) return 1;
    if (ys.every((y) => y === A)) return 2;
    if (xs.every((x) => x === 0)) return 3;
    return -1;
  };
  const spans: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const seen = [false, false, false, false];
  let spanOk = true;
  for (const t of sides) {
    const si = sideIndex(t);
    if (si < 0) { spanOk = false; continue; }
    for (let k = 0; k < 3; k++) {
      const u = uv[6 * t + 2 * k];
      if (!seen[si]) { spans[si] = [u, u]; seen[si] = true; }
      spans[si] = [Math.min(spans[si][0], u), Math.max(spans[si][1], u)];
    }
  }
  for (let i = 0; i < 4; i++) {
    if (!near(spans[i][0], i, 1e-9) || !near(spans[i][1], i + 1, 1e-9)) spanOk = false;
  }
  check(spanOk, "perimeter on a square prism: the four sides' u spans are [0,a], [a,2a], [2a,3a], [3a,4a] (÷ width), counter-clockwise from the lowest corner");
  check(neverMirrors(P, uv, sides), "perimeter: no side mirrors (u grows counter-clockwise, along ẑ × the outward normal)");
  let vOk = true;
  for (const t of sides) for (let k = 0; k < 3; k++) {
    const z = P[9 * t + 3 * k + 2];
    if (!near(uv[6 * t + 2 * k + 1], z / 500, 1e-9)) vOk = false;
  }
  check(vOk, "perimeter: v = z / height runs 0..h on the sides");
  let capsOk = true;
  let caps = 0;
  for (let t = 0; t < P.length / 9; t++) {
    if (Math.abs(triNormal(P, t)[2]) <= 0.999) continue;
    caps++;
    for (let j = 0; j < 6; j++) if (uv[6 * t + j] !== auto[6 * t + j]) capsOk = false;
  }
  check(capsOk && caps > 0, "perimeter: the caps equal autoPlane's");
}

// --- 10. perimeter: continuity, concave and holed outlines -------------------------------------------
{
  const R = 500, N = 64, H = 1000;
  const pts: [number, number][] = [];
  for (let k = 0; k < N; k++) pts.push([R * Math.cos((2 * Math.PI * k) / N), R * Math.sin((2 * Math.PI * k) / N)]);
  const o: number[] = [];
  prismSides(pts, H, o);
  const M = Float64Array.from(o);
  const uv = mapUvs(M, spec({ mapType: "perimeter" }));
  const total = N * 2 * R * Math.sin(Math.PI / N);
  // the walk starts at the lowest (x, then y) point, which is the seam
  let seam = 0;
  for (let k = 1; k < N; k++) {
    if (pts[k][0] < pts[seam][0] || (pts[k][0] === pts[seam][0] && pts[k][1] < pts[seam][1])) seam = k;
  }
  const groups = new Map<string, { lo: number; hi: number; seam: boolean }>();
  for (const c of corners(M, uv)) {
    const key = `${Math.round(c.x * 1e6)},${Math.round(c.y * 1e6)},${Math.round(c.z * 1e6)}`;
    const onSeam = Math.abs(c.x - pts[seam][0]) < 1e-6 && Math.abs(c.y - pts[seam][1]) < 1e-6;
    const g = groups.get(key) ?? { lo: Infinity, hi: -Infinity, seam: onSeam };
    g.lo = Math.min(g.lo, c.u);
    g.hi = Math.max(g.hi, c.u);
    groups.set(key, g);
  }
  let continuous = true;
  let seamJump = false;
  for (const g of groups.values()) {
    if (g.seam) {
      if (near(g.hi - g.lo, total / 1000, 1e-9)) seamJump = true;
    } else if (g.hi - g.lo > 1e-9) {
      continuous = false;
    }
  }
  check(continuous, "perimeter on a 64-sided prism: each shared vertex has one u from both facets (continuous)");
  check(seamJump, "perimeter on a 64-sided prism: the one seam runs from 0 to the whole perimeter");
  let maxU = -Infinity;
  for (const c of corners(M, uv)) maxU = Math.max(maxU, c.u);
  check(near(maxU, total / 1000, 1e-9), "perimeter on a 64-sided prism: the total is the polygon's perimeter");

  // an L-shaped outline: a concave outline's total is its length
  const L: [number, number][] = [[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 4000], [0, 4000]];
  const lo: number[] = [];
  prismSides(L, 1000, lo);
  const LM = Float64Array.from(lo);
  const luv = mapUvs(LM, spec({ mapType: "perimeter" }));
  let lMax = -Infinity;
  let lMin = Infinity;
  for (const c of corners(LM, luv)) {
    lMax = Math.max(lMax, c.u);
    lMin = Math.min(lMin, c.u);
  }
  check(near(lMax, 16, 1e-9) && near(lMin, 0, 1e-9) && neverMirrors(LM, luv, sideTris(LM)),
    "perimeter on an L-shaped prism: the outline's total (16 m here) is its length, and no side mirrors");

  // a square with a square hole: both loops map, with no NaN and each loop's own total
  const outer: [number, number][] = [[0, 0], [4000, 0], [4000, 4000], [0, 4000]];
  const hole: [number, number][] = [[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]].reverse() as [number, number][];
  const ho: number[] = [];
  prismSides(outer, 1000, ho);
  prismSides(hole, 1000, ho);
  const HM = Float64Array.from(ho);
  const huv = mapUvs(HM, spec({ mapType: "perimeter" }));
  let holeLo = Infinity;
  let holeHi = -Infinity;
  let outerHi = -Infinity;
  for (const c of corners(HM, huv)) {
    if (c.x >= 1000 && c.x <= 2000 && c.y >= 1000 && c.y <= 2000) {
      holeLo = Math.min(holeLo, c.u);
      holeHi = Math.max(holeHi, c.u);
    } else {
      outerHi = Math.max(outerHi, c.u);
    }
  }
  check(allFinite(huv) && near(holeHi - holeLo, 4, 1e-9) && near(outerHi, 16, 1e-9),
    "perimeter on a prism with a hole: both loops map with no NaN; the hole's own total is 4 m, the outline's 16 m (the hole walks counter-clockwise too)");
}

// --- 11. cylinder ------------------------------------------------------------------------------------
{
  const R = 500, Hc = 1000, N = 64;
  const C = cylinderMesh(R, Hc, N);
  const cs = spec({ mapType: "cylinder", radius: R, aspect: 1 });
  const uv = mapUvs(C, cs);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of corners(C, uv)) {
    uMin = Math.min(uMin, c.u); uMax = Math.max(uMax, c.u);
    vMin = Math.min(vMin, c.v); vMax = Math.max(vMax, c.v);
  }
  const span = uMax - uMin;
  const want = (2 * Math.PI * R) / 1000;
  check(Math.abs(span - want) <= (2 * Math.PI * R) / N / 1000 + 1e-9, "cylinder: the u span around is 2πr / width, within the facet error");
  check(near(vMax - vMin, Hc / 1000, 1e-9), "cylinder: the v span is h / height");
  const uv0 = mapUvs(C, spec({ mapType: "cylinder", radius: 0, aspect: 1 }));
  check(uv0.every((v, i) => near(v, uv[i], 1e-9)), "cylinder: radius 0 falls back to the radius r");
  let seamOk = true;
  for (const t of sideTris(C)) {
    if (maxUJumpInTri(uv, t) > (Math.PI * R) / 1000 + 1e-9) seamOk = false;
  }
  check(seamOk, "cylinder: no side triangle has a u jump greater than half the circumference (the 2π rule)");
  check(allFinite(uv), "cylinder: every value finite");
}

// --- 12. sphere --------------------------------------------------------------------------------------
{
  const R = 500, N = 32;
  const S = sphereMesh(R, N);
  const uv = mapUvs(S, spec({ mapType: "sphere", radius: R, aspect: 1 }));
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (const c of corners(S, uv)) {
    uMin = Math.min(uMin, c.u); uMax = Math.max(uMax, c.u);
    vMin = Math.min(vMin, c.v); vMax = Math.max(vMax, c.v);
  }
  check(near(vMin, (-Math.PI / 2) * R / 1000, 1e-9) && near(vMax, (Math.PI / 2) * R / 1000, 1e-9),
    "sphere: v spans −π/2·r .. π/2·r (÷ height)");
  check(Math.abs(uMax - uMin - (2 * Math.PI * R) / 1000) <= (2 * Math.PI * R) / N / 1000 + 1e-9,
    "sphere: the u span is 2πr (÷ width), within the facet error");
  let seamOk = true;
  for (let t = 0; t < S.length / 9; t++) if (maxUJumpInTri(uv, t) > (Math.PI * R) / 1000 + 1e-9) seamOk = false;
  check(seamOk, "sphere: no triangle has a u jump greater than half the circumference (the 2π rule), poles included");
  check(allFinite(uv), "sphere: every value finite, poles included");
}

// --- 13. degenerate input ----------------------------------------------------------------------------
{
  const types: MapSpec["mapType"][] = ["plane", "autoPlane", "surfaceUV", "sphere", "cylinder", "perimeter"];
  const degenerate = Float64Array.from([
    0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 1, 0, 0, 2, 0, 0,
    5, 5, 5, 5, 5, 5, 5, 5, 6,
  ]);
  const one = Float64Array.from([0, 0, 0, 1000, 0, 0, 0, 1000, 500]);
  const empty = new Float64Array(0);
  const nanTri = Float64Array.from([NaN, 0, 0, 1, 0, 0, 0, 1, 0]);
  let ok = true;
  const lines: string[] = [];
  for (const mapType of types) {
    const sp = spec({ mapType, radius: 300 });
    const a = mapUvs(degenerate, sp);
    const b = mapUvs(one, sp);
    const c = mapUvs(empty, sp);
    const d = mapUvs(nanTri, sp);
    const good = a.length === 18 && b.length === 6 && c.length === 0 && d.length === 6 && allFinite(a) && allFinite(b) && allFinite(d);
    if (!good) lines.push(mapType);
    ok = ok && good;
  }
  check(ok, `degenerate input (zero-area, collinear, a single triangle, empty, NaN corner): right lengths, no NaN${lines.length ? ` (failed: ${lines.join(", ")})` : ""}`);
  const zero = mapUvs(one, spec({ mapType: "autoPlane", imageSize: 0 }));
  const neg = mapUvs(one, spec({ mapType: "autoPlane", scale: -1 }));
  const flat = mapUvs(one, spec({ mapType: "autoPlane", aspect: 0 }));
  check(zero.every((v) => v === 0) && neg.every((v) => v === 0) && flat.every((v) => v === 0),
    "imageSize · scale ≤ 0 or aspect ≤ 0: all zeros");
}

// --- 13b. the same surface wound either way: every mapping gives the same uvs ----------------------
// swapped: corners 2 and 3 of each triangle exchanged (the same surface, the opposite winding)
function swapped(M: Float64Array, which: (t: number) => boolean = () => true): Float64Array {
  const out = Float64Array.from(M);
  for (let t = 0; t < M.length / 9; t++) {
    if (!which(t)) continue;
    for (let j = 0; j < 3; j++) {
      const a = 9 * t + 3 + j;
      const b = 9 * t + 6 + j;
      const f = out[a];
      out[a] = out[b];
      out[b] = f;
    }
  }
  return out;
}
/** the uvs of a swapped mesh, read back in the original corner order */
function unswapUv(uv: Float64Array, which: (t: number) => boolean = () => true): Float64Array {
  const out = Float64Array.from(uv);
  for (let t = 0; t < uv.length / 6; t++) {
    if (!which(t)) continue;
    out[6 * t + 2] = uv[6 * t + 4];
    out[6 * t + 3] = uv[6 * t + 5];
    out[6 * t + 4] = uv[6 * t + 2];
    out[6 * t + 5] = uv[6 * t + 3];
  }
  return out;
}
/** true when mapping M and its swapped copy give the same uvs, corner by corner */
function sameEitherWay(M: Float64Array, sp: MapSpec, which: (t: number) => boolean = () => true): boolean {
  const a = mapUvs(M, sp);
  const b = unswapUv(mapUvs(swapped(M, which), sp), which);
  return a.length === b.length && a.every((v, i) => near(v, b[i], 1e-9));
}
{
  const tilt = Math.tan(Math.PI / 6);
  const roof = Float64Array.from([0, 0, 0, 400, 0, 0, 400, 300, 300 * tilt, 0, 0, 0, 400, 300, 300 * tilt, 0, 300, 300 * tilt]);
  const panelW = Float64Array.from([1614, -170, 0, 1614 + 2126, -170, 0, 1614 + 2126, -170, 2400, 1614, -170, 0, 1614 + 2126, -170, 2400, 1614, -170, 2400]);
  const fixtures: [string, Float64Array][] = [
    ["box", box(100, 200, 50, 300, 400, 500)],
    ["roof", roof],
    ["panel", panelW],
    ["square prism", prism([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 2000)],
    ["L-shaped prism", (() => { const o: number[] = []; prismSides([[0, 0], [4000, 0], [4000, 1000], [1000, 1000], [1000, 3000], [0, 3000]], 1000, o); return Float64Array.from(o); })()],
    ["64-gon cylinder", cylinderMesh(500, 1000, 64)],
    ["sphere", sphereMesh(500, 32)],
  ];
  const types: [string, Partial<MapSpec>][] = [
    ["plane", { mapType: "plane" }],
    ["autoPlane", { mapType: "autoPlane" }],
    ["autoPlane longestEdge", { mapType: "autoPlane", longestEdge: true }],
    ["surfaceUV", { mapType: "surfaceUV" }],
    ["surfaceUV outline", { mapType: "surfaceUV", outline: true }],
    ["perimeter", { mapType: "perimeter" }],
    ["cylinder", { mapType: "cylinder", radius: 500 }],
    ["sphere", { mapType: "sphere", radius: 500 }],
  ];
  for (const [tName, tp] of types) {
    const bad = fixtures.filter(([, M]) => !sameEitherWay(M, spec(tp))).map(([n]) => n);
    check(bad.length === 0, `${tName}: the same uvs whichever way the triangles are wound (box, roof, panel, prism, L, cylinder, sphere)${bad.length ? `; differs on ${bad.join(", ")}` : ""}`);
  }
  // a box whose caps only are inside out
  const capsOnly = (t: number): boolean => t < 4;
  const bx = box(100, 200, 50, 300, 400, 500);
  const capTypes: [string, Partial<MapSpec>][] = [
    ["plane", { mapType: "plane" }],
    ["autoPlane", { mapType: "autoPlane" }],
    ["autoPlane longestEdge", { mapType: "autoPlane", longestEdge: true }],
    ["surfaceUV", { mapType: "surfaceUV" }],
    ["perimeter", { mapType: "perimeter" }],
  ];
  check(capTypes.every(([, tp]) => sameEitherWay(bx, spec(tp), capsOnly)),
    "a box with only its caps inside out: plane, autoPlane (both), surfaceUV and perimeter give the same uvs");
  // the square prism's spans, counter-clockwise from the lowest corner, for both windings
  const sq = prism([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], 2000);
  for (const [label, M] of [["outward", sq], ["inward", swapped(sq)]] as const) {
    const uvS = mapUvs(M, spec({ mapType: "perimeter" }));
    const sd = sideTris(M);
    const spanOf = new Array<[number, number]>(4).fill([Infinity, -Infinity]);
    for (const t of sd) {
      const i = 9 * t;
      const xs = [M[i], M[i + 3], M[i + 6]], ys = [M[i + 1], M[i + 4], M[i + 7]];
      const si = ys.every((y) => y === 0) ? 0 : xs.every((x) => x === 1000) ? 1 : ys.every((y) => y === 1000) ? 2 : xs.every((x) => x === 0) ? 3 : -1;
      if (si < 0) continue;
      for (let k = 0; k < 3; k++) spanOf[si] = [Math.min(spanOf[si][0], uvS[6 * t + 2 * k]), Math.max(spanOf[si][1], uvS[6 * t + 2 * k])];
    }
    check(spanOf.every((sp, i) => near(sp[0], i, 1e-9) && near(sp[1], i + 1, 1e-9)),
      `perimeter on a square prism, ${label} winding: the spans are [0,a], [a,2a], [2a,3a], [3a,4a] counter-clockwise from the lowest corner`);
  }
  // the panel as boxMappedUvs maps it, in both windings
  const SIZE = 2128, ASPECT = 1421 / 1259;
  const pq = mapUvs(panelW, spec({ mapType: "autoPlane", offsetU: SIZE, offsetV: 150, scale: 0.8, rotation: 0.3, imageSize: SIZE, aspect: ASPECT }));
  const pqRef = boxMappedUvs(panelW, { offsetU: SIZE, offsetV: 150, scaleU: 0.8, scaleV: 0.8, rotation: 0.3 }, SIZE, ASPECT);
  const pqSw = unswapUv(mapUvs(swapped(panelW), spec({ mapType: "autoPlane", offsetU: SIZE, offsetV: 150, scale: 0.8, rotation: 0.3, imageSize: SIZE, aspect: ASPECT })));
  const pqSwRef = unswapUv(boxMappedUvs(swapped(panelW), { offsetU: SIZE, offsetV: 150, scaleU: 0.8, scaleV: 0.8, rotation: 0.3 }, SIZE, ASPECT));
  check(pq.every((v, i) => near(v, pqRef[i], 1e-9)) && pqSw.every((v, i) => near(v, pqRef[i], 1e-9)) && pqSwRef.every((v, i) => near(v, pqRef[i], 1e-9)),
    "autoPlane on the logo panel matches boxMappedUvs in both windings");
}

// --- 14. timing: 200,000 random triangles per type; 200,000 side triangles for perimeter --------------
{
  let seed = 12345;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const N = 200000;
  const RT = new Float64Array(N * 9);
  for (let i = 0; i < RT.length; i++) RT[i] = (rnd() * 2 - 1) * 1000;
  const types: MapSpec["mapType"][] = ["plane", "autoPlane", "surfaceUV", "sphere", "cylinder", "perimeter"];
  for (const mapType of types) {
    const t0 = performance.now();
    const o = mapUvs(RT, spec({ mapType, radius: 500 }));
    const ms = performance.now() - t0;
    check(ms <= 2000 && o.length === N * 6 && allFinite(o), `200,000 random triangles, ${mapType}: ${ms.toFixed(0)} ms (limit 2000)`);
  }
  {
    const t2 = performance.now();
    const o = mapUvs(RT, spec({ mapType: "autoPlane", longestEdge: true }));
    const ms = performance.now() - t2;
    check(ms <= 2000 && o.length === N * 6 && allFinite(o), `200,000 random triangles, autoPlane with longestEdge (per flat face): ${ms.toFixed(0)} ms (limit 2000)`);
  }
  const sides = 100000;
  const pts: [number, number][] = [];
  for (let k = 0; k < sides; k++) pts.push([1e5 * Math.cos((2 * Math.PI * k) / sides), 1e5 * Math.sin((2 * Math.PI * k) / sides)]);
  const so: number[] = [];
  prismSides(pts, 1000, so);
  const SM = Float64Array.from(so);
  const t1 = performance.now();
  const suv = mapUvs(SM, spec({ mapType: "perimeter" }));
  const ms1 = performance.now() - t1;
  const perim = sides * 2 * 1e5 * Math.sin(Math.PI / sides);
  let maxU = -Infinity;
  for (let j = 0; j < suv.length; j += 2) maxU = Math.max(maxU, suv[j]);
  check(ms1 <= 2000 && allFinite(suv) && near(maxU, perim / 1000, 1e-6 * (perim / 1000)),
    `perimeter on 200,000 side triangles (a ${sides.toLocaleString("en-US")}-sided prism): ${ms1.toFixed(0)} ms (limit 2000), total correct`);
  // the bare chain, for the record
  const dist = perimeterDistances(SM);
  let maxDist = -Infinity;
  for (const v of dist) if (Number.isFinite(v)) maxDist = Math.max(maxDist, v);
  check(near(maxDist, perim, 1e-6 * perim), "perimeterDistances: the largest arc length is the outline's total");
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
