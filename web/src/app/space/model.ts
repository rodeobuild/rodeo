// Vectorworks' Space object (a room): reading one, and the names of its parameters. A Space is a
// plug-in object whose parameters' format is named "Space" (FORMAT.md, "Space objects"): its boundary
// is the polyline in its path group, in the object's own frame; its name, number, occupancy, heights,
// finishes and measured figures are parameters. Rodeo reads the Spaces a drawing has and makes its
// own the same way (make.ts), drawing each from its parameters (draw.ts). Free of the page, so checks
// run in Node.
//
// The parameter names below are Vectorworks' own and are what schedules, data visualisation, IFC and
// other code read a room by: keep them as they are.

import type { EditSession, NewShape, Pt, RecordField, RecordValue, VwxDocument } from "../../core/index.ts";
import { formatArea, formatLength } from "../units.ts";

/** the plug-in, as its parameters' record is named */
export const SPACE = "Space";
/** Vectorworks' plug-in object type */
export const PLUGIN = 86;

/** A Space's parameters, by what they hold. Every name is a field of Vectorworks' "Space" format. */
export const F = {
  /** the room's name as first kept; what Vectorworks shows is nameShown (nameOf reads the right one) */
  name: "Name",
  /** the name Vectorworks shows: the choice of its name popup (11_Name), or its custom name (11_Space Name Cust) when the popup says Custom */
  nameShown: "11_NameDisplay",
  number: "Number",
  /** what the room is used as ("Residential"), as first kept; what Vectorworks shows is occupancyShown (occupancyOf reads the right one) */
  occupancy: "Occupancy",
  /** the occupancy Vectorworks shows: its popup's choice (11_Occupant), or its custom one (11_Occupant Custom) */
  occupancyShown: "11_OccupantDisplay",
  occupancyType: "Occupancy Type",
  /** "Room" in every sample */
  spaceType: "Space Type",
  /** the occupant organisation's name: what Rodeo reads as the department (Vectorworks has no parameter called Department) */
  department: "GSA_Occ_Org_Name",
  description: "Description",
  remarks: "Remarks",
  matrixOrder: "Matrix Order",
  proposedArea: "Proposed Area",
  // measured: areas and volumes are mm² and mm³ where the field is an area or volume (2024 on), and in
  // the drawing's own area and volume units where it is a plain number (2023)
  area: "Area",
  grossArea: "Gross Area",
  perimeter: "Perim",
  grossPerimeter: "Gross Perim",
  volume: "Volume",
  grossVolume: "Gross Volume",
  /** the room's longer and shorter sides, in metres (as stored) */
  length: "Length",
  width: "Width",
  roomDimensions: "Room Dimensions",
  // heights, mm
  /** the net (clear) height of the room: floor finish to ceiling */
  height: "Extrusion Height",
  /** floor to the floor above; 0 with DefaultGrossHeight set */
  floorToFloor: "Floor2Floor Height",
  /** the finished floor above the layer's own height */
  floorElevation: "Finish Floor Elev",
  // finishes: what each surface is made of, and its key on a finish schedule
  floorFinish: "Floor Finish",
  baseFinish: "Base Material",
  northFinish: "North Wall Finish",
  eastFinish: "East Wall Finish",
  southFinish: "South Wall Finish",
  westFinish: "West Wall Finish",
  ceilingFinish: "Ceiling Material",
  floorKey: "Floor Key",
  baseKey: "Base Key",
  northKey: "North Key",
  eastKey: "East Key",
  southKey: "South Key",
  westKey: "West Key",
  ceilingKey: "Ceiling Key",
  finishRemarks: "Finish Remarks",
  // boundary
  /** true: found from the walls round it and kept to them; false: as drawn */
  autoBoundary: "Auto-Boundary",
  /** draws the boundary in plan */
  showBoundary: "Show Poly",
  /** the class the boundary's fill and pen come from in plan (an occupancy class in the demos); "" the object's own */
  boundaryClass: "Boundary2DClass",
  /** how the gross boundary is found ("Wall Centerlines") */
  grossDefinition: "11_Gross Definition",
  // 3D
  /** draws the room's volume in 3D */
  show3d: "Show 3D Detail",
  /** the class of the volume in 3D; "" the object's own */
  volumeClass: "Boundary3DClass",
  // label
  /** what the label leads with ("Name and Number") */
  labelConfig: "Config",
  /** the Space draws a label itself (the demos' Spaces are labelled by separate Data Tags instead) */
  showLabel: "11_Display Stamp",
  showArea: "Show Area",
  showDimensions: "Show Dims",
  showOccupancy: "Show Occupancy",
  showVolume: "Show Volume",
  showProposedArea: "Show Proposed Area",
  underlineName: "Underline Name",
  /** the label's handle, from the insertion point, in the object's frame */
  labelX: "ControlPoint01X",
  labelY: "ControlPoint01Y",
  /** Vectorworks' own id for the space */
  uniqueId: "space_cw_uniq_id",
} as const;

/**
 * Parameters Vectorworks keeps twice, the second (from its 2011 rewrite) shown in its Object Info:
 * Rodeo writes both when it sets the first, where the drawing's format has the second.
 */
export const MIRRORS: Readonly<Record<string, readonly string[]>> = {
  [F.number]: ["11_Number", "NumberIncrementingValue"],
  [F.spaceType]: ["11_Space Type"],
  [F.matrixOrder]: ["11_Matrix Order"],
  [F.proposedArea]: ["11_Proposed Area"],
  [F.showBoundary]: ["11_Show Poly"],
  [F.show3d]: ["11_Show 3D Detail"],
  [F.height]: ["11_Net Height"],
  [F.floorToFloor]: ["11_Gross Height"],
  [F.department]: ["11_GSA_Oc_Org_Name"],
  [F.labelX]: ["ControlPoint03X"],
  [F.labelY]: ["ControlPoint03Y"],
};

/**
 * The name and the occupancy have a popup each in Vectorworks (11_Name, 11_Occupant) whose choice
 * "Custom" hands over to a text of its own; the text shown is kept too. Measured on all 112 demo
 * Spaces: the shown text is the custom one wherever the popup says Custom and the popup's choice
 * wherever it doesn't, while the plain Name is another room's on 20 of the 2024 file's 28 and the
 * plain Occupancy isn't the shown one on any of the 2026 file's. Rodeo sets a name or occupancy as
 * a custom one, in all four places.
 */
const CUSTOM = "Custom";
const SHOWN: Readonly<Record<string, { readonly shown: string; readonly popup: string; readonly custom: string }>> = {
  [F.name]: { shown: F.nameShown, popup: "11_Name", custom: "11_Space Name Cust" },
  [F.occupancy]: { shown: F.occupancyShown, popup: "11_Occupant", custom: "11_Occupant Custom" },
};

/** A Space's parameters, read by name. */
export interface Space {
  readonly id: string;
  readonly layerId: string;
  /** the name index of its format (what setRecordField takes) */
  readonly format: number;
  readonly fields: readonly RecordField[];
  has(field: string): boolean;
  value(field: string): RecordValue | undefined;
  num(field: string): number;
  text(field: string): string;
  flag(field: string): boolean;
}

export function spaceOf(doc: VwxDocument, id: string): Space | null {
  const o = doc.object(id);
  // by its plug-in's name first: reading every plug-in object's parameters to find the Spaces takes seconds in a big drawing
  if (!o || o.type !== PLUGIN || doc.pluginNameOf(id) !== SPACE) return null;
  const rec = doc.records(id).find((r) => r.parametric && r.name === SPACE);
  if (!rec) return null;
  const byName = new Map(rec.fields.map((f): [string, RecordValue] => [f.name, f.value]));
  const value = (field: string): RecordValue | undefined => byName.get(field);
  return {
    id,
    layerId: o.layerId,
    format: rec.format,
    fields: rec.fields,
    has: (field) => byName.has(field),
    value,
    num: (field) => Number(value(field)) || 0,
    text: (field) => String(value(field) ?? ""),
    flag: (field) => value(field) === true,
  };
}

/** A room's name as Vectorworks shows it: the shown name where the Space has one, else its plain Name. */
export const nameOf = (sp: Space): string => (sp.text(F.nameShown) || sp.text(F.name)).trim();

/** A room's occupancy as Vectorworks shows it: the shown one where the Space has one, else its plain Occupancy. */
export const occupancyOf = (sp: Space): string => (sp.text(F.occupancyShown) || sp.text(F.occupancy)).trim();

/** The Space objects standing on a layer themselves (not inside groups or symbols), in drawing order. */
export function spacesOnLayer(doc: VwxDocument, layerId: string): Space[] {
  if (!doc.hasPluginFormat(SPACE)) return [];
  const out: Space[] = [];
  for (const o of doc.objects(layerId)) {
    if (o.type !== PLUGIN || o.parentId) continue;
    const sp = spaceOf(doc, o.id);
    if (sp) out.push(sp);
  }
  return out;
}

/** Every Space on the drawing's design layers. */
export function allSpaces(doc: VwxDocument): Space[] {
  if (!doc.hasPluginFormat(SPACE)) return [];
  return doc.layers().flatMap((l) => (l.kind === "design" ? spacesOnLayer(doc, l.id) : []));
}

/** A plug-in object's frame: its insertion point and turn. */
export function frameOf(doc: VwxDocument, id: string): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt; at: Pt } {
  const o = doc.object(id);
  const at = o?.insertion ?? { x: 0, y: 0 };
  const turn = ((o?.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    at,
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

/** A ring without a repeated last corner or corners doubled within a thousandth of a millimetre. */
export function cleanRing(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-3) out.push({ x: p.x, y: p.y });
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1e-3) out.pop();
  return out;
}

/**
 * A Space's boundary on the drawing as drawn or found: the corners of the polyline in its path
 * group. Curved corners are read as corners. Null when it has no path. In Vectorworks' own Spaces
 * that are kept to walls the path lies between the net and gross boundaries (netBoundaryOf).
 */
export function boundaryOf(doc: VwxDocument, id: string): Pt[] | null {
  const pathId = doc.pluginPath(id);
  return pathId ? ringOf(doc, pathId) : null;
}

/** A Space's net boundary on the drawing: the net polyline Vectorworks keeps beside the path where it has one, else the path. */
export function netBoundaryOf(doc: VwxDocument, id: string): Pt[] | null {
  const kept = keptBoundaries(doc, id);
  return (kept && ringOf(doc, kept.net)) ?? boundaryOf(doc, id);
}

const POLYLINE = 21;

/**
 * The two boundary polylines a Space made by Vectorworks keeps beside its path, as objects: its
 * gross boundary first and its net one second (their areas are Gross Area and Area on 27 of the
 * 2023 demo's 28 Spaces, in that order). None for a Space Rodeo made.
 */
export function keptBoundaries(doc: VwxDocument, id: string): { gross: string; net: string } | null {
  const layerId = doc.object(id)?.layerId;
  if (!layerId) return null;
  const own = doc.objects(layerId).filter((o) => o.parentId === id && o.type === POLYLINE);
  return own.length >= 2 ? { gross: own[0].id, net: own[1].id } : null;
}

/** `ring` (on the drawing) as the shape `id` is, in Space `spaceId`'s frame: a polygon, or a polyline of corners open or closed as it was (Vectorworks keeps a Space's polylines open). */
function ringShape(doc: VwxDocument, spaceId: string, id: string, ring: readonly Pt[]): NewShape | null {
  const shape = doc.object(id)?.shape;
  if (!shape || (shape.kind !== "polyline" && shape.kind !== "polygon")) return null;
  const points = ring.map(frameOf(doc, spaceId).toLocal);
  return shape.kind === "polygon" ? { kind: "polygon", points, closed: true } : ({ kind: "polyline", points, closed: shape.closed === true, vertices: points.map(() => "corner"), radii: points.map(() => 0) } as NewShape);
}

/** Moves one of Space `spaceId`'s own shapes (its path, a kept boundary) onto `ring`, in the open batch. */
export function setRing(s: EditSession, spaceId: string, id: string, ring: readonly Pt[]): void {
  const next = ringShape(s.doc, spaceId, id, ring);
  if (next) s.setGeometry(id, next);
}

/**
 * Moves Space `id`'s boundary to `ring` (on the drawing), in the session's open batch: its path
 * and, where Vectorworks made it, the net and gross boundaries it keeps beside the path (the gross
 * one until draw.ts is given the walls' own). The Space isn't drawn again here: reshapeSpace
 * (draw.ts) does both.
 */
export function setBoundary(s: EditSession, id: string, ring: readonly Pt[]): void {
  const pathId = s.doc.pluginPath(id);
  const clean = cleanRing(ring);
  if (clean.length < 3) throw new Error("A space needs a boundary of three corners or more.");
  if (!pathId || !ringShape(s.doc, id, pathId, clean)) throw new Error("That space has no boundary to move.");
  setRing(s, id, pathId, clean);
  const kept = keptBoundaries(s.doc, id);
  if (kept) {
    setRing(s, id, kept.net, clean);
    setRing(s, id, kept.gross, clean);
  }
}

/** The corners of one of a Space's own shapes on the drawing; null when it isn't a ring. */
export function ringOf(doc: VwxDocument, id: string): Pt[] | null {
  const shape = doc.object(id)?.shape;
  if (!shape || (shape.kind !== "polyline" && shape.kind !== "polygon") || !shape.points) return null;
  const ring = cleanRing(shape.points);
  return ring.length >= 3 ? ring : null;
}

export const signedArea = (ring: readonly Pt[]): number => ring.reduce((a, p, i) => a + p.x * ring[(i + 1) % ring.length].y - ring[(i + 1) % ring.length].x * p.y, 0) / 2;

export const perimeterOf = (ring: readonly Pt[]): number => ring.reduce((a, p, i) => a + Math.hypot(ring[(i + 1) % ring.length].x - p.x, ring[(i + 1) % ring.length].y - p.y), 0);

/** A ring's centroid; its first corner when it has no area. */
export function centroidOf(ring: readonly Pt[]): Pt {
  const a = signedArea(ring);
  if (Math.abs(a) < 1e-9) return ring[0] ?? { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function insideRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The sides of the smallest rectangle round a ring, the longer first, mm: what Vectorworks keeps as
 * a room's Length and Width (20 of the 2023 demo's 28 Spaces to a millimetre; the rest are larger).
 */
export function roomSides(ring: readonly Pt[]): { length: number; width: number } {
  let best = { length: 0, width: 0, area: Infinity };
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 1e-6) continue;
    const [ux, uy] = [(b.x - a.x) / d, (b.y - a.y) / d];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const p of ring) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const [w, h] = [u1 - u0, v1 - v0];
    if (w * h < best.area) best = { length: Math.max(w, h), width: Math.min(w, h), area: w * h };
  }
  return { length: best.length, width: best.width };
}

/** What a Space measures: its net boundary's and its gross one's, mm, mm² and mm³. */
export interface SpaceFigures {
  readonly area: number;
  readonly perimeter: number;
  readonly grossArea: number;
  readonly grossPerimeter: number;
  readonly volume: number;
  readonly grossVolume: number;
  readonly length: number;
  readonly width: number;
}

/**
 * The figures of a room with net boundary `net` and gross boundary `gross` (the net one when it
 * has no walls to measure to), `height` clear and `floorToFloor` to the floor above (0: none, and
 * no gross volume, as the 2023 demo's Spaces without one have 0).
 */
export function figuresOf(net: readonly Pt[], gross: readonly Pt[] | null, height: number, floorToFloor: number): SpaceFigures {
  const area = Math.abs(signedArea(net));
  const g = gross && gross.length >= 3 ? gross : net;
  const grossArea = Math.abs(signedArea(g));
  return { area, perimeter: perimeterOf(net), grossArea, grossPerimeter: perimeterOf(g), volume: area * Math.max(0, height), grossVolume: grossArea * Math.max(0, floorToFloor), ...roomSides(net) };
}

/** A Space's figures as its parameters hold them now, mm, mm² and mm³. */
export function storedFigures(sp: Space, units: string | undefined): SpaceFigures {
  return {
    area: measured(sp, F.area, units),
    perimeter: sp.num(F.perimeter),
    grossArea: measured(sp, F.grossArea, units),
    grossPerimeter: sp.num(F.grossPerimeter),
    volume: measured(sp, F.volume, units),
    grossVolume: measured(sp, F.grossVolume, units),
    length: sp.num(F.length) * 1000,
    width: sp.num(F.width) * 1000,
  };
}

const FT = 304.8;
const isImperial = (units: string | undefined): boolean => /feet|inch|foot|yard|mile/i.test(units ?? "");

/** mm² in the drawing's own area unit, and mm³ in its volume unit, as a 2023 format's plain numbers are: square and cubic feet (measured), else square and cubic metres (Rodeo's reading: no metric sample). */
export function ownUnits(units: string | undefined): { area: number; volume: number; areaName: string; volumeName: string } {
  return isImperial(units) ? { area: FT * FT, volume: FT * FT * FT, areaName: "sq ft", volumeName: "cu ft" } : { area: 1e6, volume: 1e9, areaName: "m²", volumeName: "m³" };
}

const trimmed = (v: number, dp: number): string => String(Number(v.toFixed(dp)));

/** An area or volume field's value in mm² or mm³, whichever way its format keeps it. */
export function measured(sp: Space, field: string, units: string | undefined): number {
  const f = sp.fields.find((x) => x.name === field);
  const v = Number(f?.value) || 0;
  if (!f || f.kind === "area" || f.kind === "volume") return v;
  const own = ownUnits(units);
  return v * (field === F.volume || field === F.grossVolume ? own.volume : own.area);
}

/**
 * The parameters `figures` set on Space `sp`, each as its format keeps it (a field it lacks left
 * out): the measured numbers, and the texts Vectorworks shows beside them in its Object Info.
 */
export function figureValues(sp: Space, figures: SpaceFigures, units: string | undefined): Record<string, RecordValue> {
  const own = ownUnits(units);
  const kind = (field: string): string | undefined => sp.fields.find((f) => f.name === field)?.kind;
  const area = (field: string, mm2: number): number => (kind(field) === "area" ? mm2 : mm2 / own.area);
  const volume = (field: string, mm3: number): number => (kind(field) === "volume" ? mm3 : mm3 / own.volume);
  const areaText = (mm2: number): string => `${trimmed(mm2 / own.area, 3)} ${own.areaName}`;
  const volumeText = (mm3: number): string => `${trimmed(mm3 / own.volume, 3)} ${own.volumeName}`;
  const sides = `${formatLength(figures.length, units)} x ${formatLength(figures.width, units)}`;
  const all: Record<string, RecordValue> = {
    [F.area]: area(F.area, figures.area),
    MeasuredNetAreaNum: area("MeasuredNetAreaNum", figures.area),
    [F.grossArea]: area(F.grossArea, figures.grossArea),
    [F.perimeter]: figures.perimeter,
    [F.grossPerimeter]: figures.grossPerimeter,
    [F.volume]: volume(F.volume, figures.volume),
    [F.grossVolume]: volume(F.grossVolume, figures.grossVolume),
    // metres, as stored
    [F.length]: figures.length / 1000,
    [F.width]: figures.width / 1000,
    "11_Length": figures.length,
    "11_Width": figures.width,
    [F.roomDimensions]: sides,
    "11_Room Dimensions": sides,
    "11_Area": areaText(figures.area),
    MeasuredNetArea: areaText(figures.area),
    "11_Gross Area": areaText(figures.grossArea),
    "11_Perim": formatLength(figures.perimeter, units),
    "11_Gross Perim": formatLength(figures.grossPerimeter, units),
    "11_Volume": volumeText(figures.volume),
    "11_Gross Volume": volumeText(figures.grossVolume),
  };
  return Object.fromEntries(Object.entries(all).filter(([field]) => sp.has(field)));
}

/** `values` with the parameters Vectorworks keeps a second time set too, where `sp` has them. */
export function withMirrors(sp: Space, values: Readonly<Record<string, RecordValue>>): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  for (const [given, value] of Object.entries(values)) {
    // a name or occupancy set by what Vectorworks shows is set as the plain one, and so in all its places
    const field = given === F.nameShown ? F.name : given === F.occupancyShown ? F.occupancy : given;
    if (!sp.has(field)) continue;
    out[field] = value;
    const shown = SHOWN[field];
    if (shown && typeof value === "string") {
      if (sp.has(shown.shown)) out[shown.shown] = value;
      if (sp.has(shown.custom)) out[shown.custom] = value;
      if (sp.has(shown.popup)) out[shown.popup] = CUSTOM;
    }
    for (const other of MIRRORS[field] ?? []) {
      const f = sp.fields.find((x) => x.name === other);
      // only where it holds the same kind of value (a popup of fixed choices isn't written a free text)
      if (f && typeof f.value === typeof value && f.kind !== "choice") out[other] = value;
    }
  }
  return out;
}

/** Sets parameters of Space `id`, mirrors included, in the session's open batch. */
export function setSpaceValues(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const sp = spaceOf(s.doc, id);
  if (!sp) throw new Error("That isn't a Space object.");
  const all = withMirrors(sp, values);
  if (Object.keys(all).length) s.setRecordFields(sp.format, [{ id, fields: all }]);
}

/** A room's area in the drawing's units, for labels and messages. */
export const areaLabel = (mm2: number, units: string | undefined): string => formatArea(mm2, units);

/** The Vectorworks year a drawing was last saved by (VW28 is 2023 … VW31 is 2026); 2026 when it doesn't say. */
export function savedYear(doc: VwxDocument): number {
  const m = /VW(\d+)/.exec(doc.info.savedWith) ?? /VW(\d+)/.exec(doc.info.createdWith);
  return m ? Number(m[1]) + 1995 : 2026;
}
