// Checks that a texture part's mapping reaches the 3D model (model3d's mesh uvs, texturePart and
// texture) under Node, on a blank drawing: a 2000 × 1000 × 500 mm box extruded, with a 1000 mm,
// 2:1 pixel image texture on its whole object. Run from web/:
//   npx tsx src/core/textureDraw.check.ts
// Nothing is drawn and no drawing is read. The image is a 4 × 2 pixel PNG built here.

import { deflateSync } from "node:zlib";
import { concat, crc32, setU32be } from "./bytes.ts";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { Mesh3D } from "./types.ts";
import { OVERALL, TEXTURE_BY_CLASS, TEXTURE_NONE } from "./texmap.ts";
import { mappingBox } from "./model3d.ts";
import { guidOf, type Model } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A PNG of width by height pixels, rgb one triple per pixel row by row. */
function pngOf(width: number, height: number, rgb: readonly number[]): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    setU32be(out, 0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    setU32be(out, 8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const head = new Uint8Array(13);
  setU32be(head, 0, width);
  setU32be(head, 4, height);
  head.set([8, 2, 0, 0, 0], 8);
  const row = 1 + 3 * width;
  const raw = new Uint8Array(height * row);
  for (let y = 0; y < height; y++) raw.set(rgb.slice(3 * width * y, 3 * width * (y + 1)), y * row + 1);
  return concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

const PNG = pngOf(4, 2, [200, 40, 40, 40, 200, 40, 40, 40, 200, 200, 200, 40, 40, 200, 200, 200, 40, 200, 90, 90, 90, 10, 10, 10]);
const LONG = 2000;
const SHORT = 1000;
const DEEP = 500;
/** a 1000 mm image, 2:1 pixels: 1000 mm across and 500 mm up */
const image = (name: string, s: { addImageTexture(n: string, spec: object): number }): number =>
  s.addImageTexture(name, { image: PNG, mime: "image/png", width: 4, height: 2, size: 1000, color: [120, 90, 60], previews: { large: PNG, small: PNG } });

const near = (a: number, b: number, eps = 1e-3): boolean => Math.abs(a - b) <= eps;

const s = openVwx(blankDrawing("mm"), "texture-draw-check.vwx");
const layer = s.createLayer("Texture draw check", "design", 50);
const [box] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 0, x1: LONG, y1: SHORT })], DEEP);
const brick = image("Brick check", s);
const meshes = (id: string): Mesh3D[] => s.doc.model3d().filter((m) => m.objectId === id);
const corners = (m: Mesh3D): { x: number; y: number; z: number; u: number; v: number }[] => {
  const out: { x: number; y: number; z: number; u: number; v: number }[] = [];
  for (let i = 0; i < m.triangles.length; i += 3) {
    const k = i / 3;
    out.push({ x: m.triangles[i], y: m.triangles[i + 1], z: m.triangles[i + 2], u: m.uvs ? m.uvs[2 * k] : NaN, v: m.uvs ? m.uvs[2 * k + 1] : NaN });
  }
  return out;
};
const span = (xs: number[]): number => Math.max(...xs) - Math.min(...xs);
/** a mesh's triangles, each as its three corners */
const triangles = (m: Mesh3D): { x: number; y: number; z: number; u: number; v: number }[][] => {
  const cs = corners(m);
  const out: { x: number; y: number; z: number; u: number; v: number }[][] = [];
  for (let i = 0; i < cs.length; i += 3) out.push(cs.slice(i, i + 3));
  return out;
};

check(meshes(box).length === 1 && meshes(box)[0].triangles.length === 12 * 9, "the box is one mesh of 12 triangles");

// the whole object's image: surface UV, each face on its own plane
s.setObjectTexture(box, OVERALL, { texture: brick, mapType: "surfaceUV", offsetU: 0, offsetV: 0, scale: 1, rotation: 0, flip: false });
let m = meshes(box)[0];
check(m.texture === brick && !!m.uvs && m.uvs.length === m.triangles.length * 2 / 3, "surface UV: the mesh shows the image and has uvs");
{
  // every triangle's edges, in mm on the image (u × 1000 across, v × 500 up), keep their 3D length
  let worst = 0;
  const tri = m.triangles;
  for (let t = 0; t < tri.length / 9; t++) {
    for (let e = 0; e < 3; e++) {
      const a = 3 * (3 * t + e), b = 3 * (3 * t + ((e + 1) % 3));
      const l3 = Math.hypot(tri[b] - tri[a], tri[b + 1] - tri[a + 1], tri[b + 2] - tri[a + 2]);
      const du = (m.uvs![2 * (3 * t + ((e + 1) % 3))] - m.uvs![2 * (3 * t + e)]) * SHORT;
      const dv = (m.uvs![2 * (3 * t + ((e + 1) % 3)) + 1] - m.uvs![2 * (3 * t + e) + 1]) * (SHORT / 2);
      worst = Math.max(worst, Math.abs(Math.hypot(du, dv) - l3) / Math.max(1, l3));
    }
  }
  check(worst < 1e-4, `surface UV: every edge keeps its length on the image (worst relative error ${worst.toExponential(2)})`);
  // the long front face (y = 0): 2 images across and 1 up
  const ymin = Math.min(...corners(m).map((c) => c.y));
  const front = corners(m).filter((c) => near(c.y, ymin, 1e-3));
  check(near(span(front.map((c) => c.u)), 2, 1e-4) && near(span(front.map((c) => c.v)), 1, 1e-4), "surface UV: the long front face spans 2 × 1 images");
}

// plane: one projection for every face, so the long faces smear (zero uv height)
s.setObjectTexture(box, OVERALL, { mapType: "plane" });
m = meshes(box)[0];
{
  // the long faces are the triangles lying in the planes y = 0 and y = 1000
  const flat = triangles(m).filter((t) => t.every((c) => near(c.y, t[0].y, 1e-3)) && (near(t[0].y, 0, 1e-3) || near(t[0].y, SHORT, 1e-3)));
  check(flat.length === 4 && flat.every((t) => near(span(t.map((c) => c.v)), 0, 1e-6)), `plane: the long side faces have no uv height (${flat.length} triangles)`);
}

// perimeter: the four sides' u spans add up to the outline's length in images (6000 mm / 1000)
s.setObjectTexture(box, OVERALL, { mapType: "perimeter" });
m = meshes(box)[0];
{
  const groups = new Map<string, { u: number[] }>();
  for (let t = 0; t < m.triangles.length / 9; t++) {
    const i = 9 * t;
    const e1 = [m.triangles[i + 3] - m.triangles[i], m.triangles[i + 4] - m.triangles[i + 1], m.triangles[i + 5] - m.triangles[i + 2]];
    const e2 = [m.triangles[i + 6] - m.triangles[i], m.triangles[i + 7] - m.triangles[i + 1], m.triangles[i + 8] - m.triangles[i + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (Math.abs(n[2]) > 0.999 * len) continue; // caps are not sides
    const key = `${Math.round((n[0] / len) * 1e3)},${Math.round((n[1] / len) * 1e3)}`;
    const g = groups.get(key) ?? { u: [] };
    groups.set(key, g);
    for (let k = 0; k < 3; k++) g.u.push(m.uvs![2 * (3 * t + k)]);
  }
  const total = [...groups.values()].reduce((sum, g) => sum + span(g.u), 0);
  check(groups.size === 4 && near(total, 6, 1e-4), `perimeter: the four sides' u spans add up to 6 images (${total.toFixed(4)})`);
}

for (const mapType of ["cylinder", "sphere"] as const) {
  s.setObjectTexture(box, OVERALL, { mapType, radius: 0 });
  m = meshes(box)[0];
  const cs = corners(m);
  check(cs.every((c) => Number.isFinite(c.u) && Number.isFinite(c.v)) && span(cs.map((c) => c.u)) > 0 && span(cs.map((c) => c.v)) > 0, `${mapType}: finite, non-constant uvs`);
}

// auto-align plane: no uvs when the world's origin holds it, uvs when the object's does
s.setObjectTexture(box, OVERALL, { mapType: "autoPlane", worldOrigin: true });
check(meshes(box)[0].uvs === undefined, "autoPlane with world origin: the mesh has no uvs");
s.setObjectTexture(box, OVERALL, { mapType: "autoPlane", worldOrigin: false });
check(!!meshes(box)[0].uvs, "autoPlane with the object's origin: the mesh has uvs");

// changes to the placement move, scale, turn and flip the same picture
s.setObjectTexture(box, OVERALL, { mapType: "surfaceUV", worldOrigin: false, offsetU: 0, offsetV: 0, scale: 1, rotation: 0, flip: false });
const base = corners(meshes(box)[0]);
const uBase = base.map((c) => c.u);
const vBase = base.map((c) => c.v);
const same = (f: (c: { u: number; v: number }, i: number) => number, want: (i: number) => number): boolean => corners(meshes(box)[0]).every((c, i) => near(f(c, i), want(i), 1e-6));
s.setObjectTexture(box, OVERALL, { offsetU: 500 });
check(same((c) => c.u, (i) => uBase[i] - 0.5), "offsetU 500 shifts every u by −0.5");
s.setObjectTexture(box, OVERALL, { offsetU: 0, scale: 2 });
check(same((c) => c.u, (i) => uBase[i] / 2) && same((c) => c.v, (i) => vBase[i] / 2), "scale 2 halves every u and v");
s.setObjectTexture(box, OVERALL, { scale: 1, rotation: 90 });
{
  // the front face, y = 0: across it u now runs with z (half an image) and v with x (4 images)
  const front = triangles(meshes(box)[0]).filter((t) => t.every((c) => near(c.y, 0, 1e-3))).flat();
  check(near(span(front.map((c) => c.u)), 0.5, 1e-4) && near(span(front.map((c) => c.v)), 4, 1e-4), `rotation 90 swaps the axes on the front face (u spans ${span(front.map((c) => c.u)).toFixed(4)}, v ${span(front.map((c) => c.v)).toFixed(4)})`);
}
s.setObjectTexture(box, OVERALL, { rotation: 0, flip: true });
check(same((c) => c.u, (i) => -uBase[i]), "flip negates u");
s.setObjectTexture(box, OVERALL, { flip: false });

// a second part on the top: two meshes, the top's with its own texture; removing it leaves one
const tiles = image("Tiles check", s);
s.addTexturePart(box, 4);
s.setObjectTexture(box, 4, { texture: tiles });
{
  const ms = meshes(box);
  const top = ms.find((x) => x.texturePart === 4);
  const rest = ms.find((x) => x.texturePart === undefined);
  check(ms.length === 2 && !!top && !!rest, "part 4: the object is two meshes, one textured as part 4");
  check(!!top && top.texture === tiles && !!rest && rest.texture === brick, "part 4: the top shows its texture, the rest the whole object's");
  // the top is the triangles lying flat at the object's highest z; the rest has none of them
  const zTop = Math.max(...corners(meshes(box)[0]).map((c) => c.z));
  const flatTop = (x: Mesh3D | undefined): boolean => !!x && triangles(x).every((t) => t.every((c) => near(c.z, zTop, 1e-3)));
  const noTop = (x: Mesh3D | undefined): boolean => !!x && triangles(x).every((t) => !t.every((c) => near(c.z, zTop, 1e-3)));
  check(flatTop(top) && noTop(rest) && triangles(top!).length === 2, "part 4: its two faces are the top (max z), and the rest has no top");
  check(ms.reduce((n, x) => n + x.triangles.length / 9, 0) === 12, "part 4: the split keeps all 12 triangles");
}
s.setObjectTexture(box, 4, { texture: TEXTURE_NONE });
{
  const top = meshes(box).find((x) => x.texturePart === 4);
  check(!!top && top.texture === brick, "part 4 set to none shows the whole object's texture");
}
const cls = s.createClass("Tile class check");
s.setObjectClass([box], cls);
const classTex = image("Class tile check", s);
s.setClassTexture(cls, classTex);
s.setObjectTexture(box, 4, { texture: TEXTURE_BY_CLASS });
{
  const top = meshes(box).find((x) => x.texturePart === 4);
  check(!!top && top.texture === classTex, "part 4 set by class shows its class's texture");
}
s.removeTexturePart(box, 4);
check(meshes(box).length === 1 && meshes(box)[0].texturePart === undefined, "removing part 4 leaves one mesh with no part");

// repeat off: the image runs once across (u) or up (v), its edges clamped there; both on, no clamp field
s.setObjectTexture(box, OVERALL, { mapType: "surfaceUV", repeatH: false, repeatV: true });
check(meshes(box)[0].textureClamp?.u === true && meshes(box)[0].textureClamp?.v === false, "repeat off across: the mesh clamps u and not v");
s.setObjectTexture(box, OVERALL, { repeatH: true, repeatV: false });
check(meshes(box)[0].textureClamp?.u === false && meshes(box)[0].textureClamp?.v === true, "repeat off up: the mesh clamps v and not u");
s.setObjectTexture(box, OVERALL, { repeatH: false, repeatV: false });
check(meshes(box)[0].textureClamp?.u === true && meshes(box)[0].textureClamp?.v === true, "repeat off both ways: the mesh clamps both");
s.setObjectTexture(box, OVERALL, { repeatH: true, repeatV: true });
check(meshes(box)[0].textureClamp === undefined, "repeat on both ways: no clamp field");
s.setObjectTexture(box, OVERALL, { repeatH: false, repeatV: true });
// auto-align plane with the world's origin gives no uvs, so the field is absent even with repeat off
s.setObjectTexture(box, OVERALL, { mapType: "autoPlane", worldOrigin: true, repeatH: false, repeatV: false });
check(meshes(box)[0].uvs === undefined && meshes(box)[0].textureClamp === undefined, "autoPlane with world origin and repeat off: no uvs and no clamp field");
s.setObjectTexture(box, OVERALL, { mapType: "surfaceUV", worldOrigin: false, repeatH: true, repeatV: true });

// a whole object by class, and none: the class's texture, and -1 for none
const other = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 4000, y0: 0, x1: 5000, y1: 1000 })], DEEP)[0];
s.setObjectClass([other], cls);
s.setObjectTexture(other, OVERALL, { texture: TEXTURE_BY_CLASS });
check(meshes(other)[0].texture === classTex, "an object whose whole texture is by class shows its class's texture");
s.setObjectTexture(other, OVERALL, { texture: TEXTURE_NONE });
check(meshes(other)[0].texture === -1, "an object whose whole texture is none shows none (-1)");

// default radial mappings: a box extrude drawn away from the origin, and a 32-sided prism
const model = s.doc as Model;
const oneRec = (id: string) => model.recs.find((r) => guidOf(r) === id)!;
const overallOf = (id: string) => s.doc.objectTextures(id)!.find((p) => p.part === OVERALL)!;
const far = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 3000, y0: 2000, x1: 5000, y1: 3000 })], 1000)[0];
s.setObjectTexture(far, OVERALL, { texture: brick });
s.setObjectTexture(far, OVERALL, { mapType: "cylinder" });
{
  const mesh = meshes(far)[0];
  const zmin = Math.min(...corners(mesh).map((c) => c.z));
  const zmax = Math.max(...corners(mesh).map((c) => c.z));
  const part = overallOf(far);
  check(near(part.origin[0], -4000) && near(part.origin[1], -2500) && near(part.origin[2], -zmin), `cylinder default: origin is the bottom middle of the box (${part.origin.map((v) => v.toFixed(3)).join(", ")})`);
  check(near(part.radius, 1000), `cylinder default: radius is half the larger extent (${part.radius})`);
  check(part.axes.every((v, i) => near(v, [1, 0, 0, 0, 1, 0, 0, 0, 1][i])), "cylinder default: identity axes");
  const box = mappingBox(model, oneRec(far));
  check(!!box && near(box.min[0], 3000) && near(box.max[0], 5000) && near(box.min[1], 2000) && near(box.max[1], 3000) && near(box.min[2], zmin) && near(box.max[2], zmax), "mappingBox: the box of the extrude's own faces");
  // (f) one undo step undoes the map type with its origin and radius
  const before = overallOf(far);
  s.setObjectTexture(far, OVERALL, { mapType: "plane" });
  s.undo();
  const after = overallOf(far);
  check(after.mapType === "cylinder" && near(after.origin[0], before.origin[0]) && near(after.radius, before.radius), "one undo after a map type change restores the map type, origin and radius together");
  // (e) back and forth writes the default again; plane writes none
  s.setObjectTexture(far, OVERALL, { mapType: "sphere" });
  check(near(overallOf(far).origin[2], -(zmin + zmax) / 2) && near(overallOf(far).origin[0], -4000), "sphere default: origin at the box middle");
  s.setObjectTexture(far, OVERALL, { mapType: "cylinder" });
  check(near(overallOf(far).origin[2], -zmin), "switching sphere back to cylinder writes the cylinder default again");
  s.setObjectTexture(far, OVERALL, { mapType: "plane", origin: [7, 8, 9] });
  check(near(overallOf(far).origin[0], 7) && near(overallOf(far).origin[1], 8), "plane writes no default (the origin given stays)");
  // (d) an explicit radius or origin is left as given
  s.setObjectTexture(far, OVERALL, { mapType: "cylinder", radius: 300 });
  check(near(overallOf(far).radius, 300) && near(overallOf(far).origin[0], 7) && near(overallOf(far).origin[2], 9), "cylinder with a radius: the radius is 300 and the origin stays as it was (no default written)");
  s.setObjectTexture(far, OVERALL, { mapType: "plane" });
  s.setObjectTexture(far, OVERALL, { mapType: "cylinder", origin: [1, 2, 3] });
  check(near(overallOf(far).origin[0], 1) && near(overallOf(far).origin[2], 3) && near(overallOf(far).radius, 300), "cylinder with an origin: the origin is as given and the radius kept");
}

// (b) a 32-sided prism centred at (8000, 2000), radius 1000: the sides' u wraps once round, 2π images
const cx = 8000;
const cy = 2000;
const ring = Array.from({ length: 32 }, (_, i) => ({ x: Math.round(cx + 1000 * Math.cos((2 * Math.PI * i) / 32)), y: Math.round(cy + 1000 * Math.sin((2 * Math.PI * i) / 32)) }));
const prism = s.extrudeObjects([s.addObject(layer, { kind: "polygon", points: ring, closed: true })], 1000)[0];
s.setObjectTexture(prism, OVERALL, { texture: brick, mapType: "cylinder" });
{
  const mesh = meshes(prism)[0];
  const sideTris = triangles(mesh).filter((t) => {
    const e1 = [t[1].x - t[0].x, t[1].y - t[0].y, t[1].z - t[0].z];
    const e2 = [t[2].x - t[0].x, t[2].y - t[0].y, t[2].z - t[0].z];
    return Math.abs(e1[1] * e2[2] - e1[2] * e2[1]) + Math.abs(e1[2] * e2[0] - e1[0] * e2[2]) > 0 && Math.abs(e1[0] * e2[1] - e1[1] * e2[0]) < 1e-6 * Math.hypot(...e1, ...e2);
  });
  const sideCorners = sideTris.flat();
  const want = (2 * Math.PI * 1000) / 1000;
  const uSpan = span(sideCorners.map((c) => c.u));
  check(sideCorners.length > 0 && Math.abs(uSpan - want) / want < 0.02, `prism: the sides' u spans 2π images (${uSpan.toFixed(4)})`);
  const worstTri = Math.max(...sideTris.map((t) => span(t.map((c) => c.u))));
  check(worstTri < want / 2, `prism: no side triangle spans more than half the wrap (${worstTri.toFixed(4)})`);
}
s.setObjectTexture(prism, OVERALL, { mapType: "sphere" });
{
  const p = overallOf(prism);
  check(near(p.origin[0], -cx) && near(p.origin[1], -cy) && near(p.origin[2], -500, 1e-3), `sphere default on the prism: origin at its middle (${p.origin.map((v) => v.toFixed(3)).join(", ")})`);
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
