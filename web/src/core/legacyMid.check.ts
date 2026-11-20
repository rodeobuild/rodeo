// Checks legacyMid.ts on synthetic Vectorworks 2014 to 2017 bodies made here (no client data): a
// 2013 body with its two child pointers grown to 64 bits must come back as that 2013 body, and then
// read through legacyDoc.ts and legacyShapes.ts and Rodeo's own 2018+ readers as the 2013 fields
// say. Covers layers, classes (the visibility in either place it can be), groups, plug-in objects,
// the shapes taken only at their 2013 sizes, texts, viewports, the types that pass as they are, and
// extrudes and sweeps (which get the 2018+ material slot). Run from web/:
//   npx tsx src/core/legacyMid.check.ts

import { f64, setF64, setI16, setU16, setU32, setU64 } from "./bytes.ts";
import { docBody } from "./legacyDoc.ts";
import { midBody, midDirect } from "./legacyMid.ts";
import { shapeBody } from "./legacyShapes.ts";
import { readClassAttrs } from "./attrs.ts";
import { viewportLists } from "./geometry.ts";
import { CLASS_VIS, LAYER_SCALE, LAYER_VIS, layerKindAt, layerNameAt, readStr } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** A 2013 body of `size` bytes filled with a pattern, so a byte out of place shows. */
function patterned(size: number): Uint8Array {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 7 + 3) & 0xff;
  return b;
}

/** A 2013 container body as 2014 to 2017 wrote it: its two u32 child pointers (body +0x38) as u64s with `high` in their high halves. */
function grown(b13: Uint8Array, high = 0x7fa9): Uint8Array {
  const out = new Uint8Array(b13.length + 8);
  out.set(b13.subarray(0, 0x38), 0);
  out.set(b13.subarray(0x38, 0x3c), 0x38);
  setU32(out, 0x3c, high);
  out.set(b13.subarray(0x3c, 0x40), 0x40);
  setU32(out, 0x44, high);
  out.set(b13.subarray(0x40), 0x48);
  return out;
}

/** A 2018+ body as the record it sits in (its header zeroed, which the readers here don't use). */
function record(body: Uint8Array): Uint8Array {
  const d = new Uint8Array(0x50 + body.length);
  setU64(d, 0, BigInt(d.length));
  d.set(body, 0x50);
  return d;
}

function thrown(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// 1. groups and plug-in objects: the grown pointers come back as 2013's, everything after them 8 bytes earlier
for (const [type, size, what] of [
  [11, 112, "group"],
  [86, 260, "plug-in object"],
] as const) {
  const b13 = patterned(size);
  const back = midBody(type, grown(b13));
  check(back !== null && same(back, b13), `a ${what} (${size + 8} bytes) comes back as its 2013 body (${size})`);
  check(midBody(type, new Uint8Array(0x40)) === null, `a ${what} too short to hold its pointers is left out`);
}
{
  // a group's 3D box (2013 body +0x40, here +0x48) ends at 2018+ +0x9c
  const b13 = new Uint8Array(112);
  for (let k = 0; k < 6; k++) setF64(b13, 0x40 + 8 * k, 10 + k);
  const made = record(shapeBody(11, midBody(11, grown(b13))!) as Uint8Array);
  check([0, 1, 2, 3, 4, 5].every((k) => f64(made, 0x9c + 8 * k) === 10 + k), "a group's 3D box reads back at 2018+ +0x9c");
}

// 2. layers: 732 bytes come back as 2013's 724 and read as a layer; another size is refused
{
  const b13 = new Uint8Array(724);
  const o = (x: number) => x - 0x28;
  setI16(b13, o(0xdc), -1);
  setF64(b13, o(0xfc), 48);
  b13[o(0x236)] = 1;
  const name = "Ground Floor";
  b13[o(0x9c)] = name.length;
  b13.set(new TextEncoder().encode(name), o(0x9d));
  const back = midBody(31, grown(b13));
  check(back !== null && same(back, b13), "a layer (732 bytes) comes back as its 2013 body (724)");
  const layer = record(docBody(31, back!) as Uint8Array);
  const dv = new DataView(layer.buffer, layer.byteOffset);
  const [nameBack] = readStr(layer, layerNameAt(layer));
  check(
    layer[layerKindAt(layer)] === 1 && nameBack === name && dv.getFloat64(LAYER_SCALE, true) === 48 && dv.getInt16(LAYER_VIS, true) === -1,
    `the layer reads back: design, "${nameBack}", 1:${dv.getFloat64(LAYER_SCALE, true)}, hidden`,
  );
  const refused = thrown(() => midBody(31, new Uint8Array(740)));
  check(refused === "its layers are 740-byte records, not the 732 Rodeo reads", `a layer of another size is refused: ${refused}`);
  check(thrown(() => midBody(31, new Uint8Array(724))) !== "", "a layer of 2013's own size is refused too (its pointers would be read as fields)");
}

// 3. classes: 76 bytes, 2013's fields where 2013 has them; the visibility in either place it can be
{
  const b16 = new Uint8Array(76);
  const o = (x: number) => x - 0x28;
  setU16(b16, o(0x2a), 300);
  setU16(b16, o(0x2e), 1252);
  setU32(b16, o(0x32), (-60) >>> 0);
  b16[o(0x36)] = 6;
  b16[o(0x3d)] = 80;
  const read = (b: Uint8Array) => {
    const d = record(docBody(94, midBody(94, b)!) as Uint8Array);
    return { attrs: readClassAttrs(d), vis: new DataView(d.buffer, d.byteOffset).getInt16(CLASS_VIS, true), size: d.length };
  };
  const plain = read(b16);
  check(plain.size === 0xbc && !!plain.attrs && plain.attrs.fillFore === 300 && plain.attrs.penFore === 1252 && plain.attrs.lineStyle === -60 && plain.attrs.lineWeight === 6 && plain.attrs.fillOpacity === 80, "a class's colours, line style, weight and opacity read back");
  check(plain.vis === 0, "a class with neither place set is visible");
  const here = b16.slice();
  setI16(here, 0x46, -1);
  check(read(here).vis === -1, "hidden at 2013's place (+0x46) reads hidden");
  const later = b16.slice();
  setI16(later, 0x4a, 2);
  check(read(later).vis === 2, "grey four bytes on (+0x4a) reads grey");
  const stray = b16.slice();
  setI16(stray, 0x4a, 7);
  check(read(stray).vis === 0, "a value that is no visibility is not taken for one");
  const refused = thrown(() => midBody(94, new Uint8Array(72)));
  check(refused === "its classes are 72-byte records, not the 76 Rodeo reads", `a class of another size is refused: ${refused}`);
}

// 4. rectangles, ovals, arcs and rounded rectangles: never measured in these years, so taken only at their 2013 sizes
for (const [type, size, what] of [
  [3, 104, "rectangle"],
  [4, 104, "oval"],
  [6, 126, "arc"],
  [13, 120, "rounded rectangle"],
] as const) {
  const b = patterned(size);
  check(midBody(type, b) === b, `a ${what} of 2013's size (${size}) passes as it is`);
  check(midBody(type, patterned(size + 8)) === null && midBody(type, patterned(size - 4)) === null, `a ${what} of another size is left out`);
}

// 5. texts: taken when the count and the characters at the end read as a 2013 text's
{
  const chars = "Stage\rLeft";
  const b = new Uint8Array(0xb4 + 40 + 2 * chars.length);
  setU16(b, 0xca - 0x28, chars.length);
  for (let i = 0; i < chars.length; i++) setU16(b, b.length - 2 * chars.length + 2 * i, chars.charCodeAt(i));
  check(midBody(10, b) === b, "a text whose count and characters read passes as it is");
  const none = b.slice();
  setU16(none, 0xca - 0x28, 0);
  check(midBody(10, none) === null, "a text with no characters is left out");
  const over = b.slice();
  setU16(over, 0xca - 0x28, 5000);
  check(midBody(10, over) === null, "a text whose count runs past its record is left out");
  const junk = b.slice();
  setU16(junk, junk.length - 4, 0x0003);
  check(midBody(10, junk) === null, "a text whose characters aren't text is left out");
  check(midBody(10, new Uint8Array(0x40)) === null, "a text shorter than its fixed part is left out");
}

// 6. viewports: taken when the layer and class list sits at 2013's place and ends the record, as they are or with two pointers narrowed
{
  const layers = 2, classes = 1;
  const b13 = new Uint8Array(0x28c - 0x28 + 6 + 8 * (layers + classes));
  const list = 0x28c - 0x28;
  setU16(b13, list + 2, layers);
  setU16(b13, list + 4, classes);
  [5, 6, 9].forEach((name, i) => setU16(b13, list + 6 + 8 * i, name));
  const back = midBody(122, grown(b13));
  check(back !== null && same(back, b13), "a viewport with its pointers grown comes back as its 2013 body");
  const lists = viewportLists(record(shapeBody(122, back!) as Uint8Array));
  check(!!lists && lists.layers.map((e) => e.name).join() === "5,6" && lists.classes.map((e) => e.name).join() === "9", "its layer and class list reads back (layers 5 and 6, class 9)");
  check(midBody(122, b13) === b13, "a viewport laid out as 2013's passes as it is");
  const moved = new Uint8Array(grown(b13).length + 8);
  moved.set(grown(b13), 0);
  check(midBody(122, moved) === null, "a viewport whose list doesn't end the record is left out");
}

// 7. the types 2013 and these years share pass as they are
for (const [type, what] of [
  [2, "line"],
  [5, "polygon"],
  [9, "2D locus"],
  [15, "symbol"],
  [16, "symbol definition"],
  [17, "3D locus"],
  [21, "polyline"],
  [47, "record format"],
  [55, "name table"],
  [63, "dimension"],
  [74, "font list"],
  [76, "aux record"],
  [80, "palette"],
  [81, "light"],
] as const) {
  const b = patterned(200);
  check(midBody(type, b) === b, `a ${what} (${type}) passes as it is`);
}

// 8. extrudes and sweeps: the 2018+ material slot goes in at +0x38, so the 3D box (here +0x48) ends at 2018+ +0x9c
for (const [type, size, what] of [
  [24, 240, "extrude"],
  [34, 272, "sweep"],
] as const) {
  const b = patterned(size);
  for (let k = 0; k < 6; k++) setF64(b, 0x48 + 8 * k, 100 + k);
  const made = midDirect(type, b);
  check(made !== undefined && made.length === size + 4, `an ${what} of the measured size (${size}) gets 4 bytes more (${made?.length})`);
  if (made) {
    const d = record(made);
    check(same(made.subarray(0, 0x38), b.subarray(0, 0x38)) && made.subarray(0x38, 0x3c).every((v) => v === 0) && same(made.subarray(0x3c), b.subarray(0x38)), `the ${what}'s material slot is empty and the rest follows it`);
    check([0, 1, 2, 3, 4, 5].every((k) => f64(d, 0x9c + 8 * k) === 100 + k), `the ${what}'s 3D box reads back at 2018+ +0x9c`);
  }
  check(midDirect(type, patterned(size - 8)) === undefined && midDirect(type, patterned(size + 4)) === undefined, `an ${what} of another size is not converted here`);
  check(shapeBody(type, midBody(type, patterned(size - 8))!) === null, `and is then left out, as 2013's are`);
}
check(midDirect(2, patterned(240)) === undefined && midDirect(38, patterned(240)) === undefined, "no other type is converted here, whatever its size");

console.log(failures ? `\n${failures} failed` : "\nall legacyMid checks pass");
process.exit(failures ? 1 : 0);
