// Rhino .3dm export, the writing side (no DOM). export3dm writes a Rhino file in millimetres, z up, through
// rhino3dm (openNURBS compiled to WebAssembly; the app loads it and passes it in): a Rhino layer per design
// layer, with a sublayer per class its objects use ("Layer::Class"); each 3D object piece that is an upright
// prism (an extrude, a slab, a plain wall, an imported building: prism.ts) as a capped extrusion with its holes,
// a closed solid whose faces show only their edges, and each other piece as a mesh, its coplanar triangle pairs
// as quads and its normals split where faces meet at a crease, so neither shows the diagonals of the triangles
// the 3D view draws (each extrusion keeps that mesh as its render mesh, for readers that only read meshes); each
// named after its object and coloured by it; each symbol as a block definition of its objects' solids and
// meshes (and the blocks placed in it), on the sublayers of the first layer that places it, and each instance as
// a block instance through its matrix; and the 2D objects that stand for nothing in 3D as lines, polylines (a
// closed one repeats its first point, and a fill's outline round its holes comes apart into its rings, its cuts
// left out), circles and arcs (a sampled polyline when elliptical), points and text. Text is a text dot, since
// rhino3dm can't make a text entity: a dot is drawn the same size on screen however near, so its size is the
// text's in points (its world size over its layer's scale), whole and at least 3, and it keeps no rotation.
// Imports nothing from rhino3dm at run time, so it can be checked under Node.

import { arcPoint } from "./svg.ts";
import type { Pt, Shape } from "../core/types.ts";
import type { FlatObject, Model3D, ModelObject, ModelPiece } from "./scene3d.ts";
import { prismOf, type Prism } from "./prism.ts";
import type { Rhino } from "../import/rhino.ts";
import type { Extrusion, File3dm, GeometryBase, InstanceReference, Mesh, ObjectAttributes, Plane, Transform } from "rhino3dm";

/** Segments a sampled ellipse or elliptical arc takes. */
const ELLIPSE_SEGMENTS = 64;
/** The smallest text dot size rhino3dm keeps (points); smaller ones read back as its default. */
const MIN_DOT_POINTS = 3;
/** The size of a text whose shape gives none (points). */
const DEFAULT_POINTS = 10;
/** Millimetres in a point. */
const MM_PER_PT = 25.4 / 72;
/** Faces meeting at a corner at more than this angle (30°, its cosine) keep normals of their own there: a crease. */
const CREASE = Math.cos((30 * Math.PI) / 180);
/** Two triangles become a quad when their normals are within 2° (its cosine)... */
const QUAD_FLAT = Math.cos(Math.PI / 90);
/** ...and every corner of the quad turns by more than 1° (its sine), so it is convex with no corner on a straight run. */
const QUAD_TURN = Math.sin(Math.PI / 180);

/**
 * The drawing as a Rhino file (.3dm bytes) in millimetres: `model`'s pieces as extrusions where they are upright
 * prisms and meshes where not, and `flat`'s 2D objects
 * as linework and text, each on a layer named after its design layer (`layerNames` names the layers that only
 * have flat objects) under a sublayer for its class. The objects in a group are put in a Rhino group named after
 * it, and in the groups holding that one, as Rhino nests groups. The model's symbols are block definitions, and
 * an object placing one a block instance.
 */
export function export3dm(model: Model3D, flat: readonly FlatObject[], layerNames: ReadonlyMap<string, string>, rhino: Rhino): Uint8Array {
  const file = new rhino.File3dm();
  const settings = file.settings();
  settings.modelUnitSystem = rhino.UnitSystem.Millimeters;
  free(settings);
  const objects = file.objects();
  try {
    const placedOn = symbolLayers(model);
    const at = addLayers(file, rhino, model, flat, layerNames, placedOn);
    const index = (layerId: string, className: string): number => at.get(keyOf(layerId, className)) ?? 0;
    const blocks = addBlocks(file, rhino, model, (k, className) => index(placedOn[k], className));
    const groups = new Map<string, number>();
    const groupTable = file.groups();
    const groupOf = (group: { id: string; name: string }): number => {
      let i = groups.get(group.id);
      if (i === undefined) {
        const g = new rhino.Group();
        g.name = group.name;
        groupTable.add(g);
        free(g);
        i = groupTable.count - 1;
        groups.set(group.id, i);
      }
      return i;
    };
    for (const layer of model.layers) {
      for (const obj of layer.objects) {
        if (obj.instance) {
          const ref = blockOf(rhino, blocks, obj);
          if (!ref) continue;
          const attrs = attributes(rhino, index(layer.id, obj.className), undefined, obj.name);
          for (const g of obj.groups ?? []) attrs.addToGroup(groupOf(g));
          try {
            objects.addInstanceObject(ref, attrs);
          } finally {
            free(ref);
            free(attrs);
          }
          continue;
        }
        for (const piece of obj.pieces) {
          const geometry = pieceGeometry(rhino, piece);
          if (!geometry) continue;
          const attrs = attributes(rhino, index(layer.id, obj.className), piece.color, obj.name);
          for (const g of obj.groups ?? []) attrs.addToGroup(groupOf(g));
          try {
            if (geometry instanceof rhino.Extrusion) objects.addExtrusion(geometry, attrs);
            else objects.addMesh(geometry, attrs);
          } finally {
            free(geometry);
            free(attrs);
          }
        }
      }
    }
    for (const f of flat) writeFlat(rhino, objects, f, index(f.layerId, f.className));
    return file.toByteArray();
  } finally {
    free(file);
  }
}

/** The first layer placing each of the model's symbols, itself or through another symbol, by symbol. */
function symbolLayers(model: Model3D): string[] {
  const out: string[] = [];
  const mark = (objects: readonly ModelObject[], layerId: string): void => {
    for (const obj of objects) {
      const k = obj.instance?.symbol;
      if (k === undefined || out[k] !== undefined) continue;
      out[k] = layerId;
      mark(model.symbols?.[k]?.objects ?? [], layerId);
    }
  };
  for (const layer of model.layers) mark(layer.objects, layer.id);
  return out;
}

/**
 * The model's symbols as block definitions, each of its objects' solids and meshes and the blocks placed in it, named
 * after the symbol, its objects on `layerOf`'s layer for their class. Each one's id, by symbol; null for one
 * left with nothing to hold.
 */
function addBlocks(file: File3dm, rhino: Rhino, model: Model3D, layerOf: (symbol: number, className: string) => number): (string | null)[] {
  const ids: (string | null)[] = [];
  const table = file.instanceDefinitions();
  const taken = new Set<string>();
  for (const [k, symbol] of (model.symbols ?? []).entries()) {
    const geometry: GeometryBase[] = [];
    const attrs: ObjectAttributes[] = [];
    try {
      for (const obj of symbol.objects) {
        if (obj.instance) {
          const ref = blockOf(rhino, ids, obj);
          if (ref) {
            geometry.push(ref);
            attrs.push(attributes(rhino, layerOf(k, obj.className), undefined, obj.name));
          }
          continue;
        }
        for (const piece of obj.pieces) {
          const g = pieceGeometry(rhino, piece);
          if (!g) continue;
          geometry.push(g);
          attrs.push(attributes(rhino, layerOf(k, obj.className), piece.color, obj.name));
        }
      }
      const i = geometry.length ? table.add(uniqueName(symbol.name, "Block", taken), "", "", "", [0, 0, 0], geometry, attrs) : -1;
      const def = i >= 0 ? table.get(i) : null;
      ids.push(def ? def.id : null);
      free(def);
    } finally {
      for (const g of geometry) free(g);
      for (const a of attrs) free(a);
    }
  }
  return ids;
}

/** An instance of the block an object places, through its matrix; null when that block wasn't made. */
function blockOf(rhino: Rhino, blocks: readonly (string | null)[], obj: ModelObject): InstanceReference | null {
  const id = obj.instance ? blocks[obj.instance.symbol] : null;
  if (!id) return null;
  const xf = transformOf(rhino, obj.instance!.matrix);
  try {
    return new (rhino.InstanceReference as unknown as new (id: string, xf: Transform) => InstanceReference)(id, xf);
  } finally {
    free(xf);
  }
}

/** A rhino3dm Transform of a placement's 12 numbers (the images of the axes, then where the origin goes). */
function transformOf(rhino: Rhino, m: readonly number[]): Transform {
  const t = new rhino.Transform(1);
  // each axis's image is a column, the origin's the last
  const columns = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9), m.slice(9, 12)];
  const cells = t as unknown as Record<string, number>;
  columns.forEach((v, c) => v.forEach((x, r) => (cells[`m${r}${c}`] = x)));
  return t;
}

/**
 * Adds the Rhino layers: one per design layer, in the drawing's order, then a sublayer for each class its objects
 * (and the objects of the symbols it is the first to place, `placedOn`) use. Returns the layer index of each
 * (layer, class) pair, keyed by `keyOf`.
 */
function addLayers(
  file: File3dm,
  rhino: Rhino,
  model: Model3D,
  flat: readonly FlatObject[],
  layerNames: ReadonlyMap<string, string>,
  placedOn: readonly string[],
): Map<string, number> {
  const groups = new Map<string, { name: string; classes: string[] }>();
  const use = (layerId: string, name: string, className: string): void => {
    let g = groups.get(layerId);
    if (!g) {
      g = { name, classes: [] };
      groups.set(layerId, g);
    }
    if (!g.classes.includes(className)) g.classes.push(className);
  };
  for (const layer of model.layers) {
    const name = layer.name || (layerNames.get(layer.id) ?? "");
    for (const obj of layer.objects) use(layer.id, name, obj.className);
    placedOn.forEach((id, k) => {
      if (id === layer.id) for (const obj of model.symbols?.[k]?.objects ?? []) use(id, name, obj.className);
    });
  }
  for (const f of flat) use(f.layerId, layerNames.get(f.layerId) ?? "", f.className);

  const out = new Map<string, number>();
  const taken = new Set<string>();
  for (const [layerId, g] of groups) {
    const top = addLayer(file, rhino, uniqueName(g.name, "Layer", taken), null);
    const inside = new Set<string>();
    for (const className of g.classes) {
      out.set(keyOf(layerId, className), addLayer(file, rhino, uniqueName(className, "None", inside), top.id).index);
    }
  }
  return out;
}

/** Adds a layer under `parentId` (none for a top-level one) and returns its index in the file and its id. */
function addLayer(file: File3dm, rhino: Rhino, name: string, parentId: string | null): { index: number; id: string } {
  const layer = new rhino.Layer();
  try {
    layer.name = name;
    if (parentId) layer.parentLayerId = parentId;
    const index = file.layers().add(layer);
    const added = file.layers().get(index);
    try {
      return { index, id: added.id };
    } finally {
      free(added);
    }
  } finally {
    free(layer);
  }
}

/** A key for a (layer, class) pair. */
function keyOf(layerId: string, className: string): string {
  return `${layerId}\n${className}`;
}

/**
 * A name Rhino takes for a layer: its path separator "::" and control characters out, never empty, and unique
 * in `taken` (case-blind), with " 2", " 3"... added to a repeat.
 */
function uniqueName(raw: string, fallback: string, taken: Set<string>): string {
  const base = raw.replace(/::/g, ":").replace(/[\u0000-\u001f]/g, " ").trim() || fallback;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * Meshes given to an extrusion as its render mesh. rhino3dm's Extrusion.setMesh gives the extrusion a second owner
 * of the mesh (a shared_ptr round the pointer the mesh's handle owns), so the mesh is freed with the extrusion, and
 * deleting its handle as well, or letting it be collected, would free it again: a handle given away is kept here
 * for good. What stays is each handle's small wrapper, not the mesh.
 */
const givenAway: Mesh[] = [];

/** A piece as Rhino geometry: an extrusion when it is an upright prism, else a mesh; null when it has no faces. */
function pieceGeometry(rhino: Rhino, piece: ModelPiece): Extrusion | Mesh | null {
  const mesh = pieceMesh(rhino, piece);
  if (!mesh) return null;
  const prism = prismOf(piece.triangles);
  const solid = prism ? prismExtrusion(rhino, prism) : null;
  if (!solid) return mesh;
  // the triangles stay as its render mesh, for readers that draw only what a file has meshed
  solid.setMesh(mesh, rhino.MeshType.Render);
  givenAway.push(mesh);
  return solid;
}

/**
 * A prism as a capped extrusion: its outline on the plane at its bottom, its holes added as inner profiles (which
 * rhino3dm takes in that plane's own coordinates, from its origin), up to its top. Null if rhino3dm refuses it.
 */
function prismExtrusion(rhino: Rhino, p: Prism): Extrusion | null {
  const o = p.outer[0];
  const plane = { ...(rhino.Plane.worldXY() as unknown as object), origin: [o.x, o.y, p.z0] } as unknown as Plane;
  const ring = (pts: readonly Pt[], local: boolean): number[][] => {
    const out = pts.map((q) => (local ? [q.x - o.x, q.y - o.y, 0] : [q.x, q.y, p.z0]));
    out.push([...out[0]]);
    return out;
  };
  const outline = new rhino.PolylineCurve(ring(p.outer, false));
  try {
    const solid = rhino.Extrusion.createWithPlane(outline, plane, p.z1 - p.z0, true);
    if (!solid) return null;
    for (const hole of p.holes) {
      const curve = new rhino.PolylineCurve(ring(hole, true));
      try {
        if (!solid.addInnerProfile(curve)) {
          free(solid);
          return null;
        }
      } finally {
        free(curve);
      }
    }
    return solid;
  } finally {
    free(outline);
  }
}

/**
 * A mesh of one piece's triangles, those with a corner twice left out: each corner shared by the triangles there
 * that meet smoothly, with their normal, and its own copy, with its own normal, on each side of a crease (faces at
 * more than CREASE); then each pair of triangles on one plane that make a good quad joined into it. A flat sliver
 * (three corners in a line) stays, joined to the first group at each corner, as it closes the mesh where a run is
 * split on one side and not the other. Null when no face is left.
 */
function pieceMesh(rhino: Rhino, piece: ModelPiece): Mesh | null {
  const t = piece.triangles;
  // the corners, by exact position, and the triangles kept, their corners and their area-weighted normals
  const at = new Map<string, number>();
  const xyz: number[] = [];
  const corner = (k: number): number => {
    const key = `${t[k]} ${t[k + 1]} ${t[k + 2]}`;
    let i = at.get(key);
    if (i === undefined) {
      i = xyz.length / 3;
      xyz.push(t[k], t[k + 1], t[k + 2]);
      at.set(key, i);
    }
    return i;
  };
  const tris: number[] = [];
  const normals: number[] = [];
  for (let k = 0; k + 8 < t.length; k += 9) {
    const a = corner(k);
    const b = corner(k + 3);
    const c = corner(k + 6);
    if (a === b || b === c || a === c) continue;
    const ux = t[k + 3] - t[k];
    const uy = t[k + 4] - t[k + 1];
    const uz = t[k + 5] - t[k + 2];
    const vx = t[k + 6] - t[k];
    const vy = t[k + 7] - t[k + 1];
    const vz = t[k + 8] - t[k + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    tris.push(a, b, c);
    normals.push(nx, ny, nz);
  }
  const count = tris.length / 3;
  if (count === 0) return null;

  // the triangles at each corner, as slots (3 per triangle) listed corner by corner
  const corners = xyz.length / 3;
  const first = new Int32Array(corners + 1);
  for (const c of tris) first[c + 1]++;
  for (let c = 0; c < corners; c++) first[c + 1] += first[c];
  const fill = first.slice(0, corners);
  const around = new Int32Array(tris.length);
  for (let j = 0; j < tris.length; j++) around[fill[tris[j]]++] = j;

  // at each corner, its triangles in groups that meet smoothly, each group a vertex with the group's normal
  const mesh = new rhino.Mesh();
  const verts = mesh.vertices();
  const vnormals = mesh.normals();
  const faces = mesh.faces();
  const vertexOf = new Int32Array(tris.length);
  try {
    const groups: { sum: [number, number, number]; slots: number[] }[] = [];
    for (let c = 0; c < corners; c++) {
      groups.length = 0;
      // the faces first, then the slivers, which have no normal of their own
      for (const slivers of [false, true]) {
        for (let s = first[c]; s < first[c + 1]; s++) {
          const slot = around[s];
          const f = (slot / 3) | 0;
          const n: [number, number, number] = [normals[3 * f], normals[3 * f + 1], normals[3 * f + 2]];
          const len = Math.hypot(...n);
          if (len > 0 === slivers) continue;
          const g = slivers ? groups[0] : groups.find((q) => (q.sum[0] * n[0] + q.sum[1] * n[1] + q.sum[2] * n[2]) / (Math.hypot(...q.sum) * len) >= CREASE);
          if (g) {
            g.sum[0] += n[0];
            g.sum[1] += n[1];
            g.sum[2] += n[2];
            g.slots.push(slot);
          } else groups.push({ sum: n, slots: [slot] });
        }
      }
      for (const g of groups) {
        const v = verts.add(xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]);
        // a corner only slivers meet at points up, having no better way
        const len = Math.hypot(...g.sum);
        if (len > 0) vnormals.add(g.sum[0] / len, g.sum[1] / len, g.sum[2] / len);
        else vnormals.add(0, 0, 1);
        for (const slot of g.slots) vertexOf[slot] = v;
      }
    }
    const quads = quadPairs(vertexOf, normals, xyz, tris);
    for (const [a, b, c, d] of quads.quads) faces.addQuadFace(a, b, c, d);
    for (const f of quads.single) faces.addTriFace(vertexOf[3 * f], vertexOf[3 * f + 1], vertexOf[3 * f + 2]);
  } finally {
    free(verts);
    free(vnormals);
    free(faces);
  }
  return mesh;
}

/**
 * Triangles joined in pairs into quads where they share an edge (the same two vertices, run opposite ways), lie
 * flat together (QUAD_FLAT) and make a convex quad turning at every corner (QUAD_TURN): rhino3dm's own
 * convertTrianglesToQuads joins a flat sliver into a quad with a corner on a straight run and then loses that
 * corner, opening the mesh. Longer shared edges are tried first, as a rectangle's diagonal is its longest. `vertexOf`
 * gives each triangle's three vertices, `normals` its area-weighted normal, `tris` its three corners in `xyz`.
 */
function quadPairs(vertexOf: Int32Array, normals: readonly number[], xyz: readonly number[], tris: readonly number[]): { quads: number[][]; single: number[] } {
  const count = vertexOf.length / 3;
  const len = (f: number): number => Math.hypot(normals[3 * f], normals[3 * f + 1], normals[3 * f + 2]);
  const at = (slot: number): number[] => {
    const c = tris[slot];
    return [xyz[3 * c], xyz[3 * c + 1], xyz[3 * c + 2]];
  };
  // each edge, from vertex u to vertex v, by the triangle and slot that runs it
  const runs = new Map<string, number[]>();
  for (let f = 0; f < count; f++) {
    if (!(len(f) > 0)) continue;
    for (let k = 0; k < 3; k++) {
      const key = `${vertexOf[3 * f + k]} ${vertexOf[3 * f + ((k + 1) % 3)]}`;
      const list = runs.get(key);
      if (list) list.push(3 * f + k);
      else runs.set(key, [3 * f + k]);
    }
  }
  const pairs: { slot: number; other: number; length: number }[] = [];
  for (const [key, slots] of runs) {
    const [u, v] = key.split(" ");
    const back = runs.get(`${v} ${u}`);
    if (slots.length !== 1 || back?.length !== 1 || slots[0] > back[0]) continue;
    const [p, q] = [at(slots[0]), at(3 * ((slots[0] / 3) | 0) + ((slots[0] + 1) % 3))];
    pairs.push({ slot: slots[0], other: back[0], length: Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) });
  }
  pairs.sort((a, b) => b.length - a.length);
  const paired = new Uint8Array(count);
  const quads: number[][] = [];
  for (const { slot, other } of pairs) {
    const f = (slot / 3) | 0;
    const g = (other / 3) | 0;
    if (paired[f] || paired[g] || f === g) continue;
    const nf = normals.slice(3 * f, 3 * f + 3);
    const ng = normals.slice(3 * g, 3 * g + 3);
    if ((nf[0] * ng[0] + nf[1] * ng[1] + nf[2] * ng[2]) / (len(f) * len(g)) < QUAD_FLAT) continue;
    // f runs u→v→w, g runs v→u→x: the quad is u, x, v, w
    const k = slot % 3;
    const j = other % 3;
    const slots = [3 * f + k, 3 * g + ((j + 2) % 3), 3 * f + ((k + 1) % 3), 3 * f + ((k + 2) % 3)];
    const pts = slots.map(at);
    const n = [nf[0] + ng[0], nf[1] + ng[1], nf[2] + ng[2]];
    const convex = pts.every((p, i) => {
      const a = pts[(i + 3) % 4];
      const b = pts[(i + 1) % 4];
      const e1 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const e2 = [b[0] - p[0], b[1] - p[1], b[2] - p[2]];
      const turn = (e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2];
      return turn > QUAD_TURN * Math.hypot(...e1) * Math.hypot(...e2) * Math.hypot(...n);
    });
    if (!convex) continue;
    paired[f] = paired[g] = 1;
    quads.push(slots.map((sl) => vertexOf[sl]));
  }
  const single: number[] = [];
  for (let f = 0; f < count; f++) if (!paired[f]) single.push(f);
  return { quads, single };
}

/** Attributes for an object on a layer, coloured by the object (when it has a colour) and named. */
function attributes(rhino: Rhino, layerIndex: number, colour: string | undefined, name = ""): ObjectAttributes {
  const a = new rhino.ObjectAttributes();
  a.name = name;
  a.layerIndex = layerIndex;
  if (colour) {
    a.colorSource = rhino.ObjectColorSource.ColorFromObject;
    a.objectColor = rgbOf(colour);
  }
  return a;
}

/** A 2D object written as its Rhino counterpart at its z; shapes with no Rhino form are left out. */
function writeFlat(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, f: FlatObject, layerIndex: number): void {
  const s: Shape = f.shape;
  const attrs = attributes(rhino, layerIndex, f.color);
  try {
    switch (s.kind) {
      case "line": {
        if (s.points.length < 2) break;
        const [a, b] = s.points;
        objects.addLine(at3(a, f.z), at3(b, f.z), attrs);
        break;
      }
      case "rect":
      case "polygon":
      case "polyline": {
        for (const ring of s.closed ? ringsOf(s.points) : [s.points]) {
          const pts = ring.map((p) => at3(p, f.z));
          if (s.closed && pts.length) pts.push([...pts[0]]);
          if (pts.length >= 2) objects.addPolyline(pts, attrs);
        }
        break;
      }
      case "arc":
        writeArc(rhino, objects, s, f.z, attrs);
        break;
      case "text":
        writeText(rhino, objects, s, f.z, f.scale, attrs);
        break;
      case "locus": {
        const p = s.points[0];
        if (p) objects.addPoint(at3(p, f.z), attrs);
        break;
      }
      default:
        break;
    }
  } finally {
    free(attrs);
  }
}

/**
 * An arc: a circle when complete, an arc when circular (its radius the x one) and a sampled polyline when
 * elliptical. Its sweep counts from its start, counter-clockwise when positive.
 */
function writeArc(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, s: Shape, z: number, attrs: ObjectAttributes): void {
  const c = s.center;
  if (!c || s.rx === undefined || s.ry === undefined) return;
  const rx = Math.abs(s.rx);
  const ry = Math.abs(s.ry);
  const a0 = s.startAngle ?? 0;
  const sweep = s.sweepAngle ?? 0;
  if (sweep === 0 || !(rx > 0) || !(ry > 0)) return;
  const full = Math.abs(sweep) >= 360;
  if (Math.abs(rx - ry) <= 1e-6 * Math.max(rx, ry, 1)) {
    if (full) {
      const circle = new rhino.Circle([c.x, c.y, z], rx);
      try {
        objects.addCircle(circle, attrs);
      } finally {
        free(circle);
      }
      return;
    }
    // three points on the arc fix it, its middle one giving the way round
    const pt = (deg: number): number[] => [c.x + rx * Math.cos(rad(deg)), c.y + rx * Math.sin(rad(deg)), z];
    const arc = rhino.Arc.createFromPoints(pt(a0), pt(a0 + sweep / 2), pt(a0 + sweep));
    try {
      objects.addArc(arc, attrs);
    } finally {
      free(arc);
    }
    return;
  }
  // an ellipse has no Rhino arc here, so it is sampled
  const total = full ? Math.sign(sweep) * 360 : sweep;
  const count = full ? ELLIPSE_SEGMENTS : ELLIPSE_SEGMENTS + 1;
  const pts: number[][] = [];
  for (let i = 0; i < count; i++) pts.push(at3(arcPoint(c, rx, ry, a0 + (total * i) / ELLIPSE_SEGMENTS), z));
  if (full) pts.push([...pts[0]]);
  objects.addPolyline(pts, attrs);
}

/**
 * Text as a text dot at the anchor, its font height the text's size in points on a layer at 1:`scale` (whole, at
 * least MIN_DOT_POINTS; a dot keeps no finer size and no rotation).
 */
function writeText(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, s: Shape, z: number, scale: number, attrs: ObjectAttributes): void {
  const at = s.anchor ?? (s.bbox ? { x: s.bbox.x0, y: s.bbox.y0 } : null);
  if (!s.text || !at) return;
  const text = s.text.replace(/\r\n|\r/g, "\n");
  const points = s.textSize !== undefined && s.textSize > 0 ? s.textSize / (MM_PER_PT * (scale > 0 ? scale : 1)) : DEFAULT_POINTS;
  const id = objects.addTextDot(text, at3(at, z), attrs);
  const o = objects.findId(id);
  try {
    const g = o.geometry();
    try {
      if (g instanceof rhino.TextDot) g.fontHeight = Math.max(MIN_DOT_POINTS, Math.round(points));
    } finally {
      free(g);
    }
  } finally {
    free(o);
  }
}

/**
 * A closed outline's rings: the outline itself, or, when it runs round holes through cuts (a fill's outline that
 * goes out along an edge to a hole, round it and back along the same edge), each ring the cuts join, without the
 * cuts. Points match by their exact coordinates, as a cut's ends repeat its corners.
 */
export function ringsOf(points: readonly Pt[]): Pt[][] {
  const n = points.length;
  const key = (i: number): string => `${points[i % n].x} ${points[i % n].y}`;
  const runs = new Set<string>();
  for (let i = 0; i < n; i++) runs.add(`${key(i)}|${key(i + 1)}`);
  // an edge whose reverse is also an edge is a cut
  const kept = Array.from({ length: n }, (_, i) => key(i) !== key(i + 1) && !runs.has(`${key(i + 1)}|${key(i)}`));
  if (kept.every(Boolean) || n < 4) return [points.slice()];
  const from = new Map<string, number[]>();
  for (let i = 0; i < n; i++) if (kept[i]) from.set(key(i), [...(from.get(key(i)) ?? []), i]);
  const used = new Array<boolean>(n).fill(false);
  const rings: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    if (!kept[i] || used[i]) continue;
    const ring: Pt[] = [];
    for (let j = i; j >= 0 && !used[j]; ) {
      used[j] = true;
      ring.push(points[j]);
      // back where it started; else the next edge from where this one ends: the one after it when it was
      // kept, else any not yet taken
      if (key(j + 1) === key(i)) break;
      const next = from.get(key(j + 1))?.filter((e) => !used[e]) ?? [];
      j = next.includes((j + 1) % n) ? (j + 1) % n : (next[0] ?? -1);
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** A plan point at z, as rhino3dm takes a point. */
function at3(p: Pt, z: number): number[] {
  return [p.x, p.y, z];
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** A "#rrggbb" colour as rhino3dm's colour object (0..255 channels, opaque); black when it isn't one. */
function rgbOf(hex: string): { r: number; g: number; b: number; a: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0, a: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 255 };
}

/**
 * Frees a rhino3dm object (its wasm memory); the typings leave `delete` out. The file's own tables (objects, layers,
 * materials, dimension styles) are views into the file and go with it, and their `delete(id)` would shadow this.
 */
function free(o: object | null | undefined): void {
  (o as { delete?: () => void } | null | undefined)?.delete?.();
}
