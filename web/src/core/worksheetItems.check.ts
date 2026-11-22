// Checks worksheetItems.ts: reads every worksheet of the sample files as its items, checks that they
// lay out byte for byte, that the operations rewrite cells, rows and blocks to the files' own bytes,
// and prints the measurements behind the choices in worksheetItems.ts as counts only (no cell text,
// names or numbers from the files are printed).
//
//   npx tsx src/core/worksheetItems.check.ts [files...]
//
// With no arguments it reads ../samples/sample.vwx (if present) and every .vwx under ../samples/demos/*/.
// Exit 1 when an exact expectation fails. Synthetic tests (no files) run first.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openVwx } from "./index.ts";
import { f64, i32, setU64, u16, u32 } from "./bytes.ts";
import { Rec } from "./records.ts";
import { blankWorksheetTemplate } from "./worksheetNew.ts";
import { readBlock, readDatabaseRows, type DatabaseBlockRecords, type DatabaseRow } from "./worksheetDb.ts";
import { BLOCK_TABLE, DATABASE_BLOCK, DATABASE_OBJECTS, DATABASE_ORDER, FORMAT_SIZE, gridAt, KIND_FORMULA, newWorksheetRecord, readWorksheet, readWorksheetContents, RESULT_SIZE, ROW_DATABASE, ROW_PLAIN, SHEET_COUNTS, SHEET_TABLE, WORKSHEET } from "./worksheet.ts";
import {
  buildBlock,
  deleteColumns,
  deleteRows,
  deletedBlocks,
  insertColumns,
  insertRows,
  laySheet,
  plainValue,
  readSheet,
  retop,
  setCachedResult,
  setDatabaseRow,
  setFormulaCell,
  type BlockNext,
  type Cached,
  type DatabaseDef,
  type SheetItems,
} from "./worksheetItems.ts";

const RECORD_HEADER = 0x50;
const counts = new Map<string, number>();
const inc = (k: string, n = 1): void => {
  counts.set(k, (counts.get(k) ?? 0) + n);
};
const get = (k: string): number => counts.get(k) ?? 0;
/** exact expectations that failed */
const failures: string[] = [];
const expect = (ok: boolean, what: string): void => {
  if (!ok) failures.push(what);
};

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** the item's natural length from its own layout, or null when its kind is not decoded */
function naturalLength(item: Uint8Array, cellKind: boolean): number | null {
  if (!cellKind) {
    const kind = u16(item, 0);
    if (kind === ROW_PLAIN) return 8;
    if (kind === ROW_DATABASE) return item.length >= 18 ? 18 + u32(item, 14) : null;
    return item.length === 6 && kind === 1 ? 6 : null;
  }
  if (item.length < FORMAT_SIZE + 6) return null;
  const len = u32(item, FORMAT_SIZE + 2);
  const head = FORMAT_SIZE + 6 + RESULT_SIZE;
  const kind = item[FORMAT_SIZE];
  if (kind === 0) return head + Math.max(2, 2 * len);
  if (kind === 1 || kind === 2) return head + len;
  return null;
}

interface Sheet {
  file: string;
  rec: Rec;
  d: Uint8Array;
  blocks: Map<number, DatabaseBlockRecords>;
  blockRecs: Rec[];
}

function sheetsOf(file: string): Sheet[] {
  const session = openVwx(new Uint8Array(readFileSync(file)), basename(file));
  const { recs } = (session as unknown as { doc: { recs: Rec[] } }).doc;
  const out: Sheet[] = [];
  for (const rec of recs) {
    if (rec.type !== WORKSHEET) continue;
    const blockRecs = rec.children.filter((c) => c.type === DATABASE_BLOCK);
    const blocks = new Map<number, DatabaseBlockRecords>();
    for (const b of blockRecs) {
      const child = (type: number): Uint8Array | null => b.children.find((k) => k.type === type)?.data ?? null;
      blocks.set(b.nameIndex, { data: b.data, order: child(DATABASE_ORDER), objects: child(DATABASE_OBJECTS) });
    }
    out.push({ file, rec, d: rec.data, blocks, blockRecs });
  }
  return out;
}

/** the cached result of a formula cell's item, as the model takes it; null when its kind is not decoded */
function cachedOf(item: Uint8Array): Cached | null {
  const at = FORMAT_SIZE + 6;
  const kind = item[at];
  if (kind === 0) return f64(item, at + 2);
  if (kind === 7) return i32(item, at + 2);
  if (kind === 5) return { textResult: f64(item, at + 2) };
  return null;
}

/** A sheet's database row definition from the model, as setDatabaseRow takes it; null when a header cell is not a formula. */
function defOf(s: SheetItems, row: DatabaseRow): DatabaseDef | null {
  const columns = [];
  for (let c = 0; c < s.cols; c++) {
    const e = s.cells[row.row]![c]!;
    if (!e.item) {
      columns.push(null);
      continue;
    }
    if (e.item[FORMAT_SIZE] !== KIND_FORMULA) return null;
    const cached = cachedOf(e.item);
    if (cached === null) return null;
    const tokens = e.item.slice(FORMAT_SIZE + 6 + RESULT_SIZE, FORMAT_SIZE + 6 + RESULT_SIZE + u32(e.item, FORMAT_SIZE + 2));
    const textKind = e.item[FORMAT_SIZE + 6] === 5;
    columns.push({ tokens, flags: e.flags, cached: typeof cached === "number" ? cached : typeof cached === "object" && cached !== null && "textResult" in cached ? cached.textResult : 0, textKind });
  }
  return { block: row.block, criteria: row.criteria, subrows: row.subrows.length, columns, rowFlags: s.rowHeads[row.row]!.flags };
}

/** Synthetic checks: no files needed. */
function syntheticChecks(): void {
  const tpl = blankWorksheetTemplate();
  const names = new Map<number, string>([[7, "Check"]]);
  const tokens = Uint8Array.from([0x5a, 0x06, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x90, 0x06]);
  const base = newWorksheetRecord(tpl.sheet, {
    name: "Syn",
    widths: [60, 80],
    rowHeight: 18,
    rows: [[{ value: "A" }, { value: 1.5 }], [{ value: "B" }, { value: 2 }]],
  });
  const m0 = readSheet(base);
  assert.ok(m0, "readSheet reads a synthetic sheet");
  assert.ok(same(laySheet(m0), base), "a synthetic sheet lays out as it was read");

  // rows and columns inserted, a text set, a formula set; read back
  let m = insertRows(m0, 1, 1, 20);
  m = insertColumns(m, 1, 1, 40);
  m = plainValue(m, 1, 1, "inserted");
  m = setFormulaCell(m, 2, 0, tokens, 3.5, { numberFormat: 2, accuracy: 2 });
  m = retop(m);
  const out = laySheet(m);
  const back = readWorksheetContents(new Rec(out, 1), names);
  assert.ok(back, "the synthetic sheet reads back");
  assert.deepEqual(
    back.cells.map((c) => `${c.row},${c.col}:${c.kind}:${c.display}`),
    ["0,0:text:A", "0,2:number:1.5", "1,1:text:inserted", "2,0:formula:3.50", "2,2:number:2"],
  );
  assert.deepEqual(back.database, [false, false, false]);
  const grid = readWorksheet(new Rec(out, 1), names);
  assert.ok(grid, "the synthetic sheet reads as a grid");
  assert.deepEqual(grid.colWidths, [60, 40, 80]);
  assert.deepEqual(grid.rowHeights, [18, 20, 18]);
  const f = readSheet(out)!;
  assert.equal(f.cells[2]![0]!.item![FORMAT_SIZE], KIND_FORMULA);
  assert.equal(f.cells[2]![0]!.flags, 0, "a text cell turned formula keeps its flags (0)");
  const fresh = setFormulaCell(insertColumns(m0, 2, 1, 40), 0, 2, tokens, 1, {});
  assert.equal(fresh.cells[0]![2]!.flags, 4, "a new formula cell on a plain row has flags 4");
  assert.equal(fresh.cells[0]![2]!.item![FORMAT_SIZE + 6], 0, "the cell's result is a number kind 0 from a whole 1");
  assert.deepEqual(f.rowHeads.map((e) => u16(e.item!, 4)), [0, 18, 38], "retop: each row's top is the heights above it");
  inc("synthetic.sheet_ok");

  // a merged range: insertions move or grow it, deletions shrink it or unmerge it
  const merged = setMerge(m0, 1, 1, 2, 2);
  assert.deepEqual(mergeOf(insertRows(merged, 0, 1, 18), 1, 0), [2, 3, 1, 2], "a range below an insertion moves down");
  assert.deepEqual(mergeOf(insertRows(merged, 1, 1, 18), 0, 0), [1, 3, 1, 2], "an insertion inside the range grows it");
  assert.deepEqual(mergeOf(deleteRows(merged, 1, 1), 0, 0), [1, 1, 1, 2], "deleting a row in the range shrinks it");
  assert.equal(mergeOf(deleteRows(setMerge(m0, 1, 1, 1, 2), 0, 1), 0, 0), null, "a range whose only row goes is unmerged");
  assert.deepEqual(mergeOf(deleteColumns(merged, 1, 1), 0, 0), [1, 2, 1, 1], "deleting a covered column shrinks the range");
  assert.deepEqual(mergeOf(insertColumns(merged, 0, 1, 40), 0, 1), [1, 2, 2, 3], "a column inserted before the range moves it right");
  inc("synthetic.merges_ok");

  // a database row: its header cells, its block, read back through the database readers
  const def: DatabaseDef = {
    block: 9,
    criteria: tokens,
    subrows: 2,
    columns: [
      { tokens, flags: 0x10014, cached: 2, textKind: false },
      { tokens, flags: 0x44, cached: 5, textKind: false },
    ],
  };
  const emptyRowSheet = insertRows(readSheet(base)!, 1, 1, 18);
  const dbSheet = laySheet(setDatabaseRow(emptyRowSheet, 1, def));
  const blockBuild = buildBlock(null, {
    block: 9,
    cols: 2,
    subrowHeight: 14,
    firstTop: 40,
    formats: [m0.cells[0]![0]!.item!.slice(0, FORMAT_SIZE), m0.cells[0]![1]!.item!.slice(0, FORMAT_SIZE)],
    subrows: [
      { values: ["b", 7.5], refs: [5, 6] },
      { values: ["A", 5], refs: [9] },
    ],
    order: [1, 0],
  });
  const blockRec = new Uint8Array(RECORD_HEADER + blockBuild.body.length);
  blockRec.set(blockBuild.body, RECORD_HEADER);
  setU64(blockRec, 0, BigInt(blockRec.length));
  blockRec[0x19] = DATABASE_BLOCK;
  const blocks = new Map([[9, { data: blockRec, order: recordOf(blockBuild.order), objects: recordOf(blockBuild.objects) }]]);
  const rows = readDatabaseRows(dbSheet, blocks);
  assert.equal(rows.length, 1, "the database row reads back");
  assert.equal(rows[0]!.row, 1);
  assert.equal(rows[0]!.subrows.length, 2);
  assert.deepEqual(rows[0]!.order, [1, 0]);
  assert.deepEqual(rows[0]!.objects.map((o) => [o.subrow, o.ref]), [[0, 5], [0, 6], [1, 9]]);
  assert.deepEqual(rows[0]!.subrows.map((s) => s.cells.map((c) => (c ? c.value : null))), [["b", 7.5], ["A", 5]]);
  assert.deepEqual(rows[0]!.criteria, tokens, "the criteria read back");
  assert.deepEqual(deletedBlocks(setDatabaseRow(emptyRowSheet, 1, def), 0, 2), [9], "deleting the rows names the block");
  assert.throws(() => setDatabaseRow(readSheet(base)!, 0, def), "a row with cells can't take a database");
  inc("synthetic.database_row_ok");
}

/** a block child record (header of zeros, its body) */
function recordOf(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(RECORD_HEADER + body.length);
  out.set(body, RECORD_HEADER);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** merged-range helper for the synthetic checks: set a range on the anchor cell of a 1-based range */
function setMerge(s: SheetItems, top: number, left: number, bottom: number, right: number): SheetItems {
  const e = s.cells[top - 1]![left - 1]!;
  const item = e.item ? e.item.slice() : null;
  assert.ok(item, "the anchor cell exists");
  item[0x11] = 1;
  new DataView(item.buffer, item.byteOffset, item.byteLength);
  const dv = new DataView(item.buffer, item.byteOffset, item.byteLength);
  dv.setUint16(0x12, top, true);
  dv.setUint16(0x14, bottom, true);
  dv.setUint16(0x16, left, true);
  dv.setUint16(0x18, right, true);
  const cells = s.cells.map((line) => line.slice());
  cells[top - 1]![left - 1] = { flags: e.flags, item };
  return { ...s, cells };
}

/** the merged range of a cell, as [top, bottom, left, right] (1-based), or null */
function mergeOf(s: SheetItems, row: number, col: number): number[] | null {
  const item = s.cells[row]![col]!.item;
  if (!item || item[0x11] === 0) return null;
  return [u16(item, 0x12), u16(item, 0x14), u16(item, 0x16), u16(item, 0x18)];
}

// --- the sample files -------------------------------------------------------------------------

function defaultFiles(): string[] {
  const samples = resolve(process.cwd(), "../samples");
  const out: string[] = [];
  const single = join(samples, "sample.vwx");
  if (existsSync(single)) out.push(single);
  const demos = join(samples, "demos");
  if (existsSync(demos)) {
    for (const dir of readdirSync(demos).sort()) {
      const sub = join(demos, dir);
      if (!statSync(sub).isDirectory()) continue;
      for (const f of readdirSync(sub).sort()) if (f.toLowerCase().endsWith(".vwx")) out.push(join(sub, f));
    }
  }
  return out;
}

function checkSheet(sh: Sheet): void {
  const { d } = sh;
  inc("sheets");
  const model = readSheet(d);
  if (!model) {
    inc("sheets.unreadable");
    failures.push("a worksheet does not read as items");
    return;
  }
  // items: entry order, contiguity, natural lengths
  const laid = laySheet(model);
  const identical = same(laid, d);
  const g = gridAt(d, SHEET_COUNTS, SHEET_TABLE)!;
  const n = g.cols + g.rows * (g.cols + 1) + 1;
  const starts: { i: number; at: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const off = u32(d, SHEET_TABLE + 8 * i + 4);
    if (off) starts.push({ i, at: SHEET_TABLE - 8 + off });
  }
  const inOrder = starts.every((x, k) => k === 0 || starts[k - 1]!.at < x.at);
  const sortedByPos = [...starts].sort((a, b) => a.at - b.at);
  const entryOrderOfSorted = sortedByPos.every((x, k) => k === 0 || sortedByPos[k - 1]!.i < x.i);
  inc(identical ? "layout.identical" : "layout.NOT_identical");
  if (!inOrder || !entryOrderOfSorted) inc("layout.not_in_entry_order");
  if (!starts.length || sortedByPos[0]!.at === SHEET_TABLE + 8 * n) inc("layout.first_item_after_table");
  else inc("layout.gap_before_first_item");
  if (identical) {
    inc("layout.identical_when_in_order", inOrder ? 1 : 0);
  }
  const endFlags = u32(d, SHEET_TABLE + 8 * (n - 1));
  if (endFlags) inc("layout.end_entry_flags_nonzero");
  // natural lengths: gaps inside items
  const check = (entryIsCell: boolean, item: Uint8Array | null, label: string): void => {
    if (!item) return;
    const nat = naturalLength(item, entryIsCell);
    if (nat === null) inc(`items.${label}.undecoded`);
    else if (nat !== item.length) inc(`items.${label}.length_differs`);
    else inc(`items.${label}.exact`);
  };
  model.columns.forEach((e) => check(false, e.item, "column"));
  model.rowHeads.forEach((e) => check(false, e.item, e.item && u16(e.item, 0) === ROW_DATABASE ? "dbrow" : "plainrow"));
  model.cells.forEach((line) => line.forEach((e) => check(true, e.item, "cell")));
  // kinds of cells
  model.cells.forEach((line, r) =>
    line.forEach((e) => {
      if (!e.item) return;
      const kind = e.item[FORMAT_SIZE];
      const dbHead = model.rowHeads[r]!.item && u16(model.rowHeads[r]!.item!, 0) === ROW_DATABASE;
      inc(`cells.kind_${kind}.${dbHead ? "dbheader" : "plain"}`);
      if (kind === KIND_FORMULA) {
        inc(`formula.flags_${e.flags.toString(16)}.${dbHead ? "dbheader" : "plain"}`);
        const cached = cachedOf(e.item);
        if (cached === null) inc("formula.result_kind_other");
        else inc(`formula.result_kind_${e.item[FORMAT_SIZE + 6]}.${dbHead ? "dbheader" : "plain"}`);
        const tok = e.item.slice(FORMAT_SIZE + 6 + RESULT_SIZE);
        inc(tok.length >= 2 && tok[tok.length - 2] === 0x90 && tok[tok.length - 1] === 6 ? "formula.tokens_end_0690" : "formula.tokens_other_end");
        if (!dbHead && e.item[FORMAT_SIZE + 6] === 5) inc(f64(e.item, FORMAT_SIZE + 8) === 0 ? "formula.text_result_f64_zero" : "formula.text_result_f64_nonzero");
      }
    }),
  );
  // tops and lefts
  const blockRows = readDatabaseRows(d, sh.blocks);
  const subs = new Map<number, number[]>();
  for (const row of blockRows) subs.set(row.row, row.subrows.map((s) => s.height));
  let rowFit = true;
  let top = 0;
  let zeroSub = 0;
  let subTops = 0;
  let subTopsBad = 0;
  for (let r = 0; r < g.rows; r++) {
    const head = model.rowHeads[r]!.item!;
    if (u16(head, 4) !== top) rowFit = false;
    top += u16(head, 2);
    const isDb = u16(head, 0) === ROW_DATABASE;
    if (isDb) {
      const row = blockRows.find((x) => x.row === r);
      if (row && row.subrows.length === 0) zeroSub++;
      if (row && row.subrows.length) {
        if (row.subrows[0]!.top !== u16(head, 4) + u16(head, 2)) subTopsBad++;
        for (let k = 1; k < row.subrows.length; k++) if (row.subrows[k]!.top !== row.subrows[k - 1]!.top + row.subrows[k - 1]!.height) subTopsBad++;
        subTops += row.subrows.length;
      }
      for (const h of subs.get(r) ?? []) top += h;
    }
  }
  inc(rowFit ? "tops.fit_all_rows" : "tops.DO_NOT_fit");
  inc("tops.db_rows_with_zero_subrows", zeroSub);
  inc("tops.subrow_top_checks", subTops);
  inc("tops.subrow_top_mismatch", subTopsBad);
  let leftFit = true;
  let left = 0;
  model.columns.forEach((e) => {
    if (!e.item) return;
    if (u16(e.item, 4) !== left) leftFit = false;
    left += u16(e.item, 2);
  });
  inc(leftFit ? "lefts.fit" : "lefts.DO_NOT_fit");
  // re-setting every formula cell and every database row to its own bytes gives the file's bytes
  let rebuilt = readSheet(d)!;
  let setCount = 0;
  let setBad = 0;
  rebuilt.cells.forEach((line, r) =>
    line.forEach((e, c) => {
      if (!e.item || e.item[FORMAT_SIZE] !== KIND_FORMULA) return;
      const cached = cachedOf(e.item);
      if (cached === null) return;
      const tokens = e.item.slice(FORMAT_SIZE + 6 + RESULT_SIZE, FORMAT_SIZE + 6 + RESULT_SIZE + u32(e.item, FORMAT_SIZE + 2));
      rebuilt = setFormulaCell(rebuilt, r, c, tokens, cached, { flags: e.flags });
      rebuilt = setCachedResult(rebuilt, r, c, cached);
      setCount++;
    }),
  );
  if (!same(laySheet(rebuilt), d)) setBad++;
  // retop from the heights (database rows' subrows included) gives the file's tops and lefts
  const subMap = new Map<number, number[]>();
  for (const row of blockRows) if (row.subrows.length) subMap.set(row.row, row.subrows.map((x) => x.height));
  expect(same(laySheet(retop(readSheet(d)!, subMap)), d), "retop from the file's heights does not give the file's bytes");
  // insert then delete a plain row or column at the start and at the end: the sheet is the file again
  const whole = readSheet(d)!;
  const rowAtStart = laySheet(deleteRows(insertRows(whole, 0, 1, 14), 0, 1));
  const rowAtEnd = laySheet(deleteRows(insertRows(whole, whole.rows, 1, 14), whole.rows, 1));
  expect(same(rowAtStart, d), "inserting and deleting a row at the top changes the sheet");
  expect(same(rowAtEnd, d), "inserting and deleting a row at the end changes the sheet");
  if (whole.cols) {
    const w0 = u16(whole.columns[0]!.item!, 2);
    expect(same(laySheet(deleteColumns(insertColumns(whole, 0, 1, w0), 0, 1)), d), "inserting and deleting a column at the left changes the sheet");
    expect(same(laySheet(deleteColumns(insertColumns(whole, whole.cols, 1, w0), whole.cols, 1)), d), "inserting and deleting a column at the right changes the sheet");
  }
  // cached results: each formula cell set to another result, then back: the file's bytes
  let cachedModel = readSheet(d)!;
  let cachedDiffers = 0;
  cachedModel.cells.forEach((line, r) =>
    line.forEach((e, c) => {
      if (!e.item || e.item[FORMAT_SIZE] !== KIND_FORMULA) return;
      const orig = cachedOf(e.item);
      if (orig === null) return;
      cachedModel = setCachedResult(cachedModel, r, c, 12345.5);
      if (!same(cachedModel.cells[r]![c]!.item!, e.item)) cachedDiffers++;
      cachedModel = setCachedResult(cachedModel, r, c, orig);
    }),
  );
  expect(same(laySheet(cachedModel), d), "a formula cell's result set and set back does not give the file's bytes");
  inc("cached.intermediate_differs", cachedDiffers);
  // plain cells: each text cell set to its own text is the same bytes
  let plainTextSame = 0;
  let plainTextDiff = 0;
  let plainModel = readSheet(d)!;
  model.cells.forEach((line, r) =>
    line.forEach((e, c) => {
      if (!e.item || e.item[FORMAT_SIZE] !== 0) return;
      const dbHead = u16(model.rowHeads[r]!.item!, 0) === ROW_DATABASE;
      if (dbHead) return;
      const before = laySheet(plainModel);
      const text = readWorksheetContents(new Rec(before, 1), new Map())?.cells.find((x) => x.row === r && x.col === c)?.display;
      if (typeof text !== "string") return;
      const next = plainValue(plainModel, r, c, text);
      if (same(laySheet(next), before)) plainTextSame++;
      else plainTextDiff++;
      plainModel = next;
    }),
  );
  inc("plain_text.reset_same", plainTextSame);
  inc("plain_text.reset_differs", plainTextDiff);
  // database rows: the definition read back sets the row to its own bytes
  let dbSet = 0;
  let dbBad = 0;
  let dbNoDef = 0;
  for (const row of blockRows) {
    const def = defOf(rebuilt, row);
    if (!def) {
      dbNoDef++;
      continue;
    }
    rebuilt = setDatabaseRow(rebuilt, row.row, def);
    dbSet++;
  }
  if (!same(laySheet(rebuilt), d)) dbBad++;
  inc("dbrows.redefined", dbSet);
  inc("dbrows.no_definition", dbNoDef);
  if (dbBad) failures.push("a worksheet's database rows, redefined, do not lay out as the file");
  if (setBad) failures.push("a worksheet's formula cells, reset to their own tokens and results, do not lay out as the file");
  // measurements: the subrow formats against the header's, by offset; int against whole values and the field type
  for (const row of blockRows) {
    row.columns.forEach((_, c) => {
      const hdr = model.cells[row.row]![c]!.item;
      const fmts = row.subrows.map((x) => x.cells[c]?.format).filter((f): f is Uint8Array => !!f);
      const distinct = new Set(fmts.map((f) => Array.from(f.subarray(0, FORMAT_SIZE).filter((_, k) => k !== 1)).join(","))).size;
      if (fmts.length) inc(`diag.subrow_formats_distinct_per_column_${Math.min(distinct, 3)}`);
      if (hdr && fmts.length) {
        for (let k = 0; k < FORMAT_SIZE; k++) if (k !== 1 && hdr[k] !== fmts[0]![k]) inc(`diag.fmt_offset_0x${k.toString(16).padStart(2, "0")}`);
      }
      const numeric = row.subrows.map((x) => x.cells[c]).filter((x) => x && typeof x.value === "number") as { value: string | number; int: boolean }[];
      if (!numeric.length) return;
      const whole = numeric.every((x) => Number.isInteger(x.value));
      const ints = numeric.some((x) => x.int);
      // a field's type in the header's tokens: 0x029e / 0x029f then u16 type
      const tok = hdr && hdr[FORMAT_SIZE] === KIND_FORMULA ? hdr.subarray(FORMAT_SIZE + 6 + RESULT_SIZE) : new Uint8Array(0);
      const types = new Set<number>();
      for (let t = 0; t + 4 <= tok.length; t += 2) {
        const tk = u16(tok, t);
        if (tk === 0x029e || tk === 0x029f) types.add(u16(tok, t + 2));
      }
      inc(`diag.num_col.${ints ? "int" : "real"}.${whole ? "whole" : "fraction"}.fieldtypes_${[...types].sort().join("_") || "none"}`);
    });
  }
  // measurements: empty entries with flags; int against the subrow format's number format and places
  for (const line of model.cells) for (const e of line) if (!e.item && e.flags) inc(`diag.empty_entry_flags_${e.flags.toString(16)}`);
  for (const e of model.columns) if (!e.item && e.flags) inc("diag.empty_column_flags");
  for (const row of blockRows) {
    row.subrows.forEach((x) => x.cells.forEach((cell) => {
      if (!cell || cell.raw || typeof cell.value !== "number") return;
      inc(`diag.int_vs_numfmt.${cell.int ? "int" : "real"}.fmt${cell.format[0x0a]}_acc${cell.format[0x0b]}`);
    }));
  }
  // the rebuilt block and the file agree for each database row
  for (const row of blockRows) {
    const blk = sh.blocks.get(row.block);
    if (!blk) continue;
    const formats: (Uint8Array | null)[] = [];
    for (let c = 0; c < row.columns.length; c++) {
      const e = model.cells[row.row]![c]!;
      formats.push(e.item ? e.item.slice(0, FORMAT_SIZE) : null);
    }
    // a block's column formats: the first subrow cell's in each column (one format per column in the files)
    const firstFormats: (Uint8Array | null)[] = formats.map((f, c) => {
      for (const s of row.subrows) {
        const cell = s.cells[c];
        if (cell) return cell.format;
      }
      return f;
    });
    const intColumns = row.columns.map((_, c) => row.subrows.some((s) => s.cells[c] && !s.cells[c]!.raw && s.cells[c]!.int === true));
    const subrowsNext = row.subrows.map((s, i) => ({
      values: s.cells.map((cell) => (cell === null ? null : cell.raw ? "" : cell.value)) as BlockNext["subrows"][number]["values"],
      refs: row.objects.filter((o) => o.subrow === i).map((o) => o.ref),
    }));
    const keyNext: BlockNext = { block: row.block, cols: row.columns.length, subrowHeight: 0, firstTop: row.subrows[0]?.top ?? 0, formats, subrows: subrowsNext, order: row.order };
    const built = buildBlock(row, keyNext);
    const body = blk.data.subarray(RECORD_HEADER);
    const exact = same(built.body, body) && (!blk.order || same(built.order, blk.order.subarray(RECORD_HEADER))) && (!blk.objects || same(built.objects, blk.objects.subarray(RECORD_HEADER)));
    inc(exact ? "block.key_exact" : "block.key_DIFFERS");
    expect(exact, "a database block rebuilt from its own values does not match the file");
    // with no prev: the values, heights, w and formats given; differences are counted by category
    const nullNext: BlockNext = {
      ...keyNext,
      formats: firstFormats,
      intColumns,
      subrows: row.subrows.map((s, i) => ({ ...subrowsNext[i]!, height: s.height, w: s.w })),
    };
    const fresh = buildBlock(null, nullNext);
    if (same(fresh.body, body)) inc("block.null_exact");
    // field by field, subrow by subrow (a byte-level diff cascades after the first shifted item)
    const got = readBlock(recordOf(fresh.body));
    const wantHead = blk.data.subarray(RECORD_HEADER, BLOCK_TABLE);
    const gotHead = fresh.body.subarray(0, BLOCK_TABLE - RECORD_HEADER);
    for (let i = 0; i < wantHead.length; i++) if (wantHead[i] !== gotHead[i]) inc(`block.null_diff.head.${i === 0x3c || i === 0x3e ? "counts" : "+0x" + (i + 0x50).toString(16)}`);
    if (!got || got.subrows.length !== row.subrows.length) {
      inc("block.null_unreadable");
    } else {
      row.subrows.forEach((want, i) => {
        const have = got.subrows[i]!;
        if (have.height !== want.height) inc("block.null_diff.subrow.height");
        if (have.top !== want.top) inc("block.null_diff.subrow.top");
        if (have.w !== want.w) inc("block.null_diff.subrow.w");
        if (have.group !== want.group) inc("block.null_diff.subrow.group");
        want.cells.forEach((wc, c) => {
          const hc = have.cells[c] ?? null;
          if (wc === null || hc === null) {
            if (wc !== hc) inc("block.null_diff.cell.presence");
            return;
          }
          if (wc.raw) {
            inc("block.null_diff.cell.raw_kind4_not_reproduced");
            return;
          }
          if (wc.int !== hc.int) inc("block.null_diff.cell.int_or_real");
          if (wc.value !== hc.value && !(typeof wc.value === "number" && typeof hc.value === "number" && Number.isNaN(wc.value))) inc("block.null_diff.cell.value");
          if (wc.spare !== hc.spare) inc("block.null_diff.cell.spare_uninitialised");
          if (typeof wc.value === "string" && !same(wc.tail, hc.tail)) inc("block.null_diff.cell.tail_uninitialised");
          if (wc.format[1] !== hc.format[1]) inc("block.null_diff.cell.format_byte1_uninitialised");
          if (!same(Uint8Array.from(wc.format).subarray(0, 1), hc.format.subarray(0, 1))) inc("block.null_diff.cell.format_byte0");
          if (!wc.format.every((x, k) => k === 0 || k === 1 || x === hc.format[k])) inc("block.null_diff.cell.format_other_bytes");
        });
      });
    }
    if (blk.order && !same(fresh.order, blk.order.subarray(RECORD_HEADER))) inc("block.null_order_differs");
    if (blk.objects && !same(fresh.objects, blk.objects.subarray(RECORD_HEADER))) inc("block.null_objects_differ");
    // cell-level facts
    row.columns.forEach((_, c) => {
      let ints = 0;
      let reals = 0;
      for (const s of row.subrows) {
        const cell = s.cells[c];
        if (!cell || cell.raw) continue;
        if (typeof cell.value === "number") {
          if (cell.int) ints++;
          else reals++;
        }
      }
      inc(ints && reals ? "block.column_mixed_int_real" : ints ? "block.column_all_int" : reals ? "block.column_all_real" : "block.column_no_numbers");
    });
    row.subrows.forEach((s) => {
      inc(s.w & 0xff ? (s.w & 0xff) === 1 ? "subrow.w_low_1" : "subrow.w_low_other" : "subrow.w_low_0");
      inc(s.group === 0xffffffff ? "subrow.group_ff" : "subrow.group_0");
      inc(`subrow.w_high_${s.w >> 8}`);
      inc(`subrow.w_low_${s.w & 0xff}_group_${s.group === 0xffffffff ? "ff" : "0"}`);
      s.cells.forEach((cell, c) => {
        if (cell === null) {
          inc("cell.null");
          return;
        }
        if (cell.raw) inc("cell.raw");
        else if (typeof cell.value === "string") inc(cell.value === "" ? "cell.empty_text" : "cell.text");
        else inc(cell.int ? "cell.int" : "cell.real");
        const plainFmts: Uint8Array[] = [];
        for (let rr = 0; rr < model.rows; rr++) {
          const ph = model.rowHeads[rr]!.item;
          if (!ph || u16(ph, 0) === ROW_DATABASE) continue;
          const pe = model.cells[rr]![c]!.item;
          if (pe) plainFmts.push(pe.slice(0, FORMAT_SIZE));
        }
        if (cell && !cell.raw) {
          const match = plainFmts.some((pf) => pf.every((b, k) => k === 1 || b === cell.format[k]));
          inc(match ? "fmt.subrow_matches_a_plain_cell_of_column_except_byte1" : "fmt.subrow_matches_no_plain_cell_of_column");
        }
        const hf = row.columns.length && model.cells[row.row]![c]?.item ? model.cells[row.row]![c]!.item!.slice(0, FORMAT_SIZE) : null;
        if (hf && cell && !cell.raw) {
          const same1 = hf.every((b, k) => k === 1 || b === cell.format[k]);
          inc(same1 ? (same(hf, cell.format) ? "fmt.same_as_header_incl_byte1" : "fmt.same_as_header_except_byte1") : "fmt.differs_from_header");
        }
      });
    });
  }
  // block heads: which bytes are the same in every block (after the lengths)
  for (const b of sh.blockRecs) {
    const head = b.data.subarray(RECORD_HEADER, BLOCK_TABLE);
    inc(head.length === 72 ? "blockhead.len72" : "blockhead.other_len");
    blockHeads.push(head.slice());
  }
  if (identical) inc("layout.identical_sheets");
  if (!identical && inOrder) failures.push("a worksheet in entry order does not lay out as the file");
}

const blockHeads: Uint8Array[] = [];

function reportBlockHeads(): void {
  if (!blockHeads.length) return;
  const len = 72;
  const varying: number[] = [];
  const constNonzero: number[] = [];
  for (let i = 0; i < len; i++) {
    const v = blockHeads[0]![i];
    if (blockHeads.every((h) => h[i] === v)) {
      if (v) constNonzero.push(i);
    } else varying.push(i);
  }
  console.log(`block heads (${blockHeads.length}): ${varying.length} byte offsets vary (from +0x50: ${varying.map((i) => "0x" + (i + 0x50).toString(16)).join(" ")})`);
  console.log(`  constant nonzero bytes: ${constNonzero.length} (offsets from +0x50: ${constNonzero.map((i) => "0x" + (i + 0x50).toString(16)).join(" ")})`);
  const signs = new Map<string, number>();
  for (const h of blockHeads) {
    const key = [0x18, 0x20, 0x28, 0x30].map((o) => (f64(h, o) > 0 ? "+" : f64(h, o) < 0 ? "-" : "0") + (Math.abs(f64(h, o)) === Number.MAX_VALUE ? "M" : "x")).join("");
    signs.set(key, (signs.get(key) ?? 0) + 1);
  }
  console.log(`  empty-bounds f64 signs (count of blocks): ${[...signs].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  for (const o of [0x54, 0x56, 0x58]) {
    const vals = new Map<number, number>();
    for (const h of blockHeads) vals.set(h[o - 0x50]!, (vals.get(h[o - 0x50]!) ?? 0) + 1);
    console.log(`  +0x${o.toString(16)} values (count): ${[...vals].map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}

function checkFile(file: string): void {
  const t0 = Date.now();
  const sheets = sheetsOf(file);
  for (const sh of sheets) checkSheet(sh);
  console.log(`== ${basename(file)}: ${sheets.length} worksheets (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

// --- run ---------------------------------------------------------------------------------------

syntheticChecks();
const args = process.argv.slice(2);
const files = args.length ? args.map((a) => resolve(a)) : defaultFiles();
if (!files.length) console.log("no sample files found: only the synthetic checks ran");
for (const f of files) checkFile(f);
reportBlockHeads();
const keys = [...counts.keys()].sort();
for (const k of keys) console.log(`  ${k}: ${get(k)}`);
for (const f of failures) console.log(`FAILED: ${f}`);
console.log(failures.length ? "SOME EXACT EXPECTATIONS FAILED" : "ALL EXACT EXPECTATIONS HOLD");
process.exit(failures.length ? 1 : 0);
