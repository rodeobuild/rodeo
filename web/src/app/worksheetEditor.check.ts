// Run with: npx tsx src/app/worksheetEditor.check.ts
// The worksheet editor's pure helpers (worksheetGrid.ts): entries, column letters, the grid's rows,
// and the texts shown for formulas and database rows.
import assert from "node:assert/strict";
import { columnMarks, columnName, criteriaFor, databaseHint, displayRows, fieldFormula, parseEntry, savedFormulaHint, typedFormulaHint } from "./worksheetGrid.ts";

let n = 0;
const check = (label: string, fn: () => void): void => {
  fn();
  n++;
  console.log(`ok ${label}`);
};

check("parseEntry: a number", () => assert.deepEqual(parseEntry("12"), { value: 12 }));
check("parseEntry: a signed decimal with an exponent", () => assert.deepEqual(parseEntry("-3.5e2"), { value: -350 }));
check("parseEntry: text is kept as typed", () => assert.deepEqual(parseEntry("  Oak door "), { value: "  Oak door " }));
check("parseEntry: an empty entry clears", () => assert.deepEqual(parseEntry("   "), { value: "" }));
check("parseEntry: a formula, trimmed", () => assert.deepEqual(parseEntry("  =A1*2 "), { formula: "=A1*2" }));
check("parseEntry: a formula with a function", () => assert.deepEqual(parseEntry("=COUNT((R IN ['Door']))"), { formula: "=COUNT((R IN ['Door']))" }));

check("columnName: A, Z, AA, ZZ, AAA", () => {
  assert.equal(columnName(0), "A");
  assert.equal(columnName(25), "Z");
  assert.equal(columnName(26), "AA");
  assert.equal(columnName(701), "ZZ");
  assert.equal(columnName(702), "AAA");
});

check("displayRows: plain rows and a database row's lines", () => {
  assert.deepEqual(displayRows(4, [{ row: 1, subrows: 2 }]), [
    { kind: "plain", row: 0, display: 0 },
    { kind: "database", row: 1, display: null },
    { kind: "line", row: 1, display: 1 },
    { kind: "line", row: 1, display: 2 },
    { kind: "plain", row: 2, display: 3 },
    { kind: "plain", row: 3, display: 4 },
  ]);
});

check("displayRows: a database row with no lines, and two in a row", () => {
  assert.deepEqual(displayRows(3, [{ row: 0, subrows: 0 }, { row: 1, subrows: 1 }]), [
    { kind: "database", row: 0, display: null },
    { kind: "database", row: 1, display: null },
    { kind: "line", row: 1, display: 0 },
    { kind: "plain", row: 2, display: 1 },
  ]);
});

check("displayRows: no database rows", () => {
  assert.deepEqual(displayRows(2, []), [
    { kind: "plain", row: 0, display: 0 },
    { kind: "plain", row: 1, display: 1 },
  ]);
});

check("criteriaFor: a record's name, a quote doubled", () => {
  assert.equal(criteriaFor("Door"), "=DATABASE((R IN ['Door']))");
  assert.equal(criteriaFor("Bob's"), "=DATABASE((R IN ['Bob''s']))");
});

check("fieldFormula: 'Record'.'Field'", () => {
  assert.equal(fieldFormula("Door", "Width"), "='Door'.'Width'");
  assert.equal(fieldFormula("Bob's", "It's"), "='Bob''s'.'It''s'");
});

check("columnMarks: each flag its mark", () => {
  assert.deepEqual(columnMarks({ sort: "ascending", sum: true, summarize: true }).map((m) => m.mark), ["↑", "Σ", "≡"]);
  assert.deepEqual(columnMarks({ sort: "none", sum: false, summarize: false }), []);
});

check("typedFormulaHint: saved as a formula, or as its value with why", () => {
  assert.equal(typedFormulaHint(null), "Formula: worked out again whenever the drawing changes.");
  assert.equal(typedFormulaHint("it has +"), "Rodeo will work this out, and save its value: it has +");
});

check("savedFormulaHint: read-only with a note, kept, or saved as a formula", () => {
  assert.deepEqual(savedFormulaHint({ kept: false, note: "Rodeo doesn't work out SUM." }), {
    readOnly: true,
    hint: "Formula: Rodeo doesn't work out SUM. It shows the value the file holds.",
  });
  assert.equal(savedFormulaHint({ kept: true, note: null }).readOnly, false);
  assert.equal(savedFormulaHint({ kept: false, note: null }).hint, "Formula: worked out again whenever the drawing changes.");
});

check("databaseHint: with and without a note", () => {
  assert.equal(databaseHint(null), "Database row: double-click, or use Database Row…, to change what it lists and its columns.");
  assert.equal(
    databaseHint("criteria Rodeo can't follow"),
    "Database row: double-click, or use Database Row…, to change what it lists and its columns. Rodeo can't follow its criteria (criteria Rodeo can't follow), so it shows the lines the file holds.",
  );
});

console.log(`${n} checks passed`);
