// A layered Photoshop file (PSD, version 1): 8-bit RGB, each layer the whole picture with its own
// transparency, a name (Unicode too), a blend mode and shown or hidden, and the merged picture that
// apps without layers show. Channels are run-length packed (PackBits), which every app that reads PSD
// reads. Layers are packed as they are added, so a writer holds packed bytes, never a layer's pixels.
// Adobe's "Photoshop File Formats Specification" describes the sections. No three.js and no DOM here.

/** How a layer lays over the ones below it. */
export type PsdBlend = "normal" | "multiply" | "screen";

export interface PsdLayer {
  readonly name: string;
  /** width × height pixels, four bytes each (R, G, B and alpha, alpha not premultiplied), top row first */
  readonly rgba: ArrayLike<number>;
  readonly blend: PsdBlend;
  readonly hidden: boolean;
}

const BLEND_KEYS: Readonly<Record<PsdBlend, string>> = { normal: "norm", multiply: "mul ", screen: "scrn" };
/** the layer flag that hides it (the specification's "visible" bit is set on a hidden layer) */
const HIDDEN = 0x02;
/** RLE, as the channels are written */
const PACKBITS = 1;
/** the order a layer's channels are written: transparency first, as Photoshop writes them */
const CHANNELS = [-1, 0, 1, 2] as const;
/** a PSD's largest side; the larger PSB format is not written */
export const PSD_MAX_SIDE = 30000;

/** Bytes written big-endian into a list of parts, as a PSD's numbers are. */
class Out {
  readonly parts: Uint8Array[] = [];
  length = 0;

  bytes(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }

  u8(v: number): void {
    this.bytes(Uint8Array.of(v & 0xff));
  }

  u16(v: number): void {
    this.bytes(Uint8Array.of((v >>> 8) & 0xff, v & 0xff));
  }

  i16(v: number): void {
    this.u16(v < 0 ? v + 0x10000 : v);
  }

  u32(v: number): void {
    this.bytes(Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff));
  }

  /** four ASCII letters ("8BPS", "8BIM", a blend key) */
  sig(s: string): void {
    this.bytes(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  }

  zeros(n: number): void {
    if (n > 0) this.bytes(new Uint8Array(n));
  }
}

/**
 * Builds a PSD a layer at a time: `add` the layers bottom first, then `finish` with the merged
 * picture. Each layer's channels are packed when it is added.
 */
export class PsdWriter {
  readonly width: number;
  readonly height: number;
  private readonly records: Out[] = [];
  /** each layer's packed channels, in record order */
  private readonly channels: Uint8Array[][] = [];
  /** one row of one channel, then that row packed (the worst case: a header byte every 128) */
  private readonly row: Uint8Array;
  private readonly packed: Uint8Array;

  constructor(width: number, height: number) {
    if (!(Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 && width <= PSD_MAX_SIDE && height <= PSD_MAX_SIDE)) {
      throw new Error(`a PSD is 1 to ${PSD_MAX_SIDE} px a side, not ${width} × ${height}`);
    }
    this.width = width;
    this.height = height;
    this.row = new Uint8Array(width);
    this.packed = new Uint8Array(width + Math.ceil(width / 128) + 1);
  }

  /** Adds a layer over those added before it. */
  add(layer: PsdLayer): void {
    const { width, height } = this;
    if (layer.rgba.length !== width * height * 4) throw new Error(`layer "${layer.name}" has ${layer.rgba.length} bytes, not ${width * height * 4}`);
    const data = CHANNELS.map((c) => this.packChannel(layer.rgba, c === -1 ? 3 : c, 4, true));
    const r = new Out();
    // the layer covers the whole picture: top, left, bottom, right
    r.u32(0);
    r.u32(0);
    r.u32(height);
    r.u32(width);
    r.u16(CHANNELS.length);
    CHANNELS.forEach((id, i) => {
      r.i16(id);
      r.u32(data[i].length);
    });
    r.sig("8BIM");
    r.sig(BLEND_KEYS[layer.blend]);
    r.u8(255); // opacity
    r.u8(0); // clipping: base
    r.u8(layer.hidden ? HIDDEN : 0);
    r.u8(0); // filler
    const extra = new Out();
    extra.u32(0); // no layer mask
    extra.u32(0); // no blending ranges
    pascalName(extra, layer.name);
    unicodeName(extra, layer.name);
    r.u32(extra.length);
    for (const p of extra.parts) r.bytes(p);
    this.records.push(r);
    this.channels.push(data);
  }

  /**
   * The file: the layers added and `merged` (width × height × 4 bytes, RGBA; its alpha is not
   * written) as the picture apps without layers show.
   */
  finish(merged: ArrayLike<number>): Blob {
    const { width, height } = this;
    if (merged.length !== width * height * 4) throw new Error(`the merged picture has ${merged.length} bytes, not ${width * height * 4}`);
    const out = new Out();
    // the header: 3 channels (RGB), 8 bits, RGB colour
    out.sig("8BPS");
    out.u16(1);
    out.zeros(6);
    out.u16(3);
    out.u32(height);
    out.u32(width);
    out.u16(8);
    out.u16(3);
    out.u32(0); // no colour mode data
    out.u32(0); // no image resources

    // the layers: their count, their records, then each one's channels
    let info = 2;
    for (const r of this.records) info += r.length;
    for (const layer of this.channels) for (const c of layer) info += c.length;
    const infoPadded = info + (info % 2);
    out.u32(4 + infoPadded + 4);
    out.u32(infoPadded);
    out.i16(this.records.length);
    for (const r of this.records) for (const p of r.parts) out.bytes(p);
    for (const layer of this.channels) for (const c of layer) out.bytes(c);
    out.zeros(infoPadded - info);
    out.u32(0); // no global layer mask

    // the merged picture: one compression for all three channels, every row's count, then the rows
    const planes = [0, 1, 2].map((c) => this.packChannel(merged, c, 4, false));
    out.u16(PACKBITS);
    for (const p of planes) out.bytes(p.subarray(0, 2 * height));
    for (const p of planes) out.bytes(p.subarray(2 * height));
    return new Blob(out.parts as BlobPart[], { type: "image/vnd.adobe.photoshop" });
  }

  /**
   * One channel (byte `offset` of every `stride`) packed: its compression when `own` (a layer's
   * channel has its own; the merged picture's share one), each row's packed length, then the rows.
   */
  private packChannel(src: ArrayLike<number>, offset: number, stride: number, own: boolean): Uint8Array {
    const { width, height, row, packed } = this;
    const head = own ? 2 : 0;
    const counts = new Uint8Array(head + 2 * height);
    if (own) counts[1] = PACKBITS;
    const rows: Uint8Array[] = [];
    let total = counts.length;
    for (let y = 0; y < height; y++) {
      let at = (y * width) * stride + offset;
      for (let x = 0; x < width; x++, at += stride) row[x] = src[at];
      const n = packBits(row, packed);
      counts[head + 2 * y] = n >>> 8;
      counts[head + 2 * y + 1] = n & 0xff;
      rows.push(packed.slice(0, n));
      total += n;
    }
    const all = new Uint8Array(total);
    all.set(counts);
    let at = counts.length;
    for (const r of rows) {
      all.set(r, at);
      at += r.length;
    }
    return all;
  }
}

/**
 * PackBits: a run of 2 to 128 equal bytes is a header 257 − n (−(n − 1) as a signed byte) and the
 * byte; 1 to 128 other bytes are a header n − 1 and the bytes. A literal stops before a run of
 * three, where a run saves a byte. Returns the bytes written to `out`.
 */
export function packBits(src: Uint8Array, out: Uint8Array): number {
  const n = src.length;
  let i = 0;
  let o = 0;
  while (i < n) {
    if (i + 1 < n && src[i] === src[i + 1]) {
      let run = 2;
      while (i + run < n && run < 128 && src[i + run] === src[i]) run++;
      out[o++] = 257 - run;
      out[o++] = src[i];
      i += run;
      continue;
    }
    const start = i++;
    while (i < n && i - start < 128 && !(i + 2 < n && src[i] === src[i + 1] && src[i] === src[i + 2])) i++;
    out[o++] = i - start - 1;
    for (let k = start; k < i; k++) out[o++] = src[k];
  }
  return o;
}

/** PackBits undone: `length` bytes from `src` at `at` (psd.check.ts reads files back with it). */
export function unpackBits(src: Uint8Array, at: number, end: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  let i = at;
  while (i < end && o < length) {
    const header = src[i++];
    if (header < 128) {
      const n = header + 1;
      out.set(src.subarray(i, i + n), o);
      o += n;
      i += n;
    } else if (header > 128) {
      const n = 257 - header;
      out.fill(src[i++], o, o + n);
      o += n;
    }
  }
  if (o !== length) throw new Error(`a packed row gave ${o} bytes, not ${length}`);
  return out;
}

/**
 * The layer's name as a Pascal string padded to four bytes, its length byte counted: ASCII, with
 * "?" for other letters, as older apps read it (unicodeName carries the name itself).
 */
function pascalName(out: Out, name: string): void {
  const bytes = Uint8Array.from([...name].slice(0, 255), (c) => {
    const code = c.codePointAt(0) ?? 63;
    return code >= 32 && code < 127 ? code : 63;
  });
  out.u8(bytes.length);
  out.bytes(bytes);
  out.zeros((4 - ((bytes.length + 1) % 4)) % 4);
}

/** The "luni" block: the name as UTF-16, which Photoshop shows in place of the Pascal one. */
function unicodeName(out: Out, name: string): void {
  const units = name.length;
  const body = 4 + 2 * units;
  const padded = body + ((4 - (body % 4)) % 4);
  out.sig("8BIM");
  out.sig("luni");
  out.u32(padded);
  out.u32(units);
  for (let i = 0; i < units; i++) out.u16(name.charCodeAt(i));
  out.zeros(padded - body);
}
