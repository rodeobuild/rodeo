// Ortho, as in Rhino's and AutoCAD's F8: while it is on, a tool's second point is kept level or
// upright from the tool's last point (0, 90, 180 or 270 degrees). The setting is kept in
// localStorage under openvwx.ortho. Holding Shift turns Ortho off for that moment; tools.ts does
// that check where the pointer is read.

import type { Pt } from "../core/index.ts";
import { snapAngle } from "./geom.ts";
import { toast } from "./toast.ts";

/** localStorage key for the setting */
const KEY = "openvwx.ortho";

/** Listeners told each time the setting changes. */
const listeners = new Set<(on: boolean) => void>();

/** The setting as last read or set; read once so the pointer path never touches storage. */
let on = readStored();

/** The saved setting; off when nothing is saved or storage is blocked. */
function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

/** Saves the setting; a blocked store only means it is forgotten on reload. */
function writeStored(next: boolean): void {
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // storage blocked: the setting still holds for this session
  }
}

/** Whether Ortho is on. */
export function orthoOn(): boolean {
  return on;
}

/** Turns Ortho on or off, saves it, and tells the listeners. Does nothing when it is already so. */
export function setOrtho(next: boolean): void {
  if (next === on) return;
  on = next;
  writeStored(next);
  for (const f of listeners) f(on);
}

/** Flips Ortho and shows a short toast saying which it is now. */
export function toggleOrtho(): void {
  setOrtho(!on);
  toast(on ? "Ortho on" : "Ortho off", "info");
}

/** Calls `f` with the new state after each change. Returns a function that stops the calls. */
export function onOrtho(f: (on: boolean) => void): () => void {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/**
 * The point `to` moved onto the nearest level or upright line through `from`: it keeps the
 * position along that line that `to` has, so the pointer slides along the axis. Returns `to`
 * when it is on top of `from`.
 */
export function orthoPoint(from: Pt, to: Pt): Pt {
  const snapped = snapAngle(from, to, 90);
  const dx = snapped.x - from.x;
  const dy = snapped.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return to;
  const ux = dx / len;
  const uy = dy / len;
  const t = (to.x - from.x) * ux + (to.y - from.y) * uy;
  return { x: from.x + ux * t, y: from.y + uy * t };
}
