// Draws a Space object from its parameters and boundary, as Rodeo draws one: its boundary in plan in
// its boundary class, its label when it shows one itself (label.ts), and its volume in 3D
// (volume.ts); and sets the figures it measures (model.ts). The same for a Space Vectorworks made
// and one of Rodeo's: a Vectorworks one is shown as Vectorworks drew it until it is first drawn
// again (a parameter or its boundary changed), when its shading and finish groups give way to this.
// A Vectorworks Space keeps its own net boundary beside its path, and its figures stand until its
// boundary moves: Vectorworks' areas aren't always its polygons' (FORMAT.md, "Space objects").
// Free of the page: a caller passes the look new objects take.

import type { Attributes, EditSession, NewShape, Pt } from "../../core/index.ts";
import { labelParts } from "./label.ts";
import { boundaryOf, centroidOf, F, figureValues, figuresOf, frameOf, insideRing, keptBoundaries, measured, netBoundaryOf, setBoundary, setRing, setSpaceValues, signedArea, spaceOf, storedFigures, type Space, type SpaceFigures } from "./model.ts";
import { prismFaces, volumeSpan } from "./volume.ts";

export interface DrawOptions {
  /**
   * The gross boundary on the drawing, when the walls round the room are known (walls.ts): its
   * gross figures follow it. Left out, they stay as they are, or follow the net boundary for a
   * room that isn't kept to walls.
   */
  readonly gross?: readonly Pt[] | null;
  /** the look its plan boundary and label take where their class doesn't say (the attributes new objects draw with) */
  readonly attrs?: Partial<Attributes>;
  /** its boundary has just been moved (reshapeSpace): a Space Vectorworks made is measured again from it */
  readonly reshaped?: boolean;
  /** one of its heights has just been changed: a Space Vectorworks made takes its volumes from its areas and heights again */
  readonly heights?: boolean;
}

const BY_CLASS = ["fill", "lineStyle", "penColor", "lineWeight", "opacity"] as const;
/** how solid a volume is drawn when its class doesn't say, per cent */
const VOLUME_OPACITY = 30;

const classNamed = (s: EditSession, name: string): number | null => (name ? (s.doc.classes().find((c) => c.name === name)?.index ?? null) : null);

/** The scale text is drawn at on a design layer. */
function scaleOf(s: EditSession, layerId: string): number {
  const layer = s.doc.layers().find((l) => l.id === layerId);
  return layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
}

/** Where Space `sp`'s label sits, in its own frame: its handle when that lies in the room, else the room's centroid. */
export function labelPoint(sp: Space, local: readonly Pt[]): Pt {
  const handle = { x: sp.num(F.labelX), y: sp.num(F.labelY) };
  return (handle.x !== 0 || handle.y !== 0) && insideRing(handle, local) ? handle : centroidOf(local);
}

/**
 * Draws Space `id` again from its parameters and its boundary, and sets what it measures, in the
 * session's open batch. Throws when it has no boundary of three corners or more.
 */
export function drawSpace(s: EditSession, id: string, options: DrawOptions = {}): void {
  const doc = s.doc;
  const sp = spaceOf(doc, id);
  if (!sp) throw new Error("That isn't a Space object.");
  const world = netBoundaryOf(doc, id);
  if (!world || !boundaryOf(doc, id)) throw new Error("A space needs a boundary of three corners or more.");
  const frame = frameOf(doc, id);
  const local = world.map(frame.toLocal);
  if (Math.abs(signedArea(local)) < 1e-6) throw new Error("A space needs a boundary with some area.");
  const units = doc.info.units;
  const layerId = sp.layerId;
  const own = doc.object(id)?.classIndex;
  const look = options.attrs ?? {};
  const kept = keptBoundaries(doc, id);

  // what it measures. Its net boundary's figures: always for a Space of Rodeo's, and for one of
  // Vectorworks' once its boundary has moved; until then Vectorworks' own figures stand (its areas
  // aren't always its polygons', nor its volume always its area by its height), and its volumes
  // follow a height that is changed. Its gross boundary's: when the walls say, or with no walls to say.
  const auto = sp.flag(F.autoBoundary);
  const gross = options.gross !== undefined ? options.gross : auto ? undefined : world;
  const height = sp.num(F.height);
  let figures: SpaceFigures;
  if (kept && !options.reshaped) {
    figures = storedFigures(sp, units);
    if (options.heights) {
      figures = { ...figures, volume: figures.area * Math.max(0, height), grossVolume: figures.grossArea * Math.max(0, sp.num(F.floorToFloor)) };
      const all = figureValues(sp, figures, units);
      setSpaceValues(s, id, Object.fromEntries(Object.entries(all).filter(([field]) => /volume/i.test(field))));
    }
  } else {
    figures = figuresOf(world, gross ?? null, height, sp.num(F.floorToFloor));
    const values = figureValues(sp, figures, units);
    if (gross === undefined) for (const stays of [F.grossArea, F.grossPerimeter, F.grossVolume, "11_Gross Area", "11_Gross Perim", "11_Gross Volume"]) delete values[stays];
    setSpaceValues(s, id, values);
    // the gross boundary Vectorworks keeps beside the path follows the walls' own
    if (kept && gross) setRing(s, id, kept.gross, gross);
  }

  const ids: string[] = [];
  // what takes its fill and pen from its class
  const classed: string[] = [];
  // plan: the boundary, in its class's fill and pen where it names one
  const boundaryClass = classNamed(s, sp.text(F.boundaryClass));
  if (sp.flag(F.showBoundary) || !sp.has(F.showBoundary)) {
    const shape: NewShape = { kind: "polygon", points: local, closed: true };
    if (boundaryClass !== null) {
      const made = s.addObject(layerId, shape, boundaryClass);
      classed.push(made);
      ids.push(made);
    } else ids.push(s.addObject(layerId, shape, own, look));
  }

  // its label
  const fresh = spaceOf(doc, id) ?? sp;
  for (const shape of labelParts(fresh, labelPoint(fresh, local), { doc, figures, scale: scaleOf(s, layerId) })) ids.push(s.addObject(layerId, shape, own, { ...look, fillPattern: 0 }));

  // 3D: its volume, in its volume class. Heights are above the layer: a new mesh is made at the
  // layer's elevation and a plug-in's drawing is lifted by it again when shown, so it is taken off here
  const span = sp.flag(F.show3d) ? volumeSpan(sp.num(F.floorElevation), height) : null;
  if (span) {
    const elevation = doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
    const faces = prismFaces(local, span.bottom - elevation, span.top - elevation);
    const volumeClass = classNamed(s, sp.text(F.volumeClass)) ?? boundaryClass;
    if (faces.length) {
      // with no class to say how it looks, see-through: a solid volume would hide the room it fills
      const made = s.addMeshes(layerId, [faces], volumeClass ?? own, volumeClass !== null ? undefined : { ...look, fillPattern: 1, fillOpacity: VOLUME_OPACITY });
      if (volumeClass !== null) classed.push(...made);
      ids.push(...made);
    }
  }
  if (classed.length) s.setAttributesByClass(classed, BY_CLASS, true);
  s.setPluginDrawing(id, ids);
}

/** Moves Space `id`'s boundary to `ring` (on the drawing) and draws and measures it again, in the session's open batch. */
export function reshapeSpace(s: EditSession, id: string, ring: readonly Pt[], options: DrawOptions = {}): void {
  setBoundary(s, id, ring);
  drawSpace(s, id, { ...options, reshaped: true });
}

/** A Space's net area, mm², as its parameters hold it. */
export const areaOf = (sp: Space, units: string | undefined): number => measured(sp, F.area, units);
