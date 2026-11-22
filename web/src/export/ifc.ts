// The 3D model as IFC (IFC4, STEP text), for BIM tools such as ArchiCAD, Revit, Solibri, BIMcollab
// or another Vectorworks. Each design layer becomes a storey of one site and building, placed at
// the layer's elevation (its Elevation attribute too); each object an element of the class its
// plug-in name suggests (a wall, slab, roof, door, window, stair, column, beam or railing) or a
// building element proxy, named as the object or its plug-in. Its geometry is the triangles the 3D
// view shows, as tessellated face sets coloured as there, in the drawing's millimetres, z up, from
// its storey's placement. Its records go with it as property sets, named as the record (a plug-in's
// parameters as the plug-in): one single value per named field, text as IfcLabel, yes or no as
// IfcBoolean, any number as IfcReal, units left out. Materials and openings are not carried over.
// A Space object is an IfcSpace, aggregated under its storey (a spatial element, not contained in it):
// its body is its 3D volume when that is shown, else a prism of its boundary from its floor up by its
// height; its Pset_SpaceCommon, Qto_SpaceBaseQuantities (m², m³, mm) and Pset_SpaceCoveringRequirements
// are written from its parameters, besides its records as property sets.

import earcut from "earcut";
import type { Mesh3D, RecordField, VwxDocument } from "../core/types.ts";
import { F, measured, nameOf, netBoundaryOf, type Space, spacesOnLayer } from "../app/space/model.ts";
import { prismFaces, volumeSpan } from "../app/space/volume.ts";

/** IFC's own base 64 digits for a compressed GlobalId. */
const B64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** A 22-character IFC GlobalId from a UUID's 32 hex digits (random when it has none). */
export function ifcGuid(uuid?: string): string {
  let hex = (uuid ?? "").replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 32) hex = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  // the first 2 bits make one digit, then each 6 bits another
  let n = BigInt(`0x${hex}`);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out = B64[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

/** A STEP string: quotes doubled, backslashes escaped, anything past ASCII as \X2\ hex. */
export function stepString(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (c >= 0x20 && c < 0x7f) out += ch;
    else if (c <= 0xffff) out += `\\X2\\${c.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += `\\X4\\${c.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

/** A STEP real: always with a point, to a ten-thousandth (1.E+21 for an exponent). */
function real(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  const s = String(Object.is(r, -0) ? 0 : r);
  if (!s.includes("e")) return s.includes(".") ? s : `${s}.`;
  return s.includes(".") ? s.replace("e", "E") : s.replace("e", ".E");
}

/** A record field's value as IFC's typed value: IfcBoolean, IfcLabel or IfcReal; $ when it has none. */
function ifcValue(f: RecordField): string {
  const v = f.value;
  if (typeof v === "boolean") return `IFCBOOLEAN(.${v ? "T" : "F"}.)`;
  // a field openvwx can't read is ""
  if (typeof v === "string") return f.kind === "other" ? "$" : `IFCLABEL(${stepString(v)})`;
  return Number.isFinite(v) ? `IFCREAL(${real(v)})` : "$";
}

/** IFC classes for objects whose plug-in names say what they are; attribute counts after Tag differ. */
const CLASSES: readonly { readonly test: RegExp; readonly entity: string; readonly extra: number }[] = [
  { test: /curtain/i, entity: "IFCCURTAINWALL", extra: 1 },
  { test: /wall/i, entity: "IFCWALL", extra: 1 },
  { test: /slab|floor/i, entity: "IFCSLAB", extra: 1 },
  { test: /roof/i, entity: "IFCROOF", extra: 1 },
  { test: /door/i, entity: "IFCDOOR", extra: 5 },
  { test: /window/i, entity: "IFCWINDOW", extra: 5 },
  { test: /stair/i, entity: "IFCSTAIR", extra: 1 },
  { test: /column|pillar/i, entity: "IFCCOLUMN", extra: 1 },
  { test: /beam|joist/i, entity: "IFCBEAM", extra: 1 },
  { test: /railing|handrail/i, entity: "IFCRAILING", extra: 1 },
];
const WALL_TYPE = 68;

/** The triangles (9 floats each, mm, z up) of a prism over `ring` from `z0` up to `z1`: each of its faces cut by earcut. */
function prismTriangles(ring: readonly { x: number; y: number }[], z0: number, z1: number): number[] {
  const out: number[] = [];
  for (const face of prismFaces(ring, z0, z1)) {
    const flat: number[] = [];
    for (let k = 0; k < face.length; k += 3) flat.push(face[k], face[k + 1]);
    const index = earcut(flat);
    for (let t = 0; t < index.length; t += 3)
      for (const k of index.slice(t, t + 3)) out.push(face[3 * k], face[3 * k + 1], face[3 * k + 2]);
  }
  return out;
}

/** The IFC file of the meshes on `layerIds`, as text. */
export function exportIfc(doc: VwxDocument, layerIds: ReadonlySet<string>, fileName: string, now = new Date()): string {
  const lines: string[] = [];
  let next = 1;
  const add = (entity: string): string => {
    const id = `#${next++}`;
    lines.push(`${id}=${entity};`);
    return id;
  };
  const origin = add("IFCCARTESIANPOINT((0.,0.,0.))");
  const placement = add(`IFCAXIS2PLACEMENT3D(${origin},$,$)`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${placement},$)`);
  const body = add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`);
  const units = add(
    `IFCUNITASSIGNMENT((${[
      add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"),
      add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
      add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
      add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
    ].join(",")}))`,
  );
  const title = fileName.replace(/\.[^.]*$/, "") || "Project";
  const project = add(`IFCPROJECT('${ifcGuid()}',$,${stepString(title)},$,$,$,$,(${context}),${units})`);
  const sitePlace = add(`IFCLOCALPLACEMENT($,${placement})`);
  const site = add(`IFCSITE('${ifcGuid()}',$,'Site',$,$,${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPlace = add(`IFCLOCALPLACEMENT(${sitePlace},${placement})`);
  const building = add(`IFCBUILDING('${ifcGuid()}',$,${stepString(title)},$,$,${buildingPlace},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${project},(${site}))`);
  add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${site},(${building}))`);

  // the Space objects on these layers: each is an IfcSpace, its volume (if shown) its children's meshes
  const spaces = new Map<string, Space>();
  const spacesOn = new Map<string, Space[]>();
  for (const layerId of layerIds) {
    const list = spacesOnLayer(doc, layerId);
    if (!list.length) continue;
    spacesOn.set(layerId, list);
    for (const sp of list) spaces.set(sp.id, sp);
  }

  // each object's pieces (one per colour), by layer in model order; a Space's volume is filed under the Space
  const byLayer = new Map<string, Map<string, Mesh3D[]>>();
  for (const m of doc.model3d()) {
    if (!layerIds.has(m.layerId) || m.triangles.length < 9) continue;
    let objects = byLayer.get(m.layerId);
    if (!objects) byLayer.set(m.layerId, (objects = new Map()));
    const parent = doc.object(m.objectId)?.parentId;
    const key = parent && spaces.has(parent) ? parent : m.objectId;
    const pieces = objects.get(key);
    if (pieces) pieces.push(m);
    else objects.set(key, [m]);
  }
  const styles = new Map<string, string>();
  const styleOf = (m: Mesh3D): string => {
    const key = `${m.color}/${m.opacity}`;
    let s = styles.get(key);
    if (!s) {
      const n = parseInt(m.color.replace("#", "").slice(0, 6), 16) || 0;
      const rgb = add(`IFCCOLOURRGB($,${real(((n >> 16) & 255) / 255)},${real(((n >> 8) & 255) / 255)},${real((n & 255) / 255)})`);
      const shading = add(`IFCSURFACESTYLESHADING(${rgb},${real(1 - m.opacity)})`);
      s = add(`IFCSURFACESTYLE($,.BOTH.,(${shading}))`);
      styles.set(key, s);
    }
    return s;
  };
  // an object's records as property sets, each linked to its element: one per record with a named field
  const propertySets = (objectId: string, element: string): void => {
    for (const record of doc.records(objectId)) {
      const props: string[] = [];
      for (const f of record.fields) {
        if (f.name) props.push(add(`IFCPROPERTYSINGLEVALUE(${stepString(f.name)},$,${ifcValue(f)},$)`));
      }
      if (!props.length) continue;
      const set = add(`IFCPROPERTYSET('${ifcGuid()}',$,${stepString(record.name || "Record")},$,(${props.join(",")}))`);
      add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${element}),${set})`);
    }
  };
  /** An object's pieces as one face set of `t`'s triangles (9 floats each, absolute z, the storey at `elevation`); null when none is a face. */
  const tessellate = (t: ArrayLike<number>, elevation: number): string | null => {
    const at = new Map<string, number>();
    const coords: string[] = [];
    const faces: string[] = [];
    for (let i = 0; i < t.length; i += 9) {
      const corner: number[] = [];
      for (let k = 0; k < 9; k += 3) {
        const p = `(${real(t[i + k])},${real(t[i + k + 1])},${real(t[i + k + 2] - elevation)})`;
        let n = at.get(p);
        if (n === undefined) {
          coords.push(p);
          n = coords.length;
          at.set(p, n);
        }
        corner.push(n);
      }
      if (corner[0] !== corner[1] && corner[1] !== corner[2] && corner[0] !== corner[2]) faces.push(`(${corner.join(",")})`);
    }
    if (faces.length === 0) return null;
    const points = add(`IFCCARTESIANPOINTLIST3D((${coords.join(",")}))`);
    return add(`IFCTRIANGULATEDFACESET(${points},$,$,(${faces.join(",")}),$)`);
  };
  /**
   * A Space as an IfcSpace in its storey (`storeyPlace`, at `elevation`): its body, its volume's
   * meshes or else a prism of its boundary from its floor up by its height (none at no height);
   * its records; and its quantities, planned area and coverings as property sets.
   */
  const spaceElement = (sp: Space, pieces: readonly Mesh3D[], storeyPlace: string, elevation: number): string => {
    const items: string[] = [];
    for (const m of pieces) {
      const set = tessellate(m.triangles, elevation);
      if (!set) continue;
      add(`IFCSTYLEDITEM(${set},(${styleOf(m)}),$)`);
      items.push(set);
    }
    if (!items.length) {
      const ring = netBoundaryOf(doc, sp.id);
      const span = ring ? volumeSpan(elevation + sp.num(F.floorElevation), sp.num(F.height)) : null;
      const set = ring && span ? tessellate(prismTriangles(ring, span.bottom, span.top), elevation) : null;
      if (set) items.push(set);
    }
    const shape = items.length ? add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${items.join(",")}))`)}))`) : "$";
    const place = add(`IFCLOCALPLACEMENT(${storeyPlace},${placement})`);
    const number = sp.text(F.number).trim();
    const name = nameOf(sp);
    const plugin = doc.records(sp.id).find((r) => r.parametric)?.name ?? "Space";
    // IfcSpace: its number (or its name) as its Name, its name as its LongName, interior, its floor's height
    const floor = sp.has(F.floorElevation) ? real(sp.num(F.floorElevation)) : "$";
    const space = add(`IFCSPACE('${ifcGuid(sp.id)}',$,${stepString(number || name || "Space")},$,${stepString(plugin)},${place},${shape},${name ? stepString(name) : "$"},.ELEMENT.,.SPACE.,${floor})`);

    const units = doc.info.units;
    const single = (field: string, value: string): string => add(`IFCPROPERTYSINGLEVALUE(${stepString(field)},$,${value},$)`);
    const relate = (set: string): void => void add(`IFCRELDEFINESBYPROPERTIES('${ifcGuid()}',$,$,$,(${space}),${set})`);
    const m2 = (field: string): string => real(measured(sp, field, units) / 1e6);
    const m3 = (field: string): string => real(measured(sp, field, units) / 1e9);

    // Pset_SpaceCommon: its number, not external, and its proposed area as its net planned area
    const common: string[] = [];
    if (number) common.push(single("Reference", `IFCLABEL(${stepString(number)})`));
    common.push(single("IsExternal", "IFCBOOLEAN(.F.)"));
    if (measured(sp, F.proposedArea, units) > 0) common.push(single("NetPlannedArea", `IFCAREAMEASURE(${m2(F.proposedArea)})`));
    relate(add(`IFCPROPERTYSET('${ifcGuid()}',$,'Pset_SpaceCommon',$,(${common.join(",")}))`));

    // Qto_SpaceBaseQuantities: areas in m², volumes in m³, lengths in mm (the file's units)
    const quantities = [
      add(`IFCQUANTITYAREA('NetFloorArea',$,$,${m2(F.area)},$)`),
      add(`IFCQUANTITYAREA('GrossFloorArea',$,$,${m2(F.grossArea)},$)`),
      add(`IFCQUANTITYLENGTH('NetPerimeter',$,$,${real(sp.num(F.perimeter))},$)`),
      add(`IFCQUANTITYLENGTH('GrossPerimeter',$,$,${real(sp.num(F.grossPerimeter))},$)`),
      add(`IFCQUANTITYVOLUME('NetVolume',$,$,${m3(F.volume)},$)`),
      add(`IFCQUANTITYVOLUME('GrossVolume',$,$,${m3(F.grossVolume)},$)`),
      add(`IFCQUANTITYLENGTH('Height',$,$,${real(sp.num(F.height))},$)`),
    ];
    relate(add(`IFCELEMENTQUANTITY('${ifcGuid()}',$,'Qto_SpaceBaseQuantities',$,$,(${quantities.join(",")}))`));

    // Pset_SpaceCoveringRequirements: each finish that has a value; the wall finishes joined where they differ
    const walls = [...new Set([F.northFinish, F.eastFinish, F.southFinish, F.westFinish].map((f) => sp.text(f).trim()).filter(Boolean))].join(", ");
    const coverings: [string, string][] = [
      ["FloorCovering", sp.text(F.floorFinish).trim()],
      ["WallCovering", walls],
      ["CeilingCovering", sp.text(F.ceilingFinish).trim()],
      ["SkirtingBoardCovering", sp.text(F.baseFinish).trim()],
    ];
    const covered = coverings.filter(([, v]) => v).map(([field, v]) => single(field, `IFCLABEL(${stepString(v)})`));
    if (covered.length) relate(add(`IFCPROPERTYSET('${ifcGuid()}',$,'Pset_SpaceCoveringRequirements',$,(${covered.join(",")}))`));

    propertySets(sp.id, space);
    return space;
  };

  const layers = doc.layers();
  const storeys: string[] = [];
  // a storey for each layer with a body or a Space, in model order
  for (const layerId of new Set([...byLayer.keys(), ...spacesOn.keys()])) {
    const objects = byLayer.get(layerId) ?? new Map<string, Mesh3D[]>();
    const layer = layers.find((l) => l.id === layerId);
    const elevation = layer?.elevation ?? 0;
    // the storey stands at its elevation and its elements are written from there, so tools that
    // take a storey's height from its placement (rather than its Elevation) place it right too
    const storeyAxes = elevation ? add(`IFCAXIS2PLACEMENT3D(${add(`IFCCARTESIANPOINT((0.,0.,${real(elevation)}))`)},$,$)`) : placement;
    const storeyPlace = add(`IFCLOCALPLACEMENT(${buildingPlace},${storeyAxes})`);
    const storey = add(`IFCBUILDINGSTOREY('${ifcGuid(layerId)}',$,${stepString(layer?.name ?? "Layer")},$,$,${storeyPlace},$,$,.ELEMENT.,${real(elevation)})`);
    storeys.push(storey);
    // a Space is a spatial element: aggregated under its storey, not contained in it
    const rooms = (spacesOn.get(layerId) ?? []).map((sp) => spaceElement(sp, objects.get(sp.id) ?? [], storeyPlace, elevation));
    const elements: string[] = [];
    for (const [objectId, pieces] of objects) {
      if (spaces.has(objectId)) continue;
      const items: string[] = [];
      for (const m of pieces) {
        const set = tessellate(m.triangles, elevation);
        if (!set) continue;
        add(`IFCSTYLEDITEM(${set},(${styleOf(m)}),$)`);
        items.push(set);
      }
      if (items.length === 0) continue;
      const rep = add(`IFCSHAPEREPRESENTATION(${body},'Body','Tessellation',(${items.join(",")}))`);
      const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
      const place = add(`IFCLOCALPLACEMENT(${storeyPlace},${placement})`);
      const o = doc.object(objectId);
      const plugin = doc.records(objectId).find((r) => r.parametric)?.name ?? "";
      const kind = o?.type === WALL_TYPE ? CLASSES[1] : plugin ? CLASSES.find((c) => c.test.test(plugin)) : undefined;
      const name = stepString(o?.name || plugin || o?.typeName || "Object");
      const type = plugin ? stepString(plugin) : "$";
      const head = `'${ifcGuid(objectId)}',$,${name},$,${type},${place},${shape},$`;
      const element = add(kind ? `${kind.entity}(${head}${",$".repeat(kind.extra)})` : `IFCBUILDINGELEMENTPROXY(${head},$)`);
      elements.push(element);
      propertySets(objectId, element);
    }
    if (elements.length) add(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',$,$,$,(${elements.join(",")}),${storey})`);
    if (rooms.length) add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${storey},(${rooms.join(",")}))`);
  }
  if (storeys.length) add(`IFCRELAGGREGATES('${ifcGuid()}',$,$,$,${building},(${storeys.join(",")}))`);

  const stamp = now.toISOString().slice(0, 19);
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${stepString(`${title}.ifc`)},'${stamp}',(''),(''),'Rodeo','Rodeo','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    ...lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
