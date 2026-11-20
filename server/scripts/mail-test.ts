// Tests for email delivery retries (src/mail.ts): node scripts/mail-test.ts
// A fake SMTP server on a loopback port plays each case: a server that never greets, one that
// hangs on the first connection only, and one that refuses the recipient.

import assert from "node:assert/strict";
import { createServer, type Server, type Socket } from "node:net";
import { config } from "../src/config.ts";
import { sendMail, setMailTimingForTests } from "../src/mail.ts";

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

console.log("mail tests passed");
process.exit(0);
