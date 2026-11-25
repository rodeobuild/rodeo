// A look's status bar: one or more rows along the foot of the window. Rhino stacks an Osnap row of
// check boxes above its status row, AutoCAD keeps toggle words at the right, Revit has the hint at
// the left and the selection count at the right, SketchUp has a Measurements box. Every item reads
// Rodeo's own state and runs Rodeo's own commands (types.ts), so the bar only lays them out.

import { h } from "../dom.ts";
import { language, onLanguage, t } from "../i18n.ts";
import { dataBar } from "../databar.ts";
import { attempt, setActiveClass, setActiveLayer } from "../commands.ts";
import { appContext } from "../ext.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { freeName } from "../panels/common.ts";
import { planRotationDegrees, canRotatePlan, setPlanRotationDegrees } from "../planRotation.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import { toolDef } from "../toolbar.ts";
import { planOnScreen } from "../viewTargets.ts";
import { setZoomPercent } from "../viewbar.ts";
import { formatLength } from "../units.ts";
import { commandChecked, commandEnabled, commandIcon, commandWhy, lookIcon, refreshButtons, runCommand, track } from "./commands.ts";
import { currentSpec } from "./looks.ts";
import type { Command, LookButton, LookSpec, RibbonItem, StatusBarSpec, StatusItem } from "./types.ts";
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
    case "zoom":
      return zoomItem(offs);
    case "rotation":
      return rotationItem(offs);
    case "artboards":
      return artboardsItem(offs);
    case "tool":
      return toolItem(offs);
  }
}

// ---- zoom, rotation, artboards and the tool name (Illustrator's status bar) ----------------

/** A small glyph of a drop-down's arrow, in the box's colour. */
const DROP_ARROW = `<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2.5 3.5 5 6.5 7.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The zoom steps the drop-down offers, in per cent, as they are written. */
const ZOOM_STEPS = ["3.13", "6.25", "12.5", "25", "33.33", "50", "66.67", "100", "150", "200", "300", "400", "600", "800", "1200", "1600", "2400", "3200", "6400"];

/** A zoom as the View bar writes it: whole per cents from 10 %, two figures below. */
function percentText(scale: number): string {
  const pct = scale * 100;
  return `${pct >= 10 ? Math.round(pct) : pct.toPrecision(2)}%`;
}

/** A typed number as the boxes read it: "−45°" or "-45" both give -45. */
function typedDegrees(text: string): number {
  return Number(text.replace(/°$/, "").replace("−", "-").trim());
}

/** A menu row for a menu command by its path, greyed with its own reason as the menu greys it. */
function menuRow(label: string, path: string): Row {
  const c: Command = { menu: path };
  return { label, enabled: () => commandEnabled(c), why: () => commandWhy(c), run: () => runCommand(c) };
}

/**
 * The 2D zoom in a box, as the View bar's zoom field shows it: typed then Enter to set it, or picked
 * from its drop-down of steps. Empty while the 3D view is the one on screen.
 */
function zoomItem(offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-zoom" });
  const field = h("input", {
    cls: "lk-st-field",
    attrs: { type: "text", inputmode: "decimal", spellcheck: "false", "aria-label": "Zoom", translate: "no" },
  });
  const drop = h("button", {
    cls: "lk-st-drop",
    title: "Zoom options",
    html: DROP_ARROW,
    attrs: { type: "button", "aria-label": "Zoom options", "aria-haspopup": "menu" },
  });
  el.append(field, drop);
  // a box being typed in keeps what is typed until Enter, Escape or a click elsewhere
  const show = (force = false): void => {
    const view = appContext()?.view;
    const on = store.session !== null && planOnScreen() && !!view;
    field.readOnly = !on;
    const title = on ? "Zoom of the 2D plan, as a percentage: type one to set it" : "Zoom of the 2D plan: show the plan to set it";
    if (field.title !== title) field.title = title;
    if (force || document.activeElement !== field) field.value = on && view ? percentText(view.scale) : "";
  };
  show(true);
  field.addEventListener("focus", () => field.select());
  field.addEventListener("blur", () => show(true));
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const pct = parseFloat(field.value);
      if (Number.isFinite(pct) && pct > 0) setZoomPercent(pct);
      field.blur();
    } else if (e.key === "Escape") {
      show(true);
      field.blur();
    }
    e.stopPropagation();
  });
  drop.addEventListener("click", () => {
    const r = drop.getBoundingClientRect();
    const steps: Row[] = ZOOM_STEPS.map((p) => ({ label: `${p}%`, enabled: () => store.session !== null, run: () => setZoomPercent(Number(p)) }));
    openContextMenu([...steps, "-", menuRow("Fit Artboard on Screen", "View › Fit to Page Area"), menuRow("Fit All on Screen", "View › Fit to Window")], r.left, r.bottom);
  });
  offs.push(store.on(["view", "session", "view3d", "layer"], () => show()));
  return el;
}

/** The plan's rotation in a box, typed then Enter, or picked from its drop-down; greyed where the plan can't turn. */
function rotationItem(offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-rotation" });
  const field = h("input", {
    cls: "lk-st-field",
    attrs: { type: "text", inputmode: "decimal", spellcheck: "false", "aria-label": "Rotate View", translate: "no" },
  });
  const drop = h("button", {
    cls: "lk-st-drop",
    title: "Rotate View options",
    html: DROP_ARROW,
    attrs: { type: "button", "aria-label": "Rotate View options", "aria-haspopup": "menu" },
  });
  el.append(field, drop);
  const angles = [0, 15, 30, 45, 60, 90, 180, -15, -30, -45, -60, -90];
  const show = (force = false): void => {
    const on = canRotatePlan();
    const why = on ? "Rotate View" : store.session ? "Rotate View: make a design layer active to turn the plan" : "Rotate View: open a drawing first";
    el.classList.toggle("off", !on);
    el.title = why;
    field.title = why;
    field.readOnly = !on;
    field.setAttribute("aria-disabled", String(!on));
    if (force || document.activeElement !== field) field.value = `${Number(planRotationDegrees().toFixed(2))}°`;
  };
  show(true);
  field.addEventListener("focus", () => field.select());
  field.addEventListener("blur", () => show(true));
  field.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const deg = typedDegrees(field.value);
      if (Number.isFinite(deg)) setPlanRotationDegrees(deg);
      field.blur();
    } else if (e.key === "Escape") {
      show(true);
      field.blur();
    }
    e.stopPropagation();
  });
  drop.addEventListener("click", () => {
    const r = drop.getBoundingClientRect();
    const rows: Row[] = angles.map((d) => ({
      label: `${d < 0 ? "−" : ""}${Math.abs(d)}°`,
      enabled: canRotatePlan,
      run: () => setPlanRotationDegrees(d),
    }));
    rows.push("-", { label: "Reset Rotate View", enabled: canRotatePlan, run: () => setPlanRotationDegrees(0) });
    openContextMenu(rows, r.left, r.bottom);
  });
  offs.push(store.on(["view", "session", "layer", "view3d"], () => show()));
  return el;
}

/** Arrow glyphs for the artboard buttons: |◀ ◀ ▶ ▶|, drawn here as tiny shapes. */
const ARTBOARD_ICON = {
  first: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3 3h1.8v10H3z" fill="currentColor"/><path d="M12.5 3.5 7 8l5.5 4.5z" fill="currentColor"/></svg>`,
  previous: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M11.5 3.5 6 8l5.5 4.5z" fill="currentColor"/></svg>`,
  next: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M4.5 3.5 10 8l-5.5 4.5z" fill="currentColor"/></svg>`,
  last: `<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M3.5 3.5 9 8l-5.5 4.5z" fill="currentColor"/><path d="M12.2 3h1.8v10h-1.8z" fill="currentColor"/></svg>`,
  // a page with a plus, as on the Artboards panel's New Artboard button
  add: `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 1.5h6.5L13 5v9.5H3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 7v5M5.5 9.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
};

/** A new sheet layer (artboard), named as Illustrator numbers its artboards, made the active one: its page shows at once. */
function newArtboard(): void {
  const r = attempt("New Artboard", (s) => s.createLayer(freeName("Artboard"), "sheet", 1));
  if (r) setActiveLayer(r.value);
}

/** The drawing's sheet layers, in their order: the artboards. */
function sheetLayers(): readonly { readonly id: string; readonly name: string }[] {
  return (store.session?.doc.layers() ?? []).filter((l) => l.kind === "sheet");
}

/**
 * The sheet layers as pages: first, previous, a drop-down of them by number and name, next and
 * last. Each makes that sheet layer the active one; greyed with its reason while there are none.
 */
function artboardsItem(offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-artboards" });
  const none = "This drawing has no sheet layers yet";
  const sel = h("select", { cls: "lk-st-sheet", attrs: { "aria-label": "Active Artboard", translate: "no" } });
  sel.title = "Active Artboard";
  let signature = "";
  // the index of the active sheet, -1 while a design layer is active
  let cur = -1;
  // each arrow with its tooltip and the test that greys it (given the active index and the sheet count)
  const navs: { readonly btn: HTMLButtonElement; readonly title: string; readonly greyed: (c: number, n: number) => boolean }[] = [];
  const nav = (title: string, icon: string, to: (c: number) => number, greyed: (c: number, n: number) => boolean): void => {
    const btn = h("button", { cls: "lk-st-nav", title, html: icon, attrs: { type: "button", "aria-label": title } });
    btn.addEventListener("click", () => {
      if (btn.classList.contains("off")) return;
      const target = sheetLayers()[to(cur)];
      if (target) setActiveLayer(target.id);
    });
    navs.push({ btn, title, greyed });
    el.append(btn);
  };
  nav("First Artboard", ARTBOARD_ICON.first, () => 0, (c, n) => n === 0 || c === 0);
  nav("Previous Artboard", ARTBOARD_ICON.previous, (c) => c - 1, (c) => c <= 0);
  el.append(sel);
  nav("Next Artboard", ARTBOARD_ICON.next, (c) => c + 1, (c, n) => c >= n - 1);
  nav("Last Artboard", ARTBOARD_ICON.last, () => sheetLayers().length - 1, (c, n) => n === 0 || c === n - 1);
  // the one way to add an artboard here, as the Layers panel stands where Rodeo's Sheet Layers list is
  const add = h("button", { cls: "lk-st-nav lk-st-new", title: "New Artboard", html: ARTBOARD_ICON.add, attrs: { type: "button", "aria-label": "New Artboard" } });
  add.addEventListener("click", () => {
    if (store.session) newArtboard();
  });
  el.append(add);
  sel.addEventListener("change", () => {
    if (sel.value) setActiveLayer(sel.value);
  });
  const show = (): void => {
    const sheets = sheetLayers();
    cur = sheets.findIndex((l) => l.id === store.activeLayerId);
    // a drawing's design layer shows a blank first option, as the drop-down has no sheet to name
    const sig = sheets.map((l) => `${l.id}\u0001${l.name}`).join("\u0002") + (cur < 0 ? "\u0003blank" : "\u0003sheet");
    if (sig !== signature) {
      signature = sig;
      const options: HTMLOptionElement[] = [];
      if (cur < 0) options.push(option("", ""));
      sheets.forEach((l, i) => options.push(option(l.id, `${i + 1}  ${l.name}`)));
      sel.replaceChildren(...options);
    }
    sel.value = cur >= 0 ? (sheets[cur]?.id ?? "") : "";
    const empty = sheets.length === 0;
    sel.disabled = empty;
    add.classList.toggle("off", !store.session);
    sel.title = empty ? none : "Active Artboard";
    for (const { btn, title, greyed } of navs) {
      const off = empty || greyed(cur, sheets.length);
      btn.classList.toggle("off", off);
      btn.setAttribute("aria-disabled", String(off));
      btn.title = empty ? none : title;
    }
  };
  show();
  offs.push(store.on(["session", "layer"], show));
  return el;
}

/** The active tool's name in the look's own words: its toolbox, drawer or toolbar button for this tool and mode; else Rodeo's. */
function toolItem(offs: (() => void)[]): HTMLElement {
  const el = h("span", { cls: "lk-st-tool", title: "Current Tool", attrs: { "aria-label": "Current Tool" } });
  const show = (): void => {
    const name = toolName(store.tool);
    if (el.textContent !== name) el.textContent = name;
  };
  show();
  offs.push(store.on(["tool", "modes", "session"], show));
  return el;
}

/** Every button the current look shows, its drop-down buttons included. */
function everyLookButton(spec: LookSpec): LookButton[] {
  const out: LookButton[] = [];
  const add = (b: LookButton): void => {
    out.push(b);
    for (const m of b.more ?? []) add(m);
  };
  const addItem = (item: RibbonItem): void => {
    if ("label" in item) add(item);
    else item.forEach(add);
  };
  for (const g of spec.toolbox?.groups ?? []) g.buttons.forEach(add);
  spec.toolbox?.drawer?.buttons.forEach(add);
  for (const tab of spec.toolbars?.tabs ?? []) for (const b of tab.buttons) if (b !== "-") add(b);
  for (const tab of spec.ribbon?.tabs ?? []) {
    for (const panel of tab.panels) {
      panel.items.forEach(addItem);
      panel.extra?.forEach(addItem);
      if (panel.launcher) add(panel.launcher);
    }
  }
  spec.ribbon?.quickAccess?.forEach(add);
  return out;
}

/** The tool's name as the look writes it: the button for this tool in its mode, else one without a mode, else any; then Rodeo's label. */
function toolName(tool: ToolId): string {
  const same = everyLookButton(currentSpec()).filter((b) => "tool" in b.do && b.do.tool === tool);
  const modeOf = (c: Command): string | undefined => ("tool" in c ? c.mode : undefined);
  const best =
    same.find((b) => modeOf(b.do) !== undefined && commandChecked(b.do)) ??
    same.find((b) => modeOf(b.do) === undefined) ??
    same[0];
  return best?.label ?? toolDef(tool)?.label ?? String(tool);
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
