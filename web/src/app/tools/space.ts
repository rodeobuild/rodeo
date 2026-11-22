// Space Planning's Space (spaces.ts): a room's boundary with its label, drawn Rectangle (a drag or two
// clicks) or Polygon (each corner; a double-click, Enter or a click on the first corner closes it), or
// found from walls, Inner Boundary (a click in a room closed by the visible walls on the design layers at the
// active layer's elevation) or Picked Walls (click each of those walls, Enter makes the space within them). Esc cancels. Spaces are Space objects;
// the rooms found from walls keep their gross boundary and stay kept to their walls.

import type { Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { pointInPolygon } from "../geom.ts";
import { pickObject } from "../hittest.ts";
import { addSpaces, layerScaleOf, spacePreferences, WALL, type SpacePath } from "../spaces.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { wallsAt } from "../space/refit.ts";
import { wallRooms, type WallRoom } from "../space/walls.ts";
import { ringArea } from "../wallPolys.ts";
import { OutlineTool } from "./planning.ts";

type WallMode = "inner" | "walls";

export class SpaceTool extends OutlineTool {
  readonly id = "space";
  protected readonly modeLabel = "Space";
  /** a mode that goes by walls; null for the outline tool's own two */
  private wallMode: WallMode | null = null;
  private picked = new Set<string>();

  preferences(): Promise<void> {
    return spacePreferences();
  }

  modes(): readonly ToolModes[] {
    const [own] = super.modes();
    const n = own.options.length;
    return [
      {
        ...own,
        options: [...own.options, { id: "inner", label: "Inner Boundary", key: String(n + 1) }, { id: "walls", label: "Picked Walls", key: String(n + 2) }],
        active: this.wallMode ?? own.active,
      },
    ];
  }

  setMode(id: string): void {
    this.picked.clear();
    this.wallMode = id === "inner" || id === "walls" ? id : null;
    if (!this.wallMode) super.setMode(id);
  }

  hint(): string {
    if (this.wallMode === "inner") return "Click inside a room the walls close";
    if (this.wallMode === "walls") return this.picked.size ? `${this.picked.size} picked · click another wall, Enter makes the space · Esc starts over` : "Click each wall round the space";
    return super.hint();
  }

  down(p: PointerInfo): void {
    if (this.wallMode === "inner") this.fromRoomAt(p.pos);
    else if (this.wallMode === "walls") this.pickWall(p);
    else super.down(p);
  }

  move(p: PointerInfo): void {
    if (!this.wallMode) super.move(p);
  }

  up(p: PointerInfo): void {
    if (!this.wallMode) super.up(p);
  }

  key(e: KeyboardEvent): boolean {
    if (!this.wallMode) return super.key(e);
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.wallMode === "walls" && e.key === "Enter" && this.picked.size) this.fromPicked();
    else if (this.wallMode === "walls" && e.key === "Escape" && this.picked.size) {
      this.picked.clear();
      setSelection([]);
    } else return false;
    return true;
  }

  /** Makes a space of `ring`; a room the walls close (`room`) gives its gross boundary and is kept to its walls. */
  private add(ring: readonly Pt[], room?: WallRoom): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const path: SpacePath = { ring, layerId, classIndex: store.activeClassIndex, scale: layerScaleOf(layerId), gross: room ? room.gross : null, auto: !!room };
    const r = attempt("Space", (s) => s.batch(() => addSpaces(s, [path])));
    if (r && r.value.length) setSelection(r.value);
    else if (r) toast("Draw a space with some area.", "info");
  }

  protected made(corners: Pt[]): void {
    this.add(corners);
  }

  private rooms(walls: string[]): WallRoom[] {
    const session = store.session;
    if (!session || !walls.length) return [];
    try {
      return wallRooms(session, walls);
    } catch (e) {
      toast(`Space: ${(e as Error).message}`, "error");
      return [];
    }
  }

  private fromRoomAt(at: Pt): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    // the walls a Space there would be kept to: those on the design layers at this layer's elevation
    // (a Vectorworks drawing often keeps its spaces on a layer of their own), as far as they show
    const doc = store.session?.doc;
    const elevation = doc?.layers().find((l) => l.id === layerId)?.elevation ?? 0;
    const visible = (doc ? wallsAt(doc, elevation) : []).filter((id) => {
      const obj = doc?.object(id);
      return obj && this.env.scene.isObjectVisible(obj);
    });
    const room = this.rooms(visible).find((r) => pointInPolygon(at, r.net));
    if (room) this.add(room.net, room);
    else toast("No walls close a room there. Make sure they're joined.", "info");
  }

  private pickWall(p: PointerInfo): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const doc = store.session?.doc;
    const elevation = doc?.layers().find((l) => l.id === layerId)?.elevation ?? 0;
    const level = (doc?.layers() ?? []).filter((l) => l.kind === "design" && Math.abs((l.elevation ?? 0) - elevation) <= 1).map((l) => l.id);
    const wall = pickObject(this.env.scene, this.env.view, p.screen, level.length ? level : [layerId], (o) => o.type === WALL);
    if (!wall) return;
    if (this.picked.has(wall.id)) this.picked.delete(wall.id);
    else this.picked.add(wall.id);
    setSelection([...this.picked]);
    store.setHint(this.hint());
  }

  private fromPicked(): void {
    const rooms = this.rooms([...this.picked]);
    this.picked.clear();
    if (!rooms.length) {
      toast("Those walls don't close a room. Make sure they're joined.", "info");
      return;
    }
    // the largest room they close, if they close several
    const room = rooms.reduce((a, b) => (ringArea(b.net) > ringArea(a.net) ? b : a));
    this.add(room.net, room);
  }
}
