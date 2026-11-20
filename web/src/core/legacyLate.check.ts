// Checks legacyLate.ts on synthetic Vectorworks 2017-format bodies made here (no client data): each
// converted type's fields are written where the 2017 format has them and must come out where
// 2018+ has them, read through Rodeo's own 2018+ readers where there is one. Covers the types kept
// as they are, the ones that gain the material slot, the ones taken only at a known size, layers,
// record formats, the font list, symbol definitions, plug-in objects, viewports, dimensions, mesh
// faces, 3D bodies, slabs, line types and the dash table, and what is left out. Run from web/:
//   npx tsx src/core/legacyLate.check.ts

import { f64, readUtf16, setF64, setI16, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import { lateBody, lineTypeBodies, type OlderRecord } from "./legacyLate.ts";
import { readFontList } from "./fonts.ts";
import { viewportLists } from "./geometry.ts";
import { LAYER_SCALE, LAYER_VIS, layerKindAt, layerNameAt, readStr } from "./model.ts";

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

/** A 2018+ body as the record it sits in (its header zeroed, which the readers here don't use). */
function record(body: Uint8Array): Uint8Array {
  const d = new Uint8Array(0x50 + body.length);
  setU64(d, 0, BigInt(d.length));
  d.set(body, 0x50);
  return d;
}

/** Writes `s` at `at` as a length byte and 8-bit characters. */
function putText(b: Uint8Array, at: number, s: string): void {
  b[at] = s.length;
  for (let i = 0; i < s.length; i++) b[at + 1 + i] = s.charCodeAt(i);
}

/** The zero-ended UTF-16 text at `at`. */
function utf16At(b: Uint8Array, at: number): string {
  let n = 0;
  while (at + 2 * n + 1 < b.length && u16(b, at + 2 * n) !== 0) n++;
  return readUtf16(b, at, 2 * n);
}

const made = (type: number, body: Uint8Array): Uint8Array => {
  const out = lateBody(type, body);
  if (!out) throw new Error(`type ${type} was not converted`);
  return out;
};

function thrown(run: () => unknown): string {
  try {
    run();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

// 1. types whose bodies are 2018+'s as they are
for (const type of [2, 9, 17, 76, 80, 94, 112, 119, 125]) {
  const b = patterned(90);
  check(lateBody(type, b) === b, `type ${type} passes as it is`);
}

// 2. types that gain the material slot at +0x38: everything after it sits 4 bytes later
for (const [type, what] of [
  [3, "rectangle"],
  [5, "polygon"],
  [6, "arc"],
  [10, "text"],
  [11, "group"],
  [21, "polyline"],
  [24, "extrude"],
  [40, "mesh"],
  [84, "solid"],
] as const) {
  const b = patterned(150);
  const out = made(type, b);
  check(
    out.length === 154 && same(out.subarray(0, 0x38), b.subarray(0, 0x38)) && out.subarray(0x38, 0x3c).every((v) => v === 0) && same(out.subarray(0x3c), b.subarray(0x38)),
    `a ${what} (${type}) gains an empty slot at +0x38`,
  );
}
{
  // a rectangle's origin (here +0x38 of the body, 2018+ record +0x8c) and a group's 3D box (after its two pointers, 2018+ record +0x9c)
  const rect = new Uint8Array(104);
  setF64(rect, 0x38, 12.5);
  check(f64(record(made(3, rect)), 0x8c) === 12.5, "a rectangle's first field after the slot reads back at 2018+ +0x8c");
  const group = new Uint8Array(120);
  for (let k = 0; k < 6; k++) setF64(group, 0x48 + 8 * k, 20 + k);
  check([0, 1, 2, 3, 4, 5].every((k) => f64(record(made(11, group)), 0x9c + 8 * k) === 20 + k), "a group's 3D box reads back at 2018+ +0x9c");
  check(lateBody(3, new Uint8Array(0x30)) === null, "a drawn object too short to hold its plan box is left out");
}

// 3. types the measured drawing doesn't hold: slotted at the one size known, left out at any other
for (const [type, size, what] of [
  [13, 120, "rounded rectangle"],
  [15, 196, "symbol"],
  [34, 272, "sweep"],
  [81, 316, "light"],
] as const) {
  check(lateBody(type, patterned(size))?.length === size + 4, `a ${what} of ${size} bytes gains the slot`);
  check(lateBody(type, patterned(size + 4)) === null && lateBody(type, patterned(size - 8)) === null, `a ${what} of another size is left out`);
}

// 4. layers: the name's slot comes out of the middle, the name and title go to the end as UTF-16
{
  const b = new Uint8Array(742);
  setF64(b, 0x48, 7.25); // the 3D box's first f64, before the name's slot
  putText(b, 0x7c, "Stage Plan");
  setI16(b, 0xbc, -1); // visibility (2018+ record +0xd8)
  setF64(b, 0xdc, 48); // scale (2018+ record +0xf8)
  b[0x220] = 2; // kind: a sheet (2018+ record +0x23c)
  putText(b, 0x266, "Ground Plan");
  const layer = record(made(31, b));
  const dv = new DataView(layer.buffer, layer.byteOffset);
  const [name, next] = readStr(layer, layerNameAt(layer));
  const [title] = readStr(layer, next);
  check(layer[layerKindAt(layer)] === 2 && name === "Stage Plan" && title === "Ground Plan", `a sheet layer's kind, name and title read back (${layer[layerKindAt(layer)]}, "${name}", "${title}")`);
  check(dv.getInt16(LAYER_VIS, true) === -1 && dv.getFloat64(LAYER_SCALE, true) === 48, "its visibility and scale read back");
  check(f64(layer, 0x50 + 0x4c) === 7.25, "the 3D box before the name's slot moves by the material slot only");
  check(layer.length === 0x50 + 0x242 + 4 + 20 + 4 + 22 + 4, `the record is the fixed part, the two strings and a trailer (${layer.length})`);
  const refused = thrown(() => lateBody(31, new Uint8Array(732)));
  check(refused === "its layers are 732-byte records, not the 742 Rodeo reads", `a layer of another size is refused: ${refused}`);
}

// 5. record formats: the 16-byte head as it is, 70-byte fields as 136-byte ones with UTF-16 names
{
  const b = new Uint8Array(16 + 70 * 2);
  setU16(b, 0, 2);
  setU32(b, 4, 0x61589f60);
  for (const [i, type, offset, format, name] of [
    [0, 2, 0, 0, "Width"],
    [1, 4, 8, 3, "Label"],
  ] as const) {
    const at = 16 + 70 * i;
    setU16(b, at, type);
    setU16(b, at + 2, offset);
    setU16(b, at + 4, format);
    putText(b, at + 6, name);
  }
  const out = made(47, b);
  check(out.length === 16 + 136 * 2 && same(out.subarray(0, 16), b.subarray(0, 16)), "a format of two fields is its head and two 136-byte fields");
  check(
    u16(out, 16) === 2 && u16(out, 16 + 136) === 4 && u16(out, 16 + 136 + 2) === 8 && u16(out, 16 + 136 + 4) === 0 && u16(out, 16 + 136 + 6) === 3 && utf16At(out, 16 + 8) === "Width" && utf16At(out, 16 + 136 + 8) === "Label",
    "each field's type, offset, number format (at 2018+'s +6) and name read back",
  );
  const cut = new Uint8Array(16 + 70);
  setU16(cut, 0, 5);
  check(made(47, cut).length === 16 + 136 && u16(made(47, cut), 0) === 1, "a format counting more fields than it holds keeps those it holds");
}

// 6. the font list: 262-byte entries as 518-byte ones
{
  const b = new Uint8Array(2 + 262 * 2);
  setU16(b, 0, 2);
  setU16(b, 2 + 2, 42);
  putText(b, 2 + 4, "Arial");
  setU16(b, 2 + 262 + 2, 7);
  putText(b, 2 + 262 + 4, "Gill Sans");
  const fonts = readFontList(record(made(74, b)));
  check(made(74, b).length === 2 + 518 * 2 && JSON.stringify(fonts).includes("Arial") && JSON.stringify(fonts).includes("Gill Sans"), `two fonts read back (${JSON.stringify(fonts).slice(0, 80)})`);
}

// 7. symbol definitions and plug-in objects: the slot, and the four bytes later files have
{
  const def = patterned(258);
  const out = made(16, def);
  check(out.length === 266 && same(out.subarray(0x3c, 262), def.subarray(0x38)) && same(out.subarray(262), new Uint8Array([1, 0, 1, 0])), "a symbol definition gains the slot and 01 00 01 00 at its end");
  const plug = patterned(272);
  const p = made(86, plug);
  check(
    p.length === 280 && same(p.subarray(0x3c, 0x110), plug.subarray(0x38, 0x10c)) && same(p.subarray(0x110, 0x114), new Uint8Array([1, 0, 1, 0])) && same(p.subarray(0x114), plug.subarray(0x10c)),
    "a plug-in object gains the slot and 01 00 01 00 before its last four bytes",
  );
  check(made(86, patterned(300)).length === 304 && made(16, patterned(240)).length === 244, "of another size, each gains the slot alone");
}

// 8. viewports: the slot, the two text slots as UTF-16, and the layer and class list still ending the record
{
  // the list starts at +0x264 here (as in 2013), which is 2018+'s record +0x338
  const layers = 2, classes = 1;
  const b = new Uint8Array(0x264 + 6 + 8 * (layers + classes));
  putText(b, 0xdc, "Plan Viewport");
  putText(b, 0x11c, "A");
  setF64(b, 0x15c, 96); // the first field after the text slots
  const list = b.length - 6 - 8 * (layers + classes);
  setU16(b, list + 2, layers);
  setU16(b, list + 4, classes);
  [5, 6, 9].forEach((name, i) => setU16(b, list + 6 + 8 * i, name));
  const out = made(122, b);
  check(out.length === b.length + 4 + 128, `a viewport is 132 bytes longer (${out.length - b.length})`);
  check(utf16At(out, 0xe0) === "Plan Viewport" && utf16At(out, 0x160) === "A", `its two names read back as UTF-16 ("${utf16At(out, 0xe0)}", "${utf16At(out, 0x160)}")`);
  check(f64(out, 0x1e0) === 96, "the field after the names follows them");
  const lists = viewportLists(record(out));
  check(!!lists && lists.layers.map((e) => e.name).join() === "5,6" && lists.classes.map((e) => e.name).join() === "9", "its layer and class list reads back (layers 5 and 6, class 9)");
  check(lateBody(122, new Uint8Array(0x100)) === null, "a viewport too short to hold its names is left out");
}

// 9. dimensions: 524 bytes as 768, the leader and trailer as UTF-16
{
  const b = new Uint8Array(524);
  setF64(b, 0x40, 3.5);
  putText(b, 0xe6, "[");
  putText(b, 0x126, "] typ.");
  b.set([1, 0, 0x80, 0, 0x80], 0x166);
  setF64(b, 0x1be, 1300.5);
  const out = made(63, b);
  check(out.length === 768 && f64(out, 0x44) === 3.5, "a dimension is 768 bytes and its fields follow the slot");
  check(utf16At(out, 0x10a) === "[" && utf16At(out, 0x18a) === "] typ.", `its leader and trailer read back ("${utf16At(out, 0x10a)}", "${utf16At(out, 0x18a)}")`);
  check(same(out.subarray(0x1fa, 0x1ff), new Uint8Array([1, 0, 0x80, 0, 0x80])) && f64(out, 0x292) === 1300.5, "the fields after the texts land at +0x1fa and +0x292");
  const other = made(63, patterned(500));
  check(other.length === 768 && same(other.subarray(0, 0x38), patterned(500).subarray(0, 0x38)) && other.subarray(0x38).every((v) => v === 0), "a dimension of another size keeps its attributes and plan box alone");
}

// 10. mesh faces: the vertex count moves from +0x3a to just before the vertex numbers
{
  const b = new Uint8Array(0x78 + 4 * 3);
  setU16(b, 0x3a, 3);
  setF64(b, 0x48, 1.5);
  [11, 12, 13].forEach((v, i) => setU32(b, 0x78 + 4 * i, v));
  const out = made(41, b);
  check(out.length === b.length + 6 && u16(out, 0x3e) === 0 && f64(out, 0x4c) === 1.5 && u16(out, 0x7c) === 3, "a face's count sits before its vertex numbers, its points behind the slot");
  check([0, 1, 2].every((i) => u32(out, 0x7e + 4 * i) === 11 + i), "its vertex numbers follow the count");
}

// 11. 3D bodies gain ten bytes at the start; a slab the slot and two at the end
{
  const body = patterned(600);
  const out = made(114, body);
  check(out.length === 610 && out.subarray(0, 10).every((v) => v === 0) && same(out.subarray(10), body), "a 3D body gains ten zero bytes at its start");
  const slab = patterned(184);
  const s = made(71, slab);
  check(s.length === 190 && same(s.subarray(0x3c, 188), slab.subarray(0x38)) && s[188] === 0 && s[189] === 0, "a slab gains the slot and two zero bytes at its end");
  check(lateBody(71, patterned(200)) === null, "a slab of another size is left out");
}

// 12. line types take their dashes from the dash table's entry of their name
{
  const table = new Uint8Array(2 + 324 * 2);
  setU16(table, 0, 2);
  const dashA = patterned(90);
  const dashB = patterned(90).map((v) => v ^ 0xff);
  table.set(dashA, 2);
  putText(table, 2 + 260, "Short Dashed");
  table.set(dashB, 2 + 324);
  putText(table, 2 + 324 + 260, "Centre");
  const line = (name: number): OlderRecord => ({ type: 96, name, body: new Uint8Array([0, 0, 1, 2, 3, 4, 0, 3, 0, 0, 0, 0, 0, 0, 0xf0, 0xbf, 9, 8]) });
  const recs: OlderRecord[] = [line(6), { type: 30, name: 0, body: table }, line(4), line(5)];
  const names = new Map([
    [4, "Short Dashed"],
    [5, "Not in the table"],
    [6, "Centre"],
  ]);
  const bodies = lineTypeBodies(recs, names);
  const a = bodies.get(recs[2]), b = bodies.get(recs[0]);
  check(bodies.size === 2 && !bodies.has(recs[3]), "two of three line types are in the dash table; the third gets no body");
  check(!!a && a.length === 274 && same(a.subarray(0, 16), recs[2].body.subarray(0, 16)) && same(a.subarray(16, 106), dashA) && a[106] === 9 && a[107] === 8 && a.subarray(108).every((v) => v === 0), "a line type is its 16 bytes, its entry's 90 bytes of dashes, its last two bytes and zeros to 274");
  check(!!b && same(b.subarray(16, 106), dashB), "each takes the entry of its own name, whatever the order");
  check(lateBody(96, recs[3].body) === null && lateBody(30, table) === null, "a line type without an entry, and the dash table itself, are left out");
}

// 13. what is left out, and what isn't a type read here
for (const type of [14, 18, 38, 42, 48, 69, 97, 102, 107, 127, 128]) check(lateBody(type, patterned(120)) === null, `type ${type} is left out (null)`);
check(lateBody(58, patterned(120)) === undefined && lateBody(26, patterned(100)) === undefined, "a type not read here is left to the caller (undefined)");

console.log(failures ? `\n${failures} failed` : "\nall legacyLate checks pass");
process.exit(failures ? 1 : 0);
