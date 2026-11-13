// View › Work Like › Revit: Rodeo laid out the way Revit 2025 is, with the ribbon across the top, the
// Properties and Project Browser palettes down the left, the Options Bar under the ribbon and the
// View Control Bar along the foot of the drawing. Every button runs one of Rodeo's own tools or menu
// commands; the words are Revit's, and where Rodeo has no such tool the nearest one stands in (the
// report lists those). Rodeo's icons are used throughout.
import "./revit.css";
import { lookIcon } from "./commands.ts";
import { WORK_LIKE } from "./looks.ts";
import type { Command, LookButton, LookSpec, RibbonPanel } from "./types.ts";

/** A large ribbon button: the icon over its label. */
function large(label: string, c: Command, keys?: string): LookButton {
  return keys ? { label, do: c, size: "large", keys } : { label, do: c, size: "large" };
}

/** A small ribbon button: the icon beside its label, in a stack of up to three. */
function small(label: string, c: Command, keys?: string): LookButton {
  return keys ? { label, do: c, size: "small", keys } : { label, do: c, size: "small" };
}

/** The Modify tab's panels, shared by the Modify tab and its contextual tab. */
const MODIFY_PANELS: readonly RibbonPanel[] = [
  { title: "Properties", items: [large("Properties", { palette: "objectInfo" }, "PP")] },
  {
    title: "Clipboard",
    items: [large("Paste", { menu: "Edit › Paste" }), [small("Cut", { menu: "Edit › Cut" }), small("Copy", { menu: "Edit › Copy" })]],
  },
  {
    title: "Geometry",
    items: [large("Join", { menu: "Modify › Join › Join" }), [small("Cut", { menu: "Modify › Surfaces › Clip Surface" })]],
  },
  {
    title: "Modify",
    items: [
      large("Align", { menu: "Modify › Align › Align/Distribute…" }, "AL"),
      large("Offset", { tool: "offset" }, "OF"),
      large("Mirror - Pick Axis", { tool: "mirror" }, "MM"),
      large("Move", { tool: "moveby", mode: "move" }, "MV"),
      large("Copy", { tool: "moveby", mode: "copy" }, "CO"),
      large("Rotate", { tool: "rotate" }, "RO"),
      [small("Trim/Extend", { tool: "trim" }, "TR"), small("Split", { tool: "split" }, "SL"), small("Array", { menu: "Edit › Duplicate Array…" }, "AR")],
      [small("Scale", { menu: "Modify › Scale Objects…" }, "RE"), small("Delete", { menu: "Edit › Delete" }, "DE")],
    ],
  },
  {
    title: "View",
    // Override Graphics in View › By Element: the lines and fills of what is selected, Rodeo's Attributes palette
    items: [[small("Override Graphics in View", { palette: "attributes" }), small("Hide in View", { menu: "View › Hide Selected Objects" }, "EH")]],
  },
  { title: "Measure", items: [large("Measure", { tool: "measure" }), large("Dimension", { tool: "dimension" })] },
  { title: "Create", items: [large("Create Group", { menu: "Modify › Group" }, "GP")] },
];

const ARCHITECTURE: readonly RibbonPanel[] = [
  { title: "Select", items: [large("Modify", { tool: "select" }, "MD")] },
  {
    title: "Build",
    items: [
      large("Wall", { tool: "wall" }, "WA"),
      large("Door", { tool: "door" }, "DR"),
      large("Window", { tool: "window" }, "WN"),
      large("Component", { tool: "symbol" }, "CM"),
      large("Floor", { tool: "slab" }),
      [small("Column", { tool: "column" }), small("Roof", { menu: "AEC › Create Roof…" })],
    ],
  },
  {
    title: "Circulation",
    items: [large("Railing", { tool: "railing" }), large("Ramp", { tool: "ramp" }), large("Stair", { tool: "stair" })],
  },
  {
    title: "Model",
    items: [large("Model Line", { tool: "line" }, "LI"), large("Model Group", { menu: "Modify › Group" }, "GP")],
  },
  {
    title: "Room & Area",
    items: [large("Room", { tool: "space" }, "RM"), [small("Room Separator", { tool: "spacelink" }), small("Tag Room", { tool: "datatag" })]],
  },
  { title: "Datum", items: [large("Grid", { tool: "gridline" }, "GR")] },
  {
    title: "Work Plane",
    items: [
      [
        small("Set", { menu: "Modify › Working Plane › Set Working Plane" }),
        small("Show", { menu: "Modify › Working Plane › Look at Working Plane" }),
        small("Ref Plane", { tool: "refmarker" }, "RP"),
      ],
    ],
  },
];

const STRUCTURE: readonly RibbonPanel[] = [
  {
    title: "Structure",
    items: [
      large("Beam", { tool: "structmember" }),
      large("Wall", { tool: "wall" }),
      large("Column", { tool: "column" }),
      large("Floor", { tool: "slab" }),
      [small("Truss", { tool: "trussstraight" })],
    ],
  },
  { title: "Datum", items: [large("Grid", { tool: "gridline" }, "GR")] },
];

const SYSTEMS: readonly RibbonPanel[] = [
  { title: "HVAC", items: [large("Duct", { tool: "hvacduct" }), [small("Transition", { tool: "hvactransition" }), small("Damper", { tool: "hvacdamper" }), small("Diffuser", { tool: "hvacdiffuser" })]] },
  { title: "Plumbing & Piping", items: [large("Pipe", { tool: "irrpipe" }), [small("Piping Run", { tool: "pipingrun" }), small("Valve", { tool: "valve" })]] },
  {
    title: "Electrical",
    items: [
      large("Wire", { tool: "cable" }),
      large("Lighting Fixture", { tool: "incandescent" }),
      [small("Cable Tray", { tool: "cablepath" }), small("Receptacle", { tool: "receptacle" }), small("Switch", { tool: "switch" })],
    ],
  },
];

const INSERT: readonly RibbonPanel[] = [
  {
    title: "Import",
    items: [large("Import CAD", { menu: "File › Import › Import DWG…" }), [small("PDF", { menu: "File › Import › Import PDF…" }), small("Image", { menu: "File › Import › Import Image File(s)…" })]],
  },
  { title: "Load from Library", items: [large("Load Family", { palette: "resources" })] },
];

const ANNOTATE: readonly RibbonPanel[] = [
  {
    title: "Dimension",
    items: [large("Aligned", { tool: "dimension" }, "DI"), [small("Linear", { tool: "dimtape" }), small("Arc Length", { tool: "arclength" }), small("Slope", { tool: "slopedim" })]],
  },
  {
    title: "Detail",
    items: [
      large("Detail Line", { tool: "line" }, "DL"),
      large("Region", { tool: "polygon" }),
      large("Component", { tool: "symbol" }, "CM"),
      [small("Revision Cloud", { tool: "cloud" }), small("Insulation", { tool: "insulation" })],
    ],
  },
  { title: "Text", items: [large("Text", { tool: "text" }, "TX"), [small("Check Spelling", { menu: "Text › Check Spelling…" })]] },
  { title: "Tag", items: [large("Tag by Category", { tool: "datatag" })] },
];

const ANALYZE: readonly RibbonPanel[] = [
  {
    title: "Analysis",
    items: [large("Volume", { menu: "Model › Volumetric Properties…" }), large("Engineering", { menu: "Model › Engineering Properties…" })],
  },
];

const MASSING_SITE: readonly RibbonPanel[] = [
  { title: "Conceptual Mass", items: [large("Mass", { tool: "massingmodel" })] },
  {
    title: "Model Site",
    items: [large("Toposurface", { menu: "AEC › Terrain › Site Model from Boundary…" }), [small("Building Pad", { menu: "AEC › Terrain › Create Planar Pad from Grade Limits…" }), small("Property Line", { tool: "propline" })]],
  },
];

const VIEW: readonly RibbonPanel[] = [
  {
    title: "Graphics",
    items: [large("Visibility/Graphics", { menu: "View › Object Visibility…" }, "VV"), large("Render", { menu: "View › Render Studio" }), [small("Thin Lines", { menu: "View › Zoom Line Thickness" }, "TL")]],
  },
  {
    title: "Create",
    items: [
      large("3D View", { menu: "View › 3D View" }),
      large("Section", { tool: "secline" }),
      large("Callout", { tool: "callout" }),
      [small("Plan Views", { menu: "View › Standard Views › Top/Plan" }), small("Elevation", { menu: "View › Standard Views › Front" }), small("Schedules", { menu: "Tools › Reports › Create Report…" })],
    ],
  },
  {
    title: "Sheet Composition",
    items: [large("Sheet", { menu: "Window › Palettes › Sheet Layers" }), large("Place View", { menu: "View › Create Viewport…" }), [small("Title Block", { menu: "File › Title Block Manager…" })]],
  },
  {
    title: "Windows",
    items: [
      large("Tile Views", { menu: "View › Multiple View Panes › Two Panes Side by Side" }),
      // Revit's User Interface drop-down: here it switches to another look, or back to Rodeo's own
      { label: "User Interface", do: WORK_LIKE, size: "large", icon: lookIcon('<rect x="3.5" y="4.5" width="17" height="15" rx="1"/><path d="M3.5 8.5h17M8 8.5v11"/>') },
    ],
  },
];

const MANAGE: readonly RibbonPanel[] = [
  {
    title: "Settings",
    items: [
      large("Object Styles", { menu: "Window › Palettes › Classes" }),
      large("Snaps", { palette: "snapping" }),
      [small("Project Information", { menu: "File › File Info…" }), small("Project Units", { menu: "File › Document Settings › Units…" }), small("Purge Unused", { menu: "Tools › Utilities › Purge…" })],
    ],
  },
  { title: "Macros", items: [large("Run Script", { menu: "Tools › Plug-ins › Run Script…" })] },
];

const ADD_INS: readonly RibbonPanel[] = [
  {
    title: "External Tools",
    items: [large("Plug-in Manager", { menu: "Tools › Plug-ins › Plug-in Manager…" }), large("Script Console", { menu: "Tools › Plug-ins › Script Console…" })],
  },
];

/** Each Rodeo menu's rows as its look menu lists them: top-level paths only, a submenu's rows follow it. */
const FILE_ROWS = [
  "File › New",
  "File › New from Template…",
  "File › Open…",
  "File › Open Recent",
  "File › Close",
  "File › Close All",
  "-",
  "File › Save",
  "File › Save As…",
  "File › Save a Copy As…",
  "File › Save as Template…",
  "File › Save All",
  "File › Revert",
  "-",
  "File › File Info…",
  "File › Import",
  "File › Export",
  "-",
  "File › Convert Files…",
  "File › Publish…",
  "File › Page Setup…",
  "File › Title Block Manager…",
  "File › Document Settings",
  "-",
  "File › Print…",
];

const EDIT_ROWS = [
  "Edit › Undo",
  "Edit › Redo",
  "Edit › Repeat Last Command",
  "Edit › Recent Commands",
  "-",
  "Edit › Cut",
  "Edit › Copy",
  "Edit › Paste",
  "Edit › Paste in Place",
  "Edit › Paste as Bitmap",
  "Edit › Duplicate",
  "Edit › Duplicate Array…",
  "Edit › Duplicate Along Path…",
  "Edit › Delete",
  "-",
  "Edit › Select All",
  "Edit › Select Similar",
  "Edit › Select Connected Objects",
  "Edit › Select None",
  "Edit › Invert Selection",
  "Edit › Previous Selection",
  "-",
  "Edit › Create Similar Object",
  "-",
  "Edit › Preferences…",
  "Edit › Search Everything…",
  "Edit › Select by Query…",
  "Edit › Find Usages…",
];

const VIEW_ROWS = [
  "View › Zoom In",
  "View › Zoom Out",
  "View › Fit to Window",
  "View › Fit to Objects",
  "View › Fit to Page Area",
  "View › Normal Scale",
  "View › Zoom to Selection",
  "View › Previous View",
  "View › Next View",
  "View › Save View…",
  "View › Zoom Line Thickness",
  "-",
  "View › 3D View",
  "View › Standard Views",
  "View › Rotate Plan",
  "View › Rotated Top/Plan",
  "View › Set 3D View…",
  "View › Rotate 3D View…",
  "View › Onscreen View Control",
  "View › Multiple View Panes",
  "View › Rendering",
  "View › Renderworks Style",
  "View › Render Studio",
  "View › Render Settings",
  "View › Projection",
  "View › Clip Cube",
  "-",
  "View › Create Viewport…",
  "View › Create Detail Viewport…",
  "View › Create Section Viewport…",
  "View › Create Interior Elevation Viewport…",
  "View › Create Horizontal Section Viewport…",
  "View › Create Multiple Viewports…",
  "View › Update Selected Viewports",
  "View › Update All Viewports",
  "-",
  "View › Set Sun Position…",
  "View › Sun Study",
  "View › Set Lighting Options…",
  "View › Class Options",
  "View › Layer Options",
  "-",
  "View › Unhide Objects",
  "View › Show Selected Objects Only",
  "View › Hide Selected Objects",
  "View › Object Visibility…",
  "View › Show or Hide Site Modifiers",
  "-",
  "View › Show Grid",
  "View › Snap to Grid",
  "View › Snap to Objects",
  "View › Rulers",
  "View › Appearance",
  "View › Crit Mode",
  "View › Pencil Draws Only",
];

const MODIFY_ROWS = [
  "Modify › Group",
  "Modify › Ungroup",
  "Modify › Edit Group",
  "Modify › Exit Group",
  "Modify › Top Level",
  "Modify › Edit Symbol",
  "Modify › Edit Auto Hybrid",
  "Modify › Exit Symbol",
  "-",
  "Modify › Surfaces",
  "Modify › Compose",
  "Modify › Decompose",
  "Modify › Join",
  "Modify › Hatch…",
  "Modify › Convert",
  "Modify › Simplify Mesh…",
  "Modify › Attributes",
  "Modify › Guides",
  "Modify › Working Plane",
  "Modify › Edit Crop…",
  "Modify › Trace Bitmap…",
  "Modify › Poly Smoothing",
  "Modify › Drafting Aids",
  "Modify › Create Symbol…",
  "-",
  "Modify › Send to Front",
  "Modify › Send Forward",
  "Modify › Send Backward",
  "Modify › Send to Back",
  "-",
  "Modify › Rotate Left 90°",
  "Modify › Rotate Right 90°",
  "Modify › Rotate Each Left 90°",
  "Modify › Rotate Each Right 90°",
  "Modify › Rotate…",
  "Modify › Rotate 3D…",
  "Modify › Flip Horizontal",
  "Modify › Flip Vertical",
  "Modify › Unrotate 3D Objects",
  "-",
  "Modify › Align",
  "Modify › Distribute",
  "Modify › Scale Objects…",
  "-",
  "Modify › Move…",
  "Modify › Move 3D…",
  "Modify › Move Geographic…",
];

const TOOLS_ROWS = [
  "Tools › Organization…",
  "Tools › Custom Selection…",
  "Tools › Find and Modify…",
  "Tools › Quick Search…",
  "Tools › Custom Modification…",
  "Tools › Custom Tool/Attribute…",
  "Tools › Class and Layer Mapping…",
  "Tools › Records",
  "Tools › Reports",
  "Tools › Utilities",
  "Tools › Machine Design",
  "Tools › Origin",
  "Tools › Check File Health…",
  "Tools › Compress Images…",
  "Tools › Options",
  "Tools › Snap Settings…",
  "Tools › Smart Point Settings…",
  "Tools › Plug-ins",
  "Tools › Voice Commands…",
];

/** Revit's status bar words for the steps of the tools it shares with Rodeo, by Rodeo's hint's first part. */
const REVIT_PROMPTS: Readonly<Record<string, string>> = {
  "Click the wall's start, or a wall's end or side to join it": "Click to enter wall start point.",
  "Click the next corner, or a wall to join": "Click to enter wall end point.",
  "Click or drag to draw a line": "Click to enter line start point.",
  "Click or drag a box to select": "Click to select, TAB for alternates, CTRL adds, SHIFT unselects.",
  "Click a * wall where the door's middle goes": "Click on Wall to place Door (Space bar to flip the instance left/right)",
  "Click the point to move from": "Click to enter move start point.",
  "Click the point to move to": "Click to enter move end point.",
};

export const look: LookSpec = {
  id: "revit",
  name: "Revit",
  theme: "light",
  // the look's menus: the File menu is the one the application tab opens; the others keep Rodeo's
  // leftover commands (a look menu's id names the Rodeo menus it takes the leftovers of)
  menus: [
    { id: "File", title: "File", rows: FILE_ROWS },
    { id: "Edit", title: "Edit", rows: EDIT_ROWS },
    { id: "View", title: "View", rows: VIEW_ROWS },
    { id: "Modify|Model|AEC", title: "Modify", rows: MODIFY_ROWS },
    { id: "Tools|Text|Plug-ins|Stage|Window", title: "Tools", rows: TOOLS_ROWS },
  ],
  // Revit's words for Rodeo's: whole texts only, as menus.txt and the palettes write them
  terms: {
    "Object Info": "Properties",
    Navigation: "Project Browser",
    Resources: "Families",
    "Resource Manager": "Families",
    Symbol: "Family",
    Symbols: "Families",
    Class: "Subcategory",
    Classes: "Subcategories",
    "Class Options": "Subcategory Options",
    Story: "Level",
    Stories: "Levels",
    "Sheet Layer": "Sheet",
    "Sheet Layers": "Sheets",
    "Saved Views": "Views",
    "Fit to Window": "Zoom to Fit",
    Slab: "Floor",
    "Object Visibility…": "Visibility/Graphics…",
    "Preferences…": "Options…",
    "File Info…": "Project Information…",
    "Units…": "Project Units…",
    "Import DWG…": "Import CAD…",
    "Zoom Line Thickness": "Thin Lines",
    "Hide Selected Objects": "Hide Element",
    "Show Selected Objects Only": "Isolate Element",
    "Unhide Objects": "Reset Temporary Hide/Isolate",
    "Top/Plan": "Floor Plan",
    "Create Viewport…": "Place View…",
    "Create Report…": "Create Schedule…",
    "Create Symbol…": "Create Family…",
    "Snap Settings…": "Snaps…",
    "Purge…": "Purge Unused…",
    "Align/Distribute…": "Align…",
    "Duplicate Array…": "Array…",
    "Clip Surface": "Cut Geometry",
    "Tape Measure": "Measure",
    "Render Studio": "Render",
  },
  // Revit's palettes: Properties over Project Browser on the left, the rest closed
  palettes: {
    objectInfo: { where: "left", order: 0, weight: 420 },
    // Revit's Properties is one panel: the lines and fills for new objects open from Modify › Override Graphics in View
    attributes: { where: "hidden" },
    navigation: { where: "left", order: 1, weight: 360 },
    basic: { where: "hidden" },
    toolsets: { where: "hidden" },
    resources: { where: "hidden" },
    snapping: { where: "hidden" },
    visualization: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { left: 300 },
  topBar: false,
  menuBar: false,
  titleBar: true,
  ribbon: {
    start: "Architecture",
    quickAccess: [
      { label: "Open", do: { menu: "File › Open…" } },
      { label: "Save", do: { menu: "File › Save" } },
      { label: "Undo", do: { menu: "Edit › Undo" }, keys: "Ctrl+Z" },
      { label: "Redo", do: { menu: "Edit › Redo" }, keys: "Ctrl+Y" },
      { label: "Measure", do: { tool: "measure" } },
      { label: "Aligned Dimension", do: { tool: "dimension" }, keys: "DI" },
      { label: "Text", do: { tool: "text" }, keys: "TX" },
      { label: "Default 3D View", do: { menu: "View › 3D View" }, keys: "3" },
      { label: "Section", do: { tool: "secline" } },
      { label: "Thin Lines", do: { menu: "View › Zoom Line Thickness" }, keys: "TL" },
    ],
    tabs: [
      { title: "File", application: true, panels: [] },
      { title: "Architecture", panels: ARCHITECTURE },
      { title: "Structure", panels: STRUCTURE },
      { title: "Systems", panels: SYSTEMS },
      { title: "Insert", panels: INSERT },
      { title: "Annotate", panels: ANNOTATE },
      { title: "Analyze", panels: ANALYZE },
      { title: "Massing & Site", panels: MASSING_SITE },
      { title: "View", panels: VIEW },
      { title: "Manage", panels: MANAGE },
      { title: "Add-Ins", panels: ADD_INS },
      { title: "Modify", panels: MODIFY_PANELS },
      { title: "Modify | {0}", contextual: true, panels: MODIFY_PANELS },
    ],
  },
  modeBar: "options",
  modeFields: "menus",
  // the View Control Bar under the drawing in place of Rodeo's view bar
  viewBar: "hidden",
  viewControl: "revit",
  snapPill: false,
  rails: false,
  icons: "color",
  // the Project Browser in the Navigation palette's place; plans without a grid
  panels: { navigation: { kind: "browser", style: "revit" } },
  grid: false,
  // Revit's ViewCube is in its 3D views only; Rodeo's shows in the plan too
  viewCube: false,
  statusBar: {
    rows: [[{ kind: "hint", prompts: REVIT_PROMPTS }, { kind: "spacer" }, { kind: "text", text: "Main Model" }, { kind: "selection" }]],
  },
  // single keys are left to Rodeo; two-key shortcuts are Revit's
  sequences: {
    wa: { tool: "wall" },
    dr: { tool: "door" },
    wn: { tool: "window" },
    cm: { tool: "symbol" },
    li: { tool: "line" },
    dl: { tool: "line" },
    di: { tool: "dimension" },
    tx: { tool: "text" },
    rm: { tool: "space" },
    gr: { tool: "gridline" },
    rp: { tool: "refmarker" },
    // Move and Copy pick a start point and an end point, as Revit's do: Move by Points
    mv: { tool: "moveby", mode: "move" },
    co: { tool: "moveby", mode: "copy" },
    cc: { tool: "moveby", mode: "copy" },
    ro: { tool: "rotate" },
    mm: { tool: "mirror" },
    dm: { tool: "mirror" },
    al: { menu: "Modify › Align › Align/Distribute…" },
    tr: { tool: "trim" },
    of: { tool: "offset" },
    sl: { tool: "split" },
    ar: { menu: "Edit › Duplicate Array…" },
    re: { menu: "Modify › Scale Objects…" },
    de: { menu: "Edit › Delete" },
    vv: { menu: "View › Object Visibility…" },
    vg: { menu: "View › Object Visibility…" },
    tl: { menu: "View › Zoom Line Thickness" },
    hh: { menu: "View › Hide Selected Objects" },
    hi: { menu: "View › Show Selected Objects Only" },
    hr: { menu: "View › Unhide Objects" },
    zf: { menu: "View › Fit to Window" },
    za: { menu: "View › Fit to Window" },
    ze: { menu: "View › Fit to Window" },
    pp: { palette: "objectInfo" },
    md: { tool: "select" },
    gp: { menu: "Modify › Group" },
    sa: { menu: "Edit › Select Similar" },
    zx: { menu: "View › Fit to Window" },
    zo: { menu: "View › Zoom Out" },
    zr: { tool: "zoom" },
    zz: { tool: "zoom" },
    zp: { menu: "View › Previous View" },
    zc: { menu: "View › Previous View" },
    zs: { menu: "View › Fit to Page Area" },
    vp: { palette: "objectInfo" },
    eg: { menu: "Modify › Edit Group" },
    ug: { menu: "Modify › Ungroup" },
    fg: { menu: "Modify › Exit Group" },
    eh: { menu: "View › Hide Selected Objects" },
    eu: { menu: "View › Unhide Objects" },
    rc: { menu: "Edit › Repeat Last Command" },
    cs: { menu: "Edit › Create Similar Object" },
    pn: { menu: "Modify › Lock" },
    up: { menu: "Modify › Unlock" },
    cl: { tool: "column" },
    tg: { tool: "datatag" },
    wf: { menu: "View › Rendering › Wireframe" },
    hl: { menu: "View › Rendering › Hidden Line" },
    sd: { menu: "View › Rendering › Shaded" },
    rr: { menu: "View › Rendering › Realistic" },
    ks: { menu: "Help › Keyboard Shortcuts…" },
  },
  // Revit's Ctrl keys over the drawing
  keys: {
    "Ctrl+1": { palette: "objectInfo" },
    "Ctrl+Z": { menu: "Edit › Undo" },
    "Ctrl+Y": { menu: "Edit › Redo" },
  },
  // the wheel pressed pans and Shift with it orbits, as Revit does; the right button leaves its menu alone
  mouse: { middle: "pan", right: "menu" },
  paper: "#ffffff",
  background3d: "#f4f6f8",
};

