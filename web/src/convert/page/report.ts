// The check and the report for a converted file on the converter page. Under each file's row, a
// quiet line asks whether the converted file looks right ("Looks right" or "Report a problem"); a
// file that would not read or convert gets "Report this file" instead. "Report a problem" opens a
// dialog that sends a bug report to the Rodeo team (POST /api/feedback), the same flow the
// editor's report uses (web/src/features/feedback/report.ts): the problem chips, a message, an
// optional email, the original file (ticked by default, uploaded only once the report is sent),
// the before and after pictures when there are some, and the details, all listed before they go.
// Nothing is sent until Send is pressed. Answers are counted once each (POST /api/visits, event
// "check"), with the kind of file and never its name. Nothing is sent by a test browser.

import { h } from "../../app/dom.ts";
import { t } from "../../app/i18n.ts";
import { feedback, serverConfig } from "../../platform/api.ts";
import type { FeedbackContext, FeedbackDiagnostics, FeedbackSent, NewFeedback, ReportValue } from "../../platform/protocol.ts";
import { formatById } from "../formats.ts";
import type { DrawingSummary } from "../types.ts";
import "./report.css";

/** A file the page converted, or could not read or convert: what its check and its report are about. */
export interface ConvertCase {
  /** the original file */
  readonly file: File;
  /** the format id read, e.g. "dwg" */
  readonly from: string;
  /** the format id converted to, e.g. "pdf"; null when the read failed */
  readonly to: string | null;
  /** the converted file, or null when none was made */
  readonly output: { readonly name: string; readonly size: number } | null;
  /** the drawing as the file read, or null */
  readonly before: DrawingSummary | null;
  /** the converted file read back, when that was possible, or null */
  readonly after: DrawingSummary | null;
  /** the read, convert or read-back error, as the user was shown it, or null */
  readonly error: string | null;
  /** what the writer left out or approximated, plain sentences without a full stop */
  readonly notes: readonly string[];
  /** a before and after picture (PNG), or null when there is none */
  picture(): Promise<Blob | null>;
}

/** The problems a converted file usually shows: one click each, so a report needs little typing. */
const PROBLEMS = [
  "Objects missing",
  "Wrong place or size",
  "Wrong colours or lines",
  "Text looks wrong",
  "Layers or classes wrong",
  "3D looks wrong",
  "Didn't convert",
  "Slow or froze",
] as const;

/** The answers given on this page, by case: "Looks right" turns the line into "Thanks.". */
const answers = new Map<string, "ok" | "report">();
/** The answers already counted, by answer and case, so a line redrawn never counts one twice. */
const counted = new Set<string>();

let dialogs = 0;

/**
 * Fills `slot` (an empty element in the file's row) with the "Does it look right?" line for this
 * case. Call it again to refresh the line; the answers given on this page are kept.
 */
export function renderCheck(slot: HTMLElement, c: ConvertCase): void {
  const failed = isFailed(c);
  const key = caseKey(c);
  if (failed) countOnce(c, "failed");
  const children: Node[] = [];
  if (answers.get(key) === "ok") {
    children.push(h("span", { cls: "cv-check-text", text: "Thanks." }));
  } else if (failed) {
    // converted, but the file made didn't open again: say so, as the tile does
    const text = c.output ? `Rodeo couldn't open the converted ${formatName(c.to)} again. Send it to us and we'll find out why.` : "Send it to us and we'll find out why.";
    children.push(
      h("span", { cls: "cv-check-text", text }),
      checkButton("Report this file", () => respond(slot, c, "report")),
    );
  } else {
    children.push(
      h("span", { cls: "cv-check-text", text: `Does the ${formatName(c.to)} look right?` }),
      checkButton("Looks right", () => respond(slot, c, "ok")),
      checkButton("Report a problem", () => respond(slot, c, "report")),
    );
  }
  slot.replaceChildren(h("div", { cls: "cv-check" }, ...children));
}

/** Opens the report dialog for this case: a bug report with the file it is about. */
export function openConvertReport(c: ConvertCase): void {
  const failed = isFailed(c);
  const id = `cv-report-${++dialogs}`;
  const stop = new AbortController();
  const chosen = new Set<string>(failed ? ["Didn't convert"] : []);
  const pictureReady: Promise<Blob | null> = Promise.resolve()
    .then(() => c.picture())
    .catch((): null => null);
  let previewUrl: string | null = null;

  // ---- title, and what's wrong
  const title = h("h2", { cls: "cv-report-title", text: `Report a problem with ${c.file.name}`, attrs: { id: `${id}-title` } });
  const chipButtons = PROBLEMS.map((p) => {
    const chip = h("button", { cls: "cv-report-chip", text: p, attrs: { type: "button", "aria-pressed": String(chosen.has(p)) } });
    chip.addEventListener("click", () => {
      if (chosen.has(p)) chosen.delete(p);
      else chosen.add(p);
      chip.setAttribute("aria-pressed", String(chosen.has(p)));
      setError(null);
    });
    return chip;
  });
  const chips = h(
    "div",
    { cls: "cv-report-field" },
    h("span", { cls: "cv-report-label", text: "What's wrong?" }),
    h("div", { cls: "cv-report-chips", attrs: { role: "group", "aria-label": "What's wrong?" } }, ...chipButtons),
  );

  // ---- message and email
  const message = h("textarea", {
    cls: "cv-report-input cv-report-message",
    // a textarea is the user's own text, which the page's translation leaves alone, so its prompt is translated here
    placeholder: t("What looks wrong, and where? Which program and version made the file (e.g. AutoCAD 2018, Revit 2024)?"),
    attrs: { rows: "5", maxlength: "4000", "aria-label": "Message" },
  });
  const email = h("input", {
    cls: "cv-report-input",
    attrs: { type: "email", inputmode: "email", autocomplete: "email", maxlength: "254", placeholder: "you@example.com" },
  });
  // people never see this field; bots that fill every field do, and the server drops their reports
  const trap = h("input", { cls: "cv-report-trap", attrs: { type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" } });

  // ---- what goes with it: the file, and the pictures when there are some
  const fileBox = h("input", { attrs: { type: "checkbox" } });
  fileBox.checked = c.file.size > 0;
  fileBox.disabled = c.file.size === 0;
  const fileLine = h(
    "label",
    { cls: "cv-report-check" },
    fileBox,
    h("span", { text: `Attach ${c.file.name} (${sizeOf(c.file.size)})` }),
  );
  const fileHint = h("p", {
    cls: "cv-report-hint",
    text: "The file is uploaded to Rodeo only if you send this report. Only the Rodeo team sees it, to fix the converter, and it's deleted after 90 days.",
  });

  const pictureBox = h("input", { attrs: { type: "checkbox" } });
  pictureBox.disabled = true;
  const pictureNote = h("p", { cls: "cv-report-hint", text: "Making the pictures…" });
  const thumb = h("img", { cls: "cv-report-thumb", attrs: { alt: "The before and after pictures that go with the report" }, hidden: true });
  const pictureRow = h(
    "div",
    { cls: "cv-report-pictures" },
    h("label", { cls: "cv-report-check" }, pictureBox, h("span", { text: "Attach the before and after pictures" })),
    pictureNote,
    thumb,
  );
  void pictureReady.then((blob) => {
    if (stop.signal.aborted) return;
    if (!blob) {
      pictureRow.hidden = true;
      return;
    }
    previewUrl = URL.createObjectURL(blob);
    thumb.src = previewUrl;
    thumb.hidden = false;
    pictureNote.hidden = true;
    pictureBox.disabled = false;
    pictureBox.checked = true;
  });

  // ---- the details that go with it, as they are sent
  const context: FeedbackContext = contextOf(c);
  const facts = h("dl", { cls: "cv-report-facts" });
  const showFacts = (): void => facts.replaceChildren(...factRows(c, context));
  showFacts();
  void serverConfig()
    .then((cfg) => {
      if (!cfg?.version) return;
      context.version = cfg.version;
      showFacts();
    })
    .catch(() => undefined);
  const details = h("details", { cls: "cv-report-details" }, h("summary", { text: "What else is sent" }), facts);

  // ---- the error line, the buttons, and the thanks once sent
  const error = h("p", { cls: "cv-report-error", attrs: { role: "alert" }, hidden: true });
  const setError = (text: string | null): void => {
    error.textContent = text ?? "";
    error.hidden = text === null;
  };
  const cancel = h("button", { cls: "cv-btn cv-btn-quiet", text: "Cancel", attrs: { type: "button" } });
  const sendButton = h("button", { cls: "cv-btn cv-btn-primary", text: "Send report", attrs: { type: "button" } });
  const say = (text: string): void => {
    sendButton.textContent = text;
  };
  const body = h(
    "div",
    { cls: "cv-report-body" },
    chips,
    message,
    h("label", { cls: "cv-report-field" }, h("span", { cls: "cv-report-label", text: "Email, if you'd like a reply" }), email),
    h("div", { cls: "cv-report-attach" }, fileLine, fileHint, pictureRow),
    details,
    error,
    trap,
  );
  const foot = h("div", { cls: "cv-report-foot" }, cancel, sendButton);
  const dialog = h("dialog", { cls: "cv-report", attrs: { "aria-labelledby": `${id}-title` } }, title, body, foot);

  // done: the sent report's thanks, and the file's state if it did not come
  const done = (missed: string[]): void => {
    title.textContent = "Report sent";
    body.replaceChildren(
      h("p", { cls: "cv-report-thanks", text: `Thanks — we've got it. We'll look into ${c.file.name}.` }),
      ...(missed.length > 0 ? [h("p", { cls: "cv-report-hint", text: `Your report reached us, but not ${missed.join(" or ")}.` })] : []),
    );
    const close = h("button", { cls: "cv-btn cv-btn-primary", text: "Close", attrs: { type: "button" } });
    close.addEventListener("click", () => dialog.close());
    foot.replaceChildren(close);
    close.focus();
  };

  const send = async (): Promise<void> => {
    const text = message.value.trim();
    const picked = PROBLEMS.filter((p) => chosen.has(p));
    const written = [picked.length > 0 ? `What's wrong: ${picked.join(", ")}` : "", text].filter((part) => part !== "").join("\n\n");
    const address = email.value.trim();
    if (address && !email.checkValidity()) {
      setError("Email: enter a valid address, or leave it empty.");
      return;
    }
    setError(null);
    sendButton.disabled = true;
    say("Sending…");
    const picture = pictureBox.checked ? await pictureReady : null;
    const withFile = fileBox.checked && c.file.size > 0;
    const payload: NewFeedback & { readonly website: string } = {
      kind: "bug",
      message: written.length >= 3 ? written : "The converted file looks wrong.",
      email: address || null,
      context,
      diagnostics: diagnosticsOf(c),
      attach: { screenshot: picture !== null, file: withFile ? { name: c.file.name, size: c.file.size } : null },
      website: trap.value,
    };
    let sent: FeedbackSent;
    try {
      sent = await feedback.send(payload);
    } catch (err) {
      // nothing was saved: the form stays, with what was typed
      setError(errorText(err));
      sendButton.disabled = false;
      say("Send report");
      return;
    }
    // the report is saved: what comes with it follows, and a failure there is said, not hidden
    const missed: string[] = [];
    if (picture && sent.token) {
      await feedback.screenshot(sent, picture).catch((err: unknown) => missed.push(`the pictures (${errorText(err)})`));
    }
    if (withFile) {
      if (sent.fileRefused) missed.push(`the file (${sent.fileRefused})`);
      else if (stop.signal.aborted) missed.push("the file (stopped when the form closed)");
      else if (sent.token) {
        await feedback
          .file(sent, c.file, (sentSoFar, total) => say(`Sending ${Math.floor((sentSoFar / total) * 100)}%`), stop.signal)
          .catch((err: unknown) => missed.push(stop.signal.aborted ? "the file (stopped when the form closed)" : `the file (${errorText(err)})`));
      }
    }
    if (stop.signal.aborted) return;
    done(missed);
  };

  sendButton.addEventListener("click", () => void send());
  cancel.addEventListener("click", () => dialog.close());
  // closing stops a file still on its way (as the editor's report does), and frees the picture
  dialog.addEventListener("close", () => {
    stop.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  chipButtons[0]?.focus();
}

/** A check's button, small and quiet. */
function checkButton(label: string, run: () => void): HTMLButtonElement {
  const btn = h("button", { cls: "cv-btn cv-check-btn", text: label, attrs: { type: "button" } });
  btn.addEventListener("click", run);
  return btn;
}

/** Records an answer and redraws the line; "Report a problem" also opens the report. */
function respond(slot: HTMLElement, c: ConvertCase, answer: "ok" | "report"): void {
  const key = caseKey(c);
  answers.set(key, answer);
  countOnce(c, answer);
  if (answer === "report") openConvertReport(c);
  renderCheck(slot, c);
}

/** Counts one answer for this case, once, on this page. */
function countOnce(c: ConvertCase, answer: "ok" | "report" | "failed"): void {
  const key = caseKey(c);
  const once = `${answer}|${key}`;
  if (counted.has(once)) return;
  counted.add(once);
  countAnswer(answer, formatKey(c));
}

/** Sends one answer to the visit counts (POST /api/visits, event "check"): the answer and the kind of file. */
function countAnswer(answer: "ok" | "report" | "failed", format: string): void {
  if (navigator.webdriver) return;
  void fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
    body: JSON.stringify({ event: "check", answer, format, device: deviceOf() }),
    credentials: "include",
    keepalive: true,
  }).catch(() => undefined);
}

/** A file that did not convert: its read failed, it made no output, or it reported an error. */
function isFailed(c: ConvertCase): boolean {
  return c.error !== null || c.output === null || c.to === null;
}

/** The format the count is kept under: "dwgtopdf", or the read format alone when it failed. */
function formatKey(c: ConvertCase): string {
  return isFailed(c) || c.to === null ? c.from : `${c.from}to${c.to}`;
}

/** The answers' key for a case: its file (by name and size) and its formats. */
function caseKey(c: ConvertCase): string {
  return `${c.file.name}|${c.file.size}|${c.from}|${c.to ?? ""}`;
}

/** A format's display name ("PDF"), from its id. */
function formatName(id: string | null): string {
  if (!id) return "file";
  return formatById(id)?.name ?? id.toUpperCase();
}

/** A size as people read it: "640 KB", "2.4 MB". */
function sizeOf(n: number): string {
  if (n <= 0) return "empty";
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** The details a report carries: the converted file's kind and size, the browser, system, window and language. */
function contextOf(c: ConvertCase): FeedbackContext {
  const ua = navigator.userAgent;
  const outcome = isFailed(c) ? "didn't convert" : "converted";
  const to = c.to ? ` to ${formatName(c.to)}` : "";
  return {
    view: "convert",
    file: `${formatName(c.from)}, ${sizeOf(c.file.size)}, ${outcome}${to}`,
    browser: browserName(ua),
    platform: platformName(ua),
    screen: `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}x`,
    language: navigator.language,
  };
}

/** The environment, the drawing's counts before and after, and what happened (the error and the writer's notes). */
function diagnosticsOf(c: ConvertCase): FeedbackDiagnostics {
  const ua = navigator.userAgent;
  const env: Record<string, ReportValue> = { browser: browserName(ua), platform: platformName(ua), language: navigator.language };
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  if (memory) env.memory = `${memory} GB`;
  const trail = [...(c.error ? [`Error: ${c.error}`] : []), ...c.notes.map((note) => `Note: ${note}`)];
  return {
    env,
    workspace: {
      from: c.from,
      to: c.to,
      inputBytes: c.file.size,
      outputBytes: c.output?.size ?? null,
      beforeObjects: c.before?.totalObjects ?? null,
      afterObjects: c.after?.totalObjects ?? null,
      beforeLayers: c.before ? c.before.layers.length : null,
      afterLayers: c.after ? c.after.layers.length : null,
      units: c.before?.units ?? c.after?.units ?? null,
    },
    ...(trail.length > 0 ? { trail } : {}),
  };
}

/** The "What else is sent" list: the same values the report carries, as the sender reads them. */
function factRows(c: ConvertCase, context: FeedbackContext): Node[] {
  const diagnostics = diagnosticsOf(c);
  const count = (s: DrawingSummary | null, pick: (d: DrawingSummary) => number): string => (s ? String(pick(s)) : "not read");
  const rows: [string, string | undefined][] = [
    ["Converted", isFailed(c) ? `${formatName(c.from)} (didn't convert)` : `${formatName(c.from)} to ${formatName(c.to)}`],
    ["File size", sizeOf(c.file.size)],
    ["Converted file", c.output ? sizeOf(c.output.size) : "none"],
    ["Objects before", count(c.before, (d) => d.totalObjects)],
    ["Objects after", count(c.after, (d) => d.totalObjects)],
    ["Layers before", count(c.before, (d) => d.layers.length)],
    ["Layers after", count(c.after, (d) => d.layers.length)],
    ["Units", c.before?.units ?? c.after?.units],
    ["Browser", context.browser],
    ["System", context.platform],
    ["Window", context.screen],
    ["Language", context.language],
    ["Version", context.version],
    ["Memory", diagnostics.env?.memory ? String(diagnostics.env.memory) : undefined],
    ["Error", c.error ?? undefined],
    ["Left out", c.notes.length > 0 ? `${c.notes.join(". ")}.` : undefined],
  ];
  return rows
    .filter((row): row is [string, string] => row[1] !== undefined)
    .flatMap(([label, value]) => [h("dt", { text: label }), h("dd", { text: value })]);
}

/** A failure's message, as the server or the browser words it. */
function errorText(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Try again.";
}

/** The device as the visit counts name it: a phone or a tablet when the pointer is a finger, else a desktop. */
function deviceOf(): "phone" | "tablet" | "desktop" {
  if (!matchMedia("(pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
}

/** The browser and its version, from the user agent ("Chrome 140"). Copied from app/reports.ts, which starts error capture when loaded. */
function browserName(ua: string): string {
  const known: readonly [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, "Safari"],
  ];
  for (const [re, name] of known) {
    const m = re.exec(ua);
    if (m) return `${name} ${m[1]}`;
  }
  return ua.slice(0, 120);
}

/** The system: "macOS", "Windows", "iOS". Copied from app/reports.ts (see browserName). */
function platformName(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "iPadOS" : "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}
