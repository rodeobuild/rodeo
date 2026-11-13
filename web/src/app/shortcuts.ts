// Window-level keyboard shortcuts. Plain keys are ignored while typing in a
// field. Tool and drawing keys go to the controller first so an in-progress
// gesture can consume Enter, Backspace and Escape. ⌘ (Ctrl) combinations run the
// menu command whose key they are, as the menus show it and Menu Shortcuts…
// sets it (menubar.ts, menuKeys.ts), also while a field has focus: a field keeps
// its own editing keys (see fieldCombination).

import { store } from "./state.ts";
import { toolForKey } from "./toolKeys.ts";
import type { View } from "./view.ts";
import type { ToolController } from "./tools.ts";
import { deleteObjects, moveObjects, redo, setSelection, ZOOM_STEP, zoomBy } from "./commands.ts";
import { gridStep } from "./snap.ts";
import { toggleSmartOptions } from "./smartOptions.ts";
import { dataBar } from "./databar.ts";
import { runMenuCommand } from "./menubar.ts";
import { lookKey } from "./looks/looks.ts";

export interface ShortcutActions {
  fit(): void;
  toggle3d(): void;
}

export interface ShortcutDeps {
  readonly controller: ToolController;
  readonly view: View;
  readonly actions: ShortcutActions;
  /** runs the menu command a ⌘ combination is the key of; false when it is none's */
  readonly menuShortcut: (e: KeyboardEvent) => boolean;
  /** whether a menu command has the key combination of `e` (it may be off now) */
  readonly menuHasShortcut: (e: KeyboardEvent) => boolean;
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** Input types that take typed text (the others are buttons, boxes and sliders). */
const TEXT_TYPES = new Set(["text", "search", "number", "email", "url", "tel", "password", "date", "time", "datetime-local", "month", "week"]);

/** A field the user types text into: a text box, a text area or rich text. */
function isTextField(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
  return target.tagName === "INPUT" && TEXT_TYPES.has((target as HTMLInputElement).type);
}

/** The text a text field holds. */
function textOf(el: HTMLElement): string {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? "");
}

/** The text each text field held when it got focus or was last committed. */
const committedText = new WeakMap<HTMLElement, string>();

/** Whether a text field holds an edit that is not yet committed. */
function hasUncommittedEdit(el: HTMLElement): boolean {
  const was = committedText.get(el);
  return was !== undefined && was !== textOf(el);
}

/** ⌘/Ctrl keys a text field keeps for itself: select all, copy, paste and cut. */
const FIELD_KEYS = new Set(["a", "c", "v", "x"]);
/** Undo and redo: a text field keeps them while it holds an uncommitted edit. */
const UNDO_KEYS = new Set(["z", "y"]);

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** Keys that have no letter in e.key but are named by their physical position. */
const CODE_SYMBOLS = new Map<string, string>([
  ["Equal", "="],
  ["Minus", "-"],
  ["Quote", "'"],
]);

/**
 * The pressed key, lower-cased. With Option held macOS replaces e.key (Option+V
 * gives "√"), so the physical key is used then.
 */
function keyOf(e: KeyboardEvent): string {
  if (e.altKey) {
    if (e.code.startsWith("Key")) return e.code.slice(3).toLowerCase();
    if (e.code.startsWith("Digit")) return e.code.slice(5);
    const symbol = CODE_SYMBOLS.get(e.code);
    if (symbol !== undefined) return symbol;
  }
  return e.key.toLowerCase();
}

/*
 * Arrow-key nudges are summed and applied once per animation frame. Every edit
 * is a full document commit (~35 ms on the sample), so a held key must not queue
 * one edit per auto-repeat event. Any other key flushes the pending nudge first.
 */
const nudgeState = { dx: 0, dy: 0, ids: [] as string[], frame: 0 };

function nudge(e: KeyboardEvent, view: View): void {
  if (store.selection.size === 0) return;
  const step = gridStep(view.scale) * (e.shiftKey ? 10 : 1);
  const sx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
  const sy = e.key === "ArrowDown" ? -step : e.key === "ArrowUp" ? step : 0;
  // along the screen, in a rotated plan too
  const o = view.fromPlan({ x: 0, y: 0 });
  const to = view.fromPlan({ x: sx, y: sy });
  nudgeState.dx += to.x - o.x;
  nudgeState.dy += to.y - o.y;
  nudgeState.ids = [...store.selection];
  if (nudgeState.frame === 0) nudgeState.frame = requestAnimationFrame(flushNudge);
}

function flushNudge(): void {
  if (nudgeState.frame !== 0) cancelAnimationFrame(nudgeState.frame);
  const { dx, dy, ids } = nudgeState;
  nudgeState.dx = 0;
  nudgeState.dy = 0;
  nudgeState.frame = 0;
  moveObjects(ids, dx, dy);
}

/**
 * Cmd (Mac) or Ctrl combinations: the menu command whose key it is, else the
 * usual aliases (⌘Y redoes, ⌘+ and ⌘_ zoom). Returns true when the key was used.
 */
function handleModified(e: KeyboardEvent, deps: ShortcutDeps): boolean {
  if (deps.menuShortcut(e)) return true;
  switch (keyOf(e)) {
    case "y":
      redo();
      return true;
    case "+":
      zoomBy(deps.view, ZOOM_STEP);
      return true;
    case "_":
      zoomBy(deps.view, 1 / ZOOM_STEP);
      return true;
    default:
      return false;
  }
}

/** Buttons and similar controls, which Space activates. */
function isControl(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest("button, select, summary, [role=button], [role=option]") !== null;
}

/**
 * A ⌘ or Ctrl combination pressed while a field has focus. A text field keeps select all, copy, paste and cut,
 * and undo or redo while it holds an edit not yet committed (its own editing undoes that edit). Any other
 * combination that is a menu shortcut first commits the field, so its change applies and the command sees it,
 * then runs as it does with the drawing focused. Other combinations are left to the field as they are.
 */
function fieldCombination(e: KeyboardEvent, deps: ShortcutDeps): void {
  const target = e.target as HTMLElement;
  // a field that took the key itself (Menu Shortcuts… records one), a dialog, rich text being typed and a text
  // area (a chat box, a note) keep every combination, as before
  if (e.defaultPrevented || target.isContentEditable || target.tagName === "TEXTAREA") return;
  if (target.closest("[role=dialog], [aria-modal=true]")) return;
  // the physical key, so a Cyrillic or Greek layout's Ctrl+Z is still Z
  const key = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : keyOf(e);
  const text = isTextField(target);
  if (text && FIELD_KEYS.has(key)) return;
  if (text && UNDO_KEYS.has(key) && hasUncommittedEdit(target)) return;
  const menu = deps.menuHasShortcut(e);
  if (!menu && !UNDO_KEYS.has(key)) return;
  if (text && menu && !UNDO_KEYS.has(key)) target.blur(); // the change event commits the edit
  if (handleModified(e, deps)) e.preventDefault();
}

export function installShortcuts(deps: ShortcutDeps): void {
  // a field's edit is the change from the text it held when it got focus or was last committed
  window.addEventListener("focusin", (e) => {
    if (isTextField(e.target)) committedText.set(e.target, textOf(e.target));
  });
  window.addEventListener("change", (e) => {
    if (isTextField(e.target)) committedText.set(e.target, textOf(e.target));
  });

  window.addEventListener("keydown", (e) => {
    if (isTextEntry(e.target)) {
      if (e.metaKey || e.ctrlKey) fieldCombination(e, deps);
      return;
    }
    if (!ARROW_KEYS.has(e.key)) flushNudge();

    if (e.code === "Space") {
      if (isControl(e.target)) return; // let Space press a focused button
      e.preventDefault();
      if (!e.repeat) deps.controller.setSpace(true);
      return;
    }

    if (e.key === "Escape") {
      if (deps.controller.handleKey(e)) {
        e.preventDefault();
        return;
      }
      if (store.selection.size > 0) setSelection([]);
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      if (handleModified(e, deps)) e.preventDefault();
      return;
    }
    if (e.altKey) return;

    // a number typed while the data bar shows starts its first field, if Data Bar Options allows it
    if (dataBar.instantKey(e)) {
      e.preventDefault();
      return;
    }

    if (deps.controller.handleKey(e)) {
      e.preventDefault();
      return;
    }

    // View › Work Like: the look's own keys, two-key shortcuts and command line, before Rodeo's
    if (lookKey(e)) {
      e.preventDefault();
      return;
    }

    switch (e.key) {
      case "Delete":
      case "Backspace":
        e.preventDefault();
        deleteObjects([...store.selection]);
        return;
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        e.preventDefault();
        nudge(e, deps.view);
        return;
      case "0":
        deps.actions.fit();
        return;
      case "3":
        deps.actions.toggle3d();
        return;
    }
    // by its place, so a layout typing another character there still opens it
    if (e.code === "Backquote" && !e.shiftKey) {
      e.preventDefault();
      if (!e.repeat) toggleSmartOptions();
      return;
    }

    // Z over the drawing: the Snap Loupe, as Vectorworks keys it (the Zoom tool is ⇧Z)
    if (e.key === "z" && !e.repeat && deps.controller.snapLoupe()) {
      e.preventDefault();
      return;
    }
    // G over the drawing: the SmartCursor datum, as Vectorworks keys it (Regular Polygon is ⇧G)
    if (e.key === "g" && !e.repeat && deps.controller.toggleDatum()) {
      e.preventDefault();
      return;
    }

    if (!e.repeat) {
      const tool = /^[a-z]$/i.test(e.key) ? toolForKey(e.key, e.shiftKey) : null;
      if (tool) deps.controller.setTool(tool);
      // F: Quick Search, as Vectorworks keys it (Fillet is ⇧F), unless a tool has been given F
      else if (e.key === "f" && runMenuCommand("Tools › Quick Search…")) e.preventDefault();
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") deps.controller.setSpace(false);
  });
}
