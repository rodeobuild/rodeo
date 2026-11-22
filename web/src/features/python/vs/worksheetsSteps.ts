// The steps of the worksheet calls (worksheets.ts), the snapshot a script reads the drawing's
// worksheets from, and what a run does with its worksheet results: the Edit Worksheet window opens on
// the worksheet ShowWS showed last, and the calls a run kept for itself or couldn't work out are logged.

import type { NewSheetCell, NewWorksheet } from "../../../core/types.ts";
import { editWorksheet } from "../../../app/worksheetEditor.ts";
import { registerObjectSnapshot, registerResult, registerSnapshot, registerStep, type StepContext } from "../steps.ts";

/** A worksheet of more cells than this sends a script its first cells only (the rest are not known to it). */
const SENT_CELLS = 5000;

registerSnapshot((s) => {
  const doc = s.doc;
  const resources = doc.resources();
  const worksheets = resources
    .filter((r) => r.kind === "worksheet")
    .flatMap((r) => {
      const c = doc.worksheetContents(r.index);
      if (!c) return [];
      const limit = c.rows * c.cols > SENT_CELLS ? SENT_CELLS : null;
      const cells = [...c.cells]
        .sort((a, b) => a.row - b.row || a.col - b.col)
        .filter((x) => limit === null || x.row * c.cols + x.col < limit)
        .map((x) => ({ row: x.row, col: x.col, kind: x.kind, text: x.display, value: x.value }));
      return [{ index: r.index, name: r.name, rows: c.rows, cols: c.cols, database: c.database, limit, cells }];
    });
  return { worksheets, wsNames: resources.map((r) => r.name) };
});

/** A cell of a worksheet a run makes, as the step carries it (the Python values, with only the keys it sets). */
interface SheetCellIn {
  value: string | number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  format?: number;
  accuracy?: number;
}

function newCell(c: SheetCellIn): NewSheetCell {
  const out: NewSheetCell = { value: c.value };
  if (c.bold !== undefined) out.bold = c.bold;
  if (c.align !== undefined) out.align = c.align;
  if (c.format !== undefined) out.format = c.format;
  if (c.accuracy !== undefined) out.accuracy = c.accuracy;
  return out;
}

/** The drawing's index of a worksheet a step names: "ws:N" is the drawing's own (name index N), anything else one the run made. */
function sheetIndex(key: unknown, ctx: StepContext): number {
  const k = String(key);
  return Number(k.startsWith("ws:") ? k.slice(3) : ctx.real(k));
}

/** The worksheet ShowWS showed last in the run, opened once the run's steps are applied. */
let shown: number | null = null;

// a worksheet image (object type 56) names the worksheet it shows, so GetWSFromImage and GetWSImage can answer
registerObjectSnapshot((o) => (o.type === 56 && o.worksheet !== undefined ? { worksheet: o.worksheet } : null));

registerStep("wsnew", (a, ctx) => {
  const [key, name, widths, height, grid] = a as [string, string, number[], number, (SheetCellIn | null)[][]];
  const sheet: NewWorksheet = {
    name: String(name),
    widths: widths.map(Number),
    rowHeight: Number(height),
    rows: grid.map((row) => row.map((cell) => (cell === null ? null : newCell(cell)))),
  };
  ctx.made.set(String(key), String(ctx.s.createWorksheet(sheet)));
});

registerStep("wsset", (a, ctx) => {
  ctx.s.setWorksheetCell(sheetIndex(a[0], ctx), Number(a[1]), Number(a[2]), a[3] as string | number);
});

registerStep("wsshow", (a, ctx) => {
  shown = sheetIndex(a[0], ctx);
});

registerResult((result) => {
  const index = shown;
  shown = null;
  const ops = (result.ops ?? []) as unknown[][];
  if (index !== null && ops.some((o) => o[0] === "wsshow")) void editWorksheet(index);
  const kept = result.wsKept as string[] | undefined;
  if (kept && kept.length > 0) {
    console.info("Worksheet calls kept for this run only (not stored in the drawing):", kept.join(", "));
  }
  const unevaluated = result.wsUnevaluated as { sheet: string; cell: string; formula: string }[] | undefined;
  if (unevaluated && unevaluated.length > 0) {
    console.info(
      "Worksheet formulas Rodeo can't work out (stored as their text):",
      unevaluated.map((u) => `${u.sheet} ${u.cell} ${u.formula}`).join("; "),
    );
  }
});
