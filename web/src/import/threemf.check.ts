// Checks the 3MF reader under Node. Run from web/:
//   npx tsx src/import/threemf.check.ts
// Each package is built here, in memory, as a stored zip of XML parts: units, build transforms (a
// translation with a quarter turn), a mirrored placement (its winding put back), components placed
// twice, the production extension's p:path into a second model part, base materials and colour groups
// per object and per triangle, a support object left out, and the packages that must fail.

import { parse3mf } from "./threemf.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

/** Whether `f` throws an Error whose message has `text`. */
function throwsWith(f: () => unknown, text: string): boolean {
  try {
    f();
    return false;
  } catch (e) {
    return e instanceof Error && e.message.includes(text);
  }
}

/** A stored (uncompressed) zip of the named text files. */
function zip(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  const u16 = (v: number): number[] => [v & 255, (v >> 8) & 255];
  const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0)]);
    chunks.push(local, nameBytes, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(at)]), nameBytes);
    at += local.length + nameBytes.length + data.length;
  }
  const cdStart = at;
  let cdLength = 0;
  for (const c of central) {
    chunks.push(c);
    cdLength += c.length;
  }
  chunks.push(new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(cdLength), ...u32(cdStart), ...u16(0)]));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

const RELS = (target: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="${target}" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;

/** A model part with the given resources and build, under the core namespace. */
const MODEL = (unit: string | null, body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"${unit ? ` unit="${unit}"` : ""}>${body}</model>`;

/** A triangle object: vertices (0,0,0), (1,0,0), (0,1,0) and one face, with optional attributes. */
const TRI = (id: number, extra = ""): string =>
  `<object id="${id}" type="model"${extra}><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;

/** The package of one root model part, with any other parts. */
const pack = (root: string, extra: Record<string, string> = {}): Uint8Array => zip({ "_rels/.rels": RELS("/3D/3dmodel.model"), "3D/3dmodel.model": root, ...extra });

/** Every corner of a file's parts, as x, y, z triples in part order. */
/** The z component of a triangle's normal from its corners in order (positive: it faces up). */
function normalZ(f: number[]): number {
  const ax = f[3] - f[0];
  const ay = f[4] - f[1];
  const bx = f[6] - f[0];
  const by = f[7] - f[1];
  return ax * by - ay * bx;
}

// ---- units ------------------------------------------------------------------------------------------

for (const [unit, mm] of [["inch", 25.4], ["meter", 1000], ["millimeter", 1], [null, 1]] as const) {
  const f = parse3mf(pack(MODEL(unit, `<resources>${TRI(1)}</resources><build><item objectid="1"/></build>`)));
  check(f.frame?.mm === mm && f.frame?.yUp === false, `unit ${unit ?? "(none, so millimetres)"}: frame gives ${mm} mm per unit, z up`);
  check(near(f.parts[0].faces[0][3], 1), `unit ${unit ?? "(none)"}: the vertices stay in the file's units`);
}

// ---- build transform: a translation with a quarter turn about z ------------------------------------

{
  // x' = -y + 10, y' = x + 20, z' = z + 30: the point (1, 2, 3) lands at (8, 21, 33)
  const f = parse3mf(pack(MODEL("millimeter", `<resources>${TRI(1)}</resources><build><item objectid="1" transform="0 1 0 -1 0 0 0 0 1 10 20 30"/></build>`)));
  const v = f.parts[0].faces[0];
  check(near(v[0], 10) && near(v[1], 20) && near(v[2], 30), "build transform: origin goes to (10, 20, 30)");
  check(near(v[3], 10) && near(v[4], 21) && near(v[5], 30), "build transform: x axis (1, 0, 0) goes to (10, 21, 30)");
  check(near(v[6], 9) && near(v[7], 20) && near(v[8], 30), "build transform: y axis (0, 1, 0) goes to (9, 20, 30)");
}

// ---- mirrored placement keeps outward winding -----------------------------------------------------

{
  const f = parse3mf(pack(MODEL("millimeter", `<resources>${TRI(1)}</resources><build><item objectid="1" transform="-1 0 0 0 1 0 0 0 1 0 0 0"/></build>`)));
  const plain = parse3mf(pack(MODEL("millimeter", `<resources>${TRI(1)}</resources><build><item objectid="1"/></build>`)));
  check(normalZ(plain.parts[0].faces[0]) > 0 && normalZ(f.parts[0].faces[0]) > 0, "mirrored placement: the triangle still faces up, as the unmirrored one does");
}

// ---- components: object 2 placed twice inside object 1 --------------------------------------------

{
  const body = `<resources>${TRI(2)}<object id="1" type="model"><components><component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><component objectid="2" transform="1 0 0 0 1 0 0 0 1 100 0 0"/></components></object></resources><build><item objectid="1"/></build>`;
  const f = parse3mf(pack(MODEL("millimeter", body)));
  const faces = f.parts.flatMap((p) => p.faces);
  check(faces.length === 2, `components: two placements give two triangles (got ${faces.length})`);
  check(faces.length === 2 && near(faces[1][0], 100), "components: the second placement is moved 100 along x");
}

// ---- production extension: p:path into a second model part, ids per part ---------------------------

{
  // the root's object 1 is a big square; the build item names object 1 of the part in /3D/Objects
  const root = MODEL(
    "millimeter",
    `<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="9" y="0" z="0"/><vertex x="0" y="9" z="0"/><vertex x="9" y="9" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="1" v2="3" v3="2"/></triangles></mesh></object></resources>` +
      `<build><item objectid="1" p:path="/3D/Objects/object_1.model"/></build>`,
  );
  const part = MODEL("millimeter", `<resources>${TRI(1)}</resources>`);
  const f = parse3mf(pack(root, { "3D/Objects/object_1.model": part }));
  check(f.parts.length === 1 && f.parts[0].faces.length === 1, "production: the build item draws object 1 of the named part (one triangle), not the root's object 1 (two)");
}

// ---- base materials and colour groups, per object and per triangle --------------------------------

{
  const body =
    `<resources>` +
    `<basematerials id="5"><base name="Red" displaycolor="#FF0000FF"/><base name="Blue" displaycolor="#0000FFFF"/></basematerials>` +
    `<m:colorgroup id="6"><m:color color="#00FF00"/><m:color color="#FFFF0080"/></m:colorgroup>` +
    `<object id="1" type="model" pid="5" pindex="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="1" y="1" z="0"/></vertices>` +
    `<triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="1" v2="3" v3="2" pid="6" p1="1"/></triangles></mesh></object>` +
    `</resources><build><item objectid="1"/></build>`;
  const f = parse3mf(pack(MODEL("millimeter", body)));
  const byName = f.parts;
  const blue = byName.find((p) => p.color && near(p.color.b, 1) && near(p.color.r, 0));
  check(byName.length === 2, `colours: one object with two colours gives two parts (got ${byName.length})`);
  check(!!blue && blue.faces.length === 1, "colours: the object's default colour (pindex 1, blue) is on its triangle with no colour of its own");
  const yellow = byName.find((p) => p.color && near(p.color.r, 1) && near(p.color.g, 1) && near(p.color.b, 0));
  check(!!yellow && near(yellow.opacity ?? 1, 128 / 255, 1e-3), "colours: a triangle's own colour group entry (#FFFF0080) gives yellow at about half opacity");
  check(new Set(byName.map((p) => p.name)).size === byName.length, "colours: an object split into colours gives its parts different names");
}

// ---- support objects are left out ---------------------------------------------------------------

{
  const body = `<resources>${TRI(1)}<object id="2" type="support"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/><item objectid="2"/></build>`;
  const f = parse3mf(pack(MODEL("millimeter", body)));
  check(f.skipped.support === 1, `support: a support object is left out and counted (skipped ${JSON.stringify(f.skipped)})`);
  check(f.parts.flatMap((p) => p.faces).length === 1, "support: only the model's one triangle is drawn");
  check(f.parts.every((p) => p.group !== undefined), "support: with two build items the parts are grouped under the item's name");
}

// ---- a cycle and a bad face are skipped, not thrown --------------------------------------------------

{
  const body = `<resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="0" v3="2"/><triangle v1="0" v2="1" v3="9"/></triangles></mesh><components><component objectid="1"/></components></object></resources><build><item objectid="1"/></build>`;
  const f = parse3mf(pack(MODEL("millimeter", body)));
  check(f.parts.flatMap((p) => p.faces).length === 1, "bad faces: a repeated corner and an index out of range are left out (one face kept)");
  check((f.skipped["bad face"] ?? 0) === 2 && (f.skipped.component ?? 0) === 1, `bad faces and a self-component are counted (skipped ${JSON.stringify(f.skipped)})`);
}

// ---- failures ------------------------------------------------------------------------------------

check(throwsWith(() => parse3mf(zip({ "readme.txt": "hello" })), "not a 3MF file (no 3D model part in the package)"), "no model part: the package says so");
check(throwsWith(() => parse3mf(new TextEncoder().encode("not a zip")), "not a 3MF file"), "not a zip: refused as not a 3MF file");
check(throwsWith(() => parse3mf(pack(MODEL("millimeter", `<resources></resources>`))), "no meshes in this 3MF file"), "an empty model: no meshes");
{
  const support = `<object id="1" type="support"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="5" y="0" z="0"/><vertex x="0" y="5" z="0"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>`;
  check(throwsWith(() => parse3mf(pack(MODEL("millimeter", `<resources>${support}</resources><build><item objectid="1"/></build>`))), "no meshes in this 3MF file"), "only support objects: no meshes");
}
{
  // the fallback model part name when _rels/.rels is missing
  const f = parse3mf(zip({ "3D/3dmodel.model": MODEL("millimeter", `<resources>${TRI(1)}</resources><build><item objectid="1"/></build>`) }));
  check(f.parts.length === 1, "no _rels/.rels: the model part at 3D/3dmodel.model is read");
}

console.log(failures === 0 ? "all checks pass" : `${failures} failed`);
if (failures) process.exit(1);
