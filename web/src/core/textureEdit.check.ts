// Checks the texture edits in edit.ts (setTextureSize, setShaderField, setTextureColor,
// setTextureOpacity, removeTextureShader, createColorTexture, deleteTexture) and the reads they
// rest on (textureShaders, textureUses). Run from web/:
//   npx tsx src/core/textureEdit.check.ts
// Synthetic drawings only: a blank drawing, with its own record formats made here. Nothing is drawn
// and no file is read. Prints ok or FAIL per check and exits non-zero on failure.

import { deflateSync } from "node:zlib";
import { concat, crc32, f64, setU32be } from "./bytes.ts";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { Model } from "./model.ts";
import type { EditSession, ResourceInfo, TextureShader } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A PNG of width by height pixels, rgb one triple per pixel row by row (as blank.check.ts makes them). */
function pngOf(width: number, height: number, rgb: readonly number[]): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    setU32be(out, 0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    setU32be(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const head = new Uint8Array(13);
  setU32be(head, 0, width);
  setU32be(head, 4, height);
  head.set([8, 2, 0, 0, 0], 8);
  const row = 1 + 3 * width;
  const raw = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) raw.set(rgb.slice(3 * width * y, 3 * width * (y + 1)), y * row + 1);
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

const PNG = pngOf(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
const previews = { large: PNG, small: PNG };
const near = (a: number | undefined, b: number, eps = 1e-6): boolean => a !== undefined && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

/** Throws-or-not, as a boolean, with the message the call threw. */
function throwsWith(f: () => void, pattern: RegExp): boolean {
  try {
    f();
    return false;
  } catch (err) {
    return pattern.test(err instanceof Error ? err.message : String(err));
  }
}

function resourceNamed(s: EditSession, name: string): ResourceInfo | undefined {
  return s.doc.resources().find((r) => r.kind === "texture" && r.name === name);
}

function shadersNow(s: EditSession, index: number): TextureShader[] {
  return s.doc.textureShaders(index);
}

/** The hex of each record of texture `index`'s subtree, in order (the bytes the edits must leave alone). */
function textureRecords(s: EditSession, index: number): string[] {
  const tex = (s.doc as Model).recs.find((r) => r.type === 97 && r.nameIndex === index);
  if (!tex) throw new Error("no texture record");
  return [...tex.walk()].map((r) => Buffer.from(r.data).toString("hex"));
}

// ---- a colour texture on a blank drawing ----------------------------------------------------
{
  const s = openVwx(blankDrawing("mm"), "texture-edit-colour.vwx");
  const red = s.createColorTexture("Red", "#c83232", 600, previews);
  const info = resourceNamed(s, "Red");
  check(info?.shaders?.color?.kind === "Plain" && info.shaders.color.rgb === "#c83232", "a new colour texture lists as a Plain colour with its rgb");
  check(near(info?.imageSize, 600), "a new colour texture lists its size in mm");
  const list = shadersNow(s, red);
  check(list.length === 1 && list[0].family === "color" && list[0].kind === "Plain" && !list[0].image, "a new colour texture's textureShaders is one Plain colour without an image");
  check(list[0].fields.map((f) => f.index).join() === "3,4,5,6", "its fields are at positions 3 to 6");
  check(list[0].fields.slice(0, 3).every((f) => f.kind === "integer") && list[0].fields[0].value === 200 && list[0].fields[1].value === 50 && list[0].fields[2].value === 50, "R, G, B are integers 200, 50, 50");
  check(list[0].fields[3].kind === "number" && list[0].fields[3].value === 1, "its Brightness is a number, 1");
  // the format leaves field 6 unnamed: Rodeo's name for it is "Brightness", and it is not the drawing's name
  check(list[0].fields[3].name === "Brightness" && list[0].fields[3].named === false, "field 6 of a Plain colour is named Brightness, not from the drawing");
  check(list[0].fields.slice(0, 3).every((f) => f.name === "" && f.named === false), "the unnamed R, G, B fields have no name and are not named by the drawing");

  // the formats its shader and options use are shader formats, which the Resources palette leaves out; a drawing's own format is not
  const own = s.createRecordFormat("Own format check", [{ name: "Note", kind: "integer", value: 7 }]);
  const formats = s.doc.resources().filter((r) => r.kind === "record-format");
  const flagged = formats.filter((r) => r.shaderFormat === true).map((r) => r.name).sort().join();
  check(flagged === "NNAMaxon Plain Color,NNAPreview Object Options,NNAShadow Options", `the three formats the colour texture made are shader formats (${flagged})`);
  check(formats.filter((r) => r.shaderFormat !== true).map((r) => r.name).join() === "Own format check", "no other record format is flagged, and a drawing's own format is listed without the flag");
  check(own > 0, "the drawing's own format was made");

  // a second colour texture reuses the drawing's Plain Color format (one of them)
  s.createColorTexture("Blue", "#0000ff", 300, previews);
  check(s.doc.recordFormats().filter((f) => f.name === "NNAMaxon Plain Color").length === 1, "a second colour texture reuses the drawing's Plain Color format");

  s.setTextureColor(red, "#00ff80");
  check(resourceNamed(s, "Red")?.shaders?.color?.rgb === "#00ff80", "setTextureColor changes the rgb");
  s.undo();
  check(resourceNamed(s, "Red")?.shaders?.color?.rgb === "#c83232", "undo restores the colour");
  s.redo();
  check(resourceNamed(s, "Red")?.shaders?.color?.rgb === "#00ff80", "redo applies the colour again");
  s.setTextureColor(red, "#c83232");

  s.setTextureSize(red, 1200);
  check(near(resourceNamed(s, "Red")?.imageSize, 1200), "setTextureSize changes imageSize");
  s.undo();
  check(near(resourceNamed(s, "Red")?.imageSize, 600), "undo restores the size");
  s.redo();
  check(near(resourceNamed(s, "Red")?.imageSize, 1200), "redo applies the size again");

  const rgbBefore = (): string | undefined => resourceNamed(s, "Red")?.shaders?.color?.rgb;
  s.setShaderField(red, "color", 4, 99);
  check(shadersNow(s, red)[0].fields[1].value === 99 && shadersNow(s, red)[0].fields[1].index === 4, "setShaderField writes an integer field by position");
  s.setShaderField(red, "color", 6, 0.5);
  check(shadersNow(s, red)[0].fields[3].value === 0.5, "setShaderField writes a number field");
  check(throwsWith(() => s.setShaderField(red, "color", 1, 2), /Family, Prototype and Version/), "setShaderField refuses field 1 (Prototype)");
  check(throwsWith(() => s.setShaderField(red, "color", 0, 2), /Family, Prototype and Version/), "setShaderField refuses field 0 (Family)");
  check(throwsWith(() => s.setShaderField(red, "color", 9, 2), /no field 9/), "setShaderField refuses a field out of range");
  check(throwsWith(() => s.setShaderField(red, "color", 4, 1.5), /whole number/), "setShaderField refuses a non-integer for an integer field");
  check(throwsWith(() => s.setShaderField(red, "color", 6, Number.NaN), /takes a number/), "setShaderField refuses a non-finite number");
  check(throwsWith(() => s.setShaderField(red, "reflectivity", 3, 1), /has no reflectivity shader/), "setShaderField refuses a family the texture lacks");

  check(throwsWith(() => s.setTextureOpacity(red, 40), /no Plain Transparency shader to copy: import a texture that has one first/), "setTextureOpacity refuses without the Plain Transparency format, with the clear message");
  check(throwsWith(() => s.setTextureOpacity(red, 140), /percentage from 0 to 100/), "setTextureOpacity refuses a percentage above 100");
  check(throwsWith(() => s.setTextureSize(red, 0), /above 0/), "setTextureSize refuses 0");
  check(throwsWith(() => s.setTextureColor(red, "red"), /#rrggbb/), "setTextureColor refuses a colour that is not #rrggbb");
  check(throwsWith(() => s.removeTextureShader(red, "reflectivity"), /has no reflectivity shader/), "removeTextureShader refuses a family the texture lacks");
  check(throwsWith(() => s.removeTextureShader(red, "color" as "bump"), /colour shader can't be removed/), "removeTextureShader refuses the colour shader");
  check(throwsWith(() => s.doc.textureShaders(999999), /no texture #999999/), "textureShaders throws for an index that is not a texture");

  // a class using the texture refuses its deletion, and clearing it lets the deletion through
  const cls = s.createClass("Red class");
  s.setClassTexture(cls, red);
  check(s.doc.textureUses(red).classes === 1, "textureUses counts the class that takes the texture");
  check(throwsWith(() => s.deleteTexture(red), /1 class use "Red"/), "deleteTexture refuses a texture a class uses, naming the count");
  s.setClassTexture(cls, 0);

  // an object whose part takes the texture
  const layer = s.doc.layers()[0].id;
  const flat = s.addObject(layer, { kind: "rect", x0: 0, y0: 0, x1: 40, y1: 30 });
  const [box] = s.extrudeObjects([flat], 500);
  s.setObjectTexture(box, 3, { texture: red });
  check(s.doc.textureUses(red).objects === 1, "textureUses counts the object whose part takes the texture");
  check(throwsWith(() => s.deleteTexture(red), /1 object use "Red"/), "deleteTexture refuses a texture an object uses, naming the count");
  s.setObjectTexture(box, 3, { texture: 0 });
  check(s.doc.textureUses(red).objects === 0, "clearing the part frees the texture");

  // opacity: a copy of the drawing's Plain Transparency format's defaults, added to the texture
  const fmt = s.createRecordFormat("NNAMaxon Plain Transparency", [
    { name: "Family", kind: "integer", value: 3 },
    { name: "Prototype", kind: "integer", value: 10 },
    { name: "Version", kind: "integer", value: 1 },
    { name: "Opacity", kind: "number", value: 1 },
  ]);
  check(fmt > 0, "the drawing has a Plain Transparency record format for the check");
  const before = textureRecords(s, red);
  s.setTextureOpacity(red, 40);
  const after = textureRecords(s, red);
  check(resourceNamed(s, "Red")?.shaders?.transparency?.percent === 40, "setTextureOpacity(40) on a texture without one adds a Plain transparency at 40");
  check(after.length === before.length + 1 && before.every((h) => after.includes(h)), "adding the opacity changes no other record of the texture");
  s.setTextureOpacity(red, 25);
  check(Math.abs((resourceNamed(s, "Red")?.shaders?.transparency?.percent ?? -1) - 25) < 1e-9, "setTextureOpacity changes an existing Plain transparency in place");
  s.setTextureOpacity(red, null);
  check(resourceNamed(s, "Red")?.shaders?.transparency === undefined, "setTextureOpacity(null) removes the Plain transparency");
  check(textureRecords(s, red).length === before.length, "removing the opacity leaves the texture as it was");
  s.setTextureOpacity(red, 40);
  s.removeTextureShader(red, "transparency");
  check(resourceNamed(s, "Red")?.shaders?.transparency === undefined, "removeTextureShader(transparency) removes it");

  // save and reopen: the texture, its colour, size, opacity and classes read back
  s.setTextureOpacity(red, 40);
  const back = openVwx(s.doc.toBytes(), "texture-edit-colour-saved.vwx");
  check(resourceNamed(back, "Red")?.shaders?.color?.rgb === rgbBefore() && rgbBefore() === "#c86332" && near(resourceNamed(back, "Red")?.imageSize, 1200), "the colour texture reopens with its colour (G set to 99 by setShaderField) and size");
  check(Math.abs((resourceNamed(back, "Red")?.shaders?.transparency?.percent ?? -1) - 40) < 1e-9, "the added opacity reopens at 40");
  check(resourceNamed(back, "Blue") !== undefined, "the other colour texture reopens");

  // delete: unused goes, and undo brings it back
  const tmp = s.createColorTexture("Tmp", "#101010", 100, previews);
  s.deleteTexture(tmp);
  check(resourceNamed(s, "Tmp") === undefined, "deleteTexture removes an unused texture");
  s.undo();
  check(resourceNamed(s, "Tmp") !== undefined, "undo brings the deleted texture back");
  s.redo();
  check(resourceNamed(s, "Tmp") === undefined, "redo deletes it again");
  const saved = openVwx(s.doc.toBytes(), "texture-edit-colour-deleted.vwx");
  check(resourceNamed(saved, "Tmp") === undefined && resourceNamed(saved, "Blue") !== undefined, "a deleted texture stays deleted after saving and reopening");
}

// ---- an image texture: its colour is the filter, its size reaches its holder ------------------
{
  const s = openVwx(blankDrawing("mm"), "texture-edit-image.vwx");
  const img = s.addImageTexture("Picture", { image: PNG, mime: "image/png", width: 2, height: 2, size: 400, color: [10, 20, 30], previews });
  check(resourceNamed(s, "Picture")?.shaders?.color?.kind === "Image", "an image texture's colour is an Image colour");
  s.setTextureColor(img, "#aabbcc");
  check(resourceNamed(s, "Picture")?.shaders?.color?.rgb === "#aabbcc", "setTextureColor on an image texture sets its filter colour");
  s.setShaderField(img, "color", 8, false);
  const colour = shadersNow(s, img)[0];
  check(colour.image && colour.fields[5].kind === "boolean" && colour.fields[5].value === false, "setShaderField writes a boolean field of an image colour (the anti-aliasing)");
  check(throwsWith(() => s.setTextureOpacity(img, 50), /not Plain|no Plain Transparency/), "setTextureOpacity refuses an image texture without a Plain transparency, with the drawing's reason");
  s.setTextureSize(img, 800);
  check(near(resourceNamed(s, "Picture")?.imageSize, 800), "setTextureSize on an image texture changes imageSize");
  const holder = [...(s.doc as Model).recs.find((r) => r.type === 97 && r.nameIndex === img)!.walk()].find((r) => r.type === 93);
  const shown = holder ? f64(holder.data, 0x80) : Number.NaN;
  check(near(shown, 800 / 25.4), "the image holder's size follows the texture's size");
  check(throwsWith(() => s.setTextureColor(img, "#12345"), /#rrggbb/), "setTextureColor refuses a short colour");
}

// ---- a removal of reflectivity, bump, and the shader order ------------------------------------
{
  const s = openVwx(blankDrawing("mm"), "texture-edit-order.vwx");
  const img = s.addImageTexture("Picture", { image: PNG, mime: "image/png", width: 2, height: 2, size: 400, color: [10, 20, 30], previews });
  check(throwsWith(() => s.removeTextureShader(img, "bump"), /has no bump shader/), "removeTextureShader refuses a family that is absent");
  check(throwsWith(() => s.deleteTexture(img + 1000), /no texture/), "deleteTexture refuses an index that is not a texture");
}

// ---- preview pictures: replaced as a whole, the rest of the texture left alone -----------------
{
  const s = openVwx(blankDrawing("mm"), "texture-edit-previews.vwx");
  const solid = (n: number, rgb: readonly number[]): Uint8Array => pngOf(n, n, Array.from({ length: n * n * 3 }, (_, i) => rgb[i % 3]));
  const red = s.createColorTexture("Red", "#c83232", 600, { large: solid(256, [200, 50, 50]), small: solid(64, [200, 50, 50]) });
  /** each record of texture `index` as [type, hex], in order */
  const recsOf = (index: number): [number, string][] => {
    const tex = (s.doc as Model).recs.find((r) => r.type === 97 && r.nameIndex === index);
    if (!tex) throw new Error("no texture record");
    return [...tex.walk()].map((r) => [r.type, Buffer.from(r.data).toString("hex")]);
  };
  const before = recsOf(red);
  const sizes = s.doc.resources().find((r) => r.kind === "texture" && r.index === red)?.previewSizes ?? [];
  check(sizes.map((z) => z.width).sort((a, b) => a - b).join() === "64,256", "a colour texture keeps previews of 64 and 256 pixels");
  const next = new Map<number, Uint8Array>([
    [256, solid(256, [10, 120, 240])],
    [64, solid(64, [10, 120, 240])],
  ]);
  s.setTexturePreviews(red, next);
  const after = recsOf(red);
  const changed = after.map((r, i) => r[1] !== before[i]?.[1]);
  check(after.length === before.length && after.every((r, i) => r[0] === before[i][0]), "setTexturePreviews keeps the texture's records in place");
  check(after.every((r, i) => r[0] === 119 || !changed[i]) && changed.some((c, i) => c && after[i][0] === 119), "setTexturePreviews changes only its preview records");
  check(resourceNamed(s, "Red")?.shaders?.color?.rgb === "#c83232" && near(resourceNamed(s, "Red")?.imageSize, 600), "the colour and size read as before");
  s.undo();
  check(recsOf(red).every((r, i) => r[1] === before[i][1]) && recsOf(red).length === before.length, "undo restores the previews");
  s.redo();
  check(recsOf(red).some((r, i) => r[1] !== before[i][1]), "redo applies the previews again");
  check(throwsWith(() => s.setTexturePreviews(red, new Map([[256, solid(64, [0, 0, 0])]])), /own size/), "setTexturePreviews refuses a PNG of another size");
  check(throwsWith(() => s.setTexturePreviews(red + 1000, next), /no texture/), "setTexturePreviews refuses an index that is not a texture");
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all texture edit checks passed");
process.exit(0);
