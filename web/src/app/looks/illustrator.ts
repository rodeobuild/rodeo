// View › Work Like › Illustrator: Adobe Illustrator 2026 for Windows, laid out as its Essentials
// workspace. A dark window with the menu bar across the top and the Mode bar's options row under it,
// a single column of tools down the left (grouped as the Getting Started toolbar sorts them, with
// the All Tools drawer behind its "…" button and Fill and Stroke at its foot), the Properties,
// Layers and Libraries palettes docked right, the artboard on a grey canvas, and the status bar at
// the foot with its zoom box, rotation, artboard navigation and the Help bar's tips for the tool.
// Every button, key and menu row runs one of Rodeo's own tools or menu commands, and the icons are
// Rodeo's own line icons, with a few drawn here for the tools that share one. Nothing is copied
// from Adobe: only its English names for things.

import "./illustrator.css";
import type { ToolId } from "../state.ts";
import type { Command, LookButton, LookSpec } from "./types.ts";
import { lookIcon } from "./commands.ts";
import { colorFillStroke, defaultFillStroke, gradientFillStroke, noneFillStroke, swapFillStroke, toggleFillStroke } from "./fillStroke.ts";

/** A tool as a command, in a mode when it names one. */
const tool = (id: ToolId, mode?: string): Command => (mode === undefined ? { tool: id } : { tool: id, mode });
/** A menu command by its path as Rodeo builds its menus. */
const m = (path: string): Command => ({ menu: path });

/** A toolbox button: its name, what it runs, the key its tooltip shows, its flyout and its own icon. */
const btn = (label: string, use: Command, keys?: string, more?: readonly LookButton[], icon?: string): LookButton => ({
  label,
  do: use,
  ...(keys ? { keys } : {}),
  ...(more ? { more } : {}),
  ...(icon ? { icon } : {}),
});

// Icons drawn for the tools that share one with another button (or have none), in Rodeo's line
// style: a pen nib, a curve through its points, a corner point, a brush, a pencil, a lasso loop,
// a magic wand with a spark, scissors, a knife blade, an eraser and text on a curve.
const NIB = '<path d="M5 19 9 9.5 15 4.5l4 4-5 6z"/><path d="M9 9.5l5 5.5"/>';
const PEN_ICON = lookIcon(NIB);
const ADD_ICON = lookIcon(NIB + '<path d="M5 1.8v6M2 4.8h6"/>');
const DELETE_ICON = lookIcon(NIB + '<path d="M2 4.8h6"/>');
const ANCHOR_ICON = lookIcon('<path d="M3.5 19.5 12 5.5l8.5 14"/><rect x="10.5" y="3.5" width="3" height="3"/>');
const CURVE_ICON = lookIcon('<path d="M3.5 17.5C8 5 14 19 20.5 6.5"/><circle cx="3.5" cy="17.5" r="1.6" fill="currentColor"/><circle cx="12" cy="13.2" r="1.6" fill="currentColor"/><circle cx="20.5" cy="6.5" r="1.6" fill="currentColor"/>');
const BRUSH_ICON = lookIcon('<path d="M15 4l5 5-8.5 8.5L6.5 12.5z"/><path d="M6.5 12.5c-1.5 0-2.5 1-2.5 3 0 1.5-.8 2.5-2 3 2.5.6 5.5 0 6.5-1.6"/>');
const PENCIL_ICON = lookIcon('<path d="M4 20l1.2-4.3L15 5.9l3.1 3.1L8.3 18.8z"/><path d="M13.5 7.4l3.1 3.1"/>');
const LASSO_ICON = lookIcon('<path d="M12 4c4.5 0 8 1.8 8 5.2 0 3.4-3.5 5.3-8 5.3s-8-1.9-8-5.3C4 5.8 7.5 4 12 4z"/><path d="M12 14.5c0 2 .5 4 1.5 5.5"/><circle cx="13.5" cy="20.5" r="1" fill="currentColor"/>');
const WAND_ICON = lookIcon('<path d="M4.5 19.5 13 11"/><path d="M17 3v4M15 5h4M18.5 9.5l.5.5M15.5 9.5l-.5.5"/>');
const SCISSORS_ICON = lookIcon('<path d="M8.5 9.5 19 19M15.5 9.5 5 19"/><circle cx="6" cy="6.5" r="2.5"/><circle cx="18" cy="6.5" r="2.5"/>');
const KNIFE_ICON = lookIcon('<path d="M4 20 14 8.5 18.5 4 20 5.5 15.5 10 4 20z"/>');
const ERASER_ICON = lookIcon('<path d="M3.5 16.5 12 8l6 6-5.5 5.5H7z"/><path d="M9 10.5l6 6M5 20.5h14"/>');
const TYPE_PATH_ICON = lookIcon('<path d="M3 16C7 6 17 6 21 16"/><path d="M9.5 13.2 12 8.5l2.5 4.7M10.4 11.6h3.2"/>');

// The toolbox's buttons, each once, so the drawer and the groups share them. The flyout tools are
// their own buttons too, listed in the drawer in the same order as the table.
const SELECTION = btn("Selection Tool", tool("select", "rect"), "V");
const DIRECT = btn("Direct Selection Tool", tool("reshape", "vertices"), "A");
const LASSO = btn("Lasso Tool", tool("select", "lasso"), "Q", undefined, LASSO_ICON);
const WAND = btn("Magic Wand Tool", tool("selectsimilar"), "Y", [LASSO], WAND_ICON);

const ADD_ANCHOR = btn("Add Anchor Point Tool", tool("reshape", "add"), "+", undefined, ADD_ICON);
const DELETE_ANCHOR = btn("Delete Anchor Point Tool", tool("reshape", "delete"), "-", undefined, DELETE_ICON);
const ANCHOR = btn("Anchor Point Tool", tool("reshape", "change"), "Shift+C", undefined, ANCHOR_ICON);
const PEN = btn("Pen Tool", tool("polyline", "bezier"), "P", [ADD_ANCHOR, DELETE_ANCHOR, ANCHOR], PEN_ICON);
const CURVATURE = btn("Curvature Tool", tool("polyline", "cubic"), "Shift+~", undefined, CURVE_ICON);
const ARC = btn("Arc Tool", tool("arc"));
const SPIRAL = btn("Spiral Tool", tool("spiral"));
const LINE = btn("Line Segment Tool", tool("line"), "\\", [ARC, SPIRAL]);
const ROUND_RECT = btn("Rounded Rectangle Tool", tool("roundrect"));
const ELLIPSE = btn("Ellipse Tool", tool("oval"), "L");
const POLYGON = btn("Polygon Tool", tool("regpoly"));
const RECT = btn("Rectangle Tool", tool("rect"), "M", [ROUND_RECT, ELLIPSE, POLYGON]);
const PENCIL = btn("Pencil Tool", tool("freehand", "medium"), "N", undefined, PENCIL_ICON);
const PAINTBRUSH = btn("Paintbrush Tool", tool("freehand", "high"), "B", [PENCIL], BRUSH_ICON);

const TYPE_PATH = btn("Type on a Path Tool", m("Text › Text Along Path…"), undefined, undefined, TYPE_PATH_ICON);
const TYPE = btn("Type Tool", tool("text"), "T", [TYPE_PATH]);

const GRADIENT = btn("Gradient Tool", tool("attrmap"), "G");
const MEASURE = btn("Measure Tool", tool("measure", "single"));
const EYEDROPPER = btn("Eyedropper Tool", tool("eyedropper", "pick"), "I", [MEASURE]);

const REFLECT = btn("Reflect Tool", tool("mirror", "move"), "O");
const ROTATE = btn("Rotate Tool", tool("rotate", "turn"), "R", [REFLECT]);
const SHEAR = btn("Shear Tool", tool("shear"));
const SCALE = btn("Scale Tool", m("Modify › Scale Objects…"), "S", [SHEAR]);
const SCISSORS = btn("Scissors Tool", tool("split", "point"), "C", undefined, SCISSORS_ICON);
const KNIFE = btn("Knife Tool", tool("split", "line"), undefined, undefined, KNIFE_ICON);
const ERASER = btn("Eraser Tool", tool("clip"), "Shift+E", [SCISSORS, KNIFE], ERASER_ICON);

const ROTATE_VIEW = btn("Rotate View Tool", tool("rotateplan"), "Shift+H");
const HAND = btn("Hand Tool", tool("pan"), "H", [ROTATE_VIEW]);
const ZOOM = btn("Zoom Tool", tool("zoom", "in"), "Z");

/** Every tool, flyout tools included, in the order of the table. */
const ALL_TOOLS: readonly LookButton[] = [
  SELECTION, DIRECT, WAND, LASSO,
  PEN, ADD_ANCHOR, DELETE_ANCHOR, ANCHOR, CURVATURE, LINE, ARC, SPIRAL, RECT, ROUND_RECT, ELLIPSE, POLYGON, PAINTBRUSH, PENCIL,
  TYPE, TYPE_PATH, GRADIENT, EYEDROPPER, MEASURE, ROTATE, REFLECT, SCALE, SHEAR, ERASER, SCISSORS, KNIFE,
  HAND, ROTATE_VIEW, ZOOM,
];

export const look: LookSpec = {
  id: "illustrator",
  name: "Illustrator",
  theme: "dark",
  // the menus Illustrator's menu bar has: each Rodeo menu is named by exactly one id, so its
  // leftover commands land in a look menu
  menus: [
    {
      id: "File",
      title: "File",
      rows: [
        "File › New",
        "File › New from Template…",
        "File › Open…",
        "File › Open Recent",
        "-",
        "File › Close",
        "File › Save",
        "File › Save As…",
        "File › Save a Copy As…",
        "File › Save as Template…",
        "File › Revert",
        "-",
        "File › Import",
        "File › Export",
        "-",
        "Tools › Plug-ins › Run Script…",
        "-",
        "File › Page Setup…",
        "File › Document Settings",
        "File › File Info…",
        "-",
        "File › Print…",
      ],
    },
    {
      id: "Edit|Tools",
      title: "Edit",
      rows: [
        "Edit › Undo",
        "Edit › Redo",
        "-",
        "Edit › Cut",
        "Edit › Copy",
        "Edit › Paste",
        "Edit › Paste in Place",
        "Edit › Delete",
        "-",
        "Text › Find-Replace Text…",
        "Text › Check Spelling…",
        "-",
        "Help › Keyboard Shortcuts…",
        "Edit › Preferences…",
        "View › Appearance",
      ],
    },
    {
      id: "Modify|AEC|Stage",
      title: "Object",
      rows: [
        "Modify › Move…",
        "Modify › Rotate…",
        "Modify › Flip Horizontal",
        "Modify › Flip Vertical",
        "Modify › Scale Objects…",
        "-",
        "Modify › Send to Front",
        "Modify › Send Forward",
        "Modify › Send Backward",
        "Modify › Send to Back",
        "-",
        "Modify › Align",
        "Modify › Distribute",
        "-",
        "Modify › Group",
        "Modify › Ungroup",
        "Modify › Edit Group",
        "Modify › Exit Group",
        "-",
        "Modify › Lock",
        "Modify › Unlock",
        "View › Hide Selected Objects",
        "View › Unhide Objects",
        "-",
        "Modify › Compose",
        "Modify › Surfaces",
        "Modify › Drafting Aids",
        "Modify › Convert",
        "-",
        "Modify › Trace Bitmap…",
        "Modify › Edit Crop…",
        "-",
        "Modify › Create Symbol…",
      ],
    },
    {
      id: "Text",
      title: "Type",
      rows: [
        "Text › Font",
        "Text › Size",
        "Text › Style",
        "-",
        "Text › Format Text…",
        "Text › Justification",
        "Text › Text Along Path…",
        "-",
        "Tools › Utilities › Replace Font…",
        "Text › Capitalization",
        "-",
        "Text › Convert Text to Polylines",
      ],
    },
    {
      id: "Select",
      title: "Select",
      rows: [
        "Edit › Select All",
        "Edit › Select None",
        "Edit › Previous Selection",
        "Edit › Invert Selection",
        "-",
        "Edit › Select Similar",
        "Edit › Select Connected Objects",
        "-",
        "Edit › Select by Query…",
        "Tools › Custom Selection…",
      ],
    },
    {
      id: "Model",
      title: "Effect",
      rows: [
        "Model › Extrude…",
        "Model › Tapered Extrude…",
        "Model › Sweep…",
        "Model › Extrude Along Path…",
        "-",
        "Model › Add Solids",
        "Model › Subtract Solids",
        "Model › Intersect Solids",
      ],
    },
    {
      id: "View",
      title: "View",
      rows: [
        "View › Zoom In",
        "View › Zoom Out",
        "View › Fit to Page Area",
        "View › Fit to Window",
        "View › Normal Scale",
        "-",
        "View › Rulers",
        "View › Snap to Objects",
        "Modify › Guides",
        "-",
        "View › Show Grid",
        "View › Snap to Grid",
        "-",
        "View › Save View…",
        "View › Previous View",
        "View › Next View",
        "-",
        "View › Rotate Plan",
      ],
    },
    {
      id: "Window|Plug-ins",
      title: "Window",
      rows: [
        "View › Work Like",
        "Window › Workspaces",
        "-",
        "Window › Palettes › Attributes",
        "Window › Palettes › Sheet Layers",
        "Window › Palettes › Navigation",
        "Window › Palettes › Resource Manager",
        "Window › Palettes › Object Info",
      ],
    },
    {
      id: "Help",
      title: "Help",
      rows: ["Help › User Guide", "Help › What's New…", "-", "Help › About Rodeo…"],
    },
  ],
  // the application's words for Rodeo's, as Illustrator writes them
  terms: {
    "Object Info": "Properties",
    Attributes: "Appearance",
    Navigation: "Layers",
    Resources: "Libraries",
    "Resource Manager": "Libraries",
    "Sheet Layer": "Artboard",
    "Sheet Layers": "Artboards",
    "Preferences…": "Settings…",
    Appearance: "User Interface",
    "Send to Front": "Bring to Front",
    "Send Forward": "Bring Forward",
    "Hide Selected Objects": "Hide Selection",
    "Unhide Objects": "Show All",
    "Select None": "Deselect",
    "Previous Selection": "Reselect",
    "Invert Selection": "Inverse",
    "Create Symbol…": "New Symbol…",
    "Edit Group": "Enter Isolation Mode",
    "Exit Group": "Exit Isolation Mode",
    "Convert Text to Polylines": "Create Outlines",
    "Text Along Path…": "Type on a Path…",
    Capitalization: "Change Case",
    "UPPER CASE": "UPPERCASE",
    "lower case": "lowercase",
    "Title Caps": "Title Case",
    "Find-Replace Text…": "Find and Replace…",
    "Replace Font…": "Find Font…",
    "Fit to Window": "Fit All in Window",
    "Fit to Page Area": "Fit Artboard in Window",
    "Normal Scale": "Actual Size",
    "Snap to Objects": "Smart Guides",
    "Save View…": "New View…",
    "Rotate Plan": "Rotate View",
    Surfaces: "Pathfinder",
    "Add Surface": "Unite",
    "Clip Surface": "Minus Front",
    "Intersect Surface": "Intersect",
    "Trace Bitmap…": "Image Trace…",
    "Edit Crop…": "Crop Image…",
    "Page Setup…": "Document Setup…",
    "Save a Copy As…": "Save a Copy…",
    "Extrude…": "Extrude & Bevel…",
    "Sweep…": "Revolve…",
    "Scale Objects…": "Scale…",
    Workspaces: "Workspace",
  },
  // Properties (Object Info) holds Layers and Libraries as its tabs; Appearance (Attributes) sits under it
  palettes: {
    objectInfo: { where: "right", order: 0, weight: 520 },
    navigation: { where: "right", tabOf: "objectInfo" },
    resources: { where: "right", tabOf: "objectInfo" },
    attributes: { where: "right", order: 1, weight: 300 },
    basic: { where: "hidden" },
    toolsets: { where: "hidden" },
    snapping: { where: "hidden" },
    visualization: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { right: 300 },
  topBar: false,
  menuBar: true,
  // the Essentials workspace's rows: the toolbox's buttons, then the Mode bar's fields under the menus
  toolbox: {
    side: "left",
    columns: 1,
    labels: false,
    fillStroke: true,
    drawer: { title: "All Tools", buttons: ALL_TOOLS },
    groups: [
      { buttons: [SELECTION, DIRECT, WAND] },
      { buttons: [PEN, CURVATURE, LINE, RECT, PAINTBRUSH] },
      { buttons: [TYPE] },
      { buttons: [GRADIENT, EYEDROPPER] },
      { buttons: [ROTATE, SCALE, ERASER] },
      { buttons: [HAND, ZOOM] },
    ],
  },
  modeBar: "options",
  modeFields: "menus",
  viewBar: "hidden",
  snapPill: false,
  rails: false,
  icons: "rodeo",
  grid: false,
  gridColors: { minor: "rgba(0, 0, 0, 0.07)", major: "rgba(0, 0, 0, 0.18)" },
  viewCube: false,
  paper: "#ffffff",
  background3d: "#2b2b2b",
  artboard: "#1e1e1e",
  // the Layers palette as Illustrator's: visible, locked, name and colour, with its own footer
  panels: {
    navigation: { kind: "layerTable", style: "illustrator", columns: ["visible", "lock", "name", "color"], none: "Layer 1" },
  },
  statusBar: {
    rows: [[{ kind: "zoom" }, { kind: "rotation" }, { kind: "artboards" }, { kind: "tool" }, { kind: "hint", style: "sentences" }]],
  },
  keys: {
    // tools, as their toolbox buttons pick them
    v: SELECTION.do,
    a: DIRECT.do,
    y: WAND.do,
    q: LASSO.do,
    p: PEN.do,
    "+": ADD_ANCHOR.do,
    "-": DELETE_ANCHOR.do,
    "⇧c": ANCHOR.do,
    "~": CURVATURE.do,
    "\\": LINE.do,
    m: RECT.do,
    l: ELLIPSE.do,
    b: PAINTBRUSH.do,
    n: PENCIL.do,
    t: TYPE.do,
    g: GRADIENT.do,
    i: EYEDROPPER.do,
    r: ROTATE.do,
    o: REFLECT.do,
    s: SCALE.do,
    "⇧e": ERASER.do,
    c: SCISSORS.do,
    h: HAND.do,
    "⇧h": ROTATE_VIEW.do,
    z: ZOOM.do,
    // fill and stroke, at the toolbox's foot (fillStroke.ts)
    x: { run: toggleFillStroke },
    "⇧x": { run: swapFillStroke },
    d: { run: defaultFillStroke },
    ",": { run: colorFillStroke },
    "/": { run: noneFillStroke },
    ".": { run: gradientFillStroke },
    Delete: m("Edit › Delete"),
    Backspace: m("Edit › Delete"),
    // Ctrl (⌘ on a Mac) with the keys Illustrator uses
    "Ctrl+O": m("File › Open…"),
    "Ctrl+S": m("File › Save"),
    "Ctrl+Shift+S": m("File › Save As…"),
    "Ctrl+Alt+S": m("File › Save a Copy As…"),
    "Ctrl+P": m("File › Print…"),
    "Ctrl+Alt+P": m("File › Page Setup…"),
    "Ctrl+Z": m("Edit › Undo"),
    "Ctrl+Shift+Z": m("Edit › Redo"),
    "Ctrl+X": m("Edit › Cut"),
    "Ctrl+C": m("Edit › Copy"),
    "Ctrl+V": m("Edit › Paste"),
    "Ctrl+Shift+V": m("Edit › Paste in Place"),
    "Ctrl+A": m("Edit › Select All"),
    "Ctrl+Shift+A": m("Edit › Select None"),
    "Ctrl+6": m("Edit › Previous Selection"),
    "Ctrl+G": m("Modify › Group"),
    "Ctrl+Shift+G": m("Modify › Ungroup"),
    "Ctrl+2": m("Modify › Lock"),
    "Ctrl+Alt+2": m("Modify › Unlock"),
    "Ctrl+3": m("View › Hide Selected Objects"),
    "Ctrl+Alt+3": m("View › Unhide Objects"),
    "Ctrl+]": m("Modify › Send Forward"),
    "Ctrl+Shift+]": m("Modify › Send to Front"),
    "Ctrl+Shift+}": m("Modify › Send to Front"),
    "Ctrl+[": m("Modify › Send Backward"),
    "Ctrl+Shift+[": m("Modify › Send to Back"),
    "Ctrl+Shift+{": m("Modify › Send to Back"),
    "Ctrl+J": m("Modify › Compose"),
    "Ctrl+D": m("Edit › Repeat Last Command"),
    "Ctrl+=": m("View › Zoom In"),
    "Ctrl++": m("View › Zoom In"),
    "Ctrl+Shift++": m("View › Zoom In"),
    "Ctrl+-": m("View › Zoom Out"),
    "Ctrl+0": m("View › Fit to Page Area"),
    "Ctrl+Alt+0": m("View › Fit to Window"),
    "Ctrl+1": m("View › Normal Scale"),
    "Ctrl+R": m("View › Rulers"),
    "Ctrl+U": m("View › Snap to Objects"),
    "Ctrl+'": m("View › Show Grid"),
    "Ctrl+Shift+'": m("View › Snap to Grid"),
    'Ctrl+Shift+"': m("View › Snap to Grid"),
    "Ctrl+K": m("Edit › Preferences…"),
    "Ctrl+Shift+O": m("Text › Convert Text to Polylines"),
    "Ctrl+Shift+M": m("Modify › Move…"),
    "Ctrl+Alt+Shift+K": m("Help › Keyboard Shortcuts…"),
  },
  mouse: { middle: "pan", right: "menu" },
};
