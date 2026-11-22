// Three ways to run the same editor build, behind one small interface, so one script can drive
// and measure them all:
//
//   chrome    Google Chrome with a fresh profile and one tab, the build served from 127.0.0.1
//   electron  the Electron spike (RODEO_ELECTRON names its folder)
//   tauri     the desktop app built with `npm run build:test` (its test bridge, src-tauri/src/testhook.rs)
//
// There is no WebDriver for the Mac's WKWebView, which is what the Tauri app runs in on macOS. So
// the app carries its own bridge, compiled in only with `--features testhook`: a loopback HTTP
// port that runs a script in the page and returns what it gives back, and hands the app a file as
// a double click in the Finder does. Chrome and Electron are driven through Playwright; all three
// then run the very same in-page scripts.
//
// Every driver gives: { kind, pid, eval(body, timeoutMs), open(path), activate(), close() }.
// `eval` runs the body of an async function in the page and resolves with its (JSON) return value.

import { spawn, execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
/** the staged build (desktop/app, made by `npm run stage`) */
export const APP_DIR = process.env.RODEO_APP_DIR ? resolve(process.env.RODEO_APP_DIR) : resolve(here, "../app");
const TAURI_BIN = process.env.RODEO_TAURI_BIN ?? resolve(here, "../src-tauri/target/debug/rodeo-desktop");
const ELECTRON_DIR = process.env.RODEO_ELECTRON ?? "";
const TEST_ID = "build.rodeo.desktop.test";
const CHROME_BIN = process.env.RODEO_CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A window behind another draws about one frame a second, in any shell, so a measurement would
// depend on what happens to be in front. These switches keep Chromium drawing when its window is
// covered; the Tauri test build asks the same of its webview (testhook.rs). Nothing here is set in
// the app people use.
const UNTHROTTLED = ["--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"];

/** Playwright, from the global install (`npm root -g`) when the project has none. */
function playwright() {
  // the global one first: a stray older copy further up the folders would otherwise win
  try {
    const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(join(root, "x.js"))("playwright");
  } catch {
    return createRequire(import.meta.url)("playwright");
  }
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".whl": "application/zip",
  ".zip": "application/zip",
};

/** Serves the staged build on a loopback port, as a static host does. */
export async function serveBuild(dir = APP_DIR) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const file = resolve(dir, "." + (path.endsWith("/") ? path + "index.html" : path));
    if (!file.startsWith(dir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
    res.setHeader("Content-Length", String(statSync(file).size));
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

/** Brings the app with this process id to the front, when RODEO_FRONT=1 asks for it (it takes the keyboard from whoever is typing). */
function activate(pid) {
  if (process.env.RODEO_FRONT !== "1") return;
  try {
    execFileSync("osascript", ["-l", "JavaScript", "-e", `ObjC.import("AppKit"); $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}).activateWithOptions(3)`], { stdio: "ignore" });
  } catch {
    // not on a Mac, or the process is gone
  }
}

const HOOK_READY = `for (let i = 0; i < 600; i++) { if (window.__rodeoApp && window.__rodeoApp.appContext()) return true; await new Promise(r => setTimeout(r, 100)); } throw new Error("the editor did not start (no __rodeoApp)");`;

/** Waits for the editor to be up, through the page loads a starting app goes through (a script's page can go away under it). */
async function editorUp(run) {
  let last = null;
  for (let i = 0; i < 8; i++) {
    try {
      return await run(HOOK_READY, 70000);
    } catch (err) {
      last = err;
      if (!/context was destroyed|navigation|Target closed|timeout/i.test(String(err))) throw err;
      await sleep(500);
    }
  }
  throw last;
}

async function chrome() {
  const { chromium } = playwright();
  const site = await serveBuild();
  const profile = mkdtempSync(join(tmpdir(), "rodeo-chrome-"));
  const port = 19000 + Math.floor(Math.random() * 900);
  const child = spawn(CHROME_BIN, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "--window-size=1440,900", ...UNTHROTTLED, "about:blank"], { stdio: "ignore" });
  let browser = null;
  for (let i = 0; i < 100 && !browser; i++) {
    await sleep(200);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) throw new Error("Chrome did not start");
  const context = browser.contexts()[0];
  await context.addInitScript(() => {
    window.__rodeoTest = true;
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(site.url);
  const run = (body, timeout = 30000) => Promise.race([page.evaluate(`(async()=>{${body}})()`), sleep(timeout).then(() => Promise.reject(new Error("timeout")))]);
  await editorUp(run);
  return {
    kind: "chrome",
    pid: child.pid,
    eval: run,
    open: async (path) => {
      await run(`let i = document.getElementById("__t"); if (!i) { i = document.createElement("input"); i.type = "file"; i.id = "__t"; i.hidden = true; document.body.append(i); }`);
      // straight through the debugging protocol, by path: Chrome then reads the file from disk itself,
      // as it does for a file the user picks (Playwright would copy it over the wire, and stops at 50 MB)
      const cdp = await context.newCDPSession(page);
      const { root } = await cdp.send("DOM.getDocument");
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#__t" });
      await cdp.send("DOM.setFileInputFiles", { files: [path], nodeId });
      await cdp.detach();
      await run(`void window.__rodeoApp.appContext().openFile(document.getElementById("__t").files[0]);`);
    },
    activate: () => activate(child.pid),
    close: async () => {
      await browser.close().catch(() => {});
      child.kill();
      site.close();
      await sleep(500);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function electron() {
  if (!ELECTRON_DIR) throw new Error("RODEO_ELECTRON must name the Electron spike's folder");
  const { _electron } = playwright();
  const executablePath = createRequire(join(ELECTRON_DIR, "x.js"))("electron");
  // a profile of its own, thrown away after: a run must not start from what the last one kept
  const profile = mkdtempSync(join(tmpdir(), "rodeo-electron-"));
  const app = await _electron.launch({ executablePath, args: [".", `--user-data-dir=${profile}`], cwd: ELECTRON_DIR, env: { ...process.env, RODEO_DIST: APP_DIR, RODEO_TEST: "1", RODEO_FLAGS: UNTHROTTLED.map((f) => f.slice(2)).join(" ") } });
  const page = await app.firstWindow();
  const run = (body, timeout = 30000) => Promise.race([page.evaluate(`(async()=>{${body}})()`), sleep(timeout).then(() => Promise.reject(new Error("timeout")))]);
  await editorUp(run);
  const pid = app.process().pid;
  return {
    kind: "electron",
    pid,
    eval: run,
    open: async (path) => {
      await run(`let i = document.getElementById("__t"); if (!i) { i = document.createElement("input"); i.type = "file"; i.id = "__t"; i.hidden = true; document.body.append(i); }`);
      await page.setInputFiles("#__t", path);
      await run(`void window.__rodeoApp.appContext().openFile(document.getElementById("__t").files[0]);`);
    },
    activate: () => activate(pid),
    close: async () => {
      await app.close().catch(() => {});
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

async function tauri() {
  // On a Mac the app is started as an app (through `open`), as a double click starts it: WebKit's
  // helper processes are then the app's own in the system's books, which is how they are counted.
  // Started from a terminal they would be counted as the terminal's.
  const bundle = process.env.RODEO_TAURI_APP ?? resolve(here, "../src-tauri/target/debug/bundle/macos/Rodeo.app");
  const asApp = process.platform === "darwin" && existsSync(bundle);
  if (!asApp && !existsSync(TAURI_BIN)) throw new Error(`${TAURI_BIN} is not built: run "npm run build:test" in desktop/`);
  const port = 17000 + Math.floor(Math.random() * 900);
  const base = `http://127.0.0.1:${port}`;
  let child = null;
  // the test build has an identifier of its own (package.json, build:test), so what its page keeps
  // (settings, recent files, recovery copies) is apart from the real app's, and is cleared before each run
  // (RODEO_KEEP_DATA=1 leaves it: a check of what survives a crash starts the app twice)
  if (process.env.RODEO_KEEP_DATA !== "1") for (const dir of ["WebKit", "Caches", "Application Support"]) rmSync(join(homedir(), "Library", dir, TEST_ID), { recursive: true, force: true });
  if (asApp) execFileSync("open", ["-n", ...(process.env.RODEO_FRONT === "1" ? [] : ["-g"]), "-a", bundle, "--env", `RODEO_TEST_PORT=${port}`]);
  else child = spawn(TAURI_BIN, [], { stdio: "ignore", env: { ...process.env, RODEO_TEST_PORT: String(port) } });
  let pid = null;
  for (let i = 0; i < 150 && pid === null; i++) {
    await sleep(200);
    pid = await fetch(`${base}/ready`).then((r) => r.json()).then((j) => j.pid, () => null);
  }
  if (pid === null) throw new Error("the desktop app's test bridge did not answer");
  const run = async (body, timeout = 30000) => {
    const res = await fetch(`${base}/eval?timeout=${timeout}`, { method: "POST", body });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error);
    return out.value;
  };
  await editorUp(run);
  return {
    kind: "tauri",
    pid,
    eval: run,
    open: async (path) => {
      await fetch(`${base}/open`, { method: "POST", body: path });
    },
    activate: () => activate(pid),
    close: async () => {
      await fetch(`${base}/quit`, { method: "POST" }).catch(() => {});
      await sleep(500);
      child?.kill();
    },
  };
}

export function launch(kind) {
  if (kind === "chrome") return chrome();
  if (kind === "electron") return electron();
  if (kind === "tauri") return tauri();
  throw new Error(`no such shell: ${kind}`);
}

/** Memory of every process of the app whose first process is `pid` (test/mem.py), in MB. */
export function memory(pid) {
  const out = execFileSync("python3", [join(here, "mem.py"), String(pid), "--json"], { encoding: "utf8" });
  return JSON.parse(out);
}
