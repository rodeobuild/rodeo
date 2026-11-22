// Checks which texture part a face belongs to (facePartOf in texmap.ts, and VwxDocument's
// texturePartOfFace which calls it). Run from web/:
//   npx tsx src/core/texturePartOfFace.check.ts
// Synthetic records only: an extrude's data with its own matrix at +0xcc. Prints ok or FAIL per
// check and exits non-zero on failure.

import { facePartOf, OVERALL } from "./texmap.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const EXTRUDE = 24;
const SWEEP = 34;
const MULTI = 38;
const SLAB = 71;

/** Object data of `length` bytes with the matrix rows (nine numbers) and origin (three) written in. */
function data(rows: number[], origin: number[] = [0, 0, 0], length = 0x130): Uint8Array {
  const d = new Uint8Array(length);
  const dv = new DataView(d.buffer);
  rows.forEach((v, i) => dv.setFloat64(0xcc + 8 * i, v, true));
  origin.forEach((v, i) => dv.setFloat64(0x114 + 8 * i, v, true));
  return d;
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ID = data(IDENTITY);

check(facePartOf(EXTRUDE, ID, [0, 0, 1]) === 4, "identity: a face facing +z is Top (4)");
check(facePartOf(EXTRUDE, ID, [0, 0, -1]) === 5, "identity: a face facing -z is Bottom (5)");
check(facePartOf(EXTRUDE, ID, [1, 0, 0]) === 6, "identity: a face facing +x is Sides (6)");
check(facePartOf(EXTRUDE, ID, [0, 1, 0]) === 6, "identity: a face facing +y is Sides (6)");
check(facePartOf(EXTRUDE, ID, [0, 0, 5]) === 4, "identity: the normal's length does not matter");
check(facePartOf(EXTRUDE, ID, [0, 0.9999, 0.01]) === 6, "identity: a steep face is Sides, not Top");

// own z along world x: row 2 is (1, 0, 0)
const TURNED = data([0, 0, 1, 0, 1, 0, 1, 0, 0]);
check(facePartOf(EXTRUDE, TURNED, [1, 0, 0]) === 4, "turned: own z along world x, world +x is Top (4)");
check(facePartOf(EXTRUDE, TURNED, [-1, 0, 0]) === 5, "turned: world -x is Bottom (5)");
check(facePartOf(EXTRUDE, TURNED, [0, 0, 1]) === 6, "turned: world +z is Sides (6)");

check(facePartOf(SWEEP, ID, [0, 0, 1]) === 4, "a sweep takes the same parts");
check(facePartOf(MULTI, ID, [0, 0, -1]) === 5, "a multiple extrude takes the same parts");

check(facePartOf(SLAB, ID, [0, 0, 1]) === OVERALL, "a slab gives the whole object (3)");
check(facePartOf(SLAB, ID, [1, 0, 0]) === OVERALL, "a slab's side face gives the whole object (3)");
check(facePartOf(EXTRUDE, ID, [0, 0, 0]) === OVERALL, "a zero normal gives the whole object (3)");
check(facePartOf(EXTRUDE, ID, [NaN, 0, 1]) === OVERALL, "a non-finite normal gives the whole object (3)");
check(facePartOf(EXTRUDE, data(IDENTITY).subarray(0, 0x100), [0, 0, 1]) === OVERALL, "a short record with no readable matrix gives the whole object (3)");
const NAN = data([NaN, 0, 0, 0, 1, 0, 0, 0, 1]);
check(facePartOf(EXTRUDE, NAN, [0, 0, 1]) === OVERALL, "an unreadable matrix gives the whole object (3)");
const DEGENERATE = data([1, 0, 0, 0, 1, 0, 0, 0, 0]);
check(facePartOf(EXTRUDE, DEGENERATE, [0, 0, 1]) === OVERALL, "a matrix with a zero own z gives the whole object (3)");

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
