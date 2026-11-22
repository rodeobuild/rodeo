// Checks the Marionette reader against a drawing that has networks. Run from web/:
//   npx tsx src/core/marionette.check.ts path/to/drawing.vwx
// With no path it prints a skip line and exits 0. The counts are those of the 2023 demo project
// "DoverDam" (a 330 MB file): 189 nodes and wrappers (127 and 62), 134 scripts of 40 distinct texts,
// and 153 wires in two networks of 39 and 114 wires, with no cycle. Needs a large heap:
//   NODE_OPTIONS=--max-old-space-size=8000 npx tsx src/core/marionette.check.ts path/to/DoverDam.vwx

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Model } from "./model.ts";
import { marionetteNetworks, marionetteNodes, marionetteNodeAt, marionetteWires, type MarionetteNode, type MarionetteWire } from "./marionette.ts";

const path = process.argv[2];
if (!path) {
  console.log("marionette: skipped (no drawing given)");
  process.exit(0);
}

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** Whether the wires form a graph with no cycle (Kahn's algorithm). */
function acyclic(nodes: readonly MarionetteNode[], wires: readonly MarionetteWire[]): boolean {
  const indeg = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>();
  for (const w of wires) {
    indeg.set(w.to.node, (indeg.get(w.to.node) ?? 0) + 1);
    const list = out.get(w.from.node) ?? [];
    list.push(w.to.node);
    out.set(w.from.node, list);
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  let done = 0;
  while (queue.length) {
    const id = queue.pop()!;
    done++;
    for (const next of out.get(id) ?? []) {
      const d = (indeg.get(next) ?? 0) - 1;
      indeg.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return done === indeg.size;
}

const t0 = performance.now();
const bytes = new Uint8Array(readFileSync(path));
const model = new Model(bytes, "check.vwx");
const t1 = performance.now();
const nodes = marionetteNodes(model);
const t2 = performance.now();
const wires = marionetteWires(model, nodes);
const t3 = performance.now();
const networks = marionetteNetworks(model, nodes);
const t4 = performance.now();
console.log(`open ${((t1 - t0) / 1000).toFixed(1)} s, node list ${(t2 - t1).toFixed(0)} ms, wires ${(t3 - t2).toFixed(0)} ms, networks ${(t4 - t3).toFixed(0)} ms`);

check(nodes.length === 189, `${nodes.length} nodes and wrappers (189)`);
check(nodes.filter((n) => n.kind === "node").length === 127, "127 nodes (MarionetteNode)");
check(nodes.filter((n) => n.kind === "wrapper").length === 62, "62 wrappers (MarionetteObject2D)");

const scripts = nodes.map((n) => n.script).filter((s): s is string => s !== null);
check(scripts.length === 134, `${scripts.length} scripts (134)`);
const distinct = new Set(scripts.map((s) => createHash("sha256").update(s, "utf16le").digest("hex")));
check(distinct.size === 40, `${distinct.size} distinct scripts (40)`);

check(wires.length === 153, `${wires.length} unique wires (153)`);
const withWires = networks.filter((n) => n.wires.length > 0).map((n) => n.wires.length).sort((a, b) => a - b);
check(withWires.length === 2 && withWires[0] === 39 && withWires[1] === 114, `wires in two networks of ${withWires.join(" and ")} (39 and 114)`);
check(acyclic(nodes, wires), "the wires have no cycle");

const outside = wires.filter((w) => !networks.some((n) => n.nodes.some((m) => m.id === w.from.node) && n.nodes.some((m) => m.id === w.to.node)));
check(outside.length === 0, "every wire joins two nodes of one network");

const sample = nodes.find((n) => n.kind === "node" && n.script !== null);
check(!!sample && marionetteNodeAt(model, sample.id)?.id === sample.id, "a node read by its id matches the list");
check(marionetteNodeAt(model, "00000000-0000-0000-0000-000000000000") === null, "an id that is not a plug-in object reads as null");

if (failures) {
  console.log(`marionette: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("marionette: ok");
