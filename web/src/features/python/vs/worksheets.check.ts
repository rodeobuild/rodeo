// Node check of the worksheet calls (worksheets.ts): each call once, with its step, its read-back value
// or its refusal, plus the formula cases and Vectorscript calls with VAR parameters.
// Run from web/: npx tsx src/features/python/vs/worksheets.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, LAYER, ranVs, runVs, type Snapshot, type SnapObject, type VsOutcome } from "../vsCheck.ts";

const J = "import json\n";

/** The steps of a kind, in order. */
function stepsOf(r: VsOutcome, kind: string): unknown[][] {
  return r.ops.filter((o) => o[0] === kind) as unknown[][];
}

/** What the script printed, one JSON value per line. */
function readBack(r: VsOutcome): unknown[] {
  return r.printed.trim().split("\n").map((line) => JSON.parse(line) as unknown);
}

/** A drawing with the given worksheets (as the snapshot lists them) and resource names. */
function drawing(worksheets: unknown[], names: string[] = []): Snapshot {
  return { ...blankSnapshot(), worksheets, wsNames: names };
}

/** A worksheet of the drawing: 3 rows by 3 columns, its row 3 a database row, a text, a number and a formula result. */
const OLD = {
  index: 7,
  name: "Old",
  rows: 3,
  cols: 3,
  database: [false, false, true],
  limit: null,
  cells: [
    { row: 0, col: 0, kind: "text", text: "Name", value: null },
    { row: 0, col: 1, kind: "number", text: "4", value: 4 },
    { row: 1, col: 1, kind: "formula", text: "8", value: 8 },
  ],
};

// ---- a blank drawing has no worksheet to copy settings from ---------------------------------------
{
  const r = runVs(`${J}import vs
vs.CreateWS("Test Schedule", 5, 4)
`);
  assert.ok(r.error, "CreateWS in a blank drawing fails");
  assert.match(r.error?.message ?? "", /no worksheet to copy settings from/, "the refusal names the limit");
  assert.equal(r.ops.length, 0, "nothing is recorded for a refused run");
}

// ---- a worksheet made in the run: the schedule ----------------------------------------------------
{
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Test Schedule", 5, 4)
print(json.dumps(vs.GetWSRowColumnCount(ws)))
for c, t in enumerate(["Name", "Qty", "Price", "Total"]):
    vs.SetWSCellFormula(ws, 1, c + 1, 1, c + 1, t)
vs.SetWSCellFormula(ws, 2, 1, 2, 1, "Bolt")
vs.SetWSCellFormula(ws, 2, 2, 2, 2, "3")
vs.SetWSCellFormula(ws, 2, 3, 2, 3, "2.5")
vs.SetWSCellFormula(ws, 3, 2, 3, 2, "4")
vs.SetWSCellFormula(ws, 3, 3, 3, 3, "1")
vs.SetWSCellFormula(ws, 4, 2, 4, 2, "1")
vs.SetWSCellFormula(ws, 4, 3, 4, 3, "10")
vs.SetWSCellFormula(ws, 2, 4, 4, 4, "=B2*C2")
vs.SetWSCellFormula(ws, 5, 4, 5, 4, "=SUM(D2:D4)")
vs.SetWSCellFormula(ws, 5, 1, 5, 1, '=COUNT(D2:D4,"<5")')
vs.SetWSCellFormula(ws, 5, 3, 5, 3, "=AREA(B2)")
vs.SetWSColumnWidth(ws, 1, 1, 120)
vs.SetWSRowHeight(ws, 1, 5, 18, True, False)
vs.InsertWSRows(ws, 2, 1)
print(json.dumps(vs.GetWSRowColumnCount(ws)))
print(json.dumps(vs.GetWSCellValue(ws, 3, 4)))
print(json.dumps(vs.GetWSCellFormula(ws, 3, 4)))
print(json.dumps(vs.GetWSCellValue(ws, 6, 4)))
print(json.dumps(vs.GetWSCellString(ws, 6, 4)))
print(json.dumps(vs.IsWSCellNumber(ws, 6, 4)))
print(json.dumps(vs.IsWSCellString(ws, 3, 1)))
print(json.dumps(vs.GetWSCellString(ws, 3, 1)))
print(json.dumps(vs.GetWSColumnWidth(ws, 1)))
print(json.dumps(vs.GetWSRowHeight(ws, 2)))
vs.SetWSCellNumberFormat(ws, 2, 4, 6, 4, 2, 2, "", "")
print(json.dumps(vs.GetWSCellString(ws, 3, 4)))
print(json.dumps(vs.GetWSCellNumberFormat(ws, 3, 4)))
vs.SetWSCellAlignment(ws, 1, 1, 1, 4, 2)
print(json.dumps(vs.GetWSCellAlignment(ws, 1, 1)))
vs.SetWSCellTextFormat(ws, 1, 1, 1, 4, 3, 12, 1)
print(json.dumps(vs.GetWSCellTextFormat(ws, 1, 1)))
vs.SetWSCellFill(ws, 1, 1, 1, 4, 1, 2, 3, 4)
print(json.dumps(vs.GetWSCellFill(ws, 1, 1)))
vs.SetWSCellTextColor(ws, 1, 1, 1, 4, 5)
print(json.dumps(vs.GetWSCellTextColor(ws, 1, 1)))
vs.SetWSCellWrapTextFlag(ws, 1, 1, 1, 4, True)
print(json.dumps(vs.GetWSCellWrapTextFlag(ws, 1, 1)))
vs.SetWSCellVertAlignment(ws, 1, 1, 1, 4, 2)
print(json.dumps(vs.GetWSCellVertAlignment(ws, 1, 1)))
vs.SetWSTextAngle(ws, 1, 1, 1, 1, 45)
print(json.dumps(vs.GetWSCellTextAngle(ws, 1, 1)))
vs.SetWSCellBorder(ws, 1, 1, 1, 4, True, True, True, True, False)
vs.WorksheetMergeCells(ws, 5, 1, 5, 2)
vs.AutoFitWSRowHeights(ws, 1, 6)
vs.SetWSCurrentCell(ws, 1, 1)
vs.SetTopVisibleWS(ws)
print(json.dumps(vs.IsValidWSCell(ws, 6, 4)))
print(json.dumps(vs.IsValidWSRange(ws, 1, 1, 6, 4)))
print(json.dumps(vs.IsWSDatabaseRow(ws, 2)))
vs.DeleteWSRows(ws, 2, 1)
vs.InsertWSColumns(ws, 2, 1)
vs.DeleteWSColumns(ws, 2, 1)
print(json.dumps(vs.GetWSRowColumnCount(ws)))
vs.ClearWSCell(ws, 4, 4, 4, 4)
print(json.dumps(vs.GetWSCellString(ws, 4, 4)))
vs.RecalculateWS(ws)
print(json.dumps(vs.GetWSAutoRecalcState(ws)))
vs.ShowWS(ws, True)
print(json.dumps(vs.IsWSVisible(ws)))
`, { snapshot: drawing([OLD]) });
  const out = readBack(r);
  assert.deepEqual(out[0], [5, 4], "GetWSRowColumnCount of the new worksheet");
  assert.deepEqual(out[1], [6, 4], "GetWSRowColumnCount after InsertWSRows");
  assert.equal(out[2], 7.5, "a formula's value follows its cells when a row is inserted above");
  assert.equal(out[3], "=B3*C3", "the formula's references move with the row inserted above");
  assert.equal(out[4], 21.5, "SUM over the moved range");
  assert.equal(out[5], "21.5", "its displayed string");
  assert.equal(out[6], true, "IsWSCellNumber on a formula number");
  assert.equal(out[7], true, "IsWSCellString on a text cell");
  assert.equal(out[8], "Bolt", "GetWSCellString of text");
  assert.equal(out[9], 120, "GetWSColumnWidth after SetWSColumnWidth");
  assert.equal(out[10], 18, "the inserted row takes the height of the row above");
  assert.equal(out[11], "7.50", "a fixed-decimal format shows two places");
  assert.deepEqual(out[12], [2, 2, "", ""], "GetWSCellNumberFormat");
  assert.equal(out[13], 2, "GetWSCellAlignment after SetWSCellAlignment (centre is 2)");
  assert.deepEqual(out[14], [3, 12, 1], "GetWSCellTextFormat: font, size and style");
  assert.deepEqual(out[15], [1, 2, 3, 4], "GetWSCellFill");
  assert.equal(out[16], 5, "GetWSCellTextColor");
  assert.equal(out[17], true, "GetWSCellWrapTextFlag");
  assert.equal(out[18], 2, "GetWSCellVertAlignment");
  assert.equal(out[19], 45, "GetWSCellTextAngle");
  assert.equal(out[20], true, "IsValidWSCell inside the sheet");
  assert.equal(out[21], true, "IsValidWSRange inside the sheet");
  assert.equal(out[22], false, "IsWSDatabaseRow of a plain row");
  assert.deepEqual(out[23], [5, 4], "GetWSRowColumnCount after DeleteWSRows, InsertWSColumns and DeleteWSColumns");
  assert.equal(out[24], "", "ClearWSCell empties the cell");
  assert.equal(out[25], true, "GetWSAutoRecalcState default");
  assert.equal(out[26], true, "IsWSVisible after ShowWS");

  // the one step the run ends with: the new worksheet, its cells, widths and row height
  const made = stepsOf(r, "wsnew");
  assert.equal(made.length, 1, "one new worksheet is stored");
  const [, , name, widths, height, grid] = made[0] as [string, string, string, number[], number, { value?: unknown; bold?: boolean; align?: string; format?: number; accuracy?: number }[][]];
  assert.equal(name, "Test Schedule");
  assert.deepEqual(widths, [120, 72, 72, 72], "column widths: the one set, the rest the default");
  assert.equal(height, 18, "one row height for all rows is stored");
  assert.equal(grid.length, 5, "the grid has the rows left after the edits");
  assert.deepEqual(grid[0][0], { value: "Name", align: "center", bold: true }, "header cell: text, centred, bold");
  assert.equal(grid[1][0]?.value, "Bolt", "a text cell");
  assert.equal(grid[1][1]?.value, 3, "a number cell");
  assert.equal(grid[1][3]?.value, 7.5, "a formula cell is stored as its result");
  assert.deepEqual(
    { format: grid[1][3]?.format, accuracy: grid[1][3]?.accuracy },
    { format: 2, accuracy: 2 },
    "its number format is stored",
  );
  assert.equal(grid[2][3]?.value, 4, "the next formula's result");
  assert.equal(grid[4][0]?.value, '=COUNT(D2:D4,"<5")', "a formula Rodeo can't work out is stored as its text");
  assert.equal(grid[4][2]?.value, "=AREA(B2)", "AREA is stored as its text too");
  // D4 (the 10) was cleared by the script before the run ends, so the SUM covers D2 and D3 only
  assert.equal(grid[4][3]?.value, 11.5, "SUM is stored as its result");
  assert.equal(grid[3][3], null, "the cleared cell (no format left) is stored as an empty cell");
  const unev = r.wsUnevaluated as { cell: string; formula: string }[];
  assert.deepEqual(
    unev.map((u) => u.formula),
    ['=COUNT(D2:D4,"<5")', "=AREA(B2)"],
    "the run reports the two formulas it can't work out",
  );
  const kept = r.wsKept as string[];
  assert.ok(kept.includes("SetWSCellFill"), "a fill is kept for the run only");
  assert.ok(kept.includes("SetWSCellBorder"), "a border is kept for the run only");
  assert.ok(!kept.includes("SetWSRowHeight (rows of different heights)"), "the rows keep one height");
  assert.equal(stepsOf(r, "wsshow").length, 1, "ShowWS records the sheet to open");
}

// ---- the calls the schedule doesn't use: sizes, formats kept, the Sprd cell calls, borders -------
{
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Rest", 4, 3)
vs.SetWSCellFormulaN(ws, 1, 1, 1, 1, "7")
print(json.dumps(vs.GetWSCellFormulaN(ws, 1, 1)))
print(json.dumps(vs.GetWSCellStringN(ws, 1, 1)))
print(json.dumps(vs.GetWSRowHLockState(ws, 2)))
vs.SetWSRowHeight(ws, 2, 2, 20, False, True)
print(json.dumps(vs.GetWSRowHLockState(ws, 2)))
vs.SetWSCellBorders(ws, 1, 1, 1, 1, True, True, True, True, False)
vs.SetWSCellBottomBN(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellBottomBorder(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellInsideHorizBorder(ws, 1, 1, 2, 3, 1, 1, 0)
vs.SetWSCellInsideHzBN(ws, 1, 1, 2, 3, 1, 1, 0)
vs.SetWSCellInsideVertBorder(ws, 1, 1, 2, 3, 1, 1, 0)
vs.SetWSCellInsideVtBN(ws, 1, 1, 2, 3, 1, 1, 0)
vs.SetWSCellLeftBN(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellLeftBorder(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellOutlineBN(ws, 1, 1, 2, 2, 1, 1, 0)
vs.SetWSCellOutlineBorder(ws, 1, 1, 2, 2, 1, 1, 0)
vs.SetWSCellRightBN(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellRightBorder(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellTopBN(ws, 1, 1, 1, 1, 1, 1, 0)
vs.SetWSCellTopBorder(ws, 1, 1, 1, 1, 1, 1, 0)
vs.WorksheetMergeCells(ws, 3, 1, 3, 2)
vs.WorksheetSplitCells(ws, 3, 1, 3, 2)
print(json.dumps(vs.AreWorksheetGridLinesVisible(ws)))
vs.SetWorksheetGridLinesVisibility(ws, False)
print(json.dumps(vs.AreWorksheetGridLinesVisible(ws)))
print(json.dumps(vs.GetWSAutoRecalcState(ws)))
vs.SetWSAutoRecalcState(ws, False)
print(json.dumps(vs.GetWSAutoRecalcState(ws)))
vs.EnableDrawingWorksheetPalette(True, ws)
vs.SelectSS(ws)
vs.CloseSS(ws)
vs.TargetSprdSheet(ws)
print(json.dumps(vs.ActSSheet() is not None))
vs.LoadCell(2, 1, "5")
vs.LoadCell(2, 2, "text")
print(json.dumps([vs.CellValue(2, 1), vs.CellString(2, 2), vs.CellHasNum(ws, 2, 1), vs.CellHasStr(ws, 2, 2)]))
print(json.dumps([vs.GetCellNum(ws, 2, 1), vs.GetCellStr(ws, 2, 2)]))
print(json.dumps([vs.GetCWidth(ws, 1, 2), vs.GetCAlign(ws, 2, 1)]))
vs.SetWSColumnWidth(ws, 2, 2, 100)
print(json.dumps(vs.GetCWidth(ws, 1, 2)))
vs.SetWSCellAlignment(ws, 2, 1, 2, 1, 3)
print(json.dumps(vs.GetCAlign(ws, 2, 1)))
print(json.dumps(vs.GetTopVisibleWS() is None))
vs.SetTopVisibleWS(ws)
print(json.dumps(vs.GetTopVisibleWS() is not None))
`, { snapshot: drawing([OLD]) });
  const out = readBack(r);
  assert.equal(out[0], "7", "GetWSCellFormulaN returns the formula text");
  assert.equal(out[1], "7", "GetWSCellStringN");
  assert.equal(out[2], false, "GetWSRowHLockState of an unlocked row");
  assert.equal(out[3], true, "GetWSRowHLockState after SetWSRowHeight with the lock");
  assert.equal(out[4], false, "AreWorksheetGridLinesVisible by default");
  assert.equal(out[5], false, "AreWorksheetGridLinesVisible after SetWorksheetGridLinesVisibility(FALSE)");
  assert.equal(out[6], true, "GetWSAutoRecalcState by default");
  assert.equal(out[7], false, "GetWSAutoRecalcState after SetWSAutoRecalcState(FALSE)");
  assert.equal(out[8], true, "ActSSheet after TargetSprdSheet");
  assert.deepEqual(out[9], [5, "text", true, true], "CellValue, CellString, CellHasNum and CellHasStr on the target sheet");
  assert.deepEqual(out[10], [5, "text"], "GetCellNum and GetCellStr");
  assert.deepEqual(out[11], [72, 1], "GetCWidth (default) and GetCAlign (General is 1)");
  assert.equal(out[12], 100, "GetCWidth after SetWSColumnWidth");
  assert.equal(out[13], 3, "GetCAlign after SetWSCellAlignment to right");
  assert.equal(out[14], true, "GetTopVisibleWS is None before SetTopVisibleWS");
  assert.equal(out[15], true, "GetTopVisibleWS after SetTopVisibleWS");
  const kept = r.wsKept as string[];
  for (const name of ["SetWSCellBorders", "SetWSCellRightBorder", "WorksheetMergeCells", "WorksheetSplitCells", "SetWorksheetGridLinesVisibility", "SetWSAutoRecalcState"]) {
    assert.ok(kept.includes(name), `${name} is kept for the run only`);
  }
  assert.equal(stepsOf(r, "wsset").length, 0, "a new sheet keeps its cells in its wsnew step, so no wsset steps");
}

// ---- formulas: what Rodeo works out -----------------------------------------------------------
{
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Calc", 24, 4)
vs.SetWSCellFormula(ws, 1, 1, 1, 1, "1")
vs.SetWSCellFormula(ws, 2, 1, 2, 1, "2")
vs.SetWSCellFormula(ws, 3, 1, 3, 1, "3")
cases = [
  "=1+2*3", "=(1+2)*3", "=2^3", "=-2^2", "=10/4", "=1/0",
  '="a"&"b"', "=ROUND(2.5,0)", "=ROUND(-2.5,0)", "=MIN(A1:A3)", "=MAX(A1:A3)",
  "=AVERAGE(A1:A3)", "=COUNT(A1:A3)", '=IF(1<2,"yes","no")', "=TRUE", "=CONCAT(1,2)",
  "=5<>5", "=2>=2", "=SUM(\\"x\\")", "=A4", "=SUM(A1:A3,10)", "=COUNT(A1:A3,\\"x\\")",
]
for i, f in enumerate(cases):
    vs.SetWSCellFormula(ws, i + 1, 2, i + 1, 2, f)
for i in range(len(cases)):
    print(json.dumps([vs.GetWSCellString(ws, i + 1, 2), vs.IsWSCellNumber(ws, i + 1, 2), vs.GetWSCellValue(ws, i + 1, 2)]))
vs.SetWSCellFormula(ws, 4, 3, 4, 3, "=C4")
print(json.dumps(vs.GetWSCellString(ws, 4, 3)))
`, { snapshot: drawing([OLD]) });
  const out = readBack(r) as [string, boolean, number][];
  const expect: [string, boolean, number][] = [
    ["7", true, 7], ["9", true, 9], ["8", true, 8], ["4", true, 4], ["2.5", true, 2.5], ["#DIV/0!", false, 0],
    ["ab", false, 0], ["3", true, 3], ["-3", true, -3], ["1", true, 1], ["3", true, 3],
    ["2", true, 2], ["3", true, 3], ["yes", false, 0], ["TRUE", false, 0], ["12", false, 0],
    ["FALSE", false, 0], ["TRUE", false, 0], ["#VALUE!", false, 0], ["0", true, 0], ["16", true, 16],
    ['=COUNT(A1:A3,"x")', false, 0],
  ];
  expect.forEach((e, i) => assert.deepEqual(out[i], e, `formula case ${i + 1}`));
  assert.equal(readBack(r)[22], "#CYCLE!", "a cell that names itself in the range reports #CYCLE! at once");
}

// ---- a worksheet already in the drawing ----------------------------------------------------------
{
  const r = ranVs(`${J}import vs
h = vs.GetObject("Old")
print(json.dumps(vs.GetWSRowColumnCount(h)))
print(json.dumps(vs.GetWSCellValue(h, 1, 2)))
print(json.dumps(vs.GetWSCellString(h, 1, 2)))
print(json.dumps(vs.GetWSCellString(h, 1, 1)))
print(json.dumps(vs.GetWSCellValue(h, 2, 2)))
print(json.dumps(vs.IsWSDatabaseRow(h, 3)))
vs.SetWSCellFormula(h, 2, 1, 2, 1, "=B1*2")
print(json.dumps(vs.GetWSCellValue(h, 2, 1)))
vs.ClearWSCell(h, 1, 2, 1, 2)
print(json.dumps(vs.IsWSCellNumber(h, 1, 2)))
vs.SetWSColumnWidth(h, 1, 1, 90)
vs.SetWSCellAlignment(h, 1, 1, 1, 1, 1)
vs.ShowWS(h, True)
`, { snapshot: drawing([OLD]) });
  const out = readBack(r);
  assert.deepEqual(out[0], [3, 3], "rows and columns of the drawing's worksheet");
  assert.equal(out[1], 4, "a number cell reads its value");
  assert.equal(out[2], "4", "its string");
  assert.equal(out[3], "Name", "a text cell");
  assert.equal(out[4], 8, "a formula cell of the drawing reads its cached result");
  assert.equal(out[5], true, "IsWSDatabaseRow of the database row");
  assert.equal(out[6], 8, "a formula set on the drawing's worksheet answers at once");
  assert.equal(out[7], false, "a cleared cell is empty");
  const sets = stepsOf(r, "wsset");
  assert.deepEqual(sets[0], ["wsset", "ws:7", 1, 0, 8], "the formula's value is written to the drawing's cell");
  assert.deepEqual(sets[1], ["wsset", "ws:7", 0, 1, ""], "ClearWSCell writes an empty value");
  assert.equal(stepsOf(r, "wsshow").length, 1, "ShowWS of a drawing worksheet opens it");
  assert.equal(stepsOf(r, "wsshow")[0]?.[1], "ws:7");
  assert.ok((r.wsKept as string[]).includes("SetWSColumnWidth"), "a column width of the drawing's worksheet is kept for the run only");
  assert.equal(stepsOf(r, "wsnew").length, 0, "no new worksheet is made");
}

{
  // the rules for a worksheet already in the drawing: database rows, formula cells, insert and width reads
  const r = runVs(`${J}import vs
h = vs.GetObject("Old")
vs.SetWSCellFormula(h, 3, 1, 3, 1, "5")
`, { snapshot: drawing([OLD]) });
  assert.match(r.error?.message ?? "", /database row/, "a database row can't be edited");
  const r2 = runVs(`${J}import vs
h = vs.GetObject("Old")
vs.SetWSCellFormula(h, 2, 2, 2, 2, "5")
`, { snapshot: drawing([OLD]) });
  assert.match(r2.error?.message ?? "", /holds a formula/, "a formula cell of the drawing can't be changed");
  const r3 = runVs(`${J}import vs
h = vs.GetObject("Old")
vs.InsertWSRows(h, 1, 1)
`, { snapshot: drawing([OLD]) });
  assert.match(r3.error?.message ?? "", /can't be inserted or deleted/, "rows can't be inserted in the drawing's worksheet yet");
  const r4 = runVs(`${J}import vs
h = vs.GetObject("Old")
print(json.dumps(vs.GetWSColumnWidth(h, 1)))
`, { snapshot: drawing([OLD]) });
  assert.match(r4.error?.message ?? "", /can't be read yet/, "a column width of the drawing can't be read yet");
  const r5 = runVs(`${J}import vs
h = vs.GetObject("Old")
print(json.dumps(vs.GetWSCellFormula(h, 2, 2)))
`, { snapshot: drawing([OLD]) });
  assert.match(r5.error?.message ?? "", /can't be read yet/, "the formula of a drawing formula cell can't be read yet");
}

// ---- a worksheet longer than the script's sample ---------------------------------------------------
{
  const big = {
    index: 9, name: "Big", rows: 100, cols: 100, database: [], limit: 5000,
    cells: [{ row: 0, col: 0, kind: "number", text: "2", value: 2 }],
  };
  const r = ranVs(`${J}import vs
h = vs.GetObject("Big")
print(json.dumps(vs.GetWSCellValue(h, 1, 1)))
vs.SetWSCellFormula(h, 1, 2, 1, 2, "=A1*4")
print(json.dumps(vs.GetWSCellValue(h, 1, 2)))
`, { snapshot: drawing([big]) });
  assert.deepEqual(readBack(r), [2, 8], "the sent cells read, and a formula over them works out");
  const r2 = runVs(`${J}import vs
h = vs.GetObject("Big")
print(json.dumps(vs.GetWSCellValue(h, 100, 100)))
`, { snapshot: drawing([big]) });
  assert.match(r2.error?.message ?? "", /more cells/, "a cell past the sent cells is refused");
}

// ---- the Sprd cell calls, on the target worksheet -------------------------------------------------
{
  const r = ranVs(`${J}import vs
h = vs.GetObject("Old")
vs.TargetSprdSheet(h)
print(json.dumps(vs.CellValue(1, 2)))
print(json.dumps(vs.CellString(1, 1)))
print(json.dumps(vs.CellHasNum(h, 1, 2)))
print(json.dumps(vs.CellHasStr(h, 1, 1)))
vs.LoadCell(1, 3, "=B1+1")
print(json.dumps(vs.CellValue(1, 3)))
`, { snapshot: drawing([OLD]) });
  assert.deepEqual(readBack(r), [4, "Name", true, true, 5], "the target worksheet's cells read back");
}

// ---- Vectorscript: VAR parameters come back as values --------------------------------------------
{
  const r = ranVs(`PROCEDURE Test;
VAR ws : HANDLE; rows, cols : INTEGER; v : REAL; s : STRING;
BEGIN
  ws := CreateWS('VS Sheet', 3, 2);
  GetWSRowColumnCount(ws, rows, cols);
  SetWSCellFormula(ws, 1, 1, 1, 1, '5');
  SetWSCellFormula(ws, 1, 2, 1, 2, '=A1*3');
  GetWSCellValue(ws, 1, 2, v);
  GetWSCellString(ws, 1, 2, s);
  Message(rows);
  Message(cols);
  Message(s);
END;
RUN(Test);`, { file: "test.vs", snapshot: drawing([OLD]) });
  assert.deepEqual(r.messages, ["3", "2", "15"], "Vectorscript VAR results: GetWSRowColumnCount and GetWSCellString");
  assert.equal(stepsOf(r, "wsnew").length, 1, "the Vectorscript run makes one worksheet");
}

{
  const r = ranVs(`PROCEDURE Test;
VAR ws : HANDLE; v : REAL; ok : BOOLEAN;
BEGIN
  ws := CreateWS('VS Check', 2, 2);
  SetWSCellFormula(ws, 1, 1, 1, 1, '7');
  GetWSCellValue(ws, 1, 1, v);
  ok := IsWSCellNumber(ws, 1, 1);
  Message(v);
END;
RUN(Test);`, { file: "test.vs", snapshot: drawing([OLD]) });
  assert.deepEqual(r.messages, ["7"], "Vectorscript GetWSCellValue with a VAR REAL");
}

// ---- GetObject, GetName, GetTypeN and GetType on a worksheet; the core answers for everything else -------
{
  const beta: SnapObject = { id: "obj-beta", type: 4, typeName: "rectangle", layer: LAYER, parent: null, cls: "None", name: "Beta", bbox: null, attrs: {}, sym: null, ins: null, turned: 0, records: {}, shape: null };
  const snap: Snapshot = { ...drawing([OLD]), objects: [beta] };
  const r = ranVs(`${J}import vs
ws = vs.GetObject("Old")
print(json.dumps([vs.GetName(ws), vs.GetTypeN(ws), vs.GetType(ws), vs.GetWSCellString(ws, 1, 1)]))
print(json.dumps(vs.GetObject("Nope") is None))
b = vs.GetObject("Beta")
print(json.dumps([vs.GetName(b), vs.GetTypeN(b)]))
`, { snapshot: snap });
  const out = readBack(r);
  assert.deepEqual(out[0], ["Old", 18, 18, "Name"], "GetObject finds a worksheet by name; GetName, GetTypeN and GetType say worksheet (18)");
  assert.equal(out[1], true, "an unknown name is None");
  assert.deepEqual(out[2], ["Beta", 4], "a drawing object named Beta still answers from the core");
}

// ---- borders: set per cell in the run, read back; a drawing's cell not set in the run raises -------------
{
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Borders", 3, 3)
vs.SetWSCellBorder(ws, 1, 1, 2, 2, True, False, True, False, False)
print(json.dumps(vs.GetWSCellBorder(ws, 1, 1)))
print(json.dumps(vs.GetWSCellBorder(ws, 2, 2)))
print(json.dumps(vs.GetWSCellBorder(ws, 1, 3)))
vs.SetWSCellTopBN(ws, 2, 2, 2, 2, 0, 1, 0)
print(json.dumps(vs.GetWSCellBorder(ws, 2, 2)))
vs.SetWSCellInsideVertBorder(ws, 1, 1, 3, 3, 1, 1, 0)
print(json.dumps(vs.GetWSCellBorder(ws, 1, 2)))
print(json.dumps(vs.GetWSCellBorder(ws, 3, 3)))
vs.SetWSCellOutlineBorder(ws, 1, 1, 3, 3, 1, 1, 0)
print(json.dumps(vs.GetWSCellBorder(ws, 2, 2)))
print(json.dumps(vs.GetWSCellBorder(ws, 3, 1)))
`, { snapshot: drawing([OLD]) });
  const out = readBack(r);
  assert.deepEqual(out[0], [true, false, true, false], "SetWSCellBorder flags: top and bottom on, left and right off");
  assert.deepEqual(out[1], [true, false, true, false], "the same flags on the second cell of the range");
  assert.deepEqual(out[2], [false, false, false, false], "a cell outside the range has no border");
  assert.deepEqual(out[3], [false, false, true, false], "SetWSCellTopBN with style 0 takes the top off");
  assert.deepEqual(out[4], [true, true, true, true], "SetWSCellInsideVertBorder puts left and right on the inside cell (1,2)");
  assert.deepEqual(out[5], [false, true, false, false], "(3,3) gets the left side only: it is the last column");
  assert.deepEqual(out[6], [false, true, true, true], "SetWSCellOutlineBorder leaves the inside cell (2,2) alone: its sides from the inside-vertical call stay");
  assert.deepEqual(out[7], [false, true, true, true], "SetWSCellOutlineBorder adds the bottom and left of (3,1), which keeps its right side from the inside-vertical call");
  const kept = r.wsKept as string[];
  for (const name of ["SetWSCellBorder", "SetWSCellTopBN", "SetWSCellInsideVertBorder", "SetWSCellOutlineBorder"]) {
    assert.ok(kept.includes(name), `${name} is kept for the run`);
  }
  assert.equal(stepsOf(r, "wsnew").length, 1, "the bordered sheet is still stored as one new worksheet");
}
{
  const r = runVs(`${J}import vs
ws = vs.GetObject("Old")
print(json.dumps(vs.GetWSCellBorder(ws, 1, 1)))
`, { snapshot: drawing([OLD]) });
  assert.match(r.error?.message ?? "", /can't be read yet/, "a drawing cell with no border set this run raises");
}
{
  const r = ranVs(`${J}import vs
ws = vs.GetObject("Old")
vs.SetWSCellBorder(ws, 1, 1, 1, 1, False, True, False, False, False)
print(json.dumps(vs.GetWSCellBorder(ws, 1, 1)))
`, { snapshot: drawing([OLD]) });
  assert.deepEqual(readBack(r)[0], [false, true, false, false], "a drawing cell the script set this run reads back");
}

// ---- selection and current cell: kept for the run -------------------------------------------------
{
  const r = ranVs(`${J}import vs
ws = vs.CreateWS("Sel", 4, 4)
print(json.dumps(vs.GetWSSelection(ws)))
vs.SetWSCurrentCell(ws, 2, 3)
print(json.dumps(vs.GetWSSelection(ws)))
vs.SetWSSelection(ws, 2, 3, 1, 1, 0, 3, 4, 0)
print(json.dumps(vs.GetWSSelection(ws)))
`, { snapshot: drawing([OLD]) });
  const out = readBack(r);
  assert.deepEqual(out[0], [1, 1, 1, 1, 0, 1, 1, 0], "the default selection is cell 1,1");
  assert.deepEqual(out[1], [2, 3, 2, 3, 0, 2, 3, 0], "SetWSCurrentCell moves the current cell");
  assert.deepEqual(out[2], [2, 3, 1, 1, 0, 3, 4, 0], "SetWSSelection sets the range");
  const kept = r.wsKept as string[];
  assert.ok(kept.includes("SetWSCurrentCell") && kept.includes("SetWSSelection"), "the selection calls are kept for the run");
}
{
  const r = runVs(`${J}import vs
ws = vs.CreateWS("Sel", 4, 4)
vs.SetWSSelection(ws, 1, 1, 1, 1, 1, 1, 1, 0)
`, { snapshot: drawing([OLD]) });
  assert.match(r.error?.message ?? "", /database subrows/, "a selection of subrows raises");
}

// ---- worksheet images: the image object shows its worksheet --------------------------------------
{
  const img: SnapObject = { id: "img-1", type: 56, typeName: "worksheet image", layer: LAYER, parent: null, cls: "None", name: "", bbox: null, attrs: {}, sym: null, ins: null, turned: 0, records: {}, shape: null, worksheet: 7 } as SnapObject;
  const snap: Snapshot = { ...drawing([OLD]), objects: [img] };
  const r = ranVs(`${J}import vs
ws = vs.GetObject("Old")
image = vs.GetWSImage(ws)
print(json.dumps(vs.GetTypeN(image)))
back = vs.GetWSFromImage(image)
print(json.dumps(vs.GetName(back)))
print(json.dumps(vs.GetWSImage(vs.CreateWS("Fresh", 2, 2)) is None))
vs.SetWSImgShowDBHeader(image, True, True)
vs.SetWSImgScale(ws, 1, 1, 1, 1, 1.5)
vs.SetWSPlacement(ws, 1, 1, 2, 2)
`, { snapshot: snap });
  const out = readBack(r);
  assert.equal(out[0], 56, "the image object is a worksheet image (56)");
  assert.equal(out[1], "Old", "GetWSFromImage gives the worksheet the image shows");
  assert.equal(out[2], true, "a worksheet made in the run has no image yet");
  for (const name of ["SetWSImgShowDBHeader", "SetWSImgScale", "SetWSPlacement"]) {
    assert.ok((r.wsKept as string[]).includes(name), `${name} is kept for the run`);
  }
}
{
  const r = runVs(`${J}import vs
vs.GetWSFromImage(vs.GetObject("Old"))
`, { snapshot: drawing([OLD]) });
  assert.match(r.error?.message ?? "", /not a worksheet image/, "GetWSFromImage of a worksheet raises");
}
{
  const r = runVs(`${J}import vs
vs.CreateWSImage(vs.GetObject("Old"), 10, 10)
`, { snapshot: drawing([OLD]) });
  assert.match(r.error?.message ?? "", /CreateWSImage isn't available in Rodeo yet/, "CreateWSImage keeps its honest error: the core can't place an image");
}

// ---- Vectorscript VAR forms of the new calls --------------------------------------------------------
{
  const r = ranVs(`PROCEDURE Test;
VAR ws : HANDLE; top, left, bottom, right : BOOLEAN; r1, c1, r2, c2, sr1, sc1, sr2, sc2 : INTEGER;
BEGIN
  ws := CreateWS('VS Borders', 2, 2);
  SetWSCellBorder(ws, 1, 1, 1, 1, TRUE, FALSE, FALSE, TRUE, FALSE);
  GetWSCellBorder(ws, 1, 1, top, left, bottom, right);
  Message(top);
  Message(right);
  SetWSCurrentCell(ws, 2, 2);
  GetWSSelection(ws, r1, c1, r2, c2, sr1, sc1, sr2, sc2);
  Message(r1);
  Message(c1);
END;
RUN(Test);`, { file: "test.vs", snapshot: drawing([OLD]) });
  assert.deepEqual(r.messages, ["TRUE", "TRUE", "2", "2"], "Vectorscript VAR results of GetWSCellBorder and GetWSSelection");
}

console.log("worksheets: ok");
