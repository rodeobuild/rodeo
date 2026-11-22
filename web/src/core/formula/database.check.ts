// Checks database.ts on a small drawing built in code (no sample files): criteria (R IN, field
// tests, PON, L, AND/OR, wildcards, name-table text), unnamed keywords, Summarize grouping with Sum,
// COUNT, display order, the header totals, and the claims for shapes not settled. Run from web/:
//   npx tsx src/core/formula/database.check.ts
import type { ObjectInfo, ObjectRecord, RecordField, VwxDocument } from "../types.ts";
import type { Node } from "./ast.ts";
import { parse, type ParseContext } from "./text.ts";
import { type ColumnDef, databaseRow, fieldValue, type IndexedObject, matchCriteria, objectIndex } from "./database.ts";
import { setU16 } from "../bytes.ts";

const names = new Map<number, string>([
  [101, "Door"],
  [102, "Space"],
  [103, "Material A"],
  [104, "Material B"],
  [201, "Door"],
  [202, "Space"],
]);

/** a data record format of the given fields (name, field type code), as the file holds one (FORMAT.md §7.3) */
function formatRecord(nameIndex: number, fields: [string, number][]) {
  const d = new Uint8Array(0x60 + 0x88 * fields.length);
  setU16(d, 0x50, fields.length);
  fields.forEach(([name, type], i) => {
    const o = 0x60 + i * 0x88;
    setU16(d, o, type);
    for (let k = 0; k < name.length; k++) setU16(d, o + 8 + 2 * k, name.charCodeAt(k));
  });
  return { type: 47, nameIndex, data: d };
}

interface Fake {
  id: string;
  layer: string;
  records: ObjectRecord[];
}

function record(rec: string, values: Record<string, RecordField["value"]>, kinds: Record<string, RecordField["kind"]>, parametric = false): ObjectRecord {
  return {
    format: 0,
    name: rec,
    parametric,
    fields: Object.entries(values).map(([name, value]) => ({ name, kind: kinds[name] ?? "text", value })),
  };
}

const door = (mark: string, onSched: boolean, width: number): ObjectRecord => record("Door", { OnSched: onSched, Width: width, Mark: mark }, { OnSched: "boolean", Width: "dimension" });
const room = (kind: string | number, mat: number, area: number): ObjectRecord =>
  record("Space", { Area: area, Mat: mat, Kind: kind }, { Area: "area", Mat: "integer", Kind: "choice" }, true);

const fake: Fake[] = [
  { id: "d1", layer: "L1", records: [door("D_1", true, 914.4)] },
  { id: "d2", layer: "L1", records: [door("D_2", true, 762)] },
  { id: "d3", layer: "L1", records: [door("D_3", false, 610)] },
  { id: "d4", layer: "L2", records: [door("D_4", true, 914.4)] },
  { id: "s1", layer: "L1", records: [room("Office", 103, 2787.9)] },
  { id: "s2", layer: "L1", records: [room("Hall", 104, 9290.3)] },
  { id: "s3", layer: "L1", records: [room("office", 103, 5574.2)] },
  { id: "s4", layer: "L1", records: [room("Store", 104, 1000)] },
  { id: "x1", layer: "L1", records: [] },
];
// the same drawing plus one room whose popup holds a number as text (its choice's name isn't in the file)
const numbered: Fake[] = [...fake, { id: "s5", layer: "L1", records: [room("4", 103, 100)] }];

// the part of VwxDocument the index reads; the popup fields (types 8, 9) and the others are in the formats
function makeDoc(objs: Fake[]) {
  return {
    info: { units: "Feet & Inches" } as VwxDocument["info"],
    layers: () => [
      { id: "L1", name: "1-Design", kind: "design" },
      { id: "L2", name: "2-Hidden", kind: "design" },
    ],
    objects: (layerId: string) =>
      objs.filter((f) => f.layer === layerId).map((f) => ({ id: f.id, layerId, type: 86, kind: "other", parentId: null }) as unknown as ObjectInfo),
    records: (id: string) => objs.find((f) => f.id === id)?.records ?? [],
    rec: (id: string) => (objs.some((f) => f.id === id) ? { nameIndex: 0 } : null),
    names,
    recs: [
      formatRecord(201, [["Mark", 4], ["Width", 7], ["OnSched", 2], ["Config", 9]]),
      formatRecord(202, [["Area", 21], ["Mat", 24], ["Kind", 8]]),
    ],
  } as unknown as Parameters<typeof objectIndex>[0];
}

const ctx: ParseContext = {
  nameIndex: (n) => [...names].find(([, v]) => v === n)?.[0] ?? 0,
  field: (_rec, f) => ({ type: f === "Area" ? 21 : f === "Width" ? 7 : f === "Mat" ? 24 : f === "OnSched" ? 2 : 4, offset: 0 }),
};

function criteria(text: string): Node {
  return parse(text, ctx);
}
function field(rec: string, f: string): Node {
  return { k: "field", rec, recRef: 0, recQuoted: true, field: f, type: 4, offset: 0, fieldQuoted: true };
}
function col(formula: Node, extra: Partial<ColumnDef> = {}): ColumnDef {
  return { formula, summarize: false, sort: "none", precedence: 0, sum: false, ...extra };
}

let failures = 0;
function expect(label: string, got: unknown, want: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
}

const index = objectIndex(makeDoc(fake));
const numIndex = objectIndex(makeDoc(numbered));
const ids = (objs: { id: string }[]) => objs.map((o) => o.id);

// criteria
expect("R IN and a boolean field", ids(matchCriteria(index, criteria("=DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))")).objects), ["d1", "d2", "d4"]);
expect("plug-in name and layer", ids(matchCriteria(index, criteria("=DATABASE((PON='Space') & (L='1-Design'))")).objects), ["s1", "s2", "s3", "s4"]);
expect("text compare ignores case", ids(matchCriteria(index, criteria("=DATABASE((PON='Space') & ('Space'.'Kind'='office'))")).objects), ["s1", "s3"]);
const wildcard: Node = { k: "call", fn: 0x029a, args: [{ k: "op", op: 0x064f, a: { k: "op", op: 0x0641, a: { k: "set", items: [{ k: "str", v: "Door", ref: 0, tok: 0x065b }] }, b: { k: "kw", id: 0x0308 } }, b: { k: "paren", a: { k: "op", op: 0x0647, a: field("Door", "Mark"), b: { k: "word", v: "D_*" } } } }] };
expect("wildcard pattern", ids(matchCriteria(index, wildcard).objects), ["d1", "d2", "d3", "d4"]);
expect("a name-table integer reads as its name (format type 24)", fieldValue({ name: "Mat", kind: "integer", value: 104, code: 24 }, "Feet & Inches", names), "Material B");
const worked = (f: Parameters<typeof fieldValue>[0]) => { try { return fieldValue(f, "Feet & Inches", names); } catch { return "not worked"; } };
expect("a popup holding a number as text is not worked out", worked({ name: "Kind", kind: "choice", value: "1", code: 8 }), "not worked");
expect("a popup holding a number is not worked out", worked({ name: "Kind", kind: "choice", value: 4, code: 9 }), "not worked");
expect("a popup holding text is its text", worked({ name: "Kind", kind: "choice", value: "Office", code: 8 }), "Office");
expect("a bracketed field criteria side compares as the field", ids(matchCriteria(index, criteria("=DATABASE((PON='Space') & (('Space'.'Kind')='office'))")).objects), ["s1", "s3"]);
expect("OR of two tests", ids(matchCriteria(index, criteria("=DATABASE((R IN ['Door']) & (('Door'.'Mark'='D_1') | ('Door'.'Mark'='D_3')))")).objects), ["d1", "d3"]);
expect("NOTINDLVP is true for every object here", matchCriteria(index, criteria("=DATABASE(NOTINDLVP & (PON='Space'))")).objects.length, 4);
expect("an unnamed keyword is unsupported", matchCriteria(index, criteria("=DATABASE((R IN ['Door']) & (K031D))")).unsupported !== null, true);
expect("an unnamed keyword as a hypothesis", ids(matchCriteria(index, criteria("=DATABASE((R IN ['Door']) & (K031D))"), { unnamedKeyword: () => true }).objects), ["d1", "d2", "d3", "d4"]);

// columns: a sorted text column, a numeric column with its header, a Summarize group with Sum, COUNT
const plain = databaseRow(index, criteria("=DATABASE((R IN ['Door']) & ('Door'.'OnSched'=TRUE))"), [col(field("Door", "Mark"), { sort: "ascending", precedence: 1 }), col(field("Door", "Width"))], "Feet & Inches");
expect("one subrow per object", plain.subrows.length, 3);
expect("display order by the sort column", plain.order.map((i) => plain.subrows[i]!.values[0]), ["D_1", "D_2", "D_4"]);
expect("a numeric header is the sum of its cells (feet and inches)", plain.header[1], (914.4 + 762 + 914.4) / 304.8);
expect("a text header is left unworked", plain.header[0], null);

const summed = databaseRow(
  index,
  criteria("=DATABASE((PON='Space'))"),
  [col(field("Space", "Mat"), { summarize: true }), col(field("Space", "Area"), { sum: true }), col({ k: "call", fn: 0x02c7, args: [], empty: true })],
  "Feet & Inches",
);
expect("summarized: one subrow per distinct value, first appearance order", summed.subrows.length, 2);
expect("Sum column adds the areas (square feet)", summed.subrows.map((s) => Math.round((s.values[1] as number) * 1e6) / 1e6), [
  Math.round(((2787.9 + 5574.2) / 92903.04) * 1e6) / 1e6,
  Math.round(((9290.3 + 1000) / 92903.04) * 1e6) / 1e6,
]);
expect("COUNT counts the objects of a subrow", summed.subrows.map((s) => s.values[2]), [2, 2]);

// popup columns: claimed for text, unclaimed (the row's values for it not worked out) for a number as text
const popupText = databaseRow(index, criteria("=DATABASE((PON='Space'))"), [col(field("Space", "Kind"), { sort: "ascending", precedence: 1 })], "Feet & Inches");
expect("a popup column of text is claimed", popupText.unsupported, [null]);
expect("and its cells are the texts", popupText.subrows.map((s) => s.values[0]), ["Office", "Hall", "office", "Store"]);
const popupNum = databaseRow(numIndex, criteria("=DATABASE((PON='Space'))"), [col(field("Space", "Kind")), col(field("Space", "Area"), { sum: true })], "Feet & Inches");
expect("a popup column with a numbered object is unclaimed for the whole row", popupNum.unsupported[0] !== null && /numbered/.test(popupNum.unsupported[0]), true);
expect("and the other columns of that row stay claimed", popupNum.unsupported[1], null);
expect("a popup compared in criteria with a numbered object is not worked out, not thrown", matchCriteria(numIndex, criteria("=DATABASE((PON='Space') & ('Space'.'Kind'='office'))")).unsupported !== null, true);

// brackets around a field change nothing: claimed as the field is, values equal
const bracket = databaseRow(index, criteria("=DATABASE((R IN ['Door']) & ('Door'.'OnSched'=TRUE))"), [col({ k: "paren", a: field("Door", "Width") })], "Feet & Inches");
expect("a bracketed field column is claimed", bracket.unsupported, [null]);
expect("and gives the field's values", bracket.subrows.map((s) => s.values[0]), [914.4 / 304.8, 762 / 304.8, 914.4 / 304.8]);

// a column that throws for one object's value: unclaimed for the row, the row still returns
const boom = databaseRow(numIndex, criteria("=DATABASE((PON='Space'))"), [col({ k: "if", test: field("Space", "Area"), then: { k: "int", v: 1 }, else: { k: "int", v: 2 } })], "Feet & Inches");
expect("an IF on a number (not TRUE or FALSE) is unclaimed, not thrown", boom.unsupported[0] !== null, true);

expect("0x00e4 is unclaimed until its rule is settled", databaseRow(index, criteria("=DATABASE((PON='Space'))"), [col({ k: "post", op: 0x00e4, a: field("Space", "Area") })], "Feet & Inches").unsupported[0] !== null, true);

// ties in the display order: the file's rank orders subrows whose sort keys are equal; keys still come first
const tieIdx = objectIndex(makeDoc([
  { id: "t1", layer: "L1", records: [door("T_A", true, 1000)] },
  { id: "t2", layer: "L1", records: [door("T_B", true, 1000)] },
  { id: "t3", layer: "L1", records: [door("T_C", true, 1000)] },
  { id: "t4", layer: "L1", records: [door("T_D", true, 500)] },
]));
const tieCrit = criteria("=DATABASE((R IN ['Door']))");
const tieCols = [col(field("Door", "Width"), { sort: "ascending", precedence: 1 }), col(field("Door", "Mark"))];
const marks = (r: ReturnType<typeof databaseRow>) => r.order.map((i) => r.subrows[i]!.values[1]);
expect("ties keep stored order without a rank", marks(databaseRow(tieIdx, tieCrit, tieCols, "Feet & Inches")), ["T_D", "T_A", "T_B", "T_C"]);
const rankOf: Record<string, number> = { T_A: 2, T_B: 0, T_C: 1 };
const byRank = (objs: readonly IndexedObject[]) => {
  const m = objs[0]!.records().find((r) => r.name === "Door")?.fields.find((f) => f.name === "Mark")?.value as string;
  return rankOf[m];
};
expect("ties follow the rank; the key still orders the rest", marks(databaseRow(tieIdx, tieCrit, tieCols, "Feet & Inches", { rank: byRank })), ["T_D", "T_B", "T_C", "T_A"]);
expect("a subrow with a rank comes before a tied one without", marks(databaseRow(tieIdx, tieCrit, tieCols, "Feet & Inches", { rank: (objs) => (objs[0] === tieIdx.objects[2] ? 5 : undefined) })), ["T_D", "T_C", "T_A", "T_B"]);

console.log(failures ? `${failures} failure(s)` : "ok: database.ts behaves as the checks describe");
process.exit(failures ? 1 : 0);
