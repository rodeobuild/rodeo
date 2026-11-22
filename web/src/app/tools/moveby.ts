// Move by Points tool: click a point, then the point it should go to, and the
// selection moves by the distance between them. Five modes, chosen with 1–5 before
// the first click:
//   1 Move: the selection moves. Option (Alt) on the second click copies it instead.
//   2 Move and Duplicate: a copy moves and the originals stay. The Copies field in the
//     data bar makes that many, at 1×, 2× … the distance.
//   3 Copy Multiple (AutoCAD's COPY, Rhino's Copy): each further click places another
//     copy of the originals from the same base point, until Esc or Enter.
//   4 Distribute: Copies duplicates spread evenly between the two points, the last one
//     on the second point; the originals stay.
//   5 Reference Point: the first point, on the selection, lands at the second click's
//     reference point plus the offset in the data bar (ΔX, ΔY, 0 at first).
// After the first click the data bar shows ΔX and ΔY, then L and A, live as the pointer
// moves. Tab goes into its fields and a typed number starts the first one. A typed value
// holds while the pointer moves; the rest follow the pointer. Shift constrains the
// distance to 45-degree steps. Esc starts over; a move keeps the selection and the tool,
// so the next pair of clicks moves it again.

import type { Pt } from "../../core/index.ts";
import { attempt, moveObjects, setSelection } from "../commands.ts";
import { dataBar, FIELD_ANGLE, FIELD_DX, FIELD_DY, FIELD_LENGTH, typedPoint, type BarField, type BarStage, type BarValues } from "../databar.ts";
import { constrainAngle, dist, distributeOffsets, duplicateOffsets, polar, polarOf, referenceMove } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { formatLength } from "../units.ts";
import { ALT_KEY, BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";
import { drawLabel, drawMarker, mapOutlines, selectionOutlines, selectionUnchanged } from "./rotate.ts";

const MIN_WORLD = 1e-9;
const DEFAULT_COPIES = 1;
const DEFAULT_SPREAD = 2;
/** the most duplicates one action makes */
const MAX_COPIES = 500;
/** copies drawn as outlines while the pointer moves; past this only the last is drawn */
const PREVIEW_COPIES = 50;

type MoveMode = "move" | "copy" | "multiple" | "distribute" | "reference";
const MODES: readonly MoveMode[] = ["move", "copy", "multiple", "distribute", "reference"];
const MODE_NAME: Record<MoveMode, string> = {
  move: "Move",
  copy: "Move and Duplicate",
  multiple: "Copy Multiple",
  distribute: "Distribute",
  reference: "Reference Point",
};

const FIELD_COPIES: BarField = { key: "copies", label: "Copies", digits: 0, kind: "count" };
const MOVE_STAGE: BarStage = { key: "moveby-move", caption: "Move", fields: [FIELD_DX, FIELD_DY, FIELD_LENGTH, FIELD_ANGLE], secondary: ["length", "angle"] };
const COPY_STAGE: BarStage = {
  key: "moveby-copy",
  caption: "Duplicate",
  fields: [FIELD_DX, FIELD_DY, FIELD_COPIES, FIELD_LENGTH, FIELD_ANGLE],
  secondary: ["length", "angle"],
};
const MULTIPLE_STAGE: BarStage = { key: "moveby-multiple", caption: "Copy", fields: [FIELD_DX, FIELD_DY, FIELD_LENGTH, FIELD_ANGLE], secondary: ["length", "angle"] };
const DISTRIBUTE_STAGE: BarStage = {
  key: "moveby-distribute",
  caption: "Distribute",
  fields: [FIELD_DX, FIELD_DY, FIELD_COPIES, FIELD_LENGTH, FIELD_ANGLE],
  secondary: ["length", "angle"],
};
const REFERENCE_STAGE: BarStage = { key: "moveby-reference", caption: "Reference", fields: [FIELD_DX, FIELD_DY] };

/** What a click, or Enter in the data bar, does: where the second point is, the copies made, and the reference offset. */
interface Plan {
  readonly end: Pt;
  readonly copies: number;
  readonly offset: Pt;
}

/** Whether `n` is a number of copies the tool makes: a whole number from 1 to MAX_COPIES. */
function isCount(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_COPIES;
}

export class MoveByPointsTool extends BaseTool {
  readonly id = "moveby";
  readonly cursor = "crosshair";

  private mode: MoveMode = "move";
  /** the point picked up; null before the first click */
  private from: Pt | null = null;
  /** selection when the gesture started; a change under the gesture drops it */
  private ids: readonly string[] = [];
  /** last pointer event; the preview and the data bar follow it */
  private pointer: PointerInfo | null = null;
  /** Copies for Move and Duplicate and for Distribute, kept while the tool stays selected */
  private readonly counts: Record<"copy" | "distribute", number> = { copy: DEFAULT_COPIES, distribute: DEFAULT_SPREAD };
  /** Reference Point's offset from the reference point, mm */
  private offset: Pt = { x: 0, y: 0 };
  /** Option/Alt state; PointerInfo carries no alt flag, so it is read from window events */
  private altHeld = false;
  private readonly barHandlers = {
    commit: () => this.onBarCommit(),
    edit: () => this.env.requestDraw(),
  };

  constructor(env: ToolEnv) {
    super(env);
    const track = (e: KeyboardEvent | PointerEvent): void => {
      this.altHeld = e.altKey;
    };
    window.addEventListener("keydown", track);
    window.addEventListener("keyup", track);
    // capture phase: the flag is set before the canvas delivers the click
    window.addEventListener("pointerdown", track, true);
    window.addEventListener("blur", () => {
      this.altHeld = false;
    });
  }

  modes(): ToolModes {
    return {
      options: MODES.map((m, i) => ({ id: m, label: MODE_NAME[m], key: String(i + 1) })),
      active: this.mode,
    };
  }

  setMode(id: string): void {
    const mode = MODES.find((m) => m === id);
    if (!mode || mode === this.mode) return;
    // a point picked up in one mode does not carry into another
    if (this.from) this.reset();
    this.mode = mode;
  }

  /** The point picked up, once it is: snaps and Ortho (View › Ortho) work from it. */
  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    if (store.selection.size === 0) return "Select objects first";
    if (this.mode === "reference") {
      return this.from ? "Click the reference point · Tab for the offset" : "Click the point on the selection to move from";
    }
    if (this.mode === "multiple") {
      if (!this.from) return "Click the point to copy from · 1–5 mode";
      return "Click where each copy goes · Esc or Enter to stop";
    }
    if (this.mode === "distribute") {
      if (!this.from) return "Click the point to distribute from · 1–5 mode";
      return "Click the second point · Tab for copies";
    }
    if (this.mode === "copy") {
      if (!this.from) return "Click the point to move from · 1–5 mode";
      return "Click to move to · Tab for copies · Shift 45°";
    }
    if (!this.from) return "Click the point to move from · 1–5 mode";
    return `Click to move to · Tab to type · ${ALT_KEY} copy`;
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    this.sync();
    if (store.selection.size === 0) return;
    if (!this.from) {
      this.from = p.pos;
      this.ids = [...store.selection];
      this.syncBar(p);
      return;
    }
    this.apply(p);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    this.sync();
    if (this.from) this.syncBar(p);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (!this.from) {
      const mode = modeForKey(e, this.modes());
      if (mode) {
        this.setMode(mode);
        return true;
      }
      return false;
    }
    // with the point picked up, a typed number can only be a distance: the mode keys wait
    if (e.metaKey || e.ctrlKey || e.altKey || !this.pointer) return false;
    if (e.key === "Tab") {
      this.syncBar(this.pointer);
      return dataBar.focusField(e.shiftKey);
    }
    if (/^[0-9.-]$/.test(e.key)) {
      this.syncBar(this.pointer);
      return dataBar.startField(e.key);
    }
    // Enter ends a run of copies, as Escape does
    if (e.key === "Enter" && this.mode === "multiple") {
      this.reset();
      return true;
    }
    if (e.key === "Escape") {
      this.reset();
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const from = this.from;
    const p = this.pointer;
    if (!from || !p) return;
    dataBar.position(g.toScreen(p.pos), g);
    const plan = this.plan(p);
    if (!plan || !selectionUnchanged(this.ids)) return;
    if ((this.mode === "copy" || this.mode === "distribute") && !isCount(plan.copies)) return;
    const moves = this.moves(from, plan);
    const outlines = selectionOutlines(this.env.scene, this.ids);
    const shown = moves.length <= PREVIEW_COPIES ? moves : moves.slice(-1);
    withPreview(g, () => {
      strokeScreen(g, [from, plan.end], false);
      for (const v of shown) {
        for (const line of mapOutlines(outlines, { a: 1, b: 0, c: 0, d: 1, e: v.x, f: v.y })) strokeScreen(g, line, false);
      }
    });
    drawMarker(g, from);
    drawMarker(g, plan.end);
    const len = dist(from, plan.end);
    if (this.mode !== "reference" && len > MIN_WORLD) {
      const B = g.toScreen(plan.end);
      drawLabel(g, { x: B.x + 12, y: B.y - 22 }, formatLength(len, store.session?.doc.info.units));
    }
  }

  /** Drops the gesture when the selection changed under it. */
  private sync(): void {
    if (this.from && !selectionUnchanged(this.ids)) this.reset();
  }

  private reset(): void {
    if (this.from) dataBar.reset();
    this.from = null;
    this.ids = [];
  }

  /** The stage the data bar shows for the mode, once the point is picked up. */
  private stage(): BarStage {
    switch (this.mode) {
      case "copy":
        return COPY_STAGE;
      case "multiple":
        return MULTIPLE_STAGE;
      case "distribute":
        return DISTRIBUTE_STAGE;
      case "reference":
        return REFERENCE_STAGE;
      default:
        return MOVE_STAGE;
    }
  }

  /** Copies the mode makes from the typed or stored count. */
  private countOf(): number {
    return this.mode === "copy" || this.mode === "distribute" ? this.counts[this.mode] : 1;
  }

  /** The pointer's second point: Shift keeps it at 45-degree steps from the first. The reference point is taken as it is. */
  private aim(p: PointerInfo): Pt {
    if (!this.from || this.mode === "reference") return p.pos;
    return p.shift ? constrainAngle(this.from, p.pos) : p.pos;
  }

  /** The values the bar shows for the pointer: its own, from where the pointer is; the reference offset in Reference Point. */
  private liveValues(p: PointerInfo): BarValues {
    const from = this.from;
    if (!from) return {};
    if (this.mode === "reference") return { dx: this.offset.x, dy: this.offset.y };
    const end = this.aim(p);
    const { length, angle } = polarOf(from, end);
    const values: BarValues = { dx: end.x - from.x, dy: end.y - from.y, length, angle };
    if (this.mode === "copy" || this.mode === "distribute") values.copies = this.counts[this.mode];
    return values;
  }

  /**
   * What a click at `p`, or Enter in the bar, would do: the typed values where the bar holds
   * them, the pointer for the rest. Null when a typed value is not a number.
   */
  private plan(p: PointerInfo): Plan | null {
    const from = this.from;
    if (!from) return null;
    const locked = dataBar.hasLocks();
    const values = locked ? dataBar.resolve(this.liveValues(p)) : null;
    if (locked && !values) return null;
    let end = this.aim(p);
    if (values && this.mode !== "reference") end = typedPoint(values, from) ?? polar(from, values.length, values.angle);
    return {
      end,
      copies: values?.copies ?? this.countOf(),
      offset: this.mode === "reference" && values ? { x: values.dx, y: values.dy } : this.offset,
    };
  }

  /** The vectors of the action: one for most modes, one per copy for Move and Duplicate and for Distribute. */
  private moves(from: Pt, plan: Plan): Pt[] {
    const dx = plan.end.x - from.x;
    const dy = plan.end.y - from.y;
    switch (this.mode) {
      case "copy":
        return duplicateOffsets(dx, dy, plan.copies);
      case "distribute":
        return distributeOffsets(dx, dy, plan.copies);
      case "reference":
        return [referenceMove(from, plan.end, plan.offset)];
      default:
        return [{ x: dx, y: dy }];
    }
  }

  /** Makes the action the second point (or the reference point) gives, with one undo step. */
  private apply(p: PointerInfo): void {
    const from = this.from;
    if (!from) return;
    const plan = this.plan(p);
    if (!plan) {
      toast("Enter a number in the data bar.", "info");
      return;
    }
    const counted = this.mode === "copy" || this.mode === "distribute";
    if (counted && !isCount(plan.copies)) {
      toast(`Enter a whole number of copies from 1 to ${MAX_COPIES}.`, "info");
      return;
    }
    if (this.mode === "copy" || this.mode === "distribute") this.counts[this.mode] = plan.copies;
    if (this.mode === "reference") this.offset = plan.offset;
    const ids = [...this.ids];
    const moves = this.moves(from, plan);
    const moved = moves.some((v) => Math.hypot(v.x, v.y) >= MIN_WORLD);

    if (this.mode === "multiple") {
      // the base point and the originals stay picked up for the next copy; the originals stay selected
      if (moved) attempt("Move copy", (s) => s.duplicateObjects(ids, moves[0].x, moves[0].y));
      // the bar lets go of the keys, so Enter on the drawing ends the run as it does without a typed copy
      dataBar.release();
      return;
    }
    this.reset();
    if (!moved) return;
    if (counted) {
      const copies = attempt("Move copy", (s) => s.batch(() => moves.flatMap((v) => s.duplicateObjects(ids, v.x, v.y))));
      if (copies) setSelection(copies.value);
      return;
    }
    const v = moves[0];
    if (this.altHeld) {
      const copy = attempt("Move copy", (s) => s.duplicateObjects(ids, v.x, v.y));
      if (copy) setSelection(copy.value);
    } else {
      moveObjects(ids, v.x, v.y);
    }
  }

  /** Enter in the data bar: the same as a click at the pointer, with the typed values. */
  private onBarCommit(): void {
    const p = this.pointer;
    if (p && this.from) this.apply(p);
  }

  /** Sets the bar's stage and live values for the pointer, and brings it out. */
  private syncBar(p: PointerInfo): void {
    dataBar.show();
    dataBar.setStage(this.stage(), this.barHandlers);
    dataBar.update(this.liveValues(p));
    dataBar.position(this.env.view.toScreen(p.pos), this.env.view);
  }
}
