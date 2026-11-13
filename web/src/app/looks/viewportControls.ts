// View › Work Like › AutoCAD's drawing-area chrome, as AutoCAD 2025 draws it over the drawing: the
// viewport controls at its top-left ("[-][Top][2D Wireframe]": each bracketed word opens a menu, the
// middle one naming the view and the last the rendering), the navigation bar down the right edge
// under the view cube (Pan, Zoom Extents, Orbit, Zoom Window) and the UCS icon at the bottom-left.
// Every button runs one of Rodeo's own tools or menu commands. The icons are drawn here from what
// each command does. Only the words and the strip take clicks: the rest of the layer is see-through.

import { appContext } from "../ext.ts";
import { h } from "../dom.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { menuItemAt } from "../menubar.ts";
import { store } from "../state.ts";
import { RENDER_MODES, STANDARD_VIEWS } from "../viewbar.ts";
import type { RenderMode } from "../view3d.ts";
import { runCommand } from "./commands.ts";
import type { Command } from "./types.ts";
import "./viewportControls.css";

/** How often the view's name and rendering are read again while the 3D view turns (a cheap read). */
const POLL_MS = 300;

/** AutoCAD's names for the standard views, by Rodeo's preset; the others keep Rodeo's own. */
const VIEW_NAMES: Readonly<Record<string, string>> = {
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  // Rodeo's isometrics from above, by the corner the camera sits over (south is -y, as in Rodeo's views)
  iso: "SE Isometric",
  leftIso: "SW Isometric",
  rightRearIso: "NE Isometric",
  leftRearIso: "NW Isometric",
};

/** The rendering's name as AutoCAD's visual styles write it: Rodeo's Shaded is AutoCAD's Conceptual. */
const RENDER_NAMES: Readonly<Partial<Record<RenderMode, string>>> = {
  wireframe: "Wireframe",
  hidden: "Hidden",
  shaded: "Conceptual",
  realistic: "Realistic",
};

/** The menu of the view's name: AutoCAD's standard views, each the Rodeo row that is it. Top is the plan. */
const VIEW_ROWS: readonly (readonly [string, string])[] = [
  ["Top", "View › Standard Views › Top/Plan"],
  ["Bottom", "View › Standard Views › Bottom"],
  ["Left", "View › Standard Views › Left"],
  ["Right", "View › Standard Views › Right"],
  ["Front", "View › Standard Views › Front"],
  ["Back", "View › Standard Views › Back"],
  ["SW Isometric", "View › Standard Views › Left Isometric"],
  ["SE Isometric", "View › Standard Views › Right Isometric"],
  ["NE Isometric", "View › Standard Views › Right Rear Isometric"],
  ["NW Isometric", "View › Standard Views › Left Rear Isometric"],
];

/** The menu of the rendering: AutoCAD's visual styles, each the Rodeo row that draws it. */
const STYLE_ROWS: readonly (readonly [string, string])[] = [
  ["2D Wireframe", "View › Standard Views › Top/Plan"],
  ["Wireframe", "View › Rendering › Wireframe"],
  ["Hidden", "View › Rendering › Hidden Line"],
  ["Realistic", "View › Rendering › Realistic"],
  ["Conceptual", "View › Rendering › Shaded"],
];

/** A line icon in the navigation bar's style: 16 units, stroke currentColor. */
function icon(body: string): string {
  return `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** The navigation bar's buttons, top to bottom: pan, zoom extents, orbit, zoom window. */
const NAV_ICONS = {
  // four arrows meeting at a centre: the hand's work, drawn as a plain cross of arrows
  pan: icon(`<path d="M8 2v12M2 8h12"/><path d="M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2"/>`),
  // corners pointing out to the drawing's edges
  extents: icon(`<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/><rect x="5" y="5" width="6" height="6" stroke-dasharray="1.5 1.2"/>`),
  // an ellipse with an arrow going round it
  orbit: icon(`<ellipse cx="8" cy="8" rx="6" ry="3.2"/><path d="M13.6 4.6l.5 2.4-2.4-.3"/>`),
  // a dashed box with a lens over its corner
  window: icon(`<rect x="2" y="2" width="8" height="8" stroke-dasharray="2 1.5"/><circle cx="11.2" cy="11.2" r="2.8"/><path d="M13.2 13.2L15 15"/>`),
} as const;

/** The navigation bar's buttons: the Rodeo command each runs, its tooltip and its icon. */
const NAV: readonly { readonly title: string; readonly icon: string; readonly run: Command }[] = [
  { title: "Pan", icon: NAV_ICONS.pan, run: { tool: "pan" } },
  { title: "Zoom Extents", icon: NAV_ICONS.extents, run: { menu: "View › Fit to Objects" } },
  { title: "Orbit", icon: NAV_ICONS.orbit, run: { menu: "View › Rotate 3D View…" } },
  { title: "Zoom Window", icon: NAV_ICONS.window, run: { tool: "zoom" } },
];

/** The view's name now: AutoCAD's name for a standard view, "Custom View" for a turned one, "Top" in plan. */
export function viewName(): string {
  const ctx = appContext();
  if (!store.view3d || !ctx) return "Top";
  const v = ctx.view3d();
  if (!v) return "Top";
  const preset = v.standardViewOf(v.cameraState());
  if (!preset) return "Custom View";
  return VIEW_NAMES[preset] ?? STANDARD_VIEWS.find(([p]) => p === preset)?.[1] ?? "Custom View";
}

/** The rendering now: "2D Wireframe" in plan, else the 3D view's style in AutoCAD's words. */
export function renderingName(): string {
  if (!store.view3d) return "2D Wireframe";
  const mode = appContext()?.renderMode() ?? "shaded";
  return RENDER_NAMES[mode] ?? RENDER_MODES.find(([m]) => m === mode)?.[1] ?? "Shaded";
}

/** A menu row that runs the Rodeo menu command at `path`, checked and greyed as that row is. */
function rowAt(label: string, path: string): Row {
  return {
    label,
    checked: () => menuItemAt(path)?.checked?.() ?? false,
    enabled: () => menuItemAt(path)?.enabled?.() ?? true,
    run: () => runCommand({ menu: path }),
  };
}

/** The menu under "[-]": maximize the viewport, or a configuration of the panes. */
function minusRows(): Row[] {
  return [
    rowAt("Maximize Viewport", "View › Multiple View Panes › Single Pane"),
    { label: "Viewport Configuration List", items: [rowAt("Four Panes", "View › Multiple View Panes › Four Panes")] },
  ];
}

/** The menu under the view's name: AutoCAD's standard views. */
function viewRows(): Row[] {
  return VIEW_ROWS.map(([label, path]) => rowAt(label, path));
}

/** The menu under the rendering's name: AutoCAD's visual styles. */
function styleRows(): Row[] {
  return STYLE_ROWS.map(([label, path]) => rowAt(label, path));
}

/**
 * Mounts the viewport controls, the navigation bar and the UCS icon over the drawing in `into` (the
 * canvas's container): returns the call that takes them down again.
 */
export function mountViewportControls(into: HTMLElement): () => void {
  const minus = h("button", { cls: "vpc-btn", text: "[-]", attrs: { type: "button", "aria-label": "Viewport", title: "Viewport" } });
  const view = h("button", { cls: "vpc-btn", text: "[Top]", attrs: { type: "button", "aria-label": "View", title: "View" } });
  const style = h("button", { cls: "vpc-btn", text: "[2D Wireframe]", attrs: { type: "button", "aria-label": "Visual style", title: "Visual style" } });
  const words = h("div", { cls: "vpc-words" }, minus, view, style);

  const nav = h("div", { cls: "vpc-nav", attrs: { role: "toolbar", "aria-label": "Navigation" } });
  for (const b of NAV) {
    const btn = h("button", { cls: "vpc-nav-btn", html: b.icon, title: b.title, attrs: { type: "button", "aria-label": b.title } });
    btn.addEventListener("click", () => runCommand(b.run));
    nav.append(btn);
  }

  // the UCS icon: a corner with X to the right (red) and Y up (green), drawn from the corner
  const ucs = h("div", {
    cls: "vpc-ucs",
    html: `<svg viewBox="0 0 64 64" width="48" height="48" aria-hidden="true" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M8 56H52" stroke="#d43a3a"/><path d="M52 56l-6-3v6z" fill="#d43a3a" stroke="none"/>
      <text x="55" y="61" fill="#d43a3a" stroke="none" font-size="11" font-family="Segoe UI, system-ui, sans-serif">X</text>
      <path d="M8 56V14" stroke="#3aa64a"/><path d="M8 14l-3 6h6z" fill="#3aa64a" stroke="none"/>
      <text x="5" y="9" fill="#3aa64a" stroke="none" font-size="11" font-family="Segoe UI, system-ui, sans-serif">Y</text>
    </svg>`,
    attrs: { "aria-hidden": "true" },
  });

  const root = h("div", { cls: "vpc" }, words, nav, ucs);
  into.append(root);

  // the names read again: when the view or the rendering changes, and while the 3D view turns
  const refresh = (): void => {
    const v = viewName();
    const r = renderingName();
    if (view.textContent !== `[${v}]`) view.textContent = `[${v}]`;
    if (style.textContent !== `[${r}]`) style.textContent = `[${r}]`;
  };
  refresh();
  const offs = [store.on(["view3d", "viz3d", "session", "view"], refresh)];
  const timer = window.setInterval(refresh, POLL_MS);

  minus.addEventListener("click", () => {
    const r = minus.getBoundingClientRect();
    openContextMenu(minusRows(), r.left, r.bottom);
  });
  view.addEventListener("click", () => {
    const r = view.getBoundingClientRect();
    openContextMenu(viewRows(), r.left, r.bottom);
  });
  style.addEventListener("click", () => {
    const r = style.getBoundingClientRect();
    openContextMenu(styleRows(), r.left, r.bottom);
  });

  return () => {
    window.clearInterval(timer);
    for (const off of offs) off();
    root.remove();
  };
}
