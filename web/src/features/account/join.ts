// The start screen's account block, in its second column, for someone who is not signed in: what
// a free account adds, and the ways in, one click from starting (a provider) or from the dialog's
// email field. Shown only where the server offers sign-in, and gone once someone is signed in.
// Whether the last visit here was signed in is kept in this browser, so the block is there (or
// not) from the first paint instead of arriving when the server answers.

import { h } from "../../app/dom.ts";
import { countPrompt } from "../../app/visits.ts";
import { currentUser, onUser, userLoaded } from "../../platform/api.ts";
import { benefitList } from "./benefits.ts";
import { config, onConfig } from "./config.ts";
import { openSignIn, PROVIDER_NAMES, startProvider } from "./signin.ts";

/** "guest" or "user": who the last visit to this server's start screen was. */
const SEEN_KEY = "openvwx.account.seen";

function seen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function remember(who: "guest" | "user"): void {
  try {
    localStorage.setItem(SEEN_KEY, who);
  } catch {
    // storage blocked: the block arrives with the server's answer
  }
}

/** Who the start screen is for, as far as is known: null before the server has answered on a first visit. */
export function visitor(): "guest" | "user" | null {
  if (config() && userLoaded()) return currentUser() ? "user" : "guest";
  const last = seen();
  return last === "guest" || last === "user" ? last : null;
}

export function joinCard(): HTMLElement {
  const body = h("div", { cls: "hub-join-body" });
  const card = h(
    "section",
    { cls: "hub-join", hidden: true, attrs: { "aria-label": "Free account" } },
    h("h2", { cls: "hub-side-title", text: "Create a free account" }),
    h("p", { cls: "hub-side-note", text: "Keep your drawings safe in the cloud and pick them up on any device." }),
    body,
  );
  let built = false;
  const render = (): void => {
    const cfg = config();
    if (cfg && userLoaded()) remember(currentUser() ? "user" : "guest");
    card.hidden = visitor() !== "guest";
    if (!cfg || built) return;
    built = true;
    const actions = h("div", { cls: "hub-join-actions" });
    cfg.auth.oauth.forEach((p, i) => {
      const btn = h("button", { cls: i === 0 ? "btn primary" : "btn", text: `Continue with ${PROVIDER_NAMES[p]}`, attrs: { type: "button" } });
      // with a drawing open behind the start screen its pages open in their own window, and the dialog says so
      btn.addEventListener("click", () => startProvider(p, "start"));
      actions.append(btn);
    });
    if (cfg.auth.email) {
      const btn = h("button", { cls: cfg.auth.oauth.length ? "btn" : "btn primary", text: "Continue with email", attrs: { type: "button" } });
      btn.addEventListener("click", () => openSignIn("", undefined, "email", "start"));
      actions.append(btn);
    }
    body.replaceChildren(benefitList(cfg, "short", 4), actions, h("p", { cls: "hub-join-fine", text: "Free, with no card and no password. Rodeo works without an account too." }));
  };
  onConfig(render);
  onUser(render);
  // counted once a visit, when it is really on screen for someone the server says is not signed in
  // (not for the guess from the last visit, nor while the start screen is not up)
  let counted = false;
  if (typeof IntersectionObserver === "function") {
    const seen = new IntersectionObserver((entries) => {
      if (counted || !entries.some((e) => e.isIntersecting) || !config() || !userLoaded() || currentUser()) return;
      counted = true;
      seen.disconnect();
      countPrompt("join", "shown");
    });
    seen.observe(card);
    // the server's answer may come after the block is already on screen: look again then
    const again = (): void => {
      if (counted) return;
      seen.unobserve(card);
      seen.observe(card);
    };
    onConfig(again);
    onUser(again);
  }
  return card;
}
