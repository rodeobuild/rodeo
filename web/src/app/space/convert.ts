// Space Planning's Space objects beside the grouped spaces the tool and commands made before them:
// the Space objects a layer has (spaceObjectsOn, the listing spaces.ts's spacesOn gives first), and
// convertSpaces, which turns grouped spaces into Space objects in their places, keeping their data,
// the Space Links that joined them and their boundary's look. Free of the page, so the check
// (commands.check.ts) runs in Node; spaces.ts's menu command wraps convertSpaces in one undo step.

import type { Attributes, EditSession, ObjectInfo, RecordValue, VwxDocument } from "../../core/index.ts";
import type { SpaceGroup } from "../spaces.ts";
import { addSpace } from "./make.ts";
import { F, netBoundaryOf, PLUGIN, SPACE, spaceOf } from "./model.ts";

/** the Space Data record grouped spaces carry: the same name as spaces.ts's SPACE_FORMAT */
const DATA_FORMAT = "Space Data";
/** the Space Link plug-in, and the parameters that hold the ids of the two spaces it joins */
const LINK = "Space Link";
const FROM_ID = "From Id";
const TO_ID = "To Id";
const AREA_TEXT = /(m²|sq ft|sq yd|sq mi)$/;

/** The Space objects on a layer, as SpaceGroups (kind "object"): the plug-in, its path as the boundary, and its boundary on the drawing. */
export function spaceObjectsOn(doc: VwxDocument, layerId: string): SpaceGroup[] {
  const out: SpaceGroup[] = [];
  if (!doc.hasPluginFormat(SPACE)) return out;
  for (const obj of doc.objects(layerId)) {
    if (obj.type !== PLUGIN || obj.parentId || !spaceOf(doc, obj.id)) continue;
    const pathId = doc.pluginPath(obj.id);
    const boundary = pathId ? doc.object(pathId) : null;
    const ring = netBoundaryOf(doc, obj.id);
    if (boundary && ring) out.push({ kind: "object", obj, boundary, ring, texts: [] });
  }
  return out;
}

/** A grouped space's boundary look, which its Space object's boundary takes. */
function lookOf(boundary: ObjectInfo): Partial<Attributes> {
  const a = boundary.attrs;
  if (!a) return {};
  return { lineStyle: a.lineStyle, lineWeight: a.lineWeight, fillPattern: a.fillPattern, fillFore: a.fillFore, fillBack: a.fillBack, penFore: a.penFore, penBack: a.penBack, fillOpacity: a.fillOpacity, penOpacity: a.penOpacity };
}

/**
 * Turns each grouped space in `groups` (kind "group"; others are skipped) into a Space object in its
 * place, in the session's open batch: same boundary, layer and class; its parameters from the
 * group's Space Data record; its label shown if the group had texts, its area too if one of them
 * was an area; the Space Data record attached to the new object with all its values; every Space
 * Link that pointed at the group pointed at the new object; then the group is deleted. Its id per
 * space converted. The new objects take `attrs` where the boundary's own look says nothing.
 */
export function convertSpaces(s: EditSession, groups: readonly SpaceGroup[], attrs: Partial<Attributes>): string[] {
  const doc = s.doc;
  const ids: string[] = [];
  const renamed = new Map<string, string>();
  for (const g of groups) {
    if (g.kind !== "group") continue;
    const data = doc.records(g.obj.id).find((r) => r.name === DATA_FORMAT);
    const get = (name: string): RecordValue | undefined => data?.fields.find((f) => f.name === name)?.value;
    const text = (name: string): string => String(get(name) ?? "").trim();
    const values: Record<string, RecordValue> = {
      [F.number]: text("Space Number"),
      [F.name]: text("Space Name"),
      [F.occupancyType]: text("Occupant Type"),
      [F.department]: text("Department") || text("Occup. Organization"),
      [F.matrixOrder]: Number(get("Matrix Order")) || 0,
      [F.showBoundary]: true,
      [F.showLabel]: g.texts.length > 0,
      [F.labelConfig]: "Name and Number",
      [F.showArea]: g.texts.some((t) => AREA_TEXT.test(t.shape?.text ?? "")),
      // a group drew no 3D volume, so its space doesn't start one
      [F.show3d]: false,
      [F.autoBoundary]: false,
    };
    const height = Number(get("Height"));
    if (height > 0) values[F.height] = height;
    const proposed = text("Proposed Area").replace(/,/g, "");
    if (proposed && Number.isFinite(Number(proposed))) values[F.proposedArea] = Number(proposed);

    const id = addSpace(s, { ring: g.ring, layerId: g.obj.layerId, classIndex: g.obj.classIndex, values, attrs: { ...attrs, ...lookOf(g.boundary) } });
    // nothing lost: the group's own data record comes across whole, in the same format
    if (data) s.attachRecords([{ id, format: data.format, fields: Object.fromEntries(data.fields.map((f) => [f.name, f.value])) }]);
    s.deleteObjects([g.obj.id]);
    renamed.set(g.obj.id, id);
    ids.push(id);
  }
  if (renamed.size) {
    for (const layer of doc.layers()) {
      for (const o of doc.objects(layer.id)) {
        if (o.type !== PLUGIN) continue;
        const link = doc.records(o.id).find((r) => r.parametric && r.name === LINK);
        if (!link) continue;
        for (const field of [FROM_ID, TO_ID]) {
          const now = renamed.get(String(link.fields.find((f) => f.name === field)?.value ?? ""));
          if (now) s.setRecordField(o.id, link.format, field, now);
        }
      }
    }
  }
  return ids;
}
