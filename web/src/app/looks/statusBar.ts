// A look's status bar: one or more rows along the foot of the window. Rhino stacks an Osnap row of
// check boxes above its status row, AutoCAD keeps toggle words at the right, Revit has the hint at
// the left and the selection count at the right, SketchUp has a Measurements box. Every item reads
// Rodeo's own state and runs Rodeo's own commands (types.ts), so the bar only lays them out.

import { h } from "../dom.ts";
import { language, onLanguage, t } from "../i18n.ts";
import { dataBar } from "../databar.ts";
import { setActiveClass, setActiveLayer } from "../commands.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { formatLength } from "../units.ts";
import { commandIcon, commandWhy, lookIcon, refreshButtons, runCommand, track } from "./commands.ts";
import type { StatusBarSpec, StatusItem } from "./types.ts";
import "./statusBar.css";

const CHECK_MARK = `<svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true"><path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// a funnel: Revit's filter icon, drawn here as a plain line icon
const FILTER_ICON = lookIcon('<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>');

/**
 * Rodeo's hint, translated, as SketchUp writes its instructions: its parts (split by " · ") as
 * sentences, each ending in a full stop ("。" and no spaces in Japanese and Chinese).
 */
export function sentences(hint: string): string {
  const cjk = /^(ja|zh)/.test(language().code);
  const parts = t(hint)
    .split(" · ")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => (/[.!?。！？]$/.test(p) ? p : `${p}${cjk ? "。" : "."}`));
  return parts.join(cjk ? "" : " ");
}

/** The cursor's position as the status bar shows it, measured from the datum while one is set (as statusbar.ts does). */
function cursorText(style?: "xyz"): string {
  const s = store.session;
  // Rhino's readout shows the origin until the pointer first goes over the drawing
  const c = store.cursor ?? (style === "xyz" ? { x: 0, y: 0 } : null);
  if (!s || !c) return "";
  const units = s.doc.info.units;
  const d = store.datum;
  const x = formatLength(c.x - (d?.x ?? 0), units);
  const y = formatLength(c.y - (d?.y ?? 0), units);
  // the plan's cursor lies on the construction plane, so its z is 0
  const xy = style === "xyz" ? `X ${x}   Y ${y}   Z ${formatLength(0, units)}` : `X ${x}   Y ${y}`;
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

/** A look's own words for a hint's first part: its key as it is, else a key whose * stands for any words ("Click a * wall where…"). */
function promptFor(prompts: Readonly<Record<string, string>> | undefined, first: string): string | undefined {
  if (!prompts) return undefined;
  const exact = prompts[first];
  if (exact !== undefined) return exact;
  for (const [key, value] of Object.entries(prompts)) {
    if (!key.includes("*")) continue;
    const pattern = key.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".+");
    if (new RegExp(`^${pattern}$`).test(first)) return value;
  }
  return undefined;
}

/** One status item, kept current by the store topics it reads; its off-calls go into `offs`. Exported for side panels (sidePanel.ts). */
export function item(it: StatusItem, offs: (() => void)[]): HTMLElement {
  switch (it.kind) {
    case "hint": {
      const el = h("span", { cls: "lk-st-hint" });
      const show = (): void => {
        const own = promptFor(it.prompts, store.hint.split(" · ")[0]);
        const text = own ?? (it.style === "sentences" ? sentences(store.hint) : store.hint);
        el.textContent = text;
        el.title = text;
      };
      show();
      offs.push(store.on(["hint", "tool"], show));
      // the sentences are written already translated, so they are written again in a new language
      if (it.style === "sentences") offs.push(onLanguage(show));
      return el;
    }
    case "coords": {
      const el = h("span", { cls: "lk-st-coords" });
      if (it.label) el.append(h("span", { cls: "lk-st-label", text: it.label }));
      const value = h("span", { cls: "lk-st-coords-value" });
      el.append(value);
      const show = (): void => {
        value.textContent = cursorText(it.style);
      };
      show();
      offs.push(store.on(["cursor", "session", "datum"], show));
      return el;
    }
    case "toggle":
      return toggle(it);
    case "button": {
      // an icon-only button is drawn like a toggle's icon (22 px square, the label as its tooltip)
      const btn = it.iconOnly
        ? h("button", { cls: "lk-st-toggle lk-st-icon", title: it.label, html: it.icon ?? "", attrs: { type: "button", "aria-label": it.label } })
        : h("button", { cls: "lk-st-button", title: it.label, attrs: { type: "button", "aria-label": it.label } });
      if (!it.iconOnly) {
        if (it.icon) btn.append(h("span", { cls: "lk-st-icon", html: it.icon }));
        btn.append(h("span", { cls: "lk-st-label", text: it.label }));
      }
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
      return it.of === "class" ? classPicker(it, offs) : layer(it.label, offs);
    case "inert": {
      // a feature Rodeo lacks: its word greyed, the reason as its tooltip, nothing on a click
      if (!it.icon) return h("span", { cls: "lk-st-inert lk-st-text", text: it.label, attrs: { title: it.why, "aria-disabled": "true" } });
      // with an icon: drawn like a toggle, greyed, and a click says why
      const btn = h("button", { cls: "lk-st-toggle lk-st-icon lk-st-inert", title: it.why, html: it.icon, attrs: { type: "button", "aria-label": it.label, "aria-disabled": "true" } });
      btn.addEventListener("click", () => toast(it.why));
      return btn;
    }
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

/** The active class as a drop-down of the drawing's classes, with a square in its pen colour before its name (Rhino's status bar). */
function classPicker(it: Extract<StatusItem, { kind: "layer" }>, offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-layer" });
  if (it.label) el.append(h("span", { cls: "lk-st-label", text: it.label }));
  // a 10 by 10 square the class's pen colour fills, with a thin grey edge
  const swatch = h("span", { cls: "lk-st-swatch", attrs: { "aria-hidden": "true" } });
  swatch.style.cssText = "display:inline-block;width:10px;height:10px;box-sizing:border-box;border:1px solid #8a8a8a;flex:none";
  if (it.swatch) el.append(swatch);
  const sel = h("select", { attrs: { "aria-label": it.label ?? "Active class", translate: "no" } });
  el.append(sel);
  let signature = "";
  const fill = (): void => {
    const doc = store.session?.doc;
    const classes = doc?.classes() ?? [];
    // rebuild only when the list changed, so an open drop-down keeps its place
    const sig = classes.map((c) => `${c.index}\u0001${c.name}`).join("\u0002");
    if (sig !== signature) {
      signature = sig;
      sel.replaceChildren(...classes.map((c) => option(String(c.index), it.none && c.name === "None" ? it.none : c.name)));
    }
    sel.value = String(store.activeClassIndex);
    sel.disabled = classes.length === 0;
    const active = classes.find((c) => c.index === store.activeClassIndex);
    swatch.style.background = (active?.attrs && doc?.color(active.attrs.penFore)) || "transparent";
  };
  fill();
  offs.push(store.on(["session", "class"], fill));
  sel.addEventListener("change", () => {
    setActiveClass(Number(sel.value));
  });
  return el;
}

function option(value: string, text: string, separator = false): HTMLOptionElement {
  const o = h("option", { text, attrs: { value, translate: "no" } });
  if (separator) o.disabled = true;
  return o;
}
