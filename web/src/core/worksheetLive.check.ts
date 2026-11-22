// Live worksheets, end to end on a drawing:  npx tsx src/core/worksheetLive.check.ts [files…]
//
// With no sample files it works on a blank drawing: a worksheet made from nothing, a database row
// over plug-in objects made here, formulas in plain cells (those saved as Vectorworks formulas and
// those Rodeo keeps), rows and columns added and deleted, undo, and a save and reopen.
// With files (given, or ../samples/sample.vwx and every .vwx under ../samples/demos/*/, read only):
// recalculating an untouched drawing must change nothing but worksheets whose caches are stale, and
// changing a door's width must change its schedule. Counts only are printed.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { EditSession, PluginFieldSpec } from "./types.ts";

let failed = 0;
function ok(what: string, pass: boolean, detail = ""): void {
  console.log(`${pass ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!pass) failed++;
}

const TEXT = 4;
const DIMENSION = 7;
const BOOLEAN = 2;
const DOOR: readonly PluginFieldSpec[] = [
  { name: "IDLabel", type: TEXT, value: "" },
  { name: "Width", type: DIMENSION, value: 900 },
  { name: "Height", type: DIMENSION, value: 2100 },
  { name: "OnSched", type: BOOLEAN, value: true },
];

function rowsOf(s: EditSession, index: number): string[][] {
  return s.doc.worksheetRows(index) ?? [];
}

function synthetic(): void {
  const s = openVwx(blankDrawing("mm"), "blank.vwx");
  const layer = s.doc.layers().find((l) => l.kind === "design")!;
  const doors = ["D3", "D1", "D2"].map((label, i) => s.addPluginObject(layer.id, "Door", DOOR, { IDLabel: label, Width: 800 + 100 * i, OnSched: label !== "D2" }, { x: 1000 * i, y: 0 }, 0));
  const index = s.createWorksheet({
    name: "Door Schedule",
    widths: [80, 80, 80],
    rowHeight: 18,
    rows: [[{ value: "Mark", bold: true }, { value: "Width", bold: true }, { value: "Height", bold: true }], [], [{ value: "Doors" }]],
  });
  ok("a worksheet is made in a drawing with none", rowsOf(s, index).length === 3);

  const spec = {
    criteria: "=DATABASE(((R IN ['Door']) & ('Door'.'OnSched'=TRUE)))",
    columns: [{ text: "='Door'.'IDLabel'", sort: "ascending" as const, precedence: 1 }, { text: "=('Door'.'Width')", format: 5, accuracy: 0 }, { text: "='Door'.'Height'", format: 5, accuracy: 0 }],
  };
  ok("the database row's definition is accepted", s.doc.databaseRowProblem(index, 1, spec) === null, String(s.doc.databaseRowProblem(index, 1, spec)));
  s.setDatabaseRow(index, 1, spec);
  let rows = rowsOf(s, index);
  ok("the schedule lists the doors on schedule, sorted by mark", rows.length === 4 && rows[1][0] === "D1" && rows[2][0] === "D3", JSON.stringify(rows));
  ok("their widths show", rows[1][1] === "900" && rows[2][1] === "800", JSON.stringify(rows));
  const live = s.doc.worksheetLive(index)!;
  ok("the row reads back as text", live.database.length === 1 && live.database[0].criteria === spec.criteria && live.database[0].columns[1]?.text === "=('Door'.'Width')", JSON.stringify(live.database[0]));
  ok("every column is worked out", live.database[0].note === null && live.database[0].columns.every((c) => c?.note === null), JSON.stringify(live.database[0].columns.map((c) => c?.note)));

  // a plain cell counts them: saved as a Vectorworks formula
  const counted = s.setWorksheetFormula(index, 2, 1, "=COUNT((R IN ['Door']))");
  ok("=COUNT(criteria) is saved as a formula", counted.kept === false && rowsOf(s, index)[3][1] === "3", JSON.stringify(rowsOf(s, index)[3]));
  // arithmetic on a cell: Rodeo keeps it, the file holds its value
  const kept = s.setWorksheetFormula(index, 2, 2, "=B3*2+1");
  ok("=B3*2+1 is kept by Rodeo and saved as its value", kept.kept === true && rowsOf(s, index)[3][2] === "7", JSON.stringify(rowsOf(s, index)[3]));
  const keptMap = new Map([[index, new Map([["2,2", "=B3*2+1"]])]]);

  // the drawing changes: a width, then a door put on the schedule
  const format = s.doc.records(doors[1]).find((r) => r.name === "Door")!.format;
  s.setRecordField(doors[1], format, "Width", 1010);
  ok("nothing shows the new width before recalculation", rowsOf(s, index)[1][1] === "900");
  ok("recalculation changes the worksheet", s.recalculateWorksheets(keptMap) === 1);
  ok("the schedule shows the new width", rowsOf(s, index)[1][1] === "1010", JSON.stringify(rowsOf(s, index)[1]));
  ok("recalculating again changes nothing", s.recalculateWorksheets(keptMap) === 0);
  s.setRecordField(doors[2], format, "OnSched", true);
  s.recalculateWorksheets(keptMap);
  rows = rowsOf(s, index);
  ok("a door put on the schedule gets its line, in order", rows.length === 5 && rows[1][0] === "D1" && rows[2][0] === "D2" && rows[3][0] === "D3", JSON.stringify(rows));
  const fourth = s.addPluginObject(layer.id, "Door", DOOR, { IDLabel: "D0" }, { x: 5000, y: 0 }, 0);
  s.recalculateWorksheets(keptMap);
  rows = rowsOf(s, index);
  ok("a new door is listed and counted, and the kept formula follows", rows.length === 6 && rows[1][0] === "D0" && rows[5][1] === "4" && rows[5][2] === "9", JSON.stringify(rows));
  s.deleteObjects([fourth]);
  s.recalculateWorksheets(keptMap);
  ok("a deleted door leaves the schedule", rowsOf(s, index).length === 5 && rowsOf(s, index)[4][1] === "3");

  // rows and columns
  s.insertWorksheetRows(index, 0, 1);
  rows = rowsOf(s, index);
  ok("a row added above moves everything down", rows.length === 6 && rows[1][0] === "Mark" && rows[2][0] === "D1", JSON.stringify(rows));
  s.deleteWorksheetRows(index, 0, 1);
  s.insertWorksheetColumns(index, 1, 1);
  rows = rowsOf(s, index);
  ok("a column added keeps the lines' values in their columns", rows[1][0] === "D1" && rows[1][1] === "" && rows[1][2] === "1010", JSON.stringify(rows[1]));
  s.deleteWorksheetColumns(index, 1, 1);
  rows = rowsOf(s, index);
  ok("and deleting it puts them back", rows[1][0] === "D1" && rows[1][1] === "1010", JSON.stringify(rows[1]));

  // on a layer
  const placed = s.placeWorksheet(index, layer.id, { x: 0, y: 300 });
  ok("the worksheet is placed on a layer", s.doc.object(placed)?.worksheet === index);

  // a save and reopen keeps it all, and it still recalculates
  const reopened = openVwx(s.doc.toBytes(), "saved.vwx");
  const again = [...reopened.doc.resources()].find((r) => r.kind === "worksheet")!;
  ok("saved and reopened, the schedule reads the same", JSON.stringify(reopened.doc.worksheetRows(again.index)) === JSON.stringify(rowsOf(s, index)));
  ok("and recalculating it changes nothing", reopened.recalculateWorksheets() === 0);
  const live2 = reopened.doc.worksheetLive(again.index)!;
  ok("its formulas read back", live2.formulas.some((f) => f.text === "=COUNT((R IN ['Door']))") && live2.database[0]?.criteria === spec.criteria, JSON.stringify(live2.formulas));

  // refusals
  ok("a formula that isn't one is refused", "error" in s.doc.checkWorksheetFormula("=NOSUCH(1)", 2, 0));
  ok("a record field in a plain cell is refused", "error" in s.doc.checkWorksheetFormula("='Door'.'Width'", 2, 0));
  const plus = s.doc.checkWorksheetFormula("=B3+1", 2, 0);
  ok("a formula Rodeo keeps says why", "why" in plus && plus.why !== null, JSON.stringify(plus));
  ok("criteria Vectorworks' tokens aren't known for are refused", s.doc.databaseRowProblem(index, 1, { ...spec, criteria: "=DATABASE((T=WALL))" }) !== null);

  // undo takes it all back
  while (s.canUndo()) s.undo();
  ok("undo leaves no worksheet", s.doc.resources().filter((r) => r.kind === "worksheet").length === 0);
}

/** The public demo and sample files: given, or found by listing (never named here). */
function files(): string[] {
  const given = process.argv.slice(2);
  if (given.length) return given;
  const out: string[] = [];
  if (existsSync("../samples/sample.vwx")) out.push("../samples/sample.vwx");
  const demos = "../samples/demos";
  if (existsSync(demos)) {
    for (const year of readdirSync(demos).sort()) {
      const dir = join(demos, year);
      if (!statSync(dir).isDirectory()) continue;
      for (const f of readdirSync(dir).sort()) if (f.toLowerCase().endsWith(".vwx")) out.push(join(dir, f));
    }
  }
  return out;
}

function onFile(path: string, n: number): void {
  const s = openVwx(new Uint8Array(readFileSync(path)), "drawing.vwx");
  const sheets = s.doc.resources().filter((r) => r.kind === "worksheet");
  if (!s.doc.hasLiveWorksheets()) {
    console.log(`file ${n}: ${sheets.length} worksheets, none with formulas or database rows`);
    return;
  }
  const before = new Map(sheets.map((w) => [w.index, JSON.stringify(s.doc.worksheetRows(w.index))]));
  // the plain cells' formulas Rodeo works out, with the numbers the file holds for them
  const plain = sheets.flatMap((w) =>
    (s.doc.worksheetLive(w.index)?.formulas ?? [])
      .filter((f) => f.note === null && !f.kept)
      .map((f) => ({ sheet: w.index, row: f.row, col: f.col, was: s.doc.worksheetContents(w.index)?.cells.find((c) => c.row === f.row && c.col === f.col)?.value ?? null })),
  );
  const t0 = Date.now();
  const changed = s.recalculateWorksheets();
  const ms = Date.now() - t0;
  const same = plain.filter((f) => {
    const now = s.doc.worksheetContents(f.sheet)?.cells.find((c) => c.row === f.row && c.col === f.col)?.value ?? null;
    return now === f.was || (typeof now === "number" && typeof f.was === "number" && Math.abs(now - f.was) <= 1e-9 * Math.max(1, Math.abs(now)));
  }).length;
  if (plain.length) console.log(`file ${n}: plain formula cells worked out: ${plain.length}; equal to the number the file holds: ${same}`);
  const differ = sheets.filter((w) => before.get(w.index) !== JSON.stringify(s.doc.worksheetRows(w.index))).length;
  // a worksheet that changes on an untouched drawing held values that no longer agree with the drawing: its
  // cells are compared one by one in formula/databaseCorpus.check.ts, which says which are stale
  console.log(`file ${n}: ${sheets.length} worksheets; recalculating the untouched drawing changed ${changed} (${differ} in what they show) in ${ms} ms`);
  ok(`file ${n}: recalculating again changes nothing`, s.recalculateWorksheets() === 0);

  // a door's width
  // a door that is on the schedule
  const door = s.doc
    .layers()
    .flatMap((l) => s.doc.objects(l.id))
    .find((o) => s.doc.records(o.id).some((r) => r.parametric && r.name === "Door" && r.fields.some((f) => f.name === "OnSched" && f.value === true)));
  const schedule = sheets.find((w) => s.doc.worksheetLive(w.index)?.database.some((d) => d.criteria.includes("['Door']") && d.columns.some((c) => c?.text.includes("'Width'") || c?.text.includes(".Width"))));
  if (!door || !schedule) return;
  const rec = s.doc.records(door.id).find((r) => r.parametric && r.name === "Door")!;
  const width = rec.fields.find((f) => f.name === "Width")?.value;
  if (typeof width !== "number") return;
  const was = JSON.stringify(s.doc.worksheetRows(schedule.index));
  s.setRecordField(door.id, rec.format, "Width", width + 304.8);
  s.recalculateWorksheets();
  const a = JSON.parse(was) as string[][];
  const b = s.doc.worksheetRows(schedule.index) ?? [];
  let cells = 0;
  for (let r = 0; r < Math.max(a.length, b.length); r++) for (let c = 0; c < Math.max(a[r]?.length ?? 0, b[r]?.length ?? 0); c++) if (a[r]?.[c] !== b[r]?.[c]) cells++;
  ok(`file ${n}: a door a foot wider changes one cell of the door schedule`, cells === 1 && a.length === b.length, `${cells} cells differ`);
  s.undo();
}

synthetic();
files().forEach((f, i) => onFile(f, i + 1));
console.log(failed ? `${failed} FAILED` : "all live worksheet checks ok");
process.exit(failed ? 1 : 0);
