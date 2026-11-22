// Checks that viewports copy like other objects under Node. Run from web/:
//   npx tsx src/core/viewportCopy.check.ts
// A sheet viewport with an annotation is duplicated, copied and pasted: each copy is a viewport of
// its own with its own annotations, offset on the sheet as a move offsets them; the original is
// unchanged; the drawing saves and reads back with both. A paste into another drawing takes the
// layers its list shows by name, or is refused when that drawing lacks one. Nothing is drawn.

import { shapeBBox } from "../app/shapes.ts";
import { VIEWPORT_SHIFT } from "./geometry.ts";
import { blankDrawing } from "./blank.ts";
import { f64 } from "./bytes.ts";
import { openVwx } from "./index.ts";
import { guidOf } from "./model.ts";
import type { Rec } from "./records.ts";
import type { BBox, EditSession } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

/** The box of an object's shape, in its own coordinates (sheet units once its annotations are closed). */
function boxOf(s: EditSession, id: string): BBox | null {
  const shape = s.doc.object(id)?.shape;
  return shape ? shapeBBox(shape) : null;
}

/** The viewport's shift, read from its record. */
function shiftOf(s: EditSession, id: string): [number, number] {
  // the drawing's records, which the public document type leaves out
  const r = (s.doc as unknown as { recs: Rec[] }).recs.find((x) => guidOf(x) === id);
  if (!r) throw new Error(`no record for ${id}`);
  return [f64(r.data, VIEWPORT_SHIFT), f64(r.data, VIEWPORT_SHIFT + 8)];
}

/** Makes a drawing with a design layer, a sheet and a 1:50 viewport of it, with one annotation. */
function drawing(name: string): { s: EditSession; design: string; sheet: string; vp: string; label: string } {
  const s = openVwx(blankDrawing("mm"), name);
  const design = s.createLayer("Structure", "design");
  s.addObject(design, { kind: "rect", x0: 0, y0: 0, x1: 4000, y1: 3000 });
  const sheet = s.createLayer("Sheet 1", "sheet");
  const none = s.doc.classes().find((c) => c.name === "None")!.index;
  const vp = s.createViewport(sheet, {
    scale: 50,
    box: { x0: 100, y0: 100, x1: 200, y1: 180 },
    at: { x: 2000, y: 1500 },
    layers: [{ id: design, visibility: "visible" }],
    classes: [{ index: none, visibility: "visible" }],
  });
  const notes = s.doc.openAnnotations(vp);
  if (!notes) throw new Error("the viewport has no annotations");
  // a label 152 to 156 mm across and 138 to 142 mm down the sheet, stored as sheet × scale
  const label = s.addObject(notes, { kind: "rect", x0: 7600, y0: 6900, x1: 7800, y1: 7100 });
  s.doc.openAnnotations(null);
  return { s, design, sheet, vp, label };
}

/** The box of the annotation `label` in the viewport `vp` on the sheet: opened and closed again, so it is in sheet units. */
function annotationBox(s: EditSession, vp: string, label: string): BBox | null {
  s.doc.openAnnotations(vp);
  s.doc.openAnnotations(null);
  return boxOf(s, label);
}

// the duplicate: a second viewport, offset 1000 mm across the sheet
const a = drawing("viewport-copy.vwx");
const { s, vp, label } = a;
const orig = a.s.doc.viewport(vp)!;
const [sx0, sy0] = shiftOf(s, vp);
const before = annotationBox(s, vp, label)!;
check(near(before.x0, 152) && near(before.y0, 138), "the annotation sits where it was drawn before the copy");

const [copy] = s.duplicateObjects([vp], 1000, 0);
const dup = s.doc.viewport(copy);
check(!!dup && copy !== vp, "duplicating a viewport makes a viewport of its own");
check(!!dup && near(dup.box.x0, orig.box.x0 + 1000) && near(dup.box.x1, orig.box.x1 + 1000) && near(dup.scale, 50), `the copy's box moves by the offset (${dup?.box.x0})`);
const [cx, cy] = shiftOf(s, copy);
check(near(cx, sx0 + 1000 * 50) && near(cy, sy0), "the copy's shift moves by the offset times the scale, so it shows the same view");
const copyNotes = s.doc.openAnnotations(copy);
const copied = copyNotes ? s.doc.objects(copyNotes) : [];
check(copyNotes !== null && copyNotes !== s.doc.openAnnotations(vp) && copied.length === 1, `the copy has an annotation group of its own with one annotation (${copied.length})`);
s.doc.openAnnotations(null);
const copyLabel = copied[0]?.id ?? "";
check(copyLabel !== "" && copyLabel !== label, "the copy's annotation is a new object");
const copyBox = annotationBox(s, copy, copyLabel);
check(!!copyBox && near(copyBox.x0, 152 + 1000) && near(copyBox.y0, 138), `the copy's annotation moves by the offset on the sheet (${copyBox?.x0})`);

const after = annotationBox(s, vp, label);
check(!!after && near(after.x0, 152) && near(after.y0, 138), "the original's annotation is unchanged");
check(near(s.doc.viewport(vp)!.box.x0, orig.box.x0) && near(s.doc.viewport(vp)!.box.x1, orig.box.x1), "the original viewport's box is unchanged");
const [ox, oy] = shiftOf(s, vp);
check(near(ox, sx0) && near(oy, sy0), "the original's shift is unchanged");

// save and read back with both
const again = openVwx(s.doc.toBytes(), "viewport-copy.vwx");
check(!!again.doc.viewport(vp) && !!again.doc.viewport(copy), "saved and reopened, both viewports are there");
const reread = annotationBox(again, copy, copyLabel);
check(!!reread && near(reread.x0, 152 + 1000), `and the copy's annotation is where it was (${reread?.x0})`);
check(!!annotationBox(again, vp, label) && near(annotationBox(again, vp, label)!.x0, 152), "and the original's is too");

// copy and paste within the drawing, offset 500 mm down the sheet
const data = s.copyObjects([vp]);
const [pasted] = s.pasteObjects(a.sheet, data, 0, 500);
const pb = s.doc.viewport(pasted);
check(!!pb && near(pb.box.y0, orig.box.y0 + 500) && near(pb.box.x0, orig.box.x0), "a pasted viewport lands at the offset");
const pastedNotes = s.doc.openAnnotations(pasted);
const pastedLabel = pastedNotes ? s.doc.objects(pastedNotes)[0]?.id ?? "" : "";
s.doc.openAnnotations(null);
const pastedBox = annotationBox(s, pasted, pastedLabel);
check(!!pastedBox && near(pastedBox.y0, 138 + 500), `and its annotation moves down with it (${pastedBox?.y0})`);

// a paste into another drawing: refused while it lacks the layer the list shows, kept once it has it
const other = openVwx(blankDrawing("mm"), "viewport-copy-other.vwx");
const otherSheet = other.createLayer("Sheet 1", "sheet");
const crossData = s.copyObjects([vp]);
let refused = "";
try {
  other.pasteObjects(otherSheet, crossData, 0, 0);
} catch (err) {
  refused = err instanceof Error ? err.message : String(err);
}
check(refused.includes("which this drawing doesn't have") && other.doc.objects(otherSheet).length === 0, `a paste lacking the layer is refused (${refused})`);
const otherDesign = other.createLayer("Structure", "design");
const [moved] = other.pasteObjects(otherSheet, crossData, 0, 0);
const mv = other.doc.viewport(moved);
const shown = mv?.layers.find((l) => l.name === "Structure");
check(!!mv && !!shown && shown.visibility === "visible" && shown.id === otherDesign, "with the layer there, the viewport shows it by name in the other drawing");
check(mv?.classes.some((c) => other.doc.classes().find((k) => k.index === c.index)?.name === "None") ?? false, "and its class list names the other drawing's classes");

// a viewport goes on a sheet only
let onDesign = "";
try {
  s.pasteObjects(a.design, data, 0, 0);
} catch (err) {
  onDesign = err instanceof Error ? err.message : String(err);
}
check(onDesign === "viewports go on sheet layers", "a viewport pasted onto a design layer is refused");

console.log(failures ? `${failures} failed` : "all passed");
if (failures) process.exit(1);
