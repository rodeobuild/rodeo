// What a promise was rejected with, said in a line for an error report when it isn't an Error: a
// string as it is, an Event by its type, anything else by its class and its own keys, with a short
// excerpt of its JSON (cut to a length, and skipped when it can't be made, e.g. a cycle). Never the
// whole object: a report must stay small and must not carry what the object holds.

const EXCERPT_MAX = 200;
const KEYS_MAX = 8;

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The rejection's value as one line: "Rejected with an Event (type: error)", "Rejected with Object (keys: status, body): {\"status\":500}". */
export function describeRejection(reason: unknown): string {
  if (typeof reason === "string") return clip(reason, 300);
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === "function") return "Rejected with a function";
  if (reason === null) return "Rejected with null";
  if (reason === undefined) return "Rejected with undefined";
  if (typeof reason !== "object") return `Rejected with ${typeof reason} ${String(reason)}`;
  if (typeof Event === "function" && reason instanceof Event) return `Rejected with an Event (type: ${reason.type || "unknown"})`;
  const ctor = (Object.getPrototypeOf(reason) as { constructor?: { name?: string } } | null)?.constructor?.name;
  const keys = Object.keys(reason);
  const shown = keys.slice(0, KEYS_MAX).join(", ") + (keys.length > KEYS_MAX ? `, +${keys.length - KEYS_MAX} more` : "");
  let excerpt = "";
  try {
    const json = JSON.stringify(reason);
    if (json !== undefined) excerpt = `: ${clip(json, EXCERPT_MAX)}`;
  } catch {
    excerpt = " (not JSON: a cycle or a value JSON can't hold)";
  }
  const kind = !ctor || ctor === "Object" ? "a plain object" : ctor;
  return `Rejected with ${kind} (keys: ${shown || "none"})${excerpt}`;
}
