// Keeps Spaces with "Auto-Boundary" to their walls after each edit: registered with the edit followers
// (ext.ts), so an edit that moves a wall reshapes the Spaces round it in the same undo step. The work
// is in refit.ts (free of the page, checked by follow.check.ts); this file is only the registration,
// and app.ts imports it.

import type { EditSession } from "../../core/index.ts";
import { followEdits } from "../ext.ts";
import { store } from "../state.ts";
import { refitSpaces } from "./refit.ts";

/** The edit follower: refits the auto-boundary Spaces with the editor's drawing attributes. Never throws. */
export function keepSpacesToWalls(s: EditSession): void {
  try {
    refitSpaces(s, store.drawAttrs);
  } catch (err) {
    console.warn(err);
  }
}

followEdits(keepSpacesToWalls);
