// Generates src/features/python/vsSignatures.ts: which Vectorscript VAR parameters each vs function
// hands back, read from the public function reference (Vectorworks/developer-scripting, one Markdown
// page per function, with a ```pascal and a ```python block). Run from web/:
//
//   npx tsx scripts/vs-signatures.ts [extracted repo folder] [report file]
//
// With no folder, the repository's tarball is fetched with gh into a temporary folder. The report
// file, if given, lists the pages that could not be read or whose two blocks disagree.
//
// Only names and parameter letters are written: no text from the pages. Each function with a VAR
// parameter the Python call returns gets one line: its lowercase name, p (procedure) or f (function),
// one letter per Pascal parameter (i in, o out, b in and out, x not taken by Python), and, when the
// Python return order differs from the Pascal order, the 1-based Pascal positions in return order.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const REPO = "Vectorworks/developer-scripting";
const OUT = join(dirname(new URL(import.meta.url).pathname), "..", "src", "features", "python", "vsSignatures.ts");

interface Param {
  name: string;
  isVar: boolean;
  pos: number;
}

interface Pascal {
  kind: "p" | "f";
  name: string;
  params: Param[];
}

interface Python {
  name: string;
  args: string[];
  /** each return statement's items, the names or expressions of a returned tuple */
  returns: string[][];
}

interface Line {
  name: string;
  text: string;
}

function fetchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vs-signatures-"));
  const tar = join(dir, "repo.tar.gz");
  const bytes = execFileSync("gh", ["api", `repos/${REPO}/tarball/HEAD`], { maxBuffer: 512 * 1024 * 1024 });
  writeFileSync(tar, bytes);
  const out = join(dir, "repo");
  mkdirSync(out);
  execFileSync("tar", ["-xzf", tar, "-C", out]);
  return out;
}

function functionsDir(root: string): string {
  const direct = join(root, "Function Reference", "Functions");
  if (existsSync(direct)) return direct;
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const nested = join(root, e.name, "Function Reference", "Functions");
    if (existsSync(nested)) return nested;
  }
  throw new Error(`no Function Reference/Functions folder under ${root}`);
}

/** The text of each fenced block in a language, in order. */
function blocks(text: string, lang: string): string[] {
  const re = /^```([A-Za-z]*)[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1].toLowerCase() === lang) out.push(m[2]);
  }
  return out;
}

function stripPascalComments(s: string): string {
  return s.replace(/\{[^}]*\}/g, " ").replace(/\(\*[\s\S]*?\*\)/g, " ").replace(/\/\/[^\n]*/g, " ");
}

function parsePascal(text: string): Pascal | null {
  const src = stripPascalComments(text);
  const m = /\b(PROCEDURE|FUNCTION)\s+([A-Za-z_]\w*)\s*(?:\(([\s\S]*?)\))?\s*(?::[^;]*)?;/i.exec(src);
  if (!m) return null;
  const params: Param[] = [];
  for (const group of (m[3] ?? "").split(";")) {
    const g = group.trim();
    if (!g) continue;
    const gm = /^(VAR\s+)?([\s\S]*?)\s*:\s*[\s\S]*$/i.exec(g);
    if (!gm) return null;
    for (const n of gm[2].split(",")) {
      // a few pages write a parameter's name with a space in it ("the column index"): read it as one name
      const name = n.trim().replace(/\s+/g, "");
      if (!/^[A-Za-z_]\w*$/.test(name)) return null;
      params.push({ name: name.toLowerCase(), isVar: !!gm[1], pos: params.length + 1 });
    }
  }
  return { kind: m[1].toUpperCase() === "FUNCTION" ? "f" : "p", name: m[2], params };
}

/** The items of a Python expression: a tuple's, or the one expression itself; null for None. */
function items(expr: string): string[] | null {
  let e = expr.trim();
  if (e === "None" || e === "none" || e === "") return null;
  // a whole tuple in brackets: split its top-level commas
  if (e.startsWith("(") && matchingClose(e, 0) === e.length - 1) {
    e = e.slice(1, -1).trim();
    if (e.endsWith(",")) e = e.slice(0, -1);
  }
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of e) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function matchingClose(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parsePython(text: string): Python | null {
  const m = /^def\s+(?:vs\.)?([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/m.exec(text);
  if (!m) return null;
  const args = m[2]
    .split(",")
    .map((a) => a.split("=")[0].trim())
    .filter((a) => a.length > 0)
    .map((a) => a.toLowerCase());
  const body = text.slice(m.index + m[0].length);
  const returns: string[][] = [];
  const re = /^[ \t]*return\b([^\n]*)$/gm;
  let r: RegExpExecArray | null;
  while ((r = re.exec(body)) !== null) {
    const got = items(r[1]);
    if (got !== null) returns.push(got);
  }
  return { name: m[1], args, returns };
}

const ident = (s: string): string | null => (/^[A-Za-z_]\w*$/.test(s) ? s.toLowerCase() : null);

interface Verdict {
  line?: Line;
  /** a point stands for two of the VAR parameters: the one Python value is spread by the runtime */
  grouped?: boolean;
  /** why the blocks disagree, when they do */
  problem?: string;
}

/**
 * The VAR parameters each returned item stands for, in Python's return order: a named item is the
 * VAR parameter of its name, an unnamed one (a point for two numbers) takes as many as the items
 * after it leave. Null when the items cannot cover the VAR parameters.
 */
function assign(outs: string[], vars: Param[]): number[][] | null {
  const groups: number[][] = [];
  const used = new Set<number>();
  for (let k = 0; k < outs.length; k++) {
    const n = ident(outs[k]);
    const named = n === null ? -1 : vars.findIndex((v, i) => v.name === n && !used.has(i));
    if (named >= 0) {
      groups.push([named]);
      used.add(named);
      continue;
    }
    const left = vars.length - used.size;
    const size = left - (outs.length - k - 1);
    if (size < 1) return null;
    const group: number[] = [];
    for (let i = 0; i < vars.length && group.length < size; i++) {
      if (!used.has(i)) {
        group.push(i);
        used.add(i);
      }
    }
    if (group.length < size) return null;
    groups.push(group);
  }
  return groups;
}

/** The letters and the return order of one function, from its two blocks. */
function classify(pas: Pascal, py: Python): Verdict {
  const vars = pas.params.filter((p) => p.isVar);
  if (vars.length === 0) return {};
  const counts = new Set(py.returns.map((r) => r.length));
  if (counts.size > 1) return { problem: "python returns differ in count" };
  // a function's own result comes first; a procedure's may be written as a type name (STRING) first
  let outs = py.returns.length > 0 ? py.returns[0] : [];
  let groups: number[][] | null = null;
  if (outs.length > 0) {
    if (pas.kind === "f") {
      const allVar = outs.every((o) => { const n = ident(o); return n !== null && vars.some((v) => v.name === n); });
      if (!allVar) outs = outs.slice(1);
      groups = assign(outs, vars);
    } else {
      groups = assign(outs, vars);
      if (groups === null && outs.length > 1) {
        outs = outs.slice(1);
        groups = assign(outs, vars);
      }
    }
  }
  if (outs.length === 0 || groups === null) {
    if (py.returns.length === 0 || outs.length === 0) {
      // a function that hands back only its result: its VAR parameters are plain inputs
      if (pas.kind === "f") return {};
      return { problem: "python block returns nothing" };
    }
    return { problem: `python returns ${outs.length} values for ${vars.length} VAR parameters` };
  }
  const defNames = new Set(py.args);
  const letters: Record<number, string> = {};
  const order: number[] = [];
  let grouped = false;
  groups.forEach((g, k) => {
    const item = ident(outs[k]);
    if (g.length > 1) grouped = true;
    for (const i of g) {
      order.push(vars[i].pos);
      letters[vars[i].pos] = defNames.has(vars[i].name) || (item !== null && defNames.has(item)) ? "b" : "o";
    }
  });
  for (const p of pas.params) {
    if (!p.isVar) letters[p.pos] = "i";
    else if (letters[p.pos] === undefined) letters[p.pos] = defNames.has(p.name) ? "i" : "x";
  }
  // the Python arguments: the non-VAR ones, and the both-ways ones
  const taken = pas.params.filter((p) => letters[p.pos] === "i" || letters[p.pos] === "b").length;
  if (py.args.length !== taken) return { problem: `python takes ${py.args.length} arguments, the Pascal ${taken}` };
  const letterStr = pas.params.map((p) => letters[p.pos]).join("");
  // the return order, as Pascal positions, only when it differs from the Pascal order
  const identity = order.every((pos, k) => k === 0 || order[k - 1] < pos);
  const perm = identity ? "" : ` ${order.join(",")}`;
  const name = py.name.toLowerCase();
  return { line: { name, text: `${name} ${pas.kind} ${letterStr}${perm}` }, grouped };
}

function main(): void {
  const [folder, report] = process.argv.slice(2);
  const root = folder ?? fetchRepo();
  const dir = functionsDir(root);
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && statSync(join(dir, f)).isFile()).sort();
  const lines: Line[] = [];
  const problems: string[] = [];
  let withVar = 0;
  let noVar = 0;
  let unreadable = 0;
  let grouped = 0;
  const seen = new Set<string>();
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    // the signature is the first block of each language that reads as one (a page may open with constants)
    const pas = blocks(text, "pascal").map(parsePascal).find((x) => x !== null) ?? null;
    const py = blocks(text, "python").map(parsePython).find((x) => x !== null) ?? null;
    if (!pas || !py) {
      unreadable++;
      problems.push(`- ${f}: ${!pas ? "pascal block not read" : "python block not read"}`);
      continue;
    }
    if (pas.params.every((p) => !p.isVar)) {
      noVar++;
      continue;
    }
    withVar++;
    const v = classify(pas, py);
    if (v.problem) {
      problems.push(`- ${f}: ${v.problem}`);
      continue;
    }
    if (v.line) {
      if (seen.has(v.line.name)) {
        problems.push(`- ${f}: name ${v.line.name} already written`);
        continue;
      }
      seen.add(v.line.name);
      if (v.grouped) grouped++;
      lines.push(v.line);
    }
  }
  lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const body = lines.map((l) => l.text).join("\n");
  const source = [
    "// Generated by web/scripts/vs-signatures.ts from the public function reference (names and parameter",
    "// letters only). Do not edit by hand: run `npx tsx scripts/vs-signatures.ts` from web/.",
    `// ${lines.length} functions with a VAR parameter the Python call hands back.`,
    "// Each line: lowercase name, p (procedure) or f (function), one letter per Pascal parameter (i in,",
    "// o out, b in and out, x not taken by Python), then the 1-based Pascal positions in Python's return",
    "// order when that differs from the Pascal order.",
    "",
    "export const VS_SIGNATURE_COUNT = " + lines.length + ";",
    "",
    "export const VS_SIGNATURES = `",
    body,
    "`;",
    "",
  ].join("\n");
  writeFileSync(OUT, source);
  if (report) {
    writeFileSync(report, ["# vs signatures: pages that did not read or disagree", "", `${problems.length} pages.`, "", ...problems, ""].join("\n"));
  }
  console.log(`pages parsed: ${files.length}`);
  console.log(`pages with no VAR parameter: ${noVar}`);
  console.log(`functions with VAR parameters: ${withVar}`);
  console.log(`functions written (VAR values returned): ${lines.length}`);
  console.log(`pages that could not be read: ${unreadable}`);
  console.log(`pages whose blocks disagree: ${problems.length - unreadable}`);
  console.log(`grouped (points) written: ${grouped}`);
  console.log(`written: ${OUT}`);
}

main();
