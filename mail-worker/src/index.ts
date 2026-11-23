/**
 * Rodeo's inbound mail Worker. Cloudflare Email Routing hands each message for
 * rodeo.build to email() here; the raw MIME goes to the server's
 * POST /api/mail/inbound, which parses, threads and stores it. When the server
 * does not store a message, a copy goes to FORWARD_TO so nothing is lost, and
 * with ALWAYS_FORWARD="1" stored mail gets a copy there too. The Worker keeps
 * no mail itself and logs one line per message without addresses or content.
 */

// Minimal types for the parts of Cloudflare's Email Worker API that we use,
// declared here so the package needs no dependencies.
export interface ForwardableEmailMessage {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  readonly canBeForwarded: boolean;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  setReject(reason: string): void;
}

export interface Env {
  INBOUND_URL: string;
  /** "1" keeps a copy of stored mail at FORWARD_TO as well. */
  ALWAYS_FORWARD?: string;
  /** Same value as the server's MAIL_INBOUND_SECRET. */
  INBOUND_SECRET?: string;
  /** A verified Email Routing destination address (a secret). Optional. */
  FORWARD_TO?: string;
}

export interface HandleOptions {
  /** Pauses between tries in ms. Default: 1 s, then 3 s. */
  pauses?: number[];
}

const MAX_BYTES = 25 * 1024 * 1024;
const TRIES = 3;
const TRY_TIMEOUT_MS = 15_000;
const DEFAULT_PAUSES = [1000, 3000];

interface Delivery {
  stored: boolean;
  status: string;
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

/** POST the raw message, retrying only on network errors, 429 and 5xx. */
async function post(
  raw: ArrayBuffer,
  env: Env,
  secret: string,
  message: ForwardableEmailMessage,
  pauses: number[],
): Promise<Delivery> {
  let status = "none";
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    let retry: boolean;
    try {
      const res = await fetch(env.INBOUND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "message/rfc822",
          "X-Requested-With": "openvwx",
          "X-Envelope-From": message.from,
          "X-Envelope-To": message.to,
        },
        body: raw,
        signal: AbortSignal.timeout(TRY_TIMEOUT_MS),
      });
      status = String(res.status);
      if (res.ok) return { stored: true, status };
      retry = res.status === 429 || res.status >= 500;
    } catch {
      status = "network";
      retry = true;
    }
    if (!retry) return { stored: false, status };
    if (attempt < TRIES) await pause(pauses[attempt - 1] ?? 0);
  }
  return { stored: false, status };
}

/** Handle one inbound message. Throws when it is neither stored nor forwarded, so Email Routing defers it. */
export async function handleMail(
  message: ForwardableEmailMessage,
  env: Env,
  options: HandleOptions = {},
): Promise<void> {
  const pauses = options.pauses ?? DEFAULT_PAUSES;
  const declaredSize = message.rawSize;
  if (declaredSize > MAX_BYTES) {
    message.setReject("Message too large");
    console.log(`mail: rejected size=${declaredSize} reason=too-large`);
    return;
  }

  const raw = await new Response(message.raw).arrayBuffer();
  const size = raw.byteLength;
  const forwardTo = env.FORWARD_TO || undefined;
  const secret = env.INBOUND_SECRET;

  let delivery: Delivery;
  if (!secret) {
    console.log("mail: INBOUND_SECRET is not set");
    delivery = { stored: false, status: "no-secret" };
  } else {
    delivery = await post(raw, env, secret, message, pauses);
  }

  if (delivery.stored) {
    let copy = "";
    if (env.ALWAYS_FORWARD === "1" && forwardTo) {
      try {
        await message.forward(forwardTo);
        copy = " copy=forwarded";
      } catch (err) {
        copy = ` copy=failed:${errorName(err)}`;
      }
    }
    console.log(`mail: stored status=${delivery.status} size=${size}${copy}`);
    return;
  }

  let note = "no-forward-address";
  if (forwardTo && !message.canBeForwarded) {
    note = "not-forwardable";
  } else if (forwardTo) {
    try {
      const headers = new Headers();
      headers.set("X-Rodeo-Inbox", "not-stored");
      await message.forward(forwardTo, headers);
      note = "forwarded";
    } catch (err) {
      note = `forward-failed:${errorName(err)}`;
    }
  }
  console.log(`mail: not stored status=${delivery.status} size=${size} ${note}`);
  if (note === "forwarded") return;
  throw new Error("Rodeo inbox unavailable; message not stored");
}

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: unknown): Promise<void> {
    void ctx;
    await handleMail(message, env, {});
  },
};
