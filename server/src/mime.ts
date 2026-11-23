// Helpers for the mailbox (mailbox.ts): reading the Message-ID and reference lists, the Cloudflare
// Authentication-Results header, subjects with their Re:/Fwd: prefixes taken off, the text shown
// for a message with only HTML, and the one-line snippet kept with each message.

import type { MailAuth } from "../../web/src/platform/protocol.ts";

/** A Message-ID with its angle brackets, or null when there is none. */
export function messageIdOf(v: string | undefined | null): string | null {
  const raw = (v ?? "").trim();
  if (!raw) return null;
  const bracketed = /<[^<>\s]+>/.exec(raw);
  if (bracketed) return bracketed[0];
  return `<${raw.replace(/\s+/g, "")}>`;
}

/** Every Message-ID in a header such as References: each with its brackets, in order. */
export function messageIdsIn(v: string | undefined | null): string[] {
  return [...(v ?? "").matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

/** A subject with its Re:, Fwd:, Fw:, AW: and SV: prefixes taken off (any number, any case), trimmed. */
export function normalSubject(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd?|aw|sv)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The value of one of Cloudflare's auth results ("pass", "fail", "none"...), or null when not said. */
function verdict(text: string, method: string): string | null {
  const m = new RegExp(`(?:^|[\\s;])${method}=([A-Za-z]+)`, "i").exec(text);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * SPF, DKIM and DMARC from the Authentication-Results headers Cloudflare adds ("mx.cloudflare.net;
 * spf=pass …; dkim=pass …; dmarc=pass …"). Null when the message has no such header from Cloudflare.
 */
export function authOf(headers: readonly { key: string; value: string }[]): MailAuth | null {
  const mine = headers.filter((h) => h.key === "authentication-results");
  // Cloudflare puts its own on top; one a sender wrote further down, or one from another host, is not believed
  const header = mine.find((h) => /^\s*mx\.cloudflare\.net\b/i.test(h.value));
  if (!header) return null;
  return { spf: verdict(header.value, "spf"), dkim: verdict(header.value, "dkim"), dmarc: verdict(header.value, "dmarc") };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML to plain text, roughly: scripts and styles dropped, block ends as line breaks, tags gone, entities decoded. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table)\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, body: string) => {
      if (body[0] === "#") {
        const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[body.toLowerCase()] ?? all;
    });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The start of a message's text for the list: quoted lines and "On … wrote:" lines dropped, whitespace collapsed, 160 characters. */
export function snippetOf(text: string): string {
  const kept = text
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith(">") && !/^On\b.*\bwrote:\s*$/i.test(t);
    })
    .join(" ");
  return Array.from(kept.replace(/\s+/g, " ").trim()).slice(0, 160).join("");
}
