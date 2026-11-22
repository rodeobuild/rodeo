// Checks that Spaces with Auto-Boundary follow their walls (refit.ts, through refitSpaces and
// refitSpace), on a blank drawing. Run from web/:
//   npx tsx src/app/space/follow.check.ts
// Four joined 200 mm walls round a 4 m x 3 m room and an auto Space in it: its area is 12 m², and its
// gross area 13.44 m². The bottom wall moves out by 1000 mm: the Space and its boundary follow (16 m²,
// gross 17.64 m²), its name and other parameters stay, and a Space with Auto-Boundary off in the same
// room is not touched. One undo puts it all back. Walls deleted: the Space keeps its shape.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type EditSession, type Pt } from "../../core/index.ts";
import { addSpace } from "./make.ts";
import { allSpaces, boundaryOf, F, measured, spaceOf } from "./model.ts";
import { refitSpace, refitSpaces } from "./refit.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1): boolean => Math.abs(a - b) <= eps;
const area = (ring: readonly Pt[]): number => Math.abs(ring.reduce((a, p, i) => a + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0)) / 2;
const sideDiff = (sp: { fields: readonly { name: string; value: unknown }[] }, before: Map<string, unknown>): string[] => {
  const figure = (k: string): boolean => k.startsWith("11_") || k === "MeasuredNetAreaNum" || k === "MeasuredNetArea" || [F.area, F.grossArea, F.perimeter, F.grossPerimeter, F.volume, F.grossVolume, F.length, F.width, F.roomDimensions].includes(k as never);
  return sp.fields.filter((f) => !figure(f.name) && before.get(f.name) !== f.value).map((f) => f.name);
};
const valuesOf = (s: EditSession, id: string): Map<string, unknown> => new Map(spaceOf(s.doc, id)!.fields.map((f) => [f.name, f.value]));

/** a room: four walls of 200 mm round 4000 x 3000 mm, joined at their corners; their ids (bottom, right, top, left) */
function room(s: EditSession, layer: string): string[] {
  const tpl = s.wallTemplates().find((t) => t.id === "plain-wall:200:2700");
  if (!tpl) throw new Error("the blank drawing has no 200 mm plain wall");
  return s.batch(() => {
    const bottom = s.addWall(layer, { x: -100, y: -100 }, { x: 4100, y: -100 }, tpl.id);
    const right = s.addWall(layer, { x: 4100, y: -100 }, { x: 4100, y: 3100 }, tpl.id, undefined, { before: bottom });
    const top = s.addWall(layer, { x: 4100, y: 3100 }, { x: -100, y: 3100 }, tpl.id, undefined, { before: right });
    const left = s.addWall(layer, { x: -100, y: 3100 }, { x: -100, y: -100 }, tpl.id, undefined, { before: top, after: bottom });
    return [bottom, right, top, left];
  });
}

const inner = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];

// the room, its auto Space, and a Space in the same room with Auto-Boundary off
{
  const s = openVwx(blankDrawing("mm"));
  const layer = s.createLayer("Rooms", "design", 50);
  const walls = room(s, layer);
  const auto = s.batch(() => addSpace(s, { ring: inner, layerId: layer, values: { [F.name]: "Kitchen", [F.number]: "101", [F.height]: 2400, [F.occupancy]: "Residential", [F.autoBoundary]: true } }));
  const manual = s.batch(() => addSpace(s, { ring: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 3000 }, { x: 0, y: 3000 }], layerId: layer, values: { [F.name]: "Pantry", [F.number]: "102", [F.autoBoundary]: false } }));
  const manualRing = boundaryOf(s.doc, manual)!;
  const manualBefore = valuesOf(s, manual);

  // refitting the room as drawn: the Space already matches its walls and finds its gross
  const first = refitSpaces(s, undefined, true);
  check(first === 1, `refitting every Space adds the gross figure to one that matched its walls (${first})`);
  let sp = spaceOf(s.doc, auto)!;
  check(near(measured(sp, F.area, "Millimeters"), 12e6, 1), `the auto Space is 12 m² in its walls (${measured(sp, F.area, "Millimeters")})`);
  check(near(measured(sp, F.grossArea, "Millimeters"), 13.44e6, 1), `its gross area is 13.44 m² to the centre lines (${measured(sp, F.grossArea, "Millimeters")})`);
  check(refitSpaces(s) === 0, "a second refit with the walls unchanged does nothing");
  check(refitSpace(s, auto) === false, "refitSpace on a Space already fitted changes nothing");

  // the bottom wall moves out by 1000 mm; the joined walls keep their joins; then the refit, in the same undo step
  const before = valuesOf(s, auto);
  const beforeFields = new Map(before);
  s.batch(() => s.setWallLine(walls[0], { x: -100, y: -1100 }, { x: 4100, y: -1100 }));
  const moved = refitSpaces(s);
  check(moved === 1, `the refit reshapes the one auto Space (${moved})`);
  sp = spaceOf(s.doc, auto)!;
  const ring = boundaryOf(s.doc, auto)!;
  check(near(area(ring), 16e6, 1) && near(measured(sp, F.area, "Millimeters"), 16e6, 1), `its boundary and area follow the wall: 16 m² (${measured(sp, F.area, "Millimeters")})`);
  check(near(measured(sp, F.grossArea, "Millimeters"), 17.64e6, 1), `its gross area is 17.64 m², larger than its net (${measured(sp, F.grossArea, "Millimeters")})`);
  check(sp.text(F.name) === "Kitchen" && sp.text(F.number) === "101" && sp.text(F.occupancy) === "Residential" && sp.num(F.height) === 2400, "its name, number, occupancy and height are unchanged");
  const changed = sideDiff(sp, beforeFields);
  check(changed.length === 0, `only its figures changed (${changed.join(", ") || "none"})`);
  check(sp.flag(F.autoBoundary), "it is still Auto-Boundary");
  const mRing = boundaryOf(s.doc, manual)!;
  check(mRing.length === manualRing.length && mRing.every((p, i) => near(p.x, manualRing[i].x, 0.01) && near(p.y, manualRing[i].y, 0.01)), "the Space with Auto-Boundary off in the same room is not touched (boundary)");
  check(sideDiff(spaceOf(s.doc, manual)!, manualBefore).length === 0 && near(measured(spaceOf(s.doc, manual)!, F.area, "Millimeters"), 6e6, 1), "and its figures are as they were (6 m²)");

  // one undo: the wall, the Space and its figures back together
  s.undo();
  const restored = spaceOf(s.doc, auto)!;
  check(near(measured(restored, F.area, "Millimeters"), 12e6, 1) && near(area(boundaryOf(s.doc, auto)!), 12e6, 1), "one undo puts the Space back to 12 m²");
  check(near(s.doc.wall(walls[0])!.start.y, -100, 0.01) && near(s.doc.wall(walls[0])!.end.y, -100, 0.01), "and the wall back where it was");
}

// a drawing as it was saved: a Space whose boundary isn't quite its room (Vectorworks counts a door's
// recess into a room) is only looked at, and is reshaped once its own walls move
{
  const s = openVwx(blankDrawing("mm"));
  const layer = s.createLayer("Rooms", "design", 50);
  const walls = room(s, layer);
  const withRecess = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 1000 }, { x: 4100, y: 1000 }, { x: 4100, y: 1900 }, { x: 4000, y: 1900 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
  const auto = s.batch(() => addSpace(s, { ring: withRecess, layerId: layer, values: { [F.name]: "Bedroom", [F.autoBoundary]: true } }));
  const saved = measured(spaceOf(s.doc, auto)!, F.area, "Millimeters");
  check(refitSpaces(s) === 0 && near(measured(spaceOf(s.doc, auto)!, F.area, "Millimeters"), saved, 1), "the first look at a drawing reshapes nothing");
  s.addObject(layer, { kind: "polygon", points: [{ x: 9000, y: 9000 }, { x: 9500, y: 9000 }, { x: 9500, y: 9500 }], closed: true });
  check(refitSpaces(s) === 0 && boundaryOf(s.doc, auto)!.length === 8, "an edit that moves no wall leaves it as saved");
  s.batch(() => s.setWallLine(walls[0], { x: -100, y: -1100 }, { x: 4100, y: -1100 }));
  check(refitSpaces(s) === 1 && boundaryOf(s.doc, auto)!.length === 4 && near(measured(spaceOf(s.doc, auto)!, F.area, "Millimeters"), 16e6, 1), "once its wall moves it takes its room");
}

// walls deleted: the Space keeps its shape
{
  const s = openVwx(blankDrawing("mm"));
  const layer = s.createLayer("Rooms", "design", 50);
  const walls = room(s, layer);
  const auto = s.batch(() => addSpace(s, { ring: inner, layerId: layer, values: { [F.name]: "Hall", [F.autoBoundary]: true } }));
  refitSpaces(s);
  const before = boundaryOf(s.doc, auto)!;
  s.batch(() => s.deleteObjects(walls));
  const n = refitSpaces(s);
  const after = boundaryOf(s.doc, auto)!;
  check(n === 0 && after.length === before.length && after.every((p, i) => near(p.x, before[i].x, 0.01) && near(p.y, before[i].y, 0.01)), "with its walls deleted the Space keeps its shape");
  check(allSpaces(s.doc).length === 1, "and it is still there");
}

console.log(failures ? `${failures} failed` : "all ok");
process.exit(failures ? 1 : 0);
