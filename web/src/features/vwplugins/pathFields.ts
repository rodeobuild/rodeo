// The path and control point fields of a plug-in object, read from the drawing: a path object keeps
// its path as JSON in a hidden text field of its record, and a plug-in's control points are its
// coordinate parameters. The driver (index.ts) and the Reshape tool read and change them through
// these. Kept apart from run.ts, which loads the script runner, so that reading them is cheap.

import type { Pt, RecordValue } from "../../core/index.ts";
import { store } from "../../app/state.ts";
import type { VwParam } from "../../import/vwplugin.ts";

/**
 * A path object's path: a hidden text field of its record holding JSON {"closed", "v": [[x, y, kind,
 * radius]...]}, the vertices in millimetres from its insertion point. A new one's first vertex is
 * its insertion point.
 */
export const PATH_FIELD = "__Path";

/** A record field as the drawing holds it: its name and its value (mm for a dimension). */
export interface FieldValue {
  readonly name: string;
  readonly value: RecordValue;
}

/** The fields of object `id`'s record of the plug-in `plugin`, or none when it has none. */
export function recordFields(id: string, plugin: string): readonly FieldValue[] {
  return store.session?.doc.records(id).find((r) => r.name === plugin)?.fields ?? [];
}

/** A path as its record holds it: JSON of `points` about `at` (mm), every vertex a corner. */
export function pathJson(points: readonly Pt[], at: Pt, closed: boolean): string {
  return JSON.stringify({ closed, v: points.map((p) => [round(p.x - at.x), round(p.y - at.y), "corner", 0]) });
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Object `id`'s path (mm from its insertion point), or null when its record holds none readable. */
export function readPath(id: string, plugin: string): { readonly points: Pt[]; readonly closed: boolean } | null {
  const f = recordFields(id, plugin).find((x) => x.name === PATH_FIELD);
  if (!f || typeof f.value !== "string") return null;
  try {
    const data = JSON.parse(f.value) as { closed?: unknown; v?: unknown };
    if (!Array.isArray(data.v)) return null;
    const points = data.v.flatMap((v: unknown): Pt[] => (Array.isArray(v) && typeof v[0] === "number" && typeof v[1] === "number" ? [{ x: v[0], y: v[1] }] : []));
    return { points, closed: data.closed === true };
  } catch {
    return null;
  }
}

/** The path field's text of object `id`, as the record holds it (kept by a run for the object), or undefined. */
export function pathText(id: string, plugin: string): string | undefined {
  const f = recordFields(id, plugin).find((x) => x.name === PATH_FIELD);
  return f && typeof f.value === "string" ? f.value : undefined;
}

/** The layout widget numbers each plug-in's own layout gave its parameters, by plug-in name (for its script's calls). */
const widgetIds = new Map<string, Readonly<Record<string, number>>>();

/** Keeps the numbers a plug-in's layout gave its parameters, by parameter name, as its script's calls read them. */
export function rememberWidgets(plugin: string, ids: Readonly<Record<string, number>>): void {
  widgetIds.set(plugin, ids);
}

/** The layout widget numbers of the plug-in's parameters, by name (empty until its layout is set up). */
export function widgetIdsOf(plugin: string): Readonly<Record<string, number>> {
  return widgetIds.get(plugin) ?? {};
}

/** A control point's position on object `id` in its own frame (mm), or null when its fields hold no numbers. */
export function controlPointAt(id: string, plugin: string, x: VwParam, y: VwParam): Pt | null {
  const fields = recordFields(id, plugin);
  const vx = Number(fields.find((f) => f.name === x.name)?.value);
  const vy = Number(fields.find((f) => f.name === y.name)?.value);
  return Number.isFinite(vx) && Number.isFinite(vy) ? { x: vx, y: vy } : null;
}
