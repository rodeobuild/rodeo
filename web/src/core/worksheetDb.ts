// Database rows of worksheets: the header row of each (type 4 row in the worksheet record), its
// block (a type-60 child of the worksheet: the subrows), and the block's type-61 (order) and
// type-124 (objects) children. Read and rebuilt byte for byte.
//
// Facts below were measured on the Dover Dam demo files (2023, 2024, 2025, 2026: 47 worksheets,
// 53 database rows, 83 blocks, 1139 subrows, 18944 object entries). Where the 2023 and 2024
// copies of a worksheet are compared cell by cell, that is said. Counts are over the four files.
//
// A. Subrow header: 12 bytes (not longer), then the first cell's format. Fields:
//      +0  u16 3 (all 1139)
//      +2  u16 height (points; seen 11 to 20, not the database row's height)
//      +4  u16 top: equal to the previous subrow's top plus its height in all 1086 consecutive
//          pairs; the first subrow's top is stored, not derived
//      +6  u16 w: low byte 0 or 1, high byte any value; equal in the 2023 and 2024 copies, so it is
//          data, not uninitialised memory (kept as read)
//      +8  u32 group: 0xffffffff in 308 subrows, each holding several objects; 0 in 831 subrows,
//          each holding one object
//    The 12 bytes are equal in the 2023 and 2024 copies of the same worksheet.
//    Uninitialised bytes (they differ between the 2023 and 2024 copies whose cells are otherwise
//    equal; the builder keeps them from the model, and writes 0 for a new cell):
//      - byte 1 of every cell format (0x6a bytes; byte 0 is 6 in every cell of all four files)
//      - the spare byte after a cell's kind (cell +0x6b)
//      - the 2 bytes after a text cell's UTF-16 text (the text is u32 chars then UTF-16; empty text
//        still has 2 such bytes; zero in most text cells, not all)
//    Cell layout: 0x6a format, u8 kind (5 text, 0 f64, 7 i32), u8 spare, then u32 chars + UTF-16 +
//    2 bytes (text), or f64 / i32 at +0x6c. Six cells of another kind (4) occur, all in the 2026
//    file; their layout is not decoded and they are kept as raw bytes up to the next item.
//
// B. Database row header (worksheet row, 18 bytes then the criteria): u16 4, u16 height, u16 top,
//    u16 w, u32 block name index, u16 subrow count, u32 criteria length, criteria. Equal in the
//    2023 and 2024 copies (the subrow count differs only where the copies' rows differ).
//
// C. Row entry flags (the row's table entry, not in the row header): 6 or 0. Database rows: 37
//    with 6, 16 with 0. Plain rows: 153 with 0, 2 with 6. Not explained by: the block's +0x56 (0 or
//    1 under both values), a sort, Summarize or Sum column (both values occur with each), an
//    object count (every row has objects), the subrow or column count. The only regularity found:
//    every 0-flag row has w's low byte 1 (16 of 16); 6-flag rows have it 0 in 25 and 1 in 12.
//    Unknown; kept as read.
//
// D. Block header +0x50..+0x97 (72 bytes, kept whole as blockHead). Constant in the 83 blocks but
//    +0x8c u16 columns and +0x8e u16 rows (set from the model) and, in some files, bytes +0x54,
//    +0x56 (0 or 1) and +0x58, which take two values. Their meaning is not settled. Four f64 at
//    +0x68..+0x87 are ±DBL_MAX in every block (empty bounds). Block table: column entries (the
//    first `cols`) have offset 0; every subrow and cell entry has flags 0. Items are laid out in
//    entry order: a subrow header, then its cells in column order.
//
// E. Children. Lengths include the 0x50-byte record header:
//    type 61 (order): length 0x54 + 2n in 53 of 53. The rest of the 114 bytes of a 15-subrow list
//      is the record header. Body: u32 n + 1, then n u16 1-based subrow numbers in display order.
//      The order is the identity in 17 rows and a permutation in 36.
//    type 124 (objects): length 0x52 + 8n in 53 of 53. Body: u16 n, then n entries of u16 tag
//      (7 in all 18944), u16 subrow (1-based; ascending along the list in 53 of 53 rows), u32 ref.
//      Each ref is the +0x1a name index of one object record in 18938 entries; in 6 entries it is 0
//      (no name, so no record to match). Within a subrow the objects are in the order of their
//      records in the file in 48 of 53 blocks (not the order of the refs; in 20 blocks the refs are
//      not ascending).
//    Multi-object subrows occur only in rows that have a Summarize column: 28 rows with both,
//    4 rows with a Summarize column and single objects only, and none in the 21 rows without one.
//
// F. Column flags (the header row's cell entry flags; 0 for a column with no cell):
//    0x4: set on 312 of the 324 formula header cells and 59 of the 63 text header cells. Not a
//      formula bit. Meaning not settled.
//    0x8 Summarize; 0x10 sorted ascending; 0x40 Sum; high word = sort precedence (1 in all 36
//      sorted rows). No descending bit occurs: bit 0x20 is never set. No precedence-2 entry exists
//      in these files, so the second sort key is untested.
//    Summarize: the subrows are unique by the Summarize columns' values in all 32 such rows.
//    Sort: in all 36 sorted rows the order is ascending by the sort column under a natural
//      (numeric-aware), case-insensitive comparison. Under a plain code-unit or a plain
//      case-insensitive comparison, 10 adjacent pairs are out of order. Ties in the sort column
//      occur in 11 rows. Blank sort values occur in 2 rows; where they sit is not settled.
//
// G. Header cells' cached results (kind at +0x70, the number at +0x72):
//    Numeric result (kind 0 or 7): equal to the sum of the column's subrow numbers for every
//      numeric field column (20 of 20 and 17 of 17, for two field forms), every COUNT (15 of 15; the
//      object count equals it in 13 of 15), every AREA (6 of 6), VOLUME (4 of 4), and a
//      0x1ef column (2 of 2; that token is not named). So a numeric header is its column's total.
//    Text result (kind 5, number at +2): equal to the number of subrows with a non-empty value in
//      18 of 22 (8 of 8 for one field form, 10 of 14 for the other). The other 4 are not explained.
//    Numeric result on a text column: non-empty subrows in 77 of 104 field cells (74%), the sum in
//      27. No rule settled.
//
// H. Unpointed blocks: 30 of the 83 blocks are the block of no database row. They are in the 4
//    sheets with no database row and in sheets with more blocks than rows. Each holds subrows and
//    objects. 8 of the 30 hold only objects that another block of the same sheet also holds, 5
//    hold some of them, 17 hold none. What they are is not settled. Nothing draws them.
//
// Rebuild: databaseRowHeader, blockBody (or blockRecord, with a template record header), orderBody,
// objectsBody, subrowHeader and cellBytes rebuild each part from the model. worksheetDb.check.ts
// shows them exact on every database row and every block of the demo files.

import { BLOCK_COUNTS, BLOCK_TABLE, cellAt, FORMAT_SIZE, gridAt, ROW_DATABASE, rowAt, SHEET_COUNTS, SHEET_TABLE } from "./worksheet.ts";
import { f64, i32, setF64, setI32, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";

/** bytes before a record's body (length u64, type, name index, class ...) */
export const RECORD_HEADER = 0x50;
/** a database row's header bytes before its criteria */
const ROW_HEAD = 18;
/** a subrow's header bytes before its first cell */
const SUBROW_HEAD = 12;
const SUBROW_KIND = 3;
const SORTED = 0x10;
const SUMMARIZE = 0x8;
const SUM = 0x40;
/** the block's cell kinds */
const CELL_REAL = 0;
const CELL_TEXT = 5;
const CELL_INT = 7;

export type SortOrder = "none" | "ascending" | "descending";

export interface DatabaseColumn {
  /** the header cell's table entry flags (0 when the column has no cell) */
  flags: number;
  summarize: boolean;
  sort: SortOrder;
  /** sort precedence: the flags' high word (1 or 2 in the samples), 0 when not sorted */
  precedence: number;
  sum: boolean;
  /** the header cell's cached result: its kind and the number at +2 (f64 or i32), or null */
  result: { kind: number; value: number } | null;
}

export interface DatabaseCell {
  /** the 0x6a format bytes; byte 1 is uninitialised (kept from the model) */
  format: Uint8Array;
  /** the cell's value: text (kind 5), or a number (kind 0 f64, or kind 7 i32 when `int`) */
  value: string | number;
  int: boolean;
  /** the byte after the kind (uninitialised; kept from the model) */
  spare: number;
  /** the cell's table entry flags */
  flags: number;
  /** text cells: the 2 bytes after the UTF-16 text (uninitialised; kept from the model) */
  tail: Uint8Array;
  /** cells of an undecoded layout (kind 4): their bytes, written back as they are */
  raw: Uint8Array | null;
}

export interface DatabaseSubrow {
  /** the 12 header bytes as read */
  head: Uint8Array;
  /** points */
  height: number;
  top: number;
  w: number;
  /** u32 at +8: 0xffffffff for a subrow holding several objects, 0 for one object */
  group: number;
  /** the subrow's table entry flags */
  flags: number;
  /** one per column, null where the cell is empty */
  cells: (DatabaseCell | null)[];
}

export interface DatabaseObject {
  /** 0-based subrow */
  subrow: number;
  /** the object record's +0x1a name index (0 for an unnamed object) */
  ref: number;
  /** always 7 in the samples */
  tag: number;
}

export interface DatabaseRow {
  /** 0-based worksheet row */
  row: number;
  height: number;
  top: number;
  /** the header's 4th u16 */
  w: number;
  /** name index of the block (a type-60 child of the worksheet) */
  block: number;
  /** the criteria: the formula's token bytes (DATABASE(...)) */
  criteria: Uint8Array;
  /** the row's table entry flags (6 or 0 in the samples) */
  rowFlags: number;
  columns: DatabaseColumn[];
  subrows: DatabaseSubrow[];
  /** 0-based subrow indices in display order */
  order: number[];
  objects: DatabaseObject[];
  /** the block's bytes +0x50..+0x97 as read (its cols and rows are set from the model) */
  blockHead: Uint8Array;
  /** the block's column table entries' flags (0 in the samples) */
  blockColumnFlags: number[];
}

/** a database block's records, whole: the type-60 block and its type-61 and type-124 children */
export interface DatabaseBlockRecords {
  data: Uint8Array;
  order: Uint8Array | null;
  objects: Uint8Array | null;
}

function columnOf(flags: number, result: DatabaseColumn["result"]): DatabaseColumn {
  return {
    flags,
    summarize: (flags & SUMMARIZE) !== 0,
    sort: (flags & SORTED) !== 0 ? "ascending" : "none",
    precedence: (flags & SORTED) !== 0 ? flags >>> 16 : 0,
    sum: (flags & SUM) !== 0,
    result,
  };
}

/** UTF-16 code units as they are (no BOM handling, lone surrogates kept). */
function utf16(d: Uint8Array, at: number, units: number): string {
  let s = "";
  for (let i = 0; i < units; i += 1024) {
    const n = Math.min(1024, units - i);
    const codes: number[] = [];
    for (let k = 0; k < n; k++) codes.push(u16(d, at + 2 * (i + k)));
    s += String.fromCharCode(...codes);
  }
  return s;
}

/** the item's end: the next item's start, or the record's end */
function nextItem(d: Uint8Array, table: number, cols: number, rows: number, p: number): number {
  const n = cols + rows * (cols + 1) + 1;
  let end = d.length;
  for (let i = 0; i < n; i++) {
    const off = u32(d, table + 8 * i + 4);
    if (off) {
      const at = table - 8 + off;
      if (at > p && at < end) end = at;
    }
  }
  return end;
}

/** A block cell at p (its entry flags given), or null when the bytes don't decode. */
function readCell(d: Uint8Array, p: number, flags: number, end: () => number): DatabaseCell {
  const format = d.slice(p, p + FORMAT_SIZE);
  const kind = d[p + FORMAT_SIZE];
  const spare = d[p + FORMAT_SIZE + 1];
  const at = p + FORMAT_SIZE + 2;
  const none = new Uint8Array(0);
  if (kind === CELL_TEXT) {
    const units = u32(d, at);
    const tailAt = at + 4 + 2 * units;
    return { format, value: utf16(d, at + 4, units), int: false, spare, flags, tail: d.slice(tailAt, tailAt + 2), raw: null };
  }
  if (kind === CELL_REAL) return { format, value: f64(d, at), int: false, spare, flags, tail: none, raw: null };
  if (kind === CELL_INT) return { format, value: i32(d, at), int: true, spare, flags, tail: none, raw: null };
  return { format, value: "", int: false, spare, flags, tail: none, raw: d.slice(p, end()) };
}

/** A block's subrows and column entries, as read; null when the block can't be read. */
export function readBlock(data: Uint8Array): { blockHead: Uint8Array; columnFlags: number[]; subrows: DatabaseSubrow[] } | null {
  const g = gridAt(data, BLOCK_COUNTS, BLOCK_TABLE);
  if (!g) return null;
  const blockHead = data.slice(RECORD_HEADER, BLOCK_TABLE);
  const columnFlags = Array.from({ length: g.cols }, (_, c) => u32(data, g.table + 8 * c));
  const subrows: DatabaseSubrow[] = [];
  for (let s = 0; s < g.rows; s++) {
    const sh = rowAt(g, s);
    if (sh === null || u16(data, sh) !== SUBROW_KIND) return null;
    const e = g.cols + s * (g.cols + 1);
    const cells: (DatabaseCell | null)[] = [];
    for (let c = 0; c < g.cols; c++) {
      const p = cellAt(g, s, c);
      if (p === null) {
        cells.push(null);
        continue;
      }
      const flags = u32(data, g.table + 8 * (e + 1 + c));
      cells.push(readCell(data, p, flags, () => nextItem(data, g.table, g.cols, g.rows, p)));
    }
    subrows.push({
      head: data.slice(sh, sh + SUBROW_HEAD),
      height: u16(data, sh + 2),
      top: u16(data, sh + 4),
      w: u16(data, sh + 6),
      group: u32(data, sh + 8),
      flags: u32(data, g.table + 8 * e),
      cells,
    });
  }
  return { blockHead, columnFlags, subrows };
}

/** Subrow numbers (0-based) in display order from a type-61 record. */
export function readOrder(list: Uint8Array, rows: number): number[] {
  const n = u32(list, RECORD_HEADER) - 1;
  if (n !== rows) return Array.from({ length: rows }, (_, i) => i);
  return Array.from({ length: n }, (_, i) => u16(list, RECORD_HEADER + 4 + 2 * i) - 1);
}

/** The objects of a type-124 record, in the order stored. */
export function readObjects(list: Uint8Array): DatabaseObject[] {
  const n = u16(list, RECORD_HEADER);
  return Array.from({ length: n }, (_, i) => {
    const q = RECORD_HEADER + 2 + 8 * i;
    return { tag: u16(list, q), subrow: u16(list, q + 2) - 1, ref: u32(list, q + 4) };
  });
}

/**
 * The database rows of a worksheet record, each with its block (from `blocks`, keyed by the
 * block's name index). A row whose block is missing is left out.
 */
export function readDatabaseRows(sheet: Uint8Array, blocks: ReadonlyMap<number, DatabaseBlockRecords>): DatabaseRow[] {
  const g = gridAt(sheet, SHEET_COUNTS, SHEET_TABLE);
  if (!g) return [];
  const out: DatabaseRow[] = [];
  for (let r = 0; r < g.rows; r++) {
    const head = rowAt(g, r);
    if (head === null || u16(sheet, head) !== ROW_DATABASE) continue;
    const block = blocks.get(u32(sheet, head + 8));
    if (!block) continue;
    const parsed = readBlock(block.data);
    if (!parsed) continue;
    const e = g.cols + r * (g.cols + 1);
    const columns = Array.from({ length: g.cols }, (_, c) => {
      const p = cellAt(g, r, c);
      if (p === null) return columnOf(0, null);
      const rk = sheet[p + FORMAT_SIZE + 6];
      const value = rk === CELL_INT ? i32(sheet, p + FORMAT_SIZE + 8) : f64(sheet, p + FORMAT_SIZE + 8);
      return columnOf(u32(sheet, g.table + 8 * (e + 1 + c)), rk === CELL_REAL || rk === CELL_TEXT || rk === CELL_INT ? { kind: rk, value } : null);
    });
    const criteriaLength = u32(sheet, head + 14);
    out.push({
      row: r,
      height: u16(sheet, head + 2),
      top: u16(sheet, head + 4),
      w: u16(sheet, head + 6),
      block: u32(sheet, head + 8),
      criteria: sheet.slice(head + ROW_HEAD, head + ROW_HEAD + criteriaLength),
      rowFlags: u32(sheet, g.table + 8 * e),
      columns,
      subrows: parsed.subrows,
      order: block.order ? readOrder(block.order, parsed.subrows.length) : parsed.subrows.map((_, i) => i),
      objects: block.objects ? readObjects(block.objects) : [],
      blockHead: parsed.blockHead,
      blockColumnFlags: parsed.columnFlags,
    });
  }
  return out;
}

/** The worksheet row's header bytes: 18 bytes, then the criteria. */
export function databaseRowHeader(row: DatabaseRow): Uint8Array {
  const out = new Uint8Array(ROW_HEAD + row.criteria.length);
  setU16(out, 0, ROW_DATABASE);
  setU16(out, 2, row.height);
  setU16(out, 4, row.top);
  setU16(out, 6, row.w);
  setU32(out, 8, row.block);
  setU16(out, 12, row.subrows.length);
  setU32(out, 14, row.criteria.length);
  out.set(row.criteria, ROW_HEAD);
  return out;
}

/** A subrow's 12 header bytes. */
export function subrowHeader(s: Pick<DatabaseSubrow, "height" | "top" | "w" | "group">): Uint8Array {
  const out = new Uint8Array(SUBROW_HEAD);
  setU16(out, 0, SUBROW_KIND);
  setU16(out, 2, s.height);
  setU16(out, 4, s.top);
  setU16(out, 6, s.w);
  setU32(out, 8, s.group);
  return out;
}

/** A cell's bytes: format, kind, spare, and its value (text: u32 chars, UTF-16, 2 tail bytes). */
export function cellBytes(c: DatabaseCell): Uint8Array {
  if (c.raw) return c.raw.slice();
  if (typeof c.value === "string") {
    const units = c.value.length;
    const out = new Uint8Array(FORMAT_SIZE + 6 + 2 * units + 2);
    out.set(c.format, 0);
    out[FORMAT_SIZE] = CELL_TEXT;
    out[FORMAT_SIZE + 1] = c.spare;
    setU32(out, FORMAT_SIZE + 2, units);
    for (let i = 0; i < units; i++) setU16(out, FORMAT_SIZE + 6 + 2 * i, c.value.charCodeAt(i));
    const tailAt = FORMAT_SIZE + 6 + 2 * units;
    out[tailAt] = c.tail[0] ?? 0;
    out[tailAt + 1] = c.tail[1] ?? 0;
    return out;
  }
  const out = new Uint8Array(FORMAT_SIZE + 2 + 8);
  out.set(c.format, 0);
  out[FORMAT_SIZE] = c.int ? CELL_INT : CELL_REAL;
  out[FORMAT_SIZE + 1] = c.spare;
  if (c.int) setI32(out, FORMAT_SIZE + 2, c.value);
  else setF64(out, FORMAT_SIZE + 2, c.value);
  return c.int ? out.slice(0, FORMAT_SIZE + 6) : out;
}

/**
 * The block record's bytes from +0x50 on: its header (72 bytes, cols and rows from the model),
 * the entry table, then the items in entry order (per row: subrow header, then its cells).
 * Offsets in the table are from the table's start minus 8, as the worksheet's are.
 */
export function blockBody(row: DatabaseRow): Uint8Array {
  const cols = row.columns.length;
  const rows = row.subrows.length;
  const n = cols + rows * (cols + 1) + 1;
  const tableAt = BLOCK_TABLE;
  const entries = new Uint8Array(8 * n);
  const items: Uint8Array[] = [];
  let at = tableAt + 8 * n;
  const place = (entry: number, flags: number, bytes: Uint8Array | null): void => {
    setU32(entries, 8 * entry, flags);
    if (bytes) {
      setU32(entries, 8 * entry + 4, at - (tableAt - 8));
      items.push(bytes);
      at += bytes.length;
    }
  };
  for (let c = 0; c < cols; c++) place(c, row.blockColumnFlags[c] ?? 0, null);
  row.subrows.forEach((s, r) => {
    const e = cols + r * (cols + 1);
    place(e, s.flags, subrowHeader(s));
    for (let c = 0; c < cols; c++) {
      const cell = s.cells[c];
      place(e + 1 + c, cell ? cell.flags : 0, cell ? cellBytes(cell) : null);
    }
  });
  place(n - 1, 0, null);
  setU32(entries, 8 * (n - 1) + 4, at - (tableAt - 8));
  // the record bytes up to the table, then the table and items, as one buffer from +0x50
  const out = new Uint8Array(at - RECORD_HEADER);
  const head = row.blockHead.slice();
  setU16(head, BLOCK_COUNTS - RECORD_HEADER, cols);
  setU16(head, BLOCK_COUNTS + 2 - RECORD_HEADER, rows);
  out.set(head, 0);
  out.set(entries, tableAt - RECORD_HEADER);
  let pos = tableAt + 8 * n - RECORD_HEADER;
  for (const it of items) {
    out.set(it, pos);
    pos += it.length;
  }
  return out;
}

/** A whole type-60 record: the template's 0x50-byte header (length rewritten) and the body. */
export function blockRecord(row: DatabaseRow, template: Uint8Array): Uint8Array {
  const body = blockBody(row);
  const out = new Uint8Array(RECORD_HEADER + body.length);
  out.set(template.subarray(0, RECORD_HEADER), 0);
  out.set(body, RECORD_HEADER);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** A type-61 record's body from +0x50: u32 n + 1, then n u16 1-based subrow numbers. */
export function orderBody(order: readonly number[]): Uint8Array {
  const out = new Uint8Array(4 + 2 * order.length);
  setU32(out, 0, order.length + 1);
  order.forEach((s, i) => setU16(out, 4 + 2 * i, s + 1));
  return out;
}

/** A type-124 record's body from +0x50: u16 n, then n entries of u16 tag, u16 subrow (1-based), u32 ref. */
export function objectsBody(objects: readonly DatabaseObject[]): Uint8Array {
  const out = new Uint8Array(2 + 8 * objects.length);
  setU16(out, 0, objects.length);
  objects.forEach((o, i) => {
    setU16(out, 2 + 8 * i, o.tag);
    setU16(out, 4 + 8 * i, o.subrow + 1);
    setU32(out, 6 + 8 * i, o.ref);
  });
  return out;
}
