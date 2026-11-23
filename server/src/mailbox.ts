// The admin page's Mail tab: a small mailbox for the addresses at MAIL_DOMAINS. Cloudflare Email
// Routing hands each message that arrives to a Worker (mail-worker/), which posts the raw MIME to
// POST /api/mail/inbound (a bearer secret, MAIL_INBOUND_SECRET). The message is parsed (postal-mime),
// kept as DATA_DIR/mail/raw/<id>.eml with its attachments under DATA_DIR/mail/attachments, filed into
// a conversation (by its References, else its normalised subject from the same sender), and checked
// for spoofing (DMARC or SPF from Cloudflare's Authentication-Results). Admins read, file, star,
// search and delete conversations, and send or reply (POST /api/admin/mail/send, through mail.ts).
// Every route under /api/admin/mail needs an admin's account (admin.ts requireAdmin).

import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Context, Hono } from "hono";
import PostalMime, { type Address, type Email, type Mailbox } from "postal-mime";
import type {
  MailAlias,
  MailAttachment,
  MailFolder,
  MailMessage,
  MailSettings,
  MailThread,
  MailThreadFull,
  MailThreadPage,
  MailAuth,
  MailAddress,
} from "../../web/src/platform/protocol.ts";
import { requireAdmin } from "./admin.ts";
import { logAdmin } from "./adminLog.ts";
import { config } from "./config.ts";
import { all, get, run, tx, type Param } from "./db.ts";
import { sendMessage } from "./mail.ts";
import { authOf, htmlToText, messageIdOf, messageIdsIn, normalSubject, snippetOf } from "./mime.ts";
import { saveSetting, setting } from "./settings.ts";
import { readJson } from "./http.ts";
import { cleanBody, cleanLine, DAY, fail, fileStream, MB, newId, nowIso } from "./util.ts";

/** conversations per page */
const PAGE = 50;
/** what POST /api/mail/inbound takes: a message with its attachments */
const INBOUND_MAX = 30 * MB;
const MAX_RECIPIENTS = 50;
const MAX_TEXT = 1 * MB;
/** inline images up to this size are shown in the HTML as data: URLs */
const INLINE_MAX = 1 * MB;
const SUBJECT_MAX = 998;
/** a reply's References keep this many ids */
const KEEP_REFS = 20;
/** a message joins a conversation by its subject only within this long of the last one */
const SUBJECT_WINDOW = 30 * DAY;
const FOLDERS: readonly string[] = ["inbox", "archive", "spam", "trash"];
const VIEWS: readonly string[] = [...FOLDERS, "sent", "starred"];
const ADDRESS = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+$/;
const NAME_BAD = /[\r\n<>"]/;

interface ThreadRow {
  id: string;
  subject: string;
  last_at: string;
  folder: string;
  starred: number;
  created_at: string;
}

interface MessageRow {
  id: string;
  thread_id: string;
  direction: string;
  message_id: string | null;
  in_reply_to: string | null;
  refs: string;
  from_addr: string;
  from_name: string;
  to_json: string;
  cc_json: string;
  reply_to_json: string | null;
  delivered_to: string | null;
  subject: string;
  date: string;
  text: string;
  html: string | null;
  snippet: string;
  size: number;
  auth_json: string | null;
  raw_path: string | null;
  unread: number;
  created_at: string;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  filename: string;
  mime: string;
  size: number;
  content_id: string | null;
  inline: number;
  path: string;
}

interface Person {
  name: string;
  address: string;
}

/** The settings kept under "mail" (the defaults when nothing is saved). */
interface StoredSettings {
  aliases: MailAlias[];
  signature: string;
}

// ---- addresses, names and small helpers ----------------------------------------------------------

/** A lower-case address, or null when the text is not one. */
function cleanAddress(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const a = v.trim().toLowerCase();
  return a.length <= 254 && ADDRESS.test(a) ? a : null;
}

/** Whether an address is at one of MAIL_DOMAINS (ours: left out of participants, sendable from). */
function isOurs(address: string): boolean {
  const at = address.lastIndexOf("@");
  return at >= 0 && config.mailDomains.includes(address.slice(at + 1).toLowerCase());
}

function domainOf(address: string): string {
  return address.slice(address.lastIndexOf("@") + 1);
}

/** A display name for an alias or a send: up to 100 characters, no line breaks, < > or quotes. */
function nameOk(name: string): boolean {
  return Array.from(name).length <= 100 && !NAME_BAD.test(name);
}

/** The "Name <address>" pair, or the address alone for a parse. */
function parseFrom(v: string): MailAlias | null {
  const m = /^\s*"?([^"<>]*?)"?\s*<([^<>]+)>\s*$/.exec(v);
  const address = cleanAddress(m ? m[2] : v);
  if (!address) return null;
  return { name: m ? m[1]!.trim() : "", address };
}

/** RFC 5987 encoding for a file name in Content-Disposition. */
function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The people in a parsed address list (groups unwrapped), addresses lower-cased. */
function people(list: readonly Address[] | undefined): Person[] {
  const out: Person[] = [];
  for (const a of list ?? []) {
    const boxes: readonly (Mailbox | Address)[] = a.group ? a.group : [a];
    for (const b of boxes) {
      if (b.address) out.push({ name: b.name ?? "", address: b.address.toLowerCase() });
    }
  }
  return out;
}

function parsePeople(json: string): Person[] {
  return JSON.parse(json) as Person[];
}

/** The MIME types a download keeps as they are; anything else is sent as a file to save. */
function downloadType(mime: string): string {
  if (/^image\/(?!svg\+xml)[a-z0-9.+-]+$/.test(mime) || mime === "application/pdf" || mime === "text/plain" || mime === "application/octet-stream") return mime;
  return "application/octet-stream";
}

/** A file name kept for display and download: no folders, no control characters. */
function fileNameOf(v: string | null | undefined): string {
  const name = cleanLine(v ?? "", 200).replace(/[\\/]+/g, "-");
  return name || "attachment";
}

/** Two digests of equal length compared in constant time (the secret is never compared directly). */
function sameSecret(given: string, secret: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

/** A request body of at most `max` bytes, read as it arrives (a Content-Length over the limit is refused unread). */
async function readBounded(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) fail(413, "The message is larger than 30 MB", "too_large");
  if (!req.body) fail(400, "Nothing was sent");
  const reader = req.body.getReader();
  const parts: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      fail(413, "The message is larger than 30 MB", "too_large");
    }
    parts.push(Buffer.from(value));
  }
  if (size === 0) fail(400, "Nothing was sent");
  return Buffer.concat(parts);
}

async function removeFiles(paths: readonly string[]): Promise<void> {
  for (const p of paths) await rm(join(config.dataDir, p), { force: true }).catch(() => undefined);
}

// ---- settings ------------------------------------------------------------------------------------

function storedSettings(): StoredSettings {
  const kept = setting<StoredSettings>("mail");
  if (kept) return kept;
  const fromEnv = parseFrom(config.mailFrom);
  return { aliases: fromEnv && isOurs(fromEnv.address) ? [fromEnv] : [], signature: "" };
}

function settingsOut(): MailSettings {
  const s = storedSettings();
  return {
    aliases: s.aliases,
    signature: s.signature,
    domains: config.mailDomains,
    receiving: config.mailInboundSecret !== null,
    sending: config.mailApi !== null || config.smtpUrl !== null,
  };
}

function aliasIn(v: unknown): MailAlias {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(400, "Each alias must be an object");
  const o = v as Record<string, unknown>;
  const address = cleanAddress(o.address);
  if (!address || !isOurs(address)) fail(400, "Aliases must be addresses at one of the mail domains");
  const name = o.name === undefined || o.name === null ? "" : o.name;
  if (typeof name !== "string" || !nameOk(name)) fail(400, "An alias name is at most 100 characters, with no line breaks, < > or quotes");
  return { name: name.trim(), address };
}

// ---- conversations out -----------------------------------------------------------------------------

/** The people in a conversation, newest first, without our own addresses: at most 4. */
function participantsOf(list: readonly MessageRow[]): MailAddress[] {
  const seen = new Map<string, MailAddress>();
  for (const m of list) {
    const all: Person[] = [{ name: m.from_name, address: m.from_addr }, ...parsePeople(m.to_json), ...parsePeople(m.cc_json)];
    for (const p of all) {
      if (!p.address || isOurs(p.address)) continue;
      const prev = seen.get(p.address);
      if (!prev) seen.set(p.address, { name: p.name, address: p.address });
      else if (!prev.name && p.name) seen.set(p.address, { name: p.name, address: p.address });
    }
  }
  return [...seen.values()].slice(0, 4);
}

/** The list rows for some conversations, with their counts, snippet and people worked out from their messages. */
function threadsOut(rows: readonly ThreadRow[]): MailThread[] {
  if (rows.length === 0) return [];
  const marks = rows.map(() => "?").join(",");
  const ids = rows.map((r) => r.id);
  const msgs = all<MessageRow>(
    `SELECT id, thread_id, direction, from_addr, from_name, to_json, cc_json, unread, date, snippet, created_at
     FROM mail_messages WHERE thread_id IN (${marks}) ORDER BY date DESC, created_at DESC`,
    ...ids,
  );
  const withFiles = new Set(
    all<{ thread_id: string }>(
      `SELECT DISTINCT m.thread_id AS thread_id FROM mail_attachments a JOIN mail_messages m ON m.id = a.message_id
       WHERE a.inline = 0 AND m.thread_id IN (${marks})`,
      ...ids,
    ).map((r) => r.thread_id),
  );
  const byThread = new Map<string, MessageRow[]>();
  for (const m of msgs) byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]);
  return rows.map((r) => {
    const list = byThread.get(r.id) ?? [];
    return {
      id: r.id,
      subject: r.subject,
      lastAt: r.last_at,
      folder: r.folder as MailFolder,
      unread: list.filter((m) => m.unread === 1).length,
      starred: r.starred === 1,
      count: list.length,
      snippet: list[0]?.snippet ?? "",
      participants: participantsOf(list),
      attachments: withFiles.has(r.id),
    };
  });
}

function threadOut(row: ThreadRow): MailThread {
  return threadsOut([row])[0]!;
}

/** The inline images (cid:) in a message's HTML as data: URLs, for images up to INLINE_MAX. */
async function inlineImages(html: string, atts: readonly AttachmentRow[]): Promise<string> {
  let out = html;
  for (const a of atts) {
    if (!a.inline || !a.content_id || a.size > INLINE_MAX) continue;
    if (!/^image\/(?!svg\+xml)[a-z0-9.+-]+$/.test(a.mime)) continue;
    const data = await readFile(join(config.dataDir, a.path)).catch(() => null);
    if (!data) continue;
    const url = `data:${a.mime};base64,${data.toString("base64")}`;
    for (const ref of new Set([a.content_id, encodeURIComponent(a.content_id)])) {
      const pattern = new RegExp(`cid:${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
      out = out.replace(pattern, () => url);
    }
  }
  return out;
}

async function messageOut(m: MessageRow, atts: readonly AttachmentRow[]): Promise<MailMessage> {
  const html = m.html === null ? null : await inlineImages(m.html, atts);
  return {
    id: m.id,
    direction: m.direction as "in" | "out",
    messageId: m.message_id,
    from: { name: m.from_name, address: m.from_addr },
    to: parsePeople(m.to_json),
    cc: parsePeople(m.cc_json),
    replyTo: m.reply_to_json ? (JSON.parse(m.reply_to_json) as Person) : null,
    deliveredTo: m.delivered_to,
    subject: m.subject,
    date: m.date,
    text: m.text,
    html,
    auth: m.auth_json ? (JSON.parse(m.auth_json) as MailAuth) : null,
    unread: m.unread === 1,
    attachments: atts.map(
      (a): MailAttachment => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, inline: a.inline === 1 }),
    ),
  };
}

function threadRow(id: string): ThreadRow {
  const row = get<ThreadRow>("SELECT * FROM mail_threads WHERE id = ?", id);
  if (!row) fail(404, "No such conversation", "not_found");
  return row;
}

/** The page cursor: an opaque string of the last conversation's time and id. */
function cursorOf(row: ThreadRow): string {
  return Buffer.from(JSON.stringify([row.last_at, row.id])).toString("base64url");
}

function readCursor(v: string): [string, string] {
  try {
    const parsed = JSON.parse(Buffer.from(v, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") return [parsed[0], parsed[1]];
  } catch {
    // fall through to the refusal
  }
  return fail(400, "before is not a page cursor");
}

// ---- inbound -----------------------------------------------------------------------------------------

/** Where the raw message and an attachment live, under DATA_DIR. */
const rawPathOf = (id: string): string => `mail/raw/${id}.eml`;
const attachmentPathOf = (id: string): string => `mail/attachments/${id}`;

/** A reference list kept as JSON, the last KEEP_REFS only. */
function refsJson(ids: readonly string[]): string {
  return JSON.stringify([...new Set(ids)].slice(-KEEP_REFS));
}

/** An attachment as postal-mime gave it, ready to keep. */
interface Kept {
  readonly id: string;
  readonly path: string;
  readonly filename: string;
  readonly mime: string;
  readonly size: number;
  readonly contentId: string | null;
  readonly inline: boolean;
  readonly bytes: Buffer;
}

export function registerMailbox(app: Hono): void {
  // ---- inbound: the Cloudflare Worker's post of a received message -------------------------------

  app.post("/api/mail/inbound", async (c: Context) => {
    const secret = config.mailInboundSecret;
    if (!secret) fail(503, "Receiving mail is not set up on this server (MAIL_INBOUND_SECRET)", "not_configured");
    const header = c.req.header("authorization") ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!sameSecret(given, secret)) fail(401, "The inbound secret is wrong", "auth");

    const raw = await readBounded(c.req.raw, INBOUND_MAX);
    let parsed: Email;
    try {
      parsed = await PostalMime.parse(new Uint8Array(raw));
    } catch {
      fail(400, "The message could not be read");
    }

    const messageId = messageIdOf(parsed.messageId);
    const duplicateOf = (): { id: string; thread_id: string } | undefined =>
      messageId ? get<{ id: string; thread_id: string }>("SELECT id, thread_id FROM mail_messages WHERE message_id = ?", messageId) : undefined;
    const earlier = duplicateOf();
    if (earlier) return c.json({ id: earlier.id, threadId: earlier.thread_id, duplicate: true });

    const arrived = nowIso();
    const sentAt = parsed.date ? Date.parse(parsed.date) : NaN;
    const date = Number.isFinite(sentAt) && sentAt <= Date.now() + DAY ? new Date(sentAt).toISOString() : arrived;
    const envelopeFrom = (c.req.header("x-envelope-from") ?? "").trim().toLowerCase();
    const envelopeTo = (c.req.header("x-envelope-to") ?? "").trim().toLowerCase() || null;
    const from: Person = people(parsed.from ? [parsed.from] : [])[0] ?? { name: "", address: envelopeFrom };
    const to = people(parsed.to);
    const cc = people(parsed.cc);
    const replyTo = people(parsed.replyTo)[0] ?? null;
    const subject = cleanLine(parsed.subject ?? "", SUBJECT_MAX);
    const html = parsed.html && parsed.html.trim() ? parsed.html : null;
    const text = parsed.text && parsed.text.trim() ? parsed.text : html ? htmlToText(html) : "";
    const auth = authOf(parsed.headers);
    const spam = auth !== null && (auth.dmarc === "fail" || (auth.spf === "fail" && auth.dkim !== "pass"));
    const inReplyTo = messageIdsIn(parsed.inReplyTo);
    const references = messageIdsIn(parsed.references);
    const refs = [...references, ...inReplyTo];
    const ours = isOurs(from.address);

    const id = newId();
    const kept: Kept[] = [];
    for (const a of parsed.attachments) {
      const attachmentId = newId();
      const content = a.content;
      const bytes =
        typeof content === "string"
          ? Buffer.from(content, a.encoding === "base64" ? "base64" : "utf8")
          : Buffer.from(content instanceof ArrayBuffer ? new Uint8Array(content) : content);
      const contentId = a.contentId ? a.contentId.trim().replace(/^<|>$/g, "") || null : null;
      kept.push({
        id: attachmentId,
        path: attachmentPathOf(attachmentId),
        filename: fileNameOf(a.filename),
        mime: (a.mimeType || "application/octet-stream").toLowerCase().slice(0, 100),
        size: bytes.length,
        contentId,
        inline: contentId !== null && a.disposition !== "attachment",
        bytes,
      });
    }
    const written: string[] = [rawPathOf(id), ...kept.map((k) => k.path)];
    try {
      await mkdir(join(config.dataDir, "mail", "raw"), { recursive: true });
      await mkdir(join(config.dataDir, "mail", "attachments"), { recursive: true });
      await writeFile(join(config.dataDir, rawPathOf(id)), raw);
      for (const k of kept) await writeFile(join(config.dataDir, k.path), k.bytes);

      const result = tx(() => {
        const again = duplicateOf();
        if (again) return { id: again.id, threadId: again.thread_id, duplicate: true };

        // the conversation: by References or In-Reply-To, else the same subject from the same sender
        let thread = refs.length
          ? get<ThreadRow>(
              `SELECT t.* FROM mail_messages m JOIN mail_threads t ON t.id = m.thread_id
               WHERE m.message_id IN (${refs.map(() => "?").join(",")}) ORDER BY m.date DESC LIMIT 1`,
              ...refs,
            )
          : undefined;
        const norm = normalSubject(subject);
        if (!thread && !ours && norm) {
          const since = new Date(Date.parse(date) - SUBJECT_WINDOW).toISOString();
          const candidates = all<ThreadRow>(
            `SELECT t.* FROM mail_threads t WHERE t.last_at >= ?
             AND EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = t.id AND m.from_addr = ?)
             ORDER BY t.last_at DESC LIMIT 200`,
            since,
            from.address,
          );
          thread = candidates.find((t) => normalSubject(t.subject) === norm);
        }

        let threadId: string;
        if (thread) {
          threadId = thread.id;
          run(
            "UPDATE mail_threads SET last_at = max(last_at, ?), folder = CASE WHEN folder IN ('archive', 'trash') THEN 'inbox' ELSE folder END WHERE id = ?",
            date,
            threadId,
          );
        } else {
          threadId = newId();
          run(
            "INSERT INTO mail_threads (id, subject, last_at, folder, starred, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            threadId,
            subject || "(no subject)",
            date,
            spam ? "spam" : "inbox",
            arrived,
          );
        }

        run(
          `INSERT INTO mail_messages (id, thread_id, direction, message_id, in_reply_to, refs, from_addr, from_name, to_json, cc_json,
             reply_to_json, delivered_to, subject, date, text, html, snippet, size, auth_json, raw_path, unread, created_at)
           VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          id,
          threadId,
          messageId,
          inReplyTo[0] ?? null,
          refsJson(refs),
          from.address,
          from.name,
          JSON.stringify(to),
          JSON.stringify(cc),
          replyTo ? JSON.stringify(replyTo) : null,
          envelopeTo,
          subject,
          date,
          text,
          html,
          snippetOf(text),
          raw.length,
          auth ? JSON.stringify(auth) : null,
          rawPathOf(id),
          arrived,
        );
        for (const k of kept) {
          run(
            "INSERT INTO mail_attachments (id, message_id, filename, mime, size, content_id, inline, path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            k.id,
            id,
            k.filename,
            k.mime,
            k.size,
            k.contentId,
            k.inline ? 1 : 0,
            k.path,
          );
        }
        return { id, threadId, duplicate: false };
      });
      if (result.duplicate) {
        await removeFiles(written);
      }
      return c.json(result);
    } catch (err) {
      await removeFiles(written);
      throw err;
    }
  });

  // ---- the admin's routes ------------------------------------------------------------------------

  app.get("/api/admin/mail/threads", (c: Context) => {
    requireAdmin(c);
    const view = c.req.query("view") ?? "inbox";
    if (!VIEWS.includes(view)) fail(400, "view must be inbox, archive, spam, trash, sent or starred");
    const q = (c.req.query("q") ?? "").trim();
    if (Array.from(q).length > 200) fail(400, "The search is longer than 200 characters");

    const conds: string[] = [];
    const params: Param[] = [];
    if (view === "sent") {
      conds.push("t.folder <> 'trash'", "EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = t.id AND m.direction = 'out')");
    } else if (view === "starred") {
      conds.push("t.starred = 1", "t.folder <> 'trash'");
    } else {
      conds.push("t.folder = ?");
      params.push(view);
    }
    if (q) {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      conds.push(
        `(t.subject LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = t.id AND (
           m.subject LIKE ? ESCAPE '\\' OR m.from_addr LIKE ? ESCAPE '\\' OR m.from_name LIKE ? ESCAPE '\\' OR m.to_json LIKE ? ESCAPE '\\'
           OR m.cc_json LIKE ? ESCAPE '\\' OR m.text LIKE ? ESCAPE '\\')))`,
      );
      params.push(like, like, like, like, like, like, like);
    }
    const before = c.req.query("before");
    if (before) {
      const [at, id] = readCursor(before);
      conds.push("(t.last_at < ? OR (t.last_at = ? AND t.id < ?))");
      params.push(at, at, id);
    }

    const rows = all<ThreadRow>(
      `SELECT t.id, t.subject, t.last_at, t.folder, t.starred, t.created_at FROM mail_threads t
       WHERE ${conds.join(" AND ")} ORDER BY t.last_at DESC, t.id DESC LIMIT ?`,
      ...params,
      PAGE + 1,
    );
    const more = rows.length > PAGE;
    const page = rows.slice(0, PAGE);
    const unreadInbox =
      get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM mail_threads t WHERE t.folder = 'inbox' AND EXISTS (SELECT 1 FROM mail_messages m WHERE m.thread_id = t.id AND m.unread = 1)",
      )?.n ?? 0;
    const body: MailThreadPage = {
      threads: threadsOut(page),
      next: more ? cursorOf(page[page.length - 1]!) : null,
      unreadInbox,
    };
    return c.json(body);
  });

  app.get("/api/admin/mail/threads/:id", async (c: Context) => {
    requireAdmin(c);
    const row = threadRow(idParam(c));
    const msgs = all<MessageRow>("SELECT * FROM mail_messages WHERE thread_id = ? ORDER BY date ASC, created_at ASC", row.id);
    const atts = all<AttachmentRow>(
      "SELECT a.* FROM mail_attachments a JOIN mail_messages m ON m.id = a.message_id WHERE m.thread_id = ? ORDER BY a.rowid",
      row.id,
    );
    const messages: MailMessage[] = [];
    for (const m of msgs) messages.push(await messageOut(m, atts.filter((a) => a.message_id === m.id)));
    // reading a conversation marks its messages read; the answer still says which were unread, so they open expanded
    run("UPDATE mail_messages SET unread = 0 WHERE thread_id = ? AND unread = 1", row.id);
    const body: MailThreadFull = { thread: threadOut(threadRow(row.id)), messages };
    return c.json(body);
  });

  app.patch("/api/admin/mail/threads/:id", async (c: Context) => {
    requireAdmin(c);
    const id = idParam(c);
    threadRow(id);
    const body = await readJsonObject(c);
    const { folder, unread, starred } = body;
    if (folder !== undefined && (typeof folder !== "string" || !FOLDERS.includes(folder))) fail(400, "folder must be inbox, archive, spam or trash");
    if (unread !== undefined && typeof unread !== "boolean") fail(400, "unread must be true or false");
    if (starred !== undefined && typeof starred !== "boolean") fail(400, "starred must be true or false");
    tx(() => {
      if (typeof folder === "string") run("UPDATE mail_threads SET folder = ? WHERE id = ?", folder, id);
      if (typeof starred === "boolean") run("UPDATE mail_threads SET starred = ? WHERE id = ?", starred ? 1 : 0, id);
      // unread: true marks the newest message that came in; false marks them all read
      if (unread === true) {
        run(
          `UPDATE mail_messages SET unread = 1 WHERE id = (SELECT id FROM mail_messages WHERE thread_id = ? AND direction = 'in'
             ORDER BY date DESC, created_at DESC LIMIT 1)`,
          id,
        );
      } else if (unread === false) {
        run("UPDATE mail_messages SET unread = 0 WHERE thread_id = ?", id);
      }
    });
    return c.json({ thread: threadOut(threadRow(id)) });
  });

  app.delete("/api/admin/mail/threads/:id", async (c: Context) => {
    const admin = requireAdmin(c);
    const row = threadRow(idParam(c));
    if (row.folder !== "trash") fail(409, "Only a conversation in the trash can be deleted", "not_in_trash");
    const files = [
      ...all<{ path: string }>("SELECT raw_path AS path FROM mail_messages WHERE thread_id = ? AND raw_path IS NOT NULL", row.id),
      ...all<{ path: string }>(
        "SELECT a.path AS path FROM mail_attachments a JOIN mail_messages m ON m.id = a.message_id WHERE m.thread_id = ?",
        row.id,
      ),
    ].map((f) => f.path);
    const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM mail_messages WHERE thread_id = ?", row.id)?.n ?? 0;
    run("DELETE FROM mail_threads WHERE id = ?", row.id);
    logAdmin(admin, "mail.delete", row.subject || "(no subject)", `${count} message${count === 1 ? "" : "s"}`);
    await removeFiles(files);
    return c.body(null, 204);
  });

  app.post("/api/admin/mail/send", async (c: Context) => {
    const admin = requireAdmin(c);
    const body = await readJsonObject(c, 8 * MB);
    const settings = storedSettings();

    const from = cleanAddress(body.from);
    if (!from || !isOurs(from)) fail(400, "Send from an address at one of the mail domains");
    const to = addressList(body.to, "to");
    const cc = body.cc === undefined || body.cc === null ? [] : addressList(body.cc, "cc");
    const recipients = [...new Set([...to, ...cc])];
    if (recipients.length === 0) fail(400, "Add at least one recipient");
    if (recipients.length > MAX_RECIPIENTS) fail(400, `A message can go to ${MAX_RECIPIENTS} recipients at most`);

    if (typeof body.subject !== "string" || /[\r\n]/.test(body.subject)) fail(400, "The subject must be one line");
    const subject = body.subject.trim();
    if (subject.length < 1 || Array.from(subject).length > SUBJECT_MAX) fail(400, `The subject is 1 to ${SUBJECT_MAX} characters`);
    if (typeof body.text !== "string" || Buffer.byteLength(body.text) > MAX_TEXT) fail(400, "The message text is at most 1 MB");

    const alias = settings.aliases.find((a) => a.address === from);
    let name = alias?.name ?? "";
    if (body.fromName !== undefined && body.fromName !== null && body.fromName !== "") {
      if (typeof body.fromName !== "string" || !nameOk(body.fromName)) fail(400, "The sender's name is at most 100 characters, with no line breaks, < > or quotes");
      name = body.fromName.trim();
    }

    let target: MessageRow | undefined;
    if (body.inReplyTo !== undefined && body.inReplyTo !== null && body.inReplyTo !== "") {
      if (typeof body.inReplyTo !== "string") fail(400, "inReplyTo must be a message id");
      target = get<MessageRow>("SELECT * FROM mail_messages WHERE id = ?", body.inReplyTo);
      if (!target) fail(400, "inReplyTo is not a message in the mailbox");
    }
    const headers: Record<string, string> = {};
    if (target) {
      const kept = parseRefs(target.refs);
      if (target.message_id) headers["In-Reply-To"] = target.message_id;
      const chain = [...kept, ...(target.message_id ? [target.message_id] : [])].slice(-KEEP_REFS);
      if (chain.length) headers.References = chain.join(" ");
    }

    // the signature is already in the text: the Mail tab puts it in the editable body
    const text = body.text.replace(/\s+$/, "");
    const fromHeader = name ? `"${name.replace(/\\/g, "\\\\")}" <${from}>` : from;
    let sentId: string | null;
    try {
      sentId = await sendMessage({
        from: fromHeader,
        to,
        ...(cc.length ? { cc } : {}),
        subject,
        text,
        ...(Object.keys(headers).length ? { headers } : {}),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : "The mail could not be sent";
      // 422, not 502: Cloudflare swaps an origin's 502 for its own page, and the Mail tab must read why
      return c.json({ code: "send_failed", error }, 422);
    }

    const now = nowIso();
    const id = newId();
    const messageId = messageIdOf(sentId) ?? `<${newId()}@${domainOf(from)}>`;
    const threadId = target ? target.thread_id : newId();
    const addressed = (list: string[]): string => JSON.stringify(list.map((address) => ({ name: "", address })));
    tx(() => {
      if (target) {
        run(
          "UPDATE mail_threads SET last_at = ?, folder = CASE WHEN folder IN ('trash', 'spam') THEN 'inbox' ELSE folder END WHERE id = ?",
          now,
          threadId,
        );
      } else {
        run(
          "INSERT INTO mail_threads (id, subject, last_at, folder, starred, created_at) VALUES (?, ?, ?, 'inbox', 0, ?)",
          threadId,
          subject,
          now,
          now,
        );
      }
      run(
        `INSERT INTO mail_messages (id, thread_id, direction, message_id, in_reply_to, refs, from_addr, from_name, to_json, cc_json,
           reply_to_json, delivered_to, subject, date, text, html, snippet, size, auth_json, raw_path, unread, created_at)
         VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, NULL, NULL, 0, ?)`,
        id,
        threadId,
        messageId,
        headers["In-Reply-To"] ?? null,
        refsJson(headers.References ? headers.References.split(" ") : []),
        from,
        name,
        addressed(to),
        addressed(cc),
        subject,
        now,
        text,
        snippetOf(text),
        Buffer.byteLength(text),
        now,
      );
    });
    logAdmin(admin, "mail.send", recipients.join(", "), subject);
    return c.json({ id, threadId });
  });

  app.get("/api/admin/mail/settings", (c: Context) => {
    requireAdmin(c);
    return c.json(settingsOut());
  });

  app.put("/api/admin/mail/settings", async (c: Context) => {
    requireAdmin(c);
    const body = await readJsonObject(c);
    if (!Array.isArray(body.aliases)) fail(400, "aliases must be a list");
    if (body.aliases.length > 20) fail(400, "There can be at most 20 aliases");
    const aliases = body.aliases.map(aliasIn);
    if (new Set(aliases.map((a) => a.address)).size !== aliases.length) fail(400, "Each address can be an alias once");
    if (body.signature !== undefined && (typeof body.signature !== "string" || Array.from(body.signature).length > 2000)) {
      fail(400, "The signature is at most 2000 characters");
    }
    const signature = typeof body.signature === "string" ? cleanBody(body.signature, 2000) : "";
    saveSetting("mail", { aliases, signature });
    return c.json(settingsOut());
  });

  app.get("/api/admin/mail/attachments/:id", async (c: Context) => {
    requireAdmin(c);
    const a = get<AttachmentRow>("SELECT * FROM mail_attachments WHERE id = ?", idParam(c));
    const file = a ? join(config.dataDir, a.path) : null;
    if (!a || !file || !(await stat(file).catch(() => null))) fail(404, "No such attachment", "not_found");
    c.header("Content-Type", downloadType(a.mime));
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${rfc5987(a.filename)}`);
    c.header("Content-Length", String(a.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "sandbox");
    return c.body(fileStream(file));
  });

  app.get("/api/admin/mail/messages/:id/raw", async (c: Context) => {
    requireAdmin(c);
    const row = get<{ raw_path: string | null }>("SELECT raw_path FROM mail_messages WHERE id = ?", idParam(c));
    const file = row?.raw_path ? join(config.dataDir, row.raw_path) : null;
    const stats = file ? await stat(file).catch(() => null) : null;
    if (!file || !stats) fail(404, "No received message with that id", "not_found");
    c.header("Content-Type", "message/rfc822");
    c.header("Content-Disposition", `attachment; filename*=UTF-8''${rfc5987(`${idParam(c)}.eml`)}`);
    c.header("Content-Length", String(stats.size));
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "sandbox");
    return c.body(fileStream(file));
  });
}

/** The :id of the route being answered (the router always gives one). */
function idParam(c: Context): string {
  return c.req.param("id") ?? "";
}

/** A JSON object body, refused when it is not one. */
function readJsonObject(c: Context, max = 4 * MB): Promise<Record<string, unknown>> {
  return readJson(c, max);
}

/** A list of addresses from a request: each valid, lower-cased, duplicates dropped. */
function addressList(v: unknown, what: string): string[] {
  if (!Array.isArray(v)) fail(400, `${what} must be a list of addresses`);
  const out: string[] = [];
  for (const item of v) {
    const address = cleanAddress(item);
    if (!address || !address.slice(address.indexOf("@")).includes(".")) fail(400, `An address in ${what} is not valid`);
    out.push(address);
  }
  return [...new Set(out)];
}

/** The References a stored message kept, as a list. */
function parseRefs(json: string): string[] {
  const v = JSON.parse(json) as unknown;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
