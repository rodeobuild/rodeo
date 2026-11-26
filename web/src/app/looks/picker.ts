// The start screen's Work Like picker (welcome.ts): each look of View › Work Like as a tile with
// its picture (thumbs.ts) and its name, the one on now marked. A click puts that look on, and the
// editor behind the start screen rearranges itself as it does from the menu. Not shown on a phone,
// which keeps Rodeo's touch layout whatever the look (looks.css).

import { h } from "../dom.ts";
import { countPrompt } from "../visits.ts";
import { currentLook, LOOKS, onLookChange, setLook } from "./looks.ts";
import { lookThumb } from "./thumbs.ts";
import type { LookId } from "./types.ts";

const CHECK = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.6 6.4 5 8.8l4.4-5.4"/></svg>`;

export function lookPicker(): HTMLElement {
  const tiles = new Map<LookId, HTMLButtonElement>();
  const mark = (on: LookId): void => {
    for (const [id, tile] of tiles) {
      tile.classList.toggle("on", id === on);
      tile.setAttribute("aria-pressed", String(id === on));
    }
  };
  const grid = h("div", { cls: "hub-look-grid", attrs: { role: "group", "aria-label": "Work Like" } });
  for (const look of LOOKS) {
    const tile = h(
      "button",
      { cls: "hub-look", attrs: { type: "button", "data-look": look.id } },
      h("span", { cls: "hub-look-art", html: lookThumb(look.id) }, h("span", { cls: "hub-look-check", html: CHECK })),
      h("span", { cls: "hub-look-name", text: look.name, attrs: { "data-i18n": `Work Like › ${look.name}` } }),
    );
    tile.addEventListener("click", () => {
      // a layout picked here, by name, is counted for the admin page (visits.ts)
      if (look.id !== currentLook()) countPrompt("picker", "taken", look.id);
      // marked at once; the look itself follows as its parts load
      mark(look.id);
      void setLook(look.id).then(() => mark(currentLook()));
    });
    tiles.set(look.id, tile);
    grid.append(tile);
  }
  mark(currentLook());
  // the menu's choice (View › Work Like) shows here too
  onLookChange(mark);
  return h(
    "section",
    { cls: "hub-looks", attrs: { "aria-label": "Work Like" } },
    h("h2", { cls: "hub-side-title", text: "Work like the app you know" }),
    h("p", { cls: "hub-side-note", text: "Rodeo lays out its menus, tools, words and shortcuts like the app you come from. Change it any time in View › Work Like." }),
    grid,
  );
}
