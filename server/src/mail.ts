// Email: through Cloudflare Email Sending's HTTPS API (CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_EMAIL_TOKEN),
// else SMTP_URL with nodemailer, else to the log. Hetzner Cloud blocks outgoing 25 and 465 and
// Cloudflare's SMTP takes only 465, so on rodeo.build mail goes through the API.
// Each send is tried up to three times in all: over the API when the request doesn't reach Cloudflare
// or it answers 429 or 5xx; over SMTP on a connection-level failure (the server's answers to MAIL,
// RCPT and DATA are not retried).

import nodemailer from "nodemailer";
import { config } from "./config.ts";

interface Timing {
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_CODES = new Set(["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNRESET", "ECONNREFUSED"]);

let timing: Timing = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };
let pauses = [500, 1500];
let apiBase = config.mailApiBase;

/** Tests only: where Cloudflare's API is taken to be. */
export function setMailApiBaseForTests(base: string): void {
  apiBase = base;
}

/** Tests only: shorter timeouts and pauses between attempts, so a silent server fails in a second or two. */
export function setMailTimingForTests(next: Partial<Timing>, pausesMs: number[]): void {
  timing = { ...timing, ...next };
  pauses = pausesMs;
}

/**
 * The URL with the timeouts added. nodemailer reads its options from the URL's query when given a
 * URL, so a timeout the URL already sets stays as it is.
 */
function urlWithTimeouts(url: string): string {
  const at = url.indexOf("?");
  const query = new URLSearchParams(at < 0 ? "" : url.slice(at + 1));
  const extra = (Object.keys(timing) as (keyof Timing)[])
    .filter((key) => !query.has(key))
    .map((key) => `${key}=${timing[key]}`);
  if (extra.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${extra.join("&")}`;
}

/** The recipients as a list: `to` as given, one or many. */
function recipients(to: string | readonly string[]): string[] {
  return typeof to === "string" ? [to] : [...to];
}

/** The address with its name hidden, for logs: a***@example.com. */
function masked(address: string): string {
  const at = address.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${address[0]}***${address.slice(at)}`;
}

/** A connection-level failure (nodemailer's CONN phase or a socket error code), not a refusal from the server. */
function isRetryable(err: unknown): boolean {
  const e = err as { code?: unknown; command?: unknown };
  return (typeof e.code === "string" && RETRY_CODES.has(e.code)) || e.command === "CONN";
}

function describe(err: unknown): string {
  const e = err as { code?: unknown; command?: unknown; responseCode?: unknown };
  const code = typeof e.code === "string" ? e.code : "error";
  const command = typeof e.command === "string" ? ` at ${e.command}` : "";
  const response = typeof e.responseCode === "number" ? ` (${e.responseCode})` : "";
  return `${code}${command}${response}`;
}

export interface MailMessage {
  /** "Name <address>" or an address; MAIL_FROM when left out */
  from?: string;
  /** one address, or several (the admin Mail tab sends to a list) */
  to: string | readonly string[];
  /** copies, besides `to` */
  cc?: readonly string[];
  subject: string;
  text: string;
  html?: string;
  /** where a reply goes instead of `from` */
  replyTo?: string;
  /** extra headers, such as In-Reply-To and References on a reply */
  headers?: Record<string, string>;
}

/** Sends a plain-text email; `replyTo` is where a reply goes instead of MAIL_FROM. */
export async function sendMail(to: string, subject: string, text: string, replyTo?: string): Promise<void> {
  await sendMessage({ to, subject, text, ...(replyTo ? { replyTo } : {}) });
}

/** Sends an email; gives its Message-ID when the way it went says (null when only logged). */
export async function sendMessage(m: MailMessage): Promise<string | null> {
  if (config.mailApi) return sendByApi(config.mailApi, m);
  if (!config.smtpUrl) {
    console.log(`[mail] to ${m.to}: ${m.subject}\n${m.text}\n`);
    return null;
  }
  const url = urlWithTimeouts(config.smtpUrl);
  const message = {
    from: m.from ?? config.mailFrom,
    to: recipients(m.to),
    ...(m.cc?.length ? { cc: [...m.cc] } : {}),
    subject: m.subject,
    text: m.text,
    ...(m.html ? { html: m.html } : {}),
    ...(m.replyTo ? { replyTo: m.replyTo } : {}),
    ...(m.headers ? { headers: m.headers } : {}),
  };
  for (let attempt = 1; ; attempt++) {
    const transport = nodemailer.createTransport(url);
    let failure: unknown;
    try {
      const info = (await transport.sendMail(message)) as { messageId?: string };
      return info.messageId ?? null;
    } catch (err) {
      failure = err;
    } finally {
      transport.close?.();
    }
    const again = attempt < MAX_ATTEMPTS && isRetryable(failure);
    console.error(
      `[mail] attempt ${attempt} of ${MAX_ATTEMPTS} to ${masked(recipients(m.to)[0] ?? "")} failed: ${describe(failure)}${again ? "; trying again" : ""}`,
    );
    if (!again) throw failure;
    await new Promise((resolve) => setTimeout(resolve, pauses[attempt - 1] ?? 0));
  }
}

/** A failure Cloudflare's API gave, or the request not reaching it (status 0). */
class ApiError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Cloudflare Email Sending ${status === 0 ? "unreachable" : `answered ${status}`}: ${detail}`);
    this.status = status;
  }
}

interface ApiAnswer {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { message_id?: string; permanent_bounces?: string[]; suppressed_recipients?: string[] } | null;
}

async function sendByApi(api: { accountId: string; token: string }, m: MailMessage): Promise<string | null> {
  const body = {
    from: m.from ?? config.mailFrom,
    to: recipients(m.to),
    ...(m.cc?.length ? { cc: [...m.cc] } : {}),
    subject: m.subject,
    text: m.text,
    ...(m.html ? { html: m.html } : {}),
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
  };
  const endpoint = `${apiBase}/accounts/${encodeURIComponent(api.accountId)}/email/sending/send`;
  for (let attempt = 1; ; attempt++) {
    let failure: ApiError;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${api.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timing.socketTimeout),
      });
      const answer = (await res.json().catch(() => ({}))) as ApiAnswer;
      if (res.ok && answer.success !== false) {
        const bounced = [...(answer.result?.permanent_bounces ?? []), ...(answer.result?.suppressed_recipients ?? [])];
        if (bounced.length) throw new ApiError(res.status, "the address bounced or is suppressed");
        return answer.result?.message_id ?? null;
      }
      const detail = (answer.errors ?? []).map((e) => `${e.code ?? "?"} ${e.message ?? ""}`.trim()).join("; ") || res.statusText;
      failure = new ApiError(res.status, detail);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      failure = new ApiError(0, err instanceof Error ? err.name : "error");
    }
    const again = attempt < MAX_ATTEMPTS && (failure.status === 0 || failure.status === 429 || failure.status >= 500);
    console.error(`[mail] attempt ${attempt} of ${MAX_ATTEMPTS} to ${masked(recipients(m.to)[0] ?? "")} failed: ${failure.message}${again ? "; trying again" : ""}`);
    if (!again) throw failure;
    await new Promise((resolve) => setTimeout(resolve, pauses[attempt - 1] ?? 0));
  }
}
