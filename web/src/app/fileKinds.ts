// What a file the user gave is, from its first bytes as well as its name: a picture (JPEG, PNG, GIF,
// WebP, BMP, TIFF, HEIC/HEIF) that Open places in a new drawing (app.ts openPicture, imageImport.ts),
// a Vectorworks drawing (its "VectorWorks" header, which container.ts checks), or neither, which gets
// a plain message naming what Rodeo opens rather than the header error a drawing reader gives.

/** The first bytes a file is sniffed by: enough for the Vectorworks header (0x30 to 0x50) and any picture's signature. */
export const HEAD_BYTES = 0x50;

export type PictureKind = "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heif";

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

/** The picture a file's first bytes say it is, or null when they say no picture. */
export function pictureKindOf(head: Uint8Array): PictureKind | null {
  const at = (i: number, s: string): boolean => {
    for (let k = 0; k < s.length; k++) if (head[i + k] !== s.charCodeAt(k)) return false;
    return true;
  };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.length >= 8 && head[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "png";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "webp";
  // "BM", then the file's size, then two reserved zero words
  if (at(0, "BM") && head.length >= 10 && head[6] === 0 && head[7] === 0 && head[8] === 0 && head[9] === 0) return "bmp";
  if (at(0, "II*\0") || at(0, "MM\0*")) return "tiff";
  if (at(4, "ftyp") && head.length >= 12) {
    const brand = String.fromCharCode(...head.subarray(8, 12));
    if (HEIF_BRANDS.has(brand)) return "heif";
  }
  return null;
}

/** The name a picture kind goes by in a message. */
export const PICTURE_NAME: Record<PictureKind, string> = {
  jpeg: "JPEG",
  png: "PNG",
  gif: "GIF",
  webp: "WebP",
  bmp: "BMP",
  tiff: "TIFF",
  heif: "HEIC",
};

/** True when the header carries the Vectorworks signature container.ts looks for. */
export function looksLikeVectorworks(head: Uint8Array): boolean {
  let window = "";
  for (let i = 0x30; i < Math.min(HEAD_BYTES, head.length); i++) window += String.fromCharCode(head[i]);
  return window.includes("VectorWorks");
}

/** The kinds of file Rodeo opens, for a file it can't open. */
export const OPENS_KINDS = "Vectorworks drawings (.vwx, .sta), AutoCAD (.dwg, .dxf), Revit, Archicad, SketchUp, IFC, STEP and other 3D models, PDF, and pictures (JPEG, PNG, GIF, WebP, BMP)";

/** The message for a file with no reader here. */
export function notOpenable(name: string): string {
  return `Rodeo can't open ${name}. It opens ${OPENS_KINDS}.`;
}

/** The message when a picture kind the browser can't decode comes in, or null when the browser's failure is a plain one. */
export function undecodablePicture(kind: PictureKind | null): string | null {
  if (kind === "tiff" || kind === "heif") {
    return `This browser can't read ${PICTURE_NAME[kind]} pictures. Save the picture as JPEG or PNG and open that instead.`;
  }
  return null;
}

/** The first bytes of a file the user gave, read a slice at a time (a large drawing is not read whole). */
export async function headOf(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
}
