// Checks the desktop shell's files as the browser's File and handle objects (shellFiles.ts) against a
// fake shell held in memory: the byte stepping, Blob.slice's rules, the errors, writes and the
// filters. Under Node. Run from web/: npx tsx src/app/shellFiles.check.ts
// The fake is installed before shell.ts is imported, so the page sees it as the desktop shell does.

type Entry = { name: string; bytes: Uint8Array; modified: number };
const files = new Map<string, Entry>();
const writes = new Map<string, { id?: string; kept?: string; buf: Uint8Array }>();
const kept = new Map<string, Entry>();
let clock = 1000;
let nextWrite = 1;
let writeChunkCalls = 0;
let writeChunkSizes: number[] = [];
let readCalls = 0;

/** Writes `chunk` at `at`, or appends when `at` is absent, growing the buffer as needed. */
function applyAt(buf: Uint8Array, at: number | undefined, chunk: Uint8Array): Uint8Array {
  const start = at ?? buf.length;
  const out = new Uint8Array(Math.max(buf.length, start + chunk.length));
  out.set(buf);
  out.set(chunk, start);
  return out;
}

function entry(id: string): Entry {
  const e = files.get(id);
  if (!e) throw new Error("gone");
  return e;
}

const fakeShell = {
  call: async (command: string, args: unknown, bytes?: Uint8Array): Promise<unknown> => {
    const a = args as Record<string, unknown>;
    switch (command) {
      case "file_stat": {
        const id = a.id as string;
        const e = entry(id);
        return { id, name: e.name, size: e.bytes.length, modified: e.modified, folder: "/fake" };
      }
      case "file_read": {
        const id = a.id as string;
        const e = entry(id);
        if (a.modified !== undefined && a.modified !== e.modified) throw new Error("changed");
        const start = a.start as number;
        const end = a.end as number;
        if (end - start > 16 << 20) throw new Error(`file_read asked for ${end - start} bytes, over 16 MB`);
        readCalls++;
        return e.bytes.slice(start, end);
      }
      case "file_write_begin": {
        const id = a.id as string;
        entry(id);
        const token = `w${nextWrite++}`;
        writes.set(token, { id, buf: new Uint8Array(0) });
        return { write: token };
      }
      case "kept_list":
        return [...kept].map(([name, e]) => ({ name, size: e.bytes.length, modified: e.modified }));
      case "kept_read": {
        const e = kept.get(a.name as string);
        if (!e) throw new Error("gone");
        const start = a.start as number;
        const end = a.end as number;
        readCalls++;
        return e.bytes.slice(start, end);
      }
      case "kept_write_begin": {
        const token = `w${nextWrite++}`;
        writes.set(token, { kept: a.name as string, buf: new Uint8Array(0) });
        return { write: token };
      }
      case "kept_remove": {
        if (!kept.delete(a.name as string)) throw new Error("gone");
        return null;
      }
      case "write_chunk": {
        const w = writes.get(a.write as string);
        if (!w || !bytes) throw new Error("no such write");
        writeChunkCalls++;
        writeChunkSizes.push(bytes.length);
        w.buf = applyAt(w.buf, a.at as number | undefined, bytes);
        return null;
      }
      case "write_end": {
        const token = a.write as string;
        const w = writes.get(token);
        if (!w) throw new Error("no such write");
        writes.delete(token);
        if (!a.commit) return null;
        if (w.kept !== undefined) {
          const k = { name: w.kept, bytes: w.buf, modified: ++clock };
          kept.set(w.kept, k);
          return { size: k.bytes.length, modified: k.modified };
        }
        const e = entry(w.id!);
        e.bytes = w.buf;
        e.modified = ++clock;
        return { size: e.bytes.length, modified: e.modified };
      }
      default:
        throw new Error(`fake shell has no ${command}`);
    }
  },
  on: (): (() => void) => () => undefined,
};

(globalThis as { __rodeoShell?: unknown }).__rodeoShell = fakeShell;

// imported only now, once the fake is in place
const { ShellBackedFile, ShellBlob, ShellHandle, asHandle, fileFor, fileSource, picked, shellFilters, shellHandleOf } = await import("./shellFiles.ts");
const { shell } = await import("../platform/shell.ts");

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** Whether two byte sequences are the same bytes. */
function same(a: Uint8Array | ArrayBuffer, b: Uint8Array | ArrayBuffer): boolean {
  const x = a instanceof ArrayBuffer ? new Uint8Array(a) : a;
  const y = b instanceof ArrayBuffer ? new Uint8Array(b) : b;
  return x.length === y.length && Buffer.compare(x, y) === 0;
}

/** `base` with `chunk` written over it at `at`, growing it as a write does. */
function overlay(base: Uint8Array, at: number, chunk: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(base.length, at + chunk.length));
  out.set(base);
  out.set(chunk, at);
  return out;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<{ bytes: Uint8Array; largest: number }> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let largest = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    largest = Math.max(largest, value.length);
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { bytes, largest };
}

function isDomError(err: unknown, name: string): boolean {
  return err instanceof DOMException && err.name === name;
}

async function rejectsWith(p: Promise<unknown>, name: string): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (err) {
    return isDomError(err, name);
  }
}

// ---- fixtures ----
const N = 40 << 20;
const BIG = new Uint8Array(N);
for (let i = 0; i < N; i++) BIG[i] = (i * 31 + 7) & 255;
const REAL = new Blob([BIG]);

files.set("f1", { name: "big.vwx", bytes: BIG, modified: 1000 });
files.set("f3", { name: "out.vwx", bytes: new TextEncoder().encode("OLD OLD OLD"), modified: 500 });
files.set("f4", { name: "cube.vwx", bytes: Uint8Array.of(1, 2, 3), modified: 600 });
files.set("f5", { name: "keep.vwx", bytes: new TextEncoder().encode("KEEP ME"), modified: 700 });
files.set("f6", { name: "plan.dxf", bytes: Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 3) & 255), modified: 800 });
files.set("f7", { name: "note.vwx", bytes: new TextEncoder().encode("héllo ✓"), modified: 900 });

const bigRef = { id: "f1", name: "big.vwx", size: N, modified: 1000, folder: "/fake" };
const big = new ShellBackedFile(fileSource(bigRef));

// ---- ShellBackedFile: the File the editor reads ----
check(shell() !== null, "shell() is the fake while the checks run");
check(big instanceof File, "ShellBackedFile is a File");
check(big instanceof Blob, "ShellBackedFile is a Blob");
check(big.size === N, `size is ${N}`);
check(big.name === "big.vwx", "name is the file's name");
check(big.lastModified === 1000, "lastModified is the file's time");

const bounds: [number | undefined, number | undefined][] = [
  [undefined, undefined],
  [0, 10],
  [-10, -5],
  [5, 20],
  [-5, undefined],
  [undefined, -5],
  [20, 10],
  [-1e12, 5],
  [5, 1e12],
  [NaN, 3],
  [3.7, 9.2],
  [N - 3, undefined],
  [N + 10, N + 20],
  [-N - 5, 7],
  [(16 << 20) - 2, (16 << 20) + 5],
];
let sliceOk = true;
for (const [s, e] of bounds) {
  const mine = big.slice(s, e);
  const want = REAL.slice(s, e);
  const ok = mine instanceof Blob && mine instanceof ShellBlob && mine.size === want.size && same(await mine.arrayBuffer(), await want.arrayBuffer());
  if (!ok) {
    sliceOk = false;
    console.log(`     slice(${s}, ${e}) differs: size ${mine.size} against ${want.size}`);
  }
}
check(sliceOk, `slice matches Blob.slice for ${bounds.length} (start, end) pairs, negatives, out of range, reversed and undefined`);

const chained = big.slice(5, 20).slice(3, 8);
check(same(await chained.arrayBuffer(), BIG.subarray(8, 13)), "slice(5, 20).slice(3, 8) holds bytes 8..13");
check(chained.size === 5, "the chained slice is 5 bytes");

const readsBefore = readCalls;
const whole = await big.arrayBuffer();
check(same(whole, BIG), "arrayBuffer() of the 40 MB file equals its bytes (read in steps)");
check(readCalls - readsBefore === 3, `the 40 MB read took 3 file_read calls (16 MB steps), took ${readCalls - readsBefore}`);

const streamed = await readAll(big.stream());
check(same(streamed.bytes, BIG), "stream() concatenation equals the file's bytes");
check(streamed.largest <= 16 << 20, "stream() pieces are at most 16 MB");

const note = new ShellBackedFile(fileSource({ id: "f7", name: "note.vwx", size: files.get("f7")!.bytes.length, modified: 900, folder: "/fake" }));
check((await note.text()) === "héllo ✓", "text() decodes the file as UTF-8");
check(same(await note.bytes(), new TextEncoder().encode("héllo ✓")), "bytes() gives the file's bytes");

// ---- picked: a drawing stays on disk, another file is read into memory ----
const plan = await picked({ id: "f6", name: "plan.dxf", size: 300, modified: 800, folder: "/fake" });
check(plan.name === "plan.dxf" && plan.file instanceof File && !(plan.file instanceof ShellBackedFile), "a DXF is read into a real File");
check(same(await plan.file.arrayBuffer(), files.get("f6")!.bytes), "the DXF's bytes are its file's bytes");
check(plan.file.lastModified === 800, "the DXF's File keeps its time");
const drawing = await picked(bigRef);
check(drawing.file instanceof ShellBackedFile, "a drawing is a ShellBackedFile, left on disk");

// ---- errors ----
const f5 = new ShellHandle({ id: "f5", name: "keep.vwx", size: 7, modified: 700, folder: "/fake" });
const keepFile = await f5.getFile();
check(keepFile instanceof ShellBackedFile && keepFile.size === 7, "getFile gives a ShellBackedFile of the file's size");

files.get("f1")!.modified = 2000;
check(await rejectsWith(big.slice(0, 10).arrayBuffer(), "NotReadableError"), "a read after the file changed on disk is a NotReadableError");
check(await rejectsWith(big.arrayBuffer(), "NotReadableError"), "a whole-file read after a change is a NotReadableError");
files.get("f1")!.modified = 1000;

files.set("gone", { name: "gone.vwx", bytes: new Uint8Array(4), modified: 1 });
const goneHandle = new ShellHandle({ id: "gone", name: "gone.vwx", size: 4, modified: 1, folder: "/fake" });
files.delete("gone");
check(await rejectsWith(goneHandle.getFile(), "NotFoundError"), "getFile of a removed file is a NotFoundError");

// ---- ShellHandle writes ----
const h3 = new ShellHandle({ id: "f3", name: "out.vwx", size: 11, modified: 500, folder: "/fake" });
const w3 = await h3.createWritable();
const A = Uint8Array.of(1, 2, 3, 4, 5, 6);
const B = Uint8Array.of(7, 8, 9, 10);
const C = Uint8Array.of(90, 91, 92);
const D = new Blob([Uint8Array.of(9, 9)]);
await w3.write(A);
await w3.write(B);
check(same(files.get("f3")!.bytes, new TextEncoder().encode("OLD OLD OLD")), "the file is untouched before the write is closed");
await w3.write({ type: "write", position: 0, data: C });
await w3.write(D);
await w3.close();
const expected3 = overlay(overlay(overlay(new Uint8Array(0), 0, A), 6, B), 0, C);
const expected3final = overlay(expected3, 3, Uint8Array.of(9, 9));
check(same(files.get("f3")!.bytes, expected3final), "positioned and Blob writes land where the browser's stream puts them");
check(h3.ref.size === expected3final.length && h3.ref.modified > 500, "the handle takes the file's new size and time on close");
const after3 = await h3.getFile();
check(after3.size === expected3final.length && after3.lastModified === h3.ref.modified, "getFile then reports the new size and time");
await w3.close();
check(same(files.get("f3")!.bytes, expected3final), "a second close does nothing");

// a 20 MB single write goes in chunks of at most 8 MB
const h4 = new ShellHandle({ id: "f4", name: "cube.vwx", size: 3, modified: 600, folder: "/fake" });
const w4 = await h4.createWritable();
const chunksBefore = writeChunkCalls;
writeChunkSizes = [];
const twenty = BIG.subarray(0, 20 << 20);
await w4.write(twenty);
check(writeChunkCalls - chunksBefore === 3, `a 20 MB write is 3 write_chunk calls, was ${writeChunkCalls - chunksBefore}`);
check(writeChunkSizes.every((n) => n <= 8 << 20) && writeChunkSizes.join() === [8 << 20, 8 << 20, 4 << 20].join(), "the chunks are 8, 8 and 4 MB");
await w4.close();
check(same(files.get("f4")!.bytes, twenty), "the 20 MB write is the file's bytes after close");

// abort leaves the file as it was
const h5 = new ShellHandle({ id: "f5", name: "keep.vwx", size: 7, modified: 700, folder: "/fake" });
const w5 = await h5.createWritable();
await w5.write(new TextEncoder().encode("THROWN AWAY"));
await w5.abort();
check(same(files.get("f5")!.bytes, new TextEncoder().encode("KEEP ME")), "abort leaves the old bytes");
await w5.abort();
await w5.close();
check(same(files.get("f5")!.bytes, new TextEncoder().encode("KEEP ME")), "close after abort does nothing");

// isSameEntry
const sameAs = new ShellHandle({ id: "f3", name: "out.vwx", size: 1, modified: 1, folder: "/fake" });
const other = new ShellHandle({ id: "f9", name: "other.vwx", size: 1, modified: 1, folder: "/fake" });
check(await h3.isSameEntry(sameAs), "two handles of one id are the same entry");
check(!(await h3.isSameEntry(other)), "handles of other ids are not");
check(!(await h3.isSameEntry({})), "a non-shell handle is not");
check(shellHandleOf(asHandle(h3)) === h3, "shellHandleOf gives back the ShellHandle");
check(shellHandleOf(null) === null, "shellHandleOf(null) is null");
check((await h3.queryPermission()) === "granted" && (await h3.requestPermission()) === "granted", "permission is granted");
check(h3.kind === "file" && h3.name === "out.vwx", "kind and name as a file handle");

// fileFor directly
const drawFile = await fileFor({ id: "f7", name: "note.vwx", size: 10, modified: 900, folder: "/fake" });
check(drawFile instanceof ShellBackedFile, "fileFor a .VWX-style name is a ShellBackedFile");

// ---- shellFilters ----
const drawings = shellFilters([
  { description: "Vectorworks drawing", accept: { "application/octet-stream": [".vwx"] } },
  { description: "Vectorworks template", accept: { "application/octet-stream": [".sta"] } },
]);
check(
  JSON.stringify(drawings) ===
    JSON.stringify([
      { name: "All supported files", extensions: ["vwx", "sta"] },
      { name: "Vectorworks drawing", extensions: ["vwx"] },
      { name: "Vectorworks template", extensions: ["sta"] },
    ]),
  "shellFilters: an 'All supported files' filter first, then one per type, dots removed",
);
const single = shellFilters([{ accept: { "image/jpeg": [".JPG", ".jpeg", ".jpg"] } }]);
check(JSON.stringify(single) === JSON.stringify([{ name: "Files", extensions: ["jpg", "jpeg"] }]), "one type: no 'All' filter, no description gives 'Files', lower case and no repeats");

// ---- kept copies (crash recovery) ----
const { KeptHandle, keptList, keptReadSmall, keptRemove, keptWriteSmall } = await import("./shellFiles.ts");

const json = new TextEncoder().encode('{"name":"Plan.vwx","savedAt":42}');
await keptWriteSmall("k1.json", json);
check(same((await keptReadSmall("k1.json"))!, json), "keptWriteSmall then keptReadSmall gives the same bytes");
check((await keptReadSmall("missing.json")) === null, "keptReadSmall of a name not kept is null");
const listed = (await keptList()).find((k) => k.name === "k1.json");
check(listed !== undefined && listed.size === json.length && listed.modified > 0, "keptList gives each kept file's size and time");

const kh = new KeptHandle("k2.vwx");
check(await rejectsWith(kh.getFile(), "NotFoundError"), "getFile of a kept name not kept is a NotFoundError");
const kw = await kh.createWritable();
await kw.write(BIG.subarray(0, 20 << 20));
await kw.write(BIG.subarray(20 << 20, N));
check(await rejectsWith(kh.getFile(), "NotFoundError"), "a kept write is not visible before it is closed");
await kw.close();
const kf = await kh.getFile();
check(kf instanceof ShellBackedFile && kf.size === N && kf.name === "k2.vwx", "a closed kept write is a File of its size and name");
check(same(await kf.arrayBuffer(), BIG), "a kept file reads back as the bytes written");
check(same(await kf.slice(10, 20).arrayBuffer(), BIG.subarray(10, 20)), "a slice of a kept file reads its bytes");
const kstream = await readAll(kf.stream());
check(same(kstream.bytes, BIG) && kstream.largest <= 16 << 20, "a kept file streams in pieces of at most 16 MB");

const kw2 = await kh.createWritable();
await kw2.write(new TextEncoder().encode("THROWN AWAY"));
await kw2.abort();
check(same(await (await kh.getFile()).slice(0, 5).arrayBuffer(), BIG.subarray(0, 5)), "abort leaves the kept file as it was");

check(await kh.isSameEntry(new KeptHandle("k2.vwx")) && !(await kh.isSameEntry(new KeptHandle("k3.vwx"))), "kept handles are the same entry by name");
check(await kh.isSameEntry(new KeptHandle("k2.vwx")) && !(await kh.isSameEntry(h3)), "a kept handle is not the same entry as a chosen file");
check(shellHandleOf(asHandle(kh)) === null, "a kept handle is not a ShellHandle");

await keptRemove("k2.vwx");
check(await rejectsWith(kh.getFile(), "NotFoundError"), "keptRemove removes the kept file");
check((await keptList()).every((k) => k.name !== "k2.vwx"), "a removed kept file is no longer listed");
await keptRemove("k1.json");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all shellFiles checks passed");

export {};
