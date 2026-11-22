// Updates are offered, never required. The page asks GitHub's public releases list (which sends CORS
// headers) for the newest desktop release, and only ever opens that release's page in the browser: no
// update code runs natively, and nothing installs by itself. Pure parts (the version and release rules)
// are checked in update.check.ts.

const RELEASES_API = "https://api.github.com/repos/rodeobuild/rodeo/releases?per_page=30";
/** A release's page must start with this, or the release is refused. */
const RELEASE_PAGES = "https://github.com/rodeobuild/rodeo/releases/";
const DESKTOP_TAG = /^desktop-v(\d+)\.(\d+)\.(\d+)$/;
const PLAIN_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const TIMEOUT_MS = 8000;
/** The start-up check runs at most this often. */
export const CHECK_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const STATE_KEY = "rodeo.desktop.update";

/** A newer desktop release: its version ("0.2.0") and its release page. */
export interface DesktopRelease {
  readonly version: string;
  readonly url: string;
}

/**
 * Compares two versions "x.y.z", number by number: -1 when `a` is older, 0 when they are the same, 1 when
 * `a` is newer. Null when either is not a version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const x = PLAIN_VERSION.exec(a);
  const y = PLAIN_VERSION.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(x[i]) - Number(y[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The newest desktop release in a GitHub releases list (its parsed JSON), when it is newer than `current`;
 * null otherwise. Drafts, prereleases, other tags (cli-v…) and release pages outside the repository are
 * ignored, and a malformed list gives null.
 */
export function newestDesktopRelease(list: unknown, current: string): DesktopRelease | null {
  if (!Array.isArray(list)) return null;
  let best: DesktopRelease | null = null;
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const release = item as Record<string, unknown>;
    if (release.draft === true || release.prerelease === true) continue;
    const tag = typeof release.tag_name === "string" ? DESKTOP_TAG.exec(release.tag_name) : null;
    if (!tag) continue;
    const url = typeof release.html_url === "string" ? release.html_url : "";
    if (!url.startsWith(RELEASE_PAGES)) continue;
    const version = `${tag[1]}.${tag[2]}.${tag[3]}`;
    if (best === null || compareVersions(version, best.version) === 1) best = { version, url };
  }
  if (best === null) return null;
  return compareVersions(best.version, current) === 1 ? best : null;
}

/** The releases list as it came, or null when it could not be had (offline, a rate limit, a bad answer). */
export async function fetchReleases(): Promise<{ readonly list: unknown } | null> {
  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return { list: (await res.json()) as unknown };
  } catch {
    return null;
  }
}

/** The newest desktop release newer than `current`, or null: none, or no answer from GitHub. */
export async function latestDesktop(current: string): Promise<DesktopRelease | null> {
  const got = await fetchReleases();
  return got ? newestDesktopRelease(got.list, current) : null;
}

/** What the update check keeps in this browser: the preference, the last check, and the last version offered. */
export interface UpdateState {
  readonly auto: boolean;
  /** when the last start-up check ran, ms since the epoch (0 for never) */
  readonly checkedAt: number;
  /** the last version a toast offered, so it is offered once */
  readonly offered: string;
}

/** The saved state; the defaults where nothing is saved or storage is blocked. */
export function updateState(): UpdateState {
  const fallback: UpdateState = { auto: true, checkedAt: 0, offered: "" };
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? "null") as Partial<UpdateState> | null;
    if (typeof saved !== "object" || saved === null) return fallback;
    return {
      auto: typeof saved.auto === "boolean" ? saved.auto : true,
      checkedAt: typeof saved.checkedAt === "number" && Number.isFinite(saved.checkedAt) ? saved.checkedAt : 0,
      offered: typeof saved.offered === "string" ? saved.offered : "",
    };
  } catch {
    return fallback;
  }
}

/** Saves some of the state; a blocked store just forgets it. */
export function saveUpdateState(patch: Partial<UpdateState>): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ ...updateState(), ...patch }));
  } catch {
    // storage blocked or full: the choice lasts for this visit
  }
}
