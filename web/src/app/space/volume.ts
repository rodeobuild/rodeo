// A Space's volume in 3D: the room's boundary raised from its floor to its ceiling, as faces for
// EditSession.addMeshes (flat x, y, z corner lists, mm). Free of the page.

import type { Pt } from "../../core/index.ts";
import { signedArea } from "./model.ts";

/** A closed prism over `ring` from `z0` up to `z1`: its top, its bottom and a face for each side, all facing out. Nothing when it has no height or fewer than three corners. */
export function prismFaces(ring: readonly Pt[], z0: number, z1: number): number[][] {
  if (ring.length < 3 || !(z1 > z0)) return [];
  const up = signedArea(ring) > 0 ? ring : [...ring].reverse();
  const top = up.flatMap((p) => [p.x, p.y, z1]);
  const bottom = [...up].reverse().flatMap((p) => [p.x, p.y, z0]);
  const sides = up.map((p, i) => {
    const q = up[(i + 1) % up.length];
    return [p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, z1, p.x, p.y, z1];
  });
  return [top, bottom, ...sides];
}

/** The heights a room's volume spans above its layer: from its finished floor up by its clear height. */
export function volumeSpan(floorElevation: number, height: number): { bottom: number; top: number } | null {
  return height > 0 ? { bottom: floorElevation, top: floorElevation + height } : null;
}
