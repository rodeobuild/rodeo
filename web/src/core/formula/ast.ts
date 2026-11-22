// Worksheet formulas as a tree. A formula cell and a database row's criteria hold the same thing
// in the file: u16 tokens in postfix order, ending 0x0690 (tokens.ts reads and writes them, and
// FORMAT.md §7.2 lists them). The tree keeps everything the tokens say (which quotes a name had,
// the brackets as typed, the name-table index beside a string) so that a formula read and written
// back unchanged is the same bytes.

/**
 * A token's number. Operators and functions that Rodeo works out but whose tokens no file seen
 * holds (+ - / ^ < > <= >=, SUM, MIN…) have negative ids (names.ts): tokens.ts refuses to write them.
 */
export type TokenId = number;

/** How a string was written: its token. 0x065b the usual 'text'; 0x0695 the option name that opens a function's arguments ('gross', 'finish'); 0x0696 after a 2026 criteria keyword. */
export type StringToken = 0x065b | 0x0695 | 0x0696;

export type Node =
  /** a number with a decimal point or too big for an integer (0x065a, an 80-bit float) */
  | { readonly k: "num"; readonly v: number }
  /** a whole number (0x0295, i32) */
  | { readonly k: "int"; readonly v: number }
  /** 'text'. `ref` is the name-table index the file keeps beside it (the resource, class or layer of that name), 0 for plain text. */
  | { readonly k: "str"; readonly v: string; readonly ref: number; readonly tok: StringToken }
  /** a bare word in criteria, with its wildcards (0x029b): EF_* */
  | { readonly k: "word"; readonly v: string }
  /** TRUE (0x0291). FALSE's token isn't in any file seen, so it is worked out but can't be written. */
  | { readonly k: "bool"; readonly v: boolean }
  /**
   * 'Record'.'Field': a record format's or plug-in's field (0x029c/0x029d the record, bare or quoted;
   * 0x029e/0x029f the field, bare or quoted). `recRef` is the format's name index; `type` and `offset`
   * are the field's type and value offset as the record format has them (FORMAT.md §7.3).
   */
  | {
      readonly k: "field";
      readonly rec: string;
      readonly recRef: number;
      readonly recQuoted: boolean;
      readonly field: string;
      readonly type: number;
      readonly offset: number;
      readonly fieldQuoted: boolean;
    }
  /** another worksheet's cell (0x0299): 'Name':C2, kept as rows and columns away from the cell holding the formula */
  | { readonly k: "sheet"; readonly sheet: string; readonly ref: number; readonly dRow: number; readonly dCol: number }
  /**
   * NAME(args): the function's token, its arguments, then 0x02a5; with none, 0x02a6 straight after the
   * name (=COUNT). `empty`: no arguments but closed with 0x02a5 all the same, as two cells in the files
   * are (NAME() rather than NAME).
   */
  | { readonly k: "call"; readonly fn: TokenId; readonly args: readonly Node[]; readonly empty?: boolean }
  /**
   * A cell of the same worksheet (A1, $B$2), 0-based. No file seen holds one, so its token isn't known: Rodeo
   * works it out but can't write it as a Vectorworks formula (the cell is saved as its value; see FORMAT.md).
   */
  | { readonly k: "cell"; readonly row: number; readonly col: number; readonly absRow: boolean; readonly absCol: boolean }
  /** A1..B5: the cells from one corner to the other. Not writable, as a cell. */
  | { readonly k: "range"; readonly a: Node & { readonly k: "cell" }; readonly b: Node & { readonly k: "cell" } }
  /** -a. Not writable (its token isn't known). */
  | { readonly k: "neg"; readonly a: Node }
  /** IF(test, then, else): the three in order, then 0x0682 */
  | { readonly k: "if"; readonly test: Node; readonly then: Node; readonly else: Node }
  /** a op b: both sides, then the operator's token (0x0647 =, 0x0646 <>, 0x064f &, 0x0648 |, 0x0654 *, 0x0641 IN) */
  | { readonly k: "op"; readonly op: TokenId; readonly a: Node; readonly b: Node }
  /** one operand then a token that changes it (0x00e4 after an area field) */
  | { readonly k: "post"; readonly op: TokenId; readonly a: Node }
  /** (a): the brackets as typed (0x0665 after what they hold) */
  | { readonly k: "paren"; readonly a: Node }
  /** ['a', 'b']: 0x0661, then the items. `mark` as for a keyword. */
  | { readonly k: "set"; readonly items: readonly Node[]; readonly mark?: boolean }
  /** a criteria keyword (R, L, PON, NOTINDLVP…). `mark`: 0x0296 comes before it in the file (see FORMAT.md; kept as read). */
  | { readonly k: "kw"; readonly id: TokenId; readonly mark?: boolean };

/** A cell's result: a number, text, a truth value, nothing, or an error such as #NAME? */
export type Value = number | string | boolean | null | { readonly error: string };

export function isError(v: Value): v is { readonly error: string } {
  return typeof v === "object" && v !== null;
}

/** Thrown by the reader for bytes it can't follow, and by the writer and parser for what can't be written. */
export class FormulaError extends Error {}
