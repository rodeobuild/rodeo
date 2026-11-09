// Checks the timelapse's replay against the editor: opens a drawing, records its changes with
// the same hooks the recorder uses (onStep) while making a dozen edits (one of them a class and an
// object in it, as an agent's script makes), then rebuilds the drawing from the opening bytes and
// the recorded history. The replayed bytes must equal the edited drawing's bytes after every edit
// it is checked at (the midpoint and the end), when seeking back, and when the history is applied
// with EditSession.applyRemote as collaboration does. A step spanning most of the drawing must be
// kept as the runs it changed, and random changes far apart must rebuild from their runs. It also
// checks that a saved drawing reopens to the bytes it was saved as, which continuing a history
// relies on, and that a replay in the same page leaves the open drawing's records where that
// drawing has them, so an edit made after scrubbing changes what it names.
//
// Run: cd web && npx tsx src/features/timelapse/check.ts ../samples/sample.vwx

import { readFileSync } from "node:fs";
import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type EditSession, type NewShape, type Pt } from "../../core/index.ts";
import type { Model } from "../../core/model.ts";
import { applyOp, historyOp, runsOf, sha256Hex, type HistoryOp } from "./history.ts";
import { Replayer } from "./replay.ts";

const path = process.argv[2] ?? "../samples/sample.vwx";
let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

/** The first design layer with drawable objects, and up to n of its ids. */
function pick(s: EditSession, n: number): { layer: string; ids: string[] } {
  const layer = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.shape && o.shape.kind !== "text"));
  if (!layer) throw new Error("no design layer with objects");
  const ids = s.doc.objects(layer.id).filter((o) => o.shape && o.shape.kind !== "text" && !o.id.includes("/")).map((o) => o.id);
  return { layer: layer.id, ids: ids.slice(0, n) };
}

const bytes = new Uint8Array(readFileSync(path));
const start = openVwx(bytes, "check.vwx").doc.toBytes();
expect("opening bytes re-serialise to themselves", same(openVwx(start, "check.vwx").doc.toBytes(), start));

// record the edits the way the recorder does
const session = openVwx(start, "check.vwx");
const ops: HistoryOp[] = [];
const unlisten = session.onStep((op) => ops.push(historyOp(op, Date.now())));
const { layer, ids } = pick(session, 8);
const at = (x: number, y: number): Pt => ({ x, y });
const rect = (x: number, y: number): NewShape => ({ kind: "rect", x0: x, y0: y, x1: x + 400, y1: y + 300 });
const line = (x: number, y: number): NewShape => ({ kind: "line", a: at(x, y), b: at(x + 900, y + 500) });

const edits: (() => void)[] = [
  () => session.addObject(layer, rect(-2000, -2000)),
  () => session.moveObjects([ids[0]], 100, 0),
  () => session.addObject(layer, line(-2000, 1000)),
  () => session.moveObjects([ids[1]], 0, -50),
  () => session.undo(),
  () => session.moveObjects([ids[2]], 20, 20),
  () => session.addObject(layer, rect(3000, -1000)),
  () => session.moveObjects([ids[3], ids[4]], 5, 5),
  () => session.undo(),
  () => session.addObject(layer, line(3000, 2000)),
  // as an agent's script does: a class near the top of the file and an object in it at its end, one step
  () => session.batch(() => session.addObject(layer, rect(-4000, 0), session.createClass("Timelapse check"))),
  () => session.undo(),
  () => session.redo(),
];

// after each edit: the history length and the drawing's bytes
const snaps: { ops: number; bytes: Uint8Array }[] = [];
for (const edit of edits) {
  edit();
  snaps.push({ ops: ops.length, bytes: session.doc.toBytes() });
}
unlisten();
expect("the edits recorded as ops", ops.length >= 11 && ops.length <= edits.length, `${ops.length} ops`);

// replay from the opening bytes
const replay = new Replayer(start, ops, "check.vwx");
const end = snaps.at(-1)!;
replay.seek(end.ops);
expect("replay at the end equals the edited drawing", same(replay.doc.toBytes(), end.bytes));

const mid = snaps[Math.floor(snaps.length / 2)];
replay.seek(mid.ops);
expect("replay at the midpoint equals the drawing then", same(replay.doc.toBytes(), mid.bytes), `after ${mid.ops} ops`);

replay.seek(end.ops);
expect("seeking forward again after seeking back", same(replay.doc.toBytes(), end.bytes));

replay.seek(0);
expect("replay at 0 equals the opening bytes", same(replay.doc.toBytes(), start));

// the collaboration path: applyRemote per op must give the same drawing
const remote = openVwx(start, "check.vwx");
for (const op of ops) for (const r of runsOf(op)) remote.applyRemote({ start: r.start, del: r.del, add: [...r.add], kind: op.kind, ids: [...op.ids] });
expect("applyRemote of every op equals the replay", same(remote.doc.toBytes(), end.bytes));

// a step spanning the drawing keeps only the runs it changed, and they rebuild the same records
const wide = ops.filter((op) => op.more);
const kept = (op: HistoryOp): number => runsOf(op).reduce((n, r) => n + r.add.length, 0);
if (wide.length) expect("a step spanning the drawing is kept as its changed runs", wide.every((op) => kept(op) < 50), wide.map((op) => `${runsOf(op).length} runs of ${kept(op)} records`).join(", "));
else console.log("(no step here spans a thousand records, the drawing being small: the random changes below check the runs)");
let seed = 7;
const rnd = (n: number): number => {
  seed = (seed * 16807) % 2147483647;
  return seed % n;
};
const record = (): Uint8Array => new Uint8Array([rnd(256)]);
let runsOk = true;
let compact = true;
for (let trial = 0; trial < 200; trial++) {
  const before = Array.from({ length: 2000 + rnd(3000) }, record);
  const after = before.slice();
  // a few changes far apart: inserts, deletes and replacements, some longer than the runs look ahead
  const fresh = new Set<Uint8Array>();
  const put = (n: number): Uint8Array[] => {
    const list = Array.from({ length: n }, record);
    for (const d of list) fresh.add(d);
    return list;
  };
  for (let c = 1 + rnd(5); c > 0; c--) {
    const at = rnd(after.length);
    const what = rnd(5);
    if (what === 0) after.splice(at, 0, ...put(1 + rnd(4)));
    else if (what === 1) after.splice(at, 1 + rnd(4));
    else if (what === 2) after.splice(at, 1, ...put(1));
    else if (what === 3) after.splice(at, 0, ...put(70 + rnd(200)));
    else after.splice(at, 70 + rnd(200));
  }
  let s = 0;
  while (s < before.length && s < after.length && before[s] === after[s]) s++;
  let eb = before.length;
  let ea = after.length;
  while (eb > s && ea > s && before[eb - 1] === after[ea - 1]) {
    eb--;
    ea--;
  }
  const op = historyOp({ start: s, del: eb - s, add: after.slice(s, ea), removed: before.slice(s, eb), kind: "objects", ids: [] }, 0);
  const list = before.slice();
  applyOp(list, op);
  if (list.length !== after.length || list.some((d, i) => d !== after[i])) runsOk = false;
  // only the new records still there are kept, once the step is big enough to be cut down
  if (ea - s + eb - s >= 1024 && kept(op) > after.filter((d) => fresh.has(d)).length) compact = false;
}
expect("changed runs rebuild the same records (200 random changes)", runsOk);
expect("a change far apart keeps only the records it changed", compact);

// a saved drawing reopens to the bytes it was saved as, and its hash is stable
const saved = end.bytes;
const reopened = openVwx(saved, "check.vwx").doc.toBytes();
expect("saved bytes reopen to themselves", same(reopened, saved));
expect("saved hash matches the reopened drawing's", (await sha256Hex(saved)) === (await sha256Hex(reopened)));

// The history keeps the live drawing's own records (never copied), and the timeline replays them
// into a second document in the same page. That document must not take over the live one's
// records: an edit after scrubbing has to find each record where the live drawing has it.
{
  const live = openVwx(blankDrawing("mm"), "live.vwx");
  const begin = live.doc.toBytes();
  const steps: HistoryOp[] = [];
  const stop = live.onStep((op) => steps.push(historyOp(op, Date.now())));
  const first = live.doc.layers()[0].id;
  const second = live.createLayer("Second", "design", 50);
  const [a] = live.addObjects(second, [rect(0, 0)]);
  // these go in before a's records, so a sits further down the live list than in the replay at its step
  live.addObjects(first, [rect(1000, 0), rect(2000, 0)]);
  stop();
  const recorded = live.doc.toBytes();
  const scrubbed = new Replayer(begin, steps, "live.vwx");
  scrubbed.seek(steps.length - 1);
  const recs = (live.doc as Model).recs;
  expect(
    "a replay in the same page leaves the live drawing's records where it put them",
    recs.every((r, i) => r.index === i),
    `${recs.filter((r, i) => r.index !== i).length} of ${recs.length} moved`,
  );
  // the same move on a drawing that never shared its records
  const alone = openVwx(live.doc.toBytes(), "live.vwx");
  alone.moveObjects([a], 1000, 0);
  let moved = "";
  try {
    live.moveObjects([a], 1000, 0);
  } catch (e) {
    moved = (e as Error).message;
  }
  expect("an edit after scrubbing changes the object it names", !moved && same(live.doc.toBytes(), alone.doc.toBytes()), moved);
  scrubbed.seek(steps.length);
  expect("the replay still rebuilds the recorded drawing after the live edit", same(scrubbed.doc.toBytes(), recorded));
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
