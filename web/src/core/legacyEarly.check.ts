// Checks legacyEarly.ts on synthetic Vectorworks 2018/2019-format bodies made here (no client data):
// each converted type's fields are written where the 2018/2019 format has them and must come out
// where 2018+ has them, read through Rodeo's own 2018+ readers where there is one. Covers the name
// table, texts with several lines and style runs, 3D polygons, hatches, the types kept as they are,
// the ones that gain the material slot, the ones left out, the dash table and line types, and how
// legacy.ts tells these records from the 2017 format's. Run from web/:
//   npx tsx src/core/legacyEarly.check.ts

import { encodeUtf16, f64, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import { earlyBody, earlyDashes, earlyNames } from "./legacyEarly.ts";
import { legacyRecords } from "./legacy.ts";
import { lineTypeBodies, type OlderRecord } from "./legacyLate.ts";
import { readNameTable } from "./names.ts";
import type { Rec } from "./records.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A body of `size` bytes filled with a pattern, so a byte out of place shows. */
function patterned(size: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
}

/** `body` (a 2018+ one) as the record it sits in. */
function record(body: Uint8Array): Uint8Array {
  const d = new Uint8Array(0x50 + body.length);
  setU64(d, 0, BigInt(d.length));
  d.set(body, 0x50);
  return d;
}

const made = (type: number, body: Uint8Array): Uint8Array => {
  const out = earlyBody(type, body);
  if (!(out instanceof Uint8Array)) throw new Error(`type ${type} gave ${out}`);
  return out;
};

// ---- the name table -------------------------------------------------------------------------------

/** A 2018/2019 name table: +0x08 count, index entries from +0x18, 4 bytes, then the names in order. */
function earlyTable(entries: [number, string][]): Uint8Array {
  const names = entries.map(([, n]) => encodeUtf16(n));
  const out = new Uint8Array(0x18 + 12 * entries.length + 4 + names.reduce((n, b) => n + 4 + b.length, 0));
  setU32(out, 0, 1);
  setU32(out, 0x08, entries.length);
  entries.forEach(([index], k) => setU32(out, 0x18 + 12 * k, index));
  let at = 0x18 + 12 * entries.length + 4;
  for (const b of names) {
    setU32(out, at, b.length);
    out.set(b, at + 4);
    at += 4 + b.length;
  }
  return out;
}

const entries: [number, string][] = [
  [11, "Walls-Exterior"],
  [3, "Dimension"],
  [14, "1/Sht-1"],
  [2, "Étage 1"],
];
const table = earlyTable(entries);
check(JSON.stringify(earlyNames(table)?.map((e) => [e.index, e.name])) === JSON.stringify(entries), "1. the name table's indexes pair with its names in order");
const tableRead = readNameTable({ data: record(made(55, table)) } as Rec);
check(entries.every(([i, n]) => tableRead.get(i) === n) && tableRead.size === entries.length, "   and reads through names.ts as the same names");
check(earlyNames(table.subarray(0, table.length - 2)) === null && earlyBody(55, table.subarray(0, table.length - 2)) === null, "   a table that doesn't end where its names do reads as none");

// ---- texts ----------------------------------------------------------------------------------------

/** A 2018/2019 text body of `lines` lines and `runs` style runs; its sizes are run k's (10 + k, 20 + k). */
function earlyText(lines: number, runs: number, tail: number): Uint8Array {
  const at = 0xb4 + 2 * (lines - 1);
  const b = patterned(at + 26 * runs + tail);
  setU16(b, 0xac, lines);
  setU16(b, 0xae, runs);
  for (let k = 0; k < runs; k++) {
    setU16(b, at + 26 * k, 10 + k);
    setU16(b, at + 26 * k + 2, 20 + k);
  }
  return b;
}

for (const [lines, runs] of [
  [1, 1],
  [3, 2],
  [2, 5],
]) {
  const old = earlyText(lines, runs, 30);
  const out = made(10, old);
  const at = 0xb8 + 2 * (lines - 1);
  let ok = out.length === old.length + 4 + 12 * runs;
  ok &&= same(out.subarray(0, 0x38), old.subarray(0, 0x38)) && u32(out, 0x38) === 0 && same(out.subarray(0x3c, at), old.subarray(0x38, at - 4));
  for (let k = 0; k < runs; k++) {
    const to = at + 38 * k;
    ok &&= f64(out, to) === 10 + k && f64(out, to + 8) === 20 + k && same(out.subarray(to + 16, to + 38), old.subarray(at - 4 + 26 * k + 4, at - 4 + 26 * (k + 1)));
  }
  ok &&= same(out.subarray(out.length - 30), old.subarray(old.length - 30));
  check(ok, `2. a text of ${lines} line(s) and ${runs} run(s): the slot, f64 sizes per run, the rest in place`);
}
check(earlyBody(10, earlyText(1, 40, 0).subarray(0, 0xb4 + 26 * 3)) === null, "   a text whose runs don't fit is left out");

// ---- 3D polygons, hatches -------------------------------------------------------------------------

const poly = patterned(0x7c + 3 * 24);
setU16(poly, 0x3a, 3);
const polyOut = made(25, poly);
check(
  polyOut.length === poly.length + 6 && u32(polyOut, 0x38) === 0 && same(polyOut.subarray(0x3c, 0x3e), poly.subarray(0x38, 0x3a)) && u16(polyOut, 0x3e) === 0 && same(polyOut.subarray(0x40, 0x80), poly.subarray(0x3c, 0x7c)) && u16(polyOut, 0x80) === 3 && same(polyOut.subarray(0x82), poly.subarray(0x7c)),
  "3. a 3D polygon's corner count moves to just before its corners (2018+ record +0xd0)",
);

const hatch = patterned(8 + 2 * 60);
setU16(hatch, 4, 2);
setU16(hatch, 6, 0x101);
const hatchOut = made(66, hatch);
check(u16(hatchOut, 6) === 2 && u16(hatchOut, 4) === 0x101 && same(hatchOut.subarray(8), hatch.subarray(8)), "4. a hatch's line count and ground colour swap places");

// ---- kept, slotted, left out ----------------------------------------------------------------------

const plain = patterned(120);
check([2, 17, 47, 74, 76, 94, 119].every((t) => same(made(t, plain), plain)), "5. lines, loci, record formats, the font list, aux records, classes and previews are kept as they are");
check(
  [3, 5, 6, 11, 18, 21, 24, 31, 122].every((t) => {
    const out = made(t, plain);
    return out.length === 124 && same(out.subarray(0, 0x38), plain.subarray(0, 0x38)) && u32(out, 0x38) === 0 && same(out.subarray(0x3c), plain.subarray(0x38));
  }),
  "   shapes, groups, worksheets, layers and viewports gain the material slot",
);
check([30, 42, 48, 69, 102, 107, 127].every((t) => earlyBody(t, plain) === null), "   record data, styles and components, profile caches and the dash table are left out");
check(earlyBody(250, plain) === undefined, "   a type not named is not converted here");

// ---- line types -----------------------------------------------------------------------------------

/** A 2018/2019 dash table: u16 count, 268-byte entries (dashes first), then the names in order. */
function dashTable(named: [string, Uint8Array][]): Uint8Array {
  const names = named.map(([n]) => encodeUtf16(n));
  const out = new Uint8Array(2 + 268 * named.length + names.reduce((n, b) => n + 4 + b.length, 0));
  setU16(out, 0, named.length);
  named.forEach(([, dash], k) => out.set(dash, 2 + 268 * k));
  let at = 2 + 268 * named.length;
  for (const b of names) {
    setU32(out, at, b.length);
    out.set(b, at + 4);
    at += 4 + b.length;
  }
  return out;
}
const dashA = patterned(90);
const dashB = patterned(90).map((v) => v ^ 0x55);
const dashes = earlyDashes(dashTable([["CENTER", dashA], ["VW-01 短破線", dashB]]));
check(dashes.size === 2 && same(dashes.get("CENTER")!, dashA) && same(dashes.get("VW-01 短破線")!, dashB), "6. the dash table's entries go by the names after them");
const lineType: OlderRecord = { type: 96, name: 138, body: patterned(18) };
const table30: OlderRecord = { type: 30, name: 0, body: dashTable([["CENTER", dashA], ["VW-01 短破線", dashB]]) };
const lt = lineTypeBodies([lineType, table30], new Map([[138, "VW-01 短破線"]]), earlyDashes).get(lineType);
check(lt !== undefined && lt.length === 274 && same(lt.subarray(16, 106), dashB) && same(lt.subarray(0, 16), lineType.body.subarray(0, 16)), "   a line type gets the dashes of its name's entry");

// ---- telling 2018/2019 records from 2017's --------------------------------------------------------

/** Records under 0x48-byte headers: a name table with `body` and a terminator, in one list. */
function lateBodyOf(nameTable: Uint8Array): Uint8Array {
  const rec = new Uint8Array(0x48 + nameTable.length);
  setU64(rec, 0, BigInt(rec.length));
  rec[0x19] = 55;
  setU64(rec, 0x26, 0x1000n);
  rec.set(nameTable, 0x48);
  rec[0x38] = 1;
  const end = new Uint8Array(0x50);
  setU64(end, 0, 0x50n);
  setU64(end, 0x26, 0x1000n);
  end[0x38] = 2;
  const out = new Uint8Array(rec.length + end.length);
  out.set(rec, 0);
  out.set(end, rec.length);
  return out;
}
const early = legacyRecords("long", lateBodyOf(table));
check(early?.kind === "2019", `7. 0x48-byte records whose name table is UTF-16 are the 2018/2019 format (${early?.kind})`);
const earlyTableRec = early?.records.find((r) => r[0x19] === 55);
check(earlyTableRec !== undefined && readNameTable({ data: earlyTableRec } as Rec).get(14) === "1/Sht-1", "   and their name table comes out as 2018+'s");
// a 2017 table: §1.1's fixed 68-byte entries (u32 index, a length byte, 8-bit name) from +0x50
const old2017 = new Uint8Array(0x50 + 2 * 68);
setU32(old2017, 0x08, 2);
for (const [k, [index, name]] of [
  [0, [5, "Dimension"]],
  [1, [9, "None"]],
] as const) {
  setU32(old2017, 0x50 + 68 * k, index);
  old2017[0x54 + 68 * k] = name.length;
  old2017.set(new TextEncoder().encode(name), 0x55 + 68 * k);
}
const late = legacyRecords("long", lateBodyOf(old2017));
check(late?.kind === "2017", `   the same records with a 2017 name table stay the 2017 format (${late?.kind})`);

console.log(failures ? `\n${failures} failed` : "\nall legacyEarly checks pass");
process.exit(failures ? 1 : 0);
