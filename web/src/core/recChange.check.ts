// Checks what the model keeps across edits (recChange.ts) under Node. Run from web/:
//   npx tsx src/core/recChange.check.ts [drawing.vwx]
// A run of edits, each made after every kept read has been asked for. After each, the symbols,
// stories, record formats, resources, line types, lights, cameras and layers read the same as
// the saved file reopened (read whole), and an edit to one layer's objects keeps the resource
// list itself and the other layers' lights. A blank drawing (the default) has no symbol, camera,
// light, lighting device, record format, line type or story list to copy settings from, so a
// drawing that has them checks those too; an edit the drawing refuses is skipped.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import { Model } from "./model.ts";
import { setTurnSteps } from "./model3d.ts";
import { RecChange } from "./recChange.ts";
import type { NewShape, VwxDocument } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// bytes (a texture's image) by their hash: a drawing's images can be too long for one string
const json = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    ArrayBuffer.isView(x) ? createHash("sha1").update(x as Uint8Array).digest("hex") : x instanceof Map ? [...x] : x,
  );

/** The reads the model keeps across an edit. */
function read(doc: VwxDocument): string {
  return [
    json(doc.symbolDefs()),
    json(doc.stories()),
    json(doc.recordFormats()),
    json(doc.resources()),
    json(doc.lineTypes()),
    json(doc.lights3d()),
    json(doc.cameras()),
    json(doc.layers()),
  ].join("\n");
}

const file = process.argv[2];
const s = openVwx(file ? new Uint8Array(readFileSync(file)) : blankDrawing("mm"), "kept-check.vwx");
const doc = s.doc;
const tops = (layer: string) => doc.objects(layer).filter((o) => o.parentId === null);
const rects = (n: number): NewShape[] => Array.from({ length: n }, (_, i): NewShape => ({ kind: "rect", x0: 40 * i, y0: 0, x1: 40 * i + 30, y1: 20 }));
const design = doc.layers().filter((l) => l.kind === "design");
const a = design.reduce((x, y) => (tops(y.id).length > tops(x.id).length ? y : x)).id;
const b = design.find((l) => l.id !== a)?.id ?? s.createLayer("Second", "design", 50);
s.addObjects(a, rects(6));
s.addObjects(b, rects(4));
const some = (layer: string, i: number) => {
  const t = tops(layer);
  return t[Math.min(i, t.length - 1)].id;
};

/**
 * Runs an edit with every kept read warm, and checks them against the file reopened; an edit
 * the drawing refuses is skipped. `layer`: the layer whose objects alone the edit changes.
 */
function step(what: string, edit: () => void, layer?: string): void {
  read(doc);
  const resources = doc.resources();
  const lights = doc.lights3d();
  try {
    edit();
  } catch {
    console.log(`skip ${what}: the drawing refuses it`);
    return;
  }
  check(read(doc) === read(openVwx(doc.toBytes(), "again.vwx").doc), `${what}: reads as the file reopened`);
  if (layer) {
    check(doc.resources() === resources, `${what}: the resource list is kept`);
    const now = new Set(doc.lights3d());
    const others = lights.filter((l) => l.layerId !== layer);
    if (others.length) check(others.every((l) => now.has(l)), `${what}: the other layers' lights are kept`);
  }
}

step("move one", () => s.moveObjects([some(a, 2)], 3, 4), a);
step("move on the other layer", () => s.moveObjects([some(b, 1)], -2, 1), b);
step("group two", () => s.groupObjects([some(a, 0), some(a, 1)]), a);
step("move on both layers", () => s.moveObjects([some(a, 3), some(b, 2)], 1, 1));

const camera = doc.cameras()[0];
if (camera) {
  step("move a camera", () => s.moveObjects([camera.id], 100, 50), camera.layerId);
  step("aim it", () => s.setCameraView(camera.id, [camera.eye[0] + 500, camera.eye[1], camera.eye[2]], camera.target), camera.layerId);
}
let added = "";
step("add a camera", () => (added = s.addCamera(a, [0, -5000, 1600], [0, 0, 1600])), a);
if (added) step("delete it", () => s.deleteObjects([added]), a);

const lamp = doc.lights3d().find((l) => l.placedBy === "drawing");
if (lamp) {
  step("turn a light off", () => s.setLight(lamp.id, { on: !lamp.on }), lamp.layerId);
  step("move what holds it", () => s.moveObjects([lamp.objectId], 20, 20), lamp.layerId);
}
const held = doc.lights3d().find((l) => l.placedBy === "symbol");
if (held) step("move a symbol with a light", () => s.moveObjects([held.objectId], -5, 5), held.layerId);
// a lighting device's lights come from its parameters, and its lens sits past its body's faces
const device = doc.lights3d().find((l) => l.device);
if (device) {
  step("turn a lighting device off", () => s.setLight(device.id, { on: !device.on }), device.layerId);
  step("dim it", () => s.setLight(device.id, { brightness: 0.4 }), device.layerId);
  step("move it", () => s.moveObjects([device.objectId], 30, 0), device.layerId);
  step("a finer 3D conversion resolution", () => setTurnSteps(96));
  // back to the default
  setTurnSteps(48);
}
const cls = doc.classes().find((c) => c.name !== "None");
if (cls) {
  step("into another class", () => s.setObjectClass([some(a, 3)], cls.index), a);
  step("class attributes", () => s.setClassAttributes(cls.index, { penFore: 3 }));
}

const def = doc.symbolDefs()[0]?.index;
if (def !== undefined) {
  let placed = "";
  step("place a symbol", () => (placed = s.insertSymbol(a, def, { x: 2000, y: 0 })), a);
  if (placed) step("move it", () => s.moveObjects([placed], 50, 50), a);
  step("edit inside the symbol", () => {
    const open = doc.openSymbol(def)!;
    try {
      s.moveObjects([tops(open)[0].id], 500, 300);
    } finally {
      doc.openSymbol(null);
    }
  });
  step("duplicate the symbol", () => s.duplicateSymbol(def, "Kept check copy"));
}
step("make a symbol", () => s.createSymbol([some(a, 4)], "Kept check"));
const made = doc.symbolDefs().find((d) => d.name === "Kept check")?.index;
if (made !== undefined) step("rename it", () => s.renameResource(made, "Kept check renamed"));

let format = 0;
step("record format", () => (format = s.createRecordFormat("Kept check format", [{ name: "Note", kind: "text", value: "a" }])));
if (format) {
  step("attach it", () => s.attachRecord([some(a, 5)], format), a);
  step("set its field", () => s.setRecordField(some(a, 5), format, "Note", "b"), a);
  step("edit the format", () => s.editRecordFormat(format, [{ name: "Note", kind: "text", value: "c" }, { name: "N", kind: "integer", value: 1 }]));
}
let dash = 0;
step("line type", () => (dash = s.createLineType("Kept check dash", [0.1, 0.05], new Map())));
if (dash) step("edit the line type", () => s.editLineType(dash, [0.2, 0.05], new Map()));
const hatch = doc.resources().find((r) => r.kind === "hatch" && r.hatch);
if (hatch?.hatch) step("edit a hatch", () => s.editHatch(hatch.index, { ...hatch.hatch!, background: hatch.hatch!.background === 1 ? 2 : 1 }, new Map()));

let story = 0;
step("story", () => (story = s.createStory("Kept check story", "K", 0)));
if (story) {
  step("layer on the story", () => s.setLayerStory(b, story));
  step("story elevation", () => s.editStory(story, { elevation: 3000 }));
  step("rename the story", () => s.renameStory(story, "Kept check story 2"));
}
step("layer elevation", () => s.setLayerElevation(a, 1200));
step("rename a layer", () => s.renameLayer(b, "Kept check layer"));
step("new class", () => s.createClass("Kept check class"));

step("undo three", () => {
  s.undo();
  s.undo();
  s.undo();
});
step("redo", () => s.redo());
step("undo all", () => {
  while (s.canUndo()) s.undo();
});
step("redo all", () => {
  while (s.canRedo()) s.redo();
});
step("move after redoing", () => s.moveObjects([some(a, 2)], 2, 2), a);

// another drawing holding the same records (a timelapse replay's) hangs them in its own tree:
// what held a changed record can't be read from it, so everything counts as changed
const model = doc as Model;
const before = [...model.recs];
const twin = new Model(doc.toBytes(), "twin.vwx");
twin.datas = [model.datas[0], ...model.datas];
twin.rebuild();
const after = before.filter((_, i) => i !== before.length >> 1);
check(new RecChange(before, after).reached() === null, "records hung in another drawing's tree: everything counts as changed");
model.rebuild();
check(new RecChange(model.recs, after).reached()?.size !== undefined, "hung back in its own: what changed is found");

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
