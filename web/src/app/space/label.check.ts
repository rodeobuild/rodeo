// Checks Space labels (label.ts), on a blank drawing. Run from web/:
//   npx tsx src/app/space/label.check.ts
// A label is made from a Space's parameters: its name and number as Config says, the Show flags'
// lines, the number box and the underline, the extra fields the user chose (a "Space Label"
// record), and its text's rotation and alignment. A label follows the data: drawing the Space
// again after a change draws the new text.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type NewShape, type Pt } from "../../core/index.ts";
import { drawSpace } from "./draw.ts";
import { LABEL_FORMAT, extraFields, labelLines, labelParts, setExtraFields } from "./label.ts";
import { addSpace } from "./make.ts";
import { F, figuresOf, setSpaceValues, spaceOf, type Space } from "./model.ts";
import { formatArea, formatLength } from "../units.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));
const ORIGIN: Pt = { x: 0, y: 0 };

const s = openVwx(blankDrawing("mm"));
const layer = s.createLayer("Rooms", "design", 50);
const SCALE = 50;
const HEIGHT = 2400;
const FLOOR_TO_FLOOR = 3000;
const ring = [{ x: 1000, y: 2000 }, { x: 5000, y: 2000 }, { x: 5000, y: 5000 }, { x: 1000, y: 5000 }]; // 4000 × 3000

/** a Space made with `values` over the label defaults (the label is on by default) */
function spaceWith(values: Record<string, string | number | boolean>, at = ring): Space {
  const id = s.batch(() => addSpace(s, { ring: at, layerId: layer, values }));
  return spaceOf(s.doc, id)!;
}
/** the Space read again, after a change */
const reread = (sp: Space): Space => spaceOf(s.doc, sp.id)!;
const ctxFor = (): { doc: typeof s.doc; figures: ReturnType<typeof figuresOf>; scale: number } => ({ doc: s.doc, figures: figuresOf(ring, null, HEIGHT, FLOOR_TO_FLOOR), scale: SCALE });
const partsOf = (sp: Space, at: Pt = ORIGIN): NewShape[] => labelParts(reread(sp), at, ctxFor());
const texts = (parts: readonly NewShape[]): { text: string; at: Pt; height: number; hAlign?: number; angle?: number }[] =>
  parts.flatMap((p) => (p.kind === "text" ? [{ text: p.text, at: p.at, height: p.height, hAlign: p.hAlign, angle: p.angle }] : []));
const linesOf = (sp: Space): string[] => labelLines(reread(sp), ctxFor()).map((l) => l.text);

// label off: no parts
const off = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", [F.showLabel]: false });
check(partsOf(off).length === 0 && labelLines(reread(off), ctxFor()).length === 0, "with its label off it has no lines and no parts");

// name and number, their heights at scale 50, and the block centred on `at`
const both = spaceWith({ [F.name]: "Kitchen", [F.number]: "101" });
const t2 = texts(partsOf(both));
check(t2.length === 2 && t2[0].text === "Kitchen" && t2[1].text === "101", `name then number (${t2.map((t) => t.text).join(", ")})`);
check(near(t2[0].height, 3.5 * SCALE) && near(t2[1].height, 2.5 * SCALE), `their heights at scale 50 are 175 and 125 (${t2[0].height}, ${t2[1].height})`);
check(t2.every((t) => t.hAlign === 2), "centred on the anchor by default");
// the cells of the two lines (height × 1.3) stack from above `at` to below it: their outer edges are equal
const top = t2[0].at.y + t2[0].height * 1.3 / 2;
const bottom = t2[1].at.y - t2[1].height * 1.3 / 2;
check(t2[0].at.y > 0 && t2[1].at.y < 0 && near((top + bottom) / 2, 0), `the block is centred on at (top ${top.toFixed(2)}, bottom ${bottom.toFixed(2)})`);
const one = spaceWith({ [F.name]: "Hall", [F.number]: "" });
const t1 = texts(partsOf(one, { x: 300, y: 700 }));
check(t1.length === 1 && near(t1[0].at.x, 300) && near(t1[0].at.y, 700), "a single line sits exactly on at");

// Config: name, number, or both (empty means both)
const cfg = (config: string): string[] => linesOf(spaceWith({ [F.name]: "Kitchen", [F.number]: "101", [F.labelConfig]: config }));
check(JSON.stringify(cfg("Name")) === JSON.stringify(["Kitchen"]), "Config 'Name' shows the name only");
check(JSON.stringify(cfg("NUMBER only")) === JSON.stringify(["101"]), "Config containing 'number' (any case) shows the number only");
check(JSON.stringify(cfg("Name and Number")) === JSON.stringify(["Kitchen", "101"]), "Config 'Name and Number' shows both");
check(JSON.stringify(cfg("")) === JSON.stringify(["Kitchen", "101"]), "an empty Config shows both");

// the number box: on with the number, a closed shape round it; off with its flag
const box = (sp: Space): Extract<NewShape, { kind: "polyline" }>[] => partsOf(sp).flatMap((p) => (p.kind === "polyline" ? [p] : []));
const b1 = box(both);
check(b1.length === 1 && b1[0].closed && b1[0].points.length === 4, "Show Number Box draws one closed box round the number");
const numberY = t2[1].at.y;
const ys = b1[0].points.map((p) => p.y);
const xs = b1[0].points.map((p) => p.x);
check(Math.min(...ys) < numberY && Math.max(...ys) > numberY && Math.min(...xs) < 0 && Math.max(...xs) > 0, "the box encloses the number's line");
check(near(Math.min(...ys), numberY - 2.5 * SCALE / 2 - 0.8 * SCALE) && near(Math.max(...ys), numberY + 2.5 * SCALE / 2 + 0.8 * SCALE), "its top and bottom are 0.8 mm on paper beyond the number's height");
const noBox = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", "Show Number Box": false });
check(box(noBox).length === 0, "with Show Number Box off there is no box");
check(box(one).length === 0, "with no number shown there is no box");

// underline: under the name, as wide as the name's estimated text
const und = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", [F.underlineName]: true });
const ul = partsOf(und).filter((p): p is Extract<NewShape, { kind: "line" }> => p.kind === "line");
const nameY = texts(partsOf(und))[0].at.y;
check(ul.length === 1, "Underline Name draws one line");
if (ul.length === 1) {
  const [a, b] = [ul[0].a, ul[0].b];
  check(a.y === b.y && a.y < nameY - 3.5 * SCALE / 2 + 1e-6 && a.y > nameY - 3.5 * SCALE, "the underline lies just under the name");
  check(near(Math.abs(b.x - a.x), 0.6 * 3.5 * SCALE * "Kitchen".length) && near((a.x + b.x) / 2, 0), `it is as wide as the name's estimated text (${Math.abs(b.x - a.x)})`);
}
check(partsOf(noBox).filter((p) => p.kind === "line").length === 0, "without Underline Name there is no line");

// each Show flag adds exactly its line, in order
const all = spaceWith({
  [F.name]: "Kitchen",
  [F.number]: "101",
  [F.occupancy]: "Residential",
  [F.showOccupancy]: true,
  [F.showArea]: true,
  [F.showProposedArea]: true,
  [F.proposedArea]: 0,
  [F.showDimensions]: true,
  [F.showVolume]: true,
});
const expected = ["Kitchen", "101", "Residential", formatArea(12e6, s.doc.info.units), `${formatLength(4000, s.doc.info.units)} x ${formatLength(3000, s.doc.info.units)}`, "28.8 m³"];
check(JSON.stringify(linesOf(all)) === JSON.stringify(expected), `each Show line in order, proposed area 0 skipped (${linesOf(all).join(" | ")})`);
check(linesOf(all)[3] === formatArea(12e6, s.doc.info.units), `the area reads as formatArea gives it (${linesOf(all)[3]})`);
check(linesOf(all)[5] === "28.8 m³", `the volume reads "28.8 m³" (${linesOf(all)[5]})`);

// proposed area: its value and unit, when not 0
s.batch(() => setSpaceValues(s, all.id, { [F.proposedArea]: 15 }));
check(linesOf(all).includes("15 m²"), `a proposed area of 15 shows as "15 m²" (${linesOf(all).join(" | ")})`);

// the flags off: no extra lines
const plain = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", [F.occupancy]: "Residential" });
check(JSON.stringify(linesOf(plain)) === JSON.stringify(["Kitchen", "101"]), "with the Show flags off only the name and number show");

// alignment: Left and Right set the anchor; anything else is centred
const alignOf = (value: string): number | undefined => texts(partsOf(spaceWith({ [F.name]: "Kitchen", [F.number]: "", "Align": value })))[0]?.hAlign;
check(alignOf("Left") === 1 && alignOf("Right") === 3 && alignOf("Center") === 2 && alignOf("Justified") === 2, "Align Left and Right set the text's alignment, anything else centres");
const leftSpace = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", "Align": "Left" });
const leftBox = box(leftSpace)[0];
check(leftBox !== undefined && Math.min(...leftBox.points.map((p) => p.x)) < 0 && Math.min(...leftBox.points.map((p) => p.x)) > -40 - 1e-6, "left aligned, the number box starts at the anchor less its margin");

// text rotation turns the block about at, and each text's angle
const rot0 = spaceWith({ [F.name]: "Kitchen", [F.number]: "101" });
const rot90 = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", "Text Rotation": 90 });
const at: Pt = { x: 100, y: 200 };
const p0 = texts(partsOf(rot0, at));
const p90 = texts(partsOf(rot90, at));
const turned = (p: Pt): Pt => ({ x: at.x - (p.y - at.y), y: at.y + (p.x - at.x) }); // 90° counter-clockwise about at
check(p90.length === 2 && p90.every((t) => t.angle === 90), "each text takes the rotation as its angle");
check(p90.every((t, i) => near(t.at.x, turned(p0[i].at).x) && near(t.at.y, turned(p0[i].at).y)), "the positions turn 90° about at");
check(texts(partsOf(rot0)).every((t) => t.angle === undefined), "unrotated text has no angle");

// extra fields: chosen, drawn, followed, ignored when unknown
const ex = spaceWith({ [F.name]: "Kitchen", [F.number]: "101", [F.floorFinish]: "Oak", [F.ceilingFinish]: "" });
s.batch(() => setExtraFields(s, ex.id, ["Floor Finish", "Ceiling Material"]));
check(JSON.stringify(extraFields(s.doc, ex.id)) === JSON.stringify([F.floorFinish, F.ceilingFinish]), "the chosen fields are read back");
check(s.doc.recordFormats().filter((f) => f.name === LABEL_FORMAT).length === 1, "the drawing has one Space Label format");
const kidTexts = (id: string): string[] => s.doc.objects(layer).flatMap((o) => (o.parentId === id && o.shape?.kind === "text" ? [o.shape.text ?? ""] : []));
s.batch(() => drawSpace(s, ex.id));
check(kidTexts(ex.id).includes("Floor: Oak"), `the drawn label has "Floor: Oak" (${kidTexts(ex.id).join(" | ")})`);
check(!kidTexts(ex.id).some((t) => t.startsWith("Ceiling")), "an empty finish is left out");
s.batch(() => setSpaceValues(s, ex.id, { [F.floorFinish]: "Walnut" }));
s.batch(() => drawSpace(s, ex.id));
check(kidTexts(ex.id).includes("Floor: Walnut") && !kidTexts(ex.id).includes("Floor: Oak"), "changing the finish and drawing again changes the text");

s.batch(() => setExtraFields(s, ex.id, ["Nonsense Field", "Floor Finish"]));
s.batch(() => drawSpace(s, ex.id));
check(extraFields(s.doc, ex.id).includes("Nonsense Field") && kidTexts(ex.id).every((t) => !t.includes("Nonsense")), "an unknown field name is ignored when drawn");
check(kidTexts(ex.id).includes("Floor: Walnut"), "the known field next to it still shows");
check(extraFields(s.doc, ex.id).length === 2, "the field list has two names");

// feet and inches: areas in square feet
const ft = openVwx(blankDrawing("ftin"));
const ftLayer = ft.createLayer("Rooms", "design", 48);
const ftId = ft.batch(() => addSpace(ft, { ring: [{ x: 0, y: 0 }, { x: 3048, y: 0 }, { x: 3048, y: 3048 }, { x: 0, y: 3048 }], layerId: ftLayer, values: { [F.name]: "Den", [F.showArea]: true } }));
const ftSpace = spaceOf(ft.doc, ftId)!;
const ftLines = labelLines(ftSpace, { doc: ft.doc, figures: figuresOf([{ x: 0, y: 0 }, { x: 3048, y: 0 }, { x: 3048, y: 3048 }, { x: 0, y: 3048 }], null, 2438.4, 0), scale: 48 }).map((l) => l.text);
check(ftLines.some((l) => /^100(\.0+)? sq ft$/.test(l)), `a 10 ft square room shows 100 sq ft (${ftLines.join(" | ")})`);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
console.log("all ok");
