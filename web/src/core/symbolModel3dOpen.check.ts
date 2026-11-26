// Checks the 3D model while a symbol definition is open for editing (Modify > Edit Symbol). Run from web/:
//   npx tsx src/core/symbolModel3dOpen.check.ts
// A blank drawing takes a 3D box on its layer and another box made into a symbol. While the symbol is
// closed its meshes are not in the model. Opened, they are, tagged with the definition's id as their
// layer and with objects doc.object() knows. An edit inside it rebuilds them, and closing takes them
// out again, leaving the drawing's own meshes as they were.

import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const s = openVwx(blankDrawing("mm"), "symbol-3d.vwx");
const doc = s.doc;
const layer = doc.layers()[0].id;

// the drawing's own 3D: a box on the layer, which stays out of the symbol
const [own] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 0, x1: 1000, y1: 1000 })], 2000);
// the box that becomes the symbol, 3 m up from the origin, so its bounds differ from the drawing's
const [boxed] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 3000, y0: 0, x1: 4000, y1: 1000 })], 2500);
const inst = s.createSymbol([boxed], "Symbol 3D check", { x: 3000, y: 0 });
const index = doc.symbolDefs().find((d) => d.name === "Symbol 3D check")!.index;
check(doc.object(inst)?.symbol === index, "the symbol is made and placed");

/** a signature of the meshes on a layer, for comparing before and after */
function layerSig(layerId: string): string {
  return doc
    .model3d()
    .filter((m) => m.layerId === layerId)
    .map((m) => `${m.objectId}:${m.triangles.length}`)
    .sort()
    .join("|");
}

// the definition's id is only given while it is open, so open and close it once to read it
const defId = doc.openSymbol(index)!;
doc.openSymbol(null);
check(!!defId && defId !== layer, `the definition has its own id (${defId.slice(0, 8)})`);

const drawingSig = layerSig(layer);
const placedMeshes = doc.model3d().filter((m) => m.objectId === inst).length;
check(drawingSig.length > 0 && placedMeshes > 0, `the drawing's 3D is in the model (${doc.model3d().filter((m) => m.layerId === layer).length} meshes; the placed symbol ${placedMeshes})`);
check(doc.model3d().every((m) => m.layerId !== defId), "closed: no mesh is tagged with the definition's id");

// open: the definition's own meshes appear, tagged with its id
const opened = doc.openSymbol(index);
check(opened === defId, "opening it gives the same id as before");
const symMeshes = doc.model3d().filter((m) => m.layerId === defId);
const symIds = new Set(symMeshes.map((m) => m.objectId));
check(symMeshes.length > 0, `open: the definition's 3D is in the model (${symMeshes.length} meshes, ${symIds.size} objects)`);
check([...symIds].every((id) => doc.object(id) !== null), "open: every object id is one doc.object() knows");
// making the symbol moved the box into it under a new id, so its id is read from the definition
const [child] = doc.objects(defId);
check(!!child && symIds.has(child.id), "open: the box that became the symbol is among its objects");
check(!symIds.has(own), "open: the drawing's own box is not in the symbol");
const symTriangles = symMeshes.reduce((n, m) => n + m.triangles.length / 9, 0);
check(symTriangles > 0, `open: the definition has faces (${symTriangles} triangles)`);
check(layerSig(layer) === drawingSig, "open: the drawing's own meshes are unchanged");

// an edit inside the open definition rebuilds its meshes
const inside = child!;
const xBefore = Math.min(...symMeshes.flatMap((m) => Array.from(m.triangles).filter((_, i) => i % 3 === 0)));
s.moveObjects([inside.id], 500, 0);
const after = doc.model3d().filter((m) => m.layerId === defId);
const xAfter = Math.min(...after.flatMap((m) => Array.from(m.triangles).filter((_, i) => i % 3 === 0)));
check(after.length > 0 && Math.abs(xAfter - xBefore - 500) < 1e-3, `an edit inside rebuilds the definition's 3D (x moved ${(xAfter - xBefore).toFixed(1)} mm)`);

// close: they go again, and the drawing's meshes are the same as before
doc.openSymbol(null);
check(doc.model3d().every((m) => m.layerId !== defId), "closed again: the definition's meshes are gone");
check(layerSig(layer) === drawingSig, "closed again: the drawing's meshes are the same as before");

// open and close once more: the same count comes back
doc.openSymbol(index);
const again = doc.model3d().filter((m) => m.layerId === defId).length;
doc.openSymbol(null);
check(again === after.length, `reopened: same mesh count (${again})`);

console.log(`\ncounted: drawing meshes ${doc.model3d().filter((m) => m.layerId === layer).length}, definition meshes ${after.length}, objects ${symIds.size}`);
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
