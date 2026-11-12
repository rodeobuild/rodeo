// What Site Context keeps in the file about each import. The drawing's georeferencing lives in
// this browser (app/georef.ts), so each import also writes it into a record on its credit text,
// with the area it covered; a later import, here or in another browser, reads them back from
// there, so it lines up with the earlier ones and doesn't bring their buildings in again. No DOM,
// so check.ts can run it.

import type { Georef } from "../../app/geoShapes.ts";
import type { GeoBox } from "./geo.ts";

/** The record format on each import's credit text (not "Site Context": that is the layer's name, and names can't repeat). */
export const ANCHOR_FORMAT = "Site Context Data";
/** Its field: the georeferencing the import was placed by, as JSON. */
export const ANCHOR_FIELD = "Georeferencing";
/** Its field: the area imported, as JSON (south, west, north, east in degrees). */
export const AREA_FIELD = "Area";

/** The area as the field keeps it. */
export function areaText(box: GeoBox): string {
  return JSON.stringify({ south: box.south, west: box.west, north: box.north, east: box.east });
}

/** The area a field holds; null when it holds none that reads. */
export function areaOfText(text: string): GeoBox | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const ok = (v: unknown, lim: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
  if (!ok(r.south, 90) || !ok(r.north, 90) || !ok(r.west, 180) || !ok(r.east, 180)) return null;
  if (!(r.north > r.south) || !(r.east > r.west)) return null;
  return { south: r.south, west: r.west, north: r.north, east: r.east };
}

const SYSTEMS: readonly string[] = ["local", "utm", "pseudo-mercator"];

/** The georeferencing as the field keeps it. */
export function anchorText(g: Georef): string {
  return JSON.stringify({
    system: g.system,
    lat: g.lat,
    lon: g.lon,
    north: g.north,
    ...(g.zone !== undefined ? { zone: g.zone } : {}),
    ...(g.south !== undefined ? { south: g.south } : {}),
  });
}

/** The georeferencing a field holds; null when it holds none that reads. */
export function anchorOf(text: string): Georef | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(r.lat) || !finite(r.lon) || !finite(r.north) || typeof r.system !== "string" || !SYSTEMS.includes(r.system)) return null;
  if (Math.abs(r.lat) > 90 || Math.abs(r.lon) > 180) return null;
  return {
    system: r.system as Georef["system"],
    lat: r.lat,
    lon: r.lon,
    north: r.north,
    ...(finite(r.zone) ? { zone: r.zone } : {}),
    ...(typeof r.south === "boolean" ? { south: r.south } : {}),
  };
}
