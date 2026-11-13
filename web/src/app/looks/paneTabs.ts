// View › Work Like's viewport tabs, as Rhino 8 lists its viewports under the views: Perspective,
// Top, Front and Right, and a "+". The tab of the active pane is white; a click makes the pane
// showing that view the active one (a pane's press does the same), or, when no pane shows it, turns
// the active pane to it through Rodeo's own View › Standard Views command. The "+" only says that
// Rodeo has no extra viewports. The row sits in the foot slot, which is above the status bar.

import { h } from "../dom.ts";
import { activePaneIndex, makePaneActive, onActivePane, paneCount, paneNameOf } from "../viewPanes.ts";
import { store } from "../state.ts";
import { runCommand } from "./commands.ts";
import type { Command } from "./types.ts";
import "./paneTabs.css";

type Unmount = () => void;

/** Rhino's viewports in the order its tabs list them, each with the Rodeo standard view it turns the active pane to. */
const TABS: readonly (readonly [string, Command])[] = [
  ["Perspective", { menu: "View › Standard Views › Right Isometric" }],
  ["Top", { menu: "View › Standard Views › Top" }],
  ["Front", { menu: "View › Standard Views › Front" }],
  ["Right", { menu: "View › Standard Views › Right" }],
];

const NO_EXTRA = "Rodeo has no extra viewports";

/** The pane showing the view `name` under the look's names, or -1 when none does. */
function paneShowing(name: string): number {
  for (let i = 0; i < paneCount(); i++) if (paneNameOf(i) === name) return i;
  return -1;
}

/**
 * Mounts the viewport tabs into `into`: a tab per Rhino viewport, the active pane's white, and
 * the "+". Returns what takes them down again.
 */
export function mountPaneTabs(into: HTMLElement): Unmount {
  const row = h("div", { cls: "lk-pane-tabs", attrs: { role: "tablist", "aria-label": "Viewports" } });
  const tabs = new Map<string, HTMLButtonElement>();
  for (const [name, command] of TABS) {
    const tab = h("button", { cls: "lk-pane-tab", text: name, attrs: { type: "button", role: "tab", "aria-selected": "false" } });
    tab.addEventListener("click", () => {
      // a pane showing this view takes the active one; else the active pane turns to it
      const i = paneShowing(name);
      if (i >= 0) makePaneActive(i);
      else runCommand(command);
    });
    tabs.set(name, tab);
    row.append(tab);
  }
  const note = h("span", { cls: "lk-pane-note", text: NO_EXTRA, hidden: true, attrs: { role: "status" } });
  const add = h("button", { cls: "lk-pane-tab lk-pane-add", text: "+", title: NO_EXTRA, attrs: { type: "button", "aria-label": NO_EXTRA } });
  let hideNote = 0;
  add.addEventListener("click", () => {
    note.hidden = false;
    window.clearTimeout(hideNote);
    hideNote = window.setTimeout(() => (note.hidden = true), 2000);
  });
  row.append(add, note);
  into.append(row);

  // the active tab follows the active pane: its view, its name under the look
  const refresh = (): void => {
    const i = activePaneIndex();
    const active = i >= 0 ? paneNameOf(i) : "";
    for (const [name, tab] of tabs) {
      const on = name === active;
      if (tab.classList.contains("on") !== on) tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", String(on));
    }
  };
  const offPane = onActivePane(refresh);
  const offStore = store.on(["view", "view3d", "session"], refresh);
  refresh();

  return () => {
    offPane();
    offStore();
    window.clearTimeout(hideNote);
    row.remove();
  };
}
