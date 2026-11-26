// The admin page's Overview: who is in the editor now (with a small globe of where), the period's
// visitors, sign-ups and use against the period before, what leads to sign-ups (where in the editor
// each sign-in was started, and how the prompts fare), the money (credit bought, given and used,
// what it cost, and what is still owed), charts a day, and where visitors came from. It refreshes
// each minute while shown.

import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminOverview, AdminPeriod, PromptTally, SignInTally, Tally } from "../platform/protocol.ts";
import { barList, columnChart, lineChart, type Point } from "./charts.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { bytes, count, country, minutes, money, share, usd } from "./format.ts";
import { liveCard } from "./live.ts";
import { sourceLabel } from "./sources.ts";
import { card, loaded, periodName, section, tile, tiles } from "./ui.ts";

/** the overview is fetched again this often while it is in front */
const REFRESH_MS = 60_000;

const ENTRY_LABEL: Record<string, string> = {
  editor: "Opened Rodeo",
  share: "A share link",
  invite: "An invite",
  embed: "An embedded drawing",
  app: "The installed app",
  convert: "The converter",
};

const DEVICE_LABEL: Record<string, string> = { desktop: "Computer", tablet: "Tablet", phone: "Phone" };

/** the check after a file comes in (feedback/check.ts): asked, then answered, or never */
const CHECK_LABEL: Record<string, string> = {
  asked: "Asked if it looked right",
  ok: "Said it looked right",
  report: "Opened a report",
  closed: "Closed the question",
  failed: "Didn't come in",
};

/** the layouts of View › Work Like, as the prompts name them */
const LOOK_LABEL: Record<string, string> = {
  rodeo: "Rodeo",
  archicad: "Archicad",
  autocad: "AutoCAD",
  illustrator: "Illustrator",
  revit: "Revit",
  rhino: "Rhino",
  sketchup: "SketchUp",
  vectorworks: "Vectorworks",
};

/**
 * What leads to sign-ups: a row for each place a sign-in was started, from the prompt coming on
 * screen (where there is one) through the dialog and a way in to the account; then how the
 * prompts over a drawing fared, and the layouts people picked.
 */
function signInSection(o: AdminOverview): HTMLElement {
  const { sources, prompts, looks } = o.signIns;
  const prompt = (name: PromptTally["prompt"]): PromptTally => prompts.find((p) => p.prompt === name) ?? { prompt: name, shown: 0, taken: 0, refused: 0 };
  const join = prompt("join");
  const keep = prompt("keep");
  const look = prompt("look");
  const picker = prompt("picker");
  // the prompts that come on screen by themselves have a "shown" to start their row
  const shownAt: Record<string, number> = { start: join.shown, keep: keep.shown };
  const num = (n: number | null): HTMLElement => h("td", { cls: "num", text: n === null ? "" : count(n) });
  const row = (t: SignInTally): HTMLElement =>
    h(
      "tr",
      {},
      h("td", { text: sourceLabel(t.source) }),
      num(t.source in shownAt ? shownAt[t.source] : null),
      num(t.opened),
      num(t.started),
      h("td", { cls: "num" }, h("strong", { text: count(t.accounts) })),
      num(t.returning),
    );
  const sum = (key: "opened" | "started" | "accounts" | "returning"): number => sources.reduce((n, t) => n + t[key], 0);
  const table = sources.length
    ? h(
        "div",
        { cls: "adm-table-wrap" },
        h(
          "table",
          { cls: "adm-table compact" },
          h(
            "thead",
            {},
            h(
              "tr",
              {},
              h("th", { text: "Where the sign-in started" }),
              h("th", { cls: "num", text: "Shown", attrs: { title: "Times the prompt came on screen for someone not signed in" } }),
              h("th", { cls: "num", text: "Asked to sign in", attrs: { title: "Times the sign-in dialog was opened from there" } }),
              h("th", { cls: "num", text: "Chose a way in", attrs: { title: "Times a provider was chosen or a sign-in link sent" } }),
              h("th", { cls: "num", text: "New accounts" }),
              h("th", { cls: "num", text: "Signed back in", attrs: { title: "Sign-ins by people who already had an account" } }),
            ),
          ),
          h("tbody", {}, ...sources.map(row)),
          h("tfoot", {}, h("tr", {}, h("td", { text: "All" }), num(null), num(sum("opened")), num(sum("started")), h("td", { cls: "num" }, h("strong", { text: count(sum("accounts")) })), num(sum("returning")))),
        ),
      )
    : h("p", { cls: "adm-empty", text: "No sign-in has been started in this period." });
  const name = periodName(o.days);
  return section(
    "What leads to sign-ups",
    "Where in the editor each sign-in was started. New accounts are exact; the steps before them are counted by the browser, so a blocker can leave them a little short. Accounts made outside the editor (the gallery, an agent's sign-in page) or before this was counted are in the row that says so.",
    card("Sign-ins by where they started", table),
    tiles(
      tile({ label: "Save-to-cloud prompt", value: share(keep.taken, keep.shown), note: `taken of ${count(keep.shown)} shown · ${count(keep.refused)} closed` }, name),
      tile({ label: "Work Like offer", value: share(look.taken, look.shown), note: `taken of ${count(look.shown)} shown · ${count(look.refused)} closed` }, name),
      tile({ label: "Layouts picked on the start screen", value: count(picker.taken), note: `the start screen's account block was shown ${count(join.shown)} times` }, name),
    ),
    h("div", { cls: "adm-lists" }, barList("Layouts chosen", looks, (t) => LOOK_LABEL[t.label] ?? t.label, "Nobody has picked a layout yet")),
  );
}

function points(o: AdminOverview, keys: readonly (keyof AdminOverview["series"][number])[]): Point[] {
  return o.series.map((d) => ({ day: d.day, values: Object.fromEntries(keys.map((k) => [k, Number(d[k])])) }));
}

function visitorTiles(o: AdminOverview): HTMLElement[] {
  const p: AdminPeriod = o.period;
  const b: AdminPeriod = o.previous;
  const name = periodName(o.days);
  return [
    tile({ label: "Visitors", value: count(p.visits), note: `${count(p.guestVisits)} as guests (${share(p.guestVisits, p.visits)}), counted once a day`, delta: { now: p.visits, before: b.visits }, hero: true }, name),
    tile({ label: "Sign-ups", value: count(p.signups), note: p.converted ? `${count(p.converted)} signed up the day they first came` : undefined, delta: { now: p.signups, before: b.signups } }, name),
    tile({ label: "Guests who signed up", value: share(p.converted, p.guestVisits + p.converted), note: "of guests, the same day" }, name),
    tile({ label: "Members who came", value: count(p.activeMembers), note: `of ${count(o.accounts.total)} accounts`, delta: { now: p.activeMembers, before: b.activeMembers } }, name),
    tile({ label: "Typical visit", value: minutes(p.medianMinutes), note: "the middle visit's length", delta: { now: p.medianMinutes, before: b.medianMinutes } }, name),
    tile({ label: "Drawings opened", value: count(p.opens), delta: { now: p.opens, before: b.opens } }, name),
  ];
}

function moneySection(o: AdminOverview): HTMLElement | null {
  const m = o.money;
  const cur = o.currency;
  if (!m || !cur) return null;
  const name = periodName(o.days);
  const used = m.agents + m.renders;
  // what using it cost, in the credit's currency at the rate the server charges by, is unknown
  // here; the providers' dollars are shown as they are
  return h(
    "div",
    { cls: "adm-section" },
    h("h2", { cls: "adm-section-title", text: "AI credit" }),
    h(
      "div",
      { cls: "adm-tiles" },
      tile({ label: "Owed in credit", value: money(m.owed, cur), note: "every balance left: the model provider's balance must cover it" }, name),
      tile({ label: "Bought", value: money(m.topups, cur), note: "top-ups through Stripe" }, name),
      tile({ label: "Given", value: money(m.granted, cur), note: "by admins and welcome credit" }, name),
      tile({ label: "Used", value: money(used, cur), note: `${money(m.agents, cur)} agents · ${money(m.renders, cur)} renders` }, name),
      tile({ label: "Provider cost", value: usd(m.providerUsd), note: "what the model and GPU providers charged for that use" }, name),
    ),
    lineChart(
      "Credit a day",
      null,
      points(o, ["topups", "usage"]),
      [
        { key: "topups", label: "Bought", color: "var(--series-1)" },
        { key: "usage", label: "Used", color: "var(--series-2)" },
      ],
      (n) => money(n, cur),
    ),
  );
}

function lists(o: AdminOverview): HTMLElement {
  const b = o.breakdowns;
  const named = (map: Record<string, string>) => (t: Tally) => map[t.label] ?? t.label;
  return h(
    "div",
    { cls: "adm-lists" },
    barList("Came from", b.referrers, undefined, "No other site has sent anyone yet"),
    barList("How they arrived", b.entries, named(ENTRY_LABEL)),
    barList("Countries", b.countries, (t) => country(t.label)),
    barList("Devices", b.devices, named(DEVICE_LABEL)),
    barList("Browsers", b.browsers),
    barList("Systems", b.systems),
    barList("Drawings opened", b.formats, (t) => (t.label === "blank" ? "New drawing" : `.${t.label}`)),
    barList("After a file came in", b.checks, named(CHECK_LABEL), "Nobody has been asked yet"),
    barList("Campaigns", b.campaigns, undefined, "Tag a link with ?ref=name to see it here"),
  );
}

function inbox(o: AdminOverview): HTMLElement {
  const link = (text: string, href: string, n: number, what: string): HTMLElement =>
    h("a", { cls: n > 0 ? "adm-inbox-item busy" : "adm-inbox-item", attrs: { href } }, h("strong", { text: String(n) }), ` ${what}`, h("span", { cls: "adm-inbox-go", text: text }));
  return h(
    "div",
    { cls: "adm-inbox" },
    link("Open feedback", "#feedback", o.inbox.feedback, o.inbox.feedback === 1 ? "new bug report or idea" : "new bug reports and ideas"),
    link("Open errors", "#errors", o.inbox.errors, o.inbox.errors === 1 ? "error in the last day" : "errors in the last day"),
  );
}

/** The Overview tab: the live card (which keeps itself up to date), then the period's numbers, fetched again each minute. */
export function overviewTab(ctx: AdminContext): HTMLElement {
  return h(
    "div",
    { cls: "adm-overview" },
    liveCard(ctx),
    loaded(ctx.signal, () => adminApi.overview(ctx.days), overviewView, { refresh: REFRESH_MS, onLoad: () => ctx.updated(updatedNow()) }),
  );
}

/** The Overview's numbers for `o`. */
export function overviewView(o: AdminOverview): HTMLElement {
  const a = o.accounts;
  return h(
    "div",
    { cls: "adm-overview-body" },
    h("div", { cls: "adm-tiles" }, ...visitorTiles(o)),
    h(
      "div",
      { cls: "adm-charts" },
      columnChart(
        "Visitors a day",
        "A visitor is counted once a day; signed in means at any point that day.",
        points(o, ["guests", "members"]),
        [
          { key: "guests", label: "Guests", color: "var(--series-1)" },
          { key: "members", label: "Signed in", color: "var(--series-2)" },
        ],
        (n) => count(Math.round(n)),
      ),
      columnChart("Sign-ups a day", null, points(o, ["signups"]), [{ key: "signups", label: "Sign-ups", color: "var(--series-1)" }], (n) => count(Math.round(n))),
    ),
    signInSection(o),
    h(
      "div",
      { cls: "adm-section" },
      h("h2", { cls: "adm-section-title", text: "Accounts" }),
      h(
        "div",
        { cls: "adm-tiles" },
        tile({ label: "Accounts", value: count(a.total), note: a.suspended ? `${a.suspended} suspended` : undefined }, ""),
        tile({ label: "Rodeo Plus", value: count(a.plus), note: `${a.plusPaid} paying, ${a.plus - a.plusPaid} given` }, ""),
        tile({ label: "Cloud drawings", value: count(a.files), note: `${bytes(a.bytes)} with every version` }, ""),
      ),
      inbox(o),
    ),
    moneySection(o),
    h("div", { cls: "adm-section" }, h("h2", { cls: "adm-section-title", text: "Where visitors come from" }), lists(o)),
  );
}
