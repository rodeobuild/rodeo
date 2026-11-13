// A look's command line (Rhino under the menus, AutoCAD along the foot of the window): type a
// command's name or alias and press Enter or Space to run it. Enter on an empty line repeats the
// last command. While a tool runs, the prompt shows the command's name and the step it asks for.
import "./commandLine.css";
import { allTools } from "../toolbar.ts";
import { store } from "../state.ts";
import { runCommand } from "./commands.ts";
import type { CommandLineHandle } from "./looks.ts";
import type { CommandLineSpec } from "./types.ts";

/** Suggestions listed under the prompt at most, so the list stays short over the drawing. */
const MAX_SUGGEST = 10;

interface Suggestion {
  /** the text shown: "LINE", or "L → LINE" for an alias */
  readonly label: string;
  /** the full command name it runs */
  readonly name: string;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Builds the command line into `into`; its key() takes letters typed over the drawing. */
export function mountCommandLine(into: HTMLElement, spec: CommandLineSpec): CommandLineHandle {
  const caps = spec.upper === true;
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

  const root = el("div", `lk-cmd ${spec.where === "top" ? "lk-cmd-at-top" : "lk-cmd-at-bottom"}`);
  const history = el("div", "lk-cmd-history");
  const row = el("div", "lk-cmd-row");
  const prompt = el("span", "lk-cmd-prompt");
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
  root.append(history, row);
  into.append(root);

  /** Names that start with the text (aliases first), then names that only contain it. */
  function suggest(text: string): Suggestion[] {
    const t = text.trim().toUpperCase();
    if (!t) return [];
    const starts: Suggestion[] = [];
    const inside: Suggestion[] = [];
    for (const { alias, name } of aliasList) {
      if (alias.toUpperCase().startsWith(t)) starts.push({ label: `${show(alias)} → ${show(name)}`, name });
    }
    for (const name of names) {
      const u = name.toUpperCase();
      if (u.startsWith(t)) starts.push({ label: show(name), name });
      else if (u.includes(t)) inside.push({ label: show(name), name });
    }
    return [...starts, ...inside].slice(0, MAX_SUGGEST);
  }

  /** The full name the typed text runs exactly, as a name or an alias; null when neither. */
  function resolve(text: string): string | null {
    const u = text.trim().toUpperCase();
    return byUpper.get(u) ?? aliasByUpper.get(u) ?? null;
  }

  function renderSuggest(): void {
    list.replaceChildren(
      ...sugs.map((s, i) => {
        const option = el("div", i === active ? "lk-cmd-option active" : "lk-cmd-option", s.label);
        // mousedown keeps the focus in the input, so the click still reaches the option
        option.addEventListener("mousedown", (e) => e.preventDefault());
        option.addEventListener("click", () => runName(s.name));
        return option;
      }),
    );
    list.hidden = sugs.length === 0;
  }

  /** Recomputes the suggestions for what is typed; a new text starts again at the top of them. */
  function updateSuggest(reset: boolean): void {
    sugs = suggest(input.value);
    if (reset || active >= sugs.length) active = 0;
    renderSuggest();
  }

  function renderHistory(): void {
    const shown = spec.history > 0 ? lines.slice(-spec.history) : [];
    history.replaceChildren(...shown.map((text) => el("div", "lk-cmd-line", text)));
  }

  /** The prompt: "Line:" while no tool runs; "LINE  Specify first point" while one does. */
  function promptText(): string {
    const tool = store.tool;
    if (tool === "select") return `${spec.prompt}:`;
    const name = names.find((n) => {
      const c = spec.commands[n];
      return c !== undefined && "tool" in c && c.tool === tool;
    });
    const label = name !== undefined ? show(name) : show(allTools().find((t) => t.id === tool)?.label ?? tool);
    const hint = store.hint.trim();
    return hint ? `${label}  ${hint}` : label;
  }

  function renderPrompt(): void {
    prompt.textContent = promptText();
  }

  function clearInput(): void {
    input.value = "";
    recall = -1;
    updateSuggest(true);
    input.blur();
  }

  /** Runs a command by its full name: its history line, then the command itself. */
  function runName(name: string): void {
    const cmd = spec.commands[name];
    lines.push(`${spec.prompt}: ${show(name)}`);
    renderHistory();
    ran.push(name);
    clearInput();
    if (cmd !== undefined) runCommand(cmd);
  }

  /** Runs the last command again; false when none has run yet. */
  function repeatLast(): boolean {
    const last = ran[ran.length - 1];
    if (last === undefined) return false;
    runName(last);
    return true;
  }

  /** Enter or Space: runs what is typed, or repeats the last command when nothing is typed. */
  function runTyped(): void {
    const typed = input.value.trim();
    if (!typed) {
      repeatLast();
      return;
    }
    const name = resolve(typed) ?? suggest(typed)[active]?.name;
    if (name === undefined) {
      lines.push(`Unknown command "${typed}".`);
      renderHistory();
      clearInput();
      return;
    }
    runName(name);
  }

  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "Enter":
        e.preventDefault();
        e.stopPropagation();
        runTyped();
        return;
      case " ":
        e.preventDefault();
        e.stopPropagation();
        runTyped();
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        clearInput();
        return;
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        if (sugs.length > 0) {
          const step = e.key === "ArrowDown" ? 1 : -1;
          active = (active + step + sugs.length) % sugs.length;
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
        const pick = sugs[active];
        if (pick === undefined) return; // nothing to complete: Tab moves on as usual
        e.preventDefault();
        e.stopPropagation();
        input.value = pick.name;
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

  // The prompt follows the tool and its step; the subscription ends with unmount().
  const off = store.on(["tool", "hint"], renderPrompt);
  renderPrompt();

  return {
    key(e: KeyboardEvent): boolean {
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      // a letter, digit, "-", "_" or "." typed over the drawing starts a command in the input
      if (e.key.length === 1 && /^[A-Za-z0-9_.-]$/.test(e.key)) {
        e.preventDefault();
        input.focus();
        input.value += e.key;
        recall = -1;
        updateSuggest(true);
        return true;
      }
      // Enter over the drawing on an empty line repeats the last command
      if (e.key === "Enter" && input.value === "" && ran.length > 0) {
        e.preventDefault();
        return repeatLast();
      }
      return false;
    },
    unmount(): void {
      off();
      root.remove();
    },
  };
}
