// View › Work Like › SketchUp's Default Tray: the right dock's palettes stacked in one column, each
// under a header row that rolls it up to the header or out to its contents, with a × that takes it
// out of the tray (LookSpec.tray). The title bar's menu puts sections back, and its × hides the whole
// tray through Window › Palettes › Hide Enabled Palettes, which brings it back. The palettes are
// Rodeo's own: each palette's body is moved from the dock into its section and goes back where the
// dock keeps it when the look goes, so Rodeo's tabs come back unchanged. The dock lays its bodies out
// again on every change, so the tray watches the dock and takes them back.

import "./tray.css";
import type { Palettes } from "../dock.ts";
import { h } from "../dom.ts";
import { openContextMenu, type Row } from "../menu.ts";

/** Where each look's tray keeps its sections' state in this browser (storage blocked: the starting state). */
const KEY = "openvwx.look.tray.v2";
/** The palettes that start out rolled out (SketchUp's Entity Info and Materials); the rest start rolled up. */
const START_OUT: ReadonlySet<string> = new Set(["objectInfo", "attributes"]);
/**
 * The sections' order, by Rodeo's palette id: SketchUp 2026's Default Tray lists Entity Info,
 * Materials, Components, Styles, Environments, Tags, Shadows, Scenes and Instructor. Rodeo has a
 * palette for the first five and for Scenes (Navigation's Saved Views tab); it has none for Styles,
 * Environments or Instructor, so those are left out. A palette not on the list goes after them.
 */
const ORDER: readonly string[] = ["objectInfo", "attributes", "resources", "navigation", "visualization", "navigation:views"];
/**
 * The tabs that sit out of a palette's own title (Navigation's Saved Views is one of its strip's tabs,
 * not a title tab of the dock): each with its palette, and its name as the dock would show it.
 */
const STRIP_TABS: Readonly<Record<string, { home: string; title: string }>> = {
  "navigation:views": { home: "navigation", title: "Saved Views" },
};

/** The tray's own state for this look: each section's rolled up or out state, and which are closed. */
interface Kept {
  open: Record<string, boolean>;
  closed: Record<string, boolean>;
}

/** One palette in the tray: where its body belongs in the dock and where it is now. */
interface Entry {
  readonly id: string;
  readonly title: string;
  /** the palette element the dock shows it in (its tabs' palette, or itself); null for a tab out of a strip */
  readonly host: HTMLElement | null;
  /** whether the dock shows this body in its host (the host's front tab) */
  readonly front: boolean;
  readonly body: HTMLElement;
}

/** A section of the tray: a header that rolls it up or out, and the palette's body in it. */
interface Section {
  readonly id: string;
  readonly el: HTMLElement;
  readonly toggle: HTMLElement;
  readonly name: HTMLElement;
  /** the title last written to the name: the translator may change the text, which must not be written back */
  title: string;
  /** a .pal-body holding the palette's body, so the look's body rules still apply */
  readonly wrap: HTMLElement;
  /** the palette's own body, as the dock makes it */
  readonly body: HTMLElement;
  /** where a strip's tab body sat before the tray took it, to put it back there */
  readonly origin: HTMLElement | null;
  /** whether the strip had that body hidden (a tab not in front), to leave it so again */
  readonly originHidden: boolean;
  /** the host and front of the palette as the dock last had them, to give the body back */
  host: HTMLElement | null;
  front: boolean;
  open: boolean;
}

/** What a mount returns: the call that takes the tray down again. */
type Unmount = () => void;

/** The tray as it stands while its look is on, or null. */
let tray: {
  root: HTMLElement;
  dock: HTMLElement;
  palettes: Palettes;
  observer: MutationObserver;
  sections: Map<string, Section>;
  kept: Kept;
} | null = null;

/** A small chevron pointing right; the section turns it down when it is rolled out. */
const CHEVRON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.8 7.2 5l-3.7 3.2" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
/** A thin cross: a section's and the title bar's close. */
const CROSS = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.3 2.3l5.4 5.4M7.7 2.3 2.3 7.7" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';

/** The rolled up or out state and the closed sections, kept for this look (storage blocked: the starting state). */
function readKept(): Kept {
  const fresh: Kept = { open: {}, closed: {} };
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, Partial<Kept>> | null;
    const mine = all?.[lookId()];
    if (!mine || typeof mine !== "object") return fresh;
    return { open: mine.open ?? {}, closed: mine.closed ?? {} };
  } catch {
    return fresh;
  }
}

/** Keeps the tray's state for this look (storage blocked: kept for this visit only). */
function writeKept(kept: Kept): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, Kept> | null;
    localStorage.setItem(KEY, JSON.stringify({ ...(all ?? {}), [lookId()]: kept }));
  } catch {
    // storage blocked
  }
}

/** The look's id as the page names it (its root carries data-look). */
function lookId(): string {
  return document.documentElement.dataset.look || "rodeo";
}

/** The palettes the tray can show now, each with its body, its host and whether it is the host's front. */
function entriesOf(dock: HTMLElement, palettes: Palettes): Entry[] {
  const out: Entry[] = [];
  for (const pal of dock.querySelectorAll<HTMLElement>(".dock-cols section.pal[data-pal]")) {
    const tabs = [...pal.querySelectorAll<HTMLElement>(".pal-title .pal-htab[data-tab]")];
    if (tabs.length > 1) {
      // a palette with tabs: each tab is a palette of its own in the tray
      for (const t of tabs) {
        const id = t.dataset.tab!;
        const body = palettes.bodyOf(id);
        if (body) out.push({ id, title: label(t), host: pal, front: t.classList.contains("active"), body });
      }
    } else {
      const id = pal.dataset.pal!;
      const body = palettes.bodyOf(id);
      const title = pal.querySelector<HTMLElement>(".pal-title");
      if (body) out.push({ id, title: title?.textContent?.trim() || id, host: pal, front: true, body });
    }
  }
  // a tab out of a strip is in no dock title: it is offered while its palette is shown
  for (const [id, strip] of Object.entries(STRIP_TABS)) {
    const body = palettes.bodyOf(id);
    if (body && palettes.isShown(strip.home)) out.push({ id, title: strip.title, host: null, front: false, body });
  }
  return out;
}

/** A tab's name as the dock shows it. */
function label(tab: HTMLElement): string {
  return tab.textContent?.trim() || tab.title;
}

/** A section's body goes back where the dock keeps it: its host's body when it is the front, else nowhere. */
function giveBack(sec: Section): void {
  sec.body.remove();
  if (!sec.host) {
    // a strip's tab goes back into the strip, where it was, shown or hidden as it was
    sec.body.hidden = sec.originHidden;
    if (sec.origin?.isConnected) sec.origin.append(sec.body);
    return;
  }
  if (!sec.front) return;
  // the host's body holder, as the dock dresses it
  const holder = sec.host.querySelector<HTMLElement>(":scope > .pal-body");
  holder?.replaceChildren(sec.body);
}

/** Makes one section for a palette: its header rolls the body up or out, and its × takes it out of the tray. */
function makeSection(e: Entry, open: boolean): Section {
  const tri = h("span", { cls: "lk-tray-tri", html: CHEVRON });
  const name = h("span", { cls: "lk-tray-name", text: e.title });
  const toggle = h("button", { cls: "lk-tray-toggle", attrs: { type: "button", "aria-expanded": String(open) } }, tri, name);
  const close = h("button", { cls: "lk-tray-btn", html: CROSS, title: "Close", attrs: { type: "button", "aria-label": `Close ${e.title}` } });
  const head = h("div", { cls: "lk-tray-head" }, toggle, close);
  const wrap = h("div", { cls: "pal-body lk-tray-body", hidden: !open });
  const el = h("section", { cls: open ? "lk-tray-sec lk-tray-open" : "lk-tray-sec", attrs: { "data-tray-pal": e.id } }, head, wrap);
  const sec: Section = { id: e.id, el, toggle, name, title: e.title, wrap, body: e.body, origin: e.body.parentElement, originHidden: e.body.hidden !== false, host: e.host, front: e.front, open };
  toggle.addEventListener("click", () => setOpen(sec, !sec.open));
  close.addEventListener("click", () => setShown(e.id, false));
  return sec;
}

/** Rolls a section up or out, and keeps the state. */
function setOpen(sec: Section, open: boolean): void {
  sec.open = open;
  sec.wrap.hidden = !open;
  sec.el.classList.toggle("lk-tray-open", open);
  sec.toggle.setAttribute("aria-expanded", String(open));
  if (tray) {
    tray.kept.open[sec.id] = open;
    writeKept(tray.kept);
  }
}

/** Puts a section in the tray or takes it out, and keeps the state. */
function setShown(id: string, shown: boolean): void {
  if (!tray) return;
  tray.kept.closed[id] = !shown;
  writeKept(tray.kept);
  sync();
}

/** The palettes in the order the tray lists them. */
function ranked(list: Entry[]): Entry[] {
  const rank = (id: string): number => (ORDER.indexOf(id) < 0 ? ORDER.length : ORDER.indexOf(id));
  return list.sort((x, y) => rank(x.id) - rank(y.id));
}

/** Brings the tray in line with the dock: a section for each palette shown and in the tray, each body in its section. */
function sync(): void {
  if (!tray) return;
  const { root, dock, palettes, sections, kept } = tray;
  const list = ranked(entriesOf(dock, palettes));
  const shown = list.filter((e) => !kept.closed[e.id]);
  const want = new Set(shown.map((e) => e.id));
  // a section no longer shown: its body goes back, and its section goes
  for (const [id, sec] of sections) {
    if (want.has(id)) continue;
    giveBack(sec);
    sec.el.remove();
    sections.delete(id);
  }
  const scroll = root.querySelector<HTMLElement>(".lk-tray-scroll")!;
  for (const e of shown) {
    let sec = sections.get(e.id);
    if (!sec) {
      sec = makeSection(e, kept.open[e.id] ?? START_OUT.has(e.id));
      sections.set(e.id, sec);
    }
    // only when it changes: setting the same text again is a change the observer would see
    if (sec.title !== e.title) {
      sec.title = e.title;
      sec.name.textContent = e.title;
    }
    sec.host = e.host;
    sec.front = e.front;
    // the dock may have put the body back in its palette; it goes into its section again
    if (e.body.parentNode !== sec.wrap) sec.wrap.replaceChildren(e.body);
    // a strip's tab not in front is hidden by its strip; in its own section it shows
    if (!e.host && e.body.hidden !== false) e.body.hidden = false;
  }
  // the sections in the dock's order
  shown.forEach((e, i) => {
    const sec = sections.get(e.id)!;
    if (scroll.children[i] !== sec.el) scroll.insertBefore(sec.el, scroll.children[i] ?? null);
  });
}

/** The Window menu's rows for the tray's sections: each one ticked while it is in the tray. */
function sectionRows(): Row[] {
  if (!tray) return [];
  const { dock, palettes, kept } = tray;
  return ranked(entriesOf(dock, palettes)).map(
    (e): Row => ({ label: e.title, checked: () => !kept.closed[e.id], run: () => setShown(e.id, kept.closed[e.id] === true) }),
  );
}

/**
 * Puts SketchUp's Default Tray up in the right dock: the dock's palettes as rolled up or out
 * sections under a title bar. Returns the call that takes it down and gives each body back.
 */
export function mountTray(palettes: Palettes): Unmount {
  const dock = document.querySelector<HTMLElement>(".dock-right");
  if (!dock || tray) return () => {};
  const cols = dock.querySelector<HTMLElement>(".dock-cols");
  const kept = readKept();
  // SketchUp's pin (auto-hide) is left out: Rodeo's dock doesn't slide away
  const shut = h("button", { cls: "lk-tray-btn", html: CROSS, title: "Close", attrs: { type: "button", "aria-label": "Close Default Tray" } });
  const bar = h(
    "div",
    { cls: "lk-tray-bar" },
    h("span", { cls: "lk-tray-title", text: "Default Tray" }),
    h("span", { cls: "lk-tray-tools" }, shut),
  );
  const root = h(
    "div",
    { cls: "lk-tray", attrs: { role: "region", "aria-label": "Default Tray" } },
    bar,
    h("div", { cls: "lk-tray-scroll" }),
  );
  // the tray takes the columns' place in the dock; the columns stay, hidden, so the dock keeps its palettes
  dock.classList.add("lk-tray-on");
  dock.insertBefore(root, cols);
  const observer = new MutationObserver(() => sync());
  tray = { root, dock, palettes, observer, sections: new Map(), kept };
  observer.observe(dock, { childList: true, subtree: true });
  // a right click on the title bar lists the sections, each ticked while it is in the tray
  bar.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(sectionRows(), e.clientX, e.clientY);
  });
  // the title bar's × hides the tray as Window › Palettes › Hide Enabled Palettes does; that row brings it back
  shut.addEventListener("click", () => palettes.toggleAway());
  sync();
  return () => unmount();
}

/** Takes the tray down: each palette's body goes back where the dock keeps it, and the dock shows its columns again. */
function unmount(): void {
  if (!tray) return;
  // the dock's latest placement first, so each body goes back where the dock has it now
  sync();
  tray.observer.disconnect();
  for (const sec of tray.sections.values()) giveBack(sec);
  tray.sections.clear();
  tray.root.remove();
  tray.dock.classList.remove("lk-tray-on");
  tray = null;
}
