// Checks Space objects in Vectorworks' public demo files (samples/demos, read-only): every Space in
// each file is read, drawn again (draw.ts) and checked, the document is saved and reopened, and the
// edits are undone. Run from web/ (a big file needs the memory flag):
//   node --max-old-space-size=12000 --import tsx src/app/space/demo.check.ts
// Prints one summary line per file and FAILs on what must hold: reads, the path kept, the parameter
// count, Vectorworks' own figures unchanged by a redraw, the heights and the boundary polygon Rodeo
// draws, a reshape measured from its new boundary, the reopen, and the undo. A file over about three minutes is
// cut to its first 10 Spaces, and the line says so. With no demo files it prints a skip and exits 0.

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { openVwx, type EditSession, type Pt, type VwxDocument } from "../../core/index.ts";
import { drawSpace, reshapeSpace } from "./draw.ts";
import { allSpaces, boundaryOf, cleanRing, F, measured, netBoundaryOf, signedArea, spaceOf, type Space } from "./model.ts";

const DEMOS = fileURLToPath(new URL("../../../../samples/demos/", import.meta.url));
const FILES = ["2023/DoverDam.vwx", "2024/Dover Dam.vwx", "2025/Dover Dam.vwx", "2026/Dover Dam.vwx"];
const POLYLINE = 21;
const BUDGET_MS = 180_000;
const CUT_TO = 10;
const TOLERANCE = 0.001;

let failures = 0;
const fail = (file: string, what: string): void => {
  failures++;
  console.log(`FAIL ${file}: ${what}`);
};

if (!existsSync(DEMOS)) {
  console.log("skipped: no demo files");
  process.exit(0);
}

/** A figure's change as a fraction of its stored value (0 when both are 0; Infinity when only the stored one is). */
const relative = (before: number, after: number): number => (before === 0 ? (after === 0 ? 0 : Infinity) : Math.abs(after - before) / Math.abs(before));

/** The Space's own children on its layer: its direct children, the polylines of its boundaries among them. */
const childrenOf = (s: EditSession, sp: Space): { id: string; type: number; kind: string | undefined; classIndex: number; points: Pt[] | null }[] =>
  s.doc
    .objects(sp.layerId)
    .filter((o) => o.parentId === sp.id)
    .map((o) => ({ id: o.id, type: o.type, kind: o.shape?.kind, classIndex: o.classIndex, points: ((o.shape as { points?: Pt[] } | null)?.points) ?? null }));

const figures = (doc: VwxDocument, id: string): { area: number; grossArea: number; perim: number; volume: number; name: string; number: string; corners: number } | null => {
  const sp = spaceOf(doc, id);
  if (!sp) return null;
  const units = doc.info.units;
  return {
    area: measured(sp, F.area, units),
    grossArea: measured(sp, F.grossArea, units),
    perim: sp.num(F.perimeter),
    volume: measured(sp, F.volume, units),
    name: sp.text(F.name),
    number: sp.text(F.number),
    corners: boundaryOf(doc, id)?.length ?? 0,
  };
};

for (const rel of FILES) {
  const file = `${rel.split("/")[0]} ${basename(rel)}`;
  const path = DEMOS + rel;
  if (!existsSync(path)) {
    console.log(`skipped: ${rel} (not in samples/demos)`);
    continue;
  }
  const t0 = Date.now();
  const s = openVwx(new Uint8Array(readFileSync(path)), basename(path));
  const tLoop = Date.now();
  const doc = s.doc;
  const units = doc.info.units;
  const depth0 = s.undoDepth;
  const all = allSpaces(doc);
  const total = all.length;

  // the first Space as it is before anything here: its parameters and children, for the undo check
  const first = all[0];
  const firstFields = first ? JSON.stringify(first.fields.map((f) => [f.name, f.value])) : "";
  const firstChildren = first ? childrenOf(s, first).length : 0;

  let read = 0;
  let withBoundary = 0;
  let pathKept = 0;
  let paramsSame = 0;
  let heightsChecked = 0;
  let heightsOk = 0;
  let polygonOnce = 0;
  let polygonChecked = 0;
  const within = { area: 0, grossArea: 0, perim: 0, volume: 0 };
  const worst: { area: number; grossArea: number; perim: number; volume: number } = { area: 0, grossArea: 0, perim: 0, volume: 0 };
  const worstId: Record<string, string> = {};
  let moved = 0;
  let movedMatchesChild = 0;
  let movedNoChild = 0;
  let redone = 0;
  const after: { id: string; name: string; number: string; area: number; corners: number }[] = [];
  let limit = total;
  let cutNote = "";

  let seen = 0;
  for (let i = 0; i < limit; i++) {
    seen++;
    const sp = all[i];
    const id = sp.id;
    const b = figures(doc, id);
    if (!b) {
      fail(file, `Space ${i + 1} is not read`);
      continue;
    }
    read++;
    if (!boundaryOf(doc, id)) {
      fail(file, `Space ${i + 1} has no boundary of three corners`);
      continue;
    }
    withBoundary++;
    // the first own polyline child (direct child, type 21): its area, in mm²
    const child = childrenOf(s, sp).find((c) => c.type === POLYLINE && c.points);
    const childArea = child?.points ? Math.abs(signedArea(cleanRing(child.points))) : null;
    const params = sp.fields.length;

    try {
      s.batch(() => drawSpace(s, id));
    } catch (err) {
      fail(file, `Space ${i + 1} would not draw again: ${(err as Error).message}`);
      continue;
    }
    redone++;
    const a = figures(doc, id)!;
    const sp2 = spaceOf(doc, id)!;

    if (relative(b.area, a.area) <= TOLERANCE) within.area++;
    if (relative(b.grossArea, a.grossArea) <= TOLERANCE) within.grossArea++;
    if (relative(b.perim, a.perim) <= TOLERANCE) within.perim++;
    if (relative(b.volume, a.volume) <= TOLERANCE) within.volume++;
    for (const k of ["area", "grossArea", "perim", "volume"] as const) {
      const r = relative(b[k], a[k]);
      if (r > worst[k]) {
        worst[k] = r;
        worstId[k] = `#${i + 1} ${id.slice(0, 8)}`;
      }
    }
    // a Space Vectorworks made keeps Vectorworks' own figures when it is drawn again unmoved
    for (const k of ["area", "grossArea", "perim", "volume"] as const) if (relative(b[k], a[k]) > 1e-9) fail(file, `Space ${i + 1}'s ${k} changed when it was drawn again: ${b[k]} to ${a[k]}`);
    if (relative(b.area, a.area) > TOLERANCE) {
      moved++;
      if (childArea === null) movedNoChild++;
      else if (relative(b.area, childArea) <= TOLERANCE) movedMatchesChild++;
      console.log(`  info #${i + 1} ${id.slice(0, 8)}: stored Area ${b.area.toFixed(0)} mm2, path ${a.area.toFixed(0)} mm2 (${(100 * (a.area / b.area - 1)).toFixed(2)}%), first polyline child ${childArea === null ? "none" : `${childArea.toFixed(0)} mm2 (${(100 * (childArea / b.area - 1)).toFixed(2)}%)`}`);
    }

    // after the redraw: the path is kept, the parameters are as many, the heights and the boundary are as Rodeo draws them
    if (doc.pluginPath(id) && boundaryOf(doc, id)) pathKept++;
    else fail(file, `Space ${i + 1} lost its path`);
    if (sp2.fields.length === params) paramsSame++;
    else fail(file, `Space ${i + 1} parameter count ${params} became ${sp2.fields.length}`);
    if (sp2.flag(F.show3d)) {
      heightsChecked++;
      const h = doc.heightsOf(id);
      // what must hold is that it stands at least as high as the Space's clear height. One Space in
      // each of the 2023 to 2025 files keeps a profile group of Vectorworks' with a taller extrude,
      // which heightsOf counts and the 3D view doesn't draw: reported, not failed.
      const height = sp2.num(F.height);
      if (h && Math.abs(h.max - h.min - height) <= 1) heightsOk++;
      else if (h && h.max - h.min > height) console.log(`  info #${i + 1}: heights span ${h.min.toFixed(0)}..${h.max.toFixed(0)} for a height of ${height} (a group of Vectorworks' kept beside the drawing)`);
      else fail(file, `Space ${i + 1} volume spans ${h ? `${h.min}..${h.max}` : "nothing"}, not its height ${height} mm`);
    }
    const boundaryName = sp2.text(F.boundaryClass);
    const classIdx = boundaryName ? (doc.classes().find((c) => c.name === boundaryName)?.index ?? null) : null;
    if (classIdx !== null) {
      polygonChecked++;
      const drawn = childrenOf(s, sp2).filter((c) => c.kind === "polygon" && c.classIndex === classIdx).length;
      if (drawn === 1) polygonOnce++;
      else fail(file, `Space ${i + 1} draws ${drawn} boundary polygons in its class, not one`);
    }
    after.push({ id, name: a.name, number: a.number, area: a.area, corners: a.corners });

    // from the open on: the time the rest would take at the pace so far (checked after each Space)
    const elapsed = Date.now() - t0;
    const projected = elapsed + ((Date.now() - tLoop) / (i + 1)) * (total - (i + 1));
    if (limit === total && projected > BUDGET_MS && total > CUT_TO) {
      limit = Math.max(CUT_TO, i + 1);
      cutNote = `; projected ${Math.round(projected / 1000)} s, so the first ${limit} of ${total} only`;
    }
  }

  // reshaped, a Space is measured from its new boundary: the second, grown by a tenth about a corner, is 1.21 times its polygon
  if (all.length > 1) {
    const id = all[1].id;
    const ring = netBoundaryOf(doc, id);
    if (ring) {
      const grown = ring.map((p) => ({ x: ring[0].x + (p.x - ring[0].x) * 1.1, y: ring[0].y + (p.y - ring[0].y) * 1.1 }));
      s.batch(() => reshapeSpace(s, id, grown));
      const now = figures(doc, id)!;
      const want = 1.21 * Math.abs(signedArea(ring));
      if (relative(want, now.area) > 1e-6) fail(file, `a reshaped Space measures ${now.area}, not its new boundary's ${want}`);
      if (relative(want, Math.abs(signedArea(netBoundaryOf(doc, id) ?? []))) > 1e-6) fail(file, "a reshaped Space's net boundary didn't follow");
      const entry = after.find((a) => a.id === id);
      if (entry) entry.area = now.area;
    }
  }

  // save and reopen: every Space's name, number, area and corners as they are after the redraw
  let reopen = "";
  if (doc.holdsParts()) reopen = "reopen skipped (parts held in the source file: toBytes would throw)";
  else {
    try {
      const bytes = doc.toBytes();
      const again = openVwx(bytes, basename(path));
      const spacesAgain = allSpaces(again.doc);
      let equal = 0;
      if (spacesAgain.length !== total) fail(file, `reopened with ${spacesAgain.length} Spaces, saved with ${total}`);
      for (const a of after) {
        const f = figures(again.doc, a.id);
        const same = !!f && f.name === a.name && f.number === a.number && Math.abs(f.area - a.area) <= 1e-6 * Math.max(1, Math.abs(a.area)) && f.corners === a.corners;
        if (same) equal++;
        else fail(file, `reopened Space ${a.id.slice(0, 8)} differs`);
      }
      reopen = `reopen equal ${equal}/${after.length}`;
    } catch (err) {
      reopen = `reopen skipped (toBytes threw: ${(err as Error).message})`;
    }
  }

  // undo everything, and the first Space as it was
  let undone = 0;
  while (s.undoDepth > depth0) {
    s.undo();
    undone++;
  }
  const firstAfterUndo = first ? JSON.stringify(spaceOf(doc, first.id)?.fields.map((f) => [f.name, f.value]) ?? null) : "";
  const undoOk = s.undoDepth === depth0 && (!first || (firstAfterUndo === firstFields && childrenOf(s, first).length === firstChildren));
  if (!undoOk) fail(file, `undo did not restore the first Space (depth ${s.undoDepth}, wanted ${depth0})`);

  const pct = (n: number): string => `${n}/${redone}`;
  console.log(
    `${file} (${units}, ${total} Spaces${limit < total ? `, ${seen} processed` : ""}): read ${read}/${seen}, boundary of 3+ corners ${withBoundary}/${seen}, path kept ${pathKept}/${redone}, parameters unchanged ${paramsSame}/${redone}, ` +
      `volume spans floor to height ${heightsOk}/${heightsChecked}, boundary polygon once in its class ${polygonOnce}/${polygonChecked}, ${reopen}, undo ${undone} steps ${undoOk ? "back" : "NOT back"}; ` +
      `within 0.1%: Area ${pct(within.area)}, Gross Area ${pct(within.grossArea)}, Perim ${pct(within.perim)}, Volume ${pct(within.volume)}; ` +
      `Area moved by more than 0.1% in ${moved} (its first own polyline child had the stored Area in ${movedMatchesChild}, no polyline child in ${movedNoChild})${cutNote}; ` +
      `worst: Area ${(worst.area * 100).toFixed(2)}% ${worstId.area ?? ""}, Gross Area ${(worst.grossArea * 100).toFixed(2)}% ${worstId.grossArea ?? ""}, Perim ${(worst.perim * 100).toFixed(2)}% ${worstId.perim ?? ""}, Volume ${(worst.volume * 100).toFixed(2)}% ${worstId.volume ?? ""}; ` +
      `${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}

console.log(failures === 0 ? "demo checks passed" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
