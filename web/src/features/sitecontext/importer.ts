// Site Context's import, without the dialog: fetches what was asked for and turns it into features
// in drawing millimetres, placed by `place` (the drawing's georeferencing), and the terrain as the
// points of a site model with its contours beside. The imported area is the drawing's rectangle
// round the chosen box, so two imports side by side meet along a line. The pure parts (the grid,
// the terrain's points and contours, the buildings' bases) are exported for check.ts.

import type { Pt } from "../../core/index.ts";
import { pixelOf, terrainGridSize, terrainZoom, tilesCovering, type GeoBox, type GeoPoint } from "./geo.ts";
import { clipFeatures, type Rect } from "./clip.ts";
import { featuresFromOverpass, OSM_KINDS, overpassQuery, type OsmKind } from "./osm.ts";
import type { Pt3, SiteCategory, SiteFeature, SiteTerrain } from "./model.ts";
import { fetchOverpass, fetchTerrainTile } from "./services.ts";
import { contours, gridHeightAt, Mosaic, sampleGrid, simplifyContour } from "./terrain.ts";
import { polygonCentroid } from "./shapes.ts";

/** The terrain grid's frame: how many samples across and up, over a rectangle of the drawing (mm). */
export interface GridFrame {
  readonly nx: number;
  readonly ny: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** Where places go in the drawing, and back. */
export interface Placement {
  /** a place's point in the drawing, mm */
  readonly toDrawing: (p: GeoPoint) => Pt;
  /** the place at a point of the drawing */
  readonly toGeo: (p: Pt) => GeoPoint;
}

/** Tolerance for simplifying a contour, in grid cells: the staircase of the samples is smoothed to this. */
const CONTOUR_TOLERANCE = 0.4;
/** The most points a site model takes across the area's longer side: the terrain tiles are coarser than this anyway. */
export const SITE_MODEL_SAMPLES = 160;

/** The drawing point of a grid position (in cells). */
export function gridPoint(frame: GridFrame, gx: number, gy: number): Pt {
  return {
    x: frame.x0 + (gx * (frame.x1 - frame.x0)) / (frame.nx - 1),
    y: frame.y0 + (gy * (frame.y1 - frame.y0)) / (frame.ny - 1),
  };
}

/** The grid position (in cells) of a drawing point: the inverse of gridPoint. */
export function gridCoordOf(frame: GridFrame, p: Pt): { gx: number; gy: number } {
  return {
    gx: ((p.x - frame.x0) * (frame.nx - 1)) / (frame.x1 - frame.x0),
    gy: ((p.y - frame.y0) * (frame.ny - 1)) / (frame.y1 - frame.y0),
  };
}

/** The drawing's rectangle round a box's corners, placed. */
export function areaOf(box: GeoBox, place: Placement): Rect {
  const corners = [
    { lat: box.south, lon: box.west },
    { lat: box.south, lon: box.east },
    { lat: box.north, lon: box.east },
    { lat: box.north, lon: box.west },
  ].map(place.toDrawing);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** True when a place is in the box: south and west edges in, north and east out, so boxes side by side share none. */
export function inBox(box: GeoBox, g: GeoPoint): boolean {
  return g.lat >= box.south && g.lat < box.north && g.lon >= box.west && g.lon < box.east;
}

/** Whether a drawing point is the area's own: in its box, and in no earlier import's. */
export function ownsBy(box: GeoBox, earlier: readonly GeoBox[], place: Placement): (p: Pt) => boolean {
  return (p) => {
    const g = place.toGeo(p);
    return inBox(box, g) && !earlier.some((e) => inBox(e, g));
  };
}

/** The box (degrees) round a rectangle of the drawing, for what to fetch: a turned or curved placing needs a little more than was chosen. */
export function boxAround(area: Rect, place: Placement): GeoBox {
  const geo = [
    { x: area.x0, y: area.y0 },
    { x: area.x1, y: area.y0 },
    { x: area.x1, y: area.y1 },
    { x: area.x0, y: area.y1 },
  ].map(place.toGeo);
  const lats = geo.map((g) => g.lat);
  const lons = geo.map((g) => g.lon);
  return { south: Math.min(...lats), north: Math.max(...lats), west: Math.min(...lons), east: Math.max(...lons) };
}

/**
 * Contour lines for a grid of heights in metres. Every fifth height (a major contour) is labelled
 * once with its height, on its longest piece: a contour the edge of the area breaks into pieces
 * still gets one label.
 */
export function terrainFeatures(grid: Float32Array, frame: GridFrame, interval: number): SiteFeature[] {
  const lines = contours(grid, frame.nx, frame.ny, interval).map((c) => ({
    c,
    pts: simplifyContour(c.points, c.closed, CONTOUR_TOLERANCE),
  }));
  const labelled = new Map<number, number>();
  lines.forEach(({ c, pts }, k) => {
    if (!c.major || pts.length < 2) return;
    const best = labelled.get(c.level);
    if (best === undefined || (lines[best].pts.length < pts.length)) labelled.set(c.level, k);
  });
  const out: SiteFeature[] = [];
  lines.forEach(({ c, pts }, k) => {
    if (pts.length < 2) return;
    const world = pts.map((p) => gridPoint(frame, p.x, p.y));
    out.push({ cat: "terrain", geom: { kind: "polyline", points: world, closed: c.closed && pts.length >= 3 } });
    if (labelled.get(c.level) === k) {
      out.push({ cat: "terrain", geom: { kind: "label", at: world[Math.floor(world.length / 2)], text: `${c.level} m` } });
    }
  });
  return out;
}

/**
 * The site model's points: the grid thinned to at most `most` across its longer side, keeping its
 * last row and column so the model reaches the area's edges. Heights in mm above sea level.
 */
export function terrainPoints(grid: Float32Array, frame: GridFrame, most = SITE_MODEL_SAMPLES): Pt3[] {
  const step = Math.max(1, Math.ceil((Math.max(frame.nx, frame.ny) - 1) / (most - 1)));
  const along = (n: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n - 1; k += step) out.push(k);
    out.push(n - 1);
    return out;
  };
  const out: Pt3[] = [];
  for (const j of along(frame.ny)) {
    for (const i of along(frame.nx)) {
      const z = grid[j * frame.nx + i];
      if (!Number.isFinite(z)) continue;
      const p = gridPoint(frame, i, j);
      out.push([p.x, p.y, z * 1000]);
    }
  }
  return out;
}

/**
 * The buildings with the ground each stands on (baseM): the lowest of the terrain under its corners
 * and its centre, so it meets the ground all round. Without terrain they stand at 0.
 */
export function withBases(features: readonly SiteFeature[], frame: GridFrame | null, grid: Float32Array | null): SiteFeature[] {
  return features.map((f) => {
    if (f.cat !== "buildings" || f.geom.kind !== "polygon") return f;
    if (!grid || !frame) return { ...f, baseM: 0 };
    let low = Number.POSITIVE_INFINITY;
    for (const p of [...f.geom.points, polygonCentroid(f.geom.points)]) {
      const { gx, gy } = gridCoordOf(frame, p);
      const h = gridHeightAt(grid, frame.nx, frame.ny, gx, gy);
      if (Number.isFinite(h) && h < low) low = h;
    }
    return { ...f, baseM: Number.isFinite(low) ? low : 0 };
  });
}

export interface ImportRequest {
  readonly box: GeoBox;
  readonly kinds: ReadonlySet<SiteCategory>;
  /** metres */
  readonly contourInterval: number;
  readonly labelHeights: boolean;
  readonly centreLines: boolean;
  readonly place: Placement;
  /** the areas imported before: their buildings, trees and facilities are left out here */
  readonly earlier?: readonly GeoBox[];
}

export interface ImportResult {
  /** the OpenStreetMap features; buildings with their height and base */
  readonly features: SiteFeature[];
  readonly terrain: SiteTerrain | null;
  /** the imported rectangle of the drawing, mm */
  readonly area: Rect;
  /** how many terrain tiles were read (0 without terrain) */
  readonly tiles: number;
}

/** Reports a step of the import: a new step, or (sameStep) the progress of the current one. */
export type StepReport = (label: string, sameStep?: boolean) => void;

/**
 * Runs the import: one Overpass request for the OpenStreetMap kinds, the terrain tiles, the site
 * model's points and the contours. Throws on failure (an AbortError when the signal is aborted).
 */
export async function runImport(req: ImportRequest, signal: AbortSignal, step: StepReport): Promise<ImportResult> {
  const area = areaOf(req.box, req.place);
  const fetchBox = boxAround(area, req.place);
  const toWorld = (lat: number, lon: number): Pt => req.place.toDrawing({ lat, lon });

  const found: SiteFeature[] = [];
  const osmKinds = OSM_KINDS.filter((k) => req.kinds.has(k));
  if (osmKinds.length > 0) {
    step("Fetching OpenStreetMap data");
    const kinds = new Set<OsmKind>(osmKinds);
    const data = await fetchOverpass(overpassQuery(fetchBox, kinds), signal);
    step("Reading the features");
    const all = featuresFromOverpass(data, kinds, toWorld, { centreLines: req.centreLines, labelHeights: req.labelHeights });
    found.push(...clipFeatures(all, area, ownsBy(req.box, req.earlier ?? [], req.place)));
  }

  let grid: Float32Array | null = null;
  let frame: GridFrame | null = null;
  let terrain: SiteTerrain | null = null;
  let tileCount = 0;
  if (req.kinds.has("terrain")) {
    const zoom = terrainZoom(fetchBox);
    const { nx, ny } = terrainGridSize(fetchBox, zoom);
    frame = { nx, ny, ...area };
    const tiles = tilesCovering(fetchBox, zoom);
    tileCount = tiles.cols * tiles.rows;
    const mosaic = new Mosaic(zoom, tiles.x0, tiles.y0, tiles.cols, tiles.rows);
    step(`Fetching terrain tiles (zoom ${zoom})`);
    let done = 0;
    const jobs: Promise<void>[] = [];
    for (let ty = tiles.y0; ty < tiles.y0 + tiles.rows; ty++) {
      for (let tx = tiles.x0; tx < tiles.x0 + tiles.cols; tx++) {
        jobs.push(
          fetchTerrainTile(zoom, tx, ty, signal).then((heights) => {
            mosaic.setTile(tx, ty, heights);
            done++;
            step(`Fetching terrain tiles: ${done} of ${tileCount}`, true);
          }),
        );
      }
    }
    await Promise.all(jobs);
    step("Sampling the terrain");
    const f = frame;
    grid = sampleGrid(mosaic, nx, ny, (i, j) => pixelOf(req.place.toGeo(gridPoint(f, i, j)), zoom));
    if (grid.some((v) => Number.isNaN(v))) throw new Error("The terrain tiles did not cover the whole area.");
    terrain = {
      points: terrainPoints(grid, frame),
      contours: terrainFeatures(grid, frame, req.contourInterval),
      interval: req.contourInterval * 1000,
    };
  }

  return { features: withBases(found, frame, grid), terrain, area, tiles: tileCount };
}
