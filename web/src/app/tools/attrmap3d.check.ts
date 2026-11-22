// Checks the Attribute Mapping tool's 3D arithmetic (attrmap3dMath.ts) on synthetic placements under
// Node. Run from web/:
//   npx tsx src/app/tools/attrmap3d.check.ts
// Every check states what it proves; random placements come from a fixed seed.

import {
  coords,
  cornerAt,
  frameOf,
  moveOffsets,
  scaleAbout,
  snapDirection,
  spinAngle,
  surfaceAt,
  tileCorners,
  tileOf,
  turnAbout,
  turnAngle,
  turnPoint,
  frameNormal,
  uvAtSurface,
  uvOf,
  type ImageSize,
  type Placement,
  type V3,
  type V2,
} from "./attrmap3dMath.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// a small seeded generator, so the random cases are the same every run
let seed = 20261122;
const rand = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const between = (lo: number, hi: number): number => lo + (hi - lo) * rand();
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

/** a random placement and the image it shows */
function randomCase(): { p: Placement; s: ImageSize } {
  return {
    p: {
      offsetU: between(-3000, 3000),
      offsetV: between(-3000, 3000),
      scale: between(0.2, 3),
      rotation: between(-720, 720),
      flip: rand() < 0.5,
    },
    s: { imageSize: pick([500, 1000, 2000]), aspect: pick([0.5, 1, 0.75]) },
  };
}

const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));
const closePair = (a: V2, b: V2, eps = 1e-6): boolean => close(a[0], b[0], eps) && close(a[1], b[1], eps);

// frame: a triangle of the z = 0 plane under a plane placement with no rotation: A is 1000 mm
// across, B is 500 mm up (imageSize 1000, aspect 0.5)
{
  const p: Placement = { offsetU: 0, offsetV: 0, scale: 1, rotation: 0, flip: false };
  const s: ImageSize = { imageSize: 1000, aspect: 0.5 };
  const P: [V3, V3, V3] = [
    [0, 0, 0],
    [1000, 0, 0],
    [0, 500, 0],
  ];
  const UV: [V2, V2, V2] = [uvAtSurface(p, s, 0, 0), uvAtSurface(p, s, 1000, 0), uvAtSurface(p, s, 0, 500)] as [V2, V2, V2];
  const f = frameOf(P, UV);
  check(!!f && close(f.A[0], 1000) && close(f.A[1], 0) && close(f.B[1], 500) && close(f.B[0], 0), "frame of a known triangle: A = (1000, 0, 0), B = (0, 500, 0)");
  check(!!f && closePair(UV[0], [0, 0]) && closePair(UV[1], [1, 0]) && closePair(UV[2], [0, 1]), "frame of a known triangle: its uvs are (0,0), (1,0), (0,1)");
  check(frameOf(P, [[0, 0], [1, 0], [2, 0]]) === null, "frame: uvs on one line give no plane (null)");
}

// frame of random placements: A and B are the surface's own derivatives (A = F·W·(cos r, sin r),
// B = Hh·(−sin r, cos r)) in the z = 0 plane
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const { p, s } = randomCase();
    const P: [V3, V3, V3] = [
      [0, 0, 0],
      [400, 150, 0],
      [-200, 700, 0],
    ];
    const S = P.map((q) => [q[0], q[1]] as V2);
    const UV = S.map((q) => uvAtSurface(p, s, q[0], q[1])) as [V2, V2, V2];
    const f = frameOf(P, UV);
    if (!f) continue;
    const { W, Hh } = { W: s.imageSize * p.scale, Hh: s.imageSize * p.scale * s.aspect };
    const F = p.flip ? -1 : 1;
    const r = (p.rotation * Math.PI) / 180;
    const expectA = [F * W * Math.cos(r), F * W * Math.sin(r), 0];
    const expectB = [-Hh * Math.sin(r), Hh * Math.cos(r), 0];
    for (let k = 0; k < 2; k++) {
      worst = Math.max(worst, Math.abs(f.A[k] - expectA[k]) / W, Math.abs(f.B[k] - expectB[k]) / Hh);
    }
  }
  check(worst < 1e-9, `frame: A and B are the surface derivatives for random placements (worst ${worst.toExponential(2)})`);
}

// the tile corner from the frame equals the surface point of the same texture coordinates
{
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const { p, s } = randomCase();
    const P: [V3, V3, V3] = [
      [10, 20, 0],
      [600, 40, 0],
      [80, 900, 0],
    ];
    const UV = P.map((q) => uvAtSurface(p, s, q[0], q[1])) as [V2, V2, V2];
    const f = frameOf(P, UV);
    if (!f) continue;
    const k = Math.floor(between(-3, 3));
    const l = Math.floor(between(-3, 3));
    const c = cornerAt(f, k, l);
    const want = surfaceAt(p, s, k, l);
    worst = Math.max(worst, Math.abs(c[0] - want[0]), Math.abs(c[1] - want[1]), Math.abs(c[2]));
    // and a point's uv from the frame is the surface's uv
    const q: V3 = [between(0, 500), between(0, 500), 0];
    const uq = uvOf(f, q);
    const wantUv = uvAtSurface(p, s, q[0], q[1]);
    if (!uq || !closePair(uq, wantUv, 1e-7)) worst = Math.max(worst, 1);
  }
  check(worst < 1e-5, `frame: tile corners and point uvs agree with the placement (worst ${worst.toExponential(2)} mm)`);
}

// move: at a fixed surface point the texture coordinates change by (−du, −dv)
{
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const { p, s } = randomCase();
    const du = between(-2.5, 2.5);
    const dv = between(-2.5, 2.5);
    const q = moveOffsets(p, s, du, dv);
    const S: V2 = [between(-5000, 5000), between(-5000, 5000)];
    const before = uvAtSurface(p, s, S[0], S[1]);
    const after = uvAtSurface({ ...p, offsetU: q.offsetU, offsetV: q.offsetV }, s, S[0], S[1]);
    worst = Math.max(worst, Math.abs(after[0] - before[0] + du), Math.abs(after[1] - before[1] + dv));
  }
  check(worst < 1e-9, `move: after the offsets, every fixed point's uv drops by (du, dv) (worst ${worst.toExponential(2)})`);
}

// move in 3D: the picture follows the pointer. A point on the plane moved by D = du·A + dv·B shows the
// same picture point as before, shifted: the uv of the moved point under the new placement equals the uv of the old point
{
  let worst = 0;
  for (let i = 0; i < 100; i++) {
    const { p, s } = randomCase();
    const P: [V3, V3, V3] = [
      [0, 0, 0],
      [1000, 100, 0],
      [-50, 800, 0],
    ];
    const UV = P.map((q) => uvAtSurface(p, s, q[0], q[1])) as [V2, V2, V2];
    const f = frameOf(P, UV)!;
    const du = between(-1, 1);
    const dv = between(-1, 1);
    const moved: V3 = [P[0][0] + du * f.A[0] + dv * f.B[0], P[0][1] + du * f.A[1] + dv * f.B[1], 0];
    const q = moveOffsets(p, s, du, dv);
    const np = { ...p, offsetU: q.offsetU, offsetV: q.offsetV };
    const uvNew = uvAtSurface(np, s, moved[0], moved[1]);
    worst = Math.max(worst, Math.abs(uvNew[0] - UV[0][0]), Math.abs(uvNew[1] - UV[0][1]));
  }
  check(worst < 1e-9, `move: the corner dragged by D lands on the texture point it had (worst ${worst.toExponential(2)})`);
}

// scale: the tile's corner (k, l) keeps its surface point; a surface point one tile along u from it
// now lies 1/f of a tile along u
{
  let cornerErr = 0;
  let edgeErr = 0;
  for (let i = 0; i < 300; i++) {
    const { p, s } = randomCase();
    const k = Math.floor(between(-3, 3));
    const l = Math.floor(between(-3, 3));
    const f = between(0.1, 6);
    const q = scaleAbout(p, s, k, l, f);
    const np = { ...p, scale: q.scale, offsetU: q.offsetU, offsetV: q.offsetV };
    const c0 = surfaceAt(p, s, k, l);
    const c1 = surfaceAt(np, s, k, l);
    cornerErr = Math.max(cornerErr, Math.abs(c0[0] - c1[0]), Math.abs(c0[1] - c1[1]));
    const one = surfaceAt(p, s, k + 1, l);
    const uvOne = uvAtSurface(np, s, one[0], one[1]);
    edgeErr = Math.max(edgeErr, Math.abs(uvOne[0] - (k + 1 / f)) / Math.max(1, Math.abs(k)), Math.abs(uvOne[1] - l));
    // and the scale is the old scale times f
    cornerErr = Math.max(cornerErr, Math.abs(q.scale - p.scale * f) / Math.max(1, p.scale));
  }
  check(cornerErr < 1e-6, `scale: the corner (k, l) keeps its surface point (worst ${cornerErr.toExponential(2)} mm)`);
  check(edgeErr < 1e-9, `scale: a point one tile along u from the corner lies 1/f along (worst ${edgeErr.toExponential(2)})`);
}

// turn: the corner keeps its surface point, and the tile's first edge (from the corner, along u)
// points at the pointer, measured in the surface plane
{
  let cornerErr = 0;
  let angleErr = 0;
  let signErr = 0;
  for (let i = 0; i < 400; i++) {
    const { p, s } = randomCase();
    const k = Math.floor(between(-3, 3));
    const l = Math.floor(between(-3, 3));
    // the pointer's surface point, and its tile coordinates from the corner
    const Q: V2 = [between(-4000, 4000), between(-4000, 4000)];
    const uvQ = uvAtSurface(p, s, Q[0], Q[1]);
    const alpha = uvQ[0] - k;
    const beta = uvQ[1] - l;
    if (Math.hypot(alpha, beta) < 1e-3) continue;
    const delta = turnAngle(p, s, alpha, beta);
    const t = turnAbout(p, s, k, l, delta);
    const np = { ...p, rotation: t.rotation, offsetU: t.offsetU, offsetV: t.offsetV };
    const c0 = surfaceAt(p, s, k, l);
    const c1 = surfaceAt(np, s, k, l);
    cornerErr = Math.max(cornerErr, Math.abs(c0[0] - c1[0]), Math.abs(c0[1] - c1[1]));
    const e0 = surfaceAt(np, s, k + 1, l);
    const edge = [e0[0] - c1[0], e0[1] - c1[1]];
    const toPointer = [Q[0] - c1[0], Q[1] - c1[1]];
    const le = Math.hypot(edge[0], edge[1]);
    const lp = Math.hypot(toPointer[0], toPointer[1]);
    if (lp < 1e-6) continue;
    const cross = (edge[0] * toPointer[1] - edge[1] * toPointer[0]) / (le * lp);
    const dotp = (edge[0] * toPointer[0] + edge[1] * toPointer[1]) / (le * lp);
    angleErr = Math.max(angleErr, Math.abs(cross));
    if (dotp <= 0) signErr++;
  }
  check(cornerErr < 1e-6, `turn: the corner (k, l) keeps its surface point (worst ${cornerErr.toExponential(2)} mm)`);
  check(angleErr < 1e-9 && signErr === 0, `turn: the tile's first edge lies along the pointer, the right way (worst sine ${angleErr.toExponential(2)}, ${signErr} reversed)`);
}

// turn: a quarter turn of the pointer's direction is a quarter turn of the rotation, the other way
// when flipped (the flip mirrors the surface)
{
  const s: ImageSize = { imageSize: 1000, aspect: 1 };
  const p: Placement = { offsetU: 0, offsetV: 0, scale: 1, rotation: 0, flip: false };
  const d = turnAngle(p, s, 0, 1);
  check(close(d, Math.PI / 2), `turn: the v direction from an unflipped tile is +90° (${((d * 180) / Math.PI).toFixed(3)}°)`);
  const pf = { ...p, flip: true };
  check(close(turnAngle(pf, s, 0, 1), -Math.PI / 2), "turn: flipped, the v direction is −90°");
}

// shift: a turn snaps to 15° steps and keeps its length
{
  const [a, b] = snapDirection(1, 0.3, Math.PI / 12);
  const angle = Math.atan2(b, a);
  check(close(angle, Math.round(angle / (Math.PI / 12)) * (Math.PI / 12), 1e-12) && close(Math.hypot(a, b), Math.hypot(1, 0.3), 1e-12), "shift: a turn snaps its direction to 15° and keeps its length");
}

// the 3D turn preview: the frame's spin lays A along the target
{
  const f = frameOf(
    [
      [0, 0, 0],
      [1000, 0, 0],
      [0, 500, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  )!;
  const target: V3 = [0, 3, 0];
  const psi = spinAngle(f, target);
  const N = frameNormal(f);
  const moved = turnPoint([1000, 0, 0], [0, 0, 0], N, psi);
  check(close(Math.atan2(moved[1], moved[0]), Math.PI / 2, 1e-9) && Math.abs(moved[2]) < 1e-9, "spin preview: A turns onto the pointer's direction");
}

// coords and tileOf: the tile index from uv, and a point's coordinates in the basis
{
  const c = coords([3, 4, 0], [1, 0, 0], [0, 1, 0]);
  check(!!c && close(c[0], 3) && close(c[1], 4), "coords: the basis coordinates of a vector");
  check(JSON.stringify(tileOf([-0.5, 2.25])) === JSON.stringify([-1, 2]), "tileOf: floor of the uv");
  const f = frameOf(
    [
      [0, 0, 0],
      [1000, 0, 0],
      [0, 500, 0],
    ],
    [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  )!;
  const cs = tileCorners(f, 0, 0);
  check(close(cs[2][0], 1000) && close(cs[2][1], 500), "tileCorners: the far corner of tile (0, 0) is one image across and up");
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
