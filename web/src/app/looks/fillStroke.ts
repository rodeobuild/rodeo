// Illustrator's Fill and Stroke (View › Work Like › Illustrator): the fill and the pen of the
// selection, or of what is drawn next while nothing is selected, as two squares at the foot of the
// toolbox (ToolboxSpec.fillStroke). One of them is in front: Color, Gradient and None act on it,
// X brings the other forward, Shift+X swaps their colours and D puts back the default, a white
// fill and a black pen.

import type { Attributes, EditSession } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { h } from "../dom.ts";
import { store } from "../state.ts";
import { commandChecked, runCommand } from "./commands.ts";

/** The square in front: the one Color, Gradient and None act on. */
let front: "fill" | "stroke" = "fill";

/** Each square on screen, repainted when the front square, the selection or the attributes change. */
const painters = new Set<() => void>();

function repaint(): void {
  for (const paint of painters) paint();
}

/** Which square is in front: the one Color, Gradient and None act on (X switches it). */
export function fillStrokeFront(): "fill" | "stroke" {
  return front;
}

/** X: brings the other square to the front. */
export function toggleFillStroke(): void {
  front = front === "fill" ? "stroke" : "fill";
  repaint();
}

/**
 * The attributes the squares and the buttons act on: the selection's first object that has any, else
 * what is drawn next (the active class's attributes, with store.drawAttrs over them).
 */
function current(): Partial<Attributes> {
  const doc = store.session?.doc;
  if (!doc) return { ...store.drawAttrs };
  for (const id of store.selection) {
    const attrs = doc.object(id)?.attrs;
    if (attrs) return attrs;
  }
  const cls = doc.classes().find((c) => c.index === store.activeClassIndex)?.attrs ?? {};
  return { ...cls, ...store.drawAttrs };
}

/**
 * Writes attributes as one undoable step to the selection, or to store.drawAttrs when nothing is
 * selected. `make` reads the current attributes and the palette index of a colour (added to the
 * document's palette when it has none), and returns what to change; undefined values are left out.
 */
function apply(label: string, make: (a: Partial<Attributes>, index: (css: string) => number) => Partial<Attributes>): void {
  const s = store.session;
  if (!s) return;
  const a = current();
  const ids = [...store.selection].filter((id) => s.doc.object(id)?.attrs);
  const clean = (patch: Partial<Attributes>): Partial<Attributes> => {
    const out: Partial<Attributes> = {};
    for (const key of Object.keys(patch) as (keyof Attributes)[]) {
      if (patch[key] !== undefined) (out as Record<string, number>)[key] = patch[key] as number;
    }
    return out;
  };
  if (ids.length > 0) {
    attempt(label, (sess: EditSession) => sess.setAttributes(ids, clean(make(a, (css) => sess.addColors([css])[0]))));
  } else {
    const patch = clean(make(a, (css) => s.addColors([css])[0]));
    store.drawAttrs = { ...store.drawAttrs, ...patch };
    store.emit("attrs");
  }
  repaint();
}

/** The palette index of white, and of black, for a default fill and pen. */
function whiteAndBlack(index: (css: string) => number): { white: number; black: number } {
  return { white: index("#ffffff"), black: index("#000000") };
}

/** X's partner, Shift+X: swaps the fill's colour and the pen's, on the selection (one undoable step) or for what is drawn next. */
export function swapFillStroke(): void {
  apply("Swap fill and stroke", (a) => {
    const patch: Partial<Attributes> = { penFore: a.fillBack, fillBack: a.penFore };
    // a solid fill keeps its lines in the same colour as its ground
    if (a.fillPattern === 1) patch.fillFore = a.penFore;
    return patch;
  });
}

/** D: a white solid fill and a black solid pen, on the selection or for what is drawn next. */
export function defaultFillStroke(): void {
  apply("Default fill and stroke", (_a, index) => {
    const { white, black } = whiteAndBlack(index);
    return { fillPattern: 1, fillFore: white, fillBack: white, lineStyle: 2, penFore: black };
  });
}

/** ",": the square in front made solid in its colour (Color). */
export function colorFillStroke(): void {
  apply("Color", (a, index) => {
    if (front === "fill") {
      const colour = a.fillBack ?? index("#ffffff");
      return { fillPattern: 1, fillFore: colour, fillBack: colour };
    }
    return { lineStyle: 2, penFore: a.penFore ?? index("#000000") };
  });
}

/** "/": the square in front set to none (no fill, or no pen). */
export function noneFillStroke(): void {
  apply("None", () => (front === "fill" ? { fillPattern: 0 } : { lineStyle: 0 }));
}

/** "." (Gradient): opens the Attributes palette (Appearance), where a gradient fill is chosen. */
export function gradientFillStroke(): void {
  if (!commandChecked({ palette: "attributes" })) runCommand({ palette: "attributes" });
}

/** The swap arrow's glyph: a turn with its arrowhead, drawn for Rodeo. */
const SWAP_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3.5 11V6.5a2.5 2.5 0 0 1 2.5-2.5h4.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M8.6 1.8 10.9 4 8.6 6.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The default squares' glyph: a white square with a black outline over a black one. */
const DEFAULT_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" fill="#000000"/><rect x="0.5" y="0.5" width="7" height="7" fill="#ffffff" stroke="#000000"/></svg>`;

/** The red diagonal that marks a square as none. */
const NONE_MARK = `<svg class="lk-fs-cross" viewBox="0 0 18 18" aria-hidden="true"><path d="M1.5 16.5 16.5 1.5" stroke="#d93a2b" stroke-width="1.5" fill="none"/></svg>`;

/** A button's glyph: a solid square in the current colour (Color). */
const COLOR_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>`;

/** Gradient's glyph: a square shading from one colour to the other. */
let gradientIds = 0;
function gradientIcon(): string {
  const id = `lk-fs-grad-${++gradientIds}`;
  return `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="1" y="1" width="10" height="10" fill="url(#${id})" stroke="currentColor" stroke-width="0.8"/></svg>`;
}

/** None's glyph: a white square with the red diagonal. */
const NONE_ICON = `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#ffffff" stroke="#8a8a8a" stroke-width="0.8"/><path d="M2 10 10 2" stroke="#d93a2b" stroke-width="1.2" fill="none"/></svg>`;

/** The colour a fill shows: its ground when it is solid, else none. */
function fillColour(a: Partial<Attributes>): string | null {
  if (a.fillPattern === 0 || a.fillBack === undefined) return null;
  return store.session?.doc.color(a.fillBack) || null;
}

/** The colour a pen shows: its colour when it has a pen, else none. */
function penColour(a: Partial<Attributes>): string | null {
  if (a.lineStyle === 0 || a.penFore === undefined) return null;
  return store.session?.doc.color(a.penFore) || null;
}

/** Shows a square as its colour, or as none (white with the red diagonal). */
function showSquare(btn: HTMLElement, colour: string | null, hollow: boolean): void {
  if (hollow) {
    // the stroke square is hollow: its thick border is the pen colour, and none is white with the diagonal
    btn.style.borderColor = colour ?? "#ffffff";
    btn.style.background = "transparent";
  } else {
    btn.style.background = colour ?? "#ffffff";
  }
  btn.innerHTML = colour === null ? NONE_MARK : "";
}

/** The squares and their buttons for the toolbox's foot; returns the element and the call that takes it down. */
export function mountFillStroke(): { readonly el: HTMLElement; readonly unmount: () => void } {
  const fillSquare = h("button", { cls: "lk-fs-square lk-fs-fill", title: "Fill (X)", attrs: { type: "button", "aria-label": "Fill" } });
  const strokeSquare = h("button", { cls: "lk-fs-square lk-fs-stroke", title: "Stroke (X)", attrs: { type: "button", "aria-label": "Stroke" } });
  const swap = h("button", {
    cls: "lk-fs-swap",
    title: "Swap Fill and Stroke (Shift+X)",
    html: SWAP_ICON,
    attrs: { type: "button", "aria-label": "Swap Fill and Stroke" },
  });
  const reset = h("button", {
    cls: "lk-fs-default",
    title: "Default Fill and Stroke (D)",
    html: DEFAULT_ICON,
    attrs: { type: "button", "aria-label": "Default Fill and Stroke" },
  });
  const color = h("button", { cls: "lk-fs-tool", title: "Color (,)", html: COLOR_ICON, attrs: { type: "button", "aria-label": "Color" } });
  const gradient = h("button", { cls: "lk-fs-tool", title: "Gradient (.)", html: gradientIcon(), attrs: { type: "button", "aria-label": "Gradient" } });
  const none = h("button", { cls: "lk-fs-tool", title: "None (/)", html: NONE_ICON, attrs: { type: "button", "aria-label": "None" } });

  const art = h("div", { cls: "lk-fs-art" }, fillSquare, strokeSquare, swap, reset);
  const tools = h("div", { cls: "lk-fs-tools" }, color, gradient, none);
  const el = h("div", { cls: "lk-fs" }, art, tools);

  // a click brings a square to the front; a double-click shows the Attributes palette beside it
  const choose = (which: "fill" | "stroke"): void => {
    if (front !== which) {
      front = which;
      repaint();
    }
  };
  fillSquare.addEventListener("click", () => choose("fill"));
  strokeSquare.addEventListener("click", () => choose("stroke"));
  fillSquare.addEventListener("dblclick", gradientFillStroke);
  strokeSquare.addEventListener("dblclick", gradientFillStroke);
  swap.addEventListener("click", swapFillStroke);
  reset.addEventListener("click", defaultFillStroke);
  color.addEventListener("click", colorFillStroke);
  gradient.addEventListener("click", gradientFillStroke);
  none.addEventListener("click", noneFillStroke);

  const paint = (): void => {
    const a = current();
    const fill = fillColour(a);
    const pen = penColour(a);
    showSquare(fillSquare, fill, false);
    showSquare(strokeSquare, pen, true);
    fillSquare.classList.toggle("lk-front", front === "fill");
    strokeSquare.classList.toggle("lk-front", front === "stroke");
    fillSquare.setAttribute("aria-pressed", String(front === "fill"));
    strokeSquare.setAttribute("aria-pressed", String(front === "stroke"));
  };
  painters.add(paint);
  paint();
  const offs = [
    store.on(["selection", "attrs", "session", "class"], paint),
  ];
  return {
    el,
    unmount: () => {
      painters.delete(paint);
      for (const off of offs) off();
      el.remove();
    },
  };
}
