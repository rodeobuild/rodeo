// Marionette in the drawing: Object Info shows a Marionette node's kind, ports, controls and script
// (View Script… opens it read-only), and Tools › Plug-ins › Marionette Nodes… lists the networks of
// the drawing, where a node can be picked out in the drawing. Rodeo reads these networks (core/marionette.ts)
// and does not run them: the Marionette runtime is not in Rodeo.

import { setActiveLayer, setSelection } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { registerInfoSection, registerMenu } from "../../app/ext.ts";
import { showDialog } from "../../app/menubar.ts";
import { foldingSection } from "../../app/panels/sections.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { type MarionetteNetwork, type MarionetteNode, marionetteNetworks, marionetteNodeAt, marionetteNodes } from "../../core/marionette.ts";
import { Model } from "../../core/model.ts";
import "./python.css";

const NOT_RUN = "Rodeo can't run Marionette scripts yet.";
const NETWORK_IN_STYLE = "This Marionette object's network is kept in its style; Rodeo can't run it yet.";

/** A value as Object Info shows it: text as it is, a number or a flag as words, anything else as JSON. */
function valueText(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "";
  try {
    return JSON.stringify(v) ?? "";
  } catch {
    return "";
  }
}

function row(label: string, control: Node): HTMLElement {
  return h("label", { cls: "field" }, h("span", { cls: "field-label", text: label }), control);
}

function value(text: string): HTMLElement {
  return h("span", { cls: "value mn-value", text });
}

function ports(names: readonly string[]): HTMLElement {
  if (!names.length) return value("None");
  return h("span", { cls: "value mn-value", text: names.join(", ") });
}

/** The read-only script window: the script in a scrollable monospaced box, with Copy. */
export function openMarionetteScript(node: MarionetteNode): void {
  const script = node.script;
  if (script === null) return;
  const copy = h("button", { cls: "btn small", text: "Copy", attrs: { type: "button" } });
  copy.addEventListener("click", () => {
    navigator.clipboard
      .writeText(script)
      .then(() => toast("Script copied.", "info"))
      .catch(() => toast("The script couldn't be copied. Select it and copy by hand.", "error"));
  });
  void showDialog<null>({
    title: `Marionette Script: ${node.name}`,
    cls: "mn-dialog",
    okLabel: "Close",
    body: [
      h("p", { cls: "menu-dialog-text mn-note", text: `${NOT_RUN} This text is read only.` }),
      h("div", { cls: "mn-copy-row" }, copy),
      h("pre", { cls: "mn-script", attrs: { tabindex: "0", "aria-label": "Script" }, text: script }),
    ],
    check: () => ({ value: null }),
  });
}

/**
 * The Marionette section of Object Info for a plug-in object: its kind, its ports and typed controls
 * and its script. Null when the object is not a Marionette node or wrapper.
 */
function marionetteSection(doc: Model, id: string): HTMLElement | null {
  const node = marionetteNodeAt(doc, id);
  if (!node) return null;
  const kind = node.kind === "wrapper" ? "Marionette object" : "Marionette node";
  const children: Node[] = [row("Kind", value(kind))];
  if (node.type) children.push(row("Node type", value(node.type)));
  children.push(row("Inputs", ports(node.inputs)), row("Outputs", ports(node.outputs)));
  for (const c of node.controls) children.push(row(c.label, value(valueText(c.value))));
  if (node.script !== null) {
    const view = h("button", { cls: "btn small", text: "View Script…", attrs: { type: "button" } });
    view.addEventListener("click", () => openMarionetteScript(node));
    children.push(h("div", { cls: "row-end" }, view));
  } else if (node.kind === "wrapper") {
    children.push(h("div", { cls: "note", text: NETWORK_IN_STYLE }));
  } else {
    children.push(h("div", { cls: "note", text: "This Marionette node has no script." }));
  }
  return foldingSection("objectInfo", "Marionette", ...children);
}

/** Picks the node out in the drawing: its layer becomes the active one and it is selected. */
function pickOut(node: MarionetteNode): void {
  if (!node.layerId) {
    toast("This node is inside a symbol, so it can't be picked out in the drawing.", "info");
    return;
  }
  if (!store.session?.doc.object(node.id)) {
    toast("This node can't be selected on its own in the drawing. Select its wrapper instead.", "info");
    return;
  }
  setActiveLayer(node.layerId);
  setSelection([node.id]);
}

function networkTitle(net: MarionetteNetwork, wrapperName: ReadonlyMap<string, string>): string {
  const what = net.container === "layer" ? "Layer" : net.container === "group" ? "Group" : net.container === "symbol-definition" ? "Symbol" : "Container";
  const inside = net.wrapperId ? ` in ${wrapperName.get(net.wrapperId) ?? "an object"}` : "";
  return `${what}${net.name ? ` ${net.name}` : ""}${inside}`;
}

/** Tools › Plug-ins › Marionette Nodes…: the drawing's networks and their nodes. */
export function openMarionetteNetworks(doc: Model): void {
  const nodes = marionetteNodes(doc);
  const networks = marionetteNetworks(doc, nodes);
  const wrapperName = new Map(nodes.filter((n) => n.kind === "wrapper").map((n) => [n.id, n.name] as const));
  let chosen: MarionetteNode | null = null;
  const body: Node[] = [];
  if (!nodes.length) {
    body.push(h("p", { cls: "menu-dialog-text mn-note", text: "This drawing has no Marionette nodes." }));
  }
  const list = h("div", { cls: "mn-networks" });
  for (const net of networks) {
    const wireText = `${net.wires.length} ${net.wires.length === 1 ? "wire" : "wires"}`;
    const rows = net.nodes.map((n) => {
      const pick = h("button", {
        cls: "btn small",
        text: n.name,
        attrs: { type: "button", title: n.kind === "wrapper" ? "Marionette object" : "Marionette node" },
      });
      pick.addEventListener("click", () => {
        chosen = n;
        pick.closest("form")?.requestSubmit();
      });
      const info = `${n.inputs.length} in, ${n.outputs.length} out`;
      const script = n.script === null ? null : h("button", { cls: "btn small", text: "View Script…", attrs: { type: "button" } });
      script?.addEventListener("click", () => openMarionetteScript(n));
      return h("div", { cls: "mn-node" }, pick, h("span", { cls: "muted mn-ports", text: info }), script);
    });
    list.append(
      h(
        "section",
        { cls: "mn-network" },
        h("h3", { cls: "mn-network-title", text: networkTitle(net, wrapperName) }),
        h("p", { cls: "mn-note", text: `${net.nodes.length} ${net.nodes.length === 1 ? "node" : "nodes"}, ${wireText}` }),
        ...rows,
      ),
    );
  }
  if (nodes.length) body.push(list);
  void showDialog<MarionetteNode | null>({
    title: "Marionette Nodes",
    cls: "mn-dialog",
    okLabel: "Close",
    body,
    check: () => ({ value: chosen }),
  }).then((picked) => {
    if (picked) pickOut(picked);
  });
}

registerMenu("Tools › Plug-ins", () => [
  {
    label: "Marionette Nodes…",
    enabled: () => store.session?.doc instanceof Model,
    run: () => {
      const doc = store.session?.doc;
      if (doc instanceof Model) openMarionetteNetworks(doc);
    },
  },
]);

registerInfoSection((doc, o) => (o.typeName === "plug-in-object" && doc instanceof Model ? marionetteSection(doc, o.id) : null));
