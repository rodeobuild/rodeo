// The checks a shell must pass before Rodeo ships in it on an OS (docs/desktop.md lists them),
// run against the real app through its test bridge, or against Chrome or the Electron spike.
//
//   node test/gates.mjs <tauri|chrome|electron> --work <folder> [--demo a.vwx] [--big b.vwx]
//        [--dwg c.dwg] [--rvt d.rvt] [--part e.sldprt] [--only name,name]
//
// --work is a folder the app may read without asking (not Desktop, Documents or Downloads: macOS
// asks before an app reads those, and a test cannot answer). Every drawing given is opened from
// where it is, so give paths under such a folder. Nothing a drawing holds is printed: results name
// the check, never a file.
//
// Checks: start (the editor comes up, and what the engine has), blank (New, 3D, the two render
// modes, both path-tracing engines), python (Run Script, with the network not used), save (open a
// drawing, change it, Save, and find the change in the file after starting again), recovery (a
// copy kept on disk is offered back), and for each file given: demo and big (opens, 3D draws),
// dwg, rvt and part (the importers). `network` lists every address the app's processes or page
// reached during the run: it has to be empty.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launch, memory } from "./drivers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : argv[i + 1];
};
const kind = argv[0];
const work = opt("work");
const only = opt("only")?.split(",") ?? null;
if (!kind || !work) {
  console.error("usage: node test/gates.mjs <tauri|chrome|electron> --work <folder> [--demo f] [--big f] [--dwg f] [--rvt f] [--part f] [--only a,b]");
  process.exit(2);
}
mkdirSync(work, { recursive: true });

const APP = `const A = window.__rodeoApp, ctx = A.appContext();`;
const results = [];
const reached = new Set();
const wants = (name) => !only || only.includes(name);

function record(name, ok, detail) {
  results.push({ check: name, ok, ...detail });
  console.error(`${ok ? "pass" : "FAIL"}  ${name}  ${JSON.stringify(detail)}`);
}

/** Addresses the app's processes have sockets to, other than this machine's own. */
function sockets(pid) {
  try {
    const pids = memory(pid).processes.map((p) => p.pid).join(",");
    // an app that has gone has no processes, and lsof without -p lists everyone's
    if (!pids) return;
    const out = execFileSync("lsof", ["-nP", "-i", "-a", "-p", pids], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    for (const line of out.split("\n").slice(1)) {
      const m = /->(\S+)/.exec(line);
      if (m && !/^(127\.0\.0\.1|\[::1\]|localhost)[:\]]/.test(m[1])) reached.add(`socket ${m[1]}`);
    }
  } catch {
    // lsof exits 1 with nothing to list
  }
}

/** In the page: every address it asked for that is not the app's own. */
const PAGE_REACHED = `return performance.getEntriesByType("resource").map(e => e.name).filter(n => /^(https?|wss?):/.test(n) && !n.startsWith(location.origin) && !/^http:\\/\\/(ipc|tauri)\\.localhost/.test(n) && !/^http:\\/\\/127\\.0\\.0\\.1/.test(n)).map(n => n.split("?")[0]);`;

const OPENED = `${APP} for (let i = 0; i < 12000; i++) {
    if (ctx.frontDrawing() && !document.querySelector(".loading")) return true;
    const t = [...document.querySelectorAll(".toast")].map(t => t.textContent || "").find(t => /Could not|couldn't|can't/i.test(t));
    if (t) throw new Error("refused: " + t.replace(/["“][^"”]*["”]/g, "<name>").slice(0, 140));
    await new Promise(r => setTimeout(r, 50));
  } throw new Error("still opening after ten minutes");`;

const PICTURE = `${APP} const v = ctx.view3d(); if (!v) return { colours: 0, why: "no 3D view" };
  v.renderNow(); const c = v.domElement, gl = v.glRenderer.getContext();
  if (gl.isContextLost()) return { colours: 0, why: "context lost" };
  const seen = new Set(), px = new Uint8Array(4);
  for (let y = 1; y < 24; y++) for (let x = 1; x < 24; x++) { gl.readPixels(Math.floor(c.width * x / 24), Math.floor(c.height * y / 24), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); seen.add((px[0] << 16) | (px[1] << 8) | px[2]); }
  return { colours: seen.size, triangles: v.glRenderer.info.render.triangles };`;

const FPS = `${APP} const v = ctx.view3d(); let frames = 0; const t0 = performance.now();
  await new Promise(done => { const tick = () => { v.rotateView(0, 0, 1.2); frames++; if (performance.now() - t0 < 6000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
  return Math.round(frames / ((performance.now() - t0) / 1000) * 10) / 10;`;

const COUNT = `${APP} const s = A.store.session; let n = 0; for (const l of s.doc.layers()) n += s.doc.objects(l.id).length; return n;`;

/** One app, started fresh, closed whatever happens; socket use is sampled while it runs. */
async function withApp(fn) {
  const d = await launch(kind);
  // the one thing the desktop app asks the network for by itself is whether a newer version is out,
  // twenty seconds after it starts (Help > Check for Updates Automatically): off here, so that
  // anything else it reaches shows up
  await d.eval(`try { const k = "rodeo.desktop.update"; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || "{}"), auto: false })); } catch {} return 1;`);
  const watch = setInterval(() => sockets(d.pid), 700);
  try {
    return await fn(d);
  } finally {
    clearInterval(watch);
    try {
      for (const url of await d.eval(PAGE_REACHED)) reached.add(`page ${url}`);
    } catch {
      // the page has gone
    }
    await d.close();
    await sleep(800);
  }
}

async function attempt(name, fn) {
  if (!wants(name)) return;
  try {
    await fn();
  } catch (err) {
    record(name, false, { error: String(err?.message ?? err).slice(0, 300) });
  }
}

await attempt("start", () =>
  withApp(async (d) => {
    const env = await d.eval(`return { origin: location.origin, shell: !!window.__rodeoShell, webgl2: !!document.createElement("canvas").getContext("webgl2"), webgpu: !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null)), jspi: typeof WebAssembly.Suspending === "function", isolated: crossOriginIsolated, workers: await new Promise(r => { try { const w = new Worker(URL.createObjectURL(new Blob(["postMessage(7)"]))); w.onmessage = () => r(true); w.onerror = () => r(false); } catch { r(false); } }), ua: navigator.userAgent.replace(/^.*?(AppleWebKit\\S+).*?((Chrome|Version)\\/\\S+)?.*$/, "$1 $2").trim() };`);
    record("start", env.webgl2 && env.workers, env);
  }),
);

await attempt("blank", () =>
  withApp(async (d) => {
    await d.eval(`document.getElementById("welcome-new").click();`);
    await d.eval(OPENED, 60000);
    await d.eval(`${APP} await ctx.show3dAlone(); return 1;`, 60000);
    const out = {};
    await d.eval(`${APP} ctx.setRenderMode("realistic");`);
    await sleep(6000);
    out.realistic = (await d.eval(PICTURE)).colours;
    for (const engine of ["webgl", "webgpu"]) {
      await d.eval(`${APP} ctx.setRenderMode("shaded"); A.render.patch("quality", { engine: "${engine}" }); ctx.setRenderMode("pathtraced");`);
      let status = null;
      for (let i = 0; i < 40; i++) {
        await sleep(1000);
        status = await d.eval(`return window.__rodeoApp.render.status();`);
        if (/\d+ of /.test(status ?? "") && Number(/(\d+) of/.exec(status)[1]) >= 16) break;
      }
      out[engine] = { status, colours: (await d.eval(PICTURE)).colours };
    }
    const ok = out.realistic > 8 && out.webgl.colours > 8 && /samples/.test(out.webgl.status ?? "");
    record("blank", ok, out);
  }),
);

await attempt("python", () =>
  withApp(async (d) => {
    await d.eval(`document.getElementById("welcome-new").click();`);
    await d.eval(OPENED, 60000);
    const before = await d.eval(COUNT);
    const t0 = Date.now();
    const run = await d.eval(`return await window.__rodeoApp.python("import vs, math, json\\nvs.Rect(0, 0, 40, 20)\\nvs.Oval(50, 0, 80, 20)\\nprint('sum', sum(range(101)), json.dumps({'pi': round(math.pi, 3)}))");`, 180000);
    const after = await d.eval(COUNT);
    const printed = run.out.join(" | ");
    record("python", !run.error && /sum 5050/.test(printed) && after === before + 2, { seconds: Math.round((Date.now() - t0) / 100) / 10, printed: printed.slice(0, 160), error: run.error, added: after - before });
  }),
);

const blankPath = join(work, "gate-blank.vwx");
await attempt("save", async () => {
  // a drawing of our own to save over: a new one's bytes, written where the app may read them
  await withApp(async (d) => {
    await d.eval(`document.getElementById("welcome-new").click();`);
    await d.eval(OPENED, 60000);
    const b64 = await d.eval(`${APP} const b = await ctx.documentBytes(); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s);`, 60000);
    writeFileSync(blankPath, Buffer.from(b64, "base64"));
  });
  const before = statSync(blankPath);
  let countBefore = 0;
  await withApp(async (d) => {
    await d.open(blankPath);
    await d.eval(OPENED, 60000);
    countBefore = await d.eval(COUNT);
    const run = await d.eval(`return await window.__rodeoApp.python("import vs\\nvs.Rect(0, 0, 10, 10)\\nvs.Rect(20, 0, 30, 10)\\nvs.Rect(40, 0, 50, 10)");`, 180000);
    if (run.error) throw new Error(`the script failed: ${run.error.message}`);
    // the first save over a file that was opened asks before replacing it
    const state = await d.eval(`${APP} const before = A.store.session.dirty; const saving = ctx.save();
      for (let i = 0; i < 100; i++) { const b = [...document.querySelectorAll(".menu-dialog button, [role=dialog] button")].find(b => /^Overwrite$/.test((b.textContent || "").trim())); if (b) { b.click(); break; } if (!A.store.session.dirty) break; await new Promise(r => setTimeout(r, 100)); }
      await saving; await new Promise(r => setTimeout(r, 1500)); return { before, after: A.store.session.dirty, handle: !!A.store.handle };`, 120000);
    if (!state.handle) throw new Error("the drawing has no file to save back to");
    if (!state.before || state.after) throw new Error(`unsaved mark: ${state.before} before the save, ${state.after} after`);
  });
  const after = statSync(blankPath);
  let countAfter = 0;
  await withApp(async (d) => {
    await d.open(blankPath);
    await d.eval(OPENED, 60000);
    countAfter = await d.eval(COUNT);
  });
  const leftovers = execFileSync("ls", ["-a", work], { encoding: "utf8" }).split("\n").filter((n) => /\.rodeo-.*\.tmp$/.test(n));
  record("save", countAfter === countBefore + 3 && after.mtimeMs > before.mtimeMs && leftovers.length === 0, { objects: [countBefore, countAfter], bytes: [before.size, after.size], rewritten: after.mtimeMs > before.mtimeMs, leftovers: leftovers.length });
});

await attempt("recovery", async () => {
  if (kind !== "tauri") return record("recovery", true, { skipped: "kept on disk only in the desktop app" });
  if (!existsSync(blankPath)) throw new Error("needs the save check's drawing");
  let kept = [];
  await withApp(async (d) => {
    // copies as often as the preference allows (a minute), so the check need not wait five
    await d.eval(`const A = window.__rodeoApp; A.setPrefs({ ...A.prefs(), autosave: true, autosaveMinutes: 1 });`);
    await d.open(blankPath);
    await d.eval(OPENED, 60000);
    await d.eval(`return await window.__rodeoApp.python("import vs\\nvs.Rect(0, 100, 10, 110)");`, 180000);
    // autosave's own copy, made now instead of at its next interval; then the app is killed, not closed
    kept = await d.eval(`const s = window.__rodeoShell; const until = Date.now() + 120000; for (;;) { const list = await s.call("kept_list", {}); if (list.some(k => k.name.endsWith(".json"))) return list.map(k => k.name.replace(/^.*\\./, ".") + ":" + k.size); if (Date.now() > until) return list.map(k => k.name.replace(/^.*\\./, ".")); await new Promise(r => setTimeout(r, 500)); }`, 130000);
    execFileSync("kill", ["-9", String(d.pid)]);
    await sleep(1500);
  });
  if (!kept.some((k) => k.startsWith(".json"))) return record("recovery", false, { kept, note: "no copy was kept within two minutes (the autosave interval is longer: lower it for this check)" });
  let offered = null;
  let reopened = 0;
  process.env.RODEO_KEEP_DATA = "1";
  try {
    await withApp(async (d) => {
      for (let i = 0; i < 100 && !offered; i++) {
        offered = await d.eval(`const t = [...document.querySelectorAll(".menu-dialog, [role=dialog]")].map(e => e.textContent || "").find(t => /Recover Drawing/.test(t)); return t ? true : null;`);
        if (!offered) await sleep(200);
      }
      if (!offered) return;
      await d.eval(`const b = [...document.querySelectorAll(".menu-dialog button, [role=dialog] button")].find(b => /Open Copy/.test(b.textContent || "")); b.click();`);
      await d.eval(OPENED, 60000);
      reopened = await d.eval(COUNT);
    });
  } finally {
    delete process.env.RODEO_KEEP_DATA;
  }
  record("recovery", !!offered && reopened > 0, { kept, offered: !!offered, objects: reopened });
});

for (const [name, minObjects] of [["demo", 100], ["big", 100], ["dwg", 1], ["rvt", 1], ["part", 1]]) {
  const file = opt(name);
  if (!file) continue;
  await attempt(name, () =>
    withApp(async (d) => {
      const t0 = Date.now();
      await d.open(file);
      await d.eval(OPENED, 900000);
      const seconds = Math.round((Date.now() - t0) / 100) / 10;
      const objects = await d.eval(COUNT);
      const out = { seconds, objects, mb: Math.round(statSync(file).size / 1048576) };
      if (name === "demo" || name === "big" || name === "rvt" || name === "part") {
        await d.eval(`${APP} await ctx.show3dAlone(); return 1;`, 600000);
        await sleep(3000);
        out.picture = await d.eval(PICTURE, 60000);
        if (name === "demo") out.fps = await d.eval(FPS, 60000);
        out.app_mb = Math.round(memory(d.pid).total_mb);
      }
      record(name, objects >= minObjects && (!out.picture || out.picture.colours > 3), out);
    }),
  );
}

record("network", reached.size === 0, { reached: [...reached].slice(0, 12) });
console.log(JSON.stringify({ shell: kind, passed: results.every((r) => r.ok), results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
