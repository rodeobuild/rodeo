// Run with: npx tsx src/app/rigSolids.check.ts
import assert from "node:assert/strict";
import { curvedTrussMembers, curvedTrussSolid, junctionSolid, pipeSolid, plateSolid, sectionMembers, straightTrussMembers, straightTrussSolid, towerSolid } from "./rigSolids.ts";
import { basePlate, bayStations, junction, tower, type StraightTruss, type TrussSection, type CurvedTruss } from "./rigShapes.ts";
import type { Solid } from "./solids3d.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

/** a plan that must have been drawn */
const drawn = (d: MarkerDrawing | string): MarkerDrawing => {
  assert.equal(typeof d, "object", String(d));
  return d as MarkerDrawing;
};

const near = (a: number, b: number, eps = 1e-6): void => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const bounds = (solid: Solid): { lo: number[]; hi: number[] } => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const face of solid) for (let i = 0; i + 2 < face.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], face[i + k]);
    hi[k] = Math.max(hi[k], face[i + k]);
  }
  return { lo, hi };
};
/** signed volume by fan triangles: positive for a closed solid wound outward */
const volume = (solid: Solid): number => {
  let v = 0;
  for (const f of solid) {
    for (let i = 3; i + 2 < f.length; i += 3) {
      const [ax, ay, az] = [f[0], f[1], f[2]];
      const [bx, by, bz] = [f[i - 3], f[i - 2], f[i - 1]];
      const [cx, cy, cz] = [f[i], f[i + 1], f[i + 2]];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return v;
};

const box: TrussSection = { profile: "box", width: 290, chord: 51, ladderBar: 20, lacing: 16, folding: false, highlight: true };
const tri: TrussSection = { ...box, profile: "triangle" };
const ladder: TrussSection = { ...box, profile: "ladder" };
const straight: StraightTruss = { ...box, interval: 3000, ladderSpacing: 500, direction: false };
const curved: CurvedTruss = { ...box, diameter: 6000, totalArc: 180, segmentArc: 45, ladderArc: 7.5 };

// bays: the end bars stand in half a chord and divide the rest evenly
assert.deepEqual(bayStations(1000, 51, 500).length, 3);
near(bayStations(1000, 51, 500)[0], 25.5);

// members per section: chords, bars across each station, lacing per bay
const none: TrussSection = { ...box, lacing: 0 };
assert.equal(sectionMembers(box, 1000, 500, (s, y, z) => [s, y, z], 1).length, 4 + 3 * 2 + 2 * 2);
assert.equal(sectionMembers(tri, 1000, 500, (s, y, z) => [s, y, z], 1).length, 3 + 3 + 2 * 2);
assert.equal(sectionMembers(ladder, 1000, 500, (s, y, z) => [s, y, z], 1).length, 2 + 3 + 2);
assert.equal(sectionMembers(none, 1000, 500, (s, y, z) => [s, y, z], 1).length, 4 + 3 * 2);

// a straight truss 6 m long at a 3 m interval: two sections of 30 members each
assert.equal(straightTrussMembers(straight, 6000, 6000).length, 60);
// its last short section drawn only past a chord's width
assert.equal(straightTrussMembers(straight, 3000 + 40, 6000).length, 30);

// the solid sits at its height, its underside and top at the section's width, x along the truss
const s1 = straightTrussSolid(straight, 6000, 6000);
assert.equal(typeof s1, "object");
const b1 = bounds(s1 as Solid);
assert.ok(b1.lo[0] > -26 && b1.hi[0] < 6026, `x ${b1.lo[0]}..${b1.hi[0]}`);
assert.ok(b1.lo[2] > 6000 - 26 && b1.hi[2] < 6000 + 290 + 26, `z ${b1.lo[2]}..${b1.hi[2]}`);
assert.ok(Math.abs(b1.lo[1] + 145) < 26 && Math.abs(b1.hi[1] - 145) < 26, `y ${b1.lo[1]}..${b1.hi[1]}`);

// a curved truss hangs round its arc, its middle on +y
const c1 = bounds(curvedTrussSolid(curved, 4000) as Solid);
assert.ok(c1.hi[1] > 2990 && c1.hi[1] < 3010 && c1.lo[1] > -30, `curved y ${c1.lo[1]}..${c1.hi[1]}`);
assert.ok(c1.lo[2] > 3900 && c1.hi[2] < 4300, `curved z ${c1.lo[2]}..${c1.hi[2]}`);
assert.ok(curvedTrussMembers(curved, 0).length > 0);

// too many members is refused, not drawn
const huge = { ...straight, interval: 3000, ladderSpacing: 50 };
assert.equal(typeof straightTrussSolid(huge, 300000, 0), "string");

// a pipe is a tube at its height, its diameter across
const pipe = bounds(pipeSolid([{ x: 0, y: 0 }, { x: 4000, y: 0 }], false, 48, 5000) as Solid);
near(pipe.lo[2], 5000 - 24, 0.5);
near(pipe.hi[2], 5000 + 24, 0.5);
assert.equal(typeof pipeSolid([{ x: 0, y: 0 }], false, 48, 0), "string");
assert.equal(typeof pipeSolid([{ x: 1, y: 1 }, { x: 1, y: 1 }], false, 48, 0), "string");

// junctions: arms out a width beyond the block, the block a width square and as high
const cube = bounds(junctionSolid("cube", 290, 51, 6000) as Solid);
near(cube.hi[0], 290, 0.5);
near(cube.lo[0], -290, 0.5);
near(cube.lo[2], 6000 - 145, 0.5);
const corner = bounds(junctionSolid("corner", 290, 51, 6000) as Solid);
assert.ok(corner.lo[0] > -150 - 1 && corner.hi[0] > 289, `corner x ${corner.lo[0]}..${corner.hi[0]}`);
assert.equal(typeof junctionSolid("tee", 100, 51, 0), "string");

// the plan: a junction's arms are its chords, a cube's vertical ones a circle
assert.equal(drawn(junction("corner", 290, 51)).lines.length, 4);
assert.equal(drawn(junction("tee", 290, 51)).lines.length, 6);
assert.equal(drawn(junction("cross", 290, 51)).lines.length, 8);
assert.equal(drawn(junction("cube", 290, 51)).lines.length, 8);
assert.equal(drawn(junction("cube", 290, 51)).circles.length, 1);
assert.equal(typeof junction("corner", 100, 51), "string");

// a base plate sits on the layer, its thickness up
const plate = bounds(plateSolid(500, 20) as Solid);
near(plate.lo[2], 0);
near(plate.hi[2], 20);
near(plate.hi[0], 250);
assert.equal(drawn(basePlate(500)).outlines.length, 1);
assert.equal(typeof plateSolid(0, 20), "string");

// a tower stands from its plate to its height above it
const t3 = bounds(towerSolid(box, 3000, 500, 20) as Solid);
near(t3.lo[2], 20, 0.5);
near(t3.hi[2], 3020, 0.5);
assert.equal(typeof towerSolid(box, 40, 500, 0), "string");
assert.equal(drawn(tower(box)).outlines.length, 5);

// winding: closed solids the other pieces use have positive volume, so these do too
assert.ok(volume(plateSolid(500, 20) as Solid) > 0, "plate volume");
assert.ok(volume(junctionSolid("cube", 290, 51, 0) as Solid) > 0, "junction volume");

console.log("rigSolids checks passed");
