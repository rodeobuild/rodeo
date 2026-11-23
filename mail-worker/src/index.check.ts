/**
 * Offline checks for the inbound mail Worker. Runs handleMail and the default
 * export against fake messages and a stubbed global fetch; no network, no
 * Cloudflare account. Run with `npx tsx src/index.check.ts` from mail-worker/.
 */
import worker, { handleMail, type Env, type ForwardableEmailMessage } from "./index.ts";

// Declared locally: the package has no @types/node.
declare const process: { exitCode?: number };

const INBOUND_URL = "https://rodeo.test/api/mail/inbound";
const SECRET = "test-secret-not-real";
const FORWARD_TO = "ops@rodeo.test";
const RAW = "From: sender@example.com\r\nTo: alex@rodeo.test\r\nSubject: hi\r\n\r\nHello.\r\n";
const PAUSES = [0, 0];

// Console output is captured so the check can assert nothing personal is logged.
const logs: string[] = [];
const realLog = console.log;
console.log = (...args: unknown[]) => {
  logs.push(args.map(String).join(" "));
};
const out = (line: string) => realLog(line);

interface Forward {
  rcpt: string;
  headers?: Headers;
}

interface FakeMessage extends ForwardableEmailMessage {
  forwards: Forward[];
  rejected: string[];
}

function makeMessage(opts: { rawSize?: number; canBeForwarded?: boolean; failForward?: boolean } = {}): FakeMessage {
  const forwards: Forward[] = [];
  const rejected: string[] = [];
  const raw = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(RAW));
      controller.close();
    },
  });
  return {
    from: "sender@example.com",
    to: "alex@rodeo.test",
    headers: new Headers(),
    raw,
    rawSize: opts.rawSize ?? RAW.length,
    canBeForwarded: opts.canBeForwarded ?? true,
    forwards,
    rejected,
    async forward(rcpt: string, headers?: Headers) {
      if (opts.failForward) throw new Error("forward refused");
      forwards.push({ rcpt, headers });
    },
    setReject(reason: string) {
      rejected.push(reason);
    },
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

let calls: Call[] = [];
let plan: Array<number | "net"> = [];

/** Each fetch takes the next step of the plan: an HTTP status, or "net" for a network failure. */
function stubFetch(steps: Array<number | "net">): void {
  calls = [];
  plan = [...steps];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const step = plan.shift() ?? 200;
    if (step === "net") throw new TypeError("fetch failed");
    return new Response("{}", { status: step });
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

const envWith = (overrides: Partial<Env> = {}): Env => ({
  INBOUND_URL,
  INBOUND_SECRET: SECRET,
  FORWARD_TO,
  ALWAYS_FORWARD: "0",
  ...overrides,
});

let checks = 0;
let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  out(`${ok ? "ok  " : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

async function scenario(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    check(name, false, `unexpected error: ${err instanceof Error ? err.name : String(err)}`);
  }
}

function header(call: Call, name: string): string | null {
  return new Headers(call.init.headers).get(name);
}

async function main(): Promise<void> {
  await scenario("stored: POST goes to INBOUND_URL with the contract headers and raw body", async () => {
    stubFetch([200]);
    const msg = makeMessage();
    await handleMail(msg, envWith({ FORWARD_TO: undefined }), { pauses: PAUSES });
    check("stored: one request", calls.length === 1, `got ${calls.length}`);
    const call = calls[0];
    check("stored: URL is INBOUND_URL", call?.url === INBOUND_URL, call?.url);
    check("stored: method POST", call?.init.method === "POST", String(call?.init.method));
    check("stored: Authorization bearer", header(call, "Authorization") === `Bearer ${SECRET}`);
    check("stored: Content-Type message/rfc822", header(call, "Content-Type") === "message/rfc822");
    check("stored: X-Requested-With openvwx", header(call, "X-Requested-With") === "openvwx");
    check("stored: X-Envelope-From", header(call, "X-Envelope-From") === "sender@example.com");
    check("stored: X-Envelope-To", header(call, "X-Envelope-To") === "alex@rodeo.test");
    const body = new TextDecoder().decode(call?.init.body as ArrayBuffer);
    check("stored: body is the raw MIME", body === RAW, `got ${body.length} bytes`);
    check("stored: no forward", msg.forwards.length === 0);
    check("stored: not rejected", msg.rejected.length === 0);
  });

  await scenario("stored + ALWAYS_FORWARD=1: copy forwarded to FORWARD_TO without the X- header", async () => {
    stubFetch([200]);
    const msg = makeMessage();
    await handleMail(msg, envWith({ ALWAYS_FORWARD: "1" }), { pauses: PAUSES });
    check("always: one copy forwarded", msg.forwards.length === 1, `got ${msg.forwards.length}`);
    check("always: copy goes to FORWARD_TO", msg.forwards[0]?.rcpt === FORWARD_TO);
    check("always: copy has no X-Rodeo-Inbox", msg.forwards[0]?.headers === undefined);
  });

  await scenario("stored + ALWAYS_FORWARD=1 without FORWARD_TO: nothing forwarded", async () => {
    stubFetch([200]);
    const msg = makeMessage();
    await handleMail(msg, envWith({ ALWAYS_FORWARD: "1", FORWARD_TO: undefined }), { pauses: PAUSES });
    check("always no address: no forward", msg.forwards.length === 0);
  });

  await scenario("stored + ALWAYS_FORWARD=1 but the copy fails: still succeeds", async () => {
    stubFetch([200]);
    const msg = makeMessage({ failForward: true });
    await handleMail(msg, envWith({ ALWAYS_FORWARD: "1" }), { pauses: PAUSES });
    check("copy failure: logged as copy=failed", logs.some((l) => l.includes("copy=failed:Error")));
  });

  await scenario("503 then 200: retried once and stored", async () => {
    stubFetch([503, 200]);
    const msg = makeMessage();
    await handleMail(msg, envWith(), { pauses: PAUSES });
    check("503 then 200: two requests", calls.length === 2, `got ${calls.length}`);
    check("503 then 200: no forward", msg.forwards.length === 0);
  });

  await scenario("401: not retried, forwarded with X-Rodeo-Inbox", async () => {
    stubFetch([401]);
    const msg = makeMessage();
    await handleMail(msg, envWith(), { pauses: PAUSES });
    check("401: one request", calls.length === 1, `got ${calls.length}`);
    check("401: forwarded once", msg.forwards.length === 1, `got ${msg.forwards.length}`);
    check("401: forwarded to FORWARD_TO", msg.forwards[0]?.rcpt === FORWARD_TO);
    check("401: X-Rodeo-Inbox not-stored", msg.forwards[0]?.headers?.get("X-Rodeo-Inbox") === "not-stored");
  });

  await scenario("network failure x3: forwarded with X-Rodeo-Inbox", async () => {
    stubFetch(["net", "net", "net"]);
    const msg = makeMessage();
    await handleMail(msg, envWith(), { pauses: PAUSES });
    check("network: three tries", calls.length === 3, `got ${calls.length}`);
    check("network: forwarded", msg.forwards.length === 1, `got ${msg.forwards.length}`);
    check("network: X-Rodeo-Inbox not-stored", msg.forwards[0]?.headers?.get("X-Rodeo-Inbox") === "not-stored");
  });

  await scenario("network failure x3 with no FORWARD_TO: throws so Email Routing retries", async () => {
    stubFetch(["net", "net", "net"]);
    const msg = makeMessage();
    let threw = false;
    try {
      await handleMail(msg, envWith({ FORWARD_TO: undefined }), { pauses: PAUSES });
    } catch {
      threw = true;
    }
    check("no address + failure: throws", threw);
    check("no address + failure: three tries", calls.length === 3, `got ${calls.length}`);
    check("no address + failure: nothing forwarded", msg.forwards.length === 0);
  });

  await scenario("503 x3 and not forwardable: throws", async () => {
    stubFetch([503, 503, 503]);
    const msg = makeMessage({ canBeForwarded: false });
    let threw = false;
    try {
      await handleMail(msg, envWith(), { pauses: PAUSES });
    } catch {
      threw = true;
    }
    check("not forwardable + failure: throws", threw);
    check("not forwardable: nothing forwarded", msg.forwards.length === 0);
  });

  await scenario("too large: setReject and no request", async () => {
    stubFetch([]);
    const msg = makeMessage({ rawSize: 25 * 1024 * 1024 + 1 });
    await handleMail(msg, envWith(), { pauses: PAUSES });
    check("too large: rejected with reason", msg.rejected[0] === "Message too large", String(msg.rejected[0]));
    check("too large: no request", calls.length === 0, `got ${calls.length}`);
  });

  await scenario("no INBOUND_SECRET: no request, forwarded with X-Rodeo-Inbox", async () => {
    stubFetch([]);
    const msg = makeMessage();
    await handleMail(msg, envWith({ INBOUND_SECRET: undefined }), { pauses: PAUSES });
    check("no secret: no request", calls.length === 0, `got ${calls.length}`);
    check("no secret: forwarded", msg.forwards.length === 1, `got ${msg.forwards.length}`);
    check("no secret: X-Rodeo-Inbox not-stored", msg.forwards[0]?.headers?.get("X-Rodeo-Inbox") === "not-stored");
  });

  await scenario("default export wires email() to the same handler", async () => {
    stubFetch([200]);
    const msg = makeMessage();
    await worker.email(msg, envWith({ FORWARD_TO: undefined }), {});
    check("default export: one request stored", calls.length === 1 && msg.forwards.length === 0);
  });

  const personal = logs.filter((l) => l.includes("@"));
  check("logs carry no addresses", personal.length === 0, personal[0] ?? "");

  globalThis.fetch = originalFetch;
  console.log = realLog;
  out(`\n${checks} checks, ${failures} failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

await main();
