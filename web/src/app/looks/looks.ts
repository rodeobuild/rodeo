// View › Work Like: Rodeo laid out as another application its users already know, so they can
// start drawing without learning a new interface: Rhino, SketchUp, Revit, Archicad, AutoCAD or
// Vectorworks, or Rodeo's own. A look (types.ts) brings that application's menu bar and what is in
// each menu, its words for things, where its panels sit, its ribbon, toolbars, toolbox, command
// line and status bar, its keys and two-key shortcuts, how its mouse moves the 3D view and the
// colours of its chrome and drawing area. Everything still runs Rodeo's own tools and commands,
// with Rodeo's icons.
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
import { store, type ToolId } from "../state.ts";
import { setTheme, theme, type Theme } from "../theme.ts";
import { paneArrangement, readPaneArrangement, setPaneArrangement } from "../viewPanes.ts";
import { lookButton, refreshButtons, runCommand, setLookDeps } from "./commands.ts";
import { setLookView } from "./viewLook.ts";
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
/** a phone keeps Rodeo's touch layout whatever the look (looks.css has the same width) */
const PHONE_QUERY = "(max-width: 760px)";
/** how long the second key of a two-key shortcut may wait */
const SEQUENCE_MS = 1100;

interface Saved {
  layout: unknown;
  theme: Theme;
  panes: unknown;
}

/** What the engine reaches in the editor (app.ts gives it as it starts). */
export interface LookHost {
  readonly palettes: Palettes;
  setTool(id: ToolId): void;
  /** the menus as they stand (a look's when one is on) */
  menus(): readonly { readonly title: string; readonly rows: readonly Row[] }[];
}

/** What a look's chrome part leaves behind: the call that takes it down again. */
type Unmount = () => void;

/** The command line on screen, which takes letters typed over the drawing. */
export interface CommandLineHandle {
  /** takes a key typed over the drawing (not in a field); true when it used it */
  key(e: KeyboardEvent): boolean;
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
    status: slot("lk-status", "lk-status-slot"),
  };
  s.top.append(s.ribbon, s.cmdTop, s.toolbars, s.options);
  s.bottom.append(s.cmdBottom, s.status);
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
  takeDown();
  spec = chosen;
  // a phone keeps Rodeo's touch layout, whatever the look, till the window widens
  const look = document.documentElement.classList.contains("lk-phone") ? RODEO : chosen;
  const root = document.documentElement;
  if (look.id === "rodeo") {
    delete root.dataset.look;
    for (const k of ["lkTopbar", "lkModebar", "lkViewbar", "lkSnap"]) delete root.dataset[k];
  } else {
    root.dataset.look = look.id;
    root.dataset.lkTopbar = look.topBar ? "on" : "off";
    root.dataset.lkModebar = look.modeBar;
    root.dataset.lkViewbar = look.viewBar;
    root.dataset.lkSnap = look.snapPill ? "on" : "off";
  }
  setTerms(look.id === "rodeo" ? null : look.terms);
  setLookMenus(menusOf(look));
  window.dispatchEvent(new Event("rodeo:menus"));
  h0.palettes.setRails(look.rails);
  setLookView(look.id === "rodeo" ? null : look.mouse, look.background3d ?? null);
  setPaper(look.paper ?? null);
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
  if (look.commandLine) {
    const cl = look.commandLine;
    loaders.push(
      import("./commandLine.ts").then((m) => {
        const handle = m.mountCommandLine(cl.where === "top" ? s.cmdTop : s.cmdBottom, cl);
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
    saved[current] = { layout: host.palettes.snapshot(), theme: theme(), panes: paneArrangement() };
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
    } else if (id === "rodeo") {
      host.palettes.reset();
      setPaneArrangement(readPaneArrangement(null));
    } else {
      host.palettes.restore(arrangementOf(next));
      setTheme(next.theme);
      // one pane unless the look starts with more, whatever the look left had
      setPaneArrangement(next.panes ?? readPaneArrangement(null));
    }
    await putUp(next);
  });
  return switching;
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
  if (current === "rodeo") host.palettes.reset();
  else {
    host.palettes.restore(arrangementOf(look));
    setTheme(look.theme);
  }
  setPaneArrangement(look.panes ?? readPaneArrangement(null));
  await putUp(look);
}

/** Starts the engine as the editor starts: the look last chosen, its chrome put up (its arrangement is already the palettes' kept one). */
export function installLooks(h1: LookHost): void {
  host = h1;
  setLookDeps({
    setTool: (id) => h1.setTool(id),
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
      await putUp(await entry.load());
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
