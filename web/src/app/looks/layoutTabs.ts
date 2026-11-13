// AutoCAD's Model and Layout tabs along the foot of the drawing: "Model" stands for the design
// layers, then one tab for each sheet layer by its name, then "+" makes a new sheet layer. A tab
// makes its layer the active one (commands.ts setActiveLayer), and the Layers palette's own new
// sheet layer is made the same way (panels/layers.ts), so the tabs only lay them out.

import { attempt, setActiveLayer } from "../commands.ts";
import { h } from "../dom.ts";
import { freeName } from "../panels/common.ts";
import { store } from "../state.ts";
import "./layoutTabs.css";

/** The design layer that was active last, so Model goes back to it; null until one has been. */
let lastDesign: string | null = null;

/** Makes a new sheet layer with a free name and makes it active, as the Layers palette does. */
function newSheetLayer(): void {
  const r = attempt("Create layer", (s) => s.createLayer(freeName("Sheet"), "sheet", 1));
  if (r) setActiveLayer(r.value);
}

/** Fills `into` with the Model and Layout tabs of the drawing's layers. Returns the call that takes them down. */
export function mountLayoutTabs(into: HTMLElement): () => void {
  const bar = h("div", { cls: "lk-layout-tabs", attrs: { role: "tablist", "aria-label": "Layouts" } });
  let signature = "";

  /** Rebuilds the tabs when the layers change; otherwise only the active tab moves. */
  const sync = (): void => {
    const s = store.session;
    const layers = s?.doc.layers() ?? [];
    const active = layers.find((l) => l.id === store.activeLayerId);
    const designs = layers.filter((l) => l.kind === "design");
    const sheets = layers.filter((l) => l.kind === "sheet");
    if (active?.kind === "design") lastDesign = active.id;
    const modelOn = active?.kind === "design";
    const sig = [
      s ? "s" : "-",
      modelOn ? "m" : "",
      store.activeLayerId ?? "",
      ...sheets.map((l) => `${l.id}\u0001${l.name}`),
      designs.length > 0 ? "d" : "",
    ].join("\u0002");
    if (sig === signature) return;
    signature = sig;
    const tabs: HTMLElement[] = [];
    if (s) {
      tabs.push(
        tab("Model", "Design layers", modelOn, designs.length > 0, () => {
          const target = designs.find((l) => l.id === lastDesign) ?? designs[0];
          if (target) setActiveLayer(target.id);
        }),
      );
      for (const sheet of sheets) {
        tabs.push(tab(sheet.name, `Sheet layer ${sheet.name}`, store.activeLayerId === sheet.id, true, () => setActiveLayer(sheet.id)));
      }
      tabs.push(h("button", { cls: "lk-lt-tab lk-lt-add", text: "+", title: "New sheet layer", attrs: { type: "button", "aria-label": "New sheet layer" } }));
      (tabs.at(-1) as HTMLButtonElement).addEventListener("click", newSheetLayer);
    }
    bar.replaceChildren(...tabs);
  };

  const offs = [store.on(["session", "layer"], sync)];
  sync();
  into.append(bar);
  return () => {
    for (const off of offs) off();
    bar.remove();
  };
}

/** One flat tab; the active one is lighter and has no bottom edge. */
function tab(label: string, title: string, on: boolean, enabled: boolean, run: () => void): HTMLButtonElement {
  const btn = h("button", {
    cls: on ? "lk-lt-tab on" : "lk-lt-tab",
    text: label,
    title,
    attrs: { type: "button", role: "tab", "aria-selected": String(on), "aria-label": title },
  });
  btn.disabled = !enabled;
  btn.addEventListener("click", run);
  return btn;
}
