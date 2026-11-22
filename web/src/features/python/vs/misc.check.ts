// Node check of the misc calls (misc.ts, miscSteps.ts): every new call once, with its step, its
// read-back value or its refusal. Run from web/: npx tsx src/features/python/vs/misc.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, ranVs, runVs, type Snapshot, type SnapObject } from "../vsCheck.ts";

const J = "import json\n";

/** The steps of a kind, in order. */
function stepsOf(ops: unknown[][], kind: string): unknown[][] {
  return ops.filter((o) => o[0] === kind) as unknown[][];
}

/** What the script printed, one JSON value a line. */
function readBack(printed: string): unknown[] {
  return printed.trim().split("\n").map((line) => JSON.parse(line) as unknown);
}

/** A line of the drawing with optional markers at its ends (sizes in inches, as the editor keeps them). */
function lineObj(id: string, pts: number[][], markers?: Record<string, unknown>): SnapObject {
  return { id, type: 2, layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 100, 0], attrs: {}, sym: null, records: {}, shape: { kind: "line", pts, closed: false }, markers };
}

/** A closed polygon (type 5) with its corners in millimetres. */
function polyObj(id: string, pts: number[][]): SnapObject {
  const xs = pts.map((p) => p[0] ?? 0);
  const ys = pts.map((p) => p[1] ?? 0);
  return { id, type: 5, layer: LAYER, parent: null, cls: "None", name: "", bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], attrs: { fillPattern: 1, fillFore: 255 }, sym: null, records: {}, shape: { kind: "polygon", pts, closed: true }, markers: undefined };
}

function withObjects(...objects: SnapObject[]): Snapshot {
  const s = blankSnapshot();
  s.objects.push(...objects);
  return s;
}

// ---- alerts -------------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.AlertInform("Done", "All of it", True)
print(json.dumps(vs.AlertCritical("Stop", "")))
`, { answers: { AlertChoice: [1, null] } });
  assert.equal(r.asked.length, 2, "AlertInform and AlertCritical each ask the editor once");
  const [, a] = r.asked[0] ?? [];
  assert.equal(a?.[0], "Script", "the alert is titled Script");
  assert.equal(a?.[1], "Done", "the text is the first argument");
  assert.equal(a?.[2], "All of it", "the advice goes under it");
  assert.equal(a?.[4], 1, "OK is the default button");
  assert.deepEqual(readBack(r.printed), [null], "AlertCritical returns nothing");
}

{
  // Esc or closing gives Cancel's code (0) for AlertQuestion
  const r = ranVs(`${J}import vs
print(json.dumps(vs.AlertQuestion("Delete all?", "Cannot be undone", 0, "Delete", "Keep", "Save first", "")))
`, { answers: { AlertChoice: [null] } });
  assert.deepEqual(readBack(r.printed), [0], "a closed alert answers Cancel's code 0");
  const buttons = JSON.parse(String(r.asked[0]?.[1]?.[3])) as { code: number; label: string }[];
  assert.deepEqual(buttons.map((b) => b.label), ["Keep", "Save first", "Delete"], "Cancel, custom A, then OK");
}

{
  // three buttons: custom B pressed (code 3)
  const r = ranVs(`${J}import vs
print(json.dumps(vs.AlertQuestion("Keep both?", "", 1, "", "", "Left", "Right")))
`, { answers: { AlertChoice: [3] } });
  assert.deepEqual(readBack(r.printed), [3], "custom button B answers 3");
}

{
  // Vectorscript spelling, with the answer given to a variable: custom A (code 2)
  const r = ranVs(`PROCEDURE Test;
VAR ok : INTEGER;
BEGIN
  ok := AlertQuestion('Keep?', '', 1, 'Yes', 'No', 'Maybe', '');
  Message(ok);
END;
RUN(Test);`, { file: "test.vs", answers: { AlertChoice: [2] } });
  assert.deepEqual(r.messages, ["2"], "Vectorscript AlertQuestion returns the pressed code");
}

{
  // no browser that can pause: AlertInform is kept with the run's alerts, as AlrtDialog is
  const snap = blankSnapshot();
  snap.jspi = false;
  const r = ranVs(`import vs\nvs.AlertInform("Kept", "", False)\n`, { snapshot: snap });
  assert.deepEqual(r.alerts, ["Kept"], "without a pausing browser the text is kept for the run's alerts");
}

{
  const r = runVs(`import vs\nvs.AlertQuestion("q", "", 1, "", "", "", "")\n`, { snapshot: (() => { const s = blankSnapshot(); s.jspi = false; return s; })() });
  assert.equal(r.error?.name, "RuntimeError", "a choice without a pausing browser fails plainly");
}

// ---- progress dialogs ---------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.ProgressDlgOpen("Working", True)
vs.ProgressDlgSetTopMsg("top")
vs.ProgressDlgSetBotMsg("bottom")
vs.ProgressDlgStart(100.0, 10)
vs.ProgressDlgSetMeter("step")
vs.ProgressDlgYield(5)
vs.ProgressDlgEnd()
print(json.dumps(vs.ProgressDlgHasCancel()))
vs.ProgressDlgClose()
`);
  assert.equal(r.ops.length, 0, "the progress dialog changes nothing in the drawing");
  assert.deepEqual(readBack(r.printed), [false], "HasCancel answers False: there is no dialog to cancel");
  assert.equal(r.asked.length, 0, "the progress dialog asks the editor nothing");
}

// ---- line markers -------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.Line(0, 0, 50, 0)
vs.SetObjBeginningMarker(vs.LNewObj(), 0, 30, 0.25, 0.0, 0, 0.0, True)
`);
  // Line is a drawing step: the new line gets the marker step with its own id
  assert.equal(stepsOf(r.ops, "add").length, 1, "one line is added");
  const m = stepsOf(r.ops, "markers");
  assert.equal(m.length, 1, "one marker step");
  assert.equal(m[0]?.[2], "start", "the beginning marker");
  assert.deepEqual(m[0]?.[3], { style: "arrow", size: 0.25, angle: 30, width: 0 }, "an arrow of 0.25 inch at 30 degrees");
}

{
  // end marker, slash style, hidden begin marker on an existing line; then read back
  const snap = withObjects(lineObj("L1", [[0, 0], [100, 0]], { start: { style: "dot", size: 0.1, angle: 0, width: 0.1 } }));
  snap.selection = ["L1"];
  const r = ranVs(`${J}import vs
h = vs.Handle("L1")
print(json.dumps(vs.GetObjBeginningMarker(h)))
print(json.dumps(vs.GetObjEndMarker(h)))
vs.SetObjEndMarker(h, 3, 45, 0.5, 0.0, 0, 0.0, True)
vs.SetObjBeginningMarker(h, 2, 0, 0.1, 0.1, 0, 0.0, False)
print(json.dumps(vs.GetObjEndMarker(h)))
`, { snapshot: snap });
  const values = readBack(r.printed);
  assert.deepEqual(values[0], [true, 2, 0, 0.1, 0.1, 0, 0, true], "the dot at the start reads back as style 2");
  assert.deepEqual(values[1], [true, 0, 0, 0, 0, 0, 0, false], "no end marker reads as hidden");
  assert.deepEqual(values[2], [true, 3, 45, 0.5, 0, 0, 0, true], "the end marker set reads back");
  const m = stepsOf(r.ops, "markers");
  assert.deepEqual(m.map((x) => [x[1], x[2], x[3]]), [["L1", "end", { style: "slash", size: 0.5, angle: 45, width: 0 }], ["L1", "start", null]], "the end is a slash, the start hidden");
}

{
  // a rectangle can't have markers; an unknown style is refused
  const r = runVs(`import vs\nvs.Rect(0, 0, 10, 10)\nvs.SetObjEndMarker(vs.LNewObj(), 0, 10, 1, 0, 0, 0, True)\n`);
  assert.equal(r.error?.name, "ValueError", "a rectangle object can't take markers");
  const bad = runVs(`import vs\nln = vs.Line(0, 0, 9, 0)\nvs.SetObjEndMarker(vs.LNewObj(), 5, 10, 1, 0, 0, 0, True)\n`);
  assert.equal(bad.error?.name, "ValueError", "a style Rodeo doesn't draw is refused");
  assert.match(bad.error?.message ?? "", /0 arrow, 2 dot, 3 slash/, "the refusal says which styles there are");
}

{
  // Vectorscript VAR spelling of GetObjBeginningMarker: seven values come back
  const r = ranVs(`PROCEDURE Test;
VAR ok : BOOLEAN; st : LONGINT; an : INTEGER; sz, wd, th : REAL; tb : INTEGER; vis : BOOLEAN; h : HANDLE;
BEGIN
  Line(0, 0, 100, 0);
  h := LNewObj;
  SetObjBeginningMarker(h, 3, 20, 0.2, 0, 0, 0, TRUE);
  ok := GetObjBeginningMarker(h, st, an, sz, wd, tb, th, vis);
  Message(st, ' ', an, ' ', sz, ' ', vis);
END;
RUN(Test);`, { file: "test.vs" });
  assert.deepEqual(r.messages, ["3 20 0.2 TRUE"], "style 3 (slash), angle 20, 0.2 inch, visible");
}

// ---- shapes -------------------------------------------------------------------------------------
{
  // RectangleN: origin, direction (1, 1) and a width of 10, height 4 mm (the height turns counter-clockwise)
  const r = ranVs(`${J}import vs
vs.RectangleN(0, 0, 1, 1, 10, 4)
`);
  const add = stepsOf(r.ops, "add")[0];
  const pts = (add?.[3] as { points: { x: number; y: number }[] }).points.map((p) => [p.x, p.y]);
  const k = Math.SQRT1_2;
  const want = [[0, 0], [10 * k, 10 * k], [10 * k - 4 * k, 10 * k + 4 * k], [-4 * k, 4 * k]];
  pts.forEach((p, i) => {
    assert.ok(Math.abs((p[0] ?? 0) - (want[i]?.[0] ?? 0)) < 1e-9 && Math.abs((p[1] ?? 0) - (want[i]?.[1] ?? 0)) < 1e-9, `corner ${i} of the rotated rectangle`);
  });
  assert.equal((add?.[3] as { kind: string }).kind, "polygon", "drawn as a closed polygon");
}

{
  // Vectorscript spelling of RectangleN with the origin and direction as numbers (6 values)
  const r = ranVs(`PROCEDURE Test;
BEGIN
  RectangleN(5, 5, 0, 1, 20, 10);
END;
RUN(Test);`, { file: "test.vs" });
  assert.equal(stepsOf(r.ops, "add").length, 1, "one rectangle drawn");
}

{
  const r = runVs(`import vs\nvs.RectangleN(0, 0, 0, 0, 10, 4)\n`);
  assert.equal(r.error?.name, "ValueError", "a rectangle needs a direction");
}

{
  // Get2DPt: vertex 3 of a polygon (VAR spelling in Vectorscript, 2 values back)
  const r = ranVs(`PROCEDURE Test;
VAR x, y : REAL; h : HANDLE;
BEGIN
  Rect(0, 0, 10, 20);
  h := LNewObj;
  Get2DPt(h, 3, x, y);
  Message(x, ' ', y);
END;
RUN(Test);`, { file: "test.vs" });
  assert.deepEqual(r.messages, ["10 20"], "vertex 3 is (10, 20) mm, read in the drawing's units");
}

{
  const snap = withObjects(polyObj("P1", [[0, 0], [10, 0], [10, 20], [0, 20]]));
  const r = ranVs(`${J}import vs
print(json.dumps(vs.Get2DPt(vs.Handle("P1"), 2)))
`, { snapshot: snap });
  assert.deepEqual(readBack(r.printed), [[10, 0]], "vertex 2 in Python");
  const bad = runVs(`import vs\nvs.Get2DPt(vs.Handle("P1"), 9)\n`, { snapshot: snap });
  assert.equal(bad.error?.name, "ValueError", "a vertex the object lacks is refused");
}

{
  // PointAlongPoly: 15 mm along the square's first edge then down (VAR spelling via Python)
  const snap = withObjects(polyObj("P1", [[0, 0], [10, 0], [10, 20], [0, 20]]));
  const r = ranVs(`${J}import vs
print(json.dumps(vs.PointAlongPoly(vs.Handle("P1"), 15)))
print(json.dumps(vs.PointAlongPoly(vs.Handle("P1"), 1000)))
`, { snapshot: snap });
  const [a, b] = readBack(r.printed) as [unknown[], unknown[]];
  assert.deepEqual(a, [true, [10, 5, 0], [0, 1, 0]], "15 mm along: 5 mm down the second edge, heading down");
  assert.deepEqual(b, [false, [0, 0, 0], [0, 0, 0]], "past the end: not found");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR ok : BOOLEAN; pt, tg : VECTOR; h : HANDLE;
BEGIN
  Rect(0, 0, 10, 20);
  h := LNewObj;
  ok := PointAlongPoly(h, 5, pt, tg);
  Message(ok);
END;
RUN(Test);`, { file: "test.vs" });
  assert.deepEqual(r.messages, ["TRUE"], "Vectorscript PointAlongPoly is found on the first edge");
}

{
  // ConvertToPolygon of a circle: 8 segments, closed, drawn beside the original on its layer
  const r = ranVs(`${J}import vs
vs.Oval(0, 0, 10, 10)
src = vs.LNewObj()
new = vs.ConvertToPolygon(src, 8)
print(json.dumps(new._id is not None))
`);
  const add = stepsOf(r.ops, "add");
  assert.equal(add.length, 2, "the oval, then the polygon");
  const poly = add[1]?.[3] as { kind: string; points: unknown[]; closed: boolean };
  assert.equal(poly.kind, "polygon", "a polygon");
  assert.equal(poly.points.length, 8, "eight vertices for the resolution 8");
  assert.equal(poly.closed, true, "a whole circle is closed");
  assert.deepEqual(readBack(r.printed), [true], "the new object is a handle");
  assert.ok(stepsOf(r.ops, "attrs").length >= 1, "the source's attributes go to the polygon");
}

{
  const r = runVs(`import vs\nvs.CreateText("x")\nvs.ConvertToPolygon(vs.LNewObj(), 16)\n`);
  assert.equal(r.error?.name, "ValueError", "text can't be converted yet: refused, not drawn wrong");
}

{
  // SetWidth doubles the object's width and keeps its left edge at 0
  const snap = withObjects(polyObj("P1", [[0, 0], [10, 0], [10, 20], [0, 20]]));
  const r = ranVs(`${J}import vs
vs.SetWidth(vs.Handle("P1"), 20)
`, { snapshot: snap });
  const x = stepsOf(r.ops, "xform");
  assert.equal(x.length, 1, "one transform step");
  assert.deepEqual(x[0]?.[2], { a: 2, b: 0, c: 0, d: 1, e: 0, f: 0 }, "scaled 2x along x, left edge kept");
}

{
  const snap = withObjects(polyObj("P1", [[0, 0], [10, 0], [10, 20], [0, 20]]));
  const r = ranVs(`${J}import vs
vs.SetHeight(vs.Handle("P1"), 10)
vs.ResetBBox(vs.Handle("P1"))
`, { snapshot: snap });
  const x = stepsOf(r.ops, "xform");
  assert.deepEqual(x[0]?.[2], { a: 1, b: 0, c: 0, d: 0.5, e: 0, f: 0 }, "halved along y");
  assert.equal(r.ops.length, 1, "ResetBBox changes nothing");
}

// ---- menus, cursor and undo ---------------------------------------------------------------------
{
  const snap = withObjects(
    polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]),
    polyObj("B", [[20, 0], [30, 0], [30, 10], [20, 10]]),
  );
  snap.selection = ["A", "B"];
  const r = ranVs(`${J}import vs
vs.DoMenuTextByName("Group", 0)
`, { snapshot: snap });
  assert.equal(stepsOf(r.ops, "group").length, 1, "Group runs the editor's group step");
}

{
  const r = runVs(`import vs\nvs.DoMenuTextByName("Pop Out Everything", 0)\n`);
  assert.equal(r.error?.name, "NotImplementedError", "an unmapped menu name is refused by name");
  assert.match(r.error?.message ?? "", /Pop Out Everything/, "the message names the command");
}

{
  // accepted and ignored: no steps and no error
  const r = ranVs(`${J}import vs
vs.SetCursor(1309)
vs.RedrawSelection()
vs.NameUndoEvent("Nudge")
vs.UndoOff()
vs.Wait(0)
print(json.dumps(vs.ValidNumStr("12.5")))
print(json.dumps(vs.ValidNumStr("twelve")))
print(json.dumps(vs.CreateUUID()))
`);
  assert.equal(r.ops.length, 0, "the accepted calls change nothing");
  const [num, bad, uuid] = readBack(r.printed) as [unknown[], unknown[], string];
  assert.deepEqual(num, [true, 12.5], "ValidNumStr reads 12.5");
  assert.deepEqual(bad, [false, 0], "ValidNumStr refuses text, with 0");
  assert.match(uuid, /^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$/, "CreateUUID is a braced upper-case GUID");
}

{
  // Vectorscript VAR spelling of ValidNumStr
  const r = ranVs(`PROCEDURE Test;
VAR v : REAL; ok : BOOLEAN;
BEGIN
  ok := ValidNumStr('3.25', v);
  Message(ok, ' ', v);
END;
RUN(Test);`, { file: "test.vs" });
  assert.deepEqual(r.messages, ["TRUE 3.25"], "ValidNumStr in Vectorscript gives the flag and the number");
}

// ---- refusals -----------------------------------------------------------------------------------
{
  const r = runVs(`import vs\nvs.SetTextWidth(vs.LNewObj(), 40)\n`);
  assert.equal(r.error?.name, "NotImplementedError", "text margins aren't in Rodeo's text model");
}

{
  const r = runVs(`import vs\nvs.SetMarkerByClass(vs.Handle("L1"))\n`);
  assert.equal(r.error?.name, "NotImplementedError", "class markers aren't in Rodeo yet");
}

// ---- dimensions ---------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
vs.LinearDim(0, 0, 1000, 0, 250, 0, 0, 0, 0)
`);
  const d = stepsOf(r.ops, "lindim");
  assert.equal(d.length, 1, "LinearDim makes one dimension step");
  assert.deepEqual(d[0]?.slice(1, 6), [0, 0, 1000, 0, 250], "its points and offset in millimetres");
  assert.equal(d[0]?.[6], LAYER, "on the active layer");
}

{
  const r = ranVs(`PROCEDURE Test;
BEGIN
  AngularDim(0, 0, 1000, 0, 0, 1000, 300, 0, 0, 0);
END;
RUN(Test);`, { file: "test.vs" });
  const d = stepsOf(r.ops, "angdim");
  assert.equal(d.length, 1, "Vectorscript AngularDim makes one angle dimension");
  assert.deepEqual(d[0]?.slice(1, 8), [0, 0, 1000, 0, 0, 1000, 300], "start, end, vertex and text offset");
}

{
  const r = runVs(`import vs\nvs.LinearDim(0, 0, 1, 0)\n`);
  assert.equal(r.error?.name, "TypeError", "LinearDim needs its nine numbers");
}

// ---- closed shapes: booleans and offsets ---------------------------------------------------------
{
  const snap = withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]), polyObj("B", [[5, 5], [15, 5], [15, 15], [5, 15]]));
  const r = ranVs(`${J}import vs
h1 = vs.Handle("A")
h2 = vs.Handle("B")
h3 = vs.AddSurface(h1, h2)
print(json.dumps(h3 is not None))
`, { snapshot: snap });
  const s = stepsOf(r.ops, "surf");
  assert.equal(s.length, 1, "AddSurface runs one surface step");
  assert.deepEqual(s[0]?.slice(1, 2), ["add"], "the step is the union");
  assert.deepEqual(s[0]?.[3], ["A", "B"], "over the two surfaces");
  assert.deepEqual(readBack(r.printed), [true], "the union returns a handle");
}

{
  const snap = withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]), polyObj("B", [[5, 5], [15, 5], [15, 15], [5, 15]]));
  const r = ranVs(`${J}import vs
k = vs.ClipSurfaceN(vs.Handle("A"), vs.Handle("B"))
print(json.dumps(k is not None))
`, { snapshot: snap });
  const s = stepsOf(r.ops, "surf");
  assert.equal(s[0]?.[1], "clip", "ClipSurfaceN runs the clip step");
  assert.match(String(s[0]?.[2]), /^new:/, "and returns the new surface's handle");
  assert.deepEqual(readBack(r.printed), [true], "the handle is not nil");
}

{
  const snap = withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]), polyObj("B", [[5, 5], [15, 5], [15, 15], [5, 15]]));
  const r = ranVs(`${J}import vs
vs.ClipSurface(vs.Handle("A"), vs.Handle("B"))
vs.IntersectSurface(vs.Handle("A"), vs.Handle("B"))
`, { snapshot: snap });
  const s = stepsOf(r.ops, "surf");
  assert.deepEqual(s.map((x) => x[1]), ["clip", "isect"], "clip then intersect, in order");
  assert.equal(s[0]?.[2], null, "ClipSurface gives no handle");
  assert.match(String(s[1]?.[2]), /^new:/, "IntersectSurface's result is a stub the run can use");
}

{
  // Vectorscript: clip two rectangles made in the script
  const r = ranVs(`PROCEDURE Test;
VAR h1, h2 : HANDLE;
BEGIN
  Rect(0, 0, 10, 10);
  h1 := LNewObj;
  Rect(5, 5, 15, 15);
  h2 := LNewObj;
  ClipSurface(h1, h2);
END;
RUN(Test);`, { file: "test.vs" });
  const adds = r.ops.filter((o) => o[0] === "add").map((o) => o[1]);
  const clip = stepsOf(r.ops, "surf")[0];
  assert.deepEqual(clip?.[3], [adds[0], adds[1]], "the clip works on the two rectangles made by the script");
}

{
  const snap = withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]));
  const r = ranVs(`${J}import vs
vs.OffsetPoly(vs.Handle("A"), 2, 2, False, False, 0, 0.1)
vs.OffsetPolyN(vs.Handle("A"), -1, True)
`, { snapshot: snap });
  const o = stepsOf(r.ops, "offset");
  assert.equal(o.length, 2, "two offset steps");
  assert.deepEqual(o[0]?.slice(2), ["A", 2, 2, true, false], "OffsetPoly: 2 mm, two copies, smooth as sharpCorners is False");
  assert.deepEqual(o[1]?.slice(2), ["A", -1, 1, true, false], "OffsetPolyN: inward, one copy, smooth");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR h, h2 : HANDLE;
BEGIN
  Rect(0, 0, 10, 10);
  h := LNewObj;
  h2 := OffsetPolyClosed(h, 1, FALSE);
END;
RUN(Test);`, { file: "test.vs" });
  assert.equal(stepsOf(r.ops, "offset").length, 1, "Vectorscript OffsetPolyClosed makes one offset");
}

{
  // the editor's object wrapper gives a polyline result with its class and attributes
  const r = ranVs(`${J}import vs
vs.ConvertToPolyline(vs.Handle("A"))
`, { snapshot: withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]])) });
  const adds = r.ops.filter((o) => o[0] === "add");
  assert.equal(adds.length, 1, "ConvertToPolyline adds one object");
  assert.equal((adds[0]?.[3] as { kind: string }).kind, "polyline", "the new object is a polyline");
}

// ---- date, screen, view, origin, keys -------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
print(json.dumps([vs.Date(2, 1), vs.Date(1, 1), vs.Date(0, 0), vs.Date(2, 2)]))
`);
  const [dates] = readBack(r.printed) as string[][];
  const [short, abbrev, full, time] = dates ?? [];
  assert.match(short ?? "", /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/, "Date(2, 1) is short: a date and a time");
  assert.match(time ?? "", /^\d{2}:\d{2}$/, "Date(2, 2) is the time only");
  assert.match(abbrev ?? "", /^[A-Z][a-z]{2} \d{2}, \d{4} \d{2}:\d{2}$/, "Date(1, 1) is abbreviated with the time");
  assert.match(String(full), /^[A-Z][a-z]+, [A-Z][a-z]+ \d{2}, \d{4}$/, "Date(0, 0) is the full date");
}

{
  const r = ranVs(`${J}import vs
print(json.dumps(vs.GetScreen()))
`, { snapshot: (() => { const s = blankSnapshot(); (s as Record<string, unknown>).screen = [0, 0, 1440, 900]; return s; })() });
  assert.deepEqual(readBack(r.printed), [[0, 0, 1440, 900]], "GetScreen gives the editor's screen in pixels");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR x1, y1, x2, y2 : INTEGER;
BEGIN
  GetScreen(x1, y1, x2, y2);
  Message(x2, ' ', y2);
END;
RUN(Test);`, { file: "test.vs", snapshot: (() => { const s = blankSnapshot(); (s as Record<string, unknown>).screen = [0, 0, 1440, 900]; return s; })() });
  assert.deepEqual(r.messages, ["1440 900"], "Vectorscript GetScreen gives the far corner");
}

{
  // the centre: set in millimetres, read back, and given to the editor when the run ends
  const probe = ranVs(`${J}import vs\nvs.SetVCenter(1, 0)\n`);
  const U = (probe.viewCenter as number[])[0] ?? 1;
  const r = ranVs(`${J}import vs
vs.SetVCenter(10, 20)
print(json.dumps(vs.GetVCenter()))
`);
  assert.deepEqual(readBack(r.printed), [[10, 20]], "GetVCenter reads back what SetVCenter set (in the drawing's units)");
  assert.deepEqual(r.viewCenter, [10 * U, 20 * U], "the editor's view centre is set when the run ends");
}

{
  const r = ranVs(`${J}import vs
print(json.dumps([vs.GetOrigin(), vs.GetOriginInDocUnits(), vs.GetSheetLayerUserOrigin(vs.Handle("${LAYER}"))]))
vs.SetOrigin(0, 0)
vs.SetOriginAbsolute(0, 0)
`);
  assert.deepEqual(readBack(r.printed), [[[0, 0], [0, 0], [true, 0, 0]]], "the origin is 0, 0 and the sheet layer's origin is too");
}

{
  const r = runVs(`import vs\nvs.SetOrigin(10, 0)\n`);
  assert.equal(r.error?.name, "NotImplementedError", "a non-zero origin is refused");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR x, y : REAL; k : INTEGER;
BEGIN
  GetOrigin(x, y);
  GetKeyDown(k);
  Message(x, ' ', y, ' ', k);
END;
RUN(Test);`, { file: "test.vs" });
  assert.deepEqual(r.messages, ["0 0 0"], "Vectorscript GetOrigin gives 0, 0 and GetKeyDown gives 0");
}

{
  const r = ranVs(`${J}import vs
print(json.dumps([vs.GetKeyDown(), vs.KeyDown()]))
`);
  assert.deepEqual(readBack(r.printed), [[0, [false, 0]]], "no key is held: GetKeyDown 0 and KeyDown False, 0");
}

{
  const r = runVs(`import vs\nvs.BeginGroupN(vs.Handle("G"))\n`);
  assert.equal(r.error?.name, "NotImplementedError", "BeginGroupN on an existing group is refused");
}

{
  const r = ranVs(`${J}import vs
g = [None]
vs.BeginGroupN(None)
vs.Rect(0, 0, 10, 10)
vs.EndGroup()
vs.HUngroup(vs.LNewObj())
`);
  assert.equal(stepsOf(r.ops, "ungroup").length, 1, "HUngroup takes the group apart");
}

{
  const r = ranVs(`${J}import vs
print(json.dumps(vs.IsObjectFromReferencedFile(vs.Handle("A"))))
`, { snapshot: withObjects(polyObj("A", [[0, 0], [1, 0], [1, 1]])) });
  assert.deepEqual(readBack(r.printed), [false], "Rodeo loads no referenced files");
}

// ---- dialogs ----------------------------------------------------------------------------------------
{
  const r = ranVs(`${J}import vs
print(json.dumps([vs.AngDialog("Angle", "45"), vs.DistDialog("Length", "2")]))
`, { answers: { RealDialog: [45, 2] } });
  assert.deepEqual(readBack(r.printed), [[45, 2]], "AngDialog and DistDialog take a real from the number dialog");
  assert.deepEqual(r.asked.map((a) => a[0]), ["RealDialog", "RealDialog"], "each asks the number dialog once");
}

{
  const r = ranVs(`${J}import vs
print(json.dumps(vs.PtDialog("Point", "1", "2")))
`, { answers: { RealDialog: [3, 4] } });
  assert.deepEqual(readBack(r.printed), [[3, 4]], "PtDialog asks x then y");
}

{
  const r = ranVs(`${J}import vs
vs.AlertInformDontShowAgain("Saved", "", False, None)
print(json.dumps(vs.AlertQuestionDontShowAgain("Again?", "", 1, "", "", "", "", None)))
`, { answers: { AlertChoice: [null, 1] } });
  assert.equal(r.asked.length, 2, "both plain alerts show");
  assert.deepEqual(readBack(r.printed), [1], "the question answers the button pressed");
}

// ---- menu commands -----------------------------------------------------------------------------------
{
  const snap = withObjects(polyObj("A", [[0, 0], [10, 0], [10, 10], [0, 10]]));
  snap.selection = ["A"];
  for (const name of ["Duplicate…", "Rotate Left 90°", "Flip Horizontal", "send  forward", "Deselect All", "Clear"]) {
    const r = ranVs(`${J}import vs\nvs.DoMenuTextByName(${JSON.stringify(name)}, 0)\n`, { snapshot: snap });
    assert.ok(!r.error, `${name} runs without an error`);
  }
}

{
  const r = runVs(`import vs\nvs.DoMenuTextByName("Lock…", 0)\n`);
  assert.equal(r.error?.name, "NotImplementedError", "a menu command Rodeo doesn't have is refused");
}

console.log("vs misc calls: ok");
