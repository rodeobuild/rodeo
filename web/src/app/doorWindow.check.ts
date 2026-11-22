// Checks the doors and windows drawn from their parameters (doorWindowDraw.ts), with no session. Every door and window
// configuration at its defaults and with its options on: the plan shapes and faces are finite, every 3D part is a closed
// prism (each edge shared by exactly two faces), the opening is what the parameters say, a head-set window's sill is its
// Elevation less its height, the Object Info rows are all in the parameter tables, and a layer's elevation lifts the 3D.
// Run from web/:
//   npx tsx src/app/doorWindow.check.ts

import { buildFrom, DOOR, DOOR_LAYOUT_FIELDS, getterOf, LABELS, planShapesOf, prismFaces, solidParts, WINDOW, WINDOW_LAYOUT_FIELDS, type Kind } from "./doorWindowDraw.ts";
import { DOOR_FIELDS, WINDOW_FIELDS } from "./doorWindowFields.ts";
import { DOOR_CONFIGS, WINDOW_CONFIGS } from "./doorWindowShapes.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, slack = 0.01): boolean => Math.abs(a - b) <= slack;
const WALL = 200;

/** every edge of every face is shared by exactly two faces: the part is a closed solid */
function closed(faces: number[][]): boolean {
  const key = (x: number, y: number, z: number): string => `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
  const count = new Map<string, number>();
  for (const f of faces) {
    const n = f.length / 3;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = key(f[3 * i], f[3 * i + 1], f[3 * i + 2]);
      const b = key(f[3 * j], f[3 * j + 1], f[3 * j + 2]);
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      count.set(e, (count.get(e) ?? 0) + 1);
    }
  }
  return [...count.values()].every((c) => c === 2);
}

const finite = (xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x));

/** the whole of one door or window's drawing: its shapes, parts and faces are checked; returns the counts for the report */
function drawingOk(kind: Kind, values: Record<string, unknown>, label: string): { plan: number; parts: number } | null {
  const built = buildFrom(kind, getterOf(kind, values), WALL);
  const d = built.drawn;
  let ok = finite([d.opening.x0, d.opening.x1, d.opening.z0, d.opening.z1]);
  for (const p of d.plan) {
    ok = ok && finite(p.points.flatMap((q) => [q.x, q.y]));
    if (p.arc) ok = ok && finite([p.arc.centre.x, p.arc.centre.y, p.arc.radius, p.arc.start, p.arc.sweep]) && p.arc.radius > 0;
    if (p.kind === "polygon" && p.closed) ok = ok && p.points.length >= 3;
  }
  for (const s of d.solids) ok = ok && finite([...s.outline.flatMap((q) => [q.x, q.y]), s.z0, s.z1]);
  const parts = solidParts(d, 0);
  for (const part of parts) ok = ok && closed(part.faces) && finite(part.faces.flat());
  // the shapes as the session takes them: every one has its kind and points
  const shapes = planShapesOf(d);
  ok = ok && shapes.length === d.plan.length && shapes.every((p) => p.shape.kind !== "text");
  check(ok, `${label}: finite, ${shapes.length} plan shapes, ${parts.length} closed parts`);
  return ok ? { plan: shapes.length, parts: parts.length } : null;
}

// every door configuration at its defaults, and with every option on
const doorTotals = { plan: 0, parts: 0 };
for (const c of DOOR_CONFIGS) {
  const r = drawingOk(DOOR, { Config: c }, `door ${c}`);
  if (r) {
    doorTotals.plan += r.plan;
    doorTotals.parts += r.parts;
  }
}
const doorOptions = { Transom: true, TopPanelHeight: 300, SideLights: true, LeftLiteWidth: 300, RightLiteWidth: 300, IntTrim: true, IntTrimWidth: 60, ExtTrim: true, ExtTrimWidth: 60, Threshold: true };
for (const c of DOOR_CONFIGS) drawingOk(DOOR, { Config: c, ...doorOptions, LeafType: "Glass" }, `door ${c} with transom, sidelights, trim, threshold, glass leaves`);

// every window configuration at its defaults, and with columns, rows, a sill and trim
const windowTotals = { plan: 0, parts: 0 };
for (const c of WINDOW_CONFIGS) {
  const r = drawingOk(WINDOW, { SashOperation: c }, `window ${c}`);
  if (r) {
    windowTotals.plan += r.plan;
    windowTotals.parts += r.parts;
  }
}
for (const c of WINDOW_CONFIGS) drawingOk(WINDOW, { SashOperation: c, Cols: 2, Rows: 2, IncludeSill: true, SillDepth: 50, IntTrim: true, IntTrimWidth: 40, ExtTrim: true, ExtTrimWidth: 40 }, `window ${c} in two columns and rows, with a sill and trim`);

// the openings the parameters say
const d0 = buildFrom(DOOR, getterOf(DOOR, {}), WALL).drawn.opening;
check(d0.x0 === -500 && d0.x1 === 500 && d0.z0 === 0 && d0.z1 === 2150, `default door opening -500..500 x 0..2150 (frame outside, head jamb above 2100): ${d0.x0}..${d0.x1} x ${d0.z0}..${d0.z1}`);
const d1 = buildFrom(DOOR, getterOf(DOOR, { DoorWidth: 1000, DoorHeight: 2200 }), WALL).drawn.opening;
check(near(d1.x1 - d1.x0, 1100) && near(d1.z1, 2250), `door 1000 x 2200 opens 1100 wide and 2250 high: ${d1.x1 - d1.x0} x ${d1.z1}`);
const w0 = buildFrom(WINDOW, getterOf(WINDOW, {}), WALL).drawn.opening;
check(w0.x0 === -600 && w0.x1 === 600 && w0.z0 === 900 && w0.z1 === 2100, `default window 1200 x 1200 with its sill at 900: ${w0.x0}..${w0.x1} x ${w0.z0}..${w0.z1}`);
const wHead = buildFrom(WINDOW, getterOf(WINDOW, { Width: 1000, Height: 1000, Elevation: 2000, ElevationSetAt: "Head of Window" }), WALL).drawn.opening;
check(near(wHead.z0, 1000) && near(wHead.z1, 2000), `window with its head at 2000 and height 1000 has its sill at 1000: ${wHead.z0} to ${wHead.z1}`);
const wSill = buildFrom(WINDOW, getterOf(WINDOW, { Width: 1000, Height: 1000, Elevation: 900, ElevationSetAt: "Sill of Window" }), WALL).drawn.opening;
check(near(wSill.z0, 900), `window with its sill set at 900 has its sill at 900: ${wSill.z0}`);

// the wall thickness a door in no wall is given (its jamb depth) is what the repair leaves alone
const built = buildFrom(DOOR, getterOf(DOOR, { JambDepth: 150 }), 150);
check(near((built.params as { jambDepth: number }).jambDepth, 150), "a door's jamb depth comes through unchanged");

// a layer's elevation lifts the 3D: faces are given above the layer, so z moves by -elevation
const dd = buildFrom(DOOR, getterOf(DOOR, {}), WALL).drawn;
const flat = solidParts(dd, 0);
const lifted = solidParts(dd, -300);
const minZ = (faces: number[][]): number => Math.min(...faces.flatMap((f) => f.filter((_, i) => i % 3 === 2)));
check(flat.length > 0 && near(minZ(lifted[0].faces), minZ(flat[0].faces) - 300), `the layer's elevation lifts faces: ${minZ(flat[0].faces)} becomes ${minZ(lifted[0].faces)}`);

// a prism's faces: 2 + one per side, with the outline's corners
const box = prismFaces({ role: "frame", outline: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }], z0: 0, z1: 20 });
check(box.length === 6 && closed(box), "a box is six faces, closed");

// the Object Info rows are all in the parameter tables, and each has a friendly name
const names = (t: readonly { name: string }[]): Set<string> => new Set(t.map((f) => f.name));
const doorNames = names(DOOR_FIELDS);
const windowNames = names(WINDOW_FIELDS);
const missingDoor = DOOR_LAYOUT_FIELDS.filter((f) => !doorNames.has(f));
const missingWindow = WINDOW_LAYOUT_FIELDS.filter((f) => !windowNames.has(f));
check(missingDoor.length === 0, `every door row is in the door table${missingDoor.length ? `: missing ${missingDoor.join(", ")}` : ""}`);
check(missingWindow.length === 0, `every window row is in the window table${missingWindow.length ? `: missing ${missingWindow.join(", ")}` : ""}`);
check([...DOOR_LAYOUT_FIELDS, ...WINDOW_LAYOUT_FIELDS].every((f) => LABELS[f] !== undefined), "every row has a friendly name");

console.log(`\ndoors: ${DOOR_CONFIGS.length} configurations, ${doorTotals.plan} plan shapes and ${doorTotals.parts} closed parts at defaults`);
console.log(`windows: ${WINDOW_CONFIGS.length} configurations, ${windowTotals.plan} plan shapes and ${windowTotals.parts} closed parts at defaults`);
console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
