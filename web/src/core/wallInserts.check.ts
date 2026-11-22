// Checks doors and windows set in walls (wallInserts.ts) under Node, on a blank drawing with plain
// walls made here: a hole is cut for a new one in the wall's plan drawing and its 3D, a second goes
// into a wall that holds one, and sliding, flipping, copying, moving to another wall, taking out and
// deleting each leave the walls drawn as they should be, as one undo step, and the file reopens the
// same. Nothing is read from a drawing. Run from web/:
//   npx tsx src/core/wallInserts.check.ts

import { blankDrawing } from "./blank.ts";
import { outward } from "./csg.ts";
import { openVwx } from "./index.ts";
import { objectTriangles } from "./model3d.ts";
import type { EditSession, PluginFieldSpec } from "./types.ts";
import { solidVolume } from "./wallCut3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 1e-3): boolean => Math.abs(a - b) <= tol;

const FIELDS: PluginFieldSpec[] = [
  { name: "DoorWidth", type: 7, value: 900 },
  { name: "DoorHeight", type: 7, value: 2100 },
];
const DOOR = { x0: -450, x1: 450, z0: 0, z1: 2100 };
const WINDOW = { x0: -600, x1: 600, z0: 900, z1: 2100 };
const L = 6000;
const T = 200;
const H = 2700;
const WHOLE = L * T * H;
const DOOR_V = 900 * T * 2100;
const WINDOW_V = 1200 * T * 1200;

/** the wall's volume in 3D and the area its plan polygons fill */
function measure(s: EditSession, wall: string): { volume: number; area: number; lines: number; polygons: number } {
  const doc = (s as unknown as { doc: { rec(id: string): unknown } }).doc;
  const r = doc.rec(wall) as Parameters<typeof objectTriangles>[1];
  let volume = 0;
  for (const { triangles } of objectTriangles(s.doc as unknown as Parameters<typeof objectTriangles>[0], r)) volume += Math.abs(solidVolume(outward(triangles, 0.01)));
  let area = 0;
  let lines = 0;
  let polygons = 0;
  for (const o of s.doc.objects(s.doc.layers()[0].id)) {
    if (o.parentId !== wall || !o.shape || !("points" in o.shape)) continue;
    const pts = o.shape.points;
    if (o.shape.kind === "polygon" && o.shape.closed) {
      polygons++;
      let a = 0;
      pts.forEach((p, i) => {
        const q = pts[(i + 1) % pts.length];
        a += p.x * q.y - q.x * p.y;
      });
      area += Math.abs(a) / 2;
    } else lines++;
  }
  return { volume, area, lines, polygons };
}

const s = openVwx(blankDrawing("mm"), "blank.vwx");
const layer = s.doc.layers()[0].id;
const [w1, w2] = s.addPlainWalls(layer, [
  { start: { x: 0, y: 0 }, end: { x: L, y: 0 }, thickness: T, bottom: 0, top: H },
  { start: { x: 0, y: 3000 }, end: { x: 0, y: 3000 + L }, thickness: T, bottom: 0, top: H },
]);
check(near(measure(s, w1).volume, WHOLE, 1) && near(measure(s, w1).area, L * T), "a plain wall is whole to start with");

console.log("a door goes into a wall");
const door = s.addWallInsert(w1, "Door", FIELDS, { DoorWidth: 900 }, { x: 2000, y: 50 }, DOOR);
{
  const m = measure(s, w1);
  const place = s.wallInsertPlace(door);
  check(s.doc.object(door)?.parentId === w1, "the door is set in the wall");
  check(!!place && near(place.along, 2000) && near(place.across, 0) && !place.reversed && !place.flipped, "its origin lies on the wall's line where clicked");
  check(!!place?.hole && near(place.hole.a0, 1550) && near(place.hole.a1, 2450) && near(place.hole.z0, 0) && near(place.hole.z1, 2100), "the hole reads back from the wall as cut");
  check(near(m.volume, WHOLE - DOOR_V, 1), "the wall's 3D lacks the door's hole");
  check(near(m.area, (L - 900) * T) && m.polygons === 2, "its plan drawing is two pieces, the opening between");
}

console.log("a window goes into the wall that holds the door");
const win = s.addWallInsert(w1, "Window", [{ name: "Width", type: 7, value: 1200 }], {}, { x: 4000, y: 0 }, WINDOW);
{
  const m = measure(s, w1);
  const place = s.wallInsertPlace(win);
  check(near(m.volume, WHOLE - DOOR_V - WINDOW_V, 1), "the wall's 3D lacks both holes");
  check(!!place?.hole && near(place.hole.z0, 900) && near(place.hole.z1, 2100), "the window's hole keeps its sill and head");
  check(near(m.area, (L - 2100) * T) && m.polygons === 3, "its plan drawing is three pieces");
  let threw = false;
  try {
    s.addWallInsert(w1, "Door", FIELDS, {}, { x: 4200, y: 0 }, DOOR);
  } catch {
    threw = true;
  }
  check(threw && near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1), "a door over the window is refused, the wall left as it was");
  threw = false;
  try {
    s.addWallInsert(w1, "Door", FIELDS, {}, { x: 300, y: 0 }, DOOR);
  } catch {
    threw = true;
  }
  check(threw, "a door reaching the wall's end is refused");
}

console.log("one undo step each");
{
  s.undo();
  check(s.doc.object(win) === null && near(measure(s, w1).volume, WHOLE - DOOR_V, 1), "undo takes the window and its hole away together");
  s.redo();
  check(s.doc.object(win) !== null && near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1), "redo brings both back");
}

console.log("sliding, flipping and resizing");
{
  s.moveObjects([door], 500, 300);
  const place = s.wallInsertPlace(door);
  check(!!place && near(place.along, 2500) && !!place.hole && near(place.hole.a0, 2050) && near(place.hole.a1, 2950), "a move slides the door along its wall, its hole with it");
  check(near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1) && measure(s, w1).polygons === 3, "the wall closed where the door was");
  s.flipWallInsert(door, "along");
  check(s.wallInsertPlace(door)?.reversed === true && s.wallInsertPlace(door)?.flipped === false, "flipped end for end");
  s.flipWallInsert(door, "across");
  check(s.wallInsertPlace(door)?.flipped === true, "flipped to the wall's other side");
  s.flipWallInsert(door, "both");
  check(s.wallInsertPlace(door)?.reversed === false && s.wallInsertPlace(door)?.flipped === false && near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1), "a half turn puts it back, the hole as it was");
  s.resizeWallInsert(door, { x0: -500, x1: 500, z0: 0, z1: 2200 });
  check(near(measure(s, w1).volume, WHOLE - 1000 * T * 2200 - WINDOW_V, 1), "a wider, taller door gets a wider, taller hole");
  s.resizeWallInsert(door, DOOR);
  check(near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1), "and back");
  let threw = false;
  try {
    s.moveObjects([door], 1200, 0);
  } catch {
    threw = true;
  }
  check(threw && near(s.wallInsertPlace(door)!.along, 2500), "sliding it into the window is refused");
}

console.log("copying");
let copy = "";
{
  [copy] = s.duplicateObjects([door], -1500, 0);
  const place = s.wallInsertPlace(copy);
  check(!!place && place.wall === w1 && near(place.along, 1000), "a duplicate stands in the same wall, offset along it");
  check(near(measure(s, w1).volume, WHOLE - 2 * DOOR_V - WINDOW_V, 1) && measure(s, w1).polygons === 4, "with a hole of its own");
}

console.log("into another wall");
{
  // the copy's origin (1000, 0) goes to (0, 5000), which is 2000 along the second wall
  s.moveObjects([copy], -1000, 5000);
  const place = s.wallInsertPlace(copy);
  check(!!place && place.wall === w2 && near(place.along, 2000), "a move onto another wall sets it in that wall");
  check(near(measure(s, w1).volume, WHOLE - DOOR_V - WINDOW_V, 1), "the wall it left closed behind it");
  check(near(measure(s, w2).volume, WHOLE - DOOR_V, 1) && measure(s, w2).polygons === 2, "the wall it went to is cut");
  check(s.doc.object(copy)?.parentId === w2, "it is the same object, in the other wall");
}

console.log("taking out and deleting");
{
  s.takeFromWall([copy]);
  check(s.doc.object(copy) !== null && s.doc.object(copy)?.parentId !== w2 && s.wallInsertPlace(copy) === null, "taken out, it stands beside its wall");
  check(near(measure(s, w2).volume, WHOLE, 1) && near(measure(s, w2).area, L * T) && measure(s, w2).polygons === 1, "and that wall is whole again, one piece in plan");
  // grouping one takes it out of its wall first
  const grouped = s.addWallInsert(w2, "Door", FIELDS, {}, { x: 0, y: 6000 }, DOOR);
  check(near(measure(s, w2).volume, WHOLE - DOOR_V, 1), "a door set in the second wall, to group");
  const group = s.groupObjects([grouped]);
  check(s.doc.object(grouped)?.parentId === group && near(measure(s, w2).volume, WHOLE, 1) && measure(s, w2).polygons === 1, "grouped, it is in the group and its wall is whole");
  s.undo();
  check(s.wallInsertPlace(grouped)?.wall === w2 && near(measure(s, w2).volume, WHOLE - DOOR_V, 1), "one undo puts it back in its wall, the hole with it");
  s.deleteObjects([grouped]);
  s.deleteObjects([win]);
  check(s.doc.object(win) === null && near(measure(s, w1).volume, WHOLE - DOOR_V, 1), "deleting the window closes its hole");
  s.deleteObjects([door]);
  const m = measure(s, w1);
  check(near(m.volume, WHOLE, 1) && near(m.area, L * T) && m.polygons === 1, "deleting the door leaves the wall whole, one piece in plan");
}

console.log("the file reopens the same");
{
  const again = s.addWallInsert(w1, "Door", FIELDS, {}, { x: 3000, y: 0 }, DOOR, { reversed: true });
  const t = openVwx(s.doc.toBytes(), "again.vwx");
  const place = t.wallInsertPlace(again);
  check(!!place && place.wall === w1 && near(place.along, 3000) && place.reversed, "the door is in its wall, facing as set");
  check(near(measure(t, w1).volume, WHOLE - DOOR_V, 1) && near(measure(t, w1).area, (L - 900) * T), "the wall has its hole in plan and 3D");
  check(!!place?.hole && near(place.hole.a0, 2550) && near(place.hole.a1, 3450), "and the hole reads back");
}

console.log(failures ? `${failures} failed` : "all ok");
process.exitCode = failures ? 1 : 0;
