// Email: through SMTP_URL with nodemailer, or to the log when it is not set.
// Each send opens its own connection. A connection-level failure is tried again on a new connection,
// up to three attempts in all; the server's answers to MAIL, RCPT and DATA are not retried.

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

/** Sends a plain-text email; `replyTo` is where a reply goes instead of MAIL_FROM. */
export async function sendMail(to: string, subject: string, text: string, replyTo?: string): Promise<void> {
  if (!config.smtpUrl) {
    console.log(`[mail] to ${to}: ${subject}\n${text}\n`);
    return;
  }
  const url = urlWithTimeouts(config.smtpUrl);
  const message = { from: config.mailFrom, to, subject, text, ...(replyTo ? { replyTo } : {}) };
  for (let attempt = 1; ; attempt++) {
    const transport = nodemailer.createTransport(url);
    let failure: unknown;
    try {
      await transport.sendMail(message);
      return;
    } catch (err) {
      failure = err;
    } finally {
      transport.close?.();
    }
    const again = attempt < MAX_ATTEMPTS && isRetryable(failure);
    console.error(
      `[mail] attempt ${attempt} of ${MAX_ATTEMPTS} to ${masked(to)} failed: ${describe(failure)}${again ? "; trying again" : ""}`,
    );
    if (!again) throw failure;
    await new Promise((resolve) => setTimeout(resolve, pauses[attempt - 1] ?? 0));
  }
}
