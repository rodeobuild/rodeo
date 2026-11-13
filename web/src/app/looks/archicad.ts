// View › Work Like › Archicad: Rodeo laid out as Archicad 27/28 for Windows, so an Archicad user
// finds the same menus in the same order, the same words for layers, stories and objects, the
// Toolbox down the left, the Info Box under the menus and the Navigator on the right. Every button
// and row still runs one of Rodeo's own tools or menu commands, so nothing here is copied from
// Archicad: only where things sit and what they are called.

import "./archicad.css";
import { UI_ICON } from "../icons.ts";
import type { Command, LookButton, LookSpec } from "./types.ts";

/** A toolbar or toolbox button: its name and what it runs; its icon is Rodeo's own, else the command's. */
function button(label: string, c: Command, icon?: string): LookButton {
  return icon ? { label, do: c, icon } : { label, do: c };
}

/** A toolbar button with its name shown beside its icon (Archicad 28's Grids, Measure and Group). */
function labelled(label: string, c: Command): LookButton {
  return { ...button(label, c), showLabel: true };
}

/** Archicad's status bar words for the steps of the tools it shares with Rodeo, by Rodeo's hint's first part. */
const ARCHICAD_PROMPTS: Readonly<Record<string, string>> = {
  "Click or drag a box to select": "Click an element or draw a selection area.",
  "Click the wall's start, or a wall's end or side to join it": "Enter first node of PolyWall",
  "Click the next corner, or a wall to join": "Enter next node of PolyWall",
};

export const look: LookSpec = {
  id: "archicad",
  name: "Archicad",
  theme: "light",
  // Each look menu takes the leftovers of the Rodeo menus named in its id ("Edit|Modify" takes
  // Modify's rows the look does not place). Options and Teamwork have no Rodeo menu of their own,
  // so they only hold the rows placed in them.
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
        "File › Close All",
        "-",
        "File › Save",
        "File › Save As…",
        "File › Save a Copy As…",
        "File › Save as Template…",
        "File › Save All",
        "File › Revert",
        "-",
        // Archicad's Libraries and Objects palette: Rodeo's Resource Manager, named Library by the terms
        "Window › Palettes › Resource Manager",
        "-",
        // Interoperability: the import and export submenus
        "File › Import",
        "File › Export",
        "-",
        "File › Print…",
        "-",
        "File › File Info…",
      ],
    },
    {
      id: "Edit|Modify",
      title: "Edit",
      rows: [
        "Edit › Undo",
        "Edit › Redo",
        "-",
        "Edit › Cut",
        "Edit › Copy",
        "Edit › Paste",
        "-",
        "Edit › Delete",
        "Edit › Select All",
        "-",
        // Find & Select: Rodeo's custom selection, named Find & Select by the terms, with its select rows
        "Tools › Custom Selection…",
        "Edit › Select Similar",
        "Edit › Select Connected Objects",
        "Edit › Invert Selection",
        "Edit › Select None",
        "-",
        "Modify › Group",
        "Modify › Ungroup",
        "-",
        "Modify › Move…",
        "Modify › Rotate…",
        "Modify › Flip Horizontal",
        "Modify › Flip Vertical",
        "Modify › Scale Objects…",
        "-",
        // Reshape: the join and convert rows of Modify
        "Modify › Join",
        "Modify › Convert",
        "-",
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
        "View › Normal Scale",
        "View › Previous View",
        "View › Next View",
        "-",
        // Floor Plan (2D) and 3D Window: the 2D plan and the 3D view, as F2 and F3 open them
        "View › Projection › 2D Plan",
        "View › 3D View",
        "-",
        // Standard Views and the 3D projection settings
        "View › Standard Views",
        "View › Set 3D View…",
        "-",
        // Grid & Editing Plane
        "View › Show Grid",
        "View › Snap to Grid",
        "View › Snap to Objects",
        "Modify › Working Plane",
        "-",
        // Elements in 3D View: Rodeo's Rendering styles
        "View › Rendering",
        "-",
        // Layer Options (Rodeo's Class Options) and Story Options (Rodeo's Layer Options)
        "View › Class Options",
        "View › Layer Options",
        "-",
        "View › Rulers",
        "View › Appearance",
      ],
    },
    {
      id: "AEC|Model|Stage",
      title: "Design",
      rows: [
        // Building elements the AEC menu makes from shapes and roofs
        "AEC › Create Roof…",
        "AEC › Roof Face…",
        "AEC › Pillar…",
        "AEC › Create Objects from Shapes…",
        "AEC › Create Auto Hybrid",
        "-",
        // Solid operations and extrusions, the Model menu's
        "Model › Extrude…",
        "Model › Multiple Extrude…",
        "Model › Tapered Extrude…",
        "Model › Sweep…",
        "Model › Extrude Along Path…",
        "-",
        "Model › Add Solids",
        "Model › Subtract Solids",
        "Model › Intersect Solids",
        "Model › Section Solids…",
        "-",
        "AEC › Space Planning",
        "AEC › Framing",
        "AEC › Terrain",
        "AEC › Roads",
        "AEC › Plants",
        "AEC › MEP",
        "-",
        "Stage › Lighting",
        "-",
      ],
    },
    {
      id: "Text|Tools",
      title: "Document",
      rows: [
        // Dimensions and text
        "Text › Format Text…",
        "Text › Text Style",
        "Text › Find-Replace Text…",
        "Text › Check Spelling…",
        "Text › Text Along Path…",
        "Text › Convert Text to Polylines",
        "Text › Redlines",
        "-",
        // Drawings (Rodeo's viewports)
        "View › Create Viewport…",
        "View › Create Section Viewport…",
        "View › Create Interior Elevation Viewport…",
        "View › Create Detail Viewport…",
        "View › Create Multiple Viewports…",
        "View › Update All Viewports",
        "-",
        // Layouts (Rodeo's sheet layers)
        "Window › Palettes › Sheet Layers",
        "-",
        // Schedules and worksheets
        "Tools › Reports",
        "-",
        // Publisher: exporting the drawing as a document
        "File › Export › Export PDF…",
        "File › Export › Export Image File…",
      ],
    },
    {
      id: "Options",
      title: "Options",
      rows: [
        // Element Attributes: the layers, stories and organisation rows
        "Window › Palettes › Attributes",
        "Window › Palettes › Classes",
        "Window › Palettes › Design Layers",
        "Tools › Organization…",
        "Tools › Class and Layer Mapping…",
        "-",
        // Line types and pens and colours
        "Tools › Options › Line Thickness…",
        "Tools › Utilities › Color Palette Manager…",
        "-",
        // Work Environment and Project Preferences
        "Edit › Preferences…",
        "File › Document Settings",
        "Tools › Snap Settings…",
      ],
    },
    {
      id: "Teamwork",
      title: "Teamwork",
      rows: [
        "Window › Collaborators",
        "Window › Palettes › Version History",
        "Window › Palettes › Merge Requests",
        "Window › Palettes › Compare",
      ],
    },
    {
      id: "Window|Plug-ins",
      title: "Window",
      rows: [
        "Window › Home Screen",
        "-",
        "Window › Drawings",
        "-",
        "Window › Palettes",
        "Window › Palette Options",
        "Window › Reset Palette Layout",
        "-",
      ],
    },
    {
      id: "Help",
      title: "Help",
      rows: ["Help › User Guide", "Help › Keyboard Shortcuts…", "Help › What's New…", "Help › About Rodeo…", "Help › Plug-in API…"],
    },
  ],
  // Archicad's words for Rodeo's: whole texts only. Layers are Rodeo's classes and stories are
  // Rodeo's layers, so each is swapped the way Archicad users would name it.
  terms: {
    "Object Info": "Properties",
    Navigation: "Navigator",
    Resources: "Library",
    "Resource Manager": "Library",
    Symbol: "Object",
    Symbols: "Objects",
    Class: "Layer",
    Classes: "Layers",
    "Design Layer": "Story",
    "Design Layers": "Stories",
    Layer: "Story",
    Layers: "Stories",
    // Rodeo's own stories (a building's levels, each holding layers) are what Story Settings sets up
    Story: "Story Setting",
    Stories: "Story Settings",
    Sheets: "Layouts",
    "Layer options": "Story options",
    "Class options": "Layer options",
    "Sheet Layer": "Layout",
    "Sheet Layers": "Layouts",
    "Saved Views": "View Map",
    Viewport: "Drawing",
    Viewports: "Drawings",
    "Fit to Window": "Fit in Window",
    Space: "Zone",
    "2D Plan": "Floor Plan",
    "3D View": "3D Window",
    "Set 3D View…": "3D Projection Settings…",
    "Class Options": "Layer Options",
    "Layer Options": "Story Options",
    Rendering: "Elements in 3D View",
    Attributes: "Element Attributes",
    "Custom Selection…": "Find & Select…",
    "Preferences…": "Work Environment…",
    "Document Settings": "Project Preferences",
    "Color Palette Manager…": "Pens & Colors…",
    "Line Thickness…": "Line Types…",
    "Create Viewport…": "Create Drawing…",
    "Create Section Viewport…": "Create Section Drawing…",
    "Create Interior Elevation Viewport…": "Create Interior Elevation Drawing…",
    "Create Detail Viewport…": "Create Detail Drawing…",
    "Create Multiple Viewports…": "Create Multiple Drawings…",
    "Update All Viewports": "Update All Drawings",
  },
  // Where the palettes sit: the Navigator on the right, Properties under it, Library as its tab,
  // and the palettes Archicad's start does not show, hidden.
  palettes: {
    navigation: { where: "right", order: 0, weight: 400 },
    objectInfo: { where: "right", order: 1 },
    resources: { where: "right", tabOf: "navigation" },
    basic: { where: "hidden" },
    toolsets: { where: "hidden" },
    attributes: { where: "hidden" },
    snapping: { where: "hidden" },
    visualization: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { right: 280 },
  topBar: false,
  menuBar: true,
  snapPill: false,
  rails: false,
  modeBar: "options",
  // the Info Box: captioned panels (Main, then each of the tool's mode groups)
  modeFields: "panels",
  // the status bar at the window's foot, where Archicad prompts the next step ("Enter First Node of PolyWall")
  statusBar: { rows: [[{ kind: "hint", style: "sentences", prompts: ARCHICAD_PROMPTS }, { kind: "spacer" }]] },
  // the Quick Options under the drawing in place of Rodeo's view bar
  viewBar: "hidden",
  viewControl: "archicad",
  icons: "color",
  // the Navigator's Project Map in the Navigation palette's place; plans without a grid or a view cube
  panels: { navigation: { kind: "browser", style: "archicad" } },
  grid: false,
  viewCube: false,
  // Standard toolbar under the menus, in Archicad 28's order: undo and redo; pick up and inject
  // parameters; Grids, Measure and Group with their names; then the editing tools as icons.
  toolbars: {
    showTabs: false,
    tabs: [
      {
        title: "Standard",
        buttons: [
          button("Undo", { menu: "Edit › Undo" }, UI_ICON.undo),
          button("Redo", { menu: "Edit › Redo" }, UI_ICON.redo),
          "-",
          button("Pick Up Parameters", { tool: "eyedropper", mode: "pick" }),
          button("Inject Parameters", { tool: "eyedropper", mode: "put" }),
          "-",
          labelled("Grids", { menu: "View › Show Grid" }),
          labelled("Measure", { tool: "measure" }),
          labelled("Group", { menu: "Modify › Group" }),
          "-",
          button("Split", { tool: "split" }),
          button("Adjust", { tool: "reshape" }),
          button("Trim", { tool: "trim" }),
          // Connect moves a line's end to where it crosses the other line: Archicad's Intersect
          button("Intersect", { tool: "connect" }),
          button("Fillet", { tool: "fillet" }),
          button("Offset", { tool: "offset" }),
          button("Resize", { menu: "Modify › Scale Objects…" }),
        ],
      },
    ],
  },
  // The Toolbox down the left, labelled, one column, as Archicad 28's: the arrow and the marquee,
  // then the foldable Design, Document and More groups. Each button is Rodeo's tool or menu row under
  // Archicad's name.
  toolbox: {
    side: "left",
    columns: 1,
    labels: true,
    title: "Toolbox",
    groups: [
      {
        buttons: [
          // Rectangle is the selection tool's own drag, so Arrow puts the marquee back to it
          button("Arrow", { tool: "select", mode: "rect" }),
          // Archicad's separate Marquee tool: the selection tool's lasso
          button("Marquee", { tool: "select", mode: "lasso" }),
        ],
      },
      {
        title: "Design",
        fold: "open",
        buttons: [
          button("Wall", { tool: "wall" }),
          button("Door", { tool: "door" }),
          button("Window", { tool: "window" }),
          button("Column", { tool: "column" }),
          button("Beam", { tool: "structmember" }),
          button("Slab", { tool: "slab" }),
          button("Stair", { tool: "stair" }),
          button("Roof", { menu: "AEC › Create Roof…" }),
          button("Shell", { tool: "shellsolid" }),
          button("Morph", { tool: "extpoly" }),
          button("Object", { tool: "symbol" }),
          button("Zone", { tool: "space" }),
        ],
      },
      {
        title: "Document",
        fold: "open",
        buttons: [
          button("Dimension", { tool: "dimension" }),
          button("Text", { tool: "text" }),
          button("Label", { tool: "callout" }),
          button("Fill", { tool: "polygon" }),
          button("Line", { tool: "line" }),
          button("Arc/Circle", { tool: "arc" }),
          button("Polyline", { tool: "polyline" }),
          button("Drawing", { menu: "View › Create Viewport…" }),
          button("Section", { tool: "secline" }),
          button("Elevation", { tool: "secmarker" }),
          button("Interior Elevation", { tool: "intelev" }),
          button("Worksheet", { menu: "Tools › Reports › Create Report…" }),
          button("Detail", { tool: "detailcallout" }),
          button("Change Marker", { tool: "cloud" }),
          button("Figure", { menu: "File › Import › Import Image File(s)…" }),
          button("Camera", { tool: "camera" }),
        ],
      },
      {
        title: "More",
        fold: "closed",
        buttons: [
          button("Hotspot", { tool: "locus" }),
          button("Grid Element", { tool: "gridline" }),
          button("Railing", { tool: "railing" }),
          button("Wall End", { tool: "walljoin" }),
          button("Lamp", { tool: "light" }),
        ],
      },
    ],
  },
  // Archicad's keys: F2 the floor plan, F3 the 3D window, Delete removes the selection.
  keys: {
    F2: { menu: "View › Projection › 2D Plan" },
    F3: { menu: "View › 3D View" },
    Delete: { menu: "Edit › Delete" },
    F5: { menu: "View › 3D View" },
    "Ctrl+A": { menu: "Edit › Select All" },
    "Ctrl+Z": { menu: "Edit › Undo" },
    "Ctrl+Shift+Z": { menu: "Edit › Redo" },
    "Ctrl+G": { menu: "Modify › Group" },
    "Ctrl+Shift+G": { menu: "Modify › Ungroup" },
    "Ctrl+M": { tool: "mirror" },
    // Edit › Move › Drag, and Drag a Copy: Move by Points in its Move and Copy modes
    "Ctrl+D": { tool: "moveby", mode: "move" },
    "Ctrl+E": { tool: "rotate" },
    "Ctrl+Shift+D": { tool: "moveby", mode: "copy" },
  },
  // Archicad pans with the wheel pressed; Shift with the wheel orbits. The right button opens the menu.
  mouse: { middle: "pan", right: "menu" },
  paper: "#ffffff",
  background3d: "#e9eef2",
};
