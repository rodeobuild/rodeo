// The scripts a drawing keeps in its own script palettes (Vectorworks keeps them in the file, not in
// the application). A script palette is a type-51 record in the class list (57), beside the record
// formats; its name index names it, and its children are its scripts. A script is a type-49 record
// whose body is a u64 length (the record's size less 0x58), one flag byte (0x5f in the sample) and then
// the text to the end of the record: 8-bit text, LF line ends, no terminator. Its name index names it.
// Layouts other than this one (an 89-byte type-49 with a type-43 child, in the 2023-2025 demo files)
// are not text and are skipped.
//
// Nothing here runs a script or writes the drawing. The feature decides each script's language.

import { guidOf, type Model } from "./model.ts";
import type { Rec } from "./records.ts";

const PALETTE = 51;
const SCRIPT = 49;
/** the u64 length is at +0x50; the flag byte at +0x58; the text from +0x59 */
const LENGTH_AT = 0x50;
const TEXT_AT = 0x59;
/** the length counts the bytes after its own eight: record size less this */
const LENGTH_OFFSET = 0x58;

/** One script a drawing keeps: its GUID, its name, the palette it sits in (null when unnamed), and its text. */
export interface DocumentScript {
  readonly id: string;
  readonly name: string;
  readonly palette: string | null;
  readonly text: string;
}

/** The script's text, or null when the record is not one in the layout above. */
function textOf(r: Rec): string | null {
  const d = r.data;
  if (d.length <= TEXT_AT) return null;
  const declared = new DataView(d.buffer, d.byteOffset, d.byteLength).getBigUint64(LENGTH_AT, true);
  if (declared !== BigInt(d.length - LENGTH_OFFSET)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(d.subarray(TEXT_AT));
  } catch {
    // not UTF-8: not text that a script could have been saved as
    return null;
  }
  // a binary blob, not text
  return text.includes("\u0000") ? null : text;
}

const cache = new WeakMap<Rec[], readonly DocumentScript[]>();

/**
 * Every script the drawing keeps in a script palette, palette by palette in the class list's order.
 * Only the class list's palette records and their children are read, not every record; the list is
 * kept while the drawing's records stay the same.
 */
export function documentScripts(model: Model): readonly DocumentScript[] {
  const cached = cache.get(model.recs);
  if (cached) return cached;
  const out: DocumentScript[] = [];
  for (const palette of model.classList?.children ?? []) {
    if (palette.type !== PALETTE) continue;
    const paletteName = model.names.get(palette.nameIndex) || null;
    for (const r of palette.children) {
      if (r.type !== SCRIPT) continue;
      const text = textOf(r);
      if (text === null) continue;
      out.push({ id: guidOf(r), name: model.names.get(r.nameIndex) || "Script", palette: paletteName, text });
    }
  }
  cache.set(model.recs, out);
  return out;
}
