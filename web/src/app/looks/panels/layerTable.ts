// View › Work Like: a table of the drawing's classes the way the look's application lists its layers
// (Rhino's Layers panel, AutoCAD's Layer Properties Manager, SketchUp's Tags list). Rows are Rodeo's
// classes. Every change goes through the same class commands the Classes panel uses (setActiveClass,
// setClassVisibility, createClass, renameClass, deleteClass), so undo, the other panels and the drawing
// all see it, and the table re-reads the drawing whenever it changes.

import type { ClassInfo, LineType, Visibility, VwxDocument } from "../../../core/index.ts";
import { attempt, setActiveClass } from "../../commands.ts";
import { editInline, h } from "../../dom.ts";
import { confirmDialog } from "../../menubar.ts";
import { freeName } from "../../panels/common.ts";
import { store } from "../../state.ts";
import { toast } from "../../toast.ts";
import type { LayerColumn, LookPanel } from "../types.ts";
import "./layerTable.css";

export type LayerTableSpec = Extract<LookPanel, { kind: "layerTable" }>;

type Style = LayerTableSpec["style"];

/** The name Rodeo's own class None goes by in the document. */
const NONE_NAME = "None";
const MM_PER_MIL = 0.0254;

/** A column's width in its grid. The name column takes what is left. */
const WIDTH: Record<LayerColumn, string> = {
  current: "50px",
  visible: "36px",
  lock: "40px",
  color: "44px",
  name: "minmax(60px, 1fr)",
  linetype: "84px",
  lineweight: "90px",
  count: "56px",
};

/** The titles each style shows over its columns. A column without a title is not shown in that style. */
const TITLES: Record<Style, Partial<Record<LayerColumn, string>>> = {
  rhino: { name: "Name", current: "Current", visible: "On", lock: "Lock", color: "Color", linetype: "Linetype", lineweight: "Print Width", count: "Objects" },
  autocad: { current: "Status", name: "Name", visible: "On", lock: "Lock", color: "Color", linetype: "Linetype", lineweight: "Lineweight" },
  sketchup: { visible: "", name: "Name", linetype: "Dashes", color: "Color" },
};

/** SketchUp's Tags list shows only these columns, in this order. */
const SKETCHUP_COLUMNS: readonly LayerColumn[] = ["visible", "name", "linetype", "color"];

/** Each style's row height in px. */
const ROW_HEIGHT: Record<Style, number> = { rhino: 20, autocad: 22, sketchup: 26 };

/** Words each style's buttons and search field use for a layer (SketchUp says tag). */
const WORDS: Record<Style, { add: string; del: string; search: string; noun: string }> = {
  rhino: { add: "New Layer", del: "Delete", search: "Filter layers", noun: "layers" },
  autocad: { add: "New Layer", del: "Delete Layer", search: "Search for layer", noun: "layers" },
  sketchup: { add: "Add Tag", del: "Delete Tag", search: "Search for tag", noun: "tags" },
};

/** Wraps path markup in the 16px line-icon frame: stroke currentColor, no fill. */
function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Icons drawn for this table: each shows what its command does. */
const ICON = {
  newLayer: icon('<path d="M3.5 1.8h5.4l3.6 3.6v3.1"/><path d="M3.5 1.8v12.4h4.6"/><path d="M11.5 10.5v4.5M9.25 12.75h4.5"/>'),
  plus: icon('<path d="M8 2.5v11M2.5 8h11"/>'),
  trash: icon('<path d="M2.5 4.5h11M6.25 4.5V2.8h3.5v1.7M4 4.5l.7 9h6.6l.7-9"/>'),
  check: icon('<path d="M2.8 8.6l3.2 3.1 7.2-7.4"/>'),
  bulb: icon('<path d="M5.6 10.6C4.4 9.8 3.7 8.6 3.7 7.2a4.3 4.3 0 0 1 8.6 0c0 1.4-.7 2.6-1.9 3.4v1.2H5.6z"/><path d="M6.4 13.9h3.2"/>'),
  eye: icon('<path d="M1.5 8c1.6-2.7 3.7-4.2 6.5-4.2S12.9 5.3 14.5 8c-1.6 2.7-3.7 4.2-6.5 4.2S3.1 10.7 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  eyeOff: icon('<path d="M1.5 8c1.6-2.7 3.7-4.2 6.5-4.2S12.9 5.3 14.5 8c-1.6 2.7-3.7 4.2-6.5 4.2S3.1 10.7 1.5 8z"/><circle cx="8" cy="8" r="2"/><path d="M2.5 13.5l11-11"/>'),
  lockClosed: icon('<rect x="3.2" y="7.2" width="9.6" height="6.6" rx="1.2"/><path d="M5.3 7.2V5.2a2.7 2.7 0 0 1 5.4 0v2"/>'),
  lockOpen: icon('<rect x="3.2" y="7.2" width="9.6" height="6.6" rx="1.2"/><path d="M5.3 7.2V5.2a2.7 2.7 0 0 1 5.2-1"/>'),
};

/** The columns a style shows, in the order the spec gives them; the name always shows. */
function columnsFor(spec: LayerTableSpec): LayerColumn[] {
  const wanted = spec.style === "sketchup" ? SKETCHUP_COLUMNS.filter((c) => c === "name" || spec.columns.includes(c)) : spec.columns.filter((c) => c in TITLES[spec.style]);
  return wanted.includes("name") ? wanted : [...wanted, "name"];
}

/** A class's name as the table shows it: None under the look's own word for it. */
function displayName(c: ClassInfo, none: string): string {
  return c.name === NONE_NAME ? none : c.name;
}

/** The linetype a class draws with: its dash style's name, or Continuous for a solid line. */
function linetypeName(c: ClassInfo, lineTypes: readonly LineType[]): string {
  const style = c.attrs?.lineStyle ?? 2;
  if (style === 0) return "None";
  if (style < 0) return lineTypes.find((t) => t.style === style)?.name ?? "Continuous";
  return "Continuous";
}

/** The lineweight a class draws with, in mm (Default when the class has none set). */
function lineweightName(c: ClassInfo): string {
  const mils = c.attrs?.lineWeight ?? 0;
  return mils <= 0 ? "Default" : `${(mils * MM_PER_MIL).toFixed(2)} mm`;
}

/** Fills `into` with the table and keeps it up to date; returns the call that takes it down. */
export function mountLayerTable(into: HTMLElement, spec: LayerTableSpec): () => void {
  const cols = columnsFor(spec);
  const template = cols.map((c) => WIDTH[c]).join(" ");
  const titles = TITLES[spec.style];
  const words = WORDS[spec.style];
  const rowHeight = ROW_HEIGHT[spec.style];
  let filter = "";
  let selected: number | null = null;

  const root = h("div", { cls: "lk-layer-table", attrs: { "data-style": spec.style } });
  root.style.setProperty("--lt-row-h", `${rowHeight}px`);
  const caption = h("div", { cls: "lt-caption" });

  const toolButton = (svg: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = h("button", { cls: "lt-tool", html: svg, title, attrs: { type: "button", "aria-label": title } });
    b.addEventListener("click", onClick);
    return b;
  };
  const search = h("input", { cls: "lt-search", attrs: { type: "search", placeholder: words.search, "aria-label": words.search } });
  const addBtn = toolButton(spec.style === "sketchup" ? ICON.plus : ICON.newLayer, words.add, () => newClass());
  const delBtn = toolButton(ICON.trash, words.del, () => void deleteSelected());
  const setBtn = spec.style === "autocad" ? toolButton(ICON.check, "Set Current", () => makeSelectedCurrent()) : null;
  const toolbar = h("div", { cls: "lt-toolbar" }, addBtn, delBtn, setBtn, search);

  const head = h("div", { cls: "lt-head", attrs: { style: `grid-template-columns: ${template}` } });
  for (const c of cols) head.append(h("div", { cls: `lt-cell lt-h-${c}`, text: titles[c] ?? "" }));
  const list = h("div", { cls: "lt-body" });

  const parts: HTMLElement[] = [];
  if (spec.style === "autocad") parts.push(caption);
  parts.push(toolbar, head, list);
  root.replaceChildren(...parts);
  into.replaceChildren(root);

  /** The class with this index in the open drawing, if any. */
  const classAt = (index: number | null): ClassInfo | undefined =>
    index === null ? undefined : store.session?.doc.classes().find((c) => c.index === index);

  /** Starts renaming a class in its row, as a double-click on its name does. */
  const renameInRow = (index: number): void => {
    const host = list.querySelector<HTMLElement>(`[data-index="${index}"] .lt-name`);
    host?.scrollIntoView({ block: "nearest" });
    host?.dispatchEvent(new MouseEvent("dblclick"));
  };

  /** Makes a new class (named by Rodeo's free-name rule) and opens its name to edit. */
  const newClass = (): void => {
    if (!store.session) return;
    const r = attempt("Create class", (s) => s.createClass(freeName("Class")));
    if (!r) return;
    selected = r.value;
    filter = "";
    search.value = "";
    render();
    renameInRow(r.value);
  };

  /** Deletes the selected class after a confirmation, as the Classes panel does; None cannot go. */
  const deleteSelected = async (): Promise<void> => {
    const c = classAt(selected);
    if (!c || c.name === NONE_NAME) return;
    const message = `Delete class "${displayName(c, spec.none)}"? Its objects move to "${spec.none}".`;
    if (!(await confirmDialog("Delete class", message, "Delete"))) return;
    if (attempt("Delete class", (s) => s.deleteClass(c.index))) selected = null;
    render();
  };

  /** Makes the selected class the current one, where new objects go. */
  const makeSelectedCurrent = (): void => {
    const c = classAt(selected);
    if (c) setActiveClass(c.index);
  };

  /** Sets a class's visibility through the same command the Classes panel uses. */
  const setVisibility = (c: ClassInfo, v: Visibility): void => {
    attempt("Change visibility", (s) => s.setClassVisibility(c.index, v));
  };

  /** One row of the table: the cells the style shows, in its column order. */
  const rowFor = (c: ClassInfo, none: string, lineTypes: readonly LineType[], isCurrent: boolean): HTMLElement => {
    const isNone = c.name === NONE_NAME;
    const cell = (col: LayerColumn): HTMLElement => {
      switch (col) {
        case "current": {
          const cur = h("div", { cls: "lt-cell lt-c-current", title: isCurrent ? "Current" : "Make current", attrs: { "data-col": col } },
            isCurrent ? h("span", { cls: "lt-mark", html: ICON.check }) : null);
          cur.addEventListener("click", () => setActiveClass(c.index));
          return cur;
        }
        case "visible": {
          const on = c.visibility !== "hidden";
          const svg = spec.style === "sketchup" ? (on ? ICON.eye : ICON.eyeOff) : ICON.bulb;
          const label = on ? "On" : "Off";
          const btn = h("button", {
            cls: `lt-icon lt-vis${on ? "" : " off"}`,
            html: svg,
            title: `${label}. Click to turn ${on ? "off" : "on"}`,
            attrs: { type: "button", "aria-label": `${label}: ${displayName(c, none)}` },
          });
          btn.addEventListener("click", () => setVisibility(c, on ? "hidden" : "visible"));
          return h("div", { cls: "lt-cell lt-c-visible", attrs: { "data-col": col } }, btn);
        }
        case "lock": {
          const locked = c.visibility === "grayed";
          const btn = h("button", {
            cls: `lt-icon lt-lock${locked ? " on" : ""}`,
            html: locked ? ICON.lockClosed : ICON.lockOpen,
            title: locked ? "Locked: shown, not picked. Click to unlock" : "Click to lock: shown, not picked",
            attrs: { type: "button", "aria-label": `${locked ? "Locked" : "Unlocked"}: ${displayName(c, none)}` },
          });
          btn.addEventListener("click", () => setVisibility(c, locked ? "visible" : "grayed"));
          return h("div", { cls: "lt-cell lt-c-lock", attrs: { "data-col": col } }, btn);
        }
        case "color": {
          const sw = h("span", { cls: "lt-swatch" });
          sw.style.background = c.attrs ? store.session?.doc.color(c.attrs.penFore) ?? "transparent" : "transparent";
          return h("div", { cls: "lt-cell lt-c-color", attrs: { "data-col": col } }, sw);
        }
        case "name": {
          const name = h("span", { cls: "lt-name", text: displayName(c, none), attrs: { translate: "no" } });
          if (!isNone) name.addEventListener("dblclick", () => renameClass(c, name));
          return h("div", { cls: "lt-cell lt-c-name", attrs: { "data-col": col } }, name);
        }
        case "linetype": {
          const lt = linetypeName(c, lineTypes);
          if (spec.style === "sketchup") {
            const dashes = lineTypes.find((t) => t.style === c.attrs?.lineStyle)?.dashes ?? [];
            const arr = dashes.length > 0 ? ` stroke-dasharray="${dashes.map((v) => Math.max(1, v * 24)).join(" ")}"` : "";
            return h("div", { cls: "lt-cell lt-c-linetype", title: lt, attrs: { "data-col": col } },
              h("span", { cls: "lt-dash", html: `<svg viewBox="0 0 56 8" width="56" height="8"><line x1="1" y1="4" x2="55" y2="4" stroke="currentColor" stroke-width="1.6"${arr}/></svg>` }));
          }
          return h("div", { cls: "lt-cell lt-c-linetype", text: lt, attrs: { "data-col": col } });
        }
        case "lineweight":
          return h("div", { cls: "lt-cell lt-c-lineweight", text: lineweightName(c), attrs: { "data-col": col } });
        case "count":
          return h("div", { cls: "lt-cell lt-c-count", text: String(c.objectCount), attrs: { "data-col": col } });
      }
    };

    const classes = ["lt-row"];
    if (c.index === selected) classes.push("selected");
    if (isCurrent) classes.push("current");
    const row = h("div", { cls: classes.join(" "), attrs: { "data-index": String(c.index) } }, ...cols.map(cell));
    row.style.gridTemplateColumns = template;
    row.addEventListener("click", () => {
      selected = c.index;
      render();
    });
    return row;
  };

  /** Renames a class in place, as the Classes panel does; the name must not be empty. */
  const renameClass = (c: ClassInfo, host: HTMLElement): void => {
    editInline(host, [c.name], (vals) => {
      if (vals) {
        const name = vals[0] ?? "";
        if (!name) toast("A class needs a name.", "info");
        else attempt("Rename class", (s) => s.renameClass(c.index, name));
      }
      render();
    });
  };

  /** Redraws the table from the open drawing's classes and the current filter and selection. */
  function render(): void {
    const s = store.session;
    const doc: VwxDocument | undefined = s?.doc;
    const all = doc ? doc.classes() : [];
    // None first, the rest in the drawing's own order
    const ordered = [...all.filter((c) => c.name === NONE_NAME), ...all.filter((c) => c.name !== NONE_NAME)];
    if (selected !== null && !ordered.some((c) => c.index === selected)) selected = null;
    const lineTypes = doc ? doc.lineTypes() : [];
    const shown = ordered.filter((c) => filter === "" || displayName(c, spec.none).toLowerCase().includes(filter));
    const active = ordered.find((c) => c.index === store.activeClassIndex);

    caption.textContent = `Current layer: ${active ? displayName(active, spec.none) : ""}`;
    list.replaceChildren(...shown.map((c) => rowFor(c, spec.none, lineTypes, c.index === store.activeClassIndex)));
    if (shown.length === 0) {
      list.append(h("div", { cls: "lt-empty", text: all.length > 0 ? `No matching ${words.noun}` : `No ${words.noun}` }));
    }
    const sel = classAt(selected);
    addBtn.disabled = !s;
    delBtn.disabled = !sel || sel.name === NONE_NAME;
    if (setBtn) setBtn.disabled = !sel;
  }

  search.addEventListener("input", () => {
    filter = search.value.trim().toLowerCase();
    render();
  });

  const off = store.on(["session", "class", "file", "layer"], render);
  render();

  return () => {
    off();
    into.replaceChildren();
  };
}
