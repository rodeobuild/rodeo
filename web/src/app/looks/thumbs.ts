// View › Work Like: a small picture of each look, for the start screen's picker (welcome.ts). Each
// is drawn here as a diagram of the look's window in its own colours (where its bars, toolbox,
// panels and command line sit, and what its drawing area looks like), 160 by 100. They are
// Rodeo's drawings of Rodeo's layouts: nothing is copied from the applications.

import type { LookId } from "./types.ts";

/** A filled box. */
function box(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${rx ? ` rx="${rx}"` : ""}/>`;
}

/** A stroked path with no fill. */
function line(d: string, stroke: string, width = 0.6, extra = ""): string {
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}"${extra ? ` ${extra}` : ""}/>`;
}

/** A row of short bars standing for words: a menu bar's titles, a tab row. */
function words(x: number, y: number, widths: readonly number[], fill: string, gap = 3, h = 1.6): string {
  let at = x;
  let out = "";
  for (const w of widths) {
    out += box(at, y, w, h, fill, 0.8);
    at += w + gap;
  }
  return out;
}

/** Rows of bars standing for a panel's lines of text. */
function rows(x: number, y: number, widths: readonly number[], fill: string, step = 5, h = 1.6): string {
  return widths.map((w, i) => box(x, y + i * step, w, h, fill, 0.8)).join("");
}

/** A grid of small squares standing for tool icons; `tints` colours some of them by index. */
function icons(x: number, y: number, cols: number, n: number, fill: string, size = 3, step = 5.2, tints: Readonly<Record<number, string>> = {}): string {
  let out = "";
  for (let i = 0; i < n; i++) out += box(x + (i % cols) * step, y + Math.floor(i / cols) * step, size, size, tints[i] ?? fill, 0.7);
  return out;
}

/** Grid lines over a drawing area. */
function grid(x: number, y: number, w: number, h: number, step: number, stroke: string): string {
  let d = "";
  for (let gx = x + step; gx < x + w; gx += step) d += `M${gx} ${y}v${h}`;
  for (let gy = y + step; gy < y + h; gy += step) d += `M${x} ${gy}h${w}`;
  return line(d, stroke, 0.3);
}

/** A small floor plan, the drawing each look's picture shows: walls, a room and a door's swing. */
function plan(x: number, y: number, stroke: string, width = 0.9): string {
  return (
    line(`M${x} ${y}h36v26h-36z M${x + 15} ${y}v11 M${x + 15} ${y + 17}v9 M${x + 15} ${y + 14}h21`, stroke, width, `stroke-linejoin="round"`) +
    line(`M${x + 15} ${y + 11}a6 6 0 0 1 6 6`, stroke, width * 0.6)
  );
}

const MENU = [5, 5, 6, 8, 7, 6, 8, 5];

function rodeo(): string {
  const dim = "rgba(255,255,255,0.28)";
  return (
    box(0, 0, 160, 100, "#1d1d1d") +
    // the top bar: the drawing's name, the tools, Save
    box(5, 5, 3, 3, dim, 0.8) +
    box(11, 5.6, 18, 1.8, "rgba(255,255,255,0.6)", 0.9) +
    icons(46, 5, 12, 12, "rgba(255,255,255,0.42)", 3, 5.4, { 0: "#ffffff" }) +
    box(126, 3.6, 14, 5.8, "#f2f2f2", 2) +
    box(144, 3.6, 11, 5.8, "rgba(255,255,255,0.14)", 2) +
    // the drawing card, with its floating bars
    box(4, 13, 112, 83, "#fcfcfb", 4) +
    grid(4, 13, 112, 83, 14, "#e9e9e6") +
    plan(40, 38, "#2a2a2a") +
    box(8, 17, 44, 7, "#1d1d1d", 3) +
    words(11, 19.7, [3, 12, 3, 9], "rgba(255,255,255,0.5)", 3) +
    box(22, 85, 62, 7, "#1d1d1d", 3) +
    words(26, 87.7, [10, 9, 8, 14], "rgba(255,255,255,0.5)", 3) +
    box(90, 85, 22, 7, "#1d1d1d", 3) +
    // the panels on the right
    box(119.6, 12, 0.4, 88, "#2e2e2e") +
    box(124, 16, 16, 5, "rgba(255,255,255,0.12)", 1.5) +
    box(142, 17.6, 12, 1.8, dim, 0.9) +
    rows(124, 27, [18, 26, 14], dim) +
    box(120, 52, 40, 0.4, "#2e2e2e") +
    box(124, 57, 16, 5, "rgba(255,255,255,0.12)", 1.5) +
    box(142, 58.6, 12, 1.8, dim, 0.9) +
    rows(124, 68, [24, 16, 28], dim) +
    box(122, 84, 36, 6, "rgba(142,178,242,0.2)", 1.5)
  );
}

function vectorworks(): string {
  const ink = "#4a4a4a";
  return (
    box(0, 0, 160, 100, "#ececec") +
    box(0, 0, 160, 6, "#f7f7f7") +
    words(4, 2.2, [...MENU, 6, 6, 5], "#6a6a6a", 2.6) +
    box(0, 6, 160, 0.4, "#d4d4d4") +
    // the Mode bar
    box(0, 6.4, 160, 7, "#efefef") +
    words(4, 9, [9], "#555") +
    box(18, 7.6, 14, 4.6, "#d9d9d9", 1.2) +
    words(35, 9, [10, 8], "#777", 4) +
    box(0, 13.4, 160, 0.4, "#d0d0d0") +
    // the Tools and Tool Sets palettes
    box(0, 13.8, 34, 86.2, "#f4f4f4") +
    box(0, 13.8, 34, 5, "#e2e2e2") +
    words(3, 15.5, [9], "#555") +
    icons(3, 21.5, 6, 23, ink, 2.6, 5, { 0: "#3d7fe0" }) +
    box(0, 44, 34, 5, "#e2e2e2") +
    words(3, 45.7, [14], "#555") +
    icons(3, 51.5, 6, 30, ink, 2.6, 5) +
    box(0, 79, 34, 5, "#e2e2e2") +
    words(3, 80.7, [13], "#555") +
    icons(3, 86.5, 6, 8, "#3d7fe0", 3.4, 5) +
    box(34, 13.8, 0.4, 86.2, "#cfcfcf") +
    // the drawing
    box(34.4, 13.8, 88, 86.2, "#ffffff") +
    grid(34.4, 13.8, 88, 86.2, 12, "#e4e4e4") +
    plan(58, 42, "#222") +
    box(34.4, 13.8, 88, 6, "#f3f3f3") +
    words(38, 16, [3, 16, 6, 3, 10], "#777", 3) +
    // Object Info and the Resource Manager
    box(122.4, 13.8, 0.4, 86.2, "#cfcfcf") +
    box(122.8, 13.8, 37.2, 86.2, "#f6f6f6") +
    box(124, 15, 13, 4.6, "#ffffff", 1) +
    words(139, 16.5, [8, 8], "#777", 2.5) +
    rows(126, 25, [18, 26, 12, 22], "#8a8a8a") +
    box(122.8, 62, 37.2, 5, "#e2e2e2") +
    words(126, 63.7, [20], "#555") +
    box(126, 70, 30, 4.6, "#e9e9e9", 1) +
    rows(126, 80, [16, 22], "#9a9a9a")
  );
}

function autocad(): string {
  const text = "rgba(255,255,255,0.72)";
  const dim = "rgba(255,255,255,0.4)";
  return (
    box(0, 0, 160, 100, "#212830") +
    // the title bar with the application button
    box(0, 0, 160, 6, "#2a323d") +
    box(1, 1, 5, 4, "#d8452f", 0.8) +
    icons(9, 2, 7, 7, dim, 2, 3.6) +
    box(72, 2.2, 16, 1.6, text, 0.8) +
    // the ribbon's tabs and panels
    box(0, 6, 160, 5, "#343d4a") +
    box(1, 6, 11, 5, "#434e5e") +
    words(3, 7.8, [7], "#ffffff") +
    words(15, 7.8, [7, 9, 6, 8, 7, 8, 10], dim, 3.4) +
    box(0, 11, 160, 19, "#434e5e") +
    icons(4, 13.5, 4, 4, "#e3e7ee", 5, 8, { 1: "#f0a23a", 2: "#f0a23a" }) +
    words(3.4, 20.6, [6, 6, 6, 6], text, 2) +
    icons(38, 13.2, 3, 3, "#9cc3f2", 2.6, 9.4) +
    icons(38, 17.4, 3, 3, "#9cc3f2", 2.6, 9.4) +
    icons(38, 21.6, 3, 3, "#9cc3f2", 2.6, 9.4) +
    rows(41.6, 13.7, [5, 5, 5], text, 4.2) +
    rows(51, 13.7, [5, 5, 4], text, 4.2) +
    rows(60.4, 13.7, [4, 5, 5], text, 4.2) +
    icons(72, 13.5, 2, 2, "#e3e7ee", 5.4, 10, { 1: "#6fb1f5" }) +
    rows(94, 13.6, [10, 8, 9], text, 4.2) +
    icons(110, 13.5, 1, 1, "#f2c14e", 5.4) +
    rows(120, 13.6, [9, 8, 12], dim, 4.2) +
    icons(140, 13.5, 2, 2, "#e3e7ee", 5.4, 10) +
    box(0, 26, 160, 4, "#39434f") +
    words(12, 27.3, [8], dim) + words(48, 27.3, [10], dim) + words(80, 27.3, [14], dim) + words(118, 27.3, [9], dim) +
    line("M34 11v19 M68 11v19 M106 11v19 M134 11v19", "#2c3540", 0.4) +
    // the drawing's tabs, then the drawing itself
    box(0, 30, 160, 5, "#2a323d") +
    words(3, 31.8, [7], dim) +
    box(13, 30.6, 18, 4.4, "#212830", 1) +
    words(15.5, 32, [11], text) +
    grid(0, 35, 160, 53, 10, "rgba(255,255,255,0.07)") +
    words(2, 37.5, [3, 6, 14], dim, 1.6) +
    plan(56, 46, "#f4f6f8") +
    line("M56 78h36 M56 76.6v2.8 M92 76.6v2.8", "#5fd0e6", 0.5) +
    box(144, 39, 9, 9, "#56606e", 1) +
    box(147, 51, 4.6, 16, "#3a4350", 1.4) +
    line("M3 85v-7 M3 85h7", "#4cc36a", 0.5) +
    // the command line and the status bar
    box(0, 88, 160, 6, "#2a323d") +
    icons(3, 90, 3, 3, dim, 2, 3.6) +
    box(15, 89.2, 142, 3.8, "#212830", 0.8) +
    `<rect x="15" y="89.2" width="142" height="3.8" rx="0.8" fill="none" stroke="#5a6676" stroke-width="0.4"/>` +
    words(17.5, 90.4, [18], dim) +
    box(0, 94, 160, 6, "#1a2027") +
    box(1, 94.6, 11, 5.4, "#2f3946") +
    words(3, 96.6, [7], text) +
    words(104, 96.6, [9], text) +
    icons(118, 96, 10, 10, dim, 2.2, 4)
  );
}

function revit(): string {
  const ink = "#2f4a6b";
  return (
    box(0, 0, 160, 100, "#ffffff") +
    // the title bar and Quick Access Toolbar
    box(1, 1, 5.4, 4, "#1f6fd1", 0.8) +
    icons(10, 2, 9, 9, "#7a7a7a", 2, 3.8) +
    box(72, 2.2, 16, 1.6, "#555", 0.8) +
    // the ribbon: File, the tabs, the panels
    box(0, 6, 160, 5.4, "#f0f0f0") +
    box(0, 6, 9, 5.4, "#1f6fd1") +
    words(2.4, 8, [4.4], "#ffffff") +
    box(10, 6.4, 19, 5, "#ffffff") +
    words(12, 8, [15], "#333") +
    words(33, 8, [10, 9, 6, 9, 8, 13, 5, 8], "#777", 3.4) +
    box(0, 11.4, 160, 18.6, "#fbfbfb") +
    box(1.4, 12.6, 8, 12.4, "#cfe2f8", 1) +
    icons(3.4, 14.6, 1, 1, ink, 4) +
    icons(14, 14, 5, 5, ink, 5, 9, { 1: "#e08a2c", 3: "#3aa35c" }) +
    rows(60, 14, [9, 7], "#666", 4.4) +
    icons(78, 14, 3, 3, ink, 5, 9) +
    icons(110, 14, 2, 2, ink, 5, 12, { 0: "#d9483b" }) +
    icons(136, 14, 1, 1, ink, 5) +
    rows(146, 14, [8, 9, 11], "#666", 4) +
    box(0, 26, 160, 4, "#ececec") +
    words(3, 27.3, [6], "#777") + words(34, 27.3, [7], "#777") + words(84, 27.3, [13], "#777") + words(114, 27.3, [8], "#777") + words(142, 27.3, [12], "#777") +
    line("M11 11.4v18.6 M73 11.4v18.6 M105 11.4v18.6 M131 11.4v18.6 M142 11.4v18.6", "#dcdcdc", 0.4) +
    box(0, 30, 160, 0.4, "#cfcfcf") +
    // the Options Bar
    box(0, 30.4, 160, 5, "#f3f3f3") +
    words(3, 32.2, [9], "#666") +
    box(14, 31.2, 16, 3.4, "#ffffff", 0.6) +
    words(34, 32.2, [18], "#666") +
    box(54, 31.2, 16, 3.4, "#ffffff", 0.6) +
    box(0, 35.4, 160, 0.4, "#cfcfcf") +
    // Properties and the Project Browser
    box(0, 35.8, 38, 57.2, "#f7f7f7") +
    box(0, 35.8, 38, 4.6, "#dcdcdc") +
    words(2.4, 37.4, [13], "#333") +
    box(2, 42, 9, 4, "#ffffff", 0.6) +
    words(13, 43.2, [6, 8], "#777", 3) +
    rows(3, 50, [18, 12, 20], "#999", 4.4) +
    box(0, 63, 38, 4.6, "#dcdcdc") +
    words(2.4, 64.6, [19], "#333") +
    box(2, 69.4, 34, 3.8, "#ffffff", 0.6) +
    rows(3, 76, [14], "#333", 4) + rows(6, 80, [13], "#666", 4) + rows(9, 84, [16], "#222", 4) + rows(6, 88, [11], "#666", 4) +
    box(38, 35.8, 0.4, 57.2, "#cfcfcf") +
    // the drawing with its tab
    box(40, 36.6, 18, 4.6, "#ffffff", 1) +
    `<rect x="40" y="36.6" width="18" height="4.6" rx="1" fill="none" stroke="#d0d0d0" stroke-width="0.4"/>` +
    words(42, 38.2, [11], "#444") +
    box(38.4, 42, 121.6, 0.4, "#e0e0e0") +
    plan(80, 52, "#111", 1) +
    // the View Control Bar and the status bar
    box(0, 89, 160, 4.4, "#f3f3f3") +
    words(4, 90.6, [8], "#555") +
    icons(18, 90, 4, 4, "#777", 2.2, 5) +
    box(0, 93.4, 160, 0.4, "#cfcfcf") +
    box(0, 93.8, 160, 6.2, "#ececec") +
    words(3, 96.2, [44], "#666") +
    words(138, 96.2, [12], "#666")
  );
}

function rhino(): string {
  const view = "#a6a6a6";
  const gridLine = "#969696";
  const vx = 18;
  const vy = 28.4;
  const vw = 51.6;
  const vh = 31.4;
  const pane = (x: number, y: number, name: number, active: boolean, axes: string): string =>
    box(x, y, vw, vh, view) +
    grid(x, y, vw, vh, 7, gridLine) +
    axes +
    box(x + 1.4, y + 1.4, name + 4, 4, active ? "#3a78d8" : "#ececec", 0.8) +
    words(x + 2.6, y + 2.6, [name], active ? "#ffffff" : "#444") +
    (active ? `<rect x="${x}" y="${y}" width="${vw}" height="${vh}" fill="none" stroke="#3a78d8" stroke-width="0.7"/>` : "");
  return (
    box(0, 0, 160, 100, "#f0f0f0") +
    words(3, 1.8, [4, 4, 5, 6, 8, 5, 5, 8, 10, 6, 8, 7, 8, 5], "#555", 2.6) +
    // the command area
    box(0, 5, 160, 12, "#ffffff") +
    `<rect x="0.2" y="5.2" width="159.6" height="11.6" fill="none" stroke="#c8c8c8" stroke-width="0.4"/>` +
    words(2, 13, [11], "#444") +
    `<rect x="15" y="12" width="143" height="3.6" rx="0.6" fill="#ffffff" stroke="#bdbdbd" stroke-width="0.4"/>` +
    // the toolbar tabs and the toolbar
    box(0, 17, 160, 4.4, "#e6e6e6") +
    box(1, 17.4, 13, 4, "#ffffff") +
    words(3, 18.6, [9], "#333") +
    words(17, 18.6, [9, 10, 8, 7, 16, 11, 11, 13, 14, 12], "#666", 3.2) +
    box(0, 21.4, 160, 6.6, "#f6f6f6") +
    icons(3, 23, 18, 18, "#6a6a6a", 3, 5.2, { 1: "#f2b635", 3: "#3a78d8", 9: "#f2b635", 13: "#3a78d8", 14: "#f2b635" }) +
    box(0, 28, 160, 0.4, "#cfcfcf") +
    // the tools down the left, with OSnap under them
    icons(2, 30.4, 3, 18, "#6a6a6a", 3.4, 5.2, { 1: "#e0483b", 2: "#f2b635", 4: "#f2b635", 6: "#f2b635", 9: "#3a78d8", 13: "#f2b635", 16: "#3a78d8" }) +
    box(0, 63, 17.6, 4, "#e2e2e2") +
    words(2, 64.2, [9], "#333") +
    icons(2, 69, 1, 6, "#3a78d8", 2, 4) +
    rows(5.4, 69.2, [6, 8, 9, 6, 7, 5], "#666", 4) +
    box(17.6, 28.4, 0.4, 65, "#cfcfcf") +
    // the four viewports: Top, Perspective, Front, Right
    box(vx, vy, 104.4, 64.2, "#ffffff") +
    pane(vx, vy, 5, true, line(`M${vx} ${vy + 17}h${vw}`, "#b0453a", 0.4) + line(`M${vx + 22} ${vy}v${vh}`, "#3f9a4c", 0.4) + line(`M${vx + 13} ${vy + 9}h26v16h-26z M${vx + 24} ${vy + 9}v16`, "#1a1a1a", 0.7)) +
    pane(vx + vw + 1.2, vy, 15, false, line(`M${vx + vw + 1.2} ${vy + 6}l${vw} 22`, "#b0453a", 0.4) + line(`M${vx + vw + 1.2} ${vy + 30}l${vw} -22`, "#3f9a4c", 0.4)) +
    pane(vx, vy + vh + 1.4, 7, false, line(`M${vx} ${vy + vh + 22}h${vw}`, "#b0453a", 0.4) + line(`M${vx + 22} ${vy + vh + 1.4}v${vh}`, "#3b62c4", 0.4)) +
    pane(vx + vw + 1.2, vy + vh + 1.4, 7, false, line(`M${vx + vw + 1.2} ${vy + vh + 22}h${vw}`, "#3f9a4c", 0.4) + line(`M${vx + vw + 23} ${vy + vh + 1.4}v${vh}`, "#3b62c4", 0.4)) +
    // the panels on the right
    box(122.4, 28.4, 0.4, 65, "#cfcfcf") +
    box(122.8, 28.4, 37.2, 65, "#f7f7f7") +
    box(124, 29.6, 13, 4.4, "#e1e1e1", 1) +
    words(126, 31, [9], "#333") +
    words(139, 31, [6, 6, 5], "#777", 2.2) +
    rows(126, 40, [18, 12, 24, 16], "#8a8a8a") +
    // the viewport tabs and the status bar
    box(0, 93.4, 160, 0.4, "#cfcfcf") +
    box(1, 93.8, 13, 3.4, "#e6e6e6") + box(15, 93.8, 7, 3.4, "#ffffff") + box(23, 93.8, 8, 3.4, "#e6e6e6") + box(32, 93.8, 8, 3.4, "#e6e6e6") +
    box(0, 97.2, 160, 2.8, "#e9e9e9") +
    words(2, 97.9, [26, 14], "#666", 4, 1.3) +
    words(98, 97.9, [9, 6, 7], "#666", 3, 1.3) +
    box(124, 97.4, 8, 2.4, "#c4c4c4", 0.6) +
    words(134, 97.9, [10, 9], "#999", 3, 1.3)
  );
}

function sketchup(): string {
  const cx = 9.6;
  const cw = 112.8;
  return (
    `<defs><linearGradient id="lk-thumb-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#43aee6"/><stop offset="1" stop-color="#c9e8f7"/></linearGradient></defs>` +
    box(0, 0, 160, 100, "#f3f3f3") +
    words(3, 1.8, [4, 4, 5, 8, 5, 6, 8, 11, 5], "#555", 2.8) +
    box(0, 5, 160, 0.4, "#d6d6d6") +
    // the toolbar across the top
    icons(2, 7, 14, 14, "#6a6a6a", 3.6, 6.2, { 0: "#3a78d8", 3: "#3a78d8", 4: "#e0483b", 5: "#e0483b", 6: "#f2c14e", 7: "#e0483b", 9: "#e0483b", 11: "#f2c14e" }) +
    box(0, 12.6, 160, 0.4, "#d0d0d0") +
    // the Large Tool Set down the left
    icons(1.2, 15, 2, 22, "#6a6a6a", 3, 4.2, { 0: "#3a78d8", 3: "#f2c14e", 4: "#3a78d8", 5: "#e0483b", 6: "#e0483b", 8: "#e0483b", 10: "#f2c14e", 11: "#e0483b", 14: "#e0483b", 17: "#e0483b" }) +
    box(cx - 0.4, 13, 0.4, 83, "#d0d0d0") +
    // the model: sky over the ground, the three axes and a small house
    box(cx, 13, cw, 30, "url(#lk-thumb-sky)") +
    box(cx, 43, cw, 53, "#c3c4c9") +
    line(`M66 13v52`, "#2d47e0", 0.5) +
    line(`M66 65v31`, "#2d47e0", 0.5, `stroke-dasharray="2.4 1.8"`) +
    line(`M66 65L${cx + cw} 78`, "#e03b30", 0.5) +
    line(`M66 65L${cx} 54`, "#e03b30", 0.5, `stroke-dasharray="2.4 1.8"`) +
    line(`M66 65L${cx + cw} 52`, "#2f9a4a", 0.5) +
    line(`M66 65L${cx + 6} 78`, "#2f9a4a", 0.5, `stroke-dasharray="2.4 1.8"`) +
    `<path d="M40 76V58l18-6 0 18z" fill="#ffffff" stroke="#2a2a2a" stroke-width="0.6" stroke-linejoin="round"/>` +
    `<path d="M58 70V52l22 5v18z" fill="#e9e9ee" stroke="#2a2a2a" stroke-width="0.6" stroke-linejoin="round"/>` +
    `<path d="M40 58l10-10 18-6-10 10z" fill="#c9705a" stroke="#2a2a2a" stroke-width="0.6" stroke-linejoin="round"/>` +
    `<path d="M58 52l10-10 22 5-10 10z" fill="#b65f4b" stroke="#2a2a2a" stroke-width="0.6" stroke-linejoin="round"/>` +
    `<path d="M46 74v-9l5-1.6v9z" fill="#7b5a44" stroke="#2a2a2a" stroke-width="0.4"/>` +
    // the Default Tray
    box(122.4, 13, 0.4, 83, "#d0d0d0") +
    box(122.8, 13, 37.2, 83, "#f6f6f6") +
    words(125, 15, [18], "#333") +
    box(122.8, 19, 37.2, 4.4, "#e4e4ea") +
    words(127, 20.4, [16], "#333") +
    box(125, 25.4, 10, 4, "#e2e2e2", 1) +
    rows(125, 33, [22, 12, 26], "#909090", 4.6) +
    box(122.8, 49, 37.2, 4.4, "#e4e4ea") +
    words(127, 50.4, [14], "#333") +
    rows(125, 57, [18, 28], "#909090", 4.6) +
    box(125, 67, 14, 4.4, "#e9e9e9", 1) + box(141, 67, 14, 4.4, "#e9e9e9", 1) +
    box(125, 76, 26, 1.2, "#1a7fe0", 0.6) + box(150, 74.8, 3.6, 3.6, "#1a7fe0", 1.8) +
    box(125, 83, 14, 4.4, "#e9e9e9", 1) + box(141, 83, 14, 4.4, "#e9e9e9", 1) +
    // the status row with Measurements
    box(0, 96, 160, 0.4, "#d0d0d0") +
    icons(2, 97.2, 4, 4, "#777", 1.8, 3.4) +
    words(18, 97.4, [50], "#666", 3, 1.4) +
    words(124, 97.4, [14], "#555", 3, 1.4) +
    `<rect x="140" y="96.9" width="18" height="2.5" fill="#ffffff" stroke="#bdbdbd" stroke-width="0.3"/>`
  );
}

function archicad(): string {
  const toolRows = (y: number, n: number, selected = -1): string => {
    let out = "";
    for (let i = 0; i < n; i++) {
      const ry = y + i * 4.4;
      if (i === selected) out += box(0.8, ry - 1.1, 25, 4, "#c5dbf7", 0.6);
      out += box(2.6, ry - 0.3, 2.4, 2.4, i === selected ? "#1f6fd1" : "#3d5a80", 0.5) + box(7, ry, 7 + ((i * 5) % 9), 1.6, "#555", 0.8);
    }
    return out;
  };
  return (
    box(0, 0, 160, 100, "#f1f1f1") +
    words(3, 1.8, [4, 4, 5, 7, 10, 8, 10, 8, 5], "#555", 2.8) +
    box(0, 5, 160, 0.4, "#d6d6d6") +
    // the toolbar, then the Info Box
    icons(3, 6.8, 16, 16, "#707070", 2.6, 5.4, { 2: "#d59a2b", 3: "#d59a2b", 13: "#d59a2b" }) +
    box(0, 11, 160, 0.4, "#d6d6d6") +
    box(0, 11.4, 160, 10.6, "#f6f6f6") +
    words(2, 13, [7], "#777") + words(2, 17.4, [18], "#444") +
    line("M30 11.4v10.6 M72 11.4v10.6 M128 11.4v10.6", "#d6d6d6", 0.4) +
    words(32, 13, [11], "#777") +
    box(32, 15.8, 13, 4.4, "#c5dbf7", 1) + words(47, 17.4, [9, 6], "#555", 4) +
    words(74, 13, [22], "#777") +
    box(74, 15.8, 14, 4.4, "#c5dbf7", 1) + words(90, 17.4, [14, 16], "#555", 3) +
    box(0, 22, 160, 0.4, "#cfcfcf") +
    // the Toolbox
    box(0, 22.4, 26.8, 71, "#f1f1f1") +
    words(2, 24, [11], "#333") +
    toolRows(29.4, 2, 0) +
    box(0.8, 38.4, 25, 3.8, "#e1e1e1", 0.6) + words(4, 39.6, [9], "#333") +
    toolRows(45.4, 7) +
    box(0.8, 76.6, 25, 3.8, "#e1e1e1", 0.6) + words(4, 77.8, [13], "#333") +
    toolRows(83.6, 2) +
    box(26.8, 22.4, 0.4, 71, "#cfcfcf") +
    // the drawing under its tab
    box(27.2, 22.4, 95.2, 6, "#ececec") +
    box(28.4, 23.2, 20, 4.8, "#ffffff", 1) +
    words(30.4, 24.8, [12], "#444") +
    box(27.2, 28.4, 95.2, 64.6, "#ffffff") +
    plan(56, 46, "#111", 1) +
    // the Navigator, with Properties under it
    box(122.4, 22.4, 0.4, 71, "#cfcfcf") +
    box(122.8, 22.4, 37.2, 71, "#f7f7f7") +
    box(124, 23.6, 14, 4.4, "#e1e1e1", 1) + words(126, 25, [10], "#333") + words(141, 25, [9], "#777") +
    words(124, 31.6, [22], "#222") +
    rows(126, 36, [9], "#444", 4) + rows(129, 40, [22], "#111", 4) + rows(126, 44, [10], "#555", 4) + rows(126, 48, [13], "#555", 4) + rows(126, 52, [22], "#555", 4) + rows(126, 56, [16], "#555", 4) +
    box(122.8, 62, 37.2, 0.4, "#d6d6d6") +
    words(125, 65, [14], "#222") +
    box(124, 69.4, 10, 4, "#e1e1e1", 1) + words(136, 70.6, [6, 8], "#777", 3) +
    rows(125, 78, [18, 12], "#909090", 4.6) +
    // Quick Options and the status bar
    box(0, 93, 160, 0.4, "#cfcfcf") +
    words(3, 94.4, [7, 8], "#555", 3, 1.4) + box(26, 93.8, 22, 2.8, "#e4e4e4", 0.6) + icons(54, 94, 4, 4, "#777", 2, 4.4) +
    box(0, 96.8, 160, 3.2, "#e9e9e9") +
    words(3, 97.8, [44], "#666", 3, 1.3)
  );
}

function illustrator(): string {
  const text = "rgba(255,255,255,0.75)";
  const dim = "rgba(255,255,255,0.38)";
  return (
    box(0, 0, 160, 100, "#262626") +
    words(4, 2.2, [4, 4, 7, 5, 7, 7, 5, 8, 5], text, 3) +
    box(0, 6, 160, 0.4, "#1a1a1a") +
    // the Control bar
    box(0, 6.4, 160, 6, "#2e2e2e") +
    icons(3, 8, 1, 1, text, 2.6) +
    words(8, 8.6, [8, 11], text, 3) +
    box(32, 7.4, 16, 4, "#1c1c1c", 0.8) +
    words(52, 8.6, [22], dim) +
    box(77, 7.4, 16, 4, "#1c1c1c", 0.8) +
    box(0, 12.4, 160, 0.4, "#1a1a1a") +
    // the single column of tools, with Fill and Stroke at its foot
    icons(2.6, 15.4, 1, 3, text, 3, 5.6, { 0: "#ffffff" }) +
    box(1.6, 14.2, 5, 5, "rgba(255,255,255,0.14)", 1) +
    box(1.6, 32.2, 5, 0.3, "#555") +
    icons(2.6, 34.4, 1, 5, text, 3, 5.6) +
    box(1.6, 62.2, 5, 0.3, "#555") +
    icons(2.6, 64.4, 1, 3, text, 3, 5.6) +
    `<rect x="3.6" y="84.4" width="4" height="4" fill="none" stroke="#ffffff" stroke-width="1"/>` +
    box(1.4, 82.2, 4.2, 4.2, "#ffffff") +
    line("M1.4 86.4l4.2 -4.2", "#e0342b", 0.5) +
    box(8.6, 12.8, 0.4, 82.6, "#1a1a1a") +
    // the artboard on its dark surround, under the document's tab
    box(9, 12.8, 113, 82.6, "#1e1e1e") +
    box(9, 12.8, 113, 5, "#262626") +
    box(10.4, 13.2, 20, 4.6, "#323232", 1) +
    words(12.4, 14.8, [12], text) +
    box(18, 22, 94, 70, "#ffffff") +
    `<path d="M40 70C40 46 52 34 66 34s26 12 26 30c0 8-6 14-14 14-12 0-12-16-22-16-8 0-8 8-16 8z" fill="#ffd6c2" stroke="#e8582e" stroke-width="1"/>` +
    line("M66 34h-14 M66 34h14", "#3a8cf0", 0.4) +
    box(64.8, 32.8, 2.4, 2.4, "#ffffff") + `<rect x="64.8" y="32.8" width="2.4" height="2.4" fill="none" stroke="#3a8cf0" stroke-width="0.5"/>` +
    `<circle cx="52" cy="34" r="1" fill="#3a8cf0"/><circle cx="80" cy="34" r="1" fill="#3a8cf0"/>` +
    `<rect x="90.8" y="62.8" width="2.4" height="2.4" fill="#ffffff" stroke="#3a8cf0" stroke-width="0.5"/>` +
    `<rect x="38.8" y="68.8" width="2.4" height="2.4" fill="#ffffff" stroke="#3a8cf0" stroke-width="0.5"/>` +
    // Properties, Layers and Libraries
    box(122, 12.8, 0.4, 82.6, "#1a1a1a") +
    box(124, 14.6, 14, 4.6, "rgba(255,255,255,0.14)", 1) +
    words(126, 16.1, [10], "#ffffff") +
    words(141, 16.1, [7, 9], dim, 2.4) +
    rows(125, 25, [18, 12, 24], dim, 4.6) +
    box(122.4, 40, 37.6, 5.4, "#2e2e2e") +
    words(125, 42, [16], text) +
    rows(125, 50, [14], dim) +
    box(125, 54, 15, 4.4, "#1c1c1c", 0.8) + box(142, 54, 15, 4.4, "#1c1c1c", 0.8) +
    box(125, 64, 24, 1.2, "#4a9cf5", 0.6) + box(148, 62.8, 3.6, 3.6, "#4a9cf5", 1.8) +
    box(125, 71, 15, 4.4, "#1c1c1c", 0.8) + box(142, 71, 15, 4.4, "#1c1c1c", 0.8) +
    box(125, 81, 24, 1.2, "#4a9cf5", 0.6) + box(148, 79.8, 3.6, 3.6, "#4a9cf5", 1.8) +
    // the status bar
    box(0, 95.4, 160, 4.6, "#2e2e2e") +
    box(2, 96.2, 12, 3, "#1c1c1c", 0.6) + box(18, 96.2, 12, 3, "#1c1c1c", 0.6) + box(40, 96.2, 26, 3, "#1c1c1c", 0.6) +
    words(72, 97, [18, 40], dim, 4, 1.4)
  );
}

const DRAW: Record<LookId, () => string> = { rodeo, archicad, autocad, illustrator, revit, rhino, sketchup, vectorworks };

/** The picture of a look, as SVG markup that fills its box. */
export function lookThumb(id: LookId): string {
  return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${DRAW[id]()}</svg>`;
}
