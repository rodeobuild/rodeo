// Checks for Site Context's pure logic, on small synthetic inputs (no network, no DOM). Run with:
//   cd web && npx tsx src/features/sitecontext/check.ts
// Exits non-zero when a check fails.

import assert from "node:assert/strict";
import type { EditSession, NewShape, Pt } from "../../core/index.ts";
import {
  boxFromCorners,
  boxSizeM,
  boxTooLarge,
  fromMetres,
  pixelOf,
  projectionAt,
  terrainGridSize,
  terrainZoom,
  tilesCovering,
  toMetres,
  TILE_PX,
  type GeoBox,
} from "./geo.ts";
import { geoToDrawing, drawingToGeo, type Georef } from "../../app/geoShapes.ts";
import { anchorOf, anchorText, areaOfText, areaText } from "./anchor.ts";
import { clipFeatures } from "./clip.ts";
import { areaOf, boxAround, gridCoordOf, gridPoint, ownsBy, terrainFeatures, terrainPoints, withBases, type GridFrame, type Placement } from "./importer.ts";
import type { SiteFeature, SiteTerrain } from "./model.ts";
import { buildingHeightKnown, buildingHeightM, featuresFromOverpass, lengthM, overpassQuery, roadWidthM, type OsmKind, type OverpassResponse } from "./osm.ts";
import { offsetLine, polygonArea, polygonCentroid, simplify, stitchRings } from "./shapes.ts";
import { contours, decodeTerrarium, gridHeightAt, Mosaic, sampleGrid, simplifyContour } from "./terrain.ts";
import { CLASS_NAME, CREDIT_TEXT, importName, labelHeightMm, milsOf, nearestColor, uniqueName, writeSiteContext } from "./writer.ts";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`);
    console.error(err instanceof Error ? err.message : err);
  }
}

const near = (a: number, b: number, tol = 1e-6): void => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (±${tol})`);

// ---- geography ----------------------------------------------------------------

const ORIGIN_BOX: GeoBox = { south: 52, north: 52.01, west: 0, east: 0.01 };

check("projection: metres per degree", () => {
  const p = projectionAt({ lat: 60, lon: 10 });
  const north = toMetres(p, { lat: 60.001, lon: 10 });
  near(north.y, 110.54, 1e-6);
  const east = toMetres(p, { lat: 60, lon: 10.001 });
  near(east.x, 55.66, 1e-2);
});

check("projection: round trip", () => {
  const p = projectionAt({ lat: 51.5, lon: -0.12 });
  const m = toMetres(p, { lat: 51.52, lon: -0.1 });
  const back = fromMetres(p, m.x, m.y);
  near(back.lat, 51.52, 1e-9);
  near(back.lon, -0.1, 1e-9);
});

check("box size in metres", () => {
  const { width, height } = boxSizeM(ORIGIN_BOX);
  near(width, 0.01 * Math.cos((52.005 * Math.PI) / 180) * 111320, 1e-6);
  near(height, 0.01 * 110540, 1e-6);
});

check("box too large past 2 km", () => {
  const two = boxFromCorners({ lat: 52, lon: 0 }, { lat: 52, lon: 0.0365 }); // about 2.5 km at 52 N: too large
  assert.equal(boxTooLarge(two), true);
  const small = boxFromCorners({ lat: 52, lon: 0 }, { lat: 52.017, lon: 0.0225 });
  assert.equal(boxTooLarge(small), false);
});

check("terrain zoom and grid for 2 km and 500 m", () => {
  const big = boxFromCorners({ lat: 52, lon: 0 }, { lat: 52.018, lon: 0.0293 });
  assert.equal(terrainZoom(big), 15);
  const { nx, ny } = terrainGridSize(big, 15);
  assert.equal(nx, 512);
  assert.equal(ny, 512);
  const small = boxFromCorners({ lat: 52, lon: 0 }, { lat: 52.0045, lon: 0.00734 }); // about 500 m
  assert.equal(terrainZoom(small), 15);
  const g = terrainGridSize(small, 15);
  assert.ok(g.nx < 512 && g.nx > 100, `grid ${g.nx}`);
});

check("tiles cover the box", () => {
  const zoom = 15;
  const r = tilesCovering(ORIGIN_BOX, zoom);
  const nw = pixelOf({ lat: ORIGIN_BOX.north, lon: ORIGIN_BOX.west }, zoom);
  const se = pixelOf({ lat: ORIGIN_BOX.south, lon: ORIGIN_BOX.east }, zoom);
  assert.ok(nw.px >= r.x0 * TILE_PX && se.px < (r.x0 + r.cols) * TILE_PX);
  assert.ok(nw.py >= r.y0 * TILE_PX && se.py < (r.y0 + r.rows) * TILE_PX);
});

// ---- terrain ------------------------------------------------------------------

check("terrarium decode", () => {
  const h = decodeTerrarium([128, 0, 0, 255, 128, 1, 128, 255, 130, 0, 0, 255]);
  near(h[0], 0);
  near(h[1], 1.5);
  near(h[2], 512);
});

check("mosaic samples bilinearly across tiles", () => {
  const m = new Mosaic(15, 10, 20, 2, 1);
  const a = new Float32Array(TILE_PX * TILE_PX);
  const b = new Float32Array(TILE_PX * TILE_PX);
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      a[y * TILE_PX + x] = x; // rises eastwards
      b[y * TILE_PX + x] = 300 + x;
    }
  }
  m.setTile(10, 20, a);
  m.setTile(11, 20, b);
  near(m.sample(10 * TILE_PX + 3.5, 20 * TILE_PX + 7), 3.5);
  // between the last column of one tile (255) and the first of the next (300): halfway is 277.5
  near(m.sample(10 * TILE_PX + 255.5, 20 * TILE_PX + 7), 277.5);
});

check("contours of a bowl are closed loops", () => {
  const n = 5;
  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = 0.5 * ((i - 2) ** 2 + (j - 2) ** 2) + 0.25;
  const cs = contours(grid, n, n, 1);
  const level1 = cs.filter((c) => c.level === 1);
  assert.equal(level1.length, 1);
  assert.equal(level1[0].closed, true);
  for (const c of cs.filter((c) => c.level <= 2)) assert.equal(c.closed, true, `level ${c.level}`);
});

check("saddle cell gives two separate segments", () => {
  // BL and TR high, BR and TL low; the centre (5) is at the level, so the high corners join
  const grid = new Float32Array([10, 0, 0, 10]); // j=0: (0,0)=10 (1,0)=0; j=1: (0,1)=0 (1,1)=10
  const cs = contours(grid, 2, 2, 5).filter((c) => c.level === 5);
  assert.equal(cs.length, 2);
  for (const c of cs) assert.equal(c.points.length, 2);
});

check("contour labels mark every fifth level", () => {
  const n = 7;
  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = (i - 3) ** 2 + (j - 3) ** 2 + 0.25;
  const cs = contours(grid, n, n, 1);
  const majors = new Set(cs.filter((c) => c.major).map((c) => c.level));
  assert.deepEqual([...majors].sort((a, b) => a - b), [5, 10, 15]);
});

check("simplify drops collinear points", () => {
  const pts: Pt[] = [0, 1, 2, 3, 4].map((x) => ({ x, y: 0 }));
  const s = simplify(pts, 0.1);
  assert.equal(s.length, 2);
  const loop = simplifyContour([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }], true, 0.1);
  assert.ok(loop.length >= 4);
});

check("terrain features: contours and labels in world millimetres", () => {
  const n = 7;
  const grid = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = (i - 3) ** 2 + (j - 3) ** 2 + 0.25;
  const offset: Pt = { x: 1000, y: 2000 };
  const frame: GridFrame = { nx: n, ny: n, x0: offset.x - 3000, y0: offset.y - 3000, x1: offset.x + 3000, y1: offset.y + 3000 };
  const feats = terrainFeatures(grid, frame, 1);
  const labels = feats.filter((f) => f.geom.kind === "label").map((f) => (f.geom.kind === "label" ? f.geom.text : ""));
  assert.deepEqual(labels.sort(), ["10 m", "15 m", "5 m"]);
  for (const f of feats) {
    if (f.geom.kind !== "polyline") continue;
    for (const p of f.geom.points) {
      assert.ok(p.x >= offset.x - 3000 - 1e-6 && p.x <= offset.x + 3000 + 1e-6, `x ${p.x}`);
      assert.ok(p.y >= offset.y - 3000 - 1e-6 && p.y <= offset.y + 3000 + 1e-6, `y ${p.y}`);
    }
  }
  const p = gridPoint(frame, 3, 3);
  near(p.x, offset.x, 1e-6);
  near(p.y, offset.y, 1e-6);
  const g = gridCoordOf(frame, p);
  near(g.gx, 3, 1e-9);
  near(g.gy, 3, 1e-9);
});

check("sampleGrid and gridHeightAt agree", () => {
  const m = new Mosaic(14, 0, 0, 1, 1);
  const tile = new Float32Array(TILE_PX * TILE_PX);
  for (let i = 0; i < tile.length; i++) tile[i] = (i % TILE_PX) * 2;
  m.setTile(0, 0, tile);
  const grid = sampleGrid(m, 3, 3, (i, j) => ({ px: i * 10 + 0.5, py: j * 10 }));
  near(grid[0], 1);
  near(gridHeightAt(grid, 3, 3, 0.5, 0), (grid[0] + grid[1]) / 2, 1e-6);
});

// ---- shapes -----------------------------------------------------------------------

check("offset line: straight and mitred", () => {
  const straight = offsetLine([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1);
  near(straight[0].y, 1);
  near(straight[1].y, 1);
  const right = offsetLine([{ x: 0, y: 0 }, { x: 10, y: 0 }], -1);
  near(right[0].y, -1);
  const corner = offsetLine([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
  near(corner[1].x, 9, 1e-9);
  near(corner[1].y, 1, 1e-9);
});

check("polygon area and centroid", () => {
  const sq: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  near(polygonArea(sq), 1);
  const c = polygonCentroid(sq);
  near(c.x, 0.5);
  near(c.y, 0.5);
});

check("stitch ring pieces, some reversed", () => {
  const a: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  const b: Pt[] = [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  const c: Pt[] = [{ x: 0, y: 0 }, { x: 0, y: 1 }]; // runs the other way
  const rings = stitchRings([a, b, c]);
  assert.equal(rings.length, 1);
  assert.equal(rings[0].length, 5);
  near(Math.abs(polygonArea(rings[0])), 1);
});

// ---- OpenStreetMap ----------------------------------------------------------------

check("tag readings", () => {
  assert.equal(lengthM("12"), 12);
  assert.equal(lengthM("12.5 m"), 12.5);
  near(lengthM("40 ft") ?? 0, 12.192, 1e-6);
  assert.equal(lengthM("abc"), null);
  assert.equal(buildingHeightM({ height: "9" }), 9);
  near(buildingHeightM({ "building:levels": "3" }), 9.6, 1e-9);
  assert.equal(buildingHeightM({}), 6);
  assert.equal(roadWidthM({ lanes: "2" }), 7);
  assert.equal(roadWidthM({ highway: "residential" }), 6);
  assert.equal(roadWidthM({ highway: "primary", width: "8" }), 8);
  assert.equal(roadWidthM({ highway: "motorway" }), 14);
});

check("overpass query shape", () => {
  const q = overpassQuery(ORIGIN_BOX, new Set(["buildings", "trees"]));
  assert.ok(q.startsWith("[out:json][timeout:60];"));
  assert.ok(q.includes("(52,0,52.01,0.01)"));
  assert.ok(q.includes("out geom;"));
  assert.ok(q.includes('node["natural"="tree"]'));
  assert.ok(q.includes("\nout;"));
  assert.ok(!q.includes("highway"));
});

/** A mock projection: 1 mm per 1e-3 degree, x from longitude, y from latitude. */
const mock = (lat: number, lon: number): Pt => ({ x: lon * 1e6, y: lat * 1e6 });
type Kind = OsmKind;
const opts = { centreLines: false, labelHeights: true };
const ll = (pts: [number, number][]) => pts.map(([lat, lon]) => ({ lat, lon }));

check("building way: height, footprint and label", () => {
  const data: OverpassResponse = {
    elements: [
      {
        type: "way",
        id: 1,
        tags: { building: "yes", "building:levels": "2" },
        geometry: ll([[0, 0], [0, 0.001], [0.001, 0.001], [0.001, 0], [0, 0]]),
      },
    ],
  };
  const f = featuresFromOverpass(data, new Set<Kind>(["buildings"]), mock, opts);
  const poly = f.find((x) => x.cat === "buildings" && x.geom.kind === "polygon");
  assert.ok(poly);
  assert.equal(poly.heightM, 6.4);
  assert.equal((poly.geom as unknown as { points: Pt[] }).points.length, 4);
  const label = f.find((x) => x.geom.kind === "label");
  assert.ok(label && x2(label) === "6.4 m");
  const none = featuresFromOverpass(data, new Set<Kind>(["buildings"]), mock, { ...opts, labelHeights: false });
  assert.equal(none.filter((x) => x.geom.kind === "label").length, 0);
});

function x2(f: SiteFeature): string {
  return f.geom.kind === "label" ? f.geom.text : "";
}

check("road kerbs are the road's width apart", () => {
  const data: OverpassResponse = {
    elements: [{ type: "way", id: 2, tags: { highway: "residential", lanes: "2" }, geometry: ll([[0, 0], [0, 0.001]]) }],
  };
  const f = featuresFromOverpass(data, new Set<Kind>(["roads"]), mock, { centreLines: true, labelHeights: false });
  const lines = f.filter((x) => x.cat === "roads");
  assert.equal(lines.length, 3);
  const ys = lines.slice(0, 2).map((l) => (l.geom as unknown as { points: Pt[] }).points[0].y);
  // the mock maps a road running east (along lon) to a line along x, so its kerbs are 7 m apart in y
  near(Math.abs(ys[0] - ys[1]), 7000, 1e-6);
});

check("multipolygon: outer ring stitched from two ways, inner ring skipped", () => {
  const data: OverpassResponse = {
    elements: [
      {
        type: "relation",
        id: 3,
        tags: { type: "multipolygon", building: "yes" },
        members: [
          { type: "way", role: "outer", geometry: ll([[0, 0], [0, 0.001], [0.001, 0.001]]) },
          { type: "way", role: "outer", geometry: ll([[0.001, 0.001], [0.001, 0], [0, 0]]) },
          { type: "way", role: "inner", geometry: ll([[0.0002, 0.0002], [0.0002, 0.0004], [0.0004, 0.0004], [0.0002, 0.0002]]) },
        ],
      },
    ],
  };
  const f = featuresFromOverpass(data, new Set<Kind>(["buildings"]), mock, { centreLines: false, labelHeights: false });
  const polys = f.filter((x) => x.geom.kind === "polygon");
  assert.equal(polys.length, 1);
  assert.equal(polys[0].heightM, 6);
  near(Math.abs(polyArea(polys[0])), 1e6, 1e-3);
});

function polyArea(f: SiteFeature): number {
  return f.geom.kind === "polygon" ? polygonArea(f.geom.points) : 0;
}

check("nodes: trees, facilities with names and without", () => {
  const data: OverpassResponse = {
    elements: [
      { type: "node", id: 4, lat: 0, lon: 0, tags: { natural: "tree" } },
      { type: "node", id: 5, lat: 0, lon: 0.0005, tags: { amenity: "school", name: "Riverside" } },
      { type: "node", id: 6, lat: 0, lon: 0.0006, tags: { amenity: "toilets" } },
      { type: "node", id: 7, lat: 0, lon: 0.0007, tags: { highway: "bus_stop" } },
    ],
  };
  const trees = featuresFromOverpass(data, new Set<Kind>(["trees"]), mock, opts);
  assert.equal(trees.length, 1);
  assert.equal(trees[0].geom.kind, "circle");
  if (trees[0].geom.kind === "circle") assert.equal(trees[0].geom.radius, 2500);
  const fac = featuresFromOverpass(data, new Set<Kind>(["facilities"]), mock, opts);
  const labels = fac.filter((f) => f.geom.kind === "label").map(x2);
  assert.deepEqual(labels.sort(), ["Bus stop", "Riverside", "Toilets"]);
  assert.equal(fac.filter((f) => f.geom.kind === "circle").length, 3);
});

check("only chosen kinds come out", () => {
  const data: OverpassResponse = {
    elements: [
      { type: "way", id: 8, tags: { highway: "footway" }, geometry: ll([[0, 0], [0, 0.001]]) },
      { type: "way", id: 9, tags: { railway: "rail" }, geometry: ll([[0.001, 0], [0.001, 0.001]]) },
      { type: "way", id: 10, tags: { natural: "tree_row" }, geometry: ll([[0.002, 0], [0.002, 0.001]]) },
    ],
  };
  const f = featuresFromOverpass(data, new Set<Kind>(["paths", "rail"]), mock, opts);
  assert.deepEqual(f.map((x) => x.cat).sort(), ["paths", "rail", "rail"]);
});

check("water: a river band and a lake; green: a park", () => {
  const data: OverpassResponse = {
    elements: [
      { type: "way", id: 11, tags: { waterway: "river", width: "10" }, geometry: ll([[0, 0], [0, 0.001]]) },
      { type: "way", id: 12, tags: { natural: "water" }, geometry: ll([[0, 0], [0, 0.001], [0.001, 0.001], [0, 0]]) },
      { type: "way", id: 13, tags: { leisure: "park" }, geometry: ll([[0, 0], [0, 0.001], [0.001, 0.001], [0, 0]]) },
    ],
  };
  const f = featuresFromOverpass(data, new Set<Kind>(["water", "green"]), mock, opts);
  const water = f.filter((x) => x.cat === "water");
  assert.equal(water.length, 2);
  assert.ok(water.every((w) => w.geom.kind === "polygon"));
  assert.equal(f.filter((x) => x.cat === "green").length, 1);
});

// ---- writing into a drawing -----------------------------------------------------

interface FakeLayer {
  id: string;
  name: string;
  scale: number;
}

/** A session with the parts writeSiteContext uses, recording what it is asked to add. */
function fakeSession(opts: { layers: string[]; classes: string[]; canAdd: Set<NewShape["kind"]>; noExtrude?: boolean }): {
  session: EditSession;
  added: { layer: string; shape: NewShape; cls: number }[];
  classNames: string[];
  extruded: { id: string; height: number; base: number }[];
  layers: FakeLayer[];
} {
  const extruded: { id: string; height: number; base: number }[] = [];
  const layers: FakeLayer[] = opts.layers.map((name, i) => ({ id: `L${i}`, name, scale: 100 }));
  const classNames = ["None", ...opts.classes];
  const added: { layer: string; shape: NewShape; cls: number }[] = [];
  const colors = [
    { index: 0, css: "#000000", name: "Black" },
    { index: 1, css: "#ffffff", name: "White" },
    { index: 2, css: "#d8d8d8", name: "Grey" },
    { index: 3, css: "#1a7fe0", name: "Blue" },
  ];
  const session = {
    doc: {
      layers: () => layers.map((l) => ({ id: l.id, name: l.name, scale: l.scale, kind: "design" })),
      classes: () => classNames.map((name, index) => ({ index, name, visibility: "visible", objectCount: 0 })),
      colors: () => colors,
    },
    createLayer: (name: string) => {
      const id = `L${layers.length}`;
      layers.push({ id, name, scale: 100 });
      return id;
    },
    createClass: (name: string) => {
      classNames.push(name);
      return classNames.length - 1;
    },
    canAdd: (kind: NewShape["kind"]) => opts.canAdd.has(kind),
    addObject: (layer: string, shape: NewShape, cls: number) => {
      added.push({ layer, shape, cls });
      return `o${added.length}`;
    },
    extrudeObjects: (ids: string[], height: number, each?: ReadonlyMap<string, { height: number; base: number }>) => {
      if (opts.noExtrude) throw new Error("no extrude");
      extruded.push(...ids.map((id) => ({ id, height: each?.get(id)?.height ?? height, base: each?.get(id)?.base ?? 0 })));
      return ids.map((id) => `x${id}`);
    },
  };
  return { session: session as unknown as EditSession, added, classNames, extruded, layers };
}

const ALL_KINDS: NewShape["kind"][] = ["line", "rect", "roundrect", "polygon", "polyline", "arc", "text"];

check("writer: layer numbered, classes reused by name, credit at the corner", () => {
  const { session, added, classNames } = fakeSession({
    layers: ["Site Context"],
    classes: ["context-water"],
    canAdd: new Set(ALL_KINDS),
  });
  const features: SiteFeature[] = [
    { cat: "water", geom: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } },
    { cat: "buildings", geom: { kind: "polygon", points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] }, heightM: 6 },
    { cat: "trees", geom: { kind: "circle", at: { x: 5, y: 5 }, radius: 2500 } },
    { cat: "facilities", geom: { kind: "label", at: { x: 5, y: 5 }, text: "School" } },
  ];
  const r = writeSiteContext(session, features, null, { layerName: "Site Context", corner: { x: -10, y: -20 }, fallbackClass: 0 });
  assert.equal(r.layerName, "Site Context 2");
  assert.equal(added.filter((a) => a.layer === r.layerId).length, 5);
  assert.ok(classNames.includes(CLASS_NAME.buildings));
  assert.equal(classNames.filter((n) => n.toLowerCase() === "context-water").length, 1, "existing class reused");
  const credit = added[added.length - 1];
  assert.equal(credit.shape.kind, "text");
  if (credit.shape.kind === "text") {
    assert.equal(credit.shape.text, CREDIT_TEXT);
    assert.deepEqual(credit.shape.at, { x: -10, y: -20 });
    near(credit.shape.height, labelHeightMm(6, 100), 1e-9);
  }
  assert.equal(r.circlesAsPolygons, 0);
  assert.deepEqual(r.placed, { water: 1, buildings: 1, trees: 1, facilities: 1 });
});

check("writer: fallbacks when the file has no arc, polygon or text", () => {
  const { session, added } = fakeSession({ layers: [], classes: [], canAdd: new Set<NewShape["kind"]>(["line"]) });
  const features: SiteFeature[] = [
    { cat: "trees", geom: { kind: "circle", at: { x: 0, y: 0 }, radius: 2500 } },
    { cat: "roads", geom: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] } },
    { cat: "facilities", geom: { kind: "label", at: { x: 0, y: 0 }, text: "X" } },
  ];
  const r = writeSiteContext(session, features, null, { layerName: "Site Context", corner: { x: 0, y: 0 }, fallbackClass: 0 });
  assert.equal(r.layerName, "Site Context");
  assert.equal(r.circlesAsPolygons, 1);
  // the circle becomes 24 lines; the road's two segments are two lines
  assert.equal(added.filter((a) => a.shape.kind === "line").length, 24 + 2);
  assert.equal(r.skipped, 1, "the label has nowhere to go");
});

check("writer: names, colours and label heights", () => {
  assert.equal(uniqueName("Site Context", []), "Site Context");
  assert.equal(uniqueName("Site Context", ["site context"]), "Site Context 2");
  assert.equal(uniqueName("Site Context", ["Site Context", "Site Context 2"]), "Site Context 3");
  assert.equal(nearestColor([{ index: 4, css: "#fefefe" }, { index: 5, css: "#101010" }], "#ffffff"), 4);
  assert.equal(milsOf(0.25), 10);
  near(labelHeightMm(9, 100), 9 * 0.3528 * 100, 1e-9);
});

// ---- 3D: buildings on the ground, the terrain as a site model ----------------------

const square = (cx: number, cy: number, r: number): Pt[] => [
  { x: cx - r, y: cy - r },
  { x: cx + r, y: cy - r },
  { x: cx + r, y: cy + r },
  { x: cx - r, y: cy + r },
];

check("buildings stand on the lowest ground under them", () => {
  const n = 3;
  const grid = new Float32Array(n * n);
  // heights rise by 1 m per cell eastwards from 10 m
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) grid[j * n + i] = 10 + i;
  const frame: GridFrame = { nx: n, ny: n, x0: -1000, y0: -1000, x1: 1000, y1: 1000 };
  const f: SiteFeature[] = [
    { cat: "buildings", geom: { kind: "polygon", points: square(0, 0, 500) }, heightM: 9 },
    { cat: "roads", geom: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } },
  ];
  const b = withBases(f, frame, grid);
  // its west corners are half a cell from the middle: 10.5 m
  near(b[0].baseM ?? NaN, 10.5, 1e-6);
  assert.equal(b[1].baseM, undefined, "only buildings get a base");
  assert.equal(withBases(f, null, null)[0].baseM, 0, "no terrain: on the layer");
});

check("terrain points: the grid thinned, its edges kept, heights in mm", () => {
  const nx = 11;
  const ny = 6;
  const grid = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) grid[j * nx + i] = i + j / 10;
  const frame: GridFrame = { nx, ny, x0: 0, y0: 0, x1: 10000, y1: 5000 };
  const all = terrainPoints(grid, frame);
  assert.equal(all.length, nx * ny);
  const thin = terrainPoints(grid, frame, 4);
  // every 4th of 0..10 and the last: 0, 4, 8, 10 across; 0, 4, 5 up
  assert.equal(thin.length, 4 * 3);
  const xs = [...new Set(thin.map((p) => p[0]))].sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 4000, 8000, 10000]);
  const corner = thin.find((p) => p[0] === 10000 && p[1] === 5000);
  near(corner?.[2] ?? NaN, (10 + 0.5) * 1000, 1e-3);
});

check("writer: buildings extruded at their heights on their bases, the terrain a site model first", () => {
  const { session, added, extruded } = fakeSession({ layers: [], classes: [], canAdd: new Set(ALL_KINDS) });
  const features: SiteFeature[] = [
    { cat: "trees", geom: { kind: "circle", at: { x: 5, y: 5 }, radius: 2500 } },
    { cat: "buildings", geom: { kind: "polygon", points: square(0, 0, 5) }, heightM: 9.6, baseM: 2 },
    { cat: "buildings", geom: { kind: "polygon", points: square(50, 0, 5) }, heightM: 6, heightGuessed: true, baseM: 1.5 },
    { cat: "roads", geom: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] } },
  ];
  const terrain: SiteTerrain = { points: [[0, 0, 0], [10, 0, 0], [0, 10, 1000]], contours: [], interval: 1000 };
  const models: { layer: string; cls: number; points: number; interval: number }[] = [];
  const r = writeSiteContext(session, features, terrain, {
    layerName: "Site Context",
    corner: { x: 0, y: 0 },
    fallbackClass: 0,
    siteModel: (_s, layer, cls, points, interval) => {
      models.push({ layer, cls, points: points.length, interval });
      return "model";
    },
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].interval, 1000);
  assert.equal(r.terrain, "site model");
  assert.equal(r.buildings3d, 2);
  assert.equal(r.heightsGuessed, 1);
  assert.deepEqual(
    extruded.map((e) => [e.height, e.base]),
    [
      [9600, 2000],
      [6000, 1500],
    ],
  );
  // stacked ground first: the road, then the buildings, then the tree
  const kinds = added.map((a) => a.shape.kind);
  assert.deepEqual(kinds.slice(0, 4), ["polyline", "polygon", "polygon", "arc"]);
  assert.equal(r.layers.length, 1);
});

check("writer: contours when there is no site model, buildings flat when nothing extrudes", () => {
  const { session, added } = fakeSession({ layers: [], classes: [], canAdd: new Set(ALL_KINDS), noExtrude: true });
  const contour: SiteFeature = { cat: "terrain", geom: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] } };
  const r = writeSiteContext(
    session,
    [{ cat: "buildings", geom: { kind: "polygon", points: square(0, 0, 5) }, heightM: 6 }],
    { points: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], contours: [contour], interval: 1000 },
    {
      layerName: "Site Context",
      corner: { x: 0, y: 0 },
      fallbackClass: 0,
      siteModel: () => {
        throw new Error("no site model here");
      },
    },
  );
  assert.equal(r.terrain, "contours");
  assert.equal(r.buildingsFlat, 1);
  assert.equal(r.buildings3d, 0);
  assert.equal(added[0].shape.kind, "polyline", "the contour goes first");
});

check("writer: a layer for each kind, ground first, added to the ones an earlier import made", () => {
  const { session, added, layers } = fakeSession({ layers: ["Site Context Buildings"], classes: [], canAdd: new Set(ALL_KINDS) });
  const features: SiteFeature[] = [
    { cat: "buildings", geom: { kind: "polygon", points: square(0, 0, 5) }, heightM: 6 },
    { cat: "water", geom: { kind: "polygon", points: square(9, 9, 2) } },
  ];
  const r = writeSiteContext(session, features, null, { layerName: "Site Context", corner: { x: 0, y: 0 }, fallbackClass: 0, layerPerKind: true });
  assert.deepEqual(
    r.layers.map((l) => l.name),
    ["Site Context Water", "Site Context Buildings"],
  );
  assert.equal(layers.length, 2, "the buildings went on the layer that was there");
  assert.equal(r.layers[1].id, "L0");
  const onLayer = (name: string): NewShape["kind"][] => added.filter((a) => a.layer === r.layers.find((l) => l.name === name)?.id).map((a) => a.shape.kind);
  assert.deepEqual(onLayer("Site Context Water"), ["polygon", "text"], "water, and the credit on the bottom layer");
  assert.deepEqual(onLayer("Site Context Buildings"), ["polygon"]);
  assert.equal(importName("Site Context", ["Buildings"], ["site context buildings", "Site Context 2 Buildings"]), "Site Context 3");
  assert.equal(importName("Site Context", null, ["Site Context Buildings"]), "Site Context");
});

check("buildings on an edge go to the area their centre is in", () => {
  const left = { x0: -100, y0: -100, x1: 0, y1: 100 };
  const right = { x0: 0, y0: -100, x1: 100, y1: 100 };
  const b: SiteFeature = { cat: "buildings", geom: { kind: "polygon", points: square(-10, 0, 30) }, heightM: 6 };
  assert.equal(clipFeatures([b], left).length, 1);
  assert.equal(clipFeatures([b], right).length, 0);
  const far: SiteFeature = { cat: "buildings", geom: { kind: "polygon", points: square(500, 0, 5) }, heightM: 6 };
  assert.equal(clipFeatures([far], left).length, 0, "a building wholly outside is left out");
});

check("height known from height or levels, else guessed", () => {
  assert.equal(buildingHeightKnown({ height: "12" }), true);
  assert.equal(buildingHeightKnown({ "building:levels": "3" }), true);
  assert.equal(buildingHeightKnown({ building: "yes" }), false);
  const data: OverpassResponse = {
    elements: [
      {
        type: "way",
        id: 1,
        tags: { building: "yes" },
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 1 },
          { lat: 1, lon: 1 },
          { lat: 0, lon: 0 },
        ],
      },
    ],
  };
  const [f] = featuresFromOverpass(data, new Set<OsmKind>(["buildings"]), (lat, lon) => ({ x: lon, y: lat }), { centreLines: false, labelHeights: false });
  assert.equal(f.heightGuessed, true);
});

// ---- placing by the drawing's georeferencing -----------------------------------------

const VENICE: Georef = { system: "local", lat: 45.4371, lon: 12.3326, north: 0 };
const placeBy = (g: Georef): Placement => ({ toDrawing: (p) => geoToDrawing(g, p), toGeo: (p) => drawingToGeo(g, p) });

check("two areas side by side meet along one line in the drawing", () => {
  const place = placeBy(VENICE);
  const west: GeoBox = { south: 45.43, north: 45.445, west: 12.31, east: 12.335 };
  const east: GeoBox = { south: 45.43, north: 45.445, west: 12.335, east: 12.36 };
  const a = areaOf(west, place);
  const b = areaOf(east, place);
  // the shared meridian leans and the parallels bow a little in the drawing (a few cm over
  // 1.7 km here), so the rectangles round the two areas meet to within that
  near(a.x1, b.x0, 200);
  near(a.y0, b.y0, 200);
  near(a.y1, b.y1, 200);
  // a building astride the meridian is one area's: the one its centre is in, by longitude
  const onEdge = place.toDrawing({ lat: 45.4375, lon: 12.335 });
  const building: SiteFeature = { cat: "buildings", geom: { kind: "polygon", points: square(onEdge.x - 3000, onEdge.y, 10000) }, heightM: 6 };
  const inWest = clipFeatures([building], a, ownsBy(west, [], place)).length;
  const inEast = clipFeatures([building], b, ownsBy(east, [], place)).length;
  assert.equal(inWest + inEast, 1, "taken once");
  assert.equal(inWest, 1, "its centre is west of the meridian");
  // drawn again over the west area, it is left out: the earlier import has it
  const again = clipFeatures([building], a, ownsBy(west, [west], place)).length;
  assert.equal(again, 0);
  // the georeferencing's own place is the drawing's origin
  const o = place.toDrawing({ lat: VENICE.lat, lon: VENICE.lon });
  near(o.x, 0, 1e-3);
  near(o.y, 0, 1e-3);
  // what is fetched covers the area
  const fetched = boxAround(a, place);
  assert.ok(fetched.south <= west.south + 1e-9 && fetched.north >= west.north - 1e-9);
  assert.ok(fetched.west <= west.west + 1e-9 && fetched.east >= west.east - 1e-9);
});

check("a turned georeferencing fetches round the whole area", () => {
  const place = placeBy({ ...VENICE, north: 20 });
  const box: GeoBox = { south: 45.43, north: 45.44, west: 12.33, east: 12.34 };
  const area = areaOf(box, place);
  const fetched = boxAround(area, place);
  assert.ok(fetched.south < box.south && fetched.north > box.north && fetched.west < box.west && fetched.east > box.east);
});

check("the georeferencing kept in the file reads back", () => {
  const g: Georef = { system: "utm", lat: 45.4, lon: 12.3, north: 1.5, zone: 33, south: false };
  assert.deepEqual(anchorOf(anchorText(g)), g);
  assert.deepEqual(anchorOf(anchorText(VENICE)), VENICE);
  assert.equal(anchorOf("not json"), null);
  assert.equal(anchorOf(JSON.stringify({ system: "local", lat: 99, lon: 0, north: 0 })), null);
  assert.equal(anchorOf(JSON.stringify({ system: "mars", lat: 0, lon: 0, north: 0 })), null);
  const box: GeoBox = { south: 45.43, west: 12.31, north: 45.445, east: 12.335 };
  assert.deepEqual(areaOfText(areaText(box)), box);
  assert.equal(areaOfText(JSON.stringify({ south: 2, west: 0, north: 1, east: 1 })), null, "north of south");
});

check("sampling beyond the tiles' edge stays finite", () => {
  const m = new Mosaic(15, 0, 0, 1, 1);
  m.setTile(0, 0, new Float32Array(TILE_PX * TILE_PX).fill(7));
  near(m.sample(-50, 9999), 7);
});

check("decode of a flat tile gives the same height everywhere", () => {
  const rgba = new Uint8Array(4 * 4);
  for (let i = 0; i < 4; i++) {
    rgba[4 * i] = 128;
    rgba[4 * i + 1] = 23;
    rgba[4 * i + 2] = 64;
    rgba[4 * i + 3] = 255;
  }
  const h = decodeTerrarium(rgba);
  for (const v of h) near(v, 23.25, 1e-6);
});

check("box corners in any order", () => {
  const box = boxFromCorners({ lat: 52.01, lon: 0.01 }, { lat: 52, lon: 0 });
  assert.equal(box.south, 52);
  assert.equal(box.east, 0.01);
  const back = fromMetres(projectionAt({ lat: 52.005, lon: 0.005 }), 0, 0);
  near(back.lat, 52.005);
});

console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
