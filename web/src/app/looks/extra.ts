// Commands the looks share that aren't a tool or one menu row: Ortho as a toggle, Lock and Unlock,
// Make2D, what AREA, LIST and Length print in the command line, REGEN, and the Dimension tool
// started in one of its kinds (Rhino's DimAngle, AutoCAD's DIMRADIUS). Each is a Command a look's
// buttons, keys, status bar and typed commands can use as they are.
import { canLock, canUnlock, lockSelected, unlockAll } from "../lockedObjects.ts";
import { make2D } from "../make2d.ts";
import { orthoOn, toggleOrtho } from "../ortho.ts";
import { toast } from "../toast.ts";
import { printLines } from "./commandLine.ts";
import { areaLines, lengthLines, listLines, regen } from "./reports.ts";
import type { Command } from "./types.ts";

/** Prints `lines` in the command line, or shows them as a note where the look has none. */
function report(lines: readonly string[]): void {
  if (!printLines(lines)) toast(lines.join("\n"), "info");
}

/** View › Ortho: checked while on (F8 in Rhino and AutoCAD). */
export const ORTHO: Command = { run: toggleOrtho, checked: orthoOn };

/** Locks the selection (Rhino's Lock, Revit's Pin). */
export const LOCK: Command = { run: () => (canLock() ? lockSelected() : undefined) };

/** Unlocks everything locked (Rhino's Unlock, Revit's Unpin). */
export const UNLOCK: Command = { run: () => (canUnlock() ? unlockAll() : undefined) };

/** The selected 3D objects as seen in the 3D view, as flat lines beside them (Rhino's Make2D, AutoCAD's FLATSHOT). */
export const MAKE2D: Command = { run: () => void make2D() };

/** The area and perimeter of each selected closed object (AutoCAD's AREA, Rhino's Area). */
export const AREA: Command = { run: () => report(areaLines()) };

/** The length of each selected curve (Rhino's Length, AutoCAD's MEASUREGEOM Distance on objects). */
export const LENGTH: Command = { run: () => report(lengthLines()) };

/** What each selected object is, where it sits and its sizes (AutoCAD's LIST, Rhino's What). */
export const LIST: Command = { run: () => report(listLines()) };

/** Draws everything again from the model (AutoCAD's REGEN and REDRAW, Rhino's Redraw). */
export const REGEN: Command = { run: regen };

/** The kinds of dimension Rodeo's Dimension tool draws, by the id its Mode bar uses. */
export type DimKind = "linear" | "chain" | "baseline" | "ordinate" | "radial" | "diameter" | "angular";

/** The Dimension tool, started in one of its kinds. */
export function dim(kind: DimKind): Command {
  return { tool: "dimension", mode: kind };
}
