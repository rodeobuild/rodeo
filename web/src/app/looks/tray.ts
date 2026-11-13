// View › Work Like › SketchUp's Default Tray: the right dock's palettes stacked in one column, each
// under a header row that rolls it up to the header or out to its contents (LookSpec.tray). The
// palettes are Rodeo's own: each palette's body is moved from the dock into its section and goes
// back where the dock keeps it when the look goes, so Rodeo's tabs come back unchanged. The dock
// lays its bodies out again on every change, so the tray watches the dock and takes them back.

import "./tray.css";
import type { Palettes } from "../dock.ts";
import { h } from "../dom.ts";

/** Where each section's rolled up or out state is kept in this browser, by palette id. */
const KEY = "openvwx.look.tray.v1";
/** The palettes that start out rolled out (SketchUp's Entity Info and Materials); the rest start rolled up. */
const START_OUT: ReadonlySet<string> = new Set(["objectInfo", "attributes"]);
/**
 * The sections' order, by Rodeo's palette id: SketchUp's Default Tray lists Entity Info, Materials,
 * Components, (Styles), Tags, (Scenes) and Shadows in this order (Styles, Scenes and the others it
 * has Rodeo has no palette for). A palette not on the list goes after them, in the dock's order.
 */
const ORDER: readonly string[] = ["objectInfo", "attributes", "resources", "navigation", "visualization"];

/** One palette in the tray: where its body belongs in the dock and where it is now. */
interface Entry {
  readonly id: string;
  readonly title: string;
  /** the palette element the dock shows it in (its tabs' palette, or itself) */
  readonly host: HTMLElement;
  /** whether the dock shows this body in its host (the host's front tab) */
  readonly front: boolean;
  readonly body: HTMLElement;
}

/** A section of the tray: a header that rolls it up or out, and the palette's body in it. */
interface Section {
  readonly id: string;
  readonly el: HTMLElement;
  readonly head: HTMLElement;
  readonly tri: HTMLElement;
  readonly name: HTMLElement;
  /** a .pal-body holding the palette's body, so the look's body rules still apply */
  readonly wrap: HTMLElement;
  /** the palette's own body, as the dock makes it */
  readonly body: HTMLElement;
  /** the host and front of the palette as the dock last had them, to give the body back */
  host: HTMLElement;
  front: boolean;
  open: boolean;
}

/** What a mount returns: the call that takes the tray down again. */
type Unmount = () => void;

/** The tray as it stands while its look is on, or null. */
let tray: { root: HTMLElement; dock: HTMLElement; palettes: Palettes; observer: MutationObserver; sections: Map<string, Section> } | null = null;

/** Reads the rolled up or out state kept for each section (storage blocked: the starting states). */
function readOpen(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown;
    return raw && typeof raw === "object" ? (raw as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Keeps each section's rolled up or out state (storage blocked: kept for this visit only). */
function writeOpen(id: string, open: boolean): void {
  try {
    const all = readOpen();
    all[id] = open;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // storage blocked
  }
}

/** The palettes the right dock shows now, each with its body, its host and whether it is the host's front. */
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
  return out;
}

/** A tab's name as the dock shows it. */
function label(tab: HTMLElement): string {
  return tab.textContent?.trim() || tab.title;
}

/** A section's body goes back where the dock keeps it: its host's body when it is the front, else nowhere. */
function giveBack(sec: Section): void {
  sec.body.remove();
  if (!sec.front) return;
  // the host's body holder, as the dock dresses it
  const holder = sec.host.querySelector<HTMLElement>(":scope > .pal-body");
  holder?.replaceChildren(sec.body);
}

/** Makes one section for a palette: its header rolls the body up or out. */
function makeSection(e: Entry, open: boolean): Section {
  const tri = h("span", { cls: "lk-tray-tri", text: open ? "▾" : "▸", attrs: { "aria-hidden": "true" } });
  const name = h("span", { cls: "lk-tray-name", text: e.title });
  const head = h("button", { cls: "lk-tray-head", attrs: { type: "button", "aria-expanded": String(open) } }, tri, name);
  const wrap = h("div", { cls: "pal-body lk-tray-body", hidden: !open });
  const el = h("section", { cls: "lk-tray-sec", attrs: { "data-tray-pal": e.id } }, head, wrap);
  const sec: Section = { id: e.id, el, head, tri, name, wrap, body: e.body, host: e.host, front: e.front, open };
  head.addEventListener("click", () => setOpen(sec, !sec.open));
  return sec;
}

/** Rolls a section up or out, and keeps the state. */
function setOpen(sec: Section, open: boolean): void {
  sec.open = open;
  sec.wrap.hidden = !open;
  sec.tri.textContent = open ? "▾" : "▸";
  sec.head.setAttribute("aria-expanded", String(open));
  writeOpen(sec.id, open);
}

/** Brings the tray in line with the dock: a section for each palette shown, each body in its section. */
function sync(): void {
  if (!tray) return;
  const { root, dock, palettes, sections } = tray;
  const rank = (id: string): number => (ORDER.indexOf(id) < 0 ? ORDER.length : ORDER.indexOf(id));
  const list = entriesOf(dock, palettes).sort((x, y) => rank(x.id) - rank(y.id));
  const want = new Set(list.map((e) => e.id));
  // a palette no longer in the dock: its body goes back, and its section goes
  for (const [id, sec] of sections) {
    if (want.has(id)) continue;
    giveBack(sec);
    sec.el.remove();
    sections.delete(id);
  }
  const saved = readOpen();
  const scroll = root.querySelector<HTMLElement>(".lk-tray-scroll")!;
  for (const e of list) {
    let sec = sections.get(e.id);
    if (!sec) {
      sec = makeSection(e, saved[e.id] ?? START_OUT.has(e.id));
      sections.set(e.id, sec);
    }
    // only when it changes: setting the same text again is a change the observer would see
    if (sec.name.textContent !== e.title) sec.name.textContent = e.title;
    sec.host = e.host;
    sec.front = e.front;
    // the dock may have put the body back in its palette; it goes into its section again
    if (e.body.parentNode !== sec.wrap) sec.wrap.replaceChildren(e.body);
  }
  // the sections in the dock's order
  list.forEach((e, i) => {
    const sec = sections.get(e.id)!;
    if (scroll.children[i] !== sec.el) scroll.insertBefore(sec.el, scroll.children[i] ?? null);
  });
}

/**
 * Puts SketchUp's Default Tray up in the right dock: the dock's palettes as rolled up or out
 * sections under a title bar. Returns the call that takes it down and gives each body back.
 */
export function mountTray(palettes: Palettes): Unmount {
  const dock = document.querySelector<HTMLElement>(".dock-right");
  if (!dock || tray) return () => {};
  const cols = dock.querySelector<HTMLElement>(".dock-cols");
  const root = h(
    "div",
    { cls: "lk-tray", attrs: { role: "region", "aria-label": "Default Tray" } },
    h("div", { cls: "lk-tray-bar", text: "Default Tray" }),
    h("div", { cls: "lk-tray-scroll" }),
  );
  // the tray takes the columns' place in the dock; the columns stay, hidden, so the dock keeps its palettes
  dock.classList.add("lk-tray-on");
  dock.insertBefore(root, cols);
  const observer = new MutationObserver(() => sync());
  tray = { root, dock, palettes, observer, sections: new Map() };
  observer.observe(dock, { childList: true, subtree: true });
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
