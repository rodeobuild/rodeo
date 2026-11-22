// Measures database.ts against the cached values in the sample drawings: for every database row of
// every worksheet, the object set, the subrows and their grouping, the display order, each cell and
// the header's cached totals. Run from web/:
//   NODE_OPTIONS=--max-old-space-size=12000 npx tsx src/core/formula/databaseCorpus.check.ts [files...]
// With no arguments: ../samples/sample.vwx if present, and every .vwx directly inside each folder of
// ../samples/demos. Prints counts, token ids, field/record parameter names and the cache's kinds of
// boolean cell only; no values or texts from a drawing.
//
// A claimed cell that differs is "stale" only when the same column (same criteria text and same
// column formula text, via toText) is claimed and matches every cell in at least one OTHER file;
// otherwise it is a real mismatch. Exits 1 on real mismatches (cells or headers).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { openVwx } from "../index.ts";
import { u32 } from "../bytes.ts";
import type { Node, Value } from "./ast.ts";
import { decode } from "./tokens.ts";
import { toText } from "./text.ts";
import { cellAt, DATABASE_BLOCK, DATABASE_OBJECTS, DATABASE_ORDER, FORMAT_SIZE, gridAt, KIND_FORMULA, RESULT_SIZE, SHEET_COUNTS, SHEET_TABLE } from "../worksheet.ts";
import { type DatabaseBlockRecords, type DatabaseCell, readDatabaseRows, type DatabaseRow } from "../worksheetDb.ts";
import { type ColumnDef, compareValues, databaseRow, type DatabaseResult, type IndexedObject, matchCriteria, objectIndex } from "./database.ts";

const WORKSHEET = 18;
const SAMPLES = resolve("../samples");
const TOLERANCE = 1e-6;
const POPUP = new Set([8, 9]);
const BOOLEAN = 2;

type Tally = Record<string, number>;
const tally: Tally = {};
const inc = (k: string, n = 1): void => {
  tally[k] = (tally[k] ?? 0) + n;
};
/** column instances by reason (all rows): why a column is not compared */
const reasons: Tally = {};
const why = (k: string, n = 1): void => {
  reasons[k] = (reasons[k] ?? 0) + n;
};
/** rows whose criteria are not worked out, by reason */
const rowReasons: Tally = {};
/** rows whose file order is not ascending under our comparison, by the first pair that breaks it */
const badOrder: Tally = {};

/** null when the file's display order is ascending under the sort columns (ties aside); else which column and value kinds break it */
function sortedBy(r: DatabaseResult, cols: (ColumnDef | null)[], fileOrder: number[], fileSub: string[], ourSub: string[]): string | null {
  const ours = new Map<string, number>();
  r.subrows.forEach((_, i) => ours.set(ourSub[i]!, i));
  const sortCols = cols.map((c, i) => ({ c, i })).filter((x) => x.c && x.c.sort !== "none").sort((a, b) => a.c!.precedence - b.c!.precedence);
  const kind = (v: Value) => (v === null || v === "" ? "blank" : typeof v === "number" ? "number" : typeof v === "string" ? "text" : "other");
  for (let p = 0; p + 1 < fileOrder.length; p++) {
    const a = r.subrows[ours.get(fileSub[fileOrder[p]!]!)!]!;
    const b = r.subrows[ours.get(fileSub[fileOrder[p + 1]!]!)!]!;
    for (const { c, i } of sortCols) {
      const d = compareValues(a.values[i]!, b.values[i]!) * (c!.sort === "descending" ? -1 : 1);
      if (d < 0) break;
      if (d > 0) return `${c!.sort} column ${i + 1}: ${kind(a.values[i]!)} before ${kind(b.values[i]!)}`;
    }
  }
  return null;
}
const rowWhy = (k: string): void => {
  rowReasons[k] = (rowReasons[k] ?? 0) + 1;
};
const badShapes: Tally = {};

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

/** the shape of a formula as token ids and function names (no values, no names of fields) */
function shape(n: Node): string {
  switch (n.k) {
    case "field": return "F";
    case "str": return "S";
    case "int": case "num": return "N";
    case "bool": return "B";
    case "word": return "W";
    case "kw": return `K${n.id.toString(16)}`;
    case "paren": return `(${shape(n.a)})`;
    case "if": return `IF(${shape(n.test)},${shape(n.then)},${shape(n.else)})`;
    case "post": return `[${n.op.toString(16)}](${shape(n.a)})`;
    case "op": return `${n.op.toString(16)}(${shape(n.a)},${shape(n.b)})`;
    case "call": return `C${n.fn.toString(16)}(${n.args.map(shape).join(",")})`;
    case "set": return `SET(${n.items.length})`;
    default: return n.k;
  }
}

/** every field node in a formula (record.field names only) */
function fieldNodes(n: Node, out: Extract<Node, { k: "field" }>[] = []): Extract<Node, { k: "field" }>[] {
  switch (n.k) {
    case "field": out.push(n); break;
    case "paren": case "post": fieldNodes(n.a, out); break;
    case "neg": fieldNodes(n.a, out); break;
    case "if": fieldNodes(n.test, out); fieldNodes(n.then, out); fieldNodes(n.else, out); break;
    case "op": fieldNodes(n.a, out); fieldNodes(n.b, out); break;
    case "call": n.args.forEach((a) => fieldNodes(a, out)); break;
    default: break;
  }
  return out;
}

function formulaAt(d: Uint8Array, p: number): Uint8Array | null {
  if (d[p + FORMAT_SIZE] !== KIND_FORMULA) return null;
  const len = u32(d, p + FORMAT_SIZE + 2);
  const start = p + FORMAT_SIZE + 6 + RESULT_SIZE;
  return start + len <= d.length ? d.subarray(start, start + len) : null;
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(b));
}

/** one claimed column of one row, compared with the file's cells */
interface ColRec {
  file: number;
  key: string;
  label: string;
  popup: boolean;
  bool: boolean;
  cells: number;
  equal: number;
  /** cells that differ (either side unmatched) */
  diffs: number;
  stale: boolean;
  shapeText: string;
  /** the column's formula is a bracketed field */
  bracketed: boolean;
  /** the header's cached total differs from the sum of our cells */
  headerBad: boolean;
}

interface FileStats {
  label: string;
  rows: number;
  rowsClaimed: number;
  rowsExact: number;
  rowsGroupingExact: number;
  rowsOrderExact: number;
  rowsOrderExactNoRank: number;
  /** rows with a sort column claimed, grouping exact */
  rowsSortClaimed: number;
  /** column instances in all rows */
  instances: number;
  /** column instances in rows whose criteria are worked out and whose objects and grouping match */
  instancesCompared: number;
  instancesGroupingExact: number;
  headers: number;
  headersMatch: number;
  headersBad: number;
  recs: ColRec[];
}

function sameSet(a: number[], b: number[]): boolean {
  const x = [...a].sort((p, q) => p - q);
  const y = [...b].sort((p, q) => p - q);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function cacheClass(c: DatabaseCell | null): string {
  if (c === null) return "no cell";
  if (c.raw) return "undecoded";
  if (typeof c.value === "number") return `number ${c.int ? "(whole)" : ""}`.trim();
  const t = c.value.trim().toLowerCase();
  return ["yes", "no", "true", "false", "y", "n", "on", "off", ""].includes(t) ? `text '${t}'` : "text (other)";
}

function checkFile(fileIndex: number, label: string, path: string): FileStats {
  const st: FileStats = { label, rows: 0, rowsClaimed: 0, rowsExact: 0, rowsGroupingExact: 0, rowsOrderExact: 0, rowsOrderExactNoRank: 0, rowsSortClaimed: 0, instances: 0, instancesCompared: 0, instancesGroupingExact: 0, headers: 0, headersMatch: 0, headersBad: 0, recs: [] };
  const buf = readFileSync(path);
  const session = openVwx(new Uint8Array(buf.buffer, buf.byteOffset, buf.length), "corpus.vwx") as unknown as { doc: any };
  const doc = session.doc;
  const units: string = doc.info.units;
  const t0 = Date.now();
  const index = objectIndex(doc);
  console.log(`${label}: index ${index.objects.length} objects in ${Date.now() - t0} ms`);
  for (const rec of doc.recs as any[]) {
    if (rec.type !== WORKSHEET) continue;
    const sheet: Uint8Array = rec.data;
    const g = gridAt(sheet, SHEET_COUNTS, SHEET_TABLE);
    if (!g) continue;
    const blocks = new Map<number, DatabaseBlockRecords>();
    for (const b of rec.children.filter((c: any) => c.type === DATABASE_BLOCK)) {
      const child = (type: number) => b.children.find((k: any) => k.type === type)?.data ?? null;
      blocks.set(b.nameIndex, { data: b.data, order: child(DATABASE_ORDER), objects: child(DATABASE_OBJECTS) });
    }
    const rows: DatabaseRow[] = readDatabaseRows(sheet, blocks);
    for (const row of rows) {
      st.rows++;
      const crit = decode(row.criteria);
      const critKey = toText(crit);
      const cols: (ColumnDef | null)[] = row.columns.map((c, ci) => {
        const p = cellAt(g, row.row, ci);
        if (p === null) return null;
        const f = formulaAt(sheet, p);
        if (!f) return null;
        return { formula: decode(f), summarize: c.summarize, sort: c.sort, precedence: c.precedence, sum: c.sum };
      });
      const live = cols.filter((c): c is ColumnDef => c !== null);
      st.instances += live.length;
      for (const c of live) {
        if (c.formula.k === "field" && c.formula.type === BOOLEAN) inc("bool.instances_all_rows");
        if (c.formula.k === "field" && POPUP.has(c.formula.type)) inc("popup.instances_all_rows");
      }

      const cm = matchCriteria(index, crit);
      if (cm.unsupported) {
        live.forEach(() => why(`row criteria not worked out: ${cm.unsupported}`));
        rowWhy(cm.unsupported);
        inc("rows.criteria_not_claimed");
        if (/isn't named/.test(cm.unsupported)) {
          const fileRefs = row.objects.map((o) => o.ref);
          for (const v of [true, false]) {
            const h = matchCriteria(index, crit, { unnamedKeyword: () => v });
            if (h.unsupported) continue;
            inc(`unnamed.as_${v}.${sameSet(fileRefs, h.objects.map((o) => o.nameIndex)) ? "exact" : "differs"}`);
          }
        }
        continue;
      }
      st.rowsClaimed++;
      // the file's own display order, as ranks: a subrow's rank is its place in the file's order, matched to
      // ours by its objects' name indexes (the k-th of ours with a given signature gets the k-th of the file's)
      const sig = (refs: number[]) => [...refs].sort((a, b) => a - b).join(",");
      const fileSubSig: string[] = row.subrows.map((_, j) => sig(row.objects.filter((o) => o.subrow === j).map((o) => o.ref)));
      const places = new Map<string, number[]>();
      row.order.forEach((sub, pos) => {
        const k = fileSubSig[sub]!;
        places.set(k, [...(places.get(k) ?? []), pos]);
      });
      const duplicates = new Set(fileSubSig).size !== fileSubSig.length;
      if (duplicates) inc("rows.same_signature_subrows");
      const rank = (objs: readonly IndexedObject[]): number | undefined => places.get(sig(objs.map((o) => o.nameIndex)))?.shift();
      const cresBase: DatabaseResult = databaseRow(index, crit, cols, units);
      const cres: DatabaseResult = databaseRow(index, crit, cols, units, { rank });

      // (1) object set against the file's list, by name index as a multiset
      const fileRefs = row.objects.map((o) => o.ref);
      const ourRefs = cres.subrows.flatMap((s) => s.objects.map((o: IndexedObject) => o.nameIndex));
      const exact = sameSet(fileRefs, ourRefs);
      if (exact) st.rowsExact++;
      else {
        inc("rows.object_set_differs");
        live.forEach(() => why("row objects differ from the file's list (column not compared)"));
        continue;
      }

      // (2) grouping and order: subrows matched by their objects' name indexes (a multiset)
      const ourSubSig: string[] = cres.subrows.map((sr) => sig(sr.objects.map((o: IndexedObject) => o.nameIndex)));
      const fileCount = new Map<string, number>();
      for (const k of fileSubSig) fileCount.set(k, (fileCount.get(k) ?? 0) + 1);
      const ourCount = new Map<string, number>();
      for (const k of ourSubSig) ourCount.set(k, (ourCount.get(k) ?? 0) + 1);
      const groupingOk = fileCount.size === ourCount.size && [...ourCount].every(([k, v]) => fileCount.get(k) === v);
      if (groupingOk) st.rowsGroupingExact++;
      else inc("rows.grouping_differs");
      const orderIs = (r: DatabaseResult) => r.orderKnown && r.order.length === row.order.length && r.order.every((ours, i) => ourSubSig[ours] === fileSubSig[row.order[i]!]);
      const orderOk = groupingOk && orderIs(cres);
      const sorted = cols.some((c) => c && c.sort !== "none");
      if (groupingOk && cres.orderKnown && sorted) st.rowsSortClaimed++;
      if (orderIs(cresBase)) st.rowsOrderExactNoRank++;
      if (orderOk) st.rowsOrderExact++;
      else if (groupingOk && cres.orderKnown) inc("rows.order_differs");
      else if (groupingOk) inc("rows.order_not_worked_out");
      // the file's order must be ascending under our comparison (sort keys only, ties aside): if not, a real finding
      const bad = groupingOk && cres.orderKnown ? sortedBy(cres, cols, row.order, fileSubSig, ourSubSig) : null;
      if (bad !== null) {
        inc("rows.file_order_not_ascending");
        badOrder[bad] = (badOrder[bad] ?? 0) + 1;
      }
      if (!groupingOk) {
        live.forEach(() => why("row grouping differs from the file's (column not compared)"));
        continue;
      }

      // (3) cells and header, per column
      cols.forEach((c, ci) => {
        if (c === null) return;
        st.instancesGroupingExact++;
        const cf = cres.unsupported[ci];
        if (cf !== null) {
          why(`column: ${cf}`);
          return;
        }
        st.instancesCompared++;
        // header
        let headerBadNow = false;
        const hv = cres.header[ci];
        const cacheHeader = row.columns[ci]!.result;
        if (cacheHeader && hv !== null) {
          st.headers++;
          if (typeof hv === "number" && near(hv, cacheHeader.value)) st.headersMatch++;
          else {
            headerBadNow = true;
            st.headersBad++;
          }
        }
        // cells: per signature group, our values against the file's, as multisets
        const groups = new Map<string, { ours: Value[]; file: (DatabaseCell | null)[] }>();
        const grp = (k: string) => {
          let gr = groups.get(k);
          if (!gr) {
            gr = { ours: [], file: [] };
            groups.set(k, gr);
          }
          return gr;
        };
        cres.subrows.forEach((sr, i) => grp(ourSubSig[i]!).ours.push(sr.values[ci] ?? null));
        row.subrows.forEach((fs, j) => grp(fileSubSig[j]!).file.push(fs.cells[ci] ?? null));
        let n = 0;
        let equal = 0;
        let diffs = 0;
        const boolCache: string[] = [];
        for (const gr of groups.values()) {
          const cells = gr.file.length;
          n += cells;
          const left = [...gr.file];
          let matched = 0;
          for (const v of gr.ours) {
            const at = left.findIndex((cf2) => cellMatches(v, cf2));
            if (at >= 0) {
              left.splice(at, 1);
              matched++;
            }
          }
          equal += matched;
          diffs += Math.max(cells, gr.ours.length) - matched;
          for (const cc of gr.file) boolCache.push(cacheClass(cc));
        }
        const fields = fieldNodes(c.formula);
        const rec: ColRec = {
          file: fileIndex,
          key: `${critKey}\u0001${toText(c.formula)}`,
          label: fields.length ? fields.map((f) => `${f.rec}.${f.field}`).join(" + ") : `(no field: ${shape(c.formula)})`,
          popup: fields.some((f) => POPUP.has(f.type)),
          bool: c.formula.k === "field" && c.formula.type === BOOLEAN,
          cells: n,
          equal,
          diffs,
          stale: false,
          shapeText: shape(c.formula),
          headerBad: headerBadNow,
          bracketed: c.formula.k === "paren",
        };
        st.recs.push(rec);
        if (rec.bool) {
          inc(`bool.instances`);
          inc(`bool.cache ${boolCache.length ? [...new Set(boolCache)].join(" | ") : "no cells"}`);
          for (const v of cres.subrows) {
            const x = v.values[ci];
            inc(`bool.ours ${typeof x}${typeof x === "boolean" ? ` ${x}` : ""}`);
          }
        }
      });
    }
  }
  return st;
}

/** a file cell's value as our value must be: text exact, a number within tolerance (or its rounding, for an integer cell) */
function cellMatches(ours: Value, c: DatabaseCell | null): boolean {
  if (c === null || c.raw) return ours === null || ours === "";
  if (typeof c.value === "number") {
    return typeof ours === "number" && (near(ours, c.value) || (c.int && Math.round(ours) === c.value));
  }
  return (ours === null ? "" : ours) === c.value;
}

function badShape(shapeText: string, where: string): void {
  const k = `${where} ${shapeText}`;
  badShapes[k] = (badShapes[k] ?? 0) + 1;
}

const list = files(process.argv.slice(2));
const all: FileStats[] = list.map((f, i) => checkFile(i, f.label, f.path));

// stale: a differing column whose key matches every cell in another file
const fullIn = new Map<string, Set<number>>();
for (const st of all) for (const r of st.recs) {
  if (r.diffs === 0 && r.cells > 0) {
    const s = fullIn.get(r.key) ?? new Set<number>();
    s.add(r.file);
    fullIn.set(r.key, s);
  }
}
const staleByLabel: Tally = {};
for (const st of all) for (const r of st.recs) {
  if (r.diffs === 0 && !r.headerBad) continue;
  const others = fullIn.get(r.key);
  if (others && [...others].some((f) => f !== r.file)) {
    r.stale = true;
    if (r.headerBad) inc("headers.stale");
    staleByLabel[`${r.label}`] = (staleByLabel[`${r.label}`] ?? 0) + r.diffs;
  } else {
    if (r.diffs) inc("cells.real_mismatch", r.diffs);
    if (r.headerBad) inc("headers.real_mismatch");
    badShape(r.shapeText, "cell or header");
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(2)}%` : "n/a");
console.log("file | rows | criteria claimed | object sets exact | grouping exact | order exact | column instances (all rows) | compared | cells | equal | stale | real | headers equal");
let tot = { files: 0, rows: 0, rowsClaimed: 0, rowsExact: 0, rowsGroupingExact: 0, rowsOrderExact: 0, rowsOrderExactNoRank: 0, rowsSortClaimed: 0, instances: 0, instancesCompared: 0, instancesGroupingExact: 0, headers: 0, headersMatch: 0, headersBad: 0, headersReal: 0, cells: 0, equal: 0, stale: 0, real: 0 };
for (const st of all) {
  const cells = sum(st.recs.map((r) => r.cells));
  const equal = sum(st.recs.map((r) => r.equal));
  const stale = sum(st.recs.filter((r) => r.stale).map((r) => r.diffs));
  const real = sum(st.recs.filter((r) => !r.stale).map((r) => r.diffs));
  tot.files++;
  for (const k of ["rows", "rowsClaimed", "rowsExact", "rowsGroupingExact", "rowsOrderExact", "rowsOrderExactNoRank", "rowsSortClaimed", "instances", "instancesCompared", "instancesGroupingExact", "headers", "headersMatch", "headersBad"] as const) tot[k] += st[k];
  tot.headersReal += st.recs.filter((r) => r.headerBad && !r.stale).length;
  tot.cells += cells;
  tot.equal += equal;
  tot.stale += stale;
  tot.real += real;
  console.log(`${st.label}: ${st.rows} | ${st.rowsClaimed} | ${st.rowsExact} | ${st.rowsGroupingExact} | ${st.rowsOrderExact} | ${st.instances} | ${st.instancesCompared} | ${cells} | ${equal} | ${stale} | ${real} | ${st.headersMatch}/${st.headers}`);
  console.log(`  rates: stale+real over cells ${pct(stale + real, cells)}; real over cells not stale ${pct(real, cells - stale)}`);
}
console.log(`TOTAL files ${tot.files}: rows ${tot.rows}, criteria claimed ${tot.rowsClaimed}, object sets exact ${tot.rowsExact}, grouping exact ${tot.rowsGroupingExact}, order exact ${tot.rowsOrderExact}`);
console.log(`TOTAL order exact without rank ${tot.rowsOrderExactNoRank}; with the file's rank ${tot.rowsOrderExact}; rows with a sort column claimed ${tot.rowsSortClaimed}`);
console.log(`file order not ascending under our comparison: ${tally["rows.file_order_not_ascending"] ?? 0} rows; by first breaking pair: ${JSON.stringify(badOrder)}`);
console.log(`TOTAL column instances ${tot.instances}; in rows whose grouping is exact ${tot.instancesGroupingExact}; compared (criteria, objects and grouping all exact, column claimed) ${tot.instancesCompared}`);
console.log(`TOTAL cells compared ${tot.cells}, equal ${tot.equal}, stale ${tot.stale}, real mismatches ${tot.real}; rate with stale counted ${pct(tot.stale + tot.real, tot.cells)}, rate with stale set aside ${pct(tot.real, tot.cells - tot.stale)}`);
console.log(`TOTAL headers ${tot.headersMatch}/${tot.headers} equal; differing ones: ${tot.headersBad} (stale ${tot.headersBad - tot.headersReal}, real ${tot.headersReal})`);

console.log("stale cells by column (record.field names; differing cells whose column matches fully in another file):");
for (const [k, v] of Object.entries(staleByLabel).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);

const popups = all.flatMap((s) => s.recs.filter((r) => r.popup));
const brk = all.flatMap((s) => s.recs.filter((r) => r.bracketed));
console.log(`bracketed columns compared ${brk.length}: cells ${sum(brk.map((r) => r.cells))}, fully equal ${brk.filter((r) => r.diffs === 0).length}, stale ${brk.filter((r) => r.stale).length}`);
console.log(`popup columns cells ${sum(popups.map((r) => r.cells))}, of which in bracketed columns ${sum(popups.filter((r) => r.bracketed).map((r) => r.cells))}`);
console.log(`popup columns compared ${popups.length}: fully equal ${popups.filter((r) => r.diffs === 0).length}, stale ${popups.filter((r) => r.stale).length}, real ${popups.filter((r) => r.diffs > 0 && !r.stale).length}`);
const bools = all.flatMap((s) => s.recs.filter((r) => r.bool));
console.log(`bare boolean columns compared ${bools.length}: fully equal ${bools.filter((r) => r.diffs === 0).length}, stale ${bools.filter((r) => r.stale).length}, real ${bools.filter((r) => r.diffs > 0 && !r.stale).length}`);

console.log("rows whose criteria are not worked out, by reason:");
for (const [k, v] of Object.entries(rowReasons).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
console.log("tallies:", JSON.stringify(tally));
console.log("rows with two subrows of one name-index signature:", tally["rows.same_signature_subrows"] ?? 0);
console.log("column instances not compared, by reason (all rows):");
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
if (Object.keys(badShapes).length) {
  console.log("candidate shapes (token ids; F field, S text, N number, K keyword):");
  for (const [k, v] of Object.entries(badShapes).sort((a, b) => b[1] - a[1])) console.log(`  ${v}  ${k}`);
}
if (tot.real || tot.headersReal) {
  console.log("FAIL: a claimed cell or header differs from the file, and no other file's matching column explains it");
  process.exit(1);
}
console.log("ok: every claimed cell and header matches the file, or differs only where a matching column in another file says it is stale");
