// Names of the worksheet formula tokens (SPEC §2, the census of 2026-11-22; FORMAT.md §7.2).
// A token with no settled name is spelled F or K and its four hex digits, upper case; those
// spellings are what the parser reads back to the same token.

/** Structural and literal tokens, by the role tokens.ts gives them. */
export const TOKEN = {
  END: 0x0690,
  NUMBER: 0x065a,
  INT: 0x0295,
  STRING: 0x065b,
  OPTION_STRING: 0x0695,
  KEYWORD_STRING: 0x0696,
  WORD: 0x029b,
  TRUE: 0x0291,
  RECORD: 0x029c,
  RECORD_QUOTED: 0x029d,
  FIELD: 0x029e,
  FIELD_QUOTED: 0x029f,
  SHEET: 0x0299,
  MARK: 0x0296,
  SET: 0x0661,
  IN: 0x0641,
  PAREN: 0x0665,
  ARGS: 0x02a5,
  NO_ARGS: 0x02a6,
  IF: 0x0682,
  POST: 0x00e4,
  EQ: 0x0647,
  NE: 0x0646,
  AND: 0x064f,
  OR: 0x0648,
  MUL: 0x0654,
} as const;

/** Functions: the name token comes before its arguments. */
export const FUNCTIONS: ReadonlyMap<number, string> = new Map([
  [0x029a, "DATABASE"],
  [0x02c7, "COUNT"],
  [0x02e8, "AREA"],
  [0x02f3, "VOLUME"],
  [0x02ee, "LENGTH"],
  [0x02c2, "F02C2"],
  [0x01ef, "F01EF"],
  [0x01e8, "OBJECTDATA"],
  [0x039b, "F039B"],
  [0x00f3, "CONCAT"],
  [0x01e0, "F01E0"],
  [0x01af, "F01AF"],
]);

/** Criteria keywords (operands). */
export const KEYWORDS: ReadonlyMap<number, string> = new Map([
  [0x0308, "R"],
  [0x0305, "L"],
  [0x0328, "PON"],
  [0x031e, "NOTINDLVP"],
  [0x0319, "NOTINREFDLVP"],
  [0x031d, "K031D"],
  [0x0345, "K0345"],
  [0x0346, "K0346"],
  [0x0348, "K0348"],
  [0x034d, "K034D"],
  [0x0350, "K0350"],
]);

/** Operators by the symbol the text shows them with (0x0682 IF and 0x00e4 are written by their own rules). */
export const OPERATORS: ReadonlyMap<number, string> = new Map([
  [0x0647, "="],
  [0x0646, "<>"],
  [0x064f, "&"],
  [0x0648, "|"],
  [0x0654, "*"],
  [0x0641, "IN"],
  [0x0682, "IF"],
  [0x00e4, "{00E4}"],
]);

/** Binary operators: two operands, then the token (IN is written by its set rule instead). */
export const BINARY: ReadonlySet<number> = new Set([0x0647, 0x0646, 0x064f, 0x0648, 0x0654]);

/** Name to token, case-insensitive. */
function invert(m: ReadonlyMap<number, string>): Map<string, number> {
  return new Map([...m].map(([token, name]) => [name.toUpperCase(), token]));
}
const FUNCTION_TOKENS = invert(FUNCTIONS);
const KEYWORD_TOKENS = invert(KEYWORDS);
const OPERATOR_TOKENS = invert(OPERATORS);

export function functionName(token: number): string | undefined {
  return FUNCTIONS.get(token);
}
export function functionToken(name: string): number | undefined {
  return FUNCTION_TOKENS.get(name.toUpperCase());
}
export function keywordName(token: number): string | undefined {
  return KEYWORDS.get(token);
}
export function keywordToken(name: string): number | undefined {
  return KEYWORD_TOKENS.get(name.toUpperCase());
}
export function operatorSymbol(token: number): string | undefined {
  return OPERATORS.get(token);
}
export function operatorToken(symbol: string): number | undefined {
  return OPERATOR_TOKENS.get(symbol.toUpperCase());
}

/** Four upper-case hex digits, as the F and K spellings and error messages write a token. */
export function hex4(token: number): string {
  return token.toString(16).toUpperCase().padStart(4, "0");
}

// ---- unsettled operators and functions ----
// Rodeo works these out (engine.ts) but no file seen holds their tokens, so they have negative ids and
// tokens.ts refuses to write them. The settled tables above are unchanged.

/** Unsettled binary operators (negative ids). */
export const OP = {
  ADD: -1,
  SUB: -2,
  DIV: -3,
  POW: -4,
  LT: -5,
  GT: -6,
  LE: -7,
  GE: -8,
} as const;

/** Unsettled functions (negative ids). */
export const FN = {
  SUM: -101,
  AVERAGE: -102,
  MIN: -103,
  MAX: -104,
  ABS: -105,
  INT: -106,
  ROUND: -107,
  SQRT: -108,
  SIN: -109,
  COS: -110,
  TAN: -111,
  ASIN: -112,
  ACOS: -113,
  ATAN: -114,
  DEG2RAD: -115,
  RAD2DEG: -116,
  EXP: -117,
  LN: -118,
  LOG: -119,
  VALUE: -120,
  SUBSTRING: -121,
} as const;

export const UNSETTLED_OPERATORS: ReadonlyMap<number, string> = new Map<number, string>([
  [OP.ADD, "+"],
  [OP.SUB, "-"],
  [OP.DIV, "/"],
  [OP.POW, "^"],
  [OP.LT, "<"],
  [OP.GT, ">"],
  [OP.LE, "<="],
  [OP.GE, ">="],
]);

export const UNSETTLED_FUNCTIONS: ReadonlyMap<number, string> = new Map<number, string>(
  Object.entries(FN).map(([name, id]) => [id, name]),
);

/** A settled token is a positive id; the unsettled ones above are negative. */
export function isSettled(id: number): boolean {
  return id > 0;
}

/** The symbol of a settled or unsettled operator. */
export function anyOperatorSymbol(id: number): string | undefined {
  return OPERATORS.get(id) ?? UNSETTLED_OPERATORS.get(id);
}

/** The operator id for a symbol, settled or unsettled (+ - / ^ < > <= >= are unsettled). */
export function anyOperatorToken(symbol: string): number | undefined {
  return operatorToken(symbol) ?? UNSETTLED_OPERATOR_TOKENS.get(symbol);
}

/** A function's name, settled or unsettled, printed upper case. */
export function anyFunctionName(id: number): string | undefined {
  return FUNCTIONS.get(id) ?? UNSETTLED_FUNCTIONS.get(id);
}

/** A function's id by its name (case-insensitive), settled or unsettled. */
export function anyFunctionToken(name: string): number | undefined {
  return functionToken(name) ?? UNSETTLED_FUNCTION_TOKENS.get(name.toUpperCase());
}

const UNSETTLED_OPERATOR_TOKENS = invert(UNSETTLED_OPERATORS);
const UNSETTLED_FUNCTION_TOKENS = invert(UNSETTLED_FUNCTIONS);
