// Checks the legacy (Vectorworks 2013, 2016 and 2017) reader on synthetic files: a blank drawing's
// records narrowed into the 2013 layout (the inverse of legacy.ts's widen, written here), or
// shortened into the 2016 or the 2017 one (the inverse of its lengthen), and wrapped in a header
// of that time must read back to the same records, with GUIDs made by the reader where the layout
// has none. Only the records whose bodies the per-type converters give back as they are take part;
// legacyDoc.check.ts, legacyShapes.check.ts, legacyMid.check.ts and legacyLate.check.ts check the
// conversions. Also: uncompressed 2018+ records pass through, Snappy bodies keep their path, a
// converted drawing says which layout it was, units kept as sizes are read, line types take their
// dashes from the dash table, and an old file that is unreadable names the year it was saved in.
// Run from web/:
//   npx tsx src/core/legacy.check.ts
// No file of the user's is read.

import { blankDrawing } from "./blank.ts";
import { bytesSource, readContainer, readContainerStream, writeContainer } from "./container.ts";
import { concat, setF64, setU16, setU32, setU32be, setU64, u64 } from "./bytes.ts";
import { docBody } from "./legacyDoc.ts";
import { legacyStart } from "./legacy.ts";
import { lateBody } from "./legacyLate.ts";
import { midBody, midDirect } from "./legacyMid.ts";
import { shapeBody } from "./legacyShapes.ts";
import { NEXT_MARK, Rec, splitRecords } from "./records.ts";
import { unitsName } from "./settings.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A 2018+ record as the 2013 layout: the inverse of legacy.ts's widen (its GUID and +0x48 bytes are dropped). */
function narrow(rec: Uint8Array): Uint8Array {
  const terminator = rec[0x19] === 0;
  const body = rec.subarray(0x50);
  if (terminator && body.length !== 8) throw new Error("a terminator's body is a u64 here");
  const mark = u64(rec, 0x08);
  if (mark !== 0n && mark !== NEXT_MARK) throw new Error("mark is not 0 or NEXT_MARK");
  if (u64(rec, 0x10) >= 2n ** 32n || u64(rec, 0x26) >= 2n ** 32n) throw new Error("pointer does not fit in u32");
  if (rec.subarray(0x2a, 0x2e).some((b) => b !== 0)) throw new Error("owner's high half is not zero");
  if (terminator && body.subarray(4).some((b) => b !== 0)) throw new Error("terminator's high half is not zero");
  const tailLength = terminator ? 4 : body.length;
  const out = new Uint8Array(0x28 + tailLength);
  setU32(out, 0x00, out.length);
  setU32(out, 0x04, Number(mark));
  setU32(out, 0x08, Number(u64(rec, 0x10)));
  out.set(rec.subarray(0x18, 0x19), 0x0c);
  out.set(rec.subarray(0x19, 0x1a), 0x0d);
  out.set(rec.subarray(0x1a, 0x1c), 0x0e);
  out.set(rec.subarray(0x1c, 0x1f), 0x10);
  out.set(rec.subarray(0x1f, 0x20), 0x13);
  out.set(rec.subarray(0x20, 0x24), 0x14);
  out.set(rec.subarray(0x24, 0x26), 0x18);
  setU32(out, 0x1a, Number(u64(rec, 0x26)));
  out.set(rec.subarray(0x2e, 0x38), 0x1e);
  out.set(body.subarray(0, tailLength), 0x28);
  return out;
}

/** Whether legacy.ts gives the body of the 2018+ record `rec` back as it is, read as a 2013 body. */
function keptAsIs(rec: Uint8Array): boolean {
  if (rec[0x19] === 0) return true;
  const body = rec.subarray(0x50);
  try {
    const doc = docBody(rec[0x19], body);
    const made = doc !== undefined ? doc : shapeBody(rec[0x19], body);
    return made === undefined || (made !== null && same(made, body));
  } catch {
    return false;
  }
}

/** A 2013 file: the header's bytes with a 2013-length settings block, then the records. */
function legacyFile(header: Uint8Array, records: Uint8Array[]): Uint8Array {
  const settings = 0x880;
  const h = header.slice(0, 0x94 + settings);
  setU32be(h, 0, settings);
  setU32(h, 0x94, settings);
  const file = concat([h, ...records]);
  setU32be(file, 0x54, file.length);
  return file;
}

/** Message from reading `bytes` whole, or "" when it reads. */
function failure(bytes: Uint8Array): string {
  try {
    readContainer(bytes);
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const blank = blankDrawing("mm");
const blankRead = readContainer(blank);
const blankAll = splitRecords(blankRead.raw).map((r) => r.data);
const blankRecords = blankAll.filter(keptAsIs);

// 1. a 2018+ drawing is still read as Snappy chunks
check(blankRead.chunkCount > 0 && blankAll.length > 0, `blank drawing reads as Snappy chunks (${blankRead.chunkCount} chunk(s), ${blankAll.length} records)`);
check(blankRecords.length >= blankAll.length / 2, `${blankRecords.length} of the blank's ${blankAll.length} records keep their bodies`);

// 2. the narrowing's assumptions hold for the blank's records (no bytes at +0x48 that a 2013 record lacks)
check(blankRecords.every((r) => r.subarray(0x48, 0x50).every((b) => b === 0)), "the blank's records are zero at +0x48");

// 3. narrowed records in a 2013 file read back to the blank's records, GUIDs aside
const file = legacyFile(blank, blankRecords.map(narrow));
const read = readContainer(file);
const back = splitRecords(read.raw).map((r) => r.data);
const guidFree = (d: Uint8Array): Uint8Array => {
  const c = d.slice();
  c.fill(0, 0x38, 0x48);
  return c;
};
check(read.chunkCount === 0, "a 2013 body reads as records, not Snappy chunks");
check(back.length === blankRecords.length, `2013 file: ${back.length} records read back, ${blankRecords.length} written`);
check(back.every((r, i) => same(guidFree(r), guidFree(blankRecords[i]))), "every record reads back as it was, GUID aside");
const guids = new Set(back.map((r) => new Rec(r).guid));
check(guids.size === back.length && back.every((r) => r.subarray(0x38, 0x48).some((b) => b !== 0)), "every record gets its own nonzero GUID");
check(same(readContainer(file).raw, read.raw), "the same 2013 file reads to the same GUIDs every time");
check(read.units === "Millimeters", `units from the 2013 settings: ${read.units}`);
check(read.header.length === blankRead.header.length && same(read.header.subarray(0x1ac, 0x304), blankRead.header.subarray(0x1ac, 0x304)), "the header's units fields are the blank's millimetres");

// 4. the same file streamed in small slices reads the same
const streamed = await readContainerStream(bytesSource(file), { slice: 4 << 10 });
check(
  streamed.records.length === back.length && streamed.records.every((r, i) => same(r, back[i])) && same(streamed.header, read.header) && streamed.units === read.units,
  "streamed in 4 KB slices: the same records, header and units",
);

// 5. units written in ASCII (as 2013 writes them) are found when the UTF-16 name is not there
const ftinBlank = blankDrawing("ftin");
const ftinRecords = splitRecords(readContainer(ftinBlank).raw)
  .map((r) => r.data)
  .filter(keptAsIs);
const asciiHeader = readContainer(ftinBlank).header.slice();
asciiHeader.fill(0, 0x1c6, 0x1c6 + 42);
check(unitsName(asciiHeader) === null, "without the UTF-16 name, the 2018+ units reader finds nothing");
asciiHeader.set(new TextEncoder().encode("Feet & Inches"), 0x500);
const ftinRead = readContainer(legacyFile(asciiHeader, ftinRecords.map(narrow)));
check(ftinRead.units === "Feet & Inches", `units written in ASCII: ${ftinRead.units}`);
check(splitRecords(ftinRead.raw).length === ftinRecords.length, "feet and inches records read back");

// 6. uncompressed 2018+ records (u64 sizes, 0x50 headers) pass through unchanged
const wideFile = concat([blank.slice(0, blankRead.header.length), ...blankAll]);
setU32be(wideFile, 0x54, wideFile.length);
const wide = readContainer(wideFile);
const wideBack = splitRecords(wide.raw).map((r) => r.data);
check(wide.chunkCount === 0 && wideBack.length === blankAll.length && wideBack.every((r, i) => same(r, blankAll[i])), `uncompressed 2018+ records pass through unchanged (${wideBack.length})`);

// 7. a 2013 file cut short fails, and does not get the year message (2013 is read)
const cutFile = file.slice(0, file.length - 30);
setU32be(cutFile, 0x54, cutFile.length);
const cutError = failure(cutFile);
check(cutError !== "" && !cutError.includes("can't read yet"), `a 2013 file cut short fails with its own error: ${cutError}`);

// 8. an old file whose body is unreadable names the year it was saved in
const junk = new Uint8Array(4096);
for (let i = 0; i < junk.length; i++) junk[i] = (i * 131 + 7) & 0xff;
const oldHeader = blank.slice(0, blankRead.header.length);
oldHeader.set(new TextEncoder().encode("VW12.5.0 VW12.5.0"), 0x0e);
const oldFile = concat([oldHeader, junk]);
setU32be(oldFile, 0x54, oldFile.length);
const oldError = failure(oldFile);
check(oldError === "This file was saved by Vectorworks 2007, which Rodeo can't read yet: save it from Vectorworks 2013 or newer.", `a file saved in 2007 names its year: ${oldError}`);
let oldStream = "";
try {
  await readContainerStream(bytesSource(oldFile), { slice: 1 << 10 });
} catch (err) {
  oldStream = err instanceof Error ? err.message : String(err);
}
check(oldStream === oldError, "the streamed reader gives the same message");

// 9. a 2018+ file whose body is unreadable keeps its own error
const newFile = concat([blank.slice(0, blankRead.header.length), junk]);
setU32be(newFile, 0x54, newFile.length);
const newError = failure(newFile);
check(newError.startsWith("bad chunk") && !newError.includes("can't read yet"), `a 2018 file that fails keeps its error: ${newError}`);

// 10. a legacy drawing's header carries a 2018+ version string, so saving writes the 2018+ layout
check(new TextDecoder().decode(read.header.subarray(0x0e, 0x2e)).startsWith("VW31.2.0"), "a legacy drawing's header carries the 2018+ version string");

// 11. saved as it would be (2018+ header, Snappy chunks), the drawing reads back: its records and units
for (const [name, legacy, records] of [
  ["millimetres", read, back],
  ["feet and inches", ftinRead, splitRecords(ftinRead.raw).map((r) => r.data)],
] as const) {
  const saved = writeContainer(legacy.header, concat(records));
  const reopened = readContainer(saved);
  check(
    reopened.chunkCount > 0 && same(reopened.raw, concat(records)) && reopened.units === legacy.units,
    `${name}: saved with a 2018+ header and read back (${reopened.chunkCount} chunk(s)), units ${reopened.units}`,
  );
}

// 12. zeros after the last record, too few to start another, are no record: the drawing reads as without them
const narrowRecs = blankRecords.map(narrow);
const padded = legacyFile(blank, [...narrowRecs, new Uint8Array(4)]);
let paddedRaw: Uint8Array | null = null;
try {
  paddedRaw = readContainer(padded).raw;
} catch {
  paddedRaw = null;
}
check(paddedRaw !== null && same(paddedRaw, read.raw), "a 2013 body with 4 zero bytes after its last record reads as one without them");

// 13. a body of older records that stops partway says where, rather than giving the Snappy error it fails with next
const broken = narrowRecs.map((r) => r.slice());
setU32(broken[2], 0x04, 0x12345678);
const brokenError = failure(legacyFile(blank, broken));
check(brokenError.includes("older layout stops at record 2 at +0x") && !brokenError.startsWith("bad chunk"), `a 2013 body broken at its third record says so: ${brokenError}`);
let brokenStream = "";
try {
  await readContainerStream(bytesSource(legacyFile(blank, broken)), { slice: 1 << 10 });
} catch (err) {
  brokenStream = err instanceof Error ? err.message : String(err);
}
check(brokenStream === brokenError, "the streamed reader gives the same message");

// ---- Vectorworks 2016: u64 sizes and pointers under a 0x38-byte header (no GUID) ------------------

/** A 2018+ record as the 2016 layout: the inverse of legacy.ts's lengthen (its GUID and +0x48 bytes are dropped). */
function shorten(rec: Uint8Array): Uint8Array {
  const out = new Uint8Array(rec.length - 0x18);
  out.set(rec.subarray(0, 0x38), 0);
  out.set(rec.subarray(0x50), 0x38);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** Whether legacy.ts gives the body of the 2018+ record `rec` back as it is, read as a 2016 body. */
function keptAsIsMid(rec: Uint8Array): boolean {
  if (rec[0x19] === 0) return true;
  const body = rec.subarray(0x50);
  try {
    return keptAsIs(rec) && midDirect(rec[0x19], body) === undefined && midBody(rec[0x19], body) === body;
  } catch {
    return false;
  }
}

/** A 2016 file: the header's bytes with a 2016-length settings block and `savedWith`, then the records. */
function midFile(header: Uint8Array, records: Uint8Array[], savedWith = "VW21.0.3"): Uint8Array {
  const settings = 0x8a8;
  const h = header.slice(0, 0x94 + settings);
  setU32be(h, 0, settings);
  setU32(h, 0x94, settings);
  h.fill(0x20, 0x0e, 0x2e);
  h.set(new TextEncoder().encode(`VW21.0.3 ${savedWith}\0`), 0x0e);
  const file = concat([h, ...records]);
  setU32be(file, 0x54, file.length);
  return file;
}

const midRecords = blankAll.filter(keptAsIsMid);
const midRecs = midRecords.map(shorten);

// 14. shortened records in a 2016 file read back to the blank's records, GUIDs aside
check(midRecords.length >= blankAll.length / 2, `${midRecords.length} of the blank's ${blankAll.length} records keep their bodies as 2016 ones`);
check(midRecs.some((r) => r.length < 0x50) && midRecs[0].length >= 0x38, "the 2016 body holds records shorter than a 2018+ header (its terminators are 0x40 bytes)");
const mid = readContainer(midFile(blank, midRecs));
const midBack = splitRecords(mid.raw).map((r) => r.data);
check(mid.chunkCount === 0, "a 2016 body reads as records, not Snappy chunks");
check(midBack.length === midRecords.length, `2016 file: ${midBack.length} records read back, ${midRecords.length} written`);
check(midBack.every((r, i) => same(guidFree(r), guidFree(midRecords[i]))), "every 2016 record reads back as it was, GUID aside");
const midGuids = new Set(midBack.map((r) => new Rec(r).guid));
check(midGuids.size === midBack.length && midBack.every((r) => r.subarray(0x38, 0x48).some((b) => b !== 0)), "every 2016 record gets its own nonzero GUID");
check(same(readContainer(midFile(blank, midRecs)).raw, mid.raw), "the same 2016 file reads to the same GUIDs every time");
check(new TextDecoder().decode(mid.header.subarray(0x0e, 0x2e)).startsWith("VW31.2.0") && mid.savedWith === "VW21.0.3", "a 2016 drawing gets a 2018+ header and keeps the version it was saved with");

// 15. the same 2016 file streamed in small slices reads the same
const midStreamed = await readContainerStream(bytesSource(midFile(blank, midRecs)), { slice: 4 << 10 });
check(
  midStreamed.records.length === midBack.length && midStreamed.records.every((r, i) => same(r, midBack[i])) && same(midStreamed.header, mid.header) && midStreamed.units === mid.units,
  "2016 file streamed in 4 KB slices: the same records, header and units",
);

// 16. a converted drawing says it is one; a 2018+ drawing does not
check(read.converted === "2013" && streamed.converted === "2013", "a 2013 drawing is marked converted from 2013 records, read whole or streamed");
check(mid.converted === "2016" && midStreamed.converted === "2016", "a 2016 drawing is marked converted from 2016 records, read whole or streamed");
check(wide.converted === "2018", "uncompressed 2018+ records are marked as such");
check(blankRead.converted === null && (await readContainerStream(bytesSource(blank))).converted === null, "a 2018+ drawing is not marked converted");

// 17. the layout is told by the records, not by the first one's size or the saved-with version: a
// 2016 body whose first record is 0x50 bytes or more (as the 2017 files in error reports start), and
// one a newer Vectorworks exported for an older one (its own version in the header), read the same
const firstAux = midRecs.findIndex((r) => r[0x19] === 76);
const longFirst = midRecs.map((r) => r.slice());
if (firstAux === 0) {
  const grown = new Uint8Array(midRecs[0].length + 0x20);
  grown.set(midRecs[0], 0);
  setU64(grown, 0, BigInt(grown.length));
  longFirst[0] = grown;
}
const longRead = firstAux === 0 ? readContainer(midFile(blank, longFirst)) : null;
check(
  longRead !== null && longFirst[0].length >= 0x50 && longRead.converted === "2016" && splitRecords(longRead.raw).length === midBack.length && splitRecords(longRead.raw)[0].data.length === midBack[0].length + 0x20,
  "a 2016 body whose first record is 0x50 bytes or more reads as one (not as 2018+ records)",
);
const exported = readContainer(midFile(blank, midRecs, "VW28.0.4"));
check(exported.converted === "2016" && same(exported.raw, mid.raw) && exported.savedWith === "VW28.0.4", "a 2016 body under a 2023 saved-with version reads the same, marked converted");

// 18. a 2016 body is not taken for a 2013 one: before, its u64 sizes walked as u32 sizes with a zero
// mark and its records came out as an empty drawing
check(midRecs[0].length === 0x40 || midRecs.some((r) => r.length === 0x40), "the 2016 body holds 0x40-byte records, as a 2016 file's first is");
const aux40 = midRecs.find((r) => r.length < 0x50)!;
check(legacyStart(aux40.subarray(0, 16)) === "long" && legacyStart(narrowRecs[0].subarray(0, 16)) === "narrow", "a 0x40-byte 2016 record starts a long body, a 2013 record a narrow one");
check(midBack.length > 0 && midBack.every((r, i) => r[0x19] === midRecords[i][0x19]), "2016 records keep their types (none is read as a 2013 record)");

// 19. a 2016 or 2017 file that stops partway names its year and where
const midBroken = midRecs.map((r) => r.slice());
setU32(midBroken[3], 0x08, 0x12345678);
const midBrokenError = failure(midFile(blank, midBroken, "VW22.0.1"));
check(
  midBrokenError.startsWith("This file was saved by Vectorworks 2017, which Rodeo can't read yet: save it from Vectorworks 2018 or newer.") && midBrokenError.includes("older layout stops at record 3 at +0x"),
  `a 2017 body broken at its fourth record names the year and the record: ${midBrokenError}`,
);
const midExportBroken = failure(midFile(blank, midBroken, "VW28.0.4"));
check(midExportBroken.startsWith("Rodeo could not read this file's records (its older layout stops at record 3 at +0x"), `the same body under a 2023 version says where it stops: ${midExportBroken}`);

// 20. a 2016-layout file whose layers are a size never measured is refused, naming its year and the reason
const oddLayer = new Uint8Array(0x38 + 700);
oddLayer.set(midRecs[0].subarray(0, 0x38), 0);
setU64(oddLayer, 0, BigInt(oddLayer.length));
oddLayer[0x19] = 31;
const oddError = failure(midFile(blank, [...midRecs, oddLayer], "VW20.0.0"));
check(
  oddError === "This file was saved by Vectorworks 2015, which Rodeo can't read yet: save it from Vectorworks 2018 or newer. (its layers are 700-byte records, not the 732 Rodeo reads)",
  `a 2015 file with layers of another size names its year and the reason: ${oddError}`,
);
let oddStream = "";
try {
  await readContainerStream(bytesSource(midFile(blank, [...midRecs, oddLayer], "VW20.0.0")), { slice: 1 << 10 });
} catch (err) {
  oddStream = err instanceof Error ? err.message : String(err);
}
check(oddStream === oddError, "the streamed reader gives the same message");

// 21. units kept as sizes (before 2018): three f64, a u16 style and a length-prefixed 8-bit name, at an
// offset that moves with the version. The name may be followed by the end of a longer one, or be in
// another language, so the sizes decide.
function sizedHeader(at: number, perInch: number, perSquareInch: number, perCubicInch: number, style: number, name: string): Uint8Array {
  const h = readContainer(blank).header.slice();
  h.fill(0, 0x1ac, 0x304);
  setF64(h, at, perInch);
  setF64(h, at + 8, perSquareInch);
  setF64(h, at + 16, perCubicInch);
  setU16(h, at + 24, style);
  h[at + 26] = name.length;
  h.set(new TextEncoder().encode(name), at + 27);
  return h;
}
const ftinSized = readContainer(midFile(sizedHeader(0x190, 1, 1 / 144, 1 / 1728, 2, "Feet & Inchestrings"), midRecs));
check(ftinSized.units === "Feet & Inches", `"Feet & Inches" with the end of a longer name after it: ${ftinSized.units}`);
const cmSized = readContainer(midFile(sizedHeader(0x190, 2.54, 0.0254 ** 2, 0.0254 ** 3, 0, "Centimeter"), midRecs));
check(cmSized.units === "Centimeters", `centimetres under a Dutch name: ${cmSized.units}`);
const inSized = readContainer(legacyFile(sizedHeader(0x178, 1, 1 / 144, 1 / 1728, 0, "Zoll"), narrowRecs));
check(inSized.units === "Inches", `inches (style 0) at the 2013 offset: ${inSized.units}`);

// ---- the Vectorworks 2017 format: u64 sizes under a 0x48-byte header (the GUID, no 8 bytes after it) ----

/** A 2018+ record as the 2017 layout: the inverse of legacy.ts's lengthen (its +0x48 bytes are dropped, its GUID kept). */
function shortenLate(rec: Uint8Array): Uint8Array {
  const out = new Uint8Array(rec.length - 8);
  out.set(rec.subarray(0, 0x48), 0);
  out.set(rec.subarray(0x50), 0x48);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** A file a newer Vectorworks exported for 2017: the 2017 settings length, and "VectorWorks 191" where a saved file names its versions. */
function lateFile(header: Uint8Array, records: Uint8Array[], versions = "VectorWorks 191"): Uint8Array {
  const settings = 0x8b8;
  const h = header.slice(0, 0x94 + settings);
  setU32be(h, 0, settings);
  setU32(h, 0x94, settings);
  h.fill(0, 0x0e, 0x2e);
  h.set(new TextEncoder().encode(versions), 0x0e);
  const file = concat([h, ...records]);
  setU32be(file, 0x54, file.length);
  return file;
}

/** Whether legacy.ts gives the body of the 2018+ record `rec` back as it is, read as a 2017 body. */
function keptAsIsLate(rec: Uint8Array): boolean {
  if (rec[0x19] === 0) return true;
  try {
    const made = lateBody(rec[0x19], rec.subarray(0x50));
    return made != null && same(made, rec.subarray(0x50));
  } catch {
    return false;
  }
}
const lateRecords = blankAll.filter(keptAsIsLate);
const lateRecs = lateRecords.map(shortenLate);

// 22. records under 0x48-byte headers read back as they were, GUIDs and all
check(lateRecords.length >= 3 && lateRecs.some((r) => r[0x19] === 0 && r.length === 0x50), `${lateRecords.length} of the blank's ${blankAll.length} records keep their bodies as 2017 ones (its terminators are 0x50 bytes)`);
const late = readContainer(lateFile(blank, lateRecs));
const lateBack = splitRecords(late.raw).map((r) => r.data);
check(late.chunkCount === 0 && late.converted === "2017", `a 2017-format body reads as records and is marked so (${late.converted})`);
check(lateBack.length === lateRecords.length && lateBack.every((r, i) => same(r, lateRecords[i])), `every 2017 record reads back as it was, its own GUID kept (${lateBack.length})`);
check(late.savedWith === "191" && new TextDecoder().decode(late.header.subarray(0x0e, 0x2e)).startsWith("VW31.2.0"), `an exported file's "VectorWorks 191" is kept as its saved-with (${late.savedWith}) and the drawing gets a 2018+ header`);
const lateStreamed = await readContainerStream(bytesSource(lateFile(blank, lateRecs)), { slice: 4 << 10 });
check(lateStreamed.converted === "2017" && lateStreamed.records.length === lateBack.length && lateStreamed.records.every((r, i) => same(r, lateBack[i])), "2017-format file streamed in 4 KB slices: the same records");
check(readContainer(lateFile(blank, lateRecs, "VW22.0.1 VW22.0.1")).converted === "2017", "the same body under versions a saved 2017 file names reads the same");

// 23. the three u64 layouts are told apart by their terminators: 0x40, 0x50 and 0x58 bytes
check(mid.converted === "2016" && late.converted === "2017" && wide.converted === "2018", "terminators of 0x40, 0x50 and 0x58 bytes give the 2016, 2017 and 2018+ layouts");
const noEnd = lateRecs.filter((r) => r[0x19] !== 0);
const noEndRead = readContainer(lateFile(blank, noEnd));
check(noEndRead.converted === (noEnd.some((r) => r.length < 0x50) ? "2017" : "2018"), `a body with no terminator goes by its shortest record (${noEndRead.converted})`);

// 24. a 2017-format file whose layers are a size never measured is refused with the reason; under versions naming 2017, with the year
const oddLate = new Uint8Array(0x48 + 700);
oddLate.set(lateRecs.find((r) => r[0x19] !== 0)!.subarray(0, 0x48), 0);
setU64(oddLate, 0, BigInt(oddLate.length));
oddLate[0x19] = 31;
const oddLateError = failure(lateFile(blank, [...lateRecs, oddLate]));
check(oddLateError === "Rodeo could not read this file's records (its layers are 700-byte records, not the 742 Rodeo reads)", `an exported file with layers of another size says so: ${oddLateError}`);
const oddLateNamed = failure(lateFile(blank, [...lateRecs, oddLate], "VW22.0.1 VW22.0.1"));
check(
  oddLateNamed === "This file was saved by Vectorworks 2017, which Rodeo can't read yet: save it from Vectorworks 2018 or newer. (its layers are 700-byte records, not the 742 Rodeo reads)",
  `the same file saved by 2017 names its year too: ${oddLateNamed}`,
);

// 25. a file from before 2013 that walks as records but doesn't convert names its year alone: what
// the attempt met says nothing to anyone (Rodeo reads no layout that old)
const badTable = new Uint8Array(0x28 + 0x60);
setU32(badTable, 0, badTable.length);
setU32(badTable, 4, 0x05792ca4);
badTable[0x0d] = 55;
setU32(badTable, 0x1a, 0x1000);
setU32(badTable, 0x28 + 8, 3);
const older = oldHeader.slice();
const olderError = failure(legacyFile(older, [badTable, ...narrowRecs]));
check(olderError === "This file was saved by Vectorworks 2007, which Rodeo can't read yet: save it from Vectorworks 2013 or newer.", `a 2007 file that fails to convert names its year alone: ${olderError}`);
const sameIn2013 = failure(legacyFile(blank, [badTable, ...narrowRecs]));
check(sameIn2013.startsWith("Rodeo could not read this file's records (the name table"), `the same records under a current version say what failed: ${sameIn2013}`);

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
