// A Space's label: what it shows in plan, from its parameters, as shapes in the Space's own frame
// for draw.ts to add. A Space draws a label itself when its "11_Display Stamp" parameter is set;
// the Spaces in Vectorworks' demo files have it off and are labelled by separate Data Tag objects.
// The lines are the name and number (per "Config"), then the Show flags' lines in order, then the
// extra fields the user chose (a "Space Label" record, extraFields). Text widths are not measured
// here, so the number box and the underline use an estimate of 0.6 × height per character.
// Free of the page.

import type { EditSession, NewShape, Pt, VwxDocument } from "../../core/index.ts";
import { F, nameOf, occupancyOf, ownUnits, type Space, type SpaceFigures } from "./model.ts";
import { formatArea, formatLength } from "../units.ts";

const H_LEFT = 1;
const H_CENTRE = 2;
const H_RIGHT = 3;
const V_CENTRE = 3;

/** the name's and the other lines' heights on paper, mm */
export const NAME_MM = 3.5;
export const LINE_MM = 2.5;

/** Parameters that are not in model.ts's F (the label's own, and the text's). */
const P = {
  showNumberBox: "Show Number Box",
  align: "Align",
  textRotation: "Text Rotation",
} as const;

/** the number box's margin round the number, on paper, mm */
const BOX_MARGIN_MM = 0.8;
/** estimated width of a character, in text heights (text width is not measured here) */
const CHAR_WIDTH = 0.6;
/** a line's cell is its height on paper times this, so the lines stack with room between them */
const LINE_SPACING = 1.3;

/** What a label is drawn from besides the Space's parameters. */
export interface LabelContext {
  readonly doc: VwxDocument;
  /** what the Space measures now, mm, mm² and mm³ */
  readonly figures: SpaceFigures;
  /** the scale of the Space's layer: text of 1 mm on paper is this many mm in the drawing */
  readonly scale: number;
}

/** One line of a label: its text and its height on paper, mm. */
export interface LabelLine {
  readonly text: string;
  readonly mm: number;
  /** the name or number line, which the number box and the underline go with */
  readonly role?: "name" | "number";
}

/** The parameters a user may choose to show on a label, with the readable label each shows under. */
export const LABEL_FIELD_CHOICES: readonly { readonly name: string; readonly label: string }[] = [
  { name: F.floorFinish, label: "Floor" },
  { name: F.baseFinish, label: "Base" },
  { name: F.northFinish, label: "N Wall" },
  { name: F.eastFinish, label: "E Wall" },
  { name: F.southFinish, label: "S Wall" },
  { name: F.westFinish, label: "W Wall" },
  { name: F.ceilingFinish, label: "Ceiling" },
  { name: F.floorKey, label: "Floor Key" },
  { name: F.baseKey, label: "Base Key" },
  { name: F.northKey, label: "N Wall Key" },
  { name: F.eastKey, label: "E Wall Key" },
  { name: F.southKey, label: "S Wall Key" },
  { name: F.westKey, label: "W Wall Key" },
  { name: F.ceilingKey, label: "Ceiling Key" },
  { name: F.department, label: "Department" },
  { name: F.occupancyType, label: "Occupancy Type" },
  { name: F.spaceType, label: "Space Type" },
  { name: F.description, label: "Description" },
  { name: F.remarks, label: "Remarks" },
  { name: F.perimeter, label: "Perimeter" },
  { name: F.grossArea, label: "Gross Area" },
];

/** The record format that keeps a Space's extra label fields, and its one text field. */
export const LABEL_FORMAT = "Space Label";
export const LABEL_FIELDS = "Fields";

/** trimmed, without empty names or repeats */
function cleanNames(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const t = n.trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** The parameter names Space `id` shows on its label beside the Show flags, in order. */
export function extraFields(doc: VwxDocument, id: string): string[] {
  const rec = doc.records(id).find((r) => !r.parametric && r.name === LABEL_FORMAT);
  const value = rec?.fields.find((f) => f.name === LABEL_FIELDS)?.value;
  return cleanNames(String(value ?? "").split(","));
}

/**
 * Sets the extra label fields of Space `id`: makes the record format if the drawing has none,
 * attaches it to the Space if it has none, and sets the field. Does not redraw the Space.
 */
export function setExtraFields(s: EditSession, id: string, fields: readonly string[]): void {
  const had = s.doc.recordFormats().find((f) => f.name === LABEL_FORMAT);
  const format = had ? had.format : s.createRecordFormat(LABEL_FORMAT, [{ name: LABEL_FIELDS, kind: "text", value: "" }]);
  if (!s.doc.records(id).some((r) => !r.parametric && r.format === format)) s.attachRecord([id], format);
  s.setRecordField(id, format, LABEL_FIELDS, cleanNames(fields).join(", "));
}

const labelName = (field: string): string => LABEL_FIELD_CHOICES.find((c) => c.name === field)?.label ?? field;

/** a number to the hundredth, trailing zeros dropped */
const trimmed = (v: number): string => String(Number(v.toFixed(2)));

/** An extra field's value as text, or "" when it is empty. The measured fields come from the figures now. */
function extraValue(sp: Space, field: string, ctx: LabelContext): string {
  const units = ctx.doc.info.units;
  const f = ctx.figures;
  switch (field) {
    case F.area:
      return formatArea(f.area, units);
    case F.grossArea:
      return f.grossArea ? formatArea(f.grossArea, units) : "";
    case F.perimeter:
      return f.perimeter ? formatLength(f.perimeter, units) : "";
    default:
      return sp.text(field).trim();
  }
}

/** The lines Space `sp`'s label shows, from the top down; none when it draws no label itself. */
export function labelLines(sp: Space, ctx: LabelContext): LabelLine[] {
  if (!sp.flag(F.showLabel)) return [];
  const units = ctx.doc.info.units;
  const own = ownUnits(units);
  const config = sp.text(F.labelConfig).toLowerCase();
  const wanted = (word: string): boolean => config.includes(word) || !config;
  const lines: LabelLine[] = [];

  const name = nameOf(sp);
  const number = sp.text(F.number).trim();
  if (name && wanted("name")) lines.push({ text: name, mm: NAME_MM, role: "name" });
  if (number && wanted("number")) lines.push({ text: number, mm: LINE_MM, role: "number" });

  const occupancy = occupancyOf(sp);
  if (sp.flag(F.showOccupancy) && occupancy) lines.push({ text: occupancy, mm: LINE_MM });
  if (sp.flag(F.showArea)) lines.push({ text: formatArea(ctx.figures.area, units), mm: LINE_MM });
  // the proposed area is a plain number in the drawing's own area unit
  const proposed = sp.num(F.proposedArea);
  if (sp.flag(F.showProposedArea) && proposed) lines.push({ text: `${trimmed(proposed)} ${own.areaName}`, mm: LINE_MM });
  if (sp.flag(F.showDimensions)) lines.push({ text: `${formatLength(ctx.figures.length, units)} x ${formatLength(ctx.figures.width, units)}`, mm: LINE_MM });
  if (sp.flag(F.showVolume)) lines.push({ text: `${trimmed(ctx.figures.volume / own.volume)} ${own.volumeName}`, mm: LINE_MM });

  for (const field of extraFields(ctx.doc, sp.id)) {
    if (!sp.has(field)) continue;
    const value = extraValue(sp, field, ctx);
    if (value) lines.push({ text: `${labelName(field)}: ${value}`, mm: LINE_MM });
  }
  return lines;
}

/** the anchor's alignment: Left and Right as they are named, anything else centred */
function alignOf(sp: Space): number {
  const v = sp.text(P.align).trim();
  return v === "Left" ? H_LEFT : v === "Right" ? H_RIGHT : H_CENTRE;
}

/** Degrees about `at`, counter-clockwise as Rodeo turns objects (frameOf). */
function turnAbout(p: Pt, at: Pt, degrees: number): Pt {
  const t = (degrees * Math.PI) / 180;
  const [c, n] = [Math.cos(t), Math.sin(t)];
  const [dx, dy] = [p.x - at.x, p.y - at.y];
  return { x: at.x + dx * c - dy * n, y: at.y + dx * n + dy * c };
}

/** The label of Space `sp` as shapes, its block of lines centred on `at` (the Space's own frame). */
export function labelParts(sp: Space, at: Pt, ctx: LabelContext): NewShape[] {
  const lines = labelLines(sp, ctx);
  if (!lines.length) return [];
  const turn = sp.num(P.textRotation);
  const hAlign = alignOf(sp);
  const rotate = (p: Pt): Pt => turnAbout(p, at, turn);
  const angle = turn ? { angle: turn } : {};

  // each line has a cell of its height times LINE_SPACING, the cells stacked from above `at` to below it
  const gaps = lines.map((l) => l.mm * ctx.scale * LINE_SPACING);
  let y = at.y + gaps.reduce((a, g) => a + g, 0) / 2;

  const parts: NewShape[] = [];
  lines.forEach((line, i) => {
    const h = line.mm * ctx.scale;
    const cy = y - gaps[i] / 2;
    y -= gaps[i];
    // the text's width, from its anchor: estimated, as text is not measured here
    const w = CHAR_WIDTH * h * [...line.text].length;
    const x0 = hAlign === H_LEFT ? at.x : hAlign === H_RIGHT ? at.x - w : at.x - w / 2;
    const x1 = x0 + w;
    if (line.role === "name" && sp.flag(F.underlineName)) {
      // just under the text's box, as wide as the text
      const uy = cy - h / 2;
      parts.push({ kind: "line", a: rotate({ x: x0, y: uy }), b: rotate({ x: x1, y: uy }) });
    }
    if (line.role === "number" && sp.flag(P.showNumberBox)) {
      // a closed polyline round the number, the margin on paper round the estimated text box
      const m = BOX_MARGIN_MM * ctx.scale;
      const [bx0, bx1, by0, by1] = [x0 - m, x1 + m, cy - h / 2 - m, cy + h / 2 + m];
      parts.push({
        kind: "polyline",
        points: [rotate({ x: bx0, y: by0 }), rotate({ x: bx1, y: by0 }), rotate({ x: bx1, y: by1 }), rotate({ x: bx0, y: by1 })],
        closed: true,
        vertices: ["corner", "corner", "corner", "corner"],
        radii: [0, 0, 0, 0],
      });
    }
    // the text last, over its box: a box given a fill (a room coloured by a field) would hide it otherwise
    parts.push({ kind: "text", at: rotate({ x: at.x, y: cy }), text: line.text, height: h, hAlign, vAlign: V_CENTRE, ...angle });
  });
  return parts;
}
