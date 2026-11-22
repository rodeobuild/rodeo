// The TypeScript half of the misc calls (misc.ts): the line markers a script sets (a step), what
// it reads back of them (a snapshot part for each object), the alert a script shows with one to
// three buttons and waits on (a host answer, drawn in the editor's own dialog style), the closed
// shape booleans and offsets it makes (steps), the linear and angular dimensions, and the view
// centre a script sets (applied when its run ends).

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { dimensionLayout, dimensionValue, angularLayout, linearDrawing } from "../../../app/dimension.ts";
import { addDimensionDrawings, dimensionClass } from "../../../app/tools/dimension.ts";
import { closedOutline, differenceOf, intersectionOf, resultShapes, unionOf } from "../../../app/surfaces.ts";
import { store } from "../../../app/state.ts";
import type { LineMarker, MarkerStyle, NewShape, ObjectInfo, Pt } from "../../../core/types.ts";
import { registerHost, registerObjectSnapshot, registerResult, registerSnapshot, registerStep, type StepContext } from "../steps.ts";

const STYLES: readonly MarkerStyle[] = ["arrow", "dot", "slash"];

/** The marker a script sends with a SetObj...Marker step (null hides it). */
interface MarkerIn {
  style: MarkerStyle;
  size: number;
  angle: number;
  width: number;
}

function markerIn(v: unknown): LineMarker | null {
  if (v === null || v === undefined) return null;
  const m = v as Partial<MarkerIn>;
  if (!STYLES.includes(m.style as MarkerStyle)) throw new Error(`a marker style Rodeo doesn't draw: ${String(m.style)}`);
  return { style: m.style as MarkerStyle, size: Number(m.size), angle: Number(m.angle), width: Number(m.width) };
}

/** A line's marker at one end, as a script reads it (null when it has none). */
function markerOut(m: LineMarker | undefined): Record<string, unknown> | null {
  if (!m) return null;
  return { style: m.style, size: m.size, angle: m.angle, width: m.width };
}

// Each line, arc, polygon and polyline carries its markers for the script to read (the ones that show).
registerObjectSnapshot((o) => {
  const m = o.markers;
  if (!m) return null;
  return { markers: { start: markerOut(m.start), end: markerOut(m.end) } };
});

// SetObjBeginningMarker / SetObjEndMarker: ["markers", id, "start" | "end", marker or null].
registerStep("markers", (a: readonly unknown[], ctx: StepContext) => {
  const id = ctx.real(a[0]);
  const end = a[1] === "end" ? "end" : "start";
  const marker = markerIn(a[2]);
  ctx.s.setLineMarkers([id], end === "start" ? { start: marker } : { end: marker });
});

/** One button of an alert: its answer code and its label. */
interface AlertButton {
  code: number;
  label: string;
}

/**
 * Shows an alert in the editor's dialog style and resolves with the code of the button pressed.
 * Args: title, text, advice (small text under the text, may be ""), the buttons as JSON, the
 * default button's code and the code Esc gives (Cancel's, or OK's when there is no Cancel).
 */
function alertChoice(args: readonly string[]): Promise<number> {
  const [title = "Script", text = "", advice = "", raw = "[]", defaultText = "1", escText = "1"] = args;
  const buttons = JSON.parse(raw) as AlertButton[];
  const defaultCode = Number(defaultText);
  const escCode = Number(escText);
  return new Promise((resolve) => {
    let done = false;
    // focus goes back to where it was when the alert closes, as the editor's own dialogs leave it
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = h("div", { cls: "menu-dialog-backdrop" });
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      backdrop.remove();
      returnFocus?.focus();
      resolve(code);
    };
    const buttonEls = buttons.map((b) => {
      const el = h("button", { cls: b.code === defaultCode ? "btn primary" : "btn", text: b.label, attrs: { type: "button" } });
      el.addEventListener("click", () => finish(b.code));
      return el;
    });
    const box = h(
      "div",
      { cls: "menu-dialog pi-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": title } },
      h("h2", { cls: "menu-dialog-title", text: title }),
      h("p", { cls: "pi-alert", text }),
      advice ? h("p", { cls: "pi-alert", text: advice }) : null,
      h("div", { cls: "menu-dialog-actions" }, ...buttonEls),
    );
    backdrop.append(box);
    // every key stays inside the dialog, so the window shortcuts do not run under it
    backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(escCode);
      } else if (e.key === "Enter") {
        e.preventDefault();
        finish(defaultCode);
      }
    });
    document.body.append(backdrop);
    buttonEls.find((el) => el.classList.contains("primary"))?.focus();
  });
}

registerHost("AlertChoice", async (args) => alertChoice(args));

// ---- closed shapes: booleans and offsets ------------------------------------------------------

/** The outline of a closed shape (a polygon, rectangle, closed polyline, circle or ellipse), or a refusal. */
function outlineOf(o: ObjectInfo): Pt[] {
  const outline = o.shape ? closedOutline(o.shape) : null;
  if (!outline) throw new Error("this call needs closed shapes: polygons, rectangles, closed polylines, circles or ellipses");
  return outline;
}

interface Surface {
  readonly id: string;
  readonly o: ObjectInfo;
  readonly outline: Pt[];
}

// ["surf", "add" | "clip" | "isect", tmp or null, [id, id]]: Add Surface replaces the two with their union
// (the result takes the handle); Clip Surface adds what is left of the first after the second is taken
// away, both kept; Intersect Surface adds their overlap with the second's class and attributes.
registerStep("surf", (a: readonly unknown[], ctx: StepContext) => {
  const op = String(a[0]);
  const tmp = a[1] === null ? null : String(a[1]);
  const items: Surface[] = ctx.ids(a[2]).map((tmp) => {
    const id = ctx.real(tmp);
    const o = ctx.s.doc.object(id);
    if (!o) throw new Error("a surface call's object is not in the drawing");
    return { id, o, outline: outlineOf(o) };
  });
  const [first, second] = items;
  if (!first || !second) throw new Error("a surface call needs two closed shapes");
  if (op === "add") {
    // the reference: the two are joined when they overlap, else nothing changes (the handle is then unused)
    const shapes = resultShapes(unionOf(items.map((i) => i.outline)));
    if (shapes.length !== 1) return;
    const out = ctx.s.replaceObjects(items.map((i) => i.id), shapes);
    if (tmp && out[0]) ctx.made.set(tmp, out[0]);
    return;
  }
  if (op === "clip") {
    const made = resultShapes(differenceOf(first.outline, second.outline)).map((shape) =>
      ctx.s.addObject(first.o.layerId, shape, first.o.classIndex, first.o.attrs ?? undefined),
    );
    if (tmp && made[0]) ctx.made.set(tmp, made[0]);
    return;
  }
  const shapes = resultShapes(intersectionOf([first.outline, second.outline]));
  const made = shapes.map((shape) => ctx.s.addObject(first.o.layerId, shape, second.o.classIndex, second.o.attrs ?? undefined));
  if (tmp && made[0]) ctx.made.set(tmp, made[0]);
});

/** Offsets a path by d (mm): positive outward for a closed one, to its left for an open one (Rodeo's reading). */
export function offsetPath(input: readonly Pt[], closed: boolean, d: number, smooth: boolean): Pt[] {
  const P = dedupe(input, closed);
  const n = P.length;
  if (n < 2 || (closed && n < 3)) throw new Error("an offset needs at least two different points (three for a closed shape)");
  const side = closed ? (area(P) > 0 ? -1 : 1) : 1;
  const segs = closed ? n : n - 1;
  const u: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const p = P[i] as Pt;
    const q = P[(i + 1) % n] as Pt;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    u.push({ x: (q.x - p.x) / len, y: (q.y - p.y) / len });
  }
  // the offset vector of segment k: its left normal, turned to the offset's side, d long
  const off = (k: number): Pt => ({ x: -(u[k] as Pt).y * side * d, y: (u[k] as Pt).x * side * d });
  const at = (p: Pt, v: Pt): Pt => ({ x: p.x + v.x, y: p.y + v.y });
  const out: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const p = P[j] as Pt;
    if (!closed && j === 0) {
      out.push(at(p, off(0)));
      continue;
    }
    if (!closed && j === n - 1) {
      out.push(at(p, off(segs - 1)));
      continue;
    }
    const prev = closed ? (j - 1 + segs) % segs : j - 1;
    const next = closed ? j % segs : j;
    const A = at(p, off(prev));
    const B = at(p, off(next));
    const up = u[prev] as Pt;
    const un = u[next] as Pt;
    const cross = up.x * un.y - up.y * un.x;
    if (Math.abs(cross) < 1e-12) {
      out.push(A);
      continue;
    }
    // an outer corner is the offset's side turning away: smooth joins it with an arc, else a mitre
    // (cut back to two points when it would run far past the corner)
    if (cross * side < 0 && smooth) {
      const r = Math.abs(d);
      const a0 = Math.atan2(A.y - p.y, A.x - p.x);
      let sweep = Math.atan2(B.y - p.y, B.x - p.x) - a0;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep <= -Math.PI) sweep += 2 * Math.PI;
      const steps = 8;
      for (let k = 0; k <= steps; k++) out.push({ x: p.x + r * Math.cos(a0 + (sweep * k) / steps), y: p.y + r * Math.sin(a0 + (sweep * k) / steps) });
      continue;
    }
    const t = ((B.x - A.x) * un.y - (B.y - A.y) * un.x) / cross;
    const M = { x: A.x + t * up.x, y: A.y + t * up.y };
    if (Math.hypot(M.x - p.x, M.y - p.y) <= 4 * Math.abs(d)) out.push(M);
    else out.push(A, B);
  }
  return out;
}

function area(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % pts.length] as Pt;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** The points without repeats in a row (and without a closing point that repeats the first). */
function dedupe(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-9) out.push({ x: p.x, y: p.y });
  }
  if (closed) while (out.length > 1 && Math.hypot(out[0]!.x - out[out.length - 1]!.x, out[0]!.y - out[out.length - 1]!.y) <= 1e-9) out.pop();
  return out;
}

/** The path a shape offsets: its points (a closed shape's outline, a curve sampled). */
function pathOf(o: ObjectInfo): { pts: Pt[]; closed: boolean } {
  const s = o.shape;
  if (!s) throw new Error("this call needs a polygon, polyline or line");
  if (s.kind === "arc") return { pts: outlineOf(o), closed: true };
  if (!s.points || s.points.length < 2) throw new Error("this call needs a polygon, polyline or line");
  return { pts: s.points, closed: !!s.closed };
}

// ["offset", tmp, id, distance mm, copies, smooth, profile]: an offset of the path (copies at d, 2d...),
// or with profile the closed band between the path and its offset. A closed path's offset is cleaned
// by a union so that its own overlaps go; an open one keeps its shape as drawn.
registerStep("offset", (a: readonly unknown[], ctx: StepContext) => {
  const tmp = a[0] === null ? null : String(a[0]);
  const o = ctx.s.doc.object(ctx.real(a[1]));
  if (!o) throw new Error("the offset's object is not in the drawing");
  const { pts, closed } = pathOf(o);
  const d = Number(a[2]);
  const copies = Math.max(1, Math.round(Number(a[3])));
  const smooth = a[4] === true;
  const profile = a[5] === true;
  if (!(d !== 0)) throw new Error("an offset needs a distance other than 0");
  const made: string[] = [];
  for (let k = 1; k <= copies; k++) {
    const off = offsetPath(pts, closed, d * k, smooth);
    let shapes: NewShape[];
    if (profile) {
      if (!closed) shapes = resultShapes(unionOf([[...pts, ...[...off].reverse()]]));
      else shapes = resultShapes(d * k > 0 ? differenceOf(off, pts) : differenceOf(pts, off));
    } else if (closed) {
      shapes = resultShapes(unionOf([off]));
    } else {
      shapes = [{ kind: "polyline", points: off, closed: false }];
    }
    if (shapes.length === 0) throw new Error("the offset leaves no area");
    for (const shape of shapes) made.push(ctx.s.addObject(o.layerId, shape, o.classIndex, o.attrs ?? undefined));
  }
  if (tmp && made[0]) ctx.made.set(tmp, made[0]);
});

// ---- dimensions -------------------------------------------------------------------------------

/** The class dimensions are kept on (Dimension), or the class of the new object. */
function dimensionClassIndex(ctx: StepContext, name: string): number {
  return dimensionClass(ctx.s.doc) ?? ctx.classIndex(name);
}

// ["lindim", ax, ay, bx, by, offset mm, layer id, class name]: a linear dimension of a to b, its line offset from it.
registerStep("lindim", (a: readonly unknown[], ctx: StepContext) => {
  const [ax, ay, bx, by, off] = a.slice(0, 5).map(Number) as [number, number, number, number, number];
  const layer = ctx.s.doc.layers().find((l) => l.id === String(a[5]));
  if (!layer) throw new Error("the dimension's layer is not in the drawing");
  if (!ctx.s.dimensionTemplate()) throw new Error("this drawing has no linear dimension to copy, so Rodeo can't make one here: draw a linear dimension first");
  const A = { x: ax, y: ay };
  const B = { x: bx, y: by };
  const len = Math.hypot(bx - ax, by - ay);
  if (!(len > 0)) throw new Error("a dimension measures some length");
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const cursor = { x: (ax + bx) / 2 + nx * off, y: (ay + by) / 2 + ny * off };
  const layout = dimensionLayout(A, B, cursor, true, layer.scale || 1);
  if (!layout) throw new Error("a dimension measures some length");
  const value = dimensionValue(layout.length, ctx.s.doc.info.units);
  addDimensionDrawings(ctx.s, layer.id, [linearDrawing(layout, value)], dimensionClassIndex(ctx, String(a[6])));
});

// ["angdim", start, end, vertex, offset mm, class name, layer]: the angle at the vertex between its two arms.
registerStep("angdim", (a: readonly unknown[], ctx: StepContext) => {
  const [sx, sy, ex, ey, vx, vy, off] = a.slice(0, 7).map(Number) as [number, number, number, number, number, number, number];
  const layer = ctx.s.doc.layers().find((l) => l.id === String(a[8]));
  if (!layer) throw new Error("the dimension's layer is not in the drawing");
  const V = { x: vx, y: vy };
  const S = { x: sx, y: sy };
  const E = { x: ex, y: ey };
  const u1 = norm({ x: sx - vx, y: sy - vy });
  const u2 = norm({ x: ex - vx, y: ey - vy });
  if (!u1 || !u2) throw new Error("an angle needs two arms of some length");
  const bis = norm({ x: u1.x + u2.x, y: u1.y + u2.y }) ?? { x: -u1.y, y: u1.x };
  const cursor = { x: vx + bis.x * off, y: vy + bis.y * off };
  const drawing = angularLayout({ a: V, b: S }, { a: V, b: E }, cursor, layer.scale || 1);
  if (!drawing) throw new Error("an angle needs two arms that aren't in line");
  addDimensionDrawings(ctx.s, layer.id, [drawing], dimensionClassIndex(ctx, String(a[7])));
});

function norm(p: Pt): Pt | null {
  const l = Math.hypot(p.x, p.y);
  return l > 0 ? { x: p.x / l, y: p.y / l } : null;
}

// ---- the view centre --------------------------------------------------------------------------

// The 2D view's centre (mm) as the script starts; a script's SetVCenter moves it when the run ends.
registerSnapshot(() => {
  const v = appContext()?.view;
  return { viewCenter: v ? [v.cx, v.cy] : null, screen: typeof screen !== "undefined" ? [0, 0, screen.width, screen.height] : null };
});

registerResult((result) => {
  const c = result.viewCenter as [number, number] | undefined;
  const v = appContext()?.view;
  if (!c || !v) return;
  v.setCenterAndScale(c[0], c[1], v.scale);
  store.emit("view");
});

