// A look's command line (Rhino under the menus, AutoCAD along the foot of the window): type a
// command's name or alias and press Enter or Space to run it. Enter on an empty line repeats the
// last command. A command can ask in the application's words, offer options to click or type
// (Rhino's "Zoom ( All Extents Selected )", AutoCAD's "[All/Extents/Window]"), ask for a selection
// first ("Select objects to move. Press Enter when done") and take typed values ("10,20", "@5<45",
// "r3,0", "12") into the tool's fields. Typing over the drawing goes here first, as in those
// applications, so a command's letters never set off Rodeo's own one-key shortcuts.
import "./commandLine.css";
import { allTools } from "../toolbar.ts";
import { dataBar } from "../databar.ts";
import { setSelection } from "../commands.ts";
import { language, onLanguage, t } from "../i18n.ts";
import { store, type ToolId } from "../state.ts";
import { runCommand } from "./commands.ts";
import type { CommandLineHandle } from "./looks.ts";
import type { Command, CommandLineSpec, LineCommand, LineOption } from "./types.ts";

/** Suggestions listed under the prompt at most, so the list stays short over the drawing. */
const MAX_SUGGEST = 10;

/** A typed letter (in any language, for options in its words), digit or sign that starts a command, an option or a value. */
const STARTS = /^[\p{L}\p{N}_.,@<'!-]$/u;

/** The most printed lines (AREA, LIST) that float over the drawing; the rest stay in the history. */
const MAX_PRINTED = 14;

/** The mounted command line's printer: lines into its history (none while no look has a command line). */
let printer: ((text: readonly string[]) => void) | null = null;

/**
 * Prints `text` in the command line's history, each line in the interface's language (AutoCAD's
 * AREA and LIST, Rhino's Area, Length and What); false when no command line is showing.
 */
export function printLines(text: readonly string[]): boolean {
  if (!printer) return false;
  printer(text);
  return true;
}

/** The signs before a name that both applications accept and that change nothing here: _Line, -LAYER, 'ZOOM, !Line. */
const NAME_SIGNS = /^[_'!-]+(?=[A-Za-z])/;

/** A typed value rather than a name: a number, a point, a relative point or a polar one. */
const VALUE = /^(?:@|r(?=\s*[-+.\d]))?\s*[-+.\d<]/i;

/** Where the pointer last moved, in the window: a typed value sends the drawing a move there (nudgePointer). */
let lastPointer: { x: number; y: number } | null = null;
window.addEventListener("pointermove", (e) => (lastPointer = { x: e.clientX, y: e.clientY }), { capture: true, passive: true });

interface Suggestion {
  /** the text shown: "LINE", or "L → LINE" for an alias */
  readonly label: string;
  /** the full command name it runs */
  readonly name: string;
}

/** A typed command at work: asking for a selection, offering options, or running its tool. */
interface Pending {
  readonly name: string;
  readonly cmd: LineCommand;
  stage: "select" | "options" | "running";
  /** the tool it started, while it runs */
  tool: ToolId | null;
  /** Rodeo's prompt when the tool started: the command's own first prompt stands till it changes */
  hint: string;
  /** what has been picked while it asks for a selection */
  picked: Set<string>;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** A Command (a tool, a menu row, a palette, code) rather than a LineCommand. */
function isCommand(c: Command | LineCommand): c is Command {
  return "tool" in c || "menu" in c || "palette" in c || "run" in c;
}

/** As a LineCommand, a plain Command being one that only runs. */
function asLine(c: Command | LineCommand): LineCommand {
  return isCommand(c) ? { do: c } : c;
}

/** The English words of options made from Mode bar buttons, kept to look them up in another language. */
const labelOf = new WeakMap<LineOption, string>();

/**
 * An option's name as the prompt shows it: in the interface's language where that has its words, one
 * word as both applications write options ("NoScaling"), else its English name.
 */
function optionName(o: LineOption): string {
  const label = labelOf.get(o);
  return label !== undefined ? t(label).replace(/\s+/g, "") : t(o.name);
}

/**
 * The letters that pick each option when typed: its own key, else the shortest start of its name
 * that no other option's name starts with ("Extents" → "E", "Previous"/"Pan" → "PR"/"PA"). `named`
 * gives the names to go by: as shown (the interface's language) or in English.
 */
function optionKeys(options: readonly LineOption[], named: (o: LineOption) => string = (o) => o.name): Map<string, LineOption> {
  const out = new Map<string, LineOption>();
  const names = options.map((o) => named(o).toLocaleUpperCase());
  options.forEach((o, i) => {
    if (o.key && named(o) === o.name) {
      out.set(o.key.toUpperCase(), o);
      return;
    }
    const name = names[i];
    for (let n = 1; n <= name.length; n++) {
      const start = name.slice(0, n);
      if (!names.some((other, j) => j !== i && other.startsWith(start))) {
        out.set(start, o);
        return;
      }
    }
  });
  return out;
}

/** The first part of a Rodeo prompt, before its " · " notes: what a look's `prompts` are keyed by. */
function firstPart(hint: string): string {
  return hint.split(" · ")[0].trim();
}

/**
 * Builds the command line into `into`; its type() and key() take keys typed over the drawing. With
 * `modeBar` (Rodeo's Mode bar, hidden by the look) the running tool's modes are the prompt's options.
 */
export function mountCommandLine(into: HTMLElement, spec: CommandLineSpec, modeBar: HTMLElement | null = null): CommandLineHandle {
  const caps = spec.upper === true;
  const autocad = spec.options === "autocad";
  const show = (s: string): string => (caps ? s.toUpperCase() : s);

  // Names and aliases are matched by their capitals, so typed case never matters. An alias whose
  // target the commands don't have is left out rather than running nothing.
  const names = Object.keys(spec.commands);
  const byUpper = new Map(names.map((n) => [n.toUpperCase(), n] as const));
  const aliasList: { readonly alias: string; readonly name: string }[] = [];
  for (const [alias, full] of Object.entries(spec.aliases ?? {})) {
    const name = byUpper.get(full.toUpperCase());
    if (name !== undefined) aliasList.push({ alias, name });
  }
  const aliasByUpper = new Map(aliasList.map((a) => [a.alias.toUpperCase(), a.name] as const));

  const ran: string[] = []; // full names of the commands run, oldest first
  const lines: string[] = []; // history text, oldest first; only the last few show
  let recall = -1; // how far back ArrowUp has gone through `ran`; -1 is the empty line
  let sugs: Suggestion[] = [];
  let active = 0; // the highlighted suggestion
  let moved = false; // the arrow keys picked a suggestion, so Enter takes it even if it only contains the text
  let pending: Pending | null = null;

  const root = el("div", `lk-cmd ${spec.where === "top" ? "lk-cmd-at-top" : "lk-cmd-at-bottom"}`);
  root.dataset.options = autocad ? "autocad" : "rhino";
  const history = el("div", "lk-cmd-history");
  const row = el("div", "lk-cmd-row");
  const prompt = el("span", "lk-cmd-prompt");
  // both are put in the interface's language here, piece by piece, so the page's translator leaves them be
  history.setAttribute("translate", "no");
  prompt.setAttribute("translate", "no");
  // what AREA or LIST printed, floating over the drawing beside the line until the next command or Escape
  const printedBox = el("div", "lk-cmd-printed");
  printedBox.setAttribute("translate", "no");
  printedBox.hidden = true;
  const unprint = (): void => {
    printedBox.hidden = true;
    printedBox.replaceChildren();
  };
  const input = el("input", "lk-cmd-input");
  input.type = "text";
  input.spellcheck = false;
  input.setAttribute("autocomplete", "off");
  input.setAttribute("autocapitalize", "off");
  input.setAttribute("aria-label", "Command");
  input.style.textTransform = caps ? "uppercase" : "none";
  // Positioned by CSS just under (top line) or just over (bottom line) the input, and left at it.
  const list = el("div", "lk-cmd-suggest");
  list.hidden = true;
  row.append(prompt, input, list);
  root.append(history, row, printedBox);
  into.append(root);

  /** Names that start with the text (aliases first), then names that only contain it. */
  function suggest(text: string): Suggestion[] {
    const t = text.trim().replace(NAME_SIGNS, "").toUpperCase();
    if (!t || VALUE.test(t)) return [];
    const starts: Suggestion[] = [];
    const inside: Suggestion[] = [];
    for (const { alias, name } of aliasList) {
      if (alias.toUpperCase().startsWith(t)) starts.push({ label: `${show(alias)} → ${show(name)}`, name });
    }
    for (const name of byUse(names)) {
      const u = name.toUpperCase();
      if (u.startsWith(t)) starts.push({ label: show(name), name });
      else if (u.includes(t)) inside.push({ label: show(name), name });
    }
    return [...starts, ...inside].slice(0, MAX_SUGGEST);
  }

  /** The full name the typed text runs exactly, as a name or an alias; null when neither. */
  function resolve(text: string): string | null {
    const u = text.trim().replace(NAME_SIGNS, "").toUpperCase();
    return byUpper.get(u) ?? aliasByUpper.get(u) ?? null;
  }

  /**
   * Names in the order a typed start offers them, as the applications' autocomplete does: those run
   * lately first (the latest first), then the look's table order, which lists the everyday commands
   * first, so Rhino's "L" is Line rather than Left.
   */
  function byUse(list: readonly string[]): string[] {
    const order = new Map(names.map((n, i) => [n, i] as const));
    const last = (n: string): number => ran.lastIndexOf(n);
    return [...list].sort((a, b) => last(b) - last(a) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  /** The one command whose name starts with the text, or the first by byUse when several do. */
  function startingWith(text: string): string | null {
    const u = text.trim().replace(NAME_SIGNS, "").toUpperCase();
    if (!u) return null;
    const alias = aliasList.find((a) => a.alias.toUpperCase().startsWith(u));
    if (alias) return alias.name;
    return byUse(names.filter((n) => n.toUpperCase().startsWith(u)))[0] ?? null;
  }

  function renderSuggest(): void {
    list.replaceChildren(
      ...sugs.map((s, i) => {
        const option = el("div", i === active ? "lk-cmd-option active" : "lk-cmd-option", s.label);
        // mousedown keeps the focus in the input, so the click still reaches the option
        option.addEventListener("mousedown", (e) => e.preventDefault());
        option.addEventListener("click", () => {
          clearInput();
          start(s.name);
        });
        return option;
      }),
    );
    list.hidden = sugs.length === 0;
  }

  /** Recomputes the suggestions for what is typed; a new text starts again at the top of them. */
  function updateSuggest(reset: boolean): void {
    sugs = pending && pending.stage !== "running" ? [] : suggest(input.value);
    if (reset || active >= sugs.length) {
      active = 0;
      moved = false;
    }
    renderSuggest();
  }

  function renderHistory(): void {
    const shown = spec.history > 0 ? lines.slice(-spec.history) : [];
    history.replaceChildren(...shown.map((text) => el("div", "lk-cmd-line", text)));
  }

  function say(text: string): void {
    lines.push(text);
    renderHistory();
  }

  /** The command's label as the prompt starts it: AutoCAD always names it, Rhino doesn't once it has its own words. */
  function toolLabel(tool: ToolId): string {
    const name = names.find((n) => {
      const c = spec.commands[n];
      const run = c === undefined ? undefined : asLine(c).do;
      return run !== undefined && "tool" in run && run.tool === tool;
    });
    return name !== undefined ? show(name) : show(allTools().find((t) => t.id === tool)?.label ?? tool);
  }

  /** The words the prompt asks with now, without its options. */
  /**
   * The prompt's words, and before them the command's name where the application writes it there
   * (AutoCAD's "LINE Specify first point:"). Kept apart so the words are translated on their own.
   */
  function promptParts(): { lead: string; words: string } {
    if (pending?.stage === "select") return { lead: "", words: pending.cmd.select ?? "Select objects" };
    if (pending?.stage === "options") {
      const words = pending.cmd.prompt ?? "";
      return autocad ? { lead: show(pending.name), words } : { lead: "", words: words || show(pending.name) };
    }
    const tool = store.tool;
    if (tool === "select") return { lead: "", words: spec.prompt };
    const hint = store.hint.trim();
    const own = pending?.stage === "running" && pending.tool === tool && hint === pending.hint ? pending.cmd.prompt : undefined;
    const mapped = own ?? (hint ? spec.prompts?.[firstPart(hint)] : undefined);
    if (mapped) return autocad ? { lead: toolLabel(tool), words: mapped } : { lead: "", words: mapped };
    return hint ? { lead: toolLabel(tool), words: hint } : { lead: "", words: toolLabel(tool) };
  }


  /**
   * The options the prompt offers now: the typed command's own, else (while a tool runs) the
   * tool's modes from Rodeo's hidden Mode bar, each a click of its button there.
   */
  function currentOptions(): readonly LineOption[] {
    if (pending && pending.stage !== "select" && pending.cmd.options) return pending.cmd.options;
    if (!modeBar || pending?.stage === "select" || store.tool === "select") return [];
    const out: LineOption[] = [];
    for (const b of modeBar.querySelectorAll<HTMLButtonElement>(".mb-group button")) {
      const label = (b.getAttribute("aria-label") || b.title || b.textContent || "").trim();
      if (!label || label === "Tool preferences" || b.disabled) continue;
      // option names are one word in both applications: "NoScaling", "SingleObject"
      const o: LineOption = { name: label.replace(/\s+/g, ""), do: { run: () => b.click(), checked: () => b.classList.contains("on") } };
      labelOf.set(o, label);
      out.push(o);
    }
    return out;
  }

  /** The prompt with its options, each a button: "Zoom ( All Extents Selected ):", "ZOOM [All/Extents] <real time>:". */
  function renderPrompt(): void {
    const idle = pending === null && store.tool === "select";
    // AutoCAD waits with ">_" and "Type a command" greyed inside the empty field, not as a prompt
    if (autocad) {
      input.placeholder = idle ? t(spec.prompt) : "";
      root.classList.toggle("lk-cmd-busy", !idle);
      if (idle) {
        prompt.replaceChildren(el("span", "lk-cmd-glyph", ">_"));
        return;
      }
    }
    const { lead, words: english } = promptParts();
    const words = english ? t(english) : "";
    const options = currentOptions();
    const parts: (string | HTMLElement)[] = [words];
    const enterLabel = pending && pending.stage !== "select" ? pending.cmd.enterLabel : undefined;
    if (!autocad && enterLabel && pending?.stage === "options" && !/press enter/i.test(english)) {
      parts[0] = `${words ? words.replace(/[.。]?\s*$/, "") + ". " : ""}${t(`Press Enter for ${enterLabel}`)}`;
    }
    if (options.length > 0) {
      const keys = optionKeys(options, optionName);
      const keyOf = (o: LineOption): string => [...keys].find(([, v]) => v === o)?.[0] ?? "";
      const buttons = options.map((o) => {
        const b = el("button", "lk-cmd-opt");
        b.type = "button";
        const k = keyOf(o);
        const name = optionName(o);
        // the letters that pick it are underlined, as the applications mark them
        if (k && name.toLocaleUpperCase().startsWith(k)) b.append(el("u", "", name.slice(0, k.length)), document.createTextNode(name.slice(k.length)));
        else b.textContent = name;
        if ("run" in o.do && o.do.checked?.()) b.classList.add("on");
        b.addEventListener("mousedown", (e) => e.preventDefault());
        b.addEventListener("click", () => pick(o));
        return b;
      });
      if (autocad) {
        parts.push(" [");
        buttons.forEach((b, i) => {
          if (i > 0) parts.push("/");
          parts.push(b);
        });
        parts.push("]");
      } else {
        parts.push(" ( ");
        buttons.forEach((b, i) => {
          if (i > 0) parts.push(" ");
          parts.push(b);
        });
        parts.push(" )");
      }
    }
    if (autocad && enterLabel) parts.push(` <${t(enterLabel)}>`);
    // the closing colon, unless the words already end with one (AutoCAD's "Select objects:")
    const last = parts[parts.length - 1];
    if (!(typeof last === "string" && /[:?：？]\s*$/.test(last))) parts.push(language().colon);
    // the command's name in a span of its own, so the words after it translate as they are
    const name = lead ? [el("span", "lk-cmd-name", lead), document.createTextNode(" ")] : [];
    prompt.replaceChildren(...name, ...parts.map((p) => (typeof p === "string" ? document.createTextNode(p) : p)));
    root.classList.toggle("lk-cmd-busy", pending !== null || store.tool !== "select");
  }

  /** The prompt as plain text, for the history. */
  function promptText(): string {
    return prompt.textContent ?? "";
  }

  function clearInput(): void {
    input.value = "";
    recall = -1;
    updateSuggest(true);
    input.blur();
  }

  /** Ends whatever command is at work, as Escape does. */
  function cancel(): void {
    const was = pending;
    pending = null;
    if (was?.stage === "select") setSelection(was.picked);
    if (store.tool !== "select") runCommand({ tool: "select" });
    renderPrompt();
  }

  /** Runs what a typed command does once it has its selection (or needs none). */
  function go(name: string, cmd: LineCommand): void {
    if (!cmd.do) {
      // a command of options alone: it waits at its prompt for one, or for Enter
      pending = { name, cmd, stage: "options", tool: null, hint: "", picked: new Set() };
      renderPrompt();
      return;
    }
    runCommand(cmd.do);
    if ("tool" in cmd.do && store.tool === cmd.do.tool) {
      pending = cmd.prompt || cmd.options ? { name, cmd, stage: "running", tool: cmd.do.tool, hint: store.hint.trim(), picked: new Set() } : null;
    } else {
      pending = null;
    }
    renderPrompt();
  }

  /** Starts a command by its full name: its history line, then its selection, options or tool. */
  function start(name: string): void {
    const entry = spec.commands[name];
    if (entry === undefined) return;
    if (pending || store.tool !== "select") {
      // a new command ends the one at work, as Escape would
      pending = null;
      if (store.tool !== "select") runCommand({ tool: "select" });
    }
    unprint();
    // AutoCAD writes "Command: LINE" above, whatever its empty field says
    say(`${t(autocad ? "Command" : spec.prompt)}${language().colon} ${show(name)}`);
    ran.push(name);
    const cmd = asLine(entry);
    if (cmd.select && store.selection.size === 0) {
      pending = { name, cmd, stage: "select", tool: null, hint: "", picked: new Set() };
      renderPrompt();
      return;
    }
    go(name, cmd);
  }

  /** An option clicked or typed: it runs, and a command of options alone is then done. */
  function pick(o: LineOption): void {
    const p = pending;
    say(`${promptText()} ${optionName(o)}`);
    clearInput();
    if (p?.stage === "options") pending = null;
    runCommand(o.do);
    if (p?.stage === "running" && "tool" in o.do) {
      p.tool = o.do.tool;
      p.hint = store.hint.trim();
    }
    renderPrompt();
  }

  /** Enter with nothing typed: ends the selection, takes the default option, or repeats the last command. */
  function enter(): boolean {
    const p = pending;
    if (p?.stage === "select") {
      if (store.selection.size === 0) {
        say(`${promptText()} ${t("(nothing selected)")}`);
        pending = null;
        renderPrompt();
        return true;
      }
      pending = null;
      go(p.name, p.cmd);
      return true;
    }
    if (p?.stage === "options") {
      pending = null;
      if (p.cmd.enter) {
        say(`${promptText()} ${p.cmd.enterLabel ? t(p.cmd.enterLabel) : ""}`.trim());
        runCommand(p.cmd.enter);
      }
      renderPrompt();
      return true;
    }
    if (p?.stage === "running" && p.cmd.enter) {
      runCommand(p.cmd.enter);
      return true;
    }
    return false;
  }

  /** The option the typed text names: its key letters, its whole name, or the start of only its name. */
  function optionFor(text: string): LineOption | null {
    const options = currentOptions();
    if (options.length === 0) return null;
    const u = text.trim().replace(NAME_SIGNS, "").toLocaleUpperCase();
    // in the words the prompt shows them in first, then in English (typed as the English manuals give them)
    for (const named of [optionName, (o: LineOption) => o.name]) {
      const byKey = optionKeys(options, named).get(u);
      if (byKey) return byKey;
      const exact = options.find((o) => named(o).toLocaleUpperCase() === u);
      if (exact) return exact;
      const starting = options.filter((o) => named(o).toLocaleUpperCase().startsWith(u));
      if (starting.length === 1) return starting[0];
    }
    return null;
  }

  /**
   * A typed value into the tool's fields: "x,y" (a point), "@dx,dy" or "r dx,dy" (from the last
   * point), "d<a" or "@d<a" (a distance at an angle), "<a" (an angle), or one number (the first
   * value the tool asks for). False when the tool asks for no values.
   */
  function typeValue(text: string): boolean {
    let keys = dataBar.fieldKeys();
    // a tool asks for values once the pointer has moved over the drawing since it started: move it there where it last was
    if (keys.length === 0 && store.tool !== "select") {
      nudgePointer();
      keys = dataBar.fieldKeys();
    }
    if (keys.length === 0) return false;
    const has = (k: string): boolean => keys.includes(k);
    const t = text.trim();
    const relative = /^@|^r(?=\s*[-+.\d])/i.test(t);
    const body = t.replace(/^@|^r(?=\s*[-+.\d])/i, "").trim();
    const polar = body.match(/^([^<]*)<(.+)$/);
    const values: Record<string, string> = {};
    if (polar) {
      const [, dist, angle] = polar;
      const lengthKey = ["length", "radius", "distance"].find(has) ?? keys.find((k) => k !== "x" && k !== "y" && k !== "angle");
      if (dist.trim() && lengthKey) values[lengthKey] = dist.trim();
      if (has("angle")) values.angle = angle.trim();
    } else if (body.includes(",")) {
      const [a, b] = body.split(",").map((s) => s.trim());
      const [kx, ky] = relative && has("dx") ? ["dx", "dy"] : has("x") ? ["x", "y"] : has("dx") ? ["dx", "dy"] : [keys[0], keys[1]];
      if (kx) values[kx] = a;
      if (ky && b !== undefined) values[ky] = b;
    } else {
      const first = keys.find((k) => k !== "x" && k !== "y") ?? keys[0];
      values[first] = body;
    }
    const took = dataBar.typeIn(values);
    // the bar puts its own field in focus for the next value; the next is typed here, so it lets go
    if (took) {
      const release = (): void => {
        const a = document.activeElement;
        if (a instanceof HTMLElement && a.classList.contains("databar-input")) a.blur();
      };
      release();
      requestAnimationFrame(release);
    }
    return took;
  }

  /** Sends the drawing a pointer move where the pointer last was over it (else its middle), so the running tool shows its fields. */
  function nudgePointer(): void {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const inside = lastPointer && lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom;
    const at = inside ? lastPointer! : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    canvas.dispatchEvent(new PointerEvent("pointermove", { clientX: at.x, clientY: at.y, bubbles: true, pointerType: "mouse", isPrimary: true }));
  }

  /** Enter or Space with text: an option, a value, a command name, or "unknown". */
  function runTyped(): void {
    const raw = input.value.trim();
    if (!raw) {
      clearInput();
      if (!enter()) repeatLast();
      return;
    }
    const option = optionFor(raw);
    if (option) {
      pick(option);
      return;
    }
    if (VALUE.test(raw) && (store.tool !== "select" || pending?.stage === "running")) {
      const asked = promptText();
      if (typeValue(raw)) {
        say(`${asked} ${raw}`);
        clearInput();
        return;
      }
    }
    const name = resolve(raw) ?? (moved ? sugs[active]?.name : undefined) ?? startingWith(raw);
    if (name) {
      clearInput();
      start(name);
      return;
    }
    if (pending && pending.stage !== "running") say(autocad ? t("Invalid option keyword.") : t(`Unknown command option: ${raw}`));
    else say(autocad ? t(`Unknown command "${raw.toUpperCase()}". Press F1 for help.`) : t(`Unknown command: ${raw}`));
    clearInput();
  }

  /** Runs the last command again; false when none has run yet. */
  function repeatLast(): boolean {
    const last = ran[ran.length - 1];
    if (last === undefined) return false;
    start(last);
    return true;
  }

  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        e.stopPropagation();
        runTyped();
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        if (input.value === "" && (pending || store.tool !== "select")) cancel();
        unprint();
        clearInput();
        return;
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        if (sugs.length > 0) {
          const step = e.key === "ArrowDown" ? 1 : -1;
          active = (active + step + sugs.length) % sugs.length;
          moved = true;
          renderSuggest();
          return;
        }
        // no suggestions: step back through the commands run before, and forward again to empty
        if (ran.length === 0) return;
        if (e.key === "ArrowUp") recall = Math.min(recall + 1, ran.length - 1);
        else recall = Math.max(recall - 1, -1);
        input.value = recall < 0 ? "" : (ran[ran.length - 1 - recall] ?? "");
        sugs = [];
        renderSuggest();
        return;
      }
      case "Tab": {
        const choice = sugs[active];
        if (choice === undefined) return; // nothing to complete: Tab moves on as usual
        e.preventDefault();
        e.stopPropagation();
        input.value = choice.name;
        recall = -1;
        updateSuggest(true);
        return;
      }
      default:
        return;
    }
  });

  input.addEventListener("input", () => {
    recall = -1;
    updateSuggest(true);
  });
  input.addEventListener("focus", () => updateSuggest(true));
  input.addEventListener("blur", () => {
    sugs = [];
    renderSuggest();
  });

  // While it asks for a selection each pick adds to what is picked, as in both applications: a
  // click on another object or on nothing keeps what was picked before.
  let mending = false;
  const offSelection = store.on("selection", () => {
    const p = pending;
    if (!p || p.stage !== "select" || mending) return;
    const now = store.selection;
    const lost = [...p.picked].some((id) => !now.has(id));
    if (!lost) {
      p.picked = new Set(now);
      return;
    }
    const union = new Set([...p.picked, ...now]);
    p.picked = union;
    mending = true;
    queueMicrotask(() => {
      setSelection(union);
      mending = false;
    });
  });

  // The prompt follows the tool and its step; a command that started a tool ends when another tool takes over.
  // the Mode bar's buttons change with the tool and as they are pressed: the options follow them
  let queued = false;
  const watch = modeBar
    ? new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          renderPrompt();
        });
      })
    : null;
  watch?.observe(modeBar!, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "aria-pressed"] });

  printer = (text) => {
    const shown = text.map((line) => t(line));
    lines.push(...shown);
    renderHistory();
    const last = shown.slice(-MAX_PRINTED);
    printedBox.replaceChildren(...last.map((line) => el("div", "lk-cmd-line", line)));
    printedBox.hidden = false;
  };
  onLanguage(() => {
    if (root.isConnected) renderPrompt();
  });

  const offTool = store.on(["tool", "hint"], () => {
    if (pending?.stage === "running" && store.tool !== pending.tool) pending = null;
    renderPrompt();
  });
  renderPrompt();

  return {
    type(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      // a letter, digit or sign typed over the drawing starts a command, an option or a value
      if (e.key.length === 1 && STARTS.test(e.key)) {
        input.focus();
        input.value += e.key;
        recall = -1;
        updateSuggest(true);
        return true;
      }
      // Enter while a command asks for a selection or an option answers it
      if (e.key === "Enter" && pending && pending.stage !== "running") return enter();
      return false;
    },
    key(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      // Enter over the drawing on an empty line repeats the last command
      if (e.key === "Enter" && input.value === "" && ran.length > 0) return repeatLast();
      return false;
    },
    space(): boolean {
      // Space is Enter in both applications: it answers a prompt, or repeats the last command when none is at work
      if (pending && pending.stage !== "running") return enter();
      if (store.tool === "select" && ran.length > 0) return repeatLast();
      return false;
    },
    escape(): boolean {
      if (!printedBox.hidden && !pending) {
        unprint();
        return true;
      }
      if (!pending) return false;
      cancel();
      return true;
    },
    unmount(): void {
      printer = null;
      offTool();
      watch?.disconnect();
      offSelection();
      root.remove();
    },
  };
}
