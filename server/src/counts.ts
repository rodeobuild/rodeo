// Counts a day: how many times something happened on a day (UTC), by name, with nothing about who.
// The editor's visits use them (visits.ts: page loads, drawings opened by kind, the file check's
// answers, the prompts' steps, sign-ins opened and started) and so does signing in (auth.ts:
// sign-ins by people who already had an account, by where they started). The admin page reads
// them (admin.ts). Housekeeping drops old days with the visits (visits.ts pruneVisits).

import { run } from "./db.ts";
import { nowIso } from "./util.ts";

/** Adds one to `name` on `day` (YYYY-MM-DD). */
export function bump(day: string, name: string): void {
  run("INSERT INTO visit_counts (day, name, count) VALUES (?, ?, 1) ON CONFLICT(day, name) DO UPDATE SET count = count + 1", day, name);
}

/** Adds one to `name` today. */
export function bumpToday(name: string): void {
  bump(nowIso().slice(0, 10), name);
}
