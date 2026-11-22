// The page-to-shell API of the desktop app (desktop/), defined once here.
//
// In a browser there is no shell and shell() is null: the editor then reads and writes files
// through the browser, as it always has. In the desktop app the shell sets window.__rodeoShell
// before any of the page's scripts run, and the editor reads, writes and lists files through it.
//
// The whole API is two functions (ShellWire): call a named command, and listen for a named event.
// The commands are listed in ShellCommands below and nowhere else; a shell implements exactly
// those names and refuses any other. Another shell (or another backend of the same one) is a
// second implementation of this file's commands, with nothing in the editor to change.
//
// What a shell must never give the page: a path it can use, a way to run a program, or a way to
// read a file the user did not choose. A file is named by an id the shell made up when the user
// chose the file (a dialog, a drop, a double click in the file manager, the recent list); the
// shell keeps the path. Kept copies (crash recovery) live in one folder of the shell's own, under
// plain names.

/** A file the user chose, as the shell names it. */
export interface ShellFile {
  /** the shell's name for the file, good until the app quits; never a path */
  readonly id: string;
  /** the file's own name, with its extension */
  readonly name: string;
  readonly size: number;
  /** when it was last written, ms since the epoch */
  readonly modified: number;
  /** the folder it is in, to show beside its name (never used to reach it) */
  readonly folder: string;
}

/** A file on the recent list. */
export interface ShellRecent extends ShellFile {
  /** when it was last opened or saved here, ms since the epoch */
  readonly openedAt: number;
  /** false when the file is no longer where it was */
  readonly exists: boolean;
}

/** A kept copy in the shell's recovery folder. */
export interface ShellKept {
  readonly name: string;
  readonly size: number;
  readonly modified: number;
}

export interface ShellFilter {
  /** what the dialog calls these files, e.g. "Vectorworks drawing" */
  readonly name: string;
  /** without dots, lower case: ["vwx", "sta"] */
  readonly extensions: readonly string[];
}

export interface ShellInfo {
  /** which shell this is: "tauri", "electron", … */
  readonly shell: string;
  /** the desktop app's version, "0.1.0" */
  readonly version: string;
  readonly os: "macos" | "windows" | "linux";
  readonly arch: string;
}

/**
 * Every command a shell answers: its name, what it takes and what it gives back.
 * A command that takes `bytes` is sent them as the call's body; one that returns Uint8Array
 * answers with raw bytes. Everything else is JSON.
 */
export interface ShellCommands {
  shell_info: { args: Record<string, never>; result: ShellInfo };

  /** The Open dialog. Empty when cancelled. */
  file_pick_open: { args: { filters: readonly ShellFilter[]; multiple: boolean }; result: ShellFile[] };
  /** The Save dialog. Null when cancelled. The file need not exist yet (size 0, modified 0). */
  file_pick_save: { args: { suggestedName: string; filters: readonly ShellFilter[] }; result: ShellFile | null };
  /** The file as it is now. Fails with "gone" when it is no longer there. */
  file_stat: { args: { id: string }; result: ShellFile };
  /**
   * Bytes start..end of the file. With `modified`, fails with "changed" when the file was written
   * since (the page then asks for the file again rather than read a different file's bytes).
   */
  file_read: { args: { id: string; start: number; end: number; modified?: number }; result: Uint8Array };
  /** Starts writing the file anew, beside it; the file itself is untouched until write_end commits. */
  file_write_begin: { args: { id: string }; result: { write: string } };
  /** Shows the file in the file manager. */
  file_reveal: { args: { id: string }; result: null };

  /** The next bytes of a write, or with `at` bytes written over what is there (the header, once sizes are known). */
  write_chunk: { args: { write: string; at?: number }; bytes: Uint8Array; result: null };
  /** Ends a write: `commit` puts it in the file's place in one step, otherwise it is thrown away. */
  write_end: { args: { write: string; commit: boolean }; result: { size: number; modified: number } | null };

  /** Files the app was started with, or was handed before the page was ready; each is given once. */
  pending_take: { args: Record<string, never>; result: ShellFile[] };

  recent_list: { args: Record<string, never>; result: ShellRecent[] };
  recent_add: { args: { id: string }; result: null };
  recent_remove: { args: { id: string }; result: null };
  recent_clear: { args: Record<string, never>; result: null };

  /** Kept copies: crash recovery, on disk in the shell's own folder. Names are [A-Za-z0-9._-], 1 to 120 long. */
  kept_list: { args: Record<string, never>; result: ShellKept[] };
  kept_read: { args: { name: string; start: number; end: number }; result: Uint8Array };
  kept_write_begin: { args: { name: string }; result: { write: string } };
  kept_remove: { args: { name: string }; result: null };

  /** The window's title, and whether it holds unsaved changes (the dot in a Mac's close button). */
  window_state: { args: { title: string; edited: boolean }; result: null };
  /** Closes the window; the page calls it once it has dealt with unsaved changes (see the "close" event). */
  window_close: { args: Record<string, never>; result: null };

  /** Opens an https: or mailto: link in the system's browser. Anything else is refused. */
  open_external: { args: { url: string }; result: null };
}

/** What the shell tells the page. */
export interface ShellEvents {
  /** files to open: a double click in the file manager, a drop on the window or the app's icon, a second launch */
  open: ShellFile[];
  /** files are being dragged over the window (true) or have left it (false) */
  drag: boolean;
  /** the user asked to close the window; the page answers with window_close when that is fine */
  close: null;
}

export type ShellCommand = keyof ShellCommands;
export type ShellEvent = keyof ShellEvents;

/** What a shell puts at window.__rodeoShell. */
export interface ShellWire {
  call(command: string, args: unknown, bytes?: Uint8Array): Promise<unknown>;
  /** Returns a function that stops listening. */
  on(event: string, handler: (payload: unknown) => void): () => void;
}

/** The shell's errors the page tells apart, as the start of an error's message. */
export const SHELL_GONE = "gone";
export const SHELL_CHANGED = "changed";

type Args<C extends ShellCommand> = ShellCommands[C]["args"];
type Result<C extends ShellCommand> = ShellCommands[C]["result"];
type Bytes<C extends ShellCommand> = ShellCommands[C] extends { bytes: Uint8Array } ? [bytes: Uint8Array] : [];

export interface Shell {
  call<C extends ShellCommand>(command: C, args: Args<C>, ...bytes: Bytes<C>): Promise<Result<C>>;
  on<E extends ShellEvent>(event: E, handler: (payload: ShellEvents[E]) => void): () => void;
}

function wire(): ShellWire | null {
  const w = (globalThis as { __rodeoShell?: ShellWire }).__rodeoShell;
  return w && typeof w.call === "function" && typeof w.on === "function" ? w : null;
}

let typed: Shell | null | undefined;

/** The desktop shell, or null in a browser. */
export function shell(): Shell | null {
  if (typed !== undefined) return typed;
  const w = wire();
  typed = w
    ? {
        call: async (command, args, ...bytes) => {
          const out = await w.call(command, args, bytes[0]);
          // raw answers arrive as an ArrayBuffer
          return (out instanceof ArrayBuffer ? new Uint8Array(out) : out) as never;
        },
        on: (event, handler) => w.on(event, handler as (payload: unknown) => void),
      }
    : null;
  return typed;
}

/** Whether the editor is running in the desktop app. */
export function inShell(): boolean {
  return shell() !== null;
}

/** Whether a shell's error says the file is no longer there (`SHELL_GONE`) or was written since (`SHELL_CHANGED`). */
export function shellErrorIs(err: unknown, kind: typeof SHELL_GONE | typeof SHELL_CHANGED): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return message === kind || message.startsWith(`${kind}:`);
}
