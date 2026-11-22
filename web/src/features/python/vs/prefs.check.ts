// Node check of the preference and object-variable calls (vs/prefs.ts) and the program calls that
// sit beside them. Run from web/: npx tsx src/features/python/vs/prefs.check.ts

import assert from "node:assert/strict";
import { LAYER, blankSnapshot, ranVs, runVs, type Snapshot } from "../vsCheck.ts";

const SHEET = "sheet-1";
const UPPER = "layer-2";
const TEXT = "txt-1";
const SYMBOL = "sym-1";
const PLUGIN = "pio-1";

/** A millimetre drawing: a second design layer at 1:100 and 2 m up, a sheet, a text, a symbol instance and a plug-in object. */
function drawing(): Snapshot {
  const snap = blankSnapshot();
  snap.fileName = "Hall.vwx";
  snap.editor = { showGrid: true, snapGrid: false, snapObjects: true, zoomLines: false, snapRadius: 12 };
  snap.layers = [
    { id: LAYER, name: "Design Layer-1", kind: "design", scale: 50, vis: "visible", elev: 0 },
    { id: UPPER, name: "Upper", kind: "design", scale: 100, vis: "visible", elev: 2000 },
    { id: SHEET, name: "A-101 Sheet", kind: "sheet", scale: 50, vis: "visible", elev: 0 },
  ];
  snap.symbols = [{ index: 1, name: "Chair", bbox: null }];
  snap.objects = [
    {
      id: TEXT, type: 10, typeName: "text", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 10, 4],
      attrs: {}, sym: null, records: {},
      shape: { kind: "text", text: "Hi", at: [0, 0], size: 6, font: "Arial", tstyle: 0, bold: false, italic: false, underline: false, h: 1, v: 1, angle: 0 },
    },
    { id: SYMBOL, type: 7, typeName: "symbol", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 500, 500], attrs: {}, sym: 1, records: {}, shape: null },
    {
      id: PLUGIN, type: 86, typeName: "plug-in-object", layer: LAYER, parent: null, cls: "None", name: "", bbox: null,
      attrs: {}, sym: null, records: { "Door Frame": { width: 900 } }, shape: null,
    },
  ];
  return snap;
}

/** The same drawing in feet and inches (a length unit is 25.4 mm, an inch). */
function feetAndInches(): Snapshot {
  const snap = drawing();
  snap.units = { mm: 25.4, mark: '"', area: "sq ft", format: 3, display: 16 };
  return snap;
}

/** Asserts a number is close to what it should be (the drawing's units are floats). */
function near(a: unknown, b: number, msg = ""): void {
  assert.ok(typeof a === "number" && Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b)), `${msg} ${String(a)} != ${b}`);
}

/** Runs a script that prints one JSON object and gives it back. */
function json(code: string, snapshot: Snapshot = drawing()): Record<string, unknown> {
  const out = ranVs(`import json, vs\n${code}\n`, { file: "read.py", snapshot });
  return JSON.parse(out.printed.trim().split("\n").pop() ?? "{}") as Record<string, unknown>;
}

// ---- answered from the drawing and the editor ------------------------------------------------

{
  const v = json(`print(json.dumps({
    "grid": vs.GetPref(35), "snapGrid": vs.GetPref(37), "snapObjects": vs.GetPref(38), "zoomLines": vs.GetPref(9),
    "radius": vs.GetPrefInt(54), "unitMark": vs.GetPrefString(154), "areaMark": vs.GetPrefString(158),
    "perInch": vs.GetPrefReal(152), "perSqInch": vs.GetPrefReal(176), "perCuInch": vs.GetPrefReal(180),
    "metric": vs.GetPref(173), "layerScale": vs.GetPrefReal(6757)}))`);
  assert.equal(v.grid, true);
  assert.equal(v.snapGrid, false);
  assert.equal(v.snapObjects, true);
  assert.equal(v.zoomLines, false);
  assert.equal(v.radius, 12);
  assert.equal(v.unitMark, "mm");
  assert.equal(v.areaMark, "m²");
  near(v.perInch, 25.4, "units per inch in mm");
  near(v.perSqInch, 645.16, "square inch in mm");
  near(v.perCuInch, 16387.064, "cubic inch in mm");
  assert.equal(v.metric, true);
  assert.equal(v.layerScale, 50);
}

{
  const v = json(`print(json.dumps({
    "unitMark": vs.GetPrefString(154), "areaMark": vs.GetPrefString(158), "perInch": vs.GetPrefReal(152),
    "perSqInch": vs.GetPrefReal(176), "perCuInch": vs.GetPrefReal(180), "metric": vs.GetPref(173)}))`, feetAndInches());
  assert.equal(v.unitMark, '"');
  assert.equal(v.areaMark, "sq ft");
  near(v.perInch, 1, "an inch is one inch");
  near(v.perSqInch, 1);
  near(v.perCuInch, 1);
  assert.equal(v.metric, false);
}

// the active layer's scale follows the layer the script's drawing is on
{
  const snap = drawing();
  snap.activeLayer = UPPER;
  assert.equal(json(`print(json.dumps({"s": vs.GetPrefReal(6757)}))`, snap).s, 100);
}

// read-only answers refuse a Set, honestly
{
  const r = runVs(`import vs\nvs.SetPrefReal(152, 3.0)\n`, { file: "ro.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError");
  assert.ok((r.error?.message ?? "").includes("vs.SetPrefReal(152) can't change Units Per Inch in Rodeo"), r.error?.message);
}

// editor settings: a Set changes the editor when the run ends (prefsSet), and a Get after the Set sees it
{
  const r = ranVs(`import vs, json
vs.SetPref(35, False)
vs.SetPref(9, True)
vs.SetPrefInt(54, 20)
print(json.dumps({"grid": vs.GetPref(35), "zoom": vs.GetPref(9), "radius": vs.GetPrefInt(54), "snap": vs.GetPref(37)}))
`, { file: "script.py", snapshot: drawing() });
  assert.deepEqual(JSON.parse(r.printed.trim()), { grid: false, zoom: true, radius: 20, snap: false });
  assert.deepEqual(r.prefsSet, { showGrid: false, zoomLines: true, snapRadius: 20 });
  assert.deepEqual(r.prefsAssumed, []);
}

// the read, change and restore pattern on an editor setting
{
  const r = ranVs(`import vs
old = vs.GetPrefInt(54)
vs.SetPrefInt(54, old + 5)
vs.SetPrefInt(54, old)
`, { file: "script.py", snapshot: drawing() });
  assert.deepEqual(r.prefsSet, { snapRadius: 12 }, "the restore leaves the radius as it was");
}

// a Set on a bad radius is refused
{
  const r = runVs(`import vs\nvs.SetPrefInt(54, 0)\n`, { file: "bad.py", snapshot: drawing() });
  assert.equal(r.error?.name, "ValueError");
}

// ---- remembered for the run: accepted, given back, and listed in prefsAssumed ----------------

{
  const r = ranVs(`import vs, json
print(json.dumps({
  "before": vs.GetPref(13), "beforeInt": vs.GetPrefInt(50), "beforeReal": vs.GetPrefReal(57),
  "beforeText": vs.GetPrefString(100),
}))
vs.SetPrefString(100, "Verdana")
vs.SetPref(17, 1)
vs.SetPrefRGB(4003, 1, 2, 3)
vs.SetPrefLongInt(197, 7)
vs.SetPrefReal(57, 9.5)
print(json.dumps({
  "text": vs.GetPrefString(100), "eight": vs.GetPref(17), "eightInt": vs.GetPrefInt(17),
  "rgb": list(vs.GetPrefRGB(4003)), "long": vs.GetPrefLongInt(197), "real": vs.GetPrefReal(57),
}))
`, { file: "script.py", snapshot: drawing() });
  const [before, after] = r.printed.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
  assert.deepEqual(before, { before: false, beforeInt: 0, beforeReal: 0, beforeText: "" });
  assert.deepEqual(after, { text: "Verdana", eight: true, eightInt: 1, rgb: [1, 2, 3], long: 7, real: 9.5 });
  assert.deepEqual(r.prefsAssumed, [
    ["GetPref", 13], ["GetPrefInt", 50], ["GetPrefReal", 57], ["GetPrefString", 100],
    ["SetPrefString", 100], ["SetPref", 17], ["SetPrefRGB", 4003], ["SetPrefLongInt", 197], ["SetPrefReal", 57],
    ["GetPrefString", 100], ["GetPref", 17], ["GetPrefInt", 17], ["GetPrefRGB", 4003], ["GetPrefLongInt", 197], ["GetPrefReal", 57],
  ].filter((p, i, all) => all.findIndex((q) => q[0] === p[0] && q[1] === p[1]) === i));
}

// a Get of a remembered colour gives (0, 0, 0) until a Set; a kind mismatch of a colour is refused
{
  const v = json(`print(json.dumps({"rgb": list(vs.GetPrefRGB(4003))}))`);
  assert.deepEqual(v.rgb, [0, 0, 0]);
  const r = runVs(`import vs\nvs.GetPrefRGB(17)\n`, { file: "mismatch.py", snapshot: drawing() });
  assert.equal(r.error?.name, "TypeError");
}

// an unknown selector raises, and the message names the call and the selector
for (const [code, text] of [
  [`vs.GetPref(987654)`, "vs.GetPref(987654): Rodeo doesn't know preference 987654"],
  [`vs.GetPrefInt(987654)`, "vs.GetPrefInt(987654): Rodeo doesn't know preference 987654"],
  [`vs.SetPrefReal(987654, 1.0)`, "vs.SetPrefReal(987654): Rodeo doesn't know preference 987654"],
  [`vs.GetObjectVariableInt(h, 987654)`, "vs.GetObjectVariableInt(h, 987654): Rodeo doesn't know object variable 987654"],
] as const) {
  const r = runVs(`import vs\nh = vs.Handle("${TEXT}")\n${code}\n`, { file: "unknown.py", snapshot: drawing() });
  assert.equal(r.error?.name, "ValueError", code);
  assert.ok((r.error?.message ?? "").includes(text), `${code}: ${r.error?.message}`);
}

// the selector appendices' unknown-type rows, like the Store/Recall rows of the appearance tables, are unknown too
{
  const r = runVs(`import vs\nvs.GetPref(1200)\n`, { file: "untyped.py", snapshot: drawing() });
  assert.equal(r.error?.name, "ValueError");
  assert.ok((r.error?.message ?? "").includes("Rodeo doesn't know preference 1200"), r.error?.message);
}

// the interactive appearance selectors are the base plus the block and property offsets (1325 standard, 4025 black)
{
  const v = json(`print(json.dumps({"standard": vs.GetPref(1325), "black": vs.GetPref(4025), "pattern": vs.GetPrefInt(1325 + 30 + 2)}))`);
  assert.deepEqual(v, { standard: false, black: false, pattern: 0 });
}

// ---- object variables -------------------------------------------------------------------------

// a truthful one: the sheet's title and the plug-in object's plug-in name
{
  const v = json(`h = vs.Handle("${SHEET}")
o = vs.Handle("${PLUGIN}")
l = vs.Handle("${LAYER}")
print(json.dumps({
  "sheet": vs.GetObjectVariableString(h, 159), "designTitle": vs.GetObjectVariableString(l, 159),
  "plugin": vs.GetObjectVariableString(o, 1166), "textPlugin": vs.GetObjectVariableString(vs.Handle("${TEXT}"), 1166),
}))`);
  assert.deepEqual(v, { sheet: "A-101 Sheet", designTitle: "", plugin: "Door Frame", textPlugin: "" });
}

// a remembered one: set on a text, read back; a neutral value for another object
{
  const r = ranVs(`import vs, json
t = vs.Handle("${TEXT}")
vs.SetObjectVariableBoolean(t, 680, True)
vs.SetObjectVariableInt(t, 1000, 3)
vs.SetObjectVariableLongInt(t, 532, 77)
vs.SetObjectVariableReal(t, 682, 2.5)
vs.SetObjectVariableString(t, 80, "Header")
vs.SetObjectVariableHandle(t, 703, vs.Handle("${SYMBOL}"))
print(json.dumps({
  "linked": vs.GetObjectVariableBoolean(t, 680), "int": vs.GetObjectVariableInt(t, 1000),
  "long": vs.GetObjectVariableLongInt(t, 532), "real": vs.GetObjectVariableReal(t, 682),
  "text": vs.GetObjectVariableString(t, 80), "handle": vs.GetObjectVariableHandle(t, 703) == vs.Handle("${SYMBOL}"),
  "other": vs.GetObjectVariableBoolean(vs.Handle("${SYMBOL}"), 680),
}))
`, { file: "script.py", snapshot: drawing() });
  assert.deepEqual(JSON.parse(r.printed.trim()), { linked: true, int: 3, long: 77, real: 2.5, text: "Header", handle: true, other: false });
  const assumed = r.prefsAssumed as [string, number][];
  assert.ok(assumed.some((p) => p[0] === "SetObjectVariableBoolean" && p[1] === 680));
  assert.ok(assumed.some((p) => p[0] === "GetObjectVariableBoolean" && p[1] === 680));
}

// a truthful one refuses a Set
{
  const r = runVs(`import vs\nvs.SetObjectVariableString(vs.Handle("${SHEET}"), 159, "B")\n`, { file: "ov.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError");
  assert.ok((r.error?.message ?? "").includes("vs.SetObjectVariableString(h, 159) can't change Sheet Layer Title in Rodeo"), r.error?.message);
}
{
  // the appendix lists no point-valued selector, so a point call on a boolean one refuses
  const r = runVs(`import vs\nvs.GetObjectVariablePoint(vs.Handle("${TEXT}"), 680)\n`, { file: "pt.py", snapshot: drawing() });
  assert.equal(r.error?.name, "TypeError");
}

// an object variable of an object that isn't in the drawing is refused by the object lookup
{
  const r = runVs(`import vs\nvs.GetObjectVariableBoolean(vs.Handle("nope"), 680)\n`, { file: "gone.py", snapshot: drawing() });
  assert.equal(r.error?.name, "ValueError");
}

// ---- the program and the file ---------------------------------------------------------------

{
  const v = json(`print(json.dumps({
    "version": vs.GetVersion(), "versionEx": vs.GetVersionEx(), "os": vs.GetOSVersion(),
    "modules": vs.GetEnabledModules(), "product": vs.GetProduct(), "language": vs.GetCurrentLocalization(),
}))`);
  assert.deepEqual(v.version, [29, 0, 0, 1]);
  assert.deepEqual(v.versionEx, [29, 0, 0, 1, 0]);
  assert.deepEqual(v.os, [0, 0, 0]);
  assert.equal(v.modules, 3);
  assert.deepEqual(v.product, [0, 3]);
  assert.deepEqual(v.language, ["eng", ""]);
}

// ---- Vectorscript spellings of the same calls -------------------------------------------------

{
  const r = runVs(
    `PROCEDURE PrefsCheck;
VAR
   n : INTEGER;
   on : BOOLEAN;
BEGIN
   n := GetPrefInt(54);
   on := GetPref(35);
   SetPrefInt(54, n + 3);
   SetPref(9, TRUE);
   SetPrefRGB(4003, 10, 20, 30);
   Message(n, on);
END;

RUN(PrefsCheck);
`,
    { file: "prefs.vs", snapshot: drawing() },
  );
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.deepEqual(r.prefsSet, { snapRadius: 15, zoomLines: true });
}

// the environment calls read from Vectorscript too: the version and the modules
{
  const r = runVs(
    `PROCEDURE Env;
VAR
   major, minor, maint, platform : INTEGER;
BEGIN
   GetVersion(major, minor, maint, platform);
   Message(major, GetEnabledModules());
END;

RUN(Env);
`,
    { file: "env.vs", snapshot: drawing() },
  );
  assert.equal(r.error, null, r.error?.message ?? "");
}

// ---- the truthful selectors, each from a prepared drawing --------------------------------------

/** Feet and inches, a layer hidden, one grayed, and a 3D solid with a gradient fill (its mapping in mm). */
function prepared(): Snapshot {
  const snap = feetAndInches();
  snap.unitName = "Feet and Inches";
  snap.platform = 2;
  snap.layers = [
    { id: LAYER, name: "Design Layer-1", kind: "design", scale: 50, vis: "visible", elev: 0 },
    { id: UPPER, name: "Upper", kind: "design", scale: 100, vis: "hidden", elev: 2000 },
    { id: SHEET, name: "A-101 Sheet", kind: "sheet", scale: 50, vis: "grayed", elev: 0 },
  ];
  const solid = {
    id: "solid-1", type: 2, typeName: "solid", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 500, 500],
    attrs: { lineStyle: 2, lineWeight: 25, fillPattern: 1, fillFore: 5, fillBack: 6, penFore: 7, penBack: 8, fillOpacity: 100, penOpacity: 100 },
    sym: null, records: {}, shape: null, is3d: true,
    // origin 1 in, 2 in along the i axis (the x axis: 90 degrees is up, so 0 here wouldn't prove the angle), 3 in along j
    fillMap: { origin: [25.4, 50.8], u: [0, 50.8], v: [-76.2, 0] },
  };
  snap.objects.push(solid as never);
  return snap;
}

// the units, the platform and the layers
{
  const v = json(`print(json.dumps({
    "unitName": vs.GetPrefString(153), "unitMark": vs.GetPrefString(154), "areaMark": vs.GetPrefString(178),
    "volMark": vs.GetPrefString(182), "areaMarkSq": vs.GetPrefString(158), "perInch": vs.GetPrefReal(152),
    "display": vs.GetPrefInt(162), "style": vs.GetPrefInt(170), "metric": vs.GetPref(173),
    "perSqInch": vs.GetPrefReal(176), "perCuInch": vs.GetPrefReal(180), "scale": vs.GetPrefReal(6757),
    "platform": vs.GetVersion()[3], "versionEx": list(vs.GetVersionEx()),
    "visUpper": vs.GetObjectVariableInt(vs.Handle("${UPPER}"), 153), "visSheet": vs.GetObjectVariableInt(vs.Handle("${SHEET}"), 153),
    "visDesign": vs.GetObjectVariableInt(vs.Handle("${LAYER}"), 153),
    "typeSheet": vs.GetObjectVariableInt(vs.Handle("${SHEET}"), 154), "typeDesign": vs.GetObjectVariableInt(vs.Handle("${LAYER}"), 154),
  }))`, prepared());
  assert.equal(v.unitName, "Feet and Inches");
  assert.equal(v.unitMark, '"');
  assert.equal(v.areaMark, "sq ft");
  assert.equal(v.volMark, "cu ft");
  assert.equal(v.areaMarkSq, "sq ft");
  near(v.perInch, 1);
  assert.equal(v.display, 16);
  assert.equal(v.style, 1);
  assert.equal(v.metric, false);
  near(v.perSqInch, 1);
  near(v.perCuInch, 1);
  assert.equal(v.scale, 50);
  assert.equal(v.platform, 2, "a Windows browser answers 2");
  assert.deepEqual(v.versionEx, [29, 0, 0, 2, 0]);
  assert.equal(v.visDesign, 0);
  assert.equal(v.visUpper, -1);
  assert.equal(v.visSheet, 2);
  assert.equal(v.typeDesign, 0);
  assert.equal(v.typeSheet, 1);
}

// the predefined units style on metric drawings, and the metric flag
for (const [mm, mark, style, metric] of [[1, "mm", 7, true], [10, "cm", 8, true], [1000, "m", 9, true], [1e6, "km", 10, true], [25.4, '"', 2, false]] as const) {
  const snap = blankSnapshot();
  snap.units = { mm, mark, area: "m²", format: mark === '"' ? 1 : 0, display: 2 };
  const v = json(`print(json.dumps({"style": vs.GetPrefInt(170), "metric": vs.GetPref(173)}))`, snap);
  assert.equal(v.style, style, mark);
  assert.equal(v.metric, metric, mark);
}

// the fill and 3D selectors of the solid, the object's attributes, and the point the solid's fill starts at
{
  const v = json(`h = vs.Handle("solid-1")
t = vs.Handle("${TEXT}")
print(json.dumps({
  "is3d": vs.GetObjectVariableBoolean(h, 650), "is2d": vs.GetObjectVariableBoolean(h, 651),
  "is3dText": vs.GetObjectVariableBoolean(t, 650),
  "angle": vs.GetObjectVariableReal(h, 74), "x": vs.GetObjectVariableReal(h, 110), "y": vs.GetObjectVariableReal(h, 111),
  "iAxis": vs.GetObjectVariableReal(h, 112), "jAxis": vs.GetObjectVariableReal(h, 113),
  "textAngle": vs.GetObjectVariableReal(t, 74), "textIAxis": vs.GetObjectVariableReal(t, 112),
  "fill": vs.GetObjectVariableLongInt(h, 1178), "pen": vs.GetObjectVariableInt(h, 1179), "weight": vs.GetObjectVariableInt(h, 1180),
  "fillFore": vs.GetObjectVariableInt(h, 1181), "fillBack": vs.GetObjectVariableInt(h, 1182),
  "penFore": vs.GetObjectVariableInt(h, 1183), "penBack": vs.GetObjectVariableInt(h, 1184),
}))`, prepared());
  assert.equal(v.is3d, true);
  assert.equal(v.is2d, false);
  assert.equal(v.is3dText, false);
  near(v.angle, Math.PI / 2, "the i axis points up the page");
  near(v.x, 1);
  near(v.y, 2);
  near(v.iAxis, 2);
  near(v.jAxis, 3);
  near(v.textAngle, 0, "no fill mapping, so the neutral value");
  near(v.textIAxis, 0);
  assert.equal(v.fill, 1);
  assert.equal(v.pen, 2);
  assert.equal(v.weight, 25);
  assert.equal(v.fillFore, 5);
  assert.equal(v.fillBack, 6);
  assert.equal(v.penFore, 7);
  assert.equal(v.penBack, 8);
}

// the attribute selectors refuse a layer, and the truthful layer and fill calls refuse a Set
{
  const r = runVs(`import vs\nvs.GetObjectVariableInt(vs.Handle("${LAYER}"), 1180)\n`, { file: "layer-attr.py", snapshot: prepared() });
  assert.equal(r.error?.name, "ValueError");
  const s = runVs(`import vs\nvs.SetObjectVariableInt(vs.Handle("solid-1"), 1180, 9)\n`, { file: "set-attr.py", snapshot: prepared() });
  assert.equal(s.error?.name, "NotImplementedError");
  assert.ok((s.error?.message ?? "").includes("vs.SetObjectVariableInt(h, 1180) can't change Pen Weight in Rodeo"), s.error?.message);
}

// the table's counts: the appendix's preference selectors (2011 with 3 rows of no data type) and object selectors (362 with 1)
{
  const v = json(`print(json.dumps({"prefs": len(vs._PREFS), "objvars": len(vs._OBJVARS), "truthPrefs": sorted(vs._PREF_FROM), "truthObjs": sorted(vs._OBJVAR_FROM)}))`);
  assert.equal(v.prefs, 2008, "2011 published, of which 3 have no data type");
  assert.equal(v.objvars, 361, "362 published, of which 1 has no data type");
  assert.equal((v.truthPrefs as number[]).length, 17);
  assert.equal((v.truthObjs as number[]).length, 18);
}

console.log("vs prefs and object variables: ok");
