// Worksheet formula tokens (u16 little-endian, postfix, ending 0x0690) to and from the tree in
// ast.ts. SPEC §2 and FORMAT.md §7.2 say what each token is; names.ts names them.
//
// decode reads a whole stream and throws FormulaError, with the byte offset, for anything it
// does not know. encode writes the tree back: decode then encode gives the same bytes.

import { extended } from "../worksheet.ts";
import { FormulaError, type Node, type StringToken } from "./ast.ts";
import { anyFunctionName, anyOperatorSymbol, BINARY, FUNCTIONS, KEYWORDS, hex4, TOKEN as T } from "./names.ts";
import { cellText } from "./text.ts";
import { i16, i32, u16, u32 } from "../bytes.ts";

/** An 80-bit x87 extended float as a number (a double, rounded when the mantissa has more bits). */
export function fromExtended(b: Uint8Array): number {
  if (b.length < 10) throw new FormulaError("a number is cut short");
  const dv = new DataView(b.buffer, b.byteOffset, 10);
  const mantissa = dv.getBigUint64(0, true);
  const se = dv.getUint16(8, true);
  const e = se & 0x7fff;
  if (mantissa === 0n) return 0;
  if (e === 0x7fff) throw new FormulaError("a number is infinite or not a number");
  const sign = se & 0x8000 ? -1 : 1;
  // value = mantissa * 2^(e - 16383 - 63), scaled in steps so that neither factor under- nor overflows
  let k = e - 16383 - 63;
  let r = Number(mantissa);
  while (k > 1000) {
    r *= 2 ** 1000;
    k -= 1000;
  }
  while (k < -1000) {
    r *= 2 ** -1000;
    k += 1000;
  }
  return sign * r * 2 ** k;
}

/** Stream writer: u16 tokens and their payloads, little-endian. */
class Writer {
  private buf = new Uint8Array(256);
  private n = 0;

  private room(k: number): void {
    if (this.n + k <= this.buf.length) return;
    const grown = new Uint8Array(Math.max(this.buf.length * 2, this.n + k));
    grown.set(this.buf.subarray(0, this.n));
    this.buf = grown;
  }
  u16(v: number): void {
    this.room(2);
    this.buf[this.n++] = v & 0xff;
    this.buf[this.n++] = (v >>> 8) & 0xff;
  }
  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  i16(v: number): void {
    this.u16(v & 0xffff);
  }
  i32(v: number): void {
    this.u32(v >>> 0);
  }
  bytes(b: Uint8Array): void {
    this.room(b.length);
    this.buf.set(b, this.n);
    this.n += b.length;
  }
  /** UTF-16 code units then a zero unit: the string's own units, so any string round-trips. */
  utf16z(s: string): void {
    this.room(2 * s.length + 2);
    for (let i = 0; i < s.length; i++) this.u16(s.charCodeAt(i));
    this.u16(0);
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

type Entry = { k: "node"; n: Node } | { k: "fn"; fn: number } | { k: "set"; mark: boolean };

/** Reads one whole stream (through its 0x0690) into a tree. */
export function decode(bytes: Uint8Array): Node {
  const len = bytes.length;
  const stack: Entry[] = [];
  let off = 0;
  let mark = false;

  const fail: (msg: string, at: number) => never = (msg, at) => {
    throw new FormulaError(`${msg} at byte ${at}`);
  };
  const need = (k: number, at: number): void => {
    if (at + k > len) fail("the stream ends inside a token", at);
  };
  /** a zero-terminated UTF-16 string at `at`: its text and the offset after it */
  const text = (at: number): [string, number] => {
    let p = at;
    let s = "";
    for (;;) {
      if (p + 2 > len) fail("a string has no terminator", at);
      const c = u16(bytes, p);
      p += 2;
      if (c === 0) return [s, p];
      s += String.fromCharCode(c);
    }
  };
  const push = (n: Node): void => {
    stack.push({ k: "node", n });
  };
  const takeMark = (): boolean => {
    const m = mark;
    mark = false;
    return m;
  };
  const pop = (at: number): Node => {
    const e = stack.pop();
    if (!e || e.k !== "node") fail("an operator has no operand", at);
    return e.n;
  };

  for (;;) {
    if (off + 2 > len) fail("the stream has no end token", off);
    const at = off;
    const t = u16(bytes, off);
    off += 2;
    if (t === T.END) {
      if (off !== len) fail("bytes follow the end token", at);
      if (mark) fail("0x0296 has nothing after it", at);
      if (stack.length !== 1 || stack[0]!.k !== "node") fail("the stream does not reduce to one formula", at);
      return (stack[0] as { n: Node }).n;
    }
    if (FUNCTIONS.has(t)) {
      if (off + 2 <= len && u16(bytes, off) === T.NO_ARGS) {
        off += 2;
        push({ k: "call", fn: t, args: [] });
      } else {
        stack.push({ k: "fn", fn: t });
      }
      continue;
    }
    if (KEYWORDS.has(t)) {
      const m = takeMark();
      push(m ? { k: "kw", id: t, mark: true } : { k: "kw", id: t });
      continue;
    }
    switch (t) {
      case T.NUMBER:
        need(10, off);
        push({ k: "num", v: fromExtended(bytes.subarray(off, off + 10)) });
        off += 10;
        break;
      case T.INT:
        need(4, off);
        push({ k: "int", v: i32(bytes, off) });
        off += 4;
        break;
      case T.STRING:
      case T.OPTION_STRING:
      case T.KEYWORD_STRING: {
        need(4, off);
        const ref = u32(bytes, off);
        const [v, next] = text(off + 4);
        off = next;
        push({ k: "str", v, ref, tok: t as StringToken });
        break;
      }
      case T.WORD: {
        const [v, next] = text(off);
        off = next;
        push({ k: "word", v });
        break;
      }
      case T.TRUE:
        push({ k: "bool", v: true });
        break;
      case T.RECORD:
      case T.RECORD_QUOTED: {
        need(4, off);
        const recRef = u32(bytes, off);
        const [rec, after] = text(off + 4);
        off = after;
        need(4, off);
        const fieldTok = u16(bytes, off);
        if (fieldTok !== T.FIELD && fieldTok !== T.FIELD_QUOTED) fail("a record name is not followed by a field name", off);
        const type = u16(bytes, off + 2);
        const offset = u16(bytes, off + 4);
        const [field, next] = text(off + 6);
        off = next;
        push({
          k: "field",
          rec,
          recRef,
          recQuoted: t === T.RECORD_QUOTED,
          field,
          type,
          offset,
          fieldQuoted: fieldTok === T.FIELD_QUOTED,
        });
        break;
      }
      case T.FIELD:
      case T.FIELD_QUOTED:
        fail("a field name has no record name before it", at);
        break;
      case T.SHEET: {
        need(4, off);
        const ref = u32(bytes, off);
        const [sheet, after] = text(off + 4);
        off = after;
        need(4, off);
        const dRow = i16(bytes, off);
        const dCol = i16(bytes, off + 2);
        off += 4;
        push({ k: "sheet", sheet, ref, dRow, dCol });
        break;
      }
      case T.MARK:
        mark = true;
        break;
      case T.SET:
        stack.push({ k: "set", mark: takeMark() });
        break;
      case T.IN: {
        const b = pop(at);
        if (b.k !== "kw") fail("IN has no keyword before it", at);
        const items: Node[] = [];
        let setMark = false;
        for (;;) {
          const e = stack.pop();
          if (!e) fail("IN has no set before it", at);
          if (e.k === "set") {
            setMark = e.mark;
            break;
          }
          if (e.k !== "node") fail("IN's set holds a function", at);
          items.unshift((e as { n: Node }).n);
        }
        const set: Node = setMark ? { k: "set", items, mark: true } : { k: "set", items };
        push({ k: "op", op: T.IN, a: set, b: b as Node });
        break;
      }
      case T.ARGS: {
        let i = stack.length - 1;
        while (i >= 0 && stack[i]!.k === "node") i--;
        const fn = stack[i];
        if (!fn || fn.k !== "fn") fail("0x02a5 has no function to close", at);
        const args: Node[] = [];
        for (let j = i + 1; j < stack.length; j++) args.push((stack[j] as { n: Node }).n);
        stack.length = i;
        push(args.length ? { k: "call", fn: (fn as { fn: number }).fn, args } : { k: "call", fn: (fn as { fn: number }).fn, args, empty: true });
        break;
      }
      case T.NO_ARGS:
        fail("0x02a6 does not follow a function name", at);
        break;
      case T.PAREN:
        push({ k: "paren", a: pop(at) });
        break;
      case T.POST:
        push({ k: "post", op: T.POST, a: pop(at) });
        break;
      case T.IF: {
        const els = pop(at);
        const thn = pop(at);
        const test = pop(at);
        push({ k: "if", test, then: thn, else: els });
        break;
      }
      default:
        if (BINARY.has(t)) {
          const b = pop(at);
          const a = pop(at);
          push({ k: "op", op: t, a, b });
          break;
        }
        fail(`token 0x${hex4(t)} is not one the formula reader knows`, at);
    }
  }
}

/**
 * What in the tree no token is known for, named in plain words, or null when the whole tree can be written.
 * Looks at the parts in the order encode writes them, so the message names the first one it meets.
 */
export function unwritable(node: Node): string | null {
  const no = (what: string): string => `${what} can't be saved as a Vectorworks formula yet (its token isn't known)`;
  const all = (ns: readonly Node[]): string | null => {
    for (const n of ns) {
      const why = unwritable(n);
      if (why !== null) return why;
    }
    return null;
  };
  switch (node.k) {
    case "num":
      return Number.isFinite(node.v) ? null : "a number that is infinite or not a number can't be saved as a Vectorworks formula";
    case "int":
      return Number.isInteger(node.v) && node.v >= -(2 ** 31) && node.v < 2 ** 31
        ? null
        : "a whole number out of range can't be saved as a Vectorworks formula";
    case "str":
    case "word":
    case "field":
    case "sheet":
      return null;
    case "bool":
      return node.v ? null : no(`"FALSE"`);
    case "kw":
      return KEYWORDS.has(node.id) ? null : no(`the keyword 0x${hex4(node.id)}`);
    case "cell":
      return no(`"${cellText(node.row, node.col, node.absRow, node.absCol)}"`);
    case "range":
      return no(`"${cellText(node.a.row, node.a.col, node.a.absRow, node.a.absCol)}..${cellText(node.b.row, node.b.col, node.b.absRow, node.b.absCol)}"`);
    case "neg":
      return no(`"-" (negation)`);
    case "if":
      return all([node.test, node.then, node.else]);
    case "op": {
      const operands = all([node.a, node.b]);
      if (operands !== null || node.op === T.IN) return operands;
      if (!BINARY.has(node.op)) return no(`"${anyOperatorSymbol(node.op) ?? `token 0x${hex4(node.op)}`}"`);
      return null;
    }
    case "post":
    case "paren":
      return unwritable(node.a);
    case "set":
      return all(node.items);
    case "call":
      if (!FUNCTIONS.has(node.fn)) return no(`"${anyFunctionName(node.fn) ?? `function 0x${hex4(node.fn)}`}"`);
      return all(node.args);
  }
}

/** Writes a tree as its stream, ending 0x0690. Throws FormulaError, naming the part, for what has no token (unwritable). */
export function encode(node: Node): Uint8Array {
  const why = unwritable(node);
  if (why !== null) throw new FormulaError(why);
  const w = new Writer();
  emit(w, node);
  w.u16(T.END);
  return w.finish();
}

function emit(w: Writer, n: Node): void {
  switch (n.k) {
    case "neg":
    case "cell":
    case "range":
      throw new FormulaError(unwritable(n) ?? "a part of the formula can't be saved yet");
    case "num":
      if (!Number.isFinite(n.v)) throw new FormulaError("a number is infinite or not a number");
      w.u16(T.NUMBER);
      w.bytes(extended(n.v));
      return;
    case "int":
      if (!Number.isInteger(n.v) || n.v < -(2 ** 31) || n.v >= 2 ** 31) throw new FormulaError("a whole number is out of range");
      w.u16(T.INT);
      w.i32(n.v);
      return;
    case "str":
      w.u16(n.tok);
      w.u32(n.ref);
      w.utf16z(n.v);
      return;
    case "word":
      w.u16(T.WORD);
      w.utf16z(n.v);
      return;
    case "bool":
      if (!n.v) throw new FormulaError(unwritable(n) ?? "FALSE can't be saved yet");
      w.u16(T.TRUE);
      return;
    case "field":
      w.u16(n.recQuoted ? T.RECORD_QUOTED : T.RECORD);
      w.u32(n.recRef);
      w.utf16z(n.rec);
      w.u16(n.fieldQuoted ? T.FIELD_QUOTED : T.FIELD);
      w.u16(n.type);
      w.u16(n.offset);
      w.utf16z(n.field);
      return;
    case "sheet":
      w.u16(T.SHEET);
      w.u32(n.ref);
      w.utf16z(n.sheet);
      w.i16(n.dRow);
      w.i16(n.dCol);
      return;
    case "call":
      if (!FUNCTIONS.has(n.fn)) throw new FormulaError(`function token 0x${hex4(n.fn)} can't be written yet: its token isn't known`);
      w.u16(n.fn);
      if (n.args.length === 0 && !n.empty) {
        w.u16(T.NO_ARGS);
        return;
      }
      for (const a of n.args) emit(w, a);
      w.u16(T.ARGS);
      return;
    case "if":
      emit(w, n.test);
      emit(w, n.then);
      emit(w, n.else);
      w.u16(T.IF);
      return;
    case "op":
      if (n.op === T.IN) {
        if (n.a.k !== "set" || n.b.k !== "kw") throw new FormulaError("IN is a set and a keyword");
        emit(w, n.a);
        emit(w, n.b);
        w.u16(T.IN);
        return;
      }
      if (!BINARY.has(n.op)) throw new FormulaError(`operator token 0x${hex4(n.op)} can't be written yet: its token isn't known`);
      emit(w, n.a);
      emit(w, n.b);
      w.u16(n.op);
      return;
    case "post":
      emit(w, n.a);
      w.u16(T.POST);
      return;
    case "paren":
      emit(w, n.a);
      w.u16(T.PAREN);
      return;
    case "set":
      if (n.mark) w.u16(T.MARK);
      w.u16(T.SET);
      for (const it of n.items) emit(w, it);
      return;
    case "kw":
      if (!KEYWORDS.has(n.id)) throw new FormulaError(`keyword token 0x${hex4(n.id)} can't be written yet: its token isn't known`);
      if (n.mark) w.u16(T.MARK);
      w.u16(n.id);
      return;
  }
}
