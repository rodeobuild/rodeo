// Checks polyline holes under Node. Run from web/:
//   npx tsx src/app/holes.check.ts
// Builds its own drawings (no samples): an outer polyline with a polyline hole and a polygon hole,
// a short child that is not a hole, a plain polyline, a group with a polyline in it, and a polygon
// with a polygon in it. Checks which objects are holes, which parent takes which holes, and what the
// PDF export writes: the parent's fill runs round its holes (f*), the holes are not filled, and
// objects that are not holes fill as before. Nothing is drawn.

import type { Attributes, LayerInfo, ObjectInfo, Pt, Shape, VwxDocument } from "../core/types.ts";
import { layersPage } from "../export/pdf.ts";
import { childrenByParent, holesOf, isHoleOf } from "./holes.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A solid fill of colour index `back`, with a pen, as a polyline or polygon draws it. */
const attrs = (back: number): Attributes => ({
  lineStyle: 2,
  lineWeight: 10,
  fillPattern: 1,
  fillFore: back,
  fillBack: back,
  penFore: 0,
  penBack: 0,
  fillOpacity: 100,
  penOpacity: 100,
});

function obj(p: { id: string; kind: ObjectInfo["kind"]; shape: Shape | null; parentId?: string | null; back?: number }): ObjectInfo {
  return {
    type: 0,
    typeName: "test",
    layerId: "L1",
    parentId: p.parentId ?? null,
    classIndex: 0,
    className: "",
    id: p.id,
    kind: p.kind,
    shape: p.shape,
    attrs: attrs(p.back ?? 2),
  } as ObjectInfo;
}

const polyline = (points: Pt[], closed: boolean): Shape => ({ kind: "polyline", points, closed }) as Shape;
const polygon = (points: Pt[]): Shape => ({ kind: "polygon", points, closed: true }) as Shape;

const outer = obj({ id: "P", kind: "polyline", shape: polyline(square(0, 0, 100, 100), false) });
const hole1 = obj({ id: "H1", kind: "polyline", shape: polyline(square(20, 20, 40, 40), true), parentId: "P", back: 1 });
const hole2 = obj({ id: "H2", kind: "polygon", shape: polygon([{ x: 60, y: 20 }, { x: 80, y: 20 }, { x: 70, y: 40 }]), parentId: "P", back: 1 });
const short = obj({ id: "S2", kind: "polyline", shape: polyline([{ x: 5, y: 5 }, { x: 9, y: 9 }], false), parentId: "P", back: 1 });
const plain = obj({ id: "Q", kind: "polyline", shape: polyline(square(200, 0, 300, 100), false), back: 1 });
const group = obj({ id: "G", kind: "group", shape: null });
const inGroup = obj({ id: "GP", kind: "polyline", shape: polyline(square(400, 0, 500, 100), true), parentId: "G", back: 1 });
const polyParent = obj({ id: "PG", kind: "polygon", shape: polygon(square(600, 0, 700, 100)), back: 1 });
const polyChild = obj({ id: "PC", kind: "polygon", shape: polygon(square(620, 20, 680, 80)), parentId: "PG", back: 1 });

// the holes checks
const all = [outer, hole1, hole2, short, plain, group, inGroup, polyParent, polyChild];
const byId = new Map(all.map((o) => [o.id, o]));
const parentOf = (o: ObjectInfo) => (o.parentId ? (byId.get(o.parentId) ?? null) : null);
const kids = childrenByParent(all);

check(isHoleOf(hole1, outer), "a closed polyline inside a polyline is a hole");
check(isHoleOf(hole2, outer), "a polygon inside a polyline is a hole");
check(!isHoleOf(short, outer), "a child with fewer than three points is not a hole");
check(!isHoleOf(inGroup, parentOf(inGroup)), "a polyline in a group is not a hole");
check(!isHoleOf(polyChild, polyParent), "a polygon in a polygon is left alone");
check(!isHoleOf(hole1, null), "an object with no parent is not a hole");
check(!isHoleOf(plain, null), "a plain polyline is not a hole");

const holes = holesOf(outer, kids.get("P"));
check(holes.map((h) => h.id).join(",") === "H1,H2", `the outer polyline's holes are H1 and H2 (${holes.map((h) => h.id)})`);
check(holesOf(polyParent, kids.get("PG")).length === 0, "a polygon parent has no holes");
check(holesOf(group, kids.get("G")).length === 0, "a group has no holes");
check(holesOf(plain, kids.get("Q")).length === 0, "a plain polyline has no holes");
check(kids.get("P")?.length === 3, "the outer polyline has three children in the grouping (two holes and a short one)");

// PDF: one layer with the outer polyline and its holes, then one with the objects that are not holes
function doc(objects: ObjectInfo[]): VwxDocument {
  const layer: LayerInfo = { id: "L1", name: "Layer", title: "", kind: "design", scale: 50, visibility: "visible", objectCount: objects.length };
  const colours = ["#ffffff", "#0000ff", "#f5f0dc"];
  return {
    info: { fileName: "holes.vwx" },
    layers: () => [layer],
    classes: () => [],
    color: (i: number) => colours[i] ?? "#000000",
    lineTypes: () => [],
    fonts: () => [],
    resources: () => [],
    viewports: () => [],
    viewportStyles: () => null,
    objects: (layerId: string) => (layerId === "L1" ? objects : []),
    object: (id: string) => objects.find((o) => o.id === id) ?? null,
  } as unknown as VwxDocument;
}

/** The operator lines of a content stream, and the subpath starts and closes in the block that ends at `at`. */
function fillBlock(lines: string[], at: number): { moves: number; closes: number } {
  let start = at;
  while (start > 0 && lines[start - 1] !== "q") start--;
  const block = lines.slice(start, at);
  return { moves: block.filter((l) => l.endsWith(" m")).length, closes: block.filter((l) => l === "h").length };
}

const withHoles = layersPage(doc([outer, hole1, hole2]), ["L1"], 50);
check(withHoles !== null, "the holed drawing makes a page");
const lines = (withHoles?.content ?? "").split("\n");
const evenOdd = lines.filter((l) => l === "f*").length;
const nonzeroFills = lines.filter((l) => l === "f" || l === "B" || l === "b" || l === "B*").length;
const stroked = lines.filter((l) => l === "S").length;
check(evenOdd === 1, `the outer polyline fills even-odd once (f* count ${evenOdd})`);
check(nonzeroFills === 0, `the holes and outline paint no nonzero fill (count ${nonzeroFills})`);
check(stroked === 3, `outline and both holes are stroked (S count ${stroked})`);
const at = lines.indexOf("f*");
const block = fillBlock(lines, at);
check(block.moves === 3 && block.closes === 2, `the even-odd fill runs the outline and both holes (${block.moves} subpaths, ${block.closes} closed; expect 3 and 2)`);

const plainPage = layersPage(doc([plain, polyParent, polyChild, group, inGroup]), ["L1"], 50);
const plainLines = (plainPage?.content ?? "").split("\n");
const plainEvenOdd = plainLines.filter((l) => l === "f*").length;
const plainFills = plainLines.filter((l) => l === "B").length;
check(plainEvenOdd === 0, `objects without holes take no even-odd fill (f* count ${plainEvenOdd})`);
check(plainFills === 4, `plain polyline, polygon, the polygon inside it and a grouped polyline each fill as before (B count ${plainFills}, expect 4)`);

console.log(failures === 0 ? "\nall holes checks pass" : `\n${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
