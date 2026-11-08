// Checks the PDF reader's pictures under Node. Run from web/:
//   npx tsx src/import/pdf.check.ts
// Small PDFs are built here in code and read back with openPdf. A Flate RGB picture with an 8-bit
// soft mask comes out as a PNG whose pixels and alpha are the file's, in the box it fills on the
// page; a mask of another size is stretched over it. A JPEG (bytes that start FF D8) goes through
// untouched at its dictionary's size, and its soft mask comes back as an alpha plane. A mirrored
// raw picture has its rows and columns turned to match; a mirrored JPEG is left out. A turned
// picture, CMYK, JPEG 2000, a stencil mask, an inline picture and one of more than 40 million pixels
// are counted and not read. A picture in a Form XObject takes the form's matrix, indexed, gray and
// 1-bit samples come out as RGB, and paths still come through beside the pictures.

import { deflateSync } from "node:zlib";
import { crc32 } from "../core/bytes.ts";
import { openPdf, type PdfPage, type PdfPicture } from "./pdf.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const same = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const boxIs = (p: PdfPicture | undefined, x0: number, y0: number, x1: number, y1: number): boolean =>
  !!p && near(p.x0, x0) && near(p.y0, y0) && near(p.x1, x1) && near(p.y1, y1);
const boxOf = (p: PdfPicture | undefined): string => (p ? [p.x0, p.y0, p.x1, p.y1].join(" ") : "none");

// ---- building PDFs -------------------------------------------------------------------------

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A PDF of numbered objects, object 1 the catalogue; each body is text or bytes. */
function pdfOf(bodies: readonly (string | Uint8Array)[]): Uint8Array {
  const parts: Uint8Array[] = [enc("%PDF-1.7\n")];
  bodies.forEach((body, i) => parts.push(enc(`${i + 1} 0 obj\n`), typeof body === "string" ? enc(body) : body, enc("\nendobj\n")));
  parts.push(enc(`trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** A stream object: its dictionary entries and its data. */
function stream(entries: string, data: Uint8Array): Uint8Array {
  return Buffer.concat([enc(`<< ${entries} /Length ${data.length} >>\nstream\n`), data, enc("\nendstream")]);
}

/** An image XObject: its dictionary entries and its data. */
const image = (entries: string, data: Uint8Array): Uint8Array => stream(`/Type /XObject /Subtype /Image ${entries}`, data);

/** A one-page PDF, object 4 its content and objects from 5 on `extra`. */
function onePage(content: string | Uint8Array, resources: string, extra: Uint8Array[] = []): Uint8Array {
  return pdfOf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << ${resources} >> >>`,
    stream("", typeof content === "string" ? enc(content) : content),
    ...extra,
  ]);
}

async function firstPage(bytes: Uint8Array): Promise<PdfPage> {
  return (await openPdf(bytes)).page(0);
}

// ---- reading PNGs back --------------------------------------------------------------------

/** zlib data inflated by the browser's stream type. */
async function unzlib(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(data as BufferSource).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

/** A PNG read back: its size, bit depth and colour type, its pixels row by row, and whether its checksums and row filters are right. */
async function readPng(png: Uint8Array): Promise<{ width: number; height: number; depth: number; colorType: number; px: Uint8Array; ok: boolean }> {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let ok = same(png.subarray(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 12 <= png.length; ) {
    const len = v.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + len);
    if (crc32(png.subarray(at + 4, at + 8 + len)) !== v.getUint32(at + 8 + len)) ok = false;
    if (type === "IHDR") {
      width = v.getUint32(at + 8);
      height = v.getUint32(at + 12);
      depth = body[8];
      colorType = body[9];
    } else if (type === "IDAT") idat.push(body);
    at += 12 + len;
  }
  const raw = await unzlib(Buffer.concat(idat));
  const ch = colorType === 6 ? 4 : 3;
  const row = width * ch;
  const px = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    // every row starts with its filter type, 0 (none) here
    if (raw[y * (row + 1)] !== 0) ok = false;
    px.set(raw.subarray(y * (row + 1) + 1, (y + 1) * (row + 1)), y * row);
  }
  return { width, height, depth, colorType, px, ok };
}

const pngOf = async (p: PdfPicture | undefined): Promise<Awaited<ReturnType<typeof readPng>> | null> => (p ? readPng(p.bytes) : null);

// ---- the samples -------------------------------------------------------------------------

/** a 2 by 2 RGB picture: red, green / blue, white */
const RGB = Uint8Array.of(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255);
/** its soft mask, one byte a pixel: opaque, half, clear, quarter */
const MASK = Uint8Array.of(255, 128, 0, 64);
/** a JPEG's first bytes and some more; not a whole picture, which the reader doesn't decode */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9]);
const FLATE = "/Filter /FlateDecode";

// ---- checks ------------------------------------------------------------------------------

{
  const page = await firstPage(
    onePage("q 100 0 0 50 10 20 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE} /SMask 6 0 R`, deflateSync(RGB)),
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray ${FLATE}`, deflateSync(MASK)),
    ]),
  );
  const p: PdfPicture | undefined = page.pictures[0];
  check(page.pictures.length === 1, "a flate RGB picture with a soft mask comes in as one picture");
  check(!!p && p.mime === "image/png" && p.width === 2 && p.height === 2, "it is a 2 by 2 PNG");
  check(boxIs(p, 10, 20, 110, 70), `it fills its box on the page, 10 20 110 70 (got ${boxOf(p)})`);
  const png = await pngOf(p);
  check(!!png && png.ok && png.colorType === 6 && png.depth === 8, "the PNG is 8-bit RGBA with its checksums and filters right");
  check(!!png && same(png.px, [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 64]), "its pixels and alpha are the picture's and its soft mask's");
}

{
  // a soft mask of another size is stretched over the picture
  const page = await firstPage(
    onePage("q 100 0 0 50 10 20 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE} /SMask 6 0 R`, deflateSync(RGB)),
      image(`/Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray ${FLATE}`, deflateSync(Uint8Array.of(128))),
    ]),
  );
  const png = await pngOf(page.pictures[0]);
  check(!!png && png.px.filter((_, i) => i % 4 === 3).every((a) => a === 128), "a 1 by 1 soft mask gives every pixel alpha 128");
}

{
  // a JPEG goes through as it is, at its dictionary's size
  const page = await firstPage(onePage("q 80 0 0 40 5 5 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image(`/Width 37 /Height 21 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode`, JPEG)]));
  const p: PdfPicture | undefined = page.pictures[0];
  check(page.pictures.length === 1 && p?.mime === "image/jpeg", "a JPEG comes in as a JPEG");
  check(!!p && same(p.bytes, JPEG) && p.width === 37 && p.height === 21, "its bytes are the file's, its size the dictionary's (37 by 21)");
  check(boxIs(p, 5, 5, 85, 45), `it fills its box (got ${boxOf(p)})`);
  check(p?.alpha === undefined, "without a soft mask it has no alpha");
}

{
  // a JPEG's soft mask comes back as an alpha plane, its size as the mask's
  const page = await firstPage(
    onePage("q 80 0 0 40 5 5 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image("/Width 37 /Height 21 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode /SMask 6 0 R", JPEG),
      image(`/Width 4 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceGray ${FLATE}`, deflateSync(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8))),
    ]),
  );
  const p: PdfPicture | undefined = page.pictures[0];
  check(!!p?.alpha && p.alpha.width === 4 && p.alpha.height === 2 && same(p.alpha.bytes, [1, 2, 3, 4, 5, 6, 7, 8]), "a JPEG's soft mask comes back as a 4 by 2 alpha plane");
  check(!!p && p.mime === "image/jpeg" && same(p.bytes, JPEG), "the JPEG itself is still untouched");
}

{
  // mirrored: the first is turned left to right, the second top to bottom
  const page = await firstPage(
    onePage("q -100 0 0 50 110 20 cm /Im1 Do Q q 100 0 0 -50 10 90 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE}`, deflateSync(RGB)),
    ]),
  );
  const [left, top]: (PdfPicture | undefined)[] = page.pictures;
  check(page.pictures.length === 2, "two mirrored pictures come in, in the order they are painted");
  check(boxIs(left, 10, 20, 110, 70) && boxIs(top, 10, 40, 110, 90), `each fills its own box (got ${boxOf(left)} and ${boxOf(top)})`);
  const a = await pngOf(left);
  const b = await pngOf(top);
  check(!!a && same(a.px, [0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]), "a picture mirrored across has its columns turned");
  check(!!b && same(b.px, [0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 0]), "a picture mirrored down has its rows turned");
}

{
  const page = await firstPage(onePage("q 80 0 0 -40 5 45 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image("/Width 37 /Height 21 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /DCTDecode", JPEG)]));
  check(page.pictures.length === 0 && page.skipped["flipped pictures"] === 1, "a mirrored JPEG is left out and counted as flipped");
}

{
  // b and c are not zero: the picture is turned
  const page = await firstPage(onePage("q 0 50 -100 0 150 10 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE}`, deflateSync(RGB))]));
  check(page.pictures.length === 0 && page.skipped["turned pictures"] === 1, "a turned picture is left out and counted as turned");
}

{
  // the form's matrix [2 0 0 2 10 5] over the picture's unit square at 5 5 to 35 25
  const page = await firstPage(
    onePage("q /Fm1 Do Q", "/XObject << /Fm1 5 0 R >>", [
      stream("/Type /XObject /Subtype /Form /BBox [0 0 200 100] /Matrix [2 0 0 2 10 5] /Resources << /XObject << /Im1 6 0 R >> >>", enc("30 0 0 20 5 5 cm /Im1 Do")),
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE}`, deflateSync(RGB)),
    ]),
  );
  check(boxIs(page.pictures[0], 20, 15, 80, 55), `a picture in a Form XObject takes the form's matrix (got ${boxOf(page.pictures[0])})`);
}

{
  // a white band, then a picture over it, then a line over both
  const page = await firstPage(
    onePage("1 g 0 50 100 50 re f q 80 0 0 40 10 55 cm /Im1 Do Q 0 G 0 0 m 100 100 l S", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE}`, deflateSync(RGB)),
    ]),
  );
  check(page.paths.length === 2 && page.pictures[0]?.over === 1, "a picture knows it was painted after the band and before the line");
}

{
  const page = await firstPage(onePage("q 20 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image("/Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceCMYK", new Uint8Array(8))]));
  check(page.pictures.length === 0 && page.skipped["pictures in other formats"] === 1, "a CMYK picture is left out and counted");
}

{
  const page = await firstPage(onePage("q 20 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image("/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB /Filter /JPXDecode", Uint8Array.of(0, 1, 2, 3))]));
  check(page.pictures.length === 0 && page.skipped["pictures in other formats"] === 1, "a JPEG 2000 picture is left out and counted");
}

{
  const page = await firstPage(onePage("q 20 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image("/Width 8 /Height 1 /ImageMask true", Uint8Array.of(0xaa))]));
  check(page.pictures.length === 0 && page.skipped["pictures in other formats"] === 1, "a stencil mask is left out and counted");
}

{
  // an inline picture: its 2 by 2 gray samples between ID and EI
  const inline = Buffer.concat([enc("q 20 0 0 10 0 0 cm BI /W 2 /H 2 /BPC 8 /CS /G ID "), Uint8Array.of(0x80, 0x40, 0x20, 0x10), enc(" EI Q")]);
  const page = await firstPage(onePage(inline, ""));
  check(page.pictures.length === 0 && page.skipped["inline pictures"] === 1, "an inline picture is left out and counted");
}

{
  // 1-bit gray: the first pixel is the high bit of 10101010
  const page = await firstPage(onePage("q 80 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image(`/Width 8 /Height 1 /BitsPerComponent 1 /ColorSpace /DeviceGray ${FLATE}`, deflateSync(Uint8Array.of(0xaa)))]));
  const png = await pngOf(page.pictures[0]);
  const expected = Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? 255 : 0)).flatMap((v) => [v, v, v]);
  check(!!png && png.colorType === 2 && png.ok && same(png.px, expected), "1-bit gray samples come out as black and white RGB");
}

{
  // an indexed space named in the resources: index 0 red, index 1 green
  const page = await firstPage(
    onePage("q 20 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >> /ColorSpace << /Cs1 [/Indexed /DeviceRGB 1 <ff000000ff00>] >>", [
      image(`/Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace /Cs1 ${FLATE}`, deflateSync(Uint8Array.of(0, 1))),
    ]),
  );
  const png = await pngOf(page.pictures[0]);
  check(!!png && same(png.px, [255, 0, 0, 0, 255, 0]), "indexed samples pick their palette colours, a space named in the resources");
}

{
  // an ICC profile of three components is RGB
  const page = await firstPage(
    onePage("q 20 0 0 10 0 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 1 /BitsPerComponent 8 /ColorSpace [/ICCBased 6 0 R] ${FLATE}`, deflateSync(Uint8Array.of(1, 2, 3, 4, 5, 6))),
      stream("/N 3", new Uint8Array(0)),
    ]),
  );
  const png = await pngOf(page.pictures[0]);
  check(!!png && same(png.px, [1, 2, 3, 4, 5, 6]), "an ICC profile with three components is read as RGB");
}

{
  const page = await firstPage(onePage("q 80 0 0 40 5 5 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [image("/Width 10000 /Height 5000 /BitsPerComponent 8 /ColorSpace /DeviceRGB", new Uint8Array(0))]));
  check(page.pictures.length === 0 && page.skipped["pictures too large"] === 1, "a picture of more than 40 million pixels is refused without being read");
}

{
  // paths come through beside the pictures, and a picture off the page is counted with the other things off it
  const page = await firstPage(
    onePage("0 0 m 200 100 l S q 100 0 0 50 10 20 cm /Im1 Do Q q 50 0 0 50 300 0 cm /Im1 Do Q", "/XObject << /Im1 5 0 R >>", [
      image(`/Width 2 /Height 2 /BitsPerComponent 8 /ColorSpace /DeviceRGB ${FLATE}`, deflateSync(RGB)),
    ]),
  );
  check(page.paths.length === 1 && page.pictures.length === 1 && page.skipped["off the page"] === 1, "a stroked line and one picture come in, the picture off the page is counted");
}

if (failures > 0) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
