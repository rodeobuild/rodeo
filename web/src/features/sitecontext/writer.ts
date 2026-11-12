// Site Context's writer: puts the import into the drawing on a new design layer (or a layer for each
// kind), with the Context classes (reused by name when they exist) and the look each kind is drawn
// with. Buildings stand as extrudes at their heights on the ground under them, and the terrain is a
// site model (contour lines when the drawing can't take one). Water, green spaces, squares, roads,
// paths and railways are drawn flat for Top/Plan and grouped with a mesh laid on the ground for 3D;
// each tree's circle is grouped with a tree standing there (a symbol). It runs inside the caller's
// session.batch, so the import is one undo step. A kind the file has no object to copy settings
// from is drawn another way (a circle as a polygon, a polygon as a closed line, a line as lines),
// and every such change is counted for the report.

import type { Attributes, EditSession, NewShape, Pt } from "../../core/index.ts";
import { heightLookup, surfaceOf } from "../../app/siteModelShapes.ts";
import type { Rect } from "./clip.ts";
import { groundFaces, groundOf, LIFT, treeParts, treeSpots, type Face } from "./ground3d.ts";
import type { Pt3, SiteCategory, SiteFeature, SiteTerrain } from "./model.ts";
import { keyhole, offsetLine } from "./shapes.ts";

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

/** The colour of each kind's surface in 3D, and of the trees' trunks and crowns. */
const LOOK_3D: Readonly<Partial<Record<SiteCategory, string>>> = {
  water: "#7fb2d8",
  green: "#9fc77f",
  paths: "#d6d0c4",
  roads: "#8f8f8f",
  rail: "#7d7368",
};
const TRUNK = "#6b4f35";
const CROWN = "#5d9a4b";
/** the symbol each tree is an instance of (reused by name when an earlier import made it) */
export const TREE_SYMBOL = "Site Context Tree";

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
  /** one layer: this one (an earlier part's of the same import) rather than a new one, when the drawing has it */
  readonly intoLayer?: string;
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
  /** water, green spaces, squares, roads, paths and railways laid on the ground in 3D */
  readonly onGround: number;
  /** trees standing in 3D */
  readonly trees3d: number;
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

/** Two reports as one, for an import written in parts: the first's layer and credit, the counts added, every layer once. */
export function joinReports(a: WriteReport, b: WriteReport): WriteReport {
  const placed: Partial<Record<SiteCategory, number>> = { ...a.placed };
  for (const [cat, n] of Object.entries(b.placed) as [SiteCategory, number][]) placed[cat] = (placed[cat] ?? 0) + n;
  const layers = [...a.layers];
  for (const l of b.layers) if (!layers.some((x) => x.id === l.id)) layers.push(l);
  return {
    layerId: a.layerId,
    layerName: a.layerName,
    layers,
    placed,
    buildings3d: a.buildings3d + b.buildings3d,
    heightsGuessed: a.heightsGuessed + b.heightsGuessed,
    buildingsFlat: a.buildingsFlat + b.buildingsFlat,
    onGround: a.onGround + b.onGround,
    trees3d: a.trees3d + b.trees3d,
    terrain: a.terrain === "none" ? b.terrain : a.terrain,
    creditId: a.creditId ?? b.creditId,
    circlesAsPolygons: a.circlesAsPolygons + b.circlesAsPolygons,
    outlinesSimplified: a.outlinesSimplified + b.outlinesSimplified,
    skipped: a.skipped + b.skipped,
  };
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
        const there = options.intoLayer ? s.doc.layers().find((l) => l.id === options.intoLayer) : undefined;
        const l = there ? { id: there.id, name: there.name } : newLayer(s, base);
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
  // the colours exactly, added to the drawing's table where it hasn't them; else the nearest it has
  const hexes = [
    ...new Set([WHITE, BLACK, TRUNK, CROWN, ...Object.values(LOOK).flatMap((l) => (l.fill ? [l.pen, l.fill] : [l.pen])), ...Object.values(LOOK_3D)]),
  ].filter((h): h is string => h !== undefined);
  const colorIndex = new Map<string, number>();
  try {
    const got = typeof s.addColors === "function" ? s.addColors(hexes) : [];
    if (got.length === hexes.length) hexes.forEach((h, i) => colorIndex.set(h, got[i]));
  } catch {
    // the nearest instead
  }
  const colour = (hex: string): number => colorIndex.get(hex) ?? nearestColor(colors, hex);
  const white = colour(WHITE);
  const black = colour(BLACK);
  const noneClass = s.doc.classes().find((c) => c.name === "None")?.index ?? options.fallbackClass;

  const placed: Partial<Record<SiteCategory, number>> = {};
  let circlesAsPolygons = 0;
  let outlinesSimplified = 0;
  let skipped = 0;

  const attrsFor = (cat: SiteCategory, filled: boolean): Partial<Attributes> => {
    const look = LOOK[cat];
    const fill = filled && look.fill !== undefined;
    // a solid fill shows its back colour (as Vectorworks draws it): both are the fill's
    const fillColour = fill ? colour(look.fill ?? WHITE) : white;
    return {
      lineStyle: 2,
      lineWeight: milsOf(look.penMm),
      penFore: colour(look.pen),
      fillPattern: fill ? 1 : 0,
      fillFore: fillColour,
      fillBack: fillColour,
      fillOpacity: 100,
      penOpacity: 100,
    };
  };
  /** A surface's look in 3D: filled with `hex`, no pen. */
  const attrs3d = (hex: string): Partial<Attributes> => {
    const c = colour(hex);
    return { lineStyle: 0, lineWeight: milsOf(0.05), penFore: c, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100, penOpacity: 100 };
  };

  // The objects are queued as they are drawn and added a kind at a time, in one addObjects call:
  // one change to the drawing for each kind, not one for each object, each of which would rebuild
  // the whole drawing (minutes for a town written into a drawing that holds earlier parts)
  let queue: { layer: string; shape: NewShape; cls: number; attrs: Partial<Attributes> }[] = [];
  /** the queue positions of the objects the feature being drawn makes */
  let drawing: number[] = [];
  const put = (cat: SiteCategory, classIndex: number, shape: NewShape, attrs: Partial<Attributes>): void => {
    drawing.push(queue.length);
    queue.push({ layer: layerFor(cat), shape, cls: classIndex, attrs });
  };
  /** Adds what is queued, in order, a layer at a time: the ids by queue position, "" for one the file refused (counted). */
  const flush = (): string[] => {
    const all = queue;
    queue = [];
    const ids = all.map(() => "");
    const byLayer = new Map<string, number[]>();
    all.forEach((q, i) => {
      const at = byLayer.get(q.layer);
      if (at) at.push(i);
      else byLayer.set(q.layer, [i]);
    });
    for (const [layer, at] of byLayer) {
      try {
        const got = s.addObjects(
          layer,
          at.map((i) => all[i].shape),
          at.map((i) => all[i].cls),
          at.map((i) => all[i].attrs),
        );
        if (got.length === at.length) {
          at.forEach((i, k) => (ids[i] = got[k]));
          continue;
        }
      } catch {
        // one of them refused (the batch adds nothing then): each on its own, so only that one is left out
      }
      for (const i of at) {
        try {
          ids[i] = s.addObject(layer, all[i].shape, all[i].cls, all[i].attrs);
        } catch {
          skipped++;
        }
      }
    }
    return ids;
  };

  /** A closed outline: a polygon, else a closed polyline, else its edges as lines. */
  const outline = (cat: SiteCategory, pts: readonly Pt[], filled: boolean): void => {
    const attrs = attrsFor(cat, filled);
    const cls = classes.get(cat) ?? options.fallbackClass;
    if (s.canAdd("polygon")) {
      put(cat, cls, { kind: "polygon", points: [...pts], closed: true }, attrs);
    } else if (s.canAdd("polyline")) {
      outlinesSimplified++;
      put(cat, cls, { kind: "polyline", points: [...pts], closed: true }, attrs);
    } else if (s.canAdd("line")) {
      outlinesSimplified++;
      for (let i = 0; i < pts.length; i++) put(cat, cls, { kind: "line", a: pts[i], b: pts[(i + 1) % pts.length] }, attrs);
    } else {
      skipped++;
    }
  };

  /** An open line: a polyline, else its segments as lines. */
  const line = (cat: SiteCategory, pts: readonly Pt[], closed: boolean): void => {
    const attrs = attrsFor(cat, false);
    const cls = classes.get(cat) ?? options.fallbackClass;
    if (s.canAdd("polyline")) {
      put(cat, cls, { kind: "polyline", points: [...pts], closed }, attrs);
    } else if (s.canAdd("line")) {
      outlinesSimplified++;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) put(cat, cls, { kind: "line", a: pts[i], b: pts[(i + 1) % pts.length] }, attrs);
    } else {
      skipped++;
    }
  };

  /** A feature drawn flat, queued: the queue positions of its objects (none when nothing of it can be placed). */
  const draw = (f: SiteFeature): number[] => {
    drawing = [];
    const cat = f.cat;
    const cls = classes.get(cat) ?? options.fallbackClass;
    const g = f.geom;
    switch (g.kind) {
      case "polygon":
        if (g.holes?.length && s.canAdd("polygon") && s.canAdd("polyline")) {
          // the fill as one outline round the holes, without a pen (its cuts would show), and the
          // outline and the holes' edges as lines over it
          put(cat, cls, { kind: "polygon", points: keyhole(g.points, g.holes), closed: true }, { ...attrsFor(cat, true), lineStyle: 0 });
          for (const ring of [g.points, ...g.holes]) line(cat, ring, true);
        } else {
          outline(cat, g.points, true);
        }
        break;
      case "polyline":
        line(cat, g.points, g.closed === true);
        break;
      case "band":
        line(cat, offsetLine(g.points, g.half), false);
        line(cat, offsetLine(g.points, -g.half), false);
        if (g.centre) line(cat, g.points, false);
        break;
      case "circle": {
        const attrs = attrsFor(cat, true);
        if (s.canAdd("arc")) {
          put(cat, cls, { kind: "arc", center: g.at, radius: g.radius, startAngle: 0, sweepAngle: 360 }, attrs);
          break;
        }
        circlesAsPolygons++;
        const sides = 24;
        const pts = Array.from({ length: sides }, (_, k) => {
          const a = (2 * Math.PI * k) / sides;
          return { x: g.at.x + g.radius * Math.cos(a), y: g.at.y + g.radius * Math.sin(a) };
        });
        outline(cat, pts, true);
        break;
      }
      case "label":
        if (s.canAdd("text")) {
          const layerId = layerFor(cat);
          put(cat, cls, { kind: "text", at: g.at, text: g.text, height: labelHeightMm(LABEL_PT, scaleOf(layerId)) }, attrsFor(cat, false));
        } else {
          skipped++;
        }
        break;
    }
    return drawing;
  };

  /** Draws features flat and adds them: each feature with the ids of the objects it made, leaving out those with none. */
  const drawAll = (features: readonly SiteFeature[]): { f: SiteFeature; ids: string[] }[] => {
    const queued = features.map((f) => ({ f, at: draw(f) }));
    const ids = flush();
    return queued.map(({ f, at }) => ({ f, ids: at.map((i) => ids[i]).filter((id) => id !== "") })).filter((x) => x.ids.length > 0);
  };

  // 3D on the ground: the site model's own surface, so what lies on it follows it
  const meshes = typeof s.canAddMeshes === "function" && s.canAddMeshes();
  let ground = groundOf(null, null);
  if (meshes && terrain && terrain.points.length >= 3) {
    const surface = surfaceOf(terrain.points);
    if (surface) {
      const xs = terrain.points.map((p) => p[0]);
      const ys = terrain.points.map((p) => p[1]);
      const box: Rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      ground = groundOf(heightLookup(surface), box);
    }
  }
  let onGround = 0;
  let trees3d = 0;

  /** Each feature's surface as a mesh, grouped with its flat drawing. */
  const lay = (cat: SiteCategory, items: readonly { readonly ids: string[]; readonly faces: Face[] }[]): void => {
    const hex = LOOK_3D[cat];
    const some = items.filter((x) => x.faces.length && x.ids.length);
    if (!hex || !some.length) return;
    try {
      const ids = s.addMeshes(layerFor(cat), some.map((x) => x.faces), classes.get(cat) ?? options.fallbackClass, attrs3d(hex));
      // every part has faces, so each has its mesh, in order
      if (ids.length !== some.length) return;
      s.groupEach(some.map((x, i) => [...x.ids, ids[i]]));
      onGround += some.length;
    } catch {
      // flat only
    }
  };

  /** The tree symbol: the earlier import's, else a new one; null when the drawing can't take it. */
  let treeSymbol: number | null | undefined;
  const treeSymbolIndex = (cls: number): number | null => {
    if (treeSymbol !== undefined) return treeSymbol;
    treeSymbol = s.doc.symbolDefs().find((d) => d.name === TREE_SYMBOL)?.index ?? null;
    if (treeSymbol === null) {
      const { trunk, crown } = treeParts();
      try {
        treeSymbol = s.addMeshSymbols([{ name: TREE_SYMBOL, parts: [trunk, crown], attrs: [attrs3d(TRUNK), attrs3d(CROWN)], classIndex: cls }])[0] ?? null;
      } catch {
        treeSymbol = null;
      }
    }
    return treeSymbol;
  };

  /** A tree standing at each spot, on the ground, grouped with the flat drawing it stands for. */
  const plant = (cat: SiteCategory, items: readonly { readonly ids: string[]; readonly spots: Pt[] }[]): void => {
    const some = items.filter((x) => x.spots.length && x.ids.length);
    if (!some.length) return;
    const cls = classes.get(cat) ?? options.fallbackClass;
    const symbol = treeSymbolIndex(cls);
    if (symbol === null) return;
    try {
      const elements = some.flatMap((x) => x.spots.map((p) => ({ symbol, matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1, p.x, p.y, ground(p.x, p.y)], classIndex: cls })));
      const ids = s.addMeshElements(layerFor(cat), elements);
      if (ids.length !== elements.length) return;
      let k = 0;
      const sets = some.map((x) => {
        const mine = ids.slice(k, k + x.spots.length).filter((id) => id !== "");
        k += x.spots.length;
        return [...x.ids, ...mine];
      });
      s.groupEach(sets);
      trees3d += elements.length;
    } catch {
      // flat only
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
      const drawn = drawAll(terrain.contours);
      if (drawn.length) placed.terrain = drawn.length;
      if (terrain.contours.length) terrainKind = "contours";
    }
  }

  // the rest, ground first, a kind at a time: each kind's 3D grouped with it before the next kind is
  // drawn, so the kinds keep their stacking; the buildings' outlines are kept to stand up afterwards
  const standing = new Map<string, { readonly height: number; readonly base: number }>();
  let guessed = 0;
  const guessedIds = new Set<string>();
  for (const cat of STACK) {
    if (cat === "terrain") continue;
    const laid: { ids: string[]; faces: Face[] }[] = [];
    const planted: { ids: string[]; spots: Pt[] }[] = [];
    for (const { f, ids } of drawAll(sorted.filter((f) => f.cat === cat))) {
      placed[cat] = (placed[cat] ?? 0) + 1;
      if (cat === "buildings" && f.geom.kind === "polygon" && f.heightM !== undefined && f.heightM > 0 && ids.length === 1) {
        standing.set(ids[0], { height: f.heightM * 1000, base: (f.baseM ?? 0) * 1000 });
        if (f.heightGuessed) guessedIds.add(ids[0]);
      }
      if (!meshes || !f.ground) continue;
      if (f.ground.kind === "tree") planted.push({ ids, spots: treeSpots(f.geom) });
      else laid.push({ ids, faces: groundFaces(f.geom, f.ground, ground, LIFT[cat] ?? 200) });
    }
    lay(cat, laid);
    plant(cat, planted);
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
    onGround,
    trees3d,
    terrain: terrainKind,
    creditId,
    circlesAsPolygons,
    outlinesSimplified,
    skipped,
  };
}
