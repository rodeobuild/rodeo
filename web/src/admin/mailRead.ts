// The Mail tab's open conversation: its subject and actions (reply, reply all, forward, file it, star,
// mark unread, delete for good), then its messages oldest first. The newest and every unread one open;
// the rest fold to a line. A message's text is linkified with DOM nodes, and its quoted lines fold
// behind a button. Its HTML goes in a sandboxed frame with no scripts; remote images wait for a click.

import { h } from "../app/dom.ts";
import { errorMessage, toast } from "../app/toast.ts";
import { mailbox } from "../platform/api.ts";
import type { MailAddress, MailFolder, MailMessage, MailSent, MailSettings, MailThread, MailThreadFull } from "../platform/protocol.ts";
import { ago, bytes, dateTime } from "./format.ts";
import { composeBox, type ComposeKind } from "./mailCompose.ts";

export interface ReadDeps {
  readonly full: MailThreadFull;
  readonly settings: MailSettings;
  /** the messages open on screen, by id; kept when the conversation is drawn again */
  readonly expanded: Set<string>;
  /** a change to the conversation's star or unread mark went through */
  readonly onChange: (thread: MailThread) => void;
  /** it was filed elsewhere or deleted: the conversation closes */
  readonly onLeave: () => void;
  readonly onForward: () => void;
  readonly onSent: (sent: MailSent) => void;
}

export interface ReadView {
  readonly el: HTMLElement;
  /** draws the conversation's new state (after a change, from anywhere) */
  readonly update: (thread: MailThread) => void;
}

/** a remote image: an img src or a CSS url() that is http(s) */
const REMOTE_IMAGE = /\bsrc\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i;
const QUOTE = /^\s*>/;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/g;
const FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export function readConversation(d: ReadDeps): ReadView {
  const { full, settings, expanded } = d;
  let thread = full.thread;
  const last: MailMessage | null = full.messages[full.messages.length - 1] ?? null;
  let busy = false;

  const actions = h("div", { cls: "mail-actions" });
  const replyHost = h("div", { cls: "mail-reply-host" });

  const showReply = (kind: Extract<ComposeKind, "reply" | "replyAll">, focus: boolean): void => {
    if (!last) return;
    const box = composeBox({ kind, threadId: thread.id, message: last, settings, panel: false, focus, onSent: d.onSent });
    replyHost.replaceChildren(box);
  };

  const button = (label: string, onClick: () => void, extra = "", pressed?: boolean): HTMLElement => {
    const b = h("button", { cls: `adm-btn small${extra ? ` ${extra}` : ""}`, text: label, attrs: { type: "button" } });
    if (pressed !== undefined) b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", onClick);
    return b;
  };

  const patch = async (change: { folder?: MailFolder; unread?: boolean; starred?: boolean }): Promise<void> => {
    if (busy) return;
    busy = true;
    try {
      const next = await mailbox.update(thread.id, change);
      if (change.folder !== undefined) d.onLeave();
      else d.onChange(next);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  };

  const remove = async (): Promise<void> => {
    if (busy) return;
    if (!window.confirm("Delete this conversation for good? It can't be undone.")) return;
    busy = true;
    try {
      await mailbox.remove(thread.id);
      d.onLeave();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      busy = false;
    }
  };

  const drawActions = (): void => {
    const f = thread.folder;
    actions.replaceChildren(
      button("Reply", () => showReply("reply", true), "primary"),
      button("Reply all", () => showReply("replyAll", true)),
      button("Forward", () => d.onForward()),
      f === "archive" ? button("Move to inbox", () => void patch({ folder: "inbox" })) : button("Archive", () => void patch({ folder: "archive" })),
      f === "spam" ? button("Not spam", () => void patch({ folder: "inbox" })) : button("Spam", () => void patch({ folder: "spam" })),
      f === "trash" ? button("Delete for good", () => void remove(), "danger") : button("Trash", () => void patch({ folder: "trash" })),
      button(thread.starred ? "Unstar" : "Star", () => void patch({ starred: !thread.starred }), "", thread.starred),
      button("Mark unread", () => void patch({ unread: true })),
    );
  };

  const count = full.messages.length;
  const head = h(
    "div",
    { cls: "mail-head" },
    h("h2", { cls: "mail-subject", text: thread.subject || "(no subject)" }),
    h("p", { cls: "adm-muted", text: `${count} ${count === 1 ? "message" : "messages"}` }),
  );

  drawActions();
  showReply("reply", false);

  const messages = h(
    "div",
    { cls: "mail-messages" },
    ...full.messages.map((m) => messageView(m, expanded.has(m.id), expanded)),
  );

  const el = h("div", { cls: "mail-conv" }, head, actions, messages, replyHost);
  return {
    el,
    update: (next: MailThread) => {
      thread = next;
      drawActions();
    },
  };
}

/** One message: a line when folded, the whole of it when open. */
function messageView(m: MailMessage, open: boolean, expanded: Set<string>): HTMLElement {
  if (!open) {
    const fold = h(
      "button",
      { cls: "mail-msg-fold", attrs: { type: "button", "aria-expanded": "false" } },
      h("span", { cls: "mail-msg-from", text: nameOf(m.from) }),
      h("span", { cls: "mail-msg-snip", text: snippetOf(m.text) }),
      h("time", { cls: "mail-msg-when", text: ago(m.date), attrs: { datetime: m.date, title: dateTime(m.date) } }),
    );
    const el = h("article", { cls: m.unread ? "mail-msg unread" : "mail-msg" }, fold);
    fold.addEventListener("click", () => {
      expanded.add(m.id);
      el.replaceWith(messageView(m, true, expanded));
    });
    return el;
  }
  return openMessage(m);
}

function openMessage(m: MailMessage): HTMLElement {
  const failed = m.auth?.dmarc === "fail" || m.auth?.spf === "fail";
  const auth = m.auth ? `SPF ${m.auth.spf ?? "none"}, DKIM ${m.auth.dkim ?? "none"}, DMARC ${m.auth.dmarc ?? "none"}` : "";
  const lines: (HTMLElement | null)[] = [
    m.to.length > 0 ? h("p", { cls: "mail-msg-line", text: `To: ${listOf(m.to)}` }) : null,
    m.cc.length > 0 ? h("p", { cls: "mail-msg-line", text: `Cc: ${listOf(m.cc)}` }) : null,
    m.deliveredTo ? h("p", { cls: "mail-msg-line", text: `Came to ${m.deliveredTo}` }) : null,
  ];
  const files = m.attachments.filter((a) => !a.inline);
  return h(
    "article",
    { cls: m.unread ? "mail-msg open unread" : "mail-msg open" },
    h(
      "div",
      { cls: "mail-msg-head" },
      h(
        "div",
        { cls: "mail-msg-from-row" },
        h("strong", { cls: "mail-msg-name", text: nameOf(m.from) }),
        m.from.name ? h("span", { cls: "adm-muted", text: m.from.address }) : null,
        m.direction === "out" ? h("span", { cls: "adm-badge", text: "Sent" }) : null,
        failed ? h("span", { cls: "adm-badge danger", text: "Sender not verified", attrs: { title: auth } }) : null,
      ),
      ...lines,
      h("time", { cls: "mail-msg-date", text: dateTime(m.date), attrs: { datetime: m.date } }),
    ),
    bodyView(m),
    files.length > 0
      ? h(
          "ul",
          { cls: "mail-files", attrs: { "aria-label": "Attachments" } },
          ...files.map((a) =>
            h(
              "li",
              {},
              h("a", {
                cls: "adm-btn small",
                text: `${a.filename} (${bytes(a.size)})`,
                attrs: { href: mailbox.attachmentUrl(a.id), download: a.filename },
              }),
            ),
          ),
        )
      : null,
    m.direction === "in"
      ? h("p", { cls: "mail-eml" }, h("a", { cls: "adm-btn small ghost", text: "Download .eml", attrs: { href: mailbox.rawUrl(m.id), download: "message.eml" } }))
      : null,
  );
}

/** The body: the HTML in a frame (with a switch to the text), or the text. */
function bodyView(m: MailMessage): HTMLElement {
  const box = h("div", { cls: "mail-body" });
  if (m.html === null) {
    box.append(plainView(m.text));
    return box;
  }
  const html = m.html;
  const remote = REMOTE_IMAGE.test(html);
  let formatted = true;
  let images = false;
  const draw = (): void => {
    const parts: Node[] = [];
    const toggle = h("button", {
      cls: "adm-btn small ghost",
      text: formatted ? "Plain text" : "Formatted",
      attrs: { type: "button" },
    });
    toggle.addEventListener("click", () => {
      formatted = !formatted;
      draw();
    });
    parts.push(h("div", { cls: "mail-body-bar" }, toggle));
    if (formatted) {
      if (remote && !images) {
        const show = h("button", { cls: "adm-btn small", text: "Show images", attrs: { type: "button" } });
        show.addEventListener("click", () => {
          images = true;
          draw();
        });
        parts.push(h("div", { cls: "mail-remote" }, h("span", { text: "Remote images are hidden." }), show));
      }
      parts.push(framed(html, images));
    } else {
      parts.push(plainView(m.text));
    }
    box.replaceChildren(...parts);
  };
  draw();
  return box;
}

/**
 * The HTML in a sandboxed frame: no scripts, a content security policy that lets styles and data
 * images through (and http(s) images only once they are wanted). It is as tall as its content.
 */
function framed(html: string, images: boolean): HTMLIFrameElement {
  const frame = h("iframe", { cls: "mail-frame", attrs: { title: "Message", sandbox: FRAME_SANDBOX } });
  frame.srcdoc = `<!doctype html><meta charset=utf-8><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data: ${images ? "https: http:" : ""}"><base target="_blank"><style>body{margin:0;padding:14px 16px;font:14px/1.5 system-ui,sans-serif;color:#222;background:#fff;word-wrap:break-word} img{max-width:100%;height:auto}</style>${html}`;
  const fit = (): void => {
    const doc = frame.contentDocument;
    if (!doc?.documentElement) return;
    frame.style.height = `${doc.documentElement.scrollHeight}px`;
    for (const img of doc.images) {
      if (img.complete) continue;
      img.addEventListener("load", fit, { once: true });
      img.addEventListener("error", fit, { once: true });
    }
  };
  frame.addEventListener("load", fit);
  return frame;
}

/** The plain text: its quoted runs fold behind a button, and its links are real ones. */
function plainView(text: string): HTMLElement {
  const root = h("div", { cls: "mail-text" });
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length) {
    const quoted = QUOTE.test(lines[i] ?? "");
    let j = i + 1;
    while (j < lines.length && QUOTE.test(lines[j] ?? "") === quoted) j++;
    const chunk = lines.slice(i, j).join("\n");
    i = j;
    if (!quoted) {
      root.append(h("div", { cls: "mail-chunk" }, ...linkify(chunk)));
      continue;
    }
    const body = h("div", { cls: "mail-chunk mail-quote", hidden: true }, ...linkify(chunk));
    const toggle = h("button", {
      cls: "adm-btn small ghost mail-quote-toggle",
      text: "Show quoted text",
      attrs: { type: "button", "aria-expanded": "false" },
    });
    toggle.addEventListener("click", () => {
      body.hidden = !body.hidden;
      toggle.textContent = body.hidden ? "Show quoted text" : "Hide quoted text";
      toggle.setAttribute("aria-expanded", String(!body.hidden));
    });
    root.append(toggle, body);
  }
  if (text.trim() === "") root.append(h("p", { cls: "adm-muted", text: "(no text)" }));
  return root;
}

/** Text as nodes, with each http(s) link made an anchor (the text itself is never parsed as HTML). */
function linkify(text: string): (Node | string)[] {
  const out: (Node | string)[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let url = match[0];
    const at = match.index ?? 0;
    // a full stop or bracket after a link is the sentence's, not the link's
    const trail = /[.,;:!?)\]}]+$/.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, url.length - trail.length);
    if (at > last) out.push(text.slice(last, at));
    out.push(h("a", { text: url, attrs: { href: url, target: "_blank", rel: "noopener noreferrer" } }));
    last = at + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function nameOf(a: MailAddress): string {
  return a.name || a.address;
}

function listOf(addresses: readonly MailAddress[]): string {
  return addresses.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(", ");
}

function snippetOf(text: string): string {
  return (text.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "").slice(0, 160);
}

/** Which messages open when a conversation is first shown: the newest and every unread one. */
export function openByDefault(full: MailThreadFull): Set<string> {
  const last = full.messages.length - 1;
  return new Set(full.messages.filter((m, i) => i === last || m.unread).map((m) => m.id));
}
