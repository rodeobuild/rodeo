// Node check of the plug-in string resources (vs/strings.ts): GetVWRString over a .vwr folder and a .vwr
// zip in a temporary plug-in folder, and the two calls Rodeo can't give. Run from web/:
// npx tsx src/features/python/vs/strings.check.ts

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { blankSnapshot, runVs } from "../vsCheck.ts";

const root = mkdtempSync(join(tmpdir(), "rodeo-vwr-"));
try {
  // a folder .vwr: UTF-16 with a byte order mark (comments, escaped quotes, a newline escape, a block comment)
  const folder = join(root, "Demo.vwr", "Strings");
  mkdirSync(folder, { recursive: true });
  const demo = [
    `// the title and the labels`,
    `"title" = "Demo \\"Plug-in\\"";`,
    `"plain" = "Plain text";  // a trailing comment`,
    `"line" = "two\\nlines";`,
    `/* a block comment with "quotes" = "in" it */`,
    ``,
  ].join("\r\n");
  writeFileSync(join(folder, "Demo.vwstrings"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(demo, "utf16le")]));

  // a second file in the same folder, UTF-8 with a byte order mark, named with spaces and a number
  writeFileSync(join(folder, "Other 11002 Dialog.vwstrings"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`"title" = "Dialog title";\n"ok" = "OK";\n`, "utf8")]));

  // a zipped .vwr inside a sub folder, UTF-8, found at any depth
  const zipSource = join(root, "zipsource", "Strings");
  mkdirSync(zipSource, { recursive: true });
  writeFileSync(join(zipSource, "Zipped.vwstrings"), `"title" = "From a zip";\n"ok" = "Zip OK";\n`, "utf8");
  mkdirSync(join(root, "Sub"), { recursive: true });
  execFileSync("python3", [
    "-c",
    "import sys, zipfile, os\nz = zipfile.ZipFile(sys.argv[1], 'w')\nz.write(sys.argv[2], 'Strings/Zipped.vwstrings')\nz.close()",
    join(root, "Sub", "Zipped.vwr"),
    join(zipSource, "Zipped.vwstrings"),
  ]);
} catch (e) {
  rmSync(root, { recursive: true, force: true });
  throw e;
}

/** A script that points the vs module at the temporary plug-in folder, then runs the lines. */
function withRoot(body: string): string {
  return `import vs\nvs._PLUGIN_DIR = ${JSON.stringify(root)}\n${body}\n`;
}

/** Each lookup as a Python call's result: a JSON list, read from the printed line. */
function lookups(pairs: readonly (readonly [string, string])[]): string[] {
  const calls = pairs.map(([res, key]) => `vs.GetVWRString(${JSON.stringify(res)}, ${JSON.stringify(key)})`).join(", ");
  const r = runVs(withRoot(`import json\nprint(json.dumps([${calls}]))`), { file: "lookups.py", snapshot: blankSnapshot() });
  assert.equal(r.error, null, r.error?.message ?? "");
  return JSON.parse(r.printed.trim().split("\n").pop() ?? "[]") as string[];
}

// a folder .vwr: the key is read in UTF-16, with its escapes, comments and a newline
assert.deepEqual(lookups([["Demo/Strings/Demo", "title"]]), ['Demo "Plug-in"']);
assert.deepEqual(lookups([["Demo/Strings/Demo.vwstrings", "plain"]]), ["Plain text"], "the .vwstrings extension is optional");
assert.deepEqual(lookups([["Demo/Strings/Demo", "line"]]), ["two\nlines"]);

// the .vwr extension on the first part is optional, and names match in any case
assert.deepEqual(lookups([["Demo.vwr/Strings/Demo", "title"]]), ['Demo "Plug-in"']);
assert.deepEqual(lookups([["DEMO/strings/demo", "plain"]]), ["Plain text"], "names match in any case");

// a key matches exactly first, then in any case
assert.deepEqual(lookups([["Demo/Strings/Demo", "TITLE"]]), ['Demo "Plug-in"']);

// the block comment's quotes aren't keys
assert.deepEqual(lookups([["Demo/Strings/Demo", "in"]]), [""]);

// a file name with * matches any part of it; the first file with the key answers
assert.deepEqual(lookups([["Demo/Strings/Other 1* Dialog", "title"]]), ["Dialog title"]);
assert.deepEqual(lookups([["Demo/Strings/Other*", "ok"]]), ["OK"]);
assert.deepEqual(lookups([["Demo/Strings/*", "title"]]), ['Demo "Plug-in"'], "the first file in order with the key");

// a zipped .vwr, found in a sub folder, with a UTF-8 byte order mark
assert.deepEqual(lookups([["Zipped/Strings/Zipped", "title"], ["Zipped/Strings/Zipped", "ok"]]), ["From a zip", "Zip OK"]);

// misses: a missing key, a missing file, a missing bundle, a bundle with no file, and an empty name
assert.deepEqual(lookups([["Demo/Strings/Demo", "nope"]]), [""]);
assert.deepEqual(lookups([["Demo/Strings/Missing", "title"]]), [""]);
assert.deepEqual(lookups([["Missing/Strings/Demo", "title"]]), [""]);
assert.deepEqual(lookups([["Demo", "title"]]), [""]);
assert.deepEqual(lookups([["", "title"]]), [""]);
assert.deepEqual(lookups([["Demo/Other/Demo", "title"]]), [""], "the folder inside the .vwr must match");

// Vectorscript: the by-reference output is the first argument; the Python call returns the string (the run's
// plug-in folder holds the .vwr, as a run from the editor would)
{
  const r = runVs(
    `PROCEDURE ShowStrings;
VAR
   text : STRING;
BEGIN
   GetVWRString(text, 'Demo/Strings/Demo', 'plain');
   Message(text);
END;

RUN(ShowStrings);
`,
    {
      file: "strings.vs",
      snapshot: blankSnapshot(),
      // the run's plug-in folder is a temporary one the check fills: the same UTF-16 file, as bytes
      modules: { "Demo.vwr/Strings/Demo.vwstrings": "base64:" + readFileSync(join(root, "Demo.vwr", "Strings", "Demo.vwstrings")).toString("base64") },
    },
  );
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.deepEqual(r.messages, ["Plain text"]);
}

// a plug-in's own numbered strings: "" when its .vwr has none (as before this part), and never an error
{
  const r = runVs(withRoot(`print(repr(vs.GetPluginString(3001)))`), { file: "plugin-string.py", snapshot: blankSnapshot() });
  assert.equal(r.error, null, r.error?.message ?? "");
  assert.equal(r.printed.trim(), "''");
}
// a resource string list can't be given: a clear refusal, not a silent blank
{
  const r = runVs(withRoot(`vs.GetResourceString(11000, 10)`), { file: "resource-string.py", snapshot: blankSnapshot() });
  assert.equal(r.error?.name, "NotImplementedError");
  assert.ok((r.error?.message ?? "").includes("vs.GetResourceString isn't available in Rodeo yet"), r.error?.message);
}

rmSync(root, { recursive: true, force: true });
console.log("vs plug-in string resources: ok");
