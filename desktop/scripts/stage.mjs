// Copies the built web editor (../web/dist) into desktop/app, the folder Tauri serves.
// Source maps and the web-only pages (service worker, manifest, admin, gallery, convert,
// render worker) are left out: the desktop app does not need them.
import { existsSync, readdirSync, readFileSync, statSync, copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "web", "dist");
const dest = resolve(here, "..", "app");
// Python's runtime for Run Script: the files the pyodide npm package ships (web/package.json pins it), staged
// into app/pyodide so the app never fetches them. runner.ts loads them from there.
const pyodideSrc = resolve(here, "..", "..", "web", "node_modules", "pyodide");
const pyodideFiles = ["pyodide.js", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

if (!existsSync(join(src, "index.html"))) {
  console.error(`stage: ${join(src, "index.html")} is missing. Build the web editor first (npm run build in web/).`);
  process.exit(1);
}

const missing = pyodideFiles.filter((name) => !existsSync(join(pyodideSrc, name)));
if (missing.length > 0) {
  console.error(`stage: ${missing.map((name) => join(pyodideSrc, name)).join(", ")} missing. Run npm install in web/ (the pyodide package).`);
  process.exit(1);
}

const skipNames = new Set(["sw.js", "manifest.webmanifest", "admin.html", "gallery.html", "convert.html", "render-worker.html"]);

function skip(name) {
  return name.endsWith(".map") || skipNames.has(name);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

let files = 0;
let bytes = 0;

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
      continue;
    }
    if (!entry.isFile() || skip(entry.name)) continue;
    const to = join(dest, relative(src, from));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    files += 1;
    bytes += statSync(to).size;
  }
}

walk(src);

const pyodideDest = join(dest, "pyodide");
mkdirSync(pyodideDest, { recursive: true });
let pyodideBytes = 0;
for (const name of pyodideFiles) {
  const to = join(pyodideDest, name);
  copyFileSync(join(pyodideSrc, name), to);
  files += 1;
  pyodideBytes += statSync(to).size;
}
bytes += pyodideBytes;

// the page says where Python is, so runner.ts loads it from here in the app and in a browser alike
const indexPath = join(dest, "index.html");
const index = readFileSync(indexPath, "utf8");
if (!index.includes("<head>")) {
  console.error("stage: index.html has no <head> to mark Python's place in.");
  process.exit(1);
}
writeFileSync(indexPath, index.replace("<head>", '<head>\n    <meta name="rodeo-pyodide" content="pyodide/" />'));

console.log(`staged ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MB -> ${dest} (Python runtime ${(pyodideBytes / 1024 / 1024).toFixed(1)} MB in pyodide/)`);
