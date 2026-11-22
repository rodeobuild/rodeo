// Node check of the record, resource list, symbol definition, object name and plug-in object calls
// (vs/records.ts). Run from web/:
//   npx tsx src/features/python/vs/records.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, ranVs, runVs, type Snapshot, type SnapObject, type VsOutcome } from "../vsCheck.ts";

/** One object of a drawing as the script's copy holds it. */
function obj(id: string, name: string, extra: Record<string, unknown> = {}): SnapObject {
  return { id, type: 4, typeName: "rectangle", layer: LAYER, parent: null, cls: "None", name, bbox: null, attrs: {}, sym: null, ins: null, turned: 0, records: {}, shape: null, ...extra };
}

/**
 * A drawing with a data record format "Part Info" (four fields), two symbol definitions (Chair, Table; Table
 * in a folder), a hatch, a plug-in kind "Test Callout", and objects: Alpha and Beta (rectangles, Alpha
 * holding a Part Info record), an instance of Chair, and a Test Callout plug-in object with its parameter record.
 */
function recSnap(): Snapshot {
  const snap = blankSnapshot();
  snap.formats = [{ name: "Part Info", format: 5 }];
  snap.recordFields = [
    {
      name: "Part Info",
      format: 5,
      fields: [
        { name: "Serial", type: 4, value: "" },
        { name: "Count", type: 1, value: 0 },
        { name: "Ok", type: 2, value: false },
        { name: "Width", type: 9, value: 1200 },
      ],
    },
  ];
  snap.resources = [
    { type: 16, index: 7, name: "Chair", folder: "" },
    { type: 16, index: 8, name: "Table", folder: "Furniture" },
    { type: 66, index: 9, name: "Brick", folder: "" },
  ];
  snap.symbols = [
    { index: 7, name: "Chair", bbox: null },
    { index: 8, name: "Table", bbox: null },
  ];
  snap.pluginKinds = [{ id: "kind-1", name: "Test Callout" }];
  // Chair's contents (two shapes, one named), Table's are too many to be listed
  snap.symbolObjects = [
    {
      index: 7,
      type: 0,
      objects: [
        obj("sym-r1", "Inner", { layer: "x", shape: { kind: "rect", pts: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true } }),
        obj("sym-r2", "", { layer: "x", shape: { kind: "rect", pts: [[0, 0], [5, 0], [5, 5], [0, 5]], closed: true } }),
      ],
    },
  ];
  snap.savedSettings = { "Dlg\x1fPos": "3,4" };
  snap.objects = [
    obj("obj-a", "Alpha", { records: { "Part Info": { Serial: "S1", Count: "2", Ok: "True", Width: "1200" } } }),
    obj("obj-b", "Beta"),
    obj("obj-i", "", { type: 15, sym: 7, ins: [1000, 1000] }),
    obj("obj-p", "", { type: 86, typeName: "plug-in-object", ins: [0, 0], parametricRecord: "Test Callout", records: { "Test Callout": { Size: "3" } } }),
  ];
  return snap;
}

/** The steps of one kind, in the order the script made them. */
const kindOf = (r: VsOutcome, kind: string): unknown[][] => r.ops.filter((op) => op[0] === kind);
/** What the script printed with Message, joined by lines. */
const said = (r: VsOutcome): string => ((r.messages as string[] | undefined) ?? []).join("\n").trim();

// ---- data records -----------------------------------------------------------------------------------

{
  const r = ranVs(`import vs
vs.NewField("Door Info", "Mark", "D-0", 4, 0)
vs.NewField("Door Info", "Count", "1", 1, 0)
vs.NewField("Door Info", "Fire", "", 2, 0)
vs.NewField("Door Info", "Mark", "X", 4, 0)
a = vs.GetObject("Alpha")
b = vs.GetObject("Beta")
vs.SetRecord(a, "Door Info")
vs.SetRecord(b, "Door Info")
vs.SetRField(a, "Door Info", "Mark", "D-7")
vs.SetRField(a, "Door Info", "Count", 3)
vs.SetRField(a, "Door Info", "Fire", True)
vs.SetRField(a, "Part Info", "Width", 900)
vs.Message("%s|%s|%s|%s" % (vs.GetRField(a, "Door Info", "Mark"), vs.GetRField(a, "Door Info", "Count"), vs.GetRField(b, "Door Info", "Count"), vs.GetRField(a, "Part Info", "Width")))
`, { snapshot: recSnap() });
  assert.equal(said(r), "D-7|3|1|900", "NewField, SetRecord, SetRField and GetRField read back in the run");
  assert.deepEqual(kindOf(r, "recfield"), [
    ["recfield", "Door Info", "Mark", 4, "D-0", 0],
    ["recfield", "Door Info", "Count", 1, 1, 0],
    ["recfield", "Door Info", "Fire", 2, false, 0],
  ], "NewField makes one field step each; a field the format has already is left out");
  assert.deepEqual(kindOf(r, "recattach"), [["recattach", "obj-a", "Door Info"], ["recattach", "obj-b", "Door Info"]], "SetRecord attaches the record");
  assert.deepEqual(kindOf(r, "recset"), [
    ["recset", "obj-a", "Door Info", "Mark", "D-7"],
    ["recset", "obj-a", "Door Info", "Count", 3],
    ["recset", "obj-a", "Door Info", "Fire", true],
    ["recset", "obj-a", "Part Info", "Width", 900],
  ], "SetRField steps carry the value in the field's own type");
}

// Reading the drawing's own formats and records back: NumRecords, GetRecord, NumFields, GetFldName, GetFldType, GetFldFlag, GetName
{
  const r = ranVs(`import vs
a = vs.GetObject("Alpha")
f = vs.GetRecord(a, 1)
nf = vs.NumFields(f)
names = [vs.GetFldName(f, i) for i in range(1, nf + 1)]
types = [vs.GetFldType(f, i) for i in range(1, nf + 1)]
flags = [vs.GetFldFlag(f, i) for i in range(1, nf + 1)]
vs.Message("%d|%d|%s|%s|%s|%s|%s" % (vs.NumRecords(a), nf, vs.GetName(f), ",".join(names), ",".join(str(t) for t in types), ",".join(str(x) for x in flags), vs.GetFldName(f, 9) == ""))
vs.Message(str(vs.GetRecord(a, 2)))
`, { snapshot: recSnap() });
  assert.equal(said(r), "1|4|Part Info|Serial,Count,Ok,Width|4,1,2,9|0,0,0,0|True\nNone", "records, fields and their types read from the drawing");
}

// DelRecord, GetParametricRecord, Get calls on the record's value after a removal
{
  const r = ranVs(`import vs
a = vs.GetObject("Alpha")
vs.DelRecord(a, "Part Info")
vs.DelRecord(a, "Part Info")
h = vs.FObject()
p = None
while h:
    if vs.GetTypeN(h) == 86:
        p = h
    h = vs.NextObj(h)
pr = vs.GetParametricRecord(p)
vs.Message("%d|%s|%s|%s" % (vs.NumRecords(a), vs.GetName(pr), vs.GetParametricRecord(a), vs.GetRField(a, "Part Info", "Serial") == ""))
`, { snapshot: recSnap() });
  assert.equal(said(r), "0|Test Callout|None|True", "DelRecord removes a record, GetParametricRecord gives a plug-in object's record");
  assert.deepEqual(kindOf(r, "recdetach"), [["recdetach", "obj-a", "Part Info"]], "DelRecord makes one step, and only for a record the object has");
}

// Records of a format the drawing doesn't have do nothing (as Vectorworks does) and say so once on stderr;
// GetRField of one gives ""; a record the object lacks is left alone by SetRField, with a warning too
{
  const r = ranVs(`import vs
a = vs.GetObject("Alpha")
b = vs.GetObject("Beta")
vs.SetRecord(a, "Nope")
vs.SetRecord(a, "Nope")
vs.SetRField(a, "Nope", "Mark", "x")
vs.SetRField(b, "Part Info", "Serial", "z")
vs.Message("%s|%s|%d" % (vs.GetRField(a, "Nope", "Mark"), vs.GetRField(b, "Part Info", "Serial"), vs.NumRecords(a)))
`, { snapshot: recSnap() });
  assert.equal(said(r), "||1", "a missing format or record gives nothing back, and Alpha keeps its one record");
  assert.equal((r as VsOutcome & { stderr: string }).stderr, [
    "vs.SetRecord: the drawing has no record format named 'Nope', so no record was attached",
    "vs.SetRField: the drawing has no record format named 'Nope', so nothing was set",
    "vs.SetRField: the object has no record named 'Part Info', so nothing was set (SetRecord attaches one)",
    "",
  ].join("\n"), "each warning is written once per run, to stderr");
  assert.deepEqual(kindOf(r, "recset"), [], "nothing is set for the missing format or record");
  assert.deepEqual(kindOf(r, "recattach"), [], "SetRecord of a missing format attaches nothing");
}

// The same from Vectorscript: a missing format is a no-op
{
  const r = ranVs(`PROCEDURE Test;
VAR
  a : LONGINT;
BEGIN
  a := GetObject('Alpha');
  SetRecord(a, 'Nope');
  SetRField(a, 'Nope', 'Mark', 'x');
  Message(GetRField(a, 'Nope', 'Mark') + '|' + GetRField(a, 'Nope', 'Mark'));
END;
RUN(Test);`, { file: "test.vs", snapshot: recSnap() });
  assert.equal(said(r), "|", "Vectorscript SetRecord and SetRField of a missing format do nothing");
  assert.ok((r as VsOutcome & { stderr: string }).stderr.includes("vs.SetRecord: the drawing has no record format named 'Nope'"), "Vectorscript warns on stderr too");
}

// ---- resource lists and symbol definitions -------------------------------------------------------------

{
  const r = ranVs(`import vs
lst, n = vs.BuildResourceList(16, 0, "")
names = [vs.GetNameFromResourceList(lst, i) for i in range(1, vs.ResourceListSize(lst) + 1)]
sym = vs.GetResourceFromList(lst, 1)
lst2, n2 = vs.BuildResourceList2(66, 0, "", False)
bricks = vs.GetActualNameFromResourceList(lst2, 1)
vs.Message("%d|%s|%s|%s|%s|%d|%s|%s" % (n, ",".join(names), vs.GetName(sym), vs.GetTypeN(sym), bricks, n2, vs.GetNameFromResourceList(lst, 9) == "", vs.GetName(vs.ImportResourceToCurrentFile(lst, 2))))
`, { snapshot: recSnap() });
  assert.equal(said(r), "2|Chair,Table|Chair|16|Brick|1|True|Table", "BuildResourceList and the name, handle and import calls");
}

{
  const r = ranVs(`import vs
lst, n = vs.BuildResourceList(16, 0, "Furniture")
lst2, n2 = vs.BuildResourceList(16, 0, "")
added = vs.AddResourceToList(lst2, vs.GetResourceFromList(lst, 1))
wrong = vs.AddResourceToList(lst, vs.GetResourceFromList(vs.BuildResourceList(66, 0, "")[0], 1))
vs.DeleteResourceFromList(lst2, 1)
vs.Message("%d|%d|%d|%d|%d" % (n, vs.ResourceListSize(lst2), added, wrong, vs.ResourceListSize(lst)))
h = vs.FSymDef()
out = []
while h:
    out.append(vs.GetName(h))
    h = vs.NextSymDef(h)
vs.Message(",".join(out))
`, { snapshot: recSnap() });
  assert.equal(said(r), "1|2|3|0|1\nChair,Table", "Lists are filled, edited and refused by type; the symbol library is walked from FSymDef");
}

{
  const r = runVs(`import vs
vs.BuildResourceListN(16, "/tmp/other.vwx")
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /BuildResourceListN isn't available in Rodeo yet/, "BuildResourceListN says it can't read another file");
}

{
  const r = runVs(`import vs
vs.FInSymDef(vs.NextSymDef(vs.FSymDef()))
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /FInSymDef isn't available in Rodeo yet for a symbol with more than 500 objects/, "FInSymDef says a symbol over the cap isn't read");
}

// Walking a symbol definition's contents, and refusing to change them
{
  const r = ranVs(`import vs
h = vs.FSymDef()
c = vs.FInSymDef(h)
names = []
types = []
while c:
    names.append(vs.GetName(c))
    types.append(vs.GetTypeN(c))
    c = vs.NextObj(c)
vs.Message("|".join(names) + " " + ",".join(str(t) for t in types) + " " + vs.GetName(h))
`, { snapshot: recSnap() });
  assert.equal(said(r), "Inner| 4,4 Chair", "FInSymDef and NextObj walk a definition's contents");
  const edit = runVs(`import vs
c = vs.FInSymDef(vs.FSymDef())
vs.SetName(c, "Changed")
`, { snapshot: recSnap() });
  assert.match(edit.error?.message ?? "", /can't change an object inside a symbol definition yet/, "changing a definition's contents is refused");
}

{
  const r = ranVs(`import vs
vs.Message(str(vs.ActSymDef()))
vs.SetActSymbol("Table")
vs.Message(vs.GetName(vs.ActSymDef()))
vs.Message(vs.GetName(vs.ActSymDefN(False)))
`, { snapshot: recSnap() });
  assert.equal(said(r), "None\nTable\nTable", "ActSymDef and ActSymDefN give the active symbol");
}

{
  const r = ranVs(`import vs
vs.Message(str(vs.GetSymbolType(vs.NextObj(vs.GetObject("Beta")))))
`, { snapshot: recSnap() });
  assert.equal(said(r), "0", "GetSymbolType of an instance whose contents are listed gives its type");
  const big = runVs(`import vs
vs.Symbol("Table", 0, 0, 0)
vs.GetSymbolType(vs.LNewObj())
`, { snapshot: recSnap() });
  assert.match(big.error?.message ?? "", /GetSymbolType isn't available in Rodeo yet for a symbol with more than 500 objects/, "GetSymbolType of a symbol over the cap says so");
}

{
  const snap = recSnap();
  (snap.layers as unknown[]).push({ id: "layer-2", name: "Two", kind: "design", scale: 50, vis: "visible", elev: 0 });
  const r = ranVs(`import vs
b = vs.GetObject("Beta")
vs.SetParent(b, vs.GetLayerByName("Two"))
vs.Message(vs.GetLName(vs.GetLayer(b)))
vs.Message(str(vs.FInFolder(vs.FSymDef())))
`, { snapshot: snap });
  assert.equal(said(r), "Two\nNone", "SetParent moves an object to a layer; FInFolder is always None");
  assert.deepEqual(kindOf(r, "setlayer"), [["setlayer", "obj-b", "layer-2"]], "SetParent to a layer is a setlayer step");
  const into = runVs(`import vs
vs.SetParent(vs.GetObject("Beta"), vs.GetObject("Alpha"))
`, { snapshot: recSnap() });
  assert.match(into.error?.message ?? "", /SetParent into a group or a symbol definition isn't available in Rodeo yet/, "SetParent into a group is refused");
}

{
  const r = ranVs(`import vs
a = vs.GetObject("Alpha")
vs.SetRFieldOpt(a, "Part Info", "Serial", True, False)
e, d = vs.GetRFieldOpt(a, "Part Info", "Serial")
e2, d2 = vs.GetRFieldOpt(a, "Part Info", "Count")
vs.Message("%s|%s|%s|%s" % (e, d, e2, d2))
`, { snapshot: recSnap() });
  assert.equal(said(r), "True|False|False|False", "SetRFieldOpt and GetRFieldOpt keep the flags for the run");
}

{
  const r = ranVs(`import vs
ok, v = vs.GetSavedSetting("Dlg", "Pos")
vs.SetSavedSetting("Dlg", "Size", "9")
ok2, v2 = vs.GetSavedSetting("Dlg", "Size")
ok3, v3 = vs.GetSavedSetting("Dlg", "Nope")
vs.Message("%s|%s|%s|%s|%s|%s" % (ok, v, ok2, v2, ok3, repr(v3)))
`, { snapshot: recSnap() });
  assert.equal(said(r), "True|3,4|True|9|False|''", "saved settings: the browser's value, then one this run set; a missing one is not found");
  assert.deepEqual(r.savedSettingsSet, [["Dlg", "Size", "9"]], "the run's settings are handed back to be kept");
}

// A symbol made with BeginSym and EndSym: its shapes leave the layer, it joins the library, and Symbol places it
{
  const r = ranVs(`import vs
before = vs.NumObj(vs.FLayer())
vs.BeginFolder()
vs.BeginSym("Lamp")
vs.Rect(0, 0, 2, 1)
vs.EndFolder()
vs.EndSym()
after = vs.NumObj(vs.FLayer())
lst, n = vs.BuildResourceList(16, 0, "")
vs.Symbol("Lamp", 10, 10, 0)
l = vs.LNewObj()
vs.Symbol("Chair", 20, 20, 90)
c = vs.LNewObj()
x, y = vs.GetSymLoc(l)
vs.Message("%d|%d|%d|%s|%s|%s|%s|%g" % (before, after, n, vs.GetSymName(l), vs.GetSymName(c), vs.GetName(vs.GetResourceFromList(lst, 2)), vs.GetNameFromResourceList(lst, 2), x))
`, { snapshot: recSnap() });
  assert.equal(said(r), "4|4|3|Lamp|Chair|Lamp|Lamp|10", "EndSym takes the drawn shapes into the library; the new symbol is listed and placed");
  const made = kindOf(r, "symdef");
  assert.equal(made.length, 1, "one symbol definition is made");
  assert.equal(made[0]?.[2], "Lamp", "the definition has the name BeginSym gave");
  assert.ok(Array.isArray(made[0]?.[3]) && (made[0][3] as unknown[]).length === 1, "the definition takes the one object drawn between BeginSym and EndSym");
  assert.deepEqual(kindOf(r, "symbolat")[0]?.slice(0, 3), ["symbolat", (kindOf(r, "symbolat")[0] ?? [])[1], LAYER], "Symbol of a new symbol is its own step");
  assert.equal(kindOf(r, "symbol").length, 1, "Symbol of an existing symbol is the core's step");
  assert.equal((kindOf(r, "symbol")[0] ?? [])[3], 7, "the existing symbol's step names its index");
}

{
  const r = runVs(`import vs
vs.EndSym()
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /no symbol is being made/, "EndSym without BeginSym is refused");
}

{
  const r = runVs(`import vs
vs.BeginSym("Empty")
vs.EndSym()
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /has nothing in it/, "EndSym of an empty symbol is refused");
}

{
  const r = runVs(`import vs
vs.BeginSym("Lamp")
vs.Rect(0, 0, 2, 1)
vs.EndSym()
vs.SetActSymbol("Lamp")
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /SetActSymbol isn't available in Rodeo yet for a symbol made in this run/, "SetActSymbol of a symbol made in the run is refused");
}

{
  const r = ranVs(`import vs
vs.BeginFolder()
vs.EndFolder()
`, { snapshot: recSnap() });
  assert.equal(r.ops.length, 0, "BeginFolder and EndFolder change nothing");
}

{
  const r = ranVs(`import vs
x, y, z = vs.GetSymLoc3D(vs.NextObj(vs.GetObject("Beta")))
vs.Message("%g|%g|%g" % (x, y, z))
`, { snapshot: recSnap() });
  assert.equal(said(r), "1000|1000|0", "GetSymLoc3D gives the placement and the layer's elevation");
}

// ---- object names ---------------------------------------------------------------------------------------

{
  const r = ranVs(`import vs
i = vs.Name2Index("Beta")
vs.Message("%d|%s|%d|%d|%s" % (i, vs.Index2Name(1), vs.NameNum(), vs.Name2Index("Nope"), vs.NameList(2)))
vs.DelName("Beta")
vs.Message(str(vs.NameNum()))
`, { snapshot: recSnap() });
  assert.equal(said(r), "2|Alpha|2|0|Beta\n1", "Name2Index, Index2Name, NameNum and NameList read the object names");
  assert.deepEqual(kindOf(r, "name"), [["name", "obj-b", ""]], "DelName takes the name off the objects that hold it");
}

{
  const r = ranVs(`import vs
vs.NameObject("Part 5257")
vs.Rect(0, 0, 2, 1)
vs.Message(vs.GetName(vs.LNewObj()))
vs.Rect(0, 2, 2, 3)
vs.Message("[" + vs.GetName(vs.LNewObj()) + "]")
`, { snapshot: recSnap() });
  assert.equal(said(r), "Part 5257\n[]", "NameObject names the next object made, and only that one");
  assert.deepEqual(kindOf(r, "name").map((op) => op[2]), ["Part 5257"], "the name is a name step on the new object");
  const clash = runVs(`import vs
vs.NameObject("Alpha")
vs.Rect(0, 0, 2, 1)
`, { snapshot: recSnap() });
  assert.match(clash.error?.message ?? "", /another object is already named 'Alpha'/, "NameObject refuses a name another object has");
}

// ---- plug-in objects -----------------------------------------------------------------------------------

{
  const r = ranVs(`import vs
h = vs.CreateCustomObject("Test Callout", (10, 20), 45)
k = vs.CreateCustomObjectN("Test Callout", (5, 6), 0, False)
vs.Message("%s|%s" % (vs.GetTypeN(h), vs.GetTypeN(k)))
`, { snapshot: recSnap() });
  assert.equal(said(r), "86|86", "CreateCustomObject and CreateCustomObjectN return a plug-in object");
  assert.deepEqual(kindOf(r, "plugcopy"), [
    ["plugcopy", (kindOf(r, "plugcopy")[0] ?? [])[1], "kind-1", LAYER, [10, 20], 45],
    ["plugcopy", (kindOf(r, "plugcopy")[1] ?? [])[1], "kind-1", LAYER, [5, 6], 0],
  ], "a plug-in object the drawing has is copied at its point and angle");
}

{
  const r = runVs(`import vs
vs.CreateCustomObject("Nope", (0, 0), 0)
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /vs\.CreateCustomObject: Rodeo can't place the plug-in object 'Nope' from a script yet/, "an unknown plug-in object is refused plainly");
}

{
  const r = runVs(`import vs
vs.CreateCustomObjectPath("Test Callout", None, None)
`, { snapshot: recSnap() });
  assert.match(r.error?.message ?? "", /CreateCustomObjectPath isn't available in Rodeo yet/, "CreateCustomObjectPath says it can't place a path object");
}

// ---- Vectorscript spellings, with VAR parameters -------------------------------------------------------

{
  const r = ranVs(`PROCEDURE Test;
VAR
  lst, n : LONGINT;
  x, y, z : REAL;
  h : HANDLE;
BEGIN
  lst := BuildResourceList(16, 0, '', n);
  Message(GetNameFromResourceList(lst, n));
  NewField('Door Info', 'Mark', 'D-0', 4, 0);
  h := GetObject('Alpha');
  SetRecord(h, 'Door Info');
  SetRField(h, 'Door Info', 'Mark', 'D-9');
  Message(GetRField(h, 'Door Info', 'Mark'));
  GetSymLoc3D(NextObj(GetObject('Beta')), x, y, z);
  IF (x = 1000) AND (y = 1000) AND (z = 0) THEN Message('placed');
END;
RUN(Test);`, { file: "test.vs", snapshot: recSnap() });
  assert.equal(said(r), "Table\nD-9\nplaced", "Vectorscript VAR outputs of BuildResourceList and GetSymLoc3D, and record calls");
  assert.equal(kindOf(r, "recfield").length, 1, "Vectorscript NewField makes its field");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR
  lst, n : LONGINT;
  lst2, n2 : LONGINT;
BEGIN
  lst2 := BuildResourceList2(16, 0, '', n2, FALSE);
  lst := BuildResourceList(66, 0, '', n);
  Message(GetNameFromResourceList(lst2, 2));
  Message(GetNameFromResourceList(lst, 1));
END;
RUN(Test);`, { file: "test.vs", snapshot: recSnap() });
  assert.equal(said(r), "Table\nBrick", "Vectorscript BuildResourceList2 and BuildResourceList VAR counts");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR
  e, d : BOOLEAN;
  ok : BOOLEAN;
  v : STRING;
BEGIN
  GetRFieldOpt(GetObject('Alpha'), 'Part Info', 'Serial', e, d);
  SetRFieldOpt(GetObject('Alpha'), 'Part Info', 'Count', TRUE, FALSE);
  ok := GetSavedSetting('Dlg', 'Pos', v);
  Message(v);
  IF ok AND (NOT e) AND (NOT d) THEN Message('flags');
END;
RUN(Test);`, { file: "test.vs", snapshot: recSnap() });
  assert.equal(said(r), "3,4\nflags", "Vectorscript VAR outputs of GetRFieldOpt and GetSavedSetting");
}

console.log("vs record, resource, symbol, name and plug-in object calls: ok");
