// Colour Spaces: a view setting that colours the rooms on the design layers by one of their fields
// (Occupancy, Department, Space Type, Name, Floor Finish, Ceiling Finish), or by one of the drawing's
// own by-field visualisations for Spaces (such as "Finish Plan", which colours each finish line by its
// key and uses the file's colours). It is Rodeo's own setting, kept for this session only per open
// drawing, and is not written to the file: where Vectorworks keeps its own choice is not known.
//
// The dialog is colourSpacesDialog(), which the menu opens (View > Colour Spaces). designLayerStyles
// is what the renderer asks for a design layer's styles, and spaceColours is the 3D colour per Space
// (app.ts gives it to the 3D view's meshes). The pure helpers are checked by
// web/src/core/dataviz.check.ts.

import { type DataViz, fieldText, fieldViz } from "../../core/dataviz.ts";
import type { StyleOverride, VwxDocument } from "../../core/index.ts";
import { appContext } from "../ext.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { allSpaces, F, SPACE } from "./model.ts";

/** The fields a room is coloured by, by the name the dialog shows. */
const BY_FIELD: readonly { readonly label: string; readonly field: string }[] = [
  { label: "Occupancy", field: F.occupancyShown },
  { label: "Department", field: F.department },
  { label: "Space Type", field: F.spaceType },
  { label: "Name", field: F.nameShown },
  { label: "Floor Finish", field: F.floorFinish },
  { label: "Ceiling Finish", field: F.ceilingFinish },
];

/** The colouring a drawing has: the choice's key, its name, and the visualisations that colour it. */
export interface Colouring {
  readonly key: string;
  readonly name: string;
  /** one of the drawing's own visualisations, as the file has it */
  readonly viz?: DataViz;
  /** a Space parameter: its visualisation is made from the values the rooms hold now */
  readonly field?: string;
}

/** The visualisations a colouring colours with now: a field's from the rooms' present values, so a new value gets a colour. */
function vizsOf(doc: VwxDocument, c: Colouring): DataViz[] {
  if (c.viz) return [c.viz];
  return c.field ? [fieldViz(c.name, SPACE, SPACE, c.field, spaceValues(doc, c.field))] : [];
}

/** The colouring of each open drawing (keyed by its document, which is the session's): none when absent. */
const colourings = new WeakMap<VwxDocument, Colouring>();

const listeners: (() => void)[] = [];
/** Has `f` called when a drawing's colouring is chosen or turned off (the 3D view builds its model again). */
export function onColouringChange(f: () => void): void {
  listeners.push(f);
}

/** The current colouring of a drawing, or null when off. Its identity changes when the choice does. */
export function activeColouring(doc: VwxDocument): Colouring | null {
  return colourings.get(doc) ?? null;
}

/**
 * The styles a design layer's objects take from the colouring (null when it is off, or changes
 * nothing on this layer). Cached by the scene per layer until the document or the choice changes.
 */
export function designLayerStyles(doc: VwxDocument, layerId: string): ReadonlyMap<string, StyleOverride> | null {
  const c = colourings.get(doc);
  return c ? doc.layerVizStyles(layerId, vizsOf(doc, c)) : null;
}

/** Whether the open drawing has a Space object to colour. */
export const hasSpaceObjects = (): boolean => !!store.session && store.session.doc.hasPluginFormat(SPACE) && allSpaces(store.session.doc).length > 0;

/** The by-field visualisations of the drawing that colour Spaces, as the file has them, in its order. */
function fileSpaceVizs(doc: VwxDocument): DataViz[] {
  return doc.dataVizs().filter((v) => v.field && v.criteria && "test" in v.criteria && v.criteria.test === "plugin" && v.criteria.value === SPACE);
}

/** The distinct values of a Space field over the drawing's Spaces (no empty ones). */
function spaceValues(doc: VwxDocument, field: string): string[] {
  const out: string[] = [];
  for (const sp of allSpaces(doc)) {
    const own = (doc.records(sp.id) as { parametric: boolean; fields: { name: string; value: unknown }[] }[]).find((r) => r.parametric);
    const v = fieldText(own?.fields.find((f) => f.name === field)?.value);
    if (v !== null) out.push(v);
  }
  return out;
}

/** Opens the Colour Spaces dialog and applies its choice to the open drawing (a view setting: not saved in the file). */
export async function colourSpacesDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc as VwxDocument;
  const file = fileSpaceVizs(doc);
  const options = [
    { value: "", label: "Off" },
    ...BY_FIELD.map((b) => ({ value: `field:${b.field}`, label: b.label })),
    ...file.map((v) => ({ value: `viz:${v.guid}`, label: v.name })),
  ];
  const current = colourings.get(doc)?.key ?? "";
  const v = await toolPrefs(
    "Colour Spaces",
    [{ kind: "choice", key: "by", label: "Colour by", value: options.some((o) => o.value === current) ? current : "", options }],
    "Colours the rooms on the design layers for this session only; the drawing's own colours come from its visualisation when one is chosen. Not saved in the file.",
  );
  if (!v) return;
  const key = v.choice("by");
  if (key === "") {
    colourings.delete(doc);
    toast("Rooms are no longer coloured.", "info");
    for (const f of listeners) f();
    appContext()?.requestDraw();
    return;
  }
  let name = "";
  if (key.startsWith("field:")) {
    const b = BY_FIELD.find((x) => `field:${x.field}` === key);
    if (!b) return;
    name = b.label;
    colourings.set(doc, { key, name, field: b.field });
  } else {
    const f = file.find((x) => `viz:${x.guid}` === key);
    if (!f) return;
    name = f.name;
    colourings.set(doc, { key, name, viz: f });
  }
  toast(`Rooms are coloured by ${name}. This is a view setting: it is not saved in the file.`, "info");
  for (const f of listeners) f();
  appContext()?.requestDraw();
}

/** The colour and value of each room's entry in the colouring, for a legend: sorted by value. */
export function colourLegend(doc: VwxDocument): { value: string; color: string }[] {
  const c = colourings.get(doc);
  if (!c) return [];
  const out: { value: string; color: string }[] = [];
  for (const viz of vizsOf(doc, c)) {
    for (const [value, style] of viz.values) {
      const f = style.fill;
      if (f?.kind === "solid") out.push({ value, color: f.color });
      else if (f?.kind === "pattern") out.push({ value, color: f.back });
    }
  }
  return out.sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
}

/**
 * The 3D colour of each Space (by its object id) that the colouring gives, as CSS. A Space takes the
 * value its own record of the visualisation's format holds; a by-field visualisation on another format
 * (such as a finish line's) gives the Spaces no colour, so it is only drawn on the plan.
 */
export function spaceColours(doc: VwxDocument): Map<string, string> {
  const out = new Map<string, string>();
  const c = colourings.get(doc);
  if (!c) return out;
  for (const viz of vizsOf(doc, c)) {
    if (!viz.field) continue;
    const { record, field } = viz.field;
    for (const sp of allSpaces(doc)) {
      const r = (doc.records(sp.id) as { name: string; fields: { name: string; value: unknown }[] }[]).find((x) => x.name === record);
      const style = viz.values.get(fieldText(r?.fields.find((f) => f.name === field)?.value) ?? "");
      const f = style?.fill;
      const color = f?.kind === "solid" ? f.color : f?.kind === "pattern" ? f.back : null;
      if (color) out.set(sp.id, color);
    }
  }
  return out;
}
