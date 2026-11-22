// Checks Space Planning's conversion of grouped spaces (convert.ts) and the listing of Space objects,
// on a blank drawing, with no page. Run from web/:
//   npx tsx src/app/space/commands.check.ts
// Two grouped spaces ("Space 7" and "Space 8", each a polygon with its labels and a Space Data record)
// and a Space Link between them are built in code; convertSpaces turns them into Space objects in one
// step. The Space Data format is made here with the fields spaces.ts's recordFormat gives it, since
// spaces.ts itself reads the page and can't be loaded in Node. spacesOn (spaces.ts) isn't reached:
// its group listing and the Space Tool need the page.

import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type EditSession, type ObjectInfo, type Pt, type RecordFieldSpec, type RecordValue } from "../../core/index.ts";
import type { SpaceGroup } from "../spaces.ts";
import { convertSpaces, spaceObjectsOn } from "./convert.ts";
import { F, measured, spaceOf } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b));

const s: EditSession = openVwx(blankDrawing("mm"));
const layer = s.createLayer("Rooms", "design", 50);

// the Space Data format, with the fields spaces.ts's recordFormat gives it
const text = (name: string): RecordFieldSpec => ({ name, kind: "text", value: "" });
const dimension = (name: string): RecordFieldSpec => ({ name, kind: "dimension", value: 0 });
const dataFormat = s.createRecordFormat("Space Data", [
  text("Space Number"),
  text("Space Type"),
  text("Space Name"),
  text("Occupant Type"),
  text("Occup. Organization"),
  text("Occupant Name"),
  text("Proposed Area"),
  { name: "Area", kind: "number", value: 0 },
  dimension("Perimeter"),
  dimension("Length"),
  dimension("Width"),
  dimension("Height"),
  text("Department"),
  { name: "Matrix Order", kind: "number", value: 0 },
]);

const RING_7: Pt[] = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 }];
const RING_8: Pt[] = [{ x: 5000, y: 0 }, { x: 9000, y: 0 }, { x: 9000, y: 2000 }, { x: 5000, y: 2000 }];

/** A grouped space as the old tool made it: a polygon and its label texts in a group named "Space …", its data in a Space Data record. */
function makeGroup(name: string, ring: Pt[], texts: string[], data: Record<string, RecordValue>): string {
  const poly = s.addObject(layer, { kind: "polygon", points: ring, closed: true }, undefined, { fillPattern: 1, fillBack: 3 });
  const at = ring[0];
  const kids = texts.map((t, i) => s.addObject(layer, { kind: "text", at: { x: at.x + 500, y: at.y + 1000 - i * 400 }, text: t, height: 250 }));
  const group = s.groupObjects([poly, ...kids]);
  s.setObjectName(group, name);
  s.attachRecord([group], dataFormat);
  s.setRecordFields(dataFormat, [{ id: group, fields: data }]);
  return group;
}

const [g7, g8, link] = s.batch(() => {
  const a = makeGroup("Space 7", RING_7, ["Kitchen", "12 m²"], {
    "Space Number": "7",
    "Space Name": "Kitchen",
    "Occupant Type": "Staff",
    Department: "Ops",
    "Occup. Organization": "Old Org",
    "Proposed Area": "12.5",
    "Matrix Order": 3,
    Height: 2400,
  });
  const b = makeGroup("Space 8", RING_8, ["Hall"], { "Space Number": "8", "Space Name": "Hall", "Occup. Organization": "Facilities", "Matrix Order": 1, Height: 2400 });
  const specs = [
    { name: "Strength", type: 3, value: 5 },
    { name: "From Space", type: 4, value: "" },
    { name: "To Space", type: 4, value: "" },
    { name: "From Id", type: 4, value: a },
    { name: "To Id", type: 4, value: b },
  ];
  const l = s.addPluginObject(layer, "Space Link", specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), { x: 0, y: 0 }, 0);
  return [a, b, l] as const;
});

/** a grouped space as spaces.ts lists one: the group, its polygon and its texts */
function groupOf(id: string, ring: Pt[]): SpaceGroup {
  const kids = s.doc.objects(layer).filter((o) => o.parentId === id);
  const boundary = kids.find((o) => o.shape?.kind === "polygon") as ObjectInfo;
  return { kind: "group", obj: s.doc.object(id) as ObjectInfo, boundary, ring: ring.map((p) => ({ ...p })), texts: kids.filter((o) => o.shape?.kind === "text") };
}

check(s.doc.object(g7)?.kind === "group" && s.doc.object(g8)?.kind === "group", "two grouped spaces are on the drawing");
check(spaceObjectsOn(s.doc, layer).length === 0, "no Space objects before the conversion");

const ids = s.batch(() => convertSpaces(s, [groupOf(g7, RING_7), groupOf(g8, RING_8)], {}));
const [n7, n8] = ids;
check(ids.length === 2 && n7 !== g7 && n8 !== g8, "each grouped space converts to one new Space object");
check(s.doc.object(g7) === null && s.doc.object(g8) === null, "the groups are gone");
const listed = spaceObjectsOn(s.doc, layer);
check(listed.length === 2 && listed.every((sp) => sp.kind === "object"), "spaceObjectsOn lists both as Space objects");

const sp7 = spaceOf(s.doc, n7);
check(!!sp7, "the new object is a Space");
check(sp7?.text(F.number) === "7" && sp7?.text(F.name) === "Kitchen", `its number and name carry (${sp7?.text(F.number)}, ${sp7?.text(F.name)})`);
check(sp7?.text(F.occupancyType) === "Staff", "its occupant type carries");
check(sp7?.text(F.department) === "Ops", "its department wins over the old organization");
check(sp7?.num(F.matrixOrder) === 3, "its matrix order carries");
check(sp7?.num(F.height) === 2400, "its height carries");
check(sp7 !== null && near(measured(sp7, F.area, "Millimeters"), 12e6), `its area is unchanged, 12 m² (${sp7 ? measured(sp7, F.area, "Millimeters") : "none"})`);
check(sp7?.flag(F.showLabel) === true && sp7?.flag(F.showArea) === true, "its label shows, with the area, as the group had texts");
const sp8 = spaceOf(s.doc, n8);
check(sp8?.text(F.department) === "Facilities", "a group with no department takes its organization as the department");
check(sp8?.flag(F.showLabel) === true && sp8?.flag(F.showArea) === false, "a group with only a name text shows its label, with no area");

const kids7 = s.doc.objects(layer).filter((o) => o.parentId === n7);
const texts7 = kids7.map((o) => (o.shape?.kind === "text" ? o.shape.text : "")).filter(Boolean);
check(texts7.includes("Kitchen") && texts7.includes("7"), `the new object draws its label (${texts7.join(", ")})`);
const boundary7 = kids7.find((o) => o.shape?.kind === "polygon");
check(!!boundary7 && boundary7.attrs?.fillPattern === 1 && boundary7.attrs?.fillBack === 3, "its boundary keeps the group's fill");
check(s.doc.objects(layer).filter((o) => o.parentId === null && o.kind === "text").length === 0, "no label text of a group is left loose on the layer");

const data7 = s.doc.records(n7).find((r) => r.name === "Space Data");
check(!!data7 && data7.fields.find((f) => f.name === "Space Number")?.value === "7", "the Space Data record is attached to the new object");
check(data7?.fields.find((f) => f.name === "Occup. Organization")?.value === "Old Org" && data7?.fields.find((f) => f.name === "Proposed Area")?.value === "12.5", "and keeps all its values");

const linkRec = s.doc.records(link).find((r) => r.name === "Space Link");
check(linkRec?.fields.find((f) => f.name === "From Id")?.value === n7 && linkRec?.fields.find((f) => f.name === "To Id")?.value === n8, "the Space Link now joins the new objects");

// one undo restores the groups and the link
s.undo();
check(s.doc.object(g7)?.kind === "group" && s.doc.object(g8)?.kind === "group", "one undo brings back both groups");
check(spaceObjectsOn(s.doc, layer).length === 0, "and removes the Space objects");
const back = s.doc.records(link).find((r) => r.name === "Space Link");
check(back?.fields.find((f) => f.name === "From Id")?.value === g7, "and the link points at the groups again");

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
