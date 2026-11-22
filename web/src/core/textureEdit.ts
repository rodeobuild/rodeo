// Texture shader records read and written by position (the texture edits in edit.ts build on them).
//
// A texture (97) holds its shaders as type-48 children, each named by its record format. Field names
// differ between drawings (they are localised), so a field is always found by its position: 0, 1
// and 2 are Family, Prototype and Version, and the rest follow in the format's order. A shader's
// image, when it has one, is a type-93 holder under the shader's record.

import { f64, setF64, setI32, setU16, u16 } from "./bytes.ts";
import { type FormatDef, RECORD, recordFormat } from "./params.ts";
import type { Rec } from "./records.ts";
import { FAMILY_BUMP, FAMILY_COLOR, FAMILY_REFLECTIVITY, FAMILY_TRANSPARENCY, fallbackFieldName, readShaderRecord, type ShaderRecord, shaderKind } from "./textureShaders.ts";
import type { FieldKind, RecordField, ShaderField, TextureShader } from "./types.ts";

export const TEXTURE = 97;
const IMAGE_HOLDER = 93;
/** a texture's size: an f64 in inches */
export const TEXTURE_SIZE_AT = 0x5a;
/** an image holder's size: an f64 in inches, equal to the texture's size where the holder shows it */
export const HOLDER_SIZE_AT = 0x80;
/** a record's value count (u16) and where its values start, as params.ts reads them */
const RECORD_COUNT = 0x54;
const RECORD_FLAGS = 0x56;

/** the family numbers a shader's kind names, and the kinds a texture's shaders are read as */
export const FAMILY_NUMBER: Readonly<Record<Exclude<TextureShader["family"], "other">, number>> = {
  color: FAMILY_COLOR,
  reflectivity: FAMILY_REFLECTIVITY,
  transparency: FAMILY_TRANSPARENCY,
  bump: FAMILY_BUMP,
};
const FAMILY_NAME = new Map<number, TextureShader["family"]>([
  [FAMILY_COLOR, "color"],
  [FAMILY_REFLECTIVITY, "reflectivity"],
  [FAMILY_TRANSPARENCY, "transparency"],
  [FAMILY_BUMP, "bump"],
]);

/** A shader record under a texture, read through its format. */
export interface ShaderEntry extends ShaderRecord {
  rec: Rec;
  fmt: FormatDef;
}

/** The shader records under a texture, in file order, each read through its format (unreadable ones left out). */
export function shaderEntries(tex: Rec, formatOf: (index: number) => FormatDef | null): ShaderEntry[] {
  const out: ShaderEntry[] = [];
  for (const c of tex.children) {
    if (c.type !== RECORD || c.data.length < 0x52) continue;
    const fmt = formatOf(recordFormat(c.data));
    const shader = fmt ? readShaderRecord(c.data, fmt) : null;
    if (shader && fmt) out.push({ ...shader, rec: c, fmt });
  }
  return out;
}

/** The field kind a record format's field has, as a shader field reports it. */
function shaderFieldKind(kind: FieldKind | null): ShaderField["kind"] {
  if (kind === "integer" || kind === "boolean" || kind === "number" || kind === "dimension") return kind;
  if (kind === "text" || kind === "choice" || kind === "class" || kind === "layer") return "text";
  return "other";
}

/** A texture's shaders as textureShaders reports them: families 1 to 4, each with its fields. */
export function textureShaderList(tex: Rec, formatOf: (index: number) => FormatDef | null): TextureShader[] {
  const out: TextureShader[] = [];
  for (const e of shaderEntries(tex, formatOf)) {
    const family = FAMILY_NAME.get(e.family);
    if (!family) continue;
    const fields: ShaderField[] = e.values.slice(3).map((v: RecordField, k) => {
      const index = k + 3;
      const named = v.name.trim() !== "";
      return {
        index,
        name: named ? v.name : (fallbackFieldName(e.family, e.prototype, index) ?? ""),
        named,
        kind: shaderFieldKind(v.kind),
        value: v.value,
      };
    });
    out.push({
      family,
      kind: shaderKind(e.family, e.prototype),
      fields,
      image: e.rec.children.some((c) => c.type === IMAGE_HOLDER),
    });
  }
  return out;
}

/**
 * `d` with field `index` of `fmt` set to `value`, written as the field's kind stores it: a boolean as
 * a u16, an integer as an i32, a number or dimension as an f64. The caller checks the value and index.
 */
export function writeShaderField(d: Uint8Array, fmt: FormatDef, index: number, value: number | boolean): Uint8Array {
  const f = fmt.fields[index];
  const at = RECORD_FLAGS + u16(d, RECORD_COUNT) + f.off;
  const out = d.slice();
  if (f.kind === "boolean") setU16(out, at, value ? 1 : 0);
  else if (f.kind === "integer") setI32(out, at, value as number);
  else setF64(out, at, value as number);
  return out;
}

/** Throws unless `value` is one field `index` of `fmt` takes: a boolean, a whole number or a finite number, as its kind is. */
export function checkShaderValue(fmt: FormatDef, index: number, value: number | boolean, what: string): void {
  const kind = fmt.fields[index]?.kind;
  if (kind === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${what} takes true or false`);
  } else if (kind === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${what} takes a whole number`);
  } else if (kind === "number" || kind === "dimension") {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${what} takes a number`);
  } else throw new Error(`${what} can't be set`);
}

/** R, G, B from #rrggbb; throws when the text is not one. */
export function parseRgb(rgb: string): [number, number, number] {
  if (typeof rgb !== "string" || !/^#[0-9a-fA-F]{6}$/.test(rgb)) throw new Error("a colour is #rrggbb");
  return [1, 3, 5].map((i) => parseInt(rgb.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The scale a colour's channels are written at: 1 (0–255) when the current three are all within
 * 0–255, else 257 (0–65535, the 16-bit scale the file uses for them).
 */
export function channelScale(current: readonly number[]): number {
  return current.every((v) => v <= 255) ? 1 : 257;
}

/** The first shader of `family` among `entries`, the one textureShaders shows. */
export function firstOf(entries: readonly ShaderEntry[], family: number): ShaderEntry | undefined {
  return entries.find((e) => e.family === family);
}

/** An f64 at `at` of `d`, or NaN when the record is too short to hold one. */
export function f64At(d: Uint8Array, at: number): number {
  return d.length >= at + 8 ? f64(d, at) : Number.NaN;
}

/** The record `d` with its f64 at `at` set to `v`. */
export function withF64(d: Uint8Array, at: number, v: number): Uint8Array {
  const out = d.slice();
  setF64(out, at, v);
  return out;
}

export { IMAGE_HOLDER };
