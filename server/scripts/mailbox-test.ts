// Tests for the admin Mail tab's server side (src/mailbox.ts, src/mime.ts): node scripts/mailbox-test.ts
// Real servers on loopback ports with their own data folders: one with the inbound secret set,
// one without (receiving off). Cloudflare's send API is a fake in this process, which the servers
// reach through MAIL_API_BASE (honoured outside production only). Messages are built here as MIME
// and posted to /api/mail/inbound the way the Worker posts them.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MailSettings, MailSent, MailThread, MailThreadFull, MailThreadPage } from "../../web/src/platform/protocol.ts";

const ROOT = join(import.meta.dirname, "..");
const SECRET = "test-inbound-secret";
const ADMIN = "admin@example.com";
const BOB = "bob@example.com";
const MB = 1024 * 1024;
const CRLF = "\r\n";
const PORT = 21000 + Math.floor(Math.random() * 500);

// ---- Cloudflare's send API, faked ----------------------------------------------------------------

type Answer = [number, unknown];
interface ApiCall {
  path: string;
  auth: string | undefined;
  body: Record<string, unknown>;
}
const apiCalls: ApiCall[] = [];
const sentOk = (n: number): Answer => [200, { success: true, errors: [], result: { message_id: `<sent-${n}@rodeo.test>`, permanent_bounces: [], suppressed_recipients: [] } }];
let answer: (n: number) => Answer = sentOk;

const api: Server = createHttpServer(async (req: IncomingMessage, res) => {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  apiCalls.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw) as Record<string, unknown> });
  const [status, json] = answer(apiCalls.length);
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(json));
});
await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
const apiPort = (api.address() as { port: number }).port;

// ---- the servers ---------------------------------------------------------------------------------

interface Running {
  base: string;
  data: string;
  log(): string;
  stop(): void;
}
const started: Running[] = [];

async function until(check: () => boolean, what: string, log: () => string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${log()}`);
}

async function start(port: number, extra: Record<string, string>): Promise<Running> {
  const data = mkdtempSync(join(tmpdir(), "rodeo-mailbox-"));
  const base = `http://localhost:${port}`;
  let log = "";
  const proc: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DATA_DIR: data,
      PUBLIC_URL: base,
      ADMIN_EMAILS: ADMIN,
      MAIL_FROM: "Rodeo <noreply@rodeo.test>",
      MAIL_DOMAINS: "rodeo.test",
      MAIL_API_BASE: `http://127.0.0.1:${apiPort}/client/v4`,
      CLOUDFLARE_ACCOUNT_ID: "acc123",
      CLOUDFLARE_EMAIL_TOKEN: "tok-test",
      SMTP_URL: "",
      OPENROUTER_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      AI_API_KEY: "",
      MAIL_INBOUND_SECRET: SECRET,
      ...extra,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d: Buffer) => (log += d.toString()));
  proc.stderr?.on("data", (d: Buffer) => (log += d.toString()));
  const handle: Running = { base, data, log: () => log, stop: () => void proc.kill() };
  started.push(handle);
  await until(() => log.includes("listening"), "the server", () => log);
  return handle;
}

/**
 * Signs `email` in through an email link; resolves with the session cookie. The link is read from the
 * server's log (no Cloudflare account) or from the email the fake send API was given (the main server).
 */
async function signIn(srv: Running, email: string): Promise<string> {
  const logBefore = srv.log().length;
  const apiBefore = apiCalls.length;
  const res = await fetch(`${srv.base}/api/auth/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
    body: JSON.stringify({ email }),
  });
  assert.equal(res.status, 200);
  let link = "";
  await until(
    () => {
      const fromLog = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(srv.log().slice(logBefore));
      if (fromLog) link = fromLog[1]!;
      for (const c of apiCalls.slice(apiBefore)) {
        const found = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(String(c.body.text ?? ""));
        if (found && [c.body.to].flat().includes(email)) link = found[1]!;
      }
      return link !== "";
    },
    `${email}'s sign-in link`,
    srv.log,
  );
  const back = await fetch(`${srv.base}${link}`, { redirect: "manual" });
  assert.equal(back.status, 302);
  return (back.headers.get("set-cookie") ?? "").split(";")[0]!;
}

// ---- requests ------------------------------------------------------------------------------------

function call(srv: Running, cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${srv.base}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "X-Requested-With": "openvwx",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    redirect: "manual",
  });
}

/** The answer's JSON, after checking its status. */
async function read<T>(res: Response, status = 200): Promise<T> {
  const text = await res.text();
  assert.equal(res.status, status, `answered ${res.status}, expected ${status}: ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

function inbound(srv: Running, raw: string | Buffer, o: { to?: string; from?: string; secret?: string | null; requested?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "message/rfc822",
    "X-Envelope-From": o.from ?? "sender@example.org",
    "X-Envelope-To": o.to ?? "cal@rodeo.test",
  };
  if (o.requested !== false) headers["X-Requested-With"] = "openvwx";
  if (o.secret !== null) headers.Authorization = `Bearer ${o.secret ?? SECRET}`;
  return fetch(`${srv.base}/api/mail/inbound`, { method: "POST", body: raw, headers });
}

interface Received {
  id: string;
  threadId: string;
  duplicate: boolean;
}
const receive = async (raw: string, o?: { to?: string; from?: string }): Promise<Received> => read<Received>(await inbound(main, raw, o));

// ---- messages, built as MIME -----------------------------------------------------------------------

/** Header lines, a blank line, then the body with CRLF line ends. */
function mail(headers: [string, string][], body: string): string {
  return headers.map(([k, v]) => `${k}: ${v}`).join(CRLF) + CRLF + CRLF + body.replace(/\r?\n/g, CRLF);
}

function plain(from: string, subject: string, messageId: string, date: string, body: string, extra: [string, string][] = [], to = "Rae Example <cal@rodeo.test>"): string {
  return mail(
    [
      ["From", from],
      ["To", to],
      ["Subject", subject],
      ["Date", date],
      ["Message-ID", messageId],
      ["MIME-Version", "1.0"],
      ["Content-Type", "text/plain; charset=utf-8"],
      ...extra,
    ],
    body,
  );
}

const LOGO = Buffer.from("logo-bytes-for-the-test");
const PDF = Buffer.from("%PDF-1.4 plan bytes\n");

/** The plan: a mixed message with an alternative pair, an inline logo, a PDF and an HTML file. */
const planMail = mail(
  [
    ["From", "Alex Example <alex@example.com>"],
    ["To", "Rae Example <cal@rodeo.test>, Sam Example <sam@example.org>"],
    ["Cc", "Sales <sales@rodeo.test>"],
    ["Subject", "Plans for the loft"],
    ["Date", "Mon, 02 Nov 2026 10:00:00 +0000"],
    ["Message-ID", "<plan-1@example.com>"],
    ["MIME-Version", "1.0"],
    ["Content-Type", 'multipart/mixed; boundary="mix"'],
    ["Authentication-Results", "mx.cloudflare.net; spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com"],
  ],
  [
    "--mix",
    'Content-Type: multipart/related; boundary="rel"',
    "",
    "--rel",
    'Content-Type: multipart/alternative; boundary="alt"',
    "",
    "--alt",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello from the plan.",
    "--alt",
    "Content-Type: text/html; charset=utf-8",
    "",
    '<p>Hello <b>from</b> the plan.</p><img src="cid:logo@example.com" alt="logo">',
    "--alt--",
    "--rel",
    "Content-Type: image/png",
    "Content-Transfer-Encoding: base64",
    "Content-ID: <logo@example.com>",
    'Content-Disposition: inline; filename="logo.png"',
    "",
    LOGO.toString("base64"),
    "--rel--",
    "--mix",
    'Content-Type: application/pdf; name="plan.pdf"',
    'Content-Disposition: attachment; filename="plan.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    PDF.toString("base64"),
    "--mix",
    'Content-Type: text/html; name="notes.html"',
    'Content-Disposition: attachment; filename="notes.html"',
    "",
    "<p>Notes</p>",
    "--mix--",
    "",
  ].join("\n"),
);

const AUTH_PASS = "mx.cloudflare.net; spf=pass smtp.mailfrom=example.net; dkim=pass header.d=example.net; dmarc=pass";

// ---- the run -----------------------------------------------------------------------------------------

/** Every page of a view, with the first page's unread count. */
async function listAll(cookie: string, view: string): Promise<{ threads: MailThread[]; unreadInbox: number; pages: number }> {
  const threads: MailThread[] = [];
  let before: string | null = null;
  let unreadInbox = -1;
  let pages = 0;
  do {
    const q = new URLSearchParams({ view });
    if (before) q.set("before", before);
    const page = await read<MailThreadPage>(await call(main, cookie, "GET", `/api/admin/mail/threads?${q}`));
    if (unreadInbox < 0) unreadInbox = page.unreadInbox;
    threads.push(...page.threads);
    before = page.next;
    pages++;
  } while (before);
  return { threads, unreadInbox, pages };
}

let main: Running;
let noSecret: Running;
const data = (srv: Running): string => srv.data;

try {
  main = await start(PORT, {});
  noSecret = await start(PORT + 1, { MAIL_INBOUND_SECRET: "", CLOUDFLARE_ACCOUNT_ID: "", CLOUDFLARE_EMAIL_TOKEN: "" });
  const admin = await signIn(main, ADMIN);
  const bob = await signIn(main, BOB);
  assert.ok(admin && bob, "the sign-ins");

  // ---- inbound: refusals -----------------------------------------------------------------------
  assert.equal((await inbound(main, planMail, { secret: "wrong" })).status, 401, "a wrong secret is refused");
  assert.equal((await inbound(main, planMail, { secret: null })).status, 401, "no secret is refused");
  assert.equal((await inbound(main, planMail, { requested: false })).status, 403, "the CSRF header is needed");
  const noSecretInbound = await read<{ code: string }>(await inbound(noSecret, planMail), 503);
  assert.equal(noSecretInbound.code, "not_configured", "no MAIL_INBOUND_SECRET: receiving is off");
  const noSecretSettings = await read<MailSettings>(await call(noSecret, await signIn(noSecret, ADMIN), "GET", "/api/admin/mail/settings"));
  assert.equal(noSecretSettings.receiving, false);
  assert.equal(noSecretSettings.sending, false, "no Cloudflare account and no SMTP: sending is off");
  const huge = Buffer.alloc(30 * MB + 1, 97);
  const tooBig = await inbound(main, huge);
  assert.equal(tooBig.status, 413, "over 30 MB is refused");
  console.log("ok (a) inbound: 401 for a wrong or missing secret, 403 without the header, 503 with no secret, 413 over 30 MB");

  // ---- inbound: messages in, parsed and filed ---------------------------------------------------
  const r1 = await receive(planMail);
  assert.equal(r1.duplicate, false);
  const dup = await receive(planMail);
  assert.deepEqual(dup, { id: r1.id, threadId: r1.threadId, duplicate: true }, "the same Message-ID is stored once");
  const r2 = await receive(
    plain(
      "Alex Example <alex@example.com>",
      "Re: Plans for the loft",
      "<reply-1@example.com>",
      "Mon, 02 Nov 2026 11:00:00 +0000",
      "Thanks.\n\n> quoted line\n\nOn Mon, 2 Nov 2026 at 10:00, Alex wrote:\n> Hello from the plan.",
      [["In-Reply-To", "<plan-1@example.com>"], ["References", "<plan-1@example.com>"]],
    ),
  );
  const r3 = await receive(
    plain(
      "Sam Example <sam@example.org>",
      "Something else",
      "<ref-1@example.org>",
      "Mon, 02 Nov 2026 12:00:00 +0000",
      "Sam here.",
      [["References", "<x@example.org> <plan-1@example.com>"]],
    ),
  );
  const r4 = await receive(
    plain("Alex Example <alex@example.com>", "Fwd: RE:  plans FOR the loft ", "<subj-1@example.com>", "Mon, 02 Nov 2026 13:00:00 +0000", "Quick one.\n> old"),
  );
  const r5 = await receive(plain("Dana Example <dana@example.net>", "Plans for the loft", "<dana-1@example.net>", "Mon, 02 Nov 2026 14:00:00 +0000", "Different sender."));
  const r6 = await receive(
    plain("Prize <prize@example.net>", "You have won", "<prize-1@example.net>", "Mon, 02 Nov 2026 15:00:00 +0000", "Claim now.", [
      ["Authentication-Results", "mx.cloudflare.net; spf=pass; dkim=none; dmarc=fail"],
    ]),
  );
  const r7 = await receive(
    plain("Billing <billing@example.net>", "Invoice overdue", "<invoice-1@example.net>", "Mon, 02 Nov 2026 15:30:00 +0000", "Pay now.", [
      ["Authentication-Results", "mx.cloudflare.net; spf=fail smtp.mailfrom=example.net; dkim=none; dmarc=none"],
    ]),
  );
  const r8 = await receive(
    plain("Friend Example <friend@example.org>", "Lunch?", "<lunch-1@example.org>", "Mon, 02 Nov 2026 16:00:00 +0000", "Tuesday?", [
      ["Authentication-Results", "mx.cloudflare.net; spf=fail; dkim=pass; dmarc=none"],
    ]),
  );
  const r9 = await receive(plain("Future <future@example.org>", "Time travel", "<future-1@example.org>", "Fri, 01 Jan 2100 00:00:00 +0000", "Hello from later."));
  const r10 = await receive(
    mail(
      [
        ["From", "Clara Example <clara@example.org>"],
        ["To", "Rae Example <cal@rodeo.test>"],
        ["Subject", "Html only"],
        ["Date", "Mon, 02 Nov 2026 17:00:00 +0000"],
        ["Message-ID", "<html-1@example.org>"],
        ["MIME-Version", "1.0"],
        ["Content-Type", "text/html; charset=utf-8"],
      ],
      "<html><body><p>Hi&nbsp;there &amp; welcome</p><script>x()</script><p>Second</p></body></html>",
    ),
  );
  const planId = r1.threadId;
  assert.equal(r2.threadId, planId, "In-Reply-To joins the thread");
  assert.equal(r3.threadId, planId, "References alone joins the thread");
  assert.equal(r4.threadId, planId, "the same subject from the same sender joins it, with Fwd:/RE: taken off");
  assert.notEqual(r5.threadId, planId, "the same subject from another sender is a new thread");
  assert.equal(new Set([r6.threadId, r7.threadId]).size, 2);
  const danaId = r5.threadId;
  const spamIds = [r6.threadId, r7.threadId];
  assert.ok(r9.id && r10.id);
  console.log("ok (b) messages threaded by In-Reply-To, References and normalised subject; a duplicate Message-ID stores nothing");

  // ---- the lists ---------------------------------------------------------------------------------
  const inbox = await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"));
  assert.deepEqual(
    inbox.threads.map((t) => t.id),
    [r9.threadId, r10.threadId, r8.threadId, danaId, planId],
    "the inbox, newest first; the spam is not in it",
  );
  assert.equal(inbox.unreadInbox, 5, "five conversations in the inbox are unread");
  const plan = inbox.threads.find((t) => t.id === planId)!;
  assert.equal(plan.count, 4);
  assert.equal(plan.unread, 4);
  assert.equal(plan.snippet, "Quick one.", "the newest message's snippet, quoted lines dropped");
  assert.deepEqual(plan.participants, [
    { name: "Alex Example", address: "alex@example.com" },
    { name: "Sam Example", address: "sam@example.org" },
  ], "our own addresses are left out of the people");
  assert.equal(plan.attachments, true);
  assert.equal(plan.lastAt, "2026-11-02T13:00:00.000Z");
  const future = inbox.threads.find((t) => t.id === r9.threadId)!;
  assert.ok(Math.abs(Date.parse(future.lastAt) - Date.now()) < 60_000, "a Date a day ahead of arrival is replaced by the arrival time");
  const html = inbox.threads.find((t) => t.id === r10.threadId)!;
  assert.equal(html.snippet, "Hi there & welcome Second");

  const spam = await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=spam"));
  assert.deepEqual(spam.threads.map((t) => t.id).sort(), [...spamIds].sort(), "DMARC fail and SPF fail without DKIM pass go to spam");
  assert.equal(
    (await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=spam&q=prize"))).threads.length,
    1,
    "search finds the spam by sender",
  );
  assert.equal((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox&q=quick"))).threads[0]?.id, planId, "search over the text");
  assert.deepEqual(
    (await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox&q=plans"))).threads.map((t) => t.id),
    [danaId, planId],
    "search over subjects",
  );
  assert.equal((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox&q=%25"))).threads.length, 0, "% is searched as text");
  assert.equal((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox&q=_"))).threads.length, 0, "_ is searched as text");
  assert.equal((await call(main, admin, "GET", `/api/admin/mail/threads?view=inbox&q=${"x".repeat(201)}`)).status, 400, "a search of 200 characters at most");
  assert.equal((await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox&before=not-a-cursor!")).status, 400, "a bad page cursor");
  assert.equal((await call(main, admin, "GET", "/api/admin/mail/threads?view=nope")).status, 400, "a view that does not exist");
  console.log("ok (c) lists: folders, newest first, the people, snippet, unread count, search with LIKE escaped, spam");

  // ---- reading -----------------------------------------------------------------------------------
  const full = await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${planId}`));
  assert.deepEqual(
    full.messages.map((m) => m.subject),
    ["Plans for the loft", "Re: Plans for the loft", "Something else", "Fwd: RE:  plans FOR the loft"],
    "the messages, oldest first",
  );
  const first = full.messages[0]!;
  assert.equal(first.text, "Hello from the plan.");
  assert.ok(first.html?.includes(`data:image/png;base64,${LOGO.toString("base64")}`), "the cid: image is a data: URL");
  assert.ok(!first.html?.includes("cid:"), "no cid: left in the HTML");
  assert.deepEqual(first.auth, { spf: "pass", dkim: "pass", dmarc: "pass" });
  assert.equal(first.date, "2026-11-02T10:00:00.000Z");
  assert.equal(first.deliveredTo, "cal@rodeo.test");
  assert.deepEqual(first.to, [
    { name: "Rae Example", address: "cal@rodeo.test" },
    { name: "Sam Example", address: "sam@example.org" },
  ]);
  assert.deepEqual(first.cc, [{ name: "Sales", address: "sales@rodeo.test" }]);
  assert.deepEqual(
    first.attachments.map((a) => [a.filename, a.mime, a.inline]).sort(),
    [
      ["logo.png", "image/png", true],
      ["notes.html", "text/html", false],
      ["plan.pdf", "application/pdf", false],
    ],
  );
  assert.equal(full.thread.unread, 0, "reading marks it read");
  assert.ok(full.messages.some((m) => m.unread), "the answer still says which messages were unread when it was opened");
  const reread = await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${full.thread.id}`));
  assert.ok(reread.messages.every((m) => !m.unread), "read again, every message is read");
  assert.equal(full.messages[2]!.html, null, "a plain message has no HTML");
  const html10 = await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${r10.threadId}`));
  assert.equal(html10.messages[0]!.text, "Hi there & welcome\nSecond", "HTML only: the text is made from it");
  assert.equal(html10.messages[0]!.auth, null, "no Cloudflare results: no auth");
  assert.equal((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"))).unreadInbox, 3, "the two read ones are no longer counted: three left");
  console.log("ok (d) reading: messages oldest first, cid: images inline, auth and dates parsed, reading marks read");

  // ---- attachments and the raw message ------------------------------------------------------------
  const pdf = first.attachments.find((a) => a.filename === "plan.pdf")!;
  const pdfRes = await call(main, admin, "GET", `/api/admin/mail/attachments/${pdf.id}`);
  assert.equal(pdfRes.status, 200);
  assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
  assert.equal(pdfRes.headers.get("content-disposition"), "attachment; filename*=UTF-8''plan.pdf");
  assert.equal(pdfRes.headers.get("x-content-type-options"), "nosniff");
  assert.equal(pdfRes.headers.get("content-security-policy"), "sandbox");
  assert.ok(Buffer.from(await pdfRes.arrayBuffer()).equals(PDF), "the file comes back as it was sent");
  const notes = first.attachments.find((a) => a.filename === "notes.html")!;
  const notesRes = await call(main, admin, "GET", `/api/admin/mail/attachments/${notes.id}`);
  assert.equal(notesRes.headers.get("content-type"), "application/octet-stream", "HTML is sent as a file to save");
  assert.equal((await call(main, admin, "GET", "/api/admin/mail/attachments/nope")).status, 404);
  const raw = await call(main, admin, "GET", `/api/admin/mail/messages/${first.id}/raw`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("content-type"), "message/rfc822");
  assert.ok((await raw.text()).includes("Subject: Plans for the loft"), "the .eml as received");
  console.log("ok (e) attachments download as files with nosniff and a sandbox; the raw .eml comes back");

  // ---- PATCH: star, file, unread --------------------------------------------------------------------
  const starred = await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { starred: true }));
  assert.equal(starred.thread.starred, true);
  assert.deepEqual(
    (await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=starred"))).threads.map((t) => t.id),
    [planId],
  );
  const archived = await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { folder: "archive" }));
  assert.equal(archived.thread.folder, "archive");
  assert.ok(!(await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"))).threads.some((t) => t.id === planId));
  // a new message on an archived conversation brings it back to the inbox
  const again = await receive(
    plain("Alex Example <alex@example.com>", "Re: Plans for the loft", "<reply-2@example.com>", "Mon, 02 Nov 2026 18:00:00 +0000", "Again.", [
      ["In-Reply-To", "<reply-1@example.com>"],
    ]),
  );
  assert.equal(again.threadId, planId);
  assert.ok((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"))).threads.some((t) => t.id === planId), "back in the inbox");
  const unread = await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { unread: true }));
  assert.equal(unread.thread.unread, 1, "unread: true marks the newest message that came in");
  assert.equal(unread.thread.count, 5);
  await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${planId}`));
  assert.equal((await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { unread: false }))).thread.unread, 0);
  assert.equal((await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { folder: "nope" })).status, 400);
  assert.equal((await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { unread: "yes" })).status, 400);
  assert.equal((await call(main, admin, "PATCH", "/api/admin/mail/threads/missing", { starred: true })).status, 404);
  console.log("ok (f) PATCH: star, file to archive (a new message brings it back), unread true and false, bad values refused");

  // ---- settings ------------------------------------------------------------------------------------
  const defaults = await read<MailSettings>(await call(main, admin, "GET", "/api/admin/mail/settings"));
  assert.deepEqual(defaults, {
    aliases: [{ name: "Rodeo", address: "noreply@rodeo.test" }],
    signature: "",
    domains: ["rodeo.test"],
    receiving: true,
    sending: true,
  }, "by default, the address MAIL_FROM names");
  const badSettings: unknown[] = [
    { aliases: "x", signature: "" },
    { aliases: [{ name: "Out", address: "out@example.net" }], signature: "" },
    { aliases: [{ name: "Angle <x>", address: "cal@rodeo.test" }], signature: "" },
    { aliases: [{ name: "Quote \"x\"", address: "cal@rodeo.test" }], signature: "" },
    { aliases: Array.from({ length: 21 }, (_, i) => ({ name: "", address: `a${i}@rodeo.test` })), signature: "" },
    { aliases: [{ name: "", address: "cal@rodeo.test" }, { name: "", address: "cal@rodeo.test" }], signature: "" },
    { aliases: [], signature: "x".repeat(2001) },
  ];
  for (const body of badSettings) {
    assert.equal((await call(main, admin, "PUT", "/api/admin/mail/settings", body)).status, 400, JSON.stringify(body).slice(0, 80));
  }
  const saved = await read<MailSettings>(
    await call(main, admin, "PUT", "/api/admin/mail/settings", {
      aliases: [
        { name: "Rae Example", address: "cal@rodeo.test" },
        { name: "Sales", address: "sales@rodeo.test" },
      ],
      signature: "Rae\nRodeo",
    }),
  );
  assert.deepEqual(saved.aliases.map((a) => a.address), ["cal@rodeo.test", "sales@rodeo.test"]);
  assert.equal(saved.signature, "Rae\nRodeo");
  assert.deepEqual(await read<MailSettings>(await call(main, admin, "GET", "/api/admin/mail/settings")), saved);
  console.log("ok (g) settings: defaults from MAIL_FROM, saved, validated (9 refusals)");

  // ---- sending -------------------------------------------------------------------------------------
  const sendOne = (cookie: string, body: unknown, headers?: Record<string, string>) => call(main, cookie, "POST", "/api/admin/mail/send", body, headers);
  const fresh = await sendOne(admin, {
    from: "cal@rodeo.test",
    to: ["reader@example.com"],
    cc: ["copy@example.com"],
    subject: "Hello there",
    text: "Body text",
  });
  const sentNew = await read<MailSent>(fresh);
  const newCall = apiCalls[apiCalls.length - 1]!;
  assert.equal(newCall.path, "/client/v4/accounts/acc123/email/sending/send");
  assert.equal(newCall.auth, "Bearer tok-test");
  assert.deepEqual(newCall.body, {
    from: '"Rae Example" <cal@rodeo.test>',
    to: ["reader@example.com"],
    cc: ["copy@example.com"],
    subject: "Hello there",
    text: "Body text",
  }, "the name from the alias, the text as written (the Mail tab puts the signature in it), no headers for a new message");
  const newThread = await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${sentNew.threadId}`));
  assert.equal(newThread.messages.length, 1);
  assert.equal(newThread.messages[0]!.direction, "out");
  assert.equal(newThread.messages[0]!.messageId, `<sent-${apiCalls.length}@rodeo.test>`, "the Message-ID Cloudflare gave");
  assert.deepEqual(newThread.thread.participants, [
    { name: "", address: "reader@example.com" },
    { name: "", address: "copy@example.com" },
  ]);

  // a reply to the message that had a References chain: the chain plus its Message-ID
  const replyOne = await read<MailSent>(
    await sendOne(admin, { from: "cal@rodeo.test", to: ["sam@example.org"], subject: "Re: Something else", text: "Sam, yes.", inReplyTo: r3.id }),
  );
  assert.equal(replyOne.threadId, planId, "the reply is filed in its conversation");
  let replyCall = apiCalls[apiCalls.length - 1]!;
  assert.deepEqual(replyCall.body.headers, {
    "In-Reply-To": "<ref-1@example.org>",
    References: "<x@example.org> <plan-1@example.com> <ref-1@example.org>",
  });
  // a reply to a message that had no References: its Message-ID alone, with the sender's name from the other alias
  const replyTwo = await read<MailSent>(
    await sendOne(admin, { from: "sales@rodeo.test", fromName: "Sales Team", to: ["alex@example.com"], subject: "Re: plans", text: "Sent.", inReplyTo: r4.id }),
  );
  assert.equal(replyTwo.threadId, planId);
  replyCall = apiCalls[apiCalls.length - 1]!;
  assert.equal(replyCall.body.from, '"Sales Team" <sales@rodeo.test>');
  assert.deepEqual(replyCall.body.headers, { "In-Reply-To": "<subj-1@example.com>", References: "<subj-1@example.com>" });
  // a reply to a spam message brings its conversation to the inbox
  const unspam = await read<MailSent>(await sendOne(admin, { from: "cal@rodeo.test", to: ["prize@example.net"], subject: "Re: You have won", text: "No.", inReplyTo: r6.id }));
  assert.equal(unspam.threadId, r6.threadId);
  assert.ok((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"))).threads.some((t) => t.id === r6.threadId), "the spam conversation is in the inbox now");
  assert.ok(!(await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=spam"))).threads.some((t) => t.id === r6.threadId));
  const sentView = await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=sent"));
  assert.deepEqual(sentView.threads.map((t) => t.id).sort(), [sentNew.threadId, planId, r6.threadId].sort(), "the sent view: conversations with something sent");
  const replyText = await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${planId}`));
  assert.equal(replyText.messages.at(-1)!.text, "Sent.", "a reply is stored as written");
  assert.equal(replyText.messages.at(-1)!.direction, "out");
  assert.equal(replyText.messages.at(-1)!.attachments.length, 0);
  assert.equal((await call(main, admin, "GET", `/api/admin/mail/messages/${replyText.messages.at(-1)!.id}/raw`)).status, 404, "a sent message has no received .eml");
  console.log("ok (h) send: From and name, signature, recipients, headers on replies (References kept), spam replies move to the inbox, the sent view");

  // ---- send failures and refusals ---------------------------------------------------------------------
  const before502 = (await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=sent"))).threads.length;
  const callsBefore = apiCalls.length;
  answer = () => [400, { success: false, errors: [{ code: 10001, message: "email.sending.error.invalid_request_schema" }] }];
  const failed = await sendOne(admin, { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "Will fail", text: "x" });
  answer = sentOk;
  const failedBody = await read<{ code: string; error: string }>(failed, 422);
  assert.equal(failedBody.code, "send_failed");
  assert.match(failedBody.error, /answered 400/);
  assert.equal(apiCalls.length, callsBefore + 1, "one request, no retry for a refusal");
  assert.equal((await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=sent"))).threads.length, before502, "nothing stored");
  const refusals: [string, unknown][] = [
    ["a sender off the domains", { from: "cal@other.test", to: ["reader@example.com"], subject: "x", text: "x" }],
    ["no recipients", { from: "cal@rodeo.test", to: [], subject: "x", text: "x" }],
    ["51 recipients", { from: "cal@rodeo.test", to: Array.from({ length: 51 }, (_, i) => `r${i}@example.com`), subject: "x", text: "x" }],
    ["a bad recipient", { from: "cal@rodeo.test", to: ["nope"], subject: "x", text: "x" }],
    ["a line break in the subject", { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "a\r\nBcc: x@example.com", text: "x" }],
    ["an empty subject", { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "  ", text: "x" }],
    ["text over 1 MB", { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "x", text: "a".repeat(MB + 1) }],
    ["a reply to no message", { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "x", text: "x", inReplyTo: "missing" }],
    ["a name with quotes", { from: "cal@rodeo.test", fromName: 'Rae "R"', to: ["reader@example.com"], subject: "x", text: "x" }],
  ];
  const callsNow = apiCalls.length;
  for (const [what, body] of refusals) {
    assert.equal((await sendOne(admin, body)).status, 400, `${what} is refused`);
  }
  assert.equal(apiCalls.length, callsNow, "refused before anything is sent");
  console.log(`ok (i) a send Cloudflare refuses is 422 with nothing stored; ${refusals.length} bad sends refused before any send`);

  // ---- receiving and sending are the admin's ----------------------------------------------------------
  const log = await read<{ entries: { action: string; target: string | null; detail: string | null }[] }>(await call(main, admin, "GET", "/api/admin/log"));
  const sendLog = log.entries.find((e) => e.action === "mail.send" && e.target?.includes("reader@example.com"));
  assert.equal(sendLog?.detail, "Hello there", "the send is logged with its subject");
  assert.ok(!JSON.stringify(log.entries).includes("Body text"), "the log has no message body");

  // ---- admin only -------------------------------------------------------------------------------------
  assert.equal((await call(main, "", "GET", "/api/admin/mail/threads")).status, 401, "signed out: 401");
  const adminOnly: [string, string, unknown?][] = [
    ["GET", "/api/admin/mail/threads?view=inbox"],
    ["GET", `/api/admin/mail/threads/${planId}`],
    ["PATCH", `/api/admin/mail/threads/${planId}`, { starred: true }],
    ["DELETE", `/api/admin/mail/threads/${planId}`],
    ["POST", "/api/admin/mail/send", { from: "cal@rodeo.test", to: ["reader@example.com"], subject: "x", text: "x" }],
    ["GET", "/api/admin/mail/settings"],
    ["PUT", "/api/admin/mail/settings", { aliases: [], signature: "" }],
    ["GET", `/api/admin/mail/attachments/${pdf.id}`],
    ["GET", `/api/admin/mail/messages/${first.id}/raw`],
  ];
  for (const [method, path, body] of adminOnly) {
    assert.equal((await call(main, bob, method, path, body)).status, 403, `${method} ${path} is admin only`);
  }
  assert.equal((await call(main, admin, "POST", "/api/admin/mail/send", { from: "cal@rodeo.test", to: ["x@example.com"], subject: "x", text: "x" }, { "X-Requested-With": "" })).status, 403, "the CSRF header on a send");
  console.log("ok (j) every admin route answers 403 to a signed-in non-admin; 401 signed out; CSRF header needed");

  // ---- deleting ----------------------------------------------------------------------------------------
  assert.equal((await call(main, admin, "DELETE", `/api/admin/mail/threads/${danaId}`)).status, 409, "only a conversation in the trash can be deleted");
  const danaMessage = (await read<MailThreadFull>(await call(main, admin, "GET", `/api/admin/mail/threads/${danaId}`))).messages[0]!;
  const danaRaw = join(data(main), "mail", "raw", `${danaMessage.id}.eml`);
  assert.ok(existsSync(danaRaw), "the raw message is on disk");
  await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${danaId}`, { folder: "trash" }));
  const gone = await call(main, admin, "DELETE", `/api/admin/mail/threads/${danaId}`);
  assert.equal(gone.status, 204);
  assert.equal((await call(main, admin, "GET", `/api/admin/mail/threads/${danaId}`)).status, 404);
  assert.ok(!existsSync(danaRaw), "its file is gone");
  const deleteLog = (await read<{ entries: { action: string; target: string | null; detail: string | null }[] }>(await call(main, admin, "GET", "/api/admin/log"))).entries.find((e) => e.action === "mail.delete");
  assert.equal(deleteLog?.target, "Plans for the loft", "the permanent delete is logged");

  // the plan: to the trash, then gone with its attachments and their files
  await read<{ thread: MailThread }>(await call(main, admin, "PATCH", `/api/admin/mail/threads/${planId}`, { folder: "trash" }));
  assert.ok(!(await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=sent"))).threads.some((t) => t.id === planId), "a trashed conversation is out of sent");
  const pdfFile = join(data(main), "mail", "attachments", pdf.id);
  assert.ok(existsSync(pdfFile));
  assert.equal((await call(main, admin, "DELETE", `/api/admin/mail/threads/${planId}`)).status, 204);
  assert.ok(!existsSync(pdfFile), "the attachment's file is gone");
  assert.equal((await call(main, admin, "GET", `/api/admin/mail/attachments/${pdf.id}`)).status, 404);
  console.log("ok (k) DELETE: 409 outside the trash, 204 from it, rows and files gone, logged");

  // ---- paging ------------------------------------------------------------------------------------------
  const beforePaging = await listAll(admin, "inbox");
  const N0 = beforePaging.threads.length;
  for (let i = 0; i < 60; i++) {
    await receive(plain(`Sender ${i} <s${i}@example.org>`, `Bulk ${i}`, `<bulk-${i}@example.org>`, `Mon, 02 Nov 2026 19:${String(i).padStart(2, "0")}:00 +0000`, `Bulk body ${i}`));
  }
  const page1 = await read<MailThreadPage>(await call(main, admin, "GET", "/api/admin/mail/threads?view=inbox"));
  assert.equal(page1.threads.length, 50, "50 per page");
  assert.ok(page1.next, "a next page");
  const all = await listAll(admin, "inbox");
  assert.equal(all.threads.length, N0 + 60, "every conversation, once, across the pages");
  assert.equal(new Set(all.threads.map((t) => t.id)).size, N0 + 60, "no conversation twice");
  assert.ok(all.pages >= 2);
  const unreadNow = all.threads.filter((t) => t.unread > 0).length;
  assert.equal(all.unreadInbox, unreadNow, "the badge counts the unread conversations in the inbox");
  console.log(`ok (l) paging: ${all.pages} pages (50 to a page), ${N0 + 60} conversations, each once`);

  console.log("mailbox tests passed");
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  for (const s of started) s.stop();
  api.close();
  for (const s of started) rmSync(s.data, { recursive: true, force: true });
}
process.exit(process.exitCode ?? 0);
