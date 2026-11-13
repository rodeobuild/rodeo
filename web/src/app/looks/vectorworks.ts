// View › Work Like › Vectorworks: Vectorworks 2026 for Windows in its Architect workspace, light.
// Its menu bar and menus are Rodeo's own (Rodeo's menus already follow Vectorworks'), the bars
// over the drawing are laid out as Vectorworks has them, and the palettes sit in the same two
// sidebars: Basic, Tool Sets and Snapping on the left; Object Info with Navigation and Attributes
// as its tabs, and Resource Manager, on the right. There is no ribbon, toolbar, toolbox, command
// line or status bar: Vectorworks has none of them.
import "./vectorworks.css";
import type { LookSpec } from "./types.ts";

export const look: LookSpec = {
  id: "vectorworks",
  name: "Vectorworks",
  theme: "light",
  menus: null,
  // Rodeo's palette is called "Resources"; Vectorworks' is the Resource Manager
  terms: { Resources: "Resource Manager" },
  palettes: {
    basic: { where: "left", order: 0, collapsed: false },
    toolsets: { where: "left", order: 1, weight: 400 },
    snapping: { where: "left", order: 2 },
    objectInfo: { where: "right", order: 0, weight: 420 },
    resources: { where: "right", order: 1, weight: 360 },
    navigation: { where: "right", tabOf: "objectInfo" },
    attributes: { where: "right", tabOf: "objectInfo" },
    visualization: { where: "hidden" },
    workingPlanes: { where: "hidden" },
    agents: { where: "hidden" },
  },
  docks: { left: 210, right: 300 },
  topBar: false,
  menuBar: true,
  modeBar: "options",
  viewBar: "hud",
  snapPill: false,
  rails: false,
  mouse: { middle: "pan", right: "menu" },
  paper: "#ffffff",
  background3d: "#e8e8e8",
};
