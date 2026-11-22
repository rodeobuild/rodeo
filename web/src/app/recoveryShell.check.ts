// Checks the desktop app's crash-recovery copies (recovery.ts, the kept store) against a fake shell held in
// memory: the drawing file then the JSON, what is offered, expiry, adoption, discard, failed writes and the
// 15-minute floor for big drawings. Under Node, with the real writer. Run from web/:
//   npx tsx src/app/recoveryShell.check.ts
// (recovery.check.ts is the browser's IndexedDB check and runs in a browser instead.)
// The fake shell is installed before the modules are imported, so they see the desktop shell as the app does.

type Entry = { bytes: Uint8Array; modified: number };
/** the kept copies, by file name */
const kept = new Map<string, Entry>();
const writes = new Map<string, { name: string; buf: Uint8Array }>();
/** each commit and removal, in order */
const log: string[] = [];
let clock = 1000;
let nextWrite = 1;
/** when set, the next write_chunk fails as a full disk does */
let failNextChunk = false;

/** Writes `chunk` at `at`, or appends when `at` is absent, growing the buffer as needed. */
function applyAt(buf: Uint8Array, at: number | undefined, chunk: Uint8Array): Uint8Array {
  const start = at ?? buf.length;
  const out = new Uint8Array(Math.max(buf.length, start + chunk.length));
  out.set(buf);
  out.set(chunk, start);
  return out;
}

const fakeShell = {
  call: async (command: string, args: unknown, bytes?: Uint8Array): Promise<unknown> => {
    const a = args as Record<string, unknown>;
    switch (command) {
      case "kept_list":
        return [...kept].map(([name, e]) => ({ name, size: e.bytes.length, modified: e.modified }));
      case "kept_read": {
        const e = kept.get(a.name as string);
        if (!e) throw new Error("gone");
        return e.bytes.slice(a.start as number, a.end as number);
      }
      case "kept_write_begin": {
        const token = `w${nextWrite++}`;
        writes.set(token, { name: a.name as string, buf: new Uint8Array(0) });
        return { write: token };
      }
      case "write_chunk": {
        const w = writes.get(a.write as string);
        if (!w || !bytes) throw new Error("no such write");
        if (failNextChunk) {
          failNextChunk = false;
          throw new Error("disk full");
        }
        w.buf = applyAt(w.buf, a.at as number | undefined, bytes);
        return null;
      }
      case "write_end": {
        const token = a.write as string;
        const w = writes.get(token);
        if (!w) throw new Error("no such write");
        writes.delete(token);
        if (!a.commit) return null;
        const e = { bytes: w.buf, modified: ++clock };
        kept.set(w.name, e);
        log.push(`commit ${w.name}`);
        return { size: e.bytes.length, modified: e.modified };
      }
      case "kept_remove": {
        if (!kept.delete(a.name as string)) throw new Error("gone");
        log.push(`remove ${a.name as string}`);
        return null;
      }
      default:
        throw new Error(`fake shell has no ${command}`);
    }
  },
  on: (): (() => void) => () => undefined,
};

(globalThis as { __rodeoShell?: unknown }).__rodeoShell = fakeShell;

// imported only now, once the fake is in place
const { blankDrawing } = await import("../core/blank.ts");
const { openVwx } = await import("../core/index.ts");
const { HOLD_FROM } = await import("./writeOut.ts");
const { Recovery, RECOVERY_MAX_AGE, backupKeys, deleteBackupIfUnchanged, expireBackups, withRecovery } = await import("./recovery.ts");
type Backup = import("./recovery.ts").KeptBackup;

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(a, b) === 0;
}

/** The keys of every copy, sorted. */
async function keys(): Promise<string[]> {
  return (await backupKeys()).map(String).sort();
}

/** The copy offered under key, or null when none is offered (an incomplete or absent copy). */
async function offeredUnder(key: string): Promise<Backup | null> {
  const got: Backup[] = [];
  await withRecovery(key, async (b) => {
    if ("file" in b) got.push(b);
  });
  return got[0] ?? null;
}

/** A new drawing, dirty, with one line added. */
function drawing(): ReturnType<typeof openVwx> {
  const s = openVwx(blankDrawing("mm"));
  s.markUnsaved();
  return s;
}

function addLine(s: ReturnType<typeof openVwx>): void {
  s.addObjects(s.doc.layers()[0].id, [{ kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 20 } }]);
}

const T0 = 1_000_000_000;
const settings = (minutes = 1, maxBytes: number | null = 100) => ({ enabled: true, minutes, maxBytes });
const BIG_INFO = { name: "Plan.vwx", size: 10_000_000_000 };

// ---- one copy: the drawing, then its JSON ----
const clockNow = { t: T0 };
const r1 = new Recovery(() => settings(1, 100), () => clockNow.t);
const sessionA = drawing();
r1.track(sessionA, () => BIG_INFO);
log.length = 0;
check(await r1.copy(sessionA), "a copy of a drawing far over maxBytes is made in the desktop app (no size refusal)");
const copyKeys = await keys();
check(copyKeys.length === 1, `one copy is two files under one key, keys: ${copyKeys.join(",")}`);
const K1 = copyKeys[0];
check(log.join("|") === `commit ${K1}.vwx|commit ${K1}.json`, `the drawing is committed first, then the JSON, log: ${log.join("|")}`);
check(kept.has(`${K1}.json`), "the JSON is written after the drawing");
const jsonText = new TextDecoder().decode(kept.get(`${K1}.json`)!.bytes);
check(jsonText === JSON.stringify({ name: "Plan.vwx", savedAt: T0 }), `the JSON holds the name and time: ${jsonText}`);
check(same(kept.get(`${K1}.vwx`)!.bytes, sessionA.doc.toBytes()), "the kept drawing's bytes are the drawing's (toBytes)");

// the copy is offered back, and opens as the drawing
const offered = await offeredUnder(K1);
check(offered !== null && offered.name === "Plan.vwx" && offered.savedAt === T0, "a complete copy is offered with its name and time");
check(offered !== null && offered.size === kept.get(`${K1}.vwx`)!.bytes.length, "the offered copy's size is the kept drawing's");
if (offered) {
  const reopened = openVwx(new Uint8Array(await offered.file.arrayBuffer()));
  check(same(reopened.doc.toBytes(), sessionA.doc.toBytes()), "the offered file reads back as the drawing");
}

// ---- unfinished copies are not offered ----
kept.set("22222222-0000-4000-8000-000000000002.vwx", { bytes: blankDrawing("mm"), modified: clock });
kept.set("33333333-0000-4000-8000-000000000003.json", { bytes: new TextEncoder().encode('{"name":"x","savedAt":5}'), modified: clock });
check((await offeredUnder("22222222-0000-4000-8000-000000000002")) === null, "a drawing without its JSON is not offered");
check((await offeredUnder("33333333-0000-4000-8000-000000000003")) === null, "a JSON without its drawing is not offered");
check((await keys()).includes("22222222-0000-4000-8000-000000000002"), "an unfinished copy is still listed, so expiry can see it");
kept.delete("22222222-0000-4000-8000-000000000002.vwx");
kept.delete("33333333-0000-4000-8000-000000000003.json");

// ---- a failed write keeps the copy pending and the next copy is made ----
const sessionF = drawing();
r1.track(sessionF, () => ({ name: "Fail.vwx", size: 1000 }));
const before = (await keys()).join();
failNextChunk = true;
check((await r1.copy(sessionF)) === false, "a copy that fails to write reports failure");
check((await keys()).join() === before, "a failed write leaves no new copy");
check(await r1.copy(sessionF), "the next copy succeeds once the disk takes it");
check((await keys()).length === 2, "the copy that succeeded is kept beside the first");
await r1.forget(sessionF);
check((await keys()).join() === before, "closing that drawing removes its copy and leaves the first");

// ---- adoption: a drawing opened from its kept copy takes it over ----
const r2 = new Recovery(() => settings(1, null), () => clockNow.t);
const recovered = await (async () => {
  const b = await offeredUnder(K1);
  if (!b) throw new Error("no copy to recover");
  const s = openVwx(new Uint8Array(await b.file.arrayBuffer()));
  s.markUnsaved();
  r2.track(s, () => ({ name: b.name, size: b.size }));
  r2.adopt(s, K1);
  return s;
})();
const beforeAdopt = kept.get(`${K1}.vwx`)!.bytes;
addLine(recovered);
clockNow.t = T0 + 61_000;
check(await r2.copy(recovered), "an adopted drawing's next copy is made");
check((await keys()).join() === K1, `adoption replaces the same copy, keys: ${(await keys()).join(",")}`);
check(!same(kept.get(`${K1}.vwx`)!.bytes, beforeAdopt), "the adopted copy's drawing file is replaced by the newer drawing");
check(same(kept.get(`${K1}.vwx`)!.bytes, recovered.doc.toBytes()), "the replaced drawing file holds the drawing as it is now");
await r2.forget(recovered);
check((await keys()).length === 0, "closing the adopted drawing removes both of its files");
check(!kept.has(`${K1}.vwx`) && !kept.has(`${K1}.json`), "no kept file is left behind after the adopted drawing closes");

// ---- expiry: old pairs and old orphans go; new pairs and fresh orphans stay ----
const rOld = new Recovery(() => settings(1, null), () => T0);
const sA = drawing();
rOld.track(sA, () => ({ name: "Old.vwx", size: 1000 }));
await rOld.copy(sA);
const oldKey = (await keys())[0];
const rNew = new Recovery(() => settings(1, null), () => T0 + RECOVERY_MAX_AGE);
const sB = drawing();
rNew.track(sB, () => ({ name: "New.vwx", size: 1000 }));
await rNew.copy(sB);
const newKey = (await keys()).find((k) => k !== oldKey)!;
kept.set("44444444-0000-4000-8000-000000000004.vwx", { bytes: blankDrawing("mm"), modified: 1 });
kept.set("55555555-0000-4000-8000-000000000005.vwx", { bytes: blankDrawing("mm"), modified: T0 + RECOVERY_MAX_AGE });
kept.set("66666666-0000-4000-8000-000000000006.json", { bytes: new TextEncoder().encode('{"name":"gone","savedAt":1}'), modified: 1 });
await expireBackups(T0 + RECOVERY_MAX_AGE + 1);
const afterExpiry = await keys();
check(afterExpiry.join() === [newKey, "55555555-0000-4000-8000-000000000005"].sort().join(), `expiry keeps the new pair and the fresh orphan, keys: ${afterExpiry.join(",")}`);
check(!kept.has(`${oldKey}.vwx`) && !kept.has(`${oldKey}.json`), "expiry removes an old pair's both files");
check(!kept.has("44444444-0000-4000-8000-000000000004.vwx"), "expiry removes an old orphan drawing");
check(!kept.has("66666666-0000-4000-8000-000000000006.json"), "expiry removes an old orphan JSON");
check(kept.has("55555555-0000-4000-8000-000000000005.vwx"), "expiry keeps a fresh orphan drawing");
kept.delete("55555555-0000-4000-8000-000000000005.vwx");

// ---- discard: only the copy that was offered is removed ----
const offer = await offeredUnder(newKey);
check(offer !== null, "the new pair is still offered before the discard test");
if (offer) {
  await deleteBackupIfUnchanged(newKey, { ...offer, modified: offer.modified - 1 });
  check((await keys()).includes(newKey), "a copy changed since it was offered is not removed");
  await deleteBackupIfUnchanged(newKey, offer);
  check(!(await keys()).includes(newKey), "the offered copy is removed");
}

// ---- the 15-minute floor for drawings of 256 MB or more (desktop app only) ----
const clockBig = { t: T0 };
const rBig = new Recovery(() => settings(1, null), () => clockBig.t);
const big = drawing();
rBig.track(big, () => ({ name: "Huge.vwx", size: HOLD_FROM }));
clockBig.t = T0 + 61_000;
await rBig.tick();
check((await keys()).length === 0, "a drawing of 256 MB is not copied a minute after its start");
clockBig.t = T0 + 14 * 60_000;
await rBig.tick();
check((await keys()).length === 0, "a drawing of 256 MB is not copied before 15 minutes");
clockBig.t = T0 + 15 * 60_000;
await rBig.tick();
check((await keys()).length === 1, "a drawing of 256 MB is copied at 15 minutes");
await rBig.forget(big);
await rNew.forget(sB);
// a small drawing is copied on its own interval: one minute, not the floor
const tSmall = { t: T0 + 100 * 60_000 };
const rSmall = new Recovery(() => settings(1, null), () => tSmall.t);
const smallSession = drawing();
rSmall.track(smallSession, () => ({ name: "Small.vwx", size: 1000 }));
tSmall.t += 61_000;
await rSmall.tick();
check((await keys()).length === 1, "a small drawing is copied after one minute, not held to the floor");
await rSmall.forget(smallSession);
check((await keys()).length === 0, "nothing is left kept after the checks");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all recoveryShell checks passed");

export {};
