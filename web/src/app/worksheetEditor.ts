// Tools > Reports > Edit Worksheet…: a worksheet's cells as a grid, as Vectorworks' worksheet
// window shows them. A cell is picked by clicking it or with the arrow keys from the entry bar
// above the grid, which edits it; Enter (down), Tab (right) or an up or down arrow keeps the change.
// A number entered makes a number cell, "=…" a formula (checked, and saved as a Vectorworks formula
// or, where Rodeo can't write it as one, as its value with the formula held: worksheetFormulas.ts),
// anything else a text cell, and an empty entry clears the cell. Cell entries go into the drawing
// together on Done, as one undo step. Rows, columns and database rows (double-click a database
// row's header, or Database Row…) change the drawing at once, each its own undo step.

import type { DatabaseColumnSpec, DatabaseRowSpec, EditSession, LiveDatabaseRow, LiveFormula, SheetCell, WorksheetContents, WorksheetLive } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { keepFormula, keptFor, recalculateNow, shiftKept } from "./worksheetFormulas.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import {
  columnMarks,
  columnName,
  criteriaFor,
  databaseHint,
  displayRows,
  fieldFormula,
  NUMBER,
  parseEntry,
  savedFormulaHint,
  typedFormulaHint,
} from "./worksheetGrid.ts";
import "./worksheetEditor.css";

export { columnName, parseEntry };

const DEFAULT_HINT = "Enter a number, text or a formula starting with =; Enter or Tab keeps it. Changes go into the drawing on Done.";

/** an edit not yet in the drawing: a plain value, or a formula with why Rodeo holds it (null: saved as a Vectorworks formula) */
type Edit = { kind: "value"; value: string | number } | { kind: "formula"; text: string; why: string | null };

const cellOf = (key: string): [number, number] => key.split(",").map(Number) as [number, number];

/** The drawing's worksheets, by name, as [name index, name]. */
function worksheets(): [number, string][] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .map((r): [number, string] => [r.index, r.name])
    .sort((a, b) => a[1].localeCompare(b[1]));
}

/** The worksheet of the one selected worksheet image, if any. */
function selectedWorksheet(): number | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id)?.worksheet ?? null;
}

/** True when the drawing has a worksheet to edit. */
export function canEditWorksheet(): boolean {
  return worksheets().length > 0;
}

/** Opens the editor on worksheet `index` (a name index), or on the selected worksheet image's or the first one's. */
export async function editWorksheet(index?: number): Promise<void> {
  const doc = store.session?.doc;
  const sheets = worksheets();
  if (!doc || sheets.length === 0) return;
  let at = index ?? selectedWorksheet() ?? sheets[0][0];
  /** edits not yet in the drawing, by worksheet then "row,col" */
  const pending = new Map<number, Map<string, Edit>>();
  const edits = (): Map<string, Edit> => {
    let m = pending.get(at);
    if (!m) pending.set(at, (m = new Map()));
    return m;
  };
  const pendingCount = (): number => {
    let n = 0;
    for (const m of pending.values()) n += m.size;
    return n;
  };

  const picker = h(
    "select",
    { cls: "ws-picker", attrs: { "aria-label": "Worksheet" } },
    ...sheets.map(([i, name]) => h("option", { attrs: { translate: "no" }, value: String(i), text: name })),
  );
  const ref = h("span", { cls: "ws-ref", attrs: { "aria-live": "polite" } });
  const entry = h("input", { cls: "ws-entry", attrs: { type: "text", "aria-label": "Cell contents", spellcheck: "false", autocomplete: "off" } });
  const hint = h("p", { cls: "ws-hint muted" });
  const scroll = h("div", { cls: "ws-scroll" });
  const note = h("p", {
    cls: "ws-note muted",
    text: "Cell entries go into the drawing on Done; rows, columns and database rows change it at once (Undo turns each back).",
  });

  const tool = (label: string, run: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text: label, attrs: { type: "button" } });
    b.addEventListener("click", () => {
      run();
      entry.focus();
    });
    return b;
  };
  const insertRowBtn = tool("Insert Row", () => insertRow());
  const deleteRowBtn = tool("Delete Row", () => deleteRow());
  const insertColBtn = tool("Insert Column", () => insertColumn());
  const deleteColBtn = tool("Delete Column", () => deleteColumn());
  const databaseBtn = tool("Database Row…", () => void openDatabase());
  const addRowBtn = tool("Add Row", () => addRow());
  const recalcBtn = tool("Recalculate", () => recalculate());
  const tools = h("div", { cls: "ws-tools" }, insertRowBtn, deleteRowBtn, insertColBtn, deleteColBtn, databaseBtn, addRowBtn, recalcBtn);

  let sheet: WorksheetContents | null = null;
  let cells = new Map<string, SheetCell>();
  let formulas = new Map<string, LiveFormula>();
  let dbRows = new Map<number, LiveDatabaseRow>();
  let tds: HTMLTableCellElement[][] = [];
  let row = 0;
  let col = 0;

  /** What a cell's entry bar starts with: a pending edit's text, a database row's criteria, a formula's text, or the cell's value. */
  const entryOf = (r: number, c: number): string => {
    const key = `${r},${c}`;
    const p = edits().get(key);
    if (p) return p.kind === "formula" ? p.text : String(p.value);
    const db = dbRows.get(r);
    if (db) return db.criteria;
    const f = formulas.get(key);
    if (f) return f.text;
    const cell = cells.get(key);
    if (!cell) return "";
    return cell.kind === "number" && cell.value !== null ? String(cell.value) : cell.display;
  };

  /** The entry bar's state and hint for a picked cell. */
  const hintFor = (r: number, c: number): { readOnly: boolean; text: string } => {
    const key = `${r},${c}`;
    const p = edits().get(key);
    if (p) return p.kind === "formula" ? { readOnly: false, text: typedFormulaHint(p.why) } : { readOnly: false, text: DEFAULT_HINT };
    const db = dbRows.get(r);
    if (db) return { readOnly: true, text: databaseHint(db.note, db.columns[c]?.note ?? null) };
    const f = formulas.get(key);
    if (f) {
      const saved = savedFormulaHint(f);
      return { readOnly: saved.readOnly, text: saved.hint };
    }
    return { readOnly: false, text: DEFAULT_HINT };
  };

  /** True when a plain row has nothing in it (and is not a database row). */
  const isEmptyRow = (r: number): boolean => {
    if (!sheet || sheet.database[r]) return false;
    for (let c = 0; c < sheet.cols; c++) {
      const key = `${r},${c}`;
      const p = edits().get(key);
      if (p) {
        if (p.kind === "formula" || p.value !== "") return false;
        continue;
      }
      if (formulas.has(key) || (cells.get(key)?.display ?? "") !== "") return false;
    }
    return true;
  };

  /** Greys the toolbar's buttons that don't apply to the picked row or the drawing. */
  const refreshTools = (): void => {
    const s = sheet;
    insertRowBtn.disabled = !s;
    insertColBtn.disabled = !s;
    addRowBtn.disabled = !s;
    recalcBtn.disabled = !s;
    deleteRowBtn.disabled = !s || s.rows <= 1;
    deleteRowBtn.title = s && s.rows <= 1 ? "A worksheet keeps at least one row." : "";
    deleteColBtn.disabled = !s || s.cols <= 1;
    deleteColBtn.title = s && s.cols <= 1 ? "A worksheet keeps at least one column." : "";
    const can = !!s && (!!s.database[row] || isEmptyRow(row));
    databaseBtn.disabled = !can;
    databaseBtn.title = can ? "" : "Pick an empty row, or a database row";
  };

  const pickCell = (r: number, c: number): void => {
    if (!sheet) return;
    row = Math.max(0, Math.min(sheet.rows - 1, r));
    col = Math.max(0, Math.min(sheet.cols - 1, c));
    for (const line of tds) for (const td of line) td.classList.remove("on");
    const td = tds[row]?.[col];
    td?.classList.add("on");
    td?.scrollIntoView({ block: "nearest", inline: "nearest" });
    ref.textContent = `${columnName(col)}${row + 1}`;
    entry.value = entryOf(row, col);
    const info = hintFor(row, col);
    entry.readOnly = info.readOnly;
    hint.textContent = info.text;
    hint.classList.remove("error");
    refreshTools();
  };

  const refuse = (message: string): false => {
    hint.textContent = message;
    hint.classList.add("error");
    return false;
  };

  /** Keeps the entry bar's change in the picked cell; false when it was refused. */
  const keep = (): boolean => {
    if (!sheet || entry.readOnly || entry.value === entryOf(row, col)) return true;
    const parsed = parseEntry(entry.value);
    const key = `${row},${col}`;
    const td = tds[row][col];
    if ("formula" in parsed) {
      const check = doc.checkWorksheetFormula(parsed.formula, row, col);
      if ("error" in check) return refuse(check.error);
      edits().set(key, { kind: "formula", text: parsed.formula, why: check.why });
      td.textContent = parsed.formula;
      td.classList.add("edited", "formula");
      td.classList.remove("num");
      hint.textContent = typedFormulaHint(check.why);
      hint.classList.remove("error");
      return true;
    }
    const old = cells.get(key);
    const same = !formulas.has(key) && old?.kind !== "formula" && (old ? (old.kind === "number" ? old.value === parsed.value : old.display === parsed.value) : parsed.value === "");
    if (same) edits().delete(key);
    else edits().set(key, { kind: "value", value: parsed.value });
    td.textContent = same ? (old?.display ?? "") : String(parsed.value);
    td.classList.toggle("edited", !same);
    td.classList.remove("formula");
    td.classList.toggle("num", same ? old !== undefined && old.kind !== "text" : typeof parsed.value === "number");
    return true;
  };

  /** The grid as the drawing shows it now. The picked cell is kept (or moved in when the grid shrank). */
  const build = (): void => {
    const got = doc.worksheetContents(at);
    sheet = got && got.rows > 0 && got.cols > 0 ? got : null;
    picker.value = String(at);
    if (!sheet) {
      tds = [];
      cells = new Map();
      formulas = new Map();
      dbRows = new Map();
      scroll.replaceChildren(h("p", { cls: "ws-empty muted", text: "This worksheet can't be read." }));
      ref.textContent = "";
      entry.value = "";
      entry.readOnly = true;
      hint.textContent = "";
      hint.classList.remove("error");
      refreshTools();
      return;
    }
    const s = sheet;
    const live: WorksheetLive = doc.worksheetLive(at, keptFor(at)) ?? { formulas: [], database: [] };
    cells = new Map(s.cells.map((c) => [`${c.row},${c.col}`, c]));
    formulas = new Map(live.formulas.map((f) => [`${f.row},${f.col}`, f]));
    dbRows = new Map(live.database.map((d) => [d.row, d]));
    const lines = doc.worksheetRows(at) ?? [];
    const mine = edits();
    const dbList = s.database.flatMap((is, r) => (is ? [{ row: r, subrows: dbRows.get(r)?.subrows ?? 0 }] : []));
    const head = h(
      "tr",
      {},
      h("th", { cls: "ws-corner" }),
      ...Array.from({ length: s.cols }, (_, c) => h("th", { cls: "ws-col", text: columnName(c), attrs: { scope: "col" } })),
    );
    tds = Array.from({ length: s.rows }, () => []);
    const body = h("tbody");
    for (const line of displayRows(s.rows, dbList)) {
      const r = line.row;
      if (line.kind === "line") {
        // a database row's line: read-only, as the worksheet shows it, with no row number
        const text = lines[line.display ?? -1] ?? [];
        body.append(
          h(
            "tr",
            { cls: "sub" },
            h("th", { cls: "ws-row", text: "·", attrs: { scope: "row" } }),
            ...Array.from({ length: s.cols }, (_, c) => {
              const t = text[c] ?? "";
              return h("td", { cls: NUMBER.test(t.trim()) ? "num" : "", text: t });
            }),
          ),
        );
        continue;
      }
      const isDb = line.kind === "database";
      const cellTds: HTMLTableCellElement[] = [];
      for (let c = 0; c < s.cols; c++) {
        const key = `${r},${c}`;
        const td = h("td", {});
        td.dataset.row = String(r);
        td.dataset.col = String(c);
        if (isDb) {
          // a database row's header line: each column's formula, with its flags
          const dc = dbRows.get(r)?.columns[c] ?? null;
          if (dc) {
            td.append(h("span", { attrs: { translate: "no" }, text: dc.text }));
            for (const m of columnMarks(dc)) td.append(h("span", { cls: "ws-mark", text: m.mark, title: m.title }));
          }
        } else {
          const cell = cells.get(key);
          const p = mine.get(key);
          if (p) {
            td.textContent = p.kind === "formula" ? p.text : String(p.value);
            td.classList.add("edited");
            if (p.kind === "formula") td.classList.add("formula");
            td.classList.toggle("num", p.kind === "value" && typeof p.value === "number");
          } else {
            td.textContent = cell?.display ?? "";
            if (formulas.has(key)) td.classList.add("formula");
            else if (cell && cell.kind !== "text") td.classList.add("num");
          }
        }
        cellTds.push(td);
      }
      tds[r] = cellTds;
      body.append(h("tr", { cls: isDb ? "db" : "" }, h("th", { cls: "ws-row", text: isDb ? `▸ ${r + 1}` : String(r + 1), attrs: { scope: "row" } }), ...cellTds));
    }
    const table = h("table", { cls: "ws-grid", attrs: { translate: "no" } }, h("thead", {}, head), body);
    table.addEventListener("pointerdown", (e) => {
      const td = (e.target as HTMLElement).closest("td");
      if (!td?.dataset.row) return;
      // a click keeps the entry first, as Enter would; a refused entry keeps its cell
      e.preventDefault();
      if (keep()) pickCell(Number(td.dataset.row), Number(td.dataset.col));
      entry.focus();
    });
    table.addEventListener("dblclick", (e) => {
      const td = (e.target as HTMLElement).closest("td");
      if (!td?.dataset.row || !s.database[Number(td.dataset.row)]) return;
      e.preventDefault();
      void openDatabase();
    });
    scroll.replaceChildren(table);
    pickCell(Math.min(row, s.rows - 1), Math.min(col, s.cols - 1));
  };

  /** The pending edits written into the drawing, one worksheet at a time: plain values, then formulas, in row then column order. */
  const applyEdits = (s: EditSession): void => {
    for (const [index, m] of pending) {
      const entries = [...m].sort(([a], [b]) => {
        const [ar, ac] = cellOf(a);
        const [br, bc] = cellOf(b);
        return ar - br || ac - bc;
      });
      for (const [key, e] of entries) {
        if (e.kind !== "value") continue;
        const [r, c] = cellOf(key);
        s.setWorksheetCell(index, r, c, e.value);
        keepFormula(s, index, r, c, null);
      }
      for (const [key, e] of entries) {
        if (e.kind !== "formula") continue;
        const [r, c] = cellOf(key);
        const res = s.setWorksheetFormula(index, r, c, e.text, keptFor(index));
        keepFormula(s, index, r, c, res.kept ? e.text : null);
      }
    }
  };

  /** Writes the pending cell edits into the drawing as one undo step; false when that was refused. */
  const commitPending = (): boolean => {
    if (pendingCount() === 0) return true;
    if (!attempt("Edit worksheet", (s) => s.batch(() => applyEdits(s)))) return false;
    pending.clear();
    return true;
  };

  /** Keeps the picked cell's entry, then writes the pending edits; false when either was refused. */
  const commit = (): boolean => keep() && commitPending();

  const insertRow = (): void => {
    if (!sheet || !commit()) return;
    const r = row;
    const n = at;
    attempt("Insert row", (s) =>
      s.batch(() => {
        s.insertWorksheetRows(n, r, 1);
        shiftKept(s, n, "row", r, 1);
      }),
    );
    build();
  };

  const deleteRow = (): void => {
    if (!sheet || sheet.rows <= 1 || !commit()) return;
    const r = row;
    const n = at;
    attempt("Delete row", (s) =>
      s.batch(() => {
        s.deleteWorksheetRows(n, r, 1);
        shiftKept(s, n, "row", r, -1);
      }),
    );
    build();
  };

  const insertColumn = (): void => {
    if (!sheet || !commit()) return;
    const c = col;
    const n = at;
    attempt("Insert column", (s) =>
      s.batch(() => {
        s.insertWorksheetColumns(n, c, 1);
        shiftKept(s, n, "col", c, 1);
      }),
    );
    build();
  };

  const deleteColumn = (): void => {
    if (!sheet || sheet.cols <= 1 || !commit()) return;
    const c = col;
    const n = at;
    attempt("Delete column", (s) =>
      s.batch(() => {
        s.deleteWorksheetColumns(n, c, 1);
        shiftKept(s, n, "col", c, -1);
      }),
    );
    build();
  };

  const addRow = (): void => {
    if (!sheet || !commit()) return;
    const n = at;
    const end = sheet.rows;
    attempt("Add row", (s) => s.insertWorksheetRows(n, end, 1));
    build();
  };

  const recalculate = (): void => {
    if (!commit()) return;
    const result = attempt("Recalculate", (s) => recalculateNow(s));
    if (result) toast(result.value > 1 ? `${result.value} worksheets changed.` : result.value === 1 ? "1 worksheet changed." : "Nothing changed.", "info");
    build();
  };

  /** Database Row…: the picked row's criteria and columns in a dialog, applied as one step. */
  const openDatabase = async (): Promise<void> => {
    if (!sheet || !commit()) return;
    const s0 = sheet;
    const r = row;
    if (!s0.database[r] && !isEmptyRow(r)) return;
    const existing = dbRows.get(r) ?? null;
    // Rodeo's own data objects aren't for schedules
    const records = doc.formulaRecords().filter((f) => f.fields.length > 0 && !f.name.startsWith("Rodeo "));

    const objects = h(
      "select",
      { cls: "ws-db-objects", attrs: { "aria-label": "Objects" } },
      ...records.map((rec, i) => h("option", { value: String(i), text: `Objects with the record ${rec.name}` })),
      h("option", { value: "typed", text: "Criteria as typed" }),
    );
    const first = existing ? existing.criteria : records[0] ? criteriaFor(records[0].name) : "";
    const matched = records.findIndex((rec) => criteriaFor(rec.name) === first);
    objects.value = matched >= 0 ? String(matched) : "typed";
    const criteria = h("input", {
      cls: "ws-db-field",
      attrs: { type: "text", "aria-label": "Criteria", spellcheck: "false", autocomplete: "off", translate: "no" },
      value: first,
    });

    /** the Add field choices: the chosen record's fields, or every record's when the criteria are typed */
    const fieldOptions = (): HTMLOptionElement[] => {
      const shown = objects.value === "typed" ? records : [records[Number(objects.value)]].filter((x): x is (typeof records)[number] => !!x);
      return [
        h("option", { value: "", text: "Add field…" }),
        ...shown.flatMap((rec) => rec.fields.map((field) => {
          const f = fieldFormula(rec.name, field);
          return h("option", { value: f, text: f.slice(1) });
        })),
        h("option", { value: "=COUNT", text: "=COUNT (how many)" }),
      ];
    };

    const colRows = Array.from({ length: s0.cols }, (_, c) => {
      const lc = existing?.columns[c] ?? null;
      const text = h("input", {
        cls: "ws-db-field",
        attrs: { type: "text", "aria-label": "Column formula", spellcheck: "false", autocomplete: "off", translate: "no" },
        value: lc?.text ?? "",
      });
      const add = h("select", { cls: "ws-db-add", attrs: { "aria-label": "Add field" } }, ...fieldOptions());
      add.addEventListener("change", () => {
        if (add.value) text.value = add.value;
        add.value = "";
        text.focus();
      });
      const sort = h(
        "select",
        { cls: "ws-db-sort", attrs: { "aria-label": "Sort" } },
        h("option", { value: "none", text: "None" }),
        h("option", { value: "asc1", text: "Ascending 1st" }),
        h("option", { value: "asc2", text: "Ascending 2nd" }),
        ...(lc?.sort === "descending" ? [h("option", { value: "desc", text: "Descending" })] : []),
      );
      sort.value = lc?.sort === "ascending" ? (lc.precedence >= 2 ? "asc2" : "asc1") : lc?.sort === "descending" ? "desc" : "none";
      const summarize = h("input", { attrs: { type: "checkbox" }, checked: lc?.summarize ?? false });
      const sum = h("input", { attrs: { type: "checkbox" }, checked: lc?.sum ?? false });
      const line = h(
        "div",
        { cls: "ws-db-col" },
        h("span", { cls: "ws-db-name", attrs: { translate: "no" }, text: columnName(c) }),
        text,
        add,
        sort,
        h("label", { cls: "ws-db-check", title: "One line for the objects that agree in this column" }, summarize, "Summarize"),
        h("label", { cls: "ws-db-check", title: "Add up this column's numbers on summarized lines" }, sum, "Sum"),
      );
      return { text, add, sort, summarize, sum, line };
    });
    const refreshFields = (): void => {
      for (const c of colRows) c.add.replaceChildren(...fieldOptions());
    };
    objects.addEventListener("change", () => {
      if (objects.value !== "typed") criteria.value = criteriaFor(records[Number(objects.value)]?.name ?? "");
      refreshFields();
    });
    criteria.addEventListener("input", () => {
      const m = records.findIndex((rec) => criteriaFor(rec.name) === criteria.value.trim());
      objects.value = m >= 0 ? String(m) : "typed";
      refreshFields();
    });

    const sortOf = (v: string): Pick<DatabaseColumnSpec, "sort" | "precedence"> =>
      v === "asc1" ? { sort: "ascending", precedence: 1 } : v === "asc2" ? { sort: "ascending", precedence: 2 } : v === "desc" ? { sort: "descending" } : { sort: "none" };

    const shown = showDialog<DatabaseRowSpec>({
      title: "Database Row",
      okLabel: "Apply",
      cls: "ws-db-dialog",
      body: [
        h("p", { cls: "ws-db-label", text: "Objects" }),
        objects,
        h("p", { cls: "ws-db-label", text: "Criteria" }),
        criteria,
        h("p", {
          cls: "ws-db-note muted",
          text: "As Vectorworks writes criteria. Rodeo follows: R IN ['Record'], PON='Plug-in name', L='Layer', 'Record'.'Field'=value or <>value, TRUE, joined with & (and) and | (or) in brackets.",
        }),
        h("p", { cls: "ws-db-label", text: "Columns" }),
        ...colRows.map((c) => c.line),
      ],
      check: () => {
        const columns = colRows.map(({ text, sort, summarize, sum }): DatabaseColumnSpec | null => {
          const t = text.value.trim();
          return t ? { text: t, summarize: summarize.checked, sum: sum.checked, ...sortOf(sort.value) } : null;
        });
        if (!columns.some((c) => c !== null)) return { error: "Give at least one column a formula.", focus: colRows[0]?.text ?? criteria };
        const spec: DatabaseRowSpec = { criteria: criteria.value.trim(), columns };
        const problem = doc.databaseRowProblem(at, r, spec);
        return problem === null ? { value: spec } : { error: problem, focus: criteria };
      },
    });
    const spec = await shown;
    if (!spec) return;
    attempt("Database row", (s) => s.setDatabaseRow(at, r, spec));
    build();
  };

  picker.addEventListener("change", () => {
    if (!keep()) {
      picker.value = String(at);
      return;
    }
    at = Number(picker.value);
    row = 0;
    col = 0;
    build();
    entry.focus();
  });

  entry.addEventListener("keydown", (e) => {
    const step = (dr: number, dc: number): void => {
      e.preventDefault();
      if (keep()) pickCell(row + dr, col + dc);
    };
    if (e.key === "Enter") step(e.shiftKey ? -1 : 1, 0);
    else if (e.key === "Tab") step(0, e.shiftKey ? -1 : 1);
    else if (e.key === "ArrowUp") step(-1, 0);
    else if (e.key === "ArrowDown") step(1, 0);
    else if (e.key === "Escape" && entry.value !== entryOf(row, col)) {
      // the first Esc drops the entry's change; the next closes the editor
      e.preventDefault();
      e.stopPropagation();
      pickCell(row, col);
    }
  });

  build();
  const shownEditor = showDialog<true>({
    title: "Edit Worksheet",
    okLabel: "Done",
    cls: "ws-dialog",
    body: [
      sheets.length > 1 ? h("div", { cls: "ws-top" }, picker) : h("p", { cls: "ws-name", text: sheets.find(([i]) => i === at)?.[1] ?? "" }),
      h("div", { cls: "ws-bar" }, ref, entry),
      tools,
      scroll,
      hint,
      note,
    ],
    check: () => (keep() ? { value: true } : { error: "That cell's entry can't be kept: change it or press Esc.", focus: entry }),
  });
  // the dialog focuses its first control, the picker; editing starts in the entry bar
  entry.focus();
  entry.select();
  const done = await shownEditor;
  if (done) commitPending();
}
