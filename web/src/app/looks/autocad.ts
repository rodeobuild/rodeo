// View › Work Like › AutoCAD: the Drafting & Annotation workspace of AutoCAD 2025 for Windows. A
// dark title bar with the application button and Quick Access Toolbar, a ribbon of tabs, a command
// line along the foot of the window that takes AutoCAD's command names and their short aliases, a
// status bar of toggles, the Properties palette docked left, and the drawing with Rodeo's
// function keys and mouse. Every button and command runs one of Rodeo's own tools or menu commands.

import type { ToolId } from "../state.ts";
import type { Command, CommandLineSpec, LookButton, LookSpec, RibbonTab, StatusBarSpec } from "./types.ts";
import { lookIcon } from "./commands.ts";
import { toggleCommandLine, WORK_LIKE } from "./looks.ts";
import { AREA, dim, LIST, MAKE2D, ORTHO, REGEN } from "./extra.ts";
import { orthoOn, setOrtho } from "../ortho.ts";
import "./autocad.css";

/** A tool as a command. */
const t = (id: ToolId): Command => ({ tool: id });
/** A menu command by its path as Rodeo builds its menus. */
const m = (path: string): Command => ({ menu: path });
/** A palette shown or hidden. */
const p = (id: string): Command => ({ palette: id });

/** A button, with the key its tooltip shows and any drop-down of more. */
const b = (label: string, use: Command, keys?: string, more?: readonly LookButton[]): LookButton => ({
  label,
  do: use,
  ...(keys ? { keys } : {}),
  ...(more ? { more } : {}),
});

/** A large ribbon button: its icon over its label. */
const big = (label: string, use: Command, keys?: string, more?: readonly LookButton[]): LookButton => ({ ...b(label, use, keys, more), size: "large" });

// the status bar's toggles: original line icons, a dot grid, corner brackets, a target and a thick line
const GRID_ICON = lookIcon('<path d="M5 5h0M12 5h0M19 5h0M5 12h0M12 12h0M19 12h0M5 19h0M12 19h0M19 19h0" stroke-width="2.8"/>');
const SNAP_ICON = lookIcon('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/><path d="M9 9h6v6H9z"/>');
const OSNAP_ICON = lookIcon('<circle cx="12" cy="12" r="5.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>');
// Ortho: a right angle with its corner square; the drafting aids Rodeo lacks, drawn greyed: a dashed circle with a radius (polar), an isometric cube, dashed tracking lines from a point
const ORTHO_ICON = lookIcon('<path d="M6 4v14h14"/><path d="M6 12h3.5v3.5"/>');
const POLAR_ICON = lookIcon('<circle cx="12" cy="12" r="8.5" stroke-dasharray="2 2"/><path d="M12 12l5.5-5.5"/>');
const ISO_ICON = lookIcon('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>');
const OTRACK_ICON = lookIcon('<circle cx="8" cy="8" r="2.4"/><path d="M8 12.5v8M3 16h14" stroke-dasharray="2 1.6"/>');
// Customization: three lines
const MENU_ICON = lookIcon('<path d="M4 7h16M4 12h16M4 17h16"/>');

const GEAR_ICON = lookIcon('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>');

const statusBar: StatusBarSpec = {
  rows: [
    [
      // the group sits at the row's right end, as AutoCAD's does: MODEL, then the drafting aids, 1:1, the gear and the menu
      { kind: "spacer" },
      { kind: "text", text: "MODEL" },
      { kind: "toggle", label: "Grid", do: m("View › Show Grid"), style: "icon", icon: GRID_ICON },
      { kind: "toggle", label: "Snap Mode", do: m("View › Snap to Grid"), style: "icon", icon: SNAP_ICON },
      { kind: "toggle", label: "Ortho Mode", do: ORTHO, style: "icon", icon: ORTHO_ICON },
      { kind: "inert", label: "Polar Tracking", why: "Rodeo has no polar tracking", icon: POLAR_ICON },
      { kind: "inert", label: "Isometric Drafting", why: "Rodeo has no isometric drafting", icon: ISO_ICON },
      { kind: "inert", label: "Object Snap Tracking", why: "Rodeo has no object snap tracking", icon: OTRACK_ICON },
      { kind: "toggle", label: "Object Snap", do: m("View › Snap to Objects"), style: "icon", icon: OSNAP_ICON },
      { kind: "text", text: "1:1" },
      // the workspace gear: switches to another look, or back to Rodeo's own
      { kind: "toggle", label: "Workspace Switching", do: WORK_LIKE, style: "icon", icon: GEAR_ICON },
      // the customization menu, which picks the buttons shown: greyed, as Rodeo's bar is fixed
      { kind: "inert", label: "Customization", why: "Rodeo's status bar shows a fixed set of buttons", icon: MENU_ICON },
    ],
  ],
};

const commandLine: CommandLineSpec = {
  where: "bottom",
  prompt: "Type a command",
  history: 3,
  upper: true,
  options: "autocad",
  commands: {
    // drawing commands: the first prompt in AutoCAD's words, while the tool waits for its first click
    LINE: { do: t("line"), prompt: "Specify first point:" },
    PLINE: { do: t("polyline"), prompt: "Specify start point:" },
    CIRCLE: { do: t("circle"), prompt: "Specify center point for circle:" },
    ARC: { do: t("arc"), prompt: "Specify center point of arc:" },
    RECTANG: { do: t("rect"), prompt: "Specify first corner point:" },
    POLYGON: { do: t("regpoly"), prompt: "Specify center of polygon:" },
    ELLIPSE: { do: t("oval"), prompt: "Specify center of ellipse:" },
    SPLINE: t("freehand"),
    HATCH: m("Modify › Hatch…"),
    MTEXT: { do: t("text"), prompt: "Specify first corner:" },
    TEXT: t("text"),
    BOX: { do: t("extrect"), prompt: "Specify first corner:" },
    SPHERE: { do: t("sphere"), prompt: "Specify center point of sphere:" },
    CONE: { do: t("cone"), prompt: "Specify center point of base:" },
    POINT: t("locus"),
    REVCLOUD: t("cloud"),
    // commands on a selection: with nothing selected they ask for objects first, then run
    // Move by Points in its Move mode; COPY in Copy Multiple, as AutoCAD copies until Enter. Their
    // options are AutoCAD's, not the tool's modes (options: [] shows none)
    MOVE: { select: "Select objects:", do: { tool: "moveby", mode: "move" }, options: [] },
    COPY: { select: "Select objects:", do: { tool: "moveby", mode: "multiple" }, options: [], enter: t("select") },
    ROTATE: { select: "Select objects:", do: t("rotate") },
    SCALE: { select: "Select objects:", do: m("Modify › Scale Objects…") },
    MIRROR: { select: "Select objects:", do: t("mirror") },
    ARRAY: { select: "Select objects:", do: m("Edit › Duplicate Array…") },
    ERASE: { select: "Select objects:", do: m("Edit › Delete") },
    EXPLODE: { select: "Select objects:", do: m("Modify › Decompose") },
    JOIN: { select: "Select source object or multiple objects to join at once:", do: m("Modify › Join › Join") },
    GROUP: { select: "Select objects:", do: m("Modify › Group") },
    UNGROUP: { select: "Select objects:", do: m("Modify › Ungroup") },
    BLOCK: { select: "Select objects:", do: m("Modify › Create Symbol…") },
    EXTRUDE: { select: "Select objects to extrude:", do: m("Model › Extrude…") },
    UNION: { select: "Select objects:", do: m("Model › Add Solids") },
    SUBTRACT: { select: "Select objects:", do: m("Model › Subtract Solids") },
    INTERSECT: { select: "Select objects:", do: m("Model › Intersect Solids") },
    COPYCLIP: { select: "Select objects:", do: m("Edit › Copy") },
    CUTCLIP: { select: "Select objects:", do: m("Edit › Cut") },
    PASTECLIP: m("Edit › Paste"),
    QSELECT: m("Edit › Select by Query…"),
    SELECT: t("select"),
    HIDEOBJECTS: { select: "Select objects:", do: m("View › Hide Selected Objects") },
    ISOLATEOBJECTS: { select: "Select objects:", do: m("View › Show Selected Objects Only") },
    UNISOLATEOBJECTS: m("View › Unhide Objects"),
    // commands that ask for no selection
    STRETCH: { do: t("reshape"), prompt: "Select objects:" },
    // Rodeo's Connect/Combine tool lengthens a line or arc to meet another
    EXTEND: { do: t("connect"), prompt: "Select object to extend:" },
    OFFSET: t("offset"),
    TRIM: t("trim"),
    FILLET: t("fillet"),
    CHAMFER: t("chamfer"),
    BREAK: t("split"),
    DIST: { do: t("measure"), prompt: "Specify first point:" },
    DIMLINEAR: t("dimension"),
    DIMALIGNED: t("dimension"),
    LEADER: { do: t("leaderline"), prompt: "Specify leader start point:" },
    QLEADER: { do: t("leaderline"), prompt: "Specify first leader point:" },
    MLEADER: t("callout"),
    LAYER: p("navigation"),
    INSERT: t("symbol"),
    ZOOM: {
      prompt: "Specify corner of window, enter a scale factor (nX or nXP), or",
      options: [
        { name: "All", do: m("View › Fit to Window") },
        { name: "Extents", do: m("View › Fit to Objects") },
        { name: "Previous", do: m("View › Previous View") },
        { name: "Window", do: t("zoom") },
        { name: "Object", do: m("View › Zoom to Selection") },
      ],
      enter: t("zoom"),
      enterLabel: "real time",
    },
    PAN: t("pan"),
    UNDO: m("Edit › Undo"),
    REDO: m("Edit › Redo"),
    MATCHPROP: t("eyedropper"),
    PROPERTIES: p("objectInfo"),
    MEASURE: t("measure"),
    DIVIDE: m("Modify › Drafting Aids › Even Divide…"),
    OSNAP: m("View › Snap to Objects"),
    GRID: m("View › Show Grid"),
    SNAP: m("View › Snap to Grid"),
    VSCURRENT: {
      prompt: "Enter an option",
      options: [
        { name: "Wireframe", do: m("View › Rendering › Wireframe") },
        { name: "Hidden", do: m("View › Rendering › Hidden Line") },
        { name: "Shaded", do: m("View › Rendering › Shaded"), key: "SH" },
        { name: "Realistic", do: m("View › Rendering › Realistic") },
        { name: "Sketch", do: m("View › Rendering › Sketch"), key: "SK" },
        { name: "Path Traced", do: m("View › Rendering › Path Traced"), key: "PT" },
      ],
    },
    EXPORT: {
      prompt: "Enter a file type",
      options: [
        { name: "PDF", do: m("File › Export › Export PDF…") },
        { name: "DXF", do: m("File › Export › Export DXF") },
        { name: "SVG", do: m("File › Export › Export SVG") },
      ],
    },
    IMPORT: {
      prompt: "Enter a file type",
      options: [
        { name: "DWG", do: m("File › Import › Import DWG…") },
        { name: "DXF", do: m("File › Import › Import DXF…") },
        { name: "PDF", do: m("File › Import › Import PDF…") },
      ],
    },
    "3DORBIT": m("View › Rotate 3D View…"),
    PLOT: m("File › Print…"),
    QSAVE: m("File › Save"),
    SAVEAS: m("File › Save As…"),
    OPEN: m("File › Open…"),
    NEW: m("File › New"),
    CLOSE: m("File › Close"),
    PDFIMPORT: m("File › Import › Import PDF…"),
    SWEEP: m("Model › Sweep…"),
    LOFT: t("loftsurface"),
    SECTIONPLANE: m("Model › Section Solids…"),
    PRESSPULL: t("pushpull"),
    HIDE: m("View › Rendering › Hidden Line"),
    TABLE: m("Tools › Reports › Create Report…"),
    PURGE: m("Tools › Utilities › Purge…"),
    AUDIT: m("Tools › Check File Health…"),
    UNITS: m("File › Document Settings › Units…"),
    AREA: { do: AREA, select: "Select objects:" },
    LIST: { do: LIST, select: "Select objects:" },
    REGEN: REGEN,
    REGENALL: REGEN,
    REDRAW: REGEN,
    REDRAWALL: REGEN,
    // ORTHO on or off by its options; Enter keeps it as it is, which the prompt shows as <ON> or <OFF>
    ORTHO: {
      prompt: "Enter mode",
      options: [
        { name: "ON", do: { run: () => setOrtho(true) } },
        { name: "OFF", do: { run: () => setOrtho(false) } },
      ],
      get enterLabel(): string {
        return orthoOn() ? "ON" : "OFF";
      },
    },
    DIMRADIUS: dim("radial"),
    DIMDIAMETER: dim("diameter"),
    DIMANGULAR: dim("angular"),
    DIMBASELINE: dim("baseline"),
    DIMCONTINUE: dim("chain"),
    DIMORDINATE: dim("ordinate"),
    DIMARC: { tool: "arclength" },
    CYLINDER: { do: { tool: "cylinder" }, prompt: "Specify center point of base:" },
    TORUS: { do: { tool: "torus" }, prompt: "Specify center point:" },
    FLATSHOT: { do: MAKE2D, select: "Select objects:" },
    REVOLVE: { do: { menu: "Model › Sweep…" }, select: "Select objects to revolve:" },
    MLINE: { tool: "doubleline" },
    OPTIONS: { menu: "Edit › Preferences…" },
    ADCENTER: { palette: "resources" },
    TOOLPALETTES: { palette: "toolsets" },
    "3DMOVE": { select: "Select objects:", do: { tool: "moveby", mode: "move" } },
    "3DROTATE": { do: { menu: "Modify › Rotate 3D…" }, select: "Select objects:" },
    "3DARRAY": { select: "Select objects:", do: m("Edit › Duplicate Array…") },
    ALIGN: { do: { menu: "Modify › Align › Align/Distribute…" }, select: "Select objects:" },
  },
  // short names from AutoCAD's acad.pgp, only where the full name above is in the commands
  aliases: {
    L: "LINE",
    PL: "PLINE",
    C: "CIRCLE",
    A: "ARC",
    REC: "RECTANG",
    POL: "POLYGON",
    EL: "ELLIPSE",
    SPL: "SPLINE",
    H: "HATCH",
    T: "MTEXT",
    MT: "MTEXT",
    DT: "TEXT",
    M: "MOVE",
    CO: "COPY",
    CP: "COPY",
    RO: "ROTATE",
    SC: "SCALE",
    MI: "MIRROR",
    O: "OFFSET",
    TR: "TRIM",
    F: "FILLET",
    CHA: "CHAMFER",
    X: "EXPLODE",
    J: "JOIN",
    BR: "BREAK",
    AR: "ARRAY",
    S: "STRETCH",
    E: "ERASE",
    LA: "LAYER",
    DI: "DIST",
    DLI: "DIMLINEAR",
    DAL: "DIMALIGNED",
    B: "BLOCK",
    I: "INSERT",
    Z: "ZOOM",
    P: "PAN",
    U: "UNDO",
    MA: "MATCHPROP",
    PR: "PROPERTIES",
    CH: "PROPERTIES",
    ME: "MEASURE",
    DIV: "DIVIDE",
    MLD: "MLEADER",
    LE: "QLEADER",
    EX: "EXTEND",
    OS: "OSNAP",
    EXT: "EXTRUDE",
    UNI: "UNION",
    SU: "SUBTRACT",
    IN: "INTERSECT",
    "3DO": "3DORBIT",
    G: "GROUP",
    VS: "VSCURRENT",
    AA: "AREA",
    LI: "LIST",
    LS: "LIST",
    RE: "REGEN",
    REA: "REGENALL",
    R: "REDRAW",
    RA: "REDRAWALL",
    DRA: "DIMRADIUS",
    DIMRAD: "DIMRADIUS",
    DDI: "DIMDIAMETER",
    DIMDIA: "DIMDIAMETER",
    DAN: "DIMANGULAR",
    DIMANG: "DIMANGULAR",
    DBA: "DIMBASELINE",
    DIMBASE: "DIMBASELINE",
    DCO: "DIMCONTINUE",
    DIMCONT: "DIMCONTINUE",
    DOR: "DIMORDINATE",
    DIMORD: "DIMORDINATE",
    DAR: "DIMARC",
    CYL: "CYLINDER",
    TOR: "TORUS",
    FSHOT: "FLATSHOT",
    REV: "REVOLVE",
    ML: "MLINE",
    OP: "OPTIONS",
    DC: "ADCENTER",
    ADC: "ADCENTER",
    TP: "TOOLPALETTES",
    "3M": "3DMOVE",
    "3R": "3DROTATE",
    "3A": "3DARRAY",
    AL: "ALIGN",
    HI: "HIDE",
    ORBIT: "3DORBIT",
    TB: "TABLE",
    UN: "UNITS",
    PU: "PURGE",
    SPLANE: "SECTIONPLANE",
    SN: "SNAP",
    MO: "PROPERTIES",
    PROPS: "PROPERTIES",
    EXP: "EXPORT",
    IMP: "IMPORT",
    ISOLATE: "ISOLATEOBJECTS",
    UNISOLATE: "UNISOLATEOBJECTS",
    UNHIDE: "UNISOLATEOBJECTS",
    LEAD: "LEADER",
  },
  // Rodeo's tool prompts (the text before " · ") in AutoCAD's words; a hint shared by several tools takes words that fit all
  prompts: {
    "Click or drag to draw a line": "Specify first point:",
    "Click the first point": "Specify start point:",
    "Click or drag from the centre": "Specify center point for circle:",
    "Click the centre": "Specify center point:",
    "Click or drag to draw a rectangle": "Specify first corner point:",
    "Click or drag to draw an oval": "Specify center of ellipse:",
    "Drag to draw a stroke": "Specify first point:",
    "Click to place text": "Specify start point of text:",
    "Click to place a 2D locus": "Specify a point:",
    "Drag a rectangle or click two corners": "Specify first corner:",
    "Click or drag to draw the extrude's footprint": "Specify first corner:",
    "Click or drag from the sphere's centre": "Specify center point of sphere:",
    "Click or drag from the base's centre": "Specify center point of base:",
    "Click a cross section": "Select cross sections in lofting order:",
    "Click a face of a solid, or a flat closed curve": "Select a face or closed curve:",
    "Select objects first": "Select objects:",
    "Click the point to move from": "Specify base point:",
    "Click the point to move to": "Specify second point:",
    "Click the point to copy from": "Specify base point:",
    "Click where each copy goes": "Specify second point:",
    "Select lines, polygons or polylines to reshape": "Select objects:",
    "Click or drag a box to select": "Select objects:",
    "Click to zoom in or drag a box": "Specify corner of window, enter a scale factor (nX or nXP), or",
    "Drag to pan": "Specify base point or displacement:",
    "Click an object to pick up attributes": "Select source object:",
    "Click the point to split at": "Specify first break point:",
    "Click the part to cut away": "Select object to trim:",
    "Click an object to offset": "Select object to offset:",
    "Click the first line": "Select first object:",
    "Click the start point": "Specify first point:",
    "Linear: click the first point": "Specify first extension line origin:",
    "Click where the leader points": "Specify leader arrowhead location:",
    "Pick a symbol in Resources": "Pick a block in DesignCenter",
  },
};

const home: RibbonTab = {
  title: "Home",
  panels: [
    {
      title: "Draw",
      items: [
        big("Line", t("line"), "L"),
        big("Polyline", t("polyline"), "PL"),
        big("Circle", t("circle"), "C"),
        big("Arc", t("arc"), "A", [b("Quarter Arc", t("quarterarc"))]),
        [b("Rectangle", t("rect"), "REC"), b("Polygon", t("regpoly"), "POL"), b("Point", t("locus"), "PO")],
        [b("Hatch", m("Modify › Hatch…"), "H"), b("Ellipse", t("oval"), "EL"), b("Spline", t("freehand"), "SPL")],
        [b("Revision Cloud", t("cloud"), "REVCLOUD")],
      ],
    },
    {
      title: "Modify",
      items: [
        [b("Move", { tool: "moveby", mode: "move" }, "M"), b("Rotate", t("rotate"), "RO"), b("Trim", t("trim"), "TR")],
        [b("Erase", m("Edit › Delete"), "E"), b("Copy", { tool: "moveby", mode: "multiple" }, "CO"), b("Mirror", t("mirror"), "MI")],
        [b("Fillet", t("fillet"), "F", [b("Chamfer", t("chamfer"), "CHA")]), b("Explode", m("Modify › Decompose"), "X"), b("Stretch", t("reshape"), "S")],
        [b("Scale", m("Modify › Scale Objects…"), "SC"), b("Array", m("Edit › Duplicate Array…"), "AR"), b("Offset", t("offset"), "O")],
      ],
    },
    {
      title: "Annotation",
      items: [
        big("Text", t("text"), "DT"),
        big("Dimension", t("dimension"), "DLI", [b("Arc Length", t("arclength")), b("Slope", t("slopedim")), b("Dimension Tape", t("dimtape"))]),
        [b("Leader", t("callout")), b("Table", m("Tools › Reports › Create Report…"))],
      ],
    },
    {
      title: "Layers",
      items: [
        big("Layer Properties", p("navigation"), "LA"),
        [b("Isolate", m("View › Show Selected Objects Only")), b("Unisolate", m("View › Unhide Objects")), b("Active Only", m("View › Layer Options › Active Only"))],
      ],
    },
    {
      title: "Block",
      items: [
        big("Insert", t("symbol"), "I"),
        [b("Create", m("Modify › Create Symbol…"), "B"), b("Block Editor", m("Modify › Edit Symbol")), b("Exit Block", m("Modify › Exit Symbol"))],
      ],
    },
    {
      title: "Properties",
      items: [big("Match Properties", t("eyedropper"), "MA"), [b("Properties", p("objectInfo"), "PR")]],
    },
    {
      title: "Groups",
      items: [[b("Group", m("Modify › Group"), "G"), b("Ungroup", m("Modify › Ungroup"))]],
    },
    {
      title: "Utilities",
      items: [big("Measure", t("measure"), "ME"), [b("Divide", m("Modify › Drafting Aids › Even Divide…"), "DIV"), b("Protractor", t("protractor"))]],
    },
    {
      title: "Clipboard",
      items: [big("Paste", m("Edit › Paste"), "Ctrl+V"), [b("Cut", m("Edit › Cut"), "Ctrl+X"), b("Copy", m("Edit › Copy"), "Ctrl+C")]],
    },
    {
      title: "View",
      items: [big("Top", m("View › Standard Views › Top"), ""), [b("Front", m("View › Standard Views › Front")), b("Right", m("View › Standard Views › Right")), b("Right Iso", m("View › Standard Views › Right Isometric"))]],
    },
  ],
};

const insert: RibbonTab = {
  title: "Insert",
  panels: [
    {
      title: "Block",
      items: [big("Insert", t("symbol"), "I"), [b("Create", m("Modify › Create Symbol…"), "B"), b("Block Editor", m("Modify › Edit Symbol"))]],
    },
    {
      title: "Reference",
      items: [big("Attach", m("File › Import › Import DWG…")), [b("Attach Image", m("File › Import › Import Image File(s)…")), b("Attach PDF", m("File › Import › Import PDF…"))]],
    },
    {
      title: "Import",
      items: [big("PDF Import", m("File › Import › Import PDF…"), "PDFIMPORT"), [b("Import DWG", m("File › Import › Import DWG…")), b("Import DXF", m("File › Import › Import DXF…"))]],
    },
    {
      title: "Data",
      items: [big("Attach Data", m("Tools › Records › Attach Record…")), [b("Detach Data", m("Tools › Records › Detach Record…"))]],
    },
  ],
};

const annotate: RibbonTab = {
  title: "Annotate",
  panels: [
    {
      title: "Text",
      items: [big("Text", t("text"), "DT"), [b("Check Spelling", m("Text › Check Spelling…")), b("Find and Replace", m("Text › Find-Replace Text…"))]],
    },
    {
      title: "Dimensions",
      items: [big("Linear", t("dimension"), "DLI"), [b("Arc Length", t("arclength")), b("Slope", t("slopedim")), b("Dimension Tape", t("dimtape"))]],
    },
    {
      title: "Leaders",
      items: [big("Leader", t("callout"), "MLD"), [b("Leader Line", t("leaderline")), b("Simple Leader", t("leadersimple"))]],
    },
    {
      title: "Tables",
      items: [big("Table", m("Tools › Reports › Create Report…"), "TABLE"), [b("Edit Table", m("Tools › Reports › Edit Worksheet…"))]],
    },
    {
      title: "Markup",
      items: [big("Revision Cloud", t("cloud"), "REVCLOUD"), [b("Redline", t("redline")), b("Hyperlink", t("hyperlink"))]],
    },
  ],
};

const view: RibbonTab = {
  title: "View",
  panels: [
    {
      title: "Viewport Tools",
      items: [[b("Viewport", m("View › Create Viewport…")), b("Multiple Viewports", m("View › Create Multiple Viewports…")), b("Update Viewports", m("View › Update All Viewports"))]],
    },
    {
      title: "Model Viewports",
      items: [[b("Single Pane", m("View › Multiple View Panes › Single Pane")), b("Two Vertical", m("View › Multiple View Panes › Two Panes Side by Side")), b("Four Panes", m("View › Multiple View Panes › Four Panes"))]],
    },
    {
      title: "Named Views",
      items: [big("Named Views", m("Window › Palettes › Saved Views")), [b("Previous View", m("View › Previous View")), b("Next View", m("View › Next View")), b("Save View", m("View › Save View…"))]],
    },
    {
      title: "Visual Styles",
      items: [
        [b("Wireframe", m("View › Rendering › Wireframe")), b("Hidden", m("View › Rendering › Hidden Line")), b("Shaded", m("View › Rendering › Shaded"))],
        [b("Realistic", m("View › Rendering › Realistic")), b("Path Traced", m("View › Rendering › Path Traced")), b("Sketch", m("View › Rendering › Sketch"))],
      ],
    },
    {
      title: "Palettes",
      items: [[b("Properties", p("objectInfo")), b("Layer Properties", p("navigation")), b("Tool Palettes", p("toolsets"))]],
    },
    {
      title: "Interface",
      items: [[b("Full Screen", m("Window › Use Full Screen")), b("Compact", m("Window › Compact Interface"))]],
    },
  ],
};

const manage: RibbonTab = {
  title: "Manage",
  panels: [
    {
      title: "Customization",
      items: [big("Customize", m("Window › Workspaces › Menus…")), [b("Tool Shortcuts", m("Window › Workspaces › Tool Shortcuts…")), b("Menu Shortcuts", m("Window › Workspaces › Menu Shortcuts…")), b("Save Workspace", m("Window › Workspaces › Save Workspace As…"))]],
    },
    {
      title: "Applications",
      items: [big("Run Script", m("Tools › Plug-ins › Run Script…")), [b("Script Console", m("Tools › Plug-ins › Script Console…")), b("Plug-in Manager", m("Tools › Plug-ins › Plug-in Manager…"))]],
    },
  ],
};

const output: RibbonTab = {
  title: "Output",
  panels: [
    {
      title: "Plot",
      items: [big("Plot", m("File › Print…"), "Ctrl+P"), [b("Page Setup", m("File › Page Setup…")), b("Publish", m("File › Publish…"))]],
    },
    {
      title: "Export",
      items: [[b("Export PDF…", m("File › Export › Export PDF…")), b("Export DXF", m("File › Export › Export DXF")), b("Export SVG", m("File › Export › Export SVG"))]],
    },
  ],
};

const addIns: RibbonTab = {
  title: "Add-ins",
  panels: [
    {
      title: "Plug-ins",
      items: [big("Plug-in Manager", m("Tools › Plug-ins › Plug-in Manager…")), [b("Script Console", m("Tools › Plug-ins › Script Console…")), b("Reset Plug-ins", m("Tools › Utilities › Reset All Plug-Ins"))]],
    },
  ],
};

const collaborate: RibbonTab = {
  title: "Collaborate",
  panels: [
    {
      title: "Share",
      items: [big("Collaborators", m("Window › Collaborators")), [b("Publish", m("File › Publish…")), b("Version History", m("Window › Palettes › Version History"))]],
    },
  ],
};

export const look: LookSpec = {
  id: "autocad",
  name: "AutoCAD",
  theme: "dark",
  // the menus AutoCAD's menu bar has: File is the application button's menu. Each Rodeo menu is
  // named by exactly one id, so its leftover commands land in a look menu.
  menus: [
    {
      id: "File",
      title: "File",
      rows: [
        "File › New",
        "File › New from Template…",
        "File › Open…",
        "File › Open Recent",
        "File › Close",
        "-",
        "File › Save",
        "File › Save As…",
        "File › Save a Copy As…",
        "File › Save All",
        "File › Revert",
        "-",
        "File › Export",
        "File › Publish…",
        "File › Print…",
        "File › Page Setup…",
        "-",
        "File › File Info…",
      ],
    },
    {
      id: "Edit",
      title: "Edit",
      rows: [
        "Edit › Undo",
        "Edit › Redo",
        "Edit › Repeat Last Command",
        "-",
        "Edit › Cut",
        "Edit › Copy",
        "Edit › Paste",
        "Edit › Paste in Place",
        "-",
        "Edit › Duplicate",
        "Edit › Duplicate Array…",
        "Edit › Delete",
        "-",
        "Edit › Select All",
        "Edit › Select Similar",
        "Edit › Select None",
        "Edit › Invert Selection",
        "Edit › Previous Selection",
        "-",
        "Edit › Preferences…",
      ],
    },
    {
      id: "View",
      title: "View",
      rows: [
        "View › Zoom In",
        "View › Zoom Out",
        "View › Fit to Window",
        "View › Fit to Objects",
        "View › Zoom to Selection",
        "View › Previous View",
        "View › Next View",
        "View › Save View…",
        "-",
        "View › 3D View",
        "View › Standard Views",
        "View › Set 3D View…",
        "View › Rotate 3D View…",
        "View › Projection",
        "-",
        "View › Rendering",
        "View › Multiple View Panes",
        "View › Onscreen View Control",
        "-",
        "View › Show Grid",
        "View › Snap to Grid",
        "View › Snap to Objects",
        "View › Rulers",
        "View › Zoom Line Thickness",
        "View › Appearance",
        "-",
        "View › Layer Options",
        "View › Class Options",
        "View › Unhide Objects",
        "View › Show Selected Objects Only",
        "View › Hide Selected Objects",
        "View › Object Visibility…",
      ],
    },
    {
      id: "Insert",
      title: "Insert",
      rows: ["File › Import", "-", "Modify › Create Symbol…", "Modify › Edit Symbol", "Modify › Exit Symbol", "-", "Tools › Records"],
    },
    {
      id: "Format",
      title: "Format",
      rows: [
        "Text › Format Text…",
        "Text › Font",
        "Text › Size",
        "Text › Style",
        "Text › Justification",
        "Text › Vertical Alignment",
        "Text › Text Style",
        "-",
        "Modify › Attributes",
        "Tools › Options › Line Thickness…",
        "Tools › Utilities › Color Palette Manager…",
        "Tools › Utilities › Replace Font…",
        "-",
        "File › Document Settings",
      ],
    },
    {
      id: "Tools|Plug-ins",
      title: "Tools",
      rows: [
        "Tools › Quick Search…",
        "Tools › Find and Modify…",
        "Tools › Snap Settings…",
        "Tools › Smart Point Settings…",
        "Tools › Origin",
        "-",
        "Tools › Options",
        "Tools › Utilities",
        "Tools › Check File Health…",
        "-",
        "Tools › Plug-ins",
      ],
    },
    {
      id: "Model|AEC|Stage",
      title: "Draw",
      rows: ["Modify › Hatch…", "Modify › Join", "Modify › Convert", "-", "Model › Extrude…"],
    },
    {
      id: "Text",
      title: "Dimension",
      rows: ["Modify › Convert › Convert Object to Dimension", "AEC › Dimension Exterior Walls…"],
    },
    {
      id: "Modify",
      title: "Modify",
      rows: [
        "Modify › Move…",
        "Modify › Rotate…",
        "Modify › Scale Objects…",
        "Modify › Flip Horizontal",
        "Modify › Flip Vertical",
        "-",
        "Modify › Decompose",
        "-",
        "Modify › Send to Front",
        "Modify › Send Forward",
        "Modify › Send Backward",
        "Modify › Send to Back",
        "-",
        "Modify › Group",
        "Modify › Ungroup",
        "Modify › Edit Group",
        "Modify › Exit Group",
        "-",
        "Modify › Working Plane",
        "Modify › Guides",
      ],
    },
    {
      id: "Parametric",
      title: "Parametric",
      rows: ["Modify › Align", "Modify › Distribute"],
    },
    {
      id: "Window",
      title: "Window",
      rows: [
        "Window › Palettes",
        "Window › Palette Options",
        "Window › Workspaces",
        "-",
        "Window › Drawings",
        "Window › Show Document Tabs",
        "-",
        "Window › Use Full Screen",
        "Window › Compact Interface",
        "Window › Reset Palette Layout",
      ],
    },
    {
      id: "Help",
      title: "Help",
      rows: ["Help › User Guide", "Help › Keyboard Shortcuts…", "Help › What's New…", "-", "Help › About Rodeo…", "Help › Plug-in API…"],
    },
  ],
  // the application's words where Rodeo's text shows whole: palette titles, menu rows, tabs
  terms: {
    "Object Info": "Properties",
    Navigation: "Layer Properties",
    Resources: "DesignCenter",
    "Resource Manager": "DesignCenter",
    Symbol: "Block",
    Symbols: "Blocks",
    "Create Symbol…": "Create Block…",
    "Edit Symbol": "Block Editor",
    "Sheet Layer": "Layout",
    "Sheet Layers": "Layouts",
    "Fit to Window": "Zoom Extents",
    "Duplicate Array…": "Array…",
    "Print…": "Plot…",
    "Saved Views": "Named Views",
    "Move by Points": "Move",
    "Preferences…": "Options…",
    "Tool Sets": "Tool Palettes",
    "Working Planes": "UCS",
    Snapping: "Object Snap",
    "Vectorworks Plug-ins": "Plug-ins",
  },
  palettes: {
    // as AutoCAD's Drafting & Annotation opens a new drawing: no palette shown; Properties (Ctrl+1) and Layer Properties (LA) open when asked
    objectInfo: { where: "hidden" },
    basic: { where: "hidden" },
    toolsets: { where: "hidden" },
    attributes: { where: "hidden" },
    navigation: { where: "hidden" },
    resources: { where: "hidden" },
    snapping: { where: "hidden" },
    visualization: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { left: 280 },
  topBar: false,
  menuBar: false,
  titleBar: true,
  ribbon: {
    start: "Home",
    tabs: [home, insert, annotate, view, manage, output, addIns, collaborate],
    quickAccess: [
      b("New", m("File › New"), "Ctrl+N"),
      b("Open", m("File › Open…"), "Ctrl+O"),
      b("Save", m("File › Save"), "Ctrl+S"),
      b("Save As", m("File › Save As…"), "Ctrl+Shift+S"),
      b("Plot", m("File › Print…"), "Ctrl+P"),
      b("Undo", m("Edit › Undo"), "Ctrl+Z"),
      b("Redo", m("Edit › Redo"), "Ctrl+Y"),
    ],
  },
  commandLine,
  statusBar,
  // AutoCAD has no Mode bar: the tool's modes are the command prompt's keywords, as AutoCAD's are
  modeBar: "line",
  viewBar: "hidden",
  snapPill: false,
  rails: false,
  icons: "color",
  // the Layer Properties Manager: Rodeo's classes as layers, None as layer 0
  panels: {
    navigation: { kind: "layerTable", style: "autocad", columns: ["current", "name", "visible", "lock", "color", "linetype", "lineweight"], none: "0" },
  },
  layoutTabs: true,
  // the document tabs begin with a Start tab (docTabs.ts)
  startTab: true,
  viewportControls: true,
  grid: true,
  viewCube: true,
  keys: {
    F1: m("Help › User Guide"),
    F3: m("View › Snap to Objects"),
    F7: m("View › Show Grid"),
    F8: ORTHO,
    F9: m("View › Snap to Grid"),
    Delete: m("Edit › Delete"),
    "Ctrl+1": p("objectInfo"),
    "Ctrl+3": p("toolsets"),
    // shows or hides the command line (its × button hides it too)
    "Ctrl+9": { run: toggleCommandLine },
    "Ctrl+Z": m("Edit › Undo"),
    "Ctrl+Y": m("Edit › Redo"),
  },
  mouse: { middle: "pan", right: "menu" },
  // the drawing is drawn light and inverted in autocad.css, so its black lines show light on a dark model space
  paper: "#d2d9e1",
  background3d: "#212830",
};
