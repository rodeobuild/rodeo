// Checks a new plug-in object's path group (setPluginPath), on a blank drawing. Run from web/:
//   npx tsx src/core/pluginPath.check.ts
// The path goes into a group marked gtap inside the plug-in, where pluginPath finds it; it is shown
// neither as the plug-in's drawing nor lost when the drawing is replaced; reshaping it is
// setGeometry; undo takes it out again; and the file reopens with it.

import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const s = openVwx(blankDrawing("mm"));
const layer = s.createLayer("Rooms", "design", 50);
const ring = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
const id = s.addPluginObject(layer, "Rodeo Path Check", [{ name: "Name", type: 4, value: "" }], { Name: "Hall" }, { x: 1000, y: 2000 }, 0);
check(s.doc.pluginPath(id) === null, "a new plug-in object has no path");

const depth = s.undoDepth;
const shape = s.addObject(layer, { kind: "polygon", points: ring, closed: true });
s.setPluginPath(id, shape);
const path = s.doc.pluginPath(id);
check(path === shape, "its path is the shape given");
const pathShape = path ? s.doc.object(path)?.shape : undefined;
check(pathShape?.kind === "polygon" && pathShape.points?.length === 4, `the path keeps its corners (${pathShape?.points?.length})`);
check(s.doc.objects(layer).filter((o) => o.parentId === null || o.parentId === undefined).length === 1, "the shape is no longer on the layer itself");

let threw = false;
try {
  const again = s.addObject(layer, { kind: "polygon", points: ring, closed: true });
  s.setPluginPath(id, again);
} catch {
  threw = true;
}
check(threw, "a second path is refused");

// its drawing replaced twice: the path stays
for (let i = 0; i < 2; i++) {
  const drawn = s.addObject(layer, { kind: "polygon", points: ring.map((p) => ({ x: p.x + i, y: p.y })), closed: true });
  s.setPluginDrawing(id, [drawn]);
}
check(s.doc.pluginPath(id) === shape, "replacing its drawing keeps the path");
const kids = s.doc.objects(layer).filter((o) => o.parentId === id);
check(kids.filter((o) => o.kind === "group").length === 1 && kids.filter((o) => o.shape?.kind === "polygon").length === 1, `it holds its path group and one drawn polygon (${kids.map((o) => o.kind).join(" ")})`);

s.setGeometry(shape, { kind: "polygon", points: [...ring, { x: -500, y: 1500 }], closed: true });
check(s.doc.object(s.doc.pluginPath(id)!)?.shape?.points?.length === 5, "reshaping the path is setGeometry on it");

const reopened = openVwx(s.doc.toBytes());
const again = reopened.doc
  .layers()
  .flatMap((l) => reopened.doc.objects(l.id))
  .find((o) => o.type === 86);
const reread = again ? reopened.doc.pluginPath(again.id) : null;
check(!!reread && reopened.doc.object(reread)?.shape?.points?.length === 5, "saved and reopened, the path is read again");
check(!!again && reopened.doc.records(again.id).find((r) => r.parametric)?.fields.find((f) => f.name === "Name")?.value === "Hall", "and its parameters");

while (s.undoDepth > depth) s.undo();
check(s.doc.pluginPath(id) === null, "undo takes the path out again");

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("all ok");
