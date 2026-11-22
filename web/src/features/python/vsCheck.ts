// For the Node checks of the vs module (*.check.ts beside the parts in vs/): runs a script written
// for Vectorworks against the module with the computer's python3, the way runner.ts runs it in the
// browser's Python, and gives what the script did. No drawing is opened: the script works on the
// copy of a drawing a check hands it (blankSnapshot, with what the check adds), and its steps come
// back unapplied, so a check asserts on the steps and on what the script read back. Only run
// scripts written in this repository with it: python3 isn't the browser's sandbox.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isVectorscript, RUN_PY } from "./runPy.ts";
import { VS_SOURCE } from "./vsModule.ts";
import { VSC_SOURCE } from "./vscriptModule.ts";

/** One object of a snapshot, as runner.ts's snapshot() writes it (lengths in millimetres). */
export interface SnapObject {
  id: string;
  type: number;
  typeName?: string;
  layer: string;
  parent?: string | null;
  cls?: string;
  name?: string;
  bbox?: number[] | null;
  attrs?: Record<string, unknown>;
  byClass?: string[];
  ins?: number[] | null;
  turned?: number;
  sym?: number | null;
  records?: Record<string, Record<string, unknown>>;
  shape?: Record<string, unknown> | null;
  [more: string]: unknown;
}

/** The plug-in block of a snapshot: a run of a plug-in's script. */
export interface SnapPlugin {
  name: string;
  /** the object it draws: "new:plugin" for one being placed, null for a command or tool */
  object: string | null;
  isNew: boolean;
  /** [name, "int" | "real" | "bool" | "str", value], lengths in the drawing's units */
  params: [string, string, unknown][];
  /** vsoGetEventInfo's event: 3 draws the object */
  event: number;
  eventData: number;
}

export type Snapshot = Record<string, unknown> & { objects: SnapObject[]; plugin: SnapPlugin | null; selection: string[] };

/** The id of the one design layer of blankSnapshot. */
export const LAYER = "layer-1";

/** A new, empty drawing in millimetres at 1:50 with one design layer, as a script's copy of it. */
export function blankSnapshot(): Snapshot {
  const attrs = { fillPattern: 1, fillFore: 255, fillBack: 0, penPattern: 2, penFore: 255, penBack: 0, lineWeight: 0.05, opacity: 100 };
  return {
    units: { mm: 1, mark: "mm", area: "m²", format: 0, display: 2 },
    layers: [{ id: LAYER, name: "Design Layer-1", kind: "design", scale: 50, vis: "visible", elev: 0 }],
    classes: [
      { name: "None", vis: "visible", attrs, textStyle: undefined },
      { name: "Dimension", vis: "visible", attrs, textStyle: undefined },
    ],
    activeLayer: LAYER,
    activeClass: "None",
    // Vectorworks' classic palette's ends and primaries: white 0, black 255
    palette: [
      [0, 255, 255, 255],
      [255, 0, 0, 0],
      [1, 255, 0, 0],
      [2, 0, 255, 0],
      [3, 0, 0, 255],
      [4, 128, 128, 128],
    ],
    symbols: [],
    activeSymbol: null,
    formats: [],
    objects: [],
    selection: [],
    newAttrs: attrs,
    templateAttrs: attrs,
    fonts: ["Arial"],
    classMode: "show-snap-modify-others",
    layerMode: "show-snap-modify-others",
    textPaperMm: 2.5,
    jspi: true,
    plugin: null,
  };
}

/** A snapshot for a run of an object plug-in's script that draws a newly placed object, as runner.ts sets it up. */
export function pluginSnapshot(name: string, params: [string, string, unknown][], event = 3, eventData = 0, place?: { at: [number, number]; angle: number }): Snapshot {
  const snap = blankSnapshot();
  // a placed object carries its insertion point and turn, as runner.ts gives the placeholder
  const where = place ? { ins: place.at, turned: place.angle } : {};
  snap.objects.push({ id: "new:plugin", type: 86, typeName: "plug-in-object", layer: LAYER, parent: null, cls: "None", name: "", bbox: null, attrs: {}, ...where, sym: null, records: { [name]: Object.fromEntries(params.map(([n, , v]) => [n, v])) }, shape: null });
  (snap.formats as unknown[]).push({ name, format: -1 });
  snap.plugin = { name, object: "new:plugin", isNew: true, params, event, eventData };
  return snap;
}

export interface VsRun {
  /** the script's file name: a .vs or .px file is taken as Vectorscript, as is a script that starts with PROCEDURE */
  file?: string;
  snapshot?: Snapshot;
  /** the Python files that come with a plug-in, by path */
  modules?: Record<string, string>;
  /**
   * What the editor answers when the script asks (vs's _host): for each kind ("YNDialog", "GetPt",
   * "Dialog"...) its answers in order, as runner.ts's answer() would give them. A kind with none
   * left answers null.
   */
  answers?: Record<string, unknown[]>;
}

export interface VsOutcome {
  /** the steps the script recorded, each [kind, ...] */
  ops: unknown[][];
  error: { name: string; message: string; line: number | null } | null;
  /** what the script printed */
  printed: string;
  /** what the script wrote to stderr (the console's warnings) */
  stderr: string;
  /** every question it asked the editor: [kind, its arguments] */
  asked: [string, unknown[]][];
  /** the rest of the module's result (selection, messages, drawing, ui...) */
  [key: string]: unknown;
}

const DRIVER = `
import json, sys, types, io
with open(sys.argv[1], encoding="utf-8") as f:
    job = json.load(f)
# a script that reads the keyboard gets the end of input at once, never a wait
sys.stdin = io.StringIO("")
asked = []
answers = job["answers"]
ffi = types.ModuleType("pyodide.ffi")
ffi.run_sync = lambda v: v
pyodide = types.ModuleType("pyodide")
pyodide.ffi = ffi
rodeo = types.ModuleType("_rodeo")
def ask(kind, args):
    asked.append([kind, json.loads(args)])
    queue = answers.get(kind) or []
    return json.dumps(queue.pop(0) if queue else None)
rodeo.ask = ask
sys.modules.update({"pyodide": pyodide, "pyodide.ffi": ffi, "_rodeo": rodeo})
for name, src in (("vs", job["vs"]), ("_vsc", job["vsc"])):
    m = types.ModuleType(name)
    sys.modules[name] = m
    exec(compile(src, name + ".py", "exec"), m.__dict__)
# the file system's folders (/rodeo in the browser) are kept in a temporary folder here
sys.modules["vs"]._FILES_ROOT = job["root"]
out = io.StringIO()
real = sys.stdout
sys.stdout = out
# what the script writes to stderr (the console's warnings) is kept for the check
errs = io.StringIO()
real_err = sys.stderr
sys.stderr = errs
g = {"_snapshot": json.dumps(job["snapshot"]), "_code": job["code"], "_file": job["file"], "_vectorscript": job["vectorscript"], "_plugin_dir": job["dir"]}
*body, last = job["run"].strip().split("\\n")
exec(compile("\\n".join(body), "run.py", "exec"), g)
result = json.loads(eval(last, g))
sys.stdout = real
sys.stderr = real_err
result["printed"] = out.getvalue()
result["stderr"] = errs.getvalue()
result["asked"] = asked
print(json.dumps(result))
`;

/** Runs `code` as runner.ts would and gives its outcome; throws only when python3 itself fails. */
export function runVs(code: string, run: VsRun = {}): VsOutcome {
  const dir = mkdtempSync(join(tmpdir(), "rodeo-vs-"));
  try {
    const file = run.file ?? "script.py";
    for (const [path, text] of Object.entries(run.modules ?? {})) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      // a binary file comes as "base64:" and its data (runner.ts's install keeps it so)
      writeFileSync(join(dir, path), text.startsWith("base64:") ? Buffer.from(text.slice(7), "base64") : text);
    }
    const job = { vs: VS_SOURCE, vsc: VSC_SOURCE, run: RUN_PY, snapshot: run.snapshot ?? blankSnapshot(), code, file, vectorscript: isVectorscript(code, file), dir, root: join(dir, "rodeo"), answers: run.answers ?? {} };
    writeFileSync(join(dir, "driver.py"), DRIVER);
    // the job goes in a file, not down a pipe, and a run that hangs fails the check after two minutes
    writeFileSync(join(dir, "job.json"), JSON.stringify(job));
    const out = execFileSync("python3", ["-I", join(dir, "driver.py"), join(dir, "job.json")], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"], timeout: 120_000 });
    const result = JSON.parse(out.trim().split("\n").pop() ?? "{}") as VsOutcome;
    result.ops ??= [];
    return result;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs `code` and gives its outcome, failing the check with the script's own error when it has one. */
export function ranVs(code: string, run: VsRun = {}): VsOutcome {
  const r = runVs(code, run);
  if (r.error) throw new Error(`the script failed: ${r.error.name}: ${r.error.message}${r.error.line ? ` (line ${r.error.line})` : ""}`);
  return r;
}
