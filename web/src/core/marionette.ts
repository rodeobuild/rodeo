// Marionette, Vectorworks' visual scripting, as a drawing stores it. A Marionette node is a plug-in
// object (type 86) whose parameters (type 48) use the record format MarionetteNode; a wrapper is one
// whose format is MarionetteObject2D, and it holds a network in its style. A node's script is an aux
// record (type 76) tagged CSPM, its text UTF-16LE from +0x56 to a final NUL. Its label, kind and port
// names are in its parameters (NodeName, NodeType, NodeDef_DataPorts); its typed controls are the JSON in
// NodeDef_OIPControls. There is no link record: a wire is an open polyline (type 21, closed flag 0) drawn
// inside its source node, from an output port's centre to an input port's centre of another node.
//
// Nothing here runs a script. Rodeo reads the networks; the Marionette runtime is not in Rodeo.

import { f64, u16 } from "./bytes.ts";
import { readPluginMatrix } from "./encode.ts";
import type { Model } from "./model.ts";
import { guidOf, layerTexts } from "./model.ts";
import { readValues, RECORD, recordFormat } from "./params.ts";
import type { Rec } from "./records.ts";

const PLUGIN = 86;
const ARC = 6;
const POLYLINE = 21;
const LAYER = 31;
const AUX = 76;
const PORT_NAME_FORMAT = "MarionetteNode";
const WRAPPER_FORMAT = "MarionetteObject2D";
/** how close (drawing units) a wire's end must be to a port's centre */
const PORT_TOLERANCE = 0.6;
/** the arc's centre is (y, x) at these offsets in a type-6 record, in its own frame */
const ARC_CENTRE_Y = 0xb0;
const ARC_CENTRE_X = 0xb8;
/** an open polyline: closed flag, vertex count, then 36-byte vertices (y then x at the start) */
const POLY_CLOSED = 0x8d;
const POLY_COUNT = 0x8e;
const POLY_FIRST = 0x90;
const POLY_STEP = 36;
const CSPM_TEXT = 0x56;

/** A control in a node's Object Info: its name in the script, its label, its type code and its value. */
export interface MarionetteControl {
  readonly name: string;
  readonly label: string;
  readonly type: number;
  readonly value: unknown;
}

/** A node or a wrapper (a plug-in object that holds a network in its style). */
export interface MarionetteNode {
  /** the plug-in object's GUID */
  readonly id: string;
  readonly kind: "node" | "wrapper";
  /** NodeType, e.g. "add" or "Wrapper" */
  readonly type: string;
  /** the label the user gave the node, or its type when it has none */
  readonly name: string;
  /** the layer it is on, or null (inside a symbol definition, or no layer) */
  readonly layerId: string | null;
  /** the GUID of the record that holds it: a layer, a group, or a symbol definition */
  readonly parentId: string | null;
  /** input and output port names, in the order of NodeDef_DataPorts */
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly controls: readonly MarionetteControl[];
  /** the script's text, or null when the node has none; read when first asked */
  readonly script: string | null;
}

export interface MarionettePortRef {
  readonly node: string;
  /** the port's name */
  readonly port: string;
  /** its position among the node's inputs or outputs, which tells ports of the same name apart */
  readonly index: number;
}

/** A wire from an output port to an input port. */
export interface MarionetteWire {
  readonly from: MarionettePortRef;
  readonly to: MarionettePortRef;
}

/** The nodes that sit in one container (a layer, a group or a symbol definition) and the wires between them. */
export interface MarionetteNetwork {
  /** the container's GUID */
  readonly id: string;
  /** the container's kind: "layer", "group" or "symbol-definition" */
  readonly container: string;
  /** the container's name when it has one */
  readonly name: string;
  /** the wrapper whose style holds the container, or null */
  readonly wrapperId: string | null;
  readonly nodes: readonly MarionetteNode[];
  readonly wires: readonly MarionetteWire[];
}

type Kind = MarionetteNode["kind"];

/** The name indexes of the two Marionette formats, and which kind each one is. */
function formatKinds(model: Model): Map<number, Kind> {
  const out = new Map<number, Kind>();
  for (const [index, name] of model.names) {
    if (name === PORT_NAME_FORMAT) out.set(index, "node");
    else if (name === WRAPPER_FORMAT) out.set(index, "wrapper");
  }
  return out;
}

/** The parameter record of a plug-in object when it is a Marionette node's, with its kind. */
function paramOf(r: Rec, kinds: ReadonlyMap<number, Kind>): { param: Rec; kind: Kind } | null {
  for (const c of r.children) {
    if (c.type !== RECORD) continue;
    const kind = kinds.get(recordFormat(c.data));
    if (kind) return { param: c, kind };
  }
  return null;
}

function listOf(text: unknown, key: string): unknown[] {
  if (typeof text !== "string" || !text) return [];
  try {
    const list = (JSON.parse(text) as Record<string, unknown>)[key];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function layerOf(r: Rec): string | null {
  for (let p = r.parent; p; p = p.parent) if (p.type === LAYER) return guidOf(p);
  return null;
}

/** The script's text: the CSPM aux record's UTF-16 from +0x56 to its final NUL. */
function scriptOf(r: Rec): string | null {
  const aux = r.children.find((c) => c.type === AUX && c.data.length >= 0x54 && String.fromCharCode(c.data[0x50], c.data[0x51], c.data[0x52], c.data[0x53]) === "CSPM");
  if (!aux) return null;
  const d = aux.data;
  let end = CSPM_TEXT;
  while (end + 1 < d.length && (d[end] | d[end + 1]) !== 0) end += 2;
  return new TextDecoder("utf-16le").decode(d.subarray(CSPM_TEXT, end));
}

/** The plug-in object record each node was read from (model.rec does not index objects inside groups). */
const recOfNode = new WeakMap<MarionetteNode, Rec>();

function nodeOf(model: Model, r: Rec, kinds: ReadonlyMap<number, Kind>): MarionetteNode | null {
  const found = paramOf(r, kinds);
  if (!found) return null;
  const fmt = model.formatDef(recordFormat(found.param.data));
  const values = new Map<string, unknown>();
  for (const f of (fmt && readValues(found.param.data, fmt)) ?? []) values.set(f.name, f.value);
  const text = (key: string): string => {
    const v = values.get(key);
    return typeof v === "string" ? v : "";
  };
  const ports = listOf(text("NodeDef_DataPorts"), "data") as { name?: unknown; input?: unknown }[];
  const portNames = (input: boolean): string[] => ports.filter((p) => !!p.input === input).map((p) => String(p.name ?? ""));
  const controls = listOf(text("NodeDef_OIPControls"), "data") as { varName?: unknown; text?: unknown; type?: unknown; value?: unknown }[];
  const type = text("NodeType");
  const label = text("NodeName");
  const id = guidOf(r);
  const parent = r.parent;
  let script: string | null | undefined;
  const node: MarionetteNode = {
    id,
    kind: found.kind,
    type,
    name: label || type || (found.kind === "wrapper" ? "Marionette object" : "Marionette node"),
    layerId: layerOf(r),
    parentId: parent ? guidOf(parent) : null,
    inputs: portNames(true),
    outputs: portNames(false),
    controls: controls.map((c) => ({
      name: String(c.varName ?? ""),
      label: String(c.text ?? "") || String(c.varName ?? ""),
      type: typeof c.type === "number" ? c.type : 0,
      value: c.value,
    })),
    // the script is decoded only when somebody reads it: a drawing can hold many nodes
    get script(): string | null {
      if (script === undefined) script = scriptOf(r);
      return script;
    },
  };
  recOfNode.set(node, r);
  return node;
}

const listCache = new WeakMap<Rec[], readonly MarionetteNode[]>();

/**
 * Every Marionette node and wrapper in the drawing, in record order. Only plug-in objects are looked
 * at, and only their parameter records; the list is kept while the drawing's records stay the same.
 */
export function marionetteNodes(model: Model): readonly MarionetteNode[] {
  const cached = listCache.get(model.recs);
  if (cached) return cached;
  const kinds = formatKinds(model);
  const out: MarionetteNode[] = [];
  if (kinds.size) {
    for (const r of model.recs) {
      if (r.type !== PLUGIN) continue;
      const node = nodeOf(model, r, kinds);
      if (node) out.push(node);
    }
  }
  listCache.set(model.recs, out);
  return out;
}

/** The Marionette node or wrapper with this GUID, or null when that object is not one. */
export function marionetteNodeAt(model: Model, id: string): MarionetteNode | null {
  const kinds = formatKinds(model);
  for (const r of model.recs) {
    if (r.type === PLUGIN && guidOf(r) === id) return nodeOf(model, r, kinds);
  }
  return null;
}

/** The drawn records inside a node: its own groups, arcs and polylines, not those of a node nested in it. */
function drawnIn(r: Rec, out: Rec[] = []): Rec[] {
  for (const c of r.children) {
    if (c.type === PLUGIN || c.type === AUX || c.type === RECORD) continue;
    out.push(c);
    drawnIn(c, out);
  }
  return out;
}

interface Port {
  readonly node: string;
  readonly index: number;
  readonly name: string;
  /** world position */
  readonly x: number;
  readonly y: number;
}

interface NodePorts {
  readonly inputs: Port[];
  readonly outputs: Port[];
}

/** A node's port arcs as world points: inputs on its left edge, outputs on its right edge, each sorted top to bottom. */
function portsOf(model: Model, node: MarionetteNode): NodePorts {
  const r = recOfNode.get(node);
  const empty = { inputs: [], outputs: [] };
  if (!r) return empty;
  const found = paramOf(r, formatKinds(model));
  if (!found) return empty;
  const fmt = model.formatDef(recordFormat(found.param.data));
  const values = fmt ? readValues(found.param.data, fmt) : null;
  const width = Number(values?.find((f) => f.name === "NodeWidth")?.value ?? 0);
  const at = new Map<string, { x: number; y: number }>();
  for (const c of drawnIn(r)) {
    if (c.type !== ARC) continue;
    const x = f64(c.data, ARC_CENTRE_X);
    const y = f64(c.data, ARC_CENTRE_Y);
    if (x > -2 && x < width + 2) at.set(`${x.toFixed(0)},${y.toFixed(0)}`, { x, y });
  }
  const arcs = [...at.values()];
  const left = arcs.filter((a) => Math.abs(a.x) < 2).sort((a, b) => a.y - b.y);
  const right = arcs.filter((a) => Math.abs(a.x - width) < 2).sort((a, b) => a.y - b.y);
  const m = readPluginMatrix(r.data);
  const world = (a: { x: number; y: number }) => ({ x: m.a * a.x + m.c * a.y + m.e, y: m.b * a.x + m.d * a.y + m.f });
  const names = (input: boolean) => (input ? node.inputs : node.outputs);
  const port = (a: { x: number; y: number }, k: number, input: boolean): Port => {
    const w = world(a);
    return { node: node.id, index: k, name: names(input)[k] ?? `#${k}`, x: w.x, y: w.y };
  };
  return { inputs: left.map((a, k) => port(a, k, true)), outputs: right.map((a, k) => port(a, k, false)) };
}

/**
 * The wires between the given nodes: each open polyline drawn inside a node, from one of its own
 * output ports to an input port of a node, once per pair of ports (each wire is drawn twice).
 */
export function marionetteWires(model: Model, nodes: readonly MarionetteNode[] = marionetteNodes(model)): MarionetteWire[] {
  const ports = nodes.map((n) => portsOf(model, n));
  const inputs = ports.flatMap((p) => p.inputs);
  const seen = new Set<string>();
  const out: MarionetteWire[] = [];
  nodes.forEach((n, i) => {
    const r = recOfNode.get(n);
    if (!r) return;
    for (const c of drawnIn(r)) {
      if (c.type !== POLYLINE || c.data[POLY_CLOSED] !== 0) continue;
      const count = u16(c.data, POLY_COUNT);
      if (count < 2 || POLY_FIRST + POLY_STEP * count > c.data.length) continue;
      const first = { x: f64(c.data, POLY_FIRST + 8), y: f64(c.data, POLY_FIRST) };
      const lastAt = POLY_FIRST + POLY_STEP * (count - 1);
      const last = { x: f64(c.data, lastAt + 8), y: f64(c.data, lastAt) };
      const m = readPluginMatrix(r.data);
      const mapPoint = (p: { x: number; y: number }) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
      const start = mapPoint(first);
      const end = mapPoint(last);
      const from = ports[i].outputs.find((p) => Math.hypot(p.x - start.x, p.y - start.y) < PORT_TOLERANCE);
      if (!from) continue;
      const to = inputs.find((p) => Math.hypot(p.x - end.x, p.y - end.y) < PORT_TOLERANCE);
      if (!to) continue;
      const key = `${from.node}.${from.index}>${to.node}.${to.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        from: { node: from.node, port: from.name, index: from.index },
        to: { node: to.node, port: to.name, index: to.index },
      });
    }
  });
  return out;
}

/** The networks the nodes sit in, one per container, each with the wires whose source node is in it. */
export function marionetteNetworks(model: Model, nodes: readonly MarionetteNode[] = marionetteNodes(model)): MarionetteNetwork[] {
  const wires = marionetteWires(model, nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groups = new Map<string, MarionetteNode[]>();
  for (const n of nodes) {
    const key = n.parentId ?? "";
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }
  const out: MarionetteNetwork[] = [];
  for (const [id, members] of groups) {
    // the container is the record each node sits in (the index of model.rec leaves out objects in groups)
    const container = recOfNode.get(members[0])?.parent ?? null;
    // the wrapper whose style holds the container: the nearest plug-in above it that is a wrapper
    let wrapperId: string | null = null;
    for (let p = container?.parent ?? null; p && !wrapperId; p = p.parent) {
      if (p.type !== PLUGIN) continue;
      const above = byId.get(guidOf(p));
      if (above?.kind === "wrapper") wrapperId = above.id;
    }
    const memberIds = new Set(members.map((m) => m.id));
    const name = !container ? "" : container.type === LAYER ? (layerTexts(container.data).name ?? "") : (model.names.get(container.nameIndex) ?? "");
    out.push({
      id,
      container: container?.typeName ?? "none",
      name,
      wrapperId,
      nodes: members,
      wires: wires.filter((w) => memberIds.has(w.from.node)),
    });
  }
  return out;
}
