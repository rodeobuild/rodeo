// What a free account adds, as the start screen's account block (join.ts) and the sign-in dialog
// (signin.ts) list it: an icon and a few words each. Only what this server offers is listed.

import { h } from "../../app/dom.ts";
import type { ServerConfig } from "../../platform/protocol.ts";

const svg = (body: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICON_CLOUD = svg(`<path d="M4.8 12.2h6.6a2.6 2.6 0 0 0 .4-5.2 3.6 3.6 0 0 0-6.9.9 2.1 2.1 0 0 0-.1 4.3z"/>`);
const ICON_HISTORY = svg(`<path d="M2.6 8a5.4 5.4 0 1 0 1.7-3.9"/><path d="M2.4 2.6v2.6H5"/><path d="M8 5.2V8l1.9 1.3"/>`);
const ICON_LINK = svg(`<path d="M6.9 9.1a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.7.7"/><path d="M9.1 6.9a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.7-.7"/>`);
const ICON_PEOPLE = svg(`<circle cx="6" cy="5.6" r="2.2"/><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5"/><path d="M10.4 3.6a2.2 2.2 0 0 1 0 4.1"/><path d="M11.8 9.8c1.2.5 2 1.6 2.2 3.2"/>`);
const ICON_SPARK = svg(`<path d="M7 2.4l1.2 3.4L11.6 7 8.2 8.2 7 11.6 5.8 8.2 2.4 7l3.4-1.2z"/><path d="M12.2 10.4l.5 1.4 1.4.5-1.4.5-.5 1.4-.5-1.4-1.4-.5 1.4-.5z"/>`);

interface Benefit {
  readonly icon: string;
  /** a few words, for the start screen */
  readonly short: string;
  /** a line, for the sign-in dialog */
  readonly line: string;
  /** whether this server offers it */
  readonly on: (cfg: ServerConfig) => boolean;
}

const BENEFITS: readonly Benefit[] = [
  { icon: ICON_CLOUD, short: "Cloud drawings", line: "Cloud drawings on any device", on: () => true },
  { icon: ICON_HISTORY, short: "Version history", line: "Version history for every drawing", on: () => true },
  { icon: ICON_LINK, short: "Share links and embeds", line: "Share links and live embeds", on: (cfg) => cfg.plans.free.shareLinks },
  { icon: ICON_PEOPLE, short: "Editing together", line: "Editing together, with comments", on: (cfg) => cfg.collab },
  { icon: ICON_SPARK, short: "AI agents and renders", line: "AI agents, renders, voice commands", on: (cfg) => cfg.ai !== null },
];

/** The list: the short words in two columns (the start screen), or a line each (the dialog). */
export function benefitList(cfg: ServerConfig, form: "short" | "lines", limit = BENEFITS.length): HTMLElement {
  return h(
    "ul",
    { cls: form === "short" ? "acct-benefits acct-benefits-short" : "acct-benefits" },
    ...BENEFITS.filter((b) => b.on(cfg))
      .slice(0, limit)
      .map((b) => h("li", {}, h("span", { cls: "acct-benefit-icon", html: b.icon }), h("span", { text: form === "short" ? b.short : b.line }))),
  );
}
