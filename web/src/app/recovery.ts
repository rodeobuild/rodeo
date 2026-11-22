// Recovery storage and per-session scheduling, independent of the active drawing and UI.
//
// Two stores keep the copies, chosen once when the page loads. In a browser a copy is the drawing's
// bytes in IndexedDB, so a drawing must fit in memory twice and have no parts left in its file
// (autosave.ts limits it). In the desktop app a copy is two files in the shell's recovery folder:
// K.vwx, the drawing streamed out by writeToFile, and then K.json with its name and time. Neither
// limit applies there. A copy with only one of the two files is unfinished: it is not offered, and
// it expires by its file times.
import { type EditSession, FileStream, heldTables } from "../core/index.ts";
import { shell } from "../platform/shell.ts";
import { asHandle, KeptHandle, keptList, keptReadSmall, keptRemove, keptWriteSmall } from "./shellFiles.ts";
import { HOLD_FROM, sameFile, writeToFile } from "./writeOut.ts";

/** A browser copy: the drawing's bytes, kept in the browser's storage. */
export interface Backup {
  name: string;
  bytes: Uint8Array;
  savedAt: number;
}

/** A desktop copy: the drawing's file in the shell's recovery folder, read when it is opened, with its size and time as they were then. */
export interface KeptBackup {
  name: string;
  savedAt: number;
  size: number;
  modified: number;
  file: File;
}

/** A copy as it is offered: a browser's, or the desktop app's. */
export type AnyBackup = Backup | KeptBackup;

const DB = "openvwx-autosave";
const STORE = "backups";
export const RECOVERY_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
/** A drawing this big is copied at most this often, whatever the preference says (the desktop app only; it takes real disk time). */
const BIG_COPY_MINUTES = 15;

async function request<T>(mode: IDBTransactionMode, make: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = make(tx.objectStore(STORE));
      // A request can succeed before its transaction aborts, for example at the quota limit.
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error ?? new Error("Recovery transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("Recovery transaction failed"));
    });
  } finally {
    db.close();
  }
}

export async function readBackup(key: IDBValidKey): Promise<Backup | null> {
  const b = await request("readonly", s => s.get(key)) as Backup | undefined;
  return b && typeof b.name === "string" && b.bytes instanceof Uint8Array ? b : null;
}
export const writeBackup = (key: IDBValidKey, b: Backup): Promise<IDBValidKey> => request("readwrite", s => s.put(b, key));
export const deleteBackup = (key: IDBValidKey): Promise<undefined> => request("readwrite", s => s.delete(key));
const lockName = (key: IDBValidKey): string => `rodeo-recovery:${String(key)}`;

/**
 * Calls use with the copy's lock held (exclusive) where Web Locks can give it, and without it where
 * they cannot: a browser that denies them still gets its copies read.
 */
async function locked(key: IDBValidKey, use: (exclusive: boolean) => Promise<void>): Promise<void> {
  if (!navigator.locks) return use(false); // cleanup compares the offered snapshot atomically
  let started = false;
  try {
    await navigator.locks.request(lockName(key), { ifAvailable: true }, async lock => {
      started = true;
      if (lock) await use(true);
    });
  } catch (err) {
    // the browser denied Web Locks before the lock was asked for: read without it, as a browser without them does
    if (started) throw err;
    console.warn("openvwx: Web Locks were denied, so recovery copies are read without the lock", err);
    await use(false);
  }
}

/** Active windows hold a lock per drawing, so another window won't offer or delete its backup. */
export async function withRecovery(key: IDBValidKey, use: (b: AnyBackup, exclusive: boolean) => Promise<void>): Promise<void> {
  await locked(key, async (exclusive) => {
    const b = await store.read(key);
    if (b) await use(b, exclusive);
  });
}

/**
 * A Web Lock on a copy's key, held until released. `ready` resolves once it is held; where the
 * browser denies Web Locks it resolves at once, and nothing waits on the lock.
 */
function holdLock(key: string): { ready: Promise<void>; release: () => void } {
  let release = (): void => {};
  const ready = navigator.locks ? new Promise<void>((resolve) => {
    const held = new Promise<void>(done => release = done);
    void navigator.locks.request(lockName(key), async () => {
      resolve();
      await held;
    }).catch((err: unknown) => {
      console.warn("openvwx: Web Locks were denied, so this drawing's recovery copies are not locked", err);
      resolve();
    });
  }) : Promise.resolve();
  return { ready, release };
}

interface Entry {
  key: string;
  session: EditSession;
  info: () => { name: string; size: number };
  off: () => void;
  release: () => void;
  ready: Promise<void>;
  chain: Promise<unknown>;
  active: boolean;
  pending: boolean;
  wasDirty: boolean;
  writing: boolean;
  revision: number;
  lastEdit: number;
  lastCopy: number;
}

export class Recovery {
  private readonly entries = new Map<EditSession, Entry>();
  constructor(
    private readonly settings: () => { enabled: boolean; minutes: number; maxBytes: number | null },
    private readonly now: () => number = Date.now,
  ) {}

  track(session: EditSession, info: Entry["info"]): void {
    if (this.entries.has(session)) return;
    const key = crypto.randomUUID();
    // Where the browser denies Web Locks, copies go on without the lock: nothing waits on it.
    const lock = holdLock(key);
    const e: Entry = {
      key, session, info, ready: lock.ready, release: lock.release,
      chain: Promise.resolve(),
      active: true,
      pending: session.dirty,
      wasDirty: session.dirty,
      writing: false,
      revision: 0,
      lastEdit: this.now(),
      lastCopy: this.now(),
      off: () => {},
    };
    this.entries.set(session, e);
    e.off = session.onChange(() => {
      e.revision++;
      e.pending = session.dirty;
      e.lastEdit = this.now();
      if (e.wasDirty && !session.dirty) void this.queue(e, () => store.remove(e.key)).catch(() => {});
      e.wasDirty = session.dirty;
    });
  }

  /** Only after a drawing is closed/replaced, including any discard confirmation. */
  async forget(session: EditSession): Promise<void> {
    const e = this.entries.get(session);
    if (!e) return;
    e.active = false;
    e.off();
    this.entries.delete(session);
    await this.queue(e, () => store.remove(e.key)).catch(() => {}).finally(e.release);
  }

  /**
   * Makes the copy under `key` the one `session` keeps from now on. A drawing opened from its kept
   * copy reads its big parts from that file, so the next copy replaces the same file, and closing
   * or saving the drawing removes it as it does any copy. The lock on the session's own key is let
   * go, and one taken on `key`: it waits until the caller's lock on `key` is released.
   */
  adopt(session: EditSession, key: IDBValidKey): void {
    const e = this.entries.get(session);
    if (!e) return;
    e.release();
    const lock = holdLock(String(key));
    e.key = String(key);
    e.ready = lock.ready;
    e.release = lock.release;
  }

  private queue<T>(e: Entry, job: () => Promise<T>): Promise<T> {
    const run = e.chain.then(() => e.ready).then(job);
    e.chain = run.catch(() => {});
    return run;
  }

  /** Immediate copy. */
  async copy(session: EditSession): Promise<boolean> {
    const e = this.entries.get(session);
    if (!e || !e.active || !session.dirty || e.writing) return false;
    const info = e.info();
    // a browser copy holds the drawing's bytes in memory, so a big one or one with parts still in its file is left out
    const limit = shell() ? null : this.settings().maxBytes;
    if (limit !== null && (info.size > limit || session.doc.holdsParts())) return false;
    e.writing = true;
    const revision = e.revision;
    const now = this.now();
    try {
      const written = await this.queue(e, async () => {
        if (!e.active || !session.dirty) return false;
        await store.write(e.key, session, info.name, now);
        return true;
      });
      if (written && revision === e.revision) e.pending = false;
      return written;
    } catch {
      // Storage full/blocked: retain pending and retry next interval.
      return false;
    } finally {
      e.lastCopy = now;
      e.writing = false;
    }
  }

  async tick(): Promise<void> {
    const p = this.settings();
    if (!p.enabled) return;
    for (const e of this.entries.values()) {
      const minutes = bigKept(e) ? Math.max(p.minutes, BIG_COPY_MINUTES) : p.minutes;
      if (!e.writing && e.pending && this.now() - e.lastCopy >= minutes * 60_000 && this.now() - e.lastEdit >= 5_000) {
        // Rotate candidates so excluded or continuously edited drawings cannot starve others.
        this.entries.delete(e.session);
        this.entries.set(e.session, e);
        await this.copy(e.session);
        return;
      }
    }
  }

  async settled(): Promise<void> {
    await Promise.all([...this.entries.values()].map(e => e.chain));
  }
}

/** Whether a drawing is big enough to be copied at most every BIG_COPY_MINUTES (desktop app only). */
function bigKept(e: Entry): boolean {
  return shell() !== null && e.info().size >= HOLD_FROM;
}

/** Compare and delete in one transaction, including on browsers without Web Locks.
 * A copy updated while its dialog was open must survive recovery or dismissal.
 */
export async function deleteBackupIfUnchanged(key: IDBValidKey, offered: AnyBackup): Promise<void> {
  await store.removeIfUnchanged(key, offered);
}

/** Active windows remain protected by their locks; old abandoned copies expire at startup. */
export async function expireBackups(now = Date.now()): Promise<void> {
  await store.expire(now);
}

/** The keys of every copy kept (in the desktop app, the base name of each kept file). */
export const backupKeys = (): Promise<IDBValidKey[]> => store.keys();

/** Where copies are kept: IndexedDB in a browser, the desktop app's recovery folder in the shell. */
interface RecoveryStore {
  keys(): Promise<IDBValidKey[]>;
  read(key: IDBValidKey): Promise<AnyBackup | null>;
  /** Keeps `session`'s drawing as the copy under key, saved at savedAt. */
  write(key: IDBValidKey, session: EditSession, name: string, savedAt: number): Promise<void>;
  remove(key: IDBValidKey): Promise<void>;
  /** Removes the copy under key only while it is still `offered`. */
  removeIfUnchanged(key: IDBValidKey, offered: AnyBackup): Promise<void>;
  /** Removes the copies saved before now less RECOVERY_MAX_AGE. */
  expire(now: number): Promise<void>;
}

const browserStore: RecoveryStore = {
  keys: () => request("readonly", s => s.getAllKeys()),
  read: readBackup,
  write: async (key, session, name, savedAt) => {
    await writeBackup(key, { name, bytes: session.doc.toBytes(), savedAt });
  },
  remove: async (key) => {
    await deleteBackup(key);
  },
  removeIfUnchanged: async (key, offered) => {
    if ("bytes" in offered) await deleteBrowserBackupIfUnchanged(key, offered);
  },
  expire: async (now) => {
    for (const key of await browserStore.keys()) {
      await withRecovery(key, async backup => {
        if (backup.savedAt < now - RECOVERY_MAX_AGE) await deleteBackupIfUnchanged(key, backup);
      });
    }
  },
};

/** The browser's compare-and-delete: one transaction, so a copy updated meanwhile survives. */
async function deleteBrowserBackupIfUnchanged(key: IDBValidKey, offered: Backup): Promise<void> {
  await request("readwrite", s => {
    const req = s.get(key);
    req.onsuccess = () => {
      const current = req.result as Backup | undefined;
      if (current?.savedAt === offered.savedAt && current.name === offered.name &&
          current.bytes.length === offered.bytes.length &&
          current.bytes.every((byte, i) => byte === offered.bytes[i])) s.delete(key);
    };
    return req;
  });
}

/** The base name of a kept copy's file ("K" for "K.vwx" or "K.json"), or null for any other name. */
function baseOf(name: string): string | null {
  const m = /^(.+)\.(vwx|json)$/.exec(name);
  return m ? m[1] : null;
}

/** The base names of the kept copies: each copy is named by its key, and may have one or both of its files. */
async function keptBases(): Promise<string[]> {
  const bases = new Set<string>();
  for (const k of await keptList()) {
    const base = baseOf(k.name);
    if (base !== null) bases.add(base);
  }
  return [...bases];
}

/** Whether an error is the shell's "no such file", as a file's NotFoundError. */
function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

/** The kept JSON of a copy (its drawing's name and time), or null when there is none or it is not as written. */
async function keptMeta(base: string): Promise<{ name: string; savedAt: number } | null> {
  const bytes = await keptReadSmall(`${base}.json`);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes)) as { name?: unknown; savedAt?: unknown } | null;
    return typeof v?.name === "string" && typeof v.savedAt === "number" ? { name: v.name, savedAt: v.savedAt } : null;
  } catch {
    return null;
  }
}

/** A complete kept copy, or null when it has only one of its files, or its JSON is not as written. */
async function readKept(key: IDBValidKey): Promise<KeptBackup | null> {
  const base = String(key);
  const names = (await keptList()).map(k => k.name);
  if (!names.includes(`${base}.vwx`) || !names.includes(`${base}.json`)) return null;
  const meta = await keptMeta(base);
  if (!meta) return null;
  try {
    const file = await new KeptHandle(`${base}.vwx`).getFile();
    return { name: meta.name, savedAt: meta.savedAt, size: file.size, modified: file.lastModified, file };
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Loads into memory every held part still read from `file`, so the file can be replaced or removed
 * without the drawing that reads them losing them.
 */
export async function releaseHeldFrom(file: File): Promise<void> {
  for (const table of heldTables()) {
    for (const entry of table.entries) {
      const from = entry.from;
      if (from instanceof FileStream && sameFile(from.file, file)) await entry.load();
    }
  }
}

/** Removes a kept copy's files: its drawing first (after releaseHeldFrom), then its JSON. */
async function removeKept(base: string): Promise<void> {
  const names = (await keptList()).map(k => k.name);
  if (names.includes(`${base}.vwx`)) {
    const file = await new KeptHandle(`${base}.vwx`).getFile().catch((err: unknown) => {
      if (isNotFound(err)) return null;
      throw err;
    });
    if (file) await releaseHeldFrom(file);
    await keptRemove(`${base}.vwx`).catch((err: unknown) => {
      if (!isNotFound(err)) throw err;
    });
  }
  if (names.includes(`${base}.json`)) {
    await keptRemove(`${base}.json`).catch((err: unknown) => {
      if (!isNotFound(err)) throw err;
    });
  }
}

const keptStore: RecoveryStore = {
  keys: keptBases,
  read: readKept,
  write: async (key, session, name, savedAt) => {
    const base = String(key);
    // the drawing first: a JSON without its drawing would name a file that is not there
    await writeToFile(session, asHandle(new KeptHandle(`${base}.vwx`)), { follow: false });
    await keptWriteSmall(`${base}.json`, new TextEncoder().encode(JSON.stringify({ name, savedAt })));
  },
  remove: (key) => removeKept(String(key)),
  removeIfUnchanged: async (key, offered) => {
    if (!("file" in offered)) return;
    const now = await readKept(key);
    if (now && now.name === offered.name && now.savedAt === offered.savedAt && now.size === offered.size && now.modified === offered.modified) {
      await removeKept(String(key));
    }
  },
  expire: async (now) => {
    for (const base of await keptBases()) {
      await locked(base, async () => {
        const files = await keptList();
        const drawing = files.find(k => k.name === `${base}.vwx`);
        const json = files.find(k => k.name === `${base}.json`);
        if (!drawing && !json) return;
        // a complete copy is as old as it was saved; an unfinished one by its files' times
        const meta = drawing && json ? await keptMeta(base) : null;
        const time = meta ? meta.savedAt : Math.max(drawing?.modified ?? 0, json?.modified ?? 0);
        if (time < now - RECOVERY_MAX_AGE) await removeKept(base);
      });
    }
  },
};

/** The store copies are kept in, chosen once when the page loads: the desktop app's recovery folder, or the browser's storage. */
const store: RecoveryStore = shell() ? keptStore : browserStore;
