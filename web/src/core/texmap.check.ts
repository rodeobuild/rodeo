// Checks the texture part reader, writer and part add/remove in texmap.ts. Run from web/:
//   npx tsx src/core/texmap.check.ts
// Synthetic dictionaries only, built with newTextureDict and wrapped in records as the file holds
// them (the TDMD record body from +0x50). Prints ok or FAIL per check and exits non-zero on failure.

import { Rec } from "./records.ts";
import {
  addTexturePartTo,
  newTextureDict,
  type NewPart,
  OVERALL,
  readTextureParts,
  rebuildsExactly,
  removeTexturePartFrom,
  TEXTURE_BY_CLASS,
  TEXTURE_NONE,
  writeTexturePart,
  newUvTextureDict,
  isTextureDict,
} from "./texmap.ts";
import type { TexturePart, TexturePartChange } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const EXTRUDE = 24;
const WALL = 68;
const MESH = 40;
const SLAB = 71;
const SOLID = 84;
const UNKNOWN = 999;

/** The record (from +0x00) for a dictionary body: its header 0x50 bytes, then the body. */
function recordOf(body: Uint8Array, type = 76): Uint8Array {
  const d = new Uint8Array(0x50 + body.length);
  d[0x19] = type;
  d.set(body, 0x50);
  return d;
}
/** A dictionary record (76) holding `parts`, with key 8 as `tail`. */
function dictOf(parts: NewPart[], place?: number[][], axes?: number[][], tail: number[] = [0]): Uint8Array {
  return recordOf(newTextureDict(parts, tail, place, axes));
}
const plain = (part: number, texture: number, flag = 0x0c, mapping = 0): NewPart => ({ part, texture, flag, mapping });

/** The absolute offset of a key's first value in a record (from its directory entry). */
function keyAt(d: Uint8Array, key: number): number {
  const n = d[0x5a] | (d[0x5b] << 8);
  for (let i = 0; i < n; i++) {
    const at = 0x60 + 6 * i;
    if ((d[at] | (d[at + 1] << 8)) === key) return 0x60 + (d[at + 2] | (d[at + 3] << 8) | (d[at + 4] << 16) | (d[at + 5] << 24)) + 6;
  }
  throw new Error(`no key ${key}`);
}
/** Renames a key in the directory (a way to make a record hold a key the reader doesn't know). */
function renameKey(d: Uint8Array, from: number, to: number): Uint8Array {
  const out = d.slice();
  const n = out[0x5a] | (out[0x5b] << 8);
  for (let i = 0; i < n; i++) {
    const at = 0x60 + 6 * i;
    if ((out[at] | (out[at + 1] << 8)) === from) {
      out[at] = to & 0xff;
      out[at + 1] = to >> 8;
      return out;
    }
  }
  throw new Error(`no key ${from}`);
}
/** Byte positions where two records differ. */
function diffs(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push(i);
  return out;
}
const one = (d: Uint8Array, owner = EXTRUDE): TexturePart => readTextureParts(d, owner)[0];

// ---- names by owner type
{
  const names = (owner: number, parts: number[]): string[] => readTextureParts(dictOf(parts.map((p) => plain(p, 1))), owner).map((p) => p.name);
  check(JSON.stringify(names(EXTRUDE, [3, 4, 5, 6])) === JSON.stringify(["Overall", "Top", "Bottom", "Sides"]), "extrude 24 names: Overall, Top, Bottom, Sides");
  check(JSON.stringify(names(WALL, [3, 7, 8, 9, 10, 11, 12, 13, 14, 15])) === JSON.stringify(["Overall", "Left", "Right", "Start Cap", "End Cap", "Top", "Bottom", "Holes", "Component 1", "Component 2"]), "wall 68 names: sides, caps, Holes, then Component 1 and 2 for 14 and 15");
  check(JSON.stringify(names(MESH, [3, 4, 5])) === JSON.stringify(["Overall", "Material 1", "Material 2"]), "mesh 40 names: Material 1 for 4");
  check(JSON.stringify(names(UNKNOWN, [3, 1000])) === JSON.stringify(["Overall", "Part 1000"]), "unknown owner: Part 1000");
  check(JSON.stringify(names(SLAB, [3, 14, 15, 16])) === JSON.stringify(["Overall", "Top", "Bottom", "Sides"]), "slab 71 names: Top, Bottom, Sides for 14 to 16");
  check(names(SOLID, [3, 14])[1] === "Component 1", "solid 84 names: Component 1 for 14");
  check(names(EXTRUDE, [3, 26])[1] === "Part 26", "extrude: a curtain-wall id reads as Part 26");
}

// ---- mapType for each kind, and auto-align from bit 6
{
  const kinds: [number, number, string][] = [
    [0, 0x0c, "plane"],
    [0, 0x4c, "autoPlane"],
    [0, 0x4d, "autoPlane"],
    [0, 0x0d, "plane"],
    [1, 0x0c, "sphere"],
    [2, 0x0c, "cylinder"],
    [3, 0x0c, "perimeter"],
    [4, 0x0c, "shader"],
    [5, 0x0c, "imported"],
    [6, 0x0c, "default"],
    [7, 0x0c, "surfaceUV"],
  ];
  for (const [kind, flag, want] of kinds) {
    const p = one(dictOf([plain(OVERALL, 1, flag, kind)]));
    check(p.mapType === want && p.mapping === kind, `kind ${kind} with flag 0x${flag.toString(16)} reads as ${want}`);
  }
  // a kind 0 with bit 6 set is autoPlane whatever the other bits are
  check(one(dictOf([plain(OVERALL, 1, 0xff, 0)])).mapType === "autoPlane", "kind 0 with all bits set reads as autoPlane");
}

// ---- each flag bit, scale, radius, degrees, axes and origin
{
  for (let b = 0; b < 8; b++) {
    const p = one(dictOf([plain(OVERALL, 1, 1 << b, 0)]));
    const bits = { initialized: 0, flip: 1, repeatH: 2, repeatV: 3, longestEdge: 4, worldZ: 5, worldOrigin: 7 } as const;
    const want = Object.entries(bits).filter(([, bit]) => bit === b).map(([k]) => k);
    const got = (["initialized", "flip", "repeatH", "repeatV", "longestEdge", "worldZ", "worldOrigin"] as const).filter((k) => p[k]);
    check(JSON.stringify(got) === JSON.stringify(want), `flag bit ${b} sets ${want.length ? want[0] : "nothing"} only`);
  }
  check(one(dictOf([plain(OVERALL, 1, 0x0c, 0)])).repeatH && one(dictOf([plain(OVERALL, 1, 0x0c, 0)])).repeatV, "flag 0x0c repeats both ways");
  check(!one(dictOf([plain(OVERALL, 1, 0x0c, 0)])).initialized, "flag 0x0c is not initialized");
  const place = [[5, 6, 2, 2, Math.PI / 2, 750]];
  const axes = [[1, 0, 0, 0, 1, 0, 0, 0, 1, 10, 20, 30]];
  const p = one(dictOf([plain(OVERALL, 1)], place, axes));
  check(p.offsetU === 5 && p.offsetV === 6 && p.scale === 2 && near(p.rotation, 90) && p.radius === 750, "offset, scale, rotation in degrees and radius read");
  check(JSON.stringify(p.axes) === JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1]) && JSON.stringify(p.origin) === JSON.stringify([10, 20, 30]), "axes and origin read from key 7");
  // a dictionary whose key 4 or key 7 reads as an unknown key: the defaults
  const noFlag = renameKey(dictOf([plain(OVERALL, 1, 0x4d)], place, axes), 4, 99);
  const q = one(noFlag);
  check(q.repeatH && q.repeatV && !q.initialized && q.mapType === "plane", "missing key 4 reads as flag 0x0c");
  const noAxes = renameKey(dictOf([plain(OVERALL, 1)], place, axes), 7, 99);
  const r = one(noAxes);
  check(JSON.stringify(r.axes) === JSON.stringify([1, 0, 0, 0, 1, 0, 0, 0, 1]) && r.origin.every((v) => v === 0), "missing key 7 reads as identity axes and a zero origin");
  check(readTextureParts(new Uint8Array(0x60), EXTRUDE).length === 0, "a record with no key 3 reads as no parts");
}

// ---- writes: every field round-trips and the bytes outside the change stay put
{
  const base = () => dictOf([plain(OVERALL, TEXTURE_NONE, 0x0c, 0)], [[0, 0, 1, 1, 0, 1000]], [[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]]);
  const put = (change: TexturePartChange): TexturePart => {
    const d = base();
    check(writeTexturePart(d, OVERALL, change), `write ${JSON.stringify(change).slice(0, 70)} to part 3`);
    return one(d);
  };
  check(put({ texture: 5 }).texture === 5, "texture round-trips");
  check(put({ texture: TEXTURE_BY_CLASS }).texture === -1, "texture -1 (class) round-trips");
  check(put({ offsetU: 12.5 }).offsetU === 12.5, "offsetU round-trips");
  check(put({ offsetV: -3 }).offsetV === -3, "offsetV round-trips");
  const sc = put({ scale: 2.5 });
  check(sc.scale === 2.5, "scale round-trips (both slots)");
  check(near(put({ rotation: 30 }).rotation, 30), "rotation in degrees round-trips");
  check(put({ radius: 750 }).radius === 750, "radius round-trips");
  for (const k of ["flip", "repeatH", "repeatV", "longestEdge", "worldZ", "worldOrigin"] as const) {
    const q = put({ [k]: true });
    check(q[k] === true, `${k} on round-trips`);
  }
  check(put({ flip: true, repeatH: false }).repeatH === false, "repeatH off round-trips with flip on");
  check(put({ axes: [0, 1, 0, 1, 0, 0, 0, 0, 1] }).axes.join() === "0,1,0,1,0,0,0,0,1", "axes round-trip");
  check(put({ origin: [7, 8, 9] }).origin.join() === "7,8,9", "origin round-trips");
  const kindsOf: [TexturePartChange["mapType"], string][] = [["plane", "plane"], ["autoPlane", "autoPlane"], ["sphere", "sphere"], ["cylinder", "cylinder"], ["perimeter", "perimeter"], ["surfaceUV", "surfaceUV"]];
  for (const [mapType, want] of kindsOf) {
    const got = put({ mapType }).mapType;
    check(got === want, `mapType ${mapType} round-trips`);
  }
  // auto-align: autoPlane sets bit 6 and kind 0, plane clears it, the others keep it
  const d1 = base();
  writeTexturePart(d1, OVERALL, { mapType: "autoPlane" });
  check(one(d1).mapping === 0 && one(d1).mapType === "autoPlane", "autoPlane writes kind 0 with bit 6");
  writeTexturePart(d1, OVERALL, { mapType: "plane" });
  check(one(d1).mapping === 0 && one(d1).mapType === "plane", "plane writes kind 0 with bit 6 clear");
  writeTexturePart(d1, OVERALL, { mapType: "autoPlane" });
  writeTexturePart(d1, OVERALL, { mapType: "cylinder" });
  check(one(d1).mapping === 2 && one(d1).mapType === "cylinder", "cylinder writes kind 2");
  check(keyAt(d1, 4) >= 0 && (d1[keyAt(d1, 4)] & 0x40) !== 0, "cylinder leaves bit 6 as it was (set)");
  // a mapping change sets bit 0 and nothing else; a texture change leaves the flag byte alone
  const d2 = base();
  const flagAt = keyAt(d2, 4);
  const before = d2.slice();
  writeTexturePart(d2, OVERALL, { texture: 4 });
  check(diffs(before, d2).every((i) => i >= keyAt(d2, 3) && i < keyAt(d2, 3) + 4), "texture-only change touches the texture value only");
  check(d2[flagAt] === 0x0c, "texture-only change leaves the flag byte alone");
  writeTexturePart(d2, OVERALL, { offsetU: 1 });
  check(d2[flagAt] === 0x0d, "a mapping change sets bit 0 (0x0c becomes 0x0d)");
  const d3 = base();
  const b3 = d3.slice();
  writeTexturePart(d3, OVERALL, { offsetU: 9 });
  const slot = keyAt(d3, 6);
  check(diffs(b3, d3).every((i) => (i >= slot && i < slot + 8) || i === keyAt(d3, 4)), "bytes outside the changed value stay identical (flag byte excepted)");
  check(writeTexturePart(d3, 999, { offsetU: 1 }) === false, "a part that isn't there is not written");
  // throws when the change needs a key the record lacks
  const noAxes = renameKey(base(), 7, 99);
  let threw = false;
  try {
    writeTexturePart(noAxes, OVERALL, { axes: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
  } catch {
    threw = true;
  }
  check(threw, "axes can't be written where key 7 is missing: throws");
}

// ---- add and remove
{
  const one3 = dictOf([plain(OVERALL, 2, 0x4d, 0)], [[0, 0, 2, 2, 0.5, 1000]], [[1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 4, 5]]);
  const added = addTexturePartTo(one3, 4);
  const parts = readTextureParts(added, EXTRUDE);
  check(parts.length === 2 && parts[1].part === 4 && parts[1].name === "Top", "adding part 4 to a one-part dictionary gives two parts, the new one named Top");
  const copy = parts[1];
  const over = parts[0];
  check(copy.texture === over.texture && copy.mapping === over.mapping && copy.mapType === over.mapType && copy.flip === over.flip && copy.repeatH === over.repeatH && copy.initialized === over.initialized, "the new part copies Overall's texture, flags and mapping");
  check(copy.scale === over.scale && near(copy.rotation, over.rotation) && copy.offsetU === over.offsetU && copy.radius === over.radius, "the new part copies Overall's placement");
  check(JSON.stringify(copy.axes) === JSON.stringify(over.axes) && JSON.stringify(copy.origin) === JSON.stringify(over.origin), "the new part copies Overall's axes and origin");
  check(Buffer.compare(Buffer.from(removeTexturePartFrom(added, 4)), Buffer.from(one3)) === 0, "removing it gives back the original bytes exactly");
  check(rebuildsExactly(added), "a dictionary with the added part rebuilds exactly");
  const threw = (f: () => unknown): boolean => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  check(threw(() => addTexturePartTo(added, 4)), "adding a part that exists throws");
  check(threw(() => removeTexturePartFrom(one3, 4)), "removing a part that is not there throws");
  check(threw(() => removeTexturePartFrom(added, OVERALL)), "removing the whole object's part throws");
  check(threw(() => addTexturePartTo(dictOf([plain(4, 1)]), 5)), "adding to a dictionary with no whole-object part throws");
  check(threw(() => addTexturePartTo(renameKey(one3, 8, 9), 4)), "a dictionary with a key above 8 is refused");
  check(threw(() => addTexturePartTo(renameKey(one3, 7, 99), 4)), "a dictionary lacking key 7 is refused");
  const versioned = one3.slice();
  versioned[0x54] = 6;
  check(!rebuildsExactly(versioned) && threw(() => removeTexturePartFrom(versioned, 4)), "a dictionary laid out another way is refused and not rewritten");
}

// ---- rebuildsExactly
{
  // the spare directory entry and the last 6 bytes hold other values in files: they are kept as they are
  const junk = dictOf([plain(OVERALL, 2, 0x4d, 0)], [[0, 0, 1, 1, 0, 1000]], [[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]]);
  junk.set([8, 0, 1, 0, 0, 0], 0x90);
  junk.set([49, 80, 194, 27, 43, 64], junk.length - 6);
  check(rebuildsExactly(junk), "a record whose spare entry and last 6 bytes hold other values still rebuilds exactly");
  const addedJunk = addTexturePartTo(junk, 4);
  check(Buffer.compare(Buffer.from(addedJunk.subarray(0x90, 0x96)), Buffer.from([8, 0, 1, 0, 0, 0])) === 0, "adding a part keeps the spare directory entry");
  check(Buffer.compare(Buffer.from(addedJunk.subarray(addedJunk.length - 6)), Buffer.from([49, 80, 194, 27, 43, 64])) === 0, "adding a part keeps the last 6 bytes");
  check(Buffer.compare(Buffer.from(removeTexturePartFrom(addedJunk, 4)), Buffer.from(junk)) === 0, "removing it gives back the record exactly, the kept bytes included");

  check(rebuildsExactly(dictOf([plain(OVERALL, 1)])), "rebuildsExactly is true for a newTextureDict record");
  check(rebuildsExactly(dictOf([plain(OVERALL, 1), plain(4, 0, 0x4d, 5)], [[0, 0, 1, 1, 0, 1000], [3, 0, 2, 2, 1, 40]], [[1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]], [0, 3000])), "rebuildsExactly is true for two parts with a longer key 8");
  check(!rebuildsExactly(renameKey(dictOf([plain(OVERALL, 1)]), 8, 9)), "rebuildsExactly is false when key 8 reads as key 9");
  check(!rebuildsExactly(new Uint8Array(0x60)), "rebuildsExactly is false for an empty record");
  const u = recordOf(newUvTextureDict(7));
  check(rebuildsExactly(u) && readTextureParts(u, MESH)[0].texture === TEXTURE_BY_CLASS, "a UV texture dictionary: whole part is the class's (-1), and it rebuilds exactly");
  check(readTextureParts(u, MESH)[1].mapping === 5 && readTextureParts(u, MESH)[1].mapType === "imported", "the UV part is mapping 5 (imported)");
  check(isTextureDict(new Rec(u)), "isTextureDict is true for a record of the dictionary");
}

console.log(failures ? `${failures} FAILED` : "all ok");
process.exit(failures ? 1 : 0);
