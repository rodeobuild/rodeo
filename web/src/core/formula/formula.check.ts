// Checks the worksheet formula reader and writer (tokens.ts, text.ts) on hand-written streams.
// Run from web/:  npx tsx src/core/formula/formula.check.ts
// The streams are the worked examples of SPEC §2, with fake name-table indexes; nothing from a
// drawing is in here.

import { isDeepStrictEqual } from "node:util";
import { extended } from "../worksheet.ts";
import { FormulaError, type Node } from "./ast.ts";
import { decode, encode, unwritable } from "./tokens.ts";
import { type ParseContext, parse, toText, UnknownFieldError } from "./text.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// ---- building streams ----
type Part = number[];
const tok = (id: number): Part => [id & 0xff, (id >> 8) & 0xff];
const u16 = (n: number): Part => [n & 0xff, (n >> 8) & 0xff];
const u32 = (n: number): Part => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
const i16 = (n: number): Part => u16(n & 0xffff);
const i32 = (n: number): Part => u32(n >>> 0);
const z = (s: string): Part => {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(...u16(s.charCodeAt(i)));
  return [...out, 0, 0];
};
const ext = (v: number): Part => [...extended(v)];
const stream = (...parts: Part[]): Uint8Array => Uint8Array.from(parts.flat());
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

// fake name table: the spec's Door index, and others picked here
const NAMES = new Map<string, number>([
  ["Door", 619],
  ["Space_Finish", 700],
  ["FramingMember", 701],
  ["Space", 702],
  ["Square Footage", 703],
  ["Appliance", 704],
  ["Appliance Schedule", 705],
]);
const FIELDS = new Map<string, Map<string, { type: number; offset: number }>>([
  [
    "Door",
    new Map([
      ["OnSched", { type: 2, offset: 0x102 }],
      ["JambWidth", { type: 7, offset: 0x92 }],
      ["IDPrefix", { type: 4, offset: 0x104 }],
      ["DoorMaterial", { type: 4, offset: 0x60e }],
    ]),
  ],
  ["FramingMember", new Map([["quantityLabel", { type: 4, offset: 0x124 }]])],
  ["Space", new Map([["Area", { type: 21, offset: 0x40 }]])],
  [
    "Space_Finish",
    new Map([
      ["UnitCost", { type: 3, offset: 0x50 }],
      ["NetArea", { type: 3, offset: 0x58 }],
    ]),
  ],
]);
const ctx: ParseContext = {
  nameIndex: (n) => NAMES.get(n) ?? 0,
  field: (rec, f) => FIELDS.get(rec)?.get(f) ?? null,
};

// ---- the spec's examples ----
const DB = tok(0x029a);
const END = tok(0x0690);

// =DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))
const e1 = stream(DB, tok(0x0661), tok(0x065b), u32(619), z("Door"), tok(0x0308), tok(0x0641), tok(0x0665),
  tok(0x029d), u32(619), z("Door"), tok(0x029f), u16(2), u16(0x102), z("OnSched"), tok(0x0291), tok(0x0647), tok(0x0665),
  tok(0x064f), tok(0x0665), tok(0x02a5), END);
const e1Tree: Node = {
  k: "call", fn: 0x029a, args: [{ k: "paren", a: {
    k: "op", op: 0x064f,
    a: { k: "paren", a: { k: "op", op: 0x0641, a: { k: "set", items: [{ k: "str", v: "Door", ref: 619, tok: 0x065b }] }, b: { k: "kw", id: 0x0308 } } },
    b: { k: "paren", a: { k: "op", op: 0x0647,
      a: { k: "field", rec: "Door", recRef: 619, recQuoted: true, field: "OnSched", type: 2, offset: 0x102, fieldQuoted: true },
      b: { k: "bool", v: true } } },
  } }],
};

// =DATABASE(NOTINDLVP & NOTINREFDLVP & (PON='Space')): the 0x0296 before PON is the oddity
const e2 = stream(DB, tok(0x0296), tok(0x031e), tok(0x0296), tok(0x0319), tok(0x064f), tok(0x0296), tok(0x0328),
  tok(0x065b), u32(702), z("Space"), tok(0x0647), tok(0x0665), tok(0x064f), tok(0x02a5), END);

// =DATABASE((R IN ['FramingMember'])): 0x0296 before the set, the oddity again
const e3 = stream(DB, tok(0x0296), tok(0x0661), tok(0x065b), u32(701), z("FramingMember"), tok(0x0308), tok(0x0641), tok(0x0665),
  tok(0x02a5), END);

// ='Door'.'DoorMaterial'
const e4 = stream(tok(0x029d), u32(619), z("Door"), tok(0x029f), u16(4), u16(0x60e), z("DoorMaterial"), END);

// =(Door.IDPrefix)
const e5 = stream(tok(0x029c), u32(619), z("Door"), tok(0x029e), u16(4), u16(0x104), z("IDPrefix"), tok(0x0665), END);

// =('FramingMember'.quantityLabel)
const e6 = stream(tok(0x029d), u32(701), z("FramingMember"), tok(0x029e), u16(4), u16(0x124), z("quantityLabel"), tok(0x0665), END);

// =COUNT
const e7 = stream(tok(0x02c7), tok(0x02a6), END);

// =AREA('gross')
const e8 = stream(tok(0x02e8), tok(0x0695), u32(0), z("gross"), tok(0x02a5), END);

// =IF('Door'.'JambWidth'=0, 'N/A', 'Door'.'JambWidth')
const e9 = stream(tok(0x029d), u32(619), z("Door"), tok(0x029f), u16(7), u16(0x92), z("JambWidth"), tok(0x0295), i32(0),
  tok(0x0647), tok(0x065b), u32(0), z("N/A"), tok(0x029d), u32(619), z("Door"), tok(0x029f), u16(7), u16(0x92), z("JambWidth"),
  tok(0x0682), END);
const e9Tree: Node = {
  k: "if",
  test: { k: "op", op: 0x0647,
    a: { k: "field", rec: "Door", recRef: 619, recQuoted: true, field: "JambWidth", type: 7, offset: 0x92, fieldQuoted: true },
    b: { k: "int", v: 0 } },
  then: { k: "str", v: "N/A", ref: 0, tok: 0x065b },
  else: { k: "field", rec: "Door", recRef: 619, recQuoted: true, field: "JambWidth", type: 7, offset: 0x92, fieldQuoted: true },
};

// =OBJECTDATA('finish', 'FinishKey', ', ', 'floor')
const e10 = stream(tok(0x01e8), tok(0x0695), u32(0), z("finish"), tok(0x065b), u32(0), z("FinishKey"), tok(0x065b), u32(0), z(", "),
  tok(0x065b), u32(0), z("floor"), tok(0x02a5), END);

// ='Space_Finish'.'UnitCost'*'Space_Finish'.'NetArea'
const e11 = stream(tok(0x029d), u32(700), z("Space_Finish"), tok(0x029f), u16(3), u16(0x50), z("UnitCost"),
  tok(0x029d), u32(700), z("Space_Finish"), tok(0x029f), u16(3), u16(0x58), z("NetArea"), tok(0x0654), END);

// ='Space'.'Area' {00E4}
const e12 = stream(tok(0x029d), u32(702), z("Space"), tok(0x029f), u16(21), u16(0x40), z("Area"), tok(0x00e4), END);

// ='Square Footage':C2 in B3 (one row up, one column right)
const e13 = stream(tok(0x0299), u32(703), z("Square Footage"), i16(-1), i16(1), END);

// =DATABASE(L='1-Spaces')
const e14 = stream(DB, tok(0x0305), tok(0x065b), u32(0), z("1-Spaces"), tok(0x0647), tok(0x02a5), END);

// =DATABASE(K0348='x'): a string after K0348 is 0x0696
const e15 = stream(DB, tok(0x0348), tok(0x0696), u32(0), z("x"), tok(0x0647), tok(0x02a5), END);

// =2.5
const e16 = stream(tok(0x065a), ext(2.5), END);

// =F01AF('Title Block Project Data', 'Project Name')
const e17 = stream(tok(0x01af), tok(0x065b), u32(0), z("Title Block Project Data"), tok(0x065b), u32(0), z("Project Name"), tok(0x02a5), END);

// =DATABASE(L=EF_*)
const e18 = stream(DB, tok(0x0305), tok(0x029b), z("EF_*"), tok(0x0647), tok(0x02a5), END);

type Example = {
  name: string;
  bytes: Uint8Array;
  text: string;
  tree?: Node;
  at?: { row: number; col: number };
  /** the text parses back to the same bytes (false where the spec's bytes carry the 0x0296 oddity) */
  parses: boolean;
};
const examples: Example[] = [
  { name: "DATABASE with R IN and a field", bytes: e1, text: "=DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))", tree: e1Tree, parses: true },
  { name: "DATABASE with NOTINDLVP and PON", bytes: e2, text: "=DATABASE(NOTINDLVP & NOTINREFDLVP & (PON='Space'))", parses: false },
  { name: "DATABASE with R IN a set", bytes: e3, text: "=DATABASE((R IN ['FramingMember']))", parses: false },
  { name: "quoted field", bytes: e4, text: "='Door'.'DoorMaterial'", parses: true },
  { name: "bracketed bare field", bytes: e5, text: "=(Door.IDPrefix)", parses: true },
  { name: "bracketed quoted record, bare field", bytes: e6, text: "=('FramingMember'.quantityLabel)", parses: true },
  { name: "COUNT with no arguments", bytes: e7, text: "=COUNT", parses: true },
  { name: "AREA with an option name", bytes: e8, text: "=AREA('gross')", parses: true },
  { name: "IF", bytes: e9, text: "=IF('Door'.'JambWidth'=0, 'N/A', 'Door'.'JambWidth')", tree: e9Tree, parses: true },
  { name: "OBJECTDATA", bytes: e10, text: "=OBJECTDATA('finish', 'FinishKey', ', ', 'floor')", parses: true },
  { name: "field times field", bytes: e11, text: "='Space_Finish'.'UnitCost'*'Space_Finish'.'NetArea'", parses: true },
  { name: "area field then 0x00e4", bytes: e12, text: "='Space'.'Area' {00E4}", parses: true },
  { name: "sheet cell", bytes: e13, text: "='Square Footage':C2", at: { row: 2, col: 1 }, parses: true },
  { name: "L compared with a string", bytes: e14, text: "=DATABASE(L='1-Spaces')", parses: true },
  { name: "K0348 compared with a string", bytes: e15, text: "=DATABASE(K0348='x')", parses: true },
  { name: "a real number", bytes: e16, text: "=2.5", parses: true },
  { name: "F01AF keeps its first string as 0x065b", bytes: e17, text: "=F01AF('Title Block Project Data', 'Project Name')", parses: true },
  { name: "wildcard word after L", bytes: e18, text: "=DATABASE(L=EF_*)", parses: true },
];

for (const ex of examples) {
  let node: Node | null = null;
  try {
    node = decode(ex.bytes);
  } catch (e) {
    check(false, `${ex.name}: decodes (${(e as Error).message})`);
    continue;
  }
  check(true, `${ex.name}: decodes`);
  if (ex.tree) check(isDeepStrictEqual(node, ex.tree), `${ex.name}: tree is as read from the bytes`);
  const text = toText(node, ex.at);
  check(text === ex.text, `${ex.name}: text is ${ex.text}${text === ex.text ? "" : ` (got ${text})`}`);
  check(isDeepStrictEqual(toText(node), toText(node, undefined)), `${ex.name}: toText is stable`);
  const back = encode(node);
  check(hex(back) === hex(ex.bytes), `${ex.name}: encode gives the bytes back`);
  if (ex.parses) {
    try {
      const parsed = parse(ex.text, { ...ctx, at: ex.at });
      check(hex(encode(parsed)) === hex(ex.bytes), `${ex.name}: parse of its text gives the same bytes`);
    } catch (e) {
      check(false, `${ex.name}: parse of its text (${(e as Error).message})`);
    }
  }
}

// the sheet reference without a position
check(
  toText(decode(e13)) === "='Square Footage':R[-1]C[1]",
  "sheet cell without a position is written R[-1]C[1]",
);
check(
  isDeepStrictEqual(parse("='Square Footage':R[-1]C[1]", ctx), decode(e13)),
  "R[-1]C[1] parses to the same sheet node",
);

// ---- the whole worksheet language is parsed; what has no token is named by unwritable() ----
function throwsWith(f: () => unknown): Error | null {
  try {
    f();
    return null;
  } catch (e) {
    return e as Error;
  }
}
const isFormula = (e: Error | null): boolean => e instanceof FormulaError;

// parsing: the text of each operator's tree, and the tree's shape
const full = (text: string, at?: { row: number; col: number }): string => toText(parse(text, { ...ctx, at }), at);
check(full("=A1+B2") === "=A1 + B2", "=A1+B2 parses and prints back as A1 + B2");
check(full("=SUM(A1..A3)") === "=SUM(A1..A3)", "=SUM(A1..A3) parses (a range as an argument)");
check(full("=((C28*12)-4.5)/12") === "=((C28*12) - 4.5)/12", "=((C28*12)-4.5)/12 parses and prints");
check(full("=A6+(A6*.07)") === "=A6 + (A6*0.07)", "=A6+(A6*.07) parses and prints (.07 is a number)");
check(full("=if((C7<100),100,C7)") === "=IF((C7<100), 100, C7)", "=if((C7<100),100,C7) parses and prints");
check(
  full("='Appliance Schedule':A1", { row: 2, col: 1 }) === "='Appliance Schedule':A1" &&
    parse("='Appliance Schedule':A1", { ...ctx, at: { row: 2, col: 1 } }).k === "sheet",
  "'Appliance Schedule':A1 is a sheet cell relative to the formula",
);
check(full("=Appliance:A1", { row: 0, col: 0 }) === "='Appliance':A1", "a bare sheet name before : is a sheet cell");
check(parse("=FALSE", ctx).k === "bool" && (parse("=FALSE", ctx) as { v: boolean }).v === false, "FALSE parses to a false bool");
check(full("=2-3-4") === "=2 - 3 - 4", "2-3-4 is left associative");
check(isDeepStrictEqual(parse("=2-3-4", ctx), { k: "op", op: -2, a: { k: "op", op: -2, a: { k: "int", v: 2 }, b: { k: "int", v: 3 } }, b: { k: "int", v: 4 } }), "2-3-4 is (2-3)-4");
check(full("=2^3^2") === "=2^3^2", "2^3^2 is left associative");
check(full("=-2^2") === "=-2^2", "-2^2 prints as written (unary minus binds tighter than ^)");
check(full("=1+2*3") === "=1 + 2*3", "* binds tighter than +");
check(full("=1 + 2 = 3") === "=1 + 2=3", "= is looser than +");
check(full("=A1<=3") === "=A1<=3", "<= parses");
check(full("=40") === "=40", "whole number 40 is an int");
check(parse("=40", ctx).k === "int" && parse("=1.5", ctx).k === "num", "40 is int, 1.5 is num");
check(full("=-A1") === "=-A1", "-A1 is a negation");
check(full("=$A$1+a$2") === "=$A$1 + A$2", "absolute references parse and print with their $");
check(
  isDeepStrictEqual(parse("=$A$1", ctx), { k: "cell", row: 0, col: 0, absRow: true, absCol: true }),
  "$A$1 is an absolute cell",
);
check(isDeepStrictEqual(parse("=a$1", ctx), { k: "cell", row: 0, col: 0, absRow: true, absCol: false }), "a$1 is a cell, absolute row");
check(parse("=K0348", ctx).k === "kw", "K0348 is a keyword, not a cell");
check(parse("=LOG10", ctx).k === "cell", "LOG10 looks like a cell reference (column LOG, row 10)");
check(isDeepStrictEqual(parse("=IF(A1; 2; 3)", ctx), parse("=IF(A1, 2, 3)", ctx)), "';' separates arguments as ',' does");
check(full("=ROUND(A1, 2)") === "=ROUND(A1, 2)", "ROUND with places");
check(full("=sum(A1..A3)") === "=SUM(A1..A3)", "function names are case-insensitive, printed upper case");
check(parse("=2.5", ctx).k === "num" && parse("=.5", ctx).k === "num", ".5 is a number");

// unwritable(): the parts with no token, named in the order the stream writes them
check(unwritable(parse("=1+2", ctx)) === `"+" can't be saved as a Vectorworks formula yet (its token isn't known)`, "unwritable names + in =1+2");
check(unwritable(parse("=A1+B2", ctx))?.startsWith(`"A1"`) === true, "unwritable names A1 first in =A1+B2");
check(unwritable(parse("=SUM(A1..A3)", ctx))?.startsWith(`"SUM"`) === true, "unwritable names SUM");
check(unwritable(parse("=FALSE", ctx)) === `"FALSE" can't be saved as a Vectorworks formula yet (its token isn't known)`, "unwritable names FALSE");
check(unwritable(parse("=-A1", ctx))?.startsWith(`"-"`) === true, "unwritable names the negation");
check(unwritable(decode(e1)) === null, "a settled formula is writable");
check(unwritable(parse("=DATABASE(L='1-Spaces')", ctx)) === null, "a settled criteria formula is writable");
check(unwritable(parse("=COUNT", ctx)) === null, "COUNT is writable");
check(unwritable(parse("=TRUE", ctx)) === null, "TRUE is writable");

// encode refuses what has no token, with the same message
check(throwsWith(() => encode(parse("=1+2", ctx)))?.message.startsWith(`"+" can't be saved`) === true, "encode refuses + with the message");
check(throwsWith(() => encode({ k: "bool", v: false }))?.message.includes("FALSE") === true, "encode refuses FALSE");
check(
  throwsWith(() => encode({ k: "cell", row: 0, col: 0, absRow: false, absCol: false }))?.message.includes('"A1"') === true,
  "encode refuses a cell, naming it",
);
check(isFormula(throwsWith(() => encode({ k: "neg", a: { k: "int", v: 1 } }))), "encode refuses a negation (a FormulaError)");
check(isFormula(throwsWith(() => encode({ k: "op", op: 0x0632, a: { k: "int", v: 1 }, b: { k: "int", v: 2 } }))), "encode refuses an operator with no token");

// negative cases: text it can't read
const negatives: [string, () => unknown][] = [
  ["parse an unknown function", () => parse("=FOO('x')", ctx)],
  ["parse a field the drawing does not have", () => parse("=Door.Nope", ctx)],
  ["parse a record the drawing does not have", () => parse("=Nothing.Here", ctx)],
  ["parse a dangling operator", () => parse("=1+", ctx)],
  ["parse an unclosed bracket", () => parse("=(1", ctx)],
  ["parse a range outside a function", () => parse("=A1..B5", ctx)],
  ["parse a bare word in arithmetic", () => parse("=foo + 1", ctx)],
  ["parse a bare word as an argument", () => parse("=SUM(foo)", ctx)],
  ["parse a bare word on its own", () => parse("=foo", ctx)],
  ["parse a sheet cell with no position", () => parse("='Square Footage':C2", ctx)],
  ["parse a sheet that is not in the drawing", () => parse("='Nope':C2", { ...ctx, at: { row: 0, col: 0 } })],
  ["parse a text with a stray character", () => parse("=1 # 2", ctx)],
  ["decode an unknown token", () => decode(stream(tok(0x0123), END))],
  ["decode bytes after the end", () => decode(stream(tok(0x0295), i32(1), END, tok(0x0295)))],
  ["decode a call with no closing token", () => decode(stream(tok(0x02c7), tok(0x0295), i32(1), END))],
  ["decode 0x02a6 with no function", () => decode(stream(tok(0x0295), i32(1), tok(0x02a6), END))],
  ["decode a stream with no end", () => decode(stream(tok(0x0295), i32(1)))],
];
for (const [name, f] of negatives) {
  const e = throwsWith(f);
  check(e !== null && (e instanceof FormulaError), `${name}: refused${e ? ` (${e.message})` : ""}`);
}
check(throwsWith(() => parse("=Door.Nope", ctx)) instanceof UnknownFieldError, "an unknown field is an UnknownFieldError");
const unk = throwsWith(() => parse("=Door.Nope", ctx));
check(unk instanceof UnknownFieldError && unk.rec === "Door" && unk.field === "Nope", "UnknownFieldError carries the record and field");
check(throwsWith(() => parse("=Nothing.Here", ctx)) instanceof UnknownFieldError, "an unknown record is an UnknownFieldError");

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all formula checks ok");
