// Bodies of the records of the Vectorworks 2017 format (FORMAT.md §1.3) as 2018+ bodies.
// legacy.ts calls lateBody for every such record but terminators.
//
// Measured on one public drawing that Vectorworks 2022 exported twice, for Vectorworks 2017
// (41,942 records) and for Vectorworks 2021 (42,507 records, the 2018+ layout): the two files keep
// each record's GUID, so 32,720 records pair by it and 9,135 more (mesh faces and 3D bodies, which
// have none) by their place under a paired parent. Every conversion below gives, for every pair of
// its type, the 2021 file's body byte for byte, but for stale bytes (six of a pointer in a text,
// the bytes after a name's end in its slot, the first two of a 3D body's ten). As Rodeo draws
// them, the two files are then the same: all 19 layers (5 design, 14 sheets) export to the same
// SVG, and the 3D model is the same 80 meshes.
//
// The 2017 format is 2018+'s in most things. What differs:
//
//   drawn objects  have no u32 material slot at body +0x38 (2018+ record +0x88): rectangles, polygons,
//                  arcs, texts, groups, polylines, extrudes, meshes, solids and the lists 54, 57,
//                  65, 78 and 92 are the 2018+ bodies without it
//   text in slots  is a length byte and 8-bit characters where 2018+ has UTF-16: layer names and
//                  sheet titles, viewport names, a dimension's leader and trailer, field names in
//                  record formats, the name table, the font list
//   line types     keep their dashes in the drawing's dash table (30), not in themselves
//   identical      lines, loci, classes, line markers, aux records, the palette, preview images
//
// Types the drawing doesn't hold (rounded rectangles, symbols, sweeps, lights) are taken as 2018+'s
// without the slot only at the size 2013 and 2016 files give them, which the measured types kept.

import type { BodyConversion } from "./legacy.ts";
import { encodeUtf16, setU16, setU32, u16 } from "./bytes.ts";
import { docBody, macRoman, nameTableBody } from "./legacyDoc.ts";

/** where 2018+ has the u32 material slot in a drawn object's body (record +0x88) */
const SLOT_AT = 0x38;
const SLOT = 4;

/** `body` with `count` zero bytes put in at `at`. */
function withZeros(body: Uint8Array, at: number, count: number): Uint8Array {
  const out = new Uint8Array(body.length + count);
  out.set(body.subarray(0, at), 0);
  out.set(body.subarray(at), at + count);
  return out;
}

/** A drawn object's body with the 2018+ material slot (empty) put in. */
function withSlot(body: Uint8Array): Uint8Array | null {
  return body.length >= SLOT_AT ? withZeros(body, SLOT_AT, SLOT) : null;
}

/** The text in an 8-bit slot at `at`: a length byte, then that many characters (at most `max`). */
function slotText(body: Uint8Array, at: number, max: number): string {
  const n = Math.min(body[at], max);
  return macRoman(body.subarray(at + 1, at + 1 + n));
}

/** Writes `s` as UTF-16 at `at`, in a slot of `slot` bytes (cut to fit, zero-ended). */
function putSlot(out: Uint8Array, at: number, slot: number, s: string): void {
  const bytes = encodeUtf16(s);
  out.set(bytes.subarray(0, Math.min(bytes.length, slot - 2)), at);
}

/** Types whose 2017 bodies are 2018+'s as they are (every pair identical). */
const SAME = new Set([2, 9, 17, 27, 28, 33, 44, 70, 76, 79, 80, 91, 94, 100, 112, 119, 123, 124, 125]);
/** Types whose 2017 bodies are 2018+'s without the material slot (every pair identical once it is put in). */
const SLOTTED = new Set([3, 5, 6, 10, 11, 21, 24, 40, 54, 57, 65, 78, 84, 92, 111]);
/** Types the measured drawing doesn't hold, taken as slotted at the one size 2013 and 2016 files give them. */
const SLOTTED_AT: Readonly<Record<number, number>> = { 13: 120, 15: 196, 34: 272, 81: 316 };
/**
 * Types left out with what they hold: record data (48), whose values are laid out differently;
 * slab components (69) and the style lists (102, 107, 127), which differ in ways not worked out;
 * profile caches (42); the dash table (30, read into the line types: see lineTypeBodies) and a
 * type 2018+ doesn't have (128); a line type (96) the dash table doesn't name; and images,
 * worksheets, multiple extrudes and textures (14, 18, 38, 97), which the drawing doesn't hold.
 */
const LEFT_OUT = new Set([14, 18, 30, 38, 42, 48, 69, 96, 97, 102, 107, 127, 128]);

// ---- layers (31) ---------------------------------------------------------------------------------

const LAYER_SIZE = 742;
/** the name's slot (a length byte at +0x7c, after four zero bytes) and the sheet title's, to the end */
const LAYER_NAME_GAP = 0x78;
const LAYER_NAME = 0x7c;
const LAYER_AFTER_NAME = 0xb0;
const LAYER_TITLE = 0x266;
/** where the 2018+ layer's strings start in its body (record +0x292) */
const LAYER_STRINGS = 0x242;

/**
 * A layer: the 2018+ fixed part with the name's 52-byte slot in the middle of it (after the 3D
 * box) and no material slot, then the sheet title's 128-byte slot. 2018+ has the name and title
 * after the fixed part, as UTF-16 with their lengths, and 16 zero bytes before them.
 */
function layerBody(body: Uint8Array): Uint8Array {
  if (body.length !== LAYER_SIZE) throw new Error(`its layers are ${body.length}-byte records, not the ${LAYER_SIZE} Rodeo reads`);
  const name = encodeUtf16(slotText(body, LAYER_NAME, LAYER_AFTER_NAME - LAYER_NAME - 1));
  const title = encodeUtf16(slotText(body, LAYER_TITLE, body.length - LAYER_TITLE - 1));
  const out = new Uint8Array(LAYER_STRINGS + 4 + name.length + 4 + title.length + 4);
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, LAYER_NAME_GAP), SLOT_AT + SLOT);
  out.set(body.subarray(LAYER_AFTER_NAME, LAYER_TITLE), LAYER_NAME_GAP + SLOT);
  setU32(out, LAYER_STRINGS, name.length);
  out.set(name, LAYER_STRINGS + 4);
  setU32(out, LAYER_STRINGS + 4 + name.length, title.length);
  out.set(title, LAYER_STRINGS + 8 + name.length);
  return out;
}

// ---- record formats (47) -------------------------------------------------------------------------
// (the name table, 55, and the font list, 74, are 2013's: legacyDoc.ts)

/**
 * a record format's 16-byte head is 2018+'s; its fields are 70 bytes (u16 type, u16 value offset,
 * u16 number format, a length byte, 63 characters) where 2018+ has 136 (the number format at +6,
 * the name as UTF-16 from +8). The value offsets are kept as they are: they count into the record
 * data (48), which is laid out differently in 2018+ (its offsets are others) and is not read.
 */
const FORMAT_HEAD = 16;
const FIELD_HERE = 70;
const FIELD_NEW = 136;

function formatBody(body: Uint8Array): Uint8Array | null {
  if (body.length < FORMAT_HEAD) return null;
  const n = Math.min(u16(body, 0), Math.floor((body.length - FORMAT_HEAD) / FIELD_HERE));
  const out = new Uint8Array(FORMAT_HEAD + FIELD_NEW * n);
  out.set(body.subarray(0, FORMAT_HEAD), 0);
  setU16(out, 0, n);
  for (let i = 0; i < n; i++) {
    const src = FORMAT_HEAD + FIELD_HERE * i;
    const dst = FORMAT_HEAD + FIELD_NEW * i;
    out.set(body.subarray(src, src + 4), dst);
    out.set(body.subarray(src + 4, src + 6), dst + 6);
    putSlot(out, dst + 8, FIELD_NEW - 8, slotText(body, src + 6, 63));
  }
  return out;
}

// ---- symbol definitions (16), plug-in objects (86) -----------------------------------------------

/** the four bytes 2021 files have that these don't: at the end of a symbol definition, before the last four bytes of a plug-in object */
const LATER_FIELD = [1, 0, 1, 0];
const SYMBOL_DEF_SIZE = 258;
const PLUGIN_SIZE = 272;

function symbolDefinitionBody(body: Uint8Array): Uint8Array | null {
  const slotted = withSlot(body);
  if (!slotted || body.length !== SYMBOL_DEF_SIZE) return slotted;
  const out = new Uint8Array(slotted.length + 4);
  out.set(slotted, 0);
  out.set(LATER_FIELD, slotted.length);
  return out;
}

function pluginBody(body: Uint8Array): Uint8Array | null {
  const slotted = withSlot(body);
  if (!slotted || body.length !== PLUGIN_SIZE) return slotted;
  const out = withZeros(slotted, slotted.length - 4, 4);
  out.set(LATER_FIELD, slotted.length - 4);
  return out;
}

// ---- viewports (122), dimensions (63) ------------------------------------------------------------

/** a viewport's two 64-byte text slots (its name and one more), which 2018+ has as 128-byte UTF-16 slots */
const VIEW_SLOTS = 0xdc;
const VIEW_SLOT = 64;

function viewportBody(body: Uint8Array): Uint8Array | null {
  if (body.length < VIEW_SLOTS + 2 * VIEW_SLOT) return null;
  const out = new Uint8Array(body.length + SLOT + 2 * VIEW_SLOT);
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, VIEW_SLOTS), SLOT_AT + SLOT);
  for (let k = 0; k < 2; k++) putSlot(out, VIEW_SLOTS + SLOT + 2 * VIEW_SLOT * k, 2 * VIEW_SLOT, slotText(body, VIEW_SLOTS + VIEW_SLOT * k, VIEW_SLOT - 1));
  out.set(body.subarray(VIEW_SLOTS + 2 * VIEW_SLOT), VIEW_SLOTS + SLOT + 4 * VIEW_SLOT);
  return out;
}

const DIM_SIZE = 524;
const DIM_NEW = 768;

/**
 * A dimension of the one size measured: its fields to +0xe6 behind the material slot; its leader
 * and trailer (length bytes at +0xe6 and +0x126, "[" and "]" in all 18) as UTF-16 at 2018+'s
 * +0x10a and +0x18a; the 24 bytes from +0x166 at +0x1fa; and the rest from +0x1be at +0x292. The
 * 64 bytes between (+0x17e) are zero in all 18 and 128 in 2018+: taken as a third text. One of
 * another size keeps only its attributes and plan box, as a 2013 one does (its lines and text are
 * its children).
 */
function dimensionBody(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(DIM_NEW);
  if (body.length !== DIM_SIZE) {
    out.set(body.subarray(0, Math.min(body.length, SLOT_AT)), 0);
    return out;
  }
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, 0xe6), SLOT_AT + SLOT);
  putSlot(out, 0x10a, 128, slotText(body, 0xe6, 63));
  putSlot(out, 0x18a, 112, slotText(body, 0x126, 63));
  out.set(body.subarray(0x166, 0x17e), 0x1fa);
  putSlot(out, 0x212, 128, slotText(body, 0x17e, 63));
  out.set(body.subarray(0x1be), 0x292);
  return out;
}

// ---- meshes' faces (41), 3D bodies (114) ---------------------------------------------------------

/** where a mesh face's vertex numbers start (its u16 count is at +0x3a here, and just before the numbers in 2018+) */
const FACE_VERTICES = 0x78;

function meshFaceBody(body: Uint8Array): Uint8Array | null {
  if (body.length < FACE_VERTICES) return null;
  const out = new Uint8Array(body.length + 6);
  out.set(body.subarray(0, SLOT_AT), 0);
  out.set(body.subarray(SLOT_AT, SLOT_AT + 2), SLOT_AT + SLOT);
  out.set(body.subarray(SLOT_AT + 4, FACE_VERTICES), SLOT_AT + SLOT + 4);
  out.set(body.subarray(SLOT_AT + 2, SLOT_AT + 4), FACE_VERTICES + SLOT);
  out.set(body.subarray(FACE_VERTICES), FACE_VERTICES + SLOT + 2);
  return out;
}

/** a slab of the one size measured (one slab): 2018+'s without the material slot and its last two bytes, which are zero there */
const SLAB_SIZE = 184;

function slabBody(body: Uint8Array): Uint8Array | null {
  const slotted = body.length === SLAB_SIZE ? withSlot(body) : null;
  return slotted && withZeros(slotted, slotted.length, 2);
}

/** a 3D body is 2018+'s after its first ten bytes, which these files don't have (nothing Rodeo reads is in them) */
const BODY_HEAD = 10;

// ---- line types (96) and the dash table (30) -----------------------------------------------------

/** the dash table: a u16 count, then 324-byte entries: 90 bytes of dashes (2018+ keeps them in the line type), and the name's slot at +260 */
const DASH_ENTRY = 324;
const DASH_DATA = 90;
const DASH_NAME = 260;
/** a line type here: 16 bytes and a last u16; 2018+ has the dashes between them, and 166 bytes after */
const LINE_TYPE_SIZE = 18;
const LINE_TYPE_NEW = 274;

/** One record of a drawing before 2018, as lineTypeBodies needs it. */
export interface OlderRecord {
  readonly type: number;
  /** the header's name index */
  readonly name: number;
  readonly body: Uint8Array;
}

/**
 * The 2018+ bodies of a drawing's line types, by their records. Before 2018 a line type (96)
 * is 18 bytes and its dashes are in the drawing's dash table (30), in the entry of the line
 * type's name; 2018+ keeps the dashes in the line type. Measured on a 2017-format file (one line
 * type: the body made here is the 2021 file's, byte for byte) and a 2016 file (one line type, of
 * the same 18 bytes, and its entry of the same name). A line type the table doesn't name gets no
 * body, and is left out.
 */
export function lineTypeBodies(recs: Iterable<OlderRecord>, names: ReadonlyMap<number, string>): Map<OlderRecord, Uint8Array> {
  const dashes = new Map<string, Uint8Array>();
  const types: OlderRecord[] = [];
  for (const r of recs) {
    if (r.type === 96 && r.body.length === LINE_TYPE_SIZE) types.push(r);
    if (r.type !== 30 || r.body.length < 2) continue;
    const n = Math.min(u16(r.body, 0), Math.floor((r.body.length - 2) / DASH_ENTRY));
    for (let k = 0; k < n; k++) {
      const at = 2 + DASH_ENTRY * k;
      dashes.set(slotText(r.body, at + DASH_NAME, DASH_ENTRY - DASH_NAME - 1), r.body.subarray(at, at + DASH_DATA));
    }
  }
  const out = new Map<OlderRecord, Uint8Array>();
  for (const r of types) {
    const dash = dashes.get(names.get(r.name) ?? "");
    if (!dash) continue;
    const made = new Uint8Array(LINE_TYPE_NEW);
    made.set(r.body.subarray(0, 16), 0);
    made.set(dash, 16);
    made.set(r.body.subarray(16), 16 + DASH_DATA);
    out.set(r, made);
  }
  return out;
}

// ---- the dispatcher ------------------------------------------------------------------------------

/**
 * The 2018+ body (from +0x50) for a 2017 record of type `type` whose body (from its +0x48) is
 * `body`: null to leave the record out with what it holds, undefined when the type isn't one read
 * here. A layer of a size never measured throws, which refuses the file.
 */
export function lateBody(type: number, body: Uint8Array): BodyConversion {
  if (SAME.has(type)) return body;
  if (SLOTTED.has(type)) return withSlot(body);
  if (type in SLOTTED_AT) return body.length === SLOTTED_AT[type] ? withSlot(body) : null;
  if (LEFT_OUT.has(type)) return null;
  switch (type) {
    case 31:
      return layerBody(body);
    case 55:
      return nameTableBody(body);
    case 47:
      return formatBody(body);
    case 74:
      // 262-byte entries, as 2013's: the fonts of the 2021 file are the three made so
      return docBody(74, body);
    case 16:
      return symbolDefinitionBody(body);
    case 86:
      return pluginBody(body);
    case 122:
      return viewportBody(body);
    case 63:
      return dimensionBody(body);
    case 41:
      return meshFaceBody(body);
    case 114:
      return withZeros(body, 0, BODY_HEAD);
    case 71:
      return slabBody(body);
    default:
      return undefined;
  }
}
