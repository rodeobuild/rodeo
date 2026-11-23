// seo feature: the start hub's footer link to the user guide. The guide is a page on this site
// (rodeo.build/guide), so the link is a plain anchor that search engines follow. Registers with
// app/ext.ts when imported.

import { h } from "../../app/dom.ts";
import { registerWelcome } from "../../app/ext.ts";
import { inShell } from "../../platform/shell.ts";

/** The guide's address: its page on this site, or on rodeo.build when the editor runs from a file or in the desktop app (which has no server of its own). */
function guideUrl(): string {
  if (inShell()) return "https://rodeo.build/guide";
  return location.protocol === "http:" || location.protocol === "https:" ? "/guide" : "https://rodeo.build/guide";
}

registerWelcome(() => h("a", { cls: "hub-link", text: "User guide", attrs: { href: guideUrl(), target: "_blank", rel: "noopener" } }), "foot");
