// Checks that the page is not in the desktop shell when no shell is installed: shell() is null,
// inShell() is false, and shellErrorIs reads the shell's two error kinds from messages. Under Node.
// Run from web/: npx tsx src/platform/shell.check.ts
import { inShell, SHELL_CHANGED, SHELL_GONE, shell, shellErrorIs } from "./shell.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// no __rodeoShell on globalThis in this run
check(!("__rodeoShell" in globalThis), "no shell is installed in this run");
check(shell() === null, "shell() is null in a browser");
check(inShell() === false, "inShell() is false in a browser");

check(shellErrorIs(new Error("gone"), SHELL_GONE), '"gone" is the gone error');
check(shellErrorIs(new Error("gone: /some/detail"), SHELL_GONE), '"gone:" with a detail is the gone error');
check(!shellErrorIs(new Error("changed"), SHELL_GONE), '"changed" is not the gone error');
check(shellErrorIs("changed", SHELL_CHANGED), "a bare string can be the changed error");
check(!shellErrorIs(new Error("goneness"), SHELL_GONE), '"goneness" is not the gone error');

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all shell checks passed");
