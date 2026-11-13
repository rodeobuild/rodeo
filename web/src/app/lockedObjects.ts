// Edit > Lock Selection and Unlock All, as Rhino has them: a locked object is still drawn, in plan
// and in 3D, but in grey in plan, and it can't be picked by a click, a marquee, Select All, Select
// Similar or Invert Selection, so it can't be moved, edited or deleted. Object snaps still snap to
// it. Locked objects are kept for each open drawing while it is open, and are not saved with the
// file (how Rhino and Vectorworks keep their locks in the file isn't known here), so a drawing
// opened again has none locked.

import type { ObjectInfo, VwxDocument } from "../core/types.ts";
import { setSelection } from "./commands.ts";
import { toast } from "./toast.ts";
import { store } from "./state.ts";

const bySession = new WeakMap<object, Set<string>>();
const listeners: (() => void)[] = [];
let version = 0;

const NONE: ReadonlySet<string> = new Set();

/** The ids locked in the open drawing (an object inside a locked group is locked with it, see isLockedObject). */
export function lockedObjects(): ReadonlySet<string> {
  const s = store.session;
  return (s && bySession.get(s)) ?? NONE;
}

/** Bumped on every change, for what keeps a drawn picture. */
export function lockedVersion(): number {
  return version;
}

/** Calls `f` whenever objects are locked or unlocked. */
export function onLockedChange(f: () => void): void {
  listeners.push(f);
}

/** Whether `obj` is locked, or a group it is in is. Nothing is locked when no object is. */
export function isLockedObject(doc: VwxDocument | null | undefined, obj: ObjectInfo): boolean {
  const locked = lockedObjects();
  if (locked.size === 0) return false;
  let cur: ObjectInfo | null | undefined = obj;
  for (let guard = 0; cur && guard < 256; guard++) {
    if (locked.has(cur.id)) return true;
    cur = cur.parentId === null || !doc ? null : doc.object(cur.parentId);
  }
  return false;
}

/** Locks or unlocks objects in the open drawing: `lock` added, `unlock` taken out. */
function changeLocked(lock: Iterable<string>, unlock: Iterable<string>): void {
  const s = store.session;
  if (!s) return;
  const set = bySession.get(s) ?? new Set<string>();
  for (const id of unlock) set.delete(id);
  for (const id of lock) set.add(id);
  bySession.set(s, set);
  version++;
  for (const f of listeners) f();
  store.emit("display");
}

/** Edit > Lock Selection can run: something is selected, and no symbol is being edited. */
export function canLock(): boolean {
  return store.session !== null && store.symbolEdit === null && store.selection.size > 0;
}

/** Edit > Unlock All can run: something in the drawing is locked. */
export function canUnlock(): boolean {
  return lockedObjects().size > 0;
}

/** Locks the selection and lets go of it, with a toast saying how many objects are locked. */
export function lockSelected(): void {
  if (!canLock()) return;
  const n = store.selection.size;
  changeLocked([...store.selection], []);
  setSelection([]);
  toast(`Locked ${n} ${n === 1 ? "object" : "objects"}`, "info");
}

/** Unlocks every locked object in the drawing and selects them, as Rhino's Unlock All does. */
export function unlockAll(): void {
  const doc = store.session?.doc;
  if (!doc || !canUnlock()) return;
  const locked = [...lockedObjects()];
  const ids = locked.filter((id) => doc.object(id) !== undefined);
  changeLocked([], locked);
  setSelection(ids);
}
