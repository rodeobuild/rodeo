// Tests for email delivery retries (src/mail.ts): node scripts/mail-test.ts
// A fake SMTP server on a loopback port plays each case: a server that never greets, one that
// hangs on the first connection only, and one that refuses the recipient. A fake Cloudflare Email
// Sending API then plays a busy answer, a refused request, a bounce, and the API taking precedence.

import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { config } from "../src/config.ts";
import { sendMail, sendMessage, setMailApiBaseForTests, setMailTimingForTests } from "../src/mail.ts";

type Plan = "hang" | "accept" | "refuse-recipient";

interface Fake {
  readonly port: number;
  connections: number;
  readonly delivered: string[];
  close(): Promise<void>;
}

/** An SMTP server whose behaviour for each connection (numbered from 1) comes from `plan`. */
async function fakeSmtp(plan: (connection: number) => Plan): Promise<Fake> {
  const sockets = new Set<Socket>();
  const delivered: string[] = [];
  const fake: Fake = { port: 0, connections: 0, delivered, close: async () => {} };
  const server: Server = createServer((socket) => {
    const n = ++fake.connections;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const mode = plan(n);
    if (mode === "hang") return;
    socket.write("220 fake.test ESMTP\r\n");
    let pending = "";
    let inData = false;
    socket.on("data", (chunk: Buffer) => {
      pending += chunk.toString("utf8");
      for (;;) {
        if (inData) {
          const end = pending.indexOf("\r\n.\r\n");
          if (end < 0) return;
          delivered.push(pending.slice(0, end));
          pending = pending.slice(end + 5);
          inData = false;
          socket.write("250 queued\r\n");
          continue;
        }
        const i = pending.indexOf("\r\n");
        if (i < 0) return;
        const line = pending.slice(0, i);
        pending = pending.slice(i + 2);
        const verb = line.slice(0, 4).toUpperCase();
        if (verb === "EHLO" || verb === "HELO") socket.write("250 fake.test\r\n");
        else if (verb === "RCPT") socket.write(mode === "refuse-recipient" ? "550 5.1.1 no such mailbox\r\n" : "250 ok\r\n");
        else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
          return;
        } else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  fake.port = typeof address === "object" && address ? address.port : 0;
  fake.close = () =>
    new Promise<void>((resolve) => {
      for (const s of sockets) s.destroy();
      server.close(() => resolve());
    });
  return fake;
}

/** Collects what sendMail writes to the console while `fn` runs, with the time each line came. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T | Error; lines: { at: number; text: string }[] }> {
  const lines: { at: number; text: string }[] = [];
  const original = console.error;
  const started = Date.now();
  console.error = (...args: unknown[]) => {
    lines.push({ at: Date.now() - started, text: args.map(String).join(" ") });
  };
  let result: T | Error;
  try {
    result = await fn();
  } catch (err) {
    result = err as Error;
  } finally {
    console.error = original;
  }
  return { result, lines };
}

const MESSAGE_SUBJECT = "Mail test subject";
const RECIPIENT = "reader.example@example.com";

async function send(): Promise<void> {
  await sendMail(RECIPIENT, MESSAGE_SUBJECT, "Body text for the test.");
}

// Short timeouts for the test: a silent server gives up in 300 ms per attempt, retries pause 10 ms.
setMailTimingForTests({ connectionTimeout: 300, greetingTimeout: 300, socketTimeout: 1000 }, [10, 10]);

// (a) A server that accepts the connection and never greets: the first attempt fails at the timeout.
{
  const fake = await fakeSmtp(() => "hang");
  config.smtpUrl = `smtp://127.0.0.1:${fake.port}?ignoreTLS=true`;
  const started = Date.now();
  const { result, lines } = await captureLogs(send);
  const first = lines.find((l) => l.text.includes("attempt 1 of 3"));
  assert.ok(first, "the first attempt is logged as failed");
  assert.match(first.text, /failed: ETIMEDOUT at CONN/);
  assert.ok(first.at < 1500, `the first attempt fails within its timeout (it took ${first.at} ms)`);
  assert.ok(result instanceof Error, "the send reports the failure");
  assert.ok(Date.now() - started < 5000, "bounded time");
  assert.ok(!lines.some((l) => l.text.includes(RECIPIENT)), "the log does not show the full address");
  assert.ok(lines.some((l) => l.text.includes("r***@example.com")), "the log shows the masked address");
  await fake.close();
  console.log("ok (a) a silent server fails the first attempt at the timeout, address masked in the log");
}

// (b) The first connection hangs, the second works: the mail is delivered exactly once.
{
  const fake = await fakeSmtp((n) => (n === 1 ? "hang" : "accept"));
  config.smtpUrl = `smtp://127.0.0.1:${fake.port}?ignoreTLS=true`;
  const { result, lines } = await captureLogs(send);
  assert.equal(result, undefined, "the send succeeds on the retry");
  assert.equal(fake.connections, 2, "two connections");
  assert.equal(fake.delivered.length, 1, "delivered once");
  assert.ok(fake.delivered[0]?.includes(`Subject: ${MESSAGE_SUBJECT}`), "the message arrived");
  assert.equal(lines.filter((l) => l.text.includes("failed")).length, 1, "one failed attempt is logged");
  await fake.close();
  console.log("ok (b) a hung first connection is retried and the mail arrives once");
}

// (c) The server refuses the recipient with 550: not retried, not delivered.
{
  const fake = await fakeSmtp(() => "refuse-recipient");
  config.smtpUrl = `smtp://127.0.0.1:${fake.port}?ignoreTLS=true`;
  const { result, lines } = await captureLogs(send);
  assert.ok(result instanceof Error, "the send reports the refusal");
  assert.equal((result as { code?: string }).code, "EENVELOPE", "the refusal is an envelope error");
  assert.equal(fake.connections, 1, "one connection, no retry");
  assert.equal(fake.delivered.length, 0, "nothing delivered");
  assert.equal(lines.length, 1, "one line logged");
  assert.match(lines[0]?.text ?? "", /attempt 1 of 3 to r\*\*\*@example\.com failed: EENVELOPE at RCPT TO \(550\)$/);
  await fake.close();
  console.log("ok (c) a recipient refused with 550 is not retried");
}

// (d) Every attempt hangs: three attempts in all, then the send gives up in bounded time.
{
  const fake = await fakeSmtp(() => "hang");
  config.smtpUrl = `smtp://127.0.0.1:${fake.port}?ignoreTLS=true`;
  const started = Date.now();
  const { result, lines } = await captureLogs(send);
  const elapsed = Date.now() - started;
  assert.ok(result instanceof Error, "the send gives up");
  assert.equal(fake.connections, 3, "three connections in all");
  assert.equal(fake.delivered.length, 0, "nothing delivered");
  assert.equal(lines.length, 3, "one line per attempt");
  assert.match(lines[2]?.text ?? "", /attempt 3 of 3 to r\*\*\*@example\.com failed: ETIMEDOUT at CONN$/);
  assert.ok(elapsed < 3000, `bounded time (${elapsed} ms)`);
  await fake.close();
  console.log(`ok (d) three hanging attempts give up after 3 connections (${elapsed} ms)`);
}

// ---- Cloudflare Email Sending's HTTPS API -------------------------------------------------------

interface ApiCall {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}

/** A fake of Cloudflare's send endpoint: answer k (from 1) is `answers(k)`, [status, JSON]. */
async function fakeApi(answers: (n: number) => [number, unknown]): Promise<{ base: string; calls: ApiCall[]; close(): Promise<void> }> {
  const calls: ApiCall[] = [];
  const server = createHttpServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    calls.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> });
    const [status, json] = answers(calls.length);
    res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { base: `http://127.0.0.1:${port}/client/v4`, calls, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const sentOk = (id: string): [number, unknown] => [200, { success: true, errors: [], result: { message_id: id, delivered: [], queued: [RECIPIENT], permanent_bounces: [], suppressed_recipients: [] } }];
const mutable = config as { mailApi: { accountId: string; token: string } | null; smtpUrl: string | null };

// (e) Busy (503) first, then sent: two requests, the API taking precedence over SMTP_URL, the fields mapped.
{
  const api = await fakeApi((n) => (n === 1 ? [503, { success: false, errors: [{ code: 1, message: "busy" }] }] : sentOk("<m1@rodeo.test>")));
  setMailApiBaseForTests(api.base);
  mutable.mailApi = { accountId: "acc123", token: "tok-test" };
  mutable.smtpUrl = "smtp://127.0.0.1:9?ignoreTLS=true";
  const { result, lines } = await captureLogs(() =>
    sendMessage({ from: "Cal <cal@rodeo.test>", to: RECIPIENT, subject: "Re: hi", text: "Hello", replyTo: "cal@rodeo.test", headers: { "In-Reply-To": "<a@x>", References: "<a@x>" } }),
  );
  assert.equal(result, "<m1@rodeo.test>", "the Message-ID comes back");
  assert.equal(api.calls.length, 2, "retried once after 503");
  const call = api.calls[1]!;
  assert.equal(call.path, "/client/v4/accounts/acc123/email/sending/send");
  assert.equal(call.auth, "Bearer tok-test");
  assert.deepEqual(call.body, { from: "Cal <cal@rodeo.test>", to: [RECIPIENT], subject: "Re: hi", text: "Hello", reply_to: "cal@rodeo.test", headers: { "In-Reply-To": "<a@x>", References: "<a@x>" } });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!.text, /attempt 1 of 3 to r\*\*\*@example\.com failed: Cloudflare Email Sending answered 503: 1 busy; trying again$/);
  await api.close();
  console.log("ok (e) the API is used before SMTP, a 503 is retried, fields map to Cloudflare's");
}

// (f) A refused request (400) is not retried; sendMail fills in MAIL_FROM and leaves out reply_to.
{
  const api = await fakeApi(() => [400, { success: false, errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }] }]);
  setMailApiBaseForTests(api.base);
  const { result, lines } = await captureLogs(send);
  assert.ok(result instanceof Error && /answered 400: 10001 email\.sending\.error\.invalid_request_schema/.test(result.message));
  assert.equal(api.calls.length, 1, "no retry");
  assert.equal(api.calls[0]!.body.from, config.mailFrom);
  assert.ok(!("reply_to" in api.calls[0]!.body) && !("headers" in api.calls[0]!.body));
  assert.equal(lines.length, 1);
  await api.close();
  console.log("ok (f) a 400 is not retried; MAIL_FROM is the default sender");
}

// (g) A bounced address is a failure, not retried; an unreachable API is tried three times.
{
  const api = await fakeApi(() => [200, { success: true, errors: [], result: { message_id: "<b@x>", permanent_bounces: [RECIPIENT], suppressed_recipients: [] } }]);
  setMailApiBaseForTests(api.base);
  const bounced = await captureLogs(send);
  assert.ok(bounced.result instanceof Error && /bounced/.test(bounced.result.message));
  assert.equal(api.calls.length, 1);
  await api.close();
  setMailApiBaseForTests(api.base); // closed: nothing listens there now
  const down = await captureLogs(send);
  assert.ok(down.result instanceof Error && /unreachable/.test(down.result.message));
  assert.equal(down.lines.length, 3, "three attempts");
  console.log("ok (g) a bounce fails at once; an unreachable API is tried three times");
}

console.log("mail tests passed");
process.exit(0);
