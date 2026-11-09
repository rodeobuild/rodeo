// Checks an arc's bounds under Node. Run from web/:
//   npx tsx src/app/arcBounds.check.ts
// An arc's record keeps its whole ellipse's box, as the format has it, but the box the editor
// fits, culls, picks and selects by (shapeBBox, so the scene's geometry box) and the box export
// sizes its page by (shapeBounds) are round the part it draws: its ends and the axis ends its
// sweep passes. A full circle's box is the record's. A blank drawing with a long shallow arc along
// a building fits to what it draws, not to the arc's whole circle. Nothing is drawn.

import { arcBounds } from "../core/geometry.ts";
import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import type { BBox, NewShape, Shape } from "../core/types.ts";
import { shapeBounds } from "../export/svg.ts";
import { ellipsePoints } from "./geom.ts";

// the scene builds a Path2D per shape, which Node lacks; bounds don't need one
(globalThis as { Path2D?: unknown }).Path2D ??= class {
  ellipse(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  rect(): void {}
  addPath(): void {}
};
const { Scene } = await import("./scene.ts");
const { shapeBBox } = await import("./shapes.ts");

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const fmt = (b: BBox | null): string => (b ? `(${[b.x0, b.y0, b.x1, b.y1].map((v) => v.toFixed(3)).join(", ")})` : "null");
const sameBox = (a: BBox | null, b: BBox | null, tol: number): boolean =>
  !!a && !!b && Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol;

/** The box of the arc sampled finely along its sweep: what it draws. */
function sampled(s: Shape): BBox {
  const pts = ellipsePoints(s.center!, s.rx!, s.ry ?? s.rx!, s.startAngle ?? 0, s.sweepAngle ?? 360, 20000);
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

// ---- arcBounds against a finely sampled arc, without a drawing ---------------------------------

const arc = (startAngle: number, sweepAngle: number, rx = 10, ry = rx): Shape => ({
  kind: "arc",
  points: [],
  closed: false,
  bbox: { x0: 100 - rx, y0: 50 - ry, x1: 100 + rx, y1: 50 + ry },
  center: { x: 100, y: 50 },
  rx,
  ry,
  startAngle,
  sweepAngle,
});
const cases: [string, Shape][] = [
  ["a quarter in the first quadrant", arc(10, 70)],
  ["across 0°", arc(-30, 60)],
  ["across 0° from 330°", arc(330, 60)],
  ["clockwise across 90°", arc(120, -60)],
  ["across 90° and 180°", arc(60, 150)],
  ["most of a turn", arc(5, 350)],
  ["clockwise most of a turn", arc(-5, -350)],
  ["an ellipse across 90°", arc(45, 90, 30, 8)],
  ["an ellipse across 270°", arc(200, 120, 6, 20)],
  ["started many turns round", arc(3600 + 80, 20)],
  ["started far below zero", arc(-7200 - 100, 40)],
  ["no sweep", arc(30, 0)],
];
for (const [what, s] of cases) {
  const b = arcBounds(s);
  const want = sampled(s);
  check(sameBox(b, want, 1e-4), `${what}: ${fmt(b)} hugs the arc ${fmt(want)}`);
}
const full = arc(0, 360, 12, 7);
check(sameBox(arcBounds(full), full.bbox, 0), "a full ellipse's arcBounds is its whole box");
check(arcBounds({ kind: "line", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: false, bbox: null }) === null, "arcBounds of a line is null");

// ---- arcs in a drawing: the record's box stays whole, the drawn box hugs ------------------------

const s = openVwx(blankDrawing("mm"), "arcs.vwx");
const design = s.doc.layers().find((l) => l.kind === "design")!;
// a 0.4 km building, as a rectangle, and the long shallow arc of a stand along its top, a little
// past it: 300 m radius, 20°, so its whole circle runs 0.6 km each way
const building = s.addObject(design.id, { kind: "rect", x0: 0, y0: 0, x1: 400_000, y1: 250_000 });
const R = 300_000;
const stand: NewShape = { kind: "arc", center: { x: 200_000, y: 0 }, radius: R, startAngle: 80, sweepAngle: 20 };
const shallow = s.addObject(design.id, stand);
const circle = s.addObject(design.id, { kind: "arc", center: { x: 50_000, y: 50_000 }, radius: 20_000, startAngle: 0, sweepAngle: 360 });
const oval = s.addObject(design.id, { kind: "arc", center: { x: 300_000, y: 200_000 }, radius: 30_000, radiusY: 10_000, startAngle: 0, sweepAngle: 360 });

const shape = s.doc.object(shallow)!.shape!;
const whole: BBox = { x0: 200_000 - R, y0: -R, x1: 200_000 + R, y1: R };
check(sameBox(shape.bbox, whole, 1e-6), `the shallow arc's record keeps its whole circle's box ${fmt(shape.bbox)}`);
check(shape.rx === R && shape.ry === R, "its radii still come from the record's box");
const geomBox = shapeBBox(shape);
check(sameBox(geomBox, sampled(shape), 1e-3), `its drawn box ${fmt(geomBox)} hugs the arc`);
check(!!geomBox && geomBox.x1 - geomBox.x0 < 0.36 * R && geomBox.y1 - geomBox.y0 < 0.02 * R, "and is a small part of the circle's");
check(sameBox(shapeBounds(shape), geomBox, 1e-9), "export sizes by the same box");

for (const [what, id] of [["full circle", circle], ["full ellipse", oval]] as const) {
  const c = s.doc.object(id)!.shape!;
  check(!!c.bbox && shapeBBox(c) === c.bbox, `a ${what}'s drawn box is its record's ${fmt(c.bbox)}`);
  check(shapeBounds(c) === c.bbox, `and export's too`);
}

// ---- the scene: fit, cull, marquee and selection boxes ------------------------------------------

const scene = new Scene();
scene.setDocument(s.doc);
const fit = scene.drawnBounds(design.id);
const want: BBox = { x0: 0, y0: 0, x1: 400_000, y1: R };
check(sameBox(fit, want, 1e-3), `the drawing fits to ${fmt(fit)}, what it draws ${fmt(want)}, not the circle's ${fmt(whole)}`);
check(sameBox(scene.geometry(s.doc.object(shallow)!)?.bbox ?? null, geomBox, 0), "the scene's geometry box is the drawn box");
const entry = scene.topLevelEntries(design.id).find((e) => e.id === shallow);
check(sameBox(entry?.bbox ?? null, geomBox, 0), "so is its selection and marquee box");
const cull = scene.cullIndex(design.id);
const at = cull.objects.findIndex((o) => o.id === shallow);
const culled = at < 0 ? null : { x0: cull.boxes[4 * at], y0: cull.boxes[4 * at + 1], x1: cull.boxes[4 * at + 2], y1: cull.boxes[4 * at + 3] };
check(sameBox(culled, geomBox, 0), "and its cull box");
check(sameBox(scene.topLevelEntries(design.id).find((e) => e.id === building)?.bbox ?? null, { x0: 0, y0: 0, x1: 400_000, y1: 250_000 }, 1e-6), "the building's box is as it was");

// ---- saved and opened again, the record's box is still the whole circle -------------------------

const again = openVwx(s.doc.toBytes(), "arcs.vwx");
const back = again.doc.object(shallow)?.shape;
check(sameBox(back?.bbox ?? null, whole, 1e-6), `saved and reopened, the record's box is still the whole circle's ${fmt(back?.bbox ?? null)}`);
check(!!back && sameBox(shapeBBox(back), geomBox, 1e-6), "and its drawn box is the same");

console.log(failures ? `\n${failures} check(s) failed` : "\nall arc bounds checks passed");
process.exit(failures ? 1 : 0);
