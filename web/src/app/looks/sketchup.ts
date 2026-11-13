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

const select: LookButton = { label: "Select", do: { tool: "select" } };
const eraser: LookButton = { label: "Eraser", do: { menu: "Edit › Delete" }, icon: ERASER, keys: "E" };
const line: LookButton = { label: "Line", do: { tool: "line" }, keys: "L" };
const freehand: LookButton = { label: "Freehand", do: { tool: "freehand" } };
const arc: LookButton = { label: "Arc", do: { tool: "arc" }, keys: "A" };
const circle: LookButton = { label: "Circle", do: { tool: "circle" }, keys: "C" };
const polygon: LookButton = { label: "Polygon", do: { tool: "regpoly" } };
const rectangle: LookButton = { label: "Rectangle", do: { tool: "rect" }, keys: "R", more: [circle, polygon] };
const pushPull: LookButton = { label: "Push/Pull", do: { tool: "pushpull" }, keys: "P" };
const offset: LookButton = { label: "Offset", do: { tool: "offset" }, keys: "F" };
const move: LookButton = { label: "Move", do: { tool: "moveby" }, keys: "M" };
const rotate: LookButton = { label: "Rotate", do: { tool: "rotate" }, keys: "Q" };
const scale: LookButton = { label: "Scale", do: { menu: "Modify › Scale Objects…" }, icon: SCALE, keys: "S" };
const tapeMeasure: LookButton = { label: "Tape Measure", do: { tool: "measure" }, keys: "T" };
const dimension: LookButton = { label: "Dimension", do: { tool: "dimension" } };
const protractor: LookButton = { label: "Protractor", do: { tool: "protractor" } };
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
  // The default tray: Entity Info with Materials as a tab, Components with Tags and Shadows as tabs.
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
        buttons: [select, eraser, "-", line, arc, rectangle, "-", pushPull, offset, move, rotate, scale, "-", tapeMeasure, text, paintBucket, "-", orbit, pan, zoom, zoomExtents],
      },
    ],
  },
  toolbox: {
    side: "left",
    columns: 2,
    labels: false,
    groups: [
      { buttons: [select, eraser, paintBucket] },
      { buttons: [line, freehand, rectangle, circle, polygon, arc] },
      { buttons: [pushPull, offset, move, rotate, scale] },
      { buttons: [tapeMeasure, dimension, protractor, text] },
      { buttons: [orbit, pan, zoom, zoomExtents] },
      { buttons: [position, walk] },
    ],
  },
  statusBar: {
    // the tool's hint comes with the Mode bar at the row's start
    rows: [[{ kind: "spacer" }, { kind: "measurements", label: "Measurements" }]],
  },
  // a tool's modes along the status bar, as SketchUp's hints and modifier keys sit there
  modeBar: "status",
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
    m: { tool: "moveby" },
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
  // a sky above the horizon and the drawing axes through the origin in the 3D view
  axes3d: "sketchup",
};
