// The break list at the end of a wall record (type 68): Vectorworks' wall breaks, where a wall is cut
// in plan. Each break is one block: a 26-byte header (f64 off along the wall's line from its start,
// mm; u16 flags; u8 kind at +10: 1 symbol, 2 half, 3 peak, 4 cap; u32 at +20 = the length of what
// follows it in the block, 1 in the 2023 drawings and a UTF-16 name's byte length later), the wall
// attributes struct, and a tail (cap 16 bytes, half and peak 8, symbol 20: f64 height, u32 ref, 8
// zeros). The list runs from a u16 count to the end of the record and always starts and ends with a
// cap: off -1 first, off above 1e90 last; the blocks between are sorted by off.
//
// The block sizes are not constant across drawings, so they are solved per drawing (solveBreakSizes)
// and stored as the base of each kind: a block's size is base + 4 + u32 at +20, where a symbol's base
// is symbolBase + symbolPer × components. Components are the wall's component count, which the
// caller reads from its type-69 child (its stride differs by drawing), and which is passed in, never
// guessed here. Writers return new arrays and re-parse their result before returning it; refusals throw.

export interface WallBreakSizes {
  /** cap block base (not counting the 4-byte length and what follows it) */
  cap: number;
  /** half block base; NaN when no half break was seen in the drawing */
  half: number;
  /** peak block base; NaN when no peak break was seen in the drawing */
  peak: number;
  /** symbol block base with no components */
  symbolBase: number;
  /** bytes per component in a symbol block */
  symbolPer: number;
  /** a wall's type-69 child (its components) is comp69Base + comp69Stride × components bytes long */
  comp69Base: number;
  comp69Stride: number;
}

export interface WallBreak {
  /** where the block starts in the record */
  at: number;
  /** its size in bytes */
  size: number;
  /** distance along the wall's line from its start (mm); -1 for the first cap, above 1e90 for the last */
  off: number;
  flags: number;
  kind: 1 | 2 | 3 | 4;
  /** symbol breaks: the insert's ref (the u16 at +0x1a of its record, as a u32 here), else 0 */
  ref: number;
  /** symbol breaks: the insert's height (the f64 of the tail), else 0 */
  height: number;
}

export interface WallBreakList {
  /** where the u16 count sits in the record; the head is everything before it */
  countAt: number;
  breaks: WallBreak[];
  /** the component count the list was read with */
  components: number;
  /** the sizes the list was read with */
  sizes: WallBreakSizes;
}

const SCAN_FROM = 0x112;
const MAX_COUNT = 400;
const MIN_BLOCK = 26;

const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);

/** The size of the block at `at` (kind at +10), or -1 when it doesn't fit the record. */
function blockSize(d: Uint8Array, dv: DataView, at: number, components: number, sizes: WallBreakSizes): number {
  if (at + MIN_BLOCK > d.length) return -1;
  const kind = d[at + 10];
  let base: number;
  if (kind === 4) base = sizes.cap;
  else if (kind === 2) base = sizes.half;
  else if (kind === 3) base = sizes.peak;
  else if (kind === 1) base = sizes.symbolBase + sizes.symbolPer * components;
  else return -1;
  const size = base + 4 + dv.getUint32(at + 20, true);
  return size > 0 && at + size <= d.length ? size : -1;
}

const isCapAt = (d: Uint8Array, dv: DataView, at: number): boolean =>
  at + MIN_BLOCK <= d.length && dv.getFloat64(at, true) === -1 && d[at + 10] === 4;
const isEndAt = (d: Uint8Array, dv: DataView, at: number): boolean =>
  at + MIN_BLOCK <= d.length && d[at + 10] === 4 && dv.getFloat64(at, true) > 1e90;

/** Walks the n blocks from `start`; returns them, or null when they don't run exactly to the end. */
function walk(d: Uint8Array, dv: DataView, start: number, n: number, components: number, sizes: WallBreakSizes): WallBreak[] | null {
  const out: WallBreak[] = [];
  let at = start;
  for (let i = 0; i < n; i++) {
    const size = blockSize(d, dv, at, components, sizes);
    if (size < 0) return null;
    const kind = d[at + 10] as 1 | 2 | 3 | 4;
    const off = dv.getFloat64(at, true);
    let ref = 0;
    let height = 0;
    if (kind === 1) {
      height = dv.getFloat64(at + size - 20, true);
      ref = dv.getUint32(at + size - 12, true);
    }
    out.push({ at, size, off, flags: dv.getUint16(at + 8, true), kind, ref, height });
    at += size;
  }
  if (at !== d.length) return null;
  const first = out[0];
  const last = out[out.length - 1];
  if (first.kind !== 4 || first.off !== -1 || last.kind !== 4 || !(last.off > 1e90)) return null;
  for (let i = 2; i < out.length - 1; i++) if (!(out[i].off >= out[i - 1].off)) return null;
  return out;
}

/** The break list of one wall record, or null when it doesn't parse exactly. */
export function readWallBreaks(data: Uint8Array, components: number, sizes: WallBreakSizes): WallBreakList | null {
  const dv = view(data);
  for (let at = SCAN_FROM; at + MIN_BLOCK + 2 <= data.length; at++) {
    if (!isCapAt(data, dv, at + 2)) continue;
    const n = dv.getUint16(at, true);
    if (n < 2 || n > MAX_COUNT) continue;
    const breaks = walk(data, dv, at + 2, n, components, sizes);
    if (breaks) return { countAt: at, breaks, components, sizes };
  }
  return null;
}

/**
 * The component count of a wall from the length of its type-69 child (null when it has none: 0 components),
 * or null when the length fits no whole count under these sizes.
 */
export function wallComponentCount(type69Length: number | null, sizes: Pick<WallBreakSizes, "comp69Base" | "comp69Stride">): number | null {
  if (type69Length === null) return 0;
  const { comp69Base: base, comp69Stride: stride } = sizes;
  if (!(stride > 0) || type69Length < base) return null;
  const n = (type69Length - base) / stride;
  return Number.isInteger(n) ? n : null;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Solves the sizes from a drawing's wall records, each with the length of its type-69 child (null when none), or null. */
export function solveBreakSizes(walls: readonly { data: Uint8Array; components69: number | null }[]): WallBreakSizes | null {
  // the type-69 stride: the gcd of the differences between the lengths seen; base: their common remainder
  const lens = [...new Set(walls.map((w) => w.components69).filter((x): x is number => x !== null))].sort((a, b) => a - b);
  if (lens.length < 2) return null;
  let stride = 0;
  for (const l of lens) stride = gcd(stride, l - lens[0]);
  const base = lens[0] % stride;
  if (!(stride > 0) || lens.some((l) => l < base || (l - base) % stride !== 0)) return null;
  const counts = walls.map((w) => wallComponentCount(w.components69, { comp69Base: base, comp69Stride: stride }));
  if (counts.some((c) => c === null)) return null;
  const sized = walls.map((w, i) => ({ data: w.data, components: counts[i] as number }));

  // cap: two-cap walls, the second cap starts where the first ends; base = size - 4 - u32 at +20
  const capBases = new Map<number, number>();
  for (const { data } of sized) {
    const dv = view(data);
    for (let at = SCAN_FROM; at + MIN_BLOCK + 2 <= data.length; at++) {
      if (!isCapAt(data, dv, at + 2) || dv.getUint16(at, true) !== 2) continue;
      const cap = (data.length - at - 2) / 2;
      if (!Number.isInteger(cap) || cap <= 0 || !isEndAt(data, dv, at + 2 + cap)) continue;
      const bb = cap - 4 - dv.getUint32(at + 2 + 20, true);
      capBases.set(bb, (capBases.get(bb) ?? 0) + 1);
    }
  }
  const cap = mode(capBases);
  if (cap === null) return null;

  // three-break walls [cap, middle, cap]: the middle block's size gives its kind's base; symbols by component count
  const midBases = new Map<string, number>();
  const symbolPts = new Map<string, number>(); // "n:base"
  for (const { data, components } of sized) {
    const dv = view(data);
    const len = data.length;
    for (let at = SCAN_FROM; at + MIN_BLOCK + 2 <= len; at++) {
      if (!isCapAt(data, dv, at + 2) || dv.getUint16(at, true) !== 3) continue;
      const p = at + 2 + cap + 4 + dv.getUint32(at + 2 + 20, true);
      if (p + MIN_BLOCK > len) continue;
      let end = -1;
      for (let L = 0; L <= 2000 && end < 0; L++) {
        const e = len - cap - 4 - L;
        if (e > p && isEndAt(data, dv, e) && dv.getUint32(e + 20, true) === L) end = e;
      }
      if (end < 0) continue;
      const kind = data[p + 10];
      const bb = end - p - 4 - dv.getUint32(p + 20, true);
      if (kind === 1) symbolPts.set(`${components}:${bb}`, (symbolPts.get(`${components}:${bb}`) ?? 0) + 1);
      else midBases.set(`${kind}:${bb}`, (midBases.get(`${kind}:${bb}`) ?? 0) + 1);
      break;
    }
  }
  const pick = (kind: number): number => {
    const m = new Map<number, number>();
    for (const [k, v] of midBases) {
      const [kk, bb] = k.split(":").map(Number);
      if (kk === kind) m.set(bb, v);
    }
    return mode(m) ?? NaN;
  };
  const partial: WallBreakSizes = {
    cap,
    half: pick(2),
    peak: pick(3),
    symbolBase: NaN,
    symbolPer: NaN,
    comp69Base: base,
    comp69Stride: stride,
  };

  // symbols: base = symbolBase + symbolPer × n, fitted from the most common pair of counts
  const pts: { n: number; base: number }[] = [];
  for (const k of symbolPts.keys()) {
    const [n, bb] = k.split(":").map(Number);
    pts.push({ n, base: bb });
  }
  const per = symbolPerFrom(pts);
  if (per === null) return null;
  const symbolBase = mode(new Map(pts.map((p) => [p.base - per * p.n, 1])));
  if (symbolBase === null) return null;
  partial.symbolBase = symbolBase;
  partial.symbolPer = per;

  // half and peak not seen in three-break walls: search each wall's list, the other sizes known
  if (Number.isNaN(partial.half) || Number.isNaN(partial.peak)) {
    const votesH = new Map<number, number>();
    const votesP = new Map<number, number>();
    for (const { data, components } of sized) {
      const sols = listBases(data, components, partial);
      if (sols.length !== 1) continue;
      if (!Number.isNaN(sols[0].half)) votesH.set(sols[0].half, (votesH.get(sols[0].half) ?? 0) + 1);
      if (!Number.isNaN(sols[0].peak)) votesP.set(sols[0].peak, (votesP.get(sols[0].peak) ?? 0) + 1);
    }
    if (Number.isNaN(partial.half)) partial.half = mode(votesH) ?? NaN;
    if (Number.isNaN(partial.peak)) partial.peak = mode(votesP) ?? NaN;
  }
  return partial;
}

/**
 * The half and peak bases that make a wall's list run exactly to its end, with the cap and symbol sizes
 * known. Tries each start of a list (the scan of readWallBreaks) and every base in a range for the
 * unknown kinds; returns the distinct solutions (NaN for a kind the list doesn't have).
 */
function listBases(data: Uint8Array, components: number, sizes: WallBreakSizes): { half: number; peak: number }[] {
  const dv = view(data);
  const out: { half: number; peak: number }[] = [];
  const add = (sol: { half: number; peak: number }) => {
    if (!out.some((o) => o.half === sol.half && o.peak === sol.peak)) out.push(sol);
  };
  const rec = (p: number, left: number, half: number, peak: number): void => {
    if (out.length > 1) return;
    if (left === 0) { if (p === data.length) add({ half, peak }); return; }
    if (p + MIN_BLOCK > data.length) return;
    const kind = data[p + 10];
    const L = dv.getUint32(p + 20, true);
    if (kind === 4) return rec(p + sizes.cap + 4 + L, left - 1, half, peak);
    if (kind === 1) return rec(p + sizes.symbolBase + sizes.symbolPer * components + 4 + L, left - 1, half, peak);
    if (kind !== 2 && kind !== 3) return;
    const known = kind === 2 ? sizes.half : sizes.peak;
    const range = Number.isNaN(known) ? Array.from({ length: 2000 }, (_, i) => i + 1) : [known];
    for (const bb of range) {
      if (kind === 2) rec(p + bb + 4 + L, left - 1, bb, peak);
      else rec(p + bb + 4 + L, left - 1, half, bb);
      if (out.length > 1) return;
    }
  };
  // half/peak start as NaN: a kind seen in the list must take a value, one not seen stays NaN
  const start = { half: NaN, peak: NaN };
  for (let at = SCAN_FROM; at + MIN_BLOCK + 2 <= data.length; at++) {
    if (!isCapAt(data, dv, at + 2)) continue;
    const n = dv.getUint16(at, true);
    if (n < 2 || n > MAX_COUNT) continue;
    rec(at + 2, n, start.half, start.peak);
    if (out.length > 0) break;
  }
  return out;
}

function mode(m: Map<number, number>): number | null {
  let best: number | null = null;
  let count = 0;
  for (const [k, v] of m) if (v > count) { best = k; count = v; }
  return best;
}

/** The per-component size from symbol points (n, base): the difference that most pairs agree on. */
function symbolPerFrom(pts: { n: number; base: number }[]): number | null {
  const votes = new Map<number, number>();
  for (const a of pts) for (const b of pts) {
    if (b.n <= a.n) continue;
    const per = (b.base - a.base) / (b.n - a.n);
    if (Number.isInteger(per) && per > 0) votes.set(per, (votes.get(per) ?? 0) + 1);
  }
  return mode(votes);
}

/** The blocks of a list, in record order. */
function blocksOf(data: Uint8Array, list: WallBreakList): Uint8Array[] {
  return list.breaks.map((b) => data.slice(b.at, b.at + b.size));
}

/** Writes head + count + blocks as a new record, checked to parse again with the same sizes. */
function assemble(data: Uint8Array, list: WallBreakList, blocks: Uint8Array[]): Uint8Array {
  const head = data.subarray(0, list.countAt);
  const total = head.length + 2 + blocks.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  out.set(head, 0);
  new DataView(out.buffer).setUint16(list.countAt, blocks.length, true);
  let at = list.countAt + 2;
  for (const b of blocks) { out.set(b, at); at += b.length; }
  const again = readWallBreaks(out, list.components, list.sizes);
  if (!again || again.breaks.length !== blocks.length) throw new Error("wallBreaks: the written list does not parse");
  return out;
}

/** Sorts the middle blocks (not the two caps) by their offsets. */
function sortMiddle(blocks: Uint8Array[]): Uint8Array[] {
  const dv = blocks.map((b) => view(b));
  const idx = blocks.map((_, i) => i);
  const mid = idx.slice(1, -1).sort((a, b) => dv[a].getFloat64(0, true) - dv[b].getFloat64(0, true) || a - b);
  return [blocks[0], ...mid.map((i) => blocks[i]), blocks[blocks.length - 1]];
}

function checkIndex(list: WallBreakList, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= list.breaks.length) throw new RangeError(`wallBreaks: no break ${index}`);
}

/** A copy of the record with break `index` at a new offset (and the list kept sorted by offset). */
export function moveWallBreak(data: Uint8Array, list: WallBreakList, index: number, off: number): Uint8Array {
  checkIndex(list, index);
  const b = list.breaks[index];
  if (b.kind === 4 && (index === 0 || index === list.breaks.length - 1)) throw new Error("wallBreaks: a wall's end caps don't move");
  if (!Number.isFinite(off) || off < 0 || off > 1e90) throw new RangeError(`wallBreaks: offset ${off} is off the wall`);
  const blocks = blocksOf(data, list);
  view(blocks[index]).setFloat64(0, off, true);
  return assemble(data, list, sortMiddle(blocks));
}

/** A copy of the record without break `index` (never the first or last cap). */
export function removeWallBreak(data: Uint8Array, list: WallBreakList, index: number): Uint8Array {
  checkIndex(list, index);
  if (index === 0 || index === list.breaks.length - 1) throw new Error("wallBreaks: a wall's end caps can't be removed");
  const blocks = blocksOf(data, list);
  blocks.splice(index, 1);
  return assemble(data, list, blocks);
}

/** A copy of the record with a new symbol break: `block` is a symbol block to copy (from this or another wall with the same component count), given its new off, flags, height and ref. */
export function addSymbolBreak(data: Uint8Array, list: WallBreakList, block: Uint8Array, off: number, flags: number, height: number, ref: number): Uint8Array {
  const dv = view(block);
  if (block[10] !== 1) throw new Error("wallBreaks: the block to add is not a symbol break");
  const size = blockSize(block, dv, 0, list.components, list.sizes);
  if (size !== block.length) throw new Error("wallBreaks: the block to add has the wrong size for this wall");
  const copy = block.slice();
  const cv = view(copy);
  cv.setFloat64(0, off, true);
  cv.setUint16(8, flags, true);
  cv.setFloat64(size - 20, height, true);
  cv.setUint32(size - 12, ref, true);
  const blocks = blocksOf(data, list);
  blocks.splice(blocks.length - 1, 0, copy);
  return assemble(data, list, sortMiddle(blocks));
}

/** The symbol-break flags for an insert: plug-in or symbol, mirrored, y against the wall's left. */
export function symbolBreakFlags(isPlugin: boolean, mirrored: boolean, yAgainstLeft: boolean, keep = 0): number {
  const SYMBOL_BITS = 0x04 | 0x20 | 0x40 | 0x80;
  return (keep & ~SYMBOL_BITS) | (isPlugin ? 0x04 : 0x20) | (mirrored ? 0x40 : 0) | (yAgainstLeft ? 0x80 : 0);
}

/**
 * A symbol block made from the wall's own head struct, for a wall with no symbol break to copy.
 * Not done yet: in the 2024+ drawings a symbol block carries its own name (u32 at +20, then UTF-16)
 * before its struct, and the head's struct does not line up with the block's at a fixed offset (see
 * breaks-facts.md), so no block can be built from the head safely. Returns null until that is settled.
 */
export function symbolBlockFromHead(data: Uint8Array, components: number, sizes: WallBreakSizes): Uint8Array | null {
  void data;
  void components;
  void sizes;
  return null;
}
