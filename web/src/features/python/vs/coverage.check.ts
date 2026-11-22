// Node check that every vs call added in the latest round has a test, and that no public call of the
// parts or of the core's layout-dialog section is left without one. Run from web/:
//   npx tsx src/features/python/vs/coverage.check.ts
//
// Each call is asserted by what it does: the step it records, the value a Get twin or the run's result
// reads back, or the error a refused call stops the script with (its name and its message). Where the
// reference's Vectorscript or Python form does not match what Rodeo accepts, the check asserts what
// Rodeo does and says so in a comment; those are listed in the report, not fixed here.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankSnapshot, LAYER, pluginSnapshot, ranVs, runVs, type Snapshot, type VsOutcome } from "../vsCheck.ts";
import { VS_CORE_SOURCE, VS_SOURCE } from "../vsModule.ts";
import { VS_PART_NAMES, VS_PARTS } from "./index.ts";

const J = "import json\n";

/** The steps of a kind, in order. */
function stepsOf(r: VsOutcome, kind: string): unknown[][] {
  return r.ops.filter((o) => o[0] === kind) as unknown[][];
}

/** What the script printed, one JSON value per line. */
function readBack(r: VsOutcome): unknown[] {
  return r.printed.trim().split("\n").map((line) => JSON.parse(line) as unknown);
}

/** What the script said with Message, one entry each. */
function messages(r: VsOutcome): string[] {
  return Array.isArray(r.messages) ? (r.messages as string[]) : [];
}

/** The files the script handed back, by name, as text. */
function handed(r: VsOutcome): Map<string, string> {
  const files = (r.files ?? []) as { name: string; base64: string }[];
  return new Map(files.map((f) => [f.name, Buffer.from(f.base64, "base64").toString("utf8")]));
}

/** The tool session the run's result holds (the mode bar of a setup run). */
function toolModes(r: VsOutcome): Record<string, unknown>[] {
  return (r as unknown as { toolSession: { modes: Record<string, unknown>[] } }).toolSession.modes;
}

/** A tool run's snapshot: a setup run of the tool "Test Slot" (its block as the session makes it). */
function toolRun(): Snapshot {
  const tool = { event: 3, msg1: 0, msg2: 0, points: [], current: null, behavior: 2, help: "", modes: [], data: {} };
  // the session's tool block rides along with the plug-in block (toolEvents.check.ts does the same)
  const snap = blankSnapshot();
  Object.assign(snap, { plugin: { name: "Test Slot", object: null, isNew: false, params: [], event: 3, eventData: 0, tool } });
  return snap;
}

/** A drawing with one extrude (type 24, 10 x 20 mm in plan), whose solid the editor measures. */
function solidDrawing(units?: Record<string, unknown>): Snapshot {
  const snap = blankSnapshot();
  if (units) snap.units = units;
  snap.objects.push({ id: "ext-1", type: 24, typeName: "extrude", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 10, 20], attrs: {}, sym: null, records: {}, shape: null });
  return snap;
}

/** The script stops with Rodeo's plain refusal for the call: its error name and its message. */
function refused(r: VsOutcome, name: string): void {
  assert.equal(r.error?.name, "NotImplementedError", `vs.${name} is refused`);
  // the Python spelling says vs.Name; a Vectorscript run's message names the call without the vs. prefix
  assert.ok((r.error?.message ?? "").includes(`${name} isn't available in Rodeo yet`), r.error?.message);
  assert.equal(r.ops.length, 0, `a refused ${name} records no step`);
}

// ---- solids: the measures of a drawing's solid, read through the editor ---------------------------

{
  const r = ranVs(
    `${J}import vs
h = vs.FObject()
print(json.dumps(vs.CalcVolume(h)))
print(json.dumps(vs.CalcSurfaceArea(h)))
print(json.dumps(vs.ObjSurfAreaInWorldC(h)))
`,
    { snapshot: solidDrawing(), answers: { Solid3D: [[8000, 1400]] } },
  );
  assert.deepEqual(readBack(r), [8000, 1400, 1400], "CalcVolume, CalcSurfaceArea and ObjSurfAreaInWorldC give mm3 and mm2 in a millimetre drawing");
  assert.deepEqual(r.ops, [], "measuring records no step");
}
{
  // in an inch drawing (25.4 mm each) the volume is in cubic inches and the area in square inches
  const r = ranVs(
    `${J}import vs
h = vs.FObject()
print(json.dumps(vs.CalcVolume(h)))
print(json.dumps(vs.CalcSurfaceArea(h)))
print(json.dumps(vs.ObjSurfAreaInWorldC(h)))
`,
    { snapshot: solidDrawing({ mm: 25.4, mark: "in", area: "in²", format: 0, display: 2 }), answers: { Solid3D: [[8000, 1400]] } },
  );
  const [vol, area, world] = readBack(r) as number[];
  assert.ok(Math.abs((vol ?? NaN) - 8000 / 25.4 ** 3) < 1e-9, `volume in cubic inches: ${vol}`);
  assert.ok(Math.abs((area ?? NaN) - 1400 / 25.4 ** 2) < 1e-9, `area in square inches: ${area}`);
  assert.equal(world, area, "ObjSurfAreaInWorldC is the same area as CalcSurfaceArea");
}
{
  // Vectorscript spellings: the solid's volume and area as a PROCEDURE's variables
  const r = ranVs(
    `PROCEDURE Main;
VAR volume, area, world : REAL;
    h : HANDLE;
BEGIN
  h := FObject();
  volume := CalcVolume(h);
  area := CalcSurfaceArea(h);
  world := ObjSurfAreaInWorldC(h);
  Message(volume, ' ', area, ' ', world);
END;
RUN(Main);
`,
    { file: "measure.vs", snapshot: solidDrawing(), answers: { Solid3D: [[8000, 1400]] } },
  );
  assert.deepEqual(messages(r), ["8000 1400 1400"], "the three measures, read in Vectorscript");
}

// ---- solids made in the run: extrude, mesh and group --------------------------------------------

{
  const r = ranVs(
    `${J}import vs
vs.Rect(0, 0, 2, 3)
p = vs.LNewObj()
t = vs.CreateTaperedExtrd2(p, 45.0, 100)
print(json.dumps([vs.GetTypeN(t), t is not None]))
m = vs.MeshToGroup(t)
print(json.dumps(vs.GetTypeN(m)))
m2 = vs.GroupToMesh(m)
print(json.dumps([vs.GetTypeN(m2), vs.CnvrtToGenericSolid(m2) == m2]))
`,
  );
  // a mesh (type 40), its group of 3D polygons (type 11), and the mesh again (40); the converted solid is the same one
  assert.deepEqual(readBack(r), [[40, true], 11, [40, true]], "the tapered extrude is a mesh; MeshToGroup gives a group; GroupToMesh gives a mesh");
  assert.deepEqual(
    r.ops.map((o) => o[0]),
    ["add", "taper", "to3d", "tomesh"],
    "one step each for the profile, the taper, the mesh-to-group and the group-to-mesh; CnvrtToGenericSolid records none",
  );
  const taper = stepsOf(r, "taper")[0];
  assert.deepEqual(taper?.slice(3), [45, 100], "the taper's angle (degrees) and height (mm)");
  assert.equal(stepsOf(r, "to3d")[0]?.[3], 11, "MeshToGroup asks for 3D polygons (type 11)");
}
{
  // Vectorscript: CreateTaperedExtrd2 with a profile and two REAL arguments
  const r = ranVs(
    `PROCEDURE Main;
VAR profileH, resultH : HANDLE;
BEGIN
  Rect(0, 0, 2, 3);
  profileH := LNewObj();
  resultH := CreateTaperedExtrd2(profileH, 1.0, 2.0);
  Message(GetTypeN(resultH));
END;
RUN(Main);
`,
    { file: "taper.vs" },
  );
  assert.deepEqual(messages(r), ["40"], "the made extrude is a mesh");
  assert.deepEqual(stepsOf(r, "taper")[0]?.slice(3), [1, 2], "angle 1 degree, height 2 mm");
}
{
  // the drawing's own solid: CnvrtToGenericSolid gives back the same handle and records nothing
  const r = ranVs(`${J}import vs
h = vs.FObject()
print(json.dumps(vs.CnvrtToGenericSolid(h) == h))
`, { snapshot: solidDrawing() });
  assert.deepEqual(readBack(r), [true]);
  assert.deepEqual(r.ops, []);
}

// ---- the working plane and the view matrix ------------------------------------------------------

{
  // Python: the plane as SetWorkingPlaneN kept it (its centre, normal and U vector), ground plane until then
  const r = ranVs(`${J}import vs
print(json.dumps(vs.GetWorkingPlaneN()))
vs.SetWorkingPlaneN((1, 2, 3), (0, 0, 1), (1, 0, 0))
print(json.dumps(vs.GetWorkingPlaneN()))
`);
  assert.deepEqual(readBack(r), [
    [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
    [[1, 2, 3], [0, 0, 1], [1, 0, 0]],
  ]);
  assert.deepEqual(r.ops, [], "the working plane is kept for the run and records no step");
}
{
  // Vectorscript: GetWorkingPlaneN's nine VAR outputs, which the translator takes from the reference
  const r = ranVs(
    `PROCEDURE Main;
VAR oX, oY, oZ, nX, nY, nZ, uX, uY, uZ : REAL;
BEGIN
  GetWorkingPlaneN(oX, oY, oZ, nX, nY, nZ, uX, uY, uZ);
  Message(oX, ' ', nZ, ' ', uX);
END;
RUN(Main);
`,
    { file: "plane.vs" },
  );
  assert.deepEqual(messages(r), ["0 1 1"], "the ground plane: centre x 0, normal z 1, U vector x 1");
}
{
  // SetViewMatrix (Python, as the reference's Python block): the layer's offset and turns, read back by GetViewMatrix
  const r = ranVs(`${J}import vs
layer = vs.ActLayer()
print(json.dumps(vs.SetViewMatrix(layer, (1, 2, 3), 10, 20, 30)))
print(json.dumps(vs.GetViewMatrix(layer)))
`);
  assert.deepEqual(readBack(r), [true, [true, [1, 2, 3], 10, 20, 30]], "SetViewMatrix returns True; GetViewMatrix reads the same matrix back");
  assert.deepEqual(r.ops, [], "the view matrix is kept, nothing is drawn from it");
}
{
  // Discrepancy (reported, not fixed): the reference's Pascal form of SetViewMatrix takes the offset as three
  // REALs (offsetX, offsetY, offsetZ), but Rodeo keeps the Python form's one offset point, so the seven
  // arguments of the Pascal form are refused with the arity error.
  const r = runVs(`PROCEDURE Main;
VAR ok : BOOLEAN;
BEGIN
  ok := SetViewMatrix(ActLayer, 1, 2, 3, 10, 20, 30);
END;
RUN(Main);
`, { file: "view.vs" });
  assert.equal(r.error?.name, "TypeError");
  assert.ok((r.error?.message ?? "").includes("takes 5 positional arguments but 7 were given"), r.error?.message);
}
{
  // Discrepancy (reported, not fixed): the reference's own Vectorscript example sets the plane with nine REALs
  // (SetWorkingPlaneN(oX,oY,oZ,nX,nY,nZ,uX,uY,uZ)); Rodeo takes the Python form's three points, so the
  // nine-argument spelling is refused with the arity error.
  const r = runVs(`PROCEDURE Main;
BEGIN
  SetWorkingPlaneN(1, 2, 3, 0, 0, 1, 1, 0, 0);
END;
RUN(Main);
`, { file: "plane2.vs" });
  assert.equal(r.error?.name, "TypeError");
  assert.ok((r.error?.message ?? "").includes("takes 3 positional arguments but 9 were given"), r.error?.message);
}

// ---- object variable points: no selector the appendix lists holds a point ------------------------

{
  // Rodeo's table has no point-valued selector; a boolean one (680) refuses a point
  const r = runVs(`${J}import vs
vs.SetObjectVariablePoint(vs.ActLayer(), 680, (1, 2, 3))
`);
  assert.equal(r.error?.name, "TypeError");
  assert.ok((r.error?.message ?? "").includes("selector 680 holds a bool, not a point"), r.error?.message);
}
{
  // an index the appendix doesn't list is refused by its number
  const r = runVs(`import vs
vs.SetObjectVariablePoint(vs.ActLayer(), 1300, (1, 2, 3))
`);
  assert.equal(r.error?.name, "ValueError");
  assert.ok((r.error?.message ?? "").includes("vs.SetObjectVariablePoint(h, 1300): Rodeo doesn't know object variable 1300"), r.error?.message);
}

// ---- layout dialogs: RefreshItem is accepted and ignored ----------------------------------------

{
  // the editor redraws each control itself: RefreshItem returns None, changes nothing and records no step
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("Refresh")
vs.CreateStaticText(dlg, 10, "hi")
print(json.dumps(vs.RefreshItem(dlg, 10)))
print(json.dumps(vs.GetItemText(dlg, 10)))
`);
  assert.deepEqual(readBack(r), [null, "hi"], "RefreshItem returns None and the text is as it was");
  assert.deepEqual(r.ops, [], "no step is recorded");
}
{
  // the item must exist (the dialog's own check), in both spellings
  const r = runVs(`import vs
dlg = vs.CreateLayout("Refresh")
vs.RefreshItem(dlg, 99)
`);
  assert.equal(r.error?.name, "ValueError");
  assert.ok((r.error?.message ?? "").includes("has no item 99"), r.error?.message);
  const v = ranVs(`PROCEDURE Main;
VAR dlg : LONGINT;
    text : STRING;
BEGIN
  dlg := CreateLayout('Refresh');
  CreateStaticText(dlg, 10, 'hi');
  RefreshItem(dlg, 10);
  GetItemText(dlg, 10, text);
  Message(text);
END;
RUN(Main);
`, { file: "refresh.vs" });
  assert.deepEqual(messages(v), ["hi"], "Vectorscript: RefreshItem leaves the text alone");
}

// ---- popups of a plug-in's widgets --------------------------------------------------------------

{
  // clearing one widget's popup empties it and leaves the others' choices alone
  const r = ranVs(
    `${J}import vs
vs.vsoWidgetPopupAdd(1, "a", "Alpha")
vs.vsoWidgetPopupAdd(1, "b", "Beta")
vs.vsoWidgetPopupAdd(2, "c", "Gamma")
vs.vsoWidgetPopupClear(1)
print(json.dumps([vs.vsoWidgetPopupGetCnt(1), vs.vsoWidgetPopupGetCnt(2)]))
`,
    { snapshot: pluginSnapshot("Test", []) },
  );
  assert.deepEqual(readBack(r), [[0, 1]], "widget 1 has no choices, widget 2 keeps its one");
  assert.deepEqual(r.ops, [], "popups are kept for the Object Info layout, no step");
}
{
  const r = ranVs(
    `PROCEDURE Main;
BEGIN
  vsoWidgetPopupAdd(1, 'a', 'Alpha');
  vsoWidgetPopupAdd(1, 'b', 'Beta');
  vsoWidgetPopupClear(1);
  Message(vsoWidgetPopupGetCnt(1));
END;
RUN(Main);
`,
    { file: "popup.vs", snapshot: pluginSnapshot("Test", []) },
  );
  assert.deepEqual(messages(r), ["0"], "Vectorscript: the popup has no choices after the clear");
}

// ---- files: WriteLnMac ends each line with a carriage return ------------------------------------

{
  // the Mac line end is a carriage return alone; the text is written as WriteLn writes it
  // (Rodeo does not apply the Mac character set to 128 to 255: see the report)
  const r = ranVs(
    `${J}import vs
f = vs.PutFile("Name the file", "untitled.txt")
vs.WriteLnMac("one", 2)
vs.WriteLnMac("four")
vs.Close(f)
`,
    { answers: { StrDialog: ["mac.txt"] } },
  );
  assert.equal(handed(r).get("mac.txt"), "one2\rfour\r", "two lines, each ending in a carriage return");
}
{
  const r = ranVs(
    `PROCEDURE Main;
VAR fname : STRING;
BEGIN
  PutFile('Name the file', 'untitled.txt', fname);
  WriteLnMac('x', 3);
  Close(fname);
END;
RUN(Main);
`,
    { file: "write.vs", answers: { StrDialog: ["v.txt"] } },
  );
  assert.equal(handed(r).get("v.txt"), "x3\r", "Vectorscript: the line written to the file it opened");
}

// ---- the mode bar of a tool: vstAddButtonMode and vstAddRadioMode --------------------------------

{
  const r = ranVs(
    `${J}import vs
vs.vstAddRadioMode(2, 3, "Round.svg", "Square.svg", "Tri.svg", "", "", "")
vs.vstAddButtonMode("Options.svg")
`,
    { file: "Test Slot.py", snapshot: toolRun() },
  );
  assert.deepEqual(toolModes(r), [
    { kind: "radio", icons: ["Round.svg", "Square.svg", "Tri.svg"], items: [], label: "", value: 2, enabled: true },
    { kind: "button", icons: ["Options.svg"], items: [], label: "", value: 0, enabled: true },
  ], "the radio group takes its first three icons (inNumButtons) and starts at 2; the button is next in the bar");
}
{
  const r = ranVs(
    `PROCEDURE Setup;
BEGIN
  vstAddRadioMode(1, 2, 'Round.svg', 'Square.svg', '', '', '', '');
  vstAddButtonMode('Options.svg');
END;
RUN(Setup);
`,
    { file: "Test Slot.vs", snapshot: toolRun() },
  );
  assert.deepEqual(toolModes(r).map((m) => [m["kind"], m["icons"], m["value"]]), [
    ["radio", ["Round.svg", "Square.svg"], 1],
    ["button", ["Options.svg"], 0],
  ], "Vectorscript: the same two modes");
}

// ---- worksheet images: the display settings are kept for the run ---------------------------------

/** A drawing with one worksheet, so that a run can make a worksheet of its own (CreateWS copies its settings). */
function wsDrawing(): Snapshot {
  const old = { index: 7, name: "Old", rows: 3, cols: 3, database: [false, false, true], limit: null, cells: [{ row: 0, col: 0, kind: "text", text: "Name", value: null }] };
  return { ...blankSnapshot(), worksheets: [old], wsNames: [] };
}

const SPAN_CALLS = [
  "SetWSImgAngle",
  "SetWSImgComponent",
  "SetWSImgMarginSize",
  "SetWSImgRenderMode",
  "SetWSImgSize",
  "SetWSImgSizeType",
  "SetWSImgType",
  "SetWSImgUseLayScale",
  "SetWSImgUseObjectImg",
  "SetWSImgView",
];
{
  // the range-form settings (worksheet, top row, left column, bottom row, right column, the value)
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Images", 4, 3)
vs.SetWSImgAngle(ws, 1, 1, 2, 2, 45.0)
vs.SetWSImgComponent(ws, 1, 1, 2, 2, 1)
vs.SetWSImgMarginSize(ws, 1, 1, 2, 2, 2.5)
vs.SetWSImgRenderMode(ws, 1, 1, 2, 2, 1)
vs.SetWSImgSize(ws, 1, 1, 2, 2, 30, 40)
vs.SetWSImgSizeType(ws, 1, 1, 2, 2, 2)
vs.SetWSImgType(ws, 1, 1, 2, 2, 1)
vs.SetWSImgUseLayScale(ws, 1, 1, 2, 2, True)
vs.SetWSImgUseObjectImg(ws, 1, 1, 2, 2, False)
vs.SetWSImgView(ws, 1, 1, 2, 2, 3)
vs.SetWSCellsImgDPIRes(ws, 300)
vs.SetWSImageScaleF(ws, 1.5, True)
`, { snapshot: wsDrawing() });
  const kept = r.wsKept as string[];
  for (const name of [...SPAN_CALLS, "SetWSCellsImgDPIRes", "SetWSImageScaleF"]) {
    assert.ok(kept.includes(name), `${name} is kept for the run`);
  }
  assert.equal(kept.length, 12, "exactly the twelve image calls are kept, nothing else");
}
{
  // the cells must be on the worksheet (4 rows, 3 columns here)
  const r = runVs(`${J}import vs
ws = vs.CreateWS("Images", 4, 3)
vs.SetWSImgAngle(ws, 1, 1, 5, 3, 45.0)
`, { snapshot: wsDrawing() });
  assert.equal(r.error?.name, "ValueError");
  assert.ok((r.error?.message ?? "").includes("are outside the worksheet"), r.error?.message);
}
{
  // a handle that is not a worksheet is refused, for both the range form and the image form
  const r = runVs(`${J}import vs
vs.Rect(0, 0, 2, 3)
vs.SetWSImgAngle(vs.LNewObj(), 1, 1, 2, 2, 45.0)
`);
  assert.equal(r.error?.name, "ValueError");
  assert.ok((r.error?.message ?? "").includes("this is not a worksheet"), r.error?.message);
  const q = runVs(`${J}import vs
vs.Rect(0, 0, 2, 3)
vs.SetWSImageScaleF(vs.LNewObj(), 1.5, True)
`);
  assert.equal(q.error?.name, "ValueError");
  assert.ok((q.error?.message ?? "").includes("this is not a worksheet or a worksheet image"), q.error?.message);
}
{
  // Vectorscript: the range form with its value, and the image scale with its REAL and BOOLEAN
  const r = ranVs(
    `PROCEDURE Main;
VAR ws : HANDLE;
BEGIN
  ws := CreateWS('Images', 4, 3);
  SetWSImgSize(ws, 1, 1, 2, 2, 30, 40);
  SetWSImageScaleF(ws, 1.5, TRUE);
END;
RUN(Main);
`,
    { file: "images.vs", snapshot: wsDrawing() },
  );
  const kept = r.wsKept as string[];
  assert.ok(kept.includes("SetWSImgSize") && kept.includes("SetWSImageScaleF"), "Vectorscript: both calls are kept for the run");
}

// ---- the calls Rodeo refuses -----------------------------------------------------------------------
// Each is refused by its own message (the script stops there and records nothing). Any argument list of the
// right length reaches the refusal, so each call is given its documented arguments.

const REFUSED: [name: string, call: string][] = [
  ["AddLBImage", `vs.AddLBImage(d, 10, 1, 128)`],
  ["AddLBOriginalName", `vs.AddLBOriginalName(d, 10, "Walls")`],
  ["AddListBrowserImage", `vs.AddListBrowserImage(d, 10, "Vectorworks/Icon.svg")`],
  ["CreateDataVisPDMenu", `vs.CreateDataVisPDMenu(d, 10, 120, True)`],
  ["CreateIconPushButton", `vs.CreateIconPushButton(d, 10, 1, 12)`],
  ["CreatePullDownMenuGroupBox", `vs.CreatePullDownMenuGroupBox(d, 10, 120, "Label", True)`],
  ["DeregisterDialogFromTimerEvents", `vs.DeregisterDialogFromTimerEvents(d)`],
  ["GetColorButton", `vs.GetColorButton(d, 10)`],
  ["GetComponentRect", `vs.GetComponentRect(d, 10)`],
  ["GetComponentTextWidth", `vs.GetComponentTextWidth(d, 10)`],
  ["GetDlgCtrlWidthStdCh", `vs.GetDlgCtrlWidthStdCh("Example")`],
  ["GetLBHeaderTextWidth", `vs.GetLBHeaderTextWidth("Name", True)`],
  ["GetLBItemOrigName", `vs.GetLBItemOrigName(d, 10, 0)`],
  ["GetLBOrigNameClLevel", `vs.GetLBOrigNameClLevel(d, 10, "Walls")`],
  ["GetLayoutDialogPosition", `vs.GetLayoutDialogPosition(d)`],
  ["GetLayoutDialogSize", `vs.GetLayoutDialogSize(d)`],
  ["GetLineTypeAtIndex", `vs.GetLineTypeAtIndex(d, 10, 0)`],
  ["GetSelectionRange", `vs.GetSelectionRange(d, 10)`],
  ["InsertImagePopupResource", `vs.InsertImagePopupResource(d, 10, 1, 0)`],
  ["IsClassChoiceSelected", `vs.IsClassChoiceSelected(d, 10)`],
  ["RegisterDialogForTimerEvents", `vs.RegisterDialogForTimerEvents(d, 100)`],
  ["RunNamedDialog", `vs.RunNamedDialog(d, None, "Name")`],
  ["RunNamedDialogN", `vs.RunNamedDialogN(d, None, "Name", False)`],
  ["SelectClassChoice", `vs.SelectClassChoice(d, 10, True)`],
  ["SetColorButton", `vs.SetColorButton(d, 10, 255, 0, 0)`],
  ["SetImageControlHandle", `vs.SetImageControlHandle(d, 10, 1)`],
  ["SetLBImageIndexes", `vs.SetLBImageIndexes(d, 10, 0, 0, 1, 2, 3)`],
  ["SetLBOrigNameClLevel", `vs.SetLBOrigNameClLevel(d, 10, "Walls", False, False, False)`],
  ["SetVSResourceFile", `vs.SetVSResourceFile("resources.rsrc")`],
  ["ShowByClassChoice", `vs.ShowByClassChoice(d, 10)`],
];
for (const [name, call] of REFUSED) {
  refused(runVs(`${J}import vs\nd = vs.CreateLayout("Refused")\n${call}\n`), name);
}
{
  // the Vectorscript spelling of two refused calls with VAR outputs reaches the same refusal
  refused(runVs(`PROCEDURE Main;
VAR d : LONGINT;
    w, h : LONGINT;
BEGIN
  d := CreateLayout('Refused');
  GetLayoutDialogSize(d, w, h);
END;
RUN(Main);
`, { file: "size.vs" }), "GetLayoutDialogSize");
  refused(runVs(`PROCEDURE Main;
VAR d : LONGINT;
    kind : LONGINT;
BEGIN
  d := CreateLayout('Refused');
  GetLineTypeAtIndex(d, 10, 0, kind);
END;
RUN(Main);
`, { file: "line.vs" }), "GetLineTypeAtIndex");
}

// ---- layout dialogs: the controls the editor is sent, read back through their Get calls -----------

/** The dialog specs a run sent to the editor, in order (what layoutDialog.check reads as well). */
function dialogSpecs(r: VsOutcome): { title: string; first: number | null; focus: number | null; items: Record<string, unknown>[] }[] {
  return r.asked.filter(([k]) => k === "Dialog").map(([, args]) => JSON.parse(args[0] as string) as { title: string; first: number | null; focus: number | null; items: Record<string, unknown>[] });
}

/** One item of a dialog spec, by its id. */
function specItem(spec: { items: Record<string, unknown>[] }, id: number): Record<string, unknown> {
  const found = spec.items.find((i) => i.id === id);
  assert.ok(found, `item ${id} is in the spec`);
  return found;
}

{
  // each control is made with its kind, text and size; the spec the editor gets carries them
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("Controls")
vs.CreatePushButton(dlg, 1, "Go")
vs.CreateThreeStateCheckBox(dlg, 2, "Mixed")
vs.CreatePullDownMenu(dlg, 3, 12)
vs.CreateClassPullDownMenu(dlg, 4, 14)
vs.CreateLayerPullDownMenu(dlg, 5, 16)
vs.CreateListBox(dlg, 6, 20, 5)
vs.CreateListBoxN(dlg, 7, 20, 5, True)
vs.CreateColorPopup(dlg, 8, -1)
vs.CreateCheckBoxGroupBox(dlg, 9, "Check group", True)
vs.CreateRadioButtonGroupBox(dlg, 10, "Radio group", False)
vs.CreateSeparator(dlg, 11, 30)
vs.CreateImageControl(dlg, 12, 32, 16, None)
vs.CreateEditTextBox(dlg, 13, "lines", 20, 3)
vs.CreateEditReal(dlg, 14, 3, 2.5, 10)
vs.CreateEditInteger(dlg, 15, 7, 8)
vs.RunLayoutDialog(dlg, lambda item, data: None)
`);
  const spec = dialogSpecs(r)[0];
  assert.ok(spec, "the dialog is sent to the editor");
  const kinds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((id) => specItem(spec, id).kind);
  assert.deepEqual(kinds, ["button", "check3", "popup", "popup", "popup", "list", "list", "color", "checkgroup", "radiogroup", "sep", "frame", "edit", "real", "int"]);
  assert.equal(specItem(spec, 1).text, "Go", "a push button's title");
  assert.equal(specItem(spec, 2).text, "Mixed", "a three-state box's label");
  assert.equal(specItem(spec, 9).text, "Check group", "a check-box group's label");
  assert.equal(specItem(spec, 9).frame, true, "a group box with its frame");
  assert.equal(specItem(spec, 10).frame, false, "a radio group box without its frame");
  assert.deepEqual(specItem(spec, 4).choices, ["None", "Dimension"], "the class pull-down lists the document's classes");
  assert.deepEqual(specItem(spec, 5).choices, ["Design Layer-1"], "the layer pull-down lists the design layers");
  assert.equal(specItem(spec, 6).multi, false, "a list box is single-select");
  assert.equal(specItem(spec, 7).multi, true, "CreateListBoxN with isMultipleSelect true is multi-select");
  assert.equal(specItem(spec, 6).lines, 5, "a list box's height in lines");
  assert.equal(specItem(spec, 13).lines, 3, "a text box's height in lines");
  assert.equal(specItem(spec, 13).text, "lines", "a text box's text");
  assert.equal(specItem(spec, 14).value, 2.5, "a real field's default value");
  assert.equal(specItem(spec, 15).value, 7, "an integer field's default value");
  assert.equal(specItem(spec, 8).value, 0, "a colour popup starts at colour 0");
}
{
  // Vectorscript spelling of the same kinds of control: the run gets the dialog and its layout is verified
  const r = ranVs(
    `PROCEDURE Main;
VAR d : LONGINT;
    ok : BOOLEAN;
BEGIN
  d := CreateLayout('Vectorscript controls');
  CreatePushButton(d, 1, 'Go');
  CreateListBoxN(d, 2, 20, 5, TRUE);
  CreateEditInteger(d, 3, 7, 8);
  ok := VerifyLayout(d);
  Message(ok);
END;
RUN(Main);
`,
    { file: "controls.vs" },
  );
  assert.deepEqual(messages(r), ["TRUE"], "VerifyLayout is true for a laid-out dialog");
  assert.deepEqual(r.ops, [], "a dialog records no step");
}

{
  // choices of a pull-down or list: added, inserted, found, selected, removed and cleared
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("Choices")
vs.CreatePullDownMenu(dlg, 1, 12)
vs.AddChoice(dlg, 1, "Alpha")
vs.AddChoice(dlg, 1, "Gamma")
vs.InsertChoice(dlg, 1, "Beta", 1)
print(json.dumps([vs.GetChoiceCount(dlg, 1), vs.GetChoiceText(dlg, 1, 1), vs.GetChoiceIndex(dlg, 1, "Gamma"), vs.GetChoiceIndex(dlg, 1, "Nope")]))
vs.SelectChoice(dlg, 1, 2, True)
print(json.dumps(vs.GetSelectedChoiceInfo(dlg, 1, 0)))
print(json.dumps(vs.GetSelectedChoiceIndex(dlg, 1, 0)))
vs.SelectChoice(dlg, 1, 2, False)
print(json.dumps(vs.GetSelectedChoiceIndex(dlg, 1, 0)))
vs.RemoveChoice(dlg, 1, 0)
print(json.dumps([vs.GetChoiceCount(dlg, 1), vs.GetChoiceText(dlg, 1, 0)]))
vs.DeleteAllItems(dlg, 1)
print(json.dumps(vs.GetChoiceCount(dlg, 1)))
vs.AddChoice(dlg, 1, "Only")
vs.RemoveAllChoices(dlg, 1)
print(json.dumps(vs.GetChoiceCount(dlg, 1)))
`);
  assert.deepEqual(readBack(r), [[3, "Beta", 2, -1], [2, "Gamma"], 2, -1, [2, "Beta"], 0, 0], "the choices as the calls leave them");
  assert.deepEqual(r.ops, []);
}
{
  // Vectorscript: the calls that hand values back through VAR parameters
  const r = ranVs(
    `PROCEDURE Main;
VAR d, idx : LONGINT;
    txt : STRING;
BEGIN
  d := CreateLayout('Choices');
  CreatePullDownMenu(d, 1, 12);
  AddChoice(d, 1, 'Alpha', -1);
  AddChoice(d, 1, 'Gamma', -1);
  AddChoice(d, 1, 'Beta', 1);
  GetChoiceText(d, 1, 1, txt);
  Message(txt);
  GetChoiceIndex(d, 1, 'Gamma', idx);
  Message(idx);
  SelectChoice(d, 1, 1, TRUE);
  GetSelectedChoiceIndex(d, 1, 0, idx);
  Message(idx);
  GetSelectedChoiceInfo(d, 1, 0, idx, txt);
  Message(idx, ' ', txt);
END;
RUN(Main);
`,
    { file: "choices.vs" },
  );
  assert.deepEqual(messages(r), ["Beta", "2", "1", "1 Beta"]);
}

{
  // the states and values of the controls, read back by their Get calls
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("State")
vs.CreateThreeStateCheckBox(dlg, 2, "Mixed")
vs.SetThreeStateCheckBoxState(dlg, 2, 1)
print(json.dumps(vs.GetThreeStateCheckBoxState(dlg, 2)))
vs.CreateCheckBoxGroupBox(dlg, 9, "Group", True)
vs.SetBooleanItem(dlg, 9, True)
print(json.dumps(vs.GetBooleanItem(dlg, 9)))
vs.CreateEditInteger(dlg, 15, 7, 8)
vs.SetEditInteger(dlg, 15, 42)
print(json.dumps(vs.GetEditInteger(dlg, 15)))
vs.CreateEditReal(dlg, 14, 3, 2.5, 10)
vs.SetEditReal(dlg, 14, 3, 4.25)
print(json.dumps(vs.GetEditReal(dlg, 14, 3)))
vs.CreateColorPopup(dlg, 8, -1)
vs.SetColorChoice(dlg, 8, 3)
print(json.dumps(vs.GetColorChoice(dlg, 8)))
`);
  assert.deepEqual(readBack(r), [1, true, [true, 42], [true, 4.25], 3]);
  assert.deepEqual(r.ops, []);
}
{
  // Vectorscript: GetEditReal hands its REAL back through VAR value
  const r = ranVs(
    `PROCEDURE Main;
VAR d : LONGINT;
    ok : BOOLEAN;
    v : REAL;
BEGIN
  d := CreateLayout('State');
  CreateEditReal(d, 14, 3, 2.5, 10);
  SetEditReal(d, 14, 3, 4.25);
  ok := GetEditReal(d, 14, 3, v);
  Message(ok, ' ', v);
END;
RUN(Main);
`,
    { file: "edit.vs" },
  );
  assert.deepEqual(messages(r), ["TRUE 4.25"]);
}

{
  // a tab control's shown pane, the placing of items, the group's first item, and the item states
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("Place")
vs.CreatePushButton(dlg, 1, "A")
vs.CreatePushButton(dlg, 2, "B")
vs.CreateStaticText(dlg, 3, "C")
vs.CreateCheckBoxGroupBox(dlg, 4, "Group", True)
vs.CreateTabControl(dlg, 20)
vs.CreateTabPane(dlg, 20, 21)
vs.CreateTabPane(dlg, 20, 22)
vs.SetRightItem(dlg, 1, 2, 4, 2)
vs.SetFirstGroupItem(dlg, 4, 3)
vs.EnableItem(dlg, 1, False)
vs.ShowItem(dlg, 2, False)
vs.SetTextEditable(dlg, 3, False)
vs.SetFocusOnItem(dlg, 1)
vs.SelectTabPane(dlg, 20, 22)
print(json.dumps(vs.VerifyLayout(dlg)))
vs.RunLayoutDialog(dlg, lambda item, data: None)
`);
  assert.deepEqual(readBack(r), [true]);
  const spec = dialogSpecs(r)[0];
  assert.ok(spec, "the dialog is sent to the editor");
  assert.equal(specItem(spec, 1).right, 2, "item 2 is placed to the right of item 1");
  assert.equal(specItem(spec, 2).indent, 4, "its indent is 4");
  assert.equal(specItem(spec, 2).space, 2, "its line spacing is 2");
  assert.equal(specItem(spec, 4).first, 3, "the group's first item");
  assert.equal(specItem(spec, 1).enabled, false, "EnableItem switches the button off");
  assert.equal(specItem(spec, 2).visible, false, "ShowItem hides the button");
  assert.equal(specItem(spec, 3).readonly, true, "SetTextEditable(False) makes the text read-only");
  assert.equal(spec.focus, 1, "SetFocusOnItem puts the focus on item 1");
  assert.equal(specItem(spec, 20).value, 22, "SelectTabPane shows pane 22");
}
{
  // a resizable layout is a dialog with its title; Rodeo keeps the size flags for nothing (see the report)
  const r = ranVs(`${J}import vs
dlg = vs.CreateResizableLayout("Resizable", False, "OK", "Cancel", True, False)
print(json.dumps(dlg is not None))
vs.RunLayoutDialog(dlg, lambda item, data: None)
`);
  assert.deepEqual(readBack(r), [true]);
  assert.equal(dialogSpecs(r)[0]?.title, "Resizable", "the dialog's title");
}

{
  // StdRead: a number, then the rest of the line as a string (tabs and spaces included); the line is not left
  const r = ranVs(
    `${J}import vs
p = vs.GetFile()
vs.Open(p)
print(json.dumps(vs.StdRead(int)))
print(json.dumps(vs.StdRead(str)))
print(json.dumps(vs.StdReadLn(str)))
print(json.dumps(vs.ReadLn(str)))
`,
    { answers: { OpenFile: [{ name: "notes.txt", base64: Buffer.from("12 abc\nsecond line\n", "utf8").toString("base64") }] } },
  );
  assert.deepEqual(readBack(r), [12, " abc", "", "second line"]);
}
{
  // Vectorscript: StdRead with two VAR outputs
  const r = ranVs(
    `PROCEDURE Main;
VAR f, s : STRING;
    n : INTEGER;
BEGIN
  GetFile(f);
  Open(f);
  StdRead(n, s);
  Message(n, '|', s);
END;
RUN(Main);
`,
    { file: "read.vs", answers: { OpenFile: [{ name: "notes.txt", base64: Buffer.from("12 abc\n", "utf8").toString("base64") }] } },
  );
  assert.deepEqual(messages(r), ["12| abc"]);
}

{
  // the measures of criteria sums: the area and perimeter of rectangles, the length of a line
  const r = ranVs(`${J}import vs
vs.Rect(0, 0, 10, 20)
vs.MoveTo(0, 0)
vs.Line(30, 40)
print(json.dumps([vs.AreaN("T=RECT"), vs.PerimN("T=RECT"), vs.LengthN("T=LINE")]))
`);
  assert.deepEqual(readBack(r), [[200, 60, 50]], "the rectangle's area and perimeter in mm, the line's length");
}
{
  const r = ranVs(
    `PROCEDURE Main;
BEGIN
  Rect(0, 0, 10, 20);
  Message(AreaN('T=RECT'), ' ', PerimN('T=RECT'));
END;
RUN(Main);
`,
    { file: "areas.vs" },
  );
  assert.deepEqual(messages(r), ["200 60"], "Vectorscript: the same sums");
}

{
  // calls accepted and ignored: they return what the code says and record nothing. vsoButtonGetResource
  // shows a resource popup in Vectorworks and hands the name back; Rodeo returns True and leaves the name
  // alone (see the report).
  const r = ranVs(`${J}import vs
print(json.dumps([vs.SetObjPropCharVS(1, "a"), vs.SetObjPropRealVS(1, 2.0), vs.vsoSetEventResult(3), vs.vsoButtonGetResource("x", 1, 0, "y"), vs.SetHelpString("Help")]))
`);
  // every one answers True, vsoSetEventResult included (its reference page is a procedure: see the report)
  assert.deepEqual(readBack(r), [[true, true, true, true, true]]);
  assert.deepEqual(r.ops, [], "no step is recorded");
}

{
  // the static text's style: 0 regular, 1 caption, 2 bold, 3 reduced (the reference's four types); the alias
  // CreateStyledStaticText is the same call
  const r = ranVs(`${J}import vs
dlg = vs.CreateLayout("Styles")
vs.CreateStyledStatic(dlg, 1, "Regular", 10, 0)
vs.CreateStyledStaticText(dlg, 2, "Caption", -1, 1)
vs.CreateStyledStaticText(dlg, 3, "Bold", -1, 2)
vs.CreateStyledStatic(dlg, 4, "Reduced", -1, 3)
vs.RunLayoutDialog(dlg, lambda item, data: None)
`);
  const spec = dialogSpecs(r)[0];
  assert.ok(spec, "the dialog is sent to the editor");
  assert.deepEqual([1, 2, 3, 4].map((id) => specItem(spec, id).text), ["Regular", "Caption", "Bold", "Reduced"]);
  assert.deepEqual([1, 2, 3, 4].map((id) => specItem(spec, id).tsize ?? null), [null, "caption", null, "reduced"], "the caption and reduced sizes");
  assert.deepEqual([1, 2, 3, 4].map((id) => specItem(spec, id).bold), [false, false, true, false], "only the bold style is bold");
}

// ---- the guard: every public call of the parts and of the core's layout dialogs is named in a check --

// The core's layout-dialog section, from its banner to the next one (vsModule.ts).
const LAYOUT_START = VS_CORE_SOURCE.indexOf("# ---- layout dialogs");
const LAYOUT_END = VS_CORE_SOURCE.indexOf("# ---- numbers, units and the window");
assert.ok(LAYOUT_START > 0 && LAYOUT_END > LAYOUT_START, "the core's layout-dialog banners are where the guard expects them");

// The names the module defines, by the same ast listing parts.check.ts uses, and which of them are public
// callables at run time (the module exec'd as runner.ts runs it). Names a loop defines (globals()[_name]
// in worksheets.ts and friends) are found at run time only: those are listed apart.
const LIST = `
import ast, json, sys, types
data = json.load(sys.stdin)
mod = types.ModuleType("vs_all")
exec(compile(data["all"], "vs.py", "exec"), mod.__dict__)
public = {k for k, v in vars(mod).items() if not k.startswith("_") and callable(v)}

def defined(src):
    out = set()
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, ast.Assign):
            out.update(t.id for t in node.targets if isinstance(t, ast.Name))
    return out

core = defined(data["core"])
parts = {name: sorted(defined(src) & public) for name, src in data["parts"]}
layout = sorted(defined(data["layout"]) & public)
by_ast = set(core).union(*(defined(src) for _, src in data["parts"]))
print(json.dumps({"parts": parts, "layout": layout, "loopOnly": sorted(public - by_ast), "public": len(public)}))
`;
const listed = JSON.parse(
  execFileSync("python3", ["-I", "-c", LIST], {
    input: JSON.stringify({
      all: VS_SOURCE,
      core: VS_CORE_SOURCE,
      layout: VS_CORE_SOURCE.slice(LAYOUT_START, LAYOUT_END),
      parts: VS_PARTS.map((src, i) => [VS_PART_NAMES[i], src]),
    }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { parts: Record<string, string[]>; layout: string[]; loopOnly: string[]; public: number };

const universe = new Set<string>([...Object.values(listed.parts).flat(), ...listed.layout, ...listed.loopOnly]);

// every check file under python/ and import/, read as text
function checkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...checkFiles(path));
    else if (entry.name.endsWith(".check.ts")) out.push(path);
  }
  return out;
}
const here = fileURLToPath(new URL(".", import.meta.url));
const srcRoot = join(here, "..", "..", "..");
const checks = [...checkFiles(join(srcRoot, "features", "python")), ...checkFiles(join(srcRoot, "import"))];
const texts = checks.map((path) => readFileSync(path, "utf8"));

const unnamed = [...universe].filter((name) => {
  const word = new RegExp(`\\b${name}\\b`);
  return !texts.some((text) => word.test(text));
});
assert.deepEqual(unnamed, [], `calls named in no check file: ${unnamed.join(", ")}`);

console.log(
  `vs coverage guard: ${universe.size} calls of the parts and the layout dialogs are each named in a check file ` +
    `(${listed.public} public calls in the module, ${checks.length} check files; ${listed.loopOnly.length} made by loops)`,
);
console.log("vs coverage: ok (the 58 round calls and the other calls the guard listed are all asserted)");
