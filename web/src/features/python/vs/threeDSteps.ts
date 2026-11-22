// The steps of the 3D calls (threeD.ts) and the host answers a running script asks for a drawing's
// 3D objects. A step is applied with the run's edit session (steps.ts's StepContext); the answers
// read the drawing as it is before the run's steps (the run applies its steps at its end).

import type { EditSession, Vec3 } from "../../../core/types.ts";
import { registerHost, registerSnapshot, registerStep, type StepContext } from "../steps.ts";

// The session of the run that asks: a snapshot part is given it as the run starts (runner.ts).
let session: EditSession | null = null;
registerSnapshot((s) => {
  session = s;
  return {};
});

function drawing(): EditSession {
  if (!session) throw new Error("no drawing is open for the script");
  return session;
}

const num = (v: unknown): number => Number(v);
const vec = (v: unknown): Vec3 => {
  const a = v as unknown[];
  return [num(a[0]), num(a[1]), num(a[2])];
};

/** The extrudes of profiles (mm) standing `base` mm above their layer and `height` tall, as the editor makes them. */
function stand(ctx: StepContext, made: string[], base: number): void {
  if (base !== 0 && made.length > 0) ctx.s.moveObjects3D(made, 0, 0, base);
}

/** The duplicate of each id, so the script's own shape is kept where the editor would consume it. */
function copies(ctx: StepContext, ids: string[]): string[] {
  const out = ctx.s.duplicateObjects(ids, 0, 0);
  if (out.length !== ids.length) throw new Error("the copies of the shapes don't match what was asked");
  return out;
}

/** Makes the step's 2D profiles into extrudes (one per profile, as the editor takes them), then stands them at base. */
registerStep("xtrd", (a, ctx) => {
  const outs = ctx.ids(a[0]);
  const profiles = ctx.ids(a[1]).map((id) => ctx.real(id));
  const made = ctx.s.extrudeObjects(profiles, num(a[3]));
  if (made.length !== outs.length) throw new Error(`the extrude made ${made.length} of ${outs.length} shapes`);
  stand(ctx, made, num(a[2]));
  outs.forEach((tmp, i) => ctx.made.set(tmp, made[i] as string));
});

registerStep("mxtrd", (a, ctx) => {
  const profiles = ctx.ids(a[1]).map((id) => ctx.real(id));
  const out = ctx.s.multiExtrudeObjects(profiles, num(a[3]));
  stand(ctx, [out], num(a[2]));
  ctx.made.set(String(a[0]), out);
});

registerStep("move3d", (a, ctx) => {
  ctx.s.moveObjects3D(ctx.ids(a[0]).map((id) => ctx.real(id)), num(a[1]), num(a[2]), num(a[3]));
});

registerStep("rot3d", (a, ctx) => {
  ctx.s.rotateObjects3D(ctx.ids(a[0]).map((id) => ctx.real(id)), vec(a[1]), num(a[2]), vec(a[3]));
});

registerStep("solid", (a, ctx) => {
  const list = ctx.ids(a[1]).map((id) => ctx.real(id));
  const mode = String(a[2]);
  const out = mode === "int" ? ctx.s.intersectSolids(list) : ctx.s.combineSolids(list, mode === "sub");
  ctx.made.set(String(a[0]), out);
});

registerStep("taper", (a, ctx) => {
  const [copy] = copies(ctx, [ctx.real(a[1])]);
  const [out] = ctx.s.taperedExtrudeObjects([copy as string], num(a[3]), num(a[2]));
  if (!out) throw new Error("the tapered extrude made nothing");
  ctx.made.set(String(a[0]), out);
});

registerStep("alongpath", (a, ctx) => {
  const [profile, path] = copies(ctx, [ctx.real(a[1]), ctx.real(a[2])]);
  const out = ctx.s.extrudeAlongPath(profile as string, path as string, 1, false);
  ctx.made.set(String(a[0]), out);
});

registerStep("xcopy", (a, ctx) => {
  const [copy] = copies(ctx, [ctx.real(a[1])]);
  const made = ctx.s.extrudeObjects([copy as string], num(a[3]));
  if (made.length !== 1) throw new Error("the shape can't be extruded");
  stand(ctx, made, num(a[2]));
  ctx.made.set(String(a[0]), made[0] as string);
});

registerStep("loc3", (a, ctx) => {
  const cls = a[2] === null || a[2] === undefined ? undefined : ctx.classIndex(String(a[2]));
  const [id] = ctx.s.add3DLoci(String(a[1]), [[num(a[3]), num(a[4]), num(a[5])]], cls, false);
  if (!id) throw new Error("the 3D locus wasn't made");
  ctx.made.set(String(a[0]), id);
});

registerStep("tomesh", (a, ctx) => {
  const ids = ctx.s.convertToMeshes([ctx.real(a[1])]);
  if (ids.length === 0) throw new Error("the faces made no mesh");
  ctx.made.set(String(a[0]), ids.length === 1 ? (ids[0] as string) : ctx.s.groupObjects(ids));
});

/** Shapes with a plan outline become one 3D polygon (the outline's points); other objects go through Convert to 3D Polygons. */
const OUTLINE_TYPES: ReadonlySet<number> = new Set([2, 3, 4, 5, 6, 13, 21]);

registerStep("to3d", (a, ctx) => {
  const id = ctx.real(a[1]);
  const info = ctx.s.doc.object(id);
  if (info && OUTLINE_TYPES.has(info.type)) {
    const cp = ctx.s.curvePoints(id);
    if (cp) {
      const poly = ctx.s.add3DPolygons(info.layerId, [{ points: cp.points.flatMap((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]), closed: cp.closed }], info.classIndex);
      ctx.s.deleteObjects([id]);
      ctx.made.set(String(a[0]), poly);
      return;
    }
  }
  const ids = ctx.s.convertTo3DPolygons([id]);
  if (ids.length === 0) throw new Error("nothing to convert to 3D polygons");
  ctx.made.set(String(a[0]), ids.length === 1 ? (ids[0] as string) : ctx.s.groupObjects(ids));
});

/** The box of a list of points, as x0 y0 z0 x1 y1 z1. */
function boxOf(pts: readonly (readonly number[])[]): number[] {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) {
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] as number, p[k] ?? 0);
      hi[k] = Math.max(hi[k] as number, p[k] ?? 0);
    }
  }
  return [...lo, ...hi];
}

/** A host answer for a running script: the drawing's 3D box of an object, mm (its faces, else its outline). */
registerHost("Bounds3D", async (args) => {
  const s = drawing();
  const id = args[0] ?? "";
  const tri = s.faceTriangles(id);
  const pts: number[][] = [];
  for (let i = 0; i + 2 < tri.length; i += 3) pts.push([tri[i] as number, tri[i + 1] as number, tri[i + 2] as number]);
  if (pts.length === 0) {
    const cp = s.curvePoints(id);
    if (cp) for (const p of cp.points) pts.push([p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
  }
  return pts.length === 0 ? null : boxOf(pts);
});

/** A host answer: the vertices of a 3D polygon or mesh (or a curve), x y z in mm. */
registerHost("Points3D", async (args) => {
  const cp = drawing().curvePoints(args[0] ?? "");
  return cp ? cp.points.map((p) => [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]) : null;
});

/** A host answer: a solid's [volume mm3, surface area mm2] from its faces (null for what isn't a solid). */
registerHost("Solid3D", async (args) => {
  let tri: Float64Array;
  try {
    tri = drawing().solidTriangles(args[0] ?? "");
  } catch {
    return null;
  }
  let volume = 0;
  let area = 0;
  for (let i = 0; i + 8 < tri.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => tri[i + k] as number);
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return [Math.abs(volume), area];
});
