// A look's status bar: one or more rows along the foot of the window. Rhino stacks an Osnap row of
// check boxes above its status row, AutoCAD keeps toggle words at the right, Revit has the hint at
// the left and the selection count at the right, SketchUp has a Measurements box. Every item reads
// Rodeo's own state and runs Rodeo's own commands (types.ts), so the bar only lays them out.

import { h } from "../dom.ts";
import { dataBar } from "../databar.ts";
import { setActiveLayer } from "../commands.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { formatLength } from "../units.ts";
import { commandIcon, commandWhy, lookIcon, refreshButtons, runCommand, track } from "./commands.ts";
import type { StatusBarSpec, StatusItem } from "./types.ts";
import "./statusBar.css";

const CHECK_MARK = `<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// a funnel: Revit's filter icon, drawn here as a plain line icon
const FILTER_ICON = lookIcon('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>');

/** The cursor's position as the status bar shows it, measured from the datum while one is set (as statusbar.ts does). */
function cursorText(): string {
  const s = store.session;
  const c = store.cursor;
  if (!s || !c) return "";
  const units = s.doc.info.units;
  const d = store.datum;
  const xy = `X ${formatLength(c.x - (d?.x ?? 0), units)}   Y ${formatLength(c.y - (d?.y ?? 0), units)}`;
  return d ? `Datum  ${xy}` : xy;
}

/** Builds the status bar into `into`, with Rodeo's Mode bar at its start when `modeBar` is given; returns the call that takes it down. */
export function mountStatusBar(into: HTMLElement, spec: StatusBarSpec, modeBar: HTMLElement | null): () => void {
  const bar = h("div", { cls: "lk-statusbar" });
  const offs: (() => void)[] = [];
  const rows = spec.rows.map((items) => {
    const row = h("div", { cls: "lk-status-row" });
    for (const it of items) row.append(item(it, offs));
    return row;
  });
  bar.append(...rows);
  // the Mode bar moves into the first row; the engine puts it back before this bar goes
  if (modeBar && rows.length > 0) rows[0].insertBefore(modeBar, rows[0].firstChild);
  into.append(bar);
  return () => {
    for (const off of offs) off();
    // removing the bar also takes the Mode bar out of it: the engine has moved it back first
    bar.remove();
  };
}

/** One item of a row, kept current by the store topics it reads. */
function item(it: StatusItem, offs: (() => void)[]): HTMLElement {
  switch (it.kind) {
    case "hint": {
      const el = h("span", { cls: "lk-st-hint" });
      const show = (): void => {
        el.textContent = store.hint;
        el.title = store.hint;
      };
      show();
      offs.push(store.on(["hint", "tool"], show));
      return el;
    }
    case "coords": {
      const el = h("span", { cls: "lk-st-coords" });
      if (it.label) el.append(h("span", { cls: "lk-st-label", text: it.label }));
      const value = h("span", { cls: "lk-st-coords-value" });
      el.append(value);
      const show = (): void => {
        value.textContent = cursorText();
      };
      show();
      offs.push(store.on(["cursor", "session", "datum"], show));
      return el;
    }
    case "toggle":
      return toggle(it);
    case "button": {
      const btn = h("button", { cls: "lk-st-button", title: it.label, attrs: { type: "button", "aria-label": it.label } });
      if (it.icon) btn.append(h("span", { cls: "lk-st-icon", html: it.icon }));
      btn.append(h("span", { cls: "lk-st-label", text: it.label }));
      btn.addEventListener("click", () => activate(btn, it.do));
      track(btn, it.do);
      return btn;
    }
    case "text":
      return h("span", { cls: "lk-st-text", text: it.text });
    case "units": {
      const el = h("span", { cls: "lk-st-text lk-st-units" });
      const show = (): void => {
        el.textContent = store.session?.doc.info.units ?? "";
      };
      show();
      offs.push(store.on("session", show));
      return el;
    }
    case "layer":
      return layer(it.label, offs);
    case "selection": {
      const el = h("span", { cls: "lk-st-selection", title: "Selected objects" });
      el.append(h("span", { cls: "lk-st-icon", html: FILTER_ICON }));
      const count = h("span", { cls: "lk-st-count" });
      el.append(count);
      const show = (): void => {
        count.textContent = `:${store.selection.size}`;
      };
      show();
      offs.push(store.on("selection", show));
      return el;
    }
    case "measurements": {
      const el = h("span", { cls: "lk-st-measure" });
      el.append(h("span", { cls: "lk-st-measure-label", text: it.label }));
      // the data bar's live values are private to it, so the box shows the cursor as coords does
      const box = h("span", { cls: "lk-st-measure-box", title: "Click to type a value in the data bar", attrs: { "aria-label": it.label } });
      box.addEventListener("click", () => {
        dataBar.focusField(false);
      });
      el.append(box);
      const show = (): void => {
        box.textContent = cursorText();
      };
      show();
      offs.push(store.on(["cursor", "session", "datum"], show));
      return el;
    }
    case "spacer":
      return h("span", { cls: "lk-st-spacer" });
  }
}

/** A toggle: its word, a check box then its word, or its icon alone; lit while its command is checked. */
function toggle(it: Extract<StatusItem, { kind: "toggle" }>): HTMLElement {
  const style = it.style ?? "text";
  const btn = h("button", { cls: `lk-st-toggle lk-st-${style}`, title: it.label, attrs: { type: "button", "aria-label": it.label } });
  if (style === "icon") {
    btn.innerHTML = commandIcon(it);
  } else {
    if (style === "check") btn.append(h("span", { cls: "lk-st-box", html: CHECK_MARK }));
    btn.append(h("span", { cls: "lk-st-label", text: it.label }));
  }
  btn.addEventListener("click", () => activate(btn, it.do));
  track(btn, it.do);
  return btn;
}

/** Runs a status item's command; a greyed one says why, as its menu row would. */
function activate(el: HTMLElement, c: Parameters<typeof runCommand>[0]): void {
  if (el.classList.contains("off")) {
    const why = commandWhy(c);
    if (why) toast(why);
    return;
  }
  runCommand(c);
  refreshButtons();
}

/** The active layer as a drop-down of the drawing's design layers, with its sheets after a separator. */
function layer(label: string | undefined, offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-layer" });
  if (label) el.append(h("span", { cls: "lk-st-label", text: label }));
  const sel = h("select", { attrs: { "aria-label": label ?? "Active layer", translate: "no" } });
  el.append(sel);
  let signature = "";
  const fill = (): void => {
    const layers = store.session?.doc.layers() ?? [];
    // rebuild only when the list changed, so an open drop-down keeps its place
    const sig = layers.map((l) => `${l.id}\u0001${l.name}\u0001${l.kind}`).join("\u0002");
    if (sig !== signature) {
      signature = sig;
      const options: HTMLOptionElement[] = [];
      for (const l of layers.filter((x) => x.kind === "design")) options.push(option(l.id, l.name));
      const sheets = layers.filter((x) => x.kind === "sheet");
      if (sheets.length > 0 && options.length > 0) options.push(option("", "──────", true));
      for (const l of sheets) options.push(option(l.id, l.name));
      sel.replaceChildren(...options);
    }
    sel.value = store.activeLayerId ?? "";
    sel.disabled = sel.options.length === 0;
  };
  fill();
  offs.push(store.on(["session", "layer"], fill));
  sel.addEventListener("change", () => {
    if (sel.value) setActiveLayer(sel.value);
  });
  return el;
}

function option(value: string, text: string, separator = false): HTMLOptionElement {
  const o = h("option", { text, attrs: { value, translate: "no" } });
  if (separator) o.disabled = true;
  return o;
}
