// An event-enabled tool plug-in: a tool whose script calls vstGetEventInfo runs once per event, as
// Vectorworks runs it, not once like a command. Starting it from the menu begins a session. The
// script runs for setup (it declares its mode bar and help string), then for each click (a point
// added), mouse move (its rubber band, at most every 80 ms and never while a run is in flight), mode
// change, Backspace (a point removed), Enter (a status check) and Esc (cancel the points, or end the
// tool). A run that completes the object (the count of points its behaviour asks for, or its own
// "complete" result after a double-click) runs once more for completion: that run's steps are the
// object, applied as one undo step. Choosing another tool, or another drawing, ends the session.
// The event numbers and result codes are in vs/toolEvents.ts.

import { appContext, registerOverlay } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import type { Pt } from "../../core/index.ts";
import { showAlert } from "../plugins/ui.ts";
import { problem, outcome, type Installed } from "./run.ts";
import { clearToolReport, takeToolReport, type ToolDrawItem, type ToolMode, type ToolReport } from "../python/vs/toolEventsSteps.ts";

/** The events a tool's script is run for (Vectorworks' tool messages, vs/toolEvents.ts). */
const EVENT = { setup: 3, cancel: 4, mode: 7, pointAdded: 100, pointRemoved: 101, doubleClick: 102, draw: 103, complete: 104, status: 105 } as const;
/** the results a script returns with vstSetEventResult */
const RESULT = { completed: 8, cancel: 9, readyWithEnter: 18 } as const;
/** Enter and Return, as the key codes the status event gets */
const KEY_RETURN = 13;
/** the least time between two mouse-move runs: 80 ms */
const MOVE_INTERVAL_MS = 80;
const RUBBER_BAND = "#2f7cf6";

/** An event-enabled tool: its script mentions vstGetEventInfo, in the script or in its modules. */
export function isEventEnabled(it: Installed): boolean {
  if (it.plugin.kind !== "tool") return false;
  return [it.plugin.script, ...Object.values(it.modules)].some((text) => /\bvstGetEventInfo\b/i.test(text));
}

/** How many clicks a point behaviour takes before the tool completes (null: as many as the user gives, a double-click ends it). */
function clicksFor(behavior: number): number | null {
  if (behavior === 1) return 1;
  if (behavior === 3) return 3;
  if (behavior === 0 || behavior === 2 || behavior === 101 || behavior === 102) return 2;
  return null;
}

interface Session {
  readonly it: Installed;
  /** points clicked so far, in millimetres */
  points: number[][];
  current: number[] | null;
  behavior: number;
  help: string;
  modes: ToolMode[];
  data: Record<string, unknown>;
  draw: readonly ToolDrawItem[];
  /** a run is in flight */
  busy: boolean;
  /** a mouse-move run is queued and not yet started */
  moveQueued: boolean;
  lastMove: number;
  /** the runs in order: each waits for the one before */
  chain: Promise<void>;
  ended: boolean;
  bar: HTMLElement;
  unsubscribe: Array<() => void>;
  key: (e: KeyboardEvent) => void;
}

let session: Session | null = null;

registerOverlay((p) => {
  const s = session;
  if (!s || s.ended) return;
  const { ctx } = p;
  ctx.strokeStyle = RUBBER_BAND;
  ctx.fillStyle = RUBBER_BAND;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const d of s.draw) {
    const [kind, ...n] = d;
    if (kind === "line" && n.length >= 4) {
      const a = p.toScreen({ x: n[0] ?? 0, y: n[1] ?? 0 });
      const b = p.toScreen({ x: n[2] ?? 0, y: n[3] ?? 0 });
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    } else if (kind === "rect" && n.length >= 4) {
      const a = p.toScreen({ x: n[0] ?? 0, y: n[1] ?? 0 });
      const b = p.toScreen({ x: n[2] ?? 0, y: n[3] ?? 0 });
      ctx.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if ((kind === "ellipse" || kind === "arc") && n.length >= 4) {
      const a = p.toScreen({ x: n[0] ?? 0, y: n[1] ?? 0 });
      const b = p.toScreen({ x: n[2] ?? 0, y: n[3] ?? 0 });
      const rx = Math.abs(b.x - a.x) / 2;
      const ry = Math.abs(b.y - a.y) / 2;
      const start = kind === "arc" ? ((n[4] ?? 0) * Math.PI) / 180 : 0;
      const end = kind === "arc" ? start + ((n[5] ?? 0) * Math.PI) / 180 : 2 * Math.PI;
      ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, rx, ry, 0, start, end);
    }
  }
  ctx.stroke();
  for (const pt of s.points) {
    const at = p.toScreen({ x: pt[0] ?? 0, y: pt[1] ?? 0 });
    ctx.beginPath();
    ctx.arc(at.x, at.y, 2.5, 0, 2 * Math.PI);
    ctx.fill();
  }
});

/** A run for one event: the steps are applied only by the completion run (its report kept). Null when it failed, the session ended. */
async function run(s: Session, event: number, msg1 = 0, msg2 = 0): Promise<ToolReport | null> {
  if (s.ended) return null;
  s.busy = true;
  clearToolReport();
  try {
    const block = {
      event,
      msg1,
      msg2,
      points: s.points,
      current: s.current,
      behavior: s.behavior,
      help: s.help,
      modes: s.modes,
      data: s.data,
    };
    const r = await outcome(s.it, { tool: block });
    if (r.error) {
      await showAlert(s.it.plugin.name, problem(r));
      end(s);
      return null;
    }
    const report = takeToolReport();
    if (!report) return null;
    s.behavior = report.behavior;
    s.help = report.help;
    s.modes = report.modes.map((m) => ({ ...m, icons: [...m.icons], items: [...m.items] }));
    s.data = { ...report.data };
    s.draw = report.draw;
    renderBar(s);
    return report;
  } finally {
    s.busy = false;
  }
}

/** Queues a job after the runs before it. */
function enqueue(s: Session, job: () => Promise<void>): void {
  s.chain = s.chain.then(async () => {
    if (s.ended) return;
    try {
      await job();
    } catch (err) {
      console.warn(`${s.it.plugin.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    redraw();
  });
}

function redraw(): void {
  appContext()?.requestDraw();
}

/** Completes the object: the completion run, its steps the object (one undo step), then the next object starts afresh. */
async function complete(s: Session): Promise<void> {
  const r = await run(s, EVENT.complete);
  if (!r) return;
  s.points = [];
  s.draw = [];
}

/** A point clicked: the script runs for it, then completes when the behaviour's count is reached or the script says so. */
function click(s: Session, at: Pt, detail: number): void {
  enqueue(s, async () => {
    s.points.push([at.x, at.y]);
    s.current = [at.x, at.y];
    const r = await run(s, EVENT.pointAdded);
    if (!r || s.ended) return;
    if (r.result === RESULT.cancel) {
      s.points = [];
      s.draw = [];
      return;
    }
    const need = clicksFor(s.behavior);
    if (need !== null) {
      if (s.points.length >= need) await complete(s);
      return;
    }
    if (detail >= 2) {
      // a double-click ends a many-point tool: its last point is the one it was made at, not a repeat
      const n = s.points.length;
      if (n >= 2 && samePoint(s.points[n - 1], s.points[n - 2])) s.points.pop();
      const d = await run(s, EVENT.doubleClick);
      if (d && !s.ended && (d.result === RESULT.completed || r.result === RESULT.completed)) await complete(s);
    } else if (r.result === RESULT.completed) {
      await complete(s);
    }
  });
}

function samePoint(a: number[] | undefined, b: number[] | undefined): boolean {
  return !!a && !!b && Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6;
}

/** The pointer moved: the script draws its rubber band, at most every MOVE_INTERVAL_MS and not while a run is going on. */
function moved(s: Session, at: Pt): void {
  s.current = [at.x, at.y];
  if (s.points.length === 0 || s.busy || s.moveQueued) {
    redraw();
    return;
  }
  const now = performance.now();
  if (now - s.lastMove < MOVE_INTERVAL_MS) return;
  s.lastMove = now;
  s.moveQueued = true;
  enqueue(s, async () => {
    s.moveQueued = false;
    if (s.points.length === 0) return;
    await run(s, EVENT.draw);
  });
}

/** A mode of the bar chosen: the script runs for the mode event with the group, and the value it reads back. */
function chooseMode(s: Session, group: number, value: number, shown: number): void {
  const m = s.modes[group - 1];
  if (!m || !m.enabled) return;
  if (m.kind === "radio" || m.kind === "check") m.value = value;
  if (m.kind === "pulldown") m.value = value;
  enqueue(s, async () => {
    // a pull-down's message: the item shown before in the high word, the item picked in the low (as Vectorworks sends it)
    const msg2 = m.kind === "pulldown" ? (shown << 16) | value : value;
    await run(s, EVENT.mode, group, msg2);
  });
}

function labelOf(m: ToolMode): string {
  if (m.kind === "pulldown") return m.label;
  const spec = m.icons[0] ?? "";
  const name = spec.split("/").pop() ?? spec;
  return name.replace(/\.[a-z]+$/i, "").replace(/[_-]+/g, " ") || "Button";
}

/** The bar's controls as the modes now stand: radio buttons, buttons and pull-down menus, and the help string. */
function renderBar(s: Session): void {
  const bar = s.bar;
  bar.replaceChildren();
  bar.append(h("span", { cls: "vt-name", text: s.it.plugin.name }));
  s.modes.forEach((m, i) => {
    const group = i + 1;
    if (m.kind === "pulldown") {
      const select = h("select", { cls: "vt-select", attrs: { "aria-label": m.label || "Choice" } });
      m.items.forEach((item, k) => {
        const option = h("option", { text: item, attrs: { value: String(k) } });
        if (k === m.value) option.selected = true;
        select.append(option);
      });
      select.disabled = !m.enabled;
      select.addEventListener("change", () => {
        const prev = m.value;
        chooseMode(s, group, Number(select.value), prev);
      });
      bar.append(h("label", { cls: "vt-pulldown" }, h("span", { cls: "vt-label", text: m.label }), select));
      return;
    }
    if (m.kind === "radio") {
      m.icons.forEach((spec, k) => {
        const on = m.value === k + 1;
        const button = h("button", { cls: `vt-mode${on ? " on" : ""}`, text: labelOf({ ...m, icons: [spec] }), attrs: { type: "button", title: spec, "aria-pressed": String(on) } });
        button.disabled = !m.enabled;
        button.addEventListener("click", () => chooseMode(s, group, k + 1, 0));
        bar.append(button);
      });
      return;
    }
    const button = h("button", { cls: "vt-mode", text: labelOf(m), attrs: { type: "button", title: m.icons[0] ?? "" } });
    button.disabled = !m.enabled;
    button.addEventListener("click", () => chooseMode(s, group, 0, 0));
    bar.append(button);
  });
  if (s.help) bar.append(h("span", { cls: "vt-help", text: s.help }));
  const close = h("button", { cls: "vt-end", text: "End tool", attrs: { type: "button", title: "End the tool (Esc with no points does the same)" } });
  close.addEventListener("click", () => end(s));
  bar.append(close);
}

function end(s: Session): void {
  if (s.ended) return;
  s.ended = true;
  s.points = [];
  s.draw = [];
  s.bar.remove();
  for (const off of s.unsubscribe) off();
  window.removeEventListener("keydown", s.key, true);
  appContext()?.controller.setPointerGate(null);
  if (session === s) session = null;
  redraw();
}

/** Starts the tool's session: its setup run, the mode bar, and the pointer taken for the tool's clicks. */
export async function startToolSession(it: Installed): Promise<void> {
  const app = appContext();
  if (!app || !store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  if (session) end(session);
  const bar = h("div", { cls: "vt-bar", attrs: { role: "toolbar", "aria-label": it.plugin.name } });
  document.body.append(bar);
  const s: Session = {
    it,
    points: [],
    current: null,
    behavior: 0,
    help: "",
    modes: [],
    data: {},
    draw: [],
    busy: false,
    moveQueued: false,
    lastMove: 0,
    chain: Promise.resolve(),
    ended: false,
    bar,
    unsubscribe: [],
    key: () => undefined,
  };
  session = s;
  const world = (e: PointerEvent): Pt => {
    const r = app.canvas.getBoundingClientRect();
    return app.view.toWorld(e.clientX - r.left, e.clientY - r.top);
  };
  s.key = (e: KeyboardEvent): void => {
    if (s.ended) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (s.points.length > 0) {
        enqueue(s, async () => {
          await run(s, EVENT.cancel);
          s.points = [];
          s.draw = [];
        });
      } else end(s);
    } else if ((e.key === "Backspace" || e.key === "Delete") && s.points.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      enqueue(s, async () => {
        s.points.pop();
        await run(s, EVENT.pointRemoved);
      });
    } else if ((e.key === "Enter" || e.key === "Return") && s.points.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      enqueue(s, async () => {
        const r = await run(s, EVENT.status, KEY_RETURN);
        if (r && (r.result === RESULT.completed || r.result === RESULT.readyWithEnter)) await complete(s);
      });
    }
  };
  window.addEventListener("keydown", s.key, true);
  // another tool chosen ends the session; so does another drawing (the same drawing's changes do not)
  const opened = store.session;
  s.unsubscribe.push(
    store.on("tool", () => end(s)),
    store.on("session", () => {
      if (store.session !== opened) end(s);
    }),
  );
  app.controller.setPointerGate((e, phase) => {
    if (s.ended) return false;
    if (phase === "cancel") return false;
    if (phase === "move") {
      moved(s, world(e));
      return (e.buttons & 4) === 0;
    }
    if (e.button !== 0) return false;
    if (phase === "down") click(s, world(e), e.detail);
    return true;
  });
  toast(`${it.plugin.name}: click to start (Esc ends the tool)`, "info");
  enqueue(s, async () => {
    await run(s, EVENT.setup);
  });
  await s.chain;
}
