// The Torus tool, a 3D Modeling primitive: a click for the centre, a click on the middle of the tube
// (which sets the radius from the centre), and a click on the tube's edge (which sets the tube's
// radius from that middle point). The torus is a closed solid of revolution: its cross-section, a
// circle of the tube's radius, turned a full turn about the upright through the centre. Its plan is
// the outer and inner circles. Rodeo's sweeps turn a profile about its own left edge, so a circle
// cannot be swept about a centre it lies away from; the solid is therefore a mesh made by lathing the
// circle, grouped with its plan as a hybrid object (as the other 3D tools' solids are). One undo step.
// The tube must be thinner than the radius; a click that would make it thicker is ignored.

import type { NewShape, Pt } from "../../core/index.ts";
import { dist } from "../geom.ts";
import { type ToolId } from "../state.ts";
import { circleOutline, lathe, placedSolid } from "../solids3d.ts";
import { addHybrid } from "./solidTool.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";

const MIN_WORLD = 1e-9;
/** the sides a tube's circle takes in its profile */
const TUBE_SIDES = 36;

/** A whole circle as a plan shape. */
function circle(center: Pt, radius: number): NewShape {
  return { kind: "arc", center, radius, startAngle: 0, sweepAngle: 360 };
}

/** Strokes a whole circle, in screen pixels, through its centre and radius in document units. */
function strokeCircle(g: Painter, center: Pt, radius: number): void {
  const C = g.toScreen(center);
  const R = radius * g.scale;
  withPreview(g, () => {
    g.ctx.beginPath();
    g.ctx.arc(C.x, C.y, R, 0, Math.PI * 2);
    g.ctx.stroke();
  });
}

/** The Torus tool: centre, middle of the tube, then the tube's edge. */
export class TorusTool extends BaseTool {
  readonly id: ToolId = "torus";
  readonly cursor = "crosshair";

  /** the centre of the torus; null before its first click */
  private centre: Pt | null = null;
  /** a point on the middle of the tube, which fixes the radius */
  private middle: Pt | null = null;
  /** last snapped pointer position */
  private pointer: Pt | null = null;

  hint(): string {
    if (!this.centre) return "Click the torus's centre";
    if (!this.middle) return "Click the middle of the tube to set the radius";
    return "Click the tube's edge to set its radius · the tube is thinner than the radius";
  }

  /** Click 1 sets the centre, click 2 the middle of the tube, click 3 the tube's radius and the torus. */
  down(p: PointerInfo): void {
    this.pointer = p.pos;
    if (!this.centre) {
      this.centre = p.pos;
      return;
    }
    if (!this.middle) {
      if (dist(this.centre, p.pos) > MIN_WORLD) this.middle = p.pos;
      return;
    }
    const major = dist(this.centre, this.middle);
    const minor = dist(this.middle, p.pos);
    if (minor <= MIN_WORLD || minor >= major) return;
    this.build(this.centre, major, minor);
    this.reset();
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.centre) return false;
    this.reset();
    return true;
  }

  /** Shows the circles the points so far define: the centre's line and the middle circle, then the tube. */
  overlay(g: Painter): void {
    const c = this.centre;
    const p = this.pointer;
    if (!c || !p) return;
    if (!this.middle) {
      withPreview(g, () => strokeScreen(g, [c, p], false));
      strokeCircle(g, c, dist(c, p));
      return;
    }
    const major = dist(c, this.middle);
    const minor = dist(this.middle, p);
    strokeCircle(g, c, major);
    strokeCircle(g, this.middle, minor);
    if (minor > MIN_WORLD && minor < major) {
      strokeCircle(g, c, major + minor);
      strokeCircle(g, c, major - minor);
    }
  }

  /** Makes the torus: its outer and inner plan circles and its lathed solid, standing on the layer. */
  private build(center: Pt, major: number, minor: number): void {
    // the tube's circle in its own plane: x its distance from the upright, y its height above the layer
    const profile = circleOutline({ x: major, y: minor }, minor, TUBE_SIDES);
    const solid = placedSolid(lathe(profile), center, 0);
    addHybrid("Torus", [circle(center, major + minor), circle(center, major - minor)], solid);
  }

  private reset(): void {
    this.centre = null;
    this.middle = null;
    this.pointer = null;
  }
}
