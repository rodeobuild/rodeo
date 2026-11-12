// The shared types of Site Context: what an import yields, in drawing millimetres with the y axis
// up: the OpenStreetMap features, and the terrain as the points of a site model.

import type { Pt } from "../../core/index.ts";

/** The kinds of context: terrain, and the OpenStreetMap kinds. */
export type SiteCategory = "terrain" | "buildings" | "roads" | "paths" | "rail" | "water" | "green" | "trees" | "facilities";

export type SiteGeom =
  /** a closed outline, with the outlines of its holes (a lagoon's islands) */
  | { readonly kind: "polygon"; readonly points: readonly Pt[]; readonly holes?: readonly (readonly Pt[])[] }
  /** a line: open, or a loop when `closed` (a contour that closes on itself) */
  | { readonly kind: "polyline"; readonly points: readonly Pt[]; readonly closed?: boolean }
  /** a road or a railway: drawn as its two edges, `half` mm either side of its line, and the line itself when `centre` */
  | { readonly kind: "band"; readonly points: readonly Pt[]; readonly half: number; readonly centre?: boolean }
  /** a circle (a tree's canopy, a facility's marker) */
  | { readonly kind: "circle"; readonly at: Pt; readonly radius: number }
  /** a text label, at its anchor */
  | { readonly kind: "label"; readonly at: Pt; readonly text: string };

/** How a feature shows in 3D, on the ground. */
export type Ground =
  /** its outline filled: a polygon with its holes */
  | { readonly kind: "area" }
  /** a strip `width` mm wide along its line (a band's or a polyline's) */
  | { readonly kind: "strip"; readonly width: number }
  /** a tree standing at its circle's centre, or trees along its line */
  | { readonly kind: "tree" };

export interface SiteFeature {
  readonly cat: SiteCategory;
  readonly geom: SiteGeom;
  /** how it shows in 3D, laid on the ground (none: in plan only, or a building, which stands as an extrude) */
  readonly ground?: Ground;
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
