// Bodies of the records of the format Vectorworks 2018 and 2019 save in (FORMAT.md §1.4) as the
// bodies Rodeo reads. legacy.ts calls earlyBody for every such record but terminators.
//
// These files are uncompressed u64-sized records under 2017's 0x48-byte header (the 2018+ header to
// the end of its GUID), and their bodies are mostly 2017's: drawn objects lack the u32 material slot
// at body +0x38. Unlike 2017 their text is UTF-16 throughout (layer names, the font list, record
// formats, viewports), so those types need only the slot or nothing. What differs from 2017:
//
//   name table     an index list, then the names in the same order (earlyNames)
//   text           two u16 point sizes per style run where later files have two f64s
//   3D polygons    the corner count sits before the 3D box, not just before the corners
//   hatches        the line count and the ground's colour are the other way round
//
// Measured on four public drawings a newer Vectorworks saved twice, for 2018 and for 2022 (243,964
// records paired by GUID): every conversion below gives the 2022 body byte for byte, but for bytes
// later versions fill in that Rodeo doesn't read (attribute +0x05, stale pointers, padding, the
// point sizes, which 2022 keeps unrounded), and for types 2022 stores differently but Rodeo reads in
// both shapes (symbol definitions and plug-ins come out as 2021 files have them, as 2017's do; 2022
// drops 3D bodies' caches, which keep 2017's layout here). Checked as well on a file Vectorworks 2019
// saved itself. Types the pairs don't hold take 2017's rule where their sizes fit it.
import type { BodyConversion } from "./legacy.ts";
import { encodeUtf16, readUtf16, setF64, setU16, setU32, u16, u32 } from "./bytes.ts";
import { DASH_DATA_SIZE, lateBody, pluginBody, symbolDefinitionBody } from "./legacyLate.ts";

const SLOT_AT = 0x38;
const SLOT = 4;

function withZeros(body: Uint8Array, at: number, count: number): Uint8Array {
  const out = new Uint8Array(body.length + count);
  out.set(body.subarray(0, at), 0);
  out.set(body.subarray(at), at + count);
  return out;
}

function withSlot(body: Uint8Array): Uint8Array | null {
  return body.length >= SLOT_AT ? withZeros(body, SLOT_AT, SLOT) : null;
}

/** Types whose bodies are 2018+'s as they are (every pair identical, or differing only in bytes Rodeo doesn't read). */
const SAME = new Set([2, 9, 17, 26, 27, 28, 33, 39, 44, 47, 49, 59, 61, 62, 70, 74, 76, 77, 79, 80, 91, 93, 94, 97, 100, 106, 108, 109, 112, 115, 119, 120, 121, 123, 124, 125]);
/** Types whose bodies are 2018+'s without the material slot; 40, 71, 111 and 122 (not in the pairs) by their sizes and where Rodeo's fields land. */
const SLOTTED = new Set([3, 5, 6, 11, 14, 18, 21, 24, 31, 40, 51, 54, 56, 57, 60, 65, 71, 78, 84, 92, 111, 122]);
/**
 * Types left out with what they hold, as in 2017: record data (48, laid out differently), slab and
 * wall components and styles (69, 102, 107, 127), profile caches (42), the dash table (30, read into
 * the line types) and a line type (96) it doesn't name.
 */
const LEFT_OUT = new Set([30, 42, 48, 69, 96, 102, 107, 127, 128]);

/** a dimension of 2018+'s size less the slot; one of another size keeps only its attributes and plan box (its lines and text are its children) */
const DIM_NEW = 768;

function dimensionBody(body: Uint8Array): Uint8Array {
  if (body.length === DIM_NEW - SLOT) return withSlot(body)!;
  const out = new Uint8Array(DIM_NEW);
  out.set(body.subarray(0, Math.min(body.length, SLOT_AT)), 0);
  return out;
}

/**
 * A text: its u16 line count at +0xac and style-run count at +0xae, then from +0xb4 the line table
 * ((lines - 1) u16s) and one 26-byte block per run, whose first four bytes are two u16 point sizes
 * where 2018+ has two f64s (12 bytes more a run), with the material slot put in as everywhere.
 */
const TEXT_LINES = 0xac;
const TEXT_RUNS = 0xae;
const TEXT_TABLE = 0xb4;
const RUN = 26;

function textBody(body: Uint8Array): Uint8Array | null {
  if (body.length < TEXT_TABLE) return null;
  const lines = u16(body, TEXT_LINES);
  const runs = u16(body, TEXT_RUNS);
  let at = TEXT_TABLE + 2 * Math.max(0, lines - 1);
  if (runs < 1 || at + RUN * runs > body.length) return null;
  const out = new Uint8Array(body.length + SLOT + 12 * runs);
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, at), SLOT_AT + SLOT);
  let to = at + SLOT;
  for (let k = 0; k < runs; k++, at += RUN, to += RUN + 12) {
    setF64(out, to, u16(body, at));
    setF64(out, to + 8, u16(body, at + 2));
    out.set(body.subarray(at + 4, at + RUN), to + 16);
  }
  out.set(body.subarray(at), to);
  return out;
}

/**
 * A 3D polygon: its corner count is a u16 at +0x3a (after the closed byte) where 2018+ has it at
 * +0x80, just before the corners; 2018+ keeps zero in the old place.
 */
const POLY_COUNT = 0x3a;
const POLY_CORNERS = 0x7c;

function polygon3dBody(body: Uint8Array): Uint8Array | null {
  if (body.length < POLY_CORNERS) return null;
  const out = new Uint8Array(body.length + SLOT + 2);
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, POLY_COUNT), SLOT_AT + SLOT);
  out.set(body.subarray(POLY_COUNT + 2, POLY_CORNERS), POLY_COUNT + SLOT + 2);
  setU16(out, POLY_CORNERS + SLOT, u16(body, POLY_COUNT));
  out.set(body.subarray(POLY_CORNERS), POLY_CORNERS + SLOT + 2);
  return out;
}

/**
 * The name table: +0x00 8 bytes kept, +0x08 u32 count, then from +0x18 count 12-byte entries (u32
 * index, 8 zero bytes) and 4 more bytes, then the names in the same order, each a u32 byte length
 * and UTF-16. 2018+ has each index with its name (names.ts). Null when it doesn't read to the end.
 */
export function earlyNames(body: Uint8Array): { index: number; name: string }[] | null {
  if (body.length < 0x0c) return null;
  const count = u32(body, 0x08);
  let at = 0x18 + 12 * count + 4;
  if (at > body.length) return null;
  const out: { index: number; name: string }[] = [];
  for (let k = 0; k < count; k++) {
    if (at + 4 > body.length) return null;
    const len = u32(body, at);
    if (len % 2 !== 0 || at + 4 + len > body.length) return null;
    out.push({ index: u32(body, 0x18 + 12 * k), name: readUtf16(body, at + 4, len) });
    at += 4 + len;
  }
  return at === body.length ? out : null;
}

function nameTableBody(body: Uint8Array): Uint8Array | null {
  const names = earlyNames(body);
  if (!names) return null;
  const parts = names.map((e) => encodeUtf16(e.name));
  const out = new Uint8Array(0x0c + parts.reduce((n, p) => n + 8 + p.length, 0));
  out.set(body.subarray(0, 0x08), 0);
  setU32(out, 0x08, names.length);
  let at = 0x0c;
  names.forEach((e, k) => {
    setU32(out, at, e.index);
    setU32(out, at + 4, parts[k].length);
    out.set(parts[k], at + 8);
    at += 8 + parts[k].length;
  });
  return out;
}

/** A hatch: its u16 line count is at +0x04 and its ground's colour at +0x06, the other way round from 2018+. */
function hatchBody(body: Uint8Array): Uint8Array | null {
  if (body.length < 8) return null;
  const out = body.slice();
  setU16(out, 4, u16(body, 6));
  setU16(out, 6, u16(body, 4));
  return out;
}

/** a 3D body is 2018+'s after its first ten bytes, as in 2017 (legacyLate.ts) */
const BODY_HEAD = 10;

/**
 * The dashes of a dash table (30), by their line type's name: a u16 count, then 268-byte entries
 * (the dashes the line type keeps in 2018+ first), then the names in the same order, each a u32 byte
 * length and UTF-16. Empty when it doesn't read to its end. Measured on two tables (one line type
 * each in the pairs, the bodies made from them the 2022 files' byte for byte).
 */
const DASH_ENTRY = 268;

export function earlyDashes(body: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (body.length < 2) return out;
  const n = u16(body, 0);
  let at = 2 + DASH_ENTRY * n;
  const names: string[] = [];
  for (let k = 0; k < n; k++) {
    if (at + 4 > body.length) return out;
    const len = u32(body, at);
    if (len % 2 !== 0 || at + 4 + len > body.length) return out;
    names.push(readUtf16(body, at + 4, len));
    at += 4 + len;
  }
  if (at !== body.length) return out;
  names.forEach((name, k) => out.set(name, body.subarray(2 + DASH_ENTRY * k, 2 + DASH_ENTRY * k + DASH_DATA_SIZE)));
  return out;
}

/**
 * The 2018+ body (from +0x50) for a record of type `type` whose body (from its +0x48) is `body`:
 * null to leave the record out with what it holds, undefined when the type isn't one read here.
 */
export function earlyBody(type: number, body: Uint8Array): BodyConversion {
  if (SAME.has(type)) return body;
  if (SLOTTED.has(type)) return withSlot(body);
  if (LEFT_OUT.has(type)) return null;
  // mesh faces and the 2017 rule's sized types (rounded rectangles, symbols, sweeps, lights)
  if (type === 41 || type === 13 || type === 15 || type === 34 || type === 81) return lateBody(type, body);
  if (type === 63) return dimensionBody(body);
  if (type === 10) return textBody(body);
  if (type === 66) return hatchBody(body);
  if (type === 114) return withZeros(body, 0, BODY_HEAD);
  if (type === 25) return polygon3dBody(body);
  if (type === 55) return nameTableBody(body);
  if (type === 16) return symbolDefinitionBody(body);
  if (type === 86) return pluginBody(body);
  return undefined;
}
