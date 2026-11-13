// View › Work Like: a project browser tree of the drawing's views, sheets, families and resources,
// laid out the way the look's application lists them: Revit's Project Browser (Views, Sheets,
// Families, Groups, Revit Links, with + and − boxes and dotted guide lines) or Archicad's Project
// Map (a header with the file's name, triangles, Stories, Elevations, 3D, Project Indexes …). Every
// leaf runs one of Rodeo's own commands: a design layer makes itself active and shows the 2D plan,
// a sheet layer is made active, the standard views and the 3D view are Rodeo's, and a symbol
// double-clicked picks the Symbol tool with that definition, as the Resources palette does. The
// tree follows the drawing, its layers, the active layer, the 3D view and the saved views.

import type { LayerInfo, SymbolInfo, VwxDocument } from "../../../core/index.ts";
import { setActiveLayer } from "../../commands.ts";
import { h } from "../../dom.ts";
import { appContext } from "../../ext.ts";
import { runMenuCommand } from "../../menubar.ts";
import { savedViews } from "../../panels/views.ts";
import { symbolDefsOf } from "../../panels/resources.ts";
import { store } from "../../state.ts";
import "./browserTree.css";

/** A line icon this module draws: each one stands for what its leaf does. */
type Icon = "plan" | "view3d" | "elevation" | "sheet" | "family" | "folder" | "view" | "story";

/** One item of the tree: a branch when `kids` is set (empty or not), else a leaf. */
interface TreeNode {
  readonly key: string;
  readonly label: string;
  readonly icon?: Icon;
  readonly kids?: readonly TreeNode[];
  /** a branch shown open until the user opens or closes it */
  readonly open?: boolean;
  /** the item that is the drawing's current one (bold) */
  readonly current?: boolean;
  /** a label from the drawing (never translated) */
  readonly named?: boolean;
  /** a top-level heading of the tree */
  readonly root?: boolean;
  /** a click on the leaf */
  readonly run?: () => void;
  /** a double-click on the leaf */
  readonly dbl?: () => void;
}

/** One visible line of the tree, as the keyboard and the mouse see it. */
interface Row {
  readonly key: string;
  readonly node: TreeNode;
  readonly depth: number;
  /** for each ancestor column: whether that ancestor has later siblings (so its guide line goes on) */
  readonly guides: readonly boolean[];
  readonly branch: boolean;
  /** a branch with something to show inside it (it gets a + or − box or triangle) */
  readonly hasKids: boolean;
  readonly open: boolean;
}

/** Trusted line-icon drawing for each icon, in a 14 by 14 box (stroke only, in currentColor). */
const ICON_PATHS: Readonly<Record<Icon, string>> = {
  plan: '<rect x="2" y="2" width="10" height="10"/><path d="M6 2v6h6"/>',
  view3d: '<path d="M7 1.8 12 4.4v5.2L7 12.2 2 9.6V4.4z"/><path d="M2 4.4 7 7l5-2.6M7 7v5.2"/>',
  elevation: '<path d="M1.5 11.5h11"/><path d="M2 11.5 5.5 5 8 9l1.5-2 2.5 4.5"/>',
  sheet: '<path d="M3 1.5h5.5L11.5 4.5v8H3z"/><path d="M8.5 1.5v3h3M5 7h5M5 9.5h5"/>',
  family: '<circle cx="5" cy="5" r="3"/><rect x="7" y="7" width="5" height="5"/>',
  folder: '<path d="M1.5 4h4l1.2 1.5h5.8v6.5h-11z"/>',
  view: '<path d="M3.5 1.5h7v11L7 10 3.5 12.5z"/>',
  story: '<path d="M2 3.5h10M2 7h10M2 10.5h10"/>',
};

/** Revit's Elevations: each side, and the standard 3D view that looks at the building from it. */
const REVIT_SIDES: readonly (readonly [string, string])[] = [
  ["East", "Right"],
  ["North", "Back"],
  ["South", "Front"],
  ["West", "Left"],
];

/** Archicad's Elevations: the same views, in the order the Project Map lists them. */
const ARCHICAD_SIDES: readonly (readonly [string, string])[] = [
  ["North", "Back"],
  ["South", "Front"],
  ["East", "Right"],
  ["West", "Left"],
];

/** Makes a design layer the active one and shows the 2D plan (the drawing's Top/Plan). */
function showPlan(id: string): void {
  setActiveLayer(id);
  appContext()?.show2d();
}

/** Makes a sheet layer the active one and shows the 2D drawing it is on. */
function showSheet(id: string): void {
  setActiveLayer(id);
  appContext()?.show2d();
}

/** Shows the 3D view, as View › 3D View does when it isn't shown (the menu item itself toggles). */
function show3d(): void {
  void appContext()?.show3d();
}

/** Picks a symbol definition for the Symbol tool and switches to it, as the Resources palette does. */
function insertSymbol(index: number): void {
  store.activeSymbol = index;
  store.emit("symbol");
  appContext()?.setTool("symbol");
}

/** A sheet's label: "<number> - <title>" when it has both, else its name. */
function sheetLabel(l: LayerInfo): string {
  return l.name && l.title ? `${l.name} - ${l.title}` : l.name;
}

/** Each design layer with its Archicad story number: the lowest is 0 (Ground), listed top first. */
function numberedDesigns(designs: readonly LayerInfo[]): { readonly layer: LayerInfo; readonly n: number }[] {
  const byElevation = designs.every((l) => typeof l.elevation === "number");
  const order = designs
    .map((layer, i) => ({ layer, i }))
    .sort((a, b) => (byElevation ? (a.layer.elevation ?? 0) - (b.layer.elevation ?? 0) : 0) || a.i - b.i);
  const number = new Map(order.map((x, n) => [x.layer.id, n]));
  return designs.map((layer) => ({ layer, n: number.get(layer.id) ?? 0 })).sort((a, b) => b.n - a.n);
}

/** The design layers as Revit's Floor Plans: one leaf each, in the drawing's order. */
function planLeaf(l: LayerInfo, active: string | null, view3d: boolean): TreeNode {
  return { key: `plan:${l.id}`, label: l.name, icon: "plan", named: true, current: !view3d && l.id === active, run: () => showPlan(l.id) };
}

/** The sheet layers as leaves: "<number> - <title>", each made active. */
function sheetLeaves(sheets: readonly LayerInfo[], active: string | null): TreeNode[] {
  return sheets.map((l) => ({ key: `sheet:${l.id}`, label: sheetLabel(l), icon: "sheet", named: true, current: l.id === active, run: () => showSheet(l.id) }));
}

/** The symbol definitions by folder, folders first at each level; a double-click picks one for the Symbol tool. */
function familyNodes(doc: VwxDocument): TreeNode[] {
  interface Dir {
    readonly name: string;
    readonly path: string;
    readonly dirs: Map<string, Dir>;
    readonly defs: SymbolInfo[];
  }
  const root: Dir = { name: "", path: "", dirs: new Map(), defs: [] };
  for (const def of symbolDefsOf(doc)) {
    let dir = root;
    for (const part of def.folder.split("/").filter(Boolean)) {
      const path = dir.path ? `${dir.path}/${part}` : part;
      let next = dir.dirs.get(part);
      if (!next) {
        next = { name: part, path, dirs: new Map(), defs: [] };
        dir.dirs.set(part, next);
      }
      dir = next;
    }
    dir.defs.push(def);
  }
  const build = (dir: Dir): TreeNode[] => {
    const folders = [...dir.dirs.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d): TreeNode => ({ key: `folder:${d.path}`, label: d.name, icon: "folder", named: true, kids: build(d) }));
    const defs = dir.defs.map(
      (def): TreeNode => ({
        key: `symbol:${def.index}`,
        label: def.name,
        icon: "family",
        named: true,
        current: store.activeSymbol === def.index,
        dbl: () => insertSymbol(def.index),
      }),
    );
    return [...folders, ...defs];
  };
  return build(root);
}

/** Revit's Project Browser: Views (all), Sheets (all), Families, Groups and Revit Links. */
function revitNodes(doc: VwxDocument): TreeNode[] {
  const layers = doc.layers();
  const designs = layers.filter((l) => l.kind === "design");
  const sheets = layers.filter((l) => l.kind === "sheet");
  const active = store.activeLayerId;
  const view3d = store.view3d;
  const saved = savedViews()?.names() ?? [];
  const views: TreeNode[] = [
    { key: "r:plans", label: "Floor Plans", kids: designs.map((l) => planLeaf(l, active, view3d)), open: true },
    {
      key: "r:3d",
      label: "3D Views",
      kids: [{ key: "r:3d:{3D}", label: "{3D}", icon: "view3d", current: view3d, run: show3d }],
      open: true,
    },
    {
      key: "r:elevations",
      label: "Elevations (Building Elevation)",
      kids: REVIT_SIDES.map(([label, view]) => ({ key: `r:elev:${view}`, label, icon: "elevation", run: () => runMenuCommand(`View › Standard Views › ${view}`) })),
    },
  ];
  if (saved.length) {
    views.push({
      key: "r:saved",
      label: "Saved Views",
      open: true,
      kids: saved.map((name, i): TreeNode => ({ key: `r:saved:${i}`, label: name, icon: "view", named: true, run: () => savedViews()?.open(i) })),
    });
  }
  return [
    { key: "r:views", label: "Views (all)", kids: views, open: true, root: true },
    { key: "r:sheets", label: "Sheets (all)", kids: sheetLeaves(sheets, active), open: true, root: true },
    { key: "r:families", label: "Families", kids: familyNodes(doc), root: true },
    { key: "r:groups", label: "Groups", kids: [], root: true },
    { key: "r:links", label: "Revit Links", kids: [], root: true },
  ];
}

/** Archicad's Project Map: Stories, Elevations, 3D, Project Indexes and the rest of its branches. */
function archicadNodes(doc: VwxDocument): TreeNode[] {
  const layers = doc.layers();
  const designs = layers.filter((l) => l.kind === "design");
  const sheets = layers.filter((l) => l.kind === "sheet");
  const active = store.activeLayerId;
  const view3d = store.view3d;
  const empty = (key: string, label: string): TreeNode => ({ key, label, kids: [] });
  return [
    {
      key: "a:stories",
      // Rodeo's word: the Archicad look's terms show it as "Stories" (its own "Stories" there means Story Settings)
      label: "Layers",
      open: true,
      kids: numberedDesigns(designs).map(
        ({ layer, n }): TreeNode => ({
          key: `story:${layer.id}`,
          label: `${n}. ${layer.name}`,
          icon: "story",
          named: true,
          current: !view3d && layer.id === active,
          run: () => showPlan(layer.id),
        }),
      ),
    },
    empty("a:sections", "Sections"),
    {
      key: "a:elevations",
      label: "Elevations",
      kids: ARCHICAD_SIDES.map(([label, view]) => ({ key: `a:elev:${view}`, label, icon: "elevation", run: () => runMenuCommand(`View › Standard Views › ${view}`) })),
    },
    empty("a:interior", "Interior Elevations"),
    empty("a:worksheets", "Worksheets"),
    empty("a:details", "Details"),
    empty("a:3d-docs", "3D Documents"),
    {
      key: "a:3d",
      label: "3D",
      open: true,
      kids: [
        { key: "a:3d:perspective", label: "Generic Perspective", icon: "view3d", current: view3d, run: show3d },
        { key: "a:3d:axonometry", label: "Generic Axonometry", icon: "view3d", run: () => runMenuCommand("View › Standard Views › Right Isometric") },
      ],
    },
    empty("a:schedules", "Schedules"),
    {
      key: "a:indexes",
      label: "Project Indexes",
      kids: [{ key: "a:layouts", label: "Layouts", kids: sheetLeaves(sheets, active) }],
    },
    empty("a:lists", "Lists"),
    empty("a:info", "Info"),
  ];
}

/**
 * Fills `into` with the tree and keeps it up to date; returns the call that takes it down.
 * The tree opens and closes its branches by a click, Enter, or the arrow keys, and keeps that
 * state while mounted. In the Revit style a search field filters the leaves by name.
 */
export function mountBrowserTree(into: HTMLElement, style: "revit" | "archicad"): () => void {
  /** the open state a branch was given by the user, by key (else its own default) */
  const openState = new Map<string, boolean>();
  let query = "";
  let cursor: string | null = null;
  let rows: Row[] = [];
  const elements = new Map<string, HTMLElement>();
  let timer = 0;
  let lastSaved = "";

  const search = h("input", {
    cls: "lk-br-search-input",
    attrs: { type: "search", placeholder: "Search", "aria-label": "Search the project browser", spellcheck: "false" },
  });
  const head = h("div", { cls: "lk-br-head" });
  const tree = h("div", {
    cls: "lk-br-tree",
    attrs: { tabindex: "0", role: "tree", "aria-label": style === "revit" ? "Project Browser" : "Project Map" },
  });
  const root = h(
    "div",
    { cls: "lk-browser", attrs: { "data-style": style } },
    ...(style === "revit" ? [h("div", { cls: "lk-br-search" }, search)] : [head]),
    tree,
  );
  into.replaceChildren(root);

  /** Flattens the nodes into the visible rows, opening the branches the tree shows open (all, while searching). */
  const flatten = (nodes: readonly TreeNode[], depth: number, guides: readonly boolean[], out: Row[]): void => {
    const keep = (n: TreeNode): boolean => {
      if (!query) return true;
      if (n.kids) return n.kids.some(keep);
      return n.label.toLowerCase().includes(query);
    };
    const shown = nodes.filter(keep);
    shown.forEach((node, i) => {
      const isLast = i === shown.length - 1;
      const kids = node.kids && query ? node.kids.filter(keep) : node.kids;
      const hasKids = !!kids && kids.length > 0;
      const open = query ? true : (openState.get(node.key) ?? node.open ?? false);
      out.push({ key: node.key, node, depth, guides, branch: !!node.kids, hasKids, open });
      if (kids && hasKids && open) flatten(kids, depth + 1, [...guides, !isLast], out);
    });
  };

  /** Paints the cursor row and its ARIA state on the rows already drawn. */
  const paint = (): void => {
    for (const [key, el] of elements) {
      const on = key === cursor;
      el.classList.toggle("is-cursor", on);
      el.setAttribute("aria-selected", String(on));
    }
  };

  /** Builds the row element for one visible line. */
  const rowElement = (r: Row): HTMLElement => {
    const classes = ["lk-br-row"];
    if (r.node.root) classes.push("is-root");
    if (r.node.current) classes.push("is-current");
    if (r.branch) classes.push("is-branch");
    const attrs: Record<string, string> = {
      role: "treeitem",
      "data-key": r.key,
      "aria-level": String(r.depth + 1),
      "aria-selected": String(r.key === cursor),
    };
    if (r.branch) attrs["aria-expanded"] = String(r.open);
    if (r.node.current) attrs["aria-current"] = "true";
    const el = h("div", { cls: classes.join(" "), attrs });
    el.style.setProperty("--d", String(r.depth));
    if (r.key === cursor) el.classList.add("is-cursor");
    for (const [k, on] of r.guides.entries()) {
      if (!on) continue;
      const guide = h("span", { cls: "lk-br-guide" });
      guide.style.left = `calc(4px + ${k} * var(--u) + var(--u) / 2)`;
      el.append(guide);
    }
    const toggle = h("span", { cls: "lk-br-tog" });
    if (r.hasKids) {
      if (style === "revit") toggle.append(h("span", { cls: `lk-br-box ${r.open ? "is-open" : "is-closed"}` }));
      else toggle.append(h("span", { cls: `lk-br-tri ${r.open ? "is-open" : "is-closed"}` }));
    }
    el.append(toggle);
    if (r.node.icon) {
      el.append(h("span", { cls: "lk-br-ico", html: `<svg viewBox="0 0 14 14" aria-hidden="true">${ICON_PATHS[r.node.icon]}</svg>` }));
    }
    el.append(h("span", { cls: "lk-br-label", text: r.node.label, attrs: r.node.named ? { translate: "no" } : {} }));
    el.addEventListener("click", () => {
      cursor = r.key;
      if (r.branch) {
        if (r.hasKids) openState.set(r.key, !r.open);
        render();
      } else {
        paint();
        r.node.run?.();
      }
    });
    el.addEventListener("dblclick", () => r.node.dbl?.());
    return el;
  };

  /** Redraws the whole tree from the drawing as it is now, keeping the cursor on its row when that row is still shown. */
  function render(): void {
    const doc = store.session?.doc ?? null;
    if (style === "archicad") head.textContent = store.fileName || "";
    const nodes = doc ? (style === "revit" ? revitNodes(doc) : archicadNodes(doc)) : [];
    rows = [];
    flatten(nodes, 0, [], rows);
    elements.clear();
    if (!doc) {
      tree.replaceChildren(h("div", { cls: "lk-br-empty", text: "No drawing open" }));
      return;
    }
    if (rows.length === 0) {
      tree.replaceChildren(h("div", { cls: "lk-br-empty", text: "Nothing matches" }));
      return;
    }
    const els = rows.map((r) => {
      const el = rowElement(r);
      elements.set(r.key, el);
      return el;
    });
    tree.replaceChildren(...els);
  }

  /** Moves the cursor to a row and brings it into view. */
  const moveTo = (key: string): void => {
    cursor = key;
    paint();
    elements.get(key)?.scrollIntoView({ block: "nearest" });
  };

  /** Keyboard: arrows move and open or close, Enter opens a branch or runs a leaf. */
  tree.addEventListener("keydown", (e) => {
    const idx = rows.findIndex((r) => r.key === cursor);
    const at = idx >= 0 ? rows[idx] : undefined;
    switch (e.key) {
      case "ArrowDown":
        if (rows.length) moveTo(rows[Math.min(idx + 1, rows.length - 1)]!.key);
        break;
      case "ArrowUp":
        if (rows.length) moveTo(rows[Math.max(idx - 1, 0)]!.key);
        break;
      case "ArrowRight":
        if (!at) break;
        if (at.branch && at.hasKids && !at.open) {
          openState.set(at.key, true);
          render();
          moveTo(at.key);
        } else if (at.branch && at.open && rows[idx + 1]?.depth === at.depth + 1) {
          moveTo(rows[idx + 1]!.key);
        }
        break;
      case "ArrowLeft":
        if (!at) break;
        if (at.branch && at.open) {
          openState.set(at.key, false);
          render();
          moveTo(at.key);
        } else {
          for (let i = idx - 1; i >= 0; i--) {
            if (rows[i]!.depth < at.depth) {
              moveTo(rows[i]!.key);
              break;
            }
          }
        }
        break;
      case "Enter":
      case " ":
        if (!at) break;
        if (at.branch) {
          if (at.hasKids) {
            openState.set(at.key, !at.open);
            render();
            moveTo(at.key);
          }
        } else {
          at.node.run?.();
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  });

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    render();
  });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter") {
      e.preventDefault();
      tree.focus();
    }
  });

  /** Saved views have no topic of their own, so a change to their names is found by looking. */
  const savedSignature = (): string => savedViews()?.names().join("\u0000") ?? "";
  const schedule = (): void => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      render();
    }, 0);
  };
  const unsubscribe = store.on(["session", "file", "layer", "view", "display", "view3d", "viz3d", "symbol"], schedule);
  lastSaved = savedSignature();
  const poll = window.setInterval(() => {
    const now = savedSignature();
    if (now !== lastSaved) {
      lastSaved = now;
      schedule();
    }
  }, 400);

  render();

  return () => {
    unsubscribe();
    window.clearInterval(poll);
    window.clearTimeout(timer);
    elements.clear();
    into.replaceChildren();
  };
}
