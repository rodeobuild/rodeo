// Holes in polylines: a polyline can have holes (made by Clip Surface and similar), stored as
// polylines or polygons inside it. Vectorworks fills the outline less the holes and leaves the holes
// open, so a hole is never filled on its own; the parent's fill runs round it.

import type { ObjectInfo, Shape } from "../core/index.ts";

/** A polyline or polygon of at least three points: the shape a hole can be. */
function isHoleShape(s: Shape | null): boolean {
  return !!s && (s.kind === "polyline" || s.kind === "polygon") && s.points.length >= 3;
}

/**
 * Whether `obj` is a hole of `parent`: the parent is a polyline and `obj` a polyline or polygon of
 * at least three points. Polygons holding polygons are left alone, as their holes are not known to hold.
 */
export function isHoleOf(obj: ObjectInfo, parent: ObjectInfo | null): boolean {
  return parent?.kind === "polyline" && isHoleShape(obj.shape);
}

/** The holes among a polyline's child objects, in the order they are stored. */
export function holesOf(parent: ObjectInfo, children: readonly ObjectInfo[] | undefined): ObjectInfo[] {
  if (parent.kind !== "polyline" || !children) return [];
  return children.filter((c) => isHoleShape(c.shape));
}

/** Child objects grouped by their parent's id. The export has no scene index, so it groups a layer's objects here. */
export function childrenByParent(objects: readonly ObjectInfo[]): Map<string, ObjectInfo[]> {
  const out = new Map<string, ObjectInfo[]>();
  for (const o of objects) {
    if (o.parentId === null) continue;
    const list = out.get(o.parentId);
    if (list) list.push(o);
    else out.set(o.parentId, [o]);
  }
  return out;
}
