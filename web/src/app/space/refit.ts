// Keeps Spaces with "Auto-Boundary" set to the walls round them. A Space's room is the one the walls
// on its level close that holds its anchor: its label point on the drawing, else its boundary's
// centroid. Its net boundary becomes the room's net ring, and it is drawn again with the room's gross
// ring (walls.ts). A Space with no room there (its walls opened up or deleted) is left as it is.
//
// Which walls bound a Space: Rodeo's reading, not a rule Vectorworks states. The walls on every design
// layer whose elevation is within 1 mm of the Space's own layer's (its own layer included), as a level
// is one storey. Walls inside groups or symbols are not read here; the walls' footprints come from
// session.wallFootprints.
//
// Free of the page: the caller passes the attributes new drawing takes (follow.ts passes the editor's).
// Checked by follow.check.ts.

import type { Attributes, EditSession, Pt, VwxDocument } from "../../core/index.ts";
import { reshapeSpace } from "./draw.ts";
import { allSpaces, centroidOf, cleanRing, F, frameOf, insideRing, measured, netBoundaryOf, SPACE, spaceOf, type Space } from "./model.ts";
import { roomsOf, type WallRoom } from "./walls.ts";
import { ringArea } from "../wallPolys.ts";

/** Vectorworks' wall object type */
const WALL = 68;
/** What a session's walls were at the last look: their signature with the auto Spaces', and the rooms they closed on each level. */
interface Seen {
  readonly signature: string;
  readonly rooms: ReadonlyMap<number, readonly WallRoom[]>;
}
const seen = new WeakMap<EditSession, Seen>();
/** mm: layers this close in elevation share their walls */
const SAME_LEVEL = 1;
/** mm: corners this close are the same corner */
const SAME_CORNER = 0.01;

/** The walls a level's Spaces are kept to: the ids of the top-level walls on the design layers at `elevation` (within a millimetre). */
export const wallsAt = (doc: VwxDocument, elevation: number): string[] =>
  doc
    .layers()
    .filter((l) => l.kind === "design" && Math.abs((l.elevation ?? 0) - elevation) <= SAME_LEVEL)
    .flatMap((l) => doc.objects(l.id).filter((o) => o.type === WALL && !o.parentId).map((o) => o.id));

const elevationOf = (doc: VwxDocument, layerId: string): number => doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;

/** Each level: a Space's layer's elevation, the Spaces on it and the walls that bound them. */
interface Level {
  readonly elevation: number;
  readonly spaces: Space[];
  readonly walls: string[];
}

function levelsOf(doc: VwxDocument, spaces: readonly Space[]): Level[] {
  const elevations = new Map(doc.layers().map((l) => [l.id, l.elevation ?? 0]));
  const byElevation = new Map<number, Space[]>();
  for (const sp of spaces) {
    const e = elevations.get(sp.layerId) ?? 0;
    byElevation.set(e, [...(byElevation.get(e) ?? []), sp]);
  }
  return [...byElevation].map(([elevation, list]) => ({ elevation, spaces: list, walls: wallsAt(doc, elevation) }));
}

/** Whether two rings have the same corners (in any order), each within SAME_CORNER mm. */
function sameRing(a: readonly Pt[], b: readonly Pt[]): boolean {
  const p = cleanRing(a);
  const q = cleanRing(b);
  return p.length === q.length && p.every((x) => q.some((y) => Math.hypot(x.x - y.x, x.y - y.y) <= SAME_CORNER));
}

/** Where Space `id` is looked for among rooms: its label's handle on the drawing (it lies in the room it was drawn for), then its boundary's centroid. */
function anchorsOf(doc: VwxDocument, sp: Space, world: readonly Pt[]): Pt[] {
  const anchors: Pt[] = [];
  const handle = { x: sp.num(F.labelX), y: sp.num(F.labelY) };
  if (handle.x !== 0 || handle.y !== 0) anchors.push(frameOf(doc, sp.id).toWorld(handle));
  anchors.push(centroidOf(world));
  return anchors;
}

/** The first of `rooms` that holds one of `anchors`, tried in their order. */
function roomAt(rooms: readonly WallRoom[], anchors: readonly Pt[]): WallRoom | null {
  for (const at of anchors) {
    const room = rooms.find((r) => insideRing(at, r.net));
    if (room) return room;
  }
  return null;
}

/**
 * The room Space `id` is to be put on: the one of `rooms` that holds its anchor, unless its
 * boundary matches it already (net corners, and gross area as the Space keeps it). With `before`
 * (the rooms the same walls closed at the last look) only a room that has changed since counts,
 * so a Space whose own walls stood still is left as it is: Vectorworks' own boundaries differ
 * from Rodeo's rooms where doors open into a room (FORMAT.md, "Space objects"), and aren't to be
 * redrawn because some other wall moved.
 */
function roomFor(doc: VwxDocument, id: string, rooms: readonly WallRoom[], units: string | undefined, before?: readonly WallRoom[]): WallRoom | null {
  const sp = spaceOf(doc, id);
  const world = netBoundaryOf(doc, id);
  if (!sp || !world) return null;
  const anchors = anchorsOf(doc, sp, world);
  const room = roomAt(rooms, anchors);
  if (!room) return null;
  if (before) {
    const was = roomAt(before, anchors);
    if (was && sameRing(was.net, room.net) && (!was.gross || !room.gross ? was.gross === room.gross : sameRing(was.gross, room.gross))) return null;
  }
  const netSame = sameRing(room.net, world);
  // the gross area it keeps: from its figure, when the format has one (the figure is what Rodeo last set)
  const grossSame = !room.gross || !sp.has(F.grossArea) || Math.abs(measured(sp, F.grossArea, units) - ringArea(room.gross)) <= Math.max(1, ringArea(room.gross) * 1e-6);
  return netSame && grossSame ? null : room;
}

/** Puts Space `id`'s path on the room's net ring and draws it again with the room's gross ring. In the open batch. */
function reshape(s: EditSession, id: string, room: WallRoom, attrs?: Partial<Attributes>): void {
  reshapeSpace(s, id, room.net, { gross: room.gross, attrs });
}

/**
 * Keeps the Spaces with Auto-Boundary set to the walls round them, in one step (joined to the edit
 * that moved the walls, when a follower calls it): each Space whose room has changed since the
 * last call on this session takes its room's boundaries. The first call on a session only looks
 * (a drawing is opened as it was saved), and a call with the walls and the auto Spaces as they
 * were does nothing. With `all`, every auto Space is put on its room, changed or not. Returns how
 * many Spaces were reshaped. Never throws: a level whose walls can't be joined, or a Space that
 * can't be drawn, is left as it is.
 */
export function refitSpaces(s: EditSession, attrs?: Partial<Attributes>, all = false): number {
  const doc = s.doc;
  if (!doc.hasPluginFormat(SPACE)) return 0;
  const autos = allSpaces(doc).filter((sp) => sp.flag(F.autoBoundary));
  if (!autos.length) return 0;
  const levels = levelsOf(doc, autos);
  const footprints = levels.map((lvl) => {
    try {
      return lvl.walls.length ? s.wallFootprints(lvl.walls) : [];
    } catch {
      return null;
    }
  });
  const signature = [
    ...levels.map((lvl, i) => `E${lvl.elevation}|${lvl.walls.join(",")}|${(footprints[i] ?? []).map((f) => f.map((p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`).join(" ")).join(";")}`),
    `S${autos.map((sp) => sp.id).sort().join(",")}`,
  ].join("\n");
  const before = seen.get(s);
  if (!all && before?.signature === signature) return 0;

  const rooms = new Map<number, readonly WallRoom[]>();
  levels.forEach((lvl, i) => {
    const fp = footprints[i];
    if (!fp) return;
    try {
      rooms.set(lvl.elevation, roomsOf(fp));
    } catch {
      // its walls can't be joined: its Spaces stay as they are
    }
  });
  const units = doc.info.units;
  const plan: { id: string; room: WallRoom }[] = [];
  if (all || before) {
    for (const lvl of levels) {
      const now = rooms.get(lvl.elevation);
      const was = before?.rooms.get(lvl.elevation);
      // a level seen for the first time has no rooms to compare with: only looked at
      if (!now || (!all && !was)) continue;
      for (const sp of lvl.spaces) {
        try {
          const room = roomFor(doc, sp.id, now, units, all ? undefined : was);
          if (room) plan.push({ id: sp.id, room });
        } catch {
          // left as it is
        }
      }
    }
  }
  if (plan.length) {
    try {
      s.followOn(() => s.batch(() => plan.forEach(({ id, room }) => reshape(s, id, room, attrs))));
    } catch (err) {
      console.warn(err);
      return 0;
    }
  }
  seen.set(s, { signature, rooms });
  return plan.length;
}

/**
 * Keeps one Space to the walls round it, as refitSpaces does for each auto Space, with no
 * signature: for code that has just switched Auto-Boundary on. In a step of its own, or the open
 * batch's. True when it was reshaped.
 */
export function refitSpace(s: EditSession, id: string, attrs?: Partial<Attributes>): boolean {
  const doc = s.doc;
  const sp = spaceOf(doc, id);
  if (!sp) return false;
  const walls = wallsAt(doc, elevationOf(doc, sp.layerId));
  if (!walls.length) return false;
  let rooms: WallRoom[];
  try {
    rooms = roomsOf(s.wallFootprints(walls));
  } catch {
    return false;
  }
  const room = roomFor(doc, id, rooms, doc.info.units);
  if (!room) return false;
  try {
    s.batch(() => reshape(s, id, room, attrs));
  } catch (err) {
    console.warn(err);
    return false;
  }
  return true;
}
