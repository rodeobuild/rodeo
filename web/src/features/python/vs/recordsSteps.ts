// (steps, snapshot parts and host answers of records.ts: see steps.ts)
//
// What the script's copy of the drawing holds about data records, resource lists, symbol definitions
// and plug-in objects, and the steps that change the drawing for them: a record format and its fields
// are made or extended, records attached and detached, a symbol is made from the objects drawn between
// BeginSym and EndSym (and its instances placed), and a plug-in object is copied from one the drawing has.

import { store } from "../../../app/state.ts";
import type { EditSession, FieldKind, ObjectInfo, RecordValue, ResourceKind, Shape, VwxDocument } from "../../../core/types.ts";
import { registerObjectSnapshot, registerResult, registerSnapshot, registerStep } from "../steps.ts";

/** Vectorworks' record field type codes (Appendix E, record field types) as the kinds of field Rodeo keeps. */
function kindOf(code: number): FieldKind {
  switch (code) {
    case 1:
      return "integer";
    case 2:
      return "boolean";
    case 3:
    case 5:
    case 6:
    case 7:
    case 8:
    case 16:
      return "number";
    case 4:
      return "text";
    case 9:
      return "dimension";
    case 10:
      return "angle";
    case 14:
      return "area";
    case 15:
      return "volume";
    default:
      throw new Error(`a field type of ${code} isn't available in Rodeo yet`);
  }
}

/** The field type code a kind of field is shown with (a kind Rodeo keeps as text has no code of its own). */
function codeOf(kind: FieldKind): number {
  switch (kind) {
    case "integer":
      return 1;
    case "boolean":
      return 2;
    case "number":
      return 3;
    case "dimension":
      return 9;
    case "angle":
      return 10;
    case "area":
      return 14;
    case "volume":
      return 15;
    default:
      return 4;
  }
}

/** The resource kinds a resource list can hold, by Vectorworks' object type number (Appendix D). */
const RESOURCE_TYPES: Partial<Record<ResourceKind, number>> = {
  symbol: 16,
  worksheet: 18,
  "record-format": 47,
  hatch: 66,
  "line-type": 96,
  texture: 97,
  "roof-style": 102,
  "slab-style": 107,
  tile: 108,
  "text-style": 109,
  background: 115,
  "image-fill": 119,
  gradient: 120,
};

registerSnapshot((s) => {
  const doc = s.doc;
  return {
    recordFields: doc.recordFormats().map((f) => ({
      format: f.format,
      name: f.name,
      fields: (doc.recordFormatFields(f.format) ?? []).map((x) => ({ name: x.name, type: codeOf(x.kind), value: x.value })),
    })),
    resources: doc.resources().flatMap((r) => {
      const type = RESOURCE_TYPES[r.kind];
      return type === undefined ? [] : [{ type, index: r.index, name: r.name, folder: r.folder }];
    }),
    pluginKinds: s.pluginKinds().map((k) => ({ id: k.id, name: k.name })),
    symbolObjects: symbolContents(s.doc),
    savedSettings: readSaved(),
  };
});

/** The most objects of a symbol definition the script's copy holds, and of all definitions together. */
const SYMBOL_DEF_CAP = 500;
const SYMBOL_OBJECT_CAP = 20000;

/**
 * Each symbol definition's contents (up to the caps), opened in turn for reading as the document lists
 * them, and the editor's symbol edit put back as it was. A definition over a cap is left out: the script's
 * calls on it then say so.
 */
function symbolContents(doc: VwxDocument): unknown[] {
  const out: unknown[] = [];
  let total = 0;
  const restore = store.symbolEdit?.index ?? null;
  try {
    for (const def of doc.symbolDefs()) {
      const id = doc.openSymbol(def.index);
      if (id === null) continue;
      const list = doc.objects(id);
      if (list.length > SYMBOL_DEF_CAP || total + list.length > SYMBOL_OBJECT_CAP) continue;
      total += list.length;
      const objects = list.map((o) => symbolObject(o, doc));
      out.push({ index: def.index, type: definitionType(list), objects });
    }
  } finally {
    doc.openSymbol(restore);
  }
  return out;
}

/** An object of a definition's contents, in the shape runner.ts's snapshot gives an object. */
function symbolObject(o: ObjectInfo, doc: VwxDocument): Record<string, unknown> {
  const g = o.shape;
  const box = g?.bbox ?? o.bounds ?? null;
  return {
    id: o.id,
    type: o.type,
    typeName: o.typeName,
    layer: o.layerId,
    parent: o.parentId,
    cls: o.className,
    name: o.name ?? "",
    bbox: box ? [box.x0, box.y0, box.x1, box.y1] : null,
    attrs: o.attrs,
    byClass: o.byClass ?? [],
    ins: o.insertion ? [o.insertion.x, o.insertion.y] : null,
    turned: o.turned ?? 0,
    sym: o.symbol ?? null,
    records: Object.fromEntries(
      doc.records(o.id).map((r) => [r.name, Object.fromEntries(r.fields.map((f) => [f.name, f.kind === "other" ? null : f.value]))]),
    ),
    shape: g ? shapeOf(g) : null,
  };
}

function shapeOf(g: Shape): Record<string, unknown> {
  return {
    kind: g.roundRect ? "roundrect" : g.kind,
    pts: g.roundRect ? g.roundRect.corners.map((p) => [p.x, p.y]) : g.points.map((p) => [p.x, p.y]),
    closed: g.closed,
    verts: g.vertices?.map((v) => [v.p.x, v.p.y, v.kind, v.radius]),
    center: g.center ? [g.center.x, g.center.y] : undefined,
    rx: g.rx,
    ry: g.ry,
    rr: g.roundRect ? [g.roundRect.rx, g.roundRect.ry] : undefined,
    start: g.startAngle,
    sweep: g.sweepAngle,
    text: g.text,
    at: g.anchor ? [g.anchor.x, g.anchor.y] : undefined,
  };
}

/**
 * GetSymbolType's answer for a definition, read from its contents: 2 (hybrid) when it has 2D shapes and
 * 3D objects, 1 when only 3D, else 0. Vectorworks keeps the type as a setting; Rodeo doesn't read that.
 */
function definitionType(list: readonly ObjectInfo[]): number {
  const has2D = list.some((o) => o.shape !== null);
  const has3D = list.some((o) => o.bounds !== undefined);
  return has2D && has3D ? 2 : has3D ? 1 : 0;
}

const SAVED_KEY = "rodeo.vsSavedSettings";

/** The saved settings of this browser (a script's SetSavedSetting), by "category" + unit separator + "setting". */
function readSaved(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const v: unknown = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// the settings a run set are kept when it ends, for later runs in this browser
registerResult((result) => {
  const set = result.savedSettingsSet;
  if (!Array.isArray(set) || set.length === 0) return;
  try {
    const cur = readSaved();
    for (const [c, k, v] of set as [string, string, string][]) cur[`${c}\x1f${k}`] = String(v);
    localStorage.setItem(SAVED_KEY, JSON.stringify(cur));
  } catch {
    // no storage (a private window): the settings hold for the run only
  }
});

// a plug-in object's parameter record, by name, so GetParametricRecord can give it
registerObjectSnapshot((o, doc) => {
  if (o.type !== 86) return null;
  return { parametricRecord: doc.records(o.id).find((r) => r.parametric)?.name ?? null };
});

/** The format a step names, by name in the drawing as it is when the step runs. */
function formatNamed(s: EditSession, name: string): number {
  const f = s.doc.recordFormats().find((x) => x.name === name);
  if (!f) throw new Error(`the drawing has no record format named "${name}"`);
  return f.format;
}

/** Symbol definitions made in one run, by the script's (negative) index, as the library gave them. */
const madeSymbols = new WeakMap<Map<string, string>, Map<number, number>>();

registerStep("recfield", (a, ctx) => {
  const [rec, field, code, value, _flag] = a;
  const name = String(rec);
  const fname = String(field);
  const kind = kindOf(Number(code));
  const spec = { name: fname, kind, value: value as RecordValue };
  const format = ctx.s.doc.recordFormats().find((x) => x.name === name);
  if (!format) {
    ctx.s.createRecordFormat(name, [spec]);
    return;
  }
  const have = ctx.s.doc.recordFormatFields(format.format) ?? [];
  if (have.some((f) => f.name === fname)) return;
  ctx.s.editRecordFormat(format.format, [...have.map((f) => ({ name: f.name, kind: f.kind, value: f.value, from: f.name })), spec]);
});

registerStep("recattach", (a, ctx) => {
  ctx.s.attachRecord([ctx.real(a[0])], formatNamed(ctx.s, String(a[1])));
});

registerStep("recdetach", (a, ctx) => {
  const id = ctx.real(a[0]);
  const format = formatNamed(ctx.s, String(a[1]));
  if (ctx.s.doc.records(id).some((r) => r.format === format)) ctx.s.detachRecord([id], format);
});

registerStep("recset", (a, ctx) => {
  ctx.s.setRecordField(ctx.real(a[0]), formatNamed(ctx.s, String(a[1])), String(a[2]), a[3] as RecordValue);
});

registerStep("symdef", (a, ctx) => {
  const [tmp, name, ids] = a;
  const list = ctx.ids(ids).map((v) => ctx.real(v));
  const inst = ctx.s.createSymbol(list, String(name));
  // the definition is what EndSym makes: the instance createSymbol leaves where the objects were goes
  const index = ctx.s.doc.object(inst)?.symbol;
  ctx.s.deleteObjects([inst]);
  if (index === undefined) throw new Error(`the symbol "${String(name)}" couldn't be made`);
  let map = madeSymbols.get(ctx.made);
  if (!map) {
    map = new Map();
    madeSymbols.set(ctx.made, map);
  }
  map.set(Number(tmp), index);
});

registerStep("symbolat", (a, ctx) => {
  const [tmp, layer, sym, at, cls] = a;
  const index = madeSymbols.get(ctx.made)?.get(Number(sym));
  if (index === undefined) throw new Error("a symbol placed here wasn't made before it");
  const p = at as number[];
  ctx.made.set(String(tmp), ctx.s.insertSymbol(ctx.real(layer), index, { x: Number(p[0]), y: Number(p[1]) }, cls == null ? undefined : ctx.classIndex(String(cls))));
});

registerStep("setlayer", (a, ctx) => {
  ctx.s.setObjectLayer([ctx.real(a[0])], ctx.real(a[1]));
});

// SetName on a layer handle: the layer keeps its sheet title and its other settings
registerStep("layername", (a, ctx) => {
  ctx.s.renameLayer(ctx.real(a[0]), String(a[1]));
});

registerStep("plugcopy", (a, ctx) => {
  const [tmp, source, layer, at, _angle] = a;
  const p = at as number[];
  const angle = Number(_angle);
  ctx.made.set(String(tmp), ctx.s.insertPlugin(String(source), ctx.real(layer), { x: Number(p[0]), y: Number(p[1]) }, angle));
});
