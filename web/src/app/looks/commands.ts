// What a look's buttons, keys and typed commands do, and the button every look's ribbon, toolbars,
// toolbox and status bar build from. A Command runs one of Rodeo's tools or menu commands, shows a
// palette, or runs code (types.ts). Buttons light up while their tool is the active one, their
// menu row is checked or their palette shows, and grey out while their menu row is off.

import { h } from "../dom.ts";
import { PALETTE_ICON, TOOL_ICON, UI_ICON } from "../icons.ts";
import { menuItemAt, runMenuCommand } from "../menubar.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import type { Command, LookButton } from "./types.ts";

/** What the commands reach: set once by the engine (looks.ts) as the editor starts. */
export interface LookDeps {
  setTool(id: ToolId): void;
  /** shows a closed palette, closes an open one */
  togglePalette(id: string): void;
  paletteShown(id: string): boolean;
}

let deps: LookDeps | null = null;

export function setLookDeps(d: LookDeps): void {
  deps = d;
}

/** A 24-unit line icon in Rodeo's style (stroke = currentColor), for a look's own icons. Draw your own: never trace another application's. */
export function lookIcon(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Runs a command. A menu command that doesn't apply now says why, as its greyed row would. */
export function runCommand(c: Command): void {
  if ("tool" in c) {
    deps?.setTool(c.tool);
  } else if ("menu" in c) {
    const item = menuItemAt(c.menu);
    if (!item) {
      console.warn(`Work Like: no menu command at "${c.menu}"`);
      return;
    }
    if (item.enabled && !item.enabled()) {
      const why = item.why?.();
      if (why) toast(why);
      return;
    }
    runMenuCommand(c.menu);
  } else if ("palette" in c) {
    deps?.togglePalette(c.palette);
  } else {
    c.run();
  }
}

/** Whether a command's button shows lit: its tool active, its menu row checked, its palette shown. */
export function commandChecked(c: Command): boolean {
  if ("tool" in c) return store.tool === c.tool;
  if ("menu" in c) return menuItemAt(c.menu)?.checked?.() ?? false;
  if ("palette" in c) return deps?.paletteShown(c.palette) ?? false;
  return c.checked?.() ?? false;
}

/** Whether a command can run now (a menu row that is off can't). */
export function commandEnabled(c: Command): boolean {
  if ("menu" in c) {
    const item = menuItemAt(c.menu);
    return !!item && (item.enabled?.() ?? true);
  }
  return true;
}

/** Why a command can't run now, as its menu row says. */
export function commandWhy(c: Command): string | null {
  if (!("menu" in c)) return null;
  const item = menuItemAt(c.menu);
  return item ? (item.why?.() ?? null) : null;
}

// Icons for the menu commands toolbars and Quick Access Toolbars carry most (New, Open, Save, Undo,
// Cut, Copy…), whose menu rows have none of their own. Rodeo's where it has one, else a plain line
// icon drawn here in its style.
const PAGE = '<path d="M6 3.5h8l4 4V20a.5.5 0 01-.5.5h-11A.5.5 0 016 20V4a.5.5 0 01.5-.5z"/><path d="M14 3.5V8h4"/>';
const SQUARES = '<rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/>';
const EYE = '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.5"/>';
const CIRCLES = '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/>';
const MENU_ICON: Readonly<Record<string, string>> = {
  "File › New": lookIcon(PAGE + '<path d="M12 11v6M9 14h6"/>'),
  "File › Open…": UI_ICON.open,
  "File › Save": UI_ICON.save,
  "File › Save As…": lookIcon('<path d="M5 4h9l3 3v4M5 4v15a1 1 0 001 1h5M8 4v4h6"/><path d="M14 20l1-3 5-5 2 2-5 5z"/>'),
  "File › Print…": lookIcon('<path d="M7 9V3.5h10V9M7 17H4.5a1 1 0 01-1-1v-6a1 1 0 011-1h15a1 1 0 011 1v6a1 1 0 01-1 1H17"/><rect x="7" y="14" width="10" height="6.5"/>'),
  "File › Close": lookIcon(PAGE + '<path d="M9.5 12.5l5 5M14.5 12.5l-5 5"/>'),
  "Edit › Undo": UI_ICON.undo,
  "Edit › Redo": UI_ICON.redo,
  "Edit › Cut": lookIcon('<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.5 16 18 4M15.5 16 6 4"/>'),
  "Edit › Copy": lookIcon('<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'),
  "Edit › Paste": lookIcon('<path d="M9 4.5H6a1 1 0 00-1 1V20a1 1 0 001 1h12a1 1 0 001-1V5.5a1 1 0 00-1-1h-3"/><rect x="9" y="3" width="6" height="3" rx="1"/><path d="M9 11h6M9 15h6"/>'),
  "Edit › Delete": lookIcon('<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10.5 11v5.5M13.5 11v5.5"/>'),
  "Edit › Duplicate": lookIcon(SQUARES),
  "Edit › Select All": lookIcon('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2.5 2.5"/><path d="M10 9l6 3-2.6 1 1.6 3-1.4.7-1.6-3L10 15z"/>'),
  "Edit › Select None": lookIcon('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2.5 2.5"/>'),
  "Edit › Invert Selection": lookIcon('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2.5 2.5"/><path d="M8 16 16 8"/>'),
  "View › Fit to Window": UI_ICON.fit,
  "View › Zoom In": UI_ICON.zoomIn,
  "View › Zoom Out": UI_ICON.zoomOut,
  "View › Zoom to Selection": UI_ICON.zoomSel,
  "View › 3D View": UI_ICON.cube,
  "View › Projection › 2D Plan": UI_ICON.plan,
  "View › Show Grid": UI_ICON.gridShow,
  "View › Snap to Grid": UI_ICON.snapGrid,
  "View › Snap to Objects": UI_ICON.snapObjects,
  "View › Zoom Line Thickness": lookIcon('<path d="M4 6h16" stroke-width="1"/><path d="M4 12h16" stroke-width="2.2"/><path d="M4 18h16" stroke-width="3.6"/>'),
  "View › Hide Selected Objects": lookIcon(EYE + '<path d="M4 20 20 4"/>'),
  "View › Unhide Objects": lookIcon(EYE),
  "View › Show Selected Objects Only": lookIcon('<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><rect x="9.5" y="9.5" width="5" height="5"/>'),
  "View › Object Visibility…": UI_ICON.classes,
  "View › Render Studio": UI_ICON.render,
  "View › Create Viewport…": lookIcon('<rect x="3.5" y="5" width="17" height="14" rx="1"/><rect x="7" y="8.5" width="10" height="7"/>'),
  "Modify › Group": lookIcon('<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="7.5" y="7.5" width="5" height="5"/><rect x="11.5" y="11.5" width="5" height="5"/>'),
  "Modify › Ungroup": lookIcon('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/><path d="M12 12l-1.5-1.5M13.5 13.5 12 12"/>'),
  "Modify › Create Symbol…": lookIcon('<path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8z"/><path d="M3.5 8 12 12.5 20.5 8M12 12.5v8"/>'),
  "Modify › Edit Symbol": lookIcon('<path d="M12 3.5 20.5 8v5M12 20.5 3.5 16V8L12 3.5M3.5 8 12 12.5l6-3.2"/><path d="M14 20l1-3 4-4 2 2-4 4z"/>'),
  "Modify › Scale Objects…": lookIcon('<rect x="4" y="12" width="8" height="8"/><path d="M12 12l8-8M14.5 4H20v5.5"/>'),
  "Modify › Move…": TOOL_ICON.moveby,
  "Modify › Duplicate Array…": lookIcon('<rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/>'),
  "Modify › Align › Align/Distribute…": lookIcon('<path d="M4 3.5v17"/><rect x="7" y="6" width="12" height="4"/><rect x="7" y="14" width="7" height="4"/>'),
  "Modify › Rotate 3D…": TOOL_ICON.rotate,
  "Modify › Hatch…": TOOL_ICON.hatch,
  "Modify › Decompose": lookIcon('<path d="M4 18 10 6M14 6l6 12M7 20h4M13 20h4"/>'),
  "Modify › Join › Join": lookIcon('<path d="M4 18 11 11M13 11l7-7"/><circle cx="12" cy="10.5" r="1.5"/>'),
  "Model › Add Solids": lookIcon(CIRCLES),
  "Model › Subtract Solids": lookIcon('<circle cx="9" cy="12" r="5.5"/><path d="M14.5 6.6A5.5 5.5 0 1115 17.4" stroke-dasharray="2 2"/>'),
  "Model › Intersect Solids": lookIcon(CIRCLES + '<path d="M12 7.6a5.5 5.5 0 010 8.8 5.5 5.5 0 010-8.8z" fill="currentColor" fill-opacity=".25"/>'),
  "Model › Extrude…": TOOL_ICON.pushpull,
  "Tools › Reports › Create Report…": lookIcon('<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 9h17M3.5 13.5h17M9 9v10.5"/>'),
  "Tools › Custom Selection…": lookIcon('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M8 8h5M8 13h3"/>'),
  "View › Create Section Viewport…": lookIcon('<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9l8-5 8 5M2.5 14h19" stroke-dasharray="3 2"/>'),
  "View › Create Interior Elevation Viewport…": lookIcon('<path d="M3.5 20.5h17M5 20.5V9l7-5 7 5v11.5"/><rect x="9.5" y="13" width="5" height="7.5"/>'),
  "AEC › Create Roof…": lookIcon('<path d="M2.5 12.5 12 5l9.5 7.5M5 10.5V19h14v-8.5"/>'),
  "Window › Palettes › Classes": UI_ICON.classes,
  "Window › Palettes › Sheet Layers": UI_ICON.layers,
};

/** The icon for a menu command, from the table above or by the kind of submenu it sits in. */
function menuIcon(path: string): string | null {
  const own = MENU_ICON[path];
  if (own) return own;
  if (path.startsWith("View › Rendering ›")) return UI_ICON.render;
  if (path.startsWith("View › Standard Views ›")) return UI_ICON.standardViews;
  if (path.startsWith("View › Multiple View Panes ›")) return UI_ICON.viewPanes;
  if (path.startsWith("View › Projection ›")) return UI_ICON.projection;
  if (path.startsWith("Modify › Working Plane ›")) return UI_ICON.workingPlane;
  if (path.startsWith("File › Export ›")) return lookIcon(PAGE + '<path d="M12 18v-7M9 14l3-3 3 3"/>');
  if (path.startsWith("File › Import ›")) return lookIcon(PAGE + '<path d="M12 11v7M9 15l3 3 3-3"/>');
  return null;
}

/** A command's icon: the button's own, else its tool's, else its palette's, else its menu row's, else the label's initials. */
export function commandIcon(b: Pick<LookButton, "icon" | "label" | "do">): string {
  if (b.icon) return b.icon;
  const c = b.do;
  if ("tool" in c && TOOL_ICON[c.tool]) return TOOL_ICON[c.tool];
  if ("palette" in c && c.palette in PALETTE_ICON) return PALETTE_ICON[c.palette as keyof typeof PALETTE_ICON];
  if ("menu" in c) {
    const icon = menuItemAt(c.menu)?.icon ?? menuIcon(c.menu);
    if (icon) return icon;
  }
  const words = b.label.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).replace(/[&<>"]/g, "");
  return `<span class="lk-initials" aria-hidden="true">${letters}</span>`;
}

/** Plural names of Rodeo's object kinds, for a contextual tab's title ("Modify | Walls"). */
const KIND_NAMES: Readonly<Record<string, string>> = {
  wall: "Walls",
  door: "Doors",
  window: "Windows",
  slab: "Slabs",
  group: "Groups",
  symbol: "Symbols",
  text: "Text",
  dimension: "Dimensions",
  viewport: "Viewports",
  image: "Images",
  extrude: "Extrudes",
  mesh: "Meshes",
};

/** What is selected, as a contextual tab names it: one kind's plural name ("Walls"), "Multi-Select" for a mix, "" for nothing. */
export function selectionKind(): string {
  const doc = store.session?.doc;
  if (!doc || store.selection.size === 0) return "";
  const kinds = new Set<string>();
  for (const id of store.selection) {
    const o = doc.object(id);
    // the record's own type ("wall", "rounded-rectangle"), which says more than the shape's kind
    kinds.add(o?.typeName || o?.kind || "object");
  }
  if (kinds.size > 1) return "Multi-Select";
  const [kind] = kinds;
  if (KIND_NAMES[kind]) return KIND_NAMES[kind];
  const words = kind.replace(/[-_]/g, " ").replace(/\b3d\b/gi, "3D");
  const name = words.charAt(0).toUpperCase() + words.slice(1);
  return /(s|x|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`;
}

/** The text of a key for a tooltip: "Line (L)". */
function tipOf(b: LookButton): string {
  return b.keys ? `${b.label} (${b.keys})` : b.label;
}

/** The buttons on screen, re-read as the tool, selection, snapping or view change. */
const live = new Set<{ el: HTMLElement; c: Command }>();
let watching = false;

function refresh(): void {
  for (const entry of live) {
    if (!entry.el.isConnected) {
      live.delete(entry);
      continue;
    }
    entry.el.classList.toggle("on", commandChecked(entry.c));
    const enabled = commandEnabled(entry.c);
    entry.el.classList.toggle("off", !enabled);
    entry.el.setAttribute("aria-disabled", String(!enabled));
  }
}

function watch(): void {
  if (watching) return;
  watching = true;
  store.on(["tool", "selection", "snap", "view", "session", "layer", "class", "display", "modes"], refresh);
  // a palette shown or closed, a menu row's state changed by a dialog: read again after any click
  window.addEventListener("pointerup", () => requestAnimationFrame(refresh));
}

/** Lights and greys a button as its command's state changes. */
export function track(el: HTMLElement, c: Command): void {
  watch();
  live.add({ el, c });
  el.classList.toggle("on", commandChecked(c));
  el.classList.toggle("off", !commandEnabled(c));
}

/** Reads every look button's state again now. */
export function refreshButtons(): void {
  refresh();
}

/**
 * A look's button: `.lk-btn` with its icon (`.lk-btn-icon`) and, unless `iconOnly`, its label
 * (`.lk-btn-label`); `.lk-large` or `.lk-small` for a ribbon's sizes; `.on` while lit, `.off` while
 * its command can't run. A button with `more` gets a caret (`.lk-btn-more`) that drops the rest.
 */
export function lookButton(b: LookButton, opts: { iconOnly?: boolean; size?: "large" | "small" } = {}): HTMLElement {
  const size = opts.size ?? b.size;
  const btn = h("button", {
    cls: `lk-btn${size ? ` lk-${size}` : ""}${opts.iconOnly ? " lk-icon-only" : ""}`,
    title: tipOf(b),
    attrs: { type: "button", "aria-label": b.label },
  });
  btn.append(h("span", { cls: "lk-btn-icon", html: commandIcon(b) }));
  if (!opts.iconOnly) btn.append(h("span", { cls: "lk-btn-label", text: b.label }));
  btn.addEventListener("click", () => {
    if (btn.classList.contains("off")) {
      const why = commandWhy(b.do);
      if (why) toast(why);
      return;
    }
    runCommand(b.do);
    refresh();
  });
  track(btn, b.do);
  if (!b.more?.length) return btn;
  const caret = h("button", { cls: "lk-btn-more", title: `More: ${b.label}`, attrs: { type: "button", "aria-label": `More: ${b.label}`, "aria-haspopup": "menu" } });
  caret.innerHTML = `<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  caret.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = caret.getBoundingClientRect();
    void import("../menu.ts").then(({ openContextMenu }) =>
      openContextMenu(
        b.more!.map((m) => ({ label: m.label, icon: commandIcon(m), checked: () => commandChecked(m.do), enabled: () => commandEnabled(m.do), run: () => runCommand(m.do) })),
        r.left,
        r.bottom,
      ),
    );
  });
  return h("span", { cls: `lk-split${size ? ` lk-${size}` : ""}` }, btn, caret);
}
