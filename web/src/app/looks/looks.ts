// View › Work Like: Rodeo laid out as another application its users already know, so they can
// start drawing without learning a new interface: Rhino, SketchUp, Revit, Archicad, AutoCAD or
// Vectorworks, or Rodeo's own. A look (types.ts) brings that application's menu bar and what is in
// each menu, its words for things, where its panels sit, its ribbon, toolbars, toolbox, command
// line and status bar, its keys and two-key shortcuts, how its mouse moves the 3D view and the
// colours of its chrome and drawing area, its layer table or project browser, the bars under its
// drawing and its grid. Everything still runs Rodeo's own tools and commands, with Rodeo's own
// icons (line icons, or the coloured set in glyphs/ drawn for Rodeo).
//
// The chosen look is kept per browser. Each look keeps its own palette arrangement, theme and view
// panes: moving a palette while working like Revit changes Revit's, and Rodeo's comes back as it
// was on the way back to Rodeo. The look's rows sit in slots round the drawing that this module
// makes once (#lk-title, #lk-top, #lk-left, #lk-right, #lk-bottom); a look's stylesheet, scoped to
// :root[data-look="<id>"], does the rest. On a phone (760 px or less) Rodeo's own touch layout
// stays whatever the look.

import "./looks.css";
import type { Palettes, TopGroupId } from "../dock.ts";
import { h } from "../dom.ts";
import { setTerms } from "../i18n.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { setLookMenus } from "../menuLayout.ts";
import { setPaper } from "../renderer.ts";
import { setGrid, store, type ToolId } from "../state.ts";
import { setTheme, theme, type Theme } from "../theme.ts";
import { paneArrangement, readPaneArrangement, setPaneArrangement, setPaneNames } from "../viewPanes.ts";
import { setLookCanvas } from "./canvasLook.ts";
import { lookButton, refreshButtons, runCommand, setGlyphs, setLookDeps } from "./commands.ts";
import { setLookView } from "./viewLook.ts";
import { mountTray } from "./tray.ts";
import type { Command, LookId, LookSpec } from "./types.ts";

/** The looks in the menu's order: Rodeo, then the others by name. */
export const LOOKS: readonly { readonly id: LookId; readonly name: string; readonly load: () => Promise<LookSpec> }[] = [
  { id: "rodeo", name: "Rodeo", load: async () => RODEO },
  { id: "archicad", name: "Archicad", load: () => import("./archicad.ts").then((m) => m.look) },
  { id: "autocad", name: "AutoCAD", load: () => import("./autocad.ts").then((m) => m.look) },
  { id: "revit", name: "Revit", load: () => import("./revit.ts").then((m) => m.look) },
  { id: "rhino", name: "Rhino", load: () => import("./rhino.ts").then((m) => m.look) },
  { id: "sketchup", name: "SketchUp", load: () => import("./sketchup.ts").then((m) => m.look) },
  { id: "vectorworks", name: "Vectorworks", load: () => import("./vectorworks.ts").then((m) => m.look) },
];

/** Rodeo's own: nothing swapped, the arrangement the person keeps. */
const RODEO: LookSpec = {
  id: "rodeo",
  name: "Rodeo",
  theme: "dark",
  menus: null,
  terms: {},
  palettes: {},
  topBar: true,
  menuBar: false,
  modeBar: "hud",
  viewBar: "hud",
  snapPill: true,
  rails: true,
  mouse: { middle: "zoom", right: "pan" },
};

const KEY = "openvwx.look";
/** each look's own arrangement, theme and view panes, kept as it is left */
const SAVED_KEY = "openvwx.look.saved.v1";
/** the look last put on at its start without being chosen here (installLooks) */
const STARTED_KEY = "openvwx.look.started";
/** a phone keeps Rodeo's touch layout whatever the look (looks.css has the same width) */
const PHONE_QUERY = "(max-width: 760px)";
/** how long the second key of a two-key shortcut may wait */
const SEQUENCE_MS = 1100;

interface Saved {
  layout: unknown;
  theme: Theme;
  panes: unknown;
  /** the 2D grid shown or not (Revit, Archicad and SketchUp start without one) */
  grid?: boolean;
}

/** What the engine reaches in the editor (app.ts gives it as it starts). */
export interface LookHost {
  readonly palettes: Palettes;
  setTool(id: ToolId): void;
  /** picks one of the active tool's modes, as its Mode bar button does */
  setToolMode(mode: string): void;
  /** the active tool's modes now, one per group */
  toolModes(): readonly string[];
  /** the menus as they stand (a look's when one is on) */
  menus(): readonly { readonly title: string; readonly rows: readonly Row[] }[];
}

/** What a look's chrome part leaves behind: the call that takes it down again. */
type Unmount = () => void;

/** The command line on screen, which takes letters typed over the drawing. */
export interface CommandLineHandle {
  /** takes a letter, digit or sign typed over the drawing before Rodeo's own keys and tools see it; true when it used it */
  type(e: KeyboardEvent): boolean;
  /** takes a key typed over the drawing that nothing else used (Enter repeats the last command); true when it used it */
  key(e: KeyboardEvent): boolean;
  /** Space over the drawing: answers the prompt or repeats the last command; true when it did */
  space(): boolean;
  /** Escape over the drawing: ends a command asking for a selection or an option; true when one was */
  escape(): boolean;
  /** shows the command line when it is hidden, hides it when shown (its × button, Ctrl+9) */
  toggle(): void;
  unmount(): void;
}

let host: LookHost | null = null;
let current: LookId = stored();
let spec: LookSpec = RODEO;
let parts: Unmount[] = [];
let commandLine: CommandLineHandle | null = null;
/** the keys of a two-key shortcut typed so far, and when the last came */
let typed = "";
let typedAt = 0;
let switching: Promise<void> = Promise.resolve();

function stored(): LookId {
  try {
    const id = localStorage.getItem(KEY);
    return LOOKS.some((l) => l.id === id) ? (id as LookId) : "rodeo";
  } catch {
    // storage blocked: Rodeo's own
    return "rodeo";
  }
}

/** Reads a key kept in this browser, or writes it when given a value (storage blocked: nothing kept). */
function localStore(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    // storage blocked
  }
  return null;
}

function readSaved(): Partial<Record<LookId, Saved>> {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "null") as unknown;
    return raw && typeof raw === "object" ? (raw as Partial<Record<LookId, Saved>>) : {};
  } catch {
    return {};
  }
}

function writeSaved(all: Partial<Record<LookId, Saved>>): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: the arrangements last for this visit
  }
}

/** The look on now. */
export function currentLook(): LookId {
  return current;
}

/** The look on now, its whole spec (Rodeo's while it is Rodeo). */
export function currentSpec(): LookSpec {
  return spec;
}

// ---- the slots round the drawing --------------------------------------------------------

interface Slots {
  title: HTMLElement;
  top: HTMLElement;
  ribbon: HTMLElement;
  cmdTop: HTMLElement;
  toolbars: HTMLElement;
  options: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  bottom: HTMLElement;
  cmdBottom: HTMLElement;
  /** under the drawing beside or over the status bar: Revit's View Control Bar, Archicad's Quick Options, AutoCAD's layout tabs */
  foot: HTMLElement;
  status: HTMLElement;
}

let slots: Slots | null = null;

/** Makes the slots once: a title row over everything, rows under the top bar, columns either side of the workspace and rows along the foot. */
function makeSlots(): Slots {
  if (slots) return slots;
  const app = document.querySelector<HTMLElement>(".app")!;
  const topbar = document.getElementById("topbar")!;
  const workspace = document.getElementById("workspace")!;
  const slot = (id: string, cls: string): HTMLElement => h("div", { cls: `lk-slot ${cls}`, attrs: { id } });
  const s: Slots = {
    title: slot("lk-title", "lk-title-slot"),
    top: slot("lk-top", "lk-top-slot"),
    ribbon: slot("lk-ribbon", "lk-ribbon-slot"),
    cmdTop: slot("lk-cmd-top", "lk-cmd-slot"),
    toolbars: slot("lk-toolbars", "lk-toolbars-slot"),
    options: slot("lk-options", "lk-options-slot"),
    left: slot("lk-left", "lk-side-slot"),
    right: slot("lk-right", "lk-side-slot"),
    bottom: slot("lk-bottom", "lk-bottom-slot"),
    cmdBottom: slot("lk-cmd-bottom", "lk-cmd-slot"),
    foot: slot("lk-foot", "lk-foot-slot"),
    status: slot("lk-status", "lk-status-slot"),
  };
  s.top.append(s.ribbon, s.cmdTop, s.toolbars, s.options);
  s.bottom.append(s.cmdBottom, h("div", { cls: "lk-foot-row" }, s.foot, s.status));
  app.prepend(s.title);
  topbar.after(s.top);
  const row = h("div", { cls: "lk-row" });
  workspace.replaceWith(row);
  row.append(s.left, workspace, s.right);
  row.after(s.bottom);
  slots = s;
  return s;
}

/** Where a moved bar came from, to put it back. */
const homes = new Map<HTMLElement, { parent: Node; next: Node | null }>();

function moveInto(el: HTMLElement | null, into: HTMLElement): void {
  if (!el) return;
  if (!homes.has(el) && el.parentNode) homes.set(el, { parent: el.parentNode, next: el.nextSibling });
  into.append(el);
}

function putBack(el: HTMLElement | null): void {
  const home = el && homes.get(el);
  if (!el || !home) return;
  home.parent.insertBefore(el, home.next && home.next.parentNode === home.parent ? home.next : null);
  homes.delete(el);
}

// ---- the title bar ------------------------------------------------------------------------

/** The title row: the application button and Quick Access Toolbar at its start, the file's name in its middle. */
function mountTitle(into: HTMLElement, look: LookSpec): Unmount {
  const appBtn = h("button", { cls: "lk-app-btn", title: "File", attrs: { type: "button", "aria-label": "File" } });
  appBtn.innerHTML = `<img src="/icon.svg" alt="" width="18" height="18" />`;
  appBtn.addEventListener("click", () => {
    const r = appBtn.getBoundingClientRect();
    openLookMenu("File", r.left, r.bottom);
  });
  const qat = h("div", { cls: "lk-qat", attrs: { role: "toolbar", "aria-label": "Quick Access Toolbar" } });
  for (const b of look.ribbon?.quickAccess ?? []) qat.append(lookButton(b, { iconOnly: true }));
  const name = h("span", { cls: "lk-file-name", attrs: { translate: "no" } });
  const dot = h("span", { cls: "lk-dirty", title: "Unsaved changes" });
  const sync = (): void => {
    name.textContent = document.getElementById("file-name")?.textContent ?? "Rodeo";
    dot.hidden = document.getElementById("dirty-dot")?.hidden ?? true;
  };
  const watch = new MutationObserver(sync);
  for (const id of ["file-name", "dirty-dot"]) {
    const el = document.getElementById(id);
    if (el) watch.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  }
  sync();
  const bar = h("div", { cls: "lk-titlebar" }, h("div", { cls: "lk-title-start" }, appBtn, qat), h("div", { cls: "lk-title-mid" }, name, dot), h("div", { cls: "lk-title-end" }));
  into.append(bar);
  return () => {
    watch.disconnect();
    bar.remove();
  };
}

// ---- applying a look ------------------------------------------------------------------------

/** The menu layout of a look, as menuLayout.ts keeps one. */
function menusOf(look: LookSpec): { menus: { id: string; title: string; rows: string[] }[]; hidden: string[] } | null {
  return look.menus ? { menus: look.menus.map((m) => ({ id: m.id, title: m.title, rows: [...m.rows] })), hidden: [] } : null;
}

/** Takes the look's chrome down: its rows, and the bars it moved go back over the drawing. */
function takeDown(): void {
  // the Mode bar first: a status bar it sits in would take it out of the page as it goes
  putBack(document.getElementById("modebar"));
  for (const off of parts.splice(0)) off();
  commandLine = null;
  if (slots) for (const el of Object.values(slots)) if (el.classList.contains("lk-slot") && !el.querySelector(".lk-slot")) el.replaceChildren();
}

/** Puts up a look's chrome and settings (not its arrangement, which is kept with the palettes). */
async function putUp(chosen: LookSpec): Promise<void> {
  const h0 = host;
  if (!h0) return;
  const s = makeSlots();
  // a phone keeps Rodeo's touch layout, whatever the look, till the window widens
  const look = document.documentElement.classList.contains("lk-phone") ? RODEO : chosen;
  // the coloured icons before any button is made (loaded only for a look that draws with them)
  setGlyphs(look.icons === "color" ? (await import("./glyphs/index.ts")).GLYPHS : null);
  takeDown();
  spec = chosen;
  const root = document.documentElement;
  if (look.id === "rodeo") {
    delete root.dataset.look;
    for (const k of ["lkTopbar", "lkModebar", "lkViewbar", "lkSnap", "lkModeFields", "lkStartTab"]) delete root.dataset[k];
  } else {
    root.dataset.look = look.id;
    root.dataset.lkTopbar = look.topBar ? "on" : "off";
    root.dataset.lkModebar = look.modeBar;
    if (look.modeFields) root.dataset.lkModeFields = look.modeFields;
    else delete root.dataset.lkModeFields;
    root.dataset.lkViewbar = look.viewBar;
    root.dataset.lkSnap = look.snapPill ? "on" : "off";
  }
  // Revit's and Archicad's bars sit over the status bar, AutoCAD's layout tabs beside it
  if (look.layoutTabs) root.dataset.lkFoot = "row";
  else delete root.dataset.lkFoot;
  // Rhino and SketchUp show one drawing per window: no tabs of open drawings (Window lists them)
  if (look.docTabs === false) root.dataset.lkDocTabs = "off";
  else delete root.dataset.lkDocTabs;
  // AutoCAD's document tabs begin with a Start tab (docTabs.ts draws it while this is set)
  if (look.startTab) root.dataset.lkStartTab = "on";
  else delete root.dataset.lkStartTab;
  setTerms(look.id === "rodeo" ? null : look.terms);
  setLookMenus(menusOf(look));
  window.dispatchEvent(new Event("rodeo:menus"));
  h0.palettes.setRails(look.rails);
  setLookView(look.id === "rodeo" ? null : look.mouse, look.background3d ?? null, look.id === "rodeo" ? null : ownsKey);
  setPaper(look.paper ?? null);
  setLookCanvas(
    look.id === "rodeo" ? null : { gridColors: look.gridColors, viewCube: look.viewCube ?? true, grid3d: look.grid3d ?? false, axes3d: look.axes3d, start3d: look.start3d ?? false },
  );
  const names = look.paneNames;
  setPaneNames(names ? (kind, view) => (kind === "plan" ? names.plan : view === null ? names.turned : (names.views[view] ?? view)) : null);
  if (look.titleBar) parts.push(mountTitle(s.title, look));
  const loaders: Promise<void>[] = [];
  if (look.ribbon) {
    const ribbon = look.ribbon;
    loaders.push(import("./ribbon.ts").then((m) => void parts.push(m.mountRibbon(s.ribbon, ribbon))));
  }
  if (look.toolbars) {
    const bars = look.toolbars;
    loaders.push(import("./bars.ts").then((m) => void parts.push(m.mountToolbars(s.toolbars, bars))));
  }
  if (look.toolbox) {
    const box = look.toolbox;
    loaders.push(import("./bars.ts").then((m) => void parts.push(m.mountToolbox(box.side === "left" ? s.left : s.right, box))));
  }
  // a side panel (Rhino's OSnap) under the tools, in the toolbox's column (sidePanel.ts)
  if (look.sidePanel) {
    const panel = look.sidePanel;
    const column = look.toolbox?.side === "right" ? s.right : s.left;
    loaders.push(import("./sidePanel.ts").then((m) => void parts.push(m.mountSidePanel(column, panel))));
  }
  if (look.commandLine) {
    const cl = look.commandLine;
    loaders.push(
      import("./commandLine.ts").then((m) => {
        // in Rhino and AutoCAD the running tool's modes are the command line's options
        const handle = m.mountCommandLine(cl.where === "top" ? s.cmdTop : s.cmdBottom, cl, look.modeBar === "line" ? document.getElementById("modebar") : null);
        commandLine = handle;
        parts.push(() => handle.unmount());
      }),
    );
  }
  const modebar = document.getElementById("modebar");
  if (look.modeBar === "options") moveInto(modebar, s.options);
  // the status bar takes the Mode bar in at its start; it goes back over the drawing with the look
  if (look.modeBar === "status" && modebar?.parentNode && !homes.has(modebar)) homes.set(modebar, { parent: modebar.parentNode, next: modebar.nextSibling });
  if (look.statusBar) {
    const bar = look.statusBar;
    loaders.push(import("./statusBar.ts").then((m) => void parts.push(m.mountStatusBar(s.status, bar, look.modeBar === "status" ? modebar : null))));
  }
  // a palette's content the application's way (Rhino's layer table, Revit's Project Browser) over Rodeo's own
  for (const [id, panel] of Object.entries(look.panels ?? {})) {
    const body = h0.palettes.bodyOf(id);
    if (!body) continue;
    const holder = h("div", { cls: "lk-panel-host" });
    body.classList.add("lk-replaced");
    body.append(holder);
    let off: Unmount | null = null;
    parts.push(() => {
      off?.();
      holder.remove();
      body.classList.remove("lk-replaced");
    });
    loaders.push(
      panel.kind === "layerTable"
        ? import("./panels/layerTable.ts").then((m) => void (off = m.mountLayerTable(holder, panel)))
        : import("./panels/browserTree.ts").then((m) => void (off = m.mountBrowserTree(holder, panel.style))),
    );
  }
  if (look.viewControl) {
    const style = look.viewControl;
    loaders.push(import("./viewControl.ts").then((m) => void parts.push(m.mountViewControl(s.foot, style))));
  }
  if (look.layoutTabs) loaders.push(import("./layoutTabs.ts").then((m) => void parts.push(m.mountLayoutTabs(s.foot))));
  // AutoCAD's viewport words, navigation bar and UCS icon over the drawing's canvas (viewportControls.ts)
  if (look.viewportControls) {
    const wrap = document.getElementById("canvas-wrap");
    if (wrap) loaders.push(import("./viewportControls.ts").then((m) => void parts.push(m.mountViewportControls(wrap))));
  }
  // Rhino's viewport tabs in the foot slot, which sits above the status bar (paneTabs.ts)
  if (look.paneTabs) loaders.push(import("./paneTabs.ts").then((m) => void parts.push(m.mountPaneTabs(s.foot))));
  // SketchUp's Default Tray: the right dock's palettes as rolled up or out sections (tray.ts)
  if (look.tray) parts.push(mountTray(h0.palettes));
  await Promise.all(loaders);
  refreshButtons();
  store.emit("view");
  // the drawing's area changed size: the canvas and the docks measure again
  window.dispatchEvent(new Event("resize"));
}

/** The arrangement a look starts with when it has none of its own kept. */
function arrangementOf(look: LookSpec): unknown {
  const p = host!.palettes;
  const top: Partial<Record<TopGroupId, boolean>> = { menus: look.menuBar, view: look.topBar, tools: look.topBar, undo: look.topBar, zoom: look.topBar };
  return p.lookArrangement(look.palettes, { width: look.docks, top });
}

/** Changes the look: keeps the one left's arrangement, theme and panes, and brings the new one's (or its start). */
export function setLook(id: LookId): Promise<void> {
  switching = switching.then(async () => {
    if (!host || id === current) return;
    const entry = LOOKS.find((l) => l.id === id);
    if (!entry) return;
    let next: LookSpec;
    try {
      next = await entry.load();
    } catch (err) {
      console.warn("Work Like: the look didn't load", err);
      return;
    }
    const saved = readSaved();
    saved[current] = { layout: host.palettes.snapshot(), theme: theme(), panes: paneArrangement(), grid: store.showGrid };
    writeSaved(saved);
    const own = saved[id];
    current = id;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // storage blocked: the look lasts for this visit
    }
    if (own) {
      host.palettes.restore(own.layout);
      setTheme(own.theme);
      setPaneArrangement(readPaneArrangement(own.panes));
      setGrid({ show: own.grid ?? next.grid ?? true });
    } else if (id === "rodeo") {
      host.palettes.reset();
      setPaneArrangement(readPaneArrangement(null));
      setGrid({ show: true });
    } else startOf(next);
    await putUp(next);
  });
  return switching;
}

/** Puts a look's start on: its palettes, theme, view panes and grid. */
function startOf(look: LookSpec): void {
  host!.palettes.restore(arrangementOf(look));
  setTheme(look.theme);
  // one pane unless the look starts with more, whatever the look left had
  setPaneArrangement(look.panes ?? readPaneArrangement(null));
  setGrid({ show: look.grid ?? true });
}

/** Puts the look on now back as it starts: its palettes, theme and panes. */
async function resetLook(): Promise<void> {
  if (!host) return;
  const entry = LOOKS.find((l) => l.id === current);
  if (!entry) return;
  const look = await entry.load();
  const saved = readSaved();
  delete saved[current];
  writeSaved(saved);
  if (current === "rodeo") {
    host.palettes.reset();
    setPaneArrangement(readPaneArrangement(null));
    setGrid({ show: true });
  } else startOf(look);
  await putUp(look);
}

/** Starts the engine as the editor starts: the look last chosen, its chrome put up (its arrangement is already the palettes' kept one). */
export function installLooks(h1: LookHost): void {
  host = h1;
  setLookDeps({
    setTool: (id) => h1.setTool(id),
    setToolMode: (mode) => h1.setToolMode(mode),
    toolModes: () => h1.toolModes(),
    togglePalette: (id) => h1.palettes.toggle(id),
    paletteShown: (id) => h1.palettes.isShown(id),
  });
  makeSlots();
  const phone = window.matchMedia(PHONE_QUERY);
  document.documentElement.classList.toggle("lk-phone", phone.matches);
  phone.addEventListener("change", () => {
    document.documentElement.classList.toggle("lk-phone", phone.matches);
    if (current !== "rodeo") switching = switching.then(() => putUp(spec));
  });
  if (current === "rodeo") return;
  const entry = LOOKS.find((l) => l.id === current);
  if (!entry) return;
  switching = switching.then(async () => {
    try {
      const look = await entry.load();
      // a look set without ever being chosen here (its key copied in, a test): its start once, not Rodeo's arrangement
      if (!readSaved().rodeo && localStore(STARTED_KEY) !== current) {
        startOf(look);
        localStore(STARTED_KEY, current);
      }
      await putUp(look);
    } catch (err) {
      console.warn("Work Like: the look didn't load", err);
    }
  });
}

/**
 * Drops a menu of the look's menu bar ("File") at x, y: what a ribbon's application tab and the
 * title bar's button open. It ends with Work Like, so a look without a menu bar always has a way
 * to another look (the View menu that holds it isn't on screen).
 */
export function openLookMenu(title: string, x: number, y: number): void {
  const menus = host?.menus() ?? [];
  const menu = menus.find((m) => m.title === title) ?? menus[0];
  if (menu) openContextMenu([...menu.rows, "-", { label: "Work Like", i18n: "View › Work Like", items: workLikeRows }], x, y);
}

/** Where the pointer last went down, for a menu a look's button drops (Revit's User Interface, AutoCAD's workspace gear). */
let pointerAt = { x: 0, y: 0 };
window.addEventListener("pointerdown", (e) => (pointerAt = { x: e.clientX, y: e.clientY }), true);

/** A look's button or status item that drops View › Work Like where it was clicked. */
export const WORK_LIKE: Command = { run: () => openContextMenu(workLikeRows(), pointerAt.x, pointerAt.y) };

// ---- keys ---------------------------------------------------------------------------------------

/** The name a key goes by in a look's `keys`: "l", "⇧z", "F8", "Delete". */
function keyName(e: KeyboardEvent): string {
  if (/^F\d{1,2}$/.test(e.key)) return e.key;
  if (e.key.length === 1) return (e.shiftKey && /[a-z]/i.test(e.key) ? "⇧" : "") + e.key.toLowerCase();
  return e.key;
}

/**
 * The name a key held with Ctrl (or ⌘ on a Mac), Alt or both goes by in a look's `keys`, as the
 * applications write them on Windows: "Ctrl+L", "Ctrl+Shift+G", "Ctrl+Alt+H", "Alt+F2". The key is
 * read from where it sits (e.code), so Alt's or Shift's other characters on a Mac don't change it.
 */
function modifiedName(e: KeyboardEvent): string {
  const code = e.code;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(e.key) ? e.key : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  return [...parts, key].join("+");
}

/** Whether the look on takes a key typed over the drawing: its command line takes every one, or the key is one of its own or starts a two-key shortcut. */
function ownsKey(e: KeyboardEvent): boolean {
  if (current === "rodeo" || document.documentElement.classList.contains("lk-phone")) return false;
  if (lineOn() || spec.keys?.[keyName(e)]) return true;
  const typed = e.key.toLowerCase();
  return !!spec.sequences && Object.keys(spec.sequences).some((n) => n.startsWith(typed));
}

/**
 * A key held with Ctrl, ⌘ or Alt, offered to the look before Rodeo's own shortcuts (Rhino's Ctrl+L
 * locks where Rodeo's rotates). Only the combinations a look names; the rest stay Rodeo's. True when it took it.
 */
export function lookModifiedKey(e: KeyboardEvent): boolean {
  if (current === "rodeo" || document.documentElement.classList.contains("lk-phone")) return false;
  const command: Command | undefined = spec.keys?.[modifiedName(e)];
  if (!command) return false;
  if (!e.repeat) runCommand(command);
  return true;
}

/** Shows the look's command line when it is hidden, hides it when shown (AutoCAD's Ctrl+9); nothing while the look has none. */
export function toggleCommandLine(): void {
  commandLine?.toggle();
}

/** Whether a look's command line is on (not on a phone, which keeps Rodeo's layout). */
function lineOn(): boolean {
  return current !== "rodeo" && commandLine !== null && !document.documentElement.classList.contains("lk-phone");
}

/**
 * A key typed over the drawing, offered to a look's command line before the data bar, the tool and
 * Rodeo's own keys: in Rhino and AutoCAD whatever is typed goes to the command line. True when it
 * took it.
 */
export function lookTypeKey(e: KeyboardEvent): boolean {
  return lineOn() && commandLine!.type(e);
}

/** Space over the drawing in a look with a command line: Enter, as there. True when it took it. */
export function lookSpace(): boolean {
  return lineOn() && commandLine!.space();
}

/** Escape over the drawing: ends a typed command waiting for a selection or an option. True when it did. */
export function lookEscape(): boolean {
  return lineOn() && commandLine!.escape();
}

/**
 * A key typed over the drawing (not in a field, no ⌘ or Ctrl), offered to the look before Rodeo's
 * own keys: its two-key shortcuts, its command line, then its single keys. True when it took it.
 */
export function lookKey(e: KeyboardEvent): boolean {
  if (current === "rodeo" || e.metaKey || e.ctrlKey || e.altKey || document.documentElement.classList.contains("lk-phone")) return false;
  const look = spec;
  if (look.sequences && e.key.length === 1 && /[a-z]/i.test(e.key) && !e.shiftKey) {
    const now = performance.now();
    const so = (now - typedAt < SEQUENCE_MS ? typed : "") + e.key.toLowerCase();
    const names = Object.keys(look.sequences);
    const hit = look.sequences[so];
    if (hit) {
      typed = "";
      if (!e.repeat) runCommand(hit);
      return true;
    }
    if (names.some((n) => n.startsWith(so))) {
      typed = so;
      typedAt = now;
      return true;
    }
    typed = "";
  }
  if (commandLine?.key(e)) return true;
  const command: Command | undefined = look.keys?.[keyName(e)];
  if (!command) return false;
  if (!e.repeat) runCommand(command);
  return true;
}

// ---- View › Work Like ---------------------------------------------------------------------------

/** View › Work Like: each application, the one on now checked, then putting it back as it starts. */
export function workLikeRows(): Row[] {
  const name = LOOKS.find((l) => l.id === current)?.name ?? "Rodeo";
  return [
    ...LOOKS.map((l): Row => ({ label: l.name, i18n: `Work Like › ${l.name}`, checked: () => current === l.id, run: () => void setLook(l.id) })),
    "-",
    { label: `Reset ${name} Layout`, run: () => void resetLook() },
  ];
}
