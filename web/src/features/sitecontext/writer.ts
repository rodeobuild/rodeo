// Site Context's writer: puts the import into the drawing on a new design layer (or a layer for each
// kind), with the Context classes (reused by name when they exist) and the look each kind is drawn
// with. Buildings stand as extrudes at their heights on the ground under them, and the terrain is a
// site model (contour lines when the drawing can't take one). It runs inside the caller's
// session.batch, so the import is one undo step. A kind the file has no object to copy settings
// from is drawn another way (a circle as a polygon, a polygon as a closed line, a line as lines),
// and every such change is counted for the report.

import type { Attributes, EditSession, NewShape, Pt } from "../../core/index.ts";
import type { Pt3, SiteCategory, SiteFeature, SiteTerrain } from "./model.ts";

/** The class each kind of context goes into; created when the drawing has none of that name. */
export const CLASS_NAME: Readonly<Record<SiteCategory, string>> = {
  terrain: "Context-Terrain",
  buildings: "Context-Buildings",
  roads: "Context-Roads",
  paths: "Context-Paths",
  rail: "Context-Rail",
  water: "Context-Water",
  green: "Context-Green",
  trees: "Context-Trees",
  facilities: "Context-Facilities",
};

/** How each kind is drawn: its fill (none for lines), and its pen colour and weight in millimetres. */
interface Look {
  readonly fill?: string;
  readonly pen: string;
  readonly penMm: number;
}

const LOOK: Readonly<Record<SiteCategory, Look>> = {
  terrain: { pen: "#8b5e34", penMm: 0.1 },
  buildings: { fill: "#d9d9d9", pen: "#404040", penMm: 0.25 },
  roads: { pen: "#555555", penMm: 0.25 },
  paths: { pen: "#7d7d7d", penMm: 0.13 },
  rail: { pen: "#2f2f2f", penMm: 0.18 },
  water: { fill: "#b8dcf2", pen: "#3b82b5", penMm: 0.18 },
  green: { fill: "#cbe8b5", pen: "#6a9d55", penMm: 0.13 },
  trees: { fill: "#5d9a4b", pen: "#2c5a25", penMm: 0.18 },
  facilities: { pen: "#1f1f1f", penMm: 0.18 },
};

const WHITE = "#ffffff";
const BLACK = "#000000";
/** the labels' text size, typographic points, at the layer's scale */
const LABEL_PT = 9;
/** the credit's text size, points */
const CREDIT_PT = 6;
/** a typographic point, millimetres */
const POINT_MM = 0.3528;
/** the credit OpenStreetMap asks for (ODbL) */
export const CREDIT_TEXT = "© OpenStreetMap contributors";

/** The kinds from the bottom of the stack up: the ground first, labels and markers last. */
export const STACK: readonly SiteCategory[] = ["terrain", "water", "green", "paths", "roads", "rail", "buildings", "trees", "facilities"];

/** What a kind's own layer is called after the import's name: "Site Context Buildings". */
export const LAYER_SUFFIX: Readonly<Record<SiteCategory, string>> = {
  terrain: "Terrain",
  buildings: "Buildings",
  roads: "Roads",
  paths: "Paths",
  rail: "Rail",
  water: "Water",
  green: "Green",
  trees: "Trees",
  facilities: "Facilities",
};

/** Makes the terrain's site model through `points` on a layer in a class, its contours every `interval` mm; its id. */
export type SiteModelMaker = (s: EditSession, layerId: string, classIndex: number, points: readonly Pt3[], interval: number) => string;

export interface WriteOptions {
  /** the layer's name before numbering: "Site Context" */
  readonly layerName: string;
  /** the south-west corner of the area, world millimetres: where the credit goes */
  readonly corner: Pt;
  /** the class for the credit and for anything with no class of its own to go in */
  readonly fallbackClass: number;
  /** a design layer for each kind ("Site Context Buildings"), not one for them all; a later import adds to the ones there */
  readonly layerPerKind?: boolean;
  /** makes the terrain a site model; without it, or when it fails, the terrain is drawn as contour lines */
  readonly siteModel?: SiteModelMaker;
}

export interface WriteReport {
  /** the first layer made (the bottom one) */
  readonly layerId: string;
  readonly layerName: string;
  /** every layer made, bottom first */
  readonly layers: readonly { readonly id: string; readonly name: string }[];
  readonly placed: Partial<Record<SiteCategory, number>>;
  /** buildings standing as extrudes */
  readonly buildings3d: number;
  /** of those, the ones OpenStreetMap gives no height for, standing at the default */
  readonly heightsGuessed: number;
  /** buildings left flat: the drawing would not extrude them */
  readonly buildingsFlat: number;
  /** the terrain: a site model, contour lines, or none */
  readonly terrain: "site model" | "contours" | "none";
  /** the credit text's id, when one was placed */
  readonly creditId: string | null;
  /** circles drawn as 24-sided polygons (the file has no arc to copy) */
  readonly circlesAsPolygons: number;
  /** closed outlines drawn as closed lines or as edges (the file has no polygon or polyline to copy) */
  readonly outlinesSimplified: number;
  /** labels left out (the file has no text to copy) and objects the file refused */
  readonly skipped: number;
}

/** The first of `base`, `base 2`, `base 3`, ... that no name in `taken` has (any case). */
export function uniqueName(base: string, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

/** The palette index whose colour is nearest to `hex` (by RGB distance); 0 when the palette is empty. */
export function nearestColor(colors: readonly { index: number; css: string }[], hex: string): number {
  const target = rgb(hex);
  let best = colors[0]?.index ?? 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (const c of colors) {
    const v = rgb(c.css);
    const d = (v[0] - target[0]) ** 2 + (v[1] - target[1]) ** 2 + (v[2] - target[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** A pen weight in mils (1/1000 inch), as Attributes keeps it, for a weight in millimetres. */
export function milsOf(mm: number): number {
  return Math.max(1, Math.round(mm / 0.0254));
}

/** The height of text of `points` at 1:`scale`, in world millimetres (the size Shape.textSize uses). */
export function labelHeightMm(points: number, scale: number): number {
  return points * POINT_MM * scale;
}

/** The class index for each kind used, reusing a class of the same name (any case). */
function classesFor(s: EditSession, cats: Iterable<SiteCategory>, fallback: number): Map<SiteCategory, number> {
  const existing = s.doc.classes();
  const out = new Map<SiteCategory, number>();
  for (const cat of cats) {
    const name = CLASS_NAME[cat];
    let index = existing.find((c) => c.name.toLowerCase() === name.toLowerCase())?.index;
    if (index === undefined) {
      try {
        index = s.createClass(name);
      } catch {
        // the name is taken by a layer or a symbol: the fallback class
        index = fallback;
      }
    }
    out.set(cat, index);
  }
  return out;
}

/** The import's name: `base`, else `base 2`, `base 3`, ..., whichever leaves every layer it makes a free name. */
export function importName(base: string, suffixes: readonly string[] | null, taken: readonly string[]): string {
  const names = new Set(taken.map((n) => n.toLowerCase()));
  const free = (name: string): boolean => (suffixes ? suffixes.every((x) => !names.has(`${name} ${x}`.toLowerCase())) : !names.has(name.toLowerCase()));
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base} ${n}`)) return `${base} ${n}`;
}

/** A new design layer named `wanted`, or numbered on when the drawing has that name for something else. */
function newLayer(s: EditSession, wanted: string): { id: string; name: string } {
  for (let n = 1; n < 100; n++) {
    const name = n === 1 ? wanted : `${wanted} ${n}`;
    try {
      return { id: s.createLayer(name, "design"), name };
    } catch (err) {
      if (n === 99) throw err;
    }
  }
  throw new Error("no free layer name");
}

/**
 * Writes the import into the drawing: a design layer named after `layerName` (numbered when the name
 * is taken), or one for each kind, the Context classes and the objects, kinds stacked ground first.
 * Call it inside session.batch.
 */
export function writeSiteContext(s: EditSession, features: readonly SiteFeature[], terrain: SiteTerrain | null, options: WriteOptions): WriteReport {
  const rank = new Map(STACK.map((c, i) => [c, i]));
  const sorted = features
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (rank.get(a.f.cat) ?? 0) - (rank.get(b.f.cat) ?? 0) || a.i - b.i)
    .map((x) => x.f);
  const cats = STACK.filter((c) => (c === "terrain" ? terrain !== null : sorted.some((f) => f.cat === c)));
  const taken = [...s.doc.layers().map((l) => l.name), ...s.doc.classes().map((c) => c.name)];
  const perKind = options.layerPerKind === true;
  // one layer: a new one each time; a layer for each kind: the same ones each time, parts of a place together
  const base = perKind ? options.layerName : importName(options.layerName, null, taken);

  const layers: { id: string; name: string }[] = [];
  const layerOf = new Map<SiteCategory, string>();
  let only: string | null = null;
  /** the layer a kind goes on, made the first time it is asked for */
  const layerFor = (cat: SiteCategory): string => {
    if (!perKind) {
      if (only === null) {
        const l = newLayer(s, base);
        layers.push(l);
        only = l.id;
      }
      return only;
    }
    let id = layerOf.get(cat);
    if (id === undefined) {
      const wanted = `${base} ${LAYER_SUFFIX[cat]}`;
      const there = s.doc.layers().find((l) => l.kind === "design" && l.name.toLowerCase() === wanted.toLowerCase());
      const l = there ? { id: there.id, name: there.name } : newLayer(s, wanted);
      layers.push(l);
      id = l.id;
      layerOf.set(cat, id);
    }
    return id;
  };
  // the layers in stacking order, so each kind's layer sits over the one below it
  for (const cat of cats) layerFor(cat);
  if (!layers.length) layerFor("terrain");

  const scaleOf = (layerId: string): number => s.doc.layers().find((l) => l.id === layerId)?.scale ?? 100;
  const classes = classesFor(s, cats, options.fallbackClass);
  const colors = s.doc.colors();
  const white = nearestColor(colors, WHITE);
  const black = nearestColor(colors, BLACK);
  const noneClass = s.doc.classes().find((c) => c.name === "None")?.index ?? options.fallbackClass;

  const placed: Partial<Record<SiteCategory, number>> = {};
  let circlesAsPolygons = 0;
  let outlinesSimplified = 0;
  let skipped = 0;

  const attrsFor = (cat: SiteCategory, filled: boolean): Partial<Attributes> => {
    const look = LOOK[cat];
    const fill = filled && look.fill !== undefined;
    return {
      lineStyle: 2,
      lineWeight: milsOf(look.penMm),
      penFore: nearestColor(colors, look.pen),
      fillPattern: fill ? 1 : 0,
      fillFore: fill ? nearestColor(colors, look.fill ?? WHITE) : white,
      fillOpacity: 100,
      penOpacity: 100,
    };
  };

  /** Adds one object; its id, or null (and counted) when the file refuses it. */
  const put = (cat: SiteCategory, classIndex: number, shape: NewShape, attrs: Partial<Attributes>): string | null => {
    try {
      return s.addObject(layerFor(cat), shape, classIndex, attrs);
    } catch {
      skipped++;
      return null;
    }
  };

  /** A closed outline: a polygon, else a closed polyline, else its edges as lines. Its id when it is one object. */
  const outline = (cat: SiteCategory, pts: readonly Pt[], filled: boolean): string | null => {
    const attrs = attrsFor(cat, filled);
    const cls = classes.get(cat) ?? options.fallbackClass;
    if (s.canAdd("polygon")) return put(cat, cls, { kind: "polygon", points: [...pts], closed: true }, attrs);
    if (s.canAdd("polyline")) {
      outlinesSimplified++;
      return put(cat, cls, { kind: "polyline", points: [...pts], closed: true }, attrs);
    }
    if (s.canAdd("line")) {
      outlinesSimplified++;
      for (let i = 0; i < pts.length; i++) put(cat, cls, { kind: "line", a: pts[i], b: pts[(i + 1) % pts.length] }, attrs);
    } else {
      skipped++;
    }
    return null;
  };

  /** A feature drawn flat; false when nothing of it could be placed. */
  const draw = (f: SiteFeature, onOutline?: (id: string) => void): boolean => {
    const cat = f.cat;
    const cls = classes.get(cat) ?? options.fallbackClass;
    const g = f.geom;
    switch (g.kind) {
      case "polygon": {
        const id = outline(cat, g.points, true);
        if (id && onOutline) onOutline(id);
        return true;
      }
      case "polyline": {
        const attrs = attrsFor(cat, false);
        if (s.canAdd("polyline")) return put(cat, cls, { kind: "polyline", points: [...g.points], closed: g.closed === true }, attrs) !== null;
        if (s.canAdd("line")) {
          outlinesSimplified++;
          for (let i = 0; i + 1 < g.points.length; i++) put(cat, cls, { kind: "line", a: g.points[i], b: g.points[i + 1] }, attrs);
          return true;
        }
        skipped++;
        return false;
      }
      case "circle": {
        const attrs = attrsFor(cat, true);
        if (s.canAdd("arc")) return put(cat, cls, { kind: "arc", center: g.at, radius: g.radius, startAngle: 0, sweepAngle: 360 }, attrs) !== null;
        circlesAsPolygons++;
        const sides = 24;
        const pts = Array.from({ length: sides }, (_, k) => {
          const a = (2 * Math.PI * k) / sides;
          return { x: g.at.x + g.radius * Math.cos(a), y: g.at.y + g.radius * Math.sin(a) };
        });
        outline(cat, pts, true);
        return true;
      }
      case "label":
        if (s.canAdd("text")) {
          const layerId = layerFor(cat);
          return put(cat, cls, { kind: "text", at: g.at, text: g.text, height: labelHeightMm(LABEL_PT, scaleOf(layerId)) }, attrsFor(cat, false)) !== null;
        }
        skipped++;
        return false;
    }
  };

  // the ground: a site model, else its contour lines
  let terrainKind: WriteReport["terrain"] = "none";
  if (terrain) {
    const cls = classes.get("terrain") ?? options.fallbackClass;
    let made = false;
    if (options.siteModel && terrain.points.length >= 3) {
      try {
        options.siteModel(s, layerFor("terrain"), cls, terrain.points, terrain.interval);
        made = true;
      } catch {
        // the drawing can't take one: the contours instead
      }
    }
    if (made) {
      terrainKind = "site model";
      placed.terrain = 1;
    } else {
      for (const f of terrain.contours) if (draw(f)) placed.terrain = (placed.terrain ?? 0) + 1;
      if (terrain.contours.length) terrainKind = "contours";
    }
  }

  // the rest, ground first; the buildings' outlines are kept to stand up afterwards
  const standing = new Map<string, { readonly height: number; readonly base: number }>();
  let guessed = 0;
  const guessedIds = new Set<string>();
  for (const f of sorted) {
    if (f.cat === "terrain") continue;
    const building = f.cat === "buildings" && f.geom.kind === "polygon" && f.heightM !== undefined && f.heightM > 0;
    const ok = draw(f, building ? (id) => {
      standing.set(id, { height: (f.heightM ?? 0) * 1000, base: (f.baseM ?? 0) * 1000 });
      if (f.heightGuessed) guessedIds.add(id);
    } : undefined);
    if (ok) placed[f.cat] = (placed[f.cat] ?? 0) + 1;
  }

  // the buildings up at their heights, on the ground under them, as one change
  let buildings3d = 0;
  let buildingsFlat = 0;
  if (standing.size) {
    try {
      buildings3d = s.extrudeObjects([...standing.keys()], 1, standing).length;
      buildingsFlat = standing.size - buildings3d;
      guessed = guessedIds.size;
    } catch {
      buildingsFlat = standing.size;
    }
  }

  // the credit, just inside the area's south-west corner, on the bottom layer
  let creditId: string | null = null;
  if (s.canAdd("text")) {
    const layerId = layers[0].id;
    try {
      creditId = s.addObject(
        layerId,
        {
          kind: "text",
          at: { x: options.corner.x, y: options.corner.y },
          text: CREDIT_TEXT,
          height: labelHeightMm(CREDIT_PT, scaleOf(layerId)),
        },
        noneClass,
        { lineStyle: 2, lineWeight: milsOf(0.1), penFore: black, fillPattern: 0, penOpacity: 100 },
      );
    } catch {
      skipped++;
    }
  }

  return {
    layerId: layers[0].id,
    layerName: layers[0].name,
    layers,
    placed,
    buildings3d,
    heightsGuessed: guessed,
    buildingsFlat,
    terrain: terrainKind,
    creditId,
    circlesAsPolygons,
    outlinesSimplified,
    skipped,
  };
}
