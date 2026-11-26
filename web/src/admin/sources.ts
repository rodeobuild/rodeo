// Where in the editor a sign-in was started (protocol.ts SIGN_IN_SOURCES), in words: for the
// Overview's "What leads to sign-ups" and for an account's facts on the People tab.

const SOURCE_LABEL: Record<string, string> = {
  start: "Start screen: Create a free account",
  "start-header": "Start screen: Sign in button",
  "top-bar": "Sign in in the top bar",
  "layout-bar": "Sign in on a Work Like layout's first row",
  keep: "Save-to-cloud prompt",
  "cloud-save": "File › Save to Cloud",
  "cloud-open": "Open from Cloud",
  link: "A shared drawing or an invitation",
  gallery: "Publishing to the gallery",
  agents: "The Agents panel",
  "ai-render": "AI renders",
  "cloud-render": "Cloud renders",
  voice: "Voice commands",
  "connect-agent": "Connect an Agent",
  plus: "Get Rodeo Plus",
  credit: "Add AI credit",
  site: "Site context: a larger area",
  other: "Elsewhere in the editor",
  "": "Outside the editor, or not recorded",
};

/** The words for a sign-in's source; an account made some other way (null or "") says so. */
export function sourceLabel(source: string | null): string {
  return SOURCE_LABEL[source ?? ""] ?? source ?? "";
}
