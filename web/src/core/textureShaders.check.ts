// Checks texture shader reading (textureShaders.ts, and what readResources puts in a texture's
// shaders). Run from web/:
//   npx tsx src/core/textureShaders.check.ts
// Synthetic records only: a texture made by imageTexture (its Color Image shader tinted by a known
// colour), plain textures whose shader formats are built here, the prototype tables, and the
// family and prototype names. Nothing is drawn and no file is read.

import { imageTexture } from "./builtins.ts";
import { setF64, setI32, setU16 } from "./bytes.ts";
import { readFormat, type FormatDef } from "./params.ts";
import { readResources } from "./resources.ts";
import { Rec } from "./records.ts";
import { readShaderRecord, shaderKind, textureShaders } from "./textureShaders.ts";
import type { ResourceInfo } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const TEXTURE_NAME = 5;
const FORMAT_BASE = 20;

/** A format record with fields of these type codes (integers 1, booleans 2, numbers 3). */
function formatData(types: readonly number[]): Uint8Array {
  const sizes: Record<number, number> = { 1: 4, 2: 2, 3: 10 };
  const d = new Uint8Array(0x60 + 136 * types.length);
  setU16(d, 0x50, types.length);
  let off = 0;
  types.forEach((t, k) => {
    const at = 0x60 + 136 * k;
    setU16(d, at, t);
    setU16(d, at + 2, off);
    off += sizes[t];
  });
  return d;
}

/** A data record holding `values` for a format of `types` (its name index is set by the caller). */
function valueData(types: readonly number[], values: readonly number[]): Uint8Array {
  const sizes: Record<number, number> = { 1: 4, 2: 2, 3: 10 };
  const size = types.reduce((n, t) => n + sizes[t], 0);
  const d = new Uint8Array(0x56 + size);
  let off = 0;
  types.forEach((t, k) => {
    const at = 0x56 + off;
    if (t === 1) setI32(d, at, values[k]);
    else if (t === 2) setU16(d, at, values[k] ? 1 : 0);
    else setF64(d, at, values[k]);
    off += sizes[t];
  });
  return d;
}

/** A data record for a format of `types` with `values`, its name index set to `index`. */
function shaderData(index: number, types: readonly number[], values: readonly number[]): Uint8Array {
  const d = valueData(types, values);
  setU16(d, 0x50, index);
  return d;
}

/** A texture record with these children and its own name index. */
function texture(children: Rec[]): Rec {
  const tex = new Rec(new Uint8Array(0x62), 0);
  tex.data[0x19] = 97;
  setU16(tex.data, 0x1a, TEXTURE_NAME);
  for (const c of children) {
    c.parent = tex;
    tex.children.push(c);
  }
  return tex;
}

/** The records a texture from `shaders` (each: its format's types and values, by format name index). */
function plainTexture(shaders: readonly { format: number; types: readonly number[]; values: readonly number[] }[]): { tex: Rec; formats: Map<number, FormatDef> } {
  const formats = new Map<number, FormatDef>();
  const children: Rec[] = [];
  for (const s of shaders) {
    const fmt = readFormat(formatData(s.types));
    formats.set(s.format, fmt);
    const rec = new Rec(shaderData(s.format, s.types, s.values), 0);
    rec.data[0x19] = 48;
    children.push(rec);
  }
  return { tex: texture(children), formats };
}

function fullCheck(tex: Rec, formats: Map<number, FormatDef>): ResourceInfo {
  const names = new Map<number, string>([[TEXTURE_NAME, "Check texture"]]);
  const [info] = readResources([tex], names, (index) => formats.get(index) ?? null);
  return info;
}

// prototype tables and names
check(shaderKind(1, 40) === "Plain", "colour prototype 40 is Plain");
check(shaderKind(1, 41) === "Image", "colour prototype 41 is Image");
check(shaderKind(1, 46) === "Pavement", "colour prototype 46 is Pavement");
check(shaderKind(2, 31) === "Mirror", "reflectivity prototype 31 is Mirror");
check(shaderKind(2, 40) === "Anisotropic", "reflectivity prototype 40 is Anisotropic");
check(shaderKind(3, 10) === "Plain", "transparency prototype 10 is Plain");
check(shaderKind(3, 18) === "Rectangular Mask", "transparency prototype 18 is Rectangular Mask");
check(shaderKind(3, 19) === "Image Mask", "transparency prototype 19 is Image Mask");
check(shaderKind(4, 41) === "Image", "bump prototype 41 is Image");
check(shaderKind(4, 45) === "Pavement", "bump prototype 45 is Pavement");
check(shaderKind(1, 99) === "#99", "an unlisted colour prototype is #99");
check(shaderKind(4, 40) === "#40", "bump has no prototype 40: #40");

// an image texture as Rodeo writes one, tinted (filter colour) 200, 120, 40
{
  const td = imageTexture({
    image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mime: "image/png",
    width: 4,
    height: 2,
    size: 25.4,
    color: [200, 120, 40],
    previews: { large: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), small: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
  });
  const formats = new Map<number, FormatDef>();
  const nameIndex = new Map<string, number>();
  let next = FORMAT_BASE;
  for (const f of td.formats) {
    nameIndex.set(f.name, next);
    formats.set(next, readFormat(f.records[0].data));
    next++;
  }
  const recs = td.records.map((r) => new Rec(r.data, 0));
  td.records.forEach((r, i) => {
    if (r.format) setU16(recs[i].data, 0x50, nameIndex.get(r.format) ?? 0);
  });
  td.records.forEach((r, i) => {
    if (r.parent >= 0) {
      recs[i].parent = recs[r.parent];
      recs[r.parent].children.push(recs[i]);
    }
  });
  const tex = recs[0];
  setU16(tex.data, 0x1a, TEXTURE_NAME);
  const info = fullCheck(tex, formats);
  check(info.shaders?.color?.kind === "Image", "image texture: colour kind is Image");
  check(info.shaders?.color?.rgb === "#c87828", `image texture: filter colour is #c87828 (got ${info.shaders?.color?.rgb})`);
  check(info.shaders?.reflectivity === undefined, "image texture: no reflectivity shader, so none reported");
  check(info.shaders?.transparency === undefined, "image texture: no transparency shader, so none reported");
  check(info.shaders?.bump === undefined, "image texture: no bump shader, so none reported");
}

// a plain colour: 8-bit values read as they are; the brightness is not part of the colour
{
  const { tex, formats } = plainTexture([{ format: FORMAT_BASE, types: [1, 1, 1, 1, 1, 1, 3], values: [1, 40, 1, 84, 104, 47, 1] }]);
  const info = fullCheck(tex, formats);
  check(info.shaders?.color?.kind === "Plain" && info.shaders?.color?.rgb === "#54682f", `plain colour 84, 104, 47 reads #54682f (got ${info.shaders?.color?.rgb})`);
}

// 16-bit channels (above 255) are scaled to 0–255
{
  const types = [1, 1, 1, 1, 1, 1, 1, 1, 2];
  const { tex, formats } = plainTexture([{ format: FORMAT_BASE, types, values: [1, 41, 1, 4, 1, 8934, 43746, 49135, 1] }]);
  const info = fullCheck(tex, formats);
  check(info.shaders?.color?.rgb === "#23aabf", `16-bit image filter colour 8934, 43746, 49135 reads #23aabf (got ${info.shaders?.color?.rgb})`);
  const white = plainTexture([{ format: FORMAT_BASE, types, values: [1, 41, 1, 4, 1, 65535, 65535, 65535, 1] }]);
  check(fullCheck(white.tex, white.formats).shaders?.color?.rgb === "#ffffff", "16-bit white reads #ffffff");
}

// a plain colour whose format has another layout gets its kind but no rgb
{
  const { tex, formats } = plainTexture([{ format: FORMAT_BASE, types: [1, 1, 1, 1, 1, 1, 1], values: [1, 40, 1, 84, 104, 47, 1] }]);
  const color = fullCheck(tex, formats).shaders?.color;
  check(color?.kind === "Plain" && color.rgb === undefined, "a colour format with another layout: kind only");
}

// transparency: Plain's opacity field, as a percentage
{
  const { tex, formats } = plainTexture([{ format: FORMAT_BASE, types: [1, 1, 1, 3], values: [3, 10, 1, 0.25] }]);
  const t = fullCheck(tex, formats).shaders?.transparency;
  check(t?.kind === "Plain" && t.percent === 25, `transparency Plain 0.25 reads 25 percent (got ${t?.percent})`);
}

// a reflectivity and a bump record are read by kind alone; the first shader of a family wins
{
  const { tex, formats } = plainTexture([
    { format: FORMAT_BASE, types: [1, 1, 1, 3], values: [3, 19, 1, 0.5] },
    { format: FORMAT_BASE + 1, types: [1, 1, 1, 3], values: [3, 10, 1, 0.9] },
    { format: FORMAT_BASE + 2, types: [1, 1, 1, 3], values: [2, 35, 1, 0.1] },
    { format: FORMAT_BASE + 3, types: [1, 1, 1, 3], values: [4, 45, 1, 0.1] },
  ]);
  const s = fullCheck(tex, formats).shaders;
  check(s?.transparency?.kind === "Image Mask" && s.transparency.percent === undefined, "first transparency shader wins; a mask has no percent");
  check(s?.reflectivity?.kind === "Plastic", "reflectivity: Plastic");
  check(s?.bump?.kind === "Pavement", "bump: Pavement");
  check(s?.color === undefined, "no colour shader, so none reported");
}

// a texture with no shader records has an empty shaders object
{
  const tex = texture([]);
  setU16(tex.data, 0x1a, TEXTURE_NAME);
  const info = fullCheck(tex, new Map());
  check(info.shaders !== undefined && Object.keys(info.shaders).length === 0, "a texture with no shaders reports none");
}

// a shader record whose format does not begin with three integers is not read
{
  const fmt = readFormat(formatData([3, 1, 1]));
  check(readShaderRecord(valueData([3, 1, 1], [1, 2, 3]), fmt) === null, "a format that does not begin with integers is not read");
  const fmt2 = readFormat(formatData([1, 1, 1, 3]));
  const ok = readShaderRecord(valueData([1, 1, 1, 3], [4, 45, 2, 0.5]), fmt2);
  check(ok?.family === 4 && ok.prototype === 45 && ok.version === 2, "family, prototype and version read from the first three integers");
}

// textureShaders on a bare list: the first shader of each family
{
  const s = textureShaders([]);
  check(Object.keys(s).length === 0, "an empty list gives no shaders");
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all texture shader checks passed");
