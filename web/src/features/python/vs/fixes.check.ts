// Node check of the round-2 fixes to the vs module's core and its loose ends: full-width parameter names,
// a placed plug-in object's insertion point, nil handles, symbol definitions as GetObject finds them,
// renaming a layer, help text ahead of its item, the file and resource calls' trailing arguments, 2D
// components, object lists, surfaces that don't meet, layer elevations in inches and 3D points kept.
// Run from web/: npx tsx src/features/python/vs/fixes.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, pluginSnapshot, ranVs, runVs, type SnapObject, type VsOutcome } from "../vsCheck.ts";

const said = (r: VsOutcome): string => r.printed.trim();
/** What a Vectorscript Message showed. */
const messaged = (r: VsOutcome): string => ((r.messages as string[] | undefined) ?? []).join("\n").trim();

/** A polygon of the drawing as the script's copy holds it. */
function polyObj(id: string, pts: number[][]): SnapObject {
  const xs = pts.map((p) => p[0] ?? 0);
  const ys = pts.map((p) => p[1] ?? 0);
  return { id, type: 5, layer: LAYER, parent: null, cls: "None", name: id, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], attrs: { fillPattern: 1, fillFore: 255 }, sym: null, records: {}, shape: { kind: "polygon", pts, closed: true } };
}

// 1. Parameter names in full-width characters are matched by their ASCII names (NFKC)
{
  const r = ranVs(`import vs
print(vs.Pcls3)
`, { snapshot: pluginSnapshot("Fullwidth", [["ｃｌｓ３", "str", "abc"]]) });
  assert.equal(said(r), "abc", "vs.Pcls3 reads a parameter named with full-width letters");
}
{
  const r = ranVs(`PROCEDURE Test;
BEGIN
  Message(Pcls3);
END;
RUN(Test);`, { file: "test.vs", snapshot: pluginSnapshot("Fullwidth", [["ｃｌｓ３", "str", "abc"]]) });
  assert.equal(messaged(r), "abc", "Vectorscript Pcls3 reads the same parameter");
}

// 2. A plug-in object being placed has its insertion point and turn; its 3D reads answer from the point
{
  const snap = pluginSnapshot("Placer", [], 3, 0, { at: [1000, 2000], angle: 90 });
  const r = ranVs(`import vs
h = vs.Handle("new:plugin")
print(vs.GetSymLoc(h))
print(vs.GetSymRot(h))
print(vs.Get3DCntr(h))
print(vs.Get3DInfo(h))
print(vs.GetSymLoc3D(h))
`, { snapshot: snap });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.deepEqual(said(r).split("\n"), ["(1000.0, 2000.0)", "90.0", "((1000.0, 2000.0), 0.0)", "(0.0, 0.0, 0.0)", "(1000.0, 2000.0, 0.0)"], "the point, the turn, and the 3D reads from the point at z 0");
}
// 3. Nil handles: names '', types 0, parents, siblings and layers None
{
  const r = runVs(`import vs
print(repr(vs.GetName(None)), vs.GetTypeN(None), vs.GetType(None), vs.GetParent(None), vs.NextObj(None), vs.PrevObj(None), repr(vs.GetClass(None)), vs.GetLayer(None))
`, { snapshot: blankSnapshot() });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(said(r), "'' 0 0 None None None '' None", "every nil-handle answer is the one Vectorworks gives");
}

// 4. GetObject finds a symbol definition by name; its parent is None
{
  const snap = blankSnapshot();
  snap.symbols = [{ index: 3, name: "Chair", bbox: null }];
  const r = ranVs(`import vs
h = vs.GetObject("Chair")
print(vs.GetTypeN(h), vs.GetName(h), vs.GetParent(h), vs.GetObject("Nothing"))
`, { snapshot: snap });
  assert.equal(said(r), "16 Chair None None", "a symbol definition's handle, with its name, type 16 and no parent");
}

// 5. A layer handle: its name is read and SetName renames it
{
  const r = ranVs(`import vs
h = vs.Handle("${LAYER}")
print(vs.GetName(h))
vs.SetName(h, "Renamed")
print(vs.GetName(h))
`, { snapshot: blankSnapshot() });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(said(r), "Design Layer-1\nRenamed", "the layer's name before and after SetName");
  assert.deepEqual(r.ops.filter((o) => o[0] === "layername"), [["layername", LAYER, "Renamed"]], "one layer rename step");
}

// 6. Help text for an item the dialog doesn't have yet is kept and shown when it exists; no error
{
  const r = ranVs(`import vs
dlg = vs.CreateLayout("Help")
vs.SetHelpText(dlg, 3, "Later tip")
vs.SetItemToolTipText(dlg, 4, "Another tip")
vs.CreateStaticText(dlg, 3, "")
import json
print([c.get("tip") for c in json.loads(vs._dialog_json(vs._S.dialogs[dlg]))["items"]])
`, {});
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(said(r), "[None, None, 'Later tip']", "a tip set before its item is made is shown with it; a tip for an item not made yet is not an error");
}

// 7. Trailing arguments the scripts pass (the reference has three); the file filter is read from the fourth
{
  const r = ranVs(`import vs
ok, p = vs.GetFileN("Pick", "", "", "CSV|*.csv")
print(ok, repr(p))
lst, n = vs.BuildResourceList(16, 1, "", False)
print(n)
`, { answers: { OpenFile: [null] } });
  assert.equal(said(r), "False ''\n0", "a cancelled pick answers False and '', and the list is built");
  assert.deepEqual(r.asked.find((a) => a[0] === "OpenFile")?.[1], ["Pick", "csv"], "the fourth argument's filter is the file types asked for");
}

// 8. Set2DComponentGroup takes a group drawn in this run; a group in the drawing is refused honestly
{
  const r = ranVs(`import vs
g = vs.Rect(0, 0, 10, 10)
print(vs.Set2DComponentGroup(vs.Handle("new:plugin"), vs.LNewObj(), 1))
`, { snapshot: pluginSnapshot("Comp", []) });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(said(r), "True", "a group drawn in this run is accepted");
  const snap = pluginSnapshot("Comp", []);
  snap.objects.push(polyObj("A", [[0, 0], [1, 0], [1, 1]]));
  const bad = runVs(`import vs\nvs.Set2DComponentGroup(vs.Handle("new:plugin"), vs.Handle("A"), 1)\n`, { snapshot: snap });
  assert.match(bad.error?.message ?? "", /Set2DComponentGroup of a group in the drawing isn't available in Rodeo yet/, "a group already in the drawing is refused honestly");
}

// 9. ForEachObjectInList walks the list from its first object; a nil list is the active layer
{
  const snap = blankSnapshot();
  snap.objects.push(polyObj("A", [[0, 0], [1, 0], [1, 1]]), polyObj("B", [[5, 5], [6, 5], [6, 6]]), polyObj("C", [[9, 9], [10, 9], [10, 10]]));
  const r = ranVs(`import vs
seen = []
def visit(h):
    seen.append(vs.GetName(h))
    return False
vs.ForEachObjectInList(visit, 0, 0, vs.Handle("B"))
print(seen)
seen.clear()
vs.ForEachObjectInList(visit, 0, 0, None)
print(seen)
`, { snapshot: snap });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.deepEqual(said(r).split("\n"), ["['B', 'C']", "['A', 'B', 'C']"], "from B on, and every object of the layer for a nil list");
}

// 9b. Symbol names the drawing lacks say why the script needs them
{
  const r = runVs(`import vs\nvs.Symbol("", 0, 0, 0)\n`, {});
  assert.match(r.error?.message ?? "", /the drawing has no symbol named '' \(this script expects it to be in the drawing\)/, "the missing symbol is named as the script's need");
}

// 11a. AddSurface answers nil when the two surfaces' boxes don't meet; overlapping ones get a handle
{
  const snap = blankSnapshot();
  snap.objects.push(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]), polyObj("F", [[100, 100], [110, 100], [110, 110], [100, 110]]), polyObj("B", [[5, 5], [15, 5], [15, 15], [5, 15]]));
  const r = ranVs(`import vs
print(vs.AddSurface(vs.Handle("A"), vs.Handle("F")) is None)
print(vs.AddSurface(vs.Handle("A"), vs.Handle("B")) is None)
`, { snapshot: snap });
  assert.equal(said(r), "True\nFalse", "nil for surfaces apart, a handle for overlapping ones");
  assert.equal(r.ops.filter((o) => o[0] === "surf").length, 1, "the apart pair makes no surface step");
}

// 11b. Layer elevations are read and set in the drawing's units (inches here)
{
  const snap = blankSnapshot();
  snap.units = { mm: 25.4, mark: "in", area: "sq in", format: 0, display: 2 };
  snap.layers = [{ id: LAYER, name: "Design Layer-1", kind: "design", scale: 50, vis: "visible", elev: 25.4 }];
  const r = ranVs(`import vs
h = vs.Handle("${LAYER}")
print(vs.GetLayerElevation(h)[0])
vs.SetLayerElevation(h, 2, 0)
print(vs.GetLayerElevation(h)[0])
`, { snapshot: snap });
  assert.equal(said(r), "1.0\n2.0", "an elevation of 25.4 mm reads as 1 inch, and 2 inches is set as 2 inches");
}

// 11c. A 3D polygon keeps its heights in the object's copy: its 3D size shows the z the script drew
{
  const r = ranVs(`import vs
vs.Poly3D(0, 0, 0, 10, 0, 0, 10, 0, 5)
print(vs.Get3DInfo(vs.LNewObj()))
`, { snapshot: blankSnapshot() });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(said(r), "(0.0, 10.0, 5.0)", "the z of the drawn points is kept");
}

console.log("vs core fixes (round 2): ok");
