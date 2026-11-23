// The converter page (rodeo.build/convert and its pairs): drop CAD and 3D files, see what each holds,
// and convert it to another format in this browser. A worker reads and writes the files (worker.ts),
// so the page stays live. Nothing is uploaded: the one request beyond the page's own files is an
// anonymous visit count, the same one the editor sends. Each file is a row with its status, its
// downloads and its problems; the file picked also shows a preview and its facts.

import { h } from "../../app/dom.ts";
import { language, startLanguage } from "../../app/i18n.ts";
import { canvasBlob, MAX_PNG_SIDE, svgToPng } from "../../export/png.ts";
import { zipFiles } from "../../export/zip.ts";
import { summaryLine } from "../describe.ts";
import { formatById, formatOfName } from "../formats.ts";
import type { DrawingSummary, Unit } from "../types.ts";
import { handOff } from "./handoff.ts";
import type { PreviewMesh } from "./preview3d.ts";
import { type ConvertCase, renderCheck } from "./report.ts";
import type { FromWorker, ToWorker } from "./worker.ts";

// the interface in the language chosen in the editor (or the browser's), as the page builds
void startLanguage().then(offerOwnLanguage);

/**
 * On an English page, for a visitor whose interface is in another language: a link to this page in that
 * language (rodeo.build/de/convert/…), beside the editor's. A page in another language already is one.
 */
function offerOwnLanguage(): void {
  const lang = language();
  if (lang.code === "en" || document.documentElement.dataset.pageLang) return;
  if (!/^\/(convert|viewer)(\/|$)/.test(location.pathname)) return;
  const editor = document.querySelector(".cv-top .cv-top-link");
  if (!editor) return;
  const href = `/${lang.code.toLowerCase()}${location.pathname}${location.search}`;
  editor.before(h("a", { cls: "cv-top-link cv-own-lang", text: "This page in your language", attrs: { href, hreflang: lang.code } }));
}

/** The localStorage key of the format picked last. */
const CHOICE_KEY = "openvwx.convert.to";
/** The format the page starts on when the path, the query and the last pick name none. */
const FALLBACK_TO = "pdf";
/** The Convert to menu, in its groups: a format's id, or "png", which the page draws from the plan. */
const MENU: readonly (readonly [string, readonly string[]])[] = [
  ["Drawing", ["vwx"]],
  ["2D", ["pdf", "svg", "dxf", "eps", "emf", "png"]],
  ["3D", ["ifc", "skp", "3dm", "glb", "obj", "fbx", "dae", "stl", "ply", "3ds", "usdz", "step", "iges"]],
];
const CHOICES = new Set(MENU.flatMap(([, ids]) => ids));
/** A PNG is this many pixels wide, or as tall as MAX_PNG_SIDE allows for a drawing taller than it is wide. */
const PNG_WIDTH = 3000;
/** A file this large may run the browser out of memory: the page says so, and still reads it. */
const LARGE_FILE = 1024 ** 3;
/** Formats whose files don't say their units or which way is up: the page asks, and reads them again when asked. */
const ASKS = new Set(["obj", "stl", "ply", "3ds"]);
const UNITS: readonly Unit[] = ["mm", "cm", "m", "in", "ft"];
/** The layers and object types the facts list by name before "and N more". */
const LAYERS_SHOWN = 5;
const TYPES_SHOWN = 5;
/** What the page says when the worker stopped on a file, most likely for want of memory. */
const OUT_OF_MEMORY = "Your browser ran out of memory reading this file. The command line has more room:";
/** A picture in the strip is this many CSS pixels; it is drawn at twice that, so it stays sharp on a dense screen. */
const TILE_W = 112;
const TILE_H = 84;
/** A converted file bigger than this is not read back for a preview: its tile says so. */
const PEEK_BYTES = 300 * 1024 * 1024;
const TOO_LARGE = "Too large to preview";
/** What a converted file's tile says when the file can't be read back. The reason follows in the tile's text and in afterError. */
const READ_BACK = "Couldn't read the converted file back";
/** Which side of a file the big preview shows: the file as it was, or the file converted to the format picked. */
type Side = "before" | "after";

/** A converted file the page keeps: its bytes, what the writer left out, and a link to download it. */
interface Result {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly notes: readonly string[];
  readonly url: string;
}

/** What a converted file shows on the page: its picture, the read-back plan, model and summary, or why there are none. */
interface After {
  /** the small picture for the strip (a PNG), or null */
  readonly picture: Blob | null;
  /** the whole converted file as an image, for an SVG or a PNG, which the big preview shows as it is */
  readonly image: Blob | null;
  /** the plan read back from the converted file, or null */
  readonly svg: string | null;
  /** the model read back from the converted file, or null */
  readonly mesh: PreviewMesh | null;
  /** the summary read back from the converted file, or null when it was not read back */
  readonly summary: DrawingSummary | null;
  /** what the tile says when there is no picture */
  readonly note: string;
  /** why the converted file couldn't be read back, or null */
  readonly error: string | null;
}

/** An after with nothing to show but its note (and the reason it couldn't be read back, if it wasn't). */
function noneAfter(note: string, error: string | null = null): After {
  return { picture: null, image: null, svg: null, mesh: null, summary: null, note, error };
}

/** Keeps a converted file, with its download link made once. */
function makeResult(name: string, mime: string, bytes: Uint8Array, notes: readonly string[]): Result {
  return { name, bytes, notes: [...notes], url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })) };
}

/** A request the worker never answered: it stopped first, or while it ran. The page reads the file again. */
class Lost extends Error {
  constructor() {
    super("The converter restarted: try again");
  }
}

/** A request waiting for the worker: whose it is, what it asks, and where its answer goes. */
interface Job {
  readonly owner: Row;
  readonly message: ToWorker;
  readonly transfer: Transferable[];
  readonly progress: ((step: string) => void) | null;
  readonly resolve: (reply: FromWorker) => void;
  readonly reject: (err: Error) => void;
}

/**
 * The converter's one worker, with its requests run one at a time, in order. The worker runs one
 * request at a time anyway, so waiting here costs nothing, and an answer always belongs to the request
 * in flight. When the worker stops (a browser out of memory), its drawings are gone: the request in
 * flight goes to `crashed` with its owner, and every other request is cancelled with Lost.
 */
class Client {
  private worker: Worker | null = null;
  private queue: Job[] = [];
  private inFlight: Job | null = null;

  private readonly crashed: (owner: Row | null) => void;

  constructor(crashed: (owner: Row | null) => void) {
    this.crashed = crashed;
  }

  /** Sends a request and resolves with its answer; `progress` hears each step of a read. */
  run(owner: Row, message: ToWorker, progress: ((step: string) => void) | null = null, transfer: Transferable[] = []): Promise<FromWorker> {
    return new Promise((resolve, reject) => {
      this.queue.push({ owner, message, transfer, progress, resolve, reject });
      this.pump();
    });
  }

  /** Tells the worker to forget a drawing. No answer comes back. */
  drop(id: number): void {
    this.worker?.postMessage({ type: "drop", id } satisfies ToWorker);
  }

  /** Sends the next request, when none is in flight. */
  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return;
    const job = this.queue.shift() as Job;
    this.inFlight = job;
    this.worker ??= this.start();
    this.worker.postMessage(job.message, job.transfer);
  }

  /** Starts a worker. Only the current one's messages and failures are heard; a stopped one's are not. */
  private start(): Worker {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      if (worker === this.worker) this.receive(e.data);
    };
    worker.onerror = () => {
      if (worker === this.worker) this.stopped();
    };
    worker.onmessageerror = () => {
      if (worker === this.worker) this.stopped();
    };
    return worker;
  }

  /** Hands an answer to the request in flight, then sends the next. */
  private receive(reply: FromWorker): void {
    const job = this.inFlight;
    if (!job) return;
    if (reply.type === "progress") {
      job.progress?.(reply.step);
      return;
    }
    this.inFlight = null;
    if (reply.type === "error") job.reject(new Error(reply.message));
    else job.resolve(reply);
    this.pump();
  }

  /** The worker stopped: it is replaced, and the request in flight is its owner's to answer for. */
  private stopped(): void {
    const job = this.inFlight;
    const waiting = this.queue.splice(0);
    this.inFlight = null;
    this.worker?.terminate();
    this.worker = null;
    // a read-back that stopped the worker is refused for good, so that it isn't tried again after each restart
    if (job) job.reject(job.message.type === "peek" ? new Error("the converter stopped reading the file back, most likely for want of memory") : new Lost());
    for (const j of waiting) j.reject(new Lost());
    // a read-back owns no file on the page: its failure is its own, and the files are read again
    this.crashed(job && job.message.type !== "peek" ? job.owner : null);
  }
}

const client = new Client(onCrash);

/**
 * A tile of a file's strip: a small picture, or a note in its place, its caption under it, and a click
 * that shows its side of the file in the preview. The picture's object URL is released when it changes.
 */
class Tile {
  readonly el: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly box: HTMLElement;
  private readonly cap: HTMLElement;
  private url: string | null = null;
  // what the tile shows now, so a redraw of the same thing costs nothing
  private blob: Blob | null = null;
  private note = "";
  private warn = false;
  private loading = false;

  constructor(side: Side, caption: string, pick: () => void) {
    this.box = h("span", { cls: "cv-tile-box" });
    this.button = h("button", { cls: "cv-tile", attrs: { type: "button" } }, this.box);
    this.button.addEventListener("click", pick);
    this.cap = h("span", { cls: "cv-tile-cap", text: caption });
    this.el = h("div", { cls: `cv-tile-wrap cv-tile-${side}` }, this.button, this.cap);
    this.setCaption(caption);
  }

  /** Sets the caption under the tile, which is also the name the tile is picked by. */
  setCaption(text: string): void {
    this.cap.textContent = text;
    this.button.setAttribute("aria-label", `${text} preview`);
  }

  /** Shows a picture, or a note in its place (a warning when `warn`), or the busy state while `loading`. */
  show(s: { blob?: Blob | null; note?: string; warn?: boolean; loading?: boolean }): void {
    const blob = s.blob ?? null;
    const note = s.note ?? "";
    const warn = s.warn === true;
    const loading = s.loading === true;
    if (blob === this.blob && note === this.note && warn === this.warn && loading === this.loading) return;
    this.blob = blob;
    this.note = note;
    this.warn = warn;
    this.loading = loading;
    this.release();
    this.button.classList.toggle("is-loading", loading);
    if (blob) {
      this.url = URL.createObjectURL(blob);
      this.box.replaceChildren(h("img", { attrs: { src: this.url, alt: "" } }));
    } else {
      this.box.replaceChildren(h("span", { cls: warn ? "cv-tile-note is-warn" : "cv-tile-note", text: note }));
    }
  }

  /** Releases the picture's link: the tile is being removed. */
  dispose(): void {
    this.release();
    this.blob = null;
    this.box.replaceChildren();
  }

  private release(): void {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}

/**
 * A small picture of a file: a still of its model when it has one, else its plan drawn small. Null when
 * neither can be drawn. A browser without WebGL gets the plan; the still's module loads only when needed.
 */
async function pictureOf(mesh: PreviewMesh | null, svg: string | null): Promise<Blob | null> {
  if (mesh) {
    try {
      const { thumb3d } = await import("./thumb.ts");
      return await thumb3d(mesh, TILE_W * 2, TILE_H * 2);
    } catch {
      // no WebGL, or a model that won't draw: the plan below stands in for it
    }
  }
  if (!svg) return null;
  try {
    return await svgToPng(svg, TILE_W * 2, TILE_H * 2);
  } catch {
    return null;
  }
}

/** The tile's note for a format with no picture: "No preview for EPS". */
function noPreviewText(format: string): string {
  return `No preview for ${formatLabel(format)}`;
}

/** A count and its word, as the comparison line says it: "1 object", "1,234 objects". */
function countOf(n: number, word: string): string {
  return `${fmt(n)} ${n === 1 ? word : `${word}s`}`;
}

/** What a drawing holds in brief, for the comparison line: "1,234 objects · 12 layers". */
function contentsOf(s: DrawingSummary): string {
  return `${countOf(s.totalObjects, "object")} · ${countOf(s.layers.length, "layer")}`;
}

/** A file on the page: its read, what the read says (a summary, a plan and a 3D model), and what it converts to, by format. */
export class Row {
  readonly file: File;
  readonly name: string;
  readonly el: HTMLLIElement;
  /** the units and up axis the file is read with */
  units: Unit;
  yUp: boolean;
  /** the drawing the worker holds for this file, 0 when it holds none */
  readId = 0;
  /** counts the reads and resets: an answer to an earlier one is thrown away */
  gen = 0;
  /** true while a read waits its turn, so the file isn't queued twice */
  queued = false;
  removed = false;
  state: "reading" | "ready" | "failed" = "reading";
  step = "Reading the file";
  summary: DrawingSummary | null = null;
  svg: string | null = null;
  mesh: PreviewMesh | null = null;
  /** the preview tab the file opens on */
  tab: "3d" | "plan" = "3d";
  /** the side of the preview the file shows: the file as it was, or the converted file for the format picked */
  side: Side = "before";
  /** why the file can't be read, or null */
  readError: string | null = null;
  /** true when the browser ran out of memory on the file, so the page offers the command line */
  outOfMemory = false;
  /** why the file didn't open in the editor, or null */
  openError: string | null = null;
  /** why each format couldn't be made, by format */
  readonly errors = new Map<string, string>();
  /** the formats being made now */
  readonly pending = new Set<string>();
  /** the files made, by format */
  readonly results = new Map<string, Result>();
  /** what each converted file shows, by format, once it is checked by reading it back */
  readonly afters = new Map<string, After>();
  /** the formats being checked now */
  private readonly checking = new Set<string>();
  /** the small picture of the file as it was read, or null until it is made */
  private beforePic: Blob | null = null;
  /** true while that picture is being made */
  private beforeMaking = false;
  /** counts the picture makes: an answer to an earlier one is thrown away */
  private picSeq = 0;
  private readonly beforeTile = new Tile("before", "Original", () => showSide(this, "before"));
  private readonly afterTile = new Tile("after", "", () => showSide(this, "after"));
  private readonly compareEl: HTMLElement = h("p", { cls: "cv-compare", hidden: true });
  /** an empty place under the strip, for the file check that goes there */
  readonly checkEl: HTMLElement = h("div", { cls: "cv-file-check" });

  private readonly statusEl: HTMLElement;
  private readonly stripEl: HTMLElement;
  private readonly notesEl: HTMLElement;
  private readonly errorEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  constructor(file: File) {
    this.file = file;
    this.name = file.name;
    const id = formatOfName(file.name);
    // the defaults an STL or an OBJ is read with, as the readers take them when the file doesn't say
    this.units = id === "stl" ? "mm" : "m";
    this.yUp = id === "obj";
    this.statusEl = h("div", { cls: "cv-file-status" });
    this.stripEl = h(
      "div",
      { cls: "cv-strip" },
      this.beforeTile.el,
      h("span", { cls: "cv-arrow", text: "→", attrs: { "aria-hidden": "true" } }),
      this.afterTile.el,
      this.compareEl,
    );
    this.notesEl = h("p", { cls: "cv-file-notes", hidden: true });
    this.errorEl = h("p", { cls: "cv-file-error", hidden: true, attrs: { role: "alert" } });
    this.actionsEl = h("div", { cls: "cv-file-actions" });
    const children: Node[] = [
      h("div", { cls: "cv-file-head" }, h("span", { cls: "cv-file-name", text: file.name }), h("span", { cls: "cv-file-size", text: sizeText(file.size) })),
      this.statusEl,
      this.stripEl,
      this.checkEl,
      this.notesEl,
    ];
    if (id && ASKS.has(id)) children.push(this.optionsBar());
    if (file.size >= LARGE_FILE) children.push(h("p", { cls: "cv-note", text: "Large file: your browser may run out of memory. The command line has more room." }));
    children.push(this.errorEl, this.actionsEl);
    this.el = h("li", { cls: "cv-file" }, ...children);
    this.el.dataset.side = this.side;
    this.el.addEventListener("click", (e) => {
      // a control in the row does its own thing; a click on the rest of the row picks the file for the preview
      if (e.target instanceof Element && e.target.closest("button, a, select, input, label")) return;
      selectFile(this);
      // on a narrow screen the preview sits under the list, so bring it into view
      if (matchMedia("(max-width: 899px)").matches) previewEl.scrollIntoView({ block: "start" });
    });
    this.render();
  }

  /** The small picture of the file as it was read (a still of its model, else its plan), or null when there is none or it isn't read. */
  beforePicture(): Blob | null {
    return this.beforePic;
  }

  /** The small picture of the file converted to `format` (a PNG), or null when there is none. */
  afterPicture(format: string): Blob | null {
    return this.afters.get(format)?.picture ?? null;
  }

  /** The summary of the file converted to `format`, read back from the converted bytes, or null when it wasn't read back. */
  afterSummary(format: string): DrawingSummary | null {
    return this.afters.get(format)?.summary ?? null;
  }

  /** Why the file converted to `format` couldn't be read back, or null when it could, or was never checked. */
  afterError(format: string): string | null {
    return this.afters.get(format)?.error ?? null;
  }

  /** The units and up axis of a file that doesn't say its own: changing either reads the file again. */
  private optionsBar(): HTMLElement {
    const units = h("select", { cls: "cv-select", attrs: { "aria-label": "Units" } }, ...UNITS.map((u) => h("option", { text: u, value: u })));
    units.value = this.units;
    const up = h("input", { checked: this.yUp, attrs: { type: "checkbox" } });
    units.addEventListener("change", () => this.setOptions(units.value as Unit, up.checked));
    up.addEventListener("change", () => this.setOptions(units.value as Unit, up.checked));
    return h(
      "div",
      { cls: "cv-file-opts" },
      h("label", { cls: "cv-field" }, h("span", { text: "Units" }), units),
      h("label", { cls: "cv-check" }, up, h("span", { text: "Y is up" })),
    );
  }

  /** Sets the units and up axis, then reads the file again with them: its drawing and conversions go. */
  private setOptions(units: Unit, yUp: boolean): void {
    if (units === this.units && yUp === this.yUp) return;
    this.units = units;
    this.yUp = yUp;
    this.dropDrawing();
    this.clearConversions();
    this.summary = null;
    this.svg = null;
    this.mesh = null;
    this.readError = null;
    this.outOfMemory = false;
    this.state = "reading";
    this.step = "Reading the file";
    this.render();
    if (selected === this) renderPreview();
    refreshBar();
    queueRead(this);
  }

  /** Sends the file's bytes to the worker and takes the drawing it makes. Reads run in turn (see queueRead). */
  async read(): Promise<void> {
    this.queued = false;
    if (this.removed) return;
    const gen = ++this.gen;
    this.state = "reading";
    this.step = "Reading the file";
    this.readError = null;
    this.outOfMemory = false;
    this.clearBefore();
    this.render();

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await this.file.arrayBuffer());
    } catch (err) {
      if (gen === this.gen && !this.removed) this.fail(`Could not read ${this.name}: ${messageOf(err)}`);
      return;
    }
    if (gen !== this.gen || this.removed) return;

    try {
      const reply = await client.run(
        this,
        { type: "read", id: ++readSeq, name: this.name, bytes, options: { units: this.units, yUp: this.yUp } },
        (step) => {
          if (gen !== this.gen) return;
          this.step = step;
          this.renderStatus();
        },
        [bytes.buffer],
      );
      if (reply.type !== "read") throw new Error("the converter answered out of turn");
      if (gen !== this.gen || this.removed) {
        client.drop(reply.id);
        return;
      }
      this.readId = reply.id;
      this.summary = reply.summary;
      this.svg = reply.svg;
      this.mesh = reply.mesh;
      this.tab = reply.mesh ? "3d" : "plan";
      this.state = "ready";
      void this.makeBefore();
      this.render();
      if (selected === this) renderPreview();
      refreshBar();
      void this.convert(chosen);
    } catch (err) {
      if (err instanceof Lost || gen !== this.gen || this.removed) return;
      this.fail(messageOf(err));
    }
  }

  /** Marks the file as failed, with the reason; `outOfMemory` makes the page offer the command line. */
  fail(message: string, outOfMemory = false): void {
    this.dropDrawing();
    this.clearConversions();
    this.clearBefore();
    this.state = "failed";
    this.readError = message;
    this.outOfMemory = outOfMemory;
    this.render();
    if (selected === this) renderPreview();
    refreshBar();
  }

  /** The worker stopped and took its drawings with it: a file that isn't failed goes back to reading. */
  forgetDrawing(): void {
    if (this.removed || this.readError !== null) return;
    this.readId = 0;
    this.pending.clear();
    this.summary = null;
    this.svg = null;
    this.mesh = null;
    this.clearBefore();
    this.state = "reading";
    this.step = "Reading the file";
    this.render();
  }

  /** Whether the file is still on the page and not failed, so a read after a restart is worth asking for. */
  canRead(): boolean {
    return !this.removed && this.readError === null;
  }

  /** Takes the file off the page: its drawing, pictures and conversions go. */
  dispose(): void {
    this.removed = true;
    this.dropDrawing();
    this.clearConversions();
    this.clearBefore();
    this.beforeTile.dispose();
    this.afterTile.dispose();
    this.el.remove();
  }

  /** Tells the worker to forget this file's drawing. */
  dropDrawing(): void {
    if (this.readId) client.drop(this.readId);
    this.readId = 0;
  }

  /** Forgets the conversions: their links are released, and one still running is thrown away when it answers. */
  clearConversions(): void {
    for (const made of this.results.values()) URL.revokeObjectURL(made.url);
    this.results.clear();
    this.errors.clear();
    this.pending.clear();
    this.afters.clear();
    this.checking.clear();
    this.gen++;
  }

  /** Forgets the original's picture: a new one is made when the file is read again. */
  private clearBefore(): void {
    this.picSeq++;
    this.beforePic = null;
    this.beforeMaking = false;
  }

  /** Makes the picture of the file as it was read. An answer to an earlier read's picture is thrown away. */
  private async makeBefore(): Promise<void> {
    const seq = ++this.picSeq;
    this.beforeMaking = true;
    this.renderStrip();
    const picture = await pictureOf(this.mesh, this.svg);
    if (seq !== this.picSeq || this.removed) return;
    this.beforePic = picture;
    this.beforeMaking = false;
    this.renderStrip();
  }

  /**
   * Makes the file in `format`, unless it has been made or is being made. A result stays until the file is read
   * again or its units change. A made file is only checked again: its check may have been lost to a restart.
   */
  async convert(format: string): Promise<void> {
    if (this.state !== "ready" || this.pending.has(format)) return;
    if (this.results.has(format)) {
      void this.checkResult(format);
      return;
    }
    const gen = this.gen;
    this.pending.add(format);
    this.errors.delete(format);
    this.render();
    refreshBar();
    try {
      const made = format === "png" ? await this.png() : await this.makeIn(format);
      if (gen !== this.gen) {
        URL.revokeObjectURL(made.url);
        return;
      }
      this.results.set(format, made);
      void this.checkResult(format);
    } catch (err) {
      if (gen === this.gen && !(err instanceof Lost)) this.errors.set(format, messageOf(err));
    } finally {
      if (gen === this.gen) this.pending.delete(format);
      this.render();
      refreshBar();
    }
  }

  /** Shows the file as it is now: its strip, its status, the writer's notes, its problem and its actions. */
  render(): void {
    this.renderStrip();
    this.renderStatus();
    const made = this.results.get(chosen);
    this.notesEl.hidden = !made || made.notes.length === 0;
    this.notesEl.textContent = made ? made.notes.map((note) => `${note}.`).join(" ") : "";
    const problem = this.readError ?? this.openError ?? this.errors.get(chosen) ?? null;
    this.errorEl.hidden = problem === null;
    this.errorEl.replaceChildren();
    if (problem !== null) {
      if (this.outOfMemory) {
        const command = this.command();
        this.errorEl.append(`${problem} `, h("code", { cls: "cv-cli", text: command }), copyButton(command));
      } else {
        this.errorEl.textContent = problem;
      }
    }
    this.actionsEl.replaceChildren(...this.actions());
    this.el.classList.toggle("is-failed", this.state === "failed");
  }

  /**
   * Shows the strip: the original's picture, the converted file's picture for the format picked, and the
   * line that compares the two when both have a summary.
   */
  private renderStrip(): void {
    // a file that couldn't be read has nothing to show either side: its problem says why
    this.stripEl.hidden = this.state === "failed";
    const label = formatLabel(chosen);
    this.afterTile.setCaption(label);
    if (this.state === "reading" || this.beforeMaking) this.beforeTile.show({ loading: true });
    else this.beforeTile.show(this.beforePic ? { blob: this.beforePic } : { note: "No preview" });

    const after = this.afters.get(chosen) ?? null;
    if (!this.results.has(chosen)) this.afterTile.show(this.pending.has(chosen) ? { loading: true } : { note: this.state === "ready" ? "Not converted" : "" });
    else if (!after) this.afterTile.show(this.checking.has(chosen) ? { loading: true } : { note: "Not checked yet" });
    else if (after.picture) this.afterTile.show({ blob: after.picture });
    else this.afterTile.show({ note: after.note, warn: after.error !== null });

    const before = this.state === "ready" ? this.summary : null;
    const text = before && after?.summary ? `Original: ${contentsOf(before)} → ${label}: ${contentsOf(after.summary)}` : "";
    this.compareEl.hidden = text === "";
    this.compareEl.textContent = text;
    this.renderCheck();
  }

  /** The line under the strip that asks whether the converted file looks right, or offers to report a file that failed (report.ts). */
  private renderCheck(): void {
    const c = this.caseFor(chosen);
    if (c) renderCheck(this.checkEl, c);
    else this.checkEl.replaceChildren();
    this.checkEl.hidden = c === null;
  }

  /**
   * What a report about this file converted to `format` carries, or null while there is nothing to ask:
   * the file is still being read or converted, or its converted file is still being read back (its
   * picture and whether it opened belong in the report).
   */
  private caseFor(format: string): ConvertCase | null {
    const from = formatOfName(this.name) ?? this.name.slice(this.name.lastIndexOf(".") + 1).toLowerCase();
    if (this.state === "failed") {
      return { file: this.file, from, to: null, output: null, before: null, after: null, error: this.readError, notes: [], picture: async () => null };
    }
    if (this.state !== "ready") return null;
    const made = this.results.get(format);
    const failed = this.errors.get(format) ?? null;
    if ((!made && failed === null) || (made && !this.afters.has(format))) return null;
    const after = this.afters.get(format) ?? null;
    const before = this.beforePic;
    return {
      file: this.file,
      from,
      to: format,
      output: made ? { name: made.name, size: made.bytes.byteLength } : null,
      before: this.summary,
      after: after?.summary ?? null,
      error: failed ?? after?.error ?? null,
      notes: made?.notes ?? [],
      picture: () => pairPicture(before, after?.picture ?? null, formatLabel(format)),
    };
  }

  /**
   * Reads a converted file back and keeps what it shows: its picture, and its plan or model for the big
   * preview. The file is checked once per conversion. A check stopped by a restart is made again when the
   * format is picked again, since its read-back was never answered.
   */
  private async checkResult(format: string): Promise<void> {
    const made = this.results.get(format);
    if (!made || this.checking.has(format) || this.afters.has(format)) return;
    const gen = this.gen;
    this.checking.add(format);
    this.renderStrip();
    if (selected === this) renderPreview();
    try {
      const after = await this.afterOf(format, made);
      if (gen === this.gen && !this.removed) this.afters.set(format, after);
    } catch (err) {
      if (!(err instanceof Lost) && gen === this.gen && !this.removed) this.afters.set(format, noneAfter(READ_BACK, messageOf(err)));
    } finally {
      if (gen === this.gen) this.checking.delete(format);
      this.renderStrip();
      if (selected === this) renderPreview();
    }
  }

  /**
   * What a converted file shows: an SVG or a PNG as an image, a file the page can read back read by the
   * worker (a peek, which keeps no drawing), and anything else a note. Throws only when a restart stops it.
   */
  private async afterOf(format: string, made: Result): Promise<After> {
    if (format === "png") {
      const png = new Blob([made.bytes as BlobPart], { type: "image/png" });
      return { ...noneAfter(""), picture: png, image: png };
    }
    if (format === "svg") {
      const picture = await pictureOf(null, new TextDecoder().decode(made.bytes));
      const image = new Blob([made.bytes as BlobPart], { type: "image/svg+xml" });
      return { ...noneAfter(picture ? "" : noPreviewText(format)), picture, image };
    }
    const info = formatById(format);
    if (!info || info.readExtensions.length === 0) return noneAfter(noPreviewText(format));
    if (made.bytes.byteLength > PEEK_BYTES) return noneAfter(TOO_LARGE);
    let reply: FromWorker;
    try {
      reply = await client.run(this, { type: "peek", id: ++readSeq, name: made.name, bytes: made.bytes });
    } catch (err) {
      if (err instanceof Lost) throw err;
      return noneAfter(READ_BACK, messageOf(err));
    }
    if (reply.type !== "peeked") throw new Error("the converter answered out of turn");
    const picture = await pictureOf(reply.mesh, reply.svg);
    return {
      picture,
      image: null,
      svg: reply.svg,
      mesh: reply.mesh,
      summary: reply.summary,
      note: picture ? "" : noPreviewText(format),
      error: null,
    };
  }

  /** Shows what the file is doing: its step while it is read, or what it holds once it is. */
  private renderStatus(): void {
    const text = this.state === "reading" ? `${this.step}…` : this.state === "ready" && this.summary ? summaryLine(this.summary) : "";
    this.statusEl.textContent = text;
    this.statusEl.hidden = text === "";
  }

  /** The buttons and links under the file: its download, the conversion in progress, Open in Rodeo and Remove. */
  private actions(): Node[] {
    const out: Node[] = [];
    if (this.state === "ready") {
      const made = this.results.get(chosen);
      if (made) {
        out.push(h("a", { cls: "cv-btn cv-btn-primary", text: `Download ${made.name} (${sizeText(made.bytes.byteLength)})`, attrs: { href: made.url, download: made.name } }));
      } else if (this.pending.has(chosen)) {
        out.push(h("span", { cls: "cv-busy", text: `Converting to ${formatLabel(chosen)}…` }));
      }
      out.push(button("Open in Rodeo", () => void this.openInRodeo()));
    }
    out.push(button("Remove", () => removeRow(this), "cv-btn cv-btn-quiet"));
    return out;
  }

  /** The command that makes the chosen file on the command line, for a file the browser can't hold. */
  private command(): string {
    const id = chosen === "png" ? "pdf" : chosen;
    const ext = formatById(id)?.writeExtensions[0] ?? id;
    return `npx @rodeo.build/cli convert "${this.name}" "${baseOf(this.name)}.${ext}"`;
  }

  /** Converts the file to a .vwx and takes it into the editor, which opens in a new tab. */
  private async openInRodeo(): Promise<void> {
    this.openError = null;
    // the tab opens now, inside the click, because a browser lets a new tab through only then
    const tab = window.open("", "_blank");
    try {
      const vwx = await this.written("vwx");
      const id = await handOff(vwx.name, this.name, vwx.bytes);
      if (!tab) throw new Error("your browser blocked the new tab: allow pop-ups for this site, then try again");
      tab.location.href = `/?convert=${id}`;
    } catch (err) {
      tab?.close();
      this.openError = `Could not open ${this.name} in Rodeo: ${messageOf(err)}`;
    }
    this.render();
  }

  /** The file the worker makes from this read, in `format`. */
  private async written(format: string): Promise<Extract<FromWorker, { type: "written" }>> {
    if (!this.readId) throw new Error("the file isn't read yet");
    const reply = await client.run(this, { type: "write", id: this.readId, format });
    if (reply.type !== "written") throw new Error("the converter answered out of turn");
    return reply;
  }

  /** The file in `format` as a result the page keeps. */
  private async makeIn(format: string): Promise<Result> {
    const written = await this.written(format);
    return makeResult(written.name, written.mime, written.bytes, written.notes);
  }

  /** The plan drawn as a PNG, its shape kept. The plan text the read made is drawn, or the worker's when that was too large to keep. */
  private async png(): Promise<Result> {
    try {
      if (!this.summary?.bounds2d) throw new Error("there is no plan to draw");
      const plan = this.svg ?? new TextDecoder().decode((await this.written("svg")).bytes);
      const { width, height } = pngSize(plan);
      const blob = await svgToPng(plan, width, height);
      return makeResult(`${baseOf(this.name)}.png`, "image/png", new Uint8Array(await blob.arrayBuffer()), []);
    } catch (err) {
      throw new Error(`Could not convert to PNG: ${messageOf(err)}`);
    }
  }
}

/** Rows in the order they were dropped. */
const rows: Row[] = [];
/** The file the preview shows, or null. */
let selected: Row | null = null;
/** The format the page converts to: the Convert to menu's value. */
let chosen = FALLBACK_TO;
/** The reads, one at a time, so only one file's bytes are being copied to the worker. */
let readChain: Promise<void> = Promise.resolve();
/** The id of the latest read, which is also the id of its drawing in the worker. */
let readSeq = 0;
/** The 3D preview and the object URL of the plan or converted image on screen. Each redraw takes the last ones down first. */
let view3d: { dispose(): void } | null = null;
let imageUrl: string | null = null;
let previewGen = 0;
/** How many dragged things are over the window, so the drop zone lights up until they all leave. */
let dragDepth = 0;

const fileInput = h("input", { hidden: true, attrs: { type: "file", multiple: "" } });
const chooseBtn = button("Choose files", () => fileInput.click(), "cv-btn cv-btn-primary");
const dropEl = h(
  "div",
  { cls: "cv-drop" },
  chooseBtn,
  h("p", { cls: "cv-or", text: "or drop them here" }),
  h("p", { cls: "cv-privacy", text: "Files stay on this computer: nothing is uploaded." }),
  fileInput,
);
const toEl = h(
  "select",
  { cls: "cv-select", attrs: { id: "cv-to" } },
  ...MENU.map(([label, ids]) => h("optgroup", { attrs: { label } }, ...ids.map((id) => h("option", { text: optionText(id), value: id })))),
);
const allBtn = button("Download all (.zip)", downloadAll);
allBtn.hidden = true;
const barEl = h("div", { cls: "cv-bar" }, h("label", { cls: "cv-label", text: "Convert to", attrs: { for: "cv-to" } }), toEl, allBtn);
const listEl = h("ul", { cls: "cv-files" });
const previewEl = h("section", { cls: "cv-preview", hidden: true, attrs: { "aria-label": "Preview" } });
const resultsEl = h("div", { cls: "cv-results", hidden: true }, listEl, previewEl);

fileInput.addEventListener("change", () => {
  addFiles(Array.from(fileInput.files ?? []));
  fileInput.value = "";
});
toEl.addEventListener("change", () => chooseFormat(toEl.value));

// Files dragged over the window light up the drop zone; a drop anywhere adds them.
const carriesFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dropEl.classList.add("is-over");
});
window.addEventListener("dragleave", (e) => {
  if (!carriesFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.classList.remove("is-over");
});
window.addEventListener("dragover", (e) => {
  if (carriesFiles(e)) e.preventDefault();
});
window.addEventListener("drop", (e) => {
  if (!carriesFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.classList.remove("is-over");
  addFiles(Array.from(e.dataTransfer?.files ?? []));
});

const app = document.getElementById("cv-app");
if (!app) throw new Error("the converter page has no #cv-app");
chosen = startFormat();
toEl.value = chosen;
app.replaceChildren(dropEl, barEl, resultsEl);
pingVisit();

/** Adds the files dropped or chosen: each is a row, read in turn, and the first one picked shows its preview. */
function addFiles(files: readonly File[]): void {
  for (const file of files) {
    const row = new Row(file);
    rows.push(row);
    listEl.append(row.el);
    if (!selected) selectFile(row);
    queueRead(row);
  }
  refreshBar();
}

/** Queues a read of a file. Reads run one at a time, so a large file's bytes are copied to the worker only when its turn comes. */
function queueRead(row: Row): void {
  if (row.queued) return;
  row.queued = true;
  readChain = readChain.then(() => row.read()).catch((err: unknown) => console.error(err));
}

/** Picks the file the preview shows (null for none) and marks its row and the side it shows. */
function selectFile(row: Row | null): void {
  selected = row;
  for (const r of rows) {
    r.el.classList.toggle("is-selected", r === row);
    r.el.dataset.side = r.side;
  }
  renderPreview();
}

/** Shows one side of a file in the preview, the file as it was or as converted, and picks the file. */
function showSide(row: Row, side: Side): void {
  row.side = side;
  selectFile(row);
  // on a narrow screen the preview sits under the list, so bring it into view
  if (matchMedia("(max-width: 899px)").matches) previewEl.scrollIntoView({ block: "start" });
}

/** Takes a file off the page: its drawing and conversions go, and the preview moves to the first file left. */
function removeRow(row: Row): void {
  row.dispose();
  const at = rows.indexOf(row);
  if (at >= 0) rows.splice(at, 1);
  if (selected === row) selectFile(rows[0] ?? null);
  refreshBar();
}

/** Converts every file to the format picked, and remembers the pick for next time. */
function chooseFormat(format: string): void {
  chosen = format;
  try {
    localStorage.setItem(CHOICE_KEY, format);
  } catch {
    // storage can be refused (private windows): the next visit then starts on the default
  }
  for (const row of rows) {
    row.openError = null;
    row.render();
    void row.convert(format);
  }
  refreshBar();
}

/** The worker stopped, most likely out of memory. The file it was on fails; every other file is read again. */
function onCrash(owner: Row | null): void {
  for (const row of rows) row.forgetDrawing();
  owner?.fail(OUT_OF_MEMORY, true);
  for (const row of rows) {
    if (row.canRead()) queueRead(row);
  }
  if (selected) renderPreview();
  refreshBar();
}

/**
 * Draws the preview of the picked file: the file as it was, or the converted file once it is made, with its
 * 3D model or plan and its facts. The Original | Converted switch shows once the file is converted (or is being
 * converted) to the format picked. A file not yet read shows none.
 */
function renderPreview(): void {
  const gen = ++previewGen;
  view3d?.dispose();
  view3d = null;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  const row = selected;
  if (!row || row.state !== "ready" || !row.summary) {
    previewEl.hidden = true;
    previewEl.replaceChildren();
    return;
  }

  // the row marks the side on show, so its tile is the one outlined
  row.el.dataset.side = row.side;
  const hasConverted = row.results.has(chosen) || row.pending.has(chosen);
  const converted = hasConverted && row.side === "after";
  const after = converted ? (row.afters.get(chosen) ?? null) : null;
  // what the side on show has: its model, its plan and its summary
  const view = converted
    ? { mesh: after?.mesh ?? null, svg: after?.svg ?? null, summary: after?.summary ?? null }
    : { mesh: row.mesh, svg: row.svg, summary: row.summary };

  const sides: HTMLButtonElement[] = [];
  if (hasConverted) {
    sides.push(sideTab(row, "before", "Original", !converted));
    sides.push(sideTab(row, "after", `Converted (${formatLabel(chosen)})`, converted));
  }
  const tabs: HTMLButtonElement[] = [];
  const stage = h("div", { cls: "cv-stage" });
  let body: Node[] = [];
  if (converted && !row.results.has(chosen)) {
    body = [h("p", { cls: "cv-note", text: `Converting to ${formatLabel(chosen)}…` })];
  } else if (converted && !after) {
    body = [h("p", { cls: "cv-note", text: "Checking the converted file…" })];
  } else if (converted && after?.image) {
    imageUrl = URL.createObjectURL(after.image);
    stage.append(h("img", { attrs: { src: imageUrl, alt: `Converted ${row.name}` } }));
    body = [stage];
  } else if (view.mesh || view.svg) {
    // the tab the file opens on, or the one it has when the other has nothing to show
    const use3d = view.mesh !== null && (row.tab === "3d" || view.svg === null);
    if (view.mesh) tabs.push(tabButton(row, "3d", "3D", use3d));
    if (view.svg) tabs.push(tabButton(row, "plan", "Plan", !use3d));
    if (use3d && view.mesh) {
      body = [stage];
      if (view.mesh.capped) body.push(h("p", { cls: "cv-note", text: "Preview shows part of the model." }));
      void show3d(stage, view.mesh, gen);
    } else if (view.svg) {
      imageUrl = URL.createObjectURL(new Blob([view.svg], { type: "image/svg+xml" }));
      stage.append(h("img", { attrs: { src: imageUrl, alt: `Plan of ${row.name}` } }));
      body = [stage];
    }
  } else if (converted && after) {
    // a converted file with nothing to draw: its note, and why it couldn't be read back
    body = [h("p", { cls: "cv-note", text: after.note })];
    if (after.error) body.push(h("p", { cls: "cv-note is-warn", text: after.error }));
  } else {
    body = [h("p", { cls: "cv-note", text: "No preview for this file." })];
  }

  previewEl.hidden = false;
  previewEl.replaceChildren(
    h("h2", { cls: "cv-preview-name", text: row.name }),
    h("div", { cls: "cv-tabs cv-sides", hidden: sides.length === 0 }, ...sides),
    h("div", { cls: "cv-tabs", hidden: tabs.length === 0 }, ...tabs),
    ...body,
    ...(view.summary ? [h("dl", { cls: "cv-facts" }, ...factNodes(view.summary))] : []),
  );
}

/** A button over the preview that picks the file as it was or as converted, marked when it is the side showing. */
function sideTab(row: Row, side: Side, label: string, on: boolean): HTMLButtonElement {
  const b = button(
    label,
    () => {
      row.side = side;
      renderPreview();
    },
    on ? "cv-tab is-on" : "cv-tab",
  );
  b.setAttribute("aria-pressed", String(on));
  return b;
}

/** Draws the 3D model in the stage once the preview's code has loaded. A browser without WebGL gets a line saying so. */
async function show3d(stage: HTMLElement, mesh: PreviewMesh, gen: number): Promise<void> {
  try {
    const { showPreview3d } = await import("./preview3d.ts");
    if (gen !== previewGen) return;
    view3d = showPreview3d(stage, mesh);
  } catch {
    if (gen === previewGen) {
      stage.replaceChildren(h("p", { cls: "cv-note", text: "The 3D preview needs WebGL, which this browser doesn't have. The plan and the facts still work." }));
    }
  }
}

/** A tab over the preview, 3D or Plan, marked when it is the one showing. */
function tabButton(row: Row, tab: "3d" | "plan", label: string, on: boolean): HTMLButtonElement {
  const b = button(
    label,
    () => {
      row.tab = tab;
      renderPreview();
    },
    on ? "cv-tab is-on" : "cv-tab",
  );
  b.setAttribute("aria-pressed", String(on));
  return b;
}

/** Shows Download all when two or more files have their file in the format picked, and the results when there are files. */
function refreshBar(): void {
  allBtn.hidden = rows.filter((r) => r.results.has(chosen)).length < 2;
  resultsEl.hidden = rows.length === 0;
}

/** Downloads the files in the format picked, zipped as rodeo-converted.zip. */
function downloadAll(): void {
  const taken = new Set<string>();
  const files: [string, Uint8Array][] = [];
  for (const row of rows) {
    const made = row.results.get(chosen);
    if (made) files.push([uniqueName(made.name, taken), made.bytes]);
  }
  const url = URL.createObjectURL(new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }));
  download(url, "rodeo-converted.zip");
}

/** Saves a URL's file as `name`, through a link clicked and removed; the URL is released a minute later. */
function download(url: string, name: string): void {
  const link = h("a", { attrs: { href: url, download: name } });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** The format the page starts on: the "to" of /convert/<from>-to-<to> (in any language), else ?to=, else the one picked last time, else PDF. */
function startFormat(): string {
  // the pages in other languages start with theirs: /de/convert/dwg-to-pdf, /pt-br/convert/…
  const fromPath = /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/convert\/[a-z0-9]+-to-([a-z0-9]+)\/?$/.exec(location.pathname)?.[1];
  const fromQuery = new URLSearchParams(location.search).get("to");
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(CHOICE_KEY);
  } catch {
    // storage can be refused (private windows): the page then starts on its default
  }
  for (const id of [fromPath, fromQuery, saved]) {
    if (id && CHOICES.has(id)) return id;
  }
  return FALLBACK_TO;
}

/** The text of a Convert to option: "Vectorworks (.vwx)", "PNG (.png)". */
function optionText(id: string): string {
  if (id === "png") return "PNG (.png)";
  const info = formatById(id);
  return `${info?.name ?? id} (.${info?.writeExtensions[0] ?? id})`;
}

/** A format's name on the page: "IFC", "PNG". */
function formatLabel(id: string): string {
  return id === "png" ? "PNG" : (formatById(id)?.name ?? id);
}

/** The PNG's pixel size for a plan: PNG_WIDTH wide, or as tall as MAX_PNG_SIDE allows at the plan's shape. */
function pngSize(svg: string): { width: number; height: number } {
  const box = /viewBox="\s*([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)[\s,]+([-\d.eE+]+)\s*"/.exec(svg);
  const vw = box ? Number(box[3]) : 1;
  const vh = box ? Number(box[4]) : 1;
  const aspect = vw > 0 && vh > 0 && Number.isFinite(vh / vw) ? vh / vw : 1;
  let width = PNG_WIDTH;
  let height = Math.round(PNG_WIDTH * aspect);
  if (height > MAX_PNG_SIDE) {
    height = MAX_PNG_SIDE;
    width = Math.round(MAX_PNG_SIDE / aspect);
  }
  return { width: Math.max(1, width), height: Math.max(1, height) };
}

/** The facts under the preview: units, layers, the commonest objects, the size, what was left out and the notes. */
function factNodes(s: DrawingSummary): Node[] {
  const layerNames = s.layers.map((l) => l.name);
  const types = Object.entries(s.objects);
  const top = types.slice(0, TYPES_SHOWN).map(([name, n]) => `${capitalised(name)} ${fmt(n)}`);
  const other = types.slice(TYPES_SHOWN).reduce((sum, [, n]) => sum + n, 0);
  if (other > 0) top.push(`${fmt(other)} other`);
  const left = Object.entries(s.skipped)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind} ${fmt(n)}`);
  const more = layerNames.length > LAYERS_SHOWN ? `, and ${fmt(layerNames.length - LAYERS_SHOWN)} more` : "";
  const facts: [string, string | string[]][] = [
    ["Units", s.units],
    ["Layers", layerNames.length ? `${fmt(layerNames.length)}: ${layerNames.slice(0, LAYERS_SHOWN).join(", ")}${more}` : "None"],
    ["Objects", s.totalObjects ? `${fmt(s.totalObjects)}: ${top.join(" · ")}` : "None"],
    ["Size", extentOf(s)],
  ];
  if (left.length) facts.push(["Left out", left.join(" · ")]);
  if (s.notes.length) facts.push(["Notes", s.notes.map((note) => `${note}.`)]);
  return facts.flatMap(([label, value]) => {
    const lines = typeof value === "string" ? [value] : value;
    return [h("dt", { text: label }), h("dd", {}, ...lines.map((line) => h("div", { text: line })))];
  });
}

/** The size as summaryLine gives it: its fourth part after the format, layers and objects ("48.2 × 32.0 × 41.5 m"), or "None" when there is no extent. */
function extentOf(s: DrawingSummary): string {
  const parts = summaryLine(s).split(" · ");
  return parts.length > 3 ? parts.slice(3).join(" · ") : "None";
}

/** The before and after pictures side by side, captioned, as one PNG for a report; null when there is neither. */
async function pairPicture(before: Blob | null, after: Blob | null, label: string): Promise<Blob | null> {
  if (!before && !after) return null;
  const w = TILE_W * 3;
  const h = TILE_H * 3;
  const gap = 64;
  const caption = 40;
  const [a, b] = await Promise.all([before ? createImageBitmap(before) : null, after ? createImageBitmap(after) : null]);
  const canvas = document.createElement("canvas");
  canvas.width = w * 2 + gap;
  canvas.height = h + caption;
  const g = canvas.getContext("2d");
  if (!g) return null;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.textAlign = "center";
  const side = (img: ImageBitmap | null, x: number, text: string): void => {
    g.fillStyle = "#ececea";
    g.fillRect(x, 0, w, h);
    if (img) {
      const scale = Math.min(w / img.width, h / img.height);
      g.drawImage(img, x + (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
    } else {
      g.fillStyle = "#777777";
      g.font = "18px system-ui, sans-serif";
      g.fillText("No picture", x + w / 2, h / 2);
    }
    g.fillStyle = "#333333";
    g.font = "18px system-ui, sans-serif";
    g.fillText(text, x + w / 2, h + 27);
  };
  side(a, 0, "Original");
  side(b, w + gap, label);
  g.fillStyle = "#666666";
  g.font = "32px system-ui, sans-serif";
  g.fillText("→", w + gap / 2, h / 2 + 10);
  a?.close();
  b?.close();
  return canvasBlob(canvas, "image/png");
}

/** A button with a label and a click handler. */
function button(label: string, onClick: () => void, cls = "cv-btn"): HTMLButtonElement {
  const b = h("button", { cls, text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}

/** A button that copies `text` to the clipboard, and says whether it did. */
function copyButton(text: string): HTMLButtonElement {
  const b = button("Copy command", () => {
    navigator.clipboard?.writeText(text).then(
      () => {
        b.textContent = "Copied";
      },
      () => {
        b.textContent = "Copy failed";
      },
    );
  });
  return b;
}

/** A file's size as the page shows it, in the decimal units file managers use: "512 B", "210 KB", "12.4 MB". */
function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A file name without its extension: "tower" for "tower.rvt". */
function baseOf(name: string): string {
  return name.replace(/\.[^.]+$/, "") || name;
}

/** A name not yet in `taken`, numbered before its extension when it is ("a (2).ifc"); records the name it returns. */
function uniqueName(name: string, taken: Set<string>): string {
  const base = baseOf(name);
  const ext = name.slice(base.length);
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${base} (${n})${ext}`;
  taken.add(out);
  return out;
}

/** A thousands-separated count, in English. */
function fmt(n: number): string {
  return n.toLocaleString("en");
}

/** A type name with its first letter capitalised, as the facts show it: "Wall". */
function capitalised(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The text of an error, whatever was thrown. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Counts this visit for the admin page, as the editor does. Test browsers send nothing. */
function pingVisit(): void {
  if (navigator.webdriver) return;
  const params = new URLSearchParams(location.search);
  void fetch("/api/visits", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
    body: JSON.stringify({
      event: "visit",
      entry: "convert",
      device: deviceOf(),
      referrer: referrerHost(),
      campaign: params.get("utm_source") ?? params.get("ref"),
    }),
  }).catch(() => {});
}

/** The kind of device this is: a phone or a tablet when the pointer is a finger, else a desktop. */
function deviceOf(): "phone" | "tablet" | "desktop" {
  if (!matchMedia("(pointer: coarse)").matches) return "desktop";
  return Math.min(screen.width, screen.height) < 600 ? "phone" : "tablet";
}

/** The host of the page that linked here, or null when it is this site or none. */
function referrerHost(): string | null {
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    return host && host !== location.hostname ? host : null;
  } catch {
    return null;
  }
}
