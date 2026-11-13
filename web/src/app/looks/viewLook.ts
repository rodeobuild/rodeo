// View › Work Like's mouse and 3D background, kept apart from view3d.ts (which loads only when 3D is
// first shown) so the look engine can set them before then: what the middle and right buttons drag
// in the application a look works like, and the colour its 3D view is drawn on.

export interface LookMouse {
  readonly middle: "orbit" | "pan" | "zoom";
  readonly right: "orbit" | "pan" | "menu";
}

let mouse: LookMouse | null = null;
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

/** Sets both (null: Rodeo's own) and tells every 3D view. */
export function setLookView(m: LookMouse | null, color: string | null): void {
  mouse = m;
  const n = color ? Number.parseInt(color.replace("#", ""), 16) : Number.NaN;
  background = Number.isFinite(n) ? n : null;
  for (const f of listeners) f();
}

/** Calls `f` after each change; returns the call that stops it. */
export function onLookView(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
