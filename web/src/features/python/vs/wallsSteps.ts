// (steps, snapshot parts and host answers of walls.ts: see steps.ts)
//
// The wall steps a script's Wall calls make: a plain wall added as addPlainWalls adds it, a new bottom
// and top, a reversed direction and a join, each as the editor applies it (one undo step per run).
// Walls the drawing holds carry their control line, thickness, heights and style into the snapshot.

import type { Pt } from "../../../core/index.ts";
import { registerObjectSnapshot, registerStep } from "../steps.ts";

registerObjectSnapshot((o, doc) => {
  if (o.type !== 68) return null;
  const w = doc.wall(o.id);
  if (!w) return null;
  return {
    wall: {
      start: [w.start.x, w.start.y],
      end: [w.end.x, w.end.y],
      thickness: w.thickness,
      bottom: w.bottom,
      top: w.top,
      style: w.style,
    },
  };
});

const pt = (a: unknown): Pt => {
  const [x, y] = a as [number, number];
  return { x: Number(x), y: Number(y) };
};

registerStep("wall", (a, ctx) => {
  const [tmp, layer, pts, thickness, bottom, top, cls] = a as [string, string, number[], number, number, number, string | null];
  const [made] = ctx.s.addPlainWalls(ctx.real(layer), [
    {
      start: { x: Number(pts[0]), y: Number(pts[1]) },
      end: { x: Number(pts[2]), y: Number(pts[3]) },
      thickness: Number(thickness),
      bottom: Number(bottom),
      top: Number(top),
      classIndex: cls == null ? undefined : ctx.classIndex(String(cls)),
    },
  ]);
  // "" when the wall has no length, height or thickness left once made: refuse the whole run, as the editor would
  if (!made) throw new Error("a wall needs a length, a height and a thickness");
  ctx.made.set(String(tmp), made);
});

registerStep("wallheights", (a, ctx) => {
  const [id, bottom, top] = a as [string, number, number];
  ctx.s.setWallHeights(ctx.real(id), Number(bottom), Number(top));
});

registerStep("wallreverse", (a, ctx) => {
  const id = ctx.real(a[0]);
  const w = ctx.s.doc.wall(id);
  if (!w) throw new Error("that object is not a wall");
  ctx.s.setWallLine(id, w.end, w.start);
});

registerStep("walljoin", (a, ctx) => {
  const [first, second, kind, p1, p2] = a as [string, string, "T" | "L" | "X", number[], number[]];
  ctx.s.joinWallPair(ctx.real(first), ctx.real(second), kind, { first: pt(p1), second: pt(p2) });
});
