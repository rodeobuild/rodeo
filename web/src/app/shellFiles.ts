// The desktop app's files as the browser's own File and FileSystemFileHandle objects.
//
// In the desktop app the page cannot reach a file's bytes directly: the shell (platform/shell.ts)
// reads and writes them for it, a byte range at a time, by the id the shell gave the file when the
// user chose it. The editor is written for the browser's file API, though: it opens a big drawing
// by slicing its File (blob.slice(a, b).arrayBuffer()) and saves by streaming to a handle's
// createWritable(). The classes here answer those same calls through the shell, so the rest of the
// editor works unchanged. A drawing (.vwx, .sta) stays on disk and is read a slice at a time; any
// other file is read into memory once, because the importers need real bytes. Outside the desktop
// app none of this is used.
//
// The same calls also reach the kept copies in the shell's recovery folder (crash recovery, see
// recovery.ts): a kept copy is a ShellSource read through kept_read, and KeptHandle writes one
// through kept_write_begin. Both kinds share the reading and writing code below.

import { type Shell, SHELL_CHANGED, SHELL_GONE, type ShellFile, type ShellFilter, type ShellKept, shell, shellErrorIs } from "../platform/shell.ts";

/** No single file_read asks the shell for more than this; larger ranges are read in steps and joined. */
const READ_STEP = 16 << 20;
/** No single write_chunk sends more than this. */
const WRITE_STEP = 8 << 20;

/** Drawings stay on disk; everything else is read into memory once. */
const DRAWING_NAME = /\.(vwx|sta)$/i;

/** The shell, which the callers here are only reached through when it is running. */
function shellOrThrow(): Shell {
  const s = shell();
  if (!s) throw new Error("The desktop shell is not running.");
  return s;
}

/** The shell's errors as the browser's file errors: a file that was changed or is gone. */
function fileError(err: unknown): unknown {
  if (shellErrorIs(err, SHELL_CHANGED)) return new DOMException("The file was changed on disk since it was read.", "NotReadableError");
  if (shellErrorIs(err, SHELL_GONE)) return new DOMException("The file is no longer there.", "NotFoundError");
  return err;
}

/** Awaits a shell call, translating its errors with fileError. */
async function guard<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (err) {
    throw fileError(err);
  }
}

/**
 * Where a shell-backed File or Blob reads its bytes: a file the user chose, or a kept copy. The
 * name, size and time are as they were when the source was made; `read` asks the shell for a range
 * and fails as the shell does once the file has changed or gone.
 */
export interface ShellSource {
  readonly name: string;
  readonly size: number;
  readonly modified: number;
  /** Bytes start..end, at most READ_STEP long. */
  read(start: number, end: number): Promise<Uint8Array>;
}

/** A file the user chose, as a source: its bytes are read by id, and refused once the file was written since. */
export function fileSource(ref: ShellFile): ShellSource {
  return {
    name: ref.name,
    size: ref.size,
    modified: ref.modified,
    read: (start, end) => guard(shellOrThrow().call("file_read", { id: ref.id, start, end, modified: ref.modified })),
  };
}

/** A kept copy as a source: its bytes are read by name. kept_read keeps no time, so the size and time are those it was listed with. */
function keptSource(kept: ShellKept): ShellSource {
  return {
    name: kept.name,
    size: kept.size,
    modified: kept.modified,
    read: (start, end) => guard(shellOrThrow().call("kept_read", { name: kept.name, start, end })),
  };
}

/** Bytes start..end of the source, read in steps of READ_STEP and joined. */
async function readRange(src: ShellSource, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const out = new Uint8Array(end - start);
  let at = start;
  while (at < end) {
    const stop = Math.min(end, at + READ_STEP);
    const part = await src.read(at, stop);
    // a short answer means the file no longer holds what it held when it was chosen
    if (part.length !== stop - at) throw fileError(new Error(SHELL_CHANGED));
    out.set(part, at - start);
    at = stop;
  }
  return out;
}

/** Blob.slice's rule for one bound: negative counts from the end, and the result is clamped into [0, size]. */
function bound(value: number | undefined, fallback: number, size: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  const whole = Number.isNaN(n) ? 0 : Math.trunc(n);
  return whole < 0 ? Math.max(size + whole, 0) : Math.min(whole, size);
}

/** The [from, to) that Blob.slice(start, end) of a blob of `size` bytes covers; to is never before from. */
function sliceBounds(size: number, start?: number, end?: number): [number, number] {
  const from = bound(start, 0, size);
  const to = bound(end, size, size);
  return [from, Math.max(to, from)];
}

/** A byte range [start, end) of a source. */
interface Span {
  readonly src: ShellSource;
  readonly start: number;
  readonly end: number;
}

async function bytesOfSpan(span: Span): Promise<Uint8Array<ArrayBuffer>> {
  return readRange(span.src, span.start, span.end);
}

function streamOfSpan(span: Span): ReadableStream<Uint8Array<ArrayBuffer>> {
  let at = span.start;
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    async pull(controller) {
      if (at >= span.end) {
        controller.close();
        return;
      }
      const stop = Math.min(span.end, at + READ_STEP);
      const bytes = await readRange(span.src, at, stop);
      at = stop;
      controller.enqueue(bytes);
    },
  });
}

/** A byte range [start, end) of a source, as a Blob. */
export class ShellBlob extends Blob {
  constructor(
    private readonly src: ShellSource,
    private readonly start: number,
    private readonly end: number,
    type = "",
  ) {
    super([], { type });
  }

  private span(): Span {
    return { src: this.src, start: this.start, end: this.end };
  }

  get size(): number {
    return this.end - this.start;
  }

  slice(start?: number, end?: number, contentType?: string): ShellBlob {
    const [from, to] = sliceBounds(this.size, start, end);
    return new ShellBlob(this.src, this.start + from, this.start + to, (contentType ?? "").toLowerCase());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await bytesOfSpan(this.span())).buffer;
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return bytesOfSpan(this.span());
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await bytesOfSpan(this.span()));
  }

  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return streamOfSpan(this.span());
  }
}

/** A shell source as a File: the whole of it, read a slice at a time. */
export class ShellBackedFile extends File {
  constructor(readonly src: ShellSource) {
    super([], src.name, { lastModified: src.modified, type: "application/octet-stream" });
  }

  private span(): Span {
    return { src: this.src, start: 0, end: this.src.size };
  }

  get size(): number {
    return this.src.size;
  }

  slice(start?: number, end?: number, contentType?: string): ShellBlob {
    const [from, to] = sliceBounds(this.src.size, start, end);
    return new ShellBlob(this.src, from, to, (contentType ?? "").toLowerCase());
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await bytesOfSpan(this.span())).buffer;
  }

  async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return bytesOfSpan(this.span());
  }

  async text(): Promise<string> {
    return new TextDecoder().decode(await bytesOfSpan(this.span()));
  }

  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return streamOfSpan(this.span());
  }
}

/** What a write takes: bytes or a Blob, or the browser's { type: "write", position, data } form. */
export type ShellWriteData = Blob | ArrayBuffer | ArrayBufferView | { type: "write"; position?: number; data: Blob | ArrayBuffer | ArrayBufferView };

/** Bytes of anything a write takes, copied into their own buffer. */
async function bytesOfData(data: Blob | ArrayBuffer | ArrayBufferView): Promise<Uint8Array<ArrayBuffer>> {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0));
  const out = new Uint8Array(data.byteLength);
  out.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return out;
}

/** The size and time a write committed as, once it is in its file's place. */
interface Committed {
  readonly size: number;
  readonly modified: number;
}

/**
 * A write in progress (createWritable's stream), for a chosen file or a kept copy alike: the shell
 * holds the bytes under `token` until close commits them. Writes go to the shell in the order they
 * were made; a write without a position goes at the cursor, which is the end of what has been
 * written unless a position moved it back.
 */
export class ShellWritable {
  private chain: Promise<void> = Promise.resolve();
  private cursor = 0;
  /** how many bytes the write holds so far (the file is written anew) */
  private length = 0;
  private failure: unknown = null;
  private done = false;

  constructor(
    private readonly token: string,
    /** told the file's new size and time once a commit has put the write in its place */
    private readonly committed: (result: Committed) => void,
  ) {}

  /** Queues one write; resolves once the shell has taken its bytes. */
  write(data: ShellWriteData): Promise<void> {
    const next = this.chain.then(() => this.put(data));
    this.chain = next.then(
      () => undefined,
      (err: unknown) => {
        this.failure ??= err;
      },
    );
    return next;
  }

  private async put(data: ShellWriteData): Promise<void> {
    if (this.done) throw new TypeError("The stream is already closed.");
    let position: number | undefined;
    let payload: Blob | ArrayBuffer | ArrayBufferView;
    if (data instanceof Blob || data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      payload = data;
    } else {
      position = data.position;
      payload = data.data;
    }
    const bytes = await bytesOfData(payload);
    const target = position ?? this.cursor;
    // at the end of the write the shell appends; anywhere else the bytes are written over what is there
    const append = target === this.length;
    for (let off = 0; off < bytes.length; off += WRITE_STEP) {
      const args: { write: string; at?: number } = append ? { write: this.token } : { write: this.token, at: target + off };
      await guard(shellOrThrow().call("write_chunk", args, bytes.subarray(off, off + WRITE_STEP)));
    }
    this.cursor = target + bytes.length;
    this.length = Math.max(this.length, this.cursor);
  }

  /** Commits the write in place of the file. Refused, and thrown away, when a write before it failed. */
  async close(): Promise<void> {
    if (this.done) return;
    await this.chain;
    if (this.failure) {
      await this.abort();
      throw this.failure;
    }
    this.done = true;
    const result = await guard(shellOrThrow().call("write_end", { write: this.token, commit: true }));
    if (result) this.committed(result);
  }

  /** Throws the write away; the file is left as it was. */
  async abort(): Promise<void> {
    if (this.done) return;
    await this.chain;
    this.done = true;
    await guard(shellOrThrow().call("write_end", { write: this.token, commit: false }));
  }
}

/**
 * A shell file's handle: the part of FileSystemFileHandle the editor uses. Its `ref` is the file as
 * the shell last described it; the shell gives a file the same id for the whole run.
 */
export class ShellHandle {
  readonly kind = "file" as const;
  /** the file as the shell last described it (its size and time move on each save) */
  ref: ShellFile;

  constructor(ref: ShellFile) {
    this.ref = ref;
  }

  get name(): string {
    return this.ref.name;
  }

  /** The file as it is now, as a new File (a file that is gone is a NotFoundError). */
  async getFile(): Promise<File> {
    const fresh = await guard(shellOrThrow().call("file_stat", { id: this.ref.id }));
    this.ref = fresh;
    return new ShellBackedFile(fileSource(fresh));
  }

  /** A stream that replaces the file's bytes when closed (see ShellWritable). */
  async createWritable(): Promise<ShellWritable> {
    const { write } = await guard(shellOrThrow().call("file_write_begin", { id: this.ref.id }));
    return new ShellWritable(write, (result) => {
      this.ref = { ...this.ref, size: result.size, modified: result.modified };
    });
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof ShellHandle && other.ref.id === this.ref.id;
  }

  async queryPermission(): Promise<"granted"> {
    return "granted";
  }

  async requestPermission(): Promise<"granted"> {
    return "granted";
  }
}

/**
 * A kept copy's handle, by its name in the shell's recovery folder: the same calls as ShellHandle,
 * with the names of kept_* in place of file ids. A kept copy has no path and no id of its own.
 */
export class KeptHandle {
  readonly kind = "file" as const;

  constructor(readonly name: string) {}

  /** The kept copy as it is now (a copy that is not kept is a NotFoundError). */
  async getFile(): Promise<File> {
    const found = (await keptList()).find((k) => k.name === this.name);
    if (!found) throw new DOMException("The file is no longer there.", "NotFoundError");
    return new ShellBackedFile(keptSource(found));
  }

  /** A stream that replaces the kept copy when closed. */
  async createWritable(): Promise<ShellWritable> {
    const { write } = await guard(shellOrThrow().call("kept_write_begin", { name: this.name }));
    return new ShellWritable(write, () => undefined);
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other instanceof KeptHandle && other.name === this.name;
  }

  async queryPermission(): Promise<"granted"> {
    return "granted";
  }

  async requestPermission(): Promise<"granted"> {
    return "granted";
  }
}

/** A ShellHandle or KeptHandle as the FileSystemFileHandle the editor's code is typed with. */
export function asHandle(h: ShellHandle | KeptHandle): FileSystemFileHandle {
  return h as unknown as FileSystemFileHandle;
}

/** The ShellHandle behind a handle, or null when it is a browser's handle. */
export function shellHandleOf(h: FileSystemFileHandle | null): ShellHandle | null {
  return h instanceof ShellHandle ? h : null;
}

/** The file as the editor reads it: a drawing on disk (a ShellBackedFile), anything else read into memory as a File. */
export async function fileFor(ref: ShellFile): Promise<File> {
  const src = fileSource(ref);
  if (DRAWING_NAME.test(ref.name)) return new ShellBackedFile(src);
  const bytes = await readRange(src, 0, ref.size);
  return new File([bytes], ref.name, { lastModified: ref.modified });
}

/** A file the user chose, as the name, File and handle the browser's picker gives. */
export async function picked(ref: ShellFile): Promise<{ name: string; file: File; handle: FileSystemFileHandle }> {
  const file = await fileFor(ref);
  return { name: ref.name, file, handle: asHandle(new ShellHandle(ref)) };
}

/** The shell's dialog filters for picker types: one per type, and an "All supported files" first when there are several. */
export function shellFilters(types: readonly { description?: string; accept: Record<string, string[]> }[]): ShellFilter[] {
  const extensionsOf = (patterns: readonly string[]): string[] => [...new Set(patterns.map((p) => p.replace(/^\.+/, "").toLowerCase()).filter((e) => e !== ""))];
  const filters: ShellFilter[] = types.map((t) => ({ name: t.description || "Files", extensions: extensionsOf(Object.values(t.accept).flat()) }));
  if (types.length <= 1) return filters;
  const everything = extensionsOf(filters.flatMap((f) => [...f.extensions]));
  return [{ name: "All supported files", extensions: everything }, ...filters];
}

// ---- kept copies (crash recovery) -------------------------------------------

/** The kept copies in the shell's recovery folder, with their sizes and times. */
export async function keptList(): Promise<ShellKept[]> {
  return guard(shellOrThrow().call("kept_list", {}));
}

/** Removes a kept copy. */
export async function keptRemove(name: string): Promise<void> {
  await guard(shellOrThrow().call("kept_remove", { name }));
}

/** Writes a whole small kept file (such as a copy's JSON), replacing any it had. */
export async function keptWriteSmall(name: string, bytes: Uint8Array): Promise<void> {
  const out = await new KeptHandle(name).createWritable();
  try {
    await out.write(bytes);
  } catch (err) {
    await out.abort().catch(() => undefined);
    throw err;
  }
  await out.close();
}

/** A whole small kept file's bytes, or null when no such file is kept. */
export async function keptReadSmall(name: string): Promise<Uint8Array | null> {
  const found = (await keptList()).find((k) => k.name === name);
  if (!found) return null;
  return readRange(keptSource(found), 0, found.size);
}
