// Checks worksheetDb.ts: reads every database row of every worksheet, rebuilds each part from the
// model and compares it with the file's bytes; prints the measurements behind the facts at the
// top of worksheetDb.ts as counts only (no cell text is printed).
//
//   npx tsx src/core/worksheetDb.check.ts [files...]
//
// With no arguments it reads ../samples/sample.vwx (if present) and every .vwx under
// ../samples/demos/*/ (found by listing the directories). Exit 1 if any rebuild differs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openVwx } from "./index.ts";
import { gridAt, rowAt, DATABASE_BLOCK, DATABASE_ORDER, DATABASE_OBJECTS, ROW_DATABASE, BLOCK_COUNTS, BLOCK_TABLE, SHEET_COUNTS, SHEET_TABLE } from "./worksheet.ts";
import { u16, u32 } from "./bytes.ts";
import {
  blockBody,
  blockRecord,
  databaseRowHeader,
  objectsBody,
  orderBody,
  readBlock,
  readDatabaseRows,
  readObjects,
  readOrder,
  RECORD_HEADER,
  subrowHeader,
  type DatabaseBlockRecords,
  type DatabaseCell,
  type DatabaseRow,
} from "./worksheetDb.ts";

const counts = new Map<string, number>();
const inc = (k: string, n = 1): void => {
  counts.set(k, (counts.get(k) ?? 0) + n);
};

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** natural (numeric-aware), case-insensitive order of two cell values; blanks are not compared */
function naturalCompare(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function cellKey(c: DatabaseCell | null): string | number | null {
  if (!c || c.raw) return null;
  return c.value;
}

/** measurements of one row (model + the worksheet's own result cells, carried in columns) */
function measureRow(row: DatabaseRow, objects: { subrow: number; ref: number }[], nameIndex: Map<number, number>, refCount: Map<number, number>): void {
  const n = row.subrows.length;
  inc(`rows.rowflags.${row.rowFlags}`);
  const perSub = new Array(n).fill(0);
  objects.forEach((o, i) => {
    if (o.subrow >= 0 && o.subrow < n) perSub[o.subrow]++;
    if (o.ref === 0) inc("objects.ref_zero");
    else inc(refCount.get(o.ref) === 1 ? "objects.ref_one_record" : "objects.ref_other_count");
    if (i > 0 && objects[i - 1].subrow > o.subrow) inc("objects.subrow_not_ascending_rows");
    // object records' order within a subrow
    if (i > 0 && objects[i - 1].subrow === o.subrow) {
      const a = nameIndex.get(objects[i - 1].ref);
      const b = nameIndex.get(o.ref);
      if (a !== undefined && b !== undefined) inc(a <= b ? "objects.record_order_ok_pairs" : "objects.record_order_broken_pairs");
    }
  });
  row.subrows.forEach((s, k) => {
    const multi = perSub[k] > 1;
    inc(`subrows.group_${s.group === 0xffffffff ? "ff" : s.group}.objects_${multi ? "multi" : perSub[k] === 1 ? "one" : "none"}`);
    if (s.head.length !== 12) inc("subrows.head_not_12");
    if (s.cells.some((c) => c && c.raw)) inc("subrows.with_raw_cells");
    for (const c of s.cells) if (c && c.raw) inc("cells.raw_kind4_or_unknown");
    for (const c of s.cells) if (c && typeof c.value === "string") inc(c.tail[0] === 0 && c.tail[1] === 0 ? "cells.text_tail_zero" : "cells.text_tail_nonzero");
  });
  // sorted columns: the order must be ascending by precedence-1 column (natural, case-insensitive)
  const sortCols = row.columns.map((c, i) => ({ c, i })).filter((x) => x.c.sort === "ascending").sort((a, b) => a.c.precedence - b.c.precedence);
  if (sortCols.length) {
    inc("sort.rows");
    inc(`sort.precedences.${sortCols.map((x) => x.c.precedence).join("-")}`);
    const col = sortCols[0].i;
    let ok = true;
    let plainOk = true;
    let ties = false;
    for (let k = 0; k + 1 < row.order.length; k++) {
      const a = cellKey(row.subrows[row.order[k]].cells[col]);
      const b = cellKey(row.subrows[row.order[k + 1]].cells[col]);
      if (a === null || b === null || a === "" || b === "") continue;
      const cmp = naturalCompare(a, b);
      if (cmp > 0) ok = false;
      if (cmp === 0) ties = true;
      const pa = String(a).toLowerCase();
      const pb = String(b).toLowerCase();
      if (typeof a === "string" && typeof b === "string" && pa > pb) plainOk = false;
    }
    inc(ok ? "sort.natural_ok" : "sort.natural_broken");
    inc(plainOk ? "sort.plain_ci_ok" : "sort.plain_ci_broken");
    if (ties) inc("sort.rows_with_ties");
    const identity = row.order.every((v, i) => v === i);
    inc(identity ? "sort.order_identity" : "sort.order_permuted");
  }
  // summarize: subrows unique by the summarized columns
  const sumCols = row.columns.map((c, i) => ({ c, i })).filter((x) => x.c.summarize).map((x) => x.i);
  if (sumCols.length) {
    const keys = new Set(row.subrows.map((s) => JSON.stringify(sumCols.map((c) => cellKey(s.cells[c])))));
    inc(keys.size === n ? "summarize.rows_unique" : "summarize.rows_duplicate");
    inc(`summarize.rows_with_multi_objects.${perSub.some((x) => x > 1) ? 1 : 0}`);
  } else inc(`no_summarize.rows_with_multi_objects.${perSub.some((x) => x > 1) ? 1 : 0}`);
  // header results: numeric results against the sums; text results against the non-empty subrows
  row.columns.forEach((col, c) => {
    if (!col.result) return;
    const vals = row.subrows.map((s) => cellKey(s.cells[c]));
    const nums = vals.filter((v): v is number => typeof v === "number");
    const nonEmpty = vals.filter((v) => v !== null && v !== "").length;
    if (col.result.kind === 5) {
      inc(`result.text.count_nonempty_${col.result.value === nonEmpty ? "match" : "differs"}`);
    } else {
      const sum = nums.reduce((a, b) => a + b, 0);
      inc(`result.number.sum_${Math.abs(col.result.value - sum) < 1e-6 ? "match" : "differs"}`);
    }
    if (col.sum) inc("result.sum_flag_columns");
  });
}

function checkFile(file: string): boolean {
  const t0 = Date.now();
  const s: any = openVwx(new Uint8Array(readFileSync(file)), basename(file));
  const recs: any[] = s.doc.recs;
  const refCount = new Map<number, number>();
  const nameIndex = new Map<number, number>();
  for (const r of recs) {
    refCount.set(r.nameIndex, (refCount.get(r.nameIndex) ?? 0) + 1);
    if (!nameIndex.has(r.nameIndex)) nameIndex.set(r.nameIndex, r.index);
  }
  const referenced = new Set<unknown>();
  let ok = true;
  let worksheets = 0;
  let rowsTotal = 0;
  let blocksTotal = 0;
  for (const rec of recs) {
    if (rec.type !== 18) continue;
    worksheets++;
    const sheet: Uint8Array = rec.data;
    const g = gridAt(sheet, SHEET_COUNTS, SHEET_TABLE);
    if (!g) {
      inc("sheets.unreadable");
      continue;
    }
    const blockRecs = rec.children.filter((c: any) => c.type === DATABASE_BLOCK);
    blocksTotal += blockRecs.length;
    const blocks = new Map<number, DatabaseBlockRecords>();
    for (const b of blockRecs) {
      const child = (type: number): Uint8Array | null => b.children.find((k: any) => k.type === type)?.data ?? null;
      blocks.set(b.nameIndex, { data: b.data, order: child(DATABASE_ORDER), objects: child(DATABASE_OBJECTS) });
    }
    const rows = readDatabaseRows(sheet, blocks);
    // every database row of the sheet, with its block
    for (let r = 0; r < g.rows; r++) {
      const head = rowAt(g, r);
      if (head === null || u16(sheet, head) !== ROW_DATABASE) continue;
      inc("rows.in_sheet");
      const blk = blockRecs.find((b: any) => b.nameIndex === u32(sheet, head + 8));
      if (blk) referenced.add(blk);
      else inc("rows.without_block");
    }
    rowsTotal += rows.length;
    for (const row of rows) {
      const head = rowAt(g, row.row)!;
      const headLen = 18 + row.criteria.length;
      const blk = blockRecs.find((b: any) => b.nameIndex === row.block)!;
      const sheetHead = sheet.subarray(head, head + headLen);
      const rebuiltHead = databaseRowHeader(row);
      if (same(sheetHead, rebuiltHead)) inc("rebuild.row_header_exact");
      else {
        inc("rebuild.row_header_DIFFERS");
        ok = false;
      }
      const body = blk.data.subarray(RECORD_HEADER);
      const bodyRebuilt = blockBody(row);
      if (same(body, bodyRebuilt)) inc("rebuild.block_body_exact");
      else {
        inc("rebuild.block_body_DIFFERS");
        ok = false;
      }
      if (same(blockRecord(row, blk.data), blk.data)) inc("rebuild.block_record_exact");
      else {
        inc("rebuild.block_record_DIFFERS");
        ok = false;
      }
      const ord = blk.children.find((c: any) => c.type === DATABASE_ORDER);
      if (ord) {
        if (same(ord.data.subarray(RECORD_HEADER), orderBody(row.order))) inc("rebuild.order_exact");
        else {
          inc("rebuild.order_DIFFERS");
          ok = false;
        }
        inc(ord.data.length === RECORD_HEADER + 4 + 2 * row.subrows.length ? "children.order_length_is_0x54_plus_2n" : "children.order_length_other");
      } else inc("rebuild.order_absent");
      const obj = blk.children.find((c: any) => c.type === DATABASE_OBJECTS);
      if (obj) {
        if (same(obj.data.subarray(RECORD_HEADER), objectsBody(row.objects))) inc("rebuild.objects_exact");
        else {
          inc("rebuild.objects_DIFFERS");
          ok = false;
        }
        inc(obj.data.length === RECORD_HEADER + 2 + 8 * row.objects.length ? "children.objects_length_is_0x52_plus_8n" : "children.objects_length_other");
      } else inc("rebuild.objects_absent");
      // the block's column table entries are empty (offset 0)
      const bg = gridAt(blk.data, BLOCK_COUNTS, BLOCK_TABLE);
      if (bg) for (let c = 0; c < bg.cols; c++) if (u32(blk.data, bg.table + 8 * c + 4) !== 0) inc("block.column_entry_not_empty");
      measureRow(row, row.objects, nameIndex, refCount);
      // the reader's view of the block agrees with a fresh read of the same bytes
      const again = readBlock(blk.data);
      if (!again || again.subrows.length !== row.subrows.length) inc("block.reread_mismatch");
      inc(row.rowFlags === 6 ? "rows.flags_6" : row.rowFlags === 0 ? "rows.flags_0" : "rows.flags_other");
    }
  }
  // blocks that no row of the sheet points at
  // blocks that no row of the sheet points at: their bodies rebuild from a model made of the block itself
  for (const r of recs) if (r.type === 18) {
    for (const b of r.children.filter((c: any) => c.type === DATABASE_BLOCK)) {
      if (referenced.has(b)) continue;
      inc("blocks.unpointed");
      const pb = readBlock(b.data);
      if (!pb) {
        inc("blocks.unpointed_unreadable");
        continue;
      }
      const pseudo: DatabaseRow = {
        row: -1, height: 0, top: 0, w: 0, block: b.nameIndex, criteria: new Uint8Array(0), rowFlags: 0,
        columns: pb.columnFlags.map((flags) => ({ flags, summarize: false, sort: "none", precedence: 0, sum: false, result: null })),
        subrows: pb.subrows, order: pb.subrows.map((_, i) => i), objects: [], blockHead: pb.blockHead, blockColumnFlags: pb.columnFlags,
      };
      if (same(b.data.subarray(RECORD_HEADER), blockBody(pseudo))) inc("rebuild.unpointed_block_body_exact");
      else {
        inc("rebuild.unpointed_block_body_DIFFERS");
        ok = false;
      }
    }
  }
  inc("counts.worksheets", worksheets);
  inc("counts.database_rows", rowsTotal);
  inc("counts.blocks", blocksTotal);
  const get = (k: string) => counts.get(k) ?? 0;
  console.log(`== ${basename(file)}: ${worksheets} worksheets, ${rowsTotal} database rows, ${blocksTotal} blocks (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  for (const k of [
    "rebuild.row_header_exact", "rebuild.block_body_exact", "rebuild.block_record_exact", "rebuild.order_exact", "rebuild.objects_exact",
    "rebuild.row_header_DIFFERS", "rebuild.block_body_DIFFERS", "rebuild.block_record_DIFFERS", "rebuild.order_DIFFERS", "rebuild.objects_DIFFERS",
    "rebuild.order_absent", "rebuild.objects_absent", "rebuild.unpointed_block_body_exact", "rebuild.unpointed_block_body_DIFFERS", "rows.without_block", "block.reread_mismatch", "block.column_entry_not_empty",
  ]) if (get(k)) console.log(`   ${k}: ${get(k)}`);
  console.log(`   measured: ${[...counts.keys()].filter((k) => !k.startsWith("rebuild.") && !k.startsWith("counts.")).sort().map((k) => `${k}=${get(k)}`).join(", ")}`);
  for (const k of counts.keys()) counts.delete(k);
  return ok;
}

/** a made-up database row, built, then read back and rebuilt */
function syntheticCheck(): boolean {
  const cell = (value: string | number, extra: Partial<DatabaseCell> = {}): DatabaseCell => ({
    format: Uint8Array.from({ length: 0x6a }, (_, i) => (i === 0 ? 6 : i === 1 ? 0x5a : i === 2 ? 2 : 0)),
    value,
    int: false,
    spare: 0x3c,
    flags: 0,
    tail: new Uint8Array(typeof value === "string" ? [0x11, 0x22] : []),
    raw: null,
    ...extra,
  });
  const row: DatabaseRow = {
    row: 0,
    height: 18,
    top: 40,
    w: 1,
    block: 77,
    criteria: Uint8Array.from([0x9a, 0x02, 0x90, 0x06, 0x91, 0x06]),
    rowFlags: 6,
    columns: [
      { flags: 0x10014, summarize: false, sort: "ascending", precedence: 1, sum: false, result: { kind: 5, value: 3 } },
      { flags: 0x44, summarize: false, sort: "none", precedence: 0, sum: true, result: { kind: 0, value: 12.5 } },
      { flags: 0, summarize: false, sort: "none", precedence: 0, sum: false, result: null },
    ],
    subrows: [
      { head: new Uint8Array(12), height: 13, top: 58, w: 0x0801, group: 0xffffffff, flags: 0, cells: [cell("b"), cell(7.5), null] },
      { head: new Uint8Array(12), height: 18, top: 71, w: 1, group: 0, flags: 0, cells: [cell("A", { tail: new Uint8Array([0, 0]) }), cell(5, { int: true, spare: 9 }), cell("", { tail: new Uint8Array([0xaa, 0]) })] },
      { head: new Uint8Array(12), height: 18, top: 89, w: 0, group: 0, flags: 0, cells: [cell("c10"), cell(-2), cell("", { raw: null })] },
    ],
    order: [1, 0, 2],
    objects: [
      { subrow: 0, ref: 5, tag: 7 },
      { subrow: 0, ref: 6, tag: 7 },
      { subrow: 1, ref: 9, tag: 7 },
      { subrow: 2, ref: 12, tag: 7 },
    ],
    blockHead: new Uint8Array(72),
    blockColumnFlags: [0, 0, 0],
  };
  row.subrows.forEach((s) => {
    s.head = subrowHeader(s);
  });
  const template = new Uint8Array(RECORD_HEADER + 4);
  const blockBytes = blockRecord(row, template);
  const ordBytes = orderBody(row.order);
  const objBytes = objectsBody(row.objects);
  const parsed = readBlock(blockBytes);
  const back = parsed && parsed.subrows.length === row.subrows.length;
  let good = !!back;
  if (back) {
    const again = { ...row, subrows: parsed!.subrows };
    if (!same(blockBody(again as DatabaseRow), blockBody(row))) good = false;
    const order = readOrder(Uint8Array.from([...template.subarray(0, RECORD_HEADER), ...ordBytes]), row.subrows.length);
    const objects = readObjects(Uint8Array.from([...template.subarray(0, RECORD_HEADER), ...objBytes]));
    if (JSON.stringify(order) !== JSON.stringify(row.order)) good = false;
    if (JSON.stringify(objects.map((o) => [o.subrow, o.ref, o.tag])) !== JSON.stringify(row.objects.map((o) => [o.subrow, o.ref, o.tag]))) good = false;
    row.subrows.forEach((s, i) => {
      const t = parsed!.subrows[i];
      if (s.height !== t.height || s.top !== t.top || s.w !== t.w || s.group !== t.group) good = false;
      s.cells.forEach((c, k) => {
        const d = t.cells[k];
        if (c === null || d === null) {
          if (c !== d) good = false;
          return;
        }
        const tailOk = typeof c.value !== "string" || same(c.tail, d.tail);
        if (c.value !== d.value || c.spare !== d.spare || !tailOk || !same(c.format, d.format)) good = false;
      });
    });
  }
  console.log(`== synthetic row: ${good ? "round trip ok" : "ROUND TRIP FAILED"} (block ${blockBytes.length} bytes, ${row.subrows.length} subrows, ${row.objects.length} objects)`);
  return good;
}

function defaultFiles(): string[] {
  const samples = resolve(process.cwd(), "../samples");
  const out: string[] = [];
  const single = join(samples, "sample.vwx");
  if (existsSync(single)) out.push(single);
  const demos = join(samples, "demos");
  if (existsSync(demos)) {
    for (const dir of readdirSync(demos)) {
      const sub = join(demos, dir);
      if (!statSync(sub).isDirectory()) continue;
      for (const f of readdirSync(sub)) if (f.toLowerCase().endsWith(".vwx")) out.push(join(sub, f));
    }
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length ? args.map((a) => resolve(a)) : defaultFiles();
let ok = syntheticCheck();
for (const f of files) {
  if (!checkFile(f)) ok = false;
}
console.log(ok ? "ALL REBUILDS EXACT" : "SOME REBUILDS DIFFER");
process.exit(ok ? 0 : 1);
