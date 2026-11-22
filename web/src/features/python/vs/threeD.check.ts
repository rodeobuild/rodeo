// Node check of the 3D calls (threeD.ts): every new call once, with its step or its read-back value.
// Run from web/: npx tsx src/features/python/vs/threeD.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, ranVs, runVs, type Snapshot, type VsOutcome } from "../vsCheck.ts";

/** The steps of a kind, in order. */
function stepsOf(r: VsOutcome, kind: string): unknown[][] {
  return r.ops.filter((o) => o[0] === kind) as unknown[][];
}

/** What the script printed, as JSON values (one line per print, the script prints json.dumps). */
function readBack(r: VsOutcome): unknown[] {
  return r.printed.trim().split("\n").map((line) => JSON.parse(line) as unknown);
}

const J = "import json\n";

// ---- extrudes -----------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.BeginXtrd(100, 400)
vs.Rect(0, 0, 2, 3)
vs.EndXtrd()
h = vs.LNewObj()
print(vs.GetTypeN(h))
print(json.dumps(vs.Get3DInfo(h)))
print(json.dumps(vs.Get3DCntr(h)))
`);
  const x = stepsOf(r, "xtrd");
  assert.equal(x.length, 1, "one extrude step");
  assert.equal(x[0]?.[3], 100, "stands at the lower distance, 100 mm");
  assert.equal(x[0]?.[4], 300, "400 - 100 mm tall");
  assert.equal(r.ops.filter((o) => o[0] === "add").length, 1, "the profile is added first");
  assert.deepEqual(readBack(r), [24, [3, 2, 300], [[1, 1.5], 250]], "type 24, its sizes (dy, dx, dz) and centre");
}

// Move3DObj then Get3DCntr; Move3D moves the newest object
{
  const r = ranVs(`${J}import vs
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 2, 2)
vs.EndXtrd()
h = vs.LNewObj()
vs.Move3DObj(h, 10, 0, 50)
print(json.dumps(vs.Get3DCntr(h)))
vs.Move3D(0, 5, 0)
print(json.dumps(vs.Get3DCntr(vs.LNewObj())))
`);
  assert.deepEqual(stepsOf(r, "move3d").map((o) => o.slice(2)), [[10, 0, 50], [0, 5, 0]], "the moves in mm");
  assert.deepEqual(readBack(r), [[[11, 1], 100], [[11, 6], 100]], "0 to 100 mm, centred at 50, moved up 50");
}

// Units other than mm: the snapshot is in inches (25.4 mm each)
{
  const snap: Snapshot = { ...blankSnapshot(), units: { mm: 25.4, mark: "in", area: "in²", format: 0, display: 2 } };
  const r = ranVs(`${J}import vs
vs.BeginXtrd(0, 1)
vs.Rect(0, 0, 1, 1)
vs.EndXtrd()
print(json.dumps(vs.Get3DInfo(vs.LNewObj())))
`, { snapshot: snap });
  assert.equal(stepsOf(r, "xtrd")[0]?.[4], 25.4, "one inch is 25.4 mm");
  assert.deepEqual(readBack(r), [[1, 1, 1]], "a one-inch cube reads back in inches");
}

// Vectorscript spelling
{
  const r = ranVs(`PROCEDURE Test;
BEGIN
  BeginXtrd(0, 10);
  Rect(0, 0, 5, 5);
  EndXtrd;
END;
RUN(Test);`, { file: "test.vs" });
  assert.equal(stepsOf(r, "xtrd")[0]?.[4], 10, "Vectorscript BeginXtrd(0, 10) makes a 10 mm extrude");
}

// Several profiles: one extrude each, grouped
{
  const r = ranVs(`${J}import vs
vs.BeginXtrd(0, 50)
vs.Rect(0, 0, 1, 1)
vs.Rect(2, 0, 3, 1)
vs.EndXtrd()
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(r, "xtrd")[0]?.[1] && (stepsOf(r, "xtrd")[0]?.[1] as unknown[]).length, 2, "two extrudes");
  assert.equal(stepsOf(r, "group").length, 1, "grouped");
  assert.deepEqual(readBack(r), [11], "the new object is the group");
}

// Multiple extrude: two or more profiles, one object
{
  const r = ranVs(`${J}import vs
vs.BeginMXtrd(0, 20)
vs.Rect(0, 0, 1, 1)
vs.Rect(0, 0, 2, 2)
vs.EndMXtrd()
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(r, "mxtrd").length, 1);
  assert.equal(stepsOf(r, "mxtrd")[0]?.[4], 20, "20 mm tall");
  assert.deepEqual(readBack(r), [38]);
  const bad = runVs(`${J}import vs
vs.BeginMXtrd(0, 20)
vs.Rect(0, 0, 1, 1)
vs.EndMXtrd()
`);
  assert.equal(bad.error?.name, "ValueError", "one profile is refused");
}

// Errors: no Begin, zero height
{
  assert.equal(runVs(`import vs\nvs.EndXtrd()\n`).error?.name, "RuntimeError");
  assert.equal(runVs(`import vs\nvs.BeginXtrd(5, 5)\nvs.Rect(0, 0, 1, 1)\nvs.EndXtrd()\n`).error?.name, "ValueError");
}

// ---- sweeps and meshes --------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.BeginSweep(0, 360, 90, 0)
vs.Rect(2, 0, 3, 1)
vs.EndSweep()
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(r, "tomesh").length, 1, "a sweep is made as a mesh");
  assert.equal(stepsOf(r, "add").filter((o) => (o[3] as { kind: string }).kind === "poly3d").length, 16, "4 edges by 4 steps");
  assert.deepEqual(readBack(r), [40]);
  const part = ranVs(`${J}import vs
vs.BeginSweep(0, 180, 90, 0)
vs.Rect(2, 0, 3, 1)
vs.EndSweep()
`);
  assert.equal(stepsOf(part, "add").filter((o) => (o[3] as { kind: string }).kind === "poly3d").length, 10, "8 sides and two caps for a half turn");
}
{
  const r = ranVs(`${J}import vs
vs.BeginMesh()
vs.Poly3D(0, 0, 0, 1, 0, 0, 1, 1, 0)
vs.Poly3D(0, 0, 0, 1, 1, 0, 0, 1, 0)
vs.EndMesh()
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(r, "tomesh").length, 1);
  assert.deepEqual(readBack(r), [40]);
  assert.equal(runVs(`import vs\nvs.BeginMesh()\nvs.Rect(0, 0, 1, 1)\nvs.EndMesh()\n`).error?.name, "NotImplementedError");
}
{
  const s = ranVs(`${J}import vs
vs.CreateSphere((0, 0, 0), 10)
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(s, "add").filter((o) => (o[3] as { kind: string }).kind === "poly3d").length, 12 * 24);
  assert.deepEqual(readBack(s), [40]);
  const c = ranVs(`${J}import vs
vs.CreateCone((0, 0, 0), (0, 0, 10), 5)
`);
  assert.equal(stepsOf(c, "add").length, 25, "24 sides and the base");
  const hm = ranVs(`${J}import vs
vs.CreateHemisphere((0, 0, 0), (0, 0, 10))
`);
  assert.equal(stepsOf(hm, "add").length, 6 * 24 + 1, "6 by 24 faces and the base");
  assert.equal(stepsOf(hm, "tomesh").length, 1);
}

// ---- solids -------------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 10, 10)
vs.EndXtrd()
a = vs.LNewObj()
vs.BeginXtrd(0, 100)
vs.Rect(5, 5, 15, 15)
vs.EndXtrd()
b = vs.LNewObj()
ok, sub = vs.SubtractSolid(a, b)
print(json.dumps([ok, vs.GetTypeN(sub)]))
ok2, add = vs.AddSolid(vs.LNewObj(), vs.LNewObj()) if False else (0, None)
`);
  assert.deepEqual(stepsOf(r, "solid").map((o) => o[3]), ["sub"]);
  assert.deepEqual(readBack(r), [[0, 84]]);
  const more = ranVs(`${J}import vs
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 10, 10)
vs.EndXtrd()
a = vs.LNewObj()
vs.BeginXtrd(0, 100)
vs.Rect(5, 5, 15, 15)
vs.EndXtrd()
b = vs.LNewObj()
vs.AddSolid(a, b)
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 1, 1)
vs.EndXtrd()
c = vs.LNewObj()
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 3, 3)
vs.EndXtrd()
d = vs.LNewObj()
vs.IntersectSolid(c, d)
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.deepEqual(stepsOf(more, "solid").map((o) => o[3]), ["add", "int"]);
  assert.deepEqual(readBack(more), [84]);
  const vol = ranVs(`${J}import vs
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 10, 10)
vs.EndXtrd()
h = vs.LNewObj()
print(json.dumps([vs.ObjVolume(h), vs.ObjSurfaceArea(h)]))
`);
  assert.deepEqual(readBack(vol), [[10000, 4 * 1000 + 2 * 100]], "10 x 10 x 100 volume and area as made here");
}

// ---- other 3D shapes ---------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.Locus3D(1, 2, 3)
print(json.dumps(vs.GetLocus3D(vs.LNewObj())))
vs.Poly3D(0, 0, 0, 1, 0, 0, 1, 1, 0)
print(json.dumps(vs.GetPolyPt3D(vs.LNewObj(), 2)))
`);
  assert.equal(stepsOf(r, "loc3").length, 1);
  assert.deepEqual(readBack(r), [[1, 2, 3], [1, 0, 0]]);
}
{
  const r = ranVs(`${J}import vs
vs.BeginXtrd(0, 100)
vs.Rect(0, 0, 2, 2)
vs.EndXtrd()
h = vs.LNewObj()
vs.Set3DRot(h, 0, 0, 90, 0, 0, 0)
print(json.dumps([round(v, 6) + 0.0 if isinstance(v, float) else v for v in vs.Get3DOrientation(h)]))
vs.SetRot3D(h, 0, 0, 0, 0, 0, 0)
print(json.dumps([round(v, 6) + 0.0 if isinstance(v, float) else v for v in vs.Get3DOrientation(h)]))
vs.Rotate3D(90, 0, 0)
`);
  assert.deepEqual(stepsOf(r, "rot3d").map((o) => [o[2], o[3]]), [[[0, 0, 1], 90], [[0, 0, -1], 90], [[1, 0, 0], 90]], "Set3DRot's turn, SetRot3D's turn back to none (about -z), Rotate3D about x");
  assert.deepEqual(readBack(r), [[true, 0, 0, 90, false], [true, 0, 0, 0, false]]);
}
{
  const r = ranVs(`${J}import vs
vs.Rect(0, 0, 1, 1)
p = vs.LNewObj()
vs.ConvertTo3DPolys(p)
print(vs.GetTypeN(vs.LNewObj()))
vs.Rect(0, 0, 4, 4)
q = vs.LNewObj()
vs.HExtrude(q, 0, 100)
print(vs.GetTypeN(vs.LNewObj()))
vs.Rect(0, 0, 2, 2)
t = vs.LNewObj()
vs.CreateTaperedExtrude(t, 10, 100)
print(vs.GetTypeN(vs.LNewObj()))
vs.Poly(0, 0, 10, 0)
path = vs.LNewObj()
vs.Rect(0, 0, 1, 1)
prof = vs.LNewObj()
vs.CreateExtrudeAlongPath(path, prof)
print(vs.GetTypeN(vs.LNewObj()))
`);
  assert.equal(stepsOf(r, "to3d").length, 1);
  assert.equal(stepsOf(r, "xcopy").length, 1);
  assert.equal(stepsOf(r, "taper").length, 1);
  assert.equal(stepsOf(r, "alongpath").length, 1);
  assert.deepEqual(readBack(r), [25, 24, 40, 40]);
}

// ---- layers, views and the working plane ------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.SetLayerElevationN(vs.ActLayer(), 500, 0)
print(json.dumps(vs.GetLayerElevationN(vs.ActLayer())))
vs.Projection(1, 0, 0, 0, 0)
print(vs.GetProjection(vs.ActLayer()))
print(json.dumps(vs.GetWorkingPlane()))
vs.SetWorkingPlane(1, 2, 3, 0, 0, 0)
print(json.dumps(vs.GetWorkingPlane()))
vs.SetView(10, 0, 0, 0, 0, 0)
print(json.dumps(round(vs.GetView()[0], 6)))
vs.ResetOrientation3D()
print(json.dumps(list(vs.GetViewMatrix(vs.ActLayer()))[0]))
`);
  assert.equal(stepsOf(r, "layerelev").length, 1);
  assert.deepEqual(readBack(r), [[500, 0], 1, [0, 0, 0, 0, 0, 0], [1, 2, 3, 0, 0, 0], 0.174533, true]);
}

// ---- a drawing's own 3D objects, read through the host answers --------------------------------------
{
  const snap = blankSnapshot();
  snap.objects.push({ id: "ext-1", type: 24, typeName: "extrude", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 10, 20], attrs: {}, sym: null, records: {}, shape: null });
  const answers = { Bounds3D: [[0, 0, 0, 10, 20, 30]], Solid3D: [[8000, 1400]], Points3D: [[[0, 0, 0], [1, 2, 3]]] };
  const r = ranVs(`${J}import vs
h = vs.FObject()
print(json.dumps(vs.Get3DCntr(h)))
vs.Move3DObj(h, 1, 0, 0)
print(json.dumps(vs.Get3DCntr(h)))
print(json.dumps(vs.ObjVolume(h)))
print(json.dumps(vs.ObjSurfaceArea(h)))
print(json.dumps(vs.GetPolyPt3D(h, 2)))
`, { snapshot: snap, answers });
  assert.deepEqual(readBack(r), [[[5, 10], 15], [[6, 10], 15], 8000, 1400, [2, 2, 3]], "the moved object's vertex moves with it");
  assert.equal(stepsOf(r, "move3d").length, 1);
  for (const code of ["vs.SetRot3D(h, 0, 0, 0, 0, 0, 0)", "vs.Get3DOrientation(h)", "vs.SetPolyPt3D(h, 1, (0, 0), 0)"]) {
    const bad = runVs(`import vs\nh = vs.FObject()\n${code}\n`, { snapshot: snap, answers });
    assert.equal(bad.error?.name, "NotImplementedError", `${code} is not available for a drawing's object`);
  }
}

console.log("vs 3D calls: ok");
