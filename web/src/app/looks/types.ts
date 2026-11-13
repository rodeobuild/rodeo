// View › Work Like: what a look is. A look makes Rodeo's interface work like another application
// people already know: its menu bar and the commands in each menu, its words for things, where its
// panels sit, its ribbon, toolbars, toolbox, command line and status bar, its keys, how its mouse
// moves the view and the colours of its chrome. Each look is one module (rhino.ts, revit.ts …)
// exporting `look: LookSpec`, with a stylesheet of its own scoped to :root[data-look="<id>"].
// Every button, key and typed command runs one of Rodeo's own tools or menu commands, so nothing a
// look offers is a copy of the other application's code: it is Rodeo, laid out the way they are.
// Icons are Rodeo's own: its line icons (TOOL_ICON, UI_ICON, PALETTE_ICON), or the coloured set in
// glyphs/, drawn for Rodeo from what each command does. The other applications' icons, logos and
// artwork are theirs and never copied.

import type { ToolId } from "../state.ts";
import type { PaneArrangement } from "../viewPanes.ts";

export type LookId = "rodeo" | "rhino" | "sketchup" | "revit" | "archicad" | "autocad" | "vectorworks";

/**
 * What a button, a key or a typed command does: picks one of Rodeo's tools, runs one of Rodeo's
 * menu commands by its path as Rodeo builds its menus ("Modify › Group", "View › Standard Views ›
 * Top" — the paths are listed in menus.txt, never made up), shows or hides a palette, or runs code.
 */
export type Command =
  | { readonly tool: ToolId; readonly mode?: string }
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
  /** in a ribbon's stack of small buttons: the icon alone, its name in the tooltip (AutoCAD's Draw and Modify icons) */
  readonly iconOnly?: true;
  /** on a toolbar: its name beside the icon (Archicad 28's Guides, Grids, Measure and Group) */
  readonly showLabel?: true;
}

/** A ribbon panel's buttons: large buttons in a row, or a stack of up to three small ones (an array). */
export type RibbonItem = LookButton | readonly LookButton[];

export interface RibbonPanel {
  /** its name along the bottom of the panel ("Build", "Draw", "Modify") */
  readonly title: string;
  readonly items: readonly RibbonItem[];
  /**
   * the panel's slide-out: more of its buttons, dropped below the panel by a click on its title,
   * which then shows a caret (AutoCAD's "Draw ▾", "Modify ▾")
   */
  readonly extra?: readonly RibbonItem[];
  /** the small arrow at the panel's bottom-right corner that opens its dialog or palette (AutoCAD's Properties ↘) */
  readonly launcher?: LookButton;
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
  /** buttons across */
  readonly columns: 1 | 2 | 3 | 4;
  /** each button's name beside its icon (Archicad's Toolbox) rather than in its tooltip only */
  readonly labels?: boolean;
  /** a caption over the column ("Toolbox") */
  readonly title?: string;
  readonly groups: readonly ToolboxGroup[];
}

/** A group of the toolbox's tools under its title. */
export interface ToolboxGroup {
  readonly title?: string;
  readonly buttons: readonly LookButton[];
  /**
   * its title a band with a disclosure triangle that folds the group away and back (Archicad's
   * Design, Document and More); "closed" starts it folded. Kept per look in this browser.
   */
  readonly fold?: "open" | "closed";
}

/** An option a typed command offers at its prompt: clicked, or typed by its name or its key letters. */
export interface LineOption {
  /** its name as the application writes it ("Extents", "Selected", "2Point") */
  readonly name: string;
  readonly do: Command;
  /**
   * the letters that pick it when typed, besides its whole name: by default its capital letters
   * ("SElected" → "SE") or else its first letter. Matched without regard to case.
   */
  readonly key?: string;
}

/**
 * A typed command the application's way: what it runs, the words it asks with and the options it
 * offers. A plain Command runs straight away with Rodeo's own prompt.
 */
export interface LineCommand {
  /** what it runs once it has what it needs; none for a command that only offers options (Rhino's Zoom) */
  readonly do?: Command;
  /**
   * It works on a selection: with nothing selected it first asks for one in these words ("Select
   * objects to move. Press Enter when done", "Select objects"), each pick adding to the selection,
   * and Enter then runs it. With objects already selected it runs at once.
   */
  readonly select?: string;
  /** its first prompt in the application's words ("Start of line", "Specify first point"), shown till its tool moves on to the next step */
  readonly prompt?: string;
  /** the options shown after its prompt, which a click or their name or key letters picks */
  readonly options?: readonly LineOption[];
  /** what Enter or Space does at its prompt (Rhino's Zoom: Extents); with none they end the command */
  readonly enter?: Command;
  /** the option Enter takes, shown as the default (AutoCAD's "<real time>", Rhino's "Press Enter for extents") */
  readonly enterLabel?: string;
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
  readonly commands: Readonly<Record<string, Command | LineCommand>>;
  /** short names for commands: alias to a full name in `commands` ("L": "LINE", "M": "Move") */
  readonly aliases?: Readonly<Record<string, string>>;
  /** names shown in capitals (AutoCAD) */
  readonly upper?: boolean;
  /**
   * How options are written after a prompt: Rhino's "( Extents Selected )" or AutoCAD's
   * "[Extents/Selected]". Rhino's by default.
   */
  readonly options?: "rhino" | "autocad";
  /**
   * Rodeo's tool prompts in the application's words, by the prompt's first part (before " · "):
   * "Click or drag to draw a line": "Start of line". A prompt not listed shows Rodeo's own words.
   */
  readonly prompts?: Readonly<Record<string, string>>;
}

/** One thing along a status bar. */
export type StatusItem =
  /** what the tool asks for next (Rodeo's Mode bar hint); `style: "sentences"` writes its parts as sentences, as SketchUp's status bar does */
  | {
      readonly kind: "hint";
      readonly style?: "sentences";
      /**
       * the application's own words for a step, by the hint's first part (before " · "): Revit's "Click to enter wall start point.";
       * a * in a key stands for any words ("Click a * wall where the door's middle goes")
       */
      readonly prompts?: Readonly<Record<string, string>>;
    }
  /** the cursor's position in the drawing */
  | {
      readonly kind: "coords";
      readonly label?: string;
      /** "xyz": lower-case x, y and z, z on the construction plane (Rhino's "CPlane x 12.3 y 4.5 z 0.000") */
      readonly style?: "xyz";
    }
  /** a toggle: a menu row with a check mark, or anything with `checked` */
  | { readonly kind: "toggle"; readonly label: string; readonly do: Command; readonly style?: "text" | "check" | "icon"; readonly icon?: string }
  /** a button that runs something; `iconOnly` shows just the icon, with the label as its tooltip (SketchUp's status bar icons) */
  | { readonly kind: "button"; readonly label: string; readonly do: Command; readonly icon?: string; readonly iconOnly?: true }
  /** fixed text */
  | { readonly kind: "text"; readonly text: string }
  /** the drawing's units ("Millimeters", "Feet and Inches") */
  | { readonly kind: "units" }
  /**
   * the active layer, a drop-down of the layers; `of: "class"` makes it the active class instead (a
   * drop-down of the classes), and `swatch` puts a square in its pen colour before its name
   */
  | {
      readonly kind: "layer";
      readonly label?: string;
      readonly of?: "layer" | "class";
      readonly swatch?: boolean;
      /** with `of: "class"`, the name shown for Rodeo's None class (Rhino's "Default", as its layer table) */
      readonly none?: string;
    }
  /** a feature Rodeo doesn't have: drawn greyed with `why` as its tooltip, and nothing happens on a click (with `icon`, drawn as that icon, and a click says `why`) */
  | { readonly kind: "inert"; readonly label: string; readonly why: string; readonly icon?: string }
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
   * A small titled panel at the foot of the column of tools (Rhino's OSnap panel under its sidebar):
   * its rows are status items, drawn and run as the status bar draws them. It sits in the toolbox's
   * column, the right one when the toolbox is on the right.
   */
  readonly sidePanel?: { readonly title: string; readonly items: readonly StatusItem[] };
  /**
   * Where Rodeo's Mode bar (the tool's modes and options) goes: over the drawing as Rodeo has it,
   * in a row under the ribbon or toolbars (Revit's Options Bar, Archicad's Info Box), at the start
   * of the status bar, or into the command line as the prompt's options (Rhino, AutoCAD: the bar
   * itself is hidden and its modes are clicked or typed there). "keys": hidden: the tool's modes
   * are picked by their keys, named in the status bar's hint, or by the toolbars' buttons, as
   * SketchUp's are.
   */
  readonly modeBar: "hud" | "options" | "status" | "line" | "keys";
  /**
   * The Mode bar's groups drawn as the application draws a command's options: "menus", labelled
   * drop-downs (Revit's Options Bar); "panels", captioned panels of buttons after a Main panel
   * (Archicad's Info Box). The tool's name and hint are left out of both.
   */
  readonly modeFields?: "menus" | "panels";
  /** Rodeo's View bar (layer, class, view): over the drawing, along the foot of the drawing (Revit's View Control Bar, Archicad's Quick Options), or gone */
  readonly viewBar: "hud" | "foot" | "hidden";
  /** Rodeo's snapping pill and cursor position over the drawing (a status bar usually shows them instead) */
  readonly snapPill: boolean;
  /** the docks' rails of palette icons (Rodeo's own idea; the other applications have none) */
  readonly rails: boolean;
  /**
   * Keys over the drawing: "l", "⇧z" (Shift+Z), "F8", "Delete", and held with Ctrl (⌘ on a Mac) or
   * Alt as Windows writes them, modifiers in the order Ctrl, Alt, Shift: "Ctrl+L", "Ctrl+Shift+G",
   * "Ctrl+Alt+H". They win over Rodeo's own keys; a key a look leaves out does what it does in Rodeo.
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
  /**
   * The panes' names the application's way, in place of Rodeo's "Plan" and "3D · Right": the
   * plan's, a 3D pane's by its standard view ("Right Isometric": "Perspective"), and a 3D pane
   * turned from them.
   */
  readonly paneNames?: { readonly plan: string; readonly views: Readonly<Record<string, string>>; readonly turned: string };
  /**
   * Its buttons' icons: Rodeo's own line icons (Vectorworks, and any look leaving it out), or
   * Rodeo's coloured set (glyphs/), painted in the look's colours by its stylesheet's --g-* values.
   */
  readonly icons?: "rodeo" | "color";
  /**
   * Palettes whose content shows the application's way while the look is on, by Rodeo's palette
   * id: Rhino's and AutoCAD's layer tables, SketchUp's Tags, Revit's Project Browser, Archicad's
   * Project Map. Rodeo's own content comes back when the look goes.
   */
  readonly panels?: Readonly<Record<string, LookPanel>>;
  /** a bar along the foot of the drawing in place of Rodeo's View bar: Revit's View Control Bar, Archicad's Quick Options */
  readonly viewControl?: "revit" | "archicad";
  /** AutoCAD's Model and Layout tabs along the foot of the drawing: the design layers, then each sheet layer */
  readonly layoutTabs?: boolean;
  /** the 2D drawing's grid: shown (Rhino, AutoCAD, Vectorworks) or not (Revit, Archicad and SketchUp draw none) */
  readonly grid?: boolean;
  /** the 2D grid's colours, minor then major lines, and the X and Y axes through the origin in theirs (Rhino's red and green) */
  readonly gridColors?: { readonly minor: string; readonly major: string; readonly xAxis?: string; readonly yAxis?: string };
  /** Rodeo's view cube over the drawing (the TOP / 3D box): shown, or gone where the application has none */
  readonly viewCube?: boolean;
  /** false: one drawing per window and no tabs of open drawings over it (Rhino, SketchUp); Window lists them */
  readonly docTabs?: boolean;
  /** true: the document tabs begin with a Start tab that opens Window › Home Screen; it is never the front tab (AutoCAD) */
  readonly startTab?: boolean;
  /** each 3D pane shows its construction plane's grid and axes (Rhino's viewports) */
  readonly grid3d?: boolean;
  /**
   * The 3D view's drawing axes through the origin and its sky, as SketchUp draws them: red X, green Y and
   * blue Z, each a solid line along its positive half and dotted along its negative half, with a sky above
   * the horizon ("sketchup"). Nothing for the others.
   */
  readonly axes3d?: "sketchup";
  /**
   * A drawing opens in the 3D view, in perspective, and 2D objects show there on their layer's plane,
   * as in SketchUp, which has no plan view (the 2D tools draw in the 3D view in every look).
   */
  readonly start3d?: boolean;
  /** the docks' palettes stacked as a tray of sections each rolled up or out by its title (SketchUp's Default Tray), not tabs */
  readonly tray?: boolean;
  /** Rhino's viewport tabs under the viewports, above the status bar: Perspective, Top, Front, Right and a "+" (paneTabs.ts) */
  readonly paneTabs?: boolean;
  /**
   * AutoCAD's drawing-area chrome over the drawing: the viewport words at its top-left ("[-][Top][2D
   * Wireframe]", each a menu), the navigation bar under the view cube and the UCS icon at its bottom-left
   */
  readonly viewportControls?: boolean;
}

/** One column of a layer table: what each layer's row shows there. */
export type LayerColumn =
  | "name"
  /** a check mark on the layer new objects go on; clicking another makes it the current one */
  | "current"
  /** shown or hidden (a light bulb, an eye) */
  | "visible"
  /** greyed: shown but not to be picked (Rodeo's grey) */
  | "lock"
  /** the layer's colour: its pen colour */
  | "color"
  | "linetype"
  | "lineweight"
  /** how many objects are on it */
  | "count";

/** A palette's content the application's way (LookSpec.panels). */
export type LookPanel =
  /**
   * A table of layers: Rodeo's classes, one row each, as Rhino's Layers panel, AutoCAD's Layer
   * Properties Manager and SketchUp's Tags list them. `none` is the name Rodeo's class None goes by
   * ("Default", "0", "Untagged"); `style` picks the look of the rows and the buttons over them.
   */
  | { readonly kind: "layerTable"; readonly style: "rhino" | "autocad" | "sketchup"; readonly columns: readonly LayerColumn[]; readonly none: string }
  /** a tree of the project's views, sheets and resources: Revit's Project Browser, Archicad's Navigator Project Map */
  | { readonly kind: "browser"; readonly style: "revit" | "archicad" };
