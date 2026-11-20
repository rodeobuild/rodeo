// Checks that a roof face's body takes the texture of the component slab with the same "dcep" index
// (componentTexture in model3d.ts). Run from web/:
//   npx tsx src/core/roofTexture.check.ts
// Synthetic records only: a slab with no texture of its own, five bodies with indices 0 to 4 and
// component slabs with the same indices. Index 0 has an image texture, index 1 a texture with no
// image, index 2 a texture of its own that is missing from the resources, index 3 none, and a body
// with no index at all. Only the first must take a texture; nothing is drawn.

import type { Model } from "./model.ts";
import { Rec } from "./records.ts";
import { componentTexture } from "./model3d.ts";
import type { ResourceInfo } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const AUX = 76;
const SLAB = 71;
const BODY = 114;

/** A TDMD aux record of the given kind with one i32 value under each key, as the file stores it. */
function tdmd(kind: string, values: Record<number, number>): Rec {
  const keys = Object.keys(values).map(Number);
  const dir = 0x60;
  const bodyAt = dir + 6 * keys.length;
  let size = bodyAt;
  const entries = keys.map((k) => ({ key: k, at: size, len: 6 + 4 }));
  for (const e of entries) size += e.len;
  const d = new Uint8Array(size);
  const dv = new DataView(d.buffer);
  d[0x19] = AUX;
  for (let i = 0; i < 4; i++) d[0x50 + i] = "TDMD".charCodeAt(i);
  for (let i = 0; i < 4; i++) d[0x56 + i] = kind.charCodeAt(i);
  dv.setUint16(0x5a, keys.length, true);
  keys.forEach((k, i) => {
    const e = entries[i];
    dv.setUint16(dir + 6 * i, k, true);
    dv.setUint32(dir + 6 * i + 2, e.at - dir, true);
    dv.setUint16(e.at, 8, true); // type i32
    dv.setUint32(e.at + 2, 1, true); // one value
    dv.setInt32(e.at + 6, values[k], true);
  });
  return new Rec(d);
}

function withChildren(r: Rec, children: Rec[]): Rec {
  for (const c of children) c.parent = r;
  r.children = children;
  return r;
}

/** A slab (71) or body (114) record, with its aux children. */
function record(type: number, children: Rec[]): Rec {
  const d = new Uint8Array(0x100);
  d[0x19] = type;
  return withChildren(new Rec(d), children);
}

const slabTexture = (t: number): Rec => record(SLAB, [tdmd("ttwr", { 1: 3, 3: t })]);
const component = (index: number, texture: number): Rec => record(SLAB, [tdmd("dcep", { 0: index }), tdmd("ttwr", { 1: 3, 3: texture })]);
const body = (index: number | null): Rec => record(BODY, index === null ? [] : [tdmd("dcep", { 0: index })]);

// the roof face: no texture of its own; components by index 0 to 4
const SHAKE = 7;
const NO_IMAGE = 8;
const MISSING = 9;
const images = new Map<number, ResourceInfo>([[SHAKE, {} as ResourceInfo]]);
const roof = withChildren(record(SLAB, [tdmd("ttwr", { 1: 3, 3: -1 })]), [
  component(0, SHAKE),
  component(1, NO_IMAGE),
  component(2, MISSING),
  component(3, -1),
]);
const doc = { classRecs: new Map() } as unknown as Model;

check(componentTexture(doc, roof, body(0), images) === SHAKE, "a body with index 0 takes its component's image texture");
check(componentTexture(doc, roof, body(1), images) === -1, "a texture with no image is not taken");
check(componentTexture(doc, roof, body(2), images) === -1, "a texture missing from the resources is not taken");
check(componentTexture(doc, roof, body(3), images) === -1, "a component with no texture gives none");
check(componentTexture(doc, roof, body(4), images) === -1, "a body with an index no component has gives none");
check(componentTexture(doc, roof, body(null), images) === -1, "a body with no index gives none");

// the component's texture is read as the slab's own would be
const other = withChildren(record(SLAB, [tdmd("ttwr", { 1: 3, 3: -1 })]), [component(0, SHAKE)]);
check(componentTexture(doc, other, body(0), images) === SHAKE, "a slab with one component of the same index");
check(componentTexture(doc, slabTexture(SHAKE), body(0), images) === -1, "a slab with no components gives none");

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
