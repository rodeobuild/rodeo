// Autosave keeps a separate copy of every dirty drawing, including background tabs. In a browser
// the copy is kept in the browser's storage; in the desktop app it is kept in the shell's recovery
// folder, streamed from the drawing, so any size is copied there (recovery.ts keeps the copies).
// After edits pause, one drawing per timer tick is copied at the preference's interval (the desktop
// app copies a drawing of 256 MB or more at most every 15 minutes). Saving, undoing to the saved
// state, or explicitly discarding a drawing removes its copy. At startup, copies left by a crash are
// offered back; inactive copies expire after seven days. In a browser, drawings over
// AUTOSAVE_MAX_BYTES or with held parts are excluded because serialization needs another drawing's
// worth of memory. Edit > Preferences (prefs.ts) controls the interval.
import type { EditSession } from "../core/index.ts";
import { shell } from "../platform/shell.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { autosaveLimit, prefs } from "./prefs.ts";
import { type AnyBackup, backupKeys, deleteBackupIfUnchanged, expireBackups, Recovery, withRecovery } from "./recovery.ts";
import { toast } from "./toast.ts";

export interface AutosaveDeps {
  /** Opens a drawing read from its bytes or from a file (a kept copy's file in the desktop app). */
  openDocument(data: Uint8Array | Blob, name: string): Promise<EditSession | null>;
}

export function installAutosave(deps: AutosaveDeps): Recovery {
  const recovery = new Recovery(() => ({
    enabled: prefs().autosave,
    minutes: prefs().autosaveMinutes,
    maxBytes: autosaveLimit(),
  }));
  window.setInterval(() => void recovery.tick(), 15_000);
  if (!new URLSearchParams(location.search).has("embed")) {
    void offerRecovery(deps, recovery).catch(() => {});
  }
  return recovery;
}

/** A copy's drawing as openDocument takes it: its kept file in the desktop app, its bytes in a browser. */
function backupData(b: AnyBackup): Uint8Array | Blob {
  return "file" in b ? b.file : b.bytes;
}

async function offerRecovery(deps: AutosaveDeps, recovery: Recovery): Promise<void> {
  // Includes the legacy "latest" entry; never clears another live window's backups.
  await expireBackups();
  for (const key of await backupKeys()) await withRecovery(key, async (b) => {
    const discard = h("input", { attrs: { type: "checkbox" } });
    const open = await showDialog<true>({
      title: "Recover Drawing",
      okLabel: "Open Copy",
      body: [
        h("p", { cls: "menu-dialog-text", text: `Rodeo kept a copy of "${b.name}" with changes that were not saved (${new Date(b.savedAt).toLocaleString()}).` }),
        h("p", { cls: "muted", text: "Open it, then save it to keep the changes." }),
        h("label", { cls: "menu-dialog-check" }, discard, "Delete the copy"),
      ],
      check: () => ({ value: true }),
    });
    if (open) {
      const session = await deps.openDocument(backupData(b), b.name);
      if (!session) return;
      session.markUnsaved();
      if (shell()) {
        // The drawing may read its big parts from the kept file, so that file is not copied over or
        // removed here: the drawing takes it over, and its next copy replaces it.
        recovery.adopt(session, key);
      } else if (await recovery.copy(session)) {
        // Keep the old backup if the new one cannot commit (quota, close, or a failed open).
        await deleteBackupIfUnchanged(key, b);
      }
      toast(`Opened the kept copy of ${b.name}. Save it to keep its changes.`, "info");
    } else if (discard.checked) await deleteBackupIfUnchanged(key, b);
  });
}
