// The desktop app's links: an https or mailto link opens in the system's browser, and the editor's window
// never leaves the page. A plain http link is refused with a note, as the shell only opens https. Called
// from main.ts in the desktop app only (inShell()); a browser keeps its own links.

import { h } from "./dom.ts";
import { shell } from "../platform/shell.ts";
import { toast } from "./toast.ts";

/** What a link that the desktop app won't open gets, instead. */
const HTTP_REFUSED = "Rodeo's desktop app only opens https links";

/** The most of one of the app's own files a link shows in a dialog. */
const SHOW_CAP = 1024 * 1024;

/** Hands an https or mailto address to the system's browser. */
export function openOutside(url: string): void {
  void shell()
    ?.call("open_external", { url })
    .catch((err: unknown) => toast(`Rodeo couldn't open that link: ${err instanceof Error ? err.message : String(err)}`));
}

/** The address as a URL, or null when it isn't one. */
function addressOf(raw: string, base: string): URL | null {
  try {
    return new URL(raw, base);
  } catch {
    return null;
  }
}

/** Whether a link leads away from the editor: another origin, which for mailto: is every one. */
function leavesEditor(url: URL): boolean {
  return url.origin !== location.origin;
}

/** Whether a link is one of the app's own files: same origin, and not the editor's page at the app root. */
function isOwnFile(url: URL): boolean {
  if (url.origin !== location.origin) return false;
  const page = url.pathname.replace(/^\//, "");
  return page !== "" && page !== "index.html";
}

/** The last part of a file's address, decoded: "web-ifc.txt". */
function fileNameOf(url: URL): string {
  const last = url.pathname.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last) || "file";
  } catch {
    return last || "file";
  }
}

/** Shows a text in a dialog box of the app's own (the menu-dialog classes), with one Close button. */
function showText(title: string, text: string): void {
  const pre = h("pre", { cls: "shell-text", text, attrs: { tabindex: "0" } });
  pre.style.maxHeight = "60vh";
  pre.style.overflow = "auto";
  pre.style.userSelect = "text";
  const close = h("button", { cls: "btn primary", text: "Close", attrs: { type: "button" } });
  const backdrop = h("div", { cls: "menu-dialog-backdrop" });
  const finish = (): void => backdrop.remove();
  close.addEventListener("click", finish);
  // every key stays inside the dialog, so the window shortcuts do not run under it
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) finish();
  });
  backdrop.append(
    h(
      "div",
      { cls: "menu-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": title } },
      h("h2", { cls: "menu-dialog-title", text: title }),
      pre,
      h("div", { cls: "menu-dialog-actions" }, close),
    ),
  );
  document.body.append(backdrop);
  close.focus();
}

/** Reads one of the app's own files (up to SHOW_CAP) and shows it in a dialog, titled with the link's text. */
async function showOwnFile(url: URL, title: string): Promise<void> {
  const name = fileNameOf(url);
  let text: string;
  try {
    const res = await fetch(url.href);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > SHOW_CAP) throw new Error("the file is too large to show");
    text = new TextDecoder().decode(bytes);
  } catch {
    toast(`Couldn't open ${name}`);
    return;
  }
  showText(title || name, text);
}

function onLinkClick(e: MouseEvent): void {
  // a middle click (auxclick) would open a tab, so it counts as a click on the link too
  if (e.type === "auxclick" && e.button !== 1) return;
  if (!(e.target instanceof Element)) return;
  const a = e.target.closest("a");
  if (!(a instanceof HTMLAnchorElement) || !a.href) return;
  const url = addressOf(a.href, location.href);
  if (!url) return;
  if (!leavesEditor(url)) {
    // a link to one of the app's own files would replace the editor (and the drawing) if followed
    if (isOwnFile(url)) {
      e.preventDefault();
      void showOwnFile(url, a.textContent?.trim() ?? "");
    }
    return;
  }
  if (url.protocol === "https:" || url.protocol === "mailto:") {
    e.preventDefault();
    openOutside(url.href);
    return;
  }
  if (url.protocol === "http:") {
    e.preventDefault();
    toast(HTTP_REFUSED, "info");
  }
}

/**
 * Makes the editor's links open outside it: a capturing click listener for the links on the page, and
 * window.open for https and mailto addresses. Anything else still goes to the browser's own window.open.
 */
export function installShellLinks(): void {
  document.addEventListener("click", onLinkClick, true);
  document.addEventListener("auxclick", onLinkClick, true);

  const original = window.open.bind(window);
  window.open = (url?: string | URL, target?: string, features?: string): WindowProxy | null => {
    const parsed = url === undefined ? null : addressOf(String(url), location.href);
    if (parsed && (parsed.protocol === "https:" || parsed.protocol === "mailto:")) {
      openOutside(parsed.href);
      return null;
    }
    // the shell refuses new windows, so a plain http address would do nothing without a note
    if (parsed?.protocol === "http:") {
      toast(HTTP_REFUSED, "info");
      return null;
    }
    return original(url, target, features);
  };
}
