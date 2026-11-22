// A Vectorworks layout dialog a script shows (vs.RunLayoutDialog in vsModule.ts), drawn as the
// editor's own dialogs are. Its controls are placed as the script laid them out: each below or to the
// right of another, indented by standard characters, with group boxes and tab panes holding theirs.
// Each click or change is an event the script's handler gets, with what every control then holds;
// what the handler sets (texts, values, choices, enabled, shown) comes back with the next call, and a
// value it didn't change is left as the user may since have made it. Radio buttons in one group (or
// the dialog itself) exclude each other, and a check box or radio button group box enables its own.

import { h } from "../../app/dom.ts";
import { colorSwatch } from "../../app/panels/colorPicker.ts";
import { store } from "../../app/state.ts";
import { formatLength, parseLength } from "../../app/units.ts";

/** A control as the vs module keeps it (lengths in mm). */
interface Item {
  readonly id: number;
  readonly kind: string;
  readonly text?: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  /** standard characters */
  readonly width?: number | null;
  readonly lines?: number;
  readonly value?: unknown;
  readonly raw?: string | null;
  /** an edit real's kind: 1 a number, 2 an angle, 3 a dimension, 4 and 5 an x and a y coordinate */
  readonly edit?: number;
  readonly choices?: readonly string[];
  readonly sel?: readonly number[];
  readonly multi?: boolean;
  readonly frame?: boolean;
  readonly bold?: boolean;
  readonly readonly?: boolean;
  readonly tip?: string;
  readonly first?: number | null;
  readonly panes?: readonly number[];
  readonly below?: number;
  readonly right?: number;
  readonly indent?: number;
  readonly space?: number;
  /** a slider's largest value, and whether it reports each move while dragged */
  readonly max?: number;
  readonly live?: boolean;
  /** a frame's size in pixels, when the script gave one */
  readonly pw?: number | null;
  readonly ph?: number | null;
  /** an edit field's hint text, and whether it hides its text */
  readonly prompt?: string;
  readonly pwd?: boolean;
  /** a static text's look: its justification, italic, underline, size class and colour */
  readonly just?: string;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly tsize?: string;
  readonly color?: readonly number[];
  readonly clickable?: boolean;
  /** a push button: a toggle (its value is pressed), and whether it shows an image (labelled by its tip) */
  readonly toggle?: boolean;
  readonly image?: boolean | string;
  /** a tab control that shows its panes without a strip of tabs (a swap control) */
  readonly swap?: boolean;
  /** a list browser's columns, rows, header and flags; its sort; the check marks by "row,column" */
  readonly cols?: readonly LbCol[];
  readonly rows?: readonly LbRow[];
  readonly sort?: readonly [number, boolean] | null;
  readonly sorting?: boolean;
  readonly single?: boolean;
  readonly colLines?: boolean;
  readonly hdr?: boolean;
  readonly checks?: Record<string, boolean>;
  /** a tree control's items as [id, text, parent (0 at the top), has children], depth first, and its open items */
  readonly tree?: readonly (readonly [number, string, number, boolean])[];
  readonly open?: readonly number[];
}

/** A list browser's column as the script set it. */
interface LbCol {
  readonly header: string;
  readonly width: number;
  /** 1 static text, 2 radio (one row on per column), 3 multi state (a check box), others drawn as text */
  readonly ctype: number;
  /** justification: 1 left, 2 centre, 3 right */
  readonly hjust: number;
  readonly tip?: string;
}

/** A list browser's cell: its text, its check mark (for a check or radio column) and its look. */
interface LbCell {
  readonly text?: string;
  readonly check?: number;
  readonly just?: number | null;
  readonly style?: number;
  readonly tcolor?: readonly number[] | null;
  readonly fill?: readonly number[] | null;
}

interface LbRow {
  readonly cells: readonly LbCell[];
}

/** The event a list browser sends with its click or key: a kMessage constant, the row and the column (-1 for none). */
interface LbEvent {
  readonly type: number;
  readonly row: number;
  readonly col: number;
}

const JUSTIFY = ["left", "left", "center", "right"];

const rgb = (c: readonly number[]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** A static text's classes: its weight, slant, underline, size class and justification. */
function staticClasses(i: Item): string {
  return [
    "ld-text",
    i.bold ? "ld-bold" : "",
    i.italic ? "ld-italic" : "",
    i.underline ? "ld-underline" : "",
    i.tsize ? `ld-${i.tsize}` : "",
    i.just ? `ld-just-${i.just}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The check marks of a list browser's rows by "row,column". */
function checkMarks(rows: readonly LbRow[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  rows.forEach((r, n) => r.cells.forEach((c, k) => (out[`${n},${k}`] = c.check === 1)));
  return out;
}

interface Spec {
  readonly id: number;
  readonly title: string;
  readonly first: number | null;
  readonly focus: number | null;
  readonly items: readonly Item[];
}

type Values = Record<string, unknown>;

/** What the script's handler gets: the control and its data (a choice's index, a tab's pane), and every control's values. */
interface DialogEvent {
  readonly item: number;
  readonly data: number;
  readonly values: Record<string, Values>;
  /** the control holding the focus when the event came, or null */
  readonly focus: number | null;
}

const OK = 1;
const CANCEL = 2;
/** a list browser's events (vs.GetLBEventInfo's kMessage values) */
const LB_SELECT = -4;
const LB_CHECK = -2;
const LB_DOUBLE = -5;
const LB_SORT = -10;
const LB_DELETE = -6;
const LB_UP = -7;
const LB_DOWN = -8;
const LB_ENTER = -12;
/** a row's height and a standard character's pixels in a list browser */
const LB_ROW = 22;
/** how long a typed field waits for the next key before its event is sent */
const TYPING_MS = 150;
const LENGTHS: ReadonlySet<number> = new Set([3, 4, 5]);
/** a standard character's width, and a line of spacing, in px */
const STD_CHAR = 7;
const LINE = 6;

const units = (): string | undefined => store.session?.doc.info.units;
const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);

/** Whether two values are the same, numbers to a millionth (lengths come back through the script's units). */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => same((a as Values)[k], (b as Values)[k]));
  }
  return a === b;
}

/** One control drawn: its element (what is shown and hidden), and how its values are read and set. */
interface Control {
  readonly el: HTMLElement;
  /** the elements its enabled state disables */
  readonly inputs: readonly (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLFieldSetElement)[];
  /** its label's text node, for SetItemText */
  readonly label?: HTMLElement;
  read?(): Values;
  write?(item: Item): void;
}

class LayoutDialog {
  private readonly backdrop: HTMLElement;
  private readonly form: HTMLFormElement;
  private readonly controls = new Map<number, Control>();
  private items = new Map<number, Item>();
  /** the radio buttons that exclude each other, by the group (or 0, the dialog) holding them */
  private readonly radios = new Map<number, HTMLInputElement[]>();
  /** each control's values as sent with the event the script is answering */
  private sent = new Map<number, Values>();
  /** events the script hasn't taken yet, each with its controls' values as sent */
  private readonly queue: { event: DialogEvent; sent: Map<number, Values>; typing: boolean }[] = [];
  private waiting: ((e: DialogEvent) => void) | null = null;
  private readonly returnFocus: HTMLElement | null;
  /** the pending typing event of each typed field (see typed) */
  private readonly timers = new Map<number, number>();

  constructor(spec: Spec) {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.items = new Map(spec.items.map((i) => [i.id, i]));
    const ok = this.button(OK, "btn primary", "submit");
    const cancel = this.button(CANCEL, "btn", "button");
    const body = h("div", { cls: "ld-body" });
    const seen = new Set<number>([OK, CANCEL]);
    // the panes of tab controls are drawn by their tab control
    for (const i of spec.items) for (const p of i.panes ?? []) seen.add(p);
    if (spec.first !== null) {
      const top = this.block(spec.first, seen, 0);
      if (top) body.append(top);
    }
    this.form = h(
      "form",
      { cls: "menu-dialog ld-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": spec.title } },
      h("h2", { cls: "menu-dialog-title", text: spec.title }),
      body,
      h("div", { cls: "menu-dialog-actions" }, cancel, ok),
    );
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!(this.controls.get(OK)?.inputs[0] as HTMLButtonElement | undefined)?.disabled) this.fire(OK, 0);
    });
    this.backdrop = h("div", { cls: "menu-dialog-backdrop" }, this.form);
    // every key stays inside the dialog, so the window's shortcuts don't run under it
    this.backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.fire(CANCEL, 0);
      }
    });
    this.update(spec);
    document.body.append(this.backdrop);
    const first = (spec.focus !== null ? this.controls.get(spec.focus)?.inputs[0] : null) ?? body.querySelector<HTMLElement>("input, select, textarea");
    first?.focus();
  }

  /** The script's state after its handler ran: each control brought up to it, keeping what the user changed since. */
  update(spec: Spec): void {
    this.items = new Map(spec.items.map((i) => [i.id, i]));
    for (const item of spec.items) {
      const c = this.controls.get(item.id);
      if (!c) continue;
      c.el.hidden = !item.visible;
      for (const input of c.inputs) input.disabled = !item.enabled;
      // a list or a tree has no inputs to disable: it dims instead
      c.el.classList.toggle("ld-disabled", !item.enabled && c.el.matches(".ld-lb, .ld-tree"));
      // an image button has no picture drawn, so its tooltip is its label
      if (c.label && item.text !== undefined) c.label.textContent = item.image && !item.text ? (item.tip ?? "") : item.text;
      if (item.tip) c.el.title = item.tip;
      const sent = this.sent.get(item.id);
      if (c.write && (!sent || !same(this.state(item), sent))) c.write(item);
    }
  }

  /** The next event, once the user makes one. */
  next(): Promise<DialogEvent> {
    const e = this.queue.shift();
    if (!e) return new Promise((resolve) => (this.waiting = resolve));
    this.sent = e.sent;
    return Promise.resolve(e.event);
  }

  close(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.backdrop.remove();
    this.returnFocus?.focus();
  }

  /**
   * A typed field's event after a key: sent once the typing pauses (TYPING_MS), without the field
   * losing the focus. Later keys in the pause restart the wait; a change or a button settles it first.
   */
  private typed(id: number): void {
    this.settle(id);
    this.timers.set(
      id,
      window.setTimeout(() => {
        this.timers.delete(id);
        this.fire(id, 0, true);
      }, TYPING_MS),
    );
  }

  /** Drops a typed field's pending event: the event that is about to be sent carries its text. */
  private settle(id: number): void {
    const t = this.timers.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    this.timers.delete(id);
  }

  /** An item's values as the script holds them, to compare with those sent. */
  private state(item: Item): Values {
    switch (item.kind) {
      case "edit":
        return { text: item.text ?? "" };
      case "real":
      case "int":
        return { raw: item.raw ?? null, value: item.value ?? null };
      case "popup":
      case "list":
        return { sel: [...(item.sel ?? [])], choices: [...(item.choices ?? [])] };
      case "lb":
        // what the table shows (its rows, columns and flags) is compared as a whole, so a sort or a new row redraws it
        return {
          sel: [...(item.sel ?? [])],
          sort: item.sort ?? null,
          checks: item.checks ?? checkMarks(item.rows ?? []),
          shown: JSON.stringify([item.cols, item.rows, item.hdr, item.sorting, item.single, item.multi, item.lines, item.colLines]),
        };
      case "tree":
        return { sel: [...(item.sel ?? [])], open: [...(item.open ?? [])].sort((a, b) => a - b), shown: JSON.stringify(item.tree ?? []) };
      default:
        return { value: item.value ?? null };
    }
  }

  private fire(item: number, data: number, typing = false): void {
    // a button ends the dialog with what is typed now, so no typed event is left to follow it
    if (item === OK || item === CANCEL) for (const id of [...this.timers.keys()]) this.settle(id);
    const values: Record<string, Values> = {};
    const sent = new Map<number, Values>();
    let focus: number | null = null;
    for (const [id, c] of this.controls) {
      if (focus === null && c.el.contains(document.activeElement)) focus = id;
      const v = c.read?.();
      if (!v) continue;
      values[id] = v;
      const it = this.items.get(id);
      if (it) sent.set(id, this.state({ ...it, ...v } as Item));
    }
    const event: DialogEvent = { item, data, values, focus };
    const resolve = this.waiting;
    this.waiting = null;
    if (!resolve) {
      // a typed field's events queue up behind a slow handler: only the latest text is still wanted
      const last = this.queue[this.queue.length - 1];
      if (typing && last?.typing && last.event.item === item) this.queue[this.queue.length - 1] = { event, sent, typing };
      else this.queue.push({ event, sent, typing });
      return;
    }
    this.sent = sent;
    resolve(event);
  }

  private button(id: number, cls: string, type: "button" | "submit"): HTMLButtonElement {
    const item = this.items.get(id);
    const b = h("button", { cls, text: item?.text ?? "", attrs: { type } });
    if (type === "button") b.addEventListener("click", () => this.fire(id, 0));
    this.controls.set(id, { el: b, inputs: [b], label: b });
    return b;
  }

  /** The control `id` with what is to its right, and under that what is below it: the script's layout. */
  private block(id: number, seen: Set<number>, group: number): HTMLElement | null {
    const item = this.items.get(id);
    if (!item || seen.has(id)) return null;
    seen.add(id);
    const row = h("div", { cls: "ld-row" }, this.control(item, seen, group).el);
    const right = item.right === undefined ? null : this.block(item.right, seen, group);
    if (right) row.append(right);
    const col = h("div", { cls: "ld-col" }, row);
    const below = item.below === undefined ? null : this.block(item.below, seen, group);
    if (below) col.append(below);
    if (item.indent) col.style.marginLeft = `${item.indent * STD_CHAR}px`;
    if (item.space) col.style.marginTop = `${item.space * LINE}px`;
    return col;
  }

  private sized(el: HTMLElement, item: Item): void {
    if (item.width) el.style.width = `${item.width * STD_CHAR + 16}px`;
  }

  private control(item: Item, seen: Set<number>, group: number): Control {
    const c = this.make(item, seen, group);
    this.controls.set(item.id, c);
    return c;
  }

  private make(item: Item, seen: Set<number>, group: number): Control {
    const change = (data = 0) => () => this.fire(item.id, data);
    switch (item.kind) {
      case "static": {
        const el = h("span", { text: item.text ?? "" });
        // the look is set again with each update (a static text sends no value, so it is never compared)
        const look = (i: Item): void => {
          el.className = staticClasses(i);
          el.style.color = i.color ? rgb(i.color) : "";
        };
        look(item);
        this.sized(el, item);
        el.addEventListener("click", () => {
          if (this.items.get(item.id)?.clickable) this.fire(item.id, 0);
        });
        return { el, inputs: [], label: el, write: look };
      }
      case "edit": {
        const el = (item.lines ?? 1) > 1 ? h("textarea", { cls: "menu-dialog-input ld-edit", attrs: { rows: String(item.lines) } }) : h("input", { cls: "menu-dialog-input ld-edit", attrs: { type: item.pwd ? "password" : "text" } });
        if (item.prompt) el.placeholder = item.prompt;
        this.sized(el, item);
        el.addEventListener("change", () => {
          this.settle(item.id);
          this.fire(item.id, 0);
        });
        el.addEventListener("input", () => this.typed(item.id));
        return {
          el,
          inputs: [el],
          read: () => ({ text: el.value }),
          write: (i) => {
            const text = i.text ?? "";
            if (el.value !== text) {
              // the caret stays where it was, as far as the text still reaches it
              const at = document.activeElement === el ? el.selectionStart : null;
              el.value = text;
              if (at !== null) el.setSelectionRange(Math.min(at, text.length), Math.min(at, text.length));
            }
            el.readOnly = i.readonly === true;
          },
        };
      }
      case "real":
      case "int": {
        const el = h("input", { cls: "menu-dialog-input", attrs: { type: "text" } });
        this.sized(el, item);
        el.addEventListener("change", () => {
          this.settle(item.id);
          this.fire(item.id, 0);
        });
        el.addEventListener("input", () => this.typed(item.id));
        const length = item.kind === "real" && LENGTHS.has(item.edit ?? 1);
        return {
          el,
          inputs: [el],
          read: () => {
            const text = el.value.trim();
            let value: number | null;
            if (length) value = parseLength(text, units());
            else {
              const n = Number(text.replace(/°$/, ""));
              value = text !== "" && Number.isFinite(n) && (item.kind === "real" || Number.isInteger(n)) ? n : null;
            }
            return { raw: el.value, value };
          },
          write: (i) => {
            const v = typeof i.value === "number" ? i.value : null;
            el.value = i.raw ?? (v === null ? "" : length ? formatLength(v, units()) : fmt(v));
          },
        };
      }
      case "check":
      case "check3":
      case "radio": {
        const box = h("input", { attrs: { type: item.kind === "radio" ? "radio" : "checkbox" } });
        const label = h("span", { text: item.text ?? "" });
        if (item.kind === "radio") this.radio(group, box);
        box.addEventListener("change", () => {
          if (item.kind === "radio") this.exclude(group, box);
          change()();
        });
        return {
          el: h("label", { cls: "menu-dialog-check ld-check" }, box, label),
          inputs: [box],
          label,
          read: () => ({ value: item.kind === "check3" ? (box.indeterminate ? 2 : box.checked ? 1 : 0) : box.checked }),
          write: (i) => {
            box.checked = i.kind === "check3" ? i.value === 1 : i.value === true;
            box.indeterminate = i.kind === "check3" && i.value === 2;
          },
        };
      }
      case "button": {
        const el = h("button", { cls: "btn small", text: item.text ?? "", attrs: { type: "button" } });
        this.sized(el, item);
        if (!item.toggle) {
          el.addEventListener("click", change());
          return { el, inputs: [el], label: el };
        }
        // a toggle keeps its pressed state as its value, which each click sends
        let pressed = item.value === true;
        const show = (): void => el.setAttribute("aria-pressed", String(pressed));
        show();
        el.addEventListener("click", () => {
          pressed = !pressed;
          show();
          change()();
        });
        return {
          el,
          inputs: [el],
          label: el,
          read: () => ({ value: pressed }),
          write: (i) => {
            pressed = i.value === true;
            show();
          },
        };
      }
      case "lb":
        return this.listBrowser(item);
      case "tree":
        return this.tree(item);
      case "popup":
      case "list": {
        const el = h("select", { cls: "menu-dialog-input ld-select" });
        if (item.kind === "list") {
          el.size = Math.max(2, item.lines ?? 8);
          el.multiple = item.multi === true;
          el.classList.add("ld-list");
        }
        this.sized(el, item);
        el.addEventListener("change", () => change(el.selectedIndex)());
        return {
          el,
          inputs: [el],
          read: () => ({ sel: [...el.options].filter((o) => o.selected).map((o) => o.index) }),
          write: (i) => {
            const choices = i.choices ?? [];
            if (el.options.length !== choices.length || choices.some((t, k) => el.options[k].text !== t)) {
              el.replaceChildren(...choices.map((t, k) => h("option", { text: t, attrs: { value: String(k) } })));
            }
            const sel = new Set(i.sel ?? []);
            for (const o of el.options) o.selected = sel.has(o.index);
            if (!sel.size && !el.multiple) el.selectedIndex = -1;
          },
        };
      }
      case "color": {
        const holder = h("span", { cls: "ld-color" });
        let index = typeof item.value === "number" ? item.value : 0;
        const draw = (): void => {
          const doc = store.session?.doc;
          if (!doc) return;
          holder.replaceChildren(
            colorSwatch({
              doc,
              value: index,
              label: "Colour",
              onPick: (picked) => {
                index = picked;
                draw();
                change()();
              },
            }),
          );
        };
        draw();
        return {
          el: holder,
          // the swatch is drawn again with each value, so it is looked up when disabled
          get inputs() {
            return [...holder.querySelectorAll("button")];
          },
          read: () => ({ value: index }),
          write: (i) => {
            index = typeof i.value === "number" ? i.value : 0;
            draw();
          },
        };
      }
      case "group":
      case "checkgroup":
      case "radiogroup": {
        const set = h("fieldset", { cls: item.frame === false ? "ld-group ld-plain" : "ld-group" });
        const label = h("span", { text: item.text ?? "" });
        let box: HTMLInputElement | null = null;
        if (item.kind === "group") set.append(h("legend", {}, label));
        else {
          box = h("input", { attrs: { type: item.kind === "radiogroup" ? "radio" : "checkbox" } });
          const own = box;
          if (item.kind === "radiogroup") this.radio(group, own);
          own.addEventListener("change", () => {
            if (item.kind === "radiogroup") this.exclude(group, own);
            set.disabled = !own.checked;
            change()();
          });
          // a fieldset's first legend stays enabled while the rest of it is disabled
          set.append(h("legend", {}, h("label", { cls: "ld-check" }, own, label)));
        }
        const inner = item.first === null || item.first === undefined ? null : this.block(item.first, seen, item.id);
        if (inner) set.append(inner);
        const own = box;
        return {
          el: set,
          inputs: own ? [own] : [set],
          label,
          read: own ? () => ({ value: own.checked }) : undefined,
          write: own
            ? (i) => {
                own.checked = i.value === true;
                set.disabled = !own.checked;
              }
            : undefined,
        };
      }
      case "tabs": {
        const strip = h("div", { cls: "ld-tabs", attrs: { role: "tablist" } });
        const panes = new Map<number, HTMLElement>();
        const tabs = new Map<number, HTMLButtonElement>();
        let current = typeof item.value === "number" ? item.value : (item.panes?.[0] ?? 0);
        const show = (): void => {
          for (const [id, pane] of panes) {
            pane.classList.toggle("ld-off", id !== current);
            pane.inert = id !== current;
          }
          for (const [id, tab] of tabs) tab.setAttribute("aria-selected", String(id === current));
        };
        // a swap control has no strip: the script switches its panes, and the user doesn't
        const box = h("div", { cls: "ld-tabbed" }, ...(item.swap ? [] : [strip]));
        for (const id of item.panes ?? []) {
          const pane = this.items.get(id);
          const tab = h("button", { cls: "ld-tab", text: pane?.text ?? "", attrs: { type: "button", role: "tab" } });
          tab.addEventListener("click", () => {
            current = id;
            show();
            change(id)();
          });
          tabs.set(id, tab);
          if (!item.swap) strip.append(tab);
          const body = h("div", { cls: "ld-pane", attrs: { role: "tabpanel" } });
          const inner = pane?.first === null || pane?.first === undefined ? null : this.block(pane.first, seen, id);
          if (inner) body.append(inner);
          panes.set(id, body);
          box.append(body);
        }
        show();
        return {
          el: box,
          inputs: item.swap ? [] : [...tabs.values()],
          read: () => ({ value: current }),
          write: (i) => {
            if (typeof i.value === "number" && panes.has(i.value)) current = i.value;
            show();
          },
        };
      }
      case "sep": {
        const el = h("hr", { cls: "ld-sep" });
        this.sized(el, item);
        return { el, inputs: [] };
      }
      case "slider": {
        // a slider's events: each move while dragged when live, else its release
        const el = h("input", { cls: "ld-slider-bar", attrs: { type: "range", min: "0", max: String(item.max ?? 0), step: "1" } });
        const label = h("span", { text: item.text ?? "" });
        el.addEventListener("change", () => {
          this.settle(item.id);
          this.fire(item.id, 0);
        });
        el.addEventListener("input", () => {
          if (this.items.get(item.id)?.live) this.fire(item.id, 0, true);
        });
        return {
          el: h("label", { cls: "ld-slider" }, label, el),
          inputs: [el],
          label,
          read: () => ({ value: Number(el.value) }),
          write: (i) => {
            el.max = String(i.max ?? 0);
            el.value = String(typeof i.value === "number" ? i.value : 0);
          },
        };
      }
      case "frame": {
        // a picture, symbol, swatch or custom area: an empty framed box of the size the script gave
        const el = h("span", { cls: "ld-frame", text: item.text ?? "" });
        if (item.pw) el.style.width = `${item.pw}px`;
        if (item.ph) el.style.height = `${item.ph}px`;
        return { el, inputs: [], label: el };
      }
      default:
        // an image from the plug-in's resources, which aren't read
        return { el: h("span", { cls: "ld-image" }), inputs: [] };
    }
  }

  /**
   * A list browser: a header row over the rows. A click selects a row (shift extends the selection
   * from the last row clicked, command or control toggles one, unless the list is single-line); a
   * header click asks for a sort when sorting is on; a check or radio column toggles on click; a
   * double click and the arrow, delete and enter keys send their events. Images, owner-drawn cells
   * and typing into a cell aren't drawn.
   */
  private listBrowser(item: Item): Control {
    let cols: readonly LbCol[] = item.cols ?? [];
    let rows: readonly LbRow[] = item.rows ?? [];
    let flags: Item = item;
    let sel = new Set<number>(item.sel ?? []);
    let anchor = sel.size ? Math.min(...sel) : 0;
    let sortNow: readonly [number, boolean] | null = item.sort ?? null;
    /** the sort the user asked for, sent with the next event */
    let sortAsk: [number, boolean] | null = null;
    let checks = checkMarks(rows);
    let pending: LbEvent | null = null;
    const head = h("div", { cls: "ld-lb-head" });
    const body = h("div", { cls: "ld-lb-body", attrs: { tabindex: "0", role: "grid" } });
    body.style.height = `${(item.lines ?? 8) * LB_ROW}px`;
    const el = h("fieldset", { cls: "ld-lb" }, head, body);
    const live = (): boolean => this.items.get(item.id)?.enabled !== false;
    const width = (k: number): string => `${(cols[k]?.width ?? 10) * STD_CHAR + 12}px`;
    const send = (data: number, event: LbEvent): void => {
      if (!live()) return;
      pending = event;
      this.fire(item.id, data);
    };
    const paint = (): void => {
      head.hidden = flags.hdr === false;
      head.replaceChildren(
        ...cols.map((c, k) => {
          const arrow = sortAsk ?? sortNow;
          const mark = arrow && arrow[0] === k ? (arrow[1] ? " ▲" : " ▼") : "";
          const th = h("button", { cls: "ld-lb-th", text: `${c.header}${mark}`, attrs: { type: "button", title: c.tip || c.header } });
          th.style.width = width(k);
          th.style.textAlign = JUSTIFY[c.hjust] ?? "left";
          th.addEventListener("click", () => {
            if (!live() || !flags.sorting) return;
            const next: [number, boolean] = sortNow && sortNow[0] === k ? [k, !sortNow[1]] : [k, true];
            sortAsk = next;
            send(k, { type: LB_SORT, row: -1, col: k });
          });
          return th;
        }),
      );
      body.replaceChildren(
        ...rows.map((r, n) => {
          const tr = h("div", { cls: sel.has(n) ? "ld-lb-tr ld-sel" : "ld-lb-tr", attrs: { role: "row", "data-row": String(n), "aria-selected": String(sel.has(n)) } });
          r.cells.forEach((cell, k) => {
            const col = cols[k];
            if (!col) return;
            const td = h("span", { cls: "ld-lb-td", attrs: { role: "gridcell", "data-col": String(k) } });
            td.style.width = width(k);
            td.style.textAlign = JUSTIFY[cell.just ?? col.hjust] ?? "left";
            const style = cell.style ?? 0;
            td.classList.toggle("ld-bold", (style & 1) !== 0);
            td.classList.toggle("ld-italic", (style & 2) !== 0);
            td.classList.toggle("ld-underline", (style & 4) !== 0);
            if (cell.tcolor) td.style.color = rgb(cell.tcolor);
            if (cell.fill) td.style.background = rgb(cell.fill);
            if (col.ctype === 2 || col.ctype === 3) {
              const on = checks[`${n},${k}`] === true;
              td.classList.toggle("ld-on", on);
              td.append(h("span", { cls: col.ctype === 2 ? "ld-lb-radio" : "ld-lb-box", attrs: { role: col.ctype === 2 ? "radio" : "checkbox", "aria-checked": String(on) } }));
            } else {
              td.textContent = cell.text ?? "";
            }
            tr.append(td);
          });
          return tr;
        }),
      );
    };
    const hit = (e: Event): { row: number; col: number } | null => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const tr = t?.closest<HTMLElement>(".ld-lb-tr");
      if (!tr) return null;
      const td = t?.closest<HTMLElement>(".ld-lb-td");
      return { row: Number(tr.dataset.row), col: td ? Number(td.dataset.col) : -1 };
    };
    body.addEventListener("click", (e) => {
      const at = hit(e);
      if (!at || !live()) return;
      const { row: n, col: k } = at;
      const col = cols[k];
      if (col && (col.ctype === 2 || col.ctype === 3)) {
        // a radio column has one row on; a check column flips its row
        if (col.ctype === 2) rows.forEach((_, r) => (checks[`${r},${k}`] = false));
        checks[`${n},${k}`] = col.ctype === 2 ? true : !checks[`${n},${k}`];
        paint();
        send(n, { type: LB_CHECK, row: n, col: k });
        return;
      }
      // the second click of a double click: the row is rebuilt on each click, so the browser may not
      // send a dblclick, and the click's own count says it
      if (e.detail === 2) {
        send(n, { type: LB_DOUBLE, row: n, col: k });
        return;
      }
      const multi = flags.multi === true && flags.single !== true;
      if (e.shiftKey && multi) {
        const lo = Math.min(anchor, n);
        const hi = Math.max(anchor, n);
        const span: number[] = [];
        for (let r = lo; r <= hi; r++) span.push(r);
        sel = new Set(span);
      } else if ((e.metaKey || e.ctrlKey) && multi) {
        if (sel.has(n)) sel.delete(n);
        else sel.add(n);
        anchor = n;
      } else {
        sel = new Set([n]);
        anchor = n;
      }
      paint();
      send(n, { type: LB_SELECT, row: n, col: k });
    });
    body.addEventListener("keydown", (e) => {
      if (!rows.length || !live()) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = Math.min(rows.length - 1, Math.max(0, anchor + (e.key === "ArrowDown" ? 1 : -1)));
        sel = new Set([n]);
        anchor = n;
        paint();
        send(n, { type: e.key === "ArrowDown" ? LB_DOWN : LB_UP, row: n, col: -1 });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        send(anchor, { type: LB_DELETE, row: anchor, col: -1 });
      } else if (e.key === "Enter") {
        send(anchor, { type: LB_ENTER, row: anchor, col: -1 });
      }
    });
    paint();
    return {
      el,
      inputs: [],
      read: () => {
        const v = { sel: [...sel].sort((a, b) => a - b), sort: sortAsk ?? sortNow, checks: { ...checks }, event: pending };
        sortAsk = null;
        pending = null;
        return v;
      },
      write: (i) => {
        flags = i;
        cols = i.cols ?? [];
        rows = i.rows ?? [];
        sel = new Set(i.sel ?? []);
        anchor = sel.size ? Math.min(...sel) : 0;
        sortNow = i.sort ?? null;
        checks = checkMarks(rows);
        paint();
      },
    };
  }

  /** A tree control: each item indented under its parent, a triangle to open and close those with children; a click selects, and the triangle sends the item. */
  private tree(item: Item): Control {
    let flat: readonly (readonly [number, string, number, boolean])[] = item.tree ?? [];
    let sel = new Set<number>(item.sel ?? []);
    let open = new Set<number>(item.open ?? []);
    const el = h("div", { cls: "ld-tree", attrs: { role: "tree" } });
    const paint = (): void => {
      const parents = new Map(flat.map(([id, , p]) => [id, p] as const));
      const depth = (id: number): number => {
        let d = 0;
        for (let p = parents.get(id) ?? 0; p !== 0; p = parents.get(p) ?? 0) d += 1;
        return d;
      };
      // an item shows when every item above it is open
      const shown = flat.filter(([id]) => {
        for (let p = parents.get(id) ?? 0; p !== 0; p = parents.get(p) ?? 0) if (!open.has(p)) return false;
        return true;
      });
      el.replaceChildren(
        ...shown.map(([id, text, , kids]) => {
          const twist = h("span", { cls: "ld-tree-twist", text: kids ? (open.has(id) ? "▾" : "▸") : "", attrs: { "aria-hidden": "true" } });
          const row = h("div", { cls: sel.has(id) ? "ld-tree-row ld-sel" : "ld-tree-row", attrs: { role: "treeitem", "data-id": String(id) } }, twist, h("span", { text }));
          row.style.paddingLeft = `${depth(id) * 16 + 6}px`;
          if (kids) row.setAttribute("aria-expanded", String(open.has(id)));
          return row;
        }),
      );
    };
    el.addEventListener("click", (e) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const row = t?.closest<HTMLElement>(".ld-tree-row");
      if (!row || this.items.get(item.id)?.enabled === false) return;
      const id = Number(row.dataset.id);
      const kids = flat.find(([i]) => i === id)?.[3] === true;
      if (t?.classList.contains("ld-tree-twist")) {
        if (!kids) return;
        if (open.has(id)) open.delete(id);
        else open.add(id);
      } else {
        sel = new Set([id]);
      }
      paint();
      this.fire(item.id, id);
    });
    paint();
    return {
      el,
      inputs: [],
      read: () => ({ sel: [...sel], open: [...open] }),
      write: (i) => {
        flat = i.tree ?? [];
        sel = new Set(i.sel ?? []);
        open = new Set(i.open ?? []);
        paint();
      },
    };
  }

  private radio(group: number, box: HTMLInputElement): void {
    const list = this.radios.get(group) ?? [];
    list.push(box);
    this.radios.set(group, list);
  }

  /** A radio button chosen: the others of its group turn off (a radio button group box disabling its own). */
  private exclude(group: number, box: HTMLInputElement): void {
    if (!box.checked) return;
    for (const other of this.radios.get(group) ?? []) {
      if (other === box || !other.checked) continue;
      other.checked = false;
      const set = other.closest("legend")?.parentElement;
      if (set instanceof HTMLFieldSetElement) set.disabled = true;
    }
  }
}

const open = new Map<number, LayoutDialog>();

/** Shows the dialog `spec` (vs.RunLayoutDialog's, as JSON), or brings the open one up to it, and waits for its next event. */
export function runLayoutDialog(spec: string): Promise<DialogEvent> {
  const s = JSON.parse(spec) as Spec;
  let d = open.get(s.id);
  if (d) d.update(s);
  else {
    d = new LayoutDialog(s);
    open.set(s.id, d);
  }
  return d.next();
}

export function closeLayoutDialog(id: number): void {
  open.get(id)?.close();
  open.delete(id);
}

/** Closes every dialog a script left open (it ended or was stopped). */
export function closeLayoutDialogs(): void {
  for (const d of open.values()) d.close();
  open.clear();
}
