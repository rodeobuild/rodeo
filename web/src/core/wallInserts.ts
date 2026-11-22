// Doors, windows and symbols set in walls: cutting the hole one needs through its wall and closing
// the hole it leaves, in the wall's plan drawing (wallCutPlan.ts), in the solids it caches for 3D
// (wallCut3d.ts) and in the wall record's own list of breaks (wallBreaks.ts), so one can be set in
// any straight wall, moved along it or to another, flipped, copied, taken out and deleted
// (FORMAT.md §7, Openings in walls). The edit session lends what these need of it (WallInsertHost),
// so the wall code there stays as it is. Each call changes one plan and commits it once.
//
// A hole is never kept beside the wall: it is read back from the wall as it is drawn, the gap in its
// plan drawing about the insert's origin and the height of the jamb faces of its solids there, so a
// hole Vectorworks cut and one Rodeo cut close alike.

import { edgesBody } from "./builtins.ts";
import { outward } from "./csg.ts";
import { PLUGIN_MATRIX, readInstanceMatrix, readPluginMatrix, reshapeRecord, writeGeometry } from "./encode.ts";
import { f64, setF64, setU16, u16, u32 } from "./bytes.ts";
import { guidOf, objectChildren, subtreeEnd, type Model } from "./model.ts";
import { bodyGeometry, objectTriangles } from "./model3d.ts";
import { Rec } from "./records.ts";
import type { Pt } from "./types.ts";
import { addSymbolBreak, moveWallBreak, readWallBreaks, removeWallBreak, solveBreakSizes, symbolBlockFromHead, symbolBreakFlags, wallComponentCount, type WallBreakSizes } from "./wallBreaks.ts";
import { cutOpening, fillOpening, lastRefusal, solidVolume, type WallFrame } from "./wallCut3d.ts";
import { closePlanOpening, cutPlanOpening, type PlanChange, type PlanPart } from "./wallCutPlan.ts";

const WALL = 68;
const PLUGIN = 86;
const SYMBOL_INSTANCE = 15;
const GROUP = 11;
const SOLID = 84;
const BODY = 114;
const MESH = 40;
const COMPONENTS = 69;
const LINE = 2;
const POLYGON = 5;
/** how far past a door's own size Vectorworks' hole may reach along the wall (finishes wrapped round the jamb), mm */
const TRIM = 60;
/** a hole stays this clear of another and of the wall's ends, mm */
const CLEAR = 2;

/** A hole through a wall: from a0 to a1 along its line from its start, from z0 up to z1 (z in the model), mm. */
export interface WallHole {
  a0: number;
  a1: number;
  z0: number;
  z1: number;
}

/** The size of the hole a door or window needs, about its origin: from x0 to x1 along the wall, from z0 to z1 above the wall's bottom, mm. */
export interface HoleSize {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** How a door or window lies in its wall. */
export interface WallInsertPlace {
  wall: string;
  /** its origin along the wall's line from its start, and across it (left positive), mm */
  along: number;
  across: number;
  /** its x axis runs against the wall's line; its y axis points to the wall's right */
  reversed: boolean;
  flipped: boolean;
  /** the wall's thickness and height, mm */
  thickness: number;
  height: number;
  /** the hole it stands in, as the wall is drawn, or null when the wall is whole there */
  hole: WallHole | null;
}

export interface PlanLike {
  cur(i: number): Uint8Array;
  mut(i: number): Uint8Array;
  set(i: number, d: Uint8Array): void;
  remove(from: number, to: number): void;
  insert(at: number, recs: Uint8Array[]): void;
}

interface WallLine {
  start: Pt;
  end: Pt;
  thickness: number;
  top: number;
  bottom: number;
}

export interface WallLayoutLike {
  line: WallLine;
  length: number;
  u: Pt;
  along(q: Pt): number;
  across(q: Pt): number;
  lo: number;
  hi: number;
  reach: number;
  spans: { o: Rec; a0: number; a1: number }[];
}

/** What the edit session lends: its plan and commit, and the wall reading it already has. */
export interface WallInsertHost {
  readonly doc: Model;
  plan(): PlanLike;
  commit(p: PlanLike, ids: string[]): void;
  object(id: string): Rec;
  wallLayout(p: PlanLike, wall: Rec): WallLayoutLike;
  /** copies of a record and what it holds, with new ids, for the child list `owner` heads */
  copies(of: Rec, owner: bigint): Uint8Array[];
  /** moves a record and what it holds by (dx, dy) in the plan */
  translate(p: PlanLike, r: Rec, dx: number, dy: number): void;
  /** a name index nothing uses */
  freshName(): number;
  setOwner(d: Uint8Array, owner: bigint): void;
  /** refits the groups above records that changed or went */
  refit(p: PlanLike, recs: Rec[]): void;
  /** the id of the record `d` heads */
  idOf(d: Uint8Array): string;
  /** a mesh's records for the child list `owner` heads, in class `cls`: one face per ring of `faces` (x, y, z each corner, in the list's frame) */
  meshRecords(owner: bigint, cls: number, faces: readonly (readonly number[])[]): Uint8Array[];
}

/** One solid a wall caches for 3D: what holds it, its body (null where Rodeo keeps meshes in its place), and its triangles in the drawing. */
interface WallSolid {
  holder: Rec;
  body: Rec | null;
  meshes: Rec[];
  tris: Float64Array;
}

const isInsert = (r: Rec): boolean => (r.type === PLUGIN || r.type === SYMBOL_INSTANCE) && r.parent?.type === WALL;

/** The plan matrix of a plug-in object or symbol. */
const matrixOf = (o: Rec, d: Uint8Array) => (o.type === PLUGIN ? readPluginMatrix(d) : readInstanceMatrix(d));

export class WallInserts {
  private sizes: WallBreakSizes | null | undefined;
  /** how many of a wall's solids the last edit left as they were, of how many it has there */
  private note: { left: number; of: number } | null = null;

  /** What the edits since the last call left undone in a wall's 3D, to tell the user; null when all of it was rebuilt. */
  takeNote(): { left: number; of: number } | null {
    const n = this.note;
    this.note = null;
    return n;
  }

  constructor(private readonly host: WallInsertHost) {}

  // ---- reading -------------------------------------------------------------------------------

  /** How the insert `id` lies in its wall, or null when it isn't set in one. */
  place(id: string): WallInsertPlace | null {
    const o = this.host.object(id);
    if (!isInsert(o)) return null;
    const p = this.host.plan();
    const wall = o.parent!;
    const g = this.host.wallLayout(p, wall);
    const m = matrixOf(o, p.cur(o.index));
    const at = { x: m.e, y: m.f };
    return {
      wall: guidOf(wall),
      along: g.along(at),
      across: g.across(at),
      reversed: m.a * g.u.x + m.b * g.u.y < 0,
      flipped: -m.c * g.u.y + m.d * g.u.x < 0,
      thickness: g.line.thickness,
      height: g.line.top - g.line.bottom,
      hole: this.holeAt(p, wall, g, g.along(at)),
    };
  }

  /** Where `at` lies along the straight wall `wallId`, with the wall's size, or why nothing can be set there. */
  spot(wallId: string, at: Pt): { along: number; thickness: number; height: number; length: number } {
    const wall = this.host.object(wallId);
    if (wall.type !== WALL) throw new Error("a door or window goes in a wall");
    const g = this.host.wallLayout(this.host.plan(), wall);
    return { along: g.along(at), thickness: g.line.thickness, height: g.line.top - g.line.bottom, length: g.length };
  }

  // ---- editing -------------------------------------------------------------------------------

  /**
   * Sets the new plug-in object `id` (made under the wall, its matrix placed already) into its wall:
   * the hole of `size` about its origin is cut, and the wall's breaks take it in.
   */
  set(id: string, size: HoleSize): void {
    const o = this.host.object(id);
    if (!isInsert(o)) throw new Error("that object isn't set in a wall");
    const wall = o.parent!;
    const p = this.host.plan();
    const g = this.host.wallLayout(p, wall);
    const m = matrixOf(o, p.cur(o.index));
    const t = g.along({ x: m.e, y: m.f });
    const hole = this.holeOf(g, t, m.a * g.u.x + m.b * g.u.y < 0, size);
    this.fits(p, wall, g, hole, o);
    this.rework(p, wall, g, [], [hole]);
    if (!u16(p.cur(o.index), 0x1a)) setU16(p.mut(o.index), 0x1a, this.freshRef());
    this.syncBreaks(p, wall, g, { add: o });
    this.host.commit(p, [guidOf(o), guidOf(wall)]);
  }

  /** Gives the insert `id` a hole of another size (its parameters changed): the old one closes and the new one is cut. */
  resize(id: string, size: HoleSize): void {
    const o = this.host.object(id);
    if (!isInsert(o)) return;
    const wall = o.parent!;
    const p = this.host.plan();
    const g = this.host.wallLayout(p, wall);
    const m = matrixOf(o, p.cur(o.index));
    const t = g.along({ x: m.e, y: m.f });
    const was = this.holeAt(p, wall, g, t);
    const now = this.holeOf(g, t, m.a * g.u.x + m.b * g.u.y < 0, size);
    if (was && sameHole(was, now)) return;
    this.fits(p, wall, g, now, o);
    this.rework(p, wall, g, was ? [was] : [], [now]);
    this.host.commit(p, [guidOf(o), guidOf(wall)]);
  }

  /** Slides the insert along its wall by `d` mm (towards its end), its hole with it. */
  slide(id: string, d: number): void {
    const o = this.host.object(id);
    if (!isInsert(o)) throw new Error("that object isn't set in a wall");
    if (Math.abs(d) < 1e-9) return;
    const wall = o.parent!;
    const p = this.host.plan();
    const g = this.host.wallLayout(p, wall);
    const m = matrixOf(o, p.cur(o.index));
    const t = g.along({ x: m.e, y: m.f });
    const was = this.holeAt(p, wall, g, t);
    const now = was ? { ...was, a0: was.a0 + d, a1: was.a1 + d } : null;
    if (now) this.fits(p, wall, g, now, o);
    else if (!(t + d > 0 && t + d < g.length)) throw new Error("it would leave its wall: there's no room to slide it that far");
    if (was && now) this.rework(p, wall, g, [was], [now]);
    this.host.translate(p, o, g.u.x * d, g.u.y * d);
    this.syncBreaks(p, wall, g, { move: o, to: t + d });
    this.host.refit(p, [o]);
    this.host.commit(p, [guidOf(o), guidOf(wall)]);
  }

  /** Turns the insert round in its wall: `along` swaps its ends (a door's hinge side), `across` the side it faces. */
  flip(id: string, way: "along" | "across" | "both"): void {
    const o = this.host.object(id);
    if (!isInsert(o)) throw new Error("that object isn't set in a wall");
    if (o.type !== PLUGIN) throw new Error("a symbol set in a wall can't be flipped yet");
    const wall = o.parent!;
    const p = this.host.plan();
    const g = this.host.wallLayout(p, wall);
    const d = p.mut(o.index);
    const m = readPluginMatrix(d);
    const t = g.along({ x: m.e, y: m.f });
    const x = g.across({ x: m.e, y: m.f });
    const was = this.holeAt(p, wall, g, t);
    const n = { x: -g.u.y, y: g.u.x };
    // each axis in the wall's terms, turned round, and the origin put the same way about the centre line
    const flipAlong = way !== "across";
    const flipAcross = way !== "along";
    const axis = (ax: number, ay: number): [number, number] => {
      const al = (ax * g.u.x + ay * g.u.y) * (flipAlong ? -1 : 1);
      const ac = (ax * n.x + ay * n.y) * (flipAcross ? -1 : 1);
      return [g.u.x * al + n.x * ac, g.u.y * al + n.y * ac];
    };
    const [a, b] = axis(m.a, m.b);
    const [c, e] = axis(m.c, m.d);
    setF64(d, PLUGIN_MATRIX, a);
    setF64(d, PLUGIN_MATRIX + 8, b);
    setF64(d, PLUGIN_MATRIX + 24, c);
    setF64(d, PLUGIN_MATRIX + 32, e);
    if (flipAcross && Math.abs(x) > 1e-9) this.host.translate(p, o, -2 * x * n.x, -2 * x * n.y);
    // a hole that doesn't lie evenly about the origin goes over to the other side of it
    if (was && flipAlong) {
      const now = { ...was, a0: 2 * t - was.a1, a1: 2 * t - was.a0 };
      // only a hole that lies unevenly about the origin (a side light on one side) is cut again
      if (Math.abs(now.a0 - was.a0) > 1) {
        this.fits(p, wall, g, now, o);
        this.rework(p, wall, g, [was], [now]);
      }
    }
    this.syncBreaks(p, wall, g, { flags: o });
    this.host.refit(p, [o]);
    this.host.commit(p, [guidOf(o), guidOf(wall)]);
  }

  /** Takes the inserts out of their walls' records and drawings: each hole closes and its break goes; the records are left for the caller's plan to remove or move. */
  release(p: PlanLike, inserts: readonly Rec[]): Rec[] {
    const walls = new Map<Rec, Rec[]>();
    for (const o of inserts) if (isInsert(o)) walls.set(o.parent!, [...(walls.get(o.parent!) ?? []), o]);
    for (const [wall, list] of walls) {
      const g = this.host.wallLayout(p, wall);
      const holes: WallHole[] = [];
      for (const o of list) {
        const m = matrixOf(o, p.cur(o.index));
        const hole = this.holeAt(p, wall, g, g.along({ x: m.e, y: m.f }));
        if (hole) holes.push(hole);
      }
      this.rework(p, wall, g, holes, []);
      for (const o of list) this.syncBreaks(p, wall, g, { remove: o });
    }
    return [...walls.keys()];
  }

  /**
   * Copies the insert `id` into the wall `wallId` (its own when left out) with its origin at `along`
   * there, facing as it does in its wall, and cuts its hole; with `move` the original goes and its
   * hole closes. The new insert's id.
   */
  copyTo(id: string, wallId: string | undefined, along: number, move: boolean): string {
    const o = this.host.object(id);
    if (!isInsert(o)) throw new Error("that object isn't set in a wall");
    const from = o.parent!;
    const to = wallId === undefined ? from : this.host.object(wallId);
    if (to.type !== WALL) throw new Error("a door or window goes in a wall");
    const p = this.host.plan();
    const g0 = this.host.wallLayout(p, from);
    const g1 = to === from ? g0 : this.host.wallLayout(p, to);
    const d0 = p.cur(o.index);
    const m = matrixOf(o, d0);
    const t = g0.along({ x: m.e, y: m.f });
    const x = g0.across({ x: m.e, y: m.f });
    const was = this.holeAt(p, from, g0, t);
    // the hole keeps its size about the origin and its height above the wall's bottom
    const now = was ? { a0: along + was.a0 - t, a1: along + was.a1 - t, z0: was.z0 - g0.line.bottom + g1.line.bottom, z1: was.z1 - g0.line.bottom + g1.line.bottom } : null;
    if (move && to === from) throw new Error("slide it along its wall instead");
    if (now) this.fits(p, to, g1, now, null);
    else if (!(along > 0 && along < g1.length)) throw new Error("it doesn't fit there: it would reach past the wall's end");
    const term = to.children.at(-1);
    if (!term || term.type !== 0) throw new Error("that wall has no list to hold a door or window");
    // moved, it stays the record it is; copied, the copy is named anew for its break
    let recs: Uint8Array[];
    if (move) {
      recs = [];
      for (let i = o.index; i <= subtreeEnd(o); i++) recs.push(i === o.index ? p.cur(i).slice() : p.cur(i));
      this.host.setOwner(recs[0], term.owner);
    } else {
      recs = this.host.copies(o, term.owner);
      setU16(recs[0], 0x1a, this.freshRef());
    }
    const root = recs[0];
    // from its wall's frame into the other's: each axis keeps its lie along and across, the origin goes to `along`
    const n0 = { x: -g0.u.y, y: g0.u.x };
    const n1 = { x: -g1.u.y, y: g1.u.x };
    const axis = (ax: number, ay: number): [number, number] => {
      const al = ax * g0.u.x + ay * g0.u.y;
      const ac = ax * n0.x + ay * n0.y;
      return [g1.u.x * al + n1.x * ac, g1.u.y * al + n1.y * ac];
    };
    const origin = { x: g1.line.start.x + g1.u.x * along + n1.x * x, y: g1.line.start.y + g1.u.y * along + n1.y * x };
    if (o.type === PLUGIN) {
      const [a, b] = axis(m.a, m.b);
      const [c, e] = axis(m.c, m.d);
      [a, b].forEach((v, i) => setF64(root, PLUGIN_MATRIX + 8 * i, v));
      [c, e].forEach((v, i) => setF64(root, PLUGIN_MATRIX + 24 + 8 * i, v));
      setF64(root, PLUGIN_MATRIX + 72, origin.x);
      setF64(root, PLUGIN_MATRIX + 80, origin.y);
      setF64(root, PLUGIN_MATRIX + 88, f64(d0, PLUGIN_MATRIX + 88) - g0.line.bottom + g1.line.bottom);
    } else if (to !== from) {
      throw new Error("a symbol set in a wall can't go to another wall yet");
    }
    p.insert(term.index, recs);
    if (o.type !== PLUGIN) {
      // a symbol keeps its turn: only its place along the wall changes, once it is in the drawing
      throw new Error("a symbol set in a wall can't be copied along it yet");
    }
    let spare: Uint8Array | undefined;
    if (move) {
      spare = this.breakBlock(p, from, o);
      this.release(p, [o]);
      p.remove(o.index, subtreeEnd(o));
    } else {
      spare = this.breakBlock(p, from, o);
    }
    if (now) this.rework(p, to, g1, [], [now]);
    this.syncBreaks(p, to, g1, { addData: root, addAt: along, like: o, spare });
    this.host.refit(p, [o]);
    const nid = this.host.idOf(root);
    this.host.commit(p, [guidOf(o), guidOf(from), guidOf(to), nid]);
    return nid;
  }

  // ---- holes ---------------------------------------------------------------------------------

  /** The hole of `size` about an origin at `t` along the wall; `reversed` when the insert's x axis runs against the wall's line. */
  private holeOf(g: WallLayoutLike, t: number, reversed: boolean, size: HoleSize): WallHole {
    if (![size.x0, size.x1, size.z0, size.z1].every(Number.isFinite) || !(size.x1 - size.x0 > 1 && size.z1 - size.z0 > 1)) throw new Error("a door's or window's opening has a width and a height");
    const [a0, a1] = reversed ? [t - size.x1, t - size.x0] : [t + size.x0, t + size.x1];
    return { a0, a1, z0: g.line.bottom + size.z0, z1: g.line.bottom + size.z1 };
  }

  /** Throws unless `hole` lies clear of the wall's ends and of the holes of what else is set in it (`self` aside). */
  private fits(p: PlanLike, wall: Rec, g: WallLayoutLike, hole: WallHole, self: Rec | null): void {
    if (curved(wall)) throw new Error("a round wall can't take a door or window yet");
    if (!(hole.a0 > CLEAR && hole.a1 < g.length - CLEAR)) throw new Error("it doesn't fit there: it would reach the wall's end");
    if (!(hole.z0 < g.line.top && hole.z1 > g.line.bottom)) throw new Error("it doesn't fit there: its opening lies above or below the wall");
    for (const s of g.spans) {
      if (s.o === self) continue;
      const m = matrixOf(s.o, p.cur(s.o.index));
      const other = this.holeAt(p, wall, g, g.along({ x: m.e, y: m.f }));
      const [b0, b1] = other ? [other.a0, other.a1] : [s.a0, s.a1];
      if (hole.a1 > b0 - CLEAR && hole.a0 < b1 + CLEAR && (!other || (hole.z1 > other.z0 && hole.z0 < other.z1))) throw new Error("it doesn't fit there: another door or window is in the way");
    }
  }

  /**
   * The hole through the wall about `t` along it, as the wall is drawn: the widest gap in its plan
   * polygons there, and the height of its solids' jamb faces at the gap's sides (the wall's whole
   * height where it caches no solids). Null when the wall is whole there.
   */
  private holeAt(p: PlanLike, wall: Rec, g: WallLayoutLike, t: number): WallHole | null {
    const polys = this.parts(p, wall, g).filter((q) => q.kind === "polygon");
    // the gap about t on each of nine lines along the wall; finishes wrapped round a jamb narrow it on
    // theirs, so the hole is the widest of those within the wraps' reach of the narrowest
    const gaps: [number, number][] = [];
    for (let i = 1; i <= 9; i++) {
      const y = g.lo + ((g.hi - g.lo) * i) / 10;
      const xs: [number, number][] = [];
      for (const poly of polys) xs.push(...crossings(poly.points, y));
      if (!xs.length || xs.some(([x0, x1]) => t > x0 + 0.01 && t < x1 - 0.01)) continue;
      const left = Math.max(...xs.filter(([, x1]) => x1 <= t + 0.01).map(([, x1]) => x1), -Infinity);
      const right = Math.min(...xs.filter(([x0]) => x0 >= t - 0.01).map(([x0]) => x0), Infinity);
      if (Number.isFinite(left) && Number.isFinite(right)) gaps.push([left, right]);
    }
    const least = Math.min(...gaps.map(([l, r]) => r - l));
    let gap: [number, number] | null = null;
    for (const c of gaps) if (c[1] - c[0] <= least + 2 * TRIM + 1 && (!gap || c[1] - c[0] > gap[1] - gap[0])) gap = c;
    if (!gap) return null;
    // its height: where the wall's solids stand at the middle of the gap (the wall below a sill, over a head), the
    // opening is the widest stretch of the wall's height they leave free. Read so, a round window's hole has its
    // whole height, which no flat jamb would give
    const mid = (gap[0] + gap[1]) / 2;
    const stands: [number, number][] = [];
    const drawn = this.solids(wall, SOLID);
    for (const { tris } of drawn.length ? drawn : this.solids(wall, GROUP)) {
      for (let i = 0; i + 8 < tris.length; i += 9) {
        const a = [0, 3, 6].map((k) => g.along({ x: tris[i + k], y: tris[i + k + 1] }));
        const zs: number[] = [];
        for (const [j, k] of [[0, 1], [1, 2], [2, 0]]) {
          if (a[j] <= mid === a[k] <= mid) continue;
          const f = (mid - a[j]) / (a[k] - a[j]);
          zs.push(tris[i + 3 * j + 2] + f * (tris[i + 3 * k + 2] - tris[i + 3 * j + 2]));
        }
        if (zs.length === 2 && Math.abs(zs[0] - zs[1]) > 1e-6) stands.push([Math.min(zs[0], zs[1]), Math.max(zs[0], zs[1])]);
      }
    }
    stands.sort((p, q) => p[0] - q[0]);
    let z0 = g.line.bottom;
    let z1 = g.line.top;
    if (stands.length) {
      // the free stretches between what stands, from the wall's bottom to its top
      let best = 0;
      let at = Math.min(g.line.bottom, stands[0][0]);
      const top = Math.max(g.line.top, ...stands.map((p) => p[1]));
      for (const [lo, hi] of [...stands, [top, top] as [number, number]]) {
        if (lo - at > best) {
          best = lo - at;
          [z0, z1] = [at, lo];
        }
        at = Math.max(at, hi);
      }
      if (!(best > 1)) return null;
    }
    if (!(z1 > z0)) [z0, z1] = [g.line.bottom, g.line.top];
    return { a0: gap[0], a1: gap[1], z0, z1 };
  }

  /** Closes `closes` and cuts `cuts` through the wall's plan drawing and its solids, in the plan. */
  private rework(p: PlanLike, wall: Rec, g: WallLayoutLike, closes: readonly WallHole[], cuts: readonly WallHole[]): void {
    if (!closes.length && !cuts.length) return;
    // the plan drawing: each step works on the parts as the last left them
    const first = this.parts(p, wall, g);
    const recs = new Map(first.map((q) => [q.id, q.rec]));
    let parts: (PlanPart & { like: string })[] = first.map((q) => ({ id: q.id, kind: q.kind, group: q.group, points: q.points, like: q.id }));
    let made = 0;
    const apply = (changes: PlanChange[]): void => {
      for (const c of changes) {
        if (c.op === "set") parts = parts.map((q) => (q.id === c.id ? { ...q, points: c.points } : q));
        else if (c.op === "remove") parts = parts.filter((q) => q.id !== c.id);
        else {
          const like = parts.find((q) => q.id === c.like);
          if (like) parts.push({ id: `new${made++}`, kind: c.kind, group: like.group, points: c.points, like: like.like });
        }
      }
    };
    for (const h of closes) apply(closePlanOpening(parts, h.a0, h.a1, TRIM));
    for (const h of cuts) apply(cutPlanOpening(parts, h.a0, h.a1));
    const world = (q: Pt): Pt => ({ x: g.line.start.x + g.u.x * q.x - g.u.y * q.y, y: g.line.start.y + g.u.y * q.x + g.u.x * q.y });
    const shaped = (d: Uint8Array, q: PlanPart): Uint8Array =>
      q.kind === "line" ? writeGeometry(d, { kind: "line", a: world(q.points[0]), b: world(q.points[1]) }) : writeGeometry(d, { kind: "polygon", points: q.points.map(world), closed: true });
    const kept = new Set(parts.map((q) => q.id));
    for (const q of first) if (!kept.has(q.id)) p.remove(q.rec.index, subtreeEnd(q.rec));
    const term = wall.children.at(-1)!;
    for (const q of parts) {
      const r = recs.get(q.id);
      if (r) {
        const was = first.find((x) => x.id === q.id)!;
        if (!samePoints(was.points, q.points)) p.set(r.index, shaped(p.cur(r.index), q));
        continue;
      }
      // a new piece: a copy of the record it is drawn like, straight after it
      const like = recs.get(q.like);
      if (!like) continue;
      const copy = this.host.copies(like, like.owner);
      copy[0] = shaped(copy[0], q);
      p.insert(Math.min(subtreeEnd(like) + 1, term.index), copy);
    }
    // the solids. Vectorworks keeps each component whole in the wall's group, with one more solid
    // there spanning each opening, and the components as they are cut in its solid additions, which
    // are what is drawn: so those are cut and closed, a closed opening's own solid goes from the
    // group, and the group's whole ones stay. A wall with no solid additions (a plain wall) has its
    // one cached solid in the group, and that is cut.
    const frame: WallFrame = { start: g.line.start, u: g.u };
    const drawn = this.solids(wall, SOLID);
    if (drawn.length) {
      for (const { body, tris: pts } of this.solids(wall, GROUP)) {
        if (!body || !pts.length) continue;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < pts.length; i += 3) {
          const a = g.along({ x: pts[i], y: pts[i + 1] });
          lo = Math.min(lo, a);
          hi = Math.max(hi, a);
        }
        if (closes.some((h) => lo > h.a0 - TRIM && hi < h.a1 + TRIM && hi - lo > (h.a1 - h.a0) / 2)) p.remove(body.index, subtreeEnd(body));
      }
    }
    // each solid on its own: one that can't be rebuilt there (a part that curves, a top the opening reaches, faces
    // that don't make a solid again once written) stays as it was while the others change, and the edit says so;
    // with none changed, the wall's 3D would be wholly wrong, and the edit is refused
    let tried = 0;
    let changed = 0;
    let why = "";
    // why a solid couldn't be taken apart, as the user is told: the two causes worth naming, else the plain one
    const reason = (): string => {
      const r = lastRefusal();
      if (r.includes("differs on the two sides")) return "the wall differs on the two sides of the opening";
      if (r.includes("lean both")) return "the wall there has faces that lean both along it and across it";
      return "a part of the wall there doesn't rebuild as a solid";
    };
    for (const part of drawn.length ? drawn : this.solids(wall, GROUP)) {
      if (part.tris.length < 36) continue;
      // the reader's triangles face either way round: turned outward, a solid has a volume and a
      // sheet (a face or centre line cached beside the solids) none, with no inside to cut or fill
      const was = outward(part.tris, 0.01);
      let tris: ArrayLike<number> = was;
      let edges: Float64Array | null = null;
      const before = Math.abs(solidVolume(was));
      if (before < 1) continue;
      let failed = "";
      for (const h of closes) {
        const r = fillOpening(tris, frame, h);
        if (!r) {
          failed = reason();
          break;
        }
        tris = r.triangles;
        edges = r.edges;
      }
      for (const h of failed ? [] : cuts) {
        const r = cutOpening(tris, frame, h);
        if (!r) {
          failed = reason();
          break;
        }
        tris = r.triangles;
        edges = r.edges;
      }
      if (failed) {
        tried++;
        why ||= failed;
        continue;
      }
      // a component the opening doesn't touch (it stops short of it, or lies above or below) stays as it is
      if (!edges || !edges.length || sameNumbers(tris, was)) continue;
      const want = Math.abs(solidVolume(outward(tris, 0.01)));
      tried++;
      // kept as its edges where they give the solid back when read (the body's faces are rebuilt from them)
      const list: [[number, number, number], [number, number, number]][] = [];
      for (let i = 0; i + 5 < edges.length; i += 6) list.push([[edges[i], edges[i + 1], edges[i + 2]], [edges[i + 3], edges[i + 4], edges[i + 5]]]);
      const d = edgesBody(list);
      const back = bodyGeometry(new Rec(d), null)?.triangles;
      const got = back ? Math.abs(solidVolume(outward(back, 0.01))) : NaN;
      if (part.body && Math.abs(got - want) <= 1e-6 * Math.max(1, want)) {
        // its place in the lists, its class and its attributes stay the old body's
        d.set(p.cur(part.body.index).subarray(0x08, 0x50), 0x08);
        p.set(part.body.index, d);
        changed++;
        continue;
      }
      // a solid whose faces don't come back from straight edges (many of a real house's don't: their faces lean,
      // or don't meet edge to edge) is kept as a mesh in its solid addition instead, which draws what it holds
      // in its own look when it has no body. What the cut or the fill returned is the solid's own triangles away
      // from the opening and a piece built from closed outlines beside it, so it is taken as it is: volumes say
      // little of a solid that doesn't close
      const shift = part.holder.type === SOLID ? frameShift(p.cur(part.holder.index)) : null;
      if (!shift) {
        why ||= "a part of the wall there doesn't rebuild as a solid";
        continue;
      }
      const owner = part.holder.children[0]?.owner;
      if (owner === undefined) {
        why ||= "a part of the wall there doesn't rebuild as a solid";
        continue;
      }
      for (const old of [part.body, ...part.meshes]) if (old) p.remove(old.index, subtreeEnd(old));
      const term = part.holder.children.at(-1);
      p.insert(term && term.type === 0 ? term.index : subtreeEnd(part.holder) + 1, this.host.meshRecords(owner, u32(p.cur(part.holder.index), 0x20), flatFaces(tris).map((f) => f.map((v, i) => v - shift[i % 3]))));
      changed++;
    }
    // with nothing changed, a new opening would be a door standing in a whole wall, so it is refused; a wall that
    // can't be closed in 3D still loses its door, and the edit says its 3D keeps the opening
    if (why && !changed && cuts.length) throw new Error(`that wall's 3D can't be changed there yet: ${why}`);
    if (why) this.note = { left: tried - changed, of: tried };
  }

  /** The wall's plan drawing: its own lines and polygons, in its coordinates (along its line, across it); those of one class draw alike and may be joined. */
  private parts(p: PlanLike, wall: Rec, g: WallLayoutLike): (PlanPart & { rec: Rec })[] {
    const out: (PlanPart & { rec: Rec })[] = [];
    for (const r of objectChildren(wall)) {
      if (r.type !== LINE && r.type !== POLYGON) continue;
      const d = p.cur(r.index);
      const points: Pt[] = [];
      reshapeRecord(d, r.type, (q) => (points.push({ x: g.along(q), y: g.across(q) }), q));
      if (r.type === LINE ? points.length !== 2 : points.length < 3) continue;
      out.push({ id: String(r.index), rec: r, kind: r.type === LINE ? "line" : "polygon", group: `${r.type}:${u32(d, 0x20)}`, points });
    }
    return out;
  }

  /**
   * The solids the wall caches for 3D, each with its triangles in the drawing: those in its solid additions (its
   * components as drawn: a body, or the meshes Rodeo keeps there in a body's place) or those in its group.
   */
  private solids(wall: Rec, holder: number): WallSolid[] {
    const out: WallSolid[] = [];
    for (const c of wall.children) {
      if (c.type !== holder) continue;
      const bodies = c.children.filter((b) => b.type === BODY);
      if (holder === GROUP) {
        for (const body of bodies) out.push({ holder: c, body, meshes: [], tris: bodyGeometry(body, this.host.doc)?.triangles ?? new Float64Array() });
        continue;
      }
      if (bodies.length === 1) {
        out.push({ holder: c, body: bodies[0], meshes: [], tris: bodyGeometry(bodies[0], this.host.doc)?.triangles ?? new Float64Array() });
        continue;
      }
      const meshes = bodies.length ? [] : objectChildren(c).filter((m) => m.type === MESH);
      if (!meshes.length) continue;
      const all: number[] = [];
      for (const { triangles } of objectTriangles(this.host.doc, c)) for (let i = 0; i < triangles.length; i++) all.push(triangles[i]);
      out.push({ holder: c, body: null, meshes, tris: Float64Array.from(all) });
    }
    return out;
  }

  // ---- the wall record's breaks ----------------------------------------------------------------

  private breakSizes(): WallBreakSizes | null {
    if (this.sizes === undefined) {
      const walls = this.host.doc.recs.filter((r) => r.type === WALL).map((r) => ({ data: r.data, components69: components69(r) }));
      this.sizes = walls.length ? solveBreakSizes(walls) : null;
    }
    return this.sizes;
  }

  /**
   * Keeps the wall record's list of breaks in step: the break of an insert that moved, went, changed
   * its facing, or came. A wall whose list doesn't read (one Rodeo made has none) is left as it is.
   */
  private syncBreaks(
    p: PlanLike,
    wall: Rec,
    g: WallLayoutLike,
    change: { move?: Rec; to?: number; remove?: Rec; flags?: Rec; add?: Rec; addData?: Uint8Array; addAt?: number; like?: Rec; spare?: Uint8Array },
  ): void {
    const sizes = this.breakSizes();
    if (!sizes) return;
    const n = wallComponentCount(components69(wall), sizes);
    if (n === null) return;
    const data = p.cur(wall.index);
    const list = readWallBreaks(data, n, sizes);
    if (!list) return;
    const refOf = (o: Rec): number => u16(p.cur(o.index), 0x1a);
    const find = (o: Rec): number => {
      const ref = refOf(o);
      return ref ? list.breaks.findIndex((b) => b.kind === 1 && b.ref === ref) : -1;
    };
    const facing = (d: Uint8Array, o: { type: number }, keep: number): number => {
      const m = o.type === PLUGIN ? readPluginMatrix(d) : readInstanceMatrix(d);
      const yLeft = -m.c * g.u.y + m.d * g.u.x;
      return symbolBreakFlags(o.type === PLUGIN, m.a * m.d - m.b * m.c < 0, yLeft < 0, keep);
    };
    if (change.move && change.to !== undefined) {
      const i = find(change.move);
      if (i >= 0) p.set(wall.index, moveWallBreak(data, list, i, change.to));
    } else if (change.remove) {
      const i = find(change.remove);
      if (i >= 0) p.set(wall.index, removeWallBreak(data, list, i));
    } else if (change.flags) {
      const i = find(change.flags);
      if (i < 0) return;
      const out = data.slice();
      setU16(out, list.breaks[i].at + 8, facing(p.cur(change.flags.index), change.flags, list.breaks[i].flags));
      p.set(wall.index, out);
    } else {
      const d = change.addData ?? (change.add ? p.cur(change.add.index) : null);
      const o = change.add ?? change.like;
      if (!d || !o) return;
      const m = o.type === PLUGIN ? readPluginMatrix(d) : readInstanceMatrix(d);
      const off = change.addAt ?? g.along({ x: m.e, y: m.f });
      // a block to copy: one of this wall's, another wall's with as many components, or one made from this wall's head
      const own = list.breaks.find((b) => b.kind === 1);
      const blocks = [own ? data.slice(own.at, own.at + own.size) : null, change.spare ?? null, symbolBlockFromHead(data, n, sizes), this.blockFor(n)];
      const height = o.type === PLUGIN ? f64(d, PLUGIN_MATRIX + 88) : 0;
      for (const block of blocks) {
        if (!block) continue;
        try {
          p.set(wall.index, addSymbolBreak(data, list, block, off, facing(d, o, 0), height, u16(d, 0x1a)));
          return;
        } catch {
          // a block of another size (a wall of more or fewer components): the next is tried
        }
      }
    }
  }

  /** The block of the insert's own break in its wall's record, to copy for one like it; undefined when it has none. */
  private breakBlock(p: PlanLike, wall: Rec, o: Rec): Uint8Array | undefined {
    const sizes = this.breakSizes();
    const n = sizes ? wallComponentCount(components69(wall), sizes) : null;
    if (!sizes || n === null) return undefined;
    const data = p.cur(wall.index);
    const ref = u16(p.cur(o.index), 0x1a);
    const b = ref ? readWallBreaks(data, n, sizes)?.breaks.find((x) => x.kind === 1 && x.ref === ref) : undefined;
    return b ? data.slice(b.at, b.at + b.size) : undefined;
  }

  /** A symbol break's block from any wall of the drawing with `n` components, to copy into one that has none; null when no wall has one. */
  private blockFor(n: number): Uint8Array | null {
    const sizes = this.breakSizes();
    if (!sizes) return null;
    for (const r of this.host.doc.recs) {
      if (r.type !== WALL || wallComponentCount(components69(r), sizes) !== n) continue;
      const b = readWallBreaks(r.data, n, sizes)?.breaks.find((x) => x.kind === 1);
      if (b) return r.data.slice(b.at, b.at + b.size);
    }
    return null;
  }

  /** A reference number no record uses at +0x1a, for a new insert's break to name it by. */
  private freshRef(): number {
    const used = new Set<number>();
    for (const r of this.host.doc.recs) used.add(u16(r.data, 0x1a));
    for (;;) {
      const n = this.host.freshName();
      if (!used.has(n)) return n;
    }
  }
}

/** The length of a wall's component record, or null when it has none. */
function components69(wall: Rec): number | null {
  return wall.children.find((x) => x.type === COMPONENTS)?.data.length ?? null;
}

/** True for a round wall: one whose plan drawing holds arcs. */
function curved(wall: Rec): boolean {
  return objectChildren(wall).some((c) => c.type === 6);
}

/** Where a solid addition keeps its own frame (FORMAT.md §7): nine numbers of its axes, then its offset. */
const FRAME_AXES = 0xcc;
const FRAME_OFFSET = 0x114;

/** How far a solid addition's own frame is set off from the drawing's, x y z, when its axes are the drawing's (as a wall's are: bare until the wall moves, then offset); null when it is turned. What it holds is in that frame. */
function frameShift(d: Uint8Array): [number, number, number] | null {
  if (FRAME_OFFSET + 24 > d.length) return null;
  for (let i = 0; i < 9; i++) if (Math.abs(f64(d, FRAME_AXES + 8 * i) - (i % 4 === 0 ? 1 : 0)) > 1e-12) return null;
  return [f64(d, FRAME_OFFSET), f64(d, FRAME_OFFSET + 8), f64(d, FRAME_OFFSET + 16)];
}

/** True when two runs of numbers are the same, number for number. */
function sameNumbers(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A triangle mesh as faces for a mesh object: triangles lying in one plane and joined side to side become one face
 * where their outline is a single ring (so a wall's flat faces draw without the diagonals across them), the rest
 * stay triangles. Each face is its corners, x y z in turn.
 */
function flatFaces(tris: ArrayLike<number>): number[][] {
  const W = 0.01;
  const key = (i: number): string => `${Math.round(tris[i] / W)},${Math.round(tris[i + 1] / W)},${Math.round(tris[i + 2] / W)}`;
  const n = Math.floor(tris.length / 9);
  const normal: (number[] | null)[] = [];
  const bySide = new Map<string, number[]>();
  for (let t = 0; t < n; t++) {
    const i = 9 * t;
    const [ux, uy, uz, vx, vy, vz] = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2], tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
    const c = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(c[0], c[1], c[2]);
    normal.push(len > 1e-6 ? c.map((v) => v / len) : null);
    for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const [ka, kb] = [key(i + a), key(i + b)];
      if (ka === kb) continue;
      const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      bySide.set(k, [...(bySide.get(k) ?? []), t]);
    }
  }
  // triangles sharing a side and a plane, gathered
  const group = new Int32Array(n).fill(-1);
  const groups: number[][] = [];
  for (let t = 0; t < n; t++) {
    if (group[t] >= 0 || !normal[t]) continue;
    const g: number[] = [];
    const stack = [t];
    group[t] = groups.length;
    while (stack.length) {
      const x = stack.pop()!;
      g.push(x);
      const i = 9 * x;
      for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
        const [ka, kb] = [key(i + a), key(i + b)];
        const pair = bySide.get(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`);
        if (!pair || pair.length !== 2) continue;
        const y = pair[0] === x ? pair[1] : pair[0];
        const [p, q] = [normal[x]!, normal[y]];
        if (group[y] >= 0 || !q || p[0] * q[0] + p[1] * q[1] + p[2] * q[2] < 0.999999) continue;
        group[y] = groups.length;
        stack.push(y);
      }
    }
    groups.push(g);
  }
  const out: number[][] = [];
  const triangle = (t: number): number[] => Array.from({ length: 9 }, (_, k) => tris[9 * t + k]);
  for (const g of groups) {
    if (g.length === 1) {
      out.push(triangle(g[0]));
      continue;
    }
    // the sides only one of the group's triangles has, each the way its triangle runs: the outline
    const next = new Map<string, { to: string; at: number[] }[]>();
    const count = new Map<string, number>();
    for (const t of g) for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const [ka, kb] = [key(9 * t + a), key(9 * t + b)];
      if (ka !== kb) count.set(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`, (count.get(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`) ?? 0) + 1);
    }
    let sides = 0;
    for (const t of g) for (const [a, b] of [[0, 3], [3, 6], [6, 0]]) {
      const [ka, kb] = [key(9 * t + a), key(9 * t + b)];
      if (ka === kb || count.get(ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`) !== 1) continue;
      next.set(ka, [...(next.get(ka) ?? []), { to: kb, at: [tris[9 * t + a], tris[9 * t + a + 1], tris[9 * t + a + 2]] }]);
      sides++;
    }
    const start = next.keys().next().value as string | undefined;
    const ring: number[] = [];
    let cur = start;
    let steps = 0;
    let simple = start !== undefined && [...next.values()].every((l) => l.length === 1);
    while (simple && cur !== undefined && steps <= sides) {
      const step = next.get(cur);
      if (!step) {
        simple = false;
        break;
      }
      ring.push(...step[0].at);
      cur = step[0].to;
      steps++;
      if (cur === start) break;
    }
    if (simple && cur === start && steps === sides && steps >= 3) out.push(ring);
    else for (const t of g) out.push(triangle(t));
  }
  return out;
}

const sameHole = (a: WallHole, b: WallHole): boolean => Math.abs(a.a0 - b.a0) < 0.01 && Math.abs(a.a1 - b.a1) < 0.01 && Math.abs(a.z0 - b.z0) < 0.01 && Math.abs(a.z1 - b.z1) < 0.01;

const samePoints = (a: readonly Pt[], b: readonly Pt[]): boolean => a.length === b.length && a.every((q, i) => Math.abs(q.x - b[i].x) < 1e-9 && Math.abs(q.y - b[i].y) < 1e-9);

/** Where the line y = `y` runs inside the ring: pairs of x. */
function crossings(ring: readonly Pt[], y: number): [number, number][] {
  const xs: number[] = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (a.y <= y !== b.y <= y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  });
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
