// Measures one run of the editor in one shell: memory across all of the app's processes at each
// stage, time to open, and 3D frame rate.
//
//   node test/measure.mjs <chrome|electron|tauri> blank
//   node test/measure.mjs <chrome|electron|tauri> <path to a drawing> [--label name] [--no-trace]
//
// Prints one JSON object. Stages: hub (nothing open), idle (the drawing open in 2D), 3d (the model
// built and shown), orbit (turning the view for ten seconds), rest (after turning), realistic and
// pathtraced (the two render modes of the 3D view). The window has to be in front and the display
// awake: a hidden window draws no frames, in any shell.
//
// The drawing's name is never printed: give --label to name the row (a private drawing stays private).

import { launch, memory } from "./drivers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value ?? "";
};
const label = flag("--label");
const noTrace = args.includes("--no-trace");
const [shellKind, target] = args.filter((a) => !a.startsWith("--"));
if (!shellKind || !target) {
  console.error("usage: node test/measure.mjs <chrome|electron|tauri> <blank | path> [--label name] [--no-trace]");
  process.exit(2);
}

const APP = `const A = window.__rodeoApp, ctx = A.appContext();`;

/** In the page: resolves once a drawing is open and no loading card shows. */
const OPENED = `${APP}
  const t0 = performance.now();
  for (;;) {
    if (ctx.frontDrawing() && !document.querySelector(".loading")) return Math.round(performance.now() - t0);
    const toast = [...document.querySelectorAll(".toast")].map(t => t.textContent).find(t => /Could not open/.test(t || ""));
    if (toast) throw new Error("open failed: " + toast.replace(/open .*?:/, "open <file>:"));
    await new Promise(r => setTimeout(r, 50));
  }`;

/** In the page: how many different colours a grid of the 3D canvas's pixels holds, right after a draw. */
const PICTURE = `${APP}
  const v = ctx.view3d(); if (!v) return { colours: 0, why: "no 3D view" };
  v.renderNow();
  const c = v.domElement, gl = v.glRenderer && v.glRenderer.getContext();
  if (!gl) return { colours: 0, why: "no WebGL context" };
  if (gl.isContextLost()) return { colours: 0, why: "context lost" };
  const seen = new Set(), px = new Uint8Array(4);
  for (let y = 1; y < 24; y++) for (let x = 1; x < 24; x++) {
    gl.readPixels(Math.floor(c.width * x / 24), Math.floor(c.height * y / 24), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    seen.add((px[0] << 16) | (px[1] << 8) | px[2]);
  }
  return { colours: seen.size, width: c.width, height: c.height };`;

const out = { shell: shellKind, drawing: label ?? (target === "blank" ? "blank" : "drawing"), stages: {}, notes: [] };
const samples = [];
let stage = "start";

const began = Date.now();
const d = await launch(shellKind);
if (process.env.RODEO_DEBUG) console.error(`launched ${shellKind}, pid ${d.pid}`);
d.activate();
const sampler = setInterval(() => {
  try {
    samples.push({ stage, mb: memory(d.pid).total_mb });
  } catch {
    // the app has gone
  }
}, 1000);

/** The stage's memory: what it settled at (the median of its last three samples) and its peak. */
function close(name) {
  const mine = samples.filter((s) => s.stage === name).map((s) => s.mb);
  if (mine.length === 0) return;
  const last = mine.slice(-3).sort((a, b) => a - b);
  out.stages[name] = { ...out.stages[name], mb: last[Math.floor(last.length / 2)], peak_mb: Math.max(...mine) };
}
async function during(name, ms, work) {
  if (process.env.RODEO_DEBUG) console.error(`[${((Date.now() - began) / 1000).toFixed(1)}s] ${name}`);
  stage = name;
  out.stages[name] = {};
  const result = work ? await work() : undefined;
  await sleep(ms);
  close(name);
  return result;
}

try {
  out.env = await d.eval(`return { ua: navigator.userAgent, dpr: devicePixelRatio, inner: [innerWidth, innerHeight], gpu: !!navigator.gpu, jspi: typeof WebAssembly.Suspending === "function", isolated: crossOriginIsolated, visible: document.visibilityState };`);
  await during("hub", 10000);

  if (target === "blank") {
    await d.eval(`document.getElementById("welcome-new").click();`);
    out.open_ms = await d.eval(OPENED, 60000);
  } else {
    const t0 = Date.now();
    await d.open(target);
    await d.eval(OPENED, 900000);
    out.open_ms = Date.now() - t0;
    out.stages.open = {};
    stage = "open";
  }
  await during("idle", 10000);

  await during("3d", 4000, async () => {
    const t0 = Date.now();
    const ok = await d.eval(`${APP} const v = await ctx.show3dAlone(); return !!v;`, 600000);
    out.show3d_ms = Date.now() - t0;
    if (!ok) out.notes.push("no 3D view (WebGL unavailable)");
  });
  out.stages["3d"].picture = await d.eval(PICTURE, 60000);

  await during("orbit", 0, async () => {
    d.activate();
    // frames the display was given while the view turned, and what one frame costs to draw
    out.orbit = await d.eval(
      `${APP} const v = ctx.view3d();
      let frames = 0; const t0 = performance.now();
      await new Promise(done => { const tick = () => { v.rotateView(0, 0, 1.2); frames++; if (performance.now() - t0 < 10000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
      const fps = frames / ((performance.now() - t0) / 1000);
      const gl = v.glRenderer.getContext(); const t1 = performance.now(); const n = 40;
      for (let i = 0; i < n; i++) { v.rotateView(0, 0, 1.2); v.renderNow(); gl.finish(); }
      return { fps: Math.round(fps * 10) / 10, frame_ms: Math.round((performance.now() - t1) / n * 10) / 10 };`,
      120000,
    );
  });
  await during("rest", 6000);

  await during("realistic", 8000, () => d.eval(`${APP} ctx.setRenderMode("realistic");`));
  out.stages.realistic.picture = await d.eval(PICTURE, 60000);

  if (!noTrace) {
    await during("pathtraced", 25000, () => d.eval(`${APP} ctx.setRenderMode("pathtraced");`));
    out.stages.pathtraced.picture = await d.eval(PICTURE, 60000);
    out.stages.pathtraced.status = await d.eval(`const m = /Path traced ·[^\\n]*/.exec(document.body.innerText); return m ? m[0] : null;`);
  }
  out.errors = await d.eval(`return [...document.querySelectorAll(".toast")].map(t => (t.textContent || "").slice(0, 160));`);
} catch (err) {
  out.failed = String(err && err.message ? err.message : err);
  close(stage);
} finally {
  clearInterval(sampler);
  out.peak_mb = samples.length ? Math.max(...samples.map((s) => s.mb)) : null;
  try {
    out.processes = memory(d.pid).processes.slice(0, 6);
  } catch {
    // gone
  }
  await d.close();
}
console.log(JSON.stringify(out));
process.exit(0);
