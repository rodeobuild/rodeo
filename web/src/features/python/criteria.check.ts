// Node check of the search criteria (vsModule.ts: _criteria, ForEachObject, Count, SelectObj and the
// measure calls): the forms the reference documents (Appendix E), run as Vectorscript against a prepared
// drawing. Run from web/: npx tsx src/features/python/criteria.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, ranVs, runVs, type Snapshot, type SnapObject, type VsOutcome } from "./vsCheck.ts";

function messages(r: VsOutcome): string[] {
  return Array.isArray(r.messages) ? (r.messages as string[]) : [];
}

const ATTRS = { fillPattern: 1, fillFore: 7, fillBack: 0, penPattern: 2, penFore: 255, penBack: 0, lineWeight: 0.05, opacity: 100 };

function obj(id: string, type: number, typeName: string, extra: Partial<SnapObject> = {}): SnapObject {
  return { id, type, typeName, layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 10, 10], attrs: { ...ATTRS }, sym: null, ins: null, turned: 0, records: {}, shape: null, ...extra } as SnapObject;
}

/**
 * A drawing with a record format "Part Info", a symbol Chair (index 7), the classes Walls (visible) and
 * Hidden (hidden), and five objects: Alpha (rectangle, Part Info record, fill pattern 1), Beta (oval in
 * Walls, selected), Line (a line in the hidden class), Chair (an instance of the symbol), Gamma (rectangle,
 * fill pattern 2, fill colour 9).
 */
function drawing(): Snapshot {
  const snap = blankSnapshot();
  snap.formats = [{ name: "Part Info", format: 5 }];
  snap.resources = [{ type: 16, index: 7, name: "Chair", folder: "" }];
  snap.symbols = [{ index: 7, name: "Chair", bbox: null }];
  snap.classes = [
    ...(snap.classes as unknown[]),
    { name: "Walls", vis: "visible", attrs: { ...ATTRS }, textStyle: undefined },
    { name: "Hidden", vis: "hidden", attrs: { ...ATTRS }, textStyle: undefined },
  ] as Snapshot["classes"];
  const alpha = obj("alpha", 3, "rectangle", { name: "Alpha", records: { "Part Info": { Serial: "A1" } } as never });
  const beta = obj("beta", 4, "oval", { name: "Beta", cls: "Walls" });
  const line = obj("line", 2, "line", { cls: "Hidden", name: "Line" });
  const chair = obj("chair", 15, "symbol", { sym: 7, name: "Chair" });
  const gamma = obj("gamma", 3, "rectangle", { name: "Gamma", attrs: { ...ATTRS, fillPattern: 2, fillFore: 9 } });
  snap.objects = [alpha, beta, line, chair, gamma] as never;
  snap.selection = ["beta"];
  return snap;
}

const counts = [
  // every object, and the flags and type words
  ["ALL", "Count('ALL')", "5"],
  ["a type", "Count('T=RECT')", "2"],
  ["type words in brackets, joined by OR", "Count('(T=RECT) OR (T=OVAL)')", "3"],
  ["type words joined by |", "Count('(T=RECT) | (T=OVAL)')", "3"],
  ["a type given as its number", "Count('T=3')", "2"],
  ["a bare flag (SEL) is the same as SEL=TRUE", "Count('((SEL))')", "1"],
  ["SEL=TRUE", "Count('(SEL=TRUE)')", "1"],
  ["SEL=FALSE", "Count('(SEL=FALSE)')", "4"],
  ["a bare V tests visibility", "Count('V')", "4"],
  ["V=FALSE", "Count('V=FALSE')", "1"],
  ["V=TRUE with NOT", "Count('NOT (V=TRUE)')", "1"],
  // classes, layers, names, symbols and records
  ["C IN a list", "Count('C IN [''Walls'', ''Hidden'']')", "2"],
  ["C=", "Count('C=''Walls''')", "1"],
  ["L=", "Count('L=''Design Layer-1''')", "5"],
  ["N<> with AND", "Count('T=RECT AND N<>''Alpha''')", "1"],
  ["N IN a list", "Count('N IN [''Alpha'', ''Beta'']')", "2"],
  ["S= the symbol's name", "Count('S=''Chair''')", "1"],
  ["S IN a list", "Count('S IN [''Chair'', ''Table'']')", "1"],
  ["R IN with the record's name", "Count('R IN [''Part Info'']')", "1"],
  ["R= with the record's name", "Count('R=''Part Info''')", "1"],
  ["R<> with a record nobody has", "Count('R<>''Nope''')", "5"],
  // attribute codes the snapshot holds, and their IN lists
  ["FP=", "Count('(FP=1) & (T=RECT)')", "1"],
  ["FF IN a list of colours", "Count('FF IN [9, 3]')", "1"],
  ["FF IN a list that holds the common colour", "Count('FF IN [7, 9]')", "5"],
  ["FB=", "Count('FB=0')", "5"],
  // scope words and NOT: a scope word matches the objects it names
  ["INSYMBOL with a type", "Count('(T=RECT) & INSYMBOL')", "2"],
  ["NOT with a bracket", "Count('NOT (T=RECT)')", "3"],
  ["AND and OR with brackets", "Count('((T=RECT) AND (FP=2)) OR (T=LINE)')", "2"],
  // the selection calls take the same criteria
  ["DSelect and Select by criteria", "Count('(SEL=TRUE)')", "1"],
] as const;

{
  const r = ranVs(
    ["PROCEDURE Main;", "BEGIN", ...counts.map(([, c]) => `  Message(${c});`), "END;", "RUN(Main);"].join("\n"),
    { file: "criteria.vs", snapshot: drawing() },
  );
  const got = messages(r);
  const bad = counts.map(([name, , want], i) => (got[i] === want ? "" : `${name}: got ${got[i]}, expected ${want}`)).filter(Boolean);
  assert.deepEqual(bad, [], "criteria that counted something else");
}

// the selection calls: SelectObj selects what matches, DSelectObj clears it
{
  const r = ranVs(
    `PROCEDURE Main;
BEGIN
  SelectObj('(T=RECT)');
  Message(Count('(SEL=TRUE)'));
  DSelectObj('N=''Alpha''');
  Message(Count('(SEL=TRUE)'));
END;
RUN(Main);`,
    { file: "select.vs", snapshot: drawing() },
  );
  // Beta was selected in the drawing, so the rectangles make three; DSelectObj then clears Alpha
  assert.deepEqual(messages(r), ["3", "2"]);
}

// record-field comparisons: 'Record'.'Field' <op> value. A drawing whose objects have the record or lack it
{
  const snap = blankSnapshot();
  snap.formats = [{ name: "Part Info", format: 5 }];
  const rects = (id: string, name: string, records: Record<string, Record<string, unknown>>) =>
    obj(id, 3, "rectangle", { name, records: records as never });
  snap.objects = [
    rects("bolt", "Bolt", { "Part Info": { Count: 3, Name: "Bolt", Width: 1200 } }),
    obj("oval", 4, "oval", { name: "Oval", cls: "Walls", records: { "Lighting Device": { Position: "1E" } } as never }),
    obj("line", 2, "line", { name: "Line", records: { Tag: { Code: "7" } } as never }),
    rects("blank", "Blank", { "Part Info": { Count: 1, Name: "" } }),
    rects("light", "Light", { "Lighting Device": { Position: "2" } }),
  ] as never;
  const fields: [string, string, string][] = [
    // the reference's example form, with the record term in brackets and R IN
    ["Lighting Device with R IN", "(('Lighting Device'.'Position'='1E') & (R IN ['Lighting Device']))", "1"],
    ["Count above 1", "('Part Info'.'Count'>1)", "1"],
    ["Name equal to empty text (lacking the record never matches)", "('Part Info'.'Name'='')", "1"],
    ["Name not equal to empty text", "('Part Info'.'Name'<>'')", "1"],
    ["Count at most 1", "('Part Info'.'Count'<=1)", "1"],
    ["Count at least 1", "('Part Info'.'Count'>=1)", "2"],
    ["Count below 3", "('Part Info'.'Count'<3)", "1"],
    ["Count not 1 (the blank one is 1, the others lack the record)", "('Part Info'.'Count'<>1)", "1"],
    ["Name equal, ignoring case", "('Part Info'.'Name'='bolt')", "1"],
    ["record name ignoring case", "('part info'.'name'='Bolt')", "1"],
    ["a bare identifier for the record and field", "(Tag.Code=7)", "1"],
    ["a bare identifier, not equal", "(Tag.Code<>7)", "0"],
    ["a number with a unit mark, against a number", "('Part Info'.'Width'='1200mm')", "1"],
    ["a number with a metre mark (no conversion: 1200 is not 1.2)", "('Part Info'.'Width'>=1.2m)", "1"],
    ["text compares ignoring case: empty sorts first", "('Part Info'.'Name'<'C')", "2"],
    ["record term & type", "(T=RECT) & ('Part Info'.'Count'>0)", "2"],
    ["record term | record term", "('Part Info'.'Count'>2) | (Tag.Code=7)", "2"],
    ["record term & R IN", "(R IN ['Part Info']) & ('Part Info'.'Name'='')", "1"],
    ["NOT of a record term (objects lacking the record count)", "NOT ('Part Info'.'Name'='')", "4"],
    ["the raw form, unquoted in the call", "Count(('Part Info'.'Count'>1))", "1"],
  ];
  const r = ranVs(
    ["PROCEDURE Main;", "BEGIN", ...fields.map(([, c]) => `  Message(${c.startsWith("Count(") ? c : `Count('${c.replace(/'/g, "''")}')`});`), "END;", "RUN(Main);"].join("\n"),
    { file: "fields.vs", snapshot: snap },
  );
  const got = messages(r);
  const bad = fields.map(([name, , want], i) => (got[i] === want ? "" : `${name}: got ${got[i]}, expected ${want}`)).filter(Boolean);
  assert.deepEqual(bad, [], "record-field comparisons that counted something else");
}

// a comparison needs an operator
{
  const r = runVs(`PROCEDURE Main;\nBEGIN\n  Message(Count('(''Part Info''.''Count'' 1)'));\nEND;\nRUN(Main);`, { file: "op.vs", snapshot: blankSnapshot() });
  assert.match(String(r.error?.message), /needs = <> < > <= or >=/);
}

// a form the reference documents but Rodeo doesn't have yet stops the script, saying which one
for (const [code, what] of [
  ["Count('STO=''Story-1''')", "STO"],
  ["Count('ISFLIPPED')", "ISFLIPPED"],
  ["Count('LT=''Dashed''')", "LT"],
  ["Count('(T=RECT) =DATABASE')", "=DATABASE"],
] as const) {
  const r = runVs(`PROCEDURE Main;\nBEGIN\n  Message(${code});\nEND;\nRUN(Main);`, { file: "missing.vs", snapshot: drawing() });
  assert.ok(r.error, `${what} should stop the script`);
  assert.match(String(r.error?.message), /isn't available|needs|criteria/, what);
}

// a broken criteria says what is wrong
{
  const r = runVs(`PROCEDURE Main;\nBEGIN\n  Message(Count('(T=RECT'));\nEND;\nRUN(Main);`, { file: "broken.vs", snapshot: drawing() });
  assert.match(String(r.error?.message), /bracket/);
}

console.log("criteria: ok (" + counts.length + " forms counted; the selection calls; the forms left as errors)");
