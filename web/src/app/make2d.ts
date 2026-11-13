// Make 2D Drawing (Rhino's Make2D): the selected 3D objects, seen from the direction the 3D view shows
// (Top while the plan is on screen), turned into flat lines the way a section is (sectionCut.ts) with no
// cut plane, so everything is seen. Visible edges go in the class Make2D-Visible; the edges something
// nearer hides go in Make2D-Hidden, dashed where the drawing has a dashed line type. The drawing is one
// group on the active design layer, laid flat on plan to the right of the selection, a quarter of its
// width away and bottoms level with it. One undo step.

import type { Attributes, EditSession, NewShape, Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { nextPaint } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showLoading } from "./loading.ts";
import { colorMatcher } from "./pdfImport.ts";
import { sectionView, type SectionDrawing, type SectionFrame } from "./sectionCut.ts";
import { sectionMeshes } from "./sectionViewport.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { threeDOnScreen } from "./viewTargets.ts";

type V = readonly [number, number, number];

/** the two classes the drawing's lines go in */
const VISIBLE_CLASS = "Make2D-Visible";
const HIDDEN_CLASS = "Make2D-Hidden";
/** line weight of both, mils */
const LINE_MILS = 5;
/** the gap between the selection and the drawing, as a fraction of the selection's width */
const GAP = 0.25;

/** True while there is a selection with 3D objects on the visible design layers to draw. */
export function canMake2D(): boolean {
  if (!store.session || !store.selection.size) return false;
  return sectionMeshes(undefined, undefined, store.selection).length > 0;
}

/** The class with this name, made if the drawing has none yet. */
function classNamed(s: EditSession, name: string): number {
  return s.doc.classes().find((c) => c.name === name)?.index ?? s.createClass(name);
}

/**
 * The frame the drawing is seen through: the 3D view's own screen axes (its eye looking at the model),
 * or the plan's when the plan is on screen. Set back from the model's box `lo`–`hi` so nothing is cut.
 */
function viewFrame(lo: V, hi: V): SectionFrame {
  const v = threeDOnScreen() ? (appContext()?.view3d()?.currentView() ?? null) : null;
  // the frame looks into the model, opposite to the viewer's direction (sectionCut.ts)
  const right: V = v ? v.right : [1, 0, 0];
  const up: V = v ? v.up : [0, 1, 0];
  const toward: V = v ? [-v.toward[0], -v.toward[1], -v.toward[2]] : [0, 0, -1];
  const c: V = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const reach = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + 1;
  const origin: V = [c[0] - toward[0] * reach * 2, c[1] - toward[1] * reach * 2, c[2] - toward[2] * reach * 2];
  return { origin, right, up, toward, depth: Infinity, across: { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity } };
}

/**
 * The parts of the hidden lines no visible line lies along: an object's back rim seen square on
 * lies under its front rim, so it's already drawn as a visible line and isn't drawn hidden as well.
 * Collinear overlaps only, within `tol`; the rest of each hidden line comes back as lines, joined
 * where they meet.
 */
function unseenParts(hidden: readonly Pt[][], visible: readonly Pt[][], tol: number): Pt[][] {
  interface Seg {
    readonly a: Pt;
    readonly b: Pt;
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  }
  const segs: Seg[] = [];
  for (const l of visible)
    for (let i = 0; i + 1 < l.length; i++) {
      const a = l[i];
      const b = l[i + 1];
      segs.push({ a, b, x0: Math.min(a.x, b.x) - tol, y0: Math.min(a.y, b.y) - tol, x1: Math.max(a.x, b.x) + tol, y1: Math.max(a.y, b.y) + tol });
    }
  if (!segs.length) return hidden.map((l) => [...l]);
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;
  for (const s of segs) {
    gx0 = Math.min(gx0, s.x0);
    gy0 = Math.min(gy0, s.y0);
    gx1 = Math.max(gx1, s.x1);
    gy1 = Math.max(gy1, s.y1);
  }
  const N = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(segs.length))));
  const cs = Math.max(gx1 - gx0, gy1 - gy0, tol) / N;
  const cell = (v: number, o: number): number => Math.max(0, Math.min(N - 1, Math.floor((v - o) / cs)));
  // the visible segments each grid cell holds (by their boxes)
  const grid = new Map<number, number[]>();
  segs.forEach((s, i) => {
    for (let cx = cell(s.x0, gx0); cx <= cell(s.x1, gx0); cx++)
      for (let cy = cell(s.y0, gy0); cy <= cell(s.y1, gy0); cy++) {
        const k = cx * N + cy;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });
  /** the parts of hidden segment a→b that no visible segment lies along */
  const uncovered = (a: Pt, b: Pt): [Pt, Pt][] => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > tol)) return [];
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const cover: [number, number][] = [];
    const seen = new Set<number>();
    for (let cx = cell(Math.min(a.x, b.x) - tol, gx0); cx <= cell(Math.max(a.x, b.x) + tol, gx0); cx++)
      for (let cy = cell(Math.min(a.y, b.y) - tol, gy0); cy <= cell(Math.max(a.y, b.y) + tol, gy0); cy++)
        for (const i of grid.get(cx * N + cy) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          const s = segs[i];
          // both ends of it within tol of a→b's line: it lies along it
          const offA = Math.abs((s.a.x - a.x) * uy - (s.a.y - a.y) * ux);
          const offB = Math.abs((s.b.x - a.x) * uy - (s.b.y - a.y) * ux);
          if (offA > tol || offB > tol) continue;
          const ta = ((s.a.x - a.x) * ux + (s.a.y - a.y) * uy) / len;
          const tb = ((s.b.x - a.x) * ux + (s.b.y - a.y) * uy) / len;
          const lo = Math.max(0, Math.min(ta, tb));
          const hi = Math.min(1, Math.max(ta, tb));
          if (hi > lo) cover.push([lo, hi]);
        }
    cover.sort((p, q) => p[0] - q[0]);
    const at = (t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const out: [Pt, Pt][] = [];
    let from = 0;
    for (const [lo, hi] of cover) {
      if (lo > from && (lo - from) * len > 4 * tol) out.push([at(from), at(lo)]);
      from = Math.max(from, hi);
    }
    if (from < 1 && (1 - from) * len > 4 * tol) out.push([at(from), at(1)]);
    return out;
  };
  // each piece once: two hidden edges lying over each other (an object's back rim and its side) are one line
  const emitted = new Set<string>();
  const keyOf = (p: Pt): string => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const out: Pt[][] = [];
  for (const line of hidden) {
    let run: Pt[] = [];
    const flush = (): void => {
      if (run.length > 1) out.push(run);
      run = [];
    };
    for (let i = 0; i + 1 < line.length; i++)
      for (const [p, q] of uncovered(line[i], line[i + 1])) {
        const [k1, k2] = [keyOf(p), keyOf(q)].sort();
        const key = `${k1}|${k2}`;
        if (emitted.has(key)) {
          flush();
          continue;
        }
        emitted.add(key);
        const last = run[run.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) <= tol) run.push(q);
        else {
          flush();
          run = [p, q];
        }
      }
    flush();
  }
  return out;
}

/**
 * Makes the 2D drawing of the selected 3D objects, as seen from the 3D view (or the plan), on the
 * active design layer beside the selection. Toasts what it made, or why it made nothing.
 */
export async function make2D(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const sel = new Set(store.selection);
  const meshes = sectionMeshes(undefined, undefined, sel);
  if (!meshes.length) {
    toast("Select 3D objects on the visible design layers to make a 2D drawing of.", "info");
    return;
  }
  const layer = session.doc.layers().find((l) => l.id === store.activeLayerId);
  if (!layer || layer.kind !== "design") {
    toast("Make the design layer to draw on active first.", "error");
    return;
  }
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const objects = new Set<string>();
  for (const m of meshes) {
    objects.add(m.id);
    for (let i = 0; i + 2 < m.triangles.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], m.triangles[i + k]);
        hi[k] = Math.max(hi[k], m.triangles[i + k]);
      }
  }
  const done = showLoading("Making the 2D drawing…");
  let drawing: SectionDrawing;
  try {
    await nextPaint();
    drawing = sectionView(meshes, viewFrame(lo, hi), { hidden: true });
  } catch (err) {
    toast(`The 2D drawing couldn't be made: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  const box = drawing.box;
  const visibleLines = drawing.pieces.flatMap((p) => p.lines);
  // within 0.1 mm, or a hair of the drawing's size, two lines lie along each other
  const tol = box ? Math.max(0.1, Math.max(box.x1 - box.x0, box.y1 - box.y0) * 1e-5) : 0.1;
  const hiddenLines = unseenParts(
    drawing.pieces.flatMap((p) => p.hidden ?? []),
    visibleLines,
    tol,
  );
  if (!box || visibleLines.length + hiddenLines.length === 0) {
    toast("Nothing of the selection is seen from this view.", "info");
    return;
  }
  // beside the selection on plan: its left edge a quarter of its width past the selection's right, bottoms level
  const dx = hi[0] + (hi[0] - lo[0]) * GAP - box.x0;
  const dy = lo[1] - box.y0;
  const place = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  const ink = (hex: string): number => {
    const h = /^#([0-9a-f]{6})/i.exec(hex)?.[1] ?? "000000";
    return colorMatcher()({ r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 });
  };
  const black = ink("#000000");
  const line = (pts: readonly Pt[], closed: boolean): NewShape =>
    pts.length === 2 && !closed ? { kind: "line", a: place(pts[0]), b: place(pts[1]) } : { kind: "polygon", points: pts.map(place), closed };

  const made = attempt("Make 2D Drawing", (s) =>
    s.batch(() => {
      // no cut plane, so the drawing has no cut outlines: every piece is lines
      const visibleClass = classNamed(s, VISIBLE_CLASS);
      const hiddenClass = classNamed(s, HIDDEN_CLASS);
      const dashed = s.doc.lineTypes().find((t) => t.dashes.length > 0);
      const solid: Partial<Attributes> = { penFore: black, lineWeight: LINE_MILS, fillPattern: 0 };
      const dashedLook: Partial<Attributes> = dashed ? { ...solid, lineStyle: dashed.style } : solid;
      const items: { shape: NewShape; cls: number; look: Partial<Attributes> }[] = [
        ...visibleLines.map((l) => ({ shape: line(l, false), cls: visibleClass, look: solid })),
        ...hiddenLines.map((l) => ({ shape: line(l, false), cls: hiddenClass, look: dashedLook })),
      ];
      const ids = s.addObjects(
        layer.id,
        items.map((i) => i.shape),
        items.map((i) => i.cls),
        items.map((i) => i.look),
      );
      return ids.length > 1 ? s.groupObjects(ids) : ids[0];
    }),
  );
  if (!made) return;
  setSelection([made.value]);
  const n = objects.size;
  toast(`Made a 2D drawing of ${n} ${n === 1 ? "object" : "objects"}`, "info");
}
