// View › Work Like › SketchUp: Rodeo laid out the way SketchUp's Windows users know it. The menu bar
// with SketchUp's menus in its order, the Getting Started toolbar, the Large Tool Set down the left,
// the default tray of panels on the right, one status row with the Measurements box, and SketchUp's
// single keys. Every button and key runs one of Rodeo's own tools or menu commands; the icons are
// Rodeo's, and the two Rodeo has no icon for are drawn here as plain line icons.
import "./sketchup.css";
import { lookIcon } from "./commands.ts";
import type { LookButton, LookSpec } from "./types.ts";

/** An eraser outline: SketchUp's Eraser runs Rodeo's delete command, so it gets a drawn icon. */
const ERASER = lookIcon('<path d="M4.5 14.5 10.5 5.5l8 5.5-5.5 7.5H8z"/><path d="M8.5 11.5l6 4"/><path d="M9 20.5h11"/>');
/** A box with an arrow out of its corner: Scale runs Rodeo's Scale Objects command. */
const SCALE = lookIcon('<rect x="4" y="4" width="10" height="10"/><path d="M14 14l6 6"/><path d="M20 14v6h-6"/>');
/** A map pin over a small globe: Geo-location runs Rodeo's site import, so it gets this icon. */
const GEO = lookIcon('<path d="M8 3.5a4.5 4.5 0 0 1 4.5 4.5c0 3-4.5 8-4.5 8s-4.5-5-4.5-8A4.5 4.5 0 0 1 8 3.5z"/><circle cx="8" cy="8" r="1.6"/><circle cx="17" cy="16.5" r="4"/><path d="M13 16.5h8"/><path d="M17 12.5c-1.3 1.3-1.3 6.7 0 8"/>');
/** A circle with a C in it: the Credits button, drawn as a copyright sign. */
const CREDITS = lookIcon('<circle cx="12" cy="12" r="9"/><path d="M14.8 9.4a3.6 3.6 0 1 0 0 5.2"/>');
/** A head and shoulders: Sign in. */
const PERSON = lookIcon('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.9 3.1-6.5 7-6.5s7 2.6 7 6.5"/>');
/** A question mark in a circle: the Instructor. */
const INSTRUCTOR = lookIcon('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4"/><path d="M12 17h.01"/>');

// Select always starts in SketchUp's window-and-crossing mode, so its button sets the marquee back to a rectangle
const select: LookButton = { label: "Select", do: { tool: "select", mode: "rect" } };
/** A loose loop with a short tail and its knot: the Lasso, drawn for Rodeo. */
const LASSO = lookIcon('<path d="M6.5 13.5C4.6 12.4 3.5 10.9 3.5 9.2c0-3 3.8-5.2 8.5-5.2s8.5 2.3 8.5 5.2-3.8 5.3-8.5 5.3c-1.2 0-2.3-.1-3.3-.4"/><circle cx="7.3" cy="14.6" r="1.4"/><path d="M7 16c-.6 1.6-.2 3 1.2 4.5"/>');
// SketchUp 2025 has Lasso as its own tool beside Select: Rodeo's lasso marquee
const lasso: LookButton = { label: "Lasso", do: { tool: "select", mode: "lasso" }, icon: LASSO };
const eraser: LookButton = { label: "Eraser", do: { menu: "Edit › Delete" }, icon: ERASER, keys: "E" };
const line: LookButton = { label: "Line", do: { tool: "line" }, keys: "L" };
const freehand: LookButton = { label: "Freehand", do: { tool: "freehand" } };
const arc: LookButton = { label: "Arc", do: { tool: "arc" }, keys: "A" };
const circle: LookButton = { label: "Circle", do: { tool: "circle" }, keys: "C" };
const polygon: LookButton = { label: "Polygon", do: { tool: "regpoly" } };
const rectangle: LookButton = { label: "Rectangle", do: { tool: "rect" }, keys: "R", more: [circle, polygon] };
const pushPull: LookButton = { label: "Push/Pull", do: { tool: "pushpull" }, keys: "P" };
const offset: LookButton = { label: "Offset", do: { tool: "offset" }, keys: "F" };
const move: LookButton = { label: "Move", do: { tool: "moveby", mode: "move" }, keys: "M" };
const rotate: LookButton = { label: "Rotate", do: { tool: "rotate" }, keys: "Q" };
const scale: LookButton = { label: "Scale", do: { menu: "Modify › Scale Objects…" }, icon: SCALE, keys: "S" };
const tapeMeasure: LookButton = { label: "Tape Measure", do: { tool: "measure" }, keys: "T" };
const dimension: LookButton = { label: "Dimension", do: { tool: "dimension" } };
const protractor: LookButton = { label: "Protractor", do: { tool: "protractor" } };
// SketchUp sets a text's alignment in Entity Info, as Rodeo's Object Info does, so Text has no drop-down
const text: LookButton = { label: "Text", do: { tool: "text" } };
const paintBucket: LookButton = { label: "Paint Bucket", do: { tool: "attrmap" }, keys: "B" };
const orbit: LookButton = { label: "Orbit", do: { tool: "flyover" }, keys: "O" };
const pan: LookButton = { label: "Pan", do: { tool: "pan" }, keys: "H" };
const zoom: LookButton = { label: "Zoom", do: { tool: "zoom" }, keys: "Z" };
const zoomExtents: LookButton = { label: "Zoom Extents", do: { menu: "View › Fit to Window" }, keys: "Shift+Z" };
const position: LookButton = { label: "Position Camera", do: { tool: "camera" } };
const walk: LookButton = { label: "Walk", do: { tool: "walkthrough" } };

export const look: LookSpec = {
  id: "sketchup",
  name: "SketchUp",
  theme: "light",
  // Each look menu's id names the Rodeo menus whose leftover commands it takes, so every Rodeo menu
  // is in exactly one id. Camera has no Rodeo menu of its own, so it takes none.
  menus: [
    {
      id: "File",
      title: "File",
      rows: [
        "File › New",
        "File › Open…",
        "-",
        "File › Save",
        "File › Save As…",
        "File › Save as Template…",
        "-",
        "File › Import",
        "File › Export",
        "-",
        "File › Print…",
      ],
    },
    {
      id: "Edit",
      title: "Edit",
      rows: [
        "Edit › Undo",
        "Edit › Redo",
        "-",
        "Edit › Cut",
        "Edit › Copy",
        "Edit › Paste",
        "Edit › Paste in Place",
        "-",
        "Edit › Delete",
        "Edit › Select All",
        "Edit › Select None",
        "-",
        "View › Hide Selected Objects",
        "View › Unhide Objects",
        "-",
        "Modify › Create Symbol…",
        "Modify › Group",
        "Modify › Exit Group",
        "-",
        "Model › Intersect Solids",
      ],
    },
    {
      id: "View",
      title: "View",
      rows: [
        "View › Rendering › Wireframe",
        "View › Rendering › Hidden Line",
        "View › Rendering › Shaded",
        "View › Rendering › Textured",
        "-",
        "View › Show Grid",
        "View › Snap to Grid",
      ],
    },
    {
      id: "Camera",
      title: "Camera",
      rows: [
        "View › Standard Views › Top",
        "View › Standard Views › Bottom",
        "View › Standard Views › Front",
        "View › Standard Views › Back",
        "View › Standard Views › Left",
        "View › Standard Views › Right",
        "View › Standard Views › Right Isometric",
        "-",
        "View › Projection › Orthogonal",
        "View › Projection › Normal Perspective",
        "-",
        "View › Fit to Window",
      ],
    },
    {
      id: "Model|AEC",
      title: "Draw",
      rows: [
        "Model › Extrude…",
        "Model › Multiple Extrude…",
        "Model › Tapered Extrude…",
        "Model › Sweep…",
        "Model › Extrude Along Path…",
      ],
    },
    {
      id: "Modify|Tools|Text|Stage",
      title: "Tools",
      rows: [
        "Modify › Move…",
        "Modify › Rotate…",
        "Modify › Scale Objects…",
        "-",
        "Modify › Flip Horizontal",
        "Modify › Flip Vertical",
        "-",
        "Model › Add Solids",
        "Model › Subtract Solids",
        "-",
      ],
    },
    {
      id: "Window",
      title: "Window",
      rows: [
        "Window › Palettes › Object Info",
        "Window › Palettes › Attributes",
        "Window › Palettes › Resource Manager",
        "Window › Palettes › Navigation",
        "Window › Palettes › Visualization",
        "Window › Palettes › Saved Views",
        "-",
      ],
    },
    {
      id: "Plug-ins",
      title: "Extensions",
      rows: ["Tools › Plug-ins › Plug-in Manager…", "Tools › Plug-ins › Script Console…", "Tools › Plug-ins › Run Script…", "-"],
    },
    {
      id: "Help",
      title: "Help",
      rows: [],
    },
  ],
  // SketchUp's words for Rodeo's, wherever the whole text shows: palette titles, menu rows and tabs.
  terms: {
    "Object Info": "Entity Info",
    Attributes: "Materials",
    Resources: "Components",
    "Resource Manager": "Components",
    Navigation: "Tags",
    Visualization: "Shadows",
    "Saved Views": "Scenes",
    Symbol: "Component",
    Symbols: "Components",
    "Create Symbol…": "Make Component…",
    "Edit Symbol": "Edit Component",
    Group: "Make Group",
    "Exit Group": "Close Group/Component",
    Class: "Tag",
    Classes: "Tags",
    "Fit to Window": "Zoom Extents",
    "Move by Points": "Move",
    Flyover: "Orbit",
    Orthogonal: "Parallel Projection",
    "Normal Perspective": "Perspective",
    "Right Isometric": "Iso",
    Rendering: "Face Style",
    "Save as Template…": "Save As Template…",
    "Hide Selected Objects": "Hide",
    "Unhide Objects": "Unhide",
    "Attribute Mapping": "Paint Bucket",
    Walkthrough: "Walk",
  },
  // The default tray: Entity Info with Materials as a tab, Components with Tags and Shadows as tabs. The tray
  // takes each as a section, and Scenes from Navigation's Saved Views tab (tray.ts).
  palettes: {
    objectInfo: { where: "right", order: 0 },
    attributes: { where: "right", tabOf: "objectInfo" },
    resources: { where: "right", order: 1 },
    navigation: { where: "right", tabOf: "resources" },
    visualization: { where: "right", tabOf: "resources" },
    basic: { where: "hidden" },
    toolsets: { where: "hidden" },
    snapping: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { right: 300 },
  topBar: false,
  menuBar: true,
  toolbars: {
    showTabs: false,
    tabs: [
      {
        title: "Getting Started",
        buttons: [select, lasso, eraser, "-", line, arc, rectangle, "-", pushPull, offset, move, rotate, scale, "-", tapeMeasure, text, paintBucket, "-", orbit, pan, zoom, zoomExtents],
      },
    ],
  },
  toolbox: {
    side: "left",
    columns: 2,
    labels: false,
    groups: [
      { buttons: [select, lasso, eraser, paintBucket] },
      { buttons: [line, freehand, rectangle, circle, polygon, arc] },
      { buttons: [pushPull, offset, move, rotate, scale] },
      { buttons: [tapeMeasure, dimension, protractor, text] },
      { buttons: [orbit, pan, zoom, zoomExtents] },
      { buttons: [position, walk] },
    ],
  },
  statusBar: {
    // SketchUp's status row: four icon buttons at the far left, then the tool's instructions as
    // sentences, then the Measurements box at the right
    rows: [
      [
        { kind: "button", label: "Geo-location", do: { menu: "File › Import › Import Site Context…" }, icon: GEO, iconOnly: true },
        { kind: "inert", label: "Credits", why: "Rodeo keeps no author credits for drawings", icon: CREDITS },
        { kind: "inert", label: "Sign in", why: "Sign in from the account button on Rodeo's start page", icon: PERSON },
        { kind: "button", label: "Instructor", do: { menu: "Help › User Guide" }, icon: INSTRUCTOR, iconOnly: true },
        { kind: "hint", style: "sentences" },
        { kind: "spacer" },
        { kind: "measurements", label: "Measurements" },
      ],
    ],
  },
  // a tool's modes are picked by their keys, or by the toolbars' buttons; no Mode bar, as in SketchUp
  modeBar: "keys",
  viewBar: "hidden",
  snapPill: false,
  rails: false,
  icons: "color",
  // the Tags panel in the Navigation palette's place; no grid or view cube
  panels: { navigation: { kind: "layerTable", style: "sketchup", columns: ["visible", "name", "linetype", "color"], none: "Untagged" } },
  grid: false,
  viewCube: false,
  tray: true,
  docTabs: false,
  // SketchUp's single keys; each maps to a Rodeo tool or menu command that exists.
  keys: {
    l: { tool: "line" },
    a: { tool: "arc" },
    r: { tool: "rect" },
    c: { tool: "circle" },
    p: { tool: "pushpull" },
    f: { tool: "offset" },
    m: { tool: "moveby", mode: "move" },
    q: { tool: "rotate" },
    s: { menu: "Modify › Scale Objects…" },
    t: { tool: "measure" },
    b: { tool: "attrmap" },
    e: { menu: "Edit › Delete" },
    o: { tool: "flyover" },
    h: { tool: "pan" },
    z: { tool: "zoom" },
    "⇧z": { menu: "View › Fit to Window" },
    g: { menu: "Modify › Create Symbol…" },
    Delete: { menu: "Edit › Delete" },
    k: { menu: "View › Rendering › Dashed Hidden Line" },
    "Ctrl+Z": { menu: "Edit › Undo" },
    "Ctrl+Y": { menu: "Edit › Redo" },
    "Ctrl+A": { menu: "Edit › Select All" },
    "Ctrl+C": { menu: "Edit › Copy" },
    "Ctrl+X": { menu: "Edit › Cut" },
    "Ctrl+V": { menu: "Edit › Paste" },
  },
  // SketchUp orbits with the wheel pressed (Shift pans); the right button opens the menu.
  mouse: { middle: "orbit", right: "menu" },
  paper: "#ffffff",
  background3d: "#dfe9f2",
  // a sky above the horizon, grey ground below it and the drawing axes through the origin in the 3D view
  axes3d: "sketchup",
  // one 3D view in perspective, where the drawing tools draw on the ground, as SketchUp opens
  start3d: true,
};
