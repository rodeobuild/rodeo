// Node check of the wall calls (vs/walls.ts) and their steps (wallsSteps.ts' ops): each call is run from
// Python and Vectorscript on a prepared drawing with a plain wall, a styled wall and a text. Run from web/:
// npx tsx src/features/python/vs/walls.check.ts

import assert from "node:assert/strict";
import { LAYER, blankSnapshot, ranVs, runVs, type Snapshot, type SnapObject } from "../vsCheck.ts";

const PLAIN = "wall-plain";
const STYLED = "wall-styled";
const TEXT = "txt-1";

/** A drawing with a plain wall (200 thick, 0 to 3000 high, from 0,0 to 4000,0), a styled one, and a text. */
function drawing(): Snapshot {
  const snap = blankSnapshot();
  const wall = (id: string, start: number[], end: number[], style: string | null, thickness: number, top: number): SnapObject => ({
    id, type: 68, typeName: "wall", layer: LAYER, parent: null, cls: "None", name: "", bbox: null, attrs: {}, sym: null, records: {}, shape: null,
    wall: { start, end, thickness, bottom: 0, top, style },
  } as unknown as SnapObject);
  snap.objects = [
    wall(PLAIN, [0, 0], [4000, 0], null, 200, 3000),
    wall(STYLED, [0, 1000], [4000, 1000], "Brick 200", 250, 2400),
    {
      id: TEXT, type: 10, typeName: "text", layer: LAYER, parent: null, cls: "None", name: "", bbox: [0, 0, 10, 4], attrs: {}, sym: null, records: {},
      shape: { kind: "text", text: "Hi", at: [0, 0], size: 6, font: "Arial", tstyle: 0, bold: false, italic: false, underline: false, h: 1, v: 1, angle: 0 },
    } as unknown as SnapObject,
  ];
  return snap;
}

/** Runs a script that prints one JSON value (its last line) and gives it back. */
function json(code: string, snapshot: Snapshot = drawing()): unknown {
  const out = ranVs(`import json, vs\n${code}\n`, { file: "read.py", snapshot });
  return JSON.parse(out.printed.trim().split("\n").pop() ?? "null");
}

/** The ops a script made (its steps), by kind. */
function opsOf(code: string, snapshot: Snapshot = drawing()): unknown[][] {
  return ranVs(`import vs\n${code}\n`, { file: "ops.py", snapshot }).ops;
}

// ---- Wall: a plain wall on the active layer, with the default width and height -------------------

{
  const ops = opsOf(`vs.Wall((0, 0), (3000, 0))`, blankSnapshot());
  assert.deepEqual(ops, [["wall", "new:1", LAYER, [0, 0, 3000, 0], 150, 0, 2700, null]]);
}
{
  // the four-number form, as Vectorscript passes it, and a wall made after SetWallWidth
  const ops = opsOf(`vs.SetWallWidth(200)\nvs.Wall(0, 0, 0, 2000)`, blankSnapshot());
  assert.deepEqual(ops, [["wall", "new:1", LAYER, [0, 0, 0, 2000], 200, 0, 2700, null]]);
}
{
  // a feet and inches drawing gets the inch sizes: 6 inches, 8 feet
  const snap = blankSnapshot();
  snap.units = { mm: 25.4, mark: '"', area: "sq ft", format: 3, display: 16 };
  const ops = opsOf(`vs.Wall(0, 0, 12, 0)`, snap);
  assert.deepEqual(ops, [["wall", "new:1", LAYER, [0, 0, 12 * 25.4, 0], 152.4, 0, 2438.4, null]]);
}
{
  // a wall in a class: the class's name goes in the step (None is left out)
  const snap = blankSnapshot();
  snap.activeClass = "Dimension";
  const ops = opsOf(`vs.Wall(0, 0, 100, 0)`, snap);
  assert.deepEqual(ops, [["wall", "new:1", LAYER, [0, 0, 100, 0], 150, 0, 2700, "Dimension"]]);
}
{
  const r = runVs(`import vs\nvs.Wall(5, 5, 5, 5)\n`, { file: "zero.py", snapshot: blankSnapshot() });
  assert.equal(r.error?.name, "ValueError");
}

// the wall just made can be read back (LNewObj gives its handle)
{
  const v = json(`h = vs.LNewObj()\nprint(json.dumps({"made": h is not None}))`, blankSnapshot());
  assert.ok(v !== null);
}

// ---- reading the thickness, heights and style of a wall the drawing holds --------------------------

{
  const v = json(`p = vs.Handle("${PLAIN}")\ns = vs.Handle("${STYLED}")
print(json.dumps({
  "width": vs.WallWidth(p), "found": list(vs.GetWallThickness(p)), "notWall": list(vs.GetWallThickness(vs.Handle("${TEXT}"))),
  "styledWidth": vs.WallWidth(s), "heights": list(vs.WallHeight(p)),
  "overall": list(vs.GetWallOverallHeights(p)), "corners": list(vs.GetWallCornerHeights(s)),
  "style": vs.GetWallStyle(p), "styledStyle": vs.GetWallStyle(s),
  "default": vs.GetWallWidth(), "offset": vs.GetWallControlOffset(),
}))`);
  assert.deepEqual(v, {
    width: 200, found: [true, 200], notWall: [false, 0], styledWidth: 250, heights: [3000, 3000],
    overall: [3000, 0], corners: [2400, 0, 2400, 0], style: "", styledStyle: "Brick 200", default: 150, offset: 0,
  });
}
{
  // the feet and inches reading: 200 mm is 200 / 25.4 inches
  const snap = drawing();
  snap.units = { mm: 25.4, mark: '"', area: "sq ft", format: 3, display: 16 };
  const v = json(`print(json.dumps({"width": vs.WallWidth(vs.Handle("${PLAIN}"))}))`, snap) as { width: number };
  assert.ok(Math.abs(v.width - 200 / 25.4) < 1e-9, String(v.width));
}

// a Handle that isn't a wall is refused
{
  const r = runVs(`import vs\nvs.WallWidth(vs.Handle("${TEXT}"))\n`, { file: "not-wall.py", snapshot: drawing() });
  assert.equal(r.error?.name, "TypeError");
}

// ---- changing thickness is refused (no edit in the editor changes a wall's width in place) -------

for (const code of [`vs.SetWallThickness(vs.Handle("${PLAIN}"), 300)`, `vs.HWallWidth(vs.Handle("${PLAIN}"), 300)`]) {
  const r = runVs(`import vs\n${code}\n`, { file: "thick.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError", code);
}

// ---- heights: SetWallHeights, HWallHeight, SetWallCornerHeights and their refusals -----------------

{
  const ops = opsOf(`vs.SetWallHeights(vs.Handle("${PLAIN}"), 3200, 3200)`);
  assert.deepEqual(ops, [["wallheights", PLAIN, 0, 3200]]);
}
{
  const ops = opsOf(`vs.HWallHeight(vs.Handle("${STYLED}"), 2000, 2000)`);
  assert.deepEqual(ops, [["wallheights", STYLED, 0, 2000]]);
}
{
  const ops = opsOf(`vs.SetWallCornerHeights(vs.Handle("${PLAIN}"), 2800, 100, 2800, 100)`);
  assert.deepEqual(ops, [["wallheights", PLAIN, 100, 2800]]);
}
{
  // a sloping wall (two heights) and a sloping top are refused
  for (const code of [`vs.SetWallHeights(vs.Handle("${PLAIN}"), 3000, 2500)`, `vs.HWallHeight(vs.Handle("${PLAIN}"), 3000, 2500)`, `vs.SetWallCornerHeights(vs.Handle("${PLAIN}"), 3000, 0, 2500, 0)`]) {
    const r = runVs(`import vs\n${code}\n`, { file: "slope.py", snapshot: drawing() });
    assert.equal(r.error?.name, "NotImplementedError", code);
  }
}
{
  // a top at or below the bottom is refused
  const r = runVs(`import vs\nvs.SetWallCornerHeights(vs.Handle("${PLAIN}"), 0, 100, 0, 100)\n`, { file: "flat.py", snapshot: drawing() });
  assert.equal(r.error?.name, "ValueError");
}

// ---- reversing a wall and control offsets -----------------------------------------------------------

{
  const ops = opsOf(`vs.ReverseWallSides(vs.Handle("${PLAIN}"))`);
  assert.deepEqual(ops, [["wallreverse", PLAIN]]);
}
{
  assert.deepEqual(json(`print(json.dumps({"set": vs.SetWallControlOffset(0)}))`), { set: null }, "zero is the offset Rodeo has");
  const r = runVs(`import vs\nvs.SetWallControlOffset(50)\n`, { file: "offset.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError");
}

// ---- joins ------------------------------------------------------------------------------------------

{
  const ops = opsOf(`ok = vs.JoinWalls(vs.Handle("${PLAIN}"), vs.Handle("${STYLED}"), (4000, 0), (4000, 1000), 2, True, False)\nassert ok is True`);
  assert.deepEqual(ops, [["walljoin", PLAIN, STYLED, "L", [4000, 0], [4000, 1000]]]);
}
{
  // the Vectorscript form: the points are four numbers; 1 is a T join and 3 an X join
  const ops = opsOf(`vs.JoinWalls(vs.Handle("${PLAIN}"), vs.Handle("${STYLED}"), 0, 0, 0, 1000, 1, True, True)\nvs.JoinWalls(vs.Handle("${PLAIN}"), vs.Handle("${STYLED}"), 0, 0, 0, 1000, 3, True, True)`);
  assert.deepEqual(ops, [
    ["walljoin", PLAIN, STYLED, "T", [0, 0], [0, 1000]],
    ["walljoin", PLAIN, STYLED, "X", [0, 0], [0, 1000]],
  ]);
}
{
  const r = runVs(`import vs\nvs.JoinWalls(vs.Handle("${PLAIN}"), vs.Handle("${STYLED}"), (0, 0), (0, 0), 4, True, True)\n`, { file: "auto.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError");
}

// ---- Vectorscript spellings of the calls with by-reference parameters --------------------------------

{
  const r = runVs(
    `PROCEDURE Walls;
VAR
   w : HANDLE;
   found : BOOLEAN;
   thick : REAL;
   top, bottom : REAL;
BEGIN
   Wall(0, 0, 3000, 0);
   w := LNewObj;
   found := GetWallThickness(w, thick);
   GetWallOverallHeights(w, top, bottom);
   SetWallHeights(w, 2800, 2800);
END;

RUN(Walls);
`,
    { file: "walls.vs", snapshot: drawing() },
  );
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(r.ops.length, 2);
  assert.deepEqual(r.ops[0], ["wall", "new:1", LAYER, [0, 0, 3000, 0], 150, 0, 2700, null]);
  assert.deepEqual(r.ops[1], ["wallheights", "new:1", 0, 2800]);
}

// ---- the calls Rodeo can't give: a clear refusal, from the module ------------------------------------

for (const call of [
  `AddSymToWall(vs.Handle("${PLAIN}"), 500, 0, False, True, "Chair")`,
  `BreakWall(1000, 500, True)`,
  `SetWallStyle(vs.Handle("${PLAIN}"), "Brick 200", 0, 0)`,
  `WallFootPrint(vs.Handle("${PLAIN}"))`,
  `WallPeak(1000, 500)`,
  `RoundWall((0, 0), (1000, 0), (1000, 1000))`,
  `IsCurtainWall(vs.Handle("${PLAIN}"))`,
  `MoveWallByOffset(vs.Handle("${PLAIN}"), 100)`,
  `ConvertToUnstyledWall(vs.Handle("${STYLED}"))`,
]) {
  const r = runVs(`import vs\nvs.${call}\n`, { file: "missing.py", snapshot: drawing() });
  assert.equal(r.error?.name, "NotImplementedError", call);
  assert.ok((r.error?.message ?? "").includes("isn't available in Rodeo yet"), r.error?.message);
}

console.log("vs walls: ok");
