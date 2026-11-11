// A Rodeo Instrument's 3D body (features/theatre/instrument.ts): a generic yoke and can, or a moving
// head on its yoke, by the instrument's glyph (lightingDeviceShapes.ts), at its size in mm. Its
// lens sits at the origin, its front along +x before it is turned and tilted: the yoke stays, the
// head pitches toward its focus. It hangs, its yoke's top (where it clamps) hangDrop above the
// lens, or stands on its yoke turned over. Kept apart from the page so it runs without it.

import { loft, mapSolid, placedSolid, prism, type Point3, type Solid } from "./solids3d.ts";
import type { Instrument } from "./lightingDeviceShapes.ts";

/** facets round a barrel */
const SIDES = 12;
const ZERO = { x: 0, y: 0 };

/** A cylinder along x from x0 to x1, its axis through the origin, radius r. */
function barrel(r: number, x0: number, x1: number): Solid {
  const ring = (x: number): Point3[] =>
    Array.from({ length: SIDES }, (_, i): Point3 => {
      const t = (i * 2 * Math.PI) / SIDES;
      return [x, r * Math.cos(t), r * Math.sin(t)];
    });
  return loft([ring(x0), ring(x1)]);
}

/** A box spanning x0 to x1, y0 to y1 and z0 to z1. */
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid {
  return prism([[{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]], z0, z1);
}

/** How far a moving head's base, on top when it hangs, is above its lens: clear of its head (a 440 mm drum of radius 200) at any tilt. */
const MOVING_BASE_DROP = 330;

/** The radius each yoked glyph's U yoke clears. */
const YOKE_CLEAR: Record<Exclude<Instrument, "moving">, number> = { ellipsoidal: 130, fresnel: 150, par: 120, wash: 180 };

/** How far the top of an instrument's yoke (where it clamps to a pipe) is above its lens, at scale 1, mm. */
export function hangDrop(glyph: Instrument): number {
  return glyph === "moving" ? MOVING_BASE_DROP : YOKE_CLEAR[glyph] + 60;
}

/** A U yoke about the lens axis, its trunnions on the origin's sides and its top bar `r` clear of the body. */
function uYoke(r: number): Solid[] {
  return [
    box(-30, 30, r + 20, r + 40, 0, r + 60),
    box(-30, 30, -(r + 40), -(r + 20), 0, r + 60),
    box(-30, 30, -(r + 40), r + 40, r + 40, r + 60),
  ];
}

/** `solid` turned upside down (z to -z), its faces wound the other way so they still face out. */
function overturned(solid: Solid): Solid {
  return mapSolid(solid, ([x, y, z]) => [x, y, -z]).map((face) => {
    const out: number[] = [];
    for (let i = face.length - 3; i >= 0; i -= 3) out.push(face[i], face[i + 1], face[i + 2]);
    return out;
  });
}

/**
 * An instrument's body at scale 1, mm: its head (pitched by `pitch`, nose down when positive) and its yoke, both
 * turned by `aim` about z. It hangs from its yoke, or with `standing` stands on it, the yoke under the head.
 */
export function instrumentSolids(glyph: Instrument, aim: number, pitch: number, standing = false): Solid[] {
  let head: Solid[];
  let yoke: Solid[];
  switch (glyph) {
    case "ellipsoidal":
      // a lamp housing behind a narrower barrel, its front ring
      head = [barrel(130, -300, -60), barrel(85, -60, 300), barrel(110, 300, 330)];
      yoke = uYoke(YOKE_CLEAR.ellipsoidal);
      break;
    case "fresnel":
      // a box housing, its lens frame across the front
      head = [box(-180, 140, -150, 150, -150, 150), box(140, 170, -140, 140, -140, 140)];
      yoke = uYoke(YOKE_CLEAR.fresnel);
      break;
    case "par":
      // a can, its front ring a little wider
      head = [barrel(120, -200, 180), barrel(135, 180, 210)];
      yoke = uYoke(YOKE_CLEAR.par);
      break;
    case "moving":
      // a round head between a yoke's arms, hung upside down: the arms come down from the base, which clamps on
      head = [barrel(200, -210, 230)];
      yoke = [box(-40, 40, 205, 230, 0, MOVING_BASE_DROP - 30), box(-40, 40, -230, -205, 0, MOVING_BASE_DROP - 30), box(-140, 140, -230, 230, MOVING_BASE_DROP - 30, MOVING_BASE_DROP)];
      break;
    case "wash":
      // a flat panel hung from a U yoke
      head = [box(-140, 140, -180, 180, -70, 70)];
      yoke = uYoke(YOKE_CLEAR.wash);
      break;
  }
  if (standing) yoke = yoke.map(overturned);
  const [c, s] = [Math.cos(pitch), Math.sin(pitch)];
  const tilted = mapSolid(headSolidsUnion(head), ([x, y, z]) => [x * c + z * s, y, -x * s + z * c]);
  return [placedSolid(tilted, ZERO, aim), ...yoke.map((f) => placedSolid(f, ZERO, aim))];
}

/** Every head's faces as one solid. */
function headSolidsUnion(parts: readonly Solid[]): Solid {
  return parts.flat();
}

/** An instrument's body scaled by `factor` (its Symbol Scale), its lens at the origin. */
export function scaledBody(glyph: Instrument, factor: number, aim: number, pitch: number, standing = false): Solid[] {
  return instrumentSolids(glyph, aim, pitch, standing).map((f) => mapSolid(f, ([x, y, z]) => [x * factor, y * factor, z * factor]));
}

/** Below this height (mm) an instrument stands on the floor or a stand, its yoke under it; at or above it, it hangs. */
export const STANDS_BELOW_MM = 1000;

/**
 * Where an instrument's lens is, mm, for the height of its hang point (Vectorworks' Z, a pipe's trim): under it,
 * the yoke's top there, or for a light standing below STANDS_BELOW_MM, over it, the yoke's foot there.
 */
export function lensHeight(glyph: Instrument, factor: number, height: number): { lens: number; standing: boolean } {
  const standing = height < STANDS_BELOW_MM;
  const drop = hangDrop(glyph) * factor;
  return { lens: standing ? height + drop : height - drop, standing };
}
