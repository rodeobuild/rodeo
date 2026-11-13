// View › Work Like's mouse and 3D background, kept apart from view3d.ts (which loads only when 3D is
// first shown) so the look engine can set them before then: what the middle and right buttons drag
// in the application a look works like, and the colour its 3D view is drawn on.

export interface LookMouse {
  readonly middle: "orbit" | "pan" | "zoom";
  readonly right: "orbit" | "pan" | "menu";
}

let mouse: LookMouse | null = null;
/** whether the look takes a key typed over the drawing (its single keys, its command line) */
let owns: ((e: KeyboardEvent) => boolean) | null = null;
let background: number | null = null;
const listeners = new Set<() => void>();

/** The look's mouse buttons in 3D; null for Rodeo's own (the middle zooms, the right pans). */
export function lookMouse(): LookMouse | null {
  return mouse;
}

/** The look's 3D background as a number (0xa0a0a0); null for Rodeo's light grey. */
export function lookBackground(): number | null {
  return background;
}

/**
 * Whether the look takes this letter, digit or sign typed over the drawing (SketchUp's A for Arc, a
 * letter for Rhino's command line), so the 3D view leaves it alone rather than walking with it.
 */
export function lookOwnsKey(e: KeyboardEvent): boolean {
  return e.key.length === 1 && owns !== null && owns(e);
}

/** Sets the mouse, the background and which keys the look takes (null: Rodeo's own) and tells every 3D view. */
export function setLookView(m: LookMouse | null, color: string | null, keys: ((e: KeyboardEvent) => boolean) | null = null): void {
  mouse = m;
  owns = keys;
  const n = color ? Number.parseInt(color.replace("#", ""), 16) : Number.NaN;
  background = Number.isFinite(n) ? n : null;
  for (const f of listeners) f();
}

/** Calls `f` after each change; returns the call that stops it. */
export function onLookView(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
