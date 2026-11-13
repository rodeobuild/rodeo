// The 2D drawing tools in the 3D view: Line, Rectangle, Circle, Arc, Polygon and the rest draw on the
// active design layer's plane there, as SketchUp's tools draw on the ground. The pointer's ray meets the
// plane at a point of the drawing; the tool gets it as it gets the plan's pointer, measured and snapped by
// a plan view standing in for the 3D one about that point (turned as the plan is, at the size things show
// there), so its clicks, drags, Shift, double-clicks, the data bar and snapping work as in the plan. What
// the tool paints as its preview is caught as paths in that stand-in's plan and painted again through the
// 3D camera over the view, so a circle shows as the ellipse it makes on the ground; the snap marker and the
// datum are painted where their points show. The left button is the tool's; the middle orbits where no
// other button does. While a tool draws there (and always in a look that opens in 3D, SketchUp's) the 2D
// objects of the visible design layers show on their planes, so what is drawn can be seen and Push/Pull
// can raise it. A working plane isn't drawn on: 2D objects lie on their layer's plane.

import type { Pt } from "../core/index.ts";
import { dataBar } from "./databar.ts";
import { byId } from "./dom.ts";
import { hiddenObjects, onHiddenChange } from "./hiddenObjects.ts";
import { lookCanvas, onLookCanvas } from "./looks/canvasLook.ts";
import type { Scene } from "./scene.ts";
import { store, type ToolId } from "./state.ts";
import type { Painter, ToolController } from "./tools.ts";
import { View } from "./view.ts";
import type { CanvasPoint, View3D, ViewDrawer } from "./view3d.ts";

/** The tools that draw in the 3D view, on the active layer's plane: those that draw 2D shapes (and the solids drawn as one) from points clicked in the plan. */
export const DRAWS_IN_3D: ReadonlySet<ToolId> = new Set<ToolId>([
  "line",
  "rect",
  "roundrect",
  "circle",
  "arc",
  "quarterarc",
  "oval",
  "polygon",
  "polyline",
  "regpoly",
  "triangle",
  "freehand",
  "extrect",
  "extpoly",
  "cylinder",
  "sphere",
  "hemisphere",
  "cone",
]);

/** the record types of the 2D objects shown on their plane: lines, rectangles, polygons, arcs and circles, rounded rectangles, polylines */
const FLAT_TYPES: ReadonlySet<number> = new Set([2, 3, 5, 6, 13, 21]);
/** at most this many 2D objects show in the 3D view, the active layer's first */
const MAX_FLAT = 5000;
/** where a marker whose point is behind the camera goes: off the canvas */
const OFF: Pt = { x: -1e5, y: -1e5 };

export interface Draw3dDeps {
  readonly controller: ToolController;
  /** the plan's own view: the stand-in turns as it does */
  readonly plan: View;
  readonly scene: Scene;
  /** the 3D view, once it has been made */
  readonly view3d: () => View3D | null;
}

/** Has the 2D drawing tools draw in the 3D view (called once, as the editor starts). */
export function installDraw3d(d: Draw3dDeps): void {
  /** the last point the pointer met the plane at, so a release above the horizon still ends a drag */
  let last: { readonly screen: Pt; readonly raw: Pt; readonly view: View } | null = null;
  /** the preview painter while the tool paints into it, which the data bar is placed by */
  let preview: Painter | null = null;

  const elevation = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

  /** True while the tool draws on a design layer (a sheet layer's objects aren't in the model). */
  const onDesignLayer = (): boolean => !!store.activeLayerId && d.scene.layer(store.activeLayerId)?.kind === "design";

  const feed = (phase: "down" | "move" | "up", e: PointerEvent): void => {
    const v = d.view3d();
    if (!v) return;
    const z = elevation();
    const rect = v.domElement.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const hit = v.pointOnPlane(e, [0, 0, z], [0, 0, 1]);
    if (!hit) {
      // the pointer looks above the horizon: a release ends the gesture where it last met the plane
      if (phase === "up" && last) d.controller.feed("up", e, last.screen, last.raw, last.view);
      else d.controller.leave3d();
      v.repaintDrawer();
      return;
    }
    const raw = { x: hit[0], y: hit[1] };
    const view = standIn(v, raw, screen, z, rect.width, rect.height);
    last = { screen, raw, view };
    d.controller.feed(phase, e, screen, raw, view);
    v.repaintDrawer();
  };

  /**
   * A plan view standing in for the 3D view about `at`: turned as the plan is, at the size a drawing unit
   * shows there (seen slantwise the ground shows shorter one way: the mean of the two ways, no less than a
   * quarter of the longer), with `at` at `screen`.
   */
  const standIn = (v: View3D, at: Pt, screen: Pt, z: number, w: number, h: number): View => {
    const project = v.projector();
    const o = project(at.x, at.y, z);
    const ax = project(at.x + 1, at.y, z);
    const ay = project(at.x, at.y + 1, z);
    const sx = Math.hypot(ax.x - o.x, ax.y - o.y);
    const sy = Math.hypot(ay.x - o.x, ay.y - o.y);
    const s = new View();
    s.setSize(w, h);
    s.rotation = d.plan.rotation;
    s.pivot = { ...d.plan.pivot };
    s.scale = Math.max(Math.sqrt(sx * sy), Math.max(sx, sy) / 4, 1e-9);
    s.keepAt(at, screen.x, screen.y);
    return s;
  };

  const paint = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
    const v = d.view3d();
    const s = d.controller.standInView;
    if (!v || !s) return;
    const z = elevation();
    const project = v.projector();
    // the tool's preview, caught in the stand-in's plan and laid on the layer's plane
    const pen = new PathRecorder();
    preview = { ctx: pen.ctx, width: s.width, height: s.height, scale: s.scale, toScreen: (p) => s.toScreen(p) };
    try {
      d.controller.standInOverlay(preview);
    } finally {
      preview = null;
      pen.done();
    }
    pen.replay(ctx, (q) => {
      const p = s.toWorld(q.x, q.y);
      return project(p.x, p.y, z);
    });
    // the snap marker and the datum over it, where their points show
    const marks: Painter = {
      ctx,
      width: w,
      height: h,
      scale: s.scale,
      toScreen: (p) => {
        const c = project(p.x, p.y, z);
        return c.depth > 0 ? c : OFF;
      },
    };
    d.controller.standInMarks(marks);
  };

  const drawer: ViewDrawer = {
    down: (e) => feed("down", e),
    move: (e) => feed("move", e),
    up: (e) => feed("up", e),
    leave: () => {
      d.controller.leave3d();
      dataBar.hideIfIdle();
      d.view3d()?.repaintDrawer();
    },
    paint,
  };

  // the data bar beside the pointer in the 3D view: a place in the stand-in's plan goes where it shows there
  dataBar.setRedirect((screen, box) => {
    const s = d.controller.standInView;
    if (!s) return undefined;
    // the plan placing it while the tool draws in 3D
    if (box !== s && box !== preview) return null;
    const v = d.view3d();
    if (!v?.visible) return null;
    const p = s.toWorld(screen.x, screen.y);
    const c = v.projector()(p.x, p.y, elevation());
    if (c.depth <= 0) return null;
    const wrap = byId("canvas-wrap").getBoundingClientRect();
    const at = v.domElement.getBoundingClientRect();
    return { screen: { x: c.x + at.left - wrap.left, y: c.y + at.top - wrap.top }, box: { width: wrap.width, height: wrap.height } };
  });

  /** The tool draws in the 3D view while it is one that can, a drawing is open on a design layer and the view shows. */
  const sync = (): void => {
    const v = d.view3d();
    if (!v) return;
    const on = DRAWS_IN_3D.has(store.tool) && !!store.session && onDesignLayer();
    v.setDrawer(on ? drawer : null);
    if (!on || !v.visible) {
      last = null;
      d.controller.leave3d(true);
    }
    queueFlat();
  };

  let flatQueued = false;
  let flatShown = false;
  const queueFlat = (): void => {
    if (flatQueued) return;
    flatQueued = true;
    requestAnimationFrame(() => {
      flatQueued = false;
      showFlat();
    });
  };

  /** The visible design layers' 2D objects as lines on their planes, while a tool draws in 3D or the look opens in 3D. */
  const showFlat = (): void => {
    const v = d.view3d();
    const s = store.session;
    if (!v) return;
    const wanted = !!s && (lookCanvas()?.start3d === true || DRAWS_IN_3D.has(store.tool));
    if (!s || !wanted) {
      if (flatShown) v.setFlatLines(null);
      flatShown = false;
      return;
    }
    const hidden = hiddenObjects();
    const segments: number[] = [];
    const chosen: number[] = [];
    let count = 0;
    const layers = d.scene.drawnLayers(store.activeLayerId).filter((l) => l.kind === "design");
    // the active layer's first, should there be too many to show
    layers.sort((a, b) => Number(b.id === store.activeLayerId) - Number(a.id === store.activeLayerId));
    outer: for (const layer of layers) {
      for (const o of s.doc.objects(layer.id)) {
        if (o.parentId !== null || !FLAT_TYPES.has(o.type) || hidden.has(o.id)) continue;
        if (++count > MAX_FLAT) break outer;
        const c = s.curvePoints(o.id);
        if (!c) continue;
        const into = store.selection.has(o.id) ? chosen : segments;
        const n = c.points.length;
        for (let i = 0; i < (c.closed ? n : n - 1); i++) into.push(...c.points[i], ...c.points[(i + 1) % n]);
      }
    }
    v.setFlatLines(segments.length || chosen.length ? segments : null, chosen);
    flatShown = segments.length + chosen.length > 0;
  };

  // the 3D view is made the first time it is shown, before "view3d" says so
  store.on(["tool", "session", "layer", "view3d"], sync);
  store.on("selection", queueFlat);
  onLookCanvas(queueFlat);
  onHiddenChange(queueFlat);
}

// ---- a tool's preview, caught as paths and painted again elsewhere ------------------------------

interface Sub {
  readonly pts: Pt[];
  closed: boolean;
}

type Style = string | CanvasGradient | CanvasPattern;

type Op =
  | { readonly kind: "stroke"; readonly subs: readonly Sub[]; readonly style: Style; readonly width: number; readonly dash: number[]; readonly alpha: number; readonly cap: CanvasLineCap; readonly join: CanvasLineJoin }
  | { readonly kind: "fill"; readonly subs: readonly Sub[]; readonly style: Style; readonly alpha: number }
  | { readonly kind: "text"; readonly text: string; readonly at: Pt; readonly font: string; readonly style: Style; readonly align: CanvasTextAlign; readonly baseline: CanvasTextBaseline; readonly alpha: number };

/** the context the recorder's own state (styles, transforms, text measures) is kept in */
let scratch: CanvasRenderingContext2D | null = null;

/** How many pieces an arc of `sweep` radians is drawn in. */
const piecesOf = (sweep: number): number => Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 48)));

/** An arc's sweep, as the canvas reads its angles: clockwise on screen unless `ccw`, a whole turn at most. */
function sweepOf(a0: number, a1: number, ccw: boolean): number {
  const turn = Math.PI * 2;
  if (!ccw) {
    if (a1 - a0 >= turn) return turn;
    const s = (a1 - a0) % turn;
    return s < 0 ? s + turn : s;
  }
  if (a0 - a1 >= turn) return -turn;
  const s = (a0 - a1) % turn;
  return -(s < 0 ? s + turn : s);
}

/**
 * A 2D canvas context that keeps what is stroked, filled and written as paths (arcs, ellipses and curves
 * in short straight pieces) in its own pixels, with their styles, to paint again through another mapping
 * (replay). Everything else (styles, transforms, measuring text) goes to a scratch context.
 */
export class PathRecorder {
  readonly ctx: CanvasRenderingContext2D;
  private readonly real: CanvasRenderingContext2D;
  private readonly ops: Op[] = [];
  private subs: Sub[] = [];
  private cur: Sub | null = null;

  constructor() {
    scratch ??= document.createElement("canvas").getContext("2d");
    if (!scratch) throw new Error("no 2D canvas");
    const real = scratch;
    this.real = real;
    real.save();
    real.setTransform(1, 0, 0, 1, 0, 0);
    const own: Record<string, (...a: never[]) => unknown> = {
      beginPath: () => {
        this.subs = [];
        this.cur = null;
      },
      moveTo: (x: number, y: number) => this.start(this.at(x, y)),
      lineTo: (x: number, y: number) => this.to(this.at(x, y)),
      closePath: () => {
        if (!this.cur) return;
        this.cur.closed = true;
        this.start(this.cur.pts[0]);
      },
      // a rectangle is a closed path of its own, and the next one starts at its corner
      rect: (x: number, y: number, w: number, h: number) => {
        this.addRect(this.subs, x, y, w, h);
        this.start(this.at(x, y));
      },
      roundRect: (x: number, y: number, w: number, h: number) => {
        this.addRect(this.subs, x, y, w, h);
        this.start(this.at(x, y));
      },
      arc: (x: number, y: number, r: number, a0: number, a1: number, ccw = false) => this.ellipse(x, y, r, r, 0, a0, a1, ccw),
      ellipse: (x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) => this.ellipse(x, y, rx, ry, rot, a0, a1, ccw),
      arcTo: (x1: number, y1: number) => this.to(this.at(x1, y1)),
      quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => this.curve([cx, cy], [cx, cy], [x, y], true),
      bezierCurveTo: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => this.curve([c1x, c1y], [c2x, c2y], [x, y], false),
      stroke: (path?: unknown) => {
        if (path === undefined) this.push("stroke", this.subs);
      },
      fill: (path?: unknown) => {
        if (path === undefined || typeof path === "string") this.push("fill", this.subs);
      },
      strokeRect: (x: number, y: number, w: number, h: number) => {
        const subs: Sub[] = [];
        this.addRect(subs, x, y, w, h);
        this.push("stroke", subs);
      },
      fillRect: (x: number, y: number, w: number, h: number) => {
        const subs: Sub[] = [];
        this.addRect(subs, x, y, w, h);
        this.push("fill", subs);
      },
      fillText: (text: string, x: number, y: number) => this.text(text, x, y),
      strokeText: (text: string, x: number, y: number) => this.text(text, x, y),
      clearRect: () => {},
      clip: () => {},
      drawImage: () => {},
    };
    this.ctx = new Proxy(real, {
      get: (target, key) => {
        if (typeof key === "string" && key in own) return own[key];
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
      set: (target, key, value) => Reflect.set(target, key, value),
    });
  }

  /** Puts the scratch context back as it was: called once the tool has painted. */
  done(): void {
    this.real.restore();
  }

  /**
   * Paints what was caught on `ctx`, each point placed by `place` (a point of the recorder's pixels to
   * where it shows, with how far in front of the camera); a straight piece reaching behind the camera is
   * cut where it meets its near plane.
   */
  replay(ctx: CanvasRenderingContext2D, place: (q: Pt) => CanvasPoint): void {
    for (const op of this.ops) {
      ctx.save();
      ctx.globalAlpha = op.alpha;
      if (op.kind === "text") {
        const at = place(op.at);
        if (at.depth > 0) {
          ctx.font = op.font;
          ctx.fillStyle = op.style;
          ctx.textAlign = op.align;
          ctx.textBaseline = op.baseline;
          ctx.fillText(op.text, at.x, at.y);
        }
      } else {
        ctx.beginPath();
        for (const sub of op.subs) trace(ctx, sub, place);
        if (op.kind === "stroke") {
          ctx.strokeStyle = op.style;
          ctx.lineWidth = op.width;
          ctx.lineCap = op.cap;
          ctx.lineJoin = op.join;
          ctx.setLineDash(op.dash);
          ctx.stroke();
        } else {
          ctx.fillStyle = op.style;
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /** A point of the tool's drawing in the recorder's pixels, through the context's transform. */
  private at(x: number, y: number): Pt {
    const m = this.real.getTransform();
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
  }

  private start(p: Pt): void {
    this.cur = { pts: [p], closed: false };
    this.subs.push(this.cur);
  }

  private to(p: Pt): void {
    if (!this.cur) this.start(p);
    else this.cur.pts.push(p);
  }

  private addRect(subs: Sub[], x: number, y: number, w: number, h: number): void {
    subs.push({ pts: [this.at(x, y), this.at(x + w, y), this.at(x + w, y + h), this.at(x, y + h)], closed: true });
  }

  private ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw: boolean): void {
    const sweep = sweepOf(a0, a1, ccw);
    const n = piecesOf(sweep);
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      // the canvas's arc joins the path's last point to its start
      this.to(this.at(x + ex * c - ey * s, y + ex * s + ey * c));
    }
  }

  private curve(c1: readonly number[], c2: readonly number[], end: readonly number[], quadratic: boolean): void {
    const from = this.cur?.pts[this.cur.pts.length - 1];
    if (!from) return;
    // back in the context's own units: the transform taken off the last point
    const inv = this.real.getTransform().inverse();
    const p0 = { x: inv.a * from.x + inv.c * from.y + inv.e, y: inv.b * from.x + inv.d * from.y + inv.f };
    const n = 16;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const x = quadratic ? u * u * p0.x + 2 * u * t * c1[0] + t * t * end[0] : u * u * u * p0.x + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0];
      const y = quadratic ? u * u * p0.y + 2 * u * t * c1[1] + t * t * end[1] : u * u * u * p0.y + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1];
      this.to(this.at(x, y));
    }
  }

  private push(kind: "stroke" | "fill", subs: readonly Sub[]): void {
    const r = this.real;
    const copy = subs.map((sub) => ({ pts: [...sub.pts], closed: sub.closed }));
    if (kind === "stroke") {
      // a width scaled by the transform as the canvas would
      const m = r.getTransform();
      const k = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      this.ops.push({ kind, subs: copy, style: r.strokeStyle, width: r.lineWidth * k, dash: r.getLineDash(), alpha: r.globalAlpha, cap: r.lineCap, join: r.lineJoin });
    } else {
      this.ops.push({ kind, subs: copy, style: r.fillStyle, alpha: r.globalAlpha });
    }
  }

  private text(text: string, x: number, y: number): void {
    const r = this.real;
    this.ops.push({ kind: "text", text, at: this.at(x, y), font: r.font, style: r.fillStyle, align: r.textAlign, baseline: r.textBaseline, alpha: r.globalAlpha });
  }
}

/** Adds a path's straight pieces to `ctx`'s path, as `place` puts their ends, cut at the camera's near plane. */
function trace(ctx: CanvasRenderingContext2D, sub: Sub, place: (q: Pt) => CanvasPoint): void {
  const pts = sub.closed && sub.pts.length > 2 ? [...sub.pts, sub.pts[0]] : sub.pts;
  if (pts.length === 0) return;
  let q0 = pts[0];
  let a = place(q0);
  let pen = false;
  /** a piece was cut at the near plane: the path isn't closed where it began */
  let cut = a.depth <= 0;
  if (a.depth > 0) {
    ctx.moveTo(a.x, a.y);
    pen = true;
  }
  for (let i = 1; i < pts.length; i++) {
    const q1 = pts[i];
    const b = place(q1);
    if (a.depth > 0 && b.depth > 0) {
      if (!pen) ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      pen = true;
    } else if (a.depth > 0 !== b.depth > 0) {
      cut = true;
      // the depth runs evenly along a straight piece on the plane: cut it where it reaches the near plane
      const t = (1e-6 - a.depth) / (b.depth - a.depth);
      const m = place({ x: q0.x + (q1.x - q0.x) * t, y: q0.y + (q1.y - q0.y) * t });
      if (a.depth > 0) {
        if (!pen) ctx.moveTo(a.x, a.y);
        ctx.lineTo(m.x, m.y);
        pen = false;
      } else {
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(b.x, b.y);
        pen = true;
      }
    } else {
      pen = false;
      cut = true;
    }
    q0 = q1;
    a = b;
  }
  if (sub.closed && !cut && pts.length > 3) ctx.closePath();
}
