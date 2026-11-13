// View › Work Like's view control bar, along the foot of the drawing. Revit's View Control Bar:
// the view's scale, Visual Style, Temporary Hide/Isolate and Reveal Hidden Elements. Archicad's
// Quick Options: the zoom as a percentage, the layer's scale, Model View and the zoom buttons. Every
// item runs one of Rodeo's own menu commands, or sets the layer's scale the way Rodeo's Active Layer
// Scale does (layerScale.ts), so the bar only lays them out.

import type { LayerInfo } from "../../core/types.ts";
import { attempt } from "../commands.ts";
import { h } from "../dom.ts";
import { activeLayerScaleDialog, canSetActiveLayerScale } from "../layerScale.ts";
import { menuButton, type Row } from "../menu.ts";
import { menuItemAt } from "../menubar.ts";
import { store } from "../state.ts";
import { runCommand } from "./commands.ts";
import type { Command } from "./types.ts";
import "./viewControl.css";

type Style = "revit" | "archicad";
type Refresh = () => void;

/** Revit's architectural scales: n of 1:n, and the words Revit writes for it. */
const ARCHITECTURAL: readonly (readonly [string, number])[] = [
  ['1/16" = 1\'-0"', 192],
  ['1/8" = 1\'-0"', 96],
  ['3/16" = 1\'-0"', 64],
  ['1/4" = 1\'-0"', 48],
  ['3/8" = 1\'-0"', 32],
  ['1/2" = 1\'-0"', 24],
  ['3/4" = 1\'-0"', 16],
  ['1" = 1\'-0"', 12],
  ['1-1/2" = 1\'-0"', 8],
  ['3" = 1\'-0"', 4],
];

/** The metric scales the menus offer, each n of 1:n. */
const METRIC: readonly number[] = [20, 50, 100, 200, 500, 1000];

const CARET = `<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M1.5 3 4 5.5 6.5 3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A 16-unit line icon in the bar's style (stroke currentColor), drawn here for these buttons. */
function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const ICON = {
  style: icon(`<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/>`),
  isolate: icon(`<rect x="2.5" y="2.5" width="11" height="11" stroke-dasharray="2 1.6"/><rect x="5.5" y="5.5" width="5" height="5" fill="currentColor" stroke="none"/>`),
  reveal: icon(`<path d="M1.8 8s2.3-4 6.2-4 6.2 4 6.2 4-2.3 4-6.2 4-6.2-4-6.2-4z"/><circle cx="8" cy="8" r="1.9"/>`),
  modelView: icon(`<rect x="2.5" y="3" width="11" height="10" rx="1"/><path d="M5 10.5 7.5 7.8l1.7 1.9 1.3-1.2 1.5 2"/>`),
  zoomIn: icon(`<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3 13.8 13.8M7 5v4M5 7h4"/>`),
  zoomOut: icon(`<circle cx="7" cy="7" r="4.5"/><path d="M10.3 10.3 13.8 13.8M5 7h4"/>`),
  fit: icon(`<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>`),
  previous: icon(`<path d="M5.5 4 2.5 7l3 3"/><path d="M2.5 7h6.5a3.5 3.5 0 0 1 0 7H7"/>`),
};

/** Revit's Visual Style rows, each the Rodeo menu command it runs (Consistent Colors has none, so it is left out). */
const STYLE_ROWS: readonly (readonly [string, string])[] = [
  ["Wireframe", "View › Rendering › Wireframe"],
  ["Hidden Line", "View › Rendering › Hidden Line"],
  ["Shaded", "View › Rendering › Shaded"],
  ["Realistic", "View › Rendering › Realistic"],
  ["Ray Trace", "View › Rendering › Path Traced"],
];

/** Archicad's Model View rows. */
const MODEL_VIEW_ROWS: readonly (readonly [string, string])[] = [
  ["Wireframe", "View › Rendering › Wireframe"],
  ["Hidden Line", "View › Rendering › Hidden Line"],
  ["Shaded", "View › Rendering › Shaded"],
];

/** The design layer that is active, or null when a sheet layer (or none) is. */
function activeDesign(): LayerInfo | null {
  const l = store.session?.doc.layers().find((x) => x.id === store.activeLayerId);
  return l?.kind === "design" ? l : null;
}

/** Whether the drawing's units are feet or inches, so Revit writes its architectural scales. */
function imperial(): boolean {
  const u = String(store.session?.doc.info.units ?? "").toLowerCase();
  return u.includes("feet") || u.includes("foot") || u.includes("inch");
}

/** A scale as the style writes it: Revit's words for an architectural scale on an imperial drawing, else "1 : n"; Archicad writes "1:n". */
function scaleLabel(style: Style, n: number): string {
  if (style === "revit") {
    if (imperial()) {
      const hit = ARCHITECTURAL.find(([, k]) => k === n);
      if (hit) return hit[0];
    }
    return `1 : ${n}`;
  }
  return `1:${n}`;
}

/** Sets the active design layer's scale through Rodeo's own scale change: one undo step, as Active Layer Scale does. */
function setLayerScale(n: number): void {
  const layer = activeDesign();
  if (!layer || layer.scale === n) return;
  attempt("Layer Scale", (s) =>
    s.batch(() => {
      s.setLayerScale(layer.id, n);
    }),
  );
}

/** The scale menu: common scales, then Other… for a typed one (Rodeo's Active Layer Scale dialog). */
function scaleRows(style: Style): Row[] {
  const list: readonly number[] = style === "revit" && imperial() ? ARCHITECTURAL.map(([, n]) => n) : METRIC;
  const rows: Row[] = list.map((n) => ({
    label: scaleLabel(style, n),
    checked: () => activeDesign()?.scale === n,
    enabled: () => activeDesign() !== null,
    run: () => setLayerScale(n),
  }));
  return [...rows, "-", { label: "Other…", enabled: canSetActiveLayerScale, run: () => void activeLayerScaleDialog() }];
}

/** Whether the command at `path` is in Rodeo's menus and applies now. */
function appliesAt(path: string): boolean {
  const it = menuItemAt(path);
  return !!it && (it.enabled?.() ?? true);
}

/** A menu row that runs the command at `path` (Rodeo's menu row, its check mark and greying), or null when there is no such command. */
function rowAt(label: string, path: string): Row | null {
  if (!menuItemAt(path)) return null;
  return {
    label,
    checked: () => menuItemAt(path)?.checked?.() ?? false,
    enabled: () => appliesAt(path),
    why: () => menuItemAt(path)?.why?.() ?? null,
    run: () => runCommand({ menu: path } satisfies Command),
  };
}

/** The rows of a drop-down, leaving out any whose command Rodeo doesn't have. */
function rowsOf(list: readonly (readonly [string, string])[]): Row[] {
  return list.map(([label, path]) => rowAt(label, path)).filter((r): r is Row => r !== null);
}

/** A flat bar button, with the icon and an optional word. */
function button(cls: string, html: string, title: string): HTMLButtonElement {
  return h("button", { cls: `lk-vc-btn ${cls}`, html, title, attrs: { type: "button", "aria-label": title } });
}

/** A button that drops a menu of `rows` (read as it opens): the icon, the word and a caret. */
function dropButton(html: string, title: string, rows: () => readonly Row[]): HTMLButtonElement {
  return menuButton(button("lk-vc-drop", `${html}<span class="lk-vc-caret">${CARET}</span>`, title), rows);
}

/** A button that runs the command at `path`; greyed while it doesn't apply, and it says why when pressed. */
function commandButton(html: string, title: string, path: string, refresh: Refresh[]): HTMLButtonElement {
  const btn = button("lk-vc-cmd", html, title);
  btn.addEventListener("click", () => runCommand({ menu: path } satisfies Command));
  refresh.push(() => btn.classList.toggle("off", !appliesAt(path)));
  return btn;
}

/** The thin rule between groups of items. */
function sep(): HTMLElement {
  return h("span", { cls: "lk-vc-sep" });
}

/** The scale drop-down: the active design layer's scale, greyed while a sheet layer is active. */
function scaleButton(style: Style, refresh: Refresh[]): HTMLButtonElement {
  const text = h("span", { cls: "lk-vc-text" });
  const btn = dropButton("", style === "revit" ? "View Scale" : "Scale", () => scaleRows(style));
  btn.prepend(text);
  refresh.push(() => {
    const l = activeDesign();
    text.textContent = l ? scaleLabel(style, l.scale) : "";
    btn.disabled = !l;
    btn.classList.toggle("off", !l);
  });
  return btn;
}

/** Revit's items, left to right: View Scale, Visual Style, Temporary Hide/Isolate, Reveal Hidden Elements. */
function revitItems(refresh: Refresh[]): HTMLElement[] {
  const items: (HTMLElement | null)[] = [scaleButton("revit", refresh)];
  const styles = rowsOf(STYLE_ROWS);
  if (styles.length) items.push(sep(), dropButton(ICON.style, "Visual Style", () => rowsOf(STYLE_ROWS)));
  const hide = rowsOf([
    ["Isolate Element", "View › Show Selected Objects Only"],
    ["Reset Temporary Hide/Isolate", "View › Unhide Objects"],
  ]);
  if (hide.length) items.push(sep(), dropButton(ICON.isolate, "Temporary Hide/Isolate", () => hide));
  if (menuItemAt("View › Unhide Objects")) {
    items.push(sep(), commandButton(ICON.reveal, "Reveal Hidden Elements", "View › Unhide Objects", refresh));
  }
  return items.filter((x): x is HTMLElement => x !== null);
}

/** Archicad's items, left to right: zoom, scale, Model View, then the zoom buttons. */
function archicadItems(refresh: Refresh[]): HTMLElement[] {
  const zoom = h("span", { cls: "lk-vc-zoom", title: "Zoom of the 2D plan" });
  refresh.push(() => {
    // the zoom Rodeo shows in its top bar (viewbar.ts): empty while the 3D view is the one on screen
    const field = document.querySelector<HTMLInputElement>("#vb-zoom .zoom-field");
    zoom.textContent = store.view3d ? "" : (field?.value ?? "");
  });
  const items: (HTMLElement | null)[] = [
    zoom,
    scaleButton("archicad", refresh),
    sep(),
    dropButton(`${ICON.modelView}<span class="lk-vc-label">Model View</span>`, "Model View", () => rowsOf(MODEL_VIEW_ROWS)),
    sep(),
    menuItemAt("View › Zoom In") ? commandButton(ICON.zoomIn, "Zoom In", "View › Zoom In", refresh) : null,
    menuItemAt("View › Zoom Out") ? commandButton(ICON.zoomOut, "Zoom Out", "View › Zoom Out", refresh) : null,
    menuItemAt("View › Fit to Window") ? commandButton(ICON.fit, "Fit in Window", "View › Fit to Window", refresh) : null,
    menuItemAt("View › Previous View") ? commandButton(ICON.previous, "Previous Zoom", "View › Previous View", refresh) : null,
  ];
  return items.filter((x): x is HTMLElement => x !== null);
}

/** Fills `into` with the view's control bar: Revit's View Control Bar or Archicad's Quick Options. Returns the call that takes it down. */
export function mountViewControl(into: HTMLElement, style: Style): () => void {
  const refresh: Refresh[] = [];
  const items = style === "revit" ? revitItems(refresh) : archicadItems(refresh);
  const bar = h("div", {
    cls: "lk-viewcontrol",
    attrs: { role: "toolbar", "aria-label": style === "revit" ? "View Control Bar" : "Quick Options", "data-style": style },
  });
  bar.append(...items);
  const update = (): void => {
    for (const f of refresh) f();
  };
  const offs = [store.on(["session", "layer", "view", "view3d", "selection", "tool", "display"], update)];
  update();
  into.append(bar);
  return () => {
    for (const off of offs) off();
    bar.remove();
  };
}
