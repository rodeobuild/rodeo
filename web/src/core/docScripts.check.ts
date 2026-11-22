// Checks the document-script reader against a drawing that keeps a script in a script palette. Run from web/:
//   npx tsx src/core/docScripts.check.ts path/to/Node_List_v2022.vwx
// With no path it prints a skip line and exits 0. The drawing is the public Ladybug "Node_List" file for
// Vectorworks 2022 (GPL-3.0): two palettes, one with one Python script and one empty.

import { readFileSync } from "node:fs";
import { isVectorscript } from "../features/python/runPy.ts";
import { documentScripts } from "./docScripts.ts";
import { Model } from "./model.ts";

const path = process.argv[2];
if (!path) {
  console.log("docScripts: skipped (no drawing given)");
  process.exit(0);
}

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const model = new Model(new Uint8Array(readFileSync(path)), "check.vwx");
const scripts = documentScripts(model);

check(scripts.length === 1, `${scripts.length} script in the drawing's palettes (1)`);
const [s] = scripts;
check(!!s && s.name.length > 0, "it has its name from the name table");
check(!!s && !!s.palette && s.palette.length > 0, "it sits in a named palette");
check(!!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.id), "its id is a GUID");
check(!!s && s.text.startsWith("#"), "its text starts with a comment line");
check(!!s && s.text.includes("import vs"), "its text contains import vs");
check(!!s && !isVectorscript(s.text, s.name), "the feature's test reads it as Python, not Vectorscript");
check(!!s && s.text.length === 1553, `its text is 1553 characters, as the length field gives (${s?.text.length})`);
check(!!s && !s.text.includes("\r") && s.text.includes("\n"), "its line ends are LF");
check(documentScripts(model) === scripts, "a second call returns the same list (read once per drawing)");

if (failures) {
  console.log(`docScripts: ${failures} check(s) failed`);
  process.exit(1);
}
console.log("docScripts: ok");
