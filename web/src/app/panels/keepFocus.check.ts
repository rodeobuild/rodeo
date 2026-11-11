// Checks focusTarget, the pure choice of the control focus returns to after a repaint.
import { focusTarget } from "./keepFocus.ts";

let failed = 0;
function expect(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    failed++;
    console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

const keys = ["x", "y", "w", "h", "class"];

// Enter: the same control, the same place
expect("stays on the same control", focusTarget({ index: 1, key: "y" }, keys, 0), 1);
// Tab commit: the control after it, Shift+Tab the one before
expect("Tab goes to the next", focusTarget({ index: 1, key: "y" }, keys, 1), 2);
expect("Shift+Tab goes to the previous", focusTarget({ index: 1, key: "y" }, keys, -1), 0);
// the last control: Tab leaves the panel, so nothing is taken
expect("Tab from the last leaves", focusTarget({ index: 4, key: "class" }, keys, 1), -1);
expect("Shift+Tab from the first leaves", focusTarget({ index: 0, key: "x" }, keys, -1), -1);
// a repaint that moved the control: the nearest one with its key
expect("nearest same key", focusTarget({ index: 2, key: "y" }, ["x", "w", "y", "y", "h"], 0), 2);
expect("nearest same key, not first", focusTarget({ index: 3, key: "y" }, ["y", "x", "x", "x", "y"], 0), 4);
// no control with its key: the old index, kept in range
expect("key gone, index kept", focusTarget({ index: 1, key: "gone" }, ["a", "b", "c"], 0), 1);
expect("key gone, index past the end", focusTarget({ index: 9, key: "gone" }, ["a", "b", "c"], 0), 2);
// no controls at all
expect("no controls", focusTarget({ index: 0, key: "x" }, [], 1), -1);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("keepFocus checks passed");
