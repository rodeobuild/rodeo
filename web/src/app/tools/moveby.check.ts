// Node check for Move by Points' offsets (in geom.ts): `npx tsx src/app/tools/moveby.check.ts`.

import assert from "node:assert/strict";
import { distributeOffsets, duplicateOffsets, referenceMove } from "../geom.ts";

const near = (a: number, b: number, tol = 1e-9): void => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);

// Move and Duplicate: copies at 1x, 2x ... nx the vector
const three = duplicateOffsets(100, -40, 3);
assert.equal(three.length, 3);
assert.deepEqual(three[0], { x: 100, y: -40 });
assert.deepEqual(three[1], { x: 200, y: -80 });
assert.deepEqual(three[2], { x: 300, y: -120 });
assert.equal(duplicateOffsets(5, 0, 1).length, 1);
assert.deepEqual(duplicateOffsets(5, 0, 1)[0], { x: 5, y: 0 });

// Distribute: k/n of the vector, the last exactly on the second point
const four = distributeOffsets(100, 30, 4);
assert.equal(four.length, 4);
near(four[0].x, 25);
near(four[0].y, 7.5);
near(four[1].x, 50);
near(four[2].x, 75);
assert.equal(four[3].x, 100);
assert.equal(four[3].y, 30);
// n = 1 puts the one copy on the second point
assert.deepEqual(distributeOffsets(100, 30, 1), [{ x: 100, y: 30 }]);
// the last lands exactly on the second point for awkward distances too
const odd = distributeOffsets(0.1, 0.7, 3);
assert.equal(odd[2].x, 0.1);
assert.equal(odd[2].y, 0.7);

// Reference Point: the first point lands at reference + offset
assert.deepEqual(referenceMove({ x: 10, y: 20 }, { x: 110, y: 220 }, { x: 0, y: 0 }), { x: 100, y: 200 });
assert.deepEqual(referenceMove({ x: 10, y: 20 }, { x: 500, y: 300 }, { x: 50, y: 0 }), { x: 540, y: 280 });
const landed = referenceMove({ x: 10, y: 20 }, { x: 500, y: 300 }, { x: 50, y: -25 });
assert.deepEqual({ x: 10 + landed.x, y: 20 + landed.y }, { x: 550, y: 275 });

console.log("moveby offsets: ok");
