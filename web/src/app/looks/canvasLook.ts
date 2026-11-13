// View › Work Like's 2D canvas, kept apart from renderer.ts (which draws the grid) and viewControl.ts
// (the view cube) so the look engine can set them before the drawing is first shown: the colours of
// the 2D grid's minor and major lines and of the X and Y axes through the origin (Rhino's grey grid
// with a red X axis and a green Y axis), and whether Rodeo's view cube, the TOP / 3D box, shows.

export interface LookCanvas {
  readonly gridColors?: { readonly minor: string; readonly major: string; readonly xAxis?: string; readonly yAxis?: string };
  readonly viewCube: boolean;
  /** each 3D pane shows its construction plane's grid with the X/Y/Z axes, as Rhino's viewports do
   * (Top and Perspective world XY, Front world XZ, Right world YZ), in gridColors' colours */
  readonly grid3d?: boolean;
  /** the 3D view's axes through the origin (solid positive half, dotted negative) and its sky, as SketchUp draws them; absent for the others */
  readonly axes3d?: "sketchup";
}

let canvas: LookCanvas | null = null;
const listeners = new Set<() => void>();

/** The look's 2D canvas settings; null for Rodeo's own. */
export function lookCanvas(): LookCanvas | null {
  return canvas;
}

/** Sets them (null: Rodeo's own) and tells every listener. */
export function setLookCanvas(c: LookCanvas | null): void {
  canvas = c;
  for (const f of listeners) f();
}

/** Calls `f` after each change; returns the call that stops it. */
export function onLookCanvas(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
