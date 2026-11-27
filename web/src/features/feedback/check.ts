// The check after a file comes in: while Rodeo is new, a card over the drawing asks whether the
// file the user just opened or imported looks right, with one click to report it (the form opens
// with a screenshot and the file ticked, report.ts) and one to say it does. Each file (by name and
// size) is asked about once on this device; the card goes when answered or closed, and when
// another drawing comes to the front. The answers are counted (app/visits.ts), so the admin page
// shows how files went for the people who brought them in, and how many left without answering.
//
// A file that could not be read gets a card of its own straight away: why, in a line, and Send
// file, with an email to be told when it opens. The file and the failure go as a report (the
// failure filed with others like it, server/src/feedback.ts), and once it is fixed an admin tells
// everyone who waits on it from the admin page's Feedback tab. A file too large to send still
// lets its sender wait, as long as they give an email.

import { h } from "../../app/dom.ts";
import { onDocument } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { countCheck } from "../../app/visits.ts";
import { currentUser, feedback } from "../../platform/api.ts";
import { withoutName } from "../../platform/failures.ts";
import { config } from "../account/config.ts";
import { onBrought, type Brought } from "./brought.ts";
import { feedbackContext, feedbackDiagnostics, openFeedback } from "./report.ts";

/** time to look at the drawing before being asked */
const ASK_AFTER_MS = 2500;
const ASKED_KEY = "openvwx.fileChecks";
/** files remembered as asked about; the oldest are forgotten */
const ASKED_KEPT = 200;
/** how long the thanks stays once a failed file is sent */
const THANKS_MS = 5000;

let card: HTMLElement | null = null;
let showing: Brought | null = null;
let timer = 0;
/** stops a failed file's upload when its card goes */
let sending: AbortController | null = null;

onBrought((b) => {
  if (!config() || asked(b)) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => show(b), b.error ? 400 : ASK_AFTER_MS);
});

// the card is about the drawing it came into: another one brought to the front takes it away
onDocument((session) => {
  if (showing?.session && session !== showing.session) hide();
});

function keyOf(b: Brought): string {
  return `${b.name}|${b.size}`;
}

function askedList(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(ASKED_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : [];
  } catch {
    return [];
  }
}

function asked(b: Brought): boolean {
  return askedList().includes(keyOf(b));
}

function remember(b: Brought): void {
  try {
    const list = askedList().filter((k) => k !== keyOf(b));
    list.push(keyOf(b));
    localStorage.setItem(ASKED_KEY, JSON.stringify(list.slice(-ASKED_KEPT)));
  } catch {
    // storage off: the file may be asked about again
  }
}

function hide(): void {
  sending?.abort();
  sending = null;
  card?.remove();
  card = null;
  showing = null;
}

function show(b: Brought): void {
  // moved on to another drawing while waiting
  if (b.session && store.session !== b.session) return;
  const stage = document.getElementById("stage");
  // a failed file still on its way isn't stopped for the next file's question
  if (!stage || sending) return;
  hide();
  remember(b);
  countCheck(b.error ? "failed" : "asked", b.name);
  if (b.error) {
    showFailed(stage, b, b.error);
    return;
  }

  const answer = (how: "ok" | "report" | "closed"): void => {
    countCheck(how, b.name);
    hide();
    if (how === "report") openFeedback("bug", { about: b });
  };
  const button = (label: string, primary: boolean, run: () => void): HTMLButtonElement => {
    const btn = h("button", { cls: primary ? "btn small primary" : "btn small", text: label, attrs: { type: "button" } });
    btn.addEventListener("click", run);
    return btn;
  };
  const close = h("button", { cls: "icon-btn fb-check-close", text: "×", title: "Close", attrs: { type: "button", "aria-label": "Close" } });
  close.addEventListener("click", () => answer("closed"));

  const title = `Does ${b.name} look right?`;
  const text =
    "Rodeo is new, and some files don't come in perfectly yet. If anything is missing or looks off, one click opens a report with a screenshot and the file attached, so we can fix it.";
  card = h(
    "section",
    { cls: "fb-check", attrs: { role: "status", "aria-label": title } },
    h("div", { cls: "fb-check-head" }, h("h2", { cls: "fb-check-title", text: title, title: b.name }), close),
    h("p", { cls: "fb-check-text", text }),
    h("div", { cls: "fb-check-actions" }, button("Report a problem", true, () => answer("report")), button("Looks right", false, () => answer("ok"))),
  );
  showing = b;
  stage.append(card);
}

/** Why a file didn't open, in a line, from what the reader said; the toast has the whole of it. */
export function shortReason(error: string): string {
  const year = /saved by Vectorworks (\d{4}), which Rodeo can't read yet/.exec(error)?.[1];
  if (year) return `Rodeo can't read Vectorworks ${year} files yet.`;
  const reader = /Rodeo's (.+?) reader stopped on this file/.exec(error)?.[1];
  if (reader) return `Rodeo's ${reader} reader stopped on it.`;
  if (/isn't an Archicad 17 or later file/.test(error)) return "Rodeo can't read files from before Archicad 17 yet.";
  if (/^Rodeo can't open /.test(error)) return "Rodeo can't open this kind of file yet.";
  return "Send it and we'll find out why.";
}

/** True while the start screen is up: a file that fails there leaves it up, over the drawing. */
function startScreenUp(): boolean {
  const welcome = document.getElementById("welcome");
  return welcome !== null && !welcome.hidden && welcome.getClientRects().length > 0;
}

/**
 * The card for a file that could not be read: why, and Send file with an email to hear when it
 * opens. Most files that fail are dropped on the start screen, which stays up, so there the card
 * sits over it (fixed to the window's corner) rather than in the drawing behind it.
 */
function showFailed(stage: HTMLElement, b: Brought, error: string): void {
  const maxBytes = config()?.maxUploadBytes ?? Infinity;
  const withFile = b.size > 0 && b.size <= maxBytes;
  const title = `${b.name} didn't open`;
  const close = h("button", { cls: "icon-btn fb-check-close", text: "×", title: "Close", attrs: { type: "button", "aria-label": "Close" } });
  const email = h("input", {
    cls: "acct-input fb-check-email",
    attrs: { type: "email", inputmode: "email", autocomplete: "email", maxlength: "254", placeholder: "you@example.com", "aria-label": "Email me when it opens" },
  });
  email.value = currentUser()?.email ?? "";
  const send = h("button", { cls: "btn small primary", text: withFile ? "Send file" : "Tell me", attrs: { type: "button" } });
  const later = h("button", { cls: "btn small", text: "Not now", attrs: { type: "button" } });
  const note = h("p", { cls: "fb-check-error", hidden: true, attrs: { role: "alert" } });
  const body = h(
    "div",
    { cls: "fb-check-body" },
    h("p", { cls: "fb-check-text", text: shortReason(error) }),
    h("label", { cls: "fb-check-label" }, h("span", { text: "Email me when it opens" }), email),
    note,
    h("div", { cls: "fb-check-actions" }, send, later),
    h("p", { cls: "fb-check-fine", text: withFile ? "Only the Rodeo team sees the file. It's deleted after 90 days." : "The file is too large to send, but we'll still tell you." }),
  );
  const say = (text: string | null): void => {
    note.textContent = text ?? "";
    note.hidden = text === null;
  };
  const sync = (): void => {
    // with no file to send, the email is the point
    send.disabled = !withFile && email.value.trim() === "";
  };
  email.addEventListener("input", () => {
    say(null);
    sync();
  });
  sync();

  const thanks = (told: boolean): void => {
    const done = h("p", { cls: "fb-check-text", text: told ? "Thanks. We'll email you when it opens." : "Thanks, it's with us." });
    body.replaceChildren(done);
    window.setTimeout(() => {
      if (showing === b) hide();
    }, THANKS_MS);
  };

  const go = async (): Promise<void> => {
    const address = email.value.trim();
    if (address && !email.checkValidity()) {
      say("Enter a valid email, or leave it empty.");
      email.focus();
      return;
    }
    say(null);
    countCheck("report", b.name);
    const stop = new AbortController();
    sending = stop;
    send.disabled = true;
    email.disabled = true;
    send.textContent = "Sending…";
    let saved = false;
    try {
      const sent = await feedback.send({
        kind: "bug",
        message: `Didn't open: ${b.name}\n\n${error}`,
        email: address || null,
        context: feedbackContext(b),
        diagnostics: feedbackDiagnostics(),
        attach: { screenshot: false, file: withFile ? { name: b.name, size: b.size } : null },
        failure: { file: b.name, error: withoutName(error, b.name) },
        website: "",
      });
      saved = true;
      if (withFile && sent.token && !sent.fileRefused) {
        await feedback.file(sent, b.file, (n, total) => (send.textContent = `Sending… ${Math.floor((n / total) * 100)}%`), stop.signal);
      }
      if (stop.signal.aborted) return;
      sending = null;
      thanks(address !== "");
    } catch (err) {
      if (stop.signal.aborted) return;
      sending = null;
      if (saved) {
        // the report and the email arrived; only the file didn't
        thanks(address !== "");
        return;
      }
      say(errorMessage(err));
      send.textContent = withFile ? "Send file" : "Tell me";
      email.disabled = false;
      sync();
    }
  };
  send.addEventListener("click", () => void go());
  email.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !send.disabled) void go();
  });
  const dismiss = (): void => {
    countCheck("closed", b.name);
    hide();
  };
  later.addEventListener("click", dismiss);
  close.addEventListener("click", dismiss);

  const overStart = startScreenUp();
  card = h(
    "section",
    { cls: overStart ? "fb-check failed over-start" : "fb-check failed", attrs: { role: "status", "aria-label": title } },
    h("div", { cls: "fb-check-head" }, h("h2", { cls: "fb-check-title", text: title, title: b.name }), close),
    body,
  );
  showing = b;
  (overStart ? document.body : stage).append(card);
}
