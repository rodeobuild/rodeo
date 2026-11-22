// The desktop app's Help menu: Rodeo on the Web, and the update check (update.ts). In a browser it only adds
// the start hub's "Desktop app" footer link (to the app's downloads), on a computer and not in an embed.
// A quiet check runs once, 20 seconds after start, at most one a week, when online and wanted.

import { h } from "../../app/dom.ts";
import { registerMenu, registerWelcome } from "../../app/ext.ts";
import { showDialog } from "../../app/menubar.ts";
import { NEEDS_INTERNET, online } from "../../app/online.ts";
import { openOutside } from "../../app/shellLinks.ts";
import { toast } from "../../app/toast.ts";
import { inShell, shell } from "../../platform/shell.ts";
import { COARSE } from "../touch/layout.ts";
import { CHECK_EVERY_MS, fetchReleases, newestDesktopRelease, saveUpdateState, updateState } from "./update.ts";

const WEB_ADDRESS = "https://rodeo.build";
/** The desktop app's downloads: its releases on GitHub, for the browser's start hub. */
const DESKTOP_RELEASES = "https://github.com/rodeobuild/rodeo/releases?q=desktop-v&expanded=true";
/** How long after start the quiet check waits, so it never touches start-up. */
const QUIET_CHECK_DELAY_MS = 20_000;

/** The running version, from the shell; null when the shell can't say. */
async function currentVersion(): Promise<string | null> {
  const s = shell();
  if (!s) return null;
  try {
    return (await s.call("shell_info", {})).version;
  } catch {
    return null;
  }
}

/** Help > Check for Updates…: says what it found, and offers the download page when there is a newer version. */
async function checkByHand(): Promise<void> {
  if (!online()) {
    toast(NEEDS_INTERNET, "info");
    return;
  }
  const current = await currentVersion();
  if (current === null) {
    toast("Rodeo couldn't tell which version this is.", "info");
    return;
  }
  const got = await fetchReleases();
  if (got === null) {
    toast("Rodeo couldn't check for updates just now. Try again later.", "info");
    return;
  }
  const newer = newestDesktopRelease(got.list, current);
  if (newer === null) {
    toast(`Rodeo ${current} is the newest version.`, "info");
    return;
  }
  const open = await showDialog<true>({
    title: `Rodeo ${newer.version} is available`,
    okLabel: "Open Download Page",
    cancelLabel: "Not Now",
    body: [h("p", { cls: "menu-dialog-text", text: `You have ${current}. Updating is your choice: this version keeps working.` })],
    check: () => ({ value: true }),
  });
  if (open === true) openOutside(newer.url);
}

/** The start-up check: one toast when a newer version is out, once per version, never a dialog. */
async function quietCheck(): Promise<void> {
  const state = updateState();
  if (!state.auto || !online() || Date.now() - state.checkedAt < CHECK_EVERY_MS) return;
  const current = await currentVersion();
  if (current === null) return;
  saveUpdateState({ checkedAt: Date.now() });
  const got = await fetchReleases();
  if (got === null) return;
  const newer = newestDesktopRelease(got.list, current);
  if (newer === null || newer.version === updateState().offered) return;
  saveUpdateState({ offered: newer.version });
  toast(`Rodeo ${newer.version} is available (Help › Check for Updates…)`, "info");
}

if (inShell()) {
  registerMenu("Help", () => [
    { label: "Rodeo on the Web…", run: () => openOutside(WEB_ADDRESS) },
    { label: "Check for Updates…", run: () => void checkByHand() },
    {
      label: "Check for Updates Automatically",
      checked: () => updateState().auto,
      run: () => saveUpdateState({ auto: !updateState().auto }),
    },
  ]);
  window.setTimeout(() => void quietCheck(), QUIET_CHECK_DELAY_MS);
} else if (!COARSE && !new URLSearchParams(location.search).has("embed")) {
  // a browser on a computer (not a phone or a touch-only device, nor an embed) offers the app's download in the start hub's footer
  registerWelcome(
    () =>
      h("a", {
        cls: "hub-link",
        text: "Desktop app",
        attrs: {
          href: DESKTOP_RELEASES,
          target: "_blank",
          rel: "noopener",
          title: "Rodeo as an app for Mac, Windows and Linux: works with no internet connection",
        },
      }),
    "foot",
  );
}
