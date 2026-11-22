// Run with: npx tsx src/app/schedules.check.ts
import assert from "node:assert/strict";
import {
  freeScheduleName,
  PRESETS,
  placementOn,
  quoted,
  scheduleSpec,
  type ScheduleSource,
  type SchedulePreset,
} from "./schedules.ts";

/** A drawing's formats, as the presets read them: plug-in parameter names, and data record fields. */
function source(opts: {
  plugins?: Record<string, string[]>;
  data?: Record<string, string[]>;
  units?: string;
}): ScheduleSource {
  const plugins = opts.plugins ?? {};
  const data = opts.data ?? {};
  const formats = Object.keys(data).map((name, i) => ({ format: i + 1, name }));
  return {
    units: opts.units,
    hasPluginFormat: (name) => name in plugins,
    recordFormats: () => formats,
    recordFormatFields: (format) => {
      const f = formats.find((x) => x.format === format);
      return f ? data[f.name].map((name) => ({ name })) : null;
    },
    pluginFieldNames: (name) => plugins[name] ?? [],
  };
}

const preset = (id: SchedulePreset["id"]): SchedulePreset => {
  const found = PRESETS.find((p) => p.id === id);
  assert.ok(found, `no preset ${id}`);
  return found;
};

const doorFields = ["IDLabel", "Width", "Height", "OnSched", "Manuf", "Notes"];

// doors with the on-schedule field: the criteria pick them, columns come from the fields they have
{
  const built = scheduleSpec(source({ plugins: { Door: doorFields }, units: "Millimeters" }), preset("door"));
  assert.ok(!("error" in built));
  assert.equal(built.spec.criteria, "=DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))");
  assert.equal(built.all, false);
  assert.equal(built.databaseRow, 2);
  assert.deepEqual(built.sheet.rows[1].map((c) => c?.value), ["Mark", "Width", "Height", "Manufacturer", "Notes"]);
  assert.equal(built.spec.columns[0]?.text, "='Door'.'IDLabel'");
  assert.equal(built.spec.columns[0]?.sort, "ascending");
  assert.equal(built.spec.columns[0]?.precedence, 1);
  assert.equal(built.spec.columns[1]?.format, 5);
  assert.equal(built.spec.columns[1]?.text, "='Door'.'Width'");
  assert.equal(built.spec.columns[1]?.sort, undefined);
  assert.deepEqual(built.missing, ["Thickness", "Type", "Leaf", "Material", "Head Detail", "Jamb Detail", "Threshold Detail", "Model"]);
  assert.equal(built.sheet.rows[0][0]?.value, "Door Schedule");
  assert.equal(built.sheet.rows[0][0]?.bold, true);
  assert.equal(built.sheet.rows[2].length, built.sheet.widths.length);
  assert.ok(built.sheet.widths.every((w) => w >= 60));
  assert.ok(built.sheet.widths[0] >= 110, "text columns are at least 110 points");
  assert.ok(built.sheet.widths[1] >= 72, "dimension columns are at least 72 points");
}

// no on-schedule field: the short criteria, every door
{
  const built = scheduleSpec(source({ plugins: { Door: ["IDLabel", "Width"] } }), preset("door"));
  assert.ok(!("error" in built));
  assert.equal(built.spec.criteria, "=DATABASE((R IN ['Door']))");
  assert.equal(built.all, true);
}

// no door format: an error naming the doors
{
  const built = scheduleSpec(source({ plugins: { Window: ["Width"] } }), preset("door"));
  assert.ok("error" in built);
  assert.equal(built.error, "This drawing has no doors yet: place one, and its schedule can be made.");
  const windows = scheduleSpec(source({}), preset("window"));
  assert.ok("error" in windows);
  assert.match(windows.error, /no windows yet/);
}

// rooms: the Space plug-in, then the older Space Data record, which has no finishes
{
  const space = scheduleSpec(
    source({ plugins: { Space: ["Number", "Name", "Space Type", "Area", "Perim", "Extrusion Height", "On Schedule"] }, units: "Feet" }),
    preset("room"),
  );
  assert.ok(!("error" in space));
  // every Space is listed, whatever its On Schedule says
  assert.equal(space.spec.criteria, "=DATABASE((R IN ['Space']))");
  assert.deepEqual(space.sheet.rows[1].map((c) => c?.value), ["Number", "Name", "Type", "Area", "Perimeter", "Clear Height"]);
  const area = space.spec.columns[3];
  assert.equal(area?.format, 11);
  assert.equal(area?.accuracy, 2);
  assert.equal(space.spec.columns[4]?.format, 5);
  assert.equal(space.spec.columns[4]?.accuracy, 4, "imperial lengths use 1/16 inch");
  assert.equal(space.spec.columns[0]?.precedence, 1);

  const data = scheduleSpec(
    source({ data: { "Space Data": ["Space Number", "Space Name", "Department", "Area", "Height"] } }),
    preset("room"),
  );
  assert.ok(!("error" in data));
  assert.equal(data.spec.criteria, "=DATABASE((R IN ['Space Data']))");
  assert.deepEqual(data.sheet.rows[1].map((c) => c?.value), ["Number", "Name", "Department", "Area", "Height"]);
  assert.equal(data.spec.columns[0]?.text, "='Space Data'.'Space Number'");
  assert.equal(data.all, true);

  const finishes = scheduleSpec(source({ data: { "Space Data": ["Space Number"] } }), preset("finishes"));
  assert.ok("error" in finishes, "Space Data has no finishes");
}

// a Space's name: the shown one, the plain one standing in where the shown one is empty
{
  const both = scheduleSpec(source({ plugins: { Space: ["Number", "Name", "11_NameDisplay"] }, units: "Millimeters" }), PRESETS.find((p) => p.id === "room")!);
  assert.ok(!("error" in both));
  if (!("error" in both)) assert.equal(both.spec.columns[1]?.text, "=IF(('Space'.'11_NameDisplay'=''), 'Space'.'Name', 'Space'.'11_NameDisplay')");
  const shownOnly = scheduleSpec(source({ plugins: { Space: ["Number", "11_NameDisplay"] }, units: "Millimeters" }), PRESETS.find((p) => p.id === "room")!);
  if (!("error" in shownOnly)) assert.equal(shownOnly.spec.columns[1]?.text, "='Space'.'11_NameDisplay'");
}

// finishes need the Space plug-in's fields
{
  const built = scheduleSpec(source({ plugins: { Space: ["Number", "Floor Finish", "Ceiling Material", "On Schedule"] } }), preset("finishes"));
  assert.ok(!("error" in built));
  assert.deepEqual(built.sheet.rows[1].map((c) => c?.value), ["Number", "Floor", "Ceiling"]);
  assert.equal(built.spec.columns[1]?.text, "='Space'.'Floor Finish'");
}

// names with quotes are doubled in the formulas
{
  assert.equal(quoted("O'Brien"), "'O''Brien'");
  const odd: SchedulePreset = {
    ...preset("door"),
    record: (src) => (src.hasPluginFormat("Bob's") ? "Bob's" : null),
    onSchedule: "Is 'set'",
    columns: [{ heading: "It's", field: "it's" }],
  };
  const withField = scheduleSpec(
    { ...source({}), hasPluginFormat: (n) => n === "Bob's", pluginFieldNames: () => ["it's", "Is 'set'"] },
    odd,
  );
  assert.ok(!("error" in withField));
  assert.equal(withField.spec.criteria, "=DATABASE(((R IN ['Bob''s']) & ('Bob''s'.'Is ''set'''=TRUE)))");
  assert.equal(withField.spec.columns[0]?.text, "='Bob''s'.'it''s'");
}

// placement: a sheet layer's page top left, 20 mm in; a design layer at its scale, in what the window shows
{
  const page = { id: "a", name: "A-1", title: "", kind: "sheet", scale: 1, visibility: "visible", objectCount: 0, page: { width: 420, height: 297 } };
  const design = { id: "b", name: "Plan", title: "", kind: "design", scale: 50, visibility: "visible", objectCount: 0 };
  assert.deepEqual(placementOn([page, design] as never, "a"), { at: { x: -190, y: 128.5 }, scale: 1 });
  assert.deepEqual(placementOn([page, design] as never, "b"), { at: { x: 1000, y: 13850 }, scale: 50 });
  assert.deepEqual(placementOn([page, design] as never, "b", { x0: -5000, y0: -3000, x1: 9000, y1: 6000 }), { at: { x: -4000, y: 5000 }, scale: 50 });
  assert.deepEqual(placementOn([page, design] as never, null), { at: { x: 20, y: 277 }, scale: 1 });
}

// names: the title, then -2, -3 for the ones taken
{
  assert.equal(freeScheduleName(new Set(), "Door Schedule"), "Door Schedule");
  assert.equal(freeScheduleName(new Set(["Door Schedule"]), "Door Schedule"), "Door Schedule-2");
  assert.equal(freeScheduleName(new Set(["Door Schedule", "Door Schedule-2"]), "Door Schedule"), "Door Schedule-3");
}

console.log("schedules.check: all checks pass");
