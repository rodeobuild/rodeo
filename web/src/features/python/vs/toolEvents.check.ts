// Node check of the tool-event calls (vs/toolEvents.ts): what a tool's run gets from its session (the
// event, points, pointer, mode values, data) and what it reports (result, behaviour, help, mode bar,
// drawing, data), the completion run's steps against the others', and the Vectorscript spellings.
// Run from web/:
//   npx tsx src/features/python/vs/toolEvents.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, ranVs, runVs, type Snapshot } from "../vsCheck.ts";

const TOOL = "Test Slot";
const BIG = 1.0e97;

/** A tool run's snapshot: the plugin block the session makes (points and pointer in millimetres). */
function toolRun(tool: Record<string, unknown>): Snapshot {
  const snap = blankSnapshot();
  const plugin = { name: TOOL, object: null, isNew: false, params: [], event: 3, eventData: 0, tool };
  Object.assign(snap, { plugin });
  return snap;
}

/** The block for an event, with what the session holds at that moment. */
function block(event: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { event, msg1: 0, msg2: 0, points: [], current: null, behavior: 2, help: "", modes: [], data: {}, ...extra };
}

/** What a script said with Message, one line each. */
const said = (out: object): string => (((out as { messages?: unknown }).messages as string[] | undefined) ?? []).join("\n").trim();

// ---- the setup run: the mode bar, the behaviour and the help ----------------------------------------

const SETUP = `import vs
vs.AddRadioMode(1, 2, "Test Slot/Round.svg", "Test Slot/Square.svg", "", "", "", "")
vs.vstAddPDMenuMode("Fill:")
vs.vstAddPDMenuItem(2, "None")
vs.vstAddPDMenuItem(2, "Solid")
vs.vstAddPDMenuItem(2, "Hatch")
vs.vstSetPDMenuSel(2, 1)
vs.AddButtonMode("Vectorworks/ModeViewBar/Options.svg")
vs.vstEnableMode(3, False)
vs.vstSetPtBehavior(2)
vs.vstSetHelpString("Click the start, then the end")
vs.vstSetEventResult(0)
vs.Message(str(vs.vstGetEventInfo()))
`;
const setup = ranVs(SETUP, { file: "Test Slot.py", snapshot: toolRun(block(3)) });
assert.equal(said(setup), "(3, 0, 0)", "the setup run gets event 3 and its messages");
const bar = (setup as unknown as { toolSession: { behavior: number; help: string; modes: Record<string, unknown>[]; result: number } }).toolSession;
assert.equal(bar.behavior, 2, "vstSetPtBehavior reports the point behaviour");
assert.equal(bar.help, "Click the start, then the end", "vstSetHelpString reports the help string");
assert.equal(bar.modes.length, 3, "three modes: a radio group, a pull-down and a button, numbered in the order added");
assert.deepEqual(bar.modes[0], { kind: "radio", icons: ["Test Slot/Round.svg", "Test Slot/Square.svg"], items: [], label: "", value: 1, enabled: true }, "the radio group: two buttons, the first on");
assert.deepEqual(bar.modes[1], { kind: "pulldown", icons: [], items: ["None", "Solid", "Hatch"], label: "Fill:", value: 1, enabled: true }, "the pull-down: its items and the one selected (from 0)");
assert.equal(bar.modes[2]?.kind, "button", "the button mode");
assert.equal(bar.modes[2]?.enabled, false, "vstEnableMode switches a mode off");
assert.equal(bar.result, 0, "vstSetEventResult reports the result");
// the setup run keeps no steps of a drawing it made: none here, but its ops are dropped as the other events' are
assert.equal(setup.ops.length, 0, "a setup run applies no steps");

// a setup run replaces the mode bar it was given, the bar is declared again
const again = ranVs(SETUP, { file: "Test Slot.py", snapshot: toolRun(block(3, { modes: [{ kind: "radio", icons: ["x"], items: [], label: "", value: 1, enabled: true }] })) });
assert.equal((again as unknown as { toolSession: { modes: unknown[] } }).toolSession.modes.length, 3, "setup starts the bar afresh");

// ---- the event, the points and the pointer --------------------------------------------------------

const POINTS = `import vs
ev, m1, m2 = vs.vstGetEventInfo()
n = vs.vstNumPts()
x0, y0 = vs.vstGetPt2D(0, True)
x1, y1 = vs.vstGetPt2D(1, True)
miss = vs.vstGetPt2D(2, True)
z1 = vs.vstGetPt3D(1, True)
cx, cy = vs.vstGetCurrPt2D()
cx3, cy3, cz3 = vs.vstGetCurrPt3D(True)
vs.Message("%d %d %d | %g %g | %g %g | %g %g | %g %g %g | %g %g %g | %g" % (ev, m1, m2, x0, y0, x1, y1, miss[0], miss[1], z1[0], z1[1], z1[2], cx, cy, cx3 * 0 + cy3 * 0 + cz3, miss[0]))
`;
const pointsRun = ranVs(POINTS, {
  file: "Test Slot.py",
  snapshot: toolRun(block(100, { msg1: 4, msg2: 9, points: [[1000, 0], [2000, 500]], current: [2500, 700] })),
});
assert.equal(
  said(pointsRun),
  `100 4 9 | 1000 0 | 2000 500 | ${BIG} ${BIG} | 2000 500 0 | 2500 700 0 | ${BIG}`,
  "event and messages, the two points (index from 0), a point not clicked, Pt3D, current point",
);
assert.equal(pointsRun.ops.length, 0, "a point-added run applies no steps");

// units: the drawing in feet: a point at 1000 mm is 1000 / 304.8 feet (the snapshot's lengths are millimetres)
const feet = blankSnapshot();
feet.units = { ...(feet.units as object), mm: 304.8, mark: "ft", format: 1 };
Object.assign(feet, { plugin: { name: TOOL, object: null, isNew: false, params: [], event: 3, eventData: 0, tool: block(100, { points: [[1524, 0]] }) } });
assert.equal(said(ranVs(`import vs\nvs.Message("%g" % vs.vstGetPt2D(0, True)[0])`, { file: "Test Slot.py", snapshot: feet })), "5", "points come out in the drawing's units");

// ---- the drawing for the rubber band ----------------------------------------------------------------

const DRAW = `import vs
vs.vstDrawCoordLine(0, 0, 1000, 500)
vs.vstDrawCoordRect(0, 0, 1000, 1000)
vs.vstDrawCoordEllipse(0, 0, 2000, 1000)
vs.vstDrawCoordArcN(0, 0, 2000, 2000, 90, 180)
vs.vstDrawCoordLine3D(1000, 0, 5, 1000, 500, 5)
vs.vstDrawCoordLineN(0, 0, 0, 100, 1)
vs.Rect(0, 0, 100, 100)
`;
const drawRun = ranVs(DRAW, { file: "Test Slot.py", snapshot: toolRun(block(103, { points: [[0, 0]], current: [1000, 500] })) });
assert.deepEqual(
  (drawRun as unknown as { toolSession: { draw: unknown[] } }).toolSession.draw,
  [
    ["line", 0, 0, 1000, 500],
    ["rect", 0, 0, 1000, 1000],
    ["ellipse", 0, 0, 2000, 1000],
    ["arc", 0, 0, 2000, 2000, 90, 180],
    ["line", 1000, 0, 1000, 500],
    ["line", 0, 0, 0, 100],
  ],
  "each drawing call is kept for the rubber band, in millimetres (the 3D line and the plane line as plan lines)",
);
assert.equal(drawRun.ops.length, 0, "a draw run applies no steps, even when it adds an object");

// ---- the mode values the session holds --------------------------------------------------------------

const MODES = `import vs
a = vs.vstGetModeValue(1)
b = vs.vstGetModeValue(2)
c = vs.vstGetModeValue(3)
d = vs.vstGetModeValue(9)
vs.Message("%d %d %d %d" % (a, b, c, d))
`;
const modes = [
  { kind: "radio", icons: ["a", "b"], items: [], label: "", value: 2, enabled: true },
  { kind: "pulldown", icons: [], items: ["None", "Solid"], label: "Fill", value: 1, enabled: true },
  { kind: "button", icons: ["o"], items: [], label: "", value: 0, enabled: true },
];
assert.equal(said(ranVs(MODES, { file: "Test Slot.py", snapshot: toolRun(block(7, { msg1: 1, msg2: 2, modes })) })), "2 1 0 0", "vstGetModeValue: a radio's button, a pull-down's item, a button 0, an unknown group 0");

// a click on the pull-down reaches the script as its group and the item it picked (low word) after the shown one (high word)
const PICK = `import vs
ev, group, msg = vs.vstGetEventInfo()
vs.vstSetEventResult(8)
vs.Message("%d %d %d" % (ev, group, msg & 0xFFFF))
`;
assert.equal(said(ranVs(PICK, { file: "Test Slot.py", snapshot: toolRun(block(7, { msg1: 2, msg2: (1 << 16) | 2, modes })) })), "7 2 2", "a pull-down's pick: group and item in the message");

// ---- data kept between runs --------------------------------------------------------------------------

const DATA = `import vs
v1, ok1 = vs.vstGetDataLong(5)
v2, ok2 = vs.vstGetDataReal(6)
v3, ok3 = vs.vstGetDataString(7)
r1 = vs.vstSetDataLong(5, 7)
r2 = vs.vstSetDataReal(6, 2.5)
r3 = vs.vstSetDataString(7, "Hatch")
v4, ok4 = vs.vstGetDataLong(5)
v5, ok5 = vs.vstGetDataReal(5)
vs.Message("%d %s | %g %s | %s %s | %s %s %s | %d %s" % (v1, ok1, v2, ok2, v3 == "", ok3, r1, r2, r3, v4, ok4))
vs.Message("%s %s" % (v5, ok5))
`;
const dataRun = ranVs(DATA, { file: "Test Slot.py", snapshot: toolRun(block(3, { data: { "5": ["long", 3] } })) });
assert.equal(said(dataRun).split("\n")[0], "3 True | 0 False | True False | True True True | 7 True", "data read from the session, then saved in the run");
assert.equal(said(dataRun).split("\n")[1], "0.0 False", "a data id of the wrong kind is not there");
const saved = (dataRun as unknown as { toolSession: { data: Record<string, unknown> } }).toolSession.data;
assert.deepEqual(saved, { "5": ["long", 7], "6": ["real", 2.5], "7": ["string", "Hatch"] }, "the data a run saved goes back to the session");

// ---- results and the completion run ------------------------------------------------------------------

const RESULTS = `import vs
vs.vstSetEventResult(8)
vs.vstSetEventResult(18)
vs.Message(str(vs.vstGetEventResult()))
vs.Rect(0, 0, 1000, 500)
`;
const completed = ranVs(RESULTS, { file: "Test Slot.py", snapshot: toolRun(block(104, { points: [[0, 0], [1000, 500]] })) });
assert.equal(said(completed), "18", "vstSetEventResult and vstGetEventResult read back the last value set");
assert.equal((completed as unknown as { toolSession: { result: number } }).toolSession.result, 18, "the result is reported");
assert.equal(completed.ops.length, 1, "the completion run's steps are the object");
assert.equal(completed.ops[0]?.[0], "add", "the object is an added shape");
assert.deepEqual(completed.ops[0]?.find((x) => typeof x === "object" && x !== null && "x0" in x), { kind: "rect", x0: 0, y0: 0, x1: 1000, y1: 500 }, "a rectangle of the given corners");
const notCompleted = ranVs(RESULTS, { file: "Test Slot.py", snapshot: toolRun(block(100, { points: [[0, 0]] })) });
assert.equal(notCompleted.ops.length, 0, "the same steps in a point-added run change nothing");

// a plain run (no session): event 3, its steps kept as a command's are
const plain = ranVs(`import vs
ev, m1, m2 = vs.vstGetEventInfo()
vs.Message(str(ev))
vs.Rect(0, 0, 10, 10)
`, { file: "Test Slot.py" });
assert.equal(said(plain), "3", "a plain run reports the setup event");
assert.equal(plain.ops.length, 1, "a plain run keeps its steps");
assert.equal((plain as unknown as { toolSession?: unknown }).toolSession, undefined, "a plain run reports no session");

// ---- calls with no effect here, which are accepted -------------------------------------------------

const ACCEPTED = `import vs
vs.vstNameUndoEvent("Test Slot")
vs.vstSetCursorByView()
vs.vstSetWPHybridTool(1)
vs.vstRestoreWPHybridTool(1)
vs.vstSetModeHelpBase(11045)
vs.BeginModeButtonsText()
vs.SetModeButtonText("Oval", 1)
vs.SetModeButtonTextN("Oval", "Ellipse", 1)
vs.EndModeButtonsText()
vs.vstSetDataLong(1, 1)
vs.Message(str(vs.vstGetToolObject() is None))
`;
assert.equal(said(ranVs(ACCEPTED, { file: "Test Slot.py", snapshot: toolRun(block(3)) })), "True", "display calls are accepted, and no tool object is made");

// calls that aren't available say so (the module's own message)
for (const name of ["vstGetPickObject", "vstGetInitObject", "vstGetString", "vstCustomProcNNA", "vstDefault2DToolDraw", "vstGetRsrcFileID"]) {
  const r = runVs(`import vs\nvs.${name}()\n`, { file: "Test Slot.py", snapshot: toolRun(block(3)) });
  assert.equal(r.error?.name, "NotImplementedError", `vs.${name} isn't available yet`);
}

// ---- Vectorscript: the spellings, with their VAR parameters -------------------------------------

const VS_RUN = `PROCEDURE TestSlot;
VAR
  ev, m1, m2, n, v, mode : LONGINT;
  x, y, z : REAL;
  ok : BOOLEAN;
  s : STRING;
BEGIN
  vstGetEventInfo(ev, m1, m2);
  vstNumPts(n);
  vstGetPt2D(0, x, y, ok);
  vstGetPt3D(1, x, y, z, ok);
  vstGetModeValue(1, mode);
  vstGetDataLong(5, v, ok);
  vstSetDataLong(6, 9, ok);
  vstSetEventResult(8);
  vstDrawCoordLine(0, 0, x, y);
  Message(ev, n, mode, v);
END;
RUN(TestSlot);
`;
const vsRun = runVs(VS_RUN, {
  file: "Test Slot.vs",
  snapshot: toolRun(block(100, { points: [[1000, 0], [2000, 500]], modes: [{ kind: "radio", icons: ["a"], items: [], label: "", value: 1, enabled: true }], data: { "5": ["long", 4] } })),
});
assert.equal(vsRun.error, null, "the Vectorscript run works with its VAR parameters");
assert.equal(said(vsRun), "100214", "events, points, mode value and data, as Vectorscript reads them");
assert.equal((vsRun as unknown as { toolSession: { result: number; data: Record<string, unknown> } }).toolSession.result, 8, "the Vectorscript run sets its result");
assert.deepEqual((vsRun as unknown as { toolSession: { data: Record<string, unknown> } }).toolSession.data, { "5": ["long", 4], "6": ["long", 9] }, "the Vectorscript run saves its data");
assert.equal(vsRun.ops.length, 0, "a Vectorscript point-added run applies no steps");

console.log("vs tool events: ok");
