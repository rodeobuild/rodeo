// Runs the worksheet formula reader and writer over every formula cell and database criteria in
// the sample drawings. Run from web/:
//   npx tsx src/core/formula/corpus.check.ts [files...]
// With no arguments: ../samples/sample.vwx if present, and every .vwx directly inside each
// folder of ../samples/demos. Prints counts and token ids only; no drawing text is printed.
// Exits 1 when a stream fails to decode or does not re-encode to its own bytes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Rec } from "../records.ts";
import { openVwx } from "../index.ts";
import { u16, u32 } from "../bytes.ts";
import { FormulaError, type Node } from "./ast.ts";
import { decode, encode } from "./tokens.ts";
import { parse, type ParseContext, toText } from "./text.ts";
import { gridAt, cellAt, rowAt, FORMAT_SIZE, RESULT_SIZE, SHEET_COUNTS, SHEET_TABLE, KIND_FORMULA, ROW_DATABASE } from "../worksheet.ts";
import { readFormat, RECORD_FORMAT, type FormatDef } from "../params.ts";
import { hex4 } from "./names.ts";

const WORKSHEET = 18;
const SAMPLES = resolve("../samples");

interface Stats {
  files: number;
  streams: number;
  formulas: number;
  criteria: number;
  decodeFail: number;
  encodeFail: number;
  exact: number;
  mismatch: number;
  textSame: number;
  textDiff: number;
  textFail: number;
  fieldMatch: number;
  fieldDiffer: number;
  fieldNoFormat: number;
  fieldNotInFormat: number;
  strIndexOk: number;
  strIndexBad: number;
  strZeroOk: number;
  strZeroInNames: number;
  optionRefs: number;
}
const total: Stats = {
  files: 0, streams: 0, formulas: 0, criteria: 0, decodeFail: 0, encodeFail: 0, exact: 0, mismatch: 0,
  textSame: 0, textDiff: 0, textFail: 0, fieldMatch: 0, fieldDiffer: 0, fieldNoFormat: 0, fieldNotInFormat: 0,
  strIndexOk: 0, strIndexBad: 0, strZeroOk: 0, strZeroInNames: 0, optionRefs: 0,
};

/** the files to check: the argument list, or the default sample and demo drawings */
function files(args: string[]): { label: string; path: string }[] {
  if (args.length) return args.map((path) => ({ label: resolve(path).split("/").slice(-1)[0] ?? path, path }));
  const out: { label: string; path: string }[] = [];
  const sample = join(SAMPLES, "sample.vwx");
  if (existsSync(sample)) out.push({ label: "samples/sample.vwx", path: sample });
  const demos = join(SAMPLES, "demos");
  if (existsSync(demos)) {
    for (const folder of readdirSync(demos).sort()) {
      const dir = join(demos, folder);
      if (!statSync(dir).isDirectory()) continue;
      readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith(".vwx"))
        .sort()
        .forEach((f, i) => out.push({ label: `demos/${folder}#${i + 1}`, path: join(dir, f) }));
    }
  }
  return out;
}

/** every record, its children included */
function* allRecs(recs: readonly Rec[]): Generator<Rec> {
  const stack = [...recs];
  while (stack.length) {
    const r = stack.pop()!;
    yield r;
    stack.push(...r.children);
  }
}

/** the first byte where two streams differ, and the token ids at that spot */
function diffAt(a: Uint8Array, b: Uint8Array): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const at = i & ~1;
  const tok = (x: Uint8Array) => (at + 2 <= x.length ? hex4(u16(x, at)) : "none");
  return `first difference at byte ${i}: token ${tok(a)} written as ${tok(b)}, lengths ${a.length} and ${b.length}`;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function run(label: string, doc: { recs: Rec[]; names: Map<number, string> }): void {
  const names = doc.names;
  const byName = new Map<string, number>();
  for (const [i, n] of names) if (!byName.has(n)) byName.set(n, i);
  const nameTexts = new Set(names.values());
  const formats = new Map<number, FormatDef>();
  for (const r of allRecs(doc.recs)) {
    if (r.type === RECORD_FORMAT && !formats.has(r.nameIndex)) formats.set(r.nameIndex, readFormat(r.data));
  }
  const ctx: ParseContext = {
    nameIndex: (n) => byName.get(n) ?? 0,
    field: (rec, f) => {
      const idx = byName.get(rec);
      const fd = idx === undefined ? undefined : formats.get(idx)?.fields.find((x) => x.name === f);
      return fd ? { type: fd.type, offset: fd.off } : null;
    },
  };
  const s = { streams: 0, formulas: 0, criteria: 0, decodeFail: 0, encodeFail: 0, exact: 0, mismatch: 0, textSame: 0, textDiff: 0, textFail: 0 };

  const walk = (n: Node): void => {
    switch (n.k) {
      case "field": {
        const fmt = formats.get(n.recRef);
        if (!fmt) total.fieldNoFormat++;
        else {
          const fd = fmt.fields.find((x) => x.name === n.field);
          if (!fd) total.fieldNotInFormat++;
          else if (fd.type === n.type && fd.off === n.offset) total.fieldMatch++;
          else total.fieldDiffer++;
        }
        return;
      }
      case "str":
        if (n.tok === 0x065b) {
          if (n.ref !== 0) {
            if (names.get(n.ref) === n.v) total.strIndexOk++;
            else total.strIndexBad++;
          } else if (nameTexts.has(n.v)) total.strZeroInNames++;
          else total.strZeroOk++;
        } else if (n.ref !== 0) total.optionRefs++;
        return;
      case "call":
        n.args.forEach((a) => walk(a));
        return;
      case "if":
        walk(n.test);
        walk(n.then);
        walk(n.else);
        return;
      case "op":
        walk(n.a);
        walk(n.b);
        return;
      case "post":
      case "paren":
        walk(n.a);
        return;
      case "set":
        n.items.forEach((a) => walk(a));
        return;
      default:
        return;
    }
  };

  const one = (stream: Uint8Array, at: { row: number; col: number }, criteria: boolean): void => {
    s.streams++;
    if (criteria) total.criteria++;
    else total.formulas++;
    let node: Node;
    try {
      node = decode(stream);
    } catch (e) {
      s.decodeFail++;
      console.log(`  decode failed: ${e instanceof FormulaError ? (e as Error).message : "unexpected error"}`);
      return;
    }
    let re: Uint8Array;
    try {
      re = encode(node);
    } catch (e) {
      s.encodeFail++;
      console.log(`  encode failed: ${(e as Error).message}`);
      return;
    }
    if (same(re, stream)) s.exact++;
    else {
      s.mismatch++;
      console.log(`  re-encode differs: ${diffAt(stream, re)}`);
    }
    walk(node);
    try {
      const text = toText(node, at);
      const back = encode(parse(text, { ...ctx, at }));
      if (same(back, stream)) s.textSame++;
      else {
        s.textDiff++;
        console.log(`  text round trip differs: ${diffAt(stream, back)}`);
      }
    } catch {
      // the message can name the drawing's records and fields, so only the fact is printed
      s.textFail++;
    }
  };

  for (const rec of doc.recs) {
    if (rec.type !== WORKSHEET) continue;
    const d = rec.data;
    const g = gridAt(d, SHEET_COUNTS, SHEET_TABLE);
    if (!g) continue;
    for (let r = 0; r < g.rows; r++) {
      const head = rowAt(g, r);
      if (head !== null && u16(d, head) === ROW_DATABASE) {
        const clen = u32(d, head + 14);
        if (head + 18 + clen <= d.length) one(d.subarray(head + 18, head + 18 + clen), { row: r, col: 0 }, true);
        else console.log("  criteria runs past its record");
      }
      for (let c = 0; c < g.cols; c++) {
        const p = cellAt(g, r, c);
        if (p === null || d[p + FORMAT_SIZE] !== KIND_FORMULA) continue;
        const len = u32(d, p + FORMAT_SIZE + 2);
        const start = p + FORMAT_SIZE + 6 + RESULT_SIZE;
        if (start + len > d.length) {
          console.log("  formula runs past its record");
          continue;
        }
        one(d.subarray(start, start + len), { row: r, col: c }, false);
      }
    }
  }
  total.streams += s.streams;
  total.decodeFail += s.decodeFail;
  total.encodeFail += s.encodeFail;
  total.exact += s.exact;
  total.mismatch += s.mismatch;
  total.textSame += s.textSame;
  total.textDiff += s.textDiff;
  total.textFail += s.textFail;
  console.log(
    `${label}: streams ${s.streams} (formulas ${s.formulas}, criteria ${s.criteria}), decode failures ${s.decodeFail}, ` +
      `encode failures ${s.encodeFail}, byte-exact ${s.exact}, mismatches ${s.mismatch}, ` +
      `text round trips same ${s.textSame}, different ${s.textDiff}, failed ${s.textFail}`,
  );
}

const list = files(process.argv.slice(2));
for (const f of list) {
  const buf = readFileSync(f.path);
  total.files++;
  const session = openVwx(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), "corpus.vwx") as unknown as {
    doc: { recs: Rec[]; names: Map<number, string> };
  };
  run(f.label, session.doc);
}

console.log(
  `all files (${total.files}): streams ${total.streams} (formulas ${total.formulas}, criteria ${total.criteria}); ` +
    `decode failures ${total.decodeFail}; encode failures ${total.encodeFail}; byte-exact ${total.exact}; mismatches ${total.mismatch}`,
);
console.log(`text round trips: same ${total.textSame}, different ${total.textDiff}, failed ${total.textFail}`);
console.log(
  `field (type, offset) against the record format: match ${total.fieldMatch}, differ ${total.fieldDiffer}, ` +
    `no format for its record ${total.fieldNoFormat}, field not in format ${total.fieldNotInFormat}`,
);
console.log(
  `strings (0x065b): with index matching the name table ${total.strIndexOk}, not matching ${total.strIndexBad}; ` +
    `index 0 and no name-table entry of that text ${total.strZeroOk}, index 0 but the text is in the name table ${total.strZeroInNames}`,
);
console.log(`option and keyword strings (0x0695, 0x0696) with a non-zero index: ${total.optionRefs}`);

if (total.decodeFail || total.encodeFail || total.mismatch) {
  console.log("FAIL: some streams do not decode and re-encode to their own bytes");
  process.exit(1);
}
console.log("ok: every stream decodes and re-encodes to its own bytes");
