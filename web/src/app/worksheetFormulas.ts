// Live worksheets, the app's side: the formulas Rodeo holds for a worksheet, and recalculation
// after each edit.
//
// A formula that can't be saved as a Vectorworks formula (its tokens aren't known: + - / < >, a
// cell reference, SUM…; FORMAT.md §7.2), or that comes to text, is saved in its cell as the value
// it comes to, and its text is held here: in the drawing, as JSON in a Rodeo data object (the
// one show data uses), so it travels with the file, undo covers it and people editing together
// share it. Vectorworks reads such a cell as a plain value. The JSON is { "<worksheet's name
// index>": { "<row>,<col>": "=…" } }, rows and columns 0-based.
//
// After each new edit the worksheets' database rows and formulas are worked out again and the
// values that changed written into them, as part of the edit (one undo). On a drawing where
// that takes long it waits for a pause in the editing instead.

import type { EditSession } from "../core/index.ts";
import { readShow, writeShowIn } from "../features/theatre/show.ts";
import { followEdits } from "./ext.ts";
import { store } from "./state.ts";

const KEY = "worksheet formulas";
type Stored = Record<string, Record<string, string>>;

/** a recalculation slower than this waits for a pause in the editing */
const SLOW_MS = 250;
const PAUSE_MS = 1200;
/** records: past this a drawing's worksheets are worked out in a pause, not with each edit */
const BIG_DRAWING = 60000;

/** The formulas Rodeo holds, by worksheet (name index) then "row,col". */
export function keptFormulas(): Map<number, Map<string, string>> {
  const stored = readShow<Stored>(KEY, {});
  const out = new Map<number, Map<string, string>>();
  for (const [index, cells] of Object.entries(stored)) {
    if (cells && typeof cells === "object") out.set(Number(index), new Map(Object.entries(cells).filter(([, v]) => typeof v === "string")));
  }
  return out;
}

/** The formulas Rodeo holds for worksheet `index`. */
export function keptFor(index: number): Map<string, string> {
  return keptFormulas().get(index) ?? new Map();
}

function write(s: EditSession, all: Map<number, Map<string, string>>): void {
  const stored: Stored = {};
  for (const [index, cells] of all) if (cells.size) stored[String(index)] = Object.fromEntries(cells);
  // nothing held and nothing stored: no data object is made for it
  if (!Object.keys(stored).length && !Object.keys(readShow<Stored>(KEY, {})).length) return;
  writeShowIn(s, KEY, stored);
}

/** Holds `text` for a cell of worksheet `index`, or lets the cell go (null), within the caller's batch. */
export function keepFormula(s: EditSession, index: number, row: number, col: number, text: string | null): void {
  const all = keptFormulas();
  const cells = all.get(index) ?? new Map<string, string>();
  const key = `${row},${col}`;
  if (text === null ? !cells.has(key) : cells.get(key) === text) return;
  if (text === null) cells.delete(key);
  else cells.set(key, text);
  all.set(index, cells);
  write(s, all);
}

/**
 * Moves the held formulas of worksheet `index` with rows or columns added before `at` (count > 0) or
 * deleted from it (count < 0), within the caller's batch. Those of deleted rows or columns go.
 */
export function shiftKept(s: EditSession, index: number, axis: "row" | "col", at: number, count: number): void {
  const all = keptFormulas();
  const cells = all.get(index);
  if (!cells?.size) return;
  const next = new Map<string, string>();
  for (const [key, text] of cells) {
    const [r, c] = key.split(",").map(Number) as [number, number];
    const v = axis === "row" ? r : c;
    if (count < 0 && v >= at && v < at - count) continue;
    const moved = v >= at ? v + count : v;
    next.set(axis === "row" ? `${moved},${c}` : `${r},${moved}`, text);
  }
  all.set(index, next);
  write(s, all);
}

/** Forgets the formulas held for worksheets the drawing no longer has, within the caller's batch. */
function dropGone(s: EditSession, all: Map<number, Map<string, string>>): void {
  const have = new Set(s.doc.resources().filter((r) => r.kind === "worksheet").map((r) => r.index));
  const gone = [...all.keys()].filter((index) => !have.has(index));
  if (!gone.length) return;
  for (const index of gone) all.delete(index);
  write(s, all);
}

/**
 * Works the open drawing's worksheets out again now; how many changed. After an edit it is part of that
 * edit (`join`: one undo takes both back); asked for from a menu it is a step of its own.
 */
export function recalculateNow(s: EditSession, join = false): number {
  const all = keptFormulas();
  const work = (): number => {
    dropGone(s, all);
    return s.recalculateWorksheets(all);
  };
  return join ? s.followOn(work) : s.batch(work);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let slow = false;
let busy = false;

function recalcTimed(s: EditSession): void {
  if (store.session !== s || !s.doc.hasLiveWorksheets()) return;
  const t0 = performance.now();
  busy = true;
  try {
    recalculateNow(s, true);
  } catch (err) {
    // an edit never fails for its worksheets: they keep the values they had
    console.warn("worksheets not recalculated:", err);
  } finally {
    busy = false;
  }
  slow = performance.now() - t0 > SLOW_MS;
}

followEdits((s) => {
  // its own writing is an edit too
  if (busy || !s.doc.hasLiveWorksheets()) return;
  clearTimeout(timer);
  // a worksheet that changes has the whole drawing indexed again (its cells are drawn objects), which a big
  // drawing takes a second or more over: there the worksheets wait for a pause
  if (slow || s.doc.info.records > BIG_DRAWING) timer = setTimeout(() => recalcTimed(s), PAUSE_MS);
  else recalcTimed(s);
});
