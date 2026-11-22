// Checks the worksheet formula evaluator (engine.ts) on formulas typed as text and parsed (text.ts).
// Run from web/:  npx tsx src/core/formula/engine.check.ts
// Nothing from a drawing is in here: the names, fields and cell values are made up.

import type { Node, Value } from "./ast.ts";
import { evaluate, evaluateSheet, type Env, type ObjectAccess, unsupported } from "./engine.ts";
import { type ParseContext, parse } from "./text.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// fake name table and record fields: any field of Door, the sheet Appliance
const NAMES = new Map<string, number>([
  ["Door", 619],
  ["Appliance", 704],
]);
const ctx: ParseContext = {
  nameIndex: (n) => NAMES.get(n) ?? 0,
  field: (rec) => (rec === "Door" ? { type: 1, offset: 0x10 } : null),
};

const isErr = (v: Value, text: string): boolean => typeof v === "object" && v !== null && v.error === text;
const val = (text: string, env: Env = {}, at?: { row: number; col: number }): Value =>
  evaluate(parse(text, { ...ctx, at }), at ? { ...env, at } : env);

// ---- arithmetic and precedence ----
check(val("=1+2*3") === 7, "1+2*3 is 7 (* before +)");
check(val("=(1+2)*3") === 9, "(1+2)*3 is 9");
check(val("=2-3-4") === -5, "2-3-4 is -5 (left associative)");
check(val("=2^3^2") === 64, "2^3^2 is 64 (left associative)");
check(val("=-2^2") === 4, "-2^2 is 4 (unary minus binds tighter than ^)");
check(val("=-(2+3)") === -5, "-(2+3) is -5");
check(val("=10/4") === 2.5, "10/4 is 2.5");
check(val("=40*.5") === 20, ".5 and 40 work in arithmetic");
check(val("=1.5+.25") === 1.75, "decimal literals");
check(val("='3'+1") === 4, "text that reads as a number counts as that number");
check(isErr(val("='abc'+1"), "#VALUE!"), "text that is not a number gives #VALUE!");
check(isErr(val("='x'+1"), "#VALUE!"), "'x'+1 is #VALUE!");
check(isErr(val("=1/0"), "#DIV 0!"), "1/0 is #DIV 0!");
check(isErr(val("=0^-1"), "#DIV 0!"), "0^-1 is #DIV 0!");
check(val("=TRUE+TRUE") === 2, "TRUE counts as 1 in arithmetic");

// ---- comparisons and logic ----
check(val("=1<2") === true && val("=2<=2") === true && val("=3>=4") === false, "< <= >= compare numbers");
check(val("=3>2") === true && val("=2>3") === false, "> compares numbers");
check(val("=1 + 2 = 3") === true, "= compares after + (1 + 2 = 3)");
check(val("='ABC'='abc'") === true, "text = is case-insensitive");
check(val("='a'<>'b'") === true && val("='a'<>'A'") === false, "text <> is case-insensitive");
check(val("='1'=1") === true, "a number-reading text equals that number");
check(val("=TRUE&FALSE") === false && val("=TRUE&TRUE") === true, "& is logical AND");
check(val("=FALSE|TRUE") === true && val("=0|0") === false, "| is logical OR (a number is true when not 0)");
check(val("=1&2") === true, "a number is true when not 0");
check(isErr(val("='x'&TRUE"), "#VALUE!"), "& of a non-truth text is #VALUE!");
check(val("=TRUE & 1 = 1") === true, "= binds tighter than &");

// ---- errors are values; an error in an operand is the result ----
check(isErr(val("=('x'+1)*(1/0)"), "#VALUE!"), "the first operand's error is the result");
check(isErr(val("=(1/0)+'x'"), "#DIV 0!"), "a left error is kept over a right one");
check(isErr(val("=1+(1/0)"), "#DIV 0!"), "a right error is the result");
check(isErr(val("=-'x'"), "#VALUE!"), "negating text is #VALUE!");
check(isErr(val("=A1", {}), "#OPCODE?"), "a cell with no cell reader is #OPCODE?");
check(isErr(val("=DATABASE(L='x')", { object: { field: () => 1, count: 1, call: () => 1 } }), "#OPCODE?"), "DATABASE is #OPCODE? here");
check(isErr(val("=ABS(1,2)"), "#VALUE!"), "a function with the wrong number of arguments is #VALUE!");
check(isErr(val("=SQRT(-1)"), "#VALUE!"), "SQRT of a negative is #VALUE!");
check(isErr(val("=LN(0)"), "#VALUE!"), "LN of 0 is #VALUE!");
check(isErr(val("=ASIN(2)"), "#VALUE!"), "ASIN out of range is #VALUE!");

// ---- IF is lazy ----
check(val("=IF(TRUE, 1, 1/0)") === 1, "IF takes the then branch without evaluating the else");
check(val("=IF(FALSE, 1/0, 2)") === 2, "IF takes the else branch without evaluating the then");
check(isErr(val("=IF(1/0, 1, 2)"), "#DIV 0!"), "an error in IF's test is the result");
check(isErr(val("=IF('x', 1, 2)"), "#VALUE!"), "IF of text that is not a truth value is #VALUE!");
let spied = 0;
val("=IF(TRUE, 1, A1)", { cell: () => ((spied++), 9) });
check(spied === 0, "the unchosen branch's cell is not read");
check(val("=IF(1<2, 'yes', 'no')") === "yes", "IF with text branches");

// ---- CONCAT ----
check(val("=CONCAT('a', 1, TRUE, 2.5)") === "a1TRUE2.5", "CONCAT joins texts (numbers shortest, TRUE)");
check(val("=CONCAT('x', IF(FALSE, 'a', 'b'), 'y')") === "xby", "CONCAT takes IF's value");
check(val("=CONCAT()") === "", "CONCAT of nothing is empty text");
check(isErr(val("=CONCAT('a', 1/0)"), "#DIV 0!"), "CONCAT passes an error through");
check(val("=CONCAT(A1)", { cell: () => null }) === "", "an empty cell concatenates as empty text");

// ---- wildcard comparison ----
const wild = (pattern: string, other: string, op: number): Value =>
  evaluate({ k: "op", op, a: { k: "word", v: pattern }, b: { k: "str", v: other, ref: 0, tok: 0x065b } } as Node, {});
check(wild("EF_*", "ef_hood", 0x0647) === true, "EF_* matches ef_hood (case-insensitive)");
check(wild("EF_?", "EF_ab", 0x0647) === false && wild("EF_?", "EF_a", 0x0647) === true, "? is one character");
check(wild("EF_*", "XX", 0x0646) === true, "<> with a wildcard is the negated match");
check(wild("Door", "door", 0x0647) === true, "a word without wildcards compares case-insensitively");

// ---- functions with negative ids ----
check(val("=SUM(1,2,3)") === 6, "SUM of numbers");
check(val("=AVERAGE(2,4)") === 3, "AVERAGE");
check(isErr(val("=AVERAGE()"), "#DIV 0!"), "AVERAGE of nothing is #DIV 0!");
check(val("=MIN(4,2,9)") === 2 && val("=MAX(4,2,9)") === 9, "MIN and MAX");
check(val("=ABS(-3)") === 3, "ABS");
check(val("=INT(-2.7)") === -2 && val("=INT(2.7)") === 2, "INT truncates toward zero");
check(val("=ROUND(2.5)") === 3 && val("=ROUND(2.675, 2)") === 2.68 && val("=ROUND(-1.5)") === -2, "ROUND to the nearest, halves away from zero");
check(val("=ROUND(1234, -2)") === 1200, "ROUND with negative places");
check(val("=SQRT(16)") === 4, "SQRT");
check(Math.abs((val("=SIN(0)") as number) - 0) < 1e-12 && val("=COS(0)") === 1, "SIN and COS are in radians");
check(Math.abs((val("=ATAN(1)") as number) - Math.PI / 4) < 1e-12, "ATAN");
check(Math.abs((val("=DEG2RAD(180)") as number) - Math.PI) < 1e-12, "DEG2RAD");
check(Math.abs((val("=RAD2DEG(3.141592653589793)") as number) - 180) < 1e-9, "RAD2DEG");
check(Math.abs((val("=EXP(1)") as number) - Math.E) < 1e-12, "EXP");
check(Math.abs((val("=LN(2.718281828459045)") as number) - 1) < 1e-12, "LN");
check(val("=LOG(1000)") === 3, "LOG is base 10");
check(val("=VALUE('12.5')") === 12.5, "VALUE of text");
check(isErr(val("=VALUE('abc')"), "#VALUE!"), "VALUE of text that isn't a number is #VALUE!");
check(val("=SUBSTRING('a-b-c', '-', 2)") === "b", "SUBSTRING takes the index-th part");
check(val("=SUBSTRING('a-b', '-', 5)") === "", "SUBSTRING past the end is empty");

// ---- sheet cells and cells ----
check(val("=A1+1", { cell: () => 4 }) === 5, "a cell reads through env.cell");
check(val("=B2", { cell: (r, c) => r * 10 + c }, { row: 0, col: 0 }) === 11, "cells are read at their row and column");
check(
  val("='Appliance':A1", { sheetCell: (s, r, c) => (s === "Appliance" ? 100 + r * 10 + c : null) }, { row: 2, col: 1 }) === 100,
  "a sheet cell is read relative to the formula's cell (row -2, column -1 gives A1)",
);
check(isErr(val("='Appliance':A1", {}, { row: 2, col: 1 }), "#OPCODE?"), "a sheet cell with no sheet reader is #OPCODE?");

// ---- record fields through ObjectAccess ----
const fields = new Map<string, Value>([["JambWidth", 900]]);
const object: ObjectAccess = {
  count: 3,
  field: (rec, f) => (rec === "Door" ? fields.get(f) : undefined),
  call: (fn, args) => {
    if (fn === 0x02e8) return args[0] === "gross" ? 42 : undefined;
    if (fn === 0x02c7) return 3;
    if (fn === 0x00e4) return (args[0] as number) * 10;
    return undefined;
  },
};
check(val("=Door.JambWidth/2", { object }) === 450, "a record field is read through the object");
check(isErr(val("=Door.Missing", { object }), "#NAME?"), "a field the object lacks is #NAME?");
check(isErr(val("=Door.JambWidth", {}), "#OPCODE?"), "a field with no object is #OPCODE?");
check(val("=AREA('gross')", { object }) === 42, "a settled function goes to the object");
check(val("=COUNT", { object }) === 3, "=COUNT goes to the object");
check(isErr(val("=LENGTH", { object }), "#OPCODE?"), "a function the object doesn't know is #OPCODE?");
check(val("=COUNT", { criteriaCall: () => 7 }) === 7, "a settled function with no object goes to criteriaCall");
check(isErr(val("=COUNT", {}), "#OPCODE?"), "a settled function nothing answers is #OPCODE?");
check(val("=Door.JambWidth {00E4}", { object }) === 9000, "the post token 0x00e4 is left to the object");
check(isErr(val("=Door.JambWidth {00E4}", {}), "#OPCODE?"), "the post token with no object is #OPCODE?");
check(isErr(val("=AREA(1/0)", { object }), "#DIV 0!"), "an error argument reaches a settled function as the result");

// ---- evaluateSheet: cells, ranges, cycles ----
const sheetCells = new Map<string, Node>();
const put = (row: number, col: number, text: string): void => {
  sheetCells.set(`${row},${col}`, parse(text, ctx));
};
put(0, 0, "=B1*2"); // A1 = B1 * 2
put(1, 0, "=A1+1"); // A2 = A1 + 1
put(2, 0, "=A4+1"); // A3 cycle with A4
put(3, 0, "=A3*2"); // A4
put(4, 0, "=A3+1"); // A5 reads the cycle
put(5, 0, "=A6"); // A6 refers to itself
put(6, 0, "=SUM(A1..A2)"); // A7 = 10 + 11
put(7, 0, "=AVERAGE(A1..B1)"); // A8 = (10 + 5) / 2
put(8, 0, "=SUM(C1..C3)"); // A9: null, text and 4 in C1..C3
put(9, 0, "=MIN(C1..C3)"); // A10
put(10, 0, "=MAX(1, A7, 3)"); // A11
put(11, 0, "=AVERAGE(D1..D3)"); // A12: all empty
put(12, 0, "=Door.JambWidth"); // A13: a record field in a plain cell, no object
const base = (row: number, col: number): Value => {
  if (col === 1 && row === 0) return 5;
  if (col === 2) return row === 0 ? null : row === 1 ? "x" : 4;
  return null;
};
const out = evaluateSheet(sheetCells, base, () => ({}));
const at = (row: number, col: number): Value => out.get(`${row},${col}`) as Value;
check(at(0, 0) === 10, "A1 = B1*2 reads a base cell (5) to 10");
check(at(1, 0) === 11, "A2 reads the formula cell A1 (its result, 10) to 11");
check(isErr(at(2, 0), "#CVAL?") && isErr(at(3, 0), "#CVAL?"), "cells in a cycle are #CVAL?");
check(isErr(at(4, 0), "#CVAL?"), "a cell reading a cycle is #CVAL?");
check(isErr(at(5, 0), "#CVAL?"), "a cell that refers to itself is #CVAL?");
check(at(6, 0) === 21, "SUM over a range reads formula cells (A1, A2)");
check(at(7, 0) === 7.5, "AVERAGE over a range skips nothing numeric, averages B1 too");
check(at(8, 0) === 4, "SUM over a range skips empty and text cells");
check(at(9, 0) === 4, "MIN over a range skips empty and text cells");
check(at(10, 0) === 21, "MAX with a constant and a cell");
check(isErr(at(11, 0), "#DIV 0!"), "AVERAGE over only empty cells is #DIV 0!");
check(isErr(at(12, 0), "#OPCODE?"), "a record field in a plain cell is #OPCODE?");

// ---- unsupported() ----
const u = (text: string, where: "cell" | "column", provides?: (fn: number, w: "cell" | "column") => boolean): string | null =>
  unsupported(parse(text, ctx), where, provides);
check(u("=1+2", "cell") === null, "unsupported: arithmetic is supported");
check(u("=SUM(A1..A3)", "cell") === null, "unsupported: SUM over a range is supported");
check(u("=ABS(A1..A3)", "cell") !== null, "unsupported: a range outside SUM is not");
check(u("=Door.JambWidth", "cell")?.includes("needs a database row") === true, "unsupported: a record field needs a row in a plain cell");
check(u("=Door.JambWidth", "column") === null, "unsupported: a record field is supported in a column");
check(u("=AREA('gross')", "cell") !== null, "unsupported: a settled function with no provider");
check(u("=AREA('gross')", "cell", (fn) => fn === 0x02e8) === null, "unsupported: a settled function the provider works out");
check(u("=DATABASE(L='x')", "column", () => true) !== null, "unsupported: DATABASE is never worked out here");
check(u("=CONCAT('a', 1)", "cell") === null, "unsupported: CONCAT is worked out here");
check(u("=OBJECTDATA('finish', 'k')", "column") !== null, "unsupported: OBJECTDATA with no provider");
check(u("=OBJECTDATA('finish', 'k')", "column", (fn) => fn === 0x01e8) === null, "unsupported: OBJECTDATA with a provider");
check(u("=Door.JambWidth {00E4}", "column") !== null, "unsupported: the post token with no provider");
check(u("=Door.JambWidth {00E4}", "column", (fn) => fn === 0x00e4) === null, "unsupported: the post token with a provider");
check(u("=IF(A1, 1, 2)", "cell") === null, "unsupported: IF over cells is supported");
check(u("=Door.JambWidth", "cell") !== null && u("=1", "cell") === null, "unsupported names the first thing it cannot work out");

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all engine checks ok");
