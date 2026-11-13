// View › Work Like: the command-line reports of a look. AREA, LENGTH and LIST print facts about the
// selected objects as lines of text for the command line's history; REGEN draws everything again.
// The numbers come from the same measurements Object Info shows (dimension.ts measureShape) and are
// written in the drawing's units by the same formatters (units.ts), so they match the palette.
import { changeHidden } from "../hiddenObjects.ts";
import { selectedObjects } from "../compose.ts";
import { measureShape, type Measurement } from "../dimension.ts";
import { shapeBBox } from "../shapes.ts";
import { store } from "../state.ts";
import { formatArea, formatLength, formatLengthValue, lengthSuffix } from "../units.ts";
import type { ObjectInfo } from "../../core/index.ts";

/** Objects LIST writes out in full; the rest are counted on one last line. */
const LIST_MAX = 20;

/** The drawing's units as the document has them (undefined before a drawing opens). */
function units(): string | undefined {
  return store.session?.doc.info.units;
}

/** An object's measurement as Object Info takes it, or null when it has none (text, images, groups). */
function measureOf(o: ObjectInfo): Measurement | null {
  return o.shape ? measureShape(o.shape) : null;
}

/** Type names Object Info writes otherwise than as their words in Title Case. */
const TYPE_TITLES: Readonly<Record<string, string>> = { locus: "2D Locus", "plug-in-object": "Plug-in Object" };

/**
 * An object's kind as Object Info names it in its heading: "Rectangle", "3D Polygon", a plug-in
 * object's plug-in name ("Door"), or "Object" for a type openvwx has no name for.
 */
function kindName(o: ObjectInfo): string {
  if (o.typeName === "plug-in-object") {
    const plugin = store.session?.doc.records(o.id).find((r) => r.parametric)?.name;
    if (plugin) return plugin;
  }
  if (!o.typeName || /^type-\d+$/.test(o.typeName)) return "Object";
  const words = o.typeName.split("-").map((w) => (w === "3d" ? "3D" : w.charAt(0).toUpperCase() + w.slice(1)));
  return TYPE_TITLES[o.typeName] ?? words.join(" ");
}

/** The name of the layer an object is on, or "" when the drawing has no such layer. */
function layerName(layerId: string): string {
  return store.session?.doc.layers().find((l) => l.id === layerId)?.name ?? "";
}

/** The selected objects that have a measurement, in stacking order. */
function measuredSelection(): { o: ObjectInfo; m: Measurement }[] {
  const out: { o: ObjectInfo; m: Measurement }[] = [];
  for (const o of selectedObjects()) {
    const m = measureOf(o);
    if (m) out.push({ o, m });
  }
  return out;
}

/**
 * AREA: for each selected closed object (rectangle, polygon, circle, oval, closed polyline) a line
 * "Area = <area>, Perimeter = <length>", and with several a last line "Total area = <sum>". With
 * nothing closed selected, "Select closed objects first".
 */
export function areaLines(): string[] {
  const u = units();
  const closed = measuredSelection().flatMap(({ m }) => (m.kind === "closed" ? [m] : []));
  if (closed.length === 0) return ["Select closed objects first"];
  const lines = closed.map((m) => `Area = ${formatArea(m.area, u)}, Perimeter = ${formatLength(m.perimeter, u)}`);
  if (closed.length > 1) {
    const total = closed.reduce((sum, m) => sum + m.area, 0);
    lines.push(`Total area = ${formatArea(total, u)}`);
  }
  return lines;
}

/**
 * LENGTH: the length of each selected open or closed curve (a line, an arc, an open polyline, a
 * polygon's or a circle's perimeter) as "Length = <length>", and with several a last line
 * "Total length = <sum>". With no curve selected, "Select curves first".
 */
export function lengthLines(): string[] {
  const u = units();
  const lengths: number[] = [];
  for (const { m } of measuredSelection()) {
    if (m.kind === "length" || m.kind === "arc") lengths.push(m.length);
    else lengths.push(m.perimeter);
  }
  if (lengths.length === 0) return ["Select curves first"];
  const lines = lengths.map((len) => `Length = ${formatLength(len, u)}`);
  if (lengths.length > 1) {
    const total = lengths.reduce((sum, len) => sum + len, 0);
    lines.push(`Total length = ${formatLength(total, u)}`);
  }
  return lines;
}

/**
 * LIST: for each selected object, one heading line with its kind as Object Info names it, then
 * indented lines: "  Layer: <name>", "  Class: <name>", "  From x, y to x, y" (its box in the
 * drawing's units), and "  Area = …", "  Perimeter = …" or "  Length = …" where it has one. At most
 * 20 objects are written out, then "and N more". With nothing selected, "Select objects first".
 */
export function listLines(): string[] {
  const u = units();
  const objects = selectedObjects();
  if (objects.length === 0) return ["Select objects first"];
  const suffix = lengthSuffix(u);
  const num = (v: number): string => formatLengthValue(v, u);
  const lines: string[] = [];
  for (const o of objects.slice(0, LIST_MAX)) {
    lines.push(kindName(o));
    lines.push(`  Layer: ${layerName(o.layerId)}`);
    lines.push(`  Class: ${o.className || "None"}`);
    const box = o.shape ? shapeBBox(o.shape) : null;
    if (box) {
      const unit = suffix ? ` ${suffix}` : "";
      lines.push(`  From ${num(box.x0)}, ${num(box.y0)} to ${num(box.x1)}, ${num(box.y1)}${unit}`);
    }
    const m = measureOf(o);
    if (m?.kind === "closed") {
      lines.push(`  Area = ${formatArea(m.area, u)}`);
      lines.push(`  Perimeter = ${formatLength(m.perimeter, u)}`);
    } else if (m?.kind === "length" || m?.kind === "arc") {
      lines.push(`  Length = ${formatLength(m.length, u)}`);
    }
  }
  if (objects.length > LIST_MAX) lines.push(`and ${objects.length - LIST_MAX} more`);
  return lines;
}

/**
 * REGEN: draws everything again from the model. Changing the hidden set (to the same set) is the
 * one call that tells the 3D view its model is out of date, and it also emits "display", which
 * queues the plan's and the 3D panes' cached pictures to be drawn again and redraws the plan.
 */
export function regen(): void {
  if (!store.session) return;
  changeHidden([], []);
}
