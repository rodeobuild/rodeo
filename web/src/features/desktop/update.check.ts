// Checks the desktop update rules (update.ts): version comparison, which releases count, the links
// accepted, and malformed answers, all on fixed data (no network). Under Node.
//
//   cd web && npx tsx src/features/desktop/update.check.ts

import { compareVersions, newestDesktopRelease } from "./update.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// version comparison, number by number
check(compareVersions("0.9.9", "0.10.0") === -1, "0.9.9 is older than 0.10.0 (not a string comparison)");
check(compareVersions("0.10.0", "0.9.9") === 1, "0.10.0 is newer than 0.9.9");
check(compareVersions("1.2.3", "1.2.3") === 0, "equal versions compare equal");
check(compareVersions("1.2.2", "1.2.3") === -1, "a lower patch is older");
check(compareVersions("2.0.0", "1.99.99") === 1, "a higher major is newer");
check(compareVersions("1.2", "1.2.3") === null, "a two-part version is not a version");
check(compareVersions("v1.2.3", "1.2.3") === null, "a version with a v is not a version");

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/rodeobuild/rodeo/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

// the newest desktop release newer than the one running
const list = [release("cli-v9.9.9"), release("desktop-v0.1.0"), release("desktop-v0.10.0"), release("desktop-v0.9.9")];
const pick = newestDesktopRelease(list, "0.9.0");
check(pick?.version === "0.10.0", "picks 0.10.0 over 0.9.9 and ignores cli-v9.9.9");
check(pick?.url === "https://github.com/rodeobuild/rodeo/releases/tag/desktop-v0.10.0", "returns the release's own page");
check(newestDesktopRelease(list, "0.10.0") === null, "nothing newer than the running version gives null");
check(newestDesktopRelease(list, "0.10.1") === null, "a running version past every release gives null");

// drafts and prereleases do not count
check(newestDesktopRelease([release("desktop-v0.5.0", { draft: true })], "0.1.0") === null, "a draft is ignored");
check(newestDesktopRelease([release("desktop-v0.5.0", { prerelease: true })], "0.1.0") === null, "a prerelease is ignored");
check(
  newestDesktopRelease([release("desktop-v0.5.0", { draft: true }), release("desktop-v0.4.0")], "0.1.0")?.version === "0.4.0",
  "a draft is skipped for the next release",
);

// other tags are ignored
check(newestDesktopRelease([release("cli-v9.9.9"), release("v3.0.0"), release("desktop-v1.0")], "0.1.0") === null, "other tags are ignored");

// a page outside the repository's releases is refused
const foreign = { tag_name: "desktop-v7.0.0", html_url: "https://example.com/rodeo/releases/tag/desktop-v7.0.0", draft: false, prerelease: false };
check(newestDesktopRelease([foreign], "0.1.0") === null, "a release page on another site is refused");
const sneaky = { tag_name: "desktop-v7.0.0", html_url: "https://github.com/someone/rodeo/releases/tag/desktop-v7.0.0", draft: false, prerelease: false };
check(newestDesktopRelease([sneaky], "0.1.0") === null, "a release page in another repository is refused");
check(newestDesktopRelease([foreign, release("desktop-v0.2.0")], "0.1.0")?.version === "0.2.0", "a refused page leaves the others");

// malformed answers
check(newestDesktopRelease(null, "0.1.0") === null, "null answer gives null");
check(newestDesktopRelease({ message: "API rate limit exceeded" }, "0.1.0") === null, "an error object gives null");
check(newestDesktopRelease([null, 42, "desktop-v9.0.0", { tag_name: 7 }], "0.1.0") === null, "malformed entries are skipped");
check(newestDesktopRelease([release("desktop-v0.2.0")], "not a version") === null, "a bad running version gives null");

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
