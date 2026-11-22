// The texture commands Vectorworks puts on a textured object's context menu and on the Render tab's
// texture list: Rotate Texture by 90° turns the mapping a quarter turn, Reset to Default Mapping
// undoes what the Attribute Mapping tool or Object Info did (no offset, the texture's own scale, no
// rotation, no flip), and Remove Texture Override takes the texture off. On an extrude, sweep or
// multiple extrude, a top, bottom or sides part that is an override is removed, so its faces go
// back to the whole object's texture; any other part is set to None. Right-clicking the drawing
// acts on every textured part of the object under the pointer, and removes only the texture on the
// whole object; right-clicking a part's heading in the Render tab acts on that part, and Locate in
// View shows the 3D view, fits it to the object and highlights that part's edges for two seconds.
// Each command is one undo step (EditSession.setObjectTexture or removeTexturePart).

import { TEXTURE_NONE, type TexturePart, type Vec3 } from "../core/index.ts";
import { OVERRIDE_PARTS, OVERRIDE_TYPES } from "../core/texmap.ts";
import { appContext } from "./ext.ts";
import { attempt } from "./commands.ts";
import type { Row } from "./menu.ts";
import { store } from "./state.ts";

/** Vectorworks' part id for the whole object */
const OVERALL = 3;
/** mapping values this close to the default are the default */
const SAME = 1e-9;
/** how long Locate in View keeps the highlight */
const LOCATE_MS = 2000;

/** The 3D view's highlight lines are claimed by the latest tool that sets them; a timer clears only its own claim. */
let claims = 0;

/** Claims the 3D view's highlight lines for a tool, and returns the claim: a later claim keeps its place. */
export function claimHighlight(): number {
  return ++claims;
}

/** The parts of an object that show a texture (its own or its class's), or only those in `only`. */
function textured(id: string, only?: number): TexturePart[] {
  const parts = store.session?.doc.objectTextures(id) ?? [];
  return parts.filter((p) => p.texture !== TEXTURE_NONE && (only === undefined || p.part === only));
}

/** True when part `part` of object `id` is a texture override: a top, bottom or sides of an extrude, sweep or multiple extrude. */
function isOverride(id: string, part: number): boolean {
  const type = store.session?.doc.object(id)?.type;
  return type !== undefined && OVERRIDE_TYPES.has(type) && OVERRIDE_PARTS.includes(part);
}

/** A part with its offset, scale and rotation at their defaults and no flip. */
function isDefault(p: TexturePart): boolean {
  return Math.abs(p.offsetU) < SAME && Math.abs(p.offsetV) < SAME && Math.abs(p.scale - 1) < SAME && Math.abs(p.rotation) < SAME && !p.flip;
}

function rotate90(id: string, only?: number): void {
  attempt("Rotate Texture by 90°", (s) =>
    s.batch(() => {
      for (const p of textured(id, only)) s.setObjectTexture(id, p.part, { rotation: (((p.rotation + 90) % 360) + 360) % 360 });
    }),
  );
}

function resetMapping(id: string, only?: number): void {
  attempt("Reset to Default Mapping", (s) =>
    s.batch(() => {
      for (const p of textured(id, only)) {
        if (!isDefault(p)) s.setObjectTexture(id, p.part, { offsetU: 0, offsetV: 0, scale: 1, rotation: 0, flip: false });
      }
    }),
  );
}

/** Removes an override part (its faces go back to the whole object's texture), or sets any other part's texture to None. */
function removeOverride(id: string, part: number): void {
  if (isOverride(id, part)) attempt("Remove Texture Override", (s) => s.removeTexturePart(id, part));
  else attempt("Remove Texture Override", (s) => s.setObjectTexture(id, part, { texture: TEXTURE_NONE }));
}

/**
 * The texture rows for object `id`: for one of its parts (`part`, from the Render tab), or for the
 * whole object (the drawing's context menu). Rotate and Reset act on the parts that show a texture;
 * Remove Texture Override is offered for a part that shows one or is an override. None when neither
 * applies.
 */
export function textureRows(id: string | null, part?: number): Row[] {
  if (id === null) return [];
  // a part's heading also offers Locate in View, whether or not the part shows a texture
  const located: Row[] = part === undefined ? [] : [{ label: "Locate in View", run: () => locateInView(id, part) }];
  const remove = part ?? OVERALL;
  const shown = textured(id, part).length > 0;
  if (!shown && !textured(id, remove).length && !isOverride(id, remove)) return located;
  const mapping: Row[] = [
    { label: "Rotate Texture by 90°", enabled: () => textured(id, part).length > 0, run: () => rotate90(id, part) },
    { label: "Reset to Default Mapping", enabled: () => textured(id, part).some((p) => !isDefault(p)), run: () => resetMapping(id, part) },
    { label: "Remove Texture Override", enabled: () => textured(id, remove).length > 0 || isOverride(id, remove), run: () => removeOverride(id, remove) },
  ];
  return located.length ? [...mapping, "-", ...located] : mapping;
}

/** The unit normal of the triangle at `i` (9 numbers from `tris`), or null for a sliver. */
function normalOf(tris: Float32Array, i: number): Vec3 | null {
  const e1 = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
  const e2 = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const len = Math.hypot(n[0], n[1], n[2]);
  return len > 0 ? [n[0] / len, n[1] / len, n[2] / len] : null;
}

/**
 * Shows the 3D view, fits it to object `id` and highlights the edges of its triangles that belong to
 * `part` (every triangle for Overall) for two seconds. The highlight stays if another tool has claimed
 * the view's lines since.
 */
export function locateInView(id: string, part: number): void {
  const ctx = appContext();
  const doc = store.session?.doc;
  if (!ctx || !doc) return;
  void ctx.show3d().then((v) => {
    if (!v) return;
    v.fitObjects(new Set([id]));
    const tris = v.objectTriangles(id);
    const picked: number[] = [];
    for (let i = 0; i < tris.length; i += 9) {
      if (part !== OVERALL) {
        const n = normalOf(tris, i);
        if (!n || doc.texturePartOfFace(id, n) !== part) continue;
      }
      picked.push(i);
    }
    // six numbers an edge, three edges a triangle
    const segs = new Float32Array(picked.length * 18);
    picked.forEach((i, k) => {
      for (let e = 0; e < 3; e++) {
        const a = i + 3 * e;
        const b = i + 3 * ((e + 1) % 3);
        segs.set([tris[a], tris[a + 1], tris[a + 2], tris[b], tris[b + 1], tris[b + 2]], k * 18 + e * 6);
      }
    });
    const token = claimHighlight();
    v.setHighlightLines(segs.length ? segs : null);
    setTimeout(() => {
      if (token === claims) v.setHighlightLines(null);
    }, LOCATE_MS);
  });
}
