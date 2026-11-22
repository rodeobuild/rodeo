// Doors and windows as pure geometry: from a door's or window's parameters, the plan shapes and 3D prisms it draws, and the
// hole it needs in its wall. Plain data in and out (the plug-in objects that hold the parameters are wired in elsewhere, as
// retainingWall.ts does for retainingShapes.ts). Lengths are mm. The object's own frame: origin at the middle of the
// opening's width, on the wall's centre line, at the wall's bottom; x runs along the wall, y across it (positive y is the
// interior, the side a door swings to), z up. Plan shapes are the wall cut about 1 m up, seen from above; 3D solids are
// prisms with vertical sides. Drawn from Vectorworks' own names for the configurations; the sizes of the parts that have no
// parameter here (trim depth, sill slab, threshold height) are fixed and say so where they are used.

export type Pt = { x: number; y: number };

/** what a part is, so the planner can give it a class and a look */
export type PartRole = "frame" | "leaf" | "swing" | "glass" | "sash" | "sill" | "threshold" | "trim" | "mullion";

export interface PlanShape {
  role: PartRole;
  kind: "polygon" | "polyline" | "arc";
  points: Pt[];
  closed: boolean;
  /** arcs: centre, radius, start and sweep in degrees (counter-clockwise positive) */
  arc?: { centre: Pt; radius: number; start: number; sweep: number };
}

/** an upright or lying box, or a prism: a plan outline swept from z0 to z1 */
export interface Solid {
  role: PartRole;
  outline: Pt[];
  z0: number;
  z1: number;
}

export interface Drawn {
  plan: PlanShape[];
  solids: Solid[];
  /** the hole in the wall, in the object's frame: x0..x1 along the wall, z0..z1 above the wall's bottom */
  opening: { x0: number; x1: number; z0: number; z1: number };
}

export type DoorConfig =
  | "Swing Simple"
  | "Swing Bi-part"
  | "Swing Double Acting"
  | "Swing Dutch"
  | "Pocket Simple"
  | "Pocket Bi-part"
  | "Slider"
  | "Bi-fold Simple"
  | "Bi-fold Bi-part"
  | "Barn Bypass"
  | "Barn Simple"
  | "Overhead"
  | "Revolving"
  | "Opening"
  | "Cased Opening";

export type WindowConfig =
  | "Fixed Glass"
  | "Casement"
  | "Awning"
  | "Hopper"
  | "Double Hung"
  | "Single Hung"
  | "Sliding (H)"
  | "Pivot"
  | "Louver"
  | "Opening";

export type LeafKind = "Solid" | "Panel" | "Glass";

export interface DoorParams {
  width: number;
  height: number;
  config: DoorConfig;
  thickness: number;
  jambWidth: number;
  jambDepth: number;
  wallThickness: number;
  openAngle: number;
  leaf: LeafKind;
  threshold: boolean;
  /** height of a transom light over the door, 0 none */
  transom: number;
  /** widths, 0 none */
  sideLights: { left: number; right: number };
  /** board widths round the opening, 0 none */
  trim: { interior: number; exterior: number };
}

export interface WindowParams {
  width: number;
  height: number;
  /** sill height above the wall's bottom */
  sill: number;
  config: WindowConfig;
  jambWidth: number;
  jambDepth: number;
  sashWidth: number;
  sashDepth: number;
  wallThickness: number;
  columns: number;
  rows: number;
  /** a projecting sill, 0 none */
  sillDepth: number;
  trim: { interior: number; exterior: number };
}

export const DOOR_CONFIGS: readonly DoorConfig[] = [
  "Swing Simple",
  "Swing Bi-part",
  "Swing Double Acting",
  "Swing Dutch",
  "Pocket Simple",
  "Pocket Bi-part",
  "Slider",
  "Bi-fold Simple",
  "Bi-fold Bi-part",
  "Barn Bypass",
  "Barn Simple",
  "Overhead",
  "Revolving",
  "Opening",
  "Cased Opening",
];

export const WINDOW_CONFIGS: readonly WindowConfig[] = [
  "Fixed Glass",
  "Casement",
  "Awning",
  "Hopper",
  "Double Hung",
  "Single Hung",
  "Sliding (H)",
  "Pivot",
  "Louver",
  "Opening",
];

export const DOOR_DEFAULTS: DoorParams = {
  width: 900,
  height: 2100,
  config: "Swing Simple",
  thickness: 40,
  jambWidth: 50,
  jambDepth: 100,
  wallThickness: 200,
  openAngle: 90,
  leaf: "Solid",
  threshold: false,
  transom: 0,
  sideLights: { left: 0, right: 0 },
  trim: { interior: 0, exterior: 0 },
};

export const WINDOW_DEFAULTS: WindowParams = {
  width: 1200,
  height: 1200,
  sill: 900,
  config: "Fixed Glass",
  jambWidth: 50,
  jambDepth: 100,
  sashWidth: 50,
  sashDepth: 50,
  wallThickness: 200,
  columns: 1,
  rows: 1,
  sillDepth: 0,
  trim: { interior: 0, exterior: 0 },
};

/** Fixed sizes for parts that have no parameter: a trim board's depth out from the jamb face (d2023's IntTrimDepth default) */
const TRIM_DEPTH = 19.05;
/** a projecting window sill's slab under the sill line */
const SILL_SLAB = 40;
/** a door threshold's height */
const THRESHOLD_HEIGHT = 15;
/** the glass in a pane, and the stile and rail of a glass door leaf */
const GLASS = 6;
const STILE = 100;
/** the angle a casement's sash opens to, and the fold of a bi-fold door's panels (both in degrees from the wall) */
const CASEMENT_SWEEP = 30;
const FOLD = 30;

const TAN_FOLD = Math.tan((FOLD * Math.PI) / 180);

const rect = (x0: number, x1: number, y0: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const poly = (role: PartRole, points: Pt[]): PlanShape => ({ role, kind: "polygon", points, closed: true });

const prism = (role: PartRole, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => ({
  role,
  outline: rect(x0, x1, y0, y1),
  z0,
  z1,
});

/** the segment a to b as a rectangle t thick, centred on it (leaves, panels and folding sashes); a and b must differ */
function bar(a: Pt, b: Pt, t: number): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const nx = (-(b.y - a.y) / len) * (t / 2);
  const ny = ((b.x - a.x) / len) * (t / 2);
  return [
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny },
  ];
}

/** a leaf in its closed plane, as one prism or, for a glass leaf, a stile-and-rail frame round a 6 mm pane */
function leafSolids(x0: number, x1: number, y0: number, y1: number, H: number, kind: LeafKind): Solid[] {
  if (kind !== "Glass") return [prism("leaf", x0, x1, y0, y1, 0, H)];
  const s = Math.min(STILE, (x1 - x0) / 4, H / 4);
  const yc = (y0 + y1) / 2;
  return [
    prism("leaf", x0, x0 + s, y0, y1, 0, H),
    prism("leaf", x1 - s, x1, y0, y1, 0, H),
    prism("leaf", x0 + s, x1 - s, y0, y1, 0, s),
    prism("leaf", x0 + s, x1 - s, y0, y1, H - s, H),
    prism("glass", x0 + s, x1 - s, yc - GLASS / 2, yc + GLASS / 2, s, H - s),
  ];
}

/** the trim boards round an opening (x0..x1, z0..z1) on each face: a board either side and one over the head */
function trimBoards(
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  trim: { interior: number; exterior: number },
  jd: number,
): { plan: PlanShape[]; solids: Solid[] } {
  const plan: PlanShape[] = [];
  const solids: Solid[] = [];
  const faces: [number, [number, number]][] = [
    [trim.interior, [jd / 2, jd / 2 + TRIM_DEPTH]],
    [trim.exterior, [-jd / 2 - TRIM_DEPTH, -jd / 2]],
  ];
  for (const [tw, [y0, y1]] of faces) {
    if (!(tw > 0)) continue;
    plan.push(poly("trim", rect(x0 - tw, x0, y0, y1)));
    plan.push(poly("trim", rect(x1, x1 + tw, y0, y1)));
    solids.push(prism("trim", x0 - tw, x1 + tw, y0, y1, z1, z1 + tw));
    solids.push(prism("trim", x0 - tw, x0, y0, y1, z0, z1));
    solids.push(prism("trim", x1, x1 + tw, y0, y1, z0, z1));
  }
  return { plan, solids };
}

/** a swing leaf: plan shape open at `angle` from its hinge, and a closed prism set in the frame's +y face */
function swingLeaf(hinge: Pt, dir: 1 | -1, len: number, t: number, H: number, kind: LeafKind, angle: number, plan: PlanShape[], solids: Solid[]): void {
  const a = (angle * Math.PI) / 180;
  const end = { x: hinge.x + dir * len * Math.cos(a), y: hinge.y + len * Math.sin(a) };
  plan.push(poly("leaf", bar(hinge, end, t)));
  const xa = Math.min(hinge.x, hinge.x + dir * len);
  const xb = Math.max(hinge.x, hinge.x + dir * len);
  solids.push(...leafSolids(xa, xb, hinge.y - t / 2, hinge.y + t / 2, H, kind));
}

/** the swing arc of a leaf from its closed position to `sweep` degrees round its hinge (counter-clockwise positive) */
function swingArc(hinge: Pt, dir: 1 | -1, radius: number, sweep: number): PlanShape {
  const start = dir > 0 ? 0 : 180 - sweep;
  return { role: "swing", kind: "arc", points: [], closed: false, arc: { centre: hinge, radius, start, sweep } };
}

/** a door: frame, leaves and what the configuration adds; the opening is the frame's outside (sidelights and transom included) */
export function drawDoor(p: DoorParams): Drawn {
  const plan: PlanShape[] = [];
  const solids: Solid[] = [];
  const W = p.width;
  const H = p.height;
  const hw = W / 2;
  const jw = p.jambWidth;
  const jd = p.jambDepth;
  const t = p.thickness;
  const wt = p.wallThickness;
  const a = p.openAngle;
  /** swing leaves close in the frame's +y face: their outer face is the face of the frame */
  const hy = jd / 2 - t / 2;
  /** the face band a sliding or barn leaf runs in, just outside the +y face */
  const faceY0 = jd / 2;
  const faceY1 = jd / 2 + t;

  if (p.config === "Opening") return { plan, solids, opening: { x0: -hw, x1: hw, z0: 0, z1: H } };

  const sl = p.sideLights;
  const ox0 = -(hw + jw + sl.left);
  const ox1 = hw + jw + sl.right;
  const top = H + jw + p.transom;
  const opening = { x0: ox0, x1: ox1, z0: 0, z1: top };

  // the frame: jambs in plan, prisms up to the top; a head over the door (the transom's mullion when there is one)
  for (const x0 of [-hw - jw, hw]) {
    plan.push(poly("frame", rect(x0, x0 + jw, -jd / 2, jd / 2)));
    solids.push(prism("frame", x0, x0 + jw, -jd / 2, jd / 2, 0, top));
  }
  solids.push(prism(p.transom > 0 ? "mullion" : "frame", ox0, ox1, -jd / 2, jd / 2, H, H + jw));
  if (p.transom > 0) {
    solids.push(prism("frame", ox0, ox1, -jd / 2, jd / 2, top - jw, top));
    solids.push(prism("glass", ox0 + jw, ox1 - jw, -GLASS / 2, GLASS / 2, H + jw, top - jw));
  }
  // side lights: an outer jamb and a pane between it and the door's jamb
  if (sl.left > 0) {
    plan.push(poly("frame", rect(ox0, ox0 + jw, -jd / 2, jd / 2)));
    solids.push(prism("frame", ox0, ox0 + jw, -jd / 2, jd / 2, 0, top));
    plan.push(poly("glass", rect(ox0 + jw, -hw - jw, -GLASS / 2, GLASS / 2)));
    solids.push(prism("glass", ox0 + jw, -hw - jw, -GLASS / 2, GLASS / 2, 0, H));
  }
  if (sl.right > 0) {
    plan.push(poly("frame", rect(ox1 - jw, ox1, -jd / 2, jd / 2)));
    solids.push(prism("frame", ox1 - jw, ox1, -jd / 2, jd / 2, 0, top));
    plan.push(poly("glass", rect(hw + jw, ox1 - jw, -GLASS / 2, GLASS / 2)));
    solids.push(prism("glass", hw + jw, ox1 - jw, -GLASS / 2, GLASS / 2, 0, H));
  }

  if (p.threshold) {
    plan.push(poly("threshold", rect(-hw, hw, -wt / 2, wt / 2)));
    solids.push(prism("threshold", -hw, hw, -wt / 2, wt / 2, 0, THRESHOLD_HEIGHT));
  }

  // the leaves, by configuration; a cased opening has a frame and no leaf, a dutch door is drawn as a simple swing
  const leafKind = p.leaf;
  const cfg = p.config;
  if (cfg === "Swing Bi-part") {
    swingLeaf({ x: -hw, y: hy }, 1, hw, t, H, leafKind, a, plan, solids);
    swingLeaf({ x: hw, y: hy }, -1, hw, t, H, leafKind, a, plan, solids);
    plan.push(swingArc({ x: -hw, y: hy }, 1, hw, a), swingArc({ x: hw, y: hy }, -1, hw, a));
  } else if (cfg === "Swing Double Acting") {
    const hinge = { x: -hw, y: hy };
    plan.push(poly("leaf", bar(hinge, { x: hw, y: hy }, t)));
    solids.push(...leafSolids(-hw, hw, hy - t / 2, hy + t / 2, H, leafKind));
    // a swing to either side: the same leaf's arc on the interior side and on the exterior side
    plan.push(swingArc(hinge, 1, W, a), swingArc(hinge, 1, W, -a));
  } else if (cfg === "Pocket Simple" || cfg === "Pocket Bi-part") {
    // the leaf slides half into the wall beside the opening, inside the wall's thickness
    const pocketY0 = -wt / 2;
    const pocketY1 = wt / 2;
    const leaves: [number, number][] = cfg === "Pocket Simple" ? [[0, W]] : [[0, hw], [hw, W]];
    for (const [x0, x1] of leaves) {
      plan.push(poly("leaf", rect(x0, x1, -t / 2, t / 2)));
      solids.push(...leafSolids(x0, x1, -t / 2, t / 2, H, leafKind));
    }
    plan.push({ role: "swing", kind: "polyline", points: rect(hw, W, pocketY0, pocketY1), closed: true });
  } else if (cfg === "Slider" || cfg === "Barn Simple") {
    plan.push(poly("leaf", rect(0, W, faceY0, faceY1)));
    solids.push(...leafSolids(0, W, faceY0, faceY1, H, leafKind));
  } else if (cfg === "Barn Bypass") {
    // two leaves on two tracks, one each just outside the other
    plan.push(poly("leaf", rect(-hw, hw, faceY0, faceY1)));
    solids.push(...leafSolids(-hw, hw, faceY0, faceY1, H, leafKind));
    plan.push(poly("leaf", rect(0, W, faceY1, faceY1 + t)));
    solids.push(...leafSolids(0, W, faceY1, faceY1 + t, H, leafKind));
  } else if (cfg === "Bi-fold Simple" || cfg === "Bi-fold Bi-part") {
    // panels folded in a V at 30 degrees from the wall, the V's point at the middle of each leaf
    const halves: [number, number][] = cfg === "Bi-fold Simple" ? [[-hw, hw]] : [[-hw, 0], [0, hw]];
    for (const [xa, xb] of halves) {
      const xm = (xa + xb) / 2;
      const fold = { x: xm, y: hy + ((xb - xa) / 2) * TAN_FOLD };
      const ends = [{ x: xa, y: hy }, fold, { x: xb, y: hy }];
      for (const [p0, p1] of [[ends[0], ends[1]], [ends[1], ends[2]]] as [Pt, Pt][]) {
        plan.push(poly("leaf", bar(p0, p1, t)));
        solids.push({ role: "leaf", outline: bar(p0, p1, t), z0: 0, z1: H });
      }
    }
  } else if (cfg === "Revolving") {
    // four leaves crossing at the middle of the opening, and their sweep as a circle
    const centre = { x: 0, y: 0 };
    for (let k = 0; k < 4; k++) {
      const th = (k * Math.PI) / 2;
      const end = { x: hw * Math.cos(th), y: hw * Math.sin(th) };
      plan.push(poly("leaf", bar(centre, end, t)));
      solids.push({ role: "leaf", outline: bar(centre, end, t), z0: 0, z1: H });
    }
    plan.push({ role: "swing", kind: "arc", points: [], closed: false, arc: { centre, radius: hw, start: 0, sweep: 360 } });
  } else if (cfg === "Overhead") {
    // the door up, in the space above the opening on the interior side: no leaf in the wall
    plan.push({ role: "swing", kind: "polyline", points: rect(-hw, hw, jd / 2, jd / 2 + H), closed: true });
  } else if (cfg !== "Cased Opening") {
    // Swing Simple, Swing Dutch
    swingLeaf({ x: -hw, y: hy }, 1, W, t, H, leafKind, a, plan, solids);
    plan.push(swingArc({ x: -hw, y: hy }, 1, W, a));
  }

  const trim = trimBoards(ox0, ox1, 0, top, p.trim, jd);
  plan.push(...trim.plan);
  solids.push(...trim.solids);
  return { plan, solids, opening };
}

/** a window: frame, glass and sashes in its columns and rows, what its configuration adds; the opening is W x H from the sill */
export function drawWindow(p: WindowParams): Drawn {
  const plan: PlanShape[] = [];
  const solids: Solid[] = [];
  const W = p.width;
  const H = p.height;
  const hw = W / 2;
  const s = p.sill;
  const jw = p.jambWidth;
  const jd = p.jambDepth;
  const sw = p.sashWidth;
  const sd = p.sashDepth;
  const opening = { x0: -hw, x1: hw, z0: s, z1: s + H };
  if (p.config === "Opening") return { plan, solids, opening };

  // the frame: jambs in plan and prisms, a head and a sill inside the opening
  for (const x0 of [-hw, hw - jw]) {
    plan.push(poly("frame", rect(x0, x0 + jw, -jd / 2, jd / 2)));
    solids.push(prism("frame", x0, x0 + jw, -jd / 2, jd / 2, s, s + H));
  }
  solids.push(prism("frame", -hw, hw, -jd / 2, jd / 2, s + H - jw, s + H));
  solids.push(prism("sill", -hw, hw, -jd / 2, jd / 2, s, s + jw));

  // glass and sashes: one sash frame and one pane for each column and row
  const gx0 = -hw + jw;
  const gx1 = hw - jw;
  const gz0 = s + jw;
  const gz1 = s + H - jw;
  const cols = p.columns;
  const rows = p.rows;
  const cw = (gx1 - gx0) / cols;
  const rh = (gz1 - gz0) / rows;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x0 = gx0 + c * cw;
      const x1 = x0 + cw;
      const z0 = gz0 + r * rh;
      const z1 = z0 + rh;
      solids.push(prism("sash", x0, x0 + sw, -sd / 2, sd / 2, z0, z1));
      solids.push(prism("sash", x1 - sw, x1, -sd / 2, sd / 2, z0, z1));
      solids.push(prism("sash", x0 + sw, x1 - sw, -sd / 2, sd / 2, z0, z0 + sw));
      solids.push(prism("sash", x0 + sw, x1 - sw, -sd / 2, sd / 2, z1 - sw, z1));
      solids.push(prism("glass", x0 + sw, x1 - sw, -GLASS / 2, GLASS / 2, z0 + sw, z1 - sw));
    }
  }

  // plan: the pane as one thin rectangle, sashes either side (two offset lines for hung and sliding sashes)
  plan.push(poly("glass", rect(gx0, gx1, -GLASS / 2, GLASS / 2)));
  if (["Double Hung", "Single Hung", "Sliding (H)"].includes(p.config)) {
    for (const yc of [-sd / 4, sd / 4]) plan.push(poly("sash", rect(gx0, gx1, yc - sw / 2, yc + sw / 2)));
  } else {
    plan.push(poly("sash", rect(gx0, gx1, GLASS / 2, GLASS / 2 + sw)));
    plan.push(poly("sash", rect(gx0, gx1, -GLASS / 2 - sw, -GLASS / 2)));
  }
  for (let k = 1; k < cols; k++) {
    const x = gx0 + k * cw;
    plan.push(poly("mullion", rect(x - sw / 2, x + sw / 2, -sd / 2, sd / 2)));
  }
  if (p.config === "Casement") {
    plan.push({
      role: "swing",
      kind: "arc",
      points: [],
      closed: false,
      arc: { centre: { x: gx0, y: 0 }, radius: gx1 - gx0, start: 0, sweep: CASEMENT_SWEEP },
    });
  }

  if (p.sillDepth > 0) {
    const d = p.sillDepth;
    plan.push(poly("sill", rect(-hw, hw, -jd / 2 - d, -jd / 2)));
    solids.push(prism("sill", -hw, hw, -jd / 2 - d, -jd / 2, Math.max(0, s - SILL_SLAB), s));
  }

  const trim = trimBoards(-hw, hw, s, s + H, p.trim, jd);
  plan.push(...trim.plan);
  solids.push(...trim.solids);
  return { plan, solids, opening };
}

/** Clamps and repairs parameters (sizes within 100..10000 mm, jambs thinner than half the width, ...) and says what it changed. */
export function checkedDoor(p: DoorParams): { params: DoorParams; notes: string[] } {
  const notes: string[] = [];
  const num = (name: string, v: number, lo: number, hi: number, fallback: number): number => {
    let x = v;
    if (!Number.isFinite(x)) {
      notes.push(`${name} ${v} is not a number: ${fallback}`);
      x = fallback;
    }
    const c = Math.min(Math.max(x, lo), Math.max(lo, hi));
    if (c !== x) notes.push(`${name} ${x} set to ${c}`);
    return c;
  };
  const width = num("width", p.width, 100, 10000, DOOR_DEFAULTS.width);
  const height = num("height", p.height, 100, 10000, DOOR_DEFAULTS.height);
  const jambWidth = num("jamb width", p.jambWidth, 10, width / 2 - 1, DOOR_DEFAULTS.jambWidth);
  const jambDepth = num("jamb depth", p.jambDepth, 10, 1000, DOOR_DEFAULTS.jambDepth);
  const thickness = num("thickness", p.thickness, 5, 300, DOOR_DEFAULTS.thickness);
  const wallThickness = num("wall thickness", p.wallThickness, 10, 2000, DOOR_DEFAULTS.wallThickness);
  const openAngle = num("open angle", p.openAngle, 1, 180, DOOR_DEFAULTS.openAngle);
  const transomRaw = num("transom", p.transom, 0, 2000, 0);
  const transom = transomRaw > 0 && transomRaw < 2 * jambWidth + 10 ? 2 * jambWidth + 10 : transomRaw;
  if (transom !== transomRaw) notes.push(`transom ${transomRaw} set to ${transom}: too low for its two bars`);
  const side = (name: string, v: number): number => {
    const c = num(name, v, 0, 2000, 0);
    if (c > 0 && c < jambWidth + 10) {
      notes.push(`${name} ${c} set to ${jambWidth + 10}: too narrow for its jamb`);
      return jambWidth + 10;
    }
    return c;
  };
  const config = (DOOR_CONFIGS as readonly string[]).includes(p.config) ? p.config : DOOR_DEFAULTS.config;
  if (config !== p.config) notes.push(`config "${p.config}" is not a door configuration: ${config}`);
  const leaf = (["Solid", "Panel", "Glass"] as const).includes(p.leaf) ? p.leaf : DOOR_DEFAULTS.leaf;
  if (leaf !== p.leaf) notes.push(`leaf "${p.leaf}" not drawn: ${leaf}`);
  const params: DoorParams = {
    width,
    height,
    config,
    thickness,
    jambWidth,
    jambDepth,
    wallThickness,
    openAngle,
    leaf,
    threshold: !!p.threshold,
    transom,
    sideLights: { left: side("left side light", p.sideLights.left), right: side("right side light", p.sideLights.right) },
    trim: { interior: num("interior trim", p.trim.interior, 0, 1000, 0), exterior: num("exterior trim", p.trim.exterior, 0, 1000, 0) },
  };
  return { params, notes };
}

/** Clamps and repairs a window's parameters, as checkedDoor does for a door. */
export function checkedWindow(p: WindowParams): { params: WindowParams; notes: string[] } {
  const notes: string[] = [];
  const num = (name: string, v: number, lo: number, hi: number, fallback: number): number => {
    let x = v;
    if (!Number.isFinite(x)) {
      notes.push(`${name} ${v} is not a number: ${fallback}`);
      x = fallback;
    }
    const c = Math.min(Math.max(x, lo), Math.max(lo, hi));
    if (c !== x) notes.push(`${name} ${x} set to ${c}`);
    return c;
  };
  const width = num("width", p.width, 100, 10000, WINDOW_DEFAULTS.width);
  const height = num("height", p.height, 100, 10000, WINDOW_DEFAULTS.height);
  const jambWidth = num("jamb width", p.jambWidth, 10, width / 2 - 1, WINDOW_DEFAULTS.jambWidth);
  const columns = Math.round(num("columns", p.columns, 1, 20, WINDOW_DEFAULTS.columns));
  const rows = Math.round(num("rows", p.rows, 1, 20, WINDOW_DEFAULTS.rows));
  // a sash can't be wider than half of its pane
  const paneW = (width - 2 * jambWidth) / columns;
  const paneH = (height - 2 * jambWidth) / rows;
  const sashHi = Math.max(5, Math.min(paneW, paneH) / 2);
  const config = (WINDOW_CONFIGS as readonly string[]).includes(p.config) ? p.config : WINDOW_DEFAULTS.config;
  if (config !== p.config) notes.push(`config "${p.config}" is not a window configuration: ${config}`);
  const params: WindowParams = {
    width,
    height,
    sill: num("sill", p.sill, 0, 10000, WINDOW_DEFAULTS.sill),
    config,
    jambWidth,
    jambDepth: num("jamb depth", p.jambDepth, 10, 1000, WINDOW_DEFAULTS.jambDepth),
    sashWidth: num("sash width", p.sashWidth, 5, sashHi, WINDOW_DEFAULTS.sashWidth),
    sashDepth: num("sash depth", p.sashDepth, 5, 1000, WINDOW_DEFAULTS.sashDepth),
    wallThickness: num("wall thickness", p.wallThickness, 10, 2000, WINDOW_DEFAULTS.wallThickness),
    columns,
    rows,
    sillDepth: num("sill depth", p.sillDepth, 0, 1000, 0),
    trim: { interior: num("interior trim", p.trim.interior, 0, 1000, 0), exterior: num("exterior trim", p.trim.exterior, 0, 1000, 0) },
  };
  return { params, notes };
}
