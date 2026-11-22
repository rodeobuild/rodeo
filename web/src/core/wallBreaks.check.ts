// Checks the break list of a wall record (wallBreaks.ts) on records built by hand: a head of zeros, the
// count, then blocks of the sizes of the 2024 layout (no real data). Run from web/:
//   npx tsx src/core/wallBreaks.check.ts
// Reading and solving sizes; moving, removing and adding breaks with exact round trips; the refusals
// (end caps, offsets off the wall, a list that doesn't parse, a block that isn't a symbol).

import {
  addSymbolBreak,
  wallComponentCount,
  moveWallBreak,
  readWallBreaks,
  removeWallBreak,
  solveBreakSizes,
  symbolBlockFromHead,
  symbolBreakFlags,
  type WallBreakSizes,
} from "./wallBreaks.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// the 2024 layout with no name: cap 611, half 603, symbol 615 + 88 × components (size = base + 4 + u32 at +20)
const SZ: WallBreakSizes = { cap: 607, half: 599, peak: 599, symbolBase: 611, symbolPer: 88, comp69Base: 82, comp69Stride: 294 };
const HEAD = 0x130; // where the count sits: zeros before it, so the scan finds only the list

/** One block: kind at +10, off at 0, flags at +8; a symbol carries height (f64) and ref (u32) at its end. */
function block(kind: 1 | 2 | 3 | 4, off: number, opts: { n?: number; flags?: number; height?: number; ref?: number } = {}): Uint8Array {
  const size = kind === 4 ? SZ.cap + 4 : kind === 2 ? SZ.half + 4 : kind === 3 ? SZ.peak + 4 : SZ.symbolBase + SZ.symbolPer * (opts.n ?? 1) + 4;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  dv.setFloat64(0, off, true);
  dv.setUint16(8, opts.flags ?? 0, true);
  b[10] = kind;
  if (kind === 1) {
    dv.setFloat64(size - 20, opts.height ?? 0, true);
    dv.setUint32(size - 12, opts.ref ?? 0, true);
  }
  return b;
}
const cap0 = () => block(4, -1);
const capEnd = () => {
  const b = block(4, 1e91);
  return b;
};

/** A record: zeros, the count, then the blocks. */
function record(blocks: Uint8Array[]): Uint8Array {
  const total = HEAD + 2 + blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint16(HEAD, blocks.length, true);
  let at = HEAD + 2;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  return out;
}
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// sizes from walls alone: type-69 children of 82 + 294n bytes (n = 1, 3, 4), two-cap walls, three-break walls with a
// half, symbols of 1, 3 and 4 components, and a four-break wall with a peak whose size only the search finds
const t69 = (n: number) => 82 + 294 * n;
const solveWalls = [
  { data: record([cap0(), capEnd()]), components69: null },
  { data: record([cap0(), capEnd()]), components69: null },
  { data: record([cap0(), block(2, 300), capEnd()]), components69: t69(0) },
  { data: record([cap0(), block(1, 200, { n: 1, ref: 7 }), capEnd()]), components69: t69(1) },
  { data: record([cap0(), block(1, 900, { n: 3, ref: 9 }), capEnd()]), components69: t69(3) },
  { data: record([cap0(), block(1, 500, { n: 4, ref: 9 }), block(3, 600), capEnd()]), components69: t69(4) },
];
const solved = solveBreakSizes(solveWalls);
check(solved?.cap === SZ.cap, `cap base solved from two-cap walls (${solved?.cap})`);
check(solved?.half === SZ.half, `half base solved from a three-break wall (${solved?.half})`);
check(solved?.symbolBase === SZ.symbolBase && solved?.symbolPer === SZ.symbolPer, `symbol base and per-component solved from two counts (${solved?.symbolBase}, ${solved?.symbolPer})`);
check(solved?.comp69Base === 82 && solved?.comp69Stride === 294, `type-69 base and stride from the lengths seen (${solved?.comp69Base}, ${solved?.comp69Stride})`);
check(solved?.peak === SZ.peak, `peak base found by searching a four-break list (${solved?.peak})`);
check(wallComponentCount(null, SZ) === 0, "no type-69 child is 0 components");
check(wallComponentCount(82 + 294 * 5, SZ) === 5, "a length on the stride gives its count");
check(wallComponentCount(82 + 294 * 2 + 1, SZ) === null, "a length between counts gives null");
check(wallComponentCount(10, SZ) === null, "a length below the base gives null");
check(solveBreakSizes([{ data: record([cap0(), capEnd()]), components69: 82 + 294 }]) === null, "one type-69 length alone can't solve the stride");

// reading
const r1 = record([cap0(), block(2, 300), block(1, 700, { n: 2, ref: 42, height: 1234.5 }), capEnd()]);
const l1 = readWallBreaks(r1, 2, SZ);
check(l1 !== null && l1.breaks.length === 4, "a four-break record reads with its count");
check(l1?.breaks.map((b) => b.kind).join() === "4,2,1,4", `kinds in order (${l1?.breaks.map((b) => b.kind).join()})`);
check(l1?.breaks[2].ref === 42 && l1?.breaks[2].height === 1234.5, "a symbol break carries its ref and height");
check(l1?.countAt === HEAD, "the count's place is found");
check(readWallBreaks(r1, 3, SZ) === null, "the wrong component count refuses the record");
check(readWallBreaks(r1.subarray(0, r1.length - 1), 2, SZ) === null, "a record one byte short doesn't parse");
const bad = record([block(2, -1), capEnd()]);
check(readWallBreaks(bad, 0, SZ) === null, "a list not starting with a cap at -1 refuses");

// moving: out and back gives the same bytes; a move past a neighbour re-sorts
const moved = moveWallBreak(r1, l1!, 1, 800);
const ml = readWallBreaks(moved, 2, SZ)!;
check(ml.breaks[2].kind === 2 && ml.breaks[2].off === 800, "a half moved past the symbol is re-sorted after it");
const back = moveWallBreak(moved, ml, 2, 300);
check(same(back, r1), "moved out and back gives the original bytes");
check(same(moveWallBreak(r1, l1!, 2, 700), r1), "moving a break to where it is leaves the bytes the same");
let threw = false;
try { moveWallBreak(r1, l1!, 0, 5); } catch { threw = true; }
check(threw, "an end cap doesn't move");
threw = false;
try { moveWallBreak(r1, l1!, 1, -5); } catch { threw = true; }
check(threw, "an offset before the wall's start is refused");

// removing: the caps stay; a removed break parses with one fewer; add back from its own block gives the same bytes
const removed = removeWallBreak(r1, l1!, 2);
const rl = readWallBreaks(removed, 2, SZ)!;
check(rl.breaks.length === 3, "a symbol removed leaves three breaks");
threw = false;
try { removeWallBreak(r1, l1!, 3); } catch { threw = true; }
check(threw, "the last cap can't be removed");
const own = r1.slice(l1!.breaks[2].at, l1!.breaks[2].at + l1!.breaks[2].size);
const readded = addSymbolBreak(removed, rl, own, 700, l1!.breaks[2].flags, 1234.5, 42);
check(same(readded, r1), "a removed symbol added back from its own block gives the original bytes");

// adding a symbol from another wall with the same components: sorted, and a count of 4 more
const other = record([cap0(), block(1, 10, { n: 2, ref: 5, flags: 0x20 }), capEnd()]);
const ol = readWallBreaks(other, 2, SZ)!;
const withNew = addSymbolBreak(r1, l1!, other.slice(ol.breaks[1].at, ol.breaks[1].at + ol.breaks[1].size), 150, symbolBreakFlags(false, false, false), 2100, 77);
const wl = readWallBreaks(withNew, 2, SZ)!;
check(wl.breaks.length === 5 && wl.breaks[1].off === 150 && wl.breaks[1].ref === 77 && wl.breaks[1].height === 2100, "an added symbol is placed by its offset with its ref and height");
threw = false;
try { addSymbolBreak(r1, l1!, block(2, 0), 10, 0, 0, 0); } catch { threw = true; }
check(threw, "a half block is refused as a symbol to add");

// flags
check(symbolBreakFlags(true, true, true) === 0xc4, "plug-in, mirrored, against the left: 0xc4");
check(symbolBreakFlags(false, false, false) === 0x20, "a symbol alone: 0x20");
check(symbolBreakFlags(true, false, false, 0x200) === 0x204, "bits kept from the old flags (0x200), symbol bits set");

// not built from the head: no real symbol block equals its wall's head struct, so the function refuses
check(symbolBlockFromHead(r1, 2, SZ) === null, "symbolBlockFromHead refuses (no block equals its head struct): null");

// a four-break list with a peak of the searched size reads back exactly, and a record with a short tail doesn't
const four = record([cap0(), block(1, 500, { n: 2, ref: 3 }), block(3, 600), capEnd()]);
check(readWallBreaks(four, 2, SZ)?.breaks.map((b) => b.kind).join() === "4,1,3,4", "a list of symbol then peak reads");
check(readWallBreaks(four, 2, { ...SZ, peak: 598 }) === null, "a wrong peak base refuses the list");

console.log(failures === 0 ? "all ok" : `${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
