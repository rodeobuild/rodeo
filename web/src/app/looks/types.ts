// View › Work Like: what a look is. A look makes Rodeo's interface work like another application
// people already know: its menu bar and the commands in each menu, its words for things, where its
// panels sit, its ribbon, toolbars, toolbox, command line and status bar, its keys, how its mouse
// moves the view and the colours of its chrome. Each look is one module (rhino.ts, revit.ts …)
// exporting `look: LookSpec`, with a stylesheet of its own scoped to :root[data-look="<id>"].
// Every button, key and typed command runs one of Rodeo's own tools or menu commands, so nothing a
// look offers is a copy of the other application's code: it is Rodeo, laid out the way they are.
// Icons are always Rodeo's own (TOOL_ICON, UI_ICON, PALETTE_ICON): the other applications' icons,
// logos and artwork are theirs and never copied.

import type { ToolId } from "../state.ts";
import type { PaneArrangement } from "../viewPanes.ts";

export type LookId = "rodeo" | "rhino" | "sketchup" | "revit" | "archicad" | "autocad" | "vectorworks";

/**
 * What a button, a key or a typed command does: picks one of Rodeo's tools, runs one of Rodeo's
 * menu commands by its path as Rodeo builds its menus ("Modify › Group", "View › Standard Views ›
 * Top" — the paths are listed in menus.txt, never made up), shows or hides a palette, or runs code.
 */
export type Command =
  | { readonly tool: ToolId }
  | { readonly menu: string }
  | { readonly palette: string }
  | { readonly run: () => void; readonly checked?: () => boolean };

/** A button on a ribbon, a toolbar, the toolbox or the Quick Access Toolbar. */
export interface LookButton {
  /** the application's name for it, shown under or beside the icon and in its tooltip */
  readonly label: string;
  readonly do: Command;
  /** an icon (trusted SVG markup); by default the tool's icon, else the palette's, else the label's initials */
  readonly icon?: string;
  /** on a ribbon: a large button (icon over the label) or a small one (icon beside the label); toolbars are always icons */
  readonly size?: "large" | "small";
  /** the key shown in its tooltip, as the application writes it ("WA", "L", "Ctrl+Shift+E") */
  readonly keys?: string;
  /** a drop-down of more buttons beside it (a ribbon's split button); the first runs on a click of the button itself */
  readonly more?: readonly LookButton[];
}

/** A ribbon panel's buttons: large buttons in a row, or a stack of up to three small ones (an array). */
export type RibbonItem = LookButton | readonly LookButton[];

export interface RibbonPanel {
  /** its name along the bottom of the panel ("Build", "Draw", "Modify") */
  readonly title: string;
  readonly items: readonly RibbonItem[];
}

export interface RibbonTab {
  readonly title: string;
  readonly panels: readonly RibbonPanel[];
  /**
   * a contextual tab, shown only while something is selected and then brought to the front, its
   * title with the selection's kind put in for {0} ("Modify | {0}" becomes "Modify | Walls")
   */
  readonly contextual?: boolean;
  /** the coloured application tab at the start (Revit's File, AutoCAD's application button): opens Rodeo's File menu */
  readonly application?: boolean;
}

export interface RibbonSpec {
  readonly tabs: readonly RibbonTab[];
  /** the tab in front at first (its title) */
  readonly start?: string;
  /** the Quick Access Toolbar: small icon buttons in the title bar row above the ribbon */
  readonly quickAccess?: readonly LookButton[];
}

/** One row of toolbar buttons, or several behind tabs (Rhino's Standard, CPlanes, Set View … tabs). */
export interface ToolbarSpec {
  readonly tabs: readonly { readonly title: string; readonly buttons: readonly (LookButton | "-")[] }[];
  /** whether the tabs' titles show (Rhino) or only the first row's buttons (SketchUp's Getting Started) */
  readonly showTabs?: boolean;
}

/** A column of tool buttons down one side of the drawing: SketchUp's Large Tool Set, Rhino's sidebar, Archicad's Toolbox. */
export interface ToolboxSpec {
  readonly side: "left" | "right";
  /** buttons across: 1 or 2 */
  readonly columns: 1 | 2;
  /** each button's name beside its icon (Archicad's Toolbox) rather than in its tooltip only */
  readonly labels?: boolean;
  /** a caption over the column ("Toolbox") */
  readonly title?: string;
  readonly groups: readonly { readonly title?: string; readonly buttons: readonly LookButton[] }[];
}

/** A command line: type a command's name or alias and press Enter or Space; Enter or Space on its own repeats the last one. */
export interface CommandLineSpec {
  /** over the drawing, under the menus (Rhino), or along the foot of the window (AutoCAD) */
  readonly where: "top" | "bottom";
  /** the prompt while no command runs: "Command" (Rhino), "Type a command" (AutoCAD) */
  readonly prompt: string;
  /** how many lines of history show above (bottom) or below (top) the prompt */
  readonly history: number;
  /** the application's commands by their full names as typed ("Line", "ExtrudeCrv", "PLINE"), matched without regard to case */
  readonly commands: Readonly<Record<string, Command>>;
  /** short names for commands: alias to a full name in `commands` ("L": "LINE", "M": "Move") */
  readonly aliases?: Readonly<Record<string, string>>;
  /** names shown in capitals (AutoCAD) */
  readonly upper?: boolean;
}

/** One thing along a status bar. */
export type StatusItem =
  /** what the tool asks for next (Rodeo's Mode bar hint) */
  | { readonly kind: "hint" }
  /** the cursor's position in the drawing */
  | { readonly kind: "coords"; readonly label?: string }
  /** a toggle: a menu row with a check mark, or anything with `checked` */
  | { readonly kind: "toggle"; readonly label: string; readonly do: Command; readonly style?: "text" | "check" | "icon"; readonly icon?: string }
  /** a button that runs something */
  | { readonly kind: "button"; readonly label: string; readonly do: Command; readonly icon?: string }
  /** fixed text */
  | { readonly kind: "text"; readonly text: string }
  /** the drawing's units ("Millimeters", "Feet and Inches") */
  | { readonly kind: "units" }
  /** the active layer, a drop-down of the layers */
  | { readonly kind: "layer"; readonly label?: string }
  /** how many objects are selected */
  | { readonly kind: "selection" }
  /** a box typed lengths and values go in (SketchUp's Measurements): it shows what the data bar shows */
  | { readonly kind: "measurements"; readonly label: string }
  /** pushes what follows to the far end */
  | { readonly kind: "spacer" };

export interface StatusBarSpec {
  /** one row, or more stacked (Rhino's Osnap row above its status bar) */
  readonly rows: readonly (readonly StatusItem[])[];
}

/** Where a palette sits in a look. Rodeo's palette ids: basic, toolsets, objectInfo, attributes, navigation, resources, snapping, visualization, workingPlanes, agents. */
export interface PalettePlace {
  readonly where: "left" | "right" | "float" | "hidden";
  /** a tab of this palette */
  readonly tabOf?: string;
  /** order down its dock, lower first */
  readonly order?: number;
  /** its share of the dock's height against the others that fill (300 by default) */
  readonly weight?: number;
  readonly collapsed?: boolean;
}

export interface MouseSpec {
  /** what dragging with the middle button (the wheel pressed) does in 3D; Shift held does the other of orbit and pan */
  readonly middle: "orbit" | "pan" | "zoom";
  /** what dragging with the right button does in 3D (Shift held does the other of orbit and pan); "menu" leaves it to the context menu */
  readonly right: "orbit" | "pan" | "menu";
}

export interface LookSpec {
  readonly id: LookId;
  /** the application's name, as the View › Work Like menu lists it */
  readonly name: string;
  /** the theme its chrome starts in, as the application starts (View › Appearance can still change it) */
  readonly theme: "light" | "dark";
  /**
   * The menu bar: each menu's title and its rows, by Rodeo's menu paths ("Edit › Undo", "-" for a
   * separator). Rodeo's own menus are File, Edit, View, Modify, Model, AEC, Tools, Text, Plug-ins,
   * Stage, Window and Help: a look menu's `id` names the ones whose leftover commands (those the
   * look doesn't place) it takes, joined by "|" ("Modify|AEC"), and each of Rodeo's should be in
   * exactly one id, so no command is lost or lands somewhere odd. Null keeps Rodeo's menus.
   */
  readonly menus: readonly { readonly id: string; readonly title: string; readonly rows: readonly string[] }[] | null;
  /**
   * The application's words for Rodeo's, swapped wherever the interface shows the whole text
   * (a palette's title, a menu row, a tab, a dialog's label): "Object Info": "Properties",
   * "Create Symbol…": "Make Component…". Exact texts only, never parts of one.
   */
  readonly terms: Readonly<Record<string, string>>;
  /** where Rodeo's palettes sit; any left out keep where Rodeo starts them, closed */
  readonly palettes: Readonly<Record<string, PalettePlace>>;
  /** each dock's width in px */
  readonly docks?: { readonly left?: number; readonly right?: number };
  /** Rodeo's own top bar (its Menu button, 2D/3D, tools, Undo and Save): shown, or gone (the look's own rows take its place) */
  readonly topBar: boolean;
  /** the menu bar's row of titles */
  readonly menuBar: boolean;
  /**
   * A title bar row at the very top, with the file's name in the middle (Revit, AutoCAD): the
   * ribbon's Quick Access Toolbar goes in it. Without one the menu bar is the first row.
   */
  readonly titleBar?: boolean;
  readonly ribbon?: RibbonSpec;
  readonly toolbars?: ToolbarSpec;
  readonly toolbox?: ToolboxSpec;
  readonly commandLine?: CommandLineSpec;
  readonly statusBar?: StatusBarSpec;
  /**
   * Where Rodeo's Mode bar (the tool's modes and options) goes: over the drawing as Rodeo has it,
   * in a row under the ribbon or toolbars (Revit's Options Bar, Archicad's Info Box), or at the
   * start of the status bar.
   */
  readonly modeBar: "hud" | "options" | "status";
  /** Rodeo's View bar (layer, class, view): over the drawing, along the foot of the drawing (Revit's View Control Bar, Archicad's Quick Options), or gone */
  readonly viewBar: "hud" | "foot" | "hidden";
  /** Rodeo's snapping pill and cursor position over the drawing (a status bar usually shows them instead) */
  readonly snapPill: boolean;
  /** the docks' rails of palette icons (Rodeo's own idea; the other applications have none) */
  readonly rails: boolean;
  /**
   * Single keys over the drawing: "l", "⇧z" (Shift+Z), "F8", "Delete". They win over Rodeo's own
   * keys; a key a look leaves out does what it does in Rodeo.
   */
  readonly keys?: Readonly<Record<string, Command>>;
  /** keys typed one after the other within a second (Revit's two-letter shortcuts): "wa", "dr", "vv" */
  readonly sequences?: Readonly<Record<string, Command>>;
  readonly mouse: MouseSpec;
  /** the colour the 2D drawing is drawn on ("#ffffff"); Rodeo's paper when absent */
  readonly paper?: string;
  /** the colour the 3D view is drawn on; Rodeo's light grey when absent */
  readonly background3d?: string;
  /** the view panes it starts with (Rhino's four views) */
  readonly panes?: PaneArrangement;
}
