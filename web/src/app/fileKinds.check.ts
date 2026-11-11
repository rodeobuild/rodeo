// Checks the sniffing of files the user gave (fileKinds.ts), the reader stop messages
// (readerFailure.ts) and the older Archicad version named in a header (archicadImport.ts), under Node.
// Run from web/: npx tsx src/app/fileKinds.check.ts
import { pictureKindOf, looksLikeVectorworks, notOpenable, undecodablePicture, HEAD_BYTES } from "./fileKinds.ts";
import { isReaderStop, readerMessage } from "./readerFailure.ts";
import { olderArchicadVersion } from "./archicadImport.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b);
const text = (s: string): Uint8Array => new TextEncoder().encode(s);
const pad = (b: Uint8Array, n = HEAD_BYTES): Uint8Array => {
  const out = new Uint8Array(n);
  out.set(b.subarray(0, n));
  return out;
};

check(pictureKindOf(bytes(0xff, 0xd8, 0xff, 0xe0)) === "jpeg", "JPEG by its SOI marker");
check(pictureKindOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0)) === "png", "PNG by its signature");
check(pictureKindOf(text("GIF89a....")) === "gif", "GIF87a/89a");
check(pictureKindOf(pad(text("RIFF\0\0\0\0WEBPVP8 "))) === "webp", "WebP by RIFF...WEBP");
check(pictureKindOf(pad(text("RIFF\0\0\0\0WAVEfmt "))) === null, "RIFF WAVE is not a picture");
check(pictureKindOf(pad(bytes(0x42, 0x4d, 0x36, 0, 0, 0, 0, 0, 0, 0))) === "bmp", "BMP with zero reserved words");
check(pictureKindOf(text("II*\0\x08\0\0\0")) === "tiff", "little-endian TIFF");
check(pictureKindOf(text("MM\0*\0\0\0\x08")) === "tiff", "big-endian TIFF");
check(pictureKindOf(pad(text("\0\0\0\x18ftypheic\0\0\0\0"))) === "heif", "HEIC by its ftyp brand");
check(pictureKindOf(pad(text("\0\0\0\x18ftypmif1\0\0\0\0"))) === "heif", "HEIF (mif1)");
check(pictureKindOf(pad(text("\0\0\0\x18ftypqt  \0\0\0\0"))) === null, "a QuickTime movie is not a picture");
check(pictureKindOf(text("notes")) === null, "plain text is not a picture");
check(pictureKindOf(new Uint8Array(0)) === null, "an empty file is not a picture");

const vw = pad(text("\0".repeat(0x30) + "VectorWorks 2024 "));
check(looksLikeVectorworks(vw), "a Vectorworks header is recognised");
check(!looksLikeVectorworks(pad(text("\xff\xd8\xff\xe0 no header here"))), "a JPEG is not a Vectorworks file");

check(notOpenable("notes.xyz") === "Rodeo can't open notes.xyz. It opens Vectorworks drawings (.vwx, .sta), AutoCAD (.dwg, .dxf), Revit, Archicad, SketchUp, IFC, STEP and other 3D models, PDF, and pictures (JPEG, PNG, GIF, WebP, BMP).", "refusal names what Rodeo opens");
check(!/signature/.test(notOpenable("x.bin")), "the refusal never says signature");
check(undecodablePicture("heif")?.includes("HEIC") === true, "HEIC that the browser can't read is named");
check(undecodablePicture("tiff")?.includes("TIFF") === true, "TIFF that the browser can't read is named");
check(undecodablePicture("jpeg") === null, "a JPEG the browser fails on keeps the browser's message");

check(isReaderStop("unreachable"), "wasm trap: unreachable");
check(isReaderStop("RuntimeError: memory access out of bounds"), "wasm trap: memory access");
check(isReaderStop("Uncaught RuntimeError: table index is out of bounds"), "uncaught RuntimeError");
check(isReaderStop(""), "an empty worker error is a stop");
check(!isReaderStop("it isn't an Archicad 17 or later file"), "a reader's own message is kept");
check(readerMessage("Revit", "unreachable") === "Rodeo's Revit reader stopped on this file. Send it with Help > Report a Bug… so we can fix it.", "Revit trap reads plainly");
check(readerMessage("Revit", "not a Revit file") === "not a Revit file", "a Revit message that is not a trap passes");

const older = (s: string): number | null => olderArchicadVersion(new TextEncoder().encode(s));
check(older("MM\0\0 ArchiCAD 15 project") === 15, "an older file's version is read from its header text");
check(older("ArchiCAD 9") === 9, "a one-digit version");
check(older("ArchiCAD 17") === null, "17 and later are not 'older'");
check(older("nothing here") === null, "no version named");
check(older("archicad\u0000v12") === 12, "a version after a NUL");

if (failures) {
  console.log(`${failures} FAILED`);
  process.exitCode = 1;
} else console.log("all ok");
