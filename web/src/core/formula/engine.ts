// Works out a worksheet formula's value from its tree (ast.ts). It knows nothing of the drawing:
// what a formula reads of it (other cells, an object's record fields, its area) comes through the
// Env it is given, which database.ts builds for a database row's objects and the worksheet
// recalculation builds for plain cells (evaluateSheet below does a whole worksheet).
//
// Errors are values, as a worksheet shows them: an error in an operand is the result. The texts are
// Vectorworks': #VALUE!, #DIV 0!, #NAME? (no such record field), #CVAL? (a cell that depends on itself),
// #OPCODE? (Rodeo has no rule for it).

import { isError, type Node, type Value } from "./ast.ts";
import { anyFunctionName, anyOperatorSymbol, FN, hex4, keywordName, OP, TOKEN as T, UNSETTLED_FUNCTIONS } from "./names.ts";

/** What a database column formula reads of the one object (or, summarized, the objects) of its subrow. */
export interface ObjectAccess {
  /** 'Record'.'Field' of the object: undefined when it has no such record or field */
  field(rec: string, field: string): Value | undefined;
  /** how many objects the subrow stands for (=COUNT) */
  readonly count: number;
  /** a function of the object (AREA, LENGTH, OBJECTTYPE…) by its token id with its arguments worked out; undefined when it isn't known for this object */
  call(fn: number, args: readonly Value[]): Value | undefined;
}

export interface Env {
  /** a cell of the same worksheet, 0-based; absent where there is none to read */
  cell?(row: number, col: number): Value;
  /** another worksheet's cell by the worksheet's name, 0-based */
  sheetCell?(sheet: string, row: number, col: number): Value;
  /** the row and column of the cell holding the formula, 0-based (a sheet reference is kept relative to it) */
  at?: { readonly row: number; readonly col: number };
  /** the object a database column formula is worked out for; absent in a plain cell */
  object?: ObjectAccess;
  /** a function over objects chosen by criteria in a plain cell (=COUNT(criteria), =AREA(criteria)); undefined when not known */
  criteriaCall?(fn: number, args: readonly Node[]): Value | undefined;
}

/** Whether a settled function (or the post token 0x00e4) is worked out where the formula is: the object or criteria provider's answer. */
export type Provides = (fn: number, where: "cell" | "column") => boolean;

export const ERRORS = {
  VALUE: "#VALUE!",
  DIV0: "#DIV 0!",
  NAME: "#NAME?",
  CVAL: "#CVAL?",
  OPCODE: "#OPCODE?",
} as const;

const DATABASE = 0x029a;
const CONCAT = 0x00f3;
const POST = 0x00e4;
const AGGREGATES: ReadonlySet<number> = new Set([FN.SUM, FN.AVERAGE, FN.MIN, FN.MAX]);
const KNOWN_OPERATORS: ReadonlySet<number> = new Set([
  T.EQ,
  T.NE,
  T.AND,
  T.OR,
  T.MUL,
  OP.ADD,
  OP.SUB,
  OP.DIV,
  OP.POW,
  OP.LT,
  OP.GT,
  OP.LE,
  OP.GE,
]);

const err = (e: string): Value => ({ error: e });

/** a number from a value: null counts as 0, a text that reads as a number is that number, anything else is not a number (null result) */
function numberOf(v: Value): number | null {
  if (typeof v === "number") return v;
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const t = v.trim();
    if (!/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(t)) return null;
    return Number(t);
  }
  return null;
}

/** a value as text: null is "", a number its shortest decimal text, a truth value TRUE or FALSE */
function textOf(v: Value): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return "";
}

/** a value as a truth value, or null when it has none: a number is true when not 0; null is false */
function truthOf(v: Value): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === null) return false;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const u = v.trim().toUpperCase();
    if (u === "TRUE") return true;
    if (u === "FALSE") return false;
    const n = numberOf(v);
    return n === null ? null : n !== 0;
  }
  return null;
}

/** -1, 0 or 1: numbers by value where both read as numbers, otherwise texts case-insensitively */
function compareValues(a: Value, b: Value): number {
  if (!(typeof a === "string" && typeof b === "string")) {
    const x = numberOf(a);
    const y = numberOf(b);
    if (x !== null && y !== null) return x < y ? -1 : x > y ? 1 : 0;
  }
  const s = textOf(a).toUpperCase();
  const t = textOf(b).toUpperCase();
  return s < t ? -1 : s > t ? 1 : 0;
}

/** a criteria word's pattern (* any run, ? one character) matched against text, case-insensitively, the whole text */
function wildcardMatch(pattern: string, text: string): boolean {
  let re = "^";
  for (const ch of pattern) {
    if (ch === "*") re += "[\\s\\S]*";
    else if (ch === "?") re += "[\\s\\S]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${re}$`, "i").test(text);
}

function wordText(n: Node): string | null {
  return n.k === "word" ? n.v : null;
}

/** + - * / ^ on two values: text that reads as a number counts as that number */
function arith(op: number, a: Value, b: Value): Value {
  const x = numberOf(a);
  const y = numberOf(b);
  if (x === null || y === null) return err(ERRORS.VALUE);
  let r: number;
  switch (op) {
    case OP.ADD:
      r = x + y;
      break;
    case OP.SUB:
      r = x - y;
      break;
    case T.MUL:
      r = x * y;
      break;
    case OP.DIV:
      if (y === 0) return err(ERRORS.DIV0);
      r = x / y;
      break;
    case OP.POW:
      if (x === 0 && y < 0) return err(ERRORS.DIV0);
      r = x ** y;
      break;
    default:
      return err(ERRORS.OPCODE);
  }
  return Number.isFinite(r) ? r : err(ERRORS.VALUE);
}

/** The value of `node`. Errors are values ({ error: "#VALUE!" }), as a worksheet shows them; it never throws for a formula's own faults. */
export function evaluate(node: Node, env: Env): Value {
  switch (node.k) {
    case "num":
    case "int":
    case "str":
    case "bool":
      return node.v;
    case "word":
      return err(ERRORS.NAME);
    case "paren":
      return evaluate(node.a, env);
    case "field": {
      if (!env.object) return err(ERRORS.OPCODE);
      const v = env.object.field(node.rec, node.field);
      return v === undefined ? err(ERRORS.NAME) : v;
    }
    case "cell":
      return env.cell ? env.cell(node.row, node.col) : err(ERRORS.OPCODE);
    case "sheet": {
      if (!env.sheetCell || !env.at) return err(ERRORS.OPCODE);
      const row = env.at.row + node.dRow;
      const col = env.at.col + node.dCol;
      if (row < 0 || col < 0) return err(ERRORS.VALUE);
      return env.sheetCell(node.sheet, row, col);
    }
    case "range":
      return err(ERRORS.VALUE);
    case "neg": {
      const v = evaluate(node.a, env);
      if (isError(v)) return v;
      const x = numberOf(v);
      return x === null ? err(ERRORS.VALUE) : 0 - x;
    }
    case "if": {
      const t = evaluate(node.test, env);
      if (isError(t)) return t;
      const b = truthOf(t);
      if (b === null) return err(ERRORS.VALUE);
      return evaluate(b ? node.then : node.else, env);
    }
    case "set":
    case "kw":
      return err(ERRORS.OPCODE);
    case "post": {
      const a = evaluate(node.a, env);
      if (isError(a)) return a;
      const r = env.object?.call(POST, [a]);
      return r === undefined ? err(ERRORS.OPCODE) : r;
    }
    case "op":
      return evalOp(node, env);
    case "call":
      return evalCall(node, env);
  }
}

function evalOp(node: Extract<Node, { k: "op" }>, env: Env): Value {
  if (node.op === T.IN) return err(ERRORS.OPCODE);
  if (node.op === T.EQ || node.op === T.NE) {
    const pattern = wordText(node.a) ?? wordText(node.b);
    if (pattern !== null) {
      const other = wordText(node.a) !== null ? node.b : node.a;
      const v = evaluate(other, env);
      if (isError(v)) return v;
      const hit = wildcardMatch(pattern, textOf(v));
      return node.op === T.EQ ? hit : !hit;
    }
  }
  const a = evaluate(node.a, env);
  if (isError(a)) return a;
  const b = evaluate(node.b, env);
  if (isError(b)) return b;
  switch (node.op) {
    case T.AND:
    case T.OR: {
      const x = truthOf(a);
      const y = truthOf(b);
      if (x === null || y === null) return err(ERRORS.VALUE);
      return node.op === T.AND ? x && y : x || y;
    }
    case T.EQ:
      return compareValues(a, b) === 0;
    case T.NE:
      return compareValues(a, b) !== 0;
    case OP.LT:
      return compareValues(a, b) < 0;
    case OP.GT:
      return compareValues(a, b) > 0;
    case OP.LE:
      return compareValues(a, b) <= 0;
    case OP.GE:
      return compareValues(a, b) >= 0;
    case T.MUL:
    case OP.ADD:
    case OP.SUB:
    case OP.DIV:
    case OP.POW:
      return arith(node.op, a, b);
    default:
      return err(ERRORS.OPCODE);
  }
}

function evalCall(node: Extract<Node, { k: "call" }>, env: Env): Value {
  if (node.fn === DATABASE) return err(ERRORS.OPCODE);
  if (node.fn === CONCAT) return concat(node.args, env);
  if (node.fn > 0) {
    if (env.object) {
      const vals: Value[] = [];
      for (const a of node.args) {
        const v = evaluate(a, env);
        if (isError(v)) return v;
        vals.push(v);
      }
      const r = env.object.call(node.fn, vals);
      return r === undefined ? err(ERRORS.OPCODE) : r;
    }
    const r = env.criteriaCall?.(node.fn, node.args);
    return r === undefined ? err(ERRORS.OPCODE) : r;
  }
  return unsettledCall(node.fn, node.args, env);
}

function concat(args: readonly Node[], env: Env): Value {
  let out = "";
  for (const a of args) {
    const v = evaluate(a, env);
    if (isError(v)) return v;
    out += textOf(v);
  }
  return out;
}

/** SUM, AVERAGE, MIN, MAX: over numbers, ranges (whose nulls and text are skipped) and nested values */
function aggregate(fn: number, args: readonly Node[], env: Env): Value {
  const nums: number[] = [];
  for (const a of args) {
    if (a.k === "range") {
      if (!env.cell) return err(ERRORS.OPCODE);
      const r0 = Math.min(a.a.row, a.b.row);
      const r1 = Math.max(a.a.row, a.b.row);
      const c0 = Math.min(a.a.col, a.b.col);
      const c1 = Math.max(a.a.col, a.b.col);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const v = env.cell(r, c);
          if (isError(v)) return v;
          if (typeof v === "number") nums.push(v);
        }
      }
    } else {
      const v = evaluate(a, env);
      if (isError(v)) return v;
      const x = numberOf(v);
      if (x === null) return err(ERRORS.VALUE);
      nums.push(x);
    }
  }
  switch (fn) {
    case FN.SUM: {
      const total = nums.reduce((s, x) => s + x, 0);
      return Number.isFinite(total) ? total : err(ERRORS.VALUE);
    }
    case FN.AVERAGE: {
      if (nums.length === 0) return err(ERRORS.DIV0);
      const mean = nums.reduce((s, x) => s + x, 0) / nums.length;
      return Number.isFinite(mean) ? mean : err(ERRORS.VALUE);
    }
    case FN.MIN:
      return nums.length === 0 ? 0 : nums.reduce((m, x) => Math.min(m, x));
    case FN.MAX:
      return nums.length === 0 ? 0 : nums.reduce((m, x) => Math.max(m, x));
    default:
      return err(ERRORS.OPCODE);
  }
}

/** ROUND(number) or ROUND(number, places): to the nearest, halves away from zero */
function round(vals: readonly Value[]): Value {
  if (vals.length < 1 || vals.length > 2) return err(ERRORS.VALUE);
  const x = numberOf(vals[0]!);
  const places = vals.length === 2 ? numberOf(vals[1]!) : 0;
  if (x === null || places === null) return err(ERRORS.VALUE);
  const f = 10 ** Math.trunc(places);
  const r = (Math.sign(x) * Math.round(Math.abs(x) * f)) / f;
  return Number.isFinite(r) ? r : err(ERRORS.VALUE);
}

/** SUBSTRING(text, delimiter, index): the index-th part (from 1) of text split at the delimiter; "" past the end */
function substring(vals: readonly Value[]): Value {
  if (vals.length !== 3) return err(ERRORS.VALUE);
  const text = textOf(vals[0]!);
  const delim = textOf(vals[1]!);
  const index = numberOf(vals[2]!);
  if (index === null || !Number.isInteger(index) || index < 1 || delim === "") return err(ERRORS.VALUE);
  return text.split(delim)[index - 1] ?? "";
}

/** the functions with negative ids (names.ts), over their argument values */
function unsettledCall(fn: number, args: readonly Node[], env: Env): Value {
  if (AGGREGATES.has(fn)) return aggregate(fn, args, env);
  const vals: Value[] = [];
  for (const a of args) {
    const v = evaluate(a, env);
    if (isError(v)) return v;
    vals.push(v);
  }
  const one = (f: (x: number) => number, ok: (x: number) => boolean = () => true): Value => {
    if (vals.length !== 1) return err(ERRORS.VALUE);
    const x = numberOf(vals[0]!);
    if (x === null || !ok(x)) return err(ERRORS.VALUE);
    const r = f(x);
    return Number.isFinite(r) ? r : err(ERRORS.VALUE);
  };
  switch (fn) {
    case FN.ABS:
      return one(Math.abs);
    case FN.INT:
      return one(Math.trunc);
    case FN.ROUND:
      return round(vals);
    case FN.SQRT:
      return one(Math.sqrt, (x) => x >= 0);
    case FN.SIN:
      return one(Math.sin);
    case FN.COS:
      return one(Math.cos);
    case FN.TAN:
      return one(Math.tan);
    case FN.ASIN:
      return one(Math.asin, (x) => x >= -1 && x <= 1);
    case FN.ACOS:
      return one(Math.acos, (x) => x >= -1 && x <= 1);
    case FN.ATAN:
      return one(Math.atan);
    case FN.DEG2RAD:
      return one((x) => (x * Math.PI) / 180);
    case FN.RAD2DEG:
      return one((x) => (x * 180) / Math.PI);
    case FN.EXP:
      return one(Math.exp);
    case FN.LN:
      return one(Math.log, (x) => x > 0);
    case FN.LOG:
      return one(Math.log10, (x) => x > 0);
    case FN.VALUE: {
      if (vals.length !== 1 || typeof vals[0] === "boolean") return err(ERRORS.VALUE);
      const n = numberOf(vals[0]!);
      return n === null ? err(ERRORS.VALUE) : n;
    }
    case FN.SUBSTRING:
      return substring(vals);
    default:
      return err(ERRORS.OPCODE);
  }
}

/**
 * Why the engine doesn't work `node` out, or null when it does (every token in it is one whose meaning is
 * settled and that this file computes). A formula it doesn't work out keeps the value the file holds.
 * `provides` says whether the object or criteria provider works out a settled function (or the post token
 * 0x00e4) in `where`; without it, every settled function is unsupported. A record field is supported in a
 * database column and not in a plain cell.
 */
export function unsupported(node: Node, where: "cell" | "column", provides?: Provides): string | null {
  const sub = (x: Node): string | null => unsupported(x, where, provides);
  switch (node.k) {
    case "num":
    case "int":
    case "str":
    case "bool":
    case "cell":
    case "sheet":
      return null;
    case "word":
      return `"${node.v}" is a bare word: it is only worked out beside = or <>`;
    case "field":
      return where === "cell" ? "a record field needs a database row" : null;
    case "range":
      return "a range is only worked out as an argument of SUM, AVERAGE, MIN or MAX";
    case "neg":
    case "paren":
      return sub(node.a);
    case "if":
      return sub(node.test) ?? sub(node.then) ?? sub(node.else);
    case "set":
      return "a criteria set (R IN […]) isn't worked out here";
    case "kw":
      return `${keywordName(node.id) ?? "a keyword"} is a criteria keyword and isn't worked out here`;
    case "post":
      if (!provides?.(POST, where)) return "the {00E4} after an area field isn't worked out by Rodeo yet";
      return sub(node.a);
    case "op": {
      if (node.op === T.IN) return "IN isn't worked out by Rodeo yet";
      if (!KNOWN_OPERATORS.has(node.op)) {
        return `the operator ${anyOperatorSymbol(node.op) ?? `0x${hex4(node.op)}`} isn't worked out by Rodeo yet`;
      }
      const wordOk = node.op === T.EQ || node.op === T.NE;
      for (const x of [node.a, node.b]) {
        if (wordOk && x.k === "word") continue;
        const r = sub(x);
        if (r !== null) return r;
      }
      return null;
    }
    case "call": {
      if (node.fn === DATABASE) return "DATABASE isn't worked out by Rodeo yet";
      if (node.fn === CONCAT) return firstReason(node.args.map(sub));
      if (node.fn > 0) {
        if (provides?.(node.fn, where)) return null;
        return `${anyFunctionName(node.fn) ?? `function 0x${hex4(node.fn)}`} isn't worked out by Rodeo yet`;
      }
      if (!UNSETTLED_FUNCTIONS.has(node.fn)) return `function 0x${hex4(node.fn)} isn't worked out by Rodeo yet`;
      const range = AGGREGATES.has(node.fn);
      return firstReason(node.args.map((x) => (range && x.k === "range" ? null : sub(x))));
    }
  }
}

function firstReason(reasons: readonly (string | null)[]): string | null {
  for (const r of reasons) if (r !== null) return r;
  return null;
}

/**
 * Every formula cell of one worksheet, worked out: `cells` maps "row,col" (0-based) to a formula's tree,
 * `base` gives the value of any other cell, and `envFor` the object or criteria access of a formula cell.
 * A reference to another formula cell takes that cell's result. A cycle gives #CVAL? to the cells that
 * take part in it (and to any cell that reads one of them).
 */
export function evaluateSheet(
  cells: ReadonlyMap<string, Node>,
  base: (row: number, col: number) => Value,
  envFor: (row: number, col: number) => Omit<Env, "cell" | "at">,
): Map<string, Value> {
  const done = new Map<string, Value>();
  const active = new Set<string>();
  const valueAt = (row: number, col: number): Value => {
    const key = `${row},${col}`;
    const known = done.get(key);
    if (known !== undefined) return known;
    const node = cells.get(key);
    if (node === undefined) return base(row, col);
    if (active.has(key)) return err(ERRORS.CVAL);
    active.add(key);
    const v = evaluate(node, { ...envFor(row, col), cell: valueAt, at: { row, col } });
    active.delete(key);
    done.set(key, v);
    return v;
  };
  for (const key of cells.keys()) {
    const [row, col] = key.split(",").map(Number) as [number, number];
    valueAt(row, col);
  }
  return done;
}
