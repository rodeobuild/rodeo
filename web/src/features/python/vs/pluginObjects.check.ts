// Node check of the plug-in object calls (vs/pluginObjects.ts): a path object's path, control points,
// choices, Object Info widgets and popups, and the state events. Run from web/:
//   npx tsx src/features/python/vs/pluginObjects.check.ts

import assert from "node:assert/strict";
import { pluginSnapshot, ranVs, runVs, type Snapshot } from "../vsCheck.ts";

const PLUGIN = "Test Callout";
const FENCE = "Test Fence";
const CONTROL = { x: "ControlPoint01X", y: "ControlPoint01Y" };

/** A plug-in run's snapshot with the plug-in info (control points, choices, changed values, widget numbers). */
function run(name: string, params: [string, string, unknown][], info: Record<string, unknown>, event = 3): Snapshot {
  const s = pluginSnapshot(name, params, event, 0);
  Object.assign(s.plugin ?? {}, { info });
  return s;
}

/** What a script said with Message, one line each. */
const said = (out: object): string => (((out as { messages?: unknown }).messages as string[] | undefined) ?? []).join("\n").trim();

const PATH = JSON.stringify({ closed: false, v: [[0, 0, "corner", 0], [1000, 0, "corner", 0], [1000, 500, "corner", 0]] });

// ---- path objects --------------------------------------------------------------------------------

const fence = run(FENCE, [["__Path", "str", PATH]], {});
const pathScript = `import vs
ok, name, h, rec, wall = vs.GetCustomObjectInfo()
p = vs.GetCustomObjectPath(h)
n = vs.GetVertNum(p)
x, y = vs.GetPolyPt(p, 2)
L = vs.HLength(p)
t = vs.GetTypeN(p)
for i in range(1, n):
    a = vs.GetPolyPt(p, i)
    b = vs.GetPolyPt(p, i + 1)
    vs.MoveTo(a[0], a[1])
    vs.LineTo(b[0], b[1])
vs.Message("%d %g %g %g %d" % (n, x, y, L, t))
`;
const pathRun = ranVs(pathScript, { file: "Test Fence.py", snapshot: fence });
assert.equal(said(pathRun), "3 1000 0 1500 21", "the path's vertices, second vertex, length and type");
const segments = pathRun.ops.filter((o) => o[0] === "add" && (o[3] as { kind?: string }).kind === "line");
assert.equal(segments.length, 2, "one line along each of the path's two segments");
assert.deepEqual(segments[1][3], { kind: "line", a: { x: 1000, y: 0 }, b: { x: 1000, y: 500 } }, "the second segment runs along the path");
// the path is in the object's own frame, not one of its drawn children: it is not in the drawn list
assert.equal(pathRun.ops.filter((o) => o[0] === "add").every((o) => o[1] !== "path:new:plugin"), true);

// profile and wall hole groups are None for a path object (no profile, no opening)
const profileScript = `import vs
ok, name, h, rec, wall = vs.GetCustomObjectInfo()
vs.Message("%s %s" % (vs.GetCustomObjectProfileGroup(h) is None, vs.GetCustomObjectWallHoleGroup(h) is None))
`;
assert.equal(said(ranVs(profileScript, { file: "Test Fence.py", snapshot: fence })), "True True");

// no path field: GetCustomObjectPath is None
const bare = run(FENCE, [], {});
const noPath = ranVs(`import vs
ok, name, h, rec, wall = vs.GetCustomObjectInfo()
vs.Message(str(vs.GetCustomObjectPath(h) is None))
`, { file: "Test Fence.py", snapshot: bare });
assert.equal(said(noPath), "True");

// a handle that isn't the plug-in object is refused
const notPio = runVs(`import vs
vs.GetCustomObjectPath(vs.FSActLayer())
`, { file: "Test Fence.py", snapshot: fence });
assert.ok(notPio.error, "GetCustomObjectPath refuses another object's handle");

// the Vectorscript spelling of the path calls
const vsPath = ranVs(
  `PROCEDURE Fence;
VAR nm: STRING; h, r, w, p: HANDLE; n: LONGINT; x, y: REAL; ok: BOOLEAN;
BEGIN
  ok := GetCustomObjectInfo(nm, h, r, w);
  p := GetCustomObjectPath(h);
  n := GetVertNum(p);
  GetPolyPt(p, 2, x, y);
  MoveTo(0, 0);
  LineTo(x, y);
  Message(n);
END;
`,
  { file: "Test Fence.vs", snapshot: fence },
);
assert.equal(said(vsPath), "3", "Vectorscript reads the path's vertex count");
assert.equal(vsPath.ops.filter((o) => o[0] === "add").length, 1, "Vectorscript draws along the path");

// ---- control points, choices and the layout --------------------------------------------------------

const callout = run(PLUGIN, [["Inner Menu", "str", "a"], [CONTROL.x, "real", 300], [CONTROL.y, "real", 400]], {
  controlPoints: [{ x: CONTROL.x, y: CONTROL.y }],
  labels: { "Inner Menu": "Shape", [CONTROL.x]: "Control X" },
  choices: { "Inner Menu": [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] },
  widgets: { "Inner Menu": 1 },
});
const callScript = `import vs
ok, name, h, rec, wall = vs.GetCustomObjectInfo()
cx = vs.PControlPoint01X
cy = vs.PControlPoint01Y
vs.MoveTo(0, 0)
vs.LineTo(cx, cy)
vs.Rect(cx - 50, cy - 50, cx + 50, cy + 50)
`;
const callRun = ranVs(callScript, { file: "Test Callout.py", snapshot: callout });
const lines = callRun.ops.filter((o) => o[0] === "add" && (o[3] as { kind?: string }).kind === "line");
assert.equal(lines.length, 1, "a line from the origin to the control point");
assert.deepEqual(lines[0][3], { kind: "line", a: { x: 0, y: 0 }, b: { x: 300, y: 400 } });
assert.ok(callRun.ops.some((o) => o[0] === "add" && (o[3] as { kind?: string }).kind === "rect"), "a box around the control point");

// the control point also reads as a Vectorscript parameter
const vsCtl = ranVs(
  `PROCEDURE Callout;
VAR x, y: REAL;
BEGIN
  x := PControlPoint01X;
  y := PControlPoint01Y;
  Message(x + y);
END;
`,
  { file: "Test Callout.vs", snapshot: callout },
);
assert.equal(said(vsCtl), "700");

const choices = ranVs(
  `import vs
n = vs.NumCustomObjectChoices("Test Callout", "PInner_Menu")
c = vs.GetCustomObjectChoice("Test Callout", "PInner_Menu", 2)
ok, i = vs.GetPluginChoiceIndex("Test Callout", "Inner Menu", "a")
miss = vs.GetPluginChoiceIndex("Other", "Inner Menu", "a")
vs.Message("%d %s %s %s" % (n, c, str(ok) + str(i), str(miss)))
`,
  { file: "Test Callout.py", snapshot: callout },
);
assert.equal(said(choices), "2 Beta True1 (False, 0)");

const names = ranVs(
  `import vs
own = vs.GetLocalizedPluginName("Test Callout")
other = vs.GetLocalizedPluginName("Other")
param = vs.GetLocalizedPluginParameter("Test Callout", "PInner_Menu")
choice = vs.GetLocalizedPluginChoice("Test Callout", "Inner Menu", 1)
none = vs.GetLocalizedPluginChoice("Test Callout", "Inner Menu", 9)
vs.Message(repr([own, other, param, choice, none]))
`,
  { file: "Test Callout.py", snapshot: callout },
);
assert.equal(said(names), "[(True, 'Test Callout'), (False, 'Other'), (True, 'Shape'), (True, 'Alpha'), (False, '')]");

// ---- Object Info layout: widgets, text, states, popups --------------------------------------------

const laid = ranVs(
  `import vs
vs.SetObjPropVS(8, True)
vs.vsoAddParamWidget(1, "Inner Menu", "Inner")
vs.vsoWidgetPopupAdd(1, "a", "Alpha")
vs.vsoWidgetPopupAdd(1, "b", "Beta")
vs.vsoWidgetPopupAdd(1, "c", "Gamma")
vs.vsoWidgetPopupSet(1, 1, "bb", "Beta two")
vs.vsoWidgetSetText(1, "Shape")
vs.vsoWidgetSetEnable(1, False)
vs.vsoAddWidget(2, 13, "Shape menu")
vs.vsoWidgetSetVisible(2, False)
vs.Message("%s|%s|%d|%s|%s|%s|%s" % (vs.vsoWidgetGetText(1), vs.vsoWidgetGetRecParam(1), vs.vsoWidgetPopupGetCnt(1), vs.vsoWidgetPopupGetID(1, "Beta two"), vs.vsoWidgetPopupGetTxt(1, "c"), vs.vsoWidgetGetEnable(1), vs.vsoWidgetGetVisible(2)))
`,
  { file: "Test Callout.py", snapshot: run(PLUGIN, [[CONTROL.x, "real", 300]], { controlPoints: [] }, 5) },
);
assert.equal(said(laid), "Shape|Inner Menu|3|bb|Gamma|False|False");
const ui = laid.ui as { widgets: Record<string, unknown>[]; states: Record<string, Record<string, boolean>> };
assert.deepEqual(
  ui.widgets.find((w) => w.id === 1 && w.param === "Inner Menu"),
  { id: 1, param: "Inner Menu", label: "Shape", level: 0 },
  "the parameter's widget takes the text set",
);
assert.deepEqual(
  ui.widgets.find((w) => Array.isArray(w.items)),
  { id: 1, items: [["a", "Alpha"], ["bb", "Beta two"], ["c", "Gamma"]], level: 0 },
  "the popup's items, after the Set, reach the layout",
);
assert.deepEqual(ui.states, { "1": { enabled: false }, "2": { visible: false } }, "greyed and hidden widgets");

const inserted = ranVs(
  `import vs
vs.vsoInsertWidget(5, 4, 1, "Second text", 0)
vs.vsoInsertWidget(6, 12, 0, "Press", 0)
vs.vsoInsertParamWidget(1, 1, "First", 0)
ok, w = vs.vsoPrmName2WidgetID("", "Inner Menu", 0)
vs.Message("%d %d %d" % (vs.vsoParamName2Index("Test Callout", "Inner Menu"), vs.vsoParamName2Index("", "missing"), 1 if ok else 0))
`,
  { file: "Test Callout.py", snapshot: run(PLUGIN, [[CONTROL.x, "real", 300]], {}, 5) },
);
assert.equal(said(inserted), "-1 -1 0", "no Inner Menu parameter in this run's plug-in");
const insertedUi = inserted.ui as { widgets: Record<string, unknown>[] };
assert.ok(insertedUi.widgets.some((w) => w.id === 5 && w.param === CONTROL.x && w.label === "Second text"), "a field widget takes the parameter numbered by mappingID (from 1)");
assert.ok(insertedUi.widgets.some((w) => w.id === 6 && w.type === 12 && w.label === "Press"), "a button widget");

// a parameter's visibility and enable state, from the widget the layout gave it
const prepUi = ranVs(
  `import vs
vs.SetParameterVisibility(0, "Inner Menu", False)
vs.EnableParameter(0, "PInner_Menu", False)
`,
  { file: "Test Callout.py", snapshot: run(PLUGIN, [["Inner Menu", "str", "a"], [CONTROL.x, "real", 300]], { widgets: { "Inner Menu": 1 } }, 41) },
).ui as { states: Record<string, Record<string, boolean>> };
assert.deepEqual(prepUi.states, { "1": { visible: false, enabled: false } }, "the widget showing the parameter is hidden and greyed");

// ---- state events -------------------------------------------------------------------------------

const edited = run(PLUGIN, [["Inner Menu", "str", "b"], [CONTROL.x, "real", 300]], { widgets: { "Inner Menu": 1 }, changed: [{ name: "Inner Menu", old: "a" }, { name: CONTROL.x, old: "250" }] });
const states = ranVs(
  `import vs
ok, name, h, rec, wall = vs.GetCustomObjectInfo()
first = vs.vsoStateGetParamChng(h)
second = vs.vsoStateGetParamChng(h)
third = vs.vsoStateGetParamChng(h)
vs.Message("%s|%s|%s" % (repr(first), repr(second), repr(third)))
vs.vsoStateClear()
vs.Message(str(vs.vsoStateGet(h, 1)) + str(vs.vsoStateGetObjChng(h)[0]) + str(vs.vsoStateGetPos(h)[0]) + str(vs.vsoStateGetRot(h)[0]) + str(vs.vsoStateGetLayrChng(h)[0]) + str(vs.vsoStateGetNameChng(h)[0]) + str(vs.vsoStateGetExitGroup(h)[0]))
vs.Message(str(vs.vsoStateAddCurrent(h, 7)))
vs.DisplayContextHelpOfCurrentPlugin()
`,
  { file: "Test Callout.py", snapshot: edited },
);
assert.equal(
  said(states).split("\n")[0],
  "(True, 1, 0, 'a')|(True, 0, 1, '250')|(False, 0, 0, '')",
  "the changed parameters, in order, with their widget, index from 0 and old value; then nothing more",
);
assert.equal(said(states).split("\n")[1], "FalseFalseFalseFalseFalseFalseFalse", "no other state happened");
assert.equal(said(states).split("\n")[2], "7", "vsoStateAddCurrent passes the message on");

// ---- popups and widgets from a Vectorscript layout ----------------------------------------------

// the calls that hand values back through VAR parameters (vsoWidgetPopupGet, vsoStateGetParamChng...)
// need their entries in the Vectorscript translator (vscriptModule.ts), so these check the others
const vsLayout = ranVs(
  `PROCEDURE Callout;
VAR n: LONGINT; s: STRING;
BEGIN
  SetObjPropVS(8, TRUE);
  vsoAddParamWidget(1, 'Inner Menu', 'Inner');
  vsoWidgetPopupAdd(1, 'a', 'Alpha');
  vsoWidgetPopupAdd(1, 'b', 'Beta');
  n := vsoWidgetPopupGetCnt(1);
  s := vsoWidgetPopupGetTxt(1, 'b');
  vsoWidgetSetText(1, 'Shape');
  Message(n);
  Message(s);
  Message(vsoWidgetGetText(1));
END;
`,
  { file: "Test Callout.vs", snapshot: run(PLUGIN, [["Inner Menu", "str", "a"]], {}, 5) },
);
assert.equal(said(vsLayout), "2\nBeta\nShape", "Vectorscript popups and widget text");
const vsChoices = ranVs(
  `PROCEDURE Callout;
BEGIN
  Message(NumCustomObjectChoices('Test Callout', 'PInner_Menu'));
  Message(GetCustomObjectChoice('Test Callout', 'PInner_Menu', 2));
END;
`,
  { file: "Test Callout.vs", snapshot: callout },
);
assert.equal(said(vsChoices), "2\nBeta", "Vectorscript choices");

console.log("vs plug-in object calls: ok");
