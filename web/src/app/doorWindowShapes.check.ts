// Checks the door and window shapes and their parameter tables. Run from web/:
//   npx tsx src/app/doorWindowShapes.check.ts
// Every door and window configuration drawn at its defaults: its shapes, finite numbers, polygons with area, prisms with
// height, the opening it needs, the parts inside it; a 900 swing door's arc; bi-part leaves; a 1200 window with two columns;
// transom and side lights growing the opening; checkedDoor and checkedWindow repairing nonsense; then the two tables.

import { DOOR_CONFIGS, DOOR_DEFAULTS, WINDOW_CONFIGS, WINDOW_DEFAULTS, checkedDoor, checkedWindow, drawDoor, drawWindow, type Drawn, type DoorParams, type Pt, type WindowParams } from "./doorWindowShapes.ts";
import { DOOR_FIELDS, WINDOW_FIELDS, doorParams, windowParams } from "./doorWindowFields.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, slack = 0.01): boolean => Math.abs(a - b) <= slack;
const area = (pts: Pt[]): number => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return Math.abs(s) / 2;
};
const allNumbers = (d: Drawn): boolean => {
  const nums: number[] = [d.opening.x0, d.opening.x1, d.opening.z0, d.opening.z1];
  for (const s of d.plan) {
    for (const p of s.points) nums.push(p.x, p.y);
    if (s.arc) nums.push(s.arc.centre.x, s.arc.centre.y, s.arc.radius, s.arc.start, s.arc.sweep);
  }
  for (const s of d.solids) {
    for (const p of s.outline) nums.push(p.x, p.y);
    nums.push(s.z0, s.z1);
  }
  return nums.every(Number.isFinite);
};
const shapesOk = (d: Drawn): string | null => {
  for (const s of d.plan) {
    if (s.kind === "polygon" && (s.points.length < 3 || area(s.points) === 0)) return `${s.role} polygon with no area`;
    if (s.kind === "arc" && !(s.arc && s.arc.radius > 0)) return `${s.role} arc with no radius`;
  }
  for (const s of d.solids) {
    if (s.outline.length < 3 || area(s.outline) === 0) return `${s.role} solid with no area`;
    if (!(s.z1 > s.z0)) return `${s.role} solid with z1 <= z0`;
    if (s.z0 < 0) return `${s.role} solid below z = 0`;
  }
  return null;
};
/** the opening's x range, and that solids stay in it (trim, pocket and barn leaves are allowed out) */
const insideOpening = (d: Drawn, allowOut: boolean): boolean =>
  allowOut || d.solids.every((s) => s.role === "trim" || (s.outline.every((p) => p.x >= d.opening.x0 - 1e-6 && p.x <= d.opening.x1 + 1e-6)));

// every configuration at its defaults
for (const config of DOOR_CONFIGS) {
  const d = drawDoor({ ...DOOR_DEFAULTS, config });
  const bad = shapesOk(d);
  check(allNumbers(d) && bad === null, `door ${config}: shapes finite, polygons with area, prisms with height${bad ? ` (${bad})` : ""}`);
  const outOk = insideOpening(d, config.startsWith("Pocket") || config.startsWith("Barn") || config === "Slider");
  check(outOk, `door ${config}: parts inside the opening in x (pocket, barn and slider leaves allowed out)`);
}
for (const config of WINDOW_CONFIGS) {
  const d = drawWindow({ ...WINDOW_DEFAULTS, config });
  const bad = shapesOk(d);
  check(allNumbers(d) && bad === null, `window ${config}: shapes finite, polygons with area, prisms with height${bad ? ` (${bad})` : ""}`);
  check(insideOpening(d, false), `window ${config}: parts inside the opening in x`);
}

// the opening each configuration needs
const dw = DOOR_DEFAULTS.width;
const dh = DOOR_DEFAULTS.height;
const dj = DOOR_DEFAULTS.jambWidth;
const opened = (c: DoorParams["config"]) => drawDoor({ ...DOOR_DEFAULTS, config: c }).opening;
check(near(opened("Opening").x1 - opened("Opening").x0, dw) && near(opened("Opening").z1, dh), "door Opening: the opening is width x height, no frame");
check(near(opened("Cased Opening").x1 - opened("Cased Opening").x0, dw + 2 * dj) && near(opened("Cased Opening").z1, dh + dj), "door Cased Opening: width + 2 jambs by height + a head");
check(near(opened("Swing Simple").x1 - opened("Swing Simple").x0, dw + 2 * dj) && near(opened("Swing Simple").z1, dh + dj), "door Swing Simple: opening is width + 2 jambs by height + a head, from z = 0");
check(opened("Swing Simple").z0 === 0, "door opening starts at the wall's bottom");
check(drawDoor({ ...DOOR_DEFAULTS, config: "Opening" }).plan.length === 0 && drawDoor({ ...DOOR_DEFAULTS, config: "Opening" }).solids.length === 0, "door Opening draws nothing but the opening");

// the swing arc of a 900 door
const swing = drawDoor({ ...DOOR_DEFAULTS });
const arc = swing.plan.find((s) => s.kind === "arc" && s.role === "swing")?.arc;
check(!!arc && near(arc.radius, 900) && near(arc.sweep, 90) && near(arc.start, 0), `900 swing door's arc: radius ${arc?.radius}, sweep ${arc?.sweep}`);
const leafPlan = swing.plan.find((s) => s.role === "leaf")?.points ?? [];
check(leafPlan.length === 4 && near(Math.hypot(leafPlan[0].x - leafPlan[1].x, leafPlan[0].y - leafPlan[1].y), 900), "the swing leaf is 900 long");

// bi-part: two leaves each half width, hinged at each jamb
const bp = drawDoor({ ...DOOR_DEFAULTS, config: "Swing Bi-part" });
const bpLeaves = bp.plan.filter((s) => s.role === "leaf");
const lengths = bpLeaves.map((s) => Math.hypot(s.points[0].x - s.points[1].x, s.points[0].y - s.points[1].y));
check(bpLeaves.length === 2 && lengths.every((l) => near(l, 450)), `bi-part: two leaves each 450 long (${lengths.map((l) => l.toFixed(1)).join(", ")})`);
const bpArcs = bp.plan.filter((s) => s.role === "swing" && s.kind === "arc");
check(bpArcs.length === 2 && bpArcs.every((s) => s.arc && near(s.arc.radius, 450) && near(s.arc.sweep, 90)), "bi-part: two swing arcs of radius 450, each 90 degrees");

// double acting swings both ways
const da = drawDoor({ ...DOOR_DEFAULTS, config: "Swing Double Acting" });
const daSweeps = da.plan.filter((s) => s.role === "swing" && s.kind === "arc").map((s) => s.arc?.sweep ?? 0);
check(daSweeps.length === 2 && daSweeps.includes(90) && daSweeps.includes(-90), "double acting: arcs both sides");

// leaves by type
const glassLeaf = drawDoor({ ...DOOR_DEFAULTS, leaf: "Glass" });
const glassSolids = glassLeaf.solids.filter((s) => s.role === "leaf" || s.role === "glass");
check(glassSolids.length === 5 && glassSolids.filter((s) => s.role === "glass").length === 1, "a glass leaf: a stile-and-rail frame of four prisms and one 6 mm pane");
check(drawDoor({ ...DOOR_DEFAULTS, leaf: "Panel" }).solids.filter((s) => s.role === "leaf").length === 1, "a panel leaf is one prism");

// transom and side lights grow the opening
const tr = drawDoor({ ...DOOR_DEFAULTS, transom: 300 });
check(near(tr.opening.z1, dh + dj + 300), `transom of 300 raises the opening to ${tr.opening.z1}`);
const sls = drawDoor({ ...DOOR_DEFAULTS, sideLights: { left: 300, right: 300 } });
check(near(sls.opening.x1 - sls.opening.x0, dw + 2 * dj + 600), `side lights of 300 widen the opening to ${sls.opening.x1 - sls.opening.x0}`);
check(sls.solids.some((s) => s.role === "glass") && sls.solids.every((s) => s.z0 >= 0), "side lights have glass and nothing below z = 0");

// windows: a 1200 window with two columns has two panes, narrower than the window together
const wd = drawWindow({ ...WINDOW_DEFAULTS, columns: 2, rows: 1 });
const panes = wd.solids.filter((s) => s.role === "glass");
const paneWidths = panes.map((s) => Math.max(...s.outline.map((p) => p.x)) - Math.min(...s.outline.map((p) => p.x)));
check(panes.length === 2 && paneWidths.reduce((a, b) => a + b, 0) < 1200, `1200 window, 2 columns: ${panes.length} panes, widths ${paneWidths.map((w) => w.toFixed(1)).join(" + ")}`);
check(near(wd.opening.x1 - wd.opening.x0, 1200) && near(wd.opening.z0, 900) && near(wd.opening.z1, 2100), "window opening is the unit size, from the sill");
const cas = drawWindow({ ...WINDOW_DEFAULTS, config: "Casement" });
const casArc = cas.plan.find((s) => s.role === "swing")?.arc;
check(!!casArc && near(casArc.sweep, 30), "casement: a swing arc to 30 degrees");
const sill = drawWindow({ ...WINDOW_DEFAULTS, sillDepth: 150 });
check(sill.plan.some((s) => s.role === "sill") && sill.solids.some((s) => s.role === "sill" && s.outline.some((p) => p.y < -50)), "a projecting sill on the exterior face");

// the repairs
const bad = checkedDoor({ ...DOOR_DEFAULTS, width: -5, jambWidth: 600 });
check(bad.params.width === 100 && bad.params.jambWidth < bad.params.width / 2 && bad.notes.length >= 2, `checkedDoor: width -5 becomes 100, jamb ${bad.params.jambWidth} (${bad.notes.length} notes)`);
const nan = checkedDoor({ ...DOOR_DEFAULTS, height: NaN, config: "Nonsense" as DoorParams["config"] });
check(nan.params.height === 2100 && nan.params.config === "Swing Simple" && nan.notes.length === 2, "checkedDoor: NaN height is 2100, unknown config is Swing Simple");
const badWin = checkedWindow({ ...WINDOW_DEFAULTS, width: NaN, columns: 0, sashWidth: 10000, config: "Nonsense" as WindowParams["config"] });
check(badWin.params.width === 1200 && badWin.params.columns === 1 && badWin.params.config === "Fixed Glass" && badWin.params.sashWidth < 1200, "checkedWindow: NaN width is 1200, columns 0 becomes 1, unknown config is Fixed Glass");
check(checkedDoor(DOOR_DEFAULTS).notes.length === 0 && checkedWindow(WINDOW_DEFAULTS).notes.length === 0, "defaults need no repair");
const clean = checkedDoor({ ...DOOR_DEFAULTS, width: 900, sideLights: { left: 5, right: 0 } });
check(clean.params.sideLights.left >= clean.params.jambWidth + 10, "checkedDoor: a side light too narrow for its jamb is widened");

// the tables: names unique, key fields there, text defaults blank
for (const [label, table] of [["door", DOOR_FIELDS], ["window", WINDOW_FIELDS]] as const) {
  const names = table.map((f) => f.name);
  check(new Set(names).size === names.length, `${label} table: ${names.length} fields, no duplicate names`);
  check(table.filter((f) => f.type === 4).every((f) => f.value === ""), `${label} table: every text field defaults to ""`);
  check(table.every((f) => typeof f.name === "string" && f.name !== "" && Number.isInteger(f.type)), `${label} table: names and types present`);
}
const doorKeys = ["DoorWidth", "DoorHeight", "Config", "DoorThickness", "JambWidth", "JambDepth", "OpenAngle", "LeafType", "Threshold", "Transom", "SideLights", "LeftLiteWidth", "RightLiteWidth", "IntTrim", "IntTrimWidth", "ExtTrim", "ExtTrimWidth"];
const winKeys = ["Width", "Height", "Elevation", "ElevationSetAt", "SashOperation", "CustSashOpPopup", "JambWidth", "JambDepth", "SashWidth", "SashDepth", "Cols", "Rows", "IncludeSill", "SillDepth", "IntTrim", "IntTrimWidth", "ExtTrim", "ExtTrimWidth"];
const dNames = new Set(DOOR_FIELDS.map((f) => f.name));
const wNames = new Set(WINDOW_FIELDS.map((f) => f.name));
check(doorKeys.every((k) => dNames.has(k)), "door table has the fields the map reads");
check(winKeys.every((k) => wNames.has(k)), "window table has the fields the map reads");

// the maps read the table's own defaults back
const tableGet = (table: typeof DOOR_FIELDS) => (name: string) => table.find((f) => f.name === name)?.value;
const dp = doorParams(tableGet(DOOR_FIELDS), 200);
check(dp.width === 900 && dp.height === 2100 && dp.config === "Swing Simple" && dp.thickness === 40 && dp.jambWidth === 50 && dp.jambDepth === 100, "doorParams from the door table: 900 x 2100, Swing Simple, 40 thick, jambs 50 x 100");
const wp = windowParams(tableGet(WINDOW_FIELDS), 200);
check(wp.width === 1200 && wp.height === 1200 && wp.config === "Fixed Glass" && wp.jambWidth === 50 && wp.jambDepth === 100, "windowParams from the window table: 1200 x 1200, Fixed Glass, jambs 50 x 100");
check(wp.sill === 900, `window sill from Elevation (head-set in the table): ${wp.sill}`);
const unknown = doorParams(() => "Nonsense", 200);
check(unknown.config === "Swing Simple" && unknown.leaf === "Solid", "unknown popups fall back to Swing Simple and Solid");
const custom = windowParams((n) => (n === "SashOperation" ? "Custom" : n === "CustSashOpPopup" ? "Casement" : n === "ElevationSetAt" ? "Head of Window" : n === "Elevation" ? 2100 : n === "Height" ? 1200 : undefined), 200);
check(custom.config === "Casement" && custom.sill === 900, "a custom sash takes its operation from CustSashOpPopup; a head-set elevation gives the sill");

console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
