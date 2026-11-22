// Texture shaders: what the shader records of a texture (type 97, FORMAT.md §4 and §7.3) are.
//
// Each shader is a data record (48) under the texture, whose format names it. Every shader record's
// first three fields are Family, Prototype and Version; the rest of its values are read through its
// format (params.ts). Families: 1 Color, 2 Reflectivity, 3 Transparency, 4 Bump (and 8 for the
// preview and shadow options, which the texture's kinds leave out). The prototype names are those of
// Vectorworks' scripting reference for CreateShaderRecord.
//
// Colours and amounts are read only where the field types of the format are the ones a census of
// the sample drawings found in every drawing that holds that shader (see the layouts below). Colour
// channels are 0–255 when all three are, otherwise 0–65535 (16-bit); a guess from the values seen,
// not something a format names.

import { type FormatDef, readValues } from "./params.ts";
import type { RecordField, ResourceInfo } from "./types.ts";

export type TextureShaders = NonNullable<ResourceInfo["shaders"]>;

export const FAMILY_COLOR = 1;
export const FAMILY_REFLECTIVITY = 2;
export const FAMILY_TRANSPARENCY = 3;
export const FAMILY_BUMP = 4;

/** Prototype names by family, as Vectorworks' scripting reference gives them. */
const PROTOTYPES: ReadonlyMap<number, ReadonlyMap<number, string>> = new Map<number, ReadonlyMap<number, string>>([
  [
    FAMILY_COLOR,
    new Map([
      [40, "Plain"],
      [41, "Image"],
      [42, "Fresnel"],
      [43, "Noise"],
      [44, "Tiles"],
      [45, "Bricks"],
      [46, "Pavement"],
    ]),
  ],
  [
    FAMILY_REFLECTIVITY,
    new Map([
      [30, "Image"],
      [31, "Mirror"],
      [32, "Fresnel"],
      [33, "Noise"],
      [34, "Tiles"],
      [35, "Plastic"],
      [36, "Bricks"],
      [37, "Pavement"],
      [38, "Glow"],
      [39, "Backlit"],
      [40, "Anisotropic"],
    ]),
  ],
  [
    FAMILY_TRANSPARENCY,
    new Map([
      [10, "Plain"],
      [11, "Color"],
      [12, "Image"],
      [13, "Glass"],
      [14, "Noise"],
      [15, "Tiles"],
      [16, "Bricks"],
      [17, "Pavement"],
      [18, "Rectangular Mask"],
      [19, "Image Mask"],
    ]),
  ],
  [
    FAMILY_BUMP,
    new Map([
      [41, "Image"],
      [42, "Noise"],
      [43, "Tiles"],
      [44, "Bricks"],
      [45, "Pavement"],
    ]),
  ],
]);

/** The kind a shader's family and prototype name ("#<number>" for a prototype the table does not list). */
export function shaderKind(family: number, prototype: number): string {
  return PROTOTYPES.get(family)?.get(prototype) ?? `#${prototype}`;
}

/**
 * The name Rodeo gives a settings field the drawing's format leaves unnamed, for the fields Rodeo's own
 * shaders have: the brightness of a Plain colour (field 6) and the opacity of a Plain transparency
 * (field 3). These are Rodeo's English words, not the drawing's. undefined for any other field.
 */
export function fallbackFieldName(family: number, prototype: number, index: number): string | undefined {
  if (family === FAMILY_COLOR && prototype === 40 && index === 6) return "Brightness";
  if (family === FAMILY_TRANSPARENCY && prototype === 10 && index === 3) return "Opacity";
  return undefined;
}

/** One shader record: its first three values and all its values, with the field types of its format. */
export interface ShaderRecord {
  family: number;
  prototype: number;
  version: number;
  values: RecordField[];
  /** the type code of each field of its format, in order */
  layout: number[];
}

/**
 * The shader record `d` read through its format `fmt`; null when the format does not begin with
 * three integer fields or the values do not fit it.
 */
export function readShaderRecord(d: Uint8Array, fmt: FormatDef): ShaderRecord | null {
  if (fmt.fields.length < 3 || fmt.fields.slice(0, 3).some((f) => f.kind !== "integer")) return null;
  const values = readValues(d, fmt);
  if (!values) return null;
  const [family, prototype, version] = values.slice(0, 3).map((v) => v.value as number);
  return { family, prototype, version, values, layout: fmt.fields.map((f) => f.type) };
}

/** Field types the census found in every drawing holding these shaders. */
export const PLAIN_COLOR_LAYOUT = [1, 1, 1, 1, 1, 1, 3]; // R, G, B at 3 to 5; brightness at 6
export const IMAGE_COLOR_LAYOUT = [1, 1, 1, 1, 1, 1, 1, 1, 2]; // filter colour R, G, B at 5 to 7
export const PLAIN_TRANSPARENCY_LAYOUT = [1, 1, 1, 3]; // opacity at 3

export function sameLayout(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** #rrggbb from three channels at `at`: 0–255, or 0–65535 when any channel is above 255. */
function rgbAt(values: readonly RecordField[], at: number): string | undefined {
  const channels = [0, 1, 2].map((k) => values[at + k]?.value);
  if (!channels.every((v): v is number => typeof v === "number" && Number.isFinite(v))) return undefined;
  const scale = channels.every((v) => v <= 255) ? 1 : 1 / 257;
  return `#${channels.map((v) => Math.max(0, Math.min(255, Math.round(v * scale))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * What a texture's shader records say, the first shader of each family being the one it shows.
 * `list` holds the texture's shader records in order.
 */
export function textureShaders(list: readonly ShaderRecord[]): TextureShaders {
  const out: TextureShaders = {};
  const seen = new Set<number>();
  for (const s of list) {
    if (seen.has(s.family)) continue;
    seen.add(s.family);
    const kind = shaderKind(s.family, s.prototype);
    if (s.family === FAMILY_COLOR) {
      if (s.prototype === 40 && sameLayout(s.layout, PLAIN_COLOR_LAYOUT)) out.color = { kind, rgb: rgbAt(s.values, 3) };
      else if (s.prototype === 41 && sameLayout(s.layout, IMAGE_COLOR_LAYOUT)) out.color = { kind, rgb: rgbAt(s.values, 5) };
      else out.color = { kind };
    } else if (s.family === FAMILY_REFLECTIVITY) {
      out.reflectivity = { kind };
    } else if (s.family === FAMILY_TRANSPARENCY) {
      const opacity = s.values[3]?.value;
      if (s.prototype === 10 && sameLayout(s.layout, PLAIN_TRANSPARENCY_LAYOUT) && typeof opacity === "number" && Number.isFinite(opacity)) {
        out.transparency = { kind, percent: opacity * 100 };
      } else out.transparency = { kind };
    } else if (s.family === FAMILY_BUMP) {
      out.bump = { kind };
    }
  }
  return out;
}
