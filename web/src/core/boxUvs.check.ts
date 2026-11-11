// Checks the box mapping of an extrude's texture under Node (boxMappedUvs in model3d.ts). Run from web/:
//   npx tsx src/core/boxUvs.check.ts
// Synthetic panels only: a thin wall-like panel one image wide and one image's aspect high, placed
// far from the origin, must show its image once across and up, from its own lower-left corner, with
// the part's offset (a whole image width here), scale and rotation applied; the same panel moved must
// map the same; a face whose main axis is across x takes y and z. Nothing is drawn.

import { boxMappedUvs, type PartPlacement } from "./model3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps;
const plain: PartPlacement = { offsetU: 0, offsetV: 0, scaleU: 1, scaleV: 1, rotation: 0 };

/** a panel in the plane y = y0, from (x0, y0, z0) to (x0 + w, y0, z0 + h), as two triangles */
function panel(x0: number, y0: number, z0: number, w: number, h: number): Float64Array {
  return Float64Array.from([x0, y0, z0, x0 + w, y0, z0, x0 + w, y0, z0 + h, x0, y0, z0, x0 + w, y0, z0 + h, x0, y0, z0 + h]);
}

// the logo panel's own size: 2126 mm across, 2400 high, a 2128 mm wide image of 1259 x 1421 pixels
const W = 2126;
const H = 2400;
const SIZE = 2128;
const ASPECT = 1421 / 1259;

{
  const tris = panel(1614, -170, 0, W, H);
  const uv = boxMappedUvs(tris, plain, SIZE, ASPECT);
  // corner order: (x0,z0), (x0+w,z0), (x0+w,z0+h), (x0,z0), (x0+w,z0+h), (x0,z0+h)
  check(near(uv[0], 0) && near(uv[1], 0), "lower-left corner maps to the image's lower-left (0, 0)");
  check(near(uv[2], W / SIZE) && near(uv[3], 0), "lower-right corner maps to u = width / image width");
  check(near(uv[4], W / SIZE) && near(uv[5], H / (SIZE * ASPECT)), "upper-right corner maps to the image's upper-right, the image's aspect up");
  check(uv.every((v) => Number.isFinite(v)), "every corner gets finite (u, v)");
}

{
  // the same panel far from the origin in another place: anchored at its own corner, not the world's
  const a = boxMappedUvs(panel(1614, -170, 0, W, H), plain, SIZE, ASPECT);
  const b = boxMappedUvs(panel(-3710, 2572, 1799, W, H), plain, SIZE, ASPECT);
  check(a.length === b.length && a.every((v, i) => near(v, b[i])), "a moved panel maps the same");
  const pa = boxMappedUvs(panel(1614, -170, 0, W, H), plain, SIZE, ASPECT);
  const pc = boxMappedUvs(panel(1614, -170, 0, W, H), { ...plain, offsetU: SIZE }, SIZE, ASPECT);
  check(pa.every((v, i) => near(v, pc[i] + (i % 2 === 0 ? 1 : 0), 1e-9)), "an offset of one image width is one tile along: the same picture");
}

{
  // scale 2 across: the image spans twice the width, so the panel shows half of it
  const uv = boxMappedUvs(panel(0, 0, 0, 1000, 1000), { ...plain, scaleU: 2 }, 1000, 1);
  check(near(uv[2], 0.5) && near(uv[4], 0.5), "scale 2 across shows half the image width across the panel");
}

{
  // a quarter turn: a point 1 mm along the panel's x and 0 up becomes straight up (v) and right (u) mirrored
  const uv = boxMappedUvs(panel(0, 0, 0, 1000, 1000), { ...plain, rotation: Math.PI / 2 }, 1000, 1);
  // corner 1 is (x0 + w, z0): a = 1000, b = 0 → u = (a cos + b sin)/w = 0, v = (b cos - a sin)/h = -1
  check(near(uv[2], 0) && near(uv[3], -1), "a quarter turn turns the mapping as planeUvs does");
}

{
  // a face whose main axis is across x (its normal along x) takes y and z
  const tris = Float64Array.from([5000, 0, 0, 5000, 1000, 0, 5000, 1000, 2000, 5000, 0, 0, 5000, 1000, 2000, 5000, 0, 2000]);
  const uv = boxMappedUvs(tris, plain, 1000, 1);
  check(near(uv[2], 1) && near(uv[3], 0) && near(uv[4], 1) && near(uv[5], 2), "an x-facing face takes y across and z up");
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
