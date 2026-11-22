// Node check of how the vs module's parts fit together. Run from web/: npx tsx src/features/python/vs/parts.check.ts
//
// The core and the parts share one Python namespace, so a part that names a helper as another does
// replaces it for everyone (a file reader's _convert once broke the 2D conversions). A name may be
// defined at the top level of more than one of them only on purpose (a later part wrapping an earlier
// call): those are listed in REPLACED, each with the part that has the last word.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { VS_CORE_SOURCE } from "../vsModule.ts";
import { VS_PART_NAMES, VS_PARTS } from "./index.ts";

/** Names a later part defines again on purpose, and the part whose definition stands. */
const REPLACED: Readonly<Record<string, string>> = JSON.parse(process.env.VS_REPLACED ?? "null") ?? {
  // records wraps the core's _add so that NameObject names the next object made
  _add: "records",
  GetPluginString: "strings",
  GetName: "worksheets",
  GetTypeN: "worksheets",
  GetType: "worksheets",
  GetObject: "worksheets",
  GetParent: "records",
  SetRField: "records",
  Symbol: "records",
  SetActSymbol: "records",
};

const LIST = `
import ast, json, sys
out = {}
for name, src in json.load(sys.stdin):
    names = []
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
            names.append(node.name)
        elif isinstance(node, ast.Assign):
            names.extend(t.id for t in node.targets if isinstance(t, ast.Name))
    out[name] = names
print(json.dumps(out))
`;

const sources: [string, string][] = [["core", VS_CORE_SOURCE], ...VS_PARTS.map((src, i): [string, string] => [VS_PART_NAMES[i], src])];
const defined = JSON.parse(execFileSync("python3", ["-I", "-c", LIST], { input: JSON.stringify(sources), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })) as Record<string, string[]>;

const owners = new Map<string, string[]>();
for (const [part, names] of Object.entries(defined)) {
  for (const n of new Set(names)) owners.set(n, [...(owners.get(n) ?? []), part]);
}
const problems: string[] = [];
for (const [name, parts] of owners) {
  if (parts.length < 2) continue;
  // _n is the loop variable of the "for _n in (...)" blocks that define several calls at once, deleted after
  if (name === "_n") continue;
  if (REPLACED[name] !== parts[parts.length - 1]) problems.push(`${name} is defined in ${parts.join(" and ")} (the last stands): list it in REPLACED if that is meant`);
}
assert.deepEqual(problems, [], problems.join("\n"));
for (const [name, part] of Object.entries(REPLACED)) assert.ok((owners.get(name) ?? []).at(-1) === part, `${name} is no longer defined last by ${part}`);
console.log(`vs parts: ok (${owners.size} names in ${sources.length} sources)`);
