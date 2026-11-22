// Making a Space object: a plug-in object of Vectorworks' "Space" format with its boundary in a path
// group, drawn by draw.ts. In a drawing that has Spaces already a new one's parameters are of their
// format; in one that has none the format is made as the Vectorworks version that saved the drawing
// writes it (fieldTable.ts). Rodeo writes the object, its parameters, its path group and its drawing;
// the records Vectorworks keeps besides (FORMAT.md, "Space objects") are not made, and nothing Rodeo
// writes has been opened in Vectorworks. Free of the page.

import type { Attributes, EditSession, Pt, RecordValue } from "../../core/index.ts";
import { drawSpace } from "./draw.ts";
import { spaceFields } from "./fieldTable.ts";
import { centroidOf, cleanRing, F, savedYear, setSpaceValues, signedArea, SPACE, spaceOf } from "./model.ts";

export interface NewSpace {
  /** its net boundary on the drawing */
  readonly ring: readonly Pt[];
  readonly layerId: string;
  readonly classIndex?: number;
  /** parameters by Vectorworks' field names (model.ts F), over the format's defaults */
  readonly values?: Readonly<Record<string, RecordValue>>;
  /** its gross boundary on the drawing, when walls give one */
  readonly gross?: readonly Pt[] | null;
  /** the look its boundary and label take where no class says */
  readonly attrs?: Partial<Attributes>;
}

/** a new id in the form Vectorworks gives a Space */
const uniqueId = (): string => crypto.randomUUID();

/**
 * Adds a Space object for `space`, in the session's open batch: its id. Its insertion point is its
 * boundary's first corner and its label's handle the boundary's centroid. Throws for a boundary
 * with fewer than three corners or no area.
 */
export function addSpace(s: EditSession, space: NewSpace): string {
  const ring = cleanRing(space.ring);
  if (ring.length < 3 || Math.abs(signedArea(ring)) < 1e-6) throw new Error("A space needs a boundary with some area.");
  const outline = signedArea(ring) > 0 ? ring : [...ring].reverse();
  const at = outline[0];
  const local = outline.map((p) => ({ x: p.x - at.x, y: p.y - at.y }));
  const handle = centroidOf(local);
  const fields = spaceFields(savedYear(s.doc));
  const id = s.addPluginObject(space.layerId, SPACE, fields, {}, at, 0, space.classIndex);
  // its path: kept, not shown (its drawing has the boundary)
  const path = s.addObject(space.layerId, { kind: "polygon", points: local, closed: true }, space.classIndex, { lineStyle: 0, fillPattern: 0 });
  s.setPluginPath(id, path);
  const sp = spaceOf(s.doc, id);
  if (!sp) throw new Error("The space couldn't be made.");
  setSpaceValues(s, id, { [F.labelX]: handle.x, [F.labelY]: handle.y, [F.uniqueId]: uniqueId(), __NEW: false, ...space.values });
  drawSpace(s, id, { gross: space.gross, attrs: space.attrs });
  return id;
}
