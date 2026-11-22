// Plug-in Insertion tool (Insertion): places plug-in objects of a kind the drawing has (columns and
// beams, plants, cabinets, stairs, grid lines, spaces...) by copying one: press where its insertion
// point goes, and drag to turn it (Shift: 15° steps); a click keeps the turn the copied one has.
// Preferences chooses the kind, one per plug-in. The copy keeps the copied object's class,
// parameters and drawing (Rodeo can't redraw a plug-in from its parameters); Object Info edits its
// parameters afterwards. It is selected, and the tool stays active for more.
//
// It also places the plug-ins a feature can draw from their parameters (installed Vectorworks
// plug-ins, ext.ts PluginDriver), new ones with their default parameters: a point object as a copy
// is placed, a linear one by dragging from its start to its end, a rectangular one by dragging
// across it. A click on a straight wall puts a point or linear one on the wall's centre line, turned
// along the wall (it is not set into the wall: it doesn't cut it or move with it). A path one is drawn
// by clicks at its corners: a double-click or Enter ends it, Esc leaves it; a drag alone makes a
// straight one of two corners.

import type { ObjectInfo, PluginKind, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { pluginDriver, pluginDrivers, takePreferredDriver, type PluginDriver } from "../ext.ts";
import { dist, snapAngle } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";
import { toast } from "../toast.ts";

/** a press that moves less than this many CSS px is a click, not a drag that turns */
const DRAG_PX = 4;
/** a corner clicked this close to the last one is the same corner, CSS px */
const CLICK_PX = 4;
/** Shift turns the copy in steps of this, degrees */
const ANGLE_STEP_DEG = 15;
/** arm length of the insertion-point cross, CSS px */
const CROSS_PX = 6;
/** a choice's id for a plug-in a feature draws: this and its name */
const DRIVER = "driver:";
/** the kind of a wall (Vectorworks' wall object, as the drawing's object types have it) */
const WALL = 68;

/** The plug-ins a feature draws that this tool offers: those with no tool of their own. */
const insertable = (): PluginDriver[] => pluginDrivers().filter((d) => !d.builtIn);

/** What the tool places: a copy of a kind the drawing has, or a plug-in a feature draws. */
type Choice = { readonly kind: PluginKind; readonly driver?: undefined } | { readonly driver: PluginDriver; readonly kind?: undefined };

export class PluginInsertTool extends BaseTool {
  readonly id = "plugin";
  readonly cursor = "crosshair";
  /** the plug-in object a new one copies (PluginKind.id), once one has been chosen */
  private kind: string | null = null;
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;
  /** where the press went down: the insertion point while a drag turns the copy */
  private start: { pos: Pt; screen: Pt } | null = null;
  /** the pointer while a drag turns the copy */
  private drag: PointerInfo | null = null;
  /** the corners of a path object being drawn, once its first is clicked */
  private path: Pt[] | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const kinds = store.session?.pluginKinds() ?? [];
    const drivers = insertable();
    if (!kinds.length && !drivers.length) return;
    const options = [
      ...kinds.map((k) => ({ value: k.id, label: `${k.name} (${k.count})` })),
      ...drivers.map((d) => ({ value: DRIVER + d.name, label: `${d.name} (installed)` })),
    ];
    const c = this.current();
    const v = await toolPrefs(
      "Plug-in Insertion Preferences",
      [{ kind: "choice", key: "kind", label: "Plug-in", value: c?.kind?.id ?? (c?.driver ? DRIVER + c.driver.name : options[0].value), options }],
      "A new plug-in object copies one the drawing has of that kind: its class, parameters and drawing. An installed plug-in draws a new one from its default parameters.",
    );
    if (v) this.kind = v.choice("kind");
  }

  /** Create Similar Object: new objects copy one of this object's plug-in (or are drawn by it, when installed). */
  takeFrom(obj: ObjectInfo): boolean {
    const name = store.session?.doc.records(obj.id).find((r) => r.parametric)?.name;
    const kind = (store.session?.pluginKinds() ?? []).find((k) => k.name === name);
    const driver = name === undefined ? undefined : pluginDriver(name);
    if (kind) this.kind = kind.id;
    else if (driver) this.kind = DRIVER + driver.name;
    return kind !== undefined || driver !== undefined;
  }

  hint(): string {
    const c = this.current();
    if (!c) return "This drawing has no plug-in object to copy";
    const d = c.driver;
    if (d?.shape === "path") {
      if (this.path) return `Click the next corner of a ${d.name} · Double-click or Enter ends it · Esc cancels`;
      return `Click each corner of a ${d.name}, or drag for a straight one · Preferences picks the plug-in`;
    }
    if (d?.shape === "linear") return this.start ? `Release at the end of the ${d.name} · Shift ${ANGLE_STEP_DEG}°` : `Drag from the start of a ${d.name} to its end · Preferences picks the plug-in`;
    if (d?.shape === "rect") return this.start ? `Release at the opposite corner` : `Drag across a ${d.name}'s rectangle · Preferences picks the plug-in`;
    if (this.start) return `Release where it faces · Shift ${ANGLE_STEP_DEG}°`;
    return `Click to place a ${c.kind?.name ?? d?.name}, or drag to turn it · Preferences picks the plug-in`;
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
    if (this.start) this.drag = p;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    this.start = { pos: p.pos, screen: p.screen };
    this.drag = null;
  }

  up(p: PointerInfo): void {
    const start = this.start;
    this.start = null;
    this.drag = null;
    const c = this.current();
    const layerId = store.activeLayerId;
    if (!start || !c || !layerId) return;
    const dragged = Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) >= DRAG_PX;
    const angle = dragged ? this.angleTo(start.pos, p) : undefined;
    if (c.driver?.shape === "path") {
      this.clickPath(c.driver, layerId, start.pos, p, dragged);
      return;
    }
    if (c.driver) {
      // a click on a straight wall sets a point or linear plug-in on its centre line, turned along it
      const wall = !dragged && c.driver.shape !== "rect" ? this.wallAt(start.screen) : null;
      if (wall) {
        const line = this.centreLine(wall, start.pos);
        c.driver.place(layerId, line.at, line.angle, null);
        return;
      }
      this.placeNew(c.driver, layerId, start.pos, dragged ? this.endOf(start.pos, p) : null);
      return;
    }
    const k = c.kind;
    const r = attempt("Insert Plug-in Object", (s) => s.insertPlugin(k.id, layerId, start.pos, angle));
    // the copy goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.path || e.key !== "Enter") return false;
    const c = this.current();
    if (c?.driver?.shape === "path") this.finishPath(c.driver);
    return true;
  }

  cancel(): void {
    this.start = null;
    this.drag = null;
    this.path = null;
  }

  overlay(g: Painter): void {
    const c = this.current();
    if (c?.driver?.shape === "path") {
      // the corners so far, and the line from the last one to the pointer
      const path = this.path ?? [];
      const at = this.at;
      if (path.length && at) withPreview(g, () => strokeScreen(g, [...path, at], false));
      if (at) this.cross(g, at);
      return;
    }
    const at = this.start?.pos ?? this.at;
    if (!c || !at) return;
    const end = this.drag && this.start ? this.endOf(this.start.pos, this.drag) : null;
    if (c.driver && end && c.driver.shape !== "point") {
      const outline = c.driver.shape === "linear" ? [at, end] : [at, { x: end.x, y: at.y }, end, { x: at.x, y: end.y }];
      withPreview(g, () => strokeScreen(g, outline, c.driver.shape === "rect"));
    }
    const k = c.kind;
    if (k) {
      const turn = this.drag && this.start && dist(this.start.pos, this.drag.pos) > 0 ? this.angleTo(this.start.pos, this.drag) - k.angle : 0;
      const rad = (turn * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const outline = k.outline.map((q) => ({ x: at.x + cos * q.x - sin * q.y, y: at.y + sin * q.x + cos * q.y }));
      withPreview(g, () => strokeScreen(g, outline, true));
    }
    this.cross(g, at);
  }

  /** The insertion point's cross. */
  private cross(g: Painter, at: Pt): void {
    const o = g.toScreen(at);
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x - CROSS_PX, o.y);
    ctx.lineTo(o.x + CROSS_PX, o.y);
    ctx.moveTo(o.x, o.y - CROSS_PX);
    ctx.lineTo(o.x, o.y + CROSS_PX);
    ctx.stroke();
    ctx.restore();
  }

  /** What a new object is: the choice made, while the drawing has that kind or it is still installed, else the first there is. */
  private current(): Choice | null {
    const wanted = takePreferredDriver();
    if (wanted) this.kind = DRIVER + wanted;
    const kinds = store.session?.pluginKinds() ?? [];
    const kind = kinds.find((k) => k.id === this.kind);
    if (kind) return { kind };
    const driver = this.kind?.startsWith(DRIVER) ? pluginDriver(this.kind.slice(DRIVER.length)) : undefined;
    if (driver) return { driver };
    if (kinds[0]) return { kind: kinds[0] };
    const first = insertable()[0];
    return first ? { driver: first } : null;
  }

  /**
   * A press on a path object's drawing: a corner is added where it is released (a click), a press
   * dragged from nothing draws a straight path of two corners, and a double-click ends the path.
   */
  private clickPath(d: PluginDriver, layerId: string, from: Pt, p: PointerInfo, dragged: boolean): void {
    if (!this.path && dragged) {
      d.placePath?.(layerId, [from, this.endOf(from, p)], false);
      return;
    }
    const at = this.endOf(from, p);
    const path = (this.path ??= []);
    const last = path.at(-1);
    if (!last || dist(last, at) * this.env.view.scale > CLICK_PX) path.push(at);
    if (p.detail >= 2) this.finishPath(d);
  }

  /** Places the path object drawn so far (two corners at least) and ends the path. */
  private finishPath(d: PluginDriver): void {
    const path = this.path ?? [];
    const layerId = store.activeLayerId;
    this.path = null;
    if (path.length < 2 || !layerId) {
      if (path.length < 2) toast(`A ${d.name} needs at least two corners.`, "info");
      return;
    }
    d.placePath?.(layerId, path, false);
  }

  /** The wall of the active layer (or of the group being edited) whose plan drawing is under `screen`, or null. */
  private wallAt(screen: Pt): string | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    const hit = pickObject(this.env.scene, this.env.view, screen, [layerId], (o) => {
      const unit = isDerivedId(o.id) ? null : this.env.scene.unitOf(o, store.editGroupId);
      return unit !== null && store.session?.doc.object(unit)?.type === WALL;
    });
    if (!hit || isDerivedId(hit.id)) return null;
    return this.env.scene.unitOf(hit, store.editGroupId);
  }

  /** The point on wall `id`'s centre line nearest `from`, and the wall's direction in degrees; a straight wall only. */
  private centreLine(id: string, from: Pt): { at: Pt; angle: number } {
    const w = store.session?.doc.wall(id);
    if (!w) return { at: from, angle: 0 };
    const len = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (!(len > 0)) return { at: from, angle: 0 };
    const u = { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
    const t = Math.min(len, Math.max(0, (from.x - w.start.x) * u.x + (from.y - w.start.y) * u.y));
    return { at: { x: w.start.x + u.x * t, y: w.start.y + u.y * t }, angle: (Math.atan2(u.y, u.x) * 180) / Math.PI };
  }

  /** Where a drag from `from` ends: the pointer, along 15° steps with Shift. */
  private endOf(from: Pt, p: PointerInfo): Pt {
    return p.shift ? snapAngle(from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  /**
   * Places a plug-in a feature draws: from a click, at the point unturned; from a drag, a point object
   * turned to face its end, a linear one along it, a rectangular one across it (its origin is the
   * middle of the rectangle's left side, as in Vectorworks).
   */
  private placeNew(d: PluginDriver, layerId: string, from: Pt, to: Pt | null): void {
    if (!to) {
      d.place(layerId, from, 0, null);
      return;
    }
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    if (d.shape === "point") d.place(layerId, from, angle, null);
    else if (d.shape === "linear") d.place(layerId, from, angle, { width: dist(from, to), height: 0 });
    else {
      const x0 = Math.min(from.x, to.x);
      const y0 = Math.min(from.y, to.y);
      const y1 = Math.max(from.y, to.y);
      d.place(layerId, { x: x0, y: (y0 + y1) / 2 }, 0, { width: Math.abs(to.x - from.x), height: y1 - y0 });
    }
  }

  /** The way a copy placed at `from` faces when the drag is at `p`, degrees (Shift: 15° steps). */
  private angleTo(from: Pt, p: PointerInfo): number {
    const to = this.endOf(from, p);
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  }
}
