// 3MF, the 3D Manufacturing Format slicers and printers read, the reading side (no DOM). parse3mf
// reads the package (a zip of XML parts): the root model part named by _rels/.rels, its build items
// placed through their transforms, and each object's components resolved recursively, in the model
// parts the production extension names. Each object's triangles are split into parts by colour (the
// base materials and colour groups of the core and materials specs; alpha below full becomes opacity),
// and each build item's parts are grouped under the item's name when a file has more than one. Parts
// keep the file's units: the frame gives millimetres per unit and z up, which the import scales by.
// Objects other than model and surface (support and the rest) are left out and counted. Element and
// attribute names match by local name, since namespace prefixes vary.

import { unzip } from "./zip.ts";
import { parseXml, type XmlNode } from "./xml.ts";
import { MAX_FACES, tooMany } from "./mesh.ts";
import type { MeshFile, MeshPart } from "./mesh.ts";

/** How many components deep an object may nest before the rest are left out. */
const MAX_DEPTH = 16;
/** The millimetres in each unit a model's `unit` attribute names (millimeter when it names none). */
const UNIT_MM: Readonly<Record<string, number>> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};
/** Object types that hold printable geometry; the rest are left out. */
const PRINTED = new Set(["model", "surface"]);

/** A colour from a base material or colour group: 0..255 channels and alpha. */
interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** A triangle: its three vertex indices, and the colour resource and index it names (its pid and p1, else the object's). */
interface Tri {
  v: [number, number, number];
  pid: string | null;
  index: number;
}

/** A component of an object: the object it places, its transform (a 4 × 4 row-vector matrix) and the model part it is in, if not this one. */
interface Component {
  objectId: string;
  matrix: number[];
  path: string | null;
}

/** An object as the model part states it. */
interface ObjectDef {
  type: string;
  name: string | null;
  /** the default colour: its pid and pindex */
  pid: string | null;
  pindex: number;
  /** vertex positions, x, y, z per vertex (NaN where the file's value is not a number) */
  xyz: Float64Array;
  tris: Tri[];
  components: Component[];
}

/** A model part: its objects and its colour resources (base materials and colour groups) by id. */
interface ModelPart {
  objects: Map<string, ObjectDef>;
  colours: Map<string, (Rgba | null)[]>;
}

/** A build item: the object it places (in the model part named by `path`, else this one), its transform and its part number. */
interface BuildItem {
  objectId: string;
  matrix: number[];
  path: string | null;
  label: string | null;
}

/** The local part of a name: "m:colorgroup" is "colorgroup". */
function local(name: string): string {
  const at = name.indexOf(":");
  return at < 0 ? name : name.slice(at + 1);
}

/** An attribute by its local name ("p:path" is found as "path"), or null. */
function attr(node: XmlNode, name: string): string | null {
  if (name in node.attrs) return node.attrs[name];
  for (const key of Object.keys(node.attrs)) if (local(key) === name) return node.attrs[key];
  return null;
}

/** The child elements with a local name. */
function kids(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => local(c.name) === name);
}

/** A hex colour, #RRGGBB or #RRGGBBAA, or null. */
function hexColour(s: string | null): Rgba | null {
  const m = s ? /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.trim()) : null;
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: m[2] ? parseInt(m[2], 16) : 255 };
}

/** A 4 × 4 matrix, row-major, from a transform attribute's 12 numbers (identity when absent or not 12 numbers). */
function matrixOf(s: string | null): number[] {
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (!s) return id;
  const n = s.trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return id;
  // the file's twelve numbers are the x, y and z images (rows 0 to 2) and the origin (row 3)
  return [n[0], n[1], n[2], 0, n[3], n[4], n[5], 0, n[6], n[7], n[8], 0, n[9], n[10], n[11], 1];
}

/** a × b for 4 × 4 row-major matrices: a row vector times a, then b, is a row vector times a × b. */
function mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  return out;
}

/** The determinant of a matrix's 3 × 3 part: negative when it mirrors. */
function det3(m: number[]): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/** A point through a matrix, as a row vector times it. */
function apply(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [x * m[0] + y * m[4] + z * m[8] + m[12], x * m[1] + y * m[5] + z * m[9] + m[13], x * m[2] + y * m[6] + z * m[10] + m[14]];
}

/** The colour a (pid, index) pair names in a model part, or null. */
function colourOf(part: ModelPart, pid: string | null, index: number): Rgba | null {
  if (pid === null) return null;
  return part.colours.get(pid)?.[index] ?? null;
}

/** Whether vertex `v` of an object exists and has finite coordinates. */
function usable(obj: ObjectDef, v: number): boolean {
  const nv = obj.xyz.length / 3;
  return Number.isInteger(v) && v >= 0 && v < nv && Number.isFinite(obj.xyz[3 * v]) && Number.isFinite(obj.xyz[3 * v + 1]) && Number.isFinite(obj.xyz[3 * v + 2]);
}

/** An object element's mesh and components, with its type, name and default colour. */
function readObject(el: XmlNode): ObjectDef {
  const obj: ObjectDef = {
    type: attr(el, "type") ?? "model",
    name: attr(el, "name"),
    pid: attr(el, "pid"),
    pindex: Number(attr(el, "pindex") ?? 0),
    xyz: new Float64Array(0),
    tris: [],
    components: [],
  };
  for (const mesh of kids(el, "mesh")) {
    const verts = kids(mesh, "vertices").flatMap((v) => kids(v, "vertex"));
    obj.xyz = new Float64Array(3 * verts.length);
    verts.forEach((v, i) => {
      obj.xyz[3 * i] = Number(attr(v, "x"));
      obj.xyz[3 * i + 1] = Number(attr(v, "y"));
      obj.xyz[3 * i + 2] = Number(attr(v, "z"));
    });
    for (const list of kids(mesh, "triangles"))
      for (const t of kids(list, "triangle"))
        obj.tris.push({
          v: [Number(attr(t, "v1")), Number(attr(t, "v2")), Number(attr(t, "v3"))],
          pid: attr(t, "pid") ?? obj.pid,
          index: Number(attr(t, "p1") ?? obj.pindex),
        });
  }
  for (const comps of kids(el, "components"))
    for (const c of kids(comps, "component")) {
      const objectId = attr(c, "objectid");
      if (objectId !== null) obj.components.push({ objectId, matrix: matrixOf(attr(c, "transform")), path: attr(c, "path") });
    }
  return obj;
}

/** One model part: its objects and colour resources, and (for the root model) its build items. */
function readModel(root: XmlNode): { part: ModelPart; build: BuildItem[] } {
  const part: ModelPart = { objects: new Map(), colours: new Map() };
  for (const res of kids(root, "resources"))
    for (const el of res.children) {
      const id = attr(el, "id");
      if (id === null) continue;
      const name = local(el.name);
      if (name === "basematerials") part.colours.set(id, kids(el, "base").map((b) => hexColour(attr(b, "displaycolor"))));
      else if (name === "colorgroup") part.colours.set(id, kids(el, "color").map((c) => hexColour(attr(c, "color"))));
      else if (name === "object") part.objects.set(id, readObject(el));
    }
  const build: BuildItem[] = [];
  for (const b of kids(root, "build"))
    for (const item of kids(b, "item")) {
      const objectId = attr(item, "objectid");
      if (objectId !== null) build.push({ objectId, matrix: matrixOf(attr(item, "transform")), path: attr(item, "path"), label: attr(item, "partnumber") });
    }
  return { part, build };
}

/** A part name as the package's keys hold it: lower case, no leading slash, forward slashes. */
function normal(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

/** The package's files by normal name, and the name of its root model part. */
function packageOf(bytes: Uint8Array): { files: Map<string, () => Uint8Array>; rootName: string } {
  let entries: Map<string, () => Uint8Array>;
  try {
    entries = unzip(bytes);
  } catch {
    throw new Error("not a 3MF file (it isn't a zip package)");
  }
  const files = new Map<string, () => Uint8Array>();
  for (const [name, get] of entries) files.set(normal(name), get);
  let rootName: string | null = null;
  const rels = files.get("_rels/.rels");
  if (rels) {
    for (const r of kids(parseXml(new TextDecoder().decode(rels())), "Relationship")) {
      const target = attr(r, "Target");
      if (target && /\/3dmodel$/i.test(attr(r, "Type") ?? "")) {
        rootName = normal(target);
        break;
      }
    }
  }
  if (rootName === null || !files.has(rootName)) rootName = files.has("3d/3dmodel.model") ? "3d/3dmodel.model" : null;
  if (rootName === null) rootName = [...files.keys()].find((n) => n.endsWith(".model")) ?? null;
  if (rootName === null) throw new Error("not a 3MF file (no 3D model part in the package)");
  return { files, rootName };
}

/**
 * A 3MF file's triangles as parts. Each object's triangles are placed by its build items and their
 * components, split by colour; parts keep the file's units, with the frame giving millimetres per unit.
 * Throws when the file is not a 3MF package or holds no meshes.
 */
export function parse3mf(bytes: Uint8Array): MeshFile {
  const { files, rootName } = packageOf(bytes);
  const cache = new Map<string, { part: ModelPart; build: BuildItem[]; unit: string | null }>();
  const load = (key: string): { part: ModelPart; build: BuildItem[]; unit: string | null } => {
    let m = cache.get(key);
    if (!m) {
      const get = files.get(key);
      if (!get) throw new Error(`not a 3MF file (no model part named ${key})`);
      const root = parseXml(new TextDecoder().decode(get()));
      const read = readModel(root);
      m = { part: read.part, build: read.build, unit: attr(root, "unit") };
      cache.set(key, m);
    }
    return m;
  };
  const rootModel = load(rootName);
  const mm = UNIT_MM[(rootModel.unit ?? "millimeter").toLowerCase()] ?? 1;

  const skipped: Record<string, number> = {};
  const acc = new Map<string, { group: string | undefined; name: string; color: Rgba | null; faces: number[][] }>();
  let faces = 0;

  // the build's items; without any, the objects that no other object places
  let items = rootModel.build;
  if (items.length === 0) {
    const placed = new Set<string>();
    for (const o of rootModel.part.objects.values()) for (const c of o.components) if (c.path === null) placed.add(c.objectId);
    items = [...rootModel.part.objects.keys()]
      .filter((id) => !placed.has(id))
      .map((id) => ({ objectId: id, matrix: matrixOf(null), path: null, label: null }));
  }
  const grouped = items.length > 1;

  /** Adds an object's triangles, placed by `m`, to the accumulated parts; its components recurse. */
  const emit = (partKey: string, part: ModelPart, id: string, m: number[], inherited: Rgba | null, group: string, depth: number, stack: string[]): void => {
    const key = `${partKey}#${id}`;
    const obj = part.objects.get(id);
    if (!obj || depth > MAX_DEPTH || stack.includes(key)) {
      skipped.component = (skipped.component ?? 0) + 1;
      return;
    }
    if (!PRINTED.has(obj.type)) {
      skipped[obj.type] = (skipped[obj.type] ?? 0) + 1;
      return;
    }
    const flip = det3(m) < 0;
    const own = colourOf(part, obj.pid, obj.pindex) ?? inherited;
    for (const t of obj.tris) {
      const [a, b, c] = t.v;
      if (!([a, b, c].every((v) => usable(obj, v)) && a !== b && b !== c && a !== c)) {
        skipped["bad face"] = (skipped["bad face"] ?? 0) + 1;
        continue;
      }
      if (++faces > MAX_FACES) throw tooMany();
      const corners = [a, b, c].map((v) => apply(m, obj.xyz[3 * v], obj.xyz[3 * v + 1], obj.xyz[3 * v + 2]));
      // a mirrored placement turns the triangle inside out: its winding is put back
      const order = flip ? [corners[0], corners[2], corners[1]] : corners;
      const colour = colourOf(part, t.pid, t.index) ?? own;
      const name = obj.name ?? group;
      const k = `${group}\u0001${name}\u0001${colour ? `${colour.r},${colour.g},${colour.b},${colour.a}` : "-"}`;
      let entry = acc.get(k);
      if (!entry) acc.set(k, (entry = { group: grouped ? group : undefined, name, color: colour, faces: [] }));
      entry.faces.push(order.flat());
    }
    for (const comp of obj.components) {
      const next = comp.path === null ? partKey : normal(comp.path);
      emit(next, comp.path === null ? part : load(next).part, comp.objectId, mul(comp.matrix, m), own, group, depth + 1, [...stack, key]);
    }
  };

  for (const item of items) {
    const next = item.path === null ? rootName : normal(item.path);
    const part = load(next).part;
    const obj = part.objects.get(item.objectId);
    const group = item.label ?? obj?.name ?? `Object ${item.objectId}`;
    emit(next, part, item.objectId, item.matrix, null, group, 0, []);
  }
  if (faces === 0) throw new Error("no meshes in this 3MF file");

  // an object split into several colours names its parts "name 1", "name 2"…
  const keyOf = (e: { group: string | undefined; name: string }): string => `${e.group ?? ""}\u0001${e.name}`;
  const perName = new Map<string, number>();
  for (const e of acc.values()) perName.set(keyOf(e), (perName.get(keyOf(e)) ?? 0) + 1);
  const numbered = new Map<string, number>();
  const parts: MeshPart[] = [...acc.values()].map((e) => {
    const k = keyOf(e);
    let name = e.name;
    if ((perName.get(k) ?? 0) > 1) {
      const n = (numbered.get(k) ?? 0) + 1;
      numbered.set(k, n);
      name = `${e.name} ${n}`;
    }
    const out: MeshPart = { name, faces: e.faces };
    if (e.group !== undefined) out.group = e.group;
    if (e.color) {
      out.color = { r: e.color.r / 255, g: e.color.g / 255, b: e.color.b / 255 };
      if (e.color.a < 255) out.opacity = e.color.a / 255;
    }
    return out;
  });
  return { parts, skipped, frame: { mm, yUp: false } };
}
