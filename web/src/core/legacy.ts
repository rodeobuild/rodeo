// Bodies that are not Snappy chunks: the record stream itself, uncompressed, as Vectorworks wrote
// it before 2018. container.ts asks here first; a body that starts as none of the layouts below is
// read as Snappy chunks, as before. FORMAT.md §1.1 and §1.2 hold what was measured.
//
//   narrow  Vectorworks 2013: u32 sizes and pointers, a 0x28-byte header and no GUID. Measured on
//           a 2013 file of 8,602 records: every size lands exactly on the next record, every
//           next-sibling mark is 0x05792ca4 or 0, and +0x0c is 0 throughout.
//   mid     Vectorworks 2016 (three files, 422 records): u64 sizes and pointers, a 0x38-byte
//           header, which is the 2018+ header without its GUID.
//   late    the Vectorworks 2017 format (one file a newer Vectorworks exported for it, 41,942
//           records; six error reports' sizes fit it, one of them from a file Vectorworks 2017
//           saved): u64 sizes, a 0x48-byte header, which is the 2018+ header to the end of its
//           GUID, without the 8 bytes after it.
//   wide    u64 sizes and the whole 0x50-byte 2018+ header, uncompressed. Never seen in a file:
//           kept so such a body passes through as it is.
//
// No 2014 or 2015 file has been seen; one opens when its body reads as one of these end to end.
//
//   2013          2016          2017          2018+         field
//   +0x00 u32     +0x00 u64     +0x00 u64     +0x00 u64     size
//   +0x04 u32     +0x08 u64     +0x08 u64     +0x08 u64     next-sibling mark
//   +0x08 u32     +0x10 u64     +0x10 u64     +0x10 u64     aux-list pointer
//   +0x0c u8      +0x18 u8      +0x18 u8      +0x18 u8      (0 in all 8,602)
//   +0x0d u8      +0x19 u8      +0x19 u8      +0x19 u8      object type
//   +0x0e u16     +0x1a u16     +0x1a u16     +0x1a u16     name index
//   +0x10 3 B     +0x1c 3 B     +0x1c 3 B     +0x1c 3 B     (zero in all but 2 of 8,602)
//   +0x13 u8      +0x1f u8      +0x1f u8      +0x1f u8      flags
//   +0x14 u32     +0x20 u32     +0x20 u32     +0x20 u32     class index
//   +0x18 u16     +0x24 u16     +0x24 u16     +0x24 u16     by-class flags
//   +0x1a u32     +0x26 u64     +0x26 u64     +0x26 u64     owner pointer
//   +0x1e 10 B    +0x2e 10 B    +0x2e 10 B    +0x2e 10 B    copied across (what they hold is not known)
//   (none)        (none)        +0x38 16 B    +0x38 16 B    GUID: made here where the record has none
//   (none)        (none)        (none)        +0x48 8 B     zero
//   +0x28 ...     +0x38 ...     +0x48 ...     +0x50 ...     body, converted per type
//
// A 2013 terminator's body is a u32 (later: a u64), so it is widened with zeros. A 2016 body is
// first made a 2013 body (legacyMid.ts: its pointers narrowed), and a 2013 body a 2018+ one
// (legacyDoc.ts, legacyShapes.ts); a 2017 body is made a 2018+ one directly (legacyLate.ts).
// Records are made 2018+ records in memory; saving writes them as Snappy chunks under a 2018+
// header (legacyHeader).
//
// Units: the settings block of these files keeps its length unit as three sizes and an 8-bit name
// ("Feet & Inches"), not the UTF-16 fields settings.ts reads from 2018+ files, so the unit is told
// by its sizes (unitsBySize), or else by looking for the unit names.

import { blankHeader } from "./blank.ts";
import { docBody, nameEntries } from "./legacyDoc.ts";
import { earlyBody, earlyDashes, earlyNames } from "./legacyEarly.ts";
import { lateBody, lineTypeBodies } from "./legacyLate.ts";
import { midBody, midDirect } from "./legacyMid.ts";
import { shapeBody, shapeType } from "./legacyShapes.ts";
import { setU32, setU64, u32, u64 } from "./bytes.ts";
import { LENGTH_UNITS, unitsBySize, unitsName, unitsPatch } from "./settings.ts";

const NARROW_HEAD = 0x28;
const MID_HEAD = 0x38;
const LATE_HEAD = 0x48;
const WIDE_HEAD = 0x50;
const MARK = 0x05792ca4;
const TERMINATOR = 0;
/** where the settings block starts (the units are inside it) */
const SETTINGS = 0x94;
/** unit names longest first, so "Feet & Inches" is read before "Feet" */
const UNIT_NAMES = [...LENGTH_UNITS].sort((a, b) => b.length - a.length);

/**
 * What a converter makes of a 2013 record's body (from its +0x28): the 2018+ body (from +0x50), null
 * to leave the record out, or undefined when the type isn't one it converts.
 */
export type BodyConversion = Uint8Array | null | undefined;

/**
 * The layouts a body can have that are not Snappy chunks, as its first bytes tell them apart:
 * narrow records (u32 sizes, Vectorworks 2013) or long ones (u64 sizes: 2016's 0x38-byte headers,
 * 2017's 0x48-byte ones or whole 2018+ headers, which only the records themselves tell apart, see
 * longRecords).
 */
export type LegacyLayout = "narrow" | "long";

function isLetter(c: number): boolean {
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

function markOk(v: number): boolean {
  return v === MARK || v === 0;
}

/**
 * The layout a body starts in, from its first 16 bytes (fewer when the file is that short): long
 * when its first record has a u64 size of at least 0x38 and a u64 mark (its u32 at +0x04 is the
 * size's high half, 0, which is also a narrow record's "last in list" mark, so this is tested
 * first; a narrow record passes it only as a terminator, whose +0x0c is 0 too, and those are
 * shorter than 0x38), narrow when its first record has a u32 size of at least 0x28 and a 2013
 * mark. Null otherwise, so a Snappy body (whose first u32 is a chunk size and whose second starts
 * a Snappy block, neither a mark) is never taken here.
 */
export function legacyStart(first: Uint8Array): LegacyLayout | null {
  if (first.length >= 16 && u32(first, 4) === 0 && u32(first, 0) >= MID_HEAD && u32(first, 12) === 0 && markOk(u32(first, 8))) {
    return "long";
  }
  if (first.length >= 8 && u32(first, 0) >= NARROW_HEAD && markOk(u32(first, 4))) return "narrow";
  return null;
}

/**
 * Which records a converted body held, by the year they were measured in: "2013" its narrow ones
 * (2D only comes in), "2016" 0x38-byte headers (2D, extrudes and sweeps), "2017" 0x48-byte headers
 * (2D and 3D), "2019" 0x48-byte headers over UTF-16 text, as Vectorworks 2018 and 2019 save (2D
 * and 3D), "2018" whole 2018+ records without compression (everything, as they are).
 */
export type LegacyKind = "2013" | "2016" | "2017" | "2019" | "2018";

/**
 * The whole body as 2018+ records, when it is the layout `layout` from its first record to its
 * end (the sizes must land exactly on the end), and which records it held; null when it isn't.
 * Throws when the body is such records but one of them can't be converted (a name table that
 * doesn't parse, a layer or class of a size never measured).
 */
export function legacyRecords(layout: LegacyLayout, body: Uint8Array): { records: Uint8Array[]; kind: LegacyKind } | null {
  if (layout === "narrow") {
    const recs = cutRecords("narrow", body);
    return recs ? { records: convert(NARROW, recs), kind: "2013" } : null;
  }
  return longRecords(body);
}

/** The smallest a record of `layout` can be: its header (a long record's is 0x38 bytes at the least). */
function smallest(layout: LegacyLayout): number {
  return layout === "narrow" ? NARROW_HEAD : MID_HEAD;
}

/**
 * Where a body of `layout` records stops reading, or null when it reads to its end: its records'
 * sizes must land exactly on the end, but for zeros after the last one, too few to start another.
 * `read` is how many whole records came before the stop.
 */
export function legacyStop(layout: LegacyLayout, body: Uint8Array): { readonly read: number; readonly why: string } | null {
  const head = smallest(layout);
  let n = 0;
  for (let p = 0; p < body.length; n++) {
    const left = body.length - p;
    if (left < head && body.subarray(p).every((b) => b === 0)) return null;
    if (left < 16) return { read: n, why: `record ${n} at +0x${p.toString(16)}: ${left} bytes left` };
    const size = u32(body, p);
    // a long record's u32 at +0x04 is its size's high half, and its mark is the u64 at +0x08
    const mark = layout === "narrow" ? u32(body, p + 4) : u32(body, p + 8);
    const markFits = layout === "narrow" ? markOk(mark) : u32(body, p + 4) === 0 && markOk(mark) && u32(body, p + 12) === 0;
    if (size < head || p + size > body.length || !markFits) {
      return { read: n, why: `record ${n} at +0x${p.toString(16)}: size 0x${size.toString(16)}, next 0x${mark.toString(16)}, 0x${left.toString(16)} bytes left` };
    }
    p += size;
  }
  return null;
}

/** The records of a body of `layout` records, up to its end or the zeros after its last (legacyStop). */
function cutRecords(layout: LegacyLayout, body: Uint8Array): Uint8Array[] | null {
  if (legacyStop(layout, body) !== null) return null;
  const head = smallest(layout);
  const recs: Uint8Array[] = [];
  for (let p = 0; body.length - p >= head; ) {
    const size = u32(body, p);
    recs.push(body.subarray(p, p + size));
    p += size;
  }
  return recs;
}

/**
 * The header length of a body of u64-sized records, from its first terminator: a terminator's
 * body is a u64, so it is 8 bytes longer than the header (0x40, 0x50 or 0x58 bytes), and every
 * drawing has lists. A body with no terminator goes by its shortest record. Null when the length
 * is none of the three known.
 */
function longHead(recs: readonly Uint8Array[]): number | null {
  const end = recs.find((r) => r[0x19] === TERMINATOR);
  const head = end ? end.length - 8 : recs.reduce((least, r) => Math.min(least, r.length), WIDE_HEAD) < LATE_HEAD ? MID_HEAD : recs.some((r) => r.length < WIDE_HEAD) ? LATE_HEAD : WIDE_HEAD;
  return head === MID_HEAD || head === LATE_HEAD || head === WIDE_HEAD ? head : null;
}

/**
 * A body of u64-sized records: 2016's (0x38-byte headers) or 2017's (0x48), converted, or whole
 * 2018+ records as they are, uncompressed (0x50). Null when its headers are none of those, or a
 * record is shorter than its header.
 */
function longRecords(body: Uint8Array): { records: Uint8Array[]; kind: LegacyKind } | null {
  const recs = cutRecords("long", body);
  const head = recs && longHead(recs);
  if (!recs || head === null || recs.some((r) => r.length < head)) return null;
  if (head === MID_HEAD) return { records: convert(MID, recs), kind: "2016" };
  if (head === LATE_HEAD) return isEarly(recs) ? { records: convert(EARLY, recs), kind: "2019" } : { records: convert(LATE, recs), kind: "2017" };
  return { records: recs.map((r) => r.slice()), kind: "2018" };
}

/** How an older layout's records are read: where their header fields are, and how each becomes a 2018+ record. */
interface OldLayout {
  /** the header's length: where the body starts */
  readonly head: number;
  type(rec: Uint8Array): number;
  /** the owner pointer: the value the records of one list share */
  owner(rec: Uint8Array): number | bigint;
  /** whether the record's next mark is 0 (the last of its list's aux part, or a terminator) */
  last(rec: Uint8Array): boolean;
  /**
   * the converter for one drawing's records, made once from all of them: it gives a record's 2018+
   * body, null to leave the record out with what it holds, undefined for a type not converted
   */
  reader(recs: readonly Uint8Array[]): (type: number, rec: Uint8Array) => BodyConversion;
  /** types not converted whose bodies are kept as they are, whether they hold others or not */
  readonly same: ReadonlySet<number>;
  /** types not converted that are left out with what they hold */
  readonly leftOut: ReadonlySet<number>;
  /** the record's header over `body` (its 2018+ body) as a 2018+ record; `index` is its place in the stream */
  widen(rec: Uint8Array, index: number, body: Uint8Array): Uint8Array;
}

/** A 2013 body's 2018+ body, by the document's converter or else the shapes'. */
function from2013(type: number, old: Uint8Array): BodyConversion {
  const doc = docBody(type, old);
  return doc !== undefined ? doc : shapeBody(type, old);
}

/** Types whose 2013 and 2016 bodies are read as they are: aux data (tagged dictionaries), the symbol library and its folders (Rodeo reads only their names and what they hold). */
const SAME_BODY: ReadonlySet<number> = new Set([76, 54, 92]);
/** Types neither 2013 converter takes that Rodeo reads (worksheets, textures, preview images, wall styles): left out with what they hold. */
const LEFT_OUT: ReadonlySet<number> = new Set([18, 97, 119, 127]);
const NONE: ReadonlySet<number> = new Set();

/** Vectorworks 2013 records. */
const NARROW: OldLayout = {
  head: NARROW_HEAD,
  type: (rec) => rec[0x0d],
  owner: (rec) => u32(rec, 0x1a),
  last: (rec) => u32(rec, 0x04) === 0,
  reader: () => (type, rec) => from2013(type, rec.subarray(NARROW_HEAD)),
  same: SAME_BODY,
  leftOut: LEFT_OUT,
  widen,
};

/**
 * The 2018+ bodies of the line types (96) of a drawing of u64-sized records under `head`-byte
 * headers, by their records (legacyLate.ts lineTypeBodies): the names come from its name table.
 */
function lineTypes(head: number, recs: readonly Uint8Array[], early = false): Map<Uint8Array, Uint8Array> {
  const out = new Map<Uint8Array, Uint8Array>();
  const mine = recs.filter((r) => r[0x19] === 96 || r[0x19] === 30);
  if (!mine.some((r) => r[0x19] === 96)) return out;
  const table = recs.find((r) => r[0x19] === 55);
  const names = new Map<number, string>();
  if (table) for (const e of (early ? earlyNames(table.subarray(head)) : nameEntries(table.subarray(head))) ?? []) names.set(e.index, e.name);
  const older = mine.map((r) => ({ type: r[0x19], name: r[0x1a] | (r[0x1b] << 8), body: r.subarray(head) }));
  const bodies = early ? lineTypeBodies(older, names, earlyDashes) : lineTypeBodies(older, names);
  older.forEach((o, i) => {
    const made = bodies.get(o);
    if (made) out.set(mine[i], made);
  });
  return out;
}

/** Vectorworks 2016 records: an extrude or sweep is made 2018+'s directly, the rest by way of their 2013 bodies. */
const MID: OldLayout = {
  head: MID_HEAD,
  type: (rec) => rec[0x19],
  owner: (rec) => u64(rec, 0x26),
  last: (rec) => u64(rec, 0x08) === 0n,
  reader: (recs) => {
    const lines = lineTypes(MID_HEAD, recs);
    return (type, rec) => {
      const line = lines.get(rec);
      if (line) return line;
      const body = rec.subarray(MID_HEAD);
      const direct = midDirect(type, body);
      if (direct !== undefined) return direct;
      const old = midBody(type, body);
      return old === null ? null : from2013(type, old);
    };
  },
  same: SAME_BODY,
  leftOut: LEFT_OUT,
  widen: (rec, index, body) => lengthen(MID_HEAD, rec, index, body),
};

/** Vectorworks 2017 records: legacyLate.ts names every type it keeps, converts or leaves out. */
const LATE: OldLayout = {
  head: LATE_HEAD,
  type: (rec) => rec[0x19],
  owner: (rec) => u64(rec, 0x26),
  last: (rec) => u64(rec, 0x08) === 0n,
  reader: (recs) => {
    const lines = lineTypes(LATE_HEAD, recs);
    return (type, rec) => lines.get(rec) ?? lateBody(type, rec.subarray(LATE_HEAD));
  },
  same: NONE,
  leftOut: NONE,
  widen: (rec, index, body) => lengthen(LATE_HEAD, rec, index, body),
};

/**
 * Whether 0x48-byte records are Vectorworks 2018/2019's (legacyEarly.ts) rather than the 2017
 * format: their name table reads as UTF-16 names to its end. A 2017 table (2013's entries, 8-bit
 * names in fixed slots) never does: its count is followed by entries, not the zeros an index list
 * of 12-byte entries and UTF-16 lengths need.
 */
function isEarly(recs: readonly Uint8Array[]): boolean {
  const table = recs.find((r) => r[0x19] === 55);
  return table !== undefined && earlyNames(table.subarray(LATE_HEAD)) !== null;
}

/** Vectorworks 2018 and 2019 records: legacyEarly.ts names every type it keeps, converts or leaves out. */
const EARLY: OldLayout = {
  head: LATE_HEAD,
  type: (rec) => rec[0x19],
  owner: (rec) => u64(rec, 0x26),
  last: (rec) => u64(rec, 0x08) === 0n,
  reader: (recs) => {
    const lines = lineTypes(LATE_HEAD, recs, true);
    return (type, rec) => lines.get(rec) ?? earlyBody(type, rec.subarray(LATE_HEAD));
  },
  same: NONE,
  leftOut: NONE,
  widen: (rec, index, body) => lengthen(LATE_HEAD, rec, index, body),
};

/**
 * The older records `recs` as 2018+ records, each body converted by its layout. A record left out
 * (null), or of a type the layout leaves out, is dropped with everything under it; one of a type
 * not converted is kept as it is when the layout says its body is the same or it holds others
 * (Rodeo reads such containers only for what they hold), else dropped, so no older body is read as
 * a 2018+ one where Rodeo reads it. When a dropped record closed its list's aux
 * part (next mark 0), the record before it in the same list takes the 0. The tree is walked as
 * records.ts buildTree walks it, from the owner pointers.
 */
function convert(layout: OldLayout, recs: Uint8Array[]): Uint8Array[] {
  const out: Uint8Array[] = [];
  const stack: { owner: number | bigint; last: Uint8Array | null }[] = [];
  const body = layout.reader(recs);
  /** while a dropped record's subtree is being skipped, the depth of the list that record was in */
  let skipping = 0;
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const type = layout.type(rec);
    const owner = layout.owner(rec);
    if (stack.length > 0 && stack[stack.length - 1].owner === owner) {
      // in the current list
    } else if (stack.some((e) => e.owner === owner)) {
      while (stack[stack.length - 1].owner !== owner) stack.pop();
    } else {
      stack.push({ owner, last: null });
    }
    if (skipping && stack.length <= skipping) skipping = 0;
    if (skipping) {
      if (type === TERMINATOR) stack.pop();
      continue;
    }
    const list = stack[stack.length - 1];
    const next = recs[i + 1];
    // the next record opens a list of this one's when its owner is on no list yet
    const nextOwner = next === undefined ? null : layout.owner(next);
    const parent = nextOwner !== null && type !== TERMINATOR && !stack.some((e) => e.owner === nextOwner);
    const own = rec.subarray(layout.head);
    let made: BodyConversion = own;
    if (type !== TERMINATOR) {
      made = body(type, rec);
      if (made === undefined) made = layout.leftOut.has(type) ? null : layout.same.has(type) || parent ? own : null;
    }
    if (made == null) {
      if (layout.last(rec) && list.last) setU64(list.last, 0x08, 0n);
      if (parent) skipping = stack.length;
    } else {
      const wide = layout.widen(rec, out.length, made);
      wide[0x19] = shapeType(type);
      out.push(wide);
      list.last = wide;
    }
    if (type === TERMINATOR) stack.pop();
  }
  return out;
}

/** A 2013 record's header over `body` (its 2018+ body) as a 2018+ record; `index` is its place in the stream. */
function widen(rec: Uint8Array, index: number, body: Uint8Array): Uint8Array {
  const extra = rec[0x0d] === TERMINATOR && body.length === 4 ? 4 : 0;
  const out = new Uint8Array(WIDE_HEAD + body.length + extra);
  setU64(out, 0x00, BigInt(out.length));
  setU64(out, 0x08, BigInt(u32(rec, 0x04)));
  setU64(out, 0x10, BigInt(u32(rec, 0x08)));
  out.set(rec.subarray(0x0c, 0x0d), 0x18);
  out.set(rec.subarray(0x0d, 0x0e), 0x19);
  out.set(rec.subarray(0x0e, 0x10), 0x1a);
  out.set(rec.subarray(0x10, 0x13), 0x1c);
  out.set(rec.subarray(0x13, 0x14), 0x1f);
  out.set(rec.subarray(0x14, 0x18), 0x20);
  out.set(rec.subarray(0x18, 0x1a), 0x24);
  setU64(out, 0x26, BigInt(u32(rec, 0x1a)));
  out.set(rec.subarray(0x1e, 0x28), 0x2e);
  out.set(guidOf(index, rec.subarray(0, NARROW_HEAD)), 0x38);
  out.set(body, WIDE_HEAD);
  return out;
}

/**
 * A 2016 or 2017 record's header (`head` bytes: 0x38 or 0x48) over `body` (its 2018+ body) as a
 * 2018+ record: the header's bytes are the 2018+ header's first, so only the size changes. A 2016
 * record has no GUID, so one is made; a 2017 record keeps its own.
 */
function lengthen(head: number, rec: Uint8Array, index: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(WIDE_HEAD + body.length);
  out.set(rec.subarray(0, head), 0);
  setU64(out, 0x00, BigInt(out.length));
  if (head < LATE_HEAD) out.set(guidOf(index, rec.subarray(0, head)), 0x38);
  out.set(body, WIDE_HEAD);
  return out;
}

/**
 * A GUID for a record that has none: four FNV-1a hashes of its older header `head`, each started
 * from the record's place in the stream, so no two records of a drawing share one and the same
 * file gives the same ones every time it opens.
 */
function guidOf(index: number, head: Uint8Array): Uint8Array {
  const out = new Uint8Array(16);
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(k + 1, 0x85ebca6b)) >>> 0;
    for (let i = 0; i < head.length; i++) h = Math.imul(h ^ head[i], 0x01000193) >>> 0;
    setU32(out, 4 * k, h);
  }
  return out;
}

/** The name of a length unit written as ASCII in a settings block, or null when none is. */
function asciiUnits(file: Uint8Array): string | null {
  for (let p = SETTINGS; p < file.length; p++) {
    if (isLetter(file[p - 1] ?? 0)) continue;
    for (const name of UNIT_NAMES) {
      const end = p + name.length;
      if (end > file.length || (end < file.length && isLetter(file[end]))) continue;
      let i = 0;
      while (i < name.length && file[p + i] === name.charCodeAt(i)) i++;
      if (i === name.length) return name;
    }
  }
  return null;
}

/**
 * The 2018+ container header for a legacy drawing, and its length unit. The header is Rodeo's
 * blank one (blank.ts) with the units of `file` (the legacy file's own header bytes, settings block
 * included) written over it: the unit its sizes name, or else the first unit name written in it.
 * A file whose units can't be found is read as millimetres.
 */
export function legacyHeader(file: Uint8Array): { header: Uint8Array; units: string } {
  const found = unitsName(file) ?? unitsBySize(file) ?? asciiUnits(file);
  const units = found !== null && LENGTH_UNITS.includes(found) ? found : "Millimeters";
  const header = blankHeader(units === "Feet & Inches" ? "ftin" : "mm");
  const patch = unitsPatch(header, units);
  header.set(patch.bytes, patch.at);
  return { header, units };
}

/** The year a file's saved-with version names (VW18 is 2013: the year is the major version + 1995), or null. */
export function savedYear(savedWith: string): number | null {
  const m = /^VW(\d+)/.exec(savedWith);
  return m ? 1995 + Number(m[1]) : null;
}

/**
 * The message for a file that can't be read, when it was saved before 2013 (Rodeo reads none of
 * those) or in 2014 to 2017 (Rodeo reads the layouts measured in 2016 files and in the 2017
 * format; one that still fails is some other). Null for the other years, whose errors are the
 * reader's own.
 */
export function unreadableMessage(savedWith: string): string | null {
  const year = savedYear(savedWith);
  if (year === null || year === 2013 || year >= 2018) return null;
  if (year < 2013) return `This file was saved by Vectorworks ${year}, which Rodeo can't read yet: save it from Vectorworks 2013 or newer.`;
  return `This file was saved by Vectorworks ${year}, which Rodeo can't read yet: save it from Vectorworks 2018 or newer.`;
}
