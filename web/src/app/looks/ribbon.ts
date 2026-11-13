// A look's ribbon (Revit, AutoCAD): a row of tabs over the front tab's panels. Each panel holds its
// buttons in a row (large ones, or a stack of small ones) with its name along the bottom. The
// application tab opens the File menu; a contextual tab appears while something is selected and
// comes to the front. Double-clicking a tab minimises the ribbon to its tabs, and a tab then drops
// over the drawing until the next click elsewhere or Escape. A panel with a slide-out (AutoCAD's
// "Draw ▾") drops the rest of its buttons below it from a click on its title, until a button is run,
// a click elsewhere or Escape.

import "./ribbon.css";
import { h } from "../dom.ts";
import { store } from "../state.ts";
import { lookButton, selectionKind } from "./commands.ts";
import { openLookMenu } from "./looks.ts";
import type { LookButton, RibbonItem, RibbonPanel, RibbonSpec, RibbonTab } from "./types.ts";

/** Whether the ribbon is minimised to its tabs; kept per browser, as the look's other choices are. */
const MIN_KEY = "openvwx.look.ribbonMin";

function readMinimised(): boolean {
  try {
    return localStorage.getItem(MIN_KEY) === "1";
  } catch {
    // storage blocked: the ribbon starts open
    return false;
  }
}

function writeMinimised(on: boolean): void {
  try {
    localStorage.setItem(MIN_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

/** A stack is an array of small buttons; a bare button is large unless its own size says small. */
function isStack(item: RibbonItem): item is readonly LookButton[] {
  return Array.isArray(item);
}

function itemEl(item: RibbonItem): HTMLElement {
  if (isStack(item)) return h("div", { cls: "lk-ribbon-stack" }, ...item.map((b) => lookButton(b, { size: "small", iconOnly: b.iconOnly })));
  return lookButton(item, { size: item.size ?? "large" });
}

const CARET = `<svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// the launcher's mark: an arrow into the corner, Rodeo's own drawing
const LAUNCH = `<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2.5 2.5 7.5 7.5M7.5 4v3.5H4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A panel; with a slide-out its title is a button that calls `slideOut` with the panel's element. */
function panelEl(panel: RibbonPanel, slideOut: (el: HTMLElement, title: HTMLElement, panel: RibbonPanel) => void): HTMLElement {
  // keyed by its sense: a panel and a tab of one English name can be two words in a language (AutoCAD's
  // Japanese View tab 表示, its View panel ビュー)
  const i18n = `Ribbon panel › ${panel.title}`;
  const el = h("div", { cls: "lk-ribbon-panel" }, h("div", { cls: "lk-ribbon-items" }, ...panel.items.map((item) => itemEl(item))));
  if (panel.launcher) {
    const launch = lookButton({ ...panel.launcher, icon: LAUNCH, size: undefined }, { iconOnly: true });
    launch.classList.add("lk-ribbon-launcher");
    el.classList.add("lk-has-launcher");
    el.append(launch);
  }
  if (!panel.extra?.length) {
    el.append(h("div", { cls: "lk-ribbon-panel-title", text: panel.title, title: panel.title, attrs: { "data-i18n": i18n } }));
    return el;
  }
  const title = h(
    "button",
    { cls: "lk-ribbon-panel-title lk-ribbon-panel-more", title: panel.title, attrs: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" } },
    h("span", { cls: "lk-ribbon-panel-name", text: panel.title, attrs: { "data-i18n": i18n } }),
    h("span", { cls: "lk-ribbon-panel-caret", html: CARET }),
  );
  title.addEventListener("click", () => slideOut(el, title, panel));
  el.append(title);
  return el;
}

/** A tab's title; a contextual one has the selection's kind put in for {0}. */
function titleOf(tab: RibbonTab, kind: string): string {
  return tab.contextual ? tab.title.split("{0}").join(kind || "Selection") : tab.title;
}

/** Builds the ribbon into `into`; returns the call that takes it down. */
export function mountRibbon(into: HTMLElement, spec: RibbonSpec): () => void {
  const tabs = spec.tabs;
  const contextual = tabs.filter((t) => t.contextual && !t.application);
  const firstNormal = (): RibbonTab | null => tabs.find((t) => !t.application && !t.contextual) ?? null;
  const named = spec.start ? tabs.find((t) => t.title === spec.start && !t.application && !t.contextual) : undefined;

  let minimised = readMinimised();
  // a minimised ribbon's front tab dropped over the drawing
  let dropped = false;
  let front: RibbonTab | null = named ?? firstNormal();
  // the tab in front before a contextual tab came up, to return to when it hides
  let returnTo: RibbonTab | null = null;
  let contextShown = false;
  // the tab whose panels the body holds now (undefined before the first paint)
  let bodyOf: RibbonTab | null | undefined = undefined;

  const root = h("div", { cls: "lk-ribbon" });
  // the open slide-out and the panel title that opened it
  let slide: { readonly el: HTMLElement; readonly title: HTMLElement } | null = null;

  const closeSlide = (): void => {
    if (!slide) return;
    slide.title.setAttribute("aria-expanded", "false");
    slide.title.classList.remove("active");
    slide.el.remove();
    slide = null;
  };

  /** Drops a panel's slide-out below it, or takes it away when it is the one open. */
  const slideOut = (panelBox: HTMLElement, title: HTMLElement, panel: RibbonPanel): void => {
    const again = slide?.title === title;
    closeSlide();
    if (again || !panel.extra?.length) return;
    const r = panelBox.getBoundingClientRect();
    const el = h(
      "div",
      { cls: "lk-ribbon-slide", attrs: { role: "group", "aria-label": panel.title } },
      h("div", { cls: "lk-ribbon-items" }, ...panel.extra.map((item) => itemEl(item))),
    );
    el.style.left = `${Math.round(r.left)}px`;
    el.style.top = `${Math.round(r.bottom)}px`;
    el.style.minWidth = `${Math.round(r.width)}px`;
    // a button run from the slide-out closes it, as a menu does; a caret's menu stays open (it stops the click)
    el.addEventListener("click", (e) => {
      if ((e.target as Element).closest(".lk-btn")) closeSlide();
    });
    title.setAttribute("aria-expanded", "true");
    title.classList.add("active");
    root.append(el);
    slide = { el, title };
  };
  const tabRow = h("div", { cls: "lk-ribbon-tabs", attrs: { role: "tablist" } });
  const body = h("div", { cls: "lk-ribbon-body", attrs: { role: "tabpanel" } });
  root.append(tabRow, body);

  const tabEls = new Map<RibbonTab, HTMLButtonElement>();
  // the application tab comes first, whatever order the look lists the tabs in
  for (const tab of [...tabs.filter((t) => t.application), ...tabs.filter((t) => !t.application)]) {
    const el = tabButton(tab);
    tabEls.set(tab, el);
    tabRow.append(el);
  }

  function tabButton(tab: RibbonTab): HTMLButtonElement {
    if (tab.application) {
      // the application tab opens Rodeo's File menu rather than switching tabs
      const app = h("button", { cls: "lk-ribbon-tab lk-ribbon-app", text: tab.title, attrs: { type: "button", "aria-haspopup": "menu" } });
      app.addEventListener("click", () => {
        const r = app.getBoundingClientRect();
        openLookMenu("File", r.left, r.bottom);
      });
      return app;
    }
    const el = h("button", {
      cls: `lk-ribbon-tab${tab.contextual ? " lk-ribbon-ctx" : ""}`,
      attrs: tab.contextual ? { type: "button", role: "tab" } : { type: "button", role: "tab", "data-i18n": `Ribbon tab › ${tab.title}` },
    });
    el.addEventListener("click", () => {
      front = tab;
      // on a minimised ribbon the tab drops over the drawing and stays until the next click elsewhere
      if (minimised) dropped = true;
      paint();
    });
    // a double-click minimises the ribbon, or restores it when it is minimised
    el.addEventListener("dblclick", () => {
      front = tab;
      minimised = !minimised;
      writeMinimised(minimised);
      dropped = false;
      paint();
    });
    return el;
  }

  /** Puts the current state on screen: tab titles and states, the front tab's panels, the minimised classes. */
  function paint(): void {
    const kind = selectionKind();
    root.classList.toggle("lk-ribbon-min", minimised);
    root.classList.toggle("lk-ribbon-open", minimised && dropped);
    for (const [tab, el] of tabEls) {
      el.hidden = !!tab.contextual && !contextShown;
      const text = titleOf(tab, kind);
      if (el.textContent !== text) el.textContent = text;
      if (tab.application) continue;
      const isFront = tab === front;
      el.classList.toggle("active", isFront);
      el.setAttribute("aria-selected", String(isFront));
    }
    // the body is rebuilt only when the front tab changes; its buttons follow the state themselves
    if (bodyOf !== front) {
      bodyOf = front;
      closeSlide();
      body.replaceChildren(...(front?.panels.map((p) => panelEl(p, slideOut)) ?? []));
    }
  }

  /** The selection came or went: a contextual tab comes to the front, or hides and the tab before it returns. */
  function onSelection(): void {
    const any = store.selection.size > 0;
    if (any !== contextShown) {
      contextShown = any;
      if (any) {
        const ctx = contextual[0];
        if (ctx) {
          if (front && !front.contextual) returnTo = front;
          front = ctx;
        }
      } else {
        dropped = false;
        if (front?.contextual) front = returnTo ?? firstNormal();
        returnTo = null;
      }
    }
    paint();
  }

  // a button run from a dropped body closes it, as a menu does; a caret's menu stays open (it stops the click)
  body.addEventListener("click", (e) => {
    if (minimised && dropped && (e.target as Element).closest(".lk-btn")) {
      dropped = false;
      paint();
    }
  });

  // a mouse wheel turns the panels sideways when they run past the window
  body.addEventListener(
    "wheel",
    (e) => {
      if (body.scrollWidth <= body.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      body.scrollLeft += e.deltaY;
    },
    { passive: false },
  );

  // a click elsewhere, or Escape, takes a dropped body or an open slide-out away
  const onDown = (e: PointerEvent): void => {
    const at = e.target as Node;
    if (slide && !slide.el.contains(at) && !slide.title.contains(at)) closeSlide();
    if (!dropped || root.contains(at)) return;
    dropped = false;
    paint();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape" && slide) closeSlide();
    else if (e.key === "Escape" && dropped) {
      dropped = false;
      paint();
    }
  };
  // the panels turned sideways or the window resized: a slide-out would be left behind
  body.addEventListener("scroll", closeSlide);
  window.addEventListener("resize", closeSlide);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);

  const off = store.on("selection", onSelection);
  into.append(root);
  onSelection();

  return () => {
    off();
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", closeSlide);
    closeSlide();
    root.remove();
  };
}
