// Checks the layered PSD writer under Node. Run from web/:
//   npx tsx src/features/render/psd.check.ts [out.psd]
// PackBits round trips (runs of 2, 3, 128 and 129, literals of 128 and 129, a row of one byte, noise),
// then a file of three layers (an opaque picture, a hidden Multiply layer with a clear stretch, a
// layer named in Chinese) read back by a reader written here to the specification's rules: the
// header, each layer's rectangle, channels, blend mode, flags, Pascal and Unicode names, every
// channel's pixels, and the merged picture. With a path, the file is also written there for other
// readers (ImageMagick, psd-tools, Photoshop) to check.

import { writeFileSync } from "node:fs";
import { PsdWriter, packBits, unpackBits, type PsdLayer } from "./psd.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

console.log("PackBits");
let seed = 11;
const rand = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const rows: [string, number[]][] = [
  ["one byte", [7]],
  ["a run of 2", [5, 5]],
  ["a run of 3 after a literal", [1, 2, 3, 3, 3]],
  ["a run of 128", Array(128).fill(9)],
  ["a run of 129", Array(129).fill(9)],
  ["a literal of 128", Array.from({ length: 128 }, (_, i) => i)],
  ["a literal of 129", Array.from({ length: 129 }, (_, i) => i)],
  ["pairs", [1, 1, 2, 2, 3, 3, 4]],
  ["noise", Array.from({ length: 1000 }, () => Math.floor(rand() * 4))],
  ["long flat", Array(5000).fill(255)],
];
for (const [name, values] of rows) {
  const src = Uint8Array.from(values);
  const out = new Uint8Array(src.length + Math.ceil(src.length / 128) + 1);
  const n = packBits(src, out);
  const back = unpackBits(out, 0, n, src.length);
  check(same(back, src) && n <= out.length, `${name}: ${src.length} bytes → ${n}, back the same`);
}

// ---- a file of three layers ----------------------------------------------------------

const W = 131;
const H = 7;
function layerPixels(fill: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) px.set(fill(x, y), (y * W + x) * 4);
  }
  return px;
}
const layers: PsdLayer[] = [
  { name: "Render", rgba: layerPixels((x, y) => [x % 256, (y * 40) % 256, (x * y) % 256, 255]), blend: "normal", hidden: false },
  { name: "Shadows", rgba: layerPixels((x) => [x < 60 ? 80 : 255, x < 60 ? 80 : 255, x < 60 ? 80 : 255, x > 100 ? 0 : 255]), blend: "multiply", hidden: true },
  { name: "材质颜色 Ü", rgba: layerPixels((x, y) => [200, 10, (x + y) % 2 ? 30 : 31, 255]), blend: "normal", hidden: true },
];
const writer = new PsdWriter(W, H);
for (const l of layers) writer.add(l);
const merged = layers[0].rgba;
const blob = writer.finish(merged);
const file = new Uint8Array(await blob.arrayBuffer());
if (process.argv[2]) writeFileSync(process.argv[2], file);

console.log("The file read back");
let at = 0;
const u8 = (): number => file[at++];
const u16 = (): number => (file[at++] << 8) | file[at++];
const i16 = (): number => {
  const v = u16();
  return v >= 0x8000 ? v - 0x10000 : v;
};
const u32 = (): number => ((file[at++] << 24) | (file[at++] << 16) | (file[at++] << 8) | file[at++]) >>> 0;
const sig = (): string => String.fromCharCode(u8(), u8(), u8(), u8());

check(sig() === "8BPS" && u16() === 1, "signature and version 1");
at += 6;
const channels = u16();
const height = u32();
const width = u32();
const depth = u16();
const mode = u16();
check(channels === 3 && width === W && height === H && depth === 8 && mode === 3, `header: 3 channels, ${W} × ${H}, 8 bits, RGB`);
check(u32() === 0 && u32() === 0, "no colour mode data, no image resources");

const sectionLength = u32();
const sectionEnd = at + sectionLength;
const infoLength = u32();
const infoEnd = at + infoLength;
check(infoLength % 2 === 0, "layer info length is even");
const count = i16();
check(count === layers.length, `${layers.length} layers`);

interface Record {
  top: number;
  left: number;
  bottom: number;
  right: number;
  channels: { id: number; length: number }[];
  blend: string;
  opacity: number;
  flags: number;
  pascal: string;
  unicode: string | null;
}
const records: Record[] = [];
for (let i = 0; i < count; i++) {
  const top = u32();
  const left = u32();
  const bottom = u32();
  const right = u32();
  const n = u16();
  const chans: { id: number; length: number }[] = [];
  for (let c = 0; c < n; c++) chans.push({ id: i16(), length: u32() });
  const ok = sig() === "8BIM";
  const blend = sig();
  const opacity = u8();
  u8();
  const flags = u8();
  u8();
  const extraLength = u32();
  const extraEnd = at + extraLength;
  const maskLength = u32();
  at += maskLength;
  const rangesLength = u32();
  at += rangesLength;
  const nameLength = u8();
  const pascal = String.fromCharCode(...file.subarray(at, at + nameLength));
  at += nameLength;
  at += (4 - ((nameLength + 1) % 4)) % 4;
  let unicode: string | null = null;
  while (at < extraEnd) {
    check(sig() === "8BIM", `layer ${i}: additional info signature`);
    const key = sig();
    const len = u32();
    const end = at + len;
    if (key === "luni") {
      const units = u32();
      let s = "";
      for (let k = 0; k < units; k++) s += String.fromCharCode(u16());
      unicode = s;
    }
    at = end;
  }
  check(ok && at === extraEnd, `layer ${i}: blend signature and extra data length`);
  records.push({ top, left, bottom, right, channels: chans, blend, opacity, flags, pascal, unicode });
}

records.forEach((r, i) => {
  const l = layers[i];
  check(r.top === 0 && r.left === 0 && r.bottom === H && r.right === W, `layer ${i}: covers the picture`);
  check(same(r.channels.map((c) => c.id), [-1, 0, 1, 2]), `layer ${i}: channels transparency, red, green, blue`);
  check(r.blend === (l.blend === "multiply" ? "mul " : "norm") && r.opacity === 255, `layer ${i}: blend ${r.blend}, opacity 255`);
  check((r.flags & 2) === (l.hidden ? 2 : 0), `layer ${i}: ${l.hidden ? "hidden" : "shown"}`);
  check(r.unicode === l.name, `layer ${i}: Unicode name "${r.unicode}"`);
  check(r.pascal === l.name.replace(/[^\x20-\x7e]/g, "?"), `layer ${i}: Pascal name "${r.pascal}"`);
});

for (const [i, r] of records.entries()) {
  const px = new Uint8Array(W * H * 4);
  let ok = true;
  for (const c of r.channels) {
    const end = at + c.length;
    const compression = u16();
    ok &&= compression === 1;
    const counts: number[] = [];
    for (let y = 0; y < H; y++) counts.push(u16());
    const offset = c.id === -1 ? 3 : c.id;
    for (let y = 0; y < H; y++) {
      const row = unpackBits(file, at, at + counts[y], W);
      at += counts[y];
      for (let x = 0; x < W; x++) px[(y * W + x) * 4 + offset] = row[x];
    }
    ok &&= at === end;
  }
  check(ok && same(px, layers[i].rgba), `layer ${i}: every channel's pixels come back`);
}
check(at <= infoEnd && infoEnd - at <= 1, "the layers' channels fill the layer info");
at = infoEnd;
check(u32() === 0 && at === sectionEnd, "no global layer mask, and the section ends there");

const compression = u16();
const counts: number[] = [];
for (let k = 0; k < 3 * H; k++) counts.push(u16());
const mergedBack = new Uint8Array(W * H * 4);
for (let c = 0; c < 3; c++) {
  for (let y = 0; y < H; y++) {
    const n = counts[c * H + y];
    const row = unpackBits(file, at, at + n, W);
    at += n;
    for (let x = 0; x < W; x++) mergedBack[(y * W + x) * 4 + c] = row[x];
  }
}
let mergedOk = compression === 1;
for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) mergedOk &&= mergedBack[p * 4 + c] === merged[p * 4 + c];
check(mergedOk, "the merged picture comes back (RGB, packed)");
check(at === file.length, `the file ends after it (${file.length} bytes)`);

let threw = false;
try {
  new PsdWriter(30001, 10);
} catch {
  threw = true;
}
check(threw, "a side past 30000 px is refused");

console.log(failures ? `${failures} FAILED` : "all passed");
process.exitCode = failures ? 1 : 0;
