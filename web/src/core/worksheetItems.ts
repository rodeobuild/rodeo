// Worksheet records as their table entries, each with its item's bytes, so that a worksheet can be
// rewritten as a model: formula cells set, database rows made and unmade, rows and columns inserted
// and deleted, cached results refreshed. Every operation returns a new SheetItems (none mutates its
// input); laySheet writes the record again with its items in entry order.
//
// Layout (worksheet.ts): the record's head (0 to SHEET_TABLE, with the counts at +0xc0), the table of
// 8-byte entries (u32 flags, u32 offset from table - 8; the end entry's offset is the record's length),
// then the items: a column (6 bytes), per row its header (8 bytes for a plain row, 18 + criteria for
// a database row) and then one item per cell (0 offset: empty). An item runs to the next item.
//
// A formula cell (worksheet.ts's layout): 0x6a bytes of format, u8 kind 1, u8 spare, u32 token length,
// 34 bytes of cached result (u8 kind at +0: 0 f64 at +2, 7 i32 at +2, 5 text with its f64 at +2),
// then the tokens (opaque here; they end 0x90 0x06).

import { concat, setF64, setI32, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import type { Value } from "./formula/ast.ts";
import { FORMAT_SIZE, gridAt, KIND_FORMULA, KIND_NUMBER, KIND_TEXT, RESULT_INT, RESULT_REAL, RESULT_SIZE, RESULT_TEXT, ROW_DATABASE, ROW_PLAIN, SHEET_COUNTS, SHEET_TABLE } from "./worksheet.ts";
import { blockBody, orderBody, objectsBody, type DatabaseCell, type DatabaseColumn, type DatabaseRow, type DatabaseSubrow } from "./worksheetDb.ts";

export interface Entry {
  readonly flags: number;
  /** the item's bytes, up to the next item in the file; null for an empty entry (offset 0) */
  readonly item: Uint8Array | null;
}

export interface SheetItems {
  /** bytes 0 to SHEET_TABLE, with the counts at +0xc0 (set again by laySheet) */
  head: Uint8Array;
  cols: number;
  rows: number;
  columns: Entry[];
  rowHeads: Entry[];
  /** [row][column] */
  cells: Entry[][];
}

/** A cached result: a Value, or (for a database header cell whose result is text) its number at +2 */
export type Cached = Value | { readonly textResult: number };

export interface FormulaLike {
  numberFormat?: number;
  accuracy?: number;
  /** entry flags; a database header cell's column flags. Kept from the cell when left out. */
  flags?: number;
}

export interface ColumnDef {
  tokens: Uint8Array;
  flags: number;
  /** the header cell's cached number (its column total, or the count of non-empty subrows) */
  cached: number;
  /** true: a text result (kind 5, the number at +2); false: a number (kind 0, or 7 when the cell held one) */
  textKind: boolean;
}

export interface DatabaseDef {
  /** name index of the block (a type-60 child of the worksheet) */
  block: number;
  criteria: Uint8Array;
  subrows: number;
  /** one per column; null leaves the column's header cell empty */
  columns: readonly (ColumnDef | null)[];
  /** the row's table entry flags; a new database row gets 6 (most rows), a database row keeps its own */
  rowFlags?: number;
}

export interface BlockSubrowValues {
  /** one per column: null for no cell, a string (text cell), a number (f64 cell, or 7 i32 when the old cell was one) */
  values: readonly Value[];
  /** the objects' name indices, in order */
  refs: readonly number[];
  /** points; the old subrow's height at this index when left out, else subrowHeight */
  height?: number;
  /** the subrow's w; the old subrow's when left out, else the first old subrow's, else 0 */
  w?: number;
}

export interface BlockNext {
  block: number;
  /** columns (the worksheet's) */
  cols: number;
  /** points, for a subrow with no old height at its index */
  subrowHeight: number;
  /** the first subrow's top, stored (the others follow from the heights) */
  firstTop: number;
  /** per column: the 0x6a format of its subrow cells, used for a new cell (null: the old cell's). Not the header cell's: they differ. */
  formats: readonly (Uint8Array | null)[];
  /**
   * per column: whether its numbers are stored as i32 (kind 7) when whole. Every column of the files is all
   * int or all real. Left out: the old block's column decides (an int column when prev has an int cell in it).
   */
  intColumns?: readonly boolean[];
  subrows: readonly BlockSubrowValues[];
  /** subrow indices (0-based) in display order */
  order: readonly number[];
}

export interface BlockBuild {
  /** the block record from +0x50 (header, table, items) */
  body: Uint8Array;
  /** the type-61 record from +0x50 */
  order: Uint8Array;
  /** the type-124 record from +0x50 */
  objects: Uint8Array;
}

const COLUMN = 1;
/** entry flags of a formula cell on a plain row when it is new (every plain formula cell in the files) */
export const PLAIN_FORMULA_FLAGS = 4;
/** entry flags of a new database row (most database rows in the files) */
export const DATABASE_ROW_FLAGS = 6;
/** the tag of every object entry in the files */
export const OBJECT_TAG = 7;
/** a subrow's group word when it holds several objects */
const GROUP_MANY = 0xffffffff;
/** the cell's merged byte, then the merged range's top, bottom, left and right (1-based) */
const MERGED = 0x11;
const MERGE_TOP = 0x12;
const MERGE_LEFT = 0x16;
const MERGE_END = 0x1a;
/** the empty bounds of a block: four f64 at +0x68..+0x87 (offsets from +0x50 are 0x18..0x37) */
const BOUNDS_AT = [0x18, 0x20, 0x28, 0x30];
/** signs of the four empty-bounds f64 (measured in the files: the same in all blocks) */
const BOUNDS_SIGNS = [-1, 1, 1, -1];
const BLOCK_HEAD = 72;
const SHEET_BASE = SHEET_TABLE - 8;
const EMPTY: Entry = { flags: 0, item: null };

function entryCount(cols: number, rows: number): number {
  return cols + rows * (cols + 1) + 1;
}

function rowEntry(cols: number, r: number): number {
  return cols + r * (cols + 1);
}

/** Read a worksheet record's entries; null when the record can't be read or its items overlap. */
export function readSheet(d: Uint8Array): SheetItems | null {
  const g = gridAt(d, SHEET_COUNTS, SHEET_TABLE);
  if (!g) return null;
  const { cols, rows } = g;
  const n = entryCount(cols, rows);
  const starts: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const off = u32(d, SHEET_TABLE + 8 * i + 4);
    if (off) starts.push(SHEET_BASE + off);
  }
  starts.sort((a, b) => a - b);
  for (let k = 0; k < starts.length; k++) {
    if (starts[k]! < SHEET_TABLE + 8 * n || starts[k]! >= d.length) return null;
    if (k && starts[k] === starts[k - 1]) return null;
  }
  const endOf = new Map<number, number>();
  starts.forEach((at, k) => endOf.set(at, starts[k + 1] ?? d.length));
  const entry = (i: number): Entry => {
    const flags = u32(d, SHEET_TABLE + 8 * i);
    const off = u32(d, SHEET_TABLE + 8 * i + 4);
    if (!off) return { flags, item: null };
    const at = SHEET_BASE + off;
    return { flags, item: d.slice(at, endOf.get(at)!) };
  };
  const columns: Entry[] = [];
  for (let c = 0; c < cols; c++) columns.push(entry(c));
  const rowHeads: Entry[] = [];
  const cells: Entry[][] = [];
  for (let r = 0; r < rows; r++) {
    const e = rowEntry(cols, r);
    rowHeads.push(entry(e));
    const line: Entry[] = [];
    for (let c = 0; c < cols; c++) line.push(entry(e + 1 + c));
    cells.push(line);
  }
  return { head: d.slice(0, SHEET_TABLE), cols, rows, columns, rowHeads, cells };
}

/** The record's bytes: head, table, then the items in entry order, the end entry last. */
export function laySheet(s: SheetItems): Uint8Array {
  if (s.head.length !== SHEET_TABLE) throw new Error("the head must be the record's first SHEET_TABLE bytes");
  if (s.columns.length !== s.cols || s.rowHeads.length !== s.rows || s.cells.length !== s.rows) throw new Error("the model's counts disagree with its entries");
  if (s.cells.some((line) => line.length !== s.cols)) throw new Error("every row has one cell entry per column");
  const parts: Entry[] = [...s.columns];
  s.cells.forEach((line, r) => parts.push(s.rowHeads[r]!, ...line));
  const n = entryCount(s.cols, s.rows);
  const table = new Uint8Array(8 * n);
  const items: Uint8Array[] = [];
  let at = SHEET_TABLE + table.length;
  parts.forEach((e, i) => {
    setU32(table, 8 * i, e.flags);
    if (e.item) {
      setU32(table, 8 * i + 4, at - SHEET_BASE);
      items.push(e.item);
      at += e.item.length;
    }
  });
  setU32(table, 8 * (n - 1) + 4, at - SHEET_BASE);
  const head = s.head.slice();
  setU16(head, SHEET_COUNTS, s.cols);
  setU16(head, SHEET_COUNTS + 2, s.rows);
  const out = concat([head, table, ...items]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

function withCell(s: SheetItems, row: number, col: number, e: Entry): SheetItems {
  const cells = s.cells.slice();
  cells[row] = cells[row]!.slice();
  cells[row][col] = e;
  return { ...s, cells };
}

function withRowHead(s: SheetItems, row: number, e: Entry): SheetItems {
  const rowHeads = s.rowHeads.slice();
  rowHeads[row] = e;
  return { ...s, rowHeads };
}

function checkRow(s: SheetItems, row: number): void {
  if (!(Number.isInteger(row) && row >= 0 && row < s.rows)) throw new Error("no such row");
}

function checkCell(s: SheetItems, row: number, col: number): void {
  checkRow(s, row);
  if (!(Number.isInteger(col) && col >= 0 && col < s.cols)) throw new Error("no such column");
}

function isDatabaseHead(e: Entry): boolean {
  return !!e.item && u16(e.item, 0) === ROW_DATABASE;
}

/** The row's top is the sum of the heights above it, database rows' subrows included. */
function shiftTop(item: Uint8Array, delta: number): Uint8Array {
  const out = item.slice();
  const top = u16(out, 4) + delta;
  if (top < 0 || top > 0xffff) throw new Error("the rows are more than 65535 points tall");
  setU16(out, 4, top);
  return out;
}

/** A row's top from the heights above it: a plain row's height, a database row's plus its subrows' (subrowHeights, by row). */
export function retop(s: SheetItems, subrowHeights: ReadonlyMap<number, readonly number[]> = new Map()): SheetItems {
  let top = 0;
  const rowHeads = s.rowHeads.map((e, r) => {
    if (!e.item) return e;
    const item = e.item.slice();
    if (top > 0xffff) throw new Error("the rows are more than 65535 points tall");
    setU16(item, 4, top);
    top += u16(item, 2);
    if (isDatabaseHead(e)) for (const h of subrowHeights.get(r) ?? []) top += h;
    return { flags: e.flags, item };
  });
  return relayoutColumns({ ...s, rowHeads: rowHeads });
}

/** Column lefts: the widths before each column. */
function relayoutColumns(s: SheetItems): SheetItems {
  let left = 0;
  const columns = s.columns.map((e) => {
    if (!e.item) return e;
    const item = e.item.slice();
    if (left > 0xffff) throw new Error("the columns are more than 65535 points wide");
    setU16(item, 4, left);
    left += u16(item, 2);
    return { flags: e.flags, item };
  });
  return { ...s, columns };
}

/** The 0x6a format of the nearest cell in the column (plain rows first, then any), unmerged, with its flags. */
function formatSource(s: SheetItems, row: number, col: number): { format: Uint8Array; flags: number } {
  const take = (e: Entry): { format: Uint8Array; flags: number } => {
    const format = e.item!.slice(0, FORMAT_SIZE);
    format.fill(0, MERGED, MERGE_END);
    return { format, flags: e.flags };
  };
  for (let k = 1; k < s.rows; k++) {
    for (const r of [row - k, row + k]) {
      if (r < 0 || r >= s.rows || isDatabaseHead(s.rowHeads[r]!)) continue;
      const e = s.cells[r]![col]!;
      if (e.item) return take(e);
    }
  }
  for (const line of s.cells) for (const e of line) if (e.item) return take(e);
  throw new Error("this worksheet has no cell to copy a format from");
}

/** The cached result's 34 bytes: kind, then the value at +2. `old` keeps the bytes a refresh doesn't change. */
function resultBytes(cached: Cached, old: Uint8Array): Uint8Array {
  const out = old.slice(0, RESULT_SIZE);
  if (typeof cached === "number") {
    if (!Number.isFinite(cached)) throw new Error("number out of range");
    if (out[0] === RESULT_INT && Number.isInteger(cached) && Math.abs(cached) <= 0x7fffffff) {
      out[0] = RESULT_INT;
      setI32(out, 2, cached);
    } else {
      out[0] = RESULT_REAL;
      setF64(out, 2, cached);
    }
    return out;
  }
  if (typeof cached === "boolean") return resultBytes(cached ? 1 : 0, old);
  if (typeof cached === "object" && cached !== null && "textResult" in cached) {
    out[0] = RESULT_TEXT;
    setF64(out, 2, cached.textResult);
    return out;
  }
  // text, empty, or an error: the text is not stored in a formula cell, so only kind 5 and 0 at +2
  out[0] = RESULT_TEXT;
  setF64(out, 2, 0);
  return out;
}

/**
 * Makes a cell a formula cell. Its format is kept if the cell exists, else copied from the nearest
 * cell of its column (unmerged). A formula cell on a plain row is entry flags 4 when new; a database
 * header cell's flags are passed in `like.flags`. An existing formula cell keeps its spare byte and
 * the result bytes the new result doesn't set.
 */
export function setFormulaCell(s: SheetItems, row: number, col: number, tokens: Uint8Array, cached: Cached, like: FormulaLike = {}): SheetItems {
  checkCell(s, row, col);
  if (tokens.length < 2 || tokens[tokens.length - 2] !== 0x90 || tokens[tokens.length - 1] !== 0x06) throw new Error("formula tokens end 0x90 0x06");
  const cur = s.cells[row]![col]!;
  const inDb = isDatabaseHead(s.rowHeads[row]!);
  let format: Uint8Array;
  let flags: number;
  let spare = 0;
  let old = new Uint8Array(RESULT_SIZE);
  if (cur.item) {
    format = cur.item.slice(0, FORMAT_SIZE);
    flags = cur.flags;
    if (cur.item[FORMAT_SIZE] === KIND_FORMULA) {
      spare = cur.item[FORMAT_SIZE + 1]!;
      old = cur.item.slice(FORMAT_SIZE + 6, FORMAT_SIZE + 6 + RESULT_SIZE);
    }
  } else {
    const src = formatSource(s, row, col);
    format = src.format;
    flags = inDb ? 0 : PLAIN_FORMULA_FLAGS;
  }
  if (like.flags !== undefined) flags = like.flags;
  if (like.numberFormat !== undefined) format[0x0a] = like.numberFormat;
  if (like.accuracy !== undefined) format[0x0b] = like.accuracy;
  const value = new Uint8Array(6 + RESULT_SIZE + tokens.length);
  value[0] = KIND_FORMULA;
  value[1] = spare;
  setU32(value, 2, tokens.length);
  value.set(resultBytes(cached, old), 6);
  value.set(tokens, 6 + RESULT_SIZE);
  return withCell(s, row, col, { flags, item: concat([format, value]) });
}

/** Only the cached result of an existing formula cell changes. */
export function setCachedResult(s: SheetItems, row: number, col: number, cached: Cached): SheetItems {
  checkCell(s, row, col);
  const cur = s.cells[row]![col]!;
  if (!cur.item || cur.item[FORMAT_SIZE] !== KIND_FORMULA) throw new Error("not a formula cell");
  const item = cur.item.slice();
  const at = FORMAT_SIZE + 6;
  item.set(resultBytes(cached, item.slice(at, at + RESULT_SIZE)), at);
  return withCell(s, row, col, { flags: cur.flags, item });
}

/**
 * Makes worksheet row `row` a database row: a plain row with no cells (or a database row already),
 * its height, top and w kept, its header 18 bytes and criteria, and each column's header cell.
 * Columns given null lose their cell. The block itself is the caller's (buildBlock).
 */
export function setDatabaseRow(s: SheetItems, row: number, def: DatabaseDef): SheetItems {
  checkRow(s, row);
  if (def.columns.length !== s.cols) throw new Error("one column definition per column");
  const head = s.rowHeads[row]!;
  if (!head.item) throw new Error("this row has no header");
  const kind = u16(head.item, 0);
  const wasDb = kind === ROW_DATABASE;
  if (kind !== ROW_PLAIN && !wasDb) throw new Error("only a plain row or a database row can hold a database");
  if (!wasDb && s.cells[row]!.some((e) => e.item)) throw new Error("the row has cells: a database row must be a plain row with no cells");
  const hb = new Uint8Array(18 + def.criteria.length);
  setU16(hb, 0, ROW_DATABASE);
  setU16(hb, 2, u16(head.item, 2));
  setU16(hb, 4, u16(head.item, 4));
  setU16(hb, 6, u16(head.item, 6));
  setU32(hb, 8, def.block);
  setU16(hb, 12, def.subrows);
  setU32(hb, 14, def.criteria.length);
  hb.set(def.criteria, 18);
  let next = withRowHead(s, row, { flags: def.rowFlags ?? (wasDb ? head.flags : DATABASE_ROW_FLAGS), item: hb });
  def.columns.forEach((col, c) => {
    if (col) {
      next = setFormulaCell(next, row, c, col.tokens, col.textKind ? { textResult: col.cached } : col.cached, { flags: col.flags });
    } else {
      // the cell goes; its entry keeps its flags (an empty entry can carry some: 4 in the files)
      next = withCell(next, row, c, { flags: next.cells[row]![c]!.flags, item: null });
    }
  });
  return next;
}

/** The name indices of the blocks of the database rows in [at, at + count): the caller removes them. */
export function deletedBlocks(s: SheetItems, at: number, count: number): number[] {
  const out: number[] = [];
  for (let r = at; r < Math.min(s.rows, at + count); r++) {
    const e = s.rowHeads[r]!;
    if (isDatabaseHead(e)) out.push(u32(e.item!, 8));
  }
  return out;
}

/** The width of a new plain row: the first plain row's w (1 when there is none). */
function plainW(s: SheetItems): number {
  const plain = s.rowHeads.find((e) => e.item && u16(e.item, 0) === ROW_PLAIN);
  return plain ? u16(plain.item!, 6) : 1;
}

/** Merged ranges: `map` gives each end's new row or column (1-based); a range that vanishes is unmerged. */
function remapMerges(cells: readonly (readonly Entry[])[], at: number, map: (x: number, last: boolean) => number): Entry[][] {
  return cells.map((line) =>
    line.map((e) => {
      if (!e.item || e.item[MERGED] === 0) return e;
      const item = e.item.slice();
      const first = map(u16(item, at), false);
      const last = map(u16(item, at + 2), true);
      if (first < 1 || last < first) item.fill(0, MERGED, MERGE_END);
      else {
        setU16(item, at, first);
        setU16(item, at + 2, last);
      }
      return { flags: e.flags, item };
    }),
  );
}

function insertMap(at: number, count: number): (x: number) => number {
  return (x) => (x > at ? x + count : x);
}

function deleteMap(at: number, count: number): (x: number, last: boolean) => number {
  return (x, last) => (x <= at ? x : x > at + count ? x - count : last ? at : at + 1);
}

/** Plain empty rows before row `at` (0 to rows); the rows after move down by their heights. */
export function insertRows(s: SheetItems, at: number, count: number, height: number): SheetItems {
  if (!(Number.isInteger(at) && at >= 0 && at <= s.rows) || !(count >= 1) || !(height >= 1 && height <= 0xffff)) throw new Error("no such place for rows");
  const w = plainW(s);
  let base = 0;
  if (at < s.rows && s.rowHeads[at]!.item) base = u16(s.rowHeads[at]!.item!, 4);
  else if (s.rows) {
    const last = s.rowHeads[s.rows - 1]!;
    if (last.item) base = u16(last.item, 4) + u16(last.item, 2);
  }
  const news: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const item = new Uint8Array(8);
    setU16(item, 0, ROW_PLAIN);
    setU16(item, 2, height);
    setU16(item, 4, base + i * height);
    setU16(item, 6, w);
    news.push({ flags: 0, item });
  }
  const shifted = s.rowHeads.map((e, r) => (r >= at && e.item ? { flags: e.flags, item: shiftTop(e.item, count * height) } : e));
  const rowHeads = [...shifted.slice(0, at), ...news, ...shifted.slice(at)];
  const blank = Array.from({ length: s.cols }, () => EMPTY);
  const cells = [...s.cells.slice(0, at), ...Array.from({ length: count }, () => blank.slice()), ...s.cells.slice(at)];
  const rowMap = insertMap(at, count);
  return { ...s, rows: s.rows + count, rowHeads, cells: remapMerges(cells, MERGE_TOP, (x) => rowMap(x)) };
}

/**
 * Rows [at, at + count) go. Rows after them move up by the removed heights: a database row's
 * subrows count too, from subrowHeights (by row, before the change). Returns the database blocks
 * dropped (deletedBlocks) as well: the caller removes them.
 */
export function deleteRows(s: SheetItems, at: number, count: number, subrowHeights: ReadonlyMap<number, readonly number[]> = new Map()): SheetItems {
  if (!(Number.isInteger(at) && at >= 0 && count >= 1 && at + count <= s.rows)) throw new Error("no such rows");
  let removed = 0;
  for (let r = at; r < at + count; r++) {
    const e = s.rowHeads[r]!;
    removed += e.item ? u16(e.item, 2) : 0;
    if (isDatabaseHead(e)) for (const h of subrowHeights.get(r) ?? []) removed += h;
  }
  const rowHeads = s.rowHeads
    .filter((_, r) => r < at || r >= at + count)
    .map((e, i) => (i >= at && e.item ? { flags: e.flags, item: shiftTop(e.item, -removed) } : e));
  const cells = s.cells.filter((_, r) => r < at || r >= at + count);
  const map = deleteMap(at, count);
  return { ...s, rows: s.rows - count, rowHeads, cells: remapMerges(cells, MERGE_TOP, (x, last) => map(x, last)) };
}

/** Plain empty columns before column `at`, each `width` points. */
export function insertColumns(s: SheetItems, at: number, count: number, width: number): SheetItems {
  if (!(Number.isInteger(at) && at >= 0 && at <= s.cols) || !(count >= 1) || !(width >= 1 && width <= 0xffff)) throw new Error("no such place for columns");
  const news: Entry[] = Array.from({ length: count }, () => {
    const item = new Uint8Array(6);
    setU16(item, 0, COLUMN);
    setU16(item, 2, width);
    return { flags: 0, item };
  });
  const columns = [...s.columns.slice(0, at), ...news, ...s.columns.slice(at)];
  const cells = s.cells.map((line) => [...line.slice(0, at), ...Array.from({ length: count }, () => EMPTY), ...line.slice(at)]);
  const colMap = insertMap(at, count);
  const out = { ...s, cols: s.cols + count, columns, cells: remapMerges(cells, MERGE_LEFT, (x) => colMap(x)) };
  return relayoutColumns(out);
}

/** Columns [at, at + count) go. */
export function deleteColumns(s: SheetItems, at: number, count: number): SheetItems {
  if (!(Number.isInteger(at) && at >= 0 && count >= 1 && at + count <= s.cols)) throw new Error("no such columns");
  const columns = s.columns.filter((_, c) => c < at || c >= at + count);
  const cells = s.cells.map((line) => line.filter((_, c) => c < at || c >= at + count));
  const map = deleteMap(at, count);
  return relayoutColumns({ ...s, cols: s.cols - count, columns, cells: remapMerges(cells, MERGE_LEFT, (x, last) => map(x, last)) });
}

/** A plain text or number cell's value part: kind, spare, length, result (kept when the kind is the same), then the text or the 14 number bytes. */
function plainValueBytes(value: string | number, old: Uint8Array | null): Uint8Array {
  const kind = typeof value === "number" ? KIND_NUMBER : KIND_TEXT;
  const head = new Uint8Array(6 + RESULT_SIZE);
  if (old && old.length >= head.length && old[0] === kind) head.set(old.subarray(0, head.length));
  head[0] = kind;
  if (typeof value === "number") {
    const out = new Uint8Array(head.length + 14);
    out.set(head);
    setU32(out, 2, 14);
    out[6] = RESULT_REAL;
    setF64(out, 8, value);
    setU16(out, head.length, 0x065a);
    out.set(extended(value), head.length + 2);
    setU16(out, head.length + 12, 0x0690);
    return out;
  }
  const units: number[] = [];
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (c > 0xffff) units.push(0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff));
    else units.push(c);
  }
  const out = new Uint8Array(head.length + Math.max(2, 2 * units.length));
  out.set(head);
  setU32(out, 2, units.length);
  units.forEach((u, i) => setU16(out, head.length + 2 * i, u));
  return out;
}

/** v as an 80-bit x87 extended float (as worksheet.ts writes a number cell's tokens). */
function extended(v: number): Uint8Array {
  const out = new Uint8Array(10);
  if (v === 0) return out;
  const bits = new DataView(new Float64Array([v]).buffer);
  const hi = bits.getUint32(4, true);
  const lo = bits.getUint32(0, true);
  const sign = hi >>> 31;
  const exp = (hi >>> 20) & 0x7ff;
  if (exp === 0 || exp === 0x7ff) throw new Error("number out of range");
  const mantissa = (1n << 63n) | (((BigInt(hi & 0xfffff) << 32n) | BigInt(lo)) << 11n);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, mantissa, true);
  dv.setUint16(8, (sign << 15) | (exp - 1023 + 16383), true);
  return out;
}

/** A plain cell set to a text or a number: as writeWorksheetCell does, on the model. Formula cells are refused. */
export function plainValue(s: SheetItems, row: number, col: number, value: string | number): SheetItems {
  checkCell(s, row, col);
  if (isDatabaseHead(s.rowHeads[row]!)) throw new Error("database rows can't be edited here");
  const cur = s.cells[row]![col]!;
  if (cur.item && cur.item[FORMAT_SIZE] === KIND_FORMULA) throw new Error("formula cells can't be edited here");
  let format: Uint8Array;
  let flags: number;
  let old: Uint8Array | null = null;
  if (cur.item) {
    format = cur.item.slice(0, FORMAT_SIZE);
    flags = cur.flags;
    old = cur.item.subarray(FORMAT_SIZE);
  } else {
    const src = formatSource(s, row, col);
    format = src.format;
    flags = src.flags;
  }
  return withCell(s, row, col, { flags, item: concat([format, plainValueBytes(value, old)]) });
}

/**
 * The first 16 bytes of a block (+0x50…+0x5f) as the public demo files' blocks have them: +0x50, +0x57,
 * +0x59, +0x5a, +0x5b and +0x5d are the same in all 83; +0x54 is 2 in 79 of them, +0x56 is 0 in 67 and
 * +0x58 is 0 in 78 (the commoner values are taken; what the bytes mean isn't known).
 */
const BLOCK_HEAD_START = [2, 0, 0, 0, 2, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0];

/** A new block's header: BLOCK_HEAD_START, then zeros with the four empty-bounds f64 (signs in BOUNDS_SIGNS). */
function defaultBlockHead(): Uint8Array {
  const head = new Uint8Array(BLOCK_HEAD);
  head.set(BLOCK_HEAD_START);
  BOUNDS_AT.forEach((at, i) => setF64(head, at, BOUNDS_SIGNS[i]! * Number.MAX_VALUE));
  return head;
}

/**
 * The format of a subrow's cells: the one format every subrow cell of the public demo files has (13,837
 * cells in the four that have database rows), byte 1 aside, which is uninitialised there and 0 here. It
 * is not the header cell's format: a worksheet image draws each subrow cell in its header cell's.
 */
export function subrowFormat(): Uint8Array {
  const hex =
    "06000000ffff0a0000000003000000000000000000000000000000000001000101010200000000000000000100000000000000000001000000000000000000010000000000000000000100000000200020000000000000000000020100000200000000000000f03f0001";
  const out = new Uint8Array(FORMAT_SIZE);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** A value as a block cell: reuses the old cell when the value is the same, else a new one (i32 when `int` and whole). */
function blockCell(v: Value, old: DatabaseCell | null, format: Uint8Array | null, int: boolean): DatabaseCell | null {
  if (v === null || typeof v === "object") return null;
  if (old && old.raw && v === "") return old;
  if (typeof v === "string") {
    if (old && !old.raw && old.value === v) return old;
    const fmt = format ?? old?.format;
    if (!fmt) throw new Error("no format for a new cell");
    const tail = old && !old.raw && typeof old.value === "string" ? old.tail : new Uint8Array(2);
    return { format: fmt, value: v, int: false, spare: old?.spare ?? 0, flags: old?.flags ?? 0, tail, raw: null };
  }
  // numbers; a boolean is kept as 1 or 0 (not seen in the files)
  const n = typeof v === "boolean" ? (v ? 1 : 0) : v;
  if (old && !old.raw && typeof old.value === "number" && old.value === n) return old;
  const fmt = format ?? old?.format;
  if (!fmt) throw new Error("no format for a new cell");
  const asInt = int && Number.isInteger(n) && Math.abs(n) <= 0x7fffffff;
  return { format: fmt, value: n, int: asInt, spare: old?.spare ?? 0, flags: old?.flags ?? 0, tail: new Uint8Array(0), raw: null };
}

/**
 * A database block's record bodies from the model. With `prev` (the block as read), each subrow
 * takes its old height, w, cells and flags at its index, so the same values give the same bytes;
 * without it, the given heights and w (or the defaults) are used.
 */
export function buildBlock(prev: DatabaseRow | null, next: BlockNext): BlockBuild {
  const cols = next.cols;
  if (next.formats.length !== cols) throw new Error("one format per column");
  const intCol = Array.from({ length: cols }, (_, c) => next.intColumns?.[c] ?? (prev ? prev.subrows.some((x) => x.cells[c]?.int === true) : false));
  const subrows: DatabaseSubrow[] = [];
  let top = next.firstTop;
  next.subrows.forEach((sr, i) => {
    if (sr.values.length !== cols) throw new Error("each subrow has one value per column");
    const old = prev?.subrows[i];
    const height = sr.height ?? old?.height ?? next.subrowHeight;
    const w = sr.w ?? old?.w ?? prev?.subrows[0]?.w ?? 0;
    if (top > 0xffff) throw new Error("the subrows are more than 65535 points tall");
    subrows.push({
      head: new Uint8Array(12),
      height,
      top,
      w,
      group: sr.refs.length > 1 ? GROUP_MANY : 0,
      flags: old?.flags ?? 0,
      cells: sr.values.map((v, c) => blockCell(v, old?.cells[c] ?? null, next.formats[c] ?? null, intCol[c]!)),
    });
    top += height;
  });
  const columns: DatabaseColumn[] = Array.from({ length: cols }, () => ({ flags: 0, summarize: false, sort: "none", precedence: 0, sum: false, result: null }));
  const row: DatabaseRow = {
    row: -1,
    height: 0,
    top: 0,
    w: 0,
    block: next.block,
    criteria: new Uint8Array(0),
    rowFlags: 0,
    columns,
    subrows,
    order: [...next.order],
    objects: [],
    blockHead: prev ? prev.blockHead : defaultBlockHead(),
    blockColumnFlags: prev && prev.blockColumnFlags.length === cols ? prev.blockColumnFlags : new Array<number>(cols).fill(0),
  };
  const objects = next.subrows.flatMap((sr, i) => sr.refs.map((ref) => ({ subrow: i, ref, tag: OBJECT_TAG })));
  return { body: blockBody(row), order: orderBody(next.order), objects: objectsBody(objects) };
}
