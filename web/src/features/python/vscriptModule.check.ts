// Node check of the Vectorscript translator (vscriptModule.ts): the language it already supports,
// each program printing what it computes, and the calls that hand values back through VAR
// parameters. Run from web/: npx tsx src/features/python/vscriptModule.check.ts

import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { blankSnapshot, ranVs, runVs, type VsOutcome } from "./vsCheck.ts";
import { VSC_SOURCE } from "./vscriptModule.ts";
import { VS_SIGNATURES } from "./vsSignatures.ts";

/** The lines a Vectorscript program writes with Message, one each, as the run's messages. */
function lines(code: string): string[] {
  return messages(ranVs(code, { file: "program.vs" }));
}

function messages(r: VsOutcome): string[] {
  return Array.isArray(r.messages) ? (r.messages as string[]) : [];
}

const cases: [string, string, string[]][] = [
  [
    "arithmetic and precedence",
    `PROCEDURE Main;
BEGIN
  Message(1 + 2 * 3);
  Message(7 / 2);
  Message(7 div 2);
  Message(-7 div 2);
  Message(-7 mod 3);
  Message(2.5 * 2);
END;
RUN(Main);`,
    ["7", "3.5", "3", "-3", "-1", "5"],
  ],
  [
    "booleans, comparisons and the bit operators on integers",
    `PROCEDURE Main;
BEGIN
  Message(TRUE);
  Message(3 < 4);
  Message((1 < 2) AND (3 > 4));
  Message(TRUE OR FALSE);
  Message(6 AND 3);
  Message(4 OR 1);
  Message(NOT 0);
  Message(NOT FALSE);
END;
RUN(Main);`,
    ["TRUE", "TRUE", "FALSE", "TRUE", "2", "5", "-1", "TRUE"],
  ],
  [
    "Pascal's numeric routines",
    `PROCEDURE Main;
BEGIN
  Message(Round(2.5));
  Message(Trunc(-2.7));
  Message(Sqr(3));
  Message(Sqrt(16));
  Message(Abs(-4));
  Message(Odd(3));
  Message(Chr(65));
  Message(Ord('A'));
END;
RUN(Main);`,
    ["3", "-2", "9", "4", "4", "TRUE", "A", "65"],
  ],
  [
    "string routines: Concat, Copy, Pos, Len",
    `PROCEDURE Main;
BEGIN
  Message(Concat('ab', 'cd', 1));
  Message(Copy('hello', 2, 3));
  Message(Pos('ll', 'hello'));
  Message(Len('abc'));
END;
RUN(Main);`,
    ["abcd1", "ell", "3", "3"],
  ],
  [
    "string characters, Delete, Insert and UpperString change a variable",
    `PROCEDURE Main;
VAR s : STRING;
BEGIN
  s := 'abc';
  s[2] := 'X';
  Message(s);
  s := 'hello';
  Delete(s, 1, 2);
  Message(s);
  Insert('XX', s, 2);
  Message(s);
  UpperString(s);
  Message(s);
END;
RUN(Main);`,
    ["aXc", "llo", "lXXlo", "LXXLO"],
  ],
  [
    "character codes, hex numbers and the three kinds of comment",
    `PROCEDURE Main;
BEGIN
  { a brace comment }
  (* a star comment *)
  // a line comment
  Message('a'#66'c');
  Message($FF);
  Message('it''s');
END;
RUN(Main);`,
    ["aBc", "255", "it's"],
  ],
  [
    "constants and variables with their starting values",
    `PROCEDURE Main;
CONST N = 5;
CONST M = N * 2;
VAR i : INTEGER; r : REAL; b : BOOLEAN;
BEGIN
  Message(M);
  Message(i);
  Message(r);
  Message(b);
END;
RUN(Main);`,
    ["10", "0", "0", "FALSE"],
  ],
  [
    "records keep their fields",
    `PROCEDURE Main;
TYPE P = RECORD x, y : REAL; END;
VAR p : P;
BEGIN
  p.x := 1.5;
  p.y := 2;
  Message(p.x + p.y);
END;
RUN(Main);`,
    ["3.5"],
  ],
  [
    "arrays from 1, from minus one, and two dimensions",
    `PROCEDURE Main;
VAR a : ARRAY[1..3] OF INTEGER;
    z : ARRAY[-1..1] OF INTEGER;
    m : ARRAY[1..2, 1..2] OF INTEGER;
    i : INTEGER;
BEGIN
  FOR i := 1 TO 3 DO a[i] := i * i;
  Message(a[1] + a[2] + a[3]);
  z[-1] := 5;
  Message(z[-1]);
  m[2, 2] := 9;
  Message(m[2, 2]);
END;
RUN(Main);`,
    ["14", "5", "9"],
  ],
  [
    "dynamic arrays and the long string",
    `PROCEDURE Main;
VAR d : DYNARRAY[] OF INTEGER;
    s : DYNARRAY[] OF CHAR;
BEGIN
  ALLOCATE d[1..3];
  d[2] := 4;
  Message(d[2]);
  s := 'hi';
  Message(s);
END;
RUN(Main);`,
    ["4", "hi"],
  ],
  [
    "IF, CASE with lists and ranges, and an otherwise branch",
    `PROCEDURE Main;
VAR n : INTEGER;
BEGIN
  FOR n := 1 TO 6 DO
    CASE n OF
      1, 2: Message('low');
      3..5: Message('mid');
      OTHERWISE Message('high');
    END;
  IF 3 IN [1..5] THEN Message('in');
  IF 7 IN [1, 3] THEN Message('no') ELSE Message('out');
END;
RUN(Main);`,
    ["low", "low", "mid", "mid", "mid", "high", "in", "out"],
  ],
  [
    "WHILE, REPEAT and FOR DOWNTO",
    `PROCEDURE Main;
VAR n, i : INTEGER;
BEGIN
  n := 0;
  WHILE n < 3 DO n := n + 1;
  Message(n);
  REPEAT n := n + 2 UNTIL n >= 5;
  Message(n);
  FOR i := 3 DOWNTO 1 DO Message(i);
END;
RUN(Main);`,
    ["3", "5", "3", "2", "1"],
  ],
  [
    "a function's result, and EXIT",
    `FUNCTION Triple(x : INTEGER) : INTEGER;
BEGIN
  Triple := x * 3;
END;
FUNCTION Early : INTEGER;
BEGIN
  Early := 3;
  EXIT;
  Early := 4;
END;
PROCEDURE Main;
BEGIN
  Message(Triple(4));
  Message(Early);
  Message('before');
  EXIT;
  Message('after');
END;
RUN(Main);`,
    ["12", "3", "before"],
  ],
  [
    "a nested procedure reaches its parent's variables",
    `PROCEDURE Outer;
VAR n : INTEGER;
  PROCEDURE Inner;
  BEGIN
    n := n + 1;
  END;
BEGIN
  n := 5;
  Inner;
  Message(n);
END;
RUN(Outer);`,
    ["6"],
  ],
  [
    "a VAR parameter is a reference: variables, array elements and fields",
    `PROCEDURE Swap(VAR a, b : INTEGER);
VAR t : INTEGER;
BEGIN
  t := a; a := b; b := t;
END;
PROCEDURE Bump(VAR v : REAL);
BEGIN
  v := v + 10;
END;
PROCEDURE Main;
VAR x, y : INTEGER;
    arr : ARRAY[1..3] OF REAL;
    p : RECORD w : REAL; END;
BEGIN
  x := 1; y := 2;
  Swap(x, y);
  Message(x); Message(y);
  arr[2] := 1.5;
  Bump(arr[2]);
  Message(arr[2]);
  p.w := 0.5;
  Bump(p.w);
  Message(p.w);
END;
RUN(Main);`,
    ["2", "1", "11.5", "10.5"],
  ],
  [
    "a function with a VAR parameter, in a test and as a statement",
    `FUNCTION TakeOne(VAR v : INTEGER) : BOOLEAN;
BEGIN
  v := v - 1;
  TakeOne := v > 0;
END;
PROCEDURE Main;
VAR v : INTEGER;
    ok : BOOLEAN;
BEGIN
  v := 2;
  IF TakeOne(v) THEN Message('pos') ELSE Message('zero');
  IF TakeOne(v) THEN Message('pos') ELSE Message('zero');
  v := 5;
  TakeOne(v);
  Message(v);
  ok := TakeOne(v);
  Message(v);
END;
RUN(Main);`,
    ["pos", "zero", "4", "3"],
  ],
  [
    "a user's procedure named like a call wins over it",
    `PROCEDURE Rect(a : INTEGER);
BEGIN
  Message(a * 10);
END;
PROCEDURE Main;
BEGIN
  Rect(5);
END;
RUN(Main);`,
    ["50"],
  ],
  [
    "forward declarations",
    `PROCEDURE Later; FORWARD;
PROCEDURE Main;
BEGIN
  Later;
END;
PROCEDURE Later;
BEGIN
  Message('later');
END;
RUN(Main);`,
    ["later"],
  ],
  [
    "a script of one procedure runs it without RUN",
    `PROCEDURE Main;
BEGIN
  Message(9);
END;`,
    ["9"],
  ],
  [
    "a script of statements between BEGIN and END.",
    `BEGIN
  Message(4);
END.`,
    ["4"],
  ],
  [
    "a string test and a string argument",
    `PROCEDURE Show(s : STRING);
BEGIN
  IF s = 'abc' THEN Message('same') ELSE Message('other');
END;
PROCEDURE Main;
BEGIN
  Show('abc');
  Show('abd');
END;
RUN(Main);`,
    ["same", "other"],
  ],
  [
    "the length literal: a millimetre drawing gives millimetres",
    `PROCEDURE Main;
BEGIN
  Message(2");
END;
RUN(Main);`,
    ["50.8"],
  ],
  [
    "the text faces set",
    `PROCEDURE Main;
BEGIN
  Message([Bold, Italic]);
END;
RUN(Main);`,
    ["3"],
  ],
  [
    "GetBBox hands back the corners of a drawn rectangle",
    `PROCEDURE Main;
VAR h : HANDLE; x1, y1, x2, y2 : REAL;
BEGIN
  Rect(0, 0, 10, 20);
  h := LNewObj;
  GetBBox(h, x1, y1, x2, y2);
  Message(x1); Message(y1); Message(x2); Message(y2);
END;
RUN(Main);`,
    ["0", "20", "10", "0"],
  ],
  [
    "GetPolyPt hands back a vertex of a drawn polygon",
    `PROCEDURE Main;
VAR h : HANDLE; px, py : REAL;
BEGIN
  Poly(0, 0, 10, 0, 10, 5);
  h := LNewObj;
  GetPolyPt(h, 2, px, py);
  Message(px); Message(py);
END;
RUN(Main);`,
    ["10", "0"],
  ],
  [
    "GetSegPt1, GetSegPt2 and HCenter hand back their points",
    `PROCEDURE Main;
VAR h : HANDLE; x, y : REAL;
BEGIN
  Line(1, 2);
  h := LNewObj;
  GetSegPt1(h, x, y);
  Message(x); Message(y);
  GetSegPt2(h, x, y);
  Message(x); Message(y);
  Rect(0, 0, 10, 20);
  HCenter(LNewObj, x, y);
  Message(x); Message(y);
END;
RUN(Main);`,
    ["0", "0", "1", "2", "5", "10"],
  ],
  [
    "calls from the generated table, against the vs module",
    `PROCEDURE Main;
VAR a, b, c, d, e : INTEGER; lang, region : STRING;
BEGIN
  GetVersion(a, b, c, d);
  Message(a); Message(d);
  GetVersionEx(a, b, c, d, e);
  Message(a); Message(e);
  GetCurrentLocalization(lang, region);
  Message(lang);
END;
RUN(Main);`,
    ["29", "1", "29", "0", "eng"],
  ],
  [
    "WITH: a record's fields shadow the names around it, nested, in a list and in an IF",
    `PROCEDURE Main;
TYPE PT = RECORD x, y : REAL; END;
VAR p, q : PT; x : REAL; arr : ARRAY[1..2] OF PT;
BEGIN
  x := 5;
  WITH p DO BEGIN x := 1; y := x + 2; END;
  Message(p.x); Message(p.y); Message(x);
  WITH p, q DO
    x := y;
  Message(q.y);
  WITH arr[2] DO BEGIN x := 9; END;
  Message(arr[2].x);
  WITH p DO
    IF x > 0 THEN WITH q DO y := 4 ELSE y := 0;
  Message(q.y);
  WITH p DO BEGIN x := 3; END;
  Message(p.x);
END;
RUN(Main);`,
    ["1", "3", "5", "0", "9", "4", "3"],
  ],
  [
    "POINT, POINT3D, VECTOR and RGBCOLOR records",
    `PROCEDURE Main;
VAR p : POINT; q : POINT3D; v : VECTOR; c : RGBCOLOR;
BEGIN
  p.x := 3; p.y := 4;
  Message(p.x + p.y);
  q.x := 1; q.y := 2; q.z := 2;
  Message(DotProduct(q, q));
  Message(DotProduct(p, p));
  v := Perp(p);
  Message(v.x);
  Message(v.y);
  c.red := 65535; c.green := 0; c.blue := 1;
  Message(c.blue + c.red);
END;
RUN(Main);`,
    ["7", "9", "25", "4", "-3", "65536"],
  ],
];

// the Vectorscript that fails: its error names its line
const failing: [string, string, string, number][] = [
  [
    "a syntax error",
    `PROCEDURE Main;
BEGIN
  Message(1 +);
END;
RUN(Main);`,
    "Error",
    3,
  ],

];

// every program runs before any failure is reported, so one run shows all of them
const misses: string[] = [];
for (const [name, code, expected] of cases) {
  const got = lines(code);
  if (JSON.stringify(got) !== JSON.stringify(expected)) misses.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
assert.deepEqual(misses, [], "programs that printed something else");

// an index outside an array stops the script at its line (the messages of a failed run are not kept)
{
  const r = runVs(`PROCEDURE Main;
VAR a : ARRAY[1..2] OF INTEGER;
BEGIN
  Message(a[1]);
  Message(a[3]);
END;
RUN(Main);`, { file: "program.vs" });
  assert.equal(r.error?.name, "IndexError");
  assert.equal(r.error?.line, 5);
}

for (const [name, code, errName, line] of failing) {
  const r = runVs(code, { file: "program.vs" });
  assert.equal(r.error?.name, errName, name);
  assert.equal(r.error?.line, line, name);
}

// a call to a vs function that Rodeo lacks says so, rather than doing nothing
{
  const r = runVs(`PROCEDURE Main;
BEGIN
  Message(1);
  NoSuchCallAnywhere(2);
END;
RUN(Main);`, { file: "program.vs", snapshot: blankSnapshot() });
  assert.equal(r.error?.name, "NotImplementedError");
}

console.log(`vscript translator: ok (${cases.length} programs, ${failing.length} error case)`);

// ---- the generated table, the VAR shapes the real vs module lacks, WITH and {$INCLUDE} ---------
// The translation is run against a fake vs module: each test function below hands back VAR values in
// a shape the table describes (VAR first, VAR in the middle, both ways, a point, a return order that
// differs from the Pascal order, an argument Python doesn't take), and the fake records its arguments.

const FAKE_RUN = String.raw`
import json, sys, types
job = json.load(sys.stdin)
calls, messages = [], []
vs = types.ModuleType("vs")
vs._param_type = lambda n: None


def fake(name, fn):
    def call(*args):
        calls.append([name, list(args)])
        return fn(*args)
    setattr(vs, name, call)


vs.Message = lambda *z: messages.append("".join(str(x) for x in z))
fake("SynthFirst", lambda c: (c * 10, c * 100))
fake("SynthMid", lambda x, z: x + z)
fake("SynthBoth", lambda a: (a * 2, 7))
fake("SynthTest", lambda x: (x > 2, x * 5))
fake("SynthPerm", lambda: (30, 10, 20))
fake("SynthPt", lambda h: (True, (h * 2, h * 3)))
fake("SynthX", lambda: 42)
sys.modules["vs"] = vs
vsc = types.ModuleType("_vsc")
exec(compile(job["vsc"], "_vsc.py", "exec"), vsc.__dict__)
try:
    src, where = vsc.translate(job["code"], job["files"], job["extra"])
except Exception as e:
    print(json.dumps({"error": {"name": type(e).__name__, "message": str(e), "line": getattr(e, "line", None)}}))
    sys.exit(0)
g = dict(vsc.runtime())
try:
    exec(compile(src, "prog.py", "exec"), g)
    print(json.dumps({"py": src, "calls": calls, "messages": messages, "error": None}))
except Exception as e:
    print(json.dumps({"py": src, "calls": calls, "messages": messages, "error": {"name": type(e).__name__, "message": str(e)}}))
`;

/** The table lines of the test functions, written as the generator writes them. */
const SYNTH_TABLE = [
  "synthfirst p ooi", // SynthFirst(VAR a, b; c): Python takes c and returns a, b
  "synthmid p ioi", // SynthMid(x; VAR y; z): VAR in the middle
  "synthboth p bo", // SynthBoth(VAR a, b): a both ways, b out
  "synthtest f oi", // SynthTest(VAR a; x): BOOLEAN, a out
  "synthperm p ooo 3,1,2", // SynthPerm(VAR a, b, c): Python returns c, a, b
  "synthpt f ioo", // SynthPt(h; VAR px, py): BOOLEAN, one point for px and py
  "synthx p xo", // SynthX(VAR junk, out): junk is not taken by Python
].join("\n");

interface FakeRun {
  py: string;
  calls: [string, unknown[]][];
  messages: string[];
  error: { name: string; message: string; line?: number | null } | null;
}

function translateRun(code: string, files: Record<string, string> = {}, extra = SYNTH_TABLE): FakeRun & { translateError?: { name: string; message: string; line: number | null } } {
  const out = execFileSync("python3", ["-I", "-c", FAKE_RUN], {
    input: JSON.stringify({ code, files, extra, vsc: VSC_SOURCE }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const r = JSON.parse(out.trim().split("\n").pop() ?? "{}") as FakeRun & { error: unknown };
  if (r.py === undefined) {
    const e = r.error as { name: string; message: string; line: number | null };
    return { py: "", calls: [], messages: [], error: null, translateError: e };
  }
  return r;
}

const prog = (body: string, decl = "") => `PROCEDURE Main;\n${decl}BEGIN\n${body}\nEND;\nRUN(Main);`;

{
  // VAR first: the Python result's two values go to a and b, the third argument is passed in
  const r = translateRun(prog("  SynthFirst(a, b, 3);\n  Message(a); Message(b);", "VAR a, b : INTEGER;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, [["SynthFirst", [3]]]);
  assert.deepEqual(r.messages, ["30", "300"]);
}
{
  // VAR in the middle, with a value passed on each side of it
  const r = translateRun(prog("  SynthMid(1, y, 4);\n  Message(y);", "VAR y : INTEGER;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, [["SynthMid", [1, 4]]]);
  assert.deepEqual(r.messages, ["5"]);
}
{
  // both ways: the value goes in, and what comes back is set into the variable
  const r = translateRun(prog("  v := 4;\n  SynthBoth(v, w);\n  Message(v); Message(w);", "VAR v, w : INTEGER;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, [["SynthBoth", [4]]]);
  assert.deepEqual(r.messages, ["8", "7"]);
}
{
  // a function with a VAR parameter in a test, and as an assignment
  const r = translateRun(prog("  IF SynthTest(v, 3) THEN Message('yes') ELSE Message('no');\n  ok := SynthTest(v, 1);\n  Message(ok); Message(v);", "VAR v : INTEGER; ok : BOOLEAN;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, [["SynthTest", [3]], ["SynthTest", [1]]]);
  assert.deepEqual(r.messages, ["yes", "FALSE", "5"]);
}
{
  // a return order that differs from the Pascal order: the third value is set into c
  const r = translateRun(prog("  SynthPerm(a, b, c);\n  Message(a); Message(b); Message(c);", "VAR a, b, c : INTEGER;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.messages, ["10", "20", "30"]);
}
{
  // a point for two VAR numbers, in a test
  const r = translateRun(prog("  IF SynthPt(4, px, py) THEN BEGIN Message(px); Message(py) END;", "VAR px, py : REAL;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.messages, ["8", "12"]);
}
{
  // a VAR the Python call doesn't take is left out of the call, and the one it returns is set
  const r = translateRun(prog("  SynthX(j, o);\n  Message(o);", "VAR j, o : INTEGER;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, [["SynthX", []]]);
  assert.deepEqual(r.messages, ["42"]);
}
{
  // a variable element and a record field are VAR arguments, as they are for the scripts' own procedures
  const r = translateRun(prog("  SynthBoth(arr[2], p.f);\n  Message(arr[2]); Message(p.f);", "VAR arr : ARRAY[1..3] OF INTEGER; p : RECORD f : INTEGER; END;\n"));
  assert.equal(r.error, null);
  assert.deepEqual(r.messages, ["0", "7"]);
  const t = translateRun(prog("  arr[2] := 5;\n  SynthBoth(arr[2], p.f);\n  Message(arr[2]);", "VAR arr : ARRAY[1..3] OF INTEGER; p : RECORD f : INTEGER; END;\n"));
  assert.deepEqual(t.messages, ["10"]);
}
{
  // a script's own procedure with the same name as a table entry wins over it
  const r = translateRun(`PROCEDURE SynthFirst(VAR a : INTEGER; c : INTEGER);\nBEGIN\n  a := c + 1;\nEND;\nPROCEDURE Main;\nVAR v : INTEGER;\nBEGIN\n  SynthFirst(v, 9);\n  Message(v);\nEND;\nRUN(Main);`);
  assert.equal(r.error, null);
  assert.deepEqual(r.calls, []);
  assert.deepEqual(r.messages, ["10"]);
}
{
  // the errors: a VAR argument that is not a variable, a wrong count, a procedure used as a value
  const literal = translateRun(prog("  SynthFirst(1, b, 3);", "VAR b : INTEGER;\n"));
  assert.equal(literal.translateError?.message, "argument 1 of SynthFirst is a VAR parameter, so it must be a variable");
  assert.equal(literal.translateError?.line, 4);
  const count = translateRun(prog("  SynthFirst(b, 3);", "VAR b : INTEGER;\n"));
  assert.equal(count.translateError?.message, "SynthFirst takes 3 arguments");
  const value = translateRun(prog("  x := SynthMid(1, y, 4);", "VAR x, y : INTEGER;\n"));
  assert.equal(value.translateError?.message, "SynthMid hands values back through its arguments: call it as a statement");
}
{
  // the table as the real generator wrote it: GetVersion's four values come back in order
  const r = translateRun(prog("  GetVersion(a, b, c, d);", "VAR a, b, c, d : INTEGER;\n"), {}, "");
  assert.match(r.py, /_vsout\('GetVersion', vs\.GetVersion\(\), \[/);
}
{
  // {$INCLUDE}: a plug-in's file, its base name found without case, and one file including another
  const files = {
    "plugin/Helpers.VSI": "{$I more.vsi}\nPROCEDURE Greet;\nBEGIN\n  Message('hi');\n  Hello;\nEND;\n",
    "plugin/more.vsi": "PROCEDURE Hello;\nBEGIN\n  Message('hello');\nEND;\n",
  };
  const r = translateRun("{$INCLUDE helpers.vsi}\nPROCEDURE Main;\nBEGIN\n  Greet;\nEND;\nRUN(Main);", files, "");
  assert.equal(r.error, null);
  assert.deepEqual(r.messages, ["hi", "hello"]);
  // a file that isn't among the plug-in's: the directive's line
  const missing = translateRun("PROCEDURE Main;\nBEGIN\n  {$INCLUDE nowhere.vsi}\nEND;\nRUN(Main);", files, "");
  assert.equal(missing.translateError?.line, 3);
  assert.equal(missing.translateError?.message, "{$INCLUDE nowhere.vsi} isn't one of the plug-in's files");
  // a syntax error in an included file is reported on the line of its directive
  const bad = translateRun("{$INCLUDE bad.vsi}\nPROCEDURE Main;\nBEGIN\n  Message(1);\nEND;\nRUN(Main);", { "bad.vsi": "PROCEDURE X;\nBEGIN\n  Message(1 +);\nEND;\n" }, "");
  assert.equal(bad.translateError?.line, 1);
}
{
  // GOTO is still refused; WITH is a statement of its own
  const r = translateRun(prog("  GOTO 1;"), {}, "");
  assert.equal(r.translateError?.message, "GOTO isn't available in Rodeo's Vectorscript");
}

// every line of the generated table, called with variables for its VAR arguments: as a statement, and for a
// function also in an expression. Each call must translate to the table's call (_vsout) with the right
// arguments; the sixty functions the hand tables missed (GetVersion, GetLBItemPatternIndex...) are among them.
const SWEEP = String.raw`
import json, sys, types
job = json.load(sys.stdin)
vs = types.ModuleType("vs")
vs._param_type = lambda n: None
sys.modules["vs"] = vs
m = types.ModuleType("_vsc")
exec(compile(job["vsc"], "_vsc.py", "exec"), m.__dict__)
out = []
# the hand tables are the translator's own, and take the names first
hand = set(m._VS_OUT) | set(m._VS_FN_OUT) | set(m._VS_OUT_LAST) | set(m._VS_FN_OUT_LAST) | set(m._BUILTIN_VAR)
skipped = []
for name, kind, letters, order in job["entries"]:
    if name in hand:
        skipped.append(name)
        continue
    args = ", ".join("v%d" % i if l in "ob" else "0" for i, l in enumerate(letters))
    decl = "VAR " + ", ".join("v%d" % i for i in range(len(letters))) + " : INTEGER;"
    forms = ["  %s(%s);" % (name, args)]
    if kind == "f":
        forms.append("  ok := %s(%s);" % (name, args))
    for body in forms:
        code = "PROCEDURE Main;\n" + decl + "\nVAR ok : BOOLEAN;\nBEGIN\n" + body + "\nEND;\nRUN(Main);"
        try:
            src, where = m.translate(code)
            # the file reads are translated by read_call (their kinds, then _spread), not _vsout
            if name.lower() in ("read", "readln", "stdread", "stdreadln"):
                ok = ("_spread(vs.%s(" % name) in src
            else:
                ok = ("_vsout(%r, vs.%s(" % (name, name)) in src
            out.append([name, body.strip(), ok, src if not ok else ""])
        except Exception as e:
            out.append([name, body.strip(), False, "%s: %s" % (type(e).__name__, e)])
print(json.dumps({"rows": out, "skipped": skipped, "names": sorted(set(e[0] for e in job["entries"]))}))
`;

{
  const entries = VS_SIGNATURES.split("\n")
    .map((l) => l.trim().split(" "))
    .filter((f) => f.length >= 3 && /^[a-z0-9_]+$/.test(f[0]))
    .map((f) => [f[0], f[1], f[2], f[3] ?? null]);
  assert.ok(entries.length >= 680, "the table has its lines");
  const out = execFileSync("python3", ["-I", "-c", SWEEP], {
    input: JSON.stringify({ vsc: VSC_SOURCE, entries }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const got = JSON.parse(out.trim().split("\n").pop() ?? "{}") as { rows: [string, string, boolean, string][]; skipped: string[]; names: string[] };
  const bad = got.rows.filter((r) => !r[2]).map((r) => `${r[0]} (${r[1]}): ${r[3].slice(0, 200)}`);
  assert.deepEqual(bad, [], "table lines that did not translate to their call");
  // every line of the table is either a hand-table name (the hand tables decide those) or was tried
  const tried = new Set(got.rows.map((r) => r[0]));
  assert.deepEqual(got.names.filter((n) => !tried.has(n) && !got.skipped.includes(n)), [], "table lines never tried");
  assert.deepEqual(got.skipped.filter((n) => tried.has(n)), [], "hand-table names tried");
  assert.ok(entries.filter((e) => e[1] === "f" && !got.skipped.includes(e[0])).length > 0, "functions were tried in expressions");
}

// unit literals: a number with a unit name right after it (1.75in, 25mm, 5/8in, -1.5in) is one length in the
// drawing's units; a unit with a space before it is not a literal, and IN keeps working. A stray comma before
// a colon in a parameter list is tolerated.
{
  const inch = blankSnapshot();
  inch.units = { ...(inch.units as object), mm: 25.4, mark: "in" } as never;
  const program = `PROCEDURE Main;
PROCEDURE Add(a, : REAL; w : REAL);
BEGIN
  Message(a + w);
END;
CONST k_RackU = 1.75in;
VAR x : REAL; n : INTEGER;
BEGIN
  Message(k_RackU);
  x := -1.5in;
  Message(x);
  Message(5/8in);
  n := 2;
  Message(1in/n);
  Message(-60in*n);
  Message(25mm);
  Message(1cm);
  Message(1m);
  Message(1km);
  Message(2pt);
  Message(1IN);
  Message(1ft);
  Message(1yd);
  Message(1mi);
  Message(1um);
  Message(3 IN [1,3]);
  IF 3 IN [1,3] THEN Message('yes');
  Message(Distance3D(0, 0, 0, 1in, 0, 0));
  Add(1, 2);
  Message(.125);
END;
RUN(Main);`;
  const r = ranVs(program, { file: "units.vs" });
  assert.deepEqual(messages(r), ["44.45", "-38.1", "15.875", "12.7", "-3048", "25", "10", "1000", "1000000", "0.705556", "25.4", "304.8", "914.4", "1609344", "0.001", "TRUE", "yes", "25.4", "3", "0.125"], "mm drawing");
  // the same program in an inch drawing: the same lengths, in inches
  const ri = ranVs(program, { file: "units.vs", snapshot: inch });
  assert.deepEqual(messages(ri).slice(0, 2), ["1.75", "-1.5"], "inch drawing");
  assert.equal(messages(ri)[messages(ri).length - 2], "3", "Add(1, 2) in inches");
  assert.equal(messages(ri)[messages(ri).length - 1], "0.125", "a number that starts with a dot");
}

console.log("vscript table, VAR shapes, WITH, errors and includes: ok");
