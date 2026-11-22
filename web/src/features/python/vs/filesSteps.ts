// (steps, snapshot parts and host answers of files.ts: see steps.ts)
//
// The editor's side of a script's files: the file picker a script's GetFile calls open, the web
// address OpenURL opens in a new tab, and the files a run leaves in its out/ folder, which are
// downloaded when the run ends without error.

import { downloadBlob } from "../../../app/fileio.ts";
import { h } from "../../../app/dom.ts";
import { toast } from "../../../app/toast.ts";
import { registerHost, registerResult } from "../steps.ts";

/** The most a script may read from the user, in bytes (files.ts's _FILE_LIMIT). */
const LIMIT = 50 * 1024 * 1024;

/** A file a script gets from the picker, or the reason it can't: null when cancelled. */
type Picked = { name: string; base64: string } | { error: string } | null;

/** The file types of a mask (vs's GetFileN: "vwx", "vwx;txt", "*.txt" or "") as the picker's accept list. */
function accepts(mask: string): string {
  return mask
    .split(";")
    .map((m) => m.trim().replace(/^\*?\.?/, ""))
    .filter((m) => m !== "")
    .map((m) => `.${m}`)
    .join(",");
}

/** The base64 text of bytes, read as the picker reads them. */
function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read."));
    reader.readAsDataURL(blob);
  });
}

/** The file the user picks; resolves null when the picker is cancelled. */
function pick(title: string, accept: string): Promise<Picked> {
  return new Promise((resolve) => {
    const input = h("input", { attrs: { type: "file", accept } });
    let settled = false;
    const finish = (v: Picked): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    input.addEventListener("change", () => {
      const f = input.files?.[0];
      if (!f) {
        finish(null);
        return;
      }
      if (f.size > LIMIT) {
        finish({ error: `${f.name} is ${Math.round(f.size / (1024 * 1024))} MB. A script can read files up to 50 MB.` });
        return;
      }
      base64Of(f).then(
        (base64) => finish({ name: f.name, base64 }),
        (err: unknown) => finish({ error: `${f.name} couldn't be read: ${err instanceof Error ? err.message : String(err)}` }),
      );
    });
    input.addEventListener("cancel", () => finish(null));
    toast(title, "info");
    input.click();
  });
}

registerHost("OpenFile", async (args) => {
  const [title = "", mask = ""] = args;
  return pick(title || "Choose a file", accepts(mask));
});

registerHost("OpenURL", async (args) => {
  const url = args[0] ?? "";
  // only web addresses: a script's OpenURL of a file or another scheme is refused before it gets here
  if (!/^https?:\/\//i.test(url)) return false;
  const w = window.open(url, "_blank");
  if (w) w.opener = null;
  return w !== null;
});

/** The bytes of a base64 text. */
function bytesOf(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

registerResult((result) => {
  const files = result.files as { name: string; base64: string }[] | undefined;
  if (!files) return;
  // one download each: the browser may ask to allow several at once
  for (const f of files) downloadBlob(f.name, new Blob([bytesOf(f.base64)]));
});
