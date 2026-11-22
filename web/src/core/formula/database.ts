// Database rows of worksheets, worked out from the drawing: which objects a row's criteria
// (=DATABASE(...)) selects, what each column shows for them, how they are summarized and sorted,
// and the header row's cached totals. The file's own cached values are the test: database.ts is
// checked row by row against them in databaseCorpus.check.ts, and a column is claimed only where
// it matches.
//
// What is searched (measured on the public demo drawings, 2023 to 2026): every object of every
// layer that has a record of its own, design and sheet layers, hidden layers included, and objects
// inside walls (they list with a parent). Objects drawn from a symbol or a worksheet have no record
// and are not searched. Objects inside groups were not measured on their own. The index is one pass
// over the layers; records and their fields are decoded only when a criterion or a column reads them.

import type { Node, Value } from "./ast.ts";
import { evaluate, unsupported as engineUnsupported, type ObjectAccess } from "./engine.ts";
import { TOKEN as T } from "./names.ts";
import type { ObjectInfo, ObjectRecord, RecordField, VwxDocument } from "../types.ts";
import { millimetresPerUnit } from "../unitSize.ts";
import { readFormat } from "../params.ts";

const FORMAT_RECORD = 47;
const DATABASE = 0x029a;
const COUNT = 0x02c7;
const CONCAT = 0x00f3;
const KW_R = 0x0308;
const KW_L = 0x0305;
const KW_PON = 0x0328;
const KW_NOT_DLVP = 0x031e;
const KW_NOT_REF_DLVP = 0x0319;
/**
 * The 2025 and 2026 keywords the files use without names. 0x0345 is TRUE for every object: in all 7 rows
 * that use it alone (2025 and 2026 demos) the object set is the file's exactly, and FALSE matches none.
 * 0x031D is TRUE in 2 rows that use it alone, but in a 147-object row of the 2026 demo it matches neither
 * value, so it stays unsupported. 0x0346, 0x0348, 0x034D, 0x0350: no rule tested yet (0x034D is used
 * inside comparisons, which are not worked out).
 */
const UNNAMED_KEYWORDS: ReadonlySet<number> = new Set([0x031d, 0x0345, 0x0346, 0x0348, 0x034d, 0x0350]);
const UNNAMED_TRUE: ReadonlySet<number> = new Set([0x0345]);

/** a record field as read here: its kind and value, and the field type code of its record format (FORMAT.md §7.3) */
export interface FieldRead extends RecordField {
  readonly code: number;
}

/**
 * What the index reads from the document: `layers`, `objects` and `records` (the fallback: the
 * object set is the one `objects(layer)` lists, each with a `rec(id)` record for its name index).
 * `recs`, `names` and `info` give the format records and the units. Nothing else.
 */
export type IndexSource = Pick<VwxDocument, "info" | "layers" | "objects" | "records"> & {
  /** the object's record (its name index, +0x1a); null for an object with none (a symbol's part) */
  rec?(id: string): { readonly nameIndex: number } | null;
  readonly names?: ReadonlyMap<number, string>;
  /** every record of the file: the format records (type 47) give the field types popups and references use */
  readonly recs?: readonly { readonly type: number; readonly nameIndex: number; readonly data: Uint8Array }[];
};

/** Record format field types whose integer value is a name-table index (a material, a resource): shown as that name. */
const NAME_REF_TYPES: ReadonlySet<number> = new Set([24]);
/** Record format field types that are popups: their text is in the file (types 8, 9). */
const POPUP_TYPES: ReadonlySet<number> = new Set([8, 9]);

export interface IndexedObject {
  readonly id: string;
  /** the object record's name index (+0x1a): what a database block's objects list holds */
  readonly nameIndex: number;
  readonly info: ObjectInfo;
  /** the layer's name (a sheet layer's sheet number) */
  readonly layerName: string;
  /** the object's place in the index (file order) */
  readonly ord: number;
  /** the object's records, decoded on first use */
  records(): readonly ObjectRecord[];
  /** a plug-in object's name (its parametric record's format name), null for other objects */
  plugin(): string | null;
  /** 'Record'.'Field' of the object: undefined when it has no such record or field */
  field(rec: string, field: string): FieldRead | undefined;
}

export interface ObjectIndex {
  readonly objects: readonly IndexedObject[];
  readonly units: string;
  /** the name table: a name-table index is what an integer field holding a name (a material, say) shows */
  readonly names: ReadonlyMap<number, string>;
}

/** field type codes by record format name (lower case) and field name (lower case), read from the format records once */
type Formats = ReadonlyMap<string, ReadonlyMap<string, number>>;

function formatsOf(doc: IndexSource): Formats {
  const codes = new Map<string, Map<string, number>>();
  for (const r of doc.recs ?? []) {
    if (r.type !== FORMAT_RECORD || !r.nameIndex) continue;
    const name = doc.names?.get(r.nameIndex);
    if (name === undefined || codes.has(name.toLowerCase())) continue;
    const fmt = readFormat(r.data);
    codes.set(name.toLowerCase(), new Map(fmt.fields.map((f) => [f.name.toLowerCase(), f.type] as const)));
  }
  return codes;
}

/**
 * One object of the index. Its records, plug-in name and field codes are read when first asked, so
 * an index costs one object each to build, not a decode of every record.
 */
class Indexed implements IndexedObject {
  private recs: readonly ObjectRecord[] | null = null;
  constructor(
    readonly id: string,
    readonly nameIndex: number,
    readonly info: ObjectInfo,
    private readonly layer: string,
    readonly ord: number,
    private readonly source: IndexSource,
    private readonly formats: () => Formats,
    private readonly layerNames: ReadonlyMap<string, string>,
  ) {}

  get layerName(): string {
    return this.layerNames.get(this.layer) ?? "";
  }

  records(): readonly ObjectRecord[] {
    return (this.recs ??= this.source.records(this.id));
  }

  plugin(): string | null {
    return this.records().find((r) => r.parametric)?.name ?? null;
  }

  field(rec: string, field: string): FieldRead | undefined {
    const r = this.records().find((x) => sameName(x.name, rec));
    const f = r?.fields.find((x) => sameName(x.name, field));
    if (!f) return undefined;
    return { ...f, code: this.formats().get(r!.name.toLowerCase())?.get(field.toLowerCase()) ?? 0 };
  }
}

/**
 * Builds the index: one pass over the layers and their objects (the objects `objects(layer)` lists,
 * those with a record: a symbol's or a worksheet's part has none and is left out). The per-object work
 * is one record lookup, so the cost is the model's own object list, which is built once per state of the file.
 */
export function objectIndex(doc: IndexSource): ObjectIndex {
  const layerNames = new Map<string, string>();
  const layers = doc.layers();
  for (const l of layers) layerNames.set(l.id, l.name);
  let codes: Formats | null = null;
  const formats = (): Formats => (codes ??= formatsOf(doc));
  const objects: IndexedObject[] = [];
  for (const layer of layers) {
    for (const info of doc.objects(layer.id)) {
      const rec = doc.rec ? doc.rec(info.id) : null;
      if (!rec) continue;
      objects.push(new Indexed(info.id, rec.nameIndex, info, info.layerId, objects.length, doc, formats, layerNames));
    }
  }
  return { objects, units: doc.info.units, names: doc.names ?? new Map() };
}

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ---- criteria ----

/** A test for one object. */
type Pred = (o: IndexedObject) => boolean;

/** Thrown while compiling criteria this file can't work out. */
class Unsupported extends Error {}

/**
 * Options for hypothesis tests only: what an unnamed criteria keyword means (its value for every
 * object). Left out, an unnamed keyword is unsupported.
 */
export interface CriteriaOptions {
  unnamedKeyword?: (token: number) => boolean;
}

export interface CriteriaMatch {
  objects: IndexedObject[];
  unsupported: string | null;
}

/** The objects the criteria select, in index order; `unsupported` says why it isn't worked out (then no objects). */
export function matchCriteria(index: ObjectIndex, criteria: Node, opt: CriteriaOptions = {}): CriteriaMatch {
  let pred: Pred;
  try {
    pred = compile(unwrap(criteria), opt, index);
    return { objects: index.objects.filter(pred), unsupported: null };
  } catch (e) {
    // an unsupported term, or a value no object settles: the criteria are not worked out (never a throw)
    return { objects: [], unsupported: e instanceof Error ? e.message : String(e) };
  }
}

function unwrap(n: Node): Node {
  return n.k === "call" && n.fn === DATABASE && n.args.length === 1 ? n.args[0]! : n;
}

type Lit = { kind: "bool"; v: boolean } | { kind: "num"; v: number } | { kind: "text"; v: string } | { kind: "pattern"; v: string };

function literal(n: Node): Lit | null {
  switch (n.k) {
    case "bool":
      return { kind: "bool", v: n.v };
    case "int":
    case "num":
      return { kind: "num", v: n.v };
    case "str":
      return { kind: "text", v: n.v };
    case "word":
      return /[*?]/.test(n.v) ? { kind: "pattern", v: n.v } : { kind: "text", v: n.v };
    default:
      return null;
  }
}

function patternOf(p: string): RegExp {
  let s = "";
  for (const ch of p) s += ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${s}$`, "is");
}

function compile(n: Node, opt: CriteriaOptions, index: ObjectIndex): Pred {
  switch (n.k) {
    case "paren":
      return compile(n.a, opt, index);
    case "bool": {
      const v = n.v;
      return () => v;
    }
    case "kw":
      return keyword(n.id, opt);
    case "op":
      if (n.op === T.AND) {
        const a = compile(n.a, opt, index);
        const b = compile(n.b, opt, index);
        return (o) => a(o) && b(o);
      }
      if (n.op === T.OR) {
        const a = compile(n.a, opt, index);
        const b = compile(n.b, opt, index);
        return (o) => a(o) || b(o);
      }
      if (n.op === T.EQ || n.op === T.NE) return comparison(n.a, n.b, n.op === T.EQ, index);
      if (n.op === T.IN) return membership(n.a, n.b);
      throw new Unsupported("an operator in the criteria isn't worked out");
    default:
      throw new Unsupported("a criteria term isn't worked out");
  }
}

function keyword(id: number, opt: CriteriaOptions): Pred {
  // The index does not model design-layer viewport membership, so both keywords hold for every object.
  // The two 2023 rows that use them match the file exactly; untested for any object a viewport holds.
  if (id === KW_NOT_DLVP || id === KW_NOT_REF_DLVP) return () => true;
  if (UNNAMED_KEYWORDS.has(id)) {
    const v = opt.unnamedKeyword?.(id) ?? (UNNAMED_TRUE.has(id) ? true : undefined);
    if (v === undefined) throw new Unsupported(`keyword 0x${id.toString(16).toUpperCase().padStart(4, "0")} isn't named, so its meaning isn't known`);
    return () => v;
  }
  throw new Unsupported("a criteria keyword is used on its own");
}

/** R IN ['a', 'b']: the object has a record of one of those formats */
function membership(set: Node, kw: Node): Pred {
  if (kw.k !== "kw" || kw.id !== KW_R || set.k !== "set") throw new Unsupported("an IN test isn't worked out");
  const names: string[] = [];
  for (const it of set.items) {
    if (it.k !== "str") throw new Unsupported("an IN list item isn't text");
    names.push(it.v.toLowerCase());
  }
  return (o) => o.records().some((r) => names.includes(r.name.toLowerCase()));
}

/** what one side of a comparison reads: a field, a keyword's value, or a literal */
type Side =
  | { kind: "field"; rec: string; field: string }
  | { kind: "plugin" }
  | { kind: "layer" }
  | { kind: "lit"; lit: Lit };

function side(n: Node): Side {
  if (n.k === "field") return { kind: "field", rec: n.rec, field: n.field };
  if (n.k === "paren") return side(n.a);
  if (n.k === "kw" && n.id === KW_PON) return { kind: "plugin" };
  if (n.k === "kw" && n.id === KW_L) return { kind: "layer" };
  const lit = literal(n);
  if (lit) return { kind: "lit", lit };
  if (n.k === "kw") throw new Unsupported(`keyword 0x${n.id.toString(16).toUpperCase().padStart(4, "0")} in a comparison isn't worked out`);
  throw new Unsupported("a comparison side isn't worked out");
}

function comparison(a: Node, b: Node, equal: boolean, index: ObjectIndex): Pred {
  let sa = side(a);
  let sb = side(b);
  if (sa.kind === "lit" && sb.kind !== "lit") [sa, sb] = [sb, sa];
  if (sb.kind !== "lit" || sa.kind === "lit") throw new Unsupported("a comparison needs one field or keyword and one literal");
  const lit = sb.lit;
  const read = readerOf(sa, index.units, index.names);
  return (o) => {
    const v = read(o);
    if (v === undefined) return false;
    const hit = matches(v, lit);
    return equal ? hit : !hit;
  };
}

function readerOf(s: Side, units: string, names: ReadonlyMap<number, string>): (o: IndexedObject) => Value | undefined {
  switch (s.kind) {
    case "field":
      return (o) => {
        const f = o.field(s.rec, s.field);
        return f === undefined ? undefined : fieldValue(f, units, names);
      };
    case "plugin":
      return (o) => o.plugin() ?? undefined;
    case "layer":
      return (o) => o.layerName;
    default:
      throw new Unsupported("a comparison side isn't worked out");
  }
}

function matches(v: Value, lit: Lit): boolean {
  switch (lit.kind) {
    case "bool":
      return typeof v === "boolean" && v === lit.v;
    case "num":
      return typeof v === "number" && Math.abs(v - lit.v) <= 1e-9 * Math.max(1, Math.abs(lit.v));
    case "text":
      return typeof v === "string" && v.toLowerCase() === lit.v.toLowerCase();
    case "pattern":
      return typeof v === "string" && patternOf(lit.v.toLowerCase()).test(v.toLowerCase());
  }
}

/**
 * A record field's value in the document's units (areas and volumes in square and cubic units).
 * A name-table reference shows its name (`names`). A popup (types 8, 9) holds its text in the file;
 * one whose value is a number, or a whole number written as text, is numbered, and its names are
 * not in the file: that throws NotSettled. Text compares as text.
 */
export function fieldValue(f: FieldRead, units: string, names: ReadonlyMap<number, string> = new Map()): Value {
  const v = f.value;
  const perUnit = millimetresPerUnit(units);
  if (POPUP_TYPES.has(f.code) && (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)))) {
    throw new NotSettled("this popup's choices are numbered and their names aren't in the file");
  }
  if (NAME_REF_TYPES.has(f.code) && typeof v === "number") return names.get(v) ?? "";
  switch (f.kind) {
    case "boolean":
      return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : null;
    case "integer":
    case "number":
    case "angle":
    case "color":
      return typeof v === "number" ? v : null;
    case "dimension":
      return typeof v === "number" ? v / perUnit : null;
    case "area":
      return typeof v === "number" ? v / (perUnit * perUnit) : null;
    case "volume":
      return typeof v === "number" ? v / (perUnit * perUnit * perUnit) : null;
    case "text":
    case "choice":
    case "class":
    case "layer":
      return typeof v === "string" ? v : null;
    default:
      return undefined as unknown as Value;
  }
}

// ---- columns ----

export interface ColumnDef {
  formula: Node;
  summarize: boolean;
  sort: "none" | "ascending" | "descending";
  precedence: number;
  sum: boolean;
}

export interface DatabaseResult {
  /** one per subrow, in stored order (first object's place in the index) */
  subrows: { values: Value[]; objects: IndexedObject[] }[];
  /** 0-based subrow indices in display order (stored order when `orderKnown` is false) */
  order: number[];
  /** false when a sort column isn't worked out: the display order is then not known */
  orderKnown: boolean;
  /** what the header row caches per column (null for an empty column or one not worked out) */
  header: Value[];
  /** per column: why it isn't worked out, or null */
  unsupported: (string | null)[];
}

/** Thrown inside a column's evaluation for a value this file doesn't settle (e.g. a number in CONCAT). */
class NotSettled extends Error {}

/** Shapes this module works out itself; anything else goes to the engine. */
function claimed(n: Node): string | null {
  switch (n.k) {
    case "int":
    case "num":
    case "str":
    case "bool":
    case "field":
      return null;
    case "paren":
      // brackets change no value: the claim is that of what they hold
      return claimed(n.a);
    case "if":
      return claimed(n.test) ?? claimed(n.then) ?? claimed(n.else);
    case "post":
      // 0x00e4 after an area: its cells are the field rounded to a whole number in 25 of 28 (2023) and
      // 18 of 28 (2024) cells; the other cells differ by up to 17 units and no field explains them
      return n.op === T.POST ? "0x00e4 (whole number of an area): the cells differ from the rounded area in some rooms, not explained" : engineUnsupported(n, "column");
    case "op":
      if (n.op === T.EQ || n.op === T.NE || n.op === T.MUL) return claimed(n.a) ?? claimed(n.b);
      return engineUnsupported(n, "column");
    case "call":
      if (n.fn === COUNT && n.args.length === 0) return null;
      if (n.fn === CONCAT) return n.args.map(claimed).find((r) => r !== null) ?? null;
      return engineUnsupported(n, "column");
    default:
      return engineUnsupported(n, "column");
  }
}

interface Ctx {
  object: ObjectAccess;
  units: string;
}

/** The value of a column formula for one subrow's object access; throws NotSettled for values not worked out. */
function valueOf(n: Node, cx: Ctx): Value {
  switch (n.k) {
    case "int":
    case "num":
    case "str":
    case "bool":
      return n.v;
    case "field":
      return cx.object.field(n.rec, n.field) ?? null;
    case "paren":
      return valueOf(n.a, cx);
    case "if": {
      const t = valueOf(n.test, cx);
      if (typeof t !== "boolean") throw new NotSettled("an IF test that isn't TRUE or FALSE");
      return t ? valueOf(n.then, cx) : valueOf(n.else, cx);
    }
    case "post": {
      if (n.op !== T.POST) break;
      const v = valueOf(n.a, cx);
      if (typeof v !== "number") throw new NotSettled("0x00e4 on a non-number");
      return roundHalfUp(v);
    }
    case "op": {
      if (n.op === T.EQ || n.op === T.NE) {
        const a = valueOf(n.a, cx);
        const b = valueOf(n.b, cx);
        const eq = equalValues(a, b);
        return n.op === T.EQ ? eq : !eq;
      }
      if (n.op === T.MUL) {
        const a = valueOf(n.a, cx);
        const b = valueOf(n.b, cx);
        if (typeof a !== "number" || typeof b !== "number") throw new NotSettled("a product of non-numbers");
        return a * b;
      }
      break;
    }
    case "call": {
      if (n.fn === COUNT && n.args.length === 0) return cx.object.count;
      if (n.fn === CONCAT) {
        return n.args.map((a) => {
          const v = valueOf(a, cx);
          if (typeof v === "string") return v;
          if (v === null) return "";
          throw new NotSettled("CONCAT of a value whose text form isn't settled");
        }).join("");
      }
      break;
    }
  }
  return evaluate(n, { object: cx.object });
}

/** whole number, halves away from zero (what the file's cells hold for 0x00e4) */
function roundHalfUp(v: number): number {
  return Math.sign(v) * Math.round(Math.abs(v));
}

function equalValues(a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b;
  return false;
}

function accessFor(o: IndexedObject, count: number, units: string, names: ReadonlyMap<number, string>): ObjectAccess {
  return {
    count,
    field: (rec, field) => {
      const f = o.field(rec, field);
      return f === undefined ? undefined : fieldValue(f, units, names);
    },
    call: () => undefined,
  };
}

function isEmpty(v: Value): boolean {
  return v === null || v === "";
}

/** natural (numeric-aware), case-insensitive order; numbers by value; blanks last */
export function compareValues(a: Value, b: Value): number {
  const ea = isEmpty(a);
  const eb = isEmpty(b);
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/**
 * A database row worked out from the index: its subrows (one per object, or one per distinct
 * combination of the Summarize columns' values), their display order, and the header's cached totals.
 */
export interface DatabaseOptions {
  /**
   * The file's own order for tied subrows (equal sort keys). Called once per subrow, in stored order,
   * with the subrow's objects; a number puts the subrow among the ties by ascending rank, a subrow
   * without one after those with one, and two without keep their stored order.
   */
  rank?: (objects: readonly IndexedObject[]) => number | undefined;
}

export function databaseRow(index: ObjectIndex, criteria: Node, columns: readonly (ColumnDef | null)[], units: string, opt: DatabaseOptions = {}): DatabaseResult {
  const reasons: (string | null)[] = columns.map((c) => (c ? claimed(c.formula) : null));
  const empty = (why: string | null): DatabaseResult => ({
    subrows: [],
    order: [],
    orderKnown: false,
    header: columns.map(() => null),
    unsupported: columns.map((c, i) => (c === null ? null : (why ?? reasons[i] ?? null))),
  });
  const m = matchCriteria(index, criteria);
  if (m.unsupported) return empty(`criteria: ${m.unsupported}`);

  const summaryCols = columns.flatMap((c, i) => (c && c.summarize ? [i] : []));
  // Group the objects: one subrow each, or by the Summarize columns' values (first appearance order).
  const groups: IndexedObject[][] = [];
  if (summaryCols.length === 0) {
    for (const o of m.objects) groups.push([o]);
  } else {
    const byKey = new Map<string, IndexedObject[]>();
    try {
      for (const o of m.objects) {
        const key = JSON.stringify(summaryCols.map((i) => valueOf(columns[i]!.formula, { object: accessFor(o, 1, units, index.names), units })));
        const g = byKey.get(key);
        if (g) g.push(o);
        else {
          const fresh = [o];
          byKey.set(key, fresh);
          groups.push(fresh);
        }
      }
    } catch (e) {
      // a Summarize column whose value isn't worked out (for any object) leaves the subrows unknown: the row is not worked out
      return empty(`a Summarize column: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const colWhy: (string | null)[] = reasons.slice();
  const subrows = groups.map((objs) => {
    const values = columns.map((c, i) => {
      if (!c || colWhy[i] !== null) return null;
      try {
        const vals = objs.map((o) => valueOf(c.formula, { object: accessFor(o, objs.length, units, index.names), units }));
        return aggregate(vals, c.sum);
      } catch (e) {
        // a value this file doesn't settle, for any object: the column is unclaimed for the whole row
        colWhy[i] = e instanceof Error ? e.message : String(e);
        return null;
      }
    });
    return { values, objects: objs };
  });

  const sortCols = columns
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c && x.c.sort !== "none")
    .sort((a, b) => a.c!.precedence - b.c!.precedence);
  const order = subrows.map((_, s) => s);
  const orderKnown = sortCols.every((x) => colWhy[x.i] === null);
  if (sortCols.length && orderKnown) {
    const ranks = opt.rank ? subrows.map((s) => opt.rank!(s.objects)) : null;
    order.sort((x, y) => {
      for (const { i, c } of sortCols) {
        const r = compareValues(subrows[x]!.values[i]!, subrows[y]!.values[i]!) * (c!.sort === "descending" ? -1 : 1);
        if (r !== 0) return r;
      }
      if (ranks) {
        const rx = ranks[x];
        const ry = ranks[y];
        if (rx !== undefined && ry !== undefined && rx !== ry) return rx - ry;
        if ((rx === undefined) !== (ry === undefined)) return rx === undefined ? 1 : -1;
      }
      return x - y;
    });
  }

  // A numeric column's header caches the sum of its subrows' values. A text column's header is not
  // a count the files agree on (2023 caches 60 of 64 filled subrows, 2024 caches 0): left unworked.
  const header = columns.map((c, i) => {
    if (!c || colWhy[i] !== null) return null;
    const vals = subrows.map((s) => s.values[i]!);
    if (vals.length && vals.every((v) => typeof v === "number")) return vals.reduce<number>((t, v) => t + (v as number), 0);
    return null;
  });

  return {
    subrows: subrows.map((s) => ({ values: s.values.map((v, i) => (colWhy[i] !== null ? null : v)), objects: s.objects })),
    order,
    orderKnown,
    header,
    unsupported: columns.map((c, i) => (c === null ? null : colWhy[i] ?? null)),
  };
}

/**
 * A subrow's value from its objects' values: one object's value, the sum for a Sum column, or the value
 * they all share. Objects that differ in a column without Sum: not worked out (the file's rule for it
 * is not settled).
 */
function aggregate(vals: Value[], sum: boolean): Value {
  if (vals.length === 1) return vals[0]!;
  if (sum && vals.every((v) => typeof v === "number")) return vals.reduce<number>((t, v) => t + (v as number), 0);
  if (vals.every((v) => equalValues(v, vals[0]!))) return vals[0]!;
  throw new NotSettled("a Summarize column without Sum over objects whose values differ");
}
