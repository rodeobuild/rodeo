// An object's RenderWorks texture settings, as Object Info's Render tab shows them: a "TDMD" aux
// record (76) of kind "ttwr", a typed dictionary (FORMAT.md §7.1). Each key holds one value per
// texture part, in the same order:
//   1  i32 the part's id (3 the whole object; see partName for the others)
//   2  i32 the texture layer: 0 the base texture (none in any file seen)
//   3  i32 the texture: a texture's name index, TEXTURE_NONE (0), or TEXTURE_BY_CLASS (-1)
//   4  byte the flags (bit 0 initialized, 1 flip, 2 repeat across, 3 repeat up, 4 align to longest
//      edge, 5 use world Z, 6 auto-align plane, 7 use world origin)
//   5  i32 the mapping kind (0 plane, 1 sphere, 2 cylinder, 3 perimeter, 4 shader, 5 imported,
//      6 default, 7 surface UV)
//   6  6 × f64: offset across and up (mm), scale across, scale up (equal), rotation (radians), radius (mm)
//   7  12 × f64: the three axis rows (u, v, w), then the origin
//   8  i32 list, usually one 0
// A dictionary can hold no parts (key 8 alone). Its directory has one spare zero entry after the
// last, and the values end 6 zero bytes before the record does, where the u32 at +0x5c says.

import { concat, f64, i32, setF64, setI32, setU16, setU32, u16, u32 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { TexturePart, TexturePartChange, TextureMapType } from "./types.ts";

const AUX = 76;
const TAG = 0x50;
const VERSION = 0x54;
const KIND = 0x56;
const COUNT = 0x5a;
const END = 0x5c;
const BASE = 0x60;
const I32 = 8;
const BYTE = 1;
const F64 = 6;

const K_PART = 1;
const K_ZERO = 2;
const K_TEXTURE = 3;
const K_FLAG = 4;
const K_MAPPING = 5;
const K_PLACE = 6;
const K_AXES = 7;
const K_TAIL = 8;
const PLACE = 6;
const AXES = 12;
/** the flag byte of a part whose key 4 is missing: not initialized, repeats on */
const DEFAULT_FLAG = 0x0c;

/** The part id of the whole object. */
export const OVERALL = 3;
/** A part's texture when it shows none of its own. */
export const TEXTURE_NONE = 0;
/** A part's texture when it shows its class's. */
export const TEXTURE_BY_CLASS = -1;

/** 3D objects that take a texture when they have no settings record yet: extrudes, 3D polygons, sweeps, multiple extrudes, meshes, slabs and solids. */
export const TAKES_TEXTURE: ReadonlySet<number> = new Set([24, 25, 34, 38, 40, 71, 84, 113]);
/** The objects that take override parts (4, 5, 6): extrudes, sweeps and multiple extrudes. */
export const OVERRIDE_TYPES: ReadonlySet<number> = new Set([24, 34, 38]);
/** The override parts: top, bottom and sides. */
export const OVERRIDE_PARTS: readonly number[] = [4, 5, 6];

const WALL = 68;
const SOLID = 84;
const SLAB = 71;
const MESH = 40;
const EXTRUDE_LIKE: ReadonlySet<number> = new Set([24, 34, 38, 84]);

/** The mapping kinds by their stored number; kind 0 is "plane" or, with the auto-align flag, "autoPlane". */
const MAP_KINDS: readonly TextureMapType[] = ["plane", "sphere", "cylinder", "perimeter", "shader", "imported", "default", "surfaceUV"];
/** The mapping kinds a part can be set to, and the number each writes. */
const WRITE_KIND: ReadonlyMap<string, number> = new Map([
  ["plane", 0],
  ["autoPlane", 0],
  ["sphere", 1],
  ["cylinder", 2],
  ["perimeter", 3],
  ["surfaceUV", 7],
]);
/** Each mapping a change can name, with the bit it sets in key 4 (bit 6 is the auto-align plane, set by mapType). */
const FLAG_BITS: readonly [keyof TexturePartChange, number][] = [
  ["flip", 1],
  ["repeatH", 2],
  ["repeatV", 3],
  ["longestEdge", 4],
  ["worldZ", 5],
  ["worldOrigin", 7],
];
const INITIALIZED = 0;
const AUTO_ALIGN = 6;

/** The mapping types a change can set (see TexturePartChange). */
export const WRITABLE_MAP_TYPES: ReadonlySet<string> = new Set(WRITE_KIND.keys());

interface Entry {
  type: number;
  count: number;
  /** where the values start in the record */
  at: number;
}

/** A part as a rebuilt dictionary holds it: one value per key 1 to 7. */
interface PartRow {
  part: number;
  zero: number;
  texture: number;
  flag: number;
  mapping: number;
  place: number[];
  axes: number[];
}

/** A dictionary's rows, with key 8's values (null when it has no key 8), when it holds every key 1 to 7 and nothing above 8. */
interface Rows {
  rows: PartRow[];
  tail: number[] | null;
}

function text(d: Uint8Array, at: number): string {
  return String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);
}

/** True for an object's texture settings record. */
export function isTextureDict(r: Rec): boolean {
  const d = r.data;
  return r.type === AUX && d.length >= BASE && text(d, TAG) === "TDMD" && text(d, KIND) === "ttwr";
}

/** The object's texture settings record, if it has one. */
export function textureDict(r: Rec): Rec | null {
  return r.children.find(isTextureDict) ?? null;
}

function entries(d: Uint8Array): Map<number, Entry> {
  const out = new Map<number, Entry>();
  const n = u16(d, COUNT);
  for (let i = 0; i < n && BASE + 6 * i + 6 <= d.length; i++) {
    const at = BASE + u32(d, BASE + 6 * i + 2);
    if (at + 6 > d.length) continue;
    out.set(u16(d, BASE + 6 * i), { type: u16(d, at), count: u32(d, at + 2), at: at + 6 });
  }
  return out;
}

const SIZE: Record<number, number> = { [I32]: 4, [BYTE]: 1, [F64]: 8 };

/** The keys holding one value per part (`per` of them), checked to fit the record; null when they don't. */
function partEntries(d: Uint8Array): { n: number; e: Map<number, Entry> } | null {
  const e = entries(d);
  const tex = e.get(K_TEXTURE);
  if (!tex) return { n: 0, e };
  const n = tex.count;
  const want: [number, number, number][] = [
    [K_PART, I32, 1],
    [K_TEXTURE, I32, 1],
    [K_MAPPING, I32, 1],
    [K_PLACE, F64, PLACE],
  ];
  for (const [key, type, per] of want) {
    const x = e.get(key);
    if (!x || x.type !== type || x.count !== n * per || x.at + x.count * SIZE[type] > d.length) return null;
  }
  return { n, e };
}

/** One key's values, `per` for each of the `n` parts; null when the key is absent or the wrong size. */
function valuesOf(d: Uint8Array, e: Map<number, Entry>, key: number, type: number, per: number, n: number): number[] | null {
  const x = e.get(key);
  if (!x || x.type !== type || x.count !== n * per || x.at + x.count * SIZE[type] > d.length) return null;
  const out: number[] = [];
  for (let i = 0; i < x.count; i++) {
    out.push(type === I32 ? i32(d, x.at + 4 * i) : type === F64 ? f64(d, x.at + 8 * i) : d[x.at + i]);
  }
  return out;
}

/** The parts of a texture settings record's values, key by key; null when the keys it needs don't read. */
function table(d: Uint8Array): { n: number; part: number[]; zero: number[] | null; texture: number[]; flag: number[] | null; mapping: number[]; place: number[]; axes: number[] | null; tail: number[] | null; e: Map<number, Entry> } | null {
  const pe = partEntries(d);
  if (!pe) return null;
  const { n, e } = pe;
  const v = (key: number, type: number, per: number): number[] | null => valuesOf(d, e, key, type, per, n);
  const part = v(K_PART, I32, 1);
  const texture = v(K_TEXTURE, I32, 1);
  const mapping = v(K_MAPPING, I32, 1);
  const place = v(K_PLACE, F64, PLACE);
  if (!part || !texture || !mapping || !place) return null;
  const tail = e.get(K_TAIL);
  const tailVals = tail && tail.type === I32 && tail.at + 4 * tail.count <= d.length ? Array.from({ length: tail.count }, (_, i) => i32(d, tail.at + 4 * i)) : null;
  return { n, part, zero: v(K_ZERO, I32, 1), texture, flag: v(K_FLAG, BYTE, 1), mapping, place, axes: v(K_AXES, F64, AXES), tail: tailVals, e };
}

/** Every part's row and key 8's values, when the dictionary holds keys 1 to 8 (or 1 to 7) only and they all read; null otherwise. */
function rowsOf(d: Uint8Array): Rows | null {
  const t = table(d);
  if (!t || !t.zero || !t.flag || !t.axes) return null;
  if ([...t.e.keys()].some((k) => k > K_TAIL)) return null;
  if (t.e.has(K_TAIL) && !t.tail) return null;
  const rows: PartRow[] = [];
  for (let i = 0; i < t.n; i++) {
    rows.push({
      part: t.part[i],
      zero: t.zero[i],
      texture: t.texture[i],
      flag: t.flag[i],
      mapping: t.mapping[i],
      place: t.place.slice(PLACE * i, PLACE * i + PLACE),
      axes: t.axes.slice(AXES * i, AXES * i + AXES),
    });
  }
  return { rows, tail: t.e.has(K_TAIL) ? t.tail : null };
}

/** The name of a part, by its id and the owner's record type. `component` counts the components of a wall or solid from 1. */
export function partName(part: number, ownerType: number, component = 0): string {
  if (part === OVERALL) return "Overall";
  if (ownerType === MESH && part >= 4) return `Material ${part - 3}`;
  if ((ownerType === WALL || ownerType === SOLID) && part >= 14 && component > 0) return `Component ${component}`;
  if (ownerType === WALL) {
    const wall = ["Left", "Right", "Start Cap", "End Cap", "Top", "Bottom", "Holes"][part - 7];
    if (part >= 7 && part <= 13) return wall;
  }
  if (EXTRUDE_LIKE.has(ownerType) && part >= 4 && part <= 6) return ["Top", "Bottom", "Sides"][part - 4];
  if (ownerType === SLAB && part >= 14 && part <= 16) return ["Top", "Bottom", "Sides"][part - 14];
  return `Part ${part}`;
}

/** The mapping's name as Vectorworks gives it, from key 5's kind and key 4's bit 6. */
function mapTypeOf(kind: number, flag: number): TextureMapType {
  if (kind === 0) return flag & (1 << AUTO_ALIGN) ? "autoPlane" : "plane";
  return MAP_KINDS[kind] ?? "default";
}

/**
 * The parts of a texture settings record (none when it holds none or doesn't read), named by the
 * type of the object that holds it. A missing key 4 reads as 0x0c and a missing key 7 as identity
 * axes with a zero origin.
 */
export function readTextureParts(d: Uint8Array, ownerType: number): TexturePart[] {
  const t = table(d);
  if (!t) return [];
  const out: TexturePart[] = [];
  let component = 0;
  for (let i = 0; i < t.n; i++) {
    const part = t.part[i];
    if (part >= 14 && (ownerType === WALL || ownerType === SOLID)) component++;
    const flag = t.flag ? t.flag[i] : DEFAULT_FLAG;
    const bit = (b: number): boolean => (flag & (1 << b)) !== 0;
    const axes = t.axes ? t.axes.slice(AXES * i, AXES * i + 9) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const origin = t.axes ? t.axes.slice(AXES * i + 9, AXES * i + 12) : [0, 0, 0];
    const place = (j: number): number => t.place[PLACE * i + j];
    out.push({
      part,
      name: partName(part, ownerType, part >= 14 ? component : 0),
      texture: t.texture[i],
      mapping: t.mapping[i],
      mapType: mapTypeOf(t.mapping[i], flag),
      offsetU: place(0),
      offsetV: place(1),
      scale: place(2),
      rotation: (place(4) * 180) / Math.PI,
      radius: place(5),
      flip: bit(1),
      repeatH: bit(2),
      repeatV: bit(3),
      longestEdge: bit(4),
      worldZ: bit(5),
      worldOrigin: bit(7),
      initialized: bit(INITIALIZED),
      axes,
      origin,
    });
  }
  return out;
}

/** True when the record holds parts (they may not read). */
export function holdsParts(d: Uint8Array): boolean {
  return entries(d).has(K_TEXTURE);
}

/** Key 4 and the mapping of a record holding the whole object's part alone, for a new one to start as. */
export function partLike(d: Uint8Array): { flag: number; mapping: number } | null {
  const pe = partEntries(d);
  const flag = pe?.e.get(K_FLAG);
  if (!pe || pe.n !== 1 || !flag || flag.type !== BYTE || flag.count !== 1 || i32(d, pe.e.get(K_PART)!.at) !== OVERALL) return null;
  return { flag: d[flag.at], mapping: i32(d, pe.e.get(K_MAPPING)!.at) };
}

/**
 * Writes `change` to part `part` of the record `d` in place; false when it has no such part. Any
 * change but `texture` sets flag bit 0 (initialized). A mapType sets key 5 and bit 6 (auto-align):
 * "autoPlane" sets it, "plane" clears it, the other kinds leave it as it is. Throws when a change
 * needs key 4 or key 7 and the record lacks them.
 */
export function writeTexturePart(d: Uint8Array, part: number, change: TexturePartChange): boolean {
  const pe = partEntries(d);
  if (!pe) return false;
  const { n, e } = pe;
  let i = 0;
  while (i < n && i32(d, e.get(K_PART)!.at + 4 * i) !== part) i++;
  if (i === n) return false;
  // any change but the texture is a mapping change: it sets the initialized bit
  const mapping = (Object.keys(change) as (keyof TexturePartChange)[]).some((k) => k !== "texture" && change[k] !== undefined);
  if (change.texture !== undefined) setI32(d, e.get(K_TEXTURE)!.at + 4 * i, change.texture);
  const place = (j: number, v: number | undefined): void => {
    if (v !== undefined) setF64(d, e.get(K_PLACE)!.at + 8 * (PLACE * i + j), v);
  };
  place(0, change.offsetU);
  place(1, change.offsetV);
  if (change.scale !== undefined) {
    place(2, change.scale);
    place(3, change.scale);
  }
  place(4, change.rotation === undefined ? undefined : (change.rotation * Math.PI) / 180);
  place(5, change.radius);
  if (change.mapType !== undefined) {
    const kind = WRITE_KIND.get(change.mapType);
    if (kind === undefined) throw new Error(`a texture can't be mapped as ${change.mapType}`);
    setI32(d, e.get(K_MAPPING)!.at + 4 * i, kind);
  }
  if (change.axes !== undefined || change.origin !== undefined) {
    const k7 = e.get(K_AXES);
    if (!k7 || k7.type !== F64 || k7.count !== AXES * n) throw new Error("this texture record has no axes to write");
    const at = (j: number): number => k7.at + 8 * (AXES * i + j);
    if (change.axes !== undefined) {
      if (change.axes.length !== 9) throw new Error("a texture's axes are 9 numbers");
      change.axes.forEach((v, j) => setF64(d, at(j), v));
    }
    if (change.origin !== undefined) {
      if (change.origin.length !== 3) throw new Error("a texture's origin is 3 numbers");
      change.origin.forEach((v, j) => setF64(d, at(9 + j), v));
    }
  }
  if (mapping) {
    const k4 = e.get(K_FLAG);
    if (!k4 || k4.type !== BYTE || k4.count !== n) throw new Error("this texture record has no flags to write");
    let flag = d[k4.at + i];
    const bit = (b: number, on: boolean): void => {
      flag = on ? flag | (1 << b) : flag & ~(1 << b);
    };
    for (const [key, b] of FLAG_BITS) {
      const v = change[key];
      if (v !== undefined) bit(b, v as boolean);
    }
    if (change.mapType === "autoPlane") bit(AUTO_ALIGN, true);
    if (change.mapType === "plane") bit(AUTO_ALIGN, false);
    bit(INITIALIZED, true);
    d[k4.at + i] = flag & 0xff;
  }
  return true;
}

/** Key 8's values of a record, to keep when it is rewritten with parts. */
export function tailValues(d: Uint8Array): number[] {
  const x = entries(d).get(K_TAIL);
  if (!x || x.type !== I32 || x.at + 4 * x.count > d.length) return [0];
  return Array.from({ length: x.count }, (_, i) => i32(d, x.at + 4 * i));
}

/** A part as a new dictionary is written: what key 4 and the mapping start as. */
export interface NewPart {
  part: number;
  texture: number;
  flag: number;
  mapping: number;
}

/**
 * A texture settings record's body (from +0x50) with `parts`, each unmoved, at scale 1 and turned
 * by 0, with the length Vectorworks gives new parts (1000) and its mapping axes the drawing's.
 */
export function newTextureDict(parts: readonly NewPart[], tail: readonly number[], place?: readonly (readonly number[])[], axes?: readonly (readonly number[])[]): Uint8Array {
  return newDict("ttwr", [
    [K_PART, I32, parts.map((p) => p.part)],
    [K_ZERO, I32, parts.map(() => 0)],
    [K_TEXTURE, I32, parts.map((p) => p.texture)],
    [K_FLAG, BYTE, parts.map((p) => p.flag)],
    [K_MAPPING, I32, parts.map((p) => p.mapping)],
    [K_PLACE, F64, parts.flatMap((_, i) => place?.[i] ?? [0, 0, 1, 1, 0, 1000])],
    [K_AXES, F64, parts.flatMap((_, i) => axes?.[i] ?? IDENTITY)],
    [K_TAIL, I32, tail],
  ]);
}

/** A record (from +0x00) with `body` after its first 0x50 bytes, which are kept as they were. */
function withBody(d: Uint8Array, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(TAG + body.length);
  out.set(d.subarray(0, TAG));
  out.set(body, TAG);
  return out;
}

/**
 * The record `d` rebuilt from `rows` and key 8's `tail`, keeping its first 0x50 bytes. The directory's
 * spare entry (after key 8's) and the last 6 bytes of the body are kept as `d` has them: the files
 * hold bytes there that are not zero and that this module doesn't read.
 */
function rebuild(d: Uint8Array, rows: readonly PartRow[], tail: readonly number[] | null): Uint8Array {
  const values: [number, number, readonly number[]][] = [
    [K_PART, I32, rows.map((r) => r.part)],
    [K_ZERO, I32, rows.map((r) => r.zero)],
    [K_TEXTURE, I32, rows.map((r) => r.texture)],
    [K_FLAG, BYTE, rows.map((r) => r.flag)],
    [K_MAPPING, I32, rows.map((r) => r.mapping)],
    [K_PLACE, F64, rows.flatMap((r) => r.place)],
    [K_AXES, F64, rows.flatMap((r) => r.axes)],
  ];
  if (tail) values.push([K_TAIL, I32, tail]);
  const body = newDict("ttwr", values);
  // the spare directory entry follows the entries of the keys written, at the record offset BASE + 6 × their count
  const spare = BASE + 6 * values.length;
  if (d.length >= spare + 6) body.set(d.subarray(spare, spare + 6), spare - TAG);
  if (d.length >= TAG + 6) body.set(d.subarray(d.length - 6), body.length - 6);
  return withBody(d, body);
}

/**
 * True when the texture settings record `d` (from +0x00, its first 0x50 bytes included) is laid out
 * as this module writes it: rebuilt from its own values, it comes out byte for byte the same.
 */
export function rebuildsExactly(d: Uint8Array): boolean {
  if (d.length < BASE || text(d, TAG) !== "TDMD" || text(d, KIND) !== "ttwr") return false;
  const r = rowsOf(d);
  if (!r) return false;
  const out = rebuild(d, r.rows, r.tail);
  return out.length === d.length && out.every((b, i) => b === d[i]);
}

/**
 * The record `d` with the override part `part` added after its parts: a copy of its whole-object
 * part's values under the new id. Throws when the record is laid out some other way, has no
 * whole-object part, or already holds `part`.
 */
export function addTexturePartTo(d: Uint8Array, part: number): Uint8Array {
  if (!rebuildsExactly(d)) throw new Error("this object's texture settings are laid out in a way Rodeo doesn't rewrite, so a part can't be added");
  const r = rowsOf(d)!;
  const over = r.rows.find((x) => x.part === OVERALL);
  if (!over) throw new Error("this object has no whole-object texture part to copy");
  if (r.rows.some((x) => x.part === part)) throw new Error(`this object already has texture part ${part}`);
  const added: PartRow = { part, zero: over.zero, texture: over.texture, flag: over.flag, mapping: over.mapping, place: over.place.slice(), axes: over.axes.slice() };
  return rebuild(d, [...r.rows, added], r.tail);
}

/**
 * The record `d` without part `part`. Throws when the record is laid out some other way, the part
 * is not there, or it is the whole object's.
 */
export function removeTexturePartFrom(d: Uint8Array, part: number): Uint8Array {
  if (!rebuildsExactly(d)) throw new Error("this object's texture settings are laid out in a way Rodeo doesn't rewrite, so a part can't be removed");
  if (part === OVERALL) throw new Error("the whole object's texture part can't be removed");
  const r = rowsOf(d)!;
  if (!r.rows.some((x) => x.part === part)) throw new Error(`this object has no texture part ${part}`);
  return rebuild(
    d,
    r.rows.filter((x) => x.part !== part),
    r.tail,
  );
}

/** An extrude's, sweep's or multiple extrude's own matrix: nine rows at +0xcc, then the origin at +0x114. */
const OWNER_MATRIX = 0xcc;
const OWNER_ORIGIN = 0x114;
/** How nearly a face's normal must point along the object's own z for it to be its top or bottom. */
const LEVEL = 0.999;

/**
 * The texture part a face of object type `type` belongs to, given the face's normal `normal` in the
 * model's frame (any length) and the object's record data `d`. For an extrude, sweep or multiple
 * extrude the normal is turned into the object's own frame by its matrix: a face facing the own
 * +z is Top (4), one facing −z is Bottom (5), any other is Sides (6). Every other type, a zero
 * normal, or a matrix that doesn't read gives the whole object (OVERALL).
 */
export function facePartOf(type: number, d: Uint8Array, normal: readonly [number, number, number]): number {
  if (!OVERRIDE_TYPES.has(type)) return OVERALL;
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(len > 0) || !Number.isFinite(len) || d.length < OWNER_ORIGIN + 24) return OVERALL;
  const m: number[] = [];
  for (let i = 0; i < 9; i++) m.push(f64(d, OWNER_MATRIX + 8 * i));
  for (let i = 0; i < 3; i++) m.push(f64(d, OWNER_ORIGIN + 8 * i));
  if (!m.every(Number.isFinite)) return OVERALL;
  // the own z axis is the third row of the matrix (its image in the model's frame)
  const zx = m[6];
  const zy = m[7];
  const zz = m[8];
  const zl = Math.hypot(zx, zy, zz);
  if (!(zl > 0)) return OVERALL;
  const z = (normal[0] * zx + normal[1] * zy + normal[2] * zz) / (len * zl);
  if (z > LEVEL) return 4;
  if (z < -LEVEL) return 5;
  return 6;
}

/** The part a mesh's UV-mapped texture is in, as the demos' plants have it. */
export const UV_PART = 4;
/** The mapping method that places a texture by each vertex's (u, v). */
export const UV_MAPPING = 5;

/**
 * A mesh's texture settings (from +0x50) with its texture `texture` mapped by UV: an empty
 * whole-object part and the texture in a part of its own, as the demos' plants have them.
 */
export function newUvTextureDict(texture: number): Uint8Array {
  return newTextureDict(
    [
      // -1 is the class's texture, as the demos' plants have it
      { part: OVERALL, texture: TEXTURE_BY_CLASS, flag: 12, mapping: 0 },
      { part: UV_PART, texture, flag: 77, mapping: UV_MAPPING },
    ],
    [0],
  );
}

/**
 * A mesh's UV map (from +0x50), a "TeMe" dictionary (stored "eMeT"): key 1 a normal per vertex,
 * key 2 (u, v) per vertex, key 3 each face's texture part, front and back. Keys 4, 5 and 7 hold
 * what every UV map in the demos does (3, 50 and an unturned frame at the origin, meanings not
 * known); key 6 the vertex count, then two numbers whose meaning isn't known (0 here).
 */
export function newUvMapDict(normals: readonly number[], uvs: readonly number[], faces: number): Uint8Array {
  return newDict("eMeT", [
    [1, F64, normals],
    [2, F64, uvs],
    [3, I32, new Array<number>(2 * faces).fill(UV_PART)],
    [4, I32, [3]],
    [5, F64, [50]],
    [6, F64, [uvs.length / 2, 0, 0]],
    [7, F64, IDENTITY],
  ]);
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** A typed dictionary's body (from +0x50) of kind `kind` (as stored) holding `values` by key. */
function newDict(kind: string, values: readonly (readonly [number, number, readonly number[]])[]): Uint8Array {
  const dir = 6 * (values.length + 1);
  const blocks = values.map(([, type, vs]) => {
    const b = new Uint8Array(6 + vs.length * SIZE[type]);
    setU16(b, 0, type);
    setU32(b, 2, vs.length);
    vs.forEach((v, i) => {
      if (type === I32) setI32(b, 6 + 4 * i, v);
      else if (type === F64) setF64(b, 6 + 8 * i, v);
      else b[6 + i] = v;
    });
    return b;
  });
  const head = new Uint8Array(0x10 + dir);
  head.set([..."TDMD"].map((c) => c.charCodeAt(0)), 0);
  setU16(head, VERSION - TAG, 5);
  head.set([...kind].map((c) => c.charCodeAt(0)), KIND - TAG);
  setU16(head, COUNT - TAG, values.length);
  let off = dir;
  values.forEach(([key], i) => {
    setU16(head, 0x10 + 6 * i, key);
    setU32(head, 0x10 + 6 * i + 2, off);
    off += blocks[i].length;
  });
  setU32(head, END - TAG, off);
  return concat([head, ...blocks, new Uint8Array(6)]);
}
