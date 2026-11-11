// Checks the outline of an oval profile (type 4) under Node: ovalRing in model3d.ts, which an
// extrude's profile of a round section (a 15 mm lacing tube, say) is made of. Run from web/:
//   npx tsx src/core/oval.check.ts
// Synthetic records only: an unturned 15 mm oval sits on its frame's ellipse, a 30 × 10 mm oval
// unturned and turned a quarter has the frame's extent either way round, and a frame that
// doesn't read gives no outline.

import type { Rec } from "./records.ts";
import { ovalRing } from "./model3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** An oval record (type 4, its frame in the 2018+ layout) at origin (x0, y0), w across, h up, turned by `quarter` quarter turns. */
function oval(x0: number, y0: number, w: number, h: number, quarter = 0): Rec {
  const d = new Uint8Array(0xc0);
  const dv = new DataView(d.buffer);
  const sin = quarter === 1 ? 1 : 0;
  const cos = quarter === 0 ? 1 : 0;
  // the stored bounds: top, left, bottom, right
  const [top, left, bottom, right] = [y0 + (quarter === 0 ? h : w), x0, y0, x0 + (quarter === 0 ? w : h)];
  dv.setFloat64(0x68, top, true);
  dv.setFloat64(0x70, left, true);
  dv.setFloat64(0x78, bottom, true);
  dv.setFloat64(0x80, right, true);
  // the frame: origin (y, x), x axis (sin, cos), width, height
  dv.setFloat64(0x8c, y0, true);
  dv.setFloat64(0x94, x0, true);
  dv.setFloat64(0x9c, sin, true);
  dv.setFloat64(0xa4, cos, true);
  dv.setFloat64(0xac, quarter === 0 ? w : h, true);
  dv.setFloat64(0xb4, quarter === 0 ? h : w, true);
  return { type: 4, data: d, children: [], parent: undefined } as unknown as Rec;
}

function extent(xy: number[]): { x: number; y: number; cx: number; cy: number } {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < xy.length; i += 2) {
    x0 = Math.min(x0, xy[i]); x1 = Math.max(x1, xy[i]);
    y0 = Math.min(y0, xy[i + 1]); y1 = Math.max(y1, xy[i + 1]);
  }
  return { x: x1 - x0, y: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

{
  const xy = ovalRing(oval(100, 200, 15, 15), 48)!;
  check(xy !== null && xy.length === 96, "a 15 mm oval gives 48 points");
  const e = extent(xy);
  check(Math.abs(e.x - 15) < 0.5 && Math.abs(e.y - 15) < 0.5, "its outline is 15 mm across and up");
  check(Math.abs(e.cx - 107.5) < 1e-6 && Math.abs(e.cy - 207.5) < 1e-6, "centred in its frame");
  const onRadius = Array.from({ length: xy.length / 2 }, (_, k) => Math.hypot(xy[2 * k] - 107.5, xy[2 * k + 1] - 207.5)).every((r) => Math.abs(r - 7.5) < 1e-6);
  check(onRadius, "every point lies on the 7.5 mm radius");
}

{
  const xy = ovalRing(oval(0, 0, 30, 10), 64)!;
  const e = extent(xy);
  check(Math.abs(e.x - 30) < 0.5 && Math.abs(e.y - 10) < 0.5, "a 30 × 10 mm oval is 30 across and 10 up");
}

{
  // turned a quarter: its frame's width runs up, its height across to the left of the origin
  const xy = ovalRing(oval(50, 0, 30, 10, 1), 64)!;
  const e = extent(xy);
  check(xy !== null && Math.abs(e.x - 10) < 0.5 && Math.abs(e.y - 30) < 0.5, "a quarter-turned oval has its frame's extent turned");
}

{
  // no bounds (NaN top): the frame has nothing to read
  const bad = oval(0, 0, 10, 10);
  new DataView((bad.data as Uint8Array).buffer).setFloat64(0x68, NaN, true);
  check(ovalRing(bad, 48) === null, "an oval whose frame doesn't read gives no outline");
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
