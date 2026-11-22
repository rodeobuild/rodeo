// A formula tree as Vectorworks writes it in a worksheet, and back, and the full worksheet formula
// language on the way in. Precedence, lowest first: | ; & ; = <> < > <= >= IN ; + - ; * / ; ^ ;
// unary - ; then a postfix {00E4}. Binary operators are left associative. Parsing accepts operators and
// cell references whose tokens no file holds (names.ts gives those negative ids); tokens.ts refuses to
// write them, and says so with unwritable().

import { FormulaError, type Node } from "./ast.ts";
import { anyFunctionName, anyFunctionToken, anyOperatorSymbol, anyOperatorToken, hex4, keywordName, keywordToken, OP, TOKEN as T } from "./names.ts";

export interface ParseContext {
  /** a name-table index for a name; 0 when the name is not in the table */
  nameIndex(name: string): number;
  /** a record format's field (its type and value offset), or null when the format has no such field */
  field(rec: string, field: string): { type: number; offset: number } | null;
  /** the cell holding the formula (0-based), for `'Sheet':C2` and `Sheet:C2` */
  at?: { row: number; col: number };
}

/** A record or field the drawing doesn't have. Callers treat it apart from other faults (a name that may come later). */
/** Criteria keywords of Vectorworks that no file seen holds a token for (type, class, symbol, name, visibility, selection…). */
const UNSETTLED_CRITERIA: ReadonlySet<string> = new Set(["T", "C", "S", "N", "V", "ST", "SEL", "ALL", "LW", "LS", "PF", "PB", "FF", "FB", "FP", "AR", "INSYMBOL", "INOBJECT", "INVIEWPORT"]);

export class UnknownFieldError extends FormulaError {
  readonly rec: string;
  readonly field: string;
  constructor(rec: string, field: string) {
    super(`"${rec}"."${field}" is not a field of a record format in this drawing`);
    this.rec = rec;
    this.field = field;
  }
}

type CellNode = Extract<Node, { k: "cell" }>;

/** binding strength of each binary operator (by token id); a larger number binds tighter */
const PREC: ReadonlyMap<number, number> = new Map<number, number>([
  [T.OR, 1],
  [T.AND, 2],
  [T.EQ, 3],
  [T.NE, 3],
  [T.IN, 3],
  [OP.LT, 3],
  [OP.GT, 3],
  [OP.LE, 3],
  [OP.GE, 3],
  [OP.ADD, 4],
  [OP.SUB, 4],
  [T.MUL, 5],
  [OP.DIV, 5],
  [OP.POW, 6],
]);
const NEG = 7;
const ATOM = 9;

/** a column letter run from a 0-based column: 0 is A, 26 is AA */
function columnLetters(col: number): string {
  let s = "";
  for (let c = col + 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
  return s;
}

/** a cell as the formula text writes it: A1, $A$1 */
export function cellText(row: number, col: number, absRow = false, absCol = false): string {
  if (row < 0 || col < 0) throw new FormulaError("a sheet reference points off the sheet");
  return `${absCol ? "$" : ""}${columnLetters(col)}${absRow ? "$" : ""}${row + 1}`;
}

function quoteIf(name: string, quoted: boolean): string {
  return quoted ? `'${name.replace(/'/g, "''")}'` : name;
}

function precOf(n: Node): number {
  if (n.k === "op") return PREC.get(n.op) ?? ATOM;
  if (n.k === "neg") return NEG;
  return ATOM;
}

function body(n: Node, at: { row: number; col: number } | undefined): string {
  switch (n.k) {
    case "num":
      if (!Number.isFinite(n.v)) throw new FormulaError("a number is infinite or not a number");
      // a decimal point keeps it a number on the way back
      return Number.isInteger(n.v) && Math.abs(n.v) < 1e15 ? `${n.v}.0` : String(n.v);
    case "int":
      return String(n.v);
    case "str":
      return `'${n.v.replace(/'/g, "''")}'`;
    case "word":
      return n.v;
    case "bool":
      return n.v ? "TRUE" : "FALSE";
    case "field":
      return `${quoteIf(n.rec, n.recQuoted)}.${quoteIf(n.field, n.fieldQuoted)}`;
    case "sheet": {
      const cell = at ? cellText(at.row + n.dRow, at.col + n.dCol) : `R[${n.dRow}]C[${n.dCol}]`;
      return `'${n.sheet.replace(/'/g, "''")}':${cell}`;
    }
    case "cell":
      return cellText(n.row, n.col, n.absRow, n.absCol);
    case "range":
      return `${cellText(n.a.row, n.a.col, n.a.absRow, n.a.absCol)}..${cellText(n.b.row, n.b.col, n.b.absRow, n.b.absCol)}`;
    case "neg": {
      const inner = body(n.a, at);
      return precOf(n.a) < NEG ? `-(${inner})` : `-${inner}`;
    }
    case "call": {
      const name = anyFunctionName(n.fn);
      if (name === undefined) throw new FormulaError(`function token 0x${hex4(n.fn)} can't be written yet: its token isn't known`);
      return n.args.length || n.empty ? `${name}(${n.args.map((a) => body(a, at)).join(", ")})` : name;
    }
    case "if":
      return `IF(${body(n.test, at)}, ${body(n.then, at)}, ${body(n.else, at)})`;
    case "op": {
      if (n.op === T.IN) return `${body(n.b, at)} IN ${body(n.a, at)}`;
      const p = PREC.get(n.op);
      const sym = anyOperatorSymbol(n.op);
      if (p === undefined || sym === undefined) {
        throw new FormulaError(`operator token 0x${hex4(n.op)} can't be written yet: its token isn't known`);
      }
      const l = wrap(n.a, p, false, at);
      const r = wrap(n.b, p, true, at);
      const pad = n.op === T.AND || n.op === T.OR || n.op === OP.ADD || n.op === OP.SUB ? " " : "";
      return `${l}${pad}${sym}${pad}${r}`;
    }
    case "post": {
      const a = n.a.k === "op" ? `(${body(n.a, at)})` : body(n.a, at);
      return `${a} {00E4}`;
    }
    case "paren":
      return `(${body(n.a, at)})`;
    case "set":
      return `[${n.items.map((it) => body(it, at)).join(", ")}]`;
    case "kw": {
      const name = keywordName(n.id);
      if (name === undefined) throw new FormulaError(`keyword token 0x${hex4(n.id)} can't be written yet: its token isn't known`);
      return name;
    }
  }
}

/** a child operand, bracketed when it binds looser than its parent (or equally, on the right) */
function wrap(child: Node, p: number, right: boolean, at: { row: number; col: number } | undefined): string {
  const cp = precOf(child);
  const needs = right ? cp <= p : cp < p;
  return child.k === "op" && needs ? `(${body(child, at)})` : body(child, at);
}

/** The formula as Vectorworks writes it, starting with "=". */
export function toText(node: Node, at?: { row: number; col: number }): string {
  return `=${body(node, at)}`;
}

// ---- parsing ----

const NO_OPTION_STRING: ReadonlySet<number> = new Set([0x00f3, 0x01e0, 0x01af]);
/** the comparison symbols, longest first so that <= is not read as < */
const COMPARISONS = ["<=", ">=", "<>", "=", "<", ">"];

class Parser {
  private i = 0;
  constructor(
    private readonly s: string,
    private readonly ctx: ParseContext,
  ) {}

  atEnd(): boolean {
    this.ws();
    return this.i === this.s.length;
  }
  fail(what: string): never {
    throw new FormulaError(`${what} at position ${this.i}`);
  }
  ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }
  peek(sym: string): boolean {
    this.ws();
    return this.s.startsWith(sym, this.i);
  }
  eat(sym: string): boolean {
    if (!this.peek(sym)) return false;
    this.i += sym.length;
    return true;
  }
  expect(sym: string): void {
    if (!this.eat(sym)) this.fail(`expected "${sym}"`);
  }
  /** an argument or set item separator: a comma or a semicolon */
  sep(): boolean {
    return this.eat(",") || this.eat(";");
  }
  /** a quoted string: its text, '' inside it standing for one quote */
  quoted(): string {
    this.i++; // the opening quote
    let out = "";
    for (;;) {
      if (this.i >= this.s.length) this.fail("a string is not closed");
      const c = this.s[this.i++]!;
      if (c === "'") {
        if (this.s[this.i] === "'") {
          out += "'";
          this.i++;
          continue;
        }
        return out;
      }
      out += c;
    }
  }
  /** a bare identifier or wildcard word (EF_*), with whether it is the wildcard kind */
  bare(): { text: string; wild: boolean } | null {
    this.ws();
    const rest = this.s.slice(this.i);
    const m = /^[A-Za-z0-9_*?]+/.exec(rest);
    if (m && /[*?]$/.test(m[0])) {
      const after = rest.slice(m[0].length).trimStart();
      if (after === "" || /^[=<>&|),;\]]/.test(after)) {
        this.i += m[0].length;
        return { text: m[0], wild: true };
      }
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!id) return null;
    this.i += id[0].length;
    return { text: id[0], wild: false };
  }
  /** a field name after its '.': quoted or bare */
  fieldName(): { text: string; quoted: boolean } {
    this.ws();
    if (this.s[this.i] === "'") return { text: this.quoted(), quoted: true };
    const id = this.bare();
    if (!id || id.wild) this.fail("a field name is expected");
    return { text: id!.text, quoted: false };
  }
  /**
   * A1, $A$1, a$1 at the cursor: a cell of this worksheet, consumed. Null (nothing consumed) when the text is
   * not one: a keyword (K0348), a function call (LOG10(…)), a longer name, or a record's field (A1.Field).
   */
  cellAhead(): CellNode | null {
    this.ws();
    const m = /^(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)/.exec(this.s.slice(this.i));
    if (!m) return null;
    const after = this.s.slice(this.i + m[0].length);
    if (/^[A-Za-z0-9_]/.test(after)) return null;
    if (/^\s*\(/.test(after)) return null;
    if (after.startsWith(".") && !after.startsWith("..")) return null;
    const absCol = m[1] === "$";
    const absRow = m[3] === "$";
    if (!absCol && !absRow && keywordToken(m[2]! + m[4]!) !== undefined) return null;
    const row = Number(m[4]);
    if (row < 1) throw new FormulaError("rows start at 1");
    let col = 0;
    for (const ch of m[2]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    this.i += m[0].length;
    return { k: "cell", row: row - 1, col: col - 1, absRow, absCol };
  }
  /** A1..B5 as an argument of a function: consumed when it is followed by , ; or ), else nothing is consumed */
  tryRange(): Node | null {
    const save = this.i;
    const a = this.cellAhead();
    if (a && this.s.startsWith("..", this.i)) {
      this.i += 2;
      const b = this.cellAhead();
      if (b && (this.peek(",") || this.peek(";") || this.peek(")"))) return { k: "range", a, b };
    }
    this.i = save;
    return null;
  }
  field(rec: string, recQuoted: boolean): Node {
    this.expect(".");
    const f = this.fieldName();
    const recRef = this.ctx.nameIndex(rec);
    const found = recRef === 0 ? null : this.ctx.field(rec, f.text);
    if (!found) throw new UnknownFieldError(rec, f.text);
    return {
      k: "field",
      rec,
      recRef,
      recQuoted,
      field: f.text,
      type: found.type,
      offset: found.offset,
      fieldQuoted: f.quoted,
    };
  }

  expr(): Node {
    let a = this.and();
    while (this.eat("|")) a = { k: "op", op: T.OR, a, b: this.and() };
    return a;
  }
  and(): Node {
    let a = this.cmp();
    while (this.eat("&")) a = { k: "op", op: T.AND, a, b: this.cmp() };
    return a;
  }
  cmp(): Node {
    let left = this.add();
    let ops = 0;
    for (;;) {
      const sym = COMPARISONS.find((s) => this.peek(s));
      if (sym !== undefined) {
        this.i += sym.length;
        left = this.compare(anyOperatorToken(sym)!, left, this.add());
      } else if (this.keywordAhead("IN")) {
        this.i += 2;
        this.expect("[");
        const items: Node[] = [];
        if (!this.eat("]")) {
          do items.push(this.expr());
          while (this.sep());
          this.expect("]");
        }
        if (left.k !== "kw") this.fail("IN needs a keyword before it");
        left = { k: "op", op: T.IN, a: { k: "set", items }, b: left };
      } else break;
      ops++;
    }
    if (ops === 0 && left.k === "kw") return { ...left, mark: true };
    return left;
  }
  /** the word IN, at the cursor */
  keywordAhead(word: string): boolean {
    this.ws();
    const after = this.s.slice(this.i + word.length, this.i + word.length + 1);
    return this.s.slice(this.i, this.i + word.length).toUpperCase() === word && !/[A-Za-z0-9_]/.test(after);
  }
  compare(op: number, left: Node, right: Node): Node {
    if (left.k === "word" || right.k === "word") {
      const ok = (left.k === "word") !== (right.k === "word") && (left.k === "kw" || right.k === "kw");
      if (!ok) {
        // Vectorworks' criteria by type, class, symbol, name and the rest: read as words here, since no file
        // seen holds their tokens
        const word = [left, right].find((n) => n.k === "word") as { v: string };
        if (UNSETTLED_CRITERIA.has(word.v.toUpperCase())) throw new FormulaError(`criteria by ${word.v.toUpperCase()} can't be used yet: its code in the file isn't known`);
        throw new FormulaError("a bare word can only be compared with a keyword");
      }
    }
    if (op === T.EQ || op === T.NE) {
      // a string compared with keyword K0348 is written with its own token
      if (left.k === "kw" && left.id === 0x0348 && right.k === "str") right = { ...right, tok: 0x0696, ref: 0 };
      if (right.k === "kw" && right.id === 0x0348 && left.k === "str") left = { ...left, tok: 0x0696, ref: 0 };
    }
    return { k: "op", op, a: left, b: right };
  }
  add(): Node {
    let a = this.mul();
    for (;;) {
      if (this.eat("+")) a = this.arith(OP.ADD, a, this.mul());
      else if (this.eat("-")) a = this.arith(OP.SUB, a, this.mul());
      else return a;
    }
  }
  mul(): Node {
    let a = this.pow();
    for (;;) {
      if (this.eat("*")) a = this.arith(T.MUL, a, this.pow());
      else if (this.eat("/")) a = this.arith(OP.DIV, a, this.pow());
      else return a;
    }
  }
  pow(): Node {
    let a = this.unary();
    while (this.eat("^")) a = this.arith(OP.POW, a, this.unary());
    return a;
  }
  /** an arithmetic operator: a keyword or a bare word can't be a number */
  arith(op: number, a: Node, b: Node): Node {
    for (const x of [a, b]) {
      if (x.k === "word" || x.k === "kw") {
        throw new FormulaError(`"${x.k === "word" ? x.v : keywordName(x.id) ?? "a keyword"}" can't be used in arithmetic`);
      }
    }
    return { k: "op", op, a, b };
  }
  unary(): Node {
    if (this.eat("-")) return { k: "neg", a: this.unary() };
    return this.postfix();
  }
  postfix(): Node {
    let a = this.primary();
    while (this.peek("{")) {
      if (this.s.slice(this.i, this.i + 6).toUpperCase() !== "{00E4}") this.fail("an unknown suffix");
      this.i += 6;
      a = { k: "post", op: T.POST, a };
    }
    return a;
  }
  primary(): Node {
    this.ws();
    const c = this.s[this.i];
    if (c === undefined) this.fail("the formula ends too soon");
    if (c === "(") {
      this.i++;
      const a = this.expr();
      this.expect(")");
      return { k: "paren", a };
    }
    if (c === "[") this.fail("[ ] can only follow IN");
    if (c === "'") return this.quotedOperand();
    if (/[0-9]/.test(c!) || (c === "." && /[0-9]/.test(this.s[this.i + 1] ?? ""))) return this.number();
    const cell = this.cellAhead();
    if (cell) {
      if (this.s.startsWith("..", this.i)) throw new FormulaError("a range (A1..B5) can only be a function's argument");
      return cell;
    }
    const id = this.bare();
    if (!id) this.fail("an operand is expected");
    const name = id!.text;
    if (id!.wild) return { k: "word", v: name };
    const upper = name.toUpperCase();
    if (upper === "TRUE") return { k: "bool", v: true };
    if (upper === "FALSE") return { k: "bool", v: false };
    if (upper === "IN") this.fail("IN needs a keyword before it");
    if (upper === "IF") {
      this.expect("(");
      const args = this.args();
      if (args.length !== 3) throw new FormulaError("IF takes three arguments");
      return { k: "if", test: args[0]!, then: args[1]!, else: args[2]! };
    }
    if (this.peek("(")) return this.call(name, true);
    if (this.peek(".")) return this.field(name, false);
    const kw = keywordToken(name);
    if (kw !== undefined) return { k: "kw", id: kw };
    if (anyFunctionToken(name) !== undefined) return this.call(name, false);
    if (this.s[this.i] === ":") {
      this.i++;
      return this.sheet(name);
    }
    return { k: "word", v: name };
  }
  /** arguments after an opening bracket, through the closing one */
  args(): Node[] {
    if (this.eat(")")) return [];
    const out: Node[] = [];
    do out.push(this.tryRange() ?? this.expr());
    while (this.sep());
    this.expect(")");
    return out;
  }
  /** a function call: with its brackets, or a bare name (no arguments) */
  call(name: string, bracketed: boolean): Node {
    const fn = anyFunctionToken(name);
    if (fn === undefined) throw new FormulaError(`"${name}" isn't a function Rodeo knows`);
    let args: Node[] = [];
    if (bracketed) {
      this.expect("(");
      args = this.args();
    }
    // the first argument, a string with no name-table index, is an option name (0x0695)
    const first = args[0];
    if (fn > 0 && first && first.k === "str" && first.ref === 0 && first.tok === 0x065b && !NO_OPTION_STRING.has(fn)) {
      args = [{ ...first, tok: 0x0695 }, ...args.slice(1)];
    }
    return bracketed && args.length === 0 ? { k: "call", fn, args, empty: true } : { k: "call", fn, args };
  }
  quotedOperand(): Node {
    const v = this.quoted();
    const save = this.i;
    this.ws();
    if (this.s[this.i] === ".") return this.field(v, true);
    if (this.s[this.i] === ":") {
      this.i++;
      return this.sheet(v);
    }
    this.i = save;
    return { k: "str", v, ref: this.ctx.nameIndex(v), tok: 0x065b };
  }
  /** 'Sheet':C2, Sheet:C2 (relative to the formula's own cell) or 'Sheet':R[-1]C[1]: the cursor is after the colon */
  sheet(name: string): Node {
    const ref = this.ctx.nameIndex(name);
    if (ref === 0) throw new FormulaError(`"${name}" is not a worksheet in this drawing`);
    this.ws();
    const rest = this.s.slice(this.i);
    const rel = /^R\[(-?\d+)\]C\[(-?\d+)\]/.exec(rest);
    if (rel) {
      this.i += rel[0].length;
      return { k: "sheet", sheet: name, ref, dRow: Number(rel[1]), dCol: Number(rel[2]) };
    }
    const cell = /^\$?([A-Za-z]{1,3})\$?([0-9]+)(?![A-Za-z0-9_])/.exec(rest);
    if (!cell) this.fail("a cell is expected after the sheet name");
    this.i += cell![0].length;
    const at = this.ctx.at;
    if (!at) throw new FormulaError("a cell on another worksheet needs the formula's own cell");
    let col = 0;
    for (const ch of cell![1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    const row = Number(cell![2]) - 1;
    if (row < 0) throw new FormulaError("rows start at 1");
    return { k: "sheet", sheet: name, ref, dRow: row - at.row, dCol: col - 1 - at.col };
  }
  number(): Node {
    const m = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(this.s.slice(this.i));
    if (!m) this.fail("a number is expected");
    this.i += m![0].length;
    const v = Number(m![0]);
    const whole = !/[.eE]/.test(m![0]);
    if (whole && v < 2 ** 31) return { k: "int", v };
    return { k: "num", v };
  }
}

/** A bare word is only a criteria word compared with = or <> (checked on the whole tree). */
function checkWords(n: Node): void {
  const word = (w: Node & { k: "word" }): never => {
    throw new FormulaError(`"${w.v}" can't be written: a bare word needs a comparison with a keyword`);
  };
  switch (n.k) {
    case "word":
      word(n);
      return;
    case "op":
      for (const c of [n.a, n.b]) {
        if (c.k === "word" && (n.op === T.EQ || n.op === T.NE)) continue;
        checkWords(c);
      }
      return;
    case "call":
      n.args.forEach(checkWords);
      return;
    case "if":
      checkWords(n.test);
      checkWords(n.then);
      checkWords(n.else);
      return;
    case "neg":
    case "post":
    case "paren":
      checkWords(n.a);
      return;
    case "set":
      n.items.forEach(checkWords);
      return;
    default:
      return;
  }
}

/**
 * The tree for a formula's text (a leading "=" optional), in the context's name table and records. Accepts the
 * whole worksheet language: throws FormulaError only for text it cannot read (an unknown function, a bad
 * token, a field or record the drawing doesn't have: UnknownFieldError). What it can't write is for tokens.ts.
 */
export function parse(text: string, ctx: ParseContext): Node {
  const body = text.trimStart().startsWith("=") ? text.trimStart().slice(1) : text;
  const p = new Parser(body, ctx);
  const node = p.expr();
  if (!p.atEnd()) p.fail("unexpected text");
  checkWords(node);
  return node;
}
