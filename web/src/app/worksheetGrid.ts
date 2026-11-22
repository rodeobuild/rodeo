// The worksheet editor's pure helpers: what an entry is, the column letters, the grid's rows in
// order, and the texts it shows for formulas and database rows. No DOM here, so the checks
// (worksheetEditor.check.ts) can run them.

import type { LiveColumn } from "../core/index.ts";

/** what a cell's entry may be: a plain number makes a number cell */
export const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?$/i;

/** The column's letters: A to Z, then AA, AB and on. */
export function columnName(col: number): string {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** An entry as the cell it makes: a number or text ("" clears it), or a formula (its text, trimmed, starting with "="). */
export type Entry = { value: string | number } | { formula: string };

export function parseEntry(raw: string): Entry {
  const t = raw.trim();
  if (t.startsWith("=")) return { formula: t };
  if (t === "") return { value: "" };
  return NUMBER.test(t) ? { value: Number(t) } : { value: raw };
}

/** One line of the grid: a plain row, a database row's header, or one of a database row's lines. `display` indexes worksheetRows (null for a header). */
export interface GridRow {
  kind: "plain" | "database" | "line";
  row: number;
  display: number | null;
}

/**
 * The grid's lines in order, from the worksheet's rows and its database rows' line counts. A plain row is
 * one line; a database row is its header, then its lines, which are the display rows worksheetRows gives
 * (its header rows are left out there, so the display index counts only the other lines).
 */
export function displayRows(rows: number, database: readonly { row: number; subrows: number }[]): GridRow[] {
  const counts = new Map(database.map((d) => [d.row, d.subrows]));
  const out: GridRow[] = [];
  let display = 0;
  for (let row = 0; row < rows; row++) {
    const subrows = counts.get(row);
    if (subrows === undefined) {
      out.push({ kind: "plain", row, display: display++ });
      continue;
    }
    out.push({ kind: "database", row, display: null });
    for (let k = 0; k < subrows; k++) out.push({ kind: "line", row, display: display++ });
  }
  return out;
}

/** The criteria a record's database row starts with: =DATABASE((R IN ['name'])), a quote in the name doubled. */
export function criteriaFor(record: string): string {
  return `=DATABASE((R IN ['${record.replace(/'/g, "''")}']))`;
}

/** A record's field as a column formula: ='Record'.'Field' (quotes doubled). */
export function fieldFormula(record: string, field: string): string {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  return `=${q(record)}.${q(field)}`;
}

/** The small marks a database header cell shows for its column's flags, each with what it means. */
export function columnMarks(col: Pick<LiveColumn, "sort" | "sum" | "summarize">): { mark: string; title: string }[] {
  const out: { mark: string; title: string }[] = [];
  if (col.sort === "ascending") out.push({ mark: "↑", title: "Sorted ascending" });
  if (col.sum) out.push({ mark: "Σ", title: "Added up on summarized lines" });
  if (col.summarize) out.push({ mark: "≡", title: "Summarized: one line for the objects that agree" });
  return out;
}

/** The hint for a formula typed and checked: its "why" (Rodeo saves its value and holds the formula), or null when it is saved as a Vectorworks formula. */
export function typedFormulaHint(why: string | null): string {
  return why === null ? "Formula: worked out again whenever the drawing changes." : `Rodeo will work this out, and save its value: ${why}`;
}

/** The hint and whether the entry is read-only for a formula cell read from the drawing. */
export function savedFormulaHint(f: { kept: boolean; note: string | null }): { readOnly: boolean; hint: string } {
  if (f.note !== null) return { readOnly: true, hint: `Formula: ${f.note} It shows the value the file holds.` };
  if (f.kept)
    return {
      readOnly: false,
      hint: "Formula kept by Rodeo: it is worked out here, and saved as its value, so Vectorworks will show the value, not the formula.",
    };
  return { readOnly: false, hint: "Formula: worked out again whenever the drawing changes." };
}

/**
 * The hint for a database row's header cells, with the reason Rodeo doesn't follow its criteria when it
 * doesn't, or (`column`) why it doesn't work the picked column out.
 */
export function databaseHint(note: string | null, column: string | null = null): string {
  const base = "Database row: double-click, or use Database Row…, to change what it lists and its columns.";
  if (note !== null) return `${base} Rodeo can't follow its criteria (${note}), so it shows the lines the file holds.`;
  return column === null ? base : `${base} Rodeo doesn't work this column out (${column}), so it shows the values the file holds.`;
}
