// Door and Window tools (Building Shell): a click on a straight wall sets a door or window in it, drawn from the tool's own
// settings (Preferences: its configuration and size, and a window's sill), with its opening cut in the wall (doorWindow.ts).
// The side clicked is the side it opens to. Create Similar Object copies a door's or window's settings into the tool.

import type { ObjectInfo, Pt, RecordValue } from "../../core/index.ts";
import { DOOR_CONFIGS, WINDOW_CONFIGS, type Pt as PlanPt } from "../doorWindowShapes.ts";
import { buildFrom, DOOR, getterOf, type Kind } from "../doorWindowDraw.ts";
import { placeInWall } from "../doorWindow.ts";
import { attempt, setSelection } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { ACCENT } from "../renderer.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";
import { doorParams, windowParams } from "../doorWindowFields.ts";

const WALL = 68;
/** the arc of a casement or a swing, sampled for the hover preview */
const ARC_STEPS = 24;

/** the settings a new door or window is drawn with; the Preferences dialog changes them */
interface Settings {
  config: string;
  width: number;
  height: number;
  /** a window's sill height above the wall's bottom, mm */
  sill: number;
}

const DEFAULTS: Readonly<Record<Kind, Settings>> = {
  Door: { config: "Swing Simple", width: 900, height: 2100, sill: 0 },
  Window: { config: "Fixed Glass", width: 1200, height: 1200, sill: 900 },
};

const HINT: Readonly<Record<Kind, string>> = {
  Door: "Click a wall to set a door in it · the side you click is the side it opens to · Preferences sets its size",
  Window: "Click a wall to set a window in it · the side you click is the side it opens to · Preferences sets its size",
};

/** A wall's line on the plan, as the tool places along it. */
interface WallLine {
  readonly start: Pt;
  readonly u: Pt;
  readonly thickness: number;
}

export class WallInsertTool extends BaseTool {
  readonly cursor = "crosshair";
  private settings: Settings;
  /** the wall under the pointer, the pointer on the plan, and which side of the wall it is on */
  private hover: { readonly wall: string; readonly at: Pt; readonly flipped: boolean } | null = null;

  constructor(
    env: ToolEnv,
    readonly id: "door" | "window",
    /** the plug-in it sets: "Door" or "Window" */
    private readonly plugin: Kind,
  ) {
    super(env);
    this.settings = { ...DEFAULTS[plugin] };
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.hover = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const s = this.settings;
    const v = await toolPrefs(
      `${this.plugin} Preferences`,
      this.plugin === DOOR
        ? [
            { kind: "choice", key: "config", label: "Configuration", value: s.config, options: DOOR_CONFIGS.map((c) => ({ value: c, label: c })) },
            { kind: "length", key: "width", label: "Width", value: s.width },
            { kind: "length", key: "height", label: "Height", value: s.height },
          ]
        : [
            { kind: "choice", key: "config", label: "Sash", value: s.config, options: WINDOW_CONFIGS.map((c) => ({ value: c, label: c })) },
            { kind: "length", key: "width", label: "Width", value: s.width },
            { kind: "length", key: "height", label: "Height", value: s.height },
            { kind: "length", key: "sill", label: "Sill Height", value: s.sill },
          ],
      this.id === "door" ? "A new door is drawn with these settings, in any straight wall." : "A new window is drawn with these settings, in any straight wall.",
    );
    if (!v) return;
    this.settings = { config: v.choice("config"), width: v.num("width"), height: v.num("height"), sill: v.num("sill") };
  }

  /** Create Similar Object: new ones take this door's or window's configuration and size. */
  takeFrom(obj: ObjectInfo): boolean {
    const doc = store.session?.doc;
    if (!doc) return false;
    const rec = doc.records(obj.id).find((r) => r.parametric && r.name === this.plugin);
    if (!rec) return false;
    const get = getterOf(this.plugin, Object.fromEntries(rec.fields.map((f) => [f.name, f.value])));
    if (this.plugin === DOOR) {
      const p = doorParams(get, 0);
      this.settings = { ...this.settings, config: p.config, width: p.width, height: p.height };
    } else {
      const p = windowParams(get, 0);
      this.settings = { ...this.settings, config: p.config, width: p.width, height: p.height, sill: p.sill };
    }
    return true;
  }

  hint(): string {
    return HINT[this.plugin];
  }

  move(p: PointerInfo): void {
    const wall = this.wallAt(p.screen);
    const line = wall ? this.lineOf(wall) : null;
    this.hover = wall && line ? { wall, at: p.pos, flipped: this.rightOf(line, p.pos) } : null;
  }

  down(p: PointerInfo): void {
    const wall = this.wallAt(p.screen);
    if (!wall) {
      if (this.pickWith(p.screen, (o) => this.isPlugin(o))) toast(this.id === "door" ? "The Door tool sets a door in a wall: click a wall." : "The Window tool sets a window in a wall: click a wall.", "info");
      return;
    }
    const line = this.lineOf(wall);
    if (!line) {
      toast(this.id === "door" ? "A door goes in a straight wall." : "A window goes in a straight wall.", "info");
      return;
    }
    const facing = { flipped: this.rightOf(line, p.pos) };
    const r = attempt(`Insert ${this.plugin}`, (s) => placeInWall(s, this.plugin, wall, p.pos, this.values(), facing));
    if (r) setSelection([r.value]);
  }

  cancel(): void {
    this.hover = null;
  }

  overlay(g: Painter): void {
    const hover = this.hover;
    if (!hover) return;
    const line = this.lineOf(hover.wall);
    this.outline(g, hover.wall, line ? 0.5 : 0.2);
    if (!line) return;
    // the door or window as it would be drawn: its origin where the pointer lies along the wall, and its
    // y turned to the side the pointer is on (the side it opens to)
    const built = buildFrom(this.plugin, getterOf(this.plugin, this.values()), line.thickness);
    const t = (hover.at.x - line.start.x) * line.u.x + (hover.at.y - line.start.y) * line.u.y;
    const sign = hover.flipped ? -1 : 1;
    const n = { x: -line.u.y, y: line.u.x };
    const map = (q: PlanPt): Pt => ({
      x: line.start.x + line.u.x * (t + q.x) + n.x * sign * q.y,
      y: line.start.y + line.u.y * (t + q.x) + n.y * sign * q.y,
    });
    const { x0, x1 } = built.drawn.opening;
    const half = line.thickness / 2;
    withPreview(g, () => {
      strokeScreen(g, [map({ x: x0, y: -half }), map({ x: x1, y: -half }), map({ x: x1, y: half }), map({ x: x0, y: half })], true);
      for (const p of built.drawn.plan) {
        if (p.arc) {
          const a = p.arc;
          const pts: PlanPt[] = [];
          for (let k = 0; k <= ARC_STEPS; k++) {
            const th = ((a.start + (a.sweep * k) / ARC_STEPS) * Math.PI) / 180;
            pts.push({ x: a.centre.x + a.radius * Math.cos(th), y: a.centre.y + a.radius * Math.sin(th) });
          }
          strokeScreen(g, pts.map(map), false);
        } else {
          strokeScreen(g, p.points.map(map), p.closed);
        }
      }
    });
  }

  /** the parameters a new one is placed with, from the settings */
  private values(): Record<string, RecordValue> {
    const s = this.settings;
    if (this.plugin === DOOR) return { Config: s.config, DoorWidth: s.width, DoorHeight: s.height };
    // Elevation is the head's height (ElevationSetAt "Head of Window"), so the sill is Elevation less the height
    return { SashOperation: s.config, Width: s.width, Height: s.height, Elevation: s.sill + s.height, ElevationSetAt: "Head of Window" };
  }

  /** Whether the point lies on the right of the wall's direction (its y axis in plan, as the wall is drawn). */
  private rightOf(line: WallLine, at: Pt): boolean {
    const rx = at.x - line.start.x;
    const ry = at.y - line.start.y;
    return line.u.x * ry - line.u.y * rx < 0;
  }

  /** The line of `wallId` when it is a straight wall, else null. */
  private lineOf(wallId: string): WallLine | null {
    const w = store.session?.doc.wall(wallId);
    if (!w) return null;
    const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (!(length > 0)) return null;
    return { start: w.start, u: { x: (w.end.x - w.start.x) / length, y: (w.end.y - w.start.y) / length }, thickness: w.thickness };
  }

  /** Strokes a wall's plan drawing in the accent, as the tool's hover shows it. */
  private outline(g: Painter, wallId: string, alpha: number): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha;
    for (const o of this.env.scene.index(layerId).objects) {
      if (o.parentId !== wallId || !o.shape || o.shape.kind === "text") continue;
      strokeScreen(g, o.shape.points, o.shape.closed);
    }
    ctx.restore();
  }

  /** The wall of the active layer (or of the group being edited) whose plan drawing is under `screen`. */
  private wallAt(screen: Pt): string | null {
    const hit = this.pickWith(screen, (o) => {
      const unit = this.unit(o);
      return unit !== null && store.session?.doc.object(unit)?.type === WALL;
    });
    return hit ? this.unit(hit) : null;
  }

  private unit(o: ObjectInfo): string | null {
    return isDerivedId(o.id) ? null : this.env.scene.unitOf(o, store.editGroupId);
  }

  private isPlugin(o: ObjectInfo): boolean {
    return store.session?.doc.records(o.id).some((r) => r.parametric && r.name === this.plugin) ?? false;
  }

  private pickWith(screen: Pt, accept: (o: ObjectInfo) => boolean): ObjectInfo | null {
    const layerId = store.activeLayerId;
    if (!layerId) return null;
    return pickObject(this.env.scene, this.env.view, screen, [layerId], accept);
  }
}
