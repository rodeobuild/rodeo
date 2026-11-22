// Checks Object Info's layout of Space objects (driverLayout.ts, the pure part of driver.ts), with no
// page and no drawing. Run from web/:
//   npx tsx src/app/space/driver.check.ts
// Prints one ok or FAIL line per check and exits 1 on any FAIL.

import { spaceFields } from "./fieldTable.ts";
import { isComputed, isHidden, spaceChoices, spaceLabel, spaceLayout, SPACE_GROUPS } from "./driverLayout.ts";
import { F, MIRRORS } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const names = (year: number): string[] => spaceFields(year).map((f) => f.name);
const params = (layout: ReturnType<typeof spaceLayout>): string[] => layout.flatMap((w) => (w.kind === "param" && w.field !== undefined ? [w.field] : []));
const dividers = (layout: ReturnType<typeof spaceLayout>): string[] => layout.flatMap((w) => (w.kind === "divider" ? [w.label] : []));

const f2026 = names(2026);
const f2023 = names(2023);
const set2026 = new Set(f2026);

// the groups name fields that exist
const grouped = SPACE_GROUPS.flatMap((g) => g.fields);
const missing = grouped.filter((field) => !set2026.has(field));
check(missing.length === 0, `every grouped field exists in the 2026 format${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
check(new Set(grouped).size === grouped.length, "no field is in two groups");
check(SPACE_GROUPS.map((g) => g.title).join(" / ") === "Space / Size / Heights / Finishes / Boundary / 3D / Label", "groups in Object Info's order");

// the 2026 layout: every field once, the hidden ones out, the rest under Other Parameters
const layout26 = spaceLayout(f2026);
const rows26 = params(layout26);
check(new Set(rows26).size === rows26.length, "no field appears twice in the 2026 layout");
check(Object.values(MIRRORS).flat().every((field) => !rows26.includes(field)), "the mirrored duplicates are not shown");
check(!rows26.includes("ControlPoint01X") && !rows26.includes("space_cw_uniq_id") && !rows26.includes("11_Number"), "handles, the Vectorworks id and 11_ parameters are hidden");
check(rows26.includes("Show Dims") && rows26.includes("11_Display Stamp"), "a label parameter is shown, 11_Display Stamp included (its group lists it)");
const other26 = rows26.filter((field) => !grouped.includes(field));
check(other26.every((field) => !isHidden(field)), "no hidden field is under Other Parameters (handles, internal and mirrored parameters)");
const hiddenCount = f2026.filter((field) => !grouped.includes(field) && isHidden(field)).length;
// the plain Name and Occupancy stand behind the ones Vectorworks shows, which take their rows
const behind: string[] = [F.name, F.occupancy];
check(rows26.length + hiddenCount === f2026.length - behind.length, `every 2026 field is shown, hidden or stood for (${rows26.length} shown, ${hiddenCount} hidden, ${behind.length} stood for, ${f2026.length} in all)`);
check(rows26.includes(F.nameShown) && rows26.includes(F.occupancyShown) && !rows26.includes(F.name) && !rows26.includes(F.occupancy), "the name and occupancy rows are the ones Vectorworks shows");
check(spaceLabel(F.nameShown) === "Name" && spaceLabel(F.occupancyShown) === "Occupancy", "and read Name and Occupancy");
check(params(spaceLayout(["Name", "Number", "Occupancy"])).join() === "Name,Number,Occupancy", "a format without the shown ones lays out the plain Name and Occupancy");
check(dividers(layout26).at(-1) === "Other Parameters" && other26.length > 0, `the rest are under Other Parameters (${other26.length} fields)`);

// a 2023 Space: its 369 fields lay out without the 2024+ ones
const layout23 = spaceLayout(f2023);
const rows23 = params(layout23);
const newer = f2026.filter((field) => !new Set(f2023).has(field));
check(spaceFields(2023).length === 369, "a 2023 format has 369 fields");
check(rows23.every((field) => !newer.includes(field)), `a 2023 layout has none of the ${newer.length} fields only 2024+ have`);
check(new Set(rows23).size === rows23.length && rows23.length > 0, `a 2023 layout shows each of its ${rows23.length} fields once`);
check(grouped.filter((field) => new Set(f2023).has(field) && !behind.includes(field)).every((field) => rows23.includes(field)), "every grouped field the 2023 format has is in its layout");

// a layout for a Space with only some fields (a plain format) leaves the others out
const few = spaceLayout(["Name", "Area", "Extrusion Height", "Mystery"]);
check(JSON.stringify(params(few)) === JSON.stringify(["Name", "Area", "Extrusion Height", "Mystery"]), "a Space with few fields lists what it has, in group order, with the rest under Other Parameters");
check(dividers(few).join("|") === "Space|Size|Heights|Other Parameters", `dividers only for the groups it has (${dividers(few).join("|")})`);

// labels
check(spaceLabel("Perim") === "Perimeter" && spaceLabel("Gross Perim") === "Gross Perimeter", "Perim and Gross Perim read Perimeter and Gross Perimeter");
check(spaceLabel("GSA_Occ_Org_Name") === "Department" && spaceLabel("Extrusion Height") === "Height", "the department and the height read Department and Height");
check(spaceLabel("Floor2Floor Height") === "Floor to Floor Height" && spaceLabel("Finish Floor Elev") === "Finish Floor Elevation", "the floor heights read in full");
check(spaceLabel("Base Material") === "Base Finish" && spaceLabel("Ceiling Material") === "Ceiling Finish", "the finishes read Base and Ceiling Finish");
check(spaceLabel("Auto-Boundary") === "Follow Walls" && spaceLabel("Show Poly") === "Show 2D Boundary" && spaceLabel("Show 3D Detail") === "Show 3D Volume", "the boundary and 3D labels");
check(spaceLabel("11_Display Stamp") === "Show Label" && spaceLabel("Config") === "Label Shows" && spaceLabel("Show Dims") === "Show Dimensions", "the label labels");
check(spaceLabel("Name") === undefined, "a name Object Info has no label for is left to the field name");

// computed fields
for (const field of ["Area", "Gross Area", "Perim", "Gross Perim", "Volume", "Gross Volume", "Room Dimensions", "Length", "Width", "MeasuredNetArea"]) check(isComputed(field), `${field} is only shown`);
check(!isComputed("Name") && !isComputed("Extrusion Height") && !isComputed("Proposed Area"), "a typed field is not shown as measured");

// popups: the values the demo files hold
check(JSON.stringify(spaceChoices("Config")) === JSON.stringify([{ value: "Name and Number", label: "Name and Number" }]), "Config offers the one value the demo files hold");
check(JSON.stringify(spaceChoices("Space Type")) === JSON.stringify([{ value: "Room", label: "Room" }]), "Space Type offers Room, the demo files' value");
check(spaceChoices("Name") === undefined, "a text field has no popup");

console.log(failures === 0 ? "all driver layout checks passed" : `${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
