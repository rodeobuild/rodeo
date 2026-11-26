// Sign-in. openSignIn shows the dialog: what a free account adds beside the ways in, an emailed
// link or a provider (Google, Microsoft, GitHub) where the server has one. requireSignIn is what
// features call before an action that needs an account. Signing in is optional: the editor works
// without one.
//
// Signing in never costs a drawing that is open. With one open, a provider's pages open in a small
// window of their own (signInWith), and this page learns who signed in when that window says so
// (authSignal.ts); an emailed link opens in another tab, which says so the same way. Either way the
// dialog closes by itself and what asked for the sign-in carries on.

import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { account, currentUser, onUser, refreshUser, userReady } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";
import { benefitList } from "./benefits.ts";
import { config, loadConfig } from "./config.ts";
import { field, openModal, type Modal } from "./dialog.ts";

export type Provider = ServerConfig["auth"]["oauth"][number];

export const PROVIDER_NAMES: Record<Provider, string> = { google: "Google", microsoft: "Microsoft", github: "GitHub" };
const RESEND_AFTER = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The page a provider's sign-in window ends on (public/signed-in.html): it tells this page and closes. */
const SIGNED_IN_PAGE = "/signed-in.html";
const CLOSE = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>`;

/**
 * Resolves true at once when someone is signed in. Otherwise opens the sign-in dialog, with
 * `reason` as its heading, and resolves when it closes: true when they signed in while it was
 * open (in a provider's window, or from the emailed link in another tab), false when they closed
 * it. Signing in with a provider and no drawing open leaves the page, so nothing resolves then.
 */
export async function requireSignIn(reason: string): Promise<boolean> {
  if (await userReady()) return true;
  if (!(config() ?? (await loadConfig()))) {
    toast("Signing in is not set up on this server.", "info");
    return false;
  }
  return new Promise((resolve) => openSignIn(reason, () => resolve(currentUser() !== null)));
}

/**
 * Starts signing in with a provider. With a drawing open its pages go in a small window, so the
 * drawing stays as it is ("window", or the window itself to watch); with none, or where the
 * browser refuses the window, this page goes there and comes back signed in.
 */
export function signInWith(provider: Provider): Window | null {
  if (store.session) {
    const w = window.open(account.oauthUrl(provider, SIGNED_IN_PAGE), "rodeo-sign-in", "popup,width=520,height=720");
    if (w) return w;
  }
  location.href = account.oauthUrl(provider);
  return null;
}

/** Where the dialog opens: its ways in, its email field, or waiting on a provider's window that is already open. */
export type SignInStart = "methods" | "email" | { readonly provider: Provider; readonly opened: Window };

/**
 * Signs in with a provider from outside the dialog (the start screen's button): with a drawing open
 * its pages go in their own window and the dialog opens to say so; with none, this page goes there.
 */
export function startProvider(provider: Provider): void {
  const opened = signInWith(provider);
  if (opened) openSignIn("", undefined, { provider, opened });
}

/** Opens the sign-in dialog; `reason` is its heading (the usual one when empty), `onClose` runs when it closes, `start` is where it opens. */
export function openSignIn(reason: string, onClose?: () => void, start: SignInStart = "methods"): void {
  const cfg = config();
  if (!cfg) return;
  let modal: Modal | null = null;
  let timer = 0;
  let watching = 0;
  const stopTimer = (): void => window.clearInterval(timer);
  const stopWatching = (): void => window.clearInterval(watching);
  const area = h("div", { cls: "acct-area" });

  const send = async (address: string): Promise<boolean> => {
    modal?.error(null);
    try {
      await account.emailSignIn(address);
      return true;
    } catch (err) {
      modal?.error(errorMessage(err));
      return false;
    }
  };

  const resend = (address: string): HTMLButtonElement => {
    const btn = h("button", { cls: "btn", text: "Send it again", attrs: { type: "button" } });
    let left = 0;
    const tick = (): void => {
      btn.disabled = left > 0;
      btn.textContent = left > 0 ? `Send it again in ${left} s` : "Send it again";
    };
    const wait = (): void => {
      stopTimer();
      left = RESEND_AFTER;
      tick();
      timer = window.setInterval(() => {
        left -= 1;
        tick();
        if (left <= 0) stopTimer();
      }, 1000);
    };
    btn.addEventListener("click", () => {
      btn.disabled = true;
      void send(address).then((ok) => (ok ? wait() : tick()));
    });
    wait();
    return btn;
  };

  const showSent = (address: string): void => {
    const other = h("button", { cls: "btn", text: "Use another email", attrs: { type: "button" } });
    other.addEventListener("click", () => showMethods());
    area.replaceChildren(
      h("p", { cls: "acct-status", text: "Check your inbox for a sign-in link" }),
      h("p", { cls: "acct-note", text: `We sent it to ${address}. The link works for 15 minutes.` }),
      h("p", { cls: "acct-note", text: "Open it in this browser and this window signs in by itself: your drawing stays as it is." }),
      h("div", { cls: "acct-row" }, resend(address), other),
    );
  };

  const emailForm = (): HTMLFormElement => {
    const input = h("input", {
      cls: "acct-input",
      attrs: { type: "email", name: "email", autocomplete: "email", spellcheck: "false", placeholder: "you@example.com", "aria-label": "Email address" },
    });
    const submit = h("button", { cls: cfg.auth.oauth.length ? "btn acct-wide acct-go" : "btn primary acct-wide acct-go", text: "Email me a sign-in link", attrs: { type: "submit" } });
    const form = h("form", { cls: "acct-form", attrs: { novalidate: "" } }, field("Email", input), submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const address = input.value.trim();
      if (!EMAIL.test(address)) {
        modal?.error("Enter an email address, such as you@example.com.");
        input.focus();
        return;
      }
      submit.disabled = true;
      void send(address).then((ok) => {
        if (ok) showSent(address);
        else submit.disabled = false;
      });
    });
    return form;
  };

  /** A provider's pages are open in their own window: say so, and look again when it closes. */
  const showWindow = (provider: Provider, opened: Window): void => {
    stopWatching();
    let w = opened;
    const again = h("button", { cls: "btn", text: "Open the window again", attrs: { type: "button" } });
    again.addEventListener("click", () => {
      const next = signInWith(provider);
      if (next) w = next;
    });
    const back = h("button", { cls: "btn", text: "Use another way", attrs: { type: "button" } });
    back.addEventListener("click", () => showMethods());
    area.replaceChildren(
      h("p", { cls: "acct-status", text: `Finish signing in with ${PROVIDER_NAMES[provider]} in the window that opened` }),
      h("p", { cls: "acct-note", text: "This window signs in by itself when you are done: your drawing stays as it is." }),
      h("div", { cls: "acct-row" }, again, back),
    );
    // the window closed (signed in, or given up): ask the server who this is now
    watching = window.setInterval(() => {
      if (!w.closed) return;
      stopWatching();
      void refreshUser().then((user) => {
        if (!user) showMethods();
      });
    }, 500);
  };

  const providerButton = (p: Provider, first: boolean): HTMLButtonElement => {
    const btn = h("button", { cls: first ? "btn primary acct-provider" : "btn acct-provider", text: `Continue with ${PROVIDER_NAMES[p]}`, attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      const w = signInWith(p);
      if (w) showWindow(p, w);
    });
    return btn;
  };

  const showMethods = (): void => {
    stopTimer();
    stopWatching();
    const nodes: Node[] = [];
    if (cfg.auth.oauth.length) nodes.push(h("div", { cls: "acct-providers" }, ...cfg.auth.oauth.map((p, i) => providerButton(p, i === 0))));
    if (cfg.auth.oauth.length && cfg.auth.email) nodes.push(h("div", { cls: "acct-divider", text: "or" }));
    if (cfg.auth.email) nodes.push(emailForm());
    if (!cfg.auth.oauth.length && !cfg.auth.email) nodes.push(h("p", { cls: "acct-note", text: "No sign-in methods are set up on this server." }));
    area.replaceChildren(...nodes);
  };
  if (typeof start === "object") showWindow(start.provider, start.opened);
  else showMethods();

  const close = h("button", { cls: "signin-close", html: CLOSE, attrs: { type: "button", "aria-label": "Close", title: "Close" } });
  close.addEventListener("click", () => modal?.close());
  const aside = h(
    "aside",
    { cls: "signin-aside" },
    h("img", { cls: "signin-logo", attrs: { src: "/icon.svg", alt: "", width: "32", height: "32" } }),
    h("h3", { cls: "signin-aside-title", text: "A free Rodeo account" }),
    benefitList(cfg, "lines"),
    h("p", { cls: "signin-aside-fine", text: "Free, with no card needed. Signing in is optional: Rodeo works without an account." }),
  );
  const main = h(
    "div",
    { cls: "signin-main" },
    close,
    h("h2", { cls: "signin-title", text: reason || "Sign in or create an account" }),
    h("p", { cls: "signin-lead", text: "New here? Signing in makes your free account. There is no password to remember." }),
    area,
  );

  // signed in while the dialog is open (the provider's window, the emailed link in another tab): done
  const stopUser = onUser((user) => {
    if (user) modal?.close();
  });
  // back on this tab after the emailed link was opened somewhere that couldn't tell it: ask the server
  const look = (): void => {
    if (document.visibilityState === "visible" && !currentUser()) void refreshUser();
  };
  document.addEventListener("visibilitychange", look);

  modal = openModal({
    title: reason || "Sign in or create an account",
    cls: "signin-dialog",
    body: [aside, main],
    actions: [],
    onClose: () => {
      stopTimer();
      stopWatching();
      stopUser();
      document.removeEventListener("visibilitychange", look);
      onClose?.();
    },
  });
  const focus = start === "email" ? main.querySelector<HTMLElement>("input") : (main.querySelector<HTMLElement>(".acct-provider") ?? main.querySelector<HTMLElement>("input, .acct-row .btn"));
  focus?.focus();
}
