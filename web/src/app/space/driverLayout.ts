// The pure parts of the Space driver (driver.ts): Object Info's layout of a Space's parameters, the
// labels Vectorworks' Object Info reads them by, which measured fields are only shown, and the
// choices of its popups as the demo files hold them. No page code, so driver.check.ts runs in Node.

import type { PluginWidget } from "../ext.ts";
import { F, MIRRORS } from "./model.ts";

/** A divider's title and the parameters under it, in the order Object Info shows them. */
export const SPACE_GROUPS: readonly { readonly title: string; readonly fields: readonly string[] }[] = [
  { title: "Space", fields: [F.nameShown, F.name, F.number, F.spaceType, F.occupancyShown, F.occupancy, F.occupancyType, F.department, F.description, F.remarks, F.matrixOrder] },
  { title: "Size", fields: [F.area, F.grossArea, F.perimeter, F.grossPerimeter, F.volume, F.grossVolume, F.roomDimensions, F.proposedArea] },
  { title: "Heights", fields: [F.height, F.floorToFloor, F.floorElevation] },
  {
    title: "Finishes",
    fields: [F.floorFinish, F.floorKey, F.baseFinish, F.baseKey, F.northFinish, F.northKey, F.eastFinish, F.eastKey, F.southFinish, F.southKey, F.westFinish, F.westKey, F.ceilingFinish, F.ceilingKey, F.finishRemarks],
  },
  { title: "Boundary", fields: [F.autoBoundary, F.showBoundary, F.boundaryClass] },
  { title: "3D", fields: [F.show3d, F.volumeClass] },
  { title: "Label", fields: [F.showLabel, F.labelConfig, F.showArea, F.showDimensions, F.showOccupancy, F.showVolume, F.showProposedArea, F.underlineName] },
];

/** What Object Info calls the parameters whose names say less (the Vectorworks names stay in the file). */
const LABELS: Readonly<Record<string, string>> = {
  [F.nameShown]: "Name",
  [F.occupancyShown]: "Occupancy",
  [F.department]: "Department",
  [F.height]: "Height",
  [F.floorToFloor]: "Floor to Floor Height",
  [F.floorElevation]: "Finish Floor Elevation",
  [F.baseFinish]: "Base Finish",
  [F.ceilingFinish]: "Ceiling Finish",
  [F.perimeter]: "Perimeter",
  [F.grossPerimeter]: "Gross Perimeter",
  [F.autoBoundary]: "Follow Walls",
  [F.showBoundary]: "Show 2D Boundary",
  [F.boundaryClass]: "Boundary Class",
  [F.show3d]: "Show 3D Volume",
  [F.volumeClass]: "Volume Class",
  [F.showLabel]: "Show Label",
  [F.labelConfig]: "Label Shows",
  [F.showDimensions]: "Show Dimensions",
};

/** The measured fields: Rodeo works them out from the boundary, so Object Info only shows them. */
const MEASURED: ReadonlySet<string> = new Set([
  F.area,
  F.grossArea,
  F.perimeter,
  F.grossPerimeter,
  F.volume,
  F.grossVolume,
  F.roomDimensions,
  F.length,
  F.width,
  "MeasuredNetArea",
  "MeasuredNetAreaNum",
]);

/** Parameters Object Info leaves out of Other Parameters: the handles, the mirrors of others and the internal ones. */
const HIDDEN = /^(ControlPoint\d+[XY]|__|11_|GraphicAttr_|Label\d_|space_cw_uniq_id)/;
const MIRROR_FIELDS: ReadonlySet<string> = new Set(Object.values(MIRRORS).flat());

/** Whether a parameter is hidden from Object Info: a handle, an internal one, or a duplicate of another. */
export function isHidden(field: string): boolean {
  return HIDDEN.test(field) || MIRROR_FIELDS.has(field);
}

/** Object Info's label for a parameter, or undefined for its own name. */
export function spaceLabel(field: string): string | undefined {
  return LABELS[field];
}

/** the Label group's button that chooses the label's other fields */
export const LABEL_FIELDS_BUTTON = 9001;

/** Whether a parameter is worked out from the boundary and shown, not typed. */
export function isComputed(field: string): boolean {
  return MEASURED.has(field);
}

/** The popups' choices the demo files hold (measured over the four demo Spaces files: every value of each choice field). */
const CHOICES: Readonly<Record<string, readonly string[]>> = {
  [F.spaceType]: ["Room"],
  [F.labelConfig]: ["Name and Number"],
};

/** A popup's choices for a parameter, or undefined when it has none of its own. */
export function spaceChoices(field: string): readonly { readonly value: string; readonly label: string }[] | undefined {
  return CHOICES[field]?.map((value) => ({ value, label: value }));
}

/**
 * Object Info's layout of a Space whose parameters are `fields`: a divider and rows for each group's
 * parameters the Space has, then the rest under Other Parameters, less the hidden ones.
 */
export function spaceLayout(fields: readonly string[]): PluginWidget[] {
  const have = new Set(fields);
  const out: PluginWidget[] = [];
  const listed = new Set<string>();
  // the name and occupancy Vectorworks shows stand for the plain ones where the Space has them (model.ts)
  if (have.has(F.nameShown)) listed.add(F.name);
  if (have.has(F.occupancyShown)) listed.add(F.occupancy);
  let n = 0;
  for (const group of SPACE_GROUPS) {
    const rows = group.fields.flatMap((field): PluginWidget[] => {
      if (!have.has(field) || listed.has(field)) return [];
      listed.add(field);
      return [{ id: ++n, kind: "param", field, label: "", level: 0 }];
    });
    if (rows.length) out.push({ id: ++n, kind: "divider", label: group.title, level: 0 }, ...rows);
    if (rows.length && group.title === "Label") out.push({ id: LABEL_FIELDS_BUTTON, kind: "button", label: "Label Fields…", level: 0 });
  }
  const rest = fields.filter((field) => !listed.has(field) && !isHidden(field));
  if (rest.length) out.push({ id: ++n, kind: "divider", label: "Other Parameters", level: 0 }, ...rest.map((field): PluginWidget => ({ id: ++n, kind: "param", field, label: "", level: 0 })));
  return out;
}
