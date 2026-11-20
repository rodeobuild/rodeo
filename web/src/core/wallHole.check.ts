// Checks the wall hole groups of a door or window (tagged "gchw" and "ggcw") under Node: which
// records count as one, and that a plug-in or symbol holding one gives it no 3D. Built from
// hand-made records, so nothing is read from a drawing. Run from web/:
//   npx tsx src/core/wallHole.check.ts

import { isWallHoleGroup, objectTriangles } from "./model3d.ts";
import { Rec } from "./records.ts";
import type { Model } from "./model.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

/** a record of `type` whose 4-char tag sits where aux records keep theirs (byte 0x50), or untagged */
function record(type: number, tag: string | null, children: Rec[] = []): Rec {
  const data = new Uint8Array(0x60);
  data[0x19] = type;
  if (tag !== null) for (let i = 0; i < 4; i++) data[0x50 + i] = tag.charCodeAt(i);
  const r = new Rec(data);
  r.children = children;
  for (const c of children) c.parent = r;
  return r;
}
/** the parts of a document that a plug-in or symbol's walk asks for: none of them is a design-layer viewport or a named plug-in */
const doc = { dlvpShows: () => null, pluginName: () => "" } as unknown as Model;

/** a group of `type` 11 holding one aux record tagged `tag`, plus `kids` */
const groupTagged = (tag: string | null, kids: Rec[] = []): Rec => record(11, null, [record(76, tag), ...kids]);

console.log("which groups are wall holes");
check(isWallHoleGroup(groupTagged("gchw")), "a group tagged gchw is a wall hole group");
check(isWallHoleGroup(groupTagged("ggcw")), "a group tagged ggcw is a wall hole group");
check(!isWallHoleGroup(groupTagged("gorp")), "a profile group (gorp) is not one");
check(!isWallHoleGroup(groupTagged("gles")), "a selection group (gles) is not one");
check(!isWallHoleGroup(groupTagged("gtap")), "a path group (gtap) is not one");
check(!isWallHoleGroup(groupTagged(null)), "an untagged group is not one");
check(!isWallHoleGroup(record(24, "gchw")), "a tag on a record that is not a group does not make a wall hole group");

console.log("3D of a plug-in holding wall hole groups");
{
  // a door's plug-in with only its wall hole groups: nothing in it is 3D
  const door = record(86, null, [groupTagged("gchw"), groupTagged("ggcw")]);
  const holes = objectTriangles(doc, door);
  check(holes.length === 0, "a plug-in whose groups are wall holes gives no triangles");
  // the same plug-in with a wall hole group in a symbol definition's group
  const symbol = record(16, null, [groupTagged("gchw")]);
  check(objectTriangles(doc, symbol).length === 0, "a symbol definition's wall hole group gives no triangles");
}
console.log(failures ? `${failures} failed` : "all ok");
process.exitCode = failures ? 1 : 0;
