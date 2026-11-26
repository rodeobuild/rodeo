// Pages of this browser tell each other when one of them signs in, so a page with a drawing open
// never has to reload to learn it: a provider's sign-in window (public/signed-in.html) and a tab
// opened from an emailed link (index.ts, ?signed-in=1) say so here, and every other page asks the
// server who it is now. Sign-in dialogs close on that, and what waited for the sign-in carries on.

import { toast } from "../../app/toast.ts";
import { currentUser, refreshUser } from "../../platform/api.ts";
import { config } from "./config.ts";

const NAME = "rodeo-auth";
const SIGNED_IN = "signed-in";

function channel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === "function" ? new BroadcastChannel(NAME) : null;
  } catch {
    // no channels here (an old browser, a locked-down frame): pages learn of a sign-in when they next ask
    return null;
  }
}

const out = channel();

/** Tells this browser's other Rodeo pages that someone has just signed in. */
export function announceSignIn(): void {
  try {
    out?.postMessage(SIGNED_IN);
  } catch {
    // a closed channel: the other pages find out when they next ask the server
  }
}

let learning = false;

/** Another page signed in: ask the server who this page is now, and say so (once, though the news may come two ways). */
async function learn(): Promise<void> {
  if (learning || !config() || currentUser()) return;
  learning = true;
  try {
    const user = await refreshUser();
    if (user) toast(`Signed in as ${user.name || user.email}`, "info");
  } finally {
    learning = false;
  }
}

/** Starts listening for a sign-in made in another page of this browser. */
export function watchSignIn(): void {
  // a channel of its own to listen on: a page does not hear what it posts itself
  channel()?.addEventListener("message", (e) => {
    if (e.data === SIGNED_IN) void learn();
  });
  // the sign-in window also tells the page that opened it directly
  window.addEventListener("message", (e) => {
    if (e.origin === location.origin && e.data === "rodeo-signed-in") void learn();
  });
}
