// The Mail tab's composer: a new message, a reply or reply all under a conversation, or a forward in
// the pane. It fills From, To, Cc, Subject and the body from the message it answers (the signature
// goes after a blank line, the quoted original below it), keeps an unsent draft per conversation in
// sessionStorage, and sends with the button or Ctrl/Cmd+Enter. A failed send keeps the draft.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { mailbox } from "../platform/api.ts";
import type { MailAddress, MailAlias, MailMessage, MailSend, MailSent, MailSettings } from "../platform/protocol.ts";
import { dateTime } from "./format.ts";

export type ComposeKind = "new" | "reply" | "replyAll" | "forward";

export interface ComposeSpec {
  readonly kind: ComposeKind;
  /** the conversation (its id keys the draft); null for a new message */
  readonly threadId: string | null;
  /** the newest message of the conversation, which is answered or forwarded; null for a new message */
  readonly message: MailMessage | null;
  readonly settings: MailSettings;
  /** a panel in the pane (with a heading and Close) rather than the box under a conversation */
  readonly panel: boolean;
  /** put the cursor in it once shown: a panel always; the box under a conversation only when Reply was clicked */
  readonly focus?: boolean;
  readonly onClose?: () => void;
  readonly onSent: (sent: MailSent) => void;
}

interface Draft {
  readonly kind: ComposeKind;
  readonly from: string;
  readonly to: string;
  readonly cc: string;
  readonly subject: string;
  readonly body: string;
}

const DRAFT_PREFIX = "openvwx.mail.draft.";
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

const TITLE: Record<ComposeKind, string> = { new: "New message", reply: "Reply", replyAll: "Reply all", forward: "Forward" };

/** a draft is kept per conversation (a new message has one of its own) */
function draftKey(spec: ComposeSpec): string {
  if (!spec.threadId) return "new";
  return `${spec.kind === "forward" ? "forward" : "reply"}:${spec.threadId}`;
}

function loadDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.kind !== "string" || typeof d.from !== "string" || typeof d.to !== "string") return null;
    return {
      kind: d.kind as ComposeKind,
      from: d.from,
      to: d.to,
      cc: typeof d.cc === "string" ? d.cc : "",
      subject: typeof d.subject === "string" ? d.subject : "",
      body: typeof d.body === "string" ? d.body : "",
    };
  } catch {
    return null;
  }
}

function saveDraft(key: string, d: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d));
  } catch {
    // not kept: the draft lives in the box until the page is left
  }
}

function dropDraft(key: string): void {
  try {
    sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // nothing to drop
  }
}

/** "Name <address>" for the quoted lines and the forwarded header */
function fmt(a: MailAddress): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** Whether an address is one of ours: an alias, or at one of the domains mail is sent from. */
function ours(address: string, settings: MailSettings): boolean {
  const low = address.toLowerCase();
  return settings.aliases.some((a) => a.address.toLowerCase() === low) || settings.domains.some((d) => low.endsWith(`@${d.toLowerCase()}`));
}

/** Our addresses on the message (the one it reached first), the ones a reply could come from. */
function ourAddressesOn(spec: ComposeSpec): string[] {
  const m = spec.message;
  if (!m) return [];
  const candidates = m.direction === "in" ? [m.deliveredTo, ...m.to.map((a) => a.address), ...m.cc.map((a) => a.address)] : [m.from.address];
  const found = candidates.map((c) => (c ?? "").toLowerCase()).filter((c) => c && ours(c, spec.settings));
  return [...new Set(found)];
}

/** What the From list offers: the aliases, then our addresses on the message that aren't aliases. */
function fromChoices(spec: ComposeSpec): MailAlias[] {
  const aliases = [...spec.settings.aliases];
  const known = new Set(aliases.map((a) => a.address.toLowerCase()));
  for (const address of ourAddressesOn(spec)) if (!known.has(address)) aliases.push({ name: "", address });
  return aliases;
}

/** The address a reply goes out from: the one the message reached, or one of ours on it; else the first alias. */
function defaultFrom(spec: ComposeSpec): string {
  return ourAddressesOn(spec)[0] ?? spec.settings.aliases[0]?.address ?? "";
}

/** "Re: " or "Fwd: " in front of a subject, unless it has one. */
function withPrefix(subject: string, prefix: string, already: RegExp): string {
  return already.test(subject) ? subject : `${prefix}${subject}`;
}

/** What the fields start with, before any draft. */
function prefill(spec: ComposeSpec): Draft {
  const { kind, message: m, settings } = spec;
  const sig = settings.signature.trim();
  const sigBlock = sig ? `\n\n${sig}` : "";
  const from = defaultFrom(spec);
  if (!m || kind === "new") return { kind, from, to: "", cc: "", subject: "", body: sigBlock };

  if (kind === "forward") {
    const forwarded = [
      "---------- Forwarded message ----------",
      `From: ${fmt(m.from)}`,
      `Date: ${dateTime(m.date)}`,
      `Subject: ${m.subject}`,
      `To: ${m.to.map(fmt).join(", ")}`,
      "",
      m.text.trimEnd(),
    ].join("\n");
    return { kind, from, to: "", cc: "", subject: withPrefix(m.subject, "Fwd: ", /^fwd?:/i), body: `${sigBlock}\n\n${forwarded}` };
  }

  // a reply goes to whoever wrote an incoming message, and to the same people as one we sent
  const incoming = m.direction === "in";
  const primary = incoming ? [m.replyTo ?? m.from] : [...m.to];
  const others = kind === "replyAll" ? (incoming ? [...m.to, ...m.cc] : [...m.cc]) : [];
  const to = [...new Set(primary.map((a) => a.address))];
  const toSet = new Set(to);
  const cc = [...new Set(others.map((a) => a.address))].filter((a) => !toSet.has(a) && !ours(a, settings));
  const quoted = m.text
    .replace(/\r\n?/g, "\n")
    .trimEnd()
    .split("\n")
    .map((l) => (l.trim() ? `> ${l}` : ">"))
    .join("\n");
  const who = m.from.name || m.from.address;
  return {
    kind,
    from,
    to: to.join(", "),
    cc: cc.join(", "),
    subject: withPrefix(m.subject, "Re: ", /^re:/i),
    body: `${sigBlock}\n\nOn ${dateTime(m.date)}, ${who} wrote:\n${quoted}`,
  };
}

/** Addresses from a comma-separated field ("Name <a@b>" gives a@b), lower-cased. */
function splitAddresses(s: string): string[] {
  return s
    .split(/[,;]/)
    .map((part) => {
      const angled = /<([^>]*)>/.exec(part);
      return (angled ? angled[1] ?? "" : part).trim().toLowerCase();
    })
    .filter((a) => a.length > 0);
}

/** What stops a send, in words; null when it can go. */
function problemWith(from: string, to: string[], cc: string[], spec: ComposeSpec): string | null {
  if (!from) return spec.settings.aliases.length ? "Choose the address to send from." : "Type the address to send from, or add one in Mail settings.";
  if (!EMAIL.test(from)) return `"${from}" doesn't look like an email address.`;
  if (to.length === 0) return "Add someone to send it to.";
  const bad = [...to, ...cc].find((a) => !EMAIL.test(a));
  return bad ? `"${bad}" doesn't look like an email address.` : null;
}

/** The composer: its fields, its Send, and (as a panel) its heading and Close. */
export function composeBox(spec: ComposeSpec): HTMLElement {
  const key = draftKey(spec);
  const start = prefill(spec);
  const saved = loadDraft(key);
  const d = saved && saved.kind === spec.kind ? saved : start;
  const aliases = fromChoices(spec);

  let fromSel: HTMLSelectElement | null = null;
  let fromIn: HTMLInputElement | null = null;
  if (aliases.length > 0) {
    fromSel = h(
      "select",
      { cls: "adm-input", attrs: { "aria-label": "From" } },
      ...aliases.map((a) => h("option", { text: a.name ? `${a.name} <${a.address}>` : a.address, value: a.address })),
    );
    fromSel.value = aliases.some((a) => a.address === d.from) ? d.from : start.from;
  } else {
    fromIn = h("input", { cls: "adm-input", attrs: { type: "email", "aria-label": "From address", autocomplete: "off" } });
    fromIn.value = d.from;
  }
  const currentFrom = (): string => (fromSel?.value ?? fromIn?.value ?? "").trim();

  const toIn = h("input", { cls: "adm-input", attrs: { type: "text", "aria-label": "To", autocomplete: "off", placeholder: "name@example.com" } });
  const ccIn = h("input", { cls: "adm-input", attrs: { type: "text", "aria-label": "Cc", autocomplete: "off" } });
  const subIn = h("input", { cls: "adm-input", attrs: { type: "text", "aria-label": "Subject", autocomplete: "off" } });
  const bodyIn = h("textarea", { cls: "mail-textarea", attrs: { "aria-label": "Message", rows: "10", spellcheck: "true" } });
  toIn.value = d.to;
  ccIn.value = d.cc;
  subIn.value = d.subject;
  bodyIn.value = d.body;

  const note = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
  const showNote = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
  };
  const sendBtn = h("button", { cls: "adm-btn primary", text: "Send", attrs: { type: "button" } });
  let busy = false;

  // once sent, the box is spent: a change event from it leaving the page must not bring its draft back
  let sent = false;
  const save = (): void => {
    if (!sent) saveDraft(key, { kind: spec.kind, from: currentFrom(), to: toIn.value, cc: ccIn.value, subject: subIn.value, body: bodyIn.value });
  };

  const send = async (): Promise<void> => {
    if (busy) return;
    const from = currentFrom().toLowerCase();
    const to = splitAddresses(toIn.value);
    const cc = splitAddresses(ccIn.value);
    const problem = problemWith(from, to, cc, spec);
    if (problem) {
      showNote(problem);
      return;
    }
    note.hidden = true;
    const alias = aliases.find((a) => a.address.toLowerCase() === from);
    const answers = (spec.kind === "reply" || spec.kind === "replyAll") && spec.message ? spec.message.id : null;
    const payload: MailSend = {
      from,
      ...(alias?.name ? { fromName: alias.name } : {}),
      to,
      ...(cc.length > 0 ? { cc } : {}),
      subject: subIn.value.trim(),
      text: bodyIn.value,
      // a forward starts a conversation of its own; a reply files under the one it answers
      ...(answers ? { inReplyTo: answers } : {}),
    };
    busy = true;
    sendBtn.disabled = true;
    try {
      const result = await mailbox.send(payload);
      sent = true;
      dropDraft(key);
      spec.onSent(result);
    } catch (err) {
      showNote(errorMessage(err));
    } finally {
      busy = false;
      sendBtn.disabled = false;
    }
  };
  sendBtn.addEventListener("click", () => void send());

  const discard = h("button", { cls: "adm-btn small ghost", text: "Discard draft", attrs: { type: "button" } });
  discard.addEventListener("click", () => {
    const typed = toIn.value.trim() || subIn.value.trim() || bodyIn.value.trim();
    if (typed && !window.confirm("Throw this draft away?")) return;
    dropDraft(key);
    if (spec.panel) {
      spec.onClose?.();
      return;
    }
    toIn.value = start.to;
    ccIn.value = start.cc;
    subIn.value = start.subject;
    bodyIn.value = start.body;
    if (fromSel) fromSel.value = start.from;
    if (fromIn) fromIn.value = start.from;
    note.hidden = true;
  });

  const heading = TITLE[spec.kind];
  const close = spec.panel
    ? h("button", { cls: "adm-btn small ghost", text: "Close", attrs: { type: "button", "aria-label": "Close message" } })
    : null;
  close?.addEventListener("click", () => spec.onClose?.());

  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "mail-field" }, h("span", { cls: "mail-label", text: label }), control);

  const box = h(
    "section",
    { cls: spec.panel ? "mail-compose panel" : "mail-compose", attrs: { "aria-label": heading } },
    h("div", { cls: "mail-compose-head" }, h("h3", { text: heading }), close),
    field("From", fromSel ?? fromIn ?? h("span")),
    fromIn ? h("p", { cls: "mail-note", text: "No aliases yet: add the addresses you send from in Mail settings." }) : null,
    field("To", toIn),
    field("Cc", ccIn),
    field("Subject", subIn),
    bodyIn,
    spec.kind === "forward" ? h("p", { cls: "mail-note", text: "Attachments aren't forwarded." }) : null,
    spec.settings.sending ? null : h("p", { cls: "mail-note", text: "Sending isn't set up on the server yet, so this will fail." }),
    note,
    h(
      "div",
      { cls: "mail-compose-foot" },
      sendBtn,
      h("span", { cls: "adm-muted", text: "Ctrl/Cmd+Enter sends" }),
      discard,
    ),
  );

  // the cursor starts where the writing goes: above the quote in a reply, in To for new mail and forwards
  requestAnimationFrame(() => {
    if (!box.isConnected || !(spec.panel || spec.focus)) return;
    if (spec.kind === "reply" || spec.kind === "replyAll") {
      bodyIn.focus();
      bodyIn.setSelectionRange(0, 0);
      bodyIn.scrollTop = 0;
    } else toIn.focus();
  });

  box.addEventListener("input", save);
  box.addEventListener("change", save);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void send();
    }
  });
  return box;
}
