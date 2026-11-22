// Checks cutting and closing an opening through a wall's plan parts, on walls built by hand. Run from web/:
//   npx tsx src/core/wallCutPlan.check.ts
// A plain 5 m wall 200 mm thick with an opening 2000..2900: cut, then closed again to the start; a
// three-component wall with its boundaries doubled in two groups; two openings, one closed and the
// other untouched; a finish that wraps 19 mm into the opening; a mitred end; and the changes that
// must not happen (a line on the opening's edge, a half piece with no partner, a wall with no opening).
// Every change list is applied to the parts in turn by applyPlanChanges, so a list that names a
// missing part fails here.

import { closePlanOpening, cutPlanOpening, type PlanChange, type PlanPart } from "./wallCutPlan.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type Pt = { x: number; y: number };
const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const seg = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];
const poly = (id: string, group: string, points: Pt[]): PlanPart => ({ id, kind: "polygon", group, points });
const line = (id: string, group: string, points: Pt[]): PlanPart => ({ id, kind: "line", group, points });

let added = 0;
/** Applies a change list to parts, in order; ids for added parts are made up and never reused (new-1, new-2, …). */
function applyPlanChanges(parts: readonly PlanPart[], changes: readonly PlanChange[]): PlanPart[] {
  let out = parts.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q })) }));
  for (const c of changes) {
    if (c.op === "remove") {
      if (!out.some((p) => p.id === c.id)) throw new Error(`remove: no part ${c.id}`);
      out = out.filter((p) => p.id !== c.id);
    } else if (c.op === "set") {
      const p = out.find((q) => q.id === c.id);
      if (!p) throw new Error(`set: no part ${c.id}`);
      p.points = c.points.map((q) => ({ ...q }));
    } else {
      const like = out.find((q) => q.id === c.like);
      if (!like) throw new Error(`add: no part ${c.like}`);
      out.push({ id: `new-${++added}`, kind: c.kind, group: like.group, points: c.points.map((q) => ({ ...q })) });
    }
  }
  return out;
}

const near = (a: Pt, b: Pt, tol = 0.02) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
/** Whether two points lists are the same set of points (within 0.02 mm), or of ends for a line. */
function samePoints(a: readonly Pt[], b: readonly Pt[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p) => b.some((q) => near(p, q))) && b.every((q) => a.some((p) => near(p, q)));
}
/** Whether two plans hold the same parts: the same kinds, groups and point sets, matched one to one. */
function samePlan(a: readonly PlanPart[], b: readonly PlanPart[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...b];
  for (const p of a) {
    const i = left.findIndex((q) => q.kind === p.kind && q.group === p.group && samePoints(p.points, q.points));
    if (i < 0) return false;
    left.splice(i, 1);
  }
  return true;
}
const area = (r: readonly Pt[]) => Math.abs(r.reduce((s, a, i) => s + a.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * a.y, 0)) / 2;

// a plain wall, 0..5000 × −100..100, its two faces
const plainWall = (): PlanPart[] => [
  poly("w", "wall|polygon", rect(0, -100, 5000, 100)),
  line("f1", "wall|line", seg(0, -100, 5000, -100)),
  line("f2", "wall|line", seg(0, 100, 5000, 100)),
];

// plain wall
{
  const start = plainWall();
  const cut = cutPlanOpening(start, 2000, 2900);
  const cutParts = applyPlanChanges(start, cut);
  const polys = cutParts.filter((p) => p.kind === "polygon");
  const lines = cutParts.filter((p) => p.kind === "line");
  check(polys.length === 2, `a plain wall cut 2000..2900 has two rectangles (${polys.length})`);
  check(lines.length === 6, `and six lines: four face pieces, two jambs (${lines.length})`);
  const vertical = (l: PlanPart) => Math.abs(l.points[0].x - l.points[1].x) < 0.01;
  const jambs = lines.filter(vertical);
  check(
    jambs.length === 2 && jambs.every((j) => j.points.every((q) => Math.abs(q.x - 2000) < 0.01 || Math.abs(q.x - 2900) < 0.01)),
    "the two jambs lie on the opening's edges",
  );
  check(lines.filter((l) => !vertical(l)).length === 4, "and the four face pieces run along the wall");
  const total = polys.reduce((s, p) => s + area(p.points), 0);
  check(Math.abs(total - (1000000 - 900 * 200)) < 0.01, `total polygon area is the wall less the opening (${total})`);

  const closeChanges = closePlanOpening(cutParts, 2000, 2900);
  const closed = applyPlanChanges(cutParts, closeChanges);
  check(samePlan(closed, start), "closing 2000..2900 brings the wall back to its start");
  check(closed.filter((p) => p.kind === "polygon").length === 1, "as one rectangle of four points");
  check(
    closed.filter((p) => p.kind === "polygon")[0].points.length === 4,
    "with four points",
  );
  check(closed.filter((p) => p.kind === "line").length === 2 && !closed.some((p) => Math.abs(p.points[0].x - p.points[1].x) < 0.01), "two face lines 0..5000 and no jambs");

  check(closePlanOpening(start, 2000, 2900).length === 0, "a wall with no opening has nothing to close");
  check(cutPlanOpening([line("v", "wall|line", seg(2000, -100, 2000, 100))], 2000, 2900).length === 0, "a line lying on the opening's edge stays");
  check(closePlanOpening([poly("l", "wall|polygon", rect(0, -100, 2000, 100))], 2000, 2900).length === 0, "a left piece with no partner is left alone");
}

// three components stacked in y, the boundaries doubled in two groups
{
  const start: PlanPart[] = [
    poly("w", "whole|polygon", rect(0, -100, 5000, 100)),
    poly("a", "A|polygon", rect(0, -100, 5000, -30)),
    poly("b", "B|polygon", rect(0, -30, 5000, 30)),
    poly("c", "C|polygon", rect(0, 30, 5000, 100)),
  ];
  for (const y of [-100, -30, 30, 100]) {
    start.push(line(`g1-${y}`, "g1|line", seg(0, y, 5000, y)));
    start.push(line(`g2-${y}`, "g2|line", seg(0, y, 5000, y)));
  }
  const cutParts = applyPlanChanges(start, cutPlanOpening(start, 2000, 2900));
  check(cutParts.filter((p) => p.kind === "polygon").length === 8, `cut: each polygon in two pieces (${cutParts.filter((p) => p.kind === "polygon").length})`);
  const closed = applyPlanChanges(cutParts, closePlanOpening(cutParts, 2000, 2900));
  check(samePlan(closed, start), "three components: cut, then close, is the start again");
}

// two openings: the first closed, the second untouched
{
  const start = plainWall();
  const afterFirst = applyPlanChanges(start, cutPlanOpening(start, 2000, 2900));
  const second = cutPlanOpening(afterFirst, 4000, 4400);
  const afterBoth = applyPlanChanges(afterFirst, second);
  const onlySecond = applyPlanChanges(start, cutPlanOpening(start, 4000, 4400));
  const closeFirst = closePlanOpening(afterBoth, 2000, 2900);
  // "w" is the left piece of the first opening, which 4000..4400 doesn't cross
  check(
    !second.some((c) => (c.op === "add" ? c.like === "w" : c.id === "w")),
    "a second cut doesn't touch the first opening's left piece",
  );
  const closed = applyPlanChanges(afterBoth, closeFirst);
  check(samePlan(closed, onlySecond), "closing the first opening leaves the second as it was cut");
}

// a finish that wraps 19 mm into the opening, a return on its jamb, and a core in its own group
{
  const start: PlanPart[] = [
    poly("fl", "finish|polygon", rect(0, -100, 2019, 100)),
    poly("fr", "finish|polygon", rect(2881, -100, 5000, 100)),
    poly("cl", "core|polygon", rect(0, -80, 2000, 80)),
    poly("cr", "core|polygon", rect(2900, -80, 5000, 80)),
    line("ret", "finish|line", seg(2019, 80, 2019, 100)),
  ];
  const closed = applyPlanChanges(start, closePlanOpening(start, 2000, 2900));
  check(closed.length === 2 && closed.every((p) => p.kind === "polygon" && p.points.length === 4), `a wrapped finish and core close to two clean rectangles (${closed.length})`);
  const finish = closed.find((p) => p.group === "finish|polygon");
  const core = closed.find((p) => p.group === "core|polygon");
  check(!!finish && area(finish.points) === 5000 * 200, "the finish is 0..5000 × −100..100");
  check(!!core && area(core.points) === 5000 * 160, "the core is 0..5000 × −80..80");
  check(!closed.some((p) => p.id === "ret"), "and the return on the jamb is gone");
}

// a mitred end: the slanted points stay exactly as they were
{
  const start: PlanPart[] = [
    poly("w", "wall|polygon", [
      { x: 0, y: -100 },
      { x: 5000, y: -100 },
      { x: 5100, y: 100 },
      { x: 0, y: 100 },
    ]),
    line("f1", "wall|line", seg(0, -100, 5000, -100)),
    line("f2", "wall|line", seg(0, 100, 5100, 100)),
  ];
  const cutParts = applyPlanChanges(start, cutPlanOpening(start, 2000, 2900));
  const closed = applyPlanChanges(cutParts, closePlanOpening(cutParts, 2000, 2900));
  check(samePlan(closed, start), "a mitred end: cut and close in the middle is the start again");
  const w = closed.find((p) => p.kind === "polygon");
  check(
    !!w && w.points.some((p) => p.x === 5000 && p.y === -100) && w.points.some((p) => p.x === 5100 && p.y === 100),
    "and the slanted end's points are exactly as they were",
  );
}

console.log(failures ? `\n${failures} failed` : "\nall ok");
if (failures) process.exitCode = 1;
