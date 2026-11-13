// A look's side panel: a small titled panel at the foot of the column of tools, as Rhino's OSnap
// panel sits under its sidebar. Its rows are status items, drawn by statusBar.ts's own item code, so
// a check box row runs the same command the status bar's would.
import "./sidePanel.css";
import { h } from "../dom.ts";
import { item } from "./statusBar.ts";
import type { LookSpec } from "./types.ts";

/** Builds a side panel at the foot of the column `into` (the left or right side slot); returns the call that takes it down. */
export function mountSidePanel(into: HTMLElement, spec: NonNullable<LookSpec["sidePanel"]>): () => void {
  const offs: (() => void)[] = [];
  const panel = h("div", { cls: "lk-sidepanel", attrs: { role: "group", "aria-label": spec.title } });
  panel.append(h("div", { cls: "lk-sidepanel-title", text: spec.title }));
  for (const it of spec.items) panel.append(h("div", { cls: "lk-sidepanel-row" }, item(it, offs)));
  // the column becomes a stack: the toolbox keeps the space above, the panel sits under it (sidePanel.css)
  into.classList.add("lk-side-stack");
  into.append(panel);
  return () => {
    for (const off of offs) off();
    panel.remove();
    into.classList.remove("lk-side-stack");
  };
}
