// A look's toolbars and toolbox: the rows of icon buttons under the ribbon (Rhino's tabbed toolbars,
// SketchUp's Getting Started bar, Archicad's Standard toolbar) and the column of tools down one side
// of the drawing (SketchUp's Large Tool Set, Rhino's sidebar, Archicad's Toolbox). Every button is a
// look button from commands.ts, so it runs and lights exactly as it does on the ribbon.
import "./bars.css";
import { h } from "../dom.ts";
import { lookButton } from "./commands.ts";
import type { LookButton, ToolbarSpec, ToolboxGroup, ToolboxSpec } from "./types.ts";

/** A button as a toolbar or toolbox draws it: the ribbon's large or small size never applies here. */
function plain(b: LookButton): LookButton {
  return b.size === undefined ? b : { ...b, size: undefined };
}

/** The key the front toolbar tab is remembered under, one per look, so it reopens on the same tab. */
function tabKey(): string {
  return `openvwx.look.toolbarTab.${document.documentElement.dataset.look ?? "rodeo"}`;
}

/** The tab the look was left on, or the first when none is saved or the saved one is gone. */
function savedTab(count: number): number {
  try {
    const n = Number(localStorage.getItem(tabKey()));
    return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
  } catch {
    // storage blocked: the first tab, every time
    return 0;
  }
}

function saveTab(i: number): void {
  try {
    localStorage.setItem(tabKey(), String(i));
  } catch {
    // storage blocked: the tab lasts for this visit
  }
}

/** Builds the toolbar rows into `into`; returns the call that takes them down. */
export function mountToolbars(into: HTMLElement, spec: ToolbarSpec): () => void {
  const tabs = spec.tabs;
  const root = h("div", { cls: "lk-toolbars" });
  const row = h("div", { cls: "lk-toolbar", attrs: { role: "toolbar" } });
  const titles: HTMLButtonElement[] = [];
  let front = spec.showTabs ? savedTab(tabs.length) : 0;

  // Shows one tab's buttons and marks its title as the front one.
  const show = (i: number): void => {
    const tab = tabs[i];
    if (!tab) return;
    front = i;
    row.setAttribute("aria-label", tab.title);
    row.replaceChildren(
      ...tab.buttons.map((b) =>
        b === "-"
          ? h("span", { cls: "lk-toolbar-sep", attrs: { role: "separator", "aria-orientation": "vertical" } })
          : lookButton(plain(b), { iconOnly: !b.showLabel }),
      ),
    );
    titles.forEach((t, j) => {
      const on = j === i;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
  };

  if (spec.showTabs) {
    const strip = h("div", { cls: "lk-toolbar-tabs", attrs: { role: "tablist" } });
    tabs.forEach((tab, i) => {
      // keyed by its sense: a toolbar tab can be named apart from the button or menu of one English name
      // (German Rhino's Curve Tools tab "Kurven")
      const t = h("button", {
        cls: "lk-toolbar-tab",
        text: tab.title,
        attrs: { type: "button", role: "tab", "data-i18n": `Toolbar tab › ${tab.title}` },
      });
      t.addEventListener("click", () => {
        show(i);
        saveTab(i);
      });
      titles.push(t);
      strip.append(t);
    });
    // Arrow keys move along the titles, as a tab row does.
    strip.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const next = (front + step + tabs.length) % tabs.length;
      e.preventDefault();
      titles[next]?.focus();
      show(next);
      saveTab(next);
    });
    root.append(strip);
  }
  root.append(row);
  into.append(root);
  show(front);
  return () => root.remove();
}

/** The key a foldable toolbox group's state is kept under, per look and group. */
function foldKey(title: string): string {
  return `openvwx.look.toolboxFold.${document.documentElement.dataset.look ?? "rodeo"}.${title}`;
}

/** Whether a foldable group is folded: as it was left, else as the look starts it. */
function folded(g: ToolboxGroup): boolean {
  try {
    const kept = localStorage.getItem(foldKey(g.title ?? ""));
    if (kept === "1" || kept === "0") return kept === "1";
  } catch {
    // storage blocked: as the look starts it
  }
  return g.fold === "closed";
}

function keepFold(g: ToolboxGroup, on: boolean): void {
  try {
    localStorage.setItem(foldKey(g.title ?? ""), on ? "1" : "0");
  } catch {
    // storage blocked: it lasts for this visit
  }
}

const TRIANGLE = `<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2.5 2 7.5 5 2.5 8Z" fill="currentColor"/></svg>`;

/** A group's title: plain text, or a band with a disclosure triangle that folds the group (Archicad's Design ▾). */
function groupTitle(g: ToolboxGroup, group: HTMLElement): HTMLElement | null {
  if (!g.title) return null;
  if (!g.fold) return h("div", { cls: "lk-toolbox-group-title", text: g.title });
  const band = h(
    "button",
    { cls: "lk-toolbox-group-title lk-toolbox-fold", attrs: { type: "button" } },
    h("span", { cls: "lk-toolbox-fold-mark", html: TRIANGLE }),
    h("span", { cls: "lk-toolbox-fold-name", text: g.title }),
  );
  const show = (shut: boolean): void => {
    group.classList.toggle("lk-folded", shut);
    band.setAttribute("aria-expanded", String(!shut));
  };
  show(folded(g));
  band.addEventListener("click", () => {
    const shut = !group.classList.contains("lk-folded");
    show(shut);
    keepFold(g, shut);
  });
  return band;
}

/** Builds the toolbox column into `into` (#lk-left or #lk-right); returns the call that takes it down. */
export function mountToolbox(into: HTMLElement, spec: ToolboxSpec): () => void {
  const classes = ["lk-toolbox", `lk-cols-${spec.columns}`, `lk-toolbox-${spec.side}`];
  if (spec.labels) classes.push("lk-labels");
  const box = h("div", { cls: classes.join(" ") });
  if (spec.title) box.append(h("div", { cls: "lk-toolbox-title", text: spec.title }));
  for (const g of spec.groups) {
    const group = h("div", { cls: `lk-toolbox-group${g.fold ? " lk-foldable" : ""}` });
    const title = groupTitle(g, group);
    if (title) group.append(title);
    // With labels each button shows its name beside the icon; otherwise the name lives in its tooltip only.
    const grid = h("div", { cls: "lk-toolbox-grid" }, ...g.buttons.map((b) => lookButton(plain(b), { iconOnly: !spec.labels })));
    group.append(grid);
    box.append(group);
  }
  into.append(box);
  return () => box.remove();
}
