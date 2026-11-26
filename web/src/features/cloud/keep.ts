// Keeping a drawing, offered at the moment it matters: someone not signed in has worked on a
// drawing for a while (some changes made, or some minutes with it open), and a nudge (app/nudge.ts)
// over the drawing offers to save it to the cloud. Taking it asks them to sign in (the drawing
// stays open while they do: account/signin.ts) and then saves it, as File › Save to Cloud… does.
// Offered once a visit; closing it puts it off for a week. Never in an embed or a view-only link,
// and never where the server has no cloud drawings. Its showing, taking and closing are counted
// (app/visits.ts), and a sign-in it leads to is named as its own, for the admin page.

import { documentSource, onDocument } from "../../app/ext.ts";
import { nudge, withdraw, type Nudge } from "../../app/nudge.ts";
import { store } from "../../app/state.ts";
import { countPrompt } from "../../app/visits.ts";
import type { EditSession } from "../../core/index.ts";
import { currentUser, onUser, userLoaded } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { cloudOffered, saveDrawingToCloud } from "./cloud.ts";

/** changes to a drawing before the offer */
const AFTER_CHANGES = 8;
/** or this long with a drawing open */
const AFTER_MS = 4 * 60_000;
/** a pause after the change that brings it, so it does not land in the middle of a stroke */
const SETTLE_MS = 2500;
/** how long closing it puts it off */
const SNOOZE_MS = 7 * 24 * 3600_000;
const SNOOZE_KEY = "openvwx.keep.snoozed";

const ICON = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15.2h8.2a3.2 3.2 0 0 0 .5-6.4 4.5 4.5 0 0 0-8.6 1.1A2.7 2.7 0 0 0 6 15.2z"/><path d="M10 13V9.4M8.4 10.8 10 9.2l1.600 1.600"/></svg>`;

function snoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now();
  } catch {
    // storage blocked: nothing can be put off, so nothing is offered
    return true;
  }
}

function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
  } catch {
    // storage blocked
  }
}

/** Whether the offer applies now: a guest, a drawing of their own open, cloud drawings on offer. */
function applies(): boolean {
  const params = new URLSearchParams(location.search);
  return cloudOffered() && userLoaded() && currentUser() === null && store.session !== null && !isCloudSource(documentSource()) && !params.has("embed") && !params.has("share") && !snoozed();
}

let offered = false;
let offer: Nudge | null = null;

function make(): void {
  if (offered || !applies()) return;
  offered = true;
  offer = {
    art: ICON,
    artKind: "icon",
    title: "Keep this drawing in the cloud",
    text: "A free account saves it online, so you can open it on any device, share a link and go back through its versions.",
    action: "Save to Cloud",
    refuse: "Not now",
    wanted: applies,
    shown: () => countPrompt("keep", "shown"),
    run: () => {
      countPrompt("keep", "taken");
      void saveDrawingToCloud("keep");
    },
    refused: () => {
      countPrompt("keep", "refused");
      snooze();
    },
  };
  nudge(offer);
}

/** Starts watching for the moment: called once, as the cloud feature starts. */
export function watchForKeeping(): void {
  const counts = new WeakMap<EditSession, number>();
  const watched = new WeakSet<EditSession>();
  let timer = 0;
  const watch = (session: EditSession | null): void => {
    window.clearTimeout(timer);
    if (!session || offered) return;
    timer = window.setTimeout(make, AFTER_MS);
    if (watched.has(session)) return;
    watched.add(session);
    session.onChange(() => {
      const n = (counts.get(session) ?? 0) + 1;
      counts.set(session, n);
      if (n === AFTER_CHANGES) window.setTimeout(() => store.session === session && make(), SETTLE_MS);
    });
  };
  onDocument(watch);
  // a drawing opened before the server answered (a quick start) is watched too
  watch(store.session);
  // signed in meanwhile: the offer has nothing left to say
  onUser((user) => {
    if (user && offer) withdraw(offer);
  });
}
