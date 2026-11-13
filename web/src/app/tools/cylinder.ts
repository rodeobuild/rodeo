// The Cylinder tool, a 3D Modeling primitive drawn as the Cone tool is: the centre of the base, then
// the radius (Tab types it), with the height in Preferences. It makes a circle extruded up its height,
// standing on the layer, so its top is the size of its base, as Model > Extrude makes it (the drawing
// needs nothing else for it). One undo step.

import type { Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dist } from "../geom.ts";
import { type ToolId } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { CircleTool } from "./draw.ts";

const MIN_WORLD = 1e-9;
/** the height a new cylinder starts with, in millimetres: a metre, as the Cone's */
const START_HEIGHT = 1000;

/** Asks for a height (mm) in `title`; null when cancelled. */
async function askHeight(title: string, height: number): Promise<number | null> {
  const v = await toolPrefs(title, [{ kind: "length", key: "height", label: "Height", value: height }]);
  return v ? v.num("height") : null;
}

/** The Cylinder tool: centre, then radius, then a circle extruded its height (mm) from Preferences. */
export class CylinderTool extends CircleTool {
  override readonly id: ToolId = "cylinder";
  private height = START_HEIGHT;

  override hint(): string {
    return this.start
      ? "Click or release to set the base's radius · Tab radius"
      : "Click or drag from the base's centre · Tab X, Y · the height is in Preferences";
  }

  /** Opens the Cylinder Preferences and keeps the height the user gives. */
  async preferences(): Promise<void> {
    const h = await askHeight("Cylinder Preferences", this.height);
    if (h !== null) this.height = h;
  }

  protected override commit(center: Pt, edge: Pt): void {
    const r = dist(center, edge);
    if (r <= MIN_WORLD) return;
    const height = this.height;
    addAndSelect({ kind: "arc", center, radius: r, startAngle: 0, sweepAngle: 360 }, undefined, (s, id) => s.extrudeObjects([id], height)[0]);
  }
}
