// Bodies of the records Vectorworks wrote between 2013 and 2018 (measured on three files saved by
// Vectorworks 2016, FORMAT.md §1.2) as Vectorworks 2013 bodies, which legacyDoc.ts and
// legacyShapes.ts then make 2018+ ones. legacy.ts calls midBody for every such record but terminators.
//
// These bodies are the 2013 bodies with their pointers grown from 32 to 64 bits:
//
//   containers      the two pointers at body +0x38 (first and last of what the record holds) are
//                   8 bytes each where 2013 has 4, so everything after them sits 8 bytes later.
//                   Measured: layers (31, 732 bytes where 2013 has 724), groups (11, 120 for 112),
//                   plug-in objects (86, 268 for 260), symbol definitions (16, 258 for 250) and the
//                   lists 54 and 57 (72 for 64).
//   classes (94)    76 bytes where 2013 has 72, the same up to +0x29 in all seven classes of the
//                   three files; none of them is hidden or grey, so where the four more bytes sit
//                   before the end is not known (see classBody).
//   everything else the same size and layout as 2013: lines (2), polygons (5), loci (9, 17),
//                   symbols (15), polylines (21), lights (81), the name table (55), the font
//                   list (74), record formats (47), the palette (80).
//
// Extrudes (24) and sweeps (34) are containers too, and with their pointers grown they are the
// 2018+ records less the material slot, so they come in as 3D (midDirect); the 2013 converters
// leave them out. The other 3D types stay left out.
//
// No 2014 to 2017 file seen holds a rectangle, oval, arc, rounded rectangle, text, dimension or
// viewport. Those are taken as 2013's only where the record itself says the layout fits (its size
// for the fixed-size shapes, its characters for a text, its layer and class list for a viewport)
// and are left out otherwise, so none is drawn from a layout that was never measured.

import { i16, setI16, u16 } from "./bytes.ts";

/** where a container's two child pointers start in its body (2013 and here), and their size in each */
const PAIR_AT = 0x38;
const PAIR_2013 = 8;
const PAIR_HERE = 16;

/** body sizes of the records whose 2013 layout is fixed-size */
const LAYER_2013 = 724;
const CLASS_2013 = 72;
const CLASS_HERE = 76;
/** rectangle, oval, arc and rounded rectangle bodies in 2013 */
const FIXED_2013: Readonly<Record<number, number>> = { 3: 104, 4: 104, 6: 126, 13: 120 };

/** A container's body with its two 64-bit child pointers as 2013's two 32-bit ones (their low halves; nothing reads them). */
function narrowPair(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length - (PAIR_HERE - PAIR_2013));
  out.set(body.subarray(0, PAIR_AT), 0);
  out.set(body.subarray(PAIR_AT, PAIR_AT + 4), PAIR_AT);
  out.set(body.subarray(PAIR_AT + 8, PAIR_AT + 12), PAIR_AT + 4);
  out.set(body.subarray(PAIR_AT + PAIR_HERE), PAIR_AT + PAIR_2013);
  return out;
}

/**
 * A layer: 2013's 724 bytes with the pointers grown. A layer of any other size is a layout not
 * measured, and its name, kind and scale would be read from the wrong places, so it is refused.
 */
function layerBody(body: Uint8Array): Uint8Array {
  if (body.length !== LAYER_2013 + PAIR_HERE - PAIR_2013) {
    throw new Error(`its layers are ${body.length}-byte records, not the ${LAYER_2013 + PAIR_HERE - PAIR_2013} Rodeo reads`);
  }
  return narrowPair(body);
}

/** where 2013 keeps a class's visibility (i16: 0 visible, -1 hidden, 2 grey), and the other place it can be here */
const CLASS_VIS_2013 = 0x46;
const CLASS_VIS_LATER = 0x4a;

/**
 * A class: 2013's 72 bytes and four more. The colours, line style, weight, fill, opacities and
 * markers (to +0x2c) are where 2013 has them. The visibility is 2013's last two bytes (+0x46);
 * here it is either still there, with the four new bytes after it, or four bytes on (+0x4a), with
 * them before it. Both places are zero in every class measured, and under either reading the other
 * place stays zero (2013's bytes before the visibility are zero in all 35 classes of the 2013
 * file), so the visibility is whichever of the two holds a hidden or grey value.
 */
function classBody(body: Uint8Array): Uint8Array {
  if (body.length !== CLASS_HERE) throw new Error(`its classes are ${body.length}-byte records, not the ${CLASS_HERE} Rodeo reads`);
  const out = body.slice(0, CLASS_2013);
  const known = (v: number) => v === -1 || v === 2;
  const here = i16(body, CLASS_VIS_2013);
  const later = i16(body, CLASS_VIS_LATER);
  setI16(out, CLASS_VIS_2013, known(here) ? here : known(later) ? later : 0);
  return out;
}

/** where a 2013 text keeps its character count, and where its fixed part ends at the least */
const TEXT_COUNT = 0xca - 0x28;
const TEXT_FIXED = 0xb4;

/**
 * A text, when it reads as 2013's: its count is at least one, and its last 2 × count bytes are
 * UTF-16 characters (printable, or a tab or line break), as 2013 texts end. Null otherwise.
 */
function textBody(body: Uint8Array): Uint8Array | null {
  if (body.length < TEXT_FIXED) return null;
  const n = u16(body, TEXT_COUNT);
  if (n < 1 || TEXT_FIXED + 2 * n > body.length) return null;
  for (let i = 0; i < n; i++) {
    const c = u16(body, body.length - 2 * n + 2 * i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return null;
    if (c === 0x7f || c === 0xffff || c === 0xfffe) return null;
  }
  return body;
}

/** where a 2013 viewport's layer and class list starts in its body (record +0x28c): u16 0, u16 layers, u16 classes, 8 bytes each */
const VIEW_LIST_2013 = 0x28c - 0x28;

/**
 * A viewport, when it reads as 2013's with the pointers grown: the layer and class list is then
 * at 2013's place and runs exactly to the record's end. Null otherwise.
 */
function viewportBody(body: Uint8Array): Uint8Array | null {
  if (body.length < PAIR_AT + PAIR_HERE) return null;
  const made = narrowPair(body);
  const at = VIEW_LIST_2013;
  if (at + 6 > made.length || u16(made, at) !== 0) return null;
  return at + 6 + 8 * (u16(made, at + 2) + u16(made, at + 4)) === made.length ? made : null;
}

/**
 * The 2013 body (legacyDoc.ts and legacyShapes.ts read it) for a 2014 to 2017 record of type
 * `type` whose body (from its +0x38) is `body`; null to leave the record out, with what it holds.
 * A layer or class of a size never measured throws, which refuses the file.
 */
export function midBody(type: number, body: Uint8Array): Uint8Array | null {
  switch (type) {
    case 31:
      return layerBody(body);
    case 94:
      return classBody(body);
    case 11: // group
    case 86: // plug-in object
      return body.length >= PAIR_AT + PAIR_HERE ? narrowPair(body) : null;
    case 3: // rectangle
    case 4: // oval
    case 6: // arc
    case 13: // rounded rectangle
      return body.length === FIXED_2013[type] ? body : null;
    case 10:
      return textBody(body);
    case 122:
      return viewportBody(body);
    default:
      // the same as 2013 (lines, polygons, polylines, loci, symbols, lights, the name table, fonts,
      // record formats, the palette), or read no further than the plan box at +0x18 (symbol
      // definitions, dimensions), or not read at all
      return body;
  }
}

/** extrude and sweep bodies here: 2013's 232 and 264 bytes with the pointers grown, and 4 bytes short of 2018+'s 244 and 276 */
const SOLID_HERE: Readonly<Record<number, number>> = { 24: 240, 34: 272 };

/**
 * The 2018+ body for the types read here that the 2013 converters leave out: an extrude (24) or a
 * sweep (34) of the measured size is the 2018+ body without its u32 material slot (2018+ record
 * +0x88, body +0x38, before the two child pointers), so the slot is put in, empty. Checked on the
 * three extrudes and the sweep of a 2016 file: each then builds a solid the size of the 3D box its
 * record stores (to 0.01 mm on the three that aren't turned in their symbol).
 * Undefined for every other type and size, which go the 2013 way (midBody).
 */
export function midDirect(type: number, body: Uint8Array): Uint8Array | undefined {
  if (body.length !== SOLID_HERE[type]) return undefined;
  const out = new Uint8Array(body.length + 4);
  out.set(body.subarray(0, PAIR_AT), 0);
  out.set(body.subarray(PAIR_AT), PAIR_AT + 4);
  return out;
}
