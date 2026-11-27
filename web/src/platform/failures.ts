// Files that would not open, put together by why. A report sent from the card after a failed open
// (features/feedback/check.ts) carries the file's name and the error the person was told; the
// server files it under the group this gives (server/src/feedback.ts), so the admin page can show
// how many people wait on each failure and tell them all once it is fixed. Two files fail the same
// way when their kind is the same and their errors differ only in numbers and names: "bad chunk 2
// at 0xad0" and "bad chunk 3 at 0x9a4" are one failure, while the year a Vectorworks file was saved
// in is kept, so 2010 and 2007 files are two.

/** "DWG": a file's kind, from its name ("file" when it has no extension). */
export function fileKind(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase() : "file";
}

/** `error` with the file's own name taken out, as the card sends it: the name is the person's, not the failure's. */
export function withoutName(error: string, name: string): string {
  let out = error;
  const base = name.replace(/\.[^.]+$/, "");
  for (const n of [name, base]) if (n.length >= 2) out = out.split(n).join("…");
  return out;
}

/** The group a failure is filed under: "VWX: bad chunk # at 0x#: truncated". */
export function failureGroup(kind: string, error: string): string {
  const text = error
    .replace(/[“"][^”"]{0,200}[”"]/g, "…")
    // an offset is marked first, so the numbers after it don't take its 0
    .replace(/\b0x[0-9a-f]+\b/gi, "\u0001")
    .replace(/\b[0-9a-f]{12,}\b/gi, "#")
    .replace(/\d+(?:[.,]\d+)*/g, (n) => (/^(19|20)\d\d$/.test(n) ? n : "#"))
    .replaceAll("\u0001", "0x#")
    .replace(/\s+/g, " ")
    .trim();
  return `${kind}: ${text}`.slice(0, 200);
}
