// Worksheets made from nothing: the template for a worksheet in a drawing that has none to copy.
// createWorksheet (edit.ts) copies a worksheet's header and its children; with no worksheet in the
// drawing, it copies this template instead (blankWorksheetTemplate), and newWorksheetRecord lays
// the real grid on the copy.
//
// Every byte is a constant written here; nothing is read from a file at run time, and no name,
// text or client byte is in it. Each header byte is one of three kinds:
//   (a) the same in every worksheet of every file, client and public: written as it is;
//   (b) set on purpose here: the lengths and the record's flags, the saved pointer and the GUID
//       (instantiate gives the copy its own), the one-column one-row grid, the selection at A1,
//       the zoom at 100%;
//   (c) varying between worksheets, and taken from the public demo files: a run of bytes that
//       varies together takes the most common tuple of the 47 public worksheets (the counts
//       are in the comments below).
// worksheetNew.check.ts re-runs the census against the sample files.
//
// Layouts follow worksheet.ts (grid, cells) and FORMAT.md §7.2. Not decoded: the header fields
// from +0x50 to +0x22a (kept as the public sheets have them), the child records' contents beyond
// the forms below, the cell borders and the unknown bytes of a cell's format. Whether Vectorworks
// opens a worksheet made from this template is not checked.

import { concat, setU16, setU32, setU64 } from "./bytes.ts";
import { NEXT_MARK } from "./records.ts";
import { FORMAT_SIZE, RESULT_SIZE, ROW_PLAIN, SHEET_TABLE, WORKSHEET } from "./worksheet.ts";

const COLUMN = 1;
/** Child record types of a worksheet (FORMAT.md §7.2, census): a type-62 and a type-112 print child. */
const CHILD_CONTENTS = 0x3e;
const CHILD_PRINT = 0x70;

/**
 * The worksheet header from +0x50 to +0x22a, as runs of [offset, hex]. Bytes not in a run are zero.
 * Constant in all 51 worksheets (client and public): +0x50 u32 2, +0x68 the f64 constants, the zero
 * tails. Varying runs, each the most common public tuple (c), with the count of the public sheets
 * that have it:
 *   +0x54..0x5f  22/47   +0x62..0x64  26/47   +0x8e..0x96  8/47 (a rectangle, taken to be the window; +0x8c
 *                       rectangle, left, top, right, bottom in pixels: taken to be the window; 0x96 03)
 *   +0x9e..0xa0  26/47   +0xa8..0xba 5/47 (selection and zoom: set again below)
 *   +0xbe..0xc2  4/47 (+0xc0 columns, +0xc2 rows: set below)
 */
const HEADER_RUNS: [number, string][] = [
  [0x50, "020000000e000101000101010001"],
  [0x68, "ffffffffffffefffffffffffffffef7fffffffffffffef7fffffffffffffefff000000002000a0009b01c3036b05030096000a0000000d00820001000100000001000100000001000400000001000100000064000000e0000200030048004800480048"],
];

/** A print child (type 112) of 166 bytes, from the 20 public ones of that length (2024 to 2026 files): its body after +0x50 (c). */
const PRINT_BODY =
  "030000006400b5ffffffb5ffffff990c0000ab0900000000000000000000f20b0000600900002c012c01010064000100ffff000000010000000000000000000000000000000000000000000000000000000000000000";

/**
 * A plain text cell's format (106 bytes): the most common of the 991 plain text cells in the public
 * worksheets (47 of them). Its known bytes, by worksheet.ts's layout: +0x02 1 left aligned; +0x06
 * u16 12 font size; +0x08 u16 1 bold; +0x0a 0 general number format; +0x0b 3 decimal places; +0x0d 0
 * not wrapped; +0x11..0x18 0 not merged; +0x1b 0 not filled, +0x1c 0 fill colour. newWorksheetRecord
 * sets alignment, weight, number format and places per cell. Not decoded, kept as the top format has
 * them: +0x00 5, +0x0c 3, +0x1d, +0x1f..0x22, the four 10-byte border entries at +0x24, +0x2e, +0x38
 * and +0x42 (every public text cell sets them; their bytes at +0x2d, +0x37, +0x41, +0x4b are 0x9a, and
 * the published sheets draw no borders, so they read as no line (a guess)), +0x4e and +0x50 0x20,
 * +0x5a 2, +0x5e 2, +0x5f 14, +0x60 f64 1.0, +0x68 1, +0x69 1.
 */
const CELL_FORMAT =
  "0500010000000c00010000030300000000000000000000000000000000010001010102000200020000000101009a0200020000000101009a0a00020000000101009a0a00020000000101009a000020002000000000000000000002000000020e000000000000f03f0101";

/** Saved pointer placeholder: nonzero, so instantiate gives the copy a fresh address (b). */
const POINTER_PLACEHOLDER = 0x10000n;

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(2 * i, 2), 16);
  return out;
}

/**
 * A record header of `length` bytes: the type, the flags, the parent's type, and a GUID placeholder
 * that instantiate replaces (blank.ts's convention). `next` sets the next mark, which the sample
 * worksheet and its type-62 child have and the type-112 print child (the last child) lacks.
 */
function header(length: number, type: number, flags: number, parentType: number, pointer: boolean, next: boolean): Uint8Array {
  const d = new Uint8Array(0x50);
  setU64(d, 0, BigInt(length));
  if (next) setU64(d, 0x08, NEXT_MARK);
  if (pointer) setU64(d, 0x10, POINTER_PLACEHOLDER);
  d[0x19] = type;
  d[0x1f] = flags;
  d[0x2f] = parentType;
  d[0x38] = 1;
  return d;
}

/** A blank worksheet record, one column and one row, its one cell a plain text cell with no text. */
function sheetRecord(): Uint8Array {
  const head = new Uint8Array(SHEET_TABLE);
  head.set(header(0, WORKSHEET, 0x41, 0x11, true, true).subarray(0, 0x50));
  for (const [at, hex] of HEADER_RUNS) head.set(hexBytes(hex), at);
  // +0x8c: bit 0x20 is set on all 38 public sheets with a worksheet image on a sheet and clear on the 4
  // without one (the 0x00 and 0x08 sheets); a new worksheet has no image, so 0x00 (set on purpose)
  head[0x8c] = 0x00;
  setU16(head, 0xc0, 1); // one column
  setU16(head, 0xc2, 1); // one row
  // active cell and selection: A1 three times (row, column, offset), as newWorksheetRecord sets them
  [1, 1, 0, 1, 1, 0, 1, 1, 0].forEach((w, i) => setU16(head, 0xa8 + 2 * i, w));
  setU16(head, 0xba, 100); // zoom 100%
  // the grid: column, row, cell, and the end entry (worksheet.ts's table)
  const n = 1 + 1 * (1 + 1) + 1;
  const table = new Uint8Array(8 * n);
  const colItem = new Uint8Array(6);
  setU16(colItem, 0, COLUMN);
  setU16(colItem, 2, 72); // a placeholder width (1 inch), replaced by newWorksheetRecord
  const rowItem = new Uint8Array(8);
  setU16(rowItem, 0, ROW_PLAIN);
  setU16(rowItem, 2, 18); // a placeholder height, replaced by newWorksheetRecord
  setU16(rowItem, 6, 1); // the first plain row's last word in the public sheets (1 in most)
  const cellItem = concat([hexBytes(CELL_FORMAT), new Uint8Array(6 + RESULT_SIZE + 2)]); // empty text: kind 0, length 0, two zero bytes
  if (cellItem.length !== FORMAT_SIZE + 6 + RESULT_SIZE + 2) throw new Error("cell format must be 106 bytes");
  let at = SHEET_TABLE + table.length;
  const base = SHEET_TABLE - 8;
  const items = [colItem, rowItem, cellItem];
  items.forEach((item, i) => {
    setU32(table, 8 * i + 4, at - base);
    at += item.length;
  });
  setU32(table, 8 * (n - 1) + 4, at - base); // the end entry: the record's length
  const out = concat([head, table, ...items]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** A type-62 child (82 bytes): 2 zero bytes after its header, in 31 of the 47 public sheets. */
function contentsRecord(): Uint8Array {
  const d = concat([header(82, CHILD_CONTENTS, 0x40, WORKSHEET, false, true), new Uint8Array(2)]);
  setU64(d, 0, BigInt(d.length));
  return d;
}

/** A type-112 print child (166 bytes): the 86 bytes of PRINT_BODY after its header, from the public 166-byte forms (c). */
function printRecord(): Uint8Array {
  const body = hexBytes(PRINT_BODY);
  if (body.length !== 86) throw new Error("print body must be 86 bytes");
  const d = concat([header(166, CHILD_PRINT, 0x41, WORKSHEET, false, false), body]);
  setU64(d, 0, BigInt(d.length));
  return d;
}

const BLOCK = 60;
const BLOCK_ORDER = 61;
const BLOCK_OBJECTS = 124;

/**
 * A database row's block with its order and objects lists, from their bodies (each from +0x50): the
 * record headers as all 42 blocks of two public demo files have them. The block has a next mark, a
 * saved pointer (its children hang from it) and flags 0x41; the order list a next mark and flags 0x40;
 * the objects list, the last child, neither a next mark nor a GUID. All three have 0x12 at +0x2f.
 * createDatabaseRow gives the block its name index (an index with no name, as every block has).
 */
export function blockTemplate(body: Uint8Array, order: Uint8Array, objects: Uint8Array): Uint8Array[] {
  const block = concat([header(0, BLOCK, 0x41, 0x12, true, true), body]);
  const list = concat([header(0, BLOCK_ORDER, 0x40, 0x12, false, true), order]);
  const objs = concat([header(0, BLOCK_OBJECTS, 0x40, 0x12, false, false), objects]);
  // no GUID on the objects list (zero in all 42)
  objs[0x38] = 0;
  for (const d of [block, list, objs]) setU64(d, 0, BigInt(d.length));
  return [block, list, objs];
}

/**
 * The template for a new worksheet: the worksheet record (a one-column, one-row grid holding a
 * single empty plain text cell in the public default format) and its two children, a type-62
 * record and a type-112 print child, in the order the public worksheets have them. Its header
 * holds the saved pointer placeholder and a GUID placeholder for instantiate to replace; its name
 * index is 0 (createWorksheet writes the name).
 */
export function blankWorksheetTemplate(): { sheet: Uint8Array; children: Uint8Array[] } {
  return { sheet: sheetRecord(), children: [contentsRecord(), printRecord()] };
}
