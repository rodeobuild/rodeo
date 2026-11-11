// Run with: npx tsx src/app/lightingDeviceSolids.check.ts
import assert from "node:assert/strict";
import { hangDrop, instrumentSolids, lensHeight, scaledBody, STANDS_BELOW_MM } from "./lightingDeviceSolids.ts";
import type { Solid } from "./solids3d.ts";
import type { Instrument } from "./lightingDeviceShapes.ts";

const near = (a: number, b: number, eps = 1): void => assert.ok(Math.abs(a - b) <= eps, `${a} is not ${b}`);
const bounds = (solid: Solid) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const face of solid) for (let i = 0; i + 2 < face.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], face[i + k]);
    hi[k] = Math.max(hi[k], face[i + k]);
  }
  return { lo, hi };
};
const volume = (solid: Solid): number => {
  let v = 0;
  for (const f of solid) for (let i = 3; i + 2 < f.length; i += 3) {
    const [ax, ay, az] = [f[0], f[1], f[2]];
    const [bx, by, bz] = [f[i - 3], f[i - 2], f[i - 1]];
    const [cx, cy, cz] = [f[i], f[i + 1], f[i + 2]];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
};

const glyphs: Instrument[] = ["ellipsoidal", "fresnel", "par", "moving", "wash"];
for (const g of glyphs) {
  const parts = instrumentSolids(g, 0, 0);
  assert.ok(parts.length >= 2, `${g} has a head and a yoke`);
  for (const p of parts) assert.ok(p.length > 0, `${g} part has faces`);
  // the head's faces are closed and wound outward: a positive volume
  assert.ok(volume(parts[0]) > 0, `${g} head volume ${volume(parts[0])}`);
}

// the lens sits at the origin and the front along +x: a fresnel's lens frame reaches x 170
const fresnel = instrumentSolids("fresnel", 0, 0);
near(bounds(fresnel[0]).hi[0], 170, 0.5);
// turned by the aim: its front swings to +y at a quarter turn
const turned = instrumentSolids("fresnel", Math.PI / 2, 0);
near(bounds(turned[0]).hi[1], 170, 0.5);
// pitched nose down: the lens frame (x 170) drops to z -170
const down = instrumentSolids("fresnel", 0, Math.PI / 2);
near(bounds(down[0]).lo[2], -170, 0.5);
// the yoke stays level when the head tilts
near(bounds(down[1]).hi[2], bounds(fresnel[1]).hi[2], 0.5);

// a Symbol Scale of 2 doubles the body
const big = scaledBody("par", 2, 0, 0);
near(bounds(big[0]).hi[0], 2 * bounds(instrumentSolids("par", 0, 0)[0]).hi[0], 0.5);

// each body hangs: its yoke's top (where it clamps to a pipe) is its highest point, hangDrop above the lens,
// and a moving head's base is up there too, over its head
for (const g of glyphs) {
  const top = Math.max(...instrumentSolids(g, 0, 0).map((p) => bounds(p).hi[2]));
  near(top, hangDrop(g), 0.5);
}
const moving = instrumentSolids("moving", 0, 0);
assert.ok(bounds(moving.at(-1)!).lo[2] > bounds(moving[0]).hi[2], "the moving head's base is above its head");
// standing, the yoke is turned over: its foot hangDrop under the lens, the moving head's base under its head, faces still out
for (const g of glyphs) {
  const parts = instrumentSolids(g, 0, 0, true);
  near(Math.min(...parts.map((p) => bounds(p).lo[2])), -hangDrop(g), 0.5);
  for (const p of parts.slice(1)) assert.ok(volume(p) > 0, `${g} standing yoke part wound outward: ${volume(p)}`);
}
const standingMover = instrumentSolids("moving", 0, 0, true);
assert.ok(bounds(standingMover.at(-1)!).hi[2] < bounds(standingMover[0]).lo[2], "a standing moving head's base is under its head");
// hung from a 6 m pipe at Symbol Scale 2 the lens is twice the drop under it; at 400 mm it stands, the lens over its foot
assert.deepEqual(lensHeight("par", 2, 6000), { lens: 6000 - 2 * hangDrop("par"), standing: false });
assert.deepEqual(lensHeight("par", 1, 400), { lens: 400 + hangDrop("par"), standing: true });
assert.equal(lensHeight("wash", 1, STANDS_BELOW_MM).standing, false);

console.log("lightingDeviceSolids checks passed");
