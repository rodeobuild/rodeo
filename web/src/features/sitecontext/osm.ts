// OpenStreetMap for Site Context: the Overpass query for the chosen kinds, the tags each kind is
// read from, and the reading of Overpass's JSON (out geom for ways and relations, out for nodes)
// into features in world millimetres. Heights, widths and the rest of the rules are here too.

import type { Pt } from "../../core/index.ts";
import type { GeoBox } from "./geo.ts";
import type { Ground, SiteFeature } from "./model.ts";
import { offsetLine, polygonCentroid, ringsWithHoles, samePoint, stitchRings } from "./shapes.ts";

/** The OpenStreetMap kinds, in the order the dialog lists them. */
export const OSM_KINDS = ["buildings", "roads", "paths", "rail", "water", "green", "trees", "facilities"] as const;
export type OsmKind = (typeof OSM_KINDS)[number];

export const ROAD_HIGHWAYS = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "living_street",
  "motorway_link",
  "trunk_link",
  "primary_link",
  "secondary_link",
  "tertiary_link",
];
export const PATH_HIGHWAYS = ["footway", "path", "cycleway", "pedestrian", "bridleway", "steps", "track"];
export const RAIL_TYPES = ["rail", "light_rail", "subway", "tram", "narrow_gauge", "monorail", "funicular"];
export const WATERWAYS = ["river", "stream", "canal", "drain", "ditch"];
const GREEN_LANDUSE = ["grass", "forest", "meadow"];
const GREEN_NATURAL = ["wood", "scrub"];

/** Public facilities (amenity values) and the label each gets when it has no name. */
export const FACILITY_LABELS: Readonly<Record<string, string>> = {
  school: "School",
  college: "College",
  university: "University",
  hospital: "Hospital",
  library: "Library",
  police: "Police",
  fire_station: "Fire station",
  place_of_worship: "Place of worship",
  community_centre: "Community centre",
  bus_station: "Bus station",
  parking: "Parking",
  toilets: "Toilets",
};

/** Widths used when a road has no width or lanes tag, metres. */
const ROAD_WIDTH_M: Readonly<Record<string, number>> = {
  motorway: 14,
  trunk: 12,
  primary: 10,
  secondary: 8,
  tertiary: 7,
  unclassified: 6,
  residential: 6,
  living_street: 5,
  service: 4,
};
const LINK_WIDTH_M = 5;
const LANE_M = 3.5;
const DEFAULT_ROAD_M = 6;
/** Widths used when a path has no width tag, metres. */
const PATH_WIDTH_M: Readonly<Record<string, number>> = { footway: 2, path: 1.5, cycleway: 2.5, pedestrian: 4, bridleway: 2, steps: 2, track: 3 };
const DEFAULT_PATH_M = 2;
const WATERWAY_WIDTH_M: Readonly<Record<string, number>> = { river: 10, canal: 8, stream: 2, drain: 1.5, ditch: 1 };
const DEFAULT_WATERWAY_M = 2;
const LEVEL_M = 3.2;
export const DEFAULT_BUILDING_M = 6;
/** a standard gauge railway's rails, metres apart (centre to centre of the offsets: half each side) */
const RAIL_GAUGE_M = 1.435;
/** a railway's bed in 3D, metres across */
const RAIL_BED_M = 3;
/** tree canopy: a circle 5 m across */
const TREE_RADIUS_MM = 2500;
/** a facility's marker: a circle 2 m across */
const MARKER_RADIUS_MM = 1000;

export type Tags = Readonly<Partial<Record<string, string>>>;

export interface OverpassCoord {
  readonly lat: number;
  readonly lon: number;
}

export interface OverpassElement {
  readonly type: "node" | "way" | "relation";
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly tags?: Tags;
  readonly geometry?: readonly OverpassCoord[];
  readonly members?: readonly { readonly type: string; readonly role: string; readonly geometry?: readonly OverpassCoord[] }[];
}

export interface OverpassResponse {
  readonly elements?: readonly OverpassElement[];
  /** Overpass's note on a query it could not finish, when it has one */
  readonly remark?: string;
}

export interface FeatureOptions {
  /** roads also get their centre line */
  readonly centreLines: boolean;
  /** buildings get a height label at their centre */
  readonly labelHeights: boolean;
}

/** The Overpass query for the chosen kinds in a box: one request, ways and relations with their geometry, then nodes. */
export function overpassQuery(box: GeoBox, kinds: ReadonlySet<OsmKind>): string {
  const bb = `(${box.south},${box.west},${box.north},${box.east})`;
  const alt = (list: readonly string[]): string => `~"^(${list.join("|")})$"`;
  const ways: string[] = [];
  const nodes: string[] = [];
  if (kinds.has("buildings")) {
    ways.push(`way["building"]${bb};`, `relation["building"]["type"="multipolygon"]${bb};`);
  }
  if (kinds.has("roads")) ways.push(`way["highway"${alt(ROAD_HIGHWAYS)}]${bb};`);
  if (kinds.has("paths")) ways.push(`way["highway"${alt(PATH_HIGHWAYS)}]${bb};`);
  if (kinds.has("rail")) ways.push(`way["railway"${alt(RAIL_TYPES)}]${bb};`);
  if (kinds.has("water")) {
    ways.push(
      `way["natural"="water"]${bb};`,
      `relation["natural"="water"]["type"="multipolygon"]${bb};`,
      `way["waterway"${alt(WATERWAYS)}]${bb};`,
    );
  }
  if (kinds.has("green")) {
    ways.push(
      `way["leisure"="park"]${bb};`,
      `relation["leisure"="park"]["type"="multipolygon"]${bb};`,
      `way["landuse"${alt(GREEN_LANDUSE)}]${bb};`,
      `relation["landuse"${alt(GREEN_LANDUSE)}]["type"="multipolygon"]${bb};`,
      `way["natural"${alt(GREEN_NATURAL)}]${bb};`,
      `relation["natural"${alt(GREEN_NATURAL)}]["type"="multipolygon"]${bb};`,
    );
  }
  if (kinds.has("trees")) {
    nodes.push(`node["natural"="tree"]${bb};`);
    ways.push(`way["natural"="tree_row"]${bb};`);
  }
  if (kinds.has("facilities")) {
    const amenities = alt(Object.keys(FACILITY_LABELS));
    nodes.push(`node["amenity"${amenities}]${bb};`, `node["public_transport"]${bb};`, `node["highway"="bus_stop"]${bb};`);
    ways.push(`way["amenity"${amenities}]${bb};`);
  }
  const lines = ["[out:json][timeout:60];"];
  if (ways.length > 0) lines.push("(", ...ways, ");", "out geom;");
  if (nodes.length > 0) lines.push("(", ...nodes, ");", "out;");
  return lines.join("\n");
}

/** A length tag in metres: "12", "12.5 m", "40 ft" or "40'"; null when it is not a length. */
export function lengthM(value: string | undefined): number | null {
  if (value === undefined) return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(ft|feet|')?/i.exec(value);
  if (!m) return null;
  const v = parseFloat(m[1]) * (m[2] ? 0.3048 : 1);
  return v > 0 ? v : null;
}

/** True when a building's tags give its height or its levels (else it is drawn DEFAULT_BUILDING_M tall). */
export function buildingHeightKnown(tags: Tags): boolean {
  return lengthM(tags.height) !== null || parseFloat(tags["building:levels"] ?? "") > 0;
}

/** A building's height: its height tag, else its levels at 3.2 m each, else 6 m. */
export function buildingHeightM(tags: Tags): number {
  const h = lengthM(tags.height);
  if (h !== null) return h;
  const levels = parseFloat(tags["building:levels"] ?? "");
  if (levels > 0) return levels * LEVEL_M;
  return DEFAULT_BUILDING_M;
}

/** A road's width: its width tag, else its lanes at 3.5 m each, else a default for its kind. */
export function roadWidthM(tags: Tags): number {
  const w = lengthM(tags.width);
  if (w !== null) return w;
  const lanes = parseInt(tags.lanes ?? "", 10);
  if (lanes > 0) return lanes * LANE_M;
  const highway = tags.highway ?? "";
  if (highway.endsWith("_link")) return LINK_WIDTH_M;
  return ROAD_WIDTH_M[highway] ?? DEFAULT_ROAD_M;
}

/** A path's width: its width tag, else a default for its kind. */
export function pathWidthM(tags: Tags): number {
  const w = lengthM(tags.width);
  if (w !== null) return w;
  return PATH_WIDTH_M[tags.highway ?? ""] ?? DEFAULT_PATH_M;
}

/** A waterway's width: its width tag, else a default for its kind. */
export function waterwayWidthM(tags: Tags): number {
  const w = lengthM(tags.width);
  if (w !== null) return w;
  return WATERWAY_WIDTH_M[tags.waterway ?? ""] ?? DEFAULT_WATERWAY_M;
}

function isFacility(tags: Tags): boolean {
  return (
    (tags.amenity !== undefined && Object.hasOwn(FACILITY_LABELS, tags.amenity)) ||
    tags.public_transport !== undefined ||
    tags.highway === "bus_stop"
  );
}

function isGreen(tags: Tags): boolean {
  return (
    tags.leisure === "park" ||
    (tags.landuse !== undefined && GREEN_LANDUSE.includes(tags.landuse)) ||
    (tags.natural !== undefined && GREEN_NATURAL.includes(tags.natural))
  );
}

/** A facility's label: its name, else what kind of place it is. */
export function facilityLabel(tags: Tags): string {
  if (tags.name) return tags.name;
  if (tags.amenity !== undefined && Object.hasOwn(FACILITY_LABELS, tags.amenity)) return FACILITY_LABELS[tags.amenity];
  if (tags.highway === "bus_stop") return "Bus stop";
  if (tags.railway === "tram_stop") return "Tram stop";
  if (tags.railway === "station") return "Station";
  return "Stop";
}

/** A building height as its label: "6 m", "9.6 m". */
export function heightLabel(h: number): string {
  return Number.isInteger(h) ? `${h} m` : `${h.toFixed(1)} m`;
}

/**
 * The features of the chosen OpenStreetMap kinds, in world millimetres. `toWorld` maps a latitude
 * and longitude to the drawing's point (the projection, with the area's offset applied).
 */
export function featuresFromOverpass(
  data: OverpassResponse,
  kinds: ReadonlySet<OsmKind>,
  toWorld: (lat: number, lon: number) => Pt,
  options: FeatureOptions,
): SiteFeature[] {
  const out: SiteFeature[] = [];
  const add = (cat: SiteFeature["cat"], geom: SiteFeature["geom"], ground?: Ground): void => {
    out.push(ground ? { cat, geom, ground } : { cat, geom });
  };
  const AREA: Ground = { kind: "area" };
  const TREE: Ground = { kind: "tree" };
  // geometry is kept as points with x = longitude, y = latitude until it is projected
  const lonLat = (coords: readonly OverpassCoord[]): Pt[] => coords.map((c) => ({ x: c.lon, y: c.lat }));
  const toPt = (p: Pt): Pt => toWorld(p.y, p.x);
  const closedLoop = (pts: readonly Pt[]): boolean => pts.length >= 4 && samePoint(pts[0], pts[pts.length - 1]);
  /** a closed ring as a polygon: its closing point dropped */
  const outline = (ring: readonly Pt[]): Pt[] => ring.slice(0, -1).map(toPt);
  const centreOf = (pts: readonly Pt[], closed: boolean): Pt => (closed ? polygonCentroid(pts) : meanOf(pts));

  const facility = (at: Pt, tags: Tags): void => {
    add("facilities", { kind: "circle", at, radius: MARKER_RADIUS_MM });
    add("facilities", { kind: "label", at: { x: at.x + MARKER_RADIUS_MM, y: at.y + MARKER_RADIUS_MM }, text: facilityLabel(tags) });
  };

  /**
   * An area: a building (with its height; its courtyards are not cut out), water or green space
   * (with its holes: a lagoon's islands), each outer ring a polygon.
   */
  const areas = (cat: "buildings" | "water" | "green", shapes: readonly { readonly outer: Pt[]; readonly holes: readonly Pt[][] }[], tags: Tags): void => {
    for (const shape of shapes) {
      const points = outline(shape.outer);
      if (points.length < 3) continue;
      if (cat === "buildings") {
        const heightM = buildingHeightM(tags);
        out.push(buildingHeightKnown(tags) ? { cat, geom: { kind: "polygon", points }, heightM } : { cat, geom: { kind: "polygon", points }, heightM, heightGuessed: true });
        if (options.labelHeights) add("buildings", { kind: "label", at: polygonCentroid(points), text: heightLabel(heightM) });
      } else {
        const holes = shape.holes.map(outline).filter((h) => h.length >= 3);
        add(cat, holes.length ? { kind: "polygon", points, holes } : { kind: "polygon", points }, AREA);
      }
    }
  };
  const whole = (ring: Pt[]): { outer: Pt[]; holes: Pt[][] }[] => [{ outer: ring, holes: [] }];

  for (const el of data.elements ?? []) {
    const tags: Tags = el.tags ?? {};

    if (el.type === "node") {
      if (el.lat === undefined || el.lon === undefined) continue;
      const at = toWorld(el.lat, el.lon);
      if (kinds.has("trees") && tags.natural === "tree") add("trees", { kind: "circle", at, radius: TREE_RADIUS_MM }, TREE);
      if (kinds.has("facilities") && isFacility(tags)) facility(at, tags);
      continue;
    }

    if (el.type === "way") {
      const geo = el.geometry;
      if (!geo || geo.length < 2) continue;
      const ll = lonLat(geo);
      const closed = closedLoop(ll);
      const world = ll.map(toPt);
      if (kinds.has("buildings") && tags.building !== undefined && tags.building !== "no" && closed) {
        areas("buildings", whole(ll), tags);
      }
      if (kinds.has("roads") && tags.highway !== undefined && ROAD_HIGHWAYS.includes(tags.highway)) {
        const width = roadWidthM(tags) * 1000;
        add("roads", { kind: "band", points: world, half: width / 2, centre: options.centreLines }, { kind: "strip", width });
      }
      if (kinds.has("paths") && tags.highway !== undefined && PATH_HIGHWAYS.includes(tags.highway)) {
        // a square or a pedestrian area: its outline, paved in 3D
        if (closed && tags.area === "yes") add("paths", { kind: "polygon", points: outline(ll) }, AREA);
        else add("paths", { kind: "polyline", points: world }, { kind: "strip", width: pathWidthM(tags) * 1000 });
      }
      if (kinds.has("rail") && tags.railway !== undefined && RAIL_TYPES.includes(tags.railway)) {
        add("rail", { kind: "band", points: world, half: (RAIL_GAUGE_M * 1000) / 2 }, { kind: "strip", width: RAIL_BED_M * 1000 });
      }
      if (kinds.has("water")) {
        if (tags.natural === "water" && closed) areas("water", whole(ll), tags);
        if (tags.waterway !== undefined && WATERWAYS.includes(tags.waterway) && !closed) {
          // a waterway is drawn as its banks: a band as wide as it is
          const half = (waterwayWidthM(tags) * 1000) / 2;
          const banks = [...offsetLine(world, half), ...offsetLine(world, -half).reverse()];
          if (banks.length >= 3) add("water", { kind: "polygon", points: banks }, AREA);
        }
      }
      if (kinds.has("green") && closed && isGreen(tags)) areas("green", whole(ll), tags);
      if (kinds.has("trees") && tags.natural === "tree_row") add("trees", { kind: "polyline", points: world }, TREE);
      if (kinds.has("facilities") && isFacility(tags)) facility(centreOf(world, closed), tags);
      continue;
    }

    if (el.type === "relation" && tags.type === "multipolygon") {
      const pieces = (role: string): Pt[][] =>
        (el.members ?? []).filter((m) => m.role === role && m.geometry && m.geometry.length >= 2).map((m) => lonLat(m.geometry ?? []));
      const rings = stitchRings(pieces("outer"));
      if (rings.length === 0) continue;
      const water = kinds.has("water") && tags.natural === "water";
      const green = kinds.has("green") && isGreen(tags);
      // the holes only where they are cut out: a lagoon's islands, a park's pond
      const shapes = water || green ? ringsWithHoles(rings, stitchRings(pieces("inner"))) : rings.map((outer) => ({ outer, holes: [] }));
      if (kinds.has("buildings") && tags.building !== undefined && tags.building !== "no") areas("buildings", shapes, tags);
      if (water) areas("water", shapes, tags);
      if (green) areas("green", shapes, tags);
      if (kinds.has("facilities") && isFacility(tags)) facility(polygonCentroid(outline(rings[0])), tags);
    }
  }
  return out;
}

function meanOf(pts: readonly Pt[]): Pt {
  const n = Math.max(pts.length, 1);
  return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
}
