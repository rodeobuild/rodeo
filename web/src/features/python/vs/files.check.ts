// Node check of the file and folder calls (vs/files.ts, filesSteps.ts): folders, the plug-in's own
// files, the editor's file picker answered by the check, what a run writes and hands back, the
// reading and writing of text files, and {$INCLUDE} of a plug-in's file. Run from web/:
// npx tsx src/features/python/vs/files.check.ts

import assert from "node:assert/strict";
import { blankSnapshot, ranVs, runVs, type VsOutcome } from "../vsCheck.ts";

const b64 = (text: string): string => Buffer.from(text, "utf8").toString("base64");

function messages(r: VsOutcome): string[] {
  return Array.isArray(r.messages) ? (r.messages as string[]) : [];
}

/** The files a run handed back, by name, as text. */
function handed(r: VsOutcome): Map<string, string> {
  const files = (r.files ?? []) as { name: string; base64: string }[];
  return new Map(files.map((f) => [f.name, Buffer.from(f.base64, "base64").toString("utf8")]));
}

// ---- folders -------------------------------------------------------------------------------------

{
  const r = ranVs(
    `import os
vs.Message(vs.GetFolderPath(-13).endswith("/"))
vs.Message(os.path.exists(os.path.join(vs.GetFolderPath(-13), "marker.txt")))
vs.Message(vs.GetFolderPath(2) == vs.GetFolderPath(-2) == vs.GetFolderPath(5))
vs.Message(os.path.isdir(vs.GetFolderPath(-15)))
vs.Message(vs.GetFolderPath(-15).endswith("/folders/-15/"))
vs.Message(vs.GetFolderPath(-15) == vs.GetFolderPath(-15))
vs.Message(vs.CreateFolder("made/deeper"))
vs.Message(os.path.isdir(vs.GetFolderPath(-15).replace("folders/-15", "out/made/deeper")))
`,
    { modules: { "marker.txt": "x" } },
  );
  assert.deepEqual(messages(r), ["True", "True", "True", "True", "True", "True", "True", "True"]);
  assert.deepEqual(handed(r).get("marker.txt"), undefined);
}

// ---- finding a plug-in's file, and importing its modules --------------------------------------------

{
  const r = ranVs(
    `import sys
vs.Message(vs.GetFolderPath(-13) is not None)
ok, folder = vs.FindFileInPluginFolder("CONFIG.JSON")
vs.Message(ok)
vs.Message(folder.endswith("pkg/"))
missing, nothing = vs.FindFileInPluginFolder("missing.txt")
vs.Message(missing)
vs.Message(repr(nothing))
found, path = vs.FindFile(-13, "pkg/config.json")
vs.Message(found)
vs.Message(path.endswith("pkg/config.json"))
sys.path.append(vs.GetFolderPath(-13))
from helper import shapes
vs.Message(shapes.size())
import json, os
with open(os.path.join(vs.GetFolderPath(-13), "pkg", "config.json")) as f:
    vs.Message(json.load(f)["width"])
`,
    {
      modules: {
        "pkg/config.json": '{"width": 4}',
        "helper/__init__.py": "",
        "helper/shapes.py": "def size():\n    return 7\n",
      },
    },
  );
  assert.deepEqual(messages(r), ["True", "True", "True", "False", "''", "True", "True", "7", "4"]);
}

// ---- the editor's file picker, answered by the check ------------------------------------------------

{
  const r = ranVs(
    `p = vs.GetFile()
vs.Message(open(p).readline().strip())
vs.Message(vs.DidCancel())
`,
    { answers: { OpenFile: [{ name: "notes.txt", base64: b64("first line\nsecond\n") }] } },
  );
  assert.deepEqual(messages(r), ["first line", "False"]);
  assert.equal(r.asked[0]?.[0], "OpenFile");
}
{
  const r = ranVs(
    `ok, p = vs.GetFileN("Pick a text file", "", "txt")
vs.Message(ok)
vs.Message(repr(p))
vs.Message(vs.DidCancel())
`,
    { answers: { OpenFile: [null] } },
  );
  assert.deepEqual(messages(r), ["False", "''", "True"]);
  assert.deepEqual(r.asked[0]?.[1], ["Pick a text file", "txt"]);
}
{
  // Vectorscript's VAR spelling: GetFileN's fileName comes back as a variable, GetFile's too
  const r = ranVs(
    `PROCEDURE Main;
VAR ok : BOOLEAN; name : STRING;
BEGIN
  ok := GetFileN('Pick', '', 'txt', name);
  Message(ok);
  Message(name);
  GetFile(name);
  Message(name);
END;
RUN(Main);`,
    { file: "pick.vs", answers: { OpenFile: [{ name: "notes.txt", base64: b64("a\n") }, { name: "second.txt", base64: b64("b\n") }] } },
  );
  const m = messages(r);
  assert.equal(m[0], "TRUE");
  assert.ok(m[1]?.endsWith("notes.txt"), `GetFileN gave ${m[1]}`);
  assert.ok(m[2]?.endsWith("second.txt"), `GetFile gave ${m[2]}`);
}
{
  // a file over the limit is refused with a plain sentence, as the script's error
  const big = runVs(`p = vs.GetFile()\n`, { answers: { OpenFile: [{ error: "big.bin is 60 MB. A script can read files up to 50 MB." }] } });
  assert.equal(big.error?.message, "big.bin is 60 MB. A script can read files up to 50 MB.");
}

// ---- writing a file the script hands back ----------------------------------------------------------

{
  const r = ranVs(
    `import os
f = vs.PutFile("Name the file", "untitled.csv")
vs.WriteLn("a", ",", "b")
vs.WriteLn(3, "\t", 2.5)
vs.Write("tail")
vs.Close(f)
vs.Message(os.path.basename(f))
`,
    { answers: { StrDialog: ["report.csv"] } },
  );
  assert.deepEqual(messages(r), ["report.csv"]);
  assert.deepEqual(r.asked[0]?.[1], ["Name the file", "untitled.csv"]);
  assert.equal(handed(r).get("report.csv"), "a,b\n3\t2.5\ntail");
  assert.equal(r.error, null);
}
{
  // Vectorscript: PutFile's fileName is a variable, and WriteLn writes to the file it opened
  const r = ranVs(
    `PROCEDURE Main;
VAR fname : STRING;
BEGIN
  PutFile('Name the file', 'out.csv', fname);
  WriteLn('x,y');
  Close(fname);
END;
RUN(Main);`,
    { file: "export.vs", answers: { StrDialog: ["out.csv"] } },
  );
  assert.equal(handed(r).get("out.csv"), "x,y\n");
}
{
  // a run that errs hands nothing back
  const r = runVs(
    `f = vs.PutFile("Name", "x.txt")
vs.WriteLn("kept?")
raise ValueError("stop")
`,
    { answers: { StrDialog: ["x.txt"] } },
  );
  assert.equal(r.error?.name, "ValueError");
  assert.equal(r.files, undefined);
}

// ---- reading and writing text files ------------------------------------------------------------------

{
  const r = ranVs(
    `vs.Rewrite("data.txt")
vs.WriteLn(7, "\t", 2.5)
vs.WriteLn("name here")
vs.Close("data.txt")
vs.Append("data.txt")
vs.WriteLn("tail")
vs.Close("data.txt")
vs.Open("data.txt")
a, b = vs.ReadLn(int, float)
vs.Message(a)
vs.Message(b)
vs.Message(vs.ReadLn())
lines = []
while not vs.EOF("data.txt"):
    lines.append(vs.ReadLn())
vs.Message(lines)
vs.Close("data.txt")
vs.Message(vs.GetLastFileErr())
`,
  );
  assert.deepEqual(messages(r), ["7", "2.5", "name here", "['tail']", "0"]);
  assert.equal(handed(r).get("data.txt"), "7\t2.5\nname here\ntail\n");
}
{
  // Read leaves the pointer in the line; EOLN and EOF say where it is; StdReadLn takes tabs in a string
  const r = ranVs(
    `vs.Rewrite("n.txt")
vs.WriteLn(7)
vs.WriteLn("a b\tc")
vs.Close("n.txt")
vs.Open("n.txt")
v = vs.Read(int)
vs.Message(v)
vs.Message(vs.EOLN("n.txt"))
vs.Message(vs.EOF("n.txt"))
vs.Message(vs.ReadLn(str))
vs.Message(vs.StdReadLn(str))
vs.Message(vs.EOF("n.txt"))
vs.Close("n.txt")
`,
  );
  assert.deepEqual(messages(r), ["7", "True", "False", "", "a b\tc", "True"]);
}
{
  // Tab, Space, Write and WriteMac through the current file
  const r = ranVs(
    `vs.Rewrite("spaces.txt")
vs.Tab(2)
vs.Space(1)
vs.Write("x")
vs.WriteMac("y")
vs.Close("spaces.txt")
`,
  );
  assert.equal(handed(r).get("spaces.txt"), "\t\t xy");
}
{
  // a file the script didn't open: GetLastFileErr says so, and the alert goes to the editor
  const r = ranVs(
    `vs.Open("missing.txt")
vs.Message(vs.GetLastFileErr())
vs.UseDefaultFileErrorHandling(False)
vs.Open("missing.txt")
vs.Message(vs.GetLastFileErr())
`,
  );
  assert.deepEqual(messages(r), ["6", "6"]);
  assert.deepEqual(r.alerts, ["Vectorworks couldn't open missing.txt: File or directory not found."]);
}
{
  // Vectorscript: Open, then ReadLn into variables (one each), EOF and Close
  const r = ranVs(
    `PROCEDURE Main;
VAR line : STRING; n : INTEGER;
BEGIN
  Rewrite('vs.txt');
  WriteLn(7, Chr(9), 2.5);
  WriteLn('name here');
  Close('vs.txt');
  Open('vs.txt');
  ReadLn(n);
  Message(n);
  ReadLn(line);
  Message(line);
  Message(EOF('vs.txt'));
  Close('vs.txt');
END;
RUN(Main);`,
    { file: "read.vs" },
  );
  assert.deepEqual(messages(r), ["7", "name here", "TRUE"]);
}
{
  // ReadLn, Read, StdReadLn with several VAR arguments: each read as its variable's type, in order
  const r = ranVs(
    `PROCEDURE Main;
VAR a : INTEGER; b : REAL; s : STRING; ok : BOOLEAN; p, q : INTEGER; t : STRING; u : STRING;
BEGIN
  Rewrite('multi.txt');
  WriteLn(7, ' ', 2.5, ' ', 'label here');
  WriteLn(TRUE);
  WriteLn('4 5 tail text');
  WriteLn('one two');
  Close('multi.txt');
  Open('multi.txt');
  ReadLn(a, b, s);
  Message(a);
  Message(b);
  Message(s);
  ReadLn(ok);
  Message(ok);
  Read(p, q);
  Message(p + q);
  ReadLn(t);
  Message(t);
  StdReadLn(u);
  Message(u);
  Close('multi.txt');
END;
RUN(Main);`,
    { file: "multi.vs" },
  );
  assert.deepEqual(messages(r), ["7", "2.5", "label here", "TRUE", "9", "tail text", "one two"]);
}
{
  const r = runVs(`vs.ReadLn()\n`);
  assert.match(String(r.error?.message), /no file is open for reading/);
}

// ---- folders and files of the drawing and of the file system ----------------------------------------

{
  const r = ranVs(
    `import os
vs.CreateFolder("results")
vs.Rewrite("results/a.txt")
vs.WriteLn("12345")
vs.Close("results/a.txt")
vs.Message(vs.GetFilesInFolder("results", 1))
vs.Message(repr(vs.GetFilesInFolder("results", 2)))
vs.Message(vs.GetFileSize("results/a.txt")[0])
vs.Message(vs.GetFileInfo("results/a.txt")[2])
vs.Message(vs.ConvertHSF2PosixPath("Macintosh HD:Apps:x")[1])
vs.Message(vs.ConvertPosix2HSFPath("/Macintosh HD/Apps/x")[1])
vs.Message(vs.GetFName())
vs.Message(vs.GetFPathName().endswith("/document/Hall.vwx"))
vs.Rewrite(os.path.dirname(vs.GetFPathName()) + "/notes.txt")
vs.WriteLn("beside the drawing")
vs.Close(os.path.dirname(vs.GetFPathName()) + "/notes.txt")
`,
    { snapshot: Object.assign(blankSnapshot(), { fileName: "Hall.vwx" }) },
  );
  assert.deepEqual(messages(r).slice(0, 8), ["a.txt", "''", "6", "True", "/Macintosh HD/Apps/x", "Macintosh HD:Apps:x", "Hall.vwx", "True"]);
  assert.equal(handed(r).get("a.txt"), "12345\n");
  assert.equal(handed(r).get("notes.txt"), "beside the drawing\n");
}
{
  const r = ranVs(
    `vs.Message(repr(vs.GetFolder("Pick")))
vs.Message(vs.GetFolder("Pick")[0])
vs.Message(vs.DidCancel())
`,
  );
  assert.deepEqual(messages(r), ["(-1, '')", "-1", "True"]);
}

// ---- web addresses ------------------------------------------------------------------------------------

{
  const r = ranVs(
    `vs.Message(vs.OpenURL("https://example.com/help"))
vs.Message(vs.OpenURL("file:///etc/hosts"))
`,
    { answers: { OpenURL: [true] } },
  );
  assert.deepEqual(messages(r), ["True", "False"]);
  assert.deepEqual(r.asked, [["OpenURL", ["https://example.com/help"]]]);
}

// ---- {$INCLUDE} of a plug-in's file, and vs without an import ----------------------------------------

{
  const r = ranVs(
    `{$INCLUDE helpers.px}
PROCEDURE Main;
BEGIN
  Message(Twice(21));
END;
RUN(Main);`,
    { file: "plugin.vs", modules: { "helpers.px": "FUNCTION Twice(n : INTEGER): INTEGER;\nBEGIN\n  Twice := n * 2;\nEND;\n" } },
  );
  assert.deepEqual(messages(r), ["42"]);
}
{
  const r = ranVs(`vs.Message("no import")\n`);
  assert.deepEqual(messages(r), ["no import"]);
}

console.log("vs files and folders: ok");
