// Checks data visualisations (dataviz.ts) on trees built in code: the stored layout the header comment
// documents (a type-76 "rOSC" record, a tree of nodes with fields) is encoded here, then read back by
// readDataViz. Covers by class, by material and by a record field, the by-field lookup (fieldText,
// vizFieldValue) and fieldViz, which makes a visualisation in memory. Run from web/:
//   npx tsx src/core/dataviz.check.ts
// It prints ok/FAIL lines and exits 1 when one fails.

import { Rec } from "./records.ts";
import { FIELD_COLOURS, fieldText, fieldViz, readDataViz, vizFieldValue, vizMatches, type VizSubject } from "./dataviz.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// ---- encoder for the stored layout ----
const AUX = 76;
const TAG_AT = 0x50;
const TREE_AT = 0x54;
const T_PLUGIN = 0x328;
const T_CLASS = 0x306;
const T_EQUALS = 0x65b;
const T_CLASS_IS = 0x2a3;
const T_STRING = 0;

const u16b = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32b = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const cat = (...parts: (number[] | Uint8Array)[]): Uint8Array => {
  const out: number[] = [];
  for (const p of parts) out.push(...p);
  return Uint8Array.from(out);
};
/** A string field: FF FE, UTF-16LE, 00 00 */
function text(s: string): Uint8Array {
  const units: number[] = [0xff, 0xfe];
  for (let i = 0; i < s.length; i++) units.push(...u16b(s.charCodeAt(i)));
  units.push(0, 0);
  return Uint8Array.from(units);
}
/** A node: u16 kind, u32 length (from its start), fields (u32 length + bytes, ended by u32 0), then children. */
function node(kind: number, fields: Uint8Array[], kids: Uint8Array[] = []): Uint8Array {
  const body: number[] = [];
  for (const f of fields) body.push(...u32b(f.length), ...f);
  body.push(...u32b(0));
  const total = 6 + body.length + kids.reduce((a, k) => a + k.length, 0);
  return cat(u16b(kind), u32b(total), body, ...kids);
}
/** A criteria token list: a plug-in test or a class test, as the stored postfix form (0 0 for none). */
function plugin(name: string): Uint8Array {
  return cat(u16b(T_PLUGIN), u16b(T_EQUALS), u16b(9), u16b(T_STRING), stringUnits(name), u16b(0));
}
function classTest(name: string): Uint8Array {
  return cat(u16b(T_CLASS), u16b(T_CLASS_IS), u16b(9), u16b(T_STRING), stringUnits(name), u16b(0));
}
function stringUnits(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(...u16b(s.charCodeAt(i)));
  return out;
}
const NO_CRITERIA = Uint8Array.from([0, 0]);

/** A value node (kind 0) with the 29 fields readDataViz reads. */
function valueNode(p: { value: string; enabled?: boolean; fill?: number; fore?: string; back?: string; pattern?: number; pen?: number; penColour?: string; hatch?: string; lineType?: string }): Uint8Array {
  const rgb = (c: string | undefined) => text(c ?? "0,0,0");
  const f: Uint8Array[] = [];
  for (let i = 0; i < 29; i++) f.push(text(""));
  f[0] = text("00000000-0000-0000-0000-000000000000");
  f[1] = Uint8Array.from([p.enabled === false ? 0 : 1]);
  f[3] = text(p.value);
  f[7] = Uint8Array.from([p.fill ?? 7]);
  f[8] = rgb(p.fore);
  f[9] = rgb(p.back);
  f[14] = Uint8Array.from(u16b(p.pattern ?? 0));
  f[16] = Uint8Array.from([p.pen ?? 1]);
  f[17] = text(p.penColour ?? "0,0,0");
  f[27] = text(p.hatch ?? "");
  f[28] = text(p.lineType ?? "");
  return node(0, f);
}

/** A visualisation node (kind 1): by "" everything, "C" class, "MATERIAL", "OSTYLE", or a record format with its field. */
function vizNode(v: { guid: string; name: string; by: string; field?: string; criteria: Uint8Array; values: Uint8Array[] }): Uint8Array {
  const f: Uint8Array[] = [];
  for (let i = 0; i < 17; i++) f.push(text(""));
  f[0] = text(v.guid);
  f[1] = text(v.name);
  f[2] = text(v.by);
  f[3] = text(v.field ?? "");
  f[13] = Uint8Array.from(u16b(v.field ? 2 : 4));
  f[14] = v.criteria;
  f[15] = Uint8Array.from(u32b(1));
  f[16] = Uint8Array.from(u32b(1));
  return node(1, f, v.values);
}

/** A drawing's rOSC record with the given visualisation nodes under its first child. */
function oscRecord(vizs: Uint8Array[]): Rec {
  const tree = node(0, [], [node(0, [], vizs)]);
  const data = new Uint8Array(TREE_AT + tree.length);
  data[0x19] = AUX;
  for (let i = 0; i < 4; i++) data[TAG_AT + i] = "rOSC".charCodeAt(i);
  data.set(tree, TREE_AT);
  return new Rec(data, 0);
}

// ---- 1. by class ----
const byClass = vizNode({
  guid: "11111111-2222-3333-4444-555555555555",
  name: "Walls in grey",
  by: "C",
  criteria: classTest("Walls"),
  values: [valueNode({ value: "Walls", fill: 1, back: "160,177,194", pen: 1, penColour: "10,20,30" })],
});
// ---- 2. by material ----
const byMaterial = vizNode({
  guid: "22222222-2222-3333-4444-555555555555",
  name: "Concrete",
  by: "MATERIAL",
  criteria: NO_CRITERIA,
  values: [valueNode({ value: "Concrete", fill: 1, back: "200,200,200" })],
});
// ---- 3. by a record field: the Space_Finish format's FinishKey, on plug-in objects of Space ----
const byField = vizNode({
  guid: "33333333-2222-3333-4444-555555555555",
  name: "Finishes-Spaces",
  by: "Space_Finish",
  field: "FinishKey",
  criteria: plugin("Space"),
  values: [
    valueNode({ value: "FL-1T", fill: 1, back: "255,255,255", pen: 1 }),
    valueNode({ value: "PT-1", fill: 0, pen: 3, lineType: "Dashed" }),
    valueNode({ value: "GWB-1", enabled: false, fill: 1, back: "0,0,0" }),
  ],
});
// ---- 4. by a record field with no field name: not a by-field visualisation ----
const noField = vizNode({ guid: "44444444-2222-3333-4444-555555555555", name: "No field", by: "Space_Finish", criteria: NO_CRITERIA, values: [valueNode({ value: "X", fill: 1, back: "1,2,3" })] });

const vizs = readDataViz([oscRecord([byClass, byMaterial, byField, noField])]);
check(vizs.size === 4, `reads all four visualisations (${vizs.size})`);

const vc = vizs.get("11111111-2222-3333-4444-555555555555");
check(!!vc && vc.by === "C" && vc.field === undefined, "by class: by is C and it has no field");
check(vc?.values.get("Walls")?.fill?.kind === "solid" && (vc.values.get("Walls")!.fill as { color: string }).color === "#a0b1c2", "by class: a solid fill reads as CSS from r,g,b");
check(vc?.values.get("Walls")?.pen?.kind === "solid" && (vc.values.get("Walls")!.pen as { color: string }).color === "#0a141e", "by class: a solid pen reads its colour");
const wallSubject: VizSubject = { plugin: null, layer: "L", story: null, className: "Walls", type: 68 };
check(vc ? vizMatches(vc.criteria, wallSubject) : false, "by class: the class test matches a Walls object");
check(vc ? !vizMatches(vc.criteria, { ...wallSubject, className: "Doors" }) : false, "by class: and not a Doors object");

const vm = vizs.get("22222222-2222-3333-4444-555555555555");
check(!!vm && vm.by === "MATERIAL" && vm.field === undefined && vm.criteria === null, "by material: MATERIAL with no criteria and no field");

const vf = vizs.get("33333333-2222-3333-4444-555555555555");
check(vf?.by === "Space_Finish" && vf?.field?.record === "Space_Finish" && vf?.field?.field === "FinishKey", "by field: record format and field read from the node");
check(vf?.values.size === 2 && !vf?.values.has("GWB-1"), "by field: disabled values are left out");
check(vf?.values.get("FL-1T")?.fill?.kind === "solid" && vf?.values.get("PT-1")?.pen?.kind === "line-type", "by field: values carry their fill and line type");
check(vf?.values.get("PT-1")?.pen?.kind === "line-type" && (vf!.values.get("PT-1")!.pen as { name: string }).name === "Dashed", "by field: a line type's name reads");
const space: VizSubject = { plugin: "Space", layer: "Rooms", story: null, className: "", type: 2, value: (r, f) => (r === "Space_Finish" && f === "FinishKey" ? "FL-1T" : null) };
check(vf ? vizMatches(vf.criteria, space) : false, "by field: plugin Space matches");
check(vf ? !vizMatches(vf.criteria, { ...space, plugin: null }) : false, "by field: an object with no plug-in does not");
check(vf ? vizFieldValue(vf, space) === "FL-1T" : false, "by field: the value comes from the object's field");
check(vf ? vizFieldValue(vf, { ...space, value: () => null }) === null : false, "by field: no value when the object has no such field");
check(vizs.get("44444444-2222-3333-4444-555555555555")?.field === undefined, "a record format with no field name is not a by-field visualisation");
check(vc ? vizFieldValue(vc, space) === null : false, "vizFieldValue is null for a visualisation with no field");

// ---- fieldText ----
check(fieldText("FL-2T") === "FL-2T", "fieldText: text is itself");
check(fieldText("") === null && fieldText(undefined) === null && fieldText(null) === null, "fieldText: empty, missing and null give none");
check(fieldText("\u0000Waterfall Edge\u0000Waterfall Edge") === null, "fieldText: a choice with no current value (text before the NUL) gives none");
check(fieldText("Double Pencil Edge\u0000Straight\u0000Straight") === "Double Pencil Edge", "fieldText: a choice's current value is the text before its NUL");
check(fieldText(11) === "11" && fieldText(0) === "0" && fieldText(true) === "true", "fieldText: numbers and booleans as their text");

// ---- fieldViz ----
const fv = fieldViz("Rooms by floor", "Space", "Space", "Floor Finish", ["Tile", "", "Carpet", "Tile", "Wood"]);
check(fv.name === "Rooms by floor" && fv.by === "Space" && fv.field?.record === "Space" && fv.field?.field === "Floor Finish", "fieldViz: name, record and field");
check(!!fv.criteria && "test" in fv.criteria && fv.criteria.test === "plugin" && fv.criteria.value === "Space", "fieldViz: plugin criteria");
check(fv.values.size === 3 && !fv.values.has(""), "fieldViz: one entry per distinct non-empty value");
check(fv.values.get("Carpet")?.fill?.kind === "solid" && (fv.values.get("Carpet")!.fill as { color: string }).color === FIELD_COLOURS[0], "fieldViz: values in sorted order take the colours in turn (Carpet first)");
check((fv.values.get("Tile")!.fill as { color: string }).color === FIELD_COLOURS[1] && (fv.values.get("Wood")!.fill as { color: string }).color === FIELD_COLOURS[2], "fieldViz: Tile then Wood");
check(fv.values.get("Tile")?.pen === undefined, "fieldViz: only a fill, the pen stays as drawn");
const many = Array.from({ length: 13 }, (_, i) => `V${String(i).padStart(2, "0")}`);
const wrap = fieldViz("Many", "", "Space", "Name", many);
check(wrap.criteria === null, "fieldViz: no plug-in gives no criteria");
check(wrap.values.size === 13 && (wrap.values.get("V12")!.fill as { color: string }).color === FIELD_COLOURS[0], "fieldViz: colours repeat after twelve (the 13th value takes the first colour)");
check(new Set(FIELD_COLOURS).size === 12 && FIELD_COLOURS.every((c) => /^#[0-9a-f]{6}$/.test(c)), "fieldViz: twelve distinct CSS hex colours");
check(fieldViz("Empty", "Space", "Space", "Name", ["", ""]).values.size === 0, "fieldViz: only empty values gives no entries");

console.log(failures === 0 ? "\nall dataviz checks passed" : `\n${failures} dataviz check(s) FAILED`);
if (failures) process.exit(1);
