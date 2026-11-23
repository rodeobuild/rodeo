// The admin page's Mail tab: the mailbox the rodeo.build addresses receive into. On the left, the
// views (Inbox, Starred, Sent, Archive, Spam, Trash) and their conversations, newest first, with a
// search and "Load more"; on the right the conversation that is open, the composer, or the settings
// (aliases, signature, what is connected). The view and the open conversation are in the address
// (#mail, #mail/sent, #mail/t/<id>, #mail/sent/t/<id>), so Back and links work; on a phone the pane
// replaces the list. The list is fetched again every minute. Reading is in mailRead.ts, writing in
// mailCompose.ts.

import "./mail.css";
import { h } from "../app/dom.ts";
import { errorMessage, toast } from "../app/toast.ts";
import { mailbox } from "../platform/api.ts";
import type { MailAlias, MailSettings, MailThread, MailThreadFull, MailView } from "../platform/protocol.ts";
import { every, updatedNow, type AdminContext } from "./context.ts";
import { ago, dateTime } from "./format.ts";
import { composeBox } from "./mailCompose.ts";
import { openByDefault, readConversation, type ReadView } from "./mailRead.ts";
import { emptyView, errorView, loadingView } from "./ui.ts";

type PaneKind = "empty" | "thread" | "compose" | "forward" | "settings";

const VIEWS: readonly { readonly id: MailView; readonly label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "starred", label: "Starred" },
  { id: "sent", label: "Sent" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Spam" },
  { id: "trash", label: "Trash" },
];
const VIEW_IDS: Readonly<Record<string, true>> = Object.fromEntries(VIEWS.map((v) => [v.id, true]));
/** the views that are a folder: a conversation filed elsewhere leaves them */
const FOLDER_VIEWS: Readonly<Record<string, true>> = { inbox: true, archive: true, spam: true, trash: true };

const REFRESH_MS = 60_000;
const SEARCH_MS = 300;
const NARROW = "(max-width: 899px)";
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

const ICON_STAR = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
const ICON_CLIP = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3.6h-4l-.3 2.4a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 1.7 1l.3 2.4h4l.3-2.4a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;

interface Route {
  readonly view: MailView;
  readonly thread: string | null;
}

/** #mail, #mail/<view>, #mail/t/<id> or #mail/<view>/t/<id>; anything else is the inbox. */
function routeFromHash(hash: string): Route {
  const parts = hash.replace(/^#/, "").split("/").slice(1);
  let view: MailView = "inbox";
  const first = parts[0];
  if (first !== undefined && VIEW_IDS[first]) {
    view = first as MailView;
    parts.shift();
  }
  const id = parts[0] === "t" ? parts[1] : undefined;
  return { view, thread: id ? safeDecode(id) : null };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function listHash(view: MailView): string {
  return view === "inbox" ? "#mail" : `#mail/${view}`;
}

function threadHash(view: MailView, id: string): string {
  return `${listHash(view)}/t/${encodeURIComponent(id)}`;
}

export function mailView(ctx: AdminContext): HTMLElement {
  const { signal } = ctx;
  const narrow = window.matchMedia(NARROW);

  let view: MailView = "inbox";
  let query = "";
  let threads: MailThread[] = [];
  let next: string | null = null;
  let listSeq = 0;
  /** the conversation on screen (or being loaded) */
  let openId: string | null = null;
  let currentConv: ReadView | null = null;
  let threadSeq = 0;
  let expanded = new Set<string>();
  let expandedFor: string | null = null;
  let paneKind: PaneKind = "empty";
  let settingsP: Promise<MailSettings> | null = null;
  let searchTimer = 0;

  const getSettings = (): Promise<MailSettings> => {
    if (!settingsP) {
      const p = mailbox.settings();
      settingsP = p;
      p.catch(() => {
        if (settingsP === p) settingsP = null;
      });
    }
    return settingsP;
  };

  // ---- the frame: toolbar, views, list, pane ------------------------------------------------

  const compose = h("button", { cls: "adm-btn primary", text: "Compose", attrs: { type: "button" } });
  const search = h("input", { cls: "adm-input mail-search", attrs: { type: "search", placeholder: "Search mail", "aria-label": "Search mail", autocomplete: "off" } });
  const gear = h("button", { cls: "adm-btn ghost mail-icon", html: ICON_GEAR, attrs: { type: "button", "aria-label": "Mail settings", title: "Mail settings" } });
  const refresh = h("button", { cls: "adm-btn ghost", text: "Refresh", attrs: { type: "button" } });
  const toolbar = h("div", { cls: "mail-bar" }, compose, search, gear, refresh);

  const chips = h("div", { cls: "adm-chips", attrs: { role: "group", "aria-label": "Mail views" } });
  const list = h("div", { cls: "mail-list" });
  const more = h("button", { cls: "adm-btn mail-more", text: "Load more", attrs: { type: "button" } });
  more.hidden = true;
  const listCol = h("div", { cls: "mail-list-col" }, chips, list, more);

  const back = h("button", { cls: "adm-btn ghost", text: "Back", attrs: { type: "button", "aria-label": "Back to the list" } });
  const paneBar = h("div", { cls: "mail-pane-bar" }, back);
  const paneBody = h("div", { cls: "mail-pane-body" });
  const pane = h("div", { cls: "mail-pane" }, paneBar, paneBody);
  const grid = h("div", { cls: "mail-grid" }, listCol, pane);
  const root = h("div", { cls: "mail-root" }, toolbar, grid);

  const drawChips = (): void => {
    chips.replaceChildren(
      ...VIEWS.map((v) => {
        const on = v.id === view;
        const b = h("button", { cls: on ? "adm-chip on" : "adm-chip", text: v.label, attrs: { type: "button", "aria-pressed": String(on) } });
        b.addEventListener("click", () => {
          if (location.hash !== listHash(v.id)) location.hash = listHash(v.id);
        });
        return b;
      }),
    );
  };

  /** the list's row for a conversation: the link opens it, the star files its mark */
  const rowOf = (t: MailThread): HTMLElement => {
    const names = t.participants.map((p) => p.name || p.address).join(", ") || "No one else";
    const href = threadHash(view, t.id);
    const link = h(
      "a",
      { cls: "mail-row-link", attrs: { href } },
      h(
        "span",
        { cls: "mail-row-top" },
        t.unread > 0 ? h("span", { cls: "mail-dot", attrs: { "aria-label": "Unread" } }) : null,
        h("span", { cls: "mail-row-who", text: names, attrs: { title: names } }),
        h("time", { cls: "mail-row-when", text: ago(t.lastAt), attrs: { datetime: t.lastAt, title: dateTime(t.lastAt) } }),
      ),
      h(
        "span",
        { cls: "mail-row-subject" },
        h("span", { cls: "mail-row-subject-text", text: t.subject || "(no subject)" }),
        t.attachments ? h("span", { cls: "mail-clip", html: ICON_CLIP, attrs: { title: "Has attachments", role: "img", "aria-label": "Has attachments" } }) : null,
        t.count > 1 ? h("span", { cls: "mail-row-count", text: String(t.count), attrs: { title: `${t.count} messages` } }) : null,
      ),
      h("span", { cls: "mail-row-snippet", text: t.snippet }),
    );
    // the same link again while its conversation is on screen (say, after Forward) opens it afresh
    link.addEventListener("click", (e) => {
      if (location.hash === href) {
        e.preventDefault();
        void openThread(t.id);
      }
    });
    const star = h("button", {
      cls: t.starred ? "mail-star on" : "mail-star",
      html: ICON_STAR,
      attrs: { type: "button", "aria-label": t.starred ? "Unstar" : "Star", "aria-pressed": String(t.starred), title: t.starred ? "Unstar" : "Star" },
    });
    star.addEventListener("click", () => {
      star.disabled = true;
      mailbox
        .update(t.id, { starred: !t.starred })
        .then((next) => changed(next))
        .catch((err: unknown) => toast(errorMessage(err), "error"))
        .finally(() => {
          star.disabled = false;
        });
    });
    return h("div", { cls: t.unread > 0 ? "mail-row unread" : "mail-row", attrs: { "data-id": t.id } }, link, star);
  };

  const highlight = (): void => {
    for (const row of list.querySelectorAll<HTMLElement>(".mail-row")) row.classList.toggle("on", row.dataset["id"] === openId);
  };

  const renderList = (): void => {
    if (threads.length === 0) {
      list.replaceChildren(emptyView(query ? `Nothing matches "${query}".` : "No mail here."));
      more.hidden = true;
      return;
    }
    list.replaceChildren(...threads.map(rowOf));
    more.hidden = next === null;
    highlight();
  };

  /** fetches the list's first page (or the next one, appended) for the view and search on screen */
  const loadPage = async (append: boolean): Promise<void> => {
    if (append && next === null) return;
    const seq = ++listSeq;
    more.disabled = true;
    try {
      const page = await mailbox.threads(view, { q: query, before: append ? next : null });
      if (signal.aborted || seq !== listSeq) return;
      threads = append ? [...threads, ...page.threads.filter((t) => !threads.some((x) => x.id === t.id))] : [...page.threads];
      next = page.next;
      ctx.badge("mail", page.unreadInbox);
      ctx.updated(updatedNow());
      renderList();
    } catch (err) {
      if (signal.aborted || seq !== listSeq) return;
      if (threads.length === 0) list.replaceChildren(errorView(err));
      else toast(errorMessage(err), "error");
    } finally {
      more.disabled = false;
    }
  };

  /** a conversation's star, mark or folder changed: the list and an open conversation follow */
  const changed = (t: MailThread): void => {
    if (openId === t.id) currentConv?.update(t);
    const leaves = (view === "starred" && !t.starred) || (FOLDER_VIEWS[view] === true && t.folder !== view);
    threads = leaves ? threads.filter((x) => x.id !== t.id) : threads.map((x) => (x.id === t.id ? t : x));
    renderList();
  };

  // ---- the pane ----------------------------------------------------------------------------

  const showPane = (node: Node, kind: PaneKind): void => {
    paneKind = kind;
    paneBody.replaceChildren(node);
    grid.classList.toggle("reading", kind !== "empty");
  };

  /** forgets the conversation on screen (any load of it still in flight is dropped) */
  const leaveThread = (): void => {
    threadSeq++;
    openId = null;
    currentConv = null;
    expandedFor = null;
    highlight();
  };

  const closePane = (): void => {
    leaveThread();
    showPane(emptyView("Choose a conversation to read it."), "empty");
  };

  /** the address shows the list (no conversation): the pane closes through the hash change */
  const setListHash = (): void => {
    if (location.hash !== listHash(view)) location.hash = listHash(view);
  };

  const openThread = async (id: string): Promise<void> => {
    if (openId !== id) {
      currentConv = null;
      expandedFor = null;
    }
    openId = id;
    highlight();
    const seq = ++threadSeq;
    showPane(loadingView(), "thread");
    try {
      const [full, settings] = await Promise.all([mailbox.thread(id), getSettings()]);
      if (signal.aborted || seq !== threadSeq) return;
      if (expandedFor !== id) {
        expanded = openByDefault(full);
        expandedFor = id;
      }
      const conv = readConversation({
        full,
        settings,
        expanded,
        onChange: changed,
        onLeave: () => {
          closePane();
          setListHash();
          void loadPage(false);
        },
        onForward: () => openForward(full),
        onSent: (sent) => {
          void loadPage(false);
          goThread(sent.threadId, view);
        },
      });
      currentConv = conv;
      showPane(conv.el, "thread");
    } catch (err) {
      if (signal.aborted || seq !== threadSeq) return;
      showPane(errorView(err), "thread");
    }
  };

  /** opens a conversation by its address (or, when the address already is it, by loading it again) */
  const goThread = (id: string, v: MailView): void => {
    const target = threadHash(v, id);
    if (location.hash === target) void openThread(id);
    else location.hash = target;
  };

  const backFromForward = (): void => {
    if (openId) void openThread(openId);
    else closePane();
  };

  const openNew = (): void => {
    leaveThread();
    setListHash();
    showPane(loadingView(), "compose");
    getSettings()
      .then((settings) => {
        if (signal.aborted || paneKind !== "compose") return;
        showPane(
          composeBox({
            kind: "new",
            threadId: null,
            message: null,
            settings,
            panel: true,
            onClose: closePane,
            onSent: (sent) => goThread(sent.threadId, "sent"),
          }),
          "compose",
        );
      })
      .catch((err: unknown) => {
        if (!signal.aborted && paneKind === "compose") showPane(errorView(err), "compose");
      });
  };

  const openForward = (full: MailThreadFull): void => {
    const last = full.messages[full.messages.length - 1] ?? null;
    getSettings()
      .then((settings) => {
        if (signal.aborted) return;
        showPane(
          composeBox({
            kind: "forward",
            threadId: full.thread.id,
            message: last,
            settings,
            panel: true,
            onClose: backFromForward,
            onSent: (sent) => goThread(sent.threadId, "sent"),
          }),
          "forward",
        );
      })
      .catch((err: unknown) => toast(errorMessage(err), "error"));
  };

  const openSettings = (): void => {
    leaveThread();
    setListHash();
    showPane(loadingView(), "settings");
    getSettings()
      .then((settings) => {
        if (signal.aborted || paneKind !== "settings") return;
        showPane(
          settingsPanel(
            settings,
            (next) => {
              settingsP = Promise.resolve(next);
            },
            closePane,
          ),
          "settings",
        );
      })
      .catch((err: unknown) => {
        if (!signal.aborted && paneKind === "settings") showPane(errorView(err), "settings");
      });
  };

  /** the address changed (a link, Back, a chip, the browser's buttons): show what it names */
  const applyRoute = (): void => {
    const r = routeFromHash(location.hash);
    if (r.view !== view) {
      view = r.view;
      threads = [];
      next = null;
      drawChips();
      list.replaceChildren(loadingView());
      more.hidden = true;
      void loadPage(false);
    }
    if (r.thread !== openId) {
      if (r.thread) void openThread(r.thread);
      else closePane();
    }
  };

  // ---- wiring --------------------------------------------------------------------------------

  compose.addEventListener("click", openNew);
  gear.addEventListener("click", openSettings);
  refresh.addEventListener("click", () => void loadPage(false));
  more.addEventListener("click", () => void loadPage(true));
  back.addEventListener("click", () => {
    if (openId) setListHash();
    else closePane();
  });
  search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const q = search.value.trim();
      if (q === query) return;
      query = q;
      threads = [];
      next = null;
      void loadPage(false);
    }, SEARCH_MS);
  });
  signal.addEventListener("abort", () => window.clearTimeout(searchTimer));

  window.addEventListener(
    "hashchange",
    () => {
      if (signal.aborted || !/^#mail(\/|$)/.test(location.hash)) return;
      applyRoute();
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (paneKind === "forward") backFromForward();
      else if (paneKind === "compose" || paneKind === "settings") closePane();
      else if (paneKind === "thread" && narrow.matches) back.click();
    },
    { signal },
  );
  every(signal, REFRESH_MS, () => {
    void loadPage(false);
  });

  // the first paint: the view and conversation the address names
  const first = routeFromHash(location.hash);
  view = first.view;
  drawChips();
  showPane(emptyView("Choose a conversation to read it."), "empty");
  list.replaceChildren(loadingView());
  void loadPage(false);
  getSettings().catch(() => {
    // the composer and settings say so when they are opened
  });
  if (first.thread) void openThread(first.thread);

  return root;
}

interface AliasRow {
  readonly name: HTMLInputElement;
  readonly address: HTMLInputElement;
  readonly el: HTMLElement;
}

/** The Mail settings: the addresses mail can be sent as, the signature, and what is connected. */
function settingsPanel(s: MailSettings, saved: (next: MailSettings) => void, close: () => void): HTMLElement {
  const rows: AliasRow[] = [];
  const list = h("div", { cls: "mail-aliases" });
  const none = h("p", { cls: "adm-muted", text: "No addresses yet." });

  const addRow = (a?: MailAlias): AliasRow => {
    const name = h("input", { cls: "adm-input", attrs: { type: "text", "aria-label": "Name", placeholder: "Name", autocomplete: "off" } });
    const address = h("input", { cls: "adm-input", attrs: { type: "email", "aria-label": "Address", placeholder: "name@example.com", autocomplete: "off" } });
    name.value = a?.name ?? "";
    address.value = a?.address ?? "";
    const remove = h("button", { cls: "adm-btn small ghost", text: "Remove", attrs: { type: "button", "aria-label": "Remove this address" } });
    const el = h("div", { cls: "mail-alias" }, name, address, remove);
    const row: AliasRow = { name, address, el };
    remove.addEventListener("click", () => {
      el.remove();
      rows.splice(rows.indexOf(row), 1);
      if (rows.length === 0) list.append(none);
    });
    rows.push(row);
    none.remove();
    list.append(el);
    return row;
  };
  if (s.aliases.length === 0) list.append(none);
  for (const a of s.aliases) addRow(a);

  const add = h("button", { cls: "adm-btn small", text: "Add address", attrs: { type: "button" } });
  add.addEventListener("click", () => addRow().name.focus());

  const sig = h("textarea", { cls: "mail-textarea", attrs: { rows: "5", "aria-label": "Signature", spellcheck: "true" } });
  sig.value = s.signature;

  const note = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
  const show = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
  };
  const save = h("button", { cls: "adm-btn primary", text: "Save", attrs: { type: "button" } });
  save.addEventListener("click", () => {
    const aliases: MailAlias[] = [];
    for (const r of rows) {
      const name = r.name.value.trim();
      const address = r.address.value.trim().toLowerCase();
      if (!name && !address) continue;
      if (!address) return show(`Add an address for "${name}".`);
      if (!EMAIL.test(address)) return show(`"${address}" doesn't look like an email address.`);
      aliases.push({ name, address });
    }
    note.hidden = true;
    save.disabled = true;
    mailbox
      .saveSettings({ aliases, signature: sig.value })
      .then((next) => {
        saved(next);
        toast("Mail settings saved", "info");
      })
      .catch((err: unknown) => show(errorMessage(err)))
      .finally(() => {
        save.disabled = false;
      });
  });

  const closeBtn = h("button", { cls: "adm-btn small ghost", text: "Close", attrs: { type: "button", "aria-label": "Close mail settings" } });
  closeBtn.addEventListener("click", close);

  return h(
    "section",
    { cls: "mail-settings", attrs: { "aria-label": "Mail settings" } },
    h("div", { cls: "mail-compose-head" }, h("h3", { text: "Mail settings" }), closeBtn),
    h(
      "div",
      { cls: "mail-stats" },
      h("p", {
        cls: "mail-stat",
        text: s.receiving ? "Receiving: connected." : "Receiving: not connected. Incoming mail isn't connected yet — see mail-worker/README.md",
      }),
      h("p", { cls: "mail-stat", text: s.sending ? "Sending: ready." : "Sending: not set up." }),
      h("p", { cls: "mail-stat", text: `Domains: ${s.domains.length > 0 ? s.domains.join(", ") : "none set"}` }),
    ),
    h("h3", { cls: "mail-subhead", text: "Addresses you send from" }),
    h("p", { cls: "adm-muted", text: "Each one can be picked as the From address. Any address at the domains above can be typed in too." }),
    list,
    h("div", { cls: "adm-actions" }, add),
    h("h3", { cls: "mail-subhead", text: "Signature" }),
    sig,
    h("p", { cls: "adm-muted", text: "Added after a blank line at the foot of new messages, replies and forwards." }),
    note,
    h("div", { cls: "adm-actions" }, save),
  );
}
