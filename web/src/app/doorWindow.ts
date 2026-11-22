// Doors and windows as Rodeo draws them: placed in a straight wall (the Door and Window tools) or on their own, each one a
// plug-in object whose parameters are Vectorworks' own and whose drawing Rodeo makes from them (doorWindowDraw.ts gives the
// shapes; this module sends them to the drawing, keeps them up to date when a parameter or a flip changes, and gives Object
// Info its layout). A door or window Vectorworks drew is redrawn Rodeo's way when one of its parameters changes.

import type { Attributes, EditSession, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import {
  buildFrom,
  choicesOf,
  DOOR,
  DOOR_LAYOUT_FIELDS,
  defaultsOf,
  fieldsOf,
  getterOf,
  LABELS,
  planShapesOf,
  solidParts,
  WINDOW,
  WINDOW_LAYOUT_FIELDS,
  type Built,
  type Kind,
  type PartShape,
} from "./doorWindowDraw.ts";
import { store } from "./state.ts";
import { errorMessage } from "./toast.ts";
import { nearColour } from "./siteModel.ts";

export { DOOR, WINDOW, type Kind } from "./doorWindowDraw.ts";

type Look = Partial<Attributes>;

const NOTE = "Drawn by Rodeo from these parameters. A door or window Vectorworks drew is redrawn Rodeo's way when a parameter changes.";
const FLIP_SIDE = 90;
const FLIP_HINGE = 91;

/** the record a door or window keeps its parameters in */
function recordOf(doc: VwxDocument, id: string): { kind: Kind; format: number; fields: { name: string; value: RecordValue }[] } | null {
  const rec = doc.records(id).find((r) => r.parametric && (r.name === DOOR || r.name === WINDOW));
  return rec ? { kind: rec.name as Kind, format: rec.format, fields: rec.fields } : null;
}

/** what the object's record says, drawn: its parameters, and the hole in its wall (or its jamb depth, when it is in none) */
function currentOf(s: EditSession, id: string): { kind: Kind; built: Built } {
  const rec = recordOf(s.doc, id);
  if (!rec) throw new Error("That isn't a door or window.");
  const values = Object.fromEntries(rec.fields.map((f) => [f.name, f.value]));
  const wallThickness = s.wallInsertPlace(id)?.thickness ?? (Number(values.JambDepth) || 100);
  return { kind: rec.kind, built: buildFrom(rec.kind, getterOf(rec.kind, values), wallThickness) };
}

/** the colours the drawing takes from its palette, found by their nearest colour */
function coloursOf(s: EditSession): { white: number; black: number; glassLine: number; glassFill: number } {
  const near = nearColour(s.doc);
  return { white: near("#ffffff"), black: near("#000000"), glassLine: near("#4f6f80"), glassFill: near("#cfe6f2") };
}

/** a plan shape's look: a glass line in blue-grey, a swing in a thin black pen, the parts filled white with a black pen */
function planLook(role: PartShape["role"], c: ReturnType<typeof coloursOf>): Look {
  const base = store.drawAttrs;
  if (role === "glass") return { ...base, fillPattern: 0, lineStyle: 2, lineWeight: 7, penFore: c.glassLine };
  if (role === "swing") return { ...base, fillPattern: 0, lineStyle: 2, lineWeight: 5, penFore: c.black };
  return { ...base, fillPattern: 1, fillFore: c.white, fillBack: c.white, fillOpacity: 100, penFore: c.black, lineStyle: 2, lineWeight: 7 };
}

/** a 3D part's look: glass pale blue and 30% opaque, everything else white */
function solidLook(role: PartShape["role"], c: ReturnType<typeof coloursOf>): Look {
  const base = store.drawAttrs;
  if (role === "glass") return { ...base, fillPattern: 1, fillFore: c.glassFill, fillBack: c.glassFill, fillOpacity: 30, lineStyle: 0 };
  return { ...base, fillPattern: 1, fillFore: c.white, fillBack: c.white, fillOpacity: 100, lineStyle: 0 };
}

/** Draws the object `id` again from its parameters: its plan shapes and 3D parts, which replace its old drawing. */
export function redraw(s: EditSession, id: string): void {
  const cur = currentOf(s, id);
  const object = s.doc.object(id);
  const layerId = object?.layerId;
  if (!object || !layerId) throw new Error("That door or window has no layer.");
  const classIndex = object.classIndex ?? store.activeClassIndex;
  const colours = coloursOf(s);
  const shapes = planShapesOf(cur.built.drawn);
  const ids = shapes.length ? s.addObjects(layerId, shapes.map((p) => p.shape), classIndex, shapes.map((p) => planLook(p.role, colours))) : [];
  // the layer's elevation is added as the faces are made, so they're given below it
  const lift = -(s.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0);
  const parts = solidParts(cur.built.drawn, lift);
  const meshes = parts.length ? s.addMeshes(layerId, parts.map((p) => p.faces), classIndex, parts.map((p) => solidLook(p.role, colours))) : [];
  s.setPluginDrawing(id, [...ids, ...meshes]);
}

/**
 * Sets a door or window in the straight wall `wallId`, its origin where `at` lies along the wall: its hole is cut and the
 * object drawn from `values` (over the table's defaults). `facing` turns it end for end or to the wall's other side.
 */
export function placeInWall(
  s: EditSession,
  kind: Kind,
  wallId: string,
  at: Pt,
  values: Readonly<Record<string, RecordValue>>,
  facing: { reversed?: boolean; flipped?: boolean },
): string {
  return s.batch(() => {
    const merged: Record<string, RecordValue> = { ...(defaultsOf(kind) as Record<string, RecordValue>), ...values };
    const thickness = s.wallSpot(wallId, at).thickness;
    const built = buildFrom(kind, getterOf(kind, merged), thickness);
    const specs: readonly PluginFieldSpec[] = fieldsOf(kind);
    // only the values asked for are written: a drawing that has Vectorworks' own Door or Window format keeps that
    // format's defaults for the rest (the table's are for a drawing with none), so the hole is then fitted to what
    // the new record says
    const id = s.addWallInsert(wallId, kind, specs, values, at, built.drawn.opening, facing);
    s.resizeWallInsert(id, currentOf(s, id).built.drawn.opening);
    redraw(s, id);
    return id;
  });
}

/** Writes parameters and redraws, and moves the hole with them when the object stands in a wall. */
function edited(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const rec = recordOf(s.doc, id);
  if (!rec) throw new Error("That isn't a door or window.");
  for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
  const cur = currentOf(s, id);
  if (s.wallInsertPlace(id)) s.resizeWallInsert(id, cur.built.drawn.opening);
  redraw(s, id);
}

/** the Object Info rows, with their friendly names, and the flip buttons */
function layoutOf(kind: Kind): PluginWidget[] {
  const rows: PluginWidget[] = (kind === DOOR ? DOOR_LAYOUT_FIELDS : WINDOW_LAYOUT_FIELDS).map((field, i) => ({
    id: i + 1,
    kind: "param",
    field,
    label: LABELS[field] ?? "",
    level: 0,
  }));
  const buttons: PluginWidget[] = [{ id: FLIP_SIDE, kind: "button", label: "Flip Side", level: 0 }];
  if (kind === DOOR) buttons.push({ id: FLIP_HINGE, kind: "button", label: "Flip Hinge", level: 0 });
  return [...rows, ...buttons];
}

function driverFor(kind: Kind): PluginDriver {
  return {
    name: kind,
    shape: "point",
    builtIn: true,
    // Reset All Plug-Ins leaves doors and windows as they are: one Vectorworks drew keeps its drawing until a parameter changes
    resets: false,
    note: NOTE,
    label: (field) => LABELS[field],
    readOnly: () => false,
    choices: (field) => choicesOf(kind, field)?.map((value) => ({ value, label: value })),
    place(layerId, at, angle) {
      const r = attempt(`Place ${kind}`, (s) =>
        s.batch(() => {
          const id = s.addPluginObject(layerId, kind, fieldsOf(kind), {}, at, angle);
          redraw(s, id);
          return id;
        }),
      );
      if (r) setSelection([r.value]);
    },
    edit(id, values) {
      attempt(`Edit ${kind}`, (s) => s.batch(() => edited(s, id, values)));
    },
    async reset(id) {
      const s = store.session;
      if (!s) return "No drawing is open.";
      try {
        s.batch(() => redraw(s, id));
        return null;
      } catch (err) {
        return errorMessage(err);
      }
    },
    layout: () => layoutOf(kind),
    // nothing is greyed: every parameter applies to every door or window
    widgetStates(_id, apply) {
      apply(new Map());
    },
    press(id, widget) {
      if (widget === FLIP_SIDE) attempt("Flip Side", (s) => s.flipWallInsert(id, "across"));
      else if (widget === FLIP_HINGE) attempt("Flip Hinge", (s) => s.flipWallInsert(id, "along"));
    },
  };
}

const doorDriver = driverFor(DOOR);
const windowDriver = driverFor(WINDOW);
registerPluginDrivers(() => [doorDriver, windowDriver]);
