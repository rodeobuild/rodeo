// Live worksheets: a worksheet's formulas and database rows as text, and its cached values worked
// out again from the drawing.
//
// A worksheet record keeps, beside each formula, the value it last had: a formula cell's cached
// result, a database row's subrows in its block (worksheetDb.ts), each database column's total
// in its header cell. Everything that shows a worksheet (the sheets' worksheet images, the
// editor, Export Worksheet) reads those. recalcSheet works them out again with the formula
// engine (formula/engine.ts, formula/database.ts) and gives the record and blocks back with the
// new values in them, byte for byte the same when nothing in the drawing changed.
//
// What is worked out is what the engine claims: formulas whose every token has a settled
// meaning, and database rows whose criteria it can follow. The rest keeps the values the file
// holds. Formulas that Rodeo works out but can't write as Vectorworks formulas (their tokens
// aren't known: + - / < >, A1, SUM…; FORMAT.md §7.2) are `kept`: the caller holds their text
// (the app keeps it in the drawing, in a Rodeo data object) and the cell is saved as its value,
// so Vectorworks reads a plain, correct cell.

import { f64, i32, readUtf16, u16, u32 } from "./bytes.ts";
import { FormulaError, isError, type Node, type Value } from "./formula/ast.ts";
import { databaseRow, matchCriteria, type ColumnDef, type IndexedObject, type ObjectIndex } from "./formula/database.ts";
import { evaluateSheet, unsupported, type Env } from "./formula/engine.ts";
import { parse, toText, type ParseContext } from "./formula/text.ts";
import { decode, encode, unwritable } from "./formula/tokens.ts";
import type { Rec } from "./records.ts";
import { DATABASE_BLOCK, DATABASE_OBJECTS, DATABASE_ORDER, FORMAT_SIZE, KIND_FORMULA, KIND_NUMBER, KIND_TEXT, RESULT_INT, RESULT_REAL, RESULT_SIZE, ROW_DATABASE } from "./worksheet.ts";
import { readDatabaseRows, type DatabaseBlockRecords, type DatabaseRow } from "./worksheetDb.ts";
import {
  buildBlock,
  laySheet,
  plainValue,
  readSheet,
  retop,
  setCachedResult,
  setDatabaseRow,
  setFormulaCell,
  subrowFormat,
  type BlockBuild,
  type SheetItems,
} from "./worksheetItems.ts";

const DATABASE = 0x029a;
const COUNT = 0x02c7;
const SORTED = 0x10;
const SUMMARIZE = 0x8;
const SUM = 0x40;
/** set on nearly every database header cell of the files (312 of 324 formula cells); what it says isn't known */
const HEADER_CELL = 0x4;
/** what the engine answers for a formula it has no rule for: never written into a cell */
const NO_RULE = "#OPCODE?";

/** A formula cell of a plain row, as text. */
export interface LiveFormula {
  row: number;
  col: number;
  /** "=…" as Vectorworks writes it */
  text: string;
  /** true when Rodeo holds the formula itself and the file holds its value (it can't be written as a Vectorworks formula) */
  kept: boolean;
  /** why Rodeo doesn't work it out (it shows the value the file holds), or null when it does */
  note: string | null;
}

/** A database row's column: its header cell. */
export interface LiveColumn {
  /** "=…", or the text of a column that shows the same text on every line */
  text: string;
  /** true for a text header cell, which every subrow repeats */
  constant: boolean;
  summarize: boolean;
  sort: "none" | "ascending" | "descending";
  /** 1 for the first sort column, 2 for the second…; 0 when not sorted */
  precedence: number;
  sum: boolean;
  /** why Rodeo doesn't work it out, or null when it does */
  note: string | null;
}

export interface LiveDatabaseRow {
  row: number;
  /** "=DATABASE(…)" */
  criteria: string;
  /** why Rodeo doesn't follow the criteria (the row then keeps the lines the file holds), or null */
  note: string | null;
  /** one per worksheet column; null where the header cell is empty */
  columns: (LiveColumn | null)[];
  /** how many lines it shows now */
  subrows: number;
}

export interface WorksheetLive {
  formulas: LiveFormula[];
  database: LiveDatabaseRow[];
}

/** A database row as typed: its criteria and each column's formula, with how the column sorts and adds up. */
export interface DatabaseRowSpec {
  /** "=DATABASE(…)", or the criteria alone */
  criteria: string;
  columns: readonly (null | DatabaseColumnSpec)[];
}

export interface DatabaseColumnSpec {
  /** "='Door'.'Width'" */
  text: string;
  summarize?: boolean;
  /** descending can't be written yet: no file seen holds a column sorted so */
  sort?: "none" | "ascending" | "descending";
  /** 1 for the first sort column, 2 for the second */
  precedence?: number;
  sum?: boolean;
  /** how its numbers show (a worksheet number format: 0 general, 2 decimal, 5 dimension, 11 area, 12 volume) and to how many places; left out, the cell's own */
  format?: number;
  accuracy?: number;
}

/** The formulas Rodeo holds for a worksheet: "row,col" (0-based) to "=…". */
export type KeptFormulas = ReadonlyMap<string, string>;

export interface RecalcContext {
  /** the drawing's objects (formula/database.ts) */
  index: ObjectIndex;
  /** the drawing's units name */
  units: string;
  parse: ParseContext;
  /** another worksheet's cell as it stands, by the worksheet's name (0-based row and column) */
  sheetCell(sheet: string, row: number, col: number): Value;
  /** the name index a database block lists `o` under: its own, or one allotted to it now (0 when none can be) */
  refOf(o: IndexedObject): number;
}

export interface RecalcResult {
  /** the worksheet record, or null when nothing in it changed */
  data: Uint8Array | null;
  /** true when one of its formulas reads another worksheet's cell (so it is worked out again after the others) */
  readsSheets: boolean;
  /** the blocks whose lines changed, by name index: their three records' bodies (from +0x50) */
  blocks: Map<number, BlockBuild>;
}

/** A worksheet as recalcSheet reads it: its record's bytes and its child records (the blocks). */
export type SheetRecord = Pick<Rec, "data" | "children">;

/** A worksheet's blocks by name index, as readDatabaseRows takes them. */
export function sheetBlocks(rec: SheetRecord): Map<number, DatabaseBlockRecords> {
  const out = new Map<number, DatabaseBlockRecords>();
  for (const b of rec.children) {
    if (b.type !== DATABASE_BLOCK) continue;
    out.set(b.nameIndex, {
      data: b.data,
      order: b.children.find((c) => c.type === DATABASE_ORDER)?.data ?? null,
      objects: b.children.find((c) => c.type === DATABASE_OBJECTS)?.data ?? null,
    });
  }
  return out;
}

/** A formula cell's tokens, or null when the item isn't a formula cell. */
function tokensOf(item: Uint8Array | null): Uint8Array | null {
  if (!item || item.length < FORMAT_SIZE + 6 + RESULT_SIZE || item[FORMAT_SIZE] !== KIND_FORMULA) return null;
  const at = FORMAT_SIZE + 6 + RESULT_SIZE;
  const len = u32(item, FORMAT_SIZE + 2);
  return at + len <= item.length ? item.subarray(at, at + len) : null;
}

function decoded(tokens: Uint8Array | null): Node | null {
  if (!tokens) return null;
  try {
    return decode(tokens);
  } catch {
    return null;
  }
}

/** A cell's value as the record holds it: its text, its number, or a formula's cached number (null for a text result, which a cell doesn't hold). */
function storedValue(item: Uint8Array | null): Value {
  if (!item || item.length < FORMAT_SIZE + 6 + RESULT_SIZE) return null;
  const kind = item[FORMAT_SIZE];
  const result = FORMAT_SIZE + 6;
  if (kind === KIND_TEXT) {
    const len = u32(item, FORMAT_SIZE + 2);
    const at = result + RESULT_SIZE;
    return len && at + 2 * len <= item.length ? readUtf16(item, at, 2 * len) : null;
  }
  if (kind !== KIND_NUMBER && kind !== KIND_FORMULA) return null;
  if (item[result] === RESULT_INT) return i32(item, result + 2);
  if (item[result] === RESULT_REAL) {
    const v = f64(item, result + 2);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

/** Which functions of the drawing a plain cell may call: =COUNT(criteria). */
function provided(fn: number, where: "cell" | "column"): boolean {
  return where === "cell" && fn === COUNT;
}

function isDatabaseRow(s: SheetItems, row: number): boolean {
  const head = s.rowHeads[row]?.item;
  return !!head && u16(head, 0) === ROW_DATABASE;
}

/** The criteria as a DATABASE call, whether typed with it or without. */
function criteriaNode(text: string, ctx: ParseContext): Node {
  const n = parse(text, ctx);
  return n.k === "call" && n.fn === DATABASE ? n : { k: "call", fn: DATABASE, args: [n] };
}

function columnFlags(c: { summarize?: boolean; sort?: string; precedence?: number; sum?: boolean }): number {
  const sorted = c.sort === "ascending";
  return HEADER_CELL | (c.summarize ? SUMMARIZE : 0) | (sorted ? SORTED : 0) | (c.sum ? SUM : 0) | (sorted ? Math.max(1, c.precedence ?? 1) << 16 : 0);
}

/** The engine's column definitions of a database row, null where a header cell is empty or can't be read. */
function engineColumns(s: SheetItems, row: DatabaseRow): { defs: (ColumnDef | null)[]; constant: boolean[] } {
  const constant: boolean[] = [];
  const defs = row.columns.map((col, c): ColumnDef | null => {
    const item = s.cells[row.row]?.[c]?.item ?? null;
    constant.push(false);
    if (!item) return null;
    let formula = decoded(tokensOf(item));
    if (!formula && item[FORMAT_SIZE] === KIND_TEXT) {
      // a text header cell: every line shows it
      const v = storedValue(item);
      if (typeof v !== "string") return null;
      formula = { k: "str", v, ref: 0, tok: 0x065b };
      constant[c] = true;
    }
    return formula ? { formula, summarize: col.summarize, sort: col.sort, precedence: col.precedence, sum: col.sum } : null;
  });
  return { defs, constant };
}

/** The worksheet's formulas and database rows as text. `kept` are the formulas Rodeo holds for it. */
export function readLive(rec: SheetRecord, index: ObjectIndex | null, kept: KeptFormulas = new Map()): WorksheetLive | null {
  const s = readSheet(rec.data);
  if (!s) return null;
  const formulas: LiveFormula[] = [];
  for (let r = 0; r < s.rows; r++) {
    if (isDatabaseRow(s, r)) continue;
    for (let c = 0; c < s.cols; c++) {
      const text = kept.get(`${r},${c}`);
      if (text !== undefined) {
        formulas.push({ row: r, col: c, text, kept: true, note: null });
        continue;
      }
      const tokens = tokensOf(s.cells[r]![c]!.item);
      if (!tokens) continue;
      const node = decoded(tokens);
      // a number cell is a formula of one number in the file's terms, but its kind is 2: not listed here
      formulas.push(
        node
          ? { row: r, col: c, text: toText(node, { row: r, col: c }), kept: false, note: unsupported(node, "cell", provided) }
          : { row: r, col: c, text: "", kept: false, note: "Rodeo can't read this formula" },
      );
    }
  }
  const database = readDatabaseRows(rec.data, sheetBlocks(rec)).map((row): LiveDatabaseRow => {
    const criteria = decoded(row.criteria);
    const { defs, constant } = engineColumns(s, row);
    const match = criteria && index ? matchCriteria(index, criteria) : null;
    const result = criteria && index && match && !match.unsupported ? databaseRow(index, criteria, defs, index.units) : null;
    return {
      row: row.row,
      criteria: criteria ? toText(criteria) : "",
      note: !criteria ? "Rodeo can't read these criteria" : (match?.unsupported ?? null),
      columns: defs.map((d, c): LiveColumn | null =>
        d
          ? {
              text: constant[c] ? String((d.formula as { v: string }).v) : toText(d.formula, { row: row.row, col: c }),
              constant: constant[c]!,
              summarize: d.summarize,
              sort: d.sort,
              precedence: d.precedence,
              sum: d.sum,
              note: result ? (result.unsupported[c] ?? null) : null,
            }
          : null,
      ),
      subrows: row.subrows.length,
    };
  });
  return { formulas, database };
}

/** True when two numbers differ by no more than rounding: the file's own digits are then kept, so nothing changes. */
function close(a: number, b: number): boolean {
  return a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** A value as a block's cell holds it: text, a number, or nothing. */
function blockValue(v: Value): string | number | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "True" : "False";
  if (isError(v)) return v.error;
  return v;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** A database row's lines worked out again: the block, and the header row's cached totals set in `s`. */
function recalcRow(s: SheetItems, row: DatabaseRow, ctx: RecalcContext): { sheet: SheetItems; block: BlockBuild; heights: number[] } | null {
  const criteria = decoded(row.criteria);
  if (!criteria) return null;
  const { defs } = engineColumns(s, row);
  const match = matchCriteria(ctx.index, criteria);
  if (match.unsupported) return null;
  // a column that isn't worked out (or has no header cell) keeps what the file shows on the line that
  // holds the same objects
  const keyOf = (refs: readonly number[]): string => [...refs].sort((x, y) => x - y).join(",");
  const oldRefs = row.subrows.map((): number[] => []);
  for (const o of row.objects) oldRefs[o.subrow]?.push(o.ref);
  const oldByKey = new Map<string, number>();
  oldRefs.forEach((refs, i) => {
    if (refs.length && refs.every((r) => r !== 0)) oldByKey.set(keyOf(refs), i);
  });
  // lines whose sort columns are equal keep the order the file shows them in
  const place = new Map(row.order.map((sub, i) => [sub, i]));
  const result = databaseRow(ctx.index, criteria, defs, ctx.units, {
    rank: (objects) => {
      const old = objects.every((o) => o.nameIndex !== 0) ? oldByKey.get(keyOf(objects.map((o) => o.nameIndex))) : undefined;
      return old === undefined ? undefined : place.get(old);
    },
  });
  const subrows = result.subrows.map((sr) => {
    const refs = sr.objects.map((o) => ctx.refOf(o));
    const old = oldByKey.get(keyOf(refs));
    const values = sr.values.map((v, c): Value => {
      if (defs[c] && result.unsupported[c] === null) return blockValue(v);
      const was = old === undefined ? null : row.subrows[old]?.cells[c];
      return was && !was.raw ? was.value : was ? "" : null;
    });
    return { values, refs, old };
  });
  subrows.forEach((sr, i) => {
    sr.values = sr.values.map((v, c) => {
      const was = row.subrows[i]?.cells[c];
      return typeof v === "number" && was && !was.raw && typeof was.value === "number" && close(v, was.value) ? was.value : v;
    });
  });
  // the display order: the engine's; where it can't say (a sort column it doesn't work out), the file's while
  // the lines are the file's, else the stored order
  let order = subrows.map((_, i) => i);
  if (result.orderKnown) order = result.order;
  else if (subrows.length === row.subrows.length && subrows.every((sr) => sr.old !== undefined)) {
    const now = new Map(subrows.map((sr, i) => [sr.old!, i]));
    const kept = row.order.map((o) => now.get(o));
    if (kept.every((i) => i !== undefined) && new Set(kept).size === subrows.length) order = kept as number[];
  }
  const height = row.subrows[0]?.height ?? row.height;
  const format = subrowFormat();
  const block = buildBlock(row, {
    block: row.block,
    cols: s.cols,
    subrowHeight: height,
    firstTop: row.top + row.height,
    formats: defs.map(() => format),
    subrows: subrows.map((sr, i) => ({ values: sr.values, refs: sr.refs, height: row.subrows[i]?.height ?? height })),
    order,
  });
  // the header row: how many lines, and each column's total (or, for text, how many lines have some)
  let sheet = s;
  const head = s.rowHeads[row.row]!;
  if (head.item && u16(head.item, 12) !== subrows.length) {
    const item = head.item.slice();
    item[12] = subrows.length & 0xff;
    item[13] = subrows.length >> 8;
    sheet = { ...sheet, rowHeads: sheet.rowHeads.map((e, r) => (r === row.row ? { flags: e.flags, item } : e)) };
  }
  // a number column's header caches its total. A text column's header caches a number the files don't
  // agree on a rule for (FORMAT.md §7.2), so it is left as it is: nothing shows it.
  defs.forEach((d, c) => {
    const h = result.header[c];
    if (!d || result.unsupported[c] !== null || typeof h !== "number" || !tokensOf(sheet.cells[row.row]![c]!.item)) return;
    if (subrows.some((sr) => typeof sr.values[c] === "string" && sr.values[c] !== "")) return;
    const was = row.columns[c]?.result;
    if (was && was.kind !== 5 && close(was.value, h)) return;
    sheet = setCachedResult(sheet, row.row, c, h);
  });
  return { sheet, block, heights: subrows.map((_, i) => row.subrows[i]?.height ?? height) };
}

/**
 * The worksheet with its cached values worked out again from the drawing: each database row the
 * engine follows, then the plain rows' formula cells and the formulas Rodeo holds (`kept`).
 */
export function recalcSheet(rec: SheetRecord, ctx: RecalcContext, kept: KeptFormulas = new Map()): RecalcResult {
  const blocks = new Map<number, BlockBuild>();
  const start = readSheet(rec.data);
  if (!start) return { data: null, blocks, readsSheets: false };
  let s = start;
  const had = sheetBlocks(rec);
  const rows = readDatabaseRows(rec.data, had);
  const heights = new Map<number, readonly number[]>();
  /** each database header cell's new total, for a plain cell that reads it */
  for (const row of rows) {
    heights.set(row.row, row.subrows.map((x) => x.height));
    const next = recalcRow(s, row, ctx);
    if (!next) continue;
    s = next.sheet;
    heights.set(row.row, next.heights);
    const old = had.get(row.block);
    const same =
      old &&
      sameBytes(old.data.subarray(0x50), next.block.body) &&
      old.order &&
      sameBytes(old.order.subarray(0x50), next.block.order) &&
      old.objects &&
      sameBytes(old.objects.subarray(0x50), next.block.objects);
    if (!same) blocks.set(row.block, next.block);
  }
  if (rows.length) s = retop(s, heights);

  // plain rows: the file's formula cells, and the ones Rodeo holds
  const nodes = new Map<string, Node>();
  const fromFile = new Set<string>();
  for (let r = 0; r < s.rows; r++) {
    if (isDatabaseRow(s, r)) continue;
    for (let c = 0; c < s.cols; c++) {
      const key = `${r},${c}`;
      const text = kept.get(key);
      if (text !== undefined) {
        try {
          nodes.set(key, parse(text, { ...ctx.parse, at: { row: r, col: c } }));
        } catch (err) {
          if (!(err instanceof FormulaError)) throw err;
        }
        continue;
      }
      const node = decoded(tokensOf(s.cells[r]![c]!.item));
      if (node && unsupported(node, "cell", provided) === null) {
        nodes.set(key, node);
        fromFile.add(key);
      }
    }
  }
  if (nodes.size) {
    const sheet = s;
    const env = plainEnv(ctx);
    const values = evaluateSheet(
      nodes,
      (r, c) => storedValue(sheet.cells[r]?.[c]?.item ?? null),
      () => env,
    );
    for (const [key, v] of values) {
      if (isError(v) && v.error === NO_RULE) continue;
      const [r, c] = key.split(",").map(Number) as [number, number];
      const was = storedValue(s.cells[r]![c]!.item);
      if (typeof v === "number" && typeof was === "number" && close(v, was)) continue;
      if (fromFile.has(key)) s = setCachedResult(s, r, c, v);
      else s = plainValue(s, r, c, typeof v === "number" ? v : v === null ? "" : typeof v === "boolean" ? (v ? "True" : "False") : isError(v) ? v.error : v);
    }
  }
  const data = laySheet(s);
  return { data: sameBytes(data, rec.data) ? null : data, blocks, readsSheets: [...nodes.values()].some(readsSheet) };
}

/** True when the formula reads another worksheet's cell. */
function readsSheet(n: Node): boolean {
  switch (n.k) {
    case "sheet":
      return true;
    case "call":
      return n.args.some(readsSheet);
    case "if":
      return readsSheet(n.test) || readsSheet(n.then) || readsSheet(n.else);
    case "op":
      return readsSheet(n.a) || readsSheet(n.b);
    case "post":
    case "paren":
    case "neg":
      return readsSheet(n.a);
    case "set":
      return n.items.some(readsSheet);
    default:
      return false;
  }
}

/** The value of worksheet cell (row, col) as the record holds it: text, a number, or a formula's cached number. */
export function cellValueAt(data: Uint8Array, row: number, col: number): Value {
  const s = readSheet(data);
  return s ? storedValue(s.cells[row]?.[col]?.item ?? null) : null;
}

/**
 * What `node` comes to in plain cell (row, col) of the worksheet as it stands, with the formulas Rodeo
 * holds: for deciding how a formula just typed is saved.
 */
export function evaluateCell(rec: SheetRecord, ctx: RecalcContext, kept: KeptFormulas, row: number, col: number, node: Node): Value {
  const s = readSheet(rec.data);
  if (!s) return null;
  const nodes = new Map<string, Node>();
  for (let r = 0; r < s.rows; r++) {
    if (isDatabaseRow(s, r)) continue;
    for (let c = 0; c < s.cols; c++) {
      const text = kept.get(`${r},${c}`);
      let n: Node | null = null;
      if (text !== undefined) {
        try {
          n = parse(text, { ...ctx.parse, at: { row: r, col: c } });
        } catch (err) {
          if (!(err instanceof FormulaError)) throw err;
        }
      } else {
        n = decoded(tokensOf(s.cells[r]![c]!.item));
        if (n && unsupported(n, "cell", provided) !== null) n = null;
      }
      if (n) nodes.set(`${r},${c}`, n);
    }
  }
  nodes.set(`${row},${col}`, node);
  const env = plainEnv(ctx);
  return evaluateSheet(nodes, (r, c) => storedValue(s.cells[r]?.[c]?.item ?? null), () => env).get(`${row},${col}`) ?? null;
}

/** What a plain cell's formula reads of the drawing and of other worksheets. */
function plainEnv(ctx: RecalcContext): Omit<Env, "cell" | "at"> {
  return {
    sheetCell: ctx.sheetCell,
    criteriaCall: (fn, args) => {
      if (fn !== COUNT || args.length !== 1) return undefined;
      const m = matchCriteria(ctx.index, { k: "call", fn: DATABASE, args: [args[0]!] });
      return m.unsupported ? undefined : m.objects.length;
    },
  };
}

/** The worksheet record with a plain row's cell holding `value` as plain text or a number, whatever it held (a formula too). */
export function withPlain(data: Uint8Array, row: number, col: number, value: string | number): Uint8Array {
  let s = readSheet(data);
  if (!s) throw new Error("this worksheet can't be read");
  if (isDatabaseRow(s, row)) throw new Error("a database row's cells are set with the row");
  const cur = s.cells[row]?.[col];
  if (cur?.item && cur.item[FORMAT_SIZE] === KIND_FORMULA) {
    // the formula goes: an empty text cell in its format, which plain cells' flags (0) go with
    const item = new Uint8Array(FORMAT_SIZE + 6 + RESULT_SIZE + 2);
    item.set(cur.item.subarray(0, FORMAT_SIZE));
    s = { ...s, cells: s.cells.map((line, r) => (r === row ? line.map((e, c) => (c === col ? { flags: 0, item } : e)) : line)) };
  }
  return laySheet(plainValue(s, row, col, value));
}

/** A formula as typed, ready for a plain cell: its tokens when it can be written as a Vectorworks formula, else why it can't. */
export function formulaTokens(text: string, ctx: ParseContext, at: { row: number; col: number }): { node: Node; tokens: Uint8Array | null; why: string | null } {
  const node = parse(text, { ...ctx, at });
  const why = unwritable(node);
  return { node, tokens: why ? null : encode(node), why };
}

/** The worksheet record with a plain row's cell made a formula cell holding `tokens` and its value now. */
export function withFormula(data: Uint8Array, row: number, col: number, tokens: Uint8Array, value: Value): Uint8Array {
  const s = readSheet(data);
  if (!s) throw new Error("this worksheet can't be read");
  if (isDatabaseRow(s, row)) throw new Error("a database row's cells are set with the row");
  return laySheet(setFormulaCell(s, row, col, tokens, value));
}

/**
 * The worksheet record with row `row` made a database row of `spec` and block `block`, with no lines
 * yet (recalcSheet fills them in). Throws a FormulaError naming what can't be written as a
 * Vectorworks formula.
 */
export function withDatabaseRow(data: Uint8Array, row: number, block: number, spec: DatabaseRowSpec, ctx: ParseContext): Uint8Array {
  const s = readSheet(data);
  if (!s) throw new Error("this worksheet can't be read");
  if (spec.columns.length > s.cols) throw new Error("the row has more columns than the worksheet");
  const criteria = criteriaNode(spec.criteria, ctx);
  const why = unwritable(criteria);
  if (why) throw new FormulaError(why);
  const columns = Array.from({ length: s.cols }, (_, c) => {
    const col = spec.columns[c];
    if (!col || !col.text.trim()) return null;
    const node = parse(col.text, { ...ctx, at: { row, col: c } });
    const no = unwritable(node);
    if (no) throw new FormulaError(no);
    if (col.sort === "descending") throw new FormulaError("a column sorted descending can't be saved yet (no file seen holds one)");
    return { tokens: encode(node), flags: columnFlags(col), cached: 0, textKind: false };
  });
  const was = isDatabaseRow(s, row) ? s.rowHeads[row]!.item! : null;
  const next = setDatabaseRow(s, row, { block, criteria: encode(criteria), subrows: was ? u16(was, 12) : 0, columns });
  // its lines are drawn in the header cells' formats. A new header cell copies a cell of its column (the
  // heading above, as a rule): its font and size stay, its weight, alignment and number format start plain.
  // Then how each column's numbers show, where the spec says.
  const cells = next.cells.map((line, r) =>
    r !== row
      ? line
      : line.map((e, c) => {
          const col = spec.columns[c];
          const fresh = !s.cells[row]![c]!.item;
          if (!e.item || !col || (!fresh && col.format === undefined && col.accuracy === undefined)) return e;
          const item = e.item.slice();
          if (fresh) {
            item[0x02] = 0;
            item[0x08] = 0;
            item[0x09] = 0;
            item[0x0a] = 0;
            item[0x0b] = 3;
          }
          if (col.format !== undefined) item[0x0a] = col.format;
          if (col.accuracy !== undefined) item[0x0b] = Math.max(0, Math.min(10, Math.round(col.accuracy)));
          return { flags: e.flags, item };
        }),
  );
  return laySheet({ ...next, cells });
}

/**
 * Why `spec` can't be made a database row of this worksheet, or null when it can: a formula that
 * isn't one, something Vectorworks' tokens aren't known for, or criteria Rodeo can't follow.
 */
export function databaseRowProblem(data: Uint8Array, row: number, spec: DatabaseRowSpec, ctx: ParseContext, index: ObjectIndex): string | null {
  try {
    withDatabaseRow(data, row, 1, spec, ctx);
    const m = matchCriteria(index, criteriaNode(spec.criteria, ctx));
    return m.unsupported;
  } catch (err) {
    if (err instanceof Error) return err.message;
    throw err;
  }
}

/**
 * How a formula typed into a plain cell would be saved: `error` when it isn't a formula or Rodeo doesn't
 * work it out; else whether it is saved as a Vectorworks formula or (`why` says what stops that) as its value.
 */
export function formulaCheck(text: string, ctx: ParseContext, at: { row: number; col: number }): { error: string } | { why: string | null } {
  try {
    const f = formulaTokens(text, ctx, at);
    const no = plainUnsupported(f.node);
    return no ? { error: no } : { why: f.why };
  } catch (err) {
    if (err instanceof FormulaError) return { error: err.message };
    throw err;
  }
}

/** An empty block's three record bodies (from +0x50): what a new database row starts with. */
export function emptyBlock(block: number, cols: number): BlockBuild {
  return buildBlock(null, { block, cols, subrowHeight: 0, firstTop: 0, formats: Array.from({ length: cols }, () => null), subrows: [], order: [] });
}

/** True when plain cell (row, col) of the worksheet record holds a formula. */
export function isFormulaCell(data: Uint8Array, row: number, col: number): boolean {
  const s = readSheet(data);
  return !!s && tokensOf(s.cells[row]?.[col]?.item ?? null) !== null;
}

/** Why Rodeo doesn't work out a formula typed into a plain cell, or null when it does. */
export function plainUnsupported(node: Node): string | null {
  return unsupported(node, "cell", provided);
}
