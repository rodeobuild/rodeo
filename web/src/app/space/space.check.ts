// Checks Space objects (model.ts, make.ts, draw.ts), on a blank drawing. Run from web/:
//   npx tsx src/app/space/space.check.ts
// A new Space is a plug-in object of the "Space" format with all of Vectorworks' fields for the
// drawing's version, its boundary in a path group; it measures its area, perimeter and volume in
// the units its format keeps them; it draws its boundary, label and volume; a changed boundary or
// height is measured and drawn again; and it saves and reopens the same.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx } from "../../core/index.ts";
import { drawSpace } from "./draw.ts";
import { spaceFields } from "./fieldTable.ts";
import { addSpace } from "./make.ts";
import { allSpaces, boundaryOf, F, figuresOf, measured, nameOf, occupancyOf, roomSides, savedYear, setSpaceValues, spaceOf, spacesOnLayer } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

// the format by year
check(spaceFields(2023).length === 369 && spaceFields(2024).length === 376 && spaceFields(2025).length === 377 && spaceFields(2026).length === 377, "the format has 369, 376, 377 and 377 fields in 2023 to 2026");
check(spaceFields(2023).find((f) => f.name === "Area")?.type === 3 && spaceFields(2024).find((f) => f.name === "Area")?.type === 21, "Area is a plain number in 2023 and an area from 2024");
check(spaceFields(2026).at(-1)?.name === "space_cw_uniq_id" && spaceFields(2023).at(-2)?.name === "__NEW", "new fields go in ahead of the last two");
check(new Set(spaceFields(2026).map((f) => f.name)).size === 377, "no field name twice");

const s = openVwx(blankDrawing("mm"));
const layer = s.createLayer("Rooms", "design", 50);
check(savedYear(s.doc) === 2026, `a blank drawing is a 2026 one (${savedYear(s.doc)})`);
check(allSpaces(s.doc).length === 0, "a blank drawing has no spaces");

const ring = [{ x: 1000, y: 2000 }, { x: 5000, y: 2000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }];
const id = s.batch(() => addSpace(s, { ring, layerId: layer, values: { [F.name]: "Kitchen", [F.number]: "101", [F.height]: 2400, [F.show3d]: true, [F.showLabel]: true, [F.floorFinish]: "Oak", [F.autoBoundary]: false } }));
let sp = spaceOf(s.doc, id)!;
check(sp !== null && sp.fields.length === 377, `a new Space has the 2026 format's 377 fields (${sp?.fields.length})`);
check(sp.text(F.name) === "Kitchen" && sp.text(F.number) === "101" && sp.text("11_Number") === "101" && sp.text("NumberIncrementingValue") === "101", "its name and number, the number kept in its mirrors too");
check(sp.text(F.floorFinish) === "Oak", "its floor finish");
check(nameOf(sp) === "Kitchen" && sp.text(F.nameShown) === "Kitchen" && sp.text("11_Name") === "Custom" && sp.text("11_Space Name Cust") === "Kitchen", "its name is set as Vectorworks shows a custom one: shown, custom text and popup");
// a Space as Vectorworks saves one whose plain Name is another room's: the shown name is read, and a rename sets them all
s.batch(() => s.setRecordFields(sp.format, [{ id, fields: { [F.name]: "Somewhere else", [F.occupancy]: "Custom", [F.occupancyShown]: "Residential" } }]));
check(nameOf(spaceOf(s.doc, id)!) === "Kitchen" && occupancyOf(spaceOf(s.doc, id)!) === "Residential", "the name and occupancy read are the ones shown, not stale plain ones");
s.batch(() => setSpaceValues(s, id, { [F.nameShown]: "Kitchen", [F.occupancyShown]: "Living" }));
sp = spaceOf(s.doc, id)!;
check(sp.text(F.name) === "Kitchen" && sp.text(F.occupancy) === "Living" && sp.text("11_Occupant") === "Custom" && sp.text("11_Occupant Custom") === "Living", "setting the shown name or occupancy sets the plain one and the custom one too");
check(near(measured(sp, F.area, "Millimeters"), 12e6) && near(sp.num(F.perimeter), 14000), `it measures 12 m² and 14 m round (${sp.num(F.area)}, ${sp.num(F.perimeter)})`);
check(near(measured(sp, F.volume, "Millimeters"), 12e6 * 2400), `and 28.8 m³ (${sp.num(F.volume)})`);
check(near(measured(sp, F.grossArea, "Millimeters"), 12e6), "its gross area is its net one with no walls to measure to");
check(near(sp.num(F.length), 4) && near(sp.num(F.width), 3) && near(sp.num("11_Length"), 4000), "Length and Width in metres, their mirrors in mm");
check(sp.text("11_Area") === "12 m²", `the area's text (${sp.text("11_Area")})`);
check(/^[0-9a-f-]{36}$/.test(sp.text(F.uniqueId)), "it has a unique id");
const got = boundaryOf(s.doc, id);
check(!!got && got.length === 4 && near(got[0].x, 1000) && near(got[2].y, 5000), "its boundary is read back on the drawing");

const kids = (): { kind: string; shape?: string; text?: string }[] => s.doc.objects(layer).filter((o) => o.parentId === id).map((o) => ({ kind: o.kind, shape: o.shape?.kind, text: o.shape?.kind === "text" ? o.shape.text : undefined }));
check(kids().filter((k) => k.shape === "polygon").length === 1, "it draws its boundary");
check(kids().some((k) => k.text === "Kitchen") && kids().some((k) => k.text === "101"), `it draws its label (${kids().map((k) => k.text).filter(Boolean).join(", ")})`);
const heights = s.doc.heightsOf(id);
check(!!heights && near(heights.min, 0) && near(heights.max, 2400), `its volume stands 0 to 2400 (${heights?.min}, ${heights?.max})`);
check(spacesOnLayer(s.doc, layer).length === 1 && allSpaces(s.doc)[0].id === id, "it is found on its layer");

// a second takes the same format
const other = s.batch(() => addSpace(s, { ring: ring.map((p) => ({ x: p.x + 6000, y: p.y })), layerId: layer, values: { [F.name]: "Hall", [F.show3d]: false } }));
check(spaceOf(s.doc, other)?.format === sp.format, "a second Space shares the format");
check(s.doc.heightsOf(other) === null, "with its volume off it shows nothing in 3D");

// reshape: the path moves, and drawing it again measures it again
const pathId = s.doc.pluginPath(id)!;
s.batch(() => {
  s.setGeometry(pathId, { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }, { x: 0, y: 3000 }], closed: true });
  setSpaceValues(s, id, { [F.height]: 3000 });
  drawSpace(s, id);
});
sp = spaceOf(s.doc, id)!;
check(near(measured(sp, F.area, "Millimeters"), 18e6) && near(measured(sp, F.volume, "Millimeters"), 18e6 * 3000) && sp.num("11_Net Height") === 3000, `reshaped and raised, it measures 18 m² and 54 m³ (${sp.num(F.area)})`);
check(kids().filter((k) => k.shape === "polygon").length === 1 && kids().filter((k) => k.kind === "group").length === 1, "and holds one boundary and its path group still");

// label off
s.batch(() => {
  setSpaceValues(s, id, { [F.showLabel]: false });
  drawSpace(s, id);
});
check(!kids().some((k) => k.text), "with its label off it draws no text");

// on a raised layer its volume stands at its own floor, not lifted twice
const upper = s.createLayer("Upper", "design", 50);
s.setLayerElevation(upper, 3000);
const raised = s.batch(() => addSpace(s, { ring, layerId: upper, values: { [F.height]: 2400, [F.show3d]: true } }));
const upperElevation = s.doc.layers().find((l) => l.id === upper)?.elevation ?? 0;
check(upperElevation === 3000, `the upper layer is at 3000 (${upperElevation})`);
const zs = s.doc.model3d().filter((m) => m.objectId === raised).flatMap((m) => [...m.triangles].filter((_, i) => i % 3 === 2));
check(near(Math.min(...zs), 3000) && near(Math.max(...zs), 5400), `a Space on a layer at 3000 stands from 3000 to 5400 in the model (${Math.min(...zs)}, ${Math.max(...zs)})`);

// figures
const f = figuresOf(ring, null, 2400, 3000);
check(near(f.grossVolume, 12e6 * 3000) && near(f.volume, 12e6 * 2400), "gross volume is the gross area by the floor to floor height");
const turned = roomSides([{ x: 0, y: 0 }, { x: 3000, y: 3000 }, { x: 2000, y: 4000 }, { x: -1000, y: 1000 }]);
check(near(turned.length, Math.hypot(3000, 3000)) && near(turned.width, Math.hypot(1000, 1000)), "a turned room's sides are its own, not its box's");

// saved and reopened
const again = openVwx(s.doc.toBytes());
const back = allSpaces(again.doc);
const first = back.find((x) => x.text(F.name) === "Kitchen");
check(back.length === 3 && !!first && near(measured(first, F.area, "Millimeters"), 18e6), "saved and reopened, the Spaces are read with their data");
check(!!first && boundaryOf(again.doc, first.id)?.length === 4, "and their boundaries");

// a feet-and-inches drawing shows areas in square feet
const ft = openVwx(blankDrawing("ftin"));
const ftLayer = ft.createLayer("Rooms", "design", 48);
const ftId = ft.batch(() => addSpace(ft, { ring: [{ x: 0, y: 0 }, { x: 3048, y: 0 }, { x: 3048, y: 3048 }, { x: 0, y: 3048 }], layerId: ftLayer, values: { [F.height]: 2438.4 } }));
const ftSpace = spaceOf(ft.doc, ftId)!;
check(near(measured(ftSpace, F.area, ft.doc.info.units), 3048 * 3048) && ftSpace.text("11_Area") === "100 sq ft", `a 10 ft square room is 100 sq ft (${ftSpace.text("11_Area")})`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("all ok");
