// Site Context: File > Import Site Context… (a map dialog that brings real-world context into the
// drawing at true scale, placed by the drawing's georeferencing): buildings standing in 3D, the
// terrain as a site model, and roads, paths, rail, water, green spaces, trees and facilities.

import { documentSource, registerMenu } from "../../app/ext.ts";
import { store } from "../../app/state.ts";

registerMenu("File › Import", () => [
  {
    label: "Import Site Context…",
    enabled: () => store.session !== null && !documentSource()?.readOnly,
    // the map (Leaflet) loads on first use, not with the editor
    run: () => void import("./dialog.ts").then((m) => m.openSiteContextDialog()),
  },
]);
