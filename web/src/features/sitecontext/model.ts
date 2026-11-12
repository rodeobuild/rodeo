// The shared types of Site Context: what an import yields, in drawing millimetres with the y axis
// up: the OpenStreetMap features, and the terrain as the points of a site model.

import type { Pt } from "../../core/index.ts";

/** The kinds of context: terrain, and the OpenStreetMap kinds. */
export type SiteCategory = "terrain" | "buildings" | "roads" | "paths" | "rail" | "water" | "green" | "trees" | "facilities";

export type SiteGeom =
  /** a closed outline */
  | { readonly kind: "polygon"; readonly points: readonly Pt[] }
  /** a line: open, or a loop when `closed` (a contour that closes on itself) */
  | { readonly kind: "polyline"; readonly points: readonly Pt[]; readonly closed?: boolean }
  /** a circle (a tree's canopy, a facility's marker) */
  | { readonly kind: "circle"; readonly at: Pt; readonly radius: number }
  /** a text label, at its anchor */
  | { readonly kind: "label"; readonly at: Pt; readonly text: string };

export interface SiteFeature {
  readonly cat: SiteCategory;
  readonly geom: SiteGeom;
  /** buildings: the height, metres */
  readonly heightM?: number;
  /** buildings: true when OpenStreetMap gives neither its height nor its levels, so heightM is the default */
  readonly heightGuessed?: boolean;
  /** buildings: the ground it stands on, metres above sea level (the lowest under its outline); 0 without terrain */
  readonly baseM?: number;
}

/** A point of the terrain: x, y and its height, all millimetres (the height above sea level). */
export type Pt3 = readonly [number, number, number];

/** The terrain an import read. */
export interface SiteTerrain {
  /** the site model's points: a regular grid over the area */
  readonly points: readonly Pt3[];
  /** its contour lines and their labels, drawn instead when the drawing can't take a site model */
  readonly contours: readonly SiteFeature[];
  /** the contour interval, mm */
  readonly interval: number;
}
