// A nudge: a small card over the foot of the drawing that offers one thing at a moment it is
// useful (Work Like for someone who has just opened another application's file, looks/suggest.ts;
// saving to the cloud for someone not signed in who has work to lose, features/cloud/keep.ts). One
// shows at a time, the next waits its turn, and none shows while the check after a file comes in
// (features/feedback/check.ts) is on screen. Each has one button that does the thing and a way to
// say no; it never comes between the user and the drawing.

import { h } from "./dom.ts";
import "./nudge.css";

export interface Nudge {
  /** a picture at its start: SVG markup (a look's picture, an icon) */
  readonly art: string;
  /** "icon": a small tile; "picture": a look's picture in its frame */
  readonly artKind: "icon" | "picture";
  readonly title: string;
  readonly text: string;
  /** the button that does it */
  readonly action: string;
  /** the button that says no */
  readonly refuse: string;
  /** whether it still applies when its turn comes (false: dropped without showing) */
  wanted(): boolean;
  run(): void;
  /** it showed */
  shown?(): void;
  /** closed without the action */
  refused?(): void;
}

const CLOSE = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>`;
/** how often a waiting nudge looks for its turn */
const RETRY_MS = 2000;

const waiting: Nudge[] = [];
/** the card on show, and the nudge it is for */
let card: HTMLElement | null = null;
let shownNudge: Nudge | null = null;
let timer = 0;

/** Queues a nudge: it shows when nothing else is asking for attention over the drawing. */
export function nudge(n: Nudge): void {
  waiting.push(n);
  next();
}

/** Takes the nudge on show away, if `n` is the one (its moment passed: someone signed in, the look changed). */
export function withdraw(n: Nudge): void {
  const at = waiting.indexOf(n);
  if (at >= 0) waiting.splice(at, 1);
  if (card && shownNudge === n) close();
}

function close(): void {
  card?.remove();
  card = null;
  shownNudge = null;
  next();
}

function next(): void {
  window.clearTimeout(timer);
  if (card || waiting.length === 0) return;
  const stage = document.getElementById("stage");
  // the check after a file comes in has the drawing's corner first; a dialog or the start screen has the window
  const busy = !stage || stage.querySelector(".fb-check") !== null || document.querySelector(".menu-dialog-backdrop") !== null || !document.getElementById("welcome")?.hidden;
  if (busy) {
    timer = window.setTimeout(next, RETRY_MS);
    return;
  }
  const n = waiting.shift()!;
  if (!n.wanted()) {
    next();
    return;
  }
  const dismiss = h("button", { cls: "nudge-close", html: CLOSE, attrs: { type: "button", "aria-label": "Close", title: "Close" } });
  const act = h("button", { cls: "btn primary", text: n.action, attrs: { type: "button" } });
  const refuse = h("button", { cls: "btn", text: n.refuse, attrs: { type: "button" } });
  const no = (): void => {
    close();
    n.refused?.();
  };
  dismiss.addEventListener("click", no);
  refuse.addEventListener("click", no);
  act.addEventListener("click", () => {
    close();
    n.run();
  });
  card = h(
    "section",
    { cls: "nudge", attrs: { role: "status", "aria-label": n.title } },
    h("div", { cls: n.artKind === "picture" ? "nudge-art nudge-picture" : "nudge-art nudge-icon", html: n.art, attrs: { "aria-hidden": "true" } }),
    h("div", { cls: "nudge-body" }, h("h3", { cls: "nudge-title", text: n.title }), h("p", { cls: "nudge-text", text: n.text }), h("div", { cls: "nudge-actions" }, act, refuse)),
    dismiss,
  );
  shownNudge = n;
  stage.append(card);
  n.shown?.();
}
