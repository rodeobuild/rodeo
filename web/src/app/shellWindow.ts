// The desktop window (platform/shell.ts): its title, the unsaved mark in its close button, and closing.
// The title is the front drawing's file name ("Rodeo" with nothing open); the mark shows while any
// open drawing has unsaved changes. The shell never closes the window by itself: when the user asks
// to, it sends "close", and the page either closes it or asks first, discarding the unsaved changes
// only when the user says so. In a browser there is no shell, and nothing here runs.

import type { EditSession } from "../core/index.ts";
import { shell } from "../platform/shell.ts";
import { confirmDialog } from "./menubar.ts";

export interface ShellWindowDeps {
  /** The front drawing's file name, or null with nothing open. */
  title(): string | null;
  /** The sessions of every open drawing. */
  sessions(): readonly EditSession[];
  /** Forgets a drawing's autosave copy, when its unsaved changes are discarded; resolves once that is done. */
  discard(session: EditSession): Promise<void>;
}

/** How often the title and the unsaved mark are looked at. Only a change is sent to the shell. */
const CHECK_MS = 500;

/** Keeps the window's title and unsaved mark in step with the drawings, and answers the shell's close. */
export function installShellWindow(deps: ShellWindowDeps): void {
  const sh = shell();
  if (!sh) return;

  let sent = "";
  const push = (): void => {
    const title = deps.title() ?? "Rodeo";
    const edited = deps.sessions().some((s) => s.dirty);
    const state = `${title}\u0000${edited}`;
    if (state === sent) return;
    sent = state;
    sh.call("window_state", { title, edited }).catch((err: unknown) => console.error(err));
  };
  push();
  window.setInterval(push, CHECK_MS);

  let asking = false;
  sh.on("close", () => {
    if (asking) return;
    const dirty = deps.sessions().filter((s) => s.dirty);
    if (dirty.length === 0) {
      sh.call("window_close", {}).catch((err: unknown) => console.error(err));
      return;
    }
    asking = true;
    const count = dirty.length === 1 ? "1 drawing" : `${dirty.length} drawings`;
    void confirmDialog("Unsaved changes", `Close Rodeo and discard unsaved changes to ${count}?`, "Discard and Close")
      .then(async (ok) => {
        if (!ok) return;
        for (const session of dirty) await deps.discard(session);
        await sh.call("window_close", {});
      })
      .catch((err: unknown) => console.error(err))
      .finally(() => {
        asking = false;
      });
  });
}
