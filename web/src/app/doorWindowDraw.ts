// Doors and windows drawn from their record's parameters, as plain data: the plan shapes (NewShape, for addObjects), the
// prism faces (flat corner lists, for addMeshes) and the hole each one needs in its wall. No session in here, so the
// check runs under Node; doorWindow.ts sends the result to the drawing. Lengths are mm, in the object's own frame
// (doorWindowShapes.ts). Faces are given z above the layer, so their z is lifted by the layer's elevation: addMeshes adds
// that elevation back as it makes them, as massingModel does.

import type { NewShape, Pt as PlanPt } from "../core/index.ts";
import { DOOR_CONFIGS, WINDOW_CONFIGS, checkedDoor, checkedWindow, drawDoor, drawWindow, type Drawn, type PartRole, type Solid } from "./doorWindowShapes.ts";
import { DOOR_FIELDS, WINDOW_FIELDS, doorParams, windowParams, type FieldDefault } from "./doorWindowFields.ts";

export const DOOR = "Door";
export const WINDOW = "Window";
export type Kind = "Door" | "Window";

/** what a parameter record holds, by field name */
export type Get = (field: string) => unknown;

/** the table's default for each field of a kind, as the Vectorworks record has it */
export function fieldsOf(kind: Kind): readonly FieldDefault[] {
  return kind === DOOR ? DOOR_FIELDS : WINDOW_FIELDS;
}

export function defaultsOf(kind: Kind): Record<string, string | number | boolean> {
  return Object.fromEntries(fieldsOf(kind).map((f) => [f.name, f.value as string | number | boolean]));
}

/** the defaults overlaid with `values`, read by name */
export function getterOf(kind: Kind, values: Readonly<Record<string, unknown>>): Get {
  const merged: Record<string, unknown> = { ...defaultsOf(kind), ...values };
  return (field) => merged[field];
}

export interface Built {
  /** the parameters as checked (repaired ones) */
  params: unknown;
  notes: string[];
  drawn: Drawn;
}

/** the door or window drawn from the parameters read by `get`, in a wall of `wallThickness` (mm) */
export function buildFrom(kind: Kind, get: Get, wallThickness: number): Built {
  if (kind === DOOR) {
    const c = checkedDoor(doorParams(get, wallThickness));
    return { params: c.params, notes: c.notes, drawn: drawDoor(c.params) };
  }
  const c = checkedWindow(windowParams(get, wallThickness));
  return { params: c.params, notes: c.notes, drawn: drawWindow(c.params) };
}

/** the Object Info rows of each kind, by field name; the friendly names are in LABELS */
export const DOOR_LAYOUT_FIELDS: readonly string[] = [
  "Config",
  "DoorWidth",
  "DoorHeight",
  "LeafType",
  "DoorThickness",
  "JambWidth",
  "JambDepth",
  "OpenAngle",
  "Threshold",
  "Transom",
  "SideLights",
  "LeftLiteWidth",
  "RightLiteWidth",
  "IntTrim",
  "IntTrimWidth",
  "ExtTrim",
  "ExtTrimWidth",
];
export const WINDOW_LAYOUT_FIELDS: readonly string[] = [
  "SashOperation",
  "Width",
  "Height",
  "Elevation",
  "ElevationSetAt",
  "JambWidth",
  "JambDepth",
  "SashWidth",
  "SashDepth",
  "Cols",
  "Rows",
  "IncludeSill",
  "SillDepth",
  "IntTrim",
  "IntTrimWidth",
  "ExtTrim",
  "ExtTrimWidth",
];

/** the friendly names Object Info shows for the fields above */
export const LABELS: Readonly<Record<string, string>> = {
  Config: "Configuration",
  DoorWidth: "Width",
  DoorHeight: "Height",
  LeafType: "Leaf",
  DoorThickness: "Leaf Thickness",
  JambWidth: "Jamb Width",
  JambDepth: "Jamb Depth",
  OpenAngle: "Open Angle",
  Threshold: "Threshold",
  Transom: "Transom",
  SideLights: "Sidelights",
  LeftLiteWidth: "Left Sidelight Width",
  RightLiteWidth: "Right Sidelight Width",
  IntTrim: "Interior Trim",
  IntTrimWidth: "Interior Trim Width",
  ExtTrim: "Exterior Trim",
  ExtTrimWidth: "Exterior Trim Width",
  SashOperation: "Sash",
  Width: "Width",
  Height: "Height",
  Elevation: "Elevation",
  ElevationSetAt: "Elevation Set At",
  SashWidth: "Sash Width",
  SashDepth: "Sash Depth",
  Cols: "Columns",
  Rows: "Rows",
  IncludeSill: "Sill",
  SillDepth: "Sill Depth",
};

/** the choices of popup fields, by kind and field */
export function choicesOf(kind: Kind, field: string): readonly string[] | undefined {
  if (kind === DOOR) {
    if (field === "Config") return DOOR_CONFIGS;
    if (field === "LeafType") return ["Solid", "Panel", "Glass"];
    return undefined;
  }
  if (field === "SashOperation") return WINDOW_CONFIGS;
  if (field === "ElevationSetAt") return ["Sill of Window", "Head of Window"];
  return undefined;
}

/** a plan shape of the drawing as addObjects takes it, with its part's role */
export interface PartShape {
  readonly role: PartRole;
  readonly shape: NewShape;
}

export function planShapesOf(drawn: Drawn): PartShape[] {
  return drawn.plan.map((p): PartShape => {
    if (p.arc) {
      return { role: p.role, shape: { kind: "arc", center: p.arc.centre, radius: p.arc.radius, startAngle: p.arc.start, sweepAngle: p.arc.sweep } };
    }
    if (p.kind === "polyline") return { role: p.role, shape: { kind: "polyline", points: p.points, closed: p.closed } };
    return { role: p.role, shape: { kind: "polygon", points: p.points, closed: p.closed } };
  });
}

/**
 * The closed prism of a solid as flat corner lists (x, y, z triples, mm): the bottom, the top, then one
 * quadrilateral per side. Its z is lifted by `lift` (the layer's negated elevation).
 */
export function prismFaces(s: Solid, lift = 0): number[][] {
  const o = s.outline;
  const n = o.length;
  const at = (p: PlanPt, z: number): number[] => [p.x, p.y, z + lift];
  const faces: number[][] = [o.slice().reverse().flatMap((p) => at(p, s.z0)), o.flatMap((p) => at(p, s.z1))];
  for (let i = 0; i < n; i++) {
    const a = o[i];
    const b = o[(i + 1) % n];
    faces.push([...at(a, s.z0), ...at(b, s.z0), ...at(b, s.z1), ...at(a, s.z1)]);
  }
  return faces;
}

/** the solids that have volume, each with its role and its faces */
export function solidParts(drawn: Drawn, lift = 0): { role: PartRole; faces: number[][] }[] {
  return drawn.solids
    .filter((s) => s.z1 > s.z0 && s.outline.length >= 3)
    .map((s) => ({ role: s.role, faces: prismFaces(s, lift) }));
}
