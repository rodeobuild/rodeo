// Checks that one damaged layer record doesn't stop a drawing from opening or reading. Run from web/:
//   npx tsx src/core/layerRead.check.ts
// A two-layer drawing is saved, then its second layer's record is cut short or given a name length
// that runs past it. Each damaged file must open and list its layers (a name that doesn't read is
// "Layer n", a title that doesn't read is ""), save and reopen; renaming the damaged layer refuses
// with a clear message, and copying it or adding a layer still works or refuses clearly. Errors
// from the byte reads themselves ("outside the bounds") are never acceptable.

import { readContainer, writeContainer } from "./container.ts";
import { setU32 } from "./bytes.ts";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import { layerNameAt } from "./model.ts";
import { joinRecords, splitRecords, type Rec } from "./records.ts";

let failed = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failed++;
}

const LAYER = 31;

/** the file with its layer records replaced by `damage(i, data)` where it returns a new record */
function damaged(bytes: Uint8Array, target: number, damage: (data: Uint8Array) => Uint8Array): Uint8Array {
  const c = readContainer(bytes);
  const recs: Rec[] = splitRecords(c.raw);
  let seen = 0;
  const out = recs.map((r) => {
    if (r.type !== LAYER) return r;
    return seen++ === target ? ({ ...r, data: damage(r.data.slice()) } as Rec) : r;
  });
  return writeContainer(c.header, joinRecords(out));
}

/** a drawing with two design layers, the second one called `second` */
function twoLayers(): Uint8Array {
  const s = openVwx(blankDrawing("mm"), "two.vwx");
  s.createLayer("Second", "design", 50);
  return s.doc.toBytes();
}

function run(label: string, bytes: Uint8Array, expectName: string, expectTitle: string): void {
  let s;
  try {
    s = openVwx(bytes, "damaged.vwx");
  } catch (err) {
    check(false, `${label}: opens (${(err as Error).message})`);
    return;
  }
  let ls: ReturnType<typeof s.doc.layers> | null = null;
  try {
    ls = s.doc.layers();
  } catch (err) {
    check(false, `${label}: layers() returns (${(err as Error).message})`);
    return;
  }
  check(ls.length === 2, `${label}: both layers listed (${ls.length})`);
  const second = ls[1];
  check(second?.name === expectName && second?.title === expectTitle, `${label}: damaged layer reads as ${JSON.stringify([expectName, expectTitle])} (got ${JSON.stringify([second?.name, second?.title])})`);
  check(ls[0]?.name === "Design Layer-1", `${label}: the layer before it reads as before`);

  try {
    openVwx(s.doc.toBytes(), "again.vwx").doc.layers();
    check(true, `${label}: saves and reopens`);
  } catch (err) {
    check(false, `${label}: saves and reopens (${(err as Error).message})`);
  }

  try {
    s.renameLayer(second.id, "Renamed");
    check(false, `${label}: rename of an unreadable name is refused`);
  } catch (err) {
    const m = (err as Error).message;
    check(!/outside the bounds|DataView/.test(m) && /can't be read/.test(m), `${label}: rename refused clearly (${m})`);
  }

  try {
    s.duplicateLayer(second.id, "Copy");
    check(false, `${label}: copying a damaged layer is refused`);
  } catch (err) {
    const m = (err as Error).message;
    check(!/outside the bounds|DataView/.test(m), `${label}: copying a damaged layer refuses clearly (${m})`);
  }

  try {
    s.createLayer("Fresh", "design", 20);
    check(s.doc.layers().length === 3, `${label}: a new layer can still be added`);
  } catch (err) {
    const m = (err as Error).message;
    check(!/outside the bounds|DataView/.test(m), `${label}: adding a layer refuses clearly or works (${m})`);
  }
}

const base = twoLayers();
const healthy = openVwx(base, "two.vwx");
check(healthy.doc.layers().length === 2, "the two-layer drawing reads");

// a name length that runs far past the record
run(
  "name length past the record",
  damaged(base, 1, (d) => {
    setU32(d, layerNameAt(d), 0x7ffffff0);
    return d;
  }),
  "Layer 2",
  "",
);

// the record cut off right after its name: the title is gone
run(
  "record ends after the name",
  damaged(base, 1, (d) => {
    const at = layerNameAt(d);
    const n = new DataView(d.buffer, d.byteOffset).getUint32(at, true);
    return d.slice(0, at + 4 + n);
  }),
  "Second",
  "",
);

// the record cut off before its name
run(
  "record ends before the name",
  damaged(base, 1, (d) => d.slice(0, layerNameAt(d) + 2)),
  "Layer 2",
  "",
);

console.log(failed ? `${failed} check(s) failed` : "all layer read checks passed");
if (failed) process.exit(1);
