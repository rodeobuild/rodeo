// (steps, snapshot parts and host answers of prefs.ts: see steps.ts)
//
// What the preference and object-variable calls read from the editor, and the editor settings a
// script changed (SetPref...) applied when its run ends, as the editor's own toggles apply them.

import { store, setGrid, setSnapSettings, setZoomLineThickness } from "../../../app/state.ts";
import { registerObjectSnapshot, registerResult, registerSnapshot } from "../steps.ts";

registerSnapshot((s) => ({
  fileName: s.doc.info.fileName,
  // the unit style's name as the drawing's units list it, and the platform: 2 on Windows, else 1 (a Mac)
  unitName: s.doc.info.units ?? "",
  platform: /Windows/.test(navigator.userAgent) ? 2 : 1,
  editor: {
    showGrid: store.showGrid,
    snapGrid: store.snapGrid,
    snapObjects: store.snapObjects,
    zoomLines: store.zoomLineThickness,
    snapRadius: store.snapSettings.radiusPx,
  },
}));

registerResult((result) => {
  const assumed = result.prefsAssumed as [string, number][] | undefined;
  if (assumed && assumed.length > 0) {
    console.info(
      "Script used preference selectors Rodeo doesn't keep (remembered for the run only):",
      assumed.map(([call, sel]) => `${call}(${sel})`).join(", "),
    );
  }
  const set = (result.prefsSet ?? {}) as Record<string, boolean | number>;
  if (Object.keys(set).length === 0) return;
  const grid: { show?: boolean; snap?: boolean } = {};
  if (typeof set.showGrid === "boolean") grid.show = set.showGrid;
  if (typeof set.snapGrid === "boolean") grid.snap = set.snapGrid;
  if (grid.show !== undefined || grid.snap !== undefined) setGrid(grid);
  if (typeof set.zoomLines === "boolean") setZoomLineThickness(set.zoomLines);
  if (typeof set.snapObjects === "boolean" && set.snapObjects !== store.snapObjects) {
    store.snapObjects = set.snapObjects;
    store.emit("snap");
  }
  if (typeof set.snapRadius === "number") setSnapSettings({ ...store.snapSettings, radiusPx: set.snapRadius });
});

// what the fill and 3D selectors read: whether an object is 3D (it has a place in plan), and the
// mapping of its gradient, tile or hatch fill, in millimetres
registerObjectSnapshot((o) => ({
  is3d: o.bounds !== undefined,
  ...(o.fillMap ? { fillMap: { origin: [o.fillMap.origin.x, o.fillMap.origin.y], u: [o.fillMap.u.x, o.fillMap.u.y], v: [o.fillMap.v.x, o.fillMap.v.y] } } : {}),
}));
