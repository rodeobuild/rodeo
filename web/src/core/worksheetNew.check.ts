// Checks the worksheet template (worksheetNew.ts) under Node.
//
// (a) With no sample files: the template is a one-column, one-row worksheet with its two children
//     (a type-62 record, 82 bytes; a type-112 print child, 166 bytes); it reads back through
//     readWorksheet and readWorksheetContents as an empty grid; newWorksheetRecord lays a 2-column,
//     1-row grid on it, which reads back with its texts, numbers and sizes.
// (b) With the sample files present (../samples/sample.vwx and the .vwx files under
//     ../samples/demos/<year>/): every worksheet, and every child of the same form (82 and 166 bytes),
//     is compared with the template. A byte that every worksheet of the form shares must agree with
//     the template (failing if not). A byte that varies is the template's choice from the public
//     files (the most common value or tuple): it is counted, not failed.
//
// Census behind the header choices (47 public worksheets in 8 demo files, 4 client worksheets):
//   constant in all 51: +0x08 next mark, +0x19 type, +0x1f flags 0x41, +0x50..+0x53 u32 2, the
//     +0x68 f64 constants and the zero tails, the children's +0x1f (0x40 for type 62, 0x41 for 112);
//   varying, the most common public tuple taken: +0x54..+0x5f (22/47), +0x62..+0x64 (26/47),
//     +0x8e..+0x96 (8/47; a rectangle, taken to be the window), +0x9e..+0xa0 (26/47),
//     +0xa8..+0xba (5/47; selection and zoom, set below), +0xbe..+0xc2 (4/47; counts set below);
//   +0x8c, bit 0x20 = has a worksheet image on a sheet (38 of 38 with it; 4 of 4 without an image have 0x00):
//     set to 0x00, as a new worksheet has none;
//   set here: the lengths, the saved pointer (instantiate replaces it), the GUID placeholder (instantiate
//     writes one), the owner (instantiate), the name index (createWorksheet), the counts, the selection at
//     A1, zoom 100%;
//   type-62 children: 31 of 47 are 82 bytes, all with 2 zero bytes after their header;
//   type-112 children: 20 public are 166 bytes (2024 to 2026 files), 18 of them agree on the 86-byte body; 2
//     (2025 and 2026 files) differ at +0x5e, +0x62, +0x6e, +0x72 (paper or page extents, guess).
// Run from web/: NODE_OPTIONS=--max-old-space-size=12000 npx tsx src/core/worksheetNew.check.ts

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openVwx } from "./index.ts";
import { u64 } from "./bytes.ts";
import { blankWorksheetTemplate } from "./worksheetNew.ts";
import { Rec } from "./records.ts";
import { newWorksheetRecord, readWorksheet, readWorksheetContents } from "./worksheet.ts";

const WORKSHEET = 18;
const CONTENTS = 62;
const PRINT = 112;

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}

/** A record with its children, as the tree readers see it. */
function withChildren(data: Uint8Array, kids: Uint8Array[]): Rec {
  const rec = new Rec(data, 1);
  rec.children = kids.map((k, i) => {
    const c = new Rec(k, i + 2);
    c.parent = rec;
    return c;
  });
  return rec;
}

// (a) the template on its own, and a grid laid on it
const names = new Map<number, string>([[7, "Check"]]);
const tpl = blankWorksheetTemplate();
check("the template is a worksheet record of its own length", () => {
  assert.equal(new Rec(tpl.sheet).type, WORKSHEET);
  assert.equal(Number(u64(tpl.sheet, 0)), tpl.sheet.length, "the length word is the record's length");
  for (const k of tpl.children) assert.equal(Number(u64(k, 0)), k.length, "a child's length word is its length");
});
check("the template's children are a type-62 record (82 bytes) and a type-112 print child (166 bytes)", () => {
  assert.deepEqual(tpl.children.map((k) => new Rec(k).type), [CONTENTS, PRINT]);
  assert.deepEqual(tpl.children.map((k) => k.length), [82, 166]);
});
check("the template reads as an empty one-column, one-row worksheet", () => {
  const rec = withChildren(tpl.sheet, tpl.children);
  const grid = readWorksheet(rec, names);
  assert.ok(grid, "readWorksheet reads it");
  assert.equal(grid.colWidths.length, 1);
  assert.equal(grid.rowHeights.length, 1);
  assert.equal(grid.cells.length, 0, "its one cell has no text");
  const contents = readWorksheetContents(rec, names);
  assert.ok(contents, "readWorksheetContents reads it");
  assert.equal(contents.cols, 1);
  assert.equal(contents.rows, 1);
  assert.deepEqual(contents.database, [false]);
  assert.equal(contents.cells.length, 0);
});
check("a grid laid on the template reads back with its widths, heights, texts and numbers", () => {
  const out = newWorksheetRecord(tpl.sheet, {
    name: "Check",
    widths: [60, 80],
    rowHeight: 18,
    rows: [[{ value: "A" }, { value: 1.5 }]],
  });
  assert.equal(Number(u64(out, 0)), out.length);
  const rec = withChildren(out, tpl.children);
  const grid = readWorksheet(rec, names);
  assert.ok(grid, "readWorksheet reads the new worksheet");
  assert.deepEqual(grid.colWidths, [60, 80]);
  assert.deepEqual(grid.rowHeights, [18]);
  assert.equal(grid.cells.length, 2);
  assert.equal(grid.cells[0]!.text, "A");
  assert.equal(grid.cells[0]!.col, 0);
  assert.equal(grid.cells[1]!.text, "1.5");
  assert.equal(grid.cells[1]!.col, 1);
  assert.equal(grid.cells[1]!.align, "right", "a number is right aligned by default");
  const contents = readWorksheetContents(rec, names);
  assert.ok(contents);
  assert.deepEqual(
    contents.cells.map((c) => [c.kind, c.display, c.value]),
    [
      ["text", "A", null],
      ["number", "1.5", 1.5],
    ],
  );
});
check("a grid of three rows with a gap and a wider grid reads back", () => {
  const out = newWorksheetRecord(tpl.sheet, {
    name: "Wide",
    widths: [40, 40, 40],
    rowHeight: 14,
    rows: [[{ value: "x", bold: true }, null, { value: 3, format: 2, accuracy: 2 }], [null, { value: "y", align: "center" }], [{ value: "z" }]],
  });
  const grid = readWorksheet(withChildren(out, tpl.children), names);
  assert.ok(grid);
  assert.equal(grid.colWidths.length, 3);
  assert.equal(grid.rowHeights.length, 3);
  assert.deepEqual(
    grid.cells.map((c) => `${c.row},${c.col}:${c.text}`),
    ["0,0:x", "0,2:3.00", "1,1:y", "2,0:z"],
  );
});

// (b) the template against the sample worksheets
const root = resolve(process.cwd(), "..", "samples");
const files: string[] = [];
if (existsSync(join(root, "sample.vwx"))) files.push(join(root, "sample.vwx"));
const demos = join(root, "demos");
if (existsSync(demos)) {
  for (const year of readdirSync(demos).sort()) {
    const dir = join(demos, year);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir).sort()) if (f.endsWith(".vwx")) files.push(join(dir, f));
  }
}

if (!files.length) {
  console.log("skip sample comparison: no sample files found (run from web/ with ../samples present)");
} else {
  const sheets: { data: Uint8Array; kids: Uint8Array[] }[] = [];
  for (const path of files) {
    const session = openVwx(new Uint8Array(readFileSync(path)), basename(path));
    // the file's records as the reader builds them (a tree of Rec, worksheets at the top level)
    const { recs } = (session as unknown as { doc: { recs: Rec[] } }).doc;
    for (const rec of recs) {
      if (rec.type !== WORKSHEET) continue;
      sheets.push({ data: rec.data, kids: rec.children.map((k) => k.data) });
    }
  }
  console.log(`samples: ${sheets.length} worksheets in ${files.length} files`);

  // the byte offsets set here, or written by instantiate and createWorksheet, so not compared
  const set = (o: number): boolean =>
    o === 0x8c || o < 0x08 || (o >= 0x10 && o < 0x18) || (o >= 0x1a && o < 0x1c) || (o >= 0x26 && o < 0x2e) || (o >= 0x38 && o < 0x48);

  /** Compare a template record with every sample of its form; bytes all samples share must agree. */
  const compare = (label: string, tplData: Uint8Array, samples: Uint8Array[], limit: number): void => {
    let constDiff = 0;
    const varying: number[] = [];
    const perSample = new Array<number>(samples.length).fill(0);
    const constant: number[] = [];
    for (let o = 0; o < limit; o++) {
      if (set(o)) continue;
      const v = samples[0]![o];
      if (samples.every((s) => s[o] === v)) constant.push(o);
      else varying.push(o);
    }
    samples.forEach((s, i) => {
      for (const o of constant) if (s[o] !== tplData[o]) { constDiff++; perSample[i]++; }
    });
    const varyDiff = samples.map((s) => varying.filter((o) => s[o] !== tplData[o]).length);
    const bad = constDiff;
    console.log(
      `${label}: ${samples.length} samples; ${constant.length} bytes all share (differing: ${constDiff}, should be 0); ` +
        `${varying.length} bytes vary (differing per sample: ${Math.min(...varyDiff)} to ${Math.max(...varyDiff)})`,
    );
    if (bad) throw new Error(`${label}: ${bad} shared byte(s) differ from the template`);
  };

  check("the sample worksheets' headers agree with the template on every byte they share", () => {
    compare("worksheet header", tpl.sheet, sheets.map((s) => s.data), 0x22a);
  });
  const contents = sheets.flatMap((s) => s.kids.filter((k) => k[0x19] === CONTENTS && k.length === 82));
  check("the sample type-62 children (82 bytes) agree with the template on every byte they share", () => {
    compare("type-62 children (82 bytes)", tpl.children[0]!, contents, 82);
  });
  const prints = sheets.flatMap((s) => s.kids.filter((k) => k[0x19] === PRINT && k.length === 166));
  check("the sample type-112 print children (166 bytes) agree with the template on every byte they share", () => {
    compare("type-112 print children (166 bytes)", tpl.children[1]!, prints, 166);
  });
}

console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
