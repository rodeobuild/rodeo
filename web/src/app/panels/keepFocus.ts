// Keeps keyboard focus on its control when a panel repaints. A panel rebuilds its
// controls on each store change, and a commit (Enter, or Tab leaving a field)
// causes one: the field Tab was moving to is then gone, and focus falls to the
// page. keepFocus puts it back on the same control, or on the next or previous
// one when a Tab press caused the repaint, as the Tab key would have.

export interface FocusMark {
  /** the control's place among the panel's controls */
  readonly index: number;
  /** what the control is, so a repaint that moved it is noticed */
  readonly key: string;
}

/**
 * Where focus goes after a repaint, as an index into the new controls, or -1 for
 * none (a Tab that leaves the panel, or no controls). The control at the old
 * index is used when it is the same kind of control; else the nearest one that
 * is. `step` is +1 for Tab, -1 for Shift+Tab and 0 when focus stays put.
 */
export function focusTarget(from: FocusMark, keys: readonly string[], step: number): number {
  if (keys.length === 0) return -1;
  let base = Math.min(from.index, keys.length - 1);
  if (keys[from.index] !== from.key) {
    let best = -1;
    for (let j = 0; j < keys.length; j++) {
      if (keys[j] === from.key && (best < 0 || Math.abs(j - from.index) < Math.abs(best - from.index))) best = j;
    }
    if (best >= 0) base = best;
  } else {
    base = from.index;
  }
  const target = base + step;
  return target < 0 || target >= keys.length ? -1 : target;
}

/** The controls a panel offers to the Tab key, in order. */
function controlsOf(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>("input, select, textarea, button, [contenteditable]:not([contenteditable=false]), [tabindex]");
  return [...all].filter(
    (el) => el.tabIndex >= 0 && !(el as HTMLInputElement).disabled && !el.closest("[hidden]") && !(el instanceof HTMLInputElement && el.type === "hidden"),
  );
}

/** A control's identity across a repaint: what it is and the label it is given. */
function keyOf(el: HTMLElement): string {
  const label = el.closest("label")?.querySelector(".field-label")?.textContent ?? "";
  return [el.tagName, el.getAttribute("type") ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("name") ?? "", label, (el.textContent ?? "").trim().slice(0, 40)].join("|");
}

/** Input types that take typed text, where a caret or selection means something. */
const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password"]);

function isTextControl(el: HTMLElement): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type));
}

/** A Tab press in a panel, noted until the task it is in ends: a commit it causes repaints the panel in that task. */
let tab: { from: HTMLElement; step: number } | null = null;

/** Call from a panel's keydown listener: notes a plain Tab or Shift+Tab press. */
export function noteTabKey(e: KeyboardEvent): void {
  if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  tab = { from: e.target, step: e.shiftKey ? -1 : 1 };
  setTimeout(() => {
    tab = null;
  }, 0);
}

/**
 * Runs `repaint`, which rebuilds the controls under `root`, and then gives focus back. Focus outside `root` is
 * never moved, so a repaint while the user works on the drawing leaves the page as it is.
 */
export function keepFocus(root: HTMLElement, repaint: () => void): void {
  const pending = tab !== null && root.contains(tab.from) ? tab : null;
  tab = null;
  const from = pending ? pending.from : document.activeElement;
  const before = controlsOf(root);
  const index = from instanceof HTMLElement && root.contains(from) ? before.indexOf(from) : -1;
  if (index < 0) {
    repaint();
    return;
  }
  const el = before[index];
  const mark: FocusMark = { index, key: keyOf(el) };
  const step = pending ? pending.step : 0;
  const caret = isTextControl(el) ? { start: el.selectionStart, end: el.selectionEnd } : null;

  repaint();

  const after = controlsOf(root);
  const at = focusTarget(mark, after.map(keyOf), step);
  if (at < 0) return;
  const next = after[at];
  next.focus();
  if (!isTextControl(next)) return;
  if (step !== 0) next.select(); // a Tab into a field selects its text, as the browser does
  else if (caret && caret.start !== null && caret.end !== null) next.setSelectionRange(caret.start, caret.end);
}
