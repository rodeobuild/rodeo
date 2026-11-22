// Tools > Reports > Create Schedule…: a worksheet that lists the drawing's doors, windows, rooms or
// room finishes, one line each, as a database row (core setDatabaseRow): its criteria pick the
// objects whose record is set to show on schedules, and each column is a formula for that object,
// worked out again after each change to the drawing. The columns come from the record's own
// fields; a field the drawing's record doesn't have is left out and named.
//
// This file is the pure part (presets, the database row's spec, the worksheet's shape), so it runs
// without the page: schedules.check.ts. The dialogs are schedulesDialog.ts.

import type { DatabaseColumnSpec, DatabaseRowSpec, EditSession, LayerInfo, NewSheetCell, NewWorksheet, Pt, VwxDocument } from "../core/index.ts";
import { millimetresPerUnit } from "../core/unitSize.ts";

/** What the presets read of a drawing: its units, its plug-in and data record formats and their fields. */
export interface ScheduleSource {
  readonly units?: string;
  hasPluginFormat(name: string): boolean;
  recordFormats(): readonly { readonly format: number; readonly name: string }[];
  recordFormatFields(format: number): readonly { readonly name: string }[] | null;
  /** a plug-in's parameter names, as its format in the drawing has them; empty when the drawing has none */
  pluginFieldNames(name: string): readonly string[];
}

/** worksheet number formats (as reportRows.ts) */
const DIMENSION = 5;
const AREA = 11;

export interface PresetColumn {
  heading: string;
  /** the record field, or the first of several that the record has */
  field: string | readonly string[];
  /** sorted ascending, in the order the sorted columns come */
  sort?: boolean;
  /** a number format: 5 dimension (its accuracy from the units), 11 area */
  format?: number;
  accuracy?: number;
  /** points; left out, the width comes from the heading */
  width?: number;
  /**
   * A field to show instead of `field` wherever it has a value: a Space's shown name is "11_NameDisplay",
   * and its plain "Name" is often another room's in files Vectorworks saved (the Spaces session's
   * measurement), so the plain one only stands in where the shown one is empty.
   */
  shown?: string;
}

export interface SchedulePreset {
  id: "door" | "window" | "room" | "finishes";
  /** the worksheet's name, and its title row */
  title: string;
  /** the record the schedule reads in this drawing, or null when the drawing has none */
  record(src: ScheduleSource): string | null;
  /** the field that marks an object as set to show on schedules, when its record has one */
  onSchedule?: string;
  columns: PresetColumn[];
  /** the columns for the older "Space Data" record, when it is the one read */
  dataColumns?: PresetColumn[];
  /** the error when the drawing has no such record */
  noRecord: string;
  /** the dialog's note on what the schedule lists */
  note: string;
  /** the dialog's note when the schedule lists every object (no on-schedule field) */
  noteAll: string;
  /** the toast's lead-in for the columns left out */
  leftOut: string;
}

/** The schedule's record, its first found in the drawing: a plug-in's, else the older data record */
const plugin =
  (name: string) =>
  (src: ScheduleSource): string | null =>
    src.hasPluginFormat(name) ? name : null;

const roomRecord = (src: ScheduleSource): string | null => {
  if (src.hasPluginFormat("Space")) return "Space";
  return src.recordFormats().some((f) => f.name === "Space Data") ? "Space Data" : null;
};

const text = (heading: string, field: string | readonly string[]): PresetColumn => ({ heading, field });
const dimension = (heading: string, field: string | readonly string[]): PresetColumn => ({ heading, field, format: DIMENSION });
const area = (heading: string, field: string | readonly string[]): PresetColumn => ({ heading, field, format: AREA, accuracy: 2 });

export const PRESETS: readonly SchedulePreset[] = [
  {
    id: "door",
    title: "Door Schedule",
    record: plugin("Door"),
    onSchedule: "OnSched",
    columns: [
      { heading: "Mark", field: "IDLabel", sort: true },
      dimension("Width", "Width"),
      dimension("Height", "Height"),
      dimension("Thickness", "DoorThickness"),
      text("Type", "Configuration"),
      text("Leaf", "LeafType"),
      text("Material", "DoorMaterial"),
      text("Head Detail", "HeadDetail"),
      text("Jamb Detail", "JambDetail"),
      text("Threshold Detail", "ThreshDetail"),
      text("Manufacturer", "Manuf"),
      text("Model", "Model"),
      text("Notes", "Notes"),
    ],
    noRecord: "This drawing has no doors yet: place one, and its schedule can be made.",
    note: "The schedule lists every door that is set to show on schedules, and follows the drawing: it is worked out again after each change. Columns come from the doors' own parameters.",
    noteAll: "The schedule lists every door, and follows the drawing: it is worked out again after each change. Columns come from the doors' own parameters.",
    leftOut: "Left out (not in this drawing's doors):",
  },
  {
    id: "window",
    title: "Window Schedule",
    record: plugin("Window"),
    onSchedule: "OnSchedule",
    columns: [
      { heading: "Mark", field: "IDLabel", sort: true },
      dimension("Width", "Width"),
      dimension("Height", "Height"),
      text("Glazing", "GlassDesc"),
      text("Head Detail", "HeadDetail"),
      text("Jamb Detail", "JambDetail"),
      text("Sill Detail", "SillDetail"),
      text("Manufacturer", "ManufSupplier"),
      text("Model", "Model"),
      text("Description", "WindowDesc"),
    ],
    noRecord: "This drawing has no windows yet: place one, and its schedule can be made.",
    note: "The schedule lists every window that is set to show on schedules, and follows the drawing: it is worked out again after each change. Columns come from the windows' own parameters.",
    noteAll: "The schedule lists every window, and follows the drawing: it is worked out again after each change. Columns come from the windows' own parameters.",
    leftOut: "Left out (not in this drawing's windows):",
  },
  {
    id: "room",
    title: "Room Schedule",
    record: roomRecord,
    // every Space: in drawings Vectorworks saved, Spaces that its own room schedules list have On Schedule unticked
    columns: [
      { heading: "Number", field: "Number", sort: true },
      { ...text("Name", ["Name", "11_NameDisplay"]), shown: "11_NameDisplay" },
      text("Type", "Space Type"),
      text("Department", "GSA_Occ_Org_Name"),
      area("Area", "Area"),
      dimension("Perimeter", "Perim"),
      dimension("Clear Height", "Extrusion Height"),
    ],
    dataColumns: [
      { heading: "Number", field: "Space Number", sort: true },
      text("Name", "Space Name"),
      text("Department", "Department"),
      area("Area", "Area"),
      dimension("Height", "Height"),
    ],
    noRecord: "This drawing has no rooms yet: place one, and its schedule can be made.",
    note: "The schedule lists every room, and follows the drawing: it is worked out again after each change. Columns come from the rooms' own data.",
    noteAll: "The schedule lists every room, and follows the drawing: it is worked out again after each change. Columns come from the rooms' own data.",
    leftOut: "Left out (not in this drawing's rooms):",
  },
  {
    id: "finishes",
    title: "Room Finish Schedule",
    record: plugin("Space"),
    // every Space: in drawings Vectorworks saved, Spaces that its own room schedules list have On Schedule unticked
    columns: [
      { heading: "Number", field: "Number", sort: true },
      { ...text("Name", ["Name", "11_NameDisplay"]), shown: "11_NameDisplay" },
      text("Floor", "Floor Finish"),
      text("Base", "Base Material"),
      text("North Wall", "North Wall Finish"),
      text("East Wall", "East Wall Finish"),
      text("South Wall", "South Wall Finish"),
      text("West Wall", "West Wall Finish"),
      text("Ceiling", "Ceiling Material"),
      text("Remarks", "Finish Remarks"),
    ],
    noRecord: "This drawing has no rooms with finishes yet: place a room with the Space tool, and its schedule can be made.",
    note: "The schedule lists every room, and follows the drawing: it is worked out again after each change. Columns come from the rooms' finishes.",
    noteAll: "The schedule lists every room, and follows the drawing: it is worked out again after each change. Columns come from the rooms' finishes.",
    leftOut: "Left out (not in this drawing's rooms):",
  },
];

/** Accuracy of a length in the drawing's units: decimal places, or for imperial drawings 4 (1/16"). */
export function lengthAccuracy(units: string | undefined): number {
  const u = (units ?? "").toLowerCase();
  if (u.includes("feet") || u.includes("foot") || u.includes("inch")) return 4;
  return Math.min(10, Math.max(0, Math.round(Math.log10(millimetresPerUnit(units)))));
}

/** A worksheet formula's quoted text: its quotes doubled. */
export function quoted(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

/** A field's name in the drawing's records: the first of the column's fields that the record has. */
function fieldIn(fields: ReadonlySet<string>, field: string | readonly string[]): string | null {
  const options = typeof field === "string" ? [field] : field;
  return options.find((f) => fields.has(f)) ?? null;
}

/** The names of the fields a record has in this drawing, or null when it has no such record. */
function fieldsOf(src: ScheduleSource, record: string): Set<string> | null {
  if (src.hasPluginFormat(record)) return new Set(src.pluginFieldNames(record));
  const format = src.recordFormats().find((f) => f.name === record);
  if (!format) return null;
  return new Set((src.recordFormatFields(format.format) ?? []).map((f) => f.name));
}

/** A column's width in points: its heading, at least as wide as a text or number column is. */
function widthFor(heading: string, numeric: boolean): number {
  const fit = Math.round([...heading].length * 6.2 + 14);
  return Math.min(240, Math.max(numeric ? 72 : 110, fit));
}

export type ScheduleSpec = {
  sheet: NewWorksheet;
  databaseRow: number;
  spec: DatabaseRowSpec;
  /** the headings of the columns the record doesn't have */
  missing: string[];
  /** true when the criteria take every object: the record has no on-schedule field */
  all: boolean;
};

/**
 * The worksheet a preset makes in this drawing: row 1 the title, row 2 the columns' headings, row 3
 * the database row (its header cells are the formulas). `missing` names the columns whose field the
 * record doesn't have, which are left out. An error when the drawing has no such record.
 */
export function scheduleSpec(src: ScheduleSource, preset: SchedulePreset): ScheduleSpec | { error: string } {
  const record = preset.record(src);
  const fields = record ? fieldsOf(src, record) : null;
  if (!record || !fields) return { error: preset.noRecord };
  const all = record === "Space Data" && preset.dataColumns ? preset.dataColumns : preset.columns;
  const accuracy = lengthAccuracy(src.units);
  const missing: string[] = [];
  const kept: { column: PresetColumn; field: string }[] = [];
  for (const column of all) {
    const field = fieldIn(fields, column.field);
    if (field === null) missing.push(column.heading);
    else kept.push({ column, field });
  }
  if (kept.length === 0) return { error: preset.noRecord };

  const onSchedule = preset.onSchedule && fields.has(preset.onSchedule) ? preset.onSchedule : null;
  const criteria = onSchedule
    ? `=DATABASE(((R IN [${quoted(record)}]) & (${quoted(record)}.${quoted(onSchedule)}=TRUE)))`
    : `=DATABASE((R IN [${quoted(record)}]))`;

  let precedence = 0;
  const columns: (DatabaseColumnSpec | null)[] = kept.map(({ column, field }) => {
    const plain = `${quoted(record)}.${quoted(field)}`;
    const shown = column.shown && column.shown !== field && fields.has(column.shown) ? `${quoted(record)}.${quoted(column.shown)}` : null;
    const spec: DatabaseColumnSpec = { text: shown ? `=IF((${shown}=''), ${plain}, ${shown})` : `=${plain}` };
    if (column.sort) {
      precedence++;
      spec.sort = "ascending";
      spec.precedence = precedence;
    }
    if (column.format !== undefined) {
      spec.format = column.format;
      spec.accuracy = column.format === DIMENSION ? accuracy : (column.accuracy ?? 2);
    }
    return spec;
  });

  const head: NewSheetCell[] = kept.map(({ column }) => ({
    value: column.heading,
    bold: true,
    align: column.format !== undefined ? "right" : undefined,
  }));
  const sheet: NewWorksheet = {
    name: preset.title,
    widths: kept.map(({ column }) => column.width ?? widthFor(column.heading, column.format !== undefined)),
    rowHeight: 18,
    rows: [
      [{ value: preset.title, bold: true }, ...kept.slice(1).map(() => null)],
      head,
      kept.map(() => null),
    ],
  };
  return { sheet, databaseRow: 2, spec: { criteria, columns }, missing, all: onSchedule === null };
}

/** Where a worksheet goes on a layer, and how big: its top left corner (mm) and its scale. */
export interface Placement {
  at: Pt;
  /** 1 on a sheet layer; a design layer's own scale, so the worksheet reads there at the size it prints */
  scale: number;
}

/**
 * Where a worksheet goes on a layer. On a sheet layer: the top left corner of its page, 20 mm in. On a
 * design layer it is drawn at the layer's scale (a 1:100 layer shows it 100 times its paper size, as it
 * shows text), 20 mm of paper in from the top left of `visible` (what the window shows of that layer,
 * when it is the one in view), else from the drawing's origin.
 */
export function placementOn(layers: readonly LayerInfo[], layerId: string | null, visible?: { x0: number; y0: number; x1: number; y1: number } | null): Placement {
  const layer = layers.find((l) => l.id === layerId);
  if (layer?.kind === "sheet") return { at: layer.page ? { x: -layer.page.width / 2 + 20, y: layer.page.height / 2 - 20 } : { x: 20, y: 277 }, scale: 1 };
  const scale = layer && layer.scale > 0 ? layer.scale : 1;
  if (visible) return { at: { x: visible.x0 + 20 * scale, y: visible.y1 - 20 * scale }, scale };
  return { at: { x: 20 * scale, y: 277 * scale }, scale };
}

/** The source of the presets for a drawing. */
export function scheduleSourceOf(doc: VwxDocument): ScheduleSource {
  const names = new Map<string, readonly string[]>();
  return {
    units: doc.info.units,
    hasPluginFormat: (name) => doc.hasPluginFormat(name),
    recordFormats: () => doc.recordFormats(),
    recordFormatFields: (format) => doc.recordFormatFields(format),
    pluginFieldNames(name) {
      let found = names.get(name);
      if (found === undefined) {
        found = doc.formulaRecords().find((r) => r.plugin && r.name === name)?.fields ?? [];
        names.set(name, found);
      }
      return found;
    },
  };
}

/**
 * Makes the schedule as one change: the worksheet, its database row, and, when `place` is given, the
 * worksheet shown on that layer. Returns the worksheet's name index.
 */
export function createSchedule(s: EditSession, preset: SchedulePreset, name: string, place: ({ layerId: string } & Placement) | null): number {
  const built = scheduleSpec(scheduleSourceOf(s.doc), preset);
  if ("error" in built) throw new Error(built.error);
  return s.batch(() => {
    const index = s.createWorksheet({ ...built.sheet, name });
    s.setDatabaseRow(index, built.databaseRow, built.spec);
    if (place) s.placeWorksheet(index, place.layerId, place.at, place.scale);
    return index;
  });
}

/** The first of "<title>", "<title>-2", "<title>-3"… that no resource or layer of the drawing is called. */
export function freeScheduleName(taken: ReadonlySet<string>, title: string): string {
  if (!taken.has(title)) return title;
  let n = 2;
  while (taken.has(`${title}-${n}`)) n++;
  return `${title}-${n}`;
}
