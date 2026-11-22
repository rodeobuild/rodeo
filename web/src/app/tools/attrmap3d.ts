// The Attribute Mapping tool on textures in the 3D view. Hovering a textured face outlines its
// triangle faintly. A click picks the face: its part is the one the face belongs to when the object
// holds that part's texture, else the whole object's (Overall); the tile of the image under the
// pointer is outlined over the face, with a square at its origin, a circle at the end of its first
// edge (turn) and a circle at its far corner (scale). Dragging inside the tile moves the picture
// with the pointer; dragging the turn circle turns it about the tile's origin (Shift in 15° steps);
// dragging the far corner scales it about the origin. Each drag commits one undo step when it ends,
// and Esc abandons it (Esc with no drag clears the pick). A part Rodeo maps by default has no stored
// mapping: the first click on its face shows a hint, the second maps it as an auto-aligned plane. A
// right-click on a face (without a drag) opens the texture commands for its part. The arithmetic is
// in attrmap3dMath.ts.

import { OVERALL, TEXTURE_NONE, type TexturePart, type TexturePartChange, type Vec3, type VwxDocument } from "../../core/index.ts";
import { appContext, on3d } from "../ext.ts";
import { attempt, setActiveLayer, setSelection } from "../commands.ts";
import { DRAWS_IN_3D } from "../draw3d.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { ACCENT, HANDLE_PX } from "../renderer.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { claimHighlight, textureRows } from "../textureMapping.ts";
import type { TextureHit, View3D, ViewDrawer } from "../view3d.ts";
import * as G from "./attrmap3dMath.ts";

/** how near (CSS px) a press must come to a handle to take it */
const GRAB_PX = HANDLE_PX / 2 + 4;
/** Shift turns the tile in these steps, radians */
const STEP = Math.PI / 12;
/** a texture with no size of its own is taken as this many mm across, as the view draws it */
const DEFAULT_IMAGE_MM = 1000;
/** a scale drag's factor stays within these */
const MIN_FACTOR = 0.01;
const MAX_FACTOR = 100;
/** the pointer must move this far (CSS px) with the right button for the press to be a turn of the view */
const RIGHT_MOVE_PX = 4;
/** the parts whose mapping is the object's own UV map: the tool leaves them alone */
const OWN_UV: ReadonlySet<string> = new Set(["imported", "default", "shader"]);
const NOT_MAPPED_HINT = "Click again to map this texture on the object";
const PICK_HINT = "Drag inside the tile to move it · Drag the circle at its end to turn it · Drag the far corner to scale it · Shift keeps turns to 15°";
const IDLE_HINT = "Click a textured face to pick its texture · Right-click for texture commands";

type Kind = "move" | "turn" | "scale";

/** The face the tool has picked: its triangle as the view has it now, and the point the pointer met it at. */
interface Pick {
  readonly id: string;
  readonly part: number;
  hit: TextureHit;
  readonly point: Vec3;
}

/** The tile of a picked face: the frame its triangle gives the image and the tile's index. */
interface Tile {
  readonly frame: G.Frame;
  readonly k: number;
  readonly l: number;
}

/** A drag under way: what it changes, and the values it started from. */
interface Drag {
  readonly kind: Kind;
  readonly pick: Pick;
  readonly tile: Tile;
  readonly part: TexturePart;
  readonly size: G.ImageSize;
  readonly normal: Vec3;
  /** the plane point the press met, and the latest one the pointer has met */
  readonly grab: Vec3;
  at: Vec3;
  shift: boolean;
}

/** The texture size the view draws for a texture: its width in mm and its height over its width. */
function sizeOf(doc: VwxDocument, texture: number): G.ImageSize {
  const res = doc.resources().find((r) => r.kind === "texture" && r.index === texture);
  const imageSize = res?.imageSize && res.imageSize > 0 ? res.imageSize : DEFAULT_IMAGE_MM;
  const px = res?.imagePixels;
  return { imageSize, aspect: px && px.width > 0 ? px.height / px.width : 1 };
}

/** The 9 numbers of triangle corners, as 3 points. */
function corners3(c: readonly number[]): [Vec3, Vec3, Vec3] {
  return [
    [c[0], c[1], c[2]],
    [c[3], c[4], c[5]],
    [c[6], c[7], c[8]],
  ];
}

/** The three edges of a triangle's corners, as segments (6 numbers each). */
function edgesOf(c: readonly number[]): Float32Array {
  const out = new Float32Array(18);
  for (let e = 0; e < 3; e++) {
    const a = 3 * e;
    const b = 3 * ((e + 1) % 3);
    out.set([c[a], c[a + 1], c[a + 2], c[b], c[b + 1], c[b + 2]], e * 6);
  }
  return out;
}

class Attrmap3d {
  drawer: ViewDrawer | null = null;
  /** the 3D view the tool works in while it's on, else null */
  private view: View3D | null = null;
  /** whether this tool set the view's drawer and so must take it away */
  private mine = false;
  private attached: View3D | null = null;
  private pick: Pick | null = null;
  private drag: Drag | null = null;
  /** the first click on a face whose mapping is the default: the second maps it */
  private armed: { readonly id: string; readonly part: number } | null = null;
  private note = "";
  private hoverKey = "";
  private lit = false;
  /** the model version the pick's triangle was last checked against */
  private version = -1;
  private rightAt: { readonly x: number; readonly y: number } | null = null;
  private rightMoved = false;

  /** The tool is on in the 3D view with a drawing open. */
  active(): boolean {
    return store.tool === "attrmap" && store.view3d && !!store.session;
  }

  /** Selects object `id`, making its layer the active one (a click in the plan does the same), so the selection holds. */
  private select(id: string): void {
    const layer = store.session?.doc.object(id)?.layerId;
    if (layer && layer !== store.activeLayerId) setActiveLayer(layer);
    setSelection([id]);
  }

  /** The 3D view while the tool is on, else null. */
  current(): View3D | null {
    return this.view;
  }

  /** Takes the 3D view's drawer and the hint while the tool is on; takes them away when it's not. */
  sync(): void {
    const v = appContext()?.view3d() ?? null;
    if (!v) return;
    if (this.active()) {
      this.attach(v);
      this.view = v;
      v.setDrawer(this.drawer);
      this.mine = true;
      store.setHint(this.note || this.hint());
      if (this.pick) this.later(v);
      return;
    }
    this.view = null;
    // a drawing tool takes the view's drawer for itself (draw3d.ts sets it on the same events)
    if (this.mine && !DRAWS_IN_3D.has(store.tool)) v.setDrawer(null);
    this.mine = false;
    this.pick = null;
    this.drag = null;
    this.armed = null;
    this.note = "";
    this.clearHover(v);
  }

  /** Esc: abandons a drag, else clears the pick. True when it took the key. */
  escape(v: View3D): boolean {
    if (this.drag) {
      this.drag = null;
      this.setNote("");
      v.repaintDrawer();
      return true;
    }
    if (this.pick || this.armed) {
      this.pick = null;
      this.armed = null;
      this.setNote("");
      v.repaintDrawer();
      return true;
    }
    return false;
  }

  down(e: PointerEvent): void {
    const v = this.view;
    if (!v) return;
    this.refresh(v);
    this.drag = null;
    const kind = this.handleAt(v, e);
    if (kind && this.pick) {
      this.startDrag(v, kind, e);
      return;
    }
    this.pickAt(v, e);
  }

  move(e: PointerEvent): void {
    const v = this.view;
    if (!v) return;
    if (this.refresh(v)) v.repaintDrawer();
    const d = this.drag;
    if (d) {
      d.shift = e.shiftKey;
      d.at = v.pointOnPlane(e, d.grab, d.normal) ?? d.at;
      v.repaintDrawer();
      return;
    }
    this.hover(v, e);
  }

  up(e: PointerEvent): void {
    const v = this.view;
    const d = this.drag;
    if (!v || !d) return;
    d.shift = e.shiftKey;
    d.at = v.pointOnPlane(e, d.grab, d.normal) ?? d.at;
    this.drag = null;
    this.setNote("");
    this.commit(d);
    this.later(v);
    v.repaintDrawer();
  }

  /** The pointer left the view or the press was cancelled: a drag is abandoned. */
  leave(): void {
    if (this.drag) this.drag = null;
    const v = this.view;
    if (v) this.clearHover(v);
  }

  /** Paints the picked tile, its handles and any drag's preview over the view. */
  paint(ctx: CanvasRenderingContext2D, _w: number, _h: number): void {
    const v = this.view;
    const p = this.pick;
    if (!v || !p) return;
    this.refresh(v);
    const pk = this.pick;
    if (!pk) return;
    const tile = this.tileOf(pk);
    if (!tile) return;
    const moved = (this.drag && this.transformOf(this.drag)) ?? ((x: Vec3): Vec3 => x);
    const corners = G.tileCorners(tile.frame, tile.k, tile.l).map((c) => moved(c));
    const project = v.projector();
    const at = corners.map((c) => project(c[0], c[1], c[2]));
    if (at.some((c) => c.depth <= 0)) return;
    const half = HANDLE_PX / 2;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(at[0].x, at[0].y);
    for (const c of at.slice(1)) ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = ACCENT;
    ctx.fillRect(at[0].x - half, at[0].y - half, HANDLE_PX, HANDLE_PX);
    for (const c of [at[1], at[2]]) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, half, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Right-click on a face: the texture commands for its part, unless the press turned the view. */
  menu(v: View3D, e: MouseEvent): void {
    e.preventDefault();
    if (!this.active() || this.rightMoved) return;
    const doc = store.session?.doc;
    const hit = v.faceAt(e);
    if (!doc || !hit?.objectId) return;
    const id = hit.objectId;
    const own = doc.texturePartOfFace(id, hit.normal);
    const parts = doc.objectTextures(id) ?? [];
    const part = parts.some((p) => p.part === own) ? own : OVERALL;
    const name = parts.find((p) => p.part === part)?.name ?? (part === OVERALL ? "Overall" : `Part ${part}`);
    this.select(id);
    const rows: Row[] = [{ label: `Texture: ${name}`, enabled: () => false }, ...textureRows(id, part)];
    if (doc.texturePartChoices(id).some((c) => c.part === own)) {
      rows.push("-", { label: "Texture This Face on Its Own", run: () => attempt("Texture Part", (s) => s.addTexturePart(id, own)) });
    }
    openContextMenu(rows, e.clientX, e.clientY);
  }

  /** Hooks the view's pointer and menu events once per view. */
  private attach(v: View3D): void {
    if (this.attached === v) return;
    this.attached = v;
    const el = v.domElement;
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 2) return;
      this.rightAt = { x: e.clientX, y: e.clientY };
      this.rightMoved = false;
    });
    el.addEventListener("pointermove", (e) => {
      if (!this.rightAt || (e.buttons & 2) === 0) return;
      if (Math.hypot(e.clientX - this.rightAt.x, e.clientY - this.rightAt.y) > RIGHT_MOVE_PX) this.rightMoved = true;
    });
    el.addEventListener("contextmenu", (e) => this.menu(v, e));
  }

  private hint(): string {
    if (this.drag) return "Esc cancels";
    return this.pick ? PICK_HINT : IDLE_HINT;
  }

  private setNote(text: string): void {
    this.note = text;
    store.setHint(text || this.hint());
  }

  /** Which handle (or the tile's inside, a move) the press met; null over neither. */
  private handleAt(v: View3D, e: PointerEvent): Kind | null {
    const p = this.pick;
    const tile = p && this.tileOf(p);
    if (!p || !tile) return null;
    const rect = v.domElement.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const C = G.tileCorners(tile.frame, tile.k, tile.l);
    const project = v.projector();
    let best: Kind | null = null;
    let near = GRAB_PX;
    const handles: [Kind, Vec3][] = [
      ["move", C[0]],
      ["turn", C[1]],
      ["scale", C[2]],
    ];
    for (const [kind, w] of handles) {
      const c = project(w[0], w[1], w[2]);
      if (c.depth <= 0) continue;
      const d = Math.hypot(c.x - screen.x, c.y - screen.y);
      if (d <= near) {
        best = kind;
        near = d;
      }
    }
    if (best) return best;
    const on = v.pointOnPlane(e, p.point, p.hit.normal);
    const uv = on ? G.uvOf(tile.frame, on) : null;
    if (uv && G.tileOf(uv)[0] === tile.k && G.tileOf(uv)[1] === tile.l) return "move";
    return null;
  }

  /**
   * A click off the picked tile's handles: picks the face under the pointer, or clears the pick. A face
   * whose mapping is the default has no uvs to hit, so its object and part come from the plain face hit.
   */
  private pickAt(v: View3D, e: PointerEvent): void {
    const doc = store.session?.doc;
    const hit = v.textureHitAt(e);
    const face = hit ? { objectId: hit.objectId, normal: hit.normal } : v.faceAt(e);
    if (!doc || !face?.objectId) {
      this.clear();
      return;
    }
    const id = face.objectId;
    this.select(id);
    const own = doc.texturePartOfFace(id, face.normal);
    const parts = doc.objectTextures(id) ?? [];
    // the picked part is the face's own when the object holds it, else the whole object
    const part = parts.some((p) => p.part === own) ? own : OVERALL;
    const placement = parts.find((p) => p.part === part);
    if (!placement || placement.texture === TEXTURE_NONE) {
      this.clear();
      return;
    }
    if (OWN_UV.has(placement.mapType)) {
      this.clear();
      toast("This object's texture follows its own UV map", "info");
      return;
    }
    if (!placement.initialized || (placement.mapType === "autoPlane" && placement.worldOrigin)) {
      if (this.armed?.id === id && this.armed.part === part) {
        this.armed = null;
        this.setNote("");
        const mapped = attempt("Map Texture", (s) => s.setObjectTexture(id, part, { mapType: "autoPlane", worldOrigin: false }));
        if (mapped) this.settle(v, e, id, part, 12);
        return;
      }
      this.clear();
      this.armed = { id, part };
      this.setNote(NOT_MAPPED_HINT);
      v.repaintDrawer();
      return;
    }
    this.armed = null;
    if (!hit || !hit.objectId) {
      this.clear();
      return;
    }
    this.setPick(v, { id, part, hit, point: hit.point });
  }

  /** Makes `p` the pick, if its triangle gives a tile; else says it can't be mapped. */
  private setPick(v: View3D, p: Pick): void {
    this.pick = p;
    this.version = v.modelVersion;
    if (!this.tileOf(p)) {
      this.pick = null;
      toast("This face's texture can't be mapped here", "info");
    }
    this.setNote("");
    v.repaintDrawer();
  }

  /** After a conversion the model is rebuilt a few frames later: the pick is taken from the press once its uvs are there. */
  private settle(v: View3D, e: PointerEvent, id: string, part: number, tries: number): void {
    requestAnimationFrame(() => {
      if (!this.active()) return;
      const hit = v.textureHitAt(e);
      if (hit?.objectId === id) {
        this.setPick(v, { id, part, hit, point: hit.point });
        return;
      }
      if (tries > 0) this.settle(v, e, id, part, tries - 1);
    });
  }

  /** Drops the pick, any drag and any first click on a default mapping. */
  private clear(): void {
    this.pick = null;
    this.drag = null;
    this.armed = null;
    this.setNote("");
    this.view?.repaintDrawer();
  }

  /** The picked tile: its frame and index, from the picked triangle's uvs and the point picked. */
  private tileOf(p: Pick): Tile | null {
    const frame = G.frameOf(corners3(p.hit.corners), [
      [p.hit.uvs[0], p.hit.uvs[1]],
      [p.hit.uvs[2], p.hit.uvs[3]],
      [p.hit.uvs[4], p.hit.uvs[5]],
    ]);
    if (!frame) return null;
    const uv = G.uvOf(frame, p.point);
    if (!uv) return null;
    const [k, l] = G.tileOf(uv);
    return { frame, k, l };
  }

  private startDrag(v: View3D, kind: Kind, e: PointerEvent): void {
    const p = this.pick;
    const doc = store.session?.doc;
    const tile = p && this.tileOf(p);
    if (!p || !doc || !tile) return;
    const part = doc.objectTextures(p.id)?.find((x) => x.part === p.part);
    if (!part) return;
    const grab = v.pointOnPlane(e, p.point, p.hit.normal) ?? p.point;
    this.drag = { kind, pick: p, tile, part, size: sizeOf(doc, p.hit.texture), normal: p.hit.normal, grab, at: grab, shift: e.shiftKey };
    this.setNote("");
    v.repaintDrawer();
  }

  /** The drag's change to the picture, as a transform of the tile's points (the preview). */
  private transformOf(d: Drag): ((x: Vec3) => Vec3) | null {
    const { frame, k, l } = d.tile;
    const C0 = G.cornerAt(frame, k, l);
    if (d.kind === "move") {
      const D = G.vec.sub(d.at, d.grab);
      return (x) => G.vec.add(x, D);
    }
    if (d.kind === "scale") {
      const f = this.factorOf(d);
      return (x) => G.vec.add(C0, G.vec.times(G.vec.sub(x, C0), f));
    }
    const target = this.turnTarget(d);
    if (!target) return null;
    const spin = G.spinAngle(frame, G.vec.add(G.vec.times(frame.A, target[0]), G.vec.times(frame.B, target[1])));
    const axis = G.frameNormal(frame);
    return (x) => G.turnPoint(x, C0, axis, spin);
  }

  /** The scale factor a scale drag makes: the pointer's distance from the tile's origin over the far corner's. */
  private factorOf(d: Drag): number {
    const C = G.tileCorners(d.tile.frame, d.tile.k, d.tile.l);
    const span = G.vec.length(G.vec.sub(C[2], C[0]));
    const f = span > 0 ? G.vec.length(G.vec.sub(d.at, C[0])) / span : 1;
    return Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, f));
  }

  /** The turn drag's pointer direction in the tile's (u, v) basis, in images from its origin; Shift snaps it. */
  private turnTarget(d: Drag): G.V2 | null {
    const { frame, k, l } = d.tile;
    const c = G.coords(G.vec.sub(d.at, G.cornerAt(frame, k, l)), frame.A, frame.B);
    if (!c) return null;
    return d.shift ? G.snapDirection(c[0], c[1], STEP) : c;
  }

  /** Commits a drag as one undo step: the offsets, scale or rotation that the drag moves the picture to. */
  private commit(d: Drag): void {
    const { id, part } = d.pick;
    const P = d.part;
    const { frame, k, l } = d.tile;
    let label: string;
    let change: TexturePartChange;
    if (d.kind === "move") {
      const c = G.coords(G.vec.sub(d.at, d.grab), frame.A, frame.B);
      if (!c || (Math.abs(c[0]) < 1e-9 && Math.abs(c[1]) < 1e-9)) return;
      const m = G.moveOffsets(P, d.size, c[0], c[1]);
      label = "Move Texture";
      change = { offsetU: m.offsetU, offsetV: m.offsetV };
    } else if (d.kind === "scale") {
      const f = this.factorOf(d);
      if (Math.abs(f - 1) < 1e-9) return;
      const s = G.scaleAbout(P, d.size, k, l, f);
      label = "Scale Texture";
      change = { scale: s.scale, offsetU: s.offsetU, offsetV: s.offsetV };
    } else {
      const target = this.turnTarget(d);
      if (!target) return;
      const delta = G.turnAngle(P, d.size, target[0], target[1]);
      if (Math.abs(delta) < 1e-12) return;
      const t = G.turnAbout(P, d.size, k, l, delta);
      label = "Turn Texture";
      change = { rotation: t.rotation, offsetU: t.offsetU, offsetV: t.offsetV };
    }
    attempt(label, (s) => s.setObjectTexture(id, part, change));
  }

  /**
   * Refreshes the pick's triangle when the model has been rebuilt since it was taken (its uvs are the
   * new ones). True when it did, so the caller can paint the new frame.
   */
  private refresh(v: View3D): boolean {
    const p = this.pick;
    if (!p || v.modelVersion === this.version) return false;
    this.version = v.modelVersion;
    const hit = v.textureTriangleOf(p.id, p.hit.corners, p.point, p.hit.normal);
    if (!hit) this.pick = null;
    else p.hit = hit;
    return true;
  }

  /** Checks the pick once the model has been rebuilt: a few frames after a commit, when it may not yet be. */
  private later(v: View3D): void {
    const again = (): void => {
      this.refresh(v);
      v.repaintDrawer();
    };
    requestAnimationFrame(again);
    setTimeout(again, 150);
  }

  /** The face under the pointer outlines faintly while nothing is picked or dragged. */
  private hover(v: View3D, e: PointerEvent): void {
    const hit = v.textureHitAt(e);
    const key = hit ? hit.corners.join(",") : "";
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    claimHighlight();
    if (!hit) {
      this.lit = false;
      v.setHighlightLines(null);
      return;
    }
    this.lit = true;
    v.setHighlightLines(null, edgesOf(hit.corners));
  }

  private clearHover(v: View3D): void {
    this.hoverKey = "";
    if (!this.lit) return;
    this.lit = false;
    claimHighlight();
    v.setHighlightLines(null);
  }
}

let installed = false;

/**
 * Has the Attribute Mapping tool work on textures in the 3D view (called once, when the tool is made):
 * its drawer takes the view's left button while the tool is on, and the right-click menu opens there.
 */
export function installAttrmap3d(): void {
  if (installed) return;
  installed = true;
  const c = new Attrmap3d();
  c.drawer = {
    down: (e) => c.down(e),
    move: (e) => c.move(e),
    up: (e) => c.up(e),
    leave: () => c.leave(),
    paint: (ctx, w, h) => c.paint(ctx, w, h),
  };
  const sync = (): void => c.sync();
  // draw3d.ts clears the view's drawer on these same events; this takes it back after they have run
  store.on(["tool", "session", "layer", "view3d"], () => {
    sync();
    queueMicrotask(sync);
  });
  on3d(() => sync());
  window.addEventListener(
    "keydown",
    (e) => {
      const v = c.current();
      if (e.key !== "Escape" || !v || !c.escape(v)) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  sync();
}
